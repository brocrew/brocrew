import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { digest, finalizePackage } from '../shared/package-archive.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
/** The Go release the bridge is built and tested with; the archive is reproducible only with it. */
export const GO_VERSION = 'go1.27.2'
const safeName = (value) => value.replace(/[^A-Za-z0-9_.-]/g, '-')

/** The targets an archive is built for, each with Go's names for it; its manifest names exactly one. */
export const WHATSAPP_TARGETS = Object.freeze([
  Object.freeze({
    os: 'darwin',
    cpu: 'arm64',
    goos: 'darwin',
    goarch: 'arm64',
    program: 'whatsapp-bridge',
  }),
  Object.freeze({
    os: 'win32',
    cpu: 'x64',
    goos: 'windows',
    goarch: 'amd64',
    program: 'whatsapp-bridge.exe',
  }),
])

/** Go for the bridge: the pinned release, no cgo, the target's system, no machine paths or build ids. */
function goEnvironment(go, target) {
  const keep = ['HOME', 'GOPATH', 'GOMODCACHE', 'GOCACHE', 'GOPROXY', 'GOSUMDB', 'TMPDIR']
  return {
    ...Object.fromEntries(
      keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
    ),
    PATH: `${path.dirname(go)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    GOTOOLCHAIN: 'local',
    CGO_ENABLED: '0',
    GOOS: target.goos,
    GOARCH: target.goarch,
    GOFLAGS: '-mod=readonly',
  }
}
function buildBridge(go, out, target) {
  if (!path.isAbsolute(go ?? '')) throw new Error(`Supply the absolute path of ${GO_VERSION}'s go`)
  const env = goEnvironment(go, target)
  const cwd = path.join(root, 'bridge')
  const version = execFileSync(go, ['env', 'GOVERSION'], { cwd, env, encoding: 'utf8' }).trim()
  if (version !== GO_VERSION) throw new Error(`The bridge is built with ${GO_VERSION}`)
  execFileSync(
    go,
    ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', out, '.'],
    { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] },
  )
  const modules = execFileSync(
    go,
    [
      'list',
      '-deps',
      '-f',
      '{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}',
      '.',
    ],
    { cwd, env, encoding: 'utf8' },
  )
  return [...new Set(modules.split('\n').filter(Boolean))]
    .map((line) => line.split('\t'))
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
}

export async function buildWhatsAppPackage(
  destination,
  sourceCommit = process.env.BROCREW_PLUGIN_SOURCE_COMMIT,
  go = process.env.BROCREW_GO,
  target = WHATSAPP_TARGETS[0],
) {
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(sourceCommit ?? ''))
    throw new Error('Supply the frozen source commit')
  const chosen = WHATSAPP_TARGETS.find((one) => one.os === target?.os && one.cpu === target?.cpu)
  if (!chosen) throw new Error('Supply a supported target')
  if (!path.isAbsolute(destination) || fs.existsSync(destination))
    throw new Error('Use a fresh absolute output folder')
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
  const payload = path.join(destination, 'package')
  fs.mkdirSync(path.join(payload, 'bin'), { recursive: true })
  const program = path.join(payload, 'bin', chosen.program)
  const goModules = buildBridge(go, program, chosen)
  const bridgeSha256 = digest(fs.readFileSync(program))
  const { build } = await import('esbuild')
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
    define: { BROCREW_BRIDGE_SHA256: JSON.stringify(bridgeSha256) },
    banner: {
      js: "import { createRequire as brocrewCreateRequire } from 'node:module'; const require = brocrewCreateRequire(import.meta.url);",
    },
  })
  fs.cpSync(path.join(root, 'ui'), path.join(payload, 'ui'), {
    recursive: true,
    dereference: false,
  })
  fs.cpSync(path.join(root, '../shared/ui'), path.join(payload, 'ui'), { recursive: true })
  const licenses = path.join(payload, 'licenses')
  fs.mkdirSync(licenses)
  fs.copyFileSync(
    path.join(root, 'bridge/UPSTREAM-LICENSE'),
    path.join(licenses, 'whatsapp-mcp-LICENSE'),
  )
  const notices = [{ name: 'whatsapp-mcp', version: '7d6a06d', license: 'MIT' }]
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
  const licenseFiles = (dir) =>
    fs
      .readdirSync(dir)
      .filter(
        (entry) =>
          /^(LICENSE|LICENCE|COPYING|NOTICE|PATENTS)(\.|$)/i.test(entry) &&
          fs.statSync(path.join(dir, entry)).isFile(),
      )
  for (const [dir, meta] of packages) {
    notices.push({
      name: meta.name,
      version: meta.version,
      license: meta.license ?? 'See license files',
    })
    for (const entry of licenseFiles(dir))
      fs.copyFileSync(
        path.join(dir, entry),
        path.join(licenses, `${safeName(meta.name)}-${meta.version}-${safeName(entry)}`),
      )
  }
  for (const [name, version, dir] of goModules) {
    notices.push({ name, version, license: 'See license files' })
    for (const entry of licenseFiles(dir))
      fs.copyFileSync(
        path.join(dir, entry),
        path.join(licenses, `go-${safeName(name)}-${safeName(version)}-${safeName(entry)}`),
      )
  }
  fs.writeFileSync(
    path.join(licenses, 'dependencies.json'),
    JSON.stringify(
      notices.sort((a, b) => a.name.localeCompare(b.name, 'en')),
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(payload, 'package.json'),
    JSON.stringify(
      {
        name: '@brocrew/whatsapp-plugin',
        version: JSON.parse(fs.readFileSync(path.join(root, 'manifest-template.json'))).version,
        type: 'module',
      },
      null,
      2,
    ) + '\n',
  )
  return finalizePackage({
    root,
    destination,
    sourceCommit,
    target: chosen,
    archiveName: 'whatsapp.tar',
    receipt: {
      bridge: {
        go: GO_VERSION,
        cgo: false,
        goos: chosen.goos,
        goarch: chosen.goarch,
        sha256: bridgeSha256,
      },
      bundledPackages: packages.size,
      goModules: goModules.length,
    },
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [os, cpu] = (process.argv[3] ?? 'darwin-arm64').split('-')
  await buildWhatsAppPackage(process.argv[2], undefined, undefined, { os, cpu })
}
