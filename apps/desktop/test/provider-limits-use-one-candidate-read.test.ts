import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { MainThreadWork } from '../src/main/stall-watch'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const wall = 'claude is rate-limited (five_hour)'
const now = 2_000_000

describe('provider limits use one candidate read', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let calls: string[]
  let inputs: { sql: string; args: unknown[] }[]
  let work: MainThreadWork
  let ordinal: number

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-one-wall-read-'))
    db = openDatabase(':memory:')
    applyMigrations(db, migrations)
    calls = []
    inputs = []
    let clock = 0
    work = new MainThreadWork(() => clock++)
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      for (const name of ['get', 'all'] as const) {
        const read = statement[name].bind(statement)
        vi.spyOn(statement, name).mockImplementation((...args: unknown[]) => {
          calls.push(sql)
          inputs.push({ sql, args })
          return read(...args)
        })
      }
      return statement
    })
    store = createSessionStore(db, () => 1, work)
    work.clear()
    ordinal = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function conversation(id: string): string {
    store.create({
      id,
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'agent',
    })
    return id
  }

  function row(
    owner: string,
    payload: object | string,
    at = now - 1_000,
    generation = 0,
    type = 'error',
  ) {
    const n = ordinal++
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `fixture-${n}`,
      owner,
      generation,
      n,
      type,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      at,
    )
  }

  const candidateReads = () => calls.filter((sql) => sql.includes('payload LIKE ?'))

  it('same-account relaunches after a standing wall do not re-query conversation turns', () => {
    const first = conversation('fern-relaunch')
    row(first, { message: wall }, now - 1000)
    const accountLives = [{ sessionId: first, since: 0, account: 'fern-account' }]
    for (let n = 0; n < 20; n++) {
      const id = conversation(`willow-relaunch-${n}`)
      accountLives.push({ sessionId: id, since: 0, account: 'willow-account' })
      for (let life = 1; life <= 3; life++)
        accountLives.push({ sessionId: id, since: now - 900 + life, account: 'willow-account' })
      store.append(id, ordinal++, { type: 'user_turn', text: 'fictional work' }, now - 501)
      store.append(id, ordinal++, { type: 'turn', state: 'completed' }, now - 500)
    }
    expect(store.providerLimitsSeen(now, undefined, accountLives).rows).toHaveLength(1)
    calls.length = 0
    expect(store.providerLimitsSeen(now + 1, undefined, accountLives).rows).toHaveLength(1)
    expect(calls.filter((sql) => /FROM turn\s+t\b/.test(sql))).toEqual([])
  })

  it('keeps account retractions between polls and revisits only a session whose turn completed', () => {
    const first = conversation('fern')
    const second = conversation('willow')
    row(first, { message: wall }, now - 1000)
    const accountLives = [
      { sessionId: first, since: 0, account: 'fern-account' },
      { sessionId: second, since: 0, account: 'willow-account' },
    ]
    const complete = (id: string, at: number) => {
      store.append(id, ordinal++, { type: 'user_turn', text: 'fictional work' }, at - 1)
      store.append(id, ordinal++, { type: 'turn', state: 'completed' }, at)
    }
    complete(second, now - 500)
    const before = store.providerLimitsSeen(now, undefined, accountLives)
    expect(before.rows).toHaveLength(1)
    calls.length = 0
    expect(store.providerLimitsSeen(now + 1, undefined, accountLives).rows).toEqual(before.rows)
    expect(calls.filter((sql) => /FROM turn\s+t\b/.test(sql))).toEqual([])
    complete(second, now - 100)
    calls.length = 0
    expect(store.providerLimitsSeen(now + 2, undefined, accountLives).rows).toEqual(before.rows)
    const turnReads = calls.filter((sql) => /FROM turn\s+t\b/.test(sql))
    for (const sql of turnReads) expect(sql).toMatch(/t\.session_id\s*=/)
    const switched = [
      ...accountLives,
      { sessionId: second, since: now - 300, account: 'cedar-account' },
    ]
    calls.length = 0
    expect(store.providerLimitsSeen(now + 2, undefined, switched).rows).toEqual(before.rows)
    const historical = calls.filter((sql) => /FROM turn\s+t\b/.test(sql))
    expect(historical).toHaveLength(1)
    const bound = [...inputs].reverse().find((one) => one.sql === historical[0])!.args[0] as {
      sessionLives: string
    }
    expect(JSON.parse(bound.sessionLives)).toEqual(
      switched.filter((life) => life.sessionId === second),
    )
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${historical[0]!}`).all({
      oldest: now - 1000,
      sessionLives: JSON.stringify(switched.filter((life) => life.sessionId === second)),
      sessionId: second,
    }) as { detail: string }[]
    expect(plan.map((one) => one.detail).join(' ')).toMatch(/SEARCH t USING INDEX turn_session_idx/)
    complete(first, now)
    expect(store.providerLimitsSeen(now + 3, undefined, accountLives).rows).toEqual([])
  })

  it('counts raw candidate ledgers even when every matching row is torn', () => {
    const first = conversation('first')
    const second = conversation('second')
    row(first, `{"message":"${wall}"`)
    row(first, `{"message":"${wall}"`, now - 900, 3)
    row(second, `{"message":"${wall}"`)
    expect(store.providerLimitsSeen(now)).toEqual({
      walk: 'every-provider-wall-recently-recorded',
      ledgers: 2,
      rowsUnread: 3,
      rows: [],
    })
    expect(candidateReads()).toHaveLength(1)
    expect(candidateReads()[0]).not.toContain('count(DISTINCT')
    expect(work.take().some((one) => one.what.endsWith('.read-clears'))).toBe(false)
  })

  it('keeps candidate coverage when readable rows are rejected by parsing or the current account', () => {
    const first = conversation('first')
    const second = conversation('second')
    row(first, { message: `unrecognized provider ${wall}` })
    row(second, { message: wall }, now - 500)
    const answer = store.providerLimitsSeen(now, new Map([['claude', now - 400]]))
    expect(answer).toEqual({
      walk: 'every-provider-wall-recently-recorded',
      ledgers: 2,
      rowsUnread: 0,
      rows: [],
    })
    expect(candidateReads()).toHaveLength(1)
  })

  it('reads launches only once for multiple candidate walls in the same old life', () => {
    const owner = conversation('life')
    row(owner, {}, now - 1_000, 0, 'launched')
    for (let n = 0; n < 10; n++) row(owner, { message: wall }, now - 100 + n, n % 2)
    const answer = store.providerLimitsSeen(now, new Map([['claude', now - 500]]))
    expect(answer).toEqual({
      walk: 'every-provider-wall-recently-recorded',
      ledgers: 1,
      rowsUnread: 0,
      rows: [],
    })
    const phases = work.take()
    expect(phases.find((one) => one.what.endsWith('.read-launches'))?.count).toBe(1)
    expect(candidateReads()).toHaveLength(1)
  })

  it('times native reads, decoding and folding under fixed phase names without row contents', () => {
    const owner = conversation('live')
    row(owner, { message: wall })
    expect(store.providerLimitsSeen(now).rows).toHaveLength(1)
    const phases = work.take()
    for (const name of [
      'read-walls',
      'count-ledgers',
      'decode-walls',
      'retractions',
      'read-torn-clears',
      'read-completed-turns',
      'read-clears',
      'fold-walls',
    ]) {
      expect(phases.find((one) => one.what === `store.providerLimitsSeen.${name}`)).toMatchObject({
        count: 1,
      })
    }
    expect(phases.every((one) => one.ms > 0)).toBe(true)
    expect(JSON.stringify(phases)).not.toContain(wall)
    expect(JSON.stringify(phases)).not.toContain(owner)
    expect(candidateReads()).toHaveLength(1)
  })

  it('keeps the limits with 925000 unrelated rows written since, reading and parsing no wall again', () => {
    const live = conversation('live')
    const noise = conversation('noise')
    row(live, { message: wall })
    row(live, { message: 'claude is rate-limited (seven_day)' }, now - 500, 2)
    const parse = vi.spyOn(JSON, 'parse')
    calls.length = 0
    parse.mockClear()
    const before = store.providerLimitsSeen(now)
    expect(before.rows).toHaveLength(2)
    const decoded = parse.mock.calls.length
    expect(decoded).toBe(2)
    expect(candidateReads()).toHaveLength(1)
    db.prepare(
      `WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < 24999)
      INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT 'fold-' || n, ?, 0, 100 + n, 'status', '{"type":"status","state":"idle"}', ? FROM numbers`,
    ).run(noise, now - 100)
    db.prepare(
      `WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM numbers WHERE n < 899999)
      INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
      SELECT 'noise-' || n, ?, 0, 100000 + n, 'tool_result', '{"type":"tool_result"}', ? FROM numbers`,
    ).run(noise, now - 100)
    calls.length = 0
    parse.mockClear()
    expect(store.providerLimitsSeen(now)).toEqual(before)
    expect(parse.mock.calls.length).toBe(0)
    expect(candidateReads()).toHaveLength(0)
    // A read that is not kept, as one inside a transaction, still parses only the two walls.
    calls.length = 0
    parse.mockClear()
    expect(db.transaction(() => store.providerLimitsSeen(now))()).toEqual(before)
    expect(parse.mock.calls.length).toBe(decoded)
    expect(candidateReads()).toHaveLength(1)
    expect(db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 925002 })
  }, 60_000)
})
