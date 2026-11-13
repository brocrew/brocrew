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
    'identifies the created tab when %s fails, so it can be used without opening another',
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
      let error: string
      try {
        error = await h.callError('open_tab', {
          profile: 'fern',
          url: 'https://fixture.test/created',
        })
      } finally {
        fault.mockRestore()
      }
      const tabs = (await h.call('list_tabs')).json as Array<{ tabId: string }>
      expect(tabs).toHaveLength(1)
      expect(error).toContain(`TAB_CREATED ${tabs[0].tabId}:`)
      expect(error).toContain('window operation timed out')
      await h.call('navigate', { tabId: tabs[0].tabId, url: 'https://fixture.test/reused' })
      expect(h.browser.pages.get('fern')).toHaveLength(1)
    },
  )
  it('reports the existing tab and current URL when navigation fails after committing', async () => {
    const h = setup()
    const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
      tabId: string
    }
    const page = h.browser.pages.get('fern')![0]
    const fault = vi.spyOn(page, 'goto').mockImplementation(async (url) => {
      page.urlValue = url
      throw new Error('Timeout 15000ms exceeded')
    })
    try {
      const error = await h.callError('navigate', {
        tabId: opened.tabId,
        url: 'https://fixture.test/committed',
      })
      expect(error).toContain(`NAVIGATION_FAILED ${opened.tabId}:`)
      expect(error).toContain('https://fixture.test/committed')
      expect(error).toContain('Timeout 15000ms exceeded')
      expect(h.browser.pages.get('fern')).toHaveLength(1)
    } finally {
      fault.mockRestore()
    }
  })
})
