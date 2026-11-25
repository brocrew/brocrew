import { TurnInProgress } from '@brobot2/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type RuntimeHost } from '../src/main/runtime/runtime-host'
import { type AServiceWorld } from './helpers/a-service-world'
import { aHeldNoticeWent } from './helpers/held-notices'
import { aServicePieceSuite, type Given } from './helpers/a-service-piece-suite'

describe('a service is reached through the piece it is on', () => {
  const suite = aServicePieceSuite()
  const {
    call,
    giveAndReportAFreeRoom,
    queueServiceFollowUp,
    stateOf,
    handedOver,
    rows,
    routed,
    aGate,
    aServiceOnTheFirstPiece,
  } = suite
  let world: AServiceWorld
  beforeEach(() => {
    world = suite.world()
  })

  describe('taking back the piece it is working on', () => {
    /** A stop answered late: the next piece waits for it, and is handed over once it lands. */
    const theLateStopHandsOver = async (
      service: string,
      piece: string,
      stop: { release(): void },
    ) => {
      await new Promise((settled) => setTimeout(settled, 100))
      expect(stateOf(service, piece)).toBe('waiting')
      const theNext = aGate()
      world.turnsWait = theNext.held
      stop.release()
      await handedOver(service, piece)
      return theNext
    }

    it('asks that turn to stop as it is taken back, through the notice held behind it, and hands the next piece over only once that stop is answered', async () => {
      // A bound long enough that only the stop's answer lets the next piece go.
      const { host, caller, other, service, one, two, releaseTheTurn } =
        await aServiceOnTheFirstPiece({ turnHeld: true, interruptWaitMs: 10_000 })
      const stop = aGate()
      world.stopsWait = stop.held
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({
        outcome: 'ok',
        state: 'withdrawn',
        askedItsTurnToStop: true,
      })
      expect(taken.text).toContain('no longer owes it; its turn was asked to stop.')
      expect(taken.text).not.toContain('interrupt_agent')
      expect(world.stopsAsked).toEqual(['browser-driver'])
      // Its piece has ended, so every command that turn started ends with it.
      expect(world.explicitStops).toEqual(['browser-driver'])
      // The piece ended first; its notice was held behind the turn, and asked that turn to stop.
      const types = world.ledger(service).map((row) => row.type)
      expect(types.indexOf('work_taken_back')).toBeGreaterThanOrEqual(0)
      expect(types.lastIndexOf('work_interrupted')).toBeGreaterThan(
        types.indexOf('work_taken_back'),
      )
      // The turn ends before the stop is answered; its notice starts no turn of its own and waits
      // for the next input.
      releaseTheTurn()
      await vi.waitFor(() => {
        expect([rows(service, 'turn').length, rows(service, 'user_turn').length]).toEqual([1, 1])
      })
      // ⛔ The stop is still on its way, and a provider that answers it late ends whatever turn is
      // open then: the next piece waits for it.
      const theNext = await theLateStopHandsOver(service, two.piece, stop)
      // The next piece's turn, its second, carries the take-back notice.
      await vi.waitFor(() => {
        expect(aHeldNoticeWent(world.ledger(service), 'a-piece-taken-back')).toBe(true)
      })
      expect(rows(service, 'user_turn')).toHaveLength(2)
      world.turnsWait = null
      theNext.release()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const ended = rows(service, 'turn').at(-1)
      expect(ended?.type === 'turn' && ended.state).toBe('completed')
      const turns = rows(service, 'user_turn')
      expect(turns.every((turn) => turn.type === 'user_turn' && turn.parts === undefined)).toBe(
        true,
      )
      expect(world.stopsAsked).toEqual(['browser-driver'])
      // …and the next piece's caller now reaches it.
      expect(
        (await call(host, other, 'interrupt_agent', { agent: service, reason: 'not needed now' }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
    })

    it('hands the next piece over once the bound has passed, for a stop its provider never answers', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        interruptWaitMs: 200,
      })
      world.stopsWait = aGate().held
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      releaseTheTurn()
      await handedOver(service, two.piece)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const ended = rows(service, 'turn').at(-1)
      expect(ended?.type === 'turn' && ended.state).toBe('completed')
    })

    it('leaves the next piece’s turn alone when a stop addressed to the turn it was asked of lands after the bound', async () => {
      const { host, caller, other, service, one, two, releaseTheTurn } =
        await aServiceOnTheFirstPiece({ turnHeld: true, interruptWaitMs: 500 })
      world.stopsAddressTheirTurn = true
      const stop = aGate()
      world.stopsWait = stop.held
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      // Its turn ends and its notice waits for the next input; the bound passes and the next
      // piece's turn opens, carrying it.
      const theNext = aGate()
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(1)
      })
      world.turnsWait = theNext.held
      expect(stateOf(service, two.piece)).toBe('waiting')
      await handedOver(service, two.piece)
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      // …and then the first piece's stop lands.
      stop.release()
      await new Promise((settled) => setTimeout(settled, 50))
      world.turnsWait = null
      theNext.release()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const ended = rows(service, 'turn').at(-1)
      expect(ended?.type === 'turn' && ended.state).toBe('completed')
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(
        (await call(host, other, 'interrupt_agent', { agent: service, reason: 'not needed now' }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
    })

    it('holds the next piece for a stop already on its way when the piece ends, and makes it explicit', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        interruptWaitMs: 10_000,
      })
      const stop = aGate()
      world.stopsWait = stop.held
      // Its answer waits for the stopped turn's ending, so it is read once that turn has ended.
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
      expect(world.explicitStops).toEqual([])
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(world.explicitStops).toEqual(['browser-driver'])
      // The turn ends before the stop is answered; the next piece waits for that answer.
      releaseTheTurn()
      expect((await sending).structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const theNext = await theLateStopHandsOver(service, two.piece, stop)
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(3)
      })
      world.turnsWait = null
      theNext.release()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(3)
      })
      const ended = rows(service, 'turn').at(-1)
      expect(ended?.type === 'turn' && ended.state).toBe('completed')
    })

    it('asks no stop of a turn whose words, still being handed over, drive another piece', async () => {
      // Its notice waits only briefly for the hand-over, then is held behind that turn.
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        deliveryWaitMs: 100,
      })
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller holds no work of its own')
      const noted = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'note',
        piece: root.label,
        text: 'for my own records',
      })
      expect(noted.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      // Its turn ends; the note's turn begins, and its hand-over has not settled.
      const settle = aGate()
      world.sendsSettle = settle.held
      const theNote = aGate()
      releaseTheTurn()
      world.turnsWait = theNote.held
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(1)
      })
      await new Promise((settled) => setTimeout(settled, 50))
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.sendsSettle = null
      settle.release()
      world.turnsWait = null
      theNote.release()
    })

    const aTurnAfterOneThatSettledLate = async (
      next: (host: RuntimeHost, caller: string, service: string, piece: string) => Promise<void>,
    ): Promise<{ host: RuntimeHost; caller: string; one: Given; release: () => void }> => {
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
      const settle = aGate()
      world.sendsSettle = settle.held
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      expect(rows(service, 'user_turn')).toHaveLength(1)
      world.sendsSettle = null
      const theirs = aGate()
      world.turnsWait = theirs.held
      await next(host, caller, service, one.label)
      settle.release()
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(3)
      })
      const [, nextTurn, late] = rows(service, 'user_turn')
      expect(late?.type === 'user_turn' && late.text).toContain('the room on the third floor')
      expect(nextTurn?.type === 'user_turn' && nextTurn.text).not.toContain(
        'the room on the third floor',
      )
      return {
        host,
        caller,
        one,
        release: () => {
          world.turnsWait = null
          theirs.release()
        },
      }
    }

    it('asks no stop of a person’s turn that began before the turn ahead of it had settled', async () => {
      const { host, caller, one, release } = await aTurnAfterOneThatSettledLate(
        async (host, _caller, service) => {
          host.claimSession(service, world.window)
          await host.send(service, 'how is it going?', world.window)
        },
      )
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      release()
    })

    it('asks the stop of its caller’s turn on its piece that began before the turn ahead of it had settled', async () => {
      const { host, caller, one, release } = await aTurnAfterOneThatSettledLate(
        async (host, caller, service, piece) => {
          const sent = await call(host, caller, 'message_agent', {
            agent: service,
            kind: 'follow-up',
            piece,
            text: 'and the one beside it',
          })
          expect(sent.structured).toMatchObject({ outcome: 'ok' })
        },
      )
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      release()
    })
    const theServicesProvider = (): AServiceWorld['handles'][number]['handle'] => {
      const provider = [...world.handles].reverse().find((kept) => kept.as === 'browser-driver')
      if (provider === undefined) throw new Error('the service has no provider')
      return provider.handle
    }
    const theCallersWordsWaitAtTheHandover = async (
      host: RuntimeHost,
      caller: string,
      service: string,
      piece: string,
    ): Promise<{ sent: Promise<{ structured: Record<string, unknown> }>; release: () => void }> => {
      const signIn = aGate()
      world.signInWait = signIn.held
      world.signInChecksLetThrough = world.signInChecks + 1
      const sent = call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece,
        text: 'the room on the third floor',
      })
      await vi.waitFor(() => {
        expect(world.signInChecks).toBe(world.signInChecksLetThrough + 1)
      })
      world.signInChecksLetThrough = Number.MAX_SAFE_INTEGER
      return {
        sent,
        release: () => {
          world.signInWait = null
          signIn.release()
        },
      }
    }

    it('asks the stop of its caller’s turn on its piece once a person’s turn before it has ended', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const theirs = aGate()
      world.turnsWait = theirs.held
      const sent = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(sent.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(3)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      world.turnsWait = null
      theirs.release()
    })

    it('reads a turn its provider begins by itself as the one before, when the words after that could not be stamped', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const reader = host as unknown as { stampFor: (...args: unknown[]) => unknown }
      const stamping = reader.stampFor.bind(host)
      reader.stampFor = () => {
        throw new Error('fictional unreadable identity')
      }
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      }).catch(() => undefined)
      reader.stampFor = stamping
      quiet.mockRestore()
      expect(rows(service, 'user_turn')).toHaveLength(2)
      const provider = theServicesProvider()
      provider.simulateThinking({ text: 'checking the calendar', redacted: false })
      expect(provider.status()).toBe('working')
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
    })

    const twoCallersWordsAfterAPersonsTurn = async (
      stamped: boolean,
    ): Promise<{ host: RuntimeHost; caller: string; one: Given; release: () => void }> => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const persons = aGate()
      world.turnsWait = persons.held
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      for (const text of ['the room on the third floor', 'and the one beside it']) {
        const sent = await call(host, caller, 'message_agent', {
          agent: service,
          kind: 'follow-up',
          piece: one.label,
          text,
        })
        expect(sent.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      }
      const reader = host as unknown as { stampForATurnOf: (...args: unknown[]) => unknown }
      const stamping = reader.stampForATurnOf.bind(host)
      let tried = 0
      if (!stamped) {
        reader.stampForATurnOf = () => {
          tried += 1
          throw new Error('fictional unreadable identity')
        }
      }
      const theirs = aGate()
      world.turnsWait = theirs.held
      persons.release()
      if (stamped) {
        await vi.waitFor(() => {
          expect(rows(service, 'user_turn')).toHaveLength(3)
        })
        const [, , together] = rows(service, 'user_turn')
        expect(together?.type === 'user_turn' && together.parts?.length).toBe(2)
      } else {
        await vi.waitFor(() => {
          expect(tried).toBe(1)
        })
        expect(rows(service, 'user_turn')).toHaveLength(2)
        const provider = theServicesProvider()
        provider.simulateThinking({ text: 'checking the calendar', redacted: false })
        expect(provider.status()).toBe('working')
      }
      return {
        host,
        caller,
        one,
        release: () => {
          reader.stampForATurnOf = stamping
          world.turnsWait = null
          theirs.release()
        },
      }
    }

    it('asks the stop of a turn of its caller’s words on its piece after a person’s turn', async () => {
      const { host, caller, one, release } = await twoCallersWordsAfterAPersonsTurn(true)
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      release()
    })

    it('reads a turn its provider begins by itself as the one before, when a turn of its caller’s words could not be stamped', async () => {
      const { host, caller, one, release } = await twoCallersWordsAfterAPersonsTurn(false)
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      release()
    })

    it('asks no stop of a person’s turn that its caller’s words lost the race to', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece({
        signInsChecked: true,
      })
      const waiting = await theCallersWordsWaitAtTheHandover(host, caller, service, one.label)
      const theirs = aGate()
      world.turnsWait = theirs.held
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      const provider = theServicesProvider()
      const send = provider.send.bind(provider)
      const refused: unknown[] = []
      provider.send = async (...args: Parameters<typeof send>) => {
        try {
          await send(...args)
        } catch (error) {
          refused.push(error)
          throw error
        }
      }
      waiting.release()
      expect((await waiting.sent).structured).toMatchObject({ outcome: 'ok' })
      expect(refused).toHaveLength(1)
      expect(refused[0]).toBeInstanceOf(TurnInProgress)
      expect(
        rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
        ),
      ).toBe(false)
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theirs.release()
    })

    it('asks no stop of a turn its provider began by itself after a person’s, once its caller’s words join it', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece({
        signInsChecked: true,
      })
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const waiting = await theCallersWordsWaitAtTheHandover(host, caller, service, one.label)
      const provider = theServicesProvider()
      provider.simulateThinking({ text: 'checking the calendar', redacted: false })
      expect(provider.status()).toBe('working')
      const theirs = aGate()
      world.turnsWait = theirs.held
      waiting.release()
      expect((await waiting.sent).structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').some(
            (turn) =>
              turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
          ),
        ).toBe(true)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theirs.release()
    })

    it('asks no stop of a turn its provider began by itself, once a person’s words join it', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const provider = theServicesProvider()
      provider.simulateThinking({ text: 'checking the calendar', redacted: false })
      expect(provider.status()).toBe('working')
      const theirs = aGate()
      world.turnsWait = theirs.held
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theirs.release()
    })

    it('asks no stop of a turn a person’s answer opened', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'which floor?',
        who_answers: 'a-person',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      const theirs = aGate()
      world.turnsWait = theirs.held
      const answered = await host.respondUserInput(
        service,
        String(asked.structured['question']),
        { kind: 'answer', answers: { answer: ['the third'] } },
        world.window,
      )
      expect(answered).toMatchObject({ outcome: 'taken' })
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theirs.release()
    })

    it('asks no stop of a turn a person’s go-ahead opened', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const theirs = aGate()
      world.turnsWait = theirs.held
      host.claimSession(service, world.window)
      await host.setSessionSetting(service, { kind: 'planMode', on: true }, world.window)
      await host.endPlanMode(service, world.window, 'Go ahead with the plan.')
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theirs.release()
    })

    it('asks no stop of a turn its caller’s words and a person’s go in together', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      host.claimSession(service, world.window)
      expect((await host.queueMessage(service, 'how is it going?', world.window)).outcome).toBe(
        'queued',
      )
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      const theirs = aGate()
      releaseTheTurn()
      world.turnsWait = theirs.held
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const [, together] = rows(service, 'user_turn')
      expect(together?.type === 'user_turn' && together.parts?.length).toBe(2)
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theirs.release()
    })

    it('asks the stop only of the turn it read, never of the turn that runs after it', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      world.anAgent('helper', 'nothing kept')
      await giveAndReportAFreeRoom(host, service)
      const signIn = aGate()
      world.signInWait = signIn.held
      const taking = call(host, caller, 'withdraw_task', { piece: one.label })
      await vi.waitFor(() => {
        expect(rows(service, 'work_taken_back')).toHaveLength(1)
      })
      const theReply = aGate()
      releaseTheTurn()
      world.turnsWait = theReply.held
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(1)
      })
      await new Promise((settled) => setTimeout(settled, 50))
      world.signInWait = null
      signIn.release()
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      // The take-back holds its notice without waiting on a start, so it asks the stop while the
      // turn it read still runs on the piece: that one stop, and no other.
      const { structured } = await taking
      expect(structured).toMatchObject({
        outcome: 'ok',
        state: 'withdrawn',
        askedItsTurnToStop: true,
      })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      world.turnsWait = null
      theReply.release()
      await handedOver(service, two.piece)
      expect(world.stopsAsked).toEqual(['browser-driver'])
    })

    it.each(['drive another piece', 'are a person’s'])(
      'asks no stop of a turn it read before it began, whose words %s',
      async (words) => {
        const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
          turnHeld: true,
          signInsChecked: true,
        })
        if (words === 'drive another piece') {
          const root = world.store.rootOf(caller)
          if (root === null) throw new Error('the caller holds no work of its own')
          const noted = await call(host, caller, 'message_agent', {
            agent: service,
            kind: 'note',
            piece: root.label,
            text: 'for my own records',
          })
          expect(noted.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
        } else {
          host.claimSession(service, world.window)
          await host.send(service, 'how is it going?', world.window)
        }
        const signIn = aGate()
        world.signInWait = signIn.held
        const theNext = aGate()
        releaseTheTurn()
        world.turnsWait = theNext.held
        await vi.waitFor(() => {
          expect(rows(service, 'turn')).toHaveLength(1)
        })
        await new Promise((settled) => setTimeout(settled, 50))
        const taking = call(host, caller, 'withdraw_task', { piece: one.label })
        await vi.waitFor(() => {
          expect(rows(service, 'work_taken_back')).toHaveLength(1)
        })
        world.signInWait = null
        signIn.release()
        await vi.waitFor(() => {
          expect(rows(service, 'user_turn')).toHaveLength(2)
        })
        const taken = await taking
        expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
        expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
        expect(world.stopsAsked).toEqual([])
        world.turnsWait = null
        theNext.release()
      },
    )

    it('asks that turn to stop when its caller closes the piece, as a take-back does', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        interruptWaitMs: 200,
      })
      const closed = await call(host, caller, 'update_work', { piece: one.label, close: true })
      expect(closed.structured).toMatchObject({
        outcome: 'ok',
        state: 'closed',
        askedItsTurnToStop: true,
      })
      expect(closed.text).toContain('no longer owes it; its turn was asked to stop.')
      expect(closed.text).not.toContain('interrupt_agent')
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(world.explicitStops).toEqual(['browser-driver'])
      const types = world.ledger(service).map((row) => row.type)
      expect(types.lastIndexOf('work_interrupted')).toBeGreaterThan(types.indexOf('work_closed'))
      releaseTheTurn()
      await handedOver(service, two.piece)
    })

    it('drops an internal follow-up its caller sent before taking the piece back', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        interruptWaitMs: 200,
      })
      const followed = await queueServiceFollowUp(host, caller, one, 'the room on the third floor')
      expect(followed.outcome).toBe('queued')
      await call(host, caller, 'withdraw_task', { piece: one.label })
      releaseTheTurn()
      await handedOver(service, two.piece)
      const ending = world
        .ledger(service)
        .find(
          (row) =>
            row.type === 'message_unqueued' &&
            row.reason === 'abandoned' &&
            row.text === 'the room on the third floor',
        )
      expect(ending).toBeDefined()
      expect(
        rows(service, 'user_turn').some(
          (turn) => turn.type === 'user_turn' && turn.text.includes('the room on the third floor'),
        ),
      ).toBe(false)
    })

    it('stops a turn waiting on its own caller’s answer, so the next piece is not held behind it', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      const handle = world.handles.filter((each) => each.as === 'browser-driver').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      const asked = await call(host, service, 'ask_question', {
        who_answers: 'the-parent',
        question: 'which room?',
        options: ['north', 'south'],
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      const card = { id: String(asked.structured['question']) }
      await vi.waitFor(() => {
        expect(routed(service).get(card.id)).toMatchObject({ parent: caller })
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(
        world.store
          .routedRequestsOf(service)
          .some((row) => row.requestId === card.id && row.state === 'work-withdrawn'),
      ).toBe(true)
      releaseTheTurn()
      await handedOver(service, two.piece)
    })

    it('never stops a turn a person’s own words opened', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const turn = aGate()
      world.turnsWait = turn.held
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(2)
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(taken.text).not.toContain('interrupt_agent')
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      turn.release()
    })

    it('asks nothing of a turn waiting on a person, whose card stays theirs', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece({ ask: true })
      const [card] = rows(service, 'permission_request')
      if (card?.type !== 'permission_request') throw new Error('no card')
      expect(routed(service).get(card.id)).toMatchObject({ to: 'a-person', parent: caller })
      // The caller may not stop it there, nor answer the card.
      expect(
        (await call(host, caller, 'interrupt_agent', { agent: service, reason: 'not needed now' }))
          .structured,
      ).toMatchObject({ outcome: 'refused', rail: 'a-person-is-being-asked' })
      const answered = await call(host, caller, 'answer_question', {
        question: card.id,
        answers: [{ part: 'q0', answer: ['allow'] }],
      })
      expect(answered.structured).toMatchObject({ outcome: 'refused' })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      expect(rows(service, 'request_interrupted')).toHaveLength(0)
    })
  })
})
