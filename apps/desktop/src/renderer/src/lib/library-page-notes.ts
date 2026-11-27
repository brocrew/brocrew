import { sameLocalDay } from '../../../shared/local-time'

/**
 * Three rules of this surface, as functions rather than as template expressions (104).
 *
 * They are here — a plain block above `<script setup>`, the same shape `NewConversation` uses for
 * `blockingGroupShows` — because each of them is a claim the surface makes about honesty, and a
 * claim buried in a `v-if` can only be tested by mounting something that happens to reach it. As
 * exports they can be asserted directly, in both directions, without a fixture.
 */

/**
 * **Whether the list is a window onto something larger** (104's 200-row truth).
 *
 * `matched` is counted over the WHOLE library before `.slice(offset, offset + limit)`
 * (`session-library.ts`), so this compares what is on screen against what the query actually found
 * — not against `counts.total`, which is every conversation and would claim a truncation on every
 * search that narrowed anything.
 *
 * ⚠️ Silent when they are equal. A note that appeared at 179 conversations, where nothing is
 * truncated, would train the reader to ignore it by the time it meant something.
 */
export function windowNoteShows(page: { shown: number; matched: number }): boolean {
  return page.shown < page.matched
}

/**
 * **What the note offers as the way past the window** (121, extending 105's two-way version).
 *
 * Four states, because there are two independent axes and collapsing them loses the advice. "Search
 * to reach the rest", read by somebody who has already searched, is advice to do the thing they
 * did; "Narrow the search", read by somebody who has narrowed by facet and typed nothing, names a
 * box they are not using. Each combination is told what would actually help.
 */
export function windowNoteCta(state: { searching: boolean; filtered: boolean }): string {
  if (state.filtered && state.searching) return 'Narrow the filters or search'
  if (state.filtered) return 'Narrow the filters'
  return state.searching ? 'Narrow the search' : 'Search'
}

/**
 * **Which part of the surface declares that this list is narrowed** (121, `120` §6).
 *
 * ⛔ *"Silence is safe only when the list is unfiltered AND complete."* That rule is about the
 * SURFACE, not about the note: the note is silent whenever nothing is truncated, and in the
 * filtered-and-complete case the sticky `N match · Clear all` carries the fact instead. So the
 * four states of `120`'s table are three answers, and exactly one of them is silence.
 *
 * ⚠️ **This DECIDES the note — see `truncated`.** It answers which surface is the one that would
 * otherwise be missing: `'window-note'` means the note speaks (the sticky count is there too
 * whenever a filter is on, and is not this function's business), `'pinned-count'` means the note
 * has nothing to report and the badge is carrying it alone, and `'nothing-to-declare'` is the one
 * state where neither is needed.
 *
 * `matched` on both sides, counted main-side before the slice, which is why *"200 of 200"* on a
 * library of two thousand is not a sentence this surface can produce.
 */
export function narrowingDeclaredBy(state: {
  shown: number
  matched: number
  filtered: boolean
}): 'window-note' | 'pinned-count' | 'nothing-to-declare' {
  if (windowNoteShows(state)) return 'window-note'
  return state.filtered ? 'pinned-count' : 'nothing-to-declare'
}

/**
 * 🔴 **What an empty result may NOT claim to have looked at** (329 §4.4).
 *
 * ## The contradiction
 *
 * `302` found the reopen band arguing with the search above it; `301` fixed that by making the band
 * say which question it answers. ⚑ **That is the right instrument, and it was applied one sentence
 * too narrowly.** A miss still said *"No title, first message or working directory across your 2,696
 * conversations contains that"* while the same screen said *"67 could not be read"* a few inches
 * below. A search cannot claim completeness over records it could not open.
 *
 * ## The arithmetic, which is the part worth getting right
 *
 * `counts.total` is `entries.length` and `entries` is built from `discovery.found` merged with our
 * own rows; `skippedTotal` is `discovery.skipped.length`, and a skipped path never becomes an entry.
 * ⛔ **So the sentence was never self-contradictory — it was self-consistent and still overclaiming**,
 * because the reader has no way to know that "your N conversations" excludes a set the same page
 * names.
 *
 * ⚠️ **Two things this must therefore NOT say.**
 *  - ⛔ Not *"another N"*, *"N more"*, or anything of the form `total + skipped = your library`. The
 *    two sets are **not disjoint**: a row we recorded earlier whose provider file is now skipped is
 *    emitted from the second loop AND counted in `skippedTotal`.
 *  - ⛔ Not *"N conversations could not be read"*. `skippedTotal` counts SKIP RECORDS, and one of them
 *    (*"its state database could not be read"*) stands for a whole folder whose conversations were
 *    never enumerated. The number on screen is a count of entries, so this points at it in the words
 *    it already wears rather than recasting it into a population.
 *
 * ⚑ **The shape is `command-palette.ts`'s `searchedNote`** (249 §2), which has said the same thing
 * about the same kind of gap since it shipped: *"The closed conversations could not be read, so none
 * of them were searched."* Name the excluded set, and state the consequence for the search.
 *
 * ⛔ **Silent when nothing was skipped**, which is 106's rule and not caution: a scope disclaimer on
 * a library that read everything is a sentence about a hazard that is not there.
 *
 * ## 🔴 Two corrections this sentence needed before it was true (found reviewing 329's own diff)
 *
 * ⛔ **It said *"they are listed at the foot of this page"*, and the list is capped at fifty.**
 * `readLibrary` sends `skipped: discovery.skipped.slice(0, MAX_SKIPPED_REPORTED)` beside the
 * uncapped `skippedTotal`, and the foot itself prints *"…and N more not listed here"* four elements
 * below. On the machine this dispatch was written against — 67 skipped — the sentence added to stop
 * the page overclaiming carried an overclaim of its own, contradicted on the same screen. ⚑
 * **COUNTED, not listed**: the `<summary>` always carries the untruncated total, so that is true at
 * every size and still points the reader at where to look.
 *
 * ⚠️ **And the verb belongs to the gesture.** `filtered` wins over `searching` in the template, so
 * this sentence renders on a screen produced by a facet press with an empty box — where
 * `matches(entry, '')` short-circuits and no search runs at all. `windowNoteCta` three functions
 * above already takes the gesture as a parameter for exactly this reason; so does this.
 */
export function searchScopeNote(
  page: { skippedTotal: number } | null,
  gesture: { searching: boolean },
): string | null {
  if (page === null || page.skippedTotal <= 0) return null
  // ⛔ Off `searching` rather than off which BRANCH is drawn: a person who typed *and* filtered gets
  // the filtered branch, and a search really did run for them.
  const what = gesture.searching ? 'was searched' : 'was narrowed by these filters'
  return (
    `Nothing in the ${page.skippedTotal} that could not be read ${what} — they are counted at ` +
    'the foot of this page.'
  )
}

export type Recency = 'today' | 'week' | 'older'

/**
 * Which band of the recency list a row belongs to — a browse aid over a field already on the wire.
 *
 * "Today" is the calendar day rather than the last 24 hours, because that is what the word means to
 * the person reading it: a conversation from 9pm yesterday is not "today" at 10am, and a rule that
 * said it was would be arguing with the clock on their wall — ⚑ the Mac's calendar, which is that
 * clock's (D-031).
 */
export function recencyOf(at: number, now: number): Recency {
  if (sameLocalDay(at, now)) return 'today'
  return now - at < 7 * 24 * 60 * 60 * 1000 ? 'week' : 'older'
}

/**
 * How long ago, in the reader's terms.
 *
 * ⚠️ **`now` is a parameter**, so a caller that has to RE-RENDER as time passes can pass a reactive
 * clock. Rows read the wall clock on every render and are re-rendered by every read; the scan's
 * freshness line is not, and was frozen at "0m ago" until it was given one (121 review).
 */
export function ago(at: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
