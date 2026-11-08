// 695-visible: this signature inspector names the app executable but never launches it.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, readFile, readdir, mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import builderTools from '../apps/desktop/build/builder-tools.mjs'
import { NODE_TARGETS } from './prepare-plugin-node.mjs'
import {
  expectedSigningIdentity,
  requireDistributionSignature,
} from './lib/mac-signing-identity.mjs'
export { requireDistributionSignature } from './lib/mac-signing-identity.mjs'

const execute = promisify(execFile)

async function command(program, args, options = {}) {
  return execute(program, args, { maxBuffer: 8 * 1024 * 1024, ...options })
}

async function machO(path) {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, 16, 0)
    if (bytesRead < 16) return null
    const magic = header.readUInt32BE(0)
    if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic))
      return { executable: true }
    if ([0xfeedface, 0xfeedfacf].includes(magic))
      return { executable: header.readUInt32BE(12) === 2 }
    if ([0xcefaedfe, 0xcffaedfe].includes(magic))
      return { executable: header.readUInt32LE(12) === 2 }
    return null
  } finally {
    await handle.close()
  }
}

async function nativeFiles(folder) {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) files.push(...(await nativeFiles(path)))
    else if (entry.isFile()) {
      const header = await machO(path)
      if (header) files.push({ path, ...header })
    }
  }
  return files
}

export async function verifySignedApp(
  app,
  { run = command, evidence, identity = expectedSigningIdentity() } = {},
) {
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  const native = await nativeFiles(app)
  const node = join(app, 'Contents/Resources/plugin-node/node')
  const nodeHash = createHash('sha256')
    .update(await readFile(node))
    .digest('hex')
  const runtime = JSON.parse(await readFile(join(dirname(node), 'runtime.json'), 'utf8'))
  if (nodeHash !== NODE_TARGETS['darwin-arm64'].binarySha256 || runtime.sha256 !== nodeHash)
    throw new Error('The pinned plugin Node bytes changed during signing')
  const rows = []
  for (const file of native) {
    await run('codesign', ['--verify', '--strict', '--verbose=2', file.path])
    const result = await run('codesign', ['--display', '--verbose=4', file.path])
    const description = `${result.stdout ?? ''}${result.stderr ?? ''}`
    requireDistributionSignature(description, {
      executable: file.executable,
      identity: file.path === node ? null : identity,
    })
    rows.push({ path: file.path.slice(app.length + 1), description })
  }
  if (!rows.some((row) => row.path === 'Contents/MacOS/BroCrew'))
    throw new Error('No signed app executable was inspected')
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, 'nested-signatures.json'), JSON.stringify(rows, null, 2) + '\n')
  }
  return rows
}

export async function notarizeAndStaple(
  submission,
  target,
  label,
  { env = process.env, run = command } = {},
) {
  for (const name of [
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'MAC_SIGNING_EVIDENCE',
  ])
    if (!env[name]) throw new Error(`Missing ${name}`)
  const credentials = [
    '--key',
    env.APPLE_API_KEY,
    '--key-id',
    env.APPLE_API_KEY_ID,
    '--issuer',
    env.APPLE_API_ISSUER,
  ]
  await mkdir(env.MAC_SIGNING_EVIDENCE, { recursive: true })
  let output
  try {
    output = await run(
      'xcrun',
      ['notarytool', 'submit', submission, ...credentials, '--wait', '--output-format', 'json'],
      { timeout: 40 * 60_000 },
    )
  } catch (error) {
    if (!error.stdout) throw new Error(`Notary submission failed for ${label}`, { cause: error })
    output = error
  }
  const result = JSON.parse(output.stdout)
  await writeFile(
    join(env.MAC_SIGNING_EVIDENCE, `${label}-submission.json`),
    JSON.stringify(result, null, 2) + '\n',
  )
  if (!result.id) throw new Error(`No notary submission ID for ${label}`)
  await run('xcrun', [
    'notarytool',
    'log',
    result.id,
    ...credentials,
    join(env.MAC_SIGNING_EVIDENCE, `${label}-notary-log.json`),
  ])
  if (result.status !== 'Accepted')
    throw new Error(`Notarization was ${result.status} for ${label}; see retained notary log`)
  await run('xcrun', ['stapler', 'staple', target])
  await run('xcrun', ['stapler', 'validate', target])
  return result.id
}

export async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin')
    throw new Error('Mac release signing hook on another platform')
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  await verifySignedApp(app, { evidence: process.env.MAC_SIGNING_EVIDENCE })
  const scratch = await mkdtemp(join(tmpdir(), 'brocrew-notary-'))
  try {
    const archive = join(scratch, 'submission.zip')
    await command('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
    await notarizeAndStaple(archive, app, 'app')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function finalizeMac(
  dist,
  version,
  { env = process.env, run = command, blockmap } = {},
) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable release version is required')
  if (!env.MAC_SIGNING_IDENTITY || !env.CSC_KEYCHAIN)
    throw new Error('Signing identity and temporary keychain required')
  const app = join(dist, 'mac-arm64/BroCrew.app')
  const dmg = join(dist, `BroCrew-${version}-arm64.dmg`)
  const zip = join(dist, `BroCrew-${version}-arm64-mac.zip`)
  await run('codesign', [
    '--force',
    '--sign',
    env.MAC_SIGNING_IDENTITY,
    '--keychain',
    env.CSC_KEYCHAIN,
    '--timestamp',
    dmg,
  ])
  await notarizeAndStaple(dmg, dmg, 'dmg', { env, run })
  await run('codesign', ['--verify', '--strict', '--verbose=2', dmg])
  const described = await run('codesign', ['--display', '--verbose=4', dmg])
  requireDistributionSignature(`${described.stdout ?? ''}${described.stderr ?? ''}`, {
    executable: false,
    identity: expectedSigningIdentity(env),
  })
  await run('xcrun', ['stapler', 'validate', app])
  blockmap ??= builderTools.buildBlockMap
  // Both blockmaps and the updater metadata describe only the final stapled bytes.
  const files = []
  for (const path of [zip, dmg]) {
    const info = await blockmap(path, 'gzip', `${path}.blockmap`)
    files.push({ url: path.slice(dist.length + 1), sha512: info.sha512, size: info.size })
  }
  const lines = [`version: ${version}`, 'files:']
  for (const file of files)
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`)
  lines.push(
    `path: ${files[0].url}`,
    `sha512: ${files[0].sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  )
  await writeFile(join(dist, 'latest-mac.yml'), lines.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , dist, version] = process.argv
  await finalizeMac(resolve(dist), version)
}
