/**
 * The passed-up copies of a question, found by their key.
 *
 * `question_copy` holds one row per `question_asked` row whose payload names the question it was
 * passed up from: that key, and the conversation holding it. It is derived from `events` alone, so
 * it can be dropped and refilled without losing anything, which is why it is created here, at open,
 * and never by a journal migration: a build that predates it opens the same file, and its writes
 * keep the copies current through the triggers stored in the file.
 *
 * Its triggers keep it current for every row written from then on; rows written before are filled
 * by {@link fillQuestionCopies}, one bounded slice at a time. Until the fill is done, and whenever
 * its index is missing, readers use the exact query over `events` instead.
 */
import type { AppDatabase } from './connection'
import { FOLD_TERM } from './fold-index'

/** The copy's key in a row: `passedUpFrom` where the payload is valid JSON, and NULL otherwise. */
const key = (row: string): string =>
  `CASE WHEN json_valid(${row}.payload) THEN json_extract(${row}.payload, '$.passedUpFrom') END`

/** The derived tables: written for readers' speed, holding nothing a person or an agent reads. */
export const DERIVED_TABLES: ReadonlySet<string> = new Set([
  'question_copy',
  'question_copy_progress',
])

/** The persistent tables a write to a table may also change through its triggers. */
export const TRIGGER_WRITES: ReadonlyMap<string, readonly string[]> = new Map([
  ['events', ['question_copy']],
])

/**
 * The persistent tables a delete from a table may also change, through the rows its foreign keys
 * delete with it and their triggers: a conversation's delete takes its ledger rows, and with them
 * their copies.
 */
export const CASCADE_DELETE_WRITES: ReadonlyMap<string, readonly string[]> = new Map([
  ['provider_session', ['question_copy']],
])

const TABLES = `
CREATE TABLE IF NOT EXISTS question_copy (
  event_id TEXT PRIMARY KEY NOT NULL,
  passed_up_from NOT NULL,
  session_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS question_copy_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  after_session TEXT,
  after_generation INTEGER,
  after_ordinal INTEGER,
  done INTEGER NOT NULL DEFAULT 0
);`

const INDEX = 'question_copy_key_idx'
const INDEX_SQL = `CREATE INDEX ${INDEX} ON question_copy (passed_up_from, session_id)`

/** The triggers, by name. A key that is NULL is left out in `WHEN`: such a question has no copy. */
export const QUESTION_COPY_TRIGGERS: Readonly<Record<string, string>> = {
  question_copy_insert: `CREATE TRIGGER question_copy_insert AFTER INSERT ON events
WHEN new.type = 'question_asked' AND ${key('new')} IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO question_copy (event_id, passed_up_from, session_id)
  VALUES (new.id, ${key('new')}, new.session_id);
END`,
  question_copy_delete: `CREATE TRIGGER question_copy_delete AFTER DELETE ON events
WHEN old.type = 'question_asked'
BEGIN
  DELETE FROM question_copy WHERE event_id = old.id;
END`,
  question_copy_update: `CREATE TRIGGER question_copy_update AFTER UPDATE OF id, session_id, type, payload ON events
WHEN old.type = 'question_asked' OR new.type = 'question_asked'
BEGIN
  DELETE FROM question_copy WHERE event_id = old.id;
  INSERT OR REPLACE INTO question_copy (event_id, passed_up_from, session_id)
  SELECT new.id, ${key('new')}, new.session_id
   WHERE new.type = 'question_asked' AND ${key('new')} IS NOT NULL;
END`,
}

/**
 * Objects written by hand in the migrations, which a generated rebuild of their table would drop.
 * A missing one is said at open, by name; reads that name an index fall back to their unindexed
 * form (`optional-indexes.ts`), and only a migration restores it.
 */
export const HAND_WRITTEN_OBJECTS: readonly {
  readonly type: 'index' | 'trigger'
  readonly name: string
  /** It enforces a rule (a unique partial index, a guard trigger), rather than speeding reads. */
  readonly guards: boolean
}[] = [
  { type: 'index', name: 'events_kind_owner_idx', guards: false },
  { type: 'index', name: 'events_work_piece_idx', guards: false },
  { type: 'index', name: 'events_error_idx', guards: false },
  { type: 'index', name: 'events_fold_idx', guards: false },
  { type: 'index', name: 'events_human_final_idx', guards: false },
  { type: 'index', name: 'events_human_prompt_idx', guards: false },
  { type: 'index', name: 'events_instruction_ask_idx', guards: false },
  { type: 'index', name: 'events_inventory_idx', guards: false },
  { type: 'index', name: 'events_mcp_request_idx', guards: false },
  { type: 'index', name: 'events_provider_clear_idx', guards: false },
  { type: 'index', name: 'events_request_routed_idx', guards: false },
  { type: 'index', name: 'events_turn_opening_idx', guards: false },
  { type: 'index', name: 'events_work_idx', guards: false },
  { type: 'index', name: 'identity_memory_amendment_one_pending_uq', guards: true },
  { type: 'index', name: 'identity_method_change_pending_uq', guards: true },
  { type: 'index', name: 'work_one_root_per_conversation_uq', guards: true },
  { type: 'index', name: 'work_parent_number_uq', guards: true },
  { type: 'index', name: 'work_root_number_uq', guards: true },
  { type: 'trigger', name: 'skill_version_no_update', guards: true },
  { type: 'trigger', name: 'skill_version_no_delete', guards: true },
]

const present = (db: AppDatabase, type: string, name: string): boolean =>
  db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !==
  undefined

/**
 * Creates what is missing of the copies, in one transaction, before any reader. Missing triggers
 * are created and the fill starts again, since a copy may have gone stale while they were gone. A
 * missing index is created only over an empty table; over a filled one it is never rebuilt here,
 * and readers use the exact query from then on.
 */
export function ensureQuestionCopies(
  db: AppDatabase,
  warn: (line: string) => void = console.warn,
): void {
  if (db.readonly) return
  db.transaction(() => {
    db.exec(TABLES)
    db.prepare('INSERT OR IGNORE INTO question_copy_progress (id) VALUES (1)').run()
    const restart = db.prepare(
      'UPDATE question_copy_progress SET after_session = NULL, after_generation = NULL, after_ordinal = NULL, done = 0 WHERE id = 1',
    )
    const missing = Object.keys(QUESTION_COPY_TRIGGERS).filter(
      (name) => !present(db, 'trigger', name),
    )
    for (const name of missing) db.exec(QUESTION_COPY_TRIGGERS[name]!)
    if (missing.length > 0) restart.run()
    // A fill said done over a copy table that lost every row, while the ledger holds a keyed
    // question, starts again. Both reads stop at their first row.
    const lostEveryCopy = db
      .prepare(
        `SELECT (SELECT done FROM question_copy_progress WHERE id = 1) = 1
            AND NOT EXISTS (SELECT 1 FROM question_copy)
            AND EXISTS (SELECT 1 FROM events WHERE type = 'question_asked' AND ${key('events')} IS NOT NULL)
            AS lost`,
      )
      .get() as { lost: number }
    if (lostEveryCopy.lost === 1) restart.run()
    if (!present(db, 'index', INDEX)) {
      const empty = db
        .prepare('SELECT NOT EXISTS (SELECT 1 FROM question_copy) AS empty')
        .get() as {
        empty: number
      }
      if (empty.empty === 1) db.exec(INDEX_SQL)
      else {
        restart.run()
        warn(
          `database: ${INDEX} is missing; a question's copies are found by the slower exact read`,
        )
      }
    }
  })()
  for (const one of HAND_WRITTEN_OBJECTS)
    if (!present(db, one.type, one.name))
      warn(
        one.guards
          ? `database: ${one.type} ${one.name} is missing; the rule it enforces is not enforced until a migration restores it`
          : `database: ${one.type} ${one.name} is missing; reads that use it take the slower way`,
      )
}

/** Whether readers may use the copies: the fill is done and the index is there. */
export function questionCopiesReady(db: AppDatabase): boolean {
  try {
    const row = db.prepare('SELECT done FROM question_copy_progress WHERE id = 1').get() as
      { done: number } | undefined
    return row?.done === 1 && present(db, 'index', INDEX)
  } catch {
    return false
  }
}

/** What one slice did. */
export type QuestionCopySlice =
  | { readonly state: 'filled' | 'done'; readonly visited: number; readonly matched: number }
  | { readonly state: 'busy' | 'unindexed'; readonly visited: 0; readonly matched: 0 }

const BUSY = { state: 'busy', visited: 0, matched: 0 } as const
const UNINDEXED = { state: 'unindexed', visited: 0, matched: 0 } as const

/**
 * Fills the copies for at most `rows` ledger rows past the cursor, in the fold index's order,
 * stopping early once `bytes` of payload have been visited (the row that crosses it is the last).
 * One transaction, begun only if the write lock is free at once; the cursor moves to the last row
 * visited, matched or not, in the same transaction. Each copy is written from the row as it is now,
 * so a copy left stale is corrected.
 */
export function fillQuestionCopies(
  db: AppDatabase,
  rows: number,
  bytes: number,
): QuestionCopySlice {
  if (!present(db, 'index', INDEX)) return UNINDEXED
  const progress = db
    .prepare(
      'SELECT after_session, after_generation, after_ordinal, done FROM question_copy_progress WHERE id = 1',
    )
    .get() as
    | {
        after_session: string | null
        after_generation: number | null
        after_ordinal: number | null
        done: number
      }
    | undefined
  if (progress === undefined || progress.done === 1)
    return { state: 'done', visited: 0, matched: 0 }
  const walk = db.prepare(
    `SELECT id, type, session_id AS session, generation, ordinal,
            length(CAST(payload AS BLOB)) AS bytes
       FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND (session_id, generation, ordinal) > (?, ?, ?)
      ORDER BY session_id, generation, ordinal
      LIMIT ?`,
  )
  const forget = db.prepare('DELETE FROM question_copy WHERE event_id = ?')
  const copy = db.prepare(
    `INSERT OR REPLACE INTO question_copy (event_id, passed_up_from, session_id)
     SELECT e.id, ${key('e')}, e.session_id FROM events e WHERE e.id = ? AND ${key('e')} IS NOT NULL`,
  )
  const move = db.prepare(
    'UPDATE question_copy_progress SET after_session = ?, after_generation = ?, after_ordinal = ?, done = ? WHERE id = 1',
  )
  // A whole number of rows, at least one: SQLite's LIMIT takes nothing else.
  const limit = Math.max(1, Math.floor(rows))
  const slice = db.transaction((): QuestionCopySlice => {
    // Stepped: each row is read as it is needed, and none past the byte bound. The writes follow
    // once the read is closed, since a connection cannot write while one of its reads is open.
    const visited: {
      id: string
      type: string
      session: string
      generation: number
      ordinal: number
    }[] = []
    let total = 0
    for (const one of walk.iterate(
      progress.after_session ?? '',
      progress.after_generation ?? -1,
      progress.after_ordinal ?? -1,
      limit,
    ) as Iterable<{
      id: string
      type: string
      session: string
      generation: number
      ordinal: number
      bytes: number | null
    }>) {
      visited.push(one)
      total += one.bytes ?? 0
      if (total >= bytes) break
    }
    if (visited.length === 0) {
      move.run(progress.after_session, progress.after_generation, progress.after_ordinal, 1)
      return { state: 'done', visited: 0, matched: 0 }
    }
    let matched = 0
    for (const one of visited) {
      if (one.type !== 'question_asked') continue
      forget.run(one.id)
      matched += copy.run(one.id).changes > 0 ? 1 : 0
    }
    const seen = visited.length
    const last = visited[seen - 1]!
    move.run(last.session, last.generation, last.ordinal, 0)
    return { state: 'filled', visited: seen, matched }
  })
  const timeout = db.pragma('busy_timeout', { simple: true }) as number
  db.pragma('busy_timeout = 0')
  try {
    return slice.immediate()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY') return BUSY
    throw error
  } finally {
    db.pragma(`busy_timeout = ${String(timeout)}`)
  }
}
