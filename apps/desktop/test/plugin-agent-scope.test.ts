import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fixture, cleanupLifecycleFixtures, projection } from './plugin-lifecycle-fixtures'
import { manifestFor, packageFixture, catalogueBytes } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})

it('only committed absence is off; an installed plugin whose run is not up is pending', async () => {
  const f = await fixture()
  const scope = () => f.controller.agentScope(f.local.sink.workspaceId).entries
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'off' }])
  await f.controller.install(f.handle, 'chrome')
  expect(scope()).toMatchObject([{ pluginId: 'chrome', is: 'admitted' }])
  const runs = (f.controller as unknown as { runs: Map<string, unknown> }).runs
  const run = runs.get('chrome')
  runs.delete('chrome')
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'pending' }])
  runs.set('chrome', run)
  await f.controller.uninstall(f.handle, 'chrome')
  expect(scope()).toEqual([{ pluginId: 'chrome', is: 'off' }])
})

// The event: while one plugin installed or updated, every plugin dropped out for agents and the
// Plugins page. A pending operation now holds back only the plugin it changes; a global restore,
// which names none, still holds back every plugin.
async function twoPlugins(installWhatsapp: boolean) {
  const f = await fixture()
  const manifest = manifestFor()
  manifest.id = 'whatsapp'
  manifest.skills = []
  manifest.platforms = [f.opts.target]
  const other = packageFixture({ manifest })
  const started: string[] = []
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  const controller = await PluginLifecycleController.open({
    ...f.opts,
    catalogue: catalogueBytes({ format: 1, entries: [f.pkg.release, other.release] }),
    download: async (release: { id: string }) =>
      release.id === 'chrome' ? f.pkg.archive : other.archive,
    runtime: {
      ...f.opts.runtime,
      start: async (spec) => {
        started.push(spec.package.manifest.id)
        return start(spec)
      },
    },
  })
  const agent = projection()
  const handle = await controller.attach(agent.sink)
  await controller.install(handle, 'chrome')
  if (installWhatsapp) await controller.install(handle, 'whatsapp')
  const runs = (controller as unknown as { runs: Map<string, unknown> }).runs
  const scope = () =>
    controller.agentScope(agent.sink.workspaceId).entries.map((one) => [one.pluginId, one.is])
  const attached = () =>
    controller.agentAttachments(agent.sink.workspaceId).map((one) => one.installation.pluginId)
  return { f, controller, agent, other, started, runs, scope, attached }
}
function pend(
  state: Awaited<ReturnType<typeof fixture>>['state'],
  action: 'install' | 'update' | 'uninstall' | 'global-restore',
  pkg: ReturnType<typeof packageFixture> | null,
) {
  const view = state.inspect()
  const guard = view.guards.find((one) => one.pluginId === 'whatsapp')
  const operationId = randomUUID()
  state.prepare({
    operationId,
    consent: {
      action,
      pluginId: action === 'global-restore' ? null : 'whatsapp',
      at: 1000,
      expectedSequence: view.sequence,
      expectedInstallId: action === 'global-restore' ? null : (guard?.installId ?? null),
      release:
        (action === 'install' || action === 'update') && pkg
          ? {
              version: pkg.release.version,
              archiveSha256: pkg.release.archive.sha256,
              manifestSha256: pkg.release.manifestSha256,
              dataSchema: pkg.manifest.dataSchema,
            }
          : null,
    },
    snapshot: action === 'global-restore' ? state.exportActivation() : null,
  })
  return operationId
}
it.each(['install', 'update', 'uninstall'] as const)(
  "another plugin's pending %s leaves Chrome admitted and Running, and only WhatsApp pending",
  async (action) => {
    const t = await twoPlugins(action !== 'install')
    const [view] = t.controller.agentAttachments(t.agent.sink.workspaceId)
    const run = t.runs.get('chrome')
    pend(t.f.state, action, t.other)
    expect(t.scope()).toMatchObject([
      ['chrome', 'admitted'],
      ['whatsapp', 'pending'],
    ])
    expect(t.attached()).toEqual(['chrome'])
    expect(view?.installation.pluginId).toBe('chrome')
    expect(view?.current()).toBe(true)
    const cards = (await t.controller.status()).cards
    expect(cards.find((card) => card.id === 'chrome')).toMatchObject({
      installed: true,
      state: 'Running',
    })
    expect(t.runs.get('chrome')).toBe(run)
  },
)
it('a new agent attaching during an update starts the others and never the old release', async () => {
  const t = await twoPlugins(true)
  pend(t.f.state, 'update', t.other)
  // The update stopped WhatsApp's old run; a fresh owner would have none of them running.
  t.runs.clear()
  t.started.length = 0
  const late = projection()
  await t.controller.attach(late.sink)
  expect(t.started).toEqual(['chrome'])
  expect(t.runs.has('whatsapp')).toBe(false)
  expect(
    t.controller.agentAttachments(late.sink.workspaceId).map((one) => one.installation.pluginId),
  ).toEqual(['chrome'])
})
it('a pending global restore still holds back every plugin', async () => {
  const t = await twoPlugins(true)
  const [view] = t.controller.agentAttachments(t.agent.sink.workspaceId)
  pend(t.f.state, 'global-restore', null)
  expect(() => t.controller.agentScope(t.agent.sink.workspaceId)).toThrow()
  expect(t.attached()).toEqual([])
  expect(view?.current()).toBe(false)
})
it.each([true, false])(
  "once the other plugin's install resolves (completed: %s), Chrome is unchanged",
  async (completed) => {
    const t = await twoPlugins(false)
    const run = t.runs.get('chrome')
    const operationId = pend(t.f.state, 'install', t.other)
    if (completed) t.f.state.complete(operationId)
    else t.f.state.abort(operationId)
    expect(t.scope()).toMatchObject([
      ['chrome', 'admitted'],
      // A completed install is committed but its run is not up yet; an aborted one is absent.
      ['whatsapp', completed ? 'pending' : 'off'],
    ])
    expect(t.runs.get('chrome')).toBe(run)
    expect(t.started).toEqual(['chrome'])
  },
)
