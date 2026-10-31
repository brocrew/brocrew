// Optional native contract check: compiled externally, never shipped in the plugin archive.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { ChromeBrowser } from '../../plugins/chrome/src/browser/chromeBrowser.js'
import { createProfileStore } from '../../plugins/chrome/src/profiles/store.js'
import { TabRegistry } from '../../plugins/chrome/src/tabs.js'
import { createWindowTasks } from '../../plugins/chrome/src/windows.js'
import { createKeyedSerializer } from '../../plugins/chrome/src/shared/browser/browser-lease.js'
import { createAgentChromeTools } from '../../plugins/chrome/src/tools/index.js'

const [observer, evidence] = process.argv.slice(2)
type OpenedTab = { tabId: string; windowId: number; url: string; title: string }
async function bounded<T>(work: Promise<T>, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('native fixture operation timed out')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
assert(observer && evidence, 'Supply observer executable and evidence JSON destination')
const samples: Array<{
  at: number
  pid: number
  bundle: string
  space: string
  displays: Record<string, string>
}> = []
const cases: unknown[] = []
let positiveControl: unknown
let ownedBrowserPid: number | undefined
let status = 'not-possible',
  reason = ''
let browser: ChromeBrowser | undefined
let home: string | undefined
let watcher: ReturnType<typeof spawn> | undefined
try {
  if (process.platform !== 'darwin') throw new Error('native focus/Space check requires macOS')
  watcher = spawn(observer, ['180'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let pending = ''
  watcher.stdout!.on('data', (bytes) => {
    pending += bytes.toString()
    for (;;) {
      const at = pending.indexOf('\n')
      if (at < 0) break
      const line = pending.slice(0, at)
      pending = pending.slice(at + 1)
      samples.push(JSON.parse(line))
    }
  })
  let observerError = ''
  watcher.on('error', (e) => {
    observerError = e.message
  })
  watcher.stderr!.on('data', (b) => {
    observerError += b.toString()
  })
  for (let n = 0; n < 50 && !samples.length && !observerError; n++) await delay(100)
  const original = samples.at(-1)
  if (!original?.pid || original.space === '0' || !Object.keys(original.displays).length)
    throw new Error(
      `native observation unavailable: ${observerError || 'no frontmost app or active Space'}`,
    )
  if (original.bundle === 'com.apple.loginwindow')
    throw new Error(
      'loginwindow is frontmost; native focus/Space proof cannot be calibrated from this locked or inactive GUI seat',
    )
  home = fs.realpathSync(fs.mkdtempSync('/tmp/brocrew-chrome-focus-'))
  const store = createProfileStore({ home })
  store.create('focus-fixture', 'panel')
  store.setFlags('focus-fixture', { enabled: true })
  browser = new ChromeBrowser({
    dirOf: store.dirOf,
    ua: {
      get: async () => ({
        userAgent: 'fictional fixture',
        chromeVersion: null,
      }),
      invalidate() {},
      peek: () => null,
    },
  })
  const tabs = new TabRegistry()
  const tools = createAgentChromeTools({
    store,
    browser,
    tabs,
    windows: createWindowTasks({ browser }),
    serializer: createKeyedSerializer(),
    downloadsRoot: path.join(home, 'downloads'),
    guard: () => ({ roots: [home!], hostHome: '', mount: '', maxBytes: 1024 }),
  })
  async function call(args: Record<string, unknown>): Promise<OpenedTab> {
    const result = await bounded(
      tools
        .find((t) => t.definition.name === 'open_tab')!
        .execute({ profile: 'focus-fixture', url: 'about:blank', ...args }, {}),
      60_000,
    )
    const text =
      (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
        ?.text ?? ''
    if (result.isError || text.startsWith('Error:')) throw new Error(text)
    return JSON.parse(text)
  }
  async function observe(name: string, args: Record<string, unknown>): Promise<OpenedTab> {
    const before = samples.at(-1)!
    const start = Date.now()
    const result = await call(args)
    await delay(4100)
    const seen = samples.filter((s) => s.at >= start)
    cases.push({ name, before, result, samples: seen })
    status = 'failed'
    assert(seen.length > 20, 'native observer must sample throughout each operation')
    assert(
      seen.every((s) => s.pid === before.pid && s.bundle === before.bundle),
      `${name}: frontmost application changed`,
    )
    assert(
      seen.every((s) => s.space === before.space),
      `${name}: active Space changed`,
    )
    const displayKey = (s: typeof before) => JSON.stringify(Object.entries(s.displays).sort())
    assert(
      seen.every((s) => displayKey(s) === displayKey(before)),
      `${name}: a display's active Space changed`,
    )
    assert.equal(
      before.pid,
      original!.pid,
      'frontmost baseline must remain the original application',
    )
    return result
  }
  const a = await observe('first visible launch', {
    visible: true,
    newWindow: true,
  })
  const ownPage = tabs.resolve(a.tabId, (p) => browser!.state(p)?.generation ?? null).page
  const ownSession = await bounded(ownPage.context().browser()!.newBrowserCDPSession())
  try {
    const info = await bounded(ownSession.send('SystemInfo.getProcessInfo'))
    ownedBrowserPid = info.processInfo.find((p) => p.type === 'browser')?.id
  } finally {
    await bounded(ownSession.detach(), 100).catch(() => undefined)
  }
  assert(
    Number.isInteger(ownedBrowserPid) && ownedBrowserPid !== original.pid,
    'disposable browser must be a distinct owned process',
  )
  const b = await observe('ordinary open_tab', {})
  const c = await observe('separate background window', { newWindow: true })
  const d = await observe('default in recent window', {})
  const e = await observe('explicit windowOf', { windowOf: a.tabId })
  assert.equal(a.windowId, b.windowId)
  assert.equal(c.windowId, d.windowId)
  assert.notEqual(a.windowId, c.windowId)
  assert.equal(e.windowId, a.windowId)
  const calibrationStart = Date.now()
  const shown = await bounded(
    tools.find((t) => t.definition.name === 'show_tab')!.execute({ tabId: e.tabId }, {}),
    30_000,
  )
  if (shown.isError) throw new Error('explicit show_tab positive control failed')
  for (
    let n = 0;
    n < 50 &&
    !samples.some(
      (s) => s.at >= calibrationStart && /chrome/i.test(s.bundle) && s.pid === ownedBrowserPid,
    );
    n++
  )
    await delay(100)
  const detected = samples.some(
    (s) => s.at >= calibrationStart && /chrome/i.test(s.bundle) && s.pid === ownedBrowserPid,
  )
  positiveControl = {
    explicit: 'show_tab on disposable owned tab',
    ownedBrowserPid,
    detected,
    samples: samples.filter((s) => s.at >= calibrationStart),
  }
  assert(detected, 'native observer must detect the explicit disposable show_tab focus change')
  status = 'passed'
} catch (e) {
  reason = e instanceof Error ? e.message : String(e)
  if (browser && cases.length === 0) status = 'failed'
} finally {
  await browser?.closeAll().catch(() => undefined)
  watcher?.kill('SIGTERM')
  if (home) fs.rmSync(home, { recursive: true, force: true })
  fs.writeFileSync(
    evidence,
    JSON.stringify(
      {
        status,
        reason,
        observer:
          'native AppKit frontmost PID + read-only SkyLight active Space and per-display active Spaces, 50ms sampling',
        disposableProfileOnly: true,
        signedIn: false,
        noProductFocusRestoration: true,
        ownedBrowserPid,
        positiveControl,
        cases,
        samples,
      },
      null,
      2,
    ) + '\n',
  )
}
console.log(JSON.stringify({ status, reason, cases: cases.length }))
if (status === 'failed') process.exitCode = 1
