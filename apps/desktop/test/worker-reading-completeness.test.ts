import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { WorkerBindingReading } from '../src/shared/worker-reading'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

// Real fictional SQLite and FakeRuntime only; no provider or person's data is consulted.
describe('complete worker metadata on conversation readings', () => {
  let world: AServiceWorld
  let identity: string
  beforeEach(() => {
    world = aServiceWorld()
    identity = world.anAgent('document-reader', 'normal').id
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  async function twoWorkers() {
    const host = world.aHost()
    const caller = (
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
    const primary = await world.gives(host, caller, 'document-reader', { parallel: true })
    const extra = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(primary.ok && extra.ok).toBe(true)
    if (!primary.ok || !extra.ok) throw new Error('fictional workers were not started')
    await host.closeAll()
    const bindings = world.kept(identity)?.workerPools?.flatMap((pool) => pool.workers)
    expect(bindings).toHaveLength(2)
    expect(bindings?.map((worker) => worker.phase)).toEqual(['bound', 'bound'])
    expect(bindings?.map((worker) => worker.assignment)).toEqual([undefined, undefined])
    return { caller, primary: primary.owner, extra: extra.owner }
  }

  async function actualReplacement() {
    const seed = await twoWorkers()
    world.resumesAreGoneFor = 'document-reader'
    const host = world.aHost()
    await host.reopenForAPerson(seed.caller, world.window, null)
    const sent = await host.messageAgentNow(
      seed.extra,
      'Check the fictional revision.',
      { ownerId: agentCallerId(seed.caller) },
      'note',
    )
    expect(sent).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
    const current = world.store.workerInItsPlace(seed.extra)
    expect(current).not.toBe(seed.extra)
    expect(world.store.recordedOne(current)).not.toBeNull()
    world.resumesAreGoneFor = null
    return { ...seed, host, current }
  }

  function appendReplacement(conversation: string, target: string) {
    const ordinal = world.store.nextOrdinal(conversation)
    const generation = world.store.theActiveGeneration(conversation)
    world.store.append(
      conversation,
      ordinal,
      { type: 'replaced_by', sessionId: target },
      world.clock++,
    )
    return { ordinal, generation }
  }

  const workerMethods = [
    'workersBorn',
    'workerLineage',
    'workerInItsPlace',
    'workerGiverContains',
    'workerLedger',
    'workerQuestionTargets',
  ] as const

  async function cachedOnly(read: () => Promise<void>) {
    // Initialization may prove bindings. The public readings must use that completed index.
    const probes = workerMethods.map((name) => vi.spyOn(world.store, name))
    for (const probe of probes) probe.mockClear()
    try {
      await read()
      for (const probe of probes) expect(probe).not.toHaveBeenCalled()
    } finally {
      for (const probe of probes) probe.mockRestore()
    }
  }

  function metadata(row: object & { worker?: unknown }, expected?: WorkerBindingReading) {
    expect(Object.hasOwn(row, 'worker')).toBe(expected !== undefined)
    expect(row.worker).toEqual(expected)
  }

  async function allReadings(
    host: RuntimeHost,
    caller: string,
    conversation: string,
    expected?: WorkerBindingReading,
  ) {
    const by = { ownerId: agentCallerId(caller) }
    const card = host.agentCard(conversation, by, caller)
    expect(card).not.toBeNull()
    if (card === null) throw new Error('fictional conversation card missing')
    expect(card.agent).toBe(conversation)
    metadata(card, expected)

    const tools = agentToolsFor(host, caller).tools
    const listed = await tools.find((tool) => tool.name === 'list_agents')!.call({})
    const agents = listed.structured?.agents
    expect(Array.isArray(agents)).toBe(true)
    if (!Array.isArray(agents)) throw new Error('fictional agents reading missing')
    const agent = agents.find((row) => row.agent === conversation)
    expect(agent).toBeDefined()
    if (agent === undefined) throw new Error('fictional listed agent missing')
    metadata(agent, expected)

    const status = await tools
      .find((tool) => tool.name === 'get_agent_status')!
      .call({ agent: conversation })
    const statusAgent = status.structured?.agent
    expect(statusAgent).toMatchObject({ agent: conversation })
    if (typeof statusAgent !== 'object' || statusAgent === null)
      throw new Error('fictional status missing')
    metadata(statusAgent, expected)

    const resumable = host.resumableSessions().find((row) => row.sessionId === conversation)
    expect(resumable).toBeDefined()
    if (resumable === undefined) throw new Error('fictional resumable row missing')
    metadata(resumable, expected)
    const reference = world.db
      .prepare('SELECT external_ref, launched_as FROM provider_session WHERE id = ?')
      .get(conversation) as { external_ref: string | null; launched_as: string | null }
    world.db
      .prepare('UPDATE provider_session SET external_ref = NULL, launched_as = NULL WHERE id = ?')
      .run(conversation)
    try {
      expect(host.resumableSessions().find((row) => row.sessionId === conversation)).toBeUndefined()
      const unresumable = host.unresumableSessions().find((row) => row.sessionId === conversation)
      expect(unresumable).toBeDefined()
      if (unresumable === undefined) throw new Error('fictional unresumable row missing')
      metadata(unresumable, expected)
    } finally {
      world.db
        .prepare('UPDATE provider_session SET external_ref = ?, launched_as = ? WHERE id = ?')
        .run(reference.external_ref, reference.launched_as, conversation)
    }
  }

  const expected = (caller: string, number: number, bornAs: string): WorkerBindingReading => ({
    identity,
    giver: caller,
    number,
    bornAs,
  })
  const oneProfile = () =>
    expect(
      world.store.agentIdentities().filter((row) => row.slug === 'document-reader'),
    ).toHaveLength(1)

  it('[C01] complete unchanged workers retain their number and birth identity after restart without worker reads', async () => {
    const seed = await twoWorkers()
    const restarted = world.aHost()
    await cachedOnly(async () => {
      await allReadings(
        restarted,
        seed.caller,
        seed.primary,
        expected(seed.caller, 1, seed.primary),
      )
      await allReadings(restarted, seed.caller, seed.extra, expected(seed.caller, 2, seed.extra))
    })
    oneProfile()
  })

  it('[C02] an actual complete replacement retains its original number and bornAs before and after restart', async () => {
    const seed = await actualReplacement()
    const binding = expected(seed.caller, 2, seed.extra)
    await cachedOnly(() => allReadings(seed.host, seed.caller, seed.current, binding))
    await seed.host.closeAll()
    const restarted = world.aHost()
    expect(world.store.workerInItsPlace(seed.extra)).toBe(seed.current)
    await cachedOnly(() => allReadings(restarted, seed.caller, seed.current, binding))
    oneProfile()
  })

  it('[C03] an absent replacement target cannot leave invented worker metadata after restart', async () => {
    const seed = await twoWorkers()
    appendReplacement(seed.extra, 'missing-terminal')
    expect(world.store.recordedOne('missing-terminal')).toBeNull()
    expect(() => world.store.workerInItsPlace(seed.extra)).toThrow('target is missing')
    const restarted = world.aHost()
    await cachedOnly(() => allReadings(restarted, seed.caller, seed.extra))
    oneProfile()
  })

  it('[C04] a torn replacement row cannot be discarded into apparently complete metadata after restart', async () => {
    const seed = await twoWorkers()
    const position = appendReplacement(seed.extra, 'torn-terminal')
    world.db
      .prepare(
        'UPDATE events SET payload = ? WHERE session_id = ? AND generation = ? AND ordinal = ?',
      )
      .run('{', seed.extra, position.generation, position.ordinal)
    expect(() => world.store.workerInItsPlace(seed.extra)).toThrow('unreadable')
    const restarted = world.aHost()
    await cachedOnly(() => allReadings(restarted, seed.caller, seed.extra))
    oneProfile()
  })

  it('[C05] duplicate readable replacement facts cannot supply metadata for a guessed terminal', async () => {
    const seed = await actualReplacement()
    await seed.host.closeAll()
    appendReplacement(seed.extra, seed.current)
    expect(world.store.recordedOne(seed.current)).not.toBeNull()
    expect(() => world.store.workerInItsPlace(seed.extra)).toThrow('ambiguous')
    const restarted = world.aHost()
    await cachedOnly(() => allReadings(restarted, seed.caller, seed.current))
    oneProfile()
  })

  it('[C06] a failing complete terminal read supplies no metadata or new worker reads on public listings', async () => {
    const seed = await twoWorkers()
    const failure = vi.spyOn(world.store, 'workerInItsPlace').mockImplementation(() => {
      throw new Error('fictional complete terminal read failed')
    })
    try {
      const restarted = world.aHost()
      await cachedOnly(async () => {
        await allReadings(restarted, seed.caller, seed.primary)
        await allReadings(restarted, seed.caller, seed.extra)
      })
    } finally {
      failure.mockRestore()
    }
    oneProfile()
  })
})
