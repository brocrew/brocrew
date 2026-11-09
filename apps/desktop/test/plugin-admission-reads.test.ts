import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

it('returns detached frozen data and preserves the final scope sequence conflict check', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const read = f.state.readWorkspaceAdmission()
  expect(Object.isFrozen(read)).toBe(true)
  expect(Object.isFrozen(read.installations[0])).toBe(true)
  expect(Object.isFrozen(read.installations[0]!.release)).toBe(true)
  expect(() => (read.guardIds as string[]).push('willow')).toThrow()
  expect(f.state.readWorkspaceAdmission()).not.toBe(read)
  // Real view construction invokes readiness synchronously; mutate durable state there.
  const run = (
    f.controller as unknown as { runs: Map<string, { run: { ready(): unknown } }> }
  ).runs.get('chrome')!.run
  const ready = run.ready.bind(run)
  vi.spyOn(run, 'ready').mockImplementation(() => {
    const view = ready()
    f.state.requireUpdateReader()
    return view
  })
  expect(() => f.controller.agentScope(f.local.sink.workspaceId)).toThrow()
})

it.each(['admitted', 'screen', 'agentAttachments', 'agentScope'] as const)(
  '%s takes one state snapshot for a synchronous admission decision',
  async (operation) => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const installId = f.controller.screen(f.handle, 'chrome').installation.installId
    const disk = (f.state as unknown as { disk: { loadForAdmission(): unknown } }).disk
    const loads = vi.spyOn(disk, 'loadForAdmission')
    if (operation === 'admitted')
      expect(f.controller.admitted(f.handle, 'chrome', installId)).toBe(true)
    if (operation === 'screen')
      expect(f.controller.screen(f.handle, 'chrome').installation.installId).toBe(installId)
    if (operation === 'agentAttachments')
      expect(
        f.controller
          .agentAttachments(f.local.sink.workspaceId)
          .map((one) => one.installation.pluginId),
      ).toEqual(['chrome'])
    if (operation === 'agentScope')
      expect(
        f.controller
          .agentScope(f.local.sink.workspaceId)
          .entries.map((one) => [one.pluginId, one.is]),
      ).toEqual([['chrome', 'admitted']])
    // Every synchronous operation, including scope view construction, asks at most twice.
    expect(loads.mock.calls.length).toBeLessThanOrEqual(2)
    expect(loads.mock.calls.length).toBeGreaterThan(0)
  },
)

it('rejects asynchronous admission computations instead of carrying snapshot authority across await', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  expect(() =>
    // @ts-expect-error admission computations must be synchronous
    f.state.withWorkspaceAdmission(async (read) => read),
  ).toThrow()
})

it('refuses a reentrant journal append after the admission snapshot is built', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  expect(() =>
    f.state.withWorkspaceAdmission((read) => {
      f.state.requireUpdateReader()
      return read
    }),
  ).toThrow()
})

it('shares fresh admission only within a synchronous route plan and revokes its checker afterwards', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const disk = (f.state as unknown as { disk: { loadForAdmission(): unknown } }).disk
  const loads = vi.spyOn(disk, 'loadForAdmission')
  let retained!: (one: typeof view) => boolean
  f.controller.withAgentScope(f.local.sink.workspaceId, (scope, current) => {
    retained = current
    expect(scope.entries[0]!.is).toBe('admitted')
    expect(current(view)).toBe(true)
    expect(current(view)).toBe(true)
    // A mutation's block on the plugin is seen by the checker within the same plan.
    const blocks = (f.controller as unknown as { blocks: Map<string, symbol> }).blocks
    blocks.set('chrome', Symbol())
    expect(current(view)).toBe(false)
    blocks.delete('chrome')
    expect(current(view)).toBe(true)
  })
  expect(loads).toHaveBeenCalledTimes(2)
  expect(retained(view)).toBe(false)
  expect(view.current()).toBe(true)
  expect(loads).toHaveBeenCalledTimes(4)
})
