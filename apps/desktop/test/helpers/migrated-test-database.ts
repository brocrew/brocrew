import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations')

export function migratedTestDatabase(path: string) {
  const db = openDatabase(path)
  applyMigrations(db, migrations)
  return db
}
