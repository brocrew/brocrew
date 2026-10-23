import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  deferred,
} from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { PluginVerificationError } from '../src/main/plugins/verification-error'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import { pluginSha256 } from '../src/main/plugins/package-digests'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
function modern(f: Awaited<ReturnType<typeof fixture>>, version: string) {
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
  const release = {
    ...pkg.release,
    authors: ['fern-makers'],
    archive: {
      ...pkg.release.archive,
      url:
        'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' +
        version +
        '/fictional.tar',
    },
  }
  return { ...pkg, release, ...signed({ format: 2, entries: [release] }) }
}
async function setup(installed = false, legacyEntry = false, v1Owner = false) {
  const f = await fixture()
  const first = legacyEntry || v1Owner ? f.pkg : modern(f, '1.0.1')
  const next =
    legacyEntry || v1Owner
      ? packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.2' } })
      : modern(f, '1.0.2')
  let sourceVersion = v1Owner ? 1 : 2
  const catalogue = (p: typeof next) =>
    sourceVersion === 1
      ? { bytes: p.bytes, signature: p.signature }
      : legacyEntry
        ? signed({ format: 2, entries: [{ ...p.release, legacy: true }] })
        : { bytes: p.bytes, signature: p.signature }
  let offer = first
  const options = {
    ...f.opts,
    catalogue: catalogue(first),
    download: vi.fn(async () => offer.archive),
    refreshCatalogue: async () => ({ catalogue: catalogue(offer), names: f.opts.names }),
  }
  if (installed) {
    // Seed the prior installation through the portable API on every platform.
    // Frozen-writer compatibility is tested separately; this suite tests owner policy.
    const seed = await PluginLifecycleController.open({
      ...options,
      // Authorless historical releases are seeded from their original v1 source.
      catalogue: { bytes: first.bytes, signature: first.signature },
    })
    const handle = await seed.attach(projection().sink)
    if (first.release.authors) {
      const prepared = await seed.prepareMutation(
        handle,
        'install',
        'chrome',
        first.release.archive.sha256,
        pluginSha256(first.bytes),
      )
      await seed.installPrepared(handle, 'chrome', prepared)
    } else await seed.install(handle, 'chrome')
    const seeded = f.state.inspect()
    expect(seeded.pending).toBeNull()
    expect(seeded.guards).toHaveLength(1)
    expect(seeded.guards[0]?.release.archiveSha256).toBe(first.release.archive.sha256)
    expect(seeded.guards[0]?.release.version).toBe(first.release.version)
  }
  offer = next
  options.catalogue = catalogue(next)
  const controller = await PluginLifecycleController.open(options)
  // Exercise the same workspace-handle proxy the real owner uses.
  const key = randomBytes(32).toString('hex')
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller: sharedLifecycleWorkspaces(controller),
    read: async () => null,
  })
  closers.push(() => bridge.close())
  async function wire() {
    const channel = await connectPersonPluginControl({
      path: bridge.path,
      key,
      handle: async () => true,
    })
    closers.push(async () => channel.close())
    await channel.call({ kind: 'attach', workspaceId: randomUUID() })
    return channel
  }
  const digest = () => pluginSha256(catalogue(offer).bytes)
  async function negotiate(c: Awaited<ReturnType<typeof wire>>) {
    return c.call({ kind: 'mutation-policy', catalogueDigest: digest() })
  }
  async function prepare(c: Awaited<ReturnType<typeof wire>>, action: 'install' | 'update') {
    await negotiate(c)
    return (await c.call({
      kind: 'prepare-mutation',
      action,
      pluginId: 'chrome',
      releaseDigest: offer.release.archive.sha256,
    })) as { preparation: string }
  }
  function request(action: 'install' | 'update', proof: { preparation: string }) {
    return {
      kind: action + '-prepared',
      pluginId: 'chrome',
      operationId: randomUUID(),
      releaseDigest: offer.release.archive.sha256,
      preparation: proof.preparation,
    }
  }
  const snapshot = () => ({
    state: structuredClone(f.state.inspect()),
    events: [...f.events],
    downloads: options.download.mock.calls.length,
    starts: f.starts(),
  })
  return {
    ...f,
    controller,
    options,
    first,
    next,
    wire,
    digest,
    negotiate,
    prepare,
    request,
    snapshot,
    async refresh(changed = modern(f, '1.0.3')) {
      sourceVersion = 2
      offer = changed
      await controller.refreshCatalogue(digest())
    },
  }
}

describe('prepared mutations are an owner policy only for verified v2 sources', () => {
  it.each(['install', 'update'] as const)(
    'refuses raw %s before effects but keeps installed management',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        before = f.snapshot()
      await expect(
        c.call({ kind: action, pluginId: 'chrome', operationId: randomUUID() }),
      ).rejects.toThrow()
      expect(f.snapshot()).toEqual(before)
      expect(await c.call({ kind: 'list-v2' })).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'chrome' })]),
      )
      if (action === 'update') {
        expect(await c.call({ kind: 'screen', pluginId: 'chrome' })).toMatchObject({
          phase: 'active',
        })
        await expect(
          c.call({ kind: 'uninstall', pluginId: 'chrome', operationId: randomUUID() }),
        ).resolves.toBeTruthy()
      }
    },
  )
  it.each(['install', 'update'] as const)(
    'does not infer legacy mode from an authorless v2 %s row',
    async (action) => {
      const f = await setup(action === 'update', true),
        c = await f.wire(),
        before = f.snapshot()
      await expect(
        c.call({ kind: action, pluginId: 'chrome', operationId: randomUUID() }),
      ).rejects.toThrow()
      expect(f.snapshot()).toEqual(before)
    },
  )
  it.each(['install', 'update'] as const)(
    'commits verified prepared %s once, through the shared-workspace proxy',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        proof = await f.prepare(c, action)
      expect(proof.preparation).toMatch(/^[a-f0-9-]{36}$/)
      const request = f.request(action, proof)
      await c.call(request)
      expect(f.state.inspect().guards[0]?.release.version).toBe('1.0.2')
      const after = f.snapshot()
      await expect(c.call(request)).rejects.toMatchObject({ code: 'policy-refused' })
      expect(f.snapshot()).toEqual(after)
    },
  )
  it.each(['install', 'update'] as const)(
    'refuses another session or forged token for %s',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        other = await f.wire(),
        proof = await f.prepare(c, action)
      await f.negotiate(other)
      const before = f.snapshot()
      await expect(other.call(f.request(action, proof))).rejects.toMatchObject({
        code: 'policy-refused',
      })
      await expect(c.call(f.request(action, { preparation: randomUUID() }))).rejects.toMatchObject({
        code: 'policy-refused',
      })
      expect(f.snapshot()).toEqual(before)
    },
  )
  it.each(['install', 'update'] as const)(
    'consumes a failed %s consent and requires review again',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        proof = await f.prepare(c, action),
        before = f.snapshot()
      await expect(
        c.call({ ...f.request(action, proof), releaseDigest: '0'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'policy-refused' })
      await expect(c.call(f.request(action, proof))).rejects.toMatchObject({
        code: 'policy-refused',
      })
      expect(f.snapshot()).toEqual(before)
    },
  )
  it.each(['install', 'update'] as const)(
    'refuses a different source for %s before preparing or mutating',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        before = f.snapshot()
      await expect(
        c.call({ kind: 'mutation-policy', catalogueDigest: '0'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'source-mismatch' })
      await expect(
        c.call({
          kind: 'prepare-mutation',
          action,
          pluginId: 'chrome',
          releaseDigest: f.next.release.archive.sha256,
        }),
      ).rejects.toThrow()
      expect(f.snapshot()).toEqual(before)
    },
  )
  it.each(['install', 'update'] as const)(
    'revokes %s consent when catalogue or state changes',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        proof = await f.prepare(c, action)
      const request = f.request(action, proof)
      await f.refresh()
      const before = f.snapshot()
      await expect(c.call(request)).rejects.toMatchObject({
        code: 'source-mismatch',
      })
      expect(f.snapshot()).toEqual(before)
      const newProof = await f.prepare(c, action)
      f.state.requireUpdateReader()
      const changed = f.snapshot()
      await expect(c.call(f.request(action, newProof))).rejects.toMatchObject({
        code: 'policy-refused',
      })
      expect(f.snapshot()).toEqual(changed)
    },
  )
  it.each(['install', 'update'] as const)(
    'rechecks %s consent inside the fence before changing authority',
    async (action) => {
      const f = await setup(action === 'update'),
        c = await f.wire(),
        proof = await f.prepare(c, action)
      const entered = deferred<void>(),
        release = deferred<void>(),
        real = f.state.withExclusive.bind(f.state)
      let once = true
      vi.spyOn(f.state, 'withExclusive').mockImplementation(async (work) => {
        if (once) {
          once = false
          entered.resolve()
          await release.promise
        }
        return real(work)
      })
      const work = c.call(f.request(action, proof))
      await entered.promise
      f.state.requireUpdateReader()
      const before = f.snapshot()
      release.resolve()
      await expect(work).rejects.toMatchObject({ code: 'policy-refused' })
      expect(f.snapshot()).toEqual(before)
    },
  )
})

it.each(['install', 'update'] as const)(
  'revokes %s consent on renegotiation, replacement and expiry',
  async (action) => {
    const f = await setup(action === 'update'),
      c = await f.wire()
    const first = await f.prepare(c, action)
    await f.negotiate(c)
    const before = f.snapshot()
    await expect(c.call(f.request(action, first))).rejects.toMatchObject({ code: 'policy-refused' })
    expect(f.snapshot()).toEqual(before)
    const second = await f.prepare(c, action)
    const third = await f.prepare(c, action)
    await expect(c.call(f.request(action, second))).rejects.toMatchObject({
      code: 'policy-refused',
    })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_001)
    try {
      const expired = f.snapshot()
      await expect(c.call(f.request(action, third))).rejects.toMatchObject({
        code: 'policy-refused',
      })
      expect(f.snapshot()).toEqual(expired)
    } finally {
      clock.mockRestore()
    }
  },
)
it('does not turn a pre-reservation verification refusal into storage corruption', async () => {
  const f = await setup(),
    c = await f.wire()
  await f.negotiate(c)
  f.options.download.mockResolvedValue(Buffer.from('fictional altered archive'))
  const before = f.snapshot()
  await expect(
    c.call({
      kind: 'prepare-mutation',
      action: 'install',
      pluginId: 'chrome',
      releaseDigest: f.next.release.archive.sha256,
    }),
  ).rejects.toMatchObject({ code: 'policy-refused' })
  expect(f.state.inspect()).toEqual(before.state)
  expect(f.events).toEqual(before.events)
  expect(f.starts()).toBe(before.starts)
})
it.each(['install', 'update'] as const)(
  'keeps %s compensation or recovery after a recorded reservation',
  async (action) => {
    const f = await setup(action === 'update'),
      c = await f.wire(),
      proof = await f.prepare(c, action)
    f.options.fault = (stage) => {
      if (stage === 'prepared') throw new PluginVerificationError('digest')
    }
    const before = f.state.inspect()
    const result = await c.call(f.request(action, proof)).then(
      () => null,
      (error) => error as { code?: string },
    )
    expect(result).not.toBeNull()
    expect(result?.code).not.toBe('policy-refused')
    expect(result?.code).not.toBe('network')
    const after = f.state.inspect()
    expect(after.sequence).toBeGreaterThan(before.sequence)
    // Existing compensation may settle the pending operation; it must never be a clean policy refusal.
    expect(after.operations.length).toBeGreaterThanOrEqual(before.operations.length)
  },
)

it.each(['install', 'update'] as const)(
  'a v1-to-v2 refresh refuses an already waiting raw %s under the fence',
  async (action) => {
    const f = await setup(action === 'update', false, true),
      c = await f.wire()
    const entered = deferred<void>(),
      release = deferred<void>(),
      real = f.state.withExclusive.bind(f.state)
    let once = true
    vi.spyOn(f.state, 'withExclusive').mockImplementation(async (work) => {
      if (once) {
        once = false
        entered.resolve()
        await release.promise
      }
      return real(work)
    })
    const work = c.call({ kind: action, pluginId: 'chrome', operationId: randomUUID() })
    await entered.promise
    await f.refresh()
    const before = f.snapshot()
    release.resolve()
    await expect(work).rejects.toThrow()
    expect(f.snapshot()).toEqual(before)
  },
)
it('advertises prepared mutation support only after the owner admits a v2 source', async () => {
  const f = await setup(false, false, true),
    c = await f.wire()
  const before = (await c.call({ kind: 'features' })) as { features: string[] }
  expect(before.features).not.toContain('prepared-mutations-v1')
  await f.refresh()
  const after = (await c.call({ kind: 'features' })) as { features: string[] }
  expect(after.features).toContain('prepared-mutations-v1')
  for (const kind of ['install', 'update']) {
    const state = f.snapshot()
    await expect(c.call({ kind, pluginId: 'chrome', operationId: randomUUID() })).rejects.toThrow()
    expect(f.snapshot()).toEqual(state)
  }
})

it.each([
  { status: 503, code: 'network' },
  { status: 200, code: 'policy-refused' },
] as const)(
  'classifies the real bounded archive path at HTTP $status before any reservation',
  async ({ status, code }) => {
    const f = await setup(),
      c = await f.wire()
    await f.negotiate(c)
    Reflect.deleteProperty(f.options, 'download')
    const fetch = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe(f.next.release.archive.url)
      return new Response('fictional changed archive', { status })
    })
    vi.stubGlobal('fetch', fetch)
    const state = f.state.inspect(),
      events = [...f.events],
      starts = f.starts()
    await expect(
      c.call({
        kind: 'prepare-mutation',
        action: 'install',
        pluginId: 'chrome',
        releaseDigest: f.next.release.archive.sha256,
      }),
    ).rejects.toMatchObject({ code })
    expect(fetch).toHaveBeenCalledOnce()
    expect(f.state.inspect()).toEqual(state)
    expect(f.events).toEqual(events)
    expect(f.starts()).toBe(starts)
  },
)

it('keeps existing v1 incompatible failures unchanged before policy negotiation', async () => {
  const f = await setup(false, false, true),
    c = await f.wire()
  const cards = await c.call({ kind: 'list-v2' }),
    before = f.snapshot()
  // The legacy list path requires a legacy catalogue binding, unlike list-v2.
  await expect(c.call({ kind: 'list' })).rejects.toMatchObject({
    code: 'unavailable',
    message: 'Plugin unavailable. Try again.',
  })
  expect(await c.call({ kind: 'list-v2' })).toEqual(cards)
  expect(f.snapshot()).toEqual(before)
})

it('rechecks retained archive bytes against the currently admitted release metadata', async () => {
  const f = await setup(),
    c = await f.wire()
  const vault = new PluginPackageVault(f.root, f.opts.pinnedPublicKey, f.opts.target)
  await vault.stage(
    f.next.release,
    f.next.archive,
    { bytes: f.next.bytes, signature: f.next.signature },
    [],
  )
  const release = { ...f.next.release, authors: ['fern-makers'], sourceCommit: 'b'.repeat(40) }
  const changed = { ...f.next, release, ...signed({ format: 2, entries: [release] }) }
  await f.refresh(changed)
  await f.negotiate(c)
  const before = f.snapshot()
  await expect(
    c.call({
      kind: 'prepare-mutation',
      action: 'install',
      pluginId: 'chrome',
      releaseDigest: f.next.release.archive.sha256,
    }),
  ).rejects.toMatchObject({ code: 'policy-refused' })
  expect(f.state.inspect()).toEqual(before.state)
  expect(f.events).toEqual(before.events)
  expect(f.starts()).toBe(before.starts)
})
