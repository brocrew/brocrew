import type { PieceRow } from './task-contracts'

/** Whether a conversation gave this piece. */
export function givenByAConversation<T extends Pick<PieceRow, 'giver'>>(
  piece: T,
): piece is T & { readonly giver: string } {
  return piece.giver !== null
}
