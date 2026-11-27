/**
 * Which recovery copies are kept and which are deleted: pruning, the retention receipt after a
 * successful start, and deleting a retained copy. Split out of checkpoint.ts as a pure move.
 */
import { join } from 'node:path'
import type { RetainedRecoveryCopy } from '../../shared/recovery-retention'
import type { HostGateVerdict } from '../one-host-gate'
import type { BuildMigration } from './database-facts'
import {
  assertOwnedPathsAreReal,
  nodeFs,
  pathExists,
  readTextOrNull,
  writeAtomically,
  type RecoveryFs,
} from './files'
import {
  COPY_FILE,
  MANIFEST_FILE,
  UNFINISHED_FILE,
  backupsDir,
  checkpointDir,
  gateFile,
  journalFile,
  isUuid,
  workspaceIdFile,
} from './layout'
import {
  beginCheckpointDeletion,
  checkpointFileBytes,
  deletionRemnant,
  finishCheckpointDeletion,
  readCheckpointDeletion,
  removeCheckpointCopy,
  type CheckpointDeletion,
} from './checkpoint-deletion'
import { SKILL_TREES } from '../skills/shared-paths'
import { CheckpointFailed } from './checkpoint-space'
import {
  type Checkpoint,
  couldBeOffered,
  foldersInBackups,
  hasPendingCapture,
  type InBackups,
  isIntact,
  listOfferable,
  ofThisWorkspace,
  readWorkspaceId,
  wholeness,
  type WorkspaceIdOnDisk,
} from './checkpoint-found'

const KEEP_NEWEST = 1

export interface PruneOptions {
  readonly ownership: HostGateVerdict
  readonly fs?: RecoveryFs
  readonly now?: () => number
  readonly warn?: (line: string) => void
  readonly currentAppVersion?: string
  readonly replacing?: boolean
  readonly beforeDelete?: (estimatedFileBytes: number) => void | Promise<void>
}

export async function prune(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<string[]> {
  if (options.ownership !== 'sole') {
    if (options.replacing)
      throw new CheckpointFailed('Another copy may have this workspace open.', false)
    return []
  }
  const fs = options.fs ?? nodeFs
  const warn = options.warn ?? ((line: string) => console.warn(line))
  const notThisTime = (why: string): string[] => {
    if (options.replacing) throw new CheckpointFailed(why, true)
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
  if (await hasPendingCapture(userData, folders, fs))
    return notThisTime('A recovery copy is waiting to finish.')
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
    if (found === 'whole' || options.replacing) whole.push(checkpoint)
  }
  let candidates = whole
  const keepingOf = (copies: readonly Checkpoint[]): Set<string> => {
    if (options.replacing) return new Set<string>()
    const beforeMigration = copies.filter(({ manifest }) => manifest.reason === 'before-migration')
    const latest = beforeMigration.length > 0 ? beforeMigration : copies
    return new Set(latest.slice(0, KEEP_NEWEST).map(({ manifest }) => manifest.id))
  }
  const intact = new Set<string>()
  for (;;) {
    const keeping = keepingOf(candidates)
    if (candidates.every(({ manifest }) => keeping.has(manifest.id))) break
    const unchecked = candidates.find(
      ({ manifest }) => keeping.has(manifest.id) && !intact.has(manifest.id),
    )
    if (unchecked === undefined) break
    if (await isIntact(unchecked, fs)) intact.add(unchecked.manifest.id)
    else candidates = candidates.filter((checkpoint) => checkpoint !== unchecked)
  }
  const kept = keepingOf(candidates)
  const goes: string[] = []
  for (const checkpoint of candidates) {
    if (!kept.has(checkpoint.manifest.id)) {
      try {
        if (await onlyCheckpointFiles(checkpoint, fs)) goes.push(checkpoint.manifest.id)
        else if (options.replacing)
          return notThisTime('The previous recovery folder contains other files.')
      } catch (error) {
        return notThisTime(messageOf(error))
      }
    }
  }

  const unfinished = options.replacing
    ? folders.filter(({ found }) => found.kind === 'unfinished' && found.marked)
    : []
  if (unfinished.some(({ found }) => found.kind === 'unfinished' && !found.onlyTheWritersFiles))
    return notThisTime('An unfinished recovery folder contains other files.')
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
  }
  if (options.beforeDelete) {
    let bytes = deletion ? ((await deletionRemnant(userData, deletion, fs))?.bytes ?? 0) : 0
    for (const name of goes)
      bytes += await checkpointFileBytes(userData, checkpointDir(userData, name), fs)
    for (const { name } of unfinished)
      bytes += await checkpointFileBytes(userData, checkpointDir(userData, name), fs)
    await options.beforeDelete(bytes)
  }
  const removed: string[] = []
  if (deletion) {
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
      if (options.replacing) return notThisTime(messageOf(error))
      warn(`BroCrew could not remove the old recovery copy in ${folder}: ${messageOf(error)}`)
      return removed
    }
  }
  for (const { name } of unfinished) {
    await removeCheckpointCopy(userData, checkpointDir(userData, name), fs)
    removed.push(name)
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
  if (same) return
  const receipt: RetentionReceipt = {
    format: 'brocrew-recovery-retention',
    version: 1,
    workspaceId: workspace.id,
    appVersion: options.currentAppVersion,
    checkpointId,
    successfulStarts: 1,
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
