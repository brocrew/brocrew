import { fingerprint } from './lib/recovery-files'
import {
  MIGRATIONS_FOLDER as MIGRATIONS,
  BUILD_LINEAGE as THE_BUILDS,
} from './lib/migration-journal'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import {
  isIntact,
  listCheckpoints,
  listOfferable,
  offeredFrom,
  prune,
  recordSuccessfulStart,
  retainedCopyInfo,
  theNewestIntact,
  type Checkpoint,
} from '../../src/main/recovery/checkpoint'
import { buildLineage } from '../../src/main/recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'
import {
  LATER,
  LINEAGE,
  POSIX,
  START,
  minute,
  DAY_MS,
  aRoot,
  aDataFolder,
  liveFile,
  aLiveDatabase,
  aLiveWorkspace,
  aCopiedWorkspace,
  theFirstMigrations,
  coded,
  SOLE,
  make,
  manifestPath,
  rewrite,
  copyOf,
  oneMigrationLater,
  ids,
  flipLastByte,
  leftUnfinished,
  anHourAndMoreAgo,
} from './lib/a-checkpoint-world'

describe('theNewestIntact', () => {
  it('offers the newest copy whose files a restore installs still hash as made, trying each in turn', async () => {
    const userData = aLiveWorkspace()
    writeFileSync(join(userData, 'drafts.json'), '{"version":1}\n')
    writeFileSync(join(userData, 'provider-usage.json'), '{}\n')
    const oldest = await make(userData, { now: () => minute(1) })
    const draftsDamaged = await make(userData, { now: () => minute(2) })
    const usageChanged = await make(userData, { now: () => minute(3) })
    const copyDamaged = await make(userData, { now: () => minute(4) })
    flipLastByte(join(copyDamaged.folder, 'database.sqlite'))
    flipLastByte(join(draftsDamaged.folder, 'drafts.json'))
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
    const { userData, copy: made } = await aCopiedWorkspace()
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
    const { userData, copy: middle } = await aCopiedWorkspace({ now: () => minute(2) })
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
    const { userData, copy: kept } = await aCopiedWorkspace()
    const moved = await make(userData)
    rewrite(userData, moved.manifest.id, { ...moved.manifest, workspaceId: randomUUID() })
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([kept]))

    writeFileSync(join(userData, 'backups', 'workspace-id'), `${randomUUID()}\n`)
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
    rmSync(join(userData, 'backups', 'workspace-id'))
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
  })

  it('offers no copy whose files are not the size its manifest records', async () => {
    const userData = aLiveWorkspace()
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
    appendFileSync(join(usageChanged.folder, 'provider-usage.json'), 'x')

    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([usageChanged]))
    expect(await listCheckpoints(userData)).toHaveLength(4)
  })

  it('offers no copy whose migrations this build cannot open, by time or by hash', async () => {
    const { userData, copy: ours } = await aCopiedWorkspace({ now: () => minute(1) })
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
    const { userData, copy: ours } = await aCopiedWorkspace({ now: () => minute(1) })
    copyOf(userData, ours, (manifest) => ({
      ...manifest,
      createdAt: new Date(minute(2)).toISOString(),
      files: [...manifest.files, { name: 'a-later-state.json', present: false }],
    }))
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([ours]))
  })

  it('offers no folder without a manifest, with one this build does not read, or named for another', async () => {
    const { userData, copy: ours } = await aCopiedWorkspace()
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

describe('prune', () => {
  it('keeps the newest update copies regardless of age or successful-start receipts', async () => {
    const userData = aLiveWorkspace()
    const copies = []
    for (let n = 0; n < 4; n++) {
      const copy = await make(userData, { appVersion: '0.1.19', now: () => minute(n) })
      copies.push(copy)
    }
    const options = {
      ...SOLE,
      currentAppVersion: '0.1.19',
      now: () => START + 30 * DAY_MS,
    }
    for (let n = 0; n < 3; n++) await recordSuccessfulStart(userData, LINEAGE, options)
    expect(await prune(userData, LINEAGE, options)).toEqual(
      ids([copies[2]!, copies[1]!, copies[0]!]),
    )
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([copies[3]!]))
    expect(await prune(userData, LINEAGE, options)).toEqual([])
  })

  it('leaves unfinished update copies alone while rotating completed copies', async () => {
    const userData = aLiveWorkspace()
    const copies = []
    for (let n = 0; n < 4; n++) copies.push(await make(userData, { now: () => minute(n) }))
    const unfinished = copyOf(userData, copies[3]!)
    leftUnfinished(userData, unfinished)
    anHourAndMoreAgo(userData, unfinished)
    const options = {
      ...SOLE,
      now: () => START + 30 * DAY_MS,
    }
    expect(await prune(userData, LINEAGE, options)).toEqual(
      ids([copies[2]!, copies[1]!, copies[0]!]),
    )
    expect(existsSync(join(userData, 'backups', unfinished, 'unfinished'))).toBe(true)
  })

  it('keeps the newest intact offerable copies across migration counts', async () => {
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

  it('keeps the newest of three recent copies with the same migration count', async () => {
    const userData = aLiveWorkspace()
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

  it('keeps the last copy regardless of age', async () => {
    const userData = aLiveWorkspace()
    const now = START + 40 * DAY_MS
    const only = await make(userData, { now: () => now - 30 * DAY_MS })

    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => now })).toEqual([])
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual([only.manifest.id])
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
      const userData = aLiveWorkspace()
      const now = Date.now()
      for (let n = 1; n <= 5; n += 1) await make(userData, { now: () => now - (6 - n) * 60_000 })
      const stale = copyOf(userData, (await listCheckpoints(userData))[0] as Checkpoint)
      leftUnfinished(userData, stale)
      anHourAndMoreAgo(userData, stale)
      const before = readdirSync(join(userData, 'backups')).sort()

      expect(await prune(userData, LINEAGE, { ownership })).toEqual([])
      expect(readdirSync(join(userData, 'backups')).sort()).toEqual(before)
      expect(await prune(userData, LINEAGE, SOLE)).toHaveLength(4)
    },
  )

  it('never removes unknown, foreign or unfinished copies regardless of age', async () => {
    const userData = aLiveWorkspace()
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

    expect(removed.sort()).toEqual([c3.manifest.id, c4.manifest.id, c5.manifest.id].sort())
    expect(
      readdirSync(join(userData, 'backups'))
        .filter((name) => name !== 'deletion.json')
        .sort(),
    ).toEqual(
      before.filter(
        (name) => name !== c3.manifest.id && name !== c4.manifest.id && name !== c5.manifest.id,
      ),
    )
    expect(ids(await listOfferable(userData, LINEAGE))).toEqual(ids([c6]))
  })

  it('leaves unfinished copies alone, including marked folders holding only writer files', async () => {
    const userData = aLiveWorkspace()
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
    const setAside = unfinished(randomUUID(), {
      'database.sqlite': 'the newer data',
      'database.sqlite-wal': 'its last changes',
      'database.sqlite-shm': 'its index',
      'drafts.json': '{}',
    })
    const markedAsAFolder = unfinished(randomUUID(), { 'database.sqlite': 'part of a copy' })
    mkdirSync(join(backups, markedAsAFolder, 'unfinished'))
    anHourAndMoreAgo(userData, markedAsAFolder)

    expect(await prune(userData, LINEAGE, SOLE)).toEqual([])
    expect(readdirSync(backups)).toEqual(
      expect.arrayContaining([withTheirOwn, withAFolder, theirs, anId, setAside, markedAsAFolder]),
    )
    expect(readdirSync(backups)).toContain(writersOnly)
    expect(readdirSync(join(backups, setAside)).sort()).toEqual([
      'database.sqlite',
      'database.sqlite-shm',
      'database.sqlite-wal',
      'drafts.json',
    ])
  })

  it('removes nothing this time when a copy’s files cannot be looked at', async () => {
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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
    const userData = aLiveWorkspace()
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

describe('recovery copies from a previous release', () => {
  it.each([false, true])(
    'keeps the previous release copy after an update with migrations=%s',
    async (migrate) => {
      const userData = aDataFolder()
      const oldMigrations = theFirstMigrations(THE_BUILDS.length - 1)
      const oldLineage = await buildLineage(oldMigrations)
      aLiveDatabase(userData, oldMigrations)
      writeFileSync(join(userData, 'drafts.json'), '{"draft":"a fictional recipe"}')
      const old = await make(userData, {
        appVersion: '0.1.17',
        reason: 'before-migration',
        now: () => START,
      })
      const files = ['database.sqlite', 'manifest.json', 'drafts.json']
      const before = files.map((file) => fingerprint(join(old.folder, file)))
      await recordSuccessfulStart(userData, oldLineage, { ...SOLE, currentAppVersion: '0.1.17' })
      const current = await make(userData, {
        appVersion: '0.1.19',
        reason: migrate ? 'before-migration' : 'first-start-of-release',
        now: () => minute(3),
      })
      if (migrate) {
        const live = openDatabase(liveFile(userData))
        applyMigrations(live, MIGRATIONS)
        live.close()
      }
      const lineage = migrate ? LINEAGE : oldLineage
      const options = { ...SOLE, currentAppVersion: '0.1.19', now: () => minute(4) }
      await recordSuccessfulStart(userData, lineage, options)

      expect(await prune(userData, lineage, options)).toEqual([
        migrate ? old.manifest.id : current.manifest.id,
      ])
      const survivor = migrate ? current : old
      expect(await isIntact(survivor)).toBe(true)
      expect(ids(await listOfferable(userData, lineage))).toEqual([survivor.manifest.id])
      if (!migrate) expect(files.map((file) => fingerprint(join(old.folder, file)))).toEqual(before)
    },
  )

  it('keeps one copy of the current release', async () => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.19', now: () => START })
    const current = await make(userData, { appVersion: '0.1.19', now: () => minute(1) })
    expect(
      await prune(userData, LINEAGE, {
        ...SOLE,
        currentAppVersion: '0.1.19',
        now: () => minute(2),
      }),
    ).toEqual([old.manifest.id])
    expect(await isIntact(current)).toBe(true)
    expect(existsSync(old.folder)).toBe(false)
  })

  it('rotates the previous release copy regardless of age', async () => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.17', now: () => START - 4 * DAY_MS })
    const current = await make(userData, { appVersion: '0.1.19', now: () => START })
    expect(
      await prune(userData, LINEAGE, {
        ...SOLE,
        currentAppVersion: '0.1.19',
        now: () => minute(1),
      }),
    ).toEqual([old.manifest.id])
    expect(await isIntact(current)).toBe(true)
    expect(existsSync(old.folder)).toBe(false)
  })

  it('rotates older previous-release copies independently of their age', async () => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.17', now: () => START })
    const second = await make(userData, { appVersion: '0.1.17', now: () => minute(1) })
    const current = await make(userData, { appVersion: '0.1.19', now: () => minute(2) })
    const options = { ...SOLE, currentAppVersion: '0.1.19' }
    expect(
      await prune(userData, LINEAGE, { ...options, now: () => START + 3 * DAY_MS - 1 }),
    ).toEqual([second.manifest.id, old.manifest.id])
    expect(await prune(userData, LINEAGE, { ...options, now: () => START + 3 * DAY_MS })).toEqual(
      [],
    )
    expect(existsSync(second.folder)).toBe(false)
    expect(await isIntact(current)).toBe(true)
  })

  it.each([false, true])(
    'never counts current release starts against the previous copy with a new copy=%s',
    async (makeCurrent) => {
      const userData = aLiveWorkspace()
      const old = await make(userData, { appVersion: '0.1.17', now: () => START })
      await recordSuccessfulStart(userData, LINEAGE, { ...SOLE, currentAppVersion: '0.1.17' })
      const current = makeCurrent
        ? await make(userData, { appVersion: '0.1.19', now: () => minute(1) })
        : null
      const options = { ...SOLE, currentAppVersion: '0.1.19', now: () => minute(2) }
      for (let starts = 1; starts <= 3; starts++) {
        await recordSuccessfulStart(userData, LINEAGE, options)
        expect(await prune(userData, LINEAGE, options)).toEqual(
          current && starts === 1 ? [old.manifest.id] : [],
        )
        if (current) expect(await isIntact(current)).toBe(true)
        expect(existsSync(old.folder)).toBe(current === null)
      }
    },
  )

  it.each([2, 3])('rotates the previous copy after %i starts of their version', async (starts) => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.17', now: () => START })
    for (let n = 0; n < starts; n++) {
      await recordSuccessfulStart(userData, LINEAGE, { ...SOLE, currentAppVersion: '0.1.17' })
    }
    const current = await make(userData, { appVersion: '0.1.19', now: () => minute(1) })
    expect(
      await prune(userData, LINEAGE, {
        ...SOLE,
        currentAppVersion: '0.1.19',
        now: () => minute(2),
      }),
    ).toEqual([old.manifest.id])
    expect(existsSync(old.folder)).toBe(false)
    expect(await isIntact(current)).toBe(true)
  })

  it('does not apply an expired receipt to another copy of the same previous version', async () => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.17', now: () => START })
    for (let n = 0; n < 3; n++) {
      await recordSuccessfulStart(userData, LINEAGE, { ...SOLE, currentAppVersion: '0.1.17' })
    }
    const second = await make(userData, { appVersion: '0.1.17', now: () => minute(1) })
    const current = await make(userData, { appVersion: '0.1.19', now: () => minute(2) })
    expect(
      await prune(userData, LINEAGE, {
        ...SOLE,
        currentAppVersion: '0.1.19',
        now: () => minute(3),
      }),
    ).toEqual([second.manifest.id, old.manifest.id])
    expect(existsSync(second.folder)).toBe(false)
    expect(await isIntact(current)).toBe(true)
  })

  it('keeps the newest previous copy regardless of their old start receipt', async () => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.17', now: () => START })
    const newest = await make(userData, { appVersion: '0.1.17', now: () => minute(1) })
    expect(
      await prune(userData, LINEAGE, {
        ...SOLE,
        currentAppVersion: '0.1.19',
        now: () => START + 4 * DAY_MS,
      }),
    ).toEqual([old.manifest.id])
    expect(await isIntact(newest)).toBe(true)
    expect(existsSync(old.folder)).toBe(false)
  })

  it('keeps one copy when the current version is omitted', async () => {
    const userData = aLiveWorkspace()
    const old = await make(userData, { appVersion: '0.1.17', now: () => START })
    const current = await make(userData, { appVersion: '0.1.19', now: () => minute(1) })
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => minute(2) })).toEqual([
      old.manifest.id,
    ])
    expect(await isIntact(current)).toBe(true)
    expect(existsSync(old.folder)).toBe(false)
  })
})
