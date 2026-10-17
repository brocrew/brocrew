import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { AppDatabase } from './connection'

/**
 * Apply all committed migrations. Drizzle runs each migration in a transaction
 * and records applied ones in `__drizzle_migrations`, so re-running on an
 * already-migrated database is idempotent (no error, no double-apply).
 *
 * Pure and electron-free by design so the migrator is unit-testable under Node.
 */
export function applyMigrations(sqlite: AppDatabase, migrationsFolder: string): void {
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })
}
