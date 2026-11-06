import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
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
  const workspace = (
    f.controller as unknown as { workspaces: Map<unknown, { receipts: Map<string, unknown> }> }
  ).workspaces.get(f.handle)!
  const receipt = workspace.receipts.get('chrome')
  workspace.receipts.delete('chrome')
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'pending' }])
  workspace.receipts.set('chrome', receipt)
  await f.controller.uninstall(f.handle, 'chrome')
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'off' }])
})

it('an unresolved journal operation makes scope unreadable rather than claiming plugins are off', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const before = f.state.inspect()
  const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const operationId = randomUUID()
  f.state.prepare({
    operationId,
    consent: {
      action: 'install',
      pluginId: 'willow',
      at: 1000,
      expectedSequence: before.sequence,
      expectedInstallId: null,
      release: view.installation.release,
    },
    snapshot: null,
  })
  try {
    expect(f.state.inspect().pending).not.toBeNull()
    expect(view.current()).toBe(false)
    expect(() => f.controller.agentScope(f.local.sink.workspaceId)).toThrow()
  } finally {
    f.state.abort(operationId)
  }
  expect(
    f.controller
      .agentScope(f.local.sink.workspaceId)
      .entries.find((one) => one.pluginId === 'chrome'),
  ).toMatchObject({ pluginId: 'chrome', is: 'admitted' })
  expect(view.current()).toBe(true)
})
