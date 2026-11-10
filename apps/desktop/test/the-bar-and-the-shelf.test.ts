import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { summonsAttention } from '../src/renderer/src/lib/agent-state'
import { V23_FIELD_MAP, type FieldMapping } from './lib/design-v2-map'
import { createSessionRecord, lastReportAt } from '../src/renderer/src/lib/session-record'
import { whoAnsweredIt } from '../src/shared/who-did-it'
import { createWindow, type WindowState } from '../src/renderer/src/lib/transcript-window'

/**
 * 🔴 **The four absences the shelf is allowed to have, and the three it is not** (389 §4 and §5).
 *
 * ## ⛔ Why this file is source and the shelf's other file is a browser
 *
 * `dom/one-bar-one-shelf.dom.test.ts` measures what a person sees: the bar's drag region, the
 * five cells (six until `578`), the attention row's separation from NOW. ⚠️ **Three of `389`'s rules are not about what is
 * on screen — they are about what is NOWHERE**, and an absence is only as strong as the shape that
 * looked for it (standing rule 4). A mount can show that one component does not draw an actor; only
 * a census over the tree can say the label does not exist.
 *
 * ## ⚑ What each section holds
 *
 *  - **§1** — every absent word the shelf draws is `design-v2-map.ts`'s, resolved at run time from
 *    the map rather than transcribed. `389 §1` requires every fact drawn to resolve through the map;
 *    this is that requirement made checkable in the one direction that can go wrong.
 *  - **§2** — the actor LABEL, which `389 §5` retired, is in no file. ⛔ **And the map itself was
 *    the one place it lived**, which was `389`'s finding: the artefact the shelf resolves through
 *    carried the wording the brief corrected. 🔴 **`503` kept the rule and buried its premise.**
 *    `389 §5`'s second half — *"omit the row entirely, do not add the label anywhere"* — rested on
 *    *the product records no actor, ever*, and `477` ended that: `UserDecisionEvent.by` names the
 *    caller. ⚠️ **So the half that survives is the one this section actually measures** — a
 *    missing-value label is still the wrong shape, and the request surface draws what the ledger
 *    HOLDS instead of a promise that a fact could have been reported.
 *  - **§3** — no project attribution reaches the shelf, because `388` measured that a session does
 *    not retain one.
 *  - **§4** — no credential token, because the product's answer is a paragraph.
 *  - **§5** — the words the shelf renders come from the libraries that own them.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = `${HERE}../src/renderer/src`
const COMPONENTS = `${RENDERER}/components`

const read = (path: string): string => readFileSync(path, 'utf8')

/**
 * ⛔ **A source census has to strip the prose before it asserts** — and this file found that out the
 * ordinary way, by going red against its own explanation.
 *
 * `SessionShelf.vue`'s docblock says, in words, that there is no project breadcrumb, no credential
 * chip, and that the activity never comes from `control.activity`. ⚠️ **Every one of those sentences
 * contains the exact string the census below refuses**, so a search over the raw file reports the
 * component as carrying the three things its documentation exists to say it does not.
 *
 * ⚑ What is stripped: block comments, line comments and HTML comments. What is left is the code —
 * imports, expressions, string literals and template markup — which is where a label a person can
 * read actually has to live.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ⚑ The strip's sources: the shelf under the header, and the usage cards and their words, which
// moved to the title bar. A fact none of them may state, none of them states.
const SHELF = code(
  [
    read(`${COMPONENTS}/SessionShelf.vue`),
    read(`${COMPONENTS}/UsageCards.vue`),
    read(`${COMPONENTS}/../composables/useUsageCells.ts`),
  ].join('\n'),
)

/** Every renderer source file — components, composables and libraries — with its path. */
function everySource(): { name: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : /\.(vue|ts|css)$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    )
  return walk(RENDERER).map((path) => ({
    name: path.slice(RENDERER.length + 1),
    source: code(read(path)),
  }))
}

/* --------------------------------------- §0 · the stamp, and the window it must not be taken from */

/** A window holding these event times, in order. */
function windowOf(times: number[]): WindowState {
  const window = createWindow()
  window.entries = times.map((at, index) => ({
    sessionId: 'sess_1',
    ordinal: index,
    at,
    event: { type: 'status', state: 'idle' } as never,
  }))
  return window
}

describe('§0 · the last-report stamp comes from the LIVE window (389 §3)', () => {
  it('🔴 a reader paged back does not make the conversation look stale', () => {
    const record = createSessionRecord('sess_1')

    // At the tail, the one window is both.
    record.window = windowOf([1_000, 2_000, 7_000])
    expect(lastReportAt(record)).toBe(7_000)

    // ⛔ **Paged back**: `window` is now an older slice and `tail` holds the live one — the
    // invariant `session-record.ts` states on the field itself. A stamp taken from `window` here
    // would be a claim about the AGENT made out of a fact about the READER.
    record.tail = windowOf([1_000, 2_000, 7_000])
    record.window = windowOf([1_000, 2_000])
    expect(lastReportAt(record)).toBe(7_000)
    // ⚑ **The control, one fact over**: the two windows genuinely disagree, so the reading above
    // distinguishes them rather than happening to agree.
    expect(record.window.entries.at(-1)?.at).toBe(2_000)

    // ⚠️ And nothing yet is `null` — a state, never a stamp of the moment it was asked.
    const fresh = createSessionRecord('sess_2')
    expect(lastReportAt(fresh)).toBeNull()
  })
})

/* --------------------------------------------------- §1 · the map is the source of the absent words */

/** The map's whole row for a path. */
function entry(path: string): FieldMapping {
  const found = V23_FIELD_MAP.find((field) => field.path === path)
  expect(found, `the map no longer answers for ${path}`).toBeDefined()
  return found!
}

/** What `design-v2-map.ts` says this field draws when the product has no value. */
function mapAbsent(path: string): string {
  return entry(path).absent
}

/** The product symbols a bound / derived / unhoused row names; a hole names none. */
function refsOf(field: FieldMapping): string[] {
  return field.binding.state === 'hole' ? [] : field.binding.from.map((one) => one.symbol)
}

/* ------------------------------------------------- §2 · the actor LABEL, retired — the actor, not */

describe('§2 · no actor label exists anywhere (389 §5)', () => {
  it('🔴 the tree carries no missing-actor wording — and the map was where it lived', () => {
    // ⛔ **The search shape.** Every `.vue`, `.ts` and `.css` under the renderer, matched
    // case-insensitively against the word `actor` followed by a missing-value phrase within the
    // same sentence — the shape a label of that kind takes wherever it is written.
    const shape = /actor[^.\n]{0,40}(not reported|unknown|unavailable|missing)/i
    const carriers = everySource().filter(({ source }) => shape.test(source))
    expect(carriers.map(({ name }) => name)).toEqual([])

    // ⚑ **The control, one fact over: the shape CAN find one.** Without this the empty list above
    // would be indistinguishable from a regex that matches nothing at all.
    expect(
      shape.test('<dd>{{ decision.actor ?? "Actor not reported" }}</dd>'),
      'the search shape cannot find a planted actor label — the negative above is vacuous',
    ).toBe(true)
    // …and it does not fire on the ordinary word, so the empty list is not an accident of
    // strictness either.
    expect(shape.test('the actor model is unrelated to this')).toBe(false)
  })

  it('⛔ …and the map’s actor slot is no longer a hole — it states what the ledger holds', () => {
    // 🔴 **`389`'s finding was that this slot carried the retired wording; `503`'s is that the
    // slot's PREMISE had expired.** `389 §5` read *"the product records none, ever"*, and the map
    // went on saying so after `477` had put the caller on `UserDecisionEvent.by` — which is
    // `494` F2, and the reason rule 19's corollary exists.
    const actor = entry('requests[].actor')
    expect(actor.binding.state, 'the actor slot is still filed as unsuppliable').toBe('derived')
    expect(refsOf(actor), 'a derived slot that names no source').toContain('UserDecisionEvent')

    // ⛔ **What survives `389 §5` is the SHAPE**, and this is the half the section above measures:
    // the absent case is a statement about the ledger, never a label promising a fact that could
    // have been reported.
    const absent = mapAbsent('requests[].actor')
    expect(absent).toContain('Nothing in the ledger records who answered it')
    expect(absent).toContain('389 §5')
    // ⚑ …and the surface really does compose that sentence, from the module that owns its bytes —
    // so this is a claim about the product and not only about the map's prose.
    expect(whoAnsweredIt(undefined)).toBe('Nothing in the ledger records who answered it')
    expect(whoAnsweredIt({ who: 'a-person' })).toBe('by a person')

    // ⚑ **The control, and it is what stops the two assertions above from being a formality.** A
    // slot the product genuinely cannot supply is still a hole with the retired shape refused, and
    // the map is capable of both answers.
    const credential = entry('launch.credentialOwner')
    expect(credential.binding.state).toBe('hole')
    expect(mapAbsent('launch.credentialOwner')).toContain('removed rather than filled')
  })
})

/* ------------------------------------------------------------ §5 · the words come from their owners */

describe('§5 · the shelf renders words it does not own (389 §3)', () => {
  it('⚠️ only a question or a permission may summon attention — in ONE place', () => {
    // ⛔ `plan` is a NEEDING and is deliberately not attention: a go-ahead blocks nothing and can be
    // pressed whenever. A shelf that treated it as attention would put an amber row on a
    // conversation nobody is waiting on.
    //
    // 🔴 **446 · the set moved OUT of this file, and that is what this assertion now pins.** ⛔ The
    // clause was written here AND in `standingOf`, and two spellings of one rule stayed in step
    // only because nobody had added a member — `441`'s proposal (gone at D-016) was the member
    // that would have separated them, summoning attention on the plate and not on this row. ⚑ So
    // the assertion is that this component ASKS rather than decides, which is the property that
    // cannot drift.
    expect(SHELF).toContain('summonsAttention(needing)')
    expect(SHELF).not.toContain("needing === 'permission' || needing === 'question'")
    expect(SHELF).not.toContain("needing === 'plan'")
    // ⚑ **And the one place really does hold the set**, or this file would be pinning a delegation
    // to a function that had quietly lost a member.
    expect(summonsAttention('permission')).toBe(true)
    expect(summonsAttention('question')).toBe(true)
    expect(summonsAttention('plan')).toBe(false)
    expect(summonsAttention(undefined)).toBe(false)
  })
})
