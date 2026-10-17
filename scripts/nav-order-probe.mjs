#!/usr/bin/env node
/**
 * Measure external-link handoff and Electron navigation-event order with the shipped guard.
 *
 *   pnpm run probe:nav
 *
 * Compile `window-navigation.ts` with esbuild and run it in a real BrowserWindow with
 * `openExternal` spied. Direct handler tests cannot show whether cancellation of
 * `will-frame-navigate` prevents the later `will-navigate` event from firing.
 * Compare four cases: shipped guard, listeners without a guard, cancellation on
 * `will-frame-navigate`, and cancellation on `will-navigate`. Log events in arrival order.
 * Outside `ci`: requires Electron, no provider, network or login, roughly five seconds.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const GUARD = join(REPO_ROOT, 'apps/desktop/src/main/window-navigation.ts')
const ELECTRON = join(REPO_ROOT, 'apps/desktop/node_modules/.bin/electron')
/**
 * pnpm keeps every hoisted binary here, and esbuild arrives through vite rather than as a
 * dependency of ours — so it is looked up rather than imported, and its absence is reported as
 * exactly that instead of as a probe failure.
 */
const ESBUILD = join(REPO_ROOT, 'node_modules/.pnpm/node_modules/.bin/esbuild')

const PROBE_MAIN = String.raw`
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { installNavigationGuard } = require('./guard.cjs')

const ENTRY = path.join(__dirname, 'app', 'index.html')
const NAV_EVENTS = [
  'will-navigate', 'will-frame-navigate', 'will-redirect',
  'did-start-loading', 'did-start-navigation', 'did-navigate',
  'render-process-gone', 'destroyed',
]

const out = { gestures: [] }
let current = null

function watch(label, contents, prevent) {
  for (const name of NAV_EVENTS) {
    contents.on(name, (event, ...rest) => {
      const url = event && typeof event === 'object' && 'url' in event ? event.url : ''
      if (current) current.events.push({ window: label, event: name, url })
      if (prevent && prevent.includes(name) && event && typeof event.preventDefault === 'function') {
        event.preventDefault()
      }
    })
  }
}

async function gesture(name, run) {
  current = { gesture: name, events: [], handedToBrowser: [] }
  out.gestures.push(current)
  try { await run(current) } catch (cause) { current.error = String((cause && cause.message) || cause) }
  await new Promise((resolve) => setTimeout(resolve, 600))
  current = null
}

async function main() {
  const openExternal = (url) => { if (current) current.handedToBrowser.push(url) }
  const make = async (label, wire) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    wire(win.webContents, label)
    await win.loadFile(ENTRY)
    return win
  }
  const a = await make('A/guarded', (wc, label) => {
    installNavigationGuard(wc, { indexHtml: ENTRY }, openExternal)
    watch(label, wc)
  })
  const b = await make('B/bare', (wc, label) => watch(label, wc))
  const c = await make('C/frame-only', (wc, label) => watch(label, wc, ['will-frame-navigate']))
  const d = await make('D/nav-only', (wc, label) => watch(label, wc, ['will-navigate']))

  const click = (win, id) =>
    win.webContents.executeJavaScript("document.getElementById('" + id + "').click(); true", true)
  const marker = (win) => win.webContents.executeJavaScript("window.marker || 'GONE'", true)

  await gesture('external link', () => click(a, 'external'))
  await gesture('the app own document, as ?v=2', () => click(a, 'self-query'))
  await gesture('the app own document, by name', () => click(a, 'self-name'))
  await gesture('a sibling file', () => click(a, 'sibling'))
  await gesture('a mailto: link', () => click(a, 'mailto'))
  await gesture('window.open of an external link', () =>
    a.webContents.executeJavaScript("window.open('https://example.com/opened'); true", true))
  await gesture('location.reload()', () =>
    a.webContents.executeJavaScript('location.reload(); true', true))
  await gesture('webContents.reload()', async () => {
    a.webContents.reload()
    await new Promise((r) => setTimeout(r, 900))
  })
  await gesture('the guarded document survived', async (g) => { g.marker = await marker(a) })

  await gesture('BARE: a sibling file, nothing prevented', () => click(b, 'sibling'))
  await gesture('BARE: it navigated', async (g) => { g.marker = await marker(b) })
  await gesture('CANCEL IN will-frame-navigate: a sibling file', () => click(c, 'sibling'))
  await gesture('CANCEL IN will-frame-navigate: it did not navigate', async (g) => { g.marker = await marker(c) })
  await gesture('CANCEL IN will-navigate: a sibling file', () => click(d, 'sibling'))
  await gesture('CANCEL IN will-navigate: it did not navigate', async (g) => { g.marker = await marker(d) })
  await gesture('a renderer that CRASHED', async () => {
    b.webContents.forcefullyCrashRenderer()
    await new Promise((r) => setTimeout(r, 1200))
  })
  await gesture('a window that was CLOSED', async () => {
    d.close()
    await new Promise((r) => setTimeout(r, 1200))
  })

  out.electron = process.versions.electron
  console.log('===PROBE-JSON-START===')
  console.log(JSON.stringify(out))
  console.log('===PROBE-JSON-END===')
  app.exit(0)
}

setTimeout(() => {
  console.log('===PROBE-JSON-START===')
  console.log(JSON.stringify({ ...out, timedOut: true }))
  console.log('===PROBE-JSON-END===')
  app.exit(2)
}, 90000).unref()

app.whenReady().then(() =>
  main().catch((cause) => {
    console.log('===PROBE-JSON-START===')
    console.log(JSON.stringify({ ...out, fatal: String((cause && cause.stack) || cause) }))
    console.log('===PROBE-JSON-END===')
    app.exit(3)
  }),
)
`

const INDEX_HTML = `<!doctype html><html><body>
<a id="external" href="https://example.com/docs">external</a>
<a id="self-query" href="?v=2">self query</a>
<a id="self-name" href="index.html">self name</a>
<a id="sibling" href="other.html">sibling</a>
<a id="mailto" href="mailto:a@b.c">mailto</a>
<script>window.marker = 'ORIGINAL'</script>
</body></html>`
const OTHER_HTML = `<!doctype html><html><body><script>window.marker='REPLACED'</script></body></html>`

/** What each gesture must have done. Everything not listed must hand off nothing at all. */
const EXPECTED_HANDOFF = {
  'external link': ['https://example.com/docs'],
  'window.open of an external link': ['https://example.com/opened'],
}

function build(dir) {
  for (const missing of [GUARD, ELECTRON, ESBUILD].filter((path) => !existsSync(path))) {
    throw new Error(`cannot run the probe: ${missing} does not exist`)
  }
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"nav-order-probe","main":"main.js"}')
  writeFileSync(join(dir, 'main.js'), PROBE_MAIN)
  writeFileSync(join(dir, 'app', 'index.html'), INDEX_HTML)
  writeFileSync(join(dir, 'app', 'other.html'), OTHER_HTML)
  // ⚠️ The SHIPPED module, compiled — not a copy of its policy. 094 established the rule and it is
  // the only thing that makes a probe evidence about this app rather than about a probe.
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

function run(dir) {
  return new Promise((resolve, reject) => {
    // ⚑ 695-own-main: this probe's OWN main, whose window is created `show: false` and never shown.
    const child = spawn(ELECTRON, [dir, `--user-data-dir=${join(dir, 'userdata')}`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const bail = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('the probe did not finish in 120s'))
    }, 120_000)
    child.on('exit', () => {
      clearTimeout(bail)
      const start = output.indexOf('===PROBE-JSON-START===')
      const end = output.indexOf('===PROBE-JSON-END===')
      if (start < 0 || end < 0) return reject(new Error(`the probe printed no result:\n${output}`))
      resolve(JSON.parse(output.slice(start + '===PROBE-JSON-START==='.length, end)))
    })
  })
}

/** What the guarded window saw, per gesture, in arrival order. */
const guardedEvents = (gesture) =>
  gesture.events.filter((e) => e.window === 'A/guarded').map((e) => e.event)

function verdicts(result) {
  const by = (name) => result.gestures.find((g) => g.gesture === name)
  const failures = []
  const notes = []
  const check = (ok, message) => void (ok ? notes.push(`✓ ${message}`) : failures.push(message))

  for (const gesture of result.gestures) {
    if (gesture.error) failures.push(`${gesture.gesture}: ${gesture.error}`)
    const expected = EXPECTED_HANDOFF[gesture.gesture] ?? []
    const actual = gesture.handedToBrowser
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `${gesture.gesture}: handed ${JSON.stringify(actual)} to the browser, expected ` +
          `${JSON.stringify(expected)}`,
      )
    }
  }

  // ⚠️ The claim the fix rests on, asserted rather than assumed: under the shipped guard a click
  // reaches `will-frame-navigate` and stops there. A hand-off owned by `will-navigate` is a
  // hand-off that never runs, and this is the line that would go red if it were moved back.
  //
  // **Every click, not just the external one** (found in review). The comment in
  // `window-navigation.ts` says the guard logged `will-frame-navigate` and nothing else for all
  // five gestures; checking one of them left the other four as a claim rather than a measurement,
  // and a future Electron that reached `will-navigate` for, say, a same-document click would have
  // been invisible here.
  const CLICKS = [
    'external link',
    'the app own document, as ?v=2',
    'the app own document, by name',
    'a sibling file',
    'a mailto: link',
  ]
  for (const name of CLICKS) {
    const clicked = guardedEvents(by(name))
    check(
      clicked.includes('will-frame-navigate'),
      `${name}: reaches will-frame-navigate (saw ${JSON.stringify(clicked)})`,
    )
    check(
      !clicked.includes('will-navigate'),
      `${name}: will-navigate is never emitted under the guard (saw ${JSON.stringify(clicked)})`,
    )
  }
  check(
    by('the guarded document survived').marker === 'ORIGINAL',
    'the document survived the clicks',
  )

  // The order, and the cancel semantics the unit-test fake encodes.
  const bare = by('BARE: a sibling file, nothing prevented')
    .events.filter((e) => e.window === 'B/bare' && e.event.startsWith('will-'))
    .map((e) => e.event)
  check(
    JSON.stringify(bare) === JSON.stringify(['will-frame-navigate', 'will-navigate']),
    `unguarded, the order is frame-then-nav (saw ${JSON.stringify(bare)})`,
  )
  const cancelled = by('CANCEL IN will-frame-navigate: a sibling file')
    .events.filter((e) => e.window === 'C/frame-only' && e.event.startsWith('will-'))
    .map((e) => e.event)
  check(
    JSON.stringify(cancelled) === JSON.stringify(['will-frame-navigate']),
    `a cancel in will-frame-navigate ends the gesture (saw ${JSON.stringify(cancelled)})`,
  )
  check(
    by('CANCEL IN will-frame-navigate: it did not navigate').marker === 'ORIGINAL',
    'and it really did refuse the navigation',
  )

  // The release side (dispatch §4): which event a crash raises, and which a close does.
  //
  // ⚠️ **Both are compared as the WHOLE list, not by presence** (found in review). "and nothing
  // else" is the sentence `window-navigation.ts` writes about each of them, and a check that named
  // two events to be absent left five unexamined — including `did-navigate`, which is in
  // `SESSION_RELEASE_EVENTS` and would double-release if a close ever raised it.
  const exactly = (gesture, expected) => {
    const saw = by(gesture).events.map((e) => e.event)
    check(
      JSON.stringify(saw) === JSON.stringify(expected),
      `${gesture} raises exactly ${JSON.stringify(expected)} (saw ${JSON.stringify(saw)})`,
    )
  }
  exactly('a renderer that CRASHED', ['render-process-gone'])
  exactly('a window that was CLOSED', ['destroyed'])

  return { failures, notes }
}

const dir = mkdtempSync(join(tmpdir(), 'brobot2-nav-probe-'))
try {
  build(dir)
  const result = await run(dir)
  const { failures, notes } = verdicts(result)
  for (const note of notes) console.log(note)
  console.log(`\nelectron ${result.electron}`)
  if (failures.length > 0) {
    console.error(`\nFAIL\n  ${failures.join('\n  ')}`)
    process.exit(1)
  }
  console.log('PASS — an external link reaches the browser, and nothing else does')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
