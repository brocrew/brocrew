import type { SendReceipt } from '../src/shared/tool-outcome'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { THE_APP_ITSELF, type RuntimeHost } from '../src/main/runtime/runtime-host'
import { type AServiceWorld } from './helpers/a-service-world'
import { aServicePieceSuite, type Given } from './helpers/a-service-piece-suite'

describe('a service is reached through the piece it is on', () => {
  const suite = aServicePieceSuite()
  const {
    call,
    giveAndReportAFreeRoom,
    queueServiceFollowUp,
    stateOf,
    rows,
    deliveredParts,
    aGate,
    holdFollowUpAtSignIn,
    aServiceOnTheFirstPiece,
  } = suite
  let world: AServiceWorld
  beforeEach(() => {
    world = suite.world()
  })

  describe('its reach after a restart, a stop and a wait', () => {
    it('reopens a service with an outsider’s held Message ahead of the next queued task', async () => {
      const { host, stranger, service, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      const text = 'Please keep this reference with the current request.'
      try {
        const sent = await call(host, stranger, 'message_agent', { agent: service, text })
        expect(sent.structured).toMatchObject({ outcome: 'ok', delivery: 'queued', agent: service })
        const receipt = sent.structured.receipt as SendReceipt
        const messageAct = sent.structured['messageAct']
        expect(typeof messageAct).toBe('string')
        const waiting = () =>
          world.store.messagesWaitingIn(service).find((row) => row.text === text)
        expect(receipt.recipient.id).toBe(service)
        const messageId = receipt.recorded.id
        const recorded = { messageAct, messageId, authorship: { relayedFrom: stranger } }
        expect(waiting()).toMatchObject(recorded)
        expect(stateOf(service, two.piece)).toBe('waiting')
        await host.closeAll()
        releaseTheTurn()
        expect(waiting()).toMatchObject(recorded)

        world.aHost()
        await vi.waitFor(() => {
          const delivered = world.sent.filter(
            (send) => send.as === 'browser-driver' && send.words.includes(text),
          )
          expect(delivered).toHaveLength(1)
          expect(waiting()).toBeUndefined()
          expect(deliveredParts(service)).toContainEqual(
            expect.objectContaining({ text, relayedFrom: stranger }),
          )
        })
        expect(world.ledger(service)).toContainEqual(
          expect.objectContaining({
            type: 'message_unqueued',
            messageId,
            reason: 'sent',
          }),
        )
        expect(stateOf(service, two.piece)).toBe('waiting')
      } finally {
        releaseTheTurn()
      }
    })

    it('starts the service for Messages from both a successor and another conversation', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const standIn = await world.aPersonOpens(host, 'caller')
      await host.closeAll()
      world.store.append(
        caller,
        world.store.nextOrdinal(caller),
        { type: 'replaced_by', sessionId: standIn },
        world.clock++,
      )
      const after = world.aHost()
      const another = await world.aPersonOpens(after, 'caller')
      const starts = world.startedAs.filter((one) => one === 'browser-driver').length
      const theirs = await call(after, another, 'message_agent', {
        agent: service,
        kind: 'note',
        text: 'hello',
      })
      expect(theirs.structured).toMatchObject({ outcome: 'ok', agent: service })
      const followed = await call(after, standIn, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').some(
            (turn) =>
              turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
          ),
        ).toBe(true)
      })
      expect(world.startedAs.filter((one) => one === 'browser-driver').length).toBe(starts)
      expect(world.handles.filter((each) => each.as === 'browser-driver').length).toBeGreaterThan(1)
    })

    it('starts the same stopped service for both its current and former callers', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      expect(
        (await call(host, other, 'withdraw_task', { piece: two.label })).structured,
      ).toMatchObject({ outcome: 'ok' })
      await host.close(service, THE_APP_ITSELF)
      const lives = (): number =>
        world.handles.filter((each) => each.as === 'browser-driver').length
      const before = lives()
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(lives()).toBe(before + 1)
      })
      await host.close(service, THE_APP_ITSELF)
      // The take-back notice waits for its next input and starts nothing of its own.
      expect(
        (await call(host, caller, 'withdraw_task', { piece: one.label })).structured,
      ).toMatchObject({ outcome: 'ok' })
      await new Promise((settled) => setTimeout(settled, 100))
      expect(lives()).toBe(before + 1)
      const late = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'one more thing',
      })
      expect(late.structured).toMatchObject({ outcome: 'ok', agent: service })
      expect(lives()).toBe(before + 2)
    })

    it('stops no turn of its that drives another piece when that piece is taken back', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller holds no work of its own')
      const turn = aGate()
      world.turnsWait = turn.held
      const noted = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'note',
        piece: root.label,
        text: 'for my own records',
      })
      expect(noted.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      turn.release()
    })
    const aTurnOfTheCallersWords = async (
      about: readonly ('its-piece' | 'its-own-work' | 'nothing')[],
    ): Promise<{
      host: RuntimeHost
      caller: string
      service: string
      one: Given
      release: () => void
    }> => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller holds no work of its own')
      for (const [at, named] of about.entries()) {
        const sent = await call(host, caller, 'message_agent', {
          agent: service,
          ...(named === 'its-piece'
            ? { kind: 'follow-up', piece: one.label }
            : named === 'its-own-work'
              ? { kind: 'note', piece: root.label }
              : { kind: 'note' }),
          text: `word ${String(at)}`,
        })
        expect(sent.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      }
      const theirs = aGate()
      releaseTheTurn()
      world.turnsWait = theirs.held
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const [, batch] = rows(service, 'user_turn')
      expect(batch?.type === 'user_turn' && batch.parts?.length).toBe(about.length)
      return {
        host,
        caller,
        service,
        one,
        release: () => {
          world.turnsWait = null
          theirs.release()
        },
      }
    }

    it('asks no stop of a turn whose words name other work beside its piece', async () => {
      const { host, caller, one, release } = await aTurnOfTheCallersWords([
        'its-own-work',
        'its-piece',
      ])
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      release()
    })

    it('asks no stop of a turn whose words asked to stop one that named other work', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller holds no work of its own')
      const first = aGate()
      world.turnsWait = first.held
      const noted = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'note',
        piece: root.label,
        text: 'for my own records',
      })
      expect(noted.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const sending = call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        interrupt: true,
        text: 'stop and read this',
      })
      await vi.waitFor(() => {
        expect(world.stopsAsked).toEqual(['browser-driver'])
      })
      const second = aGate()
      world.turnsWait = second.held
      first.release()
      expect((await sending).structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(3)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual(['browser-driver'])
      world.turnsWait = null
      second.release()
    })

    it.each([
      ['its piece twice', ['its-piece', 'its-piece']],
      ['its piece and nothing', ['nothing', 'its-piece']],
    ] as const)('asks the stop of a turn whose words name %s', async (_named, about) => {
      const { host, caller, one, release } = await aTurnOfTheCallersWords(about)
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      release()
    })

    it('accepts a requested stop after the caller’s piece ended', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      const signIn = aGate()
      world.signInWait = signIn.held
      const sending = call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        interrupt: true,
        text: 'stop and read this',
      })
      await new Promise((settled) => setTimeout(settled, 50))
      const answering = call(host, service, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'Booked.',
      })
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('answered')
      })
      world.signInWait = null
      signIn.release()
      expect((await sending).structured).toMatchObject({ outcome: 'ok' })
      await answering
      expect(world.stopsAsked).toEqual(['browser-driver'])
      releaseTheTurn()
    })

    it('holds an internal follow-up while its queue can’t be read: they neither go nor end, and ask no stop; a person’s go', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      const signIn = aGate()
      world.signInWait = signIn.held
      const sending = host.messageAgentNow(
        service,
        'the room on the third floor',
        { ownerId: agentCallerId(caller) },
        'follow-up',
        { aboutPiece: { piece: one.piece, label: one.label } },
      )
      await new Promise((settled) => setTimeout(settled, 50))
      const ordinal = world.store.nextOrdinal(service) + 1_000
      world.store.append(
        service,
        ordinal,
        { type: 'work_status_set', piece: one.piece, line: 'torn', by: caller },
        world.clock++,
      )
      world.db
        .prepare("UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?")
        .run(service, ordinal)
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      world.signInWait = null
      signIn.release()
      expect(await sending).toMatchObject({
        ok: true,
        delivery: { outcome: 'queued' },
        stop: 'could-not-be-asked',
      })
      expect(world.stopsAsked).toEqual([])
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').some(
            (turn) => turn.type === 'user_turn' && turn.text.includes('how is it going?'),
          ),
        ).toBe(true)
      })
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      await new Promise((settled) => setTimeout(settled, 100))
      expect(
        rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
        ),
      ).toBe(false)
      expect(
        world
          .ledger(service)
          .some(
            (row) => row.type === 'message_unqueued' && row.text === 'the room on the third floor',
          ),
      ).toBe(false)
      expect(world.stopsAsked).toEqual([])
      quiet.mockRestore()
    })

    it('keeps an internal follow-up through a restart that can’t read the services list', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece({ turnHeld: true })
      const followed = await queueServiceFollowUp(host, caller, one, 'the room on the third floor')
      expect(followed.outcome).toBe('queued')
      world.turnsWait = null
      await host.closeAll()
      world.loseTheKept()
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const after = world.aHost()
      await after.resumeSession(service, world.window)
      await after.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').some(
            (turn) => turn.type === 'user_turn' && turn.text.includes('how is it going?'),
          ),
        ).toBe(true)
      })
      await new Promise((settled) => setTimeout(settled, 100))
      expect(
        rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
        ),
      ).toBe(false)
      expect(
        world
          .ledger(service)
          .some(
            (row) => row.type === 'message_unqueued' && row.text === 'the room on the third floor',
          ),
      ).toBe(false)
      quiet.mockRestore()
    })

    it.each(['answered', 'answered, and no ending can be read', 'unread', 'unchanged'] as const)(
      'asks an internal follow-up again after the flush’s last wait, once its piece is %s',
      async (meanwhile) => {
        const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
          turnHeld: true,
          signInsChecked: true,
        })
        const signIn = await holdFollowUpAtSignIn(host, caller, one, releaseTheTurn)
        expect(rows(service, 'user_turn')).toHaveLength(1)
        const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let answering: Promise<unknown> = Promise.resolve()
        let tornAt = 0
        let whole = ''
        if (meanwhile !== 'unread' && meanwhile !== 'unchanged') {
          answering = call(host, service, 'reply_to_parent', {
            piece: one.label,
            outcome: 'done',
            summary: 'Booked.',
          })
          await vi.waitFor(() => {
            expect(stateOf(service, one.piece)).toBe('answered')
          })
        }
        if (meanwhile === 'answered, and no ending can be read') {
          const reader = host as unknown as {
            whyItNoLongerGoes: (...args: unknown[]) => unknown
          }
          const asking = reader.whyItNoLongerGoes.bind(host)
          const reading = world.store.piecesOwnedBy.bind(world.store)
          let failing = false
          vi.spyOn(world.store, 'piecesOwnedBy').mockImplementation((...args) => {
            if (failing) throw new Error('fictional unreadable row')
            return reading(...args)
          })
          reader.whyItNoLongerGoes = (...args) => {
            failing = true
            try {
              return asking(...args)
            } finally {
              failing = false
            }
          }
        } else if (meanwhile === 'unread') {
          tornAt = world.store.nextOrdinal(service) + 1_000
          world.store.append(
            service,
            tornAt,
            { type: 'work_status_set', piece: one.piece, line: 'torn', by: caller },
            world.clock++,
          )
          whole = (
            world.db
              .prepare('SELECT payload FROM events WHERE session_id = ? AND ordinal = ?')
              .get(service, tornAt) as { payload: string }
          ).payload
          world.db
            .prepare("UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?")
            .run(service, tornAt)
        }
        world.signInWait = null
        signIn.release()
        await answering
        await new Promise((settled) => setTimeout(settled, 200))
        quiet.mockRestore()
        const went = rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
        )
        const endings = world
          .ledger(service)
          .flatMap((row) =>
            row.type === 'message_unqueued' &&
            row.reason !== 'sent' &&
            row.text === 'the room on the third floor'
              ? [`${row.reason}: ${row.detail ?? ''}`]
              : [],
          )
        const ended = endings.length > 0
        if (ended) expect(endings).toEqual(['abandoned: the piece it carried had already ended'])
        expect({ went, ended }).toEqual(
          meanwhile === 'unchanged'
            ? { went: true, ended: false }
            : meanwhile === 'unread'
              ? { went: false, ended: false }
              : { went: false, ended: true },
        )
        expect(world.stopsAsked).toEqual([])
        vi.restoreAllMocks()
        if (meanwhile !== 'unread') return
        world.db
          .prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?')
          .run(whole, service, tornAt)
        await queueServiceFollowUp(host, caller, one, 'and the one beside it')
        await vi.waitFor(() => {
          expect(
            rows(service, 'user_turn').some(
              (turn) =>
                turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
            ),
          ).toBe(true)
        })
      },
    )

    it('lets nothing held with an internal follow-up overtake them while they wait for its queue, after the last wait', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      world.anAgent('helper', 'nothing kept')
      await giveAndReportAFreeRoom(host, service)
      const signIn = await holdFollowUpAtSignIn(host, caller, one, releaseTheTurn)
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const ordinal = world.store.nextOrdinal(service) + 1_000
      world.store.append(
        service,
        ordinal,
        { type: 'work_status_set', piece: one.piece, line: 'torn', by: caller },
        world.clock++,
      )
      world.db
        .prepare("UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?")
        .run(service, ordinal)
      world.signInWait = null
      signIn.release()
      await new Promise((settled) => setTimeout(settled, 200))
      quiet.mockRestore()
      expect(rows(service, 'user_turn')).toHaveLength(1)
      expect(
        world
          .ledger(service)
          .some((row) => row.type === 'message_unqueued' && row.reason !== 'sent'),
      ).toBe(false)
    })

    it.each(['answered', 'unread', 'unchanged'] as const)(
      'asks an internal follow-up again as it goes straight in, after the last wait, once its piece is %s',
      async (meanwhile) => {
        const { host, caller, service, one } = await aServiceOnTheFirstPiece({
          signInsChecked: true,
        })
        const signIn = aGate()
        world.signInWait = signIn.held
        world.signInChecksLetThrough = world.signInChecks + 1
        const sending = queueServiceFollowUp(host, caller, one, 'the room on the third floor').then(
          (sent) => sent.outcome,
          () => 'refused',
        )
        await vi.waitFor(() => {
          expect(world.signInChecks).toBe(world.signInChecksLetThrough + 1)
        })
        const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let answering: Promise<unknown> = Promise.resolve()
        if (meanwhile === 'answered') {
          world.signInChecksLetThrough = Number.MAX_SAFE_INTEGER
          answering = call(host, service, 'reply_to_parent', {
            piece: one.label,
            outcome: 'done',
            summary: 'Booked.',
          })
          await vi.waitFor(() => {
            expect(stateOf(service, one.piece)).toBe('answered')
          })
        } else if (meanwhile === 'unread') {
          const ordinal = world.store.nextOrdinal(service) + 1_000
          world.store.append(
            service,
            ordinal,
            { type: 'work_status_set', piece: one.piece, line: 'torn', by: caller },
            world.clock++,
          )
          world.db
            .prepare("UPDATE events SET payload = '{not json' WHERE session_id = ? AND ordinal = ?")
            .run(service, ordinal)
        }
        world.signInWait = null
        signIn.release()
        const sent = await sending
        await answering
        await new Promise((settled) => setTimeout(settled, 100))
        quiet.mockRestore()
        const went = rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
        )
        expect(went).toBe(meanwhile === 'unchanged')
        expect(sent).toBe(meanwhile === 'unchanged' ? 'sent' : 'refused')
      },
    )

    it('hands a caller’s held words to it once its turn ends, while its piece is on', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').some(
            (turn) =>
              turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
          ),
        ).toBe(true)
      })
    })
  })
})
