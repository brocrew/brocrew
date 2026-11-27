import type { VerifyCopy } from './copy-check'
import { prepareDatabaseSnapshot } from '../database/sqlite/evidence/recovery'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { OfferedCheckpoint, ProgressListener } from '../../shared/recovery'
import { freeBytesOn } from '../archive/native-file'
import type { HostGateVerdict } from '../one-host-gate'
import {
  MANIFEST_FORMAT,
  parseManifest,
  serializeManifest,
  type CheckpointManifest,
  type CheckpointReason,
  type ManifestFile,
  type Migration,
} from './contract'
import {
  hasPendingMigrations,
  sameMigrations,
  type BuildMigration,
  type MigrationsRead,
} from './database-facts'
import {
  assertOwnedPathsAreReal,
  copyDurably,
  errorCode,
  nodeFs,
  pathExists,
  privateDir,
  readTextOrNull,
  retrying,
  sha256Of,
  syncFolder,
  writeAtomically,
  type RecoveryFs,
  type RecoveryStats,
} from './files'
import {
  COPY_FILE,
  MANIFEST_FILE,
  UNFINISHED_FILE,
  backupsDir,
  checkpointDatabase,
  checkpointDir,
  databaseFile,
  manifestFile,
  stateFile,
  workspaceIdFile,
} from './layout'
import { CHECKPOINT_LINE } from './log-lines'
import { removeCheckpointCopy, removeCheckpointEntry } from './checkpoint-deletion'
import { APP_STATE_FILES } from './state-files'
import { copySkillTree, stateContentAt as contentAt } from './trees'
import { SKILL_TREES, SKILLS_CONVERSION_FILE } from '../skills/shared-paths'
import { CheckpointFailed, checkFreeSpace, failureFrom } from './checkpoint-space'
export {
  CheckpointFailed,
  CheckpointNoRoom,
  checkpointSpaceNeeded,
  inWords,
} from './checkpoint-space'
import {
  type Checkpoint,
  foldersInBackups,
  isIntact,
  listOfferable,
  readWorkspaceId,
} from './checkpoint-found'
export { type Checkpoint, isIntact, listCheckpoints, listOfferable } from './checkpoint-found'
export {
  deleteRetainedCopy,
  prune,
  type PruneOptions,
  recordSuccessfulStart,
  retainedCopyInfo,
} from './checkpoint-retention'

export type CheckpointStep = 'copy' | 'verify' | 'files' | 'manifest'

export function offeredFrom(checkpoint: Checkpoint): OfferedCheckpoint {
  const { id, createdAt, database } = checkpoint.manifest
  return { id, createdAt, bytes: database.bytes }
}

export interface CheckpointFacts {
  readonly database: MigrationsRead
  readonly lineage: readonly BuildMigration[]
  readonly release: string | null
  readonly build?: string | null
  readonly offerable: readonly Checkpoint[]
  readonly databaseChangedAt: number | null
  readonly intact?: ReadonlySet<string>
}

export function needsACheckpoint(facts: CheckpointFacts): CheckpointReason | null {
  const { database } = facts
  if (database.kind !== 'recorded') return null
  if (hasPendingMigrations(database.migrations, facts.lineage)) {
    const reused = reusableCopies(facts).some(
      ({ manifest }) => facts.intact?.has(manifest.id) === true,
    )
    return reused ? null : 'before-migration'
  }
  return null
}

export interface CheckpointQuestion {
  readonly userData: string
  readonly database: MigrationsRead
  readonly lineage: readonly BuildMigration[]
  readonly release: string | null
  readonly build?: string | null
  readonly fs?: RecoveryFs
}

export async function checkpointNeeded(
  question: CheckpointQuestion,
): Promise<CheckpointReason | null> {
  const { userData, database, lineage, release } = question
  const fs = question.fs ?? nodeFs
  if (database.kind !== 'recorded') return null
  const facts: CheckpointFacts = {
    database,
    lineage,
    release,
    build: question.build ?? null,
    offerable: await listOfferable(userData, lineage, fs),
    databaseChangedAt: await whenTheDatabaseLastChanged(userData, fs),
  }
  const intact = new Set<string>()
  const reusable = hasPendingMigrations(database.migrations, lineage) ? reusableCopies(facts) : []
  for (const candidate of reusable) {
    if (await isIntact(candidate, fs)) {
      intact.add(candidate.manifest.id)
      break
    }
  }
  return needsACheckpoint({ ...facts, intact })
}

function reusableCopies(facts: CheckpointFacts): Checkpoint[] {
  const { database, release, databaseChangedAt } = facts
  const build = facts.build ?? null
  if (database.kind !== 'recorded' || databaseChangedAt === null) return []
  const byThisBuild = ({ madeBy }: CheckpointManifest): boolean =>
    release === null ? build !== null && madeBy.build === build : madeBy.appVersion === release
  return facts.offerable.filter(
    ({ manifest }) =>
      manifest.reason === 'before-migration' &&
      byThisBuild(manifest) &&
      sameMigrations(manifest.database.migrations, database.migrations) &&
      Math.floor(databaseChangedAt) <= Date.parse(manifest.createdAt),
  )
}

export async function whenTheDatabaseLastChanged(
  userData: string,
  fs: RecoveryFs = nodeFs,
): Promise<number | null> {
  const main = databaseFile(userData)
  const stats = await statOrNull(main, fs)
  if (stats === null) return null
  let newest = stats.mtimeMs
  for (const suffix of ['-wal', '-journal']) {
    const sidecar = await statOrNull(`${main}${suffix}`, fs)
    if (sidecar !== null && sidecar.size > 0) newest = Math.max(newest, sidecar.mtimeMs)
  }
  return newest
}

export async function theNewestIntact(
  offerable: readonly Checkpoint[],
  fs: RecoveryFs = nodeFs,
): Promise<Checkpoint | null> {
  for (const checkpoint of offerable) {
    if (await isIntact(checkpoint, fs)) return checkpoint
  }
  return null
}

export interface MakeCheckpointOptions {
  readonly userData: string
  readonly ownership: HostGateVerdict
  readonly appVersion: string
  readonly build: string | null
  readonly reason: CheckpointReason
  readonly progress?: ProgressListener
  readonly fs?: RecoveryFs
  readonly now?: () => number
  readonly freeBytes?: (path: string) => number | null
  readonly log?: (line: string) => void
  readonly beforeStep?: (step: CheckpointStep) => void
  readonly verifyCopy: VerifyCopy
  readonly hashCopy?: VerifyCopy
  readonly signal?: AbortSignal
  readonly expectedMigrations?: readonly Migration[]
  readonly beforeCopy?: (snapshotBytes: number) => Promise<void>
}

type CapturedManifest = Omit<CheckpointManifest, 'database'> & {
  readonly database: Omit<CheckpointManifest['database'], 'sha256'>
}

export interface CapturedCheckpoint {
  readonly manifest: CapturedManifest
  finish(): Promise<Checkpoint>
}

function completion(
  options: MakeCheckpointOptions,
  folder: string,
  captured: CapturedManifest,
): CapturedCheckpoint {
  const fs = options.fs ?? nodeFs
  return {
    manifest: captured,
    async finish() {
      options.signal?.throwIfAborted()
      const copy = join(folder, COPY_FILE)
      const checked = options.hashCopy ? await options.hashCopy(copy) : null
      const sha256 =
        checked === null
          ? await sha256Of(copy, fs)
          : checked.kind === 'ok'
            ? checked.sha256
            : undefined
      if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error(
          checked?.kind === 'failed' ? checked.message : 'The recovery copy hash did not finish.',
        )
      }
      options.signal?.throwIfAborted()
      options.beforeStep?.('manifest')
      const manifest: CheckpointManifest = {
        ...captured,
        database: { ...captured.database, sha256 },
      }
      await writeAtomically(
        manifestFile(options.userData, manifest.id),
        serializeManifest(manifest),
        fs,
      )
      await removeCheckpointEntry(options.userData, folder, UNFINISHED_FILE, fs)
      options.progress?.(3, 3)
      ;(options.log ?? console.log)(CHECKPOINT_LINE)
      return { folder, manifest }
    },
  }
}

export async function makeCheckpoint(options: MakeCheckpointOptions): Promise<Checkpoint> {
  const captured = await capture(options, options.verifyCopy)
  const folder = checkpointDir(options.userData, captured.manifest.id)
  try {
    return await captured.finish()
  } catch (error) {
    const fs = options.fs ?? nodeFs
    if (!(await pathExists(join(folder, MANIFEST_FILE), fs))) {
      await removeUnfinished(options.userData, folder, fs)
    }
    throw failureFrom(error)
  }
}

export async function captureCheckpoint(
  options: MakeCheckpointOptions,
): Promise<CapturedCheckpoint> {
  return capture(options)
}

async function capture(
  options: MakeCheckpointOptions,
  verifySource?: VerifyCopy,
): Promise<CapturedCheckpoint> {
  const { userData } = options
  const fs = options.fs ?? nodeFs
  const beforeStep = options.beforeStep ?? (() => undefined)
  if (options.ownership !== 'sole')
    throw new CheckpointFailed('Another copy may have this workspace open.', false)
  options.signal?.throwIfAborted()
  const id = randomUUID()
  const folder = checkpointDir(userData, id)
  const copy = checkpointDatabase(userData, id)
  let hadBackups = true
  let captured = false
  let made = false
  try {
    hadBackups = await pathExists(backupsDir(userData), fs)
    const copyDatabase = prepareDatabaseSnapshot(databaseFile(userData), {
      fs,
      signal: options.signal,
      expectedMigrations: options.expectedMigrations,
      userData,
      freeBytes: (path) => (options.freeBytes ?? freeBytesOn)(path),
      verifySource,
    })
    await options.beforeCopy?.(copyDatabase.bytes)
    options.signal?.throwIfAborted()
    checkFreeSpace(userData, copyDatabase.bytes, options.freeBytes ?? freeBytesOn)
    await privateDir(backupsDir(userData), fs)
    await assertOwnedPathsAreReal(userData, [folder], fs)
    await fs.mkdir(folder, { mode: 0o700 })
    made = true
    await fs.writeFile(join(folder, UNFINISHED_FILE), '', { mode: 0o600, flag: 'wx' })
    await syncFolder(backupsDir(userData), fs)
    beforeStep('copy')
    options.progress?.(0, 3)
    const snapshot = await copyDatabase.copyTo(copy)
    options.signal?.throwIfAborted()
    options.progress?.(1, 3)
    beforeStep('verify')
    beforeStep('files')
    const files = await copyStateFiles(userData, folder, fs)
    options.progress?.(2, 3)
    const workspaceId = await workspaceIdFor(userData, fs)
    const manifest: CapturedManifest = {
      format: MANIFEST_FORMAT,
      version: 1,
      id,
      createdAt: new Date((options.now ?? Date.now)()).toISOString(),
      workspaceId,
      reason: options.reason,
      madeBy: { appVersion: options.appVersion, build: options.build },
      database: {
        file: COPY_FILE,
        bytes: (await fs.lstat(copy)).size,
        compression: 'gzip',
        uncompressedBytes: snapshot.bytes,
        uncompressedSha256: snapshot.sha256,
        migrations: snapshot.migrations,
      },
      files,
    }
    options.signal?.throwIfAborted()
    await writeAtomically(join(folder, UNFINISHED_FILE), JSON.stringify(manifest), fs)
    await syncFolder(folder, fs)
    captured = true
    return completion(options, folder, manifest)
  } catch (error) {
    if (made && !captured) {
      await removeUnfinished(userData, folder, fs)
      if (!hadBackups) await fs.rmdir(backupsDir(userData)).catch(() => undefined)
    }
    throw failureFrom(error)
  }
}

export async function resumeCapturedCheckpoints(
  options: MakeCheckpointOptions,
): Promise<CapturedCheckpoint[]> {
  if (options.ownership !== 'sole') return []
  const fs = options.fs ?? nodeFs
  const workspace = await readWorkspaceId(options.userData, fs)
  if (workspace.kind !== 'id') return []
  const result: CapturedCheckpoint[] = []
  for (const { name, found } of await foldersInBackups(options.userData, fs)) {
    if (found.kind !== 'unfinished' || !found.marked) continue
    const folder = checkpointDir(options.userData, name)
    const text = await readTextOrNull(join(folder, UNFINISHED_FILE), fs)
    if (!text) continue
    let manifest: CapturedManifest
    try {
      manifest = JSON.parse(text) as CapturedManifest
    } catch {
      continue
    }
    if (
      !parseManifest(
        JSON.stringify({
          ...manifest,
          database: { ...manifest.database, sha256: '0'.repeat(64) },
        }),
      ).ok ||
      manifest.id !== name ||
      manifest.workspaceId !== workspace.id
    ) {
      throw new Error(`The unfinished recovery copy ${name} has unreadable capture metadata.`)
    }
    if ((await fs.lstat(join(folder, COPY_FILE))).size !== manifest.database.bytes) {
      throw new Error(`The unfinished recovery copy ${name} is incomplete.`)
    }
    result.push(completion(options, folder, manifest))
  }
  return result
}

async function statOrNull(path: string, fs: RecoveryFs): Promise<RecoveryStats | null> {
  try {
    return await fs.stat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function workspaceIdFor(userData: string, fs: RecoveryFs): Promise<string> {
  const found = await readWorkspaceId(userData, fs)
  if (found.kind === 'id') return found.id
  if (found.kind === 'unreadable') {
    throw new CheckpointFailed(
      `BroCrew could not read ${workspaceIdFile(userData)}, which ties this workspace to its ` +
        'recovery copies, so it made no copy.',
      found.canRetry,
    )
  }
  const id = randomUUID()
  await writeAtomically(workspaceIdFile(userData), `${id}\n`, fs)
  return id
}

async function copyStateFiles(
  userData: string,
  folder: string,
  fs: RecoveryFs,
): Promise<ManifestFile[]> {
  const names = [...SKILL_TREES, SKILLS_CONVERSION_FILE]
  const states = (root: string) => Promise.all(names.map((name) => contentAt(join(root, name), fs)))
  let last: unknown = new Error('Skills could not be read.')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = JSON.stringify(await states(userData))
      const result = await copyStateFilesOnce(userData, folder, fs)
      if (
        JSON.stringify(await states(userData)) === before &&
        JSON.stringify(await states(folder)) === before
      )
        return result
    } catch (error) {
      last = error
    }
  }
  throw last
}

async function copyStateFilesOnce(
  userData: string,
  folder: string,
  fs: RecoveryFs,
): Promise<ManifestFile[]> {
  const files: ManifestFile[] = []
  for (const file of APP_STATE_FILES) {
    const source = stateFile(userData, file)
    const copy = join(folder, file.name)
    let tree
    try {
      await assertOwnedPathsAreReal(userData, [copy], fs)
      tree = await retrying(async () => {
        await removeCheckpointEntry(userData, folder, file.name, fs)
        if (file.kind === 'tree') return copySkillTree(source, copy, fs)
        await copyDurably(source, copy, fs)
        return null
      })
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' || (await pathExists(source, fs))) throw error
      files.push({ name: file.name, present: false })
      continue
    }
    files.push({
      name: file.name,
      present: true,
      bytes: tree?.bytes ?? (await fs.lstat(copy)).size,
      sha256: tree?.sha256 ?? (await sha256Of(copy, fs)),
    })
  }
  return files
}

async function removeUnfinished(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  try {
    await removeCheckpointCopy(userData, folder, fs)
  } catch {
    // Left for a later prune.
  }
}
