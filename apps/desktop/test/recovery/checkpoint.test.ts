import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import {
  CheckpointFailed,
  checkpointNeeded,
  isIntact,
  listCheckpoints,
  listOfferable,
  makeCheckpoint,
  needsACheckpoint,
  offeredFrom,
  prune,
  recordSuccessfulStart,
  retainedCopyInfo,
  deleteRetainedCopy,
  theNewestIntact,
  whenTheDatabaseLastChanged,
  type Checkpoint,
  type CheckpointFacts,
  type CheckpointStep,
  type MakeCheckpointOptions,
  type PruneOptions,
} from '../../src/main/recovery/checkpoint'
import {
  parseManifest,
  type CheckpointManifest,
  type Migration,
} from '../../src/main/recovery/contract'
import {
  buildLineage,
  migrationsOf,
  type BuildMigration,
  type MigrationsOnDisk,
} from '../../src/main/recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'
import { CHECKPOINT_LINE } from '../../src/main/recovery/log-lines'
import { APP_STATE_FILES } from '../../src/main/recovery/state-files'
import type { CheckpointDeletion } from '../../src/main/recovery/checkpoint-deletion'
import { accessEntries, windowsAccessLists } from '../../src/main/recovery/windows-privacy'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(here, '../../src/main/db/migrations')

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}
const JOURNAL = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
  entries: JournalEntry[]
}
/** The `when` of every migration this build carries, oldest first. */
const THE_BUILDS = JOURNAL.entries.map((entry) => entry.when)
const LATEST = THE_BUILDS[THE_BUILDS.length - 1] ?? 0
/** A migration later than any this build carries. */
const A_LATER_ONE = LATEST + 86_400_000
const LATER_HASH = 'f'.repeat(64)
/** That migration, as a build that carries it lists it. */
const LATER: BuildMigration = { createdAt: A_LATER_ONE, hash: LATER_HASH, recordedAs: [LATER_HASH] }

/** This build's migrations, read as the coordinator reads them. */
let LINEAGE: readonly BuildMigration[]
/** The same, as a database that applied them records them. */
let OWN: readonly Migration[]
beforeAll(async () => {
  LINEAGE = await buildLineage(MIGRATIONS)
  OWN = LINEAGE.map(({ createdAt, hash }) => ({ createdAt, hash }))
})

const POSIX = process.platform !== 'win32'
const START = Date.UTC(2026, 9, 1, 9, 0, 0)
const minute = (n: number): number => START + n * 60_000
const DAY_MS = 24 * 60 * 60 * 1000

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-checkpoint-'))
  roots.push(root)
  return root
}

function aDataFolder(): string {
  const userData = join(aRoot(), 'data')
  mkdirSync(userData)
  return userData
}

function liveFile(userData: string): string {
  return join(userData, 'brobot2.sqlite')
}

const FILLER_ROWS = 300

/** Rows enough to span many pages, in a table of the test's own. */
function fill(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS filler (n INTEGER, body BLOB)')
  const insert = db.prepare('INSERT INTO filler VALUES (?, ?)')
  for (let n = 0; n < FILLER_ROWS; n += 1) insert.run(n, Buffer.alloc(1000, n % 251))
}

/** The live database, migrated as the app migrates its own, holding some rows, and closed. */
function aLiveDatabase(userData: string, migrations = MIGRATIONS): void {
  const db = openDatabase(liveFile(userData))
  applyMigrations(db, migrations)
  fill(db)
  db.close()
}

/** A migrations folder holding this build's first `count` migrations. */
function theFirstMigrations(count: number): string {
  const folder = join(aRoot(), 'migrations')
  cpSync(MIGRATIONS, folder, { recursive: true })
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...JOURNAL, entries: JOURNAL.entries.slice(0, count) }),
  )
  return folder
}

/** This build's migrations plus a later one that fails. */
function migrationsWithOneThatFails(): string {
  const folder = join(aRoot(), 'migrations')
  cpSync(MIGRATIONS, folder, { recursive: true })
  const tag = '0099_fails'
  writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE fails (;\n')
  const entry = {
    idx: JOURNAL.entries.length,
    version: '6',
    when: A_LATER_ONE,
    tag,
    breakpoints: true,
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...JOURNAL, entries: [...JOURNAL.entries, entry] }),
  )
  return folder
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fingerprint(file: string): { bytes: number; mtimeMs: number; sha256: string } {
  return {
    bytes: statSync(file).size,
    mtimeMs: statSync(file).mtimeMs,
    sha256: sha256(readFileSync(file)),
  }
}

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: made up by the test`), { code })
}

const SOLE: PruneOptions = { ownership: 'sole' }

function make(userData: string, options: Partial<MakeCheckpointOptions> = {}): Promise<Checkpoint> {
  return makeCheckpoint({
    userData,
    ownership: 'sole',
    appVersion: '0.1.0',
    build: 'b7c1d2e',
    reason: 'first-start-of-release',
    log: () => undefined,
    ...options,
  })
}

function rows(file: string): number {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return (db.prepare('SELECT count(*) AS n FROM filler').get() as { n: number }).n
  } finally {
    db.close()
  }
}

function manifestPath(userData: string, id: string): string {
  return join(userData, 'backups', id, 'manifest.json')
}

/** Rewrites a checkpoint's manifest as given, valid or not. */
function rewrite(userData: string, id: string, value: unknown): void {
  writeFileSync(manifestPath(userData, id), `${JSON.stringify(value, null, 2)}\n`)
}

/** A copy of a checkpoint's folder under a new id, its manifest changed as given. */
function copyOf(
  userData: string,
  from: Checkpoint,
  change: (manifest: CheckpointManifest) => object = (manifest) => manifest,
): string {
  const id = randomUUID()
  cpSync(from.folder, join(userData, 'backups', id), { recursive: true })
  rewrite(userData, id, { ...change(from.manifest), id })
  return id
}

/** The manifest of a copy made by a build with one migration more than this one. */
function oneMigrationLater(manifest: CheckpointManifest, createdAt: number): object {
  const { migrations } = manifest.database
  return {
    ...manifest,
    createdAt: new Date(createdAt).toISOString(),
    madeBy: { appVersion: '0.2.0', build: null },
    database: {
      ...manifest.database,
      migrations: [...migrations, { createdAt: A_LATER_ONE, hash: LATER_HASH }],
    },
  }
}

const ids = (checkpoints: readonly Checkpoint[]): string[] =>
  checkpoints.map(({ manifest }) => manifest.id)

describe('makeCheckpoint', () => {
  it('makes a copy SQLite checks, with the state files beside it and a manifest this build reads', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const planted: Record<string, string> = {
      'drafts.json': '{"version":1,"drafts":{"one":"an unsent line"}}\n',
      'sign-in-changes.json': '{"version":1,"changed":{}}\n',
    }
    for (const [name, text] of Object.entries(planted)) writeFileSync(join(userData, name), text)
    const ticks: [number, number][] = []
    const lines: string[] = []

    const { folder, manifest } = await make(userData, {
      now: () => minute(0),
      progress: (done, total) => ticks.push([done, total]),
      log: (line) => lines.push(line),
    })

    expect(folder).toBe(join(userData, 'backups', manifest.id))
    expect(manifest.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(parseManifest(readFileSync(join(folder, 'manifest.json'), 'utf8'))).toEqual({
      ok: true,
      value: manifest,
    })
    const workspaceId = readFileSync(join(userData, 'backups', 'workspace-id'), 'utf8').trim()
    const copy = join(folder, 'database.sqlite')
    const recorded = await migrationsOf(copy)
    expect(recorded.kind).toBe('recorded')
    expect(manifest).toEqual({
      format: 'brobot-checkpoint',
      version: 1,
      id: manifest.id,
      createdAt: new Date(minute(0)).toISOString(),
      workspaceId,
      reason: 'first-start-of-release',
      madeBy: { appVersion: '0.1.0', build: 'b7c1d2e' },
      database: {
        file: 'database.sqlite',
        bytes: statSync(copy).size,
        sha256: sha256(readFileSync(copy)),
        migrations: recorded.kind === 'recorded' ? recorded.migrations : [],
      },
      files: APP_STATE_FILES.map(({ name }) => {
        const text = planted[name]
        return text === undefined
          ? { name, present: false }
          : { name, present: true, bytes: Buffer.byteLength(text), sha256: sha256(text) }
      }),
    })
    for (const [name, text] of Object.entries(planted)) {
      expect(readFileSync(join(folder, name), 'utf8')).toBe(text)
    }

    const db = new Database(copy, { readonly: true, fileMustExist: true })
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    db.close()
    expect(rows(copy)).toBe(FILLER_ROWS)

    expect(ticks.length).toBeGreaterThan(1)
    const total = ticks[0]?.[1] ?? 0
    expect(total).toBeGreaterThan(0)
    for (const [index, [done, of]] of ticks.entries()) {
      expect(of).toBe(total)
      expect(done).toBeGreaterThanOrEqual(ticks[index - 1]?.[0] ?? 0)
    }
    expect(ticks[ticks.length - 1]).toEqual([total, total])
    expect(lines).toEqual([CHECKPOINT_LINE])
  })

  it('leaves the copy as one rollback-mode file with no sidecars, private to this user', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{}\n', { mode: 0o644 })
    const { folder } = await make(userData)
    const copy = join(folder, 'database.sqlite')

    expect(readdirSync(folder).sort()).toEqual(['database.sqlite', 'drafts.json', 'manifest.json'])
    const header = readFileSync(copy).subarray(0, 100)
    expect([header[18], header[19]], 'the header says rollback journal, not WAL').toEqual([1, 1])

    // A read-only reader opens it in place and leaves nothing beside it.
    expect(rows(copy)).toBe(FILLER_ROWS)
    expect(readdirSync(folder).sort()).toEqual(['database.sqlite', 'drafts.json', 'manifest.json'])

    if (POSIX) {
      const mode = (path: string): number => statSync(path).mode & 0o777
      expect(mode(join(userData, 'backups'))).toBe(0o700)
      expect(mode(folder)).toBe(0o700)
      expect(mode(copy)).toBe(0o600)
      expect(mode(join(folder, 'drafts.json'))).toBe(0o600)
      expect(mode(join(folder, 'manifest.json'))).toBe(0o600)
      expect(mode(join(userData, 'backups', 'workspace-id'))).toBe(0o600)
    }
  })

  it.runIf(!POSIX)(
    'on Windows, keeps backups to this user even in a data folder every user may read',
    async () => {
      const userData = aDataFolder()
      const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe')
      execFileSync(icacls, [userData, '/grant', '*S-1-5-32-545:(OI)(CI)RX', '/Q'])
      aLiveDatabase(userData)
      const { folder } = await make(userData)
      const user = await windowsAccessLists.userSid()
      for (const path of [join(userData, 'backups'), folder, join(folder, 'database.sqlite')]) {
        const allowed = accessEntries(
          await windowsAccessLists.read(path),
          await windowsAccessLists.machineSid(),
        )
          .filter((entry) => entry.allows)
          .map((entry) => entry.sid)
        expect(new Set(allowed), path).toEqual(new Set([user, 'S-1-5-18', 'S-1-5-32-544']))
      }
    },
  )

  it('leaves the live database and its folder as they were', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const before = fingerprint(liveFile(userData))
    const names = readdirSync(userData).sort()

    await make(userData)

    expect(fingerprint(liveFile(userData))).toEqual(before)
    expect(readdirSync(userData).sort()).toEqual([...names, 'backups'].sort())
  })

  it('copies what a crash left only in the -wal', async () => {
    const userData = aDataFolder()
    const elsewhere = join(aRoot(), 'live.sqlite')
    const db = openDatabase(elsewhere)
    db.pragma('wal_autocheckpoint = 0')
    applyMigrations(db, MIGRATIONS)
    fill(db)
    // What a crash leaves: the main file and a -wal holding the work, with no -shm.
    copyFileSync(elsewhere, liveFile(userData))
    copyFileSync(`${elsewhere}-wal`, `${liveFile(userData)}-wal`)
    db.close()
    expect(statSync(`${liveFile(userData)}-wal`).size).toBeGreaterThan(0)

    const { folder, manifest } = await make(userData)

    expect(manifest.database.migrations.map(({ createdAt }) => createdAt)).toEqual(THE_BUILDS)
    expect(rows(join(folder, 'database.sqlite'))).toBe(FILLER_ROWS)
    expect(readdirSync(folder).sort()).toEqual(['database.sqlite', 'manifest.json'])
  })

  it('marks its folder unfinished from its first file until the manifest is written', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{}\n')
    const seen: [CheckpointStep, string[]][] = []
    let folder = ''
    const recording: RecoveryFs = {
      ...nodeFs,
      writeFile: async (path, data, options) => {
        if (path.endsWith(`${sep}unfinished`)) {
          folder = dirname(path)
          expect(readdirSync(folder), 'the first file in the folder').toEqual([])
        }
        await nodeFs.writeFile(path, data, options)
      },
    }

    const made = await make(userData, {
      fs: recording,
      beforeStep: (step) => seen.push([step, readdirSync(folder).sort()]),
    })

    expect(made.folder).toBe(folder)
    for (const [step, names] of seen) expect(names, step).toContain('unfinished')
    expect(seen.map(([step]) => step)).toEqual(['copy', 'verify', 'files', 'manifest'])
    expect(readdirSync(folder).sort()).toEqual(['database.sqlite', 'drafts.json', 'manifest.json'])
  })

  it('keeps one workspace id for every copy, and gives each copy a folder of its own', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const first = await make(userData)
    const idFile = join(userData, 'backups', 'workspace-id')
    const written = readFileSync(idFile, 'utf8')
    const second = await make(userData)

    expect(readFileSync(idFile, 'utf8')).toBe(written)
    expect(second.manifest.workspaceId).toBe(first.manifest.workspaceId)
    expect(second.manifest.id).not.toBe(first.manifest.id)
    expect(readdirSync(join(userData, 'backups')).sort()).toEqual(
      [first.manifest.id, second.manifest.id, 'workspace-id'].sort(),
    )
  })

  it.each(['unknown', 'taken'] as const)(
    'makes nothing when the one-app check says %s',
    async (ownership) => {
      const userData = aDataFolder()
      aLiveDatabase(userData)
      const failure = await make(userData, { ownership }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(CheckpointFailed)
      expect((failure as CheckpointFailed).canRetry).toBe(false)
      expect(readdirSync(userData)).not.toContain('backups')
    },
  )

  it('says how much space it needs, and makes nothing, when the disk is too full', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const failure = await make(userData, { freeBytes: () => 1_000_000 }).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(CheckpointFailed)
    expect((failure as CheckpointFailed).canRetry).toBe(true)
    expect((failure as Error).message).toMatch(
      /needs about \d+ MB free on its disk, and 1 MB is free/,
    )
    expect(readdirSync(userData)).not.toContain('backups')
  })

  it('never replaces a workspace id it cannot read', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    mkdirSync(join(userData, 'backups'))
    const idFile = join(userData, 'backups', 'workspace-id')
    writeFileSync(idFile, 'not / an id\n')

    const failure = await make(userData).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CheckpointFailed)
    expect((failure as CheckpointFailed).canRetry).toBe(false)
    expect(readFileSync(idFile, 'utf8')).toBe('not / an id\n')
    expect(readdirSync(join(userData, 'backups'))).toEqual(['workspace-id'])
  })

  it('refuses a copy of damaged data, keeps nothing, and leaves the data as it was', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const file = liveFile(userData)
    const db = new Database(file)
    db.exec('CREATE TABLE damaged (x TEXT); CREATE INDEX damaged_x ON damaged (x)')
    const insert = db.prepare('INSERT INTO damaged VALUES (?)')
    for (let n = 0; n < 20; n += 1) insert.run(`needle-${String(n).padStart(3, '0')}`)
    const { rootpage } = db
      .prepare(`SELECT rootpage FROM sqlite_master WHERE name = 'damaged'`)
      .get() as { rootpage: number }
    const pageSize = Number(db.pragma('page_size', { simple: true }))
    db.close()
    // One row's value changed in the table but not in its index: SQLite's check sees the two
    // disagree, though every page still reads.
    const bytes = readFileSync(file)
    const page = bytes.subarray((rootpage - 1) * pageSize, rootpage * pageSize)
    const at = page.indexOf('needle-007')
    expect(at).toBeGreaterThan(-1)
    page.write('needle-XYZ', at)
    writeFileSync(file, bytes)
    const before = fingerprint(file)

    const failure = await make(userData).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CheckpointFailed)
    expect((failure as CheckpointFailed).canRetry).toBe(false)
    expect((failure as Error).message).toContain("did not pass SQLite's own check")
    expect(readdirSync(join(userData, 'backups'))).toEqual(['workspace-id'])
    expect(fingerprint(file)).toEqual(before)
  })

  const stops: [string, (userData: string) => Partial<MakeCheckpointOptions>][] = [
    [
      'a progress listener that throws',
      () => ({
        progress: () => {
          throw new Error('the window went away')
        },
      }),
    ],
    ...(['copy', 'verify', 'files', 'manifest'] as CheckpointStep[]).map(
      (stop): [string, () => Partial<MakeCheckpointOptions>] => [
        `a fault before the ${stop} step`,
        () => ({
          beforeStep: (step) => {
            if (step === stop) throw coded('EIO')
          },
        }),
      ],
    ),
    [
      'a state file that cannot be copied',
      () => ({
        fs: {
          ...nodeFs,
          copyFile: (from, to, mode) =>
            from.endsWith('drafts.json')
              ? Promise.reject(coded('ENOSPC'))
              : nodeFs.copyFile(from, to, mode),
        } satisfies RecoveryFs,
      }),
    ],
    [
      'a manifest that cannot be written',
      () => ({
        fs: {
          ...nodeFs,
          open: (path, flags, mode) =>
            path.includes('manifest.json') && flags === 'wx'
              ? Promise.reject(coded('ENOSPC'))
              : nodeFs.open(path, flags, mode),
        } satisfies RecoveryFs,
      }),
    ],
  ]

  it.each(stops)(
    'leaves nothing to offer, and the data as it was, after %s',
    async (_what, options) => {
      const userData = aDataFolder()
      aLiveDatabase(userData)
      writeFileSync(join(userData, 'drafts.json'), '{}\n')
      const before = fingerprint(liveFile(userData))
      const lines: string[] = []

      const failure = await make(userData, {
        ...options(userData),
        log: (line) => lines.push(line),
      }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(CheckpointFailed)
      expect((failure as CheckpointFailed).canRetry).toBe(true)
      expect(readdirSync(join(userData, 'backups')), 'the unfinished folder is gone').toEqual([
        'workspace-id',
      ])
      expect(await listOfferable(userData, LINEAGE)).toEqual([])
      expect(await listCheckpoints(userData)).toEqual([])
      expect(lines).toEqual([])
      expect(fingerprint(liveFile(userData))).toEqual(before)
    },
  )
})

describe('makeCheckpoint, on disk', () => {
  it('puts the copy, each state file and their folder on disk before the manifest names them', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{"version":1}\n')
    const events: string[] = []
    const recording: RecoveryFs = {
      ...nodeFs,
      open: async (path, flags, mode) => {
        const handle = await nodeFs.open(path, flags, mode)
        return {
          ...handle,
          sync: async () => {
            await handle.sync()
            events.push(`sync ${flags} ${path}`)
          },
        }
      },
    }

    const { folder } = await make(userData, { fs: recording })

    const at = (event: string): number => {
      const index = events.indexOf(event)
      expect(index, event).toBeGreaterThan(-1)
      return index
    }
    const manifest = events.findIndex(
      (event) =>
        event.startsWith(`sync wx ${join(folder, 'manifest.json')}.`) && event.endsWith('.tmp'),
    )
    expect(manifest).toBeGreaterThan(-1)
    const copy = at(`sync r+ ${join(folder, 'database.sqlite')}`)
    const drafts = at(`sync r+ ${join(folder, 'drafts.json')}`)
    expect(copy).toBeLessThan(drafts)
    expect(drafts).toBeLessThan(manifest)
    if (process.platform === 'win32') {
      // Windows flushes no folder: the manifest is flushed again under its own name, which puts
      // that name, and every one made before it, on disk.
      expect(events.filter((event) => event.startsWith('sync r '))).toEqual([])
      expect(at(`sync r+ ${join(folder, 'manifest.json')}`)).toBeGreaterThan(manifest)
      return
    }
    const backups = at(`sync r ${join(userData, 'backups')}`)
    const theFolder = events.lastIndexOf(`sync r ${folder}`, manifest)
    expect(backups).toBeLessThan(copy)
    expect(drafts).toBeLessThan(theFolder)
    expect(theFolder).toBeLessThan(manifest)
  })

  it('offers a retry when the workspace id could not be read this time, and keeps it', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const first = await make(userData)
    const idFile = join(userData, 'backups', 'workspace-id')
    const written = readFileSync(idFile, 'utf8')
    const held: RecoveryFs = {
      ...nodeFs,
      readFile: (path) => (path === idFile ? Promise.reject(coded('EIO')) : nodeFs.readFile(path)),
    }

    const failure = await make(userData, { fs: held }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CheckpointFailed)
    expect((failure as CheckpointFailed).canRetry).toBe(true)
    expect(readFileSync(idFile, 'utf8')).toBe(written)
    expect(ids(await listCheckpoints(userData))).toEqual(ids([first]))
  })

  it.runIf(POSIX)('makes nothing through a backups folder that is a link', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const elsewhere = join(aRoot(), 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(userData, 'backups'))
    const before = fingerprint(liveFile(userData))

    const failure = await make(userData).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CheckpointFailed)
    expect((failure as Error).message).toContain('is a link')
    expect(readdirSync(elsewhere)).toEqual([])
    expect(fingerprint(liveFile(userData))).toEqual(before)
  })
})

/** A checkpoint as {@link listOfferable} would return it, for the decisions alone. */
function aCheckpoint(made: {
  appVersion: string
  migrations: readonly Migration[]
  createdAt: number
  build?: string | null
}): Checkpoint {
  return {
    folder: '/not/read',
    manifest: {
      format: 'brobot-checkpoint',
      version: 1,
      id: randomUUID(),
      createdAt: new Date(made.createdAt).toISOString(),
      workspaceId: randomUUID(),
      reason: 'first-start-of-release',
      madeBy: { appVersion: made.appVersion, build: made.build ?? null },
      database: {
        file: 'database.sqlite',
        bytes: 4096,
        sha256: '0'.repeat(64),
        migrations: made.migrations,
      },
      files: [],
    },
  }
}

const aRecord = (migrations: readonly Migration[]): MigrationsOnDisk => ({
  kind: 'recorded',
  migrations,
})

function facts(given: Partial<CheckpointFacts>): CheckpointFacts {
  return {
    database: aRecord(OWN),
    lineage: LINEAGE,
    release: null,
    offerable: [],
    databaseChangedAt: minute(0),
    ...given,
  }
}

describe('needsACheckpoint', () => {
  it('never asks for one on an absent, empty or unreadable database', () => {
    const none: MigrationsOnDisk[] = [
      { kind: 'absent' },
      { kind: 'empty' },
      { kind: 'unreadable', detail: 'not a database' },
    ]
    for (const database of none) {
      expect(needsACheckpoint(facts({ database, release: '0.2.0' }))).toBeNull()
      expect(
        needsACheckpoint(facts({ database, release: '0.2.0', lineage: [...LINEAGE, LATER] })),
      ).toBeNull()
    }
  })

  it('asks for one at a packaged release’s first start on existing data, and only then', () => {
    const byAnother = aCheckpoint({ appVersion: '0.1.0', migrations: OWN, createdAt: minute(-10) })
    const byThis = aCheckpoint({ appVersion: '0.2.0', migrations: OWN, createdAt: minute(-5) })
    expect(needsACheckpoint(facts({ release: '0.2.0' }))).toBe('first-start-of-release')
    expect(needsACheckpoint(facts({ release: '0.2.0', offerable: [byAnother] }))).toBe(
      'first-start-of-release',
    )
    expect(needsACheckpoint(facts({ release: '0.2.0', offerable: [byAnother, byThis] }))).toBeNull()
    expect(needsACheckpoint(facts({ release: null })), 'a build that is not a release').toBeNull()
  })

  it('asks for one before migrations, on any build', () => {
    const behind = aRecord(OWN.slice(0, -1))
    expect(needsACheckpoint(facts({ database: behind }))).toBe('before-migration')
    expect(needsACheckpoint(facts({ database: behind, release: '0.2.0' }))).toBe('before-migration')
    expect(needsACheckpoint(facts({ lineage: [...LINEAGE, LATER] }))).toBe('before-migration')
  })

  it('reuses this release’s intact copy of the database as it is now, and no other', () => {
    const BEHIND = OWN.slice(0, -1)
    const pending = {
      database: aRecord(BEHIND),
      release: '0.2.0',
      databaseChangedAt: minute(0),
    }
    const copy = (
      appVersion: string,
      migrations: readonly Migration[],
      createdAt = minute(1),
    ): Checkpoint => aCheckpoint({ appVersion, migrations, createdAt })
    const checked = (...copies: Checkpoint[]): Partial<CheckpointFacts> => ({
      offerable: copies,
      intact: new Set(copies.map(({ manifest }) => manifest.id)),
    })

    expect(needsACheckpoint(facts({ ...pending, ...checked(copy('0.2.0', BEHIND)) }))).toBeNull()
    expect(
      needsACheckpoint(facts({ ...pending, ...checked(copy('0.2.0', BEHIND, minute(0))) })),
      'made in the same moment the database last changed',
    ).toBeNull()

    expect(
      needsACheckpoint(facts({ ...pending, offerable: [copy('0.2.0', BEHIND)] })),
      'a copy no one hashed',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(facts({ ...pending, ...checked(copy('0.2.0', BEHIND, minute(-1))) })),
      'the database changed after the copy',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(
        facts({ ...pending, databaseChangedAt: null, ...checked(copy('0.2.0', BEHIND)) }),
      ),
      'when it last changed is not known',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(facts({ ...pending, ...checked(copy('0.2.0', BEHIND.slice(0, -1))) })),
      'a copy with other migrations',
    ).toBe('before-migration')
    const otherHash = BEHIND.map((one, index) =>
      index === 0 ? { ...one, hash: 'e'.repeat(64) } : one,
    )
    expect(
      needsACheckpoint(facts({ ...pending, ...checked(copy('0.2.0', otherHash)) })),
      'a copy of the same times and other files',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(facts({ ...pending, ...checked(copy('0.1.0', BEHIND)) })),
      'another release’s copy',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(facts({ ...pending, release: null, ...checked(copy('0.2.0', BEHIND)) })),
      'a build that is not a release, and knows no commit',
    ).toBe('before-migration')
  })

  it('reuses, on a build that is not packaged, the intact copy its own commit made, and no other', () => {
    const BEHIND = OWN.slice(0, -1)
    const pending = { database: aRecord(BEHIND), release: null, databaseChangedAt: minute(0) }
    const copy = (build: string | null, createdAt = minute(1)): Checkpoint =>
      aCheckpoint({ appVersion: '0.1.0', migrations: BEHIND, createdAt, build })
    const checked = (...copies: Checkpoint[]): Partial<CheckpointFacts> => ({
      offerable: copies,
      intact: new Set(copies.map(({ manifest }) => manifest.id)),
    })

    expect(
      needsACheckpoint(facts({ ...pending, build: 'b7c1d2e', ...checked(copy('b7c1d2e')) })),
    ).toBeNull()
    expect(
      needsACheckpoint(facts({ ...pending, build: 'b7c1d2e', ...checked(copy('a0a0a0a')) })),
      'another commit’s copy',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(facts({ ...pending, build: null, ...checked(copy(null)) })),
      'no commit on either side is not the same build',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(
        facts({ ...pending, build: 'b7c1d2e', ...checked(copy('b7c1d2e', minute(-1))) }),
      ),
      'the database changed after the copy',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(
        facts({ ...pending, build: 'b7c1d2e', offerable: [copy('b7c1d2e')], intact: new Set() }),
      ),
      'a copy no one hashed',
    ).toBe('before-migration')
    expect(
      needsACheckpoint(
        facts({
          ...pending,
          release: '0.2.0',
          build: 'b7c1d2e',
          ...checked(copy('b7c1d2e')),
        }),
      ),
      'a packaged build goes by its release, not its commit',
    ).toBe('before-migration')
  })
})

describe('checkpointNeeded', () => {
  it('lets a retry after a failed migration reuse the copy made before it, until the data changes', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const live = liveFile(userData)
    const failing = migrationsWithOneThatFails()
    const lineage = await buildLineage(failing)
    const now = async (): Promise<CheckpointFacts> => ({
      database: await migrationsOf(live),
      lineage,
      release: '0.2.0',
      offerable: await listOfferable(userData, lineage),
      databaseChangedAt: await whenTheDatabaseLastChanged(userData),
    })
    const asked = async (): Promise<string | null> =>
      checkpointNeeded({ userData, database: await migrationsOf(live), lineage, release: '0.2.0' })

    expect(await asked()).toBe('before-migration')
    await make(userData, { appVersion: '0.2.0', reason: 'before-migration' })
    const copied = fingerprint(live)

    const first = openDatabase(live)
    expect(() => applyMigrations(first, failing)).toThrow()
    first.close()
    expect(fingerprint(live), 'a failed migration leaves the file as it was').toEqual(copied)
    expect(await asked()).toBeNull()
    expect(needsACheckpoint(await now()), 'the copy is reused only once it was hashed').toBe(
      'before-migration',
    )

    const stillOpen = openDatabase(live)
    expect(() => applyMigrations(stillOpen, failing)).toThrow()
    expect(await asked(), 'with the failed connection still open').toBeNull()
    stillOpen.close()

    await new Promise((resolve) => setTimeout(resolve, 20))
    const later = openDatabase(live)
    later.prepare('INSERT INTO filler VALUES (?, ?)').run(FILLER_ROWS, Buffer.alloc(10))
    later.close()
    expect(await asked(), 'after an older release wrote to it').toBe('before-migration')
  })

  it('lets a build that is not packaged reuse the copy its own commit made before a failed migration', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const live = liveFile(userData)
    const lineage = await buildLineage(migrationsWithOneThatFails())
    const asked = async (build: string | null): Promise<string | null> =>
      checkpointNeeded({
        userData,
        database: await migrationsOf(live),
        lineage,
        release: null,
        build,
      })

    expect(await asked('b7c1d2e')).toBe('before-migration')
    await make(userData, { build: 'b7c1d2e', reason: 'before-migration' })

    expect(await asked('b7c1d2e')).toBeNull()
    expect(await asked('a0a0a0a'), 'another commit').toBe('before-migration')
    expect(await asked(null), 'a build that knows no commit').toBe('before-migration')
  })

  it('hashes a copy to reuse only when migrations are left to apply, the one time it is reused', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    await make(userData, { appVersion: '0.2.0', reason: 'before-migration' })
    const read: string[] = []
    const fs: RecoveryFs = {
      ...nodeFs,
      open: (path, flags, mode) => {
        if (path.includes(`${sep}backups${sep}`)) read.push(path)
        return nodeFs.open(path, flags, mode)
      },
    }
    const asked = async (migrations: string): Promise<string | null> =>
      checkpointNeeded({
        userData,
        database: await migrationsOf(liveFile(userData)),
        lineage: await buildLineage(migrations),
        release: '0.2.0',
        fs,
      })

    expect(await asked(MIGRATIONS)).toBeNull()
    expect(read, 'with nothing to apply').toEqual([])
    expect(await asked(migrationsWithOneThatFails())).toBeNull()
    expect(read, 'with a migration to apply').toContain(
      join(
        userData,
        'backups',
        (await listCheckpoints(userData))[0]?.manifest.id ?? '',
        'database.sqlite',
      ),
    )
  })

  it('makes a new copy when the one a retry would reuse was damaged since it was made', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const live = liveFile(userData)
    const failing = migrationsWithOneThatFails()
    const lineage = await buildLineage(failing)
    const { folder } = await make(userData, { appVersion: '0.2.0', reason: 'before-migration' })
    const question = { userData, database: await migrationsOf(live), lineage, release: '0.2.0' }
    expect(await checkpointNeeded(question)).toBeNull()

    flipLastByte(join(folder, 'database.sqlite'))

    expect(await listOfferable(userData, lineage), 'still the size it was').toHaveLength(1)
    expect(await checkpointNeeded(question)).toBe('before-migration')
  })

  it('needs nothing for a database that is absent, empty or unreadable', async () => {
    const userData = aDataFolder()
    for (const database of [
      { kind: 'absent' },
      { kind: 'empty' },
      { kind: 'unreadable', detail: 'not a database' },
    ] as const) {
      expect(
        await checkpointNeeded({ userData, database, lineage: LINEAGE, release: '0.2.0' }),
      ).toBeNull()
    }
  })
})

describe('whenTheDatabaseLastChanged', () => {
  it('is null with no database, and counts a -wal only when it holds something', async () => {
    const userData = aDataFolder()
    expect(await whenTheDatabaseLastChanged(userData)).toBeNull()
    aLiveDatabase(userData)
    const live = liveFile(userData)
    utimesSync(live, minute(0) / 1000, minute(0) / 1000)
    writeFileSync(`${live}-wal`, '')
    utimesSync(`${live}-wal`, minute(5) / 1000, minute(5) / 1000)
    expect(await whenTheDatabaseLastChanged(userData)).toBe(minute(0))
    writeFileSync(`${live}-wal`, 'frames')
    utimesSync(`${live}-wal`, minute(5) / 1000, minute(5) / 1000)
    expect(await whenTheDatabaseLastChanged(userData)).toBe(minute(5))
  })

  it('says so, rather than nothing, when a time cannot be read', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const denied: RecoveryFs = {
      ...nodeFs,
      stat: (path) => (path.endsWith('-wal') ? Promise.reject(coded('EACCES')) : nodeFs.stat(path)),
    }
    await expect(whenTheDatabaseLastChanged(userData, denied)).rejects.toThrow('EACCES')
  })
})

/** Changes a file's last byte and keeps its size and modification time. */
function flipLastByte(file: string): void {
  const stats = statSync(file)
  const bytes = readFileSync(file)
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
  writeFileSync(file, bytes)
  utimesSync(file, stats.atime, stats.mtime)
}

describe('theNewestIntact', () => {
  it('offers the newest copy whose files a restore installs still hash as made, trying each in turn', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{"version":1}\n')
    writeFileSync(join(userData, 'provider-usage.json'), '{}\n')
    const oldest = await make(userData, { now: () => minute(1) })
    const draftsDamaged = await make(userData, { now: () => minute(2) })
    const usageChanged = await make(userData, { now: () => minute(3) })
    const copyDamaged = await make(userData, { now: () => minute(4) })
    flipLastByte(join(copyDamaged.folder, 'database.sqlite'))
    flipLastByte(join(draftsDamaged.folder, 'drafts.json'))
    // A state file a restore leaves as it is does not stop the copy being offered.
    flipLastByte(join(usageChanged.folder, 'provider-usage.json'))

    const offerable = await listOfferable(userData, LINEAGE)
    expect(ids(offerable), 'each is still the size it was').toEqual(
      ids([copyDamaged, usageChanged, draftsDamaged, oldest]),
    )
    expect(await isIntact(copyDamaged)).toBe(false)
    expect(await isIntact(draftsDamaged)).toBe(false)
    expect(ids([(await theNewestIntact(offerable)) as Checkpoint])).toEqual(ids([usageChanged]))
    expect(await theNewestIntact([copyDamaged, draftsDamaged])).toBeNull()
    expect(await theNewestIntact([])).toBeNull()
  })

  it.runIf(POSIX)('does not take a link to the right bytes for the copy itself', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const made = await make(userData)
    const copy = join(made.folder, 'database.sqlite')
    const elsewhere = join(aRoot(), 'database.sqlite')
    renameSync(copy, elsewhere)
    symlinkSync(elsewhere, copy)

    expect(await isIntact(made)).toBe(false)
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
  })
})

describe('listOfferable', () => {
  it('offers this workspace’s whole copies newest first, as the window is told them', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const middle = await make(userData, { now: () => minute(2) })
    const oldest = await make(userData, { now: () => minute(1) })
    const newest = await make(userData, { now: () => minute(3) })

    const offerable = await listOfferable(userData, LINEAGE)

    expect(ids(offerable)).toEqual(ids([newest, middle, oldest]))
    expect(offerable[0]).toEqual(newest)
    expect(offerable.map(offeredFrom)[0]).toEqual({
      id: newest.manifest.id,
      createdAt: new Date(minute(3)).toISOString(),
      bytes: statSync(join(newest.folder, 'database.sqlite')).size,
    })
  })

  it('offers nothing from another workspace', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const kept = await make(userData)
    const moved = await make(userData)
    rewrite(userData, moved.manifest.id, { ...moved.manifest, workspaceId: randomUUID() })
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([kept]))

    writeFileSync(join(userData, 'backups', 'workspace-id'), `${randomUUID()}\n`)
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
    rmSync(join(userData, 'backups', 'workspace-id'))
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
  })

  it('offers no copy whose files are not the size its manifest records', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{}\n')
    writeFileSync(join(userData, 'provider-usage.json'), '{}\n')
    const [grown, gone, draftsChanged, usageChanged] = [
      await make(userData, { now: () => minute(1) }),
      await make(userData, { now: () => minute(2) }),
      await make(userData, { now: () => minute(3) }),
      await make(userData, { now: () => minute(4) }),
    ]
    appendFileSync(join(grown.folder, 'database.sqlite'), 'x')
    rmSync(join(gone.folder, 'database.sqlite'))
    appendFileSync(join(draftsChanged.folder, 'drafts.json'), 'x')
    // A state file a restore leaves as it is does not stop the copy being offered.
    appendFileSync(join(usageChanged.folder, 'provider-usage.json'), 'x')

    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([usageChanged]))
    expect(await listCheckpoints(userData)).toHaveLength(4)
  })

  it('offers no copy whose migrations this build cannot open, by time or by hash', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const ours = await make(userData, { now: () => minute(1) })
    const newer = copyOf(userData, ours, (manifest) => oneMigrationLater(manifest, minute(2)))
    const otherLine = copyOf(userData, ours, (manifest) => ({
      ...manifest,
      database: {
        ...manifest.database,
        migrations: manifest.database.migrations.map((one, index) =>
          index === 0 ? { ...one, createdAt: one.createdAt + 1 } : one,
        ),
      },
    }))
    const otherFile = copyOf(userData, ours, (manifest) => ({
      ...manifest,
      database: {
        ...manifest.database,
        migrations: manifest.database.migrations.map((one, index) =>
          index === 2 ? { ...one, hash: 'e'.repeat(64) } : one,
        ),
      },
    }))
    expect(ids(await listCheckpoints(userData))).toEqual(
      expect.arrayContaining([otherLine, otherFile]),
    )

    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([ours]))
    expect(
      await listOfferable(userData, LINEAGE.slice(0, -1)),
      'a build with one migration fewer opens none of them',
    ).toEqual([])
    expect(ids(await listOfferable(userData, [...LINEAGE, LATER]))).toEqual([
      newer,
      ours.manifest.id,
    ])
  })

  it('offers no copy whose manifest lists a state file this build does not know', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const ours = await make(userData, { now: () => minute(1) })
    copyOf(userData, ours, (manifest) => ({
      ...manifest,
      createdAt: new Date(minute(2)).toISOString(),
      files: [...manifest.files, { name: 'a-later-state.json', present: false }],
    }))
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([ours]))
  })

  it('offers no folder without a manifest, with one this build does not read, or named for another', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const ours = await make(userData)
    const unfinished = copyOf(userData, ours)
    rmSync(manifestPath(userData, unfinished))
    const later = copyOf(userData, ours)
    rewrite(userData, later, { ...ours.manifest, id: later, version: 2 })
    const misnamed = copyOf(userData, ours)
    rewrite(userData, misnamed, { ...ours.manifest, id: randomUUID() })
    const garbled = copyOf(userData, ours)
    writeFileSync(manifestPath(userData, garbled), '{"format": "brobot-checkpoint", ')
    writeFileSync(join(userData, 'backups', 'notes.txt'), 'a file of the person’s own\n')

    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([ours]))
    expect(ids(await listCheckpoints(userData))).toEqual(ids([ours]))
  })

  it('offers nothing when there are no backups', async () => {
    expect(await listOfferable(aDataFolder(), LINEAGE)).toEqual([])
  })
})

/** A whole copy's folder as a copy stopped before its manifest leaves it: marked unfinished. */
function leftUnfinished(userData: string, id: string): void {
  rmSync(manifestPath(userData, id))
  writeFileSync(join(userData, 'backups', id, 'unfinished'), '')
}

/** Dates every entry of a folder in `backups/`, and the folder, more than an hour ago. */
function anHourAndMoreAgo(userData: string, name: string, now = Date.now()): void {
  const then = (now - 61 * 60_000) / 1000
  const folder = join(userData, 'backups', name)
  for (const entry of readdirSync(folder)) utimesSync(join(folder, entry), then, then)
  utimesSync(folder, then, then)
}

describe('prune', () => {
  it('keeps one newest intact offerable copy across migration counts', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData, theFirstMigrations(THE_BUILDS.length - 1))
    const six = [
      await make(userData, { now: () => minute(1) }),
      await make(userData, { now: () => minute(2) }),
      await make(userData, { now: () => minute(3) }),
    ]
    rmSync(join(six[2]?.folder ?? '', 'database.sqlite'))
    const live = openDatabase(liveFile(userData))
    applyMigrations(live, MIGRATIONS)
    live.close()
    const seven: Checkpoint[] = []
    for (let n = 4; n <= 8; n += 1) seven.push(await make(userData, { now: () => minute(n) }))
    const newest = seven[seven.length - 1] as Checkpoint
    const eightOlder = copyOf(userData, newest, (manifest) =>
      oneMigrationLater(manifest, minute(9)),
    )
    const eightNewer = copyOf(userData, newest, (manifest) =>
      oneMigrationLater(manifest, minute(10)),
    )
    expect(six.map(({ manifest }) => manifest.database.migrations.length)).toEqual(
      six.map(() => THE_BUILDS.length - 1),
    )

    const recent = { ...SOLE, now: () => minute(12) }
    const removed = await prune(userData, LINEAGE, recent)

    const [s1, s2, s3] = ids(six)
    const [v4, v5, v6, v7, v8] = ids(seven)
    expect(removed.sort()).toEqual([s1, s2, v4, v5, v6, v7].sort())
    expect(ids(await listCheckpoints(userData)), 'not whole, or made by a newer build').toEqual([
      eightNewer,
      eightOlder,
      v8,
      s3,
    ])
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual([v8])
    expect(await prune(userData, LINEAGE, recent), 'a second pass finds nothing more').toEqual([])
  })

  it('keeps only the newest of three recent copies with the same migration count', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const now = minute(12)
    const oldest = await make(userData, { now: () => now - 3 * 60_000 })
    const middle = await make(userData, { now: () => now - 2 * 60_000 })
    const newest = await make(userData, { now: () => now - 60_000 })

    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => now })).toEqual([
      middle.manifest.id,
      oldest.manifest.id,
    ])
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([newest]))
  })

  async function copiesAcrossMigration(daysOld: number): Promise<{
    userData: string
    older: Checkpoint
    middle: Checkpoint
    newer: Checkpoint
    now: number
  }> {
    const userData = aDataFolder()
    aLiveDatabase(userData, theFirstMigrations(THE_BUILDS.length - 1))
    const now = START + 20 * DAY_MS
    const older = await make(userData, { now: () => now - daysOld * DAY_MS })
    const live = openDatabase(liveFile(userData))
    applyMigrations(live, MIGRATIONS)
    live.close()
    const middle = await make(userData, { now: () => now - 2 * DAY_MS })
    const newer = await make(userData, { now: () => now - DAY_MS })
    return { userData, older, middle, newer, now }
  }

  it('prunes an eight-day-old migration-count copy when a newer copy exists', async () => {
    const { userData, older, middle, newer, now } = await copiesAcrossMigration(8)

    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => now })).toEqual([
      middle.manifest.id,
      older.manifest.id,
    ])
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([newer]))
  })

  it('expires even the last copy at three days', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const now = START + 40 * DAY_MS
    const only = await make(userData, { now: () => now - 30 * DAY_MS })

    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => now })).toEqual([only.manifest.id])
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
  })

  it('drops older migration-count anchors', async () => {
    const { userData, older, middle, newer, now } = await copiesAcrossMigration(6)

    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => now })).toEqual([
      middle.manifest.id,
      older.manifest.id,
    ])
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([newer]))
  })

  it.each(['taken', 'unknown'] as const)(
    'removes nothing when the one-app check says %s',
    async (ownership) => {
      const userData = aDataFolder()
      aLiveDatabase(userData)
      const now = Date.now()
      for (let n = 1; n <= 5; n += 1) await make(userData, { now: () => now - (6 - n) * 60_000 })
      const stale = copyOf(userData, (await listCheckpoints(userData))[0] as Checkpoint)
      leftUnfinished(userData, stale)
      anHourAndMoreAgo(userData, stale)
      const before = readdirSync(join(userData, 'backups')).sort()

      expect(await prune(userData, LINEAGE, { ownership })).toEqual([])
      expect(readdirSync(join(userData, 'backups')).sort()).toEqual(before)
      expect(await prune(userData, LINEAGE, SOLE)).toHaveLength(5)
    },
  )

  it('never removes a folder it cannot read, another workspace’s copy, or an unfinished copy younger than an hour', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const made: Checkpoint[] = []
    for (let n = 1; n <= 6; n += 1) made.push(await make(userData, { now: () => minute(n) }))
    const [c1, c2, c3, c4, c5, c6] = made as [
      Checkpoint,
      Checkpoint,
      Checkpoint,
      Checkpoint,
      Checkpoint,
      Checkpoint,
    ]
    rewrite(userData, c1.manifest.id, { ...c1.manifest, version: 2 })
    rewrite(userData, c2.manifest.id, { ...c2.manifest, workspaceId: randomUUID() })
    const garbled = copyOf(userData, c6)
    writeFileSync(manifestPath(userData, garbled), 'not json\n')
    const stale = copyOf(userData, c6)
    leftUnfinished(userData, stale)
    anHourAndMoreAgo(userData, stale, minute(12))
    const fresh = copyOf(userData, c6)
    leftUnfinished(userData, fresh)
    writeFileSync(join(userData, 'backups', 'notes.txt'), 'a file of the person’s own\n')
    const before = readdirSync(join(userData, 'backups')).sort()

    const removed = await prune(userData, LINEAGE, { ...SOLE, now: () => minute(12) })

    expect(removed.sort()).toEqual([c3.manifest.id, c4.manifest.id, c5.manifest.id, stale].sort())
    expect(
      readdirSync(join(userData, 'backups'))
        .filter((name) => name !== 'deletion.json')
        .sort(),
    ).toEqual(
      before.filter(
        (name) =>
          name !== c3.manifest.id &&
          name !== c4.manifest.id &&
          name !== c5.manifest.id &&
          name !== stale,
      ),
    )
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([c6]))
  })

  it('removes an unfinished copy only when its name is an id, it is marked, and it holds only what the writer makes', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const backups = join(userData, 'backups')
    const unfinished = (name: string, files: Record<string, string>): string => {
      mkdirSync(join(backups, name), { recursive: true })
      for (const [file, text] of Object.entries(files))
        writeFileSync(join(backups, name, file), text)
      anHourAndMoreAgo(userData, name)
      return name
    }
    const marked = { unfinished: '' }
    await make(userData)
    const writersOnly = unfinished(randomUUID(), {
      ...marked,
      'database.sqlite': 'part of a copy',
      'database.sqlite-journal': 'a write that did not finish',
      'drafts.json': '{}',
    })
    const withTheirOwn = unfinished(randomUUID(), {
      ...marked,
      'database.sqlite': 'part of a copy',
      'notes.txt': 'the person’s own',
    })
    const withAFolder = unfinished(randomUUID(), { ...marked, 'database.sqlite': 'part of a copy' })
    mkdirSync(join(backups, withAFolder, 'inside'))
    anHourAndMoreAgo(userData, withAFolder)
    const theirs = unfinished('before-upgrade', { ...marked, 'database.sqlite': 'their own copy' })
    const anId = randomUUID().toUpperCase()
    unfinished(anId, { ...marked, 'database.sqlite': 'not an id this app writes' })
    // What a restore sets aside, moved here by a person: the writer's names, but no mark.
    const setAside = unfinished(randomUUID(), {
      'database.sqlite': 'the newer data',
      'database.sqlite-wal': 'its last changes',
      'database.sqlite-shm': 'its index',
      'drafts.json': '{}',
    })
    const markedAsAFolder = unfinished(randomUUID(), { 'database.sqlite': 'part of a copy' })
    mkdirSync(join(backups, markedAsAFolder, 'unfinished'))
    anHourAndMoreAgo(userData, markedAsAFolder)

    expect(await prune(userData, LINEAGE, SOLE)).toEqual([writersOnly])
    expect(readdirSync(backups)).toEqual(
      expect.arrayContaining([withTheirOwn, withAFolder, theirs, anId, setAside, markedAsAFolder]),
    )
    expect(readdirSync(backups)).not.toContain(writersOnly)
    expect(readdirSync(join(backups, setAside)).sort()).toEqual([
      'database.sqlite',
      'database.sqlite-shm',
      'database.sqlite-wal',
      'drafts.json',
    ])
  })

  it('removes nothing this time when a copy’s files cannot be looked at', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const made: Checkpoint[] = []
    for (let n = 1; n <= 5; n += 1) made.push(await make(userData, { now: () => minute(n) }))
    const held = join(made[0]?.folder ?? '', 'database.sqlite')
    const denied: RecoveryFs = {
      ...nodeFs,
      lstat: (path) => (path === held ? Promise.reject(coded('EIO')) : nodeFs.lstat(path)),
    }
    const warnings: string[] = []

    expect(
      await prune(userData, LINEAGE, { ...SOLE, fs: denied, warn: (line) => warnings.push(line) }),
    ).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('kept every old recovery copy this time')
    expect(await listCheckpoints(userData)).toHaveLength(5)
  })

  it('removes nothing this time when a manifest cannot be read', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const made: Checkpoint[] = []
    for (let n = 1; n <= 5; n += 1) made.push(await make(userData, { now: () => minute(n) }))
    const held = manifestPath(userData, made[4]?.manifest.id ?? '')
    const denied: RecoveryFs = {
      ...nodeFs,
      readFile: (path) => (path === held ? Promise.reject(coded('EIO')) : nodeFs.readFile(path)),
    }

    expect(await prune(userData, LINEAGE, { ...SOLE, fs: denied, warn: () => undefined })).toEqual(
      [],
    )
    expect(await listCheckpoints(userData)).toHaveLength(5)
  })

  it.runIf(POSIX)('removes nothing through a backups folder that is a link', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    for (let n = 1; n <= 5; n += 1) await make(userData, { now: () => minute(n) })
    const elsewhere = join(aRoot(), 'backups-elsewhere')
    renameSync(join(userData, 'backups'), elsewhere)
    symlinkSync(elsewhere, join(userData, 'backups'))
    const before = readdirSync(elsewhere).sort()
    const warnings: string[] = []

    expect(
      await prune(userData, LINEAGE, { ...SOLE, warn: (line) => warnings.push(line) }),
    ).toEqual([])
    expect(readdirSync(elsewhere).sort()).toEqual(before)
    expect(warnings.join('\n')).toContain('is a link')
  })

  it.runIf(POSIX)('never follows a link named like a copy', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    await make(userData)
    const elsewhere = join(aRoot(), 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'database.sqlite'), 'kept elsewhere')
    utimesSync(elsewhere, (Date.now() - 61 * 60_000) / 1000, (Date.now() - 61 * 60_000) / 1000)
    const named = randomUUID()
    symlinkSync(elsewhere, join(userData, 'backups', named))

    expect(await prune(userData, LINEAGE, SOLE)).toEqual([])
    expect(readdirSync(elsewhere)).toEqual(['database.sqlite'])
    expect(readdirSync(join(userData, 'backups'))).toContain(named)
  })

  it('removes nothing, and says why, when a folder cannot be removed', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const made: Checkpoint[] = []
    for (let n = 1; n <= 4; n += 1) made.push(await make(userData, { now: () => minute(n) }))
    const held: RecoveryFs = { ...nodeFs, unlink: () => Promise.reject(coded('ENOTEMPTY')) }
    const warnings: string[] = []

    expect(
      await prune(userData, LINEAGE, {
        ...SOLE,
        fs: held,
        now: () => minute(12),
        warn: (line) => warnings.push(line),
      }),
    ).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings.join('\n')).toContain(made[2]?.manifest.id)
    expect(await listCheckpoints(userData)).toHaveLength(3)
    expect(await retainedCopyInfo(userData, LINEAGE, SOLE)).toMatchObject({
      id: made[2]?.manifest.id,
    })
  })

  it('does nothing when there are no backups', async () => {
    expect(await prune(aDataFolder(), LINEAGE, SOLE)).toEqual([])
  })
})

describe('recovery copy expiry and Settings', () => {
  it('keeps the last copy until exactly three days, then removes it', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData, { now: () => START })
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 3 * DAY_MS - 1 })).toEqual(
      [],
    )
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 3 * DAY_MS })).toEqual([
      copy.manifest.id,
    ])
  })

  it('expires after three successful starts of its new version and does not recreate it on the fourth', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData)
    const version = copy.manifest.madeBy.appVersion
    const options = { ...SOLE, currentAppVersion: version }
    for (let starts = 1; starts <= 3; starts++) {
      await recordSuccessfulStart(userData, LINEAGE, options)
      await prune(userData, LINEAGE, options)
      expect(await listOfferable(userData, LINEAGE)).toHaveLength(starts < 3 ? 1 : 0)
    }
    expect(
      await checkpointNeeded({
        userData,
        database: await migrationsOf(liveFile(userData)),
        lineage: LINEAGE,
        release: version,
      }),
    ).toBeNull()
    expect(
      await checkpointNeeded({
        userData,
        database: await migrationsOf(liveFile(userData)),
        lineage: LINEAGE,
        release: '9.0.0',
      }),
    ).toBe('first-start-of-release')
  })

  it('shows total copied bytes, expiry and starts left; Delete now removes the selected copy', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{"draft":"fictional"}')
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    const info = await retainedCopyInfo(userData, LINEAGE, options)
    expect(info).toMatchObject({
      id: copy.manifest.id,
      bytes: copy.manifest.database.bytes + Buffer.byteLength('{"draft":"fictional"}'),
      expiresAt: new Date(Date.parse(copy.manifest.createdAt) + 3 * DAY_MS).toISOString(),
      startsLeft: 2,
    })
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toBeNull()
    expect(
      await checkpointNeeded({
        userData,
        database: await migrationsOf(liveFile(userData)),
        lineage: LINEAGE,
        release: copy.manifest.madeBy.appVersion,
      }),
    ).toBeNull()
  })

  it.each(['taken', 'unknown'] as const)(
    'Settings delete refuses %s ownership',
    async (ownership) => {
      const userData = aDataFolder()
      aLiveDatabase(userData)
      const copy = await make(userData)
      expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ownership })).toBe(
        false,
      )
      expect(await listCheckpoints(userData)).toHaveLength(1)
    },
  )

  it('Settings delete refuses stale ids, damage, extra personal files and unreadable manifests', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    expect(await deleteRetainedCopy(userData, LINEAGE, randomUUID(), options)).toBe(false)
    writeFileSync(join(copy.folder, 'my-notes.txt'), 'keep mine')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    rmSync(join(copy.folder, 'my-notes.txt'))
    const held = manifestPath(userData, copy.manifest.id)
    const denied = {
      ...nodeFs,
      readFile: (path: string) =>
        path === held ? Promise.reject(coded('EIO')) : nodeFs.readFile(path),
    }
    expect(
      await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, fs: denied }),
    ).toBe(false)
    writeFileSync(join(copy.folder, 'database.sqlite'), 'damage')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await listCheckpoints(userData)).toHaveLength(1)
  })

  it('leaves manual timestamp-named sqlite copies untouched, regardless of age', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const personal = join(userData, 'backups', '20260101-020202')
    mkdirSync(personal, { recursive: true, mode: 0o755 })
    writeFileSync(join(personal, 'brobot2.sqlite'), 'a fictional manual operations copy')
    anHourAndMoreAgo(userData, '20260101-020202')
    const before = readFileSync(join(personal, 'brobot2.sqlite'))
    const copy = await make(userData, { now: () => START })
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 4 * DAY_MS })).toEqual([
      copy.manifest.id,
    ])
    expect(readdirSync(personal)).toEqual(['brobot2.sqlite'])
    expect(readFileSync(join(personal, 'brobot2.sqlite'))).toEqual(before)
  })
})

describe('retention safety boundaries', () => {
  it('protects the newest expired copy during pre-migration low-space cleanup', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData, { now: () => START })
    expect(
      await prune(userData, LINEAGE, { ...SOLE, now: () => START + 30 * DAY_MS, expire: false }),
    ).toEqual([])
    expect(await isIntact(copy)).toBe(true)
  })

  it('does not count checks, failed opens, other versions, or earlier copies toward a new copy', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({ startsLeft: 3 })
    await recordSuccessfulStart(userData, LINEAGE, { ...options, ownership: 'unknown' })
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({ startsLeft: 3 })
    await recordSuccessfulStart(userData, LINEAGE, { ...options, currentAppVersion: '0.0.9' })
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({ startsLeft: 3 })
    await recordSuccessfulStart(userData, LINEAGE, options)
    await recordSuccessfulStart(userData, LINEAGE, options)
    const next = await make(userData, { now: () => Date.now() + 1000 })
    await recordSuccessfulStart(userData, LINEAGE, options)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: next.manifest.id,
      startsLeft: 2,
    })
  })

  it('refuses all cleanup if its start receipt is unreadable or malformed', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData, { now: () => START })
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    writeFileSync(join(userData, 'backups', 'retention.json'), '{broken')
    expect(await prune(userData, LINEAGE, { ...options, warn: () => undefined })).toEqual([])
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
  })

  it.each(['history-only.json', 'restore-journal.json'])(
    'never counts or deletes during %s',
    async (name) => {
      const userData = aDataFolder()
      aLiveDatabase(userData)
      const copy = await make(userData, { now: () => START })
      const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
      mkdirSync(join(userData, 'recovery'))
      writeFileSync(join(userData, 'recovery', name), 'restore in progress')
      await recordSuccessfulStart(userData, LINEAGE, options)
      expect(await prune(userData, LINEAGE, options)).toEqual([])
      expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
      expect(readdirSync(join(userData, 'backups'))).not.toContain('retention.json')
    },
  )
})

describe('resuming an authorized recovery copy deletion', () => {
  async function interrupted(file = 'drafts.json', withTree = false) {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    writeFileSync(join(userData, 'drafts.json'), '{"draft":"fictional only"}')
    if (withTree) {
      mkdirSync(join(userData, 'skills', 'fictional'), { recursive: true })
      writeFileSync(join(userData, 'skills', 'fictional', 'SKILL.md'), 'fictional skill')
    }
    const copy = await make(userData, { now: () => START })
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    let fragment = copy.folder
    let attempts = 0
    const fs: RecoveryFs = {
      ...nodeFs,
      unlink: async (path) => {
        const matchingRoot = [
          copy.folder,
          join(userData, 'backups', `deleting-${copy.manifest.id}`),
        ].find(
          (folder) =>
            dirname(path) === join(folder, dirname(file)) && basename(path) === basename(file),
        )
        if (!matchingRoot) return nodeFs.unlink(path)
        fragment = matchingRoot
        attempts++
        await nodeFs.unlink(path)
        throw coded('EIO')
      },
      rm: async (path, settings) => {
        if (!settings?.recursive || !existsSync(join(path, file))) return nodeFs.rm(path, settings)
        fragment = path
        attempts++
        await nodeFs.rm(join(path, file), { force: true })
        throw coded('EIO')
      },
    }
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(attempts).toBe(1)
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
    return { userData, copy, options, fragment }
  }

  it.each(['drafts.json', 'manifest.json'])(
    'keeps a fragment visible after losing %s; a healthy retry finishes and is idempotent',
    async (file) => {
      const { userData, copy, options, fragment } = await interrupted(file)
      const personal = join(userData, 'backups', '20260101-020202')
      mkdirSync(personal)
      writeFileSync(join(personal, 'my-notes.txt'), 'fictional personal copy')
      expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
        id: copy.manifest.id,
      })
      expect(await listOfferable(userData, LINEAGE)).toEqual([])
      expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
      expect(existsSync(fragment)).toBe(false)
      expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
      expect(await retainedCopyInfo(userData, LINEAGE, options)).toBeNull()
      expect(readFileSync(join(personal, 'my-notes.txt'), 'utf8')).toBe('fictional personal copy')
    },
  )

  it('pruning finishes a confirmed partial deletion instead of keeping its remaining database forever', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    expect(await prune(userData, LINEAGE, { ...options, now: () => START + 4 * DAY_MS })).toEqual([
      copy.manifest.id,
    ])
    expect(existsSync(fragment)).toBe(false)
    expect(await prune(userData, LINEAGE, options)).toEqual([])
  })

  it('a healthy retry removes the database left by an EIO midway through confirmed Delete now', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    expect(existsSync(fragment)).toBe(false)
  })

  it('still refuses shared ownership, unfinished restores and unreadable sibling folders on retry', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    for (const ownership of ['taken', 'unknown'] as const) {
      expect(
        await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, ownership }),
      ).toBe(false)
      expect(await prune(userData, LINEAGE, { ...options, ownership })).toEqual([])
    }
    mkdirSync(join(userData, 'recovery'))
    const gate = join(userData, 'recovery', 'restore-journal.json')
    writeFileSync(gate, 'fictional unfinished restore')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await prune(userData, LINEAGE, options)).toEqual([])
    rmSync(gate)
    const sibling = await make(userData)
    const fs = {
      ...nodeFs,
      lstat: (path: string) =>
        path === sibling.folder ? Promise.reject(coded('EIO')) : nodeFs.lstat(path),
    }
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(await prune(userData, LINEAGE, { ...options, fs, warn: () => undefined })).toEqual([])
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
  })

  it('never treats replacement or extra personal files as authorized remnants', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    writeFileSync(join(fragment, 'my-notes.txt'), 'fictional private notes')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await prune(userData, LINEAGE, { ...options, warn: () => undefined })).toEqual([])
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
    rmSync(join(fragment, 'my-notes.txt'))
    const aside = `${fragment}-saved-by-person`
    renameSync(fragment, aside)
    mkdirSync(fragment)
    writeFileSync(join(fragment, 'database.sqlite'), 'fictional personal replacement')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await prune(userData, LINEAGE, { ...options, warn: () => undefined })).toEqual([])
    expect(readFileSync(join(fragment, 'database.sqlite'), 'utf8')).toBe(
      'fictional personal replacement',
    )
    expect(existsSync(join(aside, 'database.sqlite'))).toBe(true)
  })

  it('documents the accepted fixed-name risk for a newly added drafts.json', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    writeFileSync(join(fragment, 'drafts.json'), '{"draft":"new fictional personal file"}')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    expect(existsSync(fragment)).toBe(false)
  })

  it('never lets intent fields add a top-level personal name to the fixed deletion list', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    const path = join(userData, 'backups', 'deletion.json')
    const record: CheckpointDeletion = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(join(fragment, 'my-notes.txt'), 'fictional personal file')
    writeFileSync(
      path,
      JSON.stringify({
        ...record,
        entries: [{ path: 'my-notes.txt' }],
        verifiedCopy: { invented: 'these claims grant no paths' },
      }),
    )
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await prune(userData, LINEAGE, { ...options, warn: () => undefined })).toEqual([])
    expect(readFileSync(join(fragment, 'my-notes.txt'), 'utf8')).toBe('fictional personal file')
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
  })

  it('resumes a genuine partial copied-tree unlink without hashes or a stored inventory', async () => {
    const { userData, copy, options, fragment } = await interrupted(
      'skills/fictional/SKILL.md',
      true,
    )
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    expect(existsSync(fragment)).toBe(false)
  })

  it('does not begin removal if the durable deletion record cannot be written', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    const fs: RecoveryFs = {
      ...nodeFs,
      open: (path, flags, mode, noFollow) =>
        flags === 'wx' ? Promise.reject(coded('EIO')) : nodeFs.open(path, flags, mode, noFollow),
    }
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(await isIntact(copy)).toBe(true)
  })

  it('resumes after the move succeeds but its acknowledgement is lost', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    let moved = ''
    const fs: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        await nodeFs.rename(from, to)
        if (from === copy.folder) {
          moved = to
          throw coded('EIO')
        }
      },
    }
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(existsSync(join(moved, 'database.sqlite'))).toBe(true)
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    expect(existsSync(moved)).toBe(false)
  })

  it('refuses an unreadable deletion record on retry and in pruning', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    const fs = {
      ...nodeFs,
      readFile: (path: string) =>
        path === join(userData, 'backups', 'deletion.json')
          ? Promise.reject(coded('EIO'))
          : nodeFs.readFile(path),
    }
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(await prune(userData, LINEAGE, { ...options, fs, warn: () => undefined })).toEqual([])
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
  })

  it('a completed deletion receipt does not block the next valid copy or authorize its deletion by a stale id', async () => {
    const { userData, copy, options } = await interrupted()
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    const next = await make(userData, { now: () => START + 1000 })
    await recordSuccessfulStart(userData, LINEAGE, options)
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(true)
    expect(await isIntact(next)).toBe(true)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: next.manifest.id,
    })
    expect(await deleteRetainedCopy(userData, LINEAGE, next.manifest.id, options)).toBe(true)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toBeNull()
  })

  it('protects an in-progress deletion from an older or incompatible build', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    const older = { ...options, currentAppVersion: '0.0.1', warn: () => undefined }
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, older)).toBe(false)
    expect(await prune(userData, LINEAGE, older)).toEqual([])
    expect(await deleteRetainedCopy(userData, [], copy.manifest.id, options)).toBe(false)
    expect(await prune(userData, [], { ...options, warn: () => undefined })).toEqual([])
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
  })

  it('never replaces a personal folder at the proposed deletion destination', async () => {
    const userData = aDataFolder()
    aLiveDatabase(userData)
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    const personal = join(userData, 'backups', `deleting-${copy.manifest.id}`)
    mkdirSync(personal)
    writeFileSync(join(personal, 'my-notes.txt'), 'fictional personal folder')
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await isIntact(copy)).toBe(true)
    expect(readFileSync(join(personal, 'my-notes.txt'), 'utf8')).toBe('fictional personal folder')
  })

  it.skipIf(!POSIX)('never follows a link added inside a partially deleted copy', async () => {
    const { userData, copy, options, fragment } = await interrupted()
    const personal = join(userData, 'fictional-personal.txt')
    writeFileSync(personal, 'fictional personal target')
    symlinkSync(personal, join(fragment, 'drafts.json'))
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
    expect(await prune(userData, LINEAGE, { ...options, warn: () => undefined })).toEqual([])
    expect(readFileSync(personal, 'utf8')).toBe('fictional personal target')
  })
})

describe('a deletion intent never grants ownership of personal files', () => {
  it.each(['retry', 'prune'])(
    'refuses a forged intent over a personal UUID folder through %s',
    async (operation) => {
      const userData = aDataFolder()
      aLiveDatabase(userData)
      const copy = await make(userData)
      const options = {
        ...SOLE,
        currentAppVersion: copy.manifest.madeBy.appVersion,
        warn: () => undefined,
      }
      await recordSuccessfulStart(userData, LINEAGE, options)
      const id = randomUUID()
      const personal = join(userData, 'backups', id)
      mkdirSync(personal)
      const note = join(personal, 'my-notes.txt')
      writeFileSync(note, 'fictional personal file that BroCrew never copied')
      expect(await prune(userData, LINEAGE, options)).toEqual([])
      const identity = (path: string, relative: string) => {
        const s = statSync(path)
        return {
          path: relative,
          directory: s.isDirectory(),
          dev: s.dev,
          ino: s.ino,
          size: s.size,
          mtimeMs: s.mtimeMs,
        }
      }
      writeFileSync(
        join(userData, 'backups', 'deletion.json'),
        JSON.stringify({
          format: 'brocrew-recovery-delete',
          version: 1,
          manifest: { ...copy.manifest, id },
          entries: [identity(personal, ''), identity(note, 'my-notes.txt')],
        }),
      )
      if (operation === 'retry')
        expect(await deleteRetainedCopy(userData, LINEAGE, id, options)).toBe(false)
      else expect(await prune(userData, LINEAGE, options)).toEqual([])
      expect(readFileSync(note, 'utf8')).toContain('fictional personal file')
      expect(existsSync(personal)).toBe(true)
      expect(await isIntact(copy)).toBe(true)
    },
  )
})
