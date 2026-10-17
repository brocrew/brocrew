import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { runEvidence, runScratch } from './run-paths'

/**
 * 240 §1 · **What actually survives a Codex teardown, asked of the operating system.**
 *
 * ⛔ **`233` published `SpawnCodexTransport.exited` and stated its own limit: it is the LEADER's
 * exit.** `191` M2 is the standing finding about orphans and `202` refuted its premise for the
 * leader — `0/3` app-servers survived a SIGKILLed parent — while preserving, in the source, the two
 * shapes it had not measured: *"a descendant the app-server itself spawned and left running (a
 * sandboxed command), and an app-server wedged badly enough not to be reading stdin at all."*
 *
 * ⚑ **This measures the first one.** A real leader that spawns a real descendant and then exits
 * cooperatively on stdin EOF, driven through the production `SpawnCodexTransport` — no fake, no
 * mock, and every signal sent by `doReapGroup` itself. Three placements, because the answer is
 * different for each and the difference is the whole finding:
 *
 * | placement | in the leader's process group? | reachable by `kill(-pid)` |
 * |---|---|---|
 * | `in-group` (an ordinary `spawn`) | yes | ⚑ yes |
 * | `escaped` (`detached` → `setsid`) | no — its own session | ⛔ **no, ever** |
 * | `none` | — | the healthy path, and §5's latency control |
 *
 * ## What each row reports
 *
 *  - `exitedMs` — when `transport.exited` settled. The leader's exit, and 233's fact.
 *  - `closeMs` — when `close()` resolved. ⚠️ **The number that changed in this dispatch**: before
 *    240 every grace inside `doReapGroup` raced `this.exited`, which is already settled once the
 *    leader is gone, so SIGTERM and SIGKILL went out microseconds apart and `close()` returned
 *    without ever looking at the group.
 *  - `signals` — what the descendant recorded. An empty list under a stubborn descendant means it
 *    was SIGKILLed before it could run its own SIGTERM handler.
 *  - `aliveAtClose` / `alive1s` — `kill(pid, 0)`, the only instrument in this file that cannot be
 *    talked out of. ⛔ **`aliveAtClose` is the honesty question**: `Launch.settled` promises *"this
 *    launch is over AND everything it created is confirmed down"*.
 *  - `groupAtClose` — `kill(-leaderPid, 0)`: is anything at all left in the group we spawned?
 *
 * 🔒 Only pids this probe spawned are ever signalled, both fixtures hard-exit after 30 s, and every
 * path written is inside this run's scratch directory.
 *
 * Run: `pnpm run probe:orphan-descendant`. Not part of `pnpm run ci`.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures')
const LEADER = join(FIXTURES, 'codex-leader.mjs')

/** Is this pid alive? */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Does the process GROUP led by `pid` still have any member? */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

interface Row {
  readonly placement: string
  readonly mode: string
  readonly leaderPid: number | undefined
  readonly descendantPid: number | undefined
  readonly exitedMs: number
  readonly closeMs: number
  readonly signals: readonly string[]
  readonly cleanedUp: boolean
  readonly aliveAtClose: boolean
  readonly alive1s: boolean
  readonly groupAtClose: boolean
}

async function measure(placement: string, mode: string): Promise<Row> {
  const dir = runScratch(`orphan-${placement}-${mode}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'signals')

  const transport = new SpawnCodexTransport(
    process.execPath,
    [LEADER, log, placement, mode],
    // The real graces. A shorter pair would measure a configuration nobody ships.
    { env: { PATH: process.env['PATH'] ?? '' }, exitGraceMs: 2000, killGraceMs: 2000 },
  )
  const leaderPid = transport.pid
  // ⛔ **Wait for the leader on EVERY row**, including the one with no descendant. The healthy-path
  // number is a teardown measurement, and without this it also contains node's startup — which is
  // most of it (240, own review).
  await waitFor(() => existsSync(`${log}.leader`), 10_000, 'the leader to announce itself')
  let descendantPid: number | undefined
  if (placement !== 'none') {
    await waitFor(() => existsSync(`${log}.pid`), 10_000, 'the descendant to announce its pid')
    descendantPid = Number(readFileSync(`${log}.pid`, 'utf8').trim())
  }

  const t0 = Date.now()
  let exitedMs = -1
  void transport.exited?.then(() => {
    exitedMs = Date.now() - t0
  })
  await transport.close()
  const closeMs = Date.now() - t0
  const aliveAtClose = descendantPid === undefined ? false : isAlive(descendantPid)
  const groupAtClose = leaderPid === undefined ? false : groupAlive(leaderPid)
  await new Promise((r) => setTimeout(r, 1000))
  const alive1s = descendantPid === undefined ? false : isAlive(descendantPid)

  const signals = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((s) => s.length > 0)
    : []
  const cleanedUp = existsSync(`${log}.cleaned`)

  // 🔒 Leave nothing behind, whatever the measurement said.
  if (descendantPid !== undefined && isAlive(descendantPid)) {
    try {
      process.kill(descendantPid, 'SIGKILL')
    } catch {
      // it died between the check and the signal
    }
  }

  return {
    placement,
    mode,
    leaderPid,
    descendantPid,
    exitedMs,
    closeMs,
    signals,
    cleanedUp,
    aliveAtClose,
    alive1s,
    groupAtClose,
  }
}

/**
 * ⛔ **The instrument, before anything is measured with it** (240).
 *
 * Everything in the next test — and the `awaitGroupQuiet` this dispatch puts inside `doReapGroup` —
 * reads `kill(-leaderPid, 0)` as *"something in the group we spawned is still running"*. ⚠️ **The
 * first version of this control took that reading while the LEADER was still alive**, and it came
 * back `true` for a tree with no descendant at all: the leader is a member of its own group, so the
 * question was answering about the leader and nothing else. That is a positive control that cannot
 * fail, which is the same as no control.
 *
 * So the reading has to be taken in the one state the fix depends on: **the leader exited, a
 * descendant did not.** POSIX keeps a process group alive while any member is in it, and the group
 * id is the dead leader's pid — but that is a claim about the OS, and this asks it.
 */
it('240 §1 · kill(-pgid, 0) still sees the group after the leader is gone', async () => {
  const dir = runScratch('orphan-instrument')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'signals')

  const { spawn } = await import('node:child_process')
  const leader = spawn(process.execPath, [LEADER, log, 'in-group', 'stubborn'], {
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
  })
  const leaderPid = leader.pid!
  await waitFor(() => existsSync(`${log}.pid`), 10_000, 'the descendant to announce its pid')
  const descendantPid = Number(readFileSync(`${log}.pid`, 'utf8').trim())

  const leaderGone = new Promise<void>((resolve) => leader.once('exit', () => resolve()))
  leader.stdin.end()
  await leaderGone

  const readings = {
    leaderAlive: isAlive(leaderPid),
    descendantAlive: isAlive(descendantPid),
    groupAlive: groupAlive(leaderPid),
  }
  console.log(`\n240 §1 · instrument · after the leader exited: ${JSON.stringify(readings)}`)

  // ⚑ The whole point: the leader is gone, the descendant is not, and the GROUP still answers.
  expect(
    readings.descendantAlive,
    'the descendant must outlive the leader for this to mean anything',
  ).toBe(true)
  expect(
    readings.groupAlive,
    'kill(-pgid, 0) cannot see a descendant whose group leader has exited — the fix would be blind',
  ).toBe(true)

  // …and it goes false when, and only when, the last member dies. Without this the reading above
  // could be a constant.
  process.kill(descendantPid, 'SIGKILL')
  await waitFor(() => !groupAlive(leaderPid), 5_000, 'the group to empty once its last member dies')
  expect(groupAlive(leaderPid), 'an empty group must read as empty').toBe(false)
})

it('240 §1 · a leader that exits and a descendant that does not', async () => {
  const rows: Row[] = []
  // The healthy path first, so its latency is measured on an unloaded machine (§5).
  rows.push(await measure('none', 'stubborn'))
  rows.push(await measure('in-group', 'stubborn'))
  rows.push(await measure('in-group', 'slow-clean'))
  rows.push(await measure('in-group', 'cooperative'))
  rows.push(await measure('escaped', 'stubborn'))

  const table = rows
    .map(
      (r) =>
        `${r.placement.padEnd(9)} ${r.mode.padEnd(12)} exited=${String(r.exitedMs).padStart(5)}ms ` +
        `close=${String(r.closeMs).padStart(5)}ms signals=[${r.signals.join(',')}] ` +
        `cleaned=${r.cleanedUp} aliveAtClose=${r.aliveAtClose} alive+1s=${r.alive1s} ` +
        `groupAtClose=${r.groupAtClose}`,
    )
    .join('\n')
  console.log(`\n240 §1 · what survives a Codex teardown\n${table}\n`)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(runEvidence('240-orphan-descendant.txt'), `${table}\n`)

  const byKey = (placement: string, mode: string): Row =>
    rows.find((r) => r.placement === placement && r.mode === mode)!

  // ⚑ **The control that makes the rest a measurement.** A cooperative descendant dies, so the
  // instrument can see a death; without this row "nothing survived" would be unfalsifiable.
  expect(byKey('in-group', 'cooperative').alive1s, 'a cooperative descendant must be gone').toBe(
    false,
  )

  // ⛔ **The group kill covers what is IN the group.** Both stubborn and slow-clean must be gone.
  expect(byKey('in-group', 'stubborn').alive1s, 'an in-group descendant must not survive').toBe(
    false,
  )
  expect(byKey('in-group', 'slow-clean').alive1s, 'an in-group descendant must not survive').toBe(
    false,
  )

  // ⛔ **`close()` resolving must mean the group is empty** (240 §1). Before this dispatch every
  // grace raced the leader's already-settled exit, so this was a coin flip.
  for (const row of rows.filter((r) => r.placement === 'in-group')) {
    expect(row.aliveAtClose, `${row.mode}: alive when close() resolved`).toBe(false)
    expect(row.groupAtClose, `${row.mode}: the group still had a member at close()`).toBe(false)
  }

  // ⚑ **A real grace between SIGTERM and SIGKILL, proven by a marker a SIGKILLed process could
  // not have written.**
  expect(
    byKey('in-group', 'slow-clean').cleanedUp,
    'the descendant never got to finish its own shutdown',
  ).toBe(true)

  // ⛔ **And the honest limit, measured rather than assumed**: a descendant that called `setsid`
  // is in nobody's group but its own, `kill(-leaderPid)` cannot reach it, and it survives.
  expect(
    byKey('escaped', 'stubborn').signals,
    'an escaped descendant must receive nothing from the group kill',
  ).toEqual([])
  expect(
    byKey('escaped', 'stubborn').alive1s,
    'an escaped descendant survives — that is the point',
  ).toBe(true)
}, 180_000)
