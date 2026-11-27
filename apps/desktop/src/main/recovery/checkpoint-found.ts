/**
 * What the backups folder holds: each recovery copy found there, whether it is whole and
 * offerable, and which captures were left unfinished. Split out of checkpoint.ts as a pure move.
 */
import { join } from 'node:path'
import { parseManifest, parseWorkspaceId, type CheckpointManifest } from './contract'
import { isLineagePrefix, type BuildMigration } from './database-facts'
import {
  errorCode,
  nodeFs,
  readTextOrNull,
  retrying,
  type RecoveryFs,
  type RecoveryStats,
} from './files'
import {
  COPY_FILE,
  MANIFEST_FILE,
  UNFINISHED_FILE,
  backupsDir,
  checkpointDir,
  isUuid,
  manifestFile,
  workspaceIdFile,
} from './layout'
import {
  captureStagingFolders,
  readCheckpointDeletion,
  type CheckpointDeletion,
} from './checkpoint-deletion'
import { APP_STATE_FILES } from './state-files'
import { stateContentAt as contentAt } from './trees'
import { SKILL_TREES } from '../skills/shared-paths'

export interface Checkpoint {
  readonly folder: string
  readonly manifest: CheckpointManifest
}

const REGISTRY: ReadonlySet<string> = new Set(APP_STATE_FILES.map((file) => file.name))

const RESTORED_WITH_THE_DATABASE: ReadonlySet<string> = new Set(
  APP_STATE_FILES.filter((file) => file.restore === 'with-the-database').map((file) => file.name),
)

export async function isIntact(checkpoint: Checkpoint, fs: RecoveryFs = nodeFs): Promise<boolean> {
  for (const { name, sha256 } of installedByARestore(checkpoint.manifest)) {
    const content = await contentAt(join(checkpoint.folder, name), fs).catch(() => null)
    if (content?.kind !== 'file' || content.sha256 !== sha256) return false
  }
  return true
}

export async function hasPendingCapture(
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

export type WorkspaceIdOnDisk =
  | { readonly kind: 'none' }
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'unreadable'; readonly canRetry: boolean }

export async function readWorkspaceId(
  userData: string,
  fs: RecoveryFs,
): Promise<WorkspaceIdOnDisk> {
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

export interface InBackups {
  readonly name: string
  readonly found: FoundInBackups
}

const OTHER: FoundInBackups = { kind: 'other' }
const UNKNOWN: FoundInBackups = { kind: 'unknown' }

export async function foldersInBackups(userData: string, fs: RecoveryFs): Promise<InBackups[]> {
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

export function ofThisWorkspace(workspaceId: string, folders: readonly InBackups[]): Checkpoint[] {
  return folders
    .flatMap(({ found }) =>
      found.kind === 'checkpoint' && found.checkpoint.manifest.workspaceId === workspaceId
        ? [found.checkpoint]
        : [],
    )
    .sort(newestFirst)
}

export function couldBeOffered(
  checkpoint: Checkpoint,
  lineage: readonly BuildMigration[],
): boolean {
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
    if (manifest === null) return await unfinished(userData, folder, stats, fs)
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
  userData: string,
  folder: string,
  stats: RecoveryStats,
  fs: RecoveryFs,
): Promise<FoundInBackups> {
  let changedAt = stats.mtimeMs
  let marked = false
  let onlyTheWritersFiles = true
  const staging = await captureStagingFolders(userData, folder, fs)
  for (const entry of await fs.readdir(folder)) {
    const inside = await lstatOrNull(join(folder, entry), fs)
    if (inside === null) continue
    changedAt = Math.max(changedAt, inside.mtimeMs)
    if (staging.some((one) => one.name === entry)) continue
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

export async function wholeness(
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
