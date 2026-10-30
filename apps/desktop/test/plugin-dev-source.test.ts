import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { devPluginArchive, devPluginSource } from '../src/main/plugins/catalogue/dev-source'
import { loadRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { PLUGIN_LIST_URL } from '../src/main/plugins/catalogue/download'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { bootstrapPluginLifecycle } from '../src/main/plugins/lifecycle/bootstrap'
import type { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
const seams = vi.hoisted(() => ({ lifecycle: vi.fn() }))
vi.mock('../src/main/plugins/lifecycle/supervisor', () => ({
  createSupervisorLifecycle: seams.lifecycle,
}))
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await cleanupLifecycleFixtures()
})
describe.skipIf(process.platform === 'win32')('unpackaged local plugin source', () => {
  async function setup() {
    const f = await fixture()
    const appData = join(dirname(f.root), 'app-data')
    const directory = join(appData, '@brobot2', 'plugin-dev-source')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const list = repoListFor(f.pkg.release, 'Fictional bakery')
    const archive = join(directory, 'fictional.tar')
    await writeFile(join(directory, 'catalogue.json'), JSON.stringify(list), { mode: 0o600 })
    await writeFile(archive, f.pkg.archive, { mode: 0o600 })
    const fetch = vi.fn(async () => {
      throw new Error('fictional network must stay unused')
    })
    vi.stubGlobal('fetch', fetch)
    const load = async () => {
      const devSource = await devPluginSource({ isPackaged: false, appData })
      const loaded = await loadRepoPluginList({
        root: f.root,
        target: f.opts.target,
        appVersion: '1.0.0',
        devSource,
      })
      const controller = await PluginLifecycleController.open({
        ...f.opts,
        pinnedPublicKey: null,
        repoCatalogueSha256: loaded.sha256,
        catalogue: { bytes: loaded.bytes, signature: Buffer.alloc(0) },
        download: (release) => devPluginArchive(devSource!, release),
      })
      const handle = await controller.attach(projection().sink)
      return { loaded, controller, handle }
    }
    return { f, appData, directory, archive, list, fetch, load }
  }
  it('reads the dev list and verifies the exact asset through the one-press install lifecycle without a fetch', async () => {
    const { f, fetch, load } = await setup()
    const { loaded, controller, handle } = await load()
    expect(loaded.entries[0]?.name).toBe('Fictional bakery')
    await controller.install(handle, 'chrome')
    expect(f.starts()).toBe(1)
    expect((await controller.status()).cards[0]?.state).toBe('Running')
    expect(f.state.exportActivation().entries[0]?.pluginId).toBe('chrome')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'the real supervisor bootstrap retains local verification (tampered=%s)',
    async (tampered) => {
      const { f, directory, archive, fetch } = await setup()
      const loaded = await loadRepoPluginList({
        root: f.root,
        target: f.opts.target,
        appVersion: '1.0.0',
        devSource: directory,
      })
      if (tampered) {
        const bytes = Buffer.from(f.pkg.archive)
        bytes[0] = bytes[0]! ^ 1
        await writeFile(archive, bytes)
      }
      seams.lifecycle.mockImplementation(
        async (options: Parameters<typeof createSupervisorLifecycle>[0]) => {
          const controller = await PluginLifecycleController.open({
            ...options.lifecycle,
            runtime: {
              ...f.opts.runtime,
              async start(spec) {
                const run = await f.opts.runtime.start(spec)
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
              },
            },
          })
          return { controller, path: 'fictional-control', close: () => controller.drain() }
        },
      )
      let stopOwner!: () => void
      const closed = new Promise<void>((resolve) => {
        stopOwner = resolve
      })
      const service = await bootstrapPluginLifecycle({
        root: f.root,
        workspaceRoots: [join(dirname(f.root), 'workspace')],
        owner: { closed } as Parameters<typeof bootstrapPluginLifecycle>[0]['owner'],
        host: {} as Parameters<typeof bootstrapPluginLifecycle>[0]['host'],
        plan: {
          source: 'repo-list',
          appVersion: '1.0.0',
          catalogue: loaded.catalogue,
          catalogueSha256: loaded.sha256,
          names: { chrome: 'Fictional bakery' },
          personKey: 'a'.repeat(64),
          devSource: directory,
        },
      })
      try {
        const handle = await service.controller.attach(projection().sink)
        if (tampered)
          await expect(service.controller.install(handle, 'chrome')).rejects.toThrow(
            'Plugin unavailable. Try again.',
          )
        else {
          await service.controller.install(handle, 'chrome')
          const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.3' } })
          await writeFile(archive, next.archive, { mode: 0o600 })
          await writeFile(
            join(directory, 'catalogue.json'),
            JSON.stringify(repoListFor(next.release)),
            { mode: 0o600 },
          )
          const refreshed = await loadRepoPluginList({
            root: f.root,
            target: f.opts.target,
            appVersion: '1.0.0',
            devSource: directory,
          })
          await service.controller.refreshCatalogue(refreshed.sha256)
          expect((await service.controller.status()).cards[0]?.updateVersion).toBe('1.0.3')
          await service.controller.update(handle, 'chrome')
          expect((await service.controller.status()).cards[0]?.installedVersion).toBe('1.0.3')
        }
        expect(f.starts()).toBe(tampered ? 0 : 2)
        expect(fetch).not.toHaveBeenCalled()
      } finally {
        try {
          await service.close()
        } finally {
          stopOwner()
          await closed
        }
      }
    },
  )
  it.each(['tampered archive', 'wrong manifest', 'missing asset', 'linked asset'])(
    'refuses %s without a run or network fallback',
    async (fault) => {
      const { f, archive, directory, list, fetch, load } = await setup()
      if (fault === 'wrong manifest') {
        list.entries[0]!.targets[0]!.manifestSha256 = '0'.repeat(64)
        await writeFile(join(directory, 'catalogue.json'), JSON.stringify(list))
      }
      const { controller, handle } = await load()
      if (fault === 'tampered archive') {
        const bytes = Buffer.from(f.pkg.archive)
        bytes[0] = bytes[0]! ^ 1
        await writeFile(archive, bytes)
      }
      if (fault === 'missing asset') await unlink(archive)
      if (fault === 'linked asset') {
        await rename(archive, archive + '.kept')
        await symlink(archive + '.kept', archive)
      }
      await expect(controller.install(handle, 'chrome')).rejects.toThrow(
        'Plugin unavailable. Try again.',
      )
      expect(f.starts()).toBe(0)
      expect(f.state.exportActivation().entries).toHaveLength(0)
      expect(f.state.inspect().pending).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  it('admits a shared dev folder and a later permission change without bypassing verification', async () => {
    const { f, directory, appData, fetch, load } = await setup()
    await chmod(directory, 0o755)
    expect(await devPluginSource({ isPackaged: false, appData })).toBe(directory)
    const { controller, handle } = await load()
    await chmod(directory, 0o777)
    await controller.install(handle, 'chrome')
    expect(f.starts()).toBe(1)
    expect(f.state.exportActivation().entries).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('ignores even unsafe local input in packaged builds and reads only the fixed network list', async () => {
    const { f, directory, appData, list } = await setup()
    await chmod(directory, 0o777)
    await writeFile(join(directory, 'catalogue.json'), 'not JSON')
    const fetch = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe(PLUGIN_LIST_URL)
      return new Response(JSON.stringify(list))
    })
    vi.stubGlobal('fetch', fetch)
    const devSource = await devPluginSource({ isPackaged: true, appData })
    expect(devSource).toBeUndefined()
    const loaded = await loadRepoPluginList({
      root: f.root,
      target: f.opts.target,
      appVersion: '1.0.0',
      devSource,
    })
    expect(loaded.entries[0]?.name).toBe('Fictional bakery')
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toBe(PLUGIN_LIST_URL)
  })
  it('keeps the existing source when the dev folder is absent', async () => {
    const { directory, appData } = await setup()
    await rename(directory, directory + '-absent')
    expect(await devPluginSource({ isPackaged: false, appData })).toBeUndefined()
  })
  it.each(['symlink', 'canonical alias'])(
    'refuses an existing %s source before any fetch',
    async (fault) => {
      const { directory, appData, fetch } = await setup()
      let path = appData
      if (fault === 'symlink') {
        await rename(directory, directory + '-kept')
        await symlink(directory + '-kept', directory)
      } else {
        path = appData + '-alias'
        await symlink(appData, path)
      }
      await expect(devPluginSource({ isPackaged: false, appData: path })).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})
