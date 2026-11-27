import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import { windowFoldCache } from '../src/main/db/window-fold-cache'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { WindowIncidentReads } from '../src/main/db/window-incident-reads'
import { recordedReadKey } from '../src/main/db/window-read-protocol'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { adoptOwnerWithChild } from './helpers/adopt-owner-with-child'
import { withoutBrief } from './helpers/window-incident-cases'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) close()
})

it.each([false, true])(
  'consumes an unretained incident piece fold once and preserves both skip sets (torn=%s)',
  async (torn) => {
    const directory = mkdtempSync(join(tmpdir(), 'incident-pieces-'))
    const file = join(directory, 'fictional.sqlite')
    const db = openDatabase(file)
    cleanup.push(() => {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    })
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const store = createSessionStore(db)
    adoptOwnerWithChild(store, 'alpha', directory, 'Fictional open work')
    store.append(
      'alpha',
      store.nextOrdinal('alpha'),
      {
        type: 'user_turn',
        text: 'Fictional words',
        humanInitiated: true,
      },
      2,
    )
    const skipped = store.nextOrdinal('alpha')
    if (torn)
      db.prepare(
        'INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,?,?,?,?,?,0)',
      ).run('fictional-torn-piece', 'alpha', skipped, 'work_status_set', '{', 3)
    const unread = rowsUnreadOnce()
    const expected = store.piecesOwnedBy('alpha', unread)
    const expectedOpen = store.openPiecesOf('alpha', rowsUnreadOnce())
    const engine = new WindowReadEngine(file)
    cleanup.push(() => engine.close())
    // Exercise the canonical read when the existing cache cannot retain an entry.
    Object.assign(engine, { answers: windowFoldCache(0) })
    const native = (engine as unknown as { db: AppDatabase }).db
    const prepare = native.prepare.bind(native)
    let pieceReads = 0
    let readsBeforeNewestTurn: number | undefined
    vi.spyOn(native, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      if (sql.includes('json_remove') && sql.includes("type IN ('work_given'")) {
        const iterate = statement.iterate.bind(statement)
        vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
          pieceReads++
          yield* iterate(...args)
        })
      }
      if (
        sql ===
        'SELECT id FROM turn WHERE session_id = ? ORDER BY generation DESC, ordinal DESC LIMIT 1'
      ) {
        const get = statement.get.bind(statement)
        vi.spyOn(statement, 'get').mockImplementation((...args) => {
          readsBeforeNewestTurn ??= pieceReads
          return get(...args)
        })
      }
      return statement
    })
    const result = engine.read({ kind: 'incidents' })
    if (result.kind !== 'incidents') throw new Error('wrong incident reading')
    const owner = result.owners.find((one) => one.sessionId === 'alpha')!
    // Incident reads carry open pieces without their brief text.
    expect(owner.pieces).toEqual(expectedOpen.map(withoutBrief))
    expect(owner.history.states).toEqual(expected.map((one) => [one.piece, one.state]))
    expect(unread.count).toBe(torn ? 1 : 0)
    expect(owner.piecesSkipped).toEqual(torn ? [skipped] : [])
    expect(owner.history.statesSkipped).toEqual(owner.piecesSkipped)
    // The terminal is now selected before the one shared current/cut replay begins.
    expect(readsBeforeNewestTurn).toBe(0)
    expect(pieceReads).toBe(1)

    // The ordinary sweep asks for just its holder group through the actual worker protocol.
    const entry = await bundleAWorker(
      'src/main/window-reader.worker.ts',
      directory,
      'reconciliation-worker.cjs',
    )
    const reader = new WindowWorkerReader(new Worker(entry, { workerData: { file } }))
    try {
      const holders = ['alpha']
      const expectedWork = store.reconciliationWork(new Set(holders), rowsUnreadOnce())
      expect(await reader.read({ kind: 'reconciliation-folds', holders })).toEqual({
        kind: 'reconciliation-folds',
        owners: [
          {
            sessionId: 'alpha',
            pieces: expectedOpen.map(withoutBrief),
            work: expectedWork.map(withoutBrief),
            piecesSkipped: torn ? [skipped] : [],
          },
        ],
        reads: expect.arrayContaining([
          expect.objectContaining({ key: recordedReadKey(['providerFailureEpisode', 'alpha']) }),
          expect.objectContaining({
            key: recordedReadKey(['reconciliationReceiptsForOwner', 'alpha']),
          }),
        ]),
      })
    } finally {
      await reader.close()
    }
  },
  60_000,
)

it('answers a group’s failure and wait reads from the worker’s snapshot, and asks the store for the rest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reconciliation-reads-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  cleanup.push(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  adoptOwnerWithChild(store, 'alpha', directory, 'Fictional open work')
  const root = store.rootOf('alpha')!
  const target = {
    piece: 'fictional-target',
    parent: root.piece,
    givenBy: 'alpha',
    title: 'Fictional target',
    brief: 'Fictional',
  }
  store.recordGive(
    { ...target, number: 2, owner: 'alpha', folder: null, inputs: [] },
    store.nextOrdinal('alpha'),
    { type: 'work_given', ...target, label: `${root.label}.2` },
    2,
  )
  store.append(
    'alpha',
    store.nextOrdinal('alpha'),
    {
      type: 'work_status_set',
      piece: root.piece,
      line: 'waiting for the fictional child',
      by: 'alpha',
      waiting: true,
      on: { kind: 'agent', piece: target.piece, label: `${root.label}.2` },
    } as TranscriptEvent,
    2,
  )
  const engine = new WindowReadEngine(file)
  cleanup.push(() => engine.close())
  const result = engine.read({ kind: 'reconciliation-folds', holders: ['alpha'] })
  if (result.kind !== 'reconciliation-folds') throw new Error('wrong reconciliation reading')
  expect(result.reads?.map((read) => read.key)).toEqual(
    expect.arrayContaining([
      recordedReadKey(['providerFailureEpisode', 'alpha']),
      recordedReadKey(['reconciliationReceiptsForOwner', 'alpha']),
      recordedReadKey(['workById', target.piece]),
      recordedReadKey(['piecesOwnedBy', 'alpha']),
    ]),
  )

  const incidents = new WindowIncidentReads(
    () => null,
    () => null,
  )
  const served = incidents.store(store)
  const asked: string[] = []
  for (const key of ['workById', 'piecesOwnedBy', 'providerFailureEpisode'] as const) {
    const original = store[key].bind(store) as (...args: unknown[]) => unknown
    vi.spyOn(store, key).mockImplementation(((...args: unknown[]) => {
      asked.push(`${key} ${String(args[0])}`)
      return original(...args)
    }) as never)
  }
  const expected = {
    target: store.workById(target.piece),
    pieces: store.piecesOwnedBy('alpha', rowsUnreadOnce()),
    episode: store.providerFailureEpisode('alpha'),
  }
  asked.length = 0
  expect(expected.target?.owner).toBe('alpha')
  const answered = incidents.run(
    () => ({
      target: served.workById(target.piece),
      pieces: served.piecesOwnedBy('alpha', rowsUnreadOnce()),
      episode: served.providerFailureEpisode('alpha'),
      elsewhere: served.workById('fictional-unrecorded-piece'),
    }),
    result,
  )
  expect(answered).toEqual({ ...expected, elsewhere: null })
  expect(asked).toEqual(['workById fictional-unrecorded-piece'])
  // Outside the group's step every read goes to the store.
  served.workById(target.piece)
  expect(asked).toEqual(['workById fictional-unrecorded-piece', `workById ${target.piece}`])
})
