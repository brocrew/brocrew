import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginUiRpc } from '../src/main/plugins/ui/rpc'
import { PLUGIN_UI_CHANNEL } from '../src/shared/plugin-ui'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { cleanupLifecycleFixtures, fixture, projection } from './plugin-lifecycle-fixtures'
import { chromeUiFixture } from './chrome-ui-fixture'
const closers: Array<() => Promise<unknown> | void> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
describe.skipIf(process.platform === 'win32')('package configuration error continuity', () => {
  it('carries a real package failure through person-control and RPC without replaying the consumed attempt', async () => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const bridge = await servePersonPluginControl({ root: f.root, key: 'e'.repeat(64), controller: f.controller,
      read: async () => ({ packageView: { current: true } }) })
    closers.push(() => bridge.close())
    const client = await connectPluginSettings({ path: bridge.path, personKey: 'e'.repeat(64), root: f.root,
      target: f.opts.target, catalogue: f.opts.catalogue, projection: projection().sink, propose() {} })
    closers.push(() => client.close())
    const screen = await client.screen('chrome')
    const proposed = vi.fn()
    const rpc = new PluginUiRpc({ binding: screen.binding, schemas: chromeUiFixture().verified.manifest.ui!.methodSchemas,
      peer: screen.peer, current: () => screen.current(screen.binding), emit() {}, propose: proposed, now: () => 0 })
    closers.push(() => rpc.close())
    const fetch = vi.fn(async () => Response.json({ error: 'Fictional package disk is full.' }, { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    const packet = { channel: PLUGIN_UI_CHANNEL, requestId: 'error-1', method: 'proposeConfig',
      payload: { action: 'create-profile', profile: 'birch' }, configRevision: 0 }
    await expect(rpc.invoke(packet)).rejects.toThrow('Fictional package disk is full.')
    expect(proposed).not.toHaveBeenCalled()
    expect(await screen.peer.read({}, 0, screen.binding, new AbortController().signal)).toMatchObject({ configRevision: 1, packageView: { current: true } })
    await expect(rpc.invoke({ ...packet, requestId: 'stale-2' })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
