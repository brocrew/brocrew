#!/usr/bin/env node
/**
 * Drive a real session through a process kill and relaunch on the same `--user-data-dir`:
 * start, send, kill, reopen the offered conversation, verify prior transcript and send again
 * on the same provider thread. No memory crosses the relaunch; recovery comes from the database.
 *
 *   pnpm run smoke:resume
 *
 * The front door selects Codex. A conflicting `BROBOT_SMOKE_PROVIDER` is refused rather
 * than silently running Codex under a different provider label (`FRONT_DOOR_PROVIDER`).
 * Outside `ci`: needs the app, provider login and network. Evidence lives under
 * `/tmp/brobot2-resume-smoke/<run>`, with `latest` pointing to the newest run.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constantFrom } from './lib/app-source.mjs'
import { whatTheFrontDoorCannotCarry } from './lib/front-door.mjs'
import { assertPortNotShared, assertPortOwnedByTree } from './lib/smoke-target.mjs'
import { witnessGate } from './lib/host-gate-witness.mjs'
import { beginSmokeRun, smokeTmpRoot, smokeUserDataDir } from './lib/smoke-run.mjs'
import {
  asserted,
  claims,
  notPerformed,
  outcomeVerdict,
  summarize,
  unasserted,
} from './lib/smoke-verdicts.mjs'
import { brobotWorkspace } from './lib/app-source.mjs'
import { WIDE_READ_MARK, assertTabFlow } from './lib/tab-flow.mjs'
import { chromeInkVerdict, inkFields, paperFields, paperVerdict } from './lib/paper-ground.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
/**
 * ⛔ **What the front door starts a conversation on, which this script does not choose** (420,
 * from 417 / HO-022 §2).
 *
 * The front door sends exactly `{ provider: <what a launch as BroBot resolves to>, profileId:
 * 'default', approvalMode: 'ask' }`. ⚠️ **That resolution is `providerForALaunch`: BroBot's own
 * identity row FIRST (`423`), and `RuntimeScreen.vue`'s `DEFAULT_PROVIDER` only as a fallback.**
 * ⛔ **This paragraph said the frame's constant WAS the answer, and `433` is where that stopped
 * being true**: a person can now write that row, on the identity's own sheet. ⚑ `417 §3`'s other
 * half is untouched and is what this script still rests on — nothing in the app can move a
 * session's provider once it is open. So this is the provider for THIS run, or there is no run.
 *
 * ⚑ **DERIVED, and CHECKED against the running app in step 1** — belt and braces, and both halves
 * earn their place. The declaration is `const DEFAULT_PROVIDER: Provider = 'codex'` inside a
 * `.vue` and is not exported; `lib/app-source.mjs` reads that spelling too, so this is the app's
 * own value rather than a second copy of it (standing rule 1). ⚠️ And step 1 still reads the
 * session's provider HOME, which ends `…/<profile>/<provider>`, because a constant read correctly
 * out of a file the renderer stopped using would be right about the source and wrong about the app.
 */
const FRONT_DOOR_PROVIDER = constantFrom('DEFAULT_PROVIDER')

/**
 * ⛔ **`BROBOT_SMOKE_PROVIDER` cannot be honoured, and must not be quietly ignored** (420 §4).
 *
 * ⚠️ **Refused rather than dropped, and refused rather than obeyed.** Dropping it would run the
 * whole §7 demo on Codex under a banner reading `provider claude` — a green run reporting evidence
 * it never gathered, which is the class this dispatch exists to close. Obeying it is impossible:
 * there is no surface, and `420` §6 is explicit that the gap is REPORTED rather than worked around
 * with a picker behind a flag.
 *
 * 🔴 **What goes with it, said plainly**: the resume path — start, quit, relaunch, reopen, continue
 * — is no longer exercised on Claude by any instrument in this repo. Claude's resume stays covered
 * by the unit suites, and a unit suite cannot see a real process restart. That is a capability
 * finding rather than a defect in this script, and it is the reason this block is loud.
 */
const providerAsked = process.env.BROBOT_SMOKE_PROVIDER
if (providerAsked !== undefined && providerAsked !== FRONT_DOOR_PROVIDER) {
  throw new Error(
    `⛔ BROBOT_SMOKE_PROVIDER=${providerAsked} cannot be honoured: 417 removed the launcher's ` +
      `provider picker (HO-022 §2) and this front door opens ${FRONT_DOOR_PROVIDER} conversations ` +
      `— that is what a launch as BroBot resolves to here, and choosing another would make this a ` +
      `different measurement. Change it on BroBot's own sheet (433) instead. Unset ` +
      `it to run the demo the way a person can reach it.`,
  )
}
/**
 * The workspace instruction marker — proves the rendered files came from the canonical source.
 *
 * ⚑ **Derived since `420`** (standing rule 1). Its own docblock in `workspace.ts` is why an
 * instrument may lean on it — *"a token no model would produce unprompted"* — and a hand-copy of
 * a token whose whole purpose is to be unmistakable is a token that can quietly stop matching.
 */
/**
 * ⛔ **One directory per RUN, and a lock so there is only ever one run** (188 §2, from 182 M7) —
 * the same treatment `ui-live-smoke.mjs` got, from the same shared module. This script had the
 * identical shape: two fixed roots, both wiped at start, so a second run destroyed the first one's
 * evidence and two concurrent runs destroyed each other's live tree.
 *
 * ⚠️ **`USER_DATA` stays inside the run**, which is exactly what makes the relaunch a relaunch: both
 * app instances share it, and nothing else does.
 */
const {
  evidence: EVIDENCE,
  scratch: SCRATCH,
  runId: RUN_ID,
} = beginSmokeRun({
  // ⛔ 242 §1 — short enough that `236` §3's gate socket fits `sun_path`. See `smoke-run.mjs`.
  evidenceRoot: smokeTmpRoot('brobot2-resume-smoke'),
  scratchRoot: join(homedir(), 'brobot2-scratch', 'resume-smoke'),
  // Cheaper and smaller than the UI smoke's tree, so more of them fit.
  keep: 10,
})
/** Shared across BOTH app instances — this is what makes the second one a relaunch. */
const USER_DATA = smokeUserDataDir(EVIDENCE, 'user-data')
// The app creates this durable directory, and a launch without a folder runs here.
// Read its name from the app so the harness follows the same path.
const WORKSPACE = brobotWorkspace(USER_DATA)

/**
 * ⚑ **738 · How many `turn` events the LEDGER holds for one conversation** — the count the page a
 * stopped conversation's start replays puts back on Events, so step `6`'s baseline. ⛔ Not a count
 * remembered from before the quit: `738`'s batch 3 measured a turn begin AFTER that count was taken
 * (BroBot's delegated child answered, and the quit interrupted the delivery), so the replay held one
 * more turn than remembered and step `6`'s wait returned at once, on the old reply.
 *
 * ⚠️ Read through a PRIVATE COPY, never in place — `ui-live-smoke.mjs`' `queryDatabase`, for `055`'s
 * reason: a read-only open of a live WAL database is refused, or creates the `-shm` itself.
 */
function ledgerTurnCount(sessionId) {
  const db = join(USER_DATA, 'brobot2.sqlite')
  const scratch = mkdtempSync(join(tmpdir(), 'brobot2-resume-db-'))
  try {
    const copy = join(scratch, 'copy.sqlite')
    copyFileSync(db, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${db}${suffix}`)) copyFileSync(`${db}${suffix}`, `${copy}${suffix}`)
    }
    const out = execFileSync(
      'sqlite3',
      [
        '-json',
        copy,
        `SELECT count(*) AS n FROM events WHERE session_id = '${sessionId}' AND type = 'turn'`,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    ).trim()
    return JSON.parse(out || '[{"n":0}]')[0].n
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
/**
 * Where this run's app writes its stdout and stderr. See the launch below, and step 7.
 *
 * ⚑ **One file for both launches, appended, and that is right here** — unlike `ui-live-smoke.mjs`,
 * which needs one per launch because step 38b runs two apps at once. This suite stops `first` before
 * it starts `second`, so the two never write concurrently, and step 7's question spans the seam: an
 * ordinal published out of order BEFORE the quit is exactly as interesting as one after it.
 */
const APP_LOG = join(EVIDENCE, 'app.log')
/**
 * The profile every session from this page runs in. Fixed by 013 — the new-conversation page
 * starts BroBot, and BroBot's profile is `default`; the UI no longer offers a choice. What this
 * smoke still proves about 085 is the part a person can reach: the session RECORDS its home, and a
 * resume lands back in that recorded home rather than in whatever the default would be that day.
 * Named-profile resume stays covered by the unit suite (session-profile.test.ts).
 *
 * ⚠️ **This paragraph was false between 167 and 417, and is true again** — `167` put a profile
 * picker on the page (which is what `openLauncher`'s old docblock was complaining about) and `417`
 * deleted it with the rest of the settings block. Left standing WITH that history, so the next
 * reader does not "correct" a sentence that currently describes the product.
 */
// ⛔ 665 · READ from the app, never restated: since `592` the front door runs as BroBot, whose slug
// is `brobot`, and a literal `'default'` here made step 1's home check throw on every run.
const PROFILE = constantFrom('DEFAULT_PROFILE_ID')
const TURN_BUDGET_MS = 180_000
/**
 * ⛔ **There is no model constant here any more, and that is a LOSS rather than a tidy-up** (420,
 * from 417 / HO-022 §2).
 *
 * This file named the model each run ASKED for (`BROBOT_SMOKE_MODEL`, defaulting per provider) and
 * its paragraph said why: *"Not a cost choice — it is what makes the model assertions mean
 * anything… a named model, recorded on the row, replayed into the resume."* ⚠️ **Every word of
 * that is still the right ambition and none of it is reachable.** `417` deleted the launcher's
 * model field, so the front door sends no model at all: there is nothing to record on the row and
 * nothing to replay, and `describeModel`'s *"our request, marked `(requested)`"* branch — 179's
 * own subject — cannot be produced by any gesture a person can make.
 *
 * ⛔ **What went with it, named at the two places it used to act:**
 *
 *  - **The launcher pre-flight is DROPPED, not moved.** It read the offered list and refused a
 *    stale id *"loudly, in the launcher, rather than silently launching onto something else"*. The
 *    drawer's live model control is the surface that carries model choice now, and it cannot
 *    stand in: its change is QUEUED for the NEXT message, so it cannot pre-flight a launch that
 *    has already happened, and setting it would silently change what step `6` runs on. A check
 *    with no launch behind it is a check nothing depends on, so there is none.
 *  - **The two model ASSERTIONS are re-anchored, not deleted.** Step `1` asks whether a
 *    conversation that has answered NAMES a model; step `6` asks whether a genuinely new app
 *    process names the SAME one once it has answered again (since `738`: step `5` reads none
 *    before). What neither can ask any more is *which* model — and step `5b` is where
 *    that is reported rather than left for a reader to notice.
 */

/**
 * ⛔ **What the model row says when nobody chose and nobody reported** — `describeModel`'s third
 * answer (`runtime-host.ts`), and the exact string 179 is about.
 *
 * ⚠️ **Written down rather than derived, because it cannot be derived today**: it is a literal
 * inside a function rather than an `export const`, so `lib/app-source.mjs` has nothing to read.
 * ⚑ It is used in one direction only — a row that reads it is a FAILURE — so a drift makes this
 * assertion weaker rather than wrong. The remedy is to export the ellipsis from the host beside
 * the other three constants that module already owns.
 */
const MODEL_UNREPORTED = '…'

const results = []
/**
 * `true` → PASS · `false` → FAIL · **or the verdict itself**, which is how the other three arrive.
 *
 * ⛔ **The third verdict is 196 H1** and ⛔ **the fifth is 420 §4** — `NOT PERFORMED`, a step whose
 * gesture the product no longer offers. `lib/smoke-verdicts.mjs` carries the reasoning and the
 * arithmetic, there so that both are testable: `pnpm run ci` cannot run a live smoke.
 *
 * ⛔ **And the CLAIMS travel with the result now** (206 H1, and until 420 they did not travel here
 * at all). This pushed `{ verdict, ok, line }` and `step()` destructured only `{ verdict, detail }`
 * — so `summarize`'s claim counters were structurally `0/0` on every run this file has ever
 * reported, and the `name` a blank claim is attributed to was never recorded either. ⚑ **`ok` goes
 * with the same change**: nothing read it, and the moment a verdict STRING arrives here it would
 * have answered `false` for every PASS — a dead field that had quietly become a wrong one.
 */
function record(ok, name, detail, claimed) {
  const verdict = typeof ok === 'string' ? ok : ok ? 'PASS' : 'FAIL'
  const line = `${verdict} ${name}${detail ? ` — ${detail}` : ''}`
  // ⚠️ **A FAIL contributes no claims**: the step did not finish, so what it would have claimed is
  // unknown, and inventing an unasserted claim for it puts a number on something nobody measured.
  results.push({ verdict, line, name, claims: claimed ?? [] })
  console.log(line)
  writeFileSync(join(EVIDENCE, 'smoke.log'), results.map((r) => r.line).join('\n') + '\n')
}
/** The step being driven right now, so a lost CDP reply can name it (162 §2). */
let currentStep = 'before any step'

async function step(name, fn) {
  currentStep = name
  try {
    // ⚠️ Renamed on the way in: `claims` is the helper a step BUILDS its answer with, and shadowing
    // it here would make the next multi-claim step in this file fail to compile for no reason.
    const { verdict, detail, claims: claimed } = outcomeVerdict(await fn())
    record(verdict, name, detail, claimed)
  } catch (error) {
    record(false, name, error instanceof Error ? error.message : String(error))
    throw error // every later step depends on this one; a cascade of noise helps nobody
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Whether nothing is holding `port` — the check the relaunch waits on. */
function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

/**
 * ⛔ **`fetch` with a deadline, because `waitFor`'s own deadline is unreachable without one**
 * (162 §2, found by running).
 *
 * `waitFor` awaits its predicate and only THEN looks at the clock — so a request that never returns
 * is not a slow poll, it is the end of the run. Measured today, on the first `smoke:resume` to
 * reach step `2` since `075`: the app SIGTERMed at the quit went on holding its debug port for
 * about four and a half minutes while answering nothing, and `curl` against it hung exactly the
 * same way. That is `066`'s rule — a harness that hangs is worse than one that fails — arriving
 * over HTTP instead of over the CDP socket.
 *
 * Every caller already treats a throw as "not answering yet", so an abort reads correctly at all of
 * them **except one**: see step `2`, which asks whether the app is GONE and must not read silence
 * as an answer.
 */
function probe(url, timeoutMs = 4_000) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
}

async function waitFor(what, predicate, timeoutMs = 60_000, pollMs = 250) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(pollMs)
  }
}

/**
 * One app instance on its own ports, sharing the user-data directory. `reuseUserData`
 * is the whole point of the second launch: same database, same provider homes.
 */
async function launchApp({ reuseUserData, rendererPort: reusePort }) {
  if (!reuseUserData) rmSync(USER_DATA, { recursive: true, force: true })
  const [port, hmrPort] = [await freePort(), await freePort()]
  // The RELAUNCH reuses the renderer port, so the second app loads from the same origin as the
  // first. In dev the renderer is served over http, and `localStorage` is keyed by origin — so a
  // fresh random port made every per-machine preference (the debug eye, the reading light) look
  // like it had been forgotten, when what actually changed was the address it was stored under.
  // Production loads from `file://` and has one origin for the life of the install; this makes the
  // harness match that, which is the only way a preference can be tested across a real restart.
  // Reusing it races the previous Vite server letting go of the socket, and the dev server is
  // strict about its port — so it would fail to bind and this script would sit waiting for CDP
  // until the 180s timeout, reporting "the app never came up" for a port that was simply still in
  // TIME_WAIT. Wait for it to actually be free, and say so plainly if it never is.
  const rendererPort = reusePort ?? (await freePort())
  if (reusePort !== undefined) {
    await waitFor(
      `renderer port ${reusePort} to be released by the previous app`,
      async () => await portIsFree(reusePort),
      30_000,
      250,
    )
  }
  assertPortNotShared(port)
  // 🔴 **The app's own output goes to a FILE, and until 345 it went nowhere** (345 §3, from 342).
  // `runtime-host.ts`'s out-of-order tripwire reports on a bare `console.error` in the MAIN process,
  // and this suite spawned the app with `stdio: 'ignore'` — ⛔ **so the one live suite that really
  // falsifies event ordering (step 7's dense-ordinal check across the quit seam) was deaf to the
  // app's own alarm about it.** A clean negative from a deaf instrument is worth almost nothing.
  //
  // ⚠️ **A file rather than a pipe**, for `app-closes-check.mjs`'s reason: Node makes stdout/stderr
  // synchronous when they are files, so the last line before a quit is never queued and lost — and
  // this suite quits the app on purpose, twice.
  const appLog = openSync(APP_LOG, 'a')
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@brobot2/desktop',
      'exec',
      'electron-vite',
      'dev',
      '--remoteDebuggingPort',
      String(port),
      '--',
      `--user-data-dir=${USER_DATA}`,
      // ⚑ 695 §1 · this run's window is nobody's: never shown, titled `BroBot2 — test`.
      HIDDEN_LAUNCH_ARG,
    ],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', appLog, appLog],
      detached: true,
      env: {
        ...process.env,
        // Set by some shells; Electron would boot as plain Node and never start the app.
        ELECTRON_RUN_AS_NODE: undefined,
        BROBOT_RENDERER_PORT: String(rendererPort),
        BROBOT_RENDERER_HMR_PORT: String(hmrPort),
      },
    },
  )
  // The child holds its own descriptor now; ours would otherwise accumulate one per launch, and
  // this suite launches repeatedly across the resume seam.
  closeSync(appLog)
  /**
   * Reap the launched app and verify that it is gone. Electron can outlive its dev-server parent and
   * leave a listener behind after group termination. Find that listener on the launch's own port,
   * never by process-name matching. Restrict lsof to LISTEN sockets so the script's outgoing CDP
   * connection cannot identify the script itself as the target.
   */
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM') // the whole group: vite + electron
    } catch {
      // already gone
    }
    for (let i = 0; i < 40; i++) {
      let listening = false
      try {
        execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .split('\n')
          .map((line) => Number(line.trim()))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
          .forEach((pid) => {
            listening = true
            try {
              process.kill(pid, i < 10 ? 'SIGTERM' : 'SIGKILL')
            } catch {
              // already gone
            }
          })
      } catch {
        // `lsof` exits non-zero when nothing holds the port — which is the state we want
      }
      if (!listening) return
      // Synchronous: `stop()` is also called from `process.on('exit')`, where nothing asynchronous
      // can run at all.
      try {
        execFileSync('sleep', ['0.25'], { stdio: 'ignore' })
      } catch {
        // sleep is not worth failing over
      }
    }
  }
  process.on('exit', stop)
  await waitFor(
    `the app to expose CDP on ${port}`,
    async () => {
      try {
        await probe(`http://127.0.0.1:${port}/json/version`)
        return true
      } catch {
        return false
      }
    },
    180_000,
  )
  assertPortOwnedByTree({ port, repoRoot: REPO_ROOT })
  // ⛔ **The gate ran and ANSWERED** (242 §1). Unconditional and on every launch, because the one
  // thing this instrument could never see was a shipped feature that did nothing — see
  // `host-gate-witness.mjs`. ⚠️ On the RELAUNCH the socket may be the first app's artefact that the
  // second app broke and re-claimed; what is asserted either way is that a live gate holds this
  // `userData`, which is exactly what `236` §3 promises and what was false here until today.
  // ⚠️ **And it reaps what it launched if it fails.** `launchApp` hands the caller the only handle
  // that can stop this app, so throwing before the return would leave a live Electron on the
  // machine for the rest of the run — 066's leak, through the door 242 just added.
  try {
    const { token } = await witnessGate(USER_DATA)
    console.log(`one-host gate engaged on ${USER_DATA} — token ${token}`)
  } catch (error) {
    stop()
    throw error
  }
  return { port, rendererPort, pid: child.pid, stop }
}

/**
 * ⛔ **How long one CDP request may go unanswered before it becomes a failing step** (162 §2).
 *
 * Same value and same reasoning as `ui-live-smoke.mjs`, which carries the long version: 161's run
 * sat 17 minutes inside a single step on a socket that stayed ESTABLISHED at both ends while one
 * reply went missing, and `066`'s `close`/`error` guard cannot see that. This file needs it more
 * than the other one does, because its `step()` re-throws — a wedge here does not cost one step, it
 * costs every step behind it, which is exactly what "not run since 075" is made of.
 */
const CDP_SEND_BUDGET_MS = 90_000

class Cdp {
  #socket
  #id = 0
  #pending = new Map()

  static async attach(port) {
    const target = await waitFor('the renderer target', async () => {
      try {
        const targets = await probe(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
        return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      } catch {
        return undefined
      }
    })
    const cdp = new Cdp()
    await cdp.#connect(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await waitFor('the app to mount', async () => {
      try {
        return await cdp.evaluate(
          `return Boolean(window.api?.runtime) && Boolean(document.querySelector('[data-cy=new-conversation]'))`,
        )
      } catch {
        return false
      }
    })
    return cdp
  }

  #connect(url) {
    this.#socket = new WebSocket(url)
    this.#socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    // ⚠️ **A dead socket must FAIL the step, not hang the run** (066, which only ever landed in the
    // other file). This script closes the app on purpose in step `2`, so a socket that goes away
    // under an in-flight request is a shape it actively invites.
    const die = (why) => {
      for (const [, pending] of this.#pending) pending.reject(new Error(`CDP ${why}`))
      this.#pending.clear()
    }
    this.#socket.addEventListener('close', () => die('connection closed'))
    this.#socket.addEventListener('error', () => die('connection errored'))
    return new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true })
      this.#socket.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return
        reject(
          new Error(
            `CDP ${method} sent no reply in ${CDP_SEND_BUDGET_MS / 1000}s during step ` +
              `"${currentStep}" — the socket is still ${this.#socket.readyState === WebSocket.OPEN ? 'OPEN' : `readyState ${this.#socket.readyState}`}, ` +
              `so this is a lost reply rather than a dropped connection (162 §2)`,
          ),
        )
      }, CDP_SEND_BUDGET_MS)
      timer.unref?.()
      const settle = (fn) => (value) => {
        clearTimeout(timer)
        fn(value)
      }
      this.#pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    await this.#walkTabFlow(expression)
    return await this.#evaluateRaw(expression)
  }

  async #evaluateRaw(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'page threw')
    }
    return result.result.value
  }

  /**
   * **The tab-flow walk** (097) — the same enforcement `ui-live-smoke.mjs` gets, on the script that
   * needs it most.
   *
   * This one reads across TWO tabs: the ordinals off Events and the session ref and provider home
   * off Info. Its own `SNAPSHOT` already carries a comment saying *"the two below are Info-tab rows
   * and read null unless the drawer is on Info"* — an accurate warning that nothing enforced. Now
   * a read of an owned hook has to be on the tab that owns it.
   *
   * See `scripts/lib/tab-flow.mjs` for the rule and the exemption.
   */
  async #walkTabFlow(expression) {
    await assertTabFlow(expression, (probe) => this.#evaluateRaw(probe))
  }

  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(EVIDENCE, `${name}.png`), Buffer.from(data, 'base64'))
  }

  close() {
    this.#socket.close()
  }
}

const SET_VALUE = (cy, value) => `
  const el = document.querySelector('[data-cy=${cy}]')
  if (!el) throw new Error('no [data-cy=${cy}]')
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  return true`

const ORDINALS = `
  return [...document.querySelectorAll('[data-cy=event-log] li')].map((li) => Number(li.dataset.ordinal))`

const CLICK = (cy) => `
  const el = document.querySelector('[data-cy=${cy}]')
  if (!el) throw new Error('no [data-cy=${cy}]')
  el.click()
  return true`

const SNAPSHOT = `
  // ${WIDE_READ_MARK} — this reaches across Events and Info in one pass and its contract is that an
  // absent hook reads null (097's walk). The comment below has said so since 080; the marker is what
  // makes the exemption explicit rather than tacit.
  const types = [...document.querySelectorAll('[data-cy=event-log] li')].map((li) => li.dataset.type)
  return {
    events: types.length,
    turns: types.filter((t) => t === 'turn').length,
    // ⚠️ **Whether the two counters above mean anything at all** (093, brought here by 162). The
    // tabbed drawer mounts the log only on Events; on any other tab — or before a session exists —
    // both of them are a flat 0 no matter what the session is doing. Without this field a caller
    // cannot tell "no turn has ended" from "I am not looking at the place turns are counted", and
    // 161 spent two whole runs on the second one wearing the first one's message.
    eventLog: Boolean(document.querySelector('[data-cy=event-log]')),
    // The pill reads "Idle" / "Waiting on you" now; the machine word it is derived from lives on
    // the attribute, which is the thing worth asserting on anyway.
    status: document.querySelector('[data-cy=session-status]')?.dataset.status ?? null,
    // The conversation is ON SCREEN — always present once a session renders, wherever the drawer
    // is. The two below are Info-tab rows and read null unless the drawer is on Info (080).
    title: document.querySelector('[data-cy=conversation-title]')?.textContent?.trim() ?? null,
    ref: document.querySelector('[data-cy=session-ref]')?.textContent?.trim() ?? null,
    // Every card still waiting on a decision, WITH the decisions it offers. Filtering for a
    // literal "permission-allow" missed every Codex card — Codex offers its own vocabulary
    // (acceptOnce / acceptForSession / …) — so this script sat through a card it could see and
    // reported "the turn never finished".
    openCards: [...document.querySelectorAll('[data-cy=permission-card]')]
      .filter((c) => !c.querySelector('[data-cy=permission-answered]'))
      .map((c) => ({
        id: c.dataset.requestId,
        // By data-cy, not by class: the decisions are identified by what they DO, and a card that
        // gets restyled must not silently stop being answerable (it did, in 005).
        offered: [...c.querySelectorAll('button[data-cy^=permission-]:not([disabled])')]
          .map((b) => b.dataset.cy.replace('permission-', '')),
      })),
    home: document.querySelector('[data-cy=session-home]')?.textContent?.trim() ?? '',
    // ⛔ **What the app says this conversation is RUNNING** (179). The chip's tooltip is always on
    // screen with the session; the two rows beside it are Info-tab rows and read null off it, just
    // like ref and home above — which is why they are read here and never off a driveTurn snapshot.
    chip: document.querySelector('[data-cy=provider-chip]')?.title ?? null,
    agentModel: document.querySelector('[data-cy=session-agent-model]')?.textContent?.trim() ?? null,
    agentReasoning:
      document.querySelector('[data-cy=session-agent-reasoning]')?.textContent?.trim() ?? null,
    transcript: document.querySelector('[data-cy=transcript]')?.innerText ?? '',
    userMessages: [...document.querySelectorAll('[data-cy=user-message]')].map((e) => e.textContent.trim()),
    assistantMessages: [...document.querySelectorAll('[data-cy=assistant-message]')].length,
    lastAssistant: [...document.querySelectorAll('[data-cy=assistant-message]')].at(-1)?.innerText ?? '',
    // 587: a settled call is a member of a quiet RUN rather than a card, so a rehydrated
    // conversation whose tool calls all finished draws no 'tool-entry' at all. The count is of
    // CALLS: the cards that remain plus each run's own data-calls.
    toolEntries:
      [...document.querySelectorAll('[data-cy=tool-entry]')].length +
      [...document.querySelectorAll('[data-cy=tool-run]')].reduce(
        (sum, run) => sum + Number(run.dataset.calls ?? 0),
        0,
      ),
    // The composer swaps its button for a stop while a turn runs and disables the field when a
    // request is pending, so "can I type here" is the field, not just the button.
    //
    // ⛔ **223 SPLIT this, and it had to.** The composite also required the SEND BUTTON to be
    // enabled — and since 223 the button is dark whenever there is nothing to send, which is the
    // state a reopened conversation is in unless a draft was kept for it (since 744 · R100 a draft
    // survives a relaunch, kept-drafts.ts). So the old composite was unconditionally false
    // after a reopen, and step 5's "the reopened session cannot be typed into" would have thrown on
    // every run, about a session that had rehydrated perfectly. Found by an adversarial pass over
    // 223's diff; this file is not in that diff and no full smoke had been run.
    //
    // ⚠️ Two names, because they are two questions. "typable" is the field — which is what step 5
    // is about. "sendLit" is the button, and it now means there is something to send AND nothing
    // forbids sending it.
    // (No backticks in this block: it lives INSIDE a template literal.)
    typable: (() => {
      const input = document.querySelector('[data-cy=prompt-input]')
      return Boolean(input && !input.disabled)
    })(),
    sendLit: (() => {
      const send = document.querySelector('[data-cy=send-prompt]')
      return Boolean(send && !send.disabled)
    })(),
  }`

/**
 * Click a control once it is on the page. `CLICK` throws the instant an element is missing, which
 * for a rail control right after a relaunch reads as "the app does not have this" when the truth
 * is "not mounted yet". Waiting first makes a failure here mean what it says.
 */
async function clickWhenReady(cdp, cy) {
  await waitFor(
    `[data-cy=${cy}]`,
    async () => await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=${cy}]'))`),
    15_000,
  )
  await cdp.evaluate(CLICK(cy))
}

/**
 * Open the new-conversation surface and wait for the COMPOSER — which is what is left on it.
 *
 * 🔴 **Both sentences this paragraph used to carry are false** (420, from 417 / HO-022 §2). It
 * said *"its settings are always visible (013): provider, cwd and approvals on the page"*, and
 * then *"there IS a profile picker since 167"*. `417` deleted the whole settings block —
 * *"Opening a new conversation opens a conversation with BroBot. That is all."* — so the surface
 * is a greeting, the credential line, the sentence saying which provider it is fixed on, and a
 * composer. ⛔ **The gate below waited on the provider picker**, a hook that can never resolve: it
 * burned its ten seconds inside step `1`, threw *"timed out waiting for the new-conversation
 * settings"*, and `step()` re-throws — which is how steps `2` to `7` stopped running.
 *
 * ⚠️ **013's ruling outlived its own controls**: there is still exactly one door and this is it.
 * What a conversation cannot be given at it is {@link FRONT_DOOR_CANNOT_ASK}.
 */
async function openLauncher(cdp) {
  const shown = `return Boolean(document.querySelector('[data-cy=new-conversation-surface] [data-cy=prompt-input]'))`
  if (await cdp.evaluate(shown)) return
  await clickWhenReady(cdp, 'new-conversation')
  await waitFor('the new-conversation composer', async () => await cdp.evaluate(shown), 10_000)
}

/**
 * Put the drawer on a tab, opening it first if it is shut (080).
 *
 * ⚠️ **Both the openness and the tab are remembered per machine**, so a script that assumed either
 * would be reporting on a preference rather than on the session. One tab's body is on screen at a
 * time, so every read out of the drawer says which tab it wants.
 */
async function ensureTab(cdp, tab) {
  const on = `
    const strip = document.querySelector('[data-cy=drawer-tabs]')
    if (!strip) return 'shut'
    return document.querySelector('[data-cy=drawer-tab-${tab}]')?.dataset.active === 'true'
  `
  if ((await cdp.evaluate(on)) === 'shut') {
    await clickWhenReady(cdp, 'toggle-session-panel')
    await waitFor('the drawer', async () => (await cdp.evaluate(on)) !== 'shut', 10_000)
  }
  if ((await cdp.evaluate(on)) === true) return
  await clickWhenReady(cdp, `drawer-tab-${tab}`)
  await waitFor(`the ${tab} tab`, async () => (await cdp.evaluate(on)) === true, 10_000)
}

/**
 * Turn lifecycle notices on AND open the event stream. Everything this script asserts is counted
 * out of the event log — without the stream on screen the counts are all zero and a turn that
 * finished perfectly reads as "the turn never finished".
 *
 * ⚠️ Since 079 §3 these are two separate controls: the toggle puts lifecycle marks in the
 * transcript, and the stream is a tab in the drawer. Both are needed, so both are done.
 *
 * ⚠️ **The drawer half is skipped when there is no conversation yet, and that is load-bearing.**
 * This is called once before step 1 has started anything, where the lifecycle toggle exists (the
 * launcher renders the same header) but the drawer toggle does not — it is `v-if="session"`. An
 * unguarded `ensureTab` there spends fifteen seconds waiting for a button that cannot appear and
 * then fails every step behind it. Found in review.
 *
 * ⛔ **So this function does not leave Events open, and callers must not assume it did** (`162`).
 * `161` found the early return standing between the pre-session call and every count in the file:
 * correct in itself, and the reason step `1` had never once reached step `2`. `driveTurn` now opens
 * Events for itself, after the send that creates the session, and `assertCountersVisible` makes any
 * future caller that forgets fail in the first second by name instead of at the turn budget.
 */
async function ensureDebugOn(cdp) {
  const on = `return document.querySelector('[data-cy=toggle-debug-mode]')?.dataset.on === 'true'`
  if (!(await cdp.evaluate(on))) {
    await clickWhenReady(cdp, 'toggle-debug-mode')
    await waitFor('lifecycle notices', async () => await cdp.evaluate(on), 10_000)
  }
  const hasDrawer = await cdp.evaluate(
    `return Boolean(document.querySelector('[data-cy=toggle-session-panel]'))`,
  )
  if (!hasDrawer) return
  await ensureTab(cdp, 'events')
  await waitFor(
    'the raw stream',
    async () => await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=event-log]'))`),
    10_000,
  )
}

/** Back to the event stream, which is what every count in this script is read from. */
async function ensureEventsOpen(cdp) {
  await ensureTab(cdp, 'events')
  await waitFor(
    'the event stream',
    async () => await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=event-log]'))`),
    10_000,
  )
}

/** The paths — the drawer's Info tab since 080, the header's debug strip before it. */
async function ensureInfoOpen(cdp) {
  await ensureTab(cdp, 'info')
  await waitFor(
    'the paths',
    async () =>
      await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=session-home]'))`),
    5_000,
  )
}

/**
 * ⛔ **Refuse to wait on a counter that is not on screen** (093's guard, brought to this file by
 * `162`). `ui-live-smoke.mjs` has had it since `093`; this file never did, and `161` paid for the
 * difference: `smoke:resume` aborted at step `1` in both of its attempts with *"the turn never
 * finished"* — about a turn that had finished, had written its file, and had its approval card
 * answered. Six of its eight steps did not run, and had not run since `075`.
 */
function assertCountersVisible(now, what) {
  if (now.eventLog) return
  throw new Error(
    `cannot wait for ${what}: the drawer is not on Events, so every counter in the snapshot ` +
      `reads 0 whatever the session does — call ensureEventsOpen(cdp) before waiting on a turn`,
  )
}

/** The drawer's toggle is `v-if="session"`, so its presence is "a conversation exists yet". */
const HAS_DRAWER = `return Boolean(document.querySelector('[data-cy=toggle-session-panel]'))`

/**
 * Send a prompt and answer every approval it raises until the turn terminalizes — with whatever
 * decision the card actually offers, preferring the permissive one. The two providers do not
 * share a vocabulary, and a script that only knows one of them stalls on the other's cards.
 *
 * ⛔ **This opens Events itself, and the order is the whole repair** (`162` §1). The terminal
 * condition is `now.turns > before.turns`, counted off `[data-cy=event-log] li` — so both readings
 * have to come from the same tab or the comparison is between two different questions:
 *
 *   - **A conversation already exists** → open Events *before* the baseline. Reading `before` off
 *     the wrong tab and `now` off the right one would make the loop return on the FIRST poll, on
 *     turns that ended long ago, which is a false green rather than a hang.
 *   - **No conversation yet** (step `1`, the very first send) → the drawer toggle does not exist to
 *     click, and the baseline is `0` by construction because there is no session to have had a
 *     turn. Open Events once the send has created the session, then start counting.
 *
 * `161` §4 traced the abort to the second case: `ensureDebugOn` runs before step `1` and its drawer
 * half returns early — correctly — so the suite's first turn was always counted blind, and nothing
 * re-opened Events until *after* this function had already given up.
 */
async function driveTurn(cdp, prompt, { turnsBefore = 0 } = {}) {
  const fresh = !(await cdp.evaluate(HAS_DRAWER))
  if (!fresh) await ensureEventsOpen(cdp)
  // ⚑ **D-017b · a conversation the quit left behind opens in its FULL view** — drawer and all — so
  // it takes the road above, counted off its own Events; `turnsBefore` is only the no-drawer road's
  // baseline, and a caller hands the LEDGER's count ({@link ledgerTurnCount}) for it.
  const before = fresh ? { turns: turnsBefore } : await cdp.evaluate(SNAPSHOT)
  if (!fresh) assertCountersVisible(before, 'a turn to end')
  await cdp.evaluate(SET_VALUE('prompt-input', prompt))
  // ⛔ **A send that cannot work is a SILENT no-op** (094, and 163 paid for its absence HERE).
  // `PromptComposer.send()` opens `if (!canSend(text.value, props.state, props.blocked,
  // props.attachments.length)) return`, and under sustained load the launcher can lose what was
  // typed between the fill and the press — so the press lands on a composer holding nothing, with
  // nothing on screen to say so. `ui-live-smoke.mjs` has guarded this since 094; this file never
  // did, and under sustained load step `1` failed twice in a row on the very commit that then
  // passed it 10/10 on a quiet machine — reporting only *"timed out waiting for the conversation
  // the send created"*, which is a sentence about a send that may never have left.
  //
  // ⚑ **223 changed the mechanism and NOT the need for this guard.** The button is no longer
  // *"disabled only on `!canType`"* — it is dark whenever there is nothing to send — so a lost
  // message now leaves a DARK button rather than a lit and inert one. `ready.typed <= 0` still
  // fires first and still names the real cause; `ready.disabled` below is the second net.
  await waitFor(
    'the composer to offer its send button',
    async () =>
      await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=send-prompt]'))`),
    15_000,
  )
  const ready = await cdp.evaluate(`
    const box = document.querySelector('[data-cy=prompt-input]')
    const button = document.querySelector('[data-cy=send-prompt]')
    return { typed: box ? box.value.trim().length : -1, disabled: button ? button.disabled : null }`)
  if (ready.typed <= 0) {
    throw new Error(
      `the composer lost the message that was typed into it (${ready.typed} chars) — pressing ` +
        'send now would be a no-op, not a turn',
    )
  }
  if (ready.disabled) {
    // ⚠️ **223 · the box is checked ABOVE, so an empty one is not what this is reporting.** Since
    // 223 an empty box darkens the button too, and naming only the old cause would send a reader
    // hunting for the wrong thing.
    throw new Error(
      'the send button is disabled with a message in the box — something else forbids this turn',
    )
  }
  await cdp.evaluate(CLICK('send-prompt'))
  if (fresh) {
    // ⚠️ **And when it still does not appear, say what the screen holds** (162's rule, applied to
    // the one wait in this file that had no diagnostic). "Timed out" is compatible with a refused
    // launch, a stale credential and a send that no-opped, and they are three different problems.
    await waitFor(
      'the conversation the send created',
      async () => await cdp.evaluate(HAS_DRAWER),
    ).catch(async (error) => {
      const seen = await cdp.evaluate(`
        return {
          onLauncher: Boolean(document.querySelector('[data-cy=new-conversation-surface]')),
          conversations: document.querySelectorAll('[data-cy^=open-session-]').length,
          typed: document.querySelector('[data-cy=prompt-input]')?.value?.length ?? -1,
          error: document.querySelector('[data-cy=command-error]')?.textContent?.trim() ?? null,
          signIn: document.querySelector('[data-cy=sign-in-reason]')?.textContent?.trim() ?? null,
          // ⚑ D-017b · where a refused open or send is said in the window's own words.
          toast: document.querySelector('[data-cy=toast]')?.textContent?.trim() ?? null,
        }`)
      throw new Error(`${error.message} — the screen says ${JSON.stringify(seen)}`)
    })
    await ensureEventsOpen(cdp)
  }
  const deadline = Date.now() + TURN_BUDGET_MS
  const answered = []
  for (;;) {
    const now = await cdp.evaluate(SNAPSHOT)
    assertCountersVisible(now, 'the turn to end')
    if (now.turns > before.turns) return now
    for (const card of now.openCards) {
      const decision = await cdp.evaluate(`
        const card = document.querySelector('[data-cy=permission-card][data-request-id="${card.id}"]')
        const buttons = [...(card?.querySelectorAll('button[data-cy^=permission-]:not([disabled])') ?? [])]
        const name = (b) => b.dataset.cy.replace('permission-', '')
        const pick = buttons.find((b) => /^(allow|accept)/i.test(name(b))) ?? buttons[0]
        if (!pick) return null
        pick.click()
        return name(pick)`)
      if (decision) answered.push(decision)
    }
    if (Date.now() > deadline) {
      const end = await cdp.evaluate(SNAPSHOT)
      const cards = await cdp.evaluate(`
        return [...document.querySelectorAll('[data-cy=permission-card]')]
          .map((c) => c.innerText.replace(/\\s+/g, ' ').trim().slice(0, 140))`)
      throw new Error(
        `the turn never finished — status=${end.status}, ` +
          `${end.openCards.length} card(s) still open ${JSON.stringify(end.openCards)}, ` +
          `answered so far: ${answered.join(', ') || 'none'}` +
          (cards.length > 0 ? ` · cards on screen: ${JSON.stringify(cards)}` : ''),
      )
    }
    await sleep(400)
  }
}

/**
 * 🔴 **What the front door cannot be asked for, and what to do instead** (420 §4, from 417).
 *
 * ⛔ **`417` did not take a control away; it took a CAPABILITY away.** The front door sends
 * exactly `{ provider: <the app frame's default>, profileId: DEFAULT_PROFILE_ID, approvalMode: 'ask' }`,
 * and there is no other surface in the product that creates a session — `417 §2` measured it. A
 * step that needs Claude, a named profile, a folder of its own, a launch-time model, a reasoning
 * rung, plan mode or yolo is asking for a shape **no gesture a person can make can express**.
 * This list is what says so AT THE ASK, by name, instead of thirty seconds later at a hook that
 * has not existed since `417`.
 *
 * ⚑ **Every field here has exactly one honest answer** (420 §4): drive the live control in the
 * drawer after the launch, place the conversation through the interim door and say which field
 * forced it, or report the step `notPerformed(…)` and file the capability as a finding. ⛔ **Do
 * not answer it by re-adding a picker** — `417` and `420` §6 both say the gap is to be REPORTED.
 *
 * ## ⚠️ This is the sibling of `ui-live-smoke.mjs`'s list, and only half of that is comfortable
 *
 * The two {@link startSession}s genuinely cannot be shared: that one is a closure inside its own
 * `main()` over its `cdp`, its `snapshot()`, its `watchTurn()` and a `SNAPSHOT` of a different
 * shape (its baseline carries streaming blocks, composer state and activity phases; this file's
 * carries the provider chip, the session home and the agent rows), while every helper here is top
 * level and takes a connection. A shared one would have to be handed four of those, which is a
 * bigger change than the thing it removes.
 *
 * ⚑ **The LIST is shared and lives in `scripts/lib/front-door.mjs`.** It is pure data and a
 * predicate; two copies of one roster are two copies that will differ once — the day a tenth
 * field becomes impossible, one of them learns about it. ⚠️ **The SENTENCE below stays here**,
 * because this suite's honest remedy is not `ui-live-smoke.mjs`'s: that one has an interim door
 * and points at it, and this one deliberately does not.
 */

function refuseWhatTheFrontDoorCannotAsk(asked) {
  const named = whatTheFrontDoorCannotCarry(asked)
  if (named.length === 0) return
  throw new Error(
    `⛔ startSession is the FRONT DOOR and it cannot be asked for ${named.join(', ')} — ` +
      `417 removed those controls (HO-022 §2). Drive the live control in the drawer after the ` +
      `launch, or place the conversation through the interim door — ui-live-smoke.mjs's ` +
      `placeSession, which is deliberately NOT ported here: this suite opens exactly one session ` +
      `and opens it through the door a person has. There is no third option that is honest.`,
  )
}

/**
 * Start THE session through the front door: open the surface, type the first message, send.
 * **That is the whole of it now** (420, from 417 / HO-022 §2).
 *
 * ⚑ **013's "one door" is still true and is still the point** — *"the second way was the one that
 * ignored the provider you picked"*. What changed is that the door has nothing on it to fill in.
 * Every conversation this opens is `{ provider: <the app frame's default>, profileId: DEFAULT_PROFILE_ID,
 * approvalMode: 'ask' }`, running wherever the host resolves — {@link WORKSPACE} for this run,
 * which step `1` asserts rather than assumes.
 *
 * ⛔ **It takes a prompt and nothing else**, with {@link refuseWhatTheFrontDoorCannotAsk} in front
 * of it, and that guard is the entire reason a two-line gesture gets a helper: a future step that
 * asks for a placement fails at the ask, with the honest alternatives in the message, rather than
 * timing out against a deleted hook and reporting it as a product regression.
 *
 * ⚠️ **The composer guards and the turn watch are `driveTurn`'s** rather than a second copy of
 * them. It already refuses a send that would be a silent no-op (094, and 163 paid for its absence
 * here), waits for the conversation the send creates and says what the screen held if it never
 * arrives, opens Events before it starts counting (162 §1), and answers whatever cards the turn
 * raises in either provider's vocabulary. A first `driveTurn` on the launcher IS the front door.
 */
async function startSession(cdp, { prompt, ...asked }) {
  refuseWhatTheFrontDoorCannotAsk(asked)
  await openLauncher(cdp)
  return await driveTurn(cdp, prompt)
}

async function main() {
  // Both roots are this run's own — see `beginSmokeRun`. Nothing is wiped, because there is
  // nothing of anyone else's here to wipe.
  console.log(`run ${RUN_ID} · evidence ${EVIDENCE} · scratch ${SCRATCH}`)

  /**
   * ⛔ **Inside the session's own working directory, which is where it always was** (420 §3).
   *
   * This was `join(SCRATCH, …)` because SCRATCH was the folder the launcher was GIVEN. The front
   * door gives none, so the cwd is {@link WORKSPACE} and the marker moves with it. ⚠️ **Not a
   * cosmetic move**: Codex's sandbox is scoped to the working directory, so a marker left in
   * SCRATCH would make step `1`'s first tool call an ESCALATION that has to be approved — which
   * is a different thing to measure than *"the agent used its shell tool and a file appeared"*,
   * and it would make the step's outcome depend on a card being offered and answered.
   *
   * ⚑ **SCRATCH still exists and still rotates with the run**, and nothing places a session in it
   * any more. The day a surface can place one (417 §11.2) it is where that placement goes.
   */
  const marker = join(WORKSPACE, 'resume-marker.txt')
  let first
  let second
  let firstRef = null
  let firstHome = null
  /**
   * ⚑ **738 · the conversation step `1` started, by its app id** — what steps `4` and `5` find it by
   * in the rail. ⛔ Not by being the run's only one: `738`'s final batch found BroBot had delegated in
   * step `1` and the first life left TWO conversations behind.
   */
  let firstSessionId = null
  /** What the header said the model was BEFORE the quit — step `6`'s comparison, after the provider has spoken again (179, R34b). */
  let startedModel = null
  /** The highest ordinal the renderer saw before the quit — the seam has to go past it. */
  let preQuitLast = -1

  try {
    // --- before the quit -------------------------------------------------------
    first = await launchApp({ reuseUserData: false })
    let cdp = await Cdp.attach(first.port)
    await ensureDebugOn(cdp)
    // ⚠️ **"the front door's own default" rather than "provider codex"** (420): this script does
    // not pick one any more, and step 1 is where the claim is checked against the app's answer.
    record(
      true,
      `0 first app is up — pid ${first.pid}, front door default ${FRONT_DOOR_PROVIDER}`,
      USER_DATA,
    )

    await step(
      '0b the launch created the durable workspace without generated instruction files',
      async () => {
        // The app creates the workspace without generated instruction files.
        // The front-door conversation runs here; retain a harness file across relaunch.
        const claude = join(WORKSPACE, 'CLAUDE.md')
        const codex = join(WORKSPACE, 'AGENTS.md')
        if (!existsSync(WORKSPACE)) throw new Error(`no workspace at ${WORKSPACE}`)
        for (const file of [claude, codex]) {
          if (existsSync(file)) throw new Error(`unexpected generated instruction file ${file}`)
        }
        // The next launch must preserve the harness's own file.
        writeFileSync(join(WORKSPACE, 'session-file.txt'), "not the app's to touch\n")
        return (
          `${WORKSPACE} — no generated instruction files, and it is where the ` +
          `conversation will run`
        )
      },
    )

    await step('1 start a session and do real work in it', async () => {
      // ⛔ **The one door (013) — and since 417 there is nothing on it to fill in** (420, HO-022
      // §2). This read *"the settings are visible"* and then wrote four of them: the provider, the
      // folder, a check against the offered model list, the model. ⚠️ **All four controls are
      // gone**, and none of those four lines is what a run actually hit: `openLauncher`'s gate
      // above them waited ten seconds for the provider picker and threw *"timed out waiting for
      // the new-conversation settings"* — a loud failure naming the APP rather than the ask — and
      // `step()` re-throws, which is how steps 2 to 7 stopped running. What is left is the gesture
      // a person makes: open the surface, type the first message, send. {@link startSession} is
      // that, with the refusal in front of it.
      //
      // ⚑ **What this step no longer chooses, and where each one went:** the provider is the app
      // frame's default and is CHECKED below against the session's own home; the folder is the
      // host's resolution and is CHECKED below against {@link WORKSPACE}; the approval mode is
      // `ask` by construction and, since `738` (R34b), no surface reads it back (step `4` says so); the model is nobody's and
      // step `5b` says so.
      //
      // The confirmation is REQUESTED as a fence (017): after the quit, step 5 asserts the
      // rehydrated reply renders it as a real code block — replay-path markdown, on a message a
      // provider actually wrote. Described rather than dictated: asked to echo literal backtick
      // lines, a model may helpfully strip them; asked to produce a fenced block, it produces one.
      const after = await startSession(cdp, {
        prompt:
          `Use your shell tool to write the single word BANANA into the file ${marker}, ` +
          'then confirm by replying with a markdown fenced code block (opened and closed with ' +
          'three-backtick lines) whose only content is the word WROTE-BANANA. No other text.',
      })
      await cdp.screenshot('1-before-quit')
      if (!existsSync(marker)) throw new Error(`${marker} was not written`)
      if (readFileSync(marker, 'utf8').trim() !== 'BANANA')
        throw new Error('marker has wrong content')
      // ⛔ **The ref is an INFO row, so it is read on the Info tab** (162 §1, found by running).
      //
      // This was `firstRef = after.ref`, off the snapshot `driveTurn` returns — which is taken on
      // Events, where `[data-cy=session-ref]` is not mounted. So `firstRef` was `null` every time,
      // and step `5`'s *"resumed a DIFFERENT thread"* check compared `null` against the real ref and
      // could only fail. Latent since 080 gave the drawer tabs, and unreachable until step `1`
      // started passing today: the file's own `SNAPSHOT` has carried the warning — *"the two below
      // are Info-tab rows and read null unless the drawer is on Info"* — the whole time.
      //
      // Both facts come from ONE snapshot on the right tab, so they cannot drift apart again.
      await ensureInfoOpen(cdp)
      const info = await cdp.evaluate(SNAPSHOT)
      firstRef = info.ref
      firstHome = info.home
      firstSessionId = await cdp.evaluate(`
        const row = [...document.querySelectorAll('[data-cy^=open-session-]')]
          .find((el) => el.dataset.active === 'true')
        return row ? row.dataset.sessionId : null`)
      if (!firstSessionId) throw new Error('no active conversation on the rail to name step 1 by')
      // ⛔ **The paired positive for step `5`** (179, 175's rule): a conversation that has answered
      // names the model it answered with. Without this line, "the reopened one says `…`" would not
      // be a finding — it would be the app's normal state.
      //
      // ⛔ **Re-anchored by 420, and what it lost is named rather than absorbed.** This compared
      // the row against the model the LAUNCHER was given; `417` deleted that field, so there is no
      // left-hand side to compare with. ⚑ **What survives is the half 179 was really about**:
      // `describeModel` answers `…` when nothing was asked for AND the provider has reported
      // nothing, so an ellipsis HERE — on a conversation that has just finished a turn — is the
      // app refusing to say a fact it is holding. ⚠️ **What is gone is WHICH model**, and that is
      // step `5b`'s row rather than a silence.
      startedModel = info.agentModel
      if (!startedModel || startedModel === MODEL_UNREPORTED) {
        throw new Error(
          `a session that has just answered does not name its model: ` +
            `${JSON.stringify(startedModel)} · chip ${JSON.stringify(info.chip)}`,
        )
      }
      if (!firstRef) throw new Error('the session never announced a ref on the Info tab')
      // ⛔ **The home answers BOTH questions the front door decides on a person's behalf** (420).
      // It is `<userData>/provider-homes/default/<profile>/<provider>`
      // (`provider-homes.ts:95`), so one string says which profile ran and which provider ran it.
      // ⚠️ `includes('/default/')` was ambiguous — the home's first segment is `default` too, so
      // the check passed on that segment alone — and it could not see the provider at all, which
      // is the fact this file used to take from an env var and must now read off the app.
      if (!firstHome.includes(`/${PROFILE}/${FRONT_DOOR_PROVIDER}`)) {
        throw new Error(
          `the front door did not start ${FRONT_DOOR_PROVIDER} in profile ${PROFILE}: ` +
            `${firstHome || '(no home shown)'} — either RuntimeScreen's DEFAULT_PROVIDER has moved ` +
            `(this script names it at FRONT_DOOR_PROVIDER) or this conversation was placed ` +
            `somewhere the rest of this suite does not expect`,
        )
      }
      // ⛔ **…and WHERE it ran, because four later steps depend on the answer** (420 §3). The
      // front door sends no cwd, so this is the HOST's resolution rather than our instruction:
      // BroBot's workspace. The marker, step `3b` and the home all assume this path (since `738`
      // steps `4` and `5` find the row in the rail by step `1`'s own id), so a launch that landed
      // anywhere else has to fail here — with the path in hand.
      const cwd = await cdp.evaluate(
        `return document.querySelector('[data-cy=session-cwd]')?.textContent?.trim() ?? null`,
      )
      if (cwd !== WORKSPACE) {
        throw new Error(
          `a front-door conversation ran in ${JSON.stringify(cwd)} rather than in BroBot's ` +
            `workspace (${WORKSPACE}) — and the marker, step 3b and the home all assume this path`,
        )
      }
      // ⚠️ **Back to Events before reading ORDINALS.** `ensureInfoOpen` above switched tabs, and
      // the event log is unmounted on any tab but its own — so read here and this baseline is `-1`,
      // which makes the post-relaunch seam check (`last > preQuitLast`) true for ANY ordinal
      // including zero. The check would still pass, having stopped checking anything. Found in
      // review, and it is the sharpest example of what a tabbed drawer costs a script that used to
      // be able to read everything at once.
      await ensureEventsOpen(cdp)
      preQuitLast = await cdp.evaluate(ORDINALS).then((o) => o.at(-1) ?? -1)
      if (preQuitLast < 0)
        throw new Error('no ordinals on screen — the seam check would be vacuous')

      // Record the conversation's paper scheme before quitting and verify it after a new app
      // process starts. There is no theme preference to set or restore. Read the theme and
      // background from conversation-pane: pane-main has no theme attribute and uses a transparent
      // background.
      const preQuitTheme = await cdp.evaluate(
        `return document.querySelector('[data-cy=conversation-pane]')?.dataset.chatTheme ?? null`,
      )
      if (preQuitTheme !== 'light') {
        throw new Error(`the conversation is not on paper before the quit: ${preQuitTheme}`)
      }
      // ⚑ **The retired key is PLANTED here, and step 5 is where it has to be gone** (344 §3.2).
      //
      // ⛔ **Asserting it is absent on a fresh profile would prove nothing** — it was never there.
      // A machine that used the reading light holds `"true"` under this name, and the claim worth
      // making is about THAT machine: `RuntimeScreen` forgets the key on its first render, so a
      // genuinely new app process comes up clean. This profile is made into that machine, and only
      // a real relaunch can answer for it — which is exactly what this file is.
      await cdp.evaluate(
        `window.localStorage.setItem('brobot2.chatLightTheme', 'true'); return null`,
      )
      const planted = await cdp.evaluate(
        `return window.localStorage.getItem('brobot2.chatLightTheme')`,
      )
      if (planted !== 'true') throw new Error(`the retired key would not plant: ${planted}`)

      // ⛔ **Claims, not one sentence** (206 H1). This step makes four genuinely different
      // assertions and returned them as a single string, which `record` then counted as one — and
      // in this file the claims never reached `summarize` at all. They are data now, so the
      // headline can say how many of a run's claims were reached rather than how many steps
      // returned without throwing.
      return claims(
        asserted(
          `ref=${firstRef}, ${after.turns} turn(s) counted on Events, last ordinal ` +
            `${preQuitLast}, already on paper before the quit, retired key planted for step 5`,
        ),
        asserted(`the marker was written by a real tool call at ${marker}`),
        asserted(
          `the front door ran ${FRONT_DOOR_PROVIDER} as ${PROFILE} in ${cwd} — BroBot's own ` +
            `workspace, which is the host's resolution and not this script's instruction`,
        ),
        asserted(`a conversation that has answered names its model: ${startedModel}`),
      )
    })

    // --- the quit --------------------------------------------------------------
    await step('2 quit the app entirely', async () => {
      cdp.close()
      const quitAt = Date.now()
      first.stop()
      // ⛔ **Gone means the PORT is free, not that HTTP stopped answering** (162, found by running).
      //
      // This polled `/json/version` and read any throw as *"nothing is listening any more"*. Both
      // halves of that were wrong on the first run ever to reach this step. A SIGTERMed Electron in
      // dev goes on **holding its debug port while answering nothing** — measured today at four and
      // a half minutes — so the old predicate had two ways to be useless and took the worse one
      // each time: with a bare `fetch` it hung the whole suite on a request that never returned,
      // and with a deadline on that fetch it would have called the abort a clean exit and moved on
      // to relaunch on a port the previous app still owned.
      //
      // ⚑ Binding the port is the question the step is actually asking, it cannot hang, and it
      // cannot be answered by silence. `stop()` above now chases the reparented Electron until this
      // is true, so the wait is a check rather than a hope.
      await waitFor(
        `the app on port ${first.port} to be gone`,
        async () => await portIsFree(first.port),
        60_000,
      )
      return `pid ${first.pid} reaped, port ${first.port} free after ${Math.round((Date.now() - quitAt) / 100) / 10}s`
    })

    // --- after the relaunch ----------------------------------------------------
    second = await launchApp({ reuseUserData: true, rendererPort: first.rendererPort })
    cdp = await Cdp.attach(second.port)
    await ensureDebugOn(cdp)
    record(
      true,
      `3 relaunched on the same user-data-dir — pid ${second.pid}`,
      `port ${second.port}`,
    )

    await step("3b the relaunch leaves the session's own files alone", async () => {
      // A relaunch must leave no generated instruction files and retain the harness's own file.
      for (const name of ['CLAUDE.md', 'AGENTS.md']) {
        if (existsSync(join(WORKSPACE, name))) throw new Error(`${name} was generated on relaunch`)
      }
      const theirs = join(WORKSPACE, 'session-file.txt')
      if (!existsSync(theirs)) throw new Error('the relaunch deleted a file the app does not own')
      return "no generated instruction files; the session's own file untouched"
    })

    await step('4 the session is offered back', async () => {
      // 🔴 **D-017b · ONE Conversations list in the rail** — a conversation the quit left behind is a
      // row of it like any other (`open-session-<id>`), with the one press every row has. ⛔ No
      // kept-open row, no *Closed conversations* group, and nothing on the row about whether a
      // process runs (`05` rule 5). (738 · R34b read a `kept-open-session-<id>` row here.)
      const rows = await waitFor(
        'the rail to list the conversation the quit left behind',
        async () =>
          await cdp.evaluate(`
            const rows = [...document.querySelectorAll('[data-cy^=open-session-]')]
            return rows.length > 0 ? rows.map((r) => ({
              id: r.dataset.sessionId,
              text: r.innerText.replace(/\\s+/g, ' ').trim(),
            })) : null
          `),
        30_000,
      )
      await cdp.screenshot('4-listed-in-the-rail')
      // ⚑ **738 · the discriminator is step `1`'s own app id.** The rail row prints the folder's
      // BASENAME, which every conversation in the workspace shares — and the first life may leave more
      // than one (BroBot and the project manager it delegated to) — so the row is found by the id
      // step `1` read.
      const mine = rows.find((row) => row.id === firstSessionId)
      if (!mine) {
        throw new Error(
          `step 1's conversation ${firstSessionId} is not in the rail: ${JSON.stringify(rows)}`,
        )
      }
      return claims(
        asserted(
          `listed in the rail after the quit (${rows.length} row(s)): "${mine.text.slice(0, 90)}"`,
        ),
        // ⚠️ The recorded approval mode (171) was read off the reopen list's row; the rail row does
        // not print it.
        unasserted('the recorded approval mode — the rail row does not print it'),
      )
    })

    await step('5 reopen it and find the prior transcript there', async () => {
      // ⚑ **D-017b · the row's press OPENS it** (`look`): nothing is launched until its first
      // message, which starts and sends in one act (`startAndSend`) — step `6`.
      const id = await cdp.evaluate(`
        const row = [...document.querySelectorAll('[data-cy^=open-session-]')]
          .find((el) => el.dataset.sessionId === ${JSON.stringify(firstSessionId)})
        row.click()
        return row.dataset.sessionId`)

      // 🔴 **D-017b · …and it opens in the ONE full view** — header, controls and the right panel,
      // whether or not anything runs it, with the transcript read from its ledger. ⛔ No sentence says
      // whether a process runs (`05` rule 5). So this waits on the rail naming THIS conversation as
      // the one on screen, and on the view's header and panel toggle being drawn.
      const after = await waitFor(
        'this conversation in its full view',
        async () => {
          const onScreen = await cdp.evaluate(
            `return document.querySelector('[data-cy^=open-session-][data-active=true]')?.dataset.sessionId ?? null`,
          )
          if (onScreen !== id) return null
          const full = await cdp.evaluate(`
            return Boolean(document.querySelector('[data-cy=conversation-pane]')) &&
              Boolean(document.querySelector('[data-cy=session-header]')) &&
              Boolean(document.querySelector('[data-cy=toggle-session-panel]'))`)
          return full ? await cdp.evaluate(SNAPSHOT) : null
        },
        60_000,
      ).catch(async (error) => {
        const said = await cdp.evaluate(
          `return document.querySelector('[data-cy=toast]')?.textContent?.trim() ?? null`,
        )
        throw new Error(`${error.message}${said ? ` — the window says "${said}"` : ''}`)
      })
      await cdp.screenshot('5-full-view')

      // The point of the whole exercise: the conversation that happened before the quit is
      // on screen again — BOTH halves of it, and the work it did.
      if (!after.userMessages.some((m) => m.includes('BANANA'))) {
        throw new Error(`our own turn is missing: ${JSON.stringify(after.userMessages)}`)
      }
      if (after.assistantMessages === 0) throw new Error('the agent’s prior replies are missing')
      if (after.toolEntries === 0) throw new Error('the prior tool call is missing')
      /**
       * ⚠️ **A gap-notice assertion was written HERE and REMOVED, measured rather than reasoned**
       * (242 §3).
       *
       * 🔴 239 reported *"event stream gap: expected ordinal 108, got 111"* printed into the
       * ordinary conversation on **every Codex Resume**, and the defect is real — it is fixed in
       * `session-store.ts` and pinned by `session-store.test.ts` and 242 M12/M13. ⛔ **But an
       * assertion here could not have caught it, and an A/B proved that rather than argued it**:
       * with the fix reverted, this step still PASSED, 10/10.
       *
       * ⚑ **The ledger says why.** In that run the second life opened `40 session:resumed ·
       * 41 status:idle · 42-45 unknown` — six events inside the hand-over window, 320 ms before the
       * user's own turn at 46 — so the events were there. What is not there is a RECORD for them to
       * be mis-routed into: this smoke **quits and relaunches**, so the reopen happens in a brand-new
       * renderer where `sessions.get(id)` is undefined and the events take the `earlyEvents` road
       * that has always worked. The defect needs a record that already has `meta` — a conversation
       * closed and reopened INSIDE one window.
       *
       * ⛔ **So this is a blind spot, not a check**, and it is written down as one rather than left
       * as a negative assertion that can never fail. See `smoke-run.mjs`'s audit table, row 11.
       */
      // A transcript that replays the old ending must not leave the session looking dead.
      // ⚑ **`typable`, not `sendLit`** (223): a reopened conversation with no kept draft has an
      // empty box, so its Send button is legitimately dark (a kept one would light it — 744 · R100).
      // What must be true is that the FIELD takes input — which is the sentence this error has always
      // carried.
      if (!after.typable) throw new Error('the reopened session cannot be typed into')

      // 017: the reply the provider wrote before the quit was a fenced code block, and the
      // REHYDRATED message renders it as one — markdown on the replay path, not just live.
      // Found by the CODE BLOCK, not by the first message mentioning the marker: a provider may
      // narrate before it acts ("I'll write the file and confirm with WROTE-BANANA"), and that
      // preamble is its own message — picking it would report a rendering failure for a rendering
      // that worked.
      const md = await cdp.evaluate(`
        const messages = [...document.querySelectorAll('[data-cy=assistant-message]')]
        const body = messages.find((el) =>
          [...el.querySelectorAll('pre code')].some((code) => /WROTE-BANANA/.test(code.textContent)))
        if (!body) return { saw: messages.map((el) => el.textContent.trim().slice(0, 120)) }
        return { literalTicks: /\\x60/.test(body.textContent) }`)
      if (md.saw) {
        throw new Error(
          `no rehydrated reply renders WROTE-BANANA as a code block: ${JSON.stringify(md.saw)}`,
        )
      }
      if (md.literalTicks) throw new Error('literal backticks leaked into the rehydrated reply')

      // Verify the restarted conversation's paper scheme independently of the dark rail. Read the
      // attribute and background from conversation-pane, not its transparent child. Use
      // paperVerdict's computed-color checks rather than a fixed RGB literal, so palette changes do
      // not break the resume assertion.
      const theme = await cdp.evaluate(`
        const pane = document.querySelector('[data-cy=conversation-pane]')
        const rail = document.querySelector('[data-cy=side-rail]')
        if (!pane) return { chat: null }
        if (!rail) return { chat: pane.dataset.chatTheme ?? null, noRail: true }
        return {
          chat: pane.dataset.chatTheme ?? null,
          ${paperFields('pane')}
          ${inkFields('rail')}
          sceneInk: getComputedStyle(pane).getPropertyValue('--text').trim(),
        }`)
      if (theme.chat !== 'light') {
        throw new Error(`the relaunched conversation is not on paper: ${JSON.stringify(theme)}`)
      }
      const paper = paperVerdict(theme, 'the reopened conversation')
      // ⛔ **The chrome control, DERIVED** (402 §2). This read `!== '#e7ecf3'` until `391` moved
      // `--text` to `#e3e8f4`, and then fired *"the rail was re-themed with the conversation"* at a
      // rail that had not moved — the same palette dispatch, the same class, one row later than the
      // ground. `chromeInkVerdict` compares the rail against `:root` and against the pane it sits
      // beside, so nothing here is a colour anyone typed.
      if (theme.noRail) throw new Error('there is no side rail on screen to check')
      const chrome = chromeInkVerdict(theme, 'the rail beside the reopened conversation')

      // ⚑ **And the key step 1 planted is gone, after a genuinely new app process** (344 §3.2).
      // This is the half a reload cannot prove: the renderer that forgot it is not the renderer
      // that had it. `null` here is the same answer a machine that never pressed the toggle gives,
      // which is the point — after this build the two are the same machine.
      const retired = await cdp.evaluate(
        `return window.localStorage.getItem('brobot2.chatLightTheme')`,
      )
      if (retired !== null) {
        throw new Error(`the retired reading-light key survived the relaunch: ${retired}`)
      }

      return claims(
        asserted(
          `session ${id} opened in its full view (header and panel) with ` +
            `${after.userMessages.length} of ours + ${after.assistantMessages} replies (fence rendered ` +
            `as a code block) + ${after.toolEntries} tool call(s) · on ${paper} with nothing stored, ` +
            `the retired key forgotten by the new process, ${chrome}`,
        ),
        // ⚠️ 179's pairing BEFORE it is spoken to again is not read here — step `6` reads the model
        // once the provider has answered again.
        unasserted(
          '179 · the model named before it is spoken to again — not read off the view before its first message',
        ),
      )
    })

    /**
     * 🔴 **The half of 179 that no gesture can produce any more** (420 §4, from 417 / HO-022 §2).
     *
     * ⛔ **It is not a blank and it is not a skip.** A blank asked and the provider declined; a
     * skip was not selected for this run. This asked nobody, because the control it needed is
     * gone — and it will say so on every run until a surface can request a model at launch. `420`
     * §4: *"An instrument may lose a step. It may not lose a step silently."*
     *
     * ⚠️ **Why it is a row of its own rather than a sentence inside step `5`.** Until today it
     * WAS a sentence inside step 5 — one of two accepted spellings — and a sentence inside a
     * passing step is exactly how a suite gets smaller while staying green. The headline counts
     * this cell apart and names the line, which is the only form of the fact anybody can act on.
     */
    await step(
      '5b a reopened conversation names the model the app REQUESTED, before the provider speaks',
      async () =>
        notPerformed(
          '417 deleted the launcher’s model field (HO-022 §2), so no gesture a person can make ' +
            'requests a model at launch — and describeModel’s "<id> (requested)" branch, which ' +
            'is 179’s own subject and the only half of it Claude can exhibit, cannot be reached ' +
            'from this instrument at all. ⚠️ Since 738 the Codex half is not asserted ' +
            'either: step 5 reads no model before the conversation is spoken to, and step 6 checks ' +
            'the SAME model only after the provider has answered. A surface that can ' +
            'place a conversation (417 §11.2) brings this back as it stands.',
        ),
    )

    await step('6 it carries on — a second turn continues the same thread', async () => {
      // ⚑ **D-017b · step `5` leaves the conversation in its FULL view**, drawer and all, and this
      // first message is what starts it (`startAndSend`). So `driveTurn` counts off its Events; the
      // LEDGER's count is handed for the no-drawer road all the same, never a count remembered from
      // before the quit ({@link ledgerTurnCount} says why).
      const before = await cdp.evaluate(SNAPSHOT)
      const turnsBefore = ledgerTurnCount(firstSessionId)
      const after = await driveTurn(
        cdp,
        'Without using any tools, tell me the single word you wrote into that file earlier.',
        { turnsBefore },
      )
      await cdp.screenshot('6-continued')

      if (after.turns <= turnsBefore) throw new Error('the second turn never completed')
      // ⛔ **The ref is an INFO row, read where it lives** (162 — the third instance of one root
      // cause). `after` is `driveTurn`'s snapshot, taken on Events so the counters mean something;
      // `session-ref` is not mounted there, so this was `null` and the identity check read *"the
      // thread changed: <ref> → null"* about a thread that had not changed at all. Step `1` had the
      // same bug and step `5` already did it correctly — the difference is that `5` is the only one
      // of the three that had ever executed.
      await ensureInfoOpen(cdp)
      const live = await cdp.evaluate(SNAPSHOT)
      const ref = live.ref
      // …and back, because step 7 reads ORDINALS off the event log.
      await ensureEventsOpen(cdp)
      if (ref !== firstRef) throw new Error(`the thread changed: ${firstRef} → ${ref}`)
      // ⚑ **738 · moved here from step `5`**: the home and the model are read once this first message
      // has started the conversation and the provider has answered. Reopened into the
      // home it RAN in, from the recorded profile — not the default (085).
      if (live.home !== firstHome) {
        throw new Error(`resumed into a different home: ${firstHome} → ${live.home}`)
      }
      // ⚠️ 179's pairing, read AFTER the provider has spoken — the only moment a surface names it
      // since `701` — so it proves the same thread and model came back, not 179's pre-start line.
      if (live.agentModel !== startedModel) {
        throw new Error(
          `the reopened conversation runs a different model than before the quit: ` +
            `${JSON.stringify(live.agentModel)} now, ${JSON.stringify(startedModel)} then`,
        )
      }
      // The NEW reply, not the whole transcript: the replayed history already contains the
      // word, so testing the transcript would pass even against a provider with no memory.
      if (after.lastAssistant === before.lastAssistant) throw new Error('no new reply arrived')
      if (!/BANANA/i.test(after.lastAssistant)) {
        throw new Error(
          `the resumed session does not recall the earlier turn: ${after.lastAssistant.slice(0, 120)}`,
        )
      }
      return `thread ${ref} continued, recalled it in "${after.lastAssistant.slice(0, 60).replace(/\s+/g, ' ')}"`
    })

    await step('7 the continuation was recorded too — one ledger across the quit', async () => {
      const ids = await cdp.evaluate(ORDINALS)
      // The panel shows the whole session after a resume — the replayed ledger and the live
      // events after it — so this reads the seam directly.
      if (ids.length === 0) throw new Error('the event log is empty')
      const dense = ids.every((id, index) => id === index)
      if (!dense) {
        const holes = ids.filter((id, index) => id !== index).slice(0, 5)
        throw new Error(`ordinals are not one dense sequence: first mismatches ${holes.join(', ')}`)
      }
      // …and it kept counting rather than starting again, which is what a collision or a
      // rewound seam would look like.
      const last = ids.at(-1)
      if (!(last > preQuitLast)) {
        throw new Error(`the seam rewound: ended at ${preQuitLast} before the quit, ${last} now`)
      }
      // 🔴 **…and what the HOST said about the same question**, which nothing has ever read
      // (345 §3, from 342). `runtime-host.ts`'s `emit` compares every ordinal against the highest
      // it has sent and reports a regression on `console.error`. ⛔ **That line went to `/dev/null`
      // in every live suite**, so this step's dense-ordinal negative was the only evidence there
      // was — and the two detectors are not the same one: this reads the LEDGER, which `recordOurs`
      // makes monotonic by construction, while the tripwire watches the WIRE, where 320's defect
      // actually lived. ⚠️ **The count is part of the claim**: a sweep that read no bytes cannot be
      // reported as a sweep that found nothing.
      const said = existsSync(APP_LOG) ? readFileSync(APP_LOG, 'utf8') : ''
      const outOfOrder = said.split('\n').filter((line) => /went out after/.test(line))
      if (outOfOrder.length > 0) {
        throw new Error(
          `the host reported ${outOfOrder.length} out-of-order publish(es): ${outOfOrder[0].trim()}`,
        )
      }
      return (
        `ordinals 0…${last}, dense across the quit (was ${preQuitLast} before it) · ` +
        `${said.length} B of host log swept, 0 out-of-order publishes`
      )
    })

    cdp.close()
  } finally {
    second?.stop()
    first?.stop()
  }

  const summary = report()
  process.exit(summary.failed === 0 ? 0 : 1)
}

/**
 * ⛔ **The headline, and the lines under it that a count cannot replace** (420 §4, 206 H1).
 *
 * ⚑ **One function, called from both endings.** The two tails were a copy of each other and had
 * already drifted — only one of them read `failed` — which is how a cell added to `summarize`
 * reaches the happy path and not the one a failing run takes.
 *
 * ⛔ **No `notReached` number, and that is a decision rather than an omission.** `summarize` takes
 * one and `ui-live-smoke.mjs` supplies it from `lib/step-census.mjs` — the list of steps that file
 * OFFERS, kept equal to what it registers by `pnpm run ci`. ⚠️ **This file has no census**, and a
 * run that aborts never calls `step()` again, so the steps it never reached leave no trace in
 * `results` at all. Counting `await step(` in the source would be a number computed from the PLAN
 * rather than from the outcome, which is the standing rule this whole cell lives under. The
 * absence is not silent either: `step()` re-throws, so an abort ENDS the run, the error prints
 * above this line, and the missing tokens are the ones with no row at all.
 */
function report() {
  const summary = summarize(results, { evidence: EVIDENCE })
  console.log(`\n${summary.line}`)
  for (const line of summary.blanks) console.log(`  ${line}`)
  // ⛔ **Named, not merely counted** (420 §4). A step the product can no longer offer a gesture
  // for is a capability nobody is watching, and the line saying WHICH one is the actionable half.
  for (const line of summary.unperformed) console.log(`  ${line}`)
  // ⛔ **…and which CLAIMS went unreached** (206 H1), which this file could not print at all until
  // today: `record` dropped them, so every claim counter it has ever reported was zero.
  if (summary.blankClaims.length > 0) {
    console.log(
      `  ${summary.claimsTotal - summary.claimsAsserted} of ${summary.claimsTotal} claim(s) not reached:`,
    )
    for (const claim of summary.blankClaims) console.log(`    ${claim}`)
  }
  return summary
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`)
  report()
  process.exit(1)
})
