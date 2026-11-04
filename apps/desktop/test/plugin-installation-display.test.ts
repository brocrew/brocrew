import { afterEach, expect, it } from 'vitest'
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { cleanupLifecycleFixtures, fixture } from './plugin-lifecycle-fixtures'
afterEach(cleanupLifecycleFixtures)
it.skipIf(process.platform === 'win32')(
  'observes installed and removed selections without changing them or admitting consumers',
  async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const options = { root: join(f.root, 'state'), workspaceRoots: [f.workspace] }
    const before = f.state.inspect()
    expect(GlobalPluginState.observeInstallations(options)).toEqual({
      installed: ['chrome'],
      pending: null,
    })
    expect(f.state.inspect()).toEqual(before)
    await f.controller.uninstall(f.handle, 'chrome')
    expect(GlobalPluginState.observeInstallations(options)).toEqual({
      installed: [],
      pending: null,
    })
  },
)
it.skipIf(process.platform === 'win32')(
  'observes the committed selection while its ordinary writer lock is held',
  async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const options = { root: join(f.root, 'state'), workspaceRoots: [f.workspace] }
    await f.state.withExclusive(async () => {
      const before = await treeBytes(options.root)
      expect(GlobalPluginState.observeInstallations(options)).toEqual({
        installed: ['chrome'],
        pending: null,
      })
      expect(GlobalPluginState.readInstalledPackage(options, 'chrome')).not.toBeNull()
      expect(await treeBytes(options.root)).toEqual(before)
    })
    expect(f.state.inspect().guards.map((one) => one.pluginId)).toEqual(['chrome'])
  },
)
it.skipIf(process.platform === 'win32')(
  'missing display storage is never created or reclaimed',
  async () => {
    const f = await fixture()
    const before = await readdir(f.root)
    const options = { root: join(f.root, 'missing-state'), workspaceRoots: [f.workspace] }
    expect(GlobalPluginState.observeInstallations(options)).toEqual({
      installed: [],
      pending: null,
    })
    expect(GlobalPluginState.readInstalledPackage(options, 'chrome')).toBeNull()
    expect(await readdir(f.root)).toEqual(before)
  },
)

it.skipIf(process.platform === 'win32')(
  'observes selected bytes without recreating missing writer or operation databases',
  async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    f.state.close()
    const root = join(f.root, 'state')
    await unlink(join(root, 'writer-lock.sqlite'))
    await unlink(join(root, 'operations.sqlite'))
    const before = await treeBytes(root)
    const options = { root, workspaceRoots: [f.workspace] }
    expect(GlobalPluginState.observeInstallations(options)).toEqual({
      installed: ['chrome'],
      pending: null,
    })
    expect(GlobalPluginState.readInstalledPackage(options, 'chrome')).not.toBeNull()
    expect(await treeBytes(root)).toEqual(before)
    expect(await readdir(root)).not.toContain('writer-lock.sqlite')
    expect(await readdir(root)).not.toContain('operations.sqlite')
  },
)

async function treeBytes(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}
  async function visit(folder: string, prefix: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (entry.isDirectory()) {
        entries[name + '/'] = 'directory'
        await visit(join(folder, entry.name), name + '/')
      } else entries[name] = (await readFile(join(folder, entry.name))).toString('hex')
    }
  }
  await visit(root, '')
  return entries
}
it.skipIf(process.platform === 'win32').each(['created', 'prepared'] as const)(
  'a torn %s selection stays unknown without display repair; restoring its bytes preserves pending work',
  async (phase) => {
    const f = await fixture({
      fault(point) {
        if (phase === 'prepared' && point === 'ready') throw new Error('fictional interruption')
      },
    })
    if (phase === 'prepared') {
      f.failStop()
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
      expect(f.state.inspect().pending).not.toBeNull()
    }
    const options = { root: join(f.root, 'state'), workspaceRoots: [f.workspace] }
    const snapshot = join(options.root, 'installed-state.json')
    const selected = await readFile(snapshot)
    await writeFile(snapshot, '{"format":')
    const before = await treeBytes(options.root)
    expect(() => GlobalPluginState.observeInstallations(options)).toThrow()
    expect(GlobalPluginState.readInstalledPackage(options, 'chrome')).toBeNull()
    expect(await treeBytes(options.root)).toEqual(before)
    await writeFile(snapshot, selected)
    const owner = f.state.inspect()
    expect(owner.pending !== null).toBe(phase === 'prepared')
    expect(GlobalPluginState.observeInstallations(options)).toEqual({
      installed: [],
      pending: phase === 'prepared' ? 'chrome' : null,
    })
    expect(await readFile(snapshot)).toEqual(selected)
  },
)
