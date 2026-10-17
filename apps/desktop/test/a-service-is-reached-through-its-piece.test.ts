import { writeFileSync } from 'node:fs'
import { TurnInProgress } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileExecutionFile } from '../src/main/profile-execution-file'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  THE_APP_ITSELF,
  type GiveOutcome,
  type RuntimeHost,
} from '../src/main/runtime/runtime-host'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { pieceLine } from '../src/shared/piece-called'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import type { PieceRow } from '../src/shared/tasks'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

/**
 * A caller reaches a service only through the piece the service is on for it: it may stop that
 * piece's turn, follow it up, give it a new brief, close it or take it back, and nothing more —
 * never another caller's piece, and nothing once its own has ended. A question the service raises
 * goes to the caller of the piece it is on as it is raised, and stays that caller's. Fictional
 * agents only, reached through the host: services are switched off in the app.
 */

type Given = Extract<GiveOutcome, { ok: true }>

describe('a service is reached through the piece it is on', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
  })
  afterEach(async () => {
    world.turnsWait = null
    world.stopsWait = null
    world.stopsAddressTheirTurn = false
    world.signInWait = null
    world.sendsSettle = null
    world.clockStep = 1
    world.signInChecksLetThrough = 0
    await world.cleanUp()
  })

  const accepted = (outcome: GiveOutcome): Given => {
    if (!outcome.ok) throw new Error(`refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
    return outcome
  }
  const call = async (
    host: RuntimeHost,
    conversation: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = agentToolsFor(host, conversation).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }
  const piecesOf = (service: string): readonly PieceRow[] => world.store.piecesOwnedBy(service)
  const stateOf = (service: string, piece: string): string | undefined =>
    piecesOf(service).find((one) => one.piece === piece)?.state
  const handedOver = async (service: string, piece: string): Promise<void> => {
    await vi.waitFor(() => {
      expect(stateOf(service, piece)).not.toBe('waiting')
    })
  }
  const rows = (conversation: string, type: TranscriptEvent['type']): TranscriptEvent[] =>
    world.ledger(conversation).filter((row) => row.type === type)
  /** The routing rows of `service`'s questions, by request id. */
  const routed = (
    service: string,
  ): Map<string, Extract<TranscriptEvent, { type: 'request_routed' }>> =>
    new Map(
      world
        .ledger(service)
        .flatMap((row) => (row.type === 'request_routed' ? [[row.requestId, row] as const] : [])),
    )
  /** Release a gate the world holds, so nothing waits on it any more. */
  const aGate = (): { readonly held: Promise<void>; readonly release: () => void } => {
    let release = (): void => {}
    const held = new Promise<void>((done) => {
      release = done
    })
    return { held, release }
  }

  /**
   * A service, two callers a person opened, and a third with nothing at the service. `caller` gives
   * the first piece and `other` the second, which waits behind it. With `turnHeld`, the first
   * piece's turn is still working; else it has run and its piece stalled. With `signInsChecked`,
   * its providers check their sign-in, so {@link AServiceWorld.signInWait} can hold words going in.
   */
  const aServiceOnTheFirstPiece = async (
    opts: {
      turnHeld?: boolean
      ask?: boolean
      interruptWaitMs?: number
      deliveryWaitMs?: number
      signInsChecked?: boolean
    } = {},
  ): Promise<{
    host: RuntimeHost
    caller: string
    other: string
    stranger: string
    service: string
    one: Given
    two: Given
    releaseTheTurn: () => void
  }> => {
    world.anAgent('browser-driver')
    world.anAgent('caller', 'nothing kept')
    world.anAgent('other-caller', 'nothing kept')
    world.anAgent('stranger', 'nothing kept')
    if (opts.ask !== true) world.store.setDefaultApprovalMode('auto')
    world.signInsChecked = opts.signInsChecked === true
    const host = world.aHost({
      ...(opts.interruptWaitMs === undefined ? {} : { interruptWaitMs: opts.interruptWaitMs }),
      ...(opts.deliveryWaitMs === undefined ? {} : { deliveryWaitMs: opts.deliveryWaitMs }),
    })
    const caller = await world.aPersonOpens(host, 'caller')
    const other = await world.aPersonOpens(host, 'other-caller')
    const stranger = await world.aPersonOpens(host, 'stranger')
    const turn = aGate()
    if (opts.turnHeld === true) world.turnsWait = turn.held
    const one = accepted(await world.gives(host, caller, 'browser-driver', { title: 'One' }))
    const two = accepted(await world.gives(host, other, 'browser-driver', { title: 'Two' }))
    const service = one.owner
    await handedOver(service, one.piece)
    if (opts.turnHeld === true) {
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(1)
      })
    } else if (opts.ask === true) {
      await vi.waitFor(() => {
        expect(rows(service, 'permission_request')).toHaveLength(1)
      })
    } else {
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
    }
    return {
      host,
      caller,
      other,
      stranger,
      service,
      one,
      two,
      releaseTheTurn: () => {
        world.turnsWait = null
        turn.release()
      },
    }
  }

  describe('who may reach it', () => {
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

    it('opens no other door to it: its status, its record and a question to it stay out of reach', async () => {
      const { host, caller, service } = await aServiceOnTheFirstPiece()
      const status = await call(host, caller, 'get_agent_status', { agent: service })
      expect(status.structured).toMatchObject({ outcome: 'refused' })
      const asked = await call(host, caller, 'ask_question', {
        who_answers: 'an-agent',
        agent: service,
        question: 'which floor?',
      })
      expect(asked.structured).toMatchObject({ outcome: 'refused' })
      const listed = await call(host, caller, 'list_agents', {})
      expect(JSON.stringify(listed.structured)).not.toContain(service)
    })

    it('lets a message to it ask its turn to stop only from the caller whose piece it is on', async () => {
      const { host, caller, other, service, one, two, releaseTheTurn } =
        await aServiceOnTheFirstPiece({ turnHeld: true })
      const theirs = await call(host, other, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: two.label,
        interrupt: true,
        text: 'stop and read this',
      })
      expect(theirs.structured).toMatchObject({
        outcome: 'refused',
        rail: 'that-piece-is-still-queued',
      })
      expect(world.stopsAsked).toEqual([])
      const own = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        interrupt: true,
        text: 'stop and read this',
      })
      expect(own.structured).toMatchObject({ outcome: 'ok' })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      // It only makes way for the words: the commands that turn started go on.
      expect(world.explicitStops).toEqual([])
      releaseTheTurn()
    })

    it('refuses the caller whose piece is only queued, with the words for each act', async () => {
      const { host, other, service, two } = await aServiceOnTheFirstPiece()
      for (const agent of [service, two.label]) {
        const stopped = await call(host, other, 'interrupt_agent', {
          agent,
          reason: 'not needed now',
        })
        expect(stopped.structured).toMatchObject({
          outcome: 'refused',
          rail: 'that-service-is-on-another-callers-piece',
          retryable: true,
          remedy: 'make-the-same-call-when-this-settles',
        })
        expect(stopped.text).toContain('Not stopped: that service is on another caller’s piece.')
      }
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
          outcome: 'refused',
          rail: 'that-piece-is-still-queued',
        })
        expect(sent.text).toContain(
          `Not sent: ${two.label} is still queued. Change its brief with update_work.`,
        )
      }
      const note = await call(host, other, 'message_agent', {
        agent: service,
        kind: 'note',
        text: 'hello',
      })
      expect(note.structured).toMatchObject({ outcome: 'refused' })
      expect(note.structured['rail']).not.toBe('that-piece-is-still-queued')
      // Its own queued piece is still its to change or take back, and the service hears nothing.
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

    it('refuses a caller with nothing there, and another conversation of the caller’s own profile', async () => {
      const { host, stranger, service, one } = await aServiceOnTheFirstPiece()
      const sameProfile = await world.aPersonOpens(host, 'caller')
      for (const outsider of [stranger, sameProfile]) {
        // Nothing of its own waits there, so no retry is promised.
        const stopped = await call(host, outsider, 'interrupt_agent', {
          agent: service,
          reason: 'not needed now',
        })
        expect(stopped.structured).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
        const sent = await call(host, outsider, 'message_agent', {
          agent: service,
          kind: 'note',
          text: 'hello',
        })
        expect(sent.structured).toMatchObject({ outcome: 'refused' })
        expect(
          (await call(host, outsider, 'withdraw_task', { piece: one.label })).structured,
        ).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })
        expect(
          (await call(host, outsider, 'update_work', { piece: one.label, close: true })).structured,
        ).toMatchObject({ outcome: 'refused', rail: 'no-piece-by-that-name' })
      }
      expect(stateOf(service, one.piece)).toBe('stalled')
    })

    it('takes the caller’s reach away with its piece, and gives it to the next caller', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      // Nothing ran in it, so no stop was asked, and the answer says none.
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(taken.text).not.toContain('its turn was asked to stop')
      await handedOver(service, two.piece)
      const stopped = await call(host, caller, 'interrupt_agent', {
        agent: service,
        reason: 'not needed now',
      })
      expect(stopped.structured).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'one more thing',
      })
      expect(followed.structured).toMatchObject({ outcome: 'refused' })
      expect(
        (await call(host, other, 'interrupt_agent', { agent: service, reason: 'not needed now' }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
    })
  })

  describe('its reach after a restart, a stop and a wait', () => {
    it('lets the conversation standing in for the caller reach it, and starts it for its words; never another of its profile', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const standIn = await world.aPersonOpens(host, 'caller')
      // Written once nothing runs, so no life of the caller's writes after it.
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
      expect(theirs.structured).toMatchObject({ outcome: 'refused' })
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

    it('starts a stopped service for its caller’s words, and for a former caller’s never', async () => {
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
      expect(
        (await call(host, caller, 'withdraw_task', { piece: one.label })).structured,
      ).toMatchObject({ outcome: 'ok' })
      // The take-back's own notice wakes it to be told; then it is stopped again.
      await vi.waitFor(() => {
        expect(lives()).toBe(before + 2)
      })
      await host.close(service, THE_APP_ITSELF)
      const late = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'one more thing',
      })
      expect(late.structured).toMatchObject({ outcome: 'refused' })
      await new Promise((settled) => setTimeout(settled, 50))
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

    /**
     * The caller's words, held behind the first piece's turn, go in one turn of their own when it
     * ends, and that turn is held working: `about` names the piece each one names.
     */
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
      // Its words ask that turn to stop, and go in the turn after it.
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

    it('asks no stop for words whose caller’s piece ended while they were on their way', async () => {
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
      expect(world.stopsAsked).toEqual([])
      releaseTheTurn()
    })

    it('holds a caller’s words while its queue can’t be read: they neither go nor end, and ask no stop; a person’s go', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      const signIn = aGate()
      world.signInWait = signIn.held
      const sending = call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        interrupt: true,
        text: 'the room on the third floor',
      })
      await new Promise((settled) => setTimeout(settled, 50))
      // A row of its work that can't be read, written past where its live session writes next.
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
      expect((await sending).structured).toMatchObject({
        outcome: 'ok',
        delivery: 'queued',
        asked_to_stop: false,
        not_stopped_because: 'could-not-be-asked',
      })
      expect(world.stopsAsked).toEqual([])
      releaseTheTurn()
      // Its turn ends: a person's words go, and the caller's wait.
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

    it('keeps a caller’s held words through a restart that can’t read the services list', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece({ turnHeld: true })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      world.turnsWait = null
      await host.closeAll()
      writeFileSync(profileExecutionFile(world.folder), '{not json')
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const after = world.aHost()
      // A person opens it again, and their words go; the caller's are neither sent nor ended.
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
      'asks a caller’s held words again after the flush’s last wait, once its piece is %s',
      async (meanwhile) => {
        const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
          turnHeld: true,
          signInsChecked: true,
        })
        const followed = await call(host, caller, 'message_agent', {
          agent: service,
          kind: 'follow-up',
          piece: one.label,
          text: 'the room on the third floor',
        })
        expect(followed.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
        // Its turn ends; the flush takes the words and waits at the sign-in check.
        const signIn = aGate()
        world.signInWait = signIn.held
        const checked = world.signInChecks
        releaseTheTurn()
        // The flush has taken the words, and waits at the sign-in check.
        await vi.waitFor(() => {
          expect(world.signInChecks).toBeGreaterThan(checked)
        })
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
          // From here, every read made while asking why held words no longer go fails.
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
        // Once its queue reads again, the words go with the next words held for it.
        world.db
          .prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?')
          .run(whole, service, tornAt)
        const more = await call(host, caller, 'message_agent', {
          agent: service,
          kind: 'follow-up',
          piece: one.label,
          text: 'and the one beside it',
        })
        expect(more.structured).toMatchObject({ outcome: 'ok' })
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

    it('lets nothing held with a caller’s words overtake them while they wait for its queue, after the last wait', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      // A helper's reply and the caller's words are held behind its turn.
      world.anAgent('helper', 'nothing kept')
      const given = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(given.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(given.structured['owner'] ?? given.structured['agent'])
      const replied = await call(host, helper, 'reply_to_parent', {
        piece: String(given.structured['label']),
        outcome: 'done',
        summary: 'Room 4 is free.',
      })
      expect(replied.structured).toMatchObject({ outcome: 'ok' })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      // Its turn ends; the flush takes both, and waits at the sign-in check while its queue tears.
      const signIn = aGate()
      world.signInWait = signIn.held
      const checked = world.signInChecks
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(world.signInChecks).toBeGreaterThan(checked)
      })
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
      // Neither went, nor ended: the reply waits with the words it was held beside.
      expect(rows(service, 'user_turn')).toHaveLength(1)
      expect(
        world
          .ledger(service)
          .some((row) => row.type === 'message_unqueued' && row.reason !== 'sent'),
      ).toBe(false)
    })

    it.each(['answered', 'unread', 'unchanged'] as const)(
      'asks a caller’s words again as they go straight in, after the last wait, once its piece is %s',
      async (meanwhile) => {
        const { host, caller, service, one } = await aServiceOnTheFirstPiece({
          signInsChecked: true,
        })
        // The queue door's own sign-in check goes by; the one before the handover waits.
        const signIn = aGate()
        world.signInWait = signIn.held
        world.signInChecksLetThrough = world.signInChecks + 1
        const sending = call(host, caller, 'message_agent', {
          agent: service,
          kind: 'follow-up',
          piece: one.label,
          text: 'the room on the third floor',
        })
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
        expect(sent.structured['outcome']).toBe(meanwhile === 'unchanged' ? 'ok' : 'refused')
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

  describe('taking back the piece it is working on', () => {
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
      // Its caller has no reach left while that turn drains.
      expect(
        (await call(host, caller, 'interrupt_agent', { agent: service, reason: 'not needed now' }))
          .structured,
      ).toMatchObject({ outcome: 'refused', rail: 'not-below-you' })
      // The turn ends before the stop is answered; its notice goes on its own.
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      expect(rows(service, 'user_turn')).toHaveLength(2)
      // ⛔ The stop is still on its way, and a provider that answers it late ends whatever turn is
      // open then: the next piece waits for it.
      await new Promise((settled) => setTimeout(settled, 100))
      expect(stateOf(service, two.piece)).toBe('waiting')
      const theNext = aGate()
      world.turnsWait = theNext.held
      stop.release()
      await handedOver(service, two.piece)
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
        expect(rows(service, 'turn')).toHaveLength(3)
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
      // Its turn ends and its notice goes; the bound passes and the next piece's turn opens.
      releaseTheTurn()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const theNext = aGate()
      world.turnsWait = theNext.held
      expect(stateOf(service, two.piece)).toBe('waiting')
      await handedOver(service, two.piece)
      await vi.waitFor(() => {
        expect(rows(service, 'user_turn')).toHaveLength(3)
      })
      // …and then the first piece's stop lands.
      stop.release()
      await new Promise((settled) => setTimeout(settled, 50))
      world.turnsWait = null
      theNext.release()
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(3)
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
      await new Promise((settled) => setTimeout(settled, 100))
      expect(stateOf(service, two.piece)).toBe('waiting')
      const theNext = aGate()
      world.turnsWait = theNext.held
      stop.release()
      await handedOver(service, two.piece)
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

    /**
     * The caller's words about its piece, held behind the first piece's turn, go in when it ends,
     * and their turn ends before their hand-over settles. `next` then hands over a turn that is held
     * working, and their hand-over settles only after it began.
     */
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

    /** The service's provider, as the world started it last. */
    const theServicesProvider = (): AServiceWorld['handles'][number]['handle'] => {
      const provider = [...world.handles].reverse().find((kept) => kept.as === 'browser-driver')
      if (provider === undefined) throw new Error('the service has no provider')
      return provider.handle
    }

    /**
     * The caller's words about the first piece pass the queue door's own sign-in check, and wait at
     * the handover's until `released`.
     */
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
      // A person's words go in, and their turn ends.
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      // The caller's words about its piece go in next, and their turn is held working.
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
      // A person's words go in, and their turn ends.
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      // The caller's words about its piece can't be stamped as they are handed over: nothing goes.
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
      // Its provider then works with no turn of this app's open.
      const provider = theServicesProvider()
      provider.simulateThinking({ text: 'checking the calendar', redacted: false })
      expect(provider.status()).toBe('working')
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
    })

    /**
     * A person's turn is held working while two of the caller's words about its piece wait behind
     * it; it ends, and the two go in one turn of their own, held working — or, when `stamped` is
     * false, can't be stamped, so nothing is handed over.
     */
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
        // Its provider then works with no turn of this app's open.
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
      // A person's words go in meanwhile, and their turn is held working.
      const theirs = aGate()
      world.turnsWait = theirs.held
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      // The caller's words reach the handover, its provider refuses them for that turn, and they are held.
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
      // A person's words go in, and their turn ends.
      host.claimSession(service, world.window)
      await host.send(service, 'how is it going?', world.window)
      await vi.waitFor(() => {
        expect(rows(service, 'turn')).toHaveLength(2)
      })
      const waiting = await theCallersWordsWaitAtTheHandover(host, caller, service, one.label)
      // Its provider works with no turn of this app's open, and the caller's words join that turn.
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
      // Its provider works with no turn of this app's open, and a person's words join that turn.
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
      // A person's answer opens its next turn, held working.
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
      // A person has it plan, then gives the go-ahead, which opens its next turn, held working.
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
      // A person's words and the caller's wait behind its turn, and go in one turn of their own.
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

    it('asks no stop once the turn it read has ended, of the turn that runs after it', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        signInsChecked: true,
      })
      // A helper's reply about work under the first piece waits behind its turn, and drives it.
      world.anAgent('helper', 'nothing kept')
      const given = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(given.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(given.structured['owner'] ?? given.structured['agent'])
      const replied = await call(host, helper, 'reply_to_parent', {
        piece: String(given.structured['label']),
        outcome: 'done',
        summary: 'Room 4 is free.',
      })
      expect(replied.structured).toMatchObject({ outcome: 'ok' })
      // The take-back reads that turn, and its notice waits on the sign-in check.
      const signIn = aGate()
      world.signInWait = signIn.held
      const taking = call(host, caller, 'withdraw_task', { piece: one.label })
      await vi.waitFor(() => {
        expect(rows(service, 'work_taken_back')).toHaveLength(1)
      })
      // Meanwhile that turn ends, and the reply goes in a turn of its own.
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
      const taken = await taking
      expect(taken.structured).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
      expect(taken.structured['askedItsTurnToStop']).toBeUndefined()
      expect(world.stopsAsked).toEqual([])
      world.turnsWait = null
      theReply.release()
      await handedOver(service, two.piece)
      expect(world.stopsAsked).toEqual([])
    })

    it.each(['drive another piece', 'are a person’s'])(
      'asks no stop of a turn it read before it began, whose words %s',
      async (words) => {
        const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
          turnHeld: true,
          signInsChecked: true,
        })
        // Those words wait behind its turn.
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
        // Its turn ends; the next turn's words are on their way in, held at the sign-in check.
        const signIn = aGate()
        world.signInWait = signIn.held
        const theNext = aGate()
        releaseTheTurn()
        world.turnsWait = theNext.held
        await vi.waitFor(() => {
          expect(rows(service, 'turn')).toHaveLength(1)
        })
        await new Promise((settled) => setTimeout(settled, 50))
        // The take-back reads them as the turn to come, and is held at the same check.
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

    it('drops a follow-up its caller sent before taking the piece back', async () => {
      const { host, caller, service, one, two, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
        interruptWaitMs: 200,
      })
      const followed = await call(host, caller, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: one.label,
        text: 'the room on the third floor',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
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
      const card = handle.simulateUserInput('which room?', ['north', 'south'])
      const waiting = handle.waitForAPerson()
      await vi.waitFor(() => {
        expect(routed(service).get(card.id)).toMatchObject({ parent: caller })
      })
      const taken = await call(host, caller, 'withdraw_task', { piece: one.label })
      expect(taken.structured).toMatchObject({ outcome: 'ok', askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(
        rows(service, 'request_interrupted').some(
          (row) => row.type === 'request_interrupted' && row.requestId === card.id,
        ),
      ).toBe(true)
      waiting()
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
      expect(routed(service).get(card.id)).toMatchObject({ to: 'a-person' })
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

  describe('a person takes back the piece it is on', () => {
    /** What `conversation` was told under `notice`: the words of each such message, held or sent. */
    const toldUnder = (conversation: string, notice: string): string[] =>
      world
        .ledger(conversation)
        .flatMap((row) =>
          row.type === 'message_queued' && (row as { appNotice?: string }).appNotice === notice
            ? [row.text]
            : [],
        )

    it('stops the turn on it, tells it and its caller, and the next piece goes on', async () => {
      const { host, caller, other, service, one, two, releaseTheTurn } =
        await aServiceOnTheFirstPiece({ turnHeld: true })
      const taken = await host.takeBackForAPerson(one.label, world.window)
      expect(taken).toEqual({
        ok: true,
        piece: one.piece,
        label: one.label,
        askedItsTurnToStop: true,
      })
      expect(stateOf(service, one.piece)).toBe('withdrawn')
      const [row] = rows(service, 'work_taken_back')
      expect(row).toEqual({ type: 'work_taken_back', piece: one.piece, by: null })
      // The Events tab says a person did it.
      if (row === undefined) throw new Error('no take-back row')
      expect(describeEvent(row)).toBe(`${one.piece} · taken back by a person (ours)`)
      // Its turn on it is asked to stop, every command it started with it.
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(world.explicitStops).toEqual(['browser-driver'])
      const line = pieceLine(one.label, 'One')
      await vi.waitFor(() => {
        expect(toldUnder(service, 'a-piece-a-person-took-back')).toEqual([
          `A person took back ${line}. Stop working on it and do not reply_to_parent about it.`,
        ])
      })
      await vi.waitFor(() => {
        expect(
          world
            .ledger(caller)
            .some(
              (row) =>
                (row.type === 'message_queued' || row.type === 'user_turn') &&
                (row as { appNotice?: string }).appNotice ===
                  'a-piece-it-gave-a-person-took-back' &&
                row.text.includes(
                  `A person took back ${line}. It is no longer owed: do not wait for its answer.`,
                ),
            ),
        ).toBe(true)
      })
      expect(
        world
          .ledger(other)
          .some(
            (row) =>
              (row as { appNotice?: string }).appNotice === 'a-piece-it-gave-a-person-took-back',
          ),
      ).toBe(false)
      releaseTheTurn()
      await handedOver(service, two.piece)
    })

    it('stops a turn waiting on a person’s card, which the person gives up', async () => {
      const { host, service, one } = await aServiceOnTheFirstPiece({ ask: true })
      const [card] = rows(service, 'permission_request')
      if (card?.type !== 'permission_request') throw new Error('no card')
      const taken = await host.takeBackForAPerson(one.label, world.window)
      expect(taken).toMatchObject({ ok: true, askedItsTurnToStop: true })
      expect(world.stopsAsked).toEqual(['browser-driver'])
      expect(
        rows(service, 'request_interrupted').some(
          (row) => row.type === 'request_interrupted' && row.requestId === card.id,
        ),
      ).toBe(true)
    })

    it('never offers a service’s stalled piece as stopped work under Waiting on you, nor on its caller’s line', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      // Its caller was told of the stall, so the band of work nobody was told about leaves it out…
      await vi.waitFor(() => {
        expect(host.stalledWorkForAPerson().rows.map((row) => row.piece)).not.toContain(one.piece)
      })
      // …and it is a service's piece, which keeps its own door: it is no stopped work either, with
      // services on or off.
      const notStopped = (on: RuntimeHost): void => {
        expect(on.stoppedWorkForAPerson().rows.map((row) => row.piece)).not.toContain(one.piece)
        const waits = on
          .whatEachConversationIsWaitingOn()
          .conversations.find((row) => row.conversation === caller)
        expect(waits).toBeDefined()
        expect(waits?.stoppedWork).toEqual([])
      }
      notStopped(host)
      await host.closeAll()
      const off = world.aHost({ servicesOn: false })
      await off.resumeSession(caller, world.window)
      notStopped(off)
      expect(await off.takeBackForAPerson(one.label, world.window)).toEqual({
        ok: false,
        rail: 'not-a-piece-a-service-is-on',
      })
    })

    it('takes back no other piece: one queued behind it, a caller’s own work, or any while services are off', async () => {
      const { host, caller, service, one, two } = await aServiceOnTheFirstPiece()
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller holds no work of its own')
      for (const piece of [two.label, root.label, 'W999']) {
        expect(await host.takeBackForAPerson(piece, world.window)).toEqual({
          ok: false,
          rail: 'not-a-piece-a-service-is-on',
        })
      }
      expect(stateOf(service, two.piece)).toBe('waiting')
      await host.closeAll()
      const off = world.aHost({ servicesOn: false })
      expect(await off.takeBackForAPerson(one.label, world.window)).toEqual({
        ok: false,
        rail: 'not-a-piece-a-service-is-on',
      })
      expect(rows(service, 'work_taken_back')).toEqual([])
    })

    it('takes back nothing a conversation gave a worker that is no service, nor at a service whose kind can’t be told', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      world.anAgent('worker', 'normal')
      const given = accepted(await world.gives(host, caller, 'worker', { title: 'Plain' }))
      await handedOver(given.owner, given.piece)
      // A worker that is no service is asked for as stopped work, and it has not stopped.
      expect(await host.takeBackForAPerson(given.label, world.window)).toEqual({
        ok: false,
        rail: 'not-a-stopped-piece',
      })
      expect(rows(given.owner, 'work_taken_back')).toEqual([])
      // The services list can't be read at the next start, so its kind can't be told.
      await host.closeAll()
      writeFileSync(profileExecutionFile(world.folder), '{not json')
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const after = world.aHost()
      expect(await after.takeBackForAPerson(one.label, world.window)).toEqual({
        ok: false,
        rail: 'not-a-piece-a-service-is-on',
      })
      quiet.mockRestore()
      expect(rows(service, 'work_taken_back')).toEqual([])
    })

    it('keeps the words for a caller that can’t be started now, for its next start', async () => {
      const { host, caller, one } = await aServiceOnTheFirstPiece()
      await host.close(caller, THE_APP_ITSELF)
      world.resumesFailFor = 'caller'
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await host.takeBackForAPerson(one.label, world.window)).toMatchObject({ ok: true })
      await vi.waitFor(() => {
        expect(
          world
            .ledger(caller)
            .some(
              (row) =>
                row.type === 'message_queued' &&
                (row as { appNotice?: string }).appNotice ===
                  'a-piece-it-gave-a-person-took-back' &&
                (row as { forItsNextStart?: boolean }).forItsNextStart === true,
            ),
        ).toBe(true)
      })
      quiet.mockRestore()
      world.resumesFailFor = null
    })
  })

  describe('its questions', () => {
    it('go to the caller of the piece it is on as they are raised, and stay that caller’s', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      const handle = world.handles.filter((one) => one.as === 'browser-driver').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      const first = handle.simulateUserInput('which room?', ['north', 'south'])
      await vi.waitFor(() => {
        expect(routed(service).get(first.id)).toMatchObject({ to: 'the-parent', parent: caller })
      })
      // A question about a queued piece is not the service's to ask; one about its own goes to its caller.
      const aboutTheQueued = await call(host, service, 'ask_question', {
        piece: two.label,
        question: 'tea or coffee?',
        who_answers: 'the-parent',
      })
      expect(aboutTheQueued.structured).toMatchObject({ outcome: 'refused' })
      const unnamed = await call(host, service, 'ask_question', {
        question: 'which floor?',
        who_answers: 'the-parent',
      })
      expect(unnamed.structured).toMatchObject({ outcome: 'ok' })
      const asked = String(unnamed.structured['question'])
      expect(routed(service).get(asked)).toMatchObject({ to: 'the-parent', parent: caller })

      // The piece ends and the next is handed over: the questions stay its caller's.
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      expect(routed(service).get(first.id)).toMatchObject({ parent: caller })
      const late = await call(host, other, 'answer_question', {
        question: first.id,
        answers: [{ part: 'q0', answer: ['north'] }],
      })
      expect(late.structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-question-by-that-name',
      })
      // …and one raised now goes to the next piece's caller.
      const next = handle.simulateUserInput('which day?', ['monday', 'tuesday'])
      await vi.waitFor(() => {
        expect(routed(service).get(next.id)).toMatchObject({ to: 'the-parent', parent: other })
      })
    })

    it('go to a person while it is on no piece, and nothing is passed up', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      await call(host, caller, 'withdraw_task', { piece: one.label })
      const handle = world.handles.filter((one) => one.as === 'browser-driver').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      // The second piece is handed over at once: take it back too, so the service is on none.
      await vi.waitFor(() => {
        expect(piecesOf(service).filter((piece) => piece.state !== 'waiting')).toHaveLength(2)
      })
      const two = piecesOf(service)[1]
      if (two === undefined) throw new Error('no second piece')
      const twoGiver = two.giver ?? ''
      await call(host, twoGiver, 'withdraw_task', { piece: two.label })
      const question = handle.simulateUserInput('anyone there?', ['yes'])
      await vi.waitFor(() => {
        expect(routed(service).get(question.id)).toMatchObject({ to: 'a-person' })
      })
      expect(routed(service).get(question.id)?.parent).toBeUndefined()
    })

    /** A helper the service gave work while on its first piece, and a question that helper asked it. */
    const aQuestionAskedOfItUnderTheFirstPiece = async (
      host: RuntimeHost,
      service: string,
    ): Promise<{ helper: string; question: string }> => {
      world.anAgent('helper', 'nothing kept')
      const given = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(given.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(given.structured['owner'] ?? given.structured['agent'])
      await vi.waitFor(() => {
        expect(world.store.piecesOwnedBy(helper)).toHaveLength(1)
      })
      const asked = await call(host, helper, 'ask_question', {
        question: 'which building?',
        who_answers: 'the-parent',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      return { helper, question: String(asked.structured['question']) }
    }

    it('passed up, go to the caller of the piece they were asked under', async () => {
      const { host, caller, service } = await aServiceOnTheFirstPiece()
      const { question } = await aQuestionAskedOfItUnderTheFirstPiece(host, service)
      const passed = await call(host, service, 'pass_question_up', {
        question,
        who_answers: 'the-parent',
      })
      expect(passed.structured).toMatchObject({ outcome: 'ok' })
      expect(routed(service).get(String(passed.structured['question']))).toMatchObject({
        to: 'the-parent',
        parent: caller,
      })
    })

    it('passed up by its caller, end with its piece in the caller’s archived ledger, and do not come back with it', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'which floor?',
        who_answers: 'the-parent',
      })
      const original = String(asked.structured['question'])
      const passed = await call(host, caller, 'pass_question_up', {
        question: original,
        asked_by: service,
        who_answers: 'a-person',
      })
      const copy = String(passed.structured['question'])
      const queued = (): string[] =>
        host.questionsForAPerson().rows.map((row) => row.request.requestId)
      expect(queued()).toContain(copy)
      // A service is no conversation's helper, so its caller is archived alone.
      expect(await host.archiveConversation(caller)).toEqual({
        done: true,
        conversations: [caller],
      })
      const replied = await call(host, service, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'The third floor.',
      })
      expect(replied.structured).toMatchObject({ outcome: 'ok' })
      const stateIn = (askedBy: string, requestId: string): string | undefined =>
        world.store.routedRequestsOf(askedBy).find((one) => one.requestId === requestId)?.state
      expect([stateIn(service, original), stateIn(caller, copy)]).toEqual([
        'work-replied',
        'work-replied',
      ])
      // Written while it was archived: before the start the service's answer brought it back for.
      await vi.waitFor(() => {
        expect(rows(caller, 'launched')).toHaveLength(2)
      })
      const kinds = world.ledger(caller).map((row) => row.type)
      expect(kinds.indexOf('question_ended_with_its_piece')).toBeGreaterThan(-1)
      expect(kinds.lastIndexOf('launched')).toBeGreaterThan(
        kinds.indexOf('question_ended_with_its_piece'),
      )
      expect(queued()).not.toContain(copy)
      expect(
        await host.respondUserInput(
          caller,
          copy,
          { kind: 'answer', answers: { answer: 'the third floor' } },
          world.window,
        ),
      ).toEqual({
        outcome: 'refused',
        reason: 'The work that question was about was handed back, so your answer was not sent.',
        stillOpen: false,
      })
    })

    /**
     * A piece a service is on, whose question went up two conversations to a person: the service
     * asks its caller, a helper of a conversation a person opened; the caller passes it to that
     * conversation, and that one to the person.
     */
    const aQuestionPassedUpTwice = async (opts: {
      readonly endingWaitMs?: number
    }): Promise<{
      host: RuntimeHost
      boss: string
      caller: string
      service: string
      one: Given
      original: string
      copy: string
      outer: string
    }> => {
      world.anAgent('browser-driver')
      world.anAgent('boss', 'nothing kept')
      world.anAgent('caller', 'nothing kept')
      world.store.setDefaultApprovalMode('auto')
      const host = world.aHost(
        opts.endingWaitMs === undefined ? {} : { endingWaitMs: opts.endingWaitMs },
      )
      const boss = await world.aPersonOpens(host, 'boss')
      const helping = accepted(await world.gives(host, boss, 'caller', { title: 'Book a room' }))
      const caller = helping.owner
      await handedOver(caller, helping.piece)
      const one = accepted(await world.gives(host, caller, 'browser-driver', { title: 'One' }))
      const service = one.owner
      await handedOver(service, one.piece)
      await vi.waitFor(() => {
        expect(stateOf(service, one.piece)).toBe('stalled')
      })
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'which floor?',
        who_answers: 'the-parent',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      const original = String(asked.structured['question'])
      const once = await call(host, caller, 'pass_question_up', {
        question: original,
        asked_by: service,
        who_answers: 'the-parent',
      })
      expect(once.structured).toMatchObject({ outcome: 'ok' })
      const copy = String(once.structured['question'])
      const twice = await call(host, boss, 'pass_question_up', {
        question: copy,
        asked_by: caller,
        who_answers: 'a-person',
      })
      expect(twice.structured).toMatchObject({ outcome: 'ok' })
      const outer = String(twice.structured['question'])
      return { host, boss, caller, service, one, original, copy, outer }
    }
    const stateIn = (askedBy: string, requestId: string): string | undefined =>
      world.store.routedRequestsOf(askedBy).find((one) => one.requestId === requestId)?.state

    it('passed up twice, keep a piece a person takes back open while a copy in between is no well-formed question; restored, it ends with all three', async () => {
      const { host, boss, caller, service, one, original, copy, outer } =
        await aQuestionPassedUpTwice({})
      // The caller's copy loses its prompt; its row is still JSON. A note from its giver grows its
      // record, so what was read of it before is read again.
      const row = world.db
        .prepare(
          `SELECT id, payload FROM events WHERE session_id = ? AND type = 'question_asked'
             AND json_extract(payload, '$.requestId') = ?`,
        )
        .get(caller, copy) as { id: string; payload: string }
      const aNote = async (): Promise<void> => {
        const noted = await call(host, boss, 'message_agent', {
          agent: caller,
          kind: 'note',
          text: 'A note.',
        })
        expect(noted.structured).toMatchObject({ outcome: 'ok' })
      }
      world.db
        .prepare(`UPDATE events SET payload = json_remove(payload, '$.prompt') WHERE id = ?`)
        .run(row.id)
      await aNote()
      expect(await host.takeBackForAPerson(one.label, world.window)).toEqual({
        ok: false,
        rail: 'its-questions-could-not-all-be-read',
      })
      expect(stateOf(service, one.piece)).not.toBe('withdrawn')
      expect(rows(service, 'work_taken_back')).toEqual([])
      expect([stateIn(service, original), stateIn(boss, outer)]).toEqual(['open', 'open'])
      world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
      await aNote()
      expect(await host.takeBackForAPerson(one.label, world.window)).toMatchObject({ ok: true })
      expect([stateIn(service, original), stateIn(caller, copy), stateIn(boss, outer)]).toEqual([
        'work-withdrawn',
        'work-withdrawn',
        'work-withdrawn',
      ])
    })

    it('passed up twice, keep a piece a person takes back open while the routing of the copy in between names nobody it went to; restored, it ends with all three', async () => {
      const { host, boss, caller, service, one, original, copy, outer } =
        await aQuestionPassedUpTwice({})
      // The caller's routing of its copy loses its parent; its row is still JSON, and every
      // question row is whole. A note from its giver grows its record, so it is read again.
      const row = world.db
        .prepare(
          `SELECT id, payload FROM events WHERE session_id = ? AND type = 'request_routed'
             AND json_extract(payload, '$.requestId') = ?`,
        )
        .get(caller, copy) as { id: string; payload: string }
      const aNote = async (): Promise<void> => {
        const noted = await call(host, boss, 'message_agent', {
          agent: caller,
          kind: 'note',
          text: 'A note.',
        })
        expect(noted.structured).toMatchObject({ outcome: 'ok' })
      }
      world.db
        .prepare(`UPDATE events SET payload = json_remove(payload, '$.parent') WHERE id = ?`)
        .run(row.id)
      await aNote()
      expect(await host.takeBackForAPerson(one.label, world.window)).toEqual({
        ok: false,
        rail: 'its-questions-could-not-all-be-read',
      })
      expect(stateOf(service, one.piece)).not.toBe('withdrawn')
      expect(rows(service, 'work_taken_back')).toEqual([])
      expect(rows(caller, 'question_ended_with_its_piece')).toEqual([])
      expect(rows(boss, 'question_ended_with_its_piece')).toEqual([])
      expect([stateIn(service, original), stateIn(boss, outer)]).toEqual(['open', 'open'])
      world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
      await aNote()
      expect(await host.takeBackForAPerson(one.label, world.window)).toMatchObject({ ok: true })
      expect([stateIn(service, original), stateIn(caller, copy), stateIn(boss, outer)]).toEqual([
        'work-withdrawn',
        'work-withdrawn',
        'work-withdrawn',
      ])
    })

    it('passed up twice, keep a piece a person takes back open while a conversation that passed it up is starting; started, it ends with all three', async () => {
      const { host, boss, caller, service, one, original, copy, outer } =
        await aQuestionPassedUpTwice({ endingWaitMs: 50 })
      await host.look(boss, world.window, true)
      await host.close(boss, world.window)
      const gate = aGate()
      world.resumesWait = gate.held
      const asked = world.resumesAsked
      const starting = host.send(boss, 'Carry on.', world.window)
      try {
        await vi.waitFor(() => {
          expect(world.resumesAsked).toBeGreaterThan(asked)
        })
        expect(await host.takeBackForAPerson(one.label, world.window)).toEqual({
          ok: false,
          rail: 'a-conversation-with-its-questions-is-starting',
        })
        expect(stateOf(service, one.piece)).not.toBe('withdrawn')
        expect([stateIn(service, original), stateIn(caller, copy), stateIn(boss, outer)]).toEqual([
          'open',
          'open',
          'open',
        ])
      } finally {
        world.resumesWait = null
        gate.release()
      }
      await starting
      expect(await host.takeBackForAPerson(one.label, world.window)).toMatchObject({ ok: true })
      expect([stateIn(service, original), stateIn(caller, copy), stateIn(boss, outer)]).toEqual([
        'work-withdrawn',
        'work-withdrawn',
        'work-withdrawn',
      ])
    })

    it('passed up once it has gone on to another piece, go nowhere', async () => {
      const { host, caller, service, one, two } = await aServiceOnTheFirstPiece()
      const { question } = await aQuestionAskedOfItUnderTheFirstPiece(host, service)
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      const notPassed = await call(host, service, 'pass_question_up', {
        question,
        who_answers: 'the-parent',
      })
      expect(notPassed.structured).toMatchObject({
        outcome: 'refused',
        rail: 'nobody-to-pass-it-up-to',
      })
    })

    it('passed up from further down, or off a helper’s card, go by the piece they were first asked under', async () => {
      const { host, caller, service, one, two } = await aServiceOnTheFirstPiece()
      world.anAgent('helper', 'nothing kept')
      world.anAgent('sub-helper', 'nothing kept')
      const given = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(given.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(given.structured['owner'] ?? given.structured['agent'])
      await vi.waitFor(() => {
        expect(world.store.piecesOwnedBy(helper)).toHaveLength(1)
      })
      const passedOn = await call(host, helper, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sub-helper',
        title: 'Check the floors',
        brief: 'check each floor',
      })
      expect(passedOn.structured).toMatchObject({ outcome: 'ok' })
      const subHelper = String(passedOn.structured['owner'] ?? passedOn.structured['agent'])
      await vi.waitFor(() => {
        expect(world.store.piecesOwnedBy(subHelper)).toHaveLength(1)
      })
      /** A question the sub-helper asks the helper, which the helper passes up to the service. */
      const carriedUp = async (question: string): Promise<string> => {
        const asked = await call(host, subHelper, 'ask_question', {
          question,
          who_answers: 'the-parent',
        })
        expect(asked.structured).toMatchObject({ outcome: 'ok' })
        const hop = await call(host, helper, 'pass_question_up', {
          question: String(asked.structured['question']),
          who_answers: 'the-parent',
        })
        expect(hop.structured).toMatchObject({ outcome: 'ok' })
        return String(hop.structured['question'])
      }
      const now = await carriedUp('which building?')
      const later = await carriedUp('which wing?')
      const handle = world.handles.filter((each) => each.as === 'helper').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      const card = handle.simulateUserInput('which floor?', ['first', 'second'])
      await vi.waitFor(() => {
        expect(routed(helper).get(card.id)).toMatchObject({ to: 'the-parent', parent: service })
      })
      const passed = await call(host, service, 'pass_question_up', {
        question: now,
        who_answers: 'the-parent',
      })
      expect(passed.structured).toMatchObject({ outcome: 'ok' })
      expect(routed(service).get(String(passed.structured['question']))).toMatchObject({
        to: 'the-parent',
        parent: caller,
      })
      // The first piece ends, and the helper's with it; the helper is given work under the next.
      expect(
        (await call(host, service, 'withdraw_task', { piece: String(given.structured['label']) }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      const again = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Count the chairs',
        brief: 'count the chairs',
      })
      expect(again.structured).toMatchObject({ outcome: 'ok' })
      expect(again.structured['owner'] ?? again.structured['agent']).toBe(helper)
      for (const question of [later, card.id]) {
        const notPassed = await call(host, service, 'pass_question_up', {
          question,
          who_answers: 'the-parent',
        })
        expect(notPassed.structured).toMatchObject({
          outcome: 'refused',
          rail: 'nobody-to-pass-it-up-to',
        })
      }
    })

    it.each(['the same', 'an earlier'] as const)(
      'passed up off a helper’s card, go by where its asker’s work stood when it was raised, never by %s time',
      async (time) => {
        const { host, caller, service, one, two } = await aServiceOnTheFirstPiece()
        world.anAgent('helper', 'nothing kept')
        const given = await call(host, service, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'helper',
          title: 'Find rooms',
          brief: 'list the free rooms',
        })
        expect(given.structured).toMatchObject({ outcome: 'ok' })
        const helper = String(given.structured['owner'] ?? given.structured['agent'])
        await vi.waitFor(() => {
          expect(world.store.piecesOwnedBy(helper)).toHaveLength(1)
        })
        const handle = world.handles.filter((each) => each.as === 'helper').at(-1)?.handle
        if (handle === undefined) throw new Error('no handle')
        const raised = async (prompt: string): Promise<{ id: string; at: number }> => {
          const card = handle.simulateUserInput(prompt, ['first', 'second'])
          await vi.waitFor(() => {
            expect(routed(helper).get(card.id)).toMatchObject({ to: 'the-parent' })
          })
          const row = world.store
            .events(helper)
            .find(
              (entry) => entry.event.type === 'request_routed' && entry.event.requestId === card.id,
            )
          if (row === undefined) throw new Error('no routing')
          return { id: card.id, at: row.at }
        }
        // The same origin: passed up while it is still on the first piece, to that piece's caller.
        const now = await raised('which floor?')
        const passed = await call(host, service, 'pass_question_up', {
          question: now.id,
          who_answers: 'the-parent',
        })
        expect(passed.structured).toMatchObject({ outcome: 'ok' })
        expect(routed(service).get(String(passed.structured['question']))).toMatchObject({
          parent: caller,
        })
        // A card raised under the first piece, and the helper given work under the next with a
        // clock that reads no later than the card's.
        const late = await raised('which wing?')
        await call(host, service, 'withdraw_task', { piece: String(given.structured['label']) })
        await call(host, caller, 'withdraw_task', { piece: one.label })
        await handedOver(service, two.piece)
        // The clock reads the card's own time, or a minute before it, and holds still for the give.
        world.clock = time === 'the same' ? late.at : late.at - 60_000
        world.clockStep = 0
        const again = await call(host, service, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'helper',
          title: 'Count the chairs',
          brief: 'count the chairs',
        })
        world.clockStep = 1
        expect(again.structured).toMatchObject({ outcome: 'ok' })
        expect(
          world.store.piecesOwnedBy(helper).find((one) => one.title === 'Count the chairs')
            ?.givenAt,
        ).toBe(time === 'the same' ? late.at : late.at - 60_000)
        const notPassed = await call(host, service, 'pass_question_up', {
          question: late.id,
          who_answers: 'the-parent',
        })
        expect(notPassed.structured).toMatchObject({
          outcome: 'refused',
          rail: 'nobody-to-pass-it-up-to',
        })
      },
    )

    it('passed up off a helper’s card raised while it held work under two pieces, go nowhere, though one of them ends', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      world.anAgent('helper', 'nothing kept')
      // Every turn from here stays working, so the helper's first piece never stalls.
      const working = aGate()
      world.turnsWait = working.held
      const first = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(first.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(first.structured['owner'] ?? first.structured['agent'])
      // The first piece ends with its helper's work still open; the next piece gives it more.
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      const second = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Count the chairs',
        brief: 'count the chairs',
      })
      expect(second.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(world.store.openPiecesOf(helper)).toHaveLength(2)
      })
      const handle = world.handles.filter((each) => each.as === 'helper').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      const card = handle.simulateUserInput('which floor?', ['first', 'second'])
      await vi.waitFor(() => {
        expect(routed(helper).get(card.id)).toMatchObject({ to: 'the-parent' })
      })
      // The helper's work under the first piece ends after the card was raised.
      expect(
        (await call(host, service, 'withdraw_task', { piece: String(first.structured['label']) }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
      const notPassed = await call(host, service, 'pass_question_up', {
        question: card.id,
        who_answers: 'the-parent',
      })
      expect(notPassed.structured).toMatchObject({
        outcome: 'refused',
        rail: 'nobody-to-pass-it-up-to',
      })
      expect([...routed(service).values()].some((row) => row.parent === other)).toBe(false)
      world.turnsWait = null
      working.release()
    })

    it('passed up off a helper’s card raised again under a reused id, go by its newest routing', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      world.anAgent('helper', 'nothing kept')
      const first = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(first.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(first.structured['owner'] ?? first.structured['agent'])
      const handle = world.handles.filter((each) => each.as === 'helper').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      const card = handle.simulateUserInput('which floor?', ['first', 'second'])
      await vi.waitFor(() => {
        expect(routed(helper).get(card.id)).toMatchObject({ to: 'the-parent' })
      })
      // The first piece and the helper's work under it end; the helper is given work under the next.
      await call(host, service, 'withdraw_task', { piece: String(first.structured['label']) })
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      const again = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Count the chairs',
        brief: 'count the chairs',
      })
      expect(again.structured).toMatchObject({ outcome: 'ok' })
      // Its provider raises a card under the same id again, as one that started again may.
      const raised = world.store
        .events(helper)
        .filter(
          (entry) =>
            (entry.event.type === 'user_input_request' && entry.event.id === card.id) ||
            (entry.event.type === 'request_routed' && entry.event.requestId === card.id),
        )
      expect(raised).toHaveLength(2)
      let ordinal = world.store.nextOrdinal(helper) + 1_000
      for (const entry of raised) world.store.append(helper, ordinal++, entry.event, world.clock++)
      const passed = await call(host, service, 'pass_question_up', {
        question: card.id,
        who_answers: 'the-parent',
      })
      expect(passed.structured).toMatchObject({ outcome: 'ok' })
      expect(routed(service).get(String(passed.structured['question']))).toMatchObject({
        parent: other,
      })
    })

    it('passed up off a helper’s card, go by the work it held then, whose held brief a person had cancelled', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      world.anAgent('helper', 'nothing kept')
      // Every turn from here stays working: the helper's first piece keeps it busy.
      const working = aGate()
      world.turnsWait = working.held
      const busy = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Keep busy',
        brief: 'keep busy',
      })
      expect(busy.structured).toMatchObject({ outcome: 'ok' })
      const helper = String(busy.structured['owner'] ?? busy.structured['agent'])
      await vi.waitFor(() => {
        expect(rows(helper, 'user_turn')).toHaveLength(1)
      })
      const held = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Find rooms',
        brief: 'list the free rooms',
      })
      expect(held.structured).toMatchObject({ outcome: 'ok' })
      const brief = world.store
        .piecesOwnedBy(helper)
        .find((piece) => piece.title === 'Find rooms')?.messageId
      if (brief == null) throw new Error('no held brief')
      // A person cancels the held brief, and the service takes the other piece back.
      host.claimSession(helper, world.window)
      await host.cancelQueuedMessage(helper, brief, world.window)
      expect(
        (await call(host, service, 'withdraw_task', { piece: String(busy.structured['label']) }))
          .structured,
      ).toMatchObject({ outcome: 'ok' })
      // The first piece ends; the helper is given work under the next, and raises a card.
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      const next = await call(host, service, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'Count the chairs',
        brief: 'count the chairs',
      })
      expect(next.structured).toMatchObject({ outcome: 'ok' })
      const handle = world.handles.filter((each) => each.as === 'helper').at(-1)?.handle
      if (handle === undefined) throw new Error('no handle')
      const card = handle.simulateUserInput('which floor?', ['first', 'second'])
      await vi.waitFor(() => {
        expect(routed(helper).get(card.id)).toMatchObject({ to: 'the-parent' })
      })
      const passed = await call(host, service, 'pass_question_up', {
        question: card.id,
        who_answers: 'the-parent',
      })
      expect(passed.structured).toMatchObject({ outcome: 'ok' })
      expect(routed(service).get(String(passed.structured['question']))).toMatchObject({
        parent: other,
      })
      world.turnsWait = null
      working.release()
    })

    it('passed up after a restart that took it on to another piece, go nowhere', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      const { question } = await aQuestionAskedOfItUnderTheFirstPiece(host, service)
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      await host.closeAll()
      const after = world.aHost()
      // Its next caller's words start it again, so it can pass the question on.
      const followed = await call(after, other, 'message_agent', {
        agent: service,
        kind: 'follow-up',
        piece: two.label,
        text: 'any news?',
      })
      expect(followed.structured).toMatchObject({ outcome: 'ok' })
      await vi.waitFor(() => {
        expect(
          rows(service, 'user_turn').some(
            (turn) => turn.type === 'user_turn' && turn.text.includes('any news?'),
          ),
        ).toBe(true)
      })
      const notPassed = await call(after, service, 'pass_question_up', {
        question,
        who_answers: 'the-parent',
      })
      expect(notPassed.structured).toMatchObject({
        outcome: 'refused',
        rail: 'nobody-to-pass-it-up-to',
      })
    })
  })
})
