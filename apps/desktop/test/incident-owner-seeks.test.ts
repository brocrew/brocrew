import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import type { TranscriptEvent } from '../src/shared/conversation-events'

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) close()
})

function world() {
  const directory = mkdtempSync(join(tmpdir(), 'incident-seeks-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  cleanup.push(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  for (const id of ['person', 'agent', 'ended']) {
    store.create({ id, provider: 'codex', profileId: id, cwd: directory, approvalMode: 'ask' })
    store.ensurePersonalRoot(id, 1)
  }
  const append = (owner: string, event: TranscriptEvent, at: number) =>
    store.append(owner, store.nextOrdinal(owner), event, at)
  return { db, file, store, append }
}

it('reads person history only for a person Stop and still includes ended owners and recovery facts', () => {
  const w = world()
  for (const owner of ['person', 'agent', 'ended'])
    w.append(owner, { type: 'user_turn', text: 'Fictional words', humanInitiated: true }, 10)
  w.append('person', { type: 'work_interrupted', by: 'a-person' }, 20)
  w.append('agent', { type: 'work_interrupted', by: 'an-agent', agent: 'person' }, 30)
  const root = w.store.rootOf('ended')!
  const turn = w.store.theNewestTurn('ended')!
  w.append(
    'ended',
    { type: 'work_recovery', turn, pieces: [root.piece], since: 40, phase: 'failed' },
    40,
  )
  w.db.prepare("UPDATE provider_session SET status = 'ended' WHERE id = ?").run('ended')
  const engine = new WindowReadEngine(w.file)
  cleanup.push(() => engine.close())
  const native = (engine as unknown as { db: AppDatabase }).db
  const prepare = native.prepare.bind(native)
  const personReads: string[] = []
  vi.spyOn(native, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes('created_at AS at') || !sql.includes('LIMIT ?')) return statement
    const iterate = statement.iterate.bind(statement)
    vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
      personReads.push(String(args[0]))
      yield* iterate(...args)
    })
    return statement
  })
  const result = engine.read({ kind: 'incidents' })
  if (result.kind !== 'incidents') throw new Error('wrong incident reading')
  expect(result.owners.map((one) => one.sessionId)).toEqual(w.store.reconciliationOwners())
  expect(personReads).toEqual(['person'])
  expect(result.owners.find((one) => one.sessionId === 'person')?.history.lastPerson).toEqual({
    value: 10,
  })
  expect(result.owners.find((one) => one.sessionId === 'ended')?.history.recovery).toEqual({
    value: { type: 'work_recovery', turn, pieces: [root.piece], since: 40, phase: 'failed' },
  })
})

it('seeks the owned active-generation opening through its existing composite index', () => {
  const w = world()
  const event = { type: 'user_turn', text: 'Exact\r\nopening.', humanInitiated: true } as const
  w.append('person', event, 10)
  const turn = w.store.theNewestTurn('person')!
  const queries: { sql: string; args: unknown[] }[] = []
  const prepare = w.db.prepare.bind(w.db)
  vi.spyOn(w.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes("type = 'user_turn'") || !sql.includes('ORDER BY ordinal LIMIT 1'))
      return statement
    const get = statement.get.bind(statement)
    vi.spyOn(statement, 'get').mockImplementation((...args) => {
      queries.push({ sql, args })
      return get(...args)
    })
    return statement
  })
  const observed = createSessionStore(w.db)
  expect(observed.recordedTurnOpening('person', turn)).toEqual(event)
  expect(observed.recordedTurnOpening('agent', turn)).toBeNull()
  expect(queries).toHaveLength(1)
  const query = queries[0]!
  const plan = prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args) as { detail: string }[]
  expect(plan.map((one) => one.detail).join('\n')).toContain(
    'events_turn_opening_idx (session_id=? AND generation=? AND turn_id=?)',
  )
})

it('seeks both Stop kinds without walking other fold rows and retains torn-after-newest evidence', () => {
  const w = world()
  w.append('person', { type: 'user_turn', text: 'Fictional', humanInitiated: true }, 10)
  w.append('person', { type: 'work_interrupted', by: 'an-agent', agent: 'agent' }, 20)
  w.append(
    'person',
    {
      type: 'user_decision',
      requestId: 'fictional-cancel',
      outcome: 'cancel',
      by: { who: 'a-person' },
    },
    30,
  )
  const torn = w.store.nextOrdinal('person')
  w.db
    .prepare(
      'INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,?,?,?,?,?,0)',
    )
    .run('fictional-torn-stop', 'person', torn, 'work_interrupted', '{', 40)
  const queries: { sql: string; args: unknown[] }[] = []
  const prepare = w.db.prepare.bind(w.db)
  vi.spyOn(w.db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes('$.stopsNothing')) return statement
    const get = statement.get.bind(statement)
    vi.spyOn(statement, 'get').mockImplementation((...args) => {
      queries.push({ sql, args })
      return get(...args)
    })
    return statement
  })
  const observed = createSessionStore(w.db)
  const unread = rowsUnreadOnce()
  expect(observed.lastAskToStop('person', unread)).toMatchObject({ by: 'a-person', at: 30 })
  expect(unread.count).toBe(1)
  expect(unread.ledgersSkipped).toBe(0)
  expect(observed.lastAskToStop('agent')).toBeNull()
  expect(queries).toHaveLength(2)
  const query = queries[0]!
  const plan = prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args) as {
    detail: string
  }[]
  const searches = plan.map((one) => one.detail).filter((one) => one.includes('SEARCH events'))
  expect(searches).toHaveLength(2)
  expect(searches.every((one) => one.includes('events_kind_owner_idx'))).toBe(true)
})
