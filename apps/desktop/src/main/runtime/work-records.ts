import type { RaisedQuestion, RoutedRequest } from '../../shared/question-contracts'
import type { HowAPieceEnded } from '../../shared/piece-called'
import type { PieceRow, StatusLine } from '../../shared/task-contracts'
import type { Exchange } from '../../shared/last-exchange'
import type { ResourceRow } from '../db/session-store'

/**
 * 🔴 **F089 · a piece `withdraw_task` named that the caller HOLDS** — the facts its refusal says it by:
 * the caller's root, the work a person gave it, which never ends; a piece it holds that is open; or
 * one that has ended, with how, when and by whom, off the row that ended it, as `reply_to_parent`'s
 * refusal reads an ended piece.
 */
export type APieceItHolds =
  | { readonly is: 'its-root'; readonly label: string }
  | { readonly is: 'open'; readonly label: string }
  | {
      readonly is: 'ended'
      readonly label: string
      readonly state: HowAPieceEnded
      /** When it ended, epoch ms — absent when its row holds no moment. */
      readonly at?: number
      /**
       * Who ended it, by NAME ({@link RuntimeHost.whatToCallTheConversation}) — absent when its row
       * names nobody, and for the caller's own reply: a reader is not told its own name.
       */
      readonly called?: string
      /** The moment it was refused, which its sentence says the ending's time as of. */
      readonly readAt: number
    }

/**
 * ⚑ **D-016 · a root, as a board or a record names it** — its row and its own two lines, and no
 * state: a root's state is its conversation's (R1).
 */
export interface RootOnTheBoard {
  readonly definitionOfDone?: string | null
  readonly piece: string
  readonly label: string
  readonly owner: string
  /** Its newest `work_retitled`, or `null` while nobody has titled it. */
  readonly title: string | null
  /** Its newest `work_status_set`, or `null`. */
  readonly statusLine: StatusLine | null
}

/**
 * 🔴 **D-016 · what {@link RuntimeHost.pieceBoard} answers** — `list_tasks` with no argument: the
 * root this conversation owns, the pieces it holds, and the pieces it gave, each COMPOSED with what
 * it waits on.
 */
export interface PieceBoard {
  readonly root: RootOnTheBoard | null
  readonly hold: readonly PieceRow[]
  readonly gave: readonly PieceRow[]
  /**
   * 🔴 **671 · R18 — how many ledger rows this answer could not read**, counted ONCE however many of
   * its reads met the same row — a count, never a cause, and never to be added to the lists above.
   */
  readonly rowsUnread: number
  /** ⚑ **D-017 · R8** — how many conversations' records it skipped whole, when any. */
  readonly ledgersSkipped?: number
}

/**
 * 🔴 **D-016 · what {@link RuntimeHost.pieceRecord} answers** — one piece's record, or the one word
 * for a name the caller may not read: a piece it neither owns nor gave, or none at all.
 */
export type PieceRecord =
  | { readonly is: 'no-piece-by-that-name' }
  | {
      readonly is: 'a-root'
      readonly root: RootOnTheBoard
      /** The pieces given under it, each as its owner's ledger folds it. */
      readonly children: readonly PieceRow[]
      /** ⚑ **D-023 · R1** — what its conversation kept for it, listed as a piece's are. */
      readonly resources: readonly ResourceRow[]
      readonly rowsUnread: number
      readonly ledgersSkipped?: number
    }
  | {
      readonly is: 'a-piece'
      /** The piece, composed with what it waits on. */
      readonly piece: PieceRow
      /** The last exchange with the conversation holding it, whole (D-012). */
      readonly lastExchange: Exchange
      /** The questions its owner asked about it that are still open, by request id. */
      readonly openQuestions: readonly string[]
      readonly children: readonly PieceRow[]
      readonly resources: readonly ResourceRow[]
      readonly rowsUnread: number
      readonly ledgersSkipped?: number
    }

/**
 * 🔴 **D-024 · R3 — what `list_tasks` with `made` reads**: the files the caller's profile's
 * conversations made, newest first, each with the piece it was kept on, and how many older ones
 * are not listed — or `no-profile`, for a conversation this app cannot name an identity for.
 */
export type MadeByItsProfile =
  | { readonly is: 'no-profile' }
  | {
      readonly is: 'listed'
      readonly made: readonly {
        readonly resource: ResourceRow
        /** The label of the piece it was kept on. */
        readonly label: string
        /** The title that piece stands under now, or `null`: a root nobody has titled. */
        readonly title: string | null
      }[]
      readonly more: number
    }

/**
 * ⚑ **F059 · how a piece `update_work` was refused on had ended** — its state, and, as
 * `reply_to_parent`'s refusal has said since D-025, when and by whom: off the row that ended it, the
 * fold's own ({@link PieceRow.endedAt}, {@link PieceRow.endedBy}).
 */
export interface EndedPieceDetail {
  readonly piece: string
  readonly label: string
  readonly state: PieceRow['state']
  /** When it ended, epoch ms — absent when its row holds no moment. */
  readonly at?: number
  /**
   * Who ended it, by NAME ({@link RuntimeHost.whatToCallTheConversation}) — absent when its row names
   * nobody, and when the caller ended it itself ({@link endedByYou}). ⛔ Never an id, as
   * `ReplyRefusalDetail.called` is not.
   */
  readonly called?: string
  /** Present when the caller itself ended it: a reader is not told its own name. */
  readonly endedByYou?: true
  /**
   * Whether the caller may still change its title — the one change an ended piece takes: its giver,
   * or the owner of a piece a person gave. ⚑ Its sentence's act turns on it.
   */
  readonly yoursToRetitle: boolean
}

/**
 * ⚑ **D-016 · what a piece a message names is, to the conversation sending it and the agent it goes
 * to** — `message_agent` decides from this which of its words applies.
 *
 *  - **`given-to-it`** — the sender (or one it stands for) gave it, and that agent holds it, open
 *    or ended;
 *  - **`queued-there`** — that agent is a service, and the piece the sender gave it waits there,
 *    queued: its brief has reached nobody;
 *  - **`given-to-another`** — the sender gave it to a different conversation, open or ended;
 *  - **`held`** — the sender holds it: an open piece given to it;
 *  - 🔴 **F086 · `held-and-ended`** — the sender holds it and it has ended: answered, taken back or
 *    closed. ⚑ A note names it as it names one it gave that has ended, and as `list_tasks` lists it
 *    among the work the sender holds; ⛔ a follow-up does not — that is a piece one gave. ⚠️ So is a
 *    piece of the sender's whose opening row its record cannot read: its row names the sender, and
 *    its open pieces do not list it;
 *  - **`its-root`** — the sender's own root, the work a person gave it;
 *  - **`none`** — no piece by that name, or none of the sender's: one answer, so a name is no oracle.
 */
export type WhatAPieceIsToIt =
  | {
      readonly is:
        'given-to-it' | 'queued-there' | 'given-to-another' | 'held' | 'held-and-ended' | 'its-root'
      readonly piece: string
      readonly label: string
    }
  | { readonly is: 'none' }

/** The two ledger reads shared by one answer's work and wait projections. */
export interface StateLedger {
  readonly routings: readonly RoutedRequest[]
  readonly raised: ReadonlyMap<string, Pick<RaisedQuestion, 'piece' | 'raisedBy'>>
}
export interface ItsLedger extends StateLedger {
  readonly raised: ReadonlyMap<string, RaisedQuestion>
}

/** Open given work is read from its holders separately from the giver's own ledger. */
export type WorkOutOf<T = PieceRow> = (id: string) => readonly T[]
