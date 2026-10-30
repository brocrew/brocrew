import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isInsideCheckedRoot, keepPluginRootPrivate } from '../src/main/plugins/private-files'
import { windowsAccessLists, keepToThisUser } from '../src/main/recovery/windows-privacy'
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
  'plugin root permission failures are best effort',
  () => {
    it('still refuses a junction and a folder replaced during tightening', async () => {
      const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'fictional-plugin-path-')))
      roots.push(parent)
      const target = join(parent, 'target'),
        link = join(parent, 'link'),
        root = join(parent, 'plugins')
      mkdirSync(target)
      symlinkSync(target, link, 'junction')
      await expect(keepPluginRootPrivate(link)).rejects.toThrow('unsafe-path')
      await expect(
        keepPluginRootPrivate(root, {
          lists: {
            ...windowsAccessLists,
            userSid: async () => 'S-1-5-21-1-2-3-1001',
            restrict: async () => {
              renameSync(root, join(parent, 'previous'))
              mkdirSync(root)
            },
          },
        }),
      ).rejects.toThrow('unsafe-path')
      expect(isInsideCheckedRoot(root)).toBe(false)
    })
    it.each([
      'inherited new',
      'inherited existing',
      'write failure',
      'owner read failure',
      'ACL read failure',
      'foreign owner',
      'user SID failure',
    ])(
      'lists and starts a verified plugin with %s, preserving parent and workspace ACLs',
      async (condition) => {
        const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'fictional-plugin-acl-')))
        roots.push(parent)
        await keepToThisUser(parent)
        // Same read/execute shape as CodexSandboxUsers; use the stable Users SID so this test does
        // not create a machine account/group or depend on Codex being installed on the runner.
        execFileSync(
          join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe'),
          [parent, '/grant:r', '*S-1-5-32-545:(OI)(CI)RX', '/Q'],
          { windowsHide: true },
        )
        const root = join(parent, 'plugins'),
          workspace = join(parent, 'workspace')
        mkdirSync(workspace)
        if (condition !== 'inherited new') mkdirSync(root)
        const read = windowsAccessLists.read.bind(windowsAccessLists)
        const parentBefore = await read(parent),
          workspaceBefore = await read(workspace)
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const owner = vi.spyOn(windowsAccessLists, 'ownerSid')
        const acl = vi.spyOn(windowsAccessLists, 'read')
        const restrict = vi.spyOn(windowsAccessLists, 'restrict')
        if (condition === 'write failure')
          restrict.mockRejectedValue(new Error('fictional ACL write failure'))
        if (condition === 'owner read failure')
          owner.mockRejectedValue(new Error('fictional owner read failure'))
        if (condition === 'ACL read failure')
          acl.mockRejectedValue(new Error('fictional ACL read failure'))
        if (condition === 'foreign owner') owner.mockResolvedValue('S-1-5-32-545')
        if (condition === 'user SID failure')
          vi.spyOn(windowsAccessLists, 'userSid').mockRejectedValue(
            new Error('fictional SID failure'),
          )
        await keepPluginRootPrivate(root)
        await keepPluginRootPrivate(root)
        expect(owner).not.toHaveBeenCalled()
        expect(acl).not.toHaveBeenCalled()
        if (condition === 'user SID failure') expect(restrict).not.toHaveBeenCalled()
        else {
          expect(restrict).toHaveBeenCalledOnce()
          expect(restrict.mock.calls[0]![0]).toBe(root)
        }
        expect(warning).toHaveBeenCalledTimes(
          ['write failure', 'user SID failure'].includes(condition) ? 1 : 0,
        )
        if (warning.mock.calls.length)
          expect(warning.mock.calls[0]).toEqual([
            'Could not tighten plugin folder permissions; continuing.',
          ])
        // The installer consumes the admitted root while the permission fault seams remain active.
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
        expect(owner).not.toHaveBeenCalled()
        expect(acl).not.toHaveBeenCalled()
        expect(restrict.mock.calls.every(([folder]) => folder === root)).toBe(true)
        vi.restoreAllMocks()
        expect(await read(parent)).toBe(parentBefore)
        expect(await read(workspace)).toBe(workspaceBefore)
      },
      60_000,
    )
  },
)
