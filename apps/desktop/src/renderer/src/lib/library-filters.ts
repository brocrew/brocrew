import type {
  LibraryCounts,
  LibraryFilters,
  LibraryKind,
  LibraryOrigin,
  LibraryProviderCount,
} from '../../../shared/runtime-ipc'
import { A_PROVIDER_FOLDER } from '../../../shared/runtime-ipc'

/**
 * **What the Sessions filters ARE**, as data and pure functions rather than as template expressions
 * (121, to `120`'s design).
 *
 * Everything here is shared by three surfaces that must agree about one narrowing: the facet row
 * declares it, the window note summarises it, and the empty state names it constraint by
 * constraint. `120` §3's rule is that *"a filtered list that looks unfiltered is `086`'s fabricated
 * number in a new hat"* — three descriptions of one filter written three times is how they come to
 * disagree, and the one that drifts is whichever gets edited second. So there is one list, and it
 * is the list all three read.
 *
 * ⛔ **No provider is named in this file, and that is enforced.** `039` forbids the renderer
 * deciding anything by recognising a provider's name and `provider-neutrality.test.ts` runs a
 * census over `renderer/` and `shared/` to keep it that way. The Provider facet's options are
 * {@link LibraryCounts.providers} — the backend's answer, counted over the whole library — so
 * adding a third provider adds an option here with no edit.
 */

/** Which of the five state toggles. One key per predicate — see {@link STATE_TOGGLES}. */
export type StateKey = 'notImported' | 'unresumable' | 'behind' | 'offDisk' | 'unreadable'

/**
 * ⛔ **The five state predicates, and they are FIVE.**
 *
 * `readable`, `onDisk` and `derived` are three independent facts the entry refuses to merge, and
 * `061` finding 6 is what happened the last time one value was asked to carry two. A disclosure
 * hides the clutter; it does not merge the distinction. `why` is shown beside each toggle for the
 * same reason the row's own `behind` line exists: the person choosing between "unreadable" and
 * "behind" is choosing between two things that sound alike and are not.
 */
export const STATE_TOGGLES: readonly { key: StateKey; label: string; why: string }[] = [
  { key: 'notImported', label: 'Not imported', why: `still only in ${A_PROVIDER_FOLDER}` },
  { key: 'unresumable', label: 'Unresumable', why: 'cannot be carried on' },
  { key: 'behind', label: 'Behind / not whole', why: 'what we hold is not all of it' },
  { key: 'offDisk', label: 'Missing on disk', why: 'the provider deleted its file' },
  { key: 'unreadable', label: 'Unreadable', why: 'opens to an empty pane' },
]

/** The Origin facet's options. Not provider names — where a conversation came from (047). */
export const ORIGIN_OPTIONS: readonly { value: LibraryOrigin | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'ours', label: 'Ran here' },
  { value: 'user-home', label: 'Found in home' },
  // ⛔ **Added with the origin itself** (214 §1). This list is a second hand-maintained copy of the
  // `LibraryOrigin` union, and leaving it behind meant the facet's two options between them excluded
  // a whole class of the library — with no option that could select it. `library-filters.test.ts`
  // now walks `LIBRARY_ORIGINS` and fails when a member has no option here, so the next member
  // cannot be forgotten the way this one was.
  { value: 'restored', label: 'Restored from a bundle' },
]

/** The Kind facet's options — the marquee (111, 115, 118, 119). `child != null` is the whole test. */
export const KIND_OPTIONS: readonly { value: LibraryKind | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'top', label: 'Top-level' },
  { value: 'sub', label: 'Sub-agents' },
]

/**
 * The Provider facet's options, from the backend's own tally.
 *
 * ⚠️ **The label is the provider's own word with a capital on it, not a name this file recognises.**
 * A lookup table keyed by provider would be a per-provider branch containing no comparison, which
 * is precisely the shape `provider-neutrality.test.ts` learned to catch.
 */
export function providerOptions(
  counts: Pick<LibraryCounts, 'providers'> | null,
): { value: string; label: string; total: number | null }[] {
  return [
    { value: '', label: 'All', total: null },
    ...(counts?.providers ?? []).map((entry: LibraryProviderCount) => ({
      value: entry.provider,
      label: entry.provider.charAt(0).toUpperCase() + entry.provider.slice(1),
      total: entry.total,
    })),
  ]
}

/** Nothing narrowed. A shared value so "unfiltered" is one thing rather than several empty objects. */
export const NO_FILTERS: LibraryFilters = Object.freeze({})

/**
 * How many constraints the FILTERS carry — the query is a separate axis and is not counted here.
 *
 * ⛔ **`false` is not a constraint.** The renderer holds all five toggles as plain booleans, so an
 * unpressed one is present-and-false, and counting it would light the facet row up over a filter
 * nobody set. Main-side reads them the same way (see `LibraryFilters`), so the two halves agree
 * about what "on" means.
 */
export function filterCount(filters: LibraryFilters): number {
  let count = 0
  if (filters.provider !== undefined) count++
  if (filters.origin !== undefined) count++
  if (filters.kind !== undefined) count++
  if (filters.archived !== undefined) count++
  for (const toggle of STATE_TOGGLES) if (filters[toggle.key] === true) count++
  return count
}

/** How many of the five state toggles are on — what the `State` disclosure's badge says. */
export function stateCount(filters: LibraryFilters): number {
  return STATE_TOGGLES.filter((toggle) => filters[toggle.key] === true).length
}

/** Whether the list is narrowed by anything structural at all. */
export function anyFilter(filters: LibraryFilters): boolean {
  return filterCount(filters) > 0
}

/** Every key a filter can carry — the nine of {@link LibraryFilters}, in one place. */
const FILTER_KEYS = [
  'provider',
  'origin',
  'kind',
  'archived',
  ...STATE_TOGGLES.map((toggle) => toggle.key),
] as const

/**
 * **Whether two filters narrow the same way** — how a surface knows a page in hand is an answer to
 * the question currently being asked (121, review).
 *
 * ⛔ **The declaration a filtered list makes must come from the PAGE, not from the controls.** The
 * facets change the instant they are pressed and the page arrives a round trip later; a
 * `N match` built from the live filters and the previous page's count says *"2,027 match · Codex"*
 * for as long as that takes. That is `086`'s fabricated number appearing in the control built to
 * prevent it. This is what lets the count go quiet — never wrong — until its own answer lands.
 *
 * Absent and `false` compare equal for the same reason they filter equally: they are one state.
 */
export function sameFilters(a: LibraryFilters, b: LibraryFilters): boolean {
  // ⚠️ `false` folds to absent, NOT via `??` — which only falls through on null and undefined, and
  // would therefore have called an unpressed toggle different from a missing one.
  const set = (value: unknown): unknown => (value === false ? undefined : value)
  return FILTER_KEYS.every((key) => set(a[key]) === set(b[key]))
}

/**
 * One thing narrowing the list right now, in the words the reader is shown.
 *
 * `label` is the compact form the window note appends (*"…1,063 matching · Codex"*); `chip` is the
 * qualified form the empty state renders, because a chip reading just *"Codex"* on a screen listing
 * four constraints does not say which axis it is. Both come from one entry so the two surfaces
 * cannot end up describing the same constraint differently.
 */
export interface Constraint {
  /** Unique, and used as a `data-cy` suffix and a Vue key. */
  key: StateKey | 'provider' | 'origin' | 'kind' | 'archived' | 'query'
  label: string
  chip: string
  /** Which clear hatch relaxes it — the two axes `120` §4 keeps independent. */
  axis: 'filters' | 'query'
}

/**
 * **Every active constraint, in one list** — the empty state's chips, and the note's summary.
 *
 * ⚠️ **The query is in here, and that is the point of the function.** `120` §5: the filtered-empty
 * screen must name *every* active constraint, because *"no dead end you escape by guessing which
 * invisible constraint bit"*. A list that named the facets and left the search box out would send
 * someone to clear four filters over a result that was empty because of a typo.
 */
export function activeConstraints(filters: LibraryFilters, query: string): Constraint[] {
  const out: Constraint[] = []
  const facet = (
    key: 'provider' | 'origin' | 'kind',
    axisLabel: string,
    label: string | undefined,
  ): void => {
    if (label === undefined) return
    out.push({ key, label, chip: `${axisLabel}: ${label}`, axis: 'filters' })
  }
  facet(
    'provider',
    'Provider',
    filters.provider === undefined
      ? undefined
      : filters.provider.charAt(0).toUpperCase() + filters.provider.slice(1),
  )
  facet('origin', 'Origin', ORIGIN_OPTIONS.find((o) => o.value === filters.origin)?.label)
  facet('kind', 'Kind', KIND_OPTIONS.find((o) => o.value === filters.kind)?.label)
  if (filters.archived !== undefined) {
    const label = filters.archived === 'only' ? 'Archived' : 'Not archived'
    out.push({ key: 'archived', label, chip: label, axis: 'filters' })
  }
  for (const toggle of STATE_TOGGLES) {
    if (filters[toggle.key] === true)
      out.push({ key: toggle.key, label: toggle.label, chip: toggle.label, axis: 'filters' })
  }
  const needle = query.trim()
  if (needle !== '')
    out.push({ key: 'query', label: `“${needle}”`, chip: `“${needle}”`, axis: 'query' })
  return out
}

/**
 * Drop ONE constraint, leaving the rest — what a chip's × does.
 *
 * ⚠️ **A chip drawn with an × that does nothing is `106`'s unwired control**, so the × is real. The
 * query is not dropped here: it lives in the search box, and this returns filters. The caller
 * clears the box for `'query'`, which is the same independence `120` §4 requires of the two clears.
 */
export function withoutConstraint(filters: LibraryFilters, key: Constraint['key']): LibraryFilters {
  const next: LibraryFilters = { ...filters }
  if (key !== 'query') delete next[key]
  return next
}
