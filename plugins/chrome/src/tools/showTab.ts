import { browserIdentity, fenceToolDefs } from './authorization.js'
import { generationOf, tabId, titleOf, usableProfile } from './common.js'
import type { ToolDef, ToolDeps } from './common.js'
const WATCH_MS = 6 * 60 * 60 * 1000
const watched = new WeakMap<object, Set<string>>()
export function watchWindow(deps: Pick<ToolDeps, 'browser' | 'logger'>, profile: string): void {
  const state = deps.browser.state(profile)
  if (!state) return
  const key = `${profile}:${state.generation}`
  const identity = browserIdentity(deps.browser)
  let set = watched.get(identity)
  if (!set) {
    set = new Set()
    watched.set(identity, set)
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
export function buildShowTabDefs(): ToolDef[] {
  return fenceToolDefs([
    {
      spec: {
        name: 'show_tab',
        description:
          'Bring an existing tab and its Chrome window to the front. Returns {tabId, url, title} without restarting Chrome or reopening other tabs.',
        props: { tabId },
        required: ['tabId'],
      },
      async run(a, deps) {
        const id = a.tabId as string
        const profile = deps.tabs.resolve(id, generationOf(deps)).profile
        return deps.browser.exclusive(profile, async () => {
          usableProfile(deps, profile)
          const tab = deps.tabs.resolve(id, generationOf(deps))
          await deps.browser.usePage(profile, tab.page)
          await tab.page.bringToFront()
          watchWindow(deps, profile)
          return { json: { tabId: id, url: tab.page.url(), title: await titleOf(tab.page) } }
        })
      },
    },
  ])
}
