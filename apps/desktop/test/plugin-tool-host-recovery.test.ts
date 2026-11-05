import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'

afterEach(cleanupLifecycleFixtures)

type Recovery = {
  restartPluginTools(pluginId: string, runId: string, stopped: () => void): Promise<void>
}
async function recoveryFixture(id: string) {
  const f = await fixture({}, false, id)
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    const exited = deferred<void>()
    return {
      ...run,
      exited: exited.promise,
      async stop() {
        await run.stop()
        exited.resolve()
      },
    }
  }
  return f
}

it('retains the selected process until its stop completes, then reprojects the same installation', async () => {
  const f = await recoveryFixture('fictional-orchard')
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
  await f.controller.install(f.handle, 'fictional-orchard')
  const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const proof = vi.fn()
  const pending = (f.controller as unknown as Recovery).restartPluginTools(
    'fictional-orchard',
    runIds[0]!,
    proof,
  )
  await entered.promise
  expect(f.starts()).toBe(1)
  expect(proof).not.toHaveBeenCalled()
  expect(old.current()).toBe(false)
  expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
  expect(f.events).not.toContain('remove-code')
  expect(f.events).not.toContain('remove-data fictional-orchard')
  stopping.resolve()
  await pending
  expect(proof).toHaveBeenCalledOnce()
  expect(f.starts()).toBe(2)
  const fresh = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  expect(fresh.installation).toEqual(old.installation)
  expect(fresh.current()).toBe(true)
  expect(old.current()).toBe(false)
  expect(f.local.rows.get('fictional-orchard')?.installId).toBe(old.installation.installId)
  expect(runIds[1]).not.toBe(runIds[0])
  expect(f.downloads()).toBe(1)
})

it('does not create a second running copy when the selected process fails to stop', async () => {
  const f = await recoveryFixture('fictional-orchard')
  let runId = ''
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    runId = run.runId
    return run
  }
  await f.controller.install(f.handle, 'fictional-orchard')
  f.failStop()
  const proof = vi.fn()
  await expect(
    (f.controller as unknown as Recovery).restartPluginTools('fictional-orchard', runId, proof),
  ).rejects.toThrow()
  expect(f.starts()).toBe(1)
  expect(proof).not.toHaveBeenCalled()
  expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
  expect((await f.controller.status()).cards[0]?.state).toBe('Unavailable')
  expect(f.events).not.toContain('remove-code')
})

it('refuses the wrong plugin ID and restarts the selected unfamiliar plugin', async () => {
  const f = await recoveryFixture('fictional-meadow')
  let runId = ''
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    runId = run.runId
    return run
  }
  await f.controller.install(f.handle, 'fictional-meadow')
  const proof = vi.fn()
  await expect(
    (f.controller as unknown as Recovery).restartPluginTools('fictional-orchard', runId, proof),
  ).rejects.toThrow()
  expect(f.events).not.toContain('stop')
  expect(proof).not.toHaveBeenCalled()
  expect(f.starts()).toBe(1)
  expect((await f.controller.status()).cards[0]?.state).toBe('Running')
  await f.controller.restartPluginTools('fictional-meadow', runId, proof)
  expect(f.starts()).toBe(2)
  expect(proof).toHaveBeenCalledOnce()
})

it('coalesces a restart by plugin ID and does not require a UI cleanup acknowledgement', async () => {
  const f = await recoveryFixture('fictional-orchard')
  await f.controller.install(f.handle, 'fictional-orchard')
  f.local.failRevoke()
  const stopped = vi.fn()
  await Promise.all([
    f.controller.restartPluginTools('fictional-orchard', undefined, stopped),
    f.controller.restartPluginTools('fictional-orchard', undefined, stopped),
  ])
  expect(f.starts()).toBe(2)
  expect(stopped).toHaveBeenCalledTimes(2)
  expect((await f.controller.status()).cards[0]?.state).toBe('Running')
})
