import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/main/db/migrations',
)

export function migratedSessionStore(db: AppDatabase): SessionStore {
  applyMigrations(db, migrationsFolder)
  return createSessionStore(db)
}
