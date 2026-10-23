import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { registerPluginSettings, type PluginSettingsController } from '../src/main/plugins/settings'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'
import { parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL } from '../src/main/plugins/catalogue/download'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { preparedPeer } from './plugin-prepared-peer-fixtures'
import { join } from 'node:path'

vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const seams = vi.hoisted(() => ({ connect: vi.fn(), launch: vi.fn(() => async () => {}) }))
vi.mock('../src/main/plugins/lifecycle/settings-client', () => ({
  connectPluginSettings: seams.connect,
}))
vi.mock('../src/main/plugins/supervisor/launcher', () => ({
  createPluginSupervisorLauncher: seams.launch,
}))
import { productionPluginController } from '../src/main/plugins/production'
import type { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
function ipcFor(controller: PluginSettingsController) {
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  })
  const ipc = { handle: vi.fn() }
  registerPluginSettings(ipc, () => owner as never, controller)
  return (input: unknown) =>
    ipc.handle.mock.calls[0]![1](
      { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
      input,
    )
}
it.each(['install', 'update'] as const)(
  'the IPC %s path refuses a versioned card before asking its controller to mutate',
  async (action) => {
    const card = {
      id: 'chrome',
      name: 'Fictional browser',
      installed: action === 'update',
      state: action === 'update' ? ('Running' as const) : ('Available' as const),
      preparationRequired: true as const,
      ...(action === 'update' ? { installedVersion: '1.0.1', updateVersion: '1.0.2' } : {}),
    }
    const controller = {
      catalogue: vi.fn(async () => [card]),
      install: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      uninstall: vi.fn(async () => {}),
      screen: vi.fn(),
      retry: vi.fn(async () => [card]),
    }
    const call = ipcFor(controller)
    expect(await call({ kind: 'list' })).toMatchObject({ ok: true, cards: [card] })
    expect(await call({ kind: action, id: 'chrome' })).toMatchObject({ ok: false })
    expect(controller.install).not.toHaveBeenCalled()
    expect(controller.update).not.toHaveBeenCalled()
    expect(await call({ kind: 'retry', id: 'chrome' })).toMatchObject({ ok: true })
    expect(controller.install).not.toHaveBeenCalled()
    expect(controller.update).not.toHaveBeenCalled()
    expect(controller.retry).toHaveBeenCalledOnce()
    expect(await call({ kind: 'uninstall', id: 'chrome' })).toMatchObject({ ok: true })
    expect(controller.uninstall).toHaveBeenCalledOnce()
  },
)
async function production(installed: boolean) {
  const f = await fixture(),
    manifest = {
      ...f.pkg.manifest,
      format: 2 as const,
      authors: ['fern-makers'],
      version: '1.0.2',
      executor: { kind: 'node' as const, entry: f.pkg.manifest.server!.entry },
      hooks: [],
    }
  const pkg = packageFixture({ manifest }),
    v1 = repoListFor(f.pkg.release),
    raw = repoListFor(pkg.release)
  const v2 = {
    ...raw,
    format: 2,
    entries: raw.entries.map((entry) => ({ ...entry, authors: ['fern-makers'] })),
  }
  const admitted = parseRepoPluginList(Buffer.from(JSON.stringify(v2)), f.opts.target, '1.0.0')
  const peer = await preparedPeer(f.root, admitted.sha256, installed)
  closers.push(() => peer.close())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const value = String(url)
      expect([PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL]).toContain(value)
      return new Response(JSON.stringify(value === PLUGIN_LIST_URL ? v1 : v2))
    }),
  )
  const actual = await vi.importActual<
    typeof import('../src/main/plugins/lifecycle/settings-client')
  >('../src/main/plugins/lifecycle/settings-client')
  const connections: Awaited<ReturnType<typeof actual.connectPluginSettings>>[] = []
  seams.connect.mockImplementation(
    async (options: Parameters<typeof actual.connectPluginSettings>[0]) => {
      const c = await actual.connectPluginSettings({
        ...options,
        path: peer.path,
        personKey: peer.key,
      })
      vi.spyOn(c, 'install')
      if (c.update) vi.spyOn(c, 'update')
      connections.push(c)
      return c
    },
  )
  const controller = productionPluginController()
  closers.push(() => controller.close())
  const supervisor = {
    start: vi.fn(),
    ready: vi.fn(async () => true),
    holdsLease: () => false,
    stoppedCleanly: () => false,
    supports: () => true,
  }
  controller.start({
    root: f.root,
    workspaceRoot: f.workspace,
    resourcesRoot: join(f.parent, 'resources'),
    browserExecutable: join(f.parent, 'fictional-browser'),
    build: 'fictional-build',
    appVersion: '1.0.0',
    target: f.opts.target,
    supervisor: supervisor as unknown as PluginSupervisorAttachment,
  })
  expect(await controller.ready!()).toBe(true)
  return { f, peer, controller, connections }
}
it.each(['install', 'update'] as const)(
  'production %s and retry never send a raw or prepared mutation without disclosure',
  async (action) => {
    const f = await production(action === 'update'),
      call = ipcFor(f.controller),
      channel = vi.spyOn(PersonChannel.prototype, 'call')
    expect(await call({ kind: 'list' })).toMatchObject({ ok: true })
    await expect(
      (f.controller[action] as (id: string) => Promise<void>)('chrome'),
    ).rejects.toThrow()
    expect(await call({ kind: action, id: 'chrome' })).toMatchObject({ ok: false })
    expect(await call({ kind: 'retry', id: 'chrome' })).toMatchObject({ ok: true })
    for (const c of f.connections) {
      expect(c.install).not.toHaveBeenCalled()
      if (c.update) expect(c.update).not.toHaveBeenCalled()
    }
    expect(
      channel.mock.calls.filter(([value]) =>
        ['install', 'update', 'install-prepared', 'update-prepared'].includes(
          String((value as { kind?: string }).kind),
        ),
      ),
    ).toHaveLength(0)
    expect(
      f.peer.calls.filter((value) =>
        ['install', 'update', 'install-prepared', 'update-prepared'].includes(String(value.kind)),
      ),
    ).toHaveLength(0)
  },
)
