import { afterEach, expect, it, vi } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as format from '../src/main/plugins/state/format'
import * as machine from '../src/main/plugins/state/machine'
import type { GlobalPluginState } from '../src/main/plugins/state/store'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

// The plugin service is the journal's only writer while it holds its owner lock, so it reads the
// state once and again only after it changes the journal itself. With a long history, a read per
// admission made plugin tools late for an agent's first message.

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
const diskOf = (state: GlobalPluginState) => (state as unknown as { disk: PluginStateDisk }).disk
const readsOf = (disk: PluginStateDisk) =>
  vi.spyOn(disk as unknown as { loadLocked(...args: unknown[]): unknown }, 'loadLocked')
async function installed() {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const disk = diskOf(f.state)
  disk.load()
  return { ...f, disk }
}

it('reads the journal once for many admissions', async () => {
  const f = await installed()
  // The first admission reads the current activation snapshot once, beside the held state.
  f.state.readWorkspaceAdmission()
  const reads = readsOf(f.disk),
    decode = vi.spyOn(format, 'decodeState'),
    fold = vi.spyOn(machine, 'foldRecord')
  for (let i = 0; i < 20; i++) {
    expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toHaveLength(1)
    f.state.readWorkspaceAdmission()
  }
  expect(reads).not.toHaveBeenCalled()
  expect(decode).not.toHaveBeenCalled()
  expect(fold).not.toHaveBeenCalled()
})

it("sees the writer's own change, then holds the state again", async () => {
  const f = await installed()
  await f.controller.uninstall(f.handle, 'chrome')
  expect(f.disk.load().guards.get('chrome')?.phase).toBe('removed')
  const reads = readsOf(f.disk)
  f.disk.load()
  f.state.readWorkspaceAdmission()
  expect(reads).not.toHaveBeenCalled()
})

it('does not let a caller change the held state through returned maps or sets', async () => {
  const f = await installed(),
    original = f.disk.load()
  const detached = f.disk.load()
  detached.guards.get('chrome')!.release.version = 'fictional-mutation'
  detached.operations.values().next().value!.operation.request.consent.at = 99
  detached.usedIds.clear()
  detached.projections.clear()
  expect(f.disk.load()).toEqual(original)
})

it('keeps every historical completed activation during reclaim from the held state', async () => {
  const f = await installed()
  await f.controller.uninstall(f.handle, 'chrome')
  f.disk.load()
  const folder = join(f.root, 'state/activations')
  const names = readdirSync(folder).sort()
  expect(names.length).toBeGreaterThan(1)
  f.disk.reclaim()
  expect(readdirSync(folder).sort()).toEqual(names)
})
