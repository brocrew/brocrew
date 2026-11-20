import type { AppDatabase } from './connection'
import type { SessionStore, WindowOpenWork } from './session-store'
import { rowsUnreadOnce, type RowsUnread } from './rows-unread'
import type { PieceRow } from '../../shared/task-contracts'
import type { LedgerWalk, RaisedQuestion, WorkInHand } from '../../shared/question-contracts'
import { TASK_IS_OPEN, openWorkOf, waitsOnWhoWrote } from '../../shared/tasks'
import type { SkipNote } from './rows-unread'
type SkippedRow = Parameters<SkipNote>[0]

export type StateWork = Pick<PieceRow, 'piece' | 'parent' | 'owner' | 'state' | 'givenAt'>
type StateWait = StateWork & Pick<PieceRow, 'label' | 'statusLine'>
type QueueStall = Pick<
  PieceRow,
  | 'piece'
  | 'label'
  | 'title'
  | 'owner'
  | 'giver'
  | 'state'
  | 'stalledBecause'
  | 'stalledBy'
  | 'stalledAt'
>
type QueueReply = Pick<PieceRow, 'piece' | 'label' | 'title' | 'owner'> & {
  readonly answeredAPersonAt: number
}
type Name = ReturnType<SessionStore['workThatNames']>
type StateQuestion = Pick<RaisedQuestion, 'piece' | 'raisedBy'>
export interface WindowFact<T> {
  readonly value: T
  readonly skipped: readonly (readonly [string, readonly SkippedRow[]])[]
}
export interface WindowWorkReading {
  readonly owners: readonly {
    readonly id: string
    readonly rootless: boolean
    readonly openWork: WindowFact<readonly WorkInHand[]>
    readonly given: WindowFact<readonly StateWork[]>
    readonly waitsOnWhoWrote: WindowFact<readonly StateWork[]>
    readonly naming: WindowFact<{
      readonly named: Name
      readonly waitingOnPurpose: StateWait | null
    }>
  }[]
  readonly namesUnder: readonly (readonly [string, string, WindowFact<Name>])[]
  readonly raised: readonly (readonly [
    string,
    WindowFact<readonly (readonly [string, StateQuestion])[]>,
  ])[]
  readonly queue?: {
    readonly stalls: WindowFact<LedgerWalk<QueueStall>>
    readonly stops: WindowFact<LedgerWalk<QueueStall>>
    readonly replies: WindowFact<LedgerWalk<QueueReply>>
    readonly instructions: WindowFact<ReturnType<SessionStore['instructionAsksWaiting']>>
    readonly servers: WindowFact<ReturnType<SessionStore['mcpServerRequestsWaiting']>>
  }
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
    get count() {
      return counts.count
    },
    get ledgersSkipped() {
      return counts.ledgersSkipped
    },
  }
  return { value: read(unread), skipped: [...skipped].map(([id, rows]) => [id, [...rows]]) }
}

export interface WindowPieces {
  readonly open: readonly PieceRow[]
  readonly skipped: WindowFact<unknown>['skipped']
  readonly owner: Omit<WindowWorkReading['owners'][number], 'given'>
}

/** Project a canonical fold while it is at hand; only open pieces keep their full rows. */
export function projectWindowPieces(
  store: SessionStore,
  id: string,
  folded: WindowFact<readonly PieceRow[]>,
): WindowPieces {
  const root = store.rootOf(id)
  const open = folded.value.filter((piece) => TASK_IS_OPEN[piece.state])
  const { named, waitingOnPurpose } = store.workThatNamesAndItsWait(id, undefined, folded.value)
  const fact = <T>(value: T): WindowFact<T> => ({ value, skipped: folded.skipped })
  return {
    open,
    skipped: folded.skipped,
    owner: {
      id,
      rootless: root === null && store.recordedOne(id) !== null && store.parentOf(id) === null,
      openWork: fact([...(root === null ? [] : [{ label: root.label }]), ...openWorkOf(open)]),
      waitsOnWhoWrote: fact(open.filter(waitsOnWhoWrote).map(stateWork)),
      naming: fact({
        named,
        waitingOnPurpose:
          waitingOnPurpose === null
            ? null
            : {
                ...stateWork(waitingOnPurpose),
                label: waitingOnPurpose.label,
                statusLine: waitingOnPurpose.statusLine,
              },
      }),
    },
  }
}

function stateWork({ piece, parent, owner, state, givenAt }: PieceRow): StateWork {
  return { piece, parent, owner, state, givenAt }
}

/** The state and naming projections need no task briefs, replies, or resource bodies. */
export function readWindowWork(
  db: AppDatabase,
  store: SessionStore,
  listingOnly = false,
  projected: ReadonlyMap<string, WindowPieces> = new Map(),
): WindowWorkReading {
  const ids = db
    .prepare(
      `SELECT id FROM provider_session
    UNION SELECT DISTINCT session_id AS id FROM events
    UNION SELECT owner_session_id AS id FROM work
    UNION SELECT given_by_session_id AS id FROM work WHERE given_by_session_id IS NOT NULL`,
    )
    .all() as { id: string }[]
  const readings = new Map(
    ids.map(({ id }) => [
      id,
      projected.get(id) ??
        projectWindowPieces(
          store,
          id,
          counted((unread) => store.piecesOwnedBy(id, unread)),
        ),
    ]),
  )
  const givenTo = new Map<string, string[]>()
  const edges = db
    .prepare(
      `SELECT DISTINCT given_by_session_id AS giver, owner_session_id AS owner
      FROM work WHERE given_by_session_id IS NOT NULL`,
    )
    .all() as { giver: string; owner: string }[]
  for (const { giver, owner } of edges) {
    let holders = givenTo.get(giver)
    if (holders === undefined) givenTo.set(giver, (holders = []))
    holders.push(owner)
  }
  const forward = (reading: WindowPieces, unread?: RowsUnread): void => {
    for (const [owner, skipped] of reading.skipped)
      for (const ordinal of skipped) unread?.in(owner)(ordinal)
  }
  const work: WindowOpenWork = {
    ownedBy: (owner, noteSkip) => {
      const reading = readings.get(owner)!
      for (const [, skipped] of reading.skipped) for (const ordinal of skipped) noteSkip?.(ordinal)
      return reading.open
    },
    givenBy: (giver, unread) =>
      (givenTo.get(giver) ?? [])
        .flatMap((owner) => {
          const reading = readings.get(owner)!
          forward(reading, unread)
          return reading.open.filter((piece) => piece.giver === giver)
        })
        .sort((left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1)),
  }
  const owners = ids.map(({ id }) => ({
    ...readings.get(id)!.owner,
    given: counted((unread) => work.givenBy(id, unread).map(stateWork)),
  }))
  const pairs = db
    .prepare(
      `WITH RECURSIVE chain(piece, id, owner, parent) AS (
    SELECT id, id, owner_session_id, parent_id FROM work
    UNION SELECT chain.piece, w.id, w.owner_session_id, w.parent_id
      FROM work w JOIN chain ON w.id = chain.parent
  ) SELECT DISTINCT piece, owner FROM chain
    WHERE NOT EXISTS (SELECT 1 FROM work root
      WHERE root.owner_session_id = chain.owner AND root.parent_id IS NULL)`,
    )
    .all() as { piece: string; owner: string }[]
  const namesUnder = pairs.map(
    ({ piece, owner }) =>
      [owner, piece, counted((unread) => store.workThatNamesUnder(owner, piece, unread))] as const,
  )
  const raised = ids.map(
    ({ id }) => [id, counted((unread) => [...store.questionStatesIn(id, unread)])] as const,
  )
  const stalled = (walk: LedgerWalk<PieceRow>): LedgerWalk<QueueStall> => ({
    ...walk,
    rows: walk.rows.map(
      ({ piece, label, title, owner, giver, state, stalledBecause, stalledBy, stalledAt }) => ({
        piece,
        label,
        title,
        owner,
        giver,
        state,
        stalledBecause,
        stalledBy,
        stalledAt,
      }),
    ),
  })
  const endedOwners = new Set(
    db.inTransaction
      ? owners
          .filter(({ openWork, naming }) => {
            const ended = naming.value.named?.ended
            return (
              (ended === 'answered' || ended === 'withdrawn' || ended === 'closed') &&
              naming.skipped.length === 0 &&
              openWork.skipped.length === 0 &&
              openWork.value.length === 0
            )
          })
          .map(({ id }) => id)
      : [],
  )
  const noOpenPieces = (id: string): boolean => endedOwners.has(id)
  let queue: WindowWorkReading['queue']
  try {
    queue = listingOnly
      ? undefined
      : {
          stalls: counted((unread) =>
            stalled(store.stalledWorkNobodyWasToldAbout(unread, noOpenPieces, work)),
          ),
          stops: counted((unread) =>
            stalled(store.stalledWorkItsGiverWasToldAbout(unread, noOpenPieces, work)),
          ),
          replies: counted((unread) => {
            const walk = store.piecesWaitingOnWhoWrote(unread, work)
            return {
              ...walk,
              rows: walk.rows.map(({ piece, label, title, owner, answeredAPersonAt }) => ({
                piece,
                label,
                title,
                owner,
                answeredAPersonAt,
              })),
            }
          }),
          instructions: counted((unread) => store.instructionAsksWaiting(unread)),
          servers: counted((unread) => store.mcpServerRequestsWaiting(unread)),
        }
  } finally {
    // The proof belongs only to these two walks in this immutable snapshot.
    endedOwners.clear()
  }
  const instructionAskers =
    queue === undefined
      ? counted((unread) =>
          store.instructionAskersAmong(
            ids.map(({ id }) => id),
            unread,
          ),
        )
      : { ...queue.instructions, value: queue.instructions.value.map((one) => one.conversation) }
  return { owners, namesUnder, raised, queue, instructionAskers, routedTo: store.whoRoutedToWhom() }
}
