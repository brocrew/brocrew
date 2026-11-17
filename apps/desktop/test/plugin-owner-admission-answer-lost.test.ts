import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import {
  APP_HELD_CONNECTION,
  OWNER_LIMITS,
  OWNER_WIRE,
} from '../src/main/plugins/supervisor/protocol'
import { supervisorFixtures } from './plugin-supervisor-fixtures'
import { interpose } from './helpers/supervisor-interpose'

const { fixture, cleanup } = supervisorFixtures()
afterEach(cleanup)

describe.skipIf(process.platform === 'win32')('the first answer of a new plugin service', () => {
  it('is lost: the retry is admitted within seconds by the same service', async () => {
    const { root, workspaceRoot, start, attach } = await fixture()
    let proxy: Awaited<ReturnType<typeof interpose>> | undefined
    const launch = vi.fn(async () => {
      await start()
      proxy = await interpose(root)
      proxy.plan.hold = 1
    })
    const app = new PluginSupervisorAttachment()
    const options = { root, workspaceRoot, build: 'fictional', launch }
    app.start(options)
    // The service registered this app, but its answer never arrived.
    expect(await app.ready()).toBe(false)
    await proxy!.close()

    const retried = performance.now()
    app.start(options)
    expect(await app.ready()).toBe(true)
    expect(performance.now() - retried).toBeLessThan(OWNER_LIMITS.request)
    expect(launch).toHaveBeenCalledTimes(1)
    // Another app on the same workspace is still refused.
    await expect(attach({ generation: randomUUID() })).rejects.toMatchObject({
      code: 'busy',
      diagnostic: { reason: 'duplicate-workspace' },
    })
    await app.quit()
  })

  it('comes while the app is stalled past the wait: the answer is still read', async () => {
    const { root, start, attach } = await fixture()
    await start()
    const proxy = await interpose(root)
    try {
      proxy.plan.stall = OWNER_LIMITS.request + 500
      const lease = await attach({
        wire: {
          ...OWNER_WIRE,
          features: OWNER_WIRE.features.filter((one) => one !== APP_HELD_CONNECTION),
        },
      })
      expect(proxy.replies).toHaveLength(1)
      expect(lease.standing()).toBe(true)
    } finally {
      await proxy.close()
    }
  })

  it('is asked for by start and recovery at once: one registration, released once', async () => {
    const { root, workspaceRoot, start, attach, read } = await fixture()
    await start()
    const app = new PluginSupervisorAttachment()
    app.start({ root, workspaceRoot, build: 'fictional' })
    const recovered = app.recover()
    expect(await app.ready()).toBe(true)
    expect(await recovered).toBe(true)
    expect(app.holdsLease()).toBe(true)
    await expect(attach({ generation: randomUUID() })).rejects.toMatchObject({
      code: 'busy',
      diagnostic: { reason: 'duplicate-workspace' },
    })
    await app.quit()
    expect(read()?.phase).toBe('stopped')
  })
})

describe.skipIf(process.platform === 'win32')(
  'a challenge that arrives after the time is up',
  () => {
    it('is not answered, so the service registers nothing', async () => {
      const { root, start, attach } = await fixture()
      await start()
      const proxy = await interpose(root)
      const original = performance.now.bind(performance)
      let elapsed = 0
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => original() + elapsed)
      try {
        proxy.plan.beforeChallenge = () => {
          elapsed += OWNER_LIMITS.request + 500
          proxy.plan.beforeChallenge = undefined
        }
        await expect(attach()).rejects.toMatchObject({ code: 'cleanup-pending' })
        expect(proxy.requests).toHaveLength(0)
      } finally {
        clock.mockRestore()
        await proxy.close()
      }
      // Nothing was registered, so another app is admitted at once.
      expect((await attach({ generation: randomUUID() })).standing()).toBe(true)
    })
  },
)
