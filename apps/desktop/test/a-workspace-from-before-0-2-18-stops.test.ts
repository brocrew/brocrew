import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  OPEN_IN_0_2_18_FIRST,
  refuseSideFilesBefore0218,
  SIDE_FILES_BEFORE_0_2_18,
} from '../src/main/database/sqlite/workspace/side-file-import'

/**
 * 0.2.18 created `imported_side_file` and moved seven JSON side files into the database. This build
 * no longer imports them, so a workspace that skipped 0.2.18 (no table, a side file beside it) stops
 * before any migration and says to open it in 0.2.18 first; a workspace 0.2.18 or later opened
 * starts, even with a file 0.2.18 kept because it could not import it.
 */
const migrations = join(__dirname, '../src/main/db/migrations')
const roots: string[] = []
const open: AppDatabase[] = []
afterEach(() => {
  for (const database of open.splice(0)) if (database.open) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aWorkspace(migrated: boolean): { userData: string; database: AppDatabase } {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-before-0218-'))
  roots.push(userData)
  const database = openDatabase(join(userData, 'brobot2.sqlite'))
  open.push(database)
  if (migrated) applyMigrations(database, migrations)
  return { userData, database }
}

const tables = (database: AppDatabase) =>
  database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()

describe('a workspace from before 0.2.18', () => {
  it.each(SIDE_FILES_BEFORE_0_2_18)(
    'with %s and no import marker table stops, untouched, before any migration',
    (name) => {
      const { userData, database } = aWorkspace(false)
      writeFileSync(join(userData, name), '{"version":1}')
      const before = tables(database)
      expect(() => refuseSideFilesBefore0218(database, userData)).toThrow(OPEN_IN_0_2_18_FIRST)
      expect(database.open).toBe(false)
      const again = openDatabase(join(userData, 'brobot2.sqlite'))
      open.push(again)
      expect(tables(again)).toEqual(before)
      expect(readFileSync(join(userData, name), 'utf8')).toBe('{"version":1}')
    },
  )

  it('says the one sentence', () => {
    expect(OPEN_IN_0_2_18_FIRST).toBe('Open this workspace in BroCrew 0.2.18 first.')
  })
})

describe('a workspace 0.2.18 or later opened starts normally', () => {
  it('with a side file 0.2.18 could not import and left unmarked beside it', () => {
    const { userData, database } = aWorkspace(true)
    writeFileSync(join(userData, 'drafts.json'), '{ half a file')
    expect(() => refuseSideFilesBefore0218(database, userData)).not.toThrow()
    expect(database.open).toBe(true)
  })

  it('with every side file marked as imported, even with a stale copy left beside it', () => {
    const { userData, database } = aWorkspace(true)
    const mark = database.prepare('INSERT INTO imported_side_file (name) VALUES (?)')
    for (const name of SIDE_FILES_BEFORE_0_2_18) mark.run(name)
    writeFileSync(join(userData, 'archived.json'), '{}')
    expect(() => refuseSideFilesBefore0218(database, userData)).not.toThrow()
    expect(database.open).toBe(true)
  })

  it('with no side files, new or migrated', () => {
    for (const migrated of [false, true]) {
      const { userData, database } = aWorkspace(migrated)
      expect(() => refuseSideFilesBefore0218(database, userData)).not.toThrow()
      expect(database.open).toBe(true)
    }
  })
})
