import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { settingsPeer, disclosureTree } from './plugin-disclosure-fixtures'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { loadRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { PLUGIN_LIST_V2_URL } from '../src/main/plugins/catalogue/download'
import { pluginSha256 } from '../src/main/plugins/package-digests'
const fake = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: fake.open }))
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
it('v2 HTTP404 leaves the real v1 Settings install, update, Configure and UI reply unchanged', async () => {
  const f = await fixture(),
    next = packageFixture({ manifest: { ...f.pkg.manifest, version: '1.0.1' } })
  f.opts.download = async (entry) =>
    entry.version === next.release.version ? next.archive : f.pkg.archive
  f.opts.refreshCatalogue = async () => ({
    catalogue: { bytes: next.bytes, signature: next.signature },
    names: f.opts.names,
  })
  const key = randomBytes(32).toString('hex'),
    bridge = await servePersonPluginControl({
      root: f.root,
      key,
      controller: sharedLifecycleWorkspaces(f.controller),
      read: async () => null,
    })
  const download = vi.fn(),
    input = {
      root: f.root,
      path: bridge.path,
      personKey: key,
      pinnedPublicKey: f.opts.pinnedPublicKey,
      target: f.opts.target,
      catalogue: f.opts.catalogue,
      projection: projection().sink,
      propose() {},
      download,
    }
  const c = await connectPluginSettings(input),
    p = settingsPeer(c)
  const contents = Object.assign(new EventEmitter(), {}),
    close = vi.fn(async () => {})
  fake.open.mockResolvedValue({ view: { webContents: contents, setBounds: vi.fn() }, close })
  try {
    const beforeReply = await p.call({ kind: 'list' })
    const before = {
      state: structuredClone(f.state.inspect()),
      tree: await disclosureTree(f.root),
      events: [...f.events],
      starts: f.starts(),
    }
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
    expect(await p.call({ kind: 'list' })).toEqual(beforeReply)
    expect({
      state: structuredClone(f.state.inspect()),
      tree: await disclosureTree(f.root),
      events: [...f.events],
      starts: f.starts(),
    }).toEqual(before)
    expect(await p.call({ kind: 'install', id: 'chrome' })).toMatchObject({
      ok: true,
      cards: [{ installed: true, installedVersion: '1.0.0' }],
    })
    expect(
      await p.call({
        kind: 'configure',
        id: 'chrome',
        screenId: '00000000-0000-4000-8000-000000000001',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
    ).toEqual({ ok: true })
    expect(fake.open).toHaveBeenCalledOnce()
    await c.refreshCatalogue!(pluginSha256(next.bytes))
    expect(await p.call({ kind: 'update', id: 'chrome' })).toMatchObject({
      ok: true,
      cards: [{ installed: true, installedVersion: '1.0.1' }],
    })
    expect(download).not.toHaveBeenCalled()
    expect(f.state.inspect().pending).toBeNull()
  } finally {
    await p.call({ kind: 'close' })
    await c.close()
    await bridge.close()
  }
})
