#!/usr/bin/env node
/**
 * Measure concurrent winners of Chromium's single-instance lock for one userData.
 *
 *   pnpm run probe:one-app
 *
 * Use a small Electron main calling `app.requestSingleInstanceLock()` without app startup,
 * so the measured subject is the lock. Launch both contenders from one shell for the
 * simultaneous case; +50 ms and +200 ms offsets are controls.
 * Hold each winning lock for `HOLD_MS` so those controls actually overlap a live owner.
 * A final launch after the first has exited must win, distinguishing contention from a
 * broken instrument.
 * Outside `ci`: about a minute, no database, window or debug port. Each trial gets a fresh
 * `--user-data-dir` under `os.tmpdir()`.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ELECTRON = join(REPO_ROOT, 'apps/desktop/node_modules/.bin/electron')
const ESBUILD = join(REPO_ROOT, 'node_modules/.pnpm/node_modules/.bin/esbuild')
const GATE = join(REPO_ROOT, 'apps/desktop/src/main/one-host-gate.ts')

/**
 * The whole app under test.
 *
 * ⚠️ **The verdict is appended to a file rather than printed.** `app.exit()` is immediate — 202 §7
 * chose it for exactly that reason — and a process that exits that way can lose buffered stdout.
 * `appendFileSync` of one short line is atomic enough for two writers that each write once.
 */
const PROBE_MAIN = String.raw`
const { app } = require('electron')
const { appendFileSync } = require('node:fs')
const won = app.requestSingleInstanceLock()
appendFileSync(process.env.PROBE_OUT, process.pid + ' ' + (won ? 'true' : 'false') + '\n')
setTimeout(() => app.exit(0), Number(process.env.PROBE_HOLD_MS))
`

/** How long a launch stays up holding whatever verdict it got. */
const HOLD_MS = 2500

/**
 * How far apart the two launches are, and how many trials each separation gets.
 *
 * ⛔ The last row's gap is longer than {@link HOLD_MS} on purpose — see the note at the top.
 */
const CASES = [
  // ⚠️ Twice `202`'s twelve. Its 3/12 and a first pass of this probe's 5/12 are the same rate
  // inside the noise of twelve trials, and the point of re-measuring is to say something twelve
  // trials could not.
  { label: 'same instant', gapMs: 0, trials: 24 },
  { label: '+50 ms', gapMs: 50, trials: 4 },
  { label: '+200 ms', gapMs: 200, trials: 4 },
  { label: 'after the first exits (control)', gapMs: HOLD_MS + 1500, trials: 2 },
]

function appDir() {
  const dir = mkdtempSync(join(tmpdir(), 'one-app-probe-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'one-app-probe', main: 'main.js' }),
  )
  writeFileSync(join(dir, 'main.js'), PROBE_MAIN)
  return dir
}

/**
 * One trial: two Electrons onto one `--user-data-dir`, both started by one shell.
 *
 * ⚑ The gap is `sleep` INSIDE the shell rather than a second `spawn`, so the non-zero cases differ
 * from the zero case in exactly one thing.
 */
function trial(app, gapMs) {
  const userData = mkdtempSync(join(tmpdir(), 'one-app-probe-ud-'))
  const out = join(userData, '..', `verdicts-${process.pid}-${Math.trunc(performance.now())}.txt`)
  writeFileSync(out, '')
  // ⚑ 695-own-main: this probe's OWN main, which takes the one-app gate and opens no window at all.
  const one = `"${ELECTRON}" "${app}" --user-data-dir="${userData}"`
  const gap = gapMs === 0 ? '' : `sleep ${gapMs / 1000}; `
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', `${one} & ${gap}${one} & wait`], {
      stdio: 'ignore',
      env: {
        ...process.env,
        PROBE_OUT: out,
        PROBE_HOLD_MS: String(HOLD_MS),
        ELECTRON_RUN_AS_NODE: undefined,
      },
    })
    child.on('exit', () => {
      const lines = readFileSync(out, 'utf8').trim().split('\n').filter(Boolean)
      const won = lines.filter((line) => line.endsWith('true')).length
      rmSync(userData, { recursive: true, force: true })
      rmSync(out, { force: true })
      resolve({ launches: lines.length, won })
    })
  })
}

/**
 * ⛔ **The second half: does the BACKSTOP hold where Chromium's lock does not?** (236 §3)
 *
 * ⚑ **The SHIPPED module, compiled out of the repo by esbuild** — `nav-order-probe.mjs`'s rule, and
 * the only thing that makes this evidence about this app rather than about a probe. The unit tests
 * drive `claimSoleHost` twice inside ONE process, which is the one arrangement the mechanism is not
 * about; this drives real processes at each other.
 *
 * ⚠️ **The stale row is the one that matters.** A POSIX socket leaves its path behind, so every
 * launch after the first meets an artefact — and the first version of the gate lost the race there,
 * every time. So the trials are run twice over the same directory: once fresh, and once with the
 * path a finished run left behind.
 */
const GATE_MAIN = String.raw`
import { appendFileSync } from 'node:fs'
import { claimSoleHost } from './gate.mjs'
const verdict = await claimSoleHost(process.env.PROBE_USER_DATA)
appendFileSync(process.env.PROBE_OUT, process.pid + ' ' + verdict + '\n')
setTimeout(() => process.exit(0), Number(process.env.PROBE_HOLD_MS))
`

function gateDir() {
  const dir = mkdtempSync(join(tmpdir(), 'one-app-gate-'))
  execFileSync(
    ESBUILD,
    [GATE, '--bundle', '--format=esm', '--platform=node', `--outfile=${join(dir, 'gate.mjs')}`],
    {
      stdio: 'pipe',
    },
  )
  writeFileSync(join(dir, 'run.mjs'), GATE_MAIN)
  return dir
}

/** One trial: two claims onto one `userData`, both started by one shell. */
function gateTrial(runner, userData) {
  const out = join(userData, `..`, `gate-${process.pid}-${Math.trunc(performance.now())}.txt`)
  writeFileSync(out, '')
  const one = `"${process.execPath}" "${join(runner, 'run.mjs')}"`
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', `${one} & ${one} & wait`], {
      stdio: 'ignore',
      env: {
        ...process.env,
        PROBE_OUT: out,
        PROBE_USER_DATA: userData,
        PROBE_HOLD_MS: String(HOLD_MS),
        ELECTRON_RUN_AS_NODE: undefined,
      },
    })
    child.on('exit', () => {
      const lines = readFileSync(out, 'utf8').trim().split('\n').filter(Boolean)
      rmSync(out, { force: true })
      // ⛔ **`taken` is the ONLY verdict that stands a launch down.** `unknown` runs, by design, so
      // a trial where both said `unknown` is two hosts just as surely as two `sole`s.
      resolve({ claims: lines.length, ran: lines.filter((line) => !line.endsWith('taken')).length })
    })
  })
}

async function gate() {
  const runner = gateDir()
  const rows = []
  try {
    for (const { label, reuse } of [
      { label: 'fresh directory', reuse: false },
      { label: 'after a finished run left its path behind', reuse: true },
    ]) {
      let both = 0
      let none = 0
      let incomplete = 0
      for (let n = 0; n < 12; n += 1) {
        const userData = mkdtempSync(join(tmpdir(), 'one-app-gate-ud-'))
        // ⚑ The stale row makes its own artefact the honest way: by running the real thing once.
        if (reuse) await gateTrial(runner, userData)
        const { claims, ran } = await gateTrial(runner, userData)
        rmSync(userData, { recursive: true, force: true })
        if (claims !== 2) incomplete += 1
        else if (ran === 2) both += 1
        else if (ran === 0) none += 1
        process.stdout.write(ran === 2 ? '!' : claims === 2 ? '.' : '?')
      }
      process.stdout.write('\n')
      rows.push({ label, both, none, incomplete })
    }
  } finally {
    rmSync(runner, { recursive: true, force: true })
  }
  console.log(
    '\n| the gate, two claims at the same instant | trials | BOTH ran | NEITHER ran | incomplete |',
  )
  console.log('|---|---|---|---|---|')
  for (const row of rows) {
    console.log(`| ${row.label} | 12 | ${row.both} / 12 | ${row.none} | ${row.incomplete} |`)
  }
}

async function main() {
  // ⚑ `PROBE_ONLY=gate` runs the backstop half alone. The Electron half takes two minutes and does
  // not change while the gate is being iterated on; re-running it to see one number is waste.
  if (process.env.PROBE_ONLY === 'gate') {
    await gate()
    return
  }
  if (!existsSync(ELECTRON)) {
    console.error(`no electron at ${ELECTRON} — run pnpm install first`)
    process.exit(1)
  }
  const app = appDir()
  const rows = []
  try {
    for (const runCase of CASES) {
      let both = 0
      let neither = 0
      let incomplete = 0
      for (let n = 0; n < runCase.trials; n += 1) {
        const { launches, won } = await trial(app, runCase.gapMs)
        // ⛔ A trial where a launch never reported is not a trial where one lost. Counted apart, so
        // a broken instrument cannot read as a clean result.
        if (launches !== 2) incomplete += 1
        else if (won === 2) both += 1
        else if (won === 0) neither += 1
        process.stdout.write(won === 2 ? '!' : launches === 2 ? '.' : '?')
      }
      process.stdout.write('\n')
      rows.push({ ...runCase, both, neither, incomplete })
    }
  } finally {
    rmSync(app, { recursive: true, force: true })
  }
  console.log('\n| how far apart | trials | BOTH true | NEITHER true | incomplete |')
  console.log('|---|---|---|---|---|')
  for (const row of rows) {
    console.log(
      `| ${row.label} | ${row.trials} | ${row.both} / ${row.trials} | ${row.neither} | ${row.incomplete} |`,
    )
  }
  if (existsSync(ESBUILD)) await gate()
  else console.log('\n(no esbuild — the gate half of this probe was skipped)')
}

mkdirSync(tmpdir(), { recursive: true })
await main()
