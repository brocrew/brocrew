#!/usr/bin/env node
// Build only the two frozen source pins, in separate disposable checkouts. Never installs an app.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statfsSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { assert, json } from './storage-round-trip-db.mjs'
import { hashBundle, hashFile } from './storage-round-trip-files.mjs'
import { publish, startSupervision } from './storage-round-trip-process.mjs'

const { values: args } = parseArgs({
  options: {
    manifest: { type: 'string' },
    inputs: { type: 'string' },
    root: { type: 'string' },
    pnpm: { type: 'string' },
    execute: { type: 'boolean', default: false },
  },
})
assert(args.manifest, '--manifest required')
const config = JSON.parse(readFileSync(args.manifest, 'utf8'))
const scriptRoot = dirname(fileURLToPath(import.meta.url)),
  repository = resolve(scriptRoot, '..')
for (const name of [
  ...readdirSync(scriptRoot)
    .filter((file) => /^storage-round-trip.*\.mjs$/.test(file))
    .map((file) => 'scripts/' + file),
  'scripts/storage-round-trip-files.mjs',
  'scripts/storage-round-trip-db.mjs',
  'scripts/lib/owned-process.mjs',
  'scripts/lib/owned-teardown.mjs',
  'scripts/lib/owned-launcher.mjs',
])
  assert(
    config.approval?.files?.[name] === hashFile(join(repository, name)),
    `Unreviewed build dependency: ${name}`,
  )
assert(
  config.f13?.source === '9fdeca5995a3cc35dcc40469a4af15864c00f1fd' &&
    config.f13?.tree === 'e90b4aea3bcc636bd2ee7b846e3e34411618ed93' &&
    config.f13?.version === '0.2.5-f13' &&
    config.candidate?.version === '0.2.5',
  'Frozen source/version pins required',
)
for (const label of ['f13', 'candidate'])
  for (const field of ['source', 'tree'])
    assert(/^[a-f0-9]{40}$/.test(config[label][field]), `Full ${label} ${field} required`)
if (!args.execute) {
  console.log(JSON.stringify({ mode: 'preview', f13: config.f13, candidate: config.candidate }))
  process.exit(0)
}
assert(
  process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.GITHUB_REPOSITORY === 'brocrew/brocrew',
  'Disposable hosted Darwin arm64 only',
)
for (const key of ['inputs', 'root', 'pnpm']) assert(args[key], `--${key} required`)
const root = resolve(args.root),
  inputs = realpathSync(args.inputs),
  runnerTemp = realpathSync(process.env.RUNNER_TEMP)
const within = (parent, file) => {
  const rel = relative(parent, file)
  return rel && !rel.startsWith('..') && !isAbsolute(rel)
}
assert(
  within(runnerTemp, root) &&
    within(runnerTemp, inputs) &&
    !within(root, inputs) &&
    !within(inputs, root) &&
    root !== inputs &&
    !existsSync(root),
  'Build/input roots must be disjoint owned runner-temp children',
)
assert(isAbsolute(args.pnpm) && existsSync(args.pnpm), 'Absolute pnpm executable required')
mkdirSync(root)
const home = join(root, 'home'),
  tmp = join(root, 'tmp')
mkdirSync(home)
mkdirSync(tmp)
const env = {
  PATH: process.env.PATH,
  HOME: home,
  CFFIXED_USER_HOME: home,
  TMPDIR: tmp + '/',
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_CONFIG_HOME: join(home, '.config'),
  ELECTRON_CACHE: join(root, 'cache/electron'),
  electron_config_cache: join(root, 'cache/electron'),
  ELECTRON_BUILDER_CACHE: join(root, 'cache/electron-builder'),
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'brocrew/brocrew',
}
let active = null,
  supervision
const receipts = []
const observer = () =>
  publish(join(root, 'watchdog-state.json'), { progressAt: Date.now(), filling: false })
observer()
supervision = await startSupervision({ scratch: root, evidence: inputs, env })
const heartbeat = setInterval(observer, 1000)
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    try {
      if (active) json(join(inputs, 'build-cleanup.json'), await active.stop())
    } finally {
      process.exit(1)
    }
  })
async function step(exe, argv, cwd, log) {
  const fd = log ? openSync(log, 'a') : null
  const run = await supervision
    .launch({
      command: exe,
      args: argv,
      cwd,
      env,
      stdio: log ? ['ignore', fd, fd] : ['ignore', 'pipe', 'pipe'],
      label: log ? 'build-step' : 'build-command',
    })
    .finally(() => {
      if (fd !== null) closeSync(fd)
    })
  active = run.lifecycle
  const output = []
  let size = 0,
    rejectOutput
  const excess = new Promise((_, reject) => {
    rejectOutput = reject
  })
  if (!log)
    for (const stream of [run.child.stdout, run.child.stderr])
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > 16 * 1024 ** 2) rejectOutput(new Error('Build command output exceeded bound'))
        else if (stream === run.child.stdout) output.push(chunk)
      })
  let timeout, exit
  try {
    exit = await Promise.race([
      run.exited,
      excess,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Build command deadline exceeded')),
          log ? 15 * 60 * 1000 : 120000,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
    const closure = await run.lifecycle.stop()
    receipts.push({
      exe,
      argv,
      cwd,
      exit: exit ?? null,
      closure,
      identities: run.lifecycle.identities,
    })
    json(join(inputs, 'build-steps.json'), receipts)
    assert(closure.complete && !closure.intervention, 'Build command closure incomplete')
    await Promise.race([
      run.closed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Build command stdio did not close')), 5000)
      }),
    ]).finally(() => clearTimeout(timeout))
    active = null
  }
  assert(
    exit.pid === run.pid && exit.code === 0 && exit.signal === null && !exit.spawnError,
    'Build command exited abnormally',
  )
  return Buffer.concat(output).toString('utf8').trim()
}
const command = (exe, argv, cwd) => step(exe, argv, cwd)
const clean = async (cwd) => {
  const status = await command(
    '/usr/bin/git',
    ['status', '--porcelain', '--untracked-files=no'],
    cwd,
  )
  assert(status === '', `Tracked build input changed: ${status}`)
}

try {
  for (const label of ['f13', 'candidate']) {
    const pin = config[label],
      cwd = join(root, label),
      disk = statfsSync(root)
    assert(disk.bavail * disk.bsize > 12 * 1024 ** 3, 'Insufficient build disk reserve')
    await command(
      '/usr/bin/git',
      ['clone', '--no-hardlinks', '--no-checkout', '--', repository, cwd],
      root,
    )
    await command('/usr/bin/git', ['checkout', '--detach', pin.source], cwd)
    assert(
      (await command('/usr/bin/git', ['rev-parse', 'HEAD'], cwd)) === pin.source &&
        (await command('/usr/bin/git', ['rev-parse', 'HEAD^{tree}'], cwd)) === pin.tree,
      'Source checkout pin mismatch',
    )
    await clean(cwd)
    const lockSha256 = hashFile(join(cwd, 'pnpm-lock.yaml'))
    const pkg = JSON.parse(readFileSync(join(cwd, 'apps/desktop/package.json'), 'utf8'))
    assert(
      pkg.optionalDependencies?.['@openai/codex-darwin-arm64'] ===
        'npm:@openai/codex@0.160.0-darwin-arm64',
      'Bundled Codex source pin changed',
    )
    const log = join(inputs, `${label}-build.log`)
    await step(
      args.pnpm,
      ['install', '--frozen-lockfile', '--store-dir', join(root, 'pnpm-store')],
      cwd,
      log,
    )
    await step(process.execPath, ['scripts/check-no-plugin-gate-inputs.mjs'], cwd, log)
    await step(process.execPath, ['scripts/prepare-plugin-node.mjs'], cwd, log)
    await step(args.pnpm, ['--filter', '@brobot2/desktop', 'build'], cwd, log)
    await step(
      args.pnpm,
      [
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
      ],
      cwd,
      log,
    )
    await step(process.execPath, ['scripts/check-no-plugin-gate-inputs.mjs'], cwd, log)
    await clean(cwd)
    assert(hashFile(join(cwd, 'pnpm-lock.yaml')) === lockSha256, 'Frozen lockfile changed')
    const app = join(cwd, 'apps/desktop/dist/mac-arm64/BroCrew.app')
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], cwd)
    const codex = join(app, 'Contents/Resources/codex-vendor/aarch64-apple-darwin/bin/codex')
    const codexVersion = await command(codex, ['--version'], cwd)
    assert(/^codex-cli 0\.160\.0$/.test(codexVersion), 'Packaged Codex version mismatch')
    const bundle = hashBundle(app)
    const archive = join(inputs, `${label}-app.tar.gz`)
    await command('/usr/bin/tar', ['-czf', archive, '-C', dirname(app), 'BroCrew.app'], cwd)
    json(join(inputs, `${label}-build.json`), {
      label,
      source: pin.source,
      tree: pin.tree,
      version: pin.version,
      dirty: false,
      app,
      lockSha256,
      bundleSha256: bundle.sha256,
      bundleEntries: bundle.entries,
      codexVersion,
      codexSha256: hashFile(codex),
      archive,
      archiveSha256: hashFile(archive),
      run: {
        id: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
        job: process.env.GITHUB_JOB,
      },
      receipts: receipts.filter((r) => r.cwd === cwd),
    })
  }
} finally {
  if (active) {
    const closure = await active.stop()
    json(join(inputs, 'build-cleanup.json'), closure)
    assert(closure.complete, 'Build process containment incomplete')
  }
  json(join(inputs, 'build-steps.json'), receipts)
  clearInterval(heartbeat)
  await supervision.disarm()
}
