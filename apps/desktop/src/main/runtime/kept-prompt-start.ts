import type { TranscriptEvent } from '../../shared/conversation-events'
import type { SessionStore } from '../db/session-store'
import type { PromptUpdateBaseline } from '../../shared/human-answer-contracts'

type PromptLedger = Pick<SessionStore, 'newestOfType' | 'eventsFrom'>
const PROMPT_IDLE_MS = 60 * 60 * 1000

/** A completed provider turn is later than all its requests, including tool continuations. */
function idlePastTheCache(store: PromptLedger, id: string, since: number, now: number): boolean {
  const end = store.newestOfType?.(id, 'turn', undefined, since + 1)
  if (end?.event.type !== 'turn' || end.event.wordOf === 'this-app') return false
  if (end.event.state !== 'completed' || now - end.at <= PROMPT_IDLE_MS) return false
  return store.newestOfType?.(id, 'user_turn', undefined, end.ordinal + 1) == null
}

/** The newest of this conversation's own compactions after `ordinal`, skipping child agents'. */
function newestCompactionAfter(
  store: PromptLedger,
  id: string,
  ordinal: number,
  matches: (event: Extract<TranscriptEvent, { type: 'compaction' }>) => boolean = () => true,
): number | undefined {
  for (let before: number | undefined; ;) {
    const row = store.newestOfType?.(id, 'compaction', before, ordinal + 1)
    if (row?.event.type !== 'compaction') return undefined
    if (row.event.parentToolCallId === undefined && matches(row.event)) return row.ordinal
    before = row.ordinal
  }
}

/** Read only compaction rows, skipping compactions of child agents. */
export function hasCompactionAfter(
  store: PromptLedger,
  id: string,
  ordinal: number,
  matches: (event: Extract<TranscriptEvent, { type: 'compaction' }>) => boolean = () => true,
): boolean {
  return newestCompactionAfter(store, id, ordinal, matches) !== undefined
}

/** A reading the adapter marked as a model request's own usage, after `ordinal`. */
function aModelRequestAfter(store: PromptLedger, id: string, ordinal: number): boolean {
  for (let before: number | undefined; ;) {
    const row = store.newestOfType?.(id, 'context_reading', before, ordinal + 1)
    if (row?.event.type !== 'context_reading') return false
    if (row.event.modelRequest === true) return true
    before = row.ordinal
  }
}

/**
 * A compaction calls for a new start only until the model has run on the compacted history: that
 * request sent the kept start with it, so the provider's cache now holds that start. A local
 * command, a turn that failed before the model, or an adapter that cannot tell leaves no such
 * reading, and the next relaunch starts fresh as before.
 */
function compactedSinceTheStartWasLastSent(store: PromptLedger, id: string, ordinal: number) {
  const compacted = newestCompactionAfter(store, id, ordinal)
  return compacted !== undefined && !aModelRequestAfter(store, id, compacted)
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

  if (compactedSinceTheStartWasLastSent(store, id, row.ordinal)) return null
  return { start, ordinal: row.ordinal, given: row.event.given }
}

/** Recover the last handed-over snapshot the provider could have received in this context. */
export function promptUpdatesFor(
  store: PromptLedger,
  id: string,
  start: { ordinal: number; updates?: PromptUpdateBaseline },
  rejecting = false,
): PromptUpdateBaseline | undefined {
  let end = store.newestOfType?.(id, 'turn')
  for (let before: number | undefined; ;) {
    const turn = store.newestOfType?.(id, 'user_turn', before)
    if (
      turn?.event.type !== 'user_turn' ||
      store.newestOfType?.(id, 'conversation_reset', undefined, turn.ordinal + 1) != null ||
      hasCompactionAfter(store, id, turn.ordinal)
    )
      return start.updates
    const ended = end?.event
    const rejected =
      end != null &&
      end.ordinal > turn.ordinal &&
      ended?.type === 'turn' &&
      ended.state === 'failed' &&
      ended.wordOf === 'this-app'
    if (turn.event.promptUpdates !== undefined && !rejected && !rejecting) {
      // A recomposed start still resumes the same native context. It refreshes its own facts,
      // while the last accepted footer remains the baseline for facts carried only there.
      return turn.ordinal <= start.ordinal
        ? { ...turn.event.promptUpdates, ...start.updates }
        : turn.event.promptUpdates
    }
    rejecting = false
    before = turn.ordinal
    end = store.newestOfType?.(id, 'turn', before)
  }
}
