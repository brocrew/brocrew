import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'

import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  applyEvent,
  createTranscript,
  markReopened,
  type AssistantItem,
  type PlanItem,
  type SubAgentCard,
  type SubAgentToolRow,
  type ToolItem,
  type TranscriptState,
} from './lib/core-transcript'
import { feed } from './helpers/transcript-fold-fixtures'

describe('transcript fold — an agent the agent dispatched (029)', () => {
  /**
   * The dispatching row, exactly as `normalizeMessage` emits it. Named `Agent` because that is
   * what this machine's dispatch tool is actually called — but the fold reads no names at all, and
   * that is the point: the binding is `parentToolCallId`, so the tool could be called anything.
   */
  const dispatch = (callId = 'toolu_task'): RuntimeEvent => ({
    type: 'tool_call',
    id: callId,
    name: 'Agent',
    summary: 'Report working directory',
  })

  const started = (agentId: string, parentToolCallId?: string): RuntimeEvent => ({
    type: 'sub_agent',
    agentId,
    phase: 'started',
    ...(parentToolCallId ? { parentToolCallId } : {}),
    kind: 'general-purpose',
    title: 'Report working directory',
  })

  const cardsOn = (state: TranscriptState, callId: string): SubAgentCard[] => {
    const tool = state.items.find(
      (item): item is ToolItem & { at?: number } => item.kind === 'tool' && item.callId === callId,
    )
    return tool?.subAgents ?? []
  }

  it('nests the card INSIDE the row that dispatched it', () => {
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'))
    expect(cardsOn(state, 'toolu_task')).toHaveLength(1)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({
      agentId: 'a1',
      kind: 'general-purpose',
      title: 'Report working directory',
      running: true,
    })
    // …and it is NOT a top-level item competing with the conversation.
    expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
  })

  it('binds by parentToolCallId, NOT by what happened to arrive last', () => {
    // The claim 029 rests on. Two dispatches are open at once and the card names the FIRST, so
    // adjacency and identity disagree — which is the only arrangement that can tell them apart.
    const state = feed(
      createTranscript(),
      dispatch('toolu_first'),
      dispatch('toolu_second'),
      started('a1', 'toolu_first'),
    )
    expect(cardsOn(state, 'toolu_first').map((c) => c.agentId)).toEqual(['a1'])
    expect(cardsOn(state, 'toolu_second')).toHaveLength(0)
  })

  it('a card that arrives BEFORE its row is kept, then adopted when the row lands', () => {
    const state = createTranscript()
    applyEvent(state, started('a1', 'toolu_task'))
    // Never dropped: it renders at top level rather than vanishing because it was early.
    expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
    applyEvent(state, dispatch())
    expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
    expect(cardsOn(state, 'toolu_task').map((c) => c.agentId)).toEqual(['a1'])
    // And it is still the SAME card — a later phase must find it in its new home.
    applyEvent(state, { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false, outcome: 'completed' })
  })

  it("routes the CHILD's tool calls into its card, not into the parent conversation", () => {
    // The misattribution 029 found: Claude forwards a sub-agent's tool blocks into the parent
    // stream by default, and nothing read `parent_tool_use_id` — so the child's Bash rendered as
    // if the parent had run it, with nothing on screen to betray it.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_task',
      },
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: 'toolu_task',
      },
      { type: 'tool_call', id: 'own_1', name: 'Read', summary: 'notes.txt' },
    )
    // Exactly two tool ROWS in the conversation: the dispatch and the parent's own Read.
    const rows = state.items.filter((item): item is ToolItem => item.kind === 'tool')
    expect(rows.map((r) => r.callId)).toEqual(['toolu_task', 'own_1'])
    // The child's call and its result live on the card.
    const card = cardsOn(state, 'toolu_task')[0]
    expect(card?.body).toEqual([
      {
        kind: 'tool',
        callId: 'child_1',
        name: 'Bash',
        summary: 'ls',
        result: { summary: 'notes.txt', ok: true },
      },
    ])
    expect(card?.lastTool).toBe('Bash')
  })

  it('MERGES phases — a later one never blanks what an earlier one reported', () => {
    // `task_updated` carries no `tool_use_id` and no `subagent_type` at all, so treating absence
    // as "cleared" would wipe the card's heading at the exact moment it finished.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'progress',
        parentToolCallId: 'toolu_task',
        lastTool: 'Bash',
        usage: { tokens: 6997, toolCalls: 1, ms: 7798 },
      },
      { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' },
    )
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({
      kind: 'general-purpose',
      title: 'Report working directory',
      lastTool: 'Bash',
      usage: { tokens: 6997, toolCalls: 1, ms: 7798 },
      running: false,
      outcome: 'completed',
    })
  })

  it('both endings are idempotent — whichever arrives, the card stops running exactly once', () => {
    // `task_updated` and `task_notification` BOTH report the ending and both are mapped, so that a
    // run producing only one of them still cannot leave a card spinning.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_task',
        outcome: 'completed',
        summary: '/Users/alex/brobot2-scratch',
        usage: { tokens: 8944, ms: 2041 },
      },
    )
    expect(cardsOn(state, 'toolu_task')).toHaveLength(1)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({
      running: false,
      outcome: 'completed',
      summary: '/Users/alex/brobot2-scratch',
    })
  })

  it('reclaims a child call that landed in the conversation before the card existed', () => {
    // The child's tool blocks and its `task_started` arrive on DIFFERENT messages, so the child can
    // be seen working before it is known to exist. Left alone, that window renders the child's work
    // as the parent's — the exact misattribution 029 exists to end, surviving as a race.
    const state = feed(
      createTranscript(),
      dispatch(),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_task',
      },
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: 'toolu_task',
      },
    )
    // Before the card exists it has nowhere to go, so it is visible rather than lost.
    expect(state.items.filter((i) => i.kind === 'tool').map((i) => (i as ToolItem).callId)).toEqual(
      ['toolu_task', 'child_1'],
    )
    applyEvent(state, started('a1', 'toolu_task'))
    // …and the moment the card appears it takes its call back, result and all.
    expect(state.items.filter((i) => i.kind === 'tool').map((i) => (i as ToolItem).callId)).toEqual(
      ['toolu_task'],
    )
    expect(cardsOn(state, 'toolu_task')[0]?.body).toEqual([
      {
        kind: 'tool',
        callId: 'child_1',
        name: 'Bash',
        summary: 'ls',
        result: { summary: 'notes.txt', ok: true },
      },
    ])
  })

  it('re-homes a card that a LATER phase is the first to give a parent', () => {
    // `task_started` may omit the dispatch id and `task_updated` always does, so placement cannot
    // be decided once: a card created parentless would otherwise sit at top level for the rest of
    // the session with its row visible right above it.
    const state = createTranscript()
    applyEvent(state, dispatch())
    applyEvent(state, { type: 'sub_agent', agentId: 'a1', phase: 'started', kind: 'Explore' })
    expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
    applyEvent(state, {
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'ended',
      parentToolCallId: 'toolu_task',
      outcome: 'completed',
    })
    expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ agentId: 'a1', outcome: 'completed' })
  })

  it('never lets a usage counter go BACKWARDS between reports', () => {
    // The live capture has a `task_notification` carrying `tool_uses: 0` after heartbeats that
    // reported more. Taken verbatim it made the header say "0 tools" while the card's own body
    // listed the calls we had watched it make — two numbers on one card contradicting each other.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'progress',
        usage: { tokens: 6997, toolCalls: 3, ms: 7798 },
      },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        usage: { tokens: 8944, toolCalls: 0, ms: 2041 },
        outcome: 'completed',
      },
    )
    expect(cardsOn(state, 'toolu_task')[0]?.usage).toEqual({
      tokens: 8944, // still climbs where the later report is genuinely larger
      toolCalls: 3, // …but never drops below what we already watched happen
      ms: 7798,
    })
  })

  it('the turn ending stops a running card WITHOUT inventing an outcome', () => {
    // "We were never told how it went" is a different fact from "it succeeded", and only the
    // provider gets to state the second one.
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'turn',
      state: 'completed',
    })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
    expect(cardsOn(state, 'toolu_task')[0]).not.toHaveProperty('outcome')
  })

  it('a session that ends MID-turn stops its cards too (found by 037)', () => {
    // The gap the session panel exposed. Three of the four endings swept running cards — the turn,
    // a reopen, a read-only recording — and the terminal one did not, because a turn normally ends
    // first and has already done it. Closing a session while an agent runs skips that: there is no
    // `turn` event, and every card kept claiming to be running about a process that died with the
    // session. Easy to miss as a spinner in a long thread; impossible to miss in a panel whose job
    // is to list what is running.
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'status',
      state: 'ended',
    })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
    // Still no invented outcome: we were never told how it went.
    expect(cardsOn(state, 'toolu_task')[0]).not.toHaveProperty('outcome')
  })

  it('a fatal error stops them by the same path', () => {
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'error',
      message: 'the provider died',
      fatal: true,
    })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
  })

  it('reopening never leaves a card spinning about a process that died with the session', () => {
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'progress',
      lastTool: 'Bash',
    })
    markReopened(state)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
    expect(cardsOn(state, 'toolu_task')[0]).not.toHaveProperty('outcome')
  })

  /**
   * An agent's agent (035) — 029's known limit, closed.
   *
   * The chain is three links: the conversation dispatches A with `toolu_task`; A makes its own call
   * `toolu_inner`, which lands on A's card rather than in the conversation; that call dispatches B.
   * B's parent is therefore an id that is deliberately NOT in `state.toolItems` — it has no row —
   * so B looked parentless and stranded at top level, beside the conversation, with nothing on
   * screen connecting it to the work that asked for it.
   */
  describe("an agent's own agent (035)", () => {
    const inner = (): RuntimeEvent => ({
      type: 'tool_call',
      id: 'toolu_inner',
      name: 'Agent',
      summary: 'check the lockfile',
      parentToolCallId: 'toolu_task',
    })
    const grandchild = (): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: 'b1',
      phase: 'started',
      parentToolCallId: 'toolu_inner',
      kind: 'Explore',
      title: 'check the lockfile',
    })
    /** The card hanging off one of another card's OWN calls. */
    const nestedOn = (state: TranscriptState, callId: string): SubAgentCard[] =>
      cardsOn(state, 'toolu_task')[0]?.body.find(
        (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === callId,
      )?.subAgents ?? []

    it('nests under the CALL that dispatched it, inside its parent agent', () => {
      const state = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
      )
      expect(nestedOn(state, 'toolu_inner')).toHaveLength(1)
      expect(nestedOn(state, 'toolu_inner')[0]).toMatchObject({ agentId: 'b1', kind: 'Explore' })
      // The thing that was wrong: nothing left over at top level.
      expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
      // …and A still holds exactly one card of its own, in the row that dispatched it.
      expect(cardsOn(state, 'toolu_task')).toHaveLength(1)
    })

    it('…in EITHER order — the binding is the id, not who arrived first', () => {
      // The grandchild announces itself before the call that dispatched it is folded. It renders at
      // top level meanwhile — never dropped — and is adopted the moment its parent call appears.
      const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), grandchild())
      expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
      feed(state, inner())
      expect(nestedOn(state, 'toolu_inner')).toHaveLength(1)
      expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
    })

    it('the grandchild keeps its own work, and its ending still finds it', () => {
      const state = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
        {
          type: 'tool_call',
          id: 'g_1',
          name: 'Read',
          summary: 'pnpm-lock.yaml',
          parentToolCallId: 'toolu_inner',
        },
        {
          type: 'tool_result',
          id: 'g_1',
          summary: 'ok',
          ok: true,
          parentToolCallId: 'toolu_inner',
        },
        {
          type: 'sub_agent',
          agentId: 'b1',
          phase: 'ended',
          outcome: 'completed',
          summary: 'clean',
        },
      )
      const card = nestedOn(state, 'toolu_inner')[0]
      expect(card).toMatchObject({ running: false, outcome: 'completed', summary: 'clean' })
      expect(card?.body).toEqual([
        {
          kind: 'tool',
          callId: 'g_1',
          name: 'Read',
          summary: 'pnpm-lock.yaml',
          result: { summary: 'ok', ok: true },
        },
      ])
      // The grandchild's Read is ITS work, so it must not also be a row in the conversation.
      expect(state.items.some((item) => item.kind === 'tool' && item.callId === 'g_1')).toBe(false)
    })

    it('a card whose parent call never arrives still renders, at top level', () => {
      // The honest fallback, unchanged from 029: better a card with no visible parent than no card.
      const state = feed(createTranscript(), grandchild())
      expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
    })

    it('the turn ending stops it too — nesting must not hide a card from the sweep (035 review)', () => {
      // The bug this test exists for: 029's "nothing is left spinning" sweep walked one level, which
      // was the whole truth until a card could live inside another card's tool entry. A grandchild
      // would have gone on claiming to be running, forever, about a process that ended with the turn
      // — and it is the deepest card, so the least likely to be noticed.
      const running = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
      )
      expect(nestedOn(running, 'toolu_inner')[0]).toMatchObject({ running: true })
      feed(running, { type: 'turn', state: 'completed' })
      expect(nestedOn(running, 'toolu_inner')[0]).toMatchObject({ running: false })
      // …and still no invented outcome, at any depth.
      expect(nestedOn(running, 'toolu_inner')[0]).not.toHaveProperty('outcome')

      // The same holds for a ledger replayed after the app was quit.
      const replayed = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
      )
      markReopened(replayed)
      expect(nestedOn(replayed, 'toolu_inner')[0]).toMatchObject({ running: false })
    })
  })

  /**
   * **The OTHER grandchild — the one whose dispatch happened on another connection** (135).
   *
   * ⚑ **035's chain and this one are the same picture from two providers, and only one of them has
   * a middle link.** Claude forwards a child's tool blocks into the parent stream, so the `Agent`
   * call that spawns a depth-2 agent is on our wire and the block above nests the card under it —
   * measured, twice, in `sess_6b4380fa`. Codex runs each child on its own thread with its own
   * connection, so the equivalent call is announced to the CHILD and never to us: the grandchild
   * arrives as `{agentId, idKind:'thread', origin:'observed'}` and nothing else.
   *
   * ⛔ So the fold must NOT put it under the depth-1 card. There is no id to bind it with, and the
   * only candidate — "the other agent we happen to know about" — is a guess. Top level, saying so.
   */
  describe('a nested agent nobody announced (135)', () => {
    const CHILD = '019ff855-9c0d-7951-bd56-f7e914581198'
    const GRAND = '019ff856-3833-7d11-bd85-c3bd5a0368c0'
    /** The measured provider-event shape used by `CodexSubAgents`. */
    const announcedChild = (): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: CHILD,
      idKind: 'thread',
      phase: 'started',
      parentToolCallId: 'call_LmwDmS9Oiq9Bov0hAVqRAT3Q',
      kind: 'ui_test',
    })
    const observedGrandchild = (): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: GRAND,
      idKind: 'thread',
      phase: 'started',
      origin: 'observed',
    })
    const tops = (state: TranscriptState): SubAgentCard[] =>
      state.items.filter((item) => item.kind === 'subAgent').map((item) => item.card)

    it('gets a card of its own, carrying the fact that nothing announced it', () => {
      const state = feed(createTranscript(), announcedChild(), observedGrandchild())
      expect(tops(state).map((c) => c.agentId)).toEqual([CHILD, GRAND])
      expect(tops(state)[1]).toMatchObject({ origin: 'observed', idKind: 'thread', running: true })
      // ⛔ No parent invented — not the depth-1 child's dispatch, not anything else.
      expect(tops(state)[1]).not.toHaveProperty('parentToolCallId')
      expect(tops(state)[1]).not.toHaveProperty('kind')
    })

    it('⛔ never lands inside the depth-1 card, whose own rows stay its own', () => {
      // Two agents ran; two cards. The depth-1 card must not gain a body row, a nested card, or the
      // `observed` mark — 135 measured that every event on it names its own thread, before and after.
      const state = feed(createTranscript(), announcedChild(), observedGrandchild(), {
        type: 'sub_agent',
        agentId: GRAND,
        phase: 'ended',
      })
      const child = tops(state)[0]
      expect(child).toMatchObject({ agentId: CHILD, kind: 'ui_test', running: true })
      expect(child?.body).toEqual([])
      expect(child).not.toHaveProperty('origin')
      // …and the grandchild's own ending found the grandchild's own card.
      expect(tops(state)[1]).toMatchObject({ agentId: GRAND, running: false })
    })

    it('the raw event stream says nothing announced it, rather than showing a bare id', () => {
      // The Events log is where a reader goes to check what the provider really said. For this card
      // the answer is "nothing" — without the clause, the line is an id and reads as an agent whose
      // name the app merely failed to render.
      expect(describeEvent(observedGrandchild())).toBe(`started · ${GRAND} · nothing announced it`)
      // …and an announced child's line is unchanged, or the clause is decoration rather than a fact.
      expect(describeEvent(announcedChild())).toBe('started · ui_test')
    })

    it('the turn ending stops it like any other card', () => {
      const state = feed(createTranscript(), observedGrandchild(), {
        type: 'turn',
        state: 'completed',
      })
      expect(tops(state)[0]).toMatchObject({ agentId: GRAND, running: false })
      // Still no invented outcome: a thread going quiet says it stopped, never how it went.
      expect(tops(state)[0]).not.toHaveProperty('outcome')
    })
  })
})

describe('transcript fold — the agent`s checklist (028)', () => {
  const plan = (
    steps: Extract<RuntimeEvent, { type: 'plan_update' }>['steps'],
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'plan_update' }>, 'type' | 'steps'>> = {},
  ): RuntimeEvent => ({ type: 'plan_update', steps, ...rest })

  const planItems = (state: TranscriptState): PlanItem[] =>
    state.items.filter((item): item is PlanItem & { at?: number } => item.kind === 'plan')

  it('UPDATES IN PLACE and never accumulates — one block per turn, whatever the revision count', () => {
    // The acceptance criterion of the whole task. Three revisions of the same plan are ONE item
    // showing the latest state, not three items and not a growing list.
    const state = feed(
      createTranscript(),
      plan([
        { text: 'Create notes.txt', status: 'active' },
        { text: 'Count the lines', status: 'pending' },
      ]),
      plan([
        { text: 'Create notes.txt', status: 'done' },
        { text: 'Count the lines', status: 'active' },
      ]),
      plan(
        [
          { text: 'Create notes.txt', status: 'done' },
          { text: 'Count the lines', status: 'done' },
        ],
        { note: 'Created the file and verified its line count.' },
      ),
    )
    expect(planItems(state)).toHaveLength(1)
    expect(planItems(state)[0]).toMatchObject({
      steps: [
        { text: 'Create notes.txt', status: 'done' },
        { text: 'Count the lines', status: 'done' },
      ],
      note: 'Created the file and verified its line count.',
    })
  })

  it('REPLACES rather than merges, so a removed step really disappears', () => {
    // Claude's `deleted` reaches the fold as a SHORTER list, and merging would leave the abandoned
    // task on screen as a line the model is supposedly still working on.
    const state = feed(
      createTranscript(),
      plan([
        { text: 'Keep me', status: 'pending' },
        { text: 'Drop me', status: 'pending' },
      ]),
      plan([{ text: 'Keep me', status: 'done' }]),
    )
    expect(planItems(state)[0]?.steps).toEqual([{ text: 'Keep me', status: 'done' }])
  })

  it('a note that goes away is REMOVED, not left behind as a stale caption', () => {
    const state = feed(
      createTranscript(),
      plan([{ text: 'x', status: 'pending' }], { note: 'first pass' }),
      plan([{ text: 'x', status: 'active' }]),
    )
    expect(planItems(state)[0]).not.toHaveProperty('note')
  })

  it('a NEW turn opens a NEW block instead of rewriting the last one', () => {
    // Claude's task list outlives a turn, so turn 2 can restate a list built in turn 1. Mutating
    // the old block would silently rewrite history above where the reader is sitting.
    const state = feed(
      createTranscript(),
      plan([{ text: 'A', status: 'active' }]),
      { type: 'turn', state: 'completed' },
      plan([
        { text: 'A', status: 'done' },
        { text: 'B', status: 'active' },
      ]),
    )
    expect(planItems(state)).toHaveLength(2)
    expect(planItems(state)[0]?.steps).toEqual([{ text: 'A', status: 'active' }])
    expect(planItems(state)[1]?.steps).toHaveLength(2)
  })

  it('an EMPTY plan with nothing to say opens no block — it must not claim a plan exists', () => {
    const state = feed(createTranscript(), plan([]))
    expect(planItems(state)).toHaveLength(0)
    // But an already-open block is EMPTIED rather than left showing steps that are gone.
    const open = feed(createTranscript(), plan([{ text: 'A', status: 'active' }]), plan([]))
    expect(planItems(open)[0]?.steps).toEqual([])
  })

  it('`supersedes` marks the tool rows the checklist IS, and only those', () => {
    const state = feed(
      createTranscript(),
      { type: 'tool_call', id: 'toolu_a', name: 'TaskCreate', summary: '…' },
      { type: 'tool_call', id: 'toolu_bash', name: 'Bash', summary: 'ls' },
      plan([{ text: 'A', status: 'pending' }], { supersedes: ['toolu_a'] }),
    )
    const tools = state.items.filter((item): item is ToolItem => item.kind === 'tool')
    expect(tools.find((t) => t.callId === 'toolu_a')?.superseded).toBe(true)
    expect(tools.find((t) => t.callId === 'toolu_bash')?.superseded).toBeUndefined()
    // A superseding that names a call we never saw is a no-op, not a crash.
    expect(() =>
      applyEvent(state, plan([{ text: 'A', status: 'pending' }], { supersedes: ['nope'] })),
    ).not.toThrow()
  })

  it('replays to the FINAL recorded state, not a half-built one', () => {
    // Resume feeds the persisted ledger back through this same fold. Every event carries the whole
    // list, so the last one wins and the rehydrated conversation shows the plan as it ended.
    const state = feed(
      createTranscript(),
      plan([
        { text: 'A', status: 'active' },
        { text: 'B', status: 'pending' },
      ]),
      plan([
        { text: 'A', status: 'done' },
        { text: 'B', status: 'active' },
      ]),
      plan([
        { text: 'A', status: 'done' },
        { text: 'B', status: 'done' },
      ]),
    )
    markReopened(state)
    expect(planItems(state)).toHaveLength(1)
    expect(planItems(state)[0]?.steps.every((step) => step.status === 'done')).toBe(true)
    // Reopening forgets WHICH block it was, so the next session cannot overwrite the replayed one.
    applyEvent(state, plan([{ text: 'C', status: 'active' }]))
    expect(planItems(state)).toHaveLength(2)
  })

  it('the first checklist closes the streamed text; later revisions do not chop it', () => {
    // Same rule as a reasoning block: starting a plan is a real boundary, ticking a box is not.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'Here is what I will do. ' },
      plan([{ text: 'A', status: 'pending' }]),
      { type: 'assistant_delta', text: 'Starting now. ' },
      plan([{ text: 'A', status: 'active' }]),
      { type: 'assistant_delta', text: 'Still going.' },
    )
    const assistants = state.items.filter(
      (item): item is AssistantItem => item.kind === 'assistant',
    )
    expect(assistants).toHaveLength(2)
    expect(assistants[1]?.text).toBe('Starting now. Still going.')
  })
})

describe('transcript fold — the live activity pill (027)', () => {
  it('replaces rather than accumulates, and never outlives the turn', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'activity', phase: 'thinking' })
    expect(state.activity).toEqual({ phase: 'thinking' })

    // Replaced wholesale — a pill says ONE thing about now.
    applyEvent(state, { type: 'activity', phase: 'waiting' })
    expect(state.activity).toEqual({ phase: 'waiting' })

    // A running tool IS the activity, derived from the neutral event rather than duplicated by
    // each adapter beside every call.
    applyEvent(state, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' })
    expect(state.activity).toEqual({ phase: 'tool', detail: 'Bash' })

    // …and the turn ending clears it. A stale "running Bash" after the turn is over is exactly
    // the kind of confident wrongness this app does not ship.
    applyEvent(state, { type: 'turn', state: 'completed' })
    expect(state.activity).toBeNull()
    // None of it left a line behind.
    expect(state.items.filter((item) => item.kind === 'thinking')).toHaveLength(0)
  })
})

describe('transcript fold — thinking (027)', () => {
  it('accumulates text into ONE block and closes it on complete', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'Plan' })
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'ning it' })
    const items = state.items.filter((item) => item.kind === 'thinking')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: 'Planning it', streaming: true, redacted: false })

    applyEvent(state, { type: 'thinking', phase: 'complete' })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ streaming: false })
  })

  it('a redacted block carries the count and NO words — the honest empty case', () => {
    // Both providers do this by default: Claude always, Codex until the turn asks for a summary.
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 165 })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({
      text: '',
      redacted: true,
      tokens: 165,
    })
  })

  it('words arriving later cancel the redaction', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true })
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'because 17 has no factors' })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({
      text: 'because 17 has no factors',
      redacted: false,
    })
  })

  it('reasoning splits the reply ONCE, at the boundary — not on every delta', () => {
    // Claude reports thinking as a running token count: dozens of deltas per turn. Closing the
    // streamed text on each of them would chop one reply into a dozen blocks wherever reasoning
    // and text overlapped. Thinking and THEN speaking is a real boundary worth showing; thinking
    // a little more is not.
    const state = createTranscript()
    applyEvent(state, { type: 'assistant_delta', text: 'Before' })
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 10 })
    applyEvent(state, { type: 'assistant_delta', text: 'After' })
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 20 })
    applyEvent(state, { type: 'assistant_delta', text: 'More' })

    expect(state.items.map((item) => item.kind)).toEqual(['assistant', 'thinking', 'assistant'])
    expect(state.items.filter((item) => item.kind === 'assistant').map((i) => i.text)).toEqual([
      'Before',
      'AfterMore',
    ])
    // …and the later count still lands on the one block, rather than opening a second.
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ tokens: 20 })
  })

  it('a turn that ends mid-thought closes the block rather than leaving it spinning', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true })
    applyEvent(state, { type: 'turn', state: 'interrupted' })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ streaming: false })
  })

  it('a part boundary separates the parts and never invents a block (Codex summaryPartAdded)', () => {
    // The boundary event carries nothing at all — that emptiness IS the signal. On an open block
    // with words it does the one thing a boundary can do; with no block open it must do nothing,
    // because the block it would otherwise create claims a thought while being neither redacted
    // nor expandable: a "thought" pill with nothing behind it.
    const bare = { type: 'thinking', phase: 'delta' } as const
    const state = createTranscript()

    applyEvent(state, bare) // straggler: no block open
    expect(state.items).toHaveLength(0)

    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'first part' })
    applyEvent(state, bare)
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'second part' })
    expect(state.items.filter((item) => item.kind === 'thinking')).toHaveLength(1)
    expect(state.items.find((item) => item.kind === 'thinking')?.text).toBe(
      'first part\n\nsecond part',
    )

    // …and never a LEADING break: a boundary before the first word has nothing to separate.
    const opened = createTranscript()
    applyEvent(opened, { type: 'thinking', phase: 'delta', redacted: true })
    applyEvent(opened, bare)
    applyEvent(opened, { type: 'thinking', phase: 'delta', text: 'words at last' })
    expect(opened.items.find((item) => item.kind === 'thinking')).toMatchObject({
      text: 'words at last',
      redacted: false,
    })
  })
})
