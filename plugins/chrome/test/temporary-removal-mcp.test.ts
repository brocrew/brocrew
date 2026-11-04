import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { createToolServer } from '../src/shared/toolServer.js'
import { allToolDefs, createAgentChromeTools } from '../src/tools/index.js'
import { createWindowTasks } from '../src/windows.js'
import { FakeBrowser, harness } from './fakes.js'

const cleanup: Array<() => unknown> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
function fixture() {
  const h = harness()
  cleanup.push(() => {
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  })
  const shared = path.join(h.home, 'shared')
  fs.mkdirSync(shared)
  const open = (owner = 'alpha') => {
    const home = path.join(h.home, owner)
    fs.mkdirSync(home, { recursive: true })
    return createSharedProfileStore({
      home,
      shared,
      workspaceId: owner,
      workspaceLabel: owner,
      chromeState: () => 'ended',
      ownerState: () => 'alive',
      processIdentity: { pid: process.pid, birth: 'fictional' },
      readVolumeIdentity: () => 'apfs:11111111-1111-4111-8111-111111111111',
    })
  }
  const connect = async (store: ReturnType<typeof open>) => {
    const browser = new FakeBrowser(store.dirOf)
    const agentCall = vi.fn()
    Object.assign(browser, {
      agentCall: async <T>(profiles: readonly string[], work: () => Promise<T>) => {
        agentCall(profiles)
        return work()
      },
    })
    const deps = { ...h.deps, store, browser, windows: createWindowTasks({ browser }) }
    const server = createToolServer({
      name: 'fictional-chrome',
      version: '1',
      tools: createAgentChromeTools(deps),
    })
    const client = new Client({ name: 'fictional-agent', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    cleanup.push(
      () => server.close(),
      () => client.close(),
    )
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      const text =
        (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
          ?.text ?? ''
      return { text, json: text.startsWith('Error:') ? undefined : JSON.parse(text) }
    }
    return { call, agentCall, deps }
  }
  const failedDeletion = async () => {
    const store = open()
    const agent = await connect(store)
    expect(
      (await agent.call('create_browser_profile', { profile: 'named-fern', temporary: true })).json,
    ).toMatchObject({ name: 'named-fern' })
    const directory = store.dirOf('named-fern')
    const rename = fs.renameSync
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((source, dest) => {
      if (String(dest) === path.join(shared, 'registry.json'))
        throw new Error('retirement publication fault')
      return rename(source, dest)
    })
    expect((await agent.call('delete_browser_profile', { profile: 'named-fern' })).text).toContain(
      'Error:',
    )
    fault.mockRestore()
    expect(store.get('named-fern')).toBeUndefined()
    expect(fs.existsSync(directory)).toBe(false)
    return { directory }
  }
  return { open, connect, failedDeletion, shared }
}
it('MCP create, failed delete, reopen, explicit delete retry and shared create all use the requested name', async () => {
  const f = fixture()
  await f.failedDeletion()
  const store = f.open()
  const agent = await f.connect(store)
  expect((await agent.call('delete_browser_profile', { profile: 'named-fern' })).json).toEqual({
    deleted: 'named-fern',
  })
  expect(agent.agentCall).not.toHaveBeenCalled()
  expect(
    (await agent.call('create_browser_profile', { profile: 'named-fern' })).json,
  ).toMatchObject({ name: 'named-fern', temporary: false })
  expect(store.get('named-fern')?.temporary).toBe(false)
})
it('MCP retry never retires a foreign reservation or remaining profile bytes', async () => {
  const f = fixture()
  const { directory } = await f.failedDeletion()
  const beta = await f.connect(f.open('beta'))
  expect((await beta.call('delete_browser_profile', { profile: 'named-fern' })).text).toContain(
    'Error:',
  )
  expect(beta.agentCall).not.toHaveBeenCalled()
  fs.mkdirSync(directory)
  const marker = path.join(directory, 'opaque-session')
  fs.writeFileSync(marker, 'fictional remaining session')
  const alpha = await f.connect(f.open())
  expect((await alpha.call('delete_browser_profile', { profile: 'named-fern' })).text).toContain(
    'Error:',
  )
  expect(alpha.agentCall).not.toHaveBeenCalled()
  expect(fs.readFileSync(marker, 'utf8')).toBe('fictional remaining session')
  expect(
    JSON.parse(fs.readFileSync(path.join(f.shared, 'registry.json'), 'utf8'))
      .namedTemporaryProfiles,
  ).toHaveLength(1)
})
it('MCP unknown/disabled calls and direct mismatched retry selectors fail before browser effects', async () => {
  const f = fixture()
  await f.failedDeletion()
  const store = f.open()
  store.create('off', 'panel')
  store.setFlags('off', { enabled: false })
  const agent = await f.connect(store)
  for (const profile of ['unknown', 'off'])
    expect((await agent.call('delete_browser_profile', { profile })).text).toContain('Error:')
  const def = allToolDefs().find((d) => d.spec.name === 'delete_browser_profile')!
  for (const selector of ['tabId', 'windowOf'])
    await expect(
      def.run({ profile: 'named-fern', [selector]: 't999' }, agent.deps),
    ).rejects.toThrow(/profile/)
  expect(agent.agentCall).not.toHaveBeenCalled()
  expect(
    JSON.parse(fs.readFileSync(path.join(f.shared, 'registry.json'), 'utf8'))
      .namedTemporaryProfiles,
  ).toHaveLength(1)
})
