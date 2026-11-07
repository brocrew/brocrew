import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { compare, snapshot } from '../storage-round-trip-db.mjs'

// drizzle's own table: `SERIAL` is not INTEGER in SQLite, so every id is NULL.
const MIGRATIONS =
  'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'

let folder
afterEach(() => folder && rmSync(folder, { recursive: true, force: true }))

function workspace(name, hashes) {
  const file = join(folder, `${name}.sqlite`)
  const db = new DatabaseSync(file)
  db.exec(MIGRATIONS)
  db.exec('CREATE TABLE events (id TEXT PRIMARY KEY, payload TEXT)')
  db.exec("INSERT INTO events VALUES ('e1', 'kept')")
  const add = db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
  hashes.forEach((hash, i) => add.run(hash, 1700000000000 + i))
  db.close()
  return snapshot(file, join(folder, `${name}-copy`))
}

describe('the round trip compares a table whose key is NULL as a whole', () => {
  it('finds two identical migrations tables with NULL ids equal', () => {
    folder = mkdtempSync(join(tmpdir(), 'round-trip-compare-'))
    const result = compare(workspace('a', ['m1', 'm2', 'm3']), workspace('b', ['m1', 'm2', 'm3']))
    expect(result.differences).toEqual([])
    expect(result.inserted).toEqual([])
  })

  it('finds two different migrations tables with NULL ids different', () => {
    folder = mkdtempSync(join(tmpdir(), 'round-trip-compare-'))
    const result = compare(workspace('a', ['m1', 'm2', 'm3']), workspace('b', ['m1', 'm2', 'm4']))
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: 'unkeyed table changed', table: '__drizzle_migrations' }),
    )
  })
})
