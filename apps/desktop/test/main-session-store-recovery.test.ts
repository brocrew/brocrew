import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let root: string
let db: AppDatabase
let store: SessionStore

const torn = (ordinal: number): void => {
  db.prepare(
    `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
     VALUES (?, 'sess_recovery', 0, ?, 'user_turn', '{not json', ?)`,
  ).run(`evt_torn_${ordinal}`, ordinal, ordinal + 1)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot-session-recovery-'))
  db = openDatabase(join(root, 'db.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db, () => 1_000)
  store.create({
    id: 'sess_recovery',
    provider: 'codex',
    cwd: root,
    approvalMode: 'ask',
    profileId: 'worker',
  })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

it('continues a windowed ledger read past a whole window of torn rows', () => {
  torn(0)
  torn(1)
  store.append('sess_recovery', 2, { type: 'user_turn', text: 'Readable after the damage' }, 3)
  expect(store.eventsFrom('sess_recovery', 0, 1)).toMatchObject([
    { ordinal: 2, event: { type: 'user_turn', text: 'Readable after the damage' } },
  ])
  store.append('sess_recovery', 3, { type: 'user_turn', text: 'A later message' }, 4)
  expect(store.eventsFrom('sess_recovery', 3, 1)).toMatchObject([
    { ordinal: 3, event: { type: 'user_turn', text: 'A later message' } },
  ])
  expect(store.eventsFrom('sess_recovery', 4, 1)).toEqual([])
})

it('finds the newest readable event when a newer row of the same type is torn', () => {
  store.append('sess_recovery', 0, { type: 'user_turn', text: 'Still readable' }, 1)
  torn(1)
  expect(store.newestOfType?.('sess_recovery', 'user_turn')).toMatchObject({
    ordinal: 0,
    event: { type: 'user_turn', text: 'Still readable' },
  })
  expect(store.newestOfType?.('sess_recovery', 'user_turn', undefined, 1)).toBeNull()
  expect(store.events('sess_recovery').map((one) => one.ordinal)).toEqual([0])
})

it('bounds pages by event count across ordinal gaps and keeps the turn cut honest', () => {
  store.append('sess_recovery', 0, { type: 'user_turn', text: 'first' }, 1)
  store.append('sess_recovery', 5, { type: 'assistant_message', text: 'first answer' }, 2)
  store.append('sess_recovery', 20, { type: 'user_turn', text: 'second' }, 3)
  store.append('sess_recovery', 40, { type: 'assistant_message', text: 'second answer' }, 4)

  const latest = store.turnWindow('sess_recovery', { turns: 2, maxEvents: 2 })
  expect(latest.entries.map((entry) => entry.ordinal)).toEqual([20, 40])
  expect(latest).toMatchObject({ from: 20, hasOlder: true, turnAligned: true })
  const prior = store.turnWindow('sess_recovery', { turns: 2, maxEvents: 2, before: latest.from })
  expect(prior.entries.map((entry) => entry.ordinal)).toEqual([0, 5])
  expect(prior).toMatchObject({ from: 0, hasOlder: false, turnAligned: true })
  const cut = store.turnWindow('sess_recovery', { turns: 1, maxEvents: 1 })
  expect(cut.entries.map((entry) => entry.ordinal)).toEqual([40])
  expect(cut).toMatchObject({ from: 40, hasOlder: true, turnAligned: false })
})

it('seeks past a torn indexed launch without crossing the requested floor', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  store.append('sess_recovery', 0, { type: 'launched' }, 1)
  db.prepare(
    `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
     VALUES ('torn-launch', 'sess_recovery', 0, 9, 'launched', '{broken', 2)`,
  ).run()

  expect(store.newestOfType?.('sess_recovery', 'launched')).toMatchObject({
    ordinal: 0,
    event: { type: 'launched' },
  })
  expect(store.newestOfType?.('sess_recovery', 'launched', undefined, 1)).toBeNull()
  expect(store.newestOfType?.('sess_recovery', 'launched', 1)).toMatchObject({ ordinal: 0 })
})

it('reads only the promoted generation and shares its maximum with the next append', () => {
  store.append('sess_recovery', 0, { type: 'user_turn', text: 'old generation' }, 1)
  const generation = store.beginGeneration('sess_recovery')
  store.appendGeneration('sess_recovery', generation, [
    { ordinal: 4, at: 2, event: { type: 'user_turn', text: 'promoted generation' } },
    { ordinal: 7, at: 3, event: { type: 'assistant_message', text: 'promoted answer' } },
  ])
  expect(
    store.promoteGeneration('sess_recovery', generation, {
      normalizerVersion: 1,
      derivedThrough: 2,
    }),
  ).toBe(true)

  expect(store.eventsFrom('sess_recovery', 0, 10).map((entry) => entry.ordinal)).toEqual([4, 7])
  expect(
    store
      .turnWindow('sess_recovery', { turns: 10, maxEvents: 10 })
      .entries.map((entry) => entry.ordinal),
  ).toEqual([4, 7])
  expect(store.nextOrdinal('sess_recovery')).toBe(8)
  store.append(
    'sess_recovery',
    store.nextOrdinal('sess_recovery'),
    { type: 'user_turn', text: 'next' },
    4,
  )
  expect(store.newestOfType?.('sess_recovery', 'user_turn')).toMatchObject({
    ordinal: 8,
    event: { text: 'next' },
  })
})

it('preserves a native ancestry-read cause and succeeds on the next real read', () => {
  store.append('sess_recovery', 0, { type: 'user_turn', text: 'read this page' }, 1)
  const page = store.turnWindow('sess_recovery', { turns: 1, maxEvents: 10 }).entries
  const fault = Object.assign(new Error('fictional read is busy'), { code: 'SQLITE_BUSY' })
  const prepare = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
    throw fault
  })
  let caught: unknown
  try {
    store.ancestryContext('sess_recovery', page, 0, 10)
  } catch (error) {
    caught = error
  }
  expect(caught).toBe(fault)
  prepare.mockRestore()
  const next = store.ancestryContext('sess_recovery', page, 0, 10)
  expect(next.epochs).toHaveLength(1)
  expect(next).toMatchObject({ missing: [], truncated: false })
})
