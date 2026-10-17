import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIVITY_PHASES, type ActivityPhase } from '../src/shared/what-is-being-done'
import {
  STANDINGS,
  STANDING_LABEL,
  activityLine,
  activityWords,
  sessionFacets,
  standingOf,
  type ActivityLine,
} from '../src/renderer/src/lib/agent-state'
import type { SessionStatus } from '../src/shared/runtime-ipc'

/**
 * 🔴 **588 · a surface says what each agent is DOING** — `EXT-013` §2.4, which measured the
 * defect as *"`claude · open in this window · #1 · Started 5m ago` — four facts, none of them the
 * one a person wants."*
 *
 * ## ⚑ What this file guards, and the claims are separable
 *
 * 1. **§1 · the FOLD** — gone with the project page at D-016: the project roster it measured, and
 *    the room that drew it, are deleted. ⚑ `575`'s read reaching a plate through
 *    `whatAPlateCanDraw` is still measured where its other callers are.
 * 2. **§2 · ONE derivation of the line.** `089` is three dispatches spent removing rival answers to
 *    *what is it doing*; a second surface drawing it is exactly how the fourth would arrive.
 * 3. **§3 · ONE vocabulary for the standing.** ⛔ The mock's three chips — *In flight*, *Awaiting
 *    reply*, *Waiting for you* — are not words this app has, and minting them would be `222` §4's
 *    defect with a fourth surface.
 *
 * ## ⛔ What it does NOT cover, said out loud
 *
 * - **That `575`'s read is correct.** `what-each-agent-is-doing.test.ts` owns the tracker, the
 *   turn boundary and the phase vocabulary.
 * - **The PAINT.** Every claim about weight, ink and fit is in `a-fit-not-a-design.dom.test.ts`,
 *   because `brobot2-ssr-tests-pass-vacuously`.
 */

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §2 · one derivation of the line, and the separator that has to be written
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§2 · one derivation of the line', () => {
  /**
   * 🔴 **The defect this dispatch shipped in its own drop and fixed at the settle.** A Vue template
   * that put the detail in a `<template v-if>` beside the word lost the whitespace between them to
   * the compiler's condensing, and the row read `runningBash`.
   *
   * ⛔ **Driven over EVERY phase**, so a fifth one added to `ACTIVITY_PHASES` is measured here on
   * the day it lands rather than the day somebody looks.
   */
  it('🔴 a detail is separated from its word by exactly one space, for every phase', () => {
    const seen = new Set<ActivityPhase>()
    for (const phase of ACTIVITY_PHASES) {
      const line = activityLine({
        phase: null,
        status: 'working',
        activity: { phase, detail: 'Bash' },
        streaming: false,
        liveness: null,
      })
      if (line === null) continue
      seen.add(phase)
      const words = activityWords(line)
      expect(words, `${phase} lost its separator`).toBe(`${line.word} ${line.detail ?? ''}`.trim())
      // ⛔ **Exactly one space and never two** — the failure the other way, which a `join(' ')` over
      // an already-spaced word would produce.
      expect(words, `${phase} doubled its separator`).not.toMatch(/ {2}/)
      if (line.detail !== undefined) {
        expect(words, `${phase} ran its words together`).toContain(' ')
      }
    }
    // ⚑ **Non-vacuity**: `waiting` folds to a `working` doing and keeps no detail, so the loop is
    // asserted to have reached more than nothing rather than trusted to.
    expect(seen.size).toBeGreaterThan(0)
  })

  /** ⚑ **No line, no words** — and `''` rather than `'null'`, which is what an interpolation does. */
  it('⚑ no line is an empty string', () => {
    expect(activityWords(null)).toBe('')
  })

  /**
   * 🔴 **The census: NO component composes this sentence itself.**
   *
   * ⛔ **`ActivityPill.vue`'s own docblock is the rule** — *"There is now one rule, `activityLine`
   * in `lib/agent-state.ts`, feeding both… Do not re-derive anything in this file"* — and `588`
   * gave that line a second surface, which is `169` §1's hazard arriving.
   *
   * ⚠️ **Derived from the tree, not from a list of paths** (`a-guard-scoped-by-where-things-live-
   * today-expires-silently`): every `.vue` under `components/` is read, so a THIRD surface drawing
   * the line is caught by the same assertion.
   */
  it('🔴 no component spells the composition itself', () => {
    const dir = join(import.meta.dirname, '../src/renderer/src/components')
    const files = readdirSync(dir).filter((name) => name.endsWith('.vue'))
    // ⛔ **The non-vacuity control, and it is a floor rather than a count** — a glob that matched
    // nothing would otherwise pass this census silently.
    expect(files.length).toBeGreaterThan(20)
    const guilty: string[] = []
    let readers = 0
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8')
      if (text.includes('activityWords')) readers += 1
      // ⚑ **The SHAPE, not the spelling**: `word` and `detail` interpolated into one template
      // literal is the composition however it is punctuated.
      if (/\$\{[^}]*\bword\b[^}]*\}[^`]*\$\{[^}]*\bdetail\b[^}]*\}/.test(text)) guilty.push(name)
    }
    expect(guilty, 'a component composes the activity line itself').toEqual([])
    // 🔴 **The control that proves the walk reached the files** — THREE components ask for the
    // shared function today (`ActivityPill`, `SessionShelf` and, since `593`, `TeamWorkspace`;
    // `ProjectWorkspace` went at D-016), and a census that found zero readers would be reading the
    // wrong directory.
    // ⛔ **The bound stays a FLOOR**: the number is what the walk is checked against, never what
    // the app is pinned to (`a-bound-written-as-the-constant-cannot-pin-it`). ⚠️ The sentence said
    // *two* and was already one short at `588`.
    expect(readers, 'no component imports the shared composition').toBeGreaterThanOrEqual(2)
  })

  /**
   * ⚑ **The pill and the row draw ONE string for one input** — the cross-check
   * `a-value-import-from-shared-costs-the-renderer-135kb` prescribes when duplication is forced,
   * asserted here where duplication is NOT forced, so a future copy is caught as a difference.
   */
  it('⚑ one input, one sentence, whatever draws it', () => {
    const line: ActivityLine = { doing: 'tool', word: 'running', detail: 'Read', tone: 'live' }
    expect(activityWords(line)).toBe('running Read')
    const pill = readFileSync(
      join(import.meta.dirname, '../src/renderer/src/components/ActivityPill.vue'),
      'utf8',
    )
    expect(pill).toContain('activityWords(props.line)')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §3 · one vocabulary for the standing — the mock's three chips are not words this app has
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§3 · one vocabulary for the standing', () => {
  /**
   * ⛔ **The mock draws `In flight`, `Awaiting reply` and `Waiting for you`.** ⚠️ Two of those three
   * have no member in this app's vocabulary, and the third is `Working` spelled differently — so
   * drawing them would be a FOURTH set of words for a fact three surfaces already name (`222` §4,
   * `449`'s measured defect with the axis changed).
   */
  /**
   * ⚑ **Every standing has a label**, so a tenth added to `STANDINGS` is a red here rather than a
   * blank chip on a row.
   */
  it('⚑ every standing has a word', () => {
    for (const standing of STANDINGS) {
      expect(STANDING_LABEL[standing], standing).toBeTruthy()
    }
    expect(Object.keys(STANDING_LABEL).sort()).toEqual([...STANDINGS].sort())
  })

  /**
   * 🔴 **The three the mock names, mapped to what this app actually says** — recorded as a TABLE so
   * the difference between the design and the build is a fact somebody can read rather than a
   * sentence in a response document.
   */
  it('🔴 the mock chips map onto this app words, and two of them do not exist', () => {
    // ⚑ **The standing every surface draws** — `standingOf` over the plate `sessionFacets` builds,
    // which is what the deleted roster's row carried and what `SessionHeader` still labels.
    const standingFor = (status: SessionStatus) =>
      standingOf(
        sessionFacets({ phase: null, status, activity: null, streaming: false, liveness: null }),
      )
    // ⚑ *In flight* is `Active` — the one state's word for a running turn since UI-004 (it said
    // `Working`, a word of this table's own).
    expect(STANDING_LABEL[standingFor('working')]).toBe('Active')
    // ⚑ *Waiting for you* is `Needs you` — the one state's word since UI-008 (it said `Waiting on
    // you`, a word of this table's own) — and it is reached through a NEEDING.
    expect(STANDING_LABEL.waiting).toBe('Needs you')
    expect(
      sessionFacets({
        phase: null,
        status: 'waiting_permission',
        activity: null,
        streaming: false,
        liveness: null,
        needing: 'permission',
      }).needing,
    ).toBe('permission')
    // ⛔ *Awaiting reply* has no member at all: nothing in `STANDINGS` names a turn held open for
    // another agent's answer.
    expect([...STANDINGS]).not.toContain('awaiting-reply')
  })
})
