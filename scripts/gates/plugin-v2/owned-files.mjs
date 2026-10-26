import fs from 'node:fs'
import path from 'node:path'

// This exact function is also embedded in the two gate bundles. BigInt IDs stay BigInt.
// Root ACL/private-mode establishment is done by the held driver before projecting source.
export function readOwnedFile(file, maximum, expectedRoot = null) {
  const fail = () => {
    throw new Error('Gate owned file refused')
  }
  const stat = (p) => fs.lstatSync(p, { bigint: true })
  const same = (a, b, full = false) =>
    [
      'dev',
      'ino',
      'birthtimeNs',
      'mode',
      'uid',
      'gid',
      ...(full ? ['size', 'nlink', 'mtimeNs', 'ctimeNs'] : []),
    ].every((k) => a[k] === b[k])
  const absolute = path.resolve(file),
    parent = path.dirname(absolute)
  if (fs.realpathSync.native(parent) !== parent) fail()
  const parents = []
  for (let p = parent; ; p = path.dirname(p)) {
    const s = stat(p)
    if (!s.isDirectory() || s.isSymbolicLink()) fail()
    parents.push([p, s])
    // A projected private root is the held anchor. Generic source reads witness their
    // canonical immediate parent; do not inspect unrelated ancestor/profile directories.
    if (!expectedRoot || p === expectedRoot.path) break
    if (path.dirname(p) === p) fail()
  }
  if (expectedRoot) {
    const held = parents.find(([p]) => p === expectedRoot.path)?.[1]
    if (
      !held ||
      !['dev', 'ino', 'birthtimeNs', 'mode', 'uid', 'gid'].every(
        (k) => String(held[k]) === expectedRoot[k],
      )
    )
      fail()
    if (
      process.platform !== 'win32' &&
      (held.uid !== BigInt(process.getuid()) || (held.mode & 0o077n) !== 0n)
    )
      fail()
  }
  const before = stat(absolute)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size < 0n ||
    before.size > BigInt(maximum)
  )
    fail()
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fs.fstatSync(fd, { bigint: true })
    if (!same(before, opened, true)) fail()
    const bytes = Buffer.alloc(Number(opened.size))
    let at = 0
    while (at < bytes.length) {
      const count = fs.readSync(fd, bytes, at, bytes.length - at, at)
      if (count === 0) fail()
      at += count
    }
    if (
      !same(opened, fs.fstatSync(fd, { bigint: true }), true) ||
      !same(before, stat(absolute), true)
    )
      fail()
    for (const [p, s] of parents) if (!same(s, stat(p)) || fs.realpathSync.native(p) !== p) fail()
    return bytes
  } finally {
    fs.closeSync(fd)
  }
}
export function rootWitness(root) {
  if (fs.realpathSync.native(root) !== root) throw new Error('Gate root refused')
  const s = fs.lstatSync(root, { bigint: true })
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Gate root refused')
  return {
    path: root,
    ...Object.fromEntries(
      ['dev', 'ino', 'birthtimeNs', 'mode', 'uid', 'gid'].map((k) => [k, String(s[k])]),
    ),
  }
}
