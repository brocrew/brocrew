import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { expect, it, vi } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import type { ChromiumLaunchOptions } from '../src/shared/browser/browser-launch.js'

it.each(['visible', 'headless'] as const)(
  'keeps %s staging private and admits headless downloads only during a tool call',
  async (mode) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-browser-'))
    fs.mkdirSync(path.join(home, 'profiles', 'fern'), { recursive: true })
    let policyFails = false
    const sent: Array<{ method: string; params: Record<string, unknown> }> = []
    class Context extends EventEmitter {
      ended = false
      driver = new EventEmitter() as EventEmitter & {
        newBrowserCDPSession?: unknown
        isConnected?: unknown
      }
      constructor() {
        super()
        this.driver.newBrowserCDPSession = async () => ({
          on() {},
          send: async (method: string, params: Record<string, unknown>) => {
            if (policyFails) throw new Error('fictional policy failure')
            sent.push({ method, params })
          },
        })
        this.driver.isConnected = () => !this.ended
      }
      async newCDPSession() {
        return {
          send: async () => ({ frameTree: { frame: { id: 'fern-frame' } } }),
          detach: async () => {},
        }
      }
      pages() {
        return []
      }
      browser() {
        return this.driver
      }
      async close() {
        this.ended = true
        this.emit('close')
      }
    }
    const launches: ChromiumLaunchOptions[] = []
    const context = new Context()
    const browser = new ChromeBrowser({
      dirOf: (profile) => path.join(home, 'profiles', profile),
      downloadsRoot: path.join(home, 'downloads'),
      lockHeld: async () => false,
      killChrome: async () => {
        throw new Error('No process should be killed')
      },
      ua: {
        get: async () => ({ userAgent: 'fictional', chromeVersion: '1' }),
        invalidate() {},
        peek: () => null,
      },
      launchContext: async (opts) => {
        launches.push(opts)
        return context as unknown as BrowserContext
      },
    })
    try {
      await browser.ensure('fern', mode)
      expect(launches[0].profileDir).toBe(path.join(home, 'profiles', 'fern'))
      expect(launches[0].downloadsPath!.startsWith(path.join(home, 'downloads') + path.sep)).toBe(
        true,
      )
      expect(launches[0].headless).toBe(mode === 'headless')
      expect(launches[0].ignoreAllDefaultArgs).toBe(true)
      expect(launches[0].args).toContain(`--user-data-dir=${launches[0].profileDir}`)
      expect(launches[0].args).not.toContain('--disable-back-forward-cache')
      expect(launches[0].args).not.toContain('--disable-popup-blocking')
      if (process.platform !== 'win32')
        expect(fs.statSync(path.join(home, 'downloads')).mode & 0o777).toBe(0o700)
      expect(sent.some((entry) => entry.method === 'Browser.setDownloadBehavior')).toBe(true)
      const behavior = () =>
        sent.filter((v) => v.method === 'Browser.setDownloadBehavior').map((v) => v.params.behavior)
      expect(behavior()).toEqual([mode === 'headless' ? 'deny' : 'allowAndName'])
      await browser.captureDownloads('fern', {} as Page, async () => {
        expect(behavior().at(-1)).toBe('allowAndName')
        await browser.captureDownloads('fern', {} as Page, async () => undefined)
        expect(behavior().at(-1)).toBe('allowAndName')
      })
      expect(behavior().at(-1)).toBe(mode === 'headless' ? 'deny' : 'allowAndName')
      await expect(
        browser.captureDownloads('fern', {} as Page, async () => {
          throw new Error('fictional canceled call')
        }),
      ).rejects.toThrow('fictional canceled call')
      expect(behavior().at(-1)).toBe(mode === 'headless' ? 'deny' : 'allowAndName')
      policyFails = true
      const invoke = vi.fn(async () => undefined)
      await expect(browser.captureDownloads('fern', {} as Page, invoke)).rejects.toThrow(
        'fictional policy failure',
      )
      expect(invoke).not.toHaveBeenCalled()
      expect(context.ended).toBe(true)
      await browser.closeAll()
      expect(context.ended).toBe(true)
      expect(fs.readdirSync(path.join(home, 'downloads'))).toEqual([])
    } finally {
      await browser.closeAll()
      fs.rmSync(home, { recursive: true, force: true })
    }
  },
)
