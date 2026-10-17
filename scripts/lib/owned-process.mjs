/**
 * Reap only processes whose identity was captured while this launch owned them.
 * A pid can be reused; revalidate executable, start and parent facts before every signal.
 * A port can establish listener ownership at launch, but cannot authorise killing its later
 * holder. Call `remember(pid)` while ownership is known; do not discover targets by name.
 *
 * Signalling needs the complete identity. Completion waits on `pid` plus `lstart`, which
 * survive a dying process's rewritten name, so teardown does not declare it gone prematurely.
 */
import { execFileSync } from 'node:child_process'

const IDENTITY_FIELDS = ['pid', 'start', 'executable', 'parentPid', 'pgid', 'command']

/**
 * ⛔ **The `ps` STAT letter for a process that has exited and not yet been collected by its parent.**
 *
 * ⚠️ **A zombie is not a process that can do anything** — it has released every file descriptor and
 * every page it held, and what is left is a row in the table holding an exit status until somebody
 * calls `wait`. For the only question completion is asking — *can anything we launched still touch
 * this directory?* — it is gone, and the row is an accounting artefact.
 *
 * 🔴 **And it is an artefact THIS module creates.** The launcher is the caller's own direct child,
 * so only the caller can collect it — and {@link blockingPause} stops the event loop, so nothing is
 * collected for as long as a teardown runs. Measured: our own child read `Z` / `<defunct>` at 50 ms,
 * 250 ms, 1 s and 3 s while the loop was blocked, and was GONE within 300 ms of it being released.
 * ⛔ Counting that as "still there" made every teardown run to its 40-attempt bound — **13.1 to 15.8
 * seconds, and a red on every green product** — which is how this constant came to exist.
 */
const ZOMBIE = 'Z'

/**
 * ⛔ **How many times a frozen tree may still hand back a process nobody had seen** (360).
 *
 * One pass is the ordinary case: freeze the group, scan, and everything the scan finds was already
 * there. A second is owed because a `detached` child leads its OWN group — the group signal does not
 * reach it, so it runs on until the pass that freezes it by pid, and in that interval it can spawn
 * one of its own. ⚠️ **Beyond that the tree is not settling**, and a bound that goes on trying is the
 * retry loop `owned-teardown.mjs` refuses to be. See {@link createOwnedProcessLifecycle}'s `quiesce`.
 */
const FREEZE_PASSES = 5

function positiveInteger(value, field) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`process identity has invalid ${field}: ${JSON.stringify(value)}`)
  }
  return number
}

/** Copy and freeze a process identity so a caller-owned object cannot change the saved authority. */
function immutableIdentity(value) {
  if (!value || typeof value !== 'object') throw new Error('process identity is missing')
  const identity = {
    pid: positiveInteger(value.pid, 'pid'),
    start: String(value.start ?? '').trim(),
    executable: String(value.executable ?? '').trim(),
    parentPid: positiveInteger(value.parentPid, 'parentPid'),
    pgid: positiveInteger(value.pgid, 'pgid'),
    command: String(value.command ?? '').trim(),
    // ⛔ **Read, never remembered.** It is deliberately absent from {@link IDENTITY_FIELDS} and from
    // `sameRememberedProcess`: a process moves between `S`, `R` and `SN` while it runs, so folding
    // it into the saved authority would make every re-read look like a different process — which is
    // the exact failure this module exists to avoid. It is a fact about NOW, compared against
    // nothing, and only {@link ZOMBIE} is ever read off it.
    runState: String(value.runState ?? '').trim(),
  }
  for (const field of ['start', 'executable', 'command']) {
    if (identity[field] === '') throw new Error(`process identity has empty ${field}`)
  }
  return Object.freeze(identity)
}

function exactIdentity(left, right) {
  return IDENTITY_FIELDS.every((field) => left[field] === right[field])
}

/**
 * Read one process from `ps`, returning `null` only when `ps` says the pid no longer exists.
 * Other failures throw: inability to establish identity is not evidence that teardown completed.
 */
export function defaultReadProcessIdentity(pid) {
  const wanted = positiveInteger(pid, 'pid')
  const read = (fields) => {
    try {
      return execFileSync(
        'ps',
        ['-ww', '-p', String(wanted), ...fields.flatMap((field) => ['-o', `${field}=`])],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim()
    } catch (error) {
      // Both BSD and procps `ps -p <missing>` use status 1. Anything else is an instrument error,
      // not proof that the process disappeared.
      if (error && typeof error === 'object' && error.status === 1) return null
      throw error
    }
  }

  // ⚠️ `state` rides along in the call that was already being made — `lstart` stays LAST because it
  // is the only multi-word field, and a field added after it would be eaten by its own `.+?`.
  const facts = read(['pid', 'ppid', 'pgid', 'state', 'lstart'])
  if (facts === null || facts === '') return null
  const match = facts.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/)
  if (!match) throw new Error(`could not parse process identity for pid ${wanted}`)

  const executable = read(['comm'])
  if (executable === null) return null
  const command = read(['command'])
  if (command === null) return null
  return immutableIdentity({
    pid: match[1],
    parentPid: match[2],
    pgid: match[3],
    start: match[5],
    executable,
    command,
    runState: match[4],
  })
}

/**
 * Take two equal samples before granting signal authority. This closes the race where a process
 * exits and its pid is reused while its identity is being captured.
 */
export function captureProcessIdentity(pid, { readIdentity = defaultReadProcessIdentity } = {}) {
  const firstValue = readIdentity(positiveInteger(pid, 'pid'))
  if (firstValue === null) return null
  const first = immutableIdentity(firstValue)
  const secondValue = readIdentity(first.pid)
  if (secondValue === null) return null
  const second = immutableIdentity(secondValue)
  return exactIdentity(first, second) ? second : null
}

/**
 * 🔴 **Is this pid the same PROCESS, whatever it now calls itself?** (333)
 *
 * `lstart` is the moment the kernel started this process. Nothing the process does changes it — not
 * `exec`, not `setsid`, not losing its parent — so a pid the OS has recycled carries a different one
 * and a process on its way out carries the same one. ⛔ **It is the only field in the identity that a
 * live process cannot alter**, which is why it, and not the name, is what "still ours" is read off.
 *
 * ## ⚠️ What this was measured against
 *
 * Between `SIGKILL` and leaving the process table, an Electron browser spent **535 ms** on an idle
 * machine reading like this to `ps` — the whole of the window, sampled every few milliseconds:
 *
 * ```
 *   +  63ms  exe=(Electron)  cmd=(Electron)  start=same  pgid=same  ppid=1
 *   + 598ms  GONE
 * ```
 *
 * ⛔ **macOS rewrites `comm` and `command` to the parenthesised form** the moment a process can no
 * longer be asked for its arguments. So every NAME field changes while the process is still in the
 * table, still holding its open files and still flushing them — and {@link sameRememberedProcess},
 * which compares all six fields, says no. Before this function existed that answer was `replaced`,
 * and `replaced` was counted as neither alive nor unverifiable: **19 of 70 measured `window:check`
 * runs called the teardown complete with four to six of their own processes still in the table.**
 */
function isTheSameProcess(saved, current) {
  return saved.pid === current.pid && saved.start === current.start
}

function sameRememberedProcess(saved, current, { allowInitReparent = false } = {}) {
  if (
    saved.pid !== current.pid ||
    saved.start !== current.start ||
    saved.executable !== current.executable ||
    saved.pgid !== current.pgid ||
    saved.command !== current.command
  ) {
    return false
  }
  return saved.parentPid === current.parentPid || (allowInitReparent && current.parentPid === 1)
}

function blockingPause(milliseconds) {
  if (milliseconds <= 0) return
  const cell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(cell, 0, 0, milliseconds)
}

/**
 * Build a lifecycle around one detached launcher.
 *
 * `remember(pid)` is the only way to add a later descendant/listener. It captures the identity
 * twice and accepts only a process directly descended from a remembered process or a member of
 * the launcher's own process group. Teardown never discovers another pid.
 */
export function createOwnedProcessLifecycle({
  launcherPid,
  ownedPids = [],
  readIdentity = defaultReadProcessIdentity,
  killer = (pid, signal) => process.kill(pid, signal),
  eventEmitter = process,
  timers = { pause: blockingPause },
  discoverDescendants = null,
  attempts = 40,
  forceAfter = 10,
  intervalMs = 250,
} = {}) {
  const wantedLauncherPid = positiveInteger(launcherPid, 'launcherPid')
  const launcher = captureProcessIdentity(wantedLauncherPid, { readIdentity })
  if (launcher === null) {
    throw new Error(`could not capture launcher process ${wantedLauncherPid}`)
  }
  if (launcher.pid !== wantedLauncherPid) {
    throw new Error(
      `launcher identity pid ${launcher.pid} does not match requested pid ${wantedLauncherPid}`,
    )
  }

  const remembered = new Map()
  const maxAttempts = Math.max(1, Math.trunc(attempts))
  const termAttempts = Math.max(0, Math.trunc(forceAfter))
  let armed = true
  let completedResult = null
  let descendantDiscoveryUncertain = false

  const remember = (pid) => {
    const wanted = positiveInteger(pid, 'pid')
    if (wanted === launcher.pid) return launcher
    const existing = remembered.get(wanted)
    if (existing) return existing

    const captured = captureProcessIdentity(wanted, { readIdentity })
    // A short-lived descendant can disappear between the process-tree snapshot and this identity
    // read. Gone is safe; adopting whatever later reuses the pid is not.
    if (captured === null) return null
    const parentIsRemembered =
      captured.parentPid === launcher.pid || remembered.has(captured.parentPid)
    const inLauncherGroup = launcher.pgid === launcher.pid && captured.pgid === launcher.pgid
    if (!parentIsRemembered && !inLauncherGroup) {
      throw new Error(
        `refusing to remember pid ${wanted}: it is neither a saved descendant nor in launcher group ${launcher.pgid}`,
      )
    }
    remembered.set(captured.pid, captured)
    return captured
  }

  for (const pid of ownedPids) remember(pid)

  const stateOf = (saved, allowInitReparent) => {
    try {
      const value = readIdentity(saved.pid)
      if (value === null) return { kind: 'gone' }
      const current = immutableIdentity(value)
      // ⛔ **A row, not a process** — see {@link ZOMBIE}. It is checked ABOVE every identity
      // comparison, not merely above the pid+start one: on macOS a zombie's `comm` becomes
      // `<defunct>` so it could not read as `alive` anyway, but that is a fact about one `ps` and
      // not a property of the state. A platform that left the name alone would make this read
      // `alive`, and the teardown would then signal a row in a table until its bound ran out.
      if (current.runState.startsWith(ZOMBIE)) return { kind: 'collected' }
      if (sameRememberedProcess(saved, current, { allowInitReparent })) {
        return { kind: 'alive', current }
      }
      // ⛔ **Still there, and still the process we launched** (333) — see {@link isTheSameProcess}.
      // Authority to SIGNAL is deliberately not granted here: there is nothing left to signal, and
      // the full identity is what earns a `kill`. What it grants is the right to be WAITED for.
      if (isTheSameProcess(saved, current)) return { kind: 'exiting', current }
      // The pid still exists, but it no longer names the process for which authority was saved.
      return { kind: 'replaced' }
    } catch (error) {
      return { kind: 'unverifiable', error }
    }
  }

  const refreshDescendants = () => {
    if (typeof discoverDescendants !== 'function') return true
    if (stateOf(launcher, false).kind !== 'alive') return !descendantDiscoveryUncertain
    const before = new Set(remembered.keys())
    try {
      const discovered = discoverDescendants(launcher.pid)
      if (!Array.isArray(discovered))
        throw new Error('descendant discovery did not return an array')
      for (const candidate of discovered) {
        const pid = typeof candidate === 'object' && candidate !== null ? candidate.pid : candidate
        remember(pid)
      }
      // The launcher must still be the captured process after discovery. If its pid changed hands
      // in the window, every new candidate loses provenance and is discarded without signalling.
      if (stateOf(launcher, false).kind !== 'alive') {
        for (const pid of remembered.keys()) if (!before.has(pid)) remembered.delete(pid)
        descendantDiscoveryUncertain = true
        return false
      }
      // Once a discovery window was unreadable, a later scan cannot prove that no child detached
      // during that blind interval. Keep the uncertainty sticky and the exit retry armed.
      return !descendantDiscoveryUncertain
    } catch {
      for (const pid of remembered.keys()) if (!before.has(pid)) remembered.delete(pid)
      descendantDiscoveryUncertain = true
      return false
    }
  }

  const signalSaved = (saved, signal, { group = false, allowInitReparent = false } = {}) => {
    // This read is intentionally adjacent to the signal. Never reuse the result of an earlier
    // poll: that would recreate the pid-reuse window this module exists to close.
    const state = stateOf(saved, allowInitReparent)
    if (state.kind !== 'alive') return { state, signalled: false }
    if (group && (saved.pgid !== saved.pid || state.current.pgid !== state.current.pid)) {
      return { state: { kind: 'replaced' }, signalled: false }
    }
    try {
      killer(group ? -saved.pid : saved.pid, signal)
      return { state, signalled: true }
    } catch (error) {
      // ⛔ **Its own kind, because it is its own fact** (345 review). This arm is reached only after
      // `stateOf` has ALREADY answered `alive`: the launcher was there and the kernel refused the
      // signal — `ESRCH` when the group emptied inside the window between the read and the kill,
      // `EPERM` when it is not ours to signal. Reporting that as `unverifiable` said *"`ps` could
      // not be asked"* about a `ps` that answered perfectly well, which is one sentence for two
      // states — the defect `signalWhy` exists to remove, one line below where it removes it.
      return { state: { kind: 'unsignallable', error }, signalled: false }
    }
  }

  /**
   * 🔴 **Freeze the tree, and only then enumerate it** (360).
   *
   * ## ⛔ The window this closes, and why shrinking it was not enough
   *
   * `333` moved the last descendant scan as late as it could go — one `ps -A`, **29 ms** — and said
   * so in its own comment: *"It shrinks that window; it does not close it."* ⚠️ **A window that is
   * only small is a window the machine's load decides**, and this repository has been paying for it
   * since `325`: a `codex app-server` writing `models_cache.json` into a check's temp home at the
   * second the check was tearing down, six such directories left behind green.
   *
   * ## ⚑ What is actually in that window, measured at `cf87667`
   *
   * `window:check` opens the app on a fresh `--user-data-dir` and its docblock used to say it opens
   * no provider session. It does not — and the launcher does: `RuntimeScreen`'s mount watcher asks
   * for the model catalogue, `RuntimeHost.askProviderForModels` calls `prepareProviderHome` and
   * spawns a real provider child per provider, **with no gesture from anybody**. Sampled with `ps`
   * every 150 ms across 50 interleaved runs on `main` and on `integ-352-354`, while the machine was
   * under another dispatch's load: **a `codex app-server` AND a Claude CLI child for every one of
   * the 23 launches seen on one tree and all 22 on the other**. `codex-transport.ts` spawns it
   * `detached: true`, so it leads its OWN process group and the group signal below never reaches it;
   * `adopt/user-homes.ts` measured what it writes before anybody asks it anything: **71 files** —
   * four SQLite databases with their WALs, an `installation_id`, and the whole `skills/.system` tree.
   *
   * ⚠️ **And it is LOAD-GATED, which is what makes the failure intermittent.** The same probe run
   * again at load 34-90 saw **none**: the check tore the app down in 0.5 to 2.6 s, before the
   * launcher's watcher had fired. At load 92-195 the same teardown took 6 to 17 s and the child was
   * always there. ⛔ So the race is not rare, it is busy-machine-shaped — which is exactly when `ci`
   * runs.
   *
   * ## ⚑ `SIGSTOP` is what makes the scan sound rather than lucky
   *
   * A stopped process runs no code: it cannot spawn a child and it cannot write a byte. So the order
   * is **freeze → scan → freeze what the scan found → scan again**, and it converges because nothing
   * frozen can add to it. ⛔ **That is a closure, not a smaller window.** What the last scan finds is
   * everything there is, and the kill below then has authority over all of it.
   *
   * ⛔ **Only on the crash path.** A frozen app cannot run its own shutdown, so `stop()` — the
   * graceful SIGTERM ladder `quit:check` measures — must never come through here.
   *
   * ⚠️ **Not being able to freeze something is not the same as there being nothing to freeze.** A
   * launch that has GONE, been collected, is on its way out, or whose pid has changed hands can
   * spawn nothing, so none of those is a refusal. A pid that reads `alive` and will not take the
   * signal, or that `ps` could not be asked about, is: the scan after it cannot be trusted, and
   * {@link teardown} reports that as its third answer rather than as a fourth flavour of success.
   */
  const freeze = (identity, refused, options) => {
    const { state, signalled } = signalSaved(identity, 'SIGSTOP', options)
    if (signalled) return
    if (state.kind === 'unverifiable' || state.kind === 'unsignallable') {
      const code = state.error?.code ?? state.error?.message
      refused.push(
        `pid ${String(identity.pid)} reads ${state.kind}${code ? ` (${String(code)})` : ''}, so it ` +
          `could not be frozen and the scan for what it may have spawned cannot be trusted`,
      )
    }
    // ⚠️ No verdict returned, because `refused` IS the verdict and a second one would be a value
    // every caller could ignore. `gone`, `collected`, `exiting` and `replaced` fall through here:
    // none of them can spawn a child behind the scan, so none of them is a refusal.
  }

  /**
   * ⛔ **Stop everything owned, then let discovery run until it stops finding anything new.**
   *
   * ⚠️ **The second pass is not caution, it is the detached child.** The group signal freezes the
   * launcher, the browser and every helper that stayed in the group — but not a child that called
   * `setsid`, which keeps running until the pass below signals it by pid. In that interval it can
   * spawn one of its own, so one more scan is owed. Beyond {@link FREEZE_PASSES} the tree is not
   * settling, and a bound that keeps trying is the retry loop this module refuses to be.
   *
   * ⚠️ **What is still open, said rather than claimed shut.** The kill loop below takes its own
   * `discover()` on every attempt, and a pid that appears there was never frozen — it can only be
   * one this pass's `ps` failed to report, since nothing stopped can spawn. It is signalled in the
   * same synchronous pass that finds it, so the interval is a `ps` read wide and no removal happens
   * inside it; that is a smaller claim than the one above and it is the honest one.
   */
  const quiesce = (refused, discover) => {
    if (launcher.pgid === launcher.pid) freeze(launcher, refused, { group: true })
    else freeze(launcher, refused, {})
    for (const identity of [...remembered.values()]) {
      freeze(identity, refused, { allowInitReparent: true })
    }
    for (let pass = 0; pass < FREEZE_PASSES; pass += 1) {
      const before = new Set(remembered.keys())
      discover()
      const fresh = [...remembered.values()].filter((identity) => !before.has(identity.pid))
      if (fresh.length === 0) return
      for (const identity of fresh) freeze(identity, refused, { allowInitReparent: true })
    }
    refused.push(
      `the descendant scan was still finding processes nobody had frozen after ` +
        `${String(FREEZE_PASSES)} passes, so this teardown cannot say what it owns`,
    )
  }

  /**
   * ⛔ **Three ways of not being finished, and `complete` is the absence of all three.**
   *
   * ⚠️ `exiting` is the one this had no name for until 333, and its absence did not read as a gap:
   * a pid whose identity no longer matched fell through both `if`s and completion was computed over
   * an empty list. The teardown then said complete and the caller removed the directory those
   * processes were still flushing into, which is `ENOTEMPTY` on a green product, three re-runs
   * clean, and a gate that looks like flake the next time it fires.
   *
   * ⚑ **`replaced` and `collected` are the two that legitimately stop nothing**, and they are worth
   * saying out loud because "counted as neither" is the shape of the defect above. A `replaced` pid
   * is somebody else's process and was never ours to wait for. A `collected` one is ours and has
   * already released everything it held — see {@link ZOMBIE}; waiting for it means waiting for the
   * caller's own event loop, which this teardown is blocking.
   */
  const inspect = () => {
    const alive = []
    const exiting = []
    const unverifiable = []
    const all = [[launcher, false], ...[...remembered.values()].map((identity) => [identity, true])]
    for (const [identity, allowInitReparent] of all) {
      const state = stateOf(identity, allowInitReparent)
      if (state.kind === 'alive') alive.push(identity.pid)
      if (state.kind === 'exiting') exiting.push(identity.pid)
      if (state.kind === 'unverifiable') unverifiable.push(identity.pid)
    }
    return {
      alive,
      exiting,
      unverifiable,
      complete: alive.length === 0 && exiting.length === 0 && unverifiable.length === 0,
    }
  }

  const disarm = () => {
    if (!armed) return
    if (typeof eventEmitter.off === 'function') eventEmitter.off('exit', onExit)
    else eventEmitter.removeListener('exit', onExit)
    armed = false
  }

  const teardown = ({ crash, explicit }) => {
    if (completedResult) return completedResult
    let signals = 0
    let discoveryComplete = true
    // ⛔ Uncertainty is sticky, so the AND is over every scan this teardown makes rather than the
    // last one: a window that could not be read stays unread however many later ones succeed.
    const discover = () => (discoveryComplete = refreshDescendants() && discoveryComplete)
    // ⛔ **Freeze before the scan, and only where there is nothing to unwind** (360). See
    // {@link quiesce}: `stop()` is the graceful ladder and a stopped app cannot run its own
    // shutdown, so the crash path is the only one that may take the tree out of the scheduler.
    //
    // ⚠️ **Deliberately NOT wrapped in a `try`, and the reason is the thing to check when editing
    // it.** A throw between the `SIGSTOP` and the kill below would leave the whole tree STOPPED —
    // worse than the race it came to close — so `quiesce` must not be able to throw, and today it
    // cannot: every seam it reaches (`signalSaved` around `killer`, `stateOf` around `readIdentity`,
    // `refreshDescendants` around discovery and `remember`) already contains its own failure and
    // returns it. ⛔ A `catch` here would be a guard no mutation can kill, which is a guard that is
    // carrying nothing; the rule belongs in this sentence and in what the seams already do.
    const refused = []
    // ⚑ **One or the other, and not both** (360): `quiesce` ends with a scan that found nothing new
    // in a tree that is entirely stopped, so a further scan here could only ever add a pid the
    // freeze has NOT covered — the opposite of what this path is for.
    if (crash) quiesce(refused, discover)
    else discover()
    let last = inspect()
    for (let attempt = 0; attempt < maxAttempts && !last.complete; attempt += 1) {
      // ⛔ **Discovery again, as LATE as it can be, and this is a measurement rather than caution**
      // (333). `inspect()` above is one `ps` per remembered pid times three fields: **81 ms** on a
      // seven-pid lifecycle on an idle machine, and two to three times that under a full `pnpm run
      // ci`. That is a window in which the app we are about to kill is still running and can still
      // spawn — and a provider child spawned there is `detached`, so it leads its OWN process group
      // and the group signal below does not reach it. ⚠️ It shrinks that window to one `ps -A`
      // (**29 ms** measured); it does not close it, and `refreshDescendants` is a no-op once the
      // launcher is gone, so from the second attempt on this costs one identity read.
      discover()
      const signal = crash || attempt >= termAttempts ? 'SIGKILL' : 'SIGTERM'

      // A negative pid is permitted only while the originally captured launcher still occupies
      // its pid and still leads that exact group. A replacement process never grants group-kill
      // authority merely by inheriting the old number.
      if (launcher.pgid === launcher.pid) {
        if (signalSaved(launcher, signal, { group: true }).signalled) signals += 1
      } else if (signalSaved(launcher, signal).signalled) {
        // Defensive fallback for a caller that did not actually spawn detached: one owned pid,
        // never somebody else's process group.
        signals += 1
      }

      // Reparenting to init is the expected orphan path. Every other parent change withdraws the
      // saved authority, even if all the other fields happen to match.
      for (const identity of remembered.values()) {
        if (signalSaved(identity, signal, { allowInitReparent: true }).signalled) signals += 1
      }

      last = inspect()
      if (!last.complete && attempt + 1 < maxAttempts) {
        try {
          timers.pause(intervalMs)
        } catch {
          // A broken pause must not turn an exit handler into a throw. The next identity check is
          // still useful and completion will remain false if the process cannot be verified.
        }
      }
    }

    const unverifiable = [...last.unverifiable]
    if (!discoveryComplete && !unverifiable.includes(launcher.pid)) unverifiable.push(launcher.pid)
    const result = Object.freeze({
      // ⛔ **`refused` is a third answer, not a fourth flavour of success** (360, and `350`'s
      // vocabulary by way of `352`'s `clean-base`). A teardown that could not establish what it
      // owns has not completed, however quiet the process table looks: the caller's next act is to
      // remove a directory, and it may only do that behind a fact.
      complete: last.complete && discoveryComplete && refused.length === 0,
      signals,
      remaining: Object.freeze([...last.alive]),
      // ⚠️ Its own field rather than folded into `remaining`, because the two ask for different
      // things from a person reading a red line: a pid in `remaining` is an app still RUNNING and
      // is 241's failure; a pid here is one that outlasted {@link maxAttempts} on its way out, and
      // the question that raises is about this bound, not about a leak.
      exiting: Object.freeze([...last.exiting]),
      unverifiable: Object.freeze(unverifiable),
      // ⚠️ What this teardown will not decide about, in sentences rather than pids: the things here
      // are not processes we are waiting for, they are questions we could not ask.
      refused: Object.freeze([...refused]),
    })
    if (result.complete) {
      completedResult = result
      if (explicit) disarm()
    }
    return result
  }

  function onExit() {
    // EventEmitter removes a `once` listener before calling it.
    armed = false
    teardown({ crash: false, explicit: false })
  }

  /**
   * 🔴 **Signal the saved group, and say WHY when it will not** (345 §2, from 342's failure list).
   *
   * ## ⛔ One sentence stood for at least six answers
   *
   * `342` ran `smoke:ui` step 38 — the only step in the instrument that signals one launch twice —
   * and it died on *"refusing to signal launch because its saved process identity no longer
   * matches"*. ⚠️ **That sentence is false for most of the ways it can be reached.** The refusal
   * fires whenever this returns `signalled: false`, and the paths are:
   *
   *  - `gone` — the launcher **exited**, which is not an identity mismatch at all and is the
   *    ordinary end of a supervisor whose child has finished;
   *  - `collected` — a zombie row, likewise no mismatch;
   *  - `exiting` — still the process we launched, mid-teardown, deliberately not signallable;
   *  - `replaced` — a pid that changed hands, which is the ONE case the old sentence described;
   *  - `unverifiable` — `ps` itself could not be asked;
   *  - `unsignallable` — `ps` answered `alive` and the KERNEL refused the signal, `ESRCH` when the
   *    group emptied inside the window between the read and the kill and `EPERM` when it is not ours
   *    to signal. ⚠️ **It shared `unverifiable`'s word until review measured the two arms byte-equal**,
   *    which would have sent the next reader to a `ps` problem that had not happened;
   *  - `refreshDescendants` returning false, which has four sub-causes of its own.
   *
   * ⛔ **`342` could not tell them apart from the artefacts**, and the difference decides whether
   * step 38's premise is gone or the app failed to quit. Its own database said `ended`, 14/14 frames
   * archived and no `-wal` — a clean shutdown — so *"identity no longer matches"* was almost
   * certainly reporting a launcher that had simply finished. ⚑ **Almost certainly is not a
   * measurement**, and one sentence for six states is why. The next run says which.
   *
   * ⚠️ **`signal` keeps returning a boolean**, because it is this lifecycle's published shape and an
   * object is always truthy — a caller written `if (!lifecycle.signal(…))` would read every refusal
   * as a signal that was sent. ⛔ **There is no such caller today, and saying so is the honest form
   * of the claim**: `ui-live-smoke.mjs`'s wrapper was the last one and this dispatch moved it to
   * `signalWhy`, so the narrowing is now held by `owned-process.test.mjs` alone.
   *
   * @param {string} signal
   * @returns {{ signalled: boolean, why: string }} `why` is `'sent'` on success.
   */
  function signalWhy(signal = 'SIGINT') {
    if (!refreshDescendants()) {
      // Read only on the refusal path: the launcher's own state is what says whether the re-scan
      // failed because the thing being scanned had ended, or for a reason of its own.
      return {
        signalled: false,
        why: `the descendant re-scan could not be trusted, and the launcher reads ${stateOf(launcher, false).kind}`,
      }
    }
    const result = signalSaved(launcher, signal, { group: launcher.pgid === launcher.pid })
    if (result.signalled) return { signalled: true, why: 'sent' }
    // The errno is the whole content of an `unsignallable`, and it is the only refusal that has one.
    const code = result.state.error?.code ?? result.state.error?.message
    return {
      signalled: false,
      why: `the launcher reads ${result.state.kind}, not alive${code ? ` (${code})` : ''}`,
    }
  }

  /**
   * 🔴 **722 · signal ONE remembered process by its saved identity — the app's own main process,
   * for `smoke:ui` step 38's second quit** (`717` F-3).
   *
   * ⛔ **{@link signalWhy} reaches the group only through the launcher, and the launcher does not
   * outlive `pnpm`.** `owned-launcher.mjs` exits when its child does, and a group SIGINT ends `pnpm`
   * in milliseconds while Electron spends a second on its ordered shutdown (`717`'s app log: *"shut
   * down in 1239ms"*). So step 38's second SIGINT, 50 ms after the first, met a launcher that read
   * `gone` in `427`, `680`, `695`, `697` and `717`, and 068's claim — a second quit landing in the
   * middle of the first — was never exercised. ⚑ The app is still there, its parent gone or going;
   * this reaches it with the authority teardown already uses for a remembered pid
   * (`allowInitReparent`), and refuses in {@link signalWhy}'s words, naming the state.
   *
   * @param {number} pid — a pid this lifecycle remembered; the launcher's own is not one.
   * @param {string} signal
   * @returns {{ signalled: boolean, why: string }} `why` is `'sent'` on success.
   */
  function signalRememberedWhy(pid, signal = 'SIGINT') {
    const saved = remembered.get(positiveInteger(pid, 'pid'))
    if (!saved) {
      return { signalled: false, why: `pid ${String(pid)} is not a process this launch remembered` }
    }
    const result = signalSaved(saved, signal, { allowInitReparent: true })
    // ⚠️ Spelled apart from `signalWhy`'s line on purpose: a byte-identical copy made `345` M21's
    // anchor ambiguous (`copying-a-loop-copies-its-mutation-anchor`).
    if (result.signalled) return { why: 'sent', signalled: true }
    const code = result.state.error?.code ?? result.state.error?.message
    return {
      signalled: false,
      why: `pid ${String(pid)} reads ${result.state.kind}, not alive${code ? ` (${code})` : ''}`,
    }
  }

  eventEmitter.once('exit', onExit)

  return Object.freeze({
    launcher,
    remember,
    refreshDescendants,
    signal: (signal = 'SIGINT') => signalWhy(signal).signalled,
    signalWhy,
    signalRememberedWhy,
    stop: () => teardown({ crash: false, explicit: true }),
    kill9: () => teardown({ crash: true, explicit: true }),
    get armed() {
      return armed
    },
    get identities() {
      return Object.freeze([launcher, ...remembered.values()])
    },
  })
}
