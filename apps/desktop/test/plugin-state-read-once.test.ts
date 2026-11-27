import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalPluginState } from '../src/main/plugins/state/store'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

// The plugin service is the state file's only writer while it holds its owner lock, so it reads
// the file once and again only to check that nothing else changed it before each write.

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
const diskOf = (state: GlobalPluginState) => (state as unknown as { disk: PluginStateDisk }).disk
const readsOf = (disk: PluginStateDisk) =>
  vi.spyOn(disk as unknown as { onDisk(): unknown }, 'onDisk')
async function installed() {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  return { ...f, disk: diskOf(f.state) }
}

it('reads the state file no more for many admissions', async () => {
  const f = await installed()
  const reads = readsOf(f.disk)
  for (let i = 0; i < 20; i++) {
    expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toHaveLength(1)
    f.state.readWorkspaceAdmission()
    f.state.inspect()
  }
  expect(reads).not.toHaveBeenCalled()
})

it("sees the writer's own change, reading the file only to check it before writing", async () => {
  const f = await installed()
  const reads = readsOf(f.disk)
  await f.controller.uninstall(f.handle, 'chrome')
  const writes = reads.mock.calls.length
  expect(writes).toBeGreaterThan(0)
  expect(f.disk.load().guards.get('chrome')?.phase).toBe('removed')
  f.state.readWorkspaceAdmission()
  expect(reads).toHaveBeenCalledTimes(writes)
})

it('does not let a caller change the held state through returned maps', async () => {
  const f = await installed(),
    original = f.disk.load()
  const detached = f.disk.load()
  detached.guards.get('chrome')!.release.version = 'fictional-mutation'
  detached.operations.values().next().value!.operation.request.consent.at = 99
  detached.admitted.clear()
  expect(f.disk.load()).toEqual(original)
})
