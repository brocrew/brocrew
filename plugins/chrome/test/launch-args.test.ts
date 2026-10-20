import { describe, expect, it } from 'vitest'
import { launchArgs } from '../src/browser/launchArgs.js'

const base = {
  profileDir: '/tmp/own/p',
  mode: 'visible' as const,
  sync: false,
  extensions: false,
  noSandbox: false,
  noTestType: false,
  platform: 'darwin' as const,
}

describe('launchArgs: the whole command line, nothing else', () => {
  it('visible, defaults: exactly the target set', () => {
    expect(launchArgs(base)).toEqual([
      '--user-data-dir=/tmp/own/p',
      '--remote-debugging-pipe',
      '--disable-blink-features=AutomationControlled',
      '--test-type',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      '--disable-sync',
      '--disable-extensions',
      'about:blank',
    ])
  })
  it.each(['visible', 'headless'] as const)(
    'uses OS credential protection for branded Chrome in %s mode',
    (mode) => {
      const args = launchArgs({ ...base, mode, channel: 'chrome' })
      expect(args).not.toContain('--use-mock-keychain')
      expect(args).not.toContain('--password-store=basic')
      const unbranded = launchArgs({ ...base, mode, channel: 'chromium' })
      expect(unbranded).toContain('--use-mock-keychain')
      expect(unbranded).toContain('--password-store=basic')
    },
  )
  it('headless adds only the headless flags; sync / extensions on remove only their own flag; test-type off removes only itself', () => {
    const head = launchArgs({ ...base, mode: 'headless' })
    expect(head.filter((a) => !launchArgs(base).includes(a))).toEqual([
      '--headless',
      '--hide-scrollbars',
      '--mute-audio',
    ])
    expect(launchArgs({ ...base, sync: true })).toEqual(
      launchArgs(base).filter((a) => a !== '--disable-sync'),
    )
    expect(launchArgs({ ...base, extensions: true })).toEqual(
      launchArgs(base).filter((a) => a !== '--disable-extensions'),
    )
    expect(launchArgs({ ...base, noTestType: true })).toEqual(
      launchArgs(base).filter((a) => a !== '--test-type'),
    )
  })
  it("--no-sandbox only for the hatch (and the sandbox is Chrome's default otherwise); --disable-dev-shm-usage only on Linux; extra args before the start page", () => {
    expect(launchArgs(base)).not.toContain('--no-sandbox')
    expect(launchArgs({ ...base, noSandbox: true })).toContain('--no-sandbox')
    expect(launchArgs(base)).not.toContain('--disable-dev-shm-usage')
    expect(launchArgs({ ...base, platform: 'linux' })).toContain('--disable-dev-shm-usage')
    expect(launchArgs({ ...base, platform: 'win32' })).not.toContain('--disable-dev-shm-usage')
    expect(launchArgs({ ...base, extraArgs: ['--x', '--y'] }).slice(-3)).toEqual([
      '--x',
      '--y',
      'about:blank',
    ])
  })
  it("none of Playwright's slowing defaults is there, in any mode", () => {
    const banned = [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-field-trial-config',
      '--disable-ipc-flooding-protection',
      '--enable-unsafe-swiftshader',
      '--allow-pre-commit-input',
      '--disable-hang-monitor',
      '--disable-component-update',
      '--disable-background-networking',
      '--metrics-recording-only',
      '--enable-automation',
      '--disable-back-forward-cache',
      '--disable-popup-blocking',
    ]
    for (const mode of ['headless', 'visible'] as const) {
      const all = launchArgs({ ...base, mode, sync: true, extensions: true })
      for (const b of banned) expect(all, b).not.toContain(b)
      expect(
        all.some(
          (a) =>
            a.startsWith('--disable-features') ||
            a.startsWith('--enable-features') ||
            a.startsWith('--blink-settings'),
        ),
      ).toBe(false)
    }
  })
  it('exactly one --user-data-dir, equal to the profile dir (what the launch guard demands)', () => {
    expect(launchArgs(base).filter((a) => a.startsWith('--user-data-dir'))).toEqual([
      '--user-data-dir=/tmp/own/p',
    ])
  })
})
