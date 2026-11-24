import { databaseContents, fingerprint, openCheckpointForRead } from './lib/recovery-files'
import { gunzipSync } from 'node:zlib'
import {
  MIGRATIONS_FOLDER as MIGRATIONS,
  BUILD_LINEAGE as THE_BUILDS,
} from './lib/migration-journal'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import {
  CheckpointFailed,
  checkpointNeeded,
  deleteRetainedCopy,
  isIntact,
  listCheckpoints,
  listOfferable,
  needsACheckpoint,
  prune,
  recordSuccessfulStart,
  whenTheDatabaseLastChanged,
  type Checkpoint,
  type CheckpointFacts,
  type CheckpointStep,
  type MakeCheckpointOptions,
} from '../../src/main/recovery/checkpoint'
import { parseManifest, type Migration } from '../../src/main/recovery/contract'
import {
  buildLineage,
  migrationsOf,
  migrationsRecordedIn,
  type MigrationsOnDisk,
} from '../../src/main/recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'
import { CHECKPOINT_LINE } from '../../src/main/recovery/log-lines'
import { APP_STATE_FILES } from '../../src/main/recovery/state-files'
import {
  LATER,
  LINEAGE,
  OWN,
  POSIX,
  minute,
  aRoot,
  aDataFolder,
  liveFile,
  FILLER_ROWS,
  fill,
  aLiveDatabase,
  aLiveWorkspace,
  aCopiedWorkspace,
  migrationsWithOneThatFails,
  sha256,
  coded,
  SOLE,
  fullCopyFs,
  make,
  rows,
  ids,
  flipLastByte,
} from './lib/a-checkpoint-world'

describe('makeCheckpoint', () => {
  it('makes a copy SQLite checks, with the state files beside it and a manifest this build reads', async () => {
    const userData = aLiveWorkspace()
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
    const db = openCheckpointForRead(copy)
    const decoded = gunzipSync(readFileSync(copy))
    const recorded = migrationsRecordedIn(db)
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
        compression: 'gzip',
        uncompressedBytes: decoded.length,
        uncompressedSha256: sha256(decoded),
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

  it('leaves the copy as one readable rollback-mode file with no sidecars', async () => {
    const userData = aLiveWorkspace()
    writeFileSync(join(userData, 'drafts.json'), '{}\n', { mode: 0o644 })
    const { folder } = await make(userData)
    const copy = join(folder, 'database.sqlite')

    expect(readdirSync(folder).sort()).toEqual(['database.sqlite', 'drafts.json', 'manifest.json'])
    const header = gunzipSync(readFileSync(copy)).subarray(0, 100)
    expect([header[18], header[19]], 'the header says rollback journal, not WAL').toEqual([1, 1])

    expect(rows(copy)).toBe(FILLER_ROWS)
    expect(readdirSync(folder).sort()).toEqual(['database.sqlite', 'drafts.json', 'manifest.json'])

    expect(readFileSync(join(folder, 'drafts.json'), 'utf8')).toBe('{}\n')
  })

  it('keeps live data and state while preparing a closed database for compression', async () => {
    const userData = aLiveWorkspace()
    const before = databaseContents(liveFile(userData))
    const names = readdirSync(userData).sort()

    await make(userData)

    expect(databaseContents(liveFile(userData))).toEqual(before)
    expect(readdirSync(userData).sort()).toEqual([...names, 'backups'].sort())
  })

  it('copies what a crash left only in the -wal', async () => {
    const userData = aDataFolder()
    const elsewhere = join(aRoot(), 'live.sqlite')
    const db = openDatabase(elsewhere)
    db.pragma('wal_autocheckpoint = 0')
    applyMigrations(db, MIGRATIONS)
    fill(db)
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
    const userData = aLiveWorkspace()
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
    const { userData, copy: first } = await aCopiedWorkspace()
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
      const userData = aLiveWorkspace()
      const failure = await make(userData, { ownership }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(CheckpointFailed)
      expect((failure as CheckpointFailed).canRetry).toBe(false)
      expect(readdirSync(userData)).not.toContain('backups')
    },
  )

  it('says how much space it needs, and makes nothing, when the disk is too full', async () => {
    const userData = aLiveWorkspace()
    const failure = await make(userData, { fs: fullCopyFs, freeBytes: () => 1_000_000 }).catch(
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    expect(existsSync(join(userData, 'backups'))).toBe(false)
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
    'leaves nothing to offer, and existing workspace state unchanged, after %s',
    async (_what, options) => {
      const userData = aLiveWorkspace()
      const workspaceId = `${randomUUID()}\n`
      mkdirSync(join(userData, 'backups'))
      writeFileSync(join(userData, 'backups', 'workspace-id'), workspaceId)
      writeFileSync(join(userData, 'drafts.json'), '{}\n')
      const before = databaseContents(liveFile(userData))
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
      expect(readFileSync(join(userData, 'backups', 'workspace-id'), 'utf8')).toBe(workspaceId)
      expect(await listOfferable(userData, LINEAGE)).toEqual([])
      expect(await listCheckpoints(userData)).toEqual([])
      expect(lines).toEqual([])
      expect(databaseContents(liveFile(userData))).toEqual(before)
    },
  )
})

describe('makeCheckpoint, on disk', () => {
  it('puts the copy, each state file and their folder on disk before the manifest names them', async () => {
    const userData = aLiveWorkspace()
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
    const copy = at(`sync wx ${join(folder, 'database.sqlite')}`)
    const drafts = at(`sync r+ ${join(folder, 'drafts.json')}`)
    expect(copy).toBeLessThan(drafts)
    expect(drafts).toBeLessThan(manifest)
    if (process.platform === 'win32') {
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
    const { userData, copy: first } = await aCopiedWorkspace()
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
    const userData = aLiveWorkspace()
    const elsewhere = join(aRoot(), 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(userData, 'backups'))
    const before = databaseContents(liveFile(userData))

    const failure = await make(userData).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CheckpointFailed)
    expect((failure as Error).message).toContain('is a link')
    expect(readdirSync(elsewhere)).toEqual([])
    expect(databaseContents(liveFile(userData))).toEqual(before)
  })
})

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
      reason: 'before-migration',
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

  it('does not copy existing data merely because a packaged release starts for the first time', () => {
    const byAnother = aCheckpoint({ appVersion: '0.1.0', migrations: OWN, createdAt: minute(-10) })
    const byThis = aCheckpoint({ appVersion: '0.2.0', migrations: OWN, createdAt: minute(-5) })
    expect(needsACheckpoint(facts({ release: '0.2.0' }))).toBeNull()
    expect(needsACheckpoint(facts({ release: '0.2.0', offerable: [byAnother] }))).toBeNull()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
    const denied: RecoveryFs = {
      ...nodeFs,
      stat: (path) => (path.endsWith('-wal') ? Promise.reject(coded('EACCES')) : nodeFs.stat(path)),
    }
    await expect(whenTheDatabaseLastChanged(userData, denied)).rejects.toThrow('EACCES')
  })
})

describe('a deletion intent never grants ownership of personal files', () => {
  it.each(['retry', 'prune'])(
    'refuses a forged intent over a personal UUID folder through %s',
    async (operation) => {
      const { userData, copy } = await aCopiedWorkspace()
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
