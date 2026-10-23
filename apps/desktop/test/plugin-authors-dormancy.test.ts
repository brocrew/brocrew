import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { loadRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { PLUGIN_LIST_V2_URL } from '../src/main/plugins/catalogue/download'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'

async function tree(root: string) {
  const hash = createHash('sha256')
  async function visit(path: string, name: string) {
    const stat = await lstat(path)
    hash.update(name + ':' + stat.mode + ':' + stat.ino + ':' + stat.size)
    if (stat.isDirectory()) {
      for (const child of (await readdir(path)).sort())
        await visit(join(path, child), name + '/' + child)
    } else if (stat.isFile()) hash.update(await readFile(path))
  }
  await visit(root, '')
  return hash.digest('hex')
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
describe('author verification stays dormant before v2 publication', () => {
  it('keeps a live v1 owner, its cards and raw install/update working when the fixed v2 source is 404', async () => {
    const f = await fixture()
    const next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.1' } })
    f.opts.download = async (release) =>
      release.version === next.release.version ? next.archive : f.pkg.archive
    f.opts.refreshCatalogue = async () => ({
      catalogue: { bytes: next.bytes, signature: next.signature },
      names: f.opts.names,
    })
    const key = randomBytes(32).toString('hex')
    const bridge = await servePersonPluginControl({
      root: f.root,
      key,
      controller: sharedLifecycleWorkspaces(f.controller),
      read: async () => null,
    })
    const client = await connectPluginSettings({
      path: bridge.path,
      personKey: key,
      root: f.root,
      pinnedPublicKey: f.opts.pinnedPublicKey,
      target: f.opts.target,
      catalogue: f.opts.catalogue,
      projection: projection().sink,
      propose() {},
    })
    try {
      const cards = await client.catalogue()
      const before = { state: f.state.inspect(), events: [...f.events], tree: await tree(f.root) }
      const fetch = vi.fn(async (url: unknown) => {
        expect(String(url)).toBe(PLUGIN_LIST_V2_URL)
        return new Response('', { status: 404 })
      })
      vi.stubGlobal('fetch', fetch)
      await expect(
        loadRepoPluginList({
          root: f.root,
          target: f.opts.target,
          appVersion: '1.0.0',
          sourceVersion: 2,
        }),
      ).rejects.toMatchObject({ state: 'not-published' })
      expect(fetch).toHaveBeenCalledOnce()
      expect(await client.catalogue()).toEqual(cards)
      expect({ state: f.state.inspect(), events: [...f.events], tree: await tree(f.root) }).toEqual(
        before,
      )
      // Same wire path as today's Settings. No new policy or failure state is introduced.
      await client.install('chrome')
      expect((await client.catalogue())[0]).toMatchObject({
        state: 'Running',
        installed: true,
        installedVersion: '1.0.0',
      })
      await client.refreshCatalogue!(pluginSha256(next.bytes))
      await client.update!('chrome')
      expect((await client.catalogue())[0]).toMatchObject({
        state: 'Running',
        installed: true,
        installedVersion: '1.0.1',
      })
      expect(f.state.inspect().pending).toBeNull()
      expect(f.starts()).toBe(2)
    } finally {
      await client.close()
      await bridge.close()
    }
  })
})
