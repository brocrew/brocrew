import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  importProviderUsageFile,
  NO_USAGE_KEPT,
  PROVIDER_USAGE_FILE,
  usageKeptIn,
} from '../src/main/provider-usage-file'
import {
  importSignInChangesFile,
  SIGN_IN_CHANGES_FILE,
  signInChangesIn,
} from '../src/main/sign-in-changes'

/**
 * A kept-current side file, once imported, across a restore and a return. The restore sets the
 * database aside whole and puts back a copy whose old file is beside it; while that copy is open
 * history-only nothing imports. The return puts the set-aside database back, its import marker
 * with it, so the next writable start finds its rows and imports nothing again, even from a stale
 * file left beside it.
 */

const migrations = join(__dirname, '../src/main/db/migrations')
const roots: string[] = []
const open: AppDatabase[] = []
afterEach(() => {
  for (const database of open.splice(0)) if (database.open) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aStart(userData: string): AppDatabase {
  const database = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(database, migrations)
  open.push(database)
  return database
}

interface Case {
  readonly name: string
  readonly file: string
  readonly said: unknown
  readonly importFile: (database: AppDatabase, userData: string) => void
  readonly rows: (database: AppDatabase) => unknown
  readonly change: (database: AppDatabase) => void
}

const CASES: readonly Case[] = [
  {
    name: 'sign-in changes',
    file: SIGN_IN_CHANGES_FILE,
    said: { version: 1, changed: { claude: 5 } },
    importFile: importSignInChangesFile,
    rows: (database) => [...signInChangesIn(database).read()],
    change: (database) =>
      signInChangesIn(database).write(new Map<Provider, number>([['codex', 9]])),
  },
  {
    name: 'provider usage',
    file: PROVIDER_USAGE_FILE,
    said: { readings: { claude: [{ window: 'w', usedPercent: 1, resetsAt: null, at: 1 }] } },
    importFile: importProviderUsageFile,
    rows: (database) => usageKeptIn(database).read(),
    change: (database) => usageKeptIn(database).write(NO_USAGE_KEPT),
  },
]

describe.each(CASES)('$name', (one) => {
  it('import, restore, return: the rows are back and nothing is imported again', () => {
    const userData = mkdtempSync(join(tmpdir(), 'brobot2-side-file-'))
    roots.push(userData)
    const aside = join(userData, 'aside')
    mkdirSync(aside)
    writeFileSync(join(userData, one.file), JSON.stringify(one.said))
    // The copy a checkpoint took before the migration: the old file beside the old database.
    copyFileSync(join(userData, one.file), join(aside, `copy-${one.file}`))

    let database = aStart(userData)
    one.importFile(database, userData)
    expect(existsSync(join(userData, one.file))).toBe(false)
    one.change(database)
    const kept = one.rows(database)
    database.close()

    // Restore: the newer database is set aside, the copy's file comes back beside an old database.
    copyFileSync(join(userData, 'brobot2.sqlite'), join(aside, 'newer.sqlite'))
    rmSync(join(userData, 'brobot2.sqlite'))
    copyFileSync(join(aside, `copy-${one.file}`), join(userData, one.file))
    // Return: the newer database is put back. Even were the copy's file left beside it, the
    // marker the database carries means it is only deleted.
    copyFileSync(join(aside, 'newer.sqlite'), join(userData, 'brobot2.sqlite'))

    database = aStart(userData)
    one.importFile(database, userData)
    expect(one.rows(database)).toEqual(kept)
    expect(existsSync(join(userData, one.file))).toBe(false)
  })
})
