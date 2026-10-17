import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import type { SessionInstructions, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, toldProps, unmountAll, type Mounted } from './harness'

/**
 * 330 · 🔴 **A memory write that read as an ordinary file, drawn in a browser.**
 *
 * A Bash or Write row can record a memory write correctly while hiding its meaning: “memory”
 * lies inside a 90-character path whose end is cut. Label the memory action explicitly so the
 * person need not infer it from a truncated file path.
 *
 * ⚠️ **A DOM test rather than an SSR render** (193, and §5 of the dispatch by name): an SSR assertion
 * that a string is absent passes over a component that never mounted, and half of what is asserted
 * here is an absence. ⛔ **Every negative below is paired with a positive about the SAME element.**
 */

afterEach(unmountAll)

const STORE =
  '/Users/x/Library/Application Support/brobot2/provider-homes/default/mem-2/claude/memory'

/**
 * Use the measured event shapes in order: `Bash ls`, then two `Write` calls. Add the memory
 * label only to rows that earn it.
 */
/**
 * ⛔ **Declared, never cast.** A `as TranscriptEvent` on these literals would suppress the
 * excess-property check, and then a mistyped `memoryPath` would produce a fixture with no label, a
 * component with nothing to draw, and a suite that agrees with itself about nothing — which is the
 * shape `a-spread-writes-past-a-declared-type` describes. The type has the field; let it check.
 */
const CAPTURE: TranscriptEvent[] = [
  { type: 'tool_call', id: 't1', name: 'Bash', summary: `ls "${STORE}/" 2>/dev/null` },
  {
    type: 'tool_call',
    id: 't2',
    name: 'Write',
    summary: `${STORE}/user_name.md`,
    memoryPath: 'user_name.md',
  },
  {
    type: 'tool_call',
    id: 't3',
    name: 'Write',
    summary: `${STORE}/MEMORY.md`,
    memoryPath: 'MEMORY.md',
  },
]

/** ⛔ The SAME three rows with the label withheld — the world before this dispatch. */
const UNLABELLED: TranscriptEvent[] = CAPTURE.map((event) => {
  const row = { ...(event as Extract<TranscriptEvent, { type: 'tool_call' }>) }
  delete row.memoryPath
  return row
})

function pane(events: TranscriptEvent[]): Mounted {
  return mount(ConversationPane, paneProps({ record: record(events) }), { width: 1200 })
}

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
function openInfo(instructions: SessionInstructions): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(instructions), { width: 760 })
}

/**
 * 🔴 **583 · the tab the memory-store sentences moved BEHIND** (`HO-073` §4). `WHOSE_LAYER` maps
 * `agent-store` to `learned` (`whose-text.ts`), and `SessionInstructions.vue` only draws
 * `memory-store-not-a-reading` / `-recall-is-shown` / `-write-is-shown` inside
 * `showing.whose === 'learned'` now — one owner's page is in the DOM at a time, so a mount that
 * used to read these off the sheet directly must press this tab first, exactly the reach
 * `the-memory-a-fresh-identity-does-not-have.dom.test.ts` already takes for the sentence next to
 * these on the same tab (`TOLD_REMEMBERS_NOTHING`).
 */
const LEARNED = 'learned'

/** Press one tab and let the panel re-render — `m.q` throws by name if the tab is not in the strip. */
async function press(m: Mounted, key: string): Promise<void> {
  m.q(`told-tab-${key}`).click()
  await nextTick()
}

describe('330 · the row says what it is', () => {
  it('🔴 both Writes carry the badge; the Bash between them does not', () => {
    const view = pane(CAPTURE)
    // ⛔ **The positive first**: the rows really mounted, so the absence below is an absence.
    expect(view.all('tool-entry')).toHaveLength(3)
    expect(view.all('tool-memory')).toHaveLength(2)
    for (const badge of view.all('tool-memory')) {
      expect(badge.textContent).toContain('this profile’s memory')
    }
  })

  it('⛔ …and the SAME three rows without the field carry no badge at all', () => {
    // ⚠️ §5: *"a positive assertion must differ from the default."* The precondition is driven from
    // the event and nowhere else, so this pair is the whole proof that the badge comes from
    // `memoryPath` rather than from the fixture's paths, its tool names, or the store string.
    const view = pane(UNLABELLED)
    expect(view.all('tool-entry')).toHaveLength(3)
    expect(view.all('tool-memory')).toHaveLength(0)
    // …and the rows still say what they always said.
    expect(view.host.textContent).toContain(`${STORE}/user_name.md`)
  })

  it('🔴 the row LEADS with the filename, which is the segment the old row cut', () => {
    // 330 §3.5: *"A label does not fix that; a label plus the same unreadable path is half a fix."*
    // ⛔ `.tool-summary` is one nowrap line with `text-overflow: ellipsis`, so what is drawn first is
    // what survives — and before this the first 90-odd characters were provider home.
    const view = pane(CAPTURE)
    const paths = view.all('tool-memory-path').map((el) => el.textContent?.trim())
    expect(paths).toEqual(['user_name.md', 'MEMORY.md'])
  })

  it('⚠️ the whole path is still reachable on the row, not traded away for the short one', () => {
    // ⛔ Shortening what is RECORDED would be a different and worse change. The absolute path is on
    // the element's own `title`, so it is still there for a hover and still in the ledger.
    const view = pane(CAPTURE)
    expect(view.all('tool-memory-path')[0]?.getAttribute('title')).toBe(`${STORE}/user_name.md`)
  })

  it('⛔ an ordinary tool row still shows its summary, badge or no badge', () => {
    // The `v-else` branch: a row with no `memoryPath` must render exactly as it did before, and a
    // template that dropped the summary on that branch would pass every assertion above.
    const view = pane(CAPTURE)
    const bash = view.all('tool-entry')[0]
    expect(bash?.textContent).toContain(`ls "${STORE}/"`)
    expect(bash?.querySelector('[data-cy="tool-memory"]')).toBeNull()
  })
})

describe('330 §4 · the panel points at the write', () => {
  it('⛔ says nothing at all when there is no store on screen to say it about', async () => {
    // ⚠️ The sentence lives under the memory rows, so a session with an empty store draws neither
    // clause even with the flag on. This is the mounted control for the two tests below.
    const view = openInfo({ ...NOTHING, agentMemory: [], writesReported: true })
    // 🔴 **583 moved this claim to a tab, and the mounted control moved with it.** `told-sentence`
    // is `WHOSE_TEXT`'s `as-sent` tab now (the composition, not the store) and is no longer on the
    // page these two zeros are about — asserting it here would prove the WRONG tab mounted. ⛔
    // **556: *the mounted control* was exactly that and no more.** A mount is not a reading, so the
    // replacement has to be a sentence THIS tab draws unconditionally: `told-group-says-<whose>` is
    // `WhoseGroup.short`, drawn for every state of a drawn group (`SessionInstructions.vue`'s
    // `v-if="showing"` block), which is `whose-groups.ts`'s own precedent for `learned` never being
    // silently empty — the same repair `the-half-nobody-lists.dom.test.ts` took, and the one
    // `the-memory-a-fresh-identity-does-not-have.dom.test.ts` §2.1 already uses for this exact
    // pairing: *"paired on the TAB the negatives were taken on… the group's own one-line answer,
    // which every drawn group carries."*
    await press(view, LEARNED)
    const control = view.q(`told-group-says-${LEARNED}`)
    expect((control.textContent ?? '').trim().length).toBeGreaterThan(0)
    expect(view.all('memory-store-write-is-shown')).toHaveLength(0)
    expect(view.all('memory-store-not-a-reading')).toHaveLength(0)
  })

  it('⚑ with a store on screen, the write sentence appears only where the provider reports one', async () => {
    const store: SessionInstructions = {
      ...NOTHING,
      agentMemory: [
        {
          kind: 'agent-memory',
          path: `${STORE}/MEMORY.md`,
          text: '- [Name](user_name.md) — his name',
          bytes: 40,
          truncated: false,
          reach: 'prompt',
        },
      ],
    }
    // 🔴 **583: one file in the store draws the `learned` tab with content, but it does not become
    // the LANDING tab** — `firstTab()` picks the first drawn owner in `WHOSE_TEXT` order and
    // `configured` is always drawn, ahead of `learned`. Both mounts below have to press through.
    const off = openInfo(store)
    await press(off, LEARNED)
    expect(off.q('memory-store-not-a-reading')).not.toBeNull()
    expect(off.all('memory-store-write-is-shown')).toHaveLength(0)

    const on = openInfo({ ...store, writesReported: true })
    await press(on, LEARNED)
    expect(on.q('memory-store-write-is-shown').textContent).toContain(
      'the conversation shows the write itself',
    )
  })

  it('⛔ the two clauses are independent — 310’s rule, as four combinations', async () => {
    // ⚠️ This app has now measured a provider that reports the READ and not the write, and one that
    // reports the WRITE and not the read. A single flag with three meanings is the defect `310` was
    // dispatched for; these are the four states two facts can be in.
    const store: SessionInstructions = {
      ...NOTHING,
      agentMemory: [
        {
          kind: 'agent-memory',
          path: `${STORE}/MEMORY.md`,
          text: '- [Name](user_name.md)',
          bytes: 22,
          truncated: false,
          reach: 'prompt',
        },
      ],
    }
    // 🔴 **583: both hooks are behind `learned` now**, so the fixture that used to answer from one
    // mount needs a press before it can be read — the four combinations are still four mounts and
    // still the same two counts, one press earlier.
    const seen = async (
      recallsReported: boolean,
      writesReported: boolean,
    ): Promise<[number, number]> => {
      const view = openInfo({ ...store, recallsReported, writesReported })
      await press(view, LEARNED)
      return [
        view.all('memory-store-recall-is-shown').length,
        view.all('memory-store-write-is-shown').length,
      ]
    }
    expect(await seen(false, false)).toEqual([0, 0])
    expect(await seen(true, false)).toEqual([1, 0])
    expect(await seen(false, true)).toEqual([0, 1])
    expect(await seen(true, true)).toEqual([1, 1])
  })
})
