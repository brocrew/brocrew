import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserContext, Page } from 'playwright-core'
import { FakeDownload, harness } from './fakes.js'
import { buildToolDefs } from '../src/tools/index.js'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
const fixtures: ReturnType<typeof harness>[] = []
const routedBrowsers: ChromeBrowser[] = []
afterEach(async () => {
  for (const browser of routedBrowsers.splice(0)) await browser.closeAll()
  for (const h of fixtures.splice(0)) {
    await h.browser.close('fern')
    for (const root of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(root, { recursive: true, force: true })
  }
})
async function setup(visible = false) {
  const h = harness()
  fixtures.push(h)
  h.profile('fern', { enabled: true })
  const opened = (
    await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/', visible })
  ).json as { tabId: string }
  const page = h.browser.pages.get('fern')![0]
  let active = false
  let armed!: () => void
  const ready = new Promise<void>((resolve) => {
    armed = resolve
  })
  h.browser.captureDownloads = async <T>(_profile: string, _page: Page, fn: () => Promise<T>) => {
    active = true
    armed()
    try {
      return await fn()
    } finally {
      active = false
    }
  }
  const download = (name: string) => {
    const file = path.join(h.home, name)
    fs.writeFileSync(file, 'fictional bytes')
    return new FakeDownload(name, Buffer.from('fictional bytes'), file)
  }
  return { h, page, tabId: opened.tabId, active: () => active, ready, download }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
async function routed(visible = true) {
  const f = await setup(visible)
  const native = path.join(f.h.home, 'routed-downloads')
  const profile = path.join(f.h.home, 'routed-profiles', 'fern')
  fs.mkdirSync(profile, { recursive: true })
  let stage = ''
  let ended = false
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async () => undefined),
  })
  const driver = Object.assign(new EventEmitter(), {
    newBrowserCDPSession: async () => session,
    isConnected: () => !ended,
  })
  const context = Object.assign(new EventEmitter(), {
    browser: () => driver,
    pages: () => [],
    newCDPSession: async () => ({
      send: async () => ({ frameTree: { frame: { id: 'fern-frame' } } }),
      detach: async () => undefined,
    }),
    close: async () => {
      ended = true
      context.emit('close')
    },
  })
  const browser = new ChromeBrowser({
    dirOf: () => profile,
    downloadsRoot: native,
    homedir: () => f.h.home,
    lockHeld: async () => false,
    killChrome: async () => {
      throw new Error('No real browser should be ended')
    },
    ua: {
      get: async () => ({ userAgent: 'fictional', chromeVersion: '1' }),
      invalidate() {},
      peek: () => null,
    },
    launchContext: async (options) => {
      stage = options.downloadsPath!
      return context as unknown as BrowserContext
    },
  })
  routedBrowsers.push(browser)
  await browser.ensure('fern', visible ? 'visible' : 'headless')
  f.h.browser.captureDownloads = browser.captureDownloads.bind(browser)
  const begin = (guid: string, name = 'fresh.txt') => {
    fs.writeFileSync(path.join(stage, guid), 'fresh bytes')
    session.emit('Browser.downloadWillBegin', {
      guid,
      frameId: 'fern-frame',
      suggestedFilename: name,
    })
  }
  const complete = (guid: string) =>
    session.emit('Browser.downloadProgress', {
      guid,
      receivedBytes: 11,
      totalBytes: 11,
      state: 'completed',
    })
  return { ...f, stage, native, session, begin, complete }
}
it.each([false, true])(
  'arms capture before navigation and saves its download (navigation abort=%s)',
  async (aborted) => {
    const f = await setup()
    const download = f.download('paper.txt')
    f.page.goto = vi.fn(async () => {
      expect(f.active()).toBe(true)
      f.page.emit('download', download)
      if (aborted) throw new Error('net::ERR_ABORTED; Download is starting')
      return { status: () => 200 }
    })
    const result = (
      await f.h.call('download', { tabId: f.tabId, url: 'https://fictional.invalid/paper.txt' })
    ).json as { path: string; bytes: number }
    expect(fs.readFileSync(result.path, 'utf8')).toBe('fictional bytes')
    expect(download.deleted).toBe(true)
    expect(f.active()).toBe(false)
  },
)
it('arms a fresh headless wait instead of consuming an earlier denied download', async () => {
  const f = await setup()
  const stale = f.download('denied.txt')
  const deniedPath = vi
    .spyOn(stale, 'path')
    .mockRejectedValue(new Error('fictional denied download'))
  const tab = f.h.tabs.resolve(f.tabId, (profile) => f.h.browser.state(profile)?.generation ?? null)
  tab.pendingDownloads.push({ download: stale as never, at: Date.now() })
  const pending = f.h.call('wait_for_download', { tabId: f.tabId })
  await f.ready
  expect(f.active()).toBe(true)
  f.page.emit('download', f.download('fresh.txt'))
  const result = (await pending).json as { path: string }
  expect(fs.readFileSync(result.path, 'utf8')).toBe('fictional bytes')
  expect(deniedPath).not.toHaveBeenCalled()
  expect(f.active()).toBe(false)
})
it('guides agent downloads to one call and reserves waits for independent events', async () => {
  const f = await setup()
  const definition = buildToolDefs().find((d) => d.spec.name === 'wait_for_download')!
  expect(definition.spec.description).toContain('page timer')
  expect(definition.spec.description).toContain('user in a visible window')
  expect(definition.spec.description).toContain('use download with ref or url')
  expect(definition.spec.description).toContain('Only one tool call runs at a time')
  expect(definition.spec.description).not.toMatch(/parallel|start this wait before the action/i)
  await expect(
    f.h.call('download', { tabId: f.tabId, ref: 'e1', url: 'https://fictional.invalid/' }),
  ).rejects.toThrow('give exactly one')
  expect(f.active()).toBe(false)
})

it('retains an earlier visible-window download without waiting for another event', async () => {
  const f = await setup(true)
  const saved = f.download('visible.txt')
  const tab = f.h.tabs.resolve(f.tabId, (profile) => f.h.browser.state(profile)?.generation ?? null)
  tab.pendingDownloads.push({ download: saved as never, at: Date.now() })
  const result = (await f.h.call('wait_for_download', { tabId: f.tabId })).json as { path: string }
  expect(fs.readFileSync(result.path, 'utf8')).toBe('fictional bytes')
  expect(saved.deleted).toBe(true)
})

it.each([false, true])(
  'saving a queued download preserves a fresh user download (completed before save=%s)',
  async (completed) => {
    const f = await routed()
    const olderPath = path.join(f.stage, 'older-guid')
    fs.writeFileSync(olderPath, 'older bytes')
    const older = new FakeDownload('older.txt', Buffer.from('older bytes'), olderPath)
    const preparing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.spyOn(older, 'path').mockImplementation(async () => {
      preparing.resolve()
      await release.promise
      return olderPath
    })
    const tab = f.h.tabs.resolve(f.tabId, (name) => f.h.browser.state(name)?.generation ?? null)
    tab.pendingDownloads.push({ download: older as never, at: Date.now() })
    const saving = f.h.call('wait_for_download', { tabId: f.tabId })
    try {
      await preparing.promise
      f.begin('fresh-guid')
      await flush()
      if (completed) f.complete('fresh-guid')
    } finally {
      release.resolve()
    }
    const result = (await saving).json as { path: string }
    expect(fs.readFileSync(result.path, 'utf8')).toBe('older bytes')
    if (!completed) f.complete('fresh-guid')
    await vi.waitFor(() =>
      expect(fs.readFileSync(path.join(f.native, 'fresh.txt'), 'utf8')).toBe('fresh bytes'),
    )
    expect(f.session.send).not.toHaveBeenCalledWith('Browser.cancelDownload', {
      guid: 'fresh-guid',
    })
  },
)

it('releases a fresh claim after saving that same download', async () => {
  const f = await routed()
  const fresh = new FakeDownload(
    'fresh.txt',
    Buffer.from('fresh bytes'),
    path.join(f.stage, 'fresh-guid'),
  )
  f.page.goto = vi.fn(async () => {
    f.begin('fresh-guid')
    await flush()
    f.page.emit('download', fresh)
    return { status: () => 200 }
  })
  const result = (
    await f.h.call('download', { tabId: f.tabId, url: 'https://fictional.invalid/fresh.txt' })
  ).json as { path: string }
  expect(fs.readFileSync(result.path, 'utf8')).toBe('fresh bytes')
  f.complete('fresh-guid')
  await vi.waitFor(() => expect(fs.existsSync(path.join(f.stage, 'fresh-guid'))).toBe(false))
  expect(fs.existsSync(path.join(f.native, 'fresh.txt'))).toBe(false)
  expect(f.session.send).not.toHaveBeenCalledWith('Browser.cancelDownload', {
    guid: 'fresh-guid',
  })
})

it('keeps a user download when the wait times out before receiving its event', async () => {
  const f = await routed()
  const armed = Promise.withResolvers<void>()
  const event = Promise.withResolvers<never>()
  f.page.waitForEvent = vi.fn(() => {
    armed.resolve()
    return event.promise
  })
  const failed = expect(f.h.call('wait_for_download', { tabId: f.tabId })).rejects.toThrow(
    'timed out',
  )
  await armed.promise
  f.begin('fresh-guid')
  await flush()
  event.reject(Object.assign(new Error('fictional timeout'), { name: 'TimeoutError' }))
  await failed
  f.complete('fresh-guid')
  await vi.waitFor(() =>
    expect(fs.readFileSync(path.join(f.native, 'fresh.txt'), 'utf8')).toBe('fresh bytes'),
  )
})
