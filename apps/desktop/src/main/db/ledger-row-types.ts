import type { TranscriptEvent } from '../../shared/conversation-events'

/** One recorded transcript entry, with the ordinal it was published under and when it happened. */
export interface PersistedEvent {
  ordinal: number
  /** The row's `created_at`: when the event happened, not when it was read back. */
  at: number
  event: TranscriptEvent
}

export interface DigestRow {
  readonly sessionId: string
  readonly ordinal: number
  /** The row's `created_at`: when the event happened, not when it was read back. */
  readonly at: number
  readonly event: TranscriptEvent
}

/** A ledger row as the database holds it, before its payload is parsed. */
export interface EventRow {
  ordinal: number
  payload: string
  created_at: number
}
