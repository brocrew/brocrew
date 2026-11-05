import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginEffectQueue } from '../src/main/plugins/lifecycle/effect-queue'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { deferred } from './plugin-lifecycle-fixtures'

const owners: PluginSupervisor[] = []
const roots: string[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.shutdown()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
it('joins the same operation once and lets an unrelated restart finish before held cleanup releases', async () => {
  const queue = new PluginEffectQueue(),
    entered = deferred<void>(),
    release = deferred<void>()
  const operation = randomUUID()
  const admitted = vi.fn()
  const effect = vi.fn(async () => {
    queue.assertEffect('fictional-birch')
    entered.resolve()
    await release.promise
    return { data: 'kept' }
  })
  const first = queue.mutate('fictional-birch', operation, 'uninstall', effect, admitted)
  expect(admitted).toHaveBeenCalledOnce()
  await entered.promise
  try {
    const second = queue.mutate('fictional-birch', operation, 'uninstall', effect, admitted)
    expect(second).toBe(first)
    expect(admitted).toHaveBeenCalledOnce()
    await expect(
      queue.restart('fictional-birch', randomUUID(), async () => true),
    ).rejects.toMatchObject({ code: 'cleanup-pending' })
    await expect(
      queue.restart('fictional-ash', randomUUID(), async () => 'restarted'),
    ).resolves.toBe('restarted')
    expect(effect).toHaveBeenCalledOnce()
  } finally {
    release.resolve()
    expect(await first).toEqual({ data: 'kept' })
    await queue.close()
  }
})
it('drain abandons a consumer reply without allowing its late continuation to write an effect', async () => {
  const queue = new PluginEffectQueue(),
    entered = deferred<void>(),
    reply = deferred<void>()
  const late = vi.fn()
  const work = queue.mutate('fictional-birch', randomUUID(), 'install', async () => {
    entered.resolve()
    await queue.consumer(() => reply.promise)
    queue.assertEffect('fictional-birch')
    late()
  })
  const refused = expect(work).rejects.toMatchObject({ code: 'cleanup-pending' })
  await entered.promise
  await queue.close()
  await refused
  reply.resolve()
  await Promise.resolve()
  expect(late).not.toHaveBeenCalled()
  expect(queue.idle).toBe(true)
})
it('the actual owner lease remains held until its queued filesystem effect settles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fictional-effect-owner-'))
  roots.push(root)
  const owner = await PluginSupervisor.start({ root, workspaceRoots: [], drainWithin: 1000 })
  owners.push(owner)
  const queue = new PluginEffectQueue()
  owner.bindLifecycleEffects(queue)
  const entered = deferred<void>(),
    release = deferred<void>(),
    effect = vi.fn(async () => {
      entered.resolve()
      await release.promise
    })
  const work = queue.mutate('fictional-birch', randomUUID(), 'uninstall', () =>
    queue.effect('fictional-birch', effect),
  )
  await entered.promise
  let closed = false
  void owner.closed.then(() => {
    closed = true
  })
  const closing = owner.shutdown()
  try {
    await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
      code: 'busy',
    })
    expect(closed).toBe(false)
  } finally {
    release.resolve()
    await work
    await closing
    await owner.closed
  }
  const successor = await PluginSupervisor.start({ root, workspaceRoots: [] })
  owners.push(successor)
  expect(effect).toHaveBeenCalledOnce()
  expect(queue.idle).toBe(true)
})
