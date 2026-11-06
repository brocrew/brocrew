import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { RecoveryFs } from '../recovery/files'

/** Ordinary skill reads/copies. The digest only groups duplicate imports; it never admits a read. */
export async function ordinarySkillTree(root: string, fs: RecoveryFs, to?: string) {
  const entries: {
    path: string
    directory: boolean
    bytes: number
    executable: boolean
    sha256: string
  }[] = []
  let bytes = 0
  const walk = async (path: string, relative: string, depth: number): Promise<void> => {
    try {
      if (depth > 64 || entries.length > 100_000)
        throw new Error('Skill tree exceeds the read bound')
      const stats = await fs.stat(path)
      const target = to === undefined ? undefined : join(to, relative)
      if (stats.isDirectory()) {
        if (target !== undefined) await fs.mkdir(target, { mode: 0o700 })
        if (relative)
          entries.push({ path: relative, directory: true, bytes: 0, executable: false, sha256: '' })
        for (const name of (await fs.readdir(path)).sort())
          await walk(join(path, name), relative ? `${relative}/${name}` : name, depth + 1)
      } else if (relative && stats.isFile()) {
        const source = await fs.open(path, 'r')
        let output
        try {
          if (target !== undefined) output = await fs.open(target, 'wx', 0o600)
          const hash = createHash('sha256'),
            buffer = new Uint8Array(64 * 1024)
          let count = 0
          for (;;) {
            const { bytesRead } = await source.read(buffer, 0, buffer.length, null)
            if (bytesRead === 0) break
            const part = buffer.subarray(0, bytesRead)
            count += bytesRead
            hash.update(part)
            await output?.writeFile(part)
          }
          if (target !== undefined) {
            await fs.chmod(target, (stats.mode ?? 0) & 0o100 ? 0o700 : 0o600)
            await output?.sync()
          }
          bytes += count
          entries.push({
            path: relative,
            directory: false,
            bytes: count,
            executable: !!((stats.mode ?? 0) & 0o100),
            sha256: hash.digest('hex'),
          })
        } finally {
          await source.close()
          await output?.close()
        }
      } else throw new Error('Not a regular skill file or directory')
    } catch (cause) {
      throw new Error(`${path}: ${String(cause)}`, { cause })
    }
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
