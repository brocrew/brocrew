import type { AppDatabase } from './connection'

/** Below this much free space, giving it back is not worth a pause at launch. */
export const COMPACT_FROM_FREE_BYTES = 64 * 1024 * 1024

export const COMPACT_AT_MOST_BYTES = 512 * 1024 * 1024

/** What {@link compactWhenMuchIsFree} did. */
export type Compaction =
  | 'not-needed'
  | 'not-enough-disk'
  /** Much is free, but the file is above {@link COMPACT_AT_MOST_BYTES}: not rewritten at launch. */
  | 'deferred-too-large'
  | 'compacted'
  /** Compacted, but a reader held the log, so the log file keeps its size until later. */
  | 'compacted-log-held'

export function compactWhenMuchIsFree(
  db: AppDatabase,
  freeOnDisk: number | null,
  atMostBytes: number = COMPACT_AT_MOST_BYTES,
): Compaction {
  const pageSize = Number(db.pragma('page_size', { simple: true }))
  const pages = Number(db.pragma('page_count', { simple: true }))
  const free = Number(db.pragma('freelist_count', { simple: true }))
  if (free * pageSize < COMPACT_FROM_FREE_BYTES || free * 4 < pages) return 'not-needed'
  if (pages * pageSize > atMostBytes) return 'deferred-too-large'
  const kept = (pages - free) * pageSize
  if (freeOnDisk === null || freeOnDisk < 2 * kept) return 'not-enough-disk'
  db.exec('VACUUM')
  const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
  return checkpoint?.busy === 0 ? 'compacted' : 'compacted-log-held'
}
