import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import {
  aServiceWorld,
  acceptedGive as accepted,
  openServiceAndTwoCallers,
  type AServiceWorld,
} from './helpers/a-service-world'

describe('a stopped replacement service holds the reply or answer', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  it('reports the stopped replacement service that holds a reply', async () => {
    const { host, first, second } = await openServiceAndTwoCallers(world)
    world.anAgent('writer', 'normal')
    const service = accepted(await world.gives(host, second, 'browser-driver')).owner
    const given = accepted(await world.gives(host, first, 'writer', { title: 'Write the notes' }))
    await host.closeAll()
    const title = 'Replacement room service'
    world.store.titleConversation(
      service,
      world.store.nextOrdinal(service),
      { type: 'titled', title, author: { kind: 'person' } },
      world.clock++,
    )
    world.store.append(
      first,
      world.store.nextOrdinal(first),
      { type: 'replaced_by', sessionId: service },
      world.clock++,
    )

    const after = world.aHost({ servicesOn: false })
    await after.resumeSession(given.owner, world.window, null)
    const reply = agentToolsFor(after, given.owner).tools.find(
      (one) => one.name === 'reply_to_parent',
    )
    if (reply === undefined) throw new Error('the owner has no reply tool')
    const result = await reply.call({ piece: given.piece, outcome: 'done', summary: 'notes ready' })
    expect(result.structured).toMatchObject({
      outcome: 'ok',
      delivered: 'held',
      receipt: {
        recorded: { kind: 'reply', id: given.piece, taskLabel: given.label },
        recipient: { id: service, address: service, title, state: { kind: 'queued' } },
      },
    })
    expect(result.text).toContain(`it is held for conversation ${service} · ${title}.`)
    const queued = world.store
      .messagesWaitingIn(service)
      .find((one) => one.text.includes('notes ready'))
    expect(queued?.messageId).toEqual(expect.any(String))
    expect(world.store.messagesWaitingIn(first)).not.toContainEqual(
      expect.objectContaining({ messageId: queued?.messageId }),
    )
    expect(
      world.store.piecesOwnedBy(given.owner).find((row) => row.piece === given.piece)?.state,
    ).toBe('answered')
  })

  it('reports the answer held on the actual stopped replacement service', async () => {
    world.anAgent('replacement-service')
    world.store.setDefaultApprovalMode('auto')
    const { host, first, second } = await openServiceAndTwoCallers(world)
    const old = accepted(await world.gives(host, first, 'browser-driver', { title: 'Original' }))
    const replacement = accepted(await world.gives(host, second, 'replacement-service')).owner
    await vi.waitFor(() => {
      expect(
        world.store.piecesOwnedBy(old.owner).find((row) => row.piece === old.piece)
          ?.briefHandedOver,
      ).toBe(true)
    })
    const ask = agentToolsFor(host, old.owner).tools.find((one) => one.name === 'ask_question')
    if (ask === undefined) throw new Error('the service has no ask tool')
    const asked = await ask.call({
      who_answers: 'the-parent',
      piece: old.label,
      question: 'Which room?',
    })
    expect(asked.structured, asked.text).toMatchObject({ outcome: 'ok' })
    const question = asked.structured?.question
    if (typeof question !== 'string') throw new Error('the question was not recorded')
    await host.closeAll()
    world.store.append(
      old.owner,
      world.store.nextOrdinal(old.owner),
      { type: 'replaced_by', sessionId: replacement },
      world.clock++,
    )
    const after = world.aHost({ servicesOn: false })
    await after.resumeSession(first, world.window, null)
    const answer = agentToolsFor(after, first).tools.find((one) => one.name === 'answer_question')
    if (answer === undefined) throw new Error('the caller has no answer tool')
    const result = await answer.call({
      question,
      answers: [{ part: 'answer', answer: ['room 23'] }],
    })
    expect(result.structured).toMatchObject({
      outcome: 'ok',
      question,
      agent: old.owner,
      receipt: {
        recorded: { kind: 'reply', id: question },
        recipient: { id: replacement, address: replacement, state: { kind: 'queued' } },
      },
    })
    expect(result.text).toContain(`Your answer is held for conversation ${replacement} ·`)
    const waiting = world.store.messagesWaitingIn(replacement)
    const behind = waiting.findIndex((row) => row.text.includes('room 23'))
    expect(behind).toBeGreaterThanOrEqual(0)
    const queued = waiting[behind]
    expect(result.structured?.receipt).toMatchObject({
      recipient: { state: { kind: 'queued', behind } },
    })
    expect(queued?.messageId).toEqual(expect.any(String))
    expect(
      world.store.routedRequestsOf(old.owner).find((row) => row.requestId === question)?.state,
    ).toBe('answered')
  })
})
