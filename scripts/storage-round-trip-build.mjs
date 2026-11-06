#!/usr/bin/env node
// Builds the pinned F13 source in its own clean clone and records what it built.
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { assert, json } from './storage-round-trip-db.mjs'
import { hashBundle, hashFile } from './storage-round-trip-files.mjs'

const { values: args } = parseArgs({
  options: {
    manifest: { type: 'string' },
    root: { type: 'string' },
    inputs: { type: 'string' },
    pnpm: { type: 'string' },
  },
})
for (const key of ['manifest', 'root', 'inputs', 'pnpm']) assert(args[key], `--${key} required`)
const pin = JSON.parse(readFileSync(args.manifest, 'utf8')).f13
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(args.root),
  inputs = resolve(args.inputs),
  cwd = join(root, 'f13')
mkdirSync(root)
mkdirSync(join(root, 'home'))
mkdirSync(join(root, 'tmp'))
const env = {
  PATH: process.env.PATH,
  HOME: join(root, 'home'),
  TMPDIR: join(root, 'tmp') + '/',
  ELECTRON_CACHE: join(root, 'cache/electron'),
  electron_config_cache: join(root, 'cache/electron'),
  ELECTRON_BUILDER_CACHE: join(root, 'cache/electron-builder'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  CI: 'true',
}
const log = join(inputs, 'f13-build.log')

function run(exe, argv, where = cwd) {
  const r = spawnSync(exe, argv, { cwd: where, env, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 })
  assert(r.status === 0, `${exe} ${argv.join(' ')} failed (${r.status ?? r.signal}): ${r.stderr}`)
  return r.stdout.trim()
}
function step(exe, argv) {
  const fd = openSync(log, 'a')
  try {
    const r = spawnSync(exe, argv, { cwd, env, stdio: ['ignore', fd, fd] })
    assert(r.status === 0, `${exe} ${argv.join(' ')} failed (${r.status ?? r.signal}); see ${log}`)
  } finally {
    closeSync(fd)
  }
}
const clean = () =>
  assert(
    run('/usr/bin/git', ['status', '--porcelain', '--untracked-files=no']) === '',
    'The build changed tracked files',
  )

run('/usr/bin/git', ['clone', '--no-hardlinks', '--no-checkout', '--', repository, cwd], root)
run('/usr/bin/git', ['checkout', '--detach', pin.source])
assert(
  run('/usr/bin/git', ['rev-parse', 'HEAD']) === pin.source &&
    run('/usr/bin/git', ['rev-parse', 'HEAD^{tree}']) === pin.tree,
  'F13 checkout is not the pinned source',
)
clean()
const lockSha256 = hashFile(join(cwd, 'pnpm-lock.yaml'))
step(args.pnpm, ['install', '--frozen-lockfile', '--store-dir', join(root, 'pnpm-store')])
step(process.execPath, ['scripts/check-no-plugin-gate-inputs.mjs'])
step(process.execPath, ['scripts/prepare-plugin-node.mjs'])
step(args.pnpm, ['--filter', '@brobot2/desktop', 'build'])
step(args.pnpm, [
  '--filter',
  '@brobot2/desktop',
  'exec',
  'electron-builder',
  '--mac',
  'dir',
  '--arm64',
  '--config',
  'electron-builder.yml',
  '-c.mac.identity=-',
  `-c.extraMetadata.version=${pin.version}`,
  '--publish',
  'never',
])
clean()
assert(hashFile(join(cwd, 'pnpm-lock.yaml')) === lockSha256, 'The build changed the lockfile')
const app = join(cwd, 'apps/desktop/dist/mac-arm64/BroCrew.app')
json(join(inputs, 'f13-build.json'), {
  source: pin.source,
  tree: pin.tree,
  version: pin.version,
  app,
  lockSha256,
  bundleSha256: hashBundle(app).sha256,
})
console.log(`Built F13 ${pin.source} at ${app}`)
