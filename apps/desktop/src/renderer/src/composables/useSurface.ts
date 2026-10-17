import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { SessionRecord } from '../lib/session-record'
import type { SessionStore } from '../lib/session-store'

/**
 * Which surface is on screen, and who is allowed to change it (095).
 *
 * ⚠️ **This is a module because the answer used to be spread across five lines of `RuntimeScreen`
 * that could not see each other**, and the launcher fell through the gap between them. `place: null`
 * meant *"the conversation I was reading"* — and, where there was no such conversation, *"the
 * launcher"*. Two meanings in one value, agreeing right up until the user asks for the launcher on
 * purpose: 085's `ended` latch, in the routing.
 *
 * What that cost, measured (094 §4): *"a user who reopens a conversation and then starts a new one
 * gets thrown back into the old one mid-sentence. What was typed is not lost — it stays in the
 * `new` draft slot — but the surface is taken away with no indication."*
 *
 * Two rules live here, and neither one is expressible where they used to live:
 *
 *  1. **An election that finds nothing to elect NAMES the launcher** instead of falling into it, so
 *     every later election meets a place that was asked for.
 *  2. **An asynchronous result may only take the surface if the reader has not moved since they
 *     asked for it** — the rule `readOlder` already followed for its own await, applied to the one
 *     that takes as long as a provider takes to start.
 */
export interface Surface {
  /**
   * A place a word names — `new`, `sessions`, `reading`, … (see {@link RESERVED_PLACES}) — or null
   * for the conversation you picked. ⚠️ A word no place answers to draws the launcher.
   */
  readonly place: Ref<string | null>
  /** The conversation the surface is about, whether or not it is the thing being drawn. */
  readonly activeId: Ref<string | null>
  readonly active: ComputedRef<SessionRecord | null>
  /**
   * **What is on screen** — one name, decided here rather than by the order of the template's
   * `v-else-if`s (095).
   *
   * ⚠️ **The precedence WAS the template, and that is why nothing could ask whether the launcher
   * was showing.** "Is this the launcher" was a question about six branch conditions in a file that
   * has no way to answer questions, so the code that needed the answer guessed at one of them and
   * guessed the wrong one. A name costs nothing and can be asserted.
   */
  readonly surface: ComputedRef<SurfaceName>
  /**
   * What the reader is looking at right now, to be handed back to {@link Surface.showConversation}
   * on the far side of an await. Call it BEFORE the wait, never after.
   */
  view(): View
  /**
   * Put a conversation on screen — unless the reader has moved since they asked for it.
   *
   * A caller with nothing to wait for passes `view()` inline and always wins; a caller on the far
   * side of an await passes what it read before it, and loses if anything about the view changed.
   * Losing means changing NOTHING: the conversation is in the rail either way, so the reader can
   * still reach it — what they cannot have is it arriving on top of something else.
   *
   * ⚠️ **Both fields are compared, and `activeId` is the half the first version of this got wrong**
   * (found in review). Guarding only `place` left the one case where the reader never leaves the
   * conversation surface: read sess_a, click sess_b in the rail, and a resume started before either
   * lands with `place` still null — matching — and quietly replaces sess_b with the conversation
   * they asked for two clicks ago. The surface name was protected and the conversation was not.
   */
  showConversation(sessionId: string, asked: View): void
}

/**
 * What is being looked at: the surface, and the conversation it is about. One value, because the
 * two only mean something together — `place: null` says "the conversation you picked" and is silent
 * about which one.
 */
export interface View {
  readonly place: string | null
  readonly activeId: string | null
}

/** The launcher, as a place rather than as an absence. */
export const LAUNCHER = 'new'

/** The surfaces this app has. `reading` still needs a recording beside it; the rest are complete. */
export type SurfaceName =
  /**
   * ⛔ **What he OWES, and it is bounded by nothing** (606) — `EXT-008` §3's first half, over
   * `home-attention.ts`'s two real populations.
   *
   * ⚠️ **`waiting` and {@link SurfaceName.away} are not two views of one thing**, which is the
   * whole of the ruling that separates them: `HO-025` §2 has it that *a digest is WINDOWED and the
   * queue is COMPLETE regardless of age*, ⛔ **so one destination holding both would have to pick
   * one of those two properties and be wrong about the other.**
   */
  | 'waiting'
  /**
   * ⛔ **What CHANGED, and it is bounded by a window** (606) — `EXT-008` §3's second half: Recent
   * activity, over `recent-activity.ts` and `DEFAULT_ACTIVITY_WINDOW_MS`.
   *
   * ⚠️ **The word is `away` and the row reads *While you were away*.** ⚑ A place name is a URL
   * and a row title is a sentence; `sessions`/`All conversations` is the one that never matched.
   */
  | 'away'
  | 'sessions'
  | 'reading'
  /** Settings contains the Providers, Tools, Themes and General tabs. */
  | 'settings'
  /**
   * ⚑ **The Team roster** (570) — `EXT-008` §5's destination, over `558`'s identity read and the
   * screen `568` built and nothing reached.
   *
   * ⛔ **The word is `team` and not `agents`, and that was DECIDED rather than preferred.** The
   * designer answered `561` §1's open question in v2.10's own changelog §7 — *"I kept Team. It
   * names the durable collection of specialists, including those never run; it does not sound
   * like the list of executing processes the rail just stopped trying to be. The individual noun
   * stays agent."* ⚠️ `EXT-008` §5's list says *Agents*; it was written before that answer.
   */
  | 'team'
  | 'conversation'
  | 'launcher'

/**
 * ⛔ **Every place a word names.** A place not on this list draws the launcher — the fallback
 * {@link Surface.surface} ends in — so a destination that forgot to declare itself is a screen a
 * person cannot reach rather than a screen drawn for the wrong thing.
 *
 * ⛔ **It is the CONSTRAINT on {@link SURFACE_OF_PLACE} and so cannot be derived from it** — the
 * first version of `622`'s repair made it `Object.keys` of that table and the two references went
 * circular. ⚑ **The obligation runs one way**: add a word here, and the table below does not
 * compile until somebody says what it draws — which is the exact bug `606` left.
 */
export const RESERVED_PLACES = [
  'waiting',
  'away',
  'new',
  'sessions',
  'reading',
  'tools',
  'team',
  'providers',
  'settings',
] as const

/** One of the words in {@link RESERVED_PLACES}. */
export type ReservedPlace = (typeof RESERVED_PLACES)[number]

/**
 * 🔴 **622 · what each RESERVED word draws — a table, because the bug was a missing branch.**
 *
 * ## ⛔ The defect this exists to make impossible
 *
 * Map every {@link RESERVED_PLACES} entry to its {@link SurfaceName} explicitly. Missing `waiting` or `away` branches makes valid rail destinations fall through to the new-conversation launcher.
 *
 * ## ⚑ Why a `Record` and not two more `if`s
 *
 * ⛔ **`satisfies Readonly<Record<ReservedPlace, SurfaceName>>` is the instrument**: adding a word
 * without saying what it draws does not compile. ⚠️ **That is the exact shape of the
 * bug** — a place a person can reach, that no surface answers for — and it is the half a test
 * cannot reach, because a test that hands `place` in as a prop has already decided the answer
 * ([[a-loop-over-a-literal-variant-list-is-not-exhaustive]]).
 *
 * ⚑ **`new` maps to `launcher` rather than being left to the fallback**, and that is the one entry
 * that changes nothing today. The chain below already answered `launcher` for it, by exhaustion —
 * which is exactly how `waiting` and `away` were answered too.
 */
export const SURFACE_OF_PLACE = {
  waiting: 'waiting',
  away: 'away',
  new: 'launcher',
  sessions: 'sessions',
  reading: 'reading',
  tools: 'settings',
  team: 'team',
  providers: 'settings',
  settings: 'settings',
} as const satisfies Readonly<Record<ReservedPlace, SurfaceName>>

/**
 * ⛔ **The surfaces NO reserved word names**, and how each is reached instead.
 *
 * ⚑ **Together with {@link SURFACE_OF_PLACE} this is exhaustive over {@link SurfaceName}** — which
 * is what `622`'s commit body said it owed: *"a `Record<SurfaceName, …>` so a surface added later
 * cannot be unreachable."* ⚠️ A new surface is either given a word above or accounted for here;
 * it cannot be added and quietly reached by nothing. ⛔ **`Exclude` rather than a hand-written
 * union**, so the two halves cannot both forget the same member.
 *
 * ⚠️ **`launcher` is NOT in this table, and the compiler is what said so** — the first version
 * listed it and did not build. ⛔ It is named by a word (`new` → `launcher`) **and** it is the
 * fallback, which is the two-doors sentence {@link Surface.surface} already carried: *"`launcher`
 * is now reached two ways and only one of them is a fallback."* ⚑ A member named by a word belongs
 * above; the `Exclude` is what stops it being written in both places and agreeing with neither.
 *
 * ⚑ **The values are prose and are never read** — this table exists to be a compile-time
 * obligation, not a lookup ([[a-closed-vocabulary-guards-what-a-member-says]]).
 */
export const SURFACE_WITHOUT_A_WORD = {
  conversation: '`place: null`, with a selected record whose `meta` has arrived',
} as const satisfies Readonly<
  Record<Exclude<SurfaceName, (typeof SURFACE_OF_PLACE)[ReservedPlace]>, string>
>

/**
 * ⚑ **Every surface this app has, from the two tables that between them account for all of them.**
 *
 * ⛔ **This is what makes {@link SURFACE_WITHOUT_A_WORD} a rule rather than a comment.** A table
 * nothing reads is a table a later hand deletes; reading it here means the `Exclude` above is load
 * bearing at run time as well as at compile time
 * ([[a-line-no-mutation-can-kill-is-not-carrying-its-rule]]).
 */
export const EVERY_SURFACE: readonly SurfaceName[] = [
  ...new Set<SurfaceName>([
    ...(Object.values(SURFACE_OF_PLACE) as readonly SurfaceName[]),
    ...(Object.keys(SURFACE_WITHOUT_A_WORD) as readonly SurfaceName[]),
  ]),
]

export function useSurface(store: Pick<SessionStore, 'live' | 'get'>): Surface {
  const place = ref<string | null>(null)
  const activeId = ref<string | null>(null)
  const active = computed(() => (activeId.value ? store.get(activeId.value) : null))

  /**
   * Follow the newest conversation when there is nothing to look at, and otherwise leave the
   * selection alone. Keyed on the record still EXISTING rather than still being fed: a conversation
   * you are reading that stops is not blanked mid-sentence — ⚑ D-017b: it stays in its full view.
   *
   * ⚠️ **The two added lines are rule 1, and without them this watch was the bug.** It re-elected on
   * every change to `store.live` while nothing was selected — which is exactly the state the
   * launcher used to be drawn in — so any conversation arriving, or leaving, replaced a surface the
   * user had opened on purpose.
   *
   *  - **It only acts where `place` is null**, because that is the only surface whose content this
   *    watch decides. On a destination, in the library, on the launcher, the reader is somewhere
   *    they asked for and there is no gap to fill — so nothing is elected and nothing moves. (It also means
   *    the election cannot invalidate a {@link View} taken by a caller that is mid-await, which is
   *    what makes `showConversation`'s comparison trustworthy.)
   *  - **An election that finds nothing NAMES the launcher** rather than falling into it, so the
   *    next one meets a place that was asked for.
   *
   * The case the watch exists for is untouched: a reader whose conversation stops existing, with
   * `place` still null, is put on the newest one — or on the launcher when there is no newest.
   */
  watch(
    store.live,
    (live) => {
      if (activeId.value && store.get(activeId.value)) return
      if (place.value !== null) return
      activeId.value = live.at(-1)?.sessionId ?? null
      if (activeId.value === null) place.value = LAUNCHER
    },
    { immediate: true },
  )

  /**
   * The precedence, in one place and in the order the template used to hold it. Read top to bottom:
   * a named destination wins, then the conversation you picked — and the launcher is what is left,
   * which is exactly the sentence that has to be true of a fallback.
   *
   * ⛔ **622 · the named destinations are a TABLE now** ({@link SURFACE_OF_PLACE}) rather than eight
   * hand-written branches, because two reserved words were missing from those branches for four
   * dispatches and nothing could say so.
   *
   * ⚠️ **`launcher` is reached two ways and only one of them is asked for**: `place: 'new'`, which
   * the user asked for and rule 1 keeps them in, and the fallback — a record whose `meta` has not
   * arrived, which closes the moment the record does, or a place no word names.
   */
  const surface = computed<SurfaceName>(() => {
    // ⛔ **622 · ONE lookup where there were eight `if`s**, and the eight were the bug: two
    // reserved words had no line and there was nowhere for their absence to show up. See
    // {@link SURFACE_OF_PLACE}.
    const named = place.value === null ? undefined : SURFACE_OF_PLACE[place.value as ReservedPlace]
    if (named !== undefined) return named
    if (place.value === null && active.value?.meta) return 'conversation'
    // ⚑ Reached by a `place` of `null` with no record to draw, and by a place no word names — `new`
    // is answered by the table above, which is the whole point of it being there.
    return 'launcher'
  })

  return {
    place,
    activeId,
    active,
    surface,
    view: () => ({ place: place.value, activeId: activeId.value }),
    showConversation(sessionId, asked) {
      if (place.value !== asked.place || activeId.value !== asked.activeId) return
      activeId.value = sessionId
      place.value = null
    },
  }
}
