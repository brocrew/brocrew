import { capabilitiesFor, isAvailable, SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { UserTurnEvent } from '../../../shared/human-answer-contracts'
import { moveOriginOf, moveReceiptOf } from '../../../shared/move-request'
import { pieceNumbersOf } from '../../../shared/piece-called'
import type { PieceFold } from '../../../shared/piece-fold'
import type { RaisedQuestion } from '../../../shared/question-contracts'
import { aPersonOwesAnAnswerIn, openQuestionsByWork } from '../../../shared/questions'
import { theMessagesOf } from '../../../shared/runtime-ipc'
import type { PieceRow, WhatAConversationIsWaitingOn } from '../../../shared/task-contracts'
import { derivePieces, TASK_IS_OPEN } from '../../../shared/tasks'
import { actedByFrom } from '../../../shared/who-did-it'
import type { AppDatabase } from '../connection'
import { FOLD_TERM } from '../fold-index'
import type { EventRow, PersistedEvent } from '../ledger-row-types'
import { piecesAtTheCutAndNow } from '../piece-fold-cut'
import { type RowsUnread, type SkipNote, THE_WHOLE_LEDGER } from '../rows-unread'
import {
  aStoredObject,
  attachmentsStoredOn,
  authorshipStoredOn,
  isAStoredId,
  isMailboxKind,
  persistedEventsFrom,
  providerFailureHolderStoredOn,
  theQuestionItAsks,
  toPersistedEvents,
} from '../stored-event-codec'
import type { SessionStore } from './session-store-contract'
import type {
  GivenWorkRow,
  RaisedQuestionRow,
  WindowOpenWork,
  WorkDbRow,
} from './session-store-rows'
import { pieceStallOrdinals, readOrSkip, theFoldIndexHolds } from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'
import type { createWorkStatementsPart } from './work-statements'
import type { createLedgerEventsPart } from './ledger-events'
import type { createAgentIdentitiesPart } from './agent-identities'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  | 'activeGeneration'
  | 'keptUntilItsLedgerGrows'
  | 'pieceFoldFloors'
  | 'questionsRaisedInSession'
  | 'reconciliationCut'
  | 'recordedTurnOpeningOf'
  | 'routedRequestsOfSession'
  | 'selectQuestionsRaised'
  | 'theFoldsMayBeKept'
  | 'wordsIn'
>

type FromWorkStatements = Pick<ReturnType<typeof createWorkStatementsPart>, 'workSql'>

type FromLedgerEvents = Pick<ReturnType<typeof createLedgerEventsPart>, 'theNewestTurn'>

type FromAgentIdentities = Pick<ReturnType<typeof createAgentIdentitiesPart>, 'selectPieceEvents'>

interface PieceFoldsPartDeps
  extends FromTurnReads, FromWorkStatements, FromLedgerEvents, FromAgentIdentities {
  readonly db: AppDatabase
  readonly oneSnapshot: boolean
  readonly checkFoldState?: (state: readonly unknown[], complete?: boolean) => void
}

type StrandedMessages = {
  stranded: { session_id: string; message_id: string; text: string | null; payload: string }[]
  torn: { session_id: string; ordinal: number }[]
}

export function createPieceFoldsPart(deps: PieceFoldsPartDeps) {
  const {
    db,
    oneSnapshot,
    checkFoldState,
    activeGeneration,
    keptUntilItsLedgerGrows,
    pieceFoldFloors,
    questionsRaisedInSession,
    reconciliationCut,
    recordedTurnOpeningOf,
    routedRequestsOfSession,
    selectPieceEvents,
    selectQuestionsRaised,
    theFoldsMayBeKept,
    theNewestTurn,
    wordsIn,
    workSql,
  } = deps
  const selectProviderOf = db.prepare(`SELECT provider FROM provider_session WHERE id = ?`)
  const selectFirstPieceGiven = db.prepare(
    `SELECT min(ordinal) AS ordinal FROM events
      WHERE session_id = ? AND +generation = ?
        AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                     'work_status_set', 'work_rebriefed', 'work_closed')
        AND type = 'work_given'`,
  )
  const selectTurnOpenedBefore = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal < ? AND type = 'user_turn'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectLevelStatedBefore = db.prepare(
    `SELECT ordinal, json_array_length(payload, @path) AS stated FROM events
      WHERE session_id = @session AND generation = @generation AND ordinal < @before
        AND type = @type
        AND CASE WHEN json_valid(payload) THEN json_type(payload, @path) END = 'array'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectOwnersGivenWorkBy = db.prepare(
    `SELECT DISTINCT w.owner_session_id AS id, identity.slug AS identity
       FROM work w
       LEFT JOIN provider_session s ON s.id = w.owner_session_id
       LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
      WHERE w.given_by_session_id = ?`,
  )
  const selectStallsTold = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type IN ('work_stall_told', 'message_unqueued')
        AND ordinal >= (SELECT min(ordinal) FROM events
                           INDEXED BY events_kind_owner_idx
                         WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
                           AND type = 'work_stall_told')
      ORDER BY ordinal`,
  )
  const selectStallsToldMoved = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND type IN ('work_stall_told', 'message_unqueued') AND ordinal > @after
        AND CASE WHEN type = 'work_stall_told' THEN 1
                 WHEN json_valid(payload) AND json_type(payload) = 'object'
                   THEN json_extract(payload, '$.reason') IS 'abandoned'
                 ELSE 1 END
      LIMIT 1`,
  )
  const selectTheDecisionOn = db.prepare(
    `SELECT payload FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type = 'user_decision'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END = ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectMessagesWaitingIn = db.prepare(
    `SELECT type, ordinal, created_at,
            json_valid(payload) AS valid,
            CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') END AS message_id,
            CASE WHEN type = 'message_queued' THEN payload END AS payload
       FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ?
        AND generation = COALESCE(
              (SELECT d.active FROM derived_generation d WHERE d.session_id = ?), 0)
        AND type IN ('message_queued', 'message_unqueued')
      ORDER BY ordinal LIMIT ?`,
  )
  theFoldIndexHolds(selectMessagesWaitingIn)
  const selectMessagesMoved = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND type IN ('message_queued', 'message_unqueued') AND ordinal > @after
      LIMIT 1`,
  )
  theFoldIndexHolds(selectMessagesMoved)
  const queueEndingStillApplies = (
    endedAt: number | undefined,
    queuedAt: number,
    stored: Record<string, unknown> | null,
  ): boolean =>
    endedAt !== undefined &&
    (endedAt >= queuedAt ||
      providerFailureHolderStoredOn(
        stored?.kind,
        stored?.appNotice,
        stored?.providerFailureHolder,
      ) === undefined)

  const selectEveryConversationAndStatus = db.prepare(`SELECT id, status FROM provider_session`)
  const selectHeldMessageRowsOf = db.prepare(
    `SELECT rowid AS row, type, ordinal,
            json_valid(payload) AS valid,
            CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') END AS message_id,
            CASE WHEN type = 'message_queued' AND json_valid(payload)
                 THEN json_extract(payload, '$.forItsNextStart') END AS for_its_next_start,
            CASE WHEN type = 'message_queued' AND json_valid(payload)
                 THEN json_extract(payload, '$.text') END AS text,
            CASE WHEN type = 'message_queued' AND json_valid(payload) THEN payload END AS payload
       FROM events
        INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ?
        AND generation = COALESCE(
              (SELECT d.active FROM derived_generation d WHERE d.session_id = ?), 0)
        AND type IN ('message_queued', 'message_unqueued', 'launched')
      ORDER BY ordinal`,
  )
  theFoldIndexHolds(selectHeldMessageRowsOf)

  function* strandedMessageSteps(
    owners?: ReadonlySet<string>,
  ): Generator<() => void, StrandedMessages> {
    const stranded: {
      row: number
      session_id: string
      message_id: string
      text: string | null
      payload: string
    }[] = []
    const torn: { row: number; session_id: string; ordinal: number }[] = []
    let conversations: { id: string; status: string }[] = []
    yield () => {
      conversations = selectEveryConversationAndStatus.all() as typeof conversations
    }
    for (const conversation of conversations) {
      if (owners !== undefined && !owners.has(conversation.id)) continue
      yield () => {
        const heldHere: typeof stranded = []
        const tornHere: typeof torn = []
        const rows = selectHeldMessageRowsOf.all(conversation.id, conversation.id) as {
          row: number
          type: string
          ordinal: number
          valid: number
          message_id: unknown
          for_its_next_start: unknown
          text: unknown
          payload: string | null
        }[]
        const ended = new Map<unknown, number>()
        let lastTornEnding = -Infinity
        let lastStart = -Infinity
        for (const one of rows) {
          if (one.type === 'launched') lastStart = Math.max(lastStart, one.ordinal)
          else if (one.valid !== 1) {
            tornHere.push({ row: one.row, session_id: conversation.id, ordinal: one.ordinal })
            if (one.type === 'message_unqueued')
              lastTornEnding = Math.max(lastTornEnding, one.ordinal)
          } else if (one.type === 'message_unqueued') ended.set(one.message_id, one.ordinal)
        }
        if (conversation.status === 'ended' || conversation.status === 'errored') {
          torn.push(...tornHere)
          return
        }
        for (const one of rows) {
          if (one.type !== 'message_queued' || one.valid !== 1 || one.message_id === null) continue
          if (one.payload === null) continue
          if (one.for_its_next_start === 1 && lastStart <= one.ordinal) continue
          const stored = aStoredObject(one.payload)
          const origin = moveOriginOf(stored?.movedFrom)
          if (origin !== undefined) {
            const decisionRow = selectTheDecisionOn.get(
              origin.sessionId,
              activeGeneration(origin.sessionId),
              origin.requestId,
            ) as { payload: string } | undefined
            const decision = aStoredObject(decisionRow?.payload ?? null)
            const receipt = moveReceiptOf(decision?.movedTo)
            if (
              actedByFrom(decision?.by)?.who === 'a-person' &&
              receipt?.sessionId === conversation.id &&
              receipt.messageId === one.message_id
            )
              continue
          }
          if (
            queueEndingStillApplies(ended.get(one.message_id), one.ordinal, stored) ||
            lastTornEnding > one.ordinal
          )
            continue
          heldHere.push({
            row: one.row,
            session_id: conversation.id,
            message_id: one.message_id as string,
            text: one.text as string | null,
            payload: one.payload,
          })
        }
        stranded.push(...heldHere)
        torn.push(...tornHere)
      }
    }
    const byRow = (a: { row: number }, b: { row: number }): number => a.row - b.row
    return {
      stranded: stranded.sort(byRow).map((held) => ({
        session_id: held.session_id,
        message_id: held.message_id,
        text: held.text,
        payload: held.payload,
      })),
      torn: torn.sort(byRow).map((one) => ({ session_id: one.session_id, ordinal: one.ordinal })),
    }
  }

  function strandedMessages(owners?: ReadonlySet<string>): StrandedMessages {
    const steps = strandedMessageSteps(owners)
    let next = steps.next()
    while (!next.done) {
      next.value()
      next = steps.next()
    }
    return next.value
  }
  const piecesKept = keptUntilItsLedgerGrows(foldPiecesKept, carryThePiecesForward(false), 'pieces')
  const piecesOfSession = (owner: string, noteSkip?: SkipNote) => piecesKept(owner, noteSkip).answer
  const turnBlockPiecesKept = keptUntilItsLedgerGrows(
    (owner, noteSkip) => foldPiecesKept(owner, noteSkip, true),
    carryThePiecesForward(true),
    'turn-pieces',
  )
  const turnBlockPiecesOfSession = (owner: string, noteSkip?: SkipNote) =>
    turnBlockPiecesKept(owner, noteSkip).answer
  const stallsToldToSession = keptUntilItsLedgerGrows(
    foldStallsToldToSession,
    (session, generation, after, held) =>
      selectStallsToldMoved.get({ session, generation, after }) === undefined ? held : null,
    'stalls',
  )
  const questionState = ({ piece, raisedBy }: RaisedQuestion) => ({ piece, raisedBy })
  const questionStatesInSession = keptUntilItsLedgerGrows(
    (sessionId, noteSkip) => readRaisedQuestions(sessionId, noteSkip, questionState),
    // The newest row of a question names its state: appended rows are read on top of the kept map.
    (sessionId, generation, after, held) => {
      let readable = true
      const rows = selectQuestionsRaised.iterate(sessionId, generation, after)
      const added = wordsIn(
        sessionId,
        rows as Iterable<RaisedQuestionRow>,
        () => {
          readable = false
        },
        questionState,
      )
      if (!readable) return null
      return added.size === 0 ? held : new Map([...held, ...added])
    },
    'question-states',
  )

  // Every conversation's messages are read for each window incident read: a window snapshot keeps
  // them until the ledger grows.
  const messagesWaitingKept = keptUntilItsLedgerGrows(
    (sessionId, noteSkip) => foldMessagesWaitingIn(sessionId, noteSkip),
    // A ledger that grew by rows other than messages leaves what is waiting as it was.
    (session, generation, after, held) =>
      selectMessagesMoved.get({ session, generation, after }) === undefined ? held : null,
    'messages',
  )

  type ReconciliationReading = ReturnType<SessionStore['reconciliationPieces']>
  type ReconciliationCutRead = number | null | undefined | 'unread'
  /**
   * One conversation's incident pieces, with the turn and cut they were read at and the pieces at
   * that cut (`null` when unread there); what drove the turn is read from them on each use.
   */
  interface ReconciliationKept {
    readonly pieces: readonly PieceRow[]
    readonly newestTurn: string | null
    readonly before: ReconciliationCutRead
    readonly atTheCut: readonly PieceRow[] | null
  }

  function reconciliationCutOrUnread(owner: string, turn: string): ReconciliationCutRead {
    try {
      return reconciliationCut(owner, turn)
    } catch {
      return 'unread'
    }
  }

  function foldReconciliationPieces(owner: string, noteSkip?: SkipNote): ReconciliationKept {
    const newestTurn = theNewestTurn(owner)
    const before = newestTurn === null ? null : reconciliationCutOrUnread(owner, newestTurn)
    if (before === null || before === 'unread')
      return { pieces: piecesOfSession(owner, noteSkip), newestTurn, before, atTheCut: null }
    let complete = true
    const skipped: SkipNote = (ordinal, cause) => {
      complete = false
      noteSkip?.(ordinal, cause)
    }
    let atTheCut: readonly PieceRow[] | null = null
    const pieces =
      before === undefined
        ? piecesOfSession(owner, skipped)
        : foldPiecesOfSession(owner, skipped, false, undefined, undefined, {
            before,
            read: (cut) => {
              atTheCut = cut
            },
          })
    if (before === undefined && complete) atTheCut = pieces
    return { pieces, newestTurn, before, atTheCut }
  }

  function reconciliationReading(owner: string, kept: ReconciliationKept): ReconciliationReading {
    const { pieces, newestTurn, before, atTheCut } = kept
    if (newestTurn === null || before === null) return { pieces, newestTurn, driven: [] }
    if (before === 'unread' || atTheCut === null) return { pieces, newestTurn, driven: null }
    try {
      return {
        pieces,
        newestTurn,
        driven: piecesThatDrove(owner, atTheCut, recordedTurnOpeningOf(owner, newestTurn)),
      }
    } catch {
      // The current pieces remain usable when the separate historical fact is unread.
      return { pieces, newestTurn, driven: null }
    }
  }

  /**
   * Rows appended after the turn's cut leave the pieces at that cut as they were: while the newest
   * turn and its cut stay, only the current pieces are read again, from their own kept fold.
   */
  function carryTheReconciliationForward(
    owner: string,
    _generation: number,
    _after: number,
    held: ReconciliationKept,
  ): ReconciliationKept | null {
    const newestTurn = theNewestTurn(owner)
    const before = newestTurn === null ? null : reconciliationCutOrUnread(owner, newestTurn)
    if (newestTurn !== held.newestTurn || before !== held.before) return null
    let complete = true
    const pieces = piecesOfSession(owner, () => {
      complete = false
    })
    if (!complete) return null
    return { ...held, pieces, atTheCut: before === undefined ? pieces : held.atTheCut }
  }

  // Each window incident read folds every conversation that ever held work: a window snapshot keeps
  // it until the ledger grows, used only while its newest turn and cut are still the ones it read.
  const reconciliationPiecesKept = keptUntilItsLedgerGrows(
    foldReconciliationPieces,
    carryTheReconciliationForward,
    'reconciliation',
  )

  function foldMessagesWaitingIn(
    sessionId: string,
    noteSkip: SkipNote | undefined,
    maximumRows?: number,
  ): ReturnType<SessionStore['messagesWaitingIn']> {
    const bound = maximumRows === undefined ? Number.MAX_SAFE_INTEGER : maximumRows + 1
    const read = selectMessagesWaitingIn.all(sessionId, sessionId, bound) as {
      type: string
      ordinal: number
      created_at: number
      valid: number
      message_id: unknown
      payload: string | null
    }[]
    if (maximumRows !== undefined && read.length > maximumRows) {
      noteSkip?.(THE_WHOLE_LEDGER)
      return []
    }
    for (const row of read) {
      if (row.valid !== 1 || !isAStoredId(row.message_id)) {
        noteSkip?.(row.ordinal)
      }
    }
    const ended = new Map<unknown, number>()
    let lastTornEnding = -Infinity
    for (const row of read) {
      if (row.type !== 'message_unqueued') continue
      if (row.valid === 1) ended.set(row.message_id, row.ordinal)
      else lastTornEnding = Math.max(lastTornEnding, row.ordinal)
    }
    const rows = read.filter(
      (row): row is typeof row & { payload: string } =>
        row.type === 'message_queued' &&
        row.valid === 1 &&
        row.message_id !== null &&
        row.payload !== null &&
        lastTornEnding <= row.ordinal,
    )
    return rows.flatMap((row) => {
      const stored = aStoredObject(row.payload)
      const messageId = stored?.messageId
      if (stored === null || typeof messageId !== 'string') return []
      if (queueEndingStillApplies(ended.get(messageId), row.ordinal, stored)) return []
      const unansweredQuestion = theQuestionItAsks(stored.unansweredQuestion)?.asks
      const piece = isAStoredId(stored.piece) ? stored.piece : null
      const label =
        piece !== null && typeof stored.label === 'string' && pieceNumbersOf(stored.label) !== null
          ? stored.label
          : null
      const holder = providerFailureHolderStoredOn(
        stored.kind,
        stored.appNotice,
        stored.providerFailureHolder,
      )
      return [
        {
          messageId,
          kind: isMailboxKind(stored.kind) ? stored.kind : 'work',
          text: typeof stored.text === 'string' ? stored.text : '',
          attachments: attachmentsStoredOn(row.payload).attachments ?? [],
          authorship: authorshipStoredOn(row.payload),
          at: row.created_at,
          ...(piece === null ? {} : { piece }),
          ...(label === null ? {} : { label }),
          ...(piece !== null && stored.rebrief === true ? { rebrief: true as const } : {}),
          ...(isAStoredId(stored.drives) ? { drives: stored.drives } : {}),
          ...(isAStoredId(stored.about) ? { about: stored.about } : {}),
          ...(holder === undefined ? {} : { providerFailureHolder: holder }),
          ...(theQuestionItAsks(stored.asks) ?? {}),
          ...(unansweredQuestion === undefined ? {} : { unansweredQuestion }),
          ...(isAStoredId(stored.messageAct) ? { messageAct: stored.messageAct } : {}),
        },
      ]
    })
  }

  /** One ledger's pieces, and where their fold stood after its last row, to carry it forward. */
  interface PiecesKept {
    readonly answer: readonly PieceRow[]
    /** `null` when no piece was ever given there, so nothing was folded. */
    readonly fold: PieceFold | null
  }

  function foldPiecesKept(owner: string, noteSkip?: SkipNote, trackChanges = false): PiecesKept {
    const kept: { fold?: PieceFold } = {}
    const answer = foldPiecesOfSession(owner, noteSkip, trackChanges, undefined, (at) => {
      kept.fold = at
    })
    return { answer, fold: kept.fold ?? null }
  }

  function carryThePiecesForward(trackChanges: boolean) {
    return (owner: string, generation: number, after: number, held: PiecesKept) => {
      // A row the whole fold would count as unread, a first piece given, or a read that fails is
      // the whole fold's.
      try {
        const rows = selectPieceEvents.all(
          owner,
          generation,
          after + 1,
          Number.POSITIVE_INFINITY,
        ) as EventRow[]
        if (rows.length === 0) return held
        let readable = true
        const added = [
          ...persistedEventsFrom(rows, () => {
            readable = false
          }),
        ]
        if (!readable) return null
        if (held.fold === null)
          return added.some((entry) => entry.event.type === 'work_given') ? null : held
        const stalled = new Map(pieceStallOrdinals.get(held.answer))
        const kept: { fold?: PieceFold } = {}
        const answer = derivePieces(owner, added, {
          ...pieceFoldOptions(owner, trackChanges, stalled),
          from: held.fold,
          keep: (at) => {
            kept.fold = at
          },
        })
        if (kept.fold === undefined) return null
        pieceStallOrdinals.set(answer, stalled)
        return { answer, fold: kept.fold }
      } catch {
        return null
      }
    }
  }

  function pieceFoldOptions(owner: string, trackChanges: boolean, stalled: Map<string, number>) {
    const provider = (selectProviderOf.get(owner) as { provider: string } | undefined)?.provider
    const supported =
      provider !== undefined && (SUPPORTED_PROVIDERS as readonly string[]).includes(provider)
        ? (provider as Provider)
        : undefined
    return {
      ...(checkFoldState === undefined
        ? {}
        : {
            checkState: (state: readonly unknown[], complete?: boolean) =>
              checkFoldState([...state, stalled], complete),
          }),
      backgroundWakesIt:
        supported !== undefined && isAvailable(capabilitiesFor(supported).backgroundWake),
      trackChanges,
      onStall: (piece: string, ordinal: number) => stalled.set(piece, ordinal),
      ...(supported === undefined ? {} : { provider: supported }),
    }
  }

  function foldPiecesOfSession(
    owner: string,
    noteSkip?: SkipNote,
    trackChanges = false,
    before?: number,
    keep?: (fold: PieceFold) => void,
    cut?: { readonly before: number; readonly read: (pieces: readonly PieceRow[] | null) => void },
  ): readonly PieceRow[] {
    const generation = activeGeneration(owner)
    const stalled = new Map<string, number>()
    const options = pieceFoldOptions(owner, trackChanges, stalled)
    let complete = true
    const skipped: SkipNote = (ordinal) => {
      complete = false
      noteSkip?.(ordinal)
    }
    return readOrSkip(owner, skipped, [], () => {
      const floor = pieceFoldFloor(owner, generation, options.backgroundWakesIt)
      if (floor === null) {
        cut?.read([])
        return []
      }
      const rows = selectPieceEvents.iterate(
        owner,
        generation,
        floor,
        before ?? Number.POSITIVE_INFINITY,
      ) as Iterable<EventRow>
      const folding = {
        ...options,
        // Told after the last row: a fold that skipped one is never carried forward.
        ...(keep === undefined
          ? {}
          : {
              keep: (at: PieceFold) => {
                if (complete) keep(at)
              },
            }),
      }
      const pieces =
        cut === undefined
          ? derivePieces(owner, persistedEventsFrom(rows, skipped), folding)
          : piecesAtTheCutAndNow(owner, rows, cut.before, folding, skipped, cut.read)
      if (complete) {
        if (before === undefined) pieceStallOrdinals.set(pieces, stalled)
        return pieces
      }
      // A skipped revision can change any piece's condition; absence is unknown on this read.
      return pieces.map(({ definitionOfDone: _condition, ...piece }) => {
        void _condition
        return piece
      })
    })
  }

  function piecesThatDrove(
    owner: string,
    folded: readonly PieceRow[],
    opening: UserTurnEvent | null,
  ): readonly string[] {
    const pieces = folded.filter((one) => one.state === 'working').map((one) => one.piece)
    const root = workSql().rootOwnedBy.get(owner) as WorkDbRow | undefined
    const named =
      opening === null
        ? []
        : theMessagesOf(opening).flatMap((one) => (one.drives === undefined ? [] : [one.drives]))
    if (root !== undefined && (named.length === 0 || named.includes(root.id))) pieces.push(root.id)
    return pieces
  }

  function pieceFoldFloor(
    owner: string,
    generation: number,
    backgroundWakesIt: boolean,
  ): number | null {
    const mayKeep = theFoldsMayBeKept()
    const known = mayKeep ? pieceFoldFloors.get(owner) : undefined
    if (known !== undefined && known.generation === generation) return known.floor
    const first = (
      selectFirstPieceGiven.get(owner, generation) as { ordinal: number | null } | undefined
    )?.ordinal
    if (first === undefined || first === null) return null
    const turn = selectTurnOpenedBefore.get(owner, generation, first) as
      { ordinal: number } | undefined
    const levels = backgroundWakesIt
      ? [
          { type: 'background_work', path: '$.running' },
          { type: 'scheduled_work', path: '$.jobs' },
        ].map(
          (level) =>
            selectLevelStatedBefore.get({ session: owner, generation, before: first, ...level }) as
              { ordinal: number; stated: number } | undefined,
        )
      : []
    const floor = Math.min(
      first,
      ...(turn === undefined ? [] : [turn.ordinal]),
      ...levels.flatMap((level) =>
        level === undefined || level.stated === 0 ? [] : [level.ordinal],
      ),
    )
    if (mayKeep) pieceFoldFloors.set(owner, { generation, floor })
    return floor
  }

  function foldStallsToldToSession(sessionId: string, noteSkip?: SkipNote): ReadonlySet<string> {
    const generation = activeGeneration(sessionId)
    const entries = toPersistedEvents(
      selectStallsTold.all(sessionId, generation, sessionId, generation) as EventRow[],
      noteSkip,
    )
    return readOrSkip(sessionId, noteSkip, new Set<string>(), () => toldIn(entries))
  }

  function toldIn(entries: readonly PersistedEvent[]): ReadonlySet<string> {
    const abandoned = new Set<string>()
    for (const entry of entries) {
      const event = entry.event
      if (event.type !== 'message_unqueued' || event.reason !== 'abandoned') continue
      if (event.messageId === undefined) continue
      abandoned.add(event.messageId)
    }
    const told = new Set<string>()
    for (const entry of entries) {
      const event = entry.event
      if (event.type !== 'work_stall_told') continue
      if (event.messageId !== undefined && abandoned.has(event.messageId)) continue
      told.add(event.piece)
    }
    return told
  }

  function readRaisedQuestions<T>(
    sessionId: string,
    noteSkip: SkipNote | undefined,
    project: (question: RaisedQuestion) => T,
  ): ReadonlyMap<string, T> {
    return readOrSkip(sessionId, noteSkip, new Map<string, T>(), () =>
      wordsIn(
        sessionId,
        selectQuestionsRaised.iterate(
          sessionId,
          activeGeneration(sessionId),
          Number.NEGATIVE_INFINITY,
        ) as Iterable<RaisedQuestionRow>,
        noteSkip,
        project,
      ),
    )
  }

  function piecesGivenBySession(giver: string, unread?: RowsUnread): readonly PieceRow[] {
    return (selectOwnersGivenWorkBy.all(giver) as GivenWorkRow[])
      .flatMap((row) => [...piecesOfSession(row.id, unread?.in(row.id))])
      .filter((piece) => piece.giver === giver)
      .sort((left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1))
  }

  function whatThisConversationIsWaitingOn(
    sessionId: string,
    unread?: RowsUnread,
    work?: WindowOpenWork,
  ): WhatAConversationIsWaitingOn {
    const mine = unread?.in(sessionId)
    const routings = routedRequestsOfSession(sessionId, mine)
    const raised = oneSnapshot
      ? questionStatesInSession(sessionId, mine)
      : questionsRaisedInSession(sessionId, mine)
    return {
      answers: new Set(openQuestionsByWork(routings, raised).keys()),
      aPerson: aPersonOwesAnAnswerIn(routings),
      childrenOpen: new Set(
        (work === undefined
          ? piecesGivenBySession(sessionId, unread).filter((piece) => TASK_IS_OPEN[piece.state])
          : work.givenBy(sessionId, unread)
        ).map((piece) => piece.parent),
      ),
    }
  }

  function oneWaitReadPerHolder(
    unread: RowsUnread,
    work?: WindowOpenWork,
  ): (holder: string) => WhatAConversationIsWaitingOn {
    const held = new Map<string, WhatAConversationIsWaitingOn>()
    return (holder) => {
      const mine = held.get(holder)
      if (mine !== undefined) return mine
      const outstanding = whatThisConversationIsWaitingOn(holder, unread, work)
      held.set(holder, outstanding)
      return outstanding
    }
  }

  return {
    selectOwnersGivenWorkBy,
    selectStallsTold,
    selectStallsToldMoved,
    selectTheDecisionOn,
    selectEveryConversationAndStatus,
    strandedMessageSteps,
    strandedMessages,
    piecesOfSession,
    turnBlockPiecesOfSession,
    stallsToldToSession,
    questionStatesInSession,
    messagesWaitingKept,
    reconciliationCutOrUnread,
    foldReconciliationPieces,
    reconciliationReading,
    reconciliationPiecesKept,
    foldMessagesWaitingIn,
    foldPiecesKept,
    foldPiecesOfSession,
    piecesThatDrove,
    piecesGivenBySession,
    oneWaitReadPerHolder,
  }
}

export type { StrandedMessages }
