import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import {
  connectPersonPluginControl,
  servePersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { pluginPersonCapability } from '../src/main/plugins/catalogue/capability'
import { PLUGIN_LIST_URL } from '../src/main/plugins/catalogue/download'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import type { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import {
  productionPluginController as oldProduction,
} from './fixtures/plugin-update-parent/production'
import {
  connectPluginSettings as oldClient,
} from './fixtures/plugin-update-parent/lifecycle-settings-client'
import { cleanupLifecycleFixtures, fixture, projection } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'

vi.mock('../src/main/plugins/supervisor/launcher', () => ({
  createPluginSupervisorLauncher: () => async () => {
    throw new Error('No supervisor launch in the fictional discovery harness')
  },
}))
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

async function setup() {
  const f = await fixture({}, false, 'whatsapp')
  const chrome = packageFixture({ manifest: { ...f.pkg.manifest, id: 'chrome' } })
  const extra = packageFixture({ manifest: { ...f.pkg.manifest, id: 'fictional-maps' } })
  const original = repoListFor(f.pkg.release, 'Fictional messages')
  const expanded = {
    format: 1,
    entries: [
      ...original.entries,
      ...repoListFor(chrome.release, 'Fictional browser').entries,
      ...repoListFor(extra.release, 'Fictional maps').entries.map((one) => ({
        ...one,
        minAppVersion: '99.0.0',
      })),
    ],
  }
  const parse = (input: unknown, version = '0.0.0') =>
    parseRepoPluginList(Buffer.from(JSON.stringify(input)), f.opts.target, version)
  const one = parse(original),
    two = parse(expanded),
    three = parse(expanded, '99.0.0')
  let source = two
  const controller = await PluginLifecycleController.open({
    ...f.opts,
    pinnedPublicKey: null,
    repoCatalogueSha256: one.sha256,
    catalogue: { bytes: one.bytes, signature: Buffer.alloc(0) },
    names: { whatsapp: 'Fictional messages', chrome: 'Fictional browser' },
    refreshCatalogue: async () => ({
      catalogue: { bytes: source.bytes, signature: Buffer.alloc(0) },
      repoCatalogueSha256: source.sha256,
      names: {
        whatsapp: 'Fictional messages',
        chrome: 'Fictional browser',
        'fictional-maps': 'Fictional maps',
      },
    }),
  })
  const handle = await controller.attach(projection().sink)
  await controller.install(handle, 'whatsapp')
  await controller.refreshCatalogue(two.sha256)
  const key = await pluginPersonCapability(f.root)
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller,
    read: async () => ({}),
  })
  closers.push(() => bridge.close())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url)).toBe(PLUGIN_LIST_URL)
      return Response.json(expanded)
    }),
  )
  const clientOptions = (catalogue = three) => ({
    path: bridge.path,
    personKey: key,
    root: f.root,
    pinnedPublicKey: null,
    repoCatalogueSha256: catalogue.sha256,
    target: f.opts.target,
    catalogue: { bytes: catalogue.bytes, signature: Buffer.alloc(0) },
    projection: projection().sink,
    propose: () => {},
  })
  const facade = () => {
    const client = oldProduction()
    closers.push(() => client.close())
    client.start({
      root: f.root,
      workspaceRoot: f.workspace,
      resourcesRoot: join(f.parent, 'fictional-resources'),
      build: 'fictional-old-build',
      appVersion: '0.0.0',
      target: f.opts.target,
      supervisor: {
        start: vi.fn(),
        ready: async () => true,
        holdsLease: () => true,
        stoppedCleanly: () => false,
      } as unknown as PluginSupervisorAttachment,
    })
    return client
  }
  return {
    ...f,
    bridge,
    controller,
    key,
    one,
    two,
    three,
    facade,
    clientOptions,
    expand: async () => {
      source = three
      await controller.refreshCatalogue(three.sha256)
    },
  }
}

describe.skipIf(process.platform === 'win32')('pinned production discovery', () => {
  it('keeps old listing and Configure after a higher-minimum ID is admitted', async () => {
    const f = await setup()
    await f.expand()
    const legacy = f.facade()
    await legacy.ready!()
    expect(await legacy.catalogue()).toMatchObject([
      { id: 'chrome', state: 'Available' },
      { id: 'whatsapp', state: 'Running' },
    ])
    const screen = await legacy.screen('whatsapp')
    expect(screen.verified.manifest.id).toBe('whatsapp')
    expect(screen.current(screen.binding)).toBe(true)
    const modern = await connectPluginSettings(f.clientOptions())
    closers.push(() => modern.close())
    expect((await modern.catalogue()).map((one) => one.id)).toEqual([
      'chrome',
      'fictional-maps',
      'whatsapp',
    ])
    await f.expand()
    expect((await legacy.catalogue()).map((one) => one.id)).toEqual(['chrome', 'whatsapp'])
    await legacy.close()
    const reattached = f.facade()
    await reattached.ready!()
    expect((await reattached.catalogue()).map((one) => one.id)).toEqual(['chrome', 'whatsapp'])
  })

  it('retains different admitted ID sets for two legacy clients across owner refresh', async () => {
    const f = await setup()
    const original = await oldClient(f.clientOptions(f.one))
    closers.push(() => original.close())
    const newer = await oldClient(f.clientOptions(f.two))
    closers.push(() => newer.close())
    await f.expand()
    expect((await original.catalogue()).map((one) => one.id)).toEqual(['whatsapp'])
    expect((await newer.catalogue()).map((one) => one.id)).toEqual(['chrome', 'whatsapp'])
    await original.close()
    const again = await oldClient(f.clientOptions(f.one))
    closers.push(() => again.close())
    expect((await again.catalogue()).map((one) => one.id)).toEqual(['whatsapp'])
  })

  it('does not send a newly admitted ID in reverse notices to a legacy consumer', async () => {
    const f = await setup()
    const attached = vi.spyOn(f.controller, 'attach')
    const receiver = projection()
    const applied = vi.spyOn(receiver.sink, 'applied')
    const reconcile = vi.spyOn(receiver.sink, 'reconcile')
    const revoke = vi.spyOn(receiver.sink, 'revoke')
    const legacy = await oldClient({ ...f.clientOptions(f.one), projection: receiver.sink })
    closers.push(() => legacy.close())
    const sink = attached.mock.calls[0]![0]
    applied.mockClear()
    reconcile.mockClear()
    revoke.mockClear()
    await sink.applied('fictional-maps', null)
    await sink.reconcile({ pluginId: 'fictional-maps', before: null, receipt: null })
    expect(await sink.revoke('fictional-maps', randomUUID())).toBe(true)
    expect(applied).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('refuses unknown legacy provenance without breaking another admitted client', async () => {
    const f = await setup()
    const bytes = Buffer.from(
      JSON.stringify({ format: 1, entries: [...f.three.releases].reverse() }),
    )
    const candidate = await oldClient(
      f.clientOptions({ ...f.three, bytes, sha256: pluginSha256(bytes) }),
    ).then(
      (client) => client,
      () => undefined,
    )
    if (candidate) closers.push(() => candidate.close())
    expect(candidate).toBeUndefined()
    const admitted = await oldClient(f.clientOptions(f.two))
    closers.push(() => admitted.close())
    expect((await admitted.catalogue()).map((one) => one.id)).toEqual(['chrome', 'whatsapp'])
  })

  it('refuses missing legacy provenance while modern discovery stays available', async () => {
    const f = await setup()
    const channel = await connectPersonPluginControl({
      path: f.bridge.path,
      key: f.key,
      handle: async () => true,
    })
    try {
      await channel.call({ kind: 'attach', workspaceId: projection().sink.workspaceId })
      await expect(channel.call({ kind: 'list' })).rejects.toThrow()
      expect(await channel.call({ kind: 'list-v2' })).toHaveLength(2)
    } finally {
      channel.close()
    }
  })
})
