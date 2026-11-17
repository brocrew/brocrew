import { statSync } from 'node:fs'
import Database from 'better-sqlite3'

export type AppDatabase = Database.Database

export type AppStatement = Database.Statement

/** The size the write-ahead log is cut back to once checkpointed. */
export const WAL_SIZE_LIMIT_BYTES = 8 * 1024 * 1024

function walBytes(file: string): number {
  return statSync(`${file}-wal`, { throwIfNoEntry: false })?.size ?? 0
}

export function openDatabase(
  file: string,
  options?: { readonly fileMustExist: boolean },
): AppDatabase {
  const db = new Database(file, options)
  if (Number(db.pragma('page_count', { simple: true })) === 0) {
    db.pragma('auto_vacuum = INCREMENTAL')
  }
  db.pragma('journal_mode = WAL')
  db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`)
  // The limit applies only when a later checkpoint resets the log, so a log left large by a crash
  // would keep its size; the read above has recovered it, and this cuts it back once.
  if (walBytes(file) > WAL_SIZE_LIMIT_BYTES) db.pragma('wal_checkpoint(TRUNCATE)')
  db.pragma('foreign_keys = ON')
  return db
}
