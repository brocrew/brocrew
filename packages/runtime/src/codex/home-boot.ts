import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * One `codex app-server` at a time may boot on a given home. The server creates its sqlite state
 * (`state_*.sqlite`, `logs_*.sqlite`, ...) as it starts, and two doing that in the same
 * `CODEX_SQLITE_HOME` at once can make the loser exit with "failed to initialize sqlite state
 * runtime". Only the roughly 20 ms of creation races; an app-server already holding an existing db
 * does not block another.
 *
 * The gate covers the interval from before the spawn until `initialize` has answered. It is not held
 * across `thread/start`, sign-in or `model/list`, whose waits are unbounded. It is in-process and
 * per-home, so two app processes sharing one `userData` are not covered.
 *
 * It is separate from `withProviderHomeLock` because the critical section contains an unbounded wait
 * (a wedged live app-server would hold a lockfile with a live pid forever), the two fail in opposite
 * directions, this hands out a release token rather than wrapping a callback, and this accepts an
 * `AbortSignal`.
 *
 * It fails open: a waiter gives up after {@link BOOT_WAIT_MS} and boots anyway, because the cost is
 * one retryable provider error while blocking could stop Codex from ever starting again.
 *
 * Each home's entry is the set of boots that have not released. A release removes only its own
 * promise, and an arrival waits on every live boot, so a predecessor someone else failed open on is
 * still waited for. The wait is cancellable through the caller's signal.
 */

/** How long a launch waits for the app-servers ahead of it before booting anyway. */
export const BOOT_WAIT_MS = 15_000

/**
 * Why a queued boot stopped waiting. `ahead-done` and `gave-up` (the fail-open) both proceed to
 * spawn; `abandoned` means the caller is gone and must not spawn.
 */
type WaitOutcome = 'ahead-done' | 'gave-up' | 'abandoned'

/**
 * Thrown by {@link beginCodexHomeBoot} when the caller's signal aborted while the boot was still
 * queued, so no spawn happens after a quit stopped waiting for it. It is a throw so the caller
 * unwinds instead of holding a session that does not exist.
 */
export class CodexHomeBootAbandoned extends Error {
  constructor(providerHome: string) {
    super(`the codex boot queue for ${providerHome} was abandoned before this launch reached it`)
    this.name = 'CodexHomeBootAbandoned'
  }
}

/**
 * Home → every boot that has taken a slot and not yet released it. Each promise resolves on its
 * own release and never rejects; the set is deleted when the last of them lets go.
 */
const booting = new Map<string, Set<Promise<void>>>()

/** Canonical path, so `/var/...` and `/private/var/...` are one home. */
function homeKey(providerHome: string): string {
  try {
    return realpathSync(providerHome)
  } catch {
    return resolve(providerHome)
  }
}

/**
 * Settle when `ahead` does, when `waitMs` runs out, or when the caller gives up. `ahead` cannot
 * reject: every promise in {@link booting} is resolved by a release callback only, so no rejection
 * handler is attached. The signal arm lets a launch cancel while queued, before any transport exists.
 */
function waitAtMost(
  ahead: Promise<void>,
  waitMs: number,
  signal?: AbortSignal,
): Promise<WaitOutcome> {
  return new Promise<WaitOutcome>((done) => {
    const finish = (why: WaitOutcome): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      done(why)
    }
    const onAbort = (): void => finish('abandoned')
    // Unref'd so a queued boot cannot keep the process alive.
    const timer = setTimeout(() => finish('gave-up'), waitMs)
    timer.unref?.()
    if (signal?.aborted === true) {
      finish('abandoned')
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    void ahead.then(() => finish('ahead-done'))
  })
}

/**
 * Take a boot slot on the home, waiting for every boot already holding one. Resolves to the
 * **release**, which the caller must run once the app-server has answered `initialize` — or once the
 * launch has failed.
 *
 * Release is idempotent, so the `finally` backstop every call site has cannot double-release
 * and hand the slot to two waiters.
 */
export async function beginCodexHomeBoot(
  providerHome: string,
  opts: { waitMs?: number; signal?: AbortSignal } = {},
): Promise<() => void> {
  const home = homeKey(providerHome)
  const live = booting.get(home) ?? new Set<Promise<void>>()
  booting.set(home, live)
  // Snapshot before joining: this boot waits for everyone already here; later arrivals wait for it.
  const ahead = [...live]
  let release!: () => void
  const mine = new Promise<void>((settled) => {
    release = settled
  })
  live.add(mine)
  let done = false
  const settle = (): void => {
    if (done) return
    done = true
    release()
    live.delete(mine)
    // Forget the home only when nothing on it is still booting, so a successor that failed open
    // cannot erase a still-creating predecessor. `booting.get` is re-read so a reset cannot resurrect
    // the home.
    if (live.size === 0 && booting.get(home) === live) booting.delete(home)
  }
  if (ahead.length > 0) {
    const why = await waitAtMost(
      Promise.all(ahead).then(() => {}),
      opts.waitMs ?? BOOT_WAIT_MS,
      opts.signal,
    )
    // A caller that gave up while queued gets no slot and gives its place back first, so a successor
    // is not made to wait. `gave-up` is the fail-open and still proceeds. An abort outside the wait
    // is `cancelWith`'s to answer.
    if (why === 'abandoned') {
      settle()
      throw new CodexHomeBootAbandoned(providerHome)
    }
  }
  return settle
}

/** Test seam: forget every home's queue. */
export function resetCodexHomeBoots(): void {
  booting.clear()
}
