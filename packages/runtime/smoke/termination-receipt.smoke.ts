import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { runEvidence, runScratch } from './run-paths'

/**
 * 233 · **Does `close()` resolving mean the CLI child is gone?**
 *
 * ⛔ **229 H1 says no, and this asks the operating system instead of the SDK.** The claim is that
 * `ClaudeSessionHandle.close()` is a bound wearing a receipt's clothes: it awaits
 * `withTimeout(query.return(), 5 s)` over an SDK `performCleanup()` whose last act is
 * `Promise.race([transport.waitForExit(), 2000 ms])`, while that same transport has just scheduled
 * SIGTERM at ~2 s and SIGKILL ~5 s after that — **both `unref`'d**. So there is a window in which
 * the SDK reports cleanup complete and the child is alive, between TERM and KILL.
 *
 * ⚠️ **Read off `kill(pid, 0)`, never off a promise.** 202 measured this by walking our own process
 * tree because the app owned no pid; since 233 it owns one (`Options.spawnClaudeCodeProcess`), so
 * the instrument is the pid itself and attribution is not a guess.
 *
 * ## What it measures
 *
 * **A · the healthy path, real CLI, real login** — the §5 requirement that an ordinary quit did not
 * get slower. Three numbers from one teardown:
 *
 *  - `closeMs` — `handle.close()`, the adapter's own bound. Unchanged code; the control.
 *  - `factMs` — when the exit FACT settled, from the same t0.
 *  - `bothMs` — `Promise.all([close, fact])`, which is what `RuntimeHost.doStopProvider` now waits
 *    on. **`bothMs - closeMs` is the latency this dispatch added**, and it is the number to report.
 *
 * **B · the wedged child, and it is a REAL process** — a shim that traps SIGTERM, spawned through
 * the same `spawnClaudeCodeProcess` seam the SDK uses, so every layer above it is production code.
 * The claim under test is the one the unit tests can only assert: `close()` RESOLVES, the pid is
 * provably alive at that moment, and the fact has not settled. Then SIGKILL lands (the SDK's own,
 * ~5 s later) and the fact settles — so the promise is watching the process and not a clock.
 *
 * 🔒 Temp home, temp cwd, and **only pids this probe spawned are ever signalled** — the shim's pid
 * comes back from our own `spawn`, never from `pgrep`.
 *
 * Run: `pnpm run probe:termination-receipt`. Not part of `pnpm run ci`.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/** Is this pid alive? The only instrument in this file that cannot be talked out of. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** The exit fact, asserted to exist — its absence would be read by the host as "cannot say". */
function exitFactOf(handle: SessionHandle): Promise<void> {
  const fact = handle.awaitProcessExit?.()
  expect(fact, 'the Claude handle must publish a termination fact (233)').toBeDefined()
  return fact as Promise<void>
}

it('A · a healthy close, and what waiting for the FACT costs on top of it — probe', async () => {
  const scratch = runScratch(`termination-healthy-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  const managedRoot = runScratch('homes')
  const providerHome = join(managedRoot, `claude-term-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({ cwd: scratch, providerHome, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  // A real turn, so this is a real session's teardown rather than a bare spawn's.
  await handle.send('Reply with the single word: ready.')
  await waitFor(() => events.some((e) => e.type === 'turn'), 120_000, 'a completed turn')

  const pid = handle.providerPid
  // ⚑ **The anti-vacuity line for the whole file.** 076 recorded `providerPid` as a Claude gap;
  // if it were still absent, every "the child is gone" assertion below would pass over nothing.
  expect(pid, 'this app owns the CLI child since 233').toBeGreaterThan(0)
  expect(isAlive(pid as number), 'the CLI really is running').toBe(true)

  const fact = exitFactOf(handle)
  const t0 = Date.now()
  let factMs = -1
  void fact.then(() => (factMs = Date.now() - t0))

  await handle.close()
  const closeMs = Date.now() - t0
  const aliveAtClose = isAlive(pid as number)

  await Promise.all([fact])
  const bothMs = Date.now() - t0

  const report = [
    '=== 233 A · healthy teardown, real CLI ===',
    `pid                        : ${pid}`,
    `close() returned in        : ${closeMs} ms`,
    `the exit FACT settled in   : ${factMs} ms`,
    `Promise.all([close, fact]) : ${bothMs} ms   <- what doStopProvider now waits on`,
    `ADDED by 233               : ${bothMs - closeMs} ms`,
    `child alive when close()   : ${aliveAtClose}`,
    `child alive at the end     : ${isAlive(pid as number)}`,
  ].join('\n')
  console.log(report)
  writeFileSync(runEvidence('233-healthy.txt'), `${report}\n`)

  // The fact settled, and the OS agrees.
  expect(factMs).toBeGreaterThanOrEqual(0)
  expect(isAlive(pid as number), 'the CLI is gone').toBe(false)
  // ⛔ **§5: an ordinary quit must not get slower.** The adapter already awaits the SDK's exit
  // receipt (202), so on the healthy path the child is gone by the time `close()` returns and
  // there is nothing left to wait for. A second of slack, not zero, because this is a real
  // process on a shared machine and a bound that flakes teaches nobody anything.
  expect(bothMs - closeMs, 'waiting for the fact must not slow a healthy quit').toBeLessThan(1_000)

  await consumer
}, 300_000)

it('B · a child that ignores the close: close() resolves, the pid does not — probe', async () => {
  const scratch = runScratch(`termination-wedged-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  const managedRoot = runScratch('homes')
  const providerHome = join(managedRoot, `claude-wedge-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  // ⛔ **A real process that traps SIGTERM**, spawned through the very seam the SDK spawns through,
  // so `ProcessTransport`, `Query.return()`, the witness and the handle are all production code and
  // only the executable is ours. It reads nothing, answers nothing, and dies only to SIGKILL —
  // which is precisely the TERM→KILL window `ProcessTransport.close()` opens and then `unref`s.
  const shim = join(scratch, 'deaf-child.sh')
  writeFileSync(shim, "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 1; done\n")
  const spawnedPids: number[] = []
  const runtime = new ClaudeRuntime(undefined, undefined, undefined, undefined, () => {
    const child = spawn('/bin/sh', [shim], { stdio: ['pipe', 'pipe', 'pipe'] })
    if (child.pid !== undefined) spawnedPids.push(child.pid)
    return child
  })

  const handle = await runtime.start({ cwd: scratch, providerHome, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  const pid = handle.providerPid
  expect(pid, 'the shim really spawned').toBeGreaterThan(0)
  expect(isAlive(pid as number)).toBe(true)

  const fact = exitFactOf(handle)
  let settled = false
  void fact.then(() => (settled = true))

  const t0 = Date.now()
  await handle.close()
  const closeMs = Date.now() - t0
  const aliveAtClose = isAlive(pid as number)
  const settledAtClose = settled

  // 🔴 **The finding, on the wire.** `close()` came back; the process did not go anywhere.
  const lines = [
    '=== 233 B · a child that ignores the close ===',
    `pid                          : ${pid}`,
    `close() returned in          : ${closeMs} ms`,
    `⛔ pid ALIVE when close()    : ${aliveAtClose}`,
    `⛔ fact settled at that time : ${settledAtClose}`,
  ]

  // …and it settles when the process really goes — here by the SDK's own SIGKILL, five seconds
  // after the SIGTERM the shim trapped.
  await fact
  const factMs = Date.now() - t0
  lines.push(
    `the exit FACT settled in     : ${factMs} ms`,
    `pid alive at the end         : ${isAlive(pid as number)}`,
  )
  const report = lines.join('\n')
  console.log(report)
  writeFileSync(runEvidence('233-wedged.txt'), `${report}\n`)

  expect(
    aliveAtClose,
    'close() must be able to resolve on a live child — that is the finding',
  ).toBe(true)
  expect(settledAtClose, 'the FACT must not settle while the pid is alive').toBe(false)
  expect(factMs).toBeGreaterThan(closeMs)
  expect(isAlive(pid as number)).toBe(false)

  // 🔒 Only pids this probe spawned, and only if something above left one alive.
  for (const stray of spawnedPids) {
    if (isAlive(stray)) process.kill(stray, 'SIGKILL')
  }
  await handle.close()
  await consumer
}, 120_000)
