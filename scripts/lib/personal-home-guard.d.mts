/**
 * Type declarations for the personal-home ownership scan. The implementation remains plain
 * `.mjs` so Node instruments can import it without a build; these declarations give
 * TypeScript callers the same contract without suppressing import errors.
 */

/** A thing this run owns, and the name it reports itself by. The value is never printed. */
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
 * What one walk of a personal home actually saw, and what it did not.
 *
 * `hits` alone is not an answer: a walk that hit its limit, stopped at the depth bound, or met a
 * directory it could not open left part of the home unexamined, so an empty `hits` means "found
 * nothing where we looked". Ask {@link Scan.complete} first; {@link whyIncomplete} is the sentence.
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
 * Returns a {@link Scan}, not `Hit[]`. A `.d.mts` beside a `.mjs` is a seam nothing typechecks
 * against the implementation, so a wrong declaration here lets callers compile while failing at
 * run time (`hits.map` on an object) or passing vacuously (`.length` of an object is `undefined`).
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
 * `'none'` only when every marker was FOUND — the idiom for the opposite claim, everything of ours
 * is where it should be. A missing marker from an incomplete walk says so; a marker that
 * was found needs no completeness, because a hit is proof.
 */
export declare function describeMissing(scan: Scan, markers: readonly Marker[]): string
