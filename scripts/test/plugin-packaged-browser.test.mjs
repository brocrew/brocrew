import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FixtureBrowser,
  fixtureReader,
  fixtureHtml,
  fixtureTitle,
} from '../gates/plugin-packaged/fake-browser.mjs'
const require = createRequire(new URL('../../plugins/chrome/package.json', import.meta.url))
const protocolInstalled = fs.existsSync(
  new URL('../../plugins/chrome/node_modules/playwright-core/package.json', import.meta.url),
)
const roots = [],
  cleanup = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
describe.skipIf(process.platform === 'win32')('the fixture CDP browser', () => {
  it.skipIf(!protocolInstalled)(
    'launches through real Playwright pipes, navigates, evaluates and closes a tab without Chrome',
    async () => {
      const { chromium } = require('playwright-core')
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fern-cdp-'))
      roots.push(root)
      const server = createServer((request, response) => {
        response.writeHead(request.url === '/fern' ? 200 : 404)
        response.end(request.url === '/fern' ? fixtureHtml : '')
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      cleanup.push(() => new Promise((resolve) => server.close(resolve)))
      const url = `http://127.0.0.1:${server.address().port}/fern`
      fs.writeFileSync(path.join(root, 'browser-fixture.json'), JSON.stringify({ url }))
      const browser = path.join(root, 'browser')
      fs.writeFileSync(
        browser,
        `#!${process.execPath}\nimport {runBrowser} from ${JSON.stringify(new URL('../gates/plugin-packaged/fake-browser.mjs', import.meta.url).href)};runBrowser(${JSON.stringify(root)});`,
        { mode: 0o700 },
      )
      const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
        executablePath: browser,
        headless: true,
        timeout: 7000,
      })
      cleanup.push(async () => {
        await Promise.race([
          context.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Fixture context close timed out')), 2000),
          ),
        ])
      })
      const page = context.pages()[0]
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 })
      expect(await page.title()).toBe(fixtureTitle)
      expect(await page.evaluate(() => document.body.innerText)).toContain('fictional stream')
      const second = await context.newPage()
      await second.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 })
      await second.close()
      expect(context.pages()).toHaveLength(1)
      await expect(page.goto('https://example.invalid/', { timeout: 2000 })).rejects.toThrow()
      await page.close()
      expect(context.pages()).toHaveLength(0)
      const receipts = fs.readdirSync(root).filter((name) => /^cdp-\d+\.json$/.test(name))
      expect(receipts).toHaveLength(1)
      expect(JSON.parse(fs.readFileSync(path.join(root, receipts[0])))).toMatchObject({
        navigations: 2,
        rejectedNavigations: 1,
        closedTabs: 2,
      })
    },
    20000,
  )
  it('never requests a foreign, redirected or changed fixture page', async () => {
    let requests = 0
    const read = fixtureReader('http://127.0.0.1:1234/fern', async (_, options) => {
      requests++
      expect(options.redirect).toBe('error')
      return { ok: true, text: async () => 'changed' }
    })
    await expect(read('http://127.0.0.1:1234/foreign')).rejects.toThrow()
    await expect(read('https://example.invalid/fern')).rejects.toThrow()
    expect(requests).toBe(0)
    await expect(read('http://127.0.0.1:1234/fern')).rejects.toThrow()
    expect(requests).toBe(1)
  })
  it('reduces unexpected CDP errors to a constant without leaking expressions or URLs', async () => {
    const frames = []
    const browser = new FixtureBrowser({
      emit: (frame) => frames.push(frame),
      readPage: async () => {},
    })
    await browser.message({ id: 1, method: 'TOKEN=/fictional/private', params: { url: 'secret' } })
    expect(frames).toEqual([
      { id: 1, sessionId: undefined, error: { code: -32000, message: 'Fixture CDP refused' } },
    ])
  })
})
