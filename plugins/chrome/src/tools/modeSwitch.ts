import type { Cookie, Page } from 'playwright-core'
import { DEFAULT_TIMEOUT_MS } from './common.js'
import type { ToolDeps } from './common.js'
import { generationOf } from './common.js'
export type SwitchDeps = Pick<ToolDeps, 'browser' | 'tabs' | 'now'>
export const MAX_REOPEN = 20
export const TITLE_RESERVE_MS = 8000
export const MIN_GOTO_MS = 500
export const nowMs = (deps: Pick<ToolDeps, 'now'>): number =>
  (deps.now ?? (() => new Date()))().getTime()
export interface Reopened {
  tabId: string
  url: string
  reopened: boolean
  note?: string
}
export async function reopenTabs(
  deps: SwitchDeps,
  profile: string,
  generation: number,
  tabs: Array<{
    id: string
    url: string
  }>,
  deadline: number,
  beforeLoad?: (page: Page) => Promise<void>,
): Promise<Reopened[]> {
  const out: Reopened[] = []
  let primed = false
  for (const t of tabs) {
    const left = deadline - nowMs(deps)
    if (left < MIN_GOTO_MS) {
      out.push({ tabId: t.id, url: t.url, reopened: false, note: 'no time left' })
      continue
    }
    try {
      const page = await deps.browser.newPage(profile, { newWindow: false })
      if (beforeLoad && !primed) {
        primed = true
        await beforeLoad(page).catch(() => undefined)
      }
      deps.tabs.add(profile, generation, page, t.id)
      if (t.url !== 'about:blank')
        await page
          .goto(t.url, {
            waitUntil: 'domcontentloaded',
            timeout: Math.min(DEFAULT_TIMEOUT_MS, left),
          })
          .catch(() => undefined)
      out.push({ tabId: t.id, url: page.url(), reopened: true })
    } catch {
      out.push({ tabId: t.id, url: t.url, reopened: false })
    }
  }
  return out
}
export async function sessionCookies(page: Page): Promise<Cookie[] | null> {
  try {
    return (await page.context().cookies()).filter((c) => c.expires === -1)
  } catch {
    return null
  }
}
export function restoreCookies(cookies: Cookie[]): (page: Page) => Promise<void> {
  return async (page) => {
    if (cookies.length > 0) await page.context().addCookies(cookies)
  }
}
export function profileTabs(
  deps: SwitchDeps,
  profile: string,
): Array<{
  id: string
  url: string
}> {
  return deps.tabs
    .list(generationOf(deps), profile)
    .slice(0, MAX_REOPEN)
    .map((t) => ({ id: t.id, url: t.page.url() }))
}
