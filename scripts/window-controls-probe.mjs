#!/usr/bin/env node
/**
 * Measure what the built app's window-control buttons do to a real BrowserWindow.
 *
 *   pnpm run build && pnpm run probe:window-controls [--shot <dir>]
 *
 * Zoom must grow the page-observed outer size and a second press restore it. Minimise must
 * change `document.visibilityState` to hidden; window coordinates need not move. Close must
 * remove this window's CDP target and is checked last; on macOS it need not quit the app.
 * Press buttons through CDP `.click()` to test behaviour. Pointer reach beneath drag regions
 * is a separate layout question covered by DOM checks, not by one coordinate in this probe.
 * Use a fresh data directory, free debug port and owned process group; clear inherited
 * `ELECTRON_RUN_AS_NODE` and verify listener ownership before driving anything.
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
 * is there"* and *"the question could not be put"* the same answer, and the ownership assertion
 * would pass in the second case having established nothing.
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

/** Is anything holding the port — asked by BINDING it, which is the kernel's own answer. */
function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.on('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
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

// --- page-side helpers, injected as expressions ---
//
// ⛔ **No backticks below this line inside an evaluate template, comments included** — a backtick
// closes the literal, `vitest` cannot see the resulting syntax error, and `node --check` can.

/** Everything about the WINDOW that a page can see. */
const WINDOW_STATE = `
  return {
    visible: document.visibilityState,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
  }
`

const PRESS = (control) => `
  const el = document.querySelector('[data-cy="window-${control}"]')
  if (!el) throw new Error('no [data-cy=window-${control}]')
  if (el.tagName !== 'BUTTON') throw new Error('window-${control} is a ' + el.tagName + ', not a button')
  el.click()
  return true
`

/** What the bar is made of — the shape the defect had, so a regression is legible. */
const READ_BAR = `
  const bar = document.querySelector('header.titlebar')
  if (!bar) throw new Error('there is no titlebar')
  const region = (el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim()
  const buttons = [...document.querySelectorAll('.window-controls > *')]
  return {
    barRegion: region(bar),
    barHeight: Math.round(bar.getBoundingClientRect().height),
    controls: buttons.map((el) => ({
      cy: el.dataset.cy ?? null,
      tag: el.tagName,
      region: region(el),
      label: el.getAttribute('aria-label'),
      hidden: el.closest('[aria-hidden="true"]') !== null,
    })),
  }
`

async function main() {
  if (!existsSync(ENTRY)) {
    throw new Error(`${ENTRY} is missing — run \`pnpm run build\` first.`)
  }
  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })

  const userDataDir = mkdtempSync(join(tmpdir(), 'b2-wc-'))
  if (join(userDataDir, GATE_SOCKET).length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(`the one-host gate socket path would exceed ${String(SUN_PATH_MAX)} bytes.`)
  }

  const port = await freePort()
  let output = ''
  const child = spawn(
    ELECTRON,
    // ⚠️ 695-visible: this probe's subject IS the window a person sees — it zooms it, minimises it
    // and asserts `outerWidth` and `visibilityState` move. A hidden launch has none of that to move.
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
  const said = []
  const written = []
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
        await cdp.evaluate(`return Boolean(document.querySelector('[data-cy=new-conversation]'))`),
      SETTLE_MS,
    )

    // ── 0 · the bar itself, and what it is made of ────────────────────────────────────────────
    const bar = await cdp.evaluate(READ_BAR)
    if (bar.barRegion !== 'drag') {
      throw new Error(
        `the titlebar is not draggable (${bar.barRegion}) — the window cannot be moved`,
      )
    }
    if (bar.controls.length !== 3) {
      throw new Error(`the bar draws ${String(bar.controls.length)} control(s), not three`)
    }
    for (const control of bar.controls) {
      if (control.tag !== 'BUTTON') {
        throw new Error(`${control.cy ?? '(unnamed)'} is a ${control.tag} — 384's defect exactly`)
      }
      if (control.region !== 'no-drag') {
        throw new Error(
          `${control.cy} computes -webkit-app-region: ${control.region}. Inside a drag region that ` +
            `swallows the click, which is a button that cannot be pressed.`,
        )
      }
      if (!control.label) throw new Error(`${control.cy} has no accessible name`)
      if (control.hidden) throw new Error(`${control.cy} is inside an aria-hidden subtree`)
    }
    said.push(
      `bar ${String(bar.barHeight)}px, drag · ${bar.controls.map((c) => c.cy).join(' ')} — all buttons, all no-drag, all named`,
    )

    const opened = await cdp.evaluate(WINDOW_STATE)
    if (SHOT_DIR) written.push(await cdp.shot(join(SHOT_DIR, '385-window-opened.png')))

    // ── 1 · zoom, and zoom back ──────────────────────────────────────────────────────────────
    await cdp.evaluate(PRESS('zoom'))
    const zoomed = await waitFor(
      'the window to grow',
      async () => {
        const now = await cdp.evaluate(WINDOW_STATE)
        return now.outerWidth > opened.outerWidth || now.outerHeight > opened.outerHeight
          ? now
          : null
      },
      GESTURE_MS,
    )
    if (SHOT_DIR) written.push(await cdp.shot(join(SHOT_DIR, '385-window-zoomed.png')))

    await cdp.evaluate(PRESS('zoom'))
    const restored = await waitFor(
      'the window to come back to the size it opened at',
      async () => {
        const now = await cdp.evaluate(WINDOW_STATE)
        return now.outerWidth === opened.outerWidth && now.outerHeight === opened.outerHeight
          ? now
          : null
      },
      GESTURE_MS,
    )
    said.push(
      `zoom ${String(opened.outerWidth)}×${String(opened.outerHeight)} → ` +
        `${String(zoomed.outerWidth)}×${String(zoomed.outerHeight)} → ` +
        `${String(restored.outerWidth)}×${String(restored.outerHeight)}`,
    )

    // ── 2 · minimise ─────────────────────────────────────────────────────────────────────────
    await cdp.evaluate(PRESS('minimize'))
    const hidden = await waitFor(
      'the page to go hidden, which is what a minimised window looks like from inside it',
      async () => {
        const now = await cdp.evaluate(WINDOW_STATE)
        return now.visible === 'hidden' ? now : null
      },
      GESTURE_MS,
    )
    // ⚑ The control for the reading: minimising moves NOTHING else a page can see. Without this,
    // "hidden" could as easily be a window that had been resized to nothing or moved offscreen.
    if (hidden.outerWidth !== restored.outerWidth || hidden.outerHeight !== restored.outerHeight) {
      throw new Error(
        `the window changed size as well as hiding: ${JSON.stringify(hidden)} vs ${JSON.stringify(restored)}`,
      )
    }
    said.push(`minimise visibilityState ${restored.visible} → ${hidden.visible}, size unchanged`)

    // ── 3 · close, which ends the WINDOW ─────────────────────────────────────────────────────
    //
    // ⛔ **Last, and pressed from a minimised window on purpose**: a control that only works while
    // the window is the front one is not a control, it is a coincidence.
    //
    // 🔴 **What `close` ends is the window, and on macOS that is not the app** — and this probe
    // asserted the wrong thing first time round, which is how the sentence below got measured
    // rather than assumed. `app-lifetime.ts` answers `window-all-closed` with *"on darwin the app
    // lives on with no windows, which is the platform convention"*; `activate` and a second launch
    // both make a new one. ⚠️ **The OS red button did exactly this too** — so nothing about closing
    // changed at 385 except that there is now a control for it. Quitting is ⌘Q, and
    // `pnpm run quit:check` is what measures that.
    await cdp.evaluate(PRESS('close'))
    const gone = await waitFor(
      'the window to go away',
      async () => {
        const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`, {
          signal: AbortSignal.timeout(2_000),
        })
        if (!response.ok) return null
        const list = await response.json()
        return Array.isArray(list) &&
          !list.some((t) => t.type === 'page' && t.url !== '' && t.url !== 'about:blank')
          ? true
          : null
      },
      GESTURE_MS,
    )
    const pids = [...owned]
    const stillAlive = pids.filter((pid) => isAlive(pid))
    const darwin = process.platform === 'darwin'
    // ⚑ **The platform half, asserted rather than tolerated.** On darwin a live app with no window
    // is correct and a dead one would mean the app quit on a window close; everywhere else
    // `windowAllClosed` quits, and a survivor is a process nobody can reach.
    if (darwin && stillAlive.length === 0) {
      throw new Error(
        'closing the window ended the process on darwin — `window-all-closed` is supposed to leave ' +
          'the app alive there, and `activate` is supposed to be able to make a window again.',
      )
    }
    if (!darwin) {
      await waitFor(
        'the app to quit, which is what a last window closing means off darwin',
        () => (pids.every((pid) => !isAlive(pid)) ? true : null),
        GESTURE_MS,
      )
      await waitFor('the debugging port to be released', () => portIsFree(port), GESTURE_MS)
    }
    said.push(
      `close removed the window (${String(gone)}) · ${darwin ? "app still alive, which is darwin's convention and what the OS button did" : "app quit, which is this platform's convention"}`,
    )
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

  console.log('✅ the window has one bar and its three controls control the window')
  for (const line of said) console.log(`   ${line}`)
  for (const file of written) console.log(`   shot        ${file}`)

  // ⚠️ **Still run, even though `close` is supposed to have done it.** The teardown is what removes
  // the user-data directory, and a `close` that left a child behind is exactly the thing this
  // probe must not hide behind a green line.
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
