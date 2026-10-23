import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  accessibleName,
  activityLine,
  beingCondition,
  BEING_TOKEN,
  BEING_WORD,
  BEINGS,
  DOING_WORD,
  DOINGS,
  isDotOnly,
  needingFor,
  NEEDING_GLYPH,
  NEEDING_TOKEN,
  NEEDING_WORD,
  NEEDINGS,
  plateWord,
  platePx,
  PLATE_FLOOR,
  PLATE_TOKENS,
  priorityDotToken,
  sessionBeing,
  sessionDoing,
  sessionFacets,
  SIZES,
  standingOf,
  standingWord,
  STANDINGS,
  STANDING_LABEL,
  STANDING_TONE,
  subAgentFacets,
  underlineFor,
  UNKNOWN_TOKEN,
  type AgentFacets,
  type Being,
  type Doing,
  type Needing,
  type SessionFacetInput,
} from '../src/renderer/src/lib/agent-state'
import { CONVERSATION_WAITS, type ConversationWait } from '../src/shared/tasks'
// ⚑ **645 · the WORD each wait is drawn with, from the table that owns it** — the same move
// `lib/agent-state.ts` makes at its own import, and `222` §4's rule: a census that spelled these
// phrases a second time would go green over a table that had moved.
import { WORK_STATE_WORD } from '../src/renderer/src/lib/work-report'
import { pendingKind, sessionPanel } from '../src/renderer/src/lib/session-panel'
import type { SessionStatus, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  markRequestFailed,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * The agent, drawn (081/082).
 *
 * ⚠️ **This file exists because the renderer tests cannot do this job.** `AgentState.vue` is almost
 * nothing but conditional rendering, and SSR gives markup with no layout, no computed styles and no
 * media queries — so a rule kept in the template is a rule nothing can check. Everything worth
 * asserting therefore lives in `lib/agent-state.ts`, and this is where it is asserted; the render
 * test beside it only checks that the markup wires up to these answers.
 *
 * The cross product is small enough to be exhaustive — 8 × 8 × 4 × 2 × 2 = 1,024 states, each facet's
 * values plus its absent case — so the properties below are checked over ALL of it rather than over
 * three examples that happened to occur to me.

 * ⛔ **The `× 2` is 250's fourth facet, {@link AgentFacets.detached}**, and widening this sweep is
 * what caught the standing census going from 7 words to 8 with nothing exercising the new one.
 *
 * ⚠️ **That number is asserted, not narrated** (089). It read 224 in five places, which was the
 * count with `doing` absent left out of the arithmetic — a comment that had been wrong since it was
 * written, in a file whose whole subject is a component saying things it has not checked.
 */

const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/renderer/src/${path}`, import.meta.url)), 'utf8')

/**
 * Every `.vue` and `.ts` under the renderer — the scope a sprite reference can hide in.
 *
 * ⚠️ `.d.ts` is excluded (089 review). A declaration file ships no markup, so a `#i-…` in one of its
 * doc comments would be a reference that no browser ever resolves — and it would count as a live
 * use, hiding the deletion of the last real one.
 */
function rendererSources(): string[] {
  const root = fileURLToPath(new URL('../src/renderer/src', import.meta.url))
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) return walk(full)
      if (entry.name.endsWith('.d.ts')) return []
      return entry.name.endsWith('.vue') || entry.name.endsWith('.ts') ? [full] : []
    })
  return walk(root)
}

const TOKENS = source('assets/tokens.css')

/** One rule's declarations, found by its selector at the start of a line (as `chat-theme.test.ts`).
 *  `[,{]` because a rule may have a selector LIST — see that file for the whole reason (126). */
function rule(selector: string): Record<string, string> {
  const at = TOKENS.search(
    new RegExp(`^${selector.replace(/[[\]().*+?^$|\\]/g, '\\$&')}\\s*[,{]`, 'm'),
  )
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0)
  const open = TOKENS.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < TOKENS.length; end++) {
    if (TOKENS[end] === '{') depth++
    if (TOKENS[end] === '}' && --depth === 0) break
  }
  const out: Record<string, string> = {}
  for (const m of TOKENS.slice(open + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim()
  }
  return out
}

const DARK = rule(':root')
const LIGHT = rule("[data-chat-theme='light']")
const PLATE = rule('[data-on-white]')

/**
 * # ⛔ THE AXES OF EVERY SWEEP IN THIS FILE — exhaustive over `keyof AgentFacets` (645)
 *
 * ⚑ **`250` doubled this sweep by hand and said why. `258` doubled it again and said why. `636`
 * added a SIXTH facet and doubled nothing** — so `waiting` was an axis no property in this file
 * swept, which is verbatim the failure the `258` note below records and was written to prevent.
 *
 * ⚠️ **Stated precisely, because the looser version is wrong:** the clause `636` added to
 * {@link accessibleName} was NOT untested — `three-surfaces-read-the-new-field.test.ts` pins the
 * sentence for every wait. 🔴 **What nothing pinned was the arithmetic here**, which is the only
 * assertion that says a clause is said *and nothing else is*, and which is what caught `258`.
 *
 * ⛔ **A comment asking the next dispatch to remember is not a mechanism.** The registry is, by
 * `-?` on the mapped type: a facet added to `AgentFacets` and not named here does not compile, and
 * a key here that is not a facet is an excess property. ⚠️ **The loop is pinned to the registry at
 * run time** by the floor beneath it, so an axis declared and not swept is a red verdict too.
 *
 * ⚑ **`CONVERSATION_WAITS` and not a literal list**: the roster is filtered out of `TASK_STATES`'
 * own `waiting-on-` prefix (`609`), so a new wait a conversation can be in joins every sweep in
 * this file without anybody remembering ([[a-loop-over-a-literal-variant-list-is-not-exhaustive]]).
 * ⛔ **D-016 · commit 6 · less the one wait said on a piece only** — *waiting on you*, which no
 * conversation is ever in, so the facet's own type cannot hold it.
 */
const FACET_AXES = {
  doing: [...DOINGS, undefined],
  being: [...BEINGS, undefined],
  needing: [...NEEDINGS, undefined],
  detached: [true, undefined],
  scheduled: [true, undefined],
  waiting: [...CONVERSATION_WAITS, undefined],
  // ⚑ **D-006 · the SEVENTH**, one value per standing it can raise and its absence.
  work: [{ state: 'stalled' }, { state: 'answered', outcome: 'done' }, undefined],
  // ⚑ **F036 · the EIGHTH**, an asker and its absence.
  owes: [['Ada (the owner of W1.2 · The pages)'], undefined],
} as const satisfies { [K in keyof AgentFacets]-?: readonly (AgentFacets[K] | undefined)[] }

/** Every DOING × BEING × NEEDING × DETACHED × SCHEDULED × WAITING × WORK × OWES, absent cases included. */
const ALL: AgentFacets[] = []
for (const doing of FACET_AXES.doing) {
  for (const being of FACET_AXES.being) {
    for (const needing of FACET_AXES.needing) {
      // ⛔ **The fourth facet doubles the sweep** (250). Every property in this file is checked over
      // `ALL`, so leaving `detached` out would have left the new state uncovered by all of them
      // while every test name went on saying "every one of the … states" — which is the boast the
      // 089 note above is about, arrived at from the other direction.
      //
      // 🔴 **And the FIFTH doubles it again** (258) — added because the row that deletes the fifth
      // facet's clause from {@link accessibleName} SURVIVED the whole suite: the sweep had four
      // axes, so the screen-reader sentence for a scheduled conversation was asserted by nothing at
      // all. Found by replaying 258's own mutation table.
      //
      // ⚠️ **And the SIXTH quadruples it** (636, landed by `645`) — added because the same thing
      // happened a third time and this time NOTHING found it: no mutation row, no sweep, no floor.
      // ⚑ It is read off the registry above rather than written here, which is the difference
      // between this line and the two above it.
      for (const detached of FACET_AXES.detached)
        for (const scheduled of FACET_AXES.scheduled)
          for (const waiting of FACET_AXES.waiting)
            for (const work of FACET_AXES.work)
              for (const owes of FACET_AXES.owes) {
                ALL.push({
                  ...(doing ? { doing } : {}),
                  ...(being ? { being } : {}),
                  ...(needing ? { needing } : {}),
                  ...(detached ? { detached } : {}),
                  ...(scheduled ? { scheduled } : {}),
                  ...(waiting ? { waiting } : {}),
                  ...(work ? { work } : {}),
                  ...(owes ? { owes } : {}),
                })
              }
    }
  }
}

/**
 * ⛔ **The structural claim about the white plate, read off the stylesheet text** (tokens.css §14):
 * every sentence returned is a way the island could drift from the light conversation.
 *
 * ⚠️ Comments are stripped first: §14 is four paragraphs of prose ABOUT `[data-on-white]` sitting
 * above the rule, and a scan that counted those found two selectors where there is one.
 */
function islandFindings(tokensCss: string): string[] {
  const out: string[] = []
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  /**
   * ⚑ **One palette block, plus at most one ALIAS block shared with `:root`** (the app-wide look).
   * A role or state alias (`--role-prose: var(--text-base)`) resolves where it is declared, so it
   * is re-declared in every scope to read that scope's own palette. ⛔ That block may hold
   * references only: `var(--x)`, or a mix of references (`color-mix(in srgb, var(--accent) 12%,
   * var(--panel))` reads each scope's own accent and panel exactly as a bare alias does). A literal
   * value in it would be the second palette this guard exists to refuse.
   */
  const ALIASES = ":root,\n[data-chat-theme='light'],\n[data-on-white] {"
  const aliasAt = css.indexOf(ALIASES)
  const aliasBody =
    aliasAt === -1 ? '' : css.slice(aliasAt + ALIASES.length, css.indexOf('}', aliasAt))
  const REFERENCE =
    /^(?:var\(--[\w-]+\)|color-mix\(in (?:srgb|oklab), var\(--[\w-]+\) \d+(?:\.\d+)?%, (?:var\(--[\w-]+\)|transparent)\))$/
  for (const [, name, value] of aliasBody.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    if (!REFERENCE.test(value!.trim().replace(/\s+/g, ' ')))
      out.push(`the shared alias block holds a value, not a reference: ${name}`)
  }
  /**
   * ⚑ The derived-theme rules (every theme but classic) name the island too, always together with
   * the light conversation in one `:is()`, so they cannot split the two. They are set aside before
   * counting; a rule that names the island on its own still counts, and still fails.
   */
  const derived = /[^{}]*:not\(\[data-theme='classic'\]\)[^{}]*\{[^{}]*\}/g
  for (const [rule] of css.matchAll(derived)) {
    if (
      rule.includes('[data-on-white]') &&
      !rule.includes(":is([data-chat-theme='light'], [data-on-white])")
    )
      out.push('a derived rule names the island without the light conversation')
  }
  const named = [...css.replace(derived, '').matchAll(/\[data-on-white\]/g)].length
  if (named !== (aliasAt === -1 ? 1 : 2))
    out.push('the island is named in more than one place — a second block wins by source order')
  if (!css.includes("[data-chat-theme='light'],\n[data-on-white] {"))
    out.push('the island is a rule of its own again — it must share §13’s block')
  return out
}

describe('the three vocabularies', () => {
  it('is the shape 081 specified — seven, seven, THREE, and now two booleans', () => {
    expect(DOINGS).toHaveLength(7)
    expect(BEINGS).toHaveLength(7)
    // ⚑ **446 added a fourth NEEDING and D-016 took it out** — `441`'s proposal went with
    // proposals. ⛔ The count below is derived from the lengths and pinned separately, so the
    // sweep's size moved with it rather than the assertion quietly passing over a different
    // cartesian product.
    expect(NEEDINGS).toHaveLength(3)
    // …and the sweep below really is every combination of them, absent cases included. Pinned so
    // that "every state the sweep holds" in the test names below is a fact and not a boast.
    //
    // ⛔ **`× 2` is 250's fourth facet and `× 2` again is 258's fifth** — each present or absent,
    // like the three above. Both are booleans rather than vocabularies because each question has
    // two answers: something this session left running is still running, or it is not; something
    // it promised to do later can still fire, or it cannot.
    //
    // ⚠️ **645 · and `× 4` is 636's SIXTH** — a vocabulary rather than a boolean, so it is read off
    // `CONVERSATION_WAITS` and not written as a number: the three waits a conversation can be in
    // plus its absence.
    //
    // ⚑ **D-006 · and `× 3` is the SEVENTH** — stalled, answered, or absent.
    // ⚑ **F036 · and `× 2` is the EIGHTH** — an asker, or absent.
    expect(ALL).toHaveLength(
      (DOINGS.length + 1) *
        (BEINGS.length + 1) *
        (NEEDINGS.length + 1) *
        2 *
        2 *
        (CONVERSATION_WAITS.length + 1) *
        3 *
        2,
    )
    expect(ALL).toHaveLength(24_576)
    // The two that are named in the design and must NOT be a face on this component. `queued` is a
    // state of a MESSAGE and 077 owns it; `interrupted` is a turn's end_reason and a transcript
    // mark. Both were asked about explicitly, so both are pinned as absent — with the positive
    // pairing beside them, or this passes over an empty vocabulary.
    expect([...DOINGS, ...BEINGS]).not.toContain('queued')
    expect([...DOINGS, ...BEINGS]).not.toContain('interrupted')
    expect(DOINGS).toContain('unknown')
    expect(BEINGS).toContain('ended')
  })

  /**
   * ⛔ **645 · the test above guards the MEMBERS of each vocabulary. This one guards the AXES.**
   *
   * ⚠️ **Nothing guarded them, and that is how `636` landed a sixth facet into `AgentFacets` while
   * every sweep in this file went on passing over five.** ⚑ The compile-time half is the `-?` on
   * `FACET_AXES`; this is the run-time half, and it is the one that catches an axis DECLARED and
   * not SWEPT — which the compiler cannot see.
   */
  it('🔴 645 · every facet `AgentFacets` declares is an axis, and every axis is actually swept', () => {
    const swept = new Set(ALL.flatMap((facets) => Object.keys(facets)))
    expect([...swept].sort()).toEqual(Object.keys(FACET_AXES).sort())
    // …and the eight are the eight, named, so a key renamed on both sides at once still moves this.
    expect([...swept].sort()).toEqual([
      'being',
      'detached',
      'doing',
      'needing',
      'owes',
      'scheduled',
      'waiting',
      'work',
    ])
  })

  it('every value has a word, and no value has a glyph for a word', () => {
    for (const doing of DOINGS) expect(DOING_WORD[doing], doing).toBeTruthy()
    for (const being of BEINGS) expect(BEING_WORD[being], being).toBeTruthy()
    for (const needing of NEEDINGS) expect(NEEDING_WORD[needing], needing).toBeTruthy()
    // A screen reader cannot read a lock. Checked over every word rather than by inspection.
    for (const word of [
      ...Object.values(DOING_WORD),
      ...Object.values(BEING_WORD),
      ...Object.values(NEEDING_WORD),
    ]) {
      expect(word).not.toMatch(/#i-/)
      expect(word).toMatch(/[a-z]/)
    }
  })

  it('the words are distinct, so two states never read the same', () => {
    expect(new Set(Object.values(DOING_WORD)).size).toBe(DOINGS.length)
    expect(new Set(Object.values(BEING_WORD)).size).toBe(BEINGS.length)
    expect(new Set(Object.values(NEEDING_WORD)).size).toBe(NEEDINGS.length)
  })
})

describe('no colour is carried anywhere but tokens.css (acceptance 6)', () => {
  /** Every `--token` this module names, found mechanically so no hand-kept list can rot. */
  const named = [
    ...new Set([...source('lib/agent-state.ts').matchAll(/'(--[a-z0-9-]+)'/g)].map((m) => m[1]!)),
  ]

  it('names some tokens at all — the scan is not vacuous', () => {
    expect(named.length).toBeGreaterThanOrEqual(7)
    expect(named).toContain('--waiting')
    expect(named).toContain('--danger')
  })

  it('every token it names is declared in :root, and re-tuned for light', () => {
    // ⚠️ These are named in a .ts file, so NO component list can see them — `chat-theme.test.ts`
    // greps `.vue` sources for `var(--x)` and this module's tokens reach the DOM through an inline
    // style built here. That is precisely why they are checked at their source instead.
    for (const token of named) {
      expect(DARK[token], `${token} is not declared in :root`).toBeDefined()
      expect(LIGHT[token], `${token} has no light value — it would smear on paper`).toBeDefined()
      expect(LIGHT[token], `${token} did not actually change`).not.toBe(DARK[token])
    }
  })

  it('the component itself carries no hex, rgb or hsl', () => {
    const component = source('components/AgentState.vue')
    expect(component).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^<]*<\/)/)
    expect(component).not.toMatch(/\brgba?\(/)
    expect(component).not.toMatch(/\bhsla?\(/)
    // The positive half: it does paint, through tokens.
    expect(component).toContain('var(--badge-ink)')
    expect(component).toContain('var(--paper-line)')
  })

  it('--badge-ink is the ONE token 082 added, and it is white in both themes on purpose', () => {
    expect(DARK['--badge-ink']).toBe('#ffffff')
    // The plate is white on dark chrome, in the drawer and on paper. A light value would be the
    // same white, and `chat-theme.test.ts` rejects an override that does not change anything — so
    // its absence from §13 is the design, and this is the positive statement of it.
    expect(LIGHT['--badge-ink']).toBeUndefined()
    expect(source('components/AgentState.vue')).toContain('background: var(--badge-ink)')
  })
})

describe('the white plate is a light island (tokens.css §14)', () => {
  /**
   * ⚠️ **This said "and nothing else", and `126` retired that clause on purpose.**
   *
   * Its reason was containment: the island was a block of its own holding five values copied from
   * §13, and an island that quietly grew would be a second palette drifting from the first. The
   * test below was the guard against that drift.
   *
   * ⛔ **`126` gave `[data-on-white]` a second carrier — `ChildWorkViewer`'s paper — and five
   * tokens is not a palette for a surface that renders a whole conversation.** Measured in
   * Chromium: 34 text elements on that paper, 25 of them under 3:1, drawn from `--text-soft`,
   * `--code-text-dim`, `--mono-text`, `--muted` and the dark state colours. Listing what such a
   * surface needs is the mistake `086`, `087` and `091` each made once, so the island became §13's
   * OTHER SELECTOR rather than a hand-kept slice of it.
   *
   * So the containment rule is gone and the drift rule it protected is now unrepresentable: there
   * is one block. What is left to check is the half that still has content — every token the plate
   * actually draws is in that block, at a paper value. The `nothing else` half is replaced by the
   * structural assertion below, which is stronger than the sentence it retires.
   */
  it('re-declares every token drawn ON it — and shares ONE block with the light conversation', () => {
    expect(PLATE_TOKENS.length).toBeGreaterThan(0)
    for (const token of PLATE_TOKENS) {
      expect(PLATE[token], `${token} missing from the plate scope`).toBeDefined()
    }
    // …and it is a real palette rather than an empty rule — very much larger than the five the
    // plate itself draws, which is the whole reason 126 stopped hand-keeping it.
    expect(Object.keys(PLATE).length).toBeGreaterThan(PLATE_TOKENS.length * 4)

    /**
     * ⛔ **The structural claim, read off the STYLESHEET TEXT and not off two parses.**
     *
     * ⚠️ The first version asserted `Object.keys(PLATE)` equals `Object.keys(LIGHT)` — and review
     * proved that is `X` compared with `X`: `rule()` finds the first line-anchored match and then
     * scans forward for `{`, so both selectors resolve to the SAME byte range (open 24288, close
     * 33591) and the comparison cannot fail. Worse, it left a live escape: APPENDING a second
     * `[data-on-white] { --faint: #5f6979; }` at the end of the file leaves every test in this repo
     * green while the runtime cascade takes the last one — the plate silently back on the dark
     * value, which is precisely the drift the retired clause existed to prevent.
     *
     * So the claim is made about the file: the attribute appears in exactly one selector position,
     * and that position is §13's own rule. A re-split fails the second half; an appended block
     * fails the first.
     */
    expect(islandFindings(TOKENS)).toEqual([])
  })

  it('⛔ and each way the island could drift is refused', () => {
    const light = ":root,\n[data-chat-theme='light'],\n[data-on-white] {"
    expect(TOKENS.includes(light)).toBe(true)
    // A literal colour in the shared alias block: a second palette.
    expect(islandFindings(TOKENS.replace(light, `${light}\n  --faint: #5f6979;`))).toContain(
      'the shared alias block holds a value, not a reference: --faint',
    )
    // A rule that names the island on its own, appended at the end: it would win by order.
    expect(islandFindings(`${TOKENS}\n[data-on-white] { --faint: #5f6979; }`)).toContain(
      'the island is named in more than one place — a second block wins by source order',
    )
    // A derived rule for the island alone: the derived layer would split the two.
    expect(
      islandFindings(
        `${TOKENS}\n:where(:root[data-theme]:not([data-theme='classic'])) [data-on-white] { --faint: var(--muted); }`,
      ),
    ).toContain('a derived rule names the island without the light conversation')
  })

  it('at exactly the values the light conversation uses — one palette, not two', () => {
    // ⚠️ Two of these three are now true by construction (one block, two selectors) and are kept as
    // the statement of WHAT that construction buys. The third is not: `not.toBe(DARK[token])` is a
    // live check that the paper value actually differs from the near-black one, which no amount of
    // selector sharing guarantees.
    for (const token of PLATE_TOKENS) {
      expect(PLATE[token], `${token} missing from the plate scope`).toBeDefined()
      expect(PLATE[token], `${token} disagrees with the light conversation`).toBe(LIGHT[token])
      expect(PLATE[token], `${token} is still the dark value`).not.toBe(DARK[token])
    }
  })

  it('sits on the PLATE and not on the component root, so the underline stays on the surface', () => {
    // If the scope moved up to the root, an amber underline on near-black would be drawn at its
    // paper value — the same mistake as the badges, in the other direction. The attribute's
    // position is the rule, and it is not visible to any render assertion.
    // ⚠️ Matched as a TAG rather than as a fixed substring: `indexOf('class="plate" data-on-white')`
    // was the first version, and it would have gone red on a formatter reordering two attributes
    // that were both still there. Found in review.
    const component = source('components/AgentState.vue')
    const tagWith = (attribute: string): string[] =>
      [...component.matchAll(/<span[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => tag.includes(attribute))
    const islands = tagWith('data-on-white')
    expect(islands, 'the light-island scope is on no element at all').toHaveLength(1)
    expect(islands[0], 'the light island is not on the plate').toContain('class="plate"')
    // Everything the underline and the dot sit on must be OUTSIDE it, or a paper-dark amber line
    // would be drawn on near-black — the same mistake in the other direction.
    for (const outside of ['class="agent-state"', 'class="underline"', 'class="doing-dot"']) {
      expect(tagWith(outside).join(''), `${outside} carries the island`).not.toContain(
        'data-on-white',
      )
    }
  })
})

describe('the sprite has every glyph the badges name', () => {
  const sprite = source('components/IconSprite.vue')

  it('all FIVE the badges name, three of which 082 added', () => {
    // Derived from the maps rather than listed, so a new badge glyph is checked the moment it
    // exists. (A second hard-coded loop over the three additions used to sit here; it was a strict
    // subset of this one and added nothing — found in review.)
    const named = [
      ...Object.values(NEEDING_GLYPH),
      beingCondition('silent')!.glyph,
      beingCondition('errored')!.glyph,
    ]
    expect(new Set(named).size).toBe(5)
    for (const glyph of named) {
      expect(sprite, `${glyph} is not in the sprite`).toContain(`id="${glyph.slice(1)}"`)
    }
    // …and the three 082 added really were absent before, so this is not describing the status quo.
    expect(named).toEqual(expect.arrayContaining(['#i-lock', '#i-question', '#i-bang']))
  })

  it('each symbol id is defined exactly once', () => {
    const ids = [...sprite.matchAll(/id="(i-[a-z-]+)"/g)].map((m) => m[1]!)
    expect(ids.length).toBe(new Set(ids).size)
    // A duplicate id resolves to whichever the browser saw first, which is a silently wrong icon.
    // +1 in 087 (`i-compact`), +1 in 096 (`i-revert`, the deferred foot), +1 in 216
    // (`i-paperclip`), +1 in 254 (`i-image`, the chip for a pasted screenshot), ⛔ **−1 in 344**:
    // `i-sun` was the reading light's glyph and the toggle was its only caller, so retiring the
    // control left a symbol nothing draws. ⚑ This count is the repo's only guard on an orphaned
    // glyph, and it is why the sprite did not quietly keep it.
    // 38 since 358 added `#i-tool` — the glyph on the header button that opens the Tools sheet.
    // ⛔ **A new symbol rather than a borrowed one**: `#i-sliders` is Controls and `#i-terminal` is a
    // shell command, and a second meaning on either would make one shape say two things.
    // 39 since 376 added `#i-plus` — the rail's New project. ⛔ Also a new symbol rather than a
    // rotated `i-x`: a transform on a shared glyph makes one shape mean two things depending on a
    // class somebody may drop, and this count is the repo's only guard on an orphaned glyph.
    // 40 since 508 added `#i-list` — the Work tab. ⛔ **A new symbol rather than `#i-check`**, which
    // is already `NEEDING_GLYPH.plan` and means *waiting on you*: a tab whose subject is mostly
    // work that is still OPEN must not wear the tick that means finished, and must not borrow the
    // attention channel's glyph for a tally that is deliberately not an attention signal.
    // ⛔ **37 since D-016 took out `i-home`, `i-plus` and `i-link`**: only deleted code drew them.
    // The agent card adds #i-users for its Sub agents box, bringing this count to 38.
    // ⛔ **A new symbol rather than `#i-user`**, which is one person: the box holds agents.
    // 39 since the main panel's Graph tab (2026-09-30) added `#i-graph` — its tab's glyph.
    // 40 since the card's way up (2026-09-30) added `#i-up`. ⛔ A new symbol rather than a rotated
    // `#i-arrow`, for 376's reason above: a transform on a shared glyph makes one shape mean two.
    // 46 after the Settings rail gained its gear and the provider marks moved into ProviderMark:
    // an app-owned C and OpenAI's own image files replace the two unused provider symbols.
    // `#i-shield` went with the Waiting on you footer, and `#i-hourglass` came as the plate's
    // corner mark for an agent waiting on another agent (`#i-clock` is that corner's wake-up).
    // 47 with `#i-open`, the Open icon after a path in a message.
    // The agent knowledge button adds the Book glyph.
    expect(ids.length).toBe(48)
    expect(ids).toContain('i-book')
    expect(source('components/AgentBookButton.vue')).toContain('href="#i-book"')
  })

  /**
   * ⚠️ **The test 082's duplicate-id check could not be** (089). A `<use href="#i-nope">` renders an
   * empty `<svg>`: no error, no console warning, no missing-image glyph — a blank 16px box where an
   * icon was meant to be, on a control that still works. `#i-square` and `#i-help` shipped that way
   * and were found by reading, not by running. A duplicate DEFINITION is a wrong icon; a dangling
   * REFERENCE is no icon, and only one of the two had a test.
   *
   * It scans every renderer source file rather than the components it knows about, because the
   * failure is precisely the reference nobody thought to look at.
   *
   * ⚠️ **It cannot tell a live reference from prose, and that is the safe direction.** A comment
   * naming a `#i-…` that does not exist fails this test; the cure is to write the id without its
   * `#`, which two comments in this change now do. The opposite bias — skipping comments — is how a
   * reference inside a commented-out block comes back to life unchecked.
   */
  it('every sprite id the app names is one the sprite defines', () => {
    const defined = new Set([...sprite.matchAll(/id="(i-[a-z-]+)"/g)].map((match) => match[1]!))
    const referenced = new Map<string, string[]>()
    for (const file of rendererSources()) {
      const text = readFileSync(file, 'utf8')
      // Matches `href="#i-x"`, `:href="cond ? '#i-x' : '#i-y'"` and a bare '#i-x' in a glyph map
      // alike — the id is named the same way wherever it is written down. The sprite's own
      // `id="i-x"` cannot match, which is what keeps this from checking itself.
      for (const match of text.matchAll(/#(i-[a-z0-9-]+)/g)) {
        const at = referenced.get(match[1]!) ?? []
        at.push(file.split('/').at(-1)!)
        referenced.set(match[1]!, at)
      }
    }

    // A reference built from a template literal reads as its prefix, ending in `-`: it is a
    // FAMILY, and it dangles only when the sprite defines no member.
    const dangling = [...referenced].filter(([id]) =>
      id.endsWith('-') ? ![...defined].some((one) => one.startsWith(id)) : !defined.has(id),
    )
    expect(dangling.map(([id, where]) => `${id} (${[...new Set(where)].join(', ')})`)).toEqual([])

    // ⚠️ **The positive half, and this test is worthless without it.** An empty `referenced` map —
    // a broken glob, a regex that stopped matching, a renamed directory — would satisfy the line
    // above over nothing at all. These three are named because each is written a DIFFERENT way:
    // a static `href` attribute, a value in a TypeScript map, and one arm of an inline ternary.
    expect(referenced.get('i-send'), 'static href="#i-…" is no longer being read').toBeDefined()
    expect(
      referenced.get('i-lock'),
      "a '#i-…' in a .ts glyph map is no longer being read",
    ).toBeDefined()
    expect(
      referenced.get('i-play'),
      'a #i-… inside a :href ternary is no longer being read',
    ).toBeDefined()
    expect(referenced.size).toBeGreaterThan(20)

    // …and the two that were dangling really were referenced, so this is not passing because the
    // call sites were deleted. 089 fixed them by adding one symbol and reusing two that existed.
    expect(referenced.get('i-square'), 'the interrupt button lost its icon').toBeDefined()
    expect(defined.has('i-square'), 'i-square was never added to the sprite').toBe(true)
    expect(referenced.has('i-help'), 'i-help came back, and it is still not a symbol').toBe(false)
  })
})

describe('the size scale and its floor (081 §4)', () => {
  it('seven sizes, and exactly one of them is below the floor', () => {
    expect(Object.keys(SIZES)).toHaveLength(7)
    const below = Object.entries(SIZES).filter(([, px]) => isDotOnly(px))
    expect(below.map(([name]) => name)).toEqual(['dot'])
    expect(SIZES.compact).toBe(PLATE_FLOOR)
  })

  it('the floor is a number, so an arbitrary px size obeys it too', () => {
    expect(isDotOnly(PLATE_FLOOR)).toBe(false)
    expect(isDotOnly(PLATE_FLOOR - 1)).toBe(true)
    expect(platePx(23)).toBe(23)
    expect(isDotOnly(platePx(23))).toBe(true)
    expect(platePx('hero')).toBe(96)
    // An absent size is the dense default, not the biggest one.
    expect(platePx(undefined)).toBe(SIZES.avatar)
  })

  it('the scale descends — a name never means a bigger plate than the name above it', () => {
    const order = ['xl', 'hero', 'card', 'row', 'avatar', 'compact', 'dot'] as const
    const px = order.map((name) => SIZES[name])
    expect(px).toEqual([...px].sort((a, b) => b - a))
    expect(new Set(px).size).toBe(px.length)
  })
})

describe('the priority dot — the ONE thing a below-floor mark can say', () => {
  it('NEEDING > errored > live > silent > DOING, over every state there is', () => {
    for (const facets of ALL) {
      const token = priorityDotToken(facets)
      if (facets.needing) {
        expect(token, JSON.stringify(facets)).toBe(NEEDING_TOKEN[facets.needing])
      } else if (facets.being === 'errored') {
        expect(token, JSON.stringify(facets)).toBe('--danger')
      } else if (facets.being === 'live' || facets.being === 'starting') {
        expect(token, JSON.stringify(facets)).toBe('--accent')
      } else if (facets.being === 'silent') {
        expect(token, JSON.stringify(facets)).toBe('--waiting')
      }
    }
  })

  it('never falls back to a DOING colour while something needs you', () => {
    // The guarantee 063/079 §5 are written about, at the one size where only one thing can be said:
    // a dot that showed "thinking" blue while a permission waited would be an unanswered card with
    // no visible trace.
    const needy = ALL.filter((facets) => facets.needing !== undefined)
    // ⚠️ The first draft of this line was `toHaveLength(DOINGS.length + 1 === 8 ? needy.length :
    // needy.length)` — both arms of the ternary were `needy.length`, so it asserted a length
    // against itself and would have passed over an EMPTY set. Found in review. The literal below
    // is the whole point: it fails the day the cross-product stops being built properly.
    //
    // ⛔ **`× 2` is 250's fourth facet, and this line going red is the check working.** The dot can
    // say ONE thing; detached work must not be able to take the slot from an unanswered card, and
    // the only way to know it cannot is to sweep the states where both are true.
    // ⚑ **D-016 · three NEEDINGS again** (446's proposal went with proposals).
    // ⚑ **645 · × 4 is the sixth facet**, the three waits a conversation can be in, plus its
    // absence.
    // ⚑ **D-006 · × 3 is the seventh**: stalled, answered, or absent.
    // ⚑ **F036 · × 2 is the eighth**: an asker, or absent.
    expect(needy.length).toBe(8 * 8 * 3 * 2 * 2 * 4 * 3 * 2)
    for (const facets of needy) {
      expect(priorityDotToken(facets)).toBe(NEEDING_TOKEN[facets.needing!])
    }
  })

  it('always returns a token, and always one the theme declares', () => {
    for (const facets of ALL) {
      const token = priorityDotToken(facets)
      expect(token, JSON.stringify(facets)).toMatch(/^--[a-z0-9-]+$/)
      expect(DARK[token], `${token} is not a real token`).toBeDefined()
    }
  })

  it('an empty state is the neutral one — no hue is no claim', () => {
    expect(priorityDotToken({})).toBe(UNKNOWN_TOKEN)
    expect(priorityDotToken({ doing: 'unknown' })).toBe(UNKNOWN_TOKEN)
    expect(priorityDotToken({ doing: 'idle' })).toBe('--ready')
    expect(priorityDotToken({ doing: 'thinking' })).toBe('--accent')
  })
})

describe('the two condition badges never collide with the NEEDING corner (081 collision a)', () => {
  it('only silent and errored have one, so the bottom-right slot holds at most one thing', () => {
    const withBadge = BEINGS.filter((being) => beingCondition(being) !== null)
    expect(withBadge).toEqual(['silent', 'errored'])
    expect(beingCondition(undefined)).toBeNull()
    // BEING is a single value, which is WHY the clock and the `!` can share a corner safely. Stated
    // as an assertion so a future BEING that adds a second badge fails here rather than on screen.
    expect(beingCondition('silent')!.glyph).toBe('#i-clock')
    expect(beingCondition('errored')!.glyph).toBe('#i-bang')
    expect(beingCondition('silent')!.glyph).not.toBe(beingCondition('errored')!.glyph)
  })

  it('errored + permission is BOTH facts, in two different colours and two corners', () => {
    const condition = beingCondition('errored')!
    expect(condition.token).toBe('--danger')
    expect(NEEDING_TOKEN.permission).toBe('--waiting')
    expect(condition.token).not.toBe(NEEDING_TOKEN.permission)
    // And the underline still carries errored on its own, which is what makes NEEDING able to win
    // the one corner at the dot floor without the error going unsaid.
    expect(underlineFor('errored').token).toBe('--danger')
    expect(priorityDotToken({ being: 'errored', needing: 'permission' })).toBe('--waiting')
  })

  it('the clock belongs to silent, and to nothing else in this app any more', () => {
    // 081 collision b. `silent` counts UP; a queued message is HELD. One glyph for both was the bug.
    expect(beingCondition('silent')!.glyph).toBe('#i-clock')
    const queued = source('components/QueuedMessage.vue')
    expect(queued).toContain('#i-pause')
    expect(queued).not.toContain('#i-clock')
    // The rest of 077's bubble is untouched — the positive pairing for that absence.
    expect(queued).toContain('data-cy="queued-entry"')
    expect(queued).toContain('not sent')
    expect(queued).toContain('data-cy="cancel-queued"')
    expect(queued).toContain('data-cy="restore-queued"')
  })
})

describe('motion is two states, and reduced motion removes it', () => {
  it('only starting and closing pulse', () => {
    const pulsing = BEINGS.filter((being) => underlineFor(being).pulse)
    expect(pulsing).toEqual(['starting', 'closing'])
  })

  it('and the dotted ones are the states that are not steadily running', () => {
    const dotted = BEINGS.filter((being) => underlineFor(being).dotted)
    expect(dotted).toEqual(['unstarted', 'starting', 'silent'])
    expect(underlineFor('live').dotted).toBe(false)
  })

  it('the reduced-motion path exists and cancels the only animation there is', () => {
    // ⚠️ SSR has no media queries and no computed styles, so this is unassertable by rendering —
    // and it is the one setting nobody switches on by hand. Checked at the source.
    const component = source('components/AgentState.vue')
    expect(component).toContain('@media (prefers-reduced-motion: reduce)')
    const reduced = component.slice(component.indexOf('@media (prefers-reduced-motion'))
    expect(reduced).toContain('animation: none')
    // …and there is exactly one animation for it to cancel.
    expect([...component.matchAll(/animation:/g)]).toHaveLength(2)
  })

  it('every BEING gets a real token for its underline', () => {
    for (const being of BEINGS) {
      expect(BEING_TOKEN[being], being).toMatch(/^--/)
      expect(DARK[BEING_TOKEN[being]], BEING_TOKEN[being]).toBeDefined()
    }
    // `closing` is --muted and NOT the poster's orange: orange is --auto, and it belongs to the
    // unattended session. A second meaning for it would break the one place this app shouts.
    expect(BEING_TOKEN.closing).toBe('--muted')
    expect(Object.values(BEING_TOKEN)).not.toContain('--auto')
  })
})

describe('the accessible name (081 §7)', () => {
  it('is the sentence the design specified, for a three-facet composition', () => {
    expect(
      accessibleName({
        label: 'claude',
        doing: 'thinking',
        being: 'silent',
        silentSeconds: 40,
        needing: 'permission',
      }),
    ).toBe('claude — thinking, silent 40s, needs you (permission)')
  })

  it('omits an absent facet rather than saying it is absent', () => {
    expect(accessibleName({ label: 'claude', doing: 'idle' })).toBe('claude — idle')
    expect(accessibleName({ label: 'claude', doing: 'idle', being: 'live' })).toBe(
      'claude — idle, live',
    )
  })

  it('an absent doing is stated as unknown, not left out — the plate still draws something', () => {
    expect(accessibleName({})).toBe('agent — state unknown')
    expect(accessibleName({ label: 'zephyr' })).toBe('zephyr — state unknown')
  })

  it('the seconds reach the sentence only where they mean something', () => {
    expect(accessibleName({ being: 'silent', silentSeconds: 7 })).toContain('silent 7s')
    expect(accessibleName({ being: 'silent' })).toContain('silent')
    expect(accessibleName({ being: 'silent' })).not.toMatch(/silent \d/)
    // Not smuggled onto a state that is not counting.
    expect(accessibleName({ being: 'live', silentSeconds: 7 })).toBe('agent — state unknown, live')
    expect(accessibleName({ being: 'silent', silentSeconds: 0 })).toContain('silent 0s')
  })

  it('is a sentence for every state the sweep holds, and never contains a glyph', () => {
    for (const facets of ALL) {
      const name = accessibleName({ label: 'claude', ...facets })
      expect(name, JSON.stringify(facets)).toMatch(/^claude — [a-z]/)
      expect(name).not.toMatch(/#i-|--[a-z]/)
      expect(name).not.toContain('undefined')
      // ⛔ **Every facet that is SET has to be in the sentence, and nothing else may be.** This
      // arithmetic is what makes the sweep a census rather than a smoke test: 258's fifth clause
      // joined it because a mutation deleting that clause from `accessibleName` survived the whole
      // suite — the sentence for a scheduled conversation was asserted by nothing at all.
      //
      // 🔴 **645 · the sixth clause joins, and it is the only one with a CONDITION on it.** ⛔ The
      // wait is skipped when a NEEDING already names the same fact more specifically — *waiting on
      // you (permission)* names the card and *waiting on a person* beside it would be the app
      // saying one thing twice — so the census has to know the rule, not just the facet.
      // ⚑ **The oracle keeps its OWN copy of both predicates**, like the plate oracle further
      // down: asking `waitSummonsAPerson` or `summonsAttention` here would be asking the functions
      // under test, and `446`'s cost — widening a hand copy — is the price of a real measurement.
      const aPersonIsAsked = facets.waiting === 'waiting-on-a-person'
      const blocking = facets.needing === 'permission' || facets.needing === 'question'
      const saysTheWait = facets.waiting !== undefined && !(aPersonIsAsked && blocking)
      // 🔴 **D-006 · the seventh clause, said only where the one-word answer IS the work's** — an
      // idle plate with nothing above the work to say. ⚑ The oracle's own copy of `standingOf`'s
      // order, for the reason above. ⚑ **D-017b · whatever its BEING**: no standing says whether
      // anything stopped (`05` rule 5), so an `ended` or `unstarted` line no longer silences it.
      // ⚑ **F036 · the eighth clause, said whenever another agent waits on this one's answer** —
      // and it ranks above the idle plate's work, so the work is then not the one-word answer.
      const saysTheWork =
        facets.work !== undefined &&
        facets.doing === 'idle' &&
        !blocking &&
        facets.waiting === undefined &&
        facets.owes === undefined &&
        !facets.detached &&
        !facets.scheduled
      const said =
        1 +
        (facets.being ? 1 : 0) +
        (facets.detached ? 1 : 0) +
        (facets.scheduled ? 1 : 0) +
        (saysTheWait ? 1 : 0) +
        (facets.owes ? 1 : 0) +
        (saysTheWork ? 1 : 0) +
        (facets.needing ? 1 : 0)
      expect(name.split(', '), JSON.stringify(facets)).toHaveLength(said)
      // …and the phrase itself, so the count above cannot be satisfied by the wrong clause.
      expect(name.includes('work scheduled'), JSON.stringify(facets)).toBe(
        facets.scheduled === true,
      )
      // ⚑ The same pairing for the sixth, and it is the half that catches the wait being said with
      // the WRONG word: the count above is satisfied by any clause of the right arity.
      // ⚑ **UI-008** — a person's wait is said in the one state's *needs you*, the others in the
      // Work tab's words; matched as a whole clause, since *needs you (permission)* contains it.
      const waitWord =
        facets.waiting === undefined
          ? undefined
          : aPersonIsAsked
            ? 'needs you'
            : WORK_STATE_WORD[facets.waiting]
      expect(
        waitWord !== undefined && name.split(', ').includes(waitWord),
        JSON.stringify(facets),
      ).toBe(saysTheWait)
      // ⚑ **D-006 · and for the seventh**, with the word each state is said in.
      expect(name.includes(WORK_STATE_WORD.stalled), JSON.stringify(facets)).toBe(
        saysTheWork && facets.work?.state === 'stalled',
      )
      expect(name.includes('answered (done)'), JSON.stringify(facets)).toBe(
        saysTheWork && facets.work?.state === 'answered',
      )
    }
  })

  /**
   * ⛔ **645 · the DOT does not speak the sixth facet, and that is a DECISION rather than an
   * omission** — `AgentState.vue`'s `waiting` docblock argues it and this is what holds it.
   *
   * ⚠️ **`detached`'s reason does not carry over.** That facet is outranked in every state that can
   * carry it; this one is not — `waitSummonsAPerson` raises the `waiting` STANDING over a bare
   * `idle`, where the dot answers `--ready`. ⚑ The reason it is absent anyway is the dot's own
   * rule about what it may LEAVE OUT — *"the row's own text carries the word"* (`081` §4): no plate
   * of any size draws a wait, so a dot is safe exactly where it REPEATS a subject whose own row says
   * the word, or where its plate is never handed one and the dot's own line says the wait it knows.
   *
   * ⚠️ **`645` wrote here that the forest's task line *"draws `forest-says` beside the mark"*, and it
   * does not** — the word is on the holder conversation's own row, above; the task line's dot is
   * that row's `facets` object repeated. ⚑ Corrected by `651`.
   *
   * ⛔ **This test is the half of that ruling the dot itself owns.** The other half — that every dot
   * in the app is declared, with a proof that its word is somewhere or that no wait can reach it —
   * is `a-dot-says-one-thing.render.test.ts`.
   */
  it('🔴 645 · the priority dot ignores the wait, over every state there is', () => {
    let moved = 0
    for (const facets of ALL) {
      if (facets.waiting === undefined) continue
      const withoutTheWait = { ...facets }
      delete withoutTheWait.waiting
      expect(priorityDotToken(facets), JSON.stringify(facets)).toBe(
        priorityDotToken(withoutTheWait),
      )
      moved++
    }
    // Non-vacuity: the loop really compared states that carry a wait, rather than skipping them
    // all. ⛔ **The literal is the point**, as it is for the `needy` count above — a bound computed
    // from the axes it is checking fails the day the cross-product stops being built properly.
    // ⚑ 8 doings × 8 beings × 4 needings × 2 × 2 × the THREE waits a conversation can be in × 3
    // works (D-006) × 2 owes (F036).
    expect(moved).toBe(8 * 8 * 4 * 2 * 2 * 3 * 3 * 2)
  })

  it('🔴 D-006 · and ignores the work it holds, over every state there is', () => {
    // ⚑ `AgentState.vue`'s `work` docblock: the word is on the row beside the dot, and both new
    // standings' tones are blank — so a dot that took a colour from it would say a thing no word does.
    let moved = 0
    for (const facets of ALL) {
      if (facets.work === undefined) continue
      const withoutTheWork = { ...facets }
      delete withoutTheWork.work
      expect(priorityDotToken(facets), JSON.stringify(facets)).toBe(
        priorityDotToken(withoutTheWork),
      )
      moved++
    }
    // ⚑ 8 doings × 8 beings × 4 needings × 2 × 2 × 4 waits × the TWO works × 2 owes (F036).
    expect(moved).toBe(8 * 8 * 4 * 2 * 2 * 4 * 2 * 2)
  })

  it('a label renames and never re-hues (the StateBadge rule)', () => {
    const named = accessibleName({ label: '2 need you', doing: 'working', needing: 'question' })
    expect(named.startsWith('2 need you — ')).toBe(true)
    expect(priorityDotToken({ doing: 'working', needing: 'question' })).toBe(NEEDING_TOKEN.question)
  })
})

/* ---------------------------------------------------------------------------
   The adapters — what this app actually knows
   --------------------------------------------------------------------------- */

const base: SessionFacetInput = {
  phase: 'open',
  status: 'working',
  activity: null,
  streaming: false,
  liveness: 'live',
}

describe('what the agent is DOING, from the fields that know', () => {
  it('reads the activity phase where there is one', () => {
    expect(sessionDoing({ ...base, activity: { phase: 'thinking' } })).toBe('thinking')
    expect(sessionDoing({ ...base, activity: { phase: 'tool', detail: 'Bash' } })).toBe('tool')
    expect(sessionDoing({ ...base, activity: { phase: 'compacting' } })).toBe('compacting')
  })

  it('⚠️ streaming BEATS a stale tool activity — the ordering is the whole point', () => {
    // `activity` is cleared at turn END, so after a tool returns it still says `tool` while the
    // model is already streaming its answer. Believing it would draw an agent running a tool that
    // finished. This is the exact sequence the fold produces.
    expect(
      sessionDoing({ ...base, activity: { phase: 'tool', detail: 'Bash' }, streaming: true }),
    ).toBe('replying')
    // …and while a tool really IS running, nothing is streaming — the fold closes the open block
    // on `tool_call` — so `tool` still wins in the case it should.
    expect(
      sessionDoing({ ...base, activity: { phase: 'tool', detail: 'Bash' }, streaming: false }),
    ).toBe('tool')
  })

  it('the waiting activity phase is NOT a face — the badge says what it waits for', () => {
    expect(sessionDoing({ ...base, activity: { phase: 'waiting' } })).toBe('working')
    expect(DOINGS).not.toContain('waiting')
  })

  it('falls back to the host status, and never past it', () => {
    expect(sessionDoing({ ...base, status: 'working' })).toBe('working')
    expect(sessionDoing({ ...base, status: 'idle' })).toBe('idle')
    expect(sessionDoing({ ...base, status: 'waiting_permission' })).toBe('working')
    expect(sessionDoing({ ...base, status: null })).toBe('unknown')
  })

  it('a conversation nothing runs in here is not doing anything, however it stopped', () => {
    // ⚑ **D-017b · `recorded`** — drawn from its ledger, not fed here: a stale `streaming` on its
    // fold is no reply arriving.
    expect(sessionDoing({ ...base, phase: 'recorded', streaming: true })).toBe('idle')
    expect(sessionDoing({ ...base, status: 'ended' })).toBe('idle')
    expect(sessionDoing({ ...base, status: 'errored', activity: { phase: 'tool' } })).toBe('idle')
    expect(sessionDoing({ ...base, liveness: 'ended', streaming: true })).toBe('idle')
    // …and the same input on a conversation fed here still replies, so the four above are the stop.
    expect(sessionDoing({ ...base, streaming: true })).toBe('replying')
  })

  it('no word from anybody means no claim — the launcher’s input', () => {
    // ⚑ **D-017b · there is no `started` any more**: the launcher hands the adapter no phase, no
    // status and no liveness (`NewConversation.vue`'s `LAUNCHER_FACETS`), and that is the claim-free
    // input.
    const launcher = { ...base, phase: null, status: null, liveness: null }
    expect(sessionDoing(launcher)).toBe('unknown')
    expect(sessionFacets(launcher)).toEqual({ doing: 'unknown' })
  })

  it('every input produces a value in the vocabulary', () => {
    for (const status of [
      'idle',
      'working',
      'waiting_permission',
      'ended',
      'errored',
      null,
    ] as const) {
      for (const phase of ['thinking', 'tool', 'waiting', 'compacting', undefined] as const) {
        for (const streaming of [true, false]) {
          const doing = sessionDoing({
            ...base,
            status,
            activity: phase ? { phase } : null,
            streaming,
          })
          expect(DOINGS, `${status}/${phase}/${streaming}`).toContain(doing)
        }
      }
    }
  })
})

/**
 * The pill above the composer, from the same rule as the plate (089).
 *
 * ⚠️ **The bug this closes is not "the pill was wrong", it is "the app answered twice".** The pill
 * held its own map from `activity.phase` to a word, so for the length of every reply that followed
 * a tool call the plate said `replying` and the pill said RUNNING BASH, six inches apart, about the
 * same session. Every test here is therefore written against `activityLine` rather than against the
 * component — the component no longer decides anything.
 */
describe('the activity line — one answer, two places it is drawn (089)', () => {
  const line = (over: Partial<SessionFacetInput>): ReturnType<typeof activityLine> =>
    activityLine({ ...base, ...over })

  it('⚠️ says REPLYING, not "running Bash", once the model is streaming', () => {
    // The fold’s `tool_result` does not clear `activity`, so the frame still reads `tool`
    // while deltas arrive. Assert the resulting on-screen sentence.
    const streaming = line({ activity: { phase: 'tool', detail: 'Bash' }, streaming: true })
    expect(streaming?.word).toBe('replying')
    expect(streaming?.doing).toBe('replying')
    // ⚠️ **The tool's NAME has to go too.** Keeping it would move the lie one word right: the pill
    // would read "REPLYING BASH", which is a claim about a call that has already returned.
    expect(streaming?.detail).toBeUndefined()

    // …and while the tool really is running, it still says so — this is not a blanket suppression.
    const running = line({ activity: { phase: 'tool', detail: 'Bash' }, streaming: false })
    expect(running?.word).toBe('running')
    expect(running?.detail).toBe('Bash')
  })

  /**
   * ⚠️ **The oracle below is written out by hand, and that is the point** (089 review).
   *
   * The first version of this test asserted `drawn.doing === sessionDoing(input)` — which
   * `activityLine` satisfies BY CONSTRUCTION, because it assigns `const doing = sessionDoing(input)`
   * and returns it. It could not fail. A tautology in the test that exists to prove the app has one
   * answer is a particularly bad one to write, and review caught it.
   *
   * That the pill and the plate share a source is structural (one call, one object) and is proved
   * where it is observable — `conversation-chrome.render.test.ts` renders both and reads the two
   * `data-doing` attributes. What is checked HERE is the part that is genuinely `activityLine`'s
   * own: which inputs speak at all, and what they say.
   */
  it('says exactly what an independently written rule says, over every input there is', () => {
    /**
     * A phase without a running turn must not produce a pill. The four phases with `status:
     * idle` and the four with `status: null` all return null, reducing `spoke` from 32 to 24.
     * Assert both the eight silent cells and the count so activity cannot override the host’s
     * idle state.
     */
    const expected = (
      status: SessionStatus | null,
      phase: string | undefined,
      streaming: boolean,
    ) => {
      if (status === 'ended' || status === 'errored') return null
      if (phase === undefined) return null
      // Text arriving beats everything, including the host's word — that is the ten seconds before
      // the screenshot, where a reply streamed on after `turn completed` had already said `idle`.
      if (streaming) return { word: 'replying', tone: 'live' }
      // …and with nothing streaming, the pill speaks only for a session the host calls running.
      if (status !== 'working' && status !== 'waiting_permission') return null
      if (phase === 'thinking') return { word: 'thinking', tone: 'live' }
      if (phase === 'tool') return { word: 'running', tone: 'live' }
      if (phase === 'compacting') return { word: 'compacting context', tone: 'waiting' }
      return { word: 'waiting', tone: 'waiting' }
    }

    let spoke = 0
    /** The cells 099 silenced — counted, so "8 fewer" is asserted rather than arithmetic. */
    let silencedByStatus = 0
    for (const status of [
      'idle',
      'working',
      'waiting_permission',
      'ended',
      'errored',
      null,
    ] as const)
      for (const phase of ['thinking', 'tool', 'waiting', 'compacting', undefined] as const)
        for (const streaming of [true, false]) {
          const input = { ...base, status, activity: phase ? { phase } : null, streaming }
          const where = `${status}/${phase}/${streaming}`
          const want = expected(status, phase, streaming)
          if (want === null) {
            expect(activityLine(input), where).toBeNull()
            if (phase !== undefined && !streaming && (status === 'idle' || status === null)) {
              silencedByStatus++
            }
          } else {
            expect(activityLine(input), where).toMatchObject(want)
            spoke++
          }
        }
    // …and the sweep is not all nulls, which is the only way the branch above could pass over
    // nothing at all. 4 non-terminal statuses × 4 phases while streaming, plus the 2 statuses that
    // mean a turn is running × 4 phases while not.
    expect(spoke).toBe(24)
    // The other half of the same fact, so the number above cannot drop for a different reason and
    // still pass: the 8 cells that fell out are precisely "a phase with no running turn".
    expect(silencedByStatus).toBe(8)
  })

  it('says nothing at all when there is nothing to say', () => {
    expect(line({ activity: null, status: 'working' })).toBeNull()
    // The positive beside it: the same input WITH a phase does produce a line, so the null above is
    // the absent activity and not a broken function.
    expect(line({ activity: { phase: 'thinking' }, status: 'working' })).not.toBeNull()
  })

  it('⚠️ a session that died mid-turn stops pulsing at it', () => {
    // `activity` is cleared by the `turn` event, and a session killed mid-turn never gets one — so
    // the field outlives the conversation. The old pill went on saying "running Bash" at a corpse.
    // ⚑ **D-017b** — a fold that ended is `recorded`; a conversation nobody has heard about has no
    // status.
    expect(line({ activity: { phase: 'tool', detail: 'Bash' }, phase: 'recorded' })).toBeNull()
    expect(line({ activity: { phase: 'tool', detail: 'Bash' }, status: 'errored' })).toBeNull()
    expect(line({ activity: { phase: 'thinking' }, status: null })).toBeNull()
    // …and the identical input on a live session still speaks, so those three are the ending.
    expect(line({ activity: { phase: 'tool', detail: 'Bash' } })?.word).toBe('running')
  })

  it('keeps the amber that means "waiting on something", and both states that had it', () => {
    const waiting = line({ activity: { phase: 'waiting' } })
    // The word is not "working": the phase is Claude's `requesting`, where the model has not begun.
    expect(waiting).toMatchObject({ word: 'waiting', tone: 'waiting', doing: 'working' })
    // ⚠️ **`compacting` was amber before this change and still is** (089 review). Re-deriving tone
    // from the DOING alone turned it blue, which was a colour nobody asked to change: the context
    // window is being rewritten and the conversation cannot take a turn until it is done.
    expect(line({ activity: { phase: 'compacting' } })).toMatchObject({
      word: 'compacting context',
      tone: 'waiting',
    })
    // …and the two that are work rather than waiting keep the blue, so the amber above is a claim.
    for (const phase of ['thinking', 'tool'] as const) {
      expect(line({ activity: { phase } })?.tone, phase).toBe('live')
    }
    expect(line({ activity: { phase: 'thinking' }, streaming: true })?.tone).toBe('live')
  })

  it('never lets a detail outlive the phase that wrote it', () => {
    // ⚠️ **Asserted as an equality on `detail` itself** (089 review). This read
    // `if (drawn.detail !== undefined) expect(sessionDoing(…)).toBe(drawn.doing)` — and
    // `sessionDoing` does not read `detail` at all, so both sides were the same call and the rule
    // the test is named for was never checked. A version of `activityLine` that spread the tool
    // name onto every line would have passed it.
    for (const phase of ['thinking', 'tool', 'waiting', 'compacting'] as const) {
      for (const streaming of [true, false]) {
        const drawn = line({ activity: { phase, detail: 'Bash' }, streaming })
        const where = `${phase}/${streaming}`
        expect(drawn, where).not.toBeNull()
        // Streaming means the doing has moved on to `replying`, so the name of the call that
        // finished must be gone. Not streaming means the phase IS the answer, so it stays.
        expect(drawn?.detail, where).toBe(streaming ? undefined : 'Bash')
        expect(drawn?.word, where).not.toContain('undefined')
      }
    }
  })
})

describe('what the agent IS', () => {
  /**
   * ⚑ **D-017b · the BEINGS a conversation's plate can still draw** — the three this app states of
   * its own conversations. ⛔ `live`, `ended`, `errored` and `unstarted` said whether a provider
   * process runs (`05` rule 5), so the session adapter never draws them; they stay in the vocabulary
   * because a sub-agent's and a workflow's card still draw them (`a sub-agent, from its card`).
   */
  const DRAWN_OF_A_CONVERSATION = ['starting', 'silent', 'closing'] as const
  const PROCESS_WORDS = ['unstarted', 'live', 'ended', 'errored'] as const
  const STATUSES = ['idle', 'working', 'waiting_permission', 'ended', 'errored', null] as const
  const LIVENESSES = ['live', 'silent', 'ended', 'errored', null] as const

  it('is the provider’s SILENCE, the one liveness that is a condition, and nothing else it says', () => {
    expect(sessionBeing({ ...base, liveness: 'silent' })).toBe('silent')
    // ⚑ **D-017b** — `live` draws nothing (it would tell a conversation fed here from one drawn
    // from its ledger), and a stop draws nothing either.
    for (const state of ['live', 'ended', 'errored'] as const) {
      expect(sessionBeing({ ...base, liveness: state }), state).toBeUndefined()
      expect(BEINGS).toContain(state)
    }
  })

  it('opening is starting, and the launcher draws no line', () => {
    expect(sessionBeing({ ...base, phase: 'opening', liveness: 'live' })).toBe('starting')
    // ⚑ **D-017b · no `unstarted`**: the launcher's input carries no process fact at all.
    expect(sessionBeing({ ...base, phase: null, status: null, liveness: null })).toBeUndefined()
  })

  it('⚑ D-017b · a stop draws NO line, whichever channel says it', () => {
    expect(sessionBeing({ ...base, liveness: null, phase: 'recorded' })).toBeUndefined()
    expect(sessionBeing({ ...base, liveness: null, status: 'ended' })).toBeUndefined()
    expect(sessionBeing({ ...base, liveness: null, status: 'errored' })).toBeUndefined()
    // …and a stale silence under a stop is no clock either.
    expect(sessionBeing({ ...base, liveness: 'silent', phase: 'recorded' })).toBeUndefined()
    expect(sessionBeing({ ...base, liveness: 'silent', status: 'ended' })).toBeUndefined()
    // The paired positive: the same silence on a conversation that has not stopped IS drawn.
    expect(sessionBeing({ ...base, liveness: 'silent' })).toBe('silent')
  })

  /**
   * `closing` used to be a value the vocabulary carried, the component drew, and no input could
   * produce — the shape a reviewer deletes in six weeks (089). It has a source now, and the source
   * is this app's own close command rather than anything the provider says.
   */
  it('⚠️ is CLOSING while a close we asked for has not landed — and liveness cannot say it', () => {
    // The window: the host is draining and archiving (075), and for all of it the provider is live.
    expect(sessionBeing({ ...base, phase: 'closing', liveness: 'live' })).toBe('closing')
    expect(sessionBeing({ ...base, phase: 'closing', liveness: null })).toBe('closing')
    // ⚠️ It shadows `silent` (089 review): quiet is what teardown looks like.
    expect(sessionBeing({ ...base, phase: 'closing', liveness: 'silent' })).toBe('closing')
    // The same session one frame earlier, so the lines above are the phase and not the fixture.
    expect(sessionBeing({ ...base, phase: 'open', liveness: 'silent' })).toBe('silent')
    expect(sessionBeing({ ...base, phase: 'open', liveness: 'live' })).toBeUndefined()
    // ⚠️ **And it is the WEAKER fact.** Once the stop lands, "on its way out" is history; a
    // session drawn as closing after it has stopped is the same staleness in a new place.
    expect(sessionBeing({ ...base, phase: 'closing', status: 'ended' })).toBeUndefined()
    expect(sessionBeing({ ...base, phase: 'closing', status: 'errored' })).toBeUndefined()
    expect(sessionBeing({ ...base, phase: 'closing', liveness: 'ended' })).toBeUndefined()
  })

  it('the value is reachable, which is the whole point of feeding it — and no process word is', () => {
    // A guard against this becoming drawable-but-dead again: `closing` must be in the image of
    // `sessionBeing`, not merely in the vocabulary.
    const reachable = new Set<Being | undefined>()
    for (const phase of ['opening', 'open', 'closing', 'recorded', null] as const)
      for (const liveness of LIVENESSES)
        for (const status of STATUSES)
          reachable.add(sessionBeing({ ...base, phase, liveness, status }))
    expect(reachable).toContain('closing')
    // ⚑ **D-017b · the image is exactly the three a conversation draws, and the absent line.**
    expect(reachable).toEqual(new Set([...DRAWN_OF_A_CONVERSATION, undefined]))
    for (const word of PROCESS_WORDS) expect(reachable, word).not.toContain(word)
  })

  it('⚠️ a STOP beats a stale liveness, in BOTH directions, and the two facets never contradict', () => {
    // The two channels land in either order, and the first version of `sessionBeing` read
    // `if (input.liveness) return input.liveness` before any terminal check. Both windows were
    // real and both drew a self-contradicting plate. Found in review.
    //
    // Direction 1 — the fold knows first, liveness still says silent (the one it would draw):
    const foldFirst = { ...base, status: 'ended' as const, liveness: 'silent' as const }
    expect(sessionBeing(foldFirst)).toBeUndefined()
    expect(sessionDoing(foldFirst)).toBe('idle')
    // Direction 2 — liveness knows first, the fold still says working:
    const livenessFirst = { ...base, status: 'working' as const, liveness: 'ended' as const }
    expect(sessionBeing(livenessFirst)).toBeUndefined()
    expect(sessionDoing(livenessFirst)).toBe('idle')
    // ⚑ **D-017b** — an error from either side is a stop like any other: no line, an idle face.
    expect(sessionBeing({ ...base, status: 'errored', liveness: 'silent' })).toBeUndefined()
    expect(sessionDoing({ ...base, status: 'errored', liveness: 'silent' })).toBe('idle')
    expect(sessionBeing({ ...base, status: 'working', liveness: 'errored' })).toBeUndefined()
    expect(sessionDoing({ ...base, status: 'working', liveness: 'errored' })).toBe('idle')
    // The positive beside them: the same fold on a provider that has not stopped is working.
    expect(sessionDoing({ ...base, status: 'working', liveness: 'live' })).toBe('working')
  })

  it('and the pair is consistent for EVERY input, not just the two windows above', () => {
    // The property, rather than the examples: a conversation nothing runs in here is never drawn
    // as doing something, nor with a line — and the one line a running one may draw is the
    // provider's own silence. ⚑ The oracle keeps its OWN copy of what a stop is.
    let stopped = 0
    let silent = 0
    for (const phase of ['open', 'recorded'] as const)
      for (const status of STATUSES)
        for (const liveness of LIVENESSES)
          for (const streaming of [true, false]) {
            const input = { ...base, phase, status, liveness, streaming }
            const being = sessionBeing(input)
            const doing = sessionDoing(input)
            const why = `${phase}/${status}/${liveness}/${streaming}`
            const stop =
              phase === 'recorded' ||
              status === 'ended' ||
              status === 'errored' ||
              liveness === 'ended' ||
              liveness === 'errored'
            if (stop) {
              expect(doing, `${why}: stopped, but drawn as ${doing}`).toBe('idle')
              expect(being, `${why}: stopped, but drew a line`).toBeUndefined()
              stopped++
            } else if (being !== undefined) {
              expect(being, `${why}: a line the provider did not say`).toBe('silent')
              expect(liveness, why).toBe('silent')
              silent++
            }
          }
    // …and both branches were actually reached, or the property held over nothing.
    expect(stopped).toBeGreaterThan(0)
    expect(silent).toBeGreaterThan(0)
  })

  it('and says NOTHING when it does not know — no underline is a real answer', () => {
    expect(sessionBeing({ ...base, liveness: null, status: 'working' })).toBeUndefined()
    expect(sessionFacets({ ...base, liveness: null, status: 'working' }).being).toBeUndefined()
    // The positive pairing: the same input still produces a DOING, so this is an absent facet
    // rather than an empty result.
    expect(sessionFacets({ ...base, liveness: null, status: 'working' }).doing).toBe('working')
  })

  it('⚠️ closing is in the vocabulary and NOTHING emits it — the gap is named, not filled', () => {
    // Nothing in this app observes the window between "close was asked for" and "the provider said
    // ended". Manufacturing it would be 035's fabrication; leaving the value out would mean the day
    // a source appears the component changes too. So: drawable, and unreachable from the adapter.
    expect(BEINGS).toContain('closing')
    const reachable = new Set<Being | undefined>()
    for (const phase of ['opening', 'open', 'recorded', null] as const)
      for (const liveness of LIVENESSES)
        for (const status of STATUSES)
          reachable.add(sessionBeing({ ...base, phase, liveness, status }))
    expect([...reachable]).not.toContain('closing')
    // …and every OTHER value a conversation's plate draws is reachable, so this is a statement
    // about `closing` and not about a function that returns one thing.
    for (const being of DRAWN_OF_A_CONVERSATION.filter((value) => value !== 'closing')) {
      expect([...reachable], being).toContain(being)
    }
  })
})

describe('what the agent NEEDS from you', () => {
  it('permission outranks question outranks plan', () => {
    const at = (over: Partial<Parameters<typeof needingFor>[0]> = {}) =>
      needingFor({ permissions: 0, questions: 0, planNeedsGoAhead: false, ...over })
    expect(at({ permissions: 1, questions: 1, planNeedsGoAhead: true })).toBe('permission')
    expect(at({ questions: 1, planNeedsGoAhead: true })).toBe('question')
    expect(at({ planNeedsGoAhead: true })).toBe('plan')
    expect(at()).toBeUndefined()
  })

  it('a zero count is not a badge — the falsy-zero trap, pinned', () => {
    expect(needingFor({ permissions: 0, questions: 0, planNeedsGoAhead: false })).toBeUndefined()
    expect(needingFor({ permissions: 2, questions: 0, planNeedsGoAhead: false })).toBe('permission')
  })
})

describe('a sub-agent, from its card (082 adoption)', () => {
  it('running says what it is on', () => {
    expect(subAgentFacets({ running: true, lastTool: 'Bash' })).toEqual({
      doing: 'tool',
      being: 'live',
    })
    expect(subAgentFacets({ running: true })).toEqual({ doing: 'working', being: 'live' })
  })

  it('a reported ending is drawn; failed is the only red one', () => {
    expect(subAgentFacets({ running: false, outcome: 'completed' }).being).toBe('ended')
    expect(subAgentFacets({ running: false, outcome: 'interrupted' }).being).toBe('ended')
    expect(subAgentFacets({ running: false, outcome: 'failed' }).being).toBe('errored')
  })

  it('⚠️ an unreported ending is FACELESS and has no underline — "we were not told" ≠ "it finished"', () => {
    const facets = subAgentFacets({ running: false })
    expect(facets.doing).toBe('unknown')
    expect(facets.being).toBeUndefined()
    // Which is a different drawing from every ending we WERE told about — the positive pairing, or
    // this passes over a function that returns an empty object for everything.
    expect(subAgentFacets({ running: false, outcome: 'completed' }).doing).toBe('idle')
    expect(subAgentFacets({ running: false, outcome: 'completed' }).being).toBeDefined()
  })

  it('the five written outcomes still differ — the mark did not flatten them', () => {
    const entry = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/SubAgentEntry.vue', import.meta.url)),
      'utf8',
    )
    for (const word of ['running', 'completed', 'failed', 'interrupted', 'ended']) {
      expect(entry, `${word} is no longer written out`).toContain(`: '${word}'`)
    }
    // …and the dot that used to carry the colour is gone rather than left beside the plate.
    expect(entry).not.toContain('<span class="dot"')
    expect(entry).toContain('<AgentState')
  })
})

describe('one counter, not two (082 hazard 1)', () => {
  it('the component never counts — no timer, no clock of its own', () => {
    const component = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/AgentState.vue', import.meta.url)),
      'utf8',
    )
    for (const forbidden of ['setInterval', 'setTimeout', 'Date.now', 'requestAnimationFrame']) {
      expect(component, `AgentState started its own ${forbidden}`).not.toContain(forbidden)
    }
    // The positive half: it does take the number, it just does not produce it.
    expect(component).toContain('silentSeconds')
  })

  it('and the header hands over the one it already had', () => {
    const header = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/components/SessionHeader.vue', import.meta.url)),
      'utf8',
    )
    // `silentFor` is the header's own computed, ticked off `liveness.since` once a second. The pill
    // and the plate therefore read the same number in the same frame, by construction.
    expect(header).toMatch(/:silent-seconds="[^"]*silentFor/)
    expect(header).toContain('const silentFor = computed(')
    expect([...header.matchAll(/setInterval\(/g)]).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------------------
   The cheap projection the rail uses
   --------------------------------------------------------------------------- */

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

function withPermission(): TranscriptState {
  return feed(createTranscript(), {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action: 'Bash',
    detail: 'ls -la',
    scope: {
      cwd: '/tmp/scratch',
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny'],
      underDisclosed: false,
    },
  })
}

describe('pendingKind agrees with the panel it short-circuits (082)', () => {
  it('names a waiting permission, and the panel counts the same one', () => {
    const state = withPermission()
    expect(sessionPanel(state).waiting).toBe(1)
    expect(pendingKind(state)).toBe('permission')
  })

  it('is null exactly when the panel counts nothing', () => {
    const empty = createTranscript()
    expect(sessionPanel(empty).waiting).toBe(0)
    expect(pendingKind(empty)).toBeNull()
  })

  it('names a waiting QUESTION too — the branch that had no test at all', () => {
    // Found in review: all three original tests used permissions, so `if (item.kind === 'userInput')
    // return 'question'` could have been deleted and every one of them stayed green.
    const state = feed(createTranscript(), {
      type: 'user_input_request',
      id: 'ask_1',
      prompt: 'Which database should the importer read?',
      questions: [
        {
          id: 'q1',
          prompt: 'Which database?',
          options: [{ label: 'primary' }, { label: 'replica' }],
        },
      ],
    })
    expect(sessionPanel(state).waiting).toBe(1)
    expect(sessionPanel(state).questions).toHaveLength(1)
    expect(pendingKind(state)).toBe('question')
  })

  it('⚠️ and with BOTH open it names the one the panel would — priority, not position', () => {
    // THE BUG THIS TEST EXISTS FOR. `pendingKind` scanned backwards and returned the first hit,
    // which is the LAST card in transcript order. With an older permission and a newer question,
    // the rail drew a `?` while the top bar drew a lock — about the same session, in the same
    // window. Two answers to one question. Found in review.
    const state = withPermission()
    feed(state, {
      type: 'user_input_request',
      id: 'ask_1',
      prompt: 'Which database?',
      questions: [
        {
          id: 'q1',
          prompt: 'Which database?',
          options: [{ label: 'primary' }, { label: 'replica' }],
        },
      ],
    })
    const panel = sessionPanel(state)
    expect(panel.permissions).toHaveLength(1)
    expect(panel.questions).toHaveLength(1)
    const viaPanel = needingFor({
      permissions: panel.permissions.length,
      questions: panel.questions.length,
      planNeedsGoAhead: false,
    })
    const viaRail = pendingKind(state)
    expect(viaPanel).toBe('permission')
    expect(viaRail).toBe('permission')
    expect(viaRail).toBe(viaPanel)
  })

  it('and an answered card leaves both — one predicate, read twice', () => {
    const state = withPermission()
    feed(state, { type: 'user_decision', requestId: 'req_1', outcome: 'allow' })
    expect(sessionPanel(state).waiting).toBe(0)
    expect(pendingKind(state)).toBeNull()
  })
})

/* ---------------------------------------------------------------------------
   099 — the precedence, and the coarse word that has to agree with it
   --------------------------------------------------------------------------- */

/**
 * **`status` frames, `activity` refines** (099).
 *
 * ⚠️ This is the third time one class of defect has been fixed in this slice, so the tests are
 * written about the CLASS rather than about the instance: what is asserted is that a fact with no
 * ending can never outrank one that has an ending, in either direction.
 */
describe('a stale activity cannot make an idle session look busy (099)', () => {
  it('⚠️ the measured state — a phase published after the turn closed', () => {
    // Plant a completed turn, then host `idle`, then a background sub-agent’s
    // `{phase:'waiting'}` twelve seconds later. No running turn remains to clear that phase
    // and no later turn follows.
    const stale: SessionFacetInput = { ...base, status: 'idle', activity: { phase: 'waiting' } }
    expect(sessionDoing(stale)).toBe('idle')
    expect(activityLine(stale)).toBeNull()

    // …and the pairing, which is what stops the two lines above from being satisfied by a function
    // that answers `idle` to everything: the identical activity on a running turn still refines it.
    const live: SessionFacetInput = { ...base, status: 'working', activity: { phase: 'waiting' } }
    expect(sessionDoing(live)).toBe('working')
    expect(activityLine(live)).toMatchObject({ word: 'waiting', tone: 'waiting' })
  })

  it('every phase refines a running turn and none of them promotes an idle one', () => {
    /** The DOING each phase means, written out here rather than imported from the map under test. */
    const REFINEMENT = {
      thinking: 'thinking',
      tool: 'tool',
      compacting: 'compacting',
      waiting: 'working',
    } as const
    for (const phase of ['thinking', 'tool', 'waiting', 'compacting'] as const) {
      // Refines: the plate says WHICH kind of busy, and says the same thing on both busy statuses.
      expect(sessionDoing({ ...base, status: 'working', activity: { phase } }), phase).toBe(
        REFINEMENT[phase],
      )
      expect(
        sessionDoing({ ...base, status: 'waiting_permission', activity: { phase } }),
        phase,
      ).toBe(REFINEMENT[phase])
      // Never promotes: the host says no turn is being driven, so nothing is.
      expect(sessionDoing({ ...base, status: 'idle', activity: { phase } }), phase).toBe('idle')
      // …and with no word from the host at all, we do not know — 081's ring, not a face.
      expect(sessionDoing({ ...base, status: null, activity: { phase } }), phase).toBe('unknown')
    }
  })

  it('⚠️ streaming still outranks the host, which is 042 direction and the person saw it too', () => {
    // Between 19:35:50 and 19:36:07 his model streamed a whole message with the turn already
    // closed. `idle` was the host's honest answer to "am I driving a turn" and the wrong answer to
    // "is anything happening". The delta arriving is the freshest fact there is.
    expect(sessionDoing({ ...base, status: 'idle', streaming: true })).toBe('replying')
    expect(sessionDoing({ ...base, status: null, streaming: true })).toBe('replying')
    // …and once the message lands, `closeStreaming` drops the flag and the session reads idle again.
    expect(sessionDoing({ ...base, status: 'idle', streaming: false })).toBe('idle')
  })

  it('a new turn inherits no phase from the last one', () => {
    const state = createTranscript()
    feed(state, { type: 'status', state: 'working' })
    feed(state, { type: 'activity', phase: 'tool', detail: 'Bash' })
    // ⚠️ **The `turn` event clears it, asserted HERE for the first time.** Until 099 the only thing
    // holding this was `ui-live-smoke`'s "the activity pill outlived the turn" — and the precedence
    // fix above now suppresses that pill on an idle session whatever the field says, so a fold that
    // stopped clearing would have gone from caught to invisible. Named in the response as coverage
    // this change moved rather than coverage it added.
    feed(state, { type: 'turn', state: 'completed' })
    expect(state.activity).toBeNull()

    // The event that arrives with no turn open, which nothing clears — 32% of them.
    feed(state, { type: 'activity', phase: 'tool', detail: 'Bash' })
    expect(state.activity).toEqual({ phase: 'tool', detail: 'Bash' })
    // The next turn starts clean, so the previous turn's tool name cannot be drawn against it.
    feed(state, { type: 'user_turn', text: 'next' })
    expect(state.activity).toBeNull()
  })
})

/**
 * The coarse word the top bar and the rail row show — a PROJECTION of the facets, never a second
 * reading of the session (099).
 */
describe('the one-word answer, and that it cannot contradict the plate (099)', () => {
  it('every facet combination produces a word in the vocabulary', () => {
    const seen = new Set<string>()
    for (const doing of [...DOINGS, undefined] as (Doing | undefined)[])
      for (const being of [...BEINGS, undefined] as (Being | undefined)[])
        for (const needing of [...NEEDINGS, undefined] as (Needing | undefined)[])
          // ⛔ **The FOURTH facet joins the sweep** (250). A census that swept three of four would
          // have gone on passing over `background` for ever, which is `193`'s vacuity: the count
          // below is the only thing that noticed, and it noticed because the sweep was widened
          // rather than because the assertion was.
          for (const detached of [true, false])
            // ⛔ **And the FIFTH** (258), for the reason the fourth joined: a census that swept four
            // of five would pass over `scheduled` for ever, and the count below is the only thing
            // that would notice.
            for (const scheduled of [true, false])
              // ⛔ **And the SIXTH** (636), for the reason the fourth and fifth joined — and this
              // time the count below is what CAUGHT it: the sweep was widened in the same edit
              // that added `elsewhere`, and had it not been, nine of ten would have gone on
              // passing for ever. ⚑ **`CONVERSATION_WAITS` and not a literal list**: the roster is
              // derived from `TASK_STATES`' own `waiting-on-` prefix (`609`), so a new wait a
              // conversation can be in joins this census without anybody remembering to add it —
              // `a-loop-over-a-literal-variant-list-is-not-exhaustive`.
              for (const waiting of [...CONVERSATION_WAITS, undefined] as (
                ConversationWait | undefined
              )[])
                // ⛔ **And the SEVENTH** (D-006), from this file's registry — the count below
                // caught it again: `stalled` and `answered` are reached only through it.
                for (const work of FACET_AXES.work)
                  // ⛔ **And the EIGHTH** (F036) — `owes` is reached only through it.
                  for (const owes of FACET_AXES.owes) {
                    const facets = {
                      doing,
                      being,
                      needing,
                      detached,
                      scheduled,
                      waiting,
                      work,
                      ...(owes ? { owes } : {}),
                    }
                    const standing = standingOf(facets)
                    expect(
                      STANDINGS,
                      `${doing}/${being}/${needing}/${detached}/${scheduled}/${waiting}/${work?.state}/${owes?.[0]}`,
                    ).toContain(standing)
                    expect(STANDING_LABEL[standing]).toBeTruthy()
                    expect(STANDING_TONE).toHaveProperty(standing)
                    expect(standingWord(facets)).toBeTruthy()
                    seen.add(standing)
                  }
    // Non-vacuity: the sweep exercised the whole vocabulary rather than collapsing to one answer.
    expect(seen.size).toBe(STANDINGS.length)
  })

  it('⚠️ agrees with the plate about busy-ness, over every input the app can hold', () => {
    // The property the four surfaces are held to, asserted here on the pure functions so that a
    // failure says WHICH rule broke rather than which component did.
    //
    // ⚠️ **`needing` is an axis of this sweep because review found it was not.** The first version
    // spread `...base` — which has none — over every cell, so `standingOf` never once returned
    // `waiting`, and the `|| standing === 'waiting'` in the oracle below was a branch the sweep
    // could not reach. A property test that cannot produce one of the three answers it is checking
    // is a property test over two of them, and the missing one is the one a blocked user sees.
    let busy = 0
    let quiet = 0
    let blocked = 0
    for (const status of [
      'idle',
      'working',
      'waiting_permission',
      'ended',
      'errored',
      null,
    ] as const)
      for (const phase of ['thinking', 'tool', 'waiting', 'compacting', undefined] as const)
        for (const streaming of [true, false])
          // ⚑ **D-017b · the axis that was `ended`** — a fold that ended is `recorded` now.
          for (const recordPhase of ['open', 'recorded'] as const)
            for (const needing of [...NEEDINGS, undefined] as (Needing | undefined)[]) {
              const input: SessionFacetInput = {
                ...base,
                phase: recordPhase,
                status,
                activity: phase ? { phase } : null,
                streaming,
                ...(needing ? { needing } : {}),
              }
              const facets = sessionFacets(input)
              const standing = standingOf(facets)
              const where = `${status}/${phase}/${streaming}/${recordPhase}/${needing}`
              // The plate's own bit, written out here rather than taken from `standingOf` — the
              // same oracle `status-agreement.dom.test.ts` reads off the DOM attributes, in the
              // same order (the blocking badge, then the face). ⚑ **D-017b · no `over` first**: no
              // standing says whether anything stopped, so a stopped plate reads by its facets.
              // ⛔ **The oracle keeps its OWN copy on purpose** — asking `summonsAttention` here
              // would be asking the function under test. ⚑ `446` widened it by hand, which is the
              // cost of a second derivation and is the reason the two PRODUCT copies were merged.
              const blocking = needing === 'permission' || needing === 'question'
              const plateBusy = blocking || (facets.doing !== 'idle' && facets.doing !== 'unknown')
              const wordBusy = standing === 'working' || standing === 'waiting'
              expect(wordBusy, where).toBe(plateBusy)
              if (standing === 'waiting') blocked++
              if (wordBusy) busy++
              else quiet++
            }
    expect(busy, 'the sweep never found a busy session').toBeGreaterThan(0)
    expect(quiet, 'the sweep never found a quiet session').toBeGreaterThan(0)
    // The third answer, and the one the first version of this test could not reach at all.
    expect(blocked, 'the sweep never found a session blocked on the user').toBeGreaterThan(0)
  })

  it('⚑ D-017b · a stopped conversation with a card still on it reads by the one state', () => {
    // ⛔ **The ending word is gone** (`05` rule 5): a stop ends nothing, and a message sent to it
    // continues it, so its card is still one a person owes. The word is the one state's —
    // *needs you* — whichever channel said it stopped.
    const stoppedWith = (needing: Needing, over: Partial<SessionFacetInput>) =>
      standingOf(sessionFacets({ ...base, needing, ...over }))
    expect(stoppedWith('permission', { status: 'ended' })).toBe('waiting')
    expect(stoppedWith('question', { status: 'errored' })).toBe('waiting')
    expect(stoppedWith('permission', { phase: 'recorded' })).toBe('waiting')
    // Paired with the same stop and NO card, so the three above are the card and not a function
    // that says `waiting` of every stopped conversation.
    expect(standingOf(sessionFacets({ ...base, status: 'ended' }))).toBe('idle')
    expect(standingOf(sessionFacets({ ...base, phase: 'recorded' }))).toBe('idle')
    // …and no standing names the stop at all.
    expect(STANDINGS).not.toContain('ended')
    expect(STANDINGS).not.toContain('errored')
  })

  it('a plan go-ahead is not a block, so it does not make the bar say "waiting on you"', () => {
    // It can be pressed whenever and freezes nothing (063), which is why `needingFor` ranks it last
    // and why the word ignores it.
    expect(standingOf({ doing: 'idle', being: 'live', needing: 'plan' })).toBe('idle')
    // …and the badge is still drawn, which is the difference between "not urgent" and "not shown".
    expect(sessionFacets({ ...base, status: 'idle', needing: 'plan' }).needing).toBe('plan')
  })
})

/**
 * The count the rail reads, and the one thing that can go wrong with derived state (099).
 *
 * ⚠️ **`TranscriptState.pending` duplicates what `sessionPanel` computes, and duplicated facts
 * drift.** It exists because the rail must answer "is anything waiting on me" for every open
 * conversation on every render, and scanning the transcript there makes the whole rail re-render on
 * every streaming delta — the cost that made the rail gate its scan on the status column in the
 * first place, which is what made its answer a second derivation. The field removes the trade; this
 * describes the only way it can betray us, and holds it shut.
 */
describe('203 · the word a row shows names what it is waiting for (195 H3)', () => {
  it('⛔ a permission and a question stop reading the same', () => {
    // The defect, in one line: both fold to the standing `waiting`, and the sentences that tell
    // them apart lived only in `accessibleName`.
    expect(standingOf({ doing: 'tool', being: 'live', needing: 'permission' })).toBe('waiting')
    expect(standingOf({ doing: 'tool', being: 'live', needing: 'question' })).toBe('waiting')
    // ⚑ **UI-008** — in the one state's word, *needs you*, naming which.
    expect(standingWord({ doing: 'tool', being: 'live', needing: 'permission' })).toBe(
      'needs you: permission',
    )
    expect(standingWord({ doing: 'tool', being: 'live', needing: 'question' })).toBe(
      'needs you: question',
    )
  })

  it('🔴 UI-004 · the word under a plate says *active* for a running turn with nothing finer — and keeps its finer words', () => {
    expect(plateWord({ doing: 'working', being: 'live' })).toBe('active')
    expect(plateWord({ doing: 'working', being: 'live' })).toBe(
      standingWord({ doing: 'working', being: 'live' }),
    )
    // ⛔ The pairs: a finer DOING keeps this card's own register, and a person's wait says the one
    // state's *needs you* over any DOING (UI-008, F051), as the rail row says it.
    for (const doing of ['thinking', 'tool', 'replying', 'compacting'] as const)
      expect(plateWord({ doing, being: 'live' }), doing).toBe(DOING_WORD[doing])
    expect(plateWord({ doing: 'working', being: 'live', needing: 'permission' })).toBe(
      standingWord({ doing: 'working', being: 'live', needing: 'permission' }),
    )
    expect(plateWord({ doing: 'idle', being: 'live' })).toBe(DOING_WORD.idle)
  })

  it('⚑ …and every other row keeps the word it had — this widens THREE answers, not eight', () => {
    // Across the entire sweep, the only allowed differences from `standingOf` are `waiting`,
    // `background`, and `working`; the last uses the shared state word “active”. This pairing
    // prevents a second state vocabulary.
    //
    // ⛔ **`detached` was missing from this sweep and the omission was found by the adversarial pass
    // over 250's own diff.** Three sibling sweeps in this file were widened to `× 2` in that diff and
    // this one — the ONLY one that exercises `standingWord`'s branching over the whole state space —
    // was not, while the `else` branch below asserted an invariant the new branch violates. It would
    // have gone on passing over `standingWord`'s new answer for ever, which is `193` exactly.
    let widened = 0
    let running = 0
    let active = 0
    for (const doing of [...DOINGS, undefined] as (Doing | undefined)[])
      for (const being of [...BEINGS, undefined] as (Being | undefined)[])
        for (const needing of [...NEEDINGS, undefined] as (Needing | undefined)[])
          for (const detached of [true, undefined]) {
            const facets = { doing, being, needing, ...(detached ? { detached } : {}) }
            const standing = standingOf(facets)
            const word = standingWord(facets)
            const where = `${doing}/${being}/${needing}/${detached}`
            if (standing === 'waiting') {
              widened += 1
              expect(word, where).toBe(`needs you: ${needing}`)
              expect(NEEDING_WORD[needing as Needing]).toContain(needing as string)
            } else if (standing === 'background') {
              running += 1
              // ⚑ **F023 · the PM's phrase** — with no details handed in, the stem alone. The ENUM
              // stays `background` because `data-standing` is a selector; the WORD is what a person
              // reads.
              expect(word, where).toBe('running in the background')
            } else if (standing === 'working') {
              active += 1
              expect(word, where).toBe('active')
            } else {
              expect(word, where).toBe(standing)
            }
          }
    // Non-vacuity: the sweep really produced BOTH cases the function is about.
    expect(widened, 'no cell ever answered `waiting`').toBeGreaterThan(0)
    expect(running, 'no cell ever answered `background`').toBeGreaterThan(0)
    expect(active, 'no cell ever answered `working`').toBeGreaterThan(0)
  })

  it('⚠️ a plan go-ahead is NOT waiting, so the row keeps its doing word and its green badge', () => {
    // The design's own ruling, pinned here because the obvious version of 195 H3 would have counted
    // every `needing` and put a number on the rail its rows disagree with.
    const planning = { doing: 'idle' as const, being: 'live' as const, needing: 'plan' as const }
    expect(standingOf(planning)).not.toBe('waiting')
    expect(standingWord(planning)).toBe(standingOf(planning))
    // …and the badge is still drawn, which is where "a plan is waiting on you" is said.
    expect(NEEDING_GLYPH.plan).toBe('#i-check')
  })
})

describe('the pending count cannot drift from the panel that scans for it (099)', () => {
  const PERMISSION = (id: string): TranscriptEvent =>
    ({
      type: 'permission_request',
      id,
      kind: 'command',
      action: 'Bash',
      detail: 'ls -la',
      scope: {
        cwd: '/tmp/scratch',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    }) as TranscriptEvent

  const QUESTION = (id: string): TranscriptEvent =>
    ({
      type: 'user_input_request',
      id,
      prompt: 'Which database should the importer read?',
      questions: [
        {
          id: 'q1',
          prompt: 'Which database?',
          options: [{ label: 'primary' }, { label: 'replica' }],
        },
      ],
    }) as TranscriptEvent

  /** Every way a card is opened and every way one is settled, in sequences. */
  const SEQUENCES: { name: string; events: TranscriptEvent[] }[] = [
    { name: 'nothing', events: [] },
    { name: 'one permission', events: [PERMISSION('req_1')] },
    {
      name: 'permission answered',
      events: [
        PERMISSION('req_1'),
        { type: 'user_decision', requestId: 'req_1', outcome: 'allow' } as TranscriptEvent,
      ],
    },
    {
      name: 'permission withdrawn by the provider',
      events: [PERMISSION('req_1'), { type: 'request_resolved', id: 'req_1' } as TranscriptEvent],
    },
    { name: 'a question', events: [QUESTION('ask_1')] },
    {
      name: 'question answered',
      events: [
        QUESTION('ask_1'),
        { type: 'user_decision', requestId: 'ask_1', outcome: 'answered' } as TranscriptEvent,
      ],
    },
    { name: 'both open', events: [PERMISSION('req_1'), QUESTION('ask_1')] },
    {
      name: 'both open, one answered',
      events: [
        PERMISSION('req_1'),
        QUESTION('ask_1'),
        { type: 'user_decision', requestId: 'req_1', outcome: 'deny' } as TranscriptEvent,
      ],
    },
    {
      name: 'the turn ends under them',
      events: [
        PERMISSION('req_1'),
        QUESTION('ask_1'),
        { type: 'turn', state: 'interrupted' } as TranscriptEvent,
      ],
    },
    // ⚑ **T-002 · D-001's two paths**: a card spared by a turn that ended under a wait the host
    // still held, and the let-go that settles it once nothing holds it.
    {
      name: 'the turn ends while the host still holds them',
      events: [
        PERMISSION('req_1'),
        QUESTION('ask_1'),
        { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
        { type: 'turn', state: 'completed' } as TranscriptEvent,
      ],
    },
    {
      name: 'the host lets go of them after their turn',
      events: [
        PERMISSION('req_1'),
        QUESTION('ask_1'),
        { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
        { type: 'turn', state: 'completed' } as TranscriptEvent,
        { type: 'status', state: 'idle' } as TranscriptEvent,
      ],
    },
    {
      name: 'the session ends under them',
      events: [
        PERMISSION('req_1'),
        QUESTION('ask_1'),
        { type: 'status', state: 'ended' } as TranscriptEvent,
      ],
    },
    {
      name: 'a second permission after the first is answered',
      events: [
        PERMISSION('req_1'),
        { type: 'user_decision', requestId: 'req_1', outcome: 'allow' } as TranscriptEvent,
        PERMISSION('req_2'),
      ],
    },
  ]

  it('⚠️ equals the panel, over every open-and-settle path there is', () => {
    let sawWaiting = 0
    let sawSettled = 0
    for (const { name, events } of SEQUENCES) {
      const state = createTranscript()
      for (const event of events) applyEvent(state, event)
      const panel = sessionPanel(state)
      expect(state.pending.permissions, `${name} — permissions`).toBe(panel.permissions.length)
      expect(state.pending.questions, `${name} — questions`).toBe(panel.questions.length)
      // …and the same answer the rail actually renders, which is what the equality is FOR.
      expect(needingFor({ ...state.pending, planNeedsGoAhead: false }), `${name} — needing`).toBe(
        needingFor({
          permissions: panel.permissions.length,
          questions: panel.questions.length,
          planNeedsGoAhead: false,
        }),
      )
      if (state.pending.permissions + state.pending.questions > 0) sawWaiting++
      else sawSettled++
    }
    // ⚠️ **The pairing.** `0 === 0` is true for every sequence in a fold that never counted
    // anything, so the sweep has to have reached both sides — some sequences leaving cards open and
    // some leaving none.
    expect(sawWaiting, 'no sequence ever left a card waiting').toBeGreaterThan(0)
    expect(sawSettled, 'no sequence ever settled everything').toBeGreaterThan(0)
  })

  it('the host refusing a response settles the card and the count with it', () => {
    // `markRequestFailed` is called from `session-store`, outside `applyEvent` — the one settle path
    // that does not arrive as an event, and therefore the one most easily missed.
    const state = createTranscript()
    applyEvent(state, PERMISSION('req_1'))
    expect(state.pending.permissions).toBe(1)
    markRequestFailed(state, 'req_1', 'the host refused this response')
    expect(state.pending.permissions).toBe(0)
    expect(sessionPanel(state).permissions).toHaveLength(0)
  })
})
