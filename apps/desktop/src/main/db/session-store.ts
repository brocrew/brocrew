import type { AppNotice } from '../../shared/app-notice'
import { readInstructionAskers } from './instruction-askers-read'
import { piecesAtTheCutAndNow } from './piece-fold-cut'
export type { ResumableSession, LiveSessionRow, RecordedSession } from './session-catalogue-read'
import type { EventRow, PersistedEvent } from './ledger-row-types'
export type { DigestRow, EventRow, PersistedEvent } from './ledger-row-types'
import {
  aStoredObject,
  attachmentsStoredOn,
  authorshipStoredOn,
  isAStoredId,
  isMailboxKind,
  noteUnreadRow,
  persistedEventsFrom,
  providerFailureHolderStoredOn,
  theQuestionItAsks,
  toPersistedEvents,
} from './stored-event-codec'
export { toPersistedEvents } from './stored-event-codec'
export type { WorkRow } from './work-ledger-read'
import { rowsUnreadOnce, THE_WHOLE_LEDGER, type RowsUnread, type SkipNote } from './rows-unread'
import type {
  LedgerWalk,
  QuestionAskedEvent,
  RaisedQuestion,
  RoutedRequest,
} from '../../shared/question-contracts'
import type {
  InstructionProposedEvent,
  InstructionSettledEvent,
  McpServerRequestSettledEvent,
  McpServerRequestedEvent,
  QueuedMessageEvent,
  TheQuestionItAsks,
  TranscriptEvent,
  UnqueuedMessageEvent,
} from '../../shared/conversation-events'
import type { ModelAndEffort } from '../../shared/model-choice-contracts'
import {
  parseProvider,
  parseModelChoice,
  modelChoiceWritten,
} from './session-store-parts/model-choice-storage'
export { parseModelChoice, modelChoiceWritten } from './session-store-parts/model-choice-storage'
export { THREAD_LEAD_EVENT_TYPES, type ThreadLeadRow } from './thread-lead-reader'
import type { UserTurnEvent } from '../../shared/human-answer-contracts'
import type {
  PieceRow,
  PieceWaitingOnWhoWrote,
  WhatAConversationIsWaitingOn,
  WorkGivenEvent,
} from '../../shared/task-contracts'
import { aConversationTitle, titleFromOpeningMessage } from '../../shared/conversation-title'
import { createSqliteSessionModels } from '../database/sqlite/agents/session-models'
import { createOwnNotesStore } from './own-notes'
import { createMemoryRecoveryStore } from './memory-recovery'
export { createMemoryAmendmentObserver } from './memory-recovery'
import { createAgentKnowledgeHistory } from './agent-knowledge-history'
import { createMethodChangeStore } from './method-changes'
import { withOptionalIndexes } from './optional-indexes'
import { committedChangesOf } from './committed-changes'
import { searchPastWork, closePastWorkSearch, pastWorkSource } from './past-work-search'
import {
  holderReconciliationReceipt,
  reconciliationReceipt,
  workRecoveryEvent,
} from '../../shared/work-reconciliation'

import { workerRegistrationOf } from '../worker-registration'
import { serviceRegistrationOf } from '../service-registration'
import { moveOfferOf, moveOriginOf, moveReceiptOf } from '../../shared/move-request'
import { capabilitiesFor, isAvailable, SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import type { Provider, SessionStatus } from '@brobot2/shared'
import { AN_ANSWER_HELD_THEN_LOST, theAnswerItCarries } from '../../shared/tasks'
import {
  externalMcpGrantRowId,
  externalMcpServerRowId,
  foldExternalMcpReach,
  type ExternalMcpServerRow,
} from '../../shared/external-mcp'
import { workEdge } from '../../shared/who-called-whom'
import { createProviderLimitReader, type SessionReadPhases } from './provider-limit-reader'
export type { SessionReadPhases } from './provider-limit-reader'
import { NONE_STARTED } from '../../shared/agent-roster'
import type { StartedOn } from '../../shared/agent-roster'
import { sameModel } from '../../shared/model-choice'
import type {
  AgentIdentity,
  AgentIdentityName,
  IdentityCreator,
  NewAgent,
} from '../../shared/runtime-ipc'
import { failureAtTurnEnd } from '../../shared/piece-fold'
import { MAX_TURN_PARTS, theMessagesOf } from '../../shared/runtime-ipc'
import {
  conversationTree,
  deleteTheTree,
  providerSessionsOf,
  whatTiesTheTreeOutside,
} from './conversation-tree'
import { forestListing } from './forest-listing'
import { FOLD_TERM } from './fold-index'
import { ensureQuestionCopies, fillQuestionCopies, questionCopiesReady } from './question-copies'
import { ledgerWritesFor } from './ledger-write-stamp'
import { type SnapshotFoldAnswers } from './ledger-fold-state'
import { createDigestWindowRead } from './digest-window-read'
import { createWorkerRecordsRead } from './worker-records-read'
import { A_RESTART_LEFT_THE_MESSAGE_WAITING } from './turn-evidence-read'

import {
  type AskRow,
  type BindingRow,
  CLOSED_TURNS_FOR_PROVIDER_FAILURE,
  type ClosedTurnRow,
  type ExchangeRow,
  type ForestSessionRow,
  type GivenPiece,
  type GivenWorkRow,
  inLabelOrder,
  type KeptFileDbRow,
  type KeptFileRow,
  type KeptFilesAsked,
  MAX_SCHEDULE_EVIDENCE_ROWS,
  MAX_SCHEDULE_HISTORY_WALKED,
  type NewSessionRecord,
  type OpenTurnRow,
  PERSON_LAST_WROTE_WITHIN_TURNS,
  type PieceForAName,
  type ProviderFailureEpisode,
  type ProviderFailureEvidence,
  type ProviderFailureNoticeProgress,
  type QueuedPromptProgress,
  type RaisedQuestionRow,
  type ResourceDbRow,
  type ResourceRow,
  type ScheduleEvidenceRow,
  type SpawnedSessionRow,
  type WindowOpenWork,
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
import { agentIdentityRowId, foldProfileName, readIdentityCreator } from './identity'
import { newResourceId } from './ids'
import {
  aStallItsGiverCanBeToldOf,
  composeWhatEachPieceIsWaitingOn,
  derivePieces,
  theWorkThatNamesItAmong,
  waitsOnWhoWrote,
  workGivenOut,
  TASK_IS_OPEN,
  theWaitItMarks,
} from '../../shared/tasks'
import { pieceCalled, pieceNumbersOf, type WorkThatNamesIt } from '../../shared/piece-called'
import type { PieceFold } from '../../shared/piece-fold'
import {
  aPersonOwesAnAnswerIn,
  aPersonsSince,
  openQuestionsByWork,
  permissionShaped,
  REQUEST_IS_OPEN,
} from '../../shared/questions'
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
import {
  waitingOnAPerson,
  type InstructionAskWaiting,
  type InstructionEnding,
} from '../../shared/own-instructions'
import {
  mcpServerRequestsWaiting,
  type McpServerRequestWaiting,
} from '../../shared/mcp-server-requests'
import { formOfName, type ResourceRole } from '../../shared/documents'
import { workFileGroup } from '../../shared/work-file-groups'
import { WORK_BRIEF_CHARS } from '../../shared/work-fields'

export type { ForestedConversation, ForestedNode } from './forest-store'
import type { ForestedNode } from './forest-store'

export type { OpenTurn, LeftRunning, TurnAsItEnded } from './turn-evidence-read'
import { createTurnReadsPart } from './session-store-parts/turn-reads'
import { createWorkStatementsPart } from './session-store-parts/work-statements'
import { createLedgerEventsPart } from './session-store-parts/ledger-events'
import {
  ledgersSkippedOf,
  noSuchConversation,
  parseStrings,
  pieceStallOrdinals,
  readOrSkip,
  scheduleLevelFromRow,
  skipTheLedger,
  stalledInOrder,
  theFoldIndexHolds,
  underWhat,
  walkLedgers,
} from './session-store-parts/store-helpers'
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
  let reconciliationNames: AppStatement | undefined
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
    appendTx,
    foldQuestionsRaisedInSession,
    foldRoutedRequestsOfSession,
    forgetTheKeptFoldsOf,
    keptUntilItsLedgerGrows,
    namedByAPiece,
    pieceFoldFloors,
    questionsRaisedInSession,
    reconciliationCut,
    recordedTurnOpeningOf,
    routedRequestsOfSession,
    selectAProviderTurnsOpening,
    selectMaxOrdinal,
    selectOne,
    selectOpenTurn,
    selectQuestionsRaised,
    selectQuestionsRaisedMoved,
    selectRoutedRequestEvents,
    selectRoutedRequestEventsAfter,
    selectTheTurnsOpening,
    sessionCatalogueRead,
    theFoldsMayBeKept,
    theKeptOnly,
    wordsIn,
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
    bumpSequence,
    chainUp,
    identityRowFor,
    launchSql,
    nameForANewIdentity,
    namesRead,
    newestLineAbout,
    openRoot,
    retitlesOf,
    spawnSql,
    titleNow,
    workRowFrom,
    workRowWalked,
    workSql,
    writeIdentityRow,
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
  const {
    firstPersonOpening,
    selectBuildingSessions,
    selectRunningSessions,
    selectSessionsThatRouted,
    selectSubAgentReported,
    selectWorkflowAgentTask,
    selectWorkflowOutput,
    theNewestTurn,
  } = ledgerEvents

  const insertSession = db.prepare(
    `INSERT INTO provider_session (id, provider, cwd, status, approval_mode, profile_id, reasoning_effort, model, plan_mode, connection_id, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const readConnection = db.prepare(
    'SELECT connection_id, provider, external_ref FROM provider_session WHERE id = ?',
  )
  const blankToNull = (value: string | null | undefined): string | null => {
    if (value === null || value === undefined) return null
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  let modelListStatements: { read: AppStatement; write: AppStatement } | null = null
  const modelListSql = (): NonNullable<typeof modelListStatements> =>
    (modelListStatements ??= {
      read: db.prepare(
        `SELECT hand_added, last_model, last_effort FROM provider_model_setting WHERE provider = ?`,
      ),
      write: db.prepare(
        `INSERT INTO provider_model_setting (provider, hand_added, last_model, last_effort, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET
           hand_added = excluded.hand_added, last_model = excluded.last_model,
           last_effort = excluded.last_effort, updated_at = excluded.updated_at`,
      ),
    })
  interface APersonsList {
    readonly handAdded: readonly string[]
    readonly lastPicked: ModelAndEffort | null
  }
  const modelListOf = (provider: Provider): APersonsList => {
    const row = modelListSql().read.get(provider) as
      | {
          hand_added: string | null
          last_model: string | null
          last_effort: string | null
        }
      | undefined
    if (row === undefined) return { handAdded: [], lastPicked: null }
    const lastModel = blankToNull(row.last_model)
    return {
      handAdded: parseStrings(row.hand_added),
      lastPicked:
        lastModel === null ? null : { model: lastModel, effort: blankToNull(row.last_effort) },
    }
  }
  const writeTheList = db.transaction(
    (
      provider: Provider,
      change: (held: APersonsList) => APersonsList,
      at: number,
    ): APersonsList => {
      const next = change(modelListOf(provider))
      modelListSql().write.run(
        provider,
        next.handAdded.length === 0 ? null : JSON.stringify(next.handAdded),
        next.lastPicked?.model ?? null,
        next.lastPicked?.effort ?? null,
        at,
      )
      return next
    },
  )
  let externalMcpStatements: {
    listServers: AppStatement
    serverByName: AppStatement
    serverById: AppStatement
    insertServer: AppStatement
    deleteServer: AppStatement
    grantsOf: AppStatement
    serversUsableBy: AppStatement
    insertGrant: AppStatement
    clearGrantsOf: AppStatement
  } | null = null
  const externalMcpSql = (): NonNullable<typeof externalMcpStatements> =>
    (externalMcpStatements ??= {
      listServers: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server ORDER BY registered_at, name`,
      ),
      serverByName: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server WHERE name = ?`,
      ),
      serverById: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server WHERE id = ?`,
      ),
      insertServer: db.prepare(
        `INSERT OR IGNORE INTO external_mcp_server (id, name, url, registered_at, reach)
         VALUES (?, ?, ?, ?, ?)`,
      ),
      deleteServer: db.prepare(`DELETE FROM external_mcp_server WHERE id = ?`),
      /** Which servers one identity is granted, as ids — what a surface ticks its boxes from. */
      grantsOf: db.prepare(
        `SELECT server_id FROM external_mcp_server_grant WHERE identity_id = ? ORDER BY server_id`,
      ),
      serversUsableBy: db.prepare(
        `SELECT s.id, s.name, s.url, s.registered_at, s.reach
           FROM external_mcp_server s
          WHERE s.reach = 'everyone'
             OR EXISTS (SELECT 1 FROM external_mcp_server_grant g
                         WHERE g.server_id = s.id AND g.identity_id = ?)
          ORDER BY s.registered_at, s.name`,
      ),
      insertGrant: db.prepare(
        `INSERT OR IGNORE INTO external_mcp_server_grant (id, identity_id, server_id, granted_at)
         VALUES (?, ?, ?, ?)`,
      ),
      clearGrantsOf: db.prepare(`DELETE FROM external_mcp_server_grant WHERE identity_id = ?`),
    })

  const knowledgeHistory = createAgentKnowledgeHistory(
    db,
    memoryRecoveryStore,
    () => spawnSql().identityBySlug,
    () => spawnSql().identityNameById,
  )

  /** One `external_mcp_server` row as `better-sqlite3` hands it back. */
  type ExternalMcpRow = {
    id: string
    name: string
    url: string
    registered_at: number
    reach: unknown
  }

  const externalMcpFrom = (row: ExternalMcpRow): ExternalMcpServerRow => ({
    id: row.id,
    name: row.name,
    url: row.url,
    registeredAt: row.registered_at,
    reach: foldExternalMcpReach(row.reach),
  })

  /** The server ids one identity holds, by row id — used by the reader and by the save. */
  const grantedServerIds = (identityRowId: string): string[] =>
    (externalMcpSql().grantsOf.all(identityRowId) as { server_id: string }[]).map(
      (row) => row.server_id,
    )

  type IdentityRow = {
    id: string
    slug: string
    display_name: string | null
    provider: string | null
    created_at: number
    created_by: string | null
  }

  const identityFrom = (row: IdentityRow): AgentIdentity => {
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      createdAt: row.created_at,
      createdBy: readIdentityCreator(row.created_by),
      provider: parseProvider(row.provider),
      externalMcpServerIds: grantedServerIds(row.id),
    }
  }

  const writeAgentDisplayName = (id: string, displayName: string | null): boolean =>
    spawnSql().writeDisplayName.run(blankToNull(displayName), id).changes > 0

  const setAgentProviderTx = db.transaction(
    (profileSlug: string, provider: Provider | null): boolean => {
      const rowId = agentIdentityRowId(profileSlug)
      if (spawnSql().writeProvider.run(provider, rowId).changes === 0) return false
      if (provider === null) return true
      const held = spawnSql().readModelChoice.get(foldProfileName(profileSlug)) as
        { model_choice: string | null } | undefined
      const choice = held === undefined ? null : parseModelChoice(held.model_choice)
      if (choice !== null && choice.provider !== provider) {
        spawnSql().writeModelChoice.run(null, rowId)
      }
      return true
    },
  )

  const saveProviderIfNoneIsSavedTx = db.transaction(
    (profileSlug: string, provider: Provider): boolean => {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      if (row === undefined || parseProvider(row.provider) !== null) return false
      return spawnSql().writeProvider.run(provider, row.id).changes > 0
    },
  )

  const createAgentIdentityTx = db.transaction(
    (
      said: NewAgent,
      at: number,
      broughtIntoBeingBy: IdentityCreator | null,
    ): AgentIdentity | null => {
      const slug = foldProfileName(said.slug)
      if (spawnSql().identityBySlug.get(slug) !== undefined) return null
      writeIdentityRow(
        slug,
        at,
        {
          displayName: blankToNull(said.displayName) ?? nameForANewIdentity(slug),
          provider: said.provider,
        },
        broughtIntoBeingBy,
      )
      return identityFrom(spawnSql().identityBySlug.get(slug) as IdentityRow)
    },
  )

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
  const selectProviderOf = db.prepare(`SELECT provider FROM provider_session WHERE id = ?`)
  const serviceBirth = (owner: string, readPayload = false): string =>
    `SELECT ${readPayload ? "CASE WHEN length(payload) <= 2048 THEN payload ELSE '{}' END" : '1'}
       FROM events INDEXED BY events_kind_owner_idx
       WHERE type = 'service_registered' AND session_id = ${owner} AND generation = 0 AND ordinal = 0`
  const scheduleLevelsSql = (owners: string) =>
    `WITH levels AS MATERIALIZED (
       SELECT session_id, created_at, generation, ordinal, payload
         FROM events INDEXED BY events_kind_owner_idx
        WHERE ${FOLD_TERM} AND type = 'scheduled_work'
          AND ${owners}
          AND CASE WHEN json_valid(payload) THEN json_type(payload, '$.jobs') = 'array' ELSE 1 END
     ), candidates AS MATERIALIZED (
       SELECT session_id, payload FROM (
         SELECT session_id, payload, row_number() OVER (
                  PARTITION BY session_id ORDER BY created_at DESC, generation DESC, ordinal DESC
                ) AS nth
           FROM levels
       ) WHERE nth = 1
           AND CASE WHEN json_valid(payload)
                    THEN json_array_length(payload, '$.jobs') > 0
                         OR coalesce(json_extract(payload, '$.dropped'), 0) > 0
                    ELSE 1 END
     ), firsts AS MATERIALIZED (
       SELECT l.session_id, json_extract(job.value, '$.id') AS id, min(l.created_at) AS at
         FROM levels l JOIN candidates n ON n.session_id = l.session_id,
              json_each(CASE WHEN json_valid(l.payload) THEN l.payload ELSE '{}' END, '$.jobs') job
        WHERE json_type(job.value, '$.id') = 'text'
        GROUP BY 1, 2
     )
     SELECT n.session_id, n.payload,
            (SELECT json_group_object(f.id, f.at) FROM firsts f
              WHERE f.session_id = n.session_id) AS first_listed,
            (SELECT max(e.created_at) FROM events e INDEXED BY events_session_idx
              WHERE e.session_id = n.session_id AND e.type = 'compaction') AS compacted_at
       FROM candidates n`
  const selectNewestScheduleLevels = db.prepare(
    scheduleLevelsSql('(? IS NULL OR session_id IN (SELECT value FROM json_each(?)))'),
  )
  const selectNewestScheduleLevel = db.prepare(scheduleLevelsSql('session_id = ?'))
  const selectNewestTurnsOpened = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN payload END AS payload, created_at AS at
       FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'user_turn'
      ORDER BY ordinal DESC LIMIT ?`,
  )
  theFoldIndexHolds(selectNewestTurnsOpened)
  // The newest status row of a conversation's newest generation: one walk back down the index.
  const selectLastStatusAt = db.prepare(
    `SELECT created_at AS at FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND type = 'status'
      ORDER BY generation DESC, ordinal DESC LIMIT 1`,
  )
  const selectScheduleEvidenceRows = db.prepare(
    `WITH walk AS MATERIALIZED (
       SELECT ordinal, created_at, type, payload, generation
         FROM events INDEXED BY events_fold_idx
        WHERE ${FOLD_TERM} AND session_id = ?
        ORDER BY generation DESC, ordinal DESC
        LIMIT ?)
     SELECT ordinal, created_at, type, payload, generation, NULL AS walked FROM (
       SELECT ordinal, created_at, type, payload, generation,
              row_number() OVER (PARTITION BY kind
                                 ORDER BY created_at DESC, generation DESC,
                                          ordinal DESC) AS newest
         FROM (SELECT ordinal, created_at, type, payload, generation,
                      CASE WHEN type = 'launched' THEN 'life'
                           WHEN NOT json_valid(payload) THEN NULL
                           WHEN type = 'scheduled_work' AND json_extract(payload, '$.reset') = 1
                             THEN 'life'
                           WHEN type = 'status'
                             THEN CASE WHEN json_extract(payload, '$.state') IN ('ended', 'errored')
                                       THEN 'life' END
                           WHEN json_extract(payload, '$.receipt.tool') IN ('CronCreate', 'CronDelete')
                             THEN 'receipt'
                           WHEN json_type(payload, '$.receipt') IS NOT NULL THEN NULL
                           WHEN json_extract(payload, '$.source') LIKE 'app/%'
                             OR json_extract(payload, '$.source') LIKE 'this app%' THEN NULL
                           ELSE 'level' END AS kind
                 FROM walk
                WHERE type IN ('scheduled_work', 'launched', 'status'))
        WHERE kind IS NOT NULL)
      WHERE newest <= ?
     UNION ALL
     SELECT NULL, NULL, NULL, NULL, NULL, count(*) FROM walk
     ORDER BY created_at, ordinal, generation DESC`,
  )
  const selectPieceEvents = db.prepare(
    `SELECT ordinal,
            CASE WHEN json_valid(payload) THEN
                   CASE WHEN type IN ('user_turn', 'message_queued', 'message_unqueued')
                             AND json_extract(payload, '$.type') = type
                        THEN json_remove(payload, '$.sent', '$.given', '$.text')
                        ELSE json_remove(payload, '$.sent', '$.given') END
                 ELSE payload END AS payload,
            created_at FROM events
        INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                     'work_status_set', 'work_rebriefed', 'work_closed', 'message_unqueued',
                     'user_decision', 'reopened', 'reply_undelivered', 'message_queued',
                     'replaced_by', 'work_restarted', 'request_routed', 'request_stranded',
                     'user_turn', 'turn', 'status', 'work_interrupted', 'background_work',
                     'scheduled_work')
        AND ordinal >= ? AND ordinal < ?
      ORDER BY ordinal`,
  )
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
  const selectPlacedConversationsAmong = db.prepare(
    `SELECT provider_session.id AS id, identity.slug AS profile_slug,
            provider_session.provider AS provider, provider_session.status AS status,
            provider_session.created_at AS created_at,
            provider_session.updated_at AS updated_at,
            provider_session.parent_session_id AS parent_session_id
       FROM json_each(@ids) asked
       JOIN provider_session ON provider_session.id = asked.value
       JOIN agent_identity identity ON identity.id = provider_session.agent_identity_id
      WHERE provider_session.id NOT IN (SELECT value FROM json_each(@hidden))
      ORDER BY asked.key`,
  )

  /** Each placed conversation's node with the pieces it holds; parents and givers named against `drawn`. */
  function forestNodesAmong(
    placed: readonly ForestSessionRow[],
    drawn: ReadonlySet<string>,
  ): LedgerWalk<ForestedNode> {
    const unread = rowsUnreadOnce()
    const waiting = oneWaitReadPerHolder(unread)
    const identityOfGiver = identitiesOnce()
    return walkLedgers(
      'every-conversation-this-app-placed',
      placed,
      (sessionId, noteSkip, row) => {
        return [
          {
            node: 'a-conversation',
            conversation: row.id,
            under: underWhat(row.parent_session_id, drawn),
            identity: row.profile_slug,
            provider: row.provider as Provider,
            status: row.status as SessionStatus,
            startedAt: row.created_at,
            updatedAt: row.updated_at,
          },
          ...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).map(
            (piece) => ({
              node: 'a-task' as const,
              under: { is: 'a-conversation' as const, conversation: row.id },
              givenBy: underWhat(piece.giver, drawn),
              work: workEdge(piece, row.profile_slug, identityOfGiver(piece.giver)),
            }),
          ),
        ]
      },
      unread,
    )
  }

  function digestThroughOrdinal(id: string, generation: number): number {
    return (
      (selectMaxOrdinal.get(id, generation) as { max_ordinal: number | null } | undefined)
        ?.max_ordinal ?? -1
    )
  }
  const digestRead = createDigestWindowRead(db, activeGeneration, digestThroughOrdinal)
  const countConversationsHeldByNoAgent = db.prepare(
    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NULL`,
  )
  const selectOwnersGivenWorkBy = db.prepare(
    `SELECT DISTINCT w.owner_session_id AS id, identity.slug AS identity
       FROM work w
       LEFT JOIN provider_session s ON s.id = w.owner_session_id
       LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
      WHERE w.given_by_session_id = ?`,
  )
  const selectTurnBlockCandidates = db.prepare(
    `SELECT id AS piece, owner_session_id AS owner FROM work
      WHERE given_by_session_id = ?
        AND (? IS NULL OR (created_at, id) < (SELECT created_at, id FROM work WHERE id = ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
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

  const selectTurnBlockInstructions = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal, json_valid(payload) AS readable, payload
       FROM events WHERE session_id = ? AND type IN ('instruction_proposed', 'instruction_settled')
       ORDER BY created_at, ordinal`,
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
  const selectTheDecisionOn = db.prepare(
    `SELECT payload FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type = 'user_decision'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END = ?
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
  const selectInstructionAsks = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal,
            -- D-017 · R8: which rows are torn, so the reader skips them and says so.
            json_valid(payload) AS readable, payload
       FROM events
      WHERE type IN ('instruction_proposed', 'instruction_settled')
      ORDER BY created_at, session_id, ordinal`,
  )
  const selectMcpServerRequests = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal,
            json_valid(payload) AS readable, payload
       FROM events
      WHERE type IN ('mcp_server_requested', 'mcp_server_request_settled')
      ORDER BY created_at, session_id, ordinal`,
  )
  // Prefer the recent date range over a scan of every error, without requiring a named index.
  const { providerLimitsSeen, readAheadProviderWalls } = createProviderLimitReader(
    db,
    connection,
    activeGeneration,
    readPhases,
    noteUnreadRow,
    theFoldIndexHolds,
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

  type StrandedMessages = {
    stranded: { session_id: string; message_id: string; text: string | null; payload: string }[]
    torn: { session_id: string; ordinal: number }[]
  }

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
  const selectLegacyStallCut = db.prepare(
    'SELECT generation, through_ordinal FROM work_legacy_stall_cut WHERE session_id = ?',
  )
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
  const piecesKeptOnly = theKeptOnly(foldPiecesKept)
  const piecesAtHand = (owner: string) => piecesKeptOnly(owner)?.answer ?? null
  const routedRequestsKeptOnly = theKeptOnly(foldRoutedRequestsOfSession)
  const routedRequestsAtHand = (sessionId: string) =>
    routedRequestsKeptOnly(sessionId)?.answer ?? null
  const questionsRaisedAtHand = theKeptOnly(foldQuestionsRaisedInSession)
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

  let selectNewestRecovery: AppStatement | undefined

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

  function walkWorkGivenBy<Row extends { readonly givenAt: number; readonly piece: string }>(
    sessionId: string,
    map: (piece: PieceRow, candidate: GivenWorkRow) => Row,
  ): LedgerWalk<Row> {
    const unread = rowsUnreadOnce()
    const owners = selectOwnersGivenWorkBy.all(sessionId) as GivenWorkRow[]
    const waiting = oneWaitReadPerHolder(unread)
    const walked = walkLedgers(
      'every-conversation-this-one-gave-work-to',
      owners,
      (owner, noteSkip, candidate) =>
        composeWhatEachPieceIsWaitingOn(
          [...piecesOfSession(owner, noteSkip)].filter((piece) => piece.giver === sessionId),
          waiting,
        ).map((piece) => map(piece, candidate)),
      unread,
    )
    return {
      walk: walked.walk,
      ledgers: walked.ledgers,
      rowsUnread: walked.rowsUnread,
      ...ledgersSkippedOf(walked.ledgersSkipped),
      rows: [...walked.rows].sort(
        (left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1),
      ),
    }
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
  const { workersBorn, workerGiverContains, workerInItsPlace, workerReplacementChain } =
    createWorkerRecordsRead(db, selectOne)

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

  type PendingProposalLedgerRow = {
    conversation: string
    at: number
    ordinal: number
    readable: number
    payload: string
  }

  function decodeProposalRows<Event extends object>(
    rows: readonly PendingProposalLedgerRow[],
    id: keyof Event,
    missingId: string,
    unread: RowsUnread | undefined,
  ): { conversation: string; at: number; event: Event }[] {
    return rows.flatMap((row) => {
      if (row.readable === 0) {
        noteUnreadRow(row.conversation, row.ordinal, unread?.in(row.conversation))
        return []
      }
      try {
        const event = JSON.parse(row.payload) as Event | null
        if (event === null || typeof event[id] !== 'string') throw new Error(missingId)
        return [{ conversation: row.conversation, at: row.at, event }]
      } catch (error) {
        console.warn(
          `session ledger: ${row.conversation} ordinal ${String(row.ordinal)} could not be read ` +
            `and was skipped (${error instanceof Error ? error.message : String(error)})`,
        )
        unread?.in(row.conversation)(row.ordinal)
        return []
      }
    })
  }

  const instructionAsksWaiting = (unread?: RowsUnread): readonly InstructionAskWaiting[] =>
    waitingOnAPerson(
      decodeProposalRows<InstructionProposedEvent | InstructionSettledEvent>(
        selectInstructionAsks.all() as PendingProposalLedgerRow[],
        'askId',
        'an instruction row with no ask id',
        unread,
      ),
    )

  const settleInstructionAskTx = db.transaction(
    (askId: string, ending: InstructionEnding, by: ActedBy, at: number): boolean => {
      const waiting = instructionAsksWaiting().find((one) => one.asked.askId === askId)
      if (waiting === undefined) return false
      const generation = activeGeneration(waiting.conversation)
      const highest = selectMaxOrdinal.get(waiting.conversation, generation) as
        { max_ordinal: number | null } | undefined
      appendTx(
        waiting.conversation,
        (highest?.max_ordinal ?? -1) + 1,
        { type: 'instruction_settled', askId, ending, by },
        at,
        generation,
        true,
      )
      return true
    },
  )

  /** Every MCP server request still waiting: {@link instructionAsksWaiting}'s read, for requests. */
  const mcpServerRequestsWaitingNow = (unread?: RowsUnread): readonly McpServerRequestWaiting[] =>
    mcpServerRequestsWaiting(
      decodeProposalRows<McpServerRequestedEvent | McpServerRequestSettledEvent>(
        selectMcpServerRequests.all() as PendingProposalLedgerRow[],
        'requestId',
        'an MCP server request row with no request id',
        unread,
      ),
    )

  /** Whether any readable row is the request by this id, waiting or settled. */
  const mcpServerRequestWasMade = (requestId: string): boolean =>
    (selectMcpServerRequests.all() as { readable: number; payload: string }[]).some((row) => {
      if (row.readable === 0) return false
      try {
        const event = JSON.parse(row.payload) as { type?: unknown; requestId?: unknown } | null
        return event?.type === 'mcp_server_requested' && event.requestId === requestId
      } catch {
        return false
      }
    })

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

  const identitiesOnce = (): ((sessionId: string | null) => string | null) => {
    const known = new Map<string, string | null>()
    return (sessionId) => {
      if (sessionId === null) return null
      if (known.has(sessionId)) return known.get(sessionId) ?? null
      const row = spawnSql().identityOfSession.get(sessionId) as
        { profile_slug: string } | undefined
      const identity = row?.profile_slug ?? null
      known.set(sessionId, identity)
      return identity
    }
  }

  const resourceFrom = (row: ResourceDbRow): ResourceRow => ({
    resource: row.id,
    piece: row.work_id,
    role: row.role as ResourceRole,
    title: row.title,
    summary: row.summary,
    name: row.name,
    sha256: row.sha256,
    bytes: row.bytes,
    addedBy: row.added_by_session_id,
    createdAt: row.created_at,
  })

  const treeOf = (
    asked: Extract<KeptFilesAsked, { readonly scope: 'tree' }>,
  ): { readonly holder: string; readonly givers: string } => ({
    holder: asked.holder,
    givers: JSON.stringify(asked.givers),
  })

  const onTheirPieces = (
    rows: readonly KeptFileDbRow[],
  ): readonly { readonly file: KeptFileRow; readonly numbers: readonly number[] }[] => {
    type Named = {
      readonly numbers: readonly number[]
      readonly title: string | null
      readonly returned: ReadonlySet<string> | null
      readonly mainResult: string | null
    } | null
    const pieces = new Map<string, Named>()
    const replies = new Map<string, ReadonlyMap<string, PieceRow> | null>()
    const generations = new Map<string, number>()
    const retitles = new Map<string, ReadonlyMap<string, Record<string, unknown>>>()
    const newestRetitle = (
      piece: WorkDbRow,
      generation: number,
    ): Record<string, unknown> | null => {
      let owners = retitles.get(piece.owner_session_id)
      if (owners === undefined) {
        owners = retitlesOf(piece.owner_session_id, generation)
        retitles.set(piece.owner_session_id, owners)
      }
      return owners.get(piece.id) ?? null
    }
    const named = (id: string): Named => {
      const known = pieces.get(id)
      if (known !== undefined) return known
      const row = workSql().byId.get(id) as WorkDbRow | undefined
      let found: Named = null
      if (row !== undefined) {
        let generation = generations.get(row.owner_session_id)
        if (generation === undefined) {
          generation = activeGeneration(row.owner_session_id)
          generations.set(row.owner_session_id, generation)
        }
        let owned = replies.get(row.owner_session_id)
        if (owned === undefined) {
          let unread = false
          const folded = piecesOfSession(row.owner_session_id, () => {
            unread = true
          })
          owned = unread ? null : new Map(folded.map((piece) => [piece.piece, piece]))
          replies.set(row.owner_session_id, owned)
        }
        const returned =
          row.parent_id === null
            ? new Set<string>()
            : owned === null || !owned.has(row.id)
              ? null
              : new Set(owned.get(row.id)!.resources)
        const documents =
          returned === null
            ? []
            : [...returned].filter((id) => {
                const resource = workSql().resourceById.get(id) as ResourceDbRow | undefined
                if (resource?.work_id !== row.id || resource.role !== 'made') return false
                const form = formOfName(resource.name)
                return form === 'markdown' || form === 'page'
              })
        found = {
          numbers: [...chainUp(row)].reverse().map((each) => each.number),
          title: titleNow(row, generation, newestRetitle),
          returned,
          mainResult: documents.includes(owned?.get(row.id)?.resultDocument ?? '')
            ? owned!.get(row.id)!.resultDocument!
            : documents.length === 1
              ? documents[0]!
              : null,
        }
      }
      pieces.set(id, found)
      return found
    }
    return rows.flatMap((row) => {
      const on = named(row.work_id)
      if (on === null) return []
      const group = workFileGroup(
        { role: row.role as ResourceRole, form: formOfName(row.name) },
        on.returned === null ? null : on.returned.has(row.id),
      )
      return [
        {
          file: {
            ...(group === null ? {} : { group }),
            ...(on.mainResult === row.id ? { mainResult: true as const } : {}),
            resource: resourceFrom(row),
            label: pieceCalled(on.numbers),
            pieceTitle: on.title,
            addedByIdentity: row.added_by_identity,
          },
          numbers: on.numbers,
        },
      ]
    })
  }

  /** Label order, then creation time and id within each piece. */
  const namedFiles = (rows: readonly KeptFileDbRow[]): readonly KeptFileRow[] => {
    return [...onTheirPieces(rows)]
      .sort(
        (a, b) =>
          inLabelOrder(a.numbers, b.numbers) ||
          a.file.resource.createdAt - b.file.resource.createdAt ||
          (a.file.resource.resource < b.file.resource.resource ? -1 : 1),
      )
      .map((one) => one.file)
  }

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

  const writeAFirstLaunch = db.prepare(
    `UPDATE provider_session SET reasoning_effort = ?, model = ?, plan_mode = ?, connection_id = COALESCE(connection_id, ?), updated_at = ?
      WHERE id = ? AND external_ref IS NULL`,
  )
  const selectALaunchUnnamed = db.prepare(
    `SELECT 1 FROM provider_session
      WHERE id = ? AND external_ref IS NULL AND launched_as IS NOT NULL`,
  )
  const connectionBelongsToProvider = db.prepare(
    'SELECT 1 FROM provider_connection WHERE id = ? AND provider = ?',
  )
  function assertConnectionProvider(provider: Provider, connectionId: string): void {
    if (!connectionBelongsToProvider.get(connectionId, provider))
      throw new Error('The selected connection is unavailable')
  }
  const firstLaunchTx = db.transaction(
    (
      record: Pick<
        NewSessionRecord,
        'id' | 'model' | 'reasoningEffort' | 'planMode' | 'launchedAs' | 'connectionId'
      >,
      at: number,
    ): boolean => {
      const prior = readConnection.get(record.id) as
        | {
            connection_id: string | null
            provider: Provider
            external_ref: string | null
          }
        | undefined
      if (!prior || prior.external_ref !== null) return false
      if (record.connectionId !== undefined) {
        if (prior.connection_id !== null && prior.connection_id !== record.connectionId)
          throw new Error('The recorded connection cannot be replaced')
        assertConnectionProvider(prior.provider, record.connectionId)
      }
      const wrote = writeAFirstLaunch.run(
        record.reasoningEffort ?? null,
        record.model ?? null,
        record.planMode === undefined ? null : record.planMode ? 1 : 0,
        record.connectionId ?? null,
        at,
        record.id,
      )
      if (wrote.changes === 0) return false
      if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)
      return true
    },
  )

  const createTx = db.transaction((record: NewSessionRecord, at: number) => {
    if (record.connectionId !== undefined)
      assertConnectionProvider(record.provider, record.connectionId)
    const identityId = identityRowFor(record.profileId, at)
    if (record.worker !== undefined) {
      const fact = workerRegistrationOf({ type: 'worker_registered', ...record.worker })
      const identity = spawnSql().identityBySlug.get(foldProfileName(record.profileId)) as
        { created_at: number } | undefined
      if (
        fact === null ||
        fact.identity !== identityId ||
        fact.identityCreatedAt !== identity?.created_at ||
        record.parentSessionId === undefined ||
        record.service === true ||
        !workerGiverContains(fact.giver, record.parentSessionId)
      ) {
        throw new Error('worker registration does not match the new conversation')
      }
      if (
        workersBorn().some(
          (one) =>
            one.identity === fact.identity &&
            one.giver === fact.giver &&
            one.number === fact.number,
        )
      ) {
        throw new Error('worker number is already registered')
      }
    }
    insertSession.run(
      record.id,
      record.provider,
      record.cwd,
      record.approvalMode,
      record.profileId,
      record.reasoningEffort ?? null,
      record.model ?? null,
      record.planMode === undefined ? null : record.planMode ? 1 : 0,
      record.connectionId ?? null,
      at,
      at,
    )
    spawnSql().writeIdentityOnSession.run(identityId, record.id)
    if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)
    if (record.parentSessionId !== undefined) {
      if (record.service === true) throw new Error('a service is started by no conversation')
      spawnSql().writeParent.run(record.parentSessionId, record.id)
    } else if (record.serviceStandingTitle !== undefined) {
      const identity = spawnSql().identityBySlug.get(foldProfileName(record.profileId)) as
        { created_at: number } | undefined
      if (record.service !== true || identity === undefined)
        throw new Error('service registration does not match the new conversation')
      openRoot(record.id, at, record.serviceStandingTitle)
      appendTx(
        record.id,
        0,
        {
          type: 'service_registered',
          identity: identityId,
          identityCreatedAt: identity.created_at,
        },
        at,
        0,
        true,
      )
    } else if (record.service !== true) {
      openRoot(record.id, at)
    }
    if (record.worker !== undefined) {
      appendTx(record.id, 0, { type: 'worker_registered', ...record.worker }, at, 0, true)
    }
  })

  return {
    ...ownNotesStore,
    ...turnReads.methods,
    ...workStatements.methods,
    ...ledgerEvents.methods,
    canReadFreshSnapshot() {
      return (
        selectPieceEvents.busy === false &&
        selectRoutedRequestEvents.busy === false &&
        selectWorkflowOutput.busy === false &&
        selectWorkflowAgentTask.busy === false &&
        selectSubAgentReported.busy === false &&
        selectNewestTurnsOpened.busy === false
      )
    },
    create(record) {
      createTx(record, now())
    },
    connectionOf(sessionId) {
      const row = readConnection.get(sessionId) as { connection_id: string | null } | undefined
      return row?.connection_id ?? null
    },
    firstLaunchOf(record) {
      return firstLaunchTx(record, now())
    },
    aLaunchWentUnnamed(sessionId) {
      return selectALaunchUnnamed.get(sessionId) !== undefined
    },

    identityOf(sessionId) {
      const row = spawnSql().identityOfSession.get(sessionId) as
        { profile_slug: string } | undefined
      return row === undefined ? null : { profileSlug: row.profile_slug }
    },

    agentIdentityOf(profileSlug) {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      return row === undefined ? null : identityFrom(row)
    },

    ownInstructionsOf: knowledgeHistory.ownInstructionsOf,
    currentOwnInstructionsOf: knowledgeHistory.currentOwnInstructionsOf,
    readCurrentAgentRules: knowledgeHistory.readCurrentAgentRules,
    configuredLayerFor: knowledgeHistory.configuredLayerFor,
    writeDirectAgentRules(said, at, afterCommit) {
      return knowledgeHistory.writeDirectAgentRules(this, said, at, afterCommit)
    },

    writeOwnInstructions(said, at) {
      return knowledgeHistory.writeOwnInstructions(this, said, at)
    },
    undoOwnInstructions(profileSlug, expectedVersion, by, at) {
      return knowledgeHistory.undoOwnInstructions(this, profileSlug, expectedVersion, by, at)
    },
    instructionUnread: knowledgeHistory.instructionUnread,
    markInstructionsSeen: knowledgeHistory.markInstructionsSeen,

    beginMethodChange(profileSlug, said, by, at) {
      return methodChangeStore.begin(agentIdentityRowId(foldProfileName(profileSlug)), said, by, at)
    },
    settleMethodChange(profileSlug, id, outcome, actual, by) {
      return methodChangeStore.settle(
        agentIdentityRowId(foldProfileName(profileSlug)),
        id,
        outcome,
        actual,
        by,
      )
    },
    hasPendingMethodChange(profileSlug) {
      return methodChangeStore.hasPending(agentIdentityRowId(foldProfileName(profileSlug)))
    },
    methodChange(profileSlug, id) {
      return methodChangeStore.read(agentIdentityRowId(foldProfileName(profileSlug)), id)
    },
    methodChanges(profileSlug, offset = 0, limit = 50) {
      return methodChangeStore.list(agentIdentityRowId(foldProfileName(profileSlug)), offset, limit)
    },

    memoryAmendmentsOf: knowledgeHistory.memoryAmendmentsOf,
    writeMemoryAmendment: knowledgeHistory.writeMemoryAmendment,
    beginMemoryAmendment: knowledgeHistory.beginMemoryAmendment,
    settleMemoryAmendment: knowledgeHistory.settleMemoryAmendment,
    hasPendingMemoryAmendment: knowledgeHistory.hasPendingMemoryAmendment,
    memoryAmendment: knowledgeHistory.memoryAmendment,

    instructionAskersAmong(owners, unread) {
      return readInstructionAskers(db, owners, (owner, ordinal) =>
        noteUnreadRow(owner, ordinal, unread.in(owner)),
      )
    },
    instructionAsksWaiting(unread) {
      return instructionAsksWaiting(unread)
    },

    settleInstructionAsk(askId, ending, by, at) {
      return settleInstructionAskTx(askId, ending, by, at)
    },

    mcpServerRequestsWaiting(unread) {
      return mcpServerRequestsWaitingNow(unread)
    },

    mcpServerRequestWasMade(requestId) {
      return mcpServerRequestWasMade(requestId)
    },

    agentIdentityNameById(id) {
      return (spawnSql().identityNameById.get(id) as AgentIdentityName | undefined) ?? null
    },
    agentIdentities() {
      return (spawnSql().listIdentities.all() as IdentityRow[]).map(identityFrom)
    },
    agentIdentityPage(after, limit) {
      const sql = spawnSql()
      return db.transaction(() => ({
        identities: sql.identityPage.all(after, limit) as Pick<
          AgentIdentity,
          'id' | 'slug' | 'displayName' | 'createdAt'
        >[],
        count: (sql.countIdentities.get() as { count: number }).count,
      }))()
    },
    reconciliationNames(conversations) {
      if (conversations.length === 0) return []
      reconciliationNames ??= db.prepare(
        `SELECT s.id AS conversation, identity.id, identity.slug,
                identity.display_name AS displayName
           FROM provider_session s
           JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id IN (SELECT value FROM json_each(?))`,
      )
      return reconciliationNames.all(JSON.stringify(conversations)) as (AgentIdentityName & {
        conversation: string
      })[]
    },
    createAgentIdentity(said, broughtIntoBeingBy) {
      return createAgentIdentityTx(said, now(), broughtIntoBeingBy)
    },
    providerOf(profileSlug) {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      return row === undefined ? null : parseProvider(row.provider)
    },

    startedOnOf(profileSlug) {
      const rows = spawnSql().startedOnOf.all(agentIdentityRowId(profileSlug)) as {
        provider: string
        started: number
      }[]
      return rows.reduce<StartedOn>((on, row) => {
        const provider = parseProvider(row.provider)
        return provider === null ? on : { ...on, [provider]: on[provider] + row.started }
      }, NONE_STARTED)
    },

    saveProviderIfNoneIsSaved(profileSlug, provider) {
      return saveProviderIfNoneIsSavedTx(profileSlug, provider)
    },

    setAgentProvider(profileSlug, provider) {
      return setAgentProviderTx(profileSlug, provider)
    },

    setAgentDisplayName(profileSlug, displayName) {
      return writeAgentDisplayName(agentIdentityRowId(profileSlug), displayName)
    },

    async renameAgentDisplayName(profileSlug, displayName) {
      const id = agentIdentityRowId(profileSlug)
      return this.atomically(() => {
        if (!writeAgentDisplayName(id, displayName)) return null
        const row = spawnSql().identityById.get(id) as IdentityRow | undefined
        return row === undefined ? null : identityFrom(row)
      })
    },

    modelChoiceOf(profileSlug) {
      const row = spawnSql().readModelChoice.get(foldProfileName(profileSlug)) as
        { model_choice: string | null } | undefined
      return row === undefined ? null : parseModelChoice(row.model_choice)
    },

    setModelChoice(profileSlug, choice) {
      return (
        spawnSql().writeModelChoice.run(modelChoiceWritten(choice), agentIdentityRowId(profileSlug))
          .changes > 0
      )
    },

    handAddedModels(provider) {
      return modelListOf(provider).handAdded
    },
    addHandAddedModel(provider, model, at) {
      return writeTheList(
        provider,
        (held) => ({
          ...held,
          handAdded: held.handAdded.some((one) => sameModel(one, model))
            ? held.handAdded
            : [...held.handAdded, model],
        }),
        at,
      ).handAdded
    },
    deleteHandAddedModel(provider, model, at) {
      return writeTheList(
        provider,
        (held) => ({ ...held, handAdded: held.handAdded.filter((one) => one !== model) }),
        at,
      ).handAdded
    },
    lastPicked(provider) {
      return modelListOf(provider).lastPicked
    },
    hasSealedApiKey(provider) {
      return (
        db.prepare('SELECT 1 FROM provider_api_key WHERE provider = ?').get(provider) !== undefined
      )
    },
    forgetSealedApiKey(provider) {
      db.prepare('DELETE FROM provider_api_key WHERE provider = ?').run(provider)
    },
    aPersonPicked(provider, pair, at) {
      writeTheList(provider, (held) => ({ ...held, lastPicked: pair }), at)
    },

    conversationsPerIdentity() {
      const rows = spawnSql().conversationsPerIdentity.all() as {
        identity: string
        provider: string
        conversations: number
        started: number
      }[]
      const byIdentity = new Map<string, { conversations: number; startedOn: StartedOn }>()
      for (const row of rows) {
        const was = byIdentity.get(row.identity) ?? { conversations: 0, startedOn: NONE_STARTED }
        const provider = parseProvider(row.provider)
        byIdentity.set(row.identity, {
          conversations: was.conversations + row.conversations,
          startedOn:
            provider === null
              ? was.startedOn
              : { ...was.startedOn, [provider]: was.startedOn[provider] + row.started },
        })
      }
      return [...byIdentity].map(([identityId, one]) => ({ identityId, ...one }))
    },

    removeAgentIdentity(profileSlug) {
      return db.transaction(() => {
        const rowId = agentIdentityRowId(profileSlug)
        if (methodChangeStore.hasPending(rowId) || memoryRecoveryStore.hasPending(rowId))
          return false
        return spawnSql().deleteIdentity.run(rowId).changes > 0
      })()
    },

    externalMcpServers() {
      return (externalMcpSql().listServers.all() as ExternalMcpRow[]).map(externalMcpFrom)
    },

    registerExternalMcpServer(said) {
      const name = foldProfileName(said.name)
      const id = externalMcpServerRowId(name)
      const wrote =
        externalMcpSql().insertServer.run(
          id,
          name,
          said.url,
          now(),
          foldExternalMcpReach(said.reach),
        ).changes > 0
      if (!wrote) return null
      const row = externalMcpSql().serverByName.get(name) as ExternalMcpRow | undefined
      return row === undefined ? null : externalMcpFrom(row)
    },

    removeExternalMcpServer(serverId) {
      return externalMcpSql().deleteServer.run(serverId).changes > 0
    },

    externalMcpServersFor(profileSlug) {
      return (
        externalMcpSql().serversUsableBy.all(agentIdentityRowId(profileSlug)) as ExternalMcpRow[]
      ).map(externalMcpFrom)
    },

    grantExternalMcpServer(serverName, profileSlugs) {
      return db.transaction(() => {
        const server = externalMcpSql().serverByName.get(foldProfileName(serverName)) as
          ExternalMcpRow | undefined
        if (server === undefined) return null
        const granted: string[] = []
        const missing: string[] = []
        const at = now()
        for (const slug of new Set(profileSlugs.map((one) => foldProfileName(one)))) {
          if (spawnSql().identityBySlug.get(slug) === undefined) {
            missing.push(slug)
            continue
          }
          externalMcpSql().insertGrant.run(
            externalMcpGrantRowId(slug, server.name),
            agentIdentityRowId(slug),
            server.id,
            at,
          )
          granted.push(slug)
        }
        return { granted, missing }
      })()
    },

    setExternalMcpServers(profileSlug, externalMcpServerIds) {
      const rowId = agentIdentityRowId(profileSlug)
      if (spawnSql().identityBySlug.get(foldProfileName(profileSlug)) === undefined) return false
      db.transaction(() => {
        externalMcpSql().clearGrantsOf.run(rowId)
        const at = now()
        for (const serverId of new Set(externalMcpServerIds)) {
          const row = externalMcpSql().serverById.get(serverId) as ExternalMcpRow | undefined
          if (row === undefined) continue
          externalMcpSql().insertGrant.run(
            externalMcpGrantRowId(profileSlug, row.name),
            rowId,
            row.id,
            at,
          )
        }
      })()
      return true
    },

    defaultApprovalModeChosen() {
      const row = spawnSql().readApprovalDefault.get() as
        { default_approval_mode: string | null } | undefined
      return row?.default_approval_mode === 'ask' || row?.default_approval_mode === 'auto'
    },

    defaultApprovalMode() {
      const row = spawnSql().readApprovalDefault.get() as
        { default_approval_mode: string | null } | undefined
      return row?.default_approval_mode === 'auto' ? 'auto' : 'ask'
    },

    setDefaultApprovalMode(mode) {
      spawnSql().writeApprovalDefault.run(mode)
    },

    ...sessionModels,

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

    addResource(input, at) {
      const id = newResourceId()
      db.transaction(() => {
        committed.kept(input.piece, id)
        workSql().insertResource.run(
          id,
          input.piece,
          input.role,
          input.title,
          input.summary,
          input.name,
          input.sha256,
          input.bytes,
          input.addedBy,
          at,
        )
      })()
      return { ...input, resource: id, createdAt: at }
    },

    resourcesOf(piece, after = null, limit = -1) {
      return (
        workSql().resourcesOf.all({
          piece,
          at: after?.createdAt ?? null,
          id: after?.resource ?? null,
          limit,
        }) as ResourceDbRow[]
      ).map(resourceFrom)
    },

    countResourcesAfter(piece, after) {
      return (
        workSql().countResourcesAfter.get({
          piece,
          at: after?.createdAt ?? null,
          id: after?.resource ?? null,
        }) as { total: number }
      ).total
    },

    filesKept(asked) {
      const rows = (
        asked.scope === 'piece'
          ? workSql().filesOnPiece.all(asked.piece)
          : asked.scope === 'conversation'
            ? workSql().filesAddedBy.all(asked.conversation)
            : workSql().filesUnder.all(treeOf(asked))
      ) as KeptFileDbRow[]
      return namedFiles(rows)
    },

    filesKeptTogether(asked) {
      const tree = workSql().filesUnder.all(treeOf(asked)) as KeptFileDbRow[]
      const added = workSql().filesAddedBy.all(asked.holder) as KeptFileDbRow[]
      const treeIds = new Set(tree.map((row) => row.id))
      const addedIds = new Set(added.map((row) => row.id))
      const union = new Map([...tree, ...added].map((row) => [row.id, row]))
      const files = namedFiles([...union.values()])
      return {
        tree: files.filter((row) => treeIds.has(row.resource.resource)),
        added: files.filter((row) => addedIds.has(row.resource.resource)),
      }
    },

    keptFilesNewestFirst(asked, page) {
      const rows = (
        asked.scope === 'tree'
          ? workSql().newestKeptUnder.all({
              ...treeOf(asked),
              from: page.olderThan,
              limit: page.limit,
            })
          : workSql().newestKeptAnywhere.all({ from: page.olderThan, limit: page.limit })
      ) as KeptFileDbRow[]
      return { rows: onTheirPieces(rows).map((one) => one.file), through: rows.at(-1)?.id ?? null }
    },

    keptFilesBefore(asked, olderThan, cap) {
      const counted = (
        asked.scope === 'tree'
          ? workSql().keptUnderCount.get({ ...treeOf(asked), from: olderThan, cap })
          : workSql().keptAnywhereCount.get({ from: olderThan, cap })
      ) as { total: number }
      return counted.total
    },

    madeBy(profileSlug, limit) {
      const identityId = agentIdentityRowId(profileSlug)
      return {
        rows: onTheirPieces(workSql().madeBy.all(identityId, limit) as KeptFileDbRow[]).map(
          (one) => one.file,
        ),
        total: (workSql().madeByCount.get(identityId) as { total: number }).total,
      }
    },

    resource(id) {
      const row = workSql().resourceById.get(id) as ResourceDbRow | undefined
      return row === undefined ? null : resourceFrom(row)
    },

    untitledResources(limit) {
      return (workSql().untitledResources.all(limit) as ResourceDbRow[]).map(resourceFrom)
    },

    titleResource(id, title) {
      return workSql().titleResource.run(title, id).changes > 0
    },

    titledResources(after, limit, keptBefore) {
      const rows = workSql().titledResources.all({ after, limit, keptBefore }) as (ResourceDbRow & {
        at: number
      })[]
      return rows.map((row) => ({ at: row.at, row: resourceFrom(row) }))
    },

    retitleResource(id, was, title) {
      return workSql().retitleResource.run({ id, was, title }).changes > 0
    },

    activityWindow(from, to) {
      return digestRead.activityWindow(from, to)
    },

    digestWindow(from, to) {
      return digestRead.digestWindow(from, to)
    },

    conversationsHeldByNoAgent() {
      return (countConversationsHeldByNoAgent.get() as { n: number }).n
    },

    forestListing(asked) {
      return forestListing(db, asked)
    },

    forestNodesOf(conversations, drawn, hidden) {
      const placed = selectPlacedConversationsAmong.all({
        ids: JSON.stringify(conversations),
        hidden: JSON.stringify(hidden),
      }) as ForestSessionRow[]
      const found = new Set(placed.map((row) => row.id))
      return {
        nodes: forestNodesAmong(placed, drawn),
        gone: conversations.filter((id) => !found.has(id)),
      }
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

    workReportedTo(sessionId) {
      if (!oneSnapshot) return stallsToldToSession(sessionId)
      // Read with a note so a complete fold is kept; a ledger with an unread row is read as before.
      let unread = false
      const told = stallsToldToSession(sessionId, () => {
        unread = true
      })
      return unread ? stallsToldToSession(sessionId) : told
    },
    legacyOrdinaryStallWasReported(owner, piece, giver) {
      const cut = selectLegacyStallCut.get(owner) as
        { generation: number; through_ordinal: number } | undefined
      if (cut === undefined || cut.generation !== activeGeneration(owner)) return false
      let unread = false
      const pieces = piecesOfSession(owner, () => {
        unread = true
      })
      const ordinal = pieceStallOrdinals.get(pieces)?.get(piece)
      if (unread || ordinal === undefined || ordinal > cut.through_ordinal) return false
      try {
        let told = false
        for (const id of workerReplacementChain(giver)) {
          let incomplete = false
          const receipts = stallsToldToSession(id, () => {
            incomplete = true
          })
          if (incomplete) return false
          if (receipts.has(piece)) told = true
        }
        return told
      } catch {
        return false
      }
    },

    workGivenOutBy(sessionId) {
      return walkWorkGivenBy(sessionId, (piece, candidate) =>
        workGivenOut(piece, candidate.identity),
      )
    },

    workThisOneGaveOut(sessionId) {
      const giver = identitiesOnce()(sessionId)
      return walkWorkGivenBy(sessionId, (piece, candidate) =>
        workEdge(piece, candidate.identity, giver),
      )
    },

    workThisOneWasGiven(sessionId) {
      const mine = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined
      const identity = mine?.identity ?? null
      const identityOfGiver = identitiesOnce()
      const unread = rowsUnreadOnce()
      const waiting = oneWaitReadPerHolder(unread)
      return walkLedgers(
        'every-piece-of-work-this-one-was-given',
        [{ id: sessionId }],
        (held, noteSkip) =>
          composeWhatEachPieceIsWaitingOn(piecesOfSession(held, noteSkip), waiting).map((piece) =>
            workEdge(piece, identity, identityOfGiver(piece.giver)),
          ),
        unread,
      )
    },

    conversationTree(root) {
      return conversationTree(db, root)
    },

    whatTiesTheTreeOutside(tree) {
      return whatTiesTheTreeOutside(db, tree)
    },

    providerSessionsOf(conversation) {
      return providerSessionsOf(db, conversation)
    },

    deleteTheTree(tree) {
      const deleted = deleteTheTree(db, tree)
      for (const id of tree) {
        forgetTheKeptFoldsOf(id)
        ledgerWrites.delete(id)
      }
      return deleted
    },

    spawnedBy(sessionId) {
      if (spawnSql().conversationBinding.get(sessionId) === undefined) return noSuchConversation()
      const children = spawnSql().spawnedBy.all(sessionId) as SpawnedSessionRow[]
      return walkLedgers('every-conversation-this-one-spawned', children, (id, _noteSkip, row) => [
        {
          conversation: id,
          identity: row.identity,
          provider: row.provider as Provider,
        },
      ])
    },

    conversationBinding(sessionId) {
      const row = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined
      if (row === undefined) return null
      return {
        provider: row.provider as Provider,
        identity: row.identity,
      }
    },

    piecesGivenBy(sessionId, unread) {
      return piecesGivenBySession(sessionId, unread)
    },

    newestScheduleLevels(owners) {
      const selected = owners === undefined ? null : JSON.stringify([...owners])
      const rows = selectNewestScheduleLevels.all(selected, selected) as {
        session_id: string
        payload: string
        first_listed: string | null
        compacted_at: number | null
      }[]
      return rows.flatMap((row) => {
        const level = scheduleLevelFromRow(row)
        return level === null ? [] : [level]
      })
    },

    newestScheduleLevel(sessionId) {
      const row = selectNewestScheduleLevel.get(sessionId) as
        Parameters<typeof scheduleLevelFromRow>[0] | undefined
      return row === undefined ? null : scheduleLevelFromRow(row)
    },

    lastStatusAt(sessionId) {
      const row = selectLastStatusAt.get(sessionId) as { at: number } | undefined
      return row === undefined ? null : row.at
    },

    scheduleEvidenceRows(sessionId) {
      const answered = selectScheduleEvidenceRows.all(
        sessionId,
        MAX_SCHEDULE_HISTORY_WALKED + 1,
        MAX_SCHEDULE_EVIDENCE_ROWS,
      ) as {
        ordinal: number
        created_at: number
        type: string
        payload: string
        walked: number | null
      }[]
      const walked = answered.find((row) => row.walked !== null)?.walked ?? 0
      const rows = answered.filter((row) => row.walked === null)
      const given = new Set<string>()
      // How many rows of each kind were read: one that reached the cap may have more behind it.
      const read = { life: 0, receipt: 0, level: 0 }
      const kept = rows.flatMap((row): ScheduleEvidenceRow[] => {
        let payload: unknown
        try {
          payload = JSON.parse(row.payload) as unknown
        } catch {
          return []
        }
        if (row.type !== 'scheduled_work') read.life += 1
        else if (typeof payload === 'object' && payload !== null && 'receipt' in payload) {
          read.receipt += 1
        } else read.level += 1
        const key = `${String(row.created_at)}:${String(row.ordinal)}:${row.type}`
        if (given.has(key)) return []
        given.add(key)
        return [{ ordinal: row.ordinal, at: row.created_at, rowType: row.type, payload }]
      })
      const cut =
        Math.max(read.life, read.receipt, read.level) >= MAX_SCHEDULE_EVIDENCE_ROWS ||
        walked > MAX_SCHEDULE_HISTORY_WALKED
      return { rows: kept, cut }
    },

    recordedOne(sessionId) {
      return sessionCatalogueRead.recordedOne(sessionId)
    },
  }
}
