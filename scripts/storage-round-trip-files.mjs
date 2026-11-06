import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync, readSync, readdirSync, readlinkSync } from 'node:fs'
import { join, relative } from 'node:path'

export function hashFile(file) {
  const digest = createHash('sha256'),
    fd = openSync(file, 'r'),
    buffer = Buffer.alloc(4 * 1024 ** 2)
  try {
    let bytes
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, bytes))
  } finally {
    closeSync(fd)
  }
  return digest.digest('hex')
}

// Framework symlinks are part of a macOS bundle. Hash their targets without following them.
export function hashBundle(root) {
  const entries = []
  const walk = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      const file = join(folder, name),
        stat = lstatSync(file),
        path = relative(root, file)
      if (stat.isSymbolicLink()) entries.push({ path, kind: 'link', target: readlinkSync(file) })
      else if (stat.isDirectory()) {
        entries.push({ path, kind: 'directory', mode: stat.mode & 0o777 })
        walk(file)
      } else if (stat.isFile())
        entries.push({
          path,
          kind: 'file',
          mode: stat.mode & 0o777,
          bytes: stat.size,
          sha256: hashFile(file),
        })
      else throw new Error(`Unsupported bundle entry: ${path}`)
    }
  }
  walk(root)
  return { entries, sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex') }
}
