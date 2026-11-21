import { afterEach, expect, it } from 'vitest'
import {
  cleanupLifecycleFixtures,
  fixture,
  fixtureSettingsClient,
} from './plugin-lifecycle-fixtures'
import { GlobalPluginState } from '../src/main/plugins/state/store'

const closers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it('carries fresh owner evidence with cards without changing legacy card replies', async () => {
  const f = await fixture()
  const client = await fixtureSettingsClient(f, closers, async () => null)
  for (const installed of [false, true, false]) {
    const display = await client.displayCatalogue!()
    expect(display.evidence).toEqual(
      GlobalPluginState.observeInstallations({
        root: `${f.root}/state`,
        workspaceRoots: [f.workspace],
      }),
    )
    expect(display.evidence).toEqual({ installed: installed ? ['chrome'] : [], pending: null })
    expect(display.cards).toEqual(await client.catalogue())
    if (!installed) await f.controller.install(f.handle, 'chrome')
    else await f.controller.uninstall(f.handle, 'chrome')
  }
})

it('keeps the last admitted installation separate from a failed pending first install', async () => {
  const f = await fixture({
    fault(point) {
      if (point === 'ready') throw new Error('fictional readiness failure')
    },
  })
  f.failStop()
  await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
  const client = await fixtureSettingsClient(f, closers, async () => null)
  const display = await client.displayCatalogue!()
  expect(display.cards).toMatchObject([{ installed: false, state: 'Unavailable' }])
  expect(display.evidence).toEqual({ installed: [], pending: 'chrome' })
})
