import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyWhatsAppSettings,
  logOutBeforeUninstall,
  WhatsAppProposal,
} from '../src/main/plugins/lifecycle/whatsapp-apply'
import { readWhatsAppConfiguration } from '../src/main/plugins/lifecycle/whatsapp-read'
import { whatsappBrokerBinding } from '../src/main/plugins/lifecycle/whatsapp-broker'
import { pluginAdapter } from '../src/main/plugins/lifecycle/adapters'
import { proposalFor } from '../src/main/plugins/lifecycle/proposals'
import type { PluginNodeReady } from '../src/main/plugins/node-host'
afterEach(() => vi.unstubAllGlobals())
const connection: PluginNodeReady = {
  serverPid: 123,
  origin: 'http://127.0.0.1:1',
  mcp: () => ({ url: '', headers: { Authorization: 'Bearer fictional-mcp' } }),
  admin: () => ({
    url: 'http://127.0.0.1:1/v1',
    headers: { Authorization: 'Bearer fictional-admin' },
  }),
}
const ROWING = '120363000000000001@g.us'

describe('fixed person-only WhatsApp settings mapping', () => {
  it.each([
    [{ action: 'link-phone' }, '/link', {}, 200],
    [{ action: 'unlink-phone' }, '/unlink', {}, 202],
    [{ action: 'refresh-groups' }, '/refresh-groups', {}, 200],
    [{ action: 'set-read', enabled: true }, '/read', { enabled: true }, 200],
    [{ action: 'set-prefix', enabled: false }, '/prefix', { enabled: false }, 200],
    [
      { action: 'set-group-write', group: ROWING, enabled: true },
      '/group-write',
      { group: ROWING, enabled: true },
      200,
    ],
  ])(
    'maps a validated action to only its own fixed admin route',
    async (proposal, path, body, status) => {
      const fetch = vi.fn(async () => new Response('{}', { status: Number(status) }))
      vi.stubGlobal('fetch', fetch)
      await applyWhatsAppSettings(connection, proposal, new AbortController().signal)
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:1/v1' + path,
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
          body: JSON.stringify(body),
          headers: expect.objectContaining({ Authorization: 'Bearer fictional-admin' }),
        }),
      )
    },
  )
  it.each([
    { action: 'set-group-write', group: '15550000001@s.whatsapp.net', enabled: true },
    { action: 'set-group-write', group: '../foreign', enabled: true },
    { action: 'set-read', enabled: 'yes' },
    { action: 'link-phone', url: 'http://foreign.invalid/' },
    { action: 'send-message', group: ROWING, text: 'Hello' },
    { action: 'create-profile', profile: 'birch' },
  ])('rejects unreviewed actions, fields and people before any request', async (proposal) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      applyWhatsAppSettings(connection, proposal, new AbortController().signal),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous admin failure', async () => {
    const fetch = vi.fn(async () => new Response('fictional-private-diagnostic', { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      applyWhatsAppSettings(connection, { action: 'unlink-phone' }, new AbortController().signal),
    ).rejects.toThrow('Plugin unavailable. Try again.')
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('uninstalling', () => {
  it('asks the plugin to log out and waits for its answer', async () => {
    let removed = false
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/uninstall')) {
        removed = true
        return Response.json({})
      }
      return Response.json({ state: removed ? 'unlinked' : 'linked', removeOnPhone: false })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(logOutBeforeUninstall(connection, new AbortController().signal)).resolves.toBe(
      'confirmed',
    )
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1/v1/uninstall',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        body: '{}',
        headers: expect.objectContaining({ Authorization: 'Bearer fictional-admin' }),
      }),
    )
    expect(pluginAdapter('whatsapp')?.uninstall).toBeTypeOf('function')
    expect(pluginAdapter('chrome')?.uninstall).toBeUndefined()
  })
  it('reports a log out the plugin did not finish', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 504 })),
    )
    await expect(logOutBeforeUninstall(connection, new AbortController().signal)).rejects.toThrow(
      'Plugin unavailable. Try again.',
    )
  })
})

describe('the settings page view', () => {
  function serve(status: unknown, settings: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(url.endsWith('/status') ? status : settings, { status: 200 }),
      ),
    )
  }
  it('passes the link state and the switches, and nothing else the plugin sends', async () => {
    serve(
      {
        state: 'pairing',
        expired: false,
        account: '',
        qr: { size: 21, bits: '1'.repeat(441), expiresAt: 1 },
        removeOnPhone: true,
        token: 'x',
      },
      {
        read: false,
        prefix: true,
        groups: [{ jid: ROWING, name: 'Harbour Rowing Club', canWrite: true, members: ['Ines'] }],
        messages: ['Training moves to Thursday'],
      },
    )
    expect(await readWhatsAppConfiguration(connection)).toEqual({
      configRevision: 0,
      status: {
        state: 'pairing',
        expired: false,
        account: '',
        qr: { size: 21, bits: '1'.repeat(441), expiresAt: 1 },
        removeOnPhone: true,
      },
      read: false,
      prefix: true,
      groups: [{ jid: ROWING, name: 'Harbour Rowing Club', canWrite: true }],
    })
  })
  it('refuses a malformed QR pattern or a person among the groups', async () => {
    serve(
      {
        state: 'pairing',
        expired: false,
        account: '',
        qr: { size: 21, bits: 'abc', expiresAt: 1 },
      },
      { read: false, prefix: true, groups: [] },
    )
    await expect(readWhatsAppConfiguration(connection)).rejects.toThrow()
    serve(
      { state: 'linked', expired: false, account: 'Fictional Phone', qr: null },
      {
        read: true,
        prefix: true,
        groups: [{ jid: '15550000001@s.whatsapp.net', name: 'Ines', canWrite: true }],
      },
    )
    await expect(readWhatsAppConfiguration(connection)).rejects.toThrow()
  })
})

describe('the plugin registry', () => {
  it('keeps each plugin to its own page actions', () => {
    expect(proposalFor('whatsapp')?.safeParse({ action: 'set-read', enabled: true }).success).toBe(
      true,
    )
    expect(
      proposalFor('whatsapp')?.safeParse({ action: 'open-window', profile: 'birch' }).success,
    ).toBe(false)
    expect(proposalFor('chrome')?.safeParse({ action: 'set-read', enabled: true }).success).toBe(
      false,
    )
    expect(WhatsAppProposal.safeParse({ action: 'unlink-phone' }).success).toBe(true)
    for (const id of ['fictional-atlas', 'constructor', '__proto__', 'toString']) {
      expect(proposalFor(id)).toBeUndefined()
      expect(pluginAdapter(id)).toBeUndefined()
    }
    expect(pluginAdapter('whatsapp')).toBeDefined()
    expect(pluginAdapter('chrome')).toBeDefined()
  })
  it('binds tools only for the WhatsApp package that declares its account resource', async () => {
    const view = (
      pluginId: string,
      resources: Array<{ id: string; label: string; read: boolean; write: boolean }>,
    ) =>
      ({
        installation: { pluginId },
        package: { compatibility: { tools: true }, manifest: { permissions: { resources } } },
        connection: new Promise(() => undefined),
        current: () => true,
      }) as never
    const account = [{ id: 'whatsapp', label: 'Fictional account', read: true, write: true }]
    await expect(whatsappBrokerBinding(view('chrome', account), () => undefined)).rejects.toThrow(
      'unavailable',
    )
    await expect(whatsappBrokerBinding(view('whatsapp', []), () => undefined)).rejects.toThrow(
      'unavailable',
    )
  })
})
