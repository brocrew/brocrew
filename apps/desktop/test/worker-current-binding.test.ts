import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('a worker binding needs its complete current record', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
    world.anAgent('document-reader', 'normal')
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  async function completed() {
    const host = world.aHost()
    const caller = (
      await host.createSession(
        { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    const given = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error('setup refused')
    expect(
      await host.replyToParent(
        {
          piece: given.piece,
          outcome: 'done',
          summary: 'Draft checked.',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: agentCallerId(given.owner) },
      ),
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(world.handleOf('document-reader').status()).toBe('idle'))
    return { host, caller, worker: given.owner }
  }

  for (const parallel of [false, true]) {
    it(`holds a missing replacement target with parallel ${parallel}, without a delivery or birth`, async () => {
      const { host, caller, worker } = await completed()
      world.store.append(
        worker,
        world.store.nextOrdinal(worker),
        { type: 'replaced_by', sessionId: 'missing-successor' },
        world.clock++,
      )
      const before = {
        sent: world.sent.slice(),
        births: world.store.workersBorn(),
        conversations: world.conversationsRecorded(),
      }
      expect(await world.gives(host, caller, 'document-reader', { parallel })).toMatchObject({
        ok: false,
        refusal: {
          rail: 'worker-binding-is-unknown',
          reason:
            "Not given: 'document-reader' has no known conversation. Tell a person, and give it again once that is fixed.",
        },
      })
      expect(world.sent).toEqual(before.sent)
      expect(world.store.workersBorn()).toEqual(before.births)
      expect(world.conversationsRecorded()).toBe(before.conversations)
      expect(() => world.store.workerInItsPlace(worker)).toThrow('target is missing')
    })
  }

  it('keeps real in-flight reservations distinct while an ordinary give waits on the primary', async () => {
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
    const second = world.gives(host, caller, 'document-reader', { parallel: true })
    const ordinary = world.gives(host, caller, 'document-reader')
    void first.catch(() => {})
    void second.catch(() => {})
    void ordinary.catch(() => {})
    try {
      const identity = world.store.agentIdentities().find((one) => one.slug === 'document-reader')!
      expect(
        world
          .kept(identity.id)
          ?.workerPools?.[0]?.workers.map((one) => ({ number: one.number, phase: one.phase })),
      ).toEqual([
        { number: 1, phase: 'reserved' },
        { number: 2, phase: 'reserved' },
      ])
      expect(world.store.workersBorn()).toEqual([])
      expect(world.sent).toEqual([])
      release()
      const [a, b, c] = await Promise.all([first, second, ordinary])
      expect(a.ok && b.ok && c.ok).toBe(true)
      if (!a.ok || !b.ok || !c.ok) throw new Error('reserved gives refused')
      expect(b.owner).not.toBe(a.owner)
      expect(c.owner).toBe(a.owner)
      expect(world.store.workersBorn().map((one) => one.number)).toEqual([1, 2])
      expect(world.sent.filter((one) => one.as === 'document-reader')).toHaveLength(3)
    } finally {
      release()
      world.startsWait = null
      await Promise.allSettled([first, second, ordinary])
    }
  })

  it('does not resolve an absent first record as a current worker', () => {
    expect(() => world.store.workerLineage('missing-worker')).toThrow('record is missing')
    expect(() => world.store.workerInItsPlace('missing-worker')).toThrow('record is missing')
    expect(() => world.store.workerGiverContains('missing-giver', 'missing-giver')).toThrow(
      'record is missing',
    )
  })

  it('keeps an unchanged worker current and follows a complete replacement for ordinary and parallel work', async () => {
    const { host, caller, worker } = await completed()
    expect(world.store.workerInItsPlace(worker)).toBe(worker)
    const successor = (
      await host.createSession(
        {
          provider: 'claude',
          profileId: 'document-reader',
          cwd: world.folder,
          approvalMode: 'auto',
        },
        world.window,
      )
    ).sessionId
    world.db
      .prepare('UPDATE provider_session SET parent_session_id = ? WHERE id = ?')
      .run(caller, successor)
    world.store.append(
      worker,
      world.store.nextOrdinal(worker),
      { type: 'replaced_by', sessionId: successor },
      world.clock++,
    )
    expect(world.store.workerLineage(worker)).toEqual([worker, successor])
    expect(world.store.workerInItsPlace(worker)).toBe(successor)
    await host.closeAll()
    const next = world.aHost()
    await next.reopenForAPerson(caller, world.window, null)
    const ordinary = await world.gives(next, caller, 'document-reader')
    expect(ordinary).toMatchObject({ ok: true, owner: successor, found: successor })
    if (!ordinary.ok) throw new Error('complete replacement refused')
    expect(
      await next.replyToParent(
        {
          piece: ordinary.piece,
          outcome: 'done',
          summary: 'Replacement draft checked.',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: agentCallerId(successor) },
      ),
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(world.handleOf('document-reader').status()).toBe('idle'))
    expect(await world.gives(next, caller, 'document-reader', { parallel: true })).toMatchObject({
      ok: true,
      owner: successor,
      found: successor,
    })
    expect(world.store.workersBorn()).toHaveLength(1)
  })
})
