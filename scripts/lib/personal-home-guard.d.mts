/**
 * Type declarations for the personal-home ownership scan. The implementation remains plain
 * `.mjs` so Node instruments can import it without a build; these declarations give
 * TypeScript callers the same contract without suppressing import errors.
 */

/** A thing this run owns, and the name it reports itself by. 🔒 The VALUE is never printed. */
export interface Marker {
  readonly label: string
  readonly value: string
}

/** A place a marker was found. Carries the label, never the value. */
export interface Hit {
  readonly path: string
  readonly label: string
}

/**
 * What one walk of a personal home actually saw — and, as importantly, what it did not.
 *
 * ⛔ **`hits` alone is not an answer** (196 M2). A walk that hit its limit, stopped at the depth
 * bound, or met a directory it could not open has left part of the home unexamined, and an empty
 * `hits` from such a walk means "we found nothing where we looked", not "there is nothing".
 * {@link Scan.complete} is the question to ask first; {@link whyIncomplete} is the sentence.
 */
export interface Scan {
  readonly hits: Hit[]
  /** The hit limit was reached, so later matches were never examined. */
  readonly truncated: boolean
  /** Directories the depth bound stopped the walk descending into. */
  readonly tooDeep: string[]
  /** Directories that exist and would not open. */
  readonly unreadable: string[]
  /** Nothing was truncated, skipped or unreadable — the only state in which an empty `hits` is a clean bill. */
  readonly complete: boolean
}

/** Shortest marker worth scanning for. */
export declare const MIN_MARKER_LENGTH: number

/** How deep a personal home is walked. */
export declare const DEFAULT_MAX_DEPTH: number

/** Throws if the marker list is empty, unlabelled, or too short to be distinctive. */
export declare function requireMarkers(markers: readonly Marker[]): readonly Marker[]

/**
 * Every path under `root` whose name contains one of `markers`. Symlinks are not followed.
 *
 * ⛔ **It returns a {@link Scan}, and this line used to say `Hit[]`** (202, from 200 §8 and 201 §8).
 * The declaration was wrong from the day 196 gave the walk its completeness fields, and a `.d.mts`
 * beside a `.mjs` is the one seam nothing typechecks against the implementation — so the compiler
 * agreed with every caller and none of them agreed with the runtime. It cost five smokes a `TypeError`
 * on the line that proves nothing leaked (`hits.map`, and a spread of a non-iterable), and the other
 * four a silent vacuous pass (`.length` on an object is `undefined`, never `0`). Among the five was
 * `credential-ownership.smoke.ts` — the instrument for the very finding 202 exists to fix.
 */
export declare function pathsNaming(
  root: string,
  markers: readonly Marker[],
  options?: { maxDepth?: number; limit?: number },
): Scan

/** Why a scan is not complete, in one sentence naming the first few paths — or `null` when it is. */
export declare function whyIncomplete(scan: Scan): string | null

/** Which of `files` contain one of `markers`, with what was read and what was skipped. */
export declare function filesContaining(
  files: readonly string[],
  markers: readonly Marker[],
  options?: { maxBytes?: number },
): { hits: Hit[]; read: string[]; skipped: string[] }

/** A one-line rendering of what a scan found — labels only. */
export declare function describeHits(hits: readonly Hit[]): string

/**
 * `'none'` only when every walk FINISHED and found nothing — the one idiom a leak assertion should
 * use, because it cannot be spelled in a way that ignores an incomplete walk.
 */
export declare function describeScan(...scans: readonly Scan[]): string

/**
 * `'none'` only when every marker was FOUND — the idiom for the opposite claim, *everything of ours
 * is where it should be* (206 H3). A missing marker from an incomplete walk says so; a marker that
 * was found needs no completeness, because a hit is proof.
 */
export declare function describeMissing(scan: Scan, markers: readonly Marker[]): string
