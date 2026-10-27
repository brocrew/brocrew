import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseManifest, serializeManifest, type CheckpointManifest } from './contract'
import {
  assertOwnedPathsAreReal,
  errorCode,
  readTextOrNull,
  retrying,
  syncFolder,
  sha256Of,
  writeAtomically,
  type RecoveryFs,
  type RecoveryStats,
} from './files'
import { backupsDir, checkpointDir, COPY_FILE, MANIFEST_FILE, UNFINISHED_FILE } from './layout'
import { APP_STATE_FILES } from './state-files'
import { readSkillTree, type TreeReading } from './trees'

// Outside the removable folder: a failed recursive removal cannot erase its own authorization.
const DELETION_FILE = 'deletion.json'
interface Entry {
  readonly path: string
  readonly directory: boolean
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
}
export interface CheckpointDeletion {
  readonly format: 'brocrew-recovery-delete'
  readonly version: 2
  readonly manifest: CheckpointManifest
  readonly entries: readonly Entry[]
  readonly verifiedCopy: {
    readonly manifestText: string
    readonly manifestSha256: string
    readonly trees: Readonly<Record<string, TreeReading['entries']>>
  }
}

const failed = (): Error => new Error('The recovery copy deletion record could not be checked.')
const safePath = (path: string): boolean =>
  path === '' ||
  path
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && !/[\\\0]/.test(part))

const digest = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A record is a subset-removal plan for one complete checked copy, never a new file allowlist. */
function checkVerifiedCopy(deletion: CheckpointDeletion): void {
  const binding = deletion.verifiedCopy
  if (
    !binding ||
    typeof binding.manifestText !== 'string' ||
    digest(binding.manifestText) !== binding.manifestSha256 ||
    !binding.trees ||
    typeof binding.trees !== 'object' ||
    Array.isArray(binding.trees)
  )
    throw failed()
  const bound = parseManifest(binding.manifestText)
  if (!bound.ok || serializeManifest(bound.value) !== serializeManifest(deletion.manifest))
    throw failed()
  const expected = new Map<string, { directory: boolean; bytes?: number }>([
    ['', { directory: true }],
    [MANIFEST_FILE, { directory: false, bytes: Buffer.byteLength(binding.manifestText) }],
    [COPY_FILE, { directory: false, bytes: deletion.manifest.database.bytes }],
  ])
  const trees = new Set<string>()
  for (const file of deletion.manifest.files) {
    const registered = APP_STATE_FILES.find(({ name }) => name === file.name)
    if (!registered) throw failed()
    if (!file.present) continue
    if (registered.kind !== 'tree') {
      expected.set(file.name, { directory: false, bytes: file.bytes })
      continue
    }
    trees.add(file.name)
    expected.set(file.name, { directory: true })
    const entries = binding.trees[file.name]
    if (!Array.isArray(entries)) throw failed()
    let bytes = 0
    for (const one of entries) {
      if (
        !one ||
        typeof one.path !== 'string' ||
        !one.path ||
        !safePath(one.path) ||
        typeof one.directory !== 'boolean' ||
        !Number.isSafeInteger(one.bytes) ||
        one.bytes < 0 ||
        typeof one.executable !== 'boolean' ||
        (one.directory
          ? one.bytes !== 0 || one.executable || one.sha256 !== ''
          : !/^[a-f0-9]{64}$/.test(one.sha256))
      )
        throw failed()
      const path = `${file.name}/${one.path}`
      const parent = path.slice(0, path.lastIndexOf('/'))
      if (expected.has(path) || expected.get(parent)?.directory !== true) throw failed()
      expected.set(path, { directory: one.directory, bytes: one.directory ? undefined : one.bytes })
      bytes += one.bytes
    }
    // Same persisted tree protocol as readSkillTree: paths, order and executable bits are bound.
    const hash = digest('brocrew-skill-tree-v1\0' + JSON.stringify(entries))
    if (hash !== file.sha256 || bytes !== file.bytes) throw failed()
  }
  if (Object.keys(binding.trees).some((name) => !trees.has(name))) throw failed()
  for (const one of deletion.entries) {
    if (one.path === UNFINISHED_FILE && !one.directory && one.size === 0) continue
    const written = expected.get(one.path)
    if (
      !written ||
      written.directory !== one.directory ||
      (written.bytes !== undefined && written.bytes !== one.size)
    )
      throw failed()
    expected.delete(one.path)
  }
  if (expected.size !== 0) throw failed()
}

function entry(path: string, stats: RecoveryStats): Entry {
  if (
    stats.isSymbolicLink() ||
    !(stats.isFile() || stats.isDirectory()) ||
    !Number.isSafeInteger(stats.dev) ||
    !Number.isSafeInteger(stats.ino) ||
    (stats.dev ?? -1) < 0 ||
    (stats.ino ?? 0) <= 0
  )
    throw failed()
  return {
    path,
    directory: stats.isDirectory(),
    dev: stats.dev!,
    ino: stats.ino!,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

/** Snapshot actual identities, including every tree child; unknown/personal additions are refused. */
async function contents(folder: string, fs: RecoveryFs): Promise<Entry[]> {
  const entries: Entry[] = []
  const walk = async (path: string, relative: string, depth: number): Promise<void> => {
    if (!safePath(relative) || depth > 64 || entries.length >= 100_000) throw failed()
    const one = entry(relative, await fs.lstat(path))
    entries.push(one)
    if (one.directory) {
      for (const name of (await fs.readdir(path)).sort()) {
        if (name.includes('/') || !safePath(name)) throw failed()
        await walk(join(path, name), relative ? `${relative}/${name}` : name, depth + 1)
      }
    }
  }
  await walk(folder, '', 0)
  return entries
}

/** Only absence is empty. A damaged, linked or foreign record blocks all removal. */
export async function readCheckpointDeletion(
  userData: string,
  workspaceId: string | null,
  fs: RecoveryFs,
): Promise<CheckpointDeletion | null> {
  const path = join(backupsDir(userData), DELETION_FILE)
  await assertOwnedPathsAreReal(userData, [path], fs)
  if (await present(path, fs)) {
    const stats = await fs.lstat(path)
    if (!stats.isFile() || stats.size > 64 * 1024 * 1024) throw failed()
  }
  const text = await readTextOrNull(path, fs)
  if (text === null) return null
  const raw = JSON.parse(text) as Partial<CheckpointDeletion> | null
  const manifest = parseManifest(JSON.stringify(raw?.manifest ?? null))
  if (
    raw?.format !== 'brocrew-recovery-delete' ||
    raw.version !== 2 ||
    !manifest.ok ||
    manifest.value.workspaceId !== workspaceId ||
    !Array.isArray(raw.entries) ||
    raw.entries.length === 0 ||
    raw.entries.length > 100_000
  )
    throw failed()
  const seen = new Set<string>()
  for (const one of raw.entries) {
    if (
      !one ||
      typeof one.path !== 'string' ||
      !safePath(one.path) ||
      seen.has(one.path) ||
      typeof one.directory !== 'boolean' ||
      !Number.isSafeInteger(one.dev) ||
      one.dev < 0 ||
      !Number.isSafeInteger(one.ino) ||
      one.ino <= 0 ||
      !Number.isSafeInteger(one.size) ||
      one.size < 0 ||
      !Number.isFinite(one.mtimeMs)
    )
      throw failed()
    seen.add(one.path)
  }
  if (raw.entries[0]?.path !== '' || !raw.entries[0].directory) throw failed()
  const deletion = {
    format: 'brocrew-recovery-delete',
    version: 2,
    manifest: manifest.value,
    entries: raw.entries,
    verifiedCopy: raw.verifiedCopy,
  } as CheckpointDeletion
  checkVerifiedCopy(deletion)
  return deletion
}

async function present(path: string, fs: RecoveryFs): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/** A completed record remains as an idempotence receipt; it never authorizes a replacement. */
export async function deletionRemnant(
  userData: string,
  deletion: CheckpointDeletion,
  fs: RecoveryFs,
  purpose: 'delete' | 'display' = 'delete',
): Promise<{ folder: string; bytes: number } | null> {
  checkVerifiedCopy(deletion)
  const original = checkpointDir(userData, deletion.manifest.id)
  const removing = join(backupsDir(userData), `deleting-${deletion.manifest.id}`)
  await assertOwnedPathsAreReal(userData, [original, removing], fs)
  const atOriginal = await present(original, fs)
  const atRemoving = await present(removing, fs)
  if (atOriginal && atRemoving) throw failed()
  if (!atOriginal && !atRemoving) return null
  const folder = atRemoving ? removing : original
  const known = new Map(deletion.entries.map((one) => [one.path, one]))
  let bytes = 0
  for (const one of await contents(folder, fs)) {
    const before = known.get(one.path)
    if (
      !before ||
      before.dev !== one.dev ||
      before.ino !== one.ino ||
      before.directory !== one.directory ||
      (!one.directory && (before.size !== one.size || before.mtimeMs !== one.mtimeMs))
    ) {
      if (purpose === 'display' && one.path !== '') continue
      throw failed()
    }
    if (
      purpose === 'delete' &&
      one.path === MANIFEST_FILE &&
      (await sha256Of(join(folder, MANIFEST_FILE), fs)) !== deletion.verifiedCopy.manifestSha256
    )
      throw failed()
    if (!one.directory && ![MANIFEST_FILE, UNFINISHED_FILE].includes(one.path)) bytes += one.size
  }
  return { folder, bytes }
}

/** Called only after sole ownership, workspace/restore gates and intact-copy validation. */
export async function beginCheckpointDeletion(
  userData: string,
  copy: { folder: string; manifest: CheckpointManifest },
  fs: RecoveryFs,
): Promise<CheckpointDeletion> {
  const removing = join(backupsDir(userData), `deleting-${copy.manifest.id}`)
  await assertOwnedPathsAreReal(userData, [copy.folder, removing], fs)
  if (await present(removing, fs)) throw failed()
  const manifestText = await fs.readFile(join(copy.folder, MANIFEST_FILE))
  const trees: Record<string, TreeReading['entries']> = {}
  for (const file of copy.manifest.files) {
    if (file.present && APP_STATE_FILES.find(({ name }) => name === file.name)?.kind === 'tree') {
      const reading = await readSkillTree(join(copy.folder, file.name), fs)
      if (reading.sha256 !== file.sha256 || reading.bytes !== file.bytes) throw failed()
      trees[file.name] = reading.entries
    }
  }
  const deletion: CheckpointDeletion = {
    format: 'brocrew-recovery-delete',
    version: 2,
    manifest: copy.manifest,
    entries: await contents(copy.folder, fs),
    verifiedCopy: { manifestText, manifestSha256: digest(manifestText), trees },
  }
  checkVerifiedCopy(deletion)
  const path = join(backupsDir(userData), DELETION_FILE)
  await assertOwnedPathsAreReal(userData, [path], fs)
  await writeAtomically(path, JSON.stringify(deletion) + '\n', fs)
  return deletion
}

/** The move stops restore offers; the separate durable record survives any partial rm/EIO. */
export async function finishCheckpointDeletion(
  userData: string,
  deletion: CheckpointDeletion,
  fs: RecoveryFs,
): Promise<boolean> {
  const remnant = await deletionRemnant(userData, deletion, fs)
  if (!remnant) return false
  const removing = join(backupsDir(userData), `deleting-${deletion.manifest.id}`)
  if (remnant.folder !== removing) {
    await retrying(() => fs.rename(remnant.folder, removing))
    await syncFolder(backupsDir(userData), fs)
  }
  await retrying(async () => {
    if (await deletionRemnant(userData, deletion, fs))
      await fs.rm(removing, { recursive: true, force: true })
  })
  await syncFolder(backupsDir(userData), fs)
  return true
}
