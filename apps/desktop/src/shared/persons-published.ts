import type { LedgerWalk, PersonsDecision, PersonsQuestion } from './question-contracts'
import type { McpServerRequestForAPerson } from './conversation-events'
/**
 * The person's queue as one publication: all eight parts a person must see, under one
 * `{epoch, seq}`, each part with its own coverage. A window keeps one scope per part, so a part
 * that was refused or read short never removes what the window already holds for that part.
 */
import type { Coverage, PublicationEpoch } from './data-version'
import type { InstructionAskWaiting } from './own-instructions'

import type { StalledWork } from './stalled-work'
import type { StoppedWorkForAPerson } from './stopped-work'
import type { WaitingOnWhoWrote } from './waiting-on-who-wrote'
import type { WorkIncident } from './work-incidents'

export const PERSONS_PARTS = [
  'questions',
  'decisions',
  'instructionAsks',
  'mcpServerRequests',
  'stalled',
  'stopped',
  'waitingOnWhoWrote',
  'incidents',
] as const

export type PersonsPart = (typeof PERSONS_PARTS)[number]

/** A replayed list, with the rows its read could not take. */
export interface CountedRows<Row> {
  readonly rows: readonly Row[]
  readonly rowsUnread: number
}

/** One stamp for the whole queue, and each part's coverage under it, with `scope` its name. */
export interface PersonsPublished {
  readonly epoch: PublicationEpoch
  readonly seq: number
  readonly covers: Readonly<Record<PersonsPart, Coverage>>
}

/** Each part, or `null` where its read was refused: a window then keeps what it holds. */
export interface PersonsQueue {
  readonly questions: LedgerWalk<PersonsQuestion> | null
  readonly decisions: LedgerWalk<PersonsDecision> | null
  readonly instructionAsks: CountedRows<InstructionAskWaiting> | null
  readonly mcpServerRequests: CountedRows<McpServerRequestForAPerson> | null
  readonly stalled: LedgerWalk<StalledWork> | null
  readonly stopped: LedgerWalk<StoppedWorkForAPerson> | null
  readonly waitingOnWhoWrote: LedgerWalk<WaitingOnWhoWrote> | null
  readonly incidents: LedgerWalk<WorkIncident> | null
  readonly published: PersonsPublished
}

/** The queue could not be answered at all, said at the stamp it failed against. */
export interface PersonsQueueRefused {
  readonly refused: string
  readonly published: { readonly epoch: PublicationEpoch; readonly seq: number }
}

export type PersonsQueueAnswer = PersonsQueue | PersonsQueueRefused

/** The key a window holds each part's row by. */
export const PERSONS_ROW_KEY: {
  readonly [P in PersonsPart]: (row: PersonsRow<P>) => string
} = {
  // A provider's request id is its connection's own, so two conversations can share one: the
  // asking conversation makes it distinct, as the live queue spells it.
  questions: (row) => `${row.request.askedBy}:${row.request.requestId}`,
  decisions: (row) => `${row.request.askedBy}:${row.request.requestId}`,
  instructionAsks: (row) => row.asked.askId,
  mcpServerRequests: (row) => row.requested.requestId,
  stalled: (row) => row.piece,
  stopped: (row) => row.piece,
  waitingOnWhoWrote: (row) => row.piece,
  incidents: (row) => row.piece,
}

/** The row type of one part. */
export type PersonsRow<P extends PersonsPart> =
  NonNullable<PersonsQueue[P]> extends { readonly rows: readonly (infer Row)[] } ? Row : never
