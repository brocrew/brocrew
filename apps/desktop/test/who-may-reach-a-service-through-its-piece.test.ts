import type { SendReceipt } from '../src/shared/tool-outcome'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AServiceWorld } from './helpers/a-service-world'
import { aServicePieceSuite } from './helpers/a-service-piece-suite'

describe('a service is reached through the piece it is on', () => {
  const suite = aServicePieceSuite()
  const { call, stateOf, handedOver, rows, deliveredParts, aServiceOnTheFirstPiece } = suite
  let world: AServiceWorld
  beforeEach(() => {
    world = suite.world()
  })

  describe('who may reach it', () => {
    it('Message uses the service’s exact conversation address', async () => {
      const { host, caller, stranger, service, one } = await aServiceOnTheFirstPiece()
      const sent = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(sent.structured).toMatchObject({ outcome: 'ok', agent: service })
      const denied = await call(host, stranger, 'message_agent', {
        agent: 'browser-driver',
        kind: 'note',
        text: 'the room on the third floor',
      })
      expect(denied.structured).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
      const asked = await call(host, caller, 'ask_question', {
        who_answers: 'an-agent',
        agent: 'browser-driver',
        question: 'which floor?',
      })
      expect(asked.structured).toMatchObject({
        outcome: 'ok',
        agent: service,
      })
    })

    it('lets the caller whose piece it is on stop its turn, follow it up and give it a new brief', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const stopped = await call(host, caller, 'interrupt_agent', {
        agent: service,
        reason: 'not needed now',
      })
      expect(stopped.structured).toMatchObject({ outcome: 'ok' })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok' })
      const byItsLabel = await call(host, caller, 'interrupt_agent', {
        agent: one.label,
        reason: 'not needed now',
      })
      expect(byItsLabel.structured).toMatchObject({ outcome: 'ok', agent: service })
      const rebriefed = await call(host, caller, 'update_work', {
        piece: one.label,
        brief: 'book the room on the third floor',
      })
      expect(rebriefed.structured).toMatchObject({ outcome: 'ok' })
    })

    it('reads the service status and lets a caller ask its exact conversation address', async () => {
      const { host, caller, other, service, two } = await aServiceOnTheFirstPiece()
      const status = await call(host, caller, 'get_agent_status', { agent: service })
      // One task is being worked on; the other waits its turn.
      expect(status.structured).toMatchObject({
        outcome: 'ok',
        agent: { agent: service, queued: 1 },
      })
      expect(status.text).toContain(' · 1 waiting')
      const callers = await call(host, caller, 'get_agent_status', { agent: caller })
      expect(callers.structured.agent).not.toHaveProperty('queued')
      expect(callers.text).not.toMatch(/ · \d+ waiting/)
      // With the waiting task taken back, none waits: a readable zero, said as zero.
      expect(
        (await call(host, other, 'withdraw_task', { piece: two.label })).structured,
      ).toMatchObject({ outcome: 'ok' })
      const emptied = await call(host, caller, 'get_agent_status', { agent: service })
      expect(emptied.structured).toMatchObject({ agent: { agent: service, queued: 0 } })
      expect(emptied.text).toContain(' · 0 waiting')
      const asked = await call(host, caller, 'ask_question', {
        who_answers: 'an-agent',
        agent: service,
        question: 'which floor?',
      })
      const question = asked.structured.question
      expect(asked.structured).toMatchObject({
        outcome: 'ok',
        question: expect.any(String),
        went_to: 'an-agent',
        agent: service,
        receipt: {
          recorded: { kind: 'question', id: question },
          recipient: { id: service },
        },
      })
      const routed = world.store.routedRequestsOf(caller).find((row) => row.requestId === question)
      expect(routed).toMatchObject({
        parent: service,
      })
      const listed = await call(host, caller, 'list_agents', {})
      expect(JSON.stringify(listed.structured)).toContain(service)
    })

    it('records a Message to a queued service task before asking the turn to stop', async () => {
      const { host, other, service, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      try {
        const sent = await call(host, other, 'message_agent', {
          agent: service,
          piece: two.label,
          interrupt: true,
          text: 'stop and read this',
        })
        expect(sent.structured).toMatchObject({
          outcome: 'ok',
          agent: service,
          label: two.label,
          receipt: { recorded: { kind: 'message', id: expect.any(String) } },
        })
        expect(world.stopsAsked).toEqual(['browser-driver'])
      } finally {
        releaseTheTurn()
      }
    })

    it('delivers a Message with queued task context after that task is withdrawn', async () => {
      const { host, stranger, service, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      const words = 'Please keep this reference.'
      try {
        const sent = await call(host, stranger, 'message_agent', { agent: two.label, text: words })
        expect(sent.structured).toMatchObject({
          outcome: 'ok',
          delivery: 'queued',
          label: two.label,
        })
        const messageId = (sent.structured.receipt as SendReceipt).recorded.id
        expect(world.store.messagesWaitingIn(service)).toContainEqual(
          expect.objectContaining({ messageId, text: expect.stringContaining(words) }),
        )
        expect(await host.takeBackForAPerson(two.label, world.window)).toMatchObject({ ok: true })
        expect(stateOf(service, two.piece)).toBe('withdrawn')
        releaseTheTurn()
        await vi.waitFor(() => {
          const delivered = deliveredParts(service).filter((part) => part.text.includes(words))
          expect(delivered).toHaveLength(1)
          expect(delivered[0]!.text).toContain(two.label)
          expect(delivered[0]!.text).toContain('Two')
          expect(world.ledger(service)).toContainEqual(
            expect.objectContaining({ type: 'message_unqueued', messageId, reason: 'sent' }),
          )
        })
      } finally {
        releaseTheTurn()
      }
    })

    it.each(['id', 'label'])('lets a queued caller stop the active service by %s', async (key) => {
      const { host, other, service, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      try {
        const agent = key === 'id' ? service : two.label
        const reason = 'The room booking was cancelled'
        const stopped = await call(host, other, 'interrupt_agent', { agent, reason })
        expect(stopped.structured).toMatchObject({ outcome: 'ok', asked: true, agent: service })
        expect(world.stopsAsked).toEqual(['browser-driver'])
        expect(world.explicitStops).toEqual(['browser-driver'])
        expect(rows(service, 'work_interrupted')).toContainEqual(
          expect.objectContaining({ by: 'an-agent', agent: other, reason }),
        )
      } finally {
        releaseTheTurn()
      }
    })

    it('keeps the send behavior of a caller whose piece is queued', async () => {
      const { host, other, service, two } = await aServiceOnTheFirstPiece()
      for (const [agent, kind] of [
        [service, 'follow-up'],
        [two.label, 'note'],
      ] as const) {
        const sent = await call(host, other, 'message_agent', {
          agent,
          kind,
          ...(kind === 'follow-up' ? { piece: two.label } : {}),
          text: 'also order coffee',
        })
        expect(sent.structured).toMatchObject({
          outcome: 'ok',
          agent: service,
          label: two.label,
          receipt: { recorded: { kind: 'message', id: expect.any(String) } },
        })
      }
      const note = await call(host, other, 'message_agent', {
        agent: service,
        kind: 'note',
        text: 'hello',
      })
      expect(note.structured).toMatchObject({ outcome: 'ok', agent: service })
      await vi.waitFor(() => {
        expect(deliveredParts(service)).toContainEqual(
          expect.objectContaining({ text: 'hello', relayedFrom: other }),
        )
      })
      const before = world.ledger(service).length
      expect(
        (await call(host, other, 'update_work', { piece: two.label, brief: 'order tea' }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
      expect(
        (await call(host, other, 'withdraw_task', { piece: two.label })).structured,
      ).toMatchObject({ outcome: 'ok' })
      expect(
        world
          .ledger(service)
          .slice(before)
          .some((row) => row.type === 'user_turn' || row.type === 'message_queued'),
      ).toBe(false)
    })

    it('accepts an outside Message, named status edit and ending', async () => {
      const { host, stranger, service, one } = await aServiceOnTheFirstPiece()
      const sameProfile = await world.aPersonOpens(host, 'caller')
      for (const outsider of [stranger, sameProfile]) {
        const stopped = await call(host, outsider, 'interrupt_agent', {
          agent: service,
          reason: 'not needed now',
        })
        expect(stopped.structured).toMatchObject({ outcome: 'ok', agent: service })
        const sent = await call(host, outsider, 'message_agent', {
          agent: service,
          kind: 'note',
          text: 'hello',
        })
        expect(sent.structured).toMatchObject({ outcome: 'ok', agent: service })
        const receipt = sent.structured.receipt as SendReceipt
        expect(receipt.recipient.id).toBe(service)
        expect(world.ledger(outsider)).toContainEqual(
          expect.objectContaining({
            type: 'message_sent',
            to: service,
            messageAct: sent.structured.messageAct,
          }),
        )
        await vi.waitFor(() => {
          expect(deliveredParts(service)).toContainEqual(
            expect.objectContaining({ text: 'hello', relayedFrom: outsider }),
          )
        })
        expect(
          (await call(host, outsider, 'update_work', { piece: one.label, status: 'my progress' }))
            .structured,
        ).toMatchObject({ outcome: 'ok', status: 'my progress' })
      }
      expect(
        (await call(host, stranger, 'update_work', { piece: one.label, close: true })).structured,
      ).toMatchObject({ outcome: 'ok', state: 'closed' })
      expect(stateOf(service, one.piece)).toBe('closed')
    })

    it('accepts a Message about an ended piece while the service works on its next piece', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(taken.text).not.toContain('its turn was asked to stop')
      await handedOver(service, two.piece)
      const stopped = await call(host, caller, 'interrupt_agent', {
        agent: service,
        reason: 'not needed now',
      })
      expect(stopped.structured).toMatchObject({ outcome: 'ok', agent: service })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'one more thing',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok', agent: service })
      expect(
        (await call(host, other, 'interrupt_agent', { agent: service, reason: 'not needed now' }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
    })
  })
})
