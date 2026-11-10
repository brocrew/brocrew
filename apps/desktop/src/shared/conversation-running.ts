/**
 * 🔴 **What this app is DOING with a recorded conversation, right now** (421).
 *
 * ⛔ **The field the rail did not have, and its absence was four lies in a row** (HO-023 §2.3). The
 * two list commands read the DATABASE; a conversation the app is running has a row there like any
 * other, so the rail drew a live agent-spawned conversation under *"Closed conversations"*, called
 * it **ended**, offered **Reopen**, and had that reopen refused by naming a window that does not
 * exist. Every one of those four came from the same gap: **nothing on the wire said whether this
 * app is running the row**.
 *
 * ⚠️ **Not derivable from {@link ResumableSessionInfo.status}, which is what `418` assumed and this
 * dispatch measured.** `status` is a COLUMN, and `settleOrphanRuns` settles a crashed run's row to
 * **`idle`** — a non-terminal status — while a conversation that was merely open and not mid-turn
 * when the app died keeps the `idle` it already had. So `idle` is what a live conversation and a
 * conversation killed by a power cut three weeks ago both say, and a rail keyed on it would offer
 * *"take it over"* on every row a crash left behind. ⛔ **The host's slot map is the only thing that
 * knows**, and this is that answer travelling to the surface that has to act on it (`032`'s rule).
 *
 * ⚑ **Three states, because the two the app IS running are different things to be told.** A
 * conversation nobody is watching can be taken over by the person reading the row; one a window
 * holds cannot, and its sentence is the one place *"already open in another window"* is true.
 */
export const RUNNING_STATES = [
  /**
   * This host holds no live session for this row. ⚑ **D-017b** — a person's press opens it in the
   * full view, drawn from its ledger, and the message they send continues it.
   */
  'not-running',
  /**
   * 🔴 **Running, and `ownerId` is `null`** — 336's session nobody owns, which is what every
   * conversation an agent's give started is from the moment it is reserved (`give_work` passes no
   * sink).
   *
   * ⛔ **The gesture is `claim`, never `reopen`.** A reopen is refused because the id is live; a
   * claim is the door `336` built for exactly this and it is one press away from the same window.
   */
  'unwatched',
  /**
   * Running, and a surface owns it. ⚠️ Whether that surface is THIS window is a question the host
   * cannot answer about a list command — the rail answers it from `store.live`, the one question a
   * per-window filter genuinely can answer.
   */
  'in-a-window',
] as const

/**
 * Derived from the list rather than declared beside it, so a state cannot be added to the type
 * without appearing in the list a test walks — `session-unavailable.ts`'s rule, one file over.
 */
export type RunningState = (typeof RUNNING_STATES)[number]
