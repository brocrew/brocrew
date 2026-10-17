import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { withOptionalIndexes } from '../src/main/db/optional-indexes'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { slowWindowQueries } from './fixtures/slow-window-queries'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let directory: string
let file: string
let db: AppDatabase
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'brobot-optional-indexes-'))
  file = join(directory, 'fixture.sqlite')
  db = openDatabase(file)
  applyMigrations(db, migrations)
})
afterEach(() => {
  vi.restoreAllMocks()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it('a missing or incompatible hint falls back; SQL errors remain errors', () => {
  const safe = withOptionalIndexes(db)
  expect(safe.prepare('SELECT type FROM events INDEXED BY missing_index').all()).toEqual([])
  expect(
    safe.prepare("SELECT type FROM events INDEXED BY events_error_idx WHERE type = 'text'").all(),
  ).toEqual([])
  expect(() =>
    safe.prepare('SELECT no_such_column FROM events INDEXED BY events_error_idx'),
  ).toThrow(/no such column/)
})

it('a worker never sends a hint to SQLite, even when that index exists', () => {
  const read = new Database(file, { readonly: true })
  const statements: string[] = []
  const wrapped = new Proxy(read, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          statements.push(sql)
          return target.prepare(sql)
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  try {
    expect(
      withOptionalIndexes(wrapped)
        .prepare("SELECT payload FROM events INDEXED BY events_error_idx WHERE type = 'error'")
        .all(),
    ).toEqual([])
    expect(statements).toEqual(["SELECT payload FROM events WHERE type = 'error'"])
  } finally {
    read.close()
  }
})

it('window and limits canonical answers survive removal of every optional read index', () => {
  const now = Date.now()
  const store = createSessionStore(db)
  store.create({
    id: 'owner',
    provider: 'claude',
    cwd: directory,
    approvalMode: 'ask',
    profileId: 'fixture',
  })
  db.prepare(
    `INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
    VALUES ('wall','owner',0,0,'error',?,?)`,
  ).run(JSON.stringify({ message: 'claude is rate-limited (five_hour)' }), now)
  const limits = {
    operation: 1,
    databaseEpoch: 1,
    signInEpoch: 1,
    capturedAt: now,
    signInChangedAt: {},
    usage: {},
  }
  const routes = { kind: 'routes' as const }
  const prepare = Database.prototype.prepare
  const workerQueries: string[] = []
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
    this: Database.Database,
    sql: string,
  ) {
    if (this.readonly) workerQueries.push(sql)
    return prepare.call(this, sql)
  })
  const firstWindow = new WindowReadEngine(file)
  const firstLimits = new LimitsReadEngine(file, () => now)
  let expectedWindow: unknown
  let expectedLimits: unknown
  try {
    expectedWindow = firstWindow.read(routes)
    expectedLimits = firstLimits.read(limits).canonical
  } finally {
    firstWindow.close()
    firstLimits.close()
  }
  expect(workerQueries.length).toBeGreaterThan(50)
  expect(workerQueries.every((sql) => !/\bINDEXED\s+BY\b/i.test(sql))).toBe(true)
  for (const sql of workerQueries.filter(
    (sql) =>
      sql.includes('likelihood') &&
      /MAX\(e.created_at\)|SELECT e.session_id|payload LIKE|count\(\*\) AS rows/.test(sql),
  )) {
    const named = [...new Set([...sql.matchAll(/@([A-Za-z_]\w*)/g)].map((one) => one[1]))]
    const values: unknown[] = (sql.match(/\?/g) ?? []).map(() => 1)
    if (named.length > 0) values.push(Object.fromEntries(named.map((name) => [name, 1])))
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...values) as { detail: string }[]
    const details = plan.map((row) => row.detail).join('\n')
    if (sql.includes("type = 'error'")) expect(details).toContain('events_error_idx')
    if (sql.includes("type = 'provider_limit_clear'"))
      expect(details).toContain('events_provider_clear_idx')
  }
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL AND tbl_name IN ('events','provider_session','work_resource')",
    )
    .all() as { name: string }[]
  expect(indexes.length).toBeGreaterThan(10)
  for (const { name } of indexes) db.exec(`DROP INDEX "${name.replaceAll('"', '""')}"`)
  const workerWindow = new WindowReadEngine(file)
  const workerLimits = new LimitsReadEngine(file, () => now)
  try {
    expect(workerWindow.read(routes)).toEqual(expectedWindow)
    expect(workerLimits.read(limits).canonical).toEqual(expectedLimits)
    expect(createSessionStore(db).providerLimitsSeen(now)).toEqual(expectedLimits)
  } finally {
    workerWindow.close()
    workerLimits.close()
  }
})

it('the native delay remains valid after a FROM with an index hint', () => {
  const restore = slowWindowQueries(() => {}, 2)
  try {
    expect(
      db
        .prepare(
          "SELECT payload FROM events INDEXED BY events_error_idx WHERE type='error' AND payload LIKE ?",
        )
        .all('%limit%'),
    ).toEqual([])
  } finally {
    restore()
  }
})

for (const method of ['get', 'all', 'iterate'] as const)
  it(`recompiles ${method} without a hint when its index disappears`, () => {
    const read = withOptionalIndexes(db).prepare(
      "SELECT type FROM events INDEXED BY events_error_idx WHERE type = 'error'",
    )
    db.exec('DROP INDEX events_error_idx')
    expect(method === 'iterate' ? [...read.iterate()] : read[method]()).toEqual(
      method === 'get' ? undefined : [],
    )
  })

it.runIf(process.env['W699_LIMIT_BENCH'] !== undefined)(
  'measures limit walls beside 100000 old errors and clears',
  () => {
    const now = Date.now()
    const store = createSessionStore(db)
    store.create({
      id: 'owner',
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fixture',
    })
    db.exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n < 100000)
    INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    SELECT 'old-'||n,'owner',0,n,CASE WHEN n%2=0 THEN 'error' ELSE 'provider_limit_clear' END,
      CASE WHEN n%2=0 THEN '{"message":"claude is rate-limited (five_hour)"}' ELSE '{"window":"five_hour"}' END,1 FROM seq`)
    db.prepare(
      `INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    VALUES ('wall','owner',0,100001,'error','{"message":"claude is rate-limited (five_hour)"}',?)`,
    ).run(now)
    const reader = new LimitsReadEngine(file, () => now)
    try {
      const input = {
        operation: 1,
        databaseEpoch: 1,
        signInEpoch: 1,
        capturedAt: now,
        signInChangedAt: {},
        usage: {},
      }
      const expected = store.providerLimitsSeen(now)
      expect(expected.rows).toHaveLength(1)
      const main: number[] = [],
        worker: number[] = []
      for (let i = 0; i < 10; i++) {
        let start = performance.now()
        expect(store.providerLimitsSeen(now)).toEqual(expected)
        main.push(performance.now() - start)
        start = performance.now()
        expect(reader.read(input).canonical).toEqual(expected)
        worker.push(performance.now() - start)
      }
      const result = {
        mode: process.env['W699_LIMIT_BENCH'],
        events: 100001,
        main,
        worker,
        mainMax: Math.max(...main),
        workerMax: Math.max(...worker),
      }
      console.log('Limit benchmark:', JSON.stringify(result))
      if (process.env['W699_BENCH_OUTPUT'])
        writeFileSync(process.env['W699_BENCH_OUTPUT'], JSON.stringify(result, null, 2))
    } finally {
      reader.close()
    }
  },
  60000,
)
