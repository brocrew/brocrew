import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyChromeProfile,
  chromeProfileIntent,
  ChromeLedgerProposal,
  ChromeProposal,
} from '../src/main/plugins/lifecycle/chrome-apply'
import { readChromeConfiguration } from '../src/main/plugins/lifecycle/chrome-read'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PluginUiRpc } from '../src/main/plugins/ui/rpc'
import { PLUGIN_UI_CHANNEL } from '../src/shared/plugin-ui'
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
describe('fixed person-only Chrome profile action mapping', () => {
  it.each([
    [{ action: 'create-profile', profile: 'birch' }, '/profiles', { name: 'birch' }, 201],
    [
      { action: 'set-enabled', profile: 'birch', enabled: true },
      '/profiles/birch/flags',
      { enabled: true },
      200,
    ],
    [{ action: 'open-window', profile: 'birch' }, '/profiles/birch/open', {}, 202],
    [
      { action: 'delete-profile', profile: 'birch', confirm: 'birch' },
      '/profiles/birch/delete',
      { confirm: 'birch' },
      200,
    ],
    [
      { action: 'rename-profile', profile: 'birch', newName: 'Birch account' },
      '/profiles/birch/rename',
      { newName: 'Birch account' },
      200,
    ],
    [{ action: 'helper-on', profile: 'birch' }, '/profiles/birch/helper', {}, 200],
    [
      {
        action: 'set-flags',
        profile: 'birch',
        allowSync: false,
        allowExtensions: true,
        allowSettings: false,
      },
      '/profiles/birch/flags',
      { allowSync: false, allowExtensions: true, allowSettings: false },
      200,
    ],
    [
      {
        action: 'delete-profile',
        profile: 'birch',
        confirm: 'birch',
        deleteConfirmation: 'a'.repeat(64),
      },
      '/profiles/birch/delete',
      { confirm: 'birch', deleteConfirmation: 'a'.repeat(64) },
      200,
    ],
  ])(
    'maps a validated action to only its own fixed admin endpoint',
    async (proposal, path, body, status) => {
      const fetch = vi.fn(async () => new Response('{}', { status: Number(status) }))
      vi.stubGlobal('fetch', fetch)
      await applyChromeProfile(
        connection,
        ChromeProposal.parse(proposal),
        new AbortController().signal,
      )
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
    { action: 'open-window', profile: '../foreign' },
    { action: 'set-enabled', profile: 'birch', enabled: true, url: 'http://foreign.invalid/' },
    { action: 'delete-profile', profile: 'birch' },
    { action: 'delete-profile', profile: 'birch', confirm: 'fern' },
    {
      action: 'delete-profile',
      profile: 'birch',
      confirm: 'birch',
      deleteConfirmation: 'malformed',
    },
    { action: 'set-flags', profile: 'birch' },
    { action: 'set-flags', profile: 'birch', enabled: false },
    { action: 'set-flags', profile: 'birch', allowExtensions: 'true' },
  ])('rejects unreviewed actions/fields before any request', async (proposal) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      applyChromeProfile(connection, proposal as never, new AbortController().signal),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('records turning the helper on as its prerequisite, which earlier owners can read', () => {
    const intent = chromeProfileIntent({ action: 'helper-on', profile: 'birch' })
    expect(intent).toEqual({ action: 'set-enabled', profile: 'birch', enabled: true })
    expect(ChromeLedgerProposal.safeParse({ action: 'helper-on', profile: 'birch' }).success).toBe(
      false,
    )
    expect(
      ChromeProposal.safeParse({ action: 'helper-on', profile: 'birch', on: true }).success,
    ).toBe(false)
  })
  it('keeps shared deletion confirmation and live flags out of replayable profile intent', () => {
    expect(
      chromeProfileIntent({
        action: 'delete-profile',
        profile: 'birch',
        confirm: 'birch',
        deleteConfirmation: 'a'.repeat(64),
      }),
    ).toBeNull()
    expect(
      chromeProfileIntent({ action: 'set-flags', profile: 'birch', allowSync: true }),
    ).toBeNull()
    expect(
      ChromeLedgerProposal.safeParse({ action: 'set-flags', profile: 'birch', allowSync: true })
        .success,
    ).toBe(false)
  })
  it('does not retry an ambiguous admin failure or return downstream bytes', async () => {
    const fetch = vi.fn(async () => new Response('fictional-private-diagnostic', { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      applyChromeProfile(
        connection,
        { action: 'open-window', profile: 'birch' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Plugin unavailable. Try again.')
    expect(fetch).toHaveBeenCalledOnce()
  })
})

it('the real package RPC schema admits a confirmed person Delete to the reviewed adapter', async () => {
  const template = JSON.parse(
    readFileSync(resolve(__dirname, '../../../plugins/chrome/manifest-template.json'), 'utf8'),
  )
  const binding = {
    pluginId: 'chrome',
    installId: 'fictional-install',
    incarnation: 'fictional-incarnation',
    releaseDigest: 'a'.repeat(64),
    leaseId: 'fictional-lease',
  }
  const apply = vi.fn(async (payload: unknown) => {
    ChromeProposal.parse(payload)
    return { applied: true }
  })
  const rpc = new PluginUiRpc({
    binding,
    schemas: template.ui.methodSchemas,
    current: () => true,
    emit() {},
    propose() {},
    now: () => 0,
    peer: { read: async () => ({}), subscribe: async () => () => {}, proposeConfig: apply },
  })
  const payload = { action: 'delete-profile', profile: 'fern', confirm: 'fern' }
  try {
    expect(
      await rpc.invoke({
        channel: PLUGIN_UI_CHANNEL,
        requestId: '1',
        method: 'proposeConfig',
        configRevision: 0,
        payload,
      }),
    ).toEqual({ proposed: true })
    expect(apply).toHaveBeenCalledWith(payload, 0, binding, expect.any(AbortSignal))
    await expect(
      rpc.invoke({
        channel: PLUGIN_UI_CHANNEL,
        requestId: '2',
        method: 'proposeConfig',
        configRevision: 0,
        payload: { ...payload, confirm: 'birch' },
      }),
    ).rejects.toThrow()
  } finally {
    await rpc.close()
  }
})

it('person rename is a live non-replayed action with an immutable profile selector', () => {
  const rename = { action: 'rename-profile' as const, profile: 'birch', newName: 'Birch account' }
  expect(ChromeProposal.parse(rename)).toEqual(rename)
  expect(chromeProfileIntent(rename)).toBeNull()
  expect(ChromeLedgerProposal.safeParse(rename).success).toBe(false)
  expect(ChromeProposal.safeParse({ ...rename, profile: '../foreign' }).success).toBe(false)
  expect(ChromeProposal.safeParse({ ...rename, url: 'https://fictional.invalid' }).success).toBe(
    false,
  )
})

it('the validated person snapshot keeps displayName without changing its stable profile selector', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/profiles')
              ? {
                  profiles: [
                    { name: 'fern', displayName: 'Fern account', enabled: true, open: false },
                  ],
                }
              : { tabs: [] },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  )
  expect(await readChromeConfiguration('chrome', connection)).toMatchObject({
    profiles: [{ name: 'fern', displayName: 'Fern account' }],
  })
})
