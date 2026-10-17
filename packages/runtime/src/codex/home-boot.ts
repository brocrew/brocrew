import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * One `codex app-server` at a time may **boot** on a given home (180).
 *
 * ## ⛔ The measurement this exists for
 *
 * `codex app-server` creates its sqlite state — `state_5.sqlite`, `logs_2.sqlite`, `memories_1`,
 * `goals_1` — as it starts, and two app-servers doing that in the same `CODEX_SQLITE_HOME` at the
 * same moment is not serialized by the provider. The loser exits, and what the app forwards is:
 *
 * ```
 * codex app-server exited (stderr tail: Error: failed to initialize sqlite state runtime under …)
 * ```
 *
 * Provoked on purpose against the bundled 0.146.0 binary, two app-servers per trial, ten trials
 * each — the app's own env, the app's own `initialize`:
 *
 * | shape | losing app-server |
 * |---|---|
 * | cold home, both spawned in one tick | **7/10** |
 * | cold home, second spawned +10 ms | **7/10** |
 * | cold home, second spawned +15 ms | 2/10 |
 * | cold home, second spawned +20 ms | 0/10 |
 * | cold home, second spawned +50 / +100 / +200 ms | 0/10 |
 * | cold home, first still ALIVE holding the db, second at +50…+1000 ms | 0/10 |
 * | home that already has the db | 0/10 |
 * | one after the other | 0/10 |
 *
 * ⚠️ **So the window is the ~20 ms of CREATION, and nothing else.** A live app-server holding an
 * existing db does not block a second one — measured, because assuming it did would have justified
 * a much wider lock than this.
 *
 * ⚠️ **And the app's margin against that window was 159 ms, by luck.** Measured on a cold app doing
 * what step 38 does — the model probe's app-server (cwd = the home) at t=0, the session's app-server
 * (cwd = the project) at t=+159 ms. Nothing enforced the gap; it is what the launcher's mount
 * happening to precede the user's Send is worth on an unloaded machine. 178's full pass lost it
 * once, and batch #2 lost it before that with five orphaned apps on the CPU.
 *
 * ## What this serializes, and what it deliberately does not
 *
 * The interval from **before the spawn** to **`initialize` having answered** — the only interval in
 * which a child may still be creating the state. It is NOT held across `thread/start`, a sign-in, or
 * a `model/list`: those are network waits with no bound this module could trust, and a gate held
 * across one would turn a hung provider into an app that can never launch Codex again.
 *
 * ⚠️ **It is in-process and per-home, and that is a real limit rather than a rounding error.** Two
 * BroBot2 processes pointed at one `userData` would still race and this could not see it.
 *
 * ⛔ **This paragraph used to say the app does NOT call `requestSingleInstanceLock`. It does** (208
 * H2). That was true when 180 wrote it and `198` changed it: `apps/desktop/src/main/index.ts` calls
 * it at module scope, and `single-instance.ts` is the policy around the answer. So a second app on
 * one `userData` is refused — **except** in the window `202` §7 measured, where two launches inside
 * the same millisecond can BOTH be told they hold the lock (3 trials in 12). ⚠️ **That window is the
 * only shape in which this gate's own gap is now reachable**, and it is narrower than the sentence
 * it replaces, not wider. Every launcher, smoke and packaged run still gets a `userData` of its own,
 * so none of them meets it at all.
 *
 * ## ⛔ This paragraph used to say the real lock could not be awaited. It can, since 243 — and this
 * gate stays anyway, for a better reason than the one it was built on
 *
 * What stood here was: *"The cross-process lock that WOULD cover it, `withProviderHomeLock`, is
 * synchronous (`Atomics.wait`), and holding it across a spawn would freeze the Electron main thread
 * for the whole handshake."* ⚑ **The first clause is now false and the second is still true, and it
 * is the second that decides.** 243 made the wait asynchronous and then asked whether this gate had
 * become redundant. It has not. ⚑ **The first reason alone would be enough**; the other three are
 * written down because a mechanism kept for one reason is a mechanism somebody will design around:
 *
 *  1. ⛔ **The critical section contains an unbounded wait.** `beginCodexHomeBoot` is released when
 *     `initialize` has answered — `codex-runtime.ts`'s `await this.transport.request('initialize',
 *     initializeParams())`, with no bound around it, as its `thread/start` and `thread/resume`
 *     neighbours also have none. A wedged-but-alive app-server
 *     expressed as a lockfile would stamp `<home>.lock` with a LIVE pid, and `ownerIsGone` refuses
 *     to break our own process's hold — so that home would never provision again, for anything.
 *     ⚠️ **That is 191 M5's *"fails forever"* rebuilt**, and wider than it was, because the lockfile
 *     also guards `provisionProviderHome` and the credential copy.
 *  2. ⛔ **They fail in opposite directions, on purpose.** This one fails OPEN after
 *     {@link BOOT_WAIT_MS} — 180 chose that, and the reasoning is three paragraphs down. The
 *     lockfile fails CLOSED after ten seconds by throwing. Swapping them would turn *"one provider
 *     error the user can retry"* into *"Codex cannot start"*.
 *  3. ⚠️ **The shapes do not match.** This hands out a release TOKEN, dropped part-way through a
 *     launch at a point the caller chooses; `withProviderHomeLock` wraps a callback and releases
 *     when it returns. A launch is not a callback.
 *  4. ⚠️ **This takes an `AbortSignal`** (182 L1, 202) and the lock has nowhere to accept one, so
 *     expressing a boot with it would re-open the queued-spawn-after-quit finding 202 closed.
 *
 * ⚑ **So: two mechanisms, and no longer two answers to one question.** The gap below is still this
 * gate's — 243 changed how a caller WAITS, and nothing about what either gate covers.
 *
 * ⛔ **Fail-open on a stuck holder.** A waiter gives up after {@link BOOT_WAIT_MS} and boots anyway.
 * A race mitigation that could deadlock a launch would be a worse defect than the race: the cost of
 * being wrong here is one provider error the user can retry, and the cost of blocking is a Codex
 * that never starts again for the life of the process.
 *
 * ## ⛔ What a slot is, after 185 (182 M1)
 *
 * It used to be **the tail of a chain**: each arrival stored `ahead.then(() => mine)` under the home
 * and, on release, deleted that entry if it was still the one stored. That is the right answer while
 * every boot really does wait for its predecessor — and the fail-open above is precisely the case
 * where one does not. A successor that gave up on a still-pending predecessor then held the only
 * entry the home had, and **its** release erased the home from the map while the predecessor was
 * still creating its sqlite state. The next launch found an empty map, waited for nothing, and
 * raced the very boot the gate exists to serialize.
 *
 * ⚑ **So a slot's identity is now the boot's own promise, and the home's entry is the SET of boots
 * that have not released.** Two consequences, both of them the point:
 *
 *  - a release removes only its own promise, and the home is forgotten only when the set is empty —
 *    ⛔ **nobody can clear a slot they do not own**;
 *  - an arrival waits on **every** live boot rather than on the last chain link, so a predecessor
 *    someone else failed open on is still waited for — under this arrival's own {@link BOOT_WAIT_MS},
 *    because the fail-open is per waiter and stays that way.
 *
 * ⚠️ **The wait is cancellable** (182 L1). A caller whose deadline expired while it was queued used
 * to keep its place until the whole budget ran out; now the signal that gives up on the launch gives
 * up the queue place with it.
 */

/** How long a launch waits for the app-servers ahead of it before booting anyway. */
export const BOOT_WAIT_MS = 15_000

/**
 * Why a queued boot stopped waiting.
 *
 * ⛔ **The three are not interchangeable, and 202 is the cost of treating them as one** (191 H4).
 * `ahead-done` and `gave-up` both mean *go* — the second is {@link BOOT_WAIT_MS}'s fail-open, which
 * 180 chose deliberately and which stays. `abandoned` means the caller is no longer there, and it
 * is the only one of the three that must not become a spawn.
 */
type WaitOutcome = 'ahead-done' | 'gave-up' | 'abandoned'

/**
 * A boot that was still queued when its caller gave up — thrown by {@link beginCodexHomeBoot}
 * instead of handing out a slot.
 *
 * ⛔ **The failure this exists for is a spawn that happens AFTER the quit stopped waiting for it**
 * (202, from 191 H4). Start, resume and the model probe each hold an `AbortSignal` and each passed
 * none to the gate, so a boot queued behind another one waited its full fifteen seconds regardless
 * of what had happened to the app in the meantime. `closeAll` stops awaiting launch termination
 * after two five-second drains — so a quit at t0 left the barrier at t+10 s and the spawn at
 * t+15 s, five seconds after the last thing that was waiting for it had gone.
 *
 * ⚑ **It is a THROW rather than a silent no-op** because the caller has to unwind: `start` has a
 * transport to not create and a handle to not return, and a launch that quietly resolved to nothing
 * would be a session the host believes it has.
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

/** Canonical path, so `/var/…` and `/private/var/…` are one home rather than two (178's lesson). */
function homeKey(providerHome: string): string {
  try {
    return realpathSync(providerHome)
  } catch {
    return resolve(providerHome)
  }
}

/**
 * Settle when `ahead` does, when `waitMs` runs out, or when the caller gives up.
 *
 * ⚠️ **`ahead` cannot reject, and this deliberately does not pretend otherwise.** Every promise in
 * {@link booting} is resolved by a release callback and by nothing else — there is no path that
 * rejects one — so a `.then(finish, finish)` here would be a rejection handler no test could ever
 * reach, which is not a guard (`176` §12). If a rejecting boot promise is ever introduced, this is
 * the line that has to be revisited, and the doc is the notice.
 *
 * ⛔ **The `signal` arm is 182 L1.** Waiting here is the one interval of a Codex launch that had
 * nothing to do with a child process — no transport exists yet, so `cancelWith` has nothing to tear
 * down — and it was therefore the one interval cancellation could not reach. A caller whose deadline
 * expired at ten seconds sat in this queue for the remaining five.
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
    // Unref'd so a queued boot cannot hold a process open past its work (066's orphan lesson, in
    // the small): the timer exists to bound a wait, not to keep anything alive.
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
 * ⚠️ **Release is idempotent**, so the `finally` backstop every call site has cannot double-release
 * and hand the slot to two waiters.
 */
export async function beginCodexHomeBoot(
  providerHome: string,
  opts: { waitMs?: number; signal?: AbortSignal } = {},
): Promise<() => void> {
  const home = homeKey(providerHome)
  const live = booting.get(home) ?? new Set<Promise<void>>()
  booting.set(home, live)
  // ⚠️ Snapshotted BEFORE joining, and that ordering is the whole queue: what this boot waits for is
  // everyone who was already here, and everyone who arrives later waits for this one.
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
    // ⛔ Only when nothing on this home is still booting (182 M1). A successor that failed open on a
    // stuck predecessor must not erase it: the next launch would find no queue at all and race the
    // very app-server this gate exists to serialize. `booting.get` is re-read so a reset between the
    // two cannot resurrect a home nobody is on.
    if (live.size === 0 && booting.get(home) === live) booting.delete(home)
  }
  if (ahead.length > 0) {
    const why = await waitAtMost(
      Promise.all(ahead).then(() => {}),
      opts.waitMs ?? BOOT_WAIT_MS,
      opts.signal,
    )
    // ⛔ **A caller that gave up while QUEUED does not get a slot** (202, from 191 H4). See
    // {@link CodexHomeBootAbandoned}. Its own place is given back first, so a successor waiting
    // behind it is not made to wait out a boot that will never happen.
    //
    // ⚠️ **`gave-up` is deliberately not this case.** That is 180's fail-open, and turning it into a
    // refusal would be the deadlock 180 rejected: the cost of booting into a still-creating home is
    // one provider error the user can retry, and the cost of never booting is a Codex that cannot
    // start again for the life of the process.
    //
    // ⚑ **And nothing here re-asks a signal that aborted OUTSIDE the wait.** A launch with nobody
    // ahead of it never reaches this branch, so an abort landing while `start` is spawning is still
    // `cancelWith`'s to answer — 070 pinned that, and refusing there left its test awaiting a close
    // on a transport that had never been created.
    if (why === 'abandoned') {
      settle()
      throw new CodexHomeBootAbandoned(providerHome)
    }
  }
  return settle
}

/** Test seam: forget every home's queue. Never called in production — nothing there outlives it. */
export function resetCodexHomeBoots(): void {
  booting.clear()
}
