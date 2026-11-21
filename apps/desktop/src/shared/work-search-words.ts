import { refusalReason } from './refusals'
import type { WorkSearchPage, WorkSearchResult } from './work-search'

export const WORK_SEARCH_WORDS = {
  action: 'Search work',
  input: 'Search titles, briefs, done conditions and status lines',
  mine: 'My profile',
  conversation: 'This conversation',
  all: 'All work',
  states: 'All states',
  search: 'Search',
  more: 'Load more',
  empty: 'No conversations match.',
  unread: 'Some work could not be read.',
  older: 'Older work has not been searched yet.',
  changing: 'Results may change when work is edited.',
  transcripts: 'To search what was said in conversations, use search_past_work.',
  description:
    "Find conversations by label, title, profile, keywords and date. It searches conversation titles, task titles, briefs, definitions of done and status lines, ended work included. Each row is one conversation: conversation <address> · <title>, its profile, when it was last active, its latest status line, and the tasks that matched. It only reads. To see one conversation's tasks, use list_tasks with conversation; to read its turns, read_transcript. Read before you ask: asking wakes a conversation and reloads its context.",
} as const

export const WORK_SEARCH_RAILS = [
  'work-search-invalid',
  'work-search-cursor-invalid',
  'work-search-unavailable',
  'work-search-busy',
] as const
const RAIL_OF_REASON = {
  invalid: WORK_SEARCH_RAILS[0],
  'cursor-invalid': WORK_SEARCH_RAILS[1],
  unavailable: WORK_SEARCH_RAILS[2],
  busy: WORK_SEARCH_RAILS[3],
} as const

export const WORK_SEARCH_REFUSAL_WORDS = {
  invalid: 'Use at most 20 words, a known profile, valid dates and a limit from 1 to 50.',
  'cursor-invalid': 'That search cursor does not match this query. Start the search again.',
  unavailable: 'Work search failed to read the work. Try again.',
  busy: 'Work search is busy with other searches. Try again in a moment.',
} as const

export function workSearchRefusal(reason: Extract<WorkSearchResult, { ok: false }>['reason']) {
  const permanence =
    reason === 'unavailable' || reason === 'busy'
      ? ('while-this-holds' as const)
      : ('permanent' as const)
  return {
    outcome: 'refused' as const,
    rail: RAIL_OF_REASON[reason],
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(WORK_SEARCH_REFUSAL_WORDS[reason]),
    remedy: null,
    detail: {},
  }
}

export function workSearchInWords(page: WorkSearchPage): string {
  const lines = page.hits.map((hit) => {
    const when = new Date(hit.last_active_at).toISOString()
    const words = [`${hit.line} · ${hit.profile ?? 'profile not recorded'} · last active ${when}`]
    if (hit.status !== null) words.push('Status: ' + hit.status)
    for (const match of hit.matched_tasks)
      words.push('Task ' + match.label + (match.title === null ? '' : ' · ' + match.title))
    if (hit.tasks_omitted > 0)
      words.push(
        String(hit.tasks_omitted) +
          ' more matched tasks. list_tasks lists the conversation’s tasks.',
      )
    return words.join('\n')
  })
  if (lines.length === 0) lines.push(WORK_SEARCH_WORDS.empty)
  if (page.hits.length <= 1) lines.push(WORK_SEARCH_WORDS.transcripts)
  lines.push(
    `Searched: ${page.searched}; rows_unread: ${page.rows_unread}; ledgers_skipped: ${page.ledgers_skipped}; complete: ${page.complete}.`,
  )
  if (page.rows_unread > 0 || page.ledgers_skipped > 0) lines.push(WORK_SEARCH_WORDS.unread)
  const tooLarge = page.candidates_too_large ?? 0
  if (tooLarge > 0)
    lines.push(
      tooLarge === 1
        ? '1 conversation was too large to search.'
        : `${tooLarge} conversations were too large to search.`,
    )
  const titleDetailsUnread = page.title_details_unread ?? 0
  if (titleDetailsUnread > 0 && page.title_details_pending !== true)
    lines.push(
      titleDetailsUnread === 1
        ? 'One title match has unread details. Use list_tasks.'
        : `${titleDetailsUnread} title matches have unread details. Use list_tasks.`,
    )
  if (page.next_cursor !== null)
    lines.push(
      `${page.title_details_pending === true ? 'Continue for title details.' : WORK_SEARCH_WORDS.older} next_cursor: ${page.next_cursor}`,
    )
  lines.push(WORK_SEARCH_WORDS.changing)
  return lines.join('\n\n')
}
