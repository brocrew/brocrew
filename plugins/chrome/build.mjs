import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { filesBelow, finalizePackage } from '../shared/package-archive.mjs'
import { build } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const validPath = (name) =>
  name
    .split('/')
    .every((part) => /^[A-Za-z0-9_@-][A-Za-z0-9._@-]*$/.test(part) && !part.endsWith('.'))
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
function buildWindowsBirth(out) {
  const go = process.env.BROCREW_GO || 'go'
  const cwd = path.join(root, 'native/process-birth')
  const env = {
    ...process.env,
    GOTOOLCHAIN: 'local',
    CGO_ENABLED: '0',
    GOOS: 'windows',
    GOARCH: 'amd64',
    GOFLAGS: '-mod=readonly',
  }
  if (execFileSync(go, ['env', 'GOVERSION'], { cwd, env, encoding: 'utf8' }).trim() !== 'go1.27.2')
    throw new Error('The Windows birth reader is built with go1.27.2')
  fs.mkdirSync(path.dirname(out))
  execFileSync(
    go,
    ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', out, '.'],
    { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] },
  )
}
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
  if (target.os === 'win32') buildWindowsBirth(path.join(payload, 'bin/chrome-process-birth.exe'))
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
  fs.cpSync(path.join(root, '../shared/ui'), path.join(payload, 'ui'), { recursive: true })
  // The BroCrew helper extension, loaded into visible profiles. Exactly these files, never links.
  fs.mkdirSync(path.join(payload, 'helper'))
  for (const name of ['manifest.json', 'worker.js']) {
    const from = path.join(root, 'helper', name)
    if (!fs.lstatSync(from).isFile()) throw new Error('Helper files must be regular files')
    fs.copyFileSync(from, path.join(payload, 'helper', name))
  }
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
  return finalizePackage({
    root,
    destination,
    sourceCommit,
    target,
    archiveName: 'chrome.tar',
    receipt: { bundledPackages: notices.length },
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [os, cpu] = (process.argv[3] ?? 'darwin-arm64').split('-')
  await buildChromePackage(process.argv[2], undefined, { os, cpu })
}
