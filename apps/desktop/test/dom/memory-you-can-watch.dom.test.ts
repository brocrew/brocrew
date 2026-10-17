import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import SessionInstructions from '../../src/renderer/src/components/SessionInstructions.vue'
import type { MemoryNoteSeen, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

/**
 * 🔴 **318 · a memory you can watch happen — rendered, clicked, and looked at.**
 *
 * ⛔ **The defect is an element that is not there**, exactly as `eleven-hours.dom.test.ts` says of
 * its own: `193`'s rule is that a `not.toContain` passes just as happily over a component that did
 * not render, and the only honest way to ask *"is this row on the screen"* is to render the screen
 * and look. Real component, real Chromium, real click.
 *
 * ⚑ **And the gesture is the point of half of it.** 318 §2.3 asks for the panel to be findable from
 * the conversation, and the plumbing it needed did not exist: `toggleDrawer` is a FLIP and
 * `update:drawerTab` only lands while the drawer is open, so nothing could say *"show me that"*.
 * The assertion that the pane raises one event carrying both halves is the assertion that the link
 * works at all.
 */

const NOTES_DIR = '/homes/codex/memories/extensions/ad_hoc/notes'

function memoryNote(notes: MemoryNoteSeen[], dropped?: number): TranscriptEvent {
  return { type: 'memory_note', notes, ...(dropped ? { dropped } : {}) } as TranscriptEvent
}

/** Two memory-note fixtures at measured store sizes. */
const HIS_NOTES: MemoryNoteSeen[] = [
  {
    path: `${NOTES_DIR}/2026-09-04T00-01-00-user-full-name.md`,
    bytes: 108,
    text: "The user's full name is Bob Alicio. This updates the earlier memory that listed only a first name.",
  },
  {
    path: `${NOTES_DIR}/2026-09-04T00-00-00-user-name.md`,
    bytes: 23,
    text: "The user's name is Bob.",
  },
]

function pane(events: TranscriptEvent[], over: Record<string, unknown> = {}) {
  return mount(ConversationPane, paneProps({ record: record(events), ...over }), {
    width: 1100,
    height: 700,
  })
}

afterEach(unmountAll)

describe('318 §2.1 · the write is in the conversation', () => {
  it('draws the row, with the note’s own words', () => {
    const view = pane([{ type: 'user_turn', text: 'remember my name' }, memoryNote(HIS_NOTES)])
    const row = view.q('memory-note')
    expect(row.textContent).toContain("The user's name is Bob.")
    expect(row.textContent).toContain('Bob Alicio')
    // The path is shown whole — these exist to be pasted into a terminal.
    expect(row.textContent).toContain(`${NOTES_DIR}/2026-09-04T00-00-00-user-name.md`)
    expect(view.all('memory-note-row')).toHaveLength(2)
  })

  /**
   * ⛔ **The honesty assertion, and the one this dispatch turns on.** The row may not read as a
   * reported tool call — we watched a directory, not a wire (`009`, `305`).
   */
  it('says it saw a file and does not claim a tool call', () => {
    const view = pane([memoryNote([HIS_NOTES[1]!])])
    const said = view.q('memory-note-provenance').textContent ?? ''
    expect(said).toContain('Seen on disk')
    expect(said).toContain('not reported as a tool call')
    // ⚠️ Paired with the positive above, or this passes over an element that rendered nothing.
    expect(said.length).toBeGreaterThan(20)
    // The subject is the PROFILE, because a profile is the shared-memory boundary (085).
    expect(view.q('memory-note-heading').textContent).toContain('profile')
  })

  it('counts the notes it did not list', () => {
    const view = pane([memoryNote(HIS_NOTES, 3)])
    expect(view.q('memory-note-dropped').textContent).toContain('3 more')
    // The paired negative: an ordinary event draws no such line at all.
    const plain = pane([memoryNote(HIS_NOTES)])
    expect(plain.all('memory-note-dropped')).toHaveLength(0)
  })

  it('keeps the row for a note whose bytes it would not carry, and says the READER’s reason', () => {
    const linked: MemoryNoteSeen = {
      path: `${NOTES_DIR}/2026-09-04T00-02-00-linked.md`,
      unread: 'symlink',
    }
    const view = pane([memoryNote([linked])])
    expect(view.all('memory-note-text')).toHaveLength(0)
    // ⚑ **733 · words true of both rows that carry it**: one written before `733`, when the row
    // refused every link, and a loop of links now. It read *"this row does not follow one into the
    // store"*, which is false of a row that follows links.
    expect(view.q('memory-note-unread').textContent).toContain(
      'a link this row did not follow to a file',
    )
    // ⛔ **No size where none was measured** — the row has no text for this note, and a size beside
    // no text would be a measurement of a file it did not read.
    expect(view.q('memory-note-row').textContent).not.toContain(' B')

    // ⛔ **A different reason says a different thing** — the defect was ONE sentence for six causes,
    // so a second reason drawing the identical words is exactly what this pins.
    const broken: MemoryNoteSeen = {
      path: `${NOTES_DIR}/2026-09-04T00-04-00-binary.md`,
      bytes: 12,
      unread: 'not-utf8',
    }
    const other = pane([memoryNote([broken])]).q('memory-note-unread').textContent ?? ''
    expect(other).toContain('not readable as text')
    expect(other, 'a non-link refusal still blamed a link').not.toContain('link')

    // Paired positive on the SAME element class: a note with text really does draw one.
    const read = pane([memoryNote([HIS_NOTES[1]!])])
    expect(read.all('memory-note-text')).toHaveLength(1)
    expect(read.all('memory-note-unread')).toHaveLength(0)
  })

  it('🔴 733 · a note that is a link to NOTHING says so — not that it vanished, and not a raw code', () => {
    // ⚑ The row follows links since `733`, so a link whose far end is gone reads `dangling-link`
    // (`memory-notes.ts`). ⛔ On `main` this word had no sentence and was printed as itself.
    const dangling: MemoryNoteSeen = {
      path: `${NOTES_DIR}/2026-09-04T00-05-00-dangling.md`,
      unread: 'dangling-link',
    }
    const said = pane([memoryNote([dangling])]).q('memory-note-unread').textContent ?? ''
    expect(said).toContain('a link with nothing at the other end')
    expect(said).not.toContain('dangling-link')
    expect(said, 'a link to nothing read as a note that vanished').not.toContain('gone again')
  })

  it('says a note was cut, and only when it was', () => {
    const cut: MemoryNoteSeen = {
      path: `${NOTES_DIR}/2026-09-04T00-03-00-long.md`,
      bytes: 9_000,
      text: 'x'.repeat(4096),
      truncated: true,
    }
    expect(pane([memoryNote([cut])]).q('memory-note-truncated').textContent).toContain('Cut at')
    expect(pane([memoryNote([HIS_NOTES[1]!])]).all('memory-note-truncated')).toHaveLength(0)
  })

  /**
   * ⛔ **The mode a person reads in, which is where this went missing.** `transcript-mode.ts` drops
   * `info` notices in `normal`, which is why this is its own item kind and not a notice.
   */
  it('is on screen in the reading mode, not only in debug', () => {
    expect(pane([memoryNote(HIS_NOTES)], { mode: 'normal' }).all('memory-note')).toHaveLength(1)
    expect(pane([memoryNote(HIS_NOTES)], { mode: 'debug' }).all('memory-note')).toHaveLength(1)
  })

  it('a conversation with no memory note draws no such row', () => {
    const view = pane([{ type: 'user_turn', text: 'hello' }])
    expect(view.all('memory-note')).toHaveLength(0)
    // 193: paired with a positive about the same screen, so this cannot pass over a dead mount.
    expect(view.q('reading-surface')).toBeTruthy()
  })
})

describe('318 §2.3 · the panel is one gesture away from the conversation', () => {
  it('the row carries a way to the store, and pressing it asks for BOTH halves', async () => {
    const view = pane([memoryNote(HIS_NOTES)])
    const link = view.q('memory-note-open-store')
    expect(link.textContent).toContain('Where this profile keeps its memory')

    // ⚑ The pane is the component under test: the emit is what `RuntimeScreen` turns into
    // `drawerOpen = true` and `drawerTab = 'info'`, and a link that raised nothing would look
    // identical on screen.
    const raised: string[] = []
    const listening = mount(
      ConversationPane,
      paneProps({
        record: record([memoryNote(HIS_NOTES)]),
        onShowInstructions: () => raised.push('showInstructions'),
      }),
      { width: 1100, height: 700 },
    )
    listening.q('memory-note-open-store').click()
    await nextTick()
    expect(raised, 'the link raised nothing — the drawer would never open').toEqual([
      'showInstructions',
    ])
  })

  /**
   * ⛔ **A control that cannot do anything is not rendered** (`106`, and found reviewing this diff).
   * `TranscriptView` defaults `canOpenStore` to false, so the same transcript drawn by a surface
   * with no drawer — `ReadingPane`, for an imported conversation — shows no button at all.
   */
  it('is absent on a surface that has nowhere to send the request', () => {
    const view = mount(
      TranscriptView,
      {
        items: record([memoryNote(HIS_NOTES)]).transcript.items,
        mode: 'normal',
        hasOlder: false,
        turnAligned: true,
      },
      { width: 900, height: 500 },
    )
    expect(view.all('memory-note'), 'the row itself vanished').toHaveLength(1)
    expect(view.all('memory-note-open-store')).toHaveLength(0)
  })

  it('the link is a real, clickable control rather than styled text', () => {
    const link = pane([memoryNote(HIS_NOTES)]).q('memory-note-open-store')
    expect(link.tagName).toBe('BUTTON')
    expect(link.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(getComputedStyle(link).cursor).toBe('pointer')
  })
})

describe('318 §2.2 · the panel says what it is not', () => {
  const withStore = {
    injected: [],
    provider: [],
    refused: [],
    note: '',
    agentMemory: [
      {
        kind: 'agent-memory-note' as const,
        path: `${NOTES_DIR}/2026-09-04T00-00-00-user-name.md`,
        text: "The user's name is Bob.",
        bytes: 23,
        truncated: false,
        reach: 'on-request' as const,
      },
    ],
  }

  /**
   * ⚑ **583 moved this whole block onto a tab, and that is the only thing that moved.**
   *
   * ⛔ **`HO-073` §4 regrouped the sheet BY WHOSE, as a tab strip where only ONE tab is in the DOM
   * at a time.** `memory-store-not-a-reading` now renders under `told-tab-learned` —
   * `WHOSE_LAYER['agent-store'] = 'learned'` in `shared/whose-text.ts` puts the agent's own memory
   * there, same as it always claimed to be the agent's. ⚠️ **The fixture's `agentMemory` entry also
   * means `learned` is never the LANDING tab here**: `configured` is drawn empty ahead of it in
   * `WHOSE_TEXT` order, so every test below presses the tab and awaits the render before it looks
   * — the sentence, and the claim it makes, are exactly what they were.
   */
  it('says the store is not a reading, once, where the store is', async () => {
    const view = mount(SessionInstructions, { instructions: withStore }, { width: 380 })
    view.q('told-tab-learned').click()
    await nextTick()
    const said = view.q('memory-store-not-a-reading').textContent ?? ''
    expect(said).toContain('which of these the agent has actually looked up')
    // ⛔ **It is about LOOKING UP, not about reaching the model.** A row in the same block can say
    // the provider put a file in the prompt, and a blanket "not what the agent has read" would have
    // contradicted it two lines down — found reviewing this diff.
    expect(said, 'the sentence contradicts the prompt-reach row above it').not.toContain('has read')
    expect(view.all('memory-store-not-a-reading')).toHaveLength(1)
  })

  /**
   * ⛔ **317's rule, which 318 must not break**: no string a person reads on this panel names a
   * provider. The sentence added here is the first new user-visible text on it since that rule
   * landed, and it is the obvious place to have broken it.
   *
   * ⚑ **583 · same tab move as the test above.** The sentence still lives where `agent-store` does
   * — `learned` — so this presses `told-tab-learned` before reading it; the claim (no provider
   * named) is unchanged by which tab carries the sentence.
   */
  it('names no provider', async () => {
    const view = mount(SessionInstructions, { instructions: withStore }, { width: 380 })
    view.q('told-tab-learned').click()
    await nextTick()
    const said = view.q('memory-store-not-a-reading').textContent!.toLowerCase()
    expect(said).not.toContain('claude')
    expect(said).not.toContain('codex')
  })

  /**
   * ⚑ **583 · both halves of this test live on `learned` now, for two different reasons.**
   *
   * ⛔ **The absence is the same absence** — `agentMemory: []` still means no `agent-store` layer
   * and `memory-store-not-a-reading`'s own `v-if="agentMemory.length > 0"` still keeps it off the
   * page — but with only one tab drawn at a time, checking `.all(...)` from a DIFFERENT tab would
   * pass for the wrong reason (`193`'s rule: a query over an undrawn tab is a query over nothing).
   * So this presses `told-tab-learned` FIRST, making the absence a fact about the sentence again
   * rather than about which page happens to be open.
   *
   * ⚑ **And `CLAUDE.md` moved for a real reason, not a coincidental one**: `profile-memory` is
   * `WHOSE_FILE`'s other `'learned'` entry — *"the AGENT writes this one"* — so the loose injected
   * file this test plants lands on the very tab the sentence above does, and the 193 guard below
   * (*the panel really did render*) is now a guard on the `learned` tab specifically.
   */
  it('is absent when there is no store to be wrong about', async () => {
    const view = mount(
      SessionInstructions,
      {
        instructions: {
          ...withStore,
          agentMemory: [],
          injected: [
            {
              kind: 'profile-memory' as const,
              path: '/homes/claude/CLAUDE.md',
              text: 'hello',
              bytes: 5,
              truncated: false,
            },
          ],
        },
      },
      { width: 380 },
    )
    view.q('told-tab-learned').click()
    await nextTick()
    expect(view.all('memory-store-not-a-reading')).toHaveLength(0)
    // 193: the panel really did render, so the absence above is about the sentence and not the mount.
    expect(view.q('session-instructions').textContent).toContain('CLAUDE.md')
  })
})
