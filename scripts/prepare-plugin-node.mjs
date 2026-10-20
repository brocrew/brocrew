// Explicit packaging step, never an install hook. The downloaded archive is pinned before extraction.
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, chmod, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
export const NODE_VERSION = '24.22.0'
/**
 * Each target's official archive, pinned by its line in
 * https://nodejs.org/download/release/v24.22.0/SHASUMS256.txt, and the executable inside it, pinned
 * by its own digest. `file` is the executable's name in the prepared folder and in the app.
 */
export const NODE_TARGETS = Object.freeze({
  'darwin-arm64': Object.freeze({
    platform: 'darwin',
    arch: 'arm64',
    archive: 'tar.gz',
    archiveSha256: '6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5',
    inside: 'bin/node',
    file: 'node',
    binarySha256: 'b468fb9c67427c9d3aec07ee1105e63020923a631a9a2a00beb71a7ba3768bfd',
  }),
  'win32-x64': Object.freeze({
    platform: 'win32',
    arch: 'x64',
    archive: 'zip',
    archiveSha256: 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3',
    inside: 'node.exe',
    file: 'node.exe',
    binarySha256: 'ba93f9a70bd86fce3ebbb39ec758501458453467aa92a34a0a3602d1e3fc2b9c',
  }),
})
const targetOf = (name) => {
  const target = Object.hasOwn(NODE_TARGETS, name) ? NODE_TARGETS[name] : undefined
  if (!target) throw new Error('plugin-node-unsupported-target')
  return target
}
export function verifyNodeArchive(bytes, name = 'darwin-arm64') {
  if (sha(bytes) !== targetOf(name).archiveSha256) throw new Error('plugin-node-archive-digest')
}
const sha = (value) => createHash('sha256').update(value).digest('hex')
/** The system tar, which reads both archive forms (bsdtar; Windows ships it in System32). */
const systemTar = () =>
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar'
export async function preparePluginNode(
  out,
  fetcher = fetch,
  targetName = `${process.platform}-${process.arch}`,
) {
  const target = targetOf(targetName)
  try {
    for (const [name, limit] of [
      [target.file, 256 * 1024 * 1024],
      ['runtime.json', 4096],
      ['LICENSE', 512 * 1024],
    ]) {
      const stat = await lstat(join(out, name))
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > limit)
        throw new Error('plugin-node-cache')
    }
    const metadata = JSON.parse(await readFile(join(out, 'runtime.json'), 'utf8'))
    if (
      metadata.format === 1 &&
      Object.keys(metadata).sort().join(',') === 'arch,format,platform,sha256,version' &&
      metadata.version === NODE_VERSION &&
      metadata.platform === target.platform &&
      metadata.arch === target.arch &&
      metadata.sha256 === target.binarySha256 &&
      sha(await readFile(join(out, target.file))) === target.binarySha256 &&
      (await readFile(join(out, 'LICENSE'))).length
    )
      return
  } catch {
    /* An incomplete build input is replaced from the pinned archive. */
  }
  const scratch = await mkdtemp(join(tmpdir(), 'fictional-plugin-node-build-'))
  try {
    const name = `node-v${NODE_VERSION}-${target.platform === 'win32' ? 'win' : target.platform}-${target.arch}`
    const response = await fetcher(
      `https://nodejs.org/download/release/v${NODE_VERSION}/${name}.${target.archive}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      },
    )
    if (!response.ok || !response.body) throw new Error('plugin-node-download')
    const reader = response.body.getReader(),
      parts = []
    let size = 0
    try {
      for (;;) {
        const value = await reader.read()
        if (value.done) break
        size += value.value.length
        if (size > 96 * 1024 * 1024) throw new Error('plugin-node-download-limit')
        parts.push(value.value)
      }
    } finally {
      await reader.cancel()
    }
    const archive = Buffer.concat(parts)
    verifyNodeArchive(archive, targetName)
    const file = join(scratch, `node.${target.archive}`)
    await writeFile(file, archive)
    await run(
      systemTar(),
      [
        target.archive === 'zip' ? '-xf' : '-xzf',
        file,
        '-C',
        scratch,
        `${name}/${target.inside}`,
        `${name}/LICENSE`,
      ],
      { timeout: 30000 },
    )
    const bytes = await readFile(join(scratch, name, target.inside))
    if (sha(bytes) !== target.binarySha256) throw new Error('plugin-node-binary-digest')
    const stage = join(scratch, 'ready')
    await mkdir(stage, { mode: 0o700 })
    await writeFile(join(stage, target.file), bytes, { mode: 0o755 })
    await writeFile(join(stage, 'LICENSE'), await readFile(join(scratch, name, 'LICENSE')))
    await writeFile(
      join(stage, 'runtime.json'),
      JSON.stringify(
        {
          format: 1,
          version: NODE_VERSION,
          platform: target.platform,
          arch: target.arch,
          sha256: sha(bytes),
        },
        null,
        2,
      ) + '\n',
    )
    if (targetName === `${process.platform}-${process.arch}`) {
      const version = await run(join(stage, target.file), ['--version'], {
        env:
          process.platform === 'win32'
            ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }
            : { PATH: '/usr/bin:/bin' },
        timeout: 10000,
      })
      if (version.stdout.trim() !== `v${NODE_VERSION}`) throw new Error('plugin-node-version')
    }
    await mkdir(dirname(out), { recursive: true })
    // Same-volume publication; no link to a temporary download or package-manager path.
    const destination = out + '.prepared'
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { mode: 0o755 })
    for (const name of [target.file, 'LICENSE', 'runtime.json'])
      await writeFile(join(destination, name), await readFile(join(stage, name)))
    await chmod(join(destination, target.file), 0o755)
    await rm(out, { recursive: true, force: true })
    await rename(destination, out)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await preparePluginNode(
    resolve(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/resources/plugin-node'),
  )
  console.log(`plugin-node: pinned Node ${NODE_VERSION} ready`)
}
