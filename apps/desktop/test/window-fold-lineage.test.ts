import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import type { WindowReadQuery, WindowReadResult } from '../src/main/db/window-read-protocol'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { observeLedgerFolds } from './helpers/observe-ledger-folds'
import { observeGenerationReads } from './helpers/observe-generation-reads'
import type { FoldCounts } from './helpers/observed-fold-counts'
import { adoptOwnerWithChild } from './helpers/adopt-owner-with-child'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

function world() {
  const folder = mkdtempSync(join(tmpdir(), 'fold-lineage-'))
  const file = join(folder, 'fictional.sqlite')
  const db = openDatabase(file)
  cleanup.push(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  for (const id of ['alpha', 'beta']) {
    adoptOwnerWithChild(store, id, folder, id)
  }
  const engine = new WindowReadEngine(file)
  cleanup.push(() => engine.close())
  const worker = (engine as unknown as { db: AppDatabase }).db
  const generationReads = observeGenerationReads(worker)
  const prepare = vi.mocked(worker.prepare).getMockImplementation()! as AppDatabase['prepare']
  const rebuilt: string[] = []
  const heads = generationReads.newest
  vi.spyOn(worker, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (sql.includes('json_remove')) {
      const iterate = statement.iterate.bind(statement)
      vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
        rebuilt.push(
          typeof args[0] === 'string' ? args[0] : String((args[0] as { session: string }).session),
        )
        yield* iterate(...args)
      })
    }
    return statement
  })
  function read(query: WindowReadQuery) {
    rebuilt.length = 0
    heads.length = 0
    generationReads.generations.length = 0
    return engine.read(query)
  }
  return { db, store, engine, read, rebuilt, heads, generationReads, folder, file }
}

function routing(result: WindowReadResult) {
  if (result.kind === 'incidents') return result.routing
  if (result.kind === 'routes' || result.kind === 'listing') return result
  throw new Error('Expected a folded reading')
}

it('keeps unchanged owner folds for different kinds already sent with the same capability', () => {
  const w = world()
  const cold = routing(w.read({ kind: 'incidents' }))
  expect(new Set(w.rebuilt)).toEqual(new Set(['alpha', 'beta']))
  const offered = { token: cold.cacheToken!, changed: [] }
  const queued: WindowReadQuery[] = [
    { kind: 'listing', reuse: offered },
    { kind: 'routes', reuse: offered },
  ]
  const readings = queued.map((query) => {
    const result = routing(w.read(query))
    return { result, rebuilt: [...w.rebuilt] }
  })
  for (const { result, rebuilt } of readings) {
    expect(result.work!.owners.map((owner) => owner.id).sort()).toEqual(['alpha', 'beta'])
    expect(rebuilt).toEqual([])
    expect(result.cacheToken).toBe(cold.cacheToken)
  }
})

it('keeps owner folds for a read queued with a capability this worker gave before its newest', () => {
  const w = world()
  const cold = routing(w.read({ kind: 'incidents' }))
  const fresh = routing(w.read({ kind: 'routes' }))
  expect(fresh.cacheToken).not.toBe(cold.cacheToken)
  const queued = routing(
    w.read({ kind: 'listing', reuse: { token: cold.cacheToken!, changed: [] } }),
  )
  expect(w.rebuilt).toEqual([])
  expect(queued.cacheToken).toBe(fresh.cacheToken)
})

it('reads each owner generation and newest fold row once per immutable worker snapshot', () => {
  const w = world()
  const cold = routing(w.read({ kind: 'incidents' }))
  const coldGenerations = [...w.generationReads.generations]
  w.read({ kind: 'routes', reuse: { token: cold.cacheToken!, changed: [] } })
  expect(w.heads.sort()).toEqual(['alpha', 'beta'])
  expect(w.rebuilt).toEqual([])
  console.info(
    JSON.stringify({
      generationEngine: { cold: coldGenerations, warm: w.generationReads.generations },
    }),
  )
  expect(coldGenerations.sort()).toEqual(['alpha', 'beta'])
  expect(w.generationReads.generations.sort()).toEqual(['alpha', 'beta'])
})

it('reuses owner folds when two real worker requests post the same earlier capability', async () => {
  const w = world()
  const bundle = await bundleAWorker(
    'test/helpers/measured-window-worker.ts',
    w.folder,
    'lineage-worker.cjs',
    [observeLedgerFolds()],
  )
  const worker = new Worker(bundle, {
    workerData: { file: w.file },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
  })
  const reader = new WindowWorkerReader(worker)
  cleanup.push(() => reader.close())
  const measurements: { capability: string; folds: Record<string, FoldCounts> }[] = []
  worker.on('message', (message) => {
    if (message.type === 'read') measurements.push(message.measurement)
  })
  const cold = routing(await reader.read({ kind: 'incidents' }))
  measurements.length = 0
  const offered = { token: cold.cacheToken!, changed: [] }
  const first = reader.read({ kind: 'listing', reuse: offered })
  const second = reader.read({ kind: 'routes', reuse: offered })
  const results = await Promise.all([first, second])
  for (const result of results)
    expect(
      routing(result)
        .work!.owners.map((owner) => owner.id)
        .sort(),
    ).toEqual(['alpha', 'beta'])
  expect(measurements).toHaveLength(2)
  expect(measurements.map((one) => one.capability)).toEqual(['match', 'match'])
  expect(measurements.map((one) => one.folds.pieces?.rebuilt ?? 0)).toEqual([0, 0])
  expect(results.map((result) => routing(result).cacheToken)).toEqual([
    cold.cacheToken,
    cold.cacheToken,
  ])
})

it('rebuilds changed owners and discards the lineage after cancellation or an unknown capability', () => {
  const w = world()
  const cold = routing(w.read({ kind: 'incidents' }))
  w.store.append(
    'alpha',
    1,
    {
      type: 'work_retitled',
      piece: w.store.rootOf('alpha')!.piece,
      title: 'Changed title',
      by: null,
    },
    2,
  )
  const changed = routing(
    w.read({ kind: 'routes', reuse: { token: cold.cacheToken!, changed: ['alpha'] } }),
  )
  expect(
    changed.work!.owners.find((owner) => owner.id === 'alpha')!.naming.value.named?.title,
  ).toBe('Changed title')
  expect(new Set(w.rebuilt)).toEqual(new Set(['alpha']))
  expect(() =>
    w.engine.read(
      { kind: 'listing', reuse: { token: changed.cacheToken!, changed: [] } },
      () => true,
    ),
  ).toThrow()
  const reset = routing(
    w.read({ kind: 'routes', reuse: { token: changed.cacheToken!, changed: [] } }),
  )
  expect(reset.cacheToken).not.toBe(changed.cacheToken)
  expect(new Set(w.rebuilt)).toEqual(new Set(['alpha', 'beta']))
  w.read({ kind: 'listing', reuse: { token: 'unknown', changed: [] } })
  expect(new Set(w.rebuilt)).toEqual(new Set(['alpha', 'beta']))
})

it('discards the lineage when publication recovers from a failed state read', () => {
  const w = world()
  const cold = routing(w.read({ kind: 'incidents' }))
  const database = (w.engine as unknown as { db: AppDatabase }).db
  const prepare = vi.mocked(database.prepare).getMockImplementation()! as AppDatabase['prepare']
  let fail = true
  vi.mocked(database.prepare).mockImplementation((sql) => {
    const statement = prepare(sql)
    if (sql === "SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'") {
      const iterate = statement.iterate.bind(statement)
      vi.spyOn(statement, 'iterate').mockImplementation(() => {
        if (fail) {
          fail = false
          throw new Error('Fictional state read failed')
        }
        return iterate()
      })
    }
    return statement
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const publication = w.read({
    kind: 'publication',
    kept: [],
    reuse: { token: cold.cacheToken!, changed: [] },
  })
  expect(publication.kind).toBe('publication')
  if (publication.kind !== 'publication') throw new Error('Expected publication')
  expect(publication.states).toBeNull()
  expect(warning).toHaveBeenCalledWith(
    'window worker could not read changed states',
    expect.objectContaining({ message: 'Fictional state read failed' }),
  )
  const next = routing(w.read({ kind: 'routes', reuse: { token: cold.cacheToken!, changed: [] } }))
  expect(next.cacheToken).not.toBe(cold.cacheToken)
  expect(new Set(w.rebuilt)).toEqual(new Set(['alpha', 'beta']))
})

it('reuses the current piece fold when the incident turn has no ending', () => {
  const w = world()
  w.store.append(
    'alpha',
    w.store.nextOrdinal('alpha'),
    { type: 'user_turn', text: 'Fictional live work', drives: 'alpha-child' },
    2,
  )
  const cold = routing(w.read({ kind: 'incidents' }))
  const warm = w.read({
    kind: 'incidents',
    reuse: { token: cold.cacheToken!, changed: [] },
  })
  if (warm.kind !== 'incidents') throw new Error('Expected incidents')
  expect(warm.owners.find((owner) => owner.sessionId === 'alpha')!.history.driven).toEqual({
    value: ['alpha-child'],
  })
  expect(w.rebuilt).toEqual([])
})

it('keeps the historical turn cut after the current piece has closed', () => {
  const w = world()
  w.store.append(
    'alpha',
    w.store.nextOrdinal('alpha'),
    { type: 'user_turn', text: 'Fictional completed work', drives: 'alpha-child' },
    2,
  )
  w.store.append('alpha', w.store.nextOrdinal('alpha'), { type: 'status', state: 'idle' }, 3)
  w.store.append(
    'alpha',
    w.store.nextOrdinal('alpha'),
    { type: 'work_closed', piece: 'alpha-child', by: 'beta' },
    4,
  )
  const cut = w.read({ kind: 'incidents' })
  if (cut.kind !== 'incidents') throw new Error('Expected incidents')
  const owner = cut.owners.find((one) => one.sessionId === 'alpha')!
  expect(owner.history.driven).toEqual({ value: ['alpha-child'] })
  expect(owner.history.states).toContainEqual(['alpha-child', 'closed'])
})

it('keeps the failure of driven work through an unrelated turn, a close, and recorded reopen', () => {
  const { store, file } = world()
  const terminalError = {
    type: 'turn',
    state: 'failed',
    providerFailure: { message: 'The provider could not use this model.', code: 'modelNotFound' },
  } as const
  const append = (event: TranscriptEvent) => {
    const ordinal = store.nextOrdinal('alpha')
    store.append('alpha', ordinal, event, ordinal + 1)
    return ordinal
  }
  const read = (piece: string) => store.piecesOwnedBy('alpha').find((one) => one.piece === piece)
  const first = 'alpha-child'
  const second = 'alpha-second'
  const root = store.rootOf('alpha')!
  append({
    type: 'work_given',
    piece: second,
    parent: root.piece,
    label: `${root.label}.2`,
    title: 'Unrelated work',
    brief: 'Read the next chapter',
    givenBy: 'beta',
  })
  append({ type: 'user_turn', text: 'Work on the first piece', drives: first })
  const failedAt = append(terminalError)
  const diagnosis = { turnOrdinal: failedAt, ...terminalError.providerFailure }
  expect(read(first)).toMatchObject({
    owner: 'alpha',
    giver: 'alpha',
    providerTurnFailure: diagnosis,
  })
  expect(read(second)).toMatchObject({ owner: 'alpha', giver: 'beta' })
  expect(read(second)).not.toHaveProperty('providerTurnFailure')
  expect(store.piecesOwnedBy('beta')[0]).toMatchObject({ owner: 'beta', giver: 'alpha' })
  expect(store.piecesOwnedBy('beta')[0]).not.toHaveProperty('providerTurnFailure')

  append({
    type: 'message_queued',
    messageId: 'retry-first',
    kind: 'work',
    text: 'Retry the first piece',
    drives: first,
  })
  append({ type: 'user_turn', text: 'Work on the second piece', drives: second })
  append({ type: 'assistant_message', text: 'I checked the chapter.' })
  append({ type: 'turn', state: 'completed' })
  expect(read(first)?.providerTurnFailure).toEqual(diagnosis)

  append({ type: 'status', state: 'ended' })
  expect(read(first)?.providerTurnFailure).toEqual(diagnosis)
  append({ type: 'reopened' })
  const reopened = openDatabase(file)
  cleanup.push(() => {
    reopened.close()
  })
  expect(createSessionStore(reopened).piecesOwnedBy('alpha')).toEqual(store.piecesOwnedBy('alpha'))

  append({ type: 'message_unqueued', messageId: 'retry-first', reason: 'sent', text: 'Retry' })
  append({ type: 'user_turn', text: 'Retry the first piece', drives: first })
  append({ type: 'status', state: 'working' })
  append({ type: 'assistant_message', text: 'I started it again.' })
  expect(read(first)?.providerTurnFailure).toEqual(diagnosis)
  append({ type: 'turn', state: 'interrupted' })
  expect(read(first)?.providerTurnFailure).toEqual(diagnosis)

  append({ type: 'user_turn', text: 'Try it again', drives: first })
  const failedAgain = append(terminalError)
  expect(read(first)?.providerTurnFailure).toEqual({ ...diagnosis, turnOrdinal: failedAgain })
  append({ type: 'user_turn', text: 'Retry once more', drives: first })
  append({ type: 'work_interrupted', by: 'a-person' })
  append({ type: 'turn', state: 'completed' })
  expect(read(first)?.providerTurnFailure).toEqual({ ...diagnosis, turnOrdinal: failedAgain })

  append({ type: 'user_turn', text: 'Finish the first piece', drives: first })
  append({ type: 'turn', state: 'completed' })
  expect(read(first)?.piece).toBe(first)
  expect(read(first)).not.toHaveProperty('providerTurnFailure')

  append({ type: 'user_turn', text: 'Try both pieces' })
  const sharedFailure = append(terminalError)
  expect(read(first)?.providerTurnFailure?.turnOrdinal).toBe(sharedFailure)
  expect(read(second)?.providerTurnFailure?.turnOrdinal).toBe(sharedFailure)
  append({ type: 'work_closed', piece: second, by: 'beta' })
  expect(read(second)).toMatchObject({ state: 'closed', owner: 'alpha', giver: 'beta' })
  expect(read(second)).not.toHaveProperty('providerTurnFailure')
  expect(read(first)?.providerTurnFailure?.turnOrdinal).toBe(sharedFailure)
})

it('bounds only the copied provider reason on the turn and reads old or malformed rows normally', () => {
  const { store } = world()
  const message = `${'x'.repeat(4094)}🛠 long provider details`
  const diagnostic = { type: 'error', message, fatal: false } as const
  store.append('alpha', 1, { type: 'user_turn', text: 'Retry' }, 2)
  store.append('alpha', 2, diagnostic, 3)
  store.append(
    'alpha',
    3,
    { type: 'turn', state: 'failed', providerFailure: { message, code: 'x'.repeat(201) } },
    4,
  )
  store.append('alpha', 4, { type: 'turn', state: 'failed' }, 5)
  const malformed = { type: 'turn', state: 'failed', providerFailure: null }
  store.append('alpha', 5, malformed as unknown as TranscriptEvent, 6)

  const bounded = `${'x'.repeat(4094)}…`
  expect(
    store
      .events('alpha')
      .slice(2)
      .map(({ event }) => event),
  ).toEqual([
    diagnostic,
    { type: 'turn', state: 'failed', providerFailure: { message: bounded } },
    { type: 'turn', state: 'failed' },
    { type: 'turn', state: 'failed' },
  ])
  expect(store.piecesOwnedBy('alpha')[0]?.providerTurnFailure).toEqual({
    turnOrdinal: 3,
    message: bounded,
  })
})
