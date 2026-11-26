export type { ResumableSession, LiveSessionRow, RecordedSession } from './session-catalogue-read'
export type { DigestRow, EventRow, PersistedEvent } from './ledger-row-types'
export { toPersistedEvents } from './stored-event-codec'
export type { WorkRow } from './work-ledger-read'
export {
  parseModelChoice,
  modelChoiceWritten,
} from '../database/sqlite/agents/model-choice-storage'
export {
  THREAD_LEAD_EVENT_TYPES,
  type ThreadLeadRow,
} from '../database/sqlite/ledger/thread-lead-reader'
import { createSqliteSessionModels } from '../database/sqlite/agents/session-models'
import { createOwnNotesStore } from '../database/sqlite/agents/own-notes-store'
import { sqliteStarredConversations } from '../database/sqlite/starred-conversations'
import { createMemoryRecoveryStore } from './memory-recovery'
export { createMemoryAmendmentObserver } from './memory-recovery'
import { createMethodChangeStore } from './method-changes'
import { withOptionalIndexes } from './optional-indexes'
import { committedChangesOf } from './committed-changes'

import { type SessionReadPhases } from './provider-limit-reader'
export type { SessionReadPhases } from './provider-limit-reader'
import { ensureQuestionCopies } from './question-copies'
import {
  ensureWindowFoldCheckpoint,
  writeCheckpointRows,
  type CheckpointRow,
} from './window-fold-checkpoint'
import { ledgerWritesFor } from './ledger-write-stamp'
import { type SnapshotFoldAnswers } from './ledger-fold-state'

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

import type { AppDatabase } from './connection'

export type { ForestedConversation, ForestedNode } from './forest-store'

export type { OpenTurn, LeftRunning, TurnAsItEnded } from './turn-evidence-read'
import { createTurnReadsPart } from './session-store-parts/turn-reads'
import { createWorkStatementsPart } from './session-store-parts/work-statements'
import { createLedgerEventsPart } from './session-store-parts/ledger-events'
import { createAgentIdentitiesPart } from './session-store-parts/agent-identities'
import { createPieceFoldsPart } from './session-store-parts/piece-folds'
import { createWorkSettlingPart } from './session-store-parts/work-settling'
import { createWorkReadsPart } from './session-store-parts/work-reads'
import { createQuestionsPart } from './session-store-parts/questions-and-transcripts'
import { createWorkGivenPart } from './session-store-parts/work-given'
import { theFoldIndexHolds } from './session-store-parts/store-helpers'
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
  ensureWindowFoldCheckpoint(connection)
  let checkpointMadeBy: string | undefined
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
    selectQuestionsRaised,
    selectQuestionsRaisedMoved,
    selectRoutedRequestEvents,
    selectRoutedRequestEventsAfter,
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
  const ledgerEvents = createLedgerEventsPart({
    ...turnReads,
    ...workStatements,
    db,
    now,
    committed,
    connection,
    ledgerWrites,
  })
  const agentIdentities = createAgentIdentitiesPart({
    ...turnReads,
    ...workStatements,
    ...ledgerEvents,
    db,
    now,
    memoryRecoveryStore,
    methodChangeStore,
  })
  const { selectPieceEvents } = agentIdentities
  const pieceFolds = createPieceFoldsPart({
    ...turnReads,
    ...workStatements,
    ...ledgerEvents,
    ...agentIdentities,
    db,
    oneSnapshot,
    checkFoldState,
  })
  const { selectStallsTold, selectStallsToldMoved, selectTheDecisionOn } = pieceFolds
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
  const workReads = createWorkReadsPart({
    ...turnReads,
    ...workStatements,
    ...ledgerEvents,
    ...agentIdentities,
    ...pieceFolds,
    ...workSettling,
    db,
    connection,
  })
  const questions = createQuestionsPart({
    ...turnReads,
    ...agentIdentities,
    ...pieceFolds,
    ...workReads,
    db,
    connection,
  })
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
  return {
    ...ownNotesStore,
    ...sqliteStarredConversations(connection),
    ...turnReads.methods,
    ...workStatements.methods,
    ...ledgerEvents.methods,
    ...agentIdentities.methods,
    ...workSettling.methods,
    ...workReads.methods,
    ...questions.methods,
    ...workGiven.methods,
    ...sessionModels,
    keepWindowFoldCheckpoint(madeBy: string, rows: readonly CheckpointRow[], seenAt: bigint) {
      const dropOthers = checkpointMadeBy !== madeBy
      // Under the write lock no other connection can commit, so a commit since `seenAt` means a
      // ledger may have been rewritten after the caller looked, and nothing is written.
      const kept = connection
        .transaction(() => {
          if (BigInt(connection.pragma('data_version', { simple: true }) as number) !== seenAt)
            return false
          writeCheckpointRows(connection, madeBy, rows, dropOthers)
          return true
        })
        .immediate()
      if (kept) checkpointMadeBy = madeBy
      return kept
    },
  }
}
