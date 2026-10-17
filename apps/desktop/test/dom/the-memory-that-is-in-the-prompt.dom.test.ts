import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { isVisibleIn } from '../../src/renderer/src/lib/transcript-mode'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

/**
 * 332 · 🔴 **The memory that was in the prompt before the first message, drawn in a browser.**
 *
 * An answer to “what is my name?” can use the memory index already present in the system
 * prompt, without reading a file or making a tool call. The UI must disclose that prompt
 * memory is in play instead of implying that an empty recall list means no memory was used.
 *
 * ⚠️ **A DOM test rather than an SSR render** (193, and §3 of the dispatch by name): an SSR
 * assertion that a string is absent passes over a component that never mounted, and the sharpest
 * assertions here are absences — no count at zero, no button where nothing can act on it, and no
 * verb the agent is the subject of. ⛔ **Every negative is paired with a positive about the SAME
 * element.**
 */

afterEach(unmountAll)

const STORE =
  '/Users/x/Library/Application Support/brobot2/provider-homes/default/mem-2/claude/memory'
const INDEX = `${STORE}/MEMORY.md`

/**
 * ⛔ **Declared, never cast.** `as TranscriptEvent` on these literals would suppress the
 * excess-property check, and a mistyped field would then produce a fixture the component cannot
 * draw and a suite that agrees with itself about nothing (`a-spread-writes-past-a-declared-type`).
 */
const launch = (beside: number, index = INDEX): TranscriptEvent => ({
  type: 'memory_loaded',
  index,
  beside,
})

const HIS_LAUNCH: TranscriptEvent[] = [
  launch(3),
  { type: 'user_turn', text: 'what is my role?' },
  { type: 'assistant_message', text: 'Your role is the person running this workspace.' },
]

function pane(events: TranscriptEvent[], over: Record<string, unknown> = {}) {
  return mount(ConversationPane, paneProps({ record: record(events), ...over }), {
    width: 1100,
    height: 700,
  })
}

describe('332 §2 · the sentence, on the screen it was missing from', () => {
  it('🔴 says the conversation opened with this profile’s memory index in the prompt', () => {
    const view = pane(HIS_LAUNCH)

    expect(view.q('memory-loaded-heading').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'This conversation opened with this profile’s memory index in the prompt',
    )
  })

  it('⛔ says the reading was OURS, and that nothing here is a tool call', () => {
    // 332 §2.2 — `MemoryNoteEntry`'s honesty, matched rather than a second vocabulary invented.
    // ⚑ **601 re-aimed the first clause**: this line is now OUR act only, and the provider's moved
    // to a line of its own above it (asserted next). The sentence still names the disk read and
    // still refuses the provider's voice.
    const said = pane(HIS_LAUNCH).q('memory-loaded-provenance').textContent?.replace(/\s+/g, ' ')

    // ⛔ **BOTH acts, because the row rests on both** — the index was READ (that is how the path
    // is known) and the store was LISTED (that is where `beside` comes from). The contract says
    // *"this app looked at a directory and says so"* and for one commit no visible sentence did.
    expect(said).toContain('This app looked at that store as this session was launched')
    expect(said).toContain('it read this index and listed what sits beside it')
    expect(said).toContain('Nothing here is a tool call')
  })

  it('🔴 601 §4.1 · names the PROVIDER as the one that loaded it, and this app as not', () => {
    // ⛔ **The whole point of the dispatch**: before this, *who* was a clause in the middle of the
    // faint line. ⚑ The paired positive and negative are about the SAME act — the provider put the
    // file in the prompt, and this app did not.
    const by = pane(HIS_LAUNCH).q('memory-loaded-by').textContent?.replace(/\s+/g, ' ') ?? ''

    // ⛔ **The clause is asserted WHOLE, including `before the first message`** — review found the
    // old assertion stopped one character short of the only temporal bound on the provider's act,
    // so a sweep that deleted it would have gone unnoticed.
    // ⚑ **And the wording is the PANEL's**, word for word (`instructions.ts`: *"an index the
    // provider puts in front of the model"*) — the contract's *"this row does not re-decide it"*
    // is a promise about vocabulary, and a second phrasing for one fact is how a reader comes to
    // believe there are two.
    expect(by).toContain(
      'The provider puts this file in front of the model itself, before the first message',
    )
    expect(by).toContain('This app did not put it there')
  })

  it('⛔ 601 §5 · says this app does not see the prompt — no clause implies it checked one', () => {
    // ⚠️ **The LIMIT, asserted as copy rather than left to a docblock** (rule 5: a safety sentence
    // with no test is a comment). ⚑ Paired with the reading above: the row states the limit AND
    // still states the fact, which is what stops it reading as a refusal to answer.
    const row = pane(HIS_LAUNCH).q('memory-loaded').textContent?.replace(/\s+/g, ' ') ?? ''

    expect(row).toContain('does not see the prompt the provider builds')
    // ⛔ **Widened after review.** The needles used to be `we checked` / `confirmed the prompt`,
    // and the table's OWN model of this defect plants *"has checked"* — which matched none of
    // them. ⚑ The rule is *verified, checked or bounded*, so the sweep is now the rule's own
    // words, and `601 M8` plants one WITHOUT removing the positive above, so this loop is killed
    // by a row of its own (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
    for (const checked of ['verified', 'checked', 'validated', 'confirmed', 'bounded']) {
      expect(row.toLowerCase()).not.toContain(checked)
    }
  })

  it('🔴 601 §4.1 · is drawn at the row’s CONTENT weight, not the note’s — 593’s footnote cost', () => {
    // ⛔ **The claim §4.1 makes is about WEIGHT, so the assertion is about the resolved colour** —
    // a string test cannot tell a stated fact from fine print. ⚑ **Derived, never a hex**: the
    // provider line must match the colour this row states its other FACT in (`ml-beside`), and
    // must differ from the colour of the note ABOUT the row (`ml-sub`). A token rename moves all
    // three together and this still means what it says.
    const view = pane(HIS_LAUNCH)
    const ink = (cy: string): string => getComputedStyle(view.q(cy)).color

    expect(ink('memory-loaded-by')).toBe(ink('memory-loaded-beside'))
    expect(ink('memory-loaded-by')).not.toBe(ink('memory-loaded-provenance'))
  })

  it('⛔ claims NO reading by the agent, anywhere on the row — 319 §3 is not reopened', () => {
    // ⚠️ **The whole row, not one element**, because the hazard is a word leaking in anywhere. ⚑ The
    // paired positive is the one permitted appearance of the agent as a subject: it *may* choose to.
    const row = pane(HIS_LAUNCH).q('memory-loaded').textContent ?? ''

    expect(row).toContain('the agent reads only if it chooses to')
    for (const claim of ['recalled', 'looked up', 'the agent read this', 'cited', 'searched']) {
      expect(row.toLowerCase()).not.toContain(claim)
    }
  })

  it('⚑ names WHICH store — the whole path, selectable, and the directory beside the filename', () => {
    const view = pane(HIS_LAUNCH)

    // The record: the whole path, on its own element, exactly as stored.
    expect(view.q('memory-loaded-path').textContent?.trim()).toBe(INDEX)
    // ⛔ **And the readable line, asserted SEPARATELY** — on the whole row this passed with the
    // directory line deleted, because the path element contains it too (found by M22 surviving).
    // ⚠️ The two spans are separated by a flex `gap`, not by whitespace, so `textContent` runs them
    // together — asserted as the two facts it holds rather than as one string that looks wrong.
    const name = view.q('memory-loaded-name').textContent?.replace(/\s+/g, ' ').trim() ?? ''
    expect(name.startsWith('MEMORY.md')).toBe(true)
    expect(name).toContain(`in ${STORE}`)
  })
})

describe('332 §2.4 · what it says about the memories beside the index', () => {
  it('🔴 counts them, and says the agent reads one only if it chooses to (322’s words)', () => {
    const said = pane([launch(3)])
      .q('memory-loaded-beside')
      .textContent?.replace(/\s+/g, ' ')

    // ⚑ **601 §4.3, the half that needed no new fact**: the count is PAST and is attributed to the
    // act it was taken during. ⛔ *"3 memories sit"* read as a claim about now, on a row a person
    // may open a week later — and the phantom this dispatch came from was exactly a count nobody
    // could scope. ⚠️ The clock itself is not here; see the component's docblock.
    // ⛔ **A WINDOW, not a moment.** The row draws `item.at` in its header and that stamp is the
    // APPEND, not the look — so a phrase naming an instant would hand a reader the wrong number to
    // bind it to. *As this session was launched* contains both acts, which is
    // `MemoryNoteEntry`'s *"between the start and the end of this turn"* device.
    expect(said).toContain('3 memories sat beside it in this store as this session was launched')
    expect(said).not.toContain('when this app looked')
    expect(said).toContain('which the agent reads only if it chooses to')
  })

  it('⚠️ one memory is singular', () => {
    expect(pane([launch(1)]).q('memory-loaded-beside').textContent).toContain('1 memory sat')
  })

  it('⛔ an index with NOTHING beside it draws no count clause — and still draws the row', () => {
    // 317's empty state as noise: *"0 memories"* is a number rendered as news. ⚑ The paired positive
    // is on the same mount — the row is there, the launch fact is still true and still stated.
    const view = pane([launch(0)])

    expect(view.all('memory-loaded'), 'the row itself vanished').toHaveLength(1)
    expect(view.q('memory-loaded').textContent).toContain('memory index in the prompt')
    // ⚑ **601 §6.4 · the sentence that must survive an empty store.** The count clause is the only
    // thing `beside: 0` removes; who loaded the file is true of every store and `.ml-by` carries
    // no `v-if`, so the zero state is asserted to still SAY it rather than merely to draw a row.
    expect(view.q('memory-loaded-by').textContent).toContain('The provider puts this file')
    expect(view.all('memory-loaded-beside')).toHaveLength(0)
  })
})

describe('332 §2.3 · the door is the one that already exists', () => {
  it('carries a way to the store, and pressing it asks for the drawer', async () => {
    const view = pane([launch(3)])
    expect(view.q('memory-loaded-open-store').textContent).toContain(
      'Where this profile keeps its memory',
    )

    const raised: string[] = []
    const listening = mount(
      ConversationPane,
      paneProps({ record: record([launch(3)]), onShowInstructions: () => raised.push('shown') }),
      { width: 1100, height: 700 },
    )
    listening.q('memory-loaded-open-store').click()
    await nextTick()
    expect(raised, 'the link raised nothing — the drawer would never open').toEqual(['shown'])
  })

  it('⛔ is absent on a surface with nowhere to send the request (106)', () => {
    // `ReadingPane` draws the same transcript for an IMPORTED conversation and has no drawer.
    const view = mount(
      TranscriptView,
      {
        items: record([launch(3)]).transcript.items,
        mode: 'normal',
        hasOlder: false,
        turnAligned: true,
      },
      { width: 900, height: 500 },
    )

    expect(view.all('memory-loaded'), 'the row itself vanished').toHaveLength(1)
    // ⛔ **556: counting the row is not reading it.** The row's own heading is what tells a person
    // this conversation opened with the index in its prompt; the press is absent BESIDE it, which
    // is `106`, and a row rendered empty would satisfy the count alone.
    expect(view.q('memory-loaded-heading').textContent).toContain('memory index in the prompt')
    expect(view.all('memory-loaded-open-store')).toHaveLength(0)
  })
})

describe('332 · where the row is, and where it is not', () => {
  it('🔴 is the FIRST thing in the conversation, above the message it explains', () => {
    const view = pane(HIS_LAUNCH)
    const drawn = [
      ...view.host.querySelectorAll('[data-cy="memory-loaded"], [data-cy="user-message"]'),
    ]

    expect(drawn.length, 'neither row drew — this would pass over nothing').toBe(2)
    expect(drawn[0]?.getAttribute('data-cy')).toBe('memory-loaded')
  })

  it('⛔ is shown in BOTH modes — a row only debug reveals is a row he would not have found', () => {
    const items = record([launch(3)]).transcript.items

    expect(items).toHaveLength(1)
    for (const mode of ['normal', 'debug'] as const) {
      expect(items.filter((item) => isVisibleIn(mode, item))).toHaveLength(1)
    }
  })

  it('⚑ …and it really is drawn in the reading view, not only kept by the filter', () => {
    const view = pane(HIS_LAUNCH, { mode: 'normal' })

    expect(view.all('memory-loaded')).toHaveLength(1)
    expect(view.q('reading-surface')).toBeTruthy()
  })

  it('⛔ a replayed row whose path did not survive the bound draws NOTHING', () => {
    // The fold's guard, seen from the screen: `boundStoredEvent` empties a path it cannot carry, and
    // a row claiming memory is in the prompt while naming no file is `106`. ⚑ The control is the
    // same mount with a path — one row — so this is a guard rather than a component that never drew.
    expect(pane([launch(3, '')]).all('memory-loaded')).toHaveLength(0)
    // ⛔ **556: the control is read, not counted** — and it is a SECOND mount, which is the weaker
    // pairing this file's own rule warns about. A row that drew its heading is what proves the
    // guard above removed something a person would otherwise have been reading.
    expect(pane([launch(3)]).q('memory-loaded-heading').textContent).toContain(
      'memory index in the prompt',
    )
  })
})
