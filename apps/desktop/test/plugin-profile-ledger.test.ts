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

afterEach(async () => {
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
  await expect(readPluginConfiguration(endpoint, new AbortController().signal)).rejects.toThrow('Package snapshot failed.')
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
