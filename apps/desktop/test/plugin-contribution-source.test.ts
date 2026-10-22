import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import { productionPluginController } from '../src/main/plugins/production'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'
import { PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL } from '../src/main/plugins/catalogue/download'

const seams = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn((options: unknown) => {
    void options
    return async () => {}
  }),
}))
vi.mock('../src/main/plugins/lifecycle/settings-client', () => ({
  connectPluginSettings: seams.connect,
}))
vi.mock('../src/main/plugins/supervisor/launcher', () => ({
  createPluginSupervisorLauncher: seams.launch,
}))
const closed: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of closed.splice(0)) await close()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  await cleanupLifecycleFixtures()
})
describe.skipIf(process.platform === 'win32')(
  'source selection from negotiated owner support',
  () => {
    async function setup(modern: boolean) {
      const f = await fixture()
      const frozen = repoListFor(f.pkg.release)
      const expanded = {
        format: 2,
        entries: [
          { ...frozen.entries[0]!, legacy: true },
          { ...frozen.entries[0]!, id: 'fictional-pointers', authors: ['brocrew'] },
        ],
      }
      const fetch = vi.fn(async (url: Parameters<typeof globalThis.fetch>[0]) => {
        expect([PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL]).toContain(String(url))
        return Response.json(String(url) === PLUGIN_LIST_URL ? frozen : expanded)
      })
      vi.stubGlobal('fetch', fetch)
      seams.connect.mockResolvedValue({
        catalogue: async () =>
          (modern ? expanded.entries : frozen.entries).map((entry) => ({
            id: entry.id,
            name: entry.name,
            state: 'Available',
            installed: false,
          })),
        close: async () => {},
      })
      const controller = productionPluginController()
      closed.push(() => controller.close())
      controller.start({
        root: f.root,
        workspaceRoot: f.workspace,
        resourcesRoot: f.parent,
        build: 'fictional-build',
        appVersion: '1.0.0',
        target: f.opts.target,
        supervisor: {
          start() {},
          ready: async () => true,
          holdsLease: () => false,
          stoppedCleanly: () => false,
          supports: () => modern,
        } as unknown as PluginSupervisorAttachment,
      })
      await controller.ready!()
      return { controller, fetch, frozen }
    }
    it('selects v2 for a capable owner and binds the unchanged v1 raw list into a fresh owner plan', async () => {
      const f = await setup(true)
      expect((await f.controller.catalogue()).map((entry) => entry.id)).toEqual([
        'chrome',
        'fictional-pointers',
      ])
      expect(f.fetch.mock.calls.map(([url]) => String(url))).toContain(PLUGIN_LIST_V2_URL)
      const launch = seams.launch.mock.calls[0]![0] as unknown as {
        lifecycleForNewOwner(): Promise<{
          sourceVersion: number
          legacyRepoList: { path: string; sha256: string }
        }>
      }
      expect(typeof launch.lifecycleForNewOwner).toBe('function')
      const plan = await launch.lifecycleForNewOwner()
      expect(plan.sourceVersion).toBe(2)
      expect(await readFile(plan.legacyRepoList.path)).toEqual(
        Buffer.from(JSON.stringify(f.frozen)),
      )
    })
    it('keeps a live older owner on the v1 surface without fetching or sending new metadata', async () => {
      const f = await setup(false)
      expect((await f.controller.catalogue()).map((entry) => entry.id)).toEqual(['chrome'])
      expect(f.fetch.mock.calls.map(([url]) => String(url))).toEqual([PLUGIN_LIST_URL])
    })
  },
)
