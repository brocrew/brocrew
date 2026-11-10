import { readFileSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import type { AppDatabase } from './connection'

/**
 * Moves a JSON file older builds kept beside the database into its table, once.
 *
 * The rows and the `imported_side_file` marker commit together; only then is the file deleted, and
 * a file whose name is marked is only ever deleted. A file that cannot be read or parsed whole is
 * kept, nothing is imported from it, and the start goes on.
 */
export function importSideFile(
  database: AppDatabase,
  file: string,
  insertRows: (said: unknown) => void,
): void {
  const name = basename(file)
  const marked =
    database.prepare('SELECT 1 FROM imported_side_file WHERE name = ?').get(name) !== undefined
  if (!marked) {
    let said: unknown
    try {
      said = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      console.warn(`BroCrew kept ${name} and imported nothing from it:`, error)
      return
    }
    try {
      database.transaction(() => {
        insertRows(said)
        database.prepare('INSERT INTO imported_side_file (name) VALUES (?)').run(name)
      })()
    } catch (error) {
      console.warn(`BroCrew kept ${name} and could not import it:`, error)
      return
    }
  }
  try {
    rmSync(file, { force: true })
  } catch (error) {
    console.warn(`BroCrew imported ${name} but could not delete it:`, error)
  }
}

/** `value` as a plain object, or an empty one. */
export function objectIn(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
