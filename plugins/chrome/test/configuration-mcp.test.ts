import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createProfileStore } from '../src/profiles/store.js'
import { createConfigurationTools, createConfigurationDiscovery } from '../src/configuration.js'
import { TabRegistry } from '../src/tabs.js'
import { FakeBrowser } from './fakes.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createChromeMcpServer } from '../src/configuration.js'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-configure-'))
  dirs.push(home)
  const store = createProfileStore({ home })
  store.create('fern', 'panel')
  store.create('birch', 'panel')
  const browser = new FakeBrowser(store.dirOf)
  const open = vi.fn(async () => undefined)
  const tools = createConfigurationTools({ store, browser, opener: { open } })
  const action = tools.find((t) => t.definition.name === 'configure_profile')!
  return {
    home,
    store,
    browser,
    open,
    tools,
    call: (args: Record<string, unknown>) =>
      action.execute(args, {
        origin: 'settings.page',
        workspaceId: 'fictional-workspace',
        requestId: 'fictional-request',
      }),
  }
}
describe('Chrome Configure MCP actions', () => {
  it.each([undefined, '', '*', 'missing', 5])(
    'rejects invalid explicit profile %j before effects',
    async (profile) => {
      const { call, open, store } = fixture()
      const before = store.list()
      await expect(call({ action: 'open-window', profile })).rejects.toThrow()
      expect(open).not.toHaveBeenCalled()
      expect(store.list()).toEqual(before)
    },
  )
  it('requires profile in every exposed configuration action schema', () => {
    for (const tool of fixture().tools) {
      expect(tool.definition.inputSchema.required).toContain('profile')
      expect(tool.definition.inputSchema.properties.profile).toMatchObject({ minLength: 1 })
    }
  })
  it('updates only the named profile and preserves account bytes across recreation', async () => {
    const { home, call, store } = fixture()
    const opaque = path.join(store.dirOf('fern'), 'fictional-account')
    fs.writeFileSync(opaque, 'opaque fictional account bytes')
    const birch = store.get('birch')
    await call({ action: 'set-flags', profile: 'fern', enabled: true, keepRunning: true })
    const reopened = createProfileStore({ home })
    expect(reopened.get('fern')).toMatchObject({ enabled: true, keepRunning: true })
    expect(reopened.get('birch')).toEqual(birch)
    expect(fs.readFileSync(opaque, 'utf8')).toBe('opaque fictional account bytes')
  })
  it('creates only explicitly named profiles and refuses duplicate creation', async () => {
    const { call, store } = fixture()
    await call({ action: 'create-profile', profile: 'moss' })
    expect(store.get('moss')).toBeDefined()
    await expect(call({ action: 'create-profile', profile: 'moss' })).rejects.toThrow()
    await expect(call({ action: 'create-profile' })).rejects.toThrow()
    expect(
      store
        .list()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['birch', 'fern', 'moss'])
  })
  it('keeps temporary profile restrictions and explicit deletion confirmation', async () => {
    const { call, store } = fixture()
    store.create('temp', 'agent', { temporary: true })
    await expect(
      call({ action: 'set-flags', profile: 'temp', keepRunning: true }),
    ).rejects.toThrow()
    await expect(
      call({ action: 'delete-profile', profile: 'fern', confirm: 'birch' }),
    ).rejects.toThrow()
    expect(store.get('fern')).toBeDefined()
    await call({ action: 'delete-profile', profile: 'fern', confirm: 'fern' })
    expect(store.get('fern')).toBeUndefined()
  })
  it('rejects unknown actions and fields without modifying flags', async () => {
    const { call, store } = fixture()
    const before = store.get('fern')
    await expect(call({ action: 'set-flags', profile: 'fern', enabled: 'yes' })).rejects.toThrow()
    await expect(
      call({ action: 'set-flags', profile: 'fern', enabled: true, replay: true }),
    ).rejects.toThrow()
    await expect(call({ action: 'replay', profile: 'fern' })).rejects.toThrow()
    expect(store.get('fern')).toEqual(before)
  })
  it('serves Configure actions through ordinary MCP and reports errors without a listener', async () => {
    const { tools, store } = fixture()
    const server = createChromeMcpServer(tools)
    const client = new Client({ name: 'fictional-configure', version: 'fictional' })
    const [left, right] = InMemoryTransport.createLinkedPair()
    await server.connect(right)
    try {
      await client.connect(left)
      expect((await client.listTools()).tools.some((t) => t.name === 'configure_profile')).toBe(
        true,
      )
      expect(
        (await client.callTool({ name: 'configure_profile', arguments: { action: 'set-enabled' } }))
          .isError,
      ).toBe(true)
      const result = await client.callTool({
        name: 'configure_profile',
        arguments: { action: 'set-enabled', profile: 'fern', enabled: true },
        _meta: {
          origin: 'settings.page',
          workspaceId: 'fictional-workspace',
          requestId: 'fictional-request',
        },
      })
      expect(result.isError).not.toBe(true)
      expect(store.get('fern')?.enabled).toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })
  it.each([
    {},
    { origin: 'agent', workspaceId: 'fictional', requestId: 1 },
    { origin: 'settings.page' },
  ])('refuses modifying Configure calls from missing/agent metadata %j', async (metadata) => {
    const { tools, store } = fixture()
    const before = store.list()
    await expect(
      tools[0].execute({ action: 'set-enabled', profile: 'fern', enabled: true }, metadata),
    ).rejects.toThrow()
    await expect(
      tools[0].execute(
        { action: 'delete-profile', profile: 'fern', confirm: 'fern', origin: 'settings.page' },
        metadata,
      ),
    ).rejects.toThrow()
    expect(store.list()).toEqual(before)
  })
  it('exposes profileless discovery without granting any modifying action', async () => {
    const { store, browser } = fixture()
    const tool = createConfigurationDiscovery({ store, browser, tabs: new TabRegistry() })
    expect(tool.definition.inputSchema.properties.profile).toBeUndefined()
    const result = await tool.execute({}, { origin: 'agent' })
    const value = JSON.parse(result.content[0].text)
    expect(value.profiles.map((profile: { name: string }) => profile.name).sort()).toEqual([
      'birch',
      'fern',
    ])
    expect(value.tabs).toEqual([])
  })
})
