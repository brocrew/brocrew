import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  KIND_OPTIONS,
  NO_FILTERS,
  ORIGIN_OPTIONS,
  STATE_TOGGLES,
  activeConstraints,
  anyFilter,
  filterCount,
  providerOptions,
  sameFilters,
  stateCount,
  withoutConstraint,
} from '../src/renderer/src/lib/library-filters'
import { LIBRARY_ORIGINS } from '../src/shared/runtime-ipc'
import type { LibraryCounts, LibraryFilters, Provider } from '../src/shared/runtime-ipc'

/**
 * **The filter rules, as rules** (121) — the pure half of `120`'s design, asserted without a DOM.
 *
 * Everything the facet row, the window note and the empty state say about a narrowing comes from
 * one list and three functions. They are here rather than only in the browser test because they are
 * CLAIMS — *"the note is silent only when unfiltered and complete"*, *"the five stay five"*, *"the
 * two clears are independent"* — and a claim reachable only by mounting something is a claim tested
 * through everything that could hide it.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))

describe('what counts as a filter (120 §3)', () => {
  it('nothing set is not a filter, and neither is a toggle that is off', () => {
    expect(anyFilter(NO_FILTERS)).toBe(false)
    expect(filterCount({})).toBe(0)
    // ⛔ The renderer holds all five as plain booleans and sends its state as it stands, so
    // present-and-false has to mean "not set". Counting it would light the facet row up, print a
    // `N match` and a `Clear all`, and name a constraint on the empty screen — over a filter
    // nobody applied.
    const allOff: LibraryFilters = {
      notImported: false,
      unresumable: false,
      behind: false,
      offDisk: false,
      unreadable: false,
    }
    expect(filterCount(allOff)).toBe(0)
    expect(stateCount(allOff)).toBe(0)
    expect(anyFilter(allOff)).toBe(false)

    // The paired positive: one of the same five, on, is one filter.
    expect(anyFilter({ ...allOff, behind: true })).toBe(true)
    expect(filterCount({ ...allOff, behind: true })).toBe(1)
  })

  it('⛔ two filters that narrow the same way ARE the same filter', () => {
    /**
     * What lets the pinned count go quiet — never wrong — while a read is in flight: the surface
     * compares the filters the page was READ with against the ones the controls hold now.
     *
     * ⚠️ **`false` and absent must compare EQUAL**, and `??` does not do it: it falls through only
     * on null and undefined, so an unpressed toggle would have read as different from a missing
     * one and the count would have gone quiet over a difference that narrows nothing.
     */
    expect(sameFilters({}, {})).toBe(true)
    expect(sameFilters({ behind: false }, {})).toBe(true)
    expect(sameFilters({ notImported: false, offDisk: false }, {})).toBe(true)
    // …and a real difference is a real difference, in both directions.
    expect(sameFilters({ behind: true }, {})).toBe(false)
    expect(sameFilters({}, { behind: true })).toBe(false)
    expect(sameFilters({ provider: 'codex' }, { provider: 'claude' })).toBe(false)
    // Every one of the eight is compared, not just the first three.
    for (const key of STATE_TOGGLES.map((toggle) => toggle.key)) {
      expect(sameFilters({ [key]: true }, {}), `${key} is not compared`).toBe(false)
    }
    expect(sameFilters({ origin: 'ours' }, {})).toBe(false)
    expect(sameFilters({ kind: 'sub' }, {})).toBe(false)
  })

  it('counts each axis once, across all eight dimensions', () => {
    const everything: LibraryFilters = {
      provider: 'claude',
      origin: 'ours',
      kind: 'sub',
      notImported: true,
      unresumable: true,
      behind: true,
      offDisk: true,
      unreadable: true,
    }
    expect(filterCount(everything)).toBe(8)
    // The badge on the `State` disclosure counts only what the disclosure holds — otherwise a
    // closed popover would claim credit for the three facets standing beside it.
    expect(stateCount(everything)).toBe(5)
    expect(STATE_TOGGLES).toHaveLength(5)
  })

  it('⛔ the five toggles are five DIFFERENT keys, and each is one of the entry’s own fields', () => {
    // 061 finding 6 in list form: five entries, five distinct keys, no key repeated and none of
    // them a composite. A merged "status" would show up here as four entries or as a shared key.
    const keys = STATE_TOGGLES.map((toggle) => toggle.key)
    expect(new Set(keys).size).toBe(5)
    expect(keys).toEqual(['notImported', 'unresumable', 'behind', 'offDisk', 'unreadable'])
    // Every one of them has its own sentence, so a person choosing between "unreadable" and
    // "behind" is not choosing between two words that sound alike.
    expect(new Set(STATE_TOGGLES.map((toggle) => toggle.why)).size).toBe(5)
  })
})

describe('the Provider facet is built from the backend’s answer (039)', () => {
  const counts = (providers: LibraryCounts['providers']): LibraryCounts => ({
    total: 0,
    ours: 0,
    userHome: 0,
    restored: 0,
    imported: 0,
    notImported: 0,
    onlyHere: 0,
    providers,
  })

  it('offers All plus one option per provider the library actually holds', () => {
    const options = providerOptions(
      counts([
        { provider: 'codex', total: 300 },
        { provider: 'claude', total: 200 },
      ]),
    )
    expect(options.map((option) => option.label)).toEqual(['All', 'Codex', 'Claude'])
    expect(options.map((option) => option.value)).toEqual(['', 'codex', 'claude'])
    // The count rides along, so the menu says how much of the library each option is.
    expect(options.map((option) => option.total)).toEqual([null, 300, 200])
  })

  it('⛔ …and a THIRD provider needs no renderer change at all', () => {
    /**
     * The architectural claim, tested rather than asserted in prose. `039`: *"I would like it to be
     * at the backend level, and the UI just displays whatever it gets."* A provider this renderer
     * has never heard of arrives with a label and a count, because nothing here recognises a name.
     *
     * The cast is the test naming a provider the shared enum does not have — which is the only way
     * to ask this question, and is why it is asked in a test file rather than in the renderer.
     */
    const options = providerOptions(counts([{ provider: 'gemini' as Provider, total: 7 }]))
    expect(options.map((option) => option.label)).toEqual(['All', 'Gemini'])
  })

  it('before the first read there is no tally, and the menu says only All', () => {
    // Not a fabricated list of providers we assume exist: an honest blank (086).
    expect(providerOptions(null)).toEqual([{ value: '', label: 'All', total: null }])
  })
})

describe('every active constraint is nameable (120 §5)', () => {
  it('names two facets, one toggle and a query at once — in that order, with both wordings', () => {
    const constraints = activeConstraints(
      { provider: 'codex', kind: 'sub', unresumable: true },
      '  refund webhook  ',
    )
    expect(constraints.map((constraint) => constraint.key)).toEqual([
      'provider',
      'kind',
      'unresumable',
      'query',
    ])
    // The chip form qualifies its axis — "Codex" alone, on a screen listing four constraints,
    // does not say which control set it.
    expect(constraints.map((constraint) => constraint.chip)).toEqual([
      'Provider: Codex',
      'Kind: Sub-agents',
      'Unresumable',
      '“refund webhook”',
    ])
    // The note form is compact, because the note already says what it is counting.
    expect(constraints.map((constraint) => constraint.label)).toEqual([
      'Codex',
      'Sub-agents',
      'Unresumable',
      '“refund webhook”',
    ])
    // Two axes, and the empty state's two hatches relax them separately.
    expect(constraints.filter((constraint) => constraint.axis === 'query')).toHaveLength(1)
    expect(constraints.filter((constraint) => constraint.axis === 'filters')).toHaveLength(3)
  })

  it('an unfiltered, unsearched list has nothing to name', () => {
    // The paired negative for the positive above — and it is what the empty state's `v-if` chain
    // relies on to know it is NOT the filtered-empty case.
    expect(activeConstraints({}, '')).toEqual([])
    expect(activeConstraints({}, '   ')).toEqual([])
  })

  it('a facet set to its own “All” option is not a constraint', () => {
    // `''` is how the select says "do not narrow", and `FacetBar.pick` turns it into an ABSENT
    // key — which is the state asserted here, because it is the state that reaches this list.
    expect(ORIGIN_OPTIONS[0]).toEqual({ value: '', label: 'All' })
    expect(KIND_OPTIONS[0]).toEqual({ value: '', label: 'All' })
    expect(activeConstraints({ origin: undefined, kind: undefined }, '')).toEqual([])

    /**
     * ⚠️ **And what would happen if `''` DID reach here, said out loud rather than implied**
     * (review — the first version's comment described this and the assertion never took the path).
     * It is unreachable twice over: `pick` deletes the key, and the wire enum refuses the empty
     * string. But `ORIGIN_OPTIONS.find` matches the All entry on `''`, so if either guard were
     * removed the empty state would grow a chip reading "Origin: All" with an × that clears
     * nothing. Pinned as the reason those two guards are load-bearing.
     */
    const leaked = activeConstraints({ origin: '' as LibraryFilters['origin'] }, '')
    expect(leaked.map((constraint) => constraint.chip)).toEqual(['Origin: All'])
  })

  it('dropping one constraint leaves the others exactly as they were', () => {
    const filters: LibraryFilters = { provider: 'codex', kind: 'sub', unresumable: true }
    expect(withoutConstraint(filters, 'kind')).toEqual({ provider: 'codex', unresumable: true })
    expect(withoutConstraint(filters, 'unresumable')).toEqual({ provider: 'codex', kind: 'sub' })
    // ⛔ And it does not mutate the object it was given: the surface re-reads main-side on a NEW
    // filters value, so an in-place edit would change the state without the watcher noticing.
    expect(filters).toEqual({ provider: 'codex', kind: 'sub', unresumable: true })
    // The query chip belongs to the other axis: dropping it leaves the filters untouched, and the
    // caller clears the box (120 §4 — the two axes are independent).
    expect(withoutConstraint(filters, 'query')).toEqual(filters)
  })
})

/**
 * ⚠️ **The rest of this ruling is asserted in `test/dom/library-filters.dom.test.ts`**, and the
 * split is the repo's own tiering rather than a preference: `home-scan.ts` reads `window.api`, so
 * it belongs to the projects that have a `window`. What lives here is the half that needs a
 * filesystem instead — which is the half a browser cannot do.
 */
describe('one scan, surfaced twice (120 §7)', () => {
  it('⛔ …and there is ONE call site in the whole renderer, not two', () => {
    /**
     * `120`'s ruling, as a structural guard: *"It must be the same operation, surfaced twice, never
     * forked… two scan buttons that look alike and behave differently is 061 finding 6 in control
     * form."* Behaviour tests show both buttons calling the bridge; only this shows that they
     * cannot drift, because there is only one place in the renderer that calls it.
     */
    const root = join(HERE, '../src/renderer/src')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
        item.isDirectory()
          ? walk(join(dir, item.name))
          : /\.(ts|vue)$/.test(item.name)
            ? [join(dir, item.name)]
            : [],
      )
    const callers = walk(root).filter((file) =>
      /runtime\s*\.\s*adoptSessions\s*\(/.test(readFileSync(file, 'utf8')),
    )
    expect(callers.map((file) => relative(root, file).replaceAll('\\', '/'))).toEqual([
      'lib/home-scan.ts',
    ])

    // ⚠️ And the scanner fires: the same pattern IS found when pointed at a second caller. Without
    // this, `toEqual([one])` is equally consistent with a regex that matches nothing.
    expect(
      /runtime\s*\.\s*adoptSessions\s*\(/.test('await window.api.runtime.adoptSessions()'),
    ).toBe(true)
  })

  it('…and both surfaces reach it through the same shared function', () => {
    // The other half: one call site is only a shared operation if the surfaces actually use it.
    /**
     * ⚠️ **The IMPORT, not the word** (review). Both files name `useHomeScan` and `scanSummary` in
     * their own prose — `{@link useHomeScan}` is in each one's doc block — so a `toContain` over
     * the raw source stayed green with the import deleted and the comment kept, which is a guard
     * satisfied by documentation of the thing it is meant to guard.
     */
    for (const component of ['SessionLibrary.vue', 'ResumableSessions.vue']) {
      const source = readFileSync(join(HERE, '../src/renderer/src/components', component), 'utf8')
      const imports = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/lib\/home-scan'/.exec(source)?.[1] ?? ''
      expect(imports, `${component} does not import the shared scan`).toContain('useHomeScan')
      expect(imports, `${component} does not import the shared summary`).toContain('scanSummary')
    }
    // …and the matcher fires: it finds nothing in a file that only talks about them.
    expect(
      /import\s*\{([^}]*)\}\s*from\s*'\.\.\/lib\/home-scan'/.test('// {@link useHomeScan}'),
    ).toBe(false)
  })
})

/**
 * # 🔴 The Origin facet must COVER the library (214 §1, from an adversarial review)
 *
 * ⛔ **`ORIGIN_OPTIONS` is a second hand-maintained copy of the `LibraryOrigin` union**, and 214
 * added a third member — `restored` — to the union and not to the list. The two options that
 * remained between them excluded a whole class of the library, with no option that could select it,
 * ⚠️ **while that same dispatch's diff added a comment claiming a new member costs "no second edit
 * to remember"**. It cost exactly one, and nothing noticed.
 *
 * ⚑ **This is the edit that makes the claim true.** The next member fails here rather than shipping
 * a facet that quietly cannot see it.
 */
describe('the Origin facet covers every origin (214 §1)', () => {
  it('🔴 every LibraryOrigin has an option, and every option is a real origin', () => {
    const offered = ORIGIN_OPTIONS.filter((option) => option.value !== '').map((o) => o.value)

    expect([...offered].sort()).toEqual([...LIBRARY_ORIGINS].sort())
    // …and the "All" escape hatch is still there, which is the only value not in the union.
    expect(ORIGIN_OPTIONS[0]).toEqual({ value: '', label: 'All' })
  })

  it('⚑ …and every option is LABELLED — a facet value with no words is a control nobody can read', () => {
    for (const option of ORIGIN_OPTIONS) {
      expect(option.label.trim(), `${String(option.value)} has no label`).not.toBe('')
    }
  })
})

describe('the archived filter is a constraint like the others', () => {
  it('🔴 it counts, it is named in the chips, and its × drops it alone', () => {
    const filters: LibraryFilters = { provider: 'claude', archived: 'only' }
    expect(filterCount(filters)).toBe(2)
    const chips = activeConstraints(filters, '')
    expect(chips.map((chip) => chip.key)).toEqual(['provider', 'archived'])
    expect(chips.find((chip) => chip.key === 'archived')?.chip).toBe('Archived')
    expect(activeConstraints({ archived: 'left-out' }, '')[0]?.chip).toBe('Not archived')
    expect(withoutConstraint(filters, 'archived')).toEqual({ provider: 'claude' })
  })

  it('⚑ the control: with no archived filter there is no such chip and nothing counted', () => {
    expect(filterCount({})).toBe(0)
    expect(activeConstraints({}, '').map((chip) => chip.key)).not.toContain('archived')
  })
})
