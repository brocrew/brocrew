import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { PluginStateDisk } from '../src/main/plugins/state/disk'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { manifestFor, packageFixture, catalogueBytes } from './plugin-package-fixtures'
import { PluginHostError } from '../src/main/plugins/node-host-files'
import {
  appendProjectionHistory,
  cleanupLifecycleFixtures,
  fixture,
  projection,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

async function withHistory(history: number) {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const disk = (f.state as unknown as { disk: PluginStateDisk }).disk
  const head = disk.load()
  const workspaceId = randomUUID()
  f.state.close()
  // Earlier copies wrote these on every attach; seed them directly, as their journals hold them.
  appendProjectionHistory(f.root, head, workspaceId, history)
  const state = reopenLifecycleFixture(f)
  const controller = await PluginLifecycleController.open({ ...f.opts, state })
  state.inspect()
  return { state, controller, disk: (state as unknown as { disk: PluginStateDisk }).disk }
}

it.each([336, 1000])(
  'with %i history records, a new agent attaches and reads its first routes without writing or replaying',
  async (history) => {
    const { state, controller, disk } = await withHistory(history)
    const before = state.inspect().sequence
    const replays = vi.spyOn(
      disk as unknown as { loadLocked(...args: unknown[]): unknown },
      'loadLocked',
    )
    const agent = projection()
    await controller.attach(agent.sink)
    expect(
      controller.agentAttachments(agent.sink.workspaceId).map((one) => one.installation.pluginId),
    ).toEqual(['chrome'])
    expect(
      controller.agentScope(agent.sink.workspaceId).entries.map((one) => [one.pluginId, one.is]),
    ).toEqual([['chrome', 'admitted']])
    expect(state.inspect().sequence).toBe(before)
    expect(replays).not.toHaveBeenCalled()
  },
  180_000,
)

it('one plugin that cannot start does not hide the others from a new agent', async () => {
  const f = await fixture()
  const manifest = manifestFor()
  manifest.id = 'whatsapp'
  manifest.skills = []
  manifest.platforms = [f.opts.target]
  const other = packageFixture({ manifest })
  const opts = {
    ...f.opts,
    catalogue: catalogueBytes({ format: 1, entries: [f.pkg.release, other.release] }),
    download: async (release: { id: string }) =>
      release.id === 'chrome' ? f.pkg.archive : other.archive,
  }
  const first = await PluginLifecycleController.open(opts)
  const handle = await first.attach(projection().sink)
  await first.install(handle, 'chrome')
  await first.install(handle, 'whatsapp')
  // A later owner over the same state: WhatsApp's process now fails to start.
  const start = opts.runtime.start.bind(opts.runtime)
  const later = await PluginLifecycleController.open({
    ...opts,
    runtime: {
      ...opts.runtime,
      start: async (spec) => {
        if (spec.package.manifest.id === 'whatsapp') throw new PluginHostError('ready')
        return start(spec)
      },
    },
  })
  const agent = projection()
  await later.attach(agent.sink)
  // A failed start is not starting: agents don't wait for it, and its plugin line says why.
  expect(
    later.agentScope(agent.sink.workspaceId).entries.map((one) => [one.pluginId, one.is]),
  ).toEqual([
    ['chrome', 'admitted'],
    ['whatsapp', 'off'],
  ])
  expect((await later.status()).cards.find((card) => card.id === 'whatsapp')).toMatchObject({
    installed: true,
    state: 'Unavailable',
    unavailableReason: 'plugin-start',
    toolsCause: 'start: ready',
  })
})

it('uninstall through the Settings connection takes the plugin away from an attached agent', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const agent = projection()
  const revoked: string[] = []
  agent.sink.revoke = async (id) => {
    revoked.push(id)
    return true
  }
  await f.controller.attach(agent.sink)
  const [view] = f.controller.agentAttachments(agent.sink.workspaceId)
  expect(view?.current()).toBe(true)
  await f.controller.detach(f.handle)
  const key = 'a'.repeat(64)
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller: f.controller,
    read: async () => ({ configRevision: 0, profiles: [], tabs: [] }),
  })
  const client = await connectPluginSettings({
    path: bridge.path,
    personKey: key,
    root: f.root,
    target: f.opts.target,
    catalogue: f.opts.catalogue,
    projection: projection().sink,
    propose: () => {},
  })
  try {
    await client.uninstall('chrome')
    expect(view!.current()).toBe(false)
    expect(f.controller.agentAttachments(agent.sink.workspaceId)).toEqual([])
    expect(revoked).toContain('chrome')
  } finally {
    await client.close()
    await bridge.close()
  }
})
