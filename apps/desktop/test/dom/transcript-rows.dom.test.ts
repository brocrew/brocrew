import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import { visibleItems } from '../../src/renderer/src/lib/transcript-mode'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 114 · **What a `.entry[data-item]` IS** — and what `108`'s central negative has been asserting.
 *
 * ⛔ **The question this file was written to settle.** `113` ran step `57` against three real
 * workflow turns and measured **57, 73 and 106** `.entry[data-item]` wrappers against `108`'s
 * ceiling of **6**. Two readings were on the table and they are not equally cheap: either the app
 * draws a hundred rows for one workflow turn — *`078`'s rule broken, a real defect* — or the
 * selector is not the row count that file has always taken it for, in which case a green assertion
 * has been standing in for a design rule since `108` shipped.
 *
 * ⚑ **It is the second, and the mechanism is one line of `TranscriptView.vue`:**
 * `v-for="(item, index) in shown"`, where `shown = visibleItems(mode, items)`. A wrapper is **one
 * transcript ITEM in the current mode** — every item, of every kind, in the whole loaded window. It
 * was never a count of the workflow's rows, and it never had anything to do with the frames.
 *
 * ⚠️ **And the mode is not incidental — the smoke's own preamble picks it.** `1b` turns the
 * lifecycle toggle ON and `113` made `1b` mandatory in every invocation, so step `57` measures that
 * mode. So `108`'s `> 6` was asserting *"this entire conversation contains at most six items of any
 * kind"* — a claim about how long a turn is, checked in a mode that counts more than the
 * conversation.
 *
 * ⛔ **When this file was written that mode's contract was *"everything, exactly as the provider
 * really said it"*, and against the ledger below it drew 90 rows of which 82 were recognized
 * chatter. 211 §4 retired that contract** — the toggle has promised *"session start, turn
 * boundaries, idle gaps"* since 079, and delivering 208 `item/plan/delta` markers instead is what
 * 210 reported. The same ledger now draws **10**: the six-row conversation, its two lifecycle
 * notices, and the two `unknown{lifecycle}` payloads. The chatter is in the Events tab, which is
 * where `EventStream.vue` says it lives — behind its `what this is` disclosure since 526.
 *
 * ⛔ **The number was never wrong; it was pointed at the wrong noun.** `078`'s rule is *N frames add
 * NOTHING*, and the tests below assert that directly — by feeding twice the frames and measuring no
 * change at all. Nothing here is tuned: the ceiling stays at 6 and moves to the count it describes.
 */

afterEach(unmountAll)

const PHASES = [
  { index: 1, title: 'Draft' },
  { index: 2, title: 'Judge' },
]

/**
 * One `workflow_run` heartbeat. `usage` differs per frame so no two are the same object — a fold
 * that deduplicated identical events would otherwise make the "twice the frames" test vacuous.
 */
function frame(beat: number): TranscriptEvent {
  return {
    type: 'workflow_run',
    taskId: 'wq1demo',
    toolUseId: 'toolu_wf',
    name: 'demo-panel',
    description: 'Three drafters, then a judge',
    phases: PHASES,
    agents: [
      { agentId: 'a1', label: 'drafter:one', phaseIndex: 1, state: 'done' },
      { agentId: 'a2', label: 'judge', phaseIndex: 2, state: 'running' },
    ],
    usage: { tokens: 100 * beat, toolCalls: beat, ms: 10 * beat },
    source: 'task_progress',
  } as unknown as TranscriptEvent
}

/**
 * ⚠️ **The shape `113` measured on the wire, not a shape invented to make a point.** Its three live
 * workflow turns carried **41 `thinking`, 43 `unknown{activity}`, 39 `unknown{reasoning}`** and
 * **7–12 `workflow_run`** frames, around the ordinary prompt / call / reply. Those counts are
 * reproduced literally so the number this file computes can be compared with the numbers that file
 * reported.
 */
function ledger(frames: number): TranscriptEvent[] {
  const events: TranscriptEvent[] = [
    // ⚠️ **The lifecycle notices are part of the shape and leaving them out would have flattered the
    // reconstruction below.** Every real turn opens with a `session` frame and closes with a `turn`
    // one, and both become `info` notices — which debug draws and the conversation mode drops.
    { type: 'session', state: 'started', ref: { sessionId: 'th_1' } } as unknown as TranscriptEvent,
    {
      type: 'user_turn',
      text: 'Run the demo panel and tell me the judge’s pick.',
    } as TranscriptEvent,
    {
      type: 'tool_call',
      id: 'toolu_wf',
      name: 'Workflow',
      summary: '{"script":"…"}',
    } as TranscriptEvent,
    // ⚠️ **A SECOND tool row, and it is load-bearing.** A turn that runs a workflow runs other
    // tools too, and without one here `onTree === 1` would be unfalsifiable — a fold that put the
    // tree on every tool row would still find only one to put it on.
    { type: 'tool_call', id: 'toolu_ls', name: 'Bash', summary: 'ls' } as TranscriptEvent,
    {
      type: 'tool_result',
      id: 'toolu_ls',
      ok: true,
      summary: 'out.txt',
    } as unknown as TranscriptEvent,
  ]
  for (let beat = 1; beat <= frames; beat += 1) events.push(frame(beat))
  const chatter = (category: string, label: string, index: number): TranscriptEvent =>
    ({
      type: 'unknown',
      provider: 'claude',
      category,
      label,
      raw: { index },
    }) as unknown as TranscriptEvent
  for (let i = 0; i < 43; i += 1) events.push(chatter('activity', 'task_progress', i))
  for (let i = 0; i < 39; i += 1) events.push(chatter('reasoning', 'thinking_delta', i))
  // ⛔ **Two LIFECYCLE payloads, added in 211 §4 for the reason the unrecognized one below was
  // added**: it is the one recognized category the lifecycle mode KEEPS, so without a row of it here
  // the "debug is the conversation plus the boundaries" arithmetic would have a term pinned at zero
  // — any sign, and the test still green. Two rather than one so a fold that kept exactly one could
  // not pass by coincidence.
  for (let i = 0; i < 2; i += 1) events.push(chatter('lifecycle', 'message_start', i))
  // ⚠️ **One UNRECOGNIZED payload, and it is here because leaving it out made a term untestable.**
  // Review caught the first draft asserting an arithmetic whose `unrecognized` count was pinned at
  // zero — so the term could have had any sign and the test would still have passed. It is also the
  // one `unknown` category the conversation mode KEEPS (`transcript-mode.ts`), which is the fact the
  // first draft of the live reconstruction got wrong.
  events.push(chatter('unrecognized', 'never_seen_before', 0))
  // Deltas of ONE reasoning block, which is what the fold makes of them — see the item tally below.
  for (let i = 0; i < 41; i += 1) {
    events.push({ type: 'thinking', text: `beat ${i} `, tokens: i } as unknown as TranscriptEvent)
  }
  events.push({
    type: 'assistant_message',
    text: 'The judge picked the second draft.',
  } as TranscriptEvent)
  events.push({ type: 'turn', state: 'completed' } as unknown as TranscriptEvent)
  return events
}

function feed(events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

interface Rows {
  /** Every wrapper the view drew — the selector step 57 has always counted. */
  wrappers: HTMLElement[]
  /** Of those, the ones with a real box in a real engine. */
  visible: HTMLElement[]
  /** Recognized provider chatter: the quiet one-liner `UnknownEntry` draws for a mapped category. */
  chatter: number
  /** The loud card for a payload the runtime could NOT classify. */
  unrecognized: number
  /** Lifecycle chrome — "session started", "turn completed". Dropped by the conversation mode. */
  infoNotices: number
  /** Workflow trees anywhere in the transcript. `078`'s rule, in one number. */
  trees: number
  /** Wrappers that CARRY a tree — the rule's other half: one tree, on one row. */
  onTree: number
}

function draw(state: TranscriptState, mode: 'debug' | 'normal'): Rows {
  const view = mount(TranscriptView, { items: state.items, mode }, { width: 900, height: 4000 })
  const wrappers = [...view.host.querySelectorAll<HTMLElement>('.entry[data-item]')]
  const has = (el: HTMLElement, cy: string): boolean => el.querySelector(`[data-cy=${cy}]`) !== null
  return {
    wrappers,
    // ⚠️ **A real box, measured — this is the one question SSR could not answer.** `113` guessed
    // that some of the hundred wrappers rendered nothing and filtered on "no element children";
    // the filter kept 105 of 106 and it was a guess. Chromium answers it with a rectangle.
    visible: wrappers.filter((el) => el.getBoundingClientRect().height > 0),
    chatter: wrappers.filter((el) => has(el, 'chatter-entry')).length,
    unrecognized: wrappers.filter((el) => has(el, 'unknown-entry')).length,
    infoNotices: wrappers.filter((el) => has(el, 'notice-info')).length,
    trees: view.host.querySelectorAll('[data-cy=workflow-entry]').length,
    onTree: wrappers.filter((el) => has(el, 'workflow-entry')).length,
  }
}

describe('what a .entry[data-item] is (114)', () => {
  it('is ONE ITEM IN THE CURRENT MODE — not a row of the workflow, and not an event', async () => {
    const state = feed(ledger(12))
    await nextTick()

    // The fold first, so the DOM numbers below can be read against something: the twelve frames
    // make no item at all, the `tool_result` folds onto the call it answers, and the 41 reasoning
    // deltas accumulate into a single block. Both ends are asserted, so neither is a claim in a
    // comment that the code stopped being true of.
    expect(ledger(12)).toHaveLength(145)
    const kinds = new Map<string, number>()
    for (const item of state.items) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1)
    expect(Object.fromEntries(kinds)).toEqual({
      notice: 2,
      user: 1,
      tool: 2,
      unknown: 85,
      thinking: 1,
      assistant: 1,
    })

    // ⛔ **The identity, stated as an assertion rather than as a comment.** The wrapper count IS
    // `visibleItems(mode, items).length`, in both modes — which is what makes it a count of the
    // conversation's LENGTH and not of anything the workflow did.
    for (const mode of ['debug', 'normal'] as const) {
      const rows = draw(state, mode)
      expect(rows.wrappers, mode).toHaveLength(visibleItems(mode, state.items).length)
      // …and the paired positive: every one of them is a real row with a real box, so the count is
      // not inflated by wrappers that render nothing. `113`'s second guess is refuted here.
      expect(rows.visible, `${mode}: some wrappers drew no box`).toHaveLength(rows.wrappers.length)
      unmountAll()
    }
  })

  it('⛔ 108’s ceiling of 6 was a claim about the CONVERSATION — and 211 §4 shrank the mode it was checked in', async () => {
    const state = feed(ledger(12))
    await nextTick()

    const debug = draw(state, 'debug')
    // ⛔ **This measured 90 wrappers and 82 chatter rows until 211 §4, and both numbers were the
    // defect.** `1b` turns the lifecycle toggle on, and the toggle has promised *"session start,
    // turn boundaries, idle gaps"* since 079 while the filter went on showing every recognized
    // whisper — which is how 210's Codex plan acquired 208 `item/plan/delta` markers. The 82
    // `activity`/`reasoning` rows are now in the Events tab and nowhere else, so the mode step 57
    // measures is the conversation plus its boundaries: 6 + 2 notices + 2 lifecycle payloads.
    expect(debug.wrappers).toHaveLength(10)
    expect(debug.chatter, 'recognized chatter is back in the lifecycle view').toBe(2)
    expect(debug.infoNotices).toBe(2)
    // ⚠️ **The loud card is a different row from the quiet one-liner, and it is not chatter.** 049
    // split these so a genuine surprise surfaces instead of being swallowed, and `transcript-mode`
    // keeps it in BOTH modes for the same reason.
    expect(debug.unrecognized).toBe(1)
    unmountAll()

    // …and the conversation underneath it is six rows: the prompt, the `Workflow` call the tree
    // hangs off, the `Bash` beside it, the reasoning, the reply — and the one payload nothing could
    // classify, which the reader is still owed.
    const normal = draw(state, 'normal')
    expect(normal.wrappers).toHaveLength(6)
    expect(normal.unrecognized, 'normal mode dropped the loud card').toBe(1)
    // ⚑ **The reconstruction the live smoke performs, checked here rather than assumed there.**
    // Step 57 cannot call `visibleItems`, and it must not toggle a mode that step `1b` owns — so it
    // subtracts the two things the conversation mode drops, off hooks that are in the DOM.
    // ⛔ **`unrecognized` is NOT one of them, and the first draft of this subtracted it.** Review
    // caught it: `transcript-mode.ts` keeps the loud card in both modes, so subtracting it would
    // have blinded the live count to the one payload class it most needs to see. The fixture
    // carries one now, so the term has a value that can be wrong.
    expect(debug.wrappers.length - debug.chatter - debug.infoNotices).toBe(normal.wrappers.length)
    unmountAll()
  })

  it('⚑ 078’s rule, measured where it lives: TWICE the frames, and not one extra row', async () => {
    // ⛔ **This is the assertion `108` meant to write.** It is about the frames, so it varies the
    // frames — the one thing the old ceiling could not do, because a fixed number cannot tell a
    // conversation that is long from a tree that is accreting.
    const twelve = feed(ledger(12))
    const twentyFour = feed(ledger(24))
    expect(twentyFour.items).toHaveLength(twelve.items.length)

    // ⛔ **The extra frames must be PROVEN to have landed, or "no extra rows" is what a fold that
    // ignored them would also produce.** Review caught exactly that hole. `usage` is replaced by
    // every frame (`run.usage = event.usage`), so the last one's number is the receipt: beat 12
    // carries 1,200 tokens and beat 24 carries 2,400.
    const lastBeat = (state: TranscriptState): number | undefined => {
      const row = state.items.find((item) => item.kind === 'tool' && item.workflow !== undefined)
      return row?.kind === 'tool' ? row.workflow?.usage?.tokens : undefined
    }
    expect(lastBeat(twelve)).toBe(1200)
    expect(lastBeat(twentyFour)).toBe(2400)
    await nextTick()

    for (const mode of ['debug', 'normal'] as const) {
      const few = draw(twelve, mode)
      unmountAll()
      const many = draw(twentyFour, mode)
      expect(many.wrappers, `${mode}: doubling the frames changed the row count`).toHaveLength(
        few.wrappers.length,
      )
      // One tree, on one row, whatever the heartbeat rate was.
      expect(many.trees, `${mode}: trees`).toBe(1)
      expect(many.onTree, `${mode}: the tree is spread over more than one row`).toBe(1)
      unmountAll()
    }
  })

  it('a run with NO frames draws no tree — so the count above is about a tree that was really there', async () => {
    // The paired negative for the test above: without it, `trees === 1` could be a component that
    // draws a tree for any tool row at all.
    const state = feed(ledger(0))
    await nextTick()
    const rows = draw(state, 'normal')
    expect(rows.trees).toBe(0)
    // …and the row the tree would have hung off is still there, so this is about the tree.
    // ⚑ **`587` · it is there as a RUN.** A tool call with no workflow and no sub-agents is settled
    // ordinary plumbing and collapses into the quiet line beside its neighbours, so the span that
    // was a wrapper each is one wrapper — which is the same row, drawn once.
    expect(rows.wrappers).toHaveLength(5)
    expect(rows.wrappers.filter((el) => el.querySelector('[data-cy=tool-run]'))).toHaveLength(1)
  })
})
