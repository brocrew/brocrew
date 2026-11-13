import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import { silentLogger } from '../src/logger.js'

const enabled = process.platform === 'win32' && process.env.BROCREW_CHROME_DISCOVERY_TEST === '1'
afterEach(() => vi.unstubAllEnvs())

describe.skipIf(!enabled)('packaged Windows browser discovery in a disposable profile', () => {
  it.each([false, true])(
    'launches the package with executable injection=%s',
    async (injected) => {
      const artifact = process.env.BROCREW_CHROME_DISCOVERY_ARTIFACT
      expect(artifact).toBeTruthy()
      const built = await import(pathToFileURL(path.join(artifact!, 'server.mjs')).href)
      const manifest = JSON.parse(fs.readFileSync(path.join(artifact!, 'plugin.json'), 'utf8'))
      expect(manifest.platforms).toEqual([{ os: 'win32', cpu: process.arch }])
      const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brocrew-discovery-')))
      let browser: ChromeBrowser | undefined
      try {
        const auth = path.join(home, 'auth.json')
        fs.writeFileSync(
          auth,
          JSON.stringify({ mcpToken: 'm'.repeat(64), adminToken: 'a'.repeat(64) }),
        )
        for (const [name, value] of Object.entries({
          HOME: home,
          USERPROFILE: home,
          APPDATA: path.join(home, 'AppData', 'Roaming'),
          LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
          BROCREW_CHROME_DATA: home,
          BROCREW_CHROME_AUTH: auth,
        }))
          vi.stubEnv(name, value)
        for (const name of [
          'BROCREW_CHROME_EXECUTABLE',
          'ProgramFiles',
          'ProgramW6432',
          'ProgramFiles(x86)',
        ])
          vi.stubEnv(name, undefined)
        const discovered = built.loadConfig(process.env)
        expect(discovered.home).toBe(home)
        expect(discovered.browser.executablePath).toBeTruthy()
        expect(fs.statSync(discovered.browser.executablePath).isFile()).toBe(true)
        if (injected) vi.stubEnv('BROCREW_CHROME_EXECUTABLE', discovered.browser.executablePath)
        const config = built.loadConfig(process.env)
        expect(config.browser).toEqual(discovered.browser)
        const store = built.createProfileStore({ home })
        store.create('fern', 'panel')
        store.setFlags('fern', { enabled: true })
        browser = built.createChromeBrowser(store, silentLogger, config.browser)
        await browser!.ensure('fern')
        const page = await browser!.newPage('fern', { newWindow: false })
        await page.goto('data:text/html,<title>Fictional discovery</title>')
        expect(await page.title()).toBe('Fictional discovery')
        expect(process.env.USERPROFILE).toBe(home)
        expect(config.home).toBe(home)
        await browser!.close('fern')
        expect(browser!.state('fern')).toBeNull()
      } finally {
        try {
          await browser?.closeAll()
        } finally {
          fs.rmSync(home, { recursive: true, force: true })
        }
      }
    },
    60000,
  )
})
