import fs from 'node:fs'
import path from 'node:path'
import { afterEach } from 'vitest'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { harness } from './fakes.js'

describe('window-targeted tools and local navigation', () => {
  const made: ReturnType<typeof harness>[] = []
  afterEach(async () => {
    for (const h of made.splice(0)) {
      await Promise.all([...h.browser.states.keys()].map((p) => h.browser.close(p)))
      for (const d of [h.home, path.dirname(h.downloads), h.uploadRoot])
        fs.rmSync(d, { recursive: true, force: true })
    }
  })
  const setup = () => {
    const h = harness()
    made.push(h)
    return h
  }
  it('reports native default IDs and exact explicit targets under revised placement contract', async () => {
    const h = setup()
    h.profile('p')
    const open = async (args = {}) =>
      (await h.call('open_tab', { profile: 'p', url: 'about:blank', ...args })).json as {
        tabId: string
        windowId: number
      }
    const a = await open({ visible: true, newWindow: true })
    const b = await open()
    const c = await open({ newWindow: true })
    const d = await open()
    expect([a.windowId, b.windowId]).toEqual([a.windowId, a.windowId])
    expect(c.windowId).not.toBe(a.windowId)
    expect(d.windowId).toBe(a.windowId)
    await h.call('list_tabs')
    expect((await open()).windowId).toBe(a.windowId)
    await h.call('snapshot', { tabId: a.tabId })
    expect((await open()).windowId).toBe(a.windowId)
    expect((await open({ windowOf: c.tabId })).windowId).toBe(c.windowId)
    expect((await h.call('list_tabs')).json).toEqual(
      expect.arrayContaining([expect.objectContaining({ tabId: a.tabId, windowId: a.windowId })]),
    )
  })
  it('returns placement and explicit fallback notes without hiding later failures', async () => {
    const h = setup()
    h.profile('p')
    const a = (
      await h.call('open_tab', { profile: 'p', url: 'about:blank', visible: true, newWindow: true })
    ).json as { tabId: string; windowId: number }
    const c = (await h.call('open_tab', { profile: 'p', url: 'about:blank', newWindow: true }))
      .json as { tabId: string; windowId: number }
    const plain = (await h.call('open_tab', { profile: 'p', url: 'about:blank' })).json as {
      note: string
    }
    expect(plain.note).toContain('different window')
    const explicit = (
      await h.call('open_tab', { profile: 'p', url: 'about:blank', windowOf: c.tabId })
    ).json as { note: string }
    expect(explicit.note).toContain('may bring Chrome')
    h.browser.usePage = async () => {
      throw new Error('fictional admission failure')
    }
    expect(
      await h.callError('open_tab', { profile: 'p', url: 'about:blank', windowOf: a.tabId }),
    ).toContain('may bring Chrome')
  })
  it('rejects conflict, foreign/unknown/closed selectors without opening or switching profiles', async () => {
    const h = setup()
    h.profile('p')
    h.profile('q')
    const a = (await h.call('open_tab', { profile: 'p', url: 'about:blank' })).json as {
      tabId: string
    }
    expect(
      await h.callError('open_tab', {
        profile: 'p',
        url: 'about:blank',
        newWindow: true,
        windowOf: a.tabId,
      }),
    ).toMatch(/either/)
    expect(
      await h.callError('open_tab', {
        profile: 'q',
        url: 'about:blank',
        visible: true,
        windowOf: a.tabId,
      }),
    ).toMatch(/requested profile/)
    expect(h.browser.state('q')).toBeNull()
    expect(
      await h.callError('open_tab', {
        profile: 'p',
        url: 'about:blank',
        windowOf: 't999',
      }),
    ).toMatch(/unknown/)
    await h.call('close_tab', { tabId: a.tabId })
    expect(
      await h.callError('open_tab', {
        profile: 'p',
        url: 'about:blank',
        windowOf: a.tabId,
      }),
    ).toMatch(/no longer exists/)
  })
  it('normalizes local navigation but refuses local downloads before fetch', async () => {
    const h = setup()
    h.profile('p')
    const file = '/tmp/a space/é#?.html'
    const a = (await h.call('open_tab', { profile: 'p', url: file })).json as {
      tabId: string
      url: string
    }
    expect(a.url).toBe(pathToFileURL(file).href)
    await h.call('navigate', {
      tabId: a.tabId,
      url: 'file:///tmp/é space.html',
    })
    expect(h.browser.pages.get('p')![0].url()).toBe('file:///tmp/%C3%A9%20space.html')
    expect(await h.callError('download_url', { tabId: a.tabId, url: file })).toContain(
      'file URLs and local paths are not supported',
    )
  })
  it('refuses HTTP redirects to local files before a second fetch', async () => {
    const h = setup()
    h.profile('p')
    const a = (await h.call('open_tab', { profile: 'p', url: 'about:blank' })).json as {
      tabId: string
    }
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'file:///tmp/not-read.html' },
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    try {
      expect(
        await h.callError('download_url', {
          tabId: a.tabId,
          url: 'https://fixture.test/file',
        }),
      ).toContain('file URLs and local paths are not supported')
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('restores the selected anchor first even when it was beyond the mode-switch tab budget', async () => {
    const h = setup()
    h.profile('p')
    const ids: string[] = []
    for (let i = 0; i < 21; i++)
      ids.push(
        (
          (
            await h.call('open_tab', {
              profile: 'p',
              url: `https://fixture.test/${i}`,
            })
          ).json as { tabId: string }
        ).tabId,
      )
    const out = (
      await h.call('open_tab', {
        profile: 'p',
        url: 'about:blank',
        visible: true,
        windowOf: ids[20],
      })
    ).json as { restoredTabs: Array<{ tabId: string }> }
    expect(out.restoredTabs[0].tabId).toBe(ids[20])
    expect(out.restoredTabs).toHaveLength(20)
    expect((await h.call('snapshot', { tabId: ids[20] })).text).toContain('https://fixture.test/20')
  })
})

describe('queued anchor validation', () => {
  it.each(['page close', 'profile restart'])(
    'rechecks an anchor after queued %s before any new launch/tab',
    async (change) => {
      const h = harness()
      h.profile('fern')
      try {
        const a = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
          tabId: string
        }
        let release!: () => void
        const gate = new Promise<void>((r) => {
          release = r
        })
        const before = h.browser.exclusive('fern', async () => {
          await gate
          if (change === 'page close') await h.browser.pages.get('fern')![0].close()
          else await h.browser.close('fern')
        })
        const pending = h.callError('open_tab', {
          profile: 'fern',
          url: 'about:blank',
          visible: true,
          windowOf: a.tabId,
        })
        release()
        await before
        expect(await pending).toMatch(/no longer exists|unknown/)
        expect(h.browser.launches).toHaveLength(1)
      } finally {
        await Promise.all([...h.browser.states.keys()].map((p) => h.browser.close(p)))
        for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
          fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})

it.each(['navigate', 'download_url'])(
  'does not perform %s after revocation during awaited window metadata',
  async (tool) => {
    const h = harness()
    h.profile('fern')
    const fetcher = vi.fn()
    try {
      const a = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
        tabId: string
      }
      const page = h.browser.pages.get('fern')![0]
      const before = page.gotos.length
      let release!: () => void, entered!: () => void
      const gate = new Promise<void>((r) => {
          release = r
        }),
        ready = new Promise<void>((r) => {
          entered = r
        })
      vi.spyOn(h.browser, 'usePage').mockImplementation(async () => {
        entered()
        await gate
      })
      vi.stubGlobal('fetch', fetcher)
      const pending = h.callError(tool, {
        tabId: a.tabId,
        url: 'https://fictional.invalid/',
      })
      await ready
      h.store.setFlags('fern', { enabled: false })
      release()
      expect(await pending).toContain('not enabled')
      expect(page.gotos).toHaveLength(before)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
      await Promise.all([...h.browser.states.keys()].map((p) => h.browser.close(p)))
      for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
        fs.rmSync(dir, { recursive: true, force: true })
    }
  },
)

it.each(['console', 'network', 'handle_dialog', 'wait_for_download'])(
  '%s updates preference just like other page tools',
  async (tool) => {
    const h = harness()
    h.profile('fern')
    try {
      const open = (args = {}) =>
        h
          .call('open_tab', { profile: 'fern', url: 'about:blank', ...args })
          .then((r) => r.json as { tabId: string; windowId: number })
      const a = await open({ visible: true, newWindow: true }),
        c = await open({ newWindow: true })
      expect(a.windowId).not.toBe(c.windowId)
      if (tool === 'wait_for_download')
        expect(await h.callError(tool, { tabId: a.tabId, timeoutMs: 1 })).toContain('timed out')
      else
        await h.call(tool, {
          tabId: a.tabId,
          ...(tool === 'handle_dialog' ? { accept: true } : {}),
        })
      expect((await open()).windowId).toBe(a.windowId)
    } finally {
      await Promise.all([...h.browser.states.keys()].map((p) => h.browser.close(p)))
      for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
        fs.rmSync(dir, { recursive: true, force: true })
    }
  },
)
