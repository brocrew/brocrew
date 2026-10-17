#!/usr/bin/env node
/**
 * Require the built entry point to create a page target, with the single-host backstop active.
 *
 *   pnpm run window:check
 *
 * A responding DevTools endpoint or live process does not prove a window exists. Check a
 * page target and the gate socket on a fresh short `--user-data-dir`. Verify `SUN_PATH_MAX`
 * before launch: an overlong socket path fails open and can mask timing around Electron's
 * `ready`. A source-only test cannot observe that startup ordering in the engine.
 *
 * Use a free port and isolated data. No provider session is opened and no tokens are spent,
 * but mounted catalogue readers can spawn real provider children, including detached ones.
 * Quiesce and reap all captured identities before removing data; a group signal alone can
 * miss detached children still writing into the directory. This check runs in `ci`.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
/** What `pnpm run build` produces and what `package.json`'s `main` points at — the SHIPPED entry. */
const ENTRY = join(DESKTOP, 'out/main/index.js')

/**
 * macOS's `sun_path`. ⚠️ **The number the live smokes are on the wrong side of** — see the module
 * note. Linux is 108 and Windows has no such limit; the smaller bound is the honest one to hold
 * this check to, because a directory that fits here fits everywhere.
 */
const SUN_PATH_MAX = 104
/**
 * The name `one-host-gate.ts` binds inside `userData`. ⚠️ Kept in step by `one-app.test.ts`, which
 * asserts this constant and `hostGatePath()` agree — two files naming one socket is exactly the
 * pair that drifts.
 */
const GATE_SOCKET = 'one-host.sock'
/** How long the app may take to put a renderer on screen before this is a failure. */
const WINDOW_MS = 45_000
/** How often to ask. */
const POLL_MS = 250
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
 * The DevTools targets, or null while nothing answers yet.
 *
 * ⚠️ **`null` and `[]` are different answers and this check turns on the difference**: nothing
 * answering means the app is still starting, and an empty list means it started and made no window.
 */
async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return null
    const list = await response.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

async function main() {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `the shipped entry point is not built: ${ENTRY} does not exist — run \`pnpm run build\` first ` +
        `(in \`pnpm run ci\` this step runs after \`build\`, so seeing this means the build did not ` +
        `produce a main bundle)`,
    )
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'brobot2-window-'))
  const socketPath = join(userDataDir, GATE_SOCKET)
  if (socketPath.length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(
      `this check cannot run in the configuration it exists to check: the gate socket path would be ` +
        `${String(socketPath.length)} bytes (${socketPath}), over the ${String(SUN_PATH_MAX)}-byte ` +
        `limit — so 236 §3's gate would fail open and the app would start for the wrong reason, ` +
        `which is exactly how the live smokes missed 241. Run with a shorter TMPDIR.`,
    )
  }

  const port = await freePort()
  let output = ''
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
      stdio: ['ignore', 'pipe', 'pipe'],
      // ⛔ **Its own process GROUP, and the first version of this file did not have it** (found by
      // running it: the check printed its green and then hung, holding a windowless Electron). ⚠️
      // `node_modules/.bin/electron` is a shim that spawns the real binary as ITS child, so the
      // direct child is not the app — killing it leaves the app alive on the pipes, which is
      // precisely the leak this whole file exists to stop somebody shipping.
      detached: true,
      // ⚠️ Inherited and fatal if set: Electron boots as plain Node and `electron.app` is undefined,
      // so the app never starts and this check would report a real failure for the caller's shell.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  )
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  let exited = null
  child.on('exit', (code, signal) => (exited = signal ?? code))
  // ⚠️ **A spawn that never happened emits `error`, not `exit`** — a missing or unbuilt Electron
  // would otherwise poll a dead port for the full 45 s and then report "never answered", which is
  // true and says nothing about the cause. `16`'s question, one layer down: leak a raw `ENOENT`, or
  // say what could not be started?
  child.on('error', (error) => {
    output += `\ncould not launch ${ELECTRON}: ${error.message}`
    exited = 'never started'
  })

  /**
   * ⛔ **Ownership is captured NOW, while the launch is alive and can still be identified** (326 §2).
   *
   * ## 🔴 What used to be here, and why the group was not enough either
   *
   * ⛔ **The first version signalled the group and asked `kill(pid, 0)` whether it was gone. It
   * reported success and left a full Electron — main, GPU, network and a RENDERER — running for six
   * hours**, found by `ps` during 241's own mutation run: Electron outlives the group leader, and
   * the moment its parent dies it is reparented to init, at which point `kill(-pid, 0)` answers
   * ESRCH — *"it is gone"* — about a live app. `M11`'s `dom INVALID (collected 627 of 686)` in that
   * run was the corpse holding the CPU.
   *
   * ⚠️ **241 answered that by chasing the PORT, and 325 measured that this swapped one wrong fact
   * for another.** The port is one socket of one of five processes; at the instant it reads empty
   * four Electron processes are still in the table. And the wait failed OPEN — `lsof` exits non-zero
   * when it finds nothing, so *"nothing holds it"* and *"I could not ask"* were one value, and the
   * removal below then raced whatever was still writing.
   *
   * ⚑ **`287`/`294` built the fact that actually answers it.** `owned-process.mjs` remembers what it
   * saw while the launch was alive, re-reads those facts beside every signal, and calls a teardown
   * `complete` only when nothing is alive **and nothing was unverifiable**. A pid is only an address;
   * the identity is the authority.
   *
   * ⚠️ **Not on the first read.** `node_modules/.bin/electron` is `#!/bin/sh` and `exec`s node under
   * the same pid, so for the first milliseconds that pid names two different programs — and
   * `captureProcessIdentity` refuses an identity that changes between its two samples, which is the
   * whole point of it. The shim never execs twice, so the first stable reading is the one that lasts.
   */
  let lifecycle = null
  let ownershipFailure = null
  const ownershipDeadline = Date.now() + OWNERSHIP_MS
  while (lifecycle === null && Date.now() < ownershipDeadline && exited === null) {
    try {
      lifecycle = createOwnedProcessLifecycle({
        launcherPid: child.pid,
        discoverDescendants: descendantsOf,
      })
    } catch (error) {
      ownershipFailure = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (lifecycle === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // the group never existed, which is consistent with a launch that never started
    }
    throw new Error(
      `could not take ownership of the app this check launched (pid ${String(child.pid)}): ` +
        `${exited === null ? (ownershipFailure?.message ?? 'no reason was recorded') : `it exited first (${String(exited)})`}\n` +
        `   ⚠️ ${userDataDir} is left in place — a teardown that cannot say WHAT it started must ` +
        `not remove what that thing may still be writing to (325).\n` +
        `--- app output ---\n${output.trim() === '' ? '(nothing)' : output.trim()}`,
      { cause: ownershipFailure ?? undefined },
    )
  }

  /**
   * ⛔ **Reap what we own, then remove where it was writing** — the ordering `325` exists for, in
   * `scripts/lib/owned-teardown.mjs` beside the measurements that justify it.
   *
   * ⚠️ SIGKILL rather than a polite SIGTERM, which is what `kill9()` is: this app is a throwaway on
   * a temp directory that is about to be deleted and its orderly teardown takes up to 20 s. ⛔ There
   * is a gate that measures the graceful path and it is `quit:check`; this one has nothing to unwind.
   *
   * ⚠️ The pipes are destroyed after the reap rather than before it, so nothing already buffered is
   * discarded — but the reap is synchronous, so no `data` event fires while it runs.
   */
  const stop = () => {
    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })
    child.stdout.destroy()
    child.stderr.destroy()
    return outcome
  }

  /**
   * What `stop()` could not establish, said in the words a person reading a red line needs.
   *
   * ⚑ **Three lists, because they ask for three different things** (333). A pid in `remaining` is an
   * app still RUNNING and is 241's failure. A pid in `exiting` is one this check killed that had not
   * left the process table within the reap's bound — the question that raises is about the bound,
   * not about a leak. `unverifiable` is the instrument, not the app.
   */
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
    `this check could not reap what it launched: ` +
    `${outcome.remaining.length === 0 ? 'no pid is still alive' : `pid(s) ${outcome.remaining.join(', ')} are still alive`}` +
    (outcome.exiting.length > 0
      ? `, pid(s) ${outcome.exiting.join(', ')} are still in the process table on their way out`
      : '') +
    (outcome.unverifiable.length > 0
      ? `, and pid(s) ${outcome.unverifiable.join(', ')} could not be verified either way`
      : '') +
    `. ⚠️ An app left running is the failure 241 is about — it perturbs everything measured after ` +
    `it (066) and must not hide behind a green line.\n` +
    `   ⚠️ ${userDataDir} was LEFT IN PLACE: removing the user-data directory of an app that may ` +
    `still be writing to it is what made \`fixture:check\` fail with ENOTEMPTY on 324's merge (325).` +
    refusals(outcome)

  const deadline = Date.now() + WINDOW_MS
  let pages = []
  let answered = false
  while (Date.now() < deadline) {
    const list = await targets(port)
    if (list !== null) {
      answered = true
      // ⛔ **A page target appears the moment `new BrowserWindow()` is constructed** — measured: this
      // check went green in 0.8 s, before the app's document existed, and reported `(untitled)`. ⚠️
      // An empty `url` or `about:blank` is a window with nothing in it, which is a weaker claim than
      // the one this file is here to make. Requiring a real document URL is what makes the green
      // mean *"our renderer loaded"* rather than *"a window object was allocated"*.
      pages = list.filter(
        (target) =>
          target.type === 'page' &&
          typeof target.url === 'string' &&
          target.url !== '' &&
          target.url !== 'about:blank',
      )
      if (pages.length > 0) break
    }
    // ⛔ An app that DIED is a failure now rather than in 45 seconds — and its output is the report.
    if (exited !== null) break
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  // ⛔ **The helpers are remembered HERE, with the app still up** (325). `refreshDescendants` is a
  // no-op once the launcher is gone and `remember()` refuses a pid whose parent it never saw, so a
  // crash between this line and the teardown would otherwise leave four Electron processes that
  // nothing has authority to signal. ⚠️ A discovery that fails is deliberately not fatal here: it
  // makes the lifecycle's uncertainty sticky, and `stop()` reports it as an unreaped launch rather
  // than as a red in the middle of a check that has not measured anything yet.
  lifecycle.refreshDescendants()

  // ⚠️ Read BEFORE the app is killed — the socket's PATH survives the process on POSIX, but reading
  // it first keeps this an observation of a running app rather than of what it left behind.
  const gateRan = existsSync(socketPath)
  // ⛔ **Snapshot BEFORE `stop()`, because `stop()` sets it** (found reviewing this diff). The kill
  // fires `exit`, so a report written afterwards said `process exited (SIGKILL)` about an app that
  // was alive and windowless until we killed it — attributing our own signal to the product, in the
  // one message somebody reads to find out how it failed.
  const diedOnItsOwn = exited
  // ⛔ **The teardown may not REPLACE the failure being reported** (325, found reviewing that diff).
  // Everything below wants to say what the app did; a `stop()` that threw from here would overwrite
  // it with itself, which is the exact shape of the merge failure 325 was dispatched for.
  let outcome = null
  let teardownFailure = null
  try {
    outcome = stop()
  } catch (error) {
    teardownFailure = error
  }
  /** The teardown as a SECOND fact, appended to whatever this run was actually about. */
  const alsoUnreaped =
    teardownFailure !== null
      ? `\n   ⛔ …and the teardown itself failed: ${teardownFailure.message}`
      : outcome.complete
        ? ''
        : `\n   ⛔ …and ${unreaped(outcome)}`

  if (pages.length === 0) {
    throw new Error(
      `⛔ THE APP DID NOT OPEN A WINDOW.\n` +
        `   entry:      ${ENTRY}\n` +
        `   user data:  ${userDataDir}\n` +
        `   devtools:   ${answered ? 'answered, with no page target holding a document' : 'never answered'}` +
        `${diedOnItsOwn === null ? ' · the app was still running' : ` · the app exited on its own (${String(diedOnItsOwn)})`}\n` +
        `   ⚠️ a CDP endpoint that answers is not a window — see 241 §3.${alsoUnreaped}\n` +
        `--- app output ---\n${output.trim() === '' ? '(nothing)' : output.trim()}`,
    )
  }

  if (!gateRan) {
    throw new Error(
      `the window opened, but 236 §3's gate left no socket at ${socketPath} — so this launch was ` +
        `NOT the configuration a person runs: the gate failed open, and a start() that runs before ` +
        `\`ready\` for that reason is exactly what hid 241 from every live smoke. Investigate the ` +
        `gate before trusting this green.${alsoUnreaped}\n--- app output ---\n${output.trim()}`,
    )
  }

  // ⛔ **A leak FAILS, and it used to warn** (241, found by its own mutation run). A check that
  // leaves a windowless — or worse, a working — Electron behind is the state this dispatch reported
  // as a healthy app three times, and it perturbs everything measured after it. It must not be able
  // to happen behind a green line.
  //
  // ⚑ **`complete` is three facts, not one** (326 §2, 333): nothing owned is alive, nothing owned is
  // still in the process table on its way out, and nothing was unverifiable. The port could only
  // ever answer the first, and only when `lsof` happened to work — and until 333 the second was
  // missing, which is how this check came to report `ENOTEMPTY` about a directory it had just
  // declared safe to remove.
  if (teardownFailure !== null) {
    throw new Error(
      `the window opened, but the teardown itself failed: ${teardownFailure.message}`,
      { cause: teardownFailure },
    )
  }
  if (!outcome.complete) {
    throw new Error(`the window opened, but ${unreaped(outcome)}`)
  }

  console.log(
    `window:check ✔ ${String(pages.length)} page target(s) — ${pages[0].title || '(untitled)'} ` +
      `at ${pages[0].url} · gate socket present (${String(socketPath.length)}/${String(SUN_PATH_MAX)} bytes)`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
