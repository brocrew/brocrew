import { afterEach, expect, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import type { PluginCard } from '../src/shared/plugin-settings'
import type { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'
import { PLUGIN_LIST_URL } from '../src/main/plugins/catalogue/download'
vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const seams = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn((options: unknown) => {
    void options
    return Object.assign(async () => {}, { diagnostic: () => undefined })
  }),
}))
vi.mock('../src/main/plugins/lifecycle/settings-client', () => ({
  connectPluginSettings: seams.connect,
}))
vi.mock('../src/main/plugins/supervisor/launcher', () => ({
  createPluginSupervisorLauncher: seams.launch,
}))
export { seams }
import { productionPluginController } from '../src/main/plugins/production'
import { registerPluginSettings } from '../src/main/plugins/settings'
const roots: string[] = []
const controllers: ReturnType<typeof productionPluginController>[] = []
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.close()
  await cleanupLifecycleFixtures()
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
export async function setup(pkg = packageFixture()) {
  const parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-production-')),
  )
  roots.push(parent)
  const workspaceRoot = join(parent, 'workspace')
  await mkdir(workspaceRoot, { mode: 0o700 })
  const fetch = vi.fn(async (url) => {
    expect(String(url)).toBe(PLUGIN_LIST_URL)
    return new Response(JSON.stringify(repoListFor(pkg.release)))
  })
  // Install the inert transport before construction, so an eager-start regression cannot fetch.
  vi.stubGlobal('fetch', fetch)
  const controller = productionPluginController()
  controllers.push(controller)
  const peer = {
    catalogue: vi.fn(async (): Promise<PluginCard[]> => [
      {
        id: pkg.release.id,
        name: pkg.release.id,
        installed: false,
        state: 'Available' as const,
      },
    ]),
    refreshCatalogue: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    screen: vi.fn(),
    close: vi.fn(async () => {}),
  }
  seams.connect.mockResolvedValue(peer)
  const supervisor = {
    start: vi.fn(),
    ready: vi.fn(async () => true),
    stoppedCleanly: vi.fn(() => false),
    holdsLease: vi.fn(() => false),
  }
  const options = {
    root: join(parent, 'global'),
    workspaceRoot,
    resourcesRoot: join(parent, 'resources'),
    build: 'fictional-build',
    appVersion: '0.0.0',
    target: { os: 'linux', cpu: 'x64' } as const,
    supervisor: supervisor as unknown as PluginSupervisorAttachment,
  }
  return { controller, options, peer, supervisor, fetch, pkg }
}

export function settingsCall(controller: ReturnType<typeof productionPluginController>) {
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1180, height: 900 }),
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
  })
  const ipc = { handle: vi.fn() }
  registerPluginSettings(ipc, () => owner as never, controller)
  return (input: unknown) =>
    ipc.handle.mock.calls[0]![1](
      { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
      input,
    )
}
