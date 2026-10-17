#!/usr/bin/env node
/**
 * 🔴 **Does the shipped entry point CLOSE?** (271 §3)
 *
 *   pnpm run quit:check          — and it runs beside `window:check` as the last steps of `pnpm run ci`
 *
 * ## ⛔ Why this exists
 *
 * `270` used the app for seventeen minutes, found the centre of it credible, and then refused to
 * adopt it over one gesture: **⌘Q blanked the window and left the process and its `:9444` listener
 * alive for 60.489 seconds.** *"A person who tries to quit and relaunch sees a dead-looking black
 * app while the old instance still owns the port."*
 *
 * ⚠️ **Nothing in this repository could have caught that, and the sibling file says why.**
 * `window-opens-check.mjs` reaps its app with **SIGKILL**, in as many words: *"this app is a
 * throwaway on a temp directory that is about to be deleted, and its orderly teardown takes up to
 * 20 s"*. Every live smoke does the same. So the one thing no instrument here has ever done is let
 * BroBot quit — `window:check` proves an app opens, and until this file nothing proved one closes.
 *
 * ## ⚑ What it asserts, and why each one is not decoration
 *
 *  1. **The process is gone inside {@link QUIT_BUDGET_MS}** — the failure `270` reported, as a
 *     number.
 *  2. **Nothing holds the debug port {@link PORT_RELEASE_MS} after that** — the *"still owns the
 *     port"* half. ⚑ Asked by trying to BIND it, which is the kernel's own answer and also the
 *     question a person relaunching asks; a process reparented to init is still caught
 *     (`window:check`'s lesson, paid for once already). ⛔ **326 moved this budget off `askedAt`**,
 *     because measuring from the gesture charged the app for the time this check spent asking.
 *  3. **Nothing answers on the one-host gate socket** — the lock half. ⚠️ **Not that the PATH is
 *     gone**: `one-host-gate.ts` deliberately has no release, because the kernel is the release and
 *     the path is expected to survive. The question is whether anything is still there to answer,
 *     which is the same question the next launch asks.
 *  4. **The window did not disappear long before the process did** — `270`'s black window. This is
 *     271 §2's third bullet: *"the port and the lock are released when the app looks gone, or the
 *     app does not look gone until they are."*
 *  5. **The app said where the time went.** ⛔ On the tree before 271 this is the assertion that
 *     fails: there was no shutdown report at all, which is precisely why `270`'s minute cost a whole
 *     exploration run and still cannot be attributed. An instrument that only checks the happy
 *     number would go green on an app that had gone silent again.
 *  6. **It left through Electron's own door** — `will-quit` and `quit` were reached. ⚑ Without this,
 *     an app that force-exited every time would pass 1–4. ⛔ **294 removed the other half of this
 *     pair.** It used to require that the last-resort exit did NOT fire, on the belief that an idle
 *     quit reaching it meant the ordinary path was broken. The ordinary path IS broken and it is not
 *     ours: bare Electron 43.2.0 emits `quit` and then fails to exit in **5 of 6 loaded quits**. So
 *     the firing is REPORTED instead of failed — at ordinary load it is about 1 run in 10, and
 *     under load it was 20 of 20 — and what still catches a force-exiting app is the door above,
 *     stamped at ~106 ms, long before any stop.
 *  6a. **…and 514 gave that report its own verdict.** ⛔ `294` printed it as a clause appended to
 *     the `✔` line, so **both outcomes carried the same token and the difference was the last
 *     thing on the line** — which twelve response documents then each explained in their prose.
 *     ⚑ The run is still green either way and the exit code has not moved; what a reader gets is a
 *     word from a closed two-cell vocabulary at the front: `quit:check ✔ closed …` against
 *     `quit:check ⚠️ STOPPED …`. See `scripts/lib/quit-verdict.mjs` for the cells and for the two
 *     shapes this deliberately is not.
 *  7. **Nothing reached a closed database** (273 §3, from `272` finding 1) — the check asks the app's
 *     own bridge for its two session lists, continuously, across the whole quit. ⛔ On the tree
 *     before 273 this is the assertion that fails, with the pair `272` measured by hand: *"one failed
 *     `runtime:command` query for resumable sessions and one for unresumable sessions"*.
 *  8. **…and it was REFUSED rather than merely unasked.** The intentional shutting-down sentence has
 *     to appear for both commands, because a probe that had gone quiet would satisfy 7 by doing
 *     nothing at all.
 *
 * ## ⛔ …and what it must never do, which it did twice on 2026-09-04
 *
 * **`326`.** The three observations above were read in one pass, in written order, each stamped when
 * its own answer came back — so *"has the app gone?"*, which costs nothing, could not be sampled
 * until a CDP probe **and** an `lsof` had both returned. Instrumented on this machine at load ≈ 66:
 *
 * ```
 *   PROBE #1 at +0ms · targets 9ms · holdersOf 21295ms · alive 0ms || port=21304 proc=21304
 *   ⛔ THE APP DID NOT CLOSE. pid 76042 … still running 21304ms later (budget 5000ms).
 *   BroCrew shut down in 2005ms — … · BroCrew reached Electron's quit at +110ms
 * ```
 *
 * ⚠️ **The app had already exited before that `lsof` was issued** — the same iteration's `ps` found
 * no such process — and the two logs `quit:check` left in `os.tmpdir()` from its two red runs that
 * day show a perfect quit in both. ⛔ **A gate that reports the machine it runs on as the product's
 * behaviour is worse than no gate**, and this is the fourth of that shape in three days: `311`
 * (`npx` resolving off the network), `321`/`324` (a JS timer measuring host load), `325` (a removal
 * racing its own launch), this.
 *
 * ⚑ **So every fact below is stamped when it is ASKED, cheapest first, and the port is asked of the
 * allocator rather than of a subprocess.** See `scripts/lib/port-probe.mjs` for the measurements and
 * for the third answer neither of those instruments used to be able to give.
 *
 * ## ⚠️ What this check is NOT
 *
 * ⛔ **It sends SIGTERM, not ⌘Q**, and the difference is worth stating rather than glossing.
 * Electron's `role: 'quit'` menu item calls `app.quit()`; `app-lifetime.ts`'s first signal calls
 * `app.quit()` too. From `app.quit()` onward the two gestures are one code path — but the keystroke
 * itself is a macOS menu event a script cannot raise without the accessibility permissions a CI step
 * must not require. 271 measured a real ⌘Q by hand, twice, including on `270`'s own surviving
 * instance; this file is the part that can run unattended forever.
 *
 * Costs one Electron launch — measured at about 7 s: the app opens in ~1 s, settles for 3 s (see
 * below for why that is a measurement and not a pause), proves its probe for 0.25 s, and closes in
 * ~0.2 s — or in ~2.2 s on the runs where Electron does not exit on its own and the app's own bound
 * has to stop it. It opens no provider session, spends nothing, and removes its `--user-data-dir`.
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'
import { couldBindPort, whoHoldsPort } from './lib/port-probe.mjs'
import { quitHeadline } from './lib/quit-verdict.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
/** What `pnpm run build` produces and what `package.json`'s `main` points at — the SHIPPED entry. */
const ENTRY = join(DESKTOP, 'out/main/index.js')

/** macOS's `sun_path`. Same precondition as `window:check`, and the same reason — see that file. */
const SUN_PATH_MAX = 104
/** The name `one-host-gate.ts` binds inside `userData`. Kept in step by `one-app.test.ts`. */
const GATE_SOCKET = 'one-host.sock'

/**
 * 🔴 **How long a person may wait for an idle BroBot to be gone.**
 *
 * Measured rather than chosen. Four instrumented idle quits put the four ordered steps at **1–2 ms**,
 * Electron's `quit` at **+103–105 ms**, and the process gone at **+508–521 ms**; this check's own
 * first three runs closed in **320–406 ms**. So the budget is about **twelve times** the observed
 * worst case, and it is still an eighth of the sixty seconds `270` refused to adopt the app over.
 *
 * ⚠️ **It bounds the IDLE quit deliberately.** A quit with a wedged provider in it is allowed longer
 * by `runtime-host.ts`'s own bounds (2 × `closeDrainTimeoutMs`, 10 s), and this check never starts a
 * session — see the settle below for the one provider child it deliberately waits out.
 */
const QUIT_BUDGET_MS = 5_000

/**
 * ⛔ **How long the app may look gone while still being alive** (271 §2, re-derived by 294).
 *
 * `270`'s finding in one number: the window went black and the process lived for another minute.
 *
 * 🔴 **2,500 was a number about a bound that never fired, and 294 makes it a number about one that
 * does.** The window goes at ~350 ms; the process is now gone at `ELECTRON_EXIT_GRACE_MS` plus the
 * cost of the process that enforces it — measured at **2,141–2,231 ms** across six loaded quits, so
 * a lag of ~1,850 ms is the NORMAL result of the fix working. At 2,500 that left 650 ms of margin
 * and the PM measured a run at **2,502 ms**: the old limit was already firing on the mechanism
 * rather than on the disease.
 *
 * ⚠️ **So this is derived, not widened**: 2,000 (the app's own promise) + ~250 (a detached Node
 * start) + 50 (one poll) + headroom for a loaded machine, where every one of those is slower. ⛔ **It
 * is still the assertion that catches the closer NOT working** — an app whose bound is not enforced
 * lags by tens of seconds, not by three — which is the only version of `270`'s finding that can
 * still reach a person.
 */
const WINDOW_LAG_MS = 4_000

/**
 * 🔴 **The app's output goes to a FILE, not to a pipe, and that is the second fix in 294.**
 *
 * ⛔ **This check was blinding itself.** {@link RENDERER_ASK} asks at ~27,000 calls a second by
 * design, and Electron logs *"Error occurred in handler for 'runtime:command'"* plus four stack
 * lines for every refusal — so a quit that takes a second produces **6,000–23,000 lines**, measured,
 * on a stderr PIPE whose reader is a Node process competing for a loaded CPU. Two things follow, and
 * both were failing this check:
 *
 *  1. **The pipe fills.** The app's own `writeSync` to a full non-blocking pipe raises `EAGAIN` and
 *     falls back to the asynchronous path — which never flushes, because by then the quit has
 *     stopped the loop. ⚑ The line lost this way is the LAST one written, which is the shutdown
 *     report: the very instrument `271` built so that `270`'s minute could name itself.
 *  2. **The reader lags the writer.** `kill -0` says the task is gone while its last chunks are
 *     still in flight, so the assertions ran against a buffer rather than against the app.
 *
 * ⚠️ **A file has neither problem**: Node makes stdout/stderr SYNCHRONOUS when they are files, so
 * nothing is ever queued to be lost, and the kernel is the buffer so no reader can fall behind. ⛔ It
 * also means this check no longer has to guess when the output is complete — when the process is
 * gone, the file is what the app wrote.
 *
 * ⚠️ **It does change one thing about the subject and that is worth saying**: an app whose stderr is
 * a file writes it differently from one whose stderr is a pipe. The pipe case is the real one and
 * the app is fixed for it separately (`index.ts`'s `log`, which is why `will-quit` and `quit`
 * survive a saturated pipe now); what this file changes is only whether the INSTRUMENT can read what
 * was written.
 */
const OUTPUT_ENCODING = 'utf8'

/** How often to ask. Small, because the whole event is under a second. */
const POLL_MS = 50

/** How long to let the renderer ask before the quit, so the probe can be proved to work first. */
const PROVE_THE_PROBE_MS = 250

/**
 * 🔴 **How long after the PROCESS is gone anything may still hold the debug port** (326 §1).
 *
 * ⛔ **This used to be measured from `askedAt`, and that is what made this gate report the machine.**
 * *"The port was released within five seconds of us asking the app to quit"* charges the app for
 * every millisecond this check spent inside its own `lsof` — and one of those was measured at
 * **21,295 ms**, on a run where the app had already exited before the call was even issued. The app
 * is not responsible for the time our instrument spent asking.
 *
 * ⚑ **The observed value is zero**: a dead process holds no listening socket, so the same exit that
 * ends the process frees the port, and every non-zero reading here is this loop's own sampling
 * granularity — one {@link POLL_MS} plus one {@link targets} call, measured at up to 400 ms under
 * load. So this bounds the SAMPLING and is two of those. ⛔ What it still catches is the thing that
 * is not the app: a leaked helper, reparented to init, holding the port a relaunch needs.
 */
const PORT_RELEASE_MS = 1_000

/**
 * How long the launched pid has to settle into one identity — see the capture below.
 *
 * ⚠️ Short on purpose: a launch that cannot be identified in this long did not start, and the
 * alternative to a bound here is a check that removes a directory it never owned (325).
 */
const OWNERSHIP_MS = 10_000

/** A port nothing holds, handed over by the kernel rather than guessed. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * Does anything answer on the one-host gate socket?
 *
 * ⚠️ **The same question `one-host-gate.ts` asks**, and deliberately not a different one: a path
 * that exists is not an owner, which is that module's whole design. `true` only when something
 * connected AND said who it was.
 */
function gateAnswers(path) {
  return new Promise((resolve) => {
    let said = ''
    const socket = connect(path)
    const settle = (answer) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(answer)
    }
    const timer = setTimeout(() => settle(true), 1_000)
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (said += chunk))
    socket.on('end', () => settle(said !== ''))
    socket.on('error', () => settle(false))
  })
}

/** The DevTools targets, or null while nothing answers. See `window-opens-check.mjs`. */
async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return null
    const list = await response.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

/**
 * Run one expression inside the app's own page and hand back what it evaluated to.
 *
 * ⚠️ **Through the DevTools socket the check already opens a port for**, so this adds no test hook
 * to the product: the expression runs in the ordinary renderer world, against the ordinary frozen
 * `window.api` bridge, with `contextIsolation` and `sandbox` both on. There is no path from here to
 * anything the renderer itself could not do.
 *
 * Returns `{ value }` or `{ error }` — never throws, because every caller below wants to fail with
 * the app's output attached rather than with a stack from this file.
 */
async function evaluateInPage(port, expression) {
  const list = await targets(port)
  const page = (list ?? []).find(
    (t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string',
  )
  if (page === undefined) return { error: 'there is no page target to evaluate in' }
  return await new Promise((resolve) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    const settle = (answer) => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // Already closing; the answer is what matters.
      }
      resolve(answer)
    }
    const timer = setTimeout(() => settle({ error: 'the page never answered' }), 5_000)
    socket.addEventListener('error', () => settle({ error: 'could not open a DevTools socket' }))
    socket.addEventListener('open', () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      ),
    )
    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.id !== 1) return
      if (message.error) return settle({ error: message.error.message })
      if (message.result?.exceptionDetails) {
        return settle({ error: message.result.exceptionDetails.text })
      }
      settle({ value: message.result?.result?.value })
    })
  })
}

/**
 * ⛔ **Ask the host for its session lists, forever, from the renderer** — `272`'s gesture, deterministic.
 *
 * ⚠️ **Started BEFORE the quit and never stopped**, which is the whole design: the defect is not that
 * a command was sent, it is that one sent while the app was still up was still being ANSWERED after
 * `close its database`. A probe that stopped when it was told the app was closing would step over the
 * exact window. In the app the same two calls arrive because the quit CLOSES the conversations, each
 * emits its terminal event, and the rail refreshes its closed list on the way past — a race that
 * needs live conversations and two provider binaries to set up, which is why this asks directly.
 *
 * ⛔ **No timer, and that is the correction that made this reproduce at all.** The first version used
 * a 25 ms `setInterval` and the check went green on the broken tree: Chromium throttles timers in a
 * window that is not in front, so behind another app it fires about once a second — and the window
 * between `close its database` (measured at **+1 ms**) and Electron's `will-quit` (**+105 ms**) is a
 * tenth of one tick. Each ask here re-asks from its own settlement instead, which is a promise
 * continuation and is throttled by nothing: **measured at 27,148 answers per second** across the two
 * chains, so the ~100 ms after the database closes is crossed thousands of times rather than not at
 * all. ⚑ On the tree before 273 that produced exactly the pair `272` described — one `resumable`,
 * one `unresumable` — because the window dies within one round trip of the connection closing.
 *
 * ⚑ **It counts what came back**, so the check can prove the instrument works before it depends on
 * it: an `answered` of zero means the calls never reached the host at all, and every assertion after
 * the quit would then be passing over a probe that did nothing (241's lesson, paid for once already).
 */
const RENDERER_ASK = `
  (() => {
    const runtime = window.api && window.api.runtime
    if (!runtime) return { started: false, why: 'window.api.runtime is not on this page' }
    const probe = { asked: 0, answered: 0, refused: 0, lastRefusal: null }
    window.__quitProbe = probe
    const askAgain = (name) => {
      probe.asked += 1
      runtime[name]().then(
        () => { probe.answered += 1; askAgain(name) },
        (error) => {
          probe.refused += 1
          probe.lastRefusal = String((error && error.message) || error)
          askAgain(name)
        },
      )
    }
    askAgain('listResumable')
    askAgain('listUnresumable')
    return { started: true }
  })()
`

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 🔴 **What was the app DOING when it refused to close** (294 §2).
 *
 * ⛔ **The one measurement `271` said it could not take.** Its own words: *"the minute did not
 * reproduce on this machine"*, so the question *"where did it go"* was answered by elimination and
 * never by observation. This check catches a hang; until now it SIGKILLed it half a second later and
 * the evidence went with it.
 *
 * ⚠️ **On the failure path only, and after every timing decision has already been made.** Nothing
 * here can turn a pass into a failure or move a number: by the time it runs, the budget is already
 * blown and the run is already red. What it costs is ~3 s of a run that has failed anyway.
 *
 * ⚑ **A stack, not a guess.** `sample` reads the task's threads from outside, so it works on a
 * process that is running no JavaScript at all — which is the case `app-lifetime.ts` names as its own
 * blind spot (*"a main process wedged inside a native call runs no timers"*) and the case a
 * JS-side instrument can never report.
 */
function whatIsItDoing(pid, userDataDir) {
  const say = (label, run) => {
    try {
      return `${label}\n${run().trim()}`
    } catch (error) {
      return `${label}\n(unavailable: ${error instanceof Error ? error.message : String(error)})`
    }
  }

  // The whole family, because Electron is four processes and "the app is alive" may be about any of
  // them. `-o wchan` is the kernel's answer to what a stopped process is stopped ON.
  const tree = say('--- the process family ---', () =>
    execFileSync('ps', ['-o', 'pid,ppid,stat,%cpu,rss,wchan,command', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  )
  const children = say('--- its descendants ---', () =>
    execFileSync(
      '/bin/sh',
      ['-c', `pgrep -P ${String(pid)} | xargs -r ps -o pid,stat,%cpu,command -p`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ),
  )

  if (process.platform !== 'darwin') return `${tree}\n${children}`

  const samplePath = join(userDataDir, `hung-${String(pid)}.sample.txt`)
  const sampled = say('--- sample ---', () => {
    execFileSync('sample', [String(pid), '3', '-f', samplePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 30_000,
    })
    return mainThreadOf(readFileSync(samplePath, 'utf8'))
  })
  // ⚠️ Copied OUT of the `--user-data-dir`, which `reap` deletes moments later.
  const kept = join(tmpdir(), `brobot2-quit-hang-${String(pid)}.sample.txt`)
  try {
    copyFileSync(samplePath, kept)
  } catch {
    // The digest above is the part that has to survive; the full file is a convenience.
  }
  return `${tree}\n${children}\n${sampled}\n(full sample: ${kept})`
}

/**
 * The main thread's deepest frames out of a `sample` report.
 *
 * ⚠️ **The main thread and not the busiest one**: Electron parks worker threads in `mach_msg2_trap`
 * forever by design, so the thread with the most samples says nothing. The question is what the
 * thread that runs `app.quit()` is sitting in.
 */
function mainThreadOf(report) {
  const lines = report.split('\n')
  const start = lines.findIndex((line) => line.includes('com.apple.main-thread'))
  if (start === -1) return report.split('\n').slice(0, 40).join('\n')
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\s*\d+ Thread_/.test(line))
  const thread = rest.slice(0, end === -1 ? rest.length : end)
  // The deepest frames are the answer; the shallow ones are `start`/`main` on every process alive.
  return [lines[start], ...thread.slice(-24)].join('\n')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `the shipped entry point is not built: ${ENTRY} does not exist — run \`pnpm run build\` first`,
    )
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'brobot2-quit-'))
  const socketPath = join(userDataDir, GATE_SOCKET)
  if (socketPath.length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(
      `this check cannot run in the configuration it exists to check: the gate socket path would be ` +
        `${String(socketPath.length)} bytes, over the ${String(SUN_PATH_MAX)}-byte limit. Run with ` +
        `a shorter TMPDIR.`,
    )
  }

  const port = await freePort()
  // ⚠️ Beside the `--user-data-dir` rather than inside it, because `reap` deletes that directory and
  // the failure message is written after it.
  const outputPath = `${userDataDir}.out`
  const outputFd = openSync(outputPath, 'w')
  /** Everything the app has written so far. See {@link OUTPUT_ENCODING} for why this is a file. */
  const read = () => {
    try {
      return readFileSync(outputPath, OUTPUT_ENCODING)
    } catch {
      return ''
    }
  }
  const child = spawn(
    ELECTRON,
    // ⚑ 695 §1 · a gate's window is nobody's: never shown, titled `BroBot2 — test`.
    [
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDir}`,
      HIDDEN_LAUNCH_ARG,
      '.',
    ],
    {
      cwd: DESKTOP,
      // ⚠️ Its own process GROUP and `ELECTRON_RUN_AS_NODE` cleared, for the two reasons
      // `window-opens-check.mjs` records: the `.bin/electron` shim is not the app, and an inherited
      // `ELECTRON_RUN_AS_NODE` boots Electron as plain Node with no `app` at all.
      stdio: ['ignore', outputFd, outputFd],
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  )

  let launchFailure = null
  child.on('error', (error) => (launchFailure = `could not launch ${ELECTRON}: ${error.message}`))

  /**
   * ⛔ **Ownership is captured NOW, while the launch is alive and can still be identified** (325).
   *
   * ⚠️ **Not on the first read**: `node_modules/.bin/electron` is `#!/bin/sh` and `exec`s node under
   * the same pid, so for a few milliseconds that pid names two programs and `captureProcessIdentity`
   * refuses an identity that changes between its two samples — which is the whole point of it.
   */
  let lifecycle = null
  let ownershipFailure = null
  const ownershipDeadline = Date.now() + OWNERSHIP_MS
  while (lifecycle === null && Date.now() < ownershipDeadline && launchFailure === null) {
    try {
      lifecycle = createOwnedProcessLifecycle({
        launcherPid: child.pid,
        discoverDescendants: descendantsOf,
      })
    } catch (error) {
      ownershipFailure = error
      await sleep(50)
    }
  }
  if (lifecycle === null) {
    // ⛔ **Signal the group anyway** (found reviewing this diff). This path has already SPAWNED a
    // detached Electron; walking away from it because the identity could not be captured leaves
    // exactly the leak 241 and 066 are about. ⚠️ The group is the weaker authority — that is the
    // whole reason `owned-process.mjs` exists — but it is the only one this path ever had, and
    // using it is strictly better than using nothing.
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // the group never existed, which is consistent with a launch that never started
    }
    try {
      closeSync(outputFd)
    } catch {
      // Already closed; the file is what matters.
    }
    const output = read()
    throw new Error(
      `could not take ownership of the app this check launched (pid ${String(child.pid)}): ` +
        `${launchFailure ?? ownershipFailure?.message ?? 'no reason was recorded'}\n` +
        `   ⚠️ ${userDataDir} is left in place — a teardown that cannot say WHAT it started must ` +
        `not remove what that thing may still be writing to (325).\n` +
        `--- app output ---\n${output.trim() === '' ? '(nothing)' : output.trim()}\n` +
        `(kept at ${outputPath})`,
      { cause: ownershipFailure ?? undefined },
    )
  }

  /**
   * ⛔ **Reap what we own, then remove where it was writing** (325, `scripts/lib/owned-teardown.mjs`).
   *
   * ## ⚠️ What was here, and why the port could not be the fact
   *
   * This used to SIGKILL the group and then wait for `lsof` to stop naming holders of the debug
   * port. Two things were wrong with that and 326 measured both. The port is one socket of one of
   * five processes, released the moment the browser dies while the GPU, utility and renderer helpers
   * and any provider child are still coming down. And the wait FAILED OPEN: `lsof -t` exits non-zero
   * when it matches nothing, so *"nothing holds it"* and *"I could not ask"* were the same value —
   * **every "the port is free" this file ever printed came out of that `catch`**.
   *
   * ⚑ On this gate's own failure path that also cost real time: the loop asks `lsof` up to fifty
   * times, and one of those calls was measured at 21.3 s.
   */
  const reap = () => {
    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })
    try {
      closeSync(outputFd)
    } catch {
      // Already closed; the file is what matters and it is read before this runs.
    }
    return outcome
  }

  /** What `reap()` could not establish, in the words a person reading a red line needs. */
  /**
   * ⛔ **The third answer, in `352`'s words** (360). A teardown that could not establish what it
   * owns has not completed — and what it could not decide about is a sentence, not a pid, so it
   * goes below the pid lists rather than inside them.
   */
  const refusals = (outcome) =>
    outcome.refused.length === 0
      ? ''
      : `\n   ⛔ refused · ${String(outcome.refused.length)} thing(s) this teardown will not ` +
        `decide about:\n` +
        outcome.refused.map((why) => `      · ${why}`).join('\n')

  const unreaped = (outcome) =>
    `⚠️ and this check could not reap what it launched: ` +
    `${outcome.remaining.length === 0 ? 'no pid is still alive' : `pid(s) ${outcome.remaining.join(', ')} are still alive`}` +
    // ⚑ 333: still in the table on its way out is its own fact — see `window-opens-check.mjs`.
    (outcome.exiting.length > 0
      ? `, pid(s) ${outcome.exiting.join(', ')} are still in the process table on their way out`
      : '') +
    (outcome.unverifiable.length > 0
      ? `, and pid(s) ${outcome.unverifiable.join(', ')} could not be verified either way`
      : '') +
    `. ${userDataDir} was LEFT IN PLACE (325).` +
    refusals(outcome)

  const fail = async (message) => {
    const output = read()
    // ⛔ **The teardown may not REPLACE the failure being reported** (325, found reviewing that diff).
    // Every caller of this is naming what the app did; a `reap()` that threw would overwrite it with
    // itself, which is the exact shape of the merge failure 325 was dispatched for.
    let aside = ''
    try {
      const outcome = reap()
      if (!outcome.complete) aside = `   ${unreaped(outcome)}\n`
    } catch (teardownFailure) {
      aside = `   ⛔ …and the teardown itself failed: ${teardownFailure.message}\n`
    }
    throw new Error(
      `${message}\n` +
        aside +
        `--- app output ---\n${output.trim() === '' ? '(nothing)' : output.trim()}\n` +
        `(kept at ${outputPath})`,
    )
  }

  // Wait for a real window — the same page-target rule as `window:check`, because a CDP endpoint
  // that answers is not a window and quitting one proves nothing about the product.
  const opened = Date.now() + 45_000
  let up = false
  while (Date.now() < opened) {
    const list = await targets(port)
    if (
      list !== null &&
      list.some(
        (t) =>
          t.type === 'page' && typeof t.url === 'string' && t.url !== '' && t.url !== 'about:blank',
      )
    ) {
      up = true
      break
    }
    if (launchFailure !== null) break
    await sleep(POLL_MS * 4)
  }
  if (!up) await fail(`⛔ the app never opened a window, so its quit could not be checked.`)

  // ⛔ **The one place `lsof` is still the right instrument** — it NAMES the process, which the
  // kernel's allocator cannot. ⚠️ And it can now say it does not know: *"nothing holds the port"* and
  // *"I could not ask"* used to be the same answer, and this is the message a person would have had
  // to debug from.
  const holders = whoHoldsPort(port)
  if (holders.state !== 'held') {
    await fail(
      holders.state === 'free'
        ? `⛔ nothing holds the debug port ${String(port)}, so this check cannot find the app.`
        : `⛔ this check could not find out which process holds the debug port ${String(port)}, so ` +
            `it has no pid to ask to quit: ${holders.why}`,
    )
  }
  const [appPid] = holders.pids

  // ⚠️ **Let it settle, and three seconds is a measurement rather than a pause** (271). A BroBot on
  // its New-conversation screen is not idle: the renderer probes both providers for their model
  // menus, and each probe spawns a real `claude` and `codex` child — observed alive at 0.6 s and
  // gone by 1.2 s. Quit inside that window and `closeAll()` waits for their confirmed termination,
  // which measured 0.4–1.7 s of the teardown. ⛔ **That number is a provider binary's startup time
  // and a gate must not depend on one**, so this check waits past it and measures the quit `271`
  // §2's first bullet is about. The probe-in-flight quit was measured by hand instead, and is in the
  // response rather than in this budget.
  await sleep(3_000)

  // ⛔ **The helpers are remembered HERE, with the app up** (325). `refreshDescendants` is a no-op
  // once the launcher is gone and `remember()` refuses a pid whose parent it never saw, so a crash
  // between this line and the teardown would otherwise leave four Electron processes that nothing
  // has authority to signal. ⚠️ A discovery that fails is deliberately not fatal: it makes the
  // lifecycle's uncertainty sticky, and `reap()` reports it rather than going red here, in the
  // middle of a check that has not measured anything yet.
  lifecycle.refreshDescendants()

  // ⛔ **The gate RAN, asked while the app is alive** (found reviewing this diff). Without this the
  // "nothing answers after the exit" assertion below is vacuous in the one configuration that would
  // silently break it: a `--user-data-dir` on which `listen` failed leaves no socket at all, so
  // nothing answers before the quit either and the check reports a released lock it never saw held.
  // `window:check` makes the same assertion for the same reason and 241 is why it exists.
  if (!existsSync(socketPath)) {
    await fail(
      `⛔ the app is running and 236 §3's gate left no socket at ${socketPath} — so this launch is ` +
        `NOT the configuration a person runs, and the lock assertion below would pass over a gate ` +
        `that never ran.`,
    )
  }

  // 🔴 **Start asking, and keep asking across the quit** (273 §3). See {@link RENDERER_ASK}.
  const started = await evaluateInPage(port, RENDERER_ASK)
  if (started.error !== undefined || started.value?.started !== true) {
    await fail(
      `⛔ this check could not start session-list asks in the app's own page: ` +
        `${started.error ?? started.value?.why ?? 'the page said nothing'}. Without them the ` +
        `shutdown-door assertions below would pass over a renderer that never spoke.`,
    )
  }
  // ⛔ **The probe is PROVED to work before anything depends on it, and proved to be FAST.** A
  // `listResumable` that was already failing while the app was healthy would make "nothing failed
  // after the quit" true for the wrong reason; and a probe answering four times a second would step
  // straight over a hundred-millisecond window. Both are the vacuity 241 paid for once already.
  await sleep(PROVE_THE_PROBE_MS)
  const before = await evaluateInPage(port, 'JSON.stringify(window.__quitProbe)')
  const asking = before.error === undefined ? JSON.parse(before.value ?? 'null') : null
  if (asking === null || asking.answered === 0) {
    await fail(
      `⛔ the app is HEALTHY and its own bridge could not answer listResumable/listUnresumable: ` +
        `${before.error ?? JSON.stringify(asking)}. Every assertion below would then be about a ` +
        `probe that never reached the host.`,
    )
  }
  // The teardown's own window is ~100ms wide (database closed at +1ms, `will-quit` at +105ms), so a
  // probe slower than this could pass the line above and still never ask inside it.
  //
  // ⚠️ **A hundred a second is a FLOOR and not the expectation.** Measured here: **27,148**. The
  // gap is deliberate — the number this guards against is Chromium's throttled timer, about one a
  // second, and a bound set near the real rate would go red on a loaded machine instead of on the
  // defect.
  const perSecond = (asking.answered * 1_000) / PROVE_THE_PROBE_MS
  if (perSecond < 100) {
    await fail(
      `⛔ the probe answered only ${perSecond.toFixed(0)}/s while the app was healthy, and the window ` +
        `this check exists to look into is about 100ms wide. A probe this slow can miss it and report ` +
        `a clean quit. ⚠️ Chromium throttles TIMERS in a window that is not in front — if this ` +
        `regressed, something in the ask chain started waiting on one.`,
    )
  }

  // ⛔ **The port instrument is proved to SEE THIS APP before anything below depends on it** (241's
  // lesson, aimed at the probe 326 introduced). The app is up, it is answering DevTools on this port
  // and it therefore holds it — so `free` here is the instrument, not the product, and every
  // assertion about the port being RELEASED would be true for the wrong reason. ⚑ Without this line
  // `couldBindPort` could answer `free` unconditionally and nothing in this file would go red.
  const heldWhileUp = await couldBindPort(port)
  if (heldWhileUp.state !== 'held') {
    await fail(
      `⛔ the app is RUNNING and serving DevTools on port ${String(port)}, and this check's own port ` +
        `probe says ${heldWhileUp.state === 'free' ? '"free"' : `it does not know (${heldWhileUp.why})`}. ` +
        `Every assertion about that port being RELEASED below would then pass over an instrument ` +
        `that cannot see it held.`,
    )
  }

  // ⚠️ SIGTERM, not ⌘Q — see the module note for exactly what that does and does not buy.
  const askedAt = Date.now()
  process.kill(appPid, 'SIGTERM')

  let windowGoneAt = null
  let processGoneAt = null
  let portFreeAt = null
  /** Every port probe that answered neither — see the report below for exactly what that does. */
  const portUnreadable = []
  const deadline = askedAt + QUIT_BUDGET_MS + WINDOW_LAG_MS
  while (Date.now() < deadline) {
    // 🔴 **Cheapest first, and every fact stamped when it is ASKED** (326 §1). ⛔ The three
    // observations used to run in the written order with `Date.now()` taken after each answer came
    // back — so *"has the app gone?"*, which costs nothing, could not be sampled until a CDP probe
    // and an `lsof` had both returned. Instrumented under load: `targets 9ms · lsof 21295ms ·
    // alive 0ms`, and the gate reported **THE APP DID NOT CLOSE … still running 21304ms later** for
    // an app whose own last line is stamped `+110ms` and which was already gone at the first sample.
    //
    // ⚑ **Stamping on ASK under-attributes our own latency rather than charging it to the app**,
    // which is the safe direction: the FACT is still whatever the kernel said, so a port that stays
    // held stays held and the run still goes red — only the number stops being ours.
    const askingProcess = Date.now()
    if (processGoneAt === null && !alive(appPid)) processGoneAt = askingProcess
    if (portFreeAt === null) {
      // ⚑ The kernel's own allocator, not `lsof`: p50 0 ms against p50 277 ms, and it is also the
      // question a person relaunching asks. `unknown` is neither answer — see `port-probe.mjs`.
      const askingPort = Date.now()
      const answer = await couldBindPort(port)
      if (answer.state === 'free') portFreeAt = askingPort
      else if (answer.state === 'unknown') portUnreadable.push(answer.why)
    }
    if (windowGoneAt === null) {
      const list = await targets(port)
      // ⚠️ **Stamped AFTER the answer, and this is the one where that is the safe direction.** This
      // timestamp is only ever used as `processGoneAt - windowGoneAt`, so a LATE stamp makes the lag
      // smaller and a lenient reading; an early one would invent 270's black window out of our own
      // `fetch`. The bound this feeds is the one assertion here that must not go red on the machine.
      if (list === null || !list.some((t) => t.type === 'page')) windowGoneAt = Date.now()
    }
    if (windowGoneAt !== null && portFreeAt !== null && processGoneAt !== null) break
    await sleep(POLL_MS)
  }

  const since = (at) => (at === null ? 'never' : `${String(at - askedAt)}ms`)

  // ⛔ **Read what the app wrote, once it has stopped writing** (294). No wait and no drain: the
  // output is a FILE — see {@link OUTPUT_ENCODING} — so a process that is gone has finished writing
  // it, which a pipe could never promise.
  const output = read()

  if (processGoneAt === null || processGoneAt - askedAt > QUIT_BUDGET_MS) {
    // 🔴 **Stamped BEFORE the diagnostic** (326, found by this dispatch's own red/green pair).
    // `whatIsItDoing` runs `sample` for three seconds, and this number used to be read after it —
    // so the line a person reads said `still running 16441ms later` about a loop that gave up at
    // 9,000 ms, the difference being our own `sample`. ⛔ The run is red either way and no verdict
    // moves, but 326's whole subject is an instrument's cost printed as the product's behaviour,
    // and it is no more acceptable in the failure message than it was in the loop.
    const stillThereAt = processGoneAt ?? Date.now()
    // ⛔ **Ask the kernel what it is doing BEFORE killing it** (294 §2). See {@link whatIsItDoing}.
    const doing = alive(appPid) ? `\n${whatIsItDoing(appPid, userDataDir)}\n` : ''
    await fail(
      `⛔ THE APP DID NOT CLOSE. pid ${String(appPid)} was asked to quit and was still running ` +
        `${since(stillThereAt)} later ` +
        `(budget ${String(QUIT_BUDGET_MS)}ms).\n` +
        `   window gone: ${since(windowGoneAt)} · port released: ${since(portFreeAt)}\n` +
        `   ⚠️ this is 270's finding: a person quits, the window goes, and the old instance keeps ` +
        `the port.\n${doing}`,
    )
  }

  // 🔴 **Measured from `processGoneAt`, not from `askedAt`** (326 §1) — see {@link PORT_RELEASE_MS}.
  //
  // ⛔ **And this is where *"I do not know"* is spent.** The policy, in one sentence: an `unknown`
  // never sets `portFreeAt`, never counts as `held`, kills nothing, and is carried to here. It may
  // not be silently either outcome — so if the port was never seen free the run is RED either way,
  // because a gate must not print a green line for an assertion it could not make — but the message
  // names the instrument rather than the app, and the two are different sentences on purpose.
  if (portFreeAt === null) {
    const holdingNow = whoHoldsPort(port)
    if (portUnreadable.length > 0 && holdingNow.state !== 'held') {
      await fail(
        `⛔ THIS CHECK COULD NOT FIND OUT whether port ${String(port)} was released.\n` +
          `   ${String(portUnreadable.length)} port probe(s) answered neither "free" nor "held"; ` +
          `the last said: ${portUnreadable[portUnreadable.length - 1]}\n` +
          `   naming the holders now says: ${holdingNow.state === 'free' ? 'nothing holds it' : holdingNow.why}\n` +
          `   ⚠️ This is about the INSTRUMENT, not the app — every assertion above it passed. It is ` +
          `red rather than green because 326's whole subject is a gate that reported its own ` +
          `instrument as the product's behaviour, and reporting it as the product's SUCCESS would ` +
          `be the same mistake in a better mood.`,
      )
    }
    await fail(
      `⛔ the app exited but something still holds port ${String(port)}` +
        `${holdingNow.state === 'held' ? ` — pid(s) ${holdingNow.pids.join(', ')}` : ''} — the "old ` +
        `instance still owns the port" half of 270's finding, which is what blocks the relaunch a ` +
        `person tries next.`,
    )
  }
  if (portFreeAt - processGoneAt > PORT_RELEASE_MS) {
    await fail(
      `⛔ the process was gone at +${String(processGoneAt - askedAt)}ms and the port was still held ` +
        `${String(portFreeAt - processGoneAt)}ms later (limit ${String(PORT_RELEASE_MS)}ms). A dead ` +
        `process holds no listening socket, so something else does — a helper reparented to init is ` +
        `the shape 241 paid for — and it is what blocks the relaunch a person tries next.`,
    )
  }

  if (await gateAnswers(socketPath)) {
    await fail(
      `⛔ the one-host gate at ${socketPath} still ANSWERS after the app exited, so the next launch ` +
        `will stand down against a BroBot that is gone. ⚠️ The path surviving is expected and fine ` +
        `(one-host-gate.ts has no release by design); something answering on it is not.`,
    )
  }

  // ⚠️ Only meaningful in the direction that can be wrong: the CDP endpoint dies with the process,
  // so `windowGoneAt` can never be much LATER. A window that vanished long before the process is
  // 270's black window, and it is the only ordering this can catch.
  if (windowGoneAt !== null && processGoneAt - windowGoneAt > WINDOW_LAG_MS) {
    await fail(
      `⛔ the window disappeared ${String(processGoneAt - windowGoneAt)}ms before the process did ` +
        `(limit ${String(WINDOW_LAG_MS)}ms). That is 270's finding exactly: the app looks gone and ` +
        `is not.`,
    )
  }

  // ⛔ The instrument's own assertions. See the module note: without these the check passes on an
  // app that has gone silent about its shutdown again, which is how 270's minute stayed unexplained.
  const report = /BroCrew shut down in (\d+)ms — (.+)/.exec(output)
  if (report === null) {
    await fail(
      `⛔ the app closed inside the budget but said NOTHING about where the time went. 271 §1's ` +
        `whole finding is that 60.489 seconds could not be attributed to a step, because no step ` +
        `was ever reported. Expected a line matching /BroCrew shut down in \\d+ms — …/.\n` +
        `   ⚠️ the app's output is a file this check read AFTER the process was gone ` +
        `(${String(output.length)} bytes at ${outputPath}), so this is the app having said ` +
        `nothing rather than this check having missed it — which is what 294 changed.`,
    )
  }
  for (const step of [
    'stop archive work',
    'close its sessions',
    'drain its archive work',
    'close its database',
  ]) {
    if (!report[2].includes(step)) {
      await fail(`⛔ the shutdown report does not name the step "${step}": ${report[0]}`)
    }
  }
  if (
    !output.includes("reached Electron's will-quit") ||
    !output.includes("reached Electron's quit")
  ) {
    await fail(
      `⛔ the app never reached Electron's own will-quit/quit — so it did not leave through the ` +
        `graceful door, and every number above is about some other exit.`,
    )
  }
  // 🔴 **The last resort firing is REPORTED, not failed** (294), and the change is a finding rather
  // than a relaxation.
  //
  // ⛔ 271 wrote this as a failure — *"an idle quit reaching it means the ordinary path is broken
  // and the hatch is hiding it"* — on the belief that the ordinary path works. It does not, and it
  // is not ours: **bare Electron 43.2.0, twenty lines with one window and no BroBot code, hangs in
  // 5 of 6 loaded quits**, printing `will-quit` and `quit` and then sitting in `mach_msg2_trap`
  // forever. Failing the run when the bound does its job would put the flakiness straight back,
  // this time on the fix.
  //
  // ⚠️ **What still fails is the graceful door being MISSED** — the pair above — because those two
  // events happen at ~106 ms, long before any kill, so an app that force-exited every time would
  // still be caught. And a build where the ordinary path were genuinely broken shows up as this
  // line on EVERY run, which is a distribution and not a run: see 294's response.
  //
  // 🔴 **514 · REPORTED is not the same as READABLE, and the firing now has its own verdict.** The
  // ruling above is unchanged and the run is still green either way; what moved is that a stopped
  // exit stopped being a `✔` with a caveat at the far end of the line. ⛔ **The sentence this used
  // to match on, and the word the line now leads with, are both in `./lib/quit-verdict.mjs`** —
  // out here it could only ever be exercised by a machine under load, which is the one thing
  // `pnpm run ci` cannot summon, and so the stopped arm had never been run by anything.
  //
  // ⚑ This whole note is about a fact that is READ at the foot of this function, beside the line
  // it heads; it is written here because here is where the door it qualifies is asserted.

  // 🔴 **`272` finding 1, as a gate** (273 §3). The renderer was still asking while the four ordered
  // steps ran; nothing it asked for may have reached SQLite after the fourth one closed it.
  const deadDatabase = /.*database connection is not open.*/i.exec(output)
  if (deadDatabase !== null) {
    await fail(
      `⛔ a clean quit reached a CLOSED DATABASE: ${deadDatabase[0].trim()}\n` +
        `   That is 272 finding 1: "after close its database, the old process logged one failed ` +
        `runtime:command query for resumable sessions and one for unresumable sessions".\n` +
        `   ⚠️ The renderer asking during a quit is allowed and normal — answering it out of a ` +
        `connection that is gone is not.`,
    )
  }

  // ⛔ **And the door was REACHED, which is what stops the line above being vacuous** (found
  // reviewing this diff). A probe that died at the announcement, a bridge that stopped forwarding,
  // a window torn down early — every one of them makes "no dead database" true by asking nothing,
  // and the broken tree would then go green. So the refusal has to be IN the output, by name, for
  // both of the two commands `272` measured.
  //
  // ⚠️ **One of the two, not both, and the difference is measured rather than generous.** The
  // renderer is torn down within about ONE round trip of the door shutting — every observed run,
  // broken or fixed, produced exactly two lines — so which of the two chains has a request
  // outstanding in that instant is not something this check controls. One is proof the door
  // answered; that BOTH are refused is held by `shutdown-door.test.ts`, by name, where it costs
  // nothing.
  //
  // ⚠️ Kept in step with `refusedDuringAQuit` in `main/runtime/ipc.ts` by `one-app.test.ts`.
  const refused = ['listResumable', 'listUnresumable'].filter((kind) =>
    output.includes(`BroCrew is shutting down, so ${kind} was not asked of its database`),
  )
  if (refused.length === 0) {
    await fail(
      `⛔ nothing was refused, so this run proved nothing. The probe asks for both lists ` +
        `continuously across the quit, so exactly one of two things is true: the door in ` +
        `executeRuntimeCommand stopped answering, or the asks stopped arriving — and the second ` +
        `would make every assertion above pass over a renderer that had gone quiet.`,
    )
  }

  const outcome = reap()
  // ⚠️ Only on the way out clean: a FAILED run keeps its log, because the message above names it.
  rmSync(outputPath, { force: true })
  // ⚑ **`complete` is three facts, not one** (326, 333): nothing owned is alive, nothing owned is
  // still in the process table on its way out, and nothing was unverifiable. The port could only
  // ever answer the first, and only when `lsof` happened to work.
  if (!outcome.complete) {
    throw new Error(`the app closed, but ${unreaped(outcome)}`)
  }

  // 🔴 **The verdict is a CELL, read from the app's own words** (514). ⛔ Computed HERE, below the
  // last `await fail(` in the file, so that nothing this word says can redden a run: both members
  // of the vocabulary are green, and `294`'s ruling is the reason. ⚠️ And computed BELOW the
  // shutdown-report assertion above, which is what makes `exited` mean *"the app said nothing
  // about a last resort"* rather than *"nothing the app said reached this file"*. Both orderings
  // are asserted in `scripts/test/quit-verdict.test.mjs`, positionally, because both are silent
  // when they go wrong.
  const { head } = quitHeadline({
    output,
    closedIn: since(processGoneAt),
    budgetMs: QUIT_BUDGET_MS,
  })

  console.log(
    `${head} · ` +
      `window gone ${since(windowGoneAt)} · port released ${since(portFreeAt)} ` +
      `(${
        portFreeAt < processGoneAt
          ? `${String(processGoneAt - portFreeAt)}ms before the process`
          : portFreeAt === processGoneAt
            ? 'in the same sample as the process'
            : `${String(portFreeAt - processGoneAt)}ms after it, budget ${String(PORT_RELEASE_MS)}ms`
      }) · gate silent · ` +
      // ⚑ Named on the line a person reads: a probe that could not answer is not a probe that
      // answered "free", and a run where that happened repeatedly is worth seeing even when the
      // port was eventually proved released.
      (portUnreadable.length > 0
        ? `⚠️ ${String(portUnreadable.length)} port probe(s) could not answer · `
        : '') +
      `teardown ${report[1]}ms — ${report[2].trim()}`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
