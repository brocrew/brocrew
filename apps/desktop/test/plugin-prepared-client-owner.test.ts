import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { pluginSha256 } from '../src/main/plugins/package-digests'
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

async function diskTree(root: string, relative = ''): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const name of (await readdir(join(root, relative))).sort()) {
    const key = relative ? `${relative}/${name}` : name
    // Only these named transient locking files are outside the disk comparison.
    if (
      [
        'state/writer-lock.sqlite',
        'state/writer-lock.sqlite-wal',
        'state/writer-lock.sqlite-shm',
      ].includes(key)
    )
      continue
    const path = join(root, key)
    const stat = await lstat(path, { bigint: true })
    const metadata = {
      mode: Number(stat.mode & 0o777n),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
    }
    if (stat.isDirectory()) {
      result[key] = { ...metadata, kind: 'directory' }
      Object.assign(result, await diskTree(root, key))
    } else if (stat.isFile()) {
      result[key] = { ...metadata, kind: 'file', sha256: pluginSha256(await readFile(path)) }
    } else if (stat.isSymbolicLink()) {
      result[key] = { ...metadata, kind: 'link', target: await readlink(path) }
    } else result[key] = { ...metadata, kind: stat.isSocket() ? 'socket' : 'other' }
  }
  return result
}

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
    return { ...pkg, release, ...signed({ format: 2, entries: [release] }) }
  }
  const first = modern('1.0.1'),
    next = modern('1.0.2')
  let offer = first
  const options = {
    ...f.opts,
    catalogue: { bytes: first.bytes, signature: first.signature },
    download: vi.fn(async () => offer.archive),
    refreshCatalogue: async () => ({
      catalogue: { bytes: offer.bytes, signature: offer.signature },
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
  options.catalogue = { bytes: next.bytes, signature: next.signature }
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
      pinnedPublicKey: f.opts.pinnedPublicKey,
      target: f.opts.target,
      projection: projection().sink,
      propose() {},
    })
    closers.push(() => c.close())
    return c
  }
  const snapshot = async () => ({
    state: structuredClone(f.state.inspect()),
    tree: await diskTree(f.root),
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
