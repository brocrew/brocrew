import type { TranscriptEvent } from '../../shared/conversation-events'
import type { SessionStore } from '../db/session-store'

type PromptLedger = Pick<SessionStore, 'newestOfType' | 'eventsFrom'>
const PROMPT_IDLE_MS = 60 * 60 * 1000

/** A completed provider turn is later than all its requests, including tool continuations. */
function idlePastTheCache(store: PromptLedger, id: string, since: number, now: number): boolean {
  const end = store.newestOfType?.(id, 'turn', undefined, since + 1)
  if (end?.event.type !== 'turn' || end.event.wordOf === 'this-app') return false
  if (end.event.state !== 'completed' || now - end.at <= PROMPT_IDLE_MS) return false
  return store.newestOfType?.(id, 'user_turn', undefined, end.ordinal + 1) == null
}

/** Read only compaction rows, skipping compactions of child agents. */
export function hasCompactionAfter(
  store: PromptLedger,
  id: string,
  ordinal: number,
  matches: (event: Extract<TranscriptEvent, { type: 'compaction' }>) => boolean = () => true,
): boolean {
  for (let before: number | undefined; ;) {
    const row = store.newestOfType?.(id, 'compaction', before, ordinal + 1)
    if (row?.event.type !== 'compaction') return false
    if (row.event.parentToolCallId === undefined && matches(row.event)) return true
    before = row.ordinal
  }
}

export function promptStartFor(store: PromptLedger, id: string, model: string | null, now: number) {
  const launch = store.newestOfType?.(id, 'launched')
  const kept = launch?.event.type === 'launched' ? launch.event.promptStart : undefined
  if (launch == null || kept === undefined) return null
  const row = 'from' in kept ? store.eventsFrom(id, kept.from, 1)[0] : launch
  if (row?.event.type !== 'launched' || ('from' in kept && row.ordinal !== kept.from)) return null
  const start = row.event.promptStart
  if (start === undefined || 'from' in start || start.model !== model) return null
  if (idlePastTheCache(store, id, row.ordinal, now)) return null

  if (hasCompactionAfter(store, id, row.ordinal)) return null
  return { start, ordinal: row.ordinal, given: row.event.given }
}

export function promptUpdatesFor(
  store: PromptLedger,
  id: string,
  kept: NonNullable<ReturnType<typeof promptStartFor>>,
) {
  const turn = store.newestOfType?.(id, 'user_turn', undefined, kept.ordinal + 1)
  if (turn?.event.type !== 'user_turn') return kept.start.updates
  const ending = store.newestOfType?.(id, 'turn', undefined, turn.ordinal + 1)
  if (
    ending?.event.type === 'turn' &&
    ending.event.state === 'failed' &&
    ending.event.wordOf === 'this-app'
  )
    return undefined
  return turn.event.promptUpdates ?? kept.start.updates
}
