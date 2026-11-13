import { theConversationCalled, theWorkAlone } from '../../shared/piece-called'
import { WORK_STATE_WORD } from '../../shared/work-state-words'
import { errorMessage } from './session-disclosures'
import { questionKey } from './question-rails'
import { agentCallerId, type Caller } from './conversation-caller'
import {
  TURN_BLOCK_WORDS,
  type AHelperInTheTurn,
  type AQuestionItHasOpen,
  type CurrentWorkInTheTurn,
  type WhoWaitsOnIt,
} from './what-this-app-adds-to-a-turn'
import {
  TURN_HELPER_OWNERS,
  TURN_HELPER_PIECES,
  type TurnBlockSnapshot,
} from './turn-block-changes'
import { ledgersSkippedOf, readOrSkip } from '../db/session-store'
import { rowsUnreadOnce } from '../db/rows-unread'
import type { SessionStore, WorkRow } from '../db/session-store'
import type { RowsUnread } from '../db/rows-unread'
import type { StateWork } from '../db/window-work-reading'
import {
  composeWhatEachPieceIsWaitingOn,
  TASK_IS_OPEN,
  NOTHING_IT_WAITS_ON,
} from '../../shared/tasks'
import type {
  PieceRow,
  WhatAConversationIsWaitingOn,
  WorkGivenOut,
} from '../../shared/task-contracts'
import { openQuestionsByWork, REQUEST_IS_OPEN, aPersonOwesAnAnswerIn } from '../../shared/questions'
import type { LedgerWalk, RoutedRequest } from '../../shared/question-contracts'
import type { Exchange } from '../../shared/last-exchange'
import type { RunningState } from '../../shared/runtime-ipc'
import type { LastReported, SpawnEdge, WhoCalledWhom, WorkEdge } from '../../shared/who-called-whom'
import type { PieceBoard, PieceRecord, RootOnTheBoard, ItsLedger, StateLedger, WorkOutOf } from './work-records'

interface WorkReadSources {
  /** New calls resolve current Root members when forwarded; existing callbacks stay unchanged. */
  readonly currentStore: () => Pick<
    SessionStore,
    | 'turnBlockPiecesOwnedBy'
    | 'routedRequestsOf'
    | 'questionsRaisedIn'
    | 'turnBlockCandidates'
    | 'rootOf'
    | 'turnBlockRootLines'
    | 'instructionAsksWaitingIn'
    | 'replyQuestionWithoutARequest'
    | 'piecesAtHand'
    | 'questionsRoutedToAtHand'
    | 'workOnItsChainThatNames'
    | 'piecesGivenBy'
  >
  readonly idsForTurnRead: (id: string) => readonly string[]
  readonly waitForTurnRead: (
    unread: RowsUnread,
    ledger: (id: string) => ItsLedger,
    workOut: WorkOutOf,
  ) => (id: string) => WhatAConversationIsWaitingOn
  readonly queueForTurnRead: (
    row: PieceRow,
    bounded: {
      readonly pieces: readonly PieceRow[]
      readonly waits: (id: string) => WhatAConversationIsWaitingOn
    },
  ) => PieceRow
  readonly withinMessagingReach: (id: string, by: Caller, me: string | null) => boolean
  readonly theOneInItsPlace: (id: string) => string
  readonly whatToCallTheConversation: (id: string) => string
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
   * A named piece is readable regardless of who holds or gave it. A missing label remains
   * `no-piece-by-that-name`.
   *
   * ⚑ **A root is its title, its status line, its children and its resources** (R1; D-023 · R1): no
   * state, no questions and no exchange of its own. ⚑ **Any other piece is its board entry, plus
   * its brief, the last exchange with the conversation holding it in full (D-012), the open
   * questions that conversation asked about it, its children and its resources.**
   */
  pieceRecord(_sessionId: string, spelled: string): PieceRecord {
    const row = this.sources.pieceNamed(spelled)
    if (row === null) return { is: 'no-piece-by-that-name' }
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

  /** Read bounded current work and waits without staging or committing a turn snapshot. */
  factsForTheTurnBlock(
    conversation: string,
    currentPiece: string | null,
    snapshot: () => TurnBlockSnapshot,
  ): {
    readonly helpers: readonly AHelperInTheTurn[] | null
    readonly questions: readonly AQuestionItHasOpen[] | null
    readonly personWait: string | null
    readonly nobodyWaiting: boolean
    readonly replyQuestionTurn: string | null
    readonly current: CurrentWorkInTheTurn
  } {
    const unread = rowsUnreadOnce()
    const owners = new Set<string>([conversation])
    const held = new Map<string, readonly PieceRow[]>()
    const ledgers = new Map<string, ItsLedger>()
    let candidatesRead = 0
    const admit = (id: string): void => {
      if (!owners.has(id) && owners.size > TURN_HELPER_OWNERS)
        throw new Error('turn helper owner bound')
      owners.add(id)
    }
    const pieces = (id: string): readonly PieceRow[] => {
      admit(id)
      let rows = held.get(id)
      if (rows === undefined) {
        rows = this.sources.currentStore().turnBlockPiecesOwnedBy(id, unread)
        held.set(id, rows)
      }
      return rows
    }
    const ledger = (id: string): ItsLedger => {
      admit(id)
      let read = ledgers.get(id)
      if (read === undefined) {
        read = {
          routings: this.sources.currentStore().routedRequestsOf(id, unread),
          raised: this.sources.currentStore().questionsRaisedIn(id, unread),
        }
        ledgers.set(id, read)
      }
      return read
    }
    const given = new Map<string, readonly PieceRow[]>()
    const workOut = (id: string): readonly PieceRow[] => {
      const before = given.get(id)
      if (before !== undefined) return before
      const rows: PieceRow[] = []
      const givers = this.sources.idsForTurnRead(id)
      if (givers.length > TURN_HELPER_OWNERS) throw new Error('turn giver bound')
      for (const giver of givers) {
        let after: string | null = null
        for (;;) {
          const candidates = this.sources
            .currentStore()
            .turnBlockCandidates(giver, TURN_HELPER_PIECES + 1, after)
          if (candidates === null) throw new Error('turn has no ledger')
          const page = candidates.slice(0, TURN_HELPER_PIECES)
          for (const candidate of page) {
            const row = pieces(candidate.owner).find(
              (one) => one.piece === candidate.piece && one.giver === giver,
            )
            if (row === undefined) throw new Error('turn candidate was not read')
            // Ended history consumes no helper slot; unshown endings remain eligible.
            if (
              !TASK_IS_OPEN[row.state] &&
              snapshot()?.awaitingEnd.has(row.piece) !== true &&
              !(snapshot()?.at != null && row.givenAt > snapshot().at!)
            )
              continue
            candidatesRead += 1
            if (candidatesRead > TURN_HELPER_PIECES) throw new Error('turn helper piece bound')
            rows.push(row)
          }
          if (candidates.length <= TURN_HELPER_PIECES) break
          const last = page.at(-1)!.piece
          if (last === after) throw new Error('turn helper candidate page did not advance')
          after = last
        }
      }
      given.set(id, rows)
      return rows
    }
    const helperNames = new Map<string, string>()
    let current: CurrentWorkInTheTurn = { kind: 'unavailable' }
    let questions: readonly AQuestionItHasOpen[] | null = null
    let personWait: string | null = null
    let nobodyWaiting = false
    let replyQuestionTurn: string | null = null
    try {
      if (this.sources.currentStore().turnBlockCandidates(conversation, 0) === null)
        throw new Error('turn has no ledger')
      const root = this.sources.currentStore().rootOf(conversation)
      if (root !== null) {
        const lines = this.sources.currentStore().turnBlockRootLines(root.piece)
        if (lines !== null)
          current = {
            kind: 'piece',
            label: root.label,
            title: lines.title,
            status: lines.statusLine?.text ?? null,
          }
      }
      const mine = pieces(conversation)
      if (root === null) {
        const open = mine.filter((row) => TASK_IS_OPEN[row.state])
        const selected =
          open.find((row) => row.piece === currentPiece) ??
          (open.length === 1 ? open[0] : undefined)
        current =
          selected === undefined
            ? open.length === 0
              ? { kind: 'none' }
              : {
                  kind: 'ambiguous',
                  labels: open.slice(0, 5).map((row) => row.label),
                  more: Math.max(0, open.length - 5),
                }
            : {
                kind: 'piece',
                label: selected.label,
                title: selected.title,
                status: selected.statusLine?.text ?? null,
              }
      }
      const ownLedger = ledger(conversation)
      const instructions = this.sources
        .currentStore()
        .instructionAsksWaitingIn(conversation, unread)
      if (instructions === null) throw new Error('turn instruction waits unavailable')
      if (unread.count > 0 || unread.ledgersSkipped > 0) throw new Error('turn facts incomplete')
      const personRequests = ownLedger.routings.filter(
        (row) => row.went.to === 'a-person' && REQUEST_IS_OPEN[row.state],
      )
      questions = personRequests.flatMap((row) => {
        const raised = ownLedger.raised.get(row.requestId)
        return raised?.raisedBy === 'this-app'
          ? [{ id: row.requestId, askedAt: row.at, prompt: raised.prompt }]
          : []
      })
      const waits = this.sources.waitForTurnRead(unread, ledger, (id) =>
        workOut(id).filter((row) => TASK_IS_OPEN[row.state]),
      )
      const raw = workOut(conversation)
      const rawStates = new Map(raw.map((row) => [row.piece, row.state]))
      const helpers = composeWhatEachPieceIsWaitingOn(raw, waits).map((row) =>
        this.sources.queueForTurnRead(row, { pieces: pieces(row.owner), waits }),
      )
      const personPieces = [...composeWhatEachPieceIsWaitingOn(mine, waits), ...helpers].filter(
        (row) =>
          TASK_IS_OPEN[row.state] &&
          (row.state === 'waiting-on-a-person' ||
            row.state === 'waiting-on-the-person-who-wrote' ||
            row.needsUserAction === true),
      )
      // Wait composition can read additional ledgers; check its result before claiming absence.
      if (unread.count > 0 || unread.ledgersSkipped > 0)
        throw new Error('turn wait facts incomplete')
      const helperRules: string[] = []
      for (const owner of new Set(
        helpers.filter((row) => TASK_IS_OPEN[row.state]).map((row) => row.owner),
      )) {
        const rules = this.sources.currentStore().instructionAsksWaitingIn(owner, unread)
        if (rules === null) throw new Error('helper instruction waits unavailable')
        helperRules.push(...rules.map((row) => `${owner}:${row.asked.askId}`))
      }
      if (unread.count > 0 || unread.ledgersSkipped > 0)
        throw new Error('turn rule facts incomplete')
      const waitKeys = [
        ...personRequests.map((row) => row.requestId),
        ...instructions.map((row) => row.asked.askId),
        ...helperRules,
        ...personPieces.map((row) => row.piece),
      ].sort()
      personWait = JSON.stringify(waitKeys)
      nobodyWaiting = waitKeys.length === 0
      if (nobodyWaiting) {
        try {
          replyQuestionTurn = this.sources.currentStore().replyQuestionWithoutARequest(conversation)
        } catch {
          /* An unread reply supplies no hint; the independently read queue stays known. */
        }
      }
      return {
        helpers: helpers
          .filter(
            (row) =>
              TASK_IS_OPEN[row.state] ||
              snapshot()?.awaitingEnd.has(row.piece) === true ||
              (snapshot()?.at != null && row.givenAt > snapshot().at!),
          )
          .map((row) => {
            const open = TASK_IS_OPEN[row.state]
            let name = helperNames.get(row.owner)
            if (name === undefined) {
              if (
                !this.sources.withinMessagingReach(
                  this.sources.theOneInItsPlace(row.owner),
                  { ownerId: agentCallerId(conversation) },
                  conversation,
                )
              )
                throw new Error('helper name is outside card reach')
              name = this.sources.whatToCallTheConversation(row.owner)
              helperNames.set(row.owner, name)
            }
            if (!Object.hasOwn(WORK_STATE_WORD, row.state)) throw new Error('unknown helper state')
            const state =
              row.outcome != null
                ? TURN_BLOCK_WORDS.ended(row.outcome)
                : row.state === 'waiting-on-the-person-who-wrote'
                  ? TURN_BLOCK_WORDS.waitingOnThePerson
                  : WORK_STATE_WORD[row.state]
            return {
              piece: row.piece,
              label: row.label,
              name,
              state,
              givenAt: row.givenAt,
              changedAt:
                row.state === rawStates.get(row.piece) ? (row.lastRecordedChangeAt ?? null) : null,
              open,
              urgent:
                open &&
                (row.state === 'stalled' ||
                  row.state === 'waiting-on-a-person' ||
                  row.state === 'waiting-on-the-person-who-wrote' ||
                  row.needsUserAction === true ||
                  row.queueStalledAt != null),
              revision: JSON.stringify([
                row.owner,
                name,
                row.state,
                row.outcome,
                row.queuedBehind,
                row.queueStalledAt,
                row.statusLine,
                row.lastRecordedChangeAt,
                row.needsUserAction,
              ]),
            }
          }),
        questions,
        personWait,
        nobodyWaiting,
        replyQuestionTurn,
        current,
      }
    } catch (error) {
      console.warn(`turn block facts unavailable for ${conversation}: ${errorMessage(error)}`)
      return {
        helpers: null,
        questions,
        personWait,
        nobodyWaiting,
        replyQuestionTurn,
        current,
      }
    }
  }

  /** Use only already-folded work and routings; unknown facts remain null. */
  whoWaitsOnItAtHand(conversation: string): WhoWaitsOnIt | null {
    try {
      const pieces = this.sources.currentStore().piecesAtHand(conversation)
      if (pieces === null) return null
      const latest = new Map<string, RoutedRequest>()
      for (const id of this.sources.idsForTurnRead(conversation)) {
        const routed = this.sources.currentStore().questionsRoutedToAtHand(id)
        if (routed === null) return null
        for (const request of routed) {
          const itsKey = questionKey(request.askedBy, request.requestId)
          latest.delete(itsKey)
          latest.set(itsKey, request)
        }
      }
      return {
        givers: pieces.flatMap((piece) =>
          TASK_IS_OPEN[piece.state] && piece.giver !== null
            ? [
                {
                  who: this.calledByItsChain(piece.giver, piece.piece),
                  work: `${piece.label} · ${piece.title}`,
                },
              ]
            : [],
        ),
        askers: [...latest.values()].flatMap((request) =>
          REQUEST_IS_OPEN[request.state] && request.went.to !== 'a-person'
            ? [
                {
                  who: this.sources.whatToCallTheConversation(request.askedBy),
                  id: request.requestId,
                  askedAt: request.at,
                },
              ]
            : [],
        ),
      }
    } catch (error) {
      console.warn(
        `runtime host could not read who waits on ${conversation}: ${errorMessage(error)}`,
      )
      return null
    }
  }

  /** Name by existing chain metadata without folding another ledger. */
  private calledByItsChain(conversation: string, piece: string): string {
    return theConversationCalled(
      this.sources.whatToCallTheConversation(conversation),
      theWorkAlone(this.sources.currentStore().workOnItsChainThatNames(conversation, piece)),
    )
  }

  /** Memoize waits per answer; defaults have already been evaluated at the Root door. */
  oneWaitReadPerAnswer(
    unread: RowsUnread | undefined,
    ledger: (id: string) => StateLedger,
    workOut: WorkOutOf<StateWork>,
  ): (id: string) => WhatAConversationIsWaitingOn {
    const held = new Map<string, WhatAConversationIsWaitingOn>()
    const read = (id: string): WhatAConversationIsWaitingOn => {
      // Share one routing read between the open-question and person-wait projections.
      const { routings, raised } = ledger(id)
      const outstanding: WhatAConversationIsWaitingOn = {
        answers: new Set(openQuestionsByWork(routings, raised).keys()),
        // Use the canonical person-wait classification.
        aPerson: aPersonOwesAnAnswerIn(routings),
        // Open child pieces belong to the work each conversation gave, not its owned work.
        childrenOpen: new Set(workOut(id).map((one) => one.parent)),
      }
      return outstanding
    }
    return (id: string): WhatAConversationIsWaitingOn => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      // Counted reads skip an unavailable ledger using the existing unknown-wait result.
      const outstanding = readOrSkip(id, unread?.in(id), NOTHING_IT_WAITS_ON, () => read(id))
      held.set(id, outstanding)
      return outstanding
    }
  }

  /** Keep the two ledger reads together for one answer, never as host state. */
  oneLedgerReadPerAnswer(unread?: RowsUnread): (id: string) => ItsLedger {
    const held = new Map<string, ItsLedger>()
    return (id: string): ItsLedger => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const read: ItsLedger = {
        routings: this.sources.currentStore().routedRequestsOf(id, unread),
        raised: this.sources.currentStore().questionsRaisedIn(id, unread),
      }
      held.set(id, read)
      return read
    }
  }

  /** Read open given work once per identity chain and answer, oldest give first. */
  oneWorkOutReadPerAnswer(unread?: RowsUnread): WorkOutOf {
    const held = new Map<string, readonly PieceRow[]>()
    return (id) => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const read = this.sources
        .idsForTurnRead(id)
        .flatMap((one) => this.sources.currentStore().piecesGivenBy(one, unread))
        .filter((one) => TASK_IS_OPEN[one.state])
        .sort((left, right) => left.givenAt - right.givenAt)
      held.set(id, read)
      return read
    }
  }
}
