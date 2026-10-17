#!/usr/bin/env node
/**
 * Run the agent-interaction lifecycle through delegation, permission, question, resource
 * reply, restart and final delivery, with bounded prompts and isolated state.
 *
 *   pnpm run runner:lifecycle
 *   BROBOT_LIFECYCLE_PROVIDER=claude pnpm run runner:lifecycle
 *
 * Begin at the first give; this app has no project-creation operation. `LIFECYCLE_STEPS`
 * enumerates all report rows. Launch the stage in its own detached process group, wait for
 * open work, kill the group and restart over the same userData. Recovery derives state from
 * the ledger. Only the runner can report the kill outcome, not the killed stage.
 *
 * Use the run directory under `/private/tmp/brobot2-lifecycle/<run>` without a window,
 * CDP or debugging port. The app provisions this run's provider homes; Codex still requires
 * its copy-once `provisionCodexAuth` path to obtain a credential.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beginSmokeRun, smokeTmpRoot } from './lib/smoke-run.mjs'
import {
  LIFECYCLE_BUDGET_MS,
  LIFECYCLE_STEPS,
  STEP_MS,
  lifecycleTable,
} from './lib/lifecycle-steps.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PROVIDER = process.env.BROBOT_LIFECYCLE_PROVIDER ?? 'codex'
const MODEL = process.env.BROBOT_LIFECYCLE_MODEL ?? ''

const { evidence: ROOT, runId: RUN_ID } = beginSmokeRun({
  evidenceRoot: smokeTmpRoot('brobot2-lifecycle'),
  scratchRoot: join(homedir(), 'brobot2-scratch', 'lifecycle'),
  keep: 5,
})

/**
 * ⛔ **The probe lock the STAGE takes, which a `SIGKILL` cannot release** (`smoke-run.mjs`: *"a
 * leftover lock from a killed run"*).
 *
 * `vitest.smoke.config.ts`'s globalSetup claims `<probe root>/.lock` and releases it on `exit`;
 * phase `a` is killed, so it never runs that handler and phase `b` would refuse to start. ⚠️ **Only
 * a lock this run's own killed pid owns is removed**, read out of the lock's own `owner` file — the
 * one case the module's error message says is safe to clear, and never anybody else's run.
 */
const PROBE_LOCK = join(smokeTmpRoot('brobot2-probe-runs'), '.lock')

/**
 * 🔴 **§13 · the phase bounds, DERIVED from the stage's own per-step bounds** (410 §5).
 *
 * ⛔ **Each of these used to be a fifty-minute literal, written twice** — one wait covering the whole
 * first half of the diagram. ⚠️ Two things were wrong with that and only one of them is the size.
 * **A phase bound cannot name the step that failed to happen**, so a chain that died at row 3 and a
 * chain that was merely slow exited identically; and the stage's own waits summed to MORE than the
 * bound, so a healthy-but-slow run was guillotined at minute fifty and reported `NOT REACHED` — a
 * table computed from this process's patience rather than from the outcome.
 *
 * ⚑ **Now the steps are bounded and this is the backstop**: the sum of every wait phase `a` can make,
 * plus a margin for two process starts, the migrations and the provider handshakes, which are not
 * steps. ⛔ **Reaching it is a finding about the run** — it means the stage stopped spending its own
 * bounds — and never a reason to wait longer.
 */
const PHASE_A_MS = LIFECYCLE_BUDGET_MS.phaseA + LIFECYCLE_BUDGET_MS.margin
const PHASE_B_MS = LIFECYCLE_BUDGET_MS.phaseB + LIFECYCLE_BUDGET_MS.margin
const minutes = (ms) => `${String(Math.round(ms / 60_000))}m`

const journalPath = join(ROOT, 'journal.jsonl')
const say = (line) => process.stdout.write(`${line}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Append one observation THIS process made. See the docblock: row 12 is the only one. */
function note(step, verdict, what) {
  const line = `${JSON.stringify({ step, verdict, what })}\n`
  writeFileSync(journalPath, line, { flag: 'a' })
  say(`${verdict.padEnd(13)} ${step} — ${what}`)
}

function readJournal() {
  if (!existsSync(journalPath)) return []
  return readFileSync(journalPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

/** Whether a process group still has a live leader. `ESRCH` is the answer this asks for. */
function groupIsGone(pid) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error?.code === 'ESRCH'
  }
}

/**
 * Start one stage, detached so it leads its own process group.
 *
 * ⚠️ **Inherited stdio, never a pipe** — this process kills that one, and a pipe's last buffered
 * lines go with it. ⛔ **The stage's JOURNAL is the evidence and the console is not**: every line the
 * table is computed from is `appendFileSync`d before it is printed, so a killed stage loses nothing
 * a row depends on.
 */
function startStage(phase) {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.smoke.config.ts',
      'apps/desktop/smoke/lifecycle-stage.smoke.ts',
    ],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        BROBOT_LIFECYCLE_ROOT: ROOT,
        BROBOT_LIFECYCLE_PHASE: phase,
        BROBOT_LIFECYCLE_PROVIDER: PROVIDER,
        // ⛔ **The bounds travel from HERE, so the number stated up front and the number the stage
        // spends are one value** (410 §5). ⚠️ A second copy of this table in the stage would be a
        // budget a reader could not check against the run that obeyed it; the stage refuses to run
        // without it rather than falling back to a literal of its own.
        BROBOT_LIFECYCLE_STEP_MS: JSON.stringify(STEP_MS),
        ...(MODEL === '' ? {} : { BROBOT_LIFECYCLE_MODEL: MODEL }),
      },
    },
  )
  if (child.pid !== undefined) started.add(child.pid)
  say(`   stage ${phase} · pid ${String(child.pid)}`)
  return child
}

/**
 * ⛔ **Every stage group this run has started, so nothing outlives the runner** (066's reaper, one
 * instrument over).
 *
 * ⚠️ **Found by leaving one behind.** A stage killed with `pkill -f lifecycle` misses the vitest FORK
 * — its argv names no file — and that fork is reparented to init still holding three live provider
 * children. ⚑ The group is the only handle that reaches all of them, which is why the stage is
 * spawned detached in the first place, and this is what makes an interrupted runner reap it too.
 */
const started = new Set()

process.on('exit', () => {
  for (const pid of started) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
})

/** Kill a whole process group and wait for the leader to be gone. Escalating, and verified. */
async function killGroup(pid) {
  for (const signal of ['SIGKILL', 'SIGKILL', 'SIGKILL']) {
    try {
      process.kill(-pid, signal)
    } catch {
      // already gone
    }
    for (let i = 0; i < 40; i++) {
      if (groupIsGone(pid)) {
        started.delete(pid)
        return true
      }
      await sleep(250)
    }
  }
  return groupIsGone(pid)
}

/**
 * ⛔ **Release the probe lock ONLY when its owner file names the pid this run just killed.**
 *
 * ⚠️ Any other owner is somebody else's run and is left exactly alone — the failure mode this guards
 * is a runner that clears a live run's lock and lets two live suites into one set of provider homes,
 * which is the incident `196` H4 exists to prevent.
 */
function releaseTheKilledLock() {
  const ownerFile = join(PROBE_LOCK, 'owner')
  if (!existsSync(ownerFile)) return 'no lock to release'
  const owner = readFileSync(ownerFile, 'utf8').trim()
  // The globalSetup writes `pid <n> · run <id>`; the pid is vitest's, a child of the group leader.
  const named = /pid (\d+)/.exec(owner)
  const holder = named === null ? null : Number(named[1])
  if (holder === null) return `left alone: owner file says ${JSON.stringify(owner)}`
  if (!groupIsGone(holder)) return `left alone: pid ${String(holder)} is still alive`
  rmSync(PROBE_LOCK, { recursive: true, force: true })
  return `released the lock left by the killed run (${owner})`
}

/** Wait for the stage to exit on its own. Returns its exit code, or `null` if the bound elapsed. */
function waitForExit(child, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

function printTable(table) {
  const width = Math.max(...LIFECYCLE_STEPS.map((step) => step.id.length))
  say('')
  say(`${'step'.padEnd(width)}  verdict        what this row is evidence for`)
  say(`${'-'.repeat(width)}  -------------  ${'-'.repeat(60)}`)
  for (const row of [...table.rows, ...table.extra]) {
    say(`${row.id.padEnd(width)}  ${row.verdict.padEnd(13)}  ${row.proves}`)
    say(`${' '.repeat(width)}  ${' '.repeat(13)}  · ${row.what}`)
  }
  say('')
}

async function main() {
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(journalPath, '')
  say(`run ${RUN_ID} · provider ${PROVIDER} · root ${ROOT}`)
  // ⛔ **§13: *"a live runner states its own total budget up front"*** — before the first process
  // starts, computed from the same table the stage spends, so the number a reader is given and the
  // number the instrument obeys cannot drift apart.
  say(
    `budget · phase a ${minutes(PHASE_A_MS)} · phase b ${minutes(PHASE_B_MS)} · ` +
      `total ${minutes(PHASE_A_MS + PHASE_B_MS)} — a step past its own deadline is NOT PERFORMED`,
  )
  say('')

  // ── phase a, and the kill ──────────────────────────────────────────────────────────────────
  const killSignal = join(ROOT, 'kill-now')
  rmSync(killSignal, { force: true })
  const first = startStage('a')
  let exited = null
  const deadline = Date.now() + PHASE_A_MS
  while (Date.now() < deadline && !existsSync(killSignal)) {
    if (first.exitCode !== null) {
      exited = first.exitCode
      break
    }
    await sleep(1_000)
  }

  if (!existsSync(killSignal)) {
    note(
      '12 the app is killed while that work is open',
      'NOT REACHED',
      exited === null
        ? `phase a never reached a point where a piece was open — nothing was killed ` +
            `(phase bound ${minutes(PHASE_A_MS)} elapsed; the stage stopped spending its step bounds)`
        : `phase a exited with code ${String(exited)} before any piece was open`,
    )
    await killGroup(first.pid)
  } else {
    // ⛔ **The stage declares WHAT it was killed inside, and this row may not soften it.** `working`
    // is a conversation driving a piece; anything else is a piece nobody was driving, and killing
    // the app over one of those exercises nothing the ledger did not already say. ⚑ Row 11b makes
    // the same distinction on the same three lines — the piece's label, the conversation and its
    // state — so the two cannot disagree.
    const declared = readFileSync(killSignal, 'utf8').trim().split('\n')
    const wasAlive = !groupIsGone(first.pid)
    const gone = await killGroup(first.pid)
    const midTurn = declared[2] === 'working'
    note(
      '12 the app is killed while that work is open',
      !wasAlive || !gone ? 'FAIL' : midTurn ? 'PASS' : 'NOT PERFORMED',
      declared[0] === 'no-open-piece'
        ? `nothing was open to be killed inside (${declared[1] ?? ''}); the group was ${gone ? 'killed anyway' : 'NOT killed'}`
        : `SIGKILL to group ${String(first.pid)} while ${declared[0]} was ` +
            `${declared[2] ?? 'open'} on ${declared[1] ?? '?'} — alive before ${String(wasAlive)}, ` +
            `gone after ${String(gone)}`,
    )
  }
  say(`   ${releaseTheKilledLock()}`)

  // ── phase b ────────────────────────────────────────────────────────────────────────────────
  const second = startStage('b')
  const code = await waitForExit(second, PHASE_B_MS)
  if (code === null) {
    note(
      'the runner',
      'FAIL',
      `phase b never exited inside ${minutes(PHASE_B_MS)}; the group was killed`,
    )
    await killGroup(second.pid)
  }

  // ── the report, computed from the journal and from nothing else ────────────────────────────
  const journal = readJournal()
  const table = lifecycleTable(journal)
  printTable(table)
  say(
    `${String(table.passed)}/${String(table.total)} performed · ` +
      `${String(table.failed)} FAILED · ${String(table.notPerformed)} NOT PERFORMED · ` +
      `${String(table.notReached)} NOT REACHED · provider ${PROVIDER}`,
  )
  // ⛔ **One line, and it is only printed when every row passed.** §3.3: *"a preview and a partial
  // run must not be able to print a success line."* There is no other place in this file that says
  // the loop was performed.
  if (table.complete) say(`✔ the lifecycle was performed end to end on ${PROVIDER}`)
  say(`evidence in ${ROOT}`)
  process.exitCode = table.complete ? 0 : 1
}
await main()
