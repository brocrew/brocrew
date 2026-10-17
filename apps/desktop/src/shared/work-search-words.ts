import { refusalReason } from './refusals'
import { WORK_STATE_WORD } from './work-state-words'
import { WORK_FILE_GROUP_WORDS } from './work-file-groups'
import type { WorkSearchPage, WorkSearchResult } from './work-search'

export const WORK_SEARCH_WORDS = {
  action: 'Search work',
  input: 'Search title, done condition or result',
  mine: 'My profile',
  conversation: 'This conversation',
  all: 'All work',
  states: 'All states',
  search: 'Search',
  more: 'Load more',
  empty: 'No matches in the work searched.',
  unread: 'Some work could not be read.',
  older: 'Older work has not been searched yet.',
  changing: 'Results may change when work is edited.',
  description:
    "Find work by title, done condition or result summary. mine covers your profile's conversations; this-conversation covers work you own or gave here; all covers this app's work. This reads only. list_tasks reads the brief and files of work you or your profile hold or gave. For other work, ask its owner.",
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
  invalid: 'Use a listed scope and state, at most 20 words, and a limit from 1 to 50.',
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
    const state =
      hit.state === null
        ? `conversation: ${hit.conversation_state ?? 'unknown'}`
        : WORK_STATE_WORD[hit.state]
    const who = hit.owner.name ?? hit.owner.profile ?? 'an agent this app cannot name'
    const words = [
      `${hit.label}${hit.title === null ? '' : ` · ${hit.title}${hit.clipped.title ? ' (clipped)' : ''}`} · ${state} · ${who}`,
    ]
    if (hit.definition_of_done !== undefined)
      words.push(`Done when: ${hit.definition_of_done ?? 'Not recorded'}`)
    if (hit.status !== null)
      words.push(`Status: ${hit.status}${hit.clipped.status ? ' (clipped)' : ''}`)
    if (hit.result !== null)
      words.push(
        `Result: ${hit.result.outcome}${hit.result.summary === null ? '' : ` · ${hit.result.summary}`}${hit.clipped.result ? ' (clipped)' : ''}`,
      )
    for (const [group, ids] of Object.entries(hit.resource_ids))
      if (ids.length > 0)
        words.push(
          `${WORK_FILE_GROUP_WORDS[group as keyof typeof WORK_FILE_GROUP_WORDS]}: ${ids.join(', ')}`,
        )
    if (hit.resources_omitted > 0)
      words.push(`${hit.resources_omitted} more file references omitted.`)
    return words.join('\n')
  })
  if (lines.length === 0) lines.push(WORK_SEARCH_WORDS.empty)
  lines.push(
    `Searched: ${page.searched}; rows_unread: ${page.rows_unread}; ledgers_skipped: ${page.ledgers_skipped}; complete: ${page.complete}.`,
  )
  if (page.rows_unread > 0 || page.ledgers_skipped > 0) lines.push(WORK_SEARCH_WORDS.unread)
  if (page.next_cursor !== null)
    lines.push(`${WORK_SEARCH_WORDS.older} next_cursor: ${page.next_cursor}`)
  lines.push(WORK_SEARCH_WORDS.changing)
  return lines.join('\n\n')
}
