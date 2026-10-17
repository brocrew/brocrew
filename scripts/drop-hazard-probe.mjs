#!/usr/bin/env node
/**
 * Measure whether a file drop navigates the window or releases its conversations.
 *
 *   pnpm run probe:drop
 *
 * Use CDP `Input.dispatchDragEvent` for a trusted Chromium drop with a real file payload;
 * a synthetic DOM event cannot exercise the default navigation. Compile the shipped
 * `window-navigation.ts` guard with esbuild and drive composer, transcript, rail, drawer
 * and Home zones separately. Report observed behaviour rather than assuming zones agree.
 * Outside `ci`: an isolated hidden Electron window, no provider, network or login.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pidsLaunchedOn, watchOffScreen } from './lib/hidden-launch.mjs'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const GUARD = join(REPO_ROOT, 'apps/desktop/src/main/window-navigation.ts')
const ELECTRON = join(REPO_ROOT, 'apps/desktop/node_modules/.bin/electron')
const ESBUILD = join(REPO_ROOT, 'node_modules/.pnpm/node_modules/.bin/esbuild')

/**
 * The five zones §1 names, laid out as disjoint bands so a drop lands unambiguously in one.
 *
 * ⚠️ These are POSITIONS, not the app's components. What is being measured is what the window and
 * the guard do with a trusted drop at a point — which is all the app can currently distinguish,
 * because it handles no drops anywhere.
 */
const ZONES = [
  { name: 'rail', x: 60, y: 300 },
  { name: 'transcript', x: 500, y: 200 },
  { name: 'composer', x: 500, y: 520 },
  { name: 'drawer', x: 900, y: 300 },
  { name: 'home', x: 500, y: 60 },
]

const PROBE_MAIN = String.raw`
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { installNavigationGuard } = require('./guard.cjs')

const ENTRY = path.join(__dirname, 'app', 'index.html')
const NAV_EVENTS = [
  'will-navigate', 'will-frame-navigate', 'will-redirect',
  'did-start-navigation', 'did-navigate', 'did-navigate-in-page',
  'render-process-gone', 'destroyed',
]

const out = { events: [], handedToBrowser: [], entry: '' }

// A main that nothing drives must still end: the driver has its own bound, and so does this.
setTimeout(() => {
  console.log('===PROBE-DEADLINE=== the driver never said PROBE-DONE within 90s')
  app.exit(2)
}, 90000)

app.whenReady().then(async () => {
  // ⚑ 697 · 695 F-a: nobody's window — never shown, no Dock icon, and not throttled for being unseen
  // (the product's own --brobot-hidden does the same three; this main is not the product's).
  if (app.dock) app.dock.hide()
  const win = new BrowserWindow({
    width: 1200,
    height: 700,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setBackgroundThrottling(false)
  // ⛔ The SHIPPED guard, with openExternal spied — a drop that "does nothing" to the window but
  // hands the file to Finder is still a side effect, and one this probe must be able to see.
  installNavigationGuard(
    win.webContents,
    { url: 'file://' + ENTRY },
    (url) => out.handedToBrowser.push(url),
  )
  for (const name of NAV_EVENTS) {
    win.webContents.on(name, (event) => {
      const url = event && typeof event === 'object' && 'url' in event ? event.url : ''
      out.events.push({ event: name, url: String(url || '') })
    })
  }
  await win.loadFile(ENTRY)
  out.entry = win.webContents.getURL()
  // The entry's OWN navigation is not a drop, and counting it reported a hazard that was not
  // there: loadFile raises did-start-navigation + did-navigate before any drop happens, so the
  // first version of this probe said "did-navigate x1" for a window nothing had been dropped on.
  // Recorded, then cleared, so what follows is caused by the drops and nothing else.
  // (No backticks in here: this whole script is a template literal.)
  out.beforeDrops = out.events.map((each) => each.event)
  out.events.length = 0
  // Held open for the driver; it tells us when it is done through the title.
  const done = new Promise((settle) => {
    win.webContents.on('page-title-updated', (_e, title) => {
      if (title === 'PROBE-DONE') settle()
    })
  })
  await done
  out.finalUrl = win.webContents.getURL()
  out.marker = await win.webContents.executeJavaScript('window.marker')
  console.log('===PROBE-JSON-START===' + JSON.stringify(out) + '===PROBE-JSON-END===')
  app.exit(0)
})
`

const INDEX_HTML = `<!doctype html><html><head><title>probe</title></head><body style="margin:0">
<div id="rail"      style="position:absolute;left:0;top:0;width:120px;height:700px;background:#123"></div>
<div id="home"      style="position:absolute;left:120px;top:0;width:760px;height:120px;background:#231"></div>
<div id="transcript"style="position:absolute;left:120px;top:120px;width:760px;height:320px;background:#312"></div>
<div id="composer"  style="position:absolute;left:120px;top:440px;width:760px;height:260px;background:#133"></div>
<div id="drawer"    style="position:absolute;left:880px;top:0;width:320px;height:700px;background:#313"></div>
<script>
window.marker = 'ORIGINAL'
// ⛔ THE POSITIVE CONTROL, and without it this probe proves nothing. "No navigation happened" is
// the same observation whether the guard held or the drop never arrived — so the page records what
// it actually received. If window.saw is empty the instrument is blind and the verdict is void.
// Deliberately does NOT call preventDefault: suppressing the default is what the FEATURE will
// do, and a probe that did it would measure its own handler instead of the window's behaviour.
window.saw = []
// ACCEPT is flipped by the driver for the second pass. With it off the page refuses the drop, which
// is what the app does today and what makes the browser take its DEFAULT action — the hazard being
// measured. With it on the page is a valid drop target, which is what the FEATURE will be, and the
// drop event carries the files.
window.ACCEPT = false
for (const type of ['dragenter', 'dragover', 'drop']) {
  window.addEventListener(type, (event) => {
    if (window.ACCEPT) event.preventDefault()
    const dt = event.dataTransfer
    window.saw.push({
      type,
      zone: event.target && event.target.id ? event.target.id : '(none)',
      files: dt ? dt.files.length : -1,
      kinds: dt ? [...dt.items].map((i) => i.kind + ':' + i.type).join(',') : '',
      trusted: event.isTrusted,
    })
  })
}
</script>
</body></html>`

function build(dir) {
  for (const missing of [GUARD, ELECTRON, ESBUILD].filter((path) => !existsSync(path))) {
    throw new Error(`cannot run the probe: ${missing} does not exist`)
  }
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"drop-hazard-probe","main":"main.js"}')
  writeFileSync(join(dir, 'main.js'), PROBE_MAIN)
  writeFileSync(join(dir, 'app', 'index.html'), INDEX_HTML)
  execFileSync(ESBUILD, [
    GUARD,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:electron',
    `--outfile=${join(dir, 'guard.cjs')}`,
    '--log-level=warning',
  ])
}

/** ⚑ Every CDP command is bounded (standing rule 13): a stalled one is NOT PERFORMED, never waited on. */
const CDP_COMMAND_MS = 10_000

/** A minimal CDP client — one socket, request/response by id. */
async function connect(port) {
  const version = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  const page = version.find((t) => t.type === 'page')
  if (!page) throw new Error('the probe window exposed no page target')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, no) => {
    socket.addEventListener('open', ok, { once: true })
    socket.addEventListener('error', no, { once: true })
  })
  let next = 1
  const waiting = new Map()
  socket.addEventListener('message', (message) => {
    const frame = JSON.parse(String(message.data))
    const settle = waiting.get(frame.id)
    if (!settle) return
    waiting.delete(frame.id)
    if (frame.error) settle.no(new Error(JSON.stringify(frame.error)))
    else settle.ok(frame.result)
  })
  return {
    send(method, params = {}) {
      const id = next++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((ok, no) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          no(new Error(`NOT PERFORMED: ${method} had no answer within ${String(CDP_COMMAND_MS)}ms`))
        }, CDP_COMMAND_MS)
        const settle = (then) => (value) => {
          clearTimeout(timer)
          then(value)
        }
        waiting.set(id, { ok: settle(ok), no: settle(no) })
      })
    },
    close: () => socket.close(),
  }
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/** A port nothing holds, from the kernel (`listen(0)`) — never a fixed one another tool may own. */
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
 * ⛔ **Three states, not two** — who listens on `port`, or *we could not ask* (`lsof -t` exits 1 on
 * no match, so a bare catch would make "nothing there" and "could not look" one answer).
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

/**
 * 🔒 **The debugger this probe drives is its OWN launch's** — polled until it listens, and refused
 * unless every listener is a process this launch owns (§6: every launch asserts its own pid is the
 * listener). ⚠️ Owned means the lifecycle's identities, not `child.pid`: `.bin/electron` is a shim
 * whose child is the real binary, and the listener is that child.
 */
async function ownDebugger(port, lifecycle, budgetMs = 20_000) {
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    const listening = listenersOn(port)
    if (!listening.asked) throw new Error(`could not ask who listens on ${port}: ${listening.why}`)
    if (listening.pids.length > 0) {
      lifecycle.refreshDescendants()
      const owned = new Set(lifecycle.identities.map((identity) => identity.pid))
      if (!listening.pids.every((pid) => owned.has(pid))) {
        throw new Error(
          `port ${port} is held by ${listening.pids.join(',')}, which this probe does not own ` +
            `(${[...owned].join(',')}) — refusing to drive it`,
        )
      }
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((r) => r.json())
        .catch(() => [])
      if (targets.some((one) => one.type === 'page')) return
    }
    await wait(150)
  }
  throw new Error(
    `NOT PERFORMED: the probe's window exposed no page on ${port} within ${budgetMs}ms`,
  )
}

async function drive(cdp, file, accept) {
  await cdp.send('Runtime.evaluate', { expression: 'window.ACCEPT = ' + String(accept) })
  const data = {
    items: [{ mimeType: 'text/uri-list', data: `file://${file}` }],
    files: [file],
    dragOperationsMask: 1,
  }
  const perZone = []
  for (const zone of ZONES) {
    const before = await cdp.send('Runtime.evaluate', {
      expression: 'location.href + "|" + window.marker',
      returnByValue: true,
    })
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: zone.x, y: zone.y, data })
    }
    // Long enough for a navigation to commit if one is going to.
    await wait(700)
    const after = await cdp.send('Runtime.evaluate', {
      expression: 'location.href + "|" + window.marker',
      returnByValue: true,
    })
    const saw = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.saw.splice(0))',
      returnByValue: true,
    })
    perZone.push({
      zone: zone.name,
      before: before.result.value,
      after: after.result.value,
      navigated: before.result.value !== after.result.value,
      saw: JSON.parse(saw.result.value),
    })
  }
  return perZone
}

/**
 * ⛔ **THE CONTROL THAT MAKES PASS 1 MEAN ANYTHING.**
 *
 * Pass 1 observes no navigation for a dropped file. That is only evidence if a synthesised drop
 * performs DEFAULT actions at all — otherwise "nothing happened" is a fact about CDP, not about the
 * window. So: drop a URL on the refusing page. The default for that is a navigation, and the guard
 * will refuse it — so a `will-frame-navigate` here proves defaults DO run, and pass 1's silence is
 * the window's answer. ⚠️ If this is silent too, the whole §1 measurement is inconclusive and must
 * say so rather than claim SAFE.
 */
async function urlControl(cdp) {
  await cdp.send('Runtime.evaluate', { expression: 'window.ACCEPT = false' })
  const data = {
    items: [{ mimeType: 'text/uri-list', data: 'https://example.com/dropped' }],
    dragOperationsMask: 1,
  }
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', { type, x: 500, y: 200, data })
  }
  await wait(900)
}

/** Poll `read` until it answers something, or throw after `budgetMs` — every wait here is bounded. */
async function waitFor(what, read, budgetMs) {
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    const got = await Promise.resolve()
      .then(read)
      .catch(() => null)
    if (got) return got
    await wait(150)
  }
  throw new Error(`NOT PERFORMED: timed out after ${String(budgetMs)}ms waiting for ${what}`)
}

/**
 * ⚑ **What the reap established, for the directory's sake.** `unknown` until a launch is made;
 * `reaped` only when `tearDownAndRemove` says the whole tree is gone AND it removed the user data;
 * anything else leaves the directory where it is — a teardown that could not establish the tree is
 * gone must not remove what it was writing to (`owned-teardown.mjs`' own rule).
 */
let reap = 'unknown'

async function run(dir, file, port, userData) {
  reap = 'launched'
  const child = spawn(
    ELECTRON,
    // ⚠️ 695-own-main: Electron on this probe's OWN main and test page, not the product's — the
    // product's switch means nothing to it. ⚑ Its window is still nobody's (697): created
    // `show: false` and never shown, which `hidden-launch.test.mjs` holds every own-main probe to.
    [dir, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`],
    {
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const exited = new Promise((resolve) => child.on('exit', resolve))

  // ⛔ **Owned, or not driven** — `.bin/electron` is a shim, so `child.kill()` kills the shim and
  // orphans the real binary (697's first run of this probe did exactly that). The lifecycle takes
  // the whole tree's identities while it is alive and reaps THEM.
  let lifecycle
  try {
    lifecycle = await waitFor(
      'the launched Electron to hold still long enough to be identified',
      () =>
        createOwnedProcessLifecycle({ launcherPid: child.pid, discoverDescendants: descendantsOf }),
      20_000,
    )
  } catch (error) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // the group never existed, which is consistent with a launch that never started
    }
    throw error
  }

  let perZone
  let accepting = []
  let cdp = null
  let teardown
  let driverFailed = null
  try {
    await ownDebugger(port, lifecycle)
    cdp = await connect(port)
    // PASS 1 — the page REFUSES, which is the app as it stands: the browser takes its default.
    perZone = await drive(cdp, file, false)
    // PASS 2 — the page ACCEPTS, which is what the feature will be: proves the pipeline can
    // deliver a real file, so pass 1's silence is the window's answer and not the probe's.
    accepting = await drive(cdp, file, true)
    // …and the control, LAST, so its navigation attempt cannot contaminate the two passes.
    await urlControl(cdp)
  } catch (cause) {
    driverFailed = String(cause)
    perZone = [{ zone: 'DRIVER FAILED', error: driverFailed, saw: [] }]
  } finally {
    if (cdp) {
      await cdp
        .send('Runtime.evaluate', { expression: "document.title = 'PROBE-DONE'" })
        .catch(() => {})
      cdp.close()
      // ⚑ The main prints its result and exits on PROBE-DONE — waited on for a bounded time.
      // ⚠️ Only when PROBE-DONE could be SAID: with no debugger the main cannot print, and waiting
      // would buy fifteen seconds of nothing before the same reap.
      await Promise.race([exited, wait(15_000)])
    }
    // ⚑ The whole tree is reaped whatever it did, and only then is its user data removed.
    teardown = tearDownAndRemove({ lifecycle, directory: userData })
    reap = teardown.complete && teardown.removed ? 'reaped' : 'not-reaped'
    child.stdout.destroy()
    child.stderr.destroy()
  }
  if (!teardown.complete) {
    throw new Error(`the Electron this probe launched was not reaped: ${JSON.stringify(teardown)}`)
  }
  const start = output.indexOf('===PROBE-JSON-START===')
  const end = output.indexOf('===PROBE-JSON-END===')
  if (start < 0 || end < 0) {
    // ⛔ The driver's own reason first — an ownership refusal must not read as a silent main.
    throw new Error(
      `NOT PERFORMED: ${driverFailed ?? 'the probe printed no result'}\n${output.slice(-2000)}`,
    )
  }
  const main = JSON.parse(output.slice(start + '===PROBE-JSON-START==='.length, end))
  return { ...main, perZone, accepting }
}

const dir = mkdtempSync(join(tmpdir(), 'brobot2-drop-probe-'))
const userData = join(dir, 'userdata')
// ⚑ 697 · 695 F-a: every look at the screen for the whole run, not one moment of it.
const offScreen = watchOffScreen(() => [userData], 250)
try {
  build(dir)
  // Use a probe-created file with an unclaimed extension, so browser handoff cannot open an
  // unrelated application.
  const file = join(dir, 'dropped.brobot2probe')
  writeFileSync(file, 'DROP-PROBE\n')

  const result = await run(dir, file, await freePort(), userData)
  const watched = offScreen.stop()

  console.log('\n=== 218 §1 · what a trusted file drop does to this window ===\n')
  for (const zone of result.perZone) {
    if (zone.error) {
      console.log(`  ${zone.zone}: ${zone.error}`)
      continue
    }
    const drop = zone.saw.find((each) => each.type === 'drop')
    console.log(
      `  ${zone.zone.padEnd(11)} navigated=${String(zone.navigated).padEnd(6)}` +
        `page saw ${zone.saw.map((e) => e.type).join('+') || 'NOTHING'}` +
        `${drop ? ` (on #${drop.zone}, files=${drop.files}, trusted=${drop.trusted}, ${drop.kinds})` : ''}`,
    )
  }
  const releasing = result.events.filter((e) => e.event === 'did-navigate')
  console.log('\n  --- pass 2: the same drops on a page that ACCEPTS them (the feature) ---')
  for (const zone of result.accepting) {
    const drop = zone.saw.find((each) => each.type === 'drop')
    console.log(
      `  ${zone.zone.padEnd(11)} ` +
        (drop
          ? `drop received: files=${drop.files}, trusted=${drop.trusted}, ${drop.kinds}`
          : `NO DROP (saw ${zone.saw.map((e) => e.type).join('+') || 'nothing'})`),
    )
  }

  console.log(
    `\n  before any drop (the entry's own load, excluded): ${JSON.stringify(result.beforeDrops)}`,
  )
  // Everything up to the control is the two file passes; the control's own attempt comes last.
  const during = result.events.map((e) => e.event + (e.url ? ` <${e.url}>` : ''))
  console.log(`  navigation events DURING the drops + the URL control: ${JSON.stringify(during)}`)
  const controlFired = result.events.some((e) => e.url.includes('example.com'))
  console.log(
    `  URL control attempted a navigation: ${controlFired} (if false, §1 is INCONCLUSIVE)`,
  )
  console.log(`  did-navigate (RELEASES): ${releasing.length}`)
  console.log(`  handed to the browser  : ${JSON.stringify(result.handedToBrowser)}`)
  console.log(`  document still ours    : ${result.marker === 'ORIGINAL'} (${result.finalUrl})`)
  const sighted = watched.sightings.length
  console.log(
    `  on screen              : ${String(sighted)} of ${String(watched.samples)} looks` +
      ` (every ${String(watched.everyMs)}ms, ${String(watched.blind)} blind)`,
  )

  const navigated = result.perZone.filter((z) => z.navigated).map((z) => z.zone)
  // ⛔ **Blind instruments do not get to say SAFE.** Every zone must have received a TRUSTED drop
  // carrying a file, or "nothing happened" is a statement about the probe rather than the app.
  // ⚠️ **An unaccepted drop fires NO page `drop` event — that is the browser taking the default, by
  // design.** Requiring one conflated "the drag arrived" with "the page accepted it", and voided a
  // run that was working. What proves the drag arrived is the PAYLOAD: a trusted dragover carrying
  // a file kind. And pass 2 proves the pipeline can go all the way.
  const blind = result.perZone.filter(
    (z) => !z.saw.some((e) => e.trusted && e.kinds.includes('file:')),
  )
  const fileNavigations = result.events.filter((e) => !e.url.includes('example.com'))
  // ⛔ A window on a person's screen voids the run whatever it measured, and so does a run nobody
  // looked at: no look is not a clean look.
  const verdict =
    sighted > 0
      ? `VOID — the probe's window was on screen in ${String(sighted)} look(s)`
      : watched.samples === 0
        ? 'VOID — the screen was never looked at, so "never shown" is not established'
        : blind.length
          ? `VOID — the drag payload never reached: ${JSON.stringify(blind.map((z) => z.zone))}`
          : !controlFired
            ? 'INCONCLUSIVE — a synthesised drop performs no default action here, so pass 1 proves nothing'
            : releasing.length === 0 && navigated.length === 0 && fileNavigations.length === 0
              ? 'SAFE — defaults DO run (the URL control fired), and a dropped FILE still navigates ' +
                'nothing, raises no did-navigate, and releases no sessions, in all five zones'
              : `HAZARD — navigated: ${JSON.stringify(navigated)}, did-navigate x${releasing.length}`
  console.log(`\n  VERDICT: ${verdict}\n`)
  process.exitCode = verdict.startsWith('SAFE') ? 0 : 1
} finally {
  offScreen.stop()
  // ⛔ **Nothing is removed from under a live process.** The directory comes off only when no launch
  // was made, or the reap PROVED the tree gone and removed the user data itself. ⚠️ The argv scan is
  // an extra veto, never the proof: macOS rewrites a dying process's command to `(Electron)`, so a
  // process still flushing into this directory can be invisible to it (`owned-process.mjs`).
  const alive = await pidsLaunchedOn(userData)
  if (reap === 'unknown' || (reap === 'reaped' && alive.length === 0)) {
    rmSync(dir, { recursive: true, force: true })
  } else {
    process.stderr.write(
      `⚠️  ${dir} is left: the reap was ${reap}` +
        `${alive.length > 0 ? `, and pid(s) ${alive.join(', ')} still name its user data` : ''}\n`,
    )
    process.exitCode = 1
  }
}
