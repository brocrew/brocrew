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
 * The `ps` STAT letter for a process that has exited and not yet been collected by its parent.
 *
 * A zombie holds no descriptors or memory, so for "can anything we launched still touch this
 * directory?" it is gone. It is also an artefact this module creates: the launcher is the caller's
 * direct child, and {@link blockingPause} stops the event loop, so nothing collects it while a
 * teardown runs. Measured: it read `Z` for 3 s while the loop was blocked and was gone within
 * 300 ms of release. Counting it as "still there" ran every teardown to its 40-attempt bound
 * (13 to 16 seconds) on a green product.
 */
const ZOMBIE = 'Z'

/**
 * How many times a frozen tree may still hand back a process nobody had seen. One pass is the
 * ordinary case; a second is owed because a `detached` child leads its own group, so the group
 * signal does not reach it until the pass that freezes it by pid, and in that interval it can spawn
 * one of its own. Beyond that the tree is not settling, and a bound that keeps trying is the retry
 * loop `owned-teardown.mjs` refuses to be. See {@link createOwnedProcessLifecycle}'s `quiesce`.
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
    // Read, never remembered. It is deliberately absent from {@link IDENTITY_FIELDS} and from
    // `sameRememberedProcess`: a process moves between `S`, `R` and `SN` while it runs, so folding it
    // into the saved authority would make every re-read look like a different process. It is compared
    // against nothing, and only {@link ZOMBIE} is ever read off it.
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

  // `state` rides along in the call that was already being made. `lstart` stays last because it is
  // the only multi-word field, and a field added after it would be eaten by its own `.+?`.
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
 * Is this pid the same process, whatever it now calls itself?
 *
 * `lstart` is the moment the kernel started the process. Nothing the process does changes it (not
 * `exec`, not `setsid`, not losing its parent), so it is the only identity field a live process
 * cannot alter, and "still ours" is read off it rather than the name.
 *
 * macOS rewrites `comm` and `command` to the parenthesised form (`(Electron)`) once a process can
 * no longer be asked for its arguments, while it is still in the table and still flushing files. An
 * Electron browser spent 535 ms after SIGKILL reading like that. {@link sameRememberedProcess},
 * which compares all six fields, then said `replaced`, which counted as neither alive nor
 * unverifiable: 19 of 70 measured `window:check` runs called the teardown complete with four to
 * six of their own processes still in the table.
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
      // A row, not a process; see {@link ZOMBIE}. Checked above every identity comparison: on macOS a
      // zombie's `comm` becomes `<defunct>` so it could not read as `alive` anyway, but that is a fact
      // about one `ps`, not a property of the state. A platform that left the name alone would make this
      // read `alive` and the teardown would signal a table row until its bound ran out.
      if (current.runState.startsWith(ZOMBIE)) return { kind: 'collected' }
      if (sameRememberedProcess(saved, current, { allowInitReparent })) {
        return { kind: 'alive', current }
      }
      // Still there, and still the process we launched; see {@link isTheSameProcess}. Authority to
      // signal is not granted: there is nothing left to signal, and the full identity is what earns a
      // `kill`. What it grants is the right to be waited for.
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
      // Its own kind, because it is its own fact. This arm is reached only after `stateOf` already
      // answered `alive`: the launcher was there and the kernel refused the signal, `ESRCH` when the
      // group emptied between the read and the kill, `EPERM` when it is not ours to signal. Reporting
      // that as `unverifiable` would say `ps` could not be asked when it answered fine.
      return { state: { kind: 'unsignallable', error }, signalled: false }
    }
  }

  /**
   * Freeze the tree, and only then enumerate it.
   *
   * A small window is a window the machine's load decides. The provider child (`codex app-server`,
   * spawned `detached` with no gesture from anybody when the launcher's mount watcher asks for the
   * model catalogue) leads its own group, so the group signal never reaches it, and it writes dozens
   * of files before anybody asks it anything. The race is load-gated: measured, a fast teardown (0.5
   * to 2.6 s) beat the watcher and saw no child, while at load 92 to 195 the teardown took 6 to 17 s
   * and the child was always there. So it bites on a busy machine, which is when `ci` runs.
   *
   * `SIGSTOP` makes the scan sound rather than lucky: a stopped process can spawn nothing and write
   * nothing. The order is freeze, scan, freeze what the scan found, scan again; it converges because
   * nothing frozen can add to it, and the kill below then has authority over all of it.
   *
   * Crash path only. A frozen app cannot run its own shutdown, so `stop()` (the graceful SIGTERM
   * ladder `quit:check` measures) must never come through here.
   *
   * Not being able to freeze something is not the same as there being nothing to freeze. A launch
   * that is gone, collected, exiting or whose pid has changed hands can spawn nothing, so none of
   * those is a refusal. A pid that reads `alive` and will not take the signal, or that `ps` could not
   * be asked about, is: the scan after it cannot be trusted, and {@link teardown} reports that as its
   * third answer.
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
    // No verdict is returned, because `refused` is the verdict and a second one would be a value every
    // caller could ignore. `gone`, `collected`, `exiting` and `replaced` fall through: none of them
    // can spawn a child behind the scan.
  }

  /**
   * Stop everything owned, then let discovery run until it stops finding anything new.
   *
   * The second pass is for the detached child: the group signal freezes the launcher, the browser and
   * every helper still in the group, but not a child that called `setsid`, which keeps running until
   * the pass below signals it by pid and can spawn in that interval. Beyond {@link FREEZE_PASSES} the
   * tree is not settling.
   *
   * Still open: the kill loop takes its own `discover()` on every attempt, and a pid found there was
   * never frozen (it can only be one this pass's `ps` failed to report). It is signalled in the same
   * synchronous pass that finds it, so the interval is one `ps` read wide and no removal happens
   * inside it.
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
   * Three ways of not being finished; `complete` is the absence of all three.
   *
   * `exiting` needs its own name: a pid whose identity no longer matched used to fall through both
   * `if`s and completion was computed over an empty list, so the caller removed a directory those
   * processes were still flushing into.
   *
   * `replaced` and `collected` legitimately stop nothing. A `replaced` pid is somebody else's
   * process and was never ours to wait for. A `collected` one is ours and has released everything it
   * held (see {@link ZOMBIE}); waiting for it means waiting for the caller's own event loop, which
   * this teardown is blocking.
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
    // Uncertainty is sticky, so the AND is over every scan this teardown makes: a window that could
    // not be read stays unread however many later ones succeed.
    const discover = () => (discoveryComplete = refreshDescendants() && discoveryComplete)
    // Freeze before the scan, and only where there is nothing to unwind. See {@link quiesce}: `stop()`
    // is the graceful ladder and a stopped app cannot run its own shutdown, so only the crash path
    // may take the tree out of the scheduler.
    //
    // Deliberately not wrapped in a `try`. A throw between the `SIGSTOP` and the kill below would
    // leave the whole tree stopped, so `quiesce` must not be able to throw, and today it cannot: every
    // seam it reaches (`signalSaved` around `killer`, `stateOf` around `readIdentity`,
    // `refreshDescendants` around discovery and `remember`) already contains its own failure and
    // returns it.
    const refused = []
    // One or the other, not both: `quiesce` ends with a scan that found nothing new in a tree that is
    // entirely stopped, so a further scan here could only add a pid the freeze has not covered.
    if (crash) quiesce(refused, discover)
    else discover()
    let last = inspect()
    for (let attempt = 0; attempt < maxAttempts && !last.complete; attempt += 1) {
      // Discovery again, as late as it can be. `inspect()` above is one `ps` per remembered pid times
      // three fields: 81 ms on a seven-pid lifecycle on an idle machine, two to three times that under
      // a full `pnpm run ci`. In that window the app is still running and can spawn a `detached`
      // provider child that the group signal below does not reach. This shrinks the window to one
      // `ps -A` (29 ms measured) without closing it, and `refreshDescendants` is a no-op once the
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
      // `refused` is a third answer, not a fourth flavour of success. A teardown that could not
      // establish what it owns has not completed, however quiet the process table looks: the caller's
      // next act is to remove a directory, and it may only do that behind a fact.
      complete: last.complete && discoveryComplete && refused.length === 0,
      signals,
      remaining: Object.freeze([...last.alive]),
      // Its own field rather than folded into `remaining`, because the two ask for different things
      // from a person reading a red line: a pid in `remaining` is an app still running; a pid here
      // outlasted {@link maxAttempts} on its way out, which raises a question about this bound, not a
      // leak.
      exiting: Object.freeze([...last.exiting]),
      unverifiable: Object.freeze(unverifiable),
      // What this teardown will not decide about, in sentences rather than pids: these are not
      // processes we are waiting for, they are questions we could not ask.
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
   * Signal the saved group, and say why when it will not. `signalled: false` has several distinct
   * causes, and one refusal sentence for all of them would be false for most:
   *
   *  - `gone`: the launcher exited, which is not an identity mismatch;
   *  - `collected`: a zombie row, likewise no mismatch;
   *  - `exiting`: still the process we launched, mid-teardown, deliberately not signallable;
   *  - `replaced`: a pid that changed hands, the only real identity mismatch;
   *  - `unverifiable`: `ps` itself could not be asked;
   *  - `unsignallable`: `ps` answered `alive` and the kernel refused the signal (`ESRCH` when the
   *    group emptied between the read and the kill, `EPERM` when it is not ours to signal);
   *  - `refreshDescendants` returning false, which has several sub-causes of its own.
   *
   * `signal` keeps returning a boolean because it is this lifecycle's published shape, and an object
   * is always truthy: a caller written `if (!lifecycle.signal(...))` would read every refusal as a
   * signal that was sent. No such caller exists today, so the narrowing is held by
   * `owned-process.test.mjs` alone.
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
   * Signal one remembered process by its saved identity: the app's own main process, for the second
   * quit in `smoke:ui`.
   *
   * {@link signalWhy} reaches the group only through the launcher, and the launcher does not outlive
   * `pnpm`: `owned-launcher.mjs` exits when its child does, and a group SIGINT ends `pnpm` in
   * milliseconds while Electron spends about a second on its ordered shutdown. A second SIGINT 50 ms
   * after the first therefore met a launcher that read `gone`. The app is still there, so this
   * reaches it with the authority teardown already uses for a remembered pid (`allowInitReparent`),
   * and refuses in {@link signalWhy}'s words, naming the state.
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
    // Spelled apart from `signalWhy`'s line on purpose: a byte-identical copy made a mutation anchor
    // ambiguous (`copying-a-loop-copies-its-mutation-anchor`).
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
