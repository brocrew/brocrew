import Database from 'better-sqlite3'

export type AppDatabase = Database.Database

export type AppStatement = Database.Statement

export function openDatabase(
  file: string,
  options?: { readonly fileMustExist: boolean },
): AppDatabase {
  const db = new Database(file, options)
  if (Number(db.pragma('page_count', { simple: true })) === 0) {
    db.pragma('auto_vacuum = INCREMENTAL')
  }
  db.pragma('journal_mode = WAL')
  db.pragma('journal_size_limit = 8388608')
  db.pragma('foreign_keys = ON')
  return db
}
