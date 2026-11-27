import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { counted, NewerDatabaseError, UnreadableDatabaseError } from '../src/main/db/newer-database'
import { OPEN_IN_0_2_18_FIRST } from '../src/main/database/sqlite/workspace/side-file-import'
import {
  describeOpenFailure,
  MigrationFailed,
  openFailureFrom,
  openWorkspaceDatabase,
} from '../src/main/db/open-workspace-database'
import {
  buildLineage,
  migrationsRecordedIn,
  type BuildMigration,
} from '../src/main/recovery/database-facts'
import { workspaceOpening } from '../src/main/storage/workspace-opening'
import { WorkspaceUnavailable } from '../src/main/workspace-startup'
import { bundleAWorker } from './helpers/bundle-a-worker'

/**
 * Card 359 S1: the start's database open runs on the storage worker. Main gets the database ready
 * and opens it without migrating; a failure arrives as the same error the open threw on main; the
 * trace's migration phase spans only the migrations; a quit waits for the worker to exit.
 *
 * Throwaway databases only, in this run's own temp folders.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let bundles: string
let storage: string
let build: readonly BuildMigration[] = []
const folders: string[] = []
const open: AppDatabase[] = []
beforeAll(async () => {
  bundles = mkdtempSync(join(tmpdir(), 'brobot-opening-bundle-'))
  storage = await bundleAWorker('src/main/storage.worker.ts', bundles, 'storage.cjs')
  build = await buildLineage(MIGRATIONS)
}, 120_000)
afterAll(() => {
  rmSync(bundles, { recursive: true, force: true })
})
afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

const aFolder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), 'brobot-opens-on-worker-'))
  folders.push(folder)
  return folder
}
const exits: Promise<number>[] = []
const opening = () =>
  workspaceOpening((request) => {
    const worker = new Worker(storage, { workerData: { maintenance: request } })
    exits.push(new Promise((resolve) => worker.once('exit', resolve)))
    return worker
  })
const request = (folder: string, existing = false) => ({
  file: join(folder, 'brobot2.sqlite'),
  folder,
  existing,
  migrationsFolder: MIGRATIONS,
  build,
})
const steps = () => {
  const said: string[] = []
  return { said, migration: { begun: () => said.push('begun'), ended: () => said.push('ended') } }
}
const recorded = (db: AppDatabase): number | null => {
  const record = migrationsRecordedIn(db)
  return record.kind === 'recorded' ? record.migrations.length : null
}

it('a new workspace is migrated on the worker; main opens it ready', async () => {
  const folder = aFolder()
  const { said, migration } = steps()
  await opening().open(request(folder), migration)
  expect(await exits.at(-1)).toBe(0)
  expect(said).toEqual(['begun', 'ended'])
  // The worker closed its connection last, so its log was folded back in.
  expect(existsSync(join(folder, 'brobot2.sqlite-wal'))).toBe(false)
  const db = openDatabase(join(folder, 'brobot2.sqlite'), { fileMustExist: true })
  open.push(db)
  expect(recorded(db)).toBe(build.length)
})

it('a workspace that skipped 0.2.18 is stopped on the worker with the same sentence, unmigrated', async () => {
  const folder = aFolder()
  writeFileSync(join(folder, 'archived.json'), '{"version":1}')
  const { said, migration } = steps()
  await expect(opening().open(request(folder), migration)).rejects.toThrow(OPEN_IN_0_2_18_FIRST)
  expect(said).toEqual([])
  expect(existsSync(join(folder, 'archived.json'))).toBe(true)
})

it('a database a newer build migrated is refused on the worker as on main, untouched', async () => {
  const folder = aFolder()
  const made = openWorkspaceDatabase(request(folder))
  made
    .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run(
      createHash('sha256').update('-- a newer build').digest('hex'),
      counted(build).latest + 60_000,
    )
  made.close()
  const before = readFileSync(join(folder, 'brobot2.sqlite'))
  const { said, migration } = steps()
  const refused = await opening()
    .open(request(folder, true), migration)
    .then(
      () => null,
      (error: unknown) => error,
    )
  expect(refused).toBeInstanceOf(NewerDatabaseError)
  expect((refused as NewerDatabaseError).folder).toBe(folder)
  expect(said).toEqual([])
  expect(readFileSync(join(folder, 'brobot2.sqlite')).equals(before)).toBe(true)
})

it('an existing workspace whose database is gone is unavailable, and the worker creates nothing', async () => {
  const folder = aFolder()
  const { migration } = steps()
  await expect(opening().open(request(folder, true), migration)).rejects.toThrow(
    WorkspaceUnavailable,
  )
  expect(existsSync(join(folder, 'brobot2.sqlite'))).toBe(false)
})

it('each failure crosses from the worker as the error main threw, with the same words', () => {
  const file = '/fictional/brobot2.sqlite'
  const newer = new NewerDatabaseError('/fictional', {
    kind: 'newer',
    inTheDatabase: { count: 3, latest: 30 },
    inTheBuild: { count: 2, latest: 20 },
  })
  const failures: Error[] = [
    new MigrationFailed("BroCrew could not update this workspace's data: fictional", {
      cause: new Error('fictional'),
    }),
    newer,
    new UnreadableDatabaseError('/fictional', 'fictional detail'),
    new WorkspaceUnavailable(file, new Error('fictional cause')),
    new Error('fictional other'),
  ]
  for (const failure of failures) {
    const crossed = openFailureFrom(structuredClone(describeOpenFailure(failure, file)))
    expect(crossed.constructor).toBe(failure.constructor)
    expect(crossed.message).toBe(failure.message)
  }
  const migration = openFailureFrom(describeOpenFailure(failures[0], file))
  expect((migration.cause as Error).message).toBe('fictional')
  expect((openFailureFrom(describeOpenFailure(newer, file)) as NewerDatabaseError).fit).toEqual(
    newer.fit,
  )
})

it('a quit waits for the opening worker to exit, and nothing opens after it', async () => {
  const folder = aFolder()
  const runner = opening()
  const { migration } = steps()
  const opened = runner.open(request(folder), migration).then(
    () => 'opened',
    () => 'refused',
  )
  await runner.stop()
  expect(await exits.at(-1)).toBe(0)
  expect(await opened).toBe('refused')
  await expect(runner.open(request(aFolder()), migration)).rejects.toThrow(
    'The workspace is closing.',
  )
})
