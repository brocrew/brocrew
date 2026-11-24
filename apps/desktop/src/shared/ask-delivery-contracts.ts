/** An immutable, serialized [source conversation, source generation, source ordinal]. */
export type AskLedgerReference = string

export function askLedgerReference(
  sessionId: string,
  generation: number,
  ordinal: number,
): AskLedgerReference {
  return JSON.stringify([sessionId, generation, ordinal])
}

export interface AskHandoffInput {
  readonly opening: AskLedgerReference
  readonly inputIndex: number
  readonly heldMessageId?: string
}

export interface AskHandoffAttempted {
  readonly type: 'ask_handoff_attempted'
  readonly attempt: AskLedgerReference
  readonly originals: readonly AskHandoffInput[]
}

export interface AskHandoffNotAccepted {
  readonly type: 'ask_handoff_not_accepted'
  readonly attempt: AskLedgerReference
}

export interface AskProvenanceUnresolved {
  readonly type: 'ask_provenance_unresolved'
  readonly outgoingGeneration: number
  /** A lost route can affect an unidentified recipient; a derived read cannot certify coverage. */
  readonly coverage: 'unprepared'
}

/**
 * ⚑ **The question a notice of a question asks** — the conversation that asked it, and the request
 * id it is answered by. ⚑ Held with the notice so one whose question has stopped waiting is taken
 * back unread rather than sent.
 */
export interface TheQuestionItAsks {
  readonly originalOpening?: AskLedgerReference
  readonly asker: string
  readonly requestId: string
}
