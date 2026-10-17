import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { ChildWorkInput, ChildWorkResult, TranscriptEvent } from '../../src/shared/runtime-ipc'
import {
  luminance,
  mount,
  paintedBackground,
  paneProps,
  permission,
  record,
  unmountAll,
} from './harness'

/**
 * 112 · What a sub-agent did, on paper — a NESTED document surface inside a themed column (083).
 *
 * ⚠️ **This file exists for the same reason `workflow-tree.dom.test.ts` does**: the viewer's whole
 * claim is about the CASCADE. It is a light paper island rendered inside a column that declares
 * `data-chat-theme`, and every token it uses resolves through that scope. A string assertion could
 * say `background: var(--paper-bg)` and be true of a component that painted the same colour as the
 * dark chrome around it. `getComputedStyle` answers what the colour actually IS.
 */

afterEach(unmountAll)

const AGENT = 'a4d82f4376e9dd5c5'

/**
 * The child's conversation, in the events the importer REALLY produces from one of these files.
 *
 * ⚠️ Measured over all 30 child files on this machine — 30 `user_turn`, 33 `tool_call`, 33
 * `tool_result`, 8 `assistant_message` and 60 `unknown` (the harness's own `attachment` records,
 * which normal mode hides). ⛔ **No `thinking` event, ever**, which is why there is none here: the
 * blocks are recorded with empty bodies and `importClaudeTranscript` drops them. That absence is
 * carried as a COUNT instead — see the thinking test below.
 */
const CONVERSATION: TranscriptEvent[] = [
  { type: 'user_turn', text: 'Return a fixture that breaks a one-line row.' },
  { type: 'tool_call', id: 'toolu_1', name: 'StructuredOutput', summary: '[fixture-overflow]' },
  { type: 'tool_result', id: 'toolu_1', ok: true, summary: '{"prefix":"[fixture-overflow]"}' },
  { type: 'assistant_message', text: 'Done — the fixture is in the structured output.' },
]

const RAW = CONVERSATION.map((event) => JSON.stringify(event)).join('\n')

function ok(over: Partial<ChildWorkResult & { ok: true }> = {}): ChildWorkResult {
  return {
    ok: true,
    part: 'transcript',
    name: `agent-${AGENT}.jsonl`,
    runId: 'wf_7658bea5-b25',
    taskId: 'waw6gpzzj',
    text: RAW,
    truncated: false,
    bytes: RAW.length,
    entries: CONVERSATION,
    ...over,
  } as ChildWorkResult
}

/** Mount inside a column that declares the chat theme, which is where this surface really sits. */
function inColumn(
  result: ChildWorkResult,
  theme: 'light' | 'dark' = 'dark',
): ReturnType<typeof mount> {
  const view = mount(ChildWorkViewer, { result, label: 'fixture:overflow' }, { width: 900 })
  view.host.setAttribute('data-chat-theme', theme)
  return view
}

describe("a child's transcript on paper (112)", () => {
  it('shows what the sub-agent actually did — the ticket, in one assertion', () => {
    const view = inColumn(ok())
    const text = view.q('child-work-viewer').textContent ?? ''
    expect(text).toContain('Return a fixture that breaks a one-line row.')
    expect(text).toContain('StructuredOutput')
    expect(text).toContain('Done — the fixture is in the structured output.')
    // And it says whose work this is, and which run it came out of.
    expect(view.q('child-work-name').textContent).toContain(`agent-${AGENT}.jsonl`)
    expect(view.q('child-work-run').textContent).toContain('wf_7658bea5-b25')
  })

  it('the paper is LIGHT inside the dark column, and inside the light one too', () => {
    for (const theme of ['dark', 'light'] as const) {
      const view = inColumn(ok(), theme)
      const paper = view.q('child-work-viewer').querySelector('.paper')
      expect(paper, 'no paper element').not.toBeNull()
      const painted = paintedBackground(paper!)
      expect(painted[3], `${theme}: the paper is transparent onto nothing`).toBeGreaterThan(0)
      // ⚠️ A number, not a token name: `--paper-bg` is `#f7f8fa`, and a component that had lost the
      // rule would inherit the surface behind it — which in the dark column is nearly black.
      expect(luminance(painted), `${theme}: the paper is not light`).toBeGreaterThan(0.7)
      view.unmount()
    }
  })

  it('Raw shows the BYTES, so the rendering can always be checked', async () => {
    const view = inColumn(ok())
    expect(view.all('child-work-raw')).toHaveLength(0)
    view.q('child-view-raw').click()
    await nextTick()
    const raw = view.q('child-work-raw')
    expect(raw.textContent).toContain('"type":"assistant_message"')
    // …and the paired positive: switching back gives the conversation, not an empty pane.
    view.q('child-view-transcript').click()
    await nextTick()
    expect(view.all('child-work-raw')).toHaveLength(0)
    expect(view.q('child-work-viewer').textContent).toContain('Done — the fixture')
  })

  it('⛔ READ-ONLY: nothing here can send, answer, or resume', () => {
    // 109 item 7 and 112's acceptance 6. Four independent ways, asserted as one: no composer, no
    // approval controls, no resume, and no text input of any kind in the subtree.
    //
    // ⚑ **296 did NOT weaken this, and the reason is worth being precise about.** This mount is
    // given no `agent`, no `onReadState` and no `onSend`, so it has no channel to anything — and a
    // viewer with no channel must still be exactly what it was. What 296 added is a SECOND mount
    // that has all three: `test/dom/child-talk.dom.test.ts` presses its Send button and watches a
    // message reach a child. ⛔ **The two are a pair and neither is complete alone** — this one
    // would pass over a build where the composer never renders, and that one would pass over a
    // build where it renders everywhere.
    //
    // ⚠️ **What is still true of BOTH**: the approval cards in a child's record are settled, not
    // live. A composer speaks to the child; it does not answer questions the child already asked
    // and had answered in its own conversation.
    const view = inColumn(ok({ entries: [...CONVERSATION, permission('req_child')] }))
    const root = view.q('child-work-viewer')
    expect(root.querySelectorAll('textarea')).toHaveLength(0)
    expect(root.querySelectorAll('input')).toHaveLength(0)
    expect(root.querySelector('[data-cy=prompt-composer]')).toBeNull()
    // ⚠️ The paired positive, or the four negatives above would pass over an empty component: the
    // permission IS rendered, and it is rendered as settled rather than as live buttons.
    const buttons = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(buttons.length, 'nothing rendered at all').toBeGreaterThan(0)
    expect(buttons).not.toContain('Allow')
    expect(buttons).not.toContain('Deny')
  })

  it('⛔ thinking with no body is COUNTED, never dressed up as reasoning (109)', () => {
    // ⚠️ The count comes from the MAIN process, off the records, because it cannot come from the
    // items: the importer drops an empty thinking block, so a viewer counting `items` would report
    // zero for a file with ten of them — which reads as a child that did not think.
    const view = inColumn(ok({ thinkingBlocks: 3 }))
    expect(view.q('child-work-thinking-note').textContent).toContain('3 thinking blocks were')
    expect(view.q('child-work-thinking-note').textContent).toContain('not the reasoning')
    view.unmount()
    // …and the paired negative: a child that recorded none says nothing, rather than "0 thinking".
    const none = inColumn(ok())
    expect(none.all('child-work-thinking-note')).toHaveLength(0)
    expect(none.q('child-work-viewer').textContent).toContain('Done — the fixture')
  })

  it('a cut file says it was cut, with its real size', () => {
    const view = inColumn(ok({ truncated: true, bytes: 250_000 }))
    expect(view.q('child-work-truncated').textContent).toContain('244 KB')
  })

  it('lines the parser could not read are reported rather than dropped in silence', () => {
    const view = inColumn(ok({ unreadable: 2 }))
    expect(view.q('child-work-unreadable').textContent).toContain('2 lines')
  })
})

describe('a journal, a script, and every refusal (112)', () => {
  it('a journal opens on Raw through the ONE document body — same paper, same rules', () => {
    const view = inColumn(
      ok({ part: 'journal', name: 'journal.jsonl', entries: undefined, text: '{"type":"result"}' }),
    )
    expect(view.q('document-body').getAttribute('data-view')).toBe('raw')
    expect(view.q('doc-raw').textContent).toContain('"type":"result"')
    // It is the document viewer, so the toggle the standing rule requires is there.
    expect(view.all('doc-view-markdown')).toHaveLength(1)
  })

  it('every refusal is its own sentence — never a blank pane, and never a zero', () => {
    const said = new Set<string>()
    for (const reason of ['unknown-agent', 'unsupported', 'gone', 'not-readable', 'unreadable']) {
      const view = inColumn({ ok: false, reason } as ChildWorkResult)
      const text = view.q('child-work-refusal').textContent?.trim() ?? ''
      expect(text.length, reason).toBeGreaterThan(20)
      said.add(text)
      view.unmount()
    }
    // ⚠️ Five DIFFERENT sentences. A viewer that says "not found" for all five teaches the reader
    // to distrust it — 108's rule, and the reason the reasons are separate values at all.
    expect(said.size).toBe(5)
  })

  it('a missing output file is still the OTHER viewer’s sentence, and both stay distinct (112)', () => {
    // The two doors say different true things: one is about a run's answer, the other about a
    // child's record. Pinned so a future edit cannot collapse them into one word.
    const view = inColumn({ ok: false, reason: 'gone' } as ChildWorkResult)
    expect(view.q('child-work-refusal').textContent).toContain("provider's home")
  })

  it('a child that belongs to no run says nothing about a run, rather than inventing one', () => {
    const view = inColumn(ok({ runId: null }))
    expect(view.all('child-work-run')).toHaveLength(0)
    // Paired positive: the file is still named, so the absence is about the RUN.
    expect(view.q('child-work-name').textContent).toContain('agent-')
  })

  it('⚠️ the sidecar asymmetry is SHOWN where it exists and silent where it does not (115)', () => {
    // Measured: a plain Task child's `.meta.json` carries `description` and `toolUseId`; a workflow
    // agent's carries `{"agentType":"workflow-subagent","spawnDepth":1}` and neither.
    const plain = inColumn(
      ok({
        runId: null,
        taskId: null,
        title: 'Summarize workspace contents',
        parentToolCallId: 'toolu_01JDtFLW68vsGED3z4L5eYUW',
      }),
    )
    expect(plain.q('child-work-title').textContent).toContain('Summarize workspace contents')
    expect(plain.q('child-work-parent').textContent).toContain('toolu_01JDtFLW68vsGED3z4L5eYUW')
    plain.unmount()
    // …and the workflow child, whose sidecar says neither: two absences, not two blanks.
    const workflow = inColumn(ok())
    expect(workflow.all('child-work-title')).toHaveLength(0)
    expect(workflow.all('child-work-parent')).toHaveLength(0)
    // Paired positive, so the two negatives are not about a viewer that rendered nothing.
    expect(workflow.q('child-work-run').textContent).toContain('wf_7658bea5-b25')
  })
})

/**
 * 115 · **The card that opened nothing**, walked from the events that draw it.
 *
 * The reader, parser, and transcript file are insufficient if the host’s allowlist contains
 * only the `workflow_run` roster. Ordinary `[SUB]` children also need their sub-agent card to
 * open the transcript.
 *
 * ⚠️ **Not a second copy of `workflow-tree.dom.test.ts`'s walk (114), and the fixture is why.**
 * That one starts at a `workflow_run` frame and travels through the tree. This one starts at a
 * `sub_agent` event — the only announcement either kind of child in this file ever gets — and
 * travels through `SubAgentEntry`, which had no path to the pane at all until now. Same harness,
 * same mount, a seam that did not exist.
 */
describe('the sub-agent card finally opens something (115)', () => {
  const TASK = 'ab1bcb4820e3a1c8f'
  const THREAD = '019fdc5f-4aa4-7af0-9ce0-00a9f1541da1'

  const CHILD: TranscriptEvent[] = [
    { type: 'user_turn', text: 'Summarize the workspace.' } as TranscriptEvent,
    { type: 'tool_call', id: 'toolu_ls', name: 'Bash', summary: 'ls -la' } as TranscriptEvent,
    {
      type: 'tool_result',
      id: 'toolu_ls',
      ok: true,
      summary: 'six files',
    } as unknown as TranscriptEvent,
    { type: 'assistant_message', text: 'Six files, none of them source.' } as TranscriptEvent,
  ]

  /**
   * A turn that dispatched one sub-agent, in the three phases the provider really sends.
   *
   * ⚠️ **`parentToolCallId` is on it**, so the card nests inside the `Task` row exactly as it does
   * in the app — which is the placement the emit has to survive. A top-level card is the OTHER
   * route and is asserted separately below.
   */
  function dispatched(over: Partial<Record<string, unknown>> = {}): TranscriptEvent[] {
    const base = { type: 'sub_agent', agentId: TASK, parentToolCallId: 'toolu_task', ...over }
    return [
      { type: 'user_turn', text: 'Have a sub-agent summarize the workspace.' } as TranscriptEvent,
      { type: 'tool_call', id: 'toolu_task', name: 'Task', summary: 'Explore' } as TranscriptEvent,
      {
        ...base,
        phase: 'started',
        kind: 'Explore',
        title: 'Summarize workspace contents',
      } as unknown as TranscriptEvent,
      { ...base, phase: 'progress', lastTool: 'Bash' } as unknown as TranscriptEvent,
      {
        ...base,
        phase: 'ended',
        outcome: 'completed',
        summary: 'Six files, none of them source.',
        usage: { tokens: 4210, toolCalls: 3, ms: 8400 },
      } as unknown as TranscriptEvent,
      { type: 'assistant_message', text: 'It found six files.' } as TranscriptEvent,
    ]
  }

  /** Mount the pane over those events, with the reader recording what it was ASKED for. */
  function pane(
    events: TranscriptEvent[],
    answer: ChildWorkResult = childOk(),
  ): { view: ReturnType<typeof mount>; asked: ChildWorkInput[] } {
    const asked: ChildWorkInput[] = []
    const view = mount(
      ConversationPane,
      paneProps({
        record: record(events),
        mode: 'normal',
        debug: false,
        onReadChildWork: async (what: ChildWorkInput): Promise<ChildWorkResult> => {
          asked.push(what)
          return answer
        },
      }),
      { width: 1200, height: 900 },
    )
    return { view, asked }
  }

  function childOk(over: Partial<ChildWorkResult & { ok: true }> = {}): ChildWorkResult {
    const text = CHILD.map((event) => JSON.stringify(event)).join('\n')
    return {
      ok: true,
      part: 'transcript',
      name: `agent-${TASK}.jsonl`,
      // ⛔ Both null: a plain Task child is in no run and under no workflow task.
      runId: null,
      taskId: null,
      title: 'Summarize workspace contents',
      parentToolCallId: 'toolu_01JDtFLW68vsGED3z4L5eYUW',
      text,
      truncated: false,
      bytes: text.length,
      entries: CHILD,
      thinkingBlocks: 0,
      ...over,
    } as ChildWorkResult
  }

  it('a plain Task card → its own transcript, addressed by the id the card carries', async () => {
    const { view, asked } = pane(dispatched())

    // The card is where the app really puts it: nested in the `Task` row that dispatched it.
    const card = view.q('subagent-entry')
    expect(view.q('tool-subagents').contains(card)).toBe(true)
    expect(view.q('subagent-status').textContent).toContain('completed')

    // **The click**, and what it asked for. ⛔ An identity — no path leaves the renderer.
    view.q('subagent-open-transcript').click()
    await nextTick()
    expect(asked).toEqual([{ part: 'transcript', agentId: TASK }])
    await nextTick()

    // **The transcript, open and folded** — the child's own work, drawn by the same components.
    const child = view.q('child-work-viewer')
    expect(view.all('child-work-refusal')).toHaveLength(0)
    expect(view.q('child-work-name').textContent).toContain(`agent-${TASK}.jsonl`)
    // ⚠️ **Rows, not characters (113) — and rows, not EVENTS (114).** Four events fold to three
    // rows, because a `tool_call` and its `tool_result` are one row: `114` settled that a
    // `.entry[data-item]` is one item in the current mode, and a count taken off `CHILD.length`
    // would be asserting the arithmetic this repo has already got wrong once.
    expect(child.querySelectorAll('.entry[data-item]')).toHaveLength(3)
    expect(view.all('child-work-empty')).toHaveLength(0)
    expect(child.textContent).toContain('Six files, none of them source.')
    // ⛔ It is in NO run, and the header says nothing rather than inventing one.
    expect(view.all('child-work-run')).toHaveLength(0)
    // …and what only the sidecar knew: what it was asked to do, and which call asked.
    expect(view.q('child-work-title').textContent).toContain('Summarize workspace contents')
    // ⚠️ **The LABEL the click carried** — the second emit argument, which review found asserted
    // nowhere and which had no hook to assert on. It is the overlay's heading: an empty one is a
    // reader who does not know whose work they opened.
    expect(view.q('child-work-label').textContent).toContain('Summarize workspace contents')

    // **Closed**, and the conversation is still underneath it.
    view.q('close-overlay').click()
    await nextTick()
    expect(view.all('child-work-viewer')).toHaveLength(0)
    expect(view.all('subagent-entry')).toHaveLength(1)
  })

  it('a TOP-LEVEL card opens too — the placement 029 renders by design', async () => {
    // ⚠️ The other route through the tree, and it is a different component boundary: this card is
    // an entry in `TranscriptView` rather than a child of `ToolEntry`. Severing either seam leaves
    // the other one green, which is why both are walked.
    const orphan = dispatched().filter((event) => (event as { type: string }).type !== 'tool_call')
    const { view, asked } = pane(orphan)
    const card = view.q('subagent-entry')
    expect(card.getAttribute('data-placement')).toBe('transcript')
    expect(view.all('tool-subagents')).toHaveLength(0)
    view.q('subagent-open-transcript').click()
    await nextTick()
    expect(asked).toEqual([{ part: 'transcript', agentId: TASK }])
    await nextTick()
    expect(view.all('child-work-viewer')).toHaveLength(1)
  })

  it('⚑ a CODEX child opens its rollout, and still says the provider does not say', async () => {
    // A Codex child’s life can contain only three `sub_agent` events with an id and parent
    // call, but no title, usage, or outcome. The display must tolerate that sparse shape.
    const events: TranscriptEvent[] = [
      { type: 'user_turn', text: 'Delegate this.' } as TranscriptEvent,
      {
        type: 'sub_agent',
        agentId: THREAD,
        idKind: 'thread',
        phase: 'started',
      } as unknown as TranscriptEvent,
      {
        type: 'sub_agent',
        agentId: THREAD,
        idKind: 'thread',
        phase: 'ended',
      } as unknown as TranscriptEvent,
    ]
    const rollout = '{"type":"session_meta","payload":{}}'
    const { view, asked } = pane(events, {
      ok: true,
      part: 'transcript',
      name: 'rollout-2026-08-07T14-17-40-019fdc5f.jsonl',
      runId: null,
      taskId: null,
      text: rollout,
      truncated: false,
      bytes: rollout.length,
      entries: [{ type: 'assistant_message', text: 'This is a rollout.' } as TranscriptEvent],
    } as ChildWorkResult)

    // ⛔ **111's rule, not regressed**: a provider that reports no usage says so in words. A card
    // reading `0 tools · 0k tokens` would be a measurement nobody took.
    expect(view.q('subagent-usage-unreported').textContent).toContain('usage not reported')
    expect(view.all('subagent-usage')).toHaveLength(0)
    // …and it is named for what it IS — a thread with a conversation somewhere, not a dispatch.
    expect(view.q('subagent-ident').textContent).toContain('child thread ID')

    view.q('subagent-open-transcript').click()
    await nextTick()
    expect(asked).toEqual([{ part: 'transcript', agentId: THREAD }])
    await nextTick()
    expect(view.q('child-work-name').textContent).toContain('rollout-2026-08-07')
    expect(view.q('child-work-viewer').textContent).toContain('This is a rollout.')
    // ⚠️ **The fallback end of the label chain.** A Codex child reports neither a title nor a kind,
    // so `card.title || card.kind || 'agent'` lands on its last term — which is the whole reason
    // that chain exists, and it was untested.
    expect(view.q('child-work-label').textContent?.trim()).toBe('agent')
    // ⛔ No thinking count for a provider that was never asked for one — silence, not a zero.
    expect(view.all('child-work-thinking-note')).toHaveLength(0)
  })

  it("⚑ an agent's agent opens too — the recursion forwards, and nothing else walked it", async () => {
    // ⚠️ **Review found this the one seam of the three with no test at all.** `SubAgentEntry`
    // renders itself for a grandchild (035), so its own `@open-child` re-emit is the only way that
    // card's request reaches the pane — and deleting that one line left the whole suite green
    // while turning a grandchild's button into a dead control.
    const GRAND = 'a5555555555555555'
    const events: TranscriptEvent[] = [
      { type: 'user_turn', text: 'Nest an agent inside an agent.' } as TranscriptEvent,
      { type: 'tool_call', id: 'toolu_task', name: 'Task', summary: 'Explore' } as TranscriptEvent,
      {
        type: 'sub_agent',
        agentId: TASK,
        parentToolCallId: 'toolu_task',
        phase: 'started',
        kind: 'Explore',
      } as unknown as TranscriptEvent,
      // A call made BY that child. ⚠️ **Its `parentToolCallId` is the DISPATCHING call's id, not
      // the agent's** — a sub-agent's tool blocks carry `parent_tool_use_id`, which is the same id
      // the card hangs off. The row lands on the card and becomes a dispatch point a grandchild
      // can name (035).
      {
        type: 'tool_call',
        id: 'toolu_inner',
        name: 'Task',
        summary: 'general-purpose',
        parentToolCallId: 'toolu_task',
      } as unknown as TranscriptEvent,
      {
        type: 'sub_agent',
        agentId: GRAND,
        parentToolCallId: 'toolu_inner',
        phase: 'ended',
        kind: 'general-purpose',
        title: 'Count the lines',
        outcome: 'completed',
        summary: 'Eleven.',
      } as unknown as TranscriptEvent,
    ]
    const { view, asked } = pane(events, childOk({ name: `agent-${GRAND}.jsonl` }))

    // The grandchild's card is inside its parent's BODY, which is closed until asked for.
    const parent = view.q('subagent-head')
    expect(parent.getAttribute('aria-expanded')).toBe('false')
    parent.click()
    await nextTick()
    const cards = view.all('subagent-entry')
    expect(cards, 'the grandchild card is not rendered').toHaveLength(2)
    const grand = cards.find((el) => el.getAttribute('data-agent-id') === GRAND)
    expect(grand, 'no card carries the grandchild id').toBeDefined()
    // Nested inside the parent card, not stranded at top level — 035's whole subject.
    expect(cards[0]!.contains(grand!)).toBe(true)

    // **The click, two levels down.**
    grand!.querySelector<HTMLElement>('[data-cy=subagent-open-transcript]')!.click()
    await nextTick()
    expect(asked).toEqual([{ part: 'transcript', agentId: GRAND }])
    await nextTick()
    expect(view.q('child-work-name').textContent).toContain(`agent-${GRAND}.jsonl`)
    expect(view.q('child-work-label').textContent).toContain('Count the lines')
  })

  it('a refusal is a SENTENCE in the overlay, not a card that quietly does nothing', async () => {
    // The honest end of the always-offered button: nothing on the wire says whether a file exists,
    // so the door answers and the reader is told which of the two causes it was.
    const { view, asked } = pane(dispatched(), { ok: false, reason: 'gone' } as ChildWorkResult)
    view.q('subagent-open-transcript').click()
    await nextTick()
    expect(asked).toHaveLength(1)
    await nextTick()
    expect(view.q('child-work-refusal').textContent).toContain("provider's home")
    expect(view.all('child-work-name')).toHaveLength(0)
  })
})
