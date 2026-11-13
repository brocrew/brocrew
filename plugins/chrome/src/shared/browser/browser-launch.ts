import { browserEnvironment } from './browser-environment.js'
import type { BrowserContext } from 'playwright-core'
import { assertOwnProfileDir } from './launchGuard.js'
export interface ChromiumLaunchOptions {
  profileDir: string
  executablePath?: string
  channel?: 'chrome' | 'chromium' | 'msedge'
  ignoreAllDefaultArgs?: boolean
  ignoreDefaultArgs?: readonly string[]
  viewport?: {
    width: number
    height: number
  } | null
  handleSIGINT?: boolean
  handleSIGTERM?: boolean
  handleSIGHUP?: boolean
  downloadsPath?: string
  chromiumSandbox?: boolean
  args?: readonly string[]
}
export async function launchPersistentChromium(
  opts: ChromiumLaunchOptions,
): Promise<BrowserContext> {
  assertOwnProfileDir(opts)
  const { chromium } = await import('playwright-core')
  assertOwnProfileDir(opts)
  return chromium.launchPersistentContext(opts.profileDir, {
    headless: false,
    // The browser uses account roots; the server retains its private environment.
    env: browserEnvironment(),
    ...(opts.executablePath !== undefined ? { executablePath: opts.executablePath } : {}),
    ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
    ...(opts.ignoreDefaultArgs !== undefined
      ? { ignoreDefaultArgs: [...opts.ignoreDefaultArgs] }
      : {}),
    ...(opts.ignoreAllDefaultArgs === true ? { ignoreDefaultArgs: true } : {}),
    ...(opts.viewport !== undefined ? { viewport: opts.viewport } : {}),
    ...(opts.downloadsPath !== undefined ? { downloadsPath: opts.downloadsPath } : {}),
    ...(opts.chromiumSandbox !== undefined ? { chromiumSandbox: opts.chromiumSandbox } : {}),
    ...(opts.handleSIGINT !== undefined ? { handleSIGINT: opts.handleSIGINT } : {}),
    ...(opts.handleSIGTERM !== undefined ? { handleSIGTERM: opts.handleSIGTERM } : {}),
    ...(opts.handleSIGHUP !== undefined ? { handleSIGHUP: opts.handleSIGHUP } : {}),
    args: [...(opts.args ?? [])],
  })
}
