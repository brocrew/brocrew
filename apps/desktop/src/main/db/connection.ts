import Database from 'better-sqlite3'

export type AppDatabase = Database.Database

/**
 * One compiled statement. Exported since 339, for the one place in `session-store.ts` that has to
 * NAME the type rather than let `db.prepare`'s return be inferred — a memoised pair that is
 * prepared on first use instead of at construction. See the comment there for why those two wait.
 */
export type AppStatement = Database.Statement

/**
 * Open a better-sqlite3 connection (synchronous, main-process only) with the
 * pragmas BroBot2 relies on. Foreign keys must be enabled per connection
 * (002 SQLite port notes) for the events → provider_session FK to be enforced.
 */
export function openDatabase(
  file: string,
  options?: { readonly fileMustExist: boolean },
): AppDatabase {
  const db = new Database(file, options)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
