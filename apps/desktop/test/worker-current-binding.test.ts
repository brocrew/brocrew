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
    await host.closeAll()
    const worker = await world.aRecordedWorker(caller, 'document-reader')
    const restarted = world.aHost()
    await restarted.reopenForAPerson(caller, world.window, null)
    return { host: restarted, caller, worker }
  }

  it('does not resolve an absent first record as a current worker', () => {
    expect(() => world.store.workerLineage('missing-worker')).toThrow('record is missing')
    expect(() => world.store.workerInItsPlace('missing-worker')).toThrow('record is missing')
    expect(() => world.store.workerGiverContains('missing-giver', 'missing-giver')).toThrow(
      'record is missing',
    )
  })

  it('keeps the historical lineage and gives to the explicitly named successor', async () => {
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
    const ordinary = await world.gives(next, caller, 'document-reader', { to: successor })
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
    expect(world.store.workersBorn()).toHaveLength(1)
  })
})
