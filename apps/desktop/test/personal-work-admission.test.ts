import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnInProgress, type FakeSessionHandle } from '@brobot2/runtime'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { THE_APP_ITSELF, type RuntimeHost } from '../src/main/runtime/runtime-host'

const request = {
  title: 'New personal work',
  brief: 'Read the fictional input.',
  definition_of_done: 'The result and its check are recorded.',
}

describe('personal work requires its own recorded request', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('caller', 'normal')
    world.anAgent('worker', 'normal')
    world.anAgent('service-worker', 'service')
    host = world.aHost()
  })
  afterEach(async () => {
    await world.cleanUp()
    vi.restoreAllMocks()
  })
  const take = (conversation: string, args: Record<string, unknown> = request) =>
    agentToolsFor(host, conversation)
      .tools.find((tool) => tool.name === 'take_on_work')!
      .call(args)

  it('tells a helper to keep its assigned piece before describing new personal work', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'worker')
    if (!given.ok) throw new Error('fictional give failed')
    const tool = agentToolsFor(host, given.owner).tools.find((one) => one.name === 'take_on_work')!
    expect(tool.description).toBe(
      "Only for a request a person typed in your own conversation. For work an agent gave you, keep working on that piece; don't call this. Give a short brief and definition_of_done. The piece goes under your current work; name piece if that is unclear. A recorded agent giver is told. Finish with reply_to_parent, then tell the person here. Use the returned navigation links; clicking them does not move work.",
    )
  })

  it('still refuses a helper taking on its agent-given work without changing the assigned piece', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'worker')
    if (!given.ok) throw new Error('fictional give failed')
    const before = world.store.piecesOwnedBy(given.owner)
    const sentBefore = world.sent.length
    const no = await take(given.owner)
    const reason = 'This is not a recorded person request. Use give_work for an agent’s work.'
    expect(no.structured).toEqual({
      outcome: 'refused',
      rail: 'no-work-of-your-own',
      permanence: 'permanent',
      retryable: false,
      remedy: null,
      reason,
      detail: {},
    })
    expect(no.text).toBe(
      `refused (no-work-of-your-own): ${reason} This exact call can never succeed.`,
    )
    expect(world.store.piecesOwnedBy(given.owner)).toEqual(before)
    expect(before.map((row) => row.piece)).toEqual([given.piece])
    expect(world.sent).toHaveLength(sentBefore)
    const refusals = world.ledger(given.owner).filter((event) => event.type === 'tool_refused')
    expect(refusals).toEqual([
      {
        type: 'tool_refused',
        tool: 'take_on_work',
        rail: 'no-work-of-your-own',
        permanence: 'permanent',
        retryable: false,
        remedy: null,
        told: { text: `${reason} This exact call can never succeed.`, dropped: 0 },
      },
    ])
    expect(world.ledger(caller).filter((event) => event.type === 'tool_refused')).toEqual([])
  })

  it('refuses a missing field before creation, then accepts the same real personal turn with the field', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    await host.send(caller, 'Please take on the new personal work.', world.window)
    const before = world.store.piecesOwnedBy(caller).length
    const beforeRefusals = world
      .ledger(caller)
      .filter((event) => event.type === 'tool_refused').length
    const { definition_of_done: _, ...missing } = request
    void _
    const no = await take(caller, { ...missing, inputs: ['/fictional/unlisted-input.md'] })
    expect(no.structured).toMatchObject({
      outcome: 'refused',
      rail: 'malformed-request',
      permanence: 'permanent',
      retryable: false,
    })
    expect(no.text).toContain(
      'definition_of_done is required: say what done means and how to check it.',
    )
    const reason =
      'the arguments did not match what this tool accepts, so nothing was done. The problems are listed in the detail: fix each one and call this tool again.'
    expect(no.structured).toEqual({
      outcome: 'refused',
      rail: 'malformed-request',
      permanence: 'permanent',
      retryable: false,
      remedy: null,
      reason,
      detail: {
        problems: ['definition_of_done is required: say what done means and how to check it.'],
      },
    })
    expect(no.text).toBe(
      `refused (malformed-request): ${reason} Problems: definition_of_done is required: say what done means and how to check it. This exact call can never succeed. Fix it and call again.`,
    )
    const carriers = world
      .ledger(caller)
      .filter((event) => event.type === 'tool_refused')
      .slice(beforeRefusals)
    expect(carriers).toEqual([
      {
        type: 'tool_refused',
        tool: 'take_on_work',
        rail: 'malformed-request',
        permanence: 'permanent',
        retryable: false,
        remedy: null,
        // ⚑ A problem in this app's own words is kept in the record, the whole receipt.
        told: { text: no.text.slice('refused (malformed-request): '.length), dropped: 0 },
      },
    ])
    expect(no.text.slice('refused (malformed-request): '.length).startsWith(reason)).toBe(true)
    expect(JSON.stringify(carriers)).not.toContain('/fictional/unlisted-input.md')
    expect(JSON.stringify(carriers)).toContain('Problems: definition_of_done is required')
    expect(world.store.piecesOwnedBy(caller)).toHaveLength(before)
    const yes = await take(caller)
    expect(yes.structured).toMatchObject({
      outcome: 'ok',
      under: world.store.rootOf(caller)!.label,
      notice: null,
      queued: false,
    })
    const row = world.store.piecesOwnedBy(caller).at(-1)!
    expect(row.giver).toBeNull()
    expect(row.definitionOfDone).toBe(request.definition_of_done)
    expect(yes.text).toBe(
      `Took on ${row.label} under ${world.store.rootOf(caller)!.label} for the person.\n[${row.label} · New personal work](brocrew://piece/${row.piece})\n[${world.store.rootOf(caller)!.label} · ](brocrew://piece/${world.store.rootOf(caller)!.piece})`,
    )
  })

  it('does not relabel an agent brief, and a real person can create work under that child piece', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'worker')
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error('fictional give failed')
    expect(world.store.rootOf(given.owner)).toBeNull()
    const before = world.store.piecesOwnedBy(given.owner).length
    const refused = await take(given.owner)
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'no-work-of-your-own',
      retryable: false,
    })
    expect(world.store.piecesOwnedBy(given.owner)).toHaveLength(before)
    host.claimSession(given.owner, world.window)
    await host.sendInterrupting(given.owner, 'Please take on this new personal work.', world.window)
    const accepted = await take(given.owner, { ...request, piece: given.label })
    expect(accepted.structured).toMatchObject({ outcome: 'ok', under: given.label, queued: false })
    const row = world.store.piecesOwnedBy(given.owner).at(-1)!
    expect(row.parent).toBe(given.piece)
    expect(row.giver).toBeNull()
    expect(row.definitionOfDone).toBe(request.definition_of_done)
    expect(
      world
        .ledger(given.owner)
        .filter((event) => event.type === 'work_given' && event.givenBy === null),
    ).toHaveLength(1)
    const notice = `The person gave ${host.whatToCallTheConversation(given.owner)} new work: ${request.title}.`
    const rows = world.ledger(caller)
    expect(
      rows.filter(
        (event) =>
          (event.type === 'message_queued' || event.type === 'user_turn') &&
          event.text === notice &&
          event.appNotice === 'a-person-gave-new-work',
      ),
    ).toHaveLength(1)
  })
  it('a failed confirmation publishes no personal authority or work', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    world.sendReturnsError = true
    await expect(
      host.send(caller, 'A fictional request that cannot be confirmed.', world.window),
    ).rejects.toThrow('fictional send confirmation lost')
    const no = await take(caller)
    expect(no.structured).toMatchObject({ outcome: 'refused', rail: 'no-work-of-your-own' })
    expect(world.store.piecesOwnedBy(caller)).toHaveLength(0)
  })

  it('a late earlier row cannot replace the newer recorded personal request', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    let release!: () => void
    world.sendsSettle = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = host.send(caller, 'First fictional request.', world.window)
    await vi.waitFor(() => {
      expect(world.handleOf('caller').status()).toBe('waiting_permission')
    })
    world.sendsSettle = null
    await host.sendInterrupting(caller, 'Second fictional request.', world.window)
    release()
    await first
    const yes = await take(caller)
    expect(yes.structured).toMatchObject({ outcome: 'ok' })
    expect(world.store.piecesOwnedBy(caller)).toHaveLength(1)
  })

  it('queues personal work at a service without replacing the caller or starting a second piece', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'service-worker')
    if (!given.ok) throw new Error('fictional service give failed')
    await vi.waitFor(() => {
      expect(
        world
          .ledger(given.owner)
          .some((event) => event.type === 'user_turn' && event.piece === given.piece),
      ).toBe(true)
    })
    host.claimSession(given.owner, world.window)
    await host.sendInterrupting(
      given.owner,
      'Please take this separate personal work.',
      world.window,
    )
    const sentBefore = world.sent.filter((turn) => turn.as === 'service-worker').length
    const yes = await take(given.owner)
    expect(yes.structured).toMatchObject({ outcome: 'ok', under: given.label, queued: true })
    expect(yes.text).toContain('The work is queued.')
    const personal = world.store.piecesOwnedBy(given.owner).at(-1)!
    expect(personal.giver).toBeNull()
    expect(personal.parent).toBe(given.piece)
    expect(personal.state).toBe('waiting')
    expect(personal.messageId).not.toBeNull()
    expect(
      world.store.piecesOwnedBy(given.owner).filter((row) => row.state !== 'waiting'),
    ).toHaveLength(1)
    expect(world.sent.filter((turn) => turn.as === 'service-worker')).toHaveLength(sentBefore)
  })

  it('keeps the active personal request when a later send loses the sign-in race', async () => {
    world.signInsChecked = true
    const caller = await world.aPersonOpens(host, 'caller')
    let release!: () => void
    world.signInWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const sent = vi.spyOn(world.handleOf('caller'), 'send')
    const before = world.signInChecks
    world.signInChecksLetThrough = before + 1
    const note = host.queueMessage(caller, 'An app note that loses the race.', THE_APP_ITSELF)
    await vi.waitFor(() => {
      expect(world.signInChecks).toBeGreaterThan(before + 1)
    })
    world.signInWait = null
    await host.send(caller, 'Please take on the new personal work.', world.window)
    release()
    expect((await note).outcome).toBe('queued')
    expect(
      sent.mock.calls.filter(([words]) => words.includes('An app note that loses the race.')),
    ).toHaveLength(1)
    const yes = await take(caller)
    expect(yes.structured).toMatchObject({ outcome: 'ok' })
    expect(world.store.piecesOwnedBy(caller)).toHaveLength(1)
  })

  it('a provider-started burst fences restoration of a refused handover’s earlier personal anchor', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    await host.send(caller, 'Please take on the new personal work.', world.window)
    const handle = world.handleOf('caller') as FakeSessionHandle
    vi.spyOn(handle, 'send').mockImplementationOnce(async () => {
      handle.simulateThinking()
      await vi.waitFor(() => {
        expect(world.ledger(caller).some((event) => event.type === 'provider_turn')).toBe(true)
      })
      throw new TurnInProgress()
    })
    await host.sendInterrupting(caller, 'An app note that cannot start its turn.', THE_APP_ITSELF)
    expect(handle.status()).toBe('working')
    const no = await take(caller)
    expect(no.structured).toMatchObject({ outcome: 'refused', rail: 'no-work-of-your-own' })
    expect(world.store.piecesOwnedBy(caller)).toHaveLength(0)
  })
})
