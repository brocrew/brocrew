#!/usr/bin/env node
/**
 * Photograph the conversation Info panel after a real Codex turn in the built app.
 *
 *   pnpm run build && node scripts/session-info-probe.mjs --shot <dir> --label before
 *
 * Starts through the front door in the app-managed workspace, asks for one word plus the
 * `WORKSPACE_CANARY` from the app's generated instructions, and refuses to take a picture without
 * that reply: a listed file alone does not prove its text reached the model. The workspace is the
 * session cwd, so `instruction-scope.ts` labels its file as this project's; plant no replacement
 * instruction file where the app publishes its own on each launch.
 *
 * Outside `ci`. Uses a fresh data directory, free debug port and owned process group, clears
 * inherited `ELECTRON_RUN_AS_NODE`, and verifies the listener belongs to the launch before driving
 * it. The app provisions the provider home; this probe never reads, writes or copies a credential.
 */
import { freePort } from './lib/free-port.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchForCdp, RendererCdp, listenersOn } from './lib/renderer-cdp.mjs'
import { checkProbeGatePath } from './lib/smoke-run.mjs'
import { launchedProcessLifecycle, tearDownAndRemove } from './lib/owned-teardown.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
const ENTRY = join(DESKTOP, 'out/main/index.js')
/** The app's own workspace module, read as TEXT — see {@link constantFrom}. */
const WORKSPACE_SOURCE = join(DESKTOP, 'src/main/runtime/workspace.ts')
const CODEX_LAYOUT_SOURCE = join(DESKTOP, 'src/main/providers/codex/layout.mjs')

const LAUNCH_MS = 45_000
const SETTLE_MS = 20_000
const OWNERSHIP_MS = 10_000
/** Generous on purpose: this is a real provider turn, and a cold app-server is most of it. */
const TURN_MS = 180_000
const POLL_MS = 250
/** Long enough for the layout to settle under a new device-metrics override before the capture. */
const LAYOUT_MS = 400

/**
 * A string constant read out of the app's own source rather than copied into this file.
 *
 * A miss throws rather than answering `undefined`: a canary that quietly became `undefined` would
 * turn the refusal below into `includes(undefined)`, which cannot fire. It throws before anything
 * is launched, so there is nothing to tear down.
 */
function constantFrom(name) {
  const source = name === 'CODEX_INSTRUCTIONS_FILE' ? CODEX_LAYOUT_SOURCE : WORKSPACE_SOURCE
  const found = readFileSync(source, 'utf8').match(
    new RegExp(`export const ${name} = '([^']+)'`),
  )?.[1]
  if (!found) {
    throw new Error(
      `⛔ ${name} is not readable from ${source} as a single-quoted string literal. ` +
        `This probe derives it from the code instead of restating it, so a declaration it cannot ` +
        `read is a stop rather than a default.`,
    )
  }
  return found
}

/**
 * The marker the app renders into both instruction files, and the two names that say where.
 * `WORKSPACE_CANARY`'s own docblock already asks this probe's question: if asking an agent to repeat
 * its instructions does not bring the token back, the workspace is decoration.
 */
const CANARY = 'BROBOT-PROBE-PROJECT-98A7'
const WORKSPACE_DIRNAME = constantFrom('WORKSPACE_DIRNAME')
const CODEX_INSTRUCTIONS_FILE = constantFrom('CODEX_INSTRUCTIONS_FILE')

/**
 * The first message: a one-word answer, the marker, and no tools — the cheapest turn that still
 * proves the workspace's `AGENTS.md` was read.
 *
 * The second clause exists because a bare "reply with the single word READY" was answered exactly
 * that, with no token, even though the file was loaded; the refusal would have been a false
 * negative on a healthy app. The marker is asked for, since the app's workspace file carries it but
 * instructs nothing.
 *
 * The prompt names the ROW (the `Instruction marker:` line the app renders into both provider
 * files), never the VALUE, so a reply carrying {@link CANARY} still proves the model read the file.
 * Spelling the canary out would let a model that read nothing satisfy the refusal below.
 */
const PROMPT =
  'Reply with the single word READY, then the instruction marker your project instructions ' +
  'give you. Do not use any tools.'

/**
 * The two sizes, and the filename each one is filed under.
 *
 * 1200x808 is the shell size: the window is `frame: false`, so its 840 declared pixels are all web
 * contents; 808 is what is left below our own 32px title bar.
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
 * The viewport is EMULATED rather than the window resized: a window resize can be refused or
 * rounded, while `setDeviceMetricsOverride` lays the renderer out at exactly the number in the
 * filename. The override is cleared afterwards.
 *
 * `verify` runs after the settle and before the capture, on purpose: the override relays out the
 * page, and the drawer can collapse or scroll out of view at the smaller size, so a PNG of an empty
 * pane would look the same as one of the panel.
 */
async function shotAt(cdp, file, width, height, verify) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await new Promise((resolve) => setTimeout(resolve, LAYOUT_MS))
  if (verify) await verify(width, height)
  await cdp.shot(file)
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  return file
}

// --- page-side helpers, injected as expressions ---
//
// No backticks below this line inside an evaluate template, comments included: a backtick
// closes the literal, `vitest` cannot see the resulting syntax error, and `node --check` can.

/**
 * Set a Vue-bound field the way a person does — the native setter plus a real event.
 *
 * Copied from `ui-live-smoke.mjs`'s `SET_VALUE`, including its choice of ONE event by element type:
 * `change` for a `<select>`, `input` for everything else, since that is what `v-model` binds on
 * each. The selector is quoted, because an unquoted attribute value has to be a CSS identifier.
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

/** Whether the shipped app wired a reader down to the instructions block. */
const OPEN_IS_DRAWN = `return Boolean(document.querySelector('[data-cy=provider-open]'))`

const CLICK = (selector) => `
  const el = document.querySelector('[data-cy="${selector}"]')
  if (!el) throw new Error('no [data-cy=${selector}]')
  el.click()
  return true
`

/**
 * Is the Info panel's first row on screen where a person would see it, at the size in force now.
 * Presence in the DOM is not enough: the drawer has its own scroll container, so `session-cwd` can
 * exist and sit entirely outside the viewport.
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
 * A refusal is reported rather than waited out: a Codex session that cannot start leaves the
 * launcher up with its own sentence in `[data-cy=command-error]`, and waiting the whole 180 seconds
 * would read as a slow model.
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
 * "Shut" and "there is no conversation yet" look identical from here: the launcher has no drawer
 * and no toggle, so this waits for the host first and retries the toggle. `session-cwd` is the
 * mount signal, because only one tab's body is on screen at a time.
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
        // Three tries, then the real error: a drawer that will not open after the host is on screen
        // and the toggle has been pressed three times is a finding, not a race.
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
  // The label becomes a FILENAME COMPONENT, so it is checked rather than trusted: `--label
  // ../x` would write outside the directory the caller named.
  if (!/^[A-Za-z0-9._-]+$/.test(LABEL)) {
    throw new Error(`--label must be a plain filename component; got "${LABEL}".`)
  }
  mkdirSync(SHOT_DIR, { recursive: true })

  // Nothing between here and the launch may throw without removing this: `freePort()` and the
  // socket-length check sit between the `mkdtemp` and the spawn, so everything up to the point where
  // the lifecycle owns the tree runs inside one `try`.
  //
  // This is the only temporary tree. The session's cwd is the app's own workspace INSIDE this
  // userData, and planting files there would fight the app for the two filenames it rewrites on every
  // launch, so the probe plants nothing and teardown has one directory to remove.
  const userDataDir = mkdtempSync(join(tmpdir(), 'b2-info-'))
  // The file this probe's refusal is about, named for the message rather than read. The app writes
  // it; `resolveSessionCwd`'s blank branch makes it the session's cwd; Codex reads it there.
  // This is the spelling we hand Chromium, and Chromium resolves `--user-data-dir` before
  // `userData` answers (see `clean-base.mjs`), so the app's own path is this one's realpath.
  const workspaceFile = join(userDataDir, WORKSPACE_DIRNAME, CODEX_INSTRUCTIONS_FILE)
  mkdirSync(join(userDataDir, WORKSPACE_DIRNAME), { recursive: true })
  writeFileSync(workspaceFile, `# Probe project instructions\n\nInstruction marker: ${CANARY}\n`)

  checkProbeGatePath(userDataDir)

  const port = await freePort()
  const launch = launchForCdp(
    ELECTRON,
    // A probe's window is nobody's: never shown, titled `BroBot2 — test`.
    [
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDir}`,
      HIDDEN_LAUNCH_ARG,
      '.',
    ],
    DESKTOP,
  )
  const { child } = launch

  let lifecycle
  try {
    lifecycle = await waitFor(
      'the launched process to hold still long enough to be identified',
      () => launchedProcessLifecycle(child.pid),
      OWNERSHIP_MS,
    )
  } catch (error) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // the group never existed, which is consistent with a launch that never started
    }
    // The userData is LEFT as evidence: a launch nobody could take ownership of is worth looking at.
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
    cdp = await RendererCdp.attach(port, { launchMs: LAUNCH_MS, pollMs: POLL_MS })
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
    // Wait for the button before pressing it: `openLauncher` returns on the composer's own box, but
    // `send-prompt` is one branch of a `v-else`, and a wait costs nothing while an absent button
    // costs a run.
    await waitFor(
      'the launcher to offer its send button',
      async () =>
        await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=send-prompt]'))`),
      15_000,
    )
    // A send that cannot work is a SILENT no-op: `PromptComposer.send()` returns early when there is
    // nothing to send, and `RuntimeScreen.vue` re-elects an active conversation on every change to
    // `store.open` while `activeId` is null, which is exactly while the launcher is up. So the surface
    // can be swapped out from under a fill. Both are checked at the moment of the press.
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

    // The turn.
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
    // The paired positive, and the reason this probe may photograph the panel at all: a row naming a
    // file is a claim, not proof. If the app's own marker did not come back, refuse and print what
    // was actually said.
    if (!turn.text.includes(CANARY)) {
      throw new Error(
        `⛔ the reply does not carry ${CANARY}, so ${workspaceFile} never reached the model — the ` +
          `Info panel's provider-instruction row would then be naming a file the provider listed ` +
          `and did not use. It said: "${turn.text.slice(0, 400)}"`,
      )
    }

    // The panel.
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

    // Printed BEFORE the pictures, so a run that dies taking them still leaves the panel's own words
    // in the log.
    console.log(`--- Info panel · ${String(panel.chars)} characters ---`)
    console.log(panel.text)
    console.log('--- end of Info panel ---')

    for (const { name, width, height } of SHOTS) {
      // The filename must not be able to lie about the size: `name` is what a reader reads and
      // `width`/`height` are what the renderer is told, so they are checked against each other.
      if (name !== `${String(width)}x${String(height)}`) {
        throw new Error(`the shot table disagrees with itself: ${name} vs ${width}x${height}`)
      }
      written.push(
        await shotAt(
          cdp,
          join(SHOT_DIR, `session-info-${LABEL}-${name}.png`),
          width,
          height,
          // Checked at BOTH sizes: the failure guarded against is a relayout, and which size pushes the
          // drawer out of view is not known in advance.
          async (w, h) => await assertPanelOnScreen(cdp, w, h),
        ),
      )
    }

    // The preview, opened from the panel, on the app's own paper. A separate shot rather than a
    // fourth assertion, so a reader can look at it. The Open button is only drawn where a reader is
    // wired, so its absence would mean the shipped app never passed the callback down.
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
    // The standard, checked rather than assumed: Markdown / Raw views on a white paper background, no
    // second viewer. A screenshot of a white box would look right whether or not it is the app's own
    // viewer.
    if (!paper.onWhite || !paper.markdown || !paper.raw) {
      throw new Error(`the preview is not the app's own paper: ${JSON.stringify(paper)}`)
    }
    // It must also say the bytes are current: the provider read this file at launch, while what is on
    // screen was read at the press.
    if (!/read just now, from disk/i.test(paper.says)) {
      throw new Error(`the preview does not say when it was read: "${paper.says}"`)
    }
    {
      // No `if (SHOT_DIR)` here: `main()` refuses above without one, so a guard would be a branch
      // nothing can take.
      written.push(
        await shotAt(
          cdp,
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
      `${error.message}\n--- app output ---\n${launch.output().slice(-4_000)}\n` +
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
