import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { AppDatabase } from './connection'

export function applyMigrations(sqlite: AppDatabase, migrationsFolder: string): void {
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })
}
