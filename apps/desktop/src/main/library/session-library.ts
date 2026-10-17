import type { Provider } from '@brobot2/shared'
import type { ChildDescent, ProviderDescription } from '../adopt/discover-sessions'
import type { UserHomeDiscovery } from '../adopt/user-homes'
import type { RecordedSession } from '../db/session-store'
// The wire shapes live in the one module main, preload and the renderer all import. Declared there
// and used here rather than the other way round: they cross a process boundary, and a second
// definition beside the code that fills them would be free to drift from the one the renderer reads.
import type {
  LibraryChild,
  LibraryCounts,
  LibraryEntry,
  LibraryFilters,
  LibraryPage,
  LibraryQuery,
} from '../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../shared/runtime-ipc'

export type { LibraryCounts, LibraryEntry, LibraryFilters, LibraryPage, LibraryQuery }

/**
 * The session library (047) — three sources, one list.
 *
 * ## The three, and why they are three
 *
 * | source | where it comes from | what only it knows |
 * |---|---|---|
 * | **ours** | our own database | every session this app ran, with the lifecycle it recorded |
 * | **the user's Claude home** | a filesystem scan, captioned by the SDK's `listSessions()` | conversations we never ran |
 * | **the user's Codex home** | the `threads` table of `state_<n>.sqlite`, read through a copy | the same, plus what Codex calls them |
 *
 * They are not three lists shown together — they are three readings of one question, merged on the
 * **provider's own id**, which is the only identifier that means the same thing on both sides. A
 * conversation the sweep has already archived is therefore ONE row that knows both facts: where it
 * came from, and that we hold it.
 *
 * ## The split 043 named, and what it actually is
 *
 * `listSessions()` takes no home option, so it can only ever report the home `CLAUDE_CONFIG_DIR`
 * resolves to. Our own sessions live in isolated per-profile homes and are invisible to it. That is
 * not a gap: ours are already in our database, recorded as they ran. So the split is by
 * construction — **the provider homes are read for conversations we never ran, and our own come from
 * our own store** — and neither side needs the other's source. `user-homes.ts` holds the measured
 * detail, including why Codex is read from its database rather than through `thread/list`.
 *
 * ## Nothing here is invented
 *
 * Every caption is a field some provider actually populates, checked against the real corpus before
 * it was surfaced. Where a provider has nothing to say, the entry says nothing — an empty title is
 * shown as an empty title, never back-filled from a path, an id, or the first line of a file.
 */

export interface LibraryDeps {
  /** Every session we have recorded, reopenable or not. */
  recorded(): RecordedSession[]
  /** What is in the user's own provider homes right now. */
  userHomeSessions(): UserHomeDiscovery
  /** What Claude's own index says about the sessions in its home, keyed by session id. */
  claudeDescriptions(): Promise<Map<string, ProviderDescription>>
  /** When a person archived one of our conversations, epoch ms, or null when it is not archived. */
  archivedAt(recordId: string): number | null
}

/** A page is bounded so a corpus of two thousand conversations cannot arrive as one IPC message. */
export const DEFAULT_LIBRARY_LIMIT = 200

/**
 * Read the library: merge the three sources, filter, count, and hand back one page.
 *
 * Ordering is **newest first**, which is the opposite of the sweep's and deliberately so. The sweep
 * runs oldest-first because the oldest transcript is the one closest to being deleted, so it is the
 * one worth rescuing next. Nothing here is at risk of anything — this is a person looking for a
 * conversation, and the one they want is overwhelmingly the one they had most recently.
 */
export async function readLibrary(
  deps: LibraryDeps,
  query: LibraryQuery = {},
): Promise<LibraryPage> {
  const recorded = deps.recorded()
  const discovery = deps.userHomeSessions()
  const claude = await deps.claudeDescriptions()

  // Our rows, by the provider id they were recorded under. A row without one cannot be matched to a
  // file — it never got an id to match on — so it is keyed out and listed on its own below.
  const byProviderId = new Map<string, RecordedSession>()
  for (const row of recorded) {
    if (row.providerSessionId !== null)
      byProviderId.set(key(row.provider, row.providerSessionId), row)
  }

  const entries: LibraryEntry[] = []
  const claimed = new Set<string>()
  /**
   * Every id already emitted. `id` is a Vue `:key` and the handle the surface attaches an import
   * outcome to, so two entries sharing one is not a cosmetic duplicate — it is two rows that cannot
   * be told apart by the only thing addressing them. Both loops check it, because either can
   * produce a collision: a home listed twice, or two rows recorded against one provider id.
   */
  const emitted = new Set<string>()

  // Every conversation still in a user home, whether or not we hold it.
  for (const found of discovery.found) {
    const id = key(found.provider, found.sessionId)
    if (emitted.has(id)) continue
    emitted.add(id)
    const row = byProviderId.get(id) ?? null
    if (row) claimed.add(id)
    const described = found.description ?? claude.get(found.sessionId)
    entries.push({
      // The PROVIDER's identity, not ours — see {@link stableId}. Using our row id here made the id
      // change the moment a conversation was imported, which is precisely when it must not.
      id,
      provider: found.provider,
      providerSessionId: found.sessionId,
      recordId: row?.sessionId ?? null,
      cwd: found.cwd,
      title: caption(described?.title),
      preview: caption(described?.preview),
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      bytes: found.bytes,
      origin: 'user-home',
      onDisk: true,
      // A file we have not archived has no conversation HERE yet. That is not "empty" — it is
      // "not imported", and the difference is a button.
      readable: row?.hasTranscript ?? false,
      // ⚠️ **And "imported" is not "up to date"** (065, 061 finding 6). A conversation whose file
      // has grown since we archived it is `readable` and behind, and until this field existed the
      // library had no way to say the second thing — so it said the first and the reader assumed
      // both. Null for a row we have never recorded: there is no projection to describe.
      derived: row?.derived ?? null,
      // ⚠️ **Null when we hold no row, and that is the honest answer** (222). A conversation the
      // provider has and we have never run or imported has no turns of ours, so it has no ending of
      // ours to report — and `?? 'completed'` would be the back-fill 045 built `unknown` to refuse.
      lastEnding: row?.lastEnding ?? null,
      /**
       * ⛔ **`row === null`, NOT `??`** (121, found by the Unresumable facet).
       *
       * `row?.unresumableReason ?? NOT_IMPORTED` reads as "the row's reason, or the not-imported
       * one" and is not: `??` falls through on the row's own **null**, which is the value meaning
       * *"this can be reopened"*. A row that CAN be carried on was therefore told it had not been
       * imported, about a conversation we hold.
       *
       * This fallback is reachable only when a row has a non-null `profile_id` while a user home offers the session. `recordedOf` already gives `foundInUserHome` rows a non-null `whyNotResumable` reason, and the scans read disjoint directories. An older `importBundle` fallback could assign a profile to an exported user-home session; preserving an explicit null prevents that mismatch.
       *
       * So the fix is right and the defect was real; it was rare, not commonplace. It stayed
       * invisible because its only reader was `offersNothing`, which also requires `!readable`.
       */
      unresumableReason: row === null ? NOT_IMPORTED : row.unresumableReason,
      // 111 — the home's answer wins while the home still has one, because it is the live copy;
      // our row is the surviving copy for when it does not. They agree by construction (the row was
      // written from this same reader at adoption), and preferring the live one means a descent
      // Codex has since corrected is corrected here too.
      child: libraryChild(found.child) ?? libraryChild(row?.child ?? undefined),
    })
  }

  // Everything we have recorded that no home offered. Two very different kinds live here, told
  // apart by the row itself: sessions this app ran, and sessions the sweep rescued whose provider
  // file has since been deleted underneath it.
  for (const row of recorded) {
    if (row.providerSessionId !== null && claimed.has(key(row.provider, row.providerSessionId))) {
      continue
    }
    const id = stableId(row)
    // `claimed` only covers rows a home offered. Two rows recorded against the SAME provider id
    // whose file has since been deleted are in neither set, and would both arrive here.
    if (emitted.has(id)) continue
    emitted.add(id)
    entries.push(recordedEntry(row))
  }

  // Marked before the filters, so asking for the archived ones reaches past the page.
  for (const entry of entries) {
    const archivedAt = entry.recordId === null ? null : deps.archivedAt(entry.recordId)
    if (archivedAt !== null) entry.archivedAt = archivedAt
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt)

  const counts = tally(entries)
  // ⚠️ **ANDed, and applied AFTER `tally`** — like the substring filter beside it, and for the same
  // reason its comment gives: the counts are a statement about the whole library, and a count that
  // moved with the query would be a lie. Naming a row we do not hold matches nothing, which is the
  // correct answer rather than an error: the caller learns there is no library row to open.
  //
  // ⛔ **And BEFORE the slice, which is the whole of 121.** The facets narrow the same way the
  // query does — over every entry the merge produced — so `matched` below is `|query ∧ filters|`
  // over the whole library. A renderer filtering the page in hand would be searching the first 200
  // of two thousand; here the only thing the page ever holds is the answer's first 200 rows.
  const matched = entries.filter(
    (entry) =>
      (query.recordId === undefined || entry.recordId === query.recordId) &&
      matches(entry, query.query) &&
      passesFilters(entry, query.filters),
  )
  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(0, query.limit ?? DEFAULT_LIBRARY_LIMIT)

  return {
    entries: matched.slice(offset, offset + limit),
    matched: matched.length,
    counts,
    // Bounded for the same reason the entries are. A home whose files have all become unreadable —
    // a bad permission change after a migration — produces one of these per file, and returning
    // them all would put the whole list on the wire in the response to a request for ten rows.
    skipped: discovery.skipped.slice(0, MAX_SKIPPED_REPORTED),
    skippedTotal: discovery.skipped.length,
  }
}

/**
 * **One library entry built from our own row alone** — no home read, no provider index (119): the
 * second loop's body.
 *
 * ⚠️ **What makes it sound is WHICH rows reach it, and that question lives at the caller.**
 * Everything here is a fact about the row; the fields a home would have added — `title`, `preview`,
 * `bytes`, `onDisk`, and `origin` becoming `user-home` — are absent because no home offered this
 * conversation, which the loop establishes by skipping every row the first one claimed. Called on a
 * row the user's own home still holds, this would be honest about the row and silent about the
 * file, which is not the same thing.
 */
export function recordedEntry(row: RecordedSession): LibraryEntry {
  // ⛔ **Three provenances, in the order that makes each true** (214 §1) — see `origin` below.
  // ⚑ **671 · named once** so the identity beside it is keyed on the SAME answer rather than on a
  // second reading of the row's two flags.
  const origin = row.restoredFromBundle ? 'restored' : row.foundInUserHome ? 'user-home' : 'ours'
  return {
    id: stableId(row),
    provider: row.provider,
    providerSessionId: row.providerSessionId,
    recordId: row.sessionId,
    cwd: row.cwd,
    title: '',
    preview: '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    bytes: null,
    // ⚑ **The row's own answer since 154, not a second reading of it.** This was `fromUserHome(row)`
    // — `adoptedAt !== null && profileId === null`, the exact body of `session-store.ts`'s
    // `foundInUserHome`, restated here where none of its reasoning is. `032`: the store computes it
    // once, on the way out, and every surface that acts on it reads that.
    // ⛔ **Three provenances, in the order that makes each true** (214 §1). `restored` first
    // because a restored bundle is adopted AND owned by one of our profiles — it would otherwise
    // read `ours`, which is the one thing it is not: this app did not run it and its provider
    // never held it here. `154`'s ruling then places it, and the row's own
    // `unresumableReason` says why there is no Resume beside it.
    origin,
    onDisk: false,
    readable: row.hasTranscript,
    derived: row.derived,
    // 222 — how its last turn ended, from the row, like every other fact on this shape.
    lastEnding: row.lastEnding,
    unresumableReason: row.unresumableReason,
    // ⚠️ **THE row this whole column exists for.** No home offered this session, so there is no
    // provider state database left to ask — its file is gone. Before 111 a swept child landed
    // here indistinguishable from a conversation the user started, permanently.
    child: libraryChild(row.child ?? undefined),
    // 🔴 **671 · the identity this app RAN it as, on `ours` alone** (`667` G4a) — see
    // {@link LibraryEntry.profileId}. ⚑ `row.profileId ?? DEFAULT_PROFILE_ID` is what every resume
    // resolves (`homeProfileOf`), so a pre-profile row names the default identity it ran as.
    // ⛔ **Absent — never null — for `user-home` and `restored`**: neither was run here as anybody.
    ...(origin === 'ours' ? { profileId: row.profileId ?? DEFAULT_PROFILE_ID } : {}),
  }
}

/** How many unreadable files are described individually. The total is always reported. */
const MAX_SKIPPED_REPORTED = 50

/**
 * How long a caption may be on the wire.
 *
 * Both sources are unbounded — Claude's `firstPrompt` and Codex's `first_user_message` are whatever
 * the user typed, and people paste documents into a first message. At 500 entries a page, a handful
 * of those is megabytes of IPC to draw two lines of text. Truncated HERE rather than in the view,
 * because the substring search runs main-side over the same value: searching text the row cannot
 * display would find rows that then look like they do not match.
 */
const MAX_CAPTION_CHARS = 300

function caption(value: string | undefined): string {
  const text = value ?? ''
  return text.length <= MAX_CAPTION_CHARS ? text : `${text.slice(0, MAX_CAPTION_CHARS)}…`
}

/**
 * Why an un-imported session cannot be opened. Phrased as the next step rather than as a failure,
 * because it is one: the bytes are right there, nothing is wrong, and the answer is a button.
 */
const NOT_IMPORTED = 'it has not been imported yet — import it to read it here'

/** A row the sweep adopted from the user's own home: adopted, but belonging to no profile of ours. */
/**
 * The descent, in the shape a surface reads: every absent field an explicit `null` (111).
 *
 * ⚠️ **`undefined` and `null` are collapsed on purpose, and only here.** Across the IPC boundary an
 * absent key and a null one are the same fact — *"the provider did not say"* — and letting both
 * shapes reach a renderer means every consumer writes the same two-way check. The distinction that
 * DOES matter, and that this preserves, is the outer one: `null` for the whole object means "not a
 * child", which is a different sentence from "a child we know nothing about".
 *
 * ⚑ **Exported since 118, and used by the reopen list too.** `116` §5 found the two surfaces
 * disagreeing about parentage because only one of them had been given it; sharing the mapping means
 * they cannot now disagree about its SHAPE either.
 */
export function libraryChild(child: ChildDescent | undefined): LibraryChild | null {
  if (!child) return null
  return {
    parentSessionId: child.parentSessionId ?? null,
    depth: child.depth ?? null,
    nickname: child.nickname ?? null,
    role: child.role ?? null,
  }
}

function key(provider: Provider, sessionId: string): string {
  return `${provider}:${sessionId}`
}

/**
 * A key for one conversation that does NOT change when what we hold of it changes.
 *
 * The provider's identity, wherever there is one, because that is the fact that survives being
 * imported. Our row id does not: a conversation with no row has none, and acquires one the instant
 * it is imported — which is the one moment the id must stay put. Keying on it meant the row was
 * re-mounted on import and anything the UI had attached to the old key was orphaned, so the outcome
 * of pressing Import was displayed when the import FAILED and discarded when it succeeded.
 *
 * A row that never got a provider id falls back to ours, which is stable for it by definition:
 * nothing can later give it one without it becoming a different conversation.
 */
function stableId(row: RecordedSession): string {
  return row.providerSessionId === null ? row.sessionId : key(row.provider, row.providerSessionId)
}

/**
 * Whether an entry matches what was typed, over the fields we genuinely have.
 *
 * The searchable set is short on purpose. `cwd` is the one everybody has — measured on the real
 * corpus, 1,787 Codex threads across 57 working directories — and title and preview are populated on
 * every row of it. Nothing here searches a field that is empty or constant in practice, and nothing
 * searches transcript CONTENT: the archive holds gigabytes of frames and a substring scan over it
 * would be a different feature with a different cost, not a bigger version of this one.
 */
function matches(entry: LibraryEntry, query: string | undefined): boolean {
  const needle = (query ?? '').trim().toLowerCase()
  if (needle === '') return true
  return (
    entry.title.toLowerCase().includes(needle) ||
    entry.preview.toLowerCase().includes(needle) ||
    entry.cwd.toLowerCase().includes(needle) ||
    entry.provider.includes(needle)
  )
}

/**
 * **The state a transcript is in when it is not the whole conversation** (065).
 *
 * `current` and `null` are the two ways of saying nothing is missing — one projected and whole, one
 * never projected at all — so "behind" is every other value. Written as the complement rather than
 * as a list of the three it is today, so that a FIFTH `DerivedState` added tomorrow is caught by
 * this filter rather than silently excluded from it.
 */
function isBehind(derived: LibraryEntry['derived']): boolean {
  return derived !== null && derived !== 'current'
}

/**
 * **Whether one row survives the structured narrowing** (121) — the nine predicates, ANDed.
 *
 * Exported because it is the rule, not a detail of the loop above: `120` ruled that the five state
 * toggles stay five separate predicates (`061` finding 6), and a rule asserted only through a page
 * of merged entries is asserted through everything that could hide it. Here each clause can be put
 * under a test on its own, and two of them can be shown selecting different rows — which is what
 * "they are five" MEANS and what a merged implementation could not pass.
 *
 * ⚠️ **Every clause is a narrowing, never a widening.** An absent field imposes nothing; a present
 * one can only remove rows. So the order of the clauses cannot matter, an empty `filters` object is
 * exactly `undefined`, and a filter combination nobody's library satisfies returns an empty page
 * rather than a fallback to something broader — which is the state `120` designed an empty screen
 * for instead of quietly relaxing.
 *
 * ⚠️ **Five separate predicates does NOT mean five independent populations, and the difference
 * matters** (review). Over the first loop's rows some of them nest by construction: `recordId` and
 * `readable` are driven by the same `row`, so `recordId === null` forces `readable === false` and
 * every **not-imported** row is also **unreadable**; and a row no home has given us gets
 * {@link NOT_IMPORTED}, so it is also **unresumable**. That is the data being what it is, not two
 * fields being merged — each still answers its own question off its own field, each still selects a
 * different set, and no value decides another. `061` finding 6 is about one value asked to carry
 * two meanings, which is a different thing from two meanings that happen to overlap.
 */
export function passesFilters(entry: LibraryEntry, filters: LibraryFilters | undefined): boolean {
  if (filters === undefined) return true
  if (filters.provider !== undefined && entry.provider !== filters.provider) return false
  if (filters.origin !== undefined && entry.origin !== filters.origin) return false
  // The marquee (111, 115, 118, 119): `child != null` is being a child, and nothing else is.
  if (filters.kind === 'sub' && entry.child === null) return false
  if (filters.kind === 'top' && entry.child !== null) return false
  // ⛔ The five, and they are five. `readable`, `onDisk` and `derived` are three independent facts
  // and a row can be any combination of them — see {@link LibraryFilters}.
  if (filters.notImported === true && entry.recordId !== null) return false
  if (filters.unresumable === true && entry.unresumableReason === null) return false
  if (filters.behind === true && !isBehind(entry.derived)) return false
  if (filters.offDisk === true && entry.onDisk) return false
  if (filters.unreadable === true && entry.readable) return false
  if (filters.archived === 'only' && entry.archivedAt === undefined) return false
  if (filters.archived === 'left-out' && entry.archivedAt !== undefined) return false
  return true
}

function tally(entries: LibraryEntry[]): LibraryCounts {
  const counts: LibraryCounts = {
    total: entries.length,
    ours: 0,
    userHome: 0,
    restored: 0,
    imported: 0,
    notImported: 0,
    onlyHere: 0,
    providers: [],
  }
  // Which providers the library actually holds, and how many each — the Provider facet's options,
  // supplied by the backend because the renderer is not allowed to know their names (039).
  const byProvider = new Map<Provider, number>()
  for (const entry of entries) {
    byProvider.set(entry.provider, (byProvider.get(entry.provider) ?? 0) + 1)
    if (entry.origin === 'ours') {
      counts.ours += 1
      continue
    }
    // ⛔ **A restored bundle is neither of the other two, and counting it as `user-home` printed the
    // one word its own chip argues is false about it** (214 §1). `imported` means *"the provider
    // still has the file and we archived it"*; a restored bundle's provider has no copy of it
    // anywhere on this machine, and `onlyHere` — *"rescued history"* — is a claim about a file the
    // provider deleted, which is not what happened either.
    if (entry.origin === 'restored') {
      counts.restored += 1
      continue
    }
    counts.userHome += 1
    if (entry.recordId === null) counts.notImported += 1
    else counts.imported += 1
    if (entry.recordId !== null && !entry.onDisk) counts.onlyHere += 1
  }
  // Busiest first, and ties broken by name so the menu does not reorder itself between two reads
  // that found the same library. A provider with nothing here is not listed: an option that can
  // only ever produce an empty list is a control that does nothing (106).
  counts.providers = [...byProvider.entries()]
    .map(([provider, total]) => ({ provider, total }))
    .sort((a, b) => b.total - a.total || a.provider.localeCompare(b.provider))
  return counts
}
