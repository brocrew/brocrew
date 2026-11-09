import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { AppDatabase } from './connection'

export function applyMigrations(sqlite: AppDatabase, migrationsFolder: string): void {
  const db = drizzle(sqlite)
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) === 1
  // Rebuild parent tables without invoking their cascade or SET NULL actions.
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
  } finally {
    sqlite.pragma(foreignKeys ? 'foreign_keys = ON' : 'foreign_keys = OFF')
  }
}
