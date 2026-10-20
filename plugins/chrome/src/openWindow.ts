import type { ProfileBrowser } from './browser/profileBrowser.js'
import type { Logger } from './logger.js'
import {
  nowMs,
  profileTabs,
  reopenTabs,
  restoreCookies,
  sessionCookies,
} from './tools/modeSwitch.js'
import type { SwitchDeps } from './tools/modeSwitch.js'
import { watchWindow } from './tools/showHide.js'
import type { TabRegistry } from './tabs.js'
export const OPEN_START_URL = 'https://www.google.com/'
const SWITCH_MS = 45000
export interface ProfileOpener {
  open(profile: string): Promise<void>
}
export function createProfileOpener(opts: {
  browser: ProfileBrowser
  tabs: TabRegistry
  logger: Logger
  startUrl?: string
  now?: () => Date
}): ProfileOpener {
  const { browser, logger } = opts
  const startUrl = opts.startUrl ?? OPEN_START_URL
  const deps: SwitchDeps = { browser, tabs: opts.tabs, ...(opts.now ? { now: opts.now } : {}) }
  return {
    async open(profile) {
      try {
        await browser.exclusive(profile, async () => {
          if (browser.state(profile)?.mode !== 'visible') {
            const known = profileTabs(deps, profile)
            const first =
              known.length > 0
                ? opts.tabs.list((p) => browser.state(p)?.generation ?? null, profile)[0]
                : undefined
            const jar = first ? ((await sessionCookies(first.page)) ?? []) : []
            const { generation } = await browser.ensure(profile, 'visible')
            if (known.length > 0)
              await reopenTabs(
                deps,
                profile,
                generation,
                known,
                nowMs(deps) + SWITCH_MS,
                restoreCookies(jar),
              )
          }
          const fresh = await browser.newPage(profile, { newWindow: false })
          await fresh.bringToFront()
          await fresh
            .goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            .catch(() => undefined)
        })
      } finally {
        watchWindow({ browser, logger }, profile)
      }
    },
  }
}
