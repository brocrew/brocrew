import { ledgersSkippedOf, rowsUnreadOnce } from '../db/session-store'
import type { RowsUnread, SessionStore, WorkRow } from '../db/session-store'
import { composeWhatEachPieceIsWaitingOn } from '../../shared/tasks'
import type { PieceRow, WhatAConversationIsWaitingOn, WorkGivenOut } from '../../shared/tasks'
import { openQuestionsByWork } from '../../shared/questions'
import type { LedgerWalk } from '../../shared/questions'
import type { Exchange } from '../../shared/last-exchange'
import type { RunningState } from '../../shared/runtime-ipc'
import type { LastReported, SpawnEdge, WhoCalledWhom, WorkEdge } from '../../shared/who-called-whom'
import type { PieceBoard, PieceRecord, RootOnTheBoard } from './work-records'

interface WorkReadSources {
  readonly store: Pick<
    SessionStore,
    | 'rootOf'
    | 'piecesOwnedBy'
    | 'piecesGivenBy'
    | 'rootLines'
    | 'rootDoneCondition'
    | 'resourcesOf'
    | 'routedRequestsOf'
    | 'questionsRaisedIn'
    | 'workGivenOutBy'
    | 'parentOf'
    | 'spawnedBy'
    | 'workThisOneGaveOut'
    | 'workThisOneWasGiven'
  >
  readonly oneWaitReadPerAnswer: (
    unread: RowsUnread,
  ) => (id: string) => WhatAConversationIsWaitingOn
  readonly theIdsItStandsFor: (sessionId: string) => readonly string[]
  readonly withItsPlaceInTheQueue: (row: PieceRow) => PieceRow
  readonly pieceNamed: (spelled: string) => WorkRow | null
  readonly ofOneIdentity: (one: string, other: string) => boolean
  readonly childrenOnTheRecord: (
    piece: string,
    waiting: (id: string) => WhatAConversationIsWaitingOn,
    unread: RowsUnread,
  ) => readonly PieceRow[]
  readonly theExchangeShownWith: (piece: PieceRow) => Exchange
  readonly spawnEdge: (conversation: string) => SpawnEdge
  readonly runningStateOf: (sessionId: string) => RunningState
  readonly markedForAPerson: (edges: LedgerWalk<WorkEdge>) => LedgerWalk<WorkEdge>
  readonly lastReportedOf: (conversations: Iterable<string>) => Record<string, LastReported>
}

export class WorkReads {
  constructor(private readonly sources: WorkReadSources) {}

  /**
   * 🔴 **D-016 · one conversation's board — the pieces it HOLDS and the pieces it GAVE** (393 as
   * tasks; `list_tasks` with no argument).
   *
   * ⛔ **Both halves are the same derivation asked in two directions, and neither is a permission.**
   * A conversation is told about its own work; there is no argument for whose work to look at, so
   * there is nothing to refuse. ⚑ That is why this method takes a session id and no {@link Caller}:
   * the id is minted by the toolset from the session it was built for and cannot be handed another
   * (`agentsVisibleTo`'s `me`, one door over).
   *
   *  - **`root`** is the work a person gave this conversation, when it owns one. ⛔ **Never a folded
   *    piece** (R1): its title and status line are its own two lines, and its state is the
   *    conversation's.
   *  - **`hold`** is every piece it was given — how an owner that has come back to open work reads
   *    what it holds, since a resumed conversation composes no brief that would name it.
   *  - **`gave`** is `393` §5's *"a derived state a parent can see"*, and the only reader that
   *    survives its subject: a giver asking after an owner nothing is running reads it here.
   *    ⚑ **D-017 · R10 — with what the conversations it took the place of gave**
   *    ({@link theOnesItTookThePlaceOf}): their work is this conversation's to read, as to take back.
   */
  pieceBoard(sessionId: string): PieceBoard {
    // ⚑ **603/609 · both halves through ONE memo**, so a giver whose owner also gave work out reads
    // that owner's ledgers once — {@link oneWaitReadPerAnswer}.
    // 🔴 **671 · and ONE set of unread rows under the memo and both halves** — see `RowsUnread`.
    const unread = rowsUnreadOnce()
    const waiting = this.sources.oneWaitReadPerAnswer(unread)
    const root = this.sources.store.rootOf(sessionId)
    const hold = composeWhatEachPieceIsWaitingOn(
      this.sources.store.piecesOwnedBy(sessionId, unread),
      waiting,
    )
    const gave = this.sources
      .theIdsItStandsFor(sessionId)
      .flatMap((giver) =>
        composeWhatEachPieceIsWaitingOn(this.sources.store.piecesGivenBy(giver, unread), waiting),
      )
      .map((row) => this.sources.withItsPlaceInTheQueue(row))
    // ⛔ **Read AFTER both halves have composed**, because the wait reads are where most of it is met.
    return {
      root: root === null ? null : this.rootOnTheBoard(root),
      hold,
      gave,
      rowsUnread: unread.count,
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  /** ⚑ **D-016 · a root as a board or a record names it** — its row, and its own two lines. */
  private rootOnTheBoard(root: WorkRow): RootOnTheBoard {
    const lines = this.sources.store.rootLines(root.piece)
    return {
      piece: root.piece,
      label: root.label,
      owner: root.owner,
      title: lines.title,
      definitionOfDone: this.sources.store.rootDoneCondition(root.piece),
      statusLine: lines.statusLine,
    }
  }

  /**
   * 🔴 **D-016 · one piece's RECORD** — `list_tasks` naming a piece (design notes §2, plan §3.9).
   *
   * ⛔ **The caller must own it — its root included — or have given it** (the giver through
   * {@link theIdsItStandsFor}), ⚑ **or a conversation of its own profile must** (D-024 · R2);
   * anything else is `no-piece-by-that-name`, one answer for a name that names nothing and one that
   * is somebody else's, so a label is no oracle.
   *
   * ⚑ **A root is its title, its status line, its children and its resources** (R1; D-023 · R1): no
   * state, no questions and no exchange of its own. ⚑ **Any other piece is its board entry, plus
   * its brief, the last exchange with the conversation holding it in full (D-012), the open
   * questions that conversation asked about it, its children and its resources.**
   */
  pieceRecord(sessionId: string, spelled: string): PieceRecord {
    const row = this.sources.pieceNamed(spelled)
    if (row === null) return { is: 'no-piece-by-that-name' }
    const itsOwner = row.owner === sessionId
    const itsGiver =
      row.givenBy !== null && this.sources.theIdsItStandsFor(sessionId).includes(row.givenBy)
    // ⚑ **D-024 · R2 — or a conversation of its own profile holds or gave it**
    // ({@link ofOneIdentity}).
    const itsProfiles =
      this.sources.ofOneIdentity(row.owner, sessionId) ||
      (row.givenBy !== null && this.sources.ofOneIdentity(row.givenBy, sessionId))
    if (!itsOwner && !itsGiver && !itsProfiles) return { is: 'no-piece-by-that-name' }
    const unread = rowsUnreadOnce()
    const waiting = this.sources.oneWaitReadPerAnswer(unread)
    const children = this.sources.childrenOnTheRecord(row.piece, waiting, unread)
    if (row.parent === null) {
      return {
        is: 'a-root',
        root: this.rootOnTheBoard(row),
        children,
        resources: this.sources.store.resourcesOf(row.piece),
        rowsUnread: unread.count,
        ...ledgersSkippedOf(unread.ledgersSkipped),
      }
    }
    const folded = composeWhatEachPieceIsWaitingOn(
      this.sources.store.piecesOwnedBy(row.owner, unread),
      waiting,
    ).find((one) => one.piece === row.piece)
    // ⚠️ **A row the owner's ledger does not fold** — a torn `work_given`, counted in `unread` —
    // is a piece this read cannot speak for, and it says so as the name that names nothing.
    if (folded === undefined) return { is: 'no-piece-by-that-name' }
    const byWork = openQuestionsByWork(
      this.sources.store.routedRequestsOf(row.owner, unread),
      this.sources.store.questionsRaisedIn(row.owner, unread),
    )
    return {
      is: 'a-piece',
      piece: folded,
      lastExchange: this.sources.theExchangeShownWith(folded),
      openQuestions: (byWork.get(row.piece) ?? []).map((one) => one.requestId),
      children,
      resources: this.sources.store.resourcesOf(row.piece),
      rowsUnread: unread.count,
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  /**
   * 🔴 **The work one conversation gave out, for the window that is showing it** (508).
   *
   * ⛔ **A named door rather than `pieceBoard(id).gave`, and the two answer different
   * questions.** That one pairs both directions for `list_tasks` and hands back {@link PieceRow}s;
   * this one is the window's half, narrowed to {@link WorkGivenOut} and carrying the walk — see
   * {@link SessionStore.workGivenOutBy} for the count that narrowing exists to state.
   *
   * ⚑ **No {@link Caller} and nothing to refuse**, which is `pieceBoard`'s own ruling: *"A
   * conversation is told about its own work; there is no argument for whose work to look at, so
   * there is nothing to refuse."* ⚠️ And no `requireAPerson` — this verb lives on the window wire
   * and on no toolset.
   *
   * ⛔ **The walk is carried through and never recomputed**: the party that WALKED is the only one
   * that can say what it walked.
   */
  workGivenBy(sessionId: string): LedgerWalk<WorkGivenOut> {
    return this.sources.store.workGivenOutBy(sessionId)
  }

  /**
   * 🔴 **Who called whom — one conversation's own edges, for the WINDOW** (543, `540` §7 slice 1).
   *
   * ## ⛔ Why this is one method and not four reads a renderer composes
   *
   * ⚠️ **`540` MI-19 ruled the CONDITION rather than the answer:** *"One timestamp is honest only
   * if the host performs one atomic/defined aggregate read and records the common completion point.
   * With today's separate `conversationsInProject` and `tasksAssignedBy` walks, one timestamp would
   * overclaim."* ⛔ Four IPC round trips are four clocks, and one number over them is `HO-050` §3's
   * animal — a figure that is not measuring what it claims.
   *
   * ⚑ **This is that aggregate.** `better-sqlite3` executes on the calling thread, every statement
   * below is synchronous, and there is no `await` anywhere between the first of them and the stamp
   * — so nothing can be written between two of these lists and land in one of them.
   * ⛔ **{@link WhoCalledWhom.readAt} is taken LAST**, after every walk has returned, which is what
   * makes it a completion point rather than a start time.
   *
   * ## ⚠️ What this adds to the store's answer — TWO facts per node, both the host's (`711` added the second)
   *
   * ⛔ **{@link RunningState}, from the slot map** — {@link runningStateOf}, the private method
   * every such read asks, rather than a second derivation. ⚑ **Left UNFOLDED**: `hereIsOf(running, held)`
   * needs the window's own `held` to reach `open-in-another-window`, and *whether a surface is THIS
   * one is a question the host cannot answer about a list command* (`RUNNING_STATES`' own
   * docblock). ⛔ Folding here would collapse the fourth navigation state `540` MI-20 requires this
   * read to leave reachable, and `504` is the precedent: a row that carried neither field offered
   * no press rather than guessing.
   *
   * ⚑ **W4.203 · and what each named conversation last reported** ({@link lastReportedOf}): its
   * model and effort, and its newest context reading — for one that is not running as much as for
   * one that is.
   *
   * 🔴 **And no `LivenessState`, which is a refusal rather than an omission.** `509`'s rule is
   * that the word may only go on a reader whose re-read cadence is shorter than the silence window,
   * and `540` says the same thing about this panel in particular: *"`live|silent` is especially
   * unsafe on a 30-second-only relationship card"*. ⛔ Nothing bounds this read's cadence, so the
   * field is absent.
   *
   * ## ⚑ The entitlement, written down rather than implied
   *
   * ⛔ **`reads`, the word `workGivenBy` argued for and not the `…ForAPerson` readers' `no
   * session`.** This NAMES a conversation, so `203`'s owner check has something to be about and the
   * classification is a real choice — and it is `reads` for the session library's stated reason:
   * *"the library shows conversations this window does not own and lets you read them — that is the
   * feature"*, over a population that is the same person's either way. ⚠️ **It offers no act**, so
   * there is nothing here for `203` to take away.
   *
   * ⛔ **And it is on the window wire and on no toolset**, which is what keeps an AGENT off it. ⚑ A
   * supervisor reading further DOWN than its own children is a product question with the PO and
   * this read neither widens nor narrows it: it makes EDGES visible and says nothing about what may
   * be read across them.
   */
  whoCalledWhom(sessionId: string): WhoCalledWhom {
    // ⛔ **The parent is the DURABLE fact and never the slot's** — {@link SessionStore.parentOf}.
    // ⚑ {@link routeRequest} reads the same answer for the same conversation, which is why there is
    // one reader of it and not two.
    const parentOf = this.sources.store.parentOf(sessionId)
    const parent = parentOf === null ? null : this.sources.spawnEdge(parentOf)
    const children = this.sources.store.spawnedBy(sessionId)
    const workGivenOut = this.sources.store.workThisOneGaveOut(sessionId)
    const workTakenIn = this.sources.store.workThisOneWasGiven(sessionId)
    // ⚑ **W4.203 · every conversation this read names**, once each.
    const named = new Set<string>([sessionId])
    if (parentOf !== null) named.add(parentOf)
    for (const row of children.rows) named.add(row.conversation)
    for (const edge of [...workGivenOut.rows, ...workTakenIn.rows]) {
      if (edge.from !== null) named.add(edge.from)
      named.add(edge.to)
    }
    return {
      conversation: sessionId,
      parent,
      // ⛔ **Every field spelled out** — `a-spread-writes-past-a-declared-type`: a spread into an
      // object literal is checked for what it brings and not for what the literal owes, and the
      // three counts are the half of this answer a caller cannot recompute.
      children: {
        walk: children.walk,
        ledgers: children.ledgers,
        rowsUnread: children.rowsUnread,
        ...ledgersSkippedOf(children.ledgersSkipped),
        // ⚑ **The two facts the database cannot hold**, which is the reason this read is on the host
        // rather than being handed straight out of the store.
        rows: children.rows.map((row) => ({
          ...row,
          running: this.sources.runningStateOf(row.conversation),
        })),
      },
      // 🔴 **Carried, never recomputed**: the party that WALKED is the only one that can say what it
      // walked, and deriving `ledgers` from `rows.length` here would answer *what was found* to a
      // question that asked *what was read*.
      workGivenOut: this.sources.markedForAPerson(workGivenOut),
      workTakenIn: this.sources.markedForAPerson(workTakenIn),
      lastReported: this.sources.lastReportedOf(named),
      // ⛔ **LAST.** See {@link WhoCalledWhom.readAt}.
      readAt: Date.now(),
    }
  }
}
