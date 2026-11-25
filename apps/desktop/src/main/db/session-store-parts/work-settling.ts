import type { AppNotice } from '../../../shared/app-notice'
import type {
  QueuedMessageEvent,
  TranscriptEvent,
  UnqueuedMessageEvent,
} from '../../../shared/conversation-events'
import { aPersonsSince, permissionShaped, REQUEST_IS_OPEN } from '../../../shared/questions'
import { theMessagesOf } from '../../../shared/runtime-ipc'
import type { PieceWaitingOnWhoWrote, WorkGivenEvent } from '../../../shared/task-contracts'
import {
  AN_ANSWER_HELD_THEN_LOST,
  aStallItsGiverCanBeToldOf,
  composeWhatEachPieceIsWaitingOn,
  theAnswerItCarries,
  waitsOnWhoWrote,
} from '../../../shared/tasks'
import {
  holderReconciliationReceipt,
  reconciliationReceipt,
  workRecoveryEvent,
} from '../../../shared/work-reconciliation'
import { committedChangesOf } from '../committed-changes'
import type { AppDatabase, AppStatement } from '../connection'
import { createProviderLimitReader, type SessionReadPhases } from '../provider-limit-reader'
import { type RowsUnread, rowsUnreadOnce, type SkipNote } from '../rows-unread'
import { attachmentsStoredOn, authorshipStoredOn, noteUnreadRow } from '../stored-event-codec'
import { A_RESTART_LEFT_THE_MESSAGE_WAITING } from '../turn-evidence-read'
import type { SessionStore } from './session-store-contract'
import type {
  GivenPiece,
  ProviderFailureNoticeProgress,
  QueuedPromptProgress,
  WorkDbRow,
} from './session-store-rows'
import type { StrandedMessages } from './piece-folds'
import {
  ledgersSkippedOf,
  skipTheLedger,
  stalledInOrder,
  theFoldIndexHolds,
  walkLedgers,
} from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'
import type { createWorkStatementsPart } from './work-statements'
import type { createLedgerEventsPart } from './ledger-events'
import type { createPieceFoldsPart } from './piece-folds'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  | 'activeGeneration'
  | 'appendTx'
  | 'keptUntilItsLedgerGrows'
  | 'reconciliationCut'
  | 'routedRequestsOfSession'
  | 'selectMaxOrdinal'
>

type FromWorkStatements = Pick<
  ReturnType<typeof createWorkStatementsPart>,
  'bumpSequence' | 'workRowWalked' | 'workSql'
>

type FromLedgerEvents = Pick<
  ReturnType<typeof createLedgerEventsPart>,
  'selectBuildingSessions' | 'selectRunningSessions' | 'selectSessionsThatRouted' | 'theNewestTurn'
>

type FromPieceFolds = Pick<
  ReturnType<typeof createPieceFoldsPart>,
  | 'foldMessagesWaitingIn'
  | 'foldPiecesOfSession'
  | 'foldReconciliationPieces'
  | 'messagesWaitingKept'
  | 'oneWaitReadPerHolder'
  | 'piecesOfSession'
  | 'piecesThatDrove'
  | 'reconciliationCutOrUnread'
  | 'reconciliationPiecesKept'
  | 'reconciliationReading'
  | 'selectEveryConversationAndStatus'
  | 'stallsToldToSession'
  | 'strandedMessageSteps'
  | 'strandedMessages'
>

interface WorkSettlingPartDeps
  extends FromTurnReads, FromWorkStatements, FromLedgerEvents, FromPieceFolds {
  readonly db: AppDatabase
  readonly readPhases?: SessionReadPhases
  readonly oneSnapshot: boolean
  readonly committed: ReturnType<typeof committedChangesOf>
  readonly connection: AppDatabase
}

type WorkSettlingMethods = Pick<
  SessionStore,
  | 'stalledWorkNobodyWasToldAbout'
  | 'stalledWorkAPersonGave'
  | 'stalledWorkItsGiverWasToldAbout'
  | 'piecesWaitingOnWhoWrote'
  | 'piecesWaitingOnWhoWroteIn'
  | 'providerLimitsSeen'
  | 'readAheadProviderWalls'
  | 'messagesWaitingIn'
  | 'startupRepairOwners'
  | 'settleStrandedMessagesInSteps'
  | 'settleStrandedMessages'
  | 'settleRestartedWork'
  | 'questionsAPersonMustAnswer'
  | 'decisionsAwaitingAPerson'
  | 'numberUnder'
  | 'recordGive'
  | 'reconciliationOwners'
  | 'reconciliationWork'
  | 'reconciliationReceiptsForOwner'
  | 'reconciliationRecovery'
  | 'reconciliationDrivenByTurn'
  | 'reconciliationPieces'
  | 'reconciliationReceipts'
  | 'queuedPromptProgress'
  | 'providerFailureNoticeProgress'
  | 'reconciliationDelivery'
>

export function createWorkSettlingPart(deps: WorkSettlingPartDeps) {
  const {
    db,
    readPhases,
    oneSnapshot,
    committed,
    connection,
    activeGeneration,
    appendTx,
    bumpSequence,
    foldMessagesWaitingIn,
    foldPiecesOfSession,
    foldReconciliationPieces,
    keptUntilItsLedgerGrows,
    messagesWaitingKept,
    oneWaitReadPerHolder,
    piecesOfSession,
    piecesThatDrove,
    reconciliationCut,
    reconciliationCutOrUnread,
    reconciliationPiecesKept,
    reconciliationReading,
    routedRequestsOfSession,
    selectBuildingSessions,
    selectEveryConversationAndStatus,
    selectMaxOrdinal,
    selectRunningSessions,
    selectSessionsThatRouted,
    stallsToldToSession,
    strandedMessages,
    strandedMessageSteps,
    theNewestTurn,
    workRowWalked,
    workSql,
  } = deps
  const serviceBirth = (owner: string, readPayload = false): string =>
    `SELECT ${readPayload ? "CASE WHEN length(payload) <= 2048 THEN payload ELSE '{}' END" : '1'}
       FROM events INDEXED BY events_kind_owner_idx
       WHERE type = 'service_registered' AND session_id = ${owner} AND generation = 0 AND ordinal = 0`
  const selectReconciliationOwners = db.prepare('SELECT DISTINCT owner_session_id AS id FROM work')
  const selectReconciliationOwnersWithFailures = db.prepare(
    `SELECT owner_session_id AS id FROM work
      UNION
      SELECT session_id AS id FROM events INDEXED BY events_kind_owner_idx
      WHERE type = 'work_reconciliation'
        AND CASE WHEN json_valid(payload)
          THEN json_extract(payload, '$.kind') = 'provider-turn-failed' ELSE 0 END`,
  )
  const selectReconciliationOwnerReceipts = db.prepare(`SELECT payload, created_at FROM events
    WHERE type = 'work_reconciliation' AND session_id = ? ORDER BY generation, ordinal`)
  const selectReconciliationReceipts = db.prepare(
    `SELECT payload, created_at FROM events INDEXED BY events_work_piece_idx
      WHERE session_id = ? AND type = 'work_reconciliation'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.kind') IS NOT 'provider-turn-failed' ELSE 1 END
        AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
      ORDER BY generation, ordinal`,
  )
  const selectUnreadReconciliationReceipt = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_work_piece_idx
      WHERE session_id = ? AND type = 'work_reconciliation'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.kind') IS NOT 'provider-turn-failed' ELSE 1 END
        AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END IS NULL
      LIMIT 1`,
  )
  // RC3 can replan an explicit retraction. A newer unread queue row can supersede it.
  const selectReconciliationMessage = db.prepare(
    `SELECT generation, ordinal, payload FROM events
      WHERE session_id = @target AND type IN ('message_queued', 'message_unqueued')
        AND CASE WHEN json_valid(payload) THEN
              CASE WHEN json_type(payload, '$.messageId') IS 'text'
                THEN json_extract(payload, '$.messageId') = @messageId ELSE @needsDisposition END
              ELSE @needsDisposition END
      ORDER BY generation DESC, ordinal DESC LIMIT 1`,
  )
  const selectTurnAfterReconciliation = db.prepare(
    `SELECT e.payload, t.id AS turn, t.closed_at FROM events e LEFT JOIN turn t ON t.id = e.turn_id
      WHERE e.session_id = ? AND e.generation = ? AND e.ordinal > ?
        AND e.type IN ('user_turn', 'provider_turn', 'launched', 'reopened')
      ORDER BY e.ordinal LIMIT 1`,
  )

  function readQueuedPromptProgress(
    target: string,
    messageId: string,
    appNotice: AppNotice,
    needsDisposition: boolean,
  ): ProviderFailureNoticeProgress {
    const message = selectReconciliationMessage.get({
      target,
      messageId,
      needsDisposition: needsDisposition ? 1 : 0,
    }) as { generation: number; ordinal: number; payload: string } | undefined
    if (message === undefined) return 'missing'
    let event: QueuedMessageEvent | UnqueuedMessageEvent | null
    try {
      event = JSON.parse(message.payload) as QueuedMessageEvent | UnqueuedMessageEvent | null
    } catch {
      return 'not-delivered'
    }
    if (event === null) return 'not-delivered'
    if (needsDisposition) {
      if (event.messageId !== messageId) return 'not-delivered'
      const subjectOnItsTurn =
        event.type === 'message_unqueued' &&
        event.reason === 'sent' &&
        event.appNotice === undefined
      if (event.appNotice !== appNotice && !subjectOnItsTurn) return 'not-delivered'
    }
    if (event.type === 'message_queued') return 'pending'
    if (needsDisposition && event.type === 'message_unqueued' && event.reason === 'retracted')
      return 'retracted'
    if (event.reason !== 'sent') return 'not-delivered'
    const opened = selectTurnAfterReconciliation.get(
      target,
      message.generation,
      message.ordinal,
    ) as { payload: string; turn: string | null; closed_at: number | null } | undefined
    if (opened === undefined || opened.turn === null) return 'not-delivered'
    const turn = JSON.parse(opened.payload) as TranscriptEvent
    if (
      turn.type !== 'user_turn' ||
      !theMessagesOf(turn).some((one) => one.text === event.text && one.appNotice === appNotice)
    )
      return 'not-delivered'
    return opened.closed_at === null ? 'running' : 'turn-ended'
  }

  function queuedPromptProgress(
    target: string,
    messageId: string,
    appNotice: AppNotice,
  ): QueuedPromptProgress {
    const progress = readQueuedPromptProgress(target, messageId, appNotice, false)
    return progress === 'retracted' ? 'not-delivered' : progress
  }

  // Prefer the recent date range over a scan of every error, without requiring a named index.
  const { providerLimitsSeen, readAheadProviderWalls } = createProviderLimitReader(
    db,
    connection,
    activeGeneration,
    readPhases,
    noteUnreadRow,
    theFoldIndexHolds,
  )
  let selectNewestRecovery: AppStatement | undefined

  // Keep only the local fold here; related questions and workers are composed by each caller.
  const waitingOnWhoWrote = keptUntilItsLedgerGrows((owner, noteSkip) =>
    piecesOfSession(owner, noteSkip).filter(waitsOnWhoWrote),
  )

  function piecesWaitingOnWhoWroteIn(
    owner: string,
    noteSkip?: SkipNote,
  ): readonly PieceWaitingOnWhoWrote[] {
    // A clean uncounted read can be kept; an unread row still prevents either fold being kept.
    return waitingOnWhoWrote(owner, noteSkip ?? (() => {}))
  }

  const selectOwnersOfGivenPieces = db.prepare(
    `SELECT DISTINCT owner_session_id AS id FROM work WHERE parent_id IS NOT NULL`,
  )
  // A first-life birth remains evidence even when its payload cannot be read.
  const legacyService = `s.parent_session_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM work AS w WHERE w.owner_session_id = s.id AND w.parent_id IS NULL
    )`
  const selectServicesBorn = db.prepare(
    `SELECT s.id, s.agent_identity_id AS identity, i.created_at AS incarnation,
            s.parent_session_id AS parent, s.created_at AS created,
            (${serviceBirth('s.id', true)}) AS birth
       FROM provider_session AS s
       LEFT JOIN agent_identity AS i ON i.id = s.agent_identity_id
       WHERE (${legacyService}) OR EXISTS (${serviceBirth('s.id')})`,
  )
  const selectServiceBorn = db.prepare(
    `SELECT 1 AS yes FROM provider_session AS s
      WHERE s.id = ? AND ((${legacyService}) OR EXISTS (${serviceBirth('s.id')}))`,
  )
  const selectHoldsAGivenPiece = db.prepare(
    `SELECT 1 AS yes FROM work WHERE owner_session_id = ? AND parent_id IS NOT NULL LIMIT 1`,
  )
  const selectOwnersOfPiecesAConversationGave = db.prepare(
    `SELECT DISTINCT owner_session_id AS id FROM work WHERE given_by_session_id IS NOT NULL`,
  )
  const selectConversationHeld = db.prepare(`SELECT 1 AS yes FROM provider_session WHERE id = ?`)
  const selectALostAnswerRecorded = db.prepare(
    `SELECT 1 AS yes FROM events
      WHERE session_id = ? AND type = 'reply_undelivered'
        AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
      LIMIT 1`,
  )
  function settleHeldMessages(
    stranded: StrandedMessages['stranded'],
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
  ): number {
    let settled = 0
    for (const held of stranded) {
      if (running.has(held.session_id)) continue
      try {
        const generation = activeGeneration(held.session_id)
        const max = selectMaxOrdinal.get(held.session_id, generation) as
          { max_ordinal: number | null } | undefined
        appendTx(
          held.session_id,
          (max?.max_ordinal ?? -1) + 1,
          {
            type: 'message_unqueued',
            messageId: held.message_id,
            reason: 'abandoned',
            text: held.text ?? '',
            detail: A_RESTART_LEFT_THE_MESSAGE_WAITING,
            ...authorshipStoredOn(held.payload),
            ...attachmentsStoredOn(held.payload),
          },
          at,
          generation,
          true,
        )
        const answer = theAnswerItCarries(authorshipStoredOn(held.payload))
        if (
          answer !== null &&
          !running.has(answer.owner) &&
          selectConversationHeld.get(answer.owner) !== undefined &&
          selectALostAnswerRecorded.get(answer.owner, answer.piece) === undefined
        ) {
          const itsGeneration = activeGeneration(answer.owner)
          const itsMax = selectMaxOrdinal.get(answer.owner, itsGeneration) as
            { max_ordinal: number | null } | undefined
          try {
            appendTx(
              answer.owner,
              (itsMax?.max_ordinal ?? -1) + 1,
              {
                type: 'reply_undelivered',
                piece: answer.piece,
                parent: held.session_id,
                because: AN_ANSWER_HELD_THEN_LOST,
              },
              at,
              itsGeneration,
              true,
            )
          } catch (error) {
            console.warn(
              `messages: could not record that ${answer.owner}'s answer to ${answer.label} was lost: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          }
        }
        settled += 1
      } catch (error) {
        skipTheLedger(held.session_id, error, unread?.in(held.session_id))
      }
    }
    return settled
  }
  const settleHeldMessagesTx = db.transaction(settleHeldMessages)
  const settleStrandedMessagesTx = db.transaction(
    (
      at: number,
      running: ReadonlySet<string>,
      unread?: RowsUnread,
      owners?: ReadonlySet<string>,
    ): number => {
      const { stranded, torn } = strandedMessages(owners)
      for (const one of torn) noteUnreadRow(one.session_id, one.ordinal, undefined)
      return settleHeldMessages(stranded, at, running, unread)
    },
  )

  function* settleStrandedMessagesInSteps(
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
    owners?: ReadonlySet<string>,
  ): Generator<() => void, number> {
    const { stranded, torn } = yield* strandedMessageSteps(owners)
    for (const one of torn) yield () => noteUnreadRow(one.session_id, one.ordinal, undefined)
    let settled = 0
    for (const held of stranded) {
      yield () => {
        settled += settleHeldMessagesTx([held], at, running, unread)
      }
    }
    return settled
  }

  const settleRestartedWorkTx = db.transaction(
    (
      at: number,
      running: ReadonlySet<string>,
      unread?: RowsUnread,
      wokenForAJob?: ReadonlySet<string>,
      diedInTheBackground?: Set<string>,
      continuing?: ReadonlySet<string>,
      owners?: ReadonlySet<string>,
    ): number => {
      let written = 0
      // Named owners are looked up one by one, so a repair sliced per owner reads no whole table.
      const holders =
        owners === undefined
          ? (selectOwnersOfGivenPieces.all() as { id: string }[])
          : [...owners]
              .filter((id) => selectHoldsAGivenPiece.get(id) !== undefined)
              .map((id) => ({ id }))
      const services =
        owners === undefined
          ? new Set((selectServicesBorn.all() as { id: string }[]).map(({ id }) => id))
          : new Set(
              holders
                .filter(({ id }) => selectServiceBorn.get(id) !== undefined)
                .map(({ id }) => id),
            )
      for (const worker of holders) {
        if (running.has(worker.id)) continue
        try {
          const woken = wokenForAJob?.has(worker.id) === true
          const listed = piecesOfSession(worker.id, unread?.in(worker.id)).filter(
            (piece) =>
              piece.state === 'waiting' ||
              piece.state === 'working' ||
              piece.parkedOver === 'working',
          )
          const open = services.has(worker.id)
            ? listed.filter((piece) => piece.state !== 'waiting')
            : listed
          if (woken && open.some((piece) => piece.inTheBackground !== undefined)) {
            diedInTheBackground?.add(worker.id)
          }
          const named = open.filter((piece) => !(woken && piece.inTheBackground !== undefined))
          const undriven = named.map((piece) => piece.piece)
          if (undriven.length === 0) continue
          if (named.some((piece) => piece.inTheBackground !== undefined)) {
            diedInTheBackground?.add(worker.id)
          }
          if (continuing?.has(worker.id) === true) continue
          const generation = activeGeneration(worker.id)
          const max = selectMaxOrdinal.get(worker.id, generation) as
            { max_ordinal: number | null } | undefined
          appendTx(
            worker.id,
            (max?.max_ordinal ?? -1) + 1,
            { type: 'work_restarted', pieces: undriven },
            at,
            generation,
            false,
          )
          written += 1
        } catch (error) {
          skipTheLedger(worker.id, error, unread?.in(worker.id))
        }
      }
      return written
    },
  )

  /** {@link SessionStore.numberUnder}, in its own transaction. */
  const numberUnderTx = db.transaction((parent: string): number => bumpSequence(parent))

  const recordGiveTx = db.transaction(
    (given: GivenPiece, ordinal: number, event: WorkGivenEvent, at: number) => {
      workSql().insert.run(
        given.piece,
        given.parent,
        given.number,
        given.owner,
        given.givenBy,
        given.title,
        given.brief,
        given.folder,
        at,
      )
      for (const input of given.inputs) {
        committed.kept(given.piece, input.resource)
        workSql().insertResource.run(
          input.resource,
          given.piece,
          'input',
          input.title,
          null,
          input.name,
          input.sha256,
          input.bytes,
          given.givenBy,
          at,
        )
      }
      appendTx(given.owner, ordinal, event, at, activeGeneration(given.owner), true)
    },
  )

  const methods: WorkSettlingMethods & ThisType<SessionStore> = {
    stalledWorkNobodyWasToldAbout(counted, noOpenPieces, work) {
      const holders = selectOwnersOfPiecesAConversationGave.all() as { id: string }[]
      const unread = counted ?? rowsUnreadOnce()
      const told = new Map<string, ReadonlySet<string>>()
      const toldAbout = (giver: string): ReadonlySet<string> => {
        const held = told.get(giver)
        if (held !== undefined) return held
        const receipts = stallsToldToSession(giver, unread.in(giver))
        told.set(giver, receipts)
        return receipts
      }
      const waiting = oneWaitReadPerHolder(unread, work)
      const walked = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (sessionId, noteSkip) =>
          oneSnapshot && db.inTransaction && noOpenPieces?.(sessionId)
            ? []
            : composeWhatEachPieceIsWaitingOn(
                work === undefined
                  ? piecesOfSession(sessionId, noteSkip)
                  : work.ownedBy(sessionId, noteSkip),
                waiting,
              ).filter(
                (piece) =>
                  aStallItsGiverCanBeToldOf(piece) && !toldAbout(piece.giver).has(piece.piece),
              ),
        unread,
      )
      return {
        walk: walked.walk,
        ledgers: walked.ledgers,
        rowsUnread: walked.rowsUnread,
        ...ledgersSkippedOf(walked.ledgersSkipped),
        rows: [...walked.rows].sort((left, right) => {
          if (left.stalledAt !== right.stalledAt) {
            if (left.stalledAt === null) return 1
            if (right.stalledAt === null) return -1
            return left.stalledAt - right.stalledAt
          }
          return left.piece < right.piece ? -1 : 1
        }),
      }
    },
    stalledWorkAPersonGave(counted) {
      const holders = selectOwnersOfGivenPieces.all() as { id: string }[]
      const unread = counted ?? rowsUnreadOnce()
      const waits = oneWaitReadPerHolder(unread)
      const found = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (holder, noteSkip) =>
          composeWhatEachPieceIsWaitingOn(
            piecesOfSession(holder, noteSkip).filter((piece) => piece.giver === null),
            waits,
          ).filter((piece) => piece.state === 'stalled' && piece.stalledAt !== null),
        unread,
      )
      return stalledInOrder(found)
    },
    stalledWorkItsGiverWasToldAbout(counted, noOpenPieces, work) {
      const holders = selectOwnersOfPiecesAConversationGave.all() as { id: string }[]
      const unread = counted ?? rowsUnreadOnce()
      const told = new Map<string, ReadonlySet<string>>()
      const wasToldOf = (giver: string, piece: string): boolean => {
        let receipts = told.get(giver)
        if (receipts === undefined) {
          receipts = stallsToldToSession(giver, unread.in(giver))
          told.set(giver, receipts)
        }
        return receipts.has(piece)
      }
      const waits = oneWaitReadPerHolder(unread, work)
      const found = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (holder, noteSkip) =>
          oneSnapshot && db.inTransaction && noOpenPieces?.(holder)
            ? []
            : composeWhatEachPieceIsWaitingOn(
                work === undefined
                  ? piecesOfSession(holder, noteSkip)
                  : work.ownedBy(holder, noteSkip),
                waits,
              ).filter(
                (piece) => aStallItsGiverCanBeToldOf(piece) && wasToldOf(piece.giver, piece.piece),
              ),
        unread,
      )
      return stalledInOrder(found)
    },
    piecesWaitingOnWhoWrote() {
      // An answered turn creates no request. Real asks are in questionsAPersonMustAnswer.
      return { rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }
    },
    piecesWaitingOnWhoWroteIn(owner, unread) {
      return piecesWaitingOnWhoWroteIn(owner, unread?.in(owner))
    },
    providerLimitsSeen,
    readAheadProviderWalls,
    messagesWaitingIn(sessionId, unread, maximumRows) {
      return oneSnapshot && maximumRows === undefined
        ? messagesWaitingKept(sessionId, unread?.in(sessionId))
        : foldMessagesWaitingIn(sessionId, unread?.in(sessionId), maximumRows)
    },

    startupRepairOwners(phase) {
      if (phase === 'builds')
        return (selectBuildingSessions.all() as { session_id: string }[]).map(
          (row) => row.session_id,
        )
      if (phase === 'runs')
        return (selectRunningSessions.all() as { id: string }[]).map(({ id }) => id)
      if (phase === 'requests')
        return (selectSessionsThatRouted.all() as { id: string }[]).map(({ id }) => id)
      if (phase === 'work')
        return (selectOwnersOfGivenPieces.all() as { id: string }[]).map(({ id }) => id)
      return [
        ...new Set(
          [
            ...(selectEveryConversationAndStatus.all() as { id: string }[]),
            ...(selectSessionsThatRouted.all() as { id: string }[]),
            ...(selectOwnersOfGivenPieces.all() as { id: string }[]),
          ].map(({ id }) => id),
        ),
      ]
    },
    settleStrandedMessagesInSteps,
    settleStrandedMessages(at, running, unread, owners) {
      return settleStrandedMessagesTx(at, running, unread, owners)
    },
    settleRestartedWork(
      at,
      running,
      unread,
      wokenForAJob,
      diedInTheBackground,
      continuing,
      owners,
    ) {
      return settleRestartedWorkTx(
        at,
        running,
        unread,
        wokenForAJob,
        diedInTheBackground,
        continuing,
        owners,
      )
    },
    questionsAPersonMustAnswer(unread) {
      const candidates = selectSessionsThatRouted.all() as { id: string }[]
      const walked = walkLedgers(
        'every-conversation-that-routed',
        candidates,
        routedRequestsOfSession,
        unread,
      )
      return {
        walk: walked.walk,
        ledgers: walked.ledgers,
        rowsUnread: walked.rowsUnread,
        ...ledgersSkippedOf(walked.ledgersSkipped),
        rows: walked.rows
          .filter(
            (request) =>
              REQUEST_IS_OPEN[request.state] &&
              (request.escalatedAt !== null || request.went.is === 'the-person-the-asker-named') &&
              request.went.is !== 'the-person-the-channel-left-it-with',
          )
          .sort(
            (left, right) => (aPersonsSince(left) ?? left.at) - (aPersonsSince(right) ?? right.at),
          ),
      }
    },

    decisionsAwaitingAPerson(unread) {
      const candidates = selectSessionsThatRouted.all() as { id: string }[]
      const walked = walkLedgers(
        'every-conversation-that-routed',
        candidates,
        routedRequestsOfSession,
        unread,
      )
      return {
        walk: walked.walk,
        ledgers: walked.ledgers,
        rowsUnread: walked.rowsUnread,
        ...ledgersSkippedOf(walked.ledgersSkipped),
        rows: permissionShaped(walked.rows)
          .filter((request) => REQUEST_IS_OPEN[request.state])
          .sort((left, right) => left.at - right.at),
      }
    },

    numberUnder(parent) {
      return numberUnderTx(parent)
    },

    recordGive(given, ordinal, event, at) {
      recordGiveTx(given, ordinal, event, at)
    },

    reconciliationOwners(includeProviderFailureNotices = false) {
      const owners = includeProviderFailureNotices
        ? selectReconciliationOwnersWithFailures
        : selectReconciliationOwners
      return (owners.all() as { id: string }[]).map((one) => one.id)
    },
    reconciliationWork(holders, unread) {
      const owners =
        holders === undefined
          ? (selectReconciliationOwners.all() as { id: string }[]).map((one) => one.id)
          : [...holders]
      return owners.flatMap((owner) => {
        const pieces = this.openPiecesOf(owner, unread)
        const root = workSql().rootOwnedBy.get(owner) as WorkDbRow | undefined
        const rows = root === undefined ? [] : [workRowWalked(root)]
        for (const piece of pieces) {
          const row = workSql().byId.get(piece.piece) as WorkDbRow | undefined
          if (row !== undefined) rows.push(workRowWalked(row))
        }
        return rows
      })
    },
    reconciliationReceiptsForOwner(owner) {
      return (
        selectReconciliationOwnerReceipts.all(owner) as { payload: string; created_at: number }[]
      ).map((row) => {
        const receipt = holderReconciliationReceipt(JSON.parse(row.payload), row.created_at)
        if (receipt === null) throw new Error('an incident receipt could not be read')
        return receipt
      })
    },
    reconciliationRecovery(owner) {
      const row = (selectNewestRecovery ??= db.prepare(
        `SELECT payload FROM events WHERE session_id = ? AND type = 'work_recovery'
        ORDER BY generation DESC, ordinal DESC LIMIT 1`,
      )).get(owner) as { payload: string } | undefined
      if (row === undefined) return null
      const read = workRecoveryEvent(JSON.parse(row.payload))
      if (read === null) throw new Error('a recovery receipt could not be read')
      return read
    },
    reconciliationDrivenByTurn(owner, turn) {
      const before = reconciliationCut(owner, turn)
      if (before === null) return []
      const unread = rowsUnreadOnce()
      const folded =
        before === undefined
          ? piecesOfSession(owner, unread.in(owner))
          : foldPiecesOfSession(owner, unread.in(owner), false, before)
      if (unread.count !== 0 || unread.ledgersSkipped !== 0)
        throw new Error('the cut work could not be read')
      return piecesThatDrove(owner, folded, this.recordedTurnOpening(owner, turn))
    },
    reconciliationPieces(owner, unread) {
      if (!oneSnapshot)
        return reconciliationReading(owner, foldReconciliationPieces(owner, unread?.in(owner)))
      const newestTurn = theNewestTurn(owner)
      const before = newestTurn === null ? null : reconciliationCutOrUnread(owner, newestTurn)
      const kept = reconciliationPiecesKept(owner, unread?.in(owner))
      if (kept.newestTurn === newestTurn && kept.before === before)
        return reconciliationReading(owner, kept)
      // A turn moved without a fold row: what was kept is read again, and kept in its place.
      reconciliationPiecesKept.forget(owner)
      return reconciliationReading(owner, reconciliationPiecesKept(owner, unread?.in(owner)))
    },

    reconciliationReceipts(owner, piece) {
      if (selectUnreadReconciliationReceipt.get(owner) !== undefined)
        throw new Error('an incident receipt could not be read')
      return (
        selectReconciliationReceipts.all(owner, piece) as { payload: string; created_at: number }[]
      ).map((row) => {
        const receipt = reconciliationReceipt(JSON.parse(row.payload), row.created_at)
        if (receipt === null) throw new Error('an incident receipt could not be read')
        return receipt
      })
    },
    queuedPromptProgress,
    providerFailureNoticeProgress(target, messageId) {
      return readQueuedPromptProgress(target, messageId, 'a-provider-turn-failed', true)
    },
    reconciliationDelivery(target, messageId) {
      const progress = queuedPromptProgress(target, messageId, 'a-work-wait-needs-attention')
      return progress === 'missing' ? 'not-delivered' : progress
    },
  }
  return { methods, selectServicesBorn, selectServiceBorn }
}
