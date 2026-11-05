import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginEffectQueue } from '../src/main/plugins/lifecycle/effect-queue'
import { deferred, supervisorFixtures } from './plugin-supervisor-fixtures'
const fixtures = supervisorFixtures()
afterEach(() => fixtures.cleanup())
it('the actual owner stops captured children before waiting for an already started lifecycle call', async () => {
  const f = await fixtures.fixture(),
    owner = await f.start()
  await f.attach()
  const queue = new PluginEffectQueue()
  owner.bindLifecycleEffects(queue)
  const entered = deferred<void>(),
    reply = deferred<void>(),
    exit = deferred<void>()
  const stop = vi.fn(async () => {
    reply.resolve()
    exit.resolve()
  })
  owner.adopt({ stop, exited: exit.promise, descendantsGone: async () => false })
  const call = vi.fn(async () => {
    entered.resolve()
    await reply.promise
  })
  const work = queue.mutate('fictional-moss', randomUUID(), 'uninstall', () =>
    queue.effect('fictional-moss', call),
  )
  await entered.promise
  try {
    expect(await owner.shutdown()).toBe(true)
    await owner.closed
    expect(stop).toHaveBeenCalledOnce()
    expect(call).toHaveBeenCalledOnce()
    await work
    expect(queue.idle).toBe(true)
    const next = await f.start()
    expect(await next.shutdown()).toBe(true)
  } finally {
    reply.resolve()
    exit.resolve()
    await work
  }
})
it('a swallowed consumer cancellation cannot start an effect or retain the actual owner lease', async () => {
  const f = await fixtures.fixture(),
    owner = await f.start()
  const queue = new PluginEffectQueue()
  owner.bindLifecycleEffects(queue)
  const entered = deferred<void>(),
    ack = deferred<void>(),
    write = vi.fn(async () => {})
  const work = queue.mutate('fictional-moss', randomUUID(), 'uninstall', async () => {
    entered.resolve()
    await queue.consumer(() => ack.promise).catch(() => undefined)
    await queue.effect('fictional-moss', write)
  })
  const result = work.then(
    () => true,
    () => false,
  )
  await entered.promise
  try {
    expect(await owner.shutdown()).toBe(true)
    await owner.closed
    expect(await result).toBe(false)
    expect(write).not.toHaveBeenCalled()
    const next = await f.start()
    expect(await next.shutdown()).toBe(true)
  } finally {
    ack.resolve()
    await result
  }
  expect(write).not.toHaveBeenCalled()
})
