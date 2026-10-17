import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import type { InjectedInstruction, SessionInstructions } from '../../src/shared/runtime-ipc'
import { TOLD_IS_THE_LAST_LAUNCH, TOLD_REMEMBERS_NOTHING } from '../../src/shared/told'
import { mount, toldProps, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **The half of Claude's memory nobody lists** (322, friction log F8) — drawn, in a browser.
 *
 * Listing only `MEMORY.md` hides the rest of a memory store. A measured three-file store
 * contains the index, `brobot-home-is-provider-home.md`, and `user_reviewer_handle.md`; the
 * omitted two files account for 1,954 of 2,159 bytes. A sentence referring to “these” as the
 * store must therefore accompany a complete listing.
 *
 * ⚠️ **A DOM test rather than an SSR render**, for the reason 083 built this harness and 193 keeps
 * restating: an SSR assertion that a string is absent passes over a component that never mounted.
 * Every negative below is paired with a positive about the SAME element.
 *
 * ⛔ **556 · and the pair is a READING, not a presence.** `536` F5 found this file stating the rule
 * at the top and breaking it four tests down — *"TWO NEGATIVES AND A MOUNT"* — and the repair it
 * got named a second element instead of reading one: `not.toBeNull()` on `told-remembers-nothing`
 * is satisfied by an element with no words in it. 🔴 ***A mount is not a reading, and neither is a
 * second querySelector.*** ⚑ Three blocks here now read the sentence they were only counting, and
 * `a-mount-is-not-a-reading.test.ts` is what checks that they keep doing it — **a rule a file
 * states about itself is not a rule anything checks.**
 *
 * ## ⚑ 583 · the same store, on a tab, one row per block of the prompt
 *
 * Only one prompt-owner tab is in the DOM. Press the relevant tab before reading: the agent’s
 * store is on “the agent’s own” (`told-tab-learned`), while the composition sentence and note
 * are on “as sent” (`told-tab-as-sent`).
 *
 * ⚠️ **The hooks moved and the CLAIMS did not.** `injected-<kind>` is now
 * `told-block[data-kind=<kind>]`; `injected-toggle-<kind>` is `told-block-toggle` inside the row;
 * and the two strings the row's `.meta` line used to carry — `LABELS[kind]`, and `REACH_WORDS`'
 * sentence — are behind the row's own press, as `told-block-label` and `memory-reach-says-<reach>`.
 * ⛔ **So the blocks that read them open the row first**, and the strings asserted are the same
 * strings, character for character. ⚑ At rest the row now carries a SHORT reach chip
 * (`memory-reach-<reach>`: *in the prompt* / *on request*) and its byte count, and both are read
 * below as well — 583 added a surface, it did not take one away.
 */

afterEach(unmountAll)

const NOTHING: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

/**
 * ⚑ **The block on its own since `527` §3.1**, rather than the whole drawer on the Info tab. It
 * emitted `<dt>`/`<dd>` fragments into `SessionInfo`'s `<dl>` until this dispatch and had no root
 * of its own to mount — `525`'s named refactor cost, paid by `HO-050` §1.1's split.
 */
function openInfo(instructions: SessionInstructions, over: Record<string, unknown> = {}): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(instructions, over), { width: 760 })
}

/**
 * ⛔ **A fixture whose declared size and whose text agree** — padded to the byte, ASCII filler.
 *
 * 🔴 **583 moved which number the row prints.** It was `bytesLabel(item.bytes)` — the count the
 * main process put on the wire — and it is `layerBytes(block.text)` now, because a row can be one
 * SECTION of the compiled bundle and a file-level `bytes` cannot describe a section of it.
 * ⚑ **The two are the same number on a real read**: `readInstructionFile` returns the bytes it
 * decoded and the text it decoded them into, so a fixture that declared 1,691 bytes over a
 * 35-byte string was describing a read that cannot happen. ⚠️ **Padding it is what keeps §1's
 * arithmetic in the test** — 205 B of 2,159, with 1,954 in the two rows nobody used to list — and
 * the row still goes red if it ever prints the injected bytes (0, on a file the model never got)
 * or nothing at all.
 */
const FILLER = 'and the rest of the file, which nobody here has to read. '

function sized(text: string, bytes: number): string {
  const head = `${text}\n`
  const rest = bytes - new TextEncoder().encode(head).length
  if (rest < 0) throw new Error(`the fixture text is already past ${String(bytes)} bytes`)
  return head + FILLER.repeat(Math.ceil(rest / FILLER.length)).slice(0, rest)
}

/** The store as it really was, paths and byte counts included (§1). */
const INDEX: InjectedInstruction = {
  kind: 'agent-memory',
  path: '/homes/claude/memory/MEMORY.md',
  text: sized('- [Reviewer handle](user_reviewer_handle.md) — who reviews this work', 205),
  bytes: 205,
  truncated: false,
  reach: 'prompt',
}

const TOPICS: InjectedInstruction[] = [
  {
    kind: 'agent-memory-topic',
    path: '/homes/claude/memory/brobot-home-is-provider-home.md',
    text: sized("BroBot's home is the provider home.", 1691),
    bytes: 1691,
    truncated: false,
    reach: 'on-request',
  },
  {
    kind: 'agent-memory-topic',
    path: '/homes/claude/memory/user_reviewer_handle.md',
    text: sized('The reviewer goes by alex-acme.', 263),
    bytes: 263,
    truncated: false,
    reach: 'on-request',
  },
]

const STORE: SessionInstructions = {
  ...NOTHING,
  agentMemory: [INDEX, ...TOPICS],
  recallsReported: false,
  writesReported: false,
  composed: null,
}

/**
 * ⛔ **Press a tab, because only one tab's rows are in the DOM** (583).
 *
 * ⚠️ **Never a default that happens to be right.** The landing tab is the first owner with
 * something in it — `yours`, on every fixture in this file — so a block that read the store
 * without pressing would be reading an empty panel and calling it an absence.
 */
async function press(m: Mounted, key: string): Promise<void> {
  m.q(`told-tab-${key}`).click()
  await nextTick()
}

/** Every row of one kind on the tab that is showing — `injected-<kind>`'s replacement. */
const rowsOf = (m: Mounted, kind: string): HTMLElement[] => [
  ...m.host.querySelectorAll<HTMLElement>(`[data-cy="told-block"][data-kind="${kind}"]`),
]

/** Every row of the agent's store, whichever of the three memory kinds it is. */
const memoryRows = (m: Mounted): HTMLElement[] => [
  ...m.host.querySelectorAll<HTMLElement>('[data-cy="told-block"][data-kind^="agent-memory"]'),
]

/** The press that turns a NAME into the path, the label, the reach sentence and the text. */
async function openRow(row: HTMLElement): Promise<void> {
  row.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')!.click()
  await nextTick()
}

/** One hook's words, inside ONE row — so a neighbouring row can never satisfy an assertion. */
const inRow = (row: HTMLElement, cy: string): string =>
  row.querySelector(`[data-cy="${cy}"]`)?.textContent?.trim() ?? ''

/** `LABELS[kind]`, which 583 moved from the resting `.meta` line to behind the row's press. */
const labelOf = (row: HTMLElement): string => inRow(row, 'told-block-label')

/** `REACH_WORDS[reach]` — the sentence, behind the press. The reach is named, never inferred. */
const reachSays = (row: HTMLElement, reach: string): string =>
  inRow(row, `memory-reach-says-${reach}`)

/** `REACH_CHIP[reach]` — the short form 583 put on the CLOSED row. */
const reachChip = (row: HTMLElement, reach: string): string => inRow(row, `memory-reach-${reach}`)

describe('the whole store on the panel (322)', () => {
  it('🔴 draws a row per file — three files, three rows, at their real paths', async () => {
    const m = openInfo(STORE)
    await press(m, 'learned')

    const rows = memoryRows(m)
    expect(rows, 'the store drew no rows at all').toHaveLength(3)

    // ⚑ **583 · a row is NAMED by its basename at rest and carries its real path when opened.**
    // ⛔ The claim is unchanged — three files, three rows, each at the path it was read from — and
    // the path is rule 1 of this panel (`086`), kept rather than dropped: it is one press away.
    expect(rows[0]?.textContent).toContain('MEMORY.md')
    expect(rows[1]?.textContent).toContain('brobot-home-is-provider-home.md')
    expect(rows[2]?.textContent).toContain('user_reviewer_handle.md')

    for (const row of rows) await openRow(row)
    expect(rows[0]?.textContent).toContain('/homes/claude/memory/MEMORY.md')
    expect(rows[1]?.textContent).toContain('/homes/claude/memory/brobot-home-is-provider-home.md')
    expect(rows[2]?.textContent).toContain('/homes/claude/memory/user_reviewer_handle.md')
  })

  it('⛔ the index says it is in the prompt and a memory says it is not', async () => {
    const m = openInfo(STORE)
    await press(m, 'learned')

    const index = rowsOf(m, 'agent-memory')[0]!
    const topic = rowsOf(m, 'agent-memory-topic')[0]!

    // ⚑ **583 · the distinction is on the row twice now**, and both halves are read here: the
    // short chip a person sees without asking, and the sentence behind the press.
    expect(reachChip(index, 'prompt')).toBe('in the prompt')
    expect(reachChip(topic, 'on-request')).toBe('on request')

    await openRow(index)
    await openRow(topic)
    expect(reachSays(index, 'prompt')).toContain('put this in the prompt')
    // ⚑ The positive that makes the negative beside it a measurement rather than a typo.
    expect(reachSays(topic, 'on-request')).toContain('only if it chooses to')
    expect(reachSays(topic, 'on-request')).not.toContain('put this in the prompt')
  })

  it('⚑ …and it is labelled as one memory the agent filed, not as a note somebody asked for', async () => {
    // ⛔ 086: two doors, two provenances. *"a note the agent was asked to write"* is Codex's
    // `memories__add_ad_hoc_note` exactly, and it is false of a file this provider tells the model
    // to write unprompted — so reusing that row would have cost F4 the word that made it F4's.
    //
    // ⚠️ **583 moved `LABELS[kind]` behind the row's press** (`told-block-label`), because the tab
    // above already says whose the row is and this says WHICH of that owner's things it is. ⛔ The
    // two strings compared are the two strings that were compared before.
    const m = openInfo(STORE)
    await press(m, 'learned')

    const index = rowsOf(m, 'agent-memory')[0]!
    const topic = rowsOf(m, 'agent-memory-topic')[0]!
    await openRow(index)
    await openRow(topic)

    expect(labelOf(topic)).toContain('one memory the agent filed, in its own file')
    expect(labelOf(topic)).not.toContain('asked to write')
    // …and the index row is still the one that says the provider loads it.
    expect(labelOf(index)).toContain('loaded by the provider')
  })

  it('⚠️ names no provider, on any row — 317’s rule, and a real path may still contain one', async () => {
    const m = openInfo(STORE)
    await press(m, 'learned')

    // ⛔ **583 · every row OPENED, because the words this rule is about are behind the press.**
    // ⚑ The scan is wider than the `.meta` join it replaces — the whole tab, labels, paths, reach
    // sentences and text — which is what *"on any row"* asks for.
    for (const row of memoryRows(m)) await openRow(row)

    const panel = m.q('session-instructions').textContent ?? ''
    expect(panel, 'the panel rendered nothing to check').toContain('agent memory')
    for (const name of ['Claude', 'Codex']) expect(panel).not.toContain(name)
  })

  it('⛔ the bytes are the FILE’s, so the two invisible ones are visibly the bulk of the store', async () => {
    // ⚑ §1's whole complaint in one number: the row that was listed is 205 B of 2,159.
    //
    // ⚠️ **583 · the number is measured off the row's own text now** — see {@link sized}, which is
    // why the fixture's `text` is padded to the `bytes` it declares. ⛔ The claim is the one that
    // was made before: the size on a memory row is the size of the FILE, so a memory the model was
    // never given still shows its real weight and the two of them are visibly most of the store.
    const m = openInfo(STORE)
    await press(m, 'learned')

    expect(rowsOf(m, 'agent-memory')[0]?.textContent).toContain('205 B')
    const topics = rowsOf(m, 'agent-memory-topic')
    expect(topics, 'the two invisible files drew no row').toHaveLength(2)
    expect(topics[0]?.textContent).toContain('1.7 KB')
    expect(topics[1]?.textContent).toContain('263 B')
  })

  it('⛔ a profile with only an index draws exactly what it drew before — §4’s rule', async () => {
    const m = openInfo({ ...NOTHING, agentMemory: [INDEX] })
    await press(m, 'learned')

    // ⛔ **556: *exactly what it drew before* is a claim about WORDS**, so the pair reads them —
    // the index's own path and its own byte count, which is what a person recognises the row by.
    // ⚑ `not.toBeNull()` here was true of a row rendered blank.
    const rows = memoryRows(m)
    expect(rows, 'the index drew no row').toHaveLength(1)
    expect(rows[0]?.textContent).toContain('205 B')
    await openRow(rows[0]!)
    expect(rows[0]?.textContent).toContain('/homes/claude/memory/MEMORY.md')
    // ⚠️ The paired negative: no empty heading, no "none", no topic row at all.
    expect(rowsOf(m, 'agent-memory-topic')).toHaveLength(0)
  })

  it('⚑ …and a session with no memory at all still renders no block', async () => {
    const m = openInfo(NOTHING)

    // 🔴 **583 · rule 2 is per OWNER now, and the tab strip is where a person sees it.** ⛔ The
    // panel used to vanish whole — `data-cy="session-instructions"` was gated on one `anything`
    // boolean — and it is the tabpanel now, so it is always in the tree. ⚑ **What replaced that
    // absence is {@link WhoseGroup.drawn}**: an owner with nothing in it is not a tab, which is
    // *"nothing where nothing was injected"* stated once per owner instead of once per panel.
    expect(m.all('told-tab-factory')).toHaveLength(0)
    expect(m.all('told-tab-dynamic')).toHaveLength(0)
    expect(m.all('told-tab-the-place')).toHaveLength(0)

    await press(m, 'learned')
    // …and no row under the one owner tab that is always drawn.
    expect(memoryRows(m)).toHaveLength(0)
    // ⚑ **442 · §4's rule reaches the layer list too**: no memory row and no memory LAYER…
    expect(m.host.querySelector('[data-cy="told-layer-agent-store"]')).toBeNull()
    // 🔴 **And since `536`, the absence is a SENTENCE and not a silence.** ⛔ Every negative in
    // this file is paired with a positive about the same element, and until `536` this one had
    // only the mount: three assertions saying *nothing is drawn* and nothing saying what a person
    // reads instead. ⚠️ **That is the state a fresh identity is in**, so it was the common case
    // that had no words — see `the-memory-a-fresh-identity-does-not-have.dom.test.ts`.
    //
    // ⛔ **556 · and `536`'s repair was still not a reading.** `not.toBeNull()` names a second
    // element; it does not say one word is on it, and an empty `<div data-cy="…">` satisfies it.
    // ⚑ **The sentence, by its exported name** (standing rule 5), so a copy edit moves both ends
    // together and a blank row cannot pass as an absence that was told. ⚠️ **583 keeps it on the
    // SAME surface as the absences above** — it is the learned tab's own sentence.
    expect(m.host.querySelector('[data-cy="told-remembers-nothing"]')?.textContent?.trim()).toBe(
      TOLD_REMEMBERS_NOTHING,
    )

    // ⚑ **Re-aimed at `527`**: the pair has to be on the SAME surface as the absence, and the
    // composition block is the one thing this component draws unconditionally (`442`).
    // ⛔ **556: and it is read rather than counted.**
    // ⚠️ **583 moved that block to the `as sent` tab**, which is the one tab that is drawn for
    // every conversation whatever it holds — so it is still the unconditional surface, one press
    // further on, and the sentence asserted is the same exported constant.
    await press(m, 'as-sent')
    expect(m.host.querySelector('[data-cy="told-sentence"]')?.textContent?.trim()).toBe(
      TOLD_IS_THE_LAST_LAUNCH,
    )
  })

  it('🔴 a memory’s TEXT is behind a click — the paths are the disclosure', async () => {
    const m = openInfo(STORE)
    await press(m, 'learned')

    expect(m.host.textContent).not.toContain('The reviewer goes by alex-acme')
    const topics = rowsOf(m, 'agent-memory-topic')
    expect(topics.length, 'no topic row to open').toBe(2)
    await openRow(topics[1]!)
    expect(m.host.textContent).toContain('The reviewer goes by alex-acme')
  })

  it('⛔ 318’s sentence still stands under the whole store, and still opens no door here', async () => {
    // ⚠️ It reads *"Nothing **here** says which of these the agent has actually looked up"* — and
    // *these* is now the store rather than one file in it, which is what 322 makes true. ⛔ The
    // second clause stays behind `recallsReported`: this provider publishes no citation, and a
    // promise of a row that never comes is 308's defect on 308's surface.
    //
    // ⚑ **583 · the sentence sits under the store's own rows, on the `learned` tab** — the same
    // words under the same list, one press in.
    const m = openInfo(STORE)
    await press(m, 'learned')

    // ⛔ **556: *318's sentence still stands* is a claim about the SENTENCE**, and this block
    // counted its carrier for two dispatches without ever reading a word of it. ⚑ The clause
    // quoted in the comment above is the one asserted, so the two cannot drift apart.
    expect(m.host.querySelector('[data-cy="memory-store-not-a-reading"]')?.textContent).toContain(
      'Nothing here says which of these the agent has actually looked up',
    )
    expect(m.host.querySelector('[data-cy="memory-store-recall-is-shown"]')).toBeNull()
  })

  it('⚑ …and the door DOES open for a provider that reports one — the control', async () => {
    const m = openInfo({ ...STORE, recallsReported: true })
    await press(m, 'learned')

    expect(m.host.querySelector('[data-cy="memory-store-recall-is-shown"]')).not.toBeNull()
    // ⚑ **583 · and it is read, not counted** — the same tier this file's own rule asks for, on
    // the control as well as on the absence it controls.
    expect(m.q('memory-store-recall-is-shown').textContent).toContain(
      'When it does look one up, it says so in the conversation, where it happened.',
    )
  })

  it('⚠️ the sentence under the rows says what the index IS, and names no file it points at', async () => {
    const m = openInfo({
      ...STORE,
      note:
        'Read at launch and appended as text; searched 2 directories. ' +
        'MEMORY.md in /homes/claude/memory is an index the provider puts in front of the model; ' +
        'the memories it points at are separate files beside it, which the agent reads only if it ' +
        'chooses to.',
    })

    // ⚑ **Behind the block's own disclosure since 356**, and the press is the change: this note
    // explains a mechanism rather than naming a file, so 356 §1 moved it one press away instead of
    // leaving it on the panel unasked. ⛔ The negative below still runs against the OPENED fold —
    // reading it closed would make `not.toContain` pass over an empty string.
    //
    // ⚠️ **583 put the fold on the `as sent` tab**, with the rest of the account of the prompt —
    // so the press is now two: the tab, then `instructions-why`.
    await press(m, 'as-sent')
    m.q('instructions-why').click()
    await nextTick()

    const note = m.host.querySelector('[data-cy="instructions-note"]')?.textContent ?? ''
    expect(note).toContain('is an index the provider puts in front of the model')
    // ⛔ §3.2: the pairing is prose the model wrote, and nothing parses it into a table.
    expect(note).not.toContain('user_reviewer_handle.md')
  })
})
