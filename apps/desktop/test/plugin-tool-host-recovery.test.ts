import { afterEach, expect, it, vi } from 'vitest'
import { fixture, cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'

afterEach(cleanupLifecycleFixtures)

type Recovery = {
  restartChromeTools(runId: string, stopped: () => void): Promise<void>
}

it('retains the exact Chrome host and consumers until its positive stop receipt, then reprojects the same installation', async () => {
  const f = await fixture()
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
  await f.controller.install(f.handle, 'chrome')
  const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const proof = vi.fn()
  const pending = (f.controller as unknown as Recovery).restartChromeTools(runIds[0]!, proof)
  await entered.promise
  expect(f.starts()).toBe(1)
  expect(proof).not.toHaveBeenCalled()
  expect(old.current()).toBe(false)
  expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
  expect(f.events).not.toContain('remove-code')
  expect(f.events).not.toContain('remove-data chrome')
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
})

it('never recreates a Chrome host or confirms completion after a failed exit proof', async () => {
  const f = await fixture()
  let runId = ''
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    runId = run.runId
    return run
  }
  await f.controller.install(f.handle, 'chrome')
  f.failStop()
  const proof = vi.fn()
  await expect(
    (f.controller as unknown as Recovery).restartChromeTools(runId, proof),
  ).rejects.toThrow()
  expect(f.starts()).toBe(1)
  expect(proof).not.toHaveBeenCalled()
  expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
  expect((await f.controller.status()).cards[0]?.state).toBe('Unavailable')
  expect(f.events).not.toContain('remove-code')
})

it('refuses a stale Chrome run identity and never stops a different plugin', async () => {
  const f = await fixture({}, false, 'whatsapp')
  let runId = ''
  const start = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    runId = run.runId
    return run
  }
  await f.controller.install(f.handle, 'whatsapp')
  const proof = vi.fn()
  await expect(
    (f.controller as unknown as Recovery).restartChromeTools(runId, proof),
  ).rejects.toThrow()
  expect(f.events).not.toContain('stop')
  expect(proof).not.toHaveBeenCalled()
  expect(f.starts()).toBe(1)
  expect((await f.controller.status()).cards[0]?.state).toBe('Running')
})
