#!/usr/bin/env node
/**
 * The recovery window, checked through the real entry: the built main process, the recovery
 * preload and `recovery.html`, launched on synthetic data folders and driven over CDP.
 *
 *   node scripts/recovery-real-entry-check.mjs [--no-build] [--scenario <name>] [--evidence <dir>]
 *
 * `--evidence <dir>` (or `BROBOT_RECOVERY_EVIDENCE`) keeps what the run saw: per scenario the
 * launch's own output, its record of every step, and a DOM dump and screenshot after each step;
 * and for the run `summary.json` and `report.txt`. Only the fixtures' synthetic data is in it.
 *
 * Each scenario lays down a data folder with the shared recovery fixture (`makeRecoveryFixture`),
 * launches the built app on it as its `--user-data-dir`, hidden, on a kernel-assigned debugging
 * port, and asserts what the window shows and does: the page, the bridge it is given and the one it
 * is not, its icons, the history read through the real IPC, the controls a copy cannot serve, and
 * real presses of Restore, Return and Close.
 *
 * The copies hold every row kind whose controls the window must not draw, and after its other steps
 * each scenario checks that main started none of what a start that opened its data starts.
 *
 * A step that needs a piece main does not have yet fails and names it in GAPS; nothing is skipped,
 * and a step after a failed one is reported as not reached, which is a failure too.
 *
 * Every launch gets its own folder under the temp directory and is closed by the identities
 * captured for the pid this script spawned: `owned-process.mjs` on macOS and Linux,
 * `windows-owned-launch.mjs` on Windows. The folder is removed only after that reap completed, and
 * a reap or removal that does not complete fails the scenario. The fixtures hold no credentials,
 * and nothing here reads a provider home.
 *
 * Builds the app first when `out/` is older than the sources, unless `--no-build`, which fails on a
 * missing or stale build. Exits 1 when any scenario failed or the run could not start.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, posix, resolve, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HIDDEN_LAUNCH_ARG, pidsLaunchedOn } from './lib/hidden-launch.mjs'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'
import { whoHoldsPort } from './lib/port-probe.mjs'
import { FORBIDDEN_DEFAULT_PORT, FORBIDDEN_PERSON_PORT } from './lib/smoke-target.mjs'
import {
  createWindowsLifecycle,
  removeOnceFree,
  whoHoldsPortOnWindows,
} from './lib/windows-owned-launch.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ON_WINDOWS = process.platform === 'win32'
const FIXTURE_MODULE = join(DESKTOP, 'test/recovery/lib/recovery-fixture.ts')
const SHARED_RECOVERY = join(DESKTOP, 'src/shared/recovery.ts')
/** The journal of the migrations this build carries; the build copies it beside main. */
const MIGRATION_JOURNAL = join(DESKTOP, 'src/main/db/migrations/meta/_journal.json')

/** The built files this check runs; all must be newer than every source file. */
export const BUILT_FILES = [
  'out/main/index.js',
  'out/preload/index.js',
  'out/preload/recovery.js',
  'out/renderer/recovery.html',
]

/**
 * The switch this check passes so a hidden launch keeps its recovery window open, out of sight.
 * Main honours it only on a build that is not packaged, and says so in {@link KEEP_WINDOW_LINE}.
 */
export const KEEP_RECOVERY_WINDOW_ARG = '--brobot-test-keep-recovery-window'

/** What main prints when it honours {@link KEEP_RECOVERY_WINDOW_ARG}. */
export const KEEP_WINDOW_LINE = `BroCrew keeps its recovery window on a hidden launch: ${KEEP_RECOVERY_WINDOW_ARG}`

/**
 * What a start that opened its data makes in the data folder, and a recovery start must not:
 * `brobot-workspace/`, made first thing when main creates its runtime host, and the provider homes.
 */
export const MADE_ONLY_BY_AN_OPEN_START = ['brobot-workspace', 'provider-homes']

/** The start lines main prints, pinned here rather than read from the build under test. */
export const START_LINES = {
  fail: 'BroCrew did not start.',
  openedForRecovery: 'BroCrew opened only its recovery window: its data is not opened for work.',
  openedNormally: 'BroCrew opened its data normally.',
  ready: 'BroCrew is ready: its data is open and checked.',
}

/** The fixture's clock: fixed, so the expected event times are known before the launch. */
export const FIXTURE_NOW = Date.parse('2026-10-01T12:00:00.000Z')

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** macOS `sun_path`: the one-host gate socket inside the data folder must fit it. */
const SUN_PATH_MAX = 104
const GATE_SOCKET = 'one-host.sock'
const WINDOW_WITHIN_MS = 45_000
const EXIT_WITHIN_MS = 10_000

/** Pieces this check needs that do not exist yet, by the name a failure cites. None now. */
export const GAPS = {}

/**
 * How many migrations this build carries, and so records in a database it migrated; the fixture
 * counts the same journal.
 */
export const THIS_BUILD = JSON.parse(readFileSync(MIGRATION_JOURNAL, 'utf8')).entries.length

/** How many a database records that a newer build migrated: this build's, and one more. */
export const ONE_NEWER = THIS_BUILD + 1

/**
 * The scenarios. `copy` is the checkpoint, by index, that the verdict offers or the gate restored:
 * the newest whole copy on this build's schema, which is the last of `[THIS_BUILD, THIS_BUILD]`.
 */
export const SCENARIOS = [
  {
    name: 'newer-with-a-checked-copy',
    fixture: { migrations: ONE_NEWER, checkpoints: [THIS_BUILD, THIS_BUILD], everyRowKind: true },
    tamper: null,
    copy: 1,
    verdict: 'newer',
    reasonLine: new RegExp(
      `^A newer version of BroCrew has updated this workspace's data \\(.+\\) to database version ${String(ONE_NEWER)}, and this version of BroCrew reads up to version ${String(THIS_BUILD)}\\. A recovery copy from \\S+ can be restored\\.$`,
    ),
    steps: ['entry', 'restore', 'history', 'return', 'nothing-started', 'close'],
  },
  {
    name: 'history-only',
    fixture: {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      gate: true,
      everyRowKind: true,
    },
    tamper: null,
    copy: 1,
    verdict: 'history-only',
    reasonLine:
      /^This workspace's data is a recovery copy from \S+, restored to be read; the newer data it set aside can be put back\.$/,
    steps: ['entry', 'history', 'return', 'nothing-started', 'close'],
  },
  {
    name: 'replaced-outside',
    fixture: {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      gate: true,
      everyRowKind: true,
    },
    tamper: 'live-database-tail',
    copy: 1,
    verdict: 'failed',
    reason: 'replaced-outside',
    reasonLine: /^This workspace's data was changed outside BroCrew after a restore began\./,
    steps: ['entry', 'no-history', 'nothing-started', 'close'],
  },
]

/** Controls a recorded row draws only where a pane can serve them: pictures, child work, workflows, held messages. */
export const DEAD_CONTROLS = [
  'open-image',
  'subagent-open-transcript',
  'workflow-agent-label',
  'workflow-open-journal',
  'workflow-open-script',
  'workflow-open-output',
  'restore-queued',
]

/**
 * Controls a tool call's row draws, by the start of their name (the call's id follows): Stop, for a
 * command still running, and the door to the whole answer. A copy runs nothing and holds no answer
 * to open, so the recovery window draws neither.
 */
export const DEAD_CONTROL_PREFIXES = ['tool-stop-', 'tool-answer-open-']

/** The event types whose rows would draw {@link DEAD_CONTROLS} in an ordinary pane. */
export const ROWS_WITH_CONTROLS = ['image', 'sub_agent', 'workflow_run', 'message_queued']

/** What the recovery window draws for those rows, so the controls' absence is not an empty pane. */
export const ROWS_DRAWN = [
  'image-unavailable',
  'subagent-entry',
  'tool-entry',
  'workflow-head',
  'queued-message',
]

/**
 * The rows `everyRowKind` adds after each answer, a millisecond apart from two seconds after the
 * question, as `type` and `text` (null where the event has none).
 */
const ROWS_AFTER_THE_ANSWER = [
  ['image', null],
  ['sub_agent', null],
  ['sub_agent', null],
  ['tool_call', null],
  ['workflow_run', null],
  ['message_queued', 'one more thing'],
]

// ---------------------------------------------------------------------------------------------
// Pure parts, tested in scripts/test/recovery-real-entry-check.test.mjs.

/** The body of `export interface <name> { … }` in a TypeScript source, or null. */
function interfaceBody(source, name) {
  const match = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source)
  return match === null ? null : match[1]
}

/** Member names declared at the top level of an interface body, comments left out. */
function membersOf(body) {
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
  return code.flatMap((line) => {
    const match = /^ {2}(?:readonly\s+)?(\w+)\s*(\(|:)\s*(\w+)?/.exec(line)
    return match === null ? [] : [{ name: match[1], method: match[2] === '(', type: match[3] }]
  })
}

/**
 * The bridge the contract declares: `RecoveryBridge`'s methods, and for each member typed as
 * another interface of the same file, that interface's methods.
 */
export function contractBridge(source) {
  const body = interfaceBody(source, 'RecoveryBridge')
  if (body === null) throw new Error('the shared contract declares no RecoveryBridge')
  const methods = []
  const nested = {}
  for (const member of membersOf(body)) {
    if (member.method) {
      methods.push(member.name)
      continue
    }
    const inner = interfaceBody(source, member.type ?? '')
    if (inner === null) throw new Error(`RecoveryBridge.${member.name} is not an interface here`)
    nested[member.name] = membersOf(inner)
      .filter((one) => one.method)
      .map((one) => one.name)
      .sort()
  }
  return { methods: methods.sort(), nested }
}

/**
 * What is wrong with the bridge the page was given, against the contract. `shape` maps each key
 * to `'function'`, another shape, or a `typeof` word.
 */
export function bridgeProblems(shape, contract) {
  if (shape === null || typeof shape !== 'object') return ['window.recovery is not on the page']
  const problems = []
  const wanted = [...contract.methods, ...Object.keys(contract.nested)]
  for (const key of Object.keys(shape)) {
    if (!wanted.includes(key)) problems.push(`window.recovery.${key} is not in the contract`)
  }
  for (const name of contract.methods) {
    if (!(name in shape)) problems.push(`window.recovery.${name} is missing`)
    else if (shape[name] !== 'function')
      problems.push(`window.recovery.${name} is ${JSON.stringify(shape[name])}, not a function`)
  }
  for (const [name, methods] of Object.entries(contract.nested)) {
    const inner = shape[name]
    if (inner === null || typeof inner !== 'object') {
      problems.push(`window.recovery.${name} is ${JSON.stringify(inner)}, not an object`)
      continue
    }
    for (const key of Object.keys(inner)) {
      if (!methods.includes(key))
        problems.push(`window.recovery.${name}.${key} is not in the contract`)
    }
    for (const method of methods) {
      if (inner[method] !== 'function')
        problems.push(`window.recovery.${name}.${method} is ${JSON.stringify(inner[method])}`)
    }
  }
  return problems
}

/** Icon references that point at no symbol of the page; an external reference counts as one. */
export function danglingIcons(refs, symbolIds) {
  const ids = new Set(symbolIds)
  return [...new Set(refs)].filter((href) => !href.startsWith('#') || !ids.has(href.slice(1)))
}

/**
 * The history the restored copy holds, as the fixture lays it down: one conversation per
 * checkpoint up to the copy, each a question an hour before its checkpoint and an answer a second
 * later, read back newest activity first; with `everyRowKind`, then the rows whose controls the
 * window must not draw. The checkpoints are a day apart, the newest a day before `now`.
 */
export function expectedHistory({ now, checkpoints, copy, everyRowKind = false }) {
  const rows = []
  for (let index = 0; index <= copy; index += 1) {
    const createdAt = now - (checkpoints - index) * DAY_MS
    const asked = createdAt - HOUR_MS
    const n = index + 1
    rows.push({
      id: `conversation-${String(n)}`,
      events: [
        { type: 'user_turn', text: `Asked before copy ${String(n)}.`, at: asked },
        {
          type: 'assistant_message',
          text: `Answered before copy ${String(n)}.`,
          at: asked + 1_000,
        },
        ...(everyRowKind
          ? ROWS_AFTER_THE_ANSWER.map(([type, text], index) => ({
              type,
              text,
              at: asked + 2_000 + index,
            }))
          : []),
      ],
    })
  }
  return rows.reverse()
}

/** Each difference between the history read and the one expected: ids, order, words and times. */
export function historyProblems(observed, expected) {
  if (!Array.isArray(observed)) return [`the history read is ${JSON.stringify(observed)}`]
  const problems = []
  const ids = observed.map((row) => row.id)
  const wantedIds = expected.map((row) => row.id)
  if (JSON.stringify(ids) !== JSON.stringify(wantedIds)) {
    problems.push(`conversations ${JSON.stringify(ids)}, expected ${JSON.stringify(wantedIds)}`)
  }
  for (const want of expected) {
    const got = observed.find((row) => row.id === want.id)
    if (got === undefined) continue
    const events = (got.events ?? []).map(({ type, text, at }) => ({ type, text, at }))
    if (JSON.stringify(events) !== JSON.stringify(want.events)) {
      problems.push(
        `${want.id} reads ${JSON.stringify(events)}, expected ${JSON.stringify(want.events)}`,
      )
    }
  }
  return problems
}

/** What a launch said about its start, read from its output. */
export function readStartLines(output) {
  const lines = output.split(/\r?\n/)
  const at = lines.indexOf(START_LINES.fail)
  return {
    failed: at !== -1,
    reason: at === -1 ? null : (lines[at + 1] ?? null),
    openedForRecovery: lines.includes(START_LINES.openedForRecovery),
    openedNormally: lines.includes(START_LINES.openedNormally),
    ready: lines.includes(START_LINES.ready),
    keepsTheWindow: lines.includes(KEEP_WINDOW_LINE),
  }
}

/**
 * Processes of the launch that are not Electron's own, by command line: a provider program or any
 * other a started host would run. `commands` are the descendants' command lines.
 */
export function notElectronsOwn(commands) {
  return commands.filter((command) => !/[\\/]electron[\\/]dist[\\/]/.test(command))
}

/**
 * The built files that are missing or older than the newest source, by `out/`-relative path.
 * `built` maps each path to its mtime, or null when it is missing.
 */
export function staleBuild(built, newestSource) {
  return Object.entries(built)
    .filter(([, mtime]) => mtime === null || mtime < newestSource)
    .map(([path]) => path)
}

/**
 * Whether a data folder may be used: under the temp directory, and nowhere near the app's own
 * (`~/Library/Application Support/@brobot2` on a Mac, `%APPDATA%\@brobot2` on Windows). Windows
 * compares without case, as its file system does, and has no socket to fit: its gate is a pipe.
 */
export function refusedDataFolder(
  folder,
  {
    temp = tmpdir(),
    home = homedir(),
    platform = process.platform,
    appData = process.env.APPDATA,
  } = {},
) {
  const windows = platform === 'win32'
  const path = windows ? win32 : posix
  const at = path.resolve(folder)
  const own = windows
    ? path.join(appData ?? path.join(home, 'AppData', 'Roaming'), '@brobot2')
    : path.join(home, 'Library', 'Application Support', '@brobot2')
  const same = (text) => (windows ? text.toLowerCase() : text)
  const within = (inner, outer) =>
    same(inner) === same(outer) || same(inner).startsWith(same(outer + path.sep))
  if (within(at, own)) return `${at} is inside BroBot's own data folder`
  if (!within(at, path.resolve(temp)) || same(at) === same(path.resolve(temp))) {
    return `${at} is not under the temp directory`
  }
  if (!windows && path.join(at, GATE_SOCKET).length > SUN_PATH_MAX) {
    return `${at} is too long for the one-host gate socket; run with a shorter TMPDIR`
  }
  return null
}

/** Whether a debugging port may be used: never a person's app's. */
export function refusedPort(port) {
  if (!Number.isInteger(port) || port <= 0) return `${String(port)} is not a port`
  if (port === FORBIDDEN_PERSON_PORT || port === FORBIDDEN_DEFAULT_PORT) {
    return `${String(port)} belongs to a person's BroBot`
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// The run.

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function newestMtimeUnder(path) {
  const stats = statSync(path)
  if (!stats.isDirectory()) return stats.mtimeMs
  let newest = stats.mtimeMs
  for (const name of readdirSync(path))
    newest = Math.max(newest, newestMtimeUnder(join(path, name)))
  return newest
}

function ensureBuilt(allowBuild) {
  const newestSource = Math.max(
    newestMtimeUnder(join(DESKTOP, 'src')),
    newestMtimeUnder(join(DESKTOP, 'electron.vite.config.ts')),
    newestMtimeUnder(join(DESKTOP, 'package.json')),
  )
  const built = Object.fromEntries(
    BUILT_FILES.map((path) => {
      const full = join(DESKTOP, path)
      return [path, existsSync(full) ? statSync(full).mtimeMs : null]
    }),
  )
  const stale = staleBuild(built, newestSource)
  if (stale.length === 0) return 'current'
  if (!allowBuild)
    throw new Error(`the build is not current (${stale.join(', ')}) and --no-build was given`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const run = spawnSync('pnpm', ['run', 'build'], {
    cwd: DESKTOP,
    env,
    stdio: 'inherit',
    shell: ON_WINDOWS,
  })
  if (run.status !== 0) throw new Error(`pnpm run build exited ${String(run.status ?? run.signal)}`)
  return 'built'
}

async function loadFixtureMaker() {
  const vite = await import(
    pathToFileURL(join(DESKTOP, 'node_modules/vite/dist/node/index.js')).href
  )
  const { module } = await vite.runnerImport(FIXTURE_MODULE, {
    configFile: false,
    root: DESKTOP,
    logLevel: 'error',
  })
  if (module.THIS_BUILD !== THIS_BUILD || module.ONE_NEWER !== ONE_NEWER) {
    throw new Error(
      `the fixture counts ${String(module.THIS_BUILD)} migrations in this build, and this check ${String(THIS_BUILD)}`,
    )
  }
  return module.makeRecoveryFixture
}

/** One byte at the end of the live database changed, size and times kept. */
function changeTheTail(path) {
  const before = statSync(path)
  const fd = openSync(path, 'r+')
  try {
    const byte = Buffer.alloc(1)
    readSync(fd, byte, 0, 1, before.size - 1)
    byte[0] ^= 0xff
    writeSync(fd, byte, 0, 1, before.size - 1)
  } finally {
    closeSync(fd)
  }
  utimesSync(path, before.atime, before.mtime)
}

/** The copy's own rows, read from a scratch copy of its file so the fixture is never opened. */
function rowsOfCopy(database, scratch) {
  const copy = join(scratch, 'copy.sqlite')
  copyFileSync(database, copy)
  const Database = createRequire(join(DESKTOP, 'package.json'))('better-sqlite3')
  const db = new Database(copy, { readonly: true })
  try {
    const conversations = db
      .prepare('SELECT id FROM provider_session ORDER BY updated_at DESC, id DESC')
      .all()
    const events = db.prepare(
      'SELECT payload, created_at FROM events WHERE session_id = ? ORDER BY ordinal',
    )
    return conversations.map(({ id }) => ({
      id,
      events: events.all(id).map((row) => {
        const event = JSON.parse(row.payload)
        return { type: event.type, text: event.text ?? null, at: row.created_at }
      }),
    }))
  } finally {
    db.close()
    rmSync(copy, { force: true })
  }
}

/** Each live pid's command line; a pid gone since it was listed is left out. */
function commandsOf(pids) {
  return pids.flatMap((pid) => {
    const run = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
    const command = run.status === 0 ? run.stdout.trim() : ''
    return command === '' ? [] : [command]
  })
}

/** The launch's processes as command lines: the one this script spawned and all it started. */
function commandsOfTheLaunch(app) {
  if (ON_WINDOWS) {
    return app.lifecycle.processes().map((row) => row.command || row.executable)
  }
  return commandsOf([app.child.pid, ...descendantsOf(app.child.pid).map(({ pid }) => pid)])
}

/** The pids of this launch, to tell its debugging port from anyone else's. */
async function pidsOfTheLaunch(app, dataDir) {
  if (ON_WINDOWS) return app.lifecycle.processes().map((row) => row.pid)
  return pidsLaunchedOn(dataDir)
}

/** The Electron program the desktop package installed; its `electron` module answers its path. */
function electronProgram() {
  const require = createRequire(join(DESKTOP, 'package.json'))
  const program = require('electron')
  if (typeof program !== 'string' || !existsSync(program)) {
    throw new Error(
      `the electron module named no program that exists (${String(program)}); run pnpm install`,
    )
  }
  return program
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer()
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`, {
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** A DevTools client; every call bounded at 10 s, and a closed socket rejects what is waiting. */
async function devtools(url) {
  const socket = new WebSocket(url)
  await new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error('the DevTools socket did not open in 10 s')),
      10_000,
    )
    socket.onopen = () => {
      clearTimeout(timer)
      done()
    }
    socket.onerror = () => fail(new Error('the DevTools socket failed to open'))
  })
  let next = 0
  const waiting = new Map()
  socket.onmessage = (message) => {
    const body = JSON.parse(String(message.data))
    waiting.get(body.id)?.(body)
  }
  socket.onclose = () => {
    for (const answer of waiting.values())
      answer({ error: { message: 'the DevTools socket closed' } })
  }
  const call = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++next
      const timer = setTimeout(() => {
        waiting.delete(id)
        fail(new Error(`${method}: no answer in 10 s`))
      }, 10_000)
      waiting.set(id, (body) => {
        clearTimeout(timer)
        waiting.delete(id)
        if (body.error) fail(new Error(`${method}: ${body.error.message}`))
        else done(body.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      const said = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(`in the page: ${said}`)
    }
    return result.result.value
  }
  return { call, evaluate, close: () => socket.close() }
}

async function waitFor(probe, withinMs, what) {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
    const value = await probe()
    if (value !== null && value !== undefined && value !== false) return value
    await sleep(150)
  }
  throw new Error(`${what} did not come within ${String(withinMs / 1000)} s`)
}

/** Launches the built app hidden on `userDataDir`, and takes ownership of what it started. */
async function launch(userDataDir) {
  let port = await freePort()
  while (refusedPort(port) !== null) port = await freePort()
  const program = electronProgram()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    program,
    [
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDir}`,
      HIDDEN_LAUNCH_ARG,
      KEEP_RECOVERY_WINDOW_ARG,
      '.',
    ],
    {
      cwd: DESKTOP,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so the POSIX reap can freeze the whole tree; Windows has none.
      detached: !ON_WINDOWS,
      windowsHide: true,
      env,
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const ended = { value: null }
  const exited = new Promise((done) => {
    child.on('exit', (code, signal) => {
      ended.value = { code, signal }
      done(ended.value)
    })
    child.on('error', (error) => {
      output += `\ncould not launch ${program}: ${error.message}`
      ended.value = { code: null, signal: 'never started' }
      done(ended.value)
    })
  })
  let lifecycle = null
  const until = Date.now() + 10_000
  while (lifecycle === null && Date.now() < until && ended.value === null) {
    try {
      lifecycle = ON_WINDOWS
        ? createWindowsLifecycle({ launcherPid: child.pid })
        : createOwnedProcessLifecycle({
            launcherPid: child.pid,
            discoverDescendants: descendantsOf,
          })
    } catch {
      await sleep(50)
    }
  }
  if (lifecycle === null && ended.value === null) {
    try {
      if (ON_WINDOWS) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        process.kill(-child.pid, 'SIGKILL')
      }
    } catch {
      // the group never formed
    }
    throw new Error(`could not take ownership of the launch (pid ${String(child.pid)})\n${output}`)
  }
  return { child, port, lifecycle, ended, exited, output: () => output }
}

/** A press the way a pointer makes one, at the middle of the element. */
async function press(session, selector, { index = 0, mayEndTheApp = false } = {}) {
  const box = await session.evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${String(index)}] ?? null
    if (el === null) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: el.disabled === true }
  })()`)
  const which = `${selector} #${String(index + 1)}`
  if (box === null) throw new Error(`${which} is not on the page`)
  if (box.disabled) throw new Error(`${which} is disabled`)
  const events = [
    { type: 'mouseMoved', button: 'none' },
    { type: 'mousePressed', button: 'left', clickCount: 1 },
    { type: 'mouseReleased', button: 'left', clickCount: 1 },
  ]
  for (const event of events) {
    try {
      await session.call('Input.dispatchMouseEvent', { ...event, x: box.x, y: box.y })
    } catch (error) {
      if (!(mayEndTheApp && event.type === 'mouseReleased')) throw error
    }
  }
}

const VERDICT_ON_SCREEN = `document.querySelector('[data-cy="recovery"]')?.getAttribute('data-verdict') ?? null`

async function screenShows(session, kind, what) {
  return waitFor(
    async () => ((await session.evaluate(VERDICT_ON_SCREEN)) === kind ? kind : null),
    15_000,
    what,
  )
}

const BRIDGE_SHAPE = `(() => {
  const shape = (o) => Object.fromEntries(Object.keys(o).map((k) => [k,
    typeof o[k] === 'function' ? 'function'
      : o[k] !== null && typeof o[k] === 'object' ? shape(o[k]) : typeof o[k]]))
  return {
    shape: window.recovery === undefined ? null : shape(window.recovery),
    api: typeof window.api,
    apiIn: 'api' in window,
    path: location.pathname,
  }
})()`

const ICONS = `({
  refs: [...document.querySelectorAll('use')].map((u) => u.getAttribute('href') ?? u.getAttribute('xlink:href') ?? ''),
  symbols: [...document.querySelectorAll('symbol[id]')].map((s) => s.id),
})`

const READ_HISTORY = `(async () => {
  const list = await window.recovery.history.conversations()
  const out = []
  for (const c of list) {
    const events = await window.recovery.history.transcript(c.id)
    out.push({ id: c.id, events: events.map((e) => ({ type: e.event.type, text: e.event.text ?? null, at: e.at })) })
  }
  return out
})()`

const TRY_HISTORY = `window.recovery.history.conversations().then(
  (rows) => ({ refused: false, rows: rows.length }),
  (error) => ({ refused: true, said: String(error && error.message || error) }),
)`

/** Runs one scenario and returns its record: each assertion passed or failed, and any gap. */
async function runScenario(scenario, makeRecoveryFixture, contract, keep) {
  const record = { scenario: scenario.name, passed: [], failed: [], gaps: [], evidence: {} }
  const pass = (name) => record.passed.push(name)
  const fail = (name, why) => record.failed.push({ name, why })
  const check = (name, ok, why) => (ok ? pass(name) : fail(name, why))

  const root = mkdtempSync(join(tmpdir(), 'bbrec-'))
  const dataDir = join(root, 'd')
  let app = null
  let reaped = false
  try {
    const refused = refusedDataFolder(dataDir)
    if (refused !== null) throw new Error(refused)
    const fixture = await makeRecoveryFixture(dataDir, { ...scenario.fixture, now: FIXTURE_NOW })
    const copy = fixture.checkpoints[scenario.copy]
    if (fixture.restore !== null && fixture.restore.checkpointId !== copy.id) {
      throw new Error('the fixture restored a copy other than the one this scenario expects')
    }
    if (scenario.tamper === 'live-database-tail') changeTheTail(fixture.database)
    const expected = expectedHistory({
      now: FIXTURE_NOW,
      checkpoints: fixture.checkpoints.length,
      copy: scenario.copy,
      everyRowKind: scenario.fixture.everyRowKind === true,
    })
    const drift = historyProblems(rowsOfCopy(copy.database, root), expected)
    if (drift.length > 0)
      throw new Error(`the fixture's copy is not what this check expects: ${drift.join('; ')}`)

    app = await launch(dataDir)
    record.evidence.port = app.port
    const opened = await Promise.race([
      waitFor(
        async () =>
          (await targets(app.port))?.find(
            (t) => t.type === 'page' && t.url !== '' && t.url !== 'about:blank',
          ) ?? null,
        WINDOW_WITHIN_MS,
        'a window',
      ).catch((error) => ({ error })),
      app.exited.then((ended) => ({ ended })),
    ])

    if ('ended' in opened) {
      // The launch ended before any window: say how it started and whether the switch was heard.
      await sleep(200)
      const lines = readStartLines(app.output())
      record.evidence.exit = opened.ended
      record.evidence.reason = lines.reason
      check('the start failed', lines.failed, 'no fail line')
      check(
        `the reason names the ${scenario.verdict} verdict`,
        lines.reason !== null && scenario.reasonLine.test(lines.reason),
        `reason line ${JSON.stringify(lines.reason)}`,
      )
      check(
        'it opened only for recovery',
        lines.openedForRecovery && !lines.openedNormally && !lines.ready,
        JSON.stringify(lines),
      )
      check(
        `main said it keeps the recovery window (${KEEP_RECOVERY_WINDOW_ARG})`,
        lines.keepsTheWindow,
        'no keep-window line',
      )
      throw new Error(
        `the app ended without a window though it was given ${KEEP_RECOVERY_WINDOW_ARG}: ` +
          `${JSON.stringify(opened.ended)}\n${app.output()}`,
      )
    }
    if ('error' in opened) throw opened.error

    const holders = ON_WINDOWS ? whoHoldsPortOnWindows(app.port) : whoHoldsPort(app.port)
    const ours = await pidsOfTheLaunch(app, dataDir)
    if (holders.state !== 'held' || !holders.pids.every((pid) => ours.includes(pid))) {
      throw new Error(
        `port ${String(app.port)} is not held by this launch: ${JSON.stringify(holders)}`,
      )
    }
    app.lifecycle.refreshDescendants()
    const onRecovery = /\/recovery\.html$/.test(new URL(opened.url).pathname)
    check('the page is recovery.html', onRecovery, opened.url)
    if (!onRecovery) throw new Error(`the app opened ${opened.url}, not the recovery window`)

    const session = await devtools(opened.webSocketDebuggerUrl)
    record.evidence.stepsBegan = true
    try {
      await steps(scenario, session, app, dataDir, copy, expected, contract, {
        pass,
        fail,
        check,
        record,
        keep: keep === null ? null : (name, data) => keep(`${scenario.name}/${name}`, data),
      })
    } finally {
      session.close()
    }
  } catch (error) {
    fail('the scenario ran to its end', error instanceof Error ? error.message : String(error))
    // The window never came, so none of its steps ran: each is a failure, not a skip.
    if (record.evidence.stepsBegan !== true) {
      for (const step of scenario.steps) fail(`${step}: not reached`, 'no recovery window')
    }
  } finally {
    const remove = ON_WINDOWS
      ? removeOnceFree
      : (path) => rmSync(path, { recursive: true, force: true })
    try {
      if (app !== null && app.lifecycle !== null) {
        const outcome = tearDownAndRemove({ lifecycle: app.lifecycle, directory: root, remove })
        reaped = outcome.complete && outcome.removed
        if (!outcome.complete) record.evidence.teardown = outcome
      } else if (app === null || app.ended.value !== null) {
        // Nothing was launched, or the app ended before it could be owned, and its helpers with it.
        remove(root)
        reaped = true
      }
    } catch (error) {
      record.evidence.teardownError = error instanceof Error ? error.message : String(error)
    }
    app?.child.stdout.destroy()
    app?.child.stderr.destroy()
    if (!reaped) {
      record.evidence.leftInPlace = root
      fail(
        'the launch was reaped and its folder removed',
        record.evidence.teardownError ?? `not every process of it was seen gone; ${root} is left`,
      )
    }
    record.evidence.reaped = reaped
    if (keep !== null) {
      keep(`${scenario.name}/output.log`, app === null ? '(no launch)\n' : app.output())
      keep(`${scenario.name}/record.json`, `${JSON.stringify(record, null, 2)}\n`)
    }
  }
  return record
}

/** The scenario's steps against the open window; a step after a failed one is not reached. */
async function steps(
  scenario,
  session,
  app,
  dataDir,
  copy,
  expected,
  contract,
  { pass, fail, check, record, keep },
) {
  let stopped = null
  let iconRefs = 0
  const icons = async (where) => {
    const { refs, symbols } = await session.evaluate(ICONS)
    iconRefs += refs.length
    const dangling = danglingIcons(refs, symbols)
    check(
      `every icon resolves (${where})`,
      dangling.length === 0,
      `dangling: ${dangling.join(', ')}`,
    )
  }

  for (const step of scenario.steps) {
    if (stopped !== null) {
      fail(`${step}: not reached`, `stopped at ${stopped}`)
      continue
    }
    try {
      if (step === 'entry') {
        await screenShows(session, scenario.verdict, `the ${scenario.verdict} screen`)
        const lines = readStartLines(app.output())
        check(
          'the start failed, opened only for recovery, and kept its window hidden',
          lines.failed && lines.openedForRecovery && lines.keepsTheWindow,
          JSON.stringify(lines),
        )
        const seen = await session.evaluate(BRIDGE_SHAPE)
        check('the document is recovery.html', /\/recovery\.html$/.test(seen.path), seen.path)
        const problems = bridgeProblems(seen.shape, contract)
        check('window.recovery is exactly the contract', problems.length === 0, problems.join('; '))
        check(
          'window.api is undefined',
          seen.api === 'undefined' && !seen.apiIn,
          `${seen.api}, in window: ${String(seen.apiIn)}`,
        )
        const verdict = await session.evaluate('window.recovery.verdict()')
        record.evidence.verdict = verdict
        check(
          `the verdict is ${scenario.verdict}`,
          verdict.kind === scenario.verdict,
          JSON.stringify(verdict),
        )
        if (scenario.verdict === 'newer') {
          check(
            'it offers the checked copy',
            verdict.offers?.id === copy.id,
            JSON.stringify(verdict.offers),
          )
        }
        if (scenario.reason !== undefined) {
          check(
            `the reason is ${scenario.reason}`,
            verdict.reason === scenario.reason && verdict.where === 'gate',
            JSON.stringify(verdict),
          )
        }
        await icons('entry')
      } else if (step === 'restore') {
        await press(session, '[data-cy="recovery-restore"]')
        await screenShows(session, 'history-only', 'the history-only screen after Restore')
        pass('a real Restore press leads to the history-only screen')
      } else if (step === 'history') {
        const read = await session.evaluate(READ_HISTORY)
        record.evidence.history = read
        const problems = historyProblems(read, expected)
        check(
          'the history reads through IPC with the fixture ids, order and event times',
          problems.length === 0,
          problems.join('; '),
        )
        const rows = await waitFor(
          async () => {
            const n = await session.evaluate(
              `document.querySelectorAll('[data-cy="recovery-conversation"]').length`,
            )
            return n === expected.length ? n : null
          },
          10_000,
          'the conversation list',
        )
        pass(`the list draws ${String(rows)} conversations`)
        for (let index = 0; index < expected.length; index += 1) {
          await press(session, '[data-cy="recovery-conversation"]', { index })
          // The list is in the expected order, or the read above has already failed.
          const words = expected[index].events.flatMap(({ text }) => (text === null ? [] : [text]))
          const shown = await waitFor(
            async () => {
              const text = await session.evaluate(
                `document.querySelector('[data-cy="recovery-transcript"]')?.textContent ?? ''`,
              )
              return words.every((one) => text.includes(one)) ? text : null
            },
            10_000,
            `row ${String(index + 1)}'s recorded words`,
          )
          pass(
            `row ${String(index + 1)} shows its recorded words (${String(shown.length)} characters)`,
          )
          const missing = await session.evaluate(
            `${JSON.stringify(ROWS_DRAWN)}.filter((cy) => document.querySelector('[data-cy="' + cy + '"]') === null)`,
          )
          check(
            `row ${String(index + 1)} draws ${ROWS_DRAWN.join(', ')}`,
            missing.length === 0,
            `not drawn: ${missing.join(', ')}`,
          )
          // Open every disclosure, so a control drawn behind one would be seen: each folded tool
          // row (pressing an open one would fold it), then the sub-agent and workflow cards.
          const folded = '.tool-entry.folded > [data-cy^="tool-toggle-"]'
          const foldedCount = await session.evaluate(
            `document.querySelectorAll(${JSON.stringify(folded)}).length`,
          )
          for (let n = 0; n < foldedCount; n += 1) await press(session, folded)
          for (const head of ['subagent-head', 'workflow-head']) {
            const count = await session.evaluate(
              `document.querySelectorAll('[data-cy="${head}"]').length`,
            )
            for (let n = 0; n < count; n += 1)
              await press(session, `[data-cy="${head}"]`, { index: n })
          }
          const drawn = await session.evaluate(
            `[...${JSON.stringify(DEAD_CONTROLS)}.filter((cy) => document.querySelector('[data-cy="' + cy + '"]') !== null),` +
              ` ...${JSON.stringify(DEAD_CONTROL_PREFIXES)}.filter((cy) => document.querySelector('[data-cy^="' + cy + '"]') !== null)]`,
          )
          check(
            `row ${String(index + 1)} draws no image, child, workflow, tool or queued-message control`,
            drawn.length === 0,
            `drawn: ${drawn.join(', ')}`,
          )
          await icons(`row ${String(index + 1)} open`)
        }
        const kinds = new Set(read.flatMap((row) => row.events.map((event) => event.type)))
        const absent = ROWS_WITH_CONTROLS.filter((kind) => !kinds.has(kind))
        check(
          'the copy holds every row kind those controls would be drawn for',
          absent.length === 0,
          `absent: ${absent.join(', ')}`,
        )
        check(
          'the history screen drew icons to check',
          iconRefs > 0,
          'no <use> on any screen checked',
        )
      } else if (step === 'no-history') {
        const tried = await session.evaluate(TRY_HISTORY)
        check('the history is refused', tried.refused === true, JSON.stringify(tried))
        const offered = await session.evaluate(
          `['recovery-restore', 'recovery-return'].filter((cy) => document.querySelector('[data-cy="' + cy + '"]') !== null)`,
        )
        check(
          'it offers no Restore or Return',
          offered.length === 0,
          `drawn: ${offered.join(', ')}`,
        )
      } else if (step === 'return') {
        await press(session, '[data-cy="recovery-return"]')
        await screenShows(session, 'newer', 'the newer screen after Return')
        const verdict = await session.evaluate('window.recovery.verdict()')
        check(
          'Return leads back to the newer data, offering the copy again',
          verdict.kind === 'newer' && verdict.offers?.id === copy.id,
          JSON.stringify(verdict),
        )
      } else if (step === 'nothing-started') {
        const lines = readStartLines(app.output())
        check(
          'main never said its data opened normally or that it is ready',
          !lines.openedNormally && !lines.ready,
          JSON.stringify(lines),
        )
        const made = MADE_ONLY_BY_AN_OPEN_START.filter((name) => existsSync(join(dataDir, name)))
        check(
          'no runtime host or provider homes: the data folder holds no brobot-workspace or provider-homes',
          made.length === 0,
          `made: ${made.join(', ')}`,
        )
        const commands = commandsOfTheLaunch(app)
        record.evidence.processes = commands.length
        const others = notElectronsOwn(commands)
        check(
          "every process of the launch is Electron's own: no provider or other program runs",
          commands.length > 0 && others.length === 0,
          commands.length === 0 ? 'no process found' : `others: ${others.join(' | ')}`,
        )
      } else if (step === 'close') {
        await press(session, '[data-cy="recovery-close"]', { mayEndTheApp: true })
        const ended = await Promise.race([app.exited, sleep(EXIT_WITHIN_MS).then(() => null)])
        record.evidence.closeExit = ended
        check(
          'Close ends the process with a non-zero exit',
          ended !== null && ended.code !== null && ended.code !== 0,
          JSON.stringify(ended),
        )
      }
    } catch (error) {
      stopped = step
      fail(step, error instanceof Error ? error.message : String(error))
    }
    // After Close there is no window left to look at.
    if (keep !== null && step !== 'close') await keepTheScreen(session, keep, `after-${step}`)
  }
}

/**
 * The page as it stands, kept as evidence: its DOM, and a screenshot when the hidden window gives
 * one. A page that cannot be read is said in a note beside them; it fails nothing.
 */
async function keepTheScreen(session, keep, label) {
  let dom = null
  let png = null
  const notes = []
  try {
    dom = await session.evaluate('document.documentElement.outerHTML')
  } catch (error) {
    notes.push(`no DOM: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    png = (await session.call('Page.captureScreenshot', { format: 'png' })).data
  } catch (error) {
    notes.push(`no screenshot: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (dom !== null) keep(`dom-${label}.html`, dom)
  if (png !== null) keep(`screen-${label}.png`, Buffer.from(png, 'base64'))
  if (notes.length > 0) keep(`screen-${label}.txt`, `${notes.join('\n')}\n`)
}

/** The lines that say how a scenario went; printed, and kept in `report.txt`. */
function reportLines(record) {
  const ok = record.failed.length === 0 && record.gaps.length === 0
  return {
    ok,
    lines: [
      '',
      `${ok ? 'PASS' : 'FAIL'} ${record.scenario}`,
      ...record.passed.map((name) => `  ok    ${name}`),
      ...record.failed.map(({ name, why }) => `  FAIL  ${name}: ${why}`),
      ...record.gaps.map((gap) => `  GAP   ${gap} (${GAPS[gap].owner})`),
      `  evidence ${JSON.stringify(record.evidence)}`,
    ],
  }
}

/** Where `--evidence <dir>` or `BROBOT_RECOVERY_EVIDENCE` asks the run to keep what it saw. */
export function evidenceFolder(argv, env) {
  const at = argv.indexOf('--evidence')
  if (at !== -1) {
    const dir = argv[at + 1]
    if (dir === undefined || dir.startsWith('--')) throw new Error('--evidence needs a folder')
    return resolve(dir)
  }
  const fromEnv = env.BROBOT_RECOVERY_EVIDENCE
  return fromEnv === undefined || fromEnv === '' ? null : resolve(fromEnv)
}

/** A writer of files under `dir`, or null when no evidence is asked for. */
function evidenceWriter(dir) {
  if (dir === null) return null
  mkdirSync(dir, { recursive: true })
  return (name, data) => {
    const path = join(dir, ...name.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const keep = evidenceWriter(evidenceFolder(argv, process.env))
  const summary = {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    startedAt: new Date().toISOString(),
    scenarios: [],
    passed: 0,
    total: 0,
    gaps: [],
    error: null,
  }
  const printed = []
  const say = (line) => {
    printed.push(line)
    console.log(line)
  }
  try {
    const only = argv.includes('--scenario') ? argv[argv.indexOf('--scenario') + 1] : null
    const scenarios = only === null ? SCENARIOS : SCENARIOS.filter((one) => one.name === only)
    if (scenarios.length === 0) throw new Error(`no scenario is called ${String(only)}`)
    say(`build: ${ensureBuilt(!argv.includes('--no-build'))}`)
    summary.electron = electronProgram()
    const contract = contractBridge(readFileSync(SHARED_RECOVERY, 'utf8'))
    const makeRecoveryFixture = await loadFixtureMaker()
    const records = []
    for (const scenario of scenarios) {
      records.push(await runScenario(scenario, makeRecoveryFixture, contract, keep))
    }
    const results = records.map((record) => {
      const { ok, lines } = reportLines(record)
      for (const line of lines) say(line)
      summary.scenarios.push({ ok, ...record })
      return ok
    })
    summary.gaps = [...new Set(records.flatMap((record) => record.gaps))]
    if (summary.gaps.length > 0) {
      say('\nGaps:')
      for (const gap of summary.gaps) say(`  ${gap} — ${GAPS[gap].owner}: ${GAPS[gap].what}`)
    }
    summary.passed = results.filter(Boolean).length
    summary.total = results.length
    say(`\n${String(summary.passed)} of ${String(summary.total)} scenarios passed`)
    process.exitCode = summary.total > 0 && summary.passed === summary.total ? 0 : 1
  } catch (error) {
    summary.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
    throw error
  } finally {
    summary.endedAt = new Date().toISOString()
    if (keep !== null) {
      keep('summary.json', `${JSON.stringify(summary, null, 2)}\n`)
      keep('report.txt', `${printed.join('\n')}\n`)
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exit(1)
  })
}
