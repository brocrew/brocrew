import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionInstructions from '../../src/renderer/src/components/SessionInstructions.vue'
import type { MemoryRecallEntry, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **319 · the recall is on the screen — rendered, in Chromium, and looked at.**
 *
 * ⛔ **The defect is an element that is not there**, which is what `318`'s own DOM test says of its
 * defect and why this one exists beside it: `193`'s rule is that a `not.toContain` passes just as
 * happily over a component that never rendered. Every negative here is paired with a positive about
 * the same element.
 *
 * ⚑ **The payload is 318's capture from a real 0.146.0 child**, entry for entry.
 */

const CITED: MemoryRecallEntry[] = [
  { path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' },
  {
    path: 'rollout_summaries/2026-02-17T21-23-02-LN3m-example.md',
    lineStart: 10,
    lineEnd: 12,
    note: 'weekly report format',
  },
]

function recall(
  entries: MemoryRecallEntry[] = CITED,
  over: Record<string, unknown> = {},
): TranscriptEvent {
  return { type: 'memory_recall', entries, source: 'memoryCitation', ...over } as TranscriptEvent
}

function pane(events: TranscriptEvent[], over: Record<string, unknown> = {}) {
  return mount(ConversationPane, paneProps({ record: record(events), ...over }), {
    width: 1100,
    height: 700,
  })
}

afterEach(unmountAll)

describe('319 §1.1 · the file, the line range and the note are all on the row', () => {
  it('draws every part of the citation — a bare “used memory” row would throw away the point', () => {
    const view = pane([
      { type: 'user_turn', text: 'what is my full name?' },
      { type: 'assistant_message', text: 'Bob Alicio.' },
      recall(),
    ])
    const row = view.q('memory-recall')
    expect(row.textContent).toContain('MEMORY.md')
    expect(row.textContent).toContain('rollout_summaries/2026-02-17T21-23-02-LN3m-example.md')
    expect(row.textContent).toContain('lines 1–3')
    expect(row.textContent).toContain('lines 10–12')
    expect(row.textContent).toContain('the user’s full name')
    expect(row.textContent).toContain('weekly report format')
    expect(view.all('memory-recall-row')).toHaveLength(2)
  })

  it('a one-line citation says “line”, not “lines 4–4”', () => {
    const view = pane([recall([{ path: 'MEMORY.md', lineStart: 4, lineEnd: 4 }])])
    expect(view.q('memory-recall-lines').textContent).toContain('line 4')
    expect(view.q('memory-recall-lines').textContent).not.toContain('–')
  })

  it('⛔ no range is drawn where the provider gave no usable one, and the FILE still shows', () => {
    // 074: a range printed from a number nobody could read is a measurement nobody made.
    const view = pane([recall([{ path: 'MEMORY.md', note: 'no range on this one' }])])
    expect(view.all('memory-recall-lines')).toHaveLength(0)
    // Paired positives on the same row, so the absence above is about the range and not the mount.
    expect(view.q('memory-recall-row').textContent).toContain('MEMORY.md')
    expect(view.q('memory-recall-note').textContent).toContain('no range on this one')
  })

  it('a citation with no note draws no empty quote', () => {
    const view = pane([recall([{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3 }])])
    expect(view.all('memory-recall-note')).toHaveLength(0)
    expect(view.q('memory-recall-row').textContent).toContain('lines 1–3')
  })
})

describe('319 §1.4 · it says who reported it, and does not blur into the write row', () => {
  /**
   * ⛔ **The honesty assertion this dispatch turns on.** The provider really did publish this — so
   * the row may say so, which 318's row could not. But what it published is the model's own
   * citation, parsed; nothing watched a file being read, and `009`'s rule is that a disclosure must
   * not say we saw what we were only told.
   */
  it('says the provider reported it AND that it is the agent’s own account', () => {
    const said = pane([recall()]).q('memory-recall-provenance').textContent ?? ''
    expect(said).toContain('The provider reported this')
    expect(said).toContain('own account of what it used')
    expect(said).toContain('not a tool call')
    // ⚠️ Paired with the positives, or this passes over an element that rendered nothing.
    expect(said.length).toBeGreaterThan(40)
  })

  it('⛔ never says it WATCHED or READ the file — the verb is “cited”', () => {
    const view = pane([recall()])
    const whole = view.q('memory-recall').textContent ?? ''
    expect(whole).toContain('cited')
    expect(whole, 'the row claims an observation nobody made').not.toContain('we read')
    expect(whole, 'the row claims a tool ran').not.toContain('called')
  })

  it('is a different row from the write-side one, and neither is a tool card', () => {
    const view = pane([
      { type: 'memory_note', notes: [{ path: '/homes/codex/memories/x.md', text: 'hi' }] },
      recall(),
    ] as TranscriptEvent[])
    // ⚑ 319 §1.4: they sit together and they are not the same claim. Both on screen, both distinct,
    // and no `tool` card conjured by either.
    expect(view.all('memory-note')).toHaveLength(1)
    expect(view.all('memory-recall')).toHaveLength(1)
    expect(view.all('tool-card')).toHaveLength(0)
    expect(view.q('memory-note-provenance').textContent).toContain('Seen on disk')
    expect(view.q('memory-recall-provenance').textContent).toContain('The provider reported this')
  })

  it('⛔ nothing in the row is clickable — every path in it was written by the model', () => {
    // The provider TELLS the model to cite paths relative to the memory base and never workspace
    // files; that is an instruction, which is a thing a model can get wrong. So this row resolves
    // nothing and opens nothing, and there is no control to press.
    const row = pane([recall()]).q('memory-recall')
    // ⛔ **556: *nothing in the row is clickable* is a claim about a row somebody is READING.**
    // Two counts of zero are equally true of a row rendered blank, so the words come first and the
    // absence of a control is asserted about a row that has something in it to press.
    expect(row.textContent).toContain('cited')
    expect(row.querySelectorAll('button')).toHaveLength(0)
    expect(row.querySelectorAll('a')).toHaveLength(0)
  })
})

describe('319 §1.2 · the earlier sessions are a count, never an id', () => {
  it('says how many and says plainly that it cannot name them', () => {
    const view = pane([
      recall(CITED, { threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043', '019c7714-3b77'] }),
    ])
    const said = view.q('memory-recall-earlier').textContent ?? ''
    expect(said).toContain('2 earlier sessions')
    expect(said).toContain('cannot say which')
    // ⛔ **The id itself is nowhere on the screen** — `106`: a raw UUID looks like a handle and
    // nothing in this app can open one.
    expect(view.q('memory-recall').textContent).not.toContain('019c6e27')
  })

  it('counts the ids past the wire cap too, so the number cannot understate', () => {
    const view = pane([recall(CITED, { threadIds: ['a', 'b'], threadsDropped: 5 })])
    expect(view.q('memory-recall-earlier').textContent).toContain('7 earlier sessions')
  })

  it('a citation naming none draws no such line at all', () => {
    const view = pane([recall()])
    expect(view.all('memory-recall-earlier')).toHaveLength(0)
    // 193: paired positive about the same row.
    expect(view.q('memory-recall').textContent).toContain('MEMORY.md')
  })

  it('one earlier session is “session”, not “sessions”', () => {
    const view = pane([recall(CITED, { threadIds: ['019c6e27'] })])
    expect(view.q('memory-recall-earlier').textContent).toContain('1 earlier session of its own')
  })
})

describe('319 §1.3 · silence means no memory was consulted, and never “unknown”', () => {
  it('an ordinary answer draws no recall row and nothing that hedges', () => {
    const view = pane([
      { type: 'user_turn', text: 'hello' },
      { type: 'assistant_message', text: 'Hello.' },
    ])
    expect(view.all('memory-recall')).toHaveLength(0)
    const surface = view.q('reading-surface').textContent ?? ''
    // ⛔ The fabricated third state, asserted absent by name — and paired with the positive that the
    // reply itself really did render, so this cannot pass over a dead mount.
    expect(surface).toContain('Hello.')
    expect(surface.toLowerCase()).not.toContain('memory')
  })

  it('a cap that bit is stated out loud (092 §4)', () => {
    expect(pane([recall(CITED, { dropped: 3 })]).q('memory-recall-dropped').textContent).toContain(
      '3 more',
    )
    expect(pane([recall()]).all('memory-recall-dropped')).toHaveLength(0)
  })
})

describe('319 · the row is in the mode a person reads in', () => {
  it('shows in normal AND in debug — F5 is a person who could not see it', () => {
    expect(pane([recall()], { mode: 'normal' }).all('memory-recall')).toHaveLength(1)
    expect(pane([recall()], { mode: 'debug' }).all('memory-recall')).toHaveLength(1)
  })
})

describe('319 §2.1 · the panel points at the row, and only where the row exists', () => {
  const store = {
    injected: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: true,
    writesReported: false,
    agentMemory: [
      {
        kind: 'agent-memory' as const,
        path: '/homes/codex/memories/MEMORY.md',
        text: '# Handbook',
        bytes: 10,
        truncated: false,
        reach: 'on-request' as const,
      },
    ],
  }

  /**
   * 🔴 **583 · the door moved behind the `learned` tab, and this is the address, not the claim.**
   *
   * Only one owner’s prompt tab is in the DOM. In `SessionInstructions.vue`,
   * `memory-store-not-a-reading` and `memory-store-recall-is-shown` live under
   * `v-if="showing.whose === 'learned'"`, labeled “the agent’s own”. With `injected: []` and
   * one `agent-memory` row, `configured` still sorts first in `WHOSE_TEXT`. Press
   * `told-tab-learned` before reading the hooks, as `instructions.dom.test.ts` and
   * `the-memory-a-fresh-identity-does-not-have.dom.test.ts` do.
   *
   * ⚠️ **Every assertion below is unchanged** — the sentence still names the door, the door is
   * still absent when the provider reports no recall, and the row still names no provider on
   * either arm. Only the route to the element moved; nothing here is weaker for having to walk it.
   */
  async function learnedTab(instructions: Record<string, unknown>): Promise<Mounted> {
    const view = mount(SessionInstructions, { instructions }, { width: 380 })
    view.q('told-tab-learned').click()
    await nextTick()
    return view
  }

  it('keeps 318’s true clause and adds the door', async () => {
    const view = await learnedTab(store)
    const said = view.q('memory-store-not-a-reading').textContent ?? ''
    // ⚑ **The first clause survives 319 unchanged**, because its literal claim is still true: this
    // panel reports a STORE and never a reading (009, 305). What went false was the dead end it
    // implied, and that is what the second clause repairs.
    expect(said).toContain('which of these the agent has actually looked up')
    expect(view.q('memory-store-recall-is-shown').textContent).toContain(
      'says so in the conversation',
    )
  })

  /**
   * ⛔ **`308`'s defect, on `308`'s own surface, asserted absent.** The other provider publishes no
   * citation — 318 measured that its CLI preloads its memory index with no tool and no citation of
   * any kind — so a panel pointing unconditionally would promise its user a row that never comes.
   *
   * ⚑ **583: the tab exists on both arms.** `recallsReported` gates only the sentence inside the
   * `learned` tab, not the tab itself — the fixture still carries one `agent-memory` row, so
   * `WhoseGroup.drawn` still holds and `told-tab-learned` is still there to press.
   */
  it('draws NO door for a session whose provider reports no recall', async () => {
    const view = await learnedTab({ ...store, recallsReported: false })
    expect(view.all('memory-store-recall-is-shown')).toHaveLength(0)
    // 193: paired positive on the same element, so the absence is about the flag and not the mount.
    expect(view.q('memory-store-not-a-reading').textContent).toContain(
      'which of these the agent has actually looked up',
    )
  })

  /**
   * ⚠️ **The SENTENCE, not the whole panel** — the same scoping 318's test uses one file over, and
   * for a reason worth stating: a rendered PATH legitimately contains a provider's name because it
   * is a real directory on this machine. 317's rule is about the words this app writes, and the
   * source scan in `disclosure-answers-to-the-code.test.ts` is what enforces it over the whole file.
   *
   * ⚑ **583: both arms are pressed to `learned` before the words are read**, same reason as above.
   */
  it('names no provider, on either arm (317’s rule)', async () => {
    for (const recallsReported of [true, false]) {
      const view = await learnedTab({ ...store, recallsReported })
      const said = (view.q('memory-store-not-a-reading').textContent ?? '').toLowerCase()
      expect(said).not.toContain('claude')
      expect(said).not.toContain('codex')
      // The paired positive: the sentence really rendered, on both arms.
      expect(said).toContain('actually looked up')
    }
  })
})
