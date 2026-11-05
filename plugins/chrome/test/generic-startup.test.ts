import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as release from '../src/sharedProfilesRelease.js'
import { loadConfig } from '../src/config.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { startAgentChrome } from '../src/app.js'
import { createProfileStore } from '../src/profiles/store.js'
import { FakeBrowser } from './fakes.js'
import { silentLogger } from '../src/logger.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  roots.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))
})
function fixture(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-bootstrap-'))
  roots.push(root)
  const home = path.join(root, 'selected', 'host', 'data', 'chrome')
  fs.mkdirSync(home, { recursive: true })
  const bootstrap = {
    api: 1,
    pluginId: 'chrome',
    instanceId: 'fictional-instance',
    dataDirectory: home,
    dataSchema: 1,
    previousVersion: 'fictional-old',
    previousDataSchema: 1,
    host: { api: 1, method: 'brocrew/host' },
    ...extra,
  }
  return { root, home, env: { BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify(bootstrap) } }
}
describe('Chrome generic bootstrap', () => {
  it('retains the exact selected private directory and opaque bytes on repeated update startup', () => {
    const { home, env } = fixture()
    const opaque = path.join(home, 'opaque-account')
    fs.writeFileSync(opaque, 'fictional signed-in bytes')
    const first = loadConfig(env)
    const second = loadConfig(env)
    expect(first.home).toBe(home)
    expect(second.home).toBe(home)
    expect(first.previousVersion).toBe('fictional-old')
    expect(first.previousDataSchema).toBe(1)
    expect(fs.readFileSync(opaque, 'utf8')).toBe('fictional signed-in bytes')
    expect(first.token).not.toBe(second.token)
  })
  it.each([
    { dataDirectory: 'relative' },
    { pluginId: 'other' },
    { api: 2 },
    { dataSchema: 2 },
    { previousDataSchema: 2 },
  ])('refuses malformed or unsupported startup before creating another store: %j', (extra) => {
    const { env } = fixture(extra)
    expect(() => loadConfig(env)).toThrow()
  })
  it('never falls back to HOME, cwd, or legacy plugin-specific data variables', () => {
    expect(() => loadConfig({ BROCREW_CHROME_DATA: '/fictional/legacy' })).toThrow()
    expect(() => loadConfig({ BROCREW_PLUGIN_BOOTSTRAP: '{' })).toThrow()
  })
  it('uses the prior installation owner supplied by generic bootstrap without inventing an identity', () => {
    vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(true)
    const { root, env } = fixture()
    const shared = path.join(root, 'shared')
    fs.mkdirSync(shared)
    const priorOwner = {
      ownerId: '12345678-1234-5123-a123-123456789012',
      ownerLabel: 'the default workspaces',
    }
    const value = JSON.parse(env.BROCREW_PLUGIN_BOOTSTRAP)
    const config = loadConfig({
      BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({
        ...value,
        priorOwner,
        sharedDataDirectory: shared,
      }),
    })
    expect(config.shared).toMatchObject({
      workspaceId: priorOwner.ownerId,
      workspaceLabel: priorOwner.ownerLabel,
    })
  })
  it('uses the actual platform release decision without writing shared storage when OFF', () => {
    const { root, env } = fixture()
    const shared = path.join(root, 'uncreated-shared')
    const value = JSON.parse(env.BROCREW_PLUGIN_BOOTSTRAP)
    const config = loadConfig({
      BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({
        ...value,
        sharedDataDirectory: shared,
        priorOwner: { ownerId: '12345678-1234-5123-a123-123456789012', ownerLabel: 'fictional' },
      }),
    })
    const on = release.sharedProfilesReleased(process.platform, release.sharedProfilesRelease)
    expect(!!config.shared).toBe(on)
    if (!on) expect(fs.existsSync(shared)).toBe(false)
  })
  it('starts ordinary MCP with fake browser, preserves permanent bytes and retains the temporary restart lifecycle', async () => {
    const { env, home } = fixture()
    const config = loadConfig(env)
    const store = createProfileStore({ home })
    store.create('fern', 'panel')
    store.create('temporary', 'agent', { temporary: true })
    const opaque = path.join(store.dirOf('fern'), 'fictional-account')
    fs.writeFileSync(opaque, 'opaque permanent fictional bytes')
    const running = await startAgentChrome(config, {
      store,
      browser: new FakeBrowser(store.dirOf),
      logger: silentLogger,
    })
    const client = new Client({ name: 'fictional-host', version: 'fictional' })
    try {
      const port = (running.httpServer.address() as { port: number }).port
      const base = `http://127.0.0.1:${port}`
      await client.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
        }),
      )
      expect(
        (await client.listTools()).tools.some((tool) => tool.name === 'configuration_snapshot'),
      ).toBe(true)
      expect(
        (await client.callTool({ name: 'open_tab', arguments: { url: 'about:blank' } })).isError,
      ).toBe(true)
      expect(
        (
          await fetch(base + '/v1/profiles', {
            headers: { Authorization: `Bearer ${config.token}` },
          })
        ).status,
      ).toBe(404)
      expect(
        (await fetch(base + '/healthz', { headers: { Authorization: `Bearer ${config.token}` } }))
          .status,
      ).toBe(404)
      expect(store.get('temporary')).toBeUndefined()
      expect(fs.readFileSync(opaque, 'utf8')).toBe('opaque permanent fictional bytes')
    } finally {
      await client.close()
      await running.close()
    }
  })
  it('keeps shared data separate and retains the historical root owner choices on update', () => {
    vi.spyOn(release, 'sharedProfilesReleased').mockReturnValue(true)
    const owner = '12345678-1234-5123-a123-123456789012'
    const other = '87654321-1234-5123-a123-123456789012'
    const { root, home, env } = fixture()
    const shared = path.join(root, 'appData', 'shared', 'chrome')
    fs.mkdirSync(shared, { recursive: true })
    fs.mkdirSync(path.join(root, 'other', 'host', 'data', 'chrome'), { recursive: true })
    const bootstrap = JSON.parse(env.BROCREW_PLUGIN_BOOTSTRAP)
    const config = loadConfig({
      BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({ ...bootstrap, sharedDataDirectory: shared }),
      BROCREW_PLUGIN_OWNER_ID: owner,
      BROCREW_PLUGIN_OWNER_LABEL: 'the default workspaces',
    })
    expect(config.home).toBe(home)
    expect(config.shared).toMatchObject({ root: shared, workspaceId: owner })
    const open = (id: string) =>
      createSharedProfileStore({
        home: id === owner ? config.home : path.join(root, 'other', 'host', 'data', 'chrome'),
        shared,
        workspaceId: id,
        workspaceLabel: id,
        migrationApproved: true,
        processIdentity: { pid: 999999, birth: 'fictional-process' },
        ownerState: () => 'gone',
        chromeState: () => 'ended',
        readVolumeIdentity: () => 'apfs:11111111-1111-1111-1111-111111111111',
      })
    const first = open(owner)
    const created = first.create('fern', 'panel')
    first.setFlags(created.name, { enabled: false, keepRunning: true, allowSync: false })
    const second = open(other)
    second.setFlags(created.name, { enabled: true, keepRunning: false })
    const opaque = path.join(first.dirOf(created.name), 'fictional-account')
    fs.writeFileSync(opaque, 'opaque shared fictional bytes')
    expect(open(owner).get(created.name)).toMatchObject({
      enabled: false,
      keepRunning: true,
      allowSync: false,
    })
    expect(open(other).get(created.name)).toMatchObject({
      enabled: true,
      keepRunning: false,
      allowSync: false,
    })
    expect(fs.readFileSync(opaque, 'utf8')).toBe('opaque shared fictional bytes')
  })
})
