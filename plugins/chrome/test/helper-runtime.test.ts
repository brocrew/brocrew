import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright-core'
import { afterEach, expect, it, onTestFailed } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import { HELPER_ID } from '../src/extensions.js'
import { createLogger } from '../src/logger.js'
import { launchPersistentChromium } from '../src/shared/browser/browser-launch.js'

// Opt-in: a real Chromium, forced headless, in a disposable profile. It proves the helper's
// install, worker, window ids and switch handling in that build; it proves nothing about macOS
// focus or Spaces.
const executable = process.env.BROCREW_CHROME_HELPER_RUNTIME_EXECUTABLE
const homes: string[] = []
const owned: ChromeBrowser[] = []
afterEach(async () => {
  for (const browser of owned.splice(0)) await browser.closeAll()
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})
it.skipIf(!executable)(
  'loads the shipped helper over the pipe, places tabs in the requested window and keeps the person’s switch',
  async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional helper runtime '))
    homes.push(home)
    const lines: string[] = []
    onTestFailed(() => {
      process.stdout.write(`helper runtime log:\n${lines.join('\n')}\n`)
    })
    // Stands in for the profile store's remembered switch.
    let helperSwitch: 'on' | 'off' | 'turning-on' = 'on'
    const browser = new ChromeBrowser({
      dirOf: (profile) => path.join(home, profile),
      helperFor: () => helperSwitch,
      rememberHelper: (_, value) => {
        helperSwitch = value
      },
      logger: createLogger('helper-runtime', (line) => lines.push(line)),
      browser: { channel: 'chromium', executablePath: executable! },
      extensionsFor: () => true,
      helperSource: fileURLToPath(new URL('../helper/', import.meta.url)),
      noTestType: true,
      ...(process.env.BROCREW_CHROME_HELPER_RUNTIME_NO_SANDBOX === '1' ? { noSandbox: true } : {}),
      launchContext: (opts) =>
        launchPersistentChromium({
          ...opts,
          args: [...(opts.args ?? []), '--headless'],
        }),
    })
    owned.push(browser)
    const name = 'fern-ünï'
    fs.mkdirSync(path.join(home, name))
    const helper = () => browser.state(name)?.helper
    await browser.ensure(name)
    expect(helper(), lines.join('\n')).toBe('ready')
    const a = await browser.newPage(name, { newWindow: true })
    const b = await browser.newPage(name, { newWindow: true })
    const windowA = await browser.windowId(name, a)
    const windowB = await browser.windowId(name, b)
    expect(windowA).not.toBe(windowB)
    for (const [anchor, wanted] of [
      [a, windowA],
      [b, windowB],
      [a, windowA],
    ] as Array<[Page, number]>) {
      const notes: string[] = []
      const page = await browser.newPage(name, {
        newWindow: false,
        windowOf: anchor,
        onNote: (note) => notes.push(note),
      })
      expect(await browser.windowId(name, page)).toBe(wanted)
      expect(notes).toEqual([])
    }
    // A second launch loads the helper again and it is ready.
    await browser.close(name)
    await browser.ensure(name)
    expect(helper(), lines.join('\n')).toBe('ready')

    // The person switches it off in chrome://extensions, which calls chrome.management.
    const extensionsPage = await browser.newPage(name, { newWindow: true })
    await extensionsPage.goto('chrome://extensions')
    await extensionsPage.evaluate(
      (id) =>
        (
          globalThis as unknown as {
            chrome: { management: { setEnabled(id: string, on: boolean): Promise<void> } }
          }
        ).chrome.management.setEnabled(id, false),
      HELPER_ID,
    )
    const anchor = await browser.newPage(name, { newWindow: true })
    await browser.newPage(name, { newWindow: true })
    await expect(
      browser.newPage(name, {
        newWindow: false,
        windowOf: anchor,
      }),
    ).rejects.toThrow('WINDOW_TARGET_UNAVAILABLE')
    expect(helper()).toBe('off')
    expect(helperSwitch).toBe('off')

    // Still off after restarts, though Chrome drops the helper and its own record at start.
    await browser.close(name)
    helperSwitch = 'on'
    await browser.ensure(name)
    expect(helperSwitch, 'read from the last session before Chrome started').toBe('off')
    expect(helper(), lines.join('\n')).toBe('off')
    await browser.close(name)
    await browser.ensure(name)
    expect(helper(), lines.join('\n')).toBe('off')

    // The person presses Turn on: it is installed now and places the next tab.
    await browser.turnHelperOn(name)
    expect(helperSwitch).toBe('on')
    expect(helper(), lines.join('\n')).toBe('ready')
    const first = await browser.newPage(name, { newWindow: true })
    await browser.newPage(name, { newWindow: true })
    const back = await browser.newPage(name, { newWindow: false, windowOf: first })
    expect(await browser.windowId(name, back)).toBe(await browser.windowId(name, first))

    // Off again, closed, then Turn on while closed: the next launch installs it.
    const page3 = await browser.newPage(name, { newWindow: true })
    await page3.goto('chrome://extensions')
    await page3.evaluate(
      (id) =>
        (
          globalThis as unknown as {
            chrome: { management: { setEnabled(id: string, on: boolean): Promise<void> } }
          }
        ).chrome.management.setEnabled(id, false),
      HELPER_ID,
    )
    await browser.close(name)
    await browser.turnHelperOn(name)
    expect(helperSwitch).toBe('turning-on')
    await browser.ensure(name)
    expect(helper(), lines.join('\n')).toBe('ready')
    expect(helperSwitch).toBe('on')
    process.stdout.write(`helper runtime log:\n${lines.join('\n')}\n`)
  },
  60_000,
)
