import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { withProviderHomeLock } from '../src/index'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 243 · **How long does a contended provisioning lock stop the thread that asked for it?**
 *
 * ⛔ **The defect was written down in this repo twice, and neither note carried a number.** At
 * `3e8adea`, `provider-home.ts` said *"Atomics.wait on an un-notified location — Node main thread
 * OK"*, and `codex/home-boot.ts` said the cross-process lock *"is synchronous … so the honest
 * position is a narrower guard"* — which is why `180` built a second, in-process gate rather than
 * use the real one. ⚠️ **"OK" is true of a Node CLI and false of Electron**, where that thread is
 * the main process and also the one that pumps the window. ⚑ **Both sentences are gone as of 243**;
 * they are quoted here at their commit so this probe still says what it was built to measure.
 *
 * ## ⛔ The instrument: a timer, not a promise
 *
 * A promise resolving proves nothing about a thread — `Atomics.wait` blocks the thread and every
 * promise resolves afterwards, on time, looking healthy. So the observation is a `setInterval` armed
 * **before** the acquisition and read after it: how many times could the thread run anything while it
 * was waiting, and what is the longest it went without running at all?
 *
 * | column | what `maxGapMs` should read |
 * |---|---|
 * | before 243 (`Atomics.wait`) | ≈ the whole wait — the thread ran nothing |
 * | after 243 (`await`) | ≈ {@link TICK_MS} — the wait costs the thread nothing |
 *
 * ⚑ **`maxGapMs` is the number to quote**, not the tick count: it is the answer to *"how long is the
 * app frozen"* in the unit a person would notice.
 *
 * ## ⛔ Five rows, and the first two are the controls
 *
 *  - `idle` — tick beside a holder and **never ask for the lock**. ⚑ **The positive control.** An
 *    instrument that reported "blocked" here would be measuring its own overhead; 240's lesson was a
 *    control that could not fail, and this is the one that makes the others mean something.
 *  - `uncontended` — nobody holds it. §4's latency requirement: the fast path must not get slower.
 *  - `contended-500` / `contended-2000` — a **real second process** holds the lock for that long.
 *  - `contended-timeout` — the holder outlives our `timeoutMs`, so the acquisition ends in the
 *    honest throw. ⚠️ **The failing path has to be unblocked too**; before 243 this is the worst
 *    case in the product — `LOCK_TIMEOUT_MS` is 10 s, and that is 10 s of frozen window.
 *
 * 🔒 One temp home per row inside this run's scratch, a holder that lets go on its own clock, and
 * only pids this probe spawned are ever signalled.
 *
 * ## ⛔ 669 · one outer deadline, derived from the waits below
 *
 * ⚠️ **Until `669` this file had no bound but vitest's own per-test default** (`655` §4), which frees
 * the awaiter and not the holder a row spawned. ⚑ It now runs inside `smoke/probe-run-deadline.ts`:
 * the budget is {@link ROWS}' own waits summed by `runBudgetMs`, every row refuses to START past the
 * deadline and refuses again once its holder is in, and each row OWNS the holder it spawns before it
 * spawns it — so an expiry kills that holder and waits for it before the run is rejected.
 *
 * Run: `pnpm run probe:main-thread-block`. Not part of `pnpm run ci`.
 */

const CONTENDER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'fixtures',
  'lock-contender.mjs',
)

/** Type stripping is experimental and says so on stderr; the fixture's stderr is for real failures. */
const QUIET = '--disable-warning=ExperimentalWarning'

/**
 * How often the observer asks to run. ⚠️ **Not a poll of the lock** — it is the app's stand-in: any
 * timer, animation frame or IPC reply the main process owes somebody while it waits. 10 ms is well
 * under a frame and far enough above libuv's resolution that an idle gap of ~11 ms is signal.
 */
const TICK_MS = 10

/** The lock's own poll interval, pinned so both columns wait on the same cadence. */
const POLL_MS = 25

/** How long a holder may take to announce it holds the lock — the backstop for a fixture that wedged. */
const HOLDER_READY_MS = 30_000
/** How long a holder may take to let go and exit after its hold — the same backstop, the other end. */
const HOLDER_EXIT_MS = 30_000
/** ⚑ The owned teardown: SIGKILL to a holder THIS probe spawned, and a bounded wait for its exit. */
const KILL_GRACE_MS = 2_000
const TEARDOWN_MS = KILL_GRACE_MS

interface RowPlan {
  /** How long the holder holds the lock; `0` spawns no holder at all. */
  readonly holdMs: number
  readonly acquire: boolean
  /** The acquisition's own bound, which is `withProviderHomeLock`'s `timeoutMs`. */
  readonly timeoutMs: number
}

/**
 * ⛔ **The five rows, as one table the budget is counted from** — so a row the budget does not count
 * cannot be measured. ⚑ The first two are the controls; see this file's docblock.
 */
const ROWS = [
  ['idle', { holdMs: 1_500, acquire: false, timeoutMs: 0 }],
  ['uncontended', { holdMs: 0, acquire: true, timeoutMs: 10_000 }],
  ['contended-500', { holdMs: 500, acquire: true, timeoutMs: 10_000 }],
  ['contended-2000', { holdMs: 2_000, acquire: true, timeoutMs: 10_000 }],
  ['contended-timeout', { holdMs: 3_000, acquire: true, timeoutMs: 1_000 }],
] as const satisfies readonly (readonly [string, RowPlan])[]

/**
 * One row's worst case, wait by wait: the holder announcing itself, the acquisition (or the control's
 * idle observation, which lasts as long as the hold), the holder exiting, and the owned teardown.
 */
function serialWaitsMs(plan: RowPlan): number[] {
  const held = plan.holdMs > 0
  return [
    ...(held ? [HOLDER_READY_MS] : []),
    plan.acquire ? plan.timeoutMs : plan.holdMs,
    ...(held ? [HOLDER_EXIT_MS] : []),
    TEARDOWN_MS,
  ]
}

const deadline = probeRunDeadline(
  '243 main-thread-block probe',
  runBudgetMs(ROWS.flatMap(([, plan]) => serialWaitsMs(plan))),
  TEARDOWN_MS,
)

interface Row {
  readonly label: string
  readonly holdMs: number
  readonly waitMs: number
  readonly ticks: number
  readonly ticksExpected: number
  readonly maxGapMs: number
  readonly acquired: boolean
  readonly error: string | null
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** The longest run of wall-clock in `[t0, t1]` during which the thread executed nothing. */
function maxGap(t0: number, marks: readonly number[], t1: number): number {
  let worst = 0
  let previous = t0
  for (const mark of marks) {
    worst = Math.max(worst, mark - previous)
    previous = mark
  }
  return Math.max(worst, t1 - previous)
}

interface Holder {
  readonly child: ChildProcess
  readonly said: () => string
  readonly wrote: () => string
}

/**
 * A real second process holding the real lock on the real home — spawned here, and waited on by
 * {@link holderIsIn}.
 *
 * ⚠️ **Two halves, so ownership can come between them**: the row owns the child the moment it exists,
 * which is before it holds anything, and an expiry that lands while it is still taking the lock kills
 * it rather than leaving a holder behind.
 */
function spawnHolder(home: string, readyPath: string, holdMs: number): Holder {
  const child = spawn(
    process.execPath,
    [QUIET, CONTENDER, 'hold-ms', home, readyPath, String(holdMs)],
    {
      env: process.env,
    },
  )
  let out = ''
  let err = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => (out += chunk))
  child.stderr?.on('data', (chunk: string) => (err += chunk))
  return { child, said: () => out, wrote: () => err }
}

/**
 * ⛔ **Its own report is captured and used in the failure path** (review). A fixture that cannot take
 * the lock says exactly why — `{entered:false, error:"timed out acquiring provisioning lock…"}` — and
 * a version of this that only waited on the ready file spun the full 30 s and then threw *"timed out
 * waiting for the holder"*, discarding the one line that explained it. `stderr` is captured for the
 * same reason: a fixture that dies on import writes nothing to stdout at all.
 */
async function holderIsIn(holder: Holder, readyPath: string): Promise<void> {
  try {
    await waitFor(() => existsSync(readyPath), HOLDER_READY_MS, 'the holder to take the lock')
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} — it said ` +
        `${JSON.stringify(holder.said())} and wrote ${JSON.stringify(holder.wrote())} to stderr`,
      { cause: error },
    )
  }
}

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null

async function measure(label: string, plan: RowPlan): Promise<Row> {
  deadline.refuse(`starting row ${label}`)
  const dir = runScratch(`mainthread-${label}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const ready = join(dir, 'held')

  let holder: Holder | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  /**
   * ⛔ **Owned BEFORE anything exists, and closes whatever is open EACH time it is called** — the
   * template's reason (`649` F6): an expiry that lands before the holder is spawned finds nothing,
   * so this `finally` must still be able to stop what was made after it.
   */
  const closeOwnedRow = async (): Promise<void> => {
    if (ticker !== null) clearInterval(ticker)
    const child = holder?.child ?? null
    if (child === null || hasExited(child)) return
    child.kill('SIGKILL')
    await waitFor(() => hasExited(child), KILL_GRACE_MS, 'the killed holder to exit').catch(
      () => {},
    )
  }
  const release = deadline.own(() => closeOwnedRow())

  try {
    if (plan.holdMs > 0) {
      const spawned = spawnHolder(home, ready, plan.holdMs)
      holder = spawned
      await holderIsIn(spawned, ready)
      deadline.refuse(`row ${label} · the holder holds the lock`)
    }

    // ⚑ **Armed after the holder is in.** Every gap recorded below therefore belongs to OUR wait and
    // not to the spawn of somebody else's process.
    const marks: number[] = []
    ticker = setInterval(() => marks.push(Date.now()), TICK_MS)
    let acquired = false
    let error: string | null = null
    const t0 = Date.now()
    if (plan.acquire) {
      try {
        await withProviderHomeLock(home, () => (acquired = true), {
          timeoutMs: plan.timeoutMs,
          pollMs: POLL_MS,
        })
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown)
      }
    } else {
      // The control: the same wall-clock, spent not asking for the lock.
      await new Promise((r) => setTimeout(r, plan.holdMs))
    }
    const t1 = Date.now()
    clearInterval(ticker)

    const held = holder
    if (held !== null) {
      // It lets go on its own clock; this is only the backstop against a fixture that wedged, and
      // the owned teardown in the `finally` kills it if the backstop ran out.
      await waitFor(() => hasExited(held.child), HOLDER_EXIT_MS, 'the holder to exit').catch(
        () => {},
      )
    }

    const inWindow = marks.filter((m) => m >= t0 && m <= t1)
    const waitMs = t1 - t0
    return {
      label,
      holdMs: plan.holdMs,
      waitMs,
      ticks: inWindow.length,
      ticksExpected: Math.floor(waitMs / TICK_MS),
      maxGapMs: maxGap(t0, inWindow, t1),
      acquired,
      error,
    }
  } finally {
    try {
      await closeOwnedRow()
    } finally {
      release()
    }
  }
}

async function measureFiveRows(): Promise<void> {
  const rows: Row[] = []
  // ⚑ Spread from `ROWS`, so a row the budget does not count cannot be measured.
  for (const [label, plan] of ROWS) rows.push(await measure(label, plan))

  const report = [
    '=== 243 · main-thread block during a contended provisioning lock ===',
    `tick ${TICK_MS} ms · lock poll ${POLL_MS} ms · node ${process.version}`,
    '',
    'row                | holdMs |  waitMs | ticks/expected | maxGapMs | got in | ended',
    ...rows.map(
      (r) =>
        `${r.label.padEnd(18)} | ${String(r.holdMs).padStart(6)} | ${String(r.waitMs).padStart(7)} | ` +
        `${`${r.ticks}/${r.ticksExpected}`.padStart(14)} | ${String(r.maxGapMs).padStart(8)} | ` +
        `${String(r.acquired).padEnd(6)} | ${r.error ?? 'ok'}`,
    ),
    '',
    '⚑ maxGapMs is the answer to "how long is the window frozen".',
  ].join('\n')
  console.log(report)
  writeFileSync(runEvidence('243-main-thread-block.txt'), `${report}\n`)

  const by = (label: string): Row => rows.find((r) => r.label === label) as Row

  // ⛔ **The positive control, first.** If the observer cannot record a healthy thread it cannot
  // report an unhealthy one, and every number below would be its own overhead.
  expect(by('idle').maxGapMs, 'an unobstructed thread ticks on time').toBeLessThan(TICK_MS * 5)
  expect(by('idle').ticks, 'the observer really ran').toBeGreaterThan(100)

  // §4's latency requirement: an uncontended acquisition is a create and a write.
  expect(by('uncontended').acquired).toBe(true)
  expect(by('uncontended').waitMs, 'the fast path is syscalls, not waiting').toBeLessThan(100)

  // The measurement this probe exists for.
  for (const label of ['contended-500', 'contended-2000']) {
    const row = by(label)
    expect(row.acquired, `${label} eventually got in`).toBe(true)
    expect(row.waitMs, `${label} really did wait for the holder`).toBeGreaterThanOrEqual(
      row.holdMs - 100,
    )
    expect(row.maxGapMs, `${label}: the thread kept running while it waited`).toBeLessThan(
      TICK_MS * 10,
    )
  }

  // ⚠️ The failing path is a wait too, and before 243 it was the longest one in the product.
  const timedOut = by('contended-timeout')
  expect(timedOut.acquired, 'the holder outlived our budget').toBe(false)
  expect(timedOut.error, 'and the refusal is the same honest one').toMatch(
    /timed out acquiring provisioning lock/,
  )
  expect(
    timedOut.maxGapMs,
    'a wait that ends in a throw does not freeze the thread either',
  ).toBeLessThan(TICK_MS * 10)
}

it(
  '243 · what the thread could do while it waited for a contended provisioning lock — probe',
  () => deadline.within('measuring the five rows', measureFiveRows),
  deadline.testTimeoutMs,
)
