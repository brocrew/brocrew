import { openCheckpointForRead } from './lib/recovery-files'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkpointNeeded,
  isIntact,
  listCheckpoints,
  listOfferable,
  captureCheckpoint,
  resumeCapturedCheckpoints,
  prune,
  recordSuccessfulStart,
  retainedCopyInfo,
  deleteRetainedCopy,
  type MakeCheckpointOptions,
} from '../../src/main/recovery/checkpoint'
import { parseManifest } from '../../src/main/recovery/contract'
import { migrationsOf } from '../../src/main/recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'
import type { CheckpointDeletion } from '../../src/main/recovery/checkpoint-deletion'
import {
  LINEAGE,
  POSIX,
  START,
  minute,
  DAY_MS,
  liveFile,
  aLiveWorkspace,
  aCopiedWorkspace,
  sha256,
  coded,
  SOLE,
  make,
  manifestPath,
  anHourAndMoreAgo,
} from './lib/a-checkpoint-world'

describe('recovery copy retention and Settings', () => {
  it('lets Settings delete each of two retained versions after this version starts successfully', async () => {
    const userData = aLiveWorkspace()
    const older = await make(userData, { appVersion: '0.1.18', now: () => START })
    const newer = await make(userData, { appVersion: '0.1.19', now: () => minute(1) })
    const options = { ...SOLE, currentAppVersion: '0.1.19' }
    await recordSuccessfulStart(userData, LINEAGE, options)
    expect(await deleteRetainedCopy(userData, LINEAGE, newer.manifest.id, options)).toBe(true)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: older.manifest.id,
    })
    expect(
      await deleteRetainedCopy(userData, LINEAGE, older.manifest.id, {
        ...options,
        currentAppVersion: '0.1.18',
      }),
    ).toBe(false)
    expect(await deleteRetainedCopy(userData, LINEAGE, older.manifest.id, options)).toBe(true)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toBeNull()
  })

  it('keeps the last copy across the former expiry boundary', async () => {
    const { userData, copy } = await aCopiedWorkspace({ now: () => START })
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 3 * DAY_MS - 1 })).toEqual(
      [],
    )
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 3 * DAY_MS })).toEqual([])
    expect(await isIntact(copy)).toBe(true)
  })

  it('keeps its copy after three successful starts and does not recreate it on the fourth', async () => {
    const { userData, copy } = await aCopiedWorkspace()
    const version = copy.manifest.madeBy.appVersion
    const options = { ...SOLE, currentAppVersion: version }
    for (let starts = 1; starts <= 3; starts++) {
      await recordSuccessfulStart(userData, LINEAGE, options)
      await prune(userData, LINEAGE, options)
      expect(await listOfferable(userData, LINEAGE)).toHaveLength(1)
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
    ).toBeNull()
  })

  it('shows total copied bytes; Delete now removes the selected copy', async () => {
    const userData = aLiveWorkspace()
    writeFileSync(join(userData, 'drafts.json'), '{"draft":"fictional"}')
    const copy = await make(userData)
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    const info = await retainedCopyInfo(userData, LINEAGE, options)
    expect(info).toMatchObject({
      id: copy.manifest.id,
      bytes: copy.manifest.database.bytes + Buffer.byteLength('{"draft":"fictional"}'),
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
      const { userData, copy } = await aCopiedWorkspace()
      expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, { ownership })).toBe(
        false,
      )
      expect(await listCheckpoints(userData)).toHaveLength(1)
    },
  )

  it('Settings delete refuses stale ids, damage, extra personal files and unreadable manifests', async () => {
    const { userData, copy } = await aCopiedWorkspace()
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
    const userData = aLiveWorkspace()
    const personal = join(userData, 'backups', '20260101-020202')
    mkdirSync(personal, { recursive: true, mode: 0o755 })
    writeFileSync(join(personal, 'brobot2.sqlite'), 'a fictional manual operations copy')
    anHourAndMoreAgo(userData, '20260101-020202')
    const before = readFileSync(join(personal, 'brobot2.sqlite'))
    const copy = await make(userData, { now: () => START })
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 4 * DAY_MS })).toEqual([])
    expect(readdirSync(personal)).toEqual(['brobot2.sqlite'])
    expect(readFileSync(join(personal, 'brobot2.sqlite'))).toEqual(before)
    expect(await isIntact(copy)).toBe(true)
  })
})

describe('retention safety boundaries', () => {
  it('protects the newest copy even after thirty days', async () => {
    const { userData, copy } = await aCopiedWorkspace({ now: () => START })
    expect(await prune(userData, LINEAGE, { ...SOLE, now: () => START + 30 * DAY_MS })).toEqual([])
    expect(await isIntact(copy)).toBe(true)
  })

  it('does not count checks, failed opens, other versions, or earlier copies toward a new copy', async () => {
    const { userData, copy } = await aCopiedWorkspace()
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
    await recordSuccessfulStart(userData, LINEAGE, { ...options, ownership: 'unknown' })
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
    await recordSuccessfulStart(userData, LINEAGE, { ...options, currentAppVersion: '0.0.9' })
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: copy.manifest.id,
    })
    await recordSuccessfulStart(userData, LINEAGE, options)
    await recordSuccessfulStart(userData, LINEAGE, options)
    const next = await make(userData, { now: () => Date.now() + 1000 })
    await recordSuccessfulStart(userData, LINEAGE, options)
    expect(await retainedCopyInfo(userData, LINEAGE, options)).toMatchObject({
      id: next.manifest.id,
    })
  })

  it('refuses all cleanup if its start receipt is unreadable or malformed', async () => {
    const { userData, copy } = await aCopiedWorkspace({ now: () => START })
    const options = { ...SOLE, currentAppVersion: copy.manifest.madeBy.appVersion }
    await recordSuccessfulStart(userData, LINEAGE, options)
    writeFileSync(join(userData, 'backups', 'retention.json'), '{broken')
    expect(await prune(userData, LINEAGE, { ...options, warn: () => undefined })).toEqual([])
    expect(await deleteRetainedCopy(userData, LINEAGE, copy.manifest.id, options)).toBe(false)
  })

  it.each(['history-only.json', 'restore-journal.json'])(
    'never counts or deletes during %s',
    async (name) => {
      const { userData, copy } = await aCopiedWorkspace({ now: () => START })
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
    const userData = aLiveWorkspace()
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
    const { userData, copy } = await aCopiedWorkspace()
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
    const { userData, copy } = await aCopiedWorkspace()
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
    const { userData, copy } = await aCopiedWorkspace()
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

describe('private capture before background v1 completion', () => {
  const optionsFor = (userData: string): MakeCheckpointOptions => ({
    userData,
    ownership: 'sole',
    appVersion: '0.2.20',
    build: 'fictional-build',
    reason: 'before-migration',
    verifyCopy: async () => {
      throw new Error('no startup integrity sweep')
    },
    log: () => undefined,
  })

  it('captures coupled state before writers, stays unofferable, then publishes the actual v1 hash', async () => {
    const userData = aLiveWorkspace()
    writeFileSync(join(userData, 'drafts.json'), '{"draft":"before"}')
    let hashes = 0
    const options = {
      ...optionsFor(userData),
      hashCopy: async (copy: string) => {
        hashes++
        return { kind: 'ok' as const, sha256: sha256(readFileSync(copy)) }
      },
    }
    const captured = await captureCheckpoint(options)
    const folder = join(userData, 'backups', captured.manifest.id)
    expect(hashes).toBe(0)
    expect(existsSync(join(folder, 'manifest.json'))).toBe(false)
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
    writeFileSync(join(userData, 'drafts.json'), '{"draft":"after"}')
    const live = new Database(liveFile(userData))
    live.exec('CREATE TABLE only_after_capture(x)')
    live.close()
    const made = await captured.finish()
    expect(hashes).toBe(1)
    expect(made.manifest.version).toBe(1)
    expect(made.manifest.database.sha256).toBe(
      sha256(readFileSync(join(folder, 'database.sqlite'))),
    )
    expect(readFileSync(join(folder, 'drafts.json'), 'utf8')).toBe('{"draft":"before"}')
    const copy = openCheckpointForRead(join(folder, 'database.sqlite'))
    try {
      expect(
        copy.prepare("SELECT name FROM sqlite_master WHERE name='only_after_capture'").get(),
      ).toBeUndefined()
    } finally {
      copy.close()
    }
    expect((await listOfferable(userData, LINEAGE)).map(({ manifest }) => manifest.id)).toEqual([
      made.manifest.id,
    ])
  })

  it('keeps private capture and previous backups on hash failure, then resumes without recapturing live state', async () => {
    const { userData, copy: previous } = await aCopiedWorkspace()
    const options = optionsFor(userData)
    const captured = await captureCheckpoint({
      ...options,
      hashCopy: async () => ({ kind: 'failed', message: 'fictional hash EIO' }),
    })
    await expect(captured.finish()).rejects.toThrow('fictional hash EIO')
    expect(await prune(userData, LINEAGE, SOLE)).toEqual([])
    expect(existsSync(previous.folder)).toBe(true)
    const resumed = await resumeCapturedCheckpoints(options)
    expect(resumed.map(({ manifest }) => manifest.id)).toEqual([captured.manifest.id])
    const made = await resumed[0]!.finish()
    expect(parseManifest(readFileSync(join(made.folder, 'manifest.json'), 'utf8'))).toEqual({
      ok: true,
      value: made.manifest,
    })
    expect(existsSync(join(made.folder, 'unfinished'))).toBe(false)
    expect(existsSync(previous.folder)).toBe(true)
  })

  it('cancels completion without deleting the durable capture or publishing a partial manifest', async () => {
    const userData = aLiveWorkspace()
    const abort = new AbortController()
    const options = optionsFor(userData)
    const captured = await captureCheckpoint({ ...options, signal: abort.signal })
    abort.abort()
    await expect(captured.finish()).rejects.toThrow()
    const folder = join(userData, 'backups', captured.manifest.id)
    expect(existsSync(join(folder, 'database.sqlite'))).toBe(true)
    expect(existsSync(join(folder, 'manifest.json'))).toBe(false)
    expect(await listOfferable(userData, LINEAGE)).toEqual([])
    expect(await resumeCapturedCheckpoints(options)).toHaveLength(1)
  })
})
