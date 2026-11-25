import { randomUUID } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import {
  APP_HELD_CONNECTION,
  OWNER_LIMITS,
  OWNER_WIRE,
  unpack,
  type Command,
} from '../src/main/plugins/supervisor/protocol'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { interpose } from './helpers/supervisor-interpose'
import { deferred, supervisorFixtures } from './plugin-supervisor-fixtures'

const fixtures = supervisorFixtures()
const renewingWire = {
  ...OWNER_WIRE,
  features: OWNER_WIRE.features.filter((one) => one !== APP_HELD_CONNECTION),
}
afterEach(async () => {
  vi.useRealTimers()
  await fixtures.cleanup()
})

describe.skipIf(process.platform === 'win32')('owner admission and Quit', () => {
  it('uses fenced recovery when an accepting incumbent keeps its hello socket silent', async () => {
    const target = await fixtures.fixture()
    const { root } = target
    const owner = await target.start({ tickEvery: 20 })
    const incumbent = await target.attach()
    const second = await fixtures.fixture()
    const proxy = await interpose(root)
    const withheld = deferred<void>()
    const received = deferred<void>()
    proxy.plan.beforeReply = (packet) => {
      if ((unpack(packet.trim()) as { command: Command }).command.kind !== 'hello') return
      proxy.plan.beforeReply = undefined
      received.resolve()
      return withheld.promise
    }
    const launch = vi.fn(async () => {
      await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
        code: 'busy',
      })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const attaching = target.attach({
      workspaceRoot: second.workspaceRoot,
      generation: randomUUID(),
      wire: renewingWire,
      launch,
    })
    try {
      await received.promise
      await vi.advanceTimersByTimeAsync(OWNER_LIMITS.request + 20)
      await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce(), { timeout: 500 })
      const next = await attaching
      expect(next.epoch).toBe(incumbent.epoch)
      expect(owner.valid(incumbent.lease, incumbent.epoch)).toBe(true)
    } finally {
      vi.useRealTimers()
      withheld.resolve()
      await (await attaching).close()
      await proxy.close()
    }
  })

  it('settles a registered but unanswered hello before quitting and releases the lease', async () => {
    const target = await fixtures.fixture()
    const { root, workspaceRoot } = target
    await target.start({ tickEvery: 20 })
    const proxy = await interpose(root)
    const registered = deferred<void>()
    const answer = deferred<void>()
    proxy.plan.beforeReply = (packet) => {
      if ((unpack(packet.trim()) as { command: Command }).command.kind !== 'hello') return
      registered.resolve()
      return answer.promise
    }
    const app = new PluginSupervisorAttachment()
    try {
      app.start({ root, workspaceRoot, build: 'fictional', wire: renewingWire })
      await registered.promise
      let settled = false
      const quitting = app.quit().then(() => {
        settled = true
      })
      await nextTurn()
      expect(settled).toBe(false)
      answer.resolve()
      await quitting
      const storage = new SupervisorStorage(root, [workspaceRoot], false)
      try {
        expect(storage.read()?.phase).toBe('stopped')
        expect(storage.readStop()).toMatchObject({ reason: 'released' })
      } finally {
        storage.close()
      }
    } finally {
      answer.resolve()
      await app.quit()
      await proxy.close()
    }
  })

  it('joins successor release when Quit interrupts recovery during hold', async () => {
    const target = await fixtures.fixture()
    const { root, workspaceRoot } = target
    const app = new PluginSupervisorAttachment()
    app.start({ root, workspaceRoot, build: 'fictional' })
    expect(await app.ready()).toBe(false)
    const owner = await target.start({ tickEvery: 20 })
    const second = await fixtures.fixture()
    const other = await target.attach({
      workspaceRoot: second.workspaceRoot,
      generation: randomUUID(),
    })
    const proxy = await interpose(root)
    const held = deferred<void>()
    const holdReply = deferred<void>()
    const releasing = deferred<void>()
    const releaseReply = deferred<void>()
    proxy.plan.beforeReply = (packet) => {
      const command = (unpack(packet.trim()) as { command: Command }).command
      if (command.kind === 'hold') {
        held.resolve()
        return holdReply.promise
      }
      if (command.kind === 'release') {
        releasing.resolve()
        return releaseReply.promise
      }
    }
    const recovering = app.recover()
    try {
      await held.promise
      let settled = false
      const quitting = app.quit().then(() => {
        settled = true
      })
      await releasing.promise
      expect(settled).toBe(false)
      releaseReply.resolve()
      await quitting
      expect(await recovering).toBe(false)
      expect(owner.valid(other.lease, other.epoch)).toBe(true)
    } finally {
      holdReply.resolve()
      releaseReply.resolve()
      await app.quit()
      await recovering
      await proxy.close()
    }
  })

  it('does not launch after Quit interrupts a draining owner probe that has not answered', async () => {
    const target = await fixtures.fixture()
    const second = await fixtures.fixture()
    const { root } = target
    const owner = await target.start({ tickEvery: 20 })
    await target.attach()
    const exited = deferred<void>()
    owner.adopt({
      stop() {},
      exited: exited.promise,
      descendantsGone: async () => true,
    })
    const draining = owner.shutdown()
    expect(target.read()?.phase).toBe('draining')
    const proxy = await interpose(root)
    const probed = deferred<void>()
    const answer = deferred<void>()
    proxy.plan.beforeReply = (packet) => {
      if ((unpack(packet.trim()) as { command: Command }).command.kind !== 'probe') return
      probed.resolve()
      return answer.promise
    }
    const app = new PluginSupervisorAttachment()
    const launch = vi.fn(async () => {
      throw new Error('fictional successor should not start after Quit')
    })
    try {
      app.start({ root, workspaceRoot: second.workspaceRoot, build: 'fictional', launch })
      await probed.promise
      exited.resolve()
      expect(await draining).toBe(true)
      expect(target.read()?.phase).toBe('stopped')
      await app.quit()
      await nextTurn()
      expect(launch).not.toHaveBeenCalled()
    } finally {
      exited.resolve()
      answer.resolve()
      await app.quit()
      await proxy.close()
    }
  })
})
