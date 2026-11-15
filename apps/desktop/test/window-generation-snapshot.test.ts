import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import { createSessionStore } from '../src/main/db/session-store'
import { observeGenerationReads } from './helpers/observe-generation-reads'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) close()
})

function world() {
  const folder = mkdtempSync(join(tmpdir(), 'generation-snapshot-'))
  const file = join(folder, 'fictional.sqlite')
  const db = openDatabase(file)
  cleanup.push(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const writer = createSessionStore(db)
  function adopt(id: string) {
    writer.adopt({
      id,
      provider: 'codex',
      sessionId: `fictional-${id}`,
      cwd: folder,
      profileId: 'fictional',
      createdAt: 1,
      updatedAt: 1,
    })
  }
  adopt('alpha')
  const root = writer.rootOf('alpha')!.piece
  function snapshot() {
    const reader = new Database(file, { readonly: true, fileMustExist: true })
    cleanup.push(() => reader.close())
    reader.pragma('query_only = ON')
    reader.exec('BEGIN')
    reader.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get()
    const reads = observeGenerationReads(reader)
    const store = createSessionStore(reader, Date.now, undefined, Math.random, undefined, true)
    return { store, reads }
  }
  return { db, writer, root, adopt, snapshot }
}

function readMetadata(w: ReturnType<typeof world>, store: ReturnType<typeof createSessionStore>) {
  expect(store.generationOf!('alpha')).toBe(0)
  expect(store.theActiveGeneration('alpha')).toBe(0)
  expect(store.generationOf!('alpha')).toBe(0)
  expect(store.rootLines(w.root)).toEqual(w.writer.rootLines(w.root))
  expect(store.turnBlockRootLines(w.root)).toEqual(w.writer.turnBlockRootLines(w.root))
}

it('reads a generation once for metadata without eagerly reading the newest fold row', () => {
  const w = world()
  const { store, reads } = w.snapshot()
  readMetadata(w, store)
  console.info(JSON.stringify({ generationMetadata: reads.generations, newest: reads.newest }))
  expect(reads.newest).toEqual([])
  expect(reads.generations).toEqual(['alpha'])
})

it('shares that same generation with the first complete piece fold', () => {
  const w = world()
  const { store, reads } = w.snapshot()
  readMetadata(w, store)
  const unread = rowsUnreadOnce()
  expect(store.openPiecesOf('alpha', unread)).toEqual(
    w.writer.openPiecesOf('alpha', rowsUnreadOnce()),
  )
  expect(unread.count).toBe(0)
  expect(unread.ledgersSkipped).toBe(0)
  console.info(JSON.stringify({ generationFirstFold: reads.generations, newest: reads.newest }))
  expect(reads.newest).toEqual(['alpha'])
  expect(reads.generations).toEqual(['alpha'])
})

it('keeps absent generations bounded and rereads an evicted owner', () => {
  const { store, reads } = world().snapshot()
  for (let i = 0; i < 2001; i++) {
    const owner = `missing-${i}`
    expect(store.generationOf!(owner)).toBe(0)
    expect(store.generationOf!(owner)).toBe(0)
  }
  const filled = reads.generations.length
  expect(store.generationOf!('missing-2000')).toBe(0)
  const retained = reads.generations.length
  expect(store.generationOf!('missing-0')).toBe(0)
  expect(reads.newest).toEqual([])
  expect([filled, retained, reads.generations.length]).toEqual([2001, 2001, 2002])
})

it('keeps the pinned generation and sees promotions and newly present owners in a fresh read', () => {
  const w = world()
  const old = w.snapshot()
  expect(old.store.generationOf!('alpha')).toBe(0)
  expect(old.store.generationOf!('late')).toBe(0)
  w.adopt('late')
  const promoted: number[] = []
  for (const owner of ['alpha', 'late']) {
    const generation = w.writer.beginGeneration(owner)
    expect(
      w.writer.promoteGeneration(owner, generation, {
        normalizerVersion: 1,
        derivedThrough: 0,
      }),
    ).toBe(true)
    promoted.push(generation)
  }
  expect(old.store.generationOf!('alpha')).toBe(0)
  expect(old.store.generationOf!('late')).toBe(0)
  const fresh = w.snapshot()
  expect(['alpha', 'late'].map((owner) => fresh.store.generationOf!(owner))).toEqual(promoted)
  expect(old.reads.newest).toEqual([])
  expect(fresh.reads.newest).toEqual([])
})

it('does not share writer generation reads across a promotion and outer rollback', () => {
  const w = world()
  const reads = observeGenerationReads(w.db)
  const writer = createSessionStore(w.db)
  const observed: number[] = []
  const queryDeltas: number[] = []
  const read = () => {
    const before = reads.generations.length
    observed.push(writer.generationOf!('alpha'))
    queryDeltas.push(reads.generations.length - before)
  }
  read()
  let promoted = 0
  expect(() =>
    w.db.transaction(() => {
      promoted = writer.beginGeneration('alpha')
      expect(
        writer.promoteGeneration('alpha', promoted, {
          normalizerVersion: 1,
          derivedThrough: 0,
        }),
      ).toBe(true)
      read()
      read()
      throw new Error('Fictional outer rollback')
    })(),
  ).toThrow('Fictional outer rollback')
  read()
  expect(promoted).toBeGreaterThan(0)
  expect(observed).toEqual([0, promoted, promoted, 0])
  expect(queryDeltas).toEqual([1, 1, 1, 1])
})

it('does not retain failed generation or newest reads and retains a successful empty head', () => {
  const w = world()
  const { store, reads } = w.snapshot()
  reads.failNextGeneration()
  expect(() => store.generationOf!('alpha')).toThrow('Fictional generation read failed')
  expect(store.generationOf!('alpha')).toBe(0)
  expect(reads.generations).toEqual(['alpha', 'alpha'])
  reads.failNextNewest()
  expect(() => store.openPiecesOf('alpha', rowsUnreadOnce())).toThrow(
    'Fictional newest read failed',
  )
  expect(store.openPiecesOf('alpha', rowsUnreadOnce())).toEqual(
    w.writer.openPiecesOf('alpha', rowsUnreadOnce()),
  )
  expect(reads.newest).toEqual(['alpha', 'alpha'])
  expect(store.openPiecesOf('empty', rowsUnreadOnce())).toEqual([])
  expect(store.openPiecesOf('empty', rowsUnreadOnce())).toEqual([])
  expect(reads.newest.filter((id) => id === 'empty')).toEqual(['empty'])
})
