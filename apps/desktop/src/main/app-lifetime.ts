/**
 * **The database and the runtime host are APP-scoped, not window-scoped** (051, from 048 §1
 * finding 4).
 *
 * That sentence is the whole module. It was not true before, and it was not false either — it was
 * two answers running at once. The host was created once at `whenReady` and captured by the IPC
 * handlers forever; the database was created beside it and then closed by `window-all-closed`, an
 * event that on macOS means "the user closed a window", not "the application is over". Electron
 * deliberately keeps a Mac app alive with no windows, and `activate` makes a new one — so:
 *
 *  - **closing the last window on macOS killed the app without quitting it.** Reopening built a
 *    window over a host and a store backed by a closed SQLite connection. Every command that touches
 *    the database throws `The database connection is not open` (measured, not assumed —
 *    better-sqlite3's own message), including `app:info`, so the start screen itself rejects.
 *  - **it also stopped archive work permanently.** `stopSweeping()` sets a sticky flag that nothing
 *    clears, by design — its only intended caller is teardown. Called when a window closed, it made
 *    every later import a silent no-op for the rest of the process's life.
 *  - **elsewhere, the shutdown ran in the wrong order — deterministically, not as a race.** On every
 *    other platform `window-all-closed` closed the database and THEN called `app.quit()`, so
 *    `before-quit`'s `await host.closeAll()` always ran against a connection that was already gone:
 *    every session's final ledger row and archive write failed on the way out. (Window destruction
 *    also starts an owner close without awaiting it, which is a genuine race on top.)
 *
 * So this module picks the option the review asked to be picked and names it: the resources live as
 * long as the APP. A window going away closes that window's sessions — which is a different fact,
 * owned by the window (`webContents.on('destroyed')` in `index.ts`), and the reason nothing about
 * sessions appears below. `window-all-closed` is left with the only question that is genuinely its
 * own: on this platform, is an app with no windows over?
 *
 * The other half — everything shuts down in one order, once — is {@link AppLifetime.beforeQuit}.
 *
 * Extracted from `index.ts` for the same reason 050 extracted `window-navigation.ts`: the
 * composition root imports `electron` as a value and cannot be loaded by a test, so policy written
 * there is policy nothing can check. Nothing here imports Electron at all.
 */

export interface AppLifetimeDeps {
  /**
   * ⛔ **Tell every window the app is closing — SYNCHRONOUSLY, before anything is awaited** (271 §2).
   *
   * The half of a quit a person actually experiences is the window, and until this line the window
   * was told nothing at all. It sat there fully drawn and fully interactive for the whole ordered
   * teardown below, then vanished; `270` reported the far end of that as *"a dead-looking black
   * app"*, and the one thing a person could tell about it was that nothing was happening.
   *
   * ⚠️ **Its position is the whole of it.** Announced after the first `await` it would be a race
   * against the very step that takes the time, and on the idle app — where the teardown finishes
   * inside one microtask drain (or, since `744`, one draft save's round trip) — it would never be
   * seen at all. So it is the first statement of the
   * deferred quit, ahead of `stopArchiveWork`.
   *
   * ⚑ It also closes the gap `270` measured from the other side: *"it emitted database-closed IPC
   * errors"*. {@link AppLifetimeDeps.closeDatabase} runs while the window is still up, so a renderer
   * that keeps asking after it gets better-sqlite3's `The database connection is not open` for every
   * poll. A renderer that has been told stops asking.
   */
  announceClosing: () => void
  /**
   * Close and finalize every live session. The quit WAITS for this: provider children are spawned
   * into their own process groups, so an abrupt exit can leave one running after the app is gone.
   */
  closeAllSessions: () => Promise<void>
  /**
   * 🔴 **744 · R100 — wait, bounded, for each window's last draft book** — asked AFTER the sessions
   * are closed, because closing them refuses what was still in flight and a refusal puts its words
   * back in a window's book. Optional: a lifetime with nothing to keep has no such step, and its
   * report names only the four.
   */
  keepUnsentDrafts?: () => Promise<void>
  /**
   * Stop MAKING import work. Called only from the real shutdown — an import or a rebuild is catch-up
   * work and not something to hold a quit open for, but it must stop before the connection it
   * writes to closes.
   *
   * ⚠️ It does not stop work already in flight, and it never did; what changed in 062 is that it no
   * longer pretends to. See {@link AppLifetimeDeps.drainArchiveWork}.
   */
  stopArchiveWork: () => void
  /**
   * **Wait for the import work that IS in flight** (062, from 061 finding 1).
   *
   * The step that was missing: `stopArchiveWork` set one sticky flag and returned, and an import
   * admitted a moment earlier was still between batches when the connection closed underneath it.
   */
  drainArchiveWork: () => Promise<void>
  /** Close the SQLite connection — after the sessions are down and the imports have drained. */
  closeDatabase: () => void
  /** Ask Electron to quit again, now that the deferral is over. */
  quit: () => void
  /**
   * **Leave NOW, teardown or no teardown** — `app.exit()`, which raises no `before-quit` and waits
   * for nothing.
   *
   * The escape hatch {@link AppLifetime.quitSignal} buys with {@link IMPATIENT_EXIT_MS}, and the
   * reason absorbing repeated signals is not the same thing as ignoring them: an app that cannot be
   * stopped by SIGTERM is the defect 094 and 095 both reported, and 163 must not reintroduce it in
   * the course of fixing its opposite.
   */
  exit: (code: number) => void
  /**
   * 🔴 **A deadline that does not live in this process** (294, from `270` finding 1 and `294` §1).
   *
   * ⛔ **Every other bound in this module is a `setTimeout`, and after `app.quit()` a `setTimeout`
   * never comes due.** That is measured, not inferred — see {@link ELECTRON_EXIT_GRACE_MS}. So the
   * one promise that has to hold when the engine stops cannot be expressed the way the others are:
   * it has to be handed to something the engine does not own.
   *
   * ⚠️ **Called with the budget, and expected to return immediately.** Implementations arm and hand
   * back; nothing here awaits it, because the caller is about to stop being able to await anything.
   *
   * ⚑ **It is armed BEFORE `quit()` and it is not cancelled afterwards.** There is no line after the
   * quit on which a cancel could run. The mechanism is expected to stand down by noticing this
   * process is gone, which is the only signal that still exists once we are — see
   * `last-resort-exit.ts`, where that is the parent-pid check.
   *
   * ⚠️ **It also covers the promise {@link IMPATIENT_EXIT_MS} could not keep.** A repeat ⌘Q that
   * arrives while the four steps are running starts a timer that works, because JavaScript is still
   * running then; one that arrives after the quit starts a timer that never fires. In exactly that
   * case this bound is already armed and is shorter, so the app still leaves.
   */
  armLastResort: (withinMs: number) => void
  log: (message: string, error?: unknown) => void
  /**
   * Epoch milliseconds. Injected because the only way to report where a quit spent its time is to
   * measure it, and the only way to TEST that report is to own the clock.
   */
  now: () => number
}

/**
 * **How long a repeat quit signal waits before taking the app out from under its own teardown.**
 *
 * The two failure modes this sits between are both real and both measured. Exit too eagerly and you
 * are back to 068 finding 1 — providers still running, a ledger half-written, SQLite
 * closed by nobody. Never exit and SIGTERM stops working, which is what 094 and 095 reported and
 * what every agent, smoke and reaper on this machine depends on.
 *
 * So: twenty seconds. The ordered teardown of an app with one live provider session measures 1–2 s
 * end to end, so this is an order of magnitude of headroom rather than a guess about a fast machine;
 * and `066`'s reaper — SIGTERM, then a chase that signals up to ten more times over ~2.5 s — is
 * comfortably inside it, so being reaped politely still runs the whole shutdown rather than
 * force-exiting a third of the way through it.
 */
const IMPATIENT_EXIT_MS = 20_000

/**
 * 🔴 **How long Electron's OWN shutdown may take once ours is finished** (271, from `270` finding 1).
 *
 * ## What this stops waiting on, and why that is the honest place to stop
 *
 * ⛔ **`270` measured an idle ⌘Q leaving a live process and a held port for 60.489 s.** The four
 * ordered steps below cannot be where that went: on an idle app `closeAllSessions` walks two empty
 * maps, `drainArchiveWork` has nothing admitted to wait for, and `closeDatabase` is one synchronous
 * better-sqlite3 call — measured end to end at **0.4–2.6 s across eight quits** (SIGTERM ×7 and two
 * real ⌘Q presses, one of them on `270`'s own surviving instance). ⚠️ **The minute did not reproduce
 * on this machine and this dispatch does not claim to know what spent it** — see the response. What
 * IS provable is where it CANNOT have been, and that leaves everything after {@link
 * AppLifetimeDeps.quit}: Chromium closing its windows, stopping its utility processes, and flushing
 * caches that belong to it and not to us.
 *
 * ⚑ **So this is the one wait this dispatch removes, and it names what it costs.** By the time it is
 * armed, every promise the shutdown exists to keep has been kept: no provider child is running, the
 * imports have drained, and SQLite is closed in order. What is left is Chromium's own tidying —
 * `Local Storage`, `Cookies`, `GPUCache`, the network service's on-disk state. Those are written by
 * a browser engine that is killed by users, reapers and crashes every day and recovers from all
 * three; ours are not, which is exactly why they go first.
 *
 * ⚠️ **What we give up, said plainly:** a cache that would have been flushed may be re-derived on the
 * next launch, and a cookie written in the last instant may be lost. ⛔ **What we do NOT give up is
 * anything in the ordered steps** — this timer cannot start until every one has returned (four, or
 * five with `744`'s unsent drafts).
 *
 * **Two seconds**, and the number is measured rather than chosen. With the shutdown report below
 * wired up, four instrumented idle quits agreed to within two milliseconds of each other:
 *
 * | stamp | +ms from the quit gesture |
 * |---|---|
 * | all four ordered steps finished | **1–2** |
 * | Electron's `will-quit` | 103–105 |
 * | Electron's `quit` | 103–105 |
 * | the process actually gone (external `lsof`/`kill -0`, 50 ms poll) | 508–521 |
 *
 * ⛔ **Read the first row against `270`'s 60.489 s.** Everything this module owns is done in two
 * milliseconds; the whole span this timer bounds — `app.quit()` to the process being gone — is
 * about **505 ms**, so two seconds is roughly **four times** the observed worst case and still
 * invisible to a person.
 *
 * ## 🔴 **It was a JavaScript timer, and that made it decorative** (294)
 *
 * ⛔ **This bound never once fired.** `271` wrote it as `setTimeout(…).unref()` with the note *"the
 * message loop keeps the process alive while it is shutting down, so it still fires"*. It does not.
 * Measured across 30-second hangs: the hatch was armed on every run and fired on none, and a
 * **ref**'d 250 ms `setInterval` armed on the line before `app.quit()` produced **zero ticks** in a
 * process that then stayed alive for another twenty-five seconds. ⚑ So the limit was not `unref`
 * and not a wedged native call: **once Electron begins its quit, main-process JavaScript stops
 * running at all**, and every deadline expressed as a timer in it is a promise the app cannot keep.
 *
 * ⚠️ **A worker thread is not the answer either, and it was tried before the expensive one.** Both
 * `unref`'d and `ref`'d, a worker armed at the same moment failed to fire in 6/6 and 2/4 hangs.
 *
 * ⛔ **And the thing being bounded is Electron's, not ours.** Twenty lines of bare Electron 43.2.0 —
 * one window, no BroBot code — hang in **5 of 6** loaded quits, printing `will-quit` and `quit`
 * first, exactly as this app does. There is nothing here to fix; there is only a bound to enforce,
 * and it has to be enforced from outside the process. See {@link AppLifetimeDeps.armLastResort}.
 *
 * **Two seconds**, unchanged from 271, and the measurement it rests on is unchanged too: with the
 * shutdown report wired up, four instrumented idle quits agreed to within two milliseconds.
 *
 * | stamp | +ms from the quit gesture |
 * |---|---|
 * | all four ordered steps finished | **1–2** |
 * | Electron's `will-quit` | 103–105 |
 * | Electron's `quit` | 103–105 |
 * | the process actually gone (external `lsof`/`kill -0`, 50 ms poll) | 508–521 |
 *
 * ⚠️ **What it now costs when it DOES fire, said plainly:** the app is killed rather than asked, so
 * Chromium's own tidying is skipped — the same trade this constant already described, except that
 * it now actually happens. ⛔ **What it still does not cost is anything in the four steps**, which
 * have all returned and been reported before this is armed.
 */
const ELECTRON_EXIT_GRACE_MS = 2_000

/**
 * Above this, the one-line shutdown report is a warning rather than a note.
 *
 * ⚠️ **The report is written on EVERY quit and this only changes its voice**, which is the point: a
 * number nobody prints is a number nobody has, and `270`'s minute cost a whole exploration run
 * precisely because the app said nothing about where it went. Three seconds is above every idle quit
 * measured (0.4–2.6 s) and well below the bound `closeAll` already carries for one stuck provider
 * (2 × `closeDrainTimeoutMs`, 10 s), so an ordinary busy quit is not a warning and a strange one is.
 */
const SLOW_TEARDOWN_MS = 3_000

export interface AppLifetime {
  /**
   * `before-quit`: defer EVERY quit until everything is down in order, then let one through.
   *
   * The deferral is unconditional, unlike the version this replaces — it deferred only when a
   * session was live, so a quit with no sessions ran the whole shutdown past nothing and reached the
   * database close only by way of `window-all-closed`, which does not fire on every quit. Closing
   * SQLite is now on this path and this path always runs.
   *
   * ⚠️ **"Every" includes the second one** (070, from 068 finding 1). Only the quit this module
   * issues itself, once the teardown has finished, is allowed through — see `readyToExit`. A user
   * pressing ⌘Q twice used to be indistinguishable from that quit, and the second press exited the
   * app through the middle of its own shutdown.
   *
   * 🔴 **…but a deferred press is now IMPATIENCE, and until 271 it was silence** (271 §2). Absorbing
   * the second ⌘Q was right and stopping there was not: the clock that guarantees the app can still
   * be got rid of hung off {@link quitSignal} alone, so **an app that would not close could be
   * insisted on from a terminal and not from the keyboard.** ⛔ That is the person in `270`'s
   * finding — *"a person who tries to quit and relaunch sees a dead-looking black app while the old
   * instance still owns the port"* — pressing the one key that could have helped and being answered
   * by nothing at all. The two doors now start the same clock; see {@link IMPATIENT_EXIT_MS}, whose
   * length has NOT changed.
   */
  beforeQuit(event: { preventDefault(): void }): void
  /**
   * Electron reached one of its own late shutdown phases (`will-quit`, `quit`).
   *
   * ⚑ **Diagnostics, and the reason they earn a line** (271 §1). `270`'s minute was invisible because
   * the last thing this app ever said about a quit was nothing: the teardown finished, `app.quit()`
   * was called, and whatever happened next happened in Chromium with no record on either side of it.
   * These two stamps are the far end of {@link AppLifetime.shuttingDown}'s report, and together they
   * say whether a slow quit was ours or the engine's — which is the single question `270` could not
   * answer and the next person should not have to re-ask.
   */
  noteQuitPhase(phase: string): void
  /**
   * `window-all-closed`: on darwin the app lives on with no windows, which is the platform
   * convention and the reason nothing is torn down here. Everywhere else, no windows means over —
   * and the tear-down still happens in {@link beforeQuit}, reached through `quit()`.
   */
  windowAllClosed(platform: string): void
  /**
   * **A POSIX quit signal — and the SECOND one is the whole reason this method exists** (163, from
   * 070/068 finding 1).
   *
   * ## What the second signal did, and why no guard above it could help
   *
   * `beforeQuit` defers every quit including the tenth, and the handler reads correct. It was never
   * reached. Measured on bare Electron 43.2.0 — the binary this app runs — with an app shaped
   * exactly like this module (unconditional deferral, four ordered steps, `setImmediate` before the
   * final quit) and nothing else in it:
   *
   * | JS listener registered | signals | outcome |
   * |------------------------|---------|---------|
   * | none — the app until 163      | 1          | exit 0, all four steps · 3/3 |
   * | none                          | 2 @ 50 ms  | ⛔ **killed BY SIGINT ~58 ms in, no step finished** · 3/3 |
   * | top of the main script (075's)| 1          | exit 0, all four steps — and the listener **never fired** · 3/3 |
   * | top of the main script        | 2 @ 50 ms  | ⛔ **killed BY SIGINT ~58 ms in** · 3/3, both swallow and re-quit variants |
   * | from `whenReady`              | 1          | exit 0, all four steps, JS saw it · 4/4 |
   * | from `whenReady`              | 2 @ 50 ms  | ⚑ **exit 0, all four steps**, JS saw both · 4/4 |
   * | from `whenReady`              | 5 @ 30 ms  | ⚑ exit 0, all four steps, JS saw all five · 3/3 |
   * | from `whenReady`, to the process GROUP | 2 | ⚑ exit 0, all four steps · 3/3 |
   * | from `whenReady`, SIGTERM     | 2 @ 50 ms  | ⚑ exit 0, all four steps · 3/3 |
   *
   * "Killed BY SIGINT" is not a slow quit or a hung one: the child is reaped with `signal ===
   * 'SIGINT'` and no exit code, so **nothing in JavaScript runs at all** — the kernel takes the
   * process out from under a teardown that had reached its first step.
   *
   * The control that names the mechanism: on the rows where a top-of-script `SIGINT` listener never
   * fired, a `SIGUSR2` listener registered on the very next line **did** (2/2). So Node's signal
   * delivery works perfectly well in Electron's main process — `SIGINT`, `SIGTERM` and `SIGHUP` are
   * simply owned by Chromium's handler, which is installed after the main script has run, hands the
   * FIRST signal to `Browser::Quit()`, and then restores the default disposition. Chromium says why
   * in its own comment: *"Reinstall the default handler. We had one shot at graceful shutdown."*
   *
   * ⚠️ **So 075's conclusion — *"the second signal is acted on below JavaScript … this race is not
   * closable from here"* — was true of the code it measured and false as a general claim.** The
   * variable it did not vary is WHEN the listener is registered. Registered late, JS owns the
   * signal; every repeat then arrives here instead of at the kernel.
   *
   * ## What this does with them
   *
   * The first signal quits, which starts the ordered teardown. Every repeat is **absorbed** — the
   * teardown already running is the only thing left to do, and exiting through the middle of it is
   * the defect. But absorbed is not ignored: the first repeat starts {@link IMPATIENT_EXIT_MS}, after
   * which the app leaves regardless. A quit that cannot be insisted on is its own bug.
   */
  quitSignal(signal: string): void
  /** The shutdown in flight, or null. Exists so a test can await the order rather than sleep. */
  readonly shuttingDown: Promise<void> | null
}

/**
 * **Get off the `before-quit` callback's own stack before quitting again** (097).
 *
 * ## The bug this one line fixes
 *
 * The dev app ignored SIGTERM — observed by 094, again by 095 (*"same observation as 094, now
 * twice"*), and measured here: **it never exits at all.** Not twenty seconds, not sixty. Every
 * teardown that reached for it needed SIGKILL.
 *
 * It is ours, and it is this function's absence. Reproduced in twenty lines of bare Electron 43.2.0
 * — the very binary this app runs — with nothing in it but `preventDefault()` in `before-quit` and
 * an `app.quit()` from the promise that follows:
 *
 * | how the final `quit()` is scheduled | what Electron emits | result   |
 * |-------------------------------------|---------------------|----------|
 * | `Promise.resolve().then(…)`         | `window-all-closed` | **hangs forever** |
 * | `setImmediate(…)`                   | `will-quit` → `quit`| exits in 0.66 s |
 * | `setTimeout(…, 50)`                 | `will-quit` → `quit`| exits in 0.67 s |
 *
 * The same binary with no `preventDefault()` at all exits in 0.68 s. So the deferral is not the
 * problem and the teardown is not slow — the *scheduling* of the second quit is the whole of it.
 *
 * ## Why
 *
 * `Browser::Quit()` in Electron reads, in effect, `if (is_quitting_) return; is_quitting_ =
 * HandleBeforeQuit(); …`. Our handler runs inside `HandleBeforeQuit()`, calls `preventDefault()`,
 * and returns. A continuation scheduled as a MICROTASK then drains before control leaves that JS
 * entry — so `app.quit()` re-enters `Browser::Quit()` while the outer call is still on the stack,
 * sets `is_quitting_ = true`, and closes the windows. The outer frame then finishes its own
 * assignment with the value the FIRST handler produced — `false` — and overwrites it. When the last
 * window finally goes, Electron looks at `is_quitting_`, finds `false`, and emits `window-all-closed`
 * instead of shutting down. The app sits there with no windows, forever.
 *
 * Confirmed rather than inferred: a third `app.quit()` fired four seconds later, on a timer, from a
 * hung app with zero windows, produced `will-quit` and `quit` and exited. Had `is_quitting_` really
 * been `true`, that call would have early-returned and nothing would have happened.
 *
 * ## Why it hid for so long
 *
 * The window between the two is only microtask-sized when the teardown does no real I/O — an idle
 * app with no sessions, which is exactly the dev instance an agent or a smoke reaps. Quit a session
 * that is genuinely closing a provider and the awaits land on later macrotasks all by themselves,
 * and it exits normally. So the bug is invisible in every test that has a session in it.
 *
 * `setImmediate` rather than `setTimeout(0)` because it is the check phase — the earliest point that
 * is provably not this callback's microtask drain, which is the entire requirement.
 */
function leaveThisTurn(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

export function createAppLifetime(deps: AppLifetimeDeps): AppLifetime {
  let shutdown: Promise<void> | null = null
  /**
   * **The app may exit** — set on the last line before the quit this module issues itself (070, from
   * 068 finding 1).
   *
   * It replaces `shutdown !== null` as the answer to "let this quit through", and the two are not the
   * same question. `shutdown` becomes non-null at the START of the teardown; it says a shutdown is
   * *happening*, and the guard read it as *finished*. Every ⌘Q after the first one therefore went
   * straight past — while `closeAllSessions()` was still stopping providers and recording their
   * endings.
   *
   * That is not a slow quit; it is Electron exiting with providers running, a ledger half-written
   * and SQLite closed by nobody. It bypasses the exact ordering 062 exists to
   * guarantee, and it needs no unusual timing to reach — impatient double-⌘Q is how people quit
   * applications that do not close instantly.
   *
   * **Completion, not existence.** The comment this replaces said "the second `before-quit` is the
   * one `quit()` raises", and that was true of the only second event the author had in mind. The
   * user is also allowed to press it.
   */
  let readyToExit = false
  /** How many POSIX quit signals have arrived. The first quits; see {@link AppLifetime.quitSignal}. */
  let signalled = 0
  /** The impatience clock, started by the FIRST repeat and never restarted by the ones after it. */
  let forcedExit: ReturnType<typeof setTimeout> | null = null
  /** When the deferred quit began, so every stamp below is relative to the gesture. */
  let quitStartedAt: number | null = null
  /**
   * ⛔ **This module is inside its own `quit()` call**, so the `before-quit` about to arrive is a
   * re-entry it caused rather than somebody asking again.
   *
   * ⚠️ **It exists to preserve a decision 163 measured and stated** — *"the first SIGNAL, but the
   * second quit: a reaper's SIGTERM landing on an app the user has already asked to close … must not
   * be read as the impatient repeat it is not"*. `quitSignal(1)` and `windowAllClosed` both reach
   * Electron through `deps.quit()`, so without this flag 271's new impatience clock would start on
   * the first signal and quietly shorten that case from "take as long as it takes" to twenty
   * seconds. The doors a PERSON uses — the menu, the Dock, an Apple Event — raise `before-quit`
   * without passing through here, which is exactly the discrimination wanted.
   */
  let issuingQuit = false

  /** Ask Electron to quit, with the re-entry marked. See {@link issuingQuit}. */
  const askElectronToQuit = (failure: string): void => {
    issuingQuit = true
    try {
      deps.quit()
    } catch (error) {
      deps.log(failure, error)
    } finally {
      issuingQuit = false
    }
  }

  /**
   * ⛔ **A repeat request to quit, whatever door it came through** (271 §2).
   *
   * ⚠️ **Its argument is what asked, not whether it is allowed to.** Absorbing a repeat is still the
   * policy — 068 finding 1 is a real defect and exiting through the middle of a teardown is still how
   * you reach it. What changed is that absorbing it now costs the app a promise: {@link
   * IMPATIENT_EXIT_MS} from here, the app is gone regardless.
   *
   * ⚑ **Idempotent by the CLOCK and not by a counter**, so the fifth press joins the first press's
   * deadline rather than pushing it out. A budget any further press could extend is not a budget.
   */
  const beImpatient = (asked: string): void => {
    if (forcedExit !== null) return
    deps.log(
      `BroCrew was asked to quit again (${asked}) while shutting down; finishing the teardown, ` +
        `and leaving in ${IMPATIENT_EXIT_MS / 1_000}s regardless`,
    )
    forcedExit = setTimeout(() => {
      deps.log(`BroCrew did not finish shutting down within ${IMPATIENT_EXIT_MS}ms; exiting now`)
      try {
        deps.exit(1)
      } catch (error) {
        deps.log('BroCrew failed to exit:', error)
      }
    }, IMPATIENT_EXIT_MS)
    // Never a reason to hold the loop open by itself: this timer exists to cut a shutdown short,
    // not to keep a process alive waiting to.
    forcedExit.unref?.()
  }

  /**
   * The order is the acceptance criterion, so it is one function and not four listeners:
   * stop making new work → wait for the sessions → (since `744`, when a lifetime is given one: keep
   * the windows' unsent drafts, whose last book is asked for only once the sessions are closed) →
   * wait for the import work already admitted → close the connection all of it was writing to.
   *
   * The drain step is 062's, and the gap it fills is the one 061 found: the first step used to be
   * read as "import work is over", when all it can honestly mean is "no more of it will start".
   *
   * `closeAllSessions` rejecting must not skip the database close. A failed teardown is exactly when
   * the connection most needs closing cleanly, and an unhandled rejection here would leave the app
   * deferred on a quit that never completes.
   */
  const runShutdown = async (): Promise<void> => {
    /**
     * ⚑ **What each step cost, so a slow quit names itself** (271 §1).
     *
     * `270` spent a whole exploration run on *"60.489 seconds"* and could not say which of these
     * four — or none of them — owned it, because the app wrote nothing down. One line per quit is
     * the cheapest instrument that makes the next occurrence a sentence instead of an investigation.
     */
    const spent: string[] = []
    // EVERY step is guarded, including the ones that look like they cannot fail. This function is
    // the only thing standing between a quit and the app's own state, and a throw anywhere in it
    // skips every step after it: an unguarded `stopArchiveWork()` would take the session teardown
    // and the database close down with it, which is the worst possible shutdown — providers left
    // running, connection left open, app gone.
    const keepUnsentDrafts = deps.keepUnsentDrafts
    for (const [what, run] of [
      ['stop archive work', deps.stopArchiveWork],
      ['close its sessions', deps.closeAllSessions],
      ...(keepUnsentDrafts === undefined
        ? []
        : ([['keep its unsent drafts', keepUnsentDrafts]] as const)),
      ['drain its archive work', deps.drainArchiveWork],
      ['close its database', deps.closeDatabase],
    ] as const) {
      const began = deps.now()
      try {
        await run()
      } catch (error) {
        deps.log(`BroCrew failed to ${what}:`, error)
      }
      // ⚠️ Stamped in the `finally` sense — outside the `catch`, so a step that THREW still reports
      // what it spent. A failure that took forty seconds is the most interesting row there is, and
      // recording only the successes is how it would go missing.
      spent.push(`${what} ${String(deps.now() - began)}ms`)
    }
    // ⚠️ **One reading, not two.** `deps.now()` is an injected effect and calling it twice on one
    // line — which `quitStartedAt ?? deps.now()` did — reads a clock a test may be counting.
    const finishedAt = deps.now()
    const total = finishedAt - (quitStartedAt ?? finishedAt)
    const report = `BroCrew shut down in ${String(total)}ms — ${spent.join(' · ')}`
    // ⚠️ **Written on every quit, and only its VOICE depends on the number.** A report printed just
    // for the slow case is a report nobody has ever seen, so nobody knows what a fast one looks
    // like — and `270`'s reading of a quit as "crashed" was exactly that gap.
    //
    // ⚠️ **The sentence does NOT claim the largest step is the answer**, because the total also
    // covers the announcement and whatever else the loop was doing: a total no step accounts for is
    // its own finding, and one worth being able to see rather than being told past.
    deps.log(
      total > SLOW_TEARDOWN_MS
        ? `${report} ⚠️ that is over ${String(SLOW_TEARDOWN_MS)}ms; if no step above accounts for ` +
            `it, the time went somewhere this report cannot see`
        : report,
    )
  }

  return {
    beforeQuit(event): void {
      // The quit this module issues once the teardown is over. It must be allowed through, or the
      // app defers its own quit forever.
      if (readyToExit) return
      // EVERY other quit is deferred, including the tenth one — the teardown is already running and
      // joining it is all there is to do. Deferring costs the user nothing: the internal quit below
      // follows, so the app still exits, it just exits with everything down.
      event.preventDefault()
      // 🔴 **A deferred press is a person asking again, and it is answered by a promise** (271 §2).
      // See {@link AppLifetime.beforeQuit}: absorbing it is unchanged, and until now absorbing it
      // was ALL that happened, so ⌘Q was the one door with no clock behind it.
      if (shutdown) {
        if (!issuingQuit) beImpatient('a quit gesture')
        return
      }
      quitStartedAt = deps.now()
      // ⛔ **Before the first `await`, and before the first step.** See
      // {@link AppLifetimeDeps.announceClosing} — announced later it would be a race with the very
      // step that takes the time, and on an idle app it would never be seen at all. Guarded like
      // every step below: a window that cannot be told must not stop the app from closing.
      try {
        deps.announceClosing()
      } catch (error) {
        deps.log('BroCrew could not tell its windows it is closing:', error)
      }
      // `quit()` is inside the guarded promise too, so `shuttingDown` never rejects: it is awaited
      // by tests and, more importantly, a rejection here would be unhandled — there is nobody above
      // an Electron event listener to catch it.
      shutdown = runShutdown()
        // ⚠️ **The final quit leaves this callback's own turn of the event loop first** (097), and
        // without that line the app NEVER EXITS. See {@link leaveThisTurn}.
        .then(leaveThisTurn)
        .then(() => {
          // ⚠️ **Set BEFORE the call, not after it.** `app.quit()` raises `before-quit` synchronously
          // in Electron, so a line after it would run too late and this listener would defer the app's
          // own final quit — the deadlock the old guard was written to avoid, reintroduced by fixing
          // it in the obvious place.
          readyToExit = true
          // ⛔ **Armed BEFORE the quit, because after it there is no JavaScript** (294). See
          // {@link AppLifetimeDeps.armLastResort} — the ordering is not a preference, it is the
          // only moment this process can still arm anything.
          try {
            deps.armLastResort(ELECTRON_EXIT_GRACE_MS)
          } catch (error) {
            deps.log('BroCrew could not arm its last-resort exit:', error)
          }
          askElectronToQuit('BroCrew failed to quit:')
        })
    },

    noteQuitPhase(phase): void {
      // Relative to the gesture, because `will-quit at +61,200ms` and `will-quit at +40ms` are the
      // same event and opposite findings. With no quit of ours to be relative to, the line says so
      // — that only happens if Electron shut the app down through a door this module never saw,
      // which is itself the most interesting thing the line could report.
      const at =
        quitStartedAt === null
          ? 'without a quit this module started'
          : `at +${String(deps.now() - quitStartedAt)}ms`
      deps.log(`BroCrew reached Electron's ${phase} ${at}`)
    },

    windowAllClosed(platform): void {
      // ⚠️ Through {@link askElectronToQuit}, so the `before-quit` it raises is not mistaken for a
      // person pressing ⌘Q a second time — closing the last window is this module's own translation
      // of a platform rule, not somebody asking again.
      if (platform !== 'darwin') askElectronToQuit('BroCrew failed to quit on the last window:')
    },

    quitSignal(signal): void {
      signalled += 1
      if (signalled === 1) {
        // Chromium's handler used to make this call; owning the signal means making it ourselves,
        // and `beforeQuit` above is unchanged — it still defers, still runs the four in order, and
        // still lets its own final quit through.
        askElectronToQuit(`BroCrew failed to quit on ${signal}:`)
        return
      }
      // A repeat is impatience, not permission. It is answered by carrying on with the teardown —
      // and, once, by starting the clock that guarantees the app can still be got rid of. ⚑ **The
      // same clock a repeat ⌘Q starts since 271**; one policy, two doors, one implementation.
      beImpatient(signal)
    },

    get shuttingDown(): Promise<void> | null {
      return shutdown
    },
  }
}
