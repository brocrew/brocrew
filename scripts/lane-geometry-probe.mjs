#!/usr/bin/env node
/**
 * Measure overlay lane geometry in an actual Electron window.
 *
 *   pnpm run build && pnpm run probe:lane-geometry [--shot <dir>]
 *
 * Report outer and inner widths, document width and scroll width, both scrollbar axes on
 * `#app`, and the open overlay lane's left, width and right. Classic scrollbars consume
 * space that a headless engine's overlay bars may not, so window measurements matter.
 * Attempt widths 1180 and 1440 through `Browser.setWindowBounds`; report NOT PERFORMED
 * when the runtime refuses rather than inferring a result.
 *
 * Do not assert inventory-panel geometry: a fresh install lacks the conversation and tool
 * inventory it needs. The DOM panel checks use the window-width arithmetic measured here.
 * Use a fresh data directory, an owned process group and a free debug port. Clear inherited
 * `ELECTRON_RUN_AS_NODE` and verify listener ownership before driving the app.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
const ENTRY = join(DESKTOP, 'out/main/index.js')

const SUN_PATH_MAX = 104
const GATE_SOCKET = 'one-host.sock'
const LAUNCH_MS = 45_000
const SETTLE_MS = 30_000
const OWNERSHIP_MS = 10_000
const GESTURE_MS = 8_000
const POLL_MS = 250

/** What `338` measured in the shipped window, on the HEIGHT axis. */
const CLASSIC_BAR = 11
/**
 * The three widths the delivery names, and a fourth that is the CONTROL.
 *
 * ⛔ **Without the fourth this probe is an instrument nobody has seen fire.** At 1200, 1180 and
 * 1440 nothing overflows `#app` — `.app` is `min-width: var(--app-min-w)` = 1180 — so BOTH
 * `offsetWidth - clientWidth` and `offsetHeight - clientHeight` read 0, which is exactly what the
 * overlay-scrollbar runner reads, and *"the width axis has no bar"* would be unfalsifiable.
 * ⚑ **1000 is under the floor**, so the app overflows horizontally, `overflow-x: auto` draws a
 * CLASSIC bar, and the height axis must read {@link CLASSIC_BAR} — in the same run, in the same
 * window. Only then does a 0 on the width axis mean anything.
 */
const WIDTHS = [1200, 1180, 1440, 1000]
/** The one that is a control rather than a claim. */
const CONTROL_WIDTH = 1000

const SHOT_DIR = (() => {
  const at = process.argv.indexOf('--shot')
  return at === -1 ? null : (process.argv[at + 1] ?? null)
})()

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
  while (Date.now() < deadline) {
    let last
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
 * is there"* and *"the question could not be put"* the same answer.
 */
function listenersOn(port) {
  try {
    const out = execFileSync('lsof', ['-t', `-iTCP:${String(port)}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { asked: true, pids: out.trim().split('\n').filter(Boolean).map(Number) }
  } catch (error) {
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

  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }

  close() {
    this.#socket?.close()
  }
}

// --- page-side expressions ---
//
// ⛔ **No backticks below this line inside an evaluate template, comments included** — a backtick
// closes the literal, and the resulting syntax error is invisible until the page throws.

/** The window's own numbers, plus both scrollbar axes on the element that can draw one. */
const WINDOW_AXES = `
  const app = document.querySelector('#app')
  const root = document.documentElement
  return {
    outerWidth: window.outerWidth,
    innerWidth: window.innerWidth,
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    rootOverflow: getComputedStyle(root).overflow,
    appPresent: Boolean(app),
    appBarWidth: app ? app.offsetWidth - app.clientWidth : null,
    appBarHeight: app ? app.offsetHeight - app.clientHeight : null,
    appScrollbarWidth: app ? getComputedStyle(app).scrollbarWidth : null,
  }
`

/** The overlay lane, if an overlay is open. */
const LANE = `
  const corner = document.querySelector('.overlay-corner')
  if (!corner) return null
  const box = corner.getBoundingClientRect()
  const stop = document.querySelector('[data-cy=overlay-spawning]')
  return {
    left: Math.round(box.left),
    width: Math.round(box.width),
    right: Math.round(box.right),
    stop: stop ? Math.round(stop.getBoundingClientRect().right) : null,
  }
`

/**
 * Open ANY overlay, so the lane exists at all.
 *
 * ⛔ **Two openers, in order, and the fallback is the load-bearing one.** Every `OverlayHost` in
 * the app is behind a `v-if` that is false until something opens it, and a FRESH INSTALL has no
 * identity row to press — measured: the first run of this probe reported the lane NOT PERFORMED
 * for exactly that reason. The roster's add button is always there.
 *
 * ## ⚑ 570 · it goes through a DESTINATION now, and the fallback is why
 *
 * ⛔ **`EXT-008` §4.4 took the AGENTS section out of the rail**, so both openers moved onto the
 * Team page and the walk to it is the first step. ⚠️ **The fallback's argument survives intact**
 * and got slightly stronger: `New agent` is drawn on that page's header whether or not the
 * identities read has landed, so a fresh install with no row still has a press.
 */
const OPEN_AN_OVERLAY = `
  const team = document.querySelector('[data-cy=rail-team]')
  if (!team) return null
  team.click()
  return 'the Team destination'
`

/** ⚑ The press itself, once the page is up. Separate, because the route needs a frame first. */
const PRESS_AN_OPENER = `
  const row = document.querySelector('[data-cy^="team-open-"]')
  if (row) { row.click(); return 'an identity row' }
  const add = document.querySelector('[data-cy=team-create]')
  if (add) { add.click(); return 'the roster add button' }
  return null
`

async function main() {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing — run \`pnpm run build\` first.`)
  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })

  const userDataDir = mkdtempSync(join(tmpdir(), 'b2-lane-'))
  if (join(userDataDir, GATE_SOCKET).length > SUN_PATH_MAX) {
    // ⛔ Remove the directory this refusal just made, or a long TMPDIR leaks one per invocation.
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(`the one-host gate socket path would exceed ${String(SUN_PATH_MAX)} bytes.`)
  }

  const port = await freePort()
  let output = ''
  const child = spawn(
    ELECTRON,
    // ⚠️ 695-visible: this probe RESIZES the window (`Browser.setWindowBounds`) and reads the lanes
    // it lands at — and measured on 695, a never-shown window ignores the resize (`innerWidth` stayed
    // 1200 after a 1000-wide bound). Hidden, it would measure a width nobody set.
    [`--remote-debugging-port=${String(port)}`, `--user-data-dir=${userDataDir}`, '.'],
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
    throw new Error(
      `could not take ownership of the app this probe launched (pid ${String(child.pid)}): ` +
        `${error.message}\n   ⚠️ ${userDataDir} is left in place.`,
      { cause: error },
    )
  }

  const stop = () => {
    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })
    child.stdout.destroy()
    child.stderr.destroy()
    return outcome
  }

  let cdp = null
  /** Filled by the `finally` below; read after it, which is the whole point of the two facts. */
  let teardown
  const rows = []
  const written = []
  const notPerformed = []
  try {
    cdp = await Cdp.attach(port)
    lifecycle.refreshDescendants()

    // ── 🔒 the listener really is ours ────────────────────────────────────────────────────────
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

    await waitFor(
      'the app to draw its rail',
      async () =>
        await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=rail-team]'))`),
      SETTLE_MS,
    )

    // ── the overlay, so the lane is on screen at all ──────────────────────────────────────────
    await cdp.evaluate(OPEN_AN_OVERLAY)
    await waitFor(
      'the Team page',
      async () =>
        await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=team-workspace]'))`),
      SETTLE_MS,
    )
    const opened = await cdp.evaluate(PRESS_AN_OPENER)
    if (opened) {
      try {
        await waitFor(
          'an overlay to open',
          async () =>
            await cdp.evaluate(`return Boolean(document.querySelector('.overlay-corner'))`),
          GESTURE_MS,
        )
        process.stdout.write(`  ⚑ the lane is on screen behind ${opened}\n`)
      } catch (error) {
        notPerformed.push(
          `the lane — no overlay opened within ${String(GESTURE_MS)}ms: ${error.message}`,
        )
      }
    } else {
      notPerformed.push('the lane — nothing on a fresh install could be pressed to open an overlay')
    }

    let windowId = null
    try {
      ;({ windowId } = await cdp.send('Browser.getWindowForTarget'))
    } catch (error) {
      notPerformed.push(`resizing — Browser.getWindowForTarget refused: ${error.message}`)
    }

    for (const width of WIDTHS) {
      let how = 'the window the app opened'
      if (width !== WIDTHS[0]) {
        if (windowId !== null) {
          try {
            await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height: 840 } })
            await waitFor(
              `the window to report ${String(width)}px`,
              async () =>
                (await cdp.evaluate(`return window.outerWidth`)) === width ? true : null,
              GESTURE_MS,
            )
            how = 'an OS resize'
          } catch (error) {
            notPerformed.push(`${String(width)}px as an OS RESIZE — ${error.message}`)
            windowId = null
          }
        }
        if (windowId === null) {
          /**
           * ⚠️ **A layout override is NOT a resized window, and the row says so.** Electron's CDP
           * carries no `Browser` domain, so the OS window cannot be resized from here and
           * `main/index.ts` opens one fixed size. ⚑ What this does buy is the SHIPPED engine
           * laying the page out at the other two widths — the same Chromium, the same scrollbar
           * behaviour, the same cascade — which is strictly more than the vitest runner can say
           * and strictly less than a window a person could drag.
           */
          try {
            await cdp.send('Emulation.setDeviceMetricsOverride', {
              width,
              height: 840,
              deviceScaleFactor: 0,
              mobile: false,
            })
            how = 'a layout override, NOT an OS resize'
          } catch (error) {
            notPerformed.push(`${String(width)}px — no resize and no override: ${error.message}`)
            continue
          }
        }
      }
      const axes = await cdp.evaluate(WINDOW_AXES)
      const lane = await cdp.evaluate(LANE)
      rows.push({ asked: width, how, ...axes, lane })
      if (SHOT_DIR) written.push(await cdp.shot(join(SHOT_DIR, `455-window-${String(width)}.png`)))
    }
    // ⛔ Put the page back, so a screenshot taken after this loop is of the app and not of a
    // viewport this probe invented.
    try {
      await cdp.send('Emulation.clearDeviceMetricsOverride')
    } catch {
      // never applied, which is the OS-resize path
    }
  } finally {
    cdp?.close()
    teardown = stop()
  }

  // ⛔ **Two facts, not one** — `tearDownAndRemove`'s own words: whether the processes were REAPED
  // and whether the directory came off. ⚠️ A first version of this file checked only the second,
  // and `kill9()`'s result has no `why`, so the line it printed always said `unknown`.
  // 🔴 A leaked Electron perturbs everything measured after it and must not hide behind a green
  // line — every other launcher in this repository checks `complete`.
  if (!teardown.complete) {
    throw new Error(
      `the app this probe launched was not reaped: ${JSON.stringify(teardown)}\n` +
        `   ⚠️ ${userDataDir} may still be in place.`,
    )
  }
  if (!teardown.removed) {
    process.stderr.write(`⚠️  ${userDataDir} was left behind: ${JSON.stringify(teardown)}\n`)
  }

  // ── the report, computed from the outcome ───────────────────────────────────────────────────
  const line = (row) =>
    [
      `asked ${String(row.asked)} (${row.how})`,
      `outer ${String(row.outerWidth)}`,
      `inner ${String(row.innerWidth)}`,
      `client ${String(row.clientWidth)}`,
      `scroll ${String(row.scrollWidth)}`,
      `root-overflow ${String(row.rootOverflow)}`,
      `#app bar w/h ${String(row.appBarWidth)}/${String(row.appBarHeight)}`,
      row.lane
        ? `lane ${String(row.lane.left)}+${String(row.lane.width)}=${String(row.lane.right)}`
        : 'lane NOT PERFORMED',
    ].join(' · ')

  for (const row of rows) process.stdout.write(`  ${line(row)}\n`)
  for (const missing of notPerformed) process.stdout.write(`  ⛔ NOT PERFORMED · ${missing}\n`)
  for (const file of written) process.stdout.write(`  📸 ${file}\n`)

  const measured = rows.filter((row) => row.appBarWidth !== null)
  if (measured.length === 0) throw new Error('no width was measured — nothing above is a reading')

  const failures = []
  // ⛔ **A report is computed from the OUTCOME** (standing rule 13). A run that measured one width
  // of four, or never opened an overlay, is not the run this file claims to perform.
  if (rows.length !== WIDTHS.length) {
    failures.push(
      `measured ${String(rows.length)} of ${String(WIDTHS.length)} widths — see NOT PERFORMED above`,
    )
  }
  if (!rows.some((row) => row.lane)) failures.push('no lane was measured at any width')

  // 🔴 **The control, and everything else is read against it.** At the width under the app's own
  // floor the shipped window must draw a CLASSIC horizontal bar; if it reads 0 there too, this
  // instrument cannot tell a classic bar from an overlay one and none of its zeroes mean anything.
  const control = measured.find((row) => row.asked === CONTROL_WIDTH)
  if (!control) failures.push(`the control width ${String(CONTROL_WIDTH)} was not measured`)
  else if (control.appBarHeight !== CLASSIC_BAR) {
    failures.push(
      `at ${String(CONTROL_WIDTH)}px the height-axis bar reads ${String(control.appBarHeight)}, ` +
        `not ${String(CLASSIC_BAR)} — this window draws OVERLAY bars, so a 0 on the width axis ` +
        `says nothing`,
    )
  }
  for (const row of measured) {
    // 🔴 **The claim this probe exists to settle.** If a classic vertical bar could appear, the
    // fixed host's 100% would be `innerWidth` short of the window and every panel width in the
    // delivery would be 11px out in the shipped app.
    if (row.appBarWidth !== 0) {
      failures.push(
        `at ${String(row.asked)}px #app draws a ${String(row.appBarWidth)}px VERTICAL bar`,
      )
    }
    if (row.innerWidth !== row.asked) {
      failures.push(
        `at ${String(row.asked)}px the page reports innerWidth ${String(row.innerWidth)}`,
      )
    }
    if (row.clientWidth !== row.innerWidth) {
      failures.push(
        `at ${String(row.asked)}px clientWidth ${String(row.clientWidth)} is not innerWidth ${String(row.innerWidth)}`,
      )
    }
    if (row.rootOverflow !== 'hidden') {
      failures.push(`at ${String(row.asked)}px the document's overflow is ${row.rootOverflow}`)
    }
    if (row.lane && row.lane.right !== 210) {
      failures.push(`at ${String(row.asked)}px the lane ends at ${String(row.lane.right)}, not 210`)
    }
  }
  // ⚠️ Reported, never asserted: the height-axis bar is the OS's and a machine without one is not
  // a defect in this app. The number is here so the two axes are never confused again.
  // ⚠️ **Derived from the readings, not a fixed narrative beside a number that may contradict it.**
  process.stdout.write(
    `  ⚑ height-axis bar, per width: ${measured
      .map((row) => `${String(row.asked)}→${String(row.appBarHeight)}px`)
      .join(' · ')} — a bar is drawn only where something OVERFLOWS, which above the ` +
      `--app-min-w floor nothing does.\n`,
  )

  if (failures.length > 0) {
    process.stderr.write(`\n${output.trim()}\n`)
    throw new Error(`\n  ⛔ ${failures.join('\n  ⛔ ')}`)
  }
  process.stdout.write(
    '  ✅ the window is the reference: no vertical bar, on every width measured\n',
  )
}

main().catch((error) => {
  process.stderr.write(`\nlane-geometry-probe: ${error.message}\n`)
  process.exitCode = 1
})
