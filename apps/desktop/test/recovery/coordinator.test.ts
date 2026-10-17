import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProgressListener, StartupVerdict } from '../../src/shared/recovery'
import { inWords, listCheckpoints } from '../../src/main/recovery/checkpoint'
import {
  createRecoveryService,
  createRecoveryServiceForTests,
  faultsFromSwitch,
  keepsTheRecoveryWindow,
  KEEP_RECOVERY_WINDOW_SWITCH,
  hooksFor,
  inspect,
  pruneTheCopies,
  whyItDidNotStart,
  type CoordinatorDeps,
  type Ownership,
  type RecoveryFaults,
  type WorkingOn,
} from '../../src/main/recovery/coordinator'
import { errorCode, nodeFs, type RecoveryFs } from '../../src/main/recovery/files'
import {
  backupsDir,
  databaseFile,
  gateFile,
  journalFile,
  recoveryDir,
} from '../../src/main/recovery/layout'
import { CHECKPOINT_LINE, FAIL_LINE, READY_LINE } from '../../src/main/recovery/log-lines'
import {
  BUILD_LINEAGE,
  MIGRATIONS_FOLDER,
  NEWER_MIGRATION,
  NEWER_VERSION,
  ONE_NEWER,
  THIS_BUILD,
  THIS_VERSION,
  makeRecoveryFixture,
  type RecoveryFixtureOptions,
} from './lib/recovery-fixture'

/**
 * The start-up check, on real data folders: databases built by the app's own migrations, copies
 * made as the checkpoint writer makes them, and restores laid down after any step. Each refusal is
 * checked to leave every file in the folder as it was.
 */

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function aRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brobot2-coordinator-'))
  roots.push(root)
  return root
}

async function aWorkspace(options: RecoveryFixtureOptions): Promise<string> {
  const userData = join(await aRoot(), 'data')
  await makeRecoveryFixture(userData, options)
  return userData
}

interface Seen {
  readonly lines: string[]
  readonly working: WorkingOn[]
  readonly progress: (readonly [number, number])[]
}

function checkOf(
  userData: string,
  over: Partial<CoordinatorDeps> = {},
): { readonly deps: CoordinatorDeps; readonly seen: Seen } {
  const seen: Seen = { lines: [], working: [], progress: [] }
  return {
    deps: {
      userData,
      buildMigrationsFolder: MIGRATIONS_FOLDER,
      appVersion: THIS_VERSION,
      build: null,
      packaged: false,
      ownership: () => Promise.resolve('sole'),
      log: (line) => seen.lines.push(line),
      working: (what) => seen.working.push(what),
      progress: (done, total) => seen.progress.push([done, total]),
      ...over,
    },
    seen,
  }
}

const owned = (ownership: Ownership): Pick<CoordinatorDeps, 'ownership'> => ({
  ownership: () => Promise.resolve(ownership),
})

/** The service with `faults`, through the factory a test outside this file uses. */
function withFaults(deps: CoordinatorDeps, faults: RecoveryFaults) {
  const { buildMigrationsFolder, ownership, ...rest } = deps
  return createRecoveryServiceForTests({
    ...rest,
    migrationsFolder: buildMigrationsFolder,
    ownership,
    faults,
  })
}

/** The refusal of a start whose one-app check did not say `sole`. */
const notTheOnlyApp = (ownership: Exclude<Ownership, 'sole'>): StartupVerdict => ({
  kind: 'failed',
  reason: 'not-the-only-app-on-this-folder',
  canRetry: ownership === 'unknown',
  ownership,
})

const quiet: ProgressListener = () => undefined

/** Every file and folder under `dir`, with each file's size, modification time and sha256. */
async function treeOf(dir: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {}
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        tree[path] = 'folder'
        await walk(path)
        continue
      }
      const file = join(dir, path)
      const stats = await stat(file)
      const sha256 = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      tree[path] = `${String(stats.size)} ${String(stats.mtimeMs)} ${sha256}`
    }
  }
  await walk('')
  return tree
}

/** A migrations folder holding this build's migrations and one more after them. */
async function aBuildWithOneMoreMigration(): Promise<string> {
  const folder = join(await aRoot(), 'migrations')
  await mkdir(join(folder, 'meta'), { recursive: true })
  for (const name of await readdir(MIGRATIONS_FOLDER)) {
    if (name.endsWith('.sql')) await copyFile(join(MIGRATIONS_FOLDER, name), join(folder, name))
  }
  // The text whose hash a database one migration newer records for its newest migration.
  const tag = `${String(BUILD_LINEAGE.length).padStart(4, '0')}_one_more`
  await writeFile(join(folder, `${tag}.sql`), '-- a migration only a newer BroBot carries\n')
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Record<string, unknown>[] }
  const last = journal.entries.at(-1) ?? {}
  journal.entries.push({
    ...last,
    idx: journal.entries.length,
    when: NEWER_MIGRATION.createdAt,
    tag,
  })
  await writeFile(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  return folder
}

async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

describe('the three lines a start prints', () => {
  it('are these exact sentences, which something watching the start matches', () => {
    expect(READY_LINE).toBe('BroCrew is ready: its data is open and checked.')
    expect(CHECKPOINT_LINE).toBe('BroCrew made a checked recovery copy before changing its data.')
    expect(FAIL_LINE).toBe('BroCrew did not start.')
  })
})

describe('a start that opens its data', () => {
  it('opens a database this build fits, with no copy needed, and changes nothing', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const before = await treeOf(userData)
    const { deps, seen } = checkOf(userData)
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(await treeOf(userData)).toEqual(before)
    // Said before the database is read, in case reading it takes a while; a window that would say
    // so waits about two seconds first. No copy is made, so none is said.
    expect(seen).toEqual({ lines: [], working: ['check'], progress: [] })
  })

  it('reads a database closed cleanly through a link, which needs no room on the disk', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const before = await treeOf(userData)
    const { deps } = checkOf(userData, { freeBytes: () => 0 })
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(await treeOf(userData)).toEqual(before)
  })

  it('opens a new workspace whatever the one-app check said, and makes nothing', async () => {
    const userData = join(await aRoot(), 'data')
    await mkdir(userData)
    for (const ownership of ['sole', 'unknown', 'taken'] as const) {
      expect(await inspect(checkOf(userData, owned(ownership)).deps)).toEqual({
        kind: 'open',
        checkpoint: 'not-needed',
      })
    }
    expect(await readdir(userData)).toEqual([])
  })

  it('leaves the copies already kept as they are', async () => {
    const userData = await aWorkspace({
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD, THIS_BUILD],
    })
    const before = await treeOf(backupsDir(userData))
    expect(await inspect(checkOf(userData).deps)).toEqual({
      kind: 'open',
      checkpoint: 'not-needed',
    })
    expect(await treeOf(backupsDir(userData))).toEqual(before)
  })

  it('makes a copy at a packaged release’s first start, and none at its next', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const { deps, seen } = checkOf(userData, { packaged: true })
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'made' })
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(seen.lines).toEqual([CHECKPOINT_LINE])
    const [made, ...more] = await listCheckpoints(userData)
    expect(more).toEqual([])
    expect(made?.manifest.reason).toBe('first-start-of-release')
    expect(made?.manifest.madeBy).toEqual({ appVersion: THIS_VERSION, build: null })
  })
})

describe('a copy before a migration', () => {
  const now = Date.UTC(2026, 9, 16, 12)
  const day = 24 * 60 * 60 * 1000
  const dated = (daysAgo: number) => ({
    migrations: THIS_BUILD,
    createdAt: new Date(now - daysAgo * day).toISOString(),
  })
  const noRoom = async (userData: string): Promise<string> => {
    const bytes = (await stat(databaseFile(userData))).size
    return `There isn't enough free space for a recovery copy: it needs about ${inWords(Math.ceil(bytes * 1.1) + 64 * 1024 * 1024)}, and 1 MB is free.`
  }

  it('prunes a retention-droppable copy before retrying a full-disk migration copy', async () => {
    const userData = join(await aRoot(), 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [
        { ...dated(11), appVersion: '0.2.0' },
        { ...dated(10), fault: 'another-workspace' },
        dated(9),
        dated(2),
        dated(1),
      ],
      now,
    })
    const oldest = fixture.checkpoints[2]!
    const newest = fixture.checkpoints[4]!
    const { deps } = checkOf(userData, {
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      now: () => now,
      freeBytes: () => (existsSync(oldest.dir) ? 0 : 1_000_000_000),
    })

    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'made' })
    expect(existsSync(oldest.dir)).toBe(false)
    expect(existsSync(newest.dir)).toBe(true)
    expect(existsSync(fixture.checkpoints[0]!.dir), 'a newer build').toBe(true)
    expect(existsSync(fixture.checkpoints[1]!.dir), 'another workspace').toBe(true)
    expect(await listCheckpoints(userData)).toHaveLength(4)
  })

  it('keeps the newest copy and reports the approved words when pruning still leaves no room', async () => {
    const userData = join(await aRoot(), 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [dated(9), dated(2), dated(1)],
      now,
    })
    const { deps } = checkOf(userData, {
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      now: () => now,
      freeBytes: () => 0,
    })

    expect(await inspect(deps)).toEqual({
      kind: 'failed',
      reason: 'checkpoint-failed',
      canRetry: true,
      detail: `${await noRoom(userData)} BroCrew already removed its older recovery copies. Free some space, then try again.`,
    })
    expect(existsSync(fixture.checkpoints[0]!.dir)).toBe(false)
    expect(existsSync(fixture.checkpoints[2]!.dir)).toBe(true)
    expect((await listCheckpoints(userData)).map(({ manifest }) => manifest.id)).toEqual([
      fixture.checkpoints[2]!.id,
      fixture.checkpoints[1]!.id,
    ])
  })

  it('keeps a lone copy and uses only the first sentence when none can be pruned', async () => {
    const userData = join(await aRoot(), 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [dated(9)],
      now,
    })
    const { deps } = checkOf(userData, {
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      now: () => now,
      freeBytes: () => 0,
    })

    expect(await inspect(deps)).toEqual({
      kind: 'failed',
      reason: 'checkpoint-failed',
      canRetry: true,
      detail: await noRoom(userData),
    })
    expect(existsSync(fixture.checkpoints[0]!.dir)).toBe(true)
  })

  it('is made and checked before a pending migration, said once, and the data is unchanged', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const live = await sha256Of(databaseFile(userData))
    const { deps, seen } = checkOf(userData, {
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
    })
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'made' })
    expect(seen.lines).toEqual([CHECKPOINT_LINE])
    // Checking first; making a copy only once it has decided to.
    expect(seen.working).toEqual(['check', 'checkpoint'])
    const last = seen.progress.at(-1)
    expect(last?.[0]).toBe(last?.[1])
    expect(await sha256Of(databaseFile(userData))).toBe(live)
    const [made] = await listCheckpoints(userData)
    expect(made?.manifest.reason).toBe('before-migration')
    expect(made?.manifest.database.migrations).toHaveLength(THIS_BUILD)
  })

  it('is made once by a release: a retry after a failed migration reuses it', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const { deps, seen } = checkOf(userData, {
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      packaged: true,
    })
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'made' })
    expect(await inspect(deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(seen.lines).toEqual([CHECKPOINT_LINE])
    expect(await listCheckpoints(userData)).toHaveLength(1)
  })

  it('is made once by a build that is not packaged, known by its commit', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const buildMigrationsFolder = await aBuildWithOneMoreMigration()
    const { deps, seen } = checkOf(userData, { buildMigrationsFolder, build: 'b7c1d2e' })
    const service = createRecoveryService(deps)
    expect(await service.inspect()).toEqual({ kind: 'open', checkpoint: 'made' })
    expect(await service.retry()).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(await inspect(deps), 'the start after a relaunch').toEqual({
      kind: 'open',
      checkpoint: 'not-needed',
    })
    expect(seen.lines).toEqual([CHECKPOINT_LINE])
    const [made, ...more] = await listCheckpoints(userData)
    expect(more).toEqual([])
    expect(made?.manifest.madeBy).toEqual({ appVersion: THIS_VERSION, build: 'b7c1d2e' })

    const another = checkOf(userData, { buildMigrationsFolder, build: 'a0a0a0a' })
    expect(await inspect(another.deps), 'another commit').toEqual({
      kind: 'open',
      checkpoint: 'made',
    })
  })

  it('says it is working before it reads the database through a copy, or hashes a copy to reuse', async () => {
    const events: string[] = []
    const recording: RecoveryFs = {
      ...nodeFs,
      copyFile: (from, to, mode) => {
        events.push(`copy ${to}`)
        return nodeFs.copyFile(from, to, mode)
      },
      open: (path, flags, mode) => {
        if (path.includes(`${sep}backups${sep}`) && path.endsWith('database.sqlite')) {
          events.push(`read ${path}`)
        }
        return nodeFs.open(path, flags, mode)
      },
    }
    const said = (what: WorkingOn): number => events.push(`working ${what}`)

    const crashed = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [], crashed: true })
    const first = checkOf(crashed, { fs: recording, working: said })
    expect(await inspect(first.deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(events[0]).toBe('working check')
    expect(events.some((event) => event.startsWith('copy '))).toBe(true)

    events.length = 0
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const reusing = checkOf(userData, {
      fs: recording,
      working: said,
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      packaged: true,
    })
    expect(await inspect(reusing.deps)).toEqual({ kind: 'open', checkpoint: 'made' })
    events.length = 0
    expect(await inspect(reusing.deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    expect(events[0]).toBe('working check')
    expect(events.some((event) => event.startsWith('read '))).toBe(true)
  })

  it('refuses a start whose database a crash left, when the disk has no room to check it, and says so', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [], crashed: true })
    const before = await treeOf(userData)
    const noClones: RecoveryFs = {
      ...nodeFs,
      copyFile: (from, to, mode) =>
        ((mode ?? 0) & constants.COPYFILE_FICLONE_FORCE) !== 0
          ? Promise.reject(Object.assign(new Error('ENOTSUP: no clones'), { code: 'ENOTSUP' }))
          : nodeFs.copyFile(from, to, mode),
    }
    const verdict = await inspect(checkOf(userData, { fs: noClones, freeBytes: () => 0 }).deps)
    expect(verdict).toMatchObject({ kind: 'failed', reason: 'checkpoint-failed', canRetry: true })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toMatch(
      /not enough free space to check this workspace's data/,
    )
    expect(whyItDidNotStart(verdict)).not.toMatch(/unreadable|could not read/)
    expect(await treeOf(userData)).toEqual(before)
  })

  it('that cannot be made refuses the start, says why, and leaves the folder as it was', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const before = await treeOf(userData)
    const { deps, seen } = checkOf(userData, {
      buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      freeBytes: () => 0,
    })
    const verdict = await inspect(deps)
    expect(verdict).toMatchObject({ kind: 'failed', reason: 'checkpoint-failed', canRetry: true })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toMatch(/needs about .* free/)
    expect(seen.lines).toEqual([])
    expect(await treeOf(userData)).toEqual(before)
  })
})

describe('a database a newer build migrated', () => {
  it('is refused, with the copy this build can open and the version that moved it', async () => {
    const root = await aRoot()
    const userData = join(root, 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, THIS_BUILD, ONE_NEWER],
    })
    const before = await treeOf(userData)
    const offered = fixture.checkpoints[1]
    if (offered === undefined) throw new Error('the fixture made no second copy')
    expect(await inspect(checkOf(userData).deps)).toEqual({
      kind: 'newer',
      workspace: userData,
      newer: {
        inTheDatabase: ONE_NEWER,
        inTheBuild: THIS_BUILD,
        madeBy: { appVersion: NEWER_VERSION },
      },
      offers: {
        id: offered.id,
        createdAt: offered.manifest.createdAt,
        bytes: offered.manifest.database.bytes,
      },
    })
    expect(await treeOf(userData)).toEqual(before)
  })

  it('names the version from the copy it made before migrating, when it made no other', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, THIS_BUILD],
    })
    const verdict = await inspect(checkOf(userData).deps)
    expect(verdict).toMatchObject({
      kind: 'newer',
      newer: { madeBy: { appVersion: NEWER_VERSION } },
    })
  })

  it('does not offer a copy whose bytes changed; it offers the next whole one', async () => {
    const root = await aRoot()
    const userData = join(root, 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, { migrations: THIS_BUILD, fault: 'copy-changed' }, ONE_NEWER],
    })
    const verdict = await inspect(checkOf(userData).deps)
    expect(verdict.kind === 'newer' ? verdict.offers?.id : null).toBe(fixture.checkpoints[0]?.id)
  })

  it('offers nothing when no copy this build can open is kept, and names no version without one', async () => {
    const onlyNewer = await aWorkspace({ migrations: ONE_NEWER, checkpoints: [ONE_NEWER] })
    expect(await inspect(checkOf(onlyNewer).deps)).toMatchObject({
      kind: 'newer',
      newer: { madeBy: { appVersion: NEWER_VERSION } },
      offers: null,
    })
    const none = await aWorkspace({ migrations: ONE_NEWER, checkpoints: [] })
    expect(await inspect(checkOf(none).deps)).toMatchObject({
      kind: 'newer',
      newer: { inTheDatabase: ONE_NEWER, inTheBuild: THIS_BUILD, madeBy: null },
      offers: null,
    })
  })
})

describe('a start that cannot read what it needs fails closed', () => {
  it('refuses a database it cannot read, and writes nothing', async () => {
    const userData = join(await aRoot(), 'data')
    await mkdir(userData)
    await writeFile(databaseFile(userData), Buffer.alloc(8192, 0x5a))
    const before = await treeOf(userData)
    const verdict = await inspect(checkOf(userData).deps)
    expect(verdict).toMatchObject({ kind: 'failed', reason: 'database-unreadable', canRetry: true })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toMatch(/not a SQLite database/)
    expect(await treeOf(userData)).toEqual(before)
  })

  it('refuses tables with no migration record, which no migrator made', async () => {
    const userData = join(await aRoot(), 'data')
    await mkdir(userData)
    const db = new Database(databaseFile(userData))
    db.exec('CREATE TABLE somebody_elses (x)')
    db.close()
    const before = await treeOf(userData)
    expect(await inspect(checkOf(userData).deps)).toMatchObject({
      kind: 'failed',
      reason: 'database-unreadable',
    })
    expect(await treeOf(userData)).toEqual(before)
  })

  it('refuses migrations this build does not carry when none is later than its own', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const db = new Database(databaseFile(userData))
    db.prepare(
      'UPDATE __drizzle_migrations SET created_at = created_at - 1 WHERE created_at = (SELECT min(created_at) FROM __drizzle_migrations)',
    ).run()
    db.close()
    const before = await treeOf(userData)
    expect(await inspect(checkOf(userData).deps)).toMatchObject({
      kind: 'failed',
      reason: 'database-unreadable',
      canRetry: false,
    })
    expect(await treeOf(userData)).toEqual(before)
  })

  it('refuses a -wal with no database beside it, rather than make a new one it would take in', async () => {
    const userData = join(await aRoot(), 'data')
    await mkdir(userData)
    await writeFile(`${databaseFile(userData)}-wal`, Buffer.alloc(4096, 1))
    const verdict = await inspect(checkOf(userData).deps)
    expect(verdict).toMatchObject({
      kind: 'failed',
      reason: 'database-unreadable',
      canRetry: false,
    })
    expect(await readdir(userData)).toEqual(['brobot2.sqlite-wal'])
  })

  it('refuses a restore record it cannot read, whatever the one-app check said, and touches nothing', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
    })
    await mkdir(recoveryDir(userData))
    await writeFile(journalFile(userData), '{ "format": "brobot-restore", "version": 1')
    const before = await treeOf(userData)
    for (const ownership of ['sole', 'unknown'] as const) {
      const verdict = await inspect(checkOf(userData, owned(ownership)).deps)
      expect(verdict).toMatchObject({
        kind: 'failed',
        reason: 'recovery-unreadable',
        canRetry: false,
      })
      expect(verdict.kind === 'failed' ? verdict.detail : '').toMatch(/not JSON/)
    }
    expect(await treeOf(userData)).toEqual(before)
  })

  it('offers a retry when a record could not be read, which may pass; never when it does not parse', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      gate: true,
    })
    const failing = (path: string): RecoveryFs => ({
      ...nodeFs,
      readFile: (file) =>
        file === path
          ? Promise.reject(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }))
          : nodeFs.readFile(file),
    })
    const before = await treeOf(userData)
    expect(
      await inspect({ ...checkOf(userData).deps, fs: failing(gateFile(userData)) }),
    ).toMatchObject({ kind: 'failed', reason: 'recovery-unreadable', canRetry: true })
    await writeFile(journalFile(userData), '{}')
    expect(
      await inspect({ ...checkOf(userData).deps, fs: failing(journalFile(userData)) }),
    ).toMatchObject({ kind: 'failed', reason: 'recovery-unreadable', canRetry: true })
    expect(await inspect(checkOf(userData).deps)).toMatchObject({
      kind: 'failed',
      reason: 'recovery-unreadable',
      canRetry: false,
    })
    await rm(journalFile(userData))
    expect(await treeOf(userData)).toEqual(before)
  })

  it('refuses a history-only record it cannot read, or of a later version, and touches nothing', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      gate: true,
    })
    const gate = JSON.parse(await readFile(gateFile(userData), 'utf8')) as Record<string, unknown>
    for (const text of ['not json', JSON.stringify({ ...gate, version: 2 })]) {
      await writeFile(gateFile(userData), text)
      const before = await treeOf(userData)
      expect(await inspect(checkOf(userData).deps)).toMatchObject({
        kind: 'failed',
        reason: 'recovery-unreadable',
        canRetry: false,
      })
      expect(await treeOf(userData)).toEqual(before)
    }
  })
})

describe('a restored copy behind the history-only gate', () => {
  it('opens read-only while the database is the copy the gate names', async () => {
    const root = await aRoot()
    const userData = join(root, 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      gate: true,
    })
    const before = await treeOf(userData)
    expect(await inspect(checkOf(userData).deps)).toEqual({
      kind: 'history-only',
      gate: fixture.restore?.gate,
      database: databaseFile(userData),
    })
    expect(await treeOf(userData)).toEqual(before)
  })

  it('is replaced-outside when the database is not that copy, and nothing is touched', async () => {
    const root = await aRoot()
    const userData = join(root, 'data')
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      gate: true,
    })
    const createdAt = fixture.restore?.gate?.checkpointCreatedAt
    await appendFile(databaseFile(userData), Buffer.alloc(16, 0))
    const before = await treeOf(userData)
    const verdict = await inspect(checkOf(userData).deps)
    expect(verdict).toMatchObject({
      kind: 'failed',
      reason: 'replaced-outside',
      canRetry: false,
      where: 'gate',
      checkpointCreatedAt: createdAt,
    })
    expect(await treeOf(userData)).toEqual(before)
  })

  it('is replaced-outside when a sidecar sits beside the copy, which is one file', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      gate: true,
    })
    await writeFile(`${databaseFile(userData)}-wal`, Buffer.alloc(32, 1))
    const before = await treeOf(userData)
    expect(await inspect(checkOf(userData).deps)).toMatchObject({
      kind: 'failed',
      reason: 'replaced-outside',
      where: 'gate',
    })
    expect(await treeOf(userData)).toEqual(before)
  })
})

describe('only the sole app on the folder changes its data', () => {
  for (const ownership of ['unknown', 'taken'] as const) {
    it(`refuses a copy when the one-app check said ${ownership}, and makes nothing`, async () => {
      const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
      const before = await treeOf(userData)
      const { deps, seen } = checkOf(userData, {
        ...owned(ownership),
        buildMigrationsFolder: await aBuildWithOneMoreMigration(),
      })
      expect(await inspect(deps)).toEqual(notTheOnlyApp(ownership))
      expect(seen.lines).toEqual([])
      expect(await treeOf(userData)).toEqual(before)
    })

    it(`refuses a migration when it said ${ownership}, even with a copy made before it kept`, async () => {
      const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
      const buildMigrationsFolder = await aBuildWithOneMoreMigration()
      const made = checkOf(userData, { buildMigrationsFolder, packaged: true })
      expect(await inspect(made.deps)).toEqual({ kind: 'open', checkpoint: 'made' })
      const before = await treeOf(userData)
      const { deps } = checkOf(userData, {
        ...owned(ownership),
        buildMigrationsFolder,
        packaged: true,
      })
      expect(await inspect(deps)).toEqual(notTheOnlyApp(ownership))
      expect(await treeOf(userData)).toEqual(before)
      // The sole app reuses the copy and migrates.
      expect(await inspect(made.deps)).toEqual({ kind: 'open', checkpoint: 'not-needed' })
    })

    it(`lets no old copy go when it said ${ownership}`, async () => {
      const userData = await aWorkspace({
        migrations: THIS_BUILD,
        checkpoints: [THIS_BUILD, THIS_BUILD, THIS_BUILD, THIS_BUILD, THIS_BUILD],
      })
      const before = await treeOf(userData)
      expect(await pruneTheCopies(userData, MIGRATIONS_FOLDER, ownership, () => undefined)).toEqual(
        [],
      )
      expect(await treeOf(userData)).toEqual(before)
    })

    it(`refuses a restore, and settling an unfinished one, when it said ${ownership}`, async () => {
      const newer = await aWorkspace({
        migrations: ONE_NEWER,
        checkpoints: [THIS_BUILD, ONE_NEWER],
      })
      const service = createRecoveryService(checkOf(newer, owned(ownership)).deps)
      const verdict = await service.inspect()
      if (verdict.kind !== 'newer' || verdict.offers === null) throw new Error('nothing offered')
      const before = await treeOf(newer)
      expect(await service.restore(verdict.offers.id, quiet)).toEqual(notTheOnlyApp(ownership))
      expect(await treeOf(newer)).toEqual(before)

      const unfinished = await aWorkspace({
        migrations: ONE_NEWER,
        checkpoints: [THIS_BUILD, ONE_NEWER],
        journalAt: 'moving',
      })
      const left = await treeOf(unfinished)
      expect(await inspect(checkOf(unfinished, owned(ownership)).deps)).toMatchObject({
        kind: 'failed',
        reason: 'not-the-only-app-on-this-folder',
        ownership,
      })
      expect(await treeOf(unfinished)).toEqual(left)
    })
  }
})

describe('a start the one-app check could not decide', () => {
  it('may be tried again, and the try asks the check again', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const answers: Ownership[] = ['unknown', 'sole']
    const service = createRecoveryService(
      checkOf(userData, {
        buildMigrationsFolder: await aBuildWithOneMoreMigration(),
        ownership: () => Promise.resolve(answers.shift() ?? 'unknown'),
      }).deps,
    )
    const first = await service.inspect()
    expect(first).toEqual(notTheOnlyApp('unknown'))
    expect(whyItDidNotStart(first)).toMatch(/could not be sure/)
    expect(await service.retry()).toEqual({ kind: 'open', checkpoint: 'made' })
  })

  it('says another BroBot has the workspace open when the check said so', () => {
    expect(whyItDidNotStart(notTheOnlyApp('taken'))).toBe(
      'Another copy of BroCrew has this workspace open.',
    )
  })
})

describe('the recovery window’s service', () => {
  it('restores the offered copy into a history-only start, and returns to the newer data', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      drafts: true,
    })
    const newerDatabase = await sha256Of(databaseFile(userData))
    const service = createRecoveryService(checkOf(userData).deps)
    const first = await service.inspect()
    if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')

    const ticks: number[] = []
    const restored = await service.restore(first.offers.id, (done) => ticks.push(done))
    expect(restored).toMatchObject({
      kind: 'history-only',
      gate: { checkpointId: first.offers.id, checkpointCreatedAt: first.offers.createdAt },
      database: databaseFile(userData),
    })
    expect(ticks.length).toBeGreaterThan(1)
    expect(await service.inspect()).toEqual(restored)

    expect(await service.returnToNewer(quiet)).toEqual(first)
    expect(await sha256Of(databaseFile(userData))).toBe(newerDatabase)
  })

  it('settles a restore a fault stopped part way, at once: one past its journal is finished', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
    })
    const service = withFaults(checkOf(userData).deps, { at: 'installed', error: 'EBUSY' })
    const first = await service.inspect()
    if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')
    expect(await service.restore(first.offers.id, quiet)).toMatchObject({ kind: 'history-only' })
  })

  it('says a restore that stopped before its journal changed nothing, and may be tried again', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
    })
    const service = withFaults(checkOf(userData).deps, { at: 'staged', error: 'ENOSPC' })
    const first = await service.inspect()
    if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')
    const before = await treeOf(userData)
    const verdict = await service.restore(first.offers.id, quiet)
    expect(verdict).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      during: 'restore',
      canRetry: true,
    })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toMatch(/ENOSPC/)
    expect(await treeOf(userData)).toEqual(before)
    expect(await service.retry()).toEqual(first)
  })

  it('stops a copy at the step a fault names, and after it when asked', async () => {
    const userData = await aWorkspace({ migrations: THIS_BUILD, checkpoints: [] })
    const buildMigrationsFolder = await aBuildWithOneMoreMigration()
    for (const faults of [{ at: 'copy' }, { at: 'files', after: true }] as const) {
      const service = withFaults(checkOf(userData, { buildMigrationsFolder }).deps, faults)
      expect(await service.inspect()).toMatchObject({ kind: 'failed', reason: 'checkpoint-failed' })
      expect(await listCheckpoints(userData)).toEqual([])
    }
  })

  it('stops a restore after a step’s work, before its journal names it, and settles it at once', async () => {
    for (const at of ['staged', 'gate-installed', 'moving', 'installed', 'done'] as const) {
      const userData = await aWorkspace({
        migrations: ONE_NEWER,
        checkpoints: [THIS_BUILD, ONE_NEWER],
      })
      const service = withFaults(checkOf(userData).deps, { at, after: true, error: 'EACCES' })
      const first = await service.inspect()
      if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')
      const settled = await service.restore(first.offers.id, quiet)
      // Settled one way or the other, never left half way.
      expect(['history-only', 'failed']).toContain(settled.kind)
      if (settled.kind === 'failed') expect(settled).toMatchObject({ reason: 'restore-failed' })
      await expect(stat(journalFile(userData))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('stops a restore just after one file’s rename, and settles it at once', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      drafts: true,
    })
    const newerDatabase = await sha256Of(databaseFile(userData))
    for (const at of [
      { move: 'brobot2.sqlite', to: 'aside' },
      { move: 'drafts.json', to: 'aside' },
      { move: 'brobot2.sqlite', to: 'live' },
    ] as const) {
      const service = withFaults(checkOf(userData).deps, { at, error: 'EBUSY' })
      const first = await service.inspect()
      if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')
      expect(await service.restore(first.offers.id, quiet)).toMatchObject({ kind: 'history-only' })
      await expect(stat(journalFile(userData))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await service.returnToNewer(quiet)).toEqual(first)
      expect(await sha256Of(databaseFile(userData))).toBe(newerDatabase)
    }
  })

  it('carries each fault on the hook its point is reached by, and fires it once', () => {
    expect(Object.keys(hooksFor({ at: 'staged' }))).toEqual(['beforeStep'])
    expect(Object.keys(hooksFor({ at: 'staged', after: true }))).toEqual(['afterStep'])
    expect(Object.keys(hooksFor({ at: { move: 'brobot2.sqlite', to: 'aside' } }))).toEqual([
      'afterMove',
    ])
    expect(Object.keys(hooksFor({ at: 'copy' }))).toEqual(['beforeCheckpointStep'])
    expect(() => hooksFor({ at: 'manifest', after: true })).toThrow(/no step after/)
    const { beforeStep } = hooksFor({ at: 'moving', error: 'ENOSPC' })
    let thrown: unknown = null
    try {
      beforeStep?.('moving')
    } catch (error) {
      thrown = error
    }
    expect(errorCode(thrown)).toBe('ENOSPC')
    expect(() => beforeStep?.('moving')).not.toThrow()
  })

  it('refuses a return whose set-aside data changed outside BroBot, as changed outside, and touches nothing', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      crashed: true,
    })
    const service = createRecoveryService(checkOf(userData).deps)
    const first = await service.inspect()
    if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')
    const restored = await service.restore(first.offers.id, quiet)
    if (restored.kind !== 'history-only') throw new Error(`restored to ${restored.kind}`)
    const preserved = join(userData, ...restored.gate.preserved.split('/'))
    expect(await readdir(preserved)).toContain('database.sqlite-wal')
    await rm(join(preserved, 'database.sqlite-wal'))
    const before = await treeOf(userData)

    const verdict = await service.returnToNewer(quiet)

    expect(verdict).toMatchObject({
      kind: 'failed',
      reason: 'replaced-outside',
      canRetry: false,
      where: 'gate',
      checkpointCreatedAt: restored.gate.checkpointCreatedAt,
    })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toContain('database.sqlite-wal')
    expect(await treeOf(userData)).toEqual(before)
    expect(await service.inspect(), 'the restored copy stays readable').toEqual(restored)
  })

  it('says once why a restore it could not undo stopped, and leaves the rest to the next start', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
    })
    let intoPlace = 0
    const stuck: RecoveryFs = {
      ...nodeFs,
      rename: (from, to) => {
        if (!to.endsWith(`${sep}brobot2.sqlite`)) return nodeFs.rename(from, to)
        intoPlace += 1
        return Promise.reject(Object.assign(new Error('EXDEV: another disk'), { code: 'EXDEV' }))
      },
    }
    const service = createRecoveryService(checkOf(userData, { fs: stuck }).deps)
    const first = await service.inspect()
    if (first.kind !== 'newer' || first.offers === null) throw new Error('nothing offered')

    const verdict = await service.restore(first.offers.id, quiet)

    expect(verdict).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      during: 'restore',
      canRetry: false,
    })
    const detail = verdict.kind === 'failed' ? (verdict.detail ?? '') : ''
    expect(detail).toContain('could not put brobot2.sqlite back')
    expect(detail).toContain('another disk')
    expect(detail).toContain('tries again the next time it starts')
    expect(intoPlace, 'once forward and once back, and not again at once').toBe(2)
    await expect(stat(journalFile(userData))).resolves.toBeDefined()

    expect(await inspect(checkOf(userData).deps), 'the next start').toMatchObject({
      kind: 'history-only',
    })
    await expect(stat(journalFile(userData))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to restore a copy it does not keep, and changes nothing', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
    })
    const service = createRecoveryService(checkOf(userData).deps)
    const before = await treeOf(userData)
    expect(await service.restore('not-a-copy', quiet)).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      canRetry: false,
    })
    expect(await treeOf(userData)).toEqual(before)
  })
})

describe('a database this build fits, with a recovery record beside it', () => {
  it('never opens normally while a history-only gate stands', async () => {
    const userData = await aWorkspace({
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      gate: true,
    })
    for (const ownership of ['sole', 'unknown'] as const) {
      expect(await inspect(checkOf(userData, owned(ownership)).deps)).toMatchObject({
        kind: 'history-only',
      })
    }
    await appendFile(databaseFile(userData), Buffer.alloc(16, 0))
    expect(await inspect(checkOf(userData).deps)).toMatchObject({
      kind: 'failed',
      reason: 'replaced-outside',
      where: 'gate',
    })
  })

  it('refuses before any ordinary open while a journal is there, unreadable or not', async () => {
    const userData = await aWorkspace({
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      journalAt: 'moving',
    })
    const left = await treeOf(userData)
    expect(await inspect(checkOf(userData, owned('unknown')).deps)).toEqual(
      notTheOnlyApp('unknown'),
    )
    expect(await treeOf(userData)).toEqual(left)

    const journal = await readFile(journalFile(userData), 'utf8')
    await writeFile(journalFile(userData), journal.slice(0, journal.length / 2))
    const before = await treeOf(userData)
    for (const ownership of ['sole', 'unknown'] as const) {
      expect(await inspect(checkOf(userData, owned(ownership)).deps)).toMatchObject({
        kind: 'failed',
        reason: 'recovery-unreadable',
        canRetry: false,
      })
    }
    expect(await treeOf(userData)).toEqual(before)
  })

  it('settles a journal found under the sole app, and does not open the data for work', async () => {
    const userData = await aWorkspace({
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      journalAt: 'moving',
    })
    expect(await inspect(checkOf(userData).deps)).toMatchObject({ kind: 'history-only' })
    const planned = await aWorkspace({
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      journalAt: 'planned',
    })
    expect(await inspect(checkOf(planned).deps)).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      during: 'restore',
    })
  })
})

describe('an unfinished restore found at start', () => {
  it('is finished when its copy still passes its check, and the start is history-only', async () => {
    const userData = await aWorkspace({
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      journalAt: 'moving',
    })
    const { deps, seen } = checkOf(userData)
    expect(await inspect(deps)).toMatchObject({ kind: 'history-only' })
    expect(seen.working).toEqual(['restore'])
    await expect(stat(journalFile(userData))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('what a start that did not open prints after the fail line', () => {
  it('says the verdict in one sentence, with the check’s own detail', () => {
    const newer: StartupVerdict = {
      kind: 'newer',
      workspace: '/w',
      newer: { inTheDatabase: ONE_NEWER, inTheBuild: THIS_BUILD, madeBy: null },
      offers: null,
    }
    expect(whyItDidNotStart(newer)).toBe(
      `A newer version of BroCrew has updated this workspace's data (/w) to database version ${String(ONE_NEWER)}, and this ` +
        `version of BroCrew reads up to version ${String(THIS_BUILD)}. No recovery copy this version of BroCrew can open is kept.`,
    )
    expect(
      whyItDidNotStart({
        kind: 'failed',
        reason: 'migration-failed',
        canRetry: true,
        detail: 'It broke.',
      }),
    ).toBe("BroCrew could not update this workspace's data to this version. It broke.")
  })
})

describe('a fault a launch asks for', () => {
  it('names a step, and may say after it and which error, or one file’s rename', () => {
    expect(faultsFromSwitch('installed')).toEqual({ at: 'installed' })
    expect(faultsFromSwitch('staged,after,EBUSY')).toEqual({
      at: 'staged',
      after: true,
      error: 'EBUSY',
    })
    expect(faultsFromSwitch('copy,ENOSPC')).toEqual({ at: 'copy', error: 'ENOSPC' })
    expect(faultsFromSwitch('move:brobot2.sqlite:aside,EACCES')).toEqual({
      at: { move: 'brobot2.sqlite', to: 'aside' },
      error: 'EACCES',
    })
  })

  it('is refused when it names nothing this build knows', () => {
    expect(faultsFromSwitch('')).toBeNull()
    expect(faultsFromSwitch('somewhere')).toBeNull()
    expect(faultsFromSwitch('installed,EIO')).toBeNull()
    expect(faultsFromSwitch('manifest,after')).toBeNull()
    expect(faultsFromSwitch('move:brobot2.sqlite:elsewhere')).toBeNull()
    expect(faultsFromSwitch('move:brobot2.sqlite:aside,after')).toBeNull()
  })
})

describe('a test keeping the recovery window on a hidden launch', () => {
  it('says its name is for tests', () => {
    expect(KEEP_RECOVERY_WINDOW_SWITCH).toBe('brobot-test-keep-recovery-window')
  })

  it('is kept by a build that is not packaged, and said', () => {
    const said: string[] = []
    expect(keepsTheRecoveryWindow(true, false, (line) => said.push(line))).toBe(true)
    expect(said).toEqual([
      'BroCrew keeps its recovery window on a hidden launch: --brobot-test-keep-recovery-window',
    ])
  })

  it('is ignored by a packaged build, and the ignoring is said', () => {
    const said: string[] = []
    expect(keepsTheRecoveryWindow(true, true, (line) => said.push(line))).toBe(false)
    expect(said).toEqual([
      'BroCrew ignored --brobot-test-keep-recovery-window: a packaged build takes no test switch',
    ])
  })

  it('changes nothing and says nothing when it was not asked for', () => {
    const said: string[] = []
    expect(keepsTheRecoveryWindow(false, false, (line) => said.push(line))).toBe(false)
    expect(keepsTheRecoveryWindow(false, true, (line) => said.push(line))).toBe(false)
    expect(said).toEqual([])
  })
})
