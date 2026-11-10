import { chromeAdminRouteFixture } from '../../../scripts/lib/plugin-chrome-admin-fixture.mjs'
import { PluginUiRpc } from '../src/main/plugins/ui/rpc'
import { chromeUiFixture } from './chrome-ui-fixture'
import { PLUGIN_UI_CHANNEL } from '../src/shared/plugin-ui'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readFile, readdir, rm } from 'node:fs/promises'
import { digest } from '../src/main/plugins/node-host-files'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'
import { PluginProfileLedger as PreviousLedger } from './fixtures/plugin-configuration-parent/profile-ledger'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import {
  applyPluginConfiguration,
  readPluginConfiguration,
} from '../src/main/plugins/lifecycle/configuration'
import {
  cleanupLifecycleFixtures,
  fixture,
  projection,
  deferred,
} from './plugin-lifecycle-fixtures'

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
const endpoint = {
  admin: () => ({
    url: 'http://127.0.0.1:1/custom-admin',
    headers: { Authorization: 'Bearer fictional' },
  }),
} as Parameters<typeof applyPluginConfiguration>[0]
it('forwards arbitrary package snapshots and commands over the declared admin transport', async () => {
  const snapshot = { vendor: { stage: 'package-defined', records: [1, 2] }, title: 'Opaque' }
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(init?.method === 'POST' ? { applied: true } : snapshot),
  )
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal
  expect(await readPluginConfiguration(endpoint, signal)).toEqual(snapshot)
  const payload = { verb: 'fictional-command', fields: ['package', 'owns', 'schema'] }
  await applyPluginConfiguration(endpoint, payload, 7, signal)
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    'http://127.0.0.1:1/custom-admin/configuration',
    'http://127.0.0.1:1/custom-admin/configuration',
  ])
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({
    payload,
    configRevision: 7,
  })
})
it('preserves actual package failures and never accepts an incomplete application as success', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'Package storage failed.' }, { status: 500 }))
    .mockResolvedValueOnce(Response.json({ applied: false }))
    .mockResolvedValueOnce(Response.json({ error: 'Package snapshot failed.' }, { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  await expect(
    applyPluginConfiguration(endpoint, {}, 0, new AbortController().signal),
  ).rejects.toThrow('Package storage failed.')
  await expect(
    applyPluginConfiguration(endpoint, {}, 1, new AbortController().signal),
  ).rejects.toThrow('not applied')
  await expect(readPluginConfiguration(endpoint, new AbortController().signal)).rejects.toThrow(
    'Package snapshot failed.',
  )
  expect(fetch).toHaveBeenCalledTimes(3)
})

describe.skipIf(process.platform === 'win32')('consumed configuration checkpoints', () => {
  it('consumes before I/O, keeps generic input opaque and refuses stale presses', async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const active = f.state.exportActivation().entries[0]!,
      sequence = f.state.inspect().sequence
    const ledger = new PluginProfileLedger(f.root)
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/configuration')
      expect(init?.method).toBe('POST')
      expect(await ledger.revision(active.installId)).toBe(1)
      return Response.json({ applied: true })
    })
    vi.stubGlobal('fetch', fetch)
    const input = {
      pluginId: 'chrome',
      installId: active.installId,
      incarnation: active.incarnation,
      revision: 0,
      proposal: { vendorOperation: 'unknown-to-core', nested: [false, 2] },
    }
    await f.controller.applyProfile(f.handle, input)
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string)).toEqual({
      payload: input.proposal,
      configRevision: 0,
    })
    expect(f.state.inspect().sequence).toBe(sequence)
    await expect(f.controller.applyProfile(f.handle, input)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
    const directory = join(f.root, 'profile-apply', digest(Buffer.from(active.installId)))
    expect(await readdir(join(directory, 'intents'))).toEqual([])
    expect(JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8'))).toMatchObject({
      format: 2,
      revision: 1,
    })
  })
  it('serializes same-revision presses from two workspaces and awaits completed application', async () => {
    const f = await fixture(),
      other = await f.controller.attach(projection().sink)
    await f.controller.install(f.handle, 'chrome')
    const active = f.state.exportActivation().entries[0]!,
      work = deferred<Response>()
    const fetch = vi.fn(() => work.promise)
    vi.stubGlobal('fetch', fetch)
    const input = {
      pluginId: 'chrome',
      installId: active.installId,
      incarnation: active.incarnation,
      revision: 0,
      proposal: { action: 'anything' },
    }
    const result = Promise.allSettled([
      f.controller.applyProfile(f.handle, input),
      f.controller.applyProfile(other, input),
    ])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    work.resolve(Response.json({ applied: true }))
    expect((await result).map((one) => one.status)).toEqual(['fulfilled', 'rejected'])
  })
  it('does not replay ambiguous failure on controller reopen', async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const active = f.state.exportActivation().entries[0]!
    const fetch = vi.fn(async () => {
      throw new Error('fictional lost reply')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(
      f.controller.applyProfile(f.handle, {
        pluginId: 'chrome',
        installId: active.installId,
        incarnation: active.incarnation,
        revision: 0,
        proposal: { action: 'anything' },
      }),
    ).rejects.toThrow('lost reply')
    const controller = await PluginLifecycleController.open(f.opts)
    const handle = await controller.attach(projection().sink)
    expect(await controller.profileRevision(handle, 'chrome', active.installId)).toBe(1)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('migrates real older records, keeps revision/hash continuity and lets the preceding checkpoint reader read the result', async () => {
    const f = await fixture(),
      id = '11111111-1111-4111-a111-111111111111'
    const previous = new PreviousLedger(f.root)
    await previous.reserve(id, 0, { action: 'create-profile', profile: 'fern' })
    const directory = join(f.root, 'profile-apply', digest(Buffer.from(id)))
    const bytes = await readFile(join(directory, 'intents', '00000001.json'))
    const ledger = new PluginProfileLedger(f.root)
    expect(await ledger.revision(id)).toBe(1)
    expect(await previous.revision(id)).toBe(1)
    await ledger.reserve(id, 1)
    expect(await ledger.revision(id)).toBe(2)
    expect(await previous.revision(id)).toBe(2)
    expect(await readdir(join(directory, 'intents'))).toEqual([])
    expect(JSON.parse(bytes.toString()).proposal).toEqual({
      action: 'create-profile',
      profile: 'fern',
    })
    expect(JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8'))).toMatchObject({
      revision: 2,
    })
    await rm(directory, { recursive: true })
    await expect(ledger.revision(id)).rejects.toThrow()
  })
})

async function settingsClient(
  f: Awaited<ReturnType<typeof fixture>>,
  read: () => Promise<unknown>,
) {
  const bridge = await servePersonPluginControl({
    root: f.root,
    key: 'e'.repeat(64),
    controller: f.controller,
    read,
  })
  closers.push(() => bridge.close())
  const client = await connectPluginSettings({
    path: bridge.path,
    personKey: 'e'.repeat(64),
    root: f.root,
    target: f.opts.target,
    catalogue: f.opts.catalogue,
    projection: projection().sink,
    propose: () => {},
  })
  closers.push(() => client.close())
  return client
}

describe.skipIf(process.platform === 'win32')(
  'native Chrome configuration route continuity',
  () => {
    it('keeps the preceding Open route 202 and applies its generic command without replay', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const active = f.state.exportActivation().entries[0]!
      const preceding = await chromeAdminRouteFixture(f.parent)
      await preceding.request('/profiles/birch/open', { method: 'POST', body: '{}' })
      expect(preceding.statuses).toEqual([202])
      const route = await chromeAdminRouteFixture(f.parent)
      const fetch = vi.fn(route.request)
      vi.stubGlobal('fetch', fetch)
      const input = {
        pluginId: 'chrome',
        installId: active.installId,
        incarnation: active.incarnation,
        revision: 0,
        proposal: { action: 'open-window', profile: 'birch' },
      }
      const succeeded = await f.controller.applyProfile(f.handle, input).then(
        () => true,
        () => false,
      )
      expect(route.statuses).toEqual([200])
      expect(succeeded).toBe(true)
      expect(route.launches).toEqual([{ profile: 'birch', mode: 'visible' }])
      expect(route.snapshot()).toMatchObject({ name: 'birch', open: true, mode: 'visible' })
      expect(await f.controller.profileRevision(f.handle, 'chrome', active.installId)).toBe(1)
      const reopened = await reopenLifecycleFixture(f)
      expect(await new PluginProfileLedger(f.root).revision(active.installId)).toBe(1)
      expect(reopened.exportActivation().entries[0]?.installId).toBe(active.installId)
      await expect(new PluginProfileLedger(f.root).reserve(active.installId, 0)).rejects.toThrow()
      expect(fetch).toHaveBeenCalledOnce()
      expect(route.launches).toHaveLength(1)
    })
    it('refreshes after real Settings enable/disable Apply without mistaking a committed change for unavailability', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const route = await chromeAdminRouteFixture(f.parent)
      vi.stubGlobal('fetch', route.request)
      const client = await settingsClient(f, async () => ({
        profiles: [route.snapshot()],
        tabs: [],
      }))
      const screen = await client.screen('chrome')
      let time = 0,
        request = 0
      const rpc = new PluginUiRpc({
        binding: screen.binding,
        schemas: chromeUiFixture().verified.manifest.ui!.methodSchemas,
        peer: screen.peer,
        current: () => screen.current(screen.binding),
        emit: () => {},
        propose: screen.propose,
        now: () => time,
      })
      closers.push(async () => rpc.close())
      const invoke = (method: string, payload: unknown, revision: number) =>
        rpc.invoke({
          channel: PLUGIN_UI_CHANNEL,
          requestId: String(++request),
          method,
          payload,
          configRevision: revision,
        })
      await invoke('read', { surface: 'chrome' }, 0)
      for (const [index, enabled] of [false, true].entries()) {
        await invoke('proposeConfig', { action: 'set-enabled', profile: 'birch', enabled }, index)
        expect(route.snapshot().enabled).toBe(enabled)
        expect(route.statuses).toEqual(Array(index + 1).fill(200))
        const refreshed = invoke('read', { surface: 'chrome' }, index).then(
          (value) => ({ ok: true, value }),
          () => ({ ok: false, value: null }),
        )
        const timer = setTimeout(() => {
          time += 1000
        }, 50)
        try {
          expect(await refreshed).toMatchObject({
            ok: true,
            value: {
              configRevision: index + 1,
              profiles: [{ name: 'birch', enabled }],
            },
          })
        } finally {
          clearTimeout(timer)
        }
      }
      const install = f.state.exportActivation().entries[0]!
      expect(await f.controller.profileRevision(f.handle, 'chrome', install.installId)).toBe(2)
    })
  },
)
