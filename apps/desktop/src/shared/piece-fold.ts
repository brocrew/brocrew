import type { AskToStop } from './how-work-stopped'
import type { PieceRow, StoppedOnALimit, StoppedOnALogin, TaskStallCause } from './task-contracts'

interface HeldForTheQueue {
  readonly cause: TaskStallCause
  readonly by: PieceRow['stalledBy']
  readonly stopped?: readonly string[]
  /** ⚑ **F076** — the login rider its drive's end chose, handed on at the release. */
  readonly login?: StoppedOnALogin
  /** ⚑ **F097** — a person's own words opened the turn that drive ended, handed on at the release. */
  readonly aPersonWroteIt?: boolean
  /** ⚑ **F097** — since when it waited on that person, for a reply held for it. */
  readonly since?: number
}

interface HeldForTheBackground {
  readonly cause: TaskStallCause
  readonly by: PieceRow['stalledBy']
  /** ⚑ **F076** — the login rider its drive's end chose, handed on at the release. */
  readonly login?: StoppedOnALogin
  /** ⚑ **F097** — a person's own words opened the turn that drive ended, handed on at the release. */
  readonly aPersonWroteIt?: boolean
}

export type AsTheCutLeftIt =
  | { readonly stalledAt: number; readonly wentBack: boolean }
  | { readonly waitsOnItsPerson: true }
  | { readonly heldForTheBackground: true }

export interface PieceTurnAuthorship {
  readonly everyPiece: boolean
  readonly theirPieces: ReadonlySet<string>
  readonly anotherNamed: ReadonlySet<string>
}

export function aPersonDrove(authorship: PieceTurnAuthorship, piece: string): boolean {
  return (
    (authorship.everyPiece || authorship.theirPieces.has(piece)) &&
    !authorship.anotherNamed.has(piece)
  )
}

interface WentBackTo {
  readonly cause: TaskStallCause
  readonly at: number
  readonly by: PieceRow['stalledBy']
  readonly limit?: StoppedOnALimit
  readonly login?: StoppedOnALogin
}

/**
 * Everything {@link derivePieces} holds after a row. Handed back to it, it folds only the rows after
 * and answers as a fold of the whole ledger would. Never changed once made.
 */
export interface PieceFold {
  readonly rows: readonly PieceRow[]
  readonly changeTimes: ReadonlyMap<string, { readonly at: number; readonly order: number }>
  readonly changeAt: number
  readonly changeOrder: number
  readonly sourceOrdinal: number
  readonly open: ReadonlyMap<string, { readonly row: PieceRow; readonly index: number }>
  readonly indexOfPiece: ReadonlyMap<string, number>
  readonly byMessage: ReadonlyMap<string, string>
  readonly travelled: ReadonlySet<string>
  readonly asked: Pick<AskToStop, 'by' | 'asker'> | null
  readonly whoseWordsDroveItLast: ReadonlyMap<string, boolean>
  readonly aPersonOpenedThisTurnFor: PieceTurnAuthorship | null
  readonly waitsOnWhoWroteSince: ReadonlyMap<
    string,
    { readonly at: number; readonly cause: TaskStallCause }
  >
  readonly waitingToDriveIt: ReadonlyMap<
    string,
    { readonly target: string | null; readonly note: boolean }
  >
  readonly heldForTheQueue: ReadonlyMap<string, HeldForTheQueue>
  readonly inTheBackground: ReadonlyMap<string, string>
  readonly scheduled: ReadonlyMap<string, string>
  readonly heldForTheBackground: ReadonlyMap<string, HeldForTheBackground>
  readonly stalledAsItsWakeWasDue: ReadonlyMap<string, number>
  readonly theStopWasARefusedLogin: boolean
  readonly theStopWasOnAKey: boolean
  readonly reopenedSinceItsLoginWasRefused: boolean
  readonly aTurnIsOpen: boolean
  readonly aDriveWaitsForItsTurn: boolean
  readonly pendingDriveAt: number
  readonly pendingDriveOrder: number
  readonly driving: boolean
  readonly cutByAnInterrupt: ReadonlyMap<string, number>
  readonly theTurnNames: ReadonlySet<string> | null
  readonly theTurnGoesBackTo: ReadonlyMap<string, number>
  readonly theCutTurnDrove: ReadonlyMap<string, AsTheCutLeftIt>
  readonly wentBackTo: ReadonlyMap<string, WentBackTo>
}
