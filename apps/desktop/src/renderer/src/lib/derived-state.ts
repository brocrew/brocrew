import type { DerivedState } from '../../../shared/runtime-ipc'

/**
 * **What a transcript's completeness means to the person reading it** (065, from 061 finding 6).
 *
 * One wording, used by both surfaces that can show it — the library row and the reading pane. Two
 * copies would be two answers to the same question, and the one that drifted would be whichever got
 * edited second.
 *
 * `null` for `current` and for a ledger that was recorded rather than projected: **saying nothing is
 * the right answer for a row with nothing wrong**. A library of two hundred conversations each
 * captioned "up to date" is noise, and the one row that is genuinely behind would be hidden in it.
 *
 * ⚠️ None of these is an error, and none of them is worded as one. `stale` means an older version
 * of the app read it, and reading it again is a button. `failed` says
 * plainly that what is on screen is the previous transcript, whole, because the thing a reader would
 * otherwise assume is that the failure damaged something.
 */
export function describeDerived(state: DerivedState | null): string | null {
  switch (state) {
    case 'stale':
      return 'Read by an older version of BroCrew. Rebuild to read it again.'
    case 'rebuilding':
      return 'Rebuilding its transcript — what is shown is the previous one, whole, until it lands.'
    case 'failed':
      return 'The last rebuild did not finish. What is shown is the previous transcript, whole.'
    default:
      return null
  }
}
