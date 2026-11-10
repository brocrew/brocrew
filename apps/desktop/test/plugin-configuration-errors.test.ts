import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginUiRpc } from '../src/main/plugins/ui/rpc'
import { PLUGIN_UI_CHANNEL } from '../src/shared/plugin-ui'
import {
  cleanupLifecycleFixtures,
  fixture,
  fixtureSettingsClient,
} from './plugin-lifecycle-fixtures'
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
    const client = await fixtureSettingsClient(f, closers, async () => ({
      packageView: { current: true },
    }))
    const screen = await client.screen('chrome')
    const proposed = vi.fn()
    const rpc = new PluginUiRpc({
      binding: screen.binding,
      schemas: chromeUiFixture().verified.manifest.ui!.methodSchemas,
      peer: screen.peer,
      current: () => screen.current(screen.binding),
      emit() {},
      propose: proposed,
      now: () => 0,
    })
    closers.push(() => rpc.close())
    const fetch = vi.fn(async () =>
      Response.json({ error: 'Fictional package disk is full.' }, { status: 500 }),
    )
    vi.stubGlobal('fetch', fetch)
    const packet = {
      channel: PLUGIN_UI_CHANNEL,
      requestId: 'error-1',
      method: 'proposeConfig',
      payload: { action: 'create-profile', profile: 'birch' },
      configRevision: 0,
    }
    await expect(rpc.invoke(packet)).rejects.toThrow('Fictional package disk is full.')
    expect(proposed).not.toHaveBeenCalled()
    expect(
      await screen.peer.read({}, 0, screen.binding, new AbortController().signal),
    ).toMatchObject({ configRevision: 1, packageView: { current: true } })
    await expect(rpc.invoke({ ...packet, requestId: 'stale-2' })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
