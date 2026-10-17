/**
 * ⛔ **A second PROCESS for the provisioning lock** (238, from 208 M1).
 *
 * The lock is cross-PROCESS, and every test of it until now was single-process: `provider-home.ts`'s
 * suite manufactures pids and writes lockfiles by hand, so it can prove what one acquisition decides
 * about a file, and it cannot prove what two acquisitions decide about each other. 208 M1 is a race
 * between two *judgements*, and a sequential test cannot fail on it — which is why the finding
 * survived two review rounds with the tests all green.
 *
 * ⚑ **This is a fixture, not a test**: it is not named `*.test.ts`, so vitest's `runtime` project
 * (`include: ['test/**\/*.test.ts']`) never collects it. `provider-home-race.test.ts` spawns it.
 *
 * ⚠️ **`.mjs` importing the `.ts` source directly.** Node 24 strips types on load, so the child runs
 * the very file under test rather than a build output that could be stale. A `.ts` fixture would
 * have to import `'../../src/internal/provider-home.ts'` with an explicit extension, which the
 * package's `tsc` refuses without `allowImportingTsExtensions`; `.mjs` is outside `tsc`'s include
 * and asks nobody's permission.
 *
 * Two modes, both reporting one JSON object per line on stdout — the convention
 * `codex-transport.test.ts` already uses for facts that have to cross a process boundary:
 *
 *  - `once <home> <timeoutMs> <pollMs>` — one acquisition, then say whether it got in.
 *  - `rounds <home> <role> <barrierDir> <rounds>` — wait at a barrier, contend, repeat.
 *  - `hold <home> <readyPath> <releasePath> <quitPath>` — ⛔ **240 §2**: acquire, announce, release
 *    when told, and then **stay alive**. A holder that exits takes the finding with it: the lockfile
 *    left behind by 238 §3's residual is only unbreakable while the pid it names is still running,
 *    and that pid is the app's. This is the one mode whose value is what it does AFTER the release.
 *  - `hold-ms <home> <readyPath> <holdMs>` — ⛔ **243**: acquire, announce, hold for exactly `holdMs`
 *    and let go. ⚑ **Nothing is asked of the parent, and that is the point.** The measured party is
 *    the one blocked in `withProviderHomeLock`; if the release depended on a `setTimeout` over there,
 *    the very defect under test — a wait that stops the thread's timers — would stop the release too,
 *    and the probe would deadlock instead of measuring. The hold is `Atomics.wait` so its duration is
 *    the number asked for rather than whatever this fixture's event loop was doing.
 *
 * ⚠️ **`await` on every acquisition, and it reads the same in both columns.** `withProviderHomeLock`
 * is synchronous before 243 and asynchronous after it; `await` over a plain value is a no-op, so one
 * fixture measures both sides and no line of it is a difference the numbers could be blamed on.
 */
import { existsSync, closeSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { withProviderHomeLock } from '../../src/internal/provider-home.ts'

/** Sleep without a timer, so the hold below is a real hold rather than an event-loop turn. */
const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const say = (fact) => process.stdout.write(`${JSON.stringify(fact)}\n`)

const [, , mode, ...rest] = process.argv

if (mode === 'once') {
  const [home, timeoutMs, pollMs] = rest
  let entered = false
  try {
    await withProviderHomeLock(home, () => (entered = true), {
      timeoutMs: Number(timeoutMs),
      pollMs: Number(pollMs),
    })
    say({ entered, error: null })
  } catch (error) {
    say({ entered, error: String(error?.message ?? error) })
  }
} else if (mode === 'rounds') {
  const [home, role, barrier, rounds] = rest
  const critical = `${barrier}/critical`
  for (let round = 0; round < Number(rounds); round++) {
    // ⛔ **A spin, not a poll.** The interleaving 208 M1 describes is microseconds wide: both
    // contenders must judge the same corpse before either has broken it. A `setTimeout` barrier
    // releases them milliseconds apart and the race never happens, which is a green test that
    // measured nothing.
    const go = `${barrier}/go-${round}`
    const until = Date.now() + 30_000
    while (!existsSync(go)) {
      if (Date.now() > until) {
        say({ round, role, entered: false, overlapped: false, error: 'barrier never opened' })
        process.exit(1)
      }
    }
    let entered = false
    let overlapped = false
    try {
      await withProviderHomeLock(
        home,
        () => {
          entered = true
          // ⚑ **`O_EXCL` IS the overlap detector.** If the other contender is inside its own
          // critical section this file exists, and that is the whole failure: two processes
          // provisioning one home, which is what the lock exists to make impossible.
          let mine = false
          try {
            closeSync(openSync(critical, 'wx'))
            mine = true
          } catch {
            overlapped = true
          }
          // Hold long enough that an overlap cannot be missed by finishing first. The race being
          // measured resolves in microseconds; this is four orders of magnitude above it.
          sleepSync(8)
          if (mine) {
            try {
              unlinkSync(critical)
            } catch {
              // the other contender removed it — itself an overlap, already recorded by whoever hit it
            }
          }
        },
        { timeoutMs: 5_000, pollMs: 5 },
      )
      say({ round, role, entered, overlapped, error: null })
    } catch (error) {
      say({ round, role, entered, overlapped, error: String(error?.message ?? error) })
    }
    writeFileSync(`${barrier}/done-${role}-${round}`, '')
  }
} else if (mode === 'hold') {
  const [home, readyPath, releasePath, quitPath] = rest
  const spinUntil = (path, what) => {
    const until = Date.now() + 30_000
    while (!existsSync(path)) {
      if (Date.now() > until) {
        say({ entered: true, error: `timed out waiting for ${what}` })
        process.exit(1)
      }
      sleepSync(1)
    }
  }
  let entered = false
  try {
    await withProviderHomeLock(home, () => {
      entered = true
      // ⚠️ `rename`, so a parent that waits on `existsSync` cannot read the file between the `open`
      // and the bytes — see the same note in `codex-descendant.mjs`.
      writeFileSync(`${readyPath}.partial`, `${process.pid}\n`)
      renameSync(`${readyPath}.partial`, readyPath)
      // The parent renames the lock away first, then opens this gate — so the release below lands
      // INSIDE a contender's rename→link window, which is the whole of 238 §3.
      spinUntil(releasePath, 'the parent to finish its rename')
    })
    say({ entered, released: true, pid: process.pid, error: null })
  } catch (error) {
    say({ entered, released: false, pid: process.pid, error: String(error?.message ?? error) })
  }
  // ⛔ **Still running.** `ownerIsGone` asks `kill(pid, 0)`, so a lockfile naming this process is
  // undecidable for exactly as long as this process lives. Exiting here would silently repair the
  // very thing under test.
  spinUntil(quitPath, 'the parent to release the fixture')
} else if (mode === 'hold-ms') {
  const [home, readyPath, holdMs] = rest
  let entered = false
  const t0 = Date.now()
  try {
    await withProviderHomeLock(
      home,
      () => {
        entered = true
        // Atomic, so a parent watching with `existsSync` cannot see the name before the bytes.
        writeFileSync(`${readyPath}.partial`, `${process.pid}\n`)
        renameSync(`${readyPath}.partial`, readyPath)
        sleepSync(Number(holdMs))
      },
      // ⚠️ Generous, because this process is the one that is *supposed* to win: a timeout here would
      // report itself as "the parent waited a short time", which is the wrong answer told convincingly.
      { timeoutMs: 30_000, pollMs: 5 },
    )
    say({ entered, released: true, pid: process.pid, heldMs: Date.now() - t0, error: null })
  } catch (error) {
    say({
      entered,
      released: false,
      pid: process.pid,
      heldMs: Date.now() - t0,
      error: String(error?.message ?? error),
    })
  }
} else {
  say({ error: `unknown mode ${String(mode)}` })
  process.exit(2)
}
