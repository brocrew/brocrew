import type { BrowserChannel } from '../shared/browser/launchConfig.js'
import type { BrowserMode } from './profileBrowser.js'

export interface LaunchArgsInput {
  profileDir: string
  mode: BrowserMode
  background?: boolean

  sync: boolean

  extensions: boolean

  noSandbox: boolean

  noTestType: boolean
  platform?: NodeJS.Platform
  channel?: BrowserChannel

  extraArgs?: readonly string[]
}

export function launchArgs(i: LaunchArgsInput): string[] {
  const platform = i.platform ?? process.platform
  return [
    `--user-data-dir=${i.profileDir}`,
    '--remote-debugging-pipe',
    '--disable-blink-features=AutomationControlled',
    ...(i.noTestType ? [] : ['--test-type']),
    // Only unbranded Chromium/test builds use the mock store. Branded browsers use OS protection.
    ...(i.channel === 'chromium' ? ['--password-store=basic', '--use-mock-keychain'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    ...(i.sync ? [] : ['--disable-sync']),
    ...(i.extensions ? [] : ['--disable-extensions']),
    // Controlled background opening grants no user activation; site popups are also permitted.
    ...(i.background ? ['--disable-popup-blocking'] : []),
    ...(i.mode === 'headless' ? ['--headless', '--hide-scrollbars', '--mute-audio'] : []),
    ...(platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
    ...(i.noSandbox ? ['--no-sandbox'] : []),
    ...(i.extraArgs ?? []),
    ...(i.background && i.mode === 'visible' ? ['--no-startup-window'] : ['about:blank']),
  ]
}
