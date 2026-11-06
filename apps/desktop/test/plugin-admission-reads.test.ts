import { afterEach, expect, it, vi } from 'vitest'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  expect(() => read.guardIds.push('willow')).toThrow()
  expect(f.state.readWorkspaceAdmission(f.local.sink.workspaceId)).not.toBe(read)
  // Exercise the real public-view seam with a durable journal change during the decision.
  const attachments = f.controller.agentAttachments.bind(f.controller)
  vi.spyOn(f.controller, 'agentAttachments').mockImplementation((workspaceId) => {
    const views = attachments(workspaceId)
    f.state.requireUpdateReader()
    return views
  })
  expect(() => f.controller.agentScope(f.local.sink.workspaceId)).toThrow()
})

it.each(['admitted', 'screen', 'agentAttachments', 'agentScope'] as const)(
  '%s verifies one fresh journal snapshot and its head for a synchronous admission decision',
  async (operation) => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const installId = f.controller.screen(f.handle, 'chrome').installation.installId
    // Observer only: execute every real disk load, including its lock/bytes/seals/activation checks.
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
    // Scope preserves the public attachment-view seam and the final sequence-conflict check.
    expect(loads.mock.calls.length).toBeLessThanOrEqual(operation === 'agentScope' ? 5 : 2)
    expect(loads.mock.calls.length).toBeGreaterThan(0)
  },
)

it('a later current check reads the journal again and refuses changed bytes before publishing or calling', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  expect(view.current()).toBe(true)
  const guard = join(f.root, 'state/lifecycle-guard')
  const record = (await readdir(guard))
    .filter((name) => /^\d{8}\.json$/.test(name))
    .sort()
    .at(-1)!
  const path = join(guard, record)
  const original = await readFile(path)
  await writeFile(path, Buffer.from('{}'))
  try {
    expect(view.current()).toBe(false)
    expect(f.controller.admitted(f.handle, 'chrome', view.installation.installId)).toBe(false)
    expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
    expect(() => f.controller.screen(f.handle, 'chrome')).toThrow()
    expect(() => f.controller.agentScope(f.local.sink.workspaceId)).toThrow()
  } finally {
    await writeFile(path, original)
  }
  expect(view.current()).toBe(true)
})
