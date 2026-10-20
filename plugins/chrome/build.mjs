import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const validPath = (name) =>
  name
    .split('/')
    .every((part) => /^[A-Za-z0-9_@-][A-Za-z0-9._@-]*$/.test(part) && !part.endsWith('.'))
function filesBelow(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => {
      const name = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error('Links are not package files')
      return entry.isDirectory()
        ? filesBelow(path.join(dir, entry.name), name + '/')
        : [{ path: name, bytes: fs.readFileSync(path.join(dir, entry.name)) }]
    })
}
function ustar(files) {
  const chunks = []
  for (const file of files) {
    const header = Buffer.alloc(512)
    let name = file.path,
      prefix = ''
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/', name.length - 1)
      prefix = name.slice(0, split)
      name = name.slice(split + 1)
      if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100)
        throw new Error('USTAR path too long')
    }
    header.write(name, 0, 100)
    const oct = (n, offset, width) =>
      header.write(n.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii')
    oct(0o644, 100, 8)
    oct(0, 108, 8)
    oct(0, 116, 8)
    oct(file.bytes.length, 124, 12)
    oct(0, 136, 12)
    header.fill(32, 148, 156)
    header.write('0', 156)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    header.write(prefix, 345, 155)
    const checksum = [...header].reduce((sum, n) => sum + n, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    chunks.push(header, file.bytes, Buffer.alloc((512 - (file.bytes.length % 512)) % 512))
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)])
}
function copyRuntime(source, target) {
  for (const item of filesBelow(source)) {
    const base = path.basename(item.path)
    if (
      !validPath(item.path) ||
      /\.(sh|bash|zsh|bat|cmd|ps1)$/i.test(base) ||
      ['binding.gyp', 'makefile'].includes(base.toLowerCase())
    )
      continue
    const out = path.join(target, item.path)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    if (base === 'package.json') {
      const metadata = JSON.parse(item.bytes)
      for (const field of ['scripts', 'hooks', 'gypfile', 'bin']) delete metadata[field]
      fs.writeFileSync(out, JSON.stringify(metadata, null, 2) + '\n')
    } else fs.writeFileSync(out, item.bytes)
  }
}
/** The targets an archive is built for; its manifest names exactly one. */
export const CHROME_TARGETS = Object.freeze([
  Object.freeze({ os: 'darwin', cpu: 'arm64' }),
  Object.freeze({ os: 'win32', cpu: 'x64' }),
])
export async function buildChromePackage(
  destination,
  sourceCommit = process.env.BROCREW_PLUGIN_SOURCE_COMMIT,
  target = CHROME_TARGETS[0],
) {
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(sourceCommit ?? ''))
    throw new Error('Supply the frozen source commit')
  if (!CHROME_TARGETS.some((one) => one.os === target?.os && one.cpu === target?.cpu))
    throw new Error('Supply a supported target')
  if (!path.isAbsolute(destination) || fs.existsSync(destination))
    throw new Error('Use a fresh absolute output folder')
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  const payload = path.join(destination, 'package')
  fs.mkdirSync(payload)
  const result = await build({
    entryPoints: [path.join(root, 'src/index.ts')],
    outfile: path.join(payload, 'server.mjs'),
    platform: 'node',
    target: 'node22',
    format: 'esm',
    bundle: true,
    sourcemap: false,
    legalComments: 'eof',
    metafile: true,
    external: ['playwright-core'],
    banner: {
      js: "import { createRequire as brocrewCreateRequire } from 'node:module'; const require = brocrewCreateRequire(import.meta.url);",
    },
  })
  copyRuntime(
    path.join(root, 'node_modules/playwright-core'),
    path.join(payload, 'node_modules/playwright-core'),
  )
  fs.cpSync(path.join(root, 'ui'), path.join(payload, 'ui'), {
    recursive: true,
    dereference: false,
  })
  const licenses = path.join(payload, 'licenses')
  fs.mkdirSync(licenses)
  const packages = new Map()
  for (const input of Object.keys(result.metafile.inputs)) {
    let current = path.dirname(path.resolve(input))
    while (current.startsWith(root)) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        const meta = JSON.parse(fs.readFileSync(path.join(current, 'package.json')))
        if (meta.name && meta.version && current.split(path.sep).includes('node_modules')) {
          packages.set(current, meta)
          break
        }
      }
      current = path.dirname(current)
    }
  }
  const notices = []
  for (const [dir, meta] of packages) {
    notices.push({
      name: meta.name,
      version: meta.version,
      license: meta.license ?? 'See license files',
    })
    for (const entry of fs.readdirSync(dir))
      if (
        /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(entry) &&
        fs.statSync(path.join(dir, entry)).isFile()
      ) {
        const name = `${meta.name.replace(/[^A-Za-z0-9_-]/g, '-')}-${meta.version}-${entry.replace(/[^A-Za-z0-9_.-]/g, '-')}`
        fs.copyFileSync(path.join(dir, entry), path.join(licenses, name))
      }
  }
  fs.writeFileSync(
    path.join(licenses, 'dependencies.json'),
    JSON.stringify(
      notices.sort((a, b) => a.name.localeCompare(b.name)),
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(payload, 'package.json'),
    JSON.stringify(
      {
        name: '@brocrew/chrome-plugin',
        version: JSON.parse(fs.readFileSync(path.join(root, 'manifest-template.json'))).version,
        type: 'module',
        dependencies: { 'playwright-core': '1.61.0' },
      },
      null,
      2,
    ) + '\n',
  )
  const files = filesBelow(payload)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest-template.json')))
  manifest.sourceCommit = sourceCommit
  manifest.platforms = [{ os: target.os, cpu: target.cpu }]
  manifest.files = files.map((file) => ({
    path: file.path,
    type: 'file',
    size: file.bytes.length,
    sha256: digest(file.bytes),
  }))
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  fs.writeFileSync(path.join(payload, 'plugin.json'), manifestBytes)
  const archive = ustar(
    [...files, { path: 'plugin.json', bytes: manifestBytes }].sort((a, b) =>
      a.path.localeCompare(b.path, 'en'),
    ),
  )
  fs.writeFileSync(path.join(destination, 'chrome.tar'), archive)
  const release = {
    id: manifest.id,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    platforms: manifest.platforms,
    archive: {
      url: 'https://example.invalid/chrome.tar',
      size: archive.length,
      sha256: digest(archive),
      compression: 'tar',
    },
    manifestSha256: digest(manifestBytes),
  }
  fs.writeFileSync(
    path.join(destination, 'fixture-release.json'),
    JSON.stringify(release, null, 2) + '\n',
  )
  fs.writeFileSync(
    path.join(destination, 'build-receipt.json'),
    JSON.stringify(
      {
        files: files.length,
        bytes: archive.length,
        sha256: digest(archive),
        manifestBytes: manifestBytes.length,
        bundledPackages: notices.length,
      },
      null,
      2,
    ) + '\n',
  )
  return release
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [os, cpu] = (process.argv[3] ?? 'darwin-arm64').split('-')
  await buildChromePackage(process.argv[2], undefined, { os, cpu })
}
