import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture, catalogueBytes } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { disclosureTree } from './plugin-disclosure-fixtures'
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

async function setup(installed: boolean) {
  const f = await fixture()
  function modern(version: string) {
    const pkg = packageFixture({
      manifest: {
        ...f.pkg.manifest,
        format: 2,
        authors: ['fern-makers'],
        version,
        executor: { kind: 'node', entry: f.pkg.manifest.server!.entry },
        hooks: [],
      },
    })
    const release = { ...pkg.release, authors: ['fern-makers'] }
    return { ...pkg, release, ...catalogueBytes({ format: 2, entries: [release] }) }
  }
  const first = modern('1.0.1'),
    next = modern('1.0.2')
  let offer = first
  const options = {
    ...f.opts,
    catalogue: { bytes: first.bytes },
    download: vi.fn(async () => offer.archive),
    refreshCatalogue: async () => ({
      catalogue: { bytes: offer.bytes },
      names: f.opts.names,
    }),
  }
  if (installed) {
    const seed = await PluginLifecycleController.open(options)
    const handle = await seed.attach(projection().sink)
    const prepared = await seed.prepareMutation(
      handle,
      'install',
      'chrome',
      first.release.archive.sha256,
      pluginSha256(first.bytes),
    )
    await seed.installPrepared(handle, 'chrome', prepared)
    const seeded = f.state.inspect()
    expect(seeded.pending).toBeNull()
    expect(seeded.guards).toHaveLength(1)
    expect(seeded.guards[0]?.release.archiveSha256).toBe(first.release.archive.sha256)
    expect(seeded.guards[0]?.release.version).toBe(first.release.version)
  }
  offer = next
  options.catalogue = { bytes: next.bytes }
  const controller = await PluginLifecycleController.open(options),
    key = randomBytes(32).toString('hex')
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller: sharedLifecycleWorkspaces(controller),
    read: async () => null,
  })
  closers.push(() => bridge.close())
  async function connect() {
    const c = await connectPluginSettings({
      root: f.root,
      path: bridge.path,
      personKey: key,
      catalogue: options.catalogue,
      target: f.opts.target,
      projection: projection().sink,
      propose() {},
    })
    closers.push(() => c.close())
    return c
  }
  const snapshot = async () => ({
    state: structuredClone(f.state.inspect()),
    tree: await disclosureTree(f.root),
    events: [...f.events],
    starts: f.starts(),
    downloads: options.download.mock.calls.length,
  })
  return { f, next, controller, connect, snapshot, digest: pluginSha256(next.bytes) }
}
it.each(['install', 'update'] as const)(
  'real client and real prepared owner complete %s with the exact disclosure proof',
  async (action) => {
    const f = await setup(action === 'update'),
      c = await f.connect()
    const consent = await c.prepareMutation!(action, 'chrome')
    await c[action]!('chrome', consent)
    expect((await c.catalogue())[0]).toMatchObject({ installed: true, installedVersion: '1.0.2' })
  },
)
it.each(['install', 'update'] as const)(
  'real owner refuses forged and cross-session %s proofs without effects',
  async (action) => {
    const f = await setup(action === 'update'),
      a = await f.connect(),
      b = await f.connect()
    const original = PersonChannel.prototype.call,
      proofA = await a.prepareMutation!(action, 'chrome')
    for (const forged of [randomUUID(), proofA.preparation]) {
      const proofB = await b.prepareMutation!(action, 'chrome'),
        before = await f.snapshot()
      const spy = vi.spyOn(PersonChannel.prototype, 'call').mockImplementation(function (
        this: PersonChannel,
        input: unknown,
      ) {
        const value = input as Record<string, unknown>
        return original.call(
          this,
          value.kind === action + '-prepared' ? { ...value, preparation: forged } : input,
        )
      })
      await expect(b[action]!('chrome', proofB)).rejects.toMatchObject({ code: 'policy-refused' })
      expect(await f.snapshot()).toEqual(before)
      spy.mockRestore()
      await expect(b[action]!('chrome', proofB)).rejects.toMatchObject({ code: 'policy-refused' })
      expect(await f.snapshot()).toEqual(before)
    }
    await a[action]!('chrome', proofA)
    expect((await a.catalogue())[0]).toMatchObject({ installedVersion: '1.0.2' })
  },
)
it.each(['install', 'update'] as const)(
  'same-byte owner refresh refuses stale %s once, then fresh review succeeds',
  async (action) => {
    const f = await setup(action === 'update'),
      c = await f.connect(),
      proof = await c.prepareMutation!(action, 'chrome')
    await f.controller.refreshCatalogue(f.digest)
    const before = await f.snapshot(),
      wire = vi.spyOn(PersonChannel.prototype, 'call')
    await expect(c[action]!('chrome', proof)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(await f.snapshot()).toEqual(before)
    await expect(c[action]!('chrome', proof)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(
      wire.mock.calls.filter(
        ([input]) => (input as { kind?: string }).kind === action + '-prepared',
      ),
    ).toHaveLength(1)
    expect(await f.snapshot()).toEqual(before)
    const fresh = await c.prepareMutation!(action, 'chrome')
    await c[action]!('chrome', fresh)
    expect((await c.catalogue())[0]).toMatchObject({ installedVersion: '1.0.2' })
  },
)
