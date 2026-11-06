#!/usr/bin/env node
// Literal packaged old -> F13 -> old -> F13 -> candidate, on one synthetic database inode.
// Preview is the default. W4 starts execution by pushing the disposable hosted Mac gate branch.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import {
  assert,
  closedSnapshot,
  compare,
  copyParity,
  json,
  progress,
  read,
  typedKey,
} from './storage-round-trip-db.mjs'
import { defaultReadProcessIdentity } from './lib/owned-process.mjs'
import { startSupervision } from './storage-round-trip-process.mjs'
import { prepareScratchCodexLogin } from './storage-round-trip-auth.mjs'
import { hashBundle, hashFile as fileHash } from './storage-round-trip-files.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { values: args } = parseArgs({
  options: {
    manifest: { type: 'string' },
    scratch: { type: 'string' },
    evidence: { type: 'string' },
    'old-dmg': { type: 'string' },
    'f13-app': { type: 'string' },
    'candidate-app': { type: 'string' },
    execute: { type: 'boolean', default: false },
  },
})
assert(args.manifest, '--manifest required')
const manifest = JSON.parse(readFileSync(resolve(args.manifest), 'utf8'))
const OLD = '4c70f40b7243965a1f167c5508aee35a6b0f3bbc'
const F13 = '9fdeca5995a3cc35dcc40469a4af15864c00f1fd'
const OLD_DMG = '08ba1724915d8351dcbcf625734ed64576435e8be218e95eaab116e6264c7458'
const FICTIONAL_KEY = 'sk-storage-round-trip-fictional-not-a-real-key'
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
assert(
  manifest.version === 1 &&
    manifest.old?.source === OLD &&
    manifest.old?.dmgSha256 === OLD_DMG &&
    manifest.old?.version === '0.2.2',
  'Old artifact pins changed',
)
assert(
  manifest.f13?.source === F13 && manifest.f13?.tree === 'e90b4aea3bcc636bd2ee7b846e3e34411618ed93',
  'Frozen F13 pin changed',
)
for (const label of ['old', 'f13', 'candidate']) {
  const pin = manifest[label]
  for (const field of ['source', 'tree'])
    assert(/^[a-f0-9]{40}$/.test(pin?.[field]), `${label}.${field} requires full SHA`)
  if (label === 'old') {
    for (const field of ['archiveSha256', 'dmgSha256'])
      assert(/^[a-f0-9]{64}$/.test(pin?.[field]), `${label}.${field} requires SHA256`)
    for (const field of ['runId', 'artifactId'])
      assert(/^\d+$/.test(String(pin?.[field])), `${label}.${field} required`)
  }
  assert(typeof pin.version === 'string' && pin.version.length > 0, `${label}.version required`)
}
assert(
  manifest.f13.version === '0.2.5-f13' && manifest.candidate.version === '0.2.5',
  'Exact source-build versions required',
)
assert(
  String(manifest.old.runId) === '42088997543' && String(manifest.old.artifactId) === '13444657642',
  'Old run/artifact changed',
)
assert(
  manifest.old.archiveSha256 === '90aacead9ed64a49acdb855ed647b08aed2edc681bb8c9e91704c56a15ddc13e',
  'Old ZIP digest changed',
)
assert(
  manifest.approval?.harnessSha256 === fileHash(fileURLToPath(import.meta.url)),
  'Exact harness pin required',
)
assert(
  Array.isArray(manifest.allowedWrites),
  'Explicit reviewed bookkeeping allowances required (may be empty)',
)
for (const name of [
  ...readdirSync(here)
    .filter((file) => /^storage-round-trip.*\.mjs$/.test(file))
    .map((file) => 'scripts/' + file),
  'scripts/lib/owned-process.mjs',
  'scripts/lib/owned-teardown.mjs',
  'scripts/lib/owned-launcher.mjs',
  '.github/workflows/storage-round-trip.yml',
  'apps/desktop/src/main/recovery/state-files.ts',
])
  assert(
    manifest.approval.files?.[name] === fileHash(join(here, '..', name)),
    `Unreviewed execution dependency: ${name}`,
  )
if (!args.execute) {
  console.log(
    JSON.stringify(
      {
        mode: 'preview',
        manifest,
        phases: ['tiny adapters', 'A', 'B', 'C', 'D', 'E', 'pristine-A candidate'],
        execution: 'not run',
        remainingGateC: ['scale/engine/SQL plans', 'cold storage', 'writer budget'],
      },
      null,
      2,
    ),
  )
  process.exit(0)
}
assert(
  process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.GITHUB_REPOSITORY === 'brocrew/brocrew' &&
    process.platform === 'darwin' &&
    process.arch === 'arm64',
  'Execution refuses self-hosted, non-Darwin and non-arm64 hosts',
)
assert(
  process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT && process.env.RUNNER_TEMP,
  'Missing hosted run identity',
)
for (const key of ['scratch', 'evidence', 'old-dmg', 'f13-app', 'candidate-app'])
  assert(args[key], `Missing --${key}`)
const within = (parent, path) => {
  const r = relative(parent, path)
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}
const runnerTemp = realpathSync(process.env.RUNNER_TEMP)
const scratch = resolve(args.scratch),
  evidence = resolve(args.evidence)
assert(
  within(runnerTemp, scratch) &&
    within(runnerTemp, evidence) &&
    !within(scratch, evidence) &&
    !within(evidence, scratch) &&
    scratch !== evidence,
  'Scratch/evidence must be disjoint new runner-temp children',
)
assert(!existsSync(scratch) && !existsSync(evidence), 'Scratch/evidence must be new')
assert(
  !existsSync(join(homedir(), 'Library/Application Support/@brobot2')),
  'Runner account has preexisting BroCrew appData; use a fresh runner',
)
const space = statfsSync(runnerTemp)
assert(space.bavail * space.bsize >= 12 * 1024 ** 3, 'Less than 12 GiB scratch headroom')
mkdirSync(scratch)
mkdirSync(evidence)
function requireHeadroom(bytes) {
  const now = statfsSync(runnerTemp)
  assert(
    now.bavail * now.bsize >= bytes + 1024 ** 3,
    'Scratch disk reserve would be crossed; preserve evidence and stop',
  )
}
const runId = randomUUID()
json(join(scratch, 'owner.json'), {
  runId,
  pid: process.pid,
  identity: defaultReadProcessIdentity(process.pid),
  githubRun: process.env.GITHUB_RUN_ID,
})
const receiptFile = join(evidence, 'binary-phases.ndjson')
const receipt = (kind, data = {}) => {
  const line = { kind, utc: new Date().toISOString(), monotonicMs: performance.now(), ...data }
  const fd = openSync(receiptFile, 'a')
  try {
    writeFileSync(fd, JSON.stringify(line) + '\n')
  } finally {
    closeSync(fd)
  }
  console.log(`${kind}: ${data.stage ?? ''}`)
}
const summary = {
  outcome: 'INCOMPLETE',
  runId,
  phases: Object.fromEntries(
    [
      'preflight',
      'tiny-old',
      'tiny-f13',
      'tiny-candidate',
      'A',
      'B',
      'C',
      'D',
      'E',
      'pristine-A-integrated',
    ].map((name) => [name, { outcome: 'not-run' }]),
  ),
  cleanup: 'not-run',
  remainingGateC: [
    'separate Emeka scale/plan probe',
    'storage-cold treatment',
    'ratified writer p99 budget',
  ],
  qualification: 'literal lifecycle only; no Gate C PASS is issued by this harness',
}
const home = join(scratch, 'home')
mkdirSync(home)
const tmp = join(scratch, 'tmp')
mkdirSync(tmp)
// Do not pass the runner's API tokens, provider credentials, or account homes to any binary.
const environment = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: home,
  CFFIXED_USER_HOME: home,
  TMPDIR: tmp + '/',
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_CACHE_HOME: join(home, '.cache'),
  DISABLE_AUTOUPDATER: '1',
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'brocrew/brocrew',
}
const inspectionHome = join(scratch, 'inspection-home')
mkdirSync(inspectionHome)
const inspectionEnvironment = {
  ...environment,
  HOME: inspectionHome,
  CFFIXED_USER_HOME: inspectionHome,
  XDG_CONFIG_HOME: join(inspectionHome, '.config'),
  XDG_CACHE_HOME: join(inspectionHome, '.cache'),
}
let active = null,
  stopping = false,
  model = null,
  modelFailure = null
let currentCase = 'preflight'
let phaseActions = null
let supervision = null,
  inspection = true
let watchdog = null,
  observerTimer = null,
  observerProgressAt = Date.now(),
  filling = false
const mounts = new Set(),
  lifecycles = [],
  modelCalls = [],
  operations = new Map()
let workspace, database, workspaceIdentity, databaseIdentity, fixture
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const bounded = (promise, ms, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
async function until(test, ms, label, delay = 100) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (modelFailure) throw modelFailure
    const value = await test()
    if (value) return value
    await sleep(delay)
  }
  throw new Error(`${label} timed out`)
}
const command = async (exe, argv, options = {}) => {
  const run = await supervision.launch({
    command: exe,
    args: argv,
    cwd: options.cwd ?? scratch,
    env: options.env ?? (inspection ? inspectionEnvironment : environment),
    label: 'inspection-command',
  })
  const stdout = [],
    stderr = []
  let bytes = 0,
    rejectOutput
  const excessive = new Promise((_, reject) => {
    rejectOutput = reject
  })
  const collect = (parts) => (chunk) => {
    bytes += chunk.length
    if (bytes > 16 * 1024 ** 2) rejectOutput(new Error('Command output exceeded bound'))
    else parts.push(chunk)
  }
  run.child.stdout.on('data', collect(stdout))
  run.child.stderr.on('data', collect(stderr))
  try {
    const exit = await bounded(Promise.race([run.exited, excessive]), 120000, 'Inspection command')
    receipt('command-exit', { exe, exit })
    assert(
      exit.pid === run.pid && exit.code === 0 && exit.signal === null && !exit.spawnError,
      'Inspection command exited abnormally',
    )
  } finally {
    const closure = await run.lifecycle.stop()
    receipt('command-containment', { exe, closure })
    assert(closure.complete && !closure.intervention, 'Inspection command closure incomplete')
    await bounded(run.closed, 5000, 'Inspection stdio closure')
  }
  return Buffer.concat(stdout).toString('utf8').trim()
}

function identity(path) {
  const s = statSync(path)
  return { path: realpathSync(path), dev: s.dev, ino: s.ino }
}
function sameFile() {
  assert(equal(identity(workspace), workspaceIdentity), 'Workspace identity changed')
  if (databaseIdentity)
    assert(
      equal(identity(database), databaseIdentity),
      'Database identity changed: no replacement/restore permitted',
    )
}
function noHolders(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (!existsSync(file + suffix)) continue
    const r = spawnSync('/usr/sbin/lsof', ['-t', '--', file + suffix], {
      encoding: 'utf8',
      timeout: 10000,
    })
    assert(
      r.status === 1 && r.stdout.trim() === '' && r.stderr.trim() === '',
      `DB holder/probe failure: ${file + suffix}: ${r.stdout} ${r.stderr}`,
    )
  }
}
function orphanScan() {
  const probe = spawnSync('/bin/ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 10000,
  })
  assert(probe.status === 0, 'Diagnostic process scan failed')
  const text = probe.stdout
  const rows = text
    .split('\n')
    .filter(
      (line) =>
        line.includes(scratch) &&
        ![process.pid, watchdog?.pid].some((pid) => line.trim().startsWith(String(pid) + ' ')),
    )
  receipt('scratch-process-diagnostic', {
    rows,
    authority: 'diagnostic only; admitted lifecycle closure is authoritative',
  })
}
async function cleanup() {
  if (stopping) return
  stopping = true
  const failures = []
  for (const item of lifecycles.toReversed()) {
    try {
      const result = await item.stop()
      receipt('cleanup-process', { result })
      assert(result.complete, 'Owned lifecycle closure incomplete')
    } catch (e) {
      failures.push(e.message)
    }
  }
  if (model) {
    model.closeAllConnections()
    await new Promise((done) => model.close(done))
    model = null
  }
  for (const path of mounts) {
    try {
      await command('/usr/bin/hdiutil', ['detach', path])
      mounts.delete(path)
    } catch (e) {
      failures.push(e.message)
    }
  }
  try {
    if (database) noHolders(database)
    orphanScan()
  } catch (e) {
    failures.push(e.message)
  }
  summary.cleanup = failures.length
    ? { outcome: 'INCOMPLETE', failures }
    : { outcome: 'closed', scratchRetained: true, scratch }
  json(join(evidence, 'cleanup.json'), summary.cleanup)
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    summary.outcome = 'INCOMPLETE'
    summary.error = signal
    void cleanup()
      .then(stopWatchdog)
      .catch((e) => {
        summary.watchdogError = e.message
      })
      .finally(() => {
        json(join(evidence, 'summary.json'), summary)
        process.exit(1)
      })
  })
const deadline = setTimeout(
  () => {
    process.emit('SIGTERM')
  },
  55 * 60 * 1000,
)
const heartbeat = setInterval(() => {
  if (!filling) observerProgressAt = Date.now()
  receipt('heartbeat', { stage: active?.stage ?? 'closed-operation' })
}, 30000)
function writeObserver() {
  const file = join(scratch, 'watchdog-state.json')
  json(file + '.tmp', {
    progressAt: observerProgressAt,
    filling,
    identities: lifecycles.flatMap((life) => life.identities),
  })
  renameSync(file + '.tmp', file)
}
async function stopWatchdog() {
  if (observerTimer) clearInterval(observerTimer)
  if (!watchdog) return
  await supervision.disarm()
  watchdog = null
}

async function connect(url) {
  const u = new URL(url)
  assert(u.hostname === '127.0.0.1', 'CDP escaped loopback')
  const socket = new WebSocket(url),
    pending = new Map()
  await bounded(
    new Promise((done, reject) => {
      socket.addEventListener('open', done, { once: true })
      socket.addEventListener('error', reject, { once: true })
    }),
    10000,
    'CDP connect',
  )
  let next = 0
  const rejectAll = () => {
    for (const p of pending.values()) p.reject(new Error('CDP closed'))
    pending.clear()
  }
  socket.addEventListener('close', rejectAll)
  socket.addEventListener('error', rejectAll)
  socket.addEventListener('message', ({ data }) => {
    const row = JSON.parse(data),
      waiter = pending.get(row.id)
    if (!waiter) return
    pending.delete(row.id)
    if (row.error) waiter.reject(new Error(JSON.stringify(row.error)))
    else waiter.done(row.result)
  })
  const call = (method, params = {}) =>
    bounded(
      new Promise((done, reject) => {
        const id = ++next
        pending.set(id, { done, reject })
        socket.send(JSON.stringify({ id, method, params }))
      }),
      60000,
      method,
    )
  return {
    call,
    close: () => {
      rejectAll()
      socket.close()
    },
    evaluate: async (body) => {
      const r = await call('Runtime.evaluate', {
        expression: `(async()=>{${body}})()`,
        awaitPromise: true,
        returnByValue: true,
      })
      assert(!r.exceptionDetails, r.exceptionDetails?.exception?.description ?? 'Bridge threw')
      return r.result?.value
    },
  }
}

async function packaged(label) {
  const pin = manifest[label]
  let app
  let built = null
  if (label !== 'old') {
    const source = realpathSync(args[`${label}-app`])
    assert(within(runnerTemp, source), 'Source-built app escaped owned runner temp')
    built = JSON.parse(
      readFileSync(join(dirname(resolve(args['old-dmg'])), `${label}-build.json`), 'utf8'),
    )
    assert(
      built.source === pin.source &&
        built.tree === pin.tree &&
        built.version === pin.version &&
        built.dirty === false &&
        built.app === source &&
        built.run?.id === process.env.GITHUB_RUN_ID &&
        built.run?.attempt === process.env.GITHUB_RUN_ATTEMPT,
      `${label} source-build receipt mismatch`,
    )
    assert(
      hashBundle(source).sha256 === built.bundleSha256,
      `${label} source-built bundle bytes changed`,
    )
    app = join(scratch, 'apps', label, 'BroCrew.app')
    mkdirSync(dirname(app), { recursive: true })
    requireHeadroom(2 * 1024 ** 3)
    await command('/usr/bin/ditto', ['--rsrc', '--extattr', source, app])
    assert(hashBundle(app).sha256 === built.bundleSha256, `${label} copied bundle bytes differ`)
    copyFileSync(
      join(dirname(resolve(args['old-dmg'])), `${label}-build.json`),
      join(evidence, `${label}-build.json`),
    )
  } else {
    const dmg = resolve(args['old-dmg'])
    assert(fileHash(dmg) === pin.dmgSha256, `${label} DMG hash mismatch`)
    requireHeadroom(2 * 1024 ** 3)
    const artifactFile = join(dirname(dmg), `${label}-artifact.json`)
    const lineage = JSON.parse(readFileSync(artifactFile, 'utf8'))
    assert(
      lineage.run.id === Number(pin.runId) &&
        lineage.run.head_sha === pin.source &&
        lineage.run.conclusion === 'success' &&
        lineage.artifact.id === Number(pin.artifactId) &&
        lineage.artifact.workflow_run?.head_sha === pin.source &&
        lineage.artifact.digest === 'sha256:' + pin.archiveSha256,
      `${label} downloaded build lineage mismatch`,
    )
    copyFileSync(artifactFile, join(evidence, `${label}-artifact.json`))
    assert(
      (await command('/usr/bin/git', ['rev-parse', `${pin.source}^{tree}`], {
        cwd: join(here, '..'),
      })) === pin.tree,
      `${label} source tree mismatch`,
    )
    const mount = join(scratch, `mount-${label}`)
    mkdirSync(mount)
    await command('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mount,
      dmg,
    ])
    mounts.add(mount)
    const bundles = readdirSync(mount).filter((name) => name.endsWith('.app'))
    assert(bundles.length === 1, `${label} image must hold exactly one app`)
    app = join(scratch, 'apps', label, bundles[0])
    mkdirSync(dirname(app), { recursive: true })
    try {
      await command('/usr/bin/ditto', ['--rsrc', '--extattr', join(mount, bundles[0]), app])
    } finally {
      await command('/usr/bin/hdiutil', ['detach', mount])
      mounts.delete(mount)
    }
  }
  assert(
    (await command('/usr/bin/git', ['rev-parse', `${pin.source}^{tree}`], {
      cwd: join(here, '..'),
    })) === pin.tree,
    `${label} source tree mismatch`,
  )
  await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  const executableName = await command('/usr/bin/plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    join(app, 'Contents/Info.plist'),
  ])
  const version = await command('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    join(app, 'Contents/Info.plist'),
  ])
  assert(version === pin.version, `${label} plist version mismatch`)
  const executable = join(app, 'Contents/MacOS', executableName)
  assert(
    (await command('/usr/bin/file', ['-b', executable])).includes('arm64'),
    `${label} executable is not arm64`,
  )
  const inspector = `const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto'); const root=${JSON.stringify(join(app, 'Contents/Resources/app.asar'))};const entries=[];function walk(d){for(const n of fs.readdirSync(d).sort()){const f=p.join(d,n);if(fs.statSync(f).isDirectory())walk(f);else if(/\\.(sql|json)$/.test(n))entries.push({name:p.relative(p.join(root,'out/main/migrations'),f),sha256:c.createHash('sha256').update(fs.readFileSync(f)).digest('hex')})}}walk(p.join(root,'out/main/migrations'));const Database=require(p.join(root,'node_modules/better-sqlite3'));const db=new Database(':memory:');console.log(JSON.stringify({package:JSON.parse(fs.readFileSync(p.join(root,'package.json'),'utf8')),migrations:entries,sqlite:db.prepare('select sqlite_version() AS version').get()}));db.close()`
  const info = JSON.parse(
    await command(executable, ['-e', inspector], {
      env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
    }),
  )
  assert(info.package.version === pin.version, `${label} package version mismatch`)
  const codex = join(app, 'Contents/Resources/codex-vendor/aarch64-apple-darwin/bin/codex')
  const facts = {
    built,
    label,
    pin,
    app,
    executable,
    executableSha256: fileHash(executable),
    asarSha256: fileHash(join(app, 'Contents/Resources/app.asar')),
    codexSha256: fileHash(codex),
    codexVersion: await command(codex, ['--version']),
    native: [],
    ...info,
  }
  assert(facts.codexVersion === 'codex-cli 0.160.0', `${label} bundled Codex must be 0.160.0`)
  if (built)
    assert(built.codexSha256 === facts.codexSha256, 'Built Codex hash changed before execution')
  const walkNative = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walkNative(full)
      else if (entry.name.endsWith('.node'))
        facts.native.push({ file: relative(app, full), sha256: fileHash(full) })
    }
  }
  walkNative(join(app, 'Contents/Resources/app.asar.unpacked'))
  assert(
    facts.native.some((f) => f.file.endsWith('better_sqlite3.node')),
    'Packaged native engine missing',
  )
  json(join(evidence, `${label}-package.json`), facts)
  return facts
}

async function startModel() {
  model = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 32 * 1024 ** 2) request.destroy()
    })
    request.on('end', () => {
      try {
        assert(
          request.method === 'POST' && request.url === '/v1/responses',
          'Unsupported fictional model endpoint',
        )
        assert(
          request.headers.authorization === `Bearer ${FICTIONAL_KEY}`,
          'Only fictional model key accepted',
        )
        const input = JSON.parse(body),
          serialized = JSON.stringify(input.input)
        const matches = [...serialized.matchAll(/ROUNDTRIP_OPERATION_([a-f0-9-]+)/g)]
        const token = matches.at(-1)?.[1],
          op = token ? operations.get(token) : null
        const offered = input.tools ?? []
        let item,
          operation = null
        if (op && !op.issued) {
          const tool = offered.find((t) => t.name === op.tool || t.name?.endsWith('__' + op.tool))
          assert(tool?.type === 'function', `Actual provider did not advertise ${op.tool}`)
          op.issued = true
          operation = { token, tool: tool.name, arguments: op.arguments }
          item = {
            type: 'function_call',
            id: `fc_${token}`,
            call_id: `call_${token}`,
            name: tool.name,
            arguments: JSON.stringify(op.arguments),
            status: 'completed',
          }
        } else {
          if (op) {
            const outputs = (input.input ?? []).filter(
              (i) => i.type === 'function_call_output' && i.call_id === `call_${token}`,
            )
            if (outputs.length) {
              op.output = outputs
              op.returned = true
            }
          }
          item = {
            type: 'message',
            id: `msg_${randomUUID()}`,
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Fictional roundtrip echo café ☕ 日本語',
                annotations: [],
              },
            ],
          }
        }
        const id = `resp_${randomUUID()}`
        modelCalls.push({ id, stage: active?.stage, operation, output: op?.output ?? null })
        json(join(evidence, 'model-calls.json'), modelCalls)
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        })
        const send = (type, value) =>
          response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
        send('response.created', { response: { id } })
        send('response.output_item.done', { output_index: 0, item })
        send('response.completed', {
          response: {
            id,
            output: [item],
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        })
        response.end()
      } catch (e) {
        modelFailure = e
        receipt('model-failure', { error: e.message })
        response.writeHead(400).end()
      }
    })
  })
  await new Promise((done) => model.listen(0, '127.0.0.1', done))
}
function prepareHome(folder, profiles) {
  for (const profile of profiles) {
    const codexHome = join(folder, 'provider-homes/default', profile, 'codex')
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(
      join(codexHome, 'config.toml'),
      [
        'cli_auth_credentials_store = "file"',
        'model = "gpt-5.4"',
        'model_provider = "round_trip"',
        '[model_providers.round_trip]',
        'name = "Fictional loopback model"',
        `base_url = "http://127.0.0.1:${model.address().port}/v1"`,
        'requires_openai_auth = true',
        'wire_api = "responses"',
        'request_max_retries = 0',
        'stream_max_retries = 0',
        '',
      ].join('\n'),
    )
  }
  json(join(folder, 'update-settings.json'), {
    updates: { checkAutomatically: false, channel: 'stable' },
  })
}

async function launch(binary, stage, folder) {
  assert(active === null, 'Parallel app phases prohibited')
  noHolders(join(folder, 'brobot2.sqlite'))
  const file = join(folder, 'brobot2.sqlite')
  phaseActions = {
    stage,
    case: currentCase,
    workspace: realpathSync(folder),
    actions: [],
    tools: [],
    initialSessions: new Set(
      existsSync(file) ? read(file, 'SELECT id FROM provider_session').map((row) => row.id) : [],
    ),
    created: new Set(),
    acted: new Set(),
  }
  const log = openSync(join(evidence, `${stage}.log`), 'a')
  const run = await supervision
    .launch({
      command: binary.executable,
      args: [
        '--brobot-hidden',
        `--user-data-dir=${folder}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
      ],
      cwd: scratch,
      env: environment,
      stdio: ['ignore', log, log],
      label: stage,
    })
    .finally(() => closeSync(log))
  const { child, lifecycle } = run
  active = { ...run, stage, child, lifecycle, folder, binary, actions: phaseActions }
  receipt('launch', {
    stage,
    identity: lifecycle.launcher,
    appPid: run.pid,
    executableSha256: binary.executableSha256,
    workspace: identity(folder),
  })
  const watch = setInterval(() => {
    if (!lifecycle.refreshDescendants()) modelFailure = new Error('Descendant discovery uncertain')
  }, 500)
  active.watch = watch
  const endpointFile = join(folder, 'DevToolsActivePort')
  const endpoint = await until(
    () => {
      assert(
        !existsSync(join(run.directory, 'terminal.json')),
        `${stage} actual app exited before ready`,
      )
      if (!existsSync(endpointFile)) return false
      const [port, path] = readFileSync(endpointFile, 'utf8').trim().split('\n')
      return /^\d+$/.test(port) && path?.startsWith('/devtools/browser/') ? { port, path } : false
    },
    180000,
    'DevTools',
  )
  active.browser = await connect(`ws://127.0.0.1:${endpoint.port}${endpoint.path}`)
  const processes = await active.browser.call('SystemInfo.getProcessInfo')
  assert(
    processes.processInfo.find((p) => p.type === 'browser')?.id === run.pid,
    'CDP browser PID is not this launch',
  )
  const page = await until(
    async () => {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/json/list`, {
        signal: AbortSignal.timeout(2000),
      })
      const pages = await response.json()
      receipt('pages', { stage, pages: pages.map((p) => ({ type: p.type, url: p.url })) })
      return pages.find((p) => p.type === 'page' && p.url?.endsWith('/index.html'))
    },
    180000,
    'Ordinary app window',
    1000,
  )
  active.page = await connect(page.webSocketDebuggerUrl)
  await until(
    () => active.page.evaluate('return Boolean(window.api?.runtime && window.api?.getAppInfo)'),
    60000,
    'Bridge',
  )
  const info = await active.page.evaluate('return await window.api.getAppInfo()')
  assert(
    !existsSync(join(homedir(), 'Library/Application Support/@brobot2')),
    'AppData escaped scratch HOME on this runner',
  )
  assert(
    info.workspace?.path === folder &&
      info.build?.commit === binary.pin.source &&
      info.build?.dirty === false &&
      info.version === binary.pin.version,
    `Runtime stamp/workspace mismatch: ${JSON.stringify(info)}`,
  )
  const updates = await active.page.evaluate('return await window.api.updates.read()')
  assert(updates.checkAutomatically === false, 'Automatic updates were not disabled')
  const startupLog = readFileSync(join(evidence, `${stage}.log`), 'utf8')
  assert(
    startupLog.includes('BroCrew opened its data normally.') &&
      !startupLog.includes('BroCrew did not start.') &&
      !startupLog.includes('BroCrew opened only its recovery window:'),
    'Normal hidden startup receipt missing/refused',
  )
  await requireNoSavedKey()
  receipt('ready', { stage, info, updates, processInfo: processes })
  return active
}
const bridge = async (method, input) => {
  assert(/^[a-zA-Z]+$/.test(method), 'Invalid bridge verb')
  const result = await active.page.evaluate(
    `return await window.api.runtime.${method}(${input === undefined ? '' : JSON.stringify(input)})`,
  )
  if (method === 'createSession') recordSessionAction(method, result?.sessionId, { created: true })
  else if (method === 'startAndSend') {
    assert(
      result?.sent?.sessionId && !result.notSent,
      'Lifecycle send was refused; no mutation allowance granted',
    )
    recordSessionAction(method, result.sent.sessionId, {
      requestedSession: input.sessionId,
      created:
        !phaseActions.initialSessions.has(result.sent.sessionId) &&
        !phaseActions.created.has(result.sent.sessionId),
    })
  } else if (method === 'close') recordSessionAction(method, input.sessionId)
  return result
}
function recordSessionAction(method, sessionId, details = {}) {
  assert(
    active?.actions === phaseActions && phaseActions.case === currentCase,
    'Session action crossed a phase boundary',
  )
  assert(
    typeof sessionId === 'string' && sessionId.length > 0,
    'Lifecycle API did not name an actual session',
  )
  if (details.created) {
    assert(
      !phaseActions.initialSessions.has(sessionId) && !phaseActions.created.has(sessionId),
      'A creation API returned a preexisting session',
    )
    phaseActions.created.add(sessionId)
  }
  phaseActions.acted.add(sessionId)
  const action = {
    id: `${phaseActions.stage}:${phaseActions.actions.length + 1}`,
    method,
    sessionId,
    ...details,
  }
  phaseActions.actions.push(action)
  receipt('session-action', { stage: phaseActions.stage, ...action })
}
function phaseEvidence() {
  return {
    stage: phaseActions.stage,
    case: phaseActions.case,
    workspace: phaseActions.workspace,
    initialSessions: [...phaseActions.initialSessions].sort(),
    created: [...phaseActions.created].sort(),
    acted: [...phaseActions.acted].sort(),
    actions: phaseActions.actions,
    tools: phaseActions.tools,
  }
}
async function requireNoSavedKey() {
  const status = await bridge('apiKeyStatus', { provider: 'codex' })
  receipt('fixture-no-saved-key', { stage: active.stage, status })
  assert(
    status.set === false && status.inUse === false && status.setAt === null,
    'Fixture unexpectedly acquired a saved BroCrew key',
  )
}
async function quit() {
  const run = active
  assert(run, 'No active launch')

  const logFile = join(evidence, `${run.stage}.log`)
  let exit, logOffset
  try {
    assert(
      !existsSync(join(run.directory, 'terminal.json')),
      'Actual app exited before requested shutdown',
    )
    await requireNoSavedKey()
    logOffset = statSync(logFile).size
    assert(run.lifecycle.refreshDescendants(), 'Quit descendant discovery uncertain')
    assert(
      run.lifecycle.signalRememberedWhy(run.pid, 'SIGTERM').signalled,
      'Actual main quit signal refused',
    )
    exit = await bounded(run.exited, 30000, 'Actual main shutdown')
    const text = readFileSync(logFile).subarray(logOffset).toString('utf8')
    const report =
      text.match(
        /BroCrew shut down in \d+ms — stop archive work \d+ms · close its sessions \d+ms · (?:keep its unsent drafts \d+ms · )?drain its archive work \d+ms · close its database \d+ms/g,
      ) ?? []
    const failedStep =
      /BroCrew failed to (?:stop archive work|close its sessions|keep its unsent drafts|drain its archive work|close its database|exit|quit)/.test(
        text,
      )
    receipt('app-exit', {
      stage: run.stage,
      appPid: run.pid,
      exit,
      orderedShutdown: report,
      failedStep,
      logOffset,
    })
    assert(
      exit.pid === run.pid && exit.code === 0 && exit.signal === null && !exit.spawnError,
      'Actual main exited abnormally',
    )
    assert(report.length === 1 && !failedStep, 'Successful ordered shutdown receipt absent/failed')
  } catch (error) {
    if (!exit)
      receipt('app-exit', {
        stage: run.stage,
        appPid: run.pid,
        exit: existsSync(join(run.directory, 'terminal.json'))
          ? JSON.parse(readFileSync(join(run.directory, 'terminal.json'), 'utf8'))
          : null,
        incomplete: true,
        reason: error.message,
      })
    throw error
  } finally {
    clearInterval(run.watch)
    run.page?.close()
    run.browser?.close()
    const closure = await run.lifecycle.stop()
    receipt('app-containment', {
      stage: run.stage,
      exit: exit ?? null,
      closure,
      identities: run.lifecycle.identities,
      actions: phaseEvidence(),
    })
    assert(closure.complete && !closure.intervention, 'App/descendant closure incomplete')
  }
  noHolders(join(run.folder, 'brobot2.sqlite'))
  orphanScan()
  rmSync(join(run.folder, 'DevToolsActivePort'), { force: true })
  active = null
}

async function operation(session, tool, input) {
  await until(
    () => {
      const row = read(
        join(active.folder, 'brobot2.sqlite'),
        'SELECT status FROM provider_session WHERE id=?',
        session,
      )[0]
      return row && ['idle', 'ended'].includes(row.status)
    },
    60000,
    'Scripted conversation idle',
  )
  const token = randomUUID(),
    op = { token, tool, arguments: input, issued: false, returned: false }
  operations.set(token, op)
  const delivered = await bridge('startAndSend', {
    sessionId: session,
    text: `Fictional ROUNDTRIP_OPERATION_${token}`,
  })
  await until(() => op.returned, 60000, `Actual ${tool} result`)
  op.session = delivered.sent.sessionId
  const action = {
    stage: active.stage,
    session: op.session,
    requestedSession: session,
    token,
    tool,
    input,
    output: op.output,
  }
  phaseActions.tools.push(action)
  receipt('tool', action)
  return op
}
async function journey(tag) {
  const folder = active.folder,
    file = join(folder, 'brobot2.sqlite')
  prepareHome(folder, [`rt-${tag}-middle`, `rt-${tag}-leaf`])
  const created = await bridge('createSession', {
    provider: 'codex',
    profileId: 'brobot',
    approvalMode: 'auto',
    cwd: scratch,
  })
  const root = created.sessionId
  assert(typeof root === 'string', 'Root session absent')
  const give = async (from, profile, title) => {
    const given = await operation(from, 'give_work', {
      profile,
      new: true,
      provider: 'codex',
      model: 'gpt-5.4',
      effort: 'low',
      title,
      brief: 'Fictional scratch work. Respond with the local scripted echo.',
      definition_of_done: 'Echo received',
      folder: scratch,
    })
    const row = await until(
      () =>
        read(
          file,
          'SELECT id,owner_session_id FROM work WHERE given_by_session_id=? AND title=?',
          given.session,
          title,
        )[0],
      60000,
      'Real child work',
    )
    recordSessionAction('give_work', row.owner_session_id, {
      created: true,
      giver: given.session,
      piece: row.id,
      toolToken: given.token,
    })
    return { session: row.owner_session_id, piece: row.id }
  }
  const middle = await give(root, `rt-${tag}-middle`, `${tag} middle`)
  const leaf = await give(middle.session, `rt-${tag}-leaf`, `${tag} leaf`)
  const question = `Fictional ${tag} question: café ☕ 日本語`
  await operation(leaf.session, 'ask_question', {
    piece: leaf.piece,
    who_answers: 'the-parent',
    question,
  })
  const asked = (session) =>
    read(
      file,
      "SELECT id,payload FROM events WHERE session_id=? AND type='question_asked' ORDER BY ordinal DESC LIMIT 1",
      session,
    )[0]
  const leafAsked = asked(leaf.session)
  assert(leafAsked, 'Real leaf question event absent')
  const original = JSON.parse(leafAsked.payload)
  await operation(middle.session, 'pass_question_up', {
    question: original.requestId,
    asked_by: leaf.session,
    who_answers: 'the-parent',
  })
  const middleAsked = JSON.parse(asked(middle.session).payload)
  assert(
    middleAsked.passedUpFrom === original.requestId && middleAsked.prompt === question,
    'Middle copied question incorrectly',
  )
  await operation(root, 'pass_question_up', {
    question: middleAsked.requestId,
    asked_by: middle.session,
    who_answers: 'a-person',
  })
  const rootAsked = JSON.parse(asked(root).payload)
  assert(
    rootAsked.passedUpFrom === middleAsked.requestId && rootAsked.prompt === question,
    'Root copied question incorrectly',
  )
  // An ordinary top-level, keyless question is a separate real tool act.
  await operation(root, 'ask_question', {
    who_answers: 'a-person',
    question: `Ordinary fictional ${tag}`,
  })
  const ordinary = JSON.parse(asked(root).payload)
  assert(!Object.hasOwn(ordinary, 'passedUpFrom'), 'Ordinary question unexpectedly keyed')
  const readback = await bridge('questionsForAPerson')
  assert(
    JSON.stringify(readback).includes(rootAsked.requestId),
    'Person readback omitted actual passed-up request',
  )
  if (!tag.startsWith('A-')) {
    await operation(middle.session, 'withdraw_task', { piece: leaf.piece })
    for (const [sessionId, requestId] of [
      [middle.session, middleAsked.requestId],
      [root, rootAsked.requestId],
    ]) {
      assert(
        read(
          file,
          "SELECT id FROM events WHERE session_id=? AND type='question_ended_with_its_piece' AND json_extract(payload,'$.requestId')=?",
          sessionId,
          requestId,
        ).length === 1,
        'Actual task withdrawal failed to traverse a passed-up question chain',
      )
    }
  }
  const histories = []
  for (const sessionId of [root, middle.session, leaf.session])
    histories.push(await bridge('latestHistory', { sessionId }))
  const result = {
    root,
    middle: middle.session,
    leaf: leaf.session,
    leafPiece: leaf.piece,
    originalRequest: original.requestId,
    rootRequest: rootAsked.requestId,
    question: middleAsked,
    routing: JSON.parse(
      read(
        file,
        "SELECT payload FROM events WHERE session_id=? AND type='request_routed' AND json_extract(payload,'$.requestId')=? ORDER BY ordinal DESC LIMIT 1",
        root,
        rootAsked.requestId,
      )[0].payload,
    ),
    launched: JSON.parse(
      read(
        file,
        "SELECT payload FROM events WHERE session_id=? AND type='launched' ORDER BY ordinal LIMIT 1",
        root,
      )[0].payload,
    ),
    readback,
    histories,
  }
  json(join(evidence, `${tag}-journey.json`), result)
  for (const sessionId of [leaf.session, middle.session, root]) await bridge('close', { sessionId })
  return result
}

function withdrawalInsertAllowances(db, before) {
  const prior = new DatabaseSync(before.file, { readOnly: true })
  const rules = []
  try {
    db.prepare('ATTACH DATABASE ? AS baseline').run(before.file)
    for (const action of phaseActions.tools.filter((entry) => entry.tool === 'withdraw_task')) {
      const work = prior
        .prepare(
          'SELECT id,owner_session_id,given_by_session_id FROM work WHERE id=? AND given_by_session_id=?',
        )
        .get(action.input.piece, action.session)
      if (!work) continue
      const permit = (where, params, reason) => {
        const keys = typedKey(
          db,
          'events',
          `${where} AND NOT EXISTS (SELECT 1 FROM baseline.events old WHERE old.id=events.id)`,
          params,
        )
        assert(keys.length <= 1, 'Recorded withdrawal produced duplicate correlated ending rows')
        for (const key of keys)
          rules.push({
            table: 'events',
            key,
            columns: [],
            insert: true,
            sourceTool: action.token,
            reason,
          })
      }
      permit(
        "session_id=? AND type='work_taken_back' AND json_extract(payload,'$.piece')=? AND json_extract(payload,'$.by')=?",
        [work.owner_session_id, work.id, action.session],
        'Exact new owner-ledger withdrawal row for this recorded tool call',
      )
      const pending = prior
        .prepare(
          "SELECT json_extract(payload,'$.requestId') AS request FROM events WHERE session_id=? AND type='question_asked' AND json_valid(payload) AND json_extract(payload,'$.piece')=?",
        )
        .all(work.owner_session_id, work.id)
        .map((row) => row.request)
      const seen = new Set()
      for (let request = pending.shift(); request !== undefined; request = pending.shift()) {
        if (seen.has(request)) continue
        seen.add(request)
        for (const copy of prior
          .prepare(
            "SELECT session_id AS session,json_extract(payload,'$.requestId') AS request FROM events WHERE type='question_asked' AND json_valid(payload) AND json_extract(payload,'$.passedUpFrom')=?",
          )
          .all(request)) {
          assert(typeof copy.request === 'string', 'Historical copied question lacks a request id')
          permit(
            "session_id=? AND type='question_ended_with_its_piece' AND json_extract(payload,'$.requestId')=? AND json_extract(payload,'$.ending')='work-withdrawn'",
            [copy.session, copy.request],
            'Exact new copy-ending row reached from the prior ledger by this recorded withdrawal',
          )
          pending.push(copy.request)
        }
      }
    }
    return rules
  } finally {
    prior.close()
  }
}
function allowances(before, after, stage) {
  const rules = manifest.allowedWrites
    .filter((rule) => rule.stages?.includes(stage))
    .map((rule) => ({ ...rule }))
  const db = new DatabaseSync(after.file, { readOnly: true })
  try {
    const owners = [...phaseActions.acted]
    const lifecycleColumns = ['status', 'updated_at', 'closed_by_the_quit_at']
    for (const id of phaseActions.created)
      for (const key of typedKey(db, 'provider_session', 'id=?', [id]))
        rules.push({
          table: 'provider_session',
          key,
          columns: [],
          insert: true,
          sourceActions: phaseActions.actions
            .filter((action) => action.sessionId === id)
            .map((action) => action.id),
          reason:
            'Exact new session created by a recorded API/tool call in this phase; no update exception',
        })
    for (const id of owners.filter((session) => phaseActions.initialSessions.has(session))) {
      const actions = phaseActions.actions.filter((action) => action.sessionId === id)
      const resumed = actions.some((action) => action.method === 'startAndSend')
      for (const key of typedKey(db, 'provider_session', 'id=?', [id]))
        rules.push({
          table: 'provider_session',
          key,
          insert: false,
          columns: [...lifecycleColumns, ...(resumed ? ['external_ref', 'launched_as'] : [])],
          sourceActions: actions.map((action) => action.id),
          reason:
            'Preexisting session actually acted on in this phase; provider refs only for recorded successful send/reopen',
        })
    }
    if (owners.length) {
      const placeholders = owners.map(() => '?').join(',')
      for (const key of typedKey(
        db,
        'agent_identity',
        `id IN (SELECT agent_identity_id FROM provider_session WHERE id IN (${placeholders}))`,
        owners,
      ))
        rules.push({
          table: 'agent_identity',
          key,
          columns: [],
          insert: true,
          reason: 'Identity created by real give_work/createSession',
        })
    }
    const givers = [
      ...new Set(
        phaseActions.actions
          .filter((action) => action.method === 'give_work')
          .map((action) => action.giver),
      ),
    ]
    const createdRoot = phaseActions.actions.some((action) => action.method === 'createSession')
    const numberingTerms = [],
      numberingParams = []
    if (createdRoot) numberingTerms.push("scope='roots'")
    if (givers.length) {
      numberingTerms.push(
        `scope IN (SELECT id FROM work WHERE owner_session_id IN (${givers.map(() => '?')}))`,
      )
      numberingParams.push(...givers)
    }
    if (numberingTerms.length)
      for (const key of typedKey(db, 'work_sequence', numberingTerms.join(' OR '), numberingParams))
        rules.push({
          table: 'work_sequence',
          key,
          columns: ['last'],
          insert: true,
          sourceActions: phaseActions.actions
            .filter((action) => ['createSession', 'give_work'].includes(action.method))
            .map((action) => action.id),
          reason: 'Exact counter key for current-phase root creation or recorded task giver',
        })
    for (const [table, meta] of Object.entries(after.tables)) {
      if (
        ['question_copy', 'question_copy_progress', 'provider_session'].includes(table) ||
        !before.tables[table]
      )
        continue
      const field = ['session_id', 'owner_session_id'].find((name) =>
        meta.columns.some((c) => c.name === name),
      )
      if (!field || owners.length === 0) continue
      const eventTypes = [
        'session',
        'launched',
        'status',
        'turn',
        'provider_turn',
        'user_turn',
        'assistant_delta',
        'assistant_message',
        'tool_call',
        'tool_result',
        'tool_inventory',
        'provider_commands',
        'provider_usage',
        'activity',
        'thinking',
        'question_asked',
        'request_routed',
        'request_resolved',
        'request_stranded',
        'request_interrupted',
        'question_recipient_ended',
        'work_given',
        'work_taken_back',
        'question_ended_with_its_piece',
        'work_interrupted',
        'reopened',
      ]
      const typeClause = table === 'events' ? ` AND type IN (${eventTypes.map(() => '?')})` : ''
      const keys = typedKey(db, table, `${field} IN (${owners.map(() => '?')})${typeClause}`, [
        ...owners,
        ...(table === 'events' ? eventTypes : []),
      ])
      for (const key of keys)
        rules.push({
          table,
          key,
          columns: [],
          insert: true,
          reason: 'New row owned by actual scripted journey session; historical rows immutable',
        })
    }
    // Effects in old ledgers name exact prior work/question keys and the current tool receipt.
    // They grant insert-only event permissions, never provider identity update permissions.
    rules.push(...withdrawalInsertAllowances(db, before))
    return rules
  } finally {
    db.close()
  }
}
// This comparison has no manifest input: a read or an old journey membership cannot authorise
// changing a stored provider identity. Only a successful send/reopen in this phase can do that.
function providerIdentityPreservation(before, after) {
  const columns = [
    'id',
    'provider',
    'connection_id',
    'profile_id',
    'agent_identity_id',
    'parent_session_id',
    'cwd',
    'external_ref',
    'launched_as',
  ]
  for (const snapshot of [before, after])
    assert(
      columns.every((name) =>
        snapshot.tables.provider_session?.columns.some((column) => column.name === name),
      ),
      'Provider identity schema unavailable',
    )
  const result = {
    before: before.file,
    after: after.file,
    columns,
    readOnlyChecked: 0,
    resumed: [],
    total: 0,
    differences: [],
  }
  const resumed = new Set(
    phaseActions.actions
      .filter((action) => action.method === 'startAndSend')
      .map((action) => action.sessionId),
  )
  const cell = (alias, name) =>
    `json_array(typeof(${alias}."${name}"),hex(CAST(${alias}."${name}" AS BLOB)))`
  const cells = (alias) => `json_array(${columns.map((name) => cell(alias, name)).join(',')})`
  const db = new DatabaseSync(after.file, { readOnly: true })
  try {
    db.prepare('ATTACH DATABASE ? AS prior').run(before.file)
    for (const row of db
      .prepare(
        `SELECT p.id AS session, json_array(${cell('p', 'id')}) AS key,
      ${cells('p')} AS before, ${cells('n')} AS after, n.id IS NULL AS missing
      FROM prior.provider_session p LEFT JOIN main.provider_session n ON p.id IS n.id`,
      )
      .iterate()) {
      assert(
        !phaseActions.created.has(row.session),
        'A new-session receipt names a row already present at the preservation baseline',
      )
      if (resumed.has(row.session) && !row.missing) {
        result.resumed.push(row.session)
        continue
      }
      result.readOnlyChecked++
      if (row.missing || row.before !== row.after) {
        result.total++
        if (result.differences.length < 100) {
          const oldCells = JSON.parse(row.before),
            newCells = JSON.parse(row.after)
          const fields = columns.filter((_, index) => !equal(oldCells[index], newCells[index]))
          result.differences.push({ ...row, fields })
        }
      }
    }
    return result
  } finally {
    db.close()
  }
}
function snapshot(stage, before, requireCopies) {
  sameFile()
  noHolders(database)
  orphanScan()
  assert(
    phaseActions?.case === stage && phaseActions.workspace === realpathSync(workspace),
    'Preservation action receipts belong to another phase/workspace',
  )
  requireHeadroom(statSync(database).size * 1.1)
  const current = closedSnapshot(database, join(evidence, stage))
  const stateSource = readFileSync(
    join(here, '../apps/desktop/src/main/recovery/state-files.ts'),
    'utf8',
  )
  const stateNames = [
    ...stateSource
      .split('export const APP_STATE_FILES')[1]
      .split('export const NOT_STATE')[0]
      .matchAll(/name: '([^']+)'/g),
  ].map((match) => match[1])
  assert(stateNames.length >= 10, 'State census could not be read')
  const state = {}
  const scan = (file, name) => {
    if (!existsSync(file)) {
      state[name] = null
      return
    }
    assert(within(workspace, realpathSync(file)), 'State path escaped fictional workspace')
    if (statSync(file).isDirectory()) {
      state[name] = 'directory'
      for (const entry of readdirSync(file).sort()) scan(join(file, entry), name + '/' + entry)
    } else state[name] = { bytes: statSync(file).size, sha256: fileHash(file) }
  }
  for (const name of stateNames) scan(join(workspace, name), name)
  current.state = state
  json(join(evidence, stage, 'state.json'), { stateNames, state })
  json(join(evidence, stage, 'phase-actions.json'), phaseEvidence())
  if (before) {
    const identities = providerIdentityPreservation(before, current)
    json(join(evidence, `${stage}-provider-identities.json`), identities)
    assert(
      identities.total === 0,
      `${stage}: preexisting read-only provider identity changed despite manifest allowances (${identities.total})`,
    )
    for (const path of new Set([...Object.keys(before.state), ...Object.keys(state)])) {
      assert(
        equal(before.state[path], state[path]) ||
          manifest.allowedStateWrites?.some(
            (rule) => rule.path === path && rule.stages?.includes(stage) && rule.reason,
          ),
        `Unapproved state bytes changed: ${path}`,
      )
    }
    const parity = compare(before, current, allowances(before, current, stage))
    json(join(evidence, `${stage}-preservation.json`), parity)
    assert(
      parity.total === 0,
      `${stage}: authoritative changes outside explicit allowances (${parity.total})`,
    )
  }
  if (requireCopies) {
    const parity = copyParity(current.file)
    json(join(evidence, `${stage}-parity.json`), parity)
    assert(parity.ok, `${stage}: derived relation or ordered lookup mismatch`)
    assert(
      current.progress.length === 1 && current.progress[0].done === 1,
      `${stage}: no terminal completion`,
    )
  } else
    assert(
      !current.tables.question_copy && !current.tables.question_copy_progress,
      `${stage}: old seed already has F13 objects`,
    )
  summary.phases[stage] = { outcome: 'assertions-completed', file: current.file }
  return current
}
async function readOriginal(original) {
  const histories = []
  for (const [sessionId, requestId] of [
    [original.root, original.rootRequest],
    [original.middle, original.question.requestId],
    [original.leaf, original.originalRequest],
  ]) {
    const history = await bridge('latestHistory', { sessionId })
    assert(
      JSON.stringify(history).includes(requestId),
      'Original question bytes missing from real history readback',
    )
    histories.push({ sessionId, history })
  }
  json(join(evidence, `${active.stage}-original-history.json`), histories)
}
async function waitFill(stage, sentinel = false) {
  filling = true
  observerProgressAt = Date.now()
  writeObserver()
  let previous = null,
    changedAt = Date.now(),
    first = null,
    checked = false
  const end = Date.now() + 15 * 60 * 1000
  while (Date.now() < end) {
    const state = progress(database)
    if (state) {
      if (!first) {
        first = state
        assert(first.done === 0, `${stage}: initial done=0 was not observed`)
        receipt('fill-initial', { stage, state })
      }
      if (!equal(previous, state)) {
        previous = state
        changedAt = Date.now()
        observerProgressAt = changedAt
        receipt('fill-progress', { stage, state })
      }
      if (sentinel && !checked) {
        const s = fixture.sentinel
        const originalRoute = read(
          database,
          "SELECT payload FROM events WHERE session_id=? AND type='request_routed' AND json_extract(payload,'$.requestId')=? ORDER BY ordinal DESC LIMIT 1",
          s.originalAsker,
          s.originalRequest,
        )[0]
        const nonParent = read(
          database,
          'SELECT id,parent_session_id FROM provider_session WHERE id=?',
          s.session,
        )[0]
        assert(
          originalRoute &&
            JSON.parse(originalRoute.payload).parent === s.giver &&
            s.session !== s.giver &&
            nonParent?.parent_session_id === null,
          'Sentinel must be a non-parent copy discoverable through key lookup',
        )
        assert(
          state.done === 0 &&
            read(database, 'SELECT event_id FROM question_copy WHERE event_id=?', s.event)
              .length === 0,
          'Historical sentinel already copied; fallback unproved',
        )
        await operation(s.giver, 'withdraw_task', { piece: s.piece })
        const ended = read(
          database,
          "SELECT id,payload FROM events WHERE session_id=? AND type='question_ended_with_its_piece' AND json_extract(payload,'$.requestId')=?",
          s.session,
          s.request,
        )
        const after = progress(database)
        assert(
          ended.length === 1 &&
            after?.done === 0 &&
            read(database, 'SELECT event_id FROM question_copy WHERE event_id=?', s.event)
              .length === 0,
          'Real API failed to find uncopied historical sentinel before completion',
        )
        receipt('fallback-sentinel', {
          stage,
          before: state,
          after,
          ended,
          originalRoute,
          nonParent,
          derivedRowAbsentBeforeAndAfter: true,
        })
        checked = true
      }
      if (state.done === 1) {
        assert(!sentinel || checked, 'Sentinel not exercised')
        filling = false
        observerProgressAt = Date.now()
        writeObserver()
        return state
      }
    }
    assert(Date.now() - changedAt < 120000, 'No background fill progress for 120 seconds')
    await sleep(25)
  }
  throw new Error(`${stage}: fill deadline exceeded`)
}

try {
  writeObserver()
  supervision = await startSupervision({
    scratch,
    evidence,
    env: environment,
    registerLifecycle: (life) => {
      lifecycles.push(life)
      writeObserver()
    },
    receipt,
  })
  watchdog = supervision.child
  observerTimer = setInterval(writeObserver, 1000)
  json(join(evidence, 'manifest.json'), manifest)
  const binaries = {}
  for (const label of ['old', 'f13', 'candidate']) binaries[label] = await packaged(label)
  assert(
    equal(binaries.old.migrations, binaries.f13.migrations) &&
      equal(binaries.old.migrations, binaries.candidate.migrations),
    'Entire packaged SQL/journal/snapshot migration tree differs',
  )
  json(join(evidence, 'provenance.json'), {
    manifest,
    run: {
      id: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      job: process.env.GITHUB_JOB,
    },
    harness: readdirSync(here)
      .filter((f) => /^storage-round-trip.*\.mjs$/.test(f))
      .map((f) => ({ file: f, sha256: fileHash(join(here, f)) })),
    runtime: process.versions,
    arch: process.arch,
    platform: process.platform,
    disk: space,
    home,
    cold: 'process/SQLite-connection cold only; no OS storage-cache eviction',
    binaries,
  })
  await prepareScratchCodexLogin({
    scratchRoot: scratch,
    home,
    codex: {
      path: join(
        binaries.old.app,
        'Contents/Resources/codex-vendor/aarch64-apple-darwin/bin/codex',
      ),
      sha256: binaries.old.codexSha256,
      version: binaries.old.codexVersion,
    },
    fictionalKey: FICTIONAL_KEY,
    receipt: ({ kind, ...data }) => receipt(kind, data),
    launch: supervision.launch,
  })
  inspection = false
  await startModel()
  // Each binary must prove its actual tool/provider adapter before bulk seeding.
  for (const label of ['old', 'f13', 'candidate']) {
    currentCase = `tiny-${label}`
    const tiny = join(scratch, `tiny-${label}`)
    mkdirSync(tiny)
    prepareHome(tiny, ['brobot'])
    await launch(binaries[label], `tiny-${label}`, tiny)
    await journey(`tiny-${label}`)
    await quit()
    summary.phases[currentCase] = { outcome: 'assertions-completed' }
  }
  summary.phases.preflight = { outcome: 'assertions-completed' }
  currentCase = 'A'
  workspace = join(scratch, 'workspace')
  mkdirSync(workspace)
  workspaceIdentity = identity(workspace)
  database = join(workspace, 'brobot2.sqlite')
  prepareHome(workspace, ['brobot'])
  await launch(binaries.old, 'A-initialize', workspace)
  const original = await journey('A-initialize')
  await quit()
  databaseIdentity = identity(database)
  const templateFile = join(scratch, 'template.json')
  json(templateFile, original)
  const seedFile = join(scratch, 'fixture.json')
  // Copy only our fixture script into scratch; no emitted product bundle is patched.
  const seedScript = join(scratch, 'storage-round-trip-fixture.mjs')
  copyFileSync(join(here, 'storage-round-trip-fixture.mjs'), seedScript)
  noHolders(database)
  const seedLog = openSync(join(evidence, 'synthetic-seed.log'), 'a')
  filling = true
  observerProgressAt = Date.now()
  writeObserver()
  const seedRun = await supervision
    .launch({
      command: binaries.old.executable,
      args: [
        seedScript,
        '--app',
        binaries.old.app,
        '--database',
        database,
        '--scratch',
        scratch,
        '--template',
        templateFile,
        '--output',
        seedFile,
      ],
      env: { ...environment, ELECTRON_RUN_AS_NODE: '1', ROUND_TRIP_NATIVE_SEED: 'synthetic-only' },
      cwd: scratch,
      stdio: ['ignore', 'pipe', seedLog],
      label: 'synthetic-seed',
    })
    .finally(() => closeSync(seedLog))
  const seeded = seedRun.child
  seeded.stdout.on('data', (chunk) => {
    const fd = openSync(join(evidence, 'synthetic-seed.log'), 'a')
    try {
      writeFileSync(fd, chunk)
    } finally {
      closeSync(fd)
    }
    observerProgressAt = Date.now()
    writeObserver()
  })
  const seedExit = await bounded(seedRun.exited, 10 * 60 * 1000, 'Synthetic native seed')
  const seedClosure = await seedRun.lifecycle.stop()
  await bounded(seedRun.closed, 5000, 'Seed stdio closure')
  receipt('seed-exit-containment', { exit: seedExit, closure: seedClosure })
  assert(
    seedExit.pid === seedRun.pid &&
      seedExit.code === 0 &&
      seedExit.signal === null &&
      !seedExit.spawnError &&
      seedClosure.complete &&
      !seedClosure.intervention,
    'Native synthetic seeding failed/incomplete',
  )
  filling = false
  observerProgressAt = Date.now()
  writeObserver()
  fixture = JSON.parse(readFileSync(seedFile, 'utf8'))
  json(join(evidence, 'fixture-manifest.json'), fixture)
  await launch(binaries.old, 'A-large-old', workspace)
  await readOriginal(original)
  await journey('A-large-old')
  await quit()
  const a = snapshot('A', null, false)
  const pristine = join(scratch, 'pristine-A')
  requireHeadroom(statSync(database).size * 1.1)
  cpSync(workspace, pristine, {
    recursive: true,
    filter: (file) =>
      !(
        within(join(workspace, 'provider-homes'), file) &&
        /^\.?auth\.json(?:$|[.-])/.test(basename(file))
      ),
  })
  receipt('pristine-auth', {
    copiedByHarness: false,
    provisioning: 'normal app copy from the same fictional machine login',
  })
  assert(
    fileHash(join(pristine, 'brobot2.sqlite')) === fileHash(database),
    'Pristine clone DB bytes differ',
  )
  currentCase = 'B'
  await launch(binaries.f13, 'B-f13-first', workspace)
  await waitFill('B', true)
  await readOriginal(original)
  await journey('B')
  await quit()
  const b = snapshot('B', a, true)
  currentCase = 'C'
  await launch(binaries.old, 'C-old-rollback', workspace)
  await readOriginal(original)
  await journey('C')
  await quit()
  const c = snapshot('C', b, true)
  assert(equal(b.progress, c.progress), 'Old rollback changed completion/cursor')
  currentCase = 'D'
  await launch(binaries.f13, 'D-f13-return', workspace)
  await readOriginal(original)
  assert(equal(progress(database), b.progress[0]), 'F13 return restarted progress/cursor')
  await journey('D')
  await quit()
  const d = snapshot('D', c, true)
  assert(equal(d.progress, b.progress), 'F13 return changed completed cursor')
  currentCase = 'E'
  await launch(binaries.candidate, 'E-integrated', workspace)
  await readOriginal(original)
  assert(
    equal(progress(database), b.progress[0]),
    'Integrated candidate restarted completed progress',
  )
  await journey('E')
  await quit()
  const e = snapshot('E', d, true)
  assert(equal(e.progress, b.progress), 'Integrated candidate changed completed cursor')
  // Independent integrated first open starts from the closed A clone, never a B/D snapshot.
  workspace = pristine
  database = join(pristine, 'brobot2.sqlite')
  workspaceIdentity = identity(workspace)
  databaseIdentity = identity(database)
  currentCase = 'pristine-A-integrated'
  await launch(binaries.candidate, 'pristine-A-integrated', workspace)
  await waitFill('pristine-A-integrated')
  await readOriginal(original)
  await journey('pristine')
  await quit()
  snapshot('pristine-A-integrated', a, true)
  summary.outcome = 'LIFECYCLE_ASSERTIONS_COMPLETED'
} catch (e) {
  summary.outcome = 'INCOMPLETE'
  summary.phases[currentCase] = { outcome: 'failed', error: e.message }
  summary.firstFailingBoundary = active?.stage ?? currentCase
  summary.error = e.stack ?? String(e)
  receipt('failure', { stage: active?.stage, error: summary.error })
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  clearInterval(heartbeat)
  if (active?.watch) clearInterval(active.watch)
  active?.page?.close()
  active?.browser?.close()
  await cleanup()
  if (summary.cleanup.outcome !== 'closed') {
    process.exitCode = 1
    summary.outcome = 'INCOMPLETE'
  }
  // Keep synthetic failures and sidecars. Removal is deliberately deferred to runner disposal.
  if (database && existsSync(database) && summary.cleanup.outcome === 'closed') {
    try {
      closedSnapshot(database, join(evidence, 'terminal'))
    } catch (e) {
      summary.snapshotError = e.message
      process.exitCode = 1
      summary.outcome = 'INCOMPLETE'
    }
  }
  try {
    await stopWatchdog()
  } catch (e) {
    summary.watchdogError = e.message
    summary.outcome = 'INCOMPLETE'
    process.exitCode = 1
  }
  json(join(evidence, 'summary.json'), summary)
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name !== 'sha256-manifest.json')
        files.push({
          file: relative(evidence, full),
          sha256: fileHash(full),
          bytes: statSync(full).size,
        })
    }
  }
  walk(evidence)
  json(join(evidence, 'sha256-manifest.json'), files)
  console.log(JSON.stringify(summary, null, 2))
}
