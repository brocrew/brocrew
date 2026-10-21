#!/usr/bin/env node
/**
 * Drive the packaged macOS app with real provider sessions.
 *
 *   pnpm run package && pnpm run smoke:packaged
 *
 * Check the pinned bundled Codex version, its live executable through the OS, and actionable
 * failure when that binary is missing. Verify that no Claude Code is bundled and the Claude
 * session runs the installed program the app found. Claude steps can spend model quota; with
 * no installed program, report them as not performed using the app's own explanation.
 *
 * Own the test data folder and ephemeral debug port; reap only the process started here.
 * Start ordinary conversations through {@link startSession}; use {@link placeSession} only for
 * the provider-specific case the launcher cannot select. Report counts through both doors.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { whatIsNotPlaceable, whatTheFrontDoorCannotCarry } from './lib/front-door.mjs'
import { witnessGate } from './lib/host-gate-witness.mjs'
import { beginSmokeRun, smokeTmpRoot, smokeUserDataDir } from './lib/smoke-run.mjs'
// `notPerformed` is for a computer with no Claude Code installed: the Claude steps then have no
// program to run, so `2c` reads the app's own sentence for it, and `4b`, `4c` and `4d` answer NOT
// PERFORMED with it. `4d` answers the same when the Claude Code found is older than the model it
// asks for. `4b`'s other half, a person reaching Claude from the surface, is an `unasserted(…)`
// claim.
import {
  asserted,
  claims,
  notPerformed,
  outcomeVerdict,
  summarize,
  unasserted,
} from './lib/smoke-verdicts.mjs'
import { assertPortOwnedByTree } from './lib/smoke-target.mjs'
import { WIDE_READ_MARK, assertTabFlow } from './lib/tab-flow.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const APP = join(REPO_ROOT, 'apps/desktop/dist/mac-arm64/BroCrew.app')
const APP_BINARY = join(APP, 'Contents/MacOS/BroCrew')
const RESOURCES = join(APP, 'Contents/Resources')
/** Exactly the path `resolveCodexBinary` builds from `process.resourcesPath` when packaged. */
const PACKAGED_CODEX = join(RESOURCES, 'codex-vendor/aarch64-apple-darwin/bin/codex')
/**
 * The oldest Claude Code that runs `claude-opus-5-5[1m]`, step `4d`'s model, as the provider's own
 * refusal names it: *"version 2.1.280 or newer is required"*.
 */
const OPUS_5_5_NEEDS = '2.1.280'
/**
 * The places Anthropic's installer and Homebrew put Claude Code, looked at by this script itself,
 * so an app that says none is installed while one of these is there is caught saying it.
 */
const WELL_KNOWN_CLAUDE = [
  join(homedir(), '.local/bin/claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
]
/**
 * ⛔ **One directory per run, and a lock — the same repair `188` made for the other two** (196 H4).
 *
 * `182` M7 said a fixed, wiped smoke root destroys provenance and lets two runs corrupt one another;
 * `188` closed it for `smoke:ui` and `smoke:resume` and `193` found it still open here — with the
 * sharpest version of it, because this script also RENAMES the packaged Codex binary out of the way
 * in step 5. Two concurrent runs meant the second wiped the first's live user-data and scratch,
 * overwrote its `smoke.log`, and could observe a product with its binary temporarily missing. Either
 * run could then report a fabricated product failure, and the surviving evidence had no owner.
 */
/**
 * ⛔ **`scratch` is no longer BOUND, and the scratch ROOT stays** (`420`, from `417`).
 *
 * Three steps wrote this run's scratch directory into the launcher's `cwd-input`. `417` deleted
 * that field, and the folder turned out to be carrying nothing: **no step in this file ever
 * asserted a path, listed the directory, or read a byte out of it** — the only mention of `SCRATCH`
 * outside those three writes was its own declaration. So the cwd was not load-bearing and the
 * writes are simply gone rather than replaced.
 *
 * ⚠️ **The per-run directory is still created, still locked and still pruned.** `beginSmokeRun`
 * requires the root, and `196` H4's isolation is a property of the TREE rather than of who reads
 * it: the next step here that needs a folder takes it from this run's own scratch rather than
 * inventing a second one.
 */
const { runId: RUN_ID, evidence: EVIDENCE } = beginSmokeRun({
  // ⛔ 242 §1 — short enough that `236` §3's gate socket fits `sun_path`. See `smoke-run.mjs`.
  evidenceRoot: smokeTmpRoot('brobot2-packaged-smoke'),
  scratchRoot: join(homedir(), 'brobot2-scratch', 'packaged-smoke'),
})
const USER_DATA = smokeUserDataDir(EVIDENCE, 'user-data')
const TURN_BUDGET_MS = 180_000

const results = []
/**
 * `true` → PASS · `false` → FAIL · **or the verdict itself**, which is how the other three arrive.
 *
 * ⛔ **The third verdict is 196 H1** and ⛔ **the fifth is `420` §4** (`NOT PERFORMED` — a step
 * whose gesture the product no longer offers, or whose bounded wait ran out). The arithmetic lives
 * in `scripts/lib/smoke-verdicts.mjs`, where it is testable: `pnpm run ci` cannot run a packaged
 * smoke. ⚑ **A verdict STRING passes through** since `420` — there are five of them, and the old
 * `'blank'`-or-boolean encoding was already one cell past what it could say. The two booleans stay
 * for the callers outside `step()`: step 2's own `record`, and the `catch`.
 *
 * 🔴 **And the CLAIMS travel with the result** (206 H1, ported from `ui-live-smoke.mjs`). They did
 * not: this function pushed neither a `name` nor a `claims` array and `step()` destructured only
 * `{ verdict, detail }`, so `summarize`'s two claim counters were structurally **0 on every run
 * this script has ever made** — the headline could not print them, and `blankClaims` could not
 * name a single one. ⚠️ A FAIL still contributes none: the step did not finish, so what it would
 * have claimed is unknown, and inventing an unasserted claim for it would put a number on
 * something nobody measured.
 *
 * ⛔ **`ok: ok === true` is GONE** (`420`), exactly as it went in `ui-live-smoke.mjs`. Nothing read
 * it, and the moment a verdict string arrives here it would have answered `false` for every PASS —
 * a dead field that had quietly become a wrong one, which is worse than either.
 */
function record(ok, name, detail, claimed) {
  const verdict = typeof ok === 'string' ? ok : ok ? 'PASS' : 'FAIL'
  const line = `${verdict} ${name}${detail ? ` — ${detail}` : ''}`
  results.push({ verdict, line, name, claims: claimed ?? [] })
  console.log(line)
  writeFileSync(join(EVIDENCE, 'smoke.log'), results.map((r) => r.line).join('\n') + '\n')
}

/**
 * The step being driven right now, so {@link placeSession} can say WHICH step its placement is
 * for. ⚠️ Deliberately never cleared: a placement that somehow happens between steps is still
 * better described by the last one than by nothing.
 */
let currentStep = 'before any step'

async function step(name, fn) {
  currentStep = name
  try {
    // ⛔ A step that answered `notAsserted(…)` ran and checked nothing it exists to check; a step
    // that answered `notPerformed(…)` never asked, because the gesture is gone. Neither is a pass,
    // and 196 H1 is that the first used to be counted as one.
    const { verdict, detail, claims: claimed } = outcomeVerdict(await fn())
    record(verdict, name, detail, claimed)
  } catch (error) {
    record(false, name, error instanceof Error ? error.message : String(error))
    throw error
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

async function waitFor(what, predicate, timeoutMs = 60_000, pollMs = 250) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(pollMs)
  }
}

// Release title bars hide schema text; the database still reports its migration count over IPC.
async function thePackagedDatabaseOpened(cdp) {
  const migrations = await waitFor(
    'the app to report a positive migration count',
    async () =>
      await cdp.evaluate(`
        if (!document.querySelector('[data-cy=app-info]')) return null
        const info = await window.api.getAppInfo()
        const count = info?.db?.migrationsApplied
        return Number.isInteger(count) && count > 0 ? count : null
      `),
    15_000,
  ).catch(async (error) => {
    const text = await cdp.evaluate(
      `return document.querySelector('[data-cy=app-info]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null`,
    )
    throw new Error(`${error.message} — the packaged app's footer reads "${text}"`)
  })
  return `schema ${migrations} — the count came out of a SQLite file the packaged binary opened`
}

/** The version this build was pinned to, read from the manifest rather than hardcoded here. */
function pinnedCodexVersion() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/desktop/package.json'), 'utf8'))
  const spec = manifest.optionalDependencies?.['@openai/codex-darwin-arm64'] ?? ''
  const match = /@openai\/codex@([\d.]+)-darwin-arm64/.exec(spec)
  if (!match) throw new Error(`cannot read the pinned codex version from "${spec}"`)
  return match[1]
}

/** `-1`, `0` or `1` as `a` is older than, the same as or newer than `b`, part by part. */
function versionOrder(a, b) {
  const parts = (text) => text.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let at = 0; at < 3; at += 1) {
    if (x[at] !== y[at]) return Math.sign(x[at] - y[at])
  }
  return 0
}

/**
 * Every file and folder packed in an asar archive, from its header — the JSON step `0b` reads,
 * parsed here, so a name is matched whole rather than as a substring.
 */
function asarEntries(archive) {
  const bytes = readFileSync(archive)
  const length = bytes.readUInt32LE(12)
  const entries = []
  const walk = (node, at) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = at === '' ? name : `${at}/${name}`
      entries.push({ path, isFile: child.files === undefined })
      walk(child, path)
    }
  }
  walk(JSON.parse(bytes.subarray(16, 16 + length).toString('utf8')), '')
  return entries
}

/** Every file and folder under `dir`: its path relative to `dir`, spelled with `/`. */
function entriesUnder(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  return entries.map((entry) => ({
    path: relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'),
    isFile: entry.isFile(),
  }))
}

/** What of Claude Code `entries` hold: each `claude` program, and each Agent SDK platform package once. */
function claudeCodeIn(entries) {
  const found = new Set()
  for (const { path, isFile } of entries) {
    const parts = path.split('/')
    const at = parts.findIndex(
      (part, index) => parts[index - 1] === '@anthropic-ai' && part.startsWith('claude-agent-sdk-'),
    )
    if (at !== -1) found.add(parts.slice(0, at + 1).join('/'))
    else if (isFile && /^claude(\.exe)?$/i.test(parts.at(-1))) found.add(path)
  }
  return [...found]
}

/**
 * What the packaged app says about Claude Code: the Providers screen's own read, asked in the page,
 * as `{ version, program }`, where `program` names the one it found (or that none is installed).
 * The page returns the bridge's answer as it is; this script decides in Node.
 */
const CLAUDE_CODE_FOUND = `
  const versions = await window.api.runtime.providerVersions()
  const claude = versions.claude
  return { version: claude.version, program: claude.program ?? null }`

/**
 * Launch the PACKAGED app on its own port and user-data dir, and prove the thing answering on
 * that port is the app we just started.
 *
 * `freePort` is inherently TOCTOU — the port is released before Electron binds it — and every
 * BroBot build answers `window.api.runtime` and shows the same `data-cy` hooks, so attaching by
 * port number alone would let a dev app, another worktree's app, or a leftover instance stand in
 * for the artifact under test. That is exactly the incident (049) `assertPortOwnedByTree` was
 * written for; this is the script making the strongest claims in the repo, so it uses it too —
 * scoped to the BUNDLE, so only a process running inside this .app can satisfy it.
 */
async function launchPackagedApp() {
  const port = await freePort()
  const child = spawn(
    APP_BINARY,
    // ⚑ 695 §1 · the packaged app reads the same switch: this run's window is nobody's.
    [`--remote-debugging-port=${port}`, `--user-data-dir=${USER_DATA}`, HIDDEN_LAUNCH_ARG],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  )
  let output = ''
  child.stdout?.on('data', (chunk) => (output += chunk))
  child.stderr?.on('data', (chunk) => (output += chunk))

  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  process.on('exit', stop)

  // Wait for the port to be BOUND, and by this bundle. Without this the script would happily
  // drive whatever else was listening — and would say nothing about the artifact.
  await waitFor(
    `the packaged app to listen on ${port}`,
    async () => {
      if (child.exitCode !== null) {
        throw new Error(
          `the packaged app exited with code ${child.exitCode} before opening a debug port` +
            `${output.trim() ? ` — ${output.trim().slice(0, 400)}` : ''}`,
        )
      }
      try {
        await fetch(`http://127.0.0.1:${port}/json/version`)
        return true
      } catch {
        return false
      }
    },
    120_000,
  )
  // Ownership is proven from the OS: whoever holds this port must be running from inside the
  // bundle under test. A dev app, another worktree, or a stale instance fails here rather than
  // silently becoming the thing this script reports on.
  assertPortOwnedByTree({ port, repoRoot: APP })
  // ⛔ **The gate ran and ANSWERED** (242 §1). ⚠️ **This script is where it matters most**: the
  // packaged app is the artefact a person double-clicks, and a double-click repeated fast enough is
  // the 8/24 double-launch race `236` §3 exists for. Until 242 the bundle's gate had never bound
  // here either — same 104-byte `sun_path`, same silence.
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

  return { port, pid: child.pid, stop, log: () => output, exited: () => child.exitCode }
}

class Cdp {
  #socket
  #id = 0
  #pending = new Map()

  static async attach(port) {
    const target = await waitFor(
      'the packaged renderer target',
      async () => {
        try {
          const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
          return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        } catch {
          return undefined
        }
      },
      120_000,
    )
    const cdp = new Cdp()
    await cdp.#connect(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await waitFor('the packaged app to mount', async () => {
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
    return new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true })
      this.#socket.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    // The tab-flow walk (097), on the third script that reads a drawer-body hook. ⚑ **D-017b** — its
    // SNAPSHOT no longer reaches for the Info tab's process row, which the window stopped drawing
    // (`05` rule 5), so nothing here needs a tab chosen first; the walk still guards the next read.
    //
    // ⚠️ **Wired and NOT RUN**, per the batched-smoke policy: this script needs `pnpm package`
    // first, which is a build of its own. The walk is shared with the two scripts that HAVE been
    // run, and `ui-live-smoke.mjs` step 55 is what proves it fires; what is unproven here is only
    // that this file's own reads are all on the right tabs.
    await assertTabFlow(expression, (probe) => this.#evaluateRaw(probe))
    return await this.#evaluateRaw(expression)
  }

  async #evaluateRaw(expression) {
    const result = await this.send('Runtime.evaluate', {
      // ⛔ **`async`, and `427` watched the missing word cost a packaged run.** `packaged-smoke`'s
      // step `4b` — the one real Claude turn inside the built app — died on
      // `SyntaxError: await is only valid in async functions`, because its expression says
      // `return await window.api.runtime.createSession(…)` and this wrapper was a plain arrow.
      // ⚠️ **Wired at `420` and never run**, which is exactly the risk the batching policy names:
      // *"an edited-but-unrun smoke step is the one thing batching genuinely defers into risk."*
      // ⚑ `ui-live-smoke.mjs` has always wrapped in an async IIFE; the two files that did not are
      // now the same, and `scripts/test/front-door.test.mjs` keeps them that way.
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'page threw')
    }
    return result.result.value
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

const CLICK = (cy) => `
  const el = document.querySelector('[data-cy=${cy}]')
  if (!el) throw new Error('no [data-cy=${cy}]')
  el.click()
  return true`

const SNAPSHOT = `
  // ${WIDE_READ_MARK} — one pass across the top bar, the conversation and the Info tab, whose
  // contract is that an absent hook reads as empty (097's walk).
  return {
    status: document.querySelector('[data-cy=session-status]')?.dataset.status ?? null,
    error: document.querySelector('[data-cy=command-error]')?.textContent?.trim() ?? null,
    assistant: [...document.querySelectorAll('[data-cy=assistant-message]')].map((el) => el.textContent.trim()).join(' | '),
    liveness: document.querySelector('[data-cy=session-liveness]')?.innerText ?? '',
    // ⚑ **D-017b · no \`process\` here any more** — the Info tab's process row is gone (\`05\`
    // rule 5: the window says nothing about whether a process runs). Steps 4 and 4c read the pid
    // off the OS instead ({@link providerChildOf}).
    cards: document.querySelectorAll('[data-cy=permission-card]').length,
  }`

/**
 * Open the new-conversation surface. The composer is the ONE way a session starts — there is no
 * create button and no disclosure (013, and since `417` there is nothing on the door to miss).
 *
 * 🔴 **The gate waited on a control `417` deleted** (`420`, HO-022 §2). It was
 * `[data-cy=new-conversation-surface] [data-cy=provider-select]`, and the settings block that hook
 * belonged to is gone — so this function could only ever spend its fifteen seconds and then throw
 * *"timed out waiting for the launcher"*, which reads as a broken packaged app and is a broken
 * instrument. ⚠️ **It waits on the COMPOSER now** — `prompt-input`, the one thing the surface still
 * has and the only thing either door needs — so a step that wants a control it cannot have fails
 * immediately, by name, at {@link refuseWhatTheFrontDoorCannotAsk}.
 */
async function openLauncher(cdp) {
  const shown = `return Boolean(document.querySelector('[data-cy=new-conversation-surface] [data-cy=prompt-input]'))`
  if (await cdp.evaluate(shown)) return
  await cdp.evaluate(CLICK('new-conversation'))
  await waitFor('the new-conversation composer', async () => await cdp.evaluate(shown), 15_000)
}

/**
 * 🔴 **UI-012 · pick Codex on the front door — through the one model picker** (R-3: the provider
 * select went; picking a Codex model is choosing Codex, the first term `providerForALaunch` ranks).
 *
 * ⚠️ **By HAND, because step 5 has moved Codex's binary aside**: its list cannot be read, so the
 * picker's Codex section holds no row of the provider's own. ⚑ A model a person adds is never
 * checked (`09` §6) and is drafted once added, so the take names Codex without asking it anything.
 */
async function pickACodexModelByHand(cdp) {
  const addOpen = `[data-cy=model-picker-provider][data-provider=codex] [data-cy=model-picker-add-open]`
  await cdp.evaluate(CLICK('model-picker-face'))
  await waitFor(
    'the model picker to list Codex',
    async () => await cdp.evaluate(`return Boolean(document.querySelector('${addOpen}'))`),
    15_000,
  )
  await cdp.evaluate(`document.querySelector('${addOpen}').click()
  return true`)
  await waitFor(
    'the field to name a Codex model in',
    async () =>
      await cdp.evaluate(
        `return Boolean(document.querySelector('[data-cy=model-picker-add-name]'))`,
      ),
    15_000,
  )
  await cdp.evaluate(SET_VALUE('model-picker-add-name', 'gpt-5.6-terra'))
  await cdp.evaluate(CLICK('model-picker-add'))
  await waitFor(
    'the picker to take the Codex model',
    async () =>
      await cdp.evaluate(`const take = document.querySelector('[data-cy=model-picker-take]')
  return take !== null && !take.disabled`),
    15_000,
  )
  await cdp.evaluate(CLICK('model-picker-take'))
}

/**
 * 🔴 **What the front door cannot be asked for, and what to use instead** (`420` §4, from `417`).
 *
 * ⛔ **`417` did not take a control away; it took a CAPABILITY away.** `NewConversation.vue` sends
 * exactly `{ provider: RuntimeScreen.DEFAULT_PROVIDER, profileId: DEFAULT_PROFILE_ID, approvalMode: 'ask' }`
 * and `417 §2` measured that the renderer has exactly ONE `createSession` call, reached from that
 * component alone. So a step needing Claude, a named profile, a planted folder, a launch-time
 * model, a reasoning rung, plan mode or yolo is asking for a shape **no gesture a person can make
 * can express** — and `417 §3` measured that the provider cannot be moved afterwards either.
 *
 * Every field named here has exactly one of three answers, which is `420` §4: drive a live control
 * in the drawer after the launch; place the conversation with {@link placeSession} and say WHICH
 * field forced it; or return `notPerformed(…)` because the control WAS the subject. ⛔ **Do not
 * answer it by re-adding a picker** — `417` and `420` §6 were both told to report the gap rather
 * than work around it.
 *
 * ⚑ **Ported from `ui-live-smoke.mjs` as a copy, and said out loud rather than hidden.** The list,
 * the refusal and both doors are now identical in more than one instrument and want a
 * `scripts/lib/` module; `420` scoped this dispatch to this one file, so the duplication is named
 * here and in the response instead of being built.
 */

function refuseWhatTheFrontDoorCannotAsk(asked) {
  const named = whatTheFrontDoorCannotCarry(asked)
  if (named.length === 0) return
  throw new Error(
    `⛔ startSession is the FRONT DOOR and it cannot be asked for ${named.join(', ')} — ` +
      `417 removed those controls (HO-022 §2). Either drive the live control in the drawer after ` +
      `the launch, or place the conversation with placeSession() and say in the step WHICH field ` +
      `forced it. There is no third option that is honest.`,
  )
}

/**
 * Every step that had to use the interim door, and what forced it — printed with the headline.
 *
 * ⛔ **A count, not a feeling.** `420` §0: *"An instrument that runs green while measuring less is
 * worse than one that is red."* A front-door step and a placed step are both green and they are
 * not the same evidence, so the run says how many of each it got and which field is doing it.
 */
const placedThroughTheInterimDoor = []

/**
 * …and every step that really did go through the front door — the number that must not quietly
 * fall to nothing while the run stays green.
 */
const startedThroughTheFrontDoor = []

/**
 * Start a session THROUGH THE FRONT DOOR: type the first message on the new-conversation surface
 * and send. **That is the whole of it now** (`420`, from `417` / HO-022 §2).
 *
 * ⛔ **It takes a prompt and nothing else.** {@link refuseWhatTheFrontDoorCannotAsk} stands in
 * front of it, so a step asking for a placement fails at the ASK, by name, with the two honest
 * alternatives in the message — rather than timing out against a hook that has not existed since
 * `417` and reporting it as a product regression.
 *
 * ⚑ **For this script the change is an UPGRADE.** Every conversation it opens is BroBot's, in `ask`,
 * on `providerForALaunch`'s answer — Codex before BroBot's identity exists (step `3`), its seeded
 * Claude after (`433`), unless a step picks a Codex model first, as step `5` does since `738`
 * (through the model picker since UI-012) —
 * so steps `3` and `5` also prove the packaged app's one way in works. ⚠️ **And the isolation the old `cwd-input`
 * write bought is kept.** With no folder requested, `resolveSessionCwd`'s blank branch answers
 * `ensureWorkspace(<userData>)` — since D-016 the only fallback — and this run creates its own
 * `--user-data-dir`, so every conversation starts in a directory this run owns.
 */
async function startSession(cdp, { prompt, ...asked }) {
  refuseWhatTheFrontDoorCannotAsk(asked)
  await openLauncher(cdp)
  startedThroughTheFrontDoor.push(currentStep)
  const before = await cdp.evaluate(SNAPSHOT)
  await cdp.evaluate(SET_VALUE('prompt-input', prompt))
  // ⚠️ **Wait for the button before pressing it** (`ui-live-smoke.mjs`, 093). `openLauncher`
  // returns as soon as the surface holds a `prompt-input`; the send button beside it can mount a
  // tick later, and after a heavy surface swap it reliably does.
  await waitFor(
    'the launcher to offer its send button',
    async () =>
      await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=send-prompt]'))`),
    15_000,
  )
  // ⚠️ **A send that cannot work is a SILENT no-op** (094/223, ported). `PromptComposer.send()`
  // opens with a `canSend` guard and returns; a press against a composer that lost what was typed
  // launches nothing, reports nothing, and leaves the step to spend its whole turn budget and then
  // say the feature is missing. Asserted at the moment of the press rather than waited for
  // afterwards, so this helper still returns while the app is on the launcher.
  const ready = await cdp.evaluate(`
    const box = document.querySelector('[data-cy=prompt-input]')
    const button = document.querySelector('[data-cy=send-prompt]')
    return {
      typed: box ? box.value.trim().length : -1,
      disabled: button ? button.disabled : null,
      onLauncher: Boolean(document.querySelector('[data-cy=new-conversation-surface]')),
    }`)
  if (!ready.onLauncher) {
    throw new Error(
      'the app replaced the launcher with a conversation while its message was being typed in — ' +
        'RuntimeScreen re-elects an active conversation whenever store.open changes and activeId ' +
        'is null, which is exactly while the launcher is up',
    )
  }
  if (ready.typed <= 0) {
    throw new Error(
      `the launcher lost the message that was typed into it (${ready.typed} chars) — pressing ` +
        'send now would be a silent no-op, not a launch',
    )
  }
  if (ready.disabled) {
    throw new Error(
      'the send button is disabled with a message in the box — this composer is not the ' +
        'launcher’s, or something else forbids the launch',
    )
  }
  await cdp.evaluate(CLICK('send-prompt'))
  return before
}

/**
 * 🔴 **The INTERIM door — a conversation placed where the front door cannot place one** (`420` §3).
 *
 * ⛔ **This is not the design and must never be written up as one.** `420` §3 authorised *"the
 * narrowest interim you can defend"* for as long as `419`'s identity contract and `417` §11.2's
 * placement surface are unlanded, and required it be *"named as an interim in the code"*. This is
 * that name. The day a person can pick a provider, every caller here moves to that surface and
 * this function is deleted — and the count it prints in the headline is how much is waiting on it.
 *
 * ⚑ **How narrow it actually is, said precisely.** It calls `window.api.runtime.createSession` —
 * **the same IPC command the front door itself calls**, one layer under the surface, with the
 * fields the surface can no longer carry. It invents no verb, reaches no private state, and starts
 * nothing the product could not start if it had a control for it. ⚠️ **What it does NOT measure is
 * that a person can reach this shape at all** — which is the whole of what `417` took away, and is
 * why step `4b` reports that half as an unreached claim instead of passing over it in silence.
 *
 * ⚠️ **The baseline is taken on the LAUNCHER, exactly as {@link startSession} takes it**, so both
 * doors hand a step the same kind of `before`: a snapshot with no conversation in it.
 *
 * ⛔ **And the rail row is waited for rather than assumed.** The renderer's store did not create
 * this session, so it learns of it only when an event for an unknown id arrives and it asks the
 * host about it — which is why the send comes BEFORE the wait: with no message there is no event,
 * and with no event there is no row.
 *
 * @param forced which front-door-impossible field(s) made this a placement. ⛔ Required: a
 *   placement nobody can justify in one clause is a placement that should have been a front door.
 */
async function placeSession(cdp, { prompt, forced, ...placement }) {
  if (typeof forced !== 'string' || forced.trim() === '') {
    throw new Error(
      'placeSession: say which front-door-impossible field forced this placement — an unexplained ' +
        'interim is how an interim becomes the design',
    )
  }
  const unknown = whatIsNotPlaceable(placement)
  if (unknown.length > 0) {
    // ⛔ **The wire schema STRIPS unknown keys** (`main/runtime/ipc.ts`), so a misspelled field is
    // dropped in silence and the session starts on a shape nobody asked for. Refused here, where
    // the typo is, rather than three minutes later as a turn that ran on the wrong provider.
    throw new Error(`placeSession: ${unknown.join(', ')} is not a createSession field`)
  }
  placedThroughTheInterimDoor.push(`${currentStep} — ${forced}`)
  await openLauncher(cdp)
  const before = await cdp.evaluate(SNAPSHOT)
  const opened = await cdp.evaluate(`
    return await window.api.runtime.createSession(${JSON.stringify({
      approvalMode: 'ask',
      ...placement,
    })}).then((created) => created.sessionId).catch((error) => 'ERROR: ' + String(error))`)
  if (typeof opened !== 'string' || opened.startsWith('ERROR')) {
    throw new Error(`the conversation could not be placed: ${String(opened)}`)
  }
  const sent = await cdp.evaluate(`
    return await window.api.runtime.send({
      sessionId: ${JSON.stringify(opened)},
      text: ${JSON.stringify(prompt)},
    }).then(() => 'sent').catch((error) => String(error))`)
  if (sent !== 'sent') throw new Error(`the first message was refused: ${sent}`)
  await waitFor(
    `the rail to list the conversation that was placed (${forced})`,
    async () =>
      await cdp.evaluate(
        `return Boolean(document.querySelector('[data-cy="open-session-${opened}"]'))`,
      ),
    60_000,
  )
  await cdp.evaluate(CLICK(`open-session-${opened}`))
  return before
}

/**
 * ⚑ **D-017b · the provider child a step proves the binary of, read off the OS** — the pid of a
 * process descended from the app this run launched whose program is `name`, or `null` while there
 * is none.
 *
 * ⛔ **It was read off the drawer's Info tab** (`080`: `codex pid 95225`), and D-017b took that row
 * away with every other sentence about whether a process runs (`05` rule 5). ⚑ The OS is the
 * stronger witness anyway: the step's whole claim is *which executable is running*, and `ps` is
 * what answered that half already.
 *
 * ⚑ **Descended from `appPid`, never matched by name alone** — a developer's own `codex` or
 * `claude` elsewhere on the machine is not this app's child. The expected program is preferred
 * when several match (the bundled Codex, or the Claude Code the app said it found), so a stray
 * child does not mask the one under test; with none of it running, the first match is what the
 * step's own check then names as the wrong one. `argv[0]` is matched space-free for the other arm:
 * a path with a space in it is caught only by the expected prefix. `name` is a pattern, so npm's
 * `claude.exe` (its name on every system) is a Claude child too.
 */
function providerChildOf(appPid, name, bundled) {
  let table
  try {
    table = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
  } catch {
    return null
  }
  const rows = []
  for (const line of table.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] })
  }
  const parentOf = new Map(rows.map((row) => [row.pid, row.ppid]))
  const descends = (pid) => {
    for (let at = parentOf.get(pid), hops = 0; at !== undefined && hops < 64; hops++) {
      if (at === appPid) return true
      at = parentOf.get(at)
    }
    return false
  }
  const isBundled = (command) => command === bundled || command.startsWith(`${bundled} `)
  const program = new RegExp(`^(\\S*/)?${name}(\\s|$)`)
  const children = rows.filter(
    (row) => descends(row.pid) && (isBundled(row.command) || program.test(row.command)),
  )
  return (children.find((row) => isBundled(row.command)) ?? children[0])?.pid ?? null
}

async function main() {
  // ⚑ **Nothing is wiped any more, and nothing needs to be** (196 H4). The old comment here argued
  // that the user-data had to be cleared or a PREVIOUS run's database would make "the schema is
  // there" true for the wrong reason — correct, and solved better by never sharing the directory:
  // this run's evidence tree and its scratch directory are its own, so the user-data under them is
  // fresh by construction and the previous run's paper trail survives beside it instead of being
  // deleted to make room. Every path a concurrent run could have wiped is now one it cannot name.
  // (⚠️ Said as *directories* rather than as `EVIDENCE` and `SCRATCH` since `420`: the second
  // binding is gone with the three `cwd-input` writes that were its only readers. The directory
  // is not.)
  console.log(`run ${RUN_ID} · evidence ${EVIDENCE}`)
  mkdirSync(USER_DATA, { recursive: true })

  let app
  let renamed = false
  /** The provider child observed in step 4 — reaped by pid, because it leads its OWN group. */
  let codexPid = null
  /**
   * The Claude Code child observed in step 4c.
   *
   * ⚠️ **Reaped for a different reason than `codexPid`.** This child is NOT detached — 233 spawns
   * it in the app's own process group — so `app.stop()`'s group SIGTERM already reaches it. The
   * belt is here because the program is 200 MB and more of resident CLI and a step that throws
   * between the turn and the stop would otherwise leave one behind; the same re-identification rule
   * applies, so a recycled pid is never something this script kills.
   */
  let claudePid = null
  /**
   * The Claude Code the packaged app found (step `2c`), as the app said it: `standing: 'missing'`
   * on a computer with none installed, and `null` until `2c` has read it.
   */
  let claudeFound = null
  /** Why a Claude step has no program to run — none installed — or `null` when it has one. */
  const noClaudeCode = () =>
    claudeFound === null
      ? 'the app was never asked which Claude Code it runs (step 2c did not finish)'
      : claudeFound.standing === 'missing'
        ? `no Claude Code is installed on this computer — the app says: ${claudeFound.said}`
        : null

  /**
   * Put the artifact back, whatever happens. `finally` does not run on a signal, and step 5 —
   * which renames a 308 MB binary aside and then waits out two multi-minute budgets — is the step
   * an operator is most likely to Ctrl-C. Left renamed, the next run fails at step 0 saying the
   * bundle is missing a file, which reads like a broken BUILD rather than debris; and `dist/` is
   * gitignored, so nothing else would ever mention it.
   */
  const restoreArtifact = () => {
    // Never throws. It runs first in `finally` and inside the signal handlers, so a failed rename
    // — a permissions change, a disk full, the .moved file vanishing between the check and the
    // call — would otherwise REPLACE the failure that brought us here, and would skip the process
    // reaping below it. The rename failing is worth shouting about; it is not worth losing the
    // original error, or leaking a provider child, to report.
    try {
      if (renamed && existsSync(`${PACKAGED_CODEX}.moved`)) {
        renameSync(`${PACKAGED_CODEX}.moved`, PACKAGED_CODEX)
        renamed = false
      }
    } catch (cause) {
      console.error(
        `\n!! could not put the binary back — the built app is left BROKEN. Restore it with:\n` +
          `   mv ${PACKAGED_CODEX}.moved ${PACKAGED_CODEX}\n   (${cause instanceof Error ? cause.message : cause})`,
      )
    }
  }
  process.on('exit', restoreArtifact)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      restoreArtifact()
      process.exit(130)
    })
  }

  try {
    await step('0 the built app is there, and it is a real bundle', async () => {
      if (!existsSync(APP)) {
        throw new Error(`no packaged app at ${APP} — run \`pnpm run package\` first`)
      }
      for (const path of [APP_BINARY, join(RESOURCES, 'app.asar'), PACKAGED_CODEX]) {
        if (!existsSync(path)) throw new Error(`the bundle is missing ${path}`)
      }
      // The Apache-2.0 notice for the bundled codex has to travel WITH the artifact.
      // ⚑ …and Electron's own license and Chromium's notices, which electron-builder deletes from a
      // macOS build unless `electron-builder.yml` copies them in.
      for (const notice of [
        'THIRD-PARTY-NOTICES.md',
        'LICENSE.electron.txt',
        'LICENSES.chromium.html',
      ]) {
        if (!existsSync(join(RESOURCES, notice))) {
          throw new Error(`the artifact carries no ${notice}`)
        }
      }
      return `${APP}`
    })

    await step('0b the 308 MB codex tree ships ONCE, not twice', async () => {
      // The `!node_modules/@openai/codex-darwin-arm64/**` negation in electron-builder.yml is the
      // only thing keeping the vendor tree out of electron-builder's separate node_modules pass.
      // A unit test pins that the LINE exists; this checks the ARTIFACT, which is the claim that
      // actually matters — and the failure it guards is silent, because a second copy inside the
      // asar is merely unreachable dead weight, not an error.
      //
      // An asar begins with a JSON header listing every packed path, so the file names are
      // readable without unpacking anything (and without writing extracted files anywhere).
      const asar = readFileSync(join(RESOURCES, 'app.asar'))
      const header = asar.subarray(0, Math.min(asar.length, 8 * 1024 * 1024)).toString('latin1')
      if (header.includes('codex-darwin-arm64')) {
        throw new Error(
          'the codex vendor tree is ALSO inside app.asar — it is shipping twice, and the copy ' +
            'in the asar can never be executed',
        )
      }
      const vendorMb = Math.round(
        Number(
          execFileSync('du', ['-sm', join(RESOURCES, 'codex-vendor')], { encoding: 'utf8' }).split(
            '\t',
          )[0],
        ),
      )
      return `${vendorMb} MB in <Resources>/codex-vendor, and no copy inside app.asar`
    })

    await step('1 the bundled codex is the version this app was built against', async () => {
      const pinned = pinnedCodexVersion()
      const reported = execFileSync(PACKAGED_CODEX, ['--version'], { encoding: 'utf8' }).trim()
      // The VERSION TOKEN, compared for equality. `includes(pinned)` would be satisfied by
      // 0.146.01, 10.146.0 or 0.146.0-rc1 — and the line this step prints claims `==`.
      const version = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(reported)?.[1]
      if (version !== pinned) {
        throw new Error(
          `packaged codex reports "${reported}" (version token ${version ?? 'unreadable'}), ` +
            `pinned is ${pinned}`,
        )
      }
      return `${reported} == pinned ${pinned}, at <Resources>/codex-vendor/…/bin/codex`
    })

    await step('1b nothing of Claude Code ships: a person installs their own', async () => {
      // The app carries no Claude Code: a `claude` in the bundle, or an Agent SDK platform package
      // (each a whole Claude Code binary), would be 200 MB and more of a program nobody runs. Read
      // as step `0b` reads the Codex tree: the archive's header lists every packed path and the
      // unpacked folder is walked, so nothing is extracted.
      const asar = join(RESOURCES, 'app.asar')
      const packed = asarEntries(asar)
      const inside = [
        ...claudeCodeIn(packed).map((path) => `app.asar/${path}`),
        ...claudeCodeIn(entriesUnder(join(RESOURCES, 'app.asar.unpacked'))).map(
          (path) => `app.asar.unpacked/${path}`,
        ),
      ]
      if (inside.length > 0) {
        throw new Error(
          `the bundle carries Claude Code, which a person installs themselves: ${inside.join(', ')}`,
        )
      }
      // …and the SDK's own JavaScript is in it: that is what starts the person's Claude Code.
      const sdk = 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'
      if (!packed.some(({ path }) => path === sdk)) {
        throw new Error(`app.asar has no ${sdk}, so no Claude conversation could start`)
      }
      return 'no claude program and no Agent SDK platform package in app.asar or app.asar.unpacked; the SDK’s JavaScript is in app.asar'
    })

    app = await launchPackagedApp()
    let cdp = await Cdp.attach(app.port)
    record(true, '2 the packaged app launches and mounts', `pid ${app.pid}, port ${app.port}`)

    await step(
      // "from app.asar.unpacked", precisely: dlopen CANNOT open a file inside app.asar, which is
      // the whole reason the asarUnpack line exists. Naming it "from the asar" would describe the
      // failure this step exists to rule out.
      '2b the packaged app opened its database — better-sqlite3 loaded from app.asar.unpacked',
      async () => {
        return await thePackagedDatabaseOpened(cdp)
      },
    )

    await step('2c the app finds the Claude Code installed on this computer', async () => {
      // The program every Claude turn below runs, as the app itself says it: the Providers screen's
      // read, asked in the page. Which one, from where, and its version against the tested ones.
      const found = await cdp.evaluate(CLAUDE_CODE_FOUND)
      const program = found?.program ?? null
      if (program === null) {
        throw new Error(
          `the app said nothing about which Claude Code it runs: ${JSON.stringify(found)}`,
        )
      }
      claudeFound = program
      writeFileSync(join(EVIDENCE, 'claude-code-found.json'), JSON.stringify(found, null, 2))
      if (program.standing === 'missing') {
        // A computer with none installed is not a broken app, unless one is installed where
        // Anthropic's installer or Homebrew puts it and the app looked past it.
        const there = WELL_KNOWN_CLAUDE.filter((path) => existsSync(path))
        if (there.length > 0) {
          throw new Error(
            `the app says Claude Code is not installed, and ${there.join(' and ')} is there: ${program.said}`,
          )
        }
        return notPerformed(
          `no Claude Code is installed on this computer — the app says: ${program.said}`,
        )
      }
      // A download never runs a copy of its own, nor a development checkout's.
      if (program.from === 'development-checkout') {
        throw new Error(
          `the packaged app runs a development checkout's Claude Code: ${program.path}`,
        )
      }
      if (typeof program.path !== 'string' || program.path.startsWith(`${APP}/`)) {
        throw new Error(
          `the packaged app runs a Claude Code inside its own bundle: ${program.path}`,
        )
      }
      if (program.standing === 'unreadable' || program.version === null) {
        throw new Error(`the Claude Code the app found did not say its version: ${program.said}`)
      }
      // The version the app says must be the one the program prints: asked here too, on a home and
      // config folder of this run's own, and told not to update itself.
      const home = join(EVIDENCE, 'claude-version-home')
      mkdirSync(home, { recursive: true })
      let printed
      try {
        printed = execFileSync(program.path, ['--version'], {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            HOME: home,
            CLAUDE_CONFIG_DIR: home,
            DISABLE_AUTOUPDATER: '1',
            PATH: '/usr/bin:/bin',
          },
        }).trim()
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
      const version = /(\d+\.\d+\.\d+)/.exec(printed)?.[1]
      if (version !== program.version) {
        throw new Error(
          `the app says Claude Code ${program.version}, and ${program.path} prints "${printed}"`,
        )
      }
      return (
        `Claude Code ${program.version}, ${program.from}, at ${program.path} — ${program.standing} ` +
        `(tested ${program.tested.oldest} to ${program.tested.newest})`
      )
    })

    await step('3 a real Codex session runs INSIDE the packaged app', async () => {
      // 🔴 **Through the FRONT DOOR, and that is strictly BETTER evidence than this step had**
      // (`420`, from `417`). It used to write `provider-select` to `codex` and `cwd-input` to this
      // run's scratch directory, and `417` deleted both hooks (HO-022 §2). ⛔ Neither was carrying
      // anything: `codex` is `RuntimeScreen.DEFAULT_PROVIDER`, which is the value the front door
      // sends regardless, and the folder was read by NOTHING in this file — no step asserted a
      // path, listed the directory, or opened a file in it.
      //
      // ⚑ **So the step keeps its whole subject and gains one.** It now also proves that the
      // packaged app's ONLY way in works — a claim nothing here could make while there was a
      // second way to start a session, and the claim `417` made load-bearing.
      //
      // ⚠️ **Where the turn runs is not a loss either.** With no folder requested,
      // `resolveSessionCwd`'s blank branch answers `ensureWorkspace(<userData>)`; this app was
      // launched on this run's own `--user-data-dir`, so the conversation starts in a directory
      // this run owns — see the door's docblock.
      await startSession(cdp, {
        prompt: 'Reply with exactly the single word: PACKAGED. Do not use any tools.',
      })

      const replied = await waitFor(
        'the reply to arrive in the packaged app',
        async () => {
          const now = await cdp.evaluate(SNAPSHOT)
          if (now.error) throw new Error(`the packaged app refused to start Codex: ${now.error}`)
          return /PACKAGED/i.test(now.assistant) ? now : null
        },
        TURN_BUDGET_MS,
      )
      return `reply "${replied.assistant.slice(0, 60)}" — streamed from a session started by the built app`
    })

    await step('4 the running codex is the BUNDLED one — proven from the OS', async () => {
      // The gold standard from 014's smoke, now against the packaged layout: the app's own codex
      // child, and the OS says which executable that pid is running. A PATH lookup, a developer's
      // global codex, or a node_modules copy would all fail this.
      // ⚑ **D-017b** — the child is found among the app's descendants ({@link providerChildOf}):
      // the Info tab no longer names a pid.
      codexPid = await waitFor(
        'the codex child of the packaged app',
        async () => providerChildOf(app.pid, 'codex', PACKAGED_CODEX),
        30_000,
      )
      const command = execFileSync('ps', ['-o', 'command=', '-p', String(codexPid)], {
        encoding: 'utf8',
      }).trim()
      // Matched as a PREFIX of argv, never by cutting ' app-server' out of the middle: a checkout
      // under a path containing " app-server" would truncate to nonsense, and a codex invoked with
      // different argv would leave that strip a silent no-op.
      //
      // The prefix test comes FIRST and touches no filesystem, so a path with spaces in it is
      // decided correctly before anything can go wrong. Only if it misses do we fall back to
      // comparing realpaths — the expectation is built from this file's location while the app
      // reports what Electron resolved, so symlinks must not decide the verdict — and that
      // fallback is wrapped, because realpath on a bare command (the very regression this hunts)
      // throws ENOENT and would otherwise surface as a filesystem error instead of a verdict.
      const expected = realpathSync(PACKAGED_CODEX)
      const isBundled =
        command === PACKAGED_CODEX ||
        command.startsWith(`${PACKAGED_CODEX} `) ||
        (() => {
          try {
            return realpathSync(command.split(' ')[0]) === expected
          } catch {
            return false
          }
        })()
      if (!isBundled) {
        throw new Error(
          `the packaged app is running "${command}", not its own bundled binary at ` +
            `${expected} — a PATH lookup or a stray global has crept in`,
        )
      }
      return `pid ${codexPid} is <Resources>/codex-vendor/aarch64-apple-darwin/bin/codex`
    })

    await step('4b a real CLAUDE turn runs INSIDE the packaged app', async () => {
      // A Claude conversation, end to end, in the built app: the app hands the Agent SDK the Claude
      // Code it found (`2c`) by absolute path, and the SDK starts that program. A test that runs
      // unpacked cannot see the packaged half of this (a checkout runs the copy its dependencies
      // carry), which is why it is here and not in `vitest`.
      //
      // No program, no turn, and that is the computer, not the app: with none installed the step
      // answers NOT PERFORMED with the app's own sentence.
      //
      // ⛔ **The clause that used to end that sentence — *"through the same launcher a person
      // uses"* — was WITHDRAWN, not reworded** (`420`, from `417`), on the grounds that there was
      // no provider control anywhere in the renderer.
      //
      // 🔴 **`435` put one back** (HO-025 §5: *"a person who has to open a settings surface to pick
      // a provider — or cannot, because the column has one writer — is worse off than before"*), so
      // **a person CAN start a Claude session in this app**, and `417 §3`'s other half still holds:
      // nothing can move a conversation's provider afterwards. ⛔ **This step has not been
      // re-pointed at the control** — `435 §6` left the instruments' gestures to whoever owns them —
      // so the turn below is still PLACED, and the claim says so rather than repeating a capability
      // gap that closed.
      //
      // What survives is the launch, entire, which is why this is a placement and not
      // `notPerformed(…)`: finding the program, handing it to the SDK and starting it are all in
      // the main process, downstream of `createSession`, and {@link placeSession} calls that same
      // IPC command, so all of it is still exercised by a real turn inside the real bundle. What is
      // not exercised is the surface in front of it.
      //
      // ⚑ **Cheapest model, one word, no tools** — the smoke policy. The turn is not what is being
      // measured; that a turn HAPPENS is.
      const none = noClaudeCode()
      if (none !== null) return notPerformed(none)
      await placeSession(cdp, {
        forced: 'provider=claude and model=haiku — 417 deleted provider-select and model-input',
        provider: 'claude',
        model: 'haiku',
        prompt: 'Reply with exactly the single word: UNPACKED. Do not use any tools.',
      })

      const replied = await waitFor(
        'the Claude reply to arrive in the packaged app',
        async () => {
          const now = await cdp.evaluate(SNAPSHOT)
          // A launch that cannot start fails HERE and says so: `start` rejects, and the surface
          // shows why verbatim.
          if (now.error) throw new Error(`the packaged app refused to start Claude: ${now.error}`)
          return /UNPACKED/i.test(now.assistant) ? now : null
        },
        TURN_BUDGET_MS,
      )
      // ⛔ **Two claims, because this step now reaches one of them and not the other** (206 H1,
      // `420` §4). Returning the sentence alone would have summed the whole step as one clean PASS
      // and left the capability `417` removed watched by nobody.
      return claims(
        asserted(
          `reply "${replied.assistant.slice(0, 60)}" — Claude Code ${claudeFound.version} ` +
            `(${claudeFound.from}, ${claudeFound.path}) started and streamed inside the bundle`,
        ),
        unasserted(
          'that a PERSON can reach Claude in the packaged app — ⚑ 435 put `provider-select` back ' +
            'on the front door (HO-025 §5), so the gesture EXISTS and this step has simply not ' +
            'been re-pointed at it: the turn above was PLACED through ' +
            'window.api.runtime.createSession rather than driven from the surface',
        ),
      )
    })

    await step(
      '4c the running claude is the Claude Code the app found — proven from the OS',
      async () => {
        // Step 4's gold standard, applied to Claude. The app said which program it runs (`2c`), and
        // a pid plus `ps` is the only evidence that survives every plausible way of being wrong: a
        // developer's other install, a PATH lookup, or the SDK's own lookup of a copy it carries.
        //
        // ⚠️ **The conversation this reads was PLACED, not launched** (`420`). Its whole existence
        // is `4b`'s doing, and `4b` now comes through {@link placeSession} — so this step's fate
        // follows `4b`'s: when `4b` had no program to run, this one has no subject either, and says
        // so rather than reading a pid off whatever conversation happens to be open.
        // ⛔ **It cannot go silently green over a session that does not exist**: `step()` rethrows,
        // so a `4b` that failed or refused ends the run before this line is reached, and the pid
        // wait below is scoped to a Claude child that only `4b` can have started.
        // ⚑ **D-017b** — off the OS, as step 4's ({@link providerChildOf}).
        const none = noClaudeCode()
        if (none !== null) return notPerformed(none)
        const expected = claudeFound.path
        claudePid = await waitFor(
          'the claude child of the packaged app',
          async () => providerChildOf(app.pid, 'claude(?:\\.exe)?', expected),
          30_000,
        )
        const command = execFileSync('ps', ['-o', 'command=', '-p', String(claudePid)], {
          encoding: 'utf8',
        }).trim()
        // As step 4 reads Codex's: the prefix first, then where the two paths really lead.
        const isFound =
          command === expected ||
          command.startsWith(`${expected} `) ||
          (() => {
            try {
              return realpathSync(command.split(' ')[0]) === realpathSync(expected)
            } catch {
              return false
            }
          })()
        if (!isFound) {
          throw new Error(
            `the packaged app is running "${command.slice(0, 200)}", not the Claude Code it found ` +
              `at ${expected}`,
          )
        }
        return `pid ${claudePid} is ${expected} — the Claude Code the app found (${claudeFound.from})`
      },
    )

    await step(
      '4d BroBot on claude-opus-5-5[1m] at max effort answers inside the packaged app',
      async () => {
        // 🔴 **680 · the test that dispatch exists for.** On 2026-09-23 BroBot on `claude-opus-5-5[1m]`
        // was refused inside this app: *"Claude Code 2.1.218 does not support this model; version
        // 2.1.280 or newer is required"*: the Claude Code the app ran was older than the model a
        // person could name. So the subject here is the model, and the smoke policy's
        // cheapest-model rule gives way to it: one word at `max` effort costs about five cents
        // ($0.045 measured on the adapter). It is placed exactly as `4b` is, for `4b`'s reason.
        //
        // An older Claude Code is the person's to update, so the step answers NOT PERFORMED, naming
        // the version found and the one the model needs, rather than spending a turn on a refusal
        // it can already read.
        //
        // ⛔ **A refusal ends the step at once, in the provider's own terms**, rather than as a
        // three-minute wait: since 680 a refusal is a NOTICE (R28a), never an assistant message, so
        // the notice rows are read too, and a failed turn throws every warn and error one verbatim.
        const none = noClaudeCode()
        if (none !== null) return notPerformed(none)
        if (versionOrder(claudeFound.version, OPUS_5_5_NEEDS) < 0) {
          return notPerformed(
            `the Claude Code the app found is ${claudeFound.version} (${claudeFound.path}), and ` +
              `claude-opus-5-5[1m] needs ${OPUS_5_5_NEEDS} or newer — updating Claude Code is what ` +
              'lets this step run',
          )
        }
        await placeSession(cdp, {
          forced:
            'provider=claude, model and reasoningEffort — the model IS the subject (680 §2.4)',
          provider: 'claude',
          model: 'claude-opus-5-5[1m]',
          reasoningEffort: 'max',
          prompt: 'Reply with exactly the single word: FLOOR. Do not use any tools.',
        })
        const replied = await waitFor(
          'BroBot’s reply on claude-opus-5-5[1m] in the packaged app',
          async () => {
            const now = await cdp.evaluate(SNAPSHOT)
            if (now.error) throw new Error(`the packaged app refused to start Claude: ${now.error}`)
            // ⚑ The TURN failing ends the step, with every warn and error notice quoted — not a guess
            // at the provider's wording (680's review: `model_not_found` is said in the provider's own
            // sentence since R28b), and not the first warning either: the first live run met *"claude
            // is approaching its rate limit (seven_day)"*, which is a warning about the account while
            // the model was already answering. A refused turn closes FAILED since 680.
            const refused = await cdp.evaluate(
              `const said = [...document.querySelectorAll('[data-cy="notice-warn"], [data-cy="notice-error"]')].map((el) => el.textContent.trim()); return said.some((text) => text.startsWith('turn failed')) ? said.join(' | ') : null`,
            )
            if (refused) throw new Error(`the provider refused the model: ${refused}`)
            return /FLOOR/i.test(now.assistant) ? now : null
          },
          TURN_BUDGET_MS,
        )
        return claims(
          asserted(
            `reply "${replied.assistant.slice(0, 60)}" — Claude Code ${claudeFound.version} ran ` +
              'claude-opus-5-5[1m] at max effort',
          ),
        )
      },
    )

    // Everything above is done with the app; the last check needs a different one.
    cdp.close()
    app.stop()
    await waitFor(
      'the packaged app to exit',
      async () => {
        try {
          await fetch(`http://127.0.0.1:${app.port}/json/version`)
          return false
        } catch {
          return true
        }
      },
      30_000,
    )

    await step('5 a missing binary is an ACTIONABLE error, not a raw ENOENT', async () => {
      // The packaged failure path, exercised in the packaged layout: move the binary aside and ask
      // the built app to start Codex. `CodexUnavailableError`'s message must reach the surface.
      //
      // 🔴 **Through the FRONT DOOR since `420`.** It used to write `provider-select` to `codex`
      // and `cwd-input` to this run's scratch directory; `417` deleted both fields.
      // ⚑ **738 · and it picks Codex on the front door again** (`680` F12, red since `433`): the
      // front door runs BroBot on its identity's provider once that row exists, and step `3`'s
      // launch seeds it on Claude (`SEEDED_PROVIDERS`) — so this sent an ordinary Claude turn and
      // waited 60 s for a Codex error no launch could raise. `435` put `provider-select` back, and
      // what a person picks there is the first term `providerForALaunch` ranks.
      // ⚑ **UI-012 (R-3) folded that select into the one model picker** — picking a Codex model IS
      // choosing Codex — so the step picks one there: {@link pickACodexModelByHand}.
      renameSync(PACKAGED_CODEX, `${PACKAGED_CODEX}.moved`)
      renamed = true

      const broken = await launchPackagedApp()
      try {
        const brokenCdp = await Cdp.attach(broken.port)
        await openLauncher(brokenCdp)
        await pickACodexModelByHand(brokenCdp)
        await startSession(brokenCdp, { prompt: 'this should never reach a provider' })

        const shown = await waitFor(
          'the app to explain itself',
          async () => {
            const now = await brokenCdp.evaluate(SNAPSHOT)
            return now.error ? now.error : null
          },
          60_000,
        )
        if (/ENOENT/i.test(shown)) {
          throw new Error(`the packaged app leaked a raw spawn failure: ${shown}`)
        }
        if (
          !/Codex isn't available/i.test(shown) ||
          !/Reinstall BroCrew to restore it/.test(shown)
        ) {
          throw new Error(`the message is not the actionable one: ${shown}`)
        }
        brokenCdp.close()
        return `"${shown}"`
      } finally {
        broken.stop()
      }
    })
  } finally {
    restoreArtifact()
    app?.stop()
    // ⚠️ **Two children, and only ONE of them needs this** — said out loud because a loop over both
    // reads as though the reason were shared. The CODEX child spawns itself detached
    // (codex-transport does this deliberately), so it is not in the app's process group and
    // outlives the SIGTERM above; that is the leak this exists for. The CLAUDE child is in the
    // group (233 spawns it without `detached`), so `app.stop()` already reached it, and its entry
    // here is a belt against a step that throws between the turn and the stop.
    //
    // Both are reaped only after re-confirming the pid is still the binary this run observed — a
    // recycled pid must never be something this script kills.
    for (const [pid, binary] of [
      [codexPid, PACKAGED_CODEX],
      [claudePid, claudeFound?.path ?? null],
    ]) {
      if (pid === null || binary === null) continue
      try {
        const still = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        if (still.startsWith(binary)) process.kill(pid, 'SIGTERM')
      } catch {
        // already gone, which is the outcome we wanted
      }
    }
  }

  return reportRun()
}

/**
 * The run's report — **one function, because there are two exits** (`420`).
 *
 * ⚠️ The `catch` below printed a headline of its own, so every line this dispatch adds would
 * otherwise have to be written twice, and the copy that rotted first would be the one that only
 * ever runs on a FAILED run — the runs whose report matters most.
 *
 * @returns the number of failed steps, so the caller owns the exit code.
 */
function reportRun() {
  // ⚠️ **No `notReached` count, and that is a refusal rather than an omission** (`420` §4, H).
  // `summarize` takes one and `ui-live-smoke.mjs` supplies it from `scripts/lib/step-census.mjs`
  // — a list of every step token that file OFFERS, so the steps a run never got to can be
  // subtracted from the steps that produced a row. ⛔ **There is no census for this script**, and
  // the only number computable from `results` alone is zero by construction: a run that aborts
  // stops calling `step()` and its later tokens leave no trace at all. A count nobody can compute
  // is not invented; what an aborted run leaves instead is the missing rows themselves and a
  // non-zero exit code.
  const summary = summarize(results, { evidence: EVIDENCE })
  console.log(`\n${summary.line}`)
  for (const line of summary.blanks) console.log(`  ${line}`)
  // ⛔ **Named, not merely counted** (`420` §4): *"An instrument may lose a step. It may not lose a
  // step silently."* The Claude steps answer `notPerformed(…)` on a computer with no Claude Code
  // installed, and `4d` on one whose Claude Code is older than its model; this loop is where a run
  // says which, and why, in the app's own words.
  for (const line of summary.unperformed) console.log(`  ${line}`)
  // 🔴 **Which door each conversation came through** (`420` §3/§4). ⛔ The front-door count is the
  // one that can fall silently: a step moved to `placeSession` is still green, and an instrument
  // in which nothing goes through the surface a person uses has stopped measuring the product's
  // only way in. ⚠️ **The interim door is an interim** — every line below is work waiting on the
  // roster (HO-022 §4) and on a surface that can place a session (`417` §11.2).
  console.log(
    `  doors: ${startedThroughTheFrontDoor.length} through the front door · ` +
      `${placedThroughTheInterimDoor.length} placed through the interim door`,
  )
  for (const line of placedThroughTheInterimDoor) console.log(`    placed: ${line}`)
  // ⛔ **And WHICH claims went unreached** (206 H1). ⚠️ **This script could not print them at all
  // until `420`**: `record` pushed no `claims` array, so both counters in the headline were 0 on
  // every run it has ever made — a step leaving one of its claims unreached looked exactly like a
  // step that reached everything.
  if (summary.blankClaims.length > 0) {
    console.log(
      `  ${summary.claimsTotal - summary.claimsAsserted} of ${summary.claimsTotal} claim(s) not reached:`,
    )
    for (const claim of summary.blankClaims) console.log(`    ${claim}`)
  }
  return summary.failed
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`)
    reportRun()
    process.exit(1)
  })
