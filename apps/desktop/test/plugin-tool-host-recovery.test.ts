import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'

afterEach(cleanupLifecycleFixtures)

it.each(['chrome', 'whatsapp'] as const)(
  'retains the exact %s host until its positive stop receipt, then reprojects the same installation',
  async (plugin) => {
    const f = await fixture({}, plugin)
    const start = f.opts.runtime.start.bind(f.opts.runtime)
    const stopping = deferred<void>(),
      entered = deferred<void>(),
      runIds: string[] = []
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      runIds.push(run.runId)
      return {
        ...run,
        async stop() {
          entered.resolve()
          await stopping.promise
          await run.stop()
        },
      }
    }
    await f.controller.install(f.handle, plugin)
    const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
    const proof = vi.fn()
    const pending = f.controller.restartPluginTools(
      plugin,
      runIds[0]!,
      proof,
    )
    await entered.promise
    expect(f.starts()).toBe(1)
    expect(proof).not.toHaveBeenCalled()
    expect(old.current()).toBe(false)
    expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
    expect(f.events).not.toContain('remove-code')
    expect(f.events).not.toContain(`remove-data ${plugin}`)
    stopping.resolve()
    await pending
    expect(proof).toHaveBeenCalledOnce()
    expect(f.starts()).toBe(2)
    const fresh = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
    expect(fresh.installation).toEqual(old.installation)
    expect(fresh.current()).toBe(true)
    expect(old.current()).toBe(false)
    expect(runIds[1]).not.toBe(runIds[0])
    expect(f.downloads()).toBe(1)
  },
)

it.each(['chrome', 'whatsapp'] as const)(
  'never recreates a %s host after a failed exit proof',
  async (plugin) => {
    const f = await fixture({}, plugin)
    let runId = ''
    const start = f.opts.runtime.start.bind(f.opts.runtime)
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      runId = run.runId
      return run
    }
    await f.controller.install(f.handle, plugin)
    f.failStop()
    const proof = vi.fn()
    await expect(f.controller.restartPluginTools(plugin, runId, proof)).rejects.toThrow()
    expect(f.starts()).toBe(1)
    expect(proof).not.toHaveBeenCalled()
    expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
    expect((await f.controller.status()).cards[0]?.state).toBe('Unavailable')
    expect(f.events).not.toContain('remove-code')
  },
)

it('refuses a stale Chrome run identity and never stops a different plugin', async () => {
  const f = await fixture({}, 'whatsapp')
  let runId = ''
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    runId = run.runId
    return run
  }
  await f.controller.install(f.handle, 'whatsapp')
  const proof = vi.fn()
  await expect(f.controller.restartPluginTools('chrome', runId, proof)).rejects.toThrow()
  expect(f.events).not.toContain('stop')
  expect(proof).not.toHaveBeenCalled()
  expect(f.starts()).toBe(1)
  expect((await f.controller.status()).cards[0]?.state).toBe('Running')
})

it('restarts independent plugin runs while another plugin is still stopping', async () => {
  const f = await fixture()
  const other = packageFixture({ manifest: { ...f.pkg.manifest, id: 'whatsapp' } })
  const bytes = Buffer.from(JSON.stringify({ format: 1, entries: [f.pkg.release, other.release] }))
  f.opts.refreshCatalogue = async () => ({ catalogue: { bytes }, names: f.opts.names })
  f.opts.download = async (release) => (release.id === 'chrome' ? f.pkg.archive : other.archive)
  await f.controller.refreshCatalogue(pluginSha256(bytes))
  const stopping = deferred<void>(),
    entered = deferred<void>()
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    return spec.package.manifest.id === 'chrome'
      ? {
          ...run,
          async stop() {
            entered.resolve()
            await stopping.promise
            await run.stop()
          },
        }
      : run
  }
  await f.controller.install(f.handle, 'chrome')
  await f.controller.install(f.handle, 'whatsapp')
  const runs = f.controller.agentAttachments(f.local.sink.workspaceId)
  const chrome = runs.find((run) => run.installation.pluginId === 'chrome')!
  const whatsapp = runs.find((run) => run.installation.pluginId === 'whatsapp')!
  const proof = vi.fn()
  const pending = f.controller.restartPluginTools('chrome', chrome.runId, proof)
  await entered.promise
  await f.controller.restartPluginTools('whatsapp', whatsapp.runId, vi.fn())
  expect(proof).not.toHaveBeenCalled()
  expect(
    f.controller
      .agentAttachments(f.local.sink.workspaceId)
      .find((run) => run.installation.pluginId === 'whatsapp')?.runId,
  ).not.toBe(whatsapp.runId)
  stopping.resolve()
  await pending
  expect(proof).toHaveBeenCalledOnce()
})

it('reads the installed action while its host cannot start', async () => {
  const f = await fixture()
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  const exited = deferred<void>()
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    return {
      ...run,
      exited: exited.promise,
      async stop() {
        await run.stop()
        exited.resolve()
      },
    }
  }
  await f.controller.install(f.handle, 'chrome')
  await f.controller.drain()
  const runtime = {
    ...f.opts.runtime,
    start: vi.fn(async () => {
      throw new Error('fictional host startup failure')
    }),
  }
  const controller = await PluginLifecycleController.open({ ...f.opts, runtime })
  try {
    await controller.attach(f.local.sink)
    expect(await controller.action('chrome')).toEqual(f.pkg.manifest.action)
    expect(runtime.start).toHaveBeenCalledOnce()
  } finally {
    await controller.drain()
  }
})
