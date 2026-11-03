import fs from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { FakeDownload, harness } from './fakes.js'

it('arms ordinary agent navigation at the tool boundary before page work, and releases after errors', async () => {
  const h = harness()
  try {
    h.profile('fern', { enabled: true })
    const opened = (
      await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
    ).json as { tabId: string }
    const page = h.browser.pages.get('fern')![0]
    let active = false
    const calls: string[][] = []
    Object.assign(h.browser, {
      agentCall: async <T>(profiles: string[], fn: () => Promise<T>) => {
        calls.push(profiles)
        active = true
        try {
          return await fn()
        } finally {
          active = false
        }
      },
    })
    page.goto = vi.fn(async () => {
      expect(active).toBe(true)
      throw new Error('fictional navigation failure')
    })
    await expect(
      h.call('navigate', { tabId: opened.tabId, url: 'https://fictional.invalid/paper' }),
    ).rejects.toThrow()
    expect(calls).toEqual([['fern']])
    expect(page.goto).toHaveBeenCalledOnce()
    expect(active).toBe(false)
  } finally {
    await h.browser.close('fern')
    for (const root of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(root, { recursive: true, force: true })
  }
})
it('does not queue, cap or delete native Chrome downloads, while private pending downloads remain available', async () => {
  const h = harness()
  try {
    h.profile('fern', { enabled: true })
    const opened = (
      await h.call('open_tab', { profile: 'fern', url: 'https://fictional.invalid/' })
    ).json as { tabId: string }
    const page = h.browser.pages.get('fern')![0]
    let privateCall = false
    Object.assign(h.browser, { downloadIsPrivate: async () => privateCall })
    const normal = new FakeDownload('fictional-paper.pdf', Buffer.from('fictional PDF'))
    for (let i = 0; i < 30; i++) page.emit('download', normal)
    await new Promise((r) => setImmediate(r))
    const tab = h.tabs.resolve(opened.tabId, (name) => h.browser.state(name)?.generation ?? null)
    expect(tab.pendingDownloads).toEqual([])
    expect(normal.deleted).toBe(false)
    privateCall = true
    page.emit('download', normal)
    await new Promise((r) => setImmediate(r))
    expect(tab.pendingDownloads).toHaveLength(1)
  } finally {
    await h.browser.close('fern')
    for (const root of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(root, { recursive: true, force: true })
  }
})
