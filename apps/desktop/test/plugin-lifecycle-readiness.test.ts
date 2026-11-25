import { afterEach, describe, expect, it, vi } from 'vitest'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Socket } from 'node:net'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { connectPersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { localEndpoint } from '../src/main/plugins/local-endpoint'
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

it.each(['challenge', 'cancel'] as const)(
  'ends the person handshake on %s even when the peer is slow',
  async (action) => {
    const target = await owners.fixture()
    const path = join(target.workspaceRoot, 'fictional-person.sock')
    const key = 'a'.repeat(64)
    const accepted = deferred<Socket>()
    const server = createServer((socket) => accepted.resolve(socket))
    server.listen(localEndpoint(path, 'person', key))
    await once(server, 'listening')
    const stopping = new AbortController()
    let socket: Socket | undefined
    let settled = false
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const connecting = connectPersonPluginControl({
      path,
      key,
      handle: async () => true,
      signal: stopping.signal,
    }).then(
      (channel) => {
        settled = true
        channel.close()
        return { connected: true }
      },
      (error: unknown) => {
        settled = true
        return { error }
      },
    )
    try {
      socket = await accepted.promise
      if (action === 'challenge') {
        await vi.advanceTimersByTimeAsync(2_100)
        expect(settled).toBe(false)
        socket.write(key + '\n')
        expect(await connecting).toEqual({ connected: true })
      } else {
        stopping.abort(new Error('fictional app quit'))
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(true)
        expect(await connecting).toMatchObject({
          error: { code: 'unavailable', cause: { message: 'fictional app quit' } },
        })
      }
    } finally {
      vi.useRealTimers()
      socket?.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

it('waits for the current owner to publish lifecycle readiness past the former launch deadline', async () => {
  const target = await owners.fixture()
  const original = performance.now.bind(performance)
  let elapsed = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => original() + elapsed)
  const owner = await target.start({ lifecycle: true, now: original })
  const lease = await target.attach()
  const stopping = new AbortController()
  elapsed = 65_000
  let settled = false
  const bootstrapping = lease.lifecycleReady(stopping.signal).then(
    () => {
      settled = true
      return { ready: true }
    },
    (error: unknown) => {
      settled = true
      return { error }
    },
  )
  try {
    await nextTurn()
    expect(settled).toBe(false)
    owner.markLifecycleReady()
    expect(await bootstrapping).toEqual({ ready: true })
  } finally {
    stopping.abort()
    await bootstrapping
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
