import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  sessionDoing,
  sessionFacets,
  standingOf,
  STANDINGS,
  STANDING_LABEL,
  STANDING_TONE,
  type AgentFacets,
  type Standing,
} from '../src/renderer/src/lib/agent-state'

/**
 * 🔴 **578 · the conversation header — what it says, and where each fact lives** (`EXT-010` §1).
 *
 * ## ⛔ What this file is for, and what `dom/the-conversation-header.dom.test.ts` is for
 *
 * ⚑ **This one asks *where a fact is stated*; that one asks *what a person can see*.** `EXT-010`
 * §1.1's complaint — *"A summary line sitting directly on top of the detail it summarises is not a
 * summary — pick one"* — is a claim about the TREE: one fact, one location. ⛔ A mount can show
 * that the bar does not draw the model; only a census over both components can say the bar cannot.
 *
 * ## ⚠️ Prose is stripped before anything is asserted
 *
 * ⛔ **Both components explain, in comments, exactly what they no longer draw** —
 * `SessionHeader.vue`'s own docblock says the model and the effort moved to the shelf, and names
 * them — so a raw-file census would report the bar as carrying the three facts its documentation
 * exists to say it does not (`a-source-census-must-strip-prose-before-it-asserts`).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const COMPONENTS = `${HERE}../src/renderer/src/components`

const read = (name: string): string => readFileSync(`${COMPONENTS}/${name}`, 'utf8')

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * 🔴 **`579` · a slice of one declaration, and it exists because the old one never sliced.**
 *
 * ⛔ **`578` wrote `HEADER.slice(i, HEADER.indexOf('})\n\n/**', i))` over the STRIPPED source** —
 * and {@link code} removes every `/** … *\/`, so that terminator cannot match, `indexOf` answers
 * `-1`, and `slice(i, -1)` is **everything from the declaration to the end of the file**. ⚠️ So
 * three assertions that read as *this computed contains…* were reading the whole component, and
 * one of them — a count of `||` — was passing on whatever the rest of the file happened to hold.
 *
 * ⚑ **`a-fixed-width-slice-runs-into-the-next-region`, with `-1` as the fixed width.** ⛔ The
 * terminator here is `\n}` at the declaration's own indentation, which survives stripping, and
 * the slice ASSERTS it found one rather than falling back to the rest of the file.
 */
function declaration(source: string, opens: string): string {
  const from = source.indexOf(opens)
  expect(from, `${opens} is not in this component any more`).toBeGreaterThan(-1)
  const to = source.indexOf('\n})', from)
  expect(
    to,
    `${opens} has no end — the slice would have run to the end of the file`,
  ).toBeGreaterThan(from)
  return source.slice(from, to)
}

const HEADER_RAW = read('SessionHeader.vue')
// ⚑ The strip's sources: the shelf under the header, and the usage cards and their words, which
// moved to the title bar. A fact none of them may state, none of them states.
const SHELF_RAW = [
  read('SessionShelf.vue'),
  read('UsageCards.vue'),
  readFileSync(
    new URL('../src/renderer/src/composables/useUsageCells.ts', import.meta.url),
    'utf8',
  ),
].join('\n')
const HEADER = code(HEADER_RAW)
const SHELF = code(SHELF_RAW)

/**
 * 🔴 **The bar WITHOUT its one tooltip that is allowed to say more than the bar does.**
 *
 * ⛔ **`EXT-010` §1.1 is about two answers a person meets in ONE GLANCE**, and a `title` is not one
 * of them — `resume-live-smoke.mjs` reads `provider-chip`'s tooltip as *what the app says this
 * conversation is running*, which is a detail view reached by hovering, not a second summary
 * sitting on top of the first.
 *
 * ⚠️ **So the census's search shape excludes exactly that computed and nothing else**, and
 * {@link theTooltipIsOnlyATooltip} is the assertion that keeps the exclusion honest: if
 * `providerDetail` ever reached the page as text rather than as a `:title`, this hole would be the
 * thing hiding it.
 */
const GLANCE = (() => {
  const start = HEADER.indexOf('const providerDetail = computed')
  expect(
    start,
    'providerDetail moved — the census hole below no longer matches anything',
  ).toBeGreaterThan(0)
  const end = HEADER.indexOf('})', HEADER.indexOf('.join(', start)) + 2
  return HEADER.slice(0, start) + HEADER.slice(end)
})()

/** ⛔ The hole above is only safe while the detail reaches the page as a tooltip and nowhere else. */
function theTooltipIsOnlyATooltip(): void {
  expect(HEADER.match(/providerDetail/g), 'providerDetail is named more than twice').toHaveLength(2)
  expect(HEADER).toContain('const providerDetail = computed')
  expect(HEADER).toContain(':title="providerDetail"')
  expect(HEADER).not.toContain('{{ providerDetail')
}

/* ---------------------------------------------------------------- §1 · one fact, one location */

/**
 * ⛔ **What PRODUCES each cell's value** — the symbol a second surface would have to name to state
 * the same fact. ⚠️ This is the census's search shape (standing rule 4), and it is the shape that
 * matters: a bar could not restate *plan mode* without the conversation's controls, or *model* without the
 * host's own `liveness.agent` rows, without writing a second derivation — which is the thing
 * `EXT-010` §1.1 is actually about.
 */
const WHAT_STATES_IT: Readonly<Record<string, readonly string[]>> = {
  model: ['liveness.agent', 'settings.model'],
  reasoning: ['liveness.agent', 'settings.reasoningEffort'],
  // ⚑ **714 re-aimed** — the shelf's cell asks `agentName` now (R41); a census still naming
  // `profileLabel` would search for a function nothing calls, and pass over a bar that restated it.
  profile: ['agentName'],
  plan: ['useConversationControls'],
  approval: ['approvalModeLabel'],
}

describe('§1 · one fact, one location (EXT-010 §1.1)', () => {
  /**
   * The shelf's four cells say each provider's usage; the session's settings left it for the Agent
   * panel. The bar still states none of them, and the shelf no longer does either: one location,
   * and it is the panel.
   */
  it('🔴 the settings are on neither the shelf nor the bar, and the shelf says usage', () => {
    expect(SHELF).toContain('shelf-usage-')
    for (const [setting, producers] of Object.entries(WHAT_STATES_IT)) {
      for (const symbol of producers) {
        // ⛔ The bar states it nowhere a person can read at a glance.
        expect(GLANCE, `the bar still states ${setting} through ${symbol}`).not.toContain(symbol)
        expect(SHELF, `the shelf still states ${setting} through ${symbol}`).not.toContain(symbol)
      }
    }
    expect(SHELF).not.toContain("key: 'home'")
    theTooltipIsOnlyATooltip()
  })

  it('⚑ …and the control: the bar keeps `provider`, which the shelf has never had', () => {
    // 🔴 **Without this the section above passes against a bar that draws nothing at all**, which
    // is the shape `a-positive-assertion-must-differ-from-the-default` exists to refuse.
    expect(HEADER).toContain('props.session.provider')
    expect(HEADER).toContain('data-cy="provider-chip"')
    // ⛔ …and the shelf does not answer it either, so *provider* has one location too.
    expect(SHELF).not.toContain("key: 'provider'")
    // ⚠️ The shelf names no conversation's provider: its cells iterate every provider's usage.
    expect(SHELF).not.toContain('session.provider')
    expect(SHELF).toContain('Object.keys(PROVIDER_NAME)')
  })

  it('⛔ the chip is ONE word — the joined row that carried the other two is gone', () => {
    // ⚠️ **The defect was a JOIN**, not a mention: `[provider, ...rows.map(r => r.value)]` put the
    // host's model and reasoning rows into the chip, an inch above the two cells that draw them.
    const chip = GLANCE.slice(
      GLANCE.indexOf('const providerChip = computed'),
      GLANCE.indexOf('const unstarted = computed'),
    )
    expect(chip.length, 'the providerChip computed moved').toBeGreaterThan(40)
    expect(chip).not.toContain('rows.map')
    expect(chip).not.toContain('.join(')
    expect(chip).not.toContain('liveness')
    // ⚑ **The control, one computed over**: `pendingMarker` still joins with the same separator, so
    // *no join here* is a statement about this chip rather than about a file with no joins left.
    expect(GLANCE).toContain("parts.join(' · ')")
    // ⚑ **The hover is deliberately NOT part of this rule and is asserted so it cannot be lost.**
    // `resume-live-smoke.mjs` reads `provider-chip`'s `title` as *what the app says this
    // conversation is running*; a tooltip is not the strip, and `EXT-010` §1.1 is about two
    // answers a person meets in one glance.
    expect(HEADER).toContain('providerDetail')
    expect(HEADER).toContain(':title="providerDetail"')
  })

  /**
   * 🔴 **The ONE thing the bar still says about a setting, and it is not the setting.**
   *
   * ⛔ **`EXT-010` §1.3 lists the yolo mark among the three chips, and §1.1 among the facts stated
   * twice.** ⚑ `578` kept it, restyled, arguing the two were not the same statement: the shelf's
   * `APPROVAL MODE` cell stated the VALUE in every mode, labelled; this mark is a WARNING about a
   * consequence and exists in one mode only.
   *
   * The shelf’s duplicate cell is absent; the conditional mark remains beside the top buttons
   * as the single visible location for the mode.
   *
   * ⚠️ **What that costs, and it is not nothing**: in `ask` this surface no longer states the mode
   * at all. ⚑ `082`'s rule is the reason it is survivable — *"every session states its mode; only
   * the unattended one shouts"* was already the argument for the mark's own absence in `ask`, and
   * the agent card's `CardApproval` is where the mode is stated AND changed.
   *
   * ⛔ **So the exception is bounded, and the bound is asserted**: it appears for `auto` and for
   * nothing else, and the bar does not reach `approvalModeLabel`, which is where the mode's WORD
   * is decided.
   */
  it('⚠️ the one exception is a WARNING, bounded to the unattended mode', () => {
    expect(HEADER).toContain("session.approvalMode === 'auto'")
    expect(HEADER).not.toContain('approvalModeLabel')
    // ⛔ One element, not two: a bar that also drew the `ask` case would be stating the mode.
    expect(HEADER.match(/data-cy="session-approval-indicator"/g)).toHaveLength(1)
    // 🔴 **ONE mention of the condition now, and that is the `579` change measured** — the mark's
    // own `v-if`. ⛔ It was two: the band under the bar asked the same question to decide whether it
    // had anything to say, and with the mark off the band that term drew an empty amber strip.
    // ⚠️ **A second mention would be a second surface deciding the same thing**, which is what
    // this count has always been for.
    expect(HEADER.match(/approvalMode === 'auto'/g)).toHaveLength(1)
    // ⛔ …and the shelf no longer states it at all, which is the other half of *one location*.
    expect(SHELF).not.toContain('approvalModeLabel')
    // ⚑ **The paired positive, because the line above is an absence**: the shelf did render its
    // cells and really is the component this slice read.
    expect(SHELF, 'the shelf census read nothing').toContain('shelf-usage-')
  })
})

/* ------------------------------------------------------------ §2 · the yolo mark on the bar */

/**
 * 🔴 **`579` relay 3 · the yolo mark left the band for the bar, and this section followed it.**
 *
 * The conditional warning band is absent, keeping header height stable between agents.
 * `dom/the-conversation-header.dom.test.ts` §4 measures that geometry; this file retains the
 * mark in the bar.
 */
describe('§2 · the yolo mark on the bar (579)', () => {
  /**
   * 🔴 **`579` relay 3b · the mark on the bar says ONE WORD, and the facts it dropped are in the
   * title.**
   *
   * The visible mark says only “YOLO”; disclosure text stays in the tooltip.
   *
   * ⚑ **So the thing that must not be lost is asserted here rather than assumed**: the two facts
   * survive in `yoloTitle`, and the two surfaces where the mode is CHOSEN still carry the whole
   * disclosure — which is what `171 §3` actually requires (*said where the mode is chosen*) and is
   * pinned by `a-mode-that-says-what-it-does.dom.test.ts` §3.
   */
  it('🔴 …and the mark that came back to the bar is one word, with both facts in its title', () => {
    // ⚠️ **The SECOND `</span>`**, because the mark contains one: `<span class="dot"></span>`
    // closes before the label does, and a slice that stopped at the first would end one character
    // before the thing this test is about — and would then pass its two negatives vacuously.
    const from = HEADER.indexOf('data-cy="session-approval-indicator"')
    expect(from, 'the mark is not in this component any more').toBeGreaterThan(-1)
    const mark = HEADER.slice(from, HEADER.indexOf('</span>', HEADER.indexOf('</span>', from) + 1))
    expect(mark, 'the mark stopped rendering the label').toContain('{{ YOLO_LABEL }}')
    // ⛔ **The two clauses are gone from the BAR** — the reversal, stated as an assertion.
    expect(mark).not.toContain('nothing is asked')
    expect(mark).not.toContain('nothing is confined')

    // ⚑ **…and both facts are in the title, in words, which is the whole of what makes the
    // reversal survivable.** ⚠️ Read off the computed rather than off a literal here, so a title
    // reworded into a shorter one takes this red with it.
    const title = declaration(HEADER, 'const yoloTitle = computed')
    expect(title, 'the prompt half left the tooltip too').toContain('without asking')
    // 🔴 **The NEGATION, not the verb** — and a mutation row caught this the same hour it was
    // written. ⛔ It read `toContain('confines them')`, which `367 M13`'s mutant —
    // *"and **this app** confines them"*, the exact opposite claim, and the `168 H1` defect
    // verbatim — satisfies as a substring. ⚠️ **A test that cannot tell a sentence from its
    // inverse is not testing the sentence**, and the row SURVIVED until this line was corrected.
    expect(title, 'the reach half left the tooltip too').toContain(
      'nothing this app configures confines them',
    )
    // ⛔ **And the inverse by name**, so the distinction is stated rather than implied by a longer
    // `toContain` somebody could shorten again.
    expect(title, 'the tooltip claims a boundary this app does not have').not.toMatch(
      /this app confines them/,
    )
    expect(mark, 'the mark does not carry the title at all').toContain(':title="yoloTitle"')
  })
})

/* ------------------------------------------------------------- §3 · the vocabulary (§2.2) */

/**
 * 🔴 **`Idle` is a member of a closed set, and this section is the brief's §2.2 answered.**
 *
 * ⛔ **The question was whether a state exists that renders as NONE of them** — which is
 * `an-unenumerated-state-counts-as-success`: *done* becoming the absence of the states somebody
 * enumerated. ⚑ **It does not, and the reason is a specific line rather than a general claim:**
 * `sessionDoing` answers `unknown` — never `idle` — when the host has said nothing
 * (*"No word from the host, so no claim"*), so the quiet word is only ever reached through a
 * POSITIVE answer: the session is over, or the host said `idle`.
 *
 * ⚠️ **One place draws no word at all, and it is deliberate**: the launcher, where `101 §9` removed
 * the third of three sayings of *not started*. ⛔ That is a decision about a surface, not a hole in
 * the vocabulary. ⚑ **D-017b** — the standing `unstarted` itself went with `ended` and `errored`
 * (whether a process runs, `05` rule 5); the launcher's plate is faceless.
 */
describe('§3 · the standing vocabulary, and whether anything falls outside it (EXT-010 §2.2)', () => {
  it('🔴 TEN standings, ten words, ten tones — and no member without one', () => {
    // ⚑ **636 · the tenth, and the title moved with it.** `a-title-that-names-a-count-the-
    // assertion-never-checks` cuts the other way here: this assertion DOES check the count, so
    // the number in the title is the one thing that can go stale silently.
    // ⚑ **D-017b · twelve became nine**: `unstarted`, `ended` and `errored` said whether a process
    // runs (`05` rule 5), and a conversation nothing is doing anything in reads by the one state.
    expect([...STANDINGS]).toEqual([
      'unknown',
      'idle',
      'background',
      // ⛔ **F036 · another agent waits on an answer from this one** — the same family, true WHILE
      // idle, drawn as a word.
      'owes',
      'scheduled',
      // ⛔ **636 · `621` §5.2's word, chosen** — not driving a turn, and the next move belongs to
      // another agent. ⚠️ It sits beside `background` and `scheduled` because it is the third
      // member of that family: a fact that is true WHILE the conversation is idle, drawn as a
      // word and never as a badge.
      'elsewhere',
      // ⛔ **D-006 · F018 — the eleventh and twelfth**: idle, and the work it holds is not being
      // worked on, or was answered. The same family, true WHILE idle, drawn as a word.
      'stalled',
      'answered',
      'working',
      'waiting',
    ])
    for (const standing of STANDINGS) {
      expect(STANDING_LABEL[standing], `${standing} has no word`).toBeTruthy()
      expect(STANDING_TONE[standing], `${standing} has no tone entry`).toBeDefined()
    }
    // ⛔ **Ten distinct words** (F036 added `owes`): a vocabulary that says one thing two ways is a vocabulary a
    // person cannot read the difference in.
    expect(new Set(STANDINGS.map((s) => STANDING_LABEL[s])).size).toBe(STANDINGS.length)
  })

  it('⛔ every FACET combination lands on a member — the set has no escape', () => {
    // ⚑ **Driven rather than argued.** Every value of every facet, crossed — 8 × 8 × 5 × 2 × 2 —
    // and every answer is in the set. A `standingOf` that could return something else would have
    // to invent it here.
    const doings = [
      undefined,
      'idle',
      'working',
      'thinking',
      'tool',
      'compacting',
      'replying',
      'unknown',
    ] as const
    const beings = [
      undefined,
      'unstarted',
      'starting',
      'live',
      'silent',
      'closing',
      'ended',
      'errored',
    ] as const
    const needings = [undefined, 'permission', 'question', 'proposal', 'plan'] as const
    // ⛔ **636 · the SIXTH axis, and it is spelled out here on purpose.** ⚠️ This file is one of
    // the ORACLES `446` kept a hand copy in — *"a test that asked the function under test would
    // measure nothing"* — so the three waits are written rather than imported from
    // `TASK_WAITS`. ⚑ The derived roster is swept in `agent-state.test.ts`, whose own copy is the
    // other half of that pair.
    const waits = [
      undefined,
      'waiting-on-an-answer',
      'waiting-on-a-person',
      'waiting-on-a-worker',
    ] as const
    // ⛔ **D-006 · the SEVENTH axis, spelled out for the same reason**: where the work it holds
    // stands — stalled, answered, or absent.
    const works = [undefined, { state: 'stalled' }, { state: 'answered', outcome: 'done' }] as const
    const seen = new Set<Standing>()
    for (const doing of doings)
      for (const being of beings)
        for (const needing of needings)
          for (const detached of [false, true])
            for (const scheduled of [false, true])
              for (const waiting of waits)
                for (const work of works)
                  // ⚑ **F036 · the eighth axis** — `owes` is reached only through it.
                  for (const owes of [
                    undefined,
                    ['Ada (the owner of W1.2 · The pages)'],
                  ] as const) {
                    const facets = {
                      doing,
                      being,
                      needing,
                      detached,
                      scheduled,
                      waiting,
                      work,
                      ...(owes ? { owes } : {}),
                    } as AgentFacets
                    const standing = standingOf(facets)
                    expect(STANDINGS, `standingOf invented ${standing}`).toContain(standing)
                    expect(STANDING_LABEL[standing]).toBeTruthy()
                    seen.add(standing)
                  }
    // ⛔ **And the set is REACHED, not merely respected.** Nine of the ten are produced by the
    // sweep above; `scheduled` needs `doing: 'idle'` with nothing detached, which the cross does
    // produce — so all ten are live words rather than entries nothing can make
    // (`222` §4: do not keep a word nothing can produce). ⚑ **636 · the tenth is reached only
    // because the sixth axis joined**, which is why it joined — and D-006's two only because the
    // seventh did.
    expect([...seen].sort()).toEqual([...STANDINGS].sort())
  })

  it('🔴 the quiet word is never the absence of an answer — `unknown` is', () => {
    // ⛔ **This is the §2.2 hazard, measured.** A host that has said nothing must not produce
    // `Idle`, because *the turn has finished* and *we have not been told* are different facts and
    // the first one is the fact `EXT-010` §1.4 calls the most consequential on the screen.
    // ⚑ D-017b — `started` left the input; a host that has said nothing is the whole absence.
    expect(sessionDoing({ status: undefined } as never)).toBe('unknown')
    expect(sessionDoing({ status: null } as never)).toBe('unknown')
    expect(standingOf({ doing: undefined, being: 'live' })).toBe('unknown')
    expect(STANDING_LABEL.unknown).toBe('Unknown')
    // ⚑ **The paired positive**: a host that DID say idle produces the quiet word, so the negative
    // above is about the absence of an answer and not about the function being unable to say it.
    expect(sessionDoing({ status: 'idle' } as never)).toBe('idle')
    expect(standingOf({ doing: 'idle', being: 'live' })).toBe('idle')
    expect(STANDING_LABEL.idle).toBe('Idle')
  })

  it('⚠️ the ONE place this bar draws no word is the launcher, and its plate is faceless', () => {
    // ⛔ `101 §9`: *"the fix de-dupes the WORD, keeps the plate."* The pill is `v-if="!unstarted"`
    // — `unstarted` is the header's own `session === null`, the launcher — and
    // `dom/launcher-layout.dom.test.ts` is where the pairing is measured.
    expect(HEADER).toContain('v-if="!unstarted"')
    // ⚑ **D-017b** — the plate carried *not started* as a BEING, and that was a process word; the
    // launcher's facets (`NewConversation.LAUNCHER_FACETS`, the same input) are now faceless, a
    // plate that claims nothing about a conversation that does not exist.
    expect(
      sessionFacets({
        phase: null,
        status: null,
        activity: null,
        streaming: false,
        liveness: null,
      }),
    ).toEqual({ doing: 'unknown' })
    // ⚑ …and every OTHER member is drawable here, because the element's own condition is the only
    // thing between a standing and its word.
    expect(HEADER).toContain('{{ statusLabel }}')
    expect(HEADER).toContain('STANDING_LABEL')
  })
})
