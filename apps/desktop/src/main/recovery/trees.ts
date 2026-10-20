import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { SKILL_TREES } from '../skills/shared-paths'
import {
  assertOwnedPathsAreReal,
  contentAt,
  errorCode,
  nodeFs,
  syncFolder,
  type Content,
  type RecoveryFs,
  type RecoveryStats,
} from './files'

type Entry = {
  path: string
  directory: boolean
  bytes: number
  executable: boolean
  sha256: string
}
export interface TreeReading {
  entries: Entry[]
  bytes: number
  sha256: string
}
const sameFile = (a: RecoveryStats, b: RecoveryStats) =>
  !b.isSymbolicLink() &&
  b.isFile() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs

async function readPlainFile(path: string, fs: RecoveryFs, to?: string): Promise<string> {
  const before = await fs.lstat(path)
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('Skills could not be read.')
  const source = await fs.open(path, 'r', undefined, true)
  let target
  try {
    if (!source.stat || !sameFile(before, await source.stat()))
      throw new Error('Skills could not be read.')
    if (to !== undefined) target = await fs.open(to, 'wx', 0o600)
    const hash = createHash('sha256')
    const buffer = new Uint8Array(64 * 1024)
    let bytes = 0
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      bytes += bytesRead
      if (bytes > before.size) throw new Error('Skills could not be read.')
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      await target?.writeFile(chunk)
    }
    if (
      bytes !== before.size ||
      !sameFile(before, await source.stat()) ||
      !sameFile(before, await fs.lstat(path))
    )
      throw new Error('Skills could not be read.')
    if (target && to !== undefined) {
      await fs.chmod(to, (before.mode ?? 0) & 0o100 ? 0o700 : 0o600)
      await target.sync()
    }
    return hash.digest('hex')
  } finally {
    await source.close()
    await target?.close()
  }
}

/** Paths and executable bits participate in the digest, including empty directories. */
export async function readSkillTree(root: string, fs: RecoveryFs = nodeFs): Promise<TreeReading> {
  const entries: Entry[] = []
  let bytes = 0
  const walk = async (path: string, relative: string, depth: number): Promise<void> => {
    const stats = await fs.lstat(path)
    if (stats.isSymbolicLink() || depth > 64 || entries.length > 100_000)
      throw new Error('Skills could not be read.')
    if (stats.isDirectory()) {
      if (relative)
        entries.push({ path: relative, directory: true, bytes: 0, executable: false, sha256: '' })
      for (const name of (await fs.readdir(path)).sort()) {
        if (name === '.' || name === '..' || /[\\/\0]/.test(name))
          throw new Error('Skills could not be read.')
        await walk(join(path, name), relative ? `${relative}/${name}` : name, depth + 1)
      }
    } else if (relative && stats.isFile()) {
      const sha256 = await readPlainFile(path, fs)
      bytes += stats.size
      entries.push({
        path: relative,
        directory: false,
        bytes: stats.size,
        executable: !!((stats.mode ?? 0) & 0o100),
        sha256,
      })
    } else throw new Error('Skills could not be read.')
  }
  await walk(root, '', 0)
  return {
    entries,
    bytes,
    sha256: createHash('sha256')
      .update('brocrew-skill-tree-v1\0')
      .update(JSON.stringify(entries))
      .digest('hex'),
  }
}

/** The journal hashes registered trees as single entries and moves them by directory rename. */
export async function stateContentAt(path: string, fs: RecoveryFs = nodeFs): Promise<Content> {
  if (!SKILL_TREES.includes(basename(path))) return contentAt(path, fs)
  try {
    const reading = await readSkillTree(path, fs)
    return { kind: 'file', sha256: reading.sha256 }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      try {
        await fs.lstat(path)
      } catch (missing) {
        if (errorCode(missing) === 'ENOENT') return { kind: 'absent' }
      }
    }
    throw error
  }
}

export async function copySkillTree(
  from: string,
  to: string,
  fs: RecoveryFs = nodeFs,
): Promise<TreeReading> {
  const before = await readSkillTree(from, fs)
  await fs.mkdir(to, { mode: 0o700 })
  for (const entry of before.entries) {
    const target = join(to, ...entry.path.split('/'))
    await assertOwnedPathsAreReal(to, [target], fs)
    if (entry.directory) await fs.mkdir(target, { mode: 0o700 })
    else {
      if ((await readPlainFile(join(from, ...entry.path.split('/')), fs, target)) !== entry.sha256)
        throw new Error('Skills could not be read.')
    }
  }
  for (const entry of before.entries.filter((one) => one.directory).reverse())
    await syncFolder(join(to, entry.path), fs)
  await syncFolder(to, fs)
  await syncFolder(dirname(to), fs)
  if (
    (await readSkillTree(from, fs)).sha256 !== before.sha256 ||
    (await readSkillTree(to, fs)).sha256 !== before.sha256
  )
    throw new Error('Skills could not be read.')
  return before
}
