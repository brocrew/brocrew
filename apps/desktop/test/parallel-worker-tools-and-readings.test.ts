import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

describe('parallel worker tools and conversation readings', () => {
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
    return { host, caller }
  }
  const giveTool = (host: RuntimeHost, caller: string) => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === 'give_work')
    if (!tool) throw new Error('give_work missing')
    return tool
  }
  async function two() {
    const { host, caller } = await setup()
    await host.closeAll()
    const a = await world.aRecordedWorker(caller, 'document-reader')
    const b = await world.aRecordedWorker(caller, 'document-reader', 2)
    return { caller, a, b }
  }
  it('agent cards, list/status tools and both window populations carry stable metadata after restart without new worker database reads', async () => {
    const { caller, a, b } = await two()
    const next = world.aHost()
    const reads = ['workersBorn', 'workerLineage', 'workerInItsPlace'] as const
    const probes = reads.map((name) => vi.spyOn(world.store, name))
    try {
      const by = { ownerId: agentCallerId(caller) }
      expect(next.agentCard(a, by, caller)?.worker).toEqual({
        identity,
        giver: caller,
        number: 1,
        bornAs: a,
      })
      expect(next.agentCard(b, by, caller)?.worker).toEqual({
        identity,
        giver: caller,
        number: 2,
        bornAs: b,
      })
      const rows = [...next.resumableSessions(), ...next.unresumableSessions()]
      expect(rows.find((one) => one.sessionId === a)?.worker?.number).toBe(1)
      expect(rows.find((one) => one.sessionId === b)?.worker?.number).toBe(2)
      const tools = agentToolsFor(next, caller).tools
      const list = tools.find((one) => one.name === 'list_agents')!
      const result = await list.call({})
      const agents = result.structured?.agents
      expect(Array.isArray(agents)).toBe(true)
      if (!Array.isArray(agents)) throw new Error('no agents reading')
      expect(agents.find((one) => one.agent === b)?.worker).toMatchObject({
        number: 2,
        bornAs: b,
      })
      const status = await tools
        .find((one) => one.name === 'get_agent_status')!
        .call({ agent: b })
      expect(status.structured).toMatchObject({ agent: { worker: { number: 2, bornAs: b } } })
      expect(
        next.resumableSessions().find((one) => one.sessionId === a)?.worker?.number,
      ).toBe(1)
      world.db
        .prepare('UPDATE provider_session SET external_ref = NULL, launched_as = NULL WHERE id = ?')
        .run(b)
      expect(
        next.unresumableSessions().find((one) => one.sessionId === b)?.worker?.number,
      ).toBe(2)
      for (const probe of probes) expect(probe).not.toHaveBeenCalled()
    } finally {
      for (const probe of probes) probe.mockRestore()
    }
  })
  it('ordinary and service gives keep their existing receipts, and an unavailable binding supplies no invented worker metadata', async () => {
    const { caller, a } = await two()
    const host = world.aHost()
    await host.reopenForAPerson(caller, world.window, null)
    const ordinary = await giveTool(host, caller).call({
      profile: 'document-reader',
      to: a,
      title: 'Fictional revision',
      brief: 'Revise the draft.',
      definition_of_done: 'The draft is revised.',
    })
    expect(ordinary.structured).toMatchObject({ outcome: 'ok', agent: a })
    expect(ordinary.structured?.worker).toBeUndefined()
    expect(ordinary.text).not.toContain('Worker:')
    world.anAgent('index-service', 'service')
    await host.closeAll()
    const serviceHost = world.aHost()
    await serviceHost.reopenForAPerson(caller, world.window, null)
    const service = await giveTool(serviceHost, caller).call({
      profile: 'index-service',
      title: 'Fictional index',
      brief: 'Index the draft.',
      definition_of_done: 'The draft is indexed.',
    })
    expect(service.structured).toMatchObject({ outcome: 'ok', queued_behind: 0 })
    expect(service.structured?.worker).toBeUndefined()
    expect(service.text).not.toContain('Worker:')
    await serviceHost.closeAll()
    world.loseTheKept()
    const unknown = world.aHost()
    expect(
      unknown.agentCard(a, { ownerId: agentCallerId(caller) }, caller)?.worker,
    ).toBeUndefined()
    expect(
      [...unknown.resumableSessions(), ...unknown.unresumableSessions()].find(
        (one) => one.sessionId === a,
      )?.worker,
    ).toBeUndefined()
  })
  it('a historical worker replacement keeps its original number and birth identity in the readings', async () => {
    const { caller, b } = await two()
    const current = world.seedHistoricalSuccessor(b, 'sess_historical_worker')
    const next = world.aHost()
    await next.reopenForAPerson(caller, world.window, null)
    const sent = await next.messageAgentNow(
      b,
      'Check the fictional revision.',
      { ownerId: agentCallerId(caller) },
      'note',
    )
    expect(sent).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
    expect(world.ledger(current)).toContainEqual(
      expect.objectContaining({
        type: 'user_turn',
        text: expect.stringContaining('Check the fictional revision.'),
      }),
    )
    expect(world.store.workerInItsPlace(b)).toBe(current)
    expect(next.agentCard(current, { ownerId: agentCallerId(caller) }, caller)?.worker).toEqual({
      identity,
      giver: caller,
      number: 2,
      bornAs: b,
    })
    expect(
      [...next.resumableSessions(), ...next.unresumableSessions()].find(
        (one) => one.sessionId === current,
      )?.worker?.number,
    ).toBe(2)
    await next.closeAll()
    const restarted = world.aHost()
    expect(
      restarted.agentCard(current, { ownerId: agentCallerId(caller) }, caller)?.worker,
    ).toEqual({ identity, giver: caller, number: 2, bornAs: b })
  })
})
