import type { AppDatabase } from './connection'
import { buildIdentity } from '../build-identity'
import { FOLD_TERM, FOLD_TYPE_LIST } from './fold-index'
import type { KeptFold, SnapshotFoldAnswers } from './ledger-fold-state'

/**
 * The latest-state checkpoint of the window reader's folds: each conversation's fold kept as of its
 * newest fold row, so a restart folds only the ledgers that moved since, instead of every one.
 *
 * A kept fold is used only when it is proven current: made by this very build, for the ledger's
 * active generation, at its newest fold row, over the same number of fold rows, and no fold row of
 * that ledger rewritten in place since, which a trigger on `events` records by deleting its kept
 * folds, whichever connection wrote. An append, a row removed, a rewrite, a rebuild into a new
 * generation, a restored or imported workspace and a new build each fail that proof, and that
 * ledger is folded again.
 *
 * Derived: it holds nothing a person or an agent reads, and deleting it only costs one full fold.
 */
const CHECKPOINT_TABLE = 'window_fold_checkpoint'

/** The first checkpoint, once the first lists have been read. */
export const WINDOW_CHECKPOINT_FIRST_MS = 2 * 60_000
/** How often the checkpoint takes in the folds kept since. */
export const WINDOW_CHECKPOINT_EVERY_MS = 10 * 60_000
/** Rows per write, so a first checkpoint never holds the main thread long. */
export const WINDOW_CHECKPOINT_ROWS_AT_ONCE = 100

/** The folds a window's first list reads. */
const CHECKPOINT_FOLDS: readonly string[] = ['pieces', 'routes', 'question-states']

const TABLE = `CREATE TABLE IF NOT EXISTS ${CHECKPOINT_TABLE} (
  fold TEXT NOT NULL,
  session_id TEXT NOT NULL,
  made_by TEXT NOT NULL,
  generation INTEGER NOT NULL,
  newest INTEGER,
  fold_rows INTEGER NOT NULL,
  answer TEXT NOT NULL,
  PRIMARY KEY (session_id, fold)
) WITHOUT ROWID`

/** One ledger's fold head: its newest fold row and how many fold rows it has. */
export interface FoldHead {
  readonly generation: number
  readonly newest: number | null
  readonly rows: number
}

/** One kept fold as written: its answer serialized, with the head it was read at. */
export interface CheckpointRow {
  readonly fold: string
  readonly sessionId: string
  readonly generation: number
  readonly newest: number | null
  readonly rows: number
  readonly answer: string
}

/** This build, exactly: a committed, clean build only. Anything else keeps no checkpoint. */
export function checkpointMaker(): string | undefined {
  const build = buildIdentity()
  return build.commit === '' || build.dirty ? undefined : build.commit
}

const REWRITTEN = `CREATE TRIGGER IF NOT EXISTS window_fold_checkpoint_rewritten
AFTER UPDATE ON events
WHEN old.type IN (${FOLD_TYPE_LIST}) OR new.type IN (${FOLD_TYPE_LIST})
BEGIN
  DELETE FROM ${CHECKPOINT_TABLE} WHERE session_id IN (old.session_id, new.session_id);
END`

export function ensureWindowFoldCheckpoint(db: AppDatabase): void {
  if (db.readonly) return
  db.exec(TABLE)
  db.exec(REWRITTEN)
}

const tagged = (_key: string, value: unknown): unknown =>
  value instanceof Map
    ? { '\u0000map': [...value] }
    : value instanceof Set
      ? { '\u0000set': [...value] }
      : value
const untagged = (_key: string, value: unknown): unknown => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const held = value as Record<string, unknown>
    if (Array.isArray(held['\u0000map'])) return new Map(held['\u0000map'] as [unknown, unknown][])
    if (Array.isArray(held['\u0000set'])) return new Set(held['\u0000set'] as unknown[])
  }
  return value
}

/** Every ledger's head at its active generation, in one pass over the fold index. */
export function foldHeads(db: AppDatabase): Map<string, FoldHead> {
  const active = new Map(
    (
      db.prepare('SELECT session_id AS id, active FROM derived_generation').all() as {
        id: string
        active: number
      }[]
    ).map((row) => [row.id, row.active]),
  )
  const heads = new Map<string, FoldHead>()
  const rows = db
    .prepare(
      `SELECT session_id AS id, generation, max(ordinal) AS newest, count(*) AS rows
         FROM events INDEXED BY events_fold_idx
        WHERE ${FOLD_TERM}
        GROUP BY session_id, generation`,
    )
    .iterate() as IterableIterator<{ id: string; generation: number; newest: number; rows: number }>
  for (const row of rows)
    if (row.generation === (active.get(row.id) ?? 0))
      heads.set(row.id, { generation: row.generation, newest: row.newest, rows: row.rows })
  return heads
}

/**
 * Seeds `answers` with each kept fold that is proven current against `heads`, read in the same
 * snapshot. A ledger with no fold rows has no head and nothing seeded: it folds at once.
 */
export function seedFromCheckpoint(
  db: AppDatabase,
  madeBy: string,
  heads: ReadonlyMap<string, FoldHead>,
  answers: SnapshotFoldAnswers,
  written: WeakSet<object>,
): number {
  if (!present(db)) return 0
  let seeded = 0
  const rows = db
    .prepare(
      `SELECT fold, session_id AS sessionId, generation, newest, fold_rows AS rows, answer
         FROM ${CHECKPOINT_TABLE} WHERE made_by = ?`,
    )
    .iterate(madeBy) as IterableIterator<CheckpointRow>
  for (const row of rows) {
    const head = heads.get(row.sessionId)
    if (
      head === undefined ||
      head.generation !== row.generation ||
      head.newest !== row.newest ||
      head.rows !== row.rows ||
      !CHECKPOINT_FOLDS.includes(row.fold)
    )
      continue
    let answer: unknown
    try {
      answer = JSON.parse(row.answer, untagged)
    } catch {
      continue
    }
    const kept = { generation: row.generation, newest: row.newest, answer }
    written.add(kept)
    answers.get(row.fold)!.set(row.sessionId, kept)
    seeded++
  }
  return seeded
}

/**
 * The kept folds not yet written, each with the head it was read at. `heads` must come from the
 * snapshot every kept fold is current in, which a reuse read guarantees.
 */
export function checkpointRowsOf(
  answers: SnapshotFoldAnswers,
  heads: ReadonlyMap<string, FoldHead>,
  written: WeakSet<object>,
): CheckpointRow[] {
  const rows: CheckpointRow[] = []
  for (const fold of CHECKPOINT_FOLDS) {
    for (const [sessionId, kept] of answers.get(fold) ?? new Map<string, KeptFold<unknown>>()) {
      if (written.has(kept)) continue
      const head = heads.get(sessionId)
      if (head === undefined || head.generation !== kept.generation || head.newest !== kept.newest)
        continue
      rows.push({
        fold,
        sessionId,
        generation: kept.generation,
        newest: kept.newest,
        rows: head.rows,
        answer: JSON.stringify(kept.answer, tagged),
      })
      written.add(kept)
    }
  }
  return rows
}

/** Writes kept folds made by `madeBy`; with `dropOthers`, rows any other build made go first. */
export function writeCheckpointRows(
  db: AppDatabase,
  madeBy: string,
  rows: readonly CheckpointRow[],
  dropOthers: boolean,
): void {
  if (dropOthers) db.prepare(`DELETE FROM ${CHECKPOINT_TABLE} WHERE made_by <> ?`).run(madeBy)
  const upsert = db.prepare(
    `INSERT INTO ${CHECKPOINT_TABLE} (fold, session_id, made_by, generation, newest, fold_rows, answer)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (fold, session_id) DO UPDATE SET made_by = excluded.made_by,
       generation = excluded.generation, newest = excluded.newest,
       fold_rows = excluded.fold_rows, answer = excluded.answer`,
  )
  for (const row of rows)
    upsert.run(row.fold, row.sessionId, madeBy, row.generation, row.newest, row.rows, row.answer)
}

function present(db: AppDatabase): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(CHECKPOINT_TABLE) !== undefined
  )
}
