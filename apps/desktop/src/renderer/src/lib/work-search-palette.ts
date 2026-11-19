import type { WorkSearchHit, WorkSearchPage } from '../../../shared/work-search'
import { WORK_SEARCH_REFUSAL_WORDS, WORK_SEARCH_WORDS } from '../../../shared/work-search-words'

export const WORK_SEARCH_PALETTE_WORDS = {
  ...WORK_SEARCH_WORDS,
  input: 'Search title, done condition or result',
  empty: 'No matches in the work searched.',
}

export const WORK_SEARCH_PALETTE_REFUSAL_WORDS = {
  ...WORK_SEARCH_REFUSAL_WORDS,
  invalid: 'Use a listed scope and state, at most 20 words, and a limit from 1 to 50.',
}

export type WorkSearchPalettePage = Omit<WorkSearchPage, 'hits'> & {
  readonly hits: readonly WorkSearchHit[]
}

export function workSearchPalettePage(
  page: WorkSearchPage,
  previous: WorkSearchPalettePage | null = null,
): WorkSearchPalettePage {
  const matched = page.hits.flatMap((row) => row.matched_tasks)
  const hits = [
    ...new Map([...(previous?.hits ?? []), ...matched].map((hit) => [hit.piece, hit])).values(),
  ]
  hits.sort(
    (left, right) => right.given_at - left.given_at || right.piece.localeCompare(left.piece),
  )
  const rows_unread = (previous?.rows_unread ?? 0) + page.rows_unread
  const ledgers_skipped = (previous?.ledgers_skipped ?? 0) + page.ledgers_skipped
  return {
    ...page,
    hits,
    searched: (previous?.searched ?? 0) + page.searched,
    rows_unread,
    ledgers_skipped,
    complete: page.complete && rows_unread === 0 && ledgers_skipped === 0,
  }
}
