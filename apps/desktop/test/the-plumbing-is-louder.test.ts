import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { RAIL_PERMANENCES } from '../src/shared/refusals'
import { BACKGROUND_WORD } from '../src/renderer/src/lib/background-work'
import {
  TOOL_OUTCOMES,
  TOOL_OUTCOMES_DONE,
  TOOL_OUTCOMES_IN_FLIGHT,
  TOOL_OUTCOME_WORD,
  SAME_WORD,
  didNotPlainlySucceed,
  toolOutcome,
  type ToolOutcome,
} from '../src/renderer/src/lib/tool-outcome'
import {
  NAMES_SPELLED,
  joinsARun,
  runLine,
  transcriptRows,
} from '../src/renderer/src/lib/tool-runs'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **587 · the plumbing is quieter than the agent** — `EXT-013` §3.
 *
 * ## ⚑ What this file asks, and what `dom/the-plumbing-is-louder.dom.test.ts` asks
 *
 * ⛔ **This one asks *what the row SAYS*; that one asks *what a person can SEE*.** The fold, the
 * vocabulary and the line are pure functions over items and can be driven over their whole input
 * space without a browser. ⚠️ **Whether the line is as quiet as `thought · ~434 tokens` is a
 * COMPUTED STYLE question** and no amount of asserting here can answer it.
 *
 * ## 🔴 The hazard this file exists to close, and it is named in the brief
 *
 * ⛔ **`an-unenumerated-state-counts-as-success`.** ⚠️ A collapsed line is the one row a person may
 * never open, so a state it fails to mention is a state that silently reads as *it went fine*.
 * ⚑ §2 drives {@link toolOutcome} over its whole reachable input space and §3 drives
 * {@link runLine} over every outcome it can produce — so the property is *every outcome outside the
 * success set is on the line*, never *the failures I remembered are on the line*.
 *
 * ## ⚠️ No test here names a COUNT of rows in its title (`587` §4.2)
 *
 * ⛔ **`a-title-that-names-a-count-the-assertion-never-checks`.** The property is *a run renders one
 * row*, and it is asserted over runs of 1, 2 and 7 from one derivation rather than stated about
 * seven.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = `${HERE}../src/renderer/src`

/* -------------------------------------------------------------------------------------------- */
/* Fixtures — built through the REAL fold, so the items are the shape the renderer receives.      */
/* -------------------------------------------------------------------------------------------- */

const call = (id: string, name = 'list_profiles', summary = '{}'): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary }) as TranscriptEvent

const back = (id: string, ok = true, over: Record<string, unknown> = {}): TranscriptEvent =>
  ({ type: 'tool_result', id, summary: ok ? 'ok' : 'denied', ok, ...over }) as TranscriptEvent

const REFUSED: TranscriptEvent = {
  type: 'tool_refused',
  tool: 'ask_question',
  rail: 'malformed-request',
  permanence: 'permanent',
  retryable: false,
} as TranscriptEvent

/** ⚑ The fold, at real ordinals, because a row's `ordinal` is what the wrapper carries. */
function fold(events: readonly TranscriptEvent[]): TranscriptItem[] {
  const state = createTranscript()
  events.forEach((event, i) => applyEvent(state, event, 1_700_000_000_000 + i * 10, i + 1))
  return state.items
}

/** A finished call and its receipt, as one pair. */
const settled = (id: string, name?: string): TranscriptEvent[] => [call(id, name), back(id)]

/* -------------------------------------------------------------------------------------------- */

describe('§1 · a run is a span of settled, ordinary tool calls', () => {
  it('renders one row however many calls are in the span', () => {
    // ⚠️ **Three spans from ONE derivation** — the property is *a span is a row*, and a title that
    // said "seven become one" would be a number no assertion checks (`587` §4.2).
    for (const n of [1, 2, 7]) {
      const events = Array.from({ length: n }, (_, i) => settled(`t${i}`)).flat()
      const rows = transcriptRows(fold(events))
      expect(rows, `a span of ${n}`).toHaveLength(1)
      expect(rows[0]!.kind).toBe('run')
      expect(rows[0]!.kind === 'run' && rows[0]!.calls).toHaveLength(n)
    }
  })

  it('drops nothing and reorders nothing', () => {
    // 🔴 **The strongest cheap property this fold has.** Flattening the rows back out must give the
    // input, in order — so no arrangement of members can silently lose one.
    const items = fold([
      ...settled('a'),
      REFUSED,
      ...settled('b'),
      { type: 'assistant_message', text: 'done' } as TranscriptEvent,
      ...settled('c'),
    ])
    const back = transcriptRows(items).flatMap((row) =>
      row.kind === 'run' ? [...row.members] : [row.item],
    )
    expect(back).toEqual(items)
  })

  it('keeps a LIVE call out, and the SAME call settled goes in', () => {
    // ⛔ **The control is the point** (`300`): a row carrying `Stop this command` must not become a
    // line, and a row that once did must join as soon as it is over. Same id, same name, one fact
    // apart — `a-comparison-tested-where-both-sides-agree-measures-nothing`.
    const live = fold([call('t1')])
    const over = fold([call('t1'), back('t1')])
    expect(joinsARun(live[0]!)).toBe(false)
    expect(joinsARun(over[0]!)).toBe(true)
    expect(transcriptRows(live)[0]!.kind).toBe('item')
    expect(transcriptRows(over)[0]!.kind).toBe('run')
  })

  it('keeps a call with sub-agents out, and the same call without them in', () => {
    // ⛔ `029`: *"burying it under the parent row's collapsed output would hide exactly the thing
    // 029 exists to surface."*
    const [plain] = fold(settled('t1')) as [ToolItem]
    const withChild: ToolItem = { ...plain, subAgents: [{ agentId: 'ag_1' } as never] }
    expect(joinsARun(plain)).toBe(true)
    expect(joinsARun(withChild)).toBe(false)
    // ⚠️ An EMPTY array is the plain case, not the excluded one: the fold writes `[]` before a
    // child arrives, and a row excluded on `!== undefined` alone would never collapse again.
    expect(joinsARun({ ...plain, subAgents: [] })).toBe(true)
  })

  it('keeps a call with a workflow out, and the same call without one in', () => {
    const [plain] = fold(settled('t1')) as [ToolItem]
    expect(joinsARun(plain)).toBe(true)
    expect(joinsARun({ ...plain, workflow: { runId: 'wf_1' } as never })).toBe(false)
  })

  it('lets a REFUSAL break the span, and joins the span back up when it is gone', () => {
    // 🔴 **The correction to the brief, asserted in both directions.** A refusal has no call id —
    // `ToolRefusedEvent` carries none — so the fold's own answer is that the row *"lets its POSITION
    // do the rest"*, and position is what a collapse would spend.
    const split = transcriptRows(fold([...settled('a'), REFUSED, ...settled('b')]))
    expect(split.map((row) => row.kind)).toEqual(['run', 'item', 'run'])
    expect(split[1]!.kind === 'item' && split[1]!.item.kind).toBe('notice')

    const joined = transcriptRows(fold([...settled('a'), ...settled('b')]))
    expect(joined.map((row) => row.kind)).toEqual(['run'])
  })

  it('breaks the span on a refusal of EVERY permanence, not just the permanent one', () => {
    // ⚠️ **Driven over the closed vocabulary rather than over the one the PO happened to show.**
    // `RAIL_PERMANENCES` is a list first so it can be walked (`353`'s idiom).
    //
    // ⛔ **What this guards is a BRANCH that does not exist yet, and saying so is the point.**
    // `transcriptRows` never reads `permanence`, so today every member folds to the same notice
    // and the loop is one assertion written three times. ⚑ It is here because *a permanent refusal
    // is worth keeping in place and a transient one is not* is exactly the shortcut somebody will
    // reach for, and this is what makes it a red rather than a judgement call
    // (`a-closed-vocabulary-guards-what-a-member-says`).
    for (const permanence of RAIL_PERMANENCES) {
      const rows = transcriptRows(
        fold([...settled('a'), { ...REFUSED, permanence } as TranscriptEvent, ...settled('b')]),
      )
      expect(
        rows.map((row) => row.kind),
        permanence,
      ).toEqual(['run', 'item', 'run'])
    }
  })
})

describe('§2 · the outcome vocabulary is closed, and walkable', () => {
  /**
   * ⛔ **Every reachable input to {@link toolOutcome}, built rather than listed.**
   *
   * ⚠️ **`backgroundState`'s own six are taken from `BACKGROUND_WORD`'s keys**, which is the table
   * `background-work.test.ts` already walks — so a seventh background state arrives here without
   * anybody editing this file.
   */
  const everyInput = (): ToolItem[] => {
    const base: ToolItem = {
      kind: 'tool',
      id: 'i',
      callId: 'c',
      name: 'n',
      summary: '{}',
      result: null,
    }
    const outcomes = Object.keys(BACKGROUND_WORD).filter(
      (word) => word !== 'running' && word !== 'unfinished',
    )
    return [
      base,
      { ...base, unfinished: true },
      { ...base, result: { summary: 'ok', ok: true } },
      { ...base, result: { summary: 'no', ok: false } },
      { ...base, background: {} },
      { ...base, background: { unfinished: true } },
      // 🔴 **The pair `248` is about, and it was missing from the first draft of this list.** A
      // detached command's receipt lands green while the work runs on — `245` measured 24.5 seconds
      // of it — so an item carrying BOTH must answer `background`, never `done`. Without this row
      // a mutation that read the receipt first would have survived.
      { ...base, background: {}, result: { summary: 'ok', ok: true } },
      ...outcomes.map((outcome) => ({ ...base, background: { outcome } }) as ToolItem),
    ]
  }

  it('reaches every member of the list and nothing outside it', () => {
    const reached = new Set(everyInput().map(toolOutcome))
    expect([...reached].sort()).toEqual([...TOOL_OUTCOMES].sort())
  })

  it('gives each outcome a word, and shares a word only where the app already shares a colour', () => {
    // ⚠️ `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`: a `Record` proves
    // the table is TOTAL and says nothing about two keys sharing a value, which on this line would
    // make two different facts read as one.
    const words = TOOL_OUTCOMES.map((outcome) => TOOL_OUTCOME_WORD[outcome])
    expect(words.filter(Boolean)).toHaveLength(TOOL_OUTCOMES.length)

    // ⛔ **Found by running this, and it is a real collapse rather than a slip**: `error` and
    // `failed` both say *failed*. ⚑ So it is DECLARED — and this asserts the declaration is exactly
    // the set of collisions, in both directions, so a third state joining them is a red.
    const shared = new Map<string, ToolOutcome[]>()
    for (const outcome of TOOL_OUTCOMES) {
      const word = TOOL_OUTCOME_WORD[outcome]
      shared.set(word, [...(shared.get(word) ?? []), outcome])
    }
    const collisions = [...shared.values()].filter((group) => group.length > 1)
    expect(collisions).toEqual(SAME_WORD)

    // ⚑ **And the declaration is not free-standing**: the card paints exactly this pair one colour,
    // so the line collapsing them is the same decision made twice rather than a new one.
    const card = readFileSync(`${RENDERER}/components/ToolEntry.vue`, 'utf8')
    for (const group of SAME_WORD) {
      expect(card, `the card no longer paints ${group.join('/')} alike`).toContain(
        group.map((outcome) => `.status-dot.${outcome}`).join(',\n'),
      )
    }
  })

  it('splits the list into in-flight, plainly done, and everything else — with all three non-empty', () => {
    const amiss = TOOL_OUTCOMES.filter(
      (outcome) =>
        !TOOL_OUTCOMES_IN_FLIGHT.includes(outcome) && !TOOL_OUTCOMES_DONE.includes(outcome),
    )
    // ⛔ **The middle set is what `EXT-013` §3 asks about**: *"if a state exists that is neither
    // success nor refusal, say what your line does with it."* These five are that state.
    expect([...amiss].sort()).toEqual(['error', 'failed', 'stopped', 'unfinished', 'unknown'])
    expect(TOOL_OUTCOMES_IN_FLIGHT.length).toBeGreaterThan(0)
    expect(TOOL_OUTCOMES_DONE.length).toBeGreaterThan(0)
    // ⚠️ And the three sets cover the list with no member in two of them.
    expect(TOOL_OUTCOMES_IN_FLIGHT.length + TOOL_OUTCOMES_DONE.length + amiss.length).toBe(
      TOOL_OUTCOMES.length,
    )
  })

  it('answers didNotPlainlySucceed as the COMPLEMENT, over every input rather than a list', () => {
    for (const item of everyInput()) {
      const outcome = toolOutcome(item)
      const expected =
        !TOOL_OUTCOMES_IN_FLIGHT.includes(outcome) && !TOOL_OUTCOMES_DONE.includes(outcome)
      expect(didNotPlainlySucceed(item), outcome).toBe(expected)
    }
  })
})

describe('§3 · the collapsed line says what happened, and shouts on anything else', () => {
  const run = (...items: ToolItem[]) => runLine(items)
  const one = (over: Partial<ToolItem> = {}): ToolItem => ({
    kind: 'tool',
    id: 'i',
    callId: 'c',
    name: 'list_profiles',
    summary: '{}',
    result: { summary: 'ok', ok: true },
    ...over,
  })

  it('names the single call, and counts several', () => {
    expect(run(one()).head).toBe('list_profiles')
    expect(run(one(), one({ id: 'j' })).head).toBe('2 tool calls')
  })

  it('tallies repeats in first-seen order', () => {
    const line = run(one(), one({ name: 'Read' }), one(), one())
    expect(line.detail).toBe('list_profiles ×3, Read')
  })

  it('says how many names it did not spell rather than eliding them', () => {
    // ⛔ `092`: a cap is never silent. The fixture is built from the cap so it moves with it
    // (`a-bound-written-as-the-constant-cannot-pin-it` — the +2 below is the OVERSHOOT, not the cap).
    const names = Array.from({ length: NAMES_SPELLED + 2 }, (_, i) => one({ name: `tool_${i}` }))
    const line = run(...names)
    expect(line.detail.split(', ')).toHaveLength(NAMES_SPELLED + 1)
    expect(line.detail.endsWith('+2 more')).toBe(true)
  })

  it('stays silent when every call is plainly done', () => {
    expect(run(one(), one({ background: { outcome: 'completed' } })).amiss).toEqual([])
  })

  it('carries a word for EVERY outcome outside the success set — driven over the set', () => {
    // 🔴 **This is the hazard closed.** A tenth outcome added to `TOOL_OUTCOMES` tomorrow arrives in
    // this loop without anybody editing it, and it fails here unless the line says it.
    for (const outcome of TOOL_OUTCOMES) {
      if (TOOL_OUTCOMES_IN_FLIGHT.includes(outcome)) continue
      const item = itemFor(outcome)
      const line = run(item)
      if (TOOL_OUTCOMES_DONE.includes(outcome)) {
        expect(line.amiss, outcome).toEqual([])
      } else {
        expect(line.amiss, outcome).toEqual([TOOL_OUTCOME_WORD[outcome]])
      }
    }
  })

  it('counts the amiss calls when there are several, and never caps them', () => {
    const failed = itemFor('error')
    const line = run(one(), failed, { ...failed, id: 'k' }, itemFor('stopped'))
    expect(line.amiss).toEqual([`2 ${TOOL_OUTCOME_WORD.error}`, `1 ${TOOL_OUTCOME_WORD.stopped}`])
  })

  it('never elides a word it shouted — more kinds of trouble than the NAME cap allows', () => {
    // 🔴 **Written because `587 M7` SURVIVED.** The row caps the amiss words the way the tool names
    // are capped, and every fixture above had fewer kinds of trouble than the cap — so the row
    // changed nothing any assertion could see. ⛔ **A cap on the names is `092` working; a cap on
    // this list hides the one thing on the line a person cannot get any other way.**
    //
    // ⚑ **The run is built from `TOOL_OUTCOMES`, so it grows when the vocabulary does** — and the
    // assertion is stated against `NAMES_SPELLED` rather than against 4, because a fixture written
    // as the constant cannot pin the constant (`a-bound-written-as-the-constant-cannot-pin-it`).
    const settledAmiss = TOOL_OUTCOMES.filter(
      (outcome) =>
        !TOOL_OUTCOMES_IN_FLIGHT.includes(outcome) && !TOOL_OUTCOMES_DONE.includes(outcome),
    )
    const words = new Set(settledAmiss.map((outcome) => TOOL_OUTCOME_WORD[outcome]))
    expect(
      words.size,
      'there are no longer more kinds of trouble than the cap, so this measures nothing',
    ).toBeGreaterThan(NAMES_SPELLED)

    const line = run(...settledAmiss.map(itemFor))
    expect(line.amiss).toHaveLength(words.size)
    expect(line.amiss.some((said) => said.includes('more'))).toBe(false)
  })

  it('keeps `330`’s memory word on the line, and says it only when a call reached the store', () => {
    // Keep the memory badge on the folded row. Putting it only inside the expanded panel
    // hides the meaning behind both a press and the selected tab, leaving memory writes
    // indistinguishable from ordinary tool rows.
    expect(run(one()).memory).toBe(false)
    expect(run(one({ memoryPath: 'notes/today.md' })).memory).toBe(true)
    // ⚠️ **One member is enough**, because the claim is about the RUN: somewhere in here, this
    // agent wrote to its own memory.
    expect(
      run(one(), one({ id: 'j', memoryPath: 'notes/today.md' }), one({ id: 'k' })).memory,
    ).toBe(true)
  })

  it('drops the duration when a single call has something to say instead', () => {
    // ⚠️ A run of one says its duration; a run of one that went wrong says what went wrong. The
    // line never says both, because the head is the only place either can go.
    const ok = { ...one(), at: 1000, result: { summary: 'ok', ok: true, at: 1120 } }
    expect(run(ok as ToolItem).detail).toBe('120 ms')
    expect(run(itemFor('error')).detail).toBe('')
  })

  function itemFor(outcome: ToolOutcome): ToolItem {
    const made: Record<string, Partial<ToolItem>> = {
      done: { result: { summary: 'ok', ok: true } },
      error: { result: { summary: 'no', ok: false } },
      unfinished: { result: null, unfinished: true },
      completed: { background: { outcome: 'completed' } },
      failed: { background: { outcome: 'failed' } },
      stopped: { background: { outcome: 'stopped' } },
      unknown: { background: { outcome: 'unknown' } },
    }
    const over = made[outcome]
    // ⛔ **A missing arm is a RED, never a silent skip** — that is the whole point of driving this
    // loop over `TOOL_OUTCOMES`: a tenth settled outcome has nothing here and says so.
    expect(over, `no fixture produces ${outcome}`).toBeDefined()
    const item = { ...one({ result: null }), ...over } as ToolItem
    expect(toolOutcome(item), `the fixture for ${outcome} produces something else`).toBe(outcome)
    return item
  }
})

describe('§4 · one derivation of what became of a tool call, in one file', () => {
  /**
   * ⛔ **The claim this guards is one I wrote in a docblock, so it is a claim until measured**
   * (standing rule 19). `ToolEntry` and `ToolRun` both say *how did this go*, and `064`/`099` are
   * about two derivations that agree today.
   *
   * ⚠️ **Scoped by what it is ABOUT and not by a list of paths** (rule 27.1): every `.vue` and
   * `.ts` under the renderer is read, so the fifth surface that decides this for itself is caught
   * by the same assertion rather than by somebody remembering to add it.
   *
   * 🔴 **Prose is stripped first.** Both components explain the derivation in comments — and one of
   * them quotes `result.ok` in the sentence that says it no longer computes it
   * (`a-source-census-must-strip-prose-before-it-asserts`).
   */
  /**
   * ⚠️ **What this shape covers, and what it does not** (standing rule 4). It finds the THREE-WAY
   * outcome branch by the two words only that branch produces together. ⛔ **It would NOT catch a
   * component that re-derived the same outcome under different words** — that is the hole, it is
   * named here rather than implied, and the reason the shape is not wider is measured: `result.ok`
   * alone matches `ToolEntry`'s own class choice for the receipt body and `ChildWorkViewer`'s
   * unrelated `result`, and `'unfinished' : 'running'` matches `backgroundState`, which is a
   * different derivation over a different input that happens to share a vocabulary.
   */
  const SHAPES = [/\?\s*'done'\s*:\s*'error'/]

  function everyRendererFile(): string[] {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) found.push(path)
      }
    }
    walk(RENDERER)
    return found
  }

  const code = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('reads more than one file, so an empty walk cannot pass', () => {
    // ⚠️ The control for the negative below: a census over nothing is green.
    expect(everyRendererFile().length).toBeGreaterThan(50)
  })

  it('finds the derivation in tool-outcome.ts and in no other renderer file', () => {
    for (const shape of SHAPES) {
      const carriers = everyRendererFile().filter((path) =>
        shape.test(code(readFileSync(path, 'utf8'))),
      )
      expect(
        carriers.map((path) => path.slice(RENDERER.length)),
        String(shape),
      ).toEqual(['/lib/tool-outcome.ts'])
    }
  })

  it('and the stripper really removes prose from the file this is about', () => {
    // 🔴 **A rule is proven by violating it** (rule 20). `ToolEntry`'s docblock argues about the
    // derivation in words, and a census that read the raw bytes would count the argument as the
    // thing (`a-source-census-must-strip-prose-before-it-asserts`). This asserts the stripper takes
    // that sentence out while leaving the file's code behind.
    const raw = readFileSync(`${RENDERER}/components/ToolEntry.vue`, 'utf8')
    const SAID = 'did the provider succeed at what it was asked'
    expect(raw, 'the sentence this control rests on has been edited away').toContain(SAID)
    expect(code(raw)).not.toContain(SAID)
    expect(code(raw), 'the stripper ate the code as well as the prose').toContain('const status =')
  })
})
