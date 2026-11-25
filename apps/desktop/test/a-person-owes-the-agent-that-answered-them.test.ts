import { callOn } from './helpers/call-tool'
import { heldTurnHostFixture, type TurnEnds } from './lib/held-turn-provider'
import { givePagesAndWaitForStall } from './lib/give-fixture'
import type { AgentState } from '../src/shared/agent-state-contracts'
import type { PieceRow } from '../src/shared/task-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SessionStore } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { giverStallNotices, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeStatesMessage } from '../src/shared/runtime-ipc'
import { RecordingSink, settleFixtureTurns, fixtureTurnCounts } from './lib/host-fixture'

/** BroBot's child, as every door names her by the piece she owns. */
const ADA = 'Ada (the owner of W1.1 · Build the pages)'
/** A delay no other timer in the host uses, and no test waits out: nothing is stopped for idling. */
const IDLE = 7_654_321

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const settle = () => settleFixtureTurns(2, 30)

describe('an answered turn preserves work without inventing a person request', () => {
  let root: string
  let cleanUp: () => Promise<void>
  let store: SessionStore
  let host: RuntimeHost
  let turnEnds: TurnEnds
  let window: RecordingSink
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]

  beforeEach(() => {
    ;({ root, store, host, turnEnds, window, pushed, cleanUp } = heldTurnHostFixture(
      'brobot2-f097',
      IDLE,
    ))
  })

  afterEach(async () => {
    await cleanUp()
  })

  const { turnsIn, userTurnsIn } = fixtureTurnCounts(() => store)

  /** What was said to a conversation as a notice that its work is not being worked on. */
  const stallNoticesIn = (sessionId: string): string[] => giverStallNotices(store, sessionId)

  /** The one state, derived fresh, as the app itself reads it. */
  const stateOf = (id: string): AgentState | undefined =>
    host.agentCard(id, THE_APP_ITSELF, id)?.state
  /** The last state the host pushed for a conversation. */
  const lastSaid = (id: string): AgentState | undefined =>
    pushed
      .flatMap((message) => message.moved)
      .filter((one) => one.conversation === id)
      .map((one) => one.state)
      .at(-1)
  /** What `get_agent_status` says of a conversation, as another agent reads it. */
  const wordsOf = async (asking: string, about: string): Promise<string> => {
    const said = await callOn(agentToolsFor(host, asking), 'get_agent_status', { agent: about })
    expect(said.outcome, JSON.stringify(said)).toBe('ok')
    return (said.agent as { state: string }).state
  }
  /** What `list_agents` says of a conversation, as another agent reads it. */
  const listedBy = async (asking: string, about: string): Promise<string | undefined> => {
    const listed = await callOn(agentToolsFor(host, asking), 'list_agents', {})
    const rows = listed.agents as { agent: string; state: string }[]
    return rows.find((one) => one.agent === about)?.state
  }
  /** Who owes the conversation the next move, in the reading the window's plates draw. */
  const needsYouOnItsPlate = (id: string): boolean | undefined =>
    host.whatEachConversationIsWaitingOn().conversations.find((one) => one.conversation === id)
      ?.needsYou
  const pieceOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)

  /** ⚑ BroBot gives W1.1 to a new worker, minted Ada; the brief's turn ends with it open. */
  const aGiverAndItsHelper = () =>
    givePagesAndWaitForStall({ host, root, window }, settle, stallNoticesIn, turnsIn)

  /** ⚑ A person writes to Ada through the window, and her turn runs to its end. */
  const aPersonWritesTo = async (ada: string, text: string): Promise<void> => {
    const turns = turnsIn(ada)
    await host.send(ada, text, window)
    await waitFor(() => turnsIn(ada) > turns, 'the turn the person opened to end')
    await settle()
  }

  describe('actual person requests determine attention', () => {
    it('an answer without an ask keeps the task state but owes no reply', async () => {
      const { brobot, ada, piece } = await aGiverAndItsHelper()
      host.claimSession(ada, window)
      await aPersonWritesTo(ada, 'Thanks for completing the requested result.')
      expect(pieceOf(ada, piece)).toMatchObject({
        state: 'waiting-on-the-person-who-wrote',
        answeredAPersonAt: expect.any(Number),
      })
      expect(host.questionsForAPerson().rows).toEqual([])
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
      expect(stateOf(ada)?.is).not.toBe('needs-you')
      expect(needsYouOnItsPlate(ada)).toBe(false)
      expect(stallNoticesIn(brobot)).toHaveLength(1)
    })

    it.each([
      ['question', 'answered'],
      ['question', 'withdrawn'],
      ['action', 'answered'],
      ['action', 'withdrawn'],
    ] as const)('counts a real %s once until %s, then no reply is owed', async (kind, ending) => {
      const { ada } = await aGiverAndItsHelper()
      host.claimSession(ada, window)
      await aPersonWritesTo(ada, 'Thanks for completing the requested result.')
      const tools = agentToolsFor(host, ada)
      const asked = await callOn(tools, kind === 'question' ? 'ask_question' : 'request_action', {
        piece: 'W1.1',
        ...(kind === 'question'
          ? { who_answers: 'a-person', question: 'Which result should I keep?' }
          : { action: 'Choose the result to keep.' }),
      })
      expect(asked).toMatchObject({ outcome: 'ok', question: expect.any(String) })
      const id = asked.question as string
      expect(host.questionsForAPerson().rows.map((row) => row.request.requestId)).toEqual([id])
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 1 })
      expect(stateOf(ada)?.is).toBe('needs-you')
      if (ending === 'withdrawn') {
        expect(await callOn(tools, 'withdraw_question', { question: id })).toMatchObject({
          outcome: 'ok',
        })
      } else if (kind === 'action') {
        expect(await host.answerAction(ada, id, true, null, window)).toMatchObject({
          outcome: 'taken',
        })
      } else {
        expect(
          await host.respondUserInput(
            ada,
            id,
            { kind: 'answer', answers: { answer: ['Keep the result.'] } },
            window,
          ),
        ).toMatchObject({ outcome: 'taken' })
      }
      await settle()
      expect(host.questionsForAPerson().rows).toEqual([])
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
      expect(stateOf(ada)?.is).not.toBe('needs-you')
    })
  })

  const expectNoReplyAttention = async (brobot: string, ada: string): Promise<void> => {
    expect(stateOf(ada)).toEqual({ is: 'idle' })
    expect(lastSaid(ada)).toEqual({ is: 'idle' })
    expect(await wordsOf(brobot, ada)).toBe('idle')
    expect(await listedBy(brobot, ada)).toBe('idle')
    expect(needsYouOnItsPlate(ada)).toBe(false)
  }

  it('a person-started turn preserves the task state without reply attention or a new giver notice', async () => {
    const { brobot, ada, piece } = await aGiverAndItsHelper()

    // ⛔ THE CONTROL — the brief's turn was the giver's: the piece stalled and the giver was told.
    expect(pieceOf(ada, piece)).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(stallNoticesIn(brobot)).toHaveLength(1)
    expect(stateOf(ada)?.is).not.toBe('needs-you')
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })

    // The person writes, and Ada's turn ends with the piece still open.
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'is it done?')

    // The task keeps its existing state and timestamp.
    const waiting = pieceOf(ada, piece)
    expect(waiting).toMatchObject({
      state: 'waiting-on-the-person-who-wrote',
      stalledBecause: null,
      stalledAt: null,
      stalledBy: null,
      giver: brobot,
    })
    expect(typeof waiting?.answeredAPersonAt).toBe('number')

    // No ask was recorded: every conversation surface stays free of reply attention.
    await expectNoReplyAttention(brobot, ada)

    // ⛔ The giver keeps reading waiting on Ada, and is told nothing more.
    expect(stateOf(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(stallNoticesIn(brobot)).toHaveLength(1)

    // The list and count agree through the host and the window command.
    const listed = host.waitingOnWhoWroteForAPerson()
    expect(listed).toMatchObject({ walk: 'no-ledger', ledgers: 0, rowsUnread: 0 })
    expect(listed.rows).toEqual([])
    const throughTheDoor = await executeRuntimeCommand(host, window, {
      kind: 'waitingOnWhoWroteForAPerson',
    })
    expect(throughTheDoor).toEqual(listed)
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
  })

  it('keeps the holder waiting on the person through two notes and the giver waiting on the holder', async () => {
    const { brobot, brobotTools, ada, piece } = await aGiverAndItsHelper()
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'which answer should it use?')
    const first = pieceOf(ada, piece)?.answeredAPersonAt

    for (const text of [
      'Use the standing workflow rules.',
      'Keep waiting for the person’s answer.',
    ]) {
      const turns = turnsIn(ada)
      const sent = await callOn(brobotTools, 'message_agent', {
        agent: 'W1.1',
        text,
      })
      expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok', kind: 'note' })
      await waitFor(() => turnsIn(ada) > turns, 'the note-opened turn to end')
      await settle()
      expect(pieceOf(ada, piece)).toMatchObject({
        state: 'waiting-on-the-person-who-wrote',
        answeredAPersonAt: first,
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
      })
      await expectNoReplyAttention(brobot, ada)
      expect(stateOf(brobot)).toEqual({
        is: 'waiting-on-a-worker',
        on: [ADA],
        since: expect.any(Number),
      })
      expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
      expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
      expect(stallNoticesIn(brobot)).toHaveLength(1)
    }
  })

  it('the person’s next message drives the task and its end restores task state without reply attention', async () => {
    const { ada, piece } = await aGiverAndItsHelper()
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'is it done?')
    const first = pieceOf(ada, piece)?.answeredAPersonAt
    expect(stateOf(ada)).toEqual({ is: 'idle' })

    // The next message opens a turn whose end the provider holds.
    turnEnds.held = new Promise((resolve) => {
      turnEnds.release = resolve
    })
    const said = userTurnsIn(ada)
    const sending = host.send(ada, 'and the rest?', window)
    await waitFor(
      () => userTurnsIn(ada) > said && stateOf(ada)?.is === 'active',
      'the person’s words to open the turn',
    )
    await waitFor(() => lastSaid(ada)?.is === 'active', 'the window to be told it is active')

    // 🔴 Mid-turn: the piece is driven, so nothing waits on the person — not the state, not the
    // list, not the count.
    expect(pieceOf(ada, piece)).toMatchObject({ state: 'working', stalledBecause: null })
    expect(stateOf(ada)).toEqual({ is: 'active' })
    expect(needsYouOnItsPlate(ada)).toBe(false)
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })

    // The turn ends: the person's words opened it, so the piece waits on them again — from now.
    const turns = turnsIn(ada)
    turnEnds.held = null
    turnEnds.release()
    await sending
    await waitFor(() => turnsIn(ada) > turns, 'the held turn to end')
    await settle()
    const again = pieceOf(ada, piece)
    expect(again?.state).toBe('waiting-on-the-person-who-wrote')
    expect(again?.answeredAPersonAt).toBeGreaterThan(first ?? Number.POSITIVE_INFINITY)
    expect(stateOf(ada)).toEqual({ is: 'idle' })
    expect(lastSaid(ada)).toEqual({ is: 'idle' })
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
  })

  it('⚑ a new give to the agent while it waits names no stall — where a stall is named — and its own brief’s end still stalls', async () => {
    const { brobot, brobotTools, ada, piece } = await aGiverAndItsHelper()
    const giveMore = (title: string): Promise<Record<string, unknown>> =>
      callOn(brobotTools, 'give_work', {
        to: ada,
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title,
        brief: title.toLowerCase(),
      })

    // The person writes, and Ada waits on them: a give is taken, and its answer names no stall.
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'is it done?')
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    const turns = turnsIn(ada)
    const taken = await giveMore('Write the tests')
    expect(taken, JSON.stringify(taken)).toMatchObject({ outcome: 'ok', label: 'W1.2', agent: ada })
    expect(taken).not.toHaveProperty('stalled')

    // The new brief is the giver's words, and names only its own piece: its end stalls that piece,
    // and the giver is told of it — while the piece the person is owed still waits on them.
    await waitFor(() => turnsIn(ada) > turns, 'the new brief’s turn to end')
    await waitFor(() => stallNoticesIn(brobot).length === 2, 'the giver to be told of W1.2')
    await settle()
    expect(pieceOf(ada, taken.piece as string)).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(stateOf(ada)).toEqual({ is: 'idle' })

    // ⛔ THE CONTROL — the next give names the piece that stalled, and not the one that
    // waits on the person.
    const named = await giveMore('Write the docs')
    expect(named, JSON.stringify(named)).toMatchObject({
      outcome: 'ok',
      label: 'W1.3',
      stalled: ['W1.2'],
    })
  })

  it('⛔ a more specific wait is said instead: an agent that asked its giver about the piece waits on that answer, and is neither needs you nor listed', async () => {
    const { brobot, ada, piece } = await aGiverAndItsHelper()
    host.claimSession(ada, window)
    await aPersonWritesTo(ada, 'which database should it use?')
    // The premise: the fold left the piece waiting on the person, and Ada owes no reply attention.
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    expect(stateOf(ada)).toEqual({ is: 'idle' })

    // Ada asks her giver about the piece — the answer it waits on is the giver's, not the person's.
    const asked = await callOn(agentToolsFor(host, ada), 'ask_question', {
      question: 'Which database should the pages use?',
      who_answers: 'the-parent',
      piece: 'W1.1',
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ outcome: 'ok' })
    const noticeAt = () =>
      store
        .events(ada)
        .find(
          ({ event }) =>
            event.type === 'user_turn' &&
            (event.parts ?? [event]).some(
              (part) =>
                part.appNotice === 'a-question-stayed-unanswered' &&
                part.text.includes(String(asked.question)),
            ),
        )?.ordinal
    const nextBoundary = () => {
      const ordinal = noticeAt()
      return ordinal === undefined
        ? undefined
        : store
            .events(ada)
            .find(
              (entry) =>
                entry.ordinal > ordinal &&
                (entry.event.type === 'turn' || entry.event.type === 'user_turn'),
            )?.event
    }
    await waitFor(() => nextBoundary() !== undefined, 'the notice turn to reach its next boundary')
    expect(nextBoundary()).toMatchObject({ type: 'turn', state: 'completed' })
    await settle()

    // The informational notice preserves the task wait while the open question takes precedence.
    expect(pieceOf(ada, piece)?.state).toBe('waiting-on-the-person-who-wrote')
    expect(stateOf(ada)?.is).toBe('waiting-on-an-answer')
    expect(lastSaid(ada)?.is).toBe('waiting-on-an-answer')
    expect(needsYouOnItsPlate(ada)).toBe(false)
    expect(await wordsOf(brobot, ada)).not.toBe('needs you')
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
    expect(host.readWorkspace().needsYou).toEqual({ counted: 'in-full', count: 0 })
  })
})
