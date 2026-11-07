import Database from 'better-sqlite3'

export type AppDatabase = Database.Database

export type AppStatement = Database.Statement

export function openDatabase(
  file: string,
  options?: { readonly fileMustExist: boolean },
): AppDatabase {
  const db = new Database(file, options)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
