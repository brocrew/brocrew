import { committedChangesOf, type Committed } from './committed-changes'
import type { AppDatabase } from './connection'

/**
 * Whether a commit can change a reading of `tables` and of the event rows of type `rows`. Trimming
 * never removes a row a reading reads.
 */
export const changesWhatIsRead =
  (tables: ReadonlySet<string>, rows: ReadonlySet<string>) =>
  (change: Committed): boolean =>
    change.resync ||
    [...change.tables].some((table) => tables.has(table)) ||
    change.rows.some((row) => rows.has(row.rowType)) ||
    [...change.whole.values()].some((why) => why !== 'trimmed')

/**
 * A revision that moves when a commit on `db` is one `moves` counts, or when another connection
 * commits; `null` while no fresh snapshot can be read.
 */
export function committedRevision(
  db: AppDatabase,
  canRead: () => boolean,
  moves: (change: Committed) => boolean,
): () => string | null {
  let changes = 0
  committedChangesOf(db).listen((change) => {
    if (moves(change)) changes++
  })
  return () => {
    if (!canRead()) return null
    return `${changes}:${String(db.pragma('data_version', { simple: true }))}`
  }
}
