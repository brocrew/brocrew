/**
 * Given work whose holder answered a person and waits on their next words. Informational notes
 * keep the same wait and timestamp. The next personal reply or a substantive drive clears it.
 * The person's list names the holder; its giver continues waiting on that holder.
 */
export interface WaitingOnWhoWrote {
  /** The piece, by id — `PieceRow.piece`, copied. */
  readonly piece: string
  /** The label a person says out loud — `PieceRow.label`. */
  readonly label: string
  /** What the piece is called — `PieceRow.title`, the newest title. */
  readonly title: string
  /** ⛔ **The conversation HOLDING the work** — `PieceRow.owner`. This is where a person goes. */
  readonly owner: string
  /**
   * What the AGENT holding it is called, in a sentence a person reads —
   * `RuntimeHost.whatToCallTheConversation`, the identity's name (PM ruling R41). ⚑ Composed
   * main-side, `StalledWork.ownerName`'s reason: a renderer cannot turn a `sess_<uuid>` into a word.
   */
  readonly ownerName: string
  /**
   * ⚑ **When the turn that answered the person ended, epoch ms** — `PieceRow.answeredAPersonAt`; how
   * long the person has owed it their next words.
   */
  readonly answeredAt: number
}

/**
 * ⛔ **One piece of work, as the list renders on** — the piece id and nothing else, for
 * `stalledWorkKey`'s reason: a piece id is minted by this app and unique across every conversation.
 */
export const waitingOnWhoWroteKey = (row: WaitingOnWhoWrote): string => row.piece
