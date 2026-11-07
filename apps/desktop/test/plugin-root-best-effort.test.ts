import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { manifestFor, packageFixture, fictionalPublicKey } from './plugin-package-fixtures'
import { projection } from './plugin-lifecycle-fixtures'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

// Real Windows folders, state, catalogue verification, staging and lifecycle admission. Only the
// runtime process is inert; it records the start that must still follow a permission failure.
describe.runIf(process.platform === 'win32')(
  'plugin startup uses ordinary folders without admission',
  () => {
    it.each([false, true])('lists and starts a verified plugin with an existing root=%s', async (existing) => {
        const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'fictional-plugin-folders-')))
        roots.push(parent)
        const root = join(parent, 'plugins'), workspace = join(parent, 'workspace')
        mkdirSync(workspace)
        if (existing) mkdirSync(root)
        const state = GlobalPluginState.create({
          root: join(root, 'state'),
          workspaceRoots: [workspace],
        })
        const manifest = manifestFor()
        manifest.id = 'chrome'
        manifest.skills = []
        manifest.platforms = [{ os: 'win32', cpu: 'x64' }]
        const pkg = packageFixture({ manifest })
        const start = vi.fn(async () => ({
          runId: randomUUID(),
          exited: new Promise<void>(() => {}),
          ready: async () => ({
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
            admin: () => ({ url: '', headers: { Authorization: '' } }),
          }),
          stop: async () => {},
        }))
        try {
          const controller = await PluginLifecycleController.open({
            root,
            state,
            pinnedPublicKey: fictionalPublicKey,
            target: manifest.platforms[0]!,
            catalogue: { bytes: pkg.bytes, signature: pkg.signature },
            names: { chrome: 'Chrome' },
            deny() {},
            download: async () => pkg.archive,
            runtime: { previousOwnerClean: async () => true, removeCode: async () => {}, start },
          })
          const local = projection(),
            handle = await controller.attach(local.sink)
          expect((await controller.status()).cards).toMatchObject([
            { id: 'chrome', state: 'Available' },
          ])
          await controller.install(handle, 'chrome')
          expect(start).toHaveBeenCalledOnce()
          expect((await controller.status()).cards).toMatchObject([
            { id: 'chrome', state: 'Running', installed: true },
          ])
          await controller.uninstall(handle, 'chrome')
          await controller.detach(handle)
        } finally {
          state.close()
        }
      },
      60_000,
    )
  },
)
