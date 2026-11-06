import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OWNER_LIMITS } from '../src/main/plugins/supervisor/protocol'
import { supervisorFixtures } from './plugin-supervisor-fixtures'

// The live event on 0.2.5: an app busy or suspended past the 60 s expiry had its registration removed,
// the owner drained, and Settings and the plugin routes were lost until a restart. The app's held
// connection now ends its registration only when it closes.
const f = supervisorFixtures()
afterEach(async () => {
  vi.restoreAllMocks()
  await f.cleanup()
})

it('a heartbeat ten minutes late does not drain an owner whose app is still connected', async () => {
  let now = 0
  const target = await f.fixture(),
    owner = await target.start({ now: () => now })
  const lease = await target.attach()
  const workspaceRoot = join(target.folder, 'second')
  await mkdir(workspaceRoot)
  const second = await target.attach({ workspaceRoot })
  now = 10 * 60 * 1000 // No renewal at all in that time.
  await owner.tick()
  expect(owner.valid(lease.lease, lease.epoch)).toBe(true)
  expect(owner.valid(second.lease, second.epoch)).toBe(true)
  expect(owner.acceptsStarts()).toBe(true)
  expect(target.read()?.phase).toBe('accepting')
  expect(lease.standing()).toBe(true)
  expect(await second.close()).toBe(true)
  expect(await lease.close()).toBe(true)
  expect(target.read()?.phase).toBe('stopped')
})

it('the app ending closes its held connection, which ends its registration and drains the owner', async () => {
  let now = 0
  const target = await f.fixture(),
    owner = await target.start({ now: () => now })
  const lease = await target.attach()
  expect(owner.valid(lease.lease, lease.epoch)).toBe(true)
  // An app process that dies sends no release; the operating system closes its connection.
  lease.abandon()
  await vi.waitFor(() => expect(owner.valid(lease.lease, lease.epoch)).toBe(false))
  now += OWNER_LIMITS.heartbeat
  await owner.tick()
  await vi.waitFor(() => expect(target.read()?.phase).toBe('stopped'))
})

it('the app learns at once when the owner goes away', async () => {
  const target = await f.fixture(),
    owner = await target.start()
  const lost = vi.fn()
  const lease = await target.attach({ onLost: lost })
  expect(await owner.shutdown()).toBe(true)
  await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce())
  expect(lease.standing()).toBe(false)
})

it('a refused hold from an owner that offers it fails the attach by name, not back to expiry', async () => {
  const target = await f.fixture(),
    owner = await target.start()
  // The first registration lookup after hello is the hold's; refuse that one.
  const leases = (owner as unknown as { leases: Map<string, unknown> }).leases
  const get = leases.get.bind(leases)
  let refuseNext = true
  leases.get = (key: string) => {
    if (!refuseNext) return get(key)
    refuseNext = false
    return undefined
  }
  await expect(target.attach()).rejects.toMatchObject({
    code: 'unavailable',
    diagnostic: { phase: 'accepting', stage: 'hold' },
  })
  // The registration it made at hello is released, so no expiring lease is left behind.
  expect(leases.size).toBe(0)
})
