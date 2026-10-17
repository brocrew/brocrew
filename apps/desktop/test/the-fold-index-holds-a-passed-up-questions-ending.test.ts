import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { FOLD_EVENT_TYPES, FOLD_TERM, FOLD_TYPE_LIST } from '../src/main/db/fold-index'
import {
  createSessionStore,
  ROUTED_REQUEST_EVENT_TYPES,
  type SessionStore,
} from '../src/main/db/session-store'
import { listCheckpoints } from '../src/main/recovery/checkpoint'
import { inspect, type CoordinatorDeps } from '../src/main/recovery/coordinator'
import { databaseFile } from '../src/main/recovery/layout'

/**
 * Migration `0009` · **the fold index holds a passed-up question's ending** — it drops and creates
 * `events_fold_idx` with `question_ended_with_its_piece` in its list, so the routed-request fold
 * reads that row through the index. A fresh database; one upgraded from the migration before it,
 * and from the one before that, each holding a row of every kind the index covers; a second run;
 * and the copy the start-up check makes before it.
 */

const real = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
interface Entry {
  readonly idx: number
  readonly tag: string
  readonly when: number
}
const journal = (folder: string): { entries: Entry[] } =>
  JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: Entry[] }
const ALL = journal(real).entries.length
const THIS_ONE = '0009_the_fold_index_ends_passed_up_questions'
/** The migration before it, which adds two indexes of its own and no snapshot. */
const THE_ONE_BEFORE = '0008_work_receipt_reads'
const TWO_BEFORE = '0007_the_mcp_request_index'

/** The migrations folder as it stood at `tag`: every migration after it taken out. */
function upTo(dir: string, tag: string): string {
  const folder = join(dir, `migrations-${tag}`)
  cpSync(real, folder, { recursive: true })
  const kept = journal(folder)
  const at = kept.entries.find((entry) => entry.tag === tag)
  if (at === undefined) throw new Error(`no migration ${tag}`)
  for (const entry of kept.entries.filter((one) => one.idx > at.idx)) {
    rmSync(join(folder, `${entry.tag}.sql`))
    // A migration written by hand has no snapshot.
    const snapshot = join(folder, 'meta', `${entry.tag.slice(0, 4)}_snapshot.json`)
    if (existsSync(snapshot)) rmSync(snapshot)
  }
  kept.entries = kept.entries.filter((entry) => entry.idx <= at.idx)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(kept))
  return folder
}

/** How many migrations a database at `tag` records. */
const countUpTo = (tag: string): number =>
  journal(real).entries.findIndex((entry) => entry.tag === tag) + 1

const theIndex = (db: AppDatabase): string =>
  (
    db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'events_fold_idx'`)
      .get() as { sql: string }
  ).sql

const applied = (db: AppDatabase): number =>
  (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n

const indexes = (db: AppDatabase): string[] =>
  (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`).all() as {
      name: string
    }[]
  ).map((row) => row.name)

describe('0009 · the fold index holds a passed-up question’s ending', () => {
  let dir: string
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-mig0009-'))
    db = openDatabase(join(dir, 'test.sqlite'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** At `tag`, one conversation holding a row of every kind the index covers, and two it does not. */
  function atWithEveryKind(tag: string = THE_ONE_BEFORE): void {
    applyMigrations(db, upTo(dir, tag))
    expect(applied(db)).toBe(countUpTo(tag))
    expect(theIndex(db)).not.toContain('question_ended_with_its_piece')
    db.prepare(
      `INSERT INTO provider_session (id, provider, cwd, created_at, updated_at) VALUES ('A', 'claude', '/tmp', 1, 1)`,
    ).run()
    const insert = db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
       VALUES (?, 'A', ?, ?, ?, 1, NULL, 0)`,
    )
    for (const [ordinal, type] of [
      'assistant_message',
      ...FOLD_EVENT_TYPES,
      'tool_call',
    ].entries()) {
      insert.run(`A-${String(ordinal)}`, ordinal, type, JSON.stringify({ type }))
    }
  }

  const everyRow = (): unknown[] =>
    db.prepare('SELECT * FROM events ORDER BY session_id, generation, ordinal').all()

  it('🔴 it directly follows its predecessor with a later migration timestamp', () => {
    const entries = journal(real).entries
    const at = entries.findIndex((entry) => entry.tag === THIS_ONE)
    expect(at).toBeGreaterThan(0)
    expect(entries.slice(at - 1, at + 1).map((entry) => entry.tag)).toEqual([
      THE_ONE_BEFORE,
      THIS_ONE,
    ])
    expect(entries[at]!.when).toBeGreaterThan(entries[at - 1]!.when)
  })

  it('🔴 a fresh database holds it, in FOLD_EVENT_TYPES’ order', () => {
    applyMigrations(db, real)
    expect(applied(db)).toBe(ALL)
    expect(FOLD_EVENT_TYPES).toContain('question_ended_with_its_piece')
    expect(theIndex(db)).toContain(`IN (${FOLD_TYPE_LIST})`)
  })

  for (const from of [THE_ONE_BEFORE, TWO_BEFORE]) {
    it(`🔴 an upgrade from ${from} keeps every row and index, and the index then holds every kind it covers`, () => {
      atWithEveryKind(from)
      const before = everyRow()
      const beforeIndexes = indexes(db)
      applyMigrations(db, real)
      expect(applied(db)).toBe(ALL)
      expect(everyRow()).toEqual(before)
      expect(indexes(db)).toEqual(
        expect.arrayContaining([
          ...beforeIndexes.filter((name) => !name.includes('raw_frame')),
          'events_kind_owner_idx',
          'events_work_piece_idx',
        ]),
      )
      expect(indexes(db).filter((name) => name.includes('raw_frame'))).toEqual([])
      expect(theIndex(db)).toContain(`IN (${FOLD_TYPE_LIST})`)
      const throughIt = db
        .prepare(
          `SELECT type FROM events INDEXED BY events_fold_idx
            WHERE ${FOLD_TERM} AND session_id = 'A' AND generation = 0 ORDER BY ordinal`,
        )
        .all() as { type: string }[]
      expect(throughIt.map((row) => row.type)).toEqual([...FOLD_EVENT_TYPES])
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  }

  /** The SQL of every statement the store prepares, as it prepares it, and the store. */
  function theStoresStatements(source: AppDatabase = db): {
    readonly prepared: string[]
    readonly store: SessionStore
  } {
    const prepared: string[] = []
    const prepare = source.prepare.bind(source)
    ;(source as unknown as { prepare: typeof source.prepare }).prepare = ((sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }) as typeof source.prepare
    const store = createSessionStore(source, () => 2)
    ;(source as unknown as { prepare: typeof source.prepare }).prepare = prepare
    return { prepared, store }
  }

  it('⛔ no fold read can use the fold index over the migration before it, and every one can over this one', () => {
    atWithEveryKind()
    const current = openDatabase(':memory:')
    let prepared: readonly string[]
    try {
      applyMigrations(current, real)
      prepared = theStoresStatements(current).prepared
    } finally {
      current.close()
    }
    const throughIt = prepared.filter((sql) => sql.includes('INDEXED BY events_fold_idx'))
    expect(throughIt.length).toBeGreaterThan(0)
    // ⚑ The store starts either way: a read whose index SQLite refuses falls back to no index.
    for (const sql of throughIt) expect(() => db.prepare(sql)).toThrow(/no query solution/)
    applyMigrations(db, real)
    for (const sql of throughIt) expect(() => db.prepare(sql)).not.toThrow()
  })

  it('🔴 after the upgrade the routed-request fold reads the ending through its index, and it ends a copy', () => {
    atWithEveryKind()
    applyMigrations(db, real)
    const { prepared, store } = theStoresStatements()
    const routed = prepared.filter((sql) =>
      sql.includes(ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')),
    )
    // The whole fold's read, and the read that carries a kept fold forward.
    expect(routed).toHaveLength(2)
    expect(ROUTED_REQUEST_EVENT_TYPES).toContain('question_ended_with_its_piece')
    for (const sql of routed) {
      // The fold's own term holds the type too, so the routed read does not filter it out.
      expect(sql).toContain(FOLD_TERM)
      const named = /INDEXED BY (\w+)/.exec(sql)?.[1]
      expect(named).toBeDefined()
      expect(() => db.prepare(sql)).not.toThrow()
      const parameters = sql.includes('@after')
        ? { session: 'A', generation: 0, after: 0 }
        : { session: 'A', generation: 0 }
      const plan = (
        db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(parameters) as {
          detail: string
        }[]
      )
        .map((one) => one.detail)
        .filter((detail) => /^(SEARCH|SCAN) events(?: |$)/.test(detail))
      expect(plan.length).toBeGreaterThan(0)
      for (const detail of plan)
        expect(detail).toMatch(new RegExp(`^SEARCH events USING (?:COVERING )?INDEX ${named!} `))
    }

    store.create({
      id: 'B',
      provider: 'claude',
      cwd: '/tmp',
      approvalMode: 'auto',
      profileId: 'pm',
    })
    store.append(
      'B',
      0,
      {
        type: 'question_asked',
        requestId: 'req_copy',
        passedUpFrom: 'req_original',
        prompt: 'Which tone?',
        questions: [{ id: 'answer', prompt: 'Which tone?', options: [] }],
      },
      2,
    )
    store.append('B', 1, { type: 'request_routed', requestId: 'req_copy', to: 'a-person' }, 2)
    expect(store.routedRequestsOf('B').find((one) => one.requestId === 'req_copy')?.state).toBe(
      'open',
    )
    store.append(
      'B',
      2,
      { type: 'question_ended_with_its_piece', requestId: 'req_copy', ending: 'work-closed' },
      2,
    )
    expect(store.routedRequestsOf('B').find((one) => one.requestId === 'req_copy')?.state).toBe(
      'work-closed',
    )
  })

  it('⚑ a second run changes nothing', () => {
    atWithEveryKind()
    applyMigrations(db, real)
    const index = theIndex(db)
    const rows = everyRow()
    expect(() => applyMigrations(db, real)).not.toThrow()
    expect(applied(db)).toBe(ALL)
    expect(theIndex(db)).toBe(index)
    expect(everyRow()).toEqual(rows)
  })
})

describe('0009 · the copy the start-up check makes before it', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-mig0009-copy-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('🔴 a workspace at the migration before it is copied first, and once it has run no copy is needed', async () => {
    const userData = join(dir, 'data')
    mkdirSync(userData)
    const db = openDatabase(databaseFile(userData))
    applyMigrations(db, upTo(dir, THE_ONE_BEFORE))
    db.close()
    const deps: CoordinatorDeps = {
      userData,
      buildMigrationsFolder: real,
      appVersion: '0.1.0',
      build: null,
      packaged: false,
      ownership: () => Promise.resolve('sole'),
    }
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'made' })
    const [made, ...more] = await listCheckpoints(userData)
    expect(more).toEqual([])
    expect(made?.manifest.reason).toBe('before-migration')
    expect(made?.manifest.database.migrations).toHaveLength(countUpTo(THE_ONE_BEFORE))

    const migrated = openDatabase(databaseFile(userData))
    applyMigrations(migrated, real)
    migrated.close()
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(await listCheckpoints(userData)).toHaveLength(1)
  })
})
