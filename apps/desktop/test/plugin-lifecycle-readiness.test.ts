import { afterEach, describe, expect, it, vi } from 'vitest'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { OWNER_LAUNCH_MS } from '../src/main/plugins/supervisor/protocol'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { connectPersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import type { createPluginNodeHost } from '../src/main/plugins/node-host'
import { cleanupLifecycleFixtures, deferred, fixture } from './plugin-lifecycle-fixtures'
import { supervisorFixtures } from './plugin-supervisor-fixtures'

const owners = supervisorFixtures()
afterEach(async () => {
  vi.restoreAllMocks()
  await owners.cleanup()
  await cleanupLifecycleFixtures()
})

describe.skipIf(process.platform === 'win32')('the lifecycle readiness publication', () => {
  async function start() {
    const f = await fixture()
    const owner = await PluginSupervisor.start({
      root: f.root,
      workspaceRoots: [f.workspace],
      lifecycle: true,
    })
    const storage = new SupervisorStorage(f.root, [f.workspace], false)
    const lease = await PluginWorkspaceLease.attach({
      root: f.root,
      workspaceRoot: f.workspace,
      generation: randomUUID(),
      build: 'fictional',
    })
    const create = () =>
      createSupervisorLifecycle({
        owner,
        host: { start: vi.fn(), removePackage: vi.fn() } as unknown as ReturnType<
          typeof createPluginNodeHost
        >,
        lifecycle: f.opts,
        personKey: 'a'.repeat(64),
        read: async () => ({}),
      })
    async function close() {
      lease.abandon()
      await owner.shutdown()
      await owner.closed
      storage.close()
    }
    return { ...f, owner, storage, lease, create, close }
  }

  it('publishes ready only after the listening person server is adopted', async () => {
    const f = await start()
    const adopt = deferred<void>()
    const startChild = f.owner.startChild.bind(f.owner)
    vi.spyOn(f.owner, 'startChild').mockImplementationOnce(async (child) => {
      await adopt.promise
      return startChild(child)
    })
    const creating = f.create()
    let channel: Awaited<ReturnType<typeof connectPersonPluginControl>> | undefined
    try {
      await vi.waitFor(async () => {
        expect((await lstat(join(f.root, 'person-control/person.sock'))).isSocket()).toBe(true)
      })
      expect(f.storage.read()).toMatchObject({ phase: 'accepting', lifecycleReady: false })
      adopt.resolve()
      await creating
      await f.lease.lifecycleReady()
      expect(f.storage.read()).toMatchObject({ epoch: f.lease.epoch, lifecycleReady: true })
      channel = await connectPersonPluginControl({
        path: join(f.root, 'person-control/person.sock'),
        key: 'a'.repeat(64),
        handle: async () => true,
      })
      await expect(channel.call({ kind: 'attach', workspaceId: randomUUID() })).resolves.toEqual({
        personProtocol: 2,
      })
    } finally {
      adopt.resolve()
      await creating.catch(() => undefined)
      channel?.close()
      await f.close()
    }
  })

  it('keeps readiness false when person-server adoption fails', async () => {
    const f = await start()
    try {
      vi.spyOn(f.owner, 'startChild').mockRejectedValueOnce(new Error('fictional adoption failure'))
      await expect(f.create()).rejects.toMatchObject({ code: 'unavailable' })
      expect(f.storage.read()).toMatchObject({ lifecycleReady: false })
      await expect(lstat(join(f.root, 'person-control/person.sock'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await f.close()
    }
  })
})

it('keeps cold bootstrap within the original owner launch budget', async () => {
  const target = await owners.fixture()
  const original = performance.now.bind(performance)
  let elapsed = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => original() + elapsed)
  const lease = await target.attach({
    launch: async () => {
      await target.start({ lifecycle: true, now: original })
      elapsed += OWNER_LAUNCH_MS - 1000
    },
  })
  try {
    elapsed += 1001
    await expect(lease.lifecycleReady()).rejects.toMatchObject({
      code: 'unavailable',
      cause: { message: 'Plugin lifecycle did not become ready within the owner launch budget' },
    })
  } finally {
    lease.abandon()
    clock.mockRestore()
  }
})

it('keeps older owners without a lifecycle field attachable', async () => {
  const target = await owners.fixture()
  await target.start()
  const lease = await target.attach()
  await expect(lease.lifecycleReady()).resolves.toBeUndefined()
})
