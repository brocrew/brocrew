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
import { ACTIVE_TRANSCRIPT_HISTORY } from './lib/transcript-evidence.mjs'
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
import { constantFrom, profileHome } from './lib/app-source.mjs'
import { whatTheFrontDoorCannotCarry } from './lib/front-door.mjs'
import { assertPortNotShared, assertPortOwnedByTree } from './lib/smoke-target.mjs'
import { witnessGate } from './lib/host-gate-witness.mjs'
import { beginSmokeRun, smokeTmpRoot, smokeUserDataDir, waitFor } from './lib/smoke-run.mjs'
import {
  asserted,
  claims,
  notPerformed,
  outcomeVerdict,
  summarize,
  unasserted,
} from './lib/smoke-verdicts.mjs'
import { WIDE_READ_MARK, assertTabFlow } from './lib/tab-flow.mjs'
import { chromeInkVerdict, inkFields, paperFields, paperVerdict } from './lib/paper-ground.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
/**
 * The provider the front door starts a conversation on; this script does not choose it.
 *
 * The front door sends exactly `{ provider: <what a launch as BroBot resolves to>, profileId:
 * 'default', approvalMode: 'ask' }`. That resolution is `providerForALaunch`: BroBot's own identity
 * row first, then `RuntimeScreen.vue`'s `DEFAULT_PROVIDER` as a fallback. A person can write that
 * row on the identity's own sheet. Nothing can move a session's provider once it is open, so this
 * is the provider for this run.
 *
 * Derived from the app's source (`lib/app-source.mjs` reads the `.vue` spelling), then checked in
 * step 1 against the session's provider HOME, which ends `.../<profile>/<provider>`: a constant
 * read correctly from a file the renderer stopped using would be right about the source and wrong
 * about the app.
 */
const FRONT_DOOR_PROVIDER = constantFrom('DEFAULT_PROVIDER')

/**
 * `BROBOT_SMOKE_PROVIDER` cannot be honoured, and must not be quietly ignored.
 *
 * Dropping it would run the whole demo on Codex under a banner reading `provider claude`, a green
 * run reporting evidence it never gathered. Obeying it is impossible: there is no surface for it,
 * and the gap is reported rather than worked around with a picker behind a flag.
 *
 * Consequence: the resume path (start, quit, relaunch, reopen, continue) is not exercised on Claude
 * by any instrument in this repo. Claude's resume is covered only by unit suites, which cannot see
 * a real process restart.
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
 * The workspace instruction marker: proves the rendered files came from the canonical source.
 * Derived from `workspace.ts`, whose docblock calls it "a token no model would produce unprompted";
 * a hand-copied token like that can quietly stop matching.
 */
/**
 * One directory per run, and a lock so there is only ever one run (same treatment as
 * `ui-live-smoke.mjs`, from the same shared module). Fixed roots wiped at start would let a second
 * run destroy the first one's evidence and live tree.
 *
 * `USER_DATA` stays inside the run: both app instances share it and nothing else does, which is
 * what makes the relaunch a relaunch.
 */
const {
  evidence: EVIDENCE,
  scratch: SCRATCH,
  runId: RUN_ID,
} = beginSmokeRun({
  // Short enough that the gate socket fits `sun_path`. See `smoke-run.mjs`.
  evidenceRoot: smokeTmpRoot('brobot2-resume-smoke'),
  scratchRoot: join(homedir(), 'brobot2-scratch', 'resume-smoke'),
  // Cheaper and smaller than the UI smoke's tree, so more of them fit.
  keep: 10,
})
/** Shared across BOTH app instances — this is what makes the second one a relaunch. */
const USER_DATA = smokeUserDataDir(EVIDENCE, 'user-data')
// BroBot's own home: a launch without a folder runs here. Read its path from the app so the
// harness follows the same path.
const WORKSPACE = profileHome(USER_DATA, constantFrom('DEFAULT_PROFILE_ID'))

/**
 * How many `turn` events the LEDGER holds for one conversation: the count the replay of a stopped
 * conversation puts back on Events, so step 6's baseline. Not a count remembered from before the
 * quit: a turn can begin after that count is taken (BroBot's delegated child answers and the quit
 * interrupts the delivery), so the replay holds one more turn and step 6's wait would return at
 * once on the old reply.
 *
 * Read through a private copy, never in place (`ui-live-smoke.mjs`' `queryDatabase`): a read-only
 * open of a live WAL database is refused, or creates the `-shm` itself.
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
 * Where this run's app writes its stdout and stderr. One file for both launches, appended: this
 * suite stops `first` before it starts `second`, so they never write concurrently, and step 7's
 * question spans the seam (an ordinal published out of order before the quit matters as much as
 * one after it). `ui-live-smoke.mjs` needs one file per launch because it runs two apps at once.
 */
const APP_LOG = join(EVIDENCE, 'app.log')
/**
 * The profile every session from this page runs in. The new-conversation page starts BroBot, whose
 * profile is `default`, and the UI offers no choice. What this smoke still proves is the part a
 * person can reach: the session RECORDS its home, and a resume lands back in that recorded home
 * rather than in whatever the default would be that day. Named-profile resume is covered by the
 * unit suite (session-profile.test.ts).
 */
// Read from the app, never restated: the front door runs as BroBot, whose slug is `brobot`, and a
// literal `'default'` here made step 1's home check throw on every run.
const PROFILE = constantFrom('DEFAULT_PROFILE_ID')
const TURN_BUDGET_MS = 180_000
/**
 * There is no model constant here: the front door sends no model, so nothing is recorded on the
 * row or replayed into the resume, and `describeModel`'s "our request, marked `(requested)`" branch
 * cannot be produced by any gesture a person can make. This is a lost capability, not a tidy-up.
 *
 *  - No launcher pre-flight of the model list. The drawer's live model control cannot stand in:
 *    its change is queued for the NEXT message, so it cannot check a launch that already happened,
 *    and setting it would silently change what step 6 runs on.
 *  - The two model assertions stay, re-anchored. Step 1 asks whether a conversation that has
 *    answered NAMES a model; step 6 asks whether a genuinely new app process names the SAME one
 *    once it has answered again (step 5 reads none before). Which model it is, step 5b reports.
 */

/**
 * What the model row says when nobody chose and nobody reported: `describeModel`'s third answer
 * (`runtime-host.ts`).
 *
 * Written down rather than derived, because it is a literal inside a function rather than an
 * `export const`, so `lib/app-source.mjs` has nothing to read. It is used in one direction only
 * (a row that reads it is a FAILURE), so drift makes the assertion weaker rather than wrong. The
 * remedy is to export the ellipsis from the host beside that module's other three constants.
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
 * `fetch` with a deadline, because `waitFor`'s own deadline is unreachable without one: it awaits
 * its predicate and only THEN looks at the clock, so a request that never returns ends the run.
 * Measured: the app SIGTERMed at the quit went on holding its debug port for about four and a half
 * minutes while answering nothing, and `curl` against it hung the same way.
 *
 * Every caller treats a throw as "not answering yet", so an abort reads correctly at all of them
 * except step 2, which asks whether the app is GONE and must not read silence as an answer.
 */
function probe(url, timeoutMs = 4_000) {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * One app instance on its own ports, sharing the user-data directory. `reuseUserData`
 * is the whole point of the second launch: same database, same provider homes.
 */
async function launchApp({ reuseUserData, rendererPort: reusePort }) {
  if (!reuseUserData) rmSync(USER_DATA, { recursive: true, force: true })
  const [port, hmrPort] = [await freePort(), await freePort()]
  // The RELAUNCH reuses the renderer port so the second app loads from the same origin as the first.
  // In dev the renderer is served over http and `localStorage` is keyed by origin, so a fresh random
  // port made every per-machine preference look forgotten. Production loads from `file://` with one
  // origin for the life of the install; this matches that.
  // Reusing the port races the previous Vite server letting go of the socket, and the dev server is
  // strict about its port, so it would fail to bind and this script would wait for CDP until the 180s
  // timeout, reporting "the app never came up" for a port still in TIME_WAIT. Wait for it to be free,
  // and say so plainly if it never is.
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
  // The app's own output goes to a FILE. `runtime-host.ts`'s out-of-order tripwire reports on a bare
  // `console.error` in the MAIN process; with `stdio: 'ignore'` the one live suite that falsifies
  // event ordering (step 7's dense-ordinal check across the quit seam) would be deaf to the app's
  // own alarm.
  //
  // A file rather than a pipe, for `app-closes-check.mjs`'s reason: Node makes stdout/stderr
  // synchronous when they are files, so the last line before a quit is never queued and lost, and
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
      // This run's window is nobody's: never shown, titled `BroBot2 — test`.
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
  // The gate ran and ANSWERED. Unconditional on every launch, because a shipped feature that did
  // nothing is the one thing this instrument could not otherwise see; see `host-gate-witness.mjs`.
  // On the RELAUNCH the socket may be the first app's artefact that the second app broke and
  // re-claimed; what is asserted either way is that a live gate holds this `userData`.
  // It also reaps what it launched if it fails: `launchApp` hands the caller the only handle that can
  // stop this app, so throwing before the return would leave a live Electron on the machine.
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
 * How long one CDP request may go unanswered before it becomes a failing step. Same value and
 * reasoning as `ui-live-smoke.mjs`: a socket can stay ESTABLISHED at both ends while one reply goes
 * missing, which the `close`/`error` guard cannot see. This file needs it more, because its
 * `step()` re-throws: a wedge costs every step behind it, not just one.
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
  const history = ${ACTIVE_TRANSCRIPT_HISTORY}
  if (!history) throw new Error('No normal transcript is selected for the ordinal read.')
  if (history.hasOlder) throw new Error('The persisted history is partial; dense ordering cannot be concluded.')
  return history.entries.map((entry) => entry.ordinal)`

const CLICK = (cy) => `
  const el = document.querySelector('[data-cy=${cy}]')
  if (!el) throw new Error('no [data-cy=${cy}]')
  el.click()
  return true`

/** UI assertions read the normal DOM; event counts use its bounded persisted history page. */
const SNAPSHOT = `
  // ${WIDE_READ_MARK} — this reaches across Events and Info in one pass and its contract is that an
  // absent hook reads null (097's walk). The comment below has said so since 080; the marker is what
  // makes the exemption explicit rather than tacit.
  const history = ${ACTIVE_TRANSCRIPT_HISTORY}
  const types = history?.entries.map((entry) => entry.event.type) ?? []
  return {
    events: types.length,
    turns: types.filter((t) => t === 'turn').length,
    // ⚠️ **Whether the two counters above mean anything at all** (093, brought here by 162). The
    // tabbed drawer mounts the log only on Events; on any other tab — or before a session exists —
    // both of them are a flat 0 no matter what the session is doing. Without this field a caller
    // cannot tell "no turn has ended" from "I am not looking at the place turns are counted", and
    // 161 spent two whole runs on the second one wearing the first one's message.
    historyRead: history !== null,
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
 * Put the drawer on a tab, opening it first if it is shut.
 *
 * Both the openness and the tab are remembered per machine, so a script that assumed either would
 * report on a preference rather than on the session. Only one tab's body is on screen at a time,
 * so every read out of the drawer says which tab it wants.
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
 * Events for itself, after the send that creates the session, and `assertHistoryAvailable` makes any
 * future caller that forgets fail in the first second by name instead of at the turn budget.
 */
async function ensureTranscriptReady(cdp) {
  await waitFor(
    'the normal conversation surface',
    async () =>
      await cdp.evaluate(`
    return Boolean(document.querySelector('[data-cy=prompt-input]')) &&
      typeof window.api?.runtime?.latestHistory === 'function'`),
    10_000,
  )
}

async function ensureHistoryAvailable(cdp) {
  await waitFor(
    'the normal transcript history',
    async () =>
      await cdp.evaluate(`
    return (${ACTIVE_TRANSCRIPT_HISTORY}) !== null`),
    10_000,
  )
}

/** The paths: the drawer's Info tab. */
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
 * Refuse to wait on a counter that is not on screen. Without it, a turn that had finished (written
 * its file, had its approval card answered) read as "the turn never finished" and aborted the run
 * at step 1.
 */
function assertHistoryAvailable(now, what) {
  if (now.historyRead) return
  throw new Error(
    `cannot wait for ${what}: no selected normal transcript history was read. ` +
      `Call ensureHistoryAvailable(cdp) before using turn counters.`,
  )
}

/** The drawer's toggle is `v-if="session"`, so its presence is "a conversation exists yet". */
const HAS_DRAWER = `return Boolean(document.querySelector('[data-cy=toggle-session-panel]'))`

/**
 * Send a prompt and answer every approval it raises until the turn terminalizes, with whatever
 * decision the card actually offers, preferring the permissive one. The two providers do not share
 * a vocabulary, and a script that only knows one of them stalls on the other's cards.
 *
 * This opens Events itself, and the order matters. The terminal condition is
 * `now.turns > before.turns`, counted off `[data-cy=event-log] li`, so both readings must come from
 * the same tab:
 *
 *   - A conversation already exists: open Events BEFORE the baseline. Reading `before` off the
 *     wrong tab and `now` off the right one would return on the first poll, on turns that ended
 *     long ago, a false green.
 *   - No conversation yet (step 1, the very first send): the drawer toggle does not exist and the
 *     baseline is `0` by construction. Open Events once the send has created the session, then
 *     start counting.
 */
async function driveTurn(cdp, prompt, { turnsBefore = 0 } = {}) {
  const fresh = !(await cdp.evaluate(HAS_DRAWER))
  if (!fresh) await ensureHistoryAvailable(cdp)
  // A conversation the quit left behind opens in its FULL view, drawer and all, so it takes the road
  // above, counted off its own Events; `turnsBefore` is only the no-drawer road's baseline, and a
  // caller hands the LEDGER's count ({@link ledgerTurnCount}) for it.
  const before = fresh ? { turns: turnsBefore } : await cdp.evaluate(SNAPSHOT)
  if (!fresh) assertHistoryAvailable(before, 'a turn to end')
  await cdp.evaluate(SET_VALUE('prompt-input', prompt))
  // A send that cannot work is a SILENT no-op. `PromptComposer.send()` opens
  // `if (!canSend(text.value, props.state, props.blocked, props.attachments.length)) return`, and
  // under sustained load the launcher can lose what was typed between the fill and the press, so the
  // press lands on a composer holding nothing and nothing on screen says so. Without this guard the
  // failure reads only "timed out waiting for the conversation the send created".
  //
  // The send button is dark whenever there is nothing to send, so a lost message leaves a DARK
  // button. `ready.typed <= 0` fires first and names the real cause; `ready.disabled` below is the
  // second net.
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
    // The box is checked ABOVE, so an empty one is not what this reports: an empty box darkens the
    // button too, and naming only that cause would send a reader hunting for the wrong thing.
    throw new Error(
      'the send button is disabled with a message in the box — something else forbids this turn',
    )
  }
  await cdp.evaluate(CLICK('send-prompt'))
  if (fresh) {
    // When it still does not appear, say what the screen holds: "timed out" fits a refused launch, a
    // stale credential and a send that no-opped, which are three different problems.
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
    await ensureHistoryAvailable(cdp)
  }
  const deadline = Date.now() + TURN_BUDGET_MS
  const answered = []
  for (;;) {
    const now = await cdp.evaluate(SNAPSHOT)
    assertHistoryAvailable(now, 'the turn to end')
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
 * What the front door cannot be asked for, and what to do instead.
 *
 * The front door sends exactly `{ provider: <the app frame's default>, profileId:
 * DEFAULT_PROFILE_ID, approvalMode: 'ask' }`, and no other surface creates a session. A step that
 * needs Claude, a named profile, a folder of its own, a launch-time model, a reasoning rung, plan
 * mode or yolo asks for a shape no gesture a person can make can express. This list says so at the
 * ask, by name, instead of later at a hook that no longer exists.
 *
 * Each field has one honest answer: drive the live control in the drawer after the launch, place
 * the conversation through the interim door and say which field forced it, or report the step
 * `notPerformed(...)` and file the capability as a finding. Do not re-add a picker.
 *
 * This is the sibling of `ui-live-smoke.mjs`'s list. The two {@link startSession}s cannot be
 * shared: that one is a closure inside its own `main()` over its `cdp`, `snapshot()`, `watchTurn()`
 * and a `SNAPSHOT` of a different shape, while every helper here is top level and takes a
 * connection. The LIST is shared and lives in `scripts/lib/front-door.mjs` (pure data and a
 * predicate, so two copies cannot drift). The SENTENCE below stays here, because this suite's
 * remedy differs: that one has an interim door and points at it, this one deliberately does not.
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
 * Start the session through the front door: open the surface, type the first message, send.
 * Every conversation this opens is `{ provider: <the app frame's default>, profileId:
 * DEFAULT_PROFILE_ID, approvalMode: 'ask' }`, running wherever the host resolves, which is
 * {@link WORKSPACE} for this run (step 1 asserts it).
 *
 * It takes a prompt and nothing else, with {@link refuseWhatTheFrontDoorCannotAsk} in front: a step
 * that asks for a placement fails at the ask, with the honest alternatives in the message, rather
 * than timing out against a missing hook.
 *
 * The composer guards and the turn watch are `driveTurn`'s: it refuses a silent no-op send, waits
 * for the conversation the send creates, opens Events before counting, and answers the cards of
 * either provider. A first `driveTurn` on the launcher IS the front door.
 */
async function startSession(cdp, { prompt, ...asked }) {
  refuseWhatTheFrontDoorCannotAsk(asked)
  await openLauncher(cdp)
  return await driveTurn(cdp, prompt)
}

async function main() {
  // Both roots are this run's own (see `beginSmokeRun`), so nothing is wiped.
  console.log(`run ${RUN_ID} · evidence ${EVIDENCE} · scratch ${SCRATCH}`)

  /**
   * Inside the session's own working directory. The front door gives no folder, so the cwd is
   * {@link WORKSPACE} and the marker lives there. This matters: Codex's sandbox is scoped to the
   * working directory, so a marker in SCRATCH would make step 1's first tool call an escalation that
   * must be approved, and the outcome would depend on a card being offered and answered.
   *
   * SCRATCH still exists and rotates with the run, but nothing places a session in it.
   */
  const marker = join(WORKSPACE, 'resume-marker.txt')
  let first
  let second
  let firstRef = null
  let firstHome = null
  /**
   * The conversation step 1 started, by its app id: what steps 4 and 5 find it by in the rail. Not
   * "the run's only conversation": BroBot may delegate in step 1, leaving TWO behind.
   */
  let firstSessionId = null
  /** What the header said the model was BEFORE the quit: step 6's comparison, after the provider has spoken again. */
  let startedModel = null
  /** The highest ordinal the renderer saw before the quit — the seam has to go past it. */
  let preQuitLast = -1

  try {
    // --- before the quit -------------------------------------------------------
    first = await launchApp({ reuseUserData: false })
    let cdp = await Cdp.attach(first.port)
    await ensureTranscriptReady(cdp)
    // "the front door's own default" rather than "provider codex": this script does not pick one, and
    // step 1 checks the claim against the app's answer.
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
      // The front door has nothing to fill in: open the surface, type the first message, send.
      // {@link startSession} does that, with the refusal in front of it.
      //
      // What this step does not choose: the provider is the app frame's default and is CHECKED below
      // against the session's own home; the folder is the host's resolution and is CHECKED below against
      // {@link WORKSPACE}; the approval mode is `ask` by construction and no surface reads it back (step
      // 4 says so); the model is nobody's and step 5b says so.
      //
      // The confirmation is REQUESTED as a fence: after the quit, step 5 asserts the rehydrated reply
      // renders it as a real code block (replay-path markdown, on a message a provider actually wrote).
      // Described rather than dictated: asked to echo literal backtick lines, a model may helpfully strip
      // them; asked to produce a fenced block, it produces one.
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
      // The ref is an INFO row, so it is read on the Info tab. `driveTurn`'s snapshot is taken on Events,
      // where `[data-cy=session-ref]` is not mounted, so reading it there gives `null` and step 5's
      // "resumed a DIFFERENT thread" check could only fail. Both facts come from ONE snapshot on the
      // right tab so they cannot drift apart.
      await ensureInfoOpen(cdp)
      const info = await cdp.evaluate(SNAPSHOT)
      firstRef = info.ref
      firstHome = info.home
      firstSessionId = await cdp.evaluate(`
        const row = [...document.querySelectorAll('[data-cy^=open-session-]')]
          .find((el) => el.dataset.active === 'true')
        return row ? row.dataset.sessionId : null`)
      if (!firstSessionId) throw new Error('no active conversation on the rail to name step 1 by')
      // The paired positive for step 5: a conversation that has answered names the model it answered
      // with. Without this, "the reopened one says `...`" would be the app's normal state, not a finding.
      //
      // The front door gives no model, so there is nothing to compare the row against. What survives:
      // `describeModel` answers `...` when nothing was asked for AND the provider has reported nothing,
      // so an ellipsis HERE, on a conversation that has just finished a turn, is the app refusing to say
      // a fact it holds. WHICH model it is, step 5b reports.
      startedModel = info.agentModel
      if (!startedModel || startedModel === MODEL_UNREPORTED) {
        throw new Error(
          `a session that has just answered does not name its model: ` +
            `${JSON.stringify(startedModel)} · chip ${JSON.stringify(info.chip)}`,
        )
      }
      if (!firstRef) throw new Error('the session never announced a ref on the Info tab')
      // The home answers BOTH questions the front door decides on a person's behalf. It is
      // `<userData>/provider-homes/default/<profile>/<provider>` (`provider-homes.ts:95`), so one string
      // says which profile ran and which provider ran it. `includes('/default/')` would be ambiguous (the
      // home's first segment is `default` too) and cannot see the provider at all.
      if (!firstHome.includes(`/${PROFILE}/${FRONT_DOOR_PROVIDER}`)) {
        throw new Error(
          `the front door did not start ${FRONT_DOOR_PROVIDER} in profile ${PROFILE}: ` +
            `${firstHome || '(no home shown)'} — either RuntimeScreen's DEFAULT_PROVIDER has moved ` +
            `(this script names it at FRONT_DOOR_PROVIDER) or this conversation was placed ` +
            `somewhere the rest of this suite does not expect`,
        )
      }
      // ...and WHERE it ran, because later steps depend on the answer. The front door sends no cwd, so
      // this is the HOST's resolution: BroBot's workspace. The marker, step 3b and the home all assume
      // this path (steps 4 and 5 find the row in the rail by step 1's own id), so a launch that landed
      // anywhere else must fail here, with the path in hand.
      const cwd = await cdp.evaluate(
        `return document.querySelector('[data-cy=session-cwd]')?.textContent?.trim() ?? null`,
      )
      if (cwd !== WORKSPACE) {
        throw new Error(
          `a front-door conversation ran in ${JSON.stringify(cwd)} rather than in BroBot's ` +
            `workspace (${WORKSPACE}) — and the marker, step 3b and the home all assume this path`,
        )
      }
      // Back to Events before reading ORDINALS. `ensureInfoOpen` switched tabs, and the event log is
      // unmounted on any tab but its own; read here, the baseline would be `-1`, which makes the
      // post-relaunch seam check (`last > preQuitLast`) true for ANY ordinal, so it would pass while
      // checking nothing.
      await ensureHistoryAvailable(cdp)
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
      // The retired key is PLANTED here, and step 5 is where it has to be gone. Asserting it absent on a
      // fresh profile would prove nothing, since it was never there. A machine that used the reading
      // light holds `"true"` under this name; `RuntimeScreen` forgets the key on its first render, so a
      // genuinely new app process comes up clean. This profile is made into that machine, and only a real
      // relaunch can answer for it.
      await cdp.evaluate(
        `window.localStorage.setItem('brobot2.chatLightTheme', 'true'); return null`,
      )
      const planted = await cdp.evaluate(
        `return window.localStorage.getItem('brobot2.chatLightTheme')`,
      )
      if (planted !== 'true') throw new Error(`the retired key would not plant: ${planted}`)

      // Claims, not one sentence: this step makes four different assertions, and returning them as a
      // single string would count as one. As data, the headline can say how many of a run's claims were
      // reached rather than how many steps returned without throwing.
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
      // Gone means the PORT is free, not that HTTP stopped answering. A SIGTERMed Electron in dev goes on
      // holding its debug port while answering nothing (measured at four and a half minutes). Polling
      // `/json/version` and reading any throw as "nothing is listening" would either hang on a request
      // that never returns, or, with a deadline, call the abort a clean exit and relaunch on a port the
      // previous app still owns.
      //
      // Binding the port is the question the step is asking; it cannot hang and cannot be answered by
      // silence. `stop()` above chases the reparented Electron until this is true.
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
    await ensureTranscriptReady(cdp)
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
      // One Conversations list in the rail: a conversation the quit left behind is a row of it like any
      // other (`open-session-<id>`), with the one press every row has. No kept-open row, no "Closed
      // conversations" group, and nothing on the row about whether a process runs.
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
      // The discriminator is step 1's own app id. The rail row prints the folder's BASENAME, which every
      // conversation in the workspace shares, and the first life may leave more than one (BroBot and the
      // project manager it delegated to), so the row is found by the id step 1 read.
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
        // The recorded approval mode was read off the reopen list's row; the rail row does not print it.
        unasserted('the recorded approval mode — the rail row does not print it'),
      )
    })

    await step('5 reopen it and find the prior transcript there', async () => {
      // The row's press OPENS it (`look`): nothing is launched until its first message, which starts and
      // sends in one act (`startAndSend`), in step 6.
      const id = await cdp.evaluate(`
        const row = [...document.querySelectorAll('[data-cy^=open-session-]')]
          .find((el) => el.dataset.sessionId === ${JSON.stringify(firstSessionId)})
        row.click()
        return row.dataset.sessionId`)

      // ...and it opens in the ONE full view (header, controls and the right panel, whether or not
      // anything runs it), with the transcript read from its ledger. No sentence says whether a process
      // runs. So this waits on the rail naming THIS conversation as the one on screen, and on the view's
      // header and panel toggle being drawn.
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
       * No gap-notice assertion is made here, deliberately. The defect (an "event stream gap: expected
       * ordinal 108, got 111" notice printed into the conversation on every Codex Resume) is fixed in
       * `session-store.ts` and pinned by `session-store.test.ts`, but an assertion here could not catch
       * it: with the fix reverted, this step still passed 10/10.
       *
       * The events were there (a second life opened `session:resumed`, `status:idle` and unknown events
       * inside the hand-over window), but this smoke quits and relaunches, so the reopen happens in a
       * brand-new renderer where `sessions.get(id)` is undefined and the events take the `earlyEvents`
       * road. The defect needs a record that already has `meta`: a conversation closed and reopened
       * INSIDE one window. So this is a blind spot, recorded as one; see `smoke-run.mjs`'s audit table.
       */
      // A transcript that replays the old ending must not leave the session looking dead.
      // `typable`, not `sendLit`: a reopened conversation with no kept draft has an empty box, so its
      // Send button is legitimately dark (a kept draft would light it). What must be true is that the
      // FIELD takes input.
      if (!after.typable) throw new Error('the reopened session cannot be typed into')

      // The reply the provider wrote before the quit was a fenced code block, and the REHYDRATED message
      // renders it as one: markdown on the replay path, not just live.
      // Found by the CODE BLOCK, not by the first message mentioning the marker: a provider may narrate
      // before it acts ("I'll write the file and confirm with WROTE-BANANA"), and that preamble is its
      // own message; picking it would report a rendering failure for a rendering that worked.
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
      // The chrome control, DERIVED: `chromeInkVerdict` compares the rail against `:root` and against the
      // pane it sits beside, so no colour here is typed by hand and a palette change cannot make the
      // check fire at a rail that did not move.
      if (theme.noRail) throw new Error('there is no side rail on screen to check')
      const chrome = chromeInkVerdict(theme, 'the rail beside the reopened conversation')

      // And the key step 1 planted is gone, after a genuinely new app process. This is the half a reload
      // cannot prove: the renderer that forgot it is not the renderer that had it. `null` is the same
      // answer a machine that never pressed the toggle gives, which is the point.
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
        // The model pairing BEFORE the provider is spoken to again is not read here; step 6 reads the model
        // once the provider has answered again.
        unasserted(
          '179 · the model named before it is spoken to again — not read off the view before its first message',
        ),
      )
    })

    /**
     * The model-at-launch check, which no gesture can produce any more. It is not a blank (a blank
     * asked and the provider declined) and not a skip (not selected for this run): it asked nobody,
     * because the control it needed is gone, and it says so on every run until a surface can request a
     * model at launch. An instrument may lose a step; it may not lose one silently.
     *
     * It is a row of its own rather than a sentence inside step 5, because a sentence inside a passing
     * step is how a suite gets smaller while staying green. The headline counts this cell apart and
     * names the line.
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
      // Step 5 leaves the conversation in its FULL view, drawer and all, and this first message is what
      // starts it (`startAndSend`). So `driveTurn` counts off its Events; the LEDGER's count is handed
      // for the no-drawer road all the same, never a count remembered from before the quit
      // ({@link ledgerTurnCount} says why).
      const before = await cdp.evaluate(SNAPSHOT)
      const turnsBefore = ledgerTurnCount(firstSessionId)
      const after = await driveTurn(
        cdp,
        'Without using any tools, tell me the single word you wrote into that file earlier.',
        { turnsBefore },
      )
      await cdp.screenshot('6-continued')

      if (after.turns <= turnsBefore) throw new Error('the second turn never completed')
      // The ref is an INFO row, read where it lives. `after` is `driveTurn`'s snapshot, taken on Events,
      // where `session-ref` is not mounted; reading it there gives `null` and the identity check would
      // report "the thread changed: <ref> -> null" about a thread that had not changed.
      await ensureInfoOpen(cdp)
      const live = await cdp.evaluate(SNAPSHOT)
      const ref = live.ref
      // …and back, because step 7 reads ORDINALS off the event log.
      await ensureHistoryAvailable(cdp)
      if (ref !== firstRef) throw new Error(`the thread changed: ${firstRef} → ${ref}`)
      // The home and the model are read once this first message has started the conversation and the
      // provider has answered. Reopened into the home it RAN in, from the recorded profile, not the
      // default.
      if (live.home !== firstHome) {
        throw new Error(`resumed into a different home: ${firstHome} → ${live.home}`)
      }
      // The model pairing, read AFTER the provider has spoken (the only moment a surface names it), so it
      // proves the same thread and model came back, not the pre-start line.
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
      // ...and what the HOST said about the same question. `runtime-host.ts`'s `emit` compares every
      // ordinal against the highest it has sent and reports a regression on `console.error`, which went
      // to `/dev/null` in live suites until the app log was captured. The two detectors differ: this
      // step reads the LEDGER, which `recordOurs` makes monotonic by construction, while the tripwire
      // watches the WIRE. The count is part of the claim: a sweep that read no bytes cannot be reported
      // as a sweep that found nothing.
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
 * The headline, and the lines under it that a count cannot replace. One function, called from both
 * endings, so a cell added to `summarize` reaches both the happy path and the failing one.
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
