import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// A readonly SQLite opener can create SHM, so read only our private copy, including WAL.
export function readProviderDatabase<T>(
  path: string,
  read: (db: Database.Database) => T,
): T | null {
  let scratch: string | null = null
  try {
    scratch = mkdtempSync(join(tmpdir(), 'brobot2-provider-db-'))
    const copy = join(scratch, 'state.sqlite')
    copyFileSync(path, copy)
    // Best-effort: a database with no WAL beside it simply has nothing uncheckpointed.
    if (existsSync(`${path}-wal`)) copyFileSync(`${path}-wal`, `${copy}-wal`)

    const db = new Database(copy, { readonly: true, fileMustExist: true })
    try {
      return read(db)
    } finally {
      db.close()
    }
  } catch {
    return null
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true })
  }
}
