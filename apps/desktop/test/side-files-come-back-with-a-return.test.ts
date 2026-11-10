import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { importDraftsFile, SAVED_DRAFTS_FILE, savedDraftsBook } from '../src/main/drafts-file'
import {
  importProfileExecutionFile,
  NO_PROFILE_EXECUTION,
  PROFILE_EXECUTION_FILE,
  readProfileExecution,
  writeProfileExecution,
} from '../src/main/profile-execution-file'
import {
  importProviderUsageFile,
  NO_USAGE_KEPT,
  PROVIDER_USAGE_FILE,
  usageKeptIn,
} from '../src/main/provider-usage-file'
import {
  importScheduleAttemptsFile,
  SCHEDULE_ATTEMPTS_FILE,
  scheduleAttemptsIn,
} from '../src/main/schedule-attempts-file'
import {
  importTurnsTheAppCutFile,
  NO_CUTS_KEPT,
  TURNS_THE_APP_CUT_FILE,
  turnsTheAppCutIn,
} from '../src/main/turns-the-app-cut-file'
import {
  importSignInChangesFile,
  SIGN_IN_CHANGES_FILE,
  signInChangesIn,
} from '../src/main/sign-in-changes'

/**
 * A side file, once imported, across a restore and a return; and one that cannot be parsed, kept
 * as it is. The restore sets the
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
  {
    name: 'schedule attempts',
    file: SCHEDULE_ATTEMPTS_FILE,
    said: {
      conversations: {
        a: { attempts: [], admittedAt: null, told: [], runs: {}, notStartedSaid: {}, at: 1 },
      },
    },
    importFile: importScheduleAttemptsFile,
    rows: (database) => scheduleAttemptsIn(database).read(),
    change: (database) => scheduleAttemptsIn(database).write({ conversations: {} }),
  },
  {
    name: 'turns the app cut',
    file: TURNS_THE_APP_CUT_FILE,
    said: {
      lives: { a: { since: 1, identity: 'claude:account:a1', generation: 0, launched: 2 } },
      cuts: {
        a: {
          turn: 't',
          generation: 0,
          kind: 'quit',
          cutAt: 3,
          provider: 'claude',
          profile: 'default',
          expected: 'claude:account:a1',
          noticeId: 'msg_a',
          aPersonStartedIt: true,
          state: 'pending',
          at: 3,
        },
      },
    },
    importFile: importTurnsTheAppCutFile,
    rows: (database) => turnsTheAppCutIn(database).read(),
    change: (database) => turnsTheAppCutIn(database).write(NO_CUTS_KEPT),
  },
  {
    name: 'drafts',
    file: SAVED_DRAFTS_FILE,
    said: { version: 1, drafts: [{ slot: 'new', text: 'unsent', attached: [], pinned: true }] },
    importFile: importDraftsFile,
    rows: (database) => savedDraftsBook(database),
    change: (database) => database.exec('DELETE FROM draft'),
  },
  {
    name: 'how each profile runs',
    file: PROFILE_EXECUTION_FILE,
    said: { version: 2, profiles: { 'aid:a': { kind: 'service', identityCreatedAt: 1 } } },
    importFile: importProfileExecutionFile,
    rows: (database) => readProfileExecution(database),
    change: (database) => writeProfileExecution(database, NO_PROFILE_EXECUTION),
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
    const imported = one.rows(database)
    one.change(database)
    const kept = one.rows(database)
    expect(kept).not.toEqual(imported)
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

  it('a file that cannot be parsed is kept, imports nothing, and the start goes on', () => {
    const userData = mkdtempSync(join(tmpdir(), 'brobot2-side-file-'))
    roots.push(userData)
    writeFileSync(join(userData, one.file), '{ torn')
    const database = aStart(userData)
    const empty = one.rows(database)
    expect(() => one.importFile(database, userData)).not.toThrow()
    expect(one.rows(database)).toEqual(empty)
    expect(readFileSync(join(userData, one.file), 'utf8')).toBe('{ torn')
  })
})
