import { ToolError } from './schema.js'
import { generationOf, tabId, titleOf, usableProfile } from './common.js'
import type { ToolDef, ToolDeps } from './common.js'
import { nowMs, profileTabs, reopenTabs, restoreCookies, sessionCookies } from './modeSwitch.js'
import type { BrowserMode } from '../browser/profileBrowser.js'
const SWITCH_MS = 45000
const WATCH_MS = 6 * 60 * 60 * 1000
const watched = new WeakMap<object, Set<string>>()
async function infoOf(deps: ToolDeps, id: string): Promise<Record<string, unknown>> {
  const tab = deps.tabs.resolve(id, generationOf(deps))
  return { tabId: id, url: tab.page.url(), title: await titleOf(tab.page) }
}
async function switchTo(deps: ToolDeps, id: string, mode: BrowserMode): Promise<void> {
  const profile = deps.tabs.resolve(id, generationOf(deps)).profile
  await deps.browser.exclusive(profile, async () => {
    usableProfile(deps, profile)
    const tab = deps.tabs.resolve(id, generationOf(deps))
    if (deps.browser.state(profile)?.mode !== mode) {
      const known = [
        { id, url: tab.page.url() },
        ...profileTabs(deps, profile).filter((t) => t.id !== id),
      ]
      const jar = (await sessionCookies(tab.page)) ?? []
      usableProfile(deps, profile)
      const { generation } = await deps.browser.ensure(profile, mode)
      usableProfile(deps, profile)
      const restored = await reopenTabs(
        deps,
        profile,
        generation,
        known,
        nowMs(deps) + SWITCH_MS,
        restoreCookies(jar),
      )
      if (!restored.find((t) => t.tabId === id)?.reopened)
        throw new ToolError(
          `the page could not be opened again after the switch; the profile is now ${mode} — try open_tab again`,
        )
    }
    if (mode === 'visible') await deps.tabs.resolve(id, generationOf(deps)).page.bringToFront()
  })
}
export function watchWindow(deps: Pick<ToolDeps, 'browser' | 'logger'>, profile: string): void {
  const state = deps.browser.state(profile)
  if (!state || state.mode !== 'visible') return
  const key = `${profile}:${state.generation}`
  let set = watched.get(deps.browser)
  if (!set) {
    set = new Set()
    watched.set(deps.browser, set)
  }
  if (set.has(key)) return
  set.add(key)
  void (async () => {
    try {
      for (;;) {
        const r = await deps.browser.waitAllPagesClosed(profile, WATCH_MS)
        if (r === 'pages-closed') break
      }
      deps.logger?.info('visible window', { profile, step: 'closed' })
      await deps.browser.exclusive(profile, async () => {
        const now = deps.browser.state(profile)
        if (now && now.generation === state.generation) await deps.browser.close(profile)
      })
    } catch {
      // The browser may already have ended.
    } finally {
      set.delete(key)
    }
  })()
}
export function buildShowHideDefs(): ToolDef[] {
  return [
    {
      spec: {
        name: 'show_tab',
        description:
          'Put this tab in front of the user: the profile is shown in a visible Chrome window on the same page, under the same tab ids and session, and the window is brought to the front. Returns {tabId, url, title} at once and never waits for the user. Tell the user in your own conversation what to do in the window (for example a 2FA or passkey step), watch the page yourself (snapshot, wait_for, the URL) and call hide_tab when you are done. Your tools keep working on the visible profile. If the profile is already visible this only brings the window to the front. Closing the window sends the profile back to headless (its tabs are gone then, use open_tab). A visible profile is never idle-closed. Form state of open pages is lost in the switch.',
        props: { tabId },
        required: ['tabId'],
      },
      async run(a, deps) {
        const id = a.tabId as string
        const profile = deps.tabs.resolve(id, generationOf(deps)).profile
        usableProfile(deps, profile)
        deps.browser.touch(profile)
        await switchTo(deps, id, 'visible')
        watchWindow(deps, profile)
        deps.browser.touch(profile)
        return { json: await infoOf(deps, id) }
      },
    },
    {
      spec: {
        name: 'hide_tab',
        description:
          "Take this tab away from the user again: the profile goes back to headless on the current page, under the same tab ids, cookies and session. Returns {tabId, url, title} at once. If the profile is already headless this does nothing. Call it when the user's step is done. Form state of open pages is lost in the switch.",
        props: { tabId },
        required: ['tabId'],
      },
      async run(a, deps) {
        const id = a.tabId as string
        const profile = deps.tabs.resolve(id, generationOf(deps)).profile
        usableProfile(deps, profile)
        deps.browser.touch(profile)
        await switchTo(deps, id, 'headless')
        deps.browser.touch(profile)
        return { json: await infoOf(deps, id) }
      },
    },
  ]
}
