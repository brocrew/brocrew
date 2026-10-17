import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  BACKGROUND_SENTENCE,
  BACKGROUND_WORD,
  backgroundState,
  droppedNote,
  type BackgroundState,
} from '../src/renderer/src/lib/background-work'
import {
  applyEvent,
  createTranscript,
  everyCard as everyCardIn,
  markReadOnly,
  markReopened,
  type DetachedWork,
  type SubAgentCard,
  type SubAgentToolRow,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * # 248 · Work that outlives the turn, as a person reads it
 *
 * ⛔ **`245`'s only Rank-1 gap**: *"the transcript is a trustworthy account of what the agent is
 * still doing"*, and it was not. `247` measured the window against the OS rather than the provider —
 * turn ended at **9 507 ms**, the command stamped its file at **36 137 ms** — and left the facts on
 * the wire. This file is the fold that reads them.
 *
 * ⚠️ **The payloads below are the MEASURED ones**, from `247`'s capture and `248` §5's, not shapes
 * invented to make a test pass. A fold tested against imagined frames is a fold tested against
 * itself.
 */

/** The receipt Claude really sends for a detached `Bash` (247's capture, ordinal 6 102 ms). */
const BASH_RECEIPT = 'Command running in background with ID: b6uoyo82k. Output is being written to…'

/**
 * ⚑ The receipt for a detached SUB-AGENT, which reads nothing like the one above (248 §5's capture).
 * Two wordings for one fact is exactly why the fold reads the flag instead.
 */
const AGENT_RECEIPT = 'Async agent launched successfully. (This tool result is internal metadata…)'

function call(id: string, name = 'Bash'): RuntimeEvent {
  return { type: 'tool_call', id, name, summary: 'node -e "setTimeout(…, 30000)"' }
}

function detachedResult(id: string, backgroundId?: string): RuntimeEvent {
  return {
    type: 'tool_result',
    id,
    summary: BASH_RECEIPT,
    ok: true,
    backgrounded: true,
    ...(backgroundId === undefined ? {} : { backgroundId }),
  }
}

function level(
  running: { id: string; kind?: string; toolCallId?: string; description?: string }[],
) {
  return { type: 'background_work', running, source: 'background_tasks_changed' } as RuntimeEvent
}

function ended(
  over: Partial<{
    id: string
    toolCallId: string
    outcome: 'completed' | 'failed' | 'stopped' | 'unknown'
    summary: string
    outputFile: string
  }> = {},
): RuntimeEvent {
  return {
    type: 'background_work',
    ended: {
      id: over.id ?? 'b6uoyo82k',
      outcome: over.outcome ?? 'completed',
      ...(over.toolCallId === undefined ? {} : { toolCallId: over.toolCallId }),
      ...(over.summary === undefined ? {} : { summary: over.summary }),
      ...(over.outputFile === undefined ? {} : { outputFile: over.outputFile }),
    },
    source: 'task_notification',
  }
}

/** ⚠️ `TranscriptEvent`, not `RuntimeEvent`: `user_turn` is one the RENDERER authors (035). */
function feed(state: TranscriptState, ...events: [TranscriptEvent, number?][]): TranscriptState {
  for (const [event, at] of events) applyEvent(state, event, at)
  return state
}

/** The one tool row on screen. ⚠️ Asserts existence — a query that returns undefined is vacuous. */
function row(state: TranscriptState): ToolItem {
  const found = state.items.find((item): item is ToolItem & { at?: number } => item.kind === 'tool')
  expect(found, 'the tool row this test is about').toBeDefined()
  return found as ToolItem
}

describe('248 §2 · the card stops reading as finished', () => {
  it('🔴 a detached receipt is NOT a completion — the row says so, and `ok` is untouched', () => {
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
    )
    const tool = row(state)
    // ⛔ `ok` stays TRUE and that is 247's ruling, not an oversight: the provider really did succeed
    // at detaching, and calling that a failure trades one lie for another.
    expect(tool.result).toMatchObject({ ok: true })
    expect(tool.background).toEqual({ id: 'b6uoyo82k' })
    expect(BACKGROUND_WORD[backgroundState(tool.background as DetachedWork)]).toBe('still running')
  })

  it('⛔ reads the FLAG, never the wording — the same sentence without it means nothing', () => {
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      // The provider's exact sentence, and no `backgrounded`. 247 §3: *"Read `backgrounded`, never
      // the receipt's wording"* — it has changed shape across pins, and the sub-agent door says
      // something else again.
      [{ type: 'tool_result', id: 'toolu_1', summary: BASH_RECEIPT, ok: true }, 6_102],
    )
    expect(row(state).background).toBeUndefined()
    // …and the paired positive, so this is not passing over a row that never took a result.
    expect(row(state).result).toMatchObject({ ok: true, summary: BASH_RECEIPT })
  })

  it('⛔ a `backgroundId` alone does NOT detach a card — the Codex trap 247 named', () => {
    // Codex attaches a `processId` to EVERY PTY-backed command, foreground included. A card gated on
    // having an id would put "still running" on finished commands, on the one adapter that
    // implements no stop at all.
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [
        { type: 'tool_result', id: 'toolu_1', summary: 'ok', ok: true, backgroundId: 'proc-71' },
        2_000,
      ],
    )
    expect(row(state).background).toBeUndefined()
    expect(row(state).result).toMatchObject({ ok: true })
  })

  it('⛔ the card becomes the COMPLETION RECORD when the work really ends', () => {
    // 245's measured half: *"reconcile final task completion to that card — ABSENT · 1, measured
    // Claude card never changed."*
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
      [
        ended({
          toolCallId: 'toolu_1',
          summary: 'Background command "…" completed (exit code 0)',
          outputFile: '/tmp/tasks/b6uoyo82k.output',
        }),
        36_150,
      ],
    )
    expect(row(state).background).toEqual({
      id: 'b6uoyo82k',
      outcome: 'completed',
      summary: 'Background command "…" completed (exit code 0)',
      outputFile: '/tmp/tasks/b6uoyo82k.output',
      endedAt: 36_150,
    })
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe('finished')
  })

  it('⚠️ an ending cannot be erased by a receipt that arrives after it', () => {
    // Nothing on the wire orders these two — they come out of different system frames — and an
    // assignment rather than a merge would put finished work back to "still running".
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [ended({ toolCallId: 'toolu_1', outcome: 'failed' }), 30_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 30_001],
    )
    expect(row(state).background?.outcome).toBe('failed')
  })

  it('⛔ an ending with no `toolCallId` reaches no card — and could not have', () => {
    // 106's rule, as 246 applied it. A card learns its id from `tool_result.backgroundId`, which the
    // adapter sets from `BackgroundTasks.detachedAs` — and that answers only when the task↔tool
    // binding exists. The ending's `toolCallId` comes from `toolFor`, the SAME binding. So a scan by
    // `background.id` would be searching for a key nothing could have written, and it is not there.
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [{ type: 'tool_result', id: 'toolu_1', summary: BASH_RECEIPT, ok: true }, 6_102],
      [ended({ id: 'b6uoyo82k' }), 36_150],
    )
    expect(row(state).background).toBeUndefined()
    // The paired positive: an ending that DOES name the call lands, so the line above is about the
    // missing id rather than about a fold that ignores endings.
    const bound = feed(
      createTranscript(),
      [call('toolu_2'), 1_000],
      [detachedResult('toolu_2', 'b6uoyo82k'), 6_102],
      [ended({ id: 'b6uoyo82k', toolCallId: 'toolu_2' }), 36_150],
    )
    expect(row(bound).background?.outcome).toBe('completed')
  })

  it('⚑ a SUB-AGENT dispatch is a detached row too, with its own wording', () => {
    // 248 §5, measured: the dispatch receipt is `backgrounded: true` with the agent's own id, and
    // the sentence beside it is nothing like the `Bash` one.
    const state = feed(
      createTranscript(),
      [call('toolu_a', 'Agent'), 1_000],
      [
        {
          type: 'tool_result',
          id: 'toolu_a',
          summary: AGENT_RECEIPT,
          ok: true,
          backgrounded: true,
          backgroundId: 'aae1d6bfc8bbb6ad1',
        },
        4_614,
      ],
    )
    expect(row(state).background).toEqual({ id: 'aae1d6bfc8bbb6ad1' })
  })

  it('⛔ a child row RECLAIMED onto its card keeps what it had learned', () => {
    // 029/131's window: the child's call reaches the fold before the `task_started` that creates the
    // card, so it renders at top level and is reclaimed when the card appears. `reclaimChildRows`
    // REBUILDS the row from a literal — so every field the row acquired in that window has to be
    // listed there or it is dropped in the one path that exists because something arrived late.
    const state = createTranscript()
    feed(
      state,
      [call('toolu_a', 'Agent'), 1_000],
      // The child's own call and its DETACHED receipt, both before the card exists.
      [{ ...call('toolu_child'), parentToolCallId: 'toolu_a' } as RuntimeEvent, 2_000],
      [
        {
          ...detachedResult('toolu_child', 'b-child'),
          parentToolCallId: 'toolu_a',
        } as RuntimeEvent,
        2_100,
      ],
      [
        {
          type: 'sub_agent',
          agentId: 'agent-late',
          phase: 'started',
          parentToolCallId: 'toolu_a',
          title: 'arrived after its own work',
        },
        3_000,
      ],
    )
    const card = everyCardIn(state).find((one) => one.agentId === 'agent-late')
    const child = card?.body.find(
      (one): one is SubAgentToolRow => one.kind === 'tool' && one.callId === 'toolu_child',
    )
    // The paired positive: the row really was reclaimed onto the card.
    expect(child, "the child's row is on the card").toBeDefined()
    expect(child?.background).toEqual({ id: 'b-child' })
  })

  it("⚑ …and so is a sub-agent's OWN command, one level down", () => {
    const state = createTranscript()
    feed(
      state,
      [call('toolu_a', 'Agent'), 1_000],
      [
        {
          type: 'sub_agent',
          agentId: 'agent-1',
          phase: 'started',
          parentToolCallId: 'toolu_a',
          title: 'run the timer',
        },
        1_100,
      ],
      [{ ...call('toolu_child'), parentToolCallId: 'toolu_a' } as RuntimeEvent, 2_000],
      [
        {
          ...detachedResult('toolu_child', 'b-child'),
          parentToolCallId: 'toolu_a',
        } as RuntimeEvent,
        2_100,
      ],
    )
    const card = state.items
      .flatMap((item) => (item.kind === 'tool' ? (item.subAgents ?? []) : []))
      .find((one): one is SubAgentCard => one.agentId === 'agent-1')
    expect(card, "the child's card").toBeDefined()
    const child = card?.body.find(
      (one): one is SubAgentToolRow => one.kind === 'tool' && one.callId === 'toolu_child',
    )
    expect(child?.background).toEqual({ id: 'b-child' })
    // …and its ending finds it through `cardTools`, which is the only index a child's call is in.
    applyEvent(
      state,
      ended({ id: 'b-child', toolCallId: 'toolu_child', outcome: 'stopped' }),
      9_000,
    )
    expect(child?.background?.outcome).toBe('stopped')
  })
})

describe('248 §3 · the registry, and its REPLACE semantics', () => {
  it('⛔ every level payload REPLACES the set — and `[]` is what clears it', () => {
    const state = createTranscript()
    expect(state.background).toEqual({ running: [], dropped: 0 })
    feed(state, [level([{ id: 'a' }, { id: 'b' }])])
    expect(state.background.running.map((one) => one.id)).toEqual(['a', 'b'])
    // Not a merge: `c` alone means `a` and `b` are gone, however they went.
    feed(state, [level([{ id: 'c', kind: 'local_bash', description: 'the timer' }])])
    expect(state.background.running).toEqual([
      { id: 'c', kind: 'local_bash', description: 'the timer' },
    ])
    feed(state, [level([])])
    expect(state.background.running).toEqual([])
  })

  it('⚠️ absent is NOT empty — a frame that states no level changes nothing', () => {
    // 247: *"`running` absent ≠ `running: []`. Absent is 'this frame did not state the level'."*
    // Conflating them is how a registry empties on exactly the traffic that carries an ending.
    const state = feed(createTranscript(), [level([{ id: 'a' }])], [ended({ id: 'zzz' }), 5_000])
    expect(state.background.running.map((one) => one.id)).toEqual(['a'])
  })

  it('⛔ `dropped` travels WITH the level and is replaced with it', () => {
    const state = createTranscript()
    feed(state, [
      { type: 'background_work', running: [{ id: 'a' }], dropped: 3, source: 'x' } as RuntimeEvent,
    ])
    expect(state.background.dropped).toBe(3)
    expect(droppedNote(3)).toBe('and 3 more are running that this list cannot name')
    expect(droppedNote(1)).toBe('and 1 more is running that this list cannot name')
    // The next level says nothing was dropped, so nothing was — it describes THAT payload.
    feed(state, [level([{ id: 'a' }])])
    expect(state.background.dropped).toBe(0)
  })
})

describe('248 · ⛔ the TURN ending changes nothing — that is the whole feature', () => {
  /**
   * 🔴 **This is the sequence `245` measured, and the one no other test here folds.**
   *
   * The first version of 248 hung its sweep on `stopOpenToolCalls`, which `case 'turn'` calls at the
   * end of EVERY turn as well as at the three session boundaries. Every unit test passed, every
   * render test passed, and the app emptied the registry and stamped *"did not finish"* on every
   * card at the exact instant the window opens. ⚠️ The live step would have gone green over it too:
   * its guard looked for the OLD lie (`finished`) and would have scored the NEW one as a pass.
   *
   * ⛔ So the assertion is what a person reads AFTER the turn ends, positively.
   */
  const throughTheTurn = (): TranscriptState =>
    feed(
      createTranscript(),
      [{ type: 'user_turn', text: 'run it in the background' }, 500],
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
      [level([{ id: 'b6uoyo82k', kind: 'local_bash', description: 'the 30-second timer' }])],
      [{ type: 'turn', state: 'completed' }, 9_507],
      [{ type: 'status', state: 'idle' }, 9_508],
    )

  it('🔴 the card still says "still running" once the turn is over', () => {
    const state = throughTheTurn()
    expect(backgroundState(row(state).background as DetachedWork)).toBe('running')
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe(
      'still running',
    )
    // ⛔ Positively, not merely "not finished": the state this defect produced was a THIRD word.
    expect(row(state).background?.unfinished).toBeUndefined()
    expect(row(state).background?.outcome).toBeUndefined()
  })

  it('🔴 …and the registry still names it', () => {
    expect(throughTheTurn().background.running.map((one) => one.id)).toEqual(['b6uoyo82k'])
  })

  it('⚑ …and the ending that arrives 26 seconds later still lands on the card', () => {
    // 247's measured window, end to end: the receipt at 6 102 ms, the turn at 9 507, the ending at
    // 36 150. Nothing between them may take the card away from the work it belongs to.
    const state = throughTheTurn()
    applyEvent(state, level([]), 36_149)
    applyEvent(state, ended({ id: 'b6uoyo82k', toolCallId: 'toolu_1' }), 36_150)
    expect(backgroundState(row(state).background as DetachedWork)).toBe('completed')
    expect(state.background.running).toEqual([])
  })

  it('⚠️ an ordinary tool call still stops claiming when the turn ends — 074 is untouched', () => {
    // The paired positive for the three above: `stopOpenToolCalls` must go on doing its own job at
    // this boundary, or 248 would have bought its fix with 074's.
    const state = feed(
      createTranscript(),
      [{ type: 'user_turn', text: 'do it' }, 500],
      [call('toolu_2'), 1_000],
      [{ type: 'turn', state: 'interrupted' }, 2_000],
    )
    const open = state.items.find(
      (item): item is ToolItem => item.kind === 'tool' && item.callId === 'toolu_2',
    )
    expect(open?.unfinished).toBe(true)
  })
})

/**
 * # 🔴 287 finding 1 · the Codex stream, which nothing in this file folded
 *
 * ⛔ **Every fixture in this file until now is a CLAUDE receipt**, and Claude is the provider that
 * cannot reach this defect: its `tool_result.backgrounded` seeds `row.background` before the turn
 * sweep can run. Codex's detachment stream is `tool_call` → `turn/completed` →
 * `background_work.running` and there is **no `item/completed` and no `tool_result`, ever** — `275`
 * measured it on the live wire and watched for one 30 seconds after the process was killed.
 *
 * ⚠️ **So the sequence below is the deliverable as much as the fix is.** With no receipt, the turn
 * ends first, `stopOpenToolCalls` marks the result-less row `unfinished`, and the level updated the
 * registry alone — so the bar said **still running** with a working Stop while the card beside it
 * said **did not finish**, whose sentence is *"the conversation running it is gone, so nothing will
 * ever report how it ended"*. Both about one live process, on every ordinary Codex command.
 */
describe('287 finding 1 · a Codex command that outlives its turn, with no receipt at all', () => {
  /** The item id both surfaces join on — `tool_call.id` and the list row's `itemId`, measured equal. */
  const EXEC = 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e'

  /** ⚠️ Codex's own source string: this level comes from a LIST, not from Claude's changed-frame. */
  function codexLevel(running: { id: string; toolCallId?: string; description?: string }[]) {
    return {
      type: 'background_work',
      running,
      source: 'thread/backgroundTerminals/list',
    } as RuntimeEvent
  }

  /** ⛔ The measured stream, ordinals and all — and NOTHING is added to it. */
  const codexStream = (): TranscriptState =>
    feed(
      createTranscript(),
      [{ type: 'user_turn', text: 'run sleep 402' }, 500],
      [
        { type: 'tool_call', id: EXEC, name: 'Bash', summary: 'sleep 402.278' } as RuntimeEvent,
        1_000,
      ],
      // `turn/completed` at 4 009 ms, over a process with 400 seconds left to run.
      [{ type: 'turn', state: 'completed' }, 4_009],
      [{ type: 'status', state: 'idle' }, 4_010],
      [codexLevel([{ id: '42852', toolCallId: EXEC, description: 'sleep 402.278' }]), 4_100],
    )

  it('🔴 the card says "still running", not "did not finish" — and the bar agrees with it', () => {
    const state = codexStream()
    const tool = row(state)
    // ⛔ **The paired positive for the state under test**: there really is no receipt, and the turn
    // sweep really did fire — so this is the sequence the defect lived in, not a milder one.
    expect(tool.result, 'Codex sends no tool_result for a detached command, ever').toBeNull()
    expect(tool.unfinished, 'and the foreground sweep really did mark the row').toBe(true)

    expect(tool.background).toEqual({ id: '42852' })
    expect(BACKGROUND_WORD[backgroundState(tool.background as DetachedWork)]).toBe('still running')
    // …the same word the registry above the composer is showing at the same moment.
    expect(state.background.running.map((one) => one.id)).toEqual(['42852'])
    expect(BACKGROUND_WORD.running).toBe('still running')
  })

  it('⛔ it states the identity and NOTHING else — no result, no outcome (074, 247)', () => {
    const tool = row(codexStream())
    expect(
      tool.background?.outcome,
      'a level is a claim about now, never an ending',
    ).toBeUndefined()
    expect(tool.background?.summary).toBeUndefined()
    expect(tool.background?.endedAt).toBeUndefined()
    // ⚠️ `ok` was never wrong and there is no `ok` here to be wrong: the receipt never came.
    expect(tool.result).toBeNull()
  })

  it('⚑ …and the ending, when the poll finally sees the row leave, still lands on that card', () => {
    const state = codexStream()
    applyEvent(state, ended({ id: '42852', toolCallId: EXEC, outcome: 'unknown' }), 402_000)
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe(
      'ended, outcome not reported',
    )
  })

  it('⛔ a real ENDING outranks a later level naming the same call — the provider stated it', () => {
    // `backgroundState`'s own precedence, one layer up: the outcome always wins, and a level that
    // contradicts one it already reported must not un-say it.
    const state = codexStream()
    applyEvent(state, ended({ id: '42852', toolCallId: EXEC, outcome: 'stopped' }), 402_000)
    applyEvent(state, codexLevel([{ id: '42852', toolCallId: EXEC }]), 402_500)
    expect(row(state).background?.outcome).toBe('stopped')
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe('stopped')
  })

  it('⚠️ a level that names NO call of ours invents no detachment on any card', () => {
    // The negative half. `toolCallId` is optional on the wire, and a row carrying one this fold has
    // never seen is ordinary — the bar still shows it, and no card may acquire a background it was
    // never told about.
    const state = feed(
      createTranscript(),
      [
        { type: 'tool_call', id: EXEC, name: 'Bash', summary: 'sleep 402.278' } as RuntimeEvent,
        1_000,
      ],
      [{ type: 'turn', state: 'completed' }, 4_009],
      [codexLevel([{ id: '42852' }, { id: '99', toolCallId: 'exec-somebody-else' }]), 4_100],
    )
    expect(row(state).background).toBeUndefined()
    // Paired positive: the level really did arrive and really is on screen.
    expect(state.background.running.map((one) => one.id)).toEqual(['42852', '99'])
  })

  it('⛔ closing the conversation still takes the claim back — this did not weaken 248’s door', () => {
    const state = codexStream()
    expect(row(state).background?.unfinished).toBeUndefined()
    markReopened(state)
    expect(row(state).background).toMatchObject({ id: '42852', unfinished: true })
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe(
      'did not finish',
    )
    expect(state.background).toEqual({ running: [], dropped: 0 })
  })

  it('⚑ …and a level arriving AFTER that reopen corrects it, because the provider outranks the sweep', () => {
    // ⚠️ Not a hypothetical: a resumed Codex thread asks for the level once, precisely so a replayed
    // ledger stops showing rows for dead processes. If that answer says a row IS running, the card
    // it names must stop saying nothing will ever report an ending.
    const state = codexStream()
    markReopened(state)
    applyEvent(state, codexLevel([{ id: '42852', toolCallId: EXEC }]), 500_000)
    expect(row(state).background).toEqual({ id: '42852' })
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe(
      'still running',
    )
  })
})

describe('248 · work does not outlive the conversation running it', () => {
  it('🔴 a closed session stops the card claiming, and empties the registry', () => {
    // 222's stale indicator arriving through the STORE. `247` made the level self-correcting for a
    // replay (`init` emits `running: []`); a conversation that is closed, read-only or reopened from
    // a ledger never reaches an `init`, and this is that door.
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
      [level([{ id: 'b6uoyo82k' }])],
    )
    expect(row(state).background?.unfinished).toBeUndefined()
    markReadOnly(state, 'this is a recording')
    expect(row(state).background).toMatchObject({ id: 'b6uoyo82k', unfinished: true })
    expect(state.background).toEqual({ running: [], dropped: 0 })
    expect(BACKGROUND_WORD[backgroundState(row(state).background as DetachedWork)]).toBe(
      'did not finish',
    )
  })

  it('⚠️ …and a reopen does the same, without inventing an outcome (074)', () => {
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
    )
    markReopened(state)
    expect(row(state).background?.unfinished).toBe(true)
    // ⛔ NOT an outcome. "we were not told how it went" is a different fact from "it failed", and
    // only the provider gets to state the second one.
    expect(row(state).background?.outcome).toBeUndefined()
  })

  it('⚑ a real ending that lands after the sweep still wins', () => {
    // `ToolEntry`'s own precedence rule, one axis over: the real result wins wherever there is one.
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
    )
    markReadOnly(state, 'recording')
    applyEvent(state, ended({ id: 'b6uoyo82k', toolCallId: 'toolu_1' }), 36_150)
    expect(backgroundState(row(state).background as DetachedWork)).toBe('completed')
  })
})

describe('248 · the vocabulary (222 §4, held to 246 §2)', () => {
  /**
   * ⛔ **Every word has a producer** — `246` §2 found `cut off` shipped with no gesture that could
   * make it, and the rule out of that is *"do not add a word nothing can produce"*. Each row below
   * is a fold that reaches its word, so a seventh word added without one fails here rather than
   * shipping as dead surface.
   *
   * ⚠️ **What this file proves is the FOLD half of each chain, and saying so is the point.** The
   * chain is `provider status → backgroundOutcome → event → fold → word`, and the first two links
   * are `packages/runtime`'s: `247`'s own tests pin them (*"`paused` is not an ending"*, *"a status
   * word we do not recognise is `unknown`, never a failure"*, and `killed`→`stopped`). A test here
   * that claimed the whole chain would be claiming a seam it cannot see.
   */
  const REACHED: Record<BackgroundState, () => BackgroundState> = {
    running: () => {
      const state = feed(
        createTranscript(),
        [call('toolu_1'), 1_000],
        [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
      )
      return backgroundState(row(state).background as DetachedWork)
    },
    unfinished: () => {
      const state = feed(
        createTranscript(),
        [call('toolu_1'), 1_000],
        [detachedResult('toolu_1', 'b'), 6_102],
      )
      markReadOnly(state, 'recording')
      return backgroundState(row(state).background as DetachedWork)
    },
    // The three the provider states, from `task_notification`/`task_updated`.
    completed: () => outcomeReached('completed'),
    failed: () => outcomeReached('failed'),
    // ⚑ Two live producers: `stopBackgroundWork` → `Query.stopTask`, whose doc promises a
    // `task_notification` with status `stopped`; and the model's own `TaskStop`, which `247`
    // measured live in the 34-tool vocabulary.
    stopped: () => outcomeReached('stopped'),
    // ⚠️ Reachable through ONE door and not the other, which is the kind of thing 246 was about:
    // `task_updated` only emits an ending on the SDK's terminal set, but `task_notification` emits
    // one for any status — so a notification carrying `paused`, an unrecognised word, or no status
    // at all is mapped to `unknown` by `backgroundOutcome` and arrives here.
    unknown: () => outcomeReached('unknown'),
  }

  function outcomeReached(
    outcome: 'completed' | 'failed' | 'stopped' | 'unknown',
  ): BackgroundState {
    const state = feed(
      createTranscript(),
      [call('toolu_1'), 1_000],
      [detachedResult('toolu_1', 'b6uoyo82k'), 6_102],
      [ended({ id: 'b6uoyo82k', toolCallId: 'toolu_1', outcome }), 36_150],
    )
    return backgroundState(row(state).background as DetachedWork)
  }

  it('⛔ every word in the table is produced by a real fold — no dead surface (246 §2)', () => {
    const words = Object.keys(BACKGROUND_WORD) as BackgroundState[]
    // Non-vacuity: the table has to have something in it for this loop to mean anything.
    expect(words.length).toBeGreaterThan(4)
    for (const word of words) {
      const reach = REACHED[word]
      expect(reach, `\`${word}\` has no producer in this file — 246 §2's rule`).toBeDefined()
      expect(reach(), `\`${word}\` is reachable`).toBe(word)
    }
  })

  it('⚠️ one vocabulary — every word has a sentence, and none of them over-claims', () => {
    for (const word of Object.keys(BACKGROUND_WORD) as BackgroundState[]) {
      expect(BACKGROUND_SENTENCE[word], `\`${word}\` has a sentence`).toBeTruthy()
    }
    // 222 §3's rule, carried: an absence says what we did not see, never what did not happen.
    expect(BACKGROUND_SENTENCE.unknown).not.toMatch(/never finished|failed|was killed/)
    expect(BACKGROUND_SENTENCE.unfinished).not.toMatch(/failed|never finished/)
    // …and the paired positive, so the two lines above are not matching over empty strings.
    expect(BACKGROUND_SENTENCE.unknown).toContain('did not say how')
    expect(BACKGROUND_SENTENCE.unfinished).toContain('nothing will ever report')
  })

  it('⛔ the outcome outranks the sweep, and the sweep outranks the level', () => {
    expect(backgroundState({})).toBe('running')
    expect(backgroundState({ unfinished: true })).toBe('unfinished')
    expect(backgroundState({ outcome: 'stopped', unfinished: true })).toBe('stopped')
  })
})
