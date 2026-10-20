import type { ProfileBrowser } from './browser/profileBrowser.js'

export interface WindowTasks {
  open(profile: string, url: string, allowed?: () => void): Promise<void>
}

// Opening a window never reserves a session or waits for the person.
export function createWindowTasks({ browser }: { browser: ProfileBrowser }): WindowTasks {
  return {
    async open(profile, url, allowed) {
      await browser.exclusive(profile, async () => {
        allowed?.()
        await browser.ensure(profile, 'visible')
        allowed?.()
        const page = await browser.newPage(profile, { newWindow: false })
        allowed?.()
        await page
          .goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => undefined)
        await page.bringToFront()
      })
    },
  }
}
