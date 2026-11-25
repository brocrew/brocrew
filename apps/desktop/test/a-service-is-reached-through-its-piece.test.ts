import { newConversationGive } from './lib/give-fixture'
import { recordForwardedQuestion } from './lib/forwarded-question-fixture'
import { distil } from '../src/main/runtime/digest'
import { didIt } from '../src/shared/who-did-it'
import {
  noteFromGiver,
  registerUnreadableQuestionCases,
} from './helpers/service-unreadable-question-cases'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { THE_APP_ITSELF, type RuntimeHost } from '../src/main/runtime/runtime-host'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { pieceLine } from '../src/shared/piece-called'
import { type AServiceWorld } from './helpers/a-service-world'
import { aServicePieceSuite, type Given } from './helpers/a-service-piece-suite'

describe('a service is reached through the piece it is on', () => {
  const suite = aServicePieceSuite()
  const {
    accepted,
    call,
    giveRoomsTask,
    piecesOf,
    stateOf,
    handedOver,
    rows,
    deliveredParts,
    routed,
    aGate,
    aServiceOnTheFirstPiece,
  } = suite
  let world: AServiceWorld
  beforeEach(() => {
    world = suite.world()
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

    it.each([
      ['app', 'close'],
      ['unknown', 'close'],
      ['app', 'take back'],
      ['unknown', 'take back'],
    ] as const)('records %s %s without claiming a person acted', async (kind, action) => {
      const { host, service, one } = await aServiceOnTheFirstPiece()
      const by = kind === 'app' ? THE_APP_ITSELF : { ownerId: 'mcp:unnamed' }
      const actor =
        kind === 'app'
          ? { who: 'the-app-itself' as const }
          : { who: 'a-caller-this-app-cannot-name' as const }
      const result =
        action === 'close'
          ? await host.closeForAPerson(one.label, by)
          : await host.takeBackForAPerson(one.label, by)
      expect(result).toMatchObject({ ok: true })
      const [row] = rows(service, action === 'close' ? 'work_closed' : 'work_taken_back')
      expect(row).toMatchObject({ by: null, actor })
      expect(describeEvent(row!)).toContain(`by ${didIt(actor)}`)
      expect(piecesOf(service).find((piece) => piece.piece === one.piece)).toMatchObject({
        endedByActor: actor,
      })
      const digest = distil(world.store.digestWindow(0, Number.MAX_SAFE_INTEGER), (id) => id)
      const kindOfLine = action === 'close' ? 'work-closed' : 'work-taken-back'
      expect(digest.lines.some((line) => line.kind === kindOfLine)).toBe(true)
      expect(digest.lines.some((line) => line.kind === `${kindOfLine}-by-a-person`)).toBe(false)
      await vi.waitFor(() => {
        expect(
          world
            .ledger(service)
            .some(
              (event) =>
                (event.type === 'message_queued' || event.type === 'user_turn') &&
                event.text.includes(
                  `${didIt(actor)} ${action === 'close' ? 'closed' : 'took back'}`,
                ),
            ),
        ).toBe(true)
      })
      expect(await host.closeForAPerson(one.label, by)).toMatchObject({ ok: false })
    })

    it('records the named colleague when its take-back enters through the window command', async () => {
      const { host, caller, service, one, releaseTheTurn } = await aServiceOnTheFirstPiece({
        turnHeld: true,
      })
      const taken = await host.takeBackForAPerson(one.label, { ownerId: `agent:${caller}` })
      expect(taken).toMatchObject({ ok: true, piece: one.piece })
      expect(rows(service, 'work_taken_back')).toEqual([
        { type: 'work_taken_back', piece: one.piece, by: caller },
      ])
      expect(stateOf(service, one.piece)).toBe('withdrawn')
      releaseTheTurn()
    })

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
          `A person took back ${line}. Stop working on it and do not reply_to_parent about it. Reason: no reason given.`,
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
      // A service's piece has its own take-back door, including after restart.
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
      const after = world.aHost()
      await after.resumeSession(caller, world.window)
      notStopped(after)
    })

    it('takes back a queued child while keeping structural roots and unknown work', async () => {
      const { host, caller, service, two } = await aServiceOnTheFirstPiece()
      const root = world.store.rootOf(caller)
      if (root === null) throw new Error('the caller holds no work of its own')
      for (const piece of [root.label, 'W999']) {
        expect(await host.takeBackForAPerson(piece, world.window)).toEqual({
          ok: false,
          rail: 'not-a-piece-a-service-is-on',
        })
      }
      expect(await host.takeBackForAPerson(two.label, world.window)).toEqual({
        ok: true,
        piece: two.piece,
        label: two.label,
        briefNeverDelivered: true,
        askedItsTurnToStop: false,
      })
      expect(stateOf(service, two.piece)).toBe('withdrawn')
      expect(world.stopsAsked).toEqual([])
      expect(rows(service, 'message_queued')).not.toContainEqual(
        expect.objectContaining({ appNotice: 'a-piece-a-person-took-back' }),
      )
    })

    it('takes back open work from a normal worker and after service metadata becomes unreadable', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      world.anAgent('worker', 'normal')
      const given = accepted(await world.gives(host, caller, 'worker', { title: 'Plain' }))
      await handedOver(given.owner, given.piece)
      const control = () =>
        host.whoCalledWhom(caller).workGivenOut.rows.find(({ piece }) => piece === given.piece)
          ?.aPersonMayTakeItBack
      expect(control()).toBe(true)
      expect(await host.takeBackForAPerson(given.label, world.window)).toMatchObject({ ok: true })
      expect(stateOf(given.owner, given.piece)).toBe('withdrawn')
      expect(control()).toBeUndefined()
      // The services list can't be read at the next start, so its kind can't be told.
      await host.closeAll()
      world.loseTheKept()
      const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const after = world.aHost()
      expect(await after.takeBackForAPerson(one.label, world.window)).toMatchObject({ ok: true })
      quiet.mockRestore()
      expect(stateOf(service, one.piece)).toBe('withdrawn')
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
      const firstAsk = await call(host, service, 'ask_question', {
        who_answers: 'the-parent',
        question: 'which room?',
        options: ['north', 'south'],
      })
      expect(firstAsk.structured).toMatchObject({ outcome: 'ok' })
      const first = { id: String(firstAsk.structured['question']) }
      await vi.waitFor(() => {
        expect(routed(service).get(first.id)).toMatchObject({ to: 'the-parent', parent: caller })
      })
      // A queued piece does not identify the caller for a parent-directed Ask.
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
        answers: [{ part: 'answer', answer: ['north'] }],
      })
      expect(late.structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-question-by-that-name',
      })
      // …and one raised now goes to the next piece's caller.
      const nextAsk = await call(host, service, 'ask_question', {
        who_answers: 'the-parent',
        question: 'which day?',
        options: ['monday', 'tuesday'],
      })
      expect(nextAsk.structured).toMatchObject({ outcome: 'ok' })
      const next = { id: String(nextAsk.structured['question']) }
      await vi.waitFor(() => {
        expect(routed(service).get(next.id)).toMatchObject({ to: 'the-parent', parent: other })
      })
    })

    it('records a person Ask and to-do for the explicitly named queued piece', async () => {
      const { host, service, two } = await aServiceOnTheFirstPiece()
      expect(stateOf(service, two.piece)).toBe('waiting')
      const ask = await call(host, service, 'ask_question', {
        piece: two.label,
        question: 'Which outline should the second task use?',
        who_answers: 'a-person',
      })
      const todo = await call(host, service, 'request_action', {
        piece: two.piece,
        action: 'Check the second outline.',
      })
      for (const { structured } of [ask, todo]) {
        expect(structured).toMatchObject({ outcome: 'ok', question: expect.any(String) })
        const id = String(structured.question)
        expect(world.store.questionsRaisedIn(service).get(id)).toMatchObject({ piece: two.piece })
        expect(routed(service).get(id)).toMatchObject({ to: 'a-person' })
        expect(world.store.theDecisionOn(service, id)).toBeNull()
      }
      expect(stateOf(service, two.piece)).toBe('waiting')
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

    it('leave its provider’s own plain question with the person while it is on a piece', async () => {
      const { host, caller, service } = await aServiceOnTheFirstPiece()
      const provider = [...world.handles].reverse().find((kept) => kept.as === 'browser-driver')
      if (provider === undefined) throw new Error('the service has no provider')
      const question = provider.handle.simulateUserInput('which floor?', ['first', 'second'])
      await vi.waitFor(() => {
        expect(routed(service).get(question.id)).toMatchObject({ to: 'a-person' })
      })
      // Not passed to the caller of the piece it is on, and not the caller's to answer.
      expect(routed(service).get(question.id)?.parent).toBeUndefined()
      expect(deliveredParts(caller).some((part) => part.text.includes('which floor?'))).toBe(false)
      const answered = await call(host, caller, 'answer_question', {
        question: question.id,
        answers: [{ part: 'answer', answer: ['first'] }],
      })
      expect(answered.structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-question-by-that-name',
      })
    })
    const aQuestionAskedOfItUnderTheFirstPiece = async (
      host: RuntimeHost,
      service: string,
    ): Promise<{ helper: string; question: string }> => {
      world.anAgent('helper', 'nothing kept')
      const { helper } = await giveRoomsTask(host, service)
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

    it('lets the recorded service caller settle a historically forwarded question', async () => {
      const { host, caller, service } = await aServiceOnTheFirstPiece()
      const { helper, question } = await aQuestionAskedOfItUnderTheFirstPiece(host, service)
      const copy = recordForwardedQuestion(world.store, () => world.clock++, {
        asker: helper,
        original: question,
        forwarder: service,
        to: 'the-parent',
        parent: caller,
      })
      expect(copy).not.toBe(question)
      expect(routed(service).get(copy)).toMatchObject({
        to: 'the-parent',
        parent: caller,
      })
      const answered = await call(host, caller, 'answer_question', {
        question: copy,
        answers: [{ part: 'answer', answer: ['the library'] }],
      })
      expect(answered.structured).toMatchObject({ outcome: 'ok' })
      expect(
        world.store.routedRequestsOf(service).find((entry) => entry.requestId === copy),
      ).toMatchObject({ state: 'answered' })
      expect(
        world.store.routedRequestsOf(helper).find((entry) => entry.requestId === question),
      ).toMatchObject({ state: 'open' })
    })

    it('passed up by its caller, end with its piece in the caller’s archived ledger, and do not come back with it', async () => {
      const { host, caller, service, one } = await aServiceOnTheFirstPiece()
      const asked = await call(host, service, 'ask_question', {
        piece: one.label,
        question: 'which floor?',
        who_answers: 'the-parent',
      })
      const original = String(asked.structured['question'])
      const copy = recordForwardedQuestion(world.store, () => world.clock++, {
        asker: service,
        original,
        forwarder: caller,
        to: 'a-person',
      })
      expect(copy).not.toBe(original)
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
      const copy = recordForwardedQuestion(world.store, () => world.clock++, {
        asker: service,
        original,
        forwarder: caller,
        to: 'the-parent',
        parent: boss,
      })
      const outer = recordForwardedQuestion(world.store, () => world.clock++, {
        asker: caller,
        original: copy,
        forwarder: boss,
        to: 'a-person',
      })
      expect(new Set([original, copy, outer]).size).toBe(3)
      return { host, boss, caller, service, one, original, copy, outer }
    }
    const stateIn = (askedBy: string, requestId: string): string | undefined =>
      world.store.routedRequestsOf(askedBy).find((one) => one.requestId === requestId)?.state

    registerUnreadableQuestionCases({
      world: () => world,
      aQuestionPassedUpTwice,
      call,
      rows,
      stateIn,
      stateOf,
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
      const aNote = () => noteFromGiver(call, host, boss, caller)
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

    async function expectTheQuestionToStayWithTheService(
      host: RuntimeHost,
      {
        other,
        service,
        helper,
        question,
      }: Record<'other' | 'service' | 'helper' | 'question', string>,
    ): Promise<void> {
      const notAnswered = await call(host, other, 'answer_question', {
        question,
        answers: [{ part: 'answer', answer: ['the library'] }],
      })
      expect(notAnswered.structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-question-by-that-name',
      })
      expect(routed(helper).get(question)).toMatchObject({ to: 'the-parent', parent: service })
      expect(
        world.store.routedRequestsOf(helper).find((entry) => entry.requestId === question),
      ).toMatchObject({ state: 'open' })
    }

    it('keeps a helper’s original question with the service as its next piece arrives', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      const original = await aQuestionAskedOfItUnderTheFirstPiece(host, service)
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      await expectTheQuestionToStayWithTheService(host, { other, service, ...original })
    })

    it('settles a stored two-hop question one recipient at a time', async () => {
      const { host, caller, service } = await aServiceOnTheFirstPiece()
      world.anAgent('helper', 'nothing kept')
      world.anAgent('sub-helper', 'nothing kept')
      const { helper } = await giveRoomsTask(host, service)
      await vi.waitFor(() => {
        expect(world.store.piecesOwnedBy(helper)).toHaveLength(1)
      })
      const given = await call(
        host,
        helper,
        'give_work',
        newConversationGive('sub-helper', 'Check the floors', 'check each floor'),
      )
      expect(given.structured).toMatchObject({ outcome: 'ok' })
      const subHelper = String(given.structured['owner'] ?? given.structured['agent'])
      await vi.waitFor(() => {
        expect(world.store.piecesOwnedBy(subHelper)).toHaveLength(1)
      })
      const asked = await call(host, subHelper, 'ask_question', {
        question: 'which building?',
        who_answers: 'the-parent',
      })
      expect(asked.structured).toMatchObject({ outcome: 'ok' })
      const original = String(asked.structured['question'])
      const middle = recordForwardedQuestion(world.store, () => world.clock++, {
        asker: subHelper,
        original,
        forwarder: helper,
        to: 'the-parent',
        parent: service,
      })
      const outer = recordForwardedQuestion(world.store, () => world.clock++, {
        asker: helper,
        original: middle,
        forwarder: service,
        to: 'the-parent',
        parent: caller,
      })
      expect(new Set([original, middle, outer]).size).toBe(3)

      const state = (owner: string, question: string) =>
        world.store.routedRequestsOf(owner).find((row) => row.requestId === question)?.state
      const states = () => [
        state(service, outer),
        state(helper, middle),
        state(subHelper, original),
      ]
      expect(states()).toEqual(['open', 'open', 'open'])
      const answer = async (by: string, question: string) => {
        const result = await call(host, by, 'answer_question', {
          question,
          answers: [{ part: 'answer', answer: ['the library'] }],
        })
        expect(result.structured).toMatchObject({ outcome: 'ok' })
      }
      await answer(caller, outer)
      expect(states()).toEqual(['answered', 'open', 'open'])
      await answer(service, middle)
      expect(states()).toEqual(['answered', 'answered', 'open'])
      await answer(helper, original)
      expect(states()).toEqual(['answered', 'answered', 'answered'])
    })

    it('keeps the original question with the service after a restart on its next piece', async () => {
      const { host, caller, other, service, one, two } = await aServiceOnTheFirstPiece()
      const original = await aQuestionAskedOfItUnderTheFirstPiece(host, service)
      await call(host, caller, 'withdraw_task', { piece: one.label })
      await handedOver(service, two.piece)
      await host.closeAll()
      const after = world.aHost()
      // Its next caller's words start it again.
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
      await expectTheQuestionToStayWithTheService(after, { other, service, ...original })
    })
  })
})
