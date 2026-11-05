import { snapshotPath } from './helpers/plugin-state-snapshot'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import type { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleWorkspace } from '../src/main/plugins/lifecycle/types'
import { cleanupLifecycleFixtures, fixture, projection } from './plugin-lifecycle-fixtures'

const roots: string[] = [],
  stores: GlobalPluginState[] = []
async function accepted(
  controller: PluginLifecycleController,
  handle: LifecycleWorkspace,
  id: string,
  installId: string,
) {
  const workspaceId = controller.hostWorkspace(handle)
  let resolve!: () => void, reject!: (error: unknown) => void
  const ready = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const check = () => {
    try {
      if (controller.admitted(handle, id, installId)) resolve()
    } catch (error) {
      reject(error)
    }
  }
  const stop = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  receiptSubscriptions.add(stop)
  try {
    check()
    await ready
  } finally {
    receiptSubscriptions.delete(stop)
    stop()
  }
}
const receiptSubscriptions = new Set<() => void>()
afterEach(async () => {
  for (const stop of receiptSubscriptions) stop()
  receiptSubscriptions.clear()
  for (const state of stores.splice(0)) state.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  await cleanupLifecycleFixtures()
})
function open(root?: string, fault?: (point: 'staged' | 'published' | 'durable') => void) {
  if (!root) {
    root = mkdtempSync(join(tmpdir(), 'fictional-choice-'))
    roots.push(root)
  }
  const options = { root, workspaceRoots: [], fault }
  const state = GlobalPluginState.open(options)
  stores.push(state)
  return { state, root }
}
const release = {
  version: 'fictional 版本',
  archiveSha256: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64),
  dataSchema: 1,
}
function mutate(
  state: GlobalPluginState,
  action: 'install' | 'update' | 'uninstall',
  pluginId: string,
) {
  const operationId = randomUUID(),
    view = state.inspect()
  state.prepare({
    operationId,
    snapshot: null,
    consent: {
      action,
      pluginId,
      at: 1,
      expectedSequence: view.sequence,
      expectedInstallId: view.guards.find((one) => one.pluginId === pluginId)?.installId ?? null,
      release: action === 'uninstall' ? null : release,
    },
  })
  state.complete(operationId)
}
it('migrates absent choices to old auto-on behavior and titles off without inferring from bindings', () => {
  const { state, root } = open(),
    workspaceId = randomUUID(),
    id = 'fictional .风筝'
  mutate(state, 'install', id)
  const path = snapshotPath(root),
    saved = JSON.parse(readFileSync(path, 'utf8'))
  delete saved.workspaceEnabled
  delete saved.workspaceTitlesEnabled
  writeFileSync(path, JSON.stringify(saved))
  const reopened = open(root).state
  expect(reopened.getEnabled(workspaceId, id)).toEqual({ enabled: true, revision: 0 })
  expect(reopened.getTitlesEnabled(workspaceId, id)).toEqual({ enabled: false, revision: 0 })
  reopened.recordProjection(workspaceId, id, null)
  expect(reopened.getEnabled(workspaceId, id)).toEqual({ enabled: true, revision: 0 })
})
it('keeps explicit choices through bindings, updates, uninstall/reinstall and activation restore', () => {
  const { state, root } = open(),
    workspaceId = randomUUID(),
    id = 'fictional-kite'
  mutate(state, 'install', id)
  const backup = state.exportActivation()
  expect(state.setEnabled(workspaceId, id, false)).toEqual({ enabled: false, revision: 1 })
  const sequence = state.inspect().sequence
  expect(state.setEnabled(workspaceId, id, false)).toEqual({ enabled: false, revision: 1 })
  expect(state.inspect().sequence).toBe(sequence)
  expect(state.setTitlesEnabled(workspaceId, id, true)).toEqual({ enabled: true, revision: 1 })
  state.recordProjection(workspaceId, id, state.emptyProjection(workspaceId, id))
  state.recordProjection(workspaceId, id, null)
  mutate(state, 'update', id)
  mutate(state, 'uninstall', id)
  mutate(state, 'install', id)
  const operationId = randomUUID()
  state.prepare({
    operationId,
    snapshot: backup,
    consent: {
      action: 'global-restore',
      pluginId: null,
      release: null,
      expectedInstallId: null,
      at: 1,
      expectedSequence: state.inspect().sequence,
    },
  })
  state.complete(operationId)
  const next = open(root).state
  expect(next.getEnabled(workspaceId, id)).toEqual({ enabled: false, revision: 1 })
  expect(next.getTitlesEnabled(workspaceId, id)).toEqual({ enabled: true, revision: 1 })
  expect(next.setEnabled(workspaceId, id, true)).toEqual({ enabled: true, revision: 2 })
  expect(next.getTitlesEnabled(workspaceId, id).revision).toBe(1)
  expect(next.getEnabled(randomUUID(), id)).toEqual({ enabled: true, revision: 0 })
  expect(open().state.getEnabled(workspaceId, id)).toEqual({ enabled: true, revision: 0 })
})
it('uses tuple keys without collisions and serializes choices across store handles', async () => {
  const first = open(),
    second = open(first.root)
  await first.state.withExclusive(async () => {
    first.state.setEnabled('fictional/a', 'b', false)
    await Promise.resolve()
  })
  expect(second.state.getEnabled('fictional/a', 'b').enabled).toBe(false)
  expect(second.state.getEnabled('fictional', 'a/b')).toEqual({ enabled: true, revision: 0 })
  await second.state.withExclusive(async () =>
    second.state.setTitlesEnabled('fictional', 'a/b', true),
  )
  expect(first.state.getTitlesEnabled('fictional', 'a/b')).toEqual({ enabled: true, revision: 1 })
})
it.each(['staged', 'published', 'durable'] as const)(
  'recovers a choice after %s interruption without changing installation state',
  (point) => {
    let armed = false
    const { state, root } = open(undefined, (stage) => {
      if (armed && stage === point) throw new Error('fictional interruption')
    })
    const workspaceId = randomUUID(),
      id = 'fictional-kite'
    mutate(state, 'install', id)
    const before = state.exportActivation()
    armed = true
    expect(() => state.setEnabled(workspaceId, id, false)).toThrow()
    const next = open(root).state
    expect(next.getEnabled(workspaceId, id)).toEqual({
      enabled: point === 'staged',
      revision: point === 'staged' ? 0 : 1,
    })
    expect(next.exportActivation()).toEqual(before)
  },
)
it('gates only the disabled workspace and never revives a callback across off/on or reconnect', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const id = 'chrome',
    workspaceId = f.local.sink.workspaceId
  const before = f.controller.agentAttachments(workspaceId)[0]!
  expect(before.current()).toBe(true)
  const second = projection()
  const secondHandle = await f.controller.attach(second.sink)
  await accepted(f.controller, secondHandle, id, f.state.currentInstallation(id)!.installId)
  f.state.setEnabled(workspaceId, id, false)
  expect(f.controller.agentAttachments(workspaceId)).toEqual([])
  expect(before.current()).toBe(false)
  expect(f.controller.agentAttachments(second.sink.workspaceId)[0]?.current()).toBe(true)
  f.state.setEnabled(workspaceId, id, true)
  expect(before.current()).toBe(false)
  const fresh = f.controller.agentAttachments(workspaceId)[0]!
  expect(fresh.current()).toBe(true)
  f.state.setTitlesEnabled(workspaceId, id, true)
  expect(fresh.current()).toBe(true)
  f.state.setEnabled(workspaceId, id, false)
  await f.controller.detach(f.handle)
  await f.controller.attach(f.local.sink)
  expect(f.state.getEnabled(workspaceId, id)).toEqual({ enabled: false, revision: 3 })
  expect(f.controller.agentAttachments(workspaceId)).toEqual([])
})
