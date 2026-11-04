import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { supervisorFixtures } from './plugin-supervisor-fixtures'
const f = supervisorFixtures()
const children: ChildProcess[] = []
afterEach(async () => {
  // Only handles created by this fixture are stopped. No saved PID is inspected or killed.
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit')
      child.kill()
      await exit
    }
  }
  await f.cleanup()
})

it('a real child exit, rather than a descendant acknowledgement, completes owner shutdown', async () => {
  const target = await f.fixture(),
    owner = await target.start(),
    lease = await target.attach()
  const child = spawn(
    process.execPath,
    ['-e', "process.stdout.write('ready'); setInterval(()=>{},1000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  children.push(child)
  const exited = once(child, 'exit').then(() => undefined)
  await once(child.stdout!, 'data')
  const stop = vi.fn(() => {
    child.kill()
  })
  const descendantsGone = vi.fn(async () => false)
  owner.adopt({ stop, exited, descendantsGone })
  expect(await lease.close()).toBe(true)
  await exited
  expect(stop).toHaveBeenCalledOnce()
  expect(descendantsGone).not.toHaveBeenCalled()
  expect(target.read()?.phase).toBe('stopped')
  await target.start()
})
it('a caller timeout cannot overlap a still-owned real child with a successor', async () => {
  const target = await f.fixture(),
    owner = await target.start({ drainWithin: 20 })
  await target.attach()
  const child = spawn(
    process.execPath,
    ['-e', "process.stdout.write('ready'); setInterval(()=>{},1000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  children.push(child)
  const exited = once(child, 'exit').then(() => undefined)
  await once(child.stdout!, 'data')
  owner.adopt({ stop() {}, exited, descendantsGone: async () => true })
  expect(await owner.shutdown()).toBe(false)
  await expect(
    PluginSupervisor.start({ root: target.root, workspaceRoots: [] }),
  ).rejects.toMatchObject({ code: 'busy' })
  expect(child.exitCode).toBeNull()
  child.kill()
  await exited
  await owner.closed
  await target.start()
})
it('synthetic UI teardown can fail while actual owned child stop still runs', async () => {
  const target = await f.fixture(),
    owner = await target.start(),
    lease = await target.attach()
  const stop = vi.fn()
  const ignored = vi.fn(async () => {
    throw new Error('fictional lost channel')
  })
  owner.adopt({
    inProcess: true,
    stop: ignored,
    exited: new Promise<void>(() => {}),
    descendantsGone: async () => false,
  })
  owner.adopt({ stop, exited: Promise.resolve(), descendantsGone: async () => false })
  expect(await lease.close()).toBe(true)
  await setImmediate()
  expect(ignored).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
  expect(target.read()?.phase).toBe('stopped')
  await target.start()
})
