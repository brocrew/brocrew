import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

it('compares every canonical receipt field and does not retain a prior admission decision', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const workspaces = (
    f.controller as unknown as {
      workspaces: Map<unknown, { receipts: Map<string, unknown> }>
    }
  ).workspaces
  const receipts = workspaces.get(f.handle)!.receipts
  const original = receipts.get('chrome') as Record<string, unknown>
  const changes: Record<string, unknown> = {
    format: 2,
    rootId: randomUUID(),
    workspaceId: randomUUID(),
    epoch: randomUUID(),
    pluginId: 'willow',
    installId: randomUUID(),
    incarnation: randomUUID(),
    lifecycleSequence: Number(original.lifecycleSequence) + 1,
    releaseRevision: Number(original.releaseRevision) + 1,
    configRevision: Number(original.configRevision) + 1,
    skills: ['unexpected'],
    bindings: ['unexpected'],
  }
  for (const [field, value] of Object.entries(changes)) {
    receipts.set('chrome', { ...original, [field]: value })
    expect(view.current(), field).toBe(false)
    expect(f.controller.agentAttachments(f.local.sink.workspaceId), field).toEqual([])
    receipts.set('chrome', original)
    expect(view.current(), field).toBe(true)
  }
})

it('returns detached frozen data and preserves the final scope sequence conflict check', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const read = f.state.readWorkspaceAdmission(f.local.sink.workspaceId)
  expect(Object.isFrozen(read)).toBe(true)
  expect(Object.isFrozen(read.installations[0])).toBe(true)
  expect(Object.isFrozen(read.receipts[0]!.skills)).toBe(true)
  expect(() => (read.guardIds as string[]).push('willow')).toThrow()
  expect(f.state.readWorkspaceAdmission(f.local.sink.workspaceId)).not.toBe(read)
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
    const disk = (f.state as unknown as { disk: { load(...args: unknown[]): unknown } }).disk
    const loads = vi.spyOn(disk, 'load')
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
    f.state.withWorkspaceAdmission(f.local.sink.workspaceId, async (read) => read),
  ).toThrow()
})

it('refuses a reentrant journal append after the admission snapshot is built', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  expect(() =>
    f.state.withWorkspaceAdmission(f.local.sink.workspaceId, (read) => {
      f.state.requireUpdateReader()
      return read
    }),
  ).toThrow()
})

it('shares fresh admission only within a synchronous route plan and revokes its checker afterwards', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const disk = (f.state as unknown as { disk: { load(): unknown } }).disk
  const loads = vi.spyOn(disk, 'load')
  let retained!: (one: typeof view) => boolean
  f.controller.withAgentScope(f.local.sink.workspaceId, (scope, current) => {
    retained = current
    expect(scope.entries[0]!.is).toBe('admitted')
    expect(current(view)).toBe(true)
    expect(current(view)).toBe(true)
    const workspaces = (
      f.controller as unknown as {
        workspaces: Map<unknown, { receipts: Map<string, unknown> }>
      }
    ).workspaces
    const receipts = workspaces.get(f.handle)!.receipts
    const original = receipts.get('chrome')
    receipts.delete('chrome')
    expect(current(view)).toBe(false)
    receipts.set('chrome', original)
    expect(current(view)).toBe(true)
  })
  expect(loads).toHaveBeenCalledTimes(2)
  expect(retained(view)).toBe(false)
  expect(view.current()).toBe(true)
  expect(loads).toHaveBeenCalledTimes(4)
})
