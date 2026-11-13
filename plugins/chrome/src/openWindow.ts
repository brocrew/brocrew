import type { ProfileBrowser } from './browser/profileBrowser.js'
import type { Logger } from './logger.js'
import { watchWindow } from './tools/showTab.js'
export const OPEN_START_URL = 'https://www.google.com/'
export interface ProfileOpener {
  open(profile: string): Promise<void>
}
export function createProfileOpener(opts: {
  browser: ProfileBrowser
  logger: Logger
  startUrl?: string
  profileExists?: (profile: string) => boolean
}): ProfileOpener {
  const { browser, logger } = opts
  const startUrl = opts.startUrl ?? OPEN_START_URL
  return {
    async open(profile) {
      try {
        await browser.exclusive(profile, async () => {
          if (opts.profileExists?.(profile) === false) throw new Error('profile does not exist')
          await browser.ensure(profile)
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
