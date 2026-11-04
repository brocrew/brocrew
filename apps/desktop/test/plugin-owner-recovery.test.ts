import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { deferred, supervisorFixtures } from './plugin-supervisor-fixtures'

const f = supervisorFixtures()
afterEach(async () => {
  vi.restoreAllMocks()
  await f.cleanup()
})

describe('ordinary fenced owner recovery', () => {
  it.each(['accepting', 'draining', 'blocked', 'stopped'] as const)(
    'starts over a stale %s record without asking for historical proof',
    async (phase) => {
      const target = await f.fixture()
      const old = await target.start()
      const oldEpoch = target.read()!.epoch
      await old.shutdown()
      const storage = new SupervisorStorage(target.root, [], false)
      try {
        storage.write({ ...storage.read()!, phase })
      } finally {
        storage.close()
      }
      const next = await target.start()
      expect(target.read()?.phase).toBe('accepting')
      expect(target.read()?.epoch).not.toBe(oldEpoch)
      expect(await next.shutdown()).toBe(true)
    },
  )
  it('recovers a missing or torn record using the existing writer lock', async () => {
    for (const bytes of ['', '{torn']) {
      const target = await f.fixture()
      await mkdir(join(target.root, 'supervisor'), { recursive: true })
      await writeFile(join(target.root, 'supervisor/owner-lock.sqlite'), '', { mode: 0o600 })
      if (bytes) await writeFile(join(target.root, 'supervisor/owner.json'), bytes)
      const owner = await target.start()
      const lease = await target.attach()
      expect(await lease.close()).toBe(true)
      expect(await owner.shutdown()).toBe(true)
    }
  })
  it('a rejected start with no returned child leaves other plugins and starts usable', async () => {
    const target = await f.fixture(),
      owner = await target.start(),
      lease = await target.attach()
    const stop = vi.fn(),
      gone = vi.fn(async () => false)
    owner.adopt({ stop, exited: Promise.resolve(), descendantsGone: gone })
    await expect(
      owner.startChild(async () => {
        throw new Error('fictional spawn refusal')
      }),
    ).rejects.toThrow()
    expect(owner.acceptsStarts()).toBe(true)
    expect(owner.valid(lease.lease, lease.epoch)).toBe(true)
    const secondStop = vi.fn()
    await owner.startChild(async () => ({
      stop: secondStop,
      exited: Promise.resolve(),
      descendantsGone: gone,
    }))
    expect(await owner.shutdown()).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
    expect(secondStop).toHaveBeenCalledOnce()
    expect(gone).not.toHaveBeenCalled()
  })
  it.each(['rejected', 'hung'])(
    'a %s UI acknowledgement cannot block a child-free owner or its successor',
    async (kind) => {
      const target = await f.fixture()
      const revoke = vi.fn(() =>
        kind === 'hung'
          ? new Promise<void>(() => {})
          : Promise.reject(new Error('fictional UI gone')),
      )
      const owner = await target.start({ revoke, drainWithin: 30 })
      await target.attach()
      owner.adopt({
        inProcess: true,
        stop: revoke,
        exited: new Promise<void>(() => {}),
        descendantsGone: async () => false,
      })
      expect(await owner.shutdown()).toBe(true)
      await owner.closed
      const next = await target.start()
      expect(next.acceptsStarts()).toBe(false)
      expect(target.read()?.phase).toBe('accepting')
    },
  )
  it.each(['failed', 'hung'])(
    'lifecycle bridge close is called once and a %s reply cannot retain an empty writer',
    async (kind) => {
      const target = await f.fixture(),
        owner = await target.start()
      const close = vi.fn(() =>
        kind === 'hung'
          ? new Promise<void>(() => {})
          : Promise.reject(new Error('fictional bridge gone')),
      )
      owner.bindAgentBridge({ routes: async () => ({}), revoke() {}, close })
      expect(await owner.shutdown()).toBe(true)
      expect(close).toHaveBeenCalledOnce()
      expect(await owner.shutdown()).toBe(true)
      expect(close).toHaveBeenCalledOnce()
      await target.start()
    },
  )
  it('an actual exit completes shutdown even if the stop acknowledgement never returns', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    await target.attach()
    const stop = vi.fn(() => new Promise<void>(() => {}))
    owner.adopt({ stop, exited: Promise.resolve(), descendantsGone: async () => false })
    expect(await owner.shutdown()).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
    await target.start()
  })
  it('retains the fence for an unresolved owned exit after the caller stops waiting', async () => {
    const target = await f.fixture(),
      owner = await target.start({ drainWithin: 20 })
    await target.attach()
    const exit = deferred<void>()
    f.releases.push(() => exit.resolve())
    const stop = vi.fn()
    owner.adopt({ stop, exited: exit.promise, descendantsGone: async () => false })
    expect(await owner.shutdown()).toBe(false)
    expect(stop).toHaveBeenCalledOnce()
    await expect(
      PluginSupervisor.start({ root: target.root, workspaceRoots: [] }),
    ).rejects.toMatchObject({ code: 'busy' })
    exit.resolve()
    await owner.closed
    expect(target.read()?.phase).toBe('stopped')
    await target.start()
  })
  it('settles a late rejected start during drain without retaining a fictional process obligation', async () => {
    const target = await f.fixture(),
      owner = await target.start({ drainWithin: 20 })
    await target.attach()
    const start = deferred<never>()
    f.releases.push(() => start.reject(new Error('fictional start refused')))
    const pending = owner.startChild(() => start.promise)
    const rejected = expect(pending).rejects.toThrow('fictional start refused')
    expect(await owner.shutdown()).toBe(false)
    start.reject(new Error('fictional start refused'))
    await rejected
    await owner.closed
    await target.start()
  })
  it('discovery write failure cannot retain a zero-child writer after teardown', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    const original = SupervisorStorage.prototype.write
    vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
      this: SupervisorStorage,
      value,
    ) {
      if (value.phase !== 'accepting') throw new Error('fictional disk unavailable')
      return original.call(this, value)
    })
    expect(await owner.shutdown()).toBe(true)
    await owner.closed
    vi.restoreAllMocks()
    await target.start()
  })
  it('preserves historical files and selected plugin data while recovering', async () => {
    const target = await f.fixture()
    await mkdir(join(target.root, 'host/runs', randomUUID()), { recursive: true })
    const data = join(target.root, 'selected-data.json')
    await writeFile(data, 'fictional selected data')
    const owner = await target.start()
    expect(await readFile(data, 'utf8')).toBe('fictional selected data')
    expect(await owner.shutdown()).toBe(true)
    expect(await readFile(data, 'utf8')).toBe('fictional selected data')
  })
})
