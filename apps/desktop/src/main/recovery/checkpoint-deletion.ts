import { basename, dirname, join } from 'node:path'
import { parseManifest, type CheckpointManifest } from './contract'
import {
  assertOwnedPathsAreReal,
  errorCode,
  readTextOrNull,
  retrying,
  syncFolder,
  writeAtomically,
  type RecoveryFs,
  type RecoveryStats,
} from './files'
import {
  backupsDir,
  checkpointDir,
  COPY_FILE,
  MANIFEST_FILE,
  UNFINISHED_FILE,
  familyOf,
  isUuid,
} from './layout'
import { APP_STATE_FILES } from './state-files'

const DELETION_FILE = 'deletion.json'
const MAX_TREE_DEPTH = 32
const COPIED_TREES: readonly string[] = ['skills', 'skills-off']
// Disk records never contribute names to this list. Leave the large database until last.
const FIXED_FILES = [
  ...APP_STATE_FILES.filter((file) => file.kind !== 'tree').map((file) => file.name),
  MANIFEST_FILE,
  DELETION_FILE,
  ...familyOf(COPY_FILE).slice(1),
  COPY_FILE,
  UNFINISHED_FILE,
]
const ALLOWED = new Set([...FIXED_FILES, ...COPIED_TREES])

/** Progress/visibility metadata, not permission to delete anything beyond the fixed names. */
export interface CheckpointDeletion {
  readonly format: 'brocrew-recovery-delete'
  readonly version: 3
  readonly manifest: CheckpointManifest
  readonly root: { readonly dev: number; readonly ino: number }
}
const failed = (): Error => new Error('The recovery copy deletion could not be finished.')
const safeChild = (name: string): boolean =>
  name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name)
async function statOrNull(path: string, fs: RecoveryFs): Promise<RecoveryStats | null> {
  try {
    return await fs.lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}
function rootIdentity(stats: RecoveryStats): CheckpointDeletion['root'] {
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !Number.isSafeInteger(stats.dev) ||
    !Number.isSafeInteger(stats.ino) ||
    (stats.dev ?? -1) < 0 ||
    (stats.ino ?? 0) <= 0
  )
    throw failed()
  return { dev: stats.dev!, ino: stats.ino! }
}
async function copyRoot(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  const name = basename(folder)
  if (dirname(folder) !== backupsDir(userData) || !isUuid(name.replace(/^deleting-/, '')))
    throw failed()
  await assertOwnedPathsAreReal(userData, [folder], fs)
  const stats = await statOrNull(folder, fs)
  if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) throw failed()
}

interface DirectoryBinding {
  readonly path: string
  readonly dev: number
  readonly ino: number
}
function bindDirectory(path: string, stats: RecoveryStats): DirectoryBinding {
  return { path, ...rootIdentity(stats) }
}
async function bindCopyParents(
  userData: string,
  folder: string,
  fs: RecoveryFs,
): Promise<readonly DirectoryBinding[]> {
  const parents: DirectoryBinding[] = []
  for (const path of [userData, backupsDir(userData), folder])
    parents.push(bindDirectory(path, await fs.lstat(path)))
  return parents
}
async function verifyParents(parents: readonly DirectoryBinding[], fs: RecoveryFs): Promise<void> {
  for (const parent of parents) {
    const actual = rootIdentity(await fs.lstat(parent.path))
    if (actual.dev !== parent.dev || actual.ino !== parent.ino) throw failed()
  }
}
async function removeBound(
  path: string,
  userData: string,
  fs: RecoveryFs,
  parents: readonly DirectoryBinding[],
  directory = false,
): Promise<void> {
  await retrying(async () => {
    await assertOwnedPathsAreReal(userData, [directory ? path : dirname(path)], fs)
    // Recheck the original chain on EVERY attempt, immediately before the pathname syscall.
    // Node has no unlinkat/rmdirat: a deliberate same-user race after this check remains possible.
    await verifyParents(parents, fs)
    if (directory) await fs.rmdir(path)
    else await fs.unlink(path)
  })
}

/** A bounded walk is allowed only below the two literal copied skill roots. Never read payloads. */
async function tree(
  path: string,
  userData: string,
  fs: RecoveryFs,
  remove: boolean,
  depth = 0,
  parents: readonly DirectoryBinding[] = [],
): Promise<number> {
  if (depth > MAX_TREE_DEPTH) {
    if (remove) throw failed()
    return 0
  }
  const stats = await statOrNull(path, fs)
  if (!stats) return 0
  if (stats.isSymbolicLink() || stats.isFile()) {
    if (remove) await removeBound(path, userData, fs, parents)
    return stats.isSymbolicLink() ? 0 : stats.size
  }
  if (!stats.isDirectory()) {
    if (remove) throw failed()
    return 0
  }
  // Capture once when descending; never adopt a replacement directory on a later check.
  const chain = remove ? [...parents, bindDirectory(path, stats)] : parents
  await assertOwnedPathsAreReal(userData, [path], fs)
  let bytes = 0
  for (const name of await fs.readdir(path)) {
    if (!safeChild(name)) throw failed()
    bytes += await tree(join(path, name), userData, fs, remove, depth + 1, chain)
  }
  if (remove) await removeBound(path, userData, fs, chain, true)
  return bytes
}

async function removeEntry(
  userData: string,
  folder: string,
  name: string,
  fs: RecoveryFs,
  parents: readonly DirectoryBinding[],
): Promise<void> {
  const path = join(folder, name)
  if (COPIED_TREES.includes(name)) {
    await tree(path, userData, fs, true, 0, parents)
    return
  }
  const stats = await statOrNull(path, fs)
  if (!stats) return
  if (stats.isSymbolicLink() || !stats.isFile()) throw failed()
  await removeBound(path, userData, fs, parents)
}

/** Also used while retrying a failed state-file copy. No caller-supplied file allowlist. */
export async function removeCheckpointEntry(
  userData: string,
  folder: string,
  name: string,
  fs: RecoveryFs,
): Promise<void> {
  if (!ALLOWED.has(name)) throw failed()
  await copyRoot(userData, folder, fs)
  if (!(await statOrNull(folder, fs))) return
  await removeEntry(userData, folder, name, fs, await bindCopyParents(userData, folder, fs))
}

/** Unknown top-level entries are untouched; final rmdir also catches additions after enumeration. */
export async function removeCheckpointCopy(
  userData: string,
  folder: string,
  fs: RecoveryFs,
): Promise<void> {
  await copyRoot(userData, folder, fs)
  if (!(await statOrNull(folder, fs))) return
  const parents = await bindCopyParents(userData, folder, fs)
  if ((await fs.readdir(folder)).some((name) => !ALLOWED.has(name))) throw failed()
  for (const name of FIXED_FILES.filter(
    (name) => ![MANIFEST_FILE, COPY_FILE, UNFINISHED_FILE].includes(name),
  ))
    await removeEntry(userData, folder, name, fs, parents)
  for (const name of COPIED_TREES) await removeEntry(userData, folder, name, fs, parents)
  for (const name of [MANIFEST_FILE, COPY_FILE, UNFINISHED_FILE])
    await removeEntry(userData, folder, name, fs, parents)
  await removeBound(folder, userData, fs, parents, true)
  await syncFolder(backupsDir(userData), fs)
}

/** Old inventories are ignored: they can mark progress, but cannot grant paths or traversal. */
export async function readCheckpointDeletion(
  userData: string,
  workspaceId: string | null,
  fs: RecoveryFs,
): Promise<CheckpointDeletion | null> {
  const path = join(backupsDir(userData), DELETION_FILE)
  await assertOwnedPathsAreReal(userData, [path], fs)
  const stats = await statOrNull(path, fs)
  if (!stats) return null
  if (!stats.isFile() || stats.size > 64 * 1024 * 1024) throw failed()
  const text = await readTextOrNull(path, fs)
  if (text === null) return null
  const raw = JSON.parse(text)
  const manifest = parseManifest(JSON.stringify(raw?.manifest ?? null))
  const root = raw?.version === 3 ? raw.root : raw?.entries?.[0]
  if (
    raw?.format !== 'brocrew-recovery-delete' ||
    ![1, 2, 3].includes(raw.version) ||
    !manifest.ok ||
    manifest.value.workspaceId !== workspaceId ||
    !root ||
    !Number.isSafeInteger(root.dev) ||
    root.dev < 0 ||
    !Number.isSafeInteger(root.ino) ||
    root.ino <= 0
  )
    throw failed()
  return {
    format: 'brocrew-recovery-delete',
    version: 3,
    manifest: manifest.value,
    root: { dev: root.dev, ino: root.ino },
  }
}

export async function deletionRemnant(
  userData: string,
  deletion: CheckpointDeletion,
  fs: RecoveryFs,
): Promise<{ folder: string; bytes: number } | null> {
  const original = checkpointDir(userData, deletion.manifest.id)
  const removing = join(backupsDir(userData), `deleting-${deletion.manifest.id}`)
  await copyRoot(userData, original, fs)
  await copyRoot(userData, removing, fs)
  const before = await statOrNull(original, fs)
  const after = await statOrNull(removing, fs)
  if (before && after) throw failed()
  const stats = after ?? before
  if (!stats) return null
  const actual = rootIdentity(stats)
  if (actual.dev !== deletion.root.dev || actual.ino !== deletion.root.ino) throw failed()
  const folder = after ? removing : original
  let bytes = 0
  for (const name of FIXED_FILES.filter(
    (name) => ![MANIFEST_FILE, UNFINISHED_FILE, DELETION_FILE].includes(name),
  )) {
    const one = await statOrNull(join(folder, name), fs)
    if (one?.isFile() && !one.isSymbolicLink()) bytes += one.size
  }
  for (const name of COPIED_TREES) bytes += await tree(join(folder, name), userData, fs, false)
  return { folder, bytes }
}

/** Called after the existing initial ownership, intact-copy and personal-file checks. */
export async function beginCheckpointDeletion(
  userData: string,
  copy: { folder: string; manifest: CheckpointManifest },
  fs: RecoveryFs,
): Promise<CheckpointDeletion> {
  const removing = join(backupsDir(userData), `deleting-${copy.manifest.id}`)
  await copyRoot(userData, copy.folder, fs)
  await copyRoot(userData, removing, fs)
  if (await statOrNull(removing, fs)) throw failed()
  const deletion: CheckpointDeletion = {
    format: 'brocrew-recovery-delete',
    version: 3,
    manifest: copy.manifest,
    root: rootIdentity(await fs.lstat(copy.folder)),
  }
  await writeAtomically(
    join(backupsDir(userData), DELETION_FILE),
    JSON.stringify(deletion) + '\n',
    fs,
  )
  return deletion
}

export async function finishCheckpointDeletion(
  userData: string,
  deletion: CheckpointDeletion,
  fs: RecoveryFs,
): Promise<boolean> {
  const remnant = await deletionRemnant(userData, deletion, fs)
  if (!remnant) return false
  // Refuse a pre-existing personal addition before even renaming its folder.
  if ((await fs.readdir(remnant.folder)).some((name) => !ALLOWED.has(name))) throw failed()
  const removing = join(backupsDir(userData), `deleting-${deletion.manifest.id}`)
  if (remnant.folder !== removing) {
    await retrying(() => fs.rename(remnant.folder, removing))
    await syncFolder(backupsDir(userData), fs)
  }
  await removeCheckpointCopy(userData, removing, fs)
  return true
}
