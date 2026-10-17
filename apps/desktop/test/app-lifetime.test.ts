import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createAppLifetime, type AppLifetimeDeps } from '../src/main/app-lifetime'

/**
 * **The database and the host live as long as the app, not as long as a window** (051, from 048 §1
 * finding 4).
 *
 * The composition root cannot be loaded by a test — it imports `electron` as a value — so this is
 * the 050 pattern again: the policy moved into a module that imports nothing, and the root is left
 * with two one-line registrations. What is pinned here is an ORDER and a platform rule, both of
 * which were wrong in ways that only showed up on a Mac or during a quit.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * ⚑ **The one-line shutdown report, on a clock that never moves** (271 §1).
 *
 * Both harnesses freeze `now` at zero, so the report the teardown writes is a constant and every
 * ordered expectation below can keep naming its whole log rather than filtering an entry out.
 * ⚠️ **Filtering was the alternative and it was worse**: these arrays are `toEqual` on purpose —
 * they catch effects nobody expected — and a filter would have made this new one the one effect
 * they cannot see.
 */
const REPORT =
  'log:BroCrew shut down in 0ms — stop archive work 0ms · close its sessions 0ms · ' +
  'drain its archive work 0ms · close its database 0ms'

/**
 * 🔴 **What a SECOND ⌘Q now buys** (271 §2). Until this dispatch the answer was nothing at all: the
 * impatience clock hung off {@link AppLifetime.quitSignal} alone, so an app that would not close
 * could be insisted on from a terminal and not from the keyboard.
 */
const IMPATIENT_ABOUT_A_GESTURE =
  'log:BroCrew was asked to quit again (a quit gesture) while shutting down; finishing the ' +
  'teardown, and leaving in 20s regardless'

/** A lifetime whose every effect lands in one ordered log — the order IS the acceptance criterion. */
function harness(overrides: Partial<AppLifetimeDeps> = {}) {
  const log: string[] = []
  const lifetime = createAppLifetime({
    announceClosing: () => log.push('announceClosing'),
    closeAllSessions: () => {
      log.push('closeAllSessions')
      return Promise.resolve()
    },
    stopArchiveWork: () => log.push('stopArchiveWork'),
    drainArchiveWork: () => {
      log.push('drainArchiveWork')
      return Promise.resolve()
    },
    closeDatabase: () => log.push('closeDatabase'),
    quit: () => log.push('quit'),
    exit: (code) => log.push(`exit:${code}`),
    armLastResort: (withinMs) => log.push(`armLastResort:${String(withinMs)}`),
    log: (message) => log.push(`log:${message}`),
    now: () => 0,
    ...overrides,
  })
  return { lifetime, log }
}

/**
 * The same harness with Electron's own reflex wired in: `app.quit()` raises `before-quit`
 * synchronously, so a signal that quits really does reach the teardown rather than merely logging
 * the word. Everything about {@link AppLifetime.quitSignal} is about what happens to the shutdown
 * that call starts, so a `quit` that starts none would make every test below vacuous.
 */
function signalHarness(overrides: Partial<AppLifetimeDeps> = {}) {
  const log: string[] = []
  const built: { lifetime: ReturnType<typeof createAppLifetime> } = {
    lifetime: null as unknown as ReturnType<typeof createAppLifetime>,
  }
  built.lifetime = createAppLifetime({
    announceClosing: () => log.push('announceClosing'),
    closeAllSessions: () => {
      log.push('closeAllSessions')
      return Promise.resolve()
    },
    stopArchiveWork: () => log.push('stopArchiveWork'),
    drainArchiveWork: () => {
      log.push('drainArchiveWork')
      return Promise.resolve()
    },
    closeDatabase: () => log.push('closeDatabase'),
    quit: () => {
      log.push('quit')
      built.lifetime.beforeQuit(quitEvent().event)
    },
    exit: (code) => log.push(`exit:${code}`),
    armLastResort: (withinMs) => log.push(`armLastResort:${String(withinMs)}`),
    log: (message) => log.push(`log:${message}`),
    now: () => 0,
    ...overrides,
  })
  return { lifetime: built.lifetime, log }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** One `before-quit` event, recording whether Electron was asked to hold the quit. */
function quitEvent() {
  let prevented = 0
  return {
    event: {
      preventDefault: (): void => {
        prevented += 1
      },
    },
    get prevented(): number {
      return prevented
    },
  }
}

describe('app lifetime (051)', () => {
  describe('quitting', () => {
    it('defers the quit, drains in order, and only then lets it through', async () => {
      const { lifetime, log } = harness()
      const first = quitEvent()

      lifetime.beforeQuit(first.event)
      expect(first.prevented).toBe(1)
      await lifetime.shuttingDown

      // The order, not just the membership: the sessions are still writing their final ledger and
      // archive rows when they close, so a database closed first is a database they write into
      // after it is gone.
      //
      // ⚠️ **`drainArchiveWork` sits AFTER `closeAllSessions`, and that position is the finding**
      // (062, from 061 §1). Closing the sessions is what MAKES the archive work this waits for —
      // every session copies the provider's own file on its way out. Moving the drain up beside
      // `stopArchiveWork` would restore exactly the defect: a first step that announces the end of
      // archive work before the work has been created.
      //
      // ⚑ **`announceClosing` is FIRST, and its position is 271's finding** (see
      // `AppLifetimeDeps.announceClosing`): announced after any of these it would be a race with
      // the very step that takes the time, and on an idle app — where all four finish inside one
      // microtask drain — the window would never be told at all.
      expect(log).toEqual([
        'announceClosing',
        'stopArchiveWork',
        'closeAllSessions',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    /**
     * **The final quit does not run in `before-quit`'s own microtask drain** (097).
     *
     * This is the SIGTERM bug, in the one place a unit test can hold it. Electron's `Browser::Quit()`
     * assigns `is_quitting_` from `HandleBeforeQuit()` AFTER our handler returns, so a re-entrant
     * `app.quit()` from a microtask has its `true` overwritten by the first handler's `false` — and
     * the app then sits with no windows and never exits. Measured on bare Electron 43.2.0: microtask
     * → hangs forever; `setImmediate` → exits in 0.66 s. See `leaveThisTurn` in `app-lifetime.ts`.
     *
     * ⚠️ **The microtask drain is exhausted deliberately and the assertion is a PAIR**: nothing yet,
     * then something. Either half alone is vacuous — an unconditional `expect(quits).toBe(0)` would
     * pass against a lifetime that never quits at all, and the second half is what rules that out.
     */
    it('issues the final quit on a LATER turn of the loop, never from the same drain', async () => {
      const quits: number[] = []
      const { lifetime, log } = harness({
        quit: () => {
          quits.push(log.length)
          log.push('quit')
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      // Drain the microtask queue hard. Every `await` here queues a microtask, and V8 empties that
      // queue completely before the loop reaches its check phase — so a `setImmediate` cannot have
      // fired, while a `Promise.resolve().then()` would have fired long ago.
      for (let turn = 0; turn < 100; turn += 1) await Promise.resolve()
      expect(quits, 'quit() was called from before-quit’s own microtask drain').toEqual([])
      // …and the whole teardown really did finish inside that drain, which is what makes the app
      // that reaches this state an IDLE one — the exact case an agent or a smoke reaps.
      expect(log).toEqual([
        'announceClosing',
        'stopArchiveWork',
        'closeAllSessions',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
      ])

      await lifetime.shuttingDown
      expect(quits, 'quit() never happened at all').toHaveLength(1)
      expect(log[log.length - 1]).toBe('quit')
    })

    it('still closes the database when the drain itself rejects', async () => {
      const { lifetime, log } = harness({
        drainArchiveWork: () => Promise.reject(new Error('a sweep would not stop')),
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      // The drain is unbounded by design, so a rejection here means something gave up rather than
      // hung — and the connection still needs closing cleanly on the way out.
      expect(log).toEqual([
        'announceClosing',
        'stopArchiveWork',
        'closeAllSessions',
        'log:BroCrew failed to drain its archive work:',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    it('lets the second quit through, so the app does not defer itself forever', async () => {
      const { lifetime } = harness()
      const first = quitEvent()
      const second = quitEvent()

      lifetime.beforeQuit(first.event)
      await lifetime.shuttingDown
      // This is the event `quit()` above raised. Preventing it too would leave the app running with
      // its database closed and its sessions gone — alive with nothing behind it.
      lifetime.beforeQuit(second.event)
      expect(second.prevented).toBe(0)
    })
  })

  /**
   * **A second quit must not exit through the middle of the first one** (070, from 068 finding 1).
   *
   * ⚠️ **The test above cannot reach this, and that is the finding.** It awaits `shuttingDown`
   * before sending event two — i.e. it asks what happens after the teardown, which is the one moment
   * the old guard answered correctly. The guard read `shutdown !== null`, and that becomes true on
   * the FIRST line of the teardown, so every ⌘Q from then until the end went straight through:
   * providers still stopping, the critical archive half-written, SQLite closed by nobody.
   *
   * Every test below therefore parks the shutdown INSIDE a step and sends the second event there.
   */
  describe('quitting twice', () => {
    /** Let the shutdown loop advance to its next awaited step. */
    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

    it('refuses a second quit while the SESSIONS are still closing', async () => {
      const stopping = deferred()
      const { lifetime, log } = harness({ closeAllSessions: () => stopping.promise })

      const first = quitEvent()
      lifetime.beforeQuit(first.event)
      await settle()
      expect(first.prevented).toBe(1)
      expect(log).toEqual(['announceClosing', 'stopArchiveWork'])

      const second = quitEvent()
      lifetime.beforeQuit(second.event)

      // ⚠️ This was 0. A provider spawn is the slowest thing this app does, and `closeAllSessions`
      // is what waits for every one of them to stop — so this is precisely where an impatient user's
      // second press lands, and it let Electron exit with the children still running.
      expect(second.prevented).toBe(1)
      // ⚑ **The press is absorbed AND answered now** (271 §2): the teardown is untouched — no second
      // `stopArchiveWork`, no exit through the middle of it — and the app has promised to be gone in
      // twenty seconds whatever happens. Absorbing without the promise is what left `270`'s person
      // pressing the one key that could have helped and getting nothing at all.
      expect(log).toEqual(['announceClosing', 'stopArchiveWork', IMPATIENT_ABOUT_A_GESTURE])

      stopping.resolve()
      await lifetime.shuttingDown
      expect(log.slice(-5)).toEqual([
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        'armLastResort:2000',
        'quit',
      ])
    })

    it('refuses a second quit while the ARCHIVE is still draining', async () => {
      const draining = deferred()
      const { lifetime, log } = harness({ drainArchiveWork: () => draining.promise })

      lifetime.beforeQuit(quitEvent().event)
      await settle()
      await settle()
      expect(log).toEqual(['announceClosing', 'stopArchiveWork', 'closeAllSessions'])

      const second = quitEvent()
      lifetime.beforeQuit(second.event)
      expect(second.prevented).toBe(1)
      // The step 062 added, and the one with the most to lose: each closing session copies the
      // provider's own file on the way out, and that write is the only copy of the conversation
      // until it lands. Exiting here loses it AND leaves the connection it was writing to open.
      expect(log).toEqual([
        'announceClosing',
        'stopArchiveWork',
        'closeAllSessions',
        IMPATIENT_ABOUT_A_GESTURE,
      ])

      draining.resolve()
      await lifetime.shuttingDown
      // The drain is the overridden step, so it leaves no mark of its own — what matters is that
      // the two steps AFTER it ran, and only once it had finished.
      expect(log).toEqual([
        'announceClosing',
        'stopArchiveWork',
        'closeAllSessions',
        IMPATIENT_ABOUT_A_GESTURE,
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    it('runs the teardown ONCE however many times the user presses quit', async () => {
      const stopping = deferred()
      const { lifetime, log } = harness({
        closeAllSessions: () => {
          log.push('closeAllSessions')
          return stopping.promise
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await settle()
      for (let press = 0; press < 5; press++) lifetime.beforeQuit(quitEvent().event)
      stopping.resolve()
      await lifetime.shuttingDown

      // Deferring is not the same as starting another one: five more presses must join the teardown
      // in flight, not launch five more of it over a database that is closing.
      expect(log.filter((entry) => entry === 'closeAllSessions')).toHaveLength(1)
      expect(log.filter((entry) => entry === 'closeDatabase')).toHaveLength(1)
      expect(log.filter((entry) => entry === 'quit')).toHaveLength(1)
    })

    it('lets through the before-quit its own quit() raises SYNCHRONOUSLY', async () => {
      let reentrant: ReturnType<typeof quitEvent> | null = null
      const built = harness({
        quit: () => {
          // Electron raises `before-quit` from inside `app.quit()`. The flag therefore has to be set
          // BEFORE the call: written on the line after it — the obvious place — this listener would
          // defer the app's own final quit and the app would never exit at all. That is the deadlock
          // the guard this replaces existed to avoid, and the one way to reintroduce it.
          reentrant = quitEvent()
          built.lifetime.beforeQuit(reentrant.event)
        },
      })

      built.lifetime.beforeQuit(quitEvent().event)
      await built.lifetime.shuttingDown

      expect(reentrant).not.toBeNull()
      expect((reentrant as unknown as ReturnType<typeof quitEvent>).prevented).toBe(0)
    })

    it('closes the database even when closing the sessions fails', async () => {
      const { lifetime, log } = harness({
        closeAllSessions: () => Promise.reject(new Error('a provider would not stop')),
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      // A failed teardown is exactly when the connection most needs closing cleanly — and an
      // unhandled rejection here would leave the app deferred on a quit that never arrives.
      expect(log).toEqual([
        'announceClosing',
        'stopArchiveWork',
        'log:BroCrew failed to close its sessions:',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    it('quits even when closing the database throws', async () => {
      const { lifetime, log } = harness({
        closeDatabase: () => {
          throw new Error('disk went away')
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      expect(log.at(-1)).toBe('quit')
    })

    it('still closes the sessions and the database when stopping archive work throws', async () => {
      // The first step, and the one that looks like it cannot fail. Unguarded, a throw here would
      // skip BOTH the session teardown and the database close — providers left running, connection
      // left open, app gone. The worst shutdown available, from the least likely line.
      const { lifetime, log } = harness({
        stopArchiveWork: () => {
          throw new Error('the sweep was mid-batch')
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      expect(log).toEqual([
        'announceClosing',
        'log:BroCrew failed to stop archive work:',
        'closeAllSessions',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    it('never rejects, so nothing above an Electron listener has to catch it', async () => {
      const { lifetime } = harness({
        stopArchiveWork: () => {
          throw new Error('a')
        },
        closeAllSessions: () => Promise.reject(new Error('b')),
        drainArchiveWork: () => Promise.reject(new Error('b2')),
        closeDatabase: () => {
          throw new Error('c')
        },
        quit: () => {
          throw new Error('d')
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await expect(lifetime.shuttingDown).resolves.toBeUndefined()
    })
  })

  /**
   * **A POSIX quit signal, and the SECOND one** (163, from 068 finding 1 by way of 070 and 075).
   *
   * ⚠️ **What is pinned here is the POLICY, and it is only half the fix.** The other half is where
   * the listeners are registered — see the source scan at the bottom of this file, and the
   * measurement in `app-lifetime.ts`: registered at the top of the main script they never fire at
   * all, so every test in this block would pass over a signal the app never sees. That is precisely
   * how 075's handler came to be reviewed, measured and shipped as dead code.
   */
  describe('quit signals', () => {
    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
    const exits = (log: string[]): string[] => log.filter((entry) => entry.startsWith('exit:'))

    it('quits on the first one, and the teardown runs in order', async () => {
      const { lifetime, log } = signalHarness()

      lifetime.quitSignal('SIGINT')
      await lifetime.shuttingDown

      // The leading `quit` is this module asking Electron to quit — the call Chromium's own handler
      // used to make, and the one owning the signal moves to us. The trailing one is the final quit
      // the teardown issues, which `beforeQuit` lets through.
      expect(log).toEqual([
        'quit',
        'announceClosing',
        'stopArchiveWork',
        'closeAllSessions',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    it('absorbs every repeat while the teardown is in flight', async () => {
      const stopping = deferred()
      const { lifetime, log } = signalHarness({ closeAllSessions: () => stopping.promise })

      lifetime.quitSignal('SIGINT')
      await settle()
      expect(log).toEqual(['quit', 'announceClosing', 'stopArchiveWork'])

      // Parked inside `closeAllSessions` — a provider spawn is the slowest thing this app does, so
      // this is where an impatient second press lands, and where the kernel used to end the process.
      for (let repeat = 0; repeat < 4; repeat += 1) lifetime.quitSignal('SIGINT')
      await settle()

      expect(exits(log), 'a repeat exited through the middle of the teardown').toEqual([])
      expect(log.filter((entry) => entry === 'stopArchiveWork')).toHaveLength(1)
      // Said once, not once per press: the clock is started by the first repeat and the rest join it.
      expect(
        log.filter((entry) => entry.startsWith('log:BroCrew was asked to quit again')),
      ).toHaveLength(1)

      stopping.resolve()
      await lifetime.shuttingDown
      // ⛔ **The ORDER, through five signals, not just the membership.** This is what step 38 proves
      // live and what nothing proved here: `drainArchiveWork` still runs after the sessions are
      // down, and `closeDatabase` still runs after the archive that closing them created. A repeat
      // that skipped either is the whole of 068 finding 1.
      //
      // ⚠️ **The notice's wording changed in 271 and it is not a cosmetic edit** (193 M5's rule: an
      // old assertion is never quietly flipped). It used to name the signal because a signal was the
      // only thing that could reach it; it names WHAT ASKED because ⌘Q reaches it now too, and one
      // sentence for one policy is the whole point of unifying the two doors.
      expect(log).toEqual([
        'quit',
        'announceClosing',
        'stopArchiveWork',
        // `closeAllSessions` is the overridden step and leaves no mark of its own; the four presses
        // land inside it, and the notice below is the only thing they wrote.
        'log:BroCrew was asked to quit again (SIGINT) while shutting down; finishing the teardown, ' +
          'and leaving in 20s regardless',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    it('leaves anyway when the teardown outlasts the impatience budget', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        const stopping = deferred()
        const { lifetime, log } = signalHarness({ closeAllSessions: () => stopping.promise })

        lifetime.quitSignal('SIGTERM')
        await settle()
        lifetime.quitSignal('SIGTERM')

        vi.advanceTimersByTime(19_999)
        expect(exits(log), 'the app left before the budget was up').toEqual([])
        vi.advanceTimersByTime(1)
        // An app that cannot be stopped by SIGTERM is the defect 094 and 095 reported. Absorbing a
        // repeat must not turn into ignoring it.
        expect(exits(log)).toEqual(['exit:1'])

        stopping.resolve()
        await lifetime.shuttingDown
      } finally {
        vi.useRealTimers()
      }
    })

    it('never starts that clock for a signal nobody repeated', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        const stopping = deferred()
        const { lifetime, log } = signalHarness({ closeAllSessions: () => stopping.promise })

        lifetime.quitSignal('SIGINT')
        await settle()
        vi.advanceTimersByTime(600_000)

        // The pair that makes the test above mean something. One signal is "shut down properly,
        // take as long as that takes" — ten minutes of a slow archive drain is not a reason to
        // exit through it, and only a person asking twice buys that.
        expect(exits(log)).toEqual([])

        stopping.resolve()
        await lifetime.shuttingDown
        expect(log.at(-1)).toBe('quit')
      } finally {
        vi.useRealTimers()
      }
    })

    it('joins a teardown ⌘Q already started instead of starting another', async () => {
      const stopping = deferred()
      const { lifetime, log } = signalHarness({ closeAllSessions: () => stopping.promise })

      lifetime.beforeQuit(quitEvent().event)
      await settle()
      expect(log).toEqual(['announceClosing', 'stopArchiveWork'])

      // The first SIGNAL, but the second quit — a reaper's SIGTERM landing on an app the user has
      // already asked to close. It must not be read as the impatient repeat it is not, and must not
      // start a second run of the four steps over the one in flight.
      lifetime.quitSignal('SIGTERM')
      await settle()
      expect(exits(log)).toEqual([])
      expect(log.filter((entry) => entry === 'stopArchiveWork')).toHaveLength(1)
      // ⛔ **271's new clock must NOT have started here, and this is the assertion that says so.**
      // `quitSignal`'s first signal reaches Electron through `deps.quit()`, which raises the very
      // `before-quit` that now reads a deferred press as impatience — so without
      // `askElectronToQuit`'s marker this would quietly shorten 163's deliberate "take as long as
      // it takes" to twenty seconds, and nothing else in this file would notice.
      expect(
        log.filter((entry) => entry.startsWith('log:BroCrew was asked to quit again')),
      ).toEqual([])

      stopping.resolve()
      await lifetime.shuttingDown
      expect(log.at(-1)).toBe('quit')
    })
  })

  /**
   * 🔴 **The quit a person experiences** (271, from `270` finding 1).
   *
   * `270` used BroBot for seventeen minutes, found the centre of it credible, and refused to adopt
   * it over one gesture: ⌘Q blanked the window and left the process and its port alive for
   * **60.489 s**. Everything in this block is one of the three things that made that state possible
   * to be in and impossible to get out of — the window was told nothing, a second press bought
   * nothing, and nothing bounded what happened after the teardown.
   *
   * ⚠️ **271 could not reproduce the minute on this machine** (eight measured quits, 0.4–2.6 s), so
   * nothing here claims to be the cause. What each test pins is a property the app did not have.
   */
  describe('a quit a person can watch and insist on', () => {
    const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
    const exits = (log: string[]): string[] => log.filter((entry) => entry.startsWith('exit:'))

    it('tells the window it is closing BEFORE the first step, not after', async () => {
      const stopping = deferred()
      const { lifetime, log } = harness({ closeAllSessions: () => stopping.promise })

      lifetime.beforeQuit(quitEvent().event)
      // ⛔ **Synchronously, inside the callback, and FIRST** — not after a tick and not after a
      // step. On an idle app the whole teardown finishes inside one microtask drain, so an
      // announcement made anywhere later is a message the window never has time to draw.
      //
      // ⚠️ `log[0]` rather than the whole array, because `runShutdown` is an async function: its
      // body runs synchronously as far as the first `await`, so `stopArchiveWork` — which is
      // synchronous — has already happened by the time this line runs. What is being pinned is the
      // ORDER of the two, and asserting the array would be asserting that fact about `async` as
      // well.
      expect(log[0]).toBe('announceClosing')
      expect(log).not.toContain(REPORT)

      stopping.resolve()
      await lifetime.shuttingDown
      expect(log.filter((entry) => entry === 'announceClosing')).toHaveLength(1)
    })

    it('announces once, however many times the person presses quit', async () => {
      const stopping = deferred()
      const { lifetime, log } = harness({ closeAllSessions: () => stopping.promise })

      lifetime.beforeQuit(quitEvent().event)
      await settle()
      for (let press = 0; press < 4; press += 1) lifetime.beforeQuit(quitEvent().event)

      // One quit, one announcement. Four more would be four IPC sends into a window that is already
      // showing the shade — harmless, and exactly the kind of harmless nobody notices growing.
      expect(log.filter((entry) => entry === 'announceClosing')).toHaveLength(1)
      stopping.resolve()
      await lifetime.shuttingDown
    })

    it('closes anyway when the window cannot be told', async () => {
      const { lifetime, log } = harness({
        announceClosing: () => {
          throw new Error('the webContents was destroyed')
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      // ⛔ A window that cannot be told must never be the reason the app stays. This is the same
      // rule every step in `runShutdown` already follows, applied to the one effect that runs
      // BEFORE them — where an unguarded throw would skip all four.
      expect(log).toEqual([
        'log:BroCrew could not tell its windows it is closing:',
        'stopArchiveWork',
        'closeAllSessions',
        'drainArchiveWork',
        'closeDatabase',
        REPORT,
        // ⚑ 294: the deadline is armed BEFORE the final quit, because after it nothing in this
        // process runs again. Its position in this list is the assertion.
        'armLastResort:2000',
        'quit',
      ])
    })

    /**
     * 🔴 **A person could insist from a terminal and not from the keyboard** (271 §2).
     *
     * `quitSignal` has had the impatience clock since 163 and `beforeQuit` had nothing. So the ⌘Q
     * `270` reported — *"a dead-looking black app while the old instance still owns the port"* —
     * could be pressed any number of times and change nothing at all, while a SIGTERM from a script
     * guaranteed the app was gone in twenty seconds.
     */
    it('a SECOND ⌘Q promises the app will be gone, and the first does not', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        const stopping = deferred()
        const { lifetime, log } = harness({ closeAllSessions: () => stopping.promise })

        lifetime.beforeQuit(quitEvent().event)
        await settle()
        // ⚑ The pairing, and the half that stops this being a test of "any quit exits": one press
        // is "close properly, take as long as that takes", which is 163's rule and is unchanged.
        vi.advanceTimersByTime(600_000)
        expect(exits(log), 'one press was enough to force an exit').toEqual([])

        lifetime.beforeQuit(quitEvent().event)
        expect(log.at(-1)).toBe(IMPATIENT_ABOUT_A_GESTURE)
        vi.advanceTimersByTime(19_999)
        expect(exits(log), 'the app left before the budget was up').toEqual([])
        vi.advanceTimersByTime(1)
        expect(exits(log)).toEqual(['exit:1'])

        stopping.resolve()
        await lifetime.shuttingDown
      } finally {
        vi.useRealTimers()
      }
    })

    it('a third and fourth press join that deadline rather than pushing it out', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        const stopping = deferred()
        const { lifetime, log } = harness({ closeAllSessions: () => stopping.promise })

        lifetime.beforeQuit(quitEvent().event)
        await settle()
        lifetime.beforeQuit(quitEvent().event)
        vi.advanceTimersByTime(10_000)
        // Pressed again halfway through. A budget any further press could extend is not a budget —
        // and impatience is exactly the state in which a person presses repeatedly.
        lifetime.beforeQuit(quitEvent().event)
        lifetime.beforeQuit(quitEvent().event)
        vi.advanceTimersByTime(10_000)

        expect(exits(log)).toEqual(['exit:1'])
        expect(
          log.filter((entry) => entry.startsWith('log:BroCrew was asked to quit again')),
        ).toHaveLength(1)

        stopping.resolve()
        await lifetime.shuttingDown
      } finally {
        vi.useRealTimers()
      }
    })

    /**
     * ⛔ **The one wait 271 removes** — see {@link ELECTRON_EXIT_GRACE_MS} in `app-lifetime.ts`.
     *
     * On an idle app the four ordered steps measure 1–2 ms and Electron's own `quit` arrives about
     * 105 ms later, so everything `270`'s minute can have been spent on is on the far side of
     * `deps.quit()` — Chromium closing windows, stopping utility processes and flushing its own
     * caches. This is the deadline on that, and the pairing below is what stops it being a timer
     * that fires over a teardown still in progress.
     *
     * 🔴 **Rewritten by 294, because the thing it asserted could not happen.** It used to advance a
     * fake clock by 2,000 ms and read `exit:0`, which is true of a fake timer and false of this
     * application: after `deps.quit()` no timer in this process ever comes due again. A test that
     * owns the clock cannot see that — it is the one fact a fake timer hides by construction — so
     * what is checked here now is the ARMING, and the firing is proved by
     * `last-resort-exit.test.ts` against a real process and by `quit:check` against a real app.
     */
    it('hands Electron a deadline it does not own, BEFORE asking it to quit', async () => {
      const { lifetime, log } = harness()

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      // ⛔ The ORDER is the assertion. Armed after `quit` it would never be armed at all, which is
      // exactly how 271's version failed for three dispatches without anyone being able to see it.
      expect(log.slice(-2)).toEqual(['armLastResort:2000', 'quit'])
      // ⚠️ And nothing in THIS process is relied on to do it — the old hatch's `exit` must not
      // reappear beside the new mechanism, or a green here would cover two answers to one question.
      expect(exits(log)).toEqual([])
    })

    /**
     * ⚠️ **A quit that cannot arm its own deadline still quits.** Spawning is the one thing the
     * closer needs and the one thing that can fail late (a full process table, a sandbox); an app
     * that refused to leave because it could not arrange to be stopped would be the defect this
     * whole file is about, wearing the fix's clothes.
     */
    it('quits anyway when the deadline cannot be armed, and says so', async () => {
      const { lifetime, log } = harness({
        armLastResort: () => {
          throw new Error('spawn EAGAIN')
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      expect(log.at(-1)).toBe('quit')
      expect(log.at(-2)).toContain('could not arm its last-resort exit')
    })

    /**
     * ⚠️ **The fake clock is still here although 294's deadline is not a timer**, and that is
     * deliberate: `271 M13` restores *"the deadline is armed at the GESTURE"* as a `setTimeout` at
     * the top of the deferred quit, and a test that stopped advancing time would let that row
     * SURVIVE — a mutation silently un-killed by an unrelated refactor is exactly what the census
     * exists to prevent. So both shapes are refused here: nothing arms a clock, and nothing exits.
     */
    it('is not armed while a step is still running', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      try {
        const draining = deferred()
        const { lifetime, log } = harness({ drainArchiveWork: () => draining.promise })

        lifetime.beforeQuit(quitEvent().event)
        await settle()
        await settle()
        // ⛔ Ten minutes parked in the archive drain — the one step with no bound of its own — and
        // nothing may be armed yet, by EITHER mechanism. The grace is a deadline on Electron, and a
        // version of it that started at the gesture would take the process out from under the write
        // the whole ordered teardown exists to protect.
        vi.advanceTimersByTime(600_000)
        expect(log.filter((entry) => entry.startsWith('armLastResort'))).toEqual([])
        expect(exits(log)).toEqual([])

        draining.resolve()
        await lifetime.shuttingDown
        // ⚑ …and exactly one once the drain has finished, so the negative above is not merely a
        // statement about a log nothing ever writes to (193's vacuity rule).
        expect(log.filter((entry) => entry.startsWith('armLastResort'))).toEqual([
          'armLastResort:2000',
        ])
        expect(exits(log)).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  /**
   * ⚑ **Where a quit went** (271 §1). `270` measured 60.489 s and could not attribute a millisecond
   * of it, because the app wrote nothing down about its own shutdown — which is the reason this
   * dispatch could only bound the unknown rather than name it.
   */
  describe('the shutdown report', () => {
    /** A clock that advances by a named number of ms on each step. */
    function timedHarness(steps: number[]) {
      let at = 0
      let read = 0
      return harness({
        // Read twice per step (before and after) plus once for the total, so the sequence is
        // consumed one entry per step boundary.
        now: () => {
          const value = at
          if (read % 2 === 1) at += steps[Math.floor(read / 2)] ?? 0
          read += 1
          return value
        },
      })
    }

    it('names every step and what it cost', async () => {
      const { lifetime, log } = timedHarness([0, 0, 0, 0])
      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown
      expect(log).toContain(REPORT)
    })

    it('says so, and how, when the teardown is slow', async () => {
      // 4 s in `close its sessions` alone — over the 3 s threshold, and the number that names it.
      const { lifetime, log } = timedHarness([0, 4_000, 0, 0])
      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      const report = log.find((entry) => entry.startsWith('log:BroCrew shut down in'))
      expect(report, 'no shutdown report was written at all').toBeDefined()
      expect(report).toContain('close its sessions 4000ms')
      expect(report).toContain('that is over 3000ms')
      // ⚑ The pairing: a fast teardown must NOT carry the warning, or the warning means nothing.
      const { lifetime: quick, log: quickLog } = timedHarness([0, 0, 0, 0])
      quick.beforeQuit(quitEvent().event)
      await quick.shuttingDown
      expect(quickLog.find((entry) => entry.startsWith('log:BroCrew shut down in'))).not.toContain(
        'that is over',
      )
    })

    it('reports what a step spent even when the step THREW', async () => {
      let at = 0
      let read = 0
      const { lifetime, log } = harness({
        drainArchiveWork: () => Promise.reject(new Error('a sweep would not stop')),
        now: () => {
          const value = at
          // The drain is the third step, so its closing read is the sixth.
          if (read === 5) at += 9_000
          read += 1
          return value
        },
      })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      // ⛔ A failure that took nine seconds is the most interesting row a report can have, and
      // stamping inside the `try` would have dropped exactly that one.
      const report = log.find((entry) => entry.startsWith('log:BroCrew shut down in'))
      expect(report).toContain('drain its archive work 9000ms')
    })

    it("stamps Electron's own late phases against the gesture", async () => {
      let at = 0
      const { lifetime, log } = harness({ now: () => at })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown
      at = 61_000
      lifetime.noteQuitPhase('will-quit')

      // The far end of the report: this is the line that would have told `270` whether the minute
      // was ours or Chromium's.
      expect(log.at(-1)).toBe("log:BroCrew reached Electron's will-quit at +61000ms")
    })

    it('says when a phase arrives with no quit of ours behind it', () => {
      const { lifetime, log } = harness()
      lifetime.noteQuitPhase('quit')
      // Electron shutting the app down through a door this module never saw is the most interesting
      // thing this line could report, so it must not be dressed up as `+0ms`.
      expect(log).toEqual([
        "log:BroCrew reached Electron's quit without a quit this module started",
      ])
    })
  })

  describe('the last window closing', () => {
    it('takes nothing down on macOS, where the app is still running', async () => {
      const { lifetime, log } = harness()
      lifetime.windowAllClosed('darwin')
      expect(log).toEqual([])
      expect(lifetime.shuttingDown).toBeNull()
    })

    it('asks to quit everywhere else, and the quit path does the teardown', async () => {
      const { lifetime, log } = harness()
      lifetime.windowAllClosed('win32')
      // Only `quit` — the teardown is `before-quit`'s, reached through it. Two paths that both tore
      // down were how the database came to be closed while `closeAll()` was still running.
      expect(log).toEqual(['quit'])
    })
  })

  /**
   * The bug this whole finding is about, reproduced against a REAL connection: on macOS, closing the
   * last window used to close and null the database, so reopening built a window over a store that
   * throws `The database connection is not open` on every read — `app:info` included, which is the
   * start screen's own call.
   */
  describe('reopening on macOS', () => {
    let dir: string
    let db: AppDatabase

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-lifetime-'))
      db = openDatabase(join(dir, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
    })

    afterEach(() => {
      if (db.open) db.close()
      rmSync(dir, { recursive: true, force: true })
    })

    /** `readAppInfo`'s own query, which is what the start screen rejects on. */
    const appInfoQuery = (): number =>
      (db.prepare('SELECT count(*) AS c FROM provider_session').get() as { c: number }).c

    it('still answers app:info after the last window goes away', () => {
      const { lifetime } = harness({ closeDatabase: () => db.close() })

      lifetime.windowAllClosed('darwin')

      expect(db.open).toBe(true)
      expect(appInfoQuery()).toBe(0)
    })

    it('closes the connection on a real quit, and then it is genuinely closed', async () => {
      const { lifetime } = harness({ closeDatabase: () => db.close() })

      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown

      expect(db.open).toBe(false)
      // The exact message better-sqlite3 raises — measured, not quoted from documentation, because
      // this is what a command arriving after shutdown would surface to the renderer.
      expect(() => appInfoQuery()).toThrow('The database connection is not open')
    })
  })

  /**
   * A source scan, on the same principle as 050's `new BrowserWindow` check: the composition root is
   * the one file no test can load, so the only way to keep policy out of it is to check that it is
   * not there. It proves the two handlers DELEGATE — not that the module they delegate to is right,
   * which is what everything above is for.
   */
  it('keeps the policy out of the composition root', () => {
    const root = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts'),
      'utf8',
    )
    // Each handler delegates, and delegates the RIGHT thing: the method name is pinned, not merely
    // the appearance of the word `lifetime` somewhere on the line.
    expect(root).toMatch(
      /app\.on\('before-quit',\s*\(event\)\s*=>\s*lifetime\.beforeQuit\(event\)\)/,
    )
    expect(root).toMatch(
      /app\.on\('window-all-closed',\s*\(\)\s*=>\s*lifetime\.windowAllClosed\(process\.platform\)\)/,
    )

    // WHERE the database is closed, not how many times. The count alone proves nothing — the old
    // code also closed it exactly once, in `window-all-closed`, and that WAS the finding: one
    // closer, on the wrong event. So the assertion is that the single close lives inside the
    // `createAppLifetime({…})` seam, which is the thing a revert would take away.
    const seam = root.match(/createAppLifetime\(\{[\s\S]*?\n\}\)/)?.[0] ?? ''
    expect(seam, 'index.ts must build the lifetime from app-lifetime.ts').not.toBe('')
    expect(seam).toContain('db?.close()')
    expect(root.match(/db\?\.close\(\)/g) ?? []).toHaveLength(1)

    // ⛔ **EVERY window is told, and 271's shade is worthless if one is missed.** The policy above
    // can only prove that *something* was announced; which windows hear it is decided here, in the
    // file no test can load. A second window left drawing an ordinary application beside one saying
    // the app is closing would be two answers to one fact.
    expect(seam).toMatch(
      /announceClosing:[\s\S]*?for \(const window of BrowserWindow\.getAllWindows\(\)\)/,
    )
    expect(seam).toMatch(/window\.webContents\.send\(APP_CLOSING_CHANNEL\)/)
    // …and a destroyed one is skipped, because `send` on it throws and this runs during a quit,
    // which is exactly when a window may already be on its way out. ⚠️ Both objects, because a live
    // `BrowserWindow` can hold a dead `webContents`.
    expect(seam).toContain('!window.isDestroyed()')
    expect(seam).toContain('!window.webContents.isDestroyed()')
    // ⛔ **And the guard is INSIDE the loop.** One `try` around the whole walk would let the first
    // window that throws take the notice away from every window after it — the defect the loop
    // exists to avoid, reintroduced by catching in the tidier place.
    expect(seam).toMatch(/for \(const window of BrowserWindow\.getAllWindows\(\)\) \{\s*try \{/)

    // 🔴 **The shutdown notices are written SYNCHRONOUSLY** (294), and this is a source census
    // because the effect lives in the file no test can load.
    //
    // ⛔ Every line this dep carries is written in the last instants of the process's life — the
    // report, then `will-quit`, then `quit` — and `console.error` to a PIPE is asynchronous. The
    // loop stops before libuv drains it and the queued bytes die with the process. Measured: runs
    // where the closer fired, which PROVES the four steps finished and the report was logged,
    // arrived with all three lines missing. ⚠️ The fallback is deliberate and must stay: `writeSync`
    // raises `EAGAIN` on a saturated non-blocking pipe, and losing the line there is no worse than
    // the path this replaces.
    expect(seam).toMatch(/log:[\s\S]*?writeSync\(STDERR_FD/)
    // ⛔ …in a LOOP over bytes, because a pipe can take only part of a line and half a shutdown
    // report reads as the app having said something else (found reviewing 294's own diff).
    expect(seam).toMatch(/const bytes = Buffer\.from\(`\$\{line\}\\n`, 'utf8'\)/)
    // ⚑ The OFFSET is the assertion, not the loop's spelling: writing the same buffer from zero
    // each time would repeat what already went out instead of continuing after it.
    expect(seam).toMatch(/writeSync\(STDERR_FD, bytes, written, bytes\.length - written\)/)
    expect(seam).toMatch(/catch \{[\s\S]*?console\.error\(line\)/)

    // ⛔ **And the deadline Electron cannot ignore is wired to the REAL spawn** (294). The policy
    // module only decides when to arm; if this seam handed it something that armed nothing, every
    // ordered-log assertion above would still pass and the app would go back to hanging.
    expect(seam).toMatch(/armLastResort:[\s\S]*?armLastResortExit\(/)
    expect(seam).toMatch(/armLastResortExit\([\s\S]*?spawn,[\s\S]*?pid: process\.pid/)
  })

  /**
   * ⚑ **Electron's own late phases are stamped** (271 §1) — the far end of the shutdown report.
   *
   * ⚠️ **A regression here is silent in every other test in this file.** `noteQuitPhase` would stay
   * perfectly correct and simply never be called, and the one question `270` could not answer —
   * *was the minute ours or the engine's?* — would go back to being unanswerable, behind a green
   * suite. So the registration is asserted, not just the method.
   */
  it("registers Electron's will-quit and quit against the lifetime", () => {
    const root = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts'),
      'utf8',
    )
    expect(root).toMatch(
      /app\.on\('will-quit',\s*\(\)\s*=>\s*lifetime\.noteQuitPhase\('will-quit'\)\)/,
    )
    expect(root).toMatch(/app\.on\('quit',\s*\(\)\s*=>\s*lifetime\.noteQuitPhase\('quit'\)\)/)
  })

  /**
   * **WHERE the signal listeners are registered, which is the entire fix** (163).
   *
   * Chromium installs its own handlers for these three AFTER the main script has run, so listeners
   * added at the top of `index.ts` are overwritten and never fire — measured, and the reason 075's
   * handler was shipped as dead code and read as proof that the race could not be closed. Registered
   * from `whenReady`, ours win.
   *
   * ⚠️ **A regression here is silent in every other test in this file.** `quitSignal` would still be
   * perfectly correct and still never be called, and `smoke:ui` step 38 would go back to being red
   * for a reason nothing in the suite could name. So the position is asserted, not just the call.
   */
  it('registers the quit signals late, from whenReady, and nowhere else', () => {
    const root = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts'),
      'utf8',
    )
    const opens = root.indexOf('.whenReady()')
    const closes = root.indexOf('.catch((error: unknown)', opens)
    expect(opens, 'index.ts no longer has a whenReady block').toBeGreaterThan(-1)
    expect(closes, 'index.ts no longer has the whenReady catch').toBeGreaterThan(opens)

    const whenReady = root.slice(opens, closes)
    expect(whenReady).toMatch(
      /for \(const signal of \['SIGINT', 'SIGTERM', 'SIGHUP'\] as const\) \{\s*process\.on\(signal, \(\) => lifetime\.quitSignal\(signal\)\)/,
    )
    // …and NOT at the top of the file, where Chromium overwrites it. The negative is the half with
    // the measurement behind it.
    expect(
      root.replace(whenReady, ''),
      'a signal listener outside the whenReady block',
    ).not.toMatch(/process\.on\(\s*['"]?SIG/)
  })
})
