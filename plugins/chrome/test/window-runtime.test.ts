import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'
import { launchPersistentChromium } from '../src/shared/browser/browser-launch.js'
import { createProfileStore } from '../src/profiles/store.js'
import { TabRegistry } from '../src/tabs.js'
import { createWindowTasks } from '../src/windows.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { saveVisibleSession, restoreVisibleSession } from '../src/restoreSession.js'
import { silentLogger } from '../src/logger.js'
import { startAgentChrome } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

type RuntimeTab = { tabId: string; windowId: number; url: string; title: string }
type OpenResult = RuntimeTab & {
  note?: string
  loadError?: string
  restoredTabs?: Array<{ tabId: string }>
}
type RuntimeReply<Name extends string> = Name extends 'list_tabs'
  ? RuntimeTab[]
  : Name extends 'open_tab'
    ? OpenResult
    : unknown

// Opt-in real browser checks use only disposable, non-signed-in owned profiles. Logical visible
// mode is forced headless with the COMPLETE production argument list; this proves no OS focus claim.
const enabled = process.env.BROCREW_CHROME_RUNTIME_TEST === '1'
describe.skipIf(!enabled)('window and file contract in disposable installed Chrome', () => {
  const homes: string[] = []
  const owned: ChromeBrowser[] = []
  const connections: Array<() => Promise<void>> = []
  function make(home = fs.mkdtempSync('/tmp/brocrew-chrome-runtime-')) {
    if (!homes.includes(home)) homes.push(home)
    const store = createProfileStore({ home })
    const browser = new ChromeBrowser({
      dirOf: store.dirOf,
      logger: silentLogger,
      ua: {
        get: async () => ({
          userAgent: 'fictional fixture',
          chromeVersion: null,
        }),
        invalidate() {},
        peek: () => null,
      },
      launchContext: (opts) =>
        launchPersistentChromium({
          ...opts,
          headless: true,
          args: [...(opts.args ?? []), '--headless'],
        }),
    })
    owned.push(browser)
    const tabs = new TabRegistry()
    const tools = createAgentChromeTools({
      store,
      browser,
      tabs,
      windows: createWindowTasks({ browser }),
      serializer: createKeyedSerializer(),
      downloadsRoot: path.join(home, 'downloads'),
      guard: () => ({
        roots: [home],
        hostHome: '',
        mount: '',
        maxBytes: 1024,
      }),
    })
    const call = async <Name extends string>(
      name: Name,
      args: Record<string, unknown> = {},
    ): Promise<RuntimeReply<Name>> => {
      const tool = tools.find((t) => t.definition.name === name)!
      const result = await tool.execute(args, {})
      const text =
        (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
          ?.text ?? ''
      if (text.startsWith('Error:') || result.isError) throw new Error(text)
      try {
        return JSON.parse(text)
      } catch {
        return text as RuntimeReply<Name>
      }
    }
    return { home, store, browser, tabs, call }
  }
  async function connectMcp(h: ReturnType<typeof make>) {
    const mcpToken = 'fictional-tool-'.repeat(8),
      adminToken = 'fictional-admin-'.repeat(8)
    const auth = path.join(h.home, 'auth.json')
    fs.writeFileSync(auth, JSON.stringify({ mcpToken, adminToken }), {
      mode: 0o600,
    })
    const config = loadConfig({
      BROCREW_CHROME_DATA: h.home,
      BROCREW_CHROME_AUTH: auth,
    })
    const app = await startAgentChrome(config, {
      browser: h.browser,
      store: h.store,
      logger: silentLogger,
    })
    const client = new Client({
      name: 'fictional-window-contract',
      version: '1',
    })
    connections.push(async () => {
      await client.close()
      await app.close()
    })
    const port = (app.httpServer.address() as { port: number }).port
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } },
      }),
    )
    const definitions = await client.listTools()
    expect(
      definitions.tools.find((t) => t.name === 'open_tab')?.inputSchema.properties,
    ).toHaveProperty('windowOf')
    h.call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args })
      const text =
        (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
          ?.text ?? ''
      if (result.isError || text.startsWith('Error:')) throw new Error(text)
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
  }
  afterEach(async () => {
    for (const done of connections.splice(0)) await done()
    for (const b of owned.splice(0)) await b.closeAll()
    for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true })
  })
  it('cases 1–4 and 7: placement, recency, observation, fallback and profile ownership', async () => {
    const h = make()
    for (const name of ['fern', 'willow']) {
      h.store.create(name, 'panel')
      h.store.setFlags(name, { enabled: true })
    }
    await connectMcp(h)
    const open = (extra = {}) =>
      h.call('open_tab', { profile: 'fern', url: 'about:blank', ...extra })
    const a = await open({ visible: true, newWindow: true }),
      b = await open()
    const c = await open({ newWindow: true })
    await h.call('show_tab', { tabId: c.tabId }) // deliberate HEADLESS native-order setup, never a native focus proof
    const d = await open()
    expect([a.windowId, b.windowId, c.windowId, d.windowId]).toEqual([
      a.windowId,
      a.windowId,
      c.windowId,
      c.windowId,
    ])
    expect(c.windowId).not.toBe(a.windowId)
    const rows = await h.call('list_tabs')
    expect(rows.every((t) => Number.isInteger(t.windowId))).toBe(true)
    expect((await open()).windowId).toBe(c.windowId)
    expect((await open({ windowOf: a.tabId })).windowId).toBe(a.windowId)
    expect((await open()).windowId).toBe(a.windowId)
    await h.call('snapshot', { tabId: c.tabId })
    const nativeDefault = await open()
    expect(nativeDefault.windowId).toBe(a.windowId)
    expect(nativeDefault.note).toContain('different window')
    await expect(open({ windowOf: 't999999' })).rejects.toThrow('unknown')
    await expect(open({ windowOf: 'bad' })).rejects.toThrow('wrong format')
    await expect(open({ windowOf: a.tabId, newWindow: true })).rejects.toThrow('either')
    await expect(
      h.call('open_tab', {
        profile: 'willow',
        url: 'about:blank',
        windowOf: a.tabId,
        visible: true,
      }),
    ).rejects.toThrow('requested profile')
    expect(h.browser.state('willow')).toBeNull()
    const existing = await h.call('list_tabs', { profile: 'fern' })
    for (const t of existing)
      if (t.windowId === c.windowId) await h.call('close_tab', { tabId: t.tabId })
    expect((await open()).windowId).toBe(a.windowId)
    await expect(open({ windowOf: c.tabId })).rejects.toThrow('no longer exists')
    const headA = await h.call('open_tab', {
      profile: 'willow',
      url: 'about:blank',
      newWindow: true,
    })
    const headB = await h.call('open_tab', {
      profile: 'willow',
      url: 'about:blank',
      newWindow: true,
    })
    expect(headA.windowId).toBe(headB.windowId)
    expect((await open()).windowId).toBe(a.windowId)
  }, 120_000)
  it('case 6: genuine save/take/restore loads local file URLs and encoded paths in the same persistent profile', async () => {
    const a = make()
    a.store.create('fern', 'panel')
    a.store.setFlags('fern', { enabled: true })
    expect(a.store.get('fern')!.temporary).toBe(false)
    const file = path.join(a.home, 'local space é#?.html'),
      url = pathToFileURL(file).href
    fs.writeFileSync(file, '<title>Fictional local fixture</title><h1>Disposable only</h1>')
    const first = await a.call('open_tab', {
      profile: 'fern',
      url: file,
      visible: true,
    })
    const second = await a.call('open_tab', {
      profile: 'fern',
      url,
      windowOf: first.tabId,
    })
    expect(first.url).toBe(url)
    expect(second.title).toBe('Fictional local fixture')
    const missing = await a.call('open_tab', {
      profile: 'fern',
      url: path.join(a.home, 'missing fixture.html'),
    })
    expect(missing.loadError).toBeDefined()
    await a.call('close_tab', { tabId: missing.tabId })
    await a.call('navigate', { tabId: second.tabId, url: file })
    await a.call('navigate', { tabId: first.tabId, url })
    await expect(a.call('download_url', { tabId: first.tabId, url: file })).rejects.toThrow(
      'file URLs and local paths are not supported',
    )
    await expect(a.call('download_url', { tabId: first.tabId, url })).rejects.toThrow(
      'file URLs and local paths are not supported',
    )
    const switched = await a.call('open_tab', {
      profile: 'fern',
      url: 'about:blank',
      visible: false,
      windowOf: second.tabId,
    })
    expect(switched.restoredTabs?.[0]?.tabId).toBe(second.tabId)
    expect((await a.call('list_tabs')).find((t) => t.tabId === second.tabId)?.url).toBe(url)
    await a.call('open_tab', {
      profile: 'fern',
      url: 'about:blank',
      visible: true,
      windowOf: first.tabId,
    })
    const save = path.join(a.home, 'restore.json'),
      profileDir = a.store.dirOf('fern')
    saveVisibleSession(save, a.browser, (name) => {
      const r = a.store.get(name)
      return !!r?.enabled && !r.temporary
    })
    expect(JSON.parse(fs.readFileSync(save, 'utf8')).profiles).toEqual([
      { name: 'fern', urls: [url, url] },
    ])
    expect(fs.statSync(save).mode & 0o777).toBe(0o600)
    await a.browser.closeAll()
    const b = make(a.home)
    expect(b.store.dirOf('fern')).toBe(profileDir)
    expect(
      await restoreVisibleSession({
        file: save,
        store: b.store,
        browser: b.browser,
        tabs: b.tabs,
        logger: silentLogger,
      }),
    ).toEqual(['fern'])
    expect(fs.existsSync(save)).toBe(false)
    await vi.waitFor(
      async () => {
        const rows = await b.call('list_tabs')
        expect(rows.map((t) => t.url)).toEqual([url, url])
        expect(rows.map((t) => t.title)).toEqual([
          'Fictional local fixture',
          'Fictional local fixture',
        ])
      },
      { timeout: 15_000 },
    )
  }, 120_000)
})
