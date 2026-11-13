import type { AppDatabase } from './connection'
import type { SessionStore } from './session-store'
import { rowsUnreadOnce, type RowsUnread } from './rows-unread'
import type { PieceRow } from '../../shared/task-contracts'
import type { RaisedQuestion } from '../../shared/question-contracts'
import { TASK_IS_OPEN } from '../../shared/tasks'
import type { SkippedRow } from './window-read-protocol'

export type StateWork = Pick<PieceRow, 'piece' | 'parent' | 'owner' | 'state' | 'givenAt'>
export type StateWait = StateWork & Pick<PieceRow, 'label' | 'statusLine'>
type Name = ReturnType<SessionStore['workThatNames']>
export type StateQuestion = Pick<RaisedQuestion, 'piece' | 'raisedBy'>
export interface WindowFact<T> {
  readonly value: T
  readonly skipped: readonly (readonly [string, readonly SkippedRow[]])[]
}
export interface WindowWorkReading {
  readonly owners: readonly {
    readonly id: string
    readonly given: WindowFact<readonly StateWork[]>
    readonly waitsOnWhoWrote: WindowFact<readonly StateWork[]>
    readonly naming: WindowFact<{ readonly named: Name; readonly waitingOnPurpose: StateWait | null }>
  }[]
  readonly namesUnder: readonly (readonly [string, string, WindowFact<Name>])[]
  readonly raised: readonly (readonly [string, WindowFact<readonly (readonly [string,
    StateQuestion
  ])[]>])[]
  readonly instructionAskers: WindowFact<readonly string[]>
  readonly routedTo: ReturnType<SessionStore['whoRoutedToWhom']>
}

function counted<T>(read: (unread: RowsUnread) => T): WindowFact<T> {
  const skipped = new Map<string, Set<SkippedRow>>()
  const counts = rowsUnreadOnce()
  const unread: RowsUnread = {
    in: (id) => (ordinal) => {
      let rows = skipped.get(id)
      if (rows === undefined) skipped.set(id, (rows = new Set()))
      rows.add(ordinal)
      counts.in(id)(ordinal)
    },
    get count() { return counts.count },
    get ledgersSkipped() { return counts.ledgersSkipped },
  }
  return { value: read(unread), skipped: [...skipped].map(([id, rows]) => [id, [...rows]]) }
}

/** The state and naming projections need no task briefs, replies, or resource bodies. */
export function readWindowWork(db: AppDatabase, store: SessionStore): WindowWorkReading {
  const state = ({ piece, parent, owner, state, givenAt }: PieceRow): StateWork =>
    ({ piece, parent, owner, state, givenAt })
  const ids = db.prepare(`SELECT id FROM provider_session
    UNION SELECT DISTINCT session_id AS id FROM events
    UNION SELECT owner_session_id AS id FROM work
    UNION SELECT given_by_session_id AS id FROM work WHERE given_by_session_id IS NOT NULL`)
    .all() as { id: string }[]
  const owners = ids.map(({ id }) => {
    return {
      id,
      given: counted((unread) => store.piecesGivenBy(id, unread).filter((piece) => TASK_IS_OPEN[piece.state]).map(state)),
      waitsOnWhoWrote: counted((unread) => store.piecesWaitingOnWhoWroteIn(id, unread).map(state)),
      naming: counted((unread) => {
        const { named, waitingOnPurpose } = store.workThatNamesAndItsWait(id, unread)
        return { named, waitingOnPurpose: waitingOnPurpose === null ? null : {
          ...state(waitingOnPurpose), label: waitingOnPurpose.label,
          statusLine: waitingOnPurpose.statusLine,
        } }
      }),
    }
  })
  const pairs = db.prepare(`WITH RECURSIVE chain(piece, id, owner, parent) AS (
    SELECT id, id, owner_session_id, parent_id FROM work
    UNION SELECT chain.piece, w.id, w.owner_session_id, w.parent_id
      FROM work w JOIN chain ON w.id = chain.parent
  ) SELECT DISTINCT piece, owner FROM chain`).all() as { piece: string; owner: string }[]
  const namesUnder = pairs.map(({ piece, owner }) =>
    [owner, piece, counted((unread) => store.workThatNamesUnder(owner, piece, unread))] as const)
  const raised = ids.map(({ id }) => [id, counted((unread) => [...store.questionsRaisedIn(id, unread)]
    .map(([request, { piece, raisedBy }]) => [request, { piece, raisedBy }] as const))] as const)
  const instructionAskers = counted((unread) => store.instructionAsksWaiting(unread).map((one) => one.conversation))
  return { owners, namesUnder, raised, instructionAskers, routedTo: store.whoRoutedToWhom() }
}
