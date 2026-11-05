import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleRuntime } from '../src/main/plugins/lifecycle/types'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'

const release: Array<() => void> = []
afterEach(async () => {
  for (const finish of release.splice(0)) finish()
  vi.restoreAllMocks()
  await cleanupLifecycleFixtures()
})
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
function runtime() {
  const exit = deferred<void>()
  release.push(() => exit.resolve())
  const stop = vi.fn(async () => exit.resolve())
  const run = {
    runId: randomUUID(),
    exited: exit.promise,
    stop,
    ready: async () => ({
      serverPid: 404941,
      origin: 'http://127.0.0.1:1',
      mcp: () => ({ url: '', headers: { Authorization: '' } }),
      admin: () => ({ url: '', headers: { Authorization: '' } }),
    }),
  }
  const host: LifecycleRuntime = {
    previousOwnerClean: async () => true,
    start: vi.fn(async () => run),
    removeCode: vi.fn(async () => {}),
    removeData: vi.fn(async () => {}),
  }
  return { exit, stop, run, host }
}

it('beginClose alone retains an unacknowledged revoke even after the exact run exited', async () => {
  const r = runtime()
  const f = await fixture({ runtime: r.host })
  await f.controller.install(f.handle, 'chrome')
  const ack = deferred<boolean>()
  const entered = deferred<void>()
  release.push(() => ack.resolve(true))
  const revoke = vi.spyOn(f.local.sink, 'revoke').mockImplementation(() => {
    entered.resolve()
    return ack.promise
  })
  r.exit.resolve()
  await entered.promise
  expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
  expect(f.controller.cleanForShutdown()).toBe(false)
  await expect(f.controller.drain()).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(f.controller.cleanForShutdown()).toBe(false)
  ack.resolve(true)
  await turn()
  expect(revoke).toHaveBeenCalledOnce()
  expect(f.controller.cleanForShutdown()).toBe(false)
})

it('ended consumer authority retires its UI obligation only after physical exit settles', async () => {
  const r = runtime()
  const stopped = deferred<void>()
  r.stop.mockImplementation(async () => {
    stopped.resolve()
    await r.exit.promise
  })
  const f = await fixture({ runtime: r.host })
  await f.controller.install(f.handle, 'chrome')
  const selected = join(f.root, 'state', 'installed-state.json')
  const before = await readFile(selected)
  const data = join(f.root, 'host', 'data', 'chrome', 'sentinel')
  await mkdir(join(data, '..'), { recursive: true })
  await writeFile(data, 'fictional retained login')
  const revoke = vi.spyOn(f.local.sink, 'revoke').mockResolvedValue(false)
  await expect(f.controller.detach(f.handle)).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(f.controller.cleanForShutdown()).toBe(false)
  const applied = vi.spyOn(f.local.sink, 'applied')
  const published = vi.spyOn(f.state, 'recordProjection')
  f.controller.consumersEnded()
  const draining = f.controller.drain()
  let settled = false
  void draining.then(
    () => (settled = true),
    () => (settled = true),
  )
  try {
    await stopped.promise
    await turn()
    expect(settled).toBe(false)
    expect(f.controller.cleanForShutdown()).toBe(false)
    r.exit.resolve()
    await expect(draining).resolves.toBeUndefined()
    expect(f.controller.cleanForShutdown()).toBe(true)
    expect(await readFile(selected)).toEqual(before)
    expect(await readFile(data, 'utf8')).toBe('fictional retained login')
    await turn()
    expect(revoke).toHaveBeenCalledOnce()
    expect(applied).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
    expect(r.host.removeCode).not.toHaveBeenCalled()
    expect(r.host.removeData).not.toHaveBeenCalled()
  } finally {
    r.exit.resolve()
    await draining.catch(() => undefined)
  }
})

it('ended consumer authority cannot retire an unproved process exit or failed stop', async () => {
  const r = runtime()
  let fail!: () => void
  r.run.exited = new Promise<void>((_, reject) => {
    fail = () => reject(new Error('fictional unproved exit'))
  })
  r.stop.mockRejectedValue(new Error('fictional stop failed'))
  const f = await fixture({ runtime: r.host })
  await f.controller.install(f.handle, 'chrome')
  const selected = join(f.root, 'state', 'installed-state.json')
  const before = await readFile(selected)
  f.controller.consumersEnded()
  fail()
  await expect(f.controller.drain()).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(f.controller.cleanForShutdown()).toBe(false)
  expect(await readFile(selected)).toEqual(before)
})

it('ended consumer authority does not discard a missing durable effect obligation', async () => {
  const r = runtime()
  const f = await fixture({ runtime: r.host })
  const operationId = randomUUID()
  await f.controller.install(f.handle, 'chrome', operationId)
  f.controller.consumersEnded()
  await f.controller.drain()
  await unlink(join(f.root, 'lifecycle-effects', operationId + '.json'))
  const state = reopenLifecycleFixture(f)
  const before = await readFile(join(f.root, 'state', 'installed-state.json'))
  const current = await PluginLifecycleController.open({ ...f.opts, state })
  expect((await current.status()).cleanupPending).toEqual(['chrome'])
  current.consumersEnded()
  await expect(current.drain()).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(current.cleanForShutdown()).toBe(false)
  expect(state.inspect().pending).toBeNull()
  expect(state.operation(operationId)?.status).toBe('completed')
  expect(await readFile(join(f.root, 'state', 'installed-state.json'))).toEqual(before)
})

it('terminal drain includes a start allocation held before its run enters the controller map', async () => {
  const original = runtime()
  const f = await fixture({ runtime: original.host })
  await f.controller.install(f.handle, 'chrome')
  f.controller.consumersEnded()
  await f.controller.drain()
  const state = reopenLifecycleFixture(f)
  const r = runtime()
  const entered = deferred<void>()
  const allocated = deferred<void>()
  const stopped = deferred<void>()
  release.push(() => allocated.resolve())
  r.host.start = vi.fn(async () => {
    entered.resolve()
    await allocated.promise
    return r.run
  })
  r.stop.mockImplementation(async () => {
    stopped.resolve()
    await r.exit.promise
  })
  const current = await PluginLifecycleController.open({ ...f.opts, state, runtime: r.host })
  await current.attach(projection().sink)
  await entered.promise
  const ack = deferred<boolean>()
  const ackEntered = deferred<void>()
  release.push(() => ack.resolve(true))
  const pendingConsumer = projection()
  vi.spyOn(pendingConsumer.sink, 'revoke').mockImplementation(() => {
    ackEntered.resolve()
    return ack.promise
  })
  const applied = vi.spyOn(pendingConsumer.sink, 'applied')
  await current.attach(pendingConsumer.sink)
  await ackEntered.promise
  const selected = join(f.root, 'state', 'installed-state.json')
  const before = await readFile(selected)
  const published = vi.spyOn(state, 'recordProjection')
  current.consumersEnded()
  const draining = current.drain()
  let settled = false
  void draining.then(
    () => (settled = true),
    () => (settled = true),
  )
  try {
    await turn()
    expect(settled).toBe(false)
    expect(current.cleanForShutdown()).toBe(false)
    allocated.resolve()
    await stopped.promise
    await turn()
    expect(settled).toBe(false)
    expect(current.cleanForShutdown()).toBe(false)
    r.exit.resolve()
    await expect(draining).resolves.toBeUndefined()
    expect(current.cleanForShutdown()).toBe(true)
    expect(r.host.start).toHaveBeenCalledOnce()
    expect(r.stop).toHaveBeenCalledOnce()
    expect(await readFile(selected)).toEqual(before)
    ack.resolve(true)
    await turn()
    expect(applied).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
  } finally {
    allocated.resolve()
    r.exit.resolve()
    ack.resolve(true)
    await draining.catch(() => undefined)
  }
})

it('a held start that rejects without a run cannot retain terminal consumer cleanup', async () => {
  const original = runtime()
  const f = await fixture({ runtime: original.host })
  await f.controller.install(f.handle, 'chrome')
  f.controller.consumersEnded()
  await f.controller.drain()
  const state = reopenLifecycleFixture(f)
  const r = runtime()
  const entered = deferred<void>()
  const allocated = deferred<void>()
  release.push(() => allocated.resolve())
  r.host.start = vi.fn(async () => {
    entered.resolve()
    await allocated.promise
    throw new Error('fictional allocation refused without a run')
  })
  const current = await PluginLifecycleController.open({ ...f.opts, state, runtime: r.host })
  await current.attach(projection().sink)
  await entered.promise
  const selected = join(f.root, 'state', 'installed-state.json')
  const before = await readFile(selected)
  current.consumersEnded()
  const draining = current.drain()
  let settled = false
  void draining.then(
    () => (settled = true),
    () => (settled = true),
  )
  try {
    await turn()
    expect(settled).toBe(false)
    expect(current.cleanForShutdown()).toBe(false)
    allocated.resolve()
    await expect(draining).resolves.toBeUndefined()
    expect(current.cleanForShutdown()).toBe(true)
    expect(r.host.start).toHaveBeenCalledOnce()
    expect(r.stop).not.toHaveBeenCalled()
    expect(await readFile(selected)).toEqual(before)
  } finally {
    allocated.resolve()
    await draining.catch(() => undefined)
  }
})
