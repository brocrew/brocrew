import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { counted, NewerDatabaseError, openOrRefuse } from '../src/main/db/newer-database'
import { OPEN_IN_0_2_18_FIRST } from '../src/main/database/sqlite/workspace/side-file-import'
import {
  MigrationFailed,
  openWorkspaceDatabase,
  type WorkspaceDatabaseOpening,
} from '../src/main/db/open-workspace-database'
import {
  buildLineage,
  migrationsRecordedIn,
  type BuildMigration,
} from '../src/main/recovery/database-facts'
import { WorkspaceUnavailable } from '../src/main/workspace-startup'

/**
 * Card 359 S0: how a start opens the workspace database, pinned before the open moves off the
 * window's main thread. Open (with the WAL cut), refuse a newer database before any migration,
 * stop on a workspace that skipped 0.2.18, then migrate; a failed migration closes and says so. A database
 * opened again afterwards needs no migration and is left in shared locking, so a second connection
 * can still take the checkpoint at close.
 *
 * Throwaway databases only, in this run's own temp folders.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const folders: string[] = []
const open: AppDatabase[] = []
let build: readonly BuildMigration[] = []
beforeAll(async () => {
  build = await buildLineage(MIGRATIONS)
})
afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const aFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), 'brobot-opens-in-order-'))
  folders.push(folder)
  return folder
}
const opening = (folder: string, over: Partial<WorkspaceDatabaseOpening> = {}) => ({
  file: join(folder, 'brobot2.sqlite'),
  folder,
  existing: false,
  migrationsFolder: MIGRATIONS,
  build,
  ...over,
})
const opened = (over: WorkspaceDatabaseOpening): AppDatabase => {
  const db = openWorkspaceDatabase(over)
  open.push(db)
  return db
}
const recorded = (db: AppDatabase): number | null => {
  const record = migrationsRecordedIn(db)
  return record.kind === 'recorded' ? record.migrations.length : null
}

it('a new workspace opens migrated, in WAL with shared locking', () => {
  const folder = aFolder()
  const steps: string[] = []
  const db = opened(
    opening(folder, {
      migrate: (apply) => {
        steps.push('migrate')
        apply()
      },
    }),
  )
  expect(steps).toEqual(['migrate'])
  expect(recorded(db)).toBe(build.length)
  expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  expect(db.pragma('locking_mode', { simple: true })).toBe('normal')
})

it('a workspace that skipped 0.2.18 stops before any migration, and keeps its side file', () => {
  const folder = aFolder()
  writeFileSync(join(folder, 'archived.json'), '{"version":1}')
  const steps: string[] = []
  expect(() =>
    openWorkspaceDatabase(opening(folder, { migrate: () => void steps.push('migrate') })),
  ).toThrow(OPEN_IN_0_2_18_FIRST)
  expect(steps).toEqual([])
  expect(existsSync(join(folder, 'archived.json'))).toBe(true)
})

it('a database a newer build migrated is refused before any migration runs, and left as it was', () => {
  const folder = aFolder()
  const made = opened(opening(folder))
  made
    .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run(
      createHash('sha256').update('-- a newer build').digest('hex'),
      counted(build).latest + 60_000,
    )
  made.close()
  const file = join(folder, 'brobot2.sqlite')
  const before = readFileSync(file)
  let migrated = false
  expect(() =>
    openWorkspaceDatabase(
      opening(folder, {
        existing: true,
        migrate: () => {
          migrated = true
        },
      }),
    ),
  ).toThrow(NewerDatabaseError)
  expect(migrated).toBe(false)
  expect(readFileSync(file).equals(before)).toBe(true)
})

it('a migration that fails closes the database and says this workspace could not be updated', () => {
  const folder = aFolder()
  const failing = (() => {
    try {
      openWorkspaceDatabase(
        opening(folder, {
          migrate: () => {
            throw new Error('fictional migration failure')
          },
        }),
      )
    } catch (error) {
      return error
    }
    return null
  })()
  expect(failing).toBeInstanceOf(MigrationFailed)
  expect((failing as Error).message).toBe(
    "BroCrew could not update this workspace's data: fictional migration failure",
  )
  expect(((failing as Error).cause as Error).message).toBe('fictional migration failure')
  // Closed: a fresh connection takes the exclusive lock at once, with no busy wait.
  const probe = new Database(join(folder, 'brobot2.sqlite'), { timeout: 0 })
  open.push(probe)
  expect(() => probe.exec('BEGIN EXCLUSIVE; ROLLBACK')).not.toThrow()
})

it('an existing workspace whose database is gone says the workspace is unavailable and creates nothing', () => {
  const folder = aFolder()
  let checked = 0
  expect(() =>
    openWorkspaceDatabase(
      opening(folder, {
        existing: true,
        openFailed: () => {
          checked++
        },
      }),
    ),
  ).toThrow(WorkspaceUnavailable)
  expect(checked).toBe(1)
  expect(existsSync(join(folder, 'brobot2.sqlite'))).toBe(false)
})

it('a database opened again after the start needs no migration and fits this build', () => {
  const folder = aFolder()
  const copy = aFolder()
  opened(opening(folder)).close()
  // The reopen sees exactly the file the start left: what a worker's start hands to main.
  cpSync(join(folder, 'brobot2.sqlite'), join(copy, 'brobot2.sqlite'))
  const again = openDatabase(join(copy, 'brobot2.sqlite'), { fileMustExist: true })
  open.push(again)
  expect(recorded(again)).toBe(build.length)
  expect(() => openOrRefuse(again, build, { folder: copy })).not.toThrow()
  expect(again.pragma('locking_mode', { simple: true })).toBe('normal')
})
