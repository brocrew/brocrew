// Exact esbuild dependency inputs only. The gate/token reader remains strictly single-link.
import fs from 'node:fs'
import path from 'node:path'
import { demand, hash, below } from './contract.mjs'
import { readOwnedFile, rootWitness } from './owned-files.mjs'
import { esbuildInvocation, nativeEsbuildTarget } from './tool-entry.mjs'

// Frozen upstream esbuild0.28.1 npm/esbuild/package.json binaryHashes, matching lock provenance.
export const NATIVE_DIGESTS = Object.freeze({
  'darwin/arm64': 'e2dc9a52440a2a34f09434a2f4843cb1e30f84e40dcf238976ec61ef8cd7f36a',
  'win32/x64': 'ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3',
})
const fields = [
  'dev',
  'ino',
  'birthtimeNs',
  'mode',
  'uid',
  'gid',
  'size',
  'nlink',
  'mtimeNs',
  'ctimeNs',
]
const stable = (a, b, full = true) =>
  (full ? fields : fields.slice(0, 6)).every((k) => a[k] === b[k])
const identity = (s) =>
  Object.fromEntries(
    ['dev', 'ino', 'birthtimeNs', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].map((k) => [
      k,
      String(s[k]),
    ]),
  )

export function readDependency(file, packageRoot, maximum, io = fs) {
  demand(path.isAbsolute(file) && path.isAbsolute(packageRoot) && below(packageRoot, file))
  demand(
    io.realpathSync.native(file) === file && io.realpathSync.native(packageRoot) === packageRoot,
  )
  const parents = []
  for (let p = path.dirname(file); ; p = path.dirname(p)) {
    const s = io.lstatSync(p, { bigint: true })
    demand(s.isDirectory() && !s.isSymbolicLink())
    parents.push([p, s])
    if (p === packageRoot) break
    demand(below(packageRoot, p))
  }
  const before = io.lstatSync(file, { bigint: true })
  demand(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink >= 1n &&
      before.size >= 0n &&
      before.size <= BigInt(maximum),
  )
  const fd = io.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = io.fstatSync(fd, { bigint: true })
    demand(stable(before, opened))
    const bytes = Buffer.alloc(Number(opened.size))
    let at = 0
    while (at < bytes.length) {
      const n = io.readSync(fd, bytes, at, bytes.length - at, at)
      demand(n > 0)
      at += n
    }
    demand(stable(opened, io.fstatSync(fd, { bigint: true })))
    demand(stable(before, io.lstatSync(file, { bigint: true })))
    for (const [p, s] of parents)
      demand(stable(s, io.lstatSync(p, { bigint: true }), false) && io.realpathSync.native(p) === p)
    return { bytes, identity: identity(opened) }
  } finally {
    io.closeSync(fd)
  }
}
export function materializeNative(root, input, expectedDigest, platform, arch) {
  demand(/^[a-f0-9]{64}$/.test(expectedDigest) && hash(input.bytes) === expectedDigest)
  esbuildInvocation('/owned/not-executed', [], input.bytes, platform, arch)
  const heldRoot = rootWitness(root)
  if (process.platform !== 'win32') {
    const s = fs.lstatSync(root, { bigint: true })
    demand(s.uid === BigInt(process.getuid()) && (s.mode & 0o077n) === 0n)
  }
  const directory = path.join(root, 'verified-esbuild')
  fs.mkdirSync(directory, { mode: 0o700 }) // Exclusive: no reuse, overwrite, link or reflink.
  demand(fs.realpathSync.native(directory) === directory)
  const file = path.join(directory, platform === 'win32' ? 'esbuild.exe' : 'esbuild')
  fs.writeFileSync(file, input.bytes, { flag: 'wx', mode: 0o700 })
  const bytes = readOwnedFile(file, 64 * 1024 * 1024, heldRoot)
  demand(hash(bytes) === expectedDigest)
  const held = fs.lstatSync(file, { bigint: true })
  demand(held.nlink === 1n)
  const copyIdentity = identity(held)
  return {
    program: file,
    inputIdentity: input.identity,
    copyIdentity,
    sha256: expectedDigest,
    bytes: bytes.length,
    recheck() {
      const current = readOwnedFile(file, 64 * 1024 * 1024, heldRoot)
      demand(hash(current) === expectedDigest && stable(held, fs.lstatSync(file, { bigint: true })))
      return file
    },
  }
}
export function prepareNativeEsbuild({ root, repo, manifest, resolveNative, platform, arch }) {
  nativeEsbuildTarget(platform, arch)
  manifest = fs.realpathSync.native(manifest)
  demand(below(repo, manifest))
  const toolRead = readDependency(manifest, path.dirname(manifest), 128 * 1024)
  const tool = JSON.parse(toolRead.bytes),
    target = nativeEsbuildTarget(platform, arch)
  demand(
    tool.version === '0.28.1' && tool.optionalDependencies?.[target.packageName] === tool.version,
  )
  const nativeManifest = fs.realpathSync.native(resolveNative(target.packageName + '/package.json'))
  demand(below(repo, nativeManifest))
  const metaRead = readDependency(nativeManifest, path.dirname(nativeManifest), 128 * 1024)
  const meta = JSON.parse(metaRead.bytes)
  demand(meta.name === target.packageName && meta.version === tool.version)
  const expected = NATIVE_DIGESTS[platform + '/' + arch]
  demand(tool['esbuild.binaryHashes']?.[target.packageName + '/' + target.subpath] === expected)
  const binary = fs.realpathSync.native(resolveNative(target.packageName + '/' + target.subpath))
  const input = readDependency(binary, path.dirname(nativeManifest), 64 * 1024 * 1024)
  const copy = materializeNative(root, input, expected, platform, arch)
  return {
    ...copy,
    packageName: target.packageName,
    version: tool.version,
    metadataIdentities: { esbuild: toolRead.identity, native: metaRead.identity },
  }
}
