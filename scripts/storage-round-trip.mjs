#!/usr/bin/env node
// The literal round trip on one scratch workspace: the released 0.2.2 app creates it, a large
// synthetic ledger is added, then 0.2.2, F13, 0.2.2 and F13 each open it, are checked and quit.
// After every quit a closed copy is compared with the one before. Runs on a hosted Mac runner.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { assert, compare, copyParity, json, progress, snapshot } from './storage-round-trip-db.mjs'
import { seed } from './storage-round-trip-fixture.mjs'
import { hashBundle, hashFile } from './storage-round-trip-files.mjs'

const READY = 'BroCrew is ready: its data is open and checked.'
const OPENED = 'BroCrew opened its data normally.'
const NOT_STARTED = ['BroCrew did not start.', 'BroCrew opened only its recovery window:']
const SHUT_DOWN = /BroCrew shut down in \d+ms — /
const FAILED_STEP = /BroCrew failed to /

const { values: args } = parseArgs({
  options: Object.fromEntries(
    ['manifest', 'old-dmg', 'old-artifact', 'f13-app', 'f13-build', 'scratch', 'evidence'].map(
      (key) => [key, { type: 'string' }],
    ),
  ),
})
for (const key of [
  'manifest',
  'old-dmg',
  'old-artifact',
  'f13-app',
  'f13-build',
  'scratch',
  'evidence',
]) {
  assert(args[key], `--${key} required`)
  args[key] = resolve(args[key])
}
assert(
  process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.platform === 'darwin' &&
    process.arch === 'arm64',
  'This round trip runs only on a hosted arm64 Mac runner',
)
const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
const scratch = args.scratch,
  evidence = args.evidence
assert(!existsSync(scratch) && !existsSync(evidence), 'Scratch and evidence folders must be new')
mkdirSync(scratch)
mkdirSync(evidence)
const home = join(scratch, 'home'),
  tmp = join(scratch, 'tmp')
mkdirSync(home)
mkdirSync(tmp)
// Nothing from the runner's own environment reaches the apps.
const env = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: home,
  CFFIXED_USER_HOME: home,
  TMPDIR: tmp + '/',
  DISABLE_AUTOUPDATER: '1',
}
const results = []
const check = (phase, name, ok, detail = null) => {
  results.push({ phase, check: name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${phase}: ${name}`)
}
const run = (exe, argv) => {
  const r = spawnSync(exe, argv, { env, encoding: 'utf8' })
  assert(r.status === 0, `${exe} ${argv.join(' ')} failed (${r.status ?? r.signal}): ${r.stderr}`)
  return r.stdout.trim()
}
const plist = (app, key) =>
  run('/usr/bin/plutil', ['-extract', key, 'raw', join(app, 'Contents/Info.plist')])
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// The volume can stay busy for a moment after the copy. It is read-only, so a volume that will
// not detach is noted and the run goes on.
function detach(mount) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = spawnSync(
      '/usr/bin/hdiutil',
      ['detach', mount, ...(attempt === 5 ? ['-force'] : [])],
      {
        env,
        encoding: 'utf8',
      },
    )
    if (r.status === 0) return
    console.log(`hdiutil detach attempt ${attempt} failed: ${r.stderr.trim()}`)
    spawnSync('/bin/sleep', ['2'])
  }
  console.log(`The 0.2.2 image stays mounted at ${mount}; the copy is already made.`)
}

function oldApp() {
  const pin = manifest.old
  const dmg = args['old-dmg']
  assert(hashFile(dmg) === pin.dmgSha256, 'The 0.2.2 disk image is not the pinned one')
  const lineage = JSON.parse(readFileSync(args['old-artifact'], 'utf8'))
  assert(
    lineage.run.id === Number(pin.runId) &&
      lineage.run.head_sha === pin.source &&
      lineage.artifact.id === Number(pin.artifactId) &&
      lineage.artifact.digest === 'sha256:' + pin.archiveSha256,
    'The 0.2.2 artifact is not the pinned build',
  )
  const mount = join(scratch, 'mount-old')
  mkdirSync(mount)
  run('/usr/bin/hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-noautoopen',
    '-mountpoint',
    mount,
    dmg,
  ])
  let app
  try {
    const bundles = readdirSync(mount).filter((name) => name.endsWith('.app'))
    assert(bundles.length === 1, 'The 0.2.2 image does not hold exactly one app')
    app = join(scratch, 'apps/old', bundles[0])
    mkdirSync(join(scratch, 'apps/old'), { recursive: true })
    run('/usr/bin/ditto', [join(mount, bundles[0]), app])
  } finally {
    detach(mount)
  }
  return describe('old', app, pin, { dmgSha256: pin.dmgSha256, artifact: lineage.artifact.id })
}
function f13App() {
  const pin = manifest.f13
  const built = JSON.parse(readFileSync(args['f13-build'], 'utf8'))
  assert(
    built.source === pin.source &&
      built.tree === pin.tree &&
      built.version === pin.version &&
      resolve(built.app) === args['f13-app'],
    'The F13 build record is not the pinned source',
  )
  const app = describe('f13', args['f13-app'], pin, { built })
  assert(app.bundleSha256 === built.bundleSha256, 'The F13 app changed after it was built')
  return app
}
function describe(label, app, pin, extra) {
  const version = plist(app, 'CFBundleShortVersionString')
  assert(version === pin.version, `${label} app is ${version}, not ${pin.version}`)
  const executable = join(app, 'Contents/MacOS', plist(app, 'CFBundleExecutable'))
  return {
    label,
    source: pin.source,
    version,
    app,
    executable,
    executableSha256: hashFile(executable),
    bundleSha256: hashBundle(app).sha256,
    ...extra,
  }
}

let current = null
/** Open the workspace with one app and wait until it says it is ready. */
async function open(binary, phase, workspace) {
  const logFile = join(evidence, `${phase}.log`)
  const child = spawn(binary.executable, ['--brobot-hidden', `--user-data-dir=${workspace}`], {
    cwd: scratch,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  current = child
  let text = ''
  // After the exit, wait briefly for the last output: a helper may keep the pipes open.
  const exited = new Promise((done) =>
    child.once('exit', (code, signal) => {
      const settle = setTimeout(() => done({ code, signal }), 5000)
      child.once('close', () => {
        clearTimeout(settle)
        done({ code, signal })
      })
    }),
  )
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      appendFileSync(logFile, chunk)
      text += chunk
    })
  }
  let ended = null
  void exited.then((exit) => {
    ended = exit
  })
  const end = Date.now() + 10 * 60 * 1000
  while (!text.includes(READY)) {
    const refused = NOT_STARTED.find((line) => text.includes(line))
    if (refused || ended || Date.now() > end) {
      if (!ended) child.kill('SIGKILL')
      await exited
      throw new Error(
        `${binary.label} did not open the workspace (${refused ?? (ended ? `exited ${JSON.stringify(ended)}` : 'no ready line in 10 minutes')}); see ${phase}.log`,
      )
    }
    await sleep(200)
  }
  check(phase, `${binary.label} opened the workspace normally`, text.includes(OPENED))
  return { child, exited, phase, binary, log: () => text }
}

/** Ask the app to quit as a person would and wait for its ordered shutdown. */
async function quit(app) {
  app.child.kill('SIGTERM')
  let killed = false
  const timer = setTimeout(
    () => {
      killed = true
      app.child.kill('SIGKILL')
    },
    3 * 60 * 1000,
  )
  const exit = await app.exited
  clearTimeout(timer)
  current = null
  const text = app.log()
  check(
    app.phase,
    `${app.binary.label} quit normally`,
    exit.code === 0 && exit.signal === null,
    exit,
  )
  check(
    app.phase,
    'shutdown report has no failed step',
    SHUT_DOWN.test(text) && !FAILED_STEP.test(text),
    text.match(/BroCrew (?:shut down|failed to)[^\n]*/g),
  )
  assert(!killed, `${app.binary.label} did not quit within 3 minutes`)
}

async function waitForFill(phase, database) {
  const end = Date.now() + 30 * 60 * 1000
  let first = null,
    state = null
  while (Date.now() < end) {
    state = progress(database)
    first ??= state
    if (state?.done === 1) break
    await sleep(1000)
  }
  json(join(evidence, `${phase}-fill.json`), { first, last: state })
  check(phase, 'F13 finished filling its copies', state?.done === 1, { first, last: state })
}

/** Snapshot the closed workspace, then check it against the previous snapshot. */
function verify(phase, database, previous, expect) {
  const now = snapshot(database, join(scratch, 'snapshots', phase))
  const tables = now.tables
  json(join(evidence, `${phase}-snapshot.json`), {
    ...now,
    tables: Object.fromEntries(
      Object.entries(tables).map(([table, meta]) => [
        table,
        { count: meta.count, sha256: meta.sha256 },
      ]),
    ),
  })
  check(
    phase,
    'integrity check ok',
    now.integrity.length === 1 && now.integrity[0] === 'ok',
    now.integrity.slice(0, 5),
  )
  check(phase, 'no foreign key problems', now.foreignKeys.length === 0, now.foreignKeys.slice(0, 5))
  if (previous) {
    const diff = compare(previous, now)
    json(join(evidence, `${phase}-compare.json`), diff)
    check(phase, 'existing data unchanged', diff.differences.length === 0, diff.differences)
    if (diff.inserted.length)
      console.log(`      new rows: ${diff.inserted.map((r) => `${r.table} ${r.count}`).join(', ')}`)
  }
  if (expect.copies) {
    const parity = copyParity(now.file)
    json(join(evidence, `${phase}-parity.json`), parity)
    check(phase, 'question copies match the ledger', parity.ok, parity)
    check(
      phase,
      'copy fill is complete',
      now.progress?.length === 1 && now.progress[0].done === 1,
      now.progress,
    )
  } else check(phase, 'no F13 tables yet', !tables.question_copy && !tables.question_copy_progress)
  if (expect.progress)
    check(
      phase,
      'completed fill kept as it was',
      JSON.stringify(now.progress) === JSON.stringify(expect.progress),
      { before: expect.progress, after: now.progress },
    )
  return now
}

const workspace = join(scratch, 'workspace')
mkdirSync(workspace)
const database = join(workspace, 'brobot2.sqlite')
// Keep only the snapshots a later comparison still reads.
const drop = (shot) => rmSync(dirname(shot.file), { recursive: true, force: true })
let failure = null
try {
  const old = oldApp()
  const f13 = f13App()
  json(join(evidence, 'apps.json'), { manifest, old, f13 })

  let app = await open(old, '1-old-creates', workspace)
  await quit(app)
  assert(existsSync(database), '0.2.2 did not create its database')
  const seeded = seed(database, scratch)
  json(join(evidence, '2-seed.json'), seeded)
  console.log(`Seeded ${seeded.foldRows} ledger rows, ${seeded.databaseBytes} bytes`)
  const base = verify('2-seed', database, null, {})

  app = await open(old, '3-old', workspace)
  await quit(app)
  const a = verify('3-old', database, base, {})
  drop(base)

  app = await open(f13, '4-f13', workspace)
  await waitForFill('4-f13', database)
  await quit(app)
  const b = verify('4-f13', database, a, { copies: true })

  app = await open(old, '5-old', workspace)
  await quit(app)
  const c = verify('5-old', database, b, { copies: true, progress: b.progress })
  drop(b)

  app = await open(f13, '6-f13', workspace)
  const atOpen = progress(database)
  check('6-f13', 'F13 did not restart the fill', atOpen?.done === 1, atOpen)
  await quit(app)
  const d = verify('6-f13', database, c, { copies: true, progress: b.progress })
  drop(c)

  const whole = compare(a, d)
  json(join(evidence, 'whole-trip-compare.json'), whole)
  check(
    'whole trip',
    'data after 0.2.2 still unchanged at the end',
    whole.differences.length === 0,
    whole.differences,
  )
} catch (error) {
  current?.kill('SIGKILL')
  failure = error.stack ?? String(error)
  check('run', 'round trip ran to the end', false, failure)
}
const failed = results.filter((r) => !r.ok)
json(join(evidence, 'result.json'), { passed: failed.length === 0, results, failure })
console.log(
  failed.length === 0
    ? `\nRound trip passed: ${results.length} checks.`
    : `\nRound trip FAILED: ${failed.length} of ${results.length} checks.\n` +
        failed
          .map((r) => `  ${r.phase}: ${r.check}\n    ${JSON.stringify(r.detail)?.slice(0, 2000)}`)
          .join('\n'),
)
// An app's helper that outlives it can hold a pipe open; the result is already written.
process.exit(failed.length === 0 ? 0 : 1)
