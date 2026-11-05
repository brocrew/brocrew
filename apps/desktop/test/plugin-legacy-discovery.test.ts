import { observeInstalled } from './plugin-installed-observation'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import {
  connectPersonPluginControl,
  servePersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { pluginPersonCapability } from '../src/main/plugins/catalogue/capability'
import { PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL } from '../src/main/plugins/catalogue/download'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import type { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import { productionPluginController } from '../src/main/plugins/production'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import {
  cleanupLifecycleFixtures,
  fixture,
  projection,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'

vi.mock('../src/main/plugins/supervisor/launcher', () => ({
  createPluginSupervisorLauncher: () => async () => {
    throw new Error('No supervisor launch in the fictional discovery harness')
  },
}))
const closers: Array<() => Promise<unknown>> = []
function keepClient(client: { close(): Promise<void> }) {
  const close = client.close.bind(client)
  let closing: Promise<void> | undefined
  client.close = () => (closing ??= close())
  closers.push(() => client.close())
}
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

async function setup(fixedVersion = false, invalidSource?: 'view') {
  const f = await fixture({}, false, 'fictional-bakery')
  const chrome = packageFixture({ manifest: { ...f.pkg.manifest, id: 'fictional-pointers' } })
  const extra = packageFixture({ manifest: { ...f.pkg.manifest, id: 'fictional-maps' } })
  const original = repoListFor(f.pkg.release, 'Fictional messages')
  // Callers may select different source lists; row minimums do not filter their offers.
  const legacySource = {
    format: 1,
    entries: [
      ...original.entries,
      ...repoListFor(chrome.release, 'Fictional browser').entries.map((one) => ({
        ...one,
        minAppVersion: '1.0.0',
      })),
    ],
  }
  const expanded = {
    format: 1,
    entries: [
      ...original.entries,
      ...repoListFor(chrome.release, 'Fictional browser').entries.map((one) => ({
        ...one,
        minAppVersion: '1.0.0',
      })),
      ...repoListFor(extra.release, 'Fictional maps').entries.map((one) => ({
        ...one,
        minAppVersion: '99.0.0',
      })),
    ],
  }
  const parse = (input: unknown, version = '1.0.0') =>
    parseRepoPluginList(Buffer.from(JSON.stringify(input)), f.opts.target, version)
  const one = parse(original),
    two = parse(legacySource),
    three = parse(expanded, '99.0.0')
  let source = fixedVersion ? three : two
  const initial = fixedVersion ? three : one
  const raw = Buffer.from(JSON.stringify(expanded))
  const repoList = fixedVersion
    ? { bytes: raw, sha256: pluginSha256(raw), appVersion: '99.0.0' }
    : undefined
  if (repoList && invalidSource === 'view') repoList.appVersion = '1.0.0'
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    let exited!: () => void
    return {
      ...run,
      exited: new Promise<void>((resolve) => {
        exited = resolve
      }),
      async stop() {
        await run.stop()
        exited()
      },
    }
  }
  const ownerOptions = {
    ...f.opts,
    pinnedPublicKey: null,
    repoCatalogueSha256: initial.sha256,
    catalogue: { bytes: initial.bytes, signature: Buffer.alloc(0) },
    repoList,
    appVersion: fixedVersion ? '99.0.0' : '1.0.0',
    names: { 'fictional-bakery': 'Fictional messages', 'fictional-pointers': 'Fictional browser' },
    refreshCatalogue: async () => ({
      catalogue: { bytes: source.bytes, signature: Buffer.alloc(0) },
      repoCatalogueSha256: source.sha256,
      repoList,
      names: {
        'fictional-bakery': 'Fictional messages',
        'fictional-pointers': 'Fictional browser',
        'fictional-maps': 'Fictional maps',
      },
    }),
  }
  const controller = await PluginLifecycleController.open(ownerOptions)
  closers.push(() => controller.drain())
  const handle = await controller.attach(projection().sink)
  await controller.install(handle, 'fictional-bakery')
  if (!fixedVersion) await controller.refreshCatalogue(two.sha256)
  const key = await pluginPersonCapability(f.root)
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller: sharedLifecycleWorkspaces(controller),
  })
  closers.push(() => bridge.close())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect([PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL]).toContain(String(url))
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
    download: async (release: Readonly<typeof f.pkg.release>) =>
      release.id === f.pkg.release.id
        ? f.pkg.archive
        : release.id === chrome.release.id
          ? chrome.archive
          : extra.archive,
    projection: projection().sink,
  })
  const facade = () => {
    const client = productionPluginController()
    keepClient(client)
    client.start({
      root: f.root,
      workspaceRoot: f.workspace,
      resourcesRoot: join(f.parent, 'fictional-resources'),
      build: 'fictional-old-build',
      appVersion: '1.0.0',
      target: f.opts.target,
      supervisor: {
        start: vi.fn(),
        ready: async () => true,
        holdsLease: () => true,
        stoppedCleanly: () => false,
        supports: () => true,
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
    raw,
    extra,
    legacySource,
    three,
    facade,
    clientOptions,
    ownerOptions,
    expand: async () => {
      source = three
      await controller.refreshCatalogue(three.sha256)
    },
  }
}

describe.skipIf(process.platform === 'win32')(
  'ordinary production discovery and legacy package data',
  () => {
    it('keeps listing and retained installed bytes across app versions despite stale high row minimums', async () => {
      const f = await setup()
      await f.expand()
      const facade = f.facade()
      expect(await facade.ready!()).toBe(true)
      expect(await facade.catalogue()).toMatchObject([
        { id: 'fictional-bakery', state: 'Running', installed: true },
        { id: 'fictional-pointers', state: 'Available', installed: false },
        { id: 'fictional-maps', state: 'Available', installed: false },
      ])
      await expect(facade.screen('fictional-bakery')).rejects.toThrow()
      const screen = await observeInstalled(f.opts, f.state, 'fictional-bakery')
      expect(screen.package.manifest.id).toBe('fictional-bakery')
      const modern = await connectPluginSettings(f.clientOptions())
      keepClient(modern)
      expect((await modern.catalogue()).map((one) => one.id).sort()).toEqual([
        'fictional-bakery',
        'fictional-maps',
        'fictional-pointers',
      ])
      await f.expand()
      expect((await facade.catalogue()).map((one) => one.id)).toEqual([
        'fictional-bakery',
        'fictional-pointers',
        'fictional-maps',
      ])
      await facade.close()
      const reattached = f.facade()
      expect(await reattached.ready!()).toBe(true)
      expect((await reattached.catalogue()).map((one) => one.id)).toEqual([
        'fictional-bakery',
        'fictional-pointers',
        'fictional-maps',
      ])
      expect(
        (await observeInstalled(f.opts, f.state, 'fictional-bakery')).package.readFile(
          'plugin.json',
        ),
      ).toEqual(Uint8Array.from(f.pkg.manifestBytes))
    })

    it('reopens retained installation bytes offline with old Configure refused under a different caller list', async () => {
      const f = await setup(true)
      const first = await connectPluginSettings(f.clientOptions(f.one))
      keepClient(first)
      await expect(first.screen('fictional-bakery')).rejects.toThrow()
      const screen = await observeInstalled(f.opts, f.state, 'fictional-bakery')
      expect(screen.package.manifest.id).toBe('fictional-bakery')
      const before = f.state.exportActivation().entries[0]!
      await first.close()
      await f.bridge.close()
      await f.controller.drain()
      const state = reopenLifecycleFixture(f)
      const download = vi.fn(async () => {
        throw new Error('fictional offline')
      })
      const restored = await PluginLifecycleController.open({ ...f.ownerOptions, state, download })
      closers.push(() => restored.drain())
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: f.key,
        controller: sharedLifecycleWorkspaces(restored),
      })
      closers.push(() => bridge.close())
      const again = await connectPluginSettings({
        ...f.clientOptions(f.two),
        path: bridge.path,
        download,
      })
      keepClient(again)
      expect((await again.catalogue()).map((one) => one.id).sort()).toEqual([
        'fictional-bakery',
        'fictional-pointers',
      ])
      await expect(again.screen('fictional-bakery')).rejects.toThrow()
      const reopened = await observeInstalled(f.opts, state, 'fictional-bakery')
      expect(reopened.package.readFile('plugin.json')).toEqual(Uint8Array.from(f.pkg.manifestBytes))
      expect(reopened.installation.installId).toBe(before.installId)
      expect(reopened.installation).toEqual(before)
      expect(state.inspect().pending).toBeNull()
      expect(download).not.toHaveBeenCalled()
      expect(
        await readFile(join(f.root, 'package-vault', before.release.archiveSha256, 'archive')),
      ).toEqual(f.pkg.archive)
    })

    it('rejects raw source bytes with a mismatched digest before starting a plugin', async () => {
      const f = await fixture({}, false, 'fictional-bakery')
      const bytes = Buffer.from(JSON.stringify(repoListFor(f.pkg.release)))
      const before = f.state.inspect()
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(
        PluginLifecycleController.open({
          ...f.opts,
          repoList: { bytes, sha256: '0'.repeat(64), appVersion: '1.0.0' },
        }),
      ).rejects.toThrow()
      expect(f.state.inspect()).toEqual(before)
      expect(f.starts()).toBe(0)
      expect(f.events).toEqual([])
      expect(fetch).not.toHaveBeenCalled()
    })

    it('keeps a different caller-selected source independent of the owner app version', async () => {
      const f = await setup(true, 'view')
      const caller = await connectPluginSettings(f.clientOptions(f.two))
      keepClient(caller)
      expect((await caller.catalogue()).map((one) => one.id).sort()).toEqual([
        'fictional-bakery',
        'fictional-pointers',
      ])
      const sameSource = parseRepoPluginList(f.raw, f.opts.target, '1.0.0')
      expect(sameSource.bytes).toEqual(f.three.bytes)
      expect(sameSource.sha256).toBe(f.three.sha256)
      expect(f.three.releases.map((one) => one.id)).toContain('fictional-maps')
      expect(f.two.releases.map((one) => one.id)).not.toContain('fictional-maps')
      await expect(caller.screen('fictional-bakery')).rejects.toThrow()
      const screen = await observeInstalled(f.opts, f.state, 'fictional-bakery')
      expect(screen.package.readFile('plugin.json')).toEqual(Uint8Array.from(f.pkg.manifestBytes))
      expect(f.state.inspect().pending).toBeNull()
    })

    it('retains different caller-selected offer sets across owner refresh and reattach', async () => {
      const f = await setup()
      const original = await connectPluginSettings(f.clientOptions(f.one))
      keepClient(original)
      const newer = await connectPluginSettings(f.clientOptions(f.two))
      keepClient(newer)
      await f.expand()
      expect((await original.catalogue()).map((one) => one.id)).toEqual(['fictional-bakery'])
      expect((await newer.catalogue()).map((one) => one.id).sort()).toEqual([
        'fictional-bakery',
        'fictional-pointers',
      ])
      await original.close()
      const again = await connectPluginSettings(f.clientOptions(f.one))
      keepClient(again)
      expect((await again.catalogue()).map((one) => one.id)).toEqual(['fictional-bakery'])
      expect(
        (await observeInstalled(f.opts, f.state, 'fictional-bakery')).package.manifest.version,
      ).toBe('1.0.0')
    })

    it('forwards new plugin notices without a caller catalogue admission filter', async () => {
      const f = await setup()
      const attached = vi.spyOn(f.controller, 'attach')
      const receiver = projection()
      const applied = vi.spyOn(receiver.sink, 'applied')
      const reconcile = vi.spyOn(receiver.sink, 'reconcile')
      const revoke = vi.spyOn(receiver.sink, 'revoke')
      const caller = await connectPluginSettings({
        ...f.clientOptions(f.one),
        projection: receiver.sink,
      })
      keepClient(caller)
      const sink = attached.mock.calls[0]![0]
      applied.mockClear()
      reconcile.mockClear()
      revoke.mockClear()
      await sink.applied('fictional-maps', null)
      await sink.reconcile({ pluginId: 'fictional-maps', before: null, receipt: null })
      const installId = randomUUID()
      expect(await sink.revoke('fictional-maps', installId)).toBe(true)
      expect(applied.mock.calls.filter(([id]) => id === 'fictional-maps')).toEqual([
        ['fictional-maps', null],
      ])
      expect(
        reconcile.mock.calls.filter(([change]) => change.pluginId === 'fictional-maps'),
      ).toEqual([[{ pluginId: 'fictional-maps', before: null, receipt: null }]])
      expect(revoke.mock.calls.filter(([id]) => id === 'fictional-maps')).toEqual([
        ['fictional-maps', installId],
      ])
    })

    it('accepts a reordered caller source and leaves another caller selection unchanged', async () => {
      const f = await setup()
      const bytes = Buffer.from(
        JSON.stringify({ format: 1, entries: [...f.three.releases].reverse() }),
      )
      const candidate = await connectPluginSettings(
        f.clientOptions({ ...f.three, bytes, sha256: pluginSha256(bytes) }),
      )
      keepClient(candidate)
      expect((await candidate.catalogue()).map((one) => one.id).sort()).toEqual([
        'fictional-bakery',
        'fictional-maps',
        'fictional-pointers',
      ])
      const other = await connectPluginSettings(f.clientOptions(f.two))
      keepClient(other)
      expect((await other.catalogue()).map((one) => one.id).sort()).toEqual([
        'fictional-bakery',
        'fictional-pointers',
      ])
      expect(f.state.inspect().pending).toBeNull()
      expect(
        (await observeInstalled(f.opts, f.state, 'fictional-bakery')).package.manifest.id,
      ).toBe('fictional-bakery')
    })

    it('lists without source provenance while retaining the negotiated reply shapes', async () => {
      const f = await setup()
      const channel = await connectPersonPluginControl({
        path: f.bridge.path,
        key: f.key,
        handle: async () => true,
      })
      try {
        await channel.call({ kind: 'attach', workspaceId: projection().sink.workspaceId })
        const cards = (await channel.call({ kind: 'list' })) as Array<Record<string, unknown>>
        expect(cards.map((one) => one.id).sort()).toEqual([
          'fictional-bakery',
          'fictional-pointers',
        ])
        expect(cards.find((one) => one.id === 'fictional-bakery')).toMatchObject({
          installed: true,
          state: 'Running',
        })
        for (const card of cards)
          expect(Object.keys(card).sort()).toEqual(['id', 'installed', 'name', 'state'])
        expect(await channel.call({ kind: 'list-v2' })).toMatchObject([
          { id: 'fictional-bakery', installedVersion: '1.0.0' },
          { id: 'fictional-pointers', installed: false },
        ])
      } finally {
        channel.close()
      }
    })
  },
)
