<script lang="ts">
import type { LibraryEntry, LibraryOrigin } from '../../../shared/runtime-ipc'
import type { Provider } from '@brobot2/shared'
import { providerName } from '../../../shared/runtime-ipc'
import { A_PROVIDER_FOLDER, ALL_PROVIDER_FOLDERS } from '../../../shared/runtime-ipc'
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

/** Where a conversation came from, in one chip. */
export interface OriginChip {
  kind: 'ours' | 'imported' | 'home' | 'only' | 'restored'
  label: string
}

/**
 * **The five provenance phrases, collapsed into one chip** (104) — from the same three fields
 * `provenance()` reads, in the same order, so the two can never disagree about one row.
 *
 * `only here` is the one worth emphasis and it is **not** a warning: it means the provider has
 * already deleted its copy and ours is the last one. That is the sweep's whole value, said quietly.
 */
export function originChipOf(entry: {
  provider: Provider
  origin: LibraryOrigin
  recordId: string | null
  onDisk: boolean
}): OriginChip {
  if (entry.origin === 'ours') return { kind: 'ours', label: 'ours' }
  // ⛔ **Named for the gesture that produced it** (214 §1). A restored bundle is the one row whose
  // provider has no copy on this machine at all, so `imported` — which means *"the file is still in
  // the provider's folder and we archived it"* — would be false about it in both halves.
  if (entry.origin === 'restored') return { kind: 'restored', label: 'restored from a bundle' }
  // 169 §2 · whose folder, not which layer of ours. The row already knows, and *"in provider home"*
  // was the shortest sentence in the app that only made sense to someone who had read the source.
  if (entry.recordId === null)
    return { kind: 'home', label: `in ${providerName(entry.provider)}'s folder` }
  return entry.onDisk
    ? { kind: 'imported', label: 'imported' }
    : { kind: 'only', label: 'only here' }
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
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  AgentIdentity,
  ImportedBundle,
  ImportedFromHome,
  LibraryFilters,
  LibraryPage,
  RebuiltLedger,
} from '../../../shared/runtime-ipc'
import { BUNDLE_SUFFIX, LIBRARY_QUERY_MAX, MAX_PATH_CHARS } from '../../../shared/runtime-ipc'
import { archiveConversation, restoreConversation } from '../lib/archive-and-delete'
import { childLabel } from '../lib/child-descent'
import { calendarDay } from '../lib/clock'
import { describeDerived } from '../lib/derived-state'
import { scanSummary, useHomeScan } from '../lib/home-scan'
import {
  NO_FILTERS,
  activeConstraints,
  anyFilter,
  sameFilters,
  withoutConstraint,
  type Constraint,
} from '../lib/library-filters'
import { basenameOf } from '../lib/paths'
import { readableError } from '../lib/session-record'
import FacetBar from './FacetBar.vue'
import ResumableSessions from './ResumableSessions.vue'

/**
 * The session library (047, rebuilt to 104's design): every conversation this app knows about, from
 * all three sources, in one searchable index.
 *
 * ## It is a search-first index, not a rendered list (104)
 *
 * Two jobs, and they are reconciled rather than merged. **Browse** is the most recent *window* —
 * bounded, and labelled as bounded the moment the bound bites. **Find** is search, which re-reads
 * main-side per keystroke and therefore reaches PAST the window into the whole library. The promise
 * a person can lean on is *find anything by searching; browse the recent window*, and neither half
 * pretends two thousand rows are on screen.
 *
 * ## What the rows actually are
 *
 * Three sources are merged main-side into one list — our own database, and the user's two provider
 * homes — keyed on the provider's own id, so a conversation we have already archived is ONE row
 * that knows both facts. That merge is not this component's business; what is, is that the row
 * never hides which of them it is, because the available action differs:
 *
 * | row | action |
 * |---|---|
 * | in a provider home, not archived here | **Import** — the one accent CTA, since nothing is readable yet |
 * | archived here, or ours | **the row itself is the target** — read is safe and read-only |
 * | behind its archive, or a rebuild that failed | **Rebuild**, docked to the line that explains why |
 *
 * ⚠️ **Five actions were never five.** Read, Import and Rebuild are mutually exclusive by row-kind
 * already; `behind` and `outcome` are STATES, not actions. So the persistent right-hand button
 * column was drawing three buttons' worth of furniture for at most one, on every row.
 *
 * ## Nothing here is invented
 *
 * A row shows the title the provider itself keeps and the first message it recorded. Where a
 * provider has neither the row falls back to the working directory, which is a fact, and never to a
 * composed summary. An entry with nothing to say says nothing — which is also why a row whose
 * transcript is complete renders no completeness line at all.
 *
 * ## No provider literals
 *
 * The provider is rendered as the value on the entry and used as an opaque discriminant. Nothing
 * here compares it against a name, so adding a third provider changes nothing in this file (AC5).
 */
const props = withDefaults(
  defineProps<{
    /**
     * 🔴 **714 · R41 — the roster, forwarded to the recorded list** so its rows NAME whose each
     * conversation is. Read nowhere here.
     */
    identities?: readonly AgentIdentity[] | null
  }>(),
  { identities: null },
)

const emit = defineEmits<{
  /**
   * Press one entry — ⚑ D-017b: the parent opens a conversation this app records in its full
   * view, and reads one it holds no ledger for.
   */
  read: [entry: LibraryEntry]
  /** ⚑ **D-017b · forwarded from the recorded list below** — open one conversation by id. */
  open: [sessionId: string]
  /** Open the confirmation that lists what deleting this conversation would remove. */
  delete: [sessionId: string]
  /** These conversations were archived from a row: a view of any of them should close. */
  archived: [conversations: readonly string[]]
}>()

/** The recorded list, so the screen can ask it to re-read when the host says something moved. */
const reopenList = ref<InstanceType<typeof ResumableSessions> | null>(null)

defineExpose({
  refreshResumable: (): void => void reopenList.value?.refresh(),
  /** Read the rows again: a conversation was archived or deleted from a sheet over this page. */
  reread: (): void => void load(),
})

const page = ref<LibraryPage | null>(null)
const query = ref('')
/**
 * **The structured narrowing** (121) — held beside `query` because they are two independent axes.
 *
 * ⛔ **Clearing one does not clear the other** (`120` §4). A person narrows by facet and then types
 * within it; blowing the facets away on a backspace would be surprising and would cost a wasted
 * round trip. Each has its own clear and `Clear all` clears both.
 */
const filters = ref<LibraryFilters>({ ...NO_FILTERS })
/**
 * ⛔ **The filters the page in hand was READ WITH** (121, review — three angles found this).
 *
 * `filters` changes the instant a facet is pressed; the answer arrives a debounce and a round trip
 * later. So anything that qualifies the page's own NUMBER has to come from here, not from the
 * controls: built from live filters and the previous page's count, the sticky badge read
 * *"2,027 match · Codex"* for the whole wait, and the window note said *"of 2,027 matching
 * conversations · Codex"*. That is `086`'s fabricated number appearing inside the control `120` §3
 * added to prevent it — and the tests never saw it, because every one of them sleeps past the
 * debounce before asserting.
 */
const applied = ref<LibraryFilters>({ ...NO_FILTERS })
const loading = ref(false)
const error = ref<string | null>(null)
/**
 * ⚑ **The same scan the rail runs, not a second one** (`120` §7). See {@link useHomeScan} — it is
 * on this screen because `adoptSessions()` back-fills the very `child` descent the **Kind** facet
 * reads, and a filter whose data source lives behind a collapsed link on another screen answers off
 * a stale column without saying so.
 */
/**
 * ⛔ **The scan button's label, once** (329 §4.3, `310`'s rule for `credential-words.ts`).
 *
 * The head's disclosure has to name this control to say what it is NOT, and a second copy of the
 * word in prose would be a label that could be edited on the button while the sentence went on
 * saying the old thing — *"a lie that no test comparing a string to itself could catch"*.
 *
 * ⚠️ **Local to this file rather than shared with the rail**, which calls the same act *"scan for
 * existing conversations"*. Those two labels are already different and 120 §7 shared what it ruled
 * had to be shared — the call and the REPORT (`scanSummary`). Hoisting one file's button text into
 * a module both read would not make the labels agree; it would only make it harder to see that they
 * do not. Reported rather than fixed.
 */
const CHECK_HOMES = 'Check homes'

const homeScan = useHomeScan()
/**
 * The outcome of the last import, keyed by `entry.id` — which is the PROVIDER's identity and does
 * not change when the conversation becomes one we hold. It used to be our row id, which is null
 * until the import lands: the key moved at exactly the moment the outcome arrived, so a successful
 * import silently dropped its own confirmation while a failed one kept it.
 */
const outcomes = ref<Record<string, ImportedFromHome>>({})
/** Which rows have an import in flight, so a row cannot be pressed twice into the same queue. */
const importing = ref<Record<string, boolean>>({})
/**
 * The same, for a rebuild (065) — a SECOND map rather than one shared "busy" flag, because a row can
 * legitimately be offered both and they are different questions: import brings the bytes in, rebuild
 * re-reads the bytes already here.
 */
const rebuilding = ref<Record<string, boolean>>({})

/**
 * Which read the list is showing.
 *
 * Reads are issued per keystroke and answered out of order — the main process reads the user's real
 * homes, so a broad query genuinely takes longer than a narrow one. Without this, typing `par` then
 * `parser` can land `par`'s bigger result LAST and leave the list showing rows that do not match
 * what is in the box. Only the newest read is allowed to write.
 *
 * ⛔ **Bumped by the WATCHER as well as by `load()`, and that was the hole** (121 review). `issued`
 * used to move only when a read started, so a read already in flight when the input changed still
 * satisfied `mine === issued` when it landed: it wrote its page AND cleared `loading`, leaving the
 * surface settled and silent on an answer to the previous question for the whole debounce. Typing
 * into a library still walking both provider homes reached the state `105` fixed for keystrokes —
 * *Nothing matches "auth"* about a read that never searched — by the other door.
 */
let issued = 0

async function load(): Promise<void> {
  const mine = ++issued
  loading.value = true
  error.value = null
  const asked: LibraryFilters = { ...filters.value }
  try {
    // ⛔ **Both axes go main-side, together, every time.** Filtering the page in hand would search
    // the first 200 entries of two thousand — and `matched` in the answer counts `query ∧ filters`
    // over the WHOLE library before the slice, which is what keeps the note below honest.
    const result = await window.api.runtime.listLibrary({
      query: query.value,
      // ⛔ **A plain snapshot, not the reactive object** (121, found by the browser test). `filters`
      // is a `ref` holding an object, so `filters.value` is a Vue PROXY — and this call crosses a
      // process boundary by structured clone, which refuses a proxy outright (`DataCloneError`:
      // "An object could not be cloned"). Every filter press would have failed at the wire and the
      // surface would have shown the read error, having never asked. Spreading is enough because
      // every field here is a primitive; there is no nested value left behind a handler.
      filters: asked,
    })
    if (mine !== issued) return
    page.value = result
    // The two move together, always: `page.matched` is only meaningful beside the filters it was
    // counted over, and anything that says WHICH rows matched reads this rather than the controls.
    applied.value = asked
  } catch (cause) {
    if (mine !== issued) return
    // Shown, never swallowed: reading the library touches the user's own directories, and a failure
    // there is worth saying out loud rather than rendering as an empty list.
    error.value = readableError(cause)
  } finally {
    if (mine === issued) loading.value = false
  }
}

/**
 * Search re-reads main-side rather than filtering the page in hand: the page is bounded, so
 * filtering here would search the first 200 entries of two thousand and quietly call it a result.
 */
let debounce: number | undefined
watch([query, filters], () => {
  window.clearTimeout(debounce)
  /**
   * ⚠️ **Marked as reading on the KEYSTROKE, not when the read starts** (105 review, two findings).
   * `loading` used to be set inside `load()`, which is 180ms later, and the page in hand belongs to
   * the PREVIOUS query for every one of those milliseconds. Two ways that showed:
   *  - Backspace from `conductorz` (0 matches) to `conductor` (matches): for 180ms the surface
   *    printed *Nothing matches "conductor"* — quoting, in its own heading, a string nobody had
   *    searched for, about a result that was somebody else's.
   *  - Clear the box entirely: `searching` flips to false synchronously while the zero-match page
   *    stays, so the empty state fell through to *"Nothing came back for this read"* while the
   *    counts line above it said twelve conversations.
   * A stale answer is worse than no answer, so during the wait there is no answer. The list itself
   * is untouched while it has rows — only the empty states, which are the ones that lie.
   */
  loading.value = true
  // …and the read already in flight is retired here, not merely out-ranked when the next one
  // starts. See {@link issued}.
  issued++
  debounce = window.setTimeout(() => void load(), 180)
})

onMounted(() => void load())
// A pending keystroke must not fire into a component that is gone.
onUnmounted(() => {
  window.clearTimeout(debounce)
  // The freshness clock, which would otherwise keep waking a component that is gone.
  if (ticking !== undefined) window.clearInterval(ticking)
})

/**
 * Import one conversation out of a provider home.
 *
 * Whatever comes back is shown as itself. "Already imported" is an outcome the host names, not a
 * failure — a row that reported it as an error would send someone looking for a bug in a working
 * import.
 */
async function importEntry(entry: LibraryEntry): Promise<void> {
  if (entry.providerSessionId === null || importing.value[entry.id]) return
  importing.value = { ...importing.value, [entry.id]: true }
  try {
    outcomes.value = {
      ...outcomes.value,
      [entry.id]: await window.api.runtime.importUserHomeSession({
        provider: entry.provider,
        providerSessionId: entry.providerSessionId,
      }),
    }
    // Re-read so the row's own state — imported, readable — comes from the store rather than from
    // what the button assumed the press would do.
    await load()
  } catch (cause) {
    outcomes.value = {
      ...outcomes.value,
      [entry.id]: {
        outcome: 'unreadable',
        sessionId: null,
        readable: false,
        note: readableError(cause),
      },
    }
  } finally {
    importing.value = { ...importing.value, [entry.id]: false }
  }
}

/**
 * Rebuild one conversation's transcript from its provider's file (065).
 *
 * Offered only where the contract says it is worth offering — see {@link behind}. The row re-reads
 * itself afterwards for the same reason the import does: what state it ended in is the store's to
 * say, not the button's to assume.
 */
async function rebuildEntry(entry: LibraryEntry): Promise<void> {
  if (entry.recordId === null || rebuilding.value[entry.id]) return
  rebuilding.value = { ...rebuilding.value, [entry.id]: true }
  try {
    const result = await window.api.runtime.rebuildLedger({ sessionId: entry.recordId })
    outcomes.value = {
      ...outcomes.value,
      [entry.id]: {
        // The rebuild's own words, mapped onto the same row surface the import already uses rather
        // than a second one beside it.
        //
        // ⚠️ **Three buckets, not two** (review). Everything-but-success used to land on
        // `unreadable`, which this surface paints in warning colour — so "BroBot2 is shutting down,
        // so nothing was started" arrived looking like a fault, and a user who read the sentence and
        // then saw the colour would believe the colour. Only the endings where something actually
        // did not work are warned about; the benign ones borrow `up-to-date`, which is what the
        // import path already uses for "you already have this".
        outcome: rebuildOutcome(result.outcome),
        sessionId: entry.recordId,
        readable: result.status?.present ?? false,
        note: rebuildNote(result, entry.provider),
      },
    }
    await load()
  } catch (cause) {
    outcomes.value = {
      ...outcomes.value,
      [entry.id]: {
        outcome: 'unreadable',
        sessionId: entry.recordId,
        readable: false,
        note: readableError(cause),
      },
    }
  } finally {
    rebuilding.value = { ...rebuilding.value, [entry.id]: false }
  }
}

/**
 * Which of this surface's three tones an ending deserves.
 *
 * `imported` reads as success, `up-to-date` as ordinary, `unreadable` as a warning. The split is by
 * *did something go wrong*, not by *did it rebuild*: a refusal during shutdown and a session that is
 * already whole are both the system working, and colouring them like a failure would contradict the
 * sentence printed beside them.
 */
function rebuildOutcome(outcome: RebuiltLedger['outcome']): ImportedFromHome['outcome'] {
  switch (outcome) {
    case 'imported':
      return 'imported'
    case 'still-writing':
      return 'still-writing'
    case 'skipped':
    case 'recorded':
    case 'in-use':
    case 'refused':
    case 'stopped':
    case 'superseded':
      // ⛔ **`superseded` reads as ordinary and NOT as a failure** (293 §4). Another writer promoted
      // a different generation from the same file, so the conversation the reader is looking at
      // is whole — this pass simply lost the flip, which is the system working.
      return 'up-to-date'
    case 'failed':
    case 'nothing-readable':
    case 'unknown-session':
    case 'gone':
      return 'unreadable'
  }
}

/** One line per ending, and none of them is "error". See {@link RebuiltLedger}. */
function rebuildNote(result: RebuiltLedger, provider: LibraryEntry['provider']): string {
  switch (result.outcome) {
    case 'imported':
      return 'Read again from its file.'
    case 'skipped':
      return 'Nothing to rebuild.'
    case 'nothing-readable':
      return 'Its file holds no readable conversation, so nothing was replaced.'
    case 'still-writing':
      return 'Its file is still being written. Nothing was replaced; try again when it has finished.'
    case 'gone':
      return `${providerName(provider)}'s file for this conversation is gone, so it can't be rebuilt.`
    case 'stopped':
      return 'Stopped part-way. The previous transcript is untouched; try again.'
    case 'in-use':
      return 'It is open right now, so its transcript is being recorded rather than rebuilt.'
    case 'recorded':
      return 'Its transcript is the recording made while it ran, which holds more than its file does.'
    case 'refused':
      return 'BroCrew is shutting down, so nothing was started.'
    case 'unknown-session':
      return 'There is no record of that conversation here any more.'
    case 'superseded':
      return 'Something else rebuilt it at the same moment. What you are reading is that pass’s work, not this one’s.'
    case 'failed':
      return `It could not be rebuilt: ${result.status?.failure ?? 'unknown'}. The previous transcript is untouched.`
  }
}

const entries = computed(() => page.value?.entries ?? [])
const counts = computed(() => page.value?.counts ?? null)

/** Only the archived conversations: one of main's filters, so it reaches the whole library. */
const archivedOnly = computed({
  get: () => filters.value.archived === 'only',
  set: (only: boolean) => {
    const { archived: _dropped, ...rest } = filters.value
    filters.value = only ? { ...rest, archived: 'only' } : rest
  },
})

/** Delete is offered on every conversation this app records; the sheet it opens does the asking. */
function askToDelete(entry: LibraryEntry): void {
  if (entry.recordId !== null) emit('delete', entry.recordId)
}

/** A restore in flight, and main's words when it refused one, by row. */
const bringingBack = ref<Record<string, boolean>>({})
const restoreRefused = ref<Record<string, string>>({})

/** Rows whose archive is under way, and what main said when it refused one. */
const archiving = ref<Record<string, boolean>>({})
const archiveRefused = ref<Record<string, string>>({})

/** Archive a recorded conversation and every helper below it, from its row. */
async function archiveEntry(entry: LibraryEntry): Promise<void> {
  if (entry.recordId === null || archiving.value[entry.id]) return
  archiving.value = { ...archiving.value, [entry.id]: true }
  archiveRefused.value = Object.fromEntries(
    Object.entries(archiveRefused.value).filter(([id]) => id !== entry.id),
  )
  try {
    const outcome = await archiveConversation(window.api.runtime, entry.recordId)
    if (!outcome.done) {
      archiveRefused.value = { ...archiveRefused.value, [entry.id]: outcome.refusal }
      return
    }
    emit('archived', outcome.conversations)
    await load()
  } finally {
    archiving.value = { ...archiving.value, [entry.id]: false }
  }
}

/** Bring an archived conversation and its archived tree back to the lists. */
async function restoreEntry(entry: LibraryEntry): Promise<void> {
  if (entry.recordId === null || bringingBack.value[entry.id]) return
  bringingBack.value = { ...bringingBack.value, [entry.id]: true }
  restoreRefused.value = Object.fromEntries(
    Object.entries(restoreRefused.value).filter(([id]) => id !== entry.id),
  )
  try {
    const outcome = await restoreConversation(window.api.runtime, entry.recordId)
    if (!outcome.done) {
      restoreRefused.value = { ...restoreRefused.value, [entry.id]: outcome.refusal }
      return
    }
    await load()
  } finally {
    bringingBack.value = { ...bringingBack.value, [entry.id]: false }
  }
}

/**
 * What this read could not look at — one sentence, read by both empty branches (329 §4.4).
 *
 * ⚠️ **Off `page`, not off `counts`.** `skippedTotal` is a property of the READ and is the same
 * whatever is in the box — `userHomeSessions()` takes no query — so it survives `counts === null`
 * and needs none of the `<template v-if="counts">` guarding the sentences above it do.
 */
const scopeNote = computed(() => searchScopeNote(page.value, { searching: searching.value }))

/**
 * **The window note's own condition** (104): what is on screen, against what the query matched.
 *
 * `matched` is null-guarded rather than defaulted to zero — before the first read lands there is no
 * page, and `0 < 0` and "we have not asked yet" must not be the same answer.
 *
 * ⚠️ **Routed through {@link narrowingDeclaredBy} rather than beside it** (121 review). That
 * function was exported, documented as the rule and asserted four ways — and never called, which is
 * `105`'s dead-`provenance()` shape: a claim about the surface that the surface does not consult.
 * It decides the note; the sticky count on the facet row is present whenever a filter is on, which
 * is that function's `pinned-count` answer and not a second opinion about this one.
 */
const truncated = computed(
  () =>
    page.value !== null &&
    narrowingDeclaredBy({
      shown: page.value.entries.length,
      matched: page.value.matched,
      filtered: anyFilter(applied.value),
    }) === 'window-note',
)

/**
 * The two empty states 104 split apart, told by the ONE thing that distinguishes them: whether
 * anything was asked for.
 *
 * A search that found nothing and a machine that has never swept are the same empty list and
 * completely different situations — one is answered by typing less, the other by waiting for a
 * sweep — and the single `.hint` this surface used to render said neither.
 *
 * ⚠️ **Neither of them describes a read that FAILED, and that is why the template gates the whole
 * empty block on a page having actually arrived** (105 review, found independently by three
 * angles). `load()`'s catch sets `error` and deliberately leaves `page` alone — so on a first read
 * that throws, `page` is null, `counts` is null, and `firstRun` computed `true` off the `?? 0`.
 * The surface then printed "Couldn't read your provider homes: EACCES" and, directly underneath,
 * the reassuring "Nothing swept yet — start a conversation". One of those two sentences was
 * invented, and it was the calm one. There is no third empty state for it: when the read failed
 * and there is nothing to describe, the banner is the whole answer.
 */
const searching = computed(() => query.value.trim() !== '')
const filtered = computed(() => anyFilter(filters.value))
/**
 * ⚠️ **A third empty state, and it goes FIRST** (121, `120` §5). A list emptied by a facet
 * combination is not a search miss and is not a fresh install, and falling through to either would
 * describe the wrong situation — the search miss would quote a query that may be empty, and first
 * run would say "nothing swept yet" about a library of two thousand.
 */
const firstRun = computed(
  () => !searching.value && !filtered.value && (counts.value?.total ?? 0) === 0,
)

/** Every constraint currently narrowing the list — facets, state toggles and the query. */
const constraints = computed(() => activeConstraints(filters.value, query.value))

/**
 * ⛔ **The count belongs to the page, so it goes quiet while a new one is in flight** (review).
 *
 * Null the moment the controls and the page disagree — the badge then renders a dash and keeps
 * saying the list is narrowed, which is both true and the whole job. A number carried over from
 * the previous filters would be a fabricated one; a badge that vanished would say the list is
 * unfiltered, which is the other lie.
 */
const settledMatched = computed(() =>
  page.value !== null && sameFilters(applied.value, filters.value) ? page.value.matched : null,
)

/**
 * The facets the WINDOW NOTE's own count was taken over — `applied`, not the controls, because the
 * note is a sentence about the page underneath it. The query is already quoted in the note.
 */
const noteSummary = computed(() =>
  activeConstraints(applied.value, '')
    .map((constraint) => constraint.label)
    .join(' · '),
)

/**
 * ⛔ **Two clears, and they are two** (`120` §4). Independent axes: dropping the facets keeps the
 * query, dropping the query keeps the facets, and `Clear all` is the only thing that does both.
 */
function clearFilters(): void {
  filters.value = { ...NO_FILTERS }
}

function clearSearch(): void {
  query.value = ''
}

function clearAll(): void {
  clearFilters()
  clearSearch()
}

/** Drop one named constraint — what a chip's × does, on the axis that constraint belongs to. */
function dropConstraint(constraint: Constraint): void {
  if (constraint.axis === 'query') clearSearch()
  else filters.value = withoutConstraint(filters.value, constraint.key)
}

/**
 * **Look through the provider homes — the SAME operation the rail's link runs** (`120` §7).
 *
 * The list re-reads afterwards for the reason every other press here does: what the scan changed is
 * the store's to report, not this button's to assume. And it changed something this screen renders —
 * the descent behind the Kind facet — so a page left as it was would be showing the answer to the
 * question asked before the scan.
 */
async function checkHomes(): Promise<void> {
  // The re-read runs INSIDE the busy flag (review): the button must not re-enable while its own
  // follow-up is still fetching, on this surface any more than on the rail's.
  const result = await homeScan.scan(load)
  if (result === null) return
  scanError.value = 'error' in result ? result.error : null
}

/**
 * ⚠️ **The scan's own failure, NOT the read's banner** (121, review of my own first version).
 *
 * The first version set `error`, which draws *"Couldn't read Claude's and Codex's own folders"*
 * over the list —
 * and, where there are rows, *"The list below is only what could be reached"*. That second sentence
 * would have been false: the list below came from a read that SUCCEEDED, and what failed was a
 * scan. Two operations, two consequences, so two places to say so. The banner keeps meaning exactly
 * what its own tests say it means.
 */
const scanError = ref<string | null>(null)

/**
 * # ⛔ Bringing a bundle back — the return half of Export (214 §1, from 213 finding 1)
 *
 * `213`, after an hour: *"Export succeeded and BroBot described it as a self-contained copy. The
 * visible Import actions only import provider-history messages; there was no bundle/file import
 * action or picker anywhere in the Sessions UI."* ⛔ **Its verdict was that this is what stops
 * BroBot being a durable workbench**, and `011`/`027` had already proved the bytes were right.
 *
 * ⚠️ **A field AND a picker, which is 076 §3's shape** and not a hedge. The picker is for the file
 * you just exported — main defaults the dialog to the app's own exports directory. The field is for
 * the one somebody sent you, which is the case the whole feature is for: a path out of a chat
 * window is pasted, not browsed to. `NewConversation`'s cwd control is the same pair for the same
 * reason, and its typed half is the one this app's own smoke can drive.
 */
const bundlePath = ref('')
const restoring = ref(false)
/** The last attempt's answer, verbatim from the host — never composed here (086). */
const restored = ref<ImportedBundle | null>(null)

/**
 * ⛔ **A verdict belongs to the path it was about** (214 §1, review). `restored` outlived the field,
 * so *"Restored 412 entries"* stayed on screen — as `role=status`, announced — underneath a
 * different path that had never been restored. The watcher is what ties the sentence to its subject;
 * clearing it inside the handlers alone could not, because the field changes without one.
 */
watch(bundlePath, () => {
  restored.value = null
})

async function chooseBundle(): Promise<void> {
  const picked = await window.api.chooseBundle()
  // Null is CANCELLED, which is not a failure and must not clear what was already typed.
  if (picked === null) return
  bundlePath.value = picked
  restored.value = null
}

/**
 * ⛔ **Restore, then RE-READ the list** — for the same reason `checkHomes` does: what landed is the
 * store's to report. A surface that added its own row would be describing a conversation from the
 * file it just read instead of from the database that now holds it, and those are free to differ.
 */
async function restoreBundle(): Promise<void> {
  const path = bundlePath.value.trim()
  if (path === '' || restoring.value) return
  restoring.value = true
  restored.value = null
  try {
    const result = await window.api.runtime.importBundleFile({ path })
    restored.value = result
    // Only on success: a refusal changed nothing, and re-reading two thousand rows to prove it
    // would be work with no answer in it.
    if (result.ok) await load()
  } catch (error) {
    // The command itself failed — a store error, not a file the person chose. Said in the same
    // place as every other outcome, so there is no path where the button appears to do nothing.
    restored.value = { ok: false, reason: readableError(error) }
  } finally {
    restoring.value = false
  }
}

/**
 * What the last restore did, in one sentence.
 *
 * ⚑ **"already here" is its own sentence, not a quieter "restored"** (`194` H4) — and since 236 §1
 * it is THREE sentences, because *"you already have this"* was being said about files that were
 * newer than what we had. The host compares now; this only reads the answer. See
 * `RuntimeHost.importBundleFile` for why the newer half is reported rather than taken in.
 */
const restoreNote = computed<string | null>(() => {
  const result = restored.value
  if (result === null) return null
  if (!result.ok) return result.reason
  if (result.behind) {
    // ⛔ **The numbers, in the sentence.** *"A newer copy exists"* with no figures is a claim the
    // reader cannot check or act on; `231` #7's objection is to a sentence that was confidently
    // wrong, and a vaguely-worded true one would be the same failure with better manners.
    const { held, inFile } = result.behind
    return (
      `This file is NEWER than the copy you have — it holds ${inFile} entries to your ${held}, ` +
      `${inFile - held} of them yours does not. Nothing was written: BroCrew matches a bundle by ` +
      'the provider’s own id and cannot yet take a second life of one conversation into the copy ' +
      'it already has.'
    )
  }
  return result.already
    ? 'You already have this conversation — nothing was written, and your copy is not behind this file.'
    : `Restored ${result.events} entries from ${result.provider}. It ran in ${result.cwd}, so it is here to read rather than to carry on — there is no Resume for it.`
})

const scanNote = computed(() => scanSummary(homeScan.lastScan.value))
/**
 * When the last scan landed, in the same relative words the rows use.
 *
 * Null until one has, and the note is gated on BOTH — a freshness line that said "just now" for
 * ever, or "0m ago" about a scan nobody ran, would be this surface asserting something it has not
 * been told. There is no persisted last-scan time to read: what this reports is the press that
 * happened on this screen, and it says nothing about presses it did not see.
 */
const lastChecked = computed(() =>
  homeScan.scannedAt.value === null ? null : ago(homeScan.scannedAt.value, tick.value),
)

/**
 * ⛔ **A clock this component can see** (121, review). `ago()` reads `Date.now()`, which is not a
 * reactive dependency — so `lastChecked` was a `computed` that re-evaluated only when another scan
 * landed, and the note read *"last checked 0m ago"* for as long as the surface stayed open. The
 * comment above says in as many words that a line saying "just now" for ever is what this must not
 * be; it was that.
 *
 * A minute is the resolution `ago()` reports in, so anything finer would be work with nothing to
 * show for it. Started only once a scan has landed, and cleared on unmount.
 */
const tick = ref(Date.now())
let ticking: number | undefined
watch(
  () => homeScan.scannedAt.value,
  (at) => {
    if (at === null || ticking !== undefined) return
    ticking = window.setInterval(() => (tick.value = Date.now()), 60_000)
  },
)

/** The recency bands, in order, with the empty ones dropped rather than drawn as bare headings. */
const groups = computed(() => {
  const now = Date.now()
  const bands: { key: Recency; label: string; entries: LibraryEntry[] }[] = [
    { key: 'today', label: 'Today', entries: [] },
    { key: 'week', label: 'Earlier this week', entries: [] },
    { key: 'older', label: 'Older', entries: [] },
  ]
  for (const entry of entries.value) {
    const band = bands.find((candidate) => candidate.key === recencyOf(entry.updatedAt, now))
    band?.entries.push(entry)
  }
  return bands.filter((band) => band.entries.length > 0)
})

/**
 * What a row's transcript is missing, in the reader's terms — or null when nothing is (065).
 *
 * ⚠️ **`readable` could never have said this.** It answers whether there is a conversation to open,
 * and the row that needs this sentence has one: it is real, it is incomplete, and until the store
 * carried a completeness contract the library had no way to tell the two apart. 061 finding 6, at
 * the surface where it is finally visible. The words are shared with the reading pane — see
 * {@link describeDerived}.
 */
function behind(entry: LibraryEntry): string | null {
  return describeDerived(entry.derived)
}

/**
 * Whether a rebuild would do anything. `rebuilding` is the answer already happening (104). An
 * imported conversation whose file is still in its provider's folder may have grown since it was
 * read, so it is offered too.
 */
function canRebuild(entry: LibraryEntry): boolean {
  if (entry.derived === 'stale' || entry.derived === 'failed') return true
  return entry.derived === 'current' && entry.onDisk
}

/** Whether these bytes are still only the provider's. The one row where Import is the whole point. */
function canImport(entry: LibraryEntry): boolean {
  return (
    entry.providerSessionId !== null &&
    (entry.recordId === null || (entry.origin === 'user-home' && entry.onDisk && !entry.readable))
  )
}

/**
 * A row that offers no action at all, and therefore the one place the store's own
 * `unresumableReason` earns its space.
 *
 * ⚠️ **It answers "why can it not be carried on", NOT "why is there nothing to read"** — those are
 * two questions and the store composes only the first (`whyNotResumable`). So the line names the
 * question it is answering rather than being printed as an explanation of the emptiness, which
 * would be this surface inventing a fact for the one reason it exists not to. On every other row
 * kind it is either null, or said louder by a button standing next to it.
 *
 * ⚠️ **`canRebuild` is in the list, and it was missing** (105 review). A row can be unreadable and
 * `failed` at once — the store reaches `failed` off the failure column before it ever looks at
 * whether anything is present — and that row was drawing "Can't be carried on" directly above a
 * live **Try again**. The sentence is not false there, but its whole justification is that the row
 * has nothing to offer, and a button is something to offer.
 */
function offersNothing(entry: LibraryEntry): boolean {
  return (
    !entry.readable && !canImport(entry) && !canRebuild(entry) && entry.unresumableReason !== null
  )
}

/**
 * **The row is the target** (104) — read is safe, read-only and the common case, so it does not
 * deserve a button competing with the one control that changes something.
 *
 * Two refusals, both of them things a click on a whole row gets wrong by default. A click that
 * landed on a control belongs to the control: `Rebuild` sits INSIDE the row and pressing it must
 * not also open the conversation. And a click that ends a text selection is somebody copying a
 * working directory, not asking to navigate — the `cwd` is mono and copyable on purpose, and a row
 * that opened itself every time you selected the path would make it un-copyable in practice.
 *
 * ⚠️ **The copy-guard is TRIMMED and SCOPED, and it was neither** (105 review). `getSelection()` is
 * a property of the window, not of this row, so the bare check refused a click for two reasons that
 * have nothing to do with the row under the cursor: a selection left anywhere else on the page
 * disabled the whole list, and a selection resolving to pure whitespace — a stray drag across the
 * gap between the chip and the clock — is invisible on screen while still being a non-empty string.
 * Either way the row silently did nothing and said nothing about why. `containsNode(row, true)`
 * asks the only question that matters: is the text you highlighted in THIS row.
 */
function rowClick(entry: LibraryEntry, event: MouseEvent): void {
  if (!entry.readable) return
  const row = (event.currentTarget ?? event.target) as HTMLElement | null
  if ((event.target as HTMLElement | null)?.closest('button') !== null) return
  const selection = window.getSelection()
  const selecting =
    selection !== null && selection.toString().trim() !== '' && row !== null
      ? selection.containsNode(row, true)
      : false
  if (selecting) return
  emit('read', entry)
}

/** What a row is called: the provider's own title, else its directory. Never a composed summary. */
function label(entry: LibraryEntry): string {
  return entry.title || basenameOf(entry.cwd) || entry.cwd
}

/** An unread user-home file remains importable even after an unfinished attempt gave it a row. */
function provenance(entry: LibraryEntry): string {
  return `in ${providerName(entry.provider)}'s own folder, not imported`
}

/**
 * How long ago, in the reader's terms.
 *
 * ⚠️ **`now` is a parameter**, so a caller that has to RE-RENDER as time passes can pass a reactive
 * clock. Rows read the wall clock on every render and are re-rendered by every read; the scan's
 * freshness line is not, and was frozen at "0m ago" until it was given one (121 review).
 */
function ago(at: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

function size(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <section class="library" data-cy="session-library" data-chat-theme="light">
    <div class="lib-headingbar">
      <header class="lib-head">
        <div class="heading">
          <h1 class="bb-page-title">All conversations</h1>

          <p v-if="counts" class="counts" data-cy="library-counts">
            {{ counts.total }} conversations · {{ counts.ours }} ours · {{ counts.imported }}
            imported ·
            <span :class="{ emphasis: counts.notImported > 0 }">
              {{ counts.notImported }} not imported
            </span>
            <span v-if="counts.onlyHere > 0" class="only">
              · {{ counts.onlyHere }} of them survive only here
            </span>
          </p>
        </div>
        <div class="head-actions">
          <button
            type="button"
            class="scan bb-button"
            :disabled="homeScan.scanning.value"
            data-cy="library-check-homes"
            title="Look in every profile's folder for conversations this app never recorded"
            @click="checkHomes"
          >
            {{ homeScan.scanning.value ? 'Checking…' : CHECK_HOMES }}
          </button>
        </div>
      </header>
    </div>
    <div class="library-columns">
      <div class="library-results">
        <div class="lib-top">
          <div class="search">
            <input
              v-model="query"
              type="search"
              :maxlength="LIBRARY_QUERY_MAX"
              data-cy="library-search"
              placeholder="Search titles, first messages and working directories"
              aria-label="Search sessions"
            />

            <button
              v-if="searching"
              type="button"
              class="s-clear"
              data-cy="library-clear-search"
              @click="clearSearch"
            >
              Clear
            </button>
          </div>

          <FacetBar
            :filters="filters"
            :counts="counts"
            :matched="settledMatched"
            :archived="archivedOnly"
            @update:filters="filters = $event"
            @update:archived="archivedOnly = $event"
            @clear-all="clearAll"
          />
        </div>

        <div class="lib-scroll">
          <div v-if="error" class="banner" role="alert">
            <p class="b-head">Couldn't read {{ ALL_PROVIDER_FOLDERS }}</p>

            <p class="b-body" data-cy="library-error">{{ error }}</p>

            <p v-if="entries.length > 0" class="b-foot">
              The list below is only what could be reached.
            </p>
          </div>

          <p v-if="truncated && page" class="window-note" data-cy="library-window-note">
            <strong>Showing the {{ page.entries.length }} most recent</strong>
            of {{ page.matched }} matching conversations<span
              v-if="noteSummary"
              class="cons"
              data-cy="library-note-constraints"
            >
              · {{ noteSummary }}</span
            >.
            <span class="go">{{ windowNoteCta({ searching, filtered }) }} to reach the rest</span>
            — search reads every source, not just this window.
          </p>

          <p v-if="loading && entries.length === 0" class="hint">Reading…</p>

          <div
            v-else-if="page !== null && entries.length === 0"
            class="empty"
            data-cy="library-empty"
          >
            <template v-if="filtered">
              <div class="mk" aria-hidden="true">⌗</div>
              <h2 data-cy="library-filtered-empty">No conversations match this combination</h2>
              <p>
                Nothing
                <template v-if="counts">across your {{ counts.total }} conversations </template>
                matches all of these at once. Each one is below — drop the one you do not need.
              </p>

              <p v-if="scopeNote" class="scope" data-cy="library-filtered-scope">{{ scopeNote }}</p>
              <div class="constraints" data-cy="library-constraints">
                <button
                  v-for="constraint in constraints"
                  :key="constraint.key"
                  type="button"
                  class="cons-chip"
                  :data-cy="`library-constraint-${constraint.key}`"
                  :aria-label="`Remove ${constraint.chip}`"
                  @click="dropConstraint(constraint)"
                >
                  {{ constraint.chip }} <span aria-hidden="true">×</span>
                </button>
              </div>
              <div class="relax">
                <button
                  type="button"
                  class="prim"
                  data-cy="library-clear-filters"
                  @click="clearFilters"
                >
                  Clear filters
                </button>

                <button
                  v-if="searching"
                  type="button"
                  data-cy="library-empty-clear-search"
                  @click="clearSearch"
                >
                  Clear search
                </button>
              </div>
            </template>

            <template v-else-if="searching">
              <div class="mk" aria-hidden="true">?</div>
              <h2 data-cy="library-no-match">Nothing matches “{{ query.trim() }}”</h2>

              <p>
                No title, first message, working directory or provider name
                <template v-if="counts">across your {{ counts.total }} conversations </template>
                contains that. Try fewer words, or a directory name.
              </p>

              <p v-if="scopeNote" class="scope" data-cy="library-search-scope">{{ scopeNote }}</p>
            </template>

            <template v-else-if="firstRun">
              <div class="mk" aria-hidden="true">◇</div>
              <h2 data-cy="library-first-run">Nothing swept yet</h2>
              <p>
                This is where every conversation on this machine will live — the ones this app ran,
                and the ones it finds in {{ ALL_PROVIDER_FOLDERS }}.
              </p>

              <p>
                Start a conversation. {{ ALL_PROVIDER_FOLDERS }} are read again every time this list
                loads, so anything that turns up in them will be listed here.
              </p>
            </template>

            <template v-else>
              <h2>No conversations to show</h2>
              <p>
                Nothing came back for this read — neither ours nor anything in
                {{ A_PROVIDER_FOLDER }}.
              </p>
            </template>
          </div>

          <ul v-else-if="entries.length > 0" class="rows" data-cy="library-rows">
            <template v-for="group in groups" :key="group.key">
              <li class="divider" :data-cy="`library-band-${group.key}`">{{ group.label }}</li>
              <li
                v-for="entry in group.entries"
                :key="entry.id"
                class="row"
                :class="{ readable: entry.readable }"
                :data-origin="entry.origin"
                :data-cy="`library-row-${entry.id}`"
                @click="rowClick(entry, $event)"
              >
                <div class="row-body">
                  <div class="r-line1">
                    <span class="r-title">{{ label(entry) }}</span>

                    <span
                      v-if="entry.child"
                      class="chip child"
                      :data-cy="`library-child-${entry.id}`"
                    >
                      <span class="dot" aria-hidden="true"></span>
                      {{ childLabel(entry.child) }}
                    </span>
                    <span class="chip" :class="originChipOf(entry).kind">
                      <span class="dot" aria-hidden="true"></span>
                      {{ originChipOf(entry).label }}
                    </span>
                    <span
                      v-if="entry.archivedAt !== undefined"
                      class="chip archived"
                      :data-cy="`library-archived-${entry.id}`"
                    >
                      Archived {{ calendarDay(entry.archivedAt) }}
                    </span>
                    <span class="r-when">{{ ago(entry.updatedAt) }}</span>
                  </div>

                  <div class="r-line2">
                    <span class="r-cwd mono">{{ entry.provider }} · {{ entry.cwd }}</span>
                    <span v-if="entry.bytes !== null" class="r-aside"
                      >· {{ size(entry.bytes) }}</span
                    >

                    <span v-if="canImport(entry)" class="r-aside">· {{ provenance(entry) }}</span>
                  </div>

                  <p v-if="entry.preview" class="r-preview">{{ entry.preview }}</p>

                  <div
                    v-if="behind(entry) || canRebuild(entry)"
                    class="behind"
                    :data-derived="entry.derived"
                    :data-cy="`library-behind-${entry.id}`"
                  >
                    <span
                      v-if="entry.derived === 'rebuilding'"
                      class="spin"
                      aria-hidden="true"
                    ></span>
                    <span v-if="behind(entry)" class="txt">{{ behind(entry) }}</span>

                    <button
                      v-if="canRebuild(entry)"
                      type="button"
                      class="rebuild"
                      :disabled="rebuilding[entry.id]"
                      :data-cy="`library-rebuild-${entry.id}`"
                      @click="rebuildEntry(entry)"
                    >
                      {{
                        rebuilding[entry.id]
                          ? 'Rebuilding…'
                          : entry.derived === 'failed'
                            ? 'Try again'
                            : 'Rebuild'
                      }}
                    </button>
                  </div>

                  <p
                    v-if="outcomes[entry.id]"
                    class="outcome"
                    :data-outcome="outcomes[entry.id]?.outcome"
                    :data-cy="`library-outcome-${entry.id}`"
                  >
                    {{ outcomes[entry.id]?.note }}
                  </p>

                  <p v-if="offersNothing(entry)" class="why" :data-cy="`library-why-${entry.id}`">
                    Can't be carried on: {{ entry.unresumableReason }}
                  </p>

                  <p
                    v-if="restoreRefused[entry.id]"
                    class="outcome"
                    data-outcome="unreadable"
                    role="alert"
                    :data-cy="`library-restore-refused-${entry.id}`"
                  >
                    {{ restoreRefused[entry.id] }}
                  </p>

                  <p
                    v-if="archiveRefused[entry.id]"
                    class="outcome"
                    data-outcome="unreadable"
                    role="alert"
                    :data-cy="`library-archive-refused-${entry.id}`"
                  >
                    {{ archiveRefused[entry.id] }}
                  </p>
                </div>

                <div
                  v-if="entry.readable || canImport(entry) || entry.recordId !== null"
                  class="row-act"
                >
                  <button
                    v-if="entry.recordId !== null && entry.archivedAt !== undefined"
                    type="button"
                    class="bring-back"
                    :disabled="bringingBack[entry.id]"
                    :data-cy="`library-restore-${entry.id}`"
                    @click="restoreEntry(entry)"
                  >
                    {{ bringingBack[entry.id] ? 'Restoring…' : 'Restore' }}
                  </button>

                  <button
                    v-if="entry.recordId !== null && entry.archivedAt === undefined"
                    type="button"
                    class="read-cue"
                    :disabled="archiving[entry.id]"
                    :aria-label="`Archive ${label(entry)}`"
                    :data-cy="`library-archive-${entry.id}`"
                    @click="archiveEntry(entry)"
                  >
                    {{ archiving[entry.id] ? 'Archiving…' : 'Archive' }}
                  </button>

                  <button
                    v-if="entry.recordId !== null"
                    type="button"
                    class="read-cue"
                    :aria-label="`Delete ${label(entry)}`"
                    :data-cy="`library-delete-${entry.id}`"
                    @click="askToDelete(entry)"
                  >
                    Delete…
                  </button>

                  <button
                    v-if="canImport(entry)"
                    type="button"
                    class="import"
                    :disabled="importing[entry.id]"
                    :data-cy="`library-import-${entry.id}`"
                    @click="importEntry(entry)"
                  >
                    {{ importing[entry.id] ? 'Importing…' : 'Import' }}
                  </button>

                  <button
                    v-else-if="entry.readable"
                    type="button"
                    class="read-cue"
                    :aria-label="`${entry.recordId ? 'Open' : 'Read'} ${label(entry)}`"
                    :data-cy="`library-read-${entry.id}`"
                    @click="emit('read', entry)"
                  >
                    {{ entry.recordId ? 'Open' : 'Read' }} <span aria-hidden="true">›</span>
                  </button>
                </div>
              </li>
            </template>
          </ul>

          <details v-if="page && page.skippedTotal > 0" class="skipped" data-cy="library-skipped">
            <summary>{{ page.skippedTotal }} could not be read</summary>
            <ul>
              <li v-for="item in page.skipped" :key="item.path" class="mono">
                {{ item.provider }} · {{ item.path }} — {{ item.reason }}
              </li>
            </ul>
            <p v-if="page.skippedTotal > page.skipped.length" class="more mono">
              …and {{ page.skippedTotal - page.skipped.length }} more not listed here.
            </p>
          </details>

          <section class="reopen" data-cy="library-reopen">
            <h2>Recorded conversations</h2>

            <p v-if="searching || filtered" class="reopen-scope" data-cy="library-reopen-scope">
              Not narrowed by the search or filters above. This band answers a different question —
              what this app recorded — and lists all of it, whatever is in the box.
            </p>
            <ResumableSessions
              ref="reopenList"
              :identities="props.identities"
              @open="(sessionId) => emit('open', sessionId)"
            />
          </section>
        </div>
      </div>
      <aside class="library-aside">
        <div class="restore bb-card" data-cy="library-restore">
          <label for="library-bundle-path">Restore a conversation from a bundle</label>
          <div class="restore-row">
            <input
              id="library-bundle-path"
              v-model="bundlePath"
              type="text"
              :maxlength="MAX_PATH_CHARS"
              class="mono bb-input"
              data-cy="library-bundle-path"
              :placeholder="`a …${BUNDLE_SUFFIX} file Export wrote, or one somebody sent you`"
              @keyup.enter="restoreBundle"
            />
            <button
              class="bb-button"
              type="button"
              data-cy="library-bundle-choose"
              @click="chooseBundle"
            >
              Choose…
            </button>
            <button
              type="button"
              class="scan bb-button"
              :disabled="bundlePath.trim() === '' || restoring"
              data-cy="library-bundle-restore"
              @click="restoreBundle"
            >
              {{ restoring ? 'Restoring…' : 'Restore' }}
            </button>
          </div>

          <p
            v-if="restoreNote"
            class="restore-note"
            :class="{ refused: restored !== null && !restored.ok }"
            data-cy="library-bundle-result"
            :role="restored !== null && !restored.ok ? 'alert' : 'status'"
          >
            {{ restoreNote }}
          </p>
        </div>

        <section class="source-guide bb-card">
          <p class="reads" data-cy="library-reads">
            Read from {{ ALL_PROVIDER_FOLDERS }} as well as from here, every time this list loads —
            and nothing in them is changed. {{ CHECK_HOMES }} is a different act: it looks through
            this app’s own profile folders for conversations it has not recorded.
          </p>

          <p v-if="scanNote && lastChecked" class="freshness" data-cy="library-scan-note">
            last checked {{ lastChecked }} — {{ scanNote }}
          </p>

          <p v-if="scanError" class="scan-failed" data-cy="library-scan-error">
            The homes could not be checked: {{ scanError }}
          </p>

          <details
            v-if="homeScan.lastScan.value && homeScan.lastScan.value.skipped.length > 0"
            class="scan-skipped"
            data-cy="library-scan-skipped"
          >
            <summary>
              {{ homeScan.lastScan.value.skipped.length }} found but not adopted — why
            </summary>
            <ul>
              <li v-for="item in homeScan.lastScan.value.skipped" :key="item.path" class="mono">
                {{ item.provider }} · {{ item.path }} — {{ item.reason }}
              </li>
            </ul>
          </details>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/**
 * ⚠️ **The `background`/`color` pair is load-bearing and was missing** (091). This surface has
 * declared `data-chat-theme` since 047, which flips the whole token ramp — `--text` to
 * `--paper-ink`, `--line` to translucent ink — but it painted no page of its own, so it composited
 * onto `--app-bg`: the app frame, which is dark chrome in both themes and correctly so. Light mode
 * therefore put paper ink on near-black and nothing else changed at all. Measured before the fix:
 * the `h1` read at **contrast 1.50**, the Home button at 3.36.
 *
 * `--chat-bg` rather than a literal, and both properties rather than one, because that is exactly
 * what `.reading-pane` and the launcher's `.conversation-pane` already say — the three surfaces
 * carry the same boundary and now paint it the same way.
 *
 * ⚠️ **The scroll moved off this element** (104 §6.7). It is now a two-part column: a head that
 * stays, and a region that scrolls. Keeping `overflow-y` here as well would give the surface two
 * scrollbars, one of which would take the head with it.
 */
.library {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  container-type: inline-size;
  background-color: var(--conversation-bg-color, var(--chat-bg));
  /* ⚑ **384 §1.3** — the ground, not a fill. `--chat-bg` stays a COLOUR (`chat-theme.test.ts`
     resolves it as the page for every contrast pair); the wash is the image on top of it. */
  background-image: var(--conversation-bg-image, var(--paper-wash));
  background-position: var(--conversation-bg-position, 0% 0%);
  background-repeat: var(--conversation-bg-repeat, repeat);
  background-size: var(--conversation-bg-size, auto);
  image-rendering: var(--conversation-bg-rendering, auto);
  color: var(--text);
}

.library > * {
  image-rendering: auto;
}

.lib-top {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  padding: var(--space-7) var(--space-7) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-5);
}

.lib-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
}

.heading {
  min-width: 0;
}

.heading h1 {
  margin: 0;
  color: var(--text-soft);
}

.counts {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.counts .emphasis {
  color: var(--text-soft);
}

/* The sweep's whole value, in the one colour this surface uses for "worth noticing" that is not a
   caution. `--accent-text-soft` rather than `--accent-text-weak`, which has NO light value and
   would have stayed pale blue on paper — the `--wash-4` shape, caught before it shipped. */
.counts .only {
  color: var(--accent-text-soft);
}

/* 🔴 **When this page reads the machine** (329 §4.3). Under the counts, above the scan's own
   report, and one step LOUDER than either — `--muted`, not the `--faint` of the footnotes around
   it. It is the only sentence on the page that says where the rows came from, and 031 rates a line
   nobody reads as worse than none. `max-width` because it is the longest line in the head and the
   layout sweep asserts nothing here overflows at 400px. */
.reads {
  max-width: 78ch;
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* The scan's own result, under the counts it will change. `--faint` like the counts: it is a
   footnote about freshness, not a claim competing with the library's own numbers. */
.freshness {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* The one place on this surface that reports something having gone wrong outside a row, and it is
   the danger ramp for the same reason the banner is: a scan that failed is not a state. */
.scan-failed {
  margin: var(--space-2) 0 0;
  color: var(--danger-text-notice);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* The scan's own rejects, in the shape the rail already draws them. Quiet, and closed by default:
   it is a footnote about files, not a failure. */
.scan-skipped {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.scan-skipped summary {
  cursor: pointer;
}

.scan-skipped ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
}

.head-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-3);
}

/* ⛔ Blue, not amber (080). Checking the homes is work in flight, not a question waiting on the
   person — and it is a secondary control, so it borrows the accent's quiet ramp
   rather than the filled CTA the Import button uses. */
.scan {
  flex: 0 0 auto;
  border-color: var(--accent-border);
  background: transparent;
  color: var(--accent-text-soft);
  cursor: pointer;
  font-size: var(--type-small);
}

.scan:hover:not(:disabled) {
  background: var(--accent-fill);
}

.scan:disabled {
  color: var(--faint);
  cursor: default;
}

/* ⛔ The return path (214 §1). Its own row under the header rather than a fourth button beside
   "Check homes": it takes a path, and a control that opens a field is not the same shape as one
   that acts on press. Quiet by default — this is the rarer of the two gestures on this screen. */
.restore {
  display: grid;
  padding: var(--space-4) 0 0;
  gap: var(--space-2);
}

.restore label {
  color: var(--muted);
  font-size: var(--type-caption);
}

/* ⚠️ **`wrap`, and the row above it is why** (104 §3, 103). The two buttons are unshrinkable, so at
   300px — the width `library-layout.dom.test.ts` measured as the one that bites — they and the
   field cannot share a line. Wrapping is what every other line on this screen does there, and the
   sweep that caught this is the same one that caught the row's provenance phrase. */
.restore-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.restore-row input {
  flex: 1 1 12rem;
  font-size: var(--type-small);
}

.restore-row > button:first-child {
  flex: 0 0 auto;
}

.restore-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
}

/* A refusal is the one outcome that has to catch the eye — and it is still not an error colour on
   the list, which read perfectly well (121's rule, applied to this pair). */
.restore-note.refused {
  color: var(--danger-text, var(--waiting));
}

.search {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.search input {
  min-width: 0;
  flex: 1;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  color: var(--text);
  font-size: var(--type-small);
}

.search input::placeholder {
  color: var(--placeholder);
}

/* The query's clear, beside the box it clears — and it does not touch the facets, which have their
   own (120 §4). */
.s-clear {
  flex: 0 0 auto;
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
}

.s-clear:hover {
  background: var(--wash-2);
  color: var(--text-soft);
}

.lib-scroll {
  min-height: 0;
  flex: 1;
  padding: var(--space-5) var(--space-7) var(--space-7);
  overflow-y: auto;
}

/* ---------------------------------------------------------------- notes */

/* Blocking, and the only thing on this surface painted in the danger ramp: everything else here is
   a state, and 065's rule is that none of those is an error. */
.banner {
  margin: 0 0 var(--space-6);
  padding: var(--space-5) var(--space-6);
  border: var(--border-width) solid var(--danger-border);
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  font-size: var(--type-small);
  line-height: var(--leading-normal);
}

.banner p {
  margin: 0;
}

.b-head {
  color: var(--danger-text-pale);
  font-weight: var(--fw-semibold);
}

.b-body {
  color: var(--danger-text);
}

/* Selector weight rather than `!important`: `.banner p` zeroes all three margins above, and this
   is the one that needs one back. */
.banner .b-foot {
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
}

/* Advisory, not blocking: the list below it is real and correct, it is just not all of them. The
   left rule rather than a card, so it reads as a margin note on the list it describes. */
.window-note {
  margin: 0 0 var(--space-5);
  padding: var(--space-3) var(--space-5);
  border-left: var(--border-accent-width) solid var(--line-strong);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.window-note strong {
  color: var(--text-soft);
  font-weight: var(--fw-semibold);
}

.window-note .go {
  color: var(--accent-text-soft);
}

/* The filters the count was taken over, in the same accent register as the facet row they name —
   so "1,063 matching · Codex" reads as one sentence about one narrowing. */
.window-note .cons {
  color: var(--accent-text-soft);
}

.hint {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-small);
}

/* ---------------------------------------------------------------- empty */

.empty {
  max-width: 440px;
  margin: var(--space-12) 0 0;
}

/* ⚠️ Not `--brand-mark-border`/`--brand-mark-fg`: both are defined in dark only, so the mark would
   have kept a blue rim and blue glyph on paper. The fill has a light value and the accent pair
   below it does too. */
.mk {
  display: grid;
  width: 34px;
  height: 34px;
  margin-bottom: var(--space-6);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-lg);
  background: var(--brand-mark-bg);
  color: var(--accent-text);
  font-size: var(--type-reading);
  place-items: center;
}

.empty h2 {
  margin: 0 0 var(--space-4);
  color: var(--text-soft);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
}

.empty p {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

/* Every constraint that produced this empty list, each one a real control that drops itself. A
   chip drawn with an × that does nothing is 106's unwired control at chip scale. */
.constraints {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-5) 0 0;
  gap: var(--space-3);
}

.cons-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--accent-2);
  border-radius: var(--radius-sm);
  background: var(--info-bg);
  color: var(--accent-2-text);
  cursor: pointer;
  font-size: var(--type-caption);
  gap: var(--space-2);
}

/* The filter's own indigo, as the facet row above it: never the warm accent. */
.cons-chip:hover {
  background: var(--info-bg);
  border-color: var(--accent-2);
}

.relax {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-6) 0 0;
  gap: var(--space-3);
}

.relax button {
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-small);
}

.relax button:hover {
  background: var(--wash-2);
  color: var(--text-soft);
}

/* The likelier of the two hatches carries the accent, because the facets are what a person just
   set — but it is a border, not a fill: Import is this surface's one accent CTA and staying that
   way is 104's rule. */
.relax .prim {
  border-color: var(--accent-border);
  color: var(--accent-text-soft);
}

.relax .prim:hover {
  background: var(--accent-fill);
  color: var(--accent-text);
}

.empty p + p {
  margin-top: var(--space-4);
  color: var(--faint);
}

/* ⛔ **What the read could not look at, beside the claim about what it did** (329 §4.4). It would
   inherit `.empty p + p` above today, and says its own register anyway: an inherited rule is one
   reorder away from silently changing what this sentence looks like. Quieter than the claim it
   qualifies and NOT a caution — it reports the bound of a read, not something that went wrong. */
.scope {
  color: var(--faint);
}

/* ---------------------------------------------------------------- the list */

.rows {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--space-3);
  list-style: none;
}

.divider {
  margin: var(--space-6) 0 var(--space-1);
  color: var(--faint);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
}

.divider:first-child {
  margin-top: 0;
}

.row {
  display: flex;
  align-items: flex-start;
  padding: var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-2);
  gap: var(--space-5);
}

.row.readable {
  cursor: pointer;
}

.row.readable:hover {
  border-color: var(--line-strong);
  background: var(--panel-3);
}

.row.readable:hover .read-cue {
  opacity: 1;
}

.row-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
}

/* Wrapping rather than shrinking (103's lesson): `min-width: 0` lets the title ellipsise, but the
   chip and the clock are `flex: 0 0 auto` by design — at a width where the two of them alone do not
   fit, the only alternative to a second line is a row that sticks out. */
.r-line1 {
  display: flex;
  min-width: 0;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.r-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.r-when {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--faint);
  font-size: var(--type-caption);
}

.chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: 15px;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-xs);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  gap: var(--space-2);
}

.chip.child {
  /* ⚠️ Not a colour alone (082's standing rule, and the same reason the sub-agent plate carries a
     word): the chip's TEXT says "sub-agent", so a reader who cannot separate these hues still gets
     the fact. The tint only makes it findable when scanning 800 rows. */
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.chip .dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--faint);
}

.chip.ours .dot {
  background: var(--accent);
}

.chip.imported .dot {
  background: var(--ready);
}

/* Not imported yet — the only chip that borrows the accent, because it is the one with a button. */
.chip.home {
  border-color: var(--accent-border);
  color: var(--accent-text-soft);
}

.chip.home .dot {
  background: var(--accent);
}

/* Quiet emphasis, not a warning: this is the sweep's value, not a problem (104). */
.chip.only {
  border-color: var(--line-strong);
  background: var(--wash-3);
  color: var(--text-soft);
}

.chip.only .dot {
  background: var(--accent-2);
}

.r-line2 {
  display: flex;
  min-width: 0;
  align-items: baseline;
  flex-wrap: wrap;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.r-cwd {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Never ellipsised: a phrase wider than its line wraps onto lines of its own instead. */
.r-aside {
  min-width: 0;
  flex: 0 1 auto;
}

/* One line, clamped (104): the preview is a caption, and a first message somebody pasted a document
   into must not be allowed to become the row. */
.r-preview {
  margin: var(--space-1) 0 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- states on a row */

/**
 * ⚠️ **`--warning` was never defined** (104, verified again here). This block and `.outcome` below
 * wrote `var(--warning, var(--text-soft))`, and `--warning` is in no stylesheet in this repo — so
 * both fell through to the fallback and every caution on this surface has shipped in ordinary body
 * colour since 065. The fix is 104's: the real `--waiting` ramp, which exists, is the app's amber
 * everywhere else, and has a light value. **This changes how the surface looks** — the "behind"
 * line and the two warning outcomes go from grey to amber. Said out loud rather than slipped in.
 */
.behind {
  display: flex;
  align-items: center;
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xs);
  background: var(--waiting-bg);
  gap: var(--space-5);
}

.behind .txt {
  min-width: 0;
  flex: 1;
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* A rebuild in flight is not a warning — it is the answer to one, already happening. */
.behind[data-derived='rebuilding'] {
  background: var(--wash-2);
}

.behind[data-derived='rebuilding'] .txt {
  color: var(--text-soft);
}

.behind .rebuild {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--waiting-text-label);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.behind .rebuild:hover {
  background: var(--waiting-bg);
}

.behind .rebuild:disabled {
  cursor: default;
  opacity: 0.6;
}

.spin {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  border: 1.6px solid var(--line-strong); /* raw: glyph stroke, drawn at its own width */
  border-top-color: var(--muted);
  border-radius: var(--radius-pill);
  animation: library-spin 0.8s linear infinite;
}

@keyframes library-spin {
  to {
    transform: rotate(360deg);
  }
}

.outcome {
  margin: var(--space-3) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/**
 * A refusal reads differently from a success, without either being an error colour.
 *
 * ⚠️ **Every import ending that means "it did not happen" is here** (105 review). `rebuildEntry`
 * maps its outcomes into three tones deliberately, but `importEntry` stores
 * `ImportedFromHome.outcome` verbatim — so an ending missing here falls through to the neutral
 * colour that `up-to-date` uses, and "you already have this" and "nothing was taken" are opposite
 * answers.
 */
.outcome[data-outcome='unreadable'],
.outcome[data-outcome='missing'],
.outcome[data-outcome='nothing-readable'],
.outcome[data-outcome='still-writing'],
.outcome[data-outcome='stopped'] {
  color: var(--waiting-text-label);
}

.outcome[data-outcome='imported'] {
  color: var(--success-text);
}

.why {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

/* ---------------------------------------------------------------- the one control */

.row-act {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  align-self: center;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* The row action stays readable before hover or focus. */
.read-cue {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
  white-space: nowrap;
  gap: var(--space-2);
}

.read-cue:hover,
.read-cue:focus-visible {
  color: var(--text-soft);
  opacity: 1;
}

.import {
  height: 26px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-sm);
  background: var(--accent-fill);
  color: var(--accent-text);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.import:hover {
  background: var(--accent-fill-strong);
}

.bring-back {
  height: 26px;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.bring-back:hover {
  background: var(--wash-3);
}

.bring-back:disabled {
  cursor: default;
  opacity: 0.6;
}

/* Marked, and quiet: an archived conversation is put away, not in trouble. */
.chip.archived {
  background: var(--wash-3);
  color: var(--text-soft);
}

.import:disabled {
  cursor: default;
  opacity: 0.6;
}

/* ---------------------------------------------------------------- foot */

.skipped {
  margin-top: var(--space-9);
  color: var(--faint);
  font-size: var(--type-caption);
}

.skipped summary {
  color: var(--muted);
  cursor: pointer;
}

.skipped[open] summary {
  margin-bottom: var(--space-3);
}

.skipped ul {
  display: flex;
  margin: 0;
  padding-left: var(--space-6);
  flex-direction: column;
  gap: var(--space-2);
}

.skipped .more {
  margin: var(--space-3) 0 0;
}

/* ⚑ **The reopen list's own band** (151). A rule and a heading, and nothing else: the list inside
   brings its own layout — unchanged from the day it was written for a surface with room — and the
   only thing this page owes it is a place and a name. */
.reopen {
  margin-top: var(--space-9);
  padding-top: var(--space-6);
  border-top: var(--border-width) solid var(--line);
}

.reopen h2 {
  margin: 0 0 var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-section);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
}

/* ⚠️ It sits under the heading and above the list, in the muted voice the rest of the page uses
   for what a surface CANNOT do — loud enough to be read before the rows, quiet enough not to
   compete with the miss above it. */
.reopen-scope {
  margin: calc(var(--space-4) * -1) 0 var(--space-5);
  color: var(--muted);
  font-size: var(--type-caption);
}

.lib-headingbar {
  padding: var(--space-12) var(--space-12) var(--space-8);
}
.library-columns {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  gap: var(--space-10);
  padding: 0 var(--space-12) var(--space-12);
}
.library-results {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.lib-top {
  padding: 0 0 var(--space-6);
}
.lib-scroll {
  padding: var(--space-6) 0;
}
.library-aside {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
  overflow-y: auto;
}
.restore {
  margin: 0;
  padding: var(--card-padding);
  gap: var(--space-5);
}
.restore-row {
  flex-wrap: wrap;
}
.restore-row input {
  flex: 1 0 100%;
}
.source-guide .reads {
  margin: 0;
}
.source-guide {
  overflow-wrap: anywhere;
}
.row {
  padding: var(--space-7);
  background: var(--panel);
  border-radius: var(--radius-card);
}
.r-title {
  font-weight: var(--fw-medium);
}
.chip {
  min-height: var(--space-8);
  height: auto;
  white-space: normal;
}
.behind {
  flex-wrap: wrap;
}
/* Where the row has no room beside its words, its actions go on a line of their own under them. */
@container (max-width: 480px) {
  .row {
    flex-wrap: wrap;
  }
  .row-act {
    flex: 1 0 100%;
  }
}
@container (max-width: 760px) {
  .library-columns {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }
  .library-results {
    min-height: 320px;
  }
  .library-aside {
    overflow: visible;
  }
}
</style>
