import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

it('only committed absence is off; an installed plugin missing its projection is pending', async () => {
  const f = await fixture()
  const scope = () => f.controller.agentScope(f.local.sink.workspaceId).entries
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'off' }])
  await f.controller.install(f.handle, 'chrome')
  expect(scope()).toMatchObject([{ pluginId: 'chrome', is: 'admitted' }])
  const hidden = vi.spyOn(f.controller, 'agentAttachments').mockReturnValue([])
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'pending' }])
  hidden.mockRestore()
  await f.controller.uninstall(f.handle, 'chrome')
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'off' }])
})

it('an unresolved journal operation makes scope unreadable rather than claiming plugins are off', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const before = f.state.inspect()
  const blocked = vi.spyOn(f.state, 'inspect').mockReturnValue({
    ...before,
    pending: {} as NonNullable<typeof before.pending>,
  })
  expect(() => f.controller.agentScope(f.local.sink.workspaceId)).toThrow()
  blocked.mockRestore()
  expect(f.controller.agentScope(f.local.sink.workspaceId).entries).toMatchObject([
    { pluginId: 'chrome', is: 'admitted' },
  ])
})
