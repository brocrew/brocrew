import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import { LimitsMaterialization } from '../src/main/db/bounded-limits-statements'
import { LIMITS_READ_BOUNDS, type LimitsReadInput } from '../src/main/db/limits-read-protocol'
import {
  foldProviderLimits,
  wallsFromUsage,
  PHRASES,
  PROVIDER_WALL_LOOKBACK_MS,
} from '../src/shared/provider-limit'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const NOW = Date.UTC(2026, 9, 8, 22)
const UNKNOWN = 'claude is rate-limited (five_hour)'

describe('limits worker reads fresh bounded canonical snapshots', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let file: string
  let ordinal: number
  const readers: LimitsReadEngine[] = []

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-limits-worker-'))
    file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, migrations)
    store = createSessionStore(db, () => NOW)
    ordinal = 0
    for (const id of ['alpha', 'beta'])
      store.create({
        id,
        provider: 'claude',
        cwd: directory,
        approvalMode: 'ask',
        profileId: 'agent',
      })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const reader of readers.splice(0)) reader.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function row(
    owner: string,
    type: string,
    payload: object | string,
    at = NOW - 1000,
    generation = 0,
  ) {
    const n = ordinal++
    db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

  function input(overrides: Partial<LimitsReadInput> = {}): LimitsReadInput {
    return {
      operation: 1,
      databaseEpoch: 2,
      signInEpoch: 3,
      capturedAt: NOW - 10,
      signInChangedAt: {},
      usage: {},
      ...overrides,
    }
  }

  function reader() {
    const engine = new LimitsReadEngine(file, () => NOW)
    readers.push(engine)
    return engine
  }

  it('preserves exact canonical coverage, generations, torn rows and usage composition', () => {
    row('alpha', 'error', { message: UNKNOWN })
    row('beta', 'error', `{"message":"${UNKNOWN}"`, NOW - 800, 4)
    row(
      'beta',
      'error',
      { message: 'codex is approaching its rate limit — 97% of a 7-day window used' },
      NOW - 500,
      3,
    )
    row('alpha', 'provider_limit_clear', '{', NOW - 400)
    const wanted = input({
      usage: { claude: [{ window: 'seven_day', usedPercent: 91, resetsAt: null, at: NOW - 20 }] },
    })
    const expected = store.providerLimitsSeen(NOW)
    expect(expected.rows).toHaveLength(2)
    expect(expected.rowsUnread).toBe(2)
    const actual = reader().read(wanted)
    expect(actual.canonical).toEqual(expected)
    const near = wallsFromUsage(wanted.usage, expected.rows, NOW)
    expect(actual.display).toEqual(
      near.length === 0
        ? expected
        : {
            ...expected,
            rows: foldProviderLimits([...expected.rows, ...near], [], NOW),
          },
    )
    expect(actual.measured.rows).toBeGreaterThan(0)
    expect(actual.measured.statements).toBeGreaterThan(1)
    expect(actual.inputCapturedAt).toBe(NOW - 10)
    expect(actual.evaluatedAt).toBe(NOW)
  })

  it('the worker keeps an account wall when another account completes and clears', () => {
    row('alpha', 'error', { message: UNKNOWN }, NOW - 900)
    store.append('beta', 100, { type: 'user_turn', text: 'fictional work' }, NOW - 600)
    store.append('beta', 101, { type: 'turn', state: 'completed' }, NOW - 500)
    row('beta', 'provider_limit_clear', { window: 'five_hour' }, NOW - 300)
    const accountLives = [
      { sessionId: 'alpha', since: NOW - 1000, account: 'fern-account' },
      { sessionId: 'beta', since: NOW - 1000, account: 'willow-account' },
    ]
    const engine = reader()
    expect(engine.read(input({ accountLives })).canonical.rows).toContainEqual(
      expect.objectContaining({ account: 'fern-account', standing: 'stopped' }),
    )
    expect(
      engine.read(
        input({
          operation: 2,
          accountLives: accountLives.map((life) => ({ ...life, account: 'fern-account' })),
        }),
      ).canonical.rows,
    ).toEqual([])
    expect(engine.read(input({ operation: 3 })).canonical.rows).toEqual([])
  })

  it('rejects an oversized identity snapshot before starting a native read', () => {
    const engine = reader()
    const prepare = vi.spyOn(Database.prototype, 'prepare')
    expect(() =>
      engine.read(
        input({
          accountLives: Array.from({ length: LIMITS_READ_BOUNDS.rows + 1 }, () => ({
            sessionId: 'alpha',
            since: NOW,
            account: null,
          })),
        }),
      ),
    ).toThrow()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('the worker groups once without life queries for same-account relaunches', () => {
    row('alpha', 'error', { message: UNKNOWN }, NOW - 900)
    store.append('beta', 100, { type: 'user_turn', text: 'fictional work' }, NOW - 600)
    store.append('beta', 101, { type: 'turn', state: 'completed' }, NOW - 500)
    const engine = reader()
    const connection = (engine as unknown as { db: AppDatabase }).db
    const prepare = connection.prepare.bind(connection)
    const calls: string[] = []
    vi.spyOn(connection, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      const all = statement.all.bind(statement)
      vi.spyOn(statement, 'all').mockImplementation((...args: unknown[]) => {
        calls.push(sql)
        return all(...args)
      })
      const iterate = statement.iterate.bind(statement)
      vi.spyOn(statement, 'iterate').mockImplementation((...args: unknown[]) => {
        calls.push(sql)
        return iterate(...args)
      })
      return statement
    })
    const accountLives = [
      { sessionId: 'alpha', since: NOW - 1000, account: 'fern-account' },
      { sessionId: 'beta', since: NOW - 1000, account: 'willow-account' },
      { sessionId: 'beta', since: NOW - 800, account: 'willow-account' },
      { sessionId: 'beta', since: NOW - 700, account: 'willow-account' },
    ]
    expect(engine.read(input({ accountLives })).canonical.rows).toHaveLength(1)
    expect(calls.filter((sql) => /FROM turn\s+t\b/.test(sql))).toHaveLength(1)
    expect(calls.some((sql) => sql.includes('json_each'))).toBe(false)
  })

  it.each(['turn', 'clear'] as const)(
    'the worker retains an earlier account’s %s across a conversation changing accounts',
    (kind) => {
      row('alpha', 'error', { message: UNKNOWN }, NOW - 900)
      for (const [index, at] of [NOW - 600, NOW - 200].entries()) {
        if (kind === 'clear') row('beta', 'provider_limit_clear', { window: 'five_hour' }, at)
        else {
          store.append(
            'beta',
            100 + index * 2,
            { type: 'user_turn', text: 'fictional work' },
            at - 1,
          )
          store.append('beta', 101 + index * 2, { type: 'turn', state: 'completed' }, at)
        }
      }
      expect(
        reader().read(
          input({
            accountLives: [
              { sessionId: 'alpha', since: NOW - 1000, account: 'fern-account' },
              { sessionId: 'beta', since: NOW - 1000, account: 'fern-account' },
              { sessionId: 'beta', since: NOW - 400, account: 'willow-account' },
            ],
          }),
        ).canonical.rows,
      ).toEqual([])
    },
  )

  it('applies the launch/sign-in cutoff exactly through the canonical reader', () => {
    row('alpha', 'launched', {}, NOW - 900)
    row('alpha', 'error', { message: UNKNOWN }, NOW - 100)
    row('beta', 'launched', {}, NOW - 200)
    row('beta', 'error', { message: UNKNOWN }, NOW - 50)
    const wanted = input({ signInChangedAt: { claude: NOW - 500 } })
    const expected = store.providerLimitsSeen(NOW, new Map([['claude', NOW - 500]]))
    expect(expected.ledgers).toBe(2)
    expect(expected.rows).toHaveLength(1)
    expect(reader().read(wanted).canonical).toEqual(expected)
  })

  it('sees an external same-bound rewrite and its clear on the next read', () => {
    row('alpha', 'error', { message: UNKNOWN })
    const engine = reader()
    expect(engine.read(input()).canonical.rows).toHaveLength(1)
    db.prepare("UPDATE events SET payload = ? WHERE type = 'error'").run(
      JSON.stringify({ message: 'an unrelated failure' }),
    )
    expect(engine.read(input({ operation: 2 })).canonical.rows).toEqual([])
    row('alpha', 'error', { message: UNKNOWN }, NOW - 50)
    row(
      'alpha',
      'provider_limit_clear',
      { type: 'provider_limit_clear', window: 'five_hour' },
      NOW - 1,
    )
    expect(engine.read(input({ operation: 3 })).canonical).toEqual(store.providerLimitsSeen(NOW))
    expect(engine.read(input({ operation: 4 })).canonical.rows).toEqual([])
  })

  it('brackets first access without claiming the pin-completion clock includes later commits', () => {
    let clock = NOW
    const engine = new LimitsReadEngine(file, () => ++clock)
    readers.push(engine)
    const original = Database.prototype.prepare
    let pinned = false
    vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
      this: Database.Database,
      sql: string,
    ) {
      const statement = original.call(this, sql)
      if (sql !== "SELECT rootpage FROM sqlite_schema WHERE name = 'events'") return statement
      return new Proxy(statement, {
        get(target, key) {
          if (key === 'get')
            return (...args: unknown[]) => {
              row('alpha', 'error', { message: UNKNOWN }, NOW - 50)
              const answer = (target.get as (...parameters: unknown[]) => unknown).apply(
                target,
                args,
              )
              pinned = true
              row(
                'beta',
                'error',
                { message: 'codex is approaching its rate limit — 97% of a 7-day window used' },
                NOW - 40,
              )
              return answer
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    } as typeof original)
    const actual = engine.read(input({ capturedAt: NOW - 100 }))
    expect(pinned).toBe(true)
    expect(actual.inputCapturedAt).toBe(NOW - 100)
    expect(actual.snapshotPinStartedAt).toBeLessThan(actual.snapshotPinnedAt)
    expect(actual.snapshotPinnedAt).toBeLessThan(actual.evaluatedAt)
    expect(actual.canonical.rows.map((wall) => wall.provider)).toEqual(['claude'])
    expect(
      store
        .providerLimitsSeen(clock)
        .rows.map((wall) => wall.provider)
        .sort(),
    ).toEqual(['claude', 'codex'])
  })

  it('returns an honestly complete empty reading', () => {
    const actual = reader().read(input())
    expect(actual.canonical).toEqual({
      walk: 'every-provider-wall-recently-recorded',
      rows: [],
      ledgers: 0,
      rowsUnread: 0,
    })
    expect(actual.display).toEqual(actual.canonical)
  })

  it.each(['unknown', 'later-finite'] as const)(
    'reveals the older %s wall after a finite winner expires, then applies a global clear',
    (older) => {
      let clock = NOW
      const olderReset = older === 'unknown' ? null : NOW + 3000
      row(
        'alpha',
        'error',
        {
          message:
            UNKNOWN + (olderReset === null ? '' : `; resets ${new Date(olderReset).toISOString()}`),
        },
        NOW - 500,
      )
      row(
        'beta',
        'error',
        { message: `${UNKNOWN}; resets ${new Date(NOW + 1000).toISOString()}` },
        NOW - 100,
      )
      const engine = new LimitsReadEngine(file, () => clock)
      readers.push(engine)
      const first = engine.read(input())
      expect(first.canonical).toEqual(store.providerLimitsSeen(clock))
      expect(first.canonical.rows).toHaveLength(1)
      expect(first.canonical.rows[0]!.resetsAt).toBe(NOW + 1000)

      clock = NOW + 1001
      const next = engine.read(input({ operation: 2, capturedAt: clock }))
      expect(next.canonical).toEqual(store.providerLimitsSeen(clock))
      expect(next.canonical.rows).toHaveLength(1)
      expect(next.canonical.rows[0]!.resetsAt).toBe(olderReset)

      row(
        'beta',
        'provider_limit_clear',
        { type: 'provider_limit_clear', window: 'five_hour' },
        clock,
      )
      const cleared = engine.read(input({ operation: 3, capturedAt: clock }))
      expect(cleared.canonical).toEqual(store.providerLimitsSeen(clock))
      expect(cleared.canonical.rows).toEqual([])
      expect(cleared.canonical.rowsUnread).toBe(0)
    },
  )

  it('rejects one oversized raw payload before any JSON parse', () => {
    row('alpha', 'error', { message: UNKNOWN, padding: 'x'.repeat(LIMITS_READ_BOUNDS.cellBytes) })
    const engine = reader()
    const parse = vi.spyOn(JSON, 'parse')
    expect(() => engine.read(input())).toThrowError(/overflow/)
    expect(parse).not.toHaveBeenCalled()
    db.prepare("DELETE FROM events WHERE type = 'error'").run()
    expect(engine.read(input({ operation: 2 })).canonical.rows).toEqual([])
  })

  it.each(['rows', 'bytes'] as const)(
    'rejects excessive raw %s before JSON/aggregation materialization',
    (kind) => {
      row('alpha', 'error', { message: UNKNOWN })
      row('beta', 'error', { message: UNKNOWN })
      const engine = new LimitsReadEngine(file, () => NOW, {
        rows: kind === 'rows' ? 1 : 100,
        bytes: kind === 'bytes' ? 10 : 1024,
        cellBytes: 1024,
      })
      readers.push(engine)
      const parse = vi.spyOn(JSON, 'parse')
      expect(() => engine.read(input())).toThrowError(/overflow/)
      expect(parse).not.toHaveBeenCalled()
    },
  )

  it('keeps the actual canonical error/date index through guarding and appends', () => {
    row('alpha', 'error', { message: UNKNOWN })
    const prepared: string[] = []
    const original = Database.prototype.prepare
    vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
      this: AppDatabase,
      sql: string,
    ) {
      prepared.push(sql)
      return original.call(this, sql)
    })
    const engine = reader()
    expect(engine.read(input()).canonical.rows).toHaveLength(1)
    const guarded = prepared.find(
      (sql) => sql.includes('AS __limits_wide FROM (') && sql.includes('payload LIKE ?'),
    )
    expect(guarded).toBeDefined()
    if (guarded === undefined)
      throw new Error('the native worker did not execute the guarded canonical candidate read')
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${guarded}`)
      .all(NOW - PROVIDER_WALL_LOOKBACK_MS, ...PHRASES.map((one) => `%${one.phrase}%`)) as {
      detail: string
    }[]
    expect(
      plan.some(({ detail }) => /SEARCH events USING INDEX events_error_idx/.test(detail)),
    ).toBe(true)
    row('alpha', 'assistant_delta', { text: 'fictional streamed words' }, NOW - 1)
    expect(engine.read(input({ operation: 2 })).canonical).toEqual(store.providerLimitsSeen(NOW))
    expect(
      prepared.filter(
        (sql) =>
          sql.startsWith('SELECT ') &&
          sql.includes('AS __limits_wide FROM (') &&
          sql.includes('payload LIKE ?'),
      ),
    ).toHaveLength(2)
  })

  it('keeps a budget failure fatal even if a canonical caller catches it', () => {
    const budget = new LimitsMaterialization({ rows: 1, bytes: 1024, cellBytes: 128 })
    const bounded = budget.database(db)
    expect(() => bounded.prepare('SELECT id FROM provider_session ORDER BY id').all()).toThrowError(
      /overflow/,
    )
    expect(() => budget.assert()).toThrowError(/overflow/)
    expect(() => bounded.prepare('SELECT 1 AS one').get()).toThrowError(/overflow/)
  })

  it('uses a byte budget and a SQL cell guard before yielding strings', () => {
    const cell = new LimitsMaterialization({ rows: 10, bytes: 1024, cellBytes: 3 })
    expect(() => cell.database(db).prepare("SELECT 'abcdef' AS payload").all()).toThrowError(
      /overflow/,
    )
    const bytes = new LimitsMaterialization({ rows: 10, bytes: 20, cellBytes: 100 })
    expect(() => bytes.database(db).prepare("SELECT 'abcdef' AS payload").all()).toThrowError(
      /overflow/,
    )
  })

  it('refuses writes and releases native iterators after a bounded failure', () => {
    const budget = new LimitsMaterialization({ rows: 1, bytes: 1024, cellBytes: 128 })
    const bounded = budget.database(db)
    expect(() => bounded.prepare('DELETE FROM events').run()).toThrowError(/failed/)
    expect(() => bounded.prepare('SELECT id FROM provider_session').all()).toThrowError(/overflow/)
    expect(db.inTransaction).toBe(false)
    expect(() => db.prepare('SELECT 1').get()).not.toThrow()
  })
})
