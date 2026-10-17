/**
 * **BroBot runs once per `userData`** (198, from 191 H6/H7/H8 and 194 H1/H2).
 *
 * Allow one app instance per `userData` folder.
 *
 * Two reviewers who never spoke to each other reported five HIGH findings with one cause: a second
 * app process opening the same database, the same provider homes and the same archive gate. The
 * worst of them needs no race at all — **constructing a second `RuntimeHost` settles the first
 * one's live sessions as though they were orphans**, because "at construction nothing is running"
 * is an assumption about the PROCESS that a second process makes false.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is the POLICY around Electron's `requestSingleInstanceLock`, in a file a test can load —
 * `index.ts` imports `electron` as a value and cannot be one. Nothing here imports Electron, for
 * the same reason `app-lifetime.ts` and `window-navigation.ts` do not.
 *
 * ⛔ **It is not sufficient, and the app does not treat it as if it were.** The lock makes a second
 * PROCESS impossible; it says nothing about a second host inside one process, which is what every
 * test does and what a future window-per-project would do. That half is `live-hosts.ts`, and it
 * holds **within a process**, whichever process that is — see the correction at the foot of this
 * comment for the half it does not cover (208 H2).
 *
 * ## The measurement this rests on (198 §1)
 *
 * Every live smoke launches its own app with its own `--user-data-dir` — 050 built that on purpose
 * — and several of them run a second app while the main one is up. If the lock were GLOBAL rather
 * than per-`userData`, this change would break every live instrument in the repository. So it was
 * measured before it was built on, with a twenty-line Electron main and nothing of ours in it:
 *
 * | case | result |
 * |---|---|
 * | two apps, DIFFERENT `--user-data-dir`, overlapping | **both** `requestSingleInstanceLock() === true` |
 * | two apps, SAME `--user-data-dir` | first `true`, second `false`, first receives `second-instance` |
 * | first app SIGKILLed, successor onto the same dir | successor `true` — the stale lock is broken, not honoured |
 *
 * The third row is visible in the artefact Chromium leaves: `SingletonLock` is a symlink whose
 * target is `<hostname>-<pid>`, so staleness is decidable rather than guessed, and a dead owner's
 * claim is taken rather than waited on. That is what {@link runAsSoleInstance} relies on for the
 * crash case, and it is why this module added **no lock of its own**: a second gate we invented is a
 * second gate that can go stale, and 191 M5 is already the report of one that has. ⚑ **236 §3 added
 * one and had to answer that objection first** — see the section at the foot of this comment.
 *
 * ## ⚠️ The second row has a window, measured at 202 (§7) and NOT closed here
 *
 * 198's second row is what happens when the two launches are separated by anything at all. When they
 * are not — both `Electron` processes started by one command, reaching `requestSingleInstanceLock()`
 * inside the same millisecond — **both can be told `true`**:
 *
 * | how far apart the two launches are | trials with BOTH `true` |
 * |---|---|
 * | same instant | ⛔ **3 / 12** |
 * | +50 ms | 0 / 4 |
 * | +200 ms | 0 / 4 |
 *
 * ⛔ **This is Chromium's `ProcessSingleton`, not something above it**, and nothing in this file can
 * make it narrower: the lock is taken before any code of ours runs on the losing side and the
 * verdict is the only thing we are given. ⚑ It is recorded rather than repaired because 202's scope
 * is `191` H1-H5 and `198` owns H6/H7/H8 — but the row above said *"second `false`"* without a
 * qualifier, and a comment stating a machine fact that holds only 9 times in 12 is worse than none
 * (142). ⚠️ **What is real about it**: a double-click repeated fast enough, or a launcher that
 * starts two, can put two hosts on one database — which is the very thing 198 exists to prevent, in
 * the one shape it does not cover.
 *
 * ## ⛔ And this comment used to say the other half caught it. It does not (208 H2)
 *
 * It read: *"The other half of the answer, `live-hosts.ts`, is cross-process and still holds."*
 * ⚠️ **`live-hosts.ts` is a module-level `Set<LiveHost>`.** It sees the hosts in ITS OWN process and
 * has never been able to see any other — which is exactly right for what it was built for (a second
 * `RuntimeHost` inside one process, 194 H1) and is no backstop whatsoever for two processes.
 *
 * ⚑ **This closes a question `202` §11 asked and left open** — *"nobody has checked whether
 * `live-hosts.ts` is cross-process"*. The answer is **no**, and the sentence that said otherwise was
 * shipped in the same dispatch that asked.
 *
 * ⛔ **So what remained unguarded, stated rather than repaired:** in the ~1 ms window above, two
 * processes can each hold a host over one `userData`, and neither one's startup repair can see the
 * other's live work. `191` M5 is the report of a durable ownership lease built for a case like this,
 * and it bricked provisioning until a file was hand-deleted — so the honest position was the narrow
 * guard with its gap written down, which is the same position `home-boot.ts` takes about its own.
 *
 * ## ⛔ 236 §3 measured that window again and closed it
 *
 * ⚑ **`scripts/one-app-probe.mjs`, on this Electron: 8 / 24 same-instant trials with BOTH `true`**,
 * against `202`'s 3 / 12 — controls clean (`+50 ms` 0 / 4, `+200 ms` 0 / 4, and a launch after the
 * first exits winning 2 / 2, which is the positive control). ⚠️ **The rate did not decay; it is
 * about one launch pair in three**, so the gap above was worth closing rather than re-recording.
 *
 * ⛔ **{@link SoleInstanceDeps.claimGate} is the backstop, and it answers `191` M5 directly**: it is
 * a listening socket, not a lease, so it cannot go stale — the kernel closes it when the process
 * dies — and every outcome it cannot decide RUNS the app. See `one-host-gate.ts`, whose whole
 * argument is that the worst this second gate can do is nothing.
 */

/**
 * What the FIRST instance tells the person who just launched a second one.
 *
 * ⛔ **A second launch must not appear to do nothing** — 106's rule, that there is no control which
 * cannot act, applies to the launcher too. The second process cannot say anything: it has no
 * window, and it is about to exit. So the running instance says it, and comes forward first.
 *
 * The sentence names the CONSEQUENCE rather than the mechanism, because "the single-instance lock
 * was already held" is a fact about Chromium and not about anything the reader owns.
 *
 * ⚠️ **"its sign-ins" and not the phrase this repo uses for that directory** — 169 §2's register,
 * enforced by `provider-home-words.test.ts`. What a second copy would actually share is
 * `<userData>/provider-homes/…`, and naming it that way would be true and would be jargon.
 */
export const SECOND_LAUNCH_NOTICE =
  'BroCrew is already running — this is that window. A second copy would share one database and ' +
  'the same sign-ins with this one, so it was not started.'

/**
 * What the second process writes on its way out, for whoever is reading a terminal or watching the
 * launch: written at once, since the process exits right after. It exits 0, because the app the
 * person asked for is running; standing down is not a start that failed.
 */
export const STOOD_DOWN_NOTICE =
  'BroCrew is already running for this user-data directory; the running window was brought ' +
  'forward instead. This second launch is exiting.'

export interface SoleInstanceDeps {
  /**
   * Electron's `app.requestSingleInstanceLock()`.
   *
   * ⚠️ **The FIRST of the two things the verdict below depends on** — it was the only one until
   * 236 §3 — and the reason to lean on it is the answer to "what happens
   * when the lock is held by a dead process". Chromium breaks a stale `SingletonLock` whose pid is
   * gone and returns `true`; every judgement about staleness is therefore made by the thing that
   * wrote the lock, and there is nothing of ours in the path to disagree with it. 180 made exactly
   * this argument for its own gate and chose fail-open; this one does not even get to choose.
   */
  requestLock: () => boolean
  /**
   * ⛔ **The cross-process backstop for the ~1 ms window Chromium loses** (236 §3) —
   * `claimSoleHost` from `one-host-gate.ts`, injected so this policy stays testable without a
   * filesystem and so both verdicts can be driven.
   *
   * ⚠️ **`'unknown'` RUNS the app.** Only a live answer stands a launch down; see the gate's own
   * fail-open note for why that direction is not negotiable.
   */
  claimGate: () => Promise<HostGateVerdict>
  /** Electron's `app.on('second-instance', …)`, registered only by the instance that holds it. */
  onSecondLaunch: (handler: () => void) => void
  /**
   * Bring the running window forward — restore it if minimised, show it, focus it, and make one if
   * every window has been closed (which on macOS is a normal state for a live app).
   */
  focusExisting: () => void
  /** Say {@link SECOND_LAUNCH_NOTICE} where the person who double-clicked can read it. */
  announce: (message: string) => void
  /**
   * Give this process up. Nothing has been opened yet, so there is nothing to close.
   *
   * ⛔ **`app.exit()`, and `app.quit()` was measurably the wrong verb** (202 §7). A graceful quit
   * lets the browser process carry on booting on its way out — far enough to start the DevTools http
   * handler — so a second launch carrying `--remote-debugging-port` **took the port, held it, and
   * released it again** on its way to standing down. Measured against this Electron, a first
   * instance holding the lock and a second launched 1.5 s later onto a free port:
   *
   * | stand-down | second instance printed `DevTools listening` |
   * |---|---|
   * | `app.quit()` | ⛔ **3/3** |
   * | `app.exit(0)` | **0/3** |
   *
   * ⚑ **Small, and every live instrument in this repository depends on it**: `ui-live-smoke.mjs`,
   * `resume-live-smoke.mjs` and `packaged-smoke.mjs` all drive the app through that port, and a
   * window in which the port belongs to a process that is about to die is a window in which a smoke
   * attaches to the wrong app. It is safe because it is the ONE path with nothing to unwind:
   * `start` has not been called, so no database is open, no host exists, no `before-quit` handler
   * has been registered, and there is nothing an orderly quit would do that an exit would skip.
   */
  standDown: () => void
  /**
   * Everything the app does when it IS the one instance: the database, the host, the window. Given
   * the gate's answer, `sole` or `unknown`, so the start can refuse what only a sole app may do
   * (change its data before opening it) without asking a second time.
   */
  start: (ownership: HostGateVerdict) => void
  /** Says {@link STOOD_DOWN_NOTICE}. It must be written before `standDown`'s exit, not queued. */
  log: (message: string) => void
}

import type { HostGateVerdict } from './one-host-gate'

/** Which of the two this process turned out to be. */
export type InstanceVerdict = 'sole' | 'already-running'

/**
 * Take the lock, then either run the app or hand the user back to the one that is already running.
 *
 * ⚠️ **`start` is called from HERE rather than by the caller reading a verdict**, and the reason is
 * the one `orphan-runs.test.ts` writes down about its own repair: a correct policy that nothing
 * calls leaves the defect exactly where it was, and every assertion about the policy still passes.
 * Making the decision and the consequence one call means a test can assert that a refused launch
 * opens no database, constructs no host and shows no window — which is the finding, rather than a
 * fact about a boolean.
 */
export async function runAsSoleInstance(deps: SoleInstanceDeps): Promise<InstanceVerdict> {
  if (!deps.requestLock()) {
    deps.log(STOOD_DOWN_NOTICE)
    deps.standDown()
    return 'already-running'
  }
  // ⛔ **AFTER Chromium's verdict and BEFORE `start`** (236 §3). After, because the ordinary second
  // launch is Chromium's to refuse and this must not become a second answer to a question already
  // answered; before, because everything this protects — the database, the host, the startup repair
  // that settles live sessions as orphans — happens inside `start`.
  //
  // ⚠️ **A gate that THREW would otherwise stop the app**, which is the one thing a backstop over a
  // working lock may never do. Its own contract is fail-open (`one-host-gate.ts`); this is the same
  // rule at the seam, so a future gate cannot break the launch by breaking itself.
  //
  // 🔴 **This `await` is what stopped the app opening, and the gate was never wrong** (241 §2). It
  // does not delay `start`; it moves it to the OTHER SIDE of Electron's `ready`, and `index.ts` had
  // one statement in `start` that may only run before `ready`. Measured: the gate's verification
  // connect needs this thread, which Chromium holds from ~12 ms until it emits `ready` at ~50 ms, so
  // `start` ran late on every launch whose gate WORKS — rather than on some of them.
  //
  // ⚠️ **And on the launches whose gate does not work it ran early**, which is not a consolation: it
  // is why nothing caught this. A `--user-data-dir` too long for a POSIX socket name fails open at
  // ~4 ms, in front of `ready` — and that is the directory every live smoke uses (241 §3).
  //
  // ⛔ **The repair was in `index.ts`, at module scope — not here.** Making this synchronous would
  // give back the 8/24 double-launch window this exists to close, and making it "fast" is not
  // available: nothing awaited on this thread can land before `ready`. ⚑ **So the rule this seam
  // now carries is: `start` runs after `ready`, and anything that cannot must not be inside it.**
  const gate = await deps.claimGate().catch(() => 'unknown' as const)
  if (gate === 'taken') {
    // ⚠️ **Nothing is announced, and that is not an oversight.** This branch is reachable only when
    // Chromium told BOTH processes `true`, so the other one never received `second-instance` and
    // has no reason to come forward — there is no window of ours to put a sheet on, and this
    // process is about to exit. The running app is on screen; the terminal gets the sentence.
    deps.log(STOOD_DOWN_NOTICE)
    deps.standDown()
    return 'already-running'
  }
  // ⛔ **Registered only by the launch that is going to RUN** — after the gate as well as after the
  // lock (236 §3, found reviewing this diff). It was registered before the gate, so a process the
  // gate stood down had already installed a `second-instance` handler for a `userData` it does not
  // hold: precisely what this file's own test forbids for the losing launch, one gate along.
  //
  // Still before `start`, so a second launch arriving during a slow first startup is answered. It
  // cannot be answered WELL that early — there may be no window to focus yet — which is why
  // `focusExisting` is responsible for making one rather than assuming one.
  deps.onSecondLaunch(() => {
    deps.focusExisting()
    deps.announce(SECOND_LAUNCH_NOTICE)
  })
  deps.start(gate)
  return 'sole'
}

/** The one-app check's answer as a start asks for it: once, or again on a retry. */
export interface OwnershipAsked {
  /**
   * The launch's own answer the first time. Each later time it is still `unknown`, a fresh claim, so
   * a person who tries again can find the folder free; `sole` and `taken` stand.
   */
  readonly ask: () => Promise<HostGateVerdict>
  /** The latest answer, without asking. */
  readonly held: () => HostGateVerdict
}

export function ownershipFrom(
  first: HostGateVerdict,
  claimAgain: () => Promise<HostGateVerdict>,
): OwnershipAsked {
  let held = first
  let asked = false
  let claiming: Promise<HostGateVerdict> | null = null
  return {
    held: () => held,
    ask: () => {
      if (!asked || held !== 'unknown') {
        asked = true
        return Promise.resolve(held)
      }
      claiming ??= claimAgain()
        .catch(() => 'unknown' as const)
        .then((answer) => {
          held = answer
          claiming = null
          return answer
        })
      return claiming
    },
  }
}
