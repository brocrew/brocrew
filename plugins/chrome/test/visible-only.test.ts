import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentChromeTools } from '../src/tools/index.js'
import { harness } from './fakes.js'
import { WindowTargetError } from '../src/shared/browser/chromiumWindows.js'

describe('visible Chrome profiles', () => {
  const made: ReturnType<typeof harness>[] = []
  afterEach(async () => {
    for (const h of made.splice(0)) {
      await Promise.all([...h.browser.states.keys()].map((name) => h.browser.close(name)))
      for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
        fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  const setup = () => {
    const h = harness()
    made.push(h)
    h.profile('fern')
    return h
  }
  it('offers no mode switch and rejects the removed visible argument', async () => {
    const h = setup()
    const tools = createAgentChromeTools(h.deps).map((tool) => tool.definition)
    expect(tools.map((tool) => tool.name)).not.toContain('hide_tab')
    expect(
      tools.find((tool) => tool.name === 'open_tab')!.inputSchema.properties,
    ).not.toHaveProperty('visible')
    expect(
      await h.callError('open_tab', {
        profile: 'fern',
        url: 'about:blank',
        visible: false,
      }),
    ).toContain('unknown argument')
  })
  it('reports open state without a browser mode', async () => {
    const h = setup()
    await h.call('open_tab', { profile: 'fern', url: 'about:blank' })
    const profiles = (await h.call('list_browser_profiles')).json as Array<Record<string, unknown>>
    expect(profiles[0]).toMatchObject({ name: 'fern', open: true })
    expect(profiles[0]).not.toHaveProperty('mode')
  })
  it('shows the existing tab without restarting or restoring other pages', async () => {
    const h = setup()
    const selected = (
      await h.call('open_tab', {
        profile: 'fern',
        url: 'https://fixture.test/selected',
      })
    ).json as { tabId: string }
    await h.call('open_tab', { profile: 'fern', url: 'https://fixture.test/other' })
    const pages = [...h.browser.pages.get('fern')!]
    const front = vi.spyOn(pages[0], 'bringToFront')
    const launches = h.browser.launches.length
    await h.call('show_tab', { tabId: selected.tabId })
    expect(h.browser.launches).toHaveLength(launches)
    expect(h.browser.pages.get('fern')).toEqual(pages)
    expect(front).toHaveBeenCalledOnce()
  })
  it.each(['tool admission', 'final window identity'])(
    'returns the created tab successfully when %s fails',
    async (phase) => {
      const h = setup()
      const windowId = h.browser.windowId.bind(h.browser)
      const fault =
        phase === 'tool admission'
          ? vi
              .spyOn(h.browser, 'usePage')
              .mockRejectedValue(new WindowTargetError('window operation timed out'))
          : vi.spyOn(h.browser, 'windowId').mockImplementation(async (profile, page) => {
              if (page.url() === 'https://fixture.test/created')
                throw new WindowTargetError('window operation timed out')
              return windowId(profile, page)
            })
      let result: { tabId: string; note: string }
      try {
        result = (
          await h.call('open_tab', {
            profile: 'fern',
            url: 'https://fixture.test/created',
          })
        ).json as typeof result
      } finally {
        fault.mockRestore()
      }
      const tabs = (await h.call('list_tabs')).json as Array<{ tabId: string }>
      expect(tabs).toHaveLength(1)
      expect(result.tabId).toBe(tabs[0].tabId)
      expect(result.note).toContain('created, focus pending')
      expect(result.note).toContain('window operation timed out')
      await h.call('navigate', { tabId: tabs[0].tabId, url: 'https://fixture.test/reused' })
      expect(h.browser.pages.get('fern')).toHaveLength(1)
    },
  )
  it('returns the created tab while window bookkeeping stays pending', async () => {
    const h = setup()
    const fault = vi.spyOn(h.browser, 'usePage').mockImplementation(() => new Promise(() => {}))
    try {
      const result = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
        tabId: string
        note: string
      }
      expect(result.tabId).toBeTruthy()
      expect(result.note).toContain('created, focus pending')
      expect(h.browser.pages.get('fern')).toHaveLength(1)
    } finally {
      fault.mockRestore()
    }
  })
  it.each(['pending', 'failed'])('returns an existing tab while focus is %s', async (state) => {
    const h = setup()
    const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
      tabId: string
    }
    const page = h.browser.pages.get('fern')![0]
    const fault = vi
      .spyOn(page, 'bringToFront')
      .mockImplementation(() =>
        state === 'pending'
          ? new Promise(() => {})
          : Promise.reject(new Error('fictional focus failure')),
      )
    try {
      const result = (await h.call('show_tab', { tabId: opened.tabId })).json as {
        tabId: string
        note: string
      }
      expect(result.tabId).toBe(opened.tabId)
      expect(result.note).toContain('focus pending')
      if (state === 'failed') expect(result.note).toContain('fictional focus failure')
      expect(h.browser.pages.get('fern')).toHaveLength(1)
    } finally {
      fault.mockRestore()
    }
  })
  it('lists known metadata while fresh title and window lookups remain pending', async () => {
    const h = setup()
    const opened = (
      await h.call('open_tab', { profile: 'fern', url: 'https://fixture.test/known' })
    ).json as { tabId: string }
    const page = h.browser.pages.get('fern')![0]
    const title = vi.spyOn(page, 'title').mockImplementation(() => new Promise(() => {}))
    const window = vi.spyOn(h.browser, 'windowId').mockImplementation(() => new Promise(() => {}))
    try {
      const result = (await h.call('list_tabs')).json as Array<Record<string, unknown>>
      expect(result).toEqual([
        expect.objectContaining({
          tabId: opened.tabId,
          url: 'https://fixture.test/known',
          title: 'Title',
        }),
      ])
      expect(title).not.toHaveBeenCalled()
      expect(window).not.toHaveBeenCalled()
    } finally {
      title.mockRestore()
      window.mockRestore()
    }
  })
  it.each(['pending', 'failed'])(
    'reads a snapshot while window bookkeeping is %s',
    async (state) => {
      const h = setup()
      const opened = (
        await h.call('open_tab', { profile: 'fern', url: 'https://fixture.test/known' })
      ).json as { tabId: string }
      const page = h.browser.pages.get('fern')![0]
      const title = vi.spyOn(page, 'title').mockImplementation(() => new Promise(() => {}))
      const window = vi
        .spyOn(h.browser, 'usePage')
        .mockImplementation(() =>
          state === 'pending'
            ? new Promise(() => {})
            : Promise.reject(new Error('fictional metadata failure')),
        )
      try {
        const result = (await h.call('snapshot', { tabId: opened.tabId })).text as string
        expect(result).toContain('url: https://fixture.test/known')
        expect(result).toContain('title: Title')
        expect(result).toContain('[ref=')
        expect(title).not.toHaveBeenCalled()
        if (state === 'failed') expect(result).toContain('fictional metadata failure')
      } finally {
        title.mockRestore()
        window.mockRestore()
      }
    },
  )
  it.each([true, false])(
    'reports navigation timeout with committed=%s truthfully',
    async (committed) => {
      const h = setup()
      const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
        tabId: string
      }
      const page = h.browser.pages.get('fern')![0]
      const listeners = page.listenerCount('framenavigated')
      const fault = vi.spyOn(page, 'goto').mockImplementation(async (url) => {
        if (committed) {
          page.urlValue = url
          page.emit('framenavigated', page.mainFrame())
        }
        throw Object.assign(new Error('Timeout 15000ms exceeded'), { name: 'TimeoutError' })
      })
      try {
        const args = { tabId: opened.tabId, url: 'https://fixture.test/committed' }
        if (committed) {
          const result = (await h.call('navigate', args)).json
          expect(result).toMatchObject({
            url: args.url,
            title: 'Title',
            navigationError: 'Timeout 15000ms exceeded',
          })
        } else {
          const error = await h.callError('navigate', args)
          expect(error).toContain('Timeout 15000ms exceeded')
          expect(error).toContain('about:blank')
        }
        expect(page.listenerCount('framenavigated')).toBe(listeners)
        expect(h.browser.pages.get('fern')).toHaveLength(1)
      } finally {
        fault.mockRestore()
      }
    },
  )
  it('preserves a non-timeout navigation error even if the URL changes', async () => {
    const h = setup()
    const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
      tabId: string
    }
    const page = h.browser.pages.get('fern')![0]
    const listeners = page.listenerCount('framenavigated')
    const fault = vi.spyOn(page, 'goto').mockImplementation(async (url) => {
      page.urlValue = url
      page.emit('framenavigated', page.mainFrame())
      throw new Error('net::ERR_UNKNOWN_URL_SCHEME')
    })
    try {
      const error = await h.callError('navigate', {
        tabId: opened.tabId,
        url: 'fictional-unsupported:page',
      })
      expect(error).toContain(`NAVIGATION_FAILED ${opened.tabId}:`)
      expect(error).toContain('net::ERR_UNKNOWN_URL_SCHEME')
      expect(page.listenerCount('framenavigated')).toBe(listeners)
    } finally {
      fault.mockRestore()
    }
  })
})
