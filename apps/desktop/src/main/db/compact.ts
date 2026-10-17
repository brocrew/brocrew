import type { AppDatabase } from './connection'

/** Below this much free space, giving it back is not worth a pause at launch. */
export const COMPACT_FROM_FREE_BYTES = 64 * 1024 * 1024

/** What {@link compactWhenMuchIsFree} did. */
export type Compaction =
  | 'not-needed'
  | 'not-enough-disk'
  | 'compacted'
  /** Compacted, but a reader held the log, so the log file keeps its size until later. */
  | 'compacted-log-held'

/**
 * Give free pages back to the disk when a quarter of the file or more is free — what a migration
 * that removed many rows leaves behind, since SQLite keeps a file its old size. Run before any
 * window opens, as migrations are. ⚠️ Not when the disk cannot hold a copy of what is kept and the
 * log beside it: `VACUUM` writes both before it lets the old pages go.
 */
export function compactWhenMuchIsFree(db: AppDatabase, freeOnDisk: number | null): Compaction {
  const pageSize = Number(db.pragma('page_size', { simple: true }))
  const pages = Number(db.pragma('page_count', { simple: true }))
  const free = Number(db.pragma('freelist_count', { simple: true }))
  if (free * pageSize < COMPACT_FROM_FREE_BYTES || free * 4 < pages) return 'not-needed'
  const kept = (pages - free) * pageSize
  if (freeOnDisk === null || freeOnDisk < 2 * kept) return 'not-enough-disk'
  db.exec('VACUUM')
  const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
  return checkpoint?.busy === 0 ? 'compacted' : 'compacted-log-held'
}
