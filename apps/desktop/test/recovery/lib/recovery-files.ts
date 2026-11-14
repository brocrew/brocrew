import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeFs, type RecoveryFs } from '../../../src/main/recovery/files'

// Simulated process stops cannot observe flushes to disk.
export const UNFLUSHED: RecoveryFs = {
  ...nodeFs,
  open: async (path, flags, mode) => {
    const handle = await nodeFs.open(path, flags, mode)
    return { ...handle, sync: () => Promise.resolve() }
  },
}

export function withFileChanges(
  real: RecoveryFs,
  change: <T>(operation: () => Promise<T>) => Promise<T>,
): RecoveryFs {
  return {
    ...real,
    copyFile: (from, to, mode) => change(() => real.copyFile(from, to, mode)),
    cloneFile: (from, to, signal, beforeFullCopy) =>
      change(() => real.cloneFile(from, to, signal, beforeFullCopy)),
    link: (existing, name) => change(() => real.link(existing, name)),
    unlink: (path) => change(() => real.unlink(path)),
    rm: (path, options) => change(() => real.rm(path, options)),
    mkdir: (path, options) => change(() => real.mkdir(path, options)),
    mkdtemp: (prefix) => change(() => real.mkdtemp(prefix)),
    writeFile: (path, data, options) => change(() => real.writeFile(path, data, options)),
    open: async (path, flags, mode) => {
      if (flags === 'r') return real.open(path, flags, mode)
      const handle = await change(() => real.open(path, flags, mode))
      return { ...handle, writeFile: (data) => change(() => handle.writeFile(data)) }
    },
  }
}

export function fingerprint(file: string): { bytes: number; mtimeMs: number; sha256: string } {
  return {
    bytes: statSync(file).size,
    mtimeMs: statSync(file).mtimeMs,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  }
}

export const fullCopyFs: RecoveryFs = {
  ...nodeFs,
  cloneFile: () =>
    Promise.reject(
      Object.assign(new Error('No clone in this full-copy fixture'), { code: 'ENOTSUP' }),
    ),
}

export async function treeOf(dir: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {}
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        tree[path] = 'folder'
        await walk(path)
        continue
      }
      const file = join(dir, path)
      const stats = await stat(file)
      if (path === 'brobot2.sqlite-shm' || (path === 'brobot2.sqlite-wal' && stats.size === 0))
        continue
      const sha256 = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      tree[path] = `${String(stats.size)} ${String(stats.mtimeMs)} ${sha256}`
    }
  }
  await walk('')
  return tree
}

export async function sha256Of(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}
