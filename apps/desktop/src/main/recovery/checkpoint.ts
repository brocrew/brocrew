import type { VerifyCopy } from './copy-check'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { OfferedCheckpoint, ProgressListener } from '../../shared/recovery'
import type { RetainedRecoveryCopy } from '../../shared/recovery-retention'
import { freeBytesOn } from '../archive/native-file'
import type { HostGateVerdict } from '../one-host-gate'
import {
  MANIFEST_FORMAT,
  parseManifest,
  parseWorkspaceId,
  serializeManifest,
  type CheckpointManifest,
  type CheckpointReason,
  type ManifestFile,
  type Migration,
} from './contract'
import {
  hasPendingMigrations,
  isLineagePrefix,
  prepareSnapshotDatabase,
  sameMigrations,
  prepareDatabaseSnapshot,
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
  gateFile,
  journalFile,
  isUuid,
  manifestFile,
  stateFile,
  workspaceIdFile,
} from './layout'
import { CHECKPOINT_LINE } from './log-lines'
import {
  beginCheckpointDeletion,
  deletionRemnant,
  finishCheckpointDeletion,
  readCheckpointDeletion,
  removeCheckpointCopy,
  removeCheckpointEntry,
  type CheckpointDeletion,
} from './checkpoint-deletion'
import { APP_STATE_FILES } from './state-files'
import { copySkillTree, stateContentAt as contentAt } from './trees'
import { SKILL_TREES, SKILLS_CONVERSION_FILE } from '../skills/shared-paths'

export type CheckpointStep = 'copy' | 'verify' | 'files' | 'manifest'

export class CheckpointFailed extends Error {
  constructor(
    message: string,
    readonly canRetry: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CheckpointFailed'
  }
}

export class CheckpointNoRoom extends CheckpointFailed {
  constructor(
    readonly needed: number,
    readonly free: number,
  ) {
    super(
      `A recovery copy of this workspace's data needs about ${inWords(needed)} free on its disk, ` +
        `and ${inWords(free)} is free.`,
      true,
    )
    this.name = 'CheckpointNoRoom'
  }
}

export interface Checkpoint {
  readonly folder: string
  readonly manifest: CheckpointManifest
}

export function offeredFrom(checkpoint: Checkpoint): OfferedCheckpoint {
  const { id, createdAt, database } = checkpoint.manifest
  return { id, createdAt, bytes: database.bytes }
}

const REGISTRY: ReadonlySet<string> = new Set(APP_STATE_FILES.map((file) => file.name))

const RESTORED_WITH_THE_DATABASE: ReadonlySet<string> = new Set(
  APP_STATE_FILES.filter((file) => file.restore === 'with-the-database').map((file) => file.name),
)

const KEEP_NEWEST = 2
const HEADROOM_SHARE = 1.1
const HEADROOM_BYTES = 64 * 1024 * 1024

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
  const byThisRelease = facts.offerable.some(
    ({ manifest }) => manifest.madeBy.appVersion === facts.release,
  )
  return facts.release !== null && !byThisRelease ? 'first-start-of-release' : null
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
  const needed = needsACheckpoint(facts)
  if (needed === 'first-start-of-release') {
    try {
      const receipt = await readRetentionReceipt(userData, fs)
      if (receipt?.appVersion === release) return null
    } catch {
      // An unreadable receipt cannot establish that this release has already opened.
    }
  }
  return needed
}

function reusableCopies(facts: CheckpointFacts): Checkpoint[] {
  const { database, release, databaseChangedAt } = facts
  const build = facts.build ?? null
  if (database.kind !== 'recorded' || databaseChangedAt === null) return []
  const byThisBuild = ({ madeBy }: CheckpointManifest): boolean =>
    release === null ? build !== null && madeBy.build === build : madeBy.appVersion === release
  return facts.offerable.filter(
    ({ manifest }) =>
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

export async function isIntact(checkpoint: Checkpoint, fs: RecoveryFs = nodeFs): Promise<boolean> {
  for (const { name, sha256 } of installedByARestore(checkpoint.manifest)) {
    const content = await contentAt(join(checkpoint.folder, name), fs).catch(() => null)
    if (content?.kind !== 'file' || content.sha256 !== sha256) return false
  }
  return true
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
  const captured = await captureCheckpoint(options)
  const folder = checkpointDir(options.userData, captured.manifest.id)
  try {
    const checked = await options.verifyCopy(join(folder, COPY_FILE))
    if (checked.kind === 'damaged') {
      throw new CheckpointFailed(
        `BroCrew's copy did not pass SQLite's own check (${checked.check}).`,
        false,
      )
    }
    if (checked.kind === 'failed') throw new Error(checked.message)
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
  const { userData } = options
  const fs = options.fs ?? nodeFs
  const beforeStep = options.beforeStep ?? (() => undefined)
  if (options.ownership !== 'sole')
    throw new CheckpointFailed('Another copy may have this workspace open.', false)
  options.signal?.throwIfAborted()
  const id = randomUUID()
  const folder = checkpointDir(userData, id)
  const copy = checkpointDatabase(userData, id)
  let captured = false
  let made = false
  try {
    const copyDatabase = prepareDatabaseSnapshot(databaseFile(userData), {
      fs,
      signal: options.signal,
      progress: options.progress,
      beforeFallback: (bytes) => checkFreeSpace(userData, bytes, options.freeBytes ?? freeBytesOn),
    })
    await privateDir(backupsDir(userData), fs)
    const workspaceId = await workspaceIdFor(userData, fs)
    await assertOwnedPathsAreReal(userData, [folder], fs)
    await fs.mkdir(folder, { mode: 0o700 })
    made = true
    await fs.writeFile(join(folder, UNFINISHED_FILE), '', { mode: 0o600, flag: 'wx' })
    await syncFolder(backupsDir(userData), fs)
    beforeStep('copy')
    options.progress?.(0, 3)
    await copyDatabase(copy)
    options.signal?.throwIfAborted()
    options.progress?.(1, 3)
    beforeStep('verify')
    const migrations = prepareSnapshotDatabase(copy, options.expectedMigrations)
    await leaveOneFile(userData, copy, fs)
    await putOnDisk(copy, fs)
    beforeStep('files')
    const files = await copyStateFiles(userData, folder, fs)
    options.progress?.(2, 3)
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
        migrations,
      },
      files,
    }
    options.signal?.throwIfAborted()
    await writeAtomically(join(folder, UNFINISHED_FILE), JSON.stringify(manifest), fs)
    await syncFolder(folder, fs)
    captured = true
    return completion(options, folder, manifest)
  } catch (error) {
    if (made && !captured) await removeUnfinished(userData, folder, fs)
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
      manifest.format !== MANIFEST_FORMAT ||
      manifest.version !== 1 ||
      manifest.id !== name ||
      manifest.workspaceId !== workspace.id ||
      manifest.database?.file !== COPY_FILE ||
      !Array.isArray(manifest.database.migrations) ||
      !Array.isArray(manifest.files) ||
      typeof manifest.madeBy?.appVersion !== 'string'
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

async function hasPendingCapture(
  userData: string,
  folders: readonly InBackups[],
  fs: RecoveryFs,
): Promise<boolean> {
  for (const { name, found } of folders) {
    if (found.kind !== 'unfinished' || !found.marked) continue
    const marker = await readTextOrNull(join(checkpointDir(userData, name), UNFINISHED_FILE), fs)
    if (marker?.trim()) return true
  }
  return false
}

export async function listCheckpoints(
  userData: string,
  fs: RecoveryFs = nodeFs,
): Promise<Checkpoint[]> {
  const folders = await foldersInBackups(userData, fs).catch(() => [])
  const workspace = await readWorkspaceId(userData, fs)
  return workspace.kind === 'id' ? ofThisWorkspace(workspace.id, folders) : []
}

export async function listOfferable(
  userData: string,
  lineage: readonly BuildMigration[],
  fs: RecoveryFs = nodeFs,
): Promise<Checkpoint[]> {
  const offerable: Checkpoint[] = []
  const workspace = await readWorkspaceId(userData, fs)
  let deletion: CheckpointDeletion | null
  try {
    deletion = await readCheckpointDeletion(
      userData,
      workspace.kind === 'id' ? workspace.id : null,
      fs,
    )
  } catch {
    return []
  }
  for (const checkpoint of await listCheckpoints(userData, fs)) {
    if (checkpoint.manifest.id === deletion?.manifest.id) continue
    if (!couldBeOffered(checkpoint, lineage)) continue
    if ((await wholeness(checkpoint, fs)) === 'whole') offerable.push(checkpoint)
  }
  return offerable
}

export interface PruneOptions {
  readonly ownership: HostGateVerdict
  readonly fs?: RecoveryFs
  readonly now?: () => number
  readonly warn?: (line: string) => void
  readonly currentAppVersion?: string
}

export async function prune(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<string[]> {
  if (options.ownership !== 'sole') return []
  const fs = options.fs ?? nodeFs
  const warn = options.warn ?? ((line: string) => console.warn(line))
  const notThisTime = (why: string): string[] => {
    warn(`BroCrew kept every old recovery copy this time: ${why}`)
    return []
  }

  let folders: InBackups[]
  let workspace: WorkspaceIdOnDisk
  try {
    await assertOwnedPathsAreReal(userData, [], fs)
    if ((await pathExists(gateFile(userData), fs)) || (await pathExists(journalFile(userData), fs)))
      return notThisTime('A restore is in progress.')
    folders = await foldersInBackups(userData, fs)
    workspace = await readWorkspaceId(userData, fs)
  } catch (error) {
    return notThisTime(messageOf(error))
  }
  if (await hasPendingCapture(userData, folders, fs)) return []
  const unread = folders.find(({ found }) => found.kind === 'unknown')
  if (unread !== undefined) {
    return notThisTime(`${checkpointDir(userData, unread.name)} could not be read.`)
  }
  if (workspace.kind === 'unreadable') {
    return notThisTime(`${workspaceIdFile(userData)} could not be read.`)
  }

  let deletion: CheckpointDeletion | null
  try {
    await readRetentionReceipt(userData, fs)
    deletion = await readCheckpointDeletion(
      userData,
      workspace.kind === 'id' ? workspace.id : null,
      fs,
    )
  } catch (error) {
    return notThisTime(messageOf(error))
  }
  const whole: Checkpoint[] = []
  for (const checkpoint of workspace.kind === 'id' ? ofThisWorkspace(workspace.id, folders) : []) {
    if (checkpoint.manifest.id === deletion?.manifest.id) continue
    if (
      options.currentAppVersion !== undefined &&
      newerAppVersion(checkpoint.manifest.madeBy.appVersion, options.currentAppVersion)
    ) {
      continue
    }
    if (!couldBeOffered(checkpoint, lineage)) continue
    const found = await wholeness(checkpoint, fs)
    if (found === 'unknown') return notThisTime(`${checkpoint.folder} could not be read.`)
    if (found === 'whole') whole.push(checkpoint)
  }
  const candidates = whole
  const keepingOf = (copies: readonly Checkpoint[]): Set<string> =>
    new Set(copies.slice(0, KEEP_NEWEST).map(({ manifest }) => manifest.id))
  const kept = keepingOf(candidates)
  const goes: string[] = []
  for (const checkpoint of candidates) {
    if (!kept.has(checkpoint.manifest.id)) {
      try {
        if (await onlyCheckpointFiles(checkpoint, fs)) goes.push(checkpoint.manifest.id)
      } catch (error) {
        return notThisTime(messageOf(error))
      }
    }
  }

  const removed: string[] = []
  if (deletion) {
    const selected = {
      folder: checkpointDir(userData, deletion.manifest.id),
      manifest: deletion.manifest,
    }
    if (
      !couldBeOffered(selected, lineage) ||
      (options.currentAppVersion !== undefined &&
        newerAppVersion(deletion.manifest.madeBy.appVersion, options.currentAppVersion))
    )
      return notThisTime('An unfinished deletion belongs to a newer recovery copy.')
    try {
      if (await finishCheckpointDeletion(userData, deletion, fs)) removed.push(deletion.manifest.id)
    } catch (error) {
      return notThisTime(messageOf(error))
    }
  }
  for (const name of goes) {
    const folder = checkpointDir(userData, name)
    try {
      const copy = candidates.find(({ manifest }) => manifest.id === name)!
      await finishCheckpointDeletion(
        userData,
        await beginCheckpointDeletion(userData, copy, fs),
        fs,
      )
      removed.push(name)
    } catch (error) {
      warn(`BroCrew could not remove the old recovery copy in ${folder}: ${messageOf(error)}`)
      return removed
    }
  }
  return removed
}

function newerAppVersion(candidate: string, current: string): boolean {
  const parse = (version: string): RegExpMatchArray | null =>
    version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  const a = parse(candidate)
  const b = parse(current)
  if (a === null || b === null) return true
  for (const part of [1, 2, 3]) {
    const difference = Number(a[part]) - Number(b[part])
    if (difference !== 0) return difference > 0
  }
  const aPre = a[4]
  const bPre = b[4]
  if (aPre === undefined) return bPre !== undefined
  if (bPre === undefined) return false
  const aParts = aPre.split('.')
  const bParts = bPre.split('.')
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const left = aParts[index]
    const right = bParts[index]
    if (left === undefined) return false
    if (right === undefined) return true
    if (left === right) continue
    const leftNumber = /^\d+$/.test(left)
    const rightNumber = /^\d+$/.test(right)
    if (leftNumber && rightNumber) return Number(left) > Number(right)
    if (leftNumber !== rightNumber) return !leftNumber
    return left > right
  }
  return false
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failureFrom(error: unknown): CheckpointFailed {
  if (error instanceof CheckpointFailed) return error
  return new CheckpointFailed(
    `BroCrew could not make a recovery copy of this workspace's data: ${messageOf(error)}`,
    true,
    { cause: error },
  )
}

async function statOrNull(path: string, fs: RecoveryFs): Promise<RecoveryStats | null> {
  try {
    return await fs.stat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

export function inWords(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${String(Math.max(1, Math.round(bytes / 1e6)))} MB`
}

function checkFreeSpace(
  userData: string,
  databaseBytes: number,
  freeBytes: (path: string) => number | null,
): void {
  const needed = Math.ceil(databaseBytes * HEADROOM_SHARE) + HEADROOM_BYTES
  const free = freeBytes(userData)
  if (free !== null && free < needed) {
    throw new CheckpointNoRoom(needed, free)
  }
}

type WorkspaceIdOnDisk =
  | { readonly kind: 'none' }
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'unreadable'; readonly canRetry: boolean }

async function readWorkspaceId(userData: string, fs: RecoveryFs): Promise<WorkspaceIdOnDisk> {
  let text: string | null
  try {
    text = await readTextOrNull(workspaceIdFile(userData), fs)
  } catch {
    return { kind: 'unreadable', canRetry: true }
  }
  if (text === null) return { kind: 'none' }
  const id = parseWorkspaceId(text)
  return id === null ? { kind: 'unreadable', canRetry: false } : { kind: 'id', id }
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

async function leaveOneFile(userData: string, copy: string, fs: RecoveryFs): Promise<void> {
  if (await pathExists(`${copy}-journal`, fs)) {
    throw new Error('the copy was left with an unfinished write beside it')
  }
  for (const suffix of ['-wal', '-shm']) {
    await assertOwnedPathsAreReal(userData, [`${copy}${suffix}`], fs)
    await removeCheckpointEntry(userData, dirname(copy), `${basename(copy)}${suffix}`, fs)
  }
}

async function putOnDisk(path: string, fs: RecoveryFs): Promise<void> {
  const handle = await fs.open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
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

type FoundInBackups =
  | { readonly kind: 'checkpoint'; readonly checkpoint: Checkpoint }
  | {
      readonly kind: 'unfinished'
      readonly changedAt: number
      readonly marked: boolean
      readonly onlyTheWritersFiles: boolean
    }
  | { readonly kind: 'other' }
  | { readonly kind: 'unknown' }

interface InBackups {
  readonly name: string
  readonly found: FoundInBackups
}

const OTHER: FoundInBackups = { kind: 'other' }
const UNKNOWN: FoundInBackups = { kind: 'unknown' }

async function foldersInBackups(userData: string, fs: RecoveryFs): Promise<InBackups[]> {
  let names: string[]
  try {
    names = await fs.readdir(backupsDir(userData))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  const folders: InBackups[] = []
  for (const name of names.filter(isUuid).sort()) {
    folders.push({ name, found: await readFolder(userData, name, fs) })
  }
  return folders
}

function ofThisWorkspace(workspaceId: string, folders: readonly InBackups[]): Checkpoint[] {
  return folders
    .flatMap(({ found }) =>
      found.kind === 'checkpoint' && found.checkpoint.manifest.workspaceId === workspaceId
        ? [found.checkpoint]
        : [],
    )
    .sort(newestFirst)
}

function couldBeOffered(checkpoint: Checkpoint, lineage: readonly BuildMigration[]): boolean {
  const { manifest } = checkpoint
  return (
    isLineagePrefix(manifest.database.migrations, lineage) &&
    manifest.files.every((file) => REGISTRY.has(file.name))
  )
}

async function lstatOrNull(path: string, fs: RecoveryFs): Promise<RecoveryStats | null> {
  try {
    return await retrying(() => fs.lstat(path))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function readFolder(userData: string, name: string, fs: RecoveryFs): Promise<FoundInBackups> {
  const folder = checkpointDir(userData, name)
  const manifestPath = manifestFile(userData, name)
  try {
    const stats = await lstatOrNull(folder, fs)
    if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) return OTHER
    const manifest = await lstatOrNull(manifestPath, fs)
    if (manifest === null) return await unfinished(folder, stats, fs)
    if (manifest.isSymbolicLink() || !manifest.isFile()) return OTHER
    const text = await readTextOrNull(manifestPath, fs)
    if (text === null) return UNKNOWN
    const parsed = parseManifest(text)
    if (!parsed.ok || parsed.value.id !== name) return OTHER
    return { kind: 'checkpoint', checkpoint: { folder, manifest: parsed.value } }
  } catch {
    return UNKNOWN
  }
}

const MANIFEST_BEING_WRITTEN = new RegExp(
  `^${MANIFEST_FILE.replace(/\./g, '\\.')}\\.[0-9a-f]{12}\\.tmp$`,
)

function isTheWritersName(name: string): boolean {
  return (
    [
      UNFINISHED_FILE,
      COPY_FILE,
      `${COPY_FILE}-journal`,
      `${COPY_FILE}-wal`,
      `${COPY_FILE}-shm`,
    ].includes(name) ||
    REGISTRY.has(name) ||
    MANIFEST_BEING_WRITTEN.test(name)
  )
}

async function unfinished(
  folder: string,
  stats: RecoveryStats,
  fs: RecoveryFs,
): Promise<FoundInBackups> {
  let changedAt = stats.mtimeMs
  let marked = false
  let onlyTheWritersFiles = true
  for (const entry of await fs.readdir(folder)) {
    const inside = await lstatOrNull(join(folder, entry), fs)
    if (inside === null) continue
    changedAt = Math.max(changedAt, inside.mtimeMs)
    if (
      !(inside.isFile() || (inside.isDirectory() && SKILL_TREES.includes(entry))) ||
      !isTheWritersName(entry)
    )
      onlyTheWritersFiles = false
    if (entry === UNFINISHED_FILE && inside.isFile()) marked = true
  }
  return { kind: 'unfinished', changedAt, marked, onlyTheWritersFiles }
}

function installedByARestore(
  manifest: CheckpointManifest,
): { readonly name: string; readonly bytes: number; readonly sha256: string }[] {
  return [
    { name: COPY_FILE, bytes: manifest.database.bytes, sha256: manifest.database.sha256 },
    ...manifest.files.flatMap((file) =>
      file.present && RESTORED_WITH_THE_DATABASE.has(file.name)
        ? [{ name: file.name, bytes: file.bytes, sha256: file.sha256 }]
        : [],
    ),
  ]
}

async function wholeness(
  checkpoint: Checkpoint,
  fs: RecoveryFs,
): Promise<'whole' | 'not-whole' | 'unknown'> {
  for (const { name, bytes } of installedByARestore(checkpoint.manifest)) {
    let stats: RecoveryStats | null
    try {
      stats = await lstatOrNull(join(checkpoint.folder, name), fs)
    } catch {
      return 'unknown'
    }
    if (SKILL_TREES.includes(name)) {
      if (!stats?.isDirectory() || stats.isSymbolicLink()) return 'not-whole'
    } else if (stats === null || !stats.isFile() || stats.size !== bytes) return 'not-whole'
  }
  return 'whole'
}

function newestFirst(a: Checkpoint, b: Checkpoint): number {
  const byTime = Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt)
  if (byTime !== 0) return byTime
  return a.manifest.id < b.manifest.id ? 1 : a.manifest.id > b.manifest.id ? -1 : 0
}

const RETENTION_FILE = 'retention.json'
interface RetentionReceipt {
  readonly format: 'brocrew-recovery-retention'
  readonly version: 1
  readonly workspaceId: string
  readonly appVersion: string
  readonly checkpointId: string | null
  readonly successfulStarts: number
}

async function readRetentionReceipt(
  userData: string,
  fs: RecoveryFs,
): Promise<RetentionReceipt | null> {
  const path = join(backupsDir(userData), RETENTION_FILE)
  await assertOwnedPathsAreReal(userData, [path, workspaceIdFile(userData)], fs)
  const text = await readTextOrNull(path, fs)
  if (text === null) return null
  const value = JSON.parse(text) as Partial<RetentionReceipt> | null
  const workspace = await readWorkspaceId(userData, fs)
  if (
    value?.format !== 'brocrew-recovery-retention' ||
    value.version !== 1 ||
    workspace.kind !== 'id' ||
    value.workspaceId !== workspace.id ||
    typeof value.appVersion !== 'string' ||
    value.appVersion.length === 0 ||
    !(
      value.checkpointId === null ||
      (typeof value.checkpointId === 'string' && isUuid(value.checkpointId))
    ) ||
    !Number.isSafeInteger(value.successfulStarts) ||
    (value.successfulStarts ?? -1) < 0
  ) {
    throw new Error('The recovery copy start record could not be read.')
  }
  return value as RetentionReceipt
}

export async function recordSuccessfulStart(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<void> {
  if (options.ownership !== 'sole' || options.currentAppVersion === undefined) return
  const fs = options.fs ?? nodeFs
  await assertOwnedPathsAreReal(userData, [], fs)
  if ((await pathExists(gateFile(userData), fs)) || (await pathExists(journalFile(userData), fs)))
    return
  const workspace = await readWorkspaceId(userData, fs)
  if (workspace.kind !== 'id') return
  const previous = await readRetentionReceipt(userData, fs)
  const newest = (await listOfferable(userData, lineage, fs))[0]
  const checkpointId = newest?.manifest.id ?? previous?.checkpointId ?? null
  const same =
    previous?.appVersion === options.currentAppVersion && previous.checkpointId === checkpointId
  const receipt: RetentionReceipt = {
    format: 'brocrew-recovery-retention',
    version: 1,
    workspaceId: workspace.id,
    appVersion: options.currentAppVersion,
    checkpointId,
    successfulStarts: Math.min(3, same ? previous.successfulStarts + 1 : 1),
  }
  const path = join(backupsDir(userData), RETENTION_FILE)
  await assertOwnedPathsAreReal(userData, [path], fs)
  await writeAtomically(path, JSON.stringify(receipt) + '\n', fs)
}

async function onlyCheckpointFiles(checkpoint: Checkpoint, fs: RecoveryFs): Promise<boolean> {
  const allowed = new Set([
    MANIFEST_FILE,
    UNFINISHED_FILE,
    COPY_FILE,
    ...checkpoint.manifest.files.filter((file) => file.present).map((file) => file.name),
  ])
  for (const name of await fs.readdir(checkpoint.folder)) {
    if (!allowed.has(name)) return false
    const stat = await fs.lstat(join(checkpoint.folder, name))
    if (
      stat.isSymbolicLink() ||
      !(stat.isFile() || (SKILL_TREES.includes(name) && stat.isDirectory()))
    )
      return false
  }
  return true
}

export async function retainedCopyInfo(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<RetainedRecoveryCopy | null> {
  const fs = options.fs ?? nodeFs
  await assertOwnedPathsAreReal(userData, [], fs)
  await readRetentionReceipt(userData, fs)
  const workspace = await readWorkspaceId(userData, fs)
  const deletion = await readCheckpointDeletion(
    userData,
    workspace.kind === 'id' ? workspace.id : null,
    fs,
  )
  const remnant = deletion ? await deletionRemnant(userData, deletion, fs) : null
  if (deletion && remnant) {
    return {
      id: deletion.manifest.id,
      appVersion: deletion.manifest.madeBy.appVersion,
      bytes: remnant.bytes,
    }
  }
  const copy = (await listOfferable(userData, lineage, fs)).find(
    ({ manifest }) =>
      options.currentAppVersion === undefined ||
      !newerAppVersion(manifest.madeBy.appVersion, options.currentAppVersion),
  )
  if (!copy) return null
  return {
    id: copy.manifest.id,
    appVersion: copy.manifest.madeBy.appVersion,
    bytes:
      copy.manifest.database.bytes +
      copy.manifest.files.reduce((total, file) => total + (file.present ? file.bytes : 0), 0),
  }
}

export async function deleteRetainedCopy(
  userData: string,
  lineage: readonly BuildMigration[],
  id: string,
  options: PruneOptions,
): Promise<boolean> {
  if (options.ownership !== 'sole' || !isUuid(id)) return false
  const fs = options.fs ?? nodeFs
  try {
    await assertOwnedPathsAreReal(userData, [], fs)
    if ((await pathExists(gateFile(userData), fs)) || (await pathExists(journalFile(userData), fs)))
      return false
    const folders = await foldersInBackups(userData, fs)
    if (await hasPendingCapture(userData, folders, fs)) return false
    if (folders.some(({ found }) => found.kind === 'unknown')) return false
    const receipt = await readRetentionReceipt(userData, fs)
    const workspace = await readWorkspaceId(userData, fs)
    if (workspace.kind !== 'id') return false
    const deletion = await readCheckpointDeletion(userData, workspace.id, fs)
    if (deletion) {
      const remnant = await deletionRemnant(userData, deletion, fs)
      if (deletion.manifest.id === id) {
        if (
          !couldBeOffered(
            { folder: checkpointDir(userData, id), manifest: deletion.manifest },
            lineage,
          ) ||
          (options.currentAppVersion !== undefined &&
            newerAppVersion(deletion.manifest.madeBy.appVersion, options.currentAppVersion))
        )
          return false
        await finishCheckpointDeletion(userData, deletion, fs)
        return true
      }
      if (remnant) return false
    }
    const candidates = ofThisWorkspace(workspace.id, folders)
    const copy = candidates[0]
    if (
      !copy ||
      copy.manifest.id !== id ||
      !couldBeOffered(copy, lineage) ||
      (options.currentAppVersion !== undefined &&
        newerAppVersion(copy.manifest.madeBy.appVersion, options.currentAppVersion)) ||
      !(await isIntact(copy, fs)) ||
      !(await onlyCheckpointFiles(copy, fs))
    )
      return false
    const runningVersion = options.currentAppVersion ?? copy.manifest.madeBy.appVersion
    if (!receipt || receipt.appVersion !== runningVersion) return false
    await assertOwnedPathsAreReal(userData, [copy.folder], fs)
    await finishCheckpointDeletion(userData, await beginCheckpointDeletion(userData, copy, fs), fs)
    return true
  } catch {
    return false
  }
}
