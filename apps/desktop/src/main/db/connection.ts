import { observeDatabaseMemory } from '../database-memory'
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
  // Keep better-sqlite3's 5 s busy wait for the main-thread writer. A longer synchronous wait would
  // block the window longer. The transaction retry shares this budget. Revisit the wait when the
  // writer moves off main.
  const db = new Database(file, options)
  if (Number(db.pragma('page_count', { simple: true })) === 0) {
    db.pragma('auto_vacuum = INCREMENTAL')
  }
  db.pragma('journal_mode = WAL')
  db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`)
  // The limit applies only when a later checkpoint resets the log, so a log left large by a crash
  // would keep its size; the read above has recovered it, and this cuts it back once. A cut that
  // fails, as on a full disk, leaves every frame in the log, so the database opens without it.
  try {
    if (walBytes(file) > WAL_SIZE_LIMIT_BYTES) db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    console.warn(
      `The write-ahead log could not be cut back when the database opened: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  db.pragma('foreign_keys = ON')
  observeDatabaseMemory(db, 'writer')
  return db
}
