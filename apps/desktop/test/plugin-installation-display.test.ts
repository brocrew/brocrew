import { afterEach, expect, it } from 'vitest'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { cleanupLifecycleFixtures, fixture } from './plugin-lifecycle-fixtures'
afterEach(cleanupLifecycleFixtures)
it.skipIf(process.platform === 'win32')(
  'observes installed and removed journal data without changing it or admitting consumers',
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
  'busy storage refuses display observation rather than guessing absence',
  async () => {
    const f = await fixture()
    await f.state.withExclusive(async () => {
      expect(() =>
        GlobalPluginState.observeInstallations({
          root: join(f.root, 'state'),
          workspaceRoots: [f.workspace],
        }),
      ).toThrow()
    })
    expect(f.state.inspect().guards).toEqual([])
  },
)
it.skipIf(process.platform === 'win32')(
  'missing display storage is never created or reclaimed',
  async () => {
    const f = await fixture()
    const before = await readdir(f.root)
    expect(() =>
      GlobalPluginState.observeInstallations({
        root: join(f.root, 'missing-state'),
        workspaceRoots: [f.workspace],
      }),
    ).toThrow()
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
    expect(() =>
      GlobalPluginState.observeInstallations({ root, workspaceRoots: [f.workspace] }),
    ).toThrow()
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
  'display refuses a missing %s seal without changing any state names or bytes; owner still repairs',
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
    const guard = join(options.root, 'lifecycle-guard')
    const seal = (await readdir(guard))
      .filter((name) => name.endsWith('.seal'))
      .sort()
      .at(-1)!
    await unlink(join(guard, seal)) // An interrupted publication in this fictional scratch tree.
    const before = await treeBytes(options.root)
    let refused = false
    try {
      GlobalPluginState.observeInstallations(options)
    } catch {
      refused = true
    }
    // Assert the tree first: base repairs the seal even though this was only a display read.
    expect(await treeBytes(options.root)).toEqual(before)
    expect(refused).toBe(true)
    const owner = f.state.inspect() // Existing owner load keeps its recovery behavior.
    expect(await readdir(guard)).toContain(seal)
    expect(owner.pending !== null).toBe(phase === 'prepared')
    expect(GlobalPluginState.observeInstallations(options)).toEqual({
      installed: [],
      pending: phase === 'prepared' ? 'chrome' : null,
    })
  },
)
