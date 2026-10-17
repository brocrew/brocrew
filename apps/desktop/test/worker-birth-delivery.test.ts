import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('a first worker birth is bound before any brief can reach it', () => {
  let world: AServiceWorld
  let identity: string
  beforeEach(() => {
    world = aServiceWorld()
    identity = world.anAgent('document-reader', 'normal').id
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  async function setup() {
    const host = world.aHost()
    const caller = (
      await host.createSession(
        { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    let release = () => {}
    world.startsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = world.gives(host, caller, 'document-reader', { parallel: true })
    const ordinary = world.gives(host, caller, 'document-reader')
    void first.catch(() => {})
    void ordinary.catch(() => {})
    expect(world.kept(identity)?.workerPools?.[0]?.workers[0]?.phase).toBe('reserved')
    expect(world.store.workersBorn()).toEqual([])
    return { host, release, first, ordinary }
  }

  it('a queued ordinary brief also waits for the durable binding, after the native start returns', async () => {
    const phases: unknown[] = []
    const push = world.sent.push.bind(world.sent)
    vi.spyOn(world.sent, 'push').mockImplementation((...items) => {
      phases.push(world.kept(identity)?.workerPools?.[0]?.workers[0]?.phase)
      return push(...items)
    })
    const { release, first, ordinary } = await setup()
    try {
      release()
      const results = await Promise.allSettled([first, ordinary])
      expect(results.map((one) => one.status)).toEqual(['fulfilled', 'fulfilled'])
      for (const one of results) if (one.status === 'fulfilled') expect(one.value.ok).toBe(true)
      expect(phases).toEqual(['bound', 'bound'])
      expect(world.sent.filter((one) => one.as === 'document-reader')).toHaveLength(2)
    } finally {
      release()
      world.startsWait = null
      await Promise.allSettled([first, ordinary])
    }
  })

  it('a failed bound-file write lets neither the first parallel brief nor its queued ordinary brief through', async () => {
    const { release, first, ordinary } = await setup()
    try {
      world.writesFail = 'workerPools'
      release()
      const results = await Promise.allSettled([first, ordinary])
      expect(results.map((one) => one.status)).toEqual(['rejected', 'rejected'])
      expect(world.sent).toEqual([])
      const born = world.store.workersBorn()
      expect(born).toHaveLength(1)
      expect(
        world.store.piecesOwnedBy(born[0]!.conversation).filter((one) => one.giver !== null),
      ).toEqual([])
      expect(world.kept(identity)?.workerPools?.[0]?.workers[0]?.phase).toBe('reserved')
    } finally {
      release()
      world.startsWait = null
      world.writesFail = 'none'
      await Promise.allSettled([first, ordinary])
    }
  })
})
