import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { startAgentChrome, VERSION } from '../src/app.js'
import { createProfileStore } from '../src/profiles/store.js'
import { HELPER_FILES } from '../src/browser/brocrewHelper.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser, FakePage, asPage } from './fakes.js'
import {
  bootstrapEnv,
  connectPackage,
  personMetadata,
  resultJson,
  resultText,
} from './ordinary-package-fixture.js'
import { TabRegistry } from '../src/tabs.js'
import { configurationSnapshot } from '../src/configuration.js'

vi.mock('playwright-core', () => ({
  chromium: {
    launch: () => {
      throw new Error('Real Chrome is forbidden in these tests')
    },
    launchPersistentContext: () => {
      throw new Error('Real Chrome is forbidden in these tests')
    },
  },
}))
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
const temporary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-'))
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const mcpToken = 'fictional-mcp-'.repeat(8)
const adminToken = 'fictional-person-'.repeat(8)
function configured() {
  return loadConfig(bootstrapEnv(temporary()))
}
async function boot(start = startAgentChrome) {
  const config = configured(),
    store = createProfileStore({ home: config.home }),
    browser = new FakeBrowser(store.dirOf)
  const server = await start(config, { browser, store, logger: silentLogger })
  cleanup.push(() => server.close())
  const port = (server.httpServer.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}`
  async function request(endpoint: string, token?: string, body?: unknown, origin?: string) {
    const response = await fetch(url + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return { status: response.status, text }
  }
  const client = await connectPackage(url, config.token)
  cleanup.push(() => client.close())
  const configure = (
    profile: string,
    action: string,
    extra: Record<string, unknown> = {},
    origin = 'settings.page',
  ) =>
    client.callTool({
      name: 'configure_profile',
      arguments: { profile, action, ...extra },
      _meta: { ...personMetadata, origin },
    })
  const snapshot = async () => {
    const result = await client.callTool({ name: 'configuration_snapshot', arguments: {} })
    expect(result.isError).not.toBe(true)
    return resultJson(result)
  }
  return { config, store, browser, server, url, request, client, configure, snapshot }
}
describe('private Chrome package', () => {
  it('derives the server version from release metadata and contains no literal server-version fallback', () => {
    const metadata = JSON.parse(fs.readFileSync('plugins/chrome/manifest-template.json', 'utf8'))
    expect(VERSION).toBe(metadata.version)
    const inspect = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) inspect(file)
        else if (entry.name.endsWith('.ts'))
          expect(fs.readFileSync(file, 'utf8')).not.toMatch(
            /['"`]\d+\.\d+\.\d+(?:[-+][^'"`\s]+)?['"`]/,
          )
      }
    }
    inspect('plugins/chrome/src')
  })
  it('the built archive reports exactly its manifest version in authenticated MCP initialization', async () => {
    const artifact = process.env.BROCREW_CHROME_TEST_ARTIFACT
    expect(artifact, 'Build a fresh artifact and set BROCREW_CHROME_TEST_ARTIFACT').toBeTruthy()
    // One build writes its package at the artifact's root; the release writes one per target.
    const builds = ['.', 'chrome-darwin-arm64', 'chrome-win32-x64']
      .map((name) => path.join(artifact!, name, 'package'))
      .filter((folder) => fs.existsSync(path.join(folder, 'plugin.json')))
    expect(builds.length).toBeGreaterThan(0)
    for (const folder of builds) {
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'))
      // Every target ships exactly the helper files the server checks before loading them.
      expect(
        manifest.files
          .filter((file: { path: string }) => file.path.startsWith('helper/'))
          .map((file: { path: string }) => file.path),
      ).toEqual(['helper/manifest.json', 'helper/worker.js'])
      for (const file of HELPER_FILES) {
        const bytes = fs.readFileSync(path.join(folder, 'helper', file.name))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
        expect(manifest.files).toContainEqual({
          path: `helper/${file.name}`,
          bytes: bytes.length,
          sha256: file.sha256,
        })
      }
      const built = await import(pathToFileURL(path.join(folder, 'server.mjs')).href)
      const { client, request, config } = await boot(built.startAgentChrome)
      expect(client.getServerVersion()?.version).toBe(manifest.version)
      expect(JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).version).toBe(
        manifest.version,
      )
      expect((await request('/healthz', config.token)).status).toBe(404)
    }
  })
  it('requires an explicit retained private path and fresh token with no workspace fallback', () => {
    expect(() => loadConfig({})).toThrow('Plugin unavailable')
    expect(() => loadConfig({ BROCREW_CHROME_DATA: 'relative' })).toThrow('Plugin unavailable')
    const config = configured()
    expect(config.workspace).toBe(path.join(config.home, 'files'))
    expect(config.downloadsRoot).toBe(path.join(config.home, 'downloads'))
    if (process.platform !== 'win32')
      for (const dir of [config.home, config.workspace, config.downloadsRoot])
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    const reopened = loadConfig(bootstrapEnv(config.home))
    expect(reopened.home).toBe(config.home)
    expect(reopened.token).not.toBe(config.token)
    expect(config.token).toMatch(/^[a-f0-9]{64}$/)
  })
  it('accepts only an absolute host-selected browser executable', () => {
    const config = configured()
    const env = bootstrapEnv(config.home)
    const before = fs.readdirSync(config.home)
    expect(
      loadConfig({ ...env, BROCREW_CHROME_EXECUTABLE: path.join(config.home, 'fictional-browser') })
        .browser?.executablePath,
    ).toBe(path.join(config.home, 'fictional-browser'))
    expect(() =>
      loadConfig({ ...env, BROCREW_CHROME_EXECUTABLE: 'fictional-relative-browser' }),
    ).toThrow('Plugin unavailable')
    expect(fs.readdirSync(config.home)).toEqual(before)
  })
  it('ignores linked world-readable and malformed legacy auth files without reading or quoting them', () => {
    const home = temporary(),
      auth = path.join(home, 'legacy-auth.json'),
      link = path.join(home, 'linked.json')
    const legacy = JSON.stringify({ mcpToken, adminToken })
    fs.writeFileSync(auth, legacy, { mode: 0o644 })
    fs.symlinkSync(auth, link)
    const read = vi.spyOn(fs, 'readFileSync')
    for (const legacyPath of [link, auth]) {
      const config = loadConfig({ ...bootstrapEnv(home), BROCREW_CHROME_AUTH: legacyPath })
      expect(config.token).not.toBe(mcpToken)
      expect(config.token).not.toBe(adminToken)
      expect(read.mock.calls.some(([file]) => [link, auth].includes(String(file)))).toBe(false)
    }
    fs.writeFileSync(auth, 'malformed fictional legacy credentials')
    expect(loadConfig({ ...bootstrapEnv(home), BROCREW_CHROME_AUTH: auth }).home).toBe(home)
    expect(() => loadConfig({ BROCREW_PLUGIN_BOOTSTRAP: '{', BROCREW_CHROME_AUTH: auth })).toThrow(
      'Plugin unavailable. Try again.',
    )
    read.mockRestore()
    expect(fs.readFileSync(auth, 'utf8')).toBe('malformed fictional legacy credentials')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
  })
  it('authenticates MCP, refuses browser origins and leaves retired admin routes absent', async () => {
    const { request, config, client, store, browser } = await boot()
    expect((await request('/mcp', undefined, {})).status).toBe(401)
    expect((await request('/mcp', adminToken, {})).status).toBe(401)
    expect((await request('/mcp', config.token, {}, 'https://fictional.invalid')).status).toBe(403)
    for (const endpoint of ['/healthz', '/v1/profiles', '/v1/tabs'])
      expect((await request(endpoint, config.token)).status).toBe(404)
    expect((await client.listTools()).tools.some((tool) => tool.name === 'configure_profile')).toBe(
      true,
    )
    expect(
      (
        await client.callTool({
          name: 'configure_profile',
          arguments: { profile: 'fern', action: 'create-profile' },
        })
      ).isError,
    ).toBe(true)
    for (const origin of ['agent', 'automatic']) {
      const denied = await client.callTool({
        name: 'configure_profile',
        arguments: { profile: 'fern', action: 'create-profile' },
        _meta: { ...personMetadata, origin },
      })
      expect(denied.isError).toBe(true)
    }
    expect(store.list()).toEqual([])
    expect(browser.launches).toEqual([])
  })
  it('only the person enables profiles and opens windows; tool discovery and use work with fakes', async () => {
    const { configure, browser, client, store } = await boot()
    expect((await configure('fern', 'create-profile', {}, 'agent')).isError).toBe(true)
    expect(store.get('fern')).toBeUndefined()
    expect(browser.launches).toEqual([])
    const created = await configure('fern', 'create-profile')
    expect(created.isError).not.toBe(true)
    expect(resultJson(created)).toEqual({ profile: 'fern', completed: true })
    const tools = await client.listTools()
    expect(tools.tools.some((tool) => tool.name === 'open_tab')).toBe(true)
    const refused = await client.callTool({
      name: 'open_tab',
      arguments: { profile: 'fern', url: 'https://fictional.invalid/' },
    })
    expect(JSON.stringify(refused)).toContain('not enabled')
    expect(browser.launches).toHaveLength(0)
    expect((await configure('fern', 'set-enabled', { enabled: true })).isError).not.toBe(true)
    const result = await client.callTool({
      name: 'open_tab',
      arguments: { profile: 'fern', url: 'https://fictional.invalid/' },
    })
    expect(JSON.stringify(result)).toContain('t')
    expect(browser.launches).toEqual([{ profile: 'fern', mode: 'headless' }])
    expect((await configure('fern', 'open-window')).isError).not.toBe(true)
    expect(browser.launches.at(-1)).toEqual({ profile: 'fern', mode: 'visible' })
    const duringWindow = await client.callTool({
      name: 'open_tab',
      arguments: { profile: 'fern', url: 'https://fictional.invalid/shared' },
    })
    expect(JSON.stringify(duringWindow)).toContain('https://fictional.invalid/shared')
    browser.endWindow('fern')
    expect((await configure('fern', 'set-enabled', { enabled: false })).isError).not.toBe(true)
    expect(browser.state('fern')).toBeNull()
  })
  it('only the person turns the BroCrew helper on, and only in an enabled profile', async () => {
    const { configure, browser, store, snapshot, client } = await boot()
    store.create('birch', 'panel')
    store.setHelper('birch', 'off')
    expect(
      (
        await client.callTool({
          name: 'configure_profile',
          arguments: { profile: 'birch', action: 'helper-on' },
        })
      ).isError,
    ).toBe(true)
    expect((await configure('birch', 'helper-on', {}, 'agent')).isError).toBe(true)
    expect(browser.helperTurnedOn).toEqual([])
    const disabled = await configure('birch', 'helper-on')
    expect(disabled.isError).toBe(true)
    expect(resultText(disabled)).toBe('Enable this profile first, then turn the helper on.')
    expect(browser.helperTurnedOn).toEqual([])
    expect(store.get('birch')?.helper).toBe('off')
    store.setFlags('birch', { enabled: true })
    expect((await configure('birch', 'helper-on', { on: true })).isError).toBe(true)
    expect(browser.helperTurnedOn).toEqual([])
    const turned = await configure('birch', 'helper-on')
    expect(turned.isError).not.toBe(true)
    expect(resultJson(turned)).toEqual({ profile: 'birch', completed: true })
    expect((await snapshot()).profiles).toContainEqual(
      expect.objectContaining({ name: 'birch', helperOff: false }),
    )
    // Recorded first, so it holds even while this profile is closed.
    expect(store.get('birch')?.helper).toBe('turning-on')
    expect(browser.helperTurnedOn).toEqual(['birch'])
  })
  it('returns bounded typed tabs, excludes expired generations and strips URL credentials/query', async () => {
    const { snapshot, browser, server, store } = await boot()
    store.create('willow', 'panel')
    store.setFlags('willow', { enabled: true })
    const { generation } = await browser.ensure('willow', 'headless')
    const page = new FakePage()
    page.urlValue = 'https://fictional:madeup@fictional.invalid/path?q=private#part'
    server.tabs.add('willow', generation, asPage(page))
    const reply = await snapshot()
    expect(reply.tabs).toEqual([
      {
        id: expect.any(String),
        profile: 'willow',
        url: 'https://fictional.invalid/path',
        title: 'Title',
      },
    ])
    await browser.close('willow')
    expect((await snapshot()).tabs).toEqual([])
  })
})

// D3: cap enumeration BEFORE title work; retain clean URLs, bounded strings and generations.
it('snapshot caps rows before title work and bounds URL/title strings', async () => {
  const config = configured(),
    store = createProfileStore({ home: config.home })
  store.create('willow', 'panel')
  const browser = new FakeBrowser(store.dirOf),
    tabs = new TabRegistry()
  const { generation } = await browser.ensure('willow', 'headless')
  const titles = []
  const stale = new FakePage()
  const staleTitle = vi.spyOn(stale, 'title')
  tabs.add('willow', generation - 1, asPage(stale))
  for (let i = 0; i < 205; i++) {
    const page = new FakePage()
    page.urlValue =
      'https://fictional:secret@fictional.invalid/' + 'u'.repeat(2100) + '?private#fragment'
    const title = vi.spyOn(page, 'title').mockResolvedValue('t'.repeat(600))
    titles.push(title)
    tabs.add('willow', generation, asPage(page))
  }
  const result = await configurationSnapshot({ store, browser, tabs })
  expect(result.tabs).toHaveLength(200)
  expect(result.tabs).toEqual(
    Array.from({ length: 200 }, () => ({
      id: expect.any(String),
      profile: 'willow',
      url: ('https://fictional.invalid/' + 'u'.repeat(2100)).slice(0, 2048),
      title: 't'.repeat(512),
    })),
  )
  expect(staleTitle).not.toHaveBeenCalled()
  for (const title of titles.slice(0, 200)) expect(title).toHaveBeenCalledOnce()
  for (const title of titles.slice(200)) expect(title).not.toHaveBeenCalled()
})
it('snapshot gives a never-settling title exactly the existing 250ms empty fallback', async () => {
  const config = configured(),
    store = createProfileStore({ home: config.home })
  store.create('willow', 'panel')
  const browser = new FakeBrowser(store.dirOf),
    tabs = new TabRegistry()
  const { generation } = await browser.ensure('willow', 'headless')
  const page = new FakePage()
  page.urlValue = 'https://fictional.invalid/'
  vi.spyOn(page, 'title').mockImplementation(() => new Promise<string>(() => {}))
  tabs.add('willow', generation, asPage(page))
  vi.useFakeTimers()
  let settled = false
  const pending = configurationSnapshot({ store, browser, tabs }).then((result) => {
    settled = true
    return result
  })
  await vi.advanceTimersByTimeAsync(249)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(settled).toBe(true)
  expect((await pending).tabs).toEqual([
    { id: expect.any(String), profile: 'willow', url: 'https://fictional.invalid/', title: '' },
  ])
})
