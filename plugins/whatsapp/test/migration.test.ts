import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadConfig } from '../src/config.js'
import { startWhatsApp } from '../src/app.js'
import { silentLogger } from '../src/logger.js'
import { FakeBridge, ROWING } from './fakes.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
function fixture(slot: string) {
  const root = fs.mkdtempSync(
    path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'fictional-whatsapp-migration-'),
  )
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, slot, 'host/data/whatsapp')
  fs.mkdirSync(path.join(home, 'bridge'), { recursive: true })
  const saved = {
    'settings.json': JSON.stringify({ read: true, prefix: false, writable: [ROWING.jid] }),
    'bridge/session.db': 'opaque pairing bytes\u0000\u00ff',
    'bridge/session.db-wal': 'opaque session wal',
    'bridge/session.db-shm': 'opaque session shm',
    'bridge/messages.db': 'opaque local history\u0000',
    'bridge/messages.db-wal': 'opaque history wal',
    'bridge/messages.db-shm': 'opaque history shm',
    'legacy-consumed.json': JSON.stringify({ consumed: 42, proposal: { action: 'unlink-phone' } }),
  }
  for (const [file, bytes] of Object.entries(saved)) fs.writeFileSync(path.join(home, file), bytes)
  const fingerprints = () =>
    Object.fromEntries(
      Object.keys(saved).map((file) => [
        file,
        createHash('sha256')
          .update(fs.readFileSync(path.join(home, file)))
          .digest('hex'),
      ]),
    )
  const env = (version: string) => ({
    BROCREW_PLUGIN_DATA: home,
    BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({
      api: 1,
      pluginId: 'whatsapp',
      instanceId: 'fictional-run',
      dataDirectory: home,
      previousVersion: version,
      previousDataSchema: 1,
      dataSchema: 1,
      host: { api: 1, method: 'brocrew/host' },
    }),
    HOME: path.join(root, 'unrelated-home'),
  })
  return { home, env, fingerprints }
}
async function connect(env: Record<string, string>, bridge = new FakeBridge()) {
  const config = loadConfig(env)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const app = await startWhatsApp(config, {
    bridge,
    logger: silentLogger,
    transport: serverTransport,
  })
  cleanup.push(() => app.close())
  const client = new Client({ name: 'fictional-configure', version: '1' })
  await client.connect(clientTransport)
  cleanup.push(() => client.close())
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({
      name,
      arguments: args,
      _meta: {
        workspaceId: 'fictional-workspace',
        requestId: name,
        origin: name === 'whatsapp_before_remove' ? 'lifecycle.beforeRemove' : 'settings.page',
      },
    })
  const value = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args)
    expect(result.isError).not.toBe(true)
    return (
      result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0].text)
    )
  }
  return { config, app, bridge, client, call, value }
}

describe('ordinary WhatsApp package migration', () => {
  it.each(['plugins', 'plugins-custom-slot'])(
    'reopens unchanged opaque pairing/history/settings in %s',
    async (slot) => {
      const fixtureData = fixture(slot)
      const before = fixtureData.fingerprints()
      for (const previousVersion of ['legacy-package', 'current-package', 'current-package']) {
        const { app, bridge, config, value, client } = await connect(
          fixtureData.env(previousVersion),
        )
        expect(config.home).toBe(fixtureData.home)
        expect(config.previousVersion).toBe(previousVersion)
        expect(config.previousDataSchema).toBe(1)
        expect(await value('whatsapp_settings')).toMatchObject({
          read: true,
          prefix: false,
          groups: expect.arrayContaining([
            expect.objectContaining({ jid: ROWING.jid, canWrite: true }),
          ]),
        })
        expect(bridge.unlinked).toBe(0)
        expect(bridge.requests).toEqual([])
        await client.close()
        await app.close()
        expect(fixtureData.fingerprints()).toEqual(before)
      }
    },
  )
  it('uses explicit generic data and ignores ambient HOME and old domain variables', () => {
    const data = fixture('plugins')
    const config = loadConfig({ ...data.env('legacy'), BROCREW_WHATSAPP_DATA: '/fictional/unused' })
    expect(config.home).toBe(data.home)
    expect(config.bridgeData).toBe(path.join(data.home, 'bridge'))
    expect(() => loadConfig({ HOME: data.home })).toThrow()
  })
  it('exposes settings, pairing and switches through the same ordinary MCP connection', async () => {
    const data = fixture('plugins')
    const { value, call, bridge } = await connect(data.env('legacy'))
    expect((await value('whatsapp_status')).state).toBe('linked')
    expect((await value('whatsapp_set_read', { enabled: false })).read).toBe(false)
    expect((await value('whatsapp_set_prefix', { enabled: true })).prefix).toBe(true)
    expect(
      (await value('whatsapp_set_group_write', { group: ROWING.jid, enabled: false })).groups[0]
        .canWrite,
    ).toBe(false)
    await value('whatsapp_refresh_groups')
    expect(bridge.requests).toEqual([{ route: '/groups', body: { refresh: true } }])
    expect((await call('whatsapp_set_read', { enabled: 'yes' })).isError).toBe(true)
    expect((await call('whatsapp_set_read', { enabled: true, unknown: 1 })).isError).toBe(true)
    expect(
      (
        await call('whatsapp_set_group_write', {
          group: '15550000001@s.whatsapp.net',
          enabled: true,
        })
      ).isError,
    ).toBe(true)
    await value('whatsapp_unlink')
    expect(bridge.unlinked).toBe(1)
    expect((await value('whatsapp_link')).state).toBe('pairing')
  })
  it('performs removal cleanup only on the declared explicit tool and reports phone warning', async () => {
    const { call, bridge } = await connect(fixture('plugins').env('legacy'))
    expect(bridge.unlinked).toBe(0)
    const removed = await call('whatsapp_before_remove')
    expect(removed.content).toEqual([{ type: 'text', text: 'Logged out of WhatsApp.' }])
    expect(removed.structuredContent).toEqual({
      status: 'complete',
      message: 'Logged out of WhatsApp.',
    })
    expect(bridge.unlinked).toBe(1)
    bridge.unlink = async () => {
      throw new Error('fictional failure')
    }
    expect((await call('whatsapp_before_remove')).isError).toBe(true)
    bridge.unlink = async () => {}
    bridge.status = () => ({
      state: 'unlinked',
      expired: false,
      account: '',
      qr: null,
      removeOnPhone: true,
    })
    const warning = await call('whatsapp_before_remove')
    const message =
      'Logged out here. Also remove this device on your phone: WhatsApp → Linked devices.'
    expect(warning.content).toEqual([{ type: 'text', text: message }])
    expect(warning.structuredContent).toEqual({ status: 'warning', message })
  })
  it('declares ordinary startup/settings/removal without legacy domain endpoints', () => {
    const manifest = JSON.parse(fs.readFileSync('plugins/whatsapp/manifest-template.json', 'utf8'))
    expect(manifest.format).toBe(3)
    expect(manifest.runtime).toEqual({ kind: 'node', entry: 'server.mjs' })
    expect(manifest.mcp).toEqual({ transport: 'stdio' })
    expect(manifest.lifecycle.beforeRemove).toEqual({ tool: 'whatsapp_before_remove' })
    expect(manifest.lifecycle.dataOnRemove).toBe('remove')
    expect(manifest.settings.page.entry).toBe('ui/index.html')
    expect(manifest.server).toBeUndefined()
    const entry = fs.readFileSync('plugins/whatsapp/src/index.ts', 'utf8')
    expect(entry).not.toContain('process.send')
    expect(entry).not.toContain('brocrew-plugin-node:v1')
  })
})
