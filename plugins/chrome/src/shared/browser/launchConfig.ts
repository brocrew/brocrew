import type { ChromiumLaunchOptions } from './browser-launch.js'
export const CONFIG_C = {
  channel: 'chrome',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
} as const satisfies Pick<ChromiumLaunchOptions, 'channel' | 'ignoreDefaultArgs' | 'args'>
export const BROWSER_CHANNELS = ['chrome', 'chromium', 'msedge'] as const
export type BrowserChannel = (typeof BROWSER_CHANNELS)[number]
export interface BrowserChoice {
  channel: BrowserChannel
  executablePath?: string
}
export class BrowserChoiceError extends Error {}
export function browserChoice(channelText?: string, executableText?: string): BrowserChoice {
  const channel = channelText?.trim().toLowerCase() || CONFIG_C.channel
  if (!(BROWSER_CHANNELS as readonly string[]).includes(channel)) {
    throw new BrowserChoiceError(
      `the browser channel must be one of ${BROWSER_CHANNELS.join(', ')}`,
    )
  }
  const executablePath = executableText?.trim()
  return { channel: channel as BrowserChannel, ...(executablePath ? { executablePath } : {}) }
}
export function launchTarget(
  choice: BrowserChoice,
): Pick<ChromiumLaunchOptions, 'channel' | 'executablePath'> {
  return choice.executablePath !== undefined
    ? { executablePath: choice.executablePath }
    : { channel: choice.channel }
}
export const OWN_SIGNALS = {
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
} as const satisfies Pick<ChromiumLaunchOptions, 'handleSIGINT' | 'handleSIGTERM' | 'handleSIGHUP'>
