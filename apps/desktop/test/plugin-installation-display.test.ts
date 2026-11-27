import { afterEach, expect, it } from 'vitest'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { observeInstallations } from '../src/main/plugins/state/observe-committed'
import { cleanupLifecycleFixtures, fixture } from './plugin-lifecycle-fixtures'
afterEach(cleanupLifecycleFixtures)
it.skipIf(process.platform === 'win32')(
  'observes installed and removed state without changing it or admitting consumers',
  async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const options = { root: join(f.root, 'state'), workspaceRoots: [f.workspace] }
    const before = f.state.inspect()
    expect(await observeInstallations(options)).toEqual({
      installed: ['chrome'],
      pending: null,
    })
    expect(f.state.inspect()).toEqual(before)
    await f.controller.uninstall(f.handle, 'chrome')
    expect(await observeInstallations(options)).toEqual({
      installed: [],
      pending: null,
    })
  },
)
it.skipIf(process.platform === 'win32')(
  'missing display storage is never created or reclaimed',
  async () => {
    const f = await fixture()
    const before = await readdir(f.root)
    expect(
      await observeInstallations({
        root: join(f.root, 'missing-state'),
        workspaceRoots: [f.workspace],
      }),
    ).toBeNull()
    expect(await readdir(f.root)).toEqual(before)
  },
)

it.skipIf(process.platform === 'win32')(
  'a missing writer fence is never recreated for display',
  async () => {
    const f = await fixture()
    f.state.close()
    const root = join(f.root, 'state')
    await unlink(join(root, 'writer-lock.sqlite'))
    expect(await observeInstallations({ root, workspaceRoots: [f.workspace] })).toEqual({
      installed: [],
      pending: null,
    })
    expect(await readdir(root)).not.toContain('writer-lock.sqlite')
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
  'display of %s state changes no state names or bytes, and the owner reopens it as it was',
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
    const before = await treeBytes(options.root)
    expect(await observeInstallations(options)).toEqual({
      installed: [],
      pending: phase === 'prepared' ? 'chrome' : null,
    })
    expect(await treeBytes(options.root)).toEqual(before)
    f.state.close()
    const reopened = GlobalPluginState.open(options)
    expect(reopened.inspect().pending !== null).toBe(phase === 'prepared')
    reopened.close()
  },
)
