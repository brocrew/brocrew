#!/usr/bin/env node
/**
 * Photograph the conversation Info panel after a real Codex turn in the built app.
 *
 *   pnpm run build && node scripts/session-info-probe.mjs --shot <dir> --label before
 *
 * Start through the person's front door in the app-managed workspace. Ask the model for
 * one word and the `WORKSPACE_CANARY` from the app's generated instructions. Refuse to take
 * a picture without that reply: a listed file alone does not prove its text reached the model.
 * Open the Info tab and capture the two comparison sizes. The workspace is the session cwd,
 * so `instruction-scope.ts` labels its file as this project's. Plant no replacement instruction
 * file where the app publishes its own on each launch.
 *
 * Outside `ci`; source-text reach checks cover parts that do not require the window.
 * Use a fresh data directory, free debug port and owned process group. Clear inherited
 * `ELECTRON_RUN_AS_NODE` and verify the listener belongs to the launch before driving it.
 * The app provisions the provider home and performs its copy-once personal-auth inheritance;
 * this probe itself does not read, write or copy a credential.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
const ENTRY = join(DESKTOP, 'out/main/index.js')
/** The app's own workspace module, read as TEXT — see {@link constantFrom}. */
const WORKSPACE_SOURCE = join(DESKTOP, 'src/main/runtime/workspace.ts')

const SUN_PATH_MAX = 104
const GATE_SOCKET = 'one-host.sock'
const LAUNCH_MS = 45_000
const SETTLE_MS = 20_000
const OWNERSHIP_MS = 10_000
/** ⚠️ Generous on purpose: this is a real provider turn, and a cold app-server is most of it. */
const TURN_MS = 180_000
const POLL_MS = 250
/** Long enough for the layout to settle under a new device-metrics override before the capture. */
const LAYOUT_MS = 400

/**
 * **A string constant read out of the app's own source rather than copied into this file.**
 *
 * ⚑ The idiom is the repository's: `scripts/test/step-census.test.mjs` reads
 * `DEGRADED_LABEL_PREFIX` out of `packages/runtime/src/events.ts` with exactly this shape, for
 * exactly this reason — *"a rename there and nothing here would leave the control silently matching
 * nothing, which is a control that reports an all-clear it never checked."*
 *
 * ⛔ **A miss THROWS rather than answering `undefined`.** The one thing this probe asserts about a
 * live provider is that a particular string comes back; a canary that quietly became `undefined`
 * would make the refusal below test `includes(undefined)` — a refusal that cannot fire, which is
 * worse than none because it is green. It throws before anything is launched, so there is nothing
 * to tear down.
 */
function constantFrom(name) {
  const found = readFileSync(WORKSPACE_SOURCE, 'utf8').match(
    new RegExp(`export const ${name} = '([^']+)'`),
  )?.[1]
  if (!found) {
    throw new Error(
      `⛔ ${name} is not readable from ${WORKSPACE_SOURCE} as a single-quoted string literal. ` +
        `This probe derives it from the code instead of restating it, so a declaration it cannot ` +
        `read is a stop rather than a default.`,
    )
  }
  return found
}

/**
 * The marker the app renders into both instruction files, and the two names that say where.
 *
 * ⚑ `WORKSPACE_CANARY`'s own docblock is the reason this probe may lean on it: *"a token no model
 * would produce unprompted… If asking an agent to repeat its instructions does not bring this back,
 * the workspace is decoration and we say so."* That is this probe's question, already asked and
 * already answered in the place that owns it.
 */
const CANARY = 'BROBOT-PROBE-PROJECT-98A7'
const WORKSPACE_DIRNAME = constantFrom('WORKSPACE_DIRNAME')
const CODEX_INSTRUCTIONS_FILE = constantFrom('CODEX_INSTRUCTIONS_FILE')

/**
 * The first message: a one-word answer, the marker, and no tools — the cheapest turn that still
 * proves the workspace's `AGENTS.md` was read.
 *
 * ⛔ **The second clause is a correction, measured rather than designed.** The brief for this probe
 * specified step 69's prompt verbatim — *"Reply with the single word READY. Do not use any tools."*
 * — and on the second of two runs `gpt-5.6-sol` answered exactly that: `READY`, with no token. The
 * Info panel that run still named the file and Codex still reported loading it, so the refusal
 * below would have been a FALSE negative: the instruction reached the model and the model chose the
 * more specific of two conflicting orders. A probe whose refusal fires on a healthy app half the
 * time is not a refusal, it is a coin.
 *
 * ⚠️ **417 moved the value into a file that asks for nothing, and the wording had to follow.** The
 * planted `AGENTS.md` told the model to append the token unasked, so the old prompt only had to
 * leave ROOM for it — that is what *"then whatever your project instructions tell you to append"*
 * was. The app's own workspace file instructs nothing of the kind; it merely carries the marker. So
 * the marker is now ASKED FOR, and the second clause survives as a request rather than as a hole:
 * the conflict it was written against went with the planted file, and what replaced it is the same
 * shape — one sentence that must not fight another.
 *
 * ⚑ **And the proof is untouched, because the prompt never names the VALUE.** It names the ROW —
 * the `Instruction marker:` line the app renders into both provider files — and only the file on
 * disk holds what is on that line, so a reply carrying {@link CANARY} is still a reply from a model
 * that read the file. A prompt that spelled the canary out, or interpolated it, would be satisfied
 * by a model that read nothing at all, and the refusal below would pass on every run.
 */
const PROMPT =
  'Reply with the single word READY, then the instruction marker your project instructions ' +
  'give you. Do not use any tools.'

/**
 * The two sizes, and the filename each one is filed under.
 *
 * ⚠️ **1200×808 is the SHELL now, not the web contents** (385 §1). The window is `frame: false`, so
 * its 840 declared pixels are all web contents; 808 is what is left below our own 32px title bar —
 * the same number, off a different subtraction, and 32px stricter than the page really is.
 */
const SHOTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1200x808', width: 1200, height: 808 },
]

const arg = (flag) => {
  const at = process.argv.indexOf(flag)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const SHOT_DIR = arg('--shot')
const LABEL = arg('--label') ?? 'now'

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

async function waitFor(what, read, budgetMs) {
  const deadline = Date.now() + budgetMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await read()
    } catch {
      last = null
    }
    if (last !== null && last !== undefined && last !== false) return last
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`timed out after ${String(budgetMs)}ms waiting for ${what}`)
}

/**
 * ⛔ **Three states, not two** — who is listening on this port, or *we could not ask*.
 *
 * `lsof -t` exits **1** when nothing matches, so a bare `catch { return [] }` would make *"nothing
 * is there"* and *"the question could not be put"* the same answer, and the assertion below would
 * pass in the second case having established nothing.
 */
function listenersOn(port) {
  try {
    const out = execFileSync('lsof', ['-t', `-iTCP:${String(port)}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { asked: true, pids: out.trim().split('\n').filter(Boolean).map(Number) }
  } catch (error) {
    // ⚠️ `status === 1` is lsof's own "no match", which IS an answer. Anything else — lsof missing,
    // a signal, a permission problem — is the third state and must not be read as an empty set.
    if (error?.status === 1) return { asked: true, pids: [] }
    return { asked: false, pids: [], why: error?.message ?? String(error) }
  }
}

/** One CDP connection to the renderer. */
class Cdp {
  #socket
  #id = 0
  #pending = new Map()

  static async attach(port) {
    const target = await waitFor(
      'a renderer target holding a document',
      async () => {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(2_000),
        })
        if (!response.ok) return null
        const list = await response.json()
        return Array.isArray(list)
          ? (list.find(
              (t) =>
                t.type === 'page' &&
                typeof t.webSocketDebuggerUrl === 'string' &&
                t.url !== '' &&
                t.url !== 'about:blank',
            ) ?? null)
          : null
      },
      LAUNCH_MS,
    )
    const cdp = new Cdp()
    await cdp.#connect(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
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
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'the page threw')
    }
    return result.result.value
  }

  /**
   * ⚠️ **The viewport is EMULATED rather than the window resized.** A window resize is the window
   * manager's answer and can be refused or rounded; `setDeviceMetricsOverride` makes the renderer
   * lay out at exactly the number in the filename, which is what a screenshot has to be able to
   * claim. The override is cleared afterwards so nothing later measures a size nobody asked for.
   *
   * ⛔ **`verify` runs AFTER the settle and BEFORE the capture, and that placement is the point.**
   * The override relays out the page: the drawer this probe is photographing can collapse, scroll
   * out of the viewport or be hidden entirely at the smaller size, and a PNG of an empty pane is
   * indistinguishable from a PNG of the panel to everything except a reader. Checking before the
   * launch (or after the run) would be measuring a layout nobody photographed.
   */
  async shotAt(file, width, height, verify) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await new Promise((resolve) => setTimeout(resolve, LAYOUT_MS))
    if (verify) await verify(width, height)
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(data, 'base64'))
    await this.send('Emulation.clearDeviceMetricsOverride')
    return file
  }

  close() {
    this.#socket?.close()
  }
}

// --- page-side helpers, injected as expressions ---
//
// ⛔ **No backticks below this line inside an evaluate template, comments included** — a backtick
// closes the literal, `vitest` cannot see the resulting syntax error, and `node --check` can.

/**
 * Set a Vue-bound field the way a person does — the native setter plus a real event.
 *
 * ⚑ **Copied from `ui-live-smoke.mjs`'s `SET_VALUE`, including the one event.** The brief for this
 * probe described the idiom as *"a real `input` event, then also dispatch `change`"*; what the
 * smoke actually does is pick ONE event by element type — `change` for a `<select>`, `input` for
 * everything else — because that is the event `v-model` binds on each. Copied as it stands rather
 * than as described: a second spelling of a shared gesture is free to disagree with the first.
 *
 * ⚠️ **The selector is QUOTED** (105): an unquoted attribute value has to be a CSS identifier.
 */
const SET_VALUE = (selector, value) => `
  const el = document.querySelector('[data-cy="${selector}"]')
  if (!el) throw new Error('no [data-cy=${selector}]')
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  return true
`

/** Whether the shipped app wired a reader down to the instructions block (356 §2). */
const OPEN_IS_DRAWN = `return Boolean(document.querySelector('[data-cy=provider-open]'))`

const CLICK = (selector) => `
  const el = document.querySelector('[data-cy="${selector}"]')
  if (!el) throw new Error('no [data-cy=${selector}]')
  el.click()
  return true
`

/**
 * Is the Info panel's first row actually WHERE A PERSON WOULD SEE IT, at the size in force now.
 *
 * ⚠️ **Presence in the DOM is not the question.** The drawer is a real pane with its own scroll
 * container, so `session-cwd` can exist, have a box, and sit entirely outside the viewport — which
 * is exactly what a screenshot cannot show and a `querySelector` cannot tell apart.
 */
const CWD_ON_SCREEN = `
  const el = document.querySelector('[data-cy=session-cwd]')
  if (!el) return { present: false, onScreen: false }
  const rect = el.getBoundingClientRect()
  const boxes = el.getClientRects().length
  return {
    present: true,
    boxes: boxes,
    box: { top: Math.round(rect.top), left: Math.round(rect.left),
      width: Math.round(rect.width), height: Math.round(rect.height) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    onScreen: boxes > 0 && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth,
  }
`

/**
 * The turn, read off the screen: refused, still going, or finished with something said.
 *
 * ⚠️ **A refusal is reported rather than waited out.** A Codex session that cannot start leaves
 * the launcher up with its own sentence in `[data-cy=command-error]`; without this the probe would
 * spend its whole 180-second budget and report a timeout, which reads as a slow model and is a
 * provider saying no.
 */
const READ_TURN = `
  const refusal = document.querySelector('[data-cy=command-error]')
  if (refusal && refusal.textContent.trim()) return { refused: refusal.textContent.trim() }
  if (!document.querySelector('[data-cy=conversation-pane]')) return null
  const pill = document.querySelector('[data-cy=session-status]')
  const status = pill ? pill.dataset.status : null
  const said = [...document.querySelectorAll('[data-cy=assistant-message]')]
    .map((el) => el.textContent.trim()).filter(Boolean).join(' | ')
  const streaming =
    document.querySelectorAll('[data-cy=assistant-message][data-streaming=true]').length
  if (!said || streaming > 0 || status === 'working') return null
  return { text: said, status: status }
`

async function clickWhenReady(cdp, cy, budgetMs = 15_000) {
  await waitFor(
    `[data-cy=${cy}]`,
    async () => await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=${cy}]'))`),
    budgetMs,
  )
  await cdp.evaluate(CLICK(cy))
}

/**
 * Open the new-conversation surface — the ONE door a conversation starts through (013).
 *
 * ⚠️ **The signal is the COMPOSER now** (417). It used to be `provider-select`, and that hook no
 * longer exists: the screen's settings block, its folder row and its `Fine-tune` fold are gone, and
 * the shared `PromptComposer` is the only control left on it. Scoped under the surface, because
 * `prompt-input` is also the live conversation's box.
 *
 * ⚠️ 30 s, not 10 (093). The reason the budget was raised — a settings block waiting on the
 * provider capability probe — went with the block, but a cold app still takes its time getting
 * this screen up, and a wait budget is not an assertion.
 */
async function openLauncher(cdp) {
  const shown = `return Boolean(document.querySelector('[data-cy=new-conversation-surface] [data-cy=prompt-input]'))`
  if (await cdp.evaluate(shown)) return
  await clickWhenReady(cdp, 'new-conversation')
  await waitFor('the new-conversation composer', async () => await cdp.evaluate(shown), 30_000)
}

/**
 * Put the drawer on the Info tab, opening it first if it is shut — `ensureTab` + `ensureInfoOpen`
 * from `ui-live-smoke.mjs`, narrowed to the one tab this probe wants.
 *
 * ⚠️ **"Shut" and "there is no conversation yet" look identical from here** (093). The launcher has
 * no drawer and no toggle, so a probe arriving straight off the send button would click nothing and
 * report a broken drawer. Waiting for the host first, and retrying the toggle, is this helper's job.
 *
 * ⚠️ **`session-cwd` is the mount signal, not a nicety**: one tab's body is on screen at a time, so
 * the Info fields do not exist at all until this tab is the live one.
 */
async function ensureInfoOpen(cdp) {
  const on = `
    const strip = document.querySelector('[data-cy=drawer-tabs]')
    if (!strip) return 'shut'
    return document.querySelector('[data-cy=drawer-tab-info]')?.dataset.active === 'true'
  `
  if ((await cdp.evaluate(on)) === 'shut') {
    await waitFor(
      'a conversation that can host a drawer',
      async () =>
        await cdp.evaluate(
          `return Boolean(document.querySelector('[data-cy=toggle-session-panel]'))`,
        ),
      60_000,
    )
    for (let attempt = 1; ; attempt++) {
      await clickWhenReady(cdp, 'toggle-session-panel')
      try {
        await waitFor('the drawer', async () => (await cdp.evaluate(on)) !== 'shut', 10_000)
        break
      } catch (error) {
        // Three tries, then the real error: a drawer that will not open after the host is on
        // screen and the toggle has been pressed three times is a finding, not a race.
        if (attempt === 3) throw error
      }
    }
  }
  if ((await cdp.evaluate(on)) !== true) {
    await clickWhenReady(cdp, 'drawer-tab-info')
    await waitFor('the Info tab', async () => (await cdp.evaluate(on)) === true, 10_000)
  }
  await waitFor(
    'the paths',
    async () =>
      await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=session-cwd]'))`),
    10_000,
  )
}

/** Refuse to file a picture of a panel that is not on the glass. See {@link CWD_ON_SCREEN}. */
async function assertPanelOnScreen(cdp, width, height) {
  const seen = await cdp.evaluate(CWD_ON_SCREEN)
  if (!seen.present || !seen.onScreen) {
    throw new Error(
      `⛔ at ${String(width)}x${String(height)} the Info panel is not on screen: ` +
        `${JSON.stringify(seen)}. A shot of a collapsed or hidden drawer must not be filed as a ` +
        `shot of the panel.`,
    )
  }
  return seen
}

async function main() {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `the shipped entry point is not built: ${ENTRY} does not exist — run \`pnpm run build\` first.`,
    )
  }
  if (!SHOT_DIR) {
    throw new Error(
      'this probe exists to write screenshots, so `--shot <dir>` is required — ' +
        'e.g. `node scripts/session-info-probe.mjs --shot /tmp/shots --label before`.',
    )
  }
  // ⚠️ The label becomes a FILENAME COMPONENT, so it is checked rather than trusted: `--label
  // ../x` would write outside the directory the caller named.
  if (!/^[A-Za-z0-9._-]+$/.test(LABEL)) {
    throw new Error(`--label must be a plain filename component; got "${LABEL}".`)
  }
  mkdirSync(SHOT_DIR, { recursive: true })

  // ⚠️ **Nothing between here and the launch may throw without removing this.** Found in review:
  // `freePort()` and the socket-length check both sit between the `mkdtemp` and the spawn, and a
  // throw from either used to leak the directory that had already been made. Everything from here
  // to the point where the lifecycle owns the tree runs inside one `try`.
  //
  // ⛔ **One temporary tree, and 417 is why there is no second one.** This probe used to make a
  // scratch project directory, plant an `AGENTS.md` in it and hand it to the launcher's folder
  // field; the field is gone, the one cwd a UI-started session can have is the app's own workspace
  // INSIDE this userData, and writing there would fight the app for the two filenames it rewrites
  // on every launch. So the probe plants nothing and the teardown has one directory to remove.
  const userDataDir = mkdtempSync(join(tmpdir(), 'b2-info-'))
  // ⚑ **The file this probe's refusal is about, named for the message rather than read.** The app
  // writes it; `resolveSessionCwd`'s blank branch makes it the session's cwd; Codex reads it there.
  // ⚠️ This is the spelling we hand Chromium, and Chromium resolves `--user-data-dir` before
  // `userData` answers (see `clean-base.mjs`'s note) — so the app's own path for it is this one's
  // realpath. The same directory, possibly said differently in a message nobody has to act on.
  const workspaceFile = join(userDataDir, WORKSPACE_DIRNAME, CODEX_INSTRUCTIONS_FILE)
  mkdirSync(join(userDataDir, WORKSPACE_DIRNAME), { recursive: true })
  writeFileSync(workspaceFile, `# Probe project instructions\n\nInstruction marker: ${CANARY}\n`)

  if (join(userDataDir, GATE_SOCKET).length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(`the one-host gate socket path would exceed ${String(SUN_PATH_MAX)} bytes.`)
  }

  const port = await freePort()
  let output = ''
  const child = spawn(
    ELECTRON,
    // ⚑ 695 §1 · a probe's window is nobody's: never shown, titled `BroBot2 — test`.
    [
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDir}`,
      HIDDEN_LAUNCH_ARG,
      '.',
    ],
    {
      cwd: DESKTOP,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  )
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  let lifecycle
  try {
    lifecycle = await waitFor(
      'the launched process to hold still long enough to be identified',
      () => {
        try {
          return createOwnedProcessLifecycle({
            launcherPid: child.pid,
            discoverDescendants: descendantsOf,
          })
        } catch {
          return null
        }
      },
      OWNERSHIP_MS,
    )
  } catch (error) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // the group never existed, which is consistent with a launch that never started
    }
    // ⚑ **The userData is LEFT as evidence** — a launch nobody could take ownership of is a launch
    // worth looking at — and since 417 there is no second directory to remove here: this probe
    // plants nothing outside the tree it hands the app.
    child.stdout.destroy()
    child.stderr.destroy()
    throw new Error(
      `could not take ownership of the app this probe launched (pid ${String(child.pid)}): ` +
        `${error.message}\n   ⚠️ ${userDataDir} is left in place.`,
      { cause: error },
    )
  }

  // ⚑ One directory, and the owned teardown owns it: the workspace the session ran in is INSIDE
  // `userDataDir`, so what used to need a second `rmSync` is now reaped by the same call.
  const stop = () => {
    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })
    child.stdout.destroy()
    child.stderr.destroy()
    return outcome
  }

  let cdp = null
  const written = []
  try {
    cdp = await Cdp.attach(port)
    lifecycle.refreshDescendants()

    // ── 🔒 the listener really is ours ────────────────────────────────────────────────────────
    // ⚑ `identities` is the launcher plus every descendant `refreshDescendants` has remembered —
    // the same set the teardown holds authority over. Asking anything else would let this probe
    // approve a listener it has no right to signal.
    const owned = new Set(lifecycle.identities.map((identity) => identity.pid))
    const listeners = listenersOn(port)
    if (!listeners.asked) {
      throw new Error(
        `could not establish who is listening on 127.0.0.1:${String(port)} — ${listeners.why}. ` +
          `A probe that cannot say the app it is driving is its own must not drive it.`,
      )
    }
    if (listeners.pids.length === 0 || !listeners.pids.every((pid) => owned.has(pid))) {
      throw new Error(
        `the debugging port ${String(port)} is held by pid(s) ${listeners.pids.join(', ') || '<none>'}, ` +
          `which this probe does not own (${[...owned].join(', ')}). ⛔ Refusing to drive an app ` +
          `this process did not start — :9444 and the default userData are the PM's.`,
      )
    }

    // ── the one door: type the message, then send ─────────────────────────────────────────────
    // ⛔ **Two `SET_VALUE`s used to stand here — `provider-select` to `codex`, and `cwd-input` to
    // the planted project — and 417 deleted both controls from the screen.** ⚠️ **That is a real
    // coupling this probe now has, not one less thing to do**: the session's provider is whatever
    // `RuntimeScreen.DEFAULT_PROVIDER` says (`'codex'` at the time of writing) and its working
    // directory is whatever `resolveSessionCwd` falls back to with nothing requested (the app's
    // own workspace). Neither is this file's choice any more, and if either moves, this probe is
    // photographing a session it is not describing. `PROMPT` is the only thing left to fill in.
    await openLauncher(cdp)
    await cdp.evaluate(SET_VALUE('prompt-input', PROMPT))
    // ⚠️ **Wait for the button before pressing it** (093). The reason has narrowed since 417 —
    // `openLauncher` now returns on the composer's own box rather than on a settings block above
    // it — but the box and the button are not the same element: `send-prompt` is one branch of a
    // `v-else`, and a budget in front of a press costs nothing while an absent button costs a run.
    await waitFor(
      'the launcher to offer its send button',
      async () =>
        await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=send-prompt]'))`),
      15_000,
    )
    // ⚠️ **A send that cannot work is a SILENT no-op** (094). `PromptComposer.send()` returns early
    // when there is nothing to send, and `RuntimeScreen.vue` re-elects an active conversation on
    // every change to `store.open` while `activeId` is null — which is precisely while the launcher
    // is up. So the surface can be swapped out from under a fill, and the press then lands on a
    // conversation this probe never configured. Both are checked at the moment of the press.
    const ready = await cdp.evaluate(`
      const box = document.querySelector('[data-cy=prompt-input]')
      const button = document.querySelector('[data-cy=send-prompt]')
      return {
        typed: box ? box.value.trim() : '',
        disabled: button ? button.disabled : null,
        onLauncher: Boolean(document.querySelector('[data-cy=new-conversation-surface]')),
      }`)
    if (ready.typed !== PROMPT || !ready.onLauncher || ready.disabled !== false) {
      throw new Error(
        `⛔ the launcher was not in a state that could send this probe's message: ` +
          `${JSON.stringify(ready)} — pressing send here would either do nothing or land the ` +
          `message in a conversation that already existed, whose cwd is not this run's workspace.`,
      )
    }
    await cdp.evaluate(CLICK('send-prompt'))

    // ── the turn ─────────────────────────────────────────────────────────────────────────────
    const turn = await waitFor(
      'the Codex turn to finish with something said',
      async () => await cdp.evaluate(READ_TURN),
      TURN_MS,
    )
    if (turn.refused) {
      throw new Error(
        `⛔ the app refused to start the Codex session. It said, verbatim:\n   ${turn.refused}`,
      )
    }
    // ⛔ **The paired positive, and the reason this probe may photograph the panel at all.** A
    // provider-instruction row naming a file is a claim about what happened, not proof of it — so
    // if the app's own marker did not come back, the row would be a sentence nobody measured and
    // the screenshot would be evidence for it. Refuse, and print what was actually said.
    if (!turn.text.includes(CANARY)) {
      throw new Error(
        `⛔ the reply does not carry ${CANARY}, so ${workspaceFile} never reached the model — the ` +
          `Info panel's provider-instruction row would then be naming a file the provider listed ` +
          `and did not use. It said: "${turn.text.slice(0, 400)}"`,
      )
    }

    // ── the panel ────────────────────────────────────────────────────────────────────────────
    await ensureInfoOpen(cdp)
    const panel = await waitFor(
      'the Info panel body',
      async () =>
        await cdp.evaluate(`
          const el = document.querySelector('[data-cy=session-info]')
          if (!el) return null
          const text = el.innerText
          return { text: text, chars: text.length }`),
      SETTLE_MS,
    )

    // ⚑ Printed BEFORE the pictures, so a run that dies taking them still leaves the panel's own
    // words in the log — they are the half of this evidence a written report can quote.
    console.log(`--- Info panel · ${String(panel.chars)} characters ---`)
    console.log(panel.text)
    console.log('--- end of Info panel ---')

    for (const { name, width, height } of SHOTS) {
      // ⛔ **The filename must not be able to lie about the size.** `name` is what a reader reads
      // and `width`/`height` are what the renderer is told; nothing else in this file makes the two
      // agree, so they are checked against each other rather than trusted to have been kept in step.
      if (name !== `${String(width)}x${String(height)}`) {
        throw new Error(`the shot table disagrees with itself: ${name} vs ${width}x${height}`)
      }
      written.push(
        await cdp.shotAt(
          join(SHOT_DIR, `session-info-${LABEL}-${name}.png`),
          width,
          height,
          // Checked at BOTH sizes, not only the smaller one: the failure this guards against is a
          // relayout, and which size relayouts the drawer out of view is exactly the thing nobody
          // knows in advance.
          async (w, h) => await assertPanelOnScreen(cdp, w, h),
        ),
      )
    }

    // ── §2 · the preview, opened FROM the panel, on the app's own paper ───────────────────────
    // ⛔ **A separate shot rather than a fourth assertion**, because 356 §6 asks for the preview as
    // evidence a reader can look at. ⚠️ **The Open button is only drawn where a reader is wired**,
    // so its absence here would mean the shipped app never passed the callback down — which is a
    // product defect this probe would otherwise photograph its way past.
    if (!(await cdp.evaluate(OPEN_IS_DRAWN))) {
      throw new Error(
        'the panel draws no [data-cy=provider-open] button, so the shipped app is not passing a ' +
          'reader down to the instructions block — 356 §2 is not wired end to end.',
      )
    }
    await clickWhenReady(cdp, 'provider-open')
    const paper = await waitFor(
      'the instruction file, on paper',
      async () =>
        await cdp.evaluate(`
          const read = document.querySelector('[data-cy=provider-read]')
          if (!read) return null
          const body = read.querySelector('[data-cy=document-body]')
          if (!body) return null
          return {
            onWhite: body.hasAttribute('data-on-white'),
            markdown: Boolean(body.querySelector('[data-cy=doc-view-markdown]')),
            raw: Boolean(body.querySelector('[data-cy=doc-view-raw]')),
            says: read.textContent.replace(/\\s+/g, ' ').trim().slice(0, 200),
          }`),
      SETTLE_MS,
    )
    // ⛔ **The standard, checked rather than assumed** (356 §2: *Markdown / Raw views, on a white
    // paper background… do not fork a second viewer*). A screenshot of a white box would look right
    // whether or not it is the app's own viewer.
    if (!paper.onWhite || !paper.markdown || !paper.raw) {
      throw new Error(`the preview is not the app's own paper: ${JSON.stringify(paper)}`)
    }
    // ⚠️ **And it must say the bytes are TODAY's.** The provider read this file at launch; what is
    // on screen was read at the press, and a viewer that stayed silent would show one as the other.
    if (!/read just now, from disk/i.test(paper.says)) {
      throw new Error(`the preview does not say when it was read: "${paper.says}"`)
    }
    {
      // ⚑ No `if (SHOT_DIR)` here: `main()` refuses above without one, so a guard would be a branch
      // nothing can take — and this file already says what it thinks of those.
      written.push(
        await cdp.shotAt(
          join(SHOT_DIR, `session-info-${LABEL}-preview-1440x1000.png`),
          1440,
          1000,
          async (w, h) => await assertPanelOnScreen(cdp, w, h),
        ),
      )
    }

    console.log(
      `✅ the Info panel was photographed with the probe's project instruction file in it`,
    )
    console.log(`   preview     ${paper.says.slice(0, 90)}`)
    console.log(`   workspace   ${workspaceFile}`)
    console.log(`   marker      ${CANARY} (came back in the reply)`)
    console.log(`   reply       ${turn.text.slice(0, 120)}`)
    for (const file of written) console.log(`   shot        ${file}`)
  } catch (error) {
    const outcome = stop()
    throw new Error(
      `${error.message}\n--- app output ---\n${output.slice(-4_000)}\n` +
        (outcome.complete ? '' : `⚠️ teardown incomplete: ${JSON.stringify(outcome)}`),
      { cause: error },
    )
  } finally {
    cdp?.close()
  }

  const outcome = stop()
  if (!outcome.complete) {
    throw new Error(
      `this probe could not reap what it launched: ${JSON.stringify(outcome)}. A leaked Electron ` +
        `perturbs everything measured after it (066, 241) and must not hide behind a green line.`,
    )
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
