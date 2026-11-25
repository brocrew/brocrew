export type { ResumableSession, LiveSessionRow, RecordedSession } from './session-catalogue-read'
import type { EventRow } from './ledger-row-types'
export type { DigestRow, EventRow, PersistedEvent } from './ledger-row-types'
import {
  aStoredObject,
  isAStoredId,
  noteUnreadRow,
  theQuestionItAsks,
  toPersistedEvents,
} from './stored-event-codec'
export { toPersistedEvents } from './stored-event-codec'
export type { WorkRow } from './work-ledger-read'
import { type RowsUnread, rowsUnreadOnce, type SkipNote } from './rows-unread'
import type { QuestionAskedEvent, RoutedRequest } from '../../shared/question-contracts'
import type {
  InstructionProposedEvent,
  InstructionSettledEvent,
  TheQuestionItAsks,
  TranscriptEvent,
} from '../../shared/conversation-events'
export { parseModelChoice, modelChoiceWritten } from './session-store-parts/model-choice-storage'
export { THREAD_LEAD_EVENT_TYPES, type ThreadLeadRow } from './thread-lead-reader'
import type { UserTurnEvent } from '../../shared/human-answer-contracts'
import type { PieceRow } from '../../shared/task-contracts'
import { aConversationTitle, titleFromOpeningMessage } from '../../shared/conversation-title'
import { createSqliteSessionModels } from '../database/sqlite/agents/session-models'
import { createOwnNotesStore } from './own-notes'
import { createMemoryRecoveryStore } from './memory-recovery'
export { createMemoryAmendmentObserver } from './memory-recovery'
import { createMethodChangeStore } from './method-changes'
import { withOptionalIndexes } from './optional-indexes'
import { committedChangesOf } from './committed-changes'
import { searchPastWork, closePastWorkSearch, pastWorkSource } from './past-work-search'

import { serviceRegistrationOf } from '../service-registration'
import { moveOfferOf, moveReceiptOf } from '../../shared/move-request'
import { type SessionReadPhases } from './provider-limit-reader'
export type { SessionReadPhases } from './provider-limit-reader'
import { failureAtTurnEnd } from '../../shared/piece-fold'
import { MAX_TURN_PARTS, theMessagesOf } from '../../shared/runtime-ipc'
import { FOLD_TERM } from './fold-index'
import { ensureQuestionCopies, fillQuestionCopies, questionCopiesReady } from './question-copies'
import { ledgerWritesFor } from './ledger-write-stamp'
import { type SnapshotFoldAnswers } from './ledger-fold-state'

import {
  type AskRow,
  CLOSED_TURNS_FOR_PROVIDER_FAILURE,
  type ClosedTurnRow,
  type ExchangeRow,
  type OpenTurnRow,
  PERSON_LAST_WROTE_WITHIN_TURNS,
  type PieceForAName,
  type ProviderFailureEpisode,
  type ProviderFailureEvidence,
  type WorkDbRow,
} from './session-store-parts/session-store-rows'
import type { SessionStore } from './session-store-parts/session-store-contract'
export {
  MAX_SCHEDULE_HISTORY_WALKED,
  PERSON_LAST_WROTE_WITHIN_TURNS,
} from './session-store-parts/session-store-rows'
export type {
  ResourceRow,
  ResourcePosition,
  KeptFileRow,
  KeptFilesAsked,
  KeptFilesPaged,
  NewSessionRecord,
  WaitingMessage,
  PieceHeld,
  WindowOpenWork,
  ScheduleEvidenceRow,
  ProviderFailureEpisode,
  ProviderFailureEvidence,
  RecordedTurn,
} from './session-store-parts/session-store-rows'
export type { SessionStore } from './session-store-parts/session-store-contract'
export { NULL_SESSION_STORE } from './session-store-parts/null-session-store'

import { aPersonsOwnWords } from '../../shared/a-persons-own-words'
import type { AppDatabase, AppStatement } from './connection'
import { agentIdentityRowId } from './identity'
import {
  composeWhatEachPieceIsWaitingOn,
  TASK_IS_OPEN,
  theWaitItMarks,
  theWorkThatNamesItAmong,
} from '../../shared/tasks'
import { pieceCalled, pieceNumbersOf, type WorkThatNamesIt } from '../../shared/piece-called'
import {
  howWorkStopped,
  whoCancelledIt,
  WHO_STOPPED_IT,
  type AskToStop,
  type LastEndedTurn,
  type StopReading,
  type WhereAnAskLanded,
  type WhoStoppedIt,
} from '../../shared/how-work-stopped'
import {
  PREVIEW_CAP,
  WORDS_CAP,
  capped,
  whatATurnDelivered,
  type ReceivedInATurn,
  type TaskRecordExchange,
  type TranscriptTurn,
  type Words,
} from '../../shared/last-exchange'
import { actedByFrom, type ActedBy } from '../../shared/who-did-it'
import { waitingOnAPerson } from '../../shared/own-instructions'
import { WORK_BRIEF_CHARS } from '../../shared/work-fields'

export type { ForestedConversation, ForestedNode } from './forest-store'

export type { OpenTurn, LeftRunning, TurnAsItEnded } from './turn-evidence-read'
import { createTurnReadsPart } from './session-store-parts/turn-reads'
import { createWorkStatementsPart } from './session-store-parts/work-statements'
import { createLedgerEventsPart } from './session-store-parts/ledger-events'
import { createAgentIdentitiesPart } from './session-store-parts/agent-identities'
import { createPieceFoldsPart } from './session-store-parts/piece-folds'
import { createWorkSettlingPart } from './session-store-parts/work-settling'
import { createWorkGivenPart } from './session-store-parts/work-given'
import { readOrSkip, theFoldIndexHolds } from './session-store-parts/store-helpers'
export {
  aRowADeliveryCanStart,
  eachOrSkipped,
  ledgersSkippedOf,
  mergeDescent,
  readOrSkip,
  ROUTED_REQUEST_EVENT_TYPES,
  skipTheLedger,
  underWhat,
} from './session-store-parts/store-helpers'

export function createSessionStore(
  db: AppDatabase,
  now: () => number = Date.now,
  readPhases?: SessionReadPhases,
  /** Where a new agent's name is drawn from: a number in [0, 1), as `Math.random` gives. */
  random: () => number = Math.random,
  checkFoldState?: (state: readonly unknown[], complete?: boolean) => void,
  oneSnapshot = false,
  snapshotAnswers?: SnapshotFoldAnswers,
): SessionStore {
  const connection = db
  // Installed before any transaction on this connection is made, so every one is framed.
  const committed = committedChangesOf(connection)
  ensureQuestionCopies(connection)
  const ownNotesStore = createOwnNotesStore(connection)
  const methodChangeStore = createMethodChangeStore(connection, now)
  const memoryRecoveryStore = createMemoryRecoveryStore(connection, now)
  const ledgerWrites = ledgerWritesFor(connection)
  db = withOptionalIndexes(db)
  const turnReads = createTurnReadsPart({
    db,
    oneSnapshot,
    checkFoldState,
    snapshotAnswers,
    committed,
    connection,
    ledgerWrites,
  })
  const {
    activeGeneration,
    foldQuestionsRaisedInSession,
    foldRoutedRequestsOfSession,
    namedByAPiece,
    questionsRaisedInSession,
    routedRequestsOfSession,
    selectAProviderTurnsOpening,
    selectMaxOrdinal,
    selectOpenTurn,
    selectQuestionsRaised,
    selectQuestionsRaisedMoved,
    selectRoutedRequestEvents,
    selectRoutedRequestEventsAfter,
    selectTheTurnsOpening,
    theFoldsMayBeKept,
    theKeptOnly,
  } = turnReads
  const workStatements = createWorkStatementsPart({
    ...turnReads,
    db,
    now,
    random,
    oneSnapshot,
    committed,
    connection,
  })
  const {
    chainUp,
    namesRead,
    newestLineAbout,
    retitlesOf,
    titleNow,
    workRowFrom,
    workRowWalked,
    workSql,
  } = workStatements
  const ledgerEvents = createLedgerEventsPart({
    ...turnReads,
    ...workStatements,
    db,
    now,
    committed,
    connection,
    ledgerWrites,
  })
  const { firstPersonOpening } = ledgerEvents
  const agentIdentities = createAgentIdentitiesPart({
    ...turnReads,
    ...workStatements,
    ...ledgerEvents,
    db,
    now,
    memoryRecoveryStore,
    methodChangeStore,
  })
  const {
    selectNewestTurnsOpened,
    selectPieceEvents,
    workerGiverContains,
    workerInItsPlace,
    workerReplacementChain,
    workersBorn,
  } = agentIdentities
  const pieceFolds = createPieceFoldsPart({
    ...turnReads,
    ...workStatements,
    ...ledgerEvents,
    ...agentIdentities,
    db,
    oneSnapshot,
    checkFoldState,
  })
  const {
    foldPiecesKept,
    foldPiecesOfSession,
    oneWaitReadPerHolder,
    piecesOfSession,
    questionStatesInSession,
    selectStallsTold,
    selectStallsToldMoved,
    selectTheDecisionOn,
    turnBlockPiecesOfSession,
  } = pieceFolds
  const workSettling = createWorkSettlingPart({
    ...turnReads,
    ...workStatements,
    ...ledgerEvents,
    ...pieceFolds,
    db,
    readPhases,
    oneSnapshot,
    committed,
    connection,
  })
  const { selectServiceBorn, selectServicesBorn } = workSettling
  const workGiven = createWorkGivenPart({
    ...turnReads,
    ...workStatements,
    ...agentIdentities,
    ...pieceFolds,
    db,
    oneSnapshot,
    committed,
    ledgerWrites,
  })

  const sessionModels = createSqliteSessionModels(db, now)
  const selectLastClosedTurn = db.prepare(
    `SELECT id, opened_at, closed_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectClosedTurnsForProviderFailure = db.prepare(
    `SELECT id FROM turn
       WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
       ORDER BY ordinal DESC LIMIT ?`,
  )
  const selectTurnBlockCandidates = db.prepare(
    `SELECT id AS piece, owner_session_id AS owner FROM work
      WHERE given_by_session_id = ?
        AND (? IS NULL OR (created_at, id) < (SELECT created_at, id FROM work WHERE id = ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
  const selectTurnBlockInstructions = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal, json_valid(payload) AS readable, payload
       FROM events WHERE session_id = ? AND type IN ('instruction_proposed', 'instruction_settled')
       ORDER BY created_at, ordinal`,
  )
  const selectWhoRoutedToWhom = db.prepare(
    `SELECT DISTINCT session_id AS asker,
            CASE WHEN json_valid(payload) THEN json_extract(payload, '$.parent') END AS parent
       FROM events INDEXED BY events_request_routed_idx
      WHERE type = 'request_routed'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.to') END IS NOT 'a-person'`,
  )
  /** {@link SessionStore.conversationsHoldingACopyOf}'s conversations. */
  const selectConversationsHoldingACopyOf = db.prepare(
    `SELECT DISTINCT session_id AS id FROM events
      WHERE type = 'question_asked'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.passedUpFrom') END = ?
      ORDER BY session_id`,
  )
  /** The same conversations, by the copies' key, each checked against its ledger row. */
  let selectConversationsByCopy: AppStatement | undefined
  const selectLatestMoveOffer = db.prepare(
    `SELECT payload FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'question_asked'
        AND CASE WHEN json_valid(payload) THEN json_type(payload, '$.move') END = 'object'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTheRequestRouted = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
        INDEXED BY events_session_ordinal_uq
      WHERE session_id = @session AND generation = @generation
        AND type IN ('permission_request', 'user_input_request')
        AND ordinal < (SELECT max(ordinal) FROM events
                          INDEXED BY events_request_routed_idx
                        WHERE session_id = @session AND type = 'request_routed'
                          AND generation = @generation
                          AND CASE WHEN json_valid(payload)
                                THEN json_extract(payload, '$.requestId') END = @request)
      ORDER BY ordinal DESC LIMIT 1`,
  )
  for (const read of [
    selectPieceEvents,
    selectStallsTold,
    selectStallsToldMoved,
    selectRoutedRequestEvents,
    selectRoutedRequestEventsAfter,
    selectQuestionsRaised,
    selectQuestionsRaisedMoved,
    selectTheDecisionOn,
  ]) {
    theFoldIndexHolds(read)
  }
  const selectLastTurnEndingEvents = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_turn_idx
      WHERE session_id = ? AND generation = ?
        AND type IN ('turn', 'error', 'work_interrupted', 'user_decision')
        AND turn_id = (SELECT id FROM turn
                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
                        ORDER BY ordinal DESC LIMIT 1)
      ORDER BY ordinal`,
  )
  const selectProviderFailureTurnEnd = db.prepare(
    `SELECT type, ordinal, payload, created_at FROM events INDEXED BY events_turn_idx
       WHERE session_id = ? AND generation = ? AND turn_id = ?
         AND (type IN ('turn', 'work_interrupted')
           OR (type = 'user_decision' AND CASE WHEN json_valid(payload)
             THEN json_extract(payload, '$.outcome') = 'cancel' ELSE 1 END))
       ORDER BY ordinal LIMIT ?`,
  )
  const selectOpeningBeforeFailureTurn = db.prepare(
    `SELECT ordinal FROM events
       WHERE session_id = ? AND generation = ? AND ordinal < ? AND turn_id IS NOT ?
         AND type IN ('user_turn', 'provider_turn')
       ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectSentBeforeFailureOpening = db.prepare(
    `SELECT ordinal, payload FROM events INDEXED BY events_fold_idx
       WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'message_unqueued'
         AND ordinal > ? AND ordinal < ?
         AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.reason') = 'sent'
                  ELSE 1 END
       ORDER BY ordinal LIMIT ?`,
  )
  theFoldIndexHolds(selectSentBeforeFailureOpening)
  const selectQueueRowForFailure = db.prepare(
    `SELECT payload FROM events INDEXED BY events_kind_owner_idx
       WHERE type = 'message_queued' AND session_id = ? AND generation = ? AND ordinal < ?
         AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') = ? END
       ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectRequestsTheLastClosedTurnInterrupted = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END AS request
       FROM events INDEXED BY events_turn_idx
      WHERE session_id = ? AND generation = ? AND type = 'request_interrupted'
        AND turn_id = (SELECT id FROM turn
                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
                        ORDER BY ordinal DESC LIMIT 1)
      ORDER BY ordinal`,
  )
  const MAIN_THREAD_WORDS = `(type = 'assistant_message'
        AND CASE WHEN json_valid(payload)
                 THEN json_extract(payload, '$.parentToolCallId') IS NULL
                 ELSE 1
            END)`
  const selectReplyQuestion = db.prepare(
    `SELECT json_valid(payload) AS readable,
       CASE WHEN json_valid(payload) THEN
         CASE WHEN json_type(payload, '$.text') = 'text'
           THEN substr(rtrim(json_extract(payload, '$.text'), ?), -1) = '?' ELSE NULL END
         ELSE NULL END AS question
       FROM events WHERE turn_id = ? AND ${MAIN_THREAD_WORDS} ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectPersonRequestInTurn = db.prepare(
    `SELECT 1 FROM events WHERE turn_id = ? AND (
       type IN ('permission_request', 'instruction_proposed', 'mcp_server_requested') OR
       (type = 'request_routed' AND CASE WHEN json_valid(payload)
         THEN json_extract(payload, '$.to') = 'a-person' ELSE 1 END)) LIMIT 1`,
  )
  const selectClosedTurnReason = db.prepare('SELECT end_reason FROM turn WHERE id = ?')
  const selectNewestReceived = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'user_turn'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectFirstReceived = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = @conversation AND generation = @generation AND type = 'user_turn'
      ORDER BY ordinal ASC LIMIT 1`,
  )
  const selectNewestAnswerAfter = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ${MAIN_THREAD_WORDS}
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectReceivedStartsBack = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type IN ('user_turn', 'provider_turn')
      ORDER BY ordinal DESC LIMIT ?`,
  )
  const selectNextReceivedAfter = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type IN ('user_turn', 'provider_turn')
        AND ordinal > ?
      ORDER BY ordinal ASC LIMIT 1`,
  )
  const selectWhatEndedBefore = db.prepare(
    `SELECT json_extract(payload, '$.ended.summary') AS summary FROM events
      WHERE session_id = @session AND generation = @generation AND type = 'background_work'
        AND ordinal < @before
        AND ordinal > coalesce((SELECT ordinal FROM events
                                 WHERE session_id = @session AND generation = @generation
                                   AND type IN ('turn', 'user_turn', 'provider_turn', 'reopened')
                                   AND ordinal < @before
                                 ORDER BY ordinal DESC LIMIT 1), -1)
        AND json_valid(payload) AND json_type(payload, '$.ended.summary') = 'text'
      ORDER BY ordinal ASC`,
  )
  const selectAProviderTurnAfter = db.prepare(
    `SELECT 1 AS began FROM events
      WHERE session_id = ? AND generation = ? AND type = 'provider_turn' AND ordinal > ?
      LIMIT 1`,
  )
  const selectExchangeRowsBetween = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ?
        AND (type IN ('user_turn', 'provider_turn') OR ${MAIN_THREAD_WORDS})
      ORDER BY ordinal ASC`,
  )
  const selectSearchTurnStarts = db.prepare(
    `SELECT DISTINCT (SELECT MAX(u.ordinal) FROM events u
                       WHERE u.session_id = e.session_id AND u.generation = e.generation
                         AND u.type IN ('user_turn', 'provider_turn')
                         AND u.ordinal <= e.ordinal) AS start
      FROM events e
      WHERE e.session_id = ? AND e.generation = ? AND json_valid(e.payload)
        AND (e.type = 'user_turn' OR (e.type = 'assistant_message'
             AND json_extract(e.payload, '$.parentToolCallId') IS NULL))
        AND instr(lower(json_extract(e.payload, '$.text')), ?) > 0
        AND start IS NOT NULL
      ORDER BY start DESC LIMIT ?`,
  )
  const selectLastAskToStop = db.prepare(
    `SELECT payload, created_at, turn_id, type, ordinal FROM (
       SELECT * FROM (
         SELECT payload, created_at, turn_id, type, ordinal FROM events
          WHERE type = 'work_interrupted' AND session_id = @session AND generation = @generation
            AND json_valid(payload)
          ORDER BY ordinal DESC LIMIT 1
       )
       UNION ALL
       SELECT * FROM (
         SELECT payload, created_at, turn_id, type, ordinal FROM events
          WHERE type = 'user_decision' AND session_id = @session AND generation = @generation
            AND CASE WHEN json_valid(payload) THEN
              json_extract(payload, '$.outcome') = 'cancel'
              AND json_type(payload, '$.stopsNothing') IS NOT 'true' ELSE 0 END
          ORDER BY ordinal DESC LIMIT 1
       )
     ) ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTornAsksAfter = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal > ?
        AND type IN ('work_interrupted', 'user_decision')
        AND NOT json_valid(payload)`,
  )
  const selectLastExplicitStopOnTurn = db.prepare(
    `SELECT payload, created_at, turn_id, type, ordinal FROM events
      WHERE type = 'work_interrupted' AND session_id = ? AND generation = ? AND turn_id = ?
        AND CASE WHEN json_valid(payload) THEN
          json_extract(payload, '$.by') = 'an-agent'
          AND json_type(payload, '$.agent') = 'text'
          AND json_type(payload, '$.reason') = 'text' ELSE 0 END
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectSessionsRoutingTo = db.prepare(
    `SELECT DISTINCT routed.session_id AS id,
            CASE WHEN routed.readable THEN NULL ELSE routed.ordinal END AS unreadAt
       FROM (SELECT session_id, generation, ordinal, type,
                    json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload
               FROM events) routed
      WHERE routed.type = 'request_routed'
        AND (json_extract(routed.payload, '$.parent') = ?
             OR (NOT routed.readable
                 AND routed.generation = coalesce((SELECT active FROM derived_generation g
                                                    WHERE g.session_id = routed.session_id), 0)))`,
  )
  const piecesKeptOnly = theKeptOnly(foldPiecesKept)
  const piecesAtHand = (owner: string) => piecesKeptOnly(owner)?.answer ?? null
  const routedRequestsKeptOnly = theKeptOnly(foldRoutedRequestsOfSession)
  const routedRequestsAtHand = (sessionId: string) =>
    routedRequestsKeptOnly(sessionId)?.answer ?? null
  const questionsRaisedAtHand = theKeptOnly(foldQuestionsRaisedInSession)
  function piecesForAName(
    conversation: string,
    generation: number,
    unread: RowsUnread | undefined,
  ): readonly PieceForAName[] {
    return heldForAName(conversation, generation, unread).pieces
  }

  /** {@link piecesForAName}, and its newest open piece when the fold reads it as waiting on purpose. */
  function heldForAName(
    conversation: string,
    generation: number,
    unread: RowsUnread | undefined,
  ): {
    readonly pieces: readonly PieceForAName[]
    readonly waiting: PieceRow | null
  } {
    const mayKeep = theFoldsMayBeKept()
    const through =
      (selectMaxOrdinal.get(conversation, generation) as { max_ordinal: number | null } | undefined)
        ?.max_ordinal ?? null
    const known = mayKeep ? namedByAPiece.get(conversation) : undefined
    if (known !== undefined && known.generation === generation && known.through === through) {
      return known
    }
    const missed = rowsUnreadOnce()
    const folded = piecesOfSession(conversation, (ordinal) => {
      missed.in(conversation)(ordinal)
      unread?.in(conversation)(ordinal)
    })
    const newestOpen = folded.filter((piece) => TASK_IS_OPEN[piece.state]).at(-1)
    const waiting = newestOpen?.state === 'waiting-on-purpose' ? newestOpen : null
    const pieces = folded.map(
      ({ piece, label, title, owner, giver, givenAt, state, outcome, endedAt }): PieceForAName => ({
        piece,
        label,
        title,
        owner,
        giver,
        givenAt,
        state,
        outcome,
        endedAt,
      }),
    )
    if (mayKeep && missed.count === 0 && missed.ledgersSkipped === 0) {
      namedByAPiece.set(conversation, { generation, through, pieces, waiting })
    }
    return { pieces, waiting }
  }

  function doneConditionOfRoot(root: WorkDbRow): string | null {
    const found = workSql().doneCondition.get(
      root.owner_session_id,
      activeGeneration(root.owner_session_id),
      root.id,
    ) as { payload: string } | undefined
    if (found === undefined) return null
    const payload = aStoredObject(found.payload)
    if (
      payload?.type !== 'work_rebriefed' ||
      payload.piece !== root.id ||
      typeof payload.definitionOfDone !== 'string' ||
      payload.definitionOfDone.length > WORK_BRIEF_CHARS ||
      payload.definitionOfDone.trim() === ''
    )
      throw new Error('unread done condition')
    return payload.definitionOfDone
  }

  function theRootThatNames(conversation: string, generation: number): WorkThatNamesIt | null {
    const root = workSql().rootOwnedBy.get(conversation) as WorkDbRow | undefined
    return root === undefined
      ? null
      : {
          label: pieceCalled([root.number]),
          title: titleNow(root, generation),
          definitionOfDone: doneConditionOfRoot(root),
        }
  }

  function theWorkThatNamesNow(
    conversation: string,
    unread: RowsUnread | undefined,
  ): WorkThatNamesIt | null {
    const generation = activeGeneration(conversation)
    return (
      theRootThatNames(conversation, generation) ??
      theWorkThatNamesItAmong(piecesForAName(conversation, generation, unread))
    )
  }

  function lastEndedTurnOf(sessionId: string, noteSkip?: SkipNote): LastEndedTurn | null {
    const generation = activeGeneration(sessionId)
    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    if (closed === undefined) return null
    const since: LastEndedTurn['since'] =
      (selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined) === undefined
        ? 'nothing-has-started-since'
        : 'a-turn-is-running-now'
    const rows = selectLastTurnEndingEvents.all(
      sessionId,
      generation,
      sessionId,
      generation,
    ) as EventRow[]
    const nothingHasSaid: StopReading = { how: 'nothing-has-said', who: null, asker: null }
    const reading: StopReading =
      rows.length === 0
        ? nothingHasSaid
        : readOrSkip(sessionId, noteSkip, nothingHasSaid, () =>
            howWorkStopped(toPersistedEvents(rows, noteSkip)),
          )
    const byItsProvider = selectAProviderTurnsOpening.get(closed.id) !== undefined
    return {
      ...reading,
      startedAt: closed.opened_at,
      endedAt: closed.closed_at,
      since,
      ...(byItsProvider ? { startedByItsProvider: true as const } : {}),
    }
  }

  function questionsInFailedTurn(
    sessionId: string,
    generation: number,
    turnId: string,
    opening: ExchangeRow,
    turn: UserTurnEvent,
  ): readonly TheQuestionItAsks[] {
    const before = selectOpeningBeforeFailureTurn.get(
      sessionId,
      generation,
      opening.ordinal,
      turnId,
    ) as { ordinal: number } | undefined
    const sent = selectSentBeforeFailureOpening.all(
      sessionId,
      generation,
      before?.ordinal ?? -1,
      opening.ordinal,
      MAX_TURN_PARTS + 1,
    ) as { ordinal: number; payload: string }[]
    const parts = theMessagesOf(turn)
    if (parts.length === 0 || (turn.parts !== undefined && turn.parts.length !== parts.length))
      throw new Error('the failed turn parts could not be read')
    if (sent.length === 0) return []

    // A flush records sent rows and then the opening parts in the same order.
    if (sent.length !== parts.length)
      throw new Error('the failed turn could not be matched to its queued input')

    const asks: TheQuestionItAsks[] = []
    for (const [index, row] of sent.entries()) {
      const ending = aStoredObject(row.payload)
      const messageId = ending?.['messageId']
      if (ending?.['type'] !== 'message_unqueued' || !isAStoredId(messageId))
        throw new Error('a sent message from the failed turn could not be read')
      const found = selectQueueRowForFailure.get(sessionId, generation, row.ordinal, messageId) as
        { payload: string } | undefined
      const queued = aStoredObject(found?.payload ?? null)
      if (queued?.['type'] !== 'message_queued')
        throw new Error('the queued message for the failed turn could not be read')
      if (queued['kind'] !== 'question') continue
      const ask = theQuestionItAsks(queued['asks'])?.asks
      if (ask === undefined || ask.asker !== parts[index]?.relayedFrom)
        throw new Error('the question could not be matched to the failed turn')
      asks.push(ask)
    }
    return asks
  }

  function providerFailureEpisodeOf(
    sessionId: string,
    unread?: RowsUnread,
    evidence?: ProviderFailureEvidence,
  ): ProviderFailureEpisode {
    const noteSkip = unread?.in(sessionId) ?? (() => {})
    return readOrSkip<ProviderFailureEpisode>(sessionId, noteSkip, 'unknown', () => {
      const generation = activeGeneration(sessionId)
      const turns = selectClosedTurnsForProviderFailure.all(
        sessionId,
        generation,
        CLOSED_TURNS_FOR_PROVIDER_FAILURE,
      ) as { id: string }[]
      for (const { id } of turns) {
        const opening = selectTheTurnsOpening.get(id, sessionId, generation) as
          ExchangeRow | undefined
        if (opening === undefined) continue
        const turn = aStoredObject(opening.payload)
        if (turn?.['type'] !== 'user_turn' || typeof turn['text'] !== 'string')
          throw new Error('the failed turn opening could not be read')

        const rows = selectProviderFailureTurnEnd.all(
          sessionId,
          generation,
          id,
          MAX_TURN_PARTS + 1,
        ) as (EventRow & { type: TranscriptEvent['type'] })[]
        if (rows.length > MAX_TURN_PARTS) {
          if (evidence !== undefined) evidence.exceededPartLimit = MAX_TURN_PARTS
          return 'unknown'
        }
        const entries = toPersistedEvents(rows, noteSkip)
        if (
          entries.length !== rows.length ||
          entries.some((entry, index) => entry.event.type !== rows[index]?.type)
        )
          return 'unknown'
        const terminalAt = entries.findIndex(({ event }) => event.type === 'turn')
        const terminal = entries[terminalAt]
        if (terminal?.event.type !== 'turn') continue
        const raw = aStoredObject(rows[terminalAt]?.payload ?? null)
        const state = raw?.['state']
        if (
          (state !== 'failed' && state !== 'completed' && state !== 'interrupted') ||
          entries.slice(terminalAt + 1).some(({ event }) => event.type === 'turn') ||
          (state === 'failed' &&
            raw?.['providerFailure'] !== undefined &&
            terminal.event.providerFailure === undefined)
        )
          throw new Error('the recorded terminal could not be read')

        if (evidence !== undefined) evidence.checkedTurnEndings++
        const failure = failureAtTurnEnd(terminal.event, terminal.ordinal)
        if (failure === undefined) continue
        if (failure === null) {
          if (howWorkStopped(entries).who === null) return 'none'
          continue
        }
        const { turnOrdinal: terminalOrdinal, ...cause } = failure
        const asks = questionsInFailedTurn(
          sessionId,
          generation,
          id,
          opening,
          turn as unknown as UserTurnEvent,
        )
        return { generation, terminalOrdinal, turnId: id, cause, asks }
      }
      return turns.length === CLOSED_TURNS_FOR_PROVIDER_FAILURE ? 'unknown' : 'none'
    })
  }

  function whatOpenedTheLastEndedTurn(sessionId: string): ReceivedInATurn | null {
    const generation = activeGeneration(sessionId)
    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    if (closed === undefined) return null
    const row = selectTheTurnsOpening.get(closed.id, sessionId, generation) as
      ExchangeRow | undefined
    return row === undefined ? null : receivedOn(sessionId, row, PREVIEW_CAP)
  }

  function replyQuestionWithoutARequest(conversation: string): string | null {
    const generation = activeGeneration(conversation)
    const closed = selectLastClosedTurn.get(conversation, generation) as ClosedTurnRow | undefined
    if (
      closed === undefined ||
      (selectClosedTurnReason.get(closed.id) as { end_reason: string }).end_reason !== 'completed'
    )
      return null
    const opening = selectTheTurnsOpening.get(closed.id, conversation, generation) as
      ExchangeRow | undefined
    if (opening === undefined) return null
    const received = receivedOn(conversation, opening, 0)
    if (![received, ...(received.cameWith ?? [])].some((one) => one.from.is === 'a-person'))
      return null
    if (selectPersonRequestInTurn.get(closed.id) !== undefined) return null
    const tail = selectReplyQuestion.get(
      ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
      closed.id,
    ) as { readable: number; question: number | null } | undefined
    return tail?.readable === 1 && tail.question === 1 ? closed.id : null
  }

  function wordsOf(sessionId: string, row: ExchangeRow, cap = WORDS_CAP): Words {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { unreadable: true }
    }
    // ⚠️ Cast to `unknown`-shaped and CHECKED — a ledger written by another build can hold anything.
    const said = JSON.parse(row.payload) as { text?: unknown }
    return capped(typeof said.text === 'string' ? said.text : '', cap)
  }

  function receivedOn(sessionId: string, row: ExchangeRow, cap = WORDS_CAP): ReceivedInATurn {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { from: { is: 'unreadable' }, words: { unreadable: true } }
    }
    return whatATurnDelivered(JSON.parse(row.payload) as UserTurnEvent, cap)
  }

  function lastExchangeIn(sessionId: string, cap = WORDS_CAP): TaskRecordExchange {
    const generation = activeGeneration(sessionId)
    const got = selectNewestReceived.get(sessionId, generation) as ExchangeRow | undefined
    if (got === undefined) return { exchange: { received: null, answer: null }, revision: '' }
    const back = selectNewestAnswerAfter.get(sessionId, generation, got.ordinal) as
      ExchangeRow | undefined
    const sinceThen = selectAProviderTurnAfter.get(sessionId, generation, got.ordinal) !== undefined
    return {
      revision: JSON.stringify([generation, got.ordinal, back?.ordinal, sinceThen]),
      exchange: {
        received: receivedOn(sessionId, got, cap),
        answer: back === undefined ? null : wordsOf(sessionId, back, cap),
        ...(sinceThen ? { sinceThenItsProviderStartedATurn: true as const } : {}),
      },
    }
  }

  function turnFrom(
    sessionId: string,
    generation: number,
    rows: readonly ExchangeRow[],
  ): TranscriptTurn | null {
    const [first, ...rest] = rows
    if (first === undefined) return null
    const said = rest.map((row) => wordsOf(sessionId, row))
    const texts = said.flatMap((one) => ('text' in one && one.text !== '' ? [one.text] : []))
    const words: Words | null =
      said.length === 0
        ? null
        : texts.length === 0 && said.some((one) => 'unreadable' in one)
          ? { unreadable: true }
          : capped(texts.join('\n\n'), WORDS_CAP)
    if (first.type === 'provider_turn') {
      const ended = selectWhatEndedBefore.all({
        session: sessionId,
        generation,
        before: first.ordinal,
      }) as { summary: string }[]
      return {
        at: first.ordinal,
        startedByItsProvider: { after: ended.map((one) => one.summary) },
        said: words,
      }
    }
    if (first.type !== 'user_turn') return null
    return { at: first.ordinal, received: receivedOn(sessionId, first), said: words }
  }

  function turnRows(sessionId: string, generation: number, from: number, until: number) {
    return selectExchangeRowsBetween.all(sessionId, generation, from, until) as ExchangeRow[]
  }

  function transcriptOf(
    sessionId: string,
    read: { readonly back: number; readonly search: string | null },
  ): { readonly turns: readonly TranscriptTurn[]; readonly older: boolean } {
    const generation = activeGeneration(sessionId)
    const back = Math.max(1, Math.floor(read.back))
    const end = Number.MAX_SAFE_INTEGER
    const nextStart = (after: number): number =>
      (selectNextReceivedAfter.get(sessionId, generation, after) as { ordinal: number } | undefined)
        ?.ordinal ?? end
    const starts: number[] = []
    if (read.search === null) {
      const newest = selectReceivedStartsBack.all(sessionId, generation, back + 1) as {
        ordinal: number
      }[]
      starts.push(...newest.slice(0, back).map((one) => one.ordinal))
      const turns = [...starts]
        .reverse()
        .map((start) =>
          turnFrom(sessionId, generation, turnRows(sessionId, generation, start, nextStart(start))),
        )
        .filter((one): one is TranscriptTurn => one !== null)
      return { turns, older: newest.length > back }
    }
    const found = selectSearchTurnStarts.all(
      sessionId,
      generation,
      read.search.toLowerCase(),
      back + 1,
    ) as { start: number }[]
    starts.push(...found.map((one) => one.start))
    const turns = starts
      .slice(0, back)
      .reverse()
      .map((start) =>
        turnFrom(sessionId, generation, turnRows(sessionId, generation, start, nextStart(start))),
      )
      .filter((one): one is TranscriptTurn => one !== null)
    return { turns, older: starts.length > back }
  }

  function actorOfTheAsk(row: AskRow): Pick<AskToStop, 'by' | 'asker' | 'reason'> | null {
    const asked = JSON.parse(row.payload) as { by?: unknown; agent?: unknown; reason?: unknown }
    if (row.type === 'user_decision') return whoCancelledIt(asked.by as ActedBy | undefined)
    if (!(WHO_STOPPED_IT as readonly unknown[]).includes(asked.by)) return null
    const by = asked.by as WhoStoppedIt
    return {
      by,
      asker: by === 'an-agent' && typeof asked.agent === 'string' ? asked.agent : null,
      ...(typeof asked.reason === 'string' ? { reason: asked.reason } : {}),
    }
  }

  function lastAskToStopOf(
    sessionId: string,
    noteSkip?: SkipNote,
    source?: 'work_interrupted',
  ): AskToStop | null {
    const generation = activeGeneration(sessionId)
    const row = selectLastAskToStop.get({ session: sessionId, generation }) as AskRow | undefined
    for (const torn of selectTornAsksAfter.all(sessionId, generation, row?.ordinal ?? -1) as {
      ordinal: number
    }[]) {
      noteUnreadRow(sessionId, torn.ordinal, noteSkip)
    }
    if (row === undefined || (source !== undefined && row.type !== source)) return null
    const asked = readOrSkip(sessionId, noteSkip, null, () => actorOfTheAsk(row))
    if (asked === null) return null
    // Each turn is read only when the answer turns on it: the open one can be a long walk.
    const closed = () =>
      selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    const open = () => selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    const turn: WhereAnAskLanded =
      row.turn_id === null
        ? 'no-turn-was-running'
        : row.turn_id === closed()?.id
          ? 'the-turn-that-ended-last'
          : row.turn_id === open()?.id
            ? 'a-turn-that-is-running-now'
            : 'a-turn-that-ended-earlier'
    return { ...asked, at: row.created_at, turn }
  }

  return {
    ...ownNotesStore,
    ...turnReads.methods,
    ...workStatements.methods,
    ...ledgerEvents.methods,
    ...agentIdentities.methods,
    ...workSettling.methods,
    ...workGiven.methods,
    ...sessionModels,

    workById(piece) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      return row === undefined ? null : workRowWalked(row)
    },

    activityWorkNames(pieces) {
      const named = new Map<string, { label: string; title: string | null } | null>()
      const owners = new Map<string, WorkDbRow[]>()
      for (const id of new Set(pieces)) {
        try {
          const row = workSql().byId.get(id) as WorkDbRow | undefined
          if (row === undefined) {
            named.set(id, null)
            continue
          }
          const group = owners.get(row.owner_session_id) ?? []
          group.push(row)
          owners.set(row.owner_session_id, group)
        } catch {
          named.set(id, null)
        }
      }
      for (const [owner, rows] of owners) {
        try {
          const generation = activeGeneration(owner)
          const titles = retitlesOf(owner, generation)
          for (const row of rows) {
            named.set(row.id, {
              label: workRowWalked(row).label,
              title: titleNow(row, generation, (one) => titles.get(one.id) ?? null),
            })
          }
        } catch {
          for (const row of rows) named.set(row.id, null)
        }
      }
      return named
    },

    workByLabel(label) {
      const numbers = pieceNumbersOf(label)
      if (numbers === null) return null
      const [first, ...below] = numbers
      if (first === undefined) return null
      let row = workSql().rootNumbered.get(first) as WorkDbRow | undefined
      for (const number of below) {
        if (row === undefined) return null
        row = workSql().childNumbered.get(row.id, number) as WorkDbRow | undefined
      }
      return row === undefined ? null : workRowFrom(row, numbers)
    },

    firstTaskOf(conversation) {
      const row = workSql().firstOwnedBy.get(conversation) as WorkDbRow | undefined
      if (row === undefined) return null
      return { piece: row.id, label: workRowWalked(row).label }
    },

    defaultConversationTitle(conversation, includeOpening = false) {
      const sql = workSql()
      const generation = activeGeneration(conversation)
      const root = sql.rootOwnedBy.get(conversation) as WorkDbRow | undefined
      const rootTitle = root === undefined ? null : aConversationTitle(titleNow(root, generation))
      if (rootTitle !== null) return rootTitle
      const first = sql.firstNonRootOwnedBy.get(conversation) as WorkDbRow | undefined
      const taskTitle = first === undefined ? null : aConversationTitle(titleNow(first, generation))
      if (taskTitle !== null) return taskTitle
      if (!includeOpening || root === undefined) return null
      const opening = firstPersonOpening(conversation, generation)
      return opening === null ? null : titleFromOpeningMessage(opening)
    },

    rootOf(conversation) {
      const row = workSql().rootOwnedBy.get(conversation) as WorkDbRow | undefined
      return row === undefined ? null : workRowFrom(row, [row.number])
    },

    workersBorn,
    workerGiverContains,
    workerInItsPlace,
    workerLineage: workerReplacementChain,

    serviceBorn(conversation) {
      return selectServiceBorn.get(conversation) !== undefined
    },

    servicesBorn() {
      const rows = selectServicesBorn.all() as {
        id: string
        identity: string | null
        incarnation: number | null
        parent: string | null
        created: number
        birth: string | null
      }[]
      return rows.map(({ id, identity, incarnation, parent, created, birth }) => {
        const registration = birth === null ? null : serviceRegistrationOf(aStoredObject(birth))
        const conflicted =
          birth !== null &&
          (registration === null ||
            registration.identity !== identity ||
            registration.identityCreatedAt !== incarnation ||
            registration.identityCreatedAt > created ||
            parent !== null)
        return {
          conversation: id,
          identity,
          ...(conflicted
            ? { conflicted: true as const }
            : registration === null
              ? {}
              : { identityCreatedAt: registration.identityCreatedAt }),
        }
      })
    },

    rootDoneCondition(root) {
      const row = workSql().byId.get(root) as WorkDbRow | undefined
      if (row === undefined || row.parent_id !== null) throw new Error('unread root')
      return doneConditionOfRoot(row)
    },

    rootLines(root) {
      const row = workSql().byId.get(root) as WorkDbRow | undefined
      if (row === undefined || row.parent_id !== null) return { title: null, statusLine: null }
      const generation = activeGeneration(row.owner_session_id)
      const statusSet = newestLineAbout(row, generation, 'work_status_set')
      return {
        title: titleNow(row, generation),
        statusLine:
          typeof statusSet?.line === 'string' &&
          typeof statusSet.by === 'string' &&
          typeof statusSet.at === 'number'
            ? {
                text: statusSet.line,
                by: statusSet.by,
                at: statusSet.at,
                revision: statusSet.revision as number,
                ...theWaitItMarks(statusSet),
              }
            : null,
      }
    },

    turnBlockRootLines(root) {
      const row = workSql().byId.get(root) as WorkDbRow | undefined
      if (row === undefined || row.parent_id !== null) return null
      const generation = activeGeneration(row.owner_session_id)
      const read = (type: 'work_retitled' | 'work_status_set') => {
        const found = workSql().turnRootLine.get(row.owner_session_id, generation, type, root) as
          { payload: string; created_at: number; ordinal: number } | undefined
        if (found === undefined) return { kind: 'absent' as const }
        const payload = aStoredObject(found.payload)
        if (payload?.piece !== root || payload.type !== type) return { kind: 'unread' as const }
        return { kind: 'present' as const, payload, at: found.created_at, revision: found.ordinal }
      }
      const title = read('work_retitled')
      const status = read('work_status_set')
      if (title.kind === 'unread' || status.kind === 'unread') return null
      if (title.kind === 'present' && typeof title.payload.title !== 'string') return null
      if (row.title !== null && typeof row.title !== 'string') return null
      if (
        status.kind === 'present' &&
        (typeof status.payload.line !== 'string' ||
          typeof status.payload.by !== 'string' ||
          typeof status.at !== 'number')
      )
        return null
      return {
        title: title.kind === 'present' ? (title.payload.title as string) : row.title,
        statusLine:
          status.kind === 'present'
            ? {
                text: status.payload.line as string,
                by: status.payload.by as string,
                at: status.at,
                revision: status.revision,
              }
            : null,
      }
    },

    workThatNames(conversation, unread) {
      return theWorkThatNamesNow(conversation, unread)
    },

    workThatNamesAndItsWait(conversation, unread, folded) {
      const generation = activeGeneration(conversation)
      const held =
        folded === undefined
          ? heldForAName(conversation, generation, unread)
          : {
              pieces: folded,
              waiting: folded.filter((piece) => TASK_IS_OPEN[piece.state]).at(-1) ?? null,
            }
      return {
        named: theRootThatNames(conversation, generation) ?? theWorkThatNamesItAmong(held.pieces),
        waitingOnPurpose: held.waiting?.state === 'waiting-on-purpose' ? held.waiting : null,
      }
    },

    workOnItsChainThatNames(conversation, piece) {
      const itsGeneration = activeGeneration(conversation)
      const itsRoot = theRootThatNames(conversation, itsGeneration)
      if (itsRoot !== null) return itsRoot
      try {
        const given = workSql().byId.get(piece) as WorkDbRow | undefined
        const itsOwn =
          given === undefined
            ? undefined
            : chainUp(given).find((above) => above.owner_session_id === conversation)
        return itsOwn === undefined
          ? null
          : { label: workRowWalked(itsOwn).label, title: titleNow(itsOwn, itsGeneration) }
      } catch (error) {
        console.warn(
          `session store could not walk up from ${piece} to name ${conversation}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      }
    },

    workThatNamesUnder(conversation, piece, unread) {
      const generation = activeGeneration(conversation)
      const root = theRootThatNames(conversation, generation)
      if (root !== null) return root
      let mine: WorkDbRow | undefined
      try {
        const row = workSql().byId.get(piece) as WorkDbRow | undefined
        mine =
          row === undefined
            ? undefined
            : chainUp(row).find((one) => one.owner_session_id === conversation)
      } catch (error) {
        console.warn(
          `session store could not walk up from ${piece} for ${conversation}: ${error instanceof Error ? error.message : String(error)}`,
        )
        mine = undefined
      }
      if (mine === undefined) {
        return theWorkThatNamesItAmong(piecesForAName(conversation, generation, unread))
      }
      const read = namesRead?.get(mine.id)
      if (read !== undefined) return read
      const named = { label: workRowWalked(mine).label, title: titleNow(mine, generation) }
      namesRead?.set(mine.id, named)
      return named
    },

    childrenOf(piece, after = 0, limit = -1) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      if (row === undefined) return []
      const above = [...chainUp(row)].reverse().map((each) => each.number)
      return (workSql().children.all(piece, after, limit) as WorkDbRow[]).map((child) =>
        workRowFrom(child, [...above, child.number]),
      )
    },

    countChildrenAfter(piece, after) {
      return (workSql().countChildrenAfter.get(piece, after) as { total: number }).total
    },

    pieceOfItsChainHeldBy(piece, owner) {
      try {
        const row = workSql().byId.get(piece) as WorkDbRow | undefined
        if (row === undefined) return null
        return chainUp(row).find((one) => one.owner_session_id === owner)?.id ?? null
      } catch (error) {
        console.warn(
          `session store could not walk up from ${piece} for ${owner}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      }
    },

    turnBlockCandidates(giver, limit, after = null) {
      return selectTurnBlockCandidates.all(giver, after, after, limit) as {
        piece: string
        owner: string
      }[]
    },

    instructionAsksWaitingIn(conversation, unread) {
      const rows = selectTurnBlockInstructions.all(conversation) as {
        conversation: string
        at: number
        ordinal: number
        readable: number
        payload: string
      }[]
      return waitingOnAPerson(
        rows.flatMap((row) => {
          try {
            if (row.readable !== 1) throw new Error('unreadable instruction')
            const event = JSON.parse(row.payload) as
              InstructionProposedEvent | InstructionSettledEvent | null
            if (typeof event?.askId !== 'string') throw new Error('instruction has no ask id')
            return [{ conversation, at: row.at, event }]
          } catch {
            noteUnreadRow(conversation, row.ordinal, unread.in(conversation))
            return []
          }
        }),
      )
    },

    replyQuestionWithoutARequest,

    searchPastWork(caller, words, profile, cursor, transcript) {
      return searchPastWork(connection, this, caller, words, undefined, profile, cursor, transcript)
    },

    pastWorkSearchSource(caller, profile, after, recent) {
      return pastWorkSource(connection, caller, profile, after, recent)
    },

    closePastWorkSearch() {
      closePastWorkSearch(connection)
    },

    piecesOwnedBy(owner, unread) {
      return piecesOfSession(owner, unread?.in(owner))
    },

    piecesOwnedBefore(owner, ordinal, unread) {
      return foldPiecesOfSession(owner, unread?.in(owner), false, ordinal)
    },

    piecesWithTheirWaits(owner, unread, pieces = piecesOfSession(owner, unread.in(owner))) {
      return composeWhatEachPieceIsWaitingOn(pieces, oneWaitReadPerHolder(unread))
    },

    turnBlockPiecesOwnedBy(owner, unread) {
      return turnBlockPiecesOfSession(owner, unread?.in(owner))
    },

    openPiecesOf(owner, unread) {
      return piecesOfSession(owner, unread?.in(owner)).filter((piece) => TASK_IS_OPEN[piece.state])
    },

    recentConversationsGivenFrom(giver, recipientProfile, limit) {
      const rows = workSql().recentGivenFrom.all({
        recipient: agentIdentityRowId(recipientProfile),
        giver,
        limit: limit + 1,
      }) as { id: string; title: string | null }[]
      return {
        rows: rows.slice(0, limit).map((row) => ({ conversation: row.id, title: row.title })),
        more: rows.length > limit,
      }
    },

    conversationsOf(profileSlug) {
      const rows = workSql().conversationsOf.all(agentIdentityRowId(profileSlug)) as {
        id: string
        parent_session_id: string | null
        created_at: number
        updated_at: number
      }[]
      return rows.map((row) => ({
        conversation: row.id,
        parent: row.parent_session_id,
        startedAt: row.created_at,
        lastActiveAt: row.updated_at,
      }))
    },

    newestPiecesHeldIn(conversations, limit, unread) {
      if (conversations.length === 0 || limit < 1) return { rows: [], newest: 0, total: 0 }
      const among = JSON.stringify(conversations)
      const newest = workSql().newestHeldIn.all(among, limit) as {
        id: string
        owner_session_id: string
      }[]
      const folded = new Map<string, readonly PieceForAName[]>()
      const rows = newest.flatMap((row): PieceForAName[] => {
        const holder = row.owner_session_id
        let held = folded.get(holder)
        if (held === undefined) {
          held = piecesForAName(holder, activeGeneration(holder), unread)
          folded.set(holder, held)
        }
        const piece = held.find((one) => one.piece === row.id)
        return piece === undefined ? [] : [piece]
      })
      return {
        rows,
        newest: newest.length,
        total: (workSql().heldInCount.get(among) as { total: number }).total,
      }
    },

    pieceItWasStartedWith(conversation, unread) {
      const row = selectFirstReceived.get({
        conversation,
        generation: activeGeneration(conversation),
      }) as { payload: string | null; ordinal: number } | undefined
      if (row === undefined) return null
      const turn: unknown = row.payload === null ? null : JSON.parse(row.payload)
      if (typeof turn !== 'object' || turn === null) {
        noteUnreadRow(conversation, row.ordinal, unread?.in(conversation))
        return null
      }
      const first = theMessagesOf(turn as UserTurnEvent)[0]
      return typeof first?.piece === 'string' ? first.piece : null
    },

    routedRequestsOf(sessionId, unread) {
      return routedRequestsOfSession(sessionId, unread?.in(sessionId))
    },

    lastEndedTurn(sessionId, unread) {
      return lastEndedTurnOf(sessionId, unread?.in(sessionId))
    },
    providerFailureEpisode: providerFailureEpisodeOf,
    routedRequestsAtHand(sessionId) {
      return routedRequestsAtHand(sessionId)
    },
    questionsRaisedAtHand(sessionId) {
      return questionsRaisedAtHand(sessionId)
    },
    piecesAtHand(owner) {
      return piecesAtHand(owner)
    },
    questionsRoutedToAtHand(parentSessionId) {
      const routed: RoutedRequest[] = []
      const read = new Set<string>()
      for (const candidate of selectSessionsRoutingTo.all(parentSessionId) as {
        id: string
        unreadAt: number | null
      }[]) {
        // A routing that cannot be read names no parent: it is in no answer.
        if (candidate.unreadAt !== null || read.has(candidate.id)) continue
        read.add(candidate.id)
        const kept = routedRequestsAtHand(candidate.id)
        if (kept === null) return null
        routed.push(...kept)
      }
      return routed
        .filter((request) => request.parent === parentSessionId)
        .sort((left, right) => left.at - right.at)
    },
    whenAPersonLastWrote(sessionId) {
      const turns = selectNewestTurnsOpened.iterate(
        sessionId,
        activeGeneration(sessionId),
        PERSON_LAST_WROTE_WITHIN_TURNS,
      ) as Iterable<{ payload: string | null; at: number }>
      for (const row of turns) {
        if (row.payload === null) continue
        // ⚠️ Checked, not trusted: a ledger written by another build can hold anything.
        const turn = JSON.parse(row.payload) as UserTurnEvent
        if (theMessagesOf(turn).some(aPersonsOwnWords)) return row.at
      }
      return null
    },
    requestsItsLastEndedTurnInterrupted(sessionId) {
      const generation = activeGeneration(sessionId)
      return (
        selectRequestsTheLastClosedTurnInterrupted.all(
          sessionId,
          generation,
          sessionId,
          generation,
        ) as { request: unknown }[]
      ).flatMap((row) =>
        typeof row.request === 'string' && row.request !== '' ? [row.request] : [],
      )
    },
    lastExchange(sessionId) {
      return lastExchangeIn(sessionId).exchange
    },

    lastExchangeForTaskRecord(sessionId) {
      return lastExchangeIn(sessionId, Infinity)
    },
    whatOpenedTheLastEndedTurn(sessionId) {
      return whatOpenedTheLastEndedTurn(sessionId)
    },
    transcript(sessionId, read) {
      return transcriptOf(sessionId, read)
    },
    lastAskToStop(sessionId, unread, source) {
      return lastAskToStopOf(sessionId, unread?.in(sessionId), source)
    },
    lastExplicitStopRequest(sessionId) {
      const generation = activeGeneration(sessionId)
      const turn = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
      if (turn === undefined) return null
      const row = selectLastExplicitStopOnTurn.get(sessionId, generation, turn.id) as
        AskRow | undefined
      const asked = row === undefined ? null : actorOfTheAsk(row)
      return asked?.asker != null && asked.reason !== undefined
        ? { asker: asked.asker, reason: asked.reason }
        : null
    },
    questionsRaisedIn(sessionId, unread) {
      return questionsRaisedInSession(sessionId, unread?.in(sessionId))
    },
    questionStatesIn(sessionId, unread) {
      return questionStatesInSession(sessionId, unread?.in(sessionId))
    },
    conversationsHoldingACopyOf(requestId) {
      // The copies only once they are full and indexed; until then, the exact read of the ledger.
      const byCopy = questionCopiesReady(connection)
        ? (selectConversationsByCopy ??= db.prepare(
            `SELECT DISTINCT e.session_id AS id
               FROM question_copy q INDEXED BY question_copy_key_idx
               JOIN events e ON e.id = q.event_id
              WHERE q.passed_up_from = ?
                AND e.type = 'question_asked'
                AND CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.passedUpFrom') END = ?
              ORDER BY e.session_id`,
          ))
        : undefined
      const rows =
        byCopy === undefined
          ? selectConversationsHoldingACopyOf.all(requestId)
          : byCopy.all(requestId, requestId)
      return (rows as { id: string }[]).map((row) => row.id)
    },

    fillQuestionCopies(rows, bytes) {
      return fillQuestionCopies(connection, rows, bytes)
    },
    whoRoutedToWhom() {
      return (selectWhoRoutedToWhom.all() as { asker: string; parent: unknown }[]).flatMap((row) =>
        typeof row.parent === 'string' && row.parent !== ''
          ? [{ asker: row.asker, parent: row.parent }]
          : [],
      )
    },
    theRequestRouted(sessionId, requestId) {
      const row = selectTheRequestRouted.get({
        session: sessionId,
        generation: activeGeneration(sessionId),
        request: requestId,
      }) as EventRow | undefined
      if (row === undefined) return null
      const asked = toPersistedEvents([row])[0]?.event
      if (asked?.type !== 'permission_request' && asked?.type !== 'user_input_request') return null
      return asked.id === requestId ? asked : null
    },
    generationOf(sessionId) {
      return activeGeneration(sessionId)
    },
    latestMoveOffer(sessionId) {
      const row = selectLatestMoveOffer.get(sessionId, activeGeneration(sessionId)) as
        { payload: string } | undefined
      if (row === undefined) return null
      const event = JSON.parse(row.payload) as QuestionAskedEvent
      return moveOfferOf(event.move) === undefined ? null : event
    },
    theDecisionOn(sessionId, requestId) {
      const row = selectTheDecisionOn.get(sessionId, activeGeneration(sessionId), requestId) as
        { payload: string } | undefined
      if (row === undefined) return null
      const decided = JSON.parse(row.payload) as {
        outcome?: unknown
        by?: unknown
        movedTo?: unknown
      }
      return {
        outcome: typeof decided.outcome === 'string' ? decided.outcome : '',
        by: decided.by === undefined ? null : actedByFrom(decided.by),
        ...(moveReceiptOf(decided.movedTo) === undefined
          ? {}
          : { movedTo: moveReceiptOf(decided.movedTo) }),
      }
    },
    questionsRoutedTo(parentSessionId, unread) {
      const sessions = (
        selectSessionsRoutingTo.all(parentSessionId) as { id: string; unreadAt: number | null }[]
      ).filter((candidate) => {
        if (candidate.unreadAt === null) return true
        noteUnreadRow(candidate.id, candidate.unreadAt, unread?.in(candidate.id))
        return false
      })
      return sessions
        .flatMap((row) => [...routedRequestsOfSession(row.id, unread?.in(row.id))])
        .filter((request) => request.parent === parentSessionId)
        .sort((left, right) => left.at - right.at)
    },
  }
}
