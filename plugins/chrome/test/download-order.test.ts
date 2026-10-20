import fs from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import { FakeDownload, harness } from './fakes.js'
import { buildToolDefs } from '../src/tools/index.js'
const fixtures: ReturnType<typeof harness>[] = []
afterEach(async () => {
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
it('describes headless capture-before-trigger and refuses an ambiguous trigger', async () => {
  const f = await setup()
  const definition = buildToolDefs().find((d) => d.spec.name === 'wait_for_download')!
  expect(definition.spec.description).toContain('start this wait before the action')
  expect(definition.spec.description).not.toContain('Call it right after')
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
