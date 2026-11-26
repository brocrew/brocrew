import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { afterEach, expect, it, vi } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { FakePage, harness } from './fakes.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})

async function startWithRestoredTab(
  watchBeforeStart: boolean,
  windowReply?: Promise<{ windowId: number }>,
) {
  const h = harness()
  h.profile('fern', { enabled: true })
  const routing = Promise.withResolvers<void>()
  const restored = Object.assign(new FakePage(), {
    urlValue: 'https://fictional.invalid/restored',
    context: (): BrowserContext => context as unknown as BrowserContext,
  })
  let delayRouting = false
  const session = Object.assign(new EventEmitter(), {
    async send() {
      if (delayRouting) await routing.promise
    },
  })
  const driver = Object.assign(new EventEmitter(), {
    newBrowserCDPSession: async () => session,
  })
  const context = Object.assign(new EventEmitter(), {
    pages: () => [restored],
    browser: () => driver,
    newCDPSession: async () => ({
      send: () => windowReply ?? Promise.resolve({ windowId: 4 }),
      detach: async () => undefined,
    }),
    async close() {
      context.emit('close')
    },
  })
  const browser = new ChromeBrowser({
    dirOf: h.store.dirOf,
    lockHeld: async () => false,
    launchContext: async () => context as unknown as BrowserContext,
  })
  cleanups.push(async () => {
    routing.resolve()
    await browser.closeAll()
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  })
  if (watchBeforeStart) h.tabs.watch('fern', browser)
  await browser.ensure('fern')
  if (!windowReply) {
    await vi.waitFor(() => {
      expect(browser.knownWindowId('fern', restored as unknown as Page)).toBe(4)
    })
  }
  const tools = createAgentChromeTools({ ...h.deps, browser })
  const call = async (name: string, args: Record<string, string>) => {
    const tool = tools.find((candidate) => candidate.definition.name === name)!
    const response = await tool.execute(args, {})
    const content = response.content as Array<{ text: string }>
    return JSON.parse(content[0].text)
  }
  return {
    list: () => call('list_tabs', { profile: 'fern' }),
    listProfiles: () => call('list_browser_profiles', {}),
    delayRouting: () => {
      delayRouting = true
    },
    releaseRouting: routing.resolve,
  }
}

const restoredTab = { profile: 'fern', url: 'https://fictional.invalid/restored', windowId: 4 }

it('lists the already-restored tab on the first call after Chrome starts', async () => {
  const h = await startWithRestoredTab(false)
  expect(await h.list()).toMatchObject([restoredTab])
})

it.each([
  {
    inventory: 'the restored tab with its real window',
    call: 'list' as const,
    watchBeforeStart: true,
    expected: restoredTab,
  },
  {
    inventory: 'the running profile',
    call: 'listProfiles' as const,
    watchBeforeStart: false,
    expected: { name: 'fern', enabled: true, open: true },
  },
])('lists $inventory after startup while download routing is held', async (scenario) => {
  const { call, watchBeforeStart, expected } = scenario
  const h = await startWithRestoredTab(watchBeforeStart)
  h.delayRouting()
  const result = h[call]()
  try {
    const pending = Symbol('waiting for Chrome')
    expect(
      await Promise.race([result, new Promise((resolve) => setImmediate(() => resolve(pending)))]),
    ).toMatchObject([expected])
  } finally {
    h.releaseRouting()
    await result
  }
})

it('publishes the real window once a late Chrome reply arrives', async () => {
  vi.useFakeTimers()
  const windowReply = Promise.withResolvers<{ windowId: number }>()
  try {
    const h = await startWithRestoredTab(false, windowReply.promise)
    expect(await h.list()).toMatchObject([{ ...restoredTab, windowId: null }])
    await vi.advanceTimersByTimeAsync(10_001)
    windowReply.resolve({ windowId: 4 })
    await vi.advanceTimersByTimeAsync(0)
    expect(await h.list()).toMatchObject([restoredTab])
  } finally {
    windowReply.resolve({ windowId: 4 })
    vi.useRealTimers()
  }
})
