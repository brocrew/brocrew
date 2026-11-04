import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadConfig } from '../src/config.js'
import { startWhatsApp } from '../src/app.js'
import { createSettingsStore } from '../src/settings.js'
import { FakeBridge, ROWING } from './fakes.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function fixture() {
  const home = fs.mkdtempSync(
    path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'fictional-whatsapp-origin-'),
  )
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
  const config = loadConfig({ BROCREW_PLUGIN_DATA: home })
  const settings = createSettingsStore(home)
  settings.setRead(false)
  const bridge = new FakeBridge()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const app = await startWhatsApp(config, { bridge, settings, transport: serverTransport })
  cleanup.push(() => app.close())
  const client = new Client({ name: 'fictional-agent', version: '1' })
  await client.connect(clientTransport)
  cleanup.push(() => client.close())
  const call = (name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) =>
    client.callTool({ name, arguments: args, ...(meta ? { _meta: meta } : {}) })
  return { home, settings, bridge, call }
}
const metadata = (origin: string) => ({
  origin,
  workspaceId: 'fictional-workspace',
  requestId: 'fictional-request',
})
const operations: Array<[string, Record<string, unknown>]> = [
  ['whatsapp_status', {}],
  ['whatsapp_settings', {}],
  ['whatsapp_link', {}],
  ['whatsapp_unlink', {}],
  ['whatsapp_refresh_groups', {}],
  ['whatsapp_set_read', { enabled: true }],
  ['whatsapp_set_prefix', { enabled: false }],
  ['whatsapp_set_group_write', { group: ROWING.jid, enabled: true }],
  ['whatsapp_before_remove', {}],
]
it.each([undefined, 'agent', 'unknown', 'ui.button', 'notification'])(
  'refuses %s origin before disclosing configuration or changing data',
  async (origin) => {
    const { home, settings, bridge, call } = await fixture()
    const before = fs.readFileSync(path.join(home, 'settings.json'))
    for (const [name, args] of operations) {
      const answer = await call(name, args, origin === undefined ? undefined : metadata(origin))
      expect(answer.isError).toBe(true)
      expect(JSON.stringify(answer)).not.toContain(ROWING.name)
      expect(JSON.stringify(answer)).not.toContain('Fictional Phone')
    }
    expect(settings.get()).toEqual({ read: false, prefix: true, writable: [] })
    expect(bridge.unlinked).toBe(0)
    expect(bridge.requests).toEqual([])
    expect(bridge.state).toBe('linked')
    expect(fs.readFileSync(path.join(home, 'settings.json'))).toEqual(before)
  },
)
it('requires complete host metadata and ignores origin supplied inside arguments', async () => {
  const { settings, bridge, call } = await fixture()
  for (const meta of [
    { origin: 'settings.page' },
    { ...metadata('settings.page'), workspaceId: '' },
    { ...metadata('settings.page'), requestId: '' },
  ]) {
    expect((await call('whatsapp_set_read', { enabled: true }, meta)).isError).toBe(true)
  }
  expect(
    (
      await call(
        'whatsapp_set_read',
        { enabled: true, _meta: metadata('settings.page') },
        metadata('agent'),
      )
    ).isError,
  ).toBe(true)
  expect(settings.get().read).toBe(false)
  expect(bridge.unlinked).toBe(0)
})
it('allows Configure choices and reserves beforeRemove for explicit lifecycle removal', async () => {
  const { settings, bridge, call } = await fixture()
  expect(
    (await call('whatsapp_set_read', { enabled: true }, metadata('settings.page'))).isError,
  ).toBeFalsy()
  expect(
    (
      await call(
        'whatsapp_set_group_write',
        { group: ROWING.jid, enabled: true },
        metadata('settings.page'),
      )
    ).isError,
  ).toBeFalsy()
  expect(settings.get().read).toBe(true)
  expect(settings.get().writable).toEqual([ROWING.jid])
  expect((await call('whatsapp_before_remove', {}, metadata('settings.page'))).isError).toBe(true)
  expect(
    (await call('whatsapp_set_read', { enabled: false }, metadata('lifecycle.beforeRemove')))
      .isError,
  ).toBe(true)
  expect(bridge.unlinked).toBe(0)
  expect(
    (await call('whatsapp_before_remove', {}, metadata('lifecycle.beforeRemove'))).isError,
  ).toBeFalsy()
  expect(bridge.unlinked).toBe(1)
})
