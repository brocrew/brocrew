import type { PieceRow, StatusLine } from '../../shared/task-contracts'
import type { RowsUnread } from './rows-unread'

export interface WorkRow {
  /** `work.id`. */
  readonly piece: string
  /** The piece it was given under, or `null`: a root. */
  readonly parent: string | null
  readonly number: number
  readonly label: string
  /** The conversation whose ledger holds its life. */
  readonly owner: string
  readonly givenBy: string | null
  readonly title: string | null
  /** As given; `null` on a root. */
  readonly brief: string | null
  /** The folder the give asked for, as asked, or `null`. */
  readonly folder: string | null
  readonly createdAt: number
}

/** The work-ledger reads used to index and describe past work. */
export interface WorkLedgerRead {
  piecesWithTheirWaits(owner: string, unread: RowsUnread): readonly PieceRow[]
  theActiveGeneration(sessionId: string): number
  /** One `work` row by its id, or `null`. */
  workById(piece: string): WorkRow | null
  rootDoneCondition(root: string): string | null
  /** Root lines for the closing block: null means unread, rather than absent. */
  turnBlockRootLines(
    root: string,
  ): { readonly title: string | null; readonly statusLine: StatusLine | null } | null
  piecesOwnedBy(owner: string, unread?: RowsUnread): readonly PieceRow[]
}
