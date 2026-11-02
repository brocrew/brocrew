// Two-Space native check for the BroCrew helper. Qualification tooling only: bundled outside the
// plugin, never shipped, and run only with the person's explicit yes for that run. It uses
// throwaway, never-signed-in profiles under /tmp, never touches the person's own Chrome, never
// moves a window or changes a setting, and stops only processes it started. The person moves the
// two test windows to Desktop 2 and keeps TextEdit in front on Desktop 1; see README.md.
//
// node <bundle> <observer> <receipt.json> <variants> [executable]
//   variants: a comma list of the steps below, run in the order given. "base" runs only A and is
//   bundled from the commit before the change; "helper" runs the rest from the reviewed commit.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { ChromeBrowser } from '../../plugins/chrome/src/browser/chromeBrowser.js'
import { killChromeOf } from '../../plugins/chrome/src/browser/chromeBrowser.js'
import { createProfileStore } from '../../plugins/chrome/src/profiles/store.js'
import { launchPersistentChromium } from '../../plugins/chrome/src/shared/browser/browser-launch.js'
import { createKeyedSerializer } from '../../plugins/chrome/src/shared/browser/browser-lease.js'
import { TabRegistry } from '../../plugins/chrome/src/tabs.js'
import { createAgentChromeTools } from '../../plugins/chrome/src/tools/index.js'
import { createWindowTasks } from '../../plugins/chrome/src/windows.js'

const [observerPath, receiptPath, variantList, executable] = process.argv.slice(2)
assert(observerPath && receiptPath && variantList, 'usage: <observer> <receipt.json> <variants>')
assert.equal(process.platform, 'darwin', 'the two-Space check runs on macOS only')
assert(!fs.existsSync(receiptPath), 'write a new receipt file')
const variants = variantList.split(',')
const TEXTEDIT = 'com.apple.TextEdit'
const RUNS = 10
const helperSource = path.resolve('plugins/chrome/helper')

// --- Observer ------------------------------------------------------------------------------
type Event = {
  kind: string
  at: number
  pid?: number
  bundle?: string
  id?: string
  onScreen?: number
  /** On every front sample: on-screen windows per Chrome-family process id; absent when unknown. */
  chromeWindows?: Record<string, number>
}
const events: Event[] = []
const replies = new Map<string, (count: number) => void>()
const observer = spawn(observerPath, ['3600'], { stdio: ['pipe', 'pipe', 'inherit'] })
let observerAlive = true
observer.once('exit', () => {
  observerAlive = false
})
let buffered = ''
observer.stdout!.on('data', (bytes) => {
  buffered += bytes.toString()
  for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
    const line = buffered.slice(0, at)
    buffered = buffered.slice(at + 1)
    try {
      const event = JSON.parse(line) as Event
      if (event.kind === 'windows' && event.id) replies.get(event.id)?.(event.onScreen ?? -1)
      else events.push(event)
    } catch {
      /* Ignore a partial line. */
    }
  }
})
const front = () => [...events].reverse().find((e) => e.kind === 'front')
async function onScreen(pids: number[]): Promise<number> {
  const id = randomUUID()
  const reply = new Promise<number>((resolve) => replies.set(id, resolve))
  observer.stdin!.write(JSON.stringify({ id, windows: pids }) + '\n')
  return Promise.race([reply, delay(2000).then(() => -1)]).finally(() => replies.delete(id))
}
function say(line: string): void {
  process.stdout.write(`[two-space] ${new Date().toISOString()} ${line}\n`)
}

// --- Throwaway browser ---------------------------------------------------------------------
const home = fs.realpathSync(fs.mkdtempSync('/tmp/brocrew-two-space-'))
const fixture = path.join(home, 'space fixture.html')
fs.writeFileSync(fixture, '<title>Fictional space fixture</title><button>Fictional button</button>')
const fixtureUrl = pathToFileURL(fixture).href
const store = createProfileStore({ home })
const owned = new Set<number>()
const dirs = new Set<string>()
const browser = new ChromeBrowser({
  dirOf: store.dirOf,
  extensionsFor: (name) => store.get(name)?.allowExtensions === true,
  syncFor: () => false,
  helperSource,
  helperFor: (name) => store.get(name)?.helper ?? 'on',
  rememberHelper: (name, helper) => store.setHelper(name, helper),
  ...(executable ? { browser: { channel: 'chrome' as const, executablePath: executable } } : {}),
  ua: {
    get: async () => ({ userAgent: 'fictional fixture', chromeVersion: null }),
    invalidate() {},
    peek: () => null,
  },
  launchContext: async (opts) => {
    dirs.add(opts.profileDir)
    const ctx = await launchPersistentChromium(opts)
    const session = await ctx.browser()!.newBrowserCDPSession()
    const info = await session.send('SystemInfo.getProcessInfo')
    const pid = info.processInfo.find((p) => p.type === 'browser')?.id
    // Without its process id this Chrome's windows cannot be attributed: the launch fails.
    if (!Number.isInteger(pid) || pid! <= 0) {
      await ctx.close().catch(() => undefined)
      throw new Error('the test Chrome process id is unavailable')
    }
    owned.add(pid!)
    await session.detach().catch(() => undefined)
    return ctx
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
  guard: () => ({ roots: [home], hostHome: '', mount: '', maxBytes: 1024 }),
})
type Opened = { tabId: string; windowId: number; note?: string }
async function tool(name: string, args: Record<string, unknown>): Promise<Opened> {
  const result = await tools.find((t) => t.definition.name === name)!.execute(args, {})
  const text =
    (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
      ?.text ?? ''
  if (('isError' in result && result.isError) || text.startsWith('Error:')) throw new Error(text)
  return JSON.parse(text)
}
function profile(name: string, extensions: boolean): void {
  if (!store.get(name)) store.create(name, 'panel')
  store.setFlags(name, { enabled: true, allowExtensions: extensions })
}

// --- Observation ---------------------------------------------------------------------------
type Verdict = {
  variant: string
  run: number
  action: string
  ok: boolean
  /** What the person would have seen: another app in front, Chrome activated, a Space change. */
  focus: string[]
  /** Evidence missing, the action failing, or a result the step requires not holding. */
  problems: string[]
  frontAt: Record<string, string>
  result?: unknown
  helper?: string
}
const verdicts: Verdict[] = []
/** TextEdit in front for 3 s; with offscreen true, no test window on the current Space either. */
async function ready(offscreen: boolean, limitMs = 15 * 60_000): Promise<boolean> {
  const until = Date.now() + limitMs
  let since = 0
  while (Date.now() < until && observerAlive) {
    const inFront = front()?.bundle === TEXTEDIT
    const hidden = !offscreen || (await onScreen([...owned])) === 0
    if (inFront && hidden) {
      since ||= Date.now()
      if (Date.now() - since >= 3000) return true
    } else since = 0
    await delay(200)
  }
  return false
}
async function measure(
  variant: string,
  run: number,
  action: string,
  options: { offscreen: boolean; name?: string; expect?: (result: unknown) => string[] },
  act: () => Promise<unknown>,
): Promise<void> {
  const name = options.name ?? 'space-test-1'
  const verdict: Verdict = { variant, run, action, ok: false, focus: [], problems: [], frontAt: {} }
  verdicts.push(verdict)
  if (!(await ready(options.offscreen))) {
    verdict.problems.push('never ready')
    say(`${variant} ${run}/${action}: FAIL never ready`)
    return
  }
  const start = Date.now()
  try {
    verdict.result = await act()
    verdict.problems.push(...(options.expect?.(verdict.result) ?? []))
  } catch (e) {
    verdict.problems.push('the action failed: ' + (e instanceof Error ? e.message : String(e)))
  }
  const t0 = Date.now()
  verdict.frontAt.t0 = front()?.bundle ?? ''
  await delay(Math.max(0, t0 + 1000 - Date.now()))
  verdict.frontAt.t1 = front()?.bundle ?? ''
  await delay(Math.max(0, t0 + 4000 - Date.now()))
  verdict.frontAt.t4 = front()?.bundle ?? ''
  const end = Date.now()
  const seen = events.filter((e) => e.at >= start && e.at <= end)
  if (seen.some((e) => e.kind === 'front' && e.bundle !== TEXTEDIT))
    verdict.focus.push('another app was in front')
  if (seen.some((e) => e.kind === 'activate' && owned.has(e.pid ?? 0)))
    verdict.focus.push('Chrome was activated')
  if (seen.some((e) => e.kind === 'space')) verdict.focus.push('the Space changed')
  // No sample is no evidence: the observer samples every 100 ms.
  const samples = seen.filter((e) => e.kind === 'front').length
  if (!observerAlive || samples < ((end - start) / 100) * 0.7)
    verdict.problems.push(`observer evidence missing (${samples} samples)`)
  if (Object.values(verdict.frontAt).some((bundle) => bundle !== TEXTEDIT))
    verdict.focus.push('TextEdit was not in front at t0, t0+1 s or t0+4 s')
  // Every sample, not just the end, counted against the test's Chrome processes as known when the
  // action ends, so windows shown during a launch are attributed too.
  const fronts = seen.filter((e) => e.kind === 'front')
  const ownedIn = (e: Event) =>
    [...owned].reduce((sum, pid) => sum + (e.chromeWindows?.[String(pid)] ?? 0), 0)
  if (fronts.some((e) => e.chromeWindows === undefined))
    verdict.problems.push('window state unknown during the action')
  else if (fronts.some((e) => ownedIn(e) > 0))
    verdict.focus.push('a test window came on screen during the action')
  if (options.offscreen) {
    const shown = await onScreen([...owned])
    if (shown < 0) verdict.problems.push('window state unknown')
    else if (shown > 0) verdict.focus.push('a test window is on screen')
  }
  const helper = browser.state(name)?.helper
  if (helper) verdict.helper = helper
  verdict.ok = verdict.focus.length === 0 && verdict.problems.length === 0
  say(
    `${variant} ${run}/${action}: ${verdict.ok ? 'PASS' : 'FAIL ' + [...verdict.focus, ...verdict.problems].join('; ')}`,
  )
}
async function batch(variant: string, label: string, body: () => Promise<void>): Promise<void> {
  say(`batch ${variant} started: ${label}. Keep TextEdit in front and don't touch anything.`)
  await body()
  const mine = verdicts.filter((v) => v.variant === variant)
  say(`batch ${variant} done: ${mine.filter((v) => v.ok).length}/${mine.length} passed`)
}

// --- Steps ---------------------------------------------------------------------------------
let windowA: Opened | undefined, windowB: Opened | undefined
async function setupWindows(name: string): Promise<void> {
  windowA = await tool('open_tab', {
    profile: name,
    url: fixtureUrl,
    visible: true,
    newWindow: true,
  })
  windowB = await tool('open_tab', { profile: name, url: fixtureUrl, newWindow: true })
  say(
    `two test windows are open (${windowA.windowId}, ${windowB.windowId}). Move both to Desktop 2, go back to Desktop 1 and click into TextEdit.`,
  )
}
const target = (run: number) => (run % 2 ? windowA! : windowB!)
const helperIs =
  (wanted: string, name = 'space-test-1') =>
  (): string[] => {
    const helper = browser.state(name)?.helper
    return helper === wanted ? [] : [`the helper was ${helper ?? 'absent'}, not ${wanted}`]
  }
/** With the helper on: in the requested window, with no note. */
const placed =
  (wanted: Opened) =>
  (result: unknown): string[] => {
    const tab = result as Opened
    return [
      ...(tab.windowId === wanted.windowId
        ? []
        : [`opened in window ${tab.windowId}, not ${wanted.windowId}`]),
      ...(tab.note ? [`unexpected note: ${tab.note}`] : []),
    ]
  }
/** Without it: wherever Chrome chose, and a note whenever that is not the requested window. */
const fellBack =
  (wanted: Opened, note: string) =>
  (result: unknown): string[] => {
    const tab = result as Opened
    return tab.windowId === wanted.windowId || tab.note?.includes(note)
      ? []
      : [`opened in window ${tab.windowId} with no note naming "${note}"`]
  }
async function placements(
  variant: string,
  name: string,
  expect?: (wanted: Opened) => (result: unknown) => string[],
): Promise<void> {
  for (let run = 1; run <= RUNS; run++)
    await measure(
      variant,
      run,
      'open_tab windowOf',
      { offscreen: true, name, ...(expect ? { expect: expect(target(run)) } : {}) },
      () => tool('open_tab', { profile: name, url: fixtureUrl, windowOf: target(run).tabId }),
    )
}
async function switchOffInChrome(name: string): Promise<void> {
  const page = await browser.newPage(name, { newWindow: false })
  await page.goto('chrome://extensions')
  await page.evaluate(
    (id) =>
      (
        globalThis as unknown as {
          chrome: { management: { setEnabled(id: string, on: boolean): Promise<void> } }
        }
      ).chrome.management.setEnabled(id, false),
    'inepmalcpnmbpdjooamdnkhojadimbgn',
  )
  await page.close()
}
const offNote = 'Settings → Plugins → Chrome'
const steps: Record<string, () => Promise<void>> = {
  // A: the commit before the change; its windowOf fallback is expected to jump at least once.
  A: async () => {
    profile('space-test-1', false)
    await setupWindows('space-test-1')
    await batch('A', 'before the change, cross-window open_tab', () =>
      placements('A', 'space-test-1'),
    )
  },
  // E: visible launches with the helper, before any window exists.
  E: async () => {
    profile('space-test-1', true)
    await batch('E', 'visible launch with the helper', async () => {
      for (let run = 1; run <= 5; run++)
        await measure(
          'E',
          run,
          'launch',
          {
            offscreen: true,
            expect: (result) =>
              (result as { helper?: string }).helper === 'ready'
                ? []
                : ['the helper was not ready'],
          },
          async () => {
            await browser.ensure('space-test-1', 'visible')
            const helper = browser.state('space-test-1')?.helper
            await browser.close('space-test-1')
            return { helper }
          },
        )
    })
    await setupWindows('space-test-1')
  },
  B: () =>
    batch('B', 'helper on, cross-window open_tab', () => placements('B', 'space-test-1', placed)),
  D: () =>
    batch('D', 'open_tab without a window', async () => {
      for (let run = 1; run <= RUNS; run++)
        await measure('D', run, 'open_tab', { offscreen: true }, () =>
          tool('open_tab', { profile: 'space-test-1', url: fixtureUrl }),
        )
    }),
  F: () =>
    batch('F', 'one agent click in window B (recorded only)', async () => {
      const tab = tabs.resolve(windowB!.tabId, (p) => browser.state(p)?.generation ?? null)
      await measure('F', 1, 'click', { offscreen: true }, () => tab.page.click('button'))
    }),
  // S: the helper's worker idle for five minutes, then placements.
  S: async () => {
    say('waiting five minutes with nothing to do (step S)')
    await delay(5 * 60_000)
    await batch('S', 'after five idle minutes', async () => {
      for (let run = 1; run <= 3; run++)
        await measure(
          'S',
          run,
          'open_tab windowOf',
          { offscreen: true, expect: placed(target(run)) },
          () =>
            tool('open_tab', {
              profile: 'space-test-1',
              url: fixtureUrl,
              windowOf: target(run).tabId,
            }),
        )
    })
  },
  // C: switched off in chrome://extensions during the session; placements fall back.
  C: async () => {
    await switchOffInChrome('space-test-1')
    await batch('C', 'helper switched off in chrome://extensions', () =>
      placements('C', 'space-test-1', (wanted) => {
        const check = fellBack(wanted, offNote)
        return (result) => [...check(result), ...helperIs('off')()]
      }),
    )
  },
  // H: restart keeps it off; Turn on brings it back. New windows open, so the person moves them.
  H: async () => {
    await batch('H', 'restart with the helper off', async () => {
      await measure(
        'H',
        1,
        'restart',
        {
          offscreen: true,
          expect: () => [
            ...helperIs('off')(),
            ...(store.get('space-test-1')?.helper === 'off' ? [] : ['the switch was not kept']),
          ],
        },
        async () => {
          await browser.close('space-test-1')
          await browser.ensure('space-test-1', 'visible')
          return { helper: browser.state('space-test-1')?.helper }
        },
      )
    })
    await setupWindows('space-test-1')
    await batch('H', 'placements after the restart, still off', () =>
      placements('H', 'space-test-1', (wanted) => fellBack(wanted, offNote)),
    )
    await batch('H', 'Turn on, then placements', async () => {
      await measure('H', 0, 'turn on', { offscreen: true, expect: helperIs('ready') }, async () => {
        await browser.turnHelperOn('space-test-1')
        return { helper: browser.state('space-test-1')?.helper }
      })
      await placements('H', 'space-test-1', placed)
    })
  },
  // X: a profile with extensions off: no helper, Chrome picks the window.
  X: async () => {
    profile('space-test-2', false)
    await setupWindows('space-test-2')
    await batch('X', 'extensions off, cross-window open_tab', () =>
      placements('X', 'space-test-2', (wanted) => {
        const check = fellBack(wanted, 'Chrome chose the window')
        return (result) => [
          ...check(result),
          ...(browser.state('space-test-2')?.helper ? ['a helper was loaded'] : []),
        ]
      }),
    )
  },
  // G: positive control, run last: show_tab brings Chrome forward on purpose.
  G: () =>
    batch('G', 'show_tab (activation expected)', async () => {
      await measure('G', 1, 'show_tab', { offscreen: true }, () =>
        tool('show_tab', { tabId: windowB!.tabId }),
      )
    }),
}

// --- Run -----------------------------------------------------------------------------------
let fatal = ''
try {
  await Promise.race([
    new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (events.some((e) => e.kind === 'ready')) {
          clearInterval(check)
          resolve()
        }
      }, 50)
    }),
    delay(5000).then(() => {
      throw new Error('observer did not start')
    }),
  ])
  for (const variant of variants) {
    assert(steps[variant], `unknown step ${variant}`)
    await steps[variant]()
  }
} catch (error) {
  fatal = error instanceof Error ? error.message : String(error)
  say(`stopped: ${fatal}`)
} finally {
  await browser.closeAll().catch(() => undefined)
  for (const dir of dirs) await killChromeOf(dir, 1000).catch(() => undefined)
  observer.kill()
  const live = [...owned].filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  fs.rmSync(home, { recursive: true, force: true })
  const summary = Object.fromEntries(
    [...new Set(verdicts.map((v) => v.variant))].map((variant) => {
      const mine = verdicts.filter((v) => v.variant === variant)
      return [
        variant,
        {
          passed: mine.filter((v) => v.ok).length,
          of: mine.length,
          // A must show at least one jump; G must show Chrome activated.
          sawFocusChange: mine.filter((v) => v.focus.length > 0).length,
          withProblems: mine.filter((v) => v.problems.length > 0).length,
        },
      ]
    }),
  )
  fs.writeFileSync(
    receiptPath,
    JSON.stringify(
      {
        source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        variants,
        summary,
        verdicts,
        fatal,
        cleanup: { liveOwnedPids: live, homeRemoved: !fs.existsSync(home) },
        events,
      },
      null,
      2,
    ),
  )
  say(`receipt written: ${JSON.stringify(summary)}`)
}
