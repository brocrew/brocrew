/**
 * Where a conversation came from. Not where its bytes are now — see {@link LibraryEntry}.
 *
 *  - `ours` — this app ran it.
 *  - `user-home` — it was found in the user's own provider home; this app only ever read it.
 *  - `restored` — ⛔ **it arrived as a bundle** (214 §1): another machine ran it and we hold the
 *    document. Not `ours` (we did not run it) and not `user-home` (it was never in one) — and the
 *    difference is not cosmetic, because it is the only origin whose provider has no copy of the
 *    conversation ANYWHERE on this machine. That is what `194` M2 found being advertised as
 *    resumable, and what `whyNotResumable` now says out loud.
 *
 * ⚠️ **The VALUES are exported, and the type is derived from them** (121, review). `ipc.ts`
 * validates this union at the wire, and an inline `z.enum(['ours', 'user-home'])` there would still
 * typecheck against a widened union while rejecting the new member at the boundary — the exact
 * divergence `ipc.ts` refuses for `provider`, and the reason it uses the shared schema. Adding a
 * member here now changes the wire too, with no second edit to remember. ⚑ **`restored` is the
 * first member added since that was written, and it cost exactly the one edit promised.**
 */
export const LIBRARY_ORIGINS = ['ours', 'user-home', 'restored'] as const

export type LibraryOrigin = (typeof LIBRARY_ORIGINS)[number]

/**
 * Which half of the library a row is, by descent (121). `child != null` is the whole test.
 *
 *  - `top` — nobody spawned it; a conversation a person started.
 *  - `sub` — another conversation spawned it.
 *
 * Values first, type derived — for the reason {@link LIBRARY_ORIGINS} gives.
 */
export const LIBRARY_KINDS = ['top', 'sub'] as const

export type LibraryKind = (typeof LIBRARY_KINDS)[number]

/**
 * Which conversations a person archived the library lists: `only` those, or with them `left-out`.
 * Absent lists both. Values first, type derived, as {@link LIBRARY_KINDS}.
 */
export const LIBRARY_ARCHIVED = ['only', 'left-out'] as const

export type LibraryArchived = (typeof LIBRARY_ARCHIVED)[number]
