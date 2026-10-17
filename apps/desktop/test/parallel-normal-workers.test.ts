import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THE_APP_ITSELF, type RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('normal parallel workers', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('document-reader', 'normal')
  })
  afterEach(async () => {
    await world.cleanUp()
  })
  const idleCaller = async (host: RuntimeHost): Promise<string> =>
    (
      await host.createSession(
        {
          provider: 'claude',
          profileId: 'review-lead',
          cwd: world.folder,
          approvalMode: 'auto',
        },
        world.window,
      )
    ).sessionId

  it('starts another worker for an idle process that still holds its first piece, keeping one profile', async () => {
    const host = world.aHost()
    const caller = await idleCaller(host)
    const first = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('first give refused')
    await vi.waitFor(() => {
      expect(world.handleOf('document-reader').status()).toBe('idle')
    })
    const second = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('second give refused')
    expect(second.owner).not.toBe(first.owner)
    expect(
      world.store.agentIdentities().filter((one) => one.slug === 'document-reader'),
    ).toHaveLength(1)
    expect(world.store.workersBorn().map((one) => one.number)).toEqual([1, 2])
    expect(world.store.workById(first.piece)?.owner).toBe(first.owner)
    expect(world.store.workById(second.piece)?.owner).toBe(second.owner)
    expect(world.ledger(first.owner)[0]?.type).toBe('worker_registered')
  })

  it('ordinary gives keep the primary before and after an extra, including after a host restart', async () => {
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'review-lead')
    const first = await world.gives(host, caller, 'document-reader', { parallel: true })
    const second = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('parallel setup refused')
    const ordinary = await world.gives(host, caller, 'document-reader')
    expect(ordinary).toMatchObject({ ok: true, owner: first.owner })
    await host.closeAll()
    const next = world.aHost()
    await next.reopenForAPerson(caller, world.window, null)
    const again = await world.gives(next, caller, 'document-reader')
    expect(again).toMatchObject({ ok: true, owner: first.owner })
    expect(world.store.workersBorn()).toHaveLength(2)
  })

  it('reuses a worker only after its piece ends and its provider turn drains', async () => {
    const host = world.aHost()
    const caller = await idleCaller(host)
    const first = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('setup refused')
    const reply = await host.replyToParent(
      {
        piece: first.piece,
        outcome: 'done',
        summary: 'Draft checked.',
        resourcePaths: [],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(first.owner) },
    )
    expect(reply.ok).toBe(true)
    await vi.waitFor(() => {
      expect(world.handleOf('document-reader').status()).toBe('idle')
    })
    const next = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(next).toMatchObject({ ok: true, owner: first.owner })
    expect(world.store.workersBorn()).toHaveLength(1)
  })

  it('keeps two giver pools separate even when their profiles and folders match', async () => {
    const host = world.aHost()
    const firstCaller = await world.aPersonOpens(host, 'review-lead')
    const otherCaller = await world.aPersonOpens(host, 'review-lead')
    const first = await world.gives(host, firstCaller, 'document-reader', { parallel: true })
    const otherGive = world.gives(host, otherCaller, 'document-reader', { parallel: true })
    await expect(otherGive).resolves.toMatchObject({ ok: true })
    const other = await otherGive
    expect(first.ok && other.ok).toBe(true)
    if (!first.ok || !other.ok) throw new Error('setup refused')
    expect(other.owner).not.toBe(first.owner)
    expect(
      world.store.workersBorn().map((one) => ({ number: one.number, giver: one.giver })),
    ).toEqual([
      { number: 1, giver: firstCaller },
      { number: 1, giver: otherCaller },
    ])
  })

  const completed = async () => {
    const host = world.aHost()
    const caller = await idleCaller(host)
    const given = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error('setup refused')
    const reply = await host.replyToParent(
      {
        piece: given.piece,
        outcome: 'done',
        summary: 'Draft checked.',
        resourcePaths: [],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(given.owner) },
    )
    expect(reply.ok).toBe(true)
    await vi.waitFor(() => {
      expect(world.handleOf('document-reader').status()).toBe('idle')
    })
    return { host, caller, worker: given.owner }
  }

  it('an idle process with an open provider card is unavailable until that card is answered', async () => {
    const { host, caller, worker } = await completed()
    const handle = world.handles.find((one) => one.as === 'document-reader')!.handle
    const question = handle.simulateUserInput('Choose a fictional draft', ['blue'])
    void question.answered.catch(() => {})
    await vi.waitFor(() => {
      expect(
        world
          .ledger(worker)
          .some((one) => one.type === 'user_input_request' && one.id === question.id),
      ).toBe(true)
    })
    expect(handle.status()).toBe('idle')
    const during = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(during.ok).toBe(true)
    if (!during.ok) throw new Error('give refused')
    expect(during.owner).not.toBe(worker)
    host.claimSession(worker, world.window)
    await host.respondUserInput(
      worker,
      question.id,
      { kind: 'answer', answers: { q0: ['blue'] } },
      world.window,
    )
    await question.answered
    const after = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(after).toMatchObject({ ok: true, owner: worker })
  })

  it('a stopped worker with unended planning is not reused', async () => {
    const { host, caller, worker } = await completed()
    await host.close(worker, THE_APP_ITSELF)
    world.db
      .prepare('UPDATE provider_session SET plan_mode = 1, plan_ended_at = NULL WHERE id = ?')
      .run(worker)
    const next = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('give refused')
    expect(next.owner).not.toBe(worker)
    expect(world.store.find(worker)?.planMode).toBe(true)
  })

  it('a stopped completed worker is reused when its record is complete', async () => {
    const { host, caller, worker } = await completed()
    await host.close(worker, THE_APP_ITSELF)
    const next = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(next).toMatchObject({ ok: true, owner: worker })
    expect(world.store.workersBorn()).toHaveLength(1)
  })

  it('a torn card row prevents reuse rather than becoming an empty reading', async () => {
    const { host, caller, worker } = await completed()
    const handle = world.handles.find((one) => one.as === 'document-reader')!.handle
    const question = handle.simulateUserInput('Choose a fictional draft', ['blue'])
    void question.answered.catch(() => {})
    await vi.waitFor(() => {
      expect(world.ledger(worker).some((one) => one.type === 'user_input_request')).toBe(true)
    })
    world.db
      .prepare(
        "UPDATE events SET payload = '{' WHERE session_id = ? AND type = 'user_input_request'",
      )
      .run(worker)
    const next = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('give refused')
    expect(next.owner).not.toBe(worker)
  })

  it('a delivery awaiting confirmation reserves its worker before another parallel give', async () => {
    const host = world.aHost()
    const caller = await idleCaller(host)
    let confirm!: () => void
    world.sendsSettle = new Promise<void>((resolve) => {
      confirm = resolve
    })
    const first = world.gives(host, caller, 'document-reader', { parallel: true })
    void first.catch(() => {})
    try {
      await vi.waitFor(() => {
        expect(world.store.workersBorn()).toHaveLength(1)
      })
      const second = world.gives(host, caller, 'document-reader', { parallel: true })
      void second.catch(() => {})
      await vi.waitFor(() => {
        expect(world.store.workersBorn()).toHaveLength(2)
      })
      const identity = world.store.agentIdentities().find((one) => one.slug === 'document-reader')!
      const workers = world.kept(identity.id)!.workerPools![0]!.workers
      expect(workers.every((one) => one.assignment !== undefined)).toBe(true)
      confirm()
      const one = await first
      const two = await second
      expect(one.ok && two.ok).toBe(true)
      if (!one.ok || !two.ok) throw new Error('give refused')
      expect(one.owner).not.toBe(two.owner)
      expect(
        world
          .kept(identity.id)!
          .workerPools![0]!.workers.every((binding) => binding.assignment === undefined),
      ).toBe(true)
    } finally {
      confirm()
      await first.catch(() => {})
    }
  })

  it('allocates distinct workers before two same-tick starts can arrive', async () => {
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'review-lead')
    let letStartsFinish!: () => void
    world.startsWait = new Promise<void>((resolve) => {
      letStartsFinish = resolve
    })
    const first = world.gives(host, caller, 'document-reader', { parallel: true })
    const second = world.gives(host, caller, 'document-reader', { parallel: true })
    void first.catch(() => {})
    void second.catch(() => {})
    try {
      const identity = world.store.agentIdentities().find((one) => one.slug === 'document-reader')!
      expect(world.kept(identity.id)?.workerPools?.[0]?.workers.map((one) => one.number)).toEqual([
        1, 2,
      ])
      letStartsFinish()
      expect((await first).ok).toBe(true)
      expect((await second).ok).toBe(true)
      expect(world.store.workersBorn()).toHaveLength(2)
    } finally {
      letStartsFinish()
      await Promise.allSettled([first, second])
    }
  })

  it('does not give a service parallel work or accept a malformed flag', async () => {
    world.anAgent('calendar-service')
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'review-lead')
    const rowsBefore = world.conversationsRecorded()
    expect(await world.gives(host, caller, 'calendar-service', { parallel: true })).toMatchObject({
      ok: false,
      refusal: {
        rail: 'parallel-not-for-a-service',
        reason: 'A service runs one piece at a time. Leave parallel out to queue the work.',
      },
    })
    expect(await world.gives(host, caller, 'document-reader', { parallel: 'yes' })).toMatchObject({
      ok: false,
      refusal: { rail: 'malformed-request' },
    })
    expect(world.conversationsRecorded()).toBe(rowsBefore)
    expect(world.store.workersBorn()).toEqual([])
  })

  it('an uncertain native handover remains held across a restart and is never replayed', async () => {
    const host = world.aHost()
    const caller = await idleCaller(host)
    world.sendReturnsError = true
    await expect(world.gives(host, caller, 'document-reader', { parallel: true })).rejects.toThrow()
    expect(world.store.workersBorn()).toHaveLength(1)
    expect(world.sent).toHaveLength(1)
    const birth = world.store.workersBorn()[0]!
    const identity = world.store.agentIdentities().find((one) => one.slug === 'document-reader')!
    const held = world.kept(identity.id)!.workerPools![0]!.workers[0]!.assignment!
    expect(held).toMatchObject({ giver: caller })
    expect(world.store.workById(held.piece)).toBeNull()
    world.sendReturnsError = false
    await host.closeAll()
    const next = world.aHost()
    await next.reopenForAPerson(caller, world.window, null)
    expect(world.sent).toHaveLength(1)
    const given = await world.gives(next, caller, 'document-reader', { parallel: true })
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error('give refused')
    expect(given.owner).not.toBe(birth.conversation)
    expect(world.kept(identity.id)!.workerPools![0]!.workers[0]!.assignment).toEqual(held)
    expect(world.sent).toHaveLength(2)
  })

  it('a failed birth closes its native handle without sending a brief, then retries the never-born primary', async () => {
    const host = world.aHost()
    const caller = await idleCaller(host)
    world.db.exec(
      "CREATE TEMP TRIGGER refuse_worker_birth BEFORE INSERT ON events WHEN NEW.type = 'worker_registered' BEGIN SELECT RAISE(ABORT, 'fictional birth fault'); END",
    )
    await expect(world.gives(host, caller, 'document-reader', { parallel: true })).rejects.toThrow(
      'worker could not be recorded',
    )
    expect(world.store.workersBorn()).toEqual([])
    expect(world.sent).toHaveLength(0)
    expect(world.handleOf('document-reader').status()).toBe('ended')
    world.db.exec('DROP TRIGGER refuse_worker_birth')
    const retry = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(retry.ok).toBe(true)
    expect(world.store.workersBorn().map((one) => one.number)).toEqual([1])
  })

  it('a failed durable reservation launches and sends nothing', async () => {
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'review-lead')
    world.writesFail = 'all'
    const before = world.startedAs.length
    await expect(world.gives(host, caller, 'document-reader', { parallel: true })).rejects.toThrow()
    expect(world.startedAs).toHaveLength(before)
    expect(world.sent).toHaveLength(0)
    expect(world.store.workersBorn()).toEqual([])
    world.writesFail = 'none'
  })
})
