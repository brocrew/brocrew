import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { PluginCard } from '../src/shared/plugin-settings'
import type { LifecycleOptions } from '../src/main/plugins/lifecycle/types'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { cleanupLifecycleFixtures, deferred, fixture } from './plugin-lifecycle-fixtures'
import { signed, tar } from './plugin-package-fixtures'

const A = 'fictional-garden'
const B = 'fictional-moss'
const releases: Array<() => void> = []
const closers: Array<() => Promise<unknown>> = []
const pendingLoads: Promise<unknown>[] = []
type Fixture = Awaited<ReturnType<typeof fixture>>
type Load = PluginPackageVault['load']
type Descriptor = Parameters<Load>[0]

// Deadlines detect an accidentally awaited metadata read; they never release its gate.
async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  const failures: unknown[] = []
  try {
    await bounded(Promise.allSettled(pendingLoads.splice(0)), 'metadata fixture loads')
    for (const close of closers.splice(0).reverse()) {
      try {
        await bounded(Promise.resolve().then(close), 'metadata fixture close')
      } catch (error) {
        failures.push(error)
      }
    }
  } finally {
    vi.restoreAllMocks()
    await cleanupLifecycleFixtures()
  }
  if (failures.length) throw new AggregateError(failures, 'Metadata fixture cleanup failed')
})

function genericPackage(id: string, dataOnRemove: 'keep' | 'remove', version = '1.0.0') {
  const target = {
    os: process.platform as 'darwin' | 'linux' | 'win32',
    cpu: process.arch as 'arm64' | 'x64',
  }
  const files = new Map([
    ['main.cjs', Buffer.from('// Inert fictional metadata fixture; never executed.')],
    ['tools.json', Buffer.from('{"tools":[]}')],
  ])
  const manifest = {
    format: 3,
    id,
    name: id,
    version,
    description: 'Fictional garden metadata.',
    authors: ['Fictional Gardeners'],
    platforms: [target],
    permissions: { description: 'Describe fictional garden removal.' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime: { kind: 'node', entry: 'main.cjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove },
    data: { schema: 1 },
  }
  const bytes = Buffer.from(JSON.stringify(manifest))
  const archive = tar([
    { path: 'plugin.json', body: bytes },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  return {
    archive,
    target,
    dataOnRemove,
    release: {
      id,
      version,
      sourceCommit: 'f'.repeat(40),
      platforms: [target],
      archive: {
        url: `https://plugins.example.invalid/${id}-${version}.tar`,
        size: archive.length,
        sha256: pluginSha256(archive),
        compression: 'tar' as const,
      },
      manifestSha256: pluginSha256(bytes),
    },
  }
}
type Package = ReturnType<typeof genericPackage>

async function setup() {
  const a = genericPackage(A, 'keep')
  const b = genericPackage(B, 'remove')
  const catalogue = signed({ format: 1, entries: [a.release, b.release] })
  const start = vi.fn<LifecycleOptions['runtime']['start']>(async () => {
    const exited = deferred<void>()
    return {
      runId: randomUUID(),
      exited: exited.promise,
      stop: async () => exited.resolve(),
      ready: async () => ({
        serverPid: 404941,
        origin: 'http://127.0.0.1:1',
        mcp: () => ({ url: '', headers: { Authorization: '' } }),
        admin: () => ({ url: '', headers: { Authorization: '' } }),
      }),
    }
  })
  // Open/attach while empty, so later atomic fixture selections do not start processes.
  const f = await fixture({
    catalogue,
    names: { [A]: 'Garden', [B]: 'Moss' },
    runtime: { start, removeCode: async () => {}, previousOwnerClean: async () => true },
  })
  closers.push(() => f.controller.drain())
  const vault = new PluginPackageVault(f.root, f.opts.pinnedPublicKey, a.target)
  async function stage(pkg: Package) {
    const checked = await vault.stage(pkg.release, pkg.archive, catalogue, [])
    expect(checked.manifest.format).toBe(3)
    expect(checked.contract.lifecycle.dataOnRemove).toBe(pkg.dataOnRemove)
  }
  await stage(a)
  await stage(b)
  await select(f, a)
  await select(f, b)
  expect(f.state.inspect().pending).toBeNull()
  expect(start).not.toHaveBeenCalled()
  const changed: string[] = []
  const unsubscribe = f.controller.onHostChanged((workspaceId) => changed.push(workspaceId))
  closers.push(async () => unsubscribe())
  return { f, a, b, stage, changed, start }
}

async function select(f: Fixture, pkg: Package, action?: 'install' | 'update' | 'uninstall') {
  await f.state.withExclusive(async () => {
    const state = f.state.inspect()
    const before = state.guards.find((one) => one.pluginId === pkg.release.id)
    const operationId = randomUUID()
    const kind = action ?? (before?.phase === 'active' ? 'update' : 'install')
    f.state.prepare({
      operationId,
      snapshot: null,
      consent: {
        action: kind,
        pluginId: pkg.release.id,
        at: 1000,
        expectedSequence: state.sequence,
        expectedInstallId: before?.installId ?? null,
        release:
          kind === 'uninstall'
            ? null
            : {
                version: pkg.release.version,
                archiveSha256: pkg.release.archive.sha256,
                manifestSha256: pkg.release.manifestSha256,
                dataSchema: 1,
              },
      },
    })
    f.state.complete(operationId)
  })
}

function card(cards: PluginCard[], id: string) {
  const found = cards.find((one) => one.id === id)
  expect(found).toBeDefined()
  return found!
}
async function status(f: Fixture) {
  return bounded(f.controller.status(), 'status must not await optional metadata')
}

// Observe/hold the public vault method, then always delegate to its real disk verifier.
function watchLoads(before: (release: Descriptor) => Promise<void> = async () => {}) {
  const original = PluginPackageVault.prototype.load
  const calls: Descriptor[] = []
  const outcomes: Array<{ release: Descriptor; ok: boolean }> = []
  vi.spyOn(PluginPackageVault.prototype, 'load').mockImplementation(function (
    this: PluginPackageVault,
    ...args: Parameters<Load>
  ) {
    calls.push(args[0])
    const work = (async () => {
      try {
        await before(args[0])
        const result = await original.apply(this, args)
        outcomes.push({ release: args[0], ok: true })
        return result
      } catch (error) {
        outcomes.push({ release: args[0], ok: false })
        throw error
      }
    })()
    // Catch immediately for cleanup tracking, independent of controller rejection handling.
    pendingLoads.push(work.catch(() => undefined))
    return work
  })
  return { calls, outcomes, bCalls: () => calls.filter((one) => one.id === B) }
}
function gate() {
  const entered = deferred<Descriptor>()
  const release = deferred<void>()
  let held = false
  releases.push(() => release.resolve())
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    held: () => held,
    async wait(descriptor: Descriptor) {
      held = true
      entered.resolve(descriptor)
      await release.promise
      held = false
    },
  }
}
async function known(f: Fixture, id: string, value: boolean) {
  await bounded(
    vi.waitFor(
      async () => {
        expect(card((await status(f)).cards, id).uninstallDeletesData).toBe(value)
      },
      { timeout: 2000, interval: 10 },
    ),
    `verified ${id} metadata publication`,
  )
}

it('returns committed cards and independent A metadata while B actual vault read is held, deduplicating B', async () => {
  const h = await setup()
  const a = gate(),
    b = gate()
  const loads = watchLoads(async (release) => {
    if (release.id === A) await a.wait(release)
    if (release.id === B) await b.wait(release)
  })
  const initial = await status(h.f)
  expect(card(initial.cards, A).uninstallDeletesData).toBeUndefined()
  expect(card(initial.cards, B).uninstallDeletesData).toBeUndefined()
  // Both entries must be reached before either read is released: serial background work fails.
  const [enteredA, enteredB] = await bounded(
    Promise.all([a.entered, b.entered]),
    'independent A and B actual vault loaders entered with both reads held',
  )
  expect(enteredA).toMatchObject({
    id: A,
    archive: { sha256: h.a.release.archive.sha256 },
    manifestSha256: h.a.release.manifestSha256,
  })
  expect(enteredB).toMatchObject({
    id: B,
    version: '1.0.0',
    archive: { sha256: h.b.release.archive.sha256 },
    manifestSha256: h.b.release.manifestSha256,
  })
  expect(a.held()).toBe(true)
  expect(b.held()).toBe(true)
  expect(card(initial.cards, A)).toMatchObject({
    installed: true,
    installedVersion: '1.0.0',
    state: 'Installed',
  })
  expect(card(initial.cards, B)).toMatchObject({
    installed: true,
    installedVersion: '1.0.0',
    state: 'Installed',
  })
  expect(card(initial.cards, B).uninstallDeletesData).toBeUndefined()
  a.release()
  await known(h.f, A, false)
  for (let n = 0; n < 5; n++) {
    const snapshot = await status(h.f)
    expect(card(snapshot.cards, A).uninstallDeletesData).toBe(false)
    expect(card(snapshot.cards, B).uninstallDeletesData).toBeUndefined()
    expect(snapshot.cleanupPending).toEqual([])
  }
  expect(b.held()).toBe(true)
  expect(loads.bCalls()).toHaveLength(1)
  h.changed.length = 0
  b.release()
  await known(h.f, B, true)
  expect(loads.bCalls()).toHaveLength(1)
  expect(h.changed).toEqual([h.f.local.sink.workspaceId])
  expect(h.start).not.toHaveBeenCalled()
})

it('uses already-running verified package facts immediately without a second metadata load', async () => {
  const h = await setup()
  await h.f.controller.reconcileConsumer(h.f.handle, h.f.local.sink)
  await bounded(
    vi.waitFor(() => {
      expect(h.f.controller.contributions(h.f.handle, A).current()).toBe(true)
      expect(h.f.controller.contributions(h.f.handle, B).current()).toBe(true)
    }),
    'running public contribution readiness',
  )
  const loads = watchLoads()
  const snapshot = await status(h.f)
  expect(card(snapshot.cards, A)).toMatchObject({ state: 'Running', uninstallDeletesData: false })
  expect(card(snapshot.cards, B)).toMatchObject({ state: 'Running', uninstallDeletesData: true })
  await turn()
  expect(loads.calls).toEqual([])
})

it.each(['missing archive', 'invalid archive'] as const)(
  'keeps %s metadata unknown and retries only on a later status',
  async (mode) => {
    const h = await setup()
    const archive = join(h.f.root, 'package-vault', h.b.release.archive.sha256, 'archive')
    const saved = await readFile(archive)
    const absent = archive + '.fictional-held'
    if (mode === 'missing archive') await rename(archive, absent)
    else await writeFile(archive, Buffer.from('fictional invalid tar'))
    closers.push(async () => {
      if (mode === 'missing archive') await rename(absent, archive).catch(() => undefined)
      else await writeFile(archive, saved)
    })
    const first = gate(),
      retry = gate()
    let attempts = 0
    const loads = watchLoads(async (release) => {
      if (release.id === B) await (++attempts === 1 ? first : retry).wait(release)
    })
    expect(card((await status(h.f)).cards, B).uninstallDeletesData).toBeUndefined()
    await bounded(first.entered, 'failed B load entered')
    await known(h.f, A, false)
    h.changed.length = 0
    first.release()
    await bounded(
      vi.waitFor(() => {
        expect(loads.outcomes.filter((one) => one.release.id === B)).toEqual([
          { release: expect.objectContaining({ id: B }), ok: false },
        ])
      }),
      'actual missing/invalid archive rejection',
    )
    await turn()
    expect(loads.bCalls()).toHaveLength(1)
    expect(h.changed).toEqual([])
    // No cached false, automatic retry, or timer is needed to get another attempt.
    expect(card((await status(h.f)).cards, B).uninstallDeletesData).toBeUndefined()
    await bounded(retry.entered, 'later status starts one B retry')
    expect(loads.bCalls()).toHaveLength(2)
    for (let n = 0; n < 3; n++)
      expect(card((await status(h.f)).cards, B).uninstallDeletesData).toBeUndefined()
    expect(loads.bCalls()).toHaveLength(2)
    if (mode === 'missing archive') await rename(absent, archive)
    else await writeFile(archive, saved)
    retry.release()
    await known(h.f, B, true)
    expect(loads.bCalls()).toHaveLength(2)
    expect(h.changed).toEqual([h.f.local.sink.workspaceId])
  },
)

it.each(['new hashes', 'new incarnation', 'new install'] as const)(
  'suppresses stale selected-B metadata publication after %s',
  async (mode) => {
    const h = await setup()
    const old = gate(),
      replacement = gate()
    let attempts = 0
    const loads = watchLoads(async (release) => {
      if (release.id === B) await (++attempts === 1 ? old : replacement).wait(release)
    })
    expect(card((await status(h.f)).cards, B).uninstallDeletesData).toBeUndefined()
    await bounded(old.entered, 'old selected B read entered')
    await known(h.f, A, false)
    const before = h.f.state.currentInstallation(B)!
    const next = mode === 'new hashes' ? genericPackage(B, 'keep', '2.0.0') : h.b
    if (mode === 'new hashes') await h.stage(next)
    if (mode === 'new install') await select(h.f, h.b, 'uninstall')
    await select(h.f, next)
    const selected = h.f.state.currentInstallation(B)!
    expect(selected.incarnation).not.toBe(before.incarnation)
    if (mode === 'new install') expect(selected.installId).not.toBe(before.installId)
    else expect(selected.installId).toBe(before.installId)
    h.changed.length = 0
    old.release()
    await bounded(
      vi.waitFor(() => {
        expect(loads.outcomes.filter((one) => one.release.id === B)).toHaveLength(1)
      }),
      'old verified read completed',
    )
    await turn()
    // No status poll/new load can account for this event check: only the stale result settled.
    expect(h.changed).toEqual([])
    expect(h.f.state.currentInstallation(B)).toEqual(selected)
    if (mode === 'new hashes') {
      const snapshot = await status(h.f)
      expect(card(snapshot.cards, B)).toMatchObject({ installed: true, installedVersion: '2.0.0' })
      expect(card(snapshot.cards, B).uninstallDeletesData).toBeUndefined()
      expect(await bounded(replacement.entered, 'replacement B read entered')).toMatchObject({
        id: B,
        version: '2.0.0',
        archive: { sha256: next.release.archive.sha256 },
        manifestSha256: next.release.manifestSha256,
      })
      expect(replacement.held()).toBe(true)
      replacement.release()
      await known(h.f, B, false)
      expect(loads.bCalls()).toHaveLength(2)
      expect(h.changed).toEqual([h.f.local.sink.workspaceId])
    }
  },
)
