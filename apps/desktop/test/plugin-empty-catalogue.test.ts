import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleWorkspace } from '../src/main/plugins/lifecycle/types'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import { immutableFile } from '../src/main/plugins/node-host-files'
import { bootstrapPluginLifecycle } from '../src/main/plugins/lifecycle/bootstrap'
import type { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
const seam = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('../src/main/plugins/lifecycle/supervisor', () => ({
  createSupervisorLifecycle: seam.start,
}))
const closers: Array<() => unknown | Promise<unknown>> = []
async function accepted(
  controller: PluginLifecycleController,
  handle: LifecycleWorkspace,
  id: string,
  installId: string,
) {
  const workspaceId = controller.hostWorkspace(handle)
  let resolve!: () => void, reject!: (error: unknown) => void
  const ready = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const check = () => {
    try {
      if (controller.admitted(handle, id, installId)) resolve()
    } catch (error) {
      reject(error)
    }
  }
  const stop = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  receiptSubscriptions.add(stop)
  try {
    check()
    await ready
  } finally {
    receiptSubscriptions.delete(stop)
    stop()
  }
}
const receiptSubscriptions = new Set<() => void>()
afterEach(async () => {
  for (const stop of receiptSubscriptions) stop()
  receiptSubscriptions.clear()
  try {
    for (const close of closers.splice(0).reverse()) await close()
  } finally {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    await cleanupLifecycleFixtures()
  }
})
async function setup(installed: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('No unsolicited profile or network command is allowed')
    }),
  )
  const f = await fixture()
  await f.controller.drain()
  const start = f.opts.runtime.start
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    let done!: () => void
    const exited = new Promise<void>((resolve) => {
      done = resolve
    })
    return {
      ...run,
      exited,
      async stop() {
        await run.stop()
        done()
      },
    }
  }
  f.opts.pinnedPublicKey = null
  f.opts.repoCatalogueSha256 = pluginSha256(f.pkg.bytes)
  f.opts.catalogue = { bytes: f.pkg.bytes, signature: Buffer.alloc(0) }
  const initial = await PluginLifecycleController.open(f.opts)
  closers.push(() => initial.drain())
  const handle = await initial.attach(projection(f.events).sink)
  if (installed) await initial.install(handle, 'chrome')
  await initial.drain()
  return f
}
function discoveryLists(f: Awaited<ReturnType<typeof setup>>) {
  const legacy = repoListFor(f.pkg.release, 'Fictional Cedar')
  const empty = { format: 2, entries: [] }
  return { legacy, empty }
}
async function restarted(appVersion: string, empty: boolean) {
  const f = await setup(true)
  const { legacy, empty: emptyList } = discoveryLists(f)
  const raw = Buffer.from(JSON.stringify(empty ? emptyList : legacy))
  const view = parseRepoPluginList(raw, f.opts.target, appVersion)
  expect(view.releases).toHaveLength(empty ? 0 : 1)
  const cutoff = f.events.length
  const installedBefore = f.state.exportActivation().entries[0]!
  const ownerBefore = f.state.inspect()
  const guards: unknown[] = []
  const recordGuards = () => {
    const current = f.state.inspect()
    expect(current.guards).toEqual(ownerBefore.guards)
    expect(current.guards).toMatchObject([{ pluginId: 'chrome', phase: 'active' }])
    expect(current.pending).toBeNull()
    expect(current.operations).toEqual(ownerBefore.operations)
    expect(f.state.exportActivation().entries[0]?.installId).toBe(installedBefore.installId)
    // Separate fixtures allocate different UUIDs; all original guard fields are checked above.
    guards.push(
      current.guards.map((guard) => ({
        ...guard,
        installId: '<same-installation>',
        incarnation: '<same-incarnation>',
      })),
    )
  }
  recordGuards()
  const controller = await PluginLifecycleController.open({
    ...f.opts,
    catalogue: { bytes: view.bytes, signature: Buffer.alloc(0) },
    repoCatalogueSha256: view.sha256,
    names: {},
    repoList: { bytes: raw, sha256: pluginSha256(raw), appVersion },
    legacyRepoList: {
      bytes: Buffer.from(JSON.stringify(legacy)),
      sha256: pluginSha256(Buffer.from(JSON.stringify(legacy))),
      appVersion,
    },
    refreshCatalogue: async () => ({
      catalogue: { bytes: view.bytes, signature: Buffer.alloc(0) },
      repoCatalogueSha256: view.sha256,
      repoList: { bytes: raw, sha256: pluginSha256(raw), appVersion },
      names: {},
    }),
  })
  recordGuards()
  closers.push(() => controller.drain())
  const bridge = await servePersonPluginControl({
    root: f.root,
    key: 'e'.repeat(64),
    controller,
  })
  closers.push(() => bridge.close())
  const local = projection(f.events)
  const handles: LifecycleWorkspace[] = []
  const originalAttach = controller.attach
  const observing = vi.spyOn(controller, 'attach').mockImplementation(function (
    this: PluginLifecycleController,
    ...args: Parameters<PluginLifecycleController['attach']>
  ) {
    return originalAttach.apply(this, args).then((handle) => {
      if (this === controller && args[0].workspaceId === local.sink.workspaceId)
        handles.push(handle)
      return handle
    })
  })
  const connect = async () => {
    const client = await connectPluginSettings({
      path: bridge.path,
      personKey: 'e'.repeat(64),
      root: f.root,
      pinnedPublicKey: null,
      repoCatalogueSha256: view.sha256,
      target: f.opts.target,
      catalogue: { bytes: view.bytes, signature: Buffer.alloc(0) },
      download: f.opts.download,
      projection: local.sink,
    })
    closers.push(() => client.close())
    expect(handles).toHaveLength(1)
    await accepted(controller, handles[0]!, 'chrome', installedBefore.installId)
    return client
  }
  let client: Awaited<ReturnType<typeof connectPluginSettings>>
  try {
    client = await connect()
  } finally {
    observing.mockRestore()
  }
  recordGuards()
  // Every attach clears stale workspace consumers, including with admitted releases.
  // It then rebinds the same authenticated installation; absence must add no revocation.
  const startup = f.events.slice(cutoff)
  expect(startup.filter((event) => event === 'revoke')).toEqual(['revoke'])
  expect(startup.slice(startup.indexOf('revoke') + 1)).toContain('bind')
  expect(
    startup.filter((event) => event === 'deny' || event === 'stop' || event.startsWith('remove')),
  ).toEqual([])
  const refreshed = f.events.length
  await client.refreshCatalogue!(view.sha256)
  recordGuards()
  const cards = await client.catalogue()
  expect(cards).toMatchObject([
    { id: 'chrome', installed: true, installedVersion: f.pkg.release.version, state: 'Running' },
  ])
  expect(cards[0]).not.toHaveProperty('updateVersion')
  // Format1/2 selected installations remain readable/manageable, but their decoded UI
  // declarations cannot reactivate the retired app domain protocol.
  await expect(client.screen('chrome')).rejects.toThrow()
  const vault = new PluginPackageVault(f.root, null, f.opts.target)
  const saved = await vault.load(
    {
      id: installedBefore.pluginId,
      version: installedBefore.release.version,
      manifestSha256: installedBefore.release.manifestSha256,
      archive: { sha256: installedBefore.release.archiveSha256 },
    },
    [],
  )
  expect(saved.manifest.id).toBe('chrome')
  expect(pluginSha256(saved.readFile('plugin.json')!)).toBe(installedBefore.release.manifestSha256)
  expect(
    f.events
      .slice(refreshed)
      .filter(
        (event) =>
          event === 'deny' || event === 'stop' || event === 'revoke' || event.startsWith('remove'),
      ),
  ).toEqual([])
  expect(f.state.exportActivation().entries[0]?.installId).toBe(installedBefore.installId)
  expect((await controller.status()).cleanupPending).toEqual([])
  const ownerAfter = f.state.inspect()
  expect(ownerAfter.guards).toEqual(ownerBefore.guards)
  expect(ownerAfter.guards).toMatchObject([{ pluginId: 'chrome', phase: 'active' }])
  expect(ownerAfter.pending).toBeNull()
  expect(ownerAfter.operations).toEqual(ownerBefore.operations)
  recordGuards()
  expect(fetch).not.toHaveBeenCalled()
  if (empty) {
    const selected = await client.inspectPackage!('chrome')
    expect(selected.ref).toMatchObject({
      sha256: pluginSha256(f.pkg.archive),
      bytes: f.pkg.archive.length,
    })
    expect(selected.details).toMatchObject({
      authors: null,
      permissions: f.pkg.manifest.permissions,
      manifestSha256: f.pkg.release.manifestSha256,
    })
    await expect(
      client.inspectPackage!({ ...selected.ref, bytes: selected.ref.bytes + 1 }),
    ).rejects.toThrow('The selected package byte count does not match its archive.')
    expect(f.state.exportActivation().entries[0]?.installId).toBe(installedBefore.installId)
    const starts = f.starts()
    // An active installation still conflicts with Install, independently of discovery offers.
    await expect(client.install('chrome')).rejects.toThrow()
    expect(f.state.exportActivation().entries[0]).toEqual(installedBefore)
    expect(f.state.inspect().pending).toBeNull()
    expect(f.starts()).toBe(starts)
    await client.update!('chrome')
    const updated = f.state.exportActivation().entries[0]!
    expect(updated.installId).toBe(installedBefore.installId)
    expect(updated.release).toEqual(installedBefore.release)
    expect(updated.releaseRevision).toBe(installedBefore.releaseRevision + 1)
    expect(updated.incarnation).not.toBe(installedBefore.incarnation)
    expect(f.starts()).toBe(starts + 1)
    expect(f.state.inspect().pending).toBeNull()
    expect(f.events.slice(refreshed)).not.toContain('remove-data chrome')
    expect(fetch).not.toHaveBeenCalled()
  }
  await client.uninstall('chrome')
  expect((await client.catalogue()).every((card) => !card.installed)).toBe(true)
  expect(f.downloads()).toBe(1)
  return { startup, guards }
}
it.each(['0.0.0', '0.1.6', '1.0.0'])(
  'an empty catalogue adds no startup or refresh effect versus an admitted restart at %s',
  async (appVersion) => {
    const admitted = await restarted(appVersion, false)
    // Windows derives the pipe from the fictional key, so end this owner before reusing it.
    for (const close of closers.splice(0).reverse()) await close()
    const empty = await restarted(appVersion, true)
    expect(empty.startup).toEqual(admitted.startup)
    expect(empty.guards).toEqual(admitted.guards)
  },
)

it.each([false, true])(
  'owner bootstrap accepts an empty catalogue and preserves installed=%s without a download',
  async (installed) => {
    const f = await setup(installed)
    const { legacy, empty: emptyList } = discoveryLists(f)
    const appVersion = '0.0.0'
    const raw = Buffer.from(JSON.stringify(emptyList)),
      old = Buffer.from(JSON.stringify(legacy))
    const view = parseRepoPluginList(raw, f.opts.target, appVersion)
    const catalogue = join(f.root, 'fictional-empty-catalogue.json'),
      repo = join(f.root, 'fictional-empty-list.json'),
      previous = join(f.root, 'fictional-frozen-list.json')
    await immutableFile(catalogue, view.bytes)
    await immutableFile(repo, raw)
    await immutableFile(previous, old)
    let closeOwner!: () => void
    const closed = new Promise<void>((resolve) => {
      closeOwner = resolve
    })
    seam.start.mockImplementation(
      async (options: Parameters<typeof createSupervisorLifecycle>[0]) => {
        const controller = await PluginLifecycleController.open({
          ...options.lifecycle,
          runtime: f.opts.runtime,
        })
        closers.push(async () => {
          await controller.drain()
          closeOwner()
        })
        return { controller }
      },
    )
    const service = await bootstrapPluginLifecycle({
      root: f.root,
      workspaceRoots: [f.workspace],
      owner: { closed } as Parameters<typeof bootstrapPluginLifecycle>[0]['owner'],
      host: {} as Parameters<typeof bootstrapPluginLifecycle>[0]['host'],
      plan: {
        source: 'repo-list',
        sourceVersion: 2,
        appVersion,
        catalogue,
        catalogueSha256: view.sha256,
        repoList: { path: repo, sha256: pluginSha256(raw) },
        legacyRepoList: { path: previous, sha256: pluginSha256(old) },
        personKey: 'e'.repeat(64),
        names: {},
      },
    })
    const handle = await service.controller.attach(projection(f.events).sink)
    if (installed) {
      await accepted(
        service.controller,
        handle,
        'chrome',
        f.state.currentInstallation('chrome')!.installId,
      )
      expect((await service.controller.status()).cards).toMatchObject([
        { id: 'chrome', installed: true, state: 'Running' },
      ])
      await service.controller.screen(handle, 'chrome').connection
      expect(f.downloads()).toBe(1)
    } else {
      expect((await service.controller.status()).cards).toEqual([])
      expect(f.downloads()).toBe(0)
      expect(f.starts()).toBe(0)
      expect(existsSync(join(f.root, 'package-vault'))).toBe(false)
    }
  },
)
