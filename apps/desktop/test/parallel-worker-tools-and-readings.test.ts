import { navigationReply } from './helpers/navigation-reply'
import { z } from 'zod'
import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { profileExecutionFile } from '../src/main/profile-execution-file'
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
    const a = await world.gives(host, caller, 'document-reader', { parallel: true })
    const b = await world.gives(host, caller, 'document-reader', { parallel: true })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('setup refused')
    return { host, caller, a, b }
  }
  it('advertises a strict optional boolean and the approved default/folder words', async () => {
    const { host, caller } = await setup()
    const tool = giveTool(host, caller)
    expect(tool.input.parallel).toBeDefined()
    expect(z.parse(tool.input.parallel!, true)).toBe(true)
    expect(z.parse(tool.input.parallel!, false)).toBe(false)
    expect(z.parse(tool.input.parallel!, undefined)).toBeUndefined()
    const advertised = z.toJSONSchema(z.looseObject(tool.input))
    expect(advertised.properties?.parallel).toMatchObject({ type: 'boolean' })
    expect(advertised.required ?? []).not.toContain('parallel')
    expect(z.globalRegistry.get(tool.input.parallel!)?.description).toBe(
      'true gives this piece to a free worker of that agent, or starts another worker if all are busy. Leave it out to use your usual conversation with it. Not for a service, which runs one piece at a time.',
    )
    expect(
      tool.description.startsWith(
        'Give a piece of work with a short brief and definition_of_done. Put the detail in inputs.',
      ),
    ).toBe(true)
    expect(advertised.required).toContain('definition_of_done')
    expect(tool.description).toContain('By default, it goes to the one conversation')
    expect(tool.description).toContain('Without parallel, an agent that is busy')
    expect(z.globalRegistry.get(tool.input.folder!)?.description).toBe(
      "A folder for this piece: any that exists; a relative path is read from your own working directory. With parallel: true and no folder, the piece gets its own output folder. A conversation this starts works in the piece's folder, or else in your own working directory. An existing conversation keeps its own working folder and may also use the piece's folder while the piece is open.",
    )
    const before = world.conversationsRecorded()
    const bad = await tool.call({
      profile: 'document-reader',
      title: 'Fictional draft',
      brief: 'Check the draft.',
      definition_of_done: 'The draft is checked.',
      parallel: 'yes',
    })
    expect(bad.structured).toMatchObject({ outcome: 'refused' })
    expect(bad.text).toContain('parallel: expected true or false, got text')
    expect(world.conversationsRecorded()).toBe(before)
    expect(world.sent).toEqual([])
  })
  it('the final give tool carries the selected primary and extra identity and exact Worker lines', async () => {
    const { host, caller } = await setup()
    const tool = giveTool(host, caller)
    const call = () =>
      tool.call({
        profile: 'document-reader',
        title: 'Fictional draft',
        brief: 'Check the draft.',
        definition_of_done: 'The draft is checked.',
        parallel: true,
      })
    const a = await call()
    const b = await call()
    expect(a.structured).toMatchObject({
      outcome: 'ok',
      profile: 'document-reader',
      worker: { identity, giver: caller, number: 1 },
    })
    expect(b.structured).toMatchObject({
      outcome: 'ok',
      profile: 'document-reader',
      worker: { identity, giver: caller, number: 2 },
    })
    const first = navigationReply(a.text)
    const second = navigationReply(b.text)
    expect(first.prose.endsWith(' Worker: document-reader.')).toBe(true)
    expect(second.prose.endsWith(' Worker: document-reader (2).')).toBe(true)
    for (const reply of [first, second])
      expect(reply.links).toContain(`[Ada](brocrew://agent/${encodeURIComponent(identity)})`)
    const aid = a.structured?.agent
    const bid = b.structured?.agent
    if (typeof aid !== 'string' || typeof bid !== 'string') throw new Error('worker id missing')
    expect(a.structured?.worker).toMatchObject({ bornAs: aid })
    expect(b.structured?.worker).toMatchObject({ bornAs: bid })
    expect(host.agentCard(bid, { ownerId: agentCallerId(caller) }, caller)?.worker).toMatchObject({
      number: 2,
      bornAs: bid,
    })
    expect(aid).not.toBe(bid)
    expect(
      world.store.agentIdentities().filter((one) => one.slug === 'document-reader'),
    ).toHaveLength(1)
  })
  it('agent cards, list/status tools and both window populations carry stable metadata after restart without new worker database reads', async () => {
    const { host, caller, a, b } = await two()
    await host.closeAll()
    const next = world.aHost()
    const reads = ['workersBorn', 'workerLineage', 'workerInItsPlace', 'workerLedger'] as const
    const probes = reads.map((name) => vi.spyOn(world.store, name))
    try {
      const by = { ownerId: agentCallerId(caller) }
      expect(next.agentCard(a.owner, by, caller)?.worker).toEqual({
        identity,
        giver: caller,
        number: 1,
        bornAs: a.owner,
      })
      expect(next.agentCard(b.owner, by, caller)?.worker).toEqual({
        identity,
        giver: caller,
        number: 2,
        bornAs: b.owner,
      })
      const rows = [...next.resumableSessions(), ...next.unresumableSessions()]
      expect(rows.find((one) => one.sessionId === a.owner)?.worker?.number).toBe(1)
      expect(rows.find((one) => one.sessionId === b.owner)?.worker?.number).toBe(2)
      const tools = agentToolsFor(next, caller).tools
      const list = tools.find((one) => one.name === 'list_agents')!
      const result = await list.call({})
      const agents = result.structured?.agents
      expect(Array.isArray(agents)).toBe(true)
      if (!Array.isArray(agents)) throw new Error('no agents reading')
      expect(agents.find((one) => one.agent === b.owner)?.worker).toMatchObject({
        number: 2,
        bornAs: b.owner,
      })
      const status = await tools
        .find((one) => one.name === 'get_agent_status')!
        .call({ agent: b.owner })
      expect(status.structured).toMatchObject({ agent: { worker: { number: 2, bornAs: b.owner } } })
      expect(
        next.resumableSessions().find((one) => one.sessionId === a.owner)?.worker?.number,
      ).toBe(1)
      world.db
        .prepare('UPDATE provider_session SET external_ref = NULL, launched_as = NULL WHERE id = ?')
        .run(b.owner)
      expect(
        next.unresumableSessions().find((one) => one.sessionId === b.owner)?.worker?.number,
      ).toBe(2)
      for (const probe of probes) expect(probe).not.toHaveBeenCalled()
    } finally {
      for (const probe of probes) probe.mockRestore()
    }
  })
  it('ordinary and service gives keep their existing receipts, and an unavailable binding supplies no invented worker metadata', async () => {
    const { host, caller, a } = await two()
    const ordinary = await giveTool(host, caller).call({
      profile: 'document-reader',
      title: 'Fictional revision',
      brief: 'Revise the draft.',
      definition_of_done: 'The draft is revised.',
    })
    expect(ordinary.structured).toMatchObject({ outcome: 'ok', agent: a.owner })
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
    writeFileSync(profileExecutionFile(world.folder), '{')
    const unknown = world.aHost()
    expect(
      unknown.agentCard(a.owner, { ownerId: agentCallerId(caller) }, caller)?.worker,
    ).toBeUndefined()
    expect(
      [...unknown.resumableSessions(), ...unknown.unresumableSessions()].find(
        (one) => one.sessionId === a.owner,
      )?.worker,
    ).toBeUndefined()
  })
  it('a worker replacement keeps its original number and birth identity in the readings', async () => {
    const { host, caller, b } = await two()
    await host.closeAll()
    world.resumesAreGoneFor = 'document-reader'
    const next = world.aHost()
    await next.reopenForAPerson(caller, world.window, null)
    // The provider double refuses only resumes, so the ordinary recovery starts its replacement.
    const sent = await next.messageAgentNow(
      b.owner,
      'Check the fictional revision.',
      { ownerId: agentCallerId(caller) },
      'note',
    )
    expect(sent).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
    const current = world.store.workerInItsPlace(b.owner)
    expect(current).not.toBe(b.owner)
    expect(next.agentCard(current, { ownerId: agentCallerId(caller) }, caller)?.worker).toEqual({
      identity,
      giver: caller,
      number: 2,
      bornAs: b.owner,
    })
    expect(
      [...next.resumableSessions(), ...next.unresumableSessions()].find(
        (one) => one.sessionId === current,
      )?.worker?.number,
    ).toBe(2)
    await next.closeAll()
    world.resumesAreGoneFor = null
    const restarted = world.aHost()
    expect(
      restarted.agentCard(current, { ownerId: agentCallerId(caller) }, caller)?.worker,
    ).toEqual({ identity, giver: caller, number: 2, bornAs: b.owner })
  })
})
