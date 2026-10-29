import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { PluginLifecycleController as AuthorsController } from './fixtures/plugin-disclosure-mixed/authors-controller'
import { servePersonPluginControl as authorsServer } from './fixtures/plugin-disclosure-mixed/authors-person-control'
import frozenSources from './fixtures/plugin-disclosure-mixed/source.json'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { preparedPeer } from './plugin-prepared-peer-fixtures'
import * as policy from '../src/shared/plugin-settings'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
function modern(f: Awaited<ReturnType<typeof fixture>>, version = '1.0.2') {
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
type Client = Awaited<ReturnType<typeof connectPluginSettings>> & {
  refreshCatalogue(
    digest: string,
    source?: { bytes: Uint8Array; signature: Uint8Array },
  ): Promise<void>
  mutationStatus(): 'source-mismatch' | 'owner-incompatible' | null
  prepareMutation(
    action: 'install' | 'update',
    id: string,
  ): Promise<{ releaseDigest: string; preparation: string }>
}
async function client(
  f: Awaited<ReturnType<typeof fixture>>,
  peer: { path: string; key: string },
  pkg: ReturnType<typeof modern> | typeof f.pkg,
) {
  const c = (await connectPluginSettings({
    path: peer.path,
    personKey: peer.key,
    root: f.root,
    pinnedPublicKey: f.opts.pinnedPublicKey,
    target: f.opts.target,
    catalogue: { bytes: pkg.bytes, signature: pkg.signature },
    projection: projection().sink,
    propose() {},
  })) as Client
  closers.push(() => c.close())
  return c
}
async function oldOwner(installed: boolean, localVersion = 2) {
  const f = await fixture(),
    first = modern(f, '1.0.1'),
    next = modern(f)
  let offered = first
  const options = {
    ...f.opts,
    catalogue: { bytes: first.bytes, signature: first.signature },
    download: vi.fn(async () => offered.archive),
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
  offered = next
  const controller = await AuthorsController.open({
    ...options,
    catalogue: { bytes: next.bytes, signature: next.signature },
  })
  const key = randomBytes(32).toString('hex'),
    peer = await authorsServer({ root: f.root, key, controller, read: async () => null })
  closers.push(() => peer.close())
  const c = await client(f, { ...peer, key }, localVersion === 2 ? next : f.pkg)
  const footprint = () => ({
    state: structuredClone(f.state.inspect()),
    starts: f.starts(),
    events: [...f.events],
    downloads: options.download.mock.calls.length,
  })
  return { f, c, controller, footprint }
}
async function future(installed = false, localVersion = 2, digest?: string) {
  const f = await fixture(),
    pkg = modern(f),
    proof = localVersion === 2 ? pkg : f.pkg
  const peer = await preparedPeer(f.root, digest ?? pluginSha256(pkg.bytes), installed)
  closers.push(() => peer.close())
  const c = await client(f, peer, proof)
  return { f, c, peer, pkg }
}
async function mutate(c: Client, action: 'install' | 'update', binding?: unknown) {
  return (c[action] as (id: string, consent?: unknown) => Promise<void>)('chrome', binding)
}
function allowed(card: unknown, action: 'install' | 'update') {
  const check = Reflect.get(policy, 'pluginMutationAllowed') as
    ((card: unknown, action: string) => boolean) | undefined
  return check ? check(card, action) : true
}

describe('new client mutation admission', () => {
  it.each(['install', 'update'] as const)(
    'never sends raw %s to an authors-only owner and keeps management',
    async (action) => {
      const { f, c, footprint } = await oldOwner(action === 'update')
      const wire = vi.spyOn(PersonChannel.prototype, 'call'),
        before = footprint()
      await expect(mutate(c, action)).rejects.toThrow()
      expect(
        wire.mock.calls.filter(([request]) => (request as { kind?: string }).kind === action),
      ).toHaveLength(0)
      expect(footprint()).toEqual(before)
      const card = (await c.catalogue())[0]
      expect(card).toMatchObject({
        mutationBlocked: 'owner-incompatible',
        preparationRequired: true,
      })
      expect(allowed(card, action)).toBe(false)
      if (action === 'update') {
        await c.screen('chrome')
        await c.uninstall('chrome')
        expect(f.state.exportActivation().entries).toHaveLength(0)
      }
    },
  )
  it.each(['install', 'update'] as const)(
    'a v1 client refuses held authors-only owner %s before dispatch and keeps management',
    async (action) => {
      const { c, f, footprint } = await oldOwner(action === 'update', 1)
      const wire = vi.spyOn(PersonChannel.prototype, 'call'),
        before = footprint()
      expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'owner-incompatible' })
      await expect(mutate(c, action)).rejects.toThrow()
      expect(
        wire.mock.calls.filter(([value]) => (value as { kind?: string }).kind === action),
      ).toHaveLength(0)
      expect(footprint()).toEqual(before)
      if (action === 'update') {
        await c.screen('chrome')
        await c.uninstall('chrome')
        expect(f.state.exportActivation().entries).toHaveLength(0)
      }
    },
  )
  it.each(['install', 'update'] as const)(
    'requires exact source and explicit consent for prepared %s',
    async (action) => {
      const { c, peer, pkg } = await future(action === 'update')
      await expect(mutate(c, action)).rejects.toThrow()
      const consent = await c.prepareMutation(action, 'chrome')
      expect(consent).toMatchObject({
        releaseDigest: pkg.release.archive.sha256,
        preparation: expect.stringMatching(/^[a-f0-9-]{36}$/),
      })
      await mutate(c, action, consent)
      expect(peer.calls.filter((call) => call.kind === action + '-prepared')).toHaveLength(1)
      expect(peer.calls.filter((call) => call.kind === action)).toHaveLength(0)
      await expect(mutate(c, action, consent)).rejects.toThrow()
      expect(peer.calls.filter((call) => call.kind === action + '-prepared')).toHaveLength(1)
    },
  )
  it.each(['install', 'update'] as const)(
    'rejects a forged displayed binding for %s without dispatch',
    async (action) => {
      const { c, peer } = await future(action === 'update'),
        consent = await c.prepareMutation(action, 'chrome')
      await expect(mutate(c, action, { ...consent, preparation: randomUUID() })).rejects.toThrow()
      const fresh = await c.prepareMutation(action, 'chrome')
      await expect(mutate(c, action, { ...fresh, releaseDigest: '0'.repeat(64) })).rejects.toThrow()
      expect(peer.calls.filter((call) => call.kind === action + '-prepared')).toHaveLength(0)
    },
  )
  it.each(['install', 'update'] as const)(
    'blocks %s before dispatch when the live owner source changes',
    async (action) => {
      const { c, peer } = await future(action === 'update'),
        consent = await c.prepareMutation(action, 'chrome')
      peer.changeSource('0'.repeat(64))
      await expect(mutate(c, action, consent)).rejects.toMatchObject({ code: 'source-mismatch' })
      expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'source-mismatch' })
      expect(peer.calls.filter((call) => call.kind === action + '-prepared')).toHaveLength(0)
      await c.uninstall('chrome')
      expect(peer.calls.filter((call) => call.kind === 'uninstall')).toHaveLength(1)
    },
  )
  it('blocks a locally admitted v1 client when the owner advertises v2 prepared policy', async () => {
    const { c, peer } = await future(false, 1)
    expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'source-mismatch' })
    await expect(mutate(c, 'install')).rejects.toThrow()
    await expect(mutate(c, 'update')).rejects.toThrow()
    expect(
      peer.calls.filter((call) => ['install', 'update'].includes(String(call.kind))),
    ).toHaveLength(0)
  })
  it('disables old prepared cards when policy capability is withdrawn', async () => {
    const { c, peer } = await future(),
      consent = await c.prepareMutation('install', 'chrome')
    peer.setFeatures(['contributions-v1', 'authors-v1'])
    expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'owner-incompatible' })
    await expect(mutate(c, 'install', consent)).rejects.toThrow()
    expect(peer.calls.filter((call) => call.kind === 'install-prepared')).toHaveLength(0)
  })
  it('does not revive displayed consent when owner capabilities return', async () => {
    const { c, peer } = await future(),
      consent = await c.prepareMutation('install', 'chrome')
    peer.setFeatures(['contributions-v1', 'authors-v1'])
    expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'owner-incompatible' })
    peer.setFeatures(['contributions-v1', 'authors-v1', 'prepared-mutations-v1'])
    await expect(mutate(c, 'install', consent)).rejects.toThrow()
    expect(peer.calls.filter((call) => call.kind === 'install-prepared')).toHaveLength(0)
    const fresh = await c.prepareMutation('install', 'chrome')
    await mutate(c, 'install', fresh)
    expect(peer.calls.filter((call) => call.kind === 'install-prepared')).toHaveLength(1)
  })
  it('retains no consent when the client closes', async () => {
    const { c, peer } = await future(),
      consent = await c.prepareMutation('install', 'chrome')
    await c.close()
    await expect(mutate(c, 'install', consent)).rejects.toThrow()
    expect(peer.calls.filter((call) => call.kind === 'install-prepared')).toHaveLength(0)
    closers.pop()
  })
  it('keeps legacy admission while withholding versioned actions until disclosure is ready', () => {
    const legacy = { id: 'chrome', name: 'Fictional browser', installed: false, state: 'Available' }
    expect(allowed(legacy, 'install')).toBe(true)
    expect(allowed({ ...legacy, preparationRequired: true }, 'install')).toBe(false)
    expect(
      allowed(
        { ...legacy, installed: true, updateVersion: '1.0.2', preparationRequired: true },
        'update',
      ),
    ).toBe(false)
    expect(allowed({ ...legacy, mutationBlocked: 'source-mismatch' }, 'install')).toBe(false)
  })
  it('keeps the historical authors-only sources byte-exact apart from imports', async () => {
    for (const pin of frozenSources) {
      const adapted = await readFile(
        new URL('./fixtures/plugin-disclosure-mixed/' + pin.file, import.meta.url),
        'utf8',
      )
      const original = adapted.replace(
        /from '(\.[^']+)'/g,
        (_, path: string) => "from '" + (pin.imports as Record<string, string>)[path] + "'",
      )
      expect(createHash('sha256').update(original).digest('hex')).toBe(pin.sourceSha256)
    }
  })
})

it('does not reuse consent after reconnecting to the same owner', async () => {
  const { f, c, peer, pkg } = await future()
  const consent = await c.prepareMutation('install', 'chrome')
  await c.close()
  closers.pop()
  const reconnected = await client(f, peer, pkg)
  await expect(mutate(reconnected, 'install', consent)).rejects.toThrow()
  expect(peer.calls.filter((call) => call.kind === 'install-prepared')).toHaveLength(0)
})
it('clears consent on a client refresh even when the admitted bytes are unchanged', async () => {
  const { c, peer, pkg } = await future(),
    consent = await c.prepareMutation('install', 'chrome')
  peer.offer(pluginSha256(pkg.bytes))
  await c.refreshCatalogue(pluginSha256(pkg.bytes), { bytes: pkg.bytes, signature: pkg.signature })
  await expect(mutate(c, 'install', consent)).rejects.toThrow()
  expect(peer.calls.filter((call) => call.kind === 'install-prepared')).toHaveLength(0)
})
it('serializes overlapping catalogue refreshes without invalidating either admission', async () => {
  const { c, peer, pkg } = await future()
  const digest = pluginSha256(pkg.bytes)
  const source = { bytes: pkg.bytes, signature: pkg.signature }
  await expect(
    Promise.all([c.refreshCatalogue(digest, source), c.refreshCatalogue(digest, source)]),
  ).resolves.toEqual([undefined, undefined])
  expect(peer.calls.filter((call) => call.kind === 'refresh')).toHaveLength(2)
  expect(c.mutationStatus()).toBeNull()
  await expect(c.prepareMutation('install', 'chrome')).resolves.toMatchObject({
    releaseDigest: expect.any(String),
  })
})
it('allows a queued valid refresh after a failed source check', async () => {
  const { c, pkg } = await future()
  const digest = pluginSha256(pkg.bytes)
  const source = { bytes: pkg.bytes, signature: pkg.signature }
  const failed = c.refreshCatalogue('0'.repeat(64), source)
  const next = c.refreshCatalogue(digest, source)
  await expect(failed).rejects.toThrow()
  await expect(next).resolves.toBeUndefined()
  expect(c.mutationStatus()).toBeNull()
})
it('refuses a queued refresh when the client closes before it begins', async () => {
  const { c, peer, pkg } = await future()
  const digest = pluginSha256(pkg.bytes)
  const source = { bytes: pkg.bytes, signature: pkg.signature }
  const gate = peer.pauseFeatures()
  const first = c.refreshCatalogue(digest, source)
  const second = c.refreshCatalogue(digest, source)
  const settled = Promise.allSettled([first, second])
  await gate.entered.promise
  try {
    await c.close()
    closers.pop()
  } finally {
    gate.release.resolve()
  }
  expect((await settled).map((one) => one.status)).toEqual(['rejected', 'rejected'])
  expect(peer.calls.filter((call) => call.kind === 'refresh')).toHaveLength(1)
})
it('drops a waiting legacy command during v2 admission and never resends it as prepared', async () => {
  const f = await fixture(),
    pkg = modern(f),
    peer = await preparedPeer(f.root, pluginSha256(f.pkg.bytes))
  closers.push(() => peer.close())
  peer.setFeatures(['contributions-v1'])
  const c = await client(f, peer, f.pkg),
    gate = peer.pauseFeatures()
  const work = mutate(c, 'install')
  const entered = await Promise.race([
    gate.entered.promise.then(() => true),
    work.then(
      () => false,
      () => false,
    ),
  ])
  try {
    expect(entered).toBe(true)
    peer.offer(pluginSha256(pkg.bytes))
    peer.setFeatures(['contributions-v1', 'authors-v1', 'prepared-mutations-v1'])
    await c.refreshCatalogue(pluginSha256(pkg.bytes), {
      bytes: pkg.bytes,
      signature: pkg.signature,
    })
  } finally {
    gate.release.resolve()
  }
  await expect(work).rejects.toThrow()
  expect(
    peer.calls.filter((call) => ['install', 'install-prepared'].includes(String(call.kind))),
  ).toHaveLength(0)
})

it.each(['install', 'update'] as const)(
  'a failed prepared %s consumes consent and is never retried automatically',
  async (action) => {
    const { c, peer } = await future(action === 'update'),
      consent = await c.prepareMutation(action, 'chrome')
    peer.refuseNextCommit()
    await expect(mutate(c, action, consent)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(peer.calls.filter((call) => call.kind === action + '-prepared')).toHaveLength(1)
    await expect(mutate(c, action, consent)).rejects.toThrow()
    expect(peer.calls.filter((call) => call.kind === action + '-prepared')).toHaveLength(1)
  },
)
it.each(['install', 'update'] as const)(
  'a different owner source blocks %s from initial negotiation',
  async (action) => {
    const { c, peer } = await future(action === 'update', 2, '0'.repeat(64))
    expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'source-mismatch' })
    await expect(mutate(c, action)).rejects.toMatchObject({ code: 'source-mismatch' })
    expect(
      peer.calls.filter((call) =>
        ['install', 'update', 'install-prepared', 'update-prepared'].includes(String(call.kind)),
      ),
    ).toHaveLength(0)
  },
)
it.each(['digest', 'shape'] as const)(
  'a refused %s source does not fall back to legacy mutation',
  async (kind) => {
    const f = await fixture(),
      peer = await preparedPeer(f.root, pluginSha256(f.pkg.bytes))
    closers.push(() => peer.close())
    peer.setFeatures(['contributions-v1'])
    const c = await client(f, peer, f.pkg),
      source = kind === 'digest' ? modern(f) : signed({ format: 2, entries: [{}] })
    const digest = kind === 'digest' ? '0'.repeat(64) : pluginSha256(source.bytes)
    await expect(
      c.refreshCatalogue(digest, { bytes: source.bytes, signature: source.signature }),
    ).rejects.toThrow()
    await expect(mutate(c, 'install')).rejects.toThrow()
    await expect(mutate(c, 'update')).rejects.toThrow()
    expect(
      peer.calls.filter((call) =>
        ['refresh', 'install', 'update', 'install-prepared', 'update-prepared'].includes(
          String(call.kind),
        ),
      ),
    ).toHaveLength(0)
  },
)
