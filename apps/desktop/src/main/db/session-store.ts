import type { DigestRow, EventRow, PersistedEvent } from './ledger-row-types'
export type { DigestRow, EventRow, PersistedEvent } from './ledger-row-types'
import type { WorkLedgerRead, WorkRow } from './work-ledger-read'
export type { WorkRow } from './work-ledger-read'
import { readAncestryContext, type AncestryContext } from './work-ancestry-reader'
import { rowsUnreadOnce, THE_WHOLE_LEDGER, type RowsUnread, type SkipNote } from './rows-unread'
import type {
  ReconciliationReceipt,
  WorkRecoveryEvent,
} from '../../shared/reconciliation-contracts'
import type {
  LedgerWalk,
  LedgerWalkKind,
  ProviderRequestEvent,
  QuestionAskedEvent,
  RaisedQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
} from '../../shared/question-contracts'
import { MAILBOX_KINDS } from '../../shared/conversation-events'
import type {
  InstructionProposedEvent,
  InstructionSettledEvent,
  MailboxKind,
  McpServerRequestSettledEvent,
  McpServerRequestedEvent,
  MemoryNoteSeen,
  QueuedMessageEvent,
  TheQuestionItAsks,
  TranscriptEvent,
  UnqueuedMessageEvent,
  WorkerRegisteredEvent,
} from '../../shared/conversation-events'
import type { MoveReceipt } from '../../shared/move-contracts'
import type { AgentModelChoice, ModelAndEffort } from '../../shared/model-choice-contracts'
import {
  parseProvider,
  parseModelChoice,
  modelChoiceWritten,
} from './session-store-parts/model-choice-storage'
export { parseModelChoice, modelChoiceWritten } from './session-store-parts/model-choice-storage'
import type {
  AnsweredQuestion,
  HumanAnswers,
  HumanFinalContext,
  HumanTurnAnswer,
  TurnAuthorship,
  UserTurnEvent,
  UserTurnPart,
} from '../../shared/human-answer-contracts'
import type {
  PieceRow,
  PieceWaitingOnWhoWrote,
  StatusLine,
  WhatAConversationIsWaitingOn,
  WorkGivenEvent,
  WorkGivenOut,
  WorkReport,
} from '../../shared/task-contracts'
import type { HandedPath } from '../../shared/attachment-contracts'
import type { ScheduleLevel, ScheduledRow } from '../../shared/agent-state-contracts'
import { createOwnNotesStore, type OwnNotesStore } from './own-notes'
import {
  createMemoryRecoveryStore,
  validMemoryIntent,
  knownMemorySource,
  memoryObservation,
} from './memory-recovery'
export { createMemoryAmendmentObserver } from './memory-recovery'
import {
  createMethodChangeStore,
  type MethodChangeIntent,
  type MethodChangeRecord,
  type MethodFileState,
} from './method-changes'
import { withOptionalIndexes } from './optional-indexes'
import { committedChangesOf, committedRowOf, type Committed } from './committed-changes'
import { currentWorkTitle } from './current-work-title'
import { searchPastWork, closePastWorkSearch, pastWorkSource } from './past-work-search'
import type { PastWorkSearchResult, PastWorkSource } from '../../shared/past-work-search'
import { workRecoveryEvent, reconciliationReceipt } from '../../shared/work-reconciliation'

import type { WorkerBorn } from '../profile-execution-file'
import { workerRegistrationOf } from '../worker-registration'
import { moveOfferOf, moveOriginOf, moveReceiptOf } from '../../shared/move-request'
import {
  boundRaw,
  boundRecall,
  capabilitiesFor,
  isAvailable,
  isMessageAct,
  NOT_STARTED_BECAUSE,
  SUPPORTED_PROVIDERS,
  parseSessionRef,
  serializeSessionRef,
  storedQuestionsParsed,
  type MemoryRecallEntry,
  type NotStartedBecause,
} from '@brobot2/runtime'
import type { Provider, SessionStatus, TurnEnding } from '@brobot2/shared'
import { DEFAULT_IDENTITY_PROVIDER, turnEndingSchema } from '@brobot2/shared'
import {
  CAPABILITY_COLUMNS,
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  MAX_CAPABILITY_COUNT,
  capabilityField,
  type CapabilityEdit,
  type CapabilityField,
  type CapabilityKey,
  type CapabilityOrigins,
  type ProfileCapabilities,
} from '../../shared/capabilities'
import { AN_ANSWER_HELD_THEN_LOST, theAnswerItCarries } from '../../shared/tasks'
import { storedRefusalTold } from '../../shared/refusals'
import {
  externalMcpGrantRowId,
  externalMcpServerRowId,
  foldExternalMcpReach,
  type ExternalMcpServerReach,
  type ExternalMcpServerRow,
} from '../../shared/external-mcp'
import { THE_APP_DID_IT } from '../../shared/who-did-it'
import { workEdge, type SpawnEdge, type WorkEdge } from '../../shared/who-called-whom'
import type { ForestParent } from '../../shared/the-whole-forest'
import {
  PHRASES,
  PROVIDER_WALL_LOOKBACK_MS,
  foldProviderLimits,
  providerLimitAccounts,
  readProviderLimit,
  type ProviderLimitAccountLife,
  type ProviderLimitSeen,
  type ProviderTakingWork,
} from '../../shared/provider-limit'
import { NONE_STARTED } from '../../shared/agent-roster'
import type { IdentityHistory, StartedOn } from '../../shared/agent-roster'
import { sameModel } from '../../shared/model-choice'
import type { ChildDescent } from '../adopt/discover-sessions'
import type {
  AgentIdentity,
  AgentIdentityName,
  IdentityCreator,
  NewAgent,
  DerivedState,
  LedgerStatus,
} from '../../shared/runtime-ipc'
import {
  DEFAULT_PROFILE_ID,
  agentName,
  PROVIDER_NAME,
  seededProviderFor,
  theMessagesOf,
} from '../../shared/runtime-ipc'
import { aNameForANewAgent } from '../../shared/human-names'
import { NORMALIZER_VERSION, PRE_CONTRACT_NORMALIZER_VERSION } from '../archive/normalizer'
import { HUMAN_CONTEXT_TERM, HUMAN_FINAL_TERM } from './human-answer-index'
import { humanPromptOf } from '../../shared/human-turn-answer'
import {
  conversationTree,
  deleteTheTree,
  providerSessionsOf,
  whatTiesTheTreeOutside,
  type ProviderSessionOf,
  type TiedOutside,
  type TreeDeleted,
} from './conversation-tree'
import { forestListing } from './forest-listing'
import { EMPTY_FOREST_STORE, type ForestStore } from './forest-store'
import { FOLD_EVENT_TYPES, FOLD_TERM } from './fold-index'
import {
  ensureQuestionCopies,
  fillQuestionCopies,
  questionCopiesReady,
  type QuestionCopySlice,
} from './question-copies'
import { foldWatchTriggers, watchFoldWrites } from './fold-write-watch'
import { providerWallsWatched, watchProviderWalls } from './provider-wall-watch'
import { withWindowWriteFence } from './window-write-fence'
import { ledgerWritesFor, type LedgerWriteStamp } from './ledger-write-stamp'

export const ROUTED_REQUEST_EVENT_TYPES = [
  'request_routed',
  'user_decision',
  'request_resolved',
  'request_stranded',
  'request_interrupted',
  'work_taken_back',
  'work_closed',
  'work_replied',
  'request_escalated',
  'question_withdrawn',
  'question_ended_with_its_piece',
  'question_recipient_ended',
  'question_asked',
  'launched',
  'status',
] as const
export const THREAD_LEAD_EVENT_TYPES = [
  'compaction',
  'conversation_reset',
  'launched',
  'user_turn',
  'turn',
] as const
import { aPersonsOwnWords } from '../../shared/a-persons-own-words'
import { DIGEST_EVENT_TYPES } from '../../shared/digest'
import { MAX_HANDED_PATHS } from '../../shared/runtime-ipc'

import { isPathSegment } from '../../shared/runtime-ipc'

import { TURN_AUTHORSHIP_KEYS } from '../../shared/runtime-ipc'
import { REPLY_SUMMARY_LIMIT } from '../runtime/reply-rails'
import { MAX_TURN_PARTS, USER_TURN_PART_KEYS } from '../../shared/runtime-ipc'
import { MEMORY_NOTES_PER_EVENT, MEMORY_NOTE_TEXT_CAP } from '../../shared/runtime-ipc'
import type { AppDatabase, AppStatement } from './connection'
import {
  ROOTS_SCOPE,
  agentIdentityRowId,
  foldProfileName,
  identityCreatorColumn,
  memoryAmendmentRowId,
  ownInstructionsRowId,
  readIdentityCreator,
} from './identity'
import { newEventId, newResourceId, newTurnId, newWorkId } from './ids'
import {
  aStallItsGiverCanBeToldOf,
  composeWhatEachPieceIsWaitingOn,
  derivePieces,
  isAWorkReport,
  thePiecesTheTurnNames,
  theWorkThatNamesItAmong,
  waitsOnWhoWrote,
  workGivenOut,
  TASK_IS_OPEN,
  aWaitNeedsClassifying,
  theWaitItMarks,
} from '../../shared/tasks'
import { pieceCalled, pieceNumbersOf, type WorkThatNamesIt } from '../../shared/piece-called'
import {
  REQUEST_IS_OPEN,
  aPersonOwesAnAnswerIn,
  deriveRoutedRequests,
  openQuestionsByWork,
  permissionShaped,
  anActionAsked,
  aPersonsSince,
  aWaitIsReadFrom,
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
  type Exchange,
  type ReceivedInATurn,
  type TranscriptTurn,
  type Words,
} from '../../shared/last-exchange'
import { actedByFrom, isWhoDidIt, type ActedBy } from '../../shared/who-did-it'
import {
  MEMORY_AMENDMENT,
  type MemoryAmendment,
  type MemoryAmendmentAct,
  type MemoryAmendmentWrite,
  type MemoryObservation,
  type MemoryOutcome,
} from '../../shared/agent-memory'
import {
  WHO_WROTE_IT,
  OWN_INSTRUCTIONS_CHARS,
  configuredLayerOf,
  waitingOnAPerson,
  type InstructionAskWaiting,
  type InstructionEnding,
  type InstructionUnread,
  type RulesAuthor,
  type OwnInstructions,
  type OwnInstructionsVersion,
  type OwnInstructionsWrite,
  type WhoWroteIt,
} from '../../shared/own-instructions'
import {
  mcpServerRequestsWaiting,
  type McpServerRequestWaiting,
} from '../../shared/mcp-server-requests'
import { formOfName, MAX_RESOURCES_PER_REPLY, type ResourceRole } from '../../shared/documents'
import { workFileGroup } from '../../shared/work-file-groups'

type SpawnedConversation = Omit<SpawnEdge, 'running'>

export type { ForestedConversation, ForestedNode } from './forest-store'
import type { ForestedNode } from './forest-store'

interface ConversationBinding {
  /** Always present when this app holds the row — the column is `NOT NULL`. */
  readonly provider: Provider
  readonly identity: string | null
}

export type { ProfileCapabilities } from '../../shared/capabilities'
export { DEFAULT_CAPABILITIES } from '../../shared/capabilities'

export interface OpenTurn {
  readonly id: string
  readonly generation: number
  readonly blocked: boolean
  readonly openedAt: number
}

export interface LeftRunning {
  readonly sessionId: string
  readonly status: 'working' | 'waiting_permission'
  readonly turn: OpenTurn | null
  /** Its last recorded moment, epoch ms; `null` for a ledger with no row. */
  readonly lastAt: number | null
}

export interface TurnAsItEnded {
  /** How it ended; `null` while it is open. */
  readonly ending: TurnEnding | null
  readonly generation: number
  /** Whether its ending is this app's word, not its provider's. */
  readonly theAppsWord: boolean
  /** Whether a stop was asked of it, by a person or an agent. */
  readonly stopAsked: boolean
  /** Whether this app's continuation of a cut turn opened it. */
  readonly aContinuation: boolean
  /** Whether a person's own words opened it. */
  readonly aPersonStartedIt: boolean
  /** Whether its ending names its provider's usage limit. */
  readonly endedOnALimit: boolean
  /** Whether its provider refused the login it ran on, or the account's bill. */
  readonly refused: boolean
  readonly piecesItNamed: readonly string[]
}

export interface ResourceRow {
  /** `res_<32 hex>` — `newResourceId`. */
  readonly resource: string
  readonly piece: string
  readonly role: ResourceRole
  readonly title: string | null
  readonly summary: string | null
  readonly name: string
  readonly sha256: string
  readonly bytes: number
  /** The conversation that handed it in, or `null`: a person. */
  readonly addedBy: string | null
  readonly createdAt: number
}

export interface KeptFileRow {
  readonly group?: import('../../shared/work-file-groups').WorkFileGroup
  readonly mainResult?: true
  readonly resource: ResourceRow
  /** The label of the piece it was kept on, as that piece's chain spells it. */
  readonly label: string
  /** The title that piece stands under now — `null`: a root nobody has titled. */
  readonly pieceTitle: string | null
  readonly addedByIdentity: string | null
}

export type KeptFilesAsked =
  | { readonly scope: 'tree'; readonly holder: string; readonly givers: readonly string[] }
  | { readonly scope: 'conversation'; readonly conversation: string }
  | { readonly scope: 'piece'; readonly piece: string }

export type KeptFilesPaged =
  Extract<KeptFilesAsked, { readonly scope: 'tree' }> | { readonly scope: 'everywhere' }

interface KeptFilesFrom {
  readonly olderThan: string | null
  readonly limit: number
}

export interface GivenInput {
  /** `res_<32 hex>` — `newResourceId`. */
  readonly resource: string
  readonly title: string
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

interface GivenPiece {
  /** `work_<uuid>`, minted by the host (`newWorkId`) before it is sent or written. */
  readonly piece: string
  readonly parent: string
  readonly number: number
  readonly owner: string
  readonly givenBy: string | null
  readonly title: string
  readonly brief: string
  readonly folder: string | null
  /** The files the giver handed over with it, each kept as an `input` resource — empty for none. */
  readonly inputs: readonly GivenInput[]
}

export interface NewSessionRecord {
  /** The admitted connection for this successful launch; omitted legacy choices stay dynamic. */
  connectionId?: string
  /** A normal worker's binding, written atomically at ordinal zero of its first life. */
  worker?: Omit<WorkerRegisteredEvent, 'type'>
  id: string
  provider: Provider
  cwd: string
  /** Fixed at creation, and the one launch decision that cannot be re-derived later. */
  approvalMode: 'ask' | 'auto'
  /** The profile whose provider home it ran in — resume has to land in the same one. */
  profileId: string
  reasoningEffort?: string
  model?: string
  planMode?: boolean
  parentSessionId?: string
  service?: true
  launchedAs?: string
}

/** A session that could be resumed: it has a provider ref to resume *from*. */
export interface WaitingMessage {
  readonly messageId: string
  readonly kind: MailboxKind
  readonly text: string
  readonly attachments: readonly HandedPath[]
  readonly authorship: TurnAuthorship
  /** When it was held, epoch ms. */
  readonly at: number
  readonly piece?: string
  readonly label?: string
  readonly rebrief?: true
  readonly drives?: string
  readonly about?: string
  readonly asks?: TheQuestionItAsks
}

export interface ResumableSession {
  sessionId: string
  provider: Provider
  /** The parsed provider ref — a row without one is not returned at all. */
  ref: ReturnType<typeof parseSessionRef>
  cwd: string
  status: SessionStatus
  /** Null only for rows written before the column existed; never guessed. */
  approvalMode: 'ask' | 'auto' | null
  /** Null for rows written before profiles could be chosen — they ran in the default one. */
  profileId: string | null
  reasoningEffort: string | null
  model: string | null
  planMode: boolean | null
  planEndedAt: number | null
  modelOrEffortSetByAPersonAt: number | null
  reportedModel: string | null
  reportedEffort: string | null
  adoptedAt: number | null
  hasTranscript: boolean
  lastEnding: TurnEndReason | null
  child: ChildDescent | null
  resumeRefusal: string | null
  homeRefusal: string | null
  restoredFromBundle: boolean
  /** When the session began — the provider's own time for an adopted one. */
  createdAt: number
  updatedAt: number
}

export interface LiveSessionRow {
  sessionId: string
  /** Null for rows written before profiles could be chosen — they ran in the default one. */
  profileId: string | null
  /** Null only for rows written before the column existed; never guessed. */
  approvalMode: 'ask' | 'auto' | null
  /** The parsed ref, or null while the provider has not named this conversation yet. */
  ref: ReturnType<typeof parseSessionRef> | null
  model: string | null
  reasoningEffort: string | null
}

interface AdoptedSessionRecord {
  id: string
  provider: Provider
  /** The provider's own id, which becomes the ref resume reattaches from. */
  sessionId: string
  cwd: string
  profileId: string | null
  /** When the provider last touched it — the row's updated time, not now. */
  updatedAt: number
  /** When the conversation began, as the provider records it. */
  createdAt: number
  rotation?: number
  child?: ChildDescent
}

interface UnresumableSession {
  sessionId: string
  provider: Provider
  cwd: string
  status: SessionStatus
  profileId: string | null
  adoptedAt: number | null
  updatedAt: number
  hasTranscript: boolean
  foundInUserHome: boolean
  restoredFromBundle: boolean
  lastEnding: TurnEndReason | null
  /** Plain-language why, from the row itself — never a guess. */
  reason: string
}

export interface ThreadLeadRow {
  readonly ordinal: number
  /** The row's own type. */
  readonly rowType: 'launched' | 'user_turn' | 'turn' | 'compaction' | 'conversation_reset'
  /** A launch's `given.thisConversation`, as stored. */
  readonly conversation: unknown
  /** Whether a message's row kept what it handed over (`sent`) at all. */
  readonly handedOver: boolean
  /** A message's `sent`, only when it opens with this conversation's text. */
  readonly sent: string | null
  /** A message's `lead`, as stored. */
  readonly lead: unknown
  /** A turn this app ended as failed (`state: 'failed'`, `wordOf: 'this-app'`). */
  readonly failedByThisApp: boolean
}

export interface RecordedSession {
  /** Our id for the row. */
  sessionId: string
  provider: Provider
  providerSessionId: string | null
  cwd: string
  status: SessionStatus
  profileId: string | null
  adoptedAt: number | null
  hasTranscript: boolean
  foundInUserHome: boolean
  restoredFromBundle: boolean
  derived: DerivedState | null
  lastEnding: TurnEndReason | null
  createdAt: number
  updatedAt: number
  /** Why it cannot be reopened, or null when it can — the same answer the reopen list gives. */
  unresumableReason: string | null
  neverStarted: boolean
  child: ChildDescent | null
}

interface SessionSnapshot {
  session: AdoptedSessionRecord
  /** How many of the provider's lines the ledger was read from, as the bundle carried them. */
  derivedThrough: number
  /** The conversation, with the ordinals and times it was exported under. */
  ledger: { ordinal: number; event: TranscriptEvent; at: number }[]
}

interface LedgerWindowQuery {
  /** How many turns to take, counting back. At least one is always taken when one exists. */
  turns: number
  maxEvents: number
  before?: number
}

/** One page of a session's ledger, and enough to ask for the page before it. */
interface LedgerWindow {
  entries: PersistedEvent[]
  from: number
  /** Whether any event exists below `from`. The cursor's "there is more", read rather than guessed. */
  hasOlder: boolean
  turnAligned: boolean
  toolsInForce?: PersistedEvent
}

interface RaisedQuestionRow {
  move: string | null
  action: string | null
  id: string | null
  type: string | null
  prompt: string | null
  questions: string | null
  piece: string | null
  passedUpFrom: string | null
  context: string | null
  ordinal: number
  readable: number
  idIs: string | null
  promptIs: string | null
  questionsIs: string | null
  pieceIs: string | null
  passedUpFromIs: string | null
  contextIs: string | null
}

export function toPersistedEvents(
  rows: EventRow[],
  noteSkip?: (ordinal: number, cause?: string) => void,
): PersistedEvent[] {
  return rows.flatMap((row) => {
    try {
      return [
        {
          ordinal: row.ordinal,
          at: row.created_at,
          event: boundStoredEvent(JSON.parse(row.payload) as TranscriptEvent),
        },
      ]
    } catch (error) {
      console.warn(
        `session ledger: ordinal ${row.ordinal} could not be read and was skipped ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      )
      noteSkip?.(row.ordinal, error instanceof Error ? error.message : String(error))
      return []
    }
  })
}

function* persistedEventsFrom(
  rows: Iterable<EventRow>,
  noteSkip?: SkipNote,
): IterableIterator<PersistedEvent> {
  for (const row of rows) yield* toPersistedEvents([row], noteSkip)
}

function noteUnreadRow(
  sessionId: string,
  ordinal: number,
  noteSkip: ((ordinal: number, cause?: string) => void) | undefined,
  because = 'is not JSON',
): void {
  console.warn(
    `session ledger: ${sessionId} ordinal ${String(ordinal)} ${because} and was skipped by a guarded read`,
  )
  noteSkip?.(ordinal, because)
}

function noSuchConversation<Row>(): LedgerWalk<Row> {
  return { rows: [], walk: 'no-such-conversation', ledgers: 0, rowsUnread: 0 }
}

export function underWhat(parent: string | null, drawn: ReadonlySet<string>): ForestParent {
  if (parent === null) return { is: 'the-person' }
  return drawn.has(parent)
    ? { is: 'a-conversation', conversation: parent }
    : { is: 'a-conversation-this-reading-did-not-draw', conversation: parent }
}

type PieceForAName = Pick<
  PieceRow,
  'piece' | 'label' | 'title' | 'owner' | 'giver' | 'givenAt' | 'state' | 'outcome' | 'endedAt'
>

export type PieceHeld = PieceForAName

export function skipTheLedger(
  sessionId: string,
  error: unknown,
  noteSkip: SkipNote | undefined,
): void {
  console.warn(
    `session ledger: ${sessionId} could not be read and was skipped ` +
      `(${error instanceof Error ? error.message : String(error)})`,
  )
  noteSkip?.(THE_WHOLE_LEDGER, error instanceof Error ? error.message : String(error))
}

export function readOrSkip<T>(
  sessionId: string,
  noteSkip: SkipNote | undefined,
  nothing: T,
  fold: () => T,
): T {
  if (noteSkip === undefined) return fold()
  try {
    return fold()
  } catch (error) {
    skipTheLedger(sessionId, error, noteSkip)
    return nothing
  }
}

export function eachOrSkipped<K extends string, Row extends Readonly<Record<K, string>>, Built>(
  rows: readonly Row[],
  key: K,
  unread: RowsUnread,
  build: (row: Row) => Built,
): Built[] {
  return rows.flatMap((row) => readOrSkip(row[key], unread.in(row[key]), [], () => [build(row)]))
}

export function ledgersSkippedOf(count: number | undefined): { readonly ledgersSkipped?: number } {
  return count !== undefined && count > 0 ? { ledgersSkipped: count } : {}
}

function walkLedgers<Row, Candidate extends { id: string }>(
  walk: LedgerWalkKind,
  candidates: readonly Candidate[],
  foldOne: (sessionId: string, noteSkip: SkipNote, candidate: Candidate) => readonly Row[],
  unread: RowsUnread = rowsUnreadOnce(),
): LedgerWalk<Row> {
  const rows = candidates.flatMap((candidate) => {
    const noteSkip = unread.in(candidate.id)
    return [
      ...readOrSkip(candidate.id, noteSkip, [], () => foldOne(candidate.id, noteSkip, candidate)),
    ]
  })
  return {
    rows,
    walk,
    ledgers: candidates.length,
    rowsUnread: unread.count,
    ...ledgersSkippedOf(unread.ledgersSkipped),
  }
}

interface GivenWorkRow {
  readonly id: string
  readonly identity: string | null
}

interface BindingRow {
  readonly provider: string
  readonly identity: string | null
}

interface SpawnedSessionRow {
  readonly id: string
  readonly provider: string
  readonly identity: string | null
}

interface ForestSessionRow {
  readonly id: string
  readonly profile_slug: string
  readonly provider: string
  readonly status: string
  readonly created_at: number
  readonly updated_at: number
  readonly parent_session_id: string | null
}

interface WorkDbRow {
  readonly id: string
  readonly parent_id: string | null
  readonly number: number
  readonly owner_session_id: string
  readonly given_by_session_id: string | null
  readonly title: string | null
  readonly brief: string | null
  readonly folder: string | null
  readonly created_at: number
}
/** The columns every `work` read selects, so the SELECT and {@link WorkDbRow} cannot disagree. */
const WORK_COLUMNS =
  'id, parent_id, number, owner_session_id, given_by_session_id, title, brief, folder, created_at'

interface ResourceDbRow {
  readonly id: string
  readonly work_id: string
  readonly role: string
  readonly title: string | null
  readonly summary: string | null
  readonly name: string
  readonly sha256: string
  readonly bytes: number
  readonly added_by_session_id: string | null
  readonly created_at: number
}
/** The columns every `work_resource` read selects. */
const RESOURCE_COLUMNS =
  'id, work_id, role, title, summary, name, sha256, bytes, added_by_session_id, created_at'

interface KeptFileDbRow extends ResourceDbRow {
  readonly added_by_identity: string | null
}
const KEPT_FILE_COLUMNS = `${RESOURCE_COLUMNS},
  (SELECT identity.slug FROM provider_session s
     JOIN agent_identity identity ON identity.id = s.agent_identity_id
    WHERE s.id = work_resource.added_by_session_id) AS added_by_identity`

const HELD_UNDER = `WITH RECURSIVE held(id) AS (
           SELECT id FROM work
            WHERE owner_session_id = @holder OR given_by_session_id IN (SELECT value FROM json_each(@givers))
           UNION
           SELECT w.id FROM work w JOIN held h ON w.parent_id = h.id
         )`

const KEPT_BEFORE = `rowid < coalesce((SELECT rowid FROM work_resource WHERE id = @from), 9223372036854775807)`

const MAX_WORK_DEPTH_WALKED = MAX_CAPABILITY_COUNT + 2

function inLabelOrder(a: readonly number[], b: readonly number[]): number {
  for (let level = 0; level < Math.min(a.length, b.length); level += 1) {
    const apart = (a[level] ?? 0) - (b[level] ?? 0)
    if (apart !== 0) return apart
  }
  return a.length - b.length
}

/** A digest row as the database holds it — a ledger row plus the conversation it came from. */
interface DigestEventRow extends EventRow {
  session_id: string
}

/** What a session's `derived_generation` row holds, before it is turned into a {@link LedgerStatus}. */
interface GenerationRow {
  active: number
  normalizer_version: number
  derived_through: number
  building: number | null
  highest: number
  failure: string | null
}

const MAX_SCHEDULE_EVIDENCE_ROWS = 2_000

export const MAX_SCHEDULE_HISTORY_WALKED = 20_000

/** What {@link SessionStore.scheduleEvidenceRows} gives. */
interface ScheduleEvidenceRead {
  /** The rows, oldest first. */
  readonly rows: readonly ScheduleEvidenceRow[]
  readonly cut: boolean
}

export interface ScheduleEvidenceRow {
  readonly ordinal: number
  /** When it was appended, epoch ms. */
  readonly at: number
  /** The row's type, as the ledger names it. */
  readonly rowType: string
  readonly payload: unknown
}

export interface SessionStore extends OwnNotesStore, WorkLedgerRead, ForestStore {
  /** Indexed candidate pages; the caller folds owners within its turn-block budget. */
  turnBlockCandidates(
    giver: string,
    limit: number,
    after?: string | null,
  ): readonly { readonly piece: string; readonly owner: string }[] | null
  instructionAsksWaitingIn(
    conversation: string,
    unread: RowsUnread,
  ): readonly InstructionAskWaiting[] | null
  /** The last completed person reply ended in '?' and opened no person request. */
  replyQuestionWithoutARequest(conversation: string): string | null
  /** Whether the writer has no retained native cursor from one of this store's iterator reads. */
  canReadFreshSnapshot?(): boolean
  create(record: NewSessionRecord): void
  /** A recorded binding only; reading an older row never chooses or writes a default. */
  connectionOf(sessionId: string): string | null
  firstLaunchOf(
    record: Pick<
      NewSessionRecord,
      'id' | 'model' | 'reasoningEffort' | 'planMode' | 'launchedAs' | 'connectionId'
    >,
  ): boolean
  aLaunchWentUnnamed(sessionId: string): boolean
  adopt(record: AdoptedSessionRecord): void
  identityOf(sessionId: string): {
    profileSlug: string
  } | null
  capabilitiesOf(profileSlug: string): ProfileCapabilities | null
  agentIdentities(): readonly AgentIdentity[]
  /** The naming columns of one identity, without capabilities or grants. */
  agentIdentityNameById(id: string): AgentIdentityName | null
  reconciliationNames(
    conversations: readonly string[],
  ): readonly (AgentIdentityName & { conversation: string })[]
  createAgentIdentity(
    said: NewAgent,
    broughtIntoBeingBy: IdentityCreator | null,
  ): AgentIdentity | null
  providerOf(profileSlug: string): Provider | null
  startedOnOf(profileSlug: string): StartedOn
  saveProviderIfNoneIsSaved(profileSlug: string, provider: Provider): boolean
  setCapabilities(
    profileSlug: string,
    edit: CapabilityEdit,
    externalMcpServerIds?: readonly string[],
  ): boolean
  ownInstructionsOf(profileSlug: string): OwnInstructions
  configuredLayerFor(profileSlug: string): string | null
  writeOwnInstructions(said: OwnInstructionsWrite, at: number): OwnInstructionsVersion | null
  undoOwnInstructions(
    profileSlug: string,
    expectedVersion: number,
    by: ActedBy,
    at: number,
  ): OwnInstructionsVersion | null
  instructionUnread(profileSlug: string): InstructionUnread
  beginMethodChange(
    profileSlug: string,
    said: MethodChangeIntent,
    by: ActedBy,
    at: number,
  ): MethodChangeRecord | null
  settleMethodChange(
    profileSlug: string,
    id: string,
    outcome: 'done' | 'partial',
    actual: readonly MethodFileState[],
    by: ActedBy,
  ): boolean
  hasPendingMethodChange(profileSlug: string): boolean
  methodChange(profileSlug: string, id: string): MethodChangeRecord | null
  methodChanges(profileSlug: string, offset?: number, limit?: number): readonly MethodChangeRecord[]
  markInstructionsSeen(profileSlug: string, version: number, by: ActedBy): boolean
  memoryAmendmentsOf(profileSlug: string): readonly MemoryAmendment[]
  writeMemoryAmendment(said: MemoryAmendmentWrite, at: number): MemoryAmendment | null
  beginMemoryAmendment(said: MemoryAmendmentWrite, at: number): MemoryAmendment | null
  settleMemoryAmendment(
    profileSlug: string,
    id: string,
    actual: MemoryObservation,
    by: ActedBy,
  ): boolean
  hasPendingMemoryAmendment(profileSlug: string): boolean
  memoryAmendment(profileSlug: string, id: string): MemoryAmendment | null
  instructionAsksWaiting(unread?: RowsUnread): readonly InstructionAskWaiting[]
  settleInstructionAsk(askId: string, ending: InstructionEnding, by: ActedBy, at: number): boolean
  /** Every MCP server request no ending names yet, oldest first, across every conversation. */
  mcpServerRequestsWaiting(unread?: RowsUnread): readonly McpServerRequestWaiting[]
  /** Whether a request by this id was ever made, waiting or settled. */
  mcpServerRequestWasMade(requestId: string): boolean
  grantExternalMcpServer(
    serverName: string,
    profileSlugs: readonly string[],
  ): { readonly granted: readonly string[]; readonly missing: readonly string[] } | null
  externalMcpServers(): readonly ExternalMcpServerRow[]
  registerExternalMcpServer(said: {
    name: string
    url: string
    reach: ExternalMcpServerReach
  }): ExternalMcpServerRow | null
  removeExternalMcpServer(serverId: string): boolean
  externalMcpServersFor(profileSlug: string): readonly ExternalMcpServerRow[]
  setAgentProvider(profileSlug: string, provider: Provider | null): boolean
  setAgentDisplayName(profileSlug: string, displayName: string | null): boolean
  modelChoiceOf(profileSlug: string): AgentModelChoice | null
  setModelChoice(profileSlug: string, choice: AgentModelChoice | null): boolean
  handAddedModels(provider: Provider): readonly string[]
  addHandAddedModel(provider: Provider, model: string, at: number): readonly string[]
  deleteHandAddedModel(provider: Provider, model: string, at: number): readonly string[]
  lastPicked(provider: Provider): ModelAndEffort | null
  hasSealedApiKey(provider: Provider): boolean
  forgetSealedApiKey(provider: Provider): void
  aPersonPicked(provider: Provider, pair: ModelAndEffort, at: number): void
  conversationsPerIdentity(): readonly IdentityHistory[]
  removeAgentIdentity(profileSlug: string): boolean
  spawnPolicy(): { spawningEnabled: boolean }
  /** Throw the switch. Nothing running is stopped — see {@link appPolicy}. */
  setSpawningEnabled(enabled: boolean): void
  defaultApprovalModeChosen(): boolean
  defaultApprovalMode(): 'ask' | 'auto'
  setDefaultApprovalMode(mode: 'ask' | 'auto'): void
  parentOf(sessionId: string): string | null
  ancestorsOf(sessionId: string): readonly string[]
  refreshAdopted(sessionId: string, updatedAt: number, child?: ChildDescent): boolean
  learnDescent(sessionId: string, child?: ChildDescent): boolean
  setApprovalMode(sessionId: string, mode: 'ask' | 'auto'): void
  setModel(sessionId: string, model: string | null): void
  setReasoningEffort(sessionId: string, effort: string | null): void
  aPersonSetItsModelOrEffort(sessionId: string, at: number): void
  setReportedModel(sessionId: string, model: string | null, effort: string | null): void
  whatItRunsOn(sessionId: string): {
    readonly model: string | null
    readonly reasoningEffort: string | null
    /** When a person last changed its model or effort, or null — `R31c`'s stamp. */
    readonly aPersonChoseItAt: number | null
    readonly reportedModel: string | null
    readonly reportedEffort: string | null
  } | null
  endPlanMode(sessionId: string, at: number): void
  startPlanMode(sessionId: string, at: number): void
  findByProviderRef(provider: Provider, sessionId: string): string | null
  nameItsLaunch(sessionId: string, ref: ReturnType<typeof parseSessionRef>): boolean
  append(sessionId: string, ordinal: number, event: TranscriptEvent, at: number): void
  appendMany(
    sessionId: string,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): void
  atomically<T>(work: () => T): T
  onCommitted(listener: (change: Committed) => void): () => void
  /** Asks whether another connection has committed since the last look; one resync if so. */
  checkCommitted(): void
  /** Sessions with a ref to resume from, most recently touched first. */
  resumable(): ResumableSession[]
  /** The recorded sessions that cannot be reopened, each with the reason it cannot. */
  unresumable(): UnresumableSession[]
  recorded(): RecordedSession[]
  recordedOne(sessionId: string): RecordedSession | null
  searchPastWork(caller: string, words: string): PastWorkSearchResult
  closePastWorkSearch(): void
  pastWorkSearchSource(caller: string): PastWorkSource | null
  replacements(): readonly { readonly replaced: string; readonly by: string }[]
  newestScheduleLevels(): readonly {
    readonly conversation: string
    readonly level: ScheduleLevel
    readonly compactedAt: number | null
    readonly notStartedSaid?: Readonly<Record<string, NotStartedBecause>>
  }[]
  scheduleEvidenceRows(sessionId: string): ScheduleEvidenceRead
  lastStatusAt(sessionId: string): number | null
  find(sessionId: string): ResumableSession | null
  findLive(sessionId: string): LiveSessionRow | null
  /** One session's ledger in order: the transcript a reopened chat is rebuilt from. */
  workflowOutputPath(sessionId: string, taskId: string, unread?: RowsUnread): string | null
  workflowAgentTask(sessionId: string, agentId: string, unread?: RowsUnread): string | null
  workflowAgentIds(sessionId: string, taskId: string, unread?: RowsUnread): string[]
  reportedSubAgent(sessionId: string, agentId: string, unread?: RowsUnread): boolean
  events(sessionId: string): PersistedEvent[]
  eventsFrom(sessionId: string, fromOrdinal: number, limit: number): PersistedEvent[]
  newestOfType?(
    sessionId: string,
    type: TranscriptEvent['type'],
    before?: number,
    from?: number,
  ): PersistedEvent | null
  threadLeadRows?(
    sessionId: string,
    leadsOpenWith: string,
    before?: number,
    historicalLeadsOpenWith?: string,
    /** Inclusive ordinal floor for pages; omitted: the whole history before the upper bound. */
    fromOrdinal?: number,
  ): readonly ThreadLeadRow[]
  ancestryContext(
    sessionId: string,
    page: readonly PersistedEvent[],
    through: number,
    budget: number,
  ): AncestryContext
  turnWindow(sessionId: string, options: LedgerWindowQuery): LedgerWindow
  /** Bounded indexed context, independent of how many app turns follow the human turn. */
  latestHumanAnswers(sessionId: string): HumanAnswers
  humanFinalsInWindow(
    sessionId: string,
    from: number,
    through: number,
  ): ReadonlyMap<number, HumanFinalContext>
  ledgerStatus(sessionId: string): LedgerStatus
  beginGeneration(sessionId: string): number
  clearOrphanBuilds(running: ReadonlySet<string>): number
  settleOrphanRuns(at: number, running: ReadonlySet<string>): number
  whatACrashLeftRunning(running: ReadonlySet<string>): readonly LeftRunning[]
  recordedTurnOpening(sessionId: string, turnId: string): UserTurnEvent | null
  recordedTurnMessage(
    sessionId: string,
    turnId: string,
  ): (PersistedEvent & { event: UserTurnEvent }) | null
  ensurePersonalRoot(sessionId: string, at: number): WorkRow
  theOpenTurn(sessionId: string): OpenTurn | null
  theNewestTurn(sessionId: string): string | null
  aLifeOpenedTheTurn(
    sessionId: string,
    turnId: string,
    life: { readonly generation: number; readonly launched: number },
  ): boolean
  howATurnEnded(sessionId: string, turnId: string): TurnAsItEnded | null
  whereItWasRouted(sessionId: string, requestId: string): number | null
  piecesOwnedBefore(owner: string, ordinal: number, unread?: RowsUnread): readonly PieceRow[]
  whatBecameOfAMessage(
    sessionId: string,
    messageId: string,
  ): 'sent' | 'ended' | 'waiting' | 'absent'
  settleStrandedMessages(at: number, running: ReadonlySet<string>, unread?: RowsUnread): number
  messagesWaitingIn(
    sessionId: string,
    unread?: RowsUnread,
    maximumRows?: number,
  ): readonly WaitingMessage[]
  settleStrandedRequests(at: number, running: ReadonlySet<string>, unread?: RowsUnread): number
  stalledWorkNobodyWasToldAbout(unread?: RowsUnread): LedgerWalk<PieceRow>
  stalledWorkItsGiverWasToldAbout(unread?: RowsUnread): LedgerWalk<PieceRow>
  waitsThatNeedClassifying(unread?: RowsUnread): LedgerWalk<PieceRow>
  stalledWorkAPersonGave(unread?: RowsUnread): LedgerWalk<PieceRow>
  piecesWaitingOnWhoWrote(unread?: RowsUnread): LedgerWalk<PieceWaitingOnWhoWrote>
  piecesWaitingOnWhoWroteIn(owner: string, unread?: RowsUnread): readonly PieceWaitingOnWhoWrote[]
  providerLimitsSeen(
    now: number,
    signInChangedAt?: ReadonlyMap<Provider, number>,
    accountLives?: readonly ProviderLimitAccountLife[],
  ): LedgerWalk<ProviderLimitSeen>
  readAheadProviderWalls(now: number, budgetMs: number): boolean
  settleRestartedWork(
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
    wokenForAJob?: ReadonlySet<string>,
    diedInTheBackground?: Set<string>,
    continuing?: ReadonlySet<string>,
  ): number
  questionsAPersonMustAnswer(unread?: RowsUnread): LedgerWalk<RoutedRequest>
  decisionsAwaitingAPerson(unread?: RowsUnread): LedgerWalk<RequestOnlyAPersonCanSettle>

  numberUnder(parent: string): number
  recordGive(given: GivenPiece, ordinal: number, event: WorkGivenEvent, at: number): void
  /** Every saved work row, including roots, for incident reconciliation. */
  reconciliationOwners(): readonly string[]
  reconciliationWork(holders?: ReadonlySet<string>, unread?: RowsUnread): readonly WorkRow[]
  reconciliationReceiptsForOwner(owner: string): readonly ReconciliationReceipt[]
  reconciliationRecovery(owner: string): WorkRecoveryEvent | null
  reconciliationDrivenByTurn(owner: string, turn: string): readonly string[]
  reconciliationReceipts(owner: string, piece: string): readonly ReconciliationReceipt[]
  reconciliationDelivery(
    target: string,
    messageId: string,
  ): 'pending' | 'running' | 'turn-ended' | 'not-delivered'
  /** Canonical labels and current titles, with one retitle walk per owner. */
  activityWorkNames(
    pieces: readonly string[],
  ): ReadonlyMap<string, { readonly label: string; readonly title: string | null } | null>
  workByLabel(label: string): WorkRow | null
  /** The root this conversation owns, or `null`: a conversation another one started owns none. */
  rootOf(conversation: string): WorkRow | null
  servicesBorn(): readonly { readonly conversation: string; readonly identity: string | null }[]
  /** Bounded indexed birth evidence; malformed or oversized evidence throws. */
  workersBorn(): readonly WorkerBorn[]
  /** Complete, bounded replacement evidence for the giver of a worker binding. */
  workerGiverContains(giver: string, conversation: string): boolean
  /** The current worker, from a complete bounded replacement chain. */
  workerInItsPlace(conversation: string): string
  /** A bounded complete ledger for reuse; null means it cannot prove absence. */
  workerLedger(
    conversation: string,
    budget?: { rowsLeft: number; bytesLeft: number },
  ): readonly PersistedEvent[] | null
  workerLineage(conversation: string): readonly string[]
  workerQuestionTargets(): readonly { asker: string; recipient: string }[] | null
  rootLines(root: string): { readonly title: string | null; readonly statusLine: StatusLine | null }
  workThatNames(conversation: string, unread?: RowsUnread): WorkThatNamesIt | null
  workThatNamesAndItsWait(
    conversation: string,
    unread?: RowsUnread,
  ): {
    readonly named: WorkThatNamesIt | null
    readonly waitingOnPurpose: PieceRow | null
  }
  workThatNamesUnder(
    conversation: string,
    /** The piece the sentence is about, by id. */
    piece: string,
    unread?: RowsUnread,
  ): WorkThatNamesIt | null
  workOnItsChainThatNames(conversation: string, piece: string): WorkThatNamesIt | null
  /** The rows given under one piece, by number — rows, not folded. */
  childrenOf(piece: string): readonly WorkRow[]
  depthOf(piece: string): number
  pieceOfItsChainHeldBy(piece: string, owner: string): string | null
  turnBlockPiecesOwnedBy(owner: string, unread?: RowsUnread): readonly PieceRow[]
  openPiecesOf(owner: string, unread?: RowsUnread): readonly PieceRow[]
  newestChildAs(
    parents: readonly string[],
    profileSlug: string,
    provider?: Provider,
    except?: readonly string[],
  ): string | null
  conversationsOf(profileSlug: string): readonly {
    readonly conversation: string
    readonly parent: string | null
    readonly startedAt: number
    readonly lastActiveAt: number
  }[]
  newestPiecesHeldIn(
    conversations: readonly string[],
    limit: number,
    unread?: RowsUnread,
  ): {
    /** The newest it could read, newest given first. */
    readonly rows: readonly PieceHeld[]
    /** How many of the newest `work` named — `rows`, and those it could not read. */
    readonly newest: number
    /** How many those conversations hold in all. */
    readonly total: number
  }
  pieceItWasStartedWith(conversation: string, unread?: RowsUnread): string | null
  addResource(
    input: Omit<ResourceRow, 'resource' | 'createdAt' | 'title'> & { readonly title: string },
    at: number,
  ): ResourceRow
  /** The resources kept for one piece, oldest first. */
  resourcesOf(piece: string): readonly ResourceRow[]
  filesKept(asked: KeptFilesAsked): readonly KeptFileRow[]
  /** Both opening lists, named in one pass over their union. */
  filesKeptTogether(asked: Extract<KeptFilesAsked, { scope: 'tree' }>): {
    readonly tree: readonly KeptFileRow[]
    readonly added: readonly KeptFileRow[]
  }
  madeBy(
    profileSlug: string,
    limit: number,
  ): { readonly rows: readonly KeptFileRow[]; readonly total: number }
  keptFilesNewestFirst(
    asked: KeptFilesPaged,
    page: KeptFilesFrom,
  ): {
    readonly rows: readonly KeptFileRow[]
    readonly through: string | null
  }
  keptFilesBefore(asked: KeptFilesPaged, olderThan: string, cap: number): number
  /** One resource by its id, or `null`. */
  resource(id: string): ResourceRow | null
  untitledResources(limit: number): readonly ResourceRow[]
  titleResource(id: string, title: string): boolean
  titledResources(
    after: number,
    limit: number,
    keptBefore: number,
  ): readonly { readonly at: number; readonly row: ResourceRow }[]
  retitleResource(id: string, was: string, title: string): boolean
  digestWindow(from: number, to: number): LedgerWalk<DigestRow>
  /** The same vocabulary, materialized only inside this exact window and never cached. */
  activityWindow(from: number, to: number): LedgerWalk<DigestRow>
  conversationsHeldByNoAgent(): number
  piecesGivenBy(sessionId: string, unread?: RowsUnread): readonly PieceRow[]
  workGivenOutBy(sessionId: string): LedgerWalk<WorkGivenOut>
  spawnedBy(sessionId: string): LedgerWalk<SpawnedConversation>
  /** A conversation and every conversation below it (`conversation-tree.ts`): itself first. */
  conversationTree(root: string): string[]
  /** What ties a tree's conversations to conversations outside it (`conversation-tree.ts`). */
  whatTiesTheTreeOutside(tree: readonly string[]): TiedOutside[]
  /** Every provider session a conversation had, by the ids its provider's files are named by. */
  providerSessionsOf(conversation: string): ProviderSessionOf[]
  /** Deletes every row of a tree's conversations, in one transaction (`conversation-tree.ts`). */
  deleteTheTree(tree: readonly string[]): TreeDeleted
  conversationBinding(sessionId: string): ConversationBinding | null
  workThisOneGaveOut(sessionId: string): LedgerWalk<WorkEdge>
  workThisOneWasGiven(sessionId: string): LedgerWalk<WorkEdge>
  workReportedTo(sessionId: string): ReadonlySet<string>
  /** A pre-upgrade ordinary stall covered by a standing notice in its giver lineage. */
  legacyOrdinaryStallWasReported(owner: string, piece: string, giver: string): boolean
  routedRequestsOf(sessionId: string, unread?: RowsUnread): readonly RoutedRequest[]
  questionsRoutedTo(parentSessionId: string, unread?: RowsUnread): readonly RoutedRequest[]
  whoRoutedToWhom(): readonly { readonly asker: string; readonly parent: string }[]
  conversationsHoldingACopyOf(requestId: string): readonly string[]
  fillQuestionCopies(rows: number, bytes: number): QuestionCopySlice
  generationOf?(sessionId: string): number
  latestMoveOffer?(
    sessionId: string,
  ): import('../../shared/question-contracts').QuestionAskedEvent | null
  theDecisionOn(
    sessionId: string,
    requestId: string,
  ): {
    readonly outcome: string
    readonly by: ActedBy | null
    readonly movedTo?: MoveReceipt
  } | null
  theRequestRouted(sessionId: string, requestId: string): ProviderRequestEvent | null
  questionsRaisedIn(sessionId: string, unread?: RowsUnread): ReadonlyMap<string, RaisedQuestion>
  routedRequestsAtHand(sessionId: string): readonly RoutedRequest[] | null
  questionsRaisedAtHand(sessionId: string): ReadonlyMap<string, RaisedQuestion> | null
  piecesAtHand(owner: string): readonly PieceRow[] | null
  questionsRoutedToAtHand(parentSessionId: string): readonly RoutedRequest[] | null
  whenAPersonLastWrote(sessionId: string): number | null
  requestsItsLastEndedTurnInterrupted(sessionId: string): readonly string[]
  lastEndedTurn(sessionId: string, unread?: RowsUnread): LastEndedTurn | null
  lastExchange(sessionId: string): Exchange
  whatOpenedTheLastEndedTurn(sessionId: string): ReceivedInATurn | null
  transcript(
    sessionId: string,
    read: { readonly back: number; readonly search: string | null },
  ): { readonly turns: readonly TranscriptTurn[]; readonly older: boolean }
  lastAskToStop(sessionId: string, unread?: RowsUnread): AskToStop | null
  appendGeneration(
    sessionId: string,
    generation: number,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): void
  promoteGeneration(
    sessionId: string,
    generation: number,
    through: { normalizerVersion: number; derivedThrough: number },
  ): boolean
  abandonGeneration(sessionId: string, generation: number, failure: string | null): void
  discardGeneration(sessionId: string, generation: number, limit: number): number
  deadGenerations(sessionId: string): number[]
  turns(sessionId: string): RecordedTurn[]
  closeOpenTurn(sessionId: string, reason: TurnEndReason, at: number): boolean
  reopened(sessionId: string, at: number): boolean
  closedByTheQuit(sessionIds: readonly string[], at: number): void
  whatTheQuitClosed(): readonly string[]
  restartedWorkLate(conversation: string, pieces: readonly string[], at: number): void
  backgroundTheRestartStopped(
    alsoTheseDied: readonly string[],
    before: number,
    notBefore: number,
  ): readonly { conversation: string; stopped: readonly string[]; endedAt: number }[]
  terminate(
    sessionId: string,
    status: 'ended' | 'errored',
    reason: TurnEndReason,
    at: number,
  ): boolean
  importSnapshot(snapshot: SessionSnapshot): void
  nextOrdinal(sessionId: string): number
  lastOrdinalWrite(sessionId: string): LedgerWriteStamp | undefined
}

export const NULL_SESSION_STORE: SessionStore = {
  create: () => {},
  connectionOf: () => null,
  firstLaunchOf: () => false,
  aLaunchWentUnnamed: () => false,
  adopt: () => {},
  identityOf: () => null,
  createAgentIdentity: () => null,
  providerOf: () => null,
  startedOnOf: () => NONE_STARTED,
  saveProviderIfNoneIsSaved: () => false,
  capabilitiesOf: () => null,
  agentIdentityNameById: () => null,
  reconciliationNames: () => [],
  agentIdentities: () => [],
  setCapabilities: () => false,
  ownNotesOf: () => null,
  currentOwnNotesOf: () => null,
  writeOwnNotes: () => null,
  undoOwnNotes: () => null,
  ownNotesUnread: () => ({ seenThrough: 0, newestAgentVersion: 0, unread: false }),
  markOwnNotesSeen: () => false,
  ownInstructionsOf: (profileSlug) => ({ identity: foldProfileName(profileSlug), versions: [] }),
  configuredLayerFor: () => null,
  writeOwnInstructions: () => null,
  undoOwnInstructions: () => null,
  instructionUnread: () => ({ seenThrough: 0, newestDirectVersion: 0, unread: false }),
  beginMethodChange: () => null,
  settleMethodChange: () => false,
  hasPendingMethodChange: () => false,
  methodChange: () => null,
  methodChanges: () => [],
  markInstructionsSeen: () => false,
  memoryAmendmentsOf: () => [],
  writeMemoryAmendment: () => null,
  beginMemoryAmendment: () => null,
  settleMemoryAmendment: () => false,
  hasPendingMemoryAmendment: () => false,
  memoryAmendment: () => null,
  instructionAsksWaiting: () => [],
  turnBlockCandidates: () => null,
  instructionAsksWaitingIn: () => null,
  replyQuestionWithoutARequest: () => null,
  settleInstructionAsk: () => false,
  mcpServerRequestsWaiting: () => [],
  mcpServerRequestWasMade: () => false,
  grantExternalMcpServer: () => null,
  externalMcpServers: () => [],
  registerExternalMcpServer: () => null,
  removeExternalMcpServer: () => false,
  externalMcpServersFor: () => [],
  setAgentProvider: () => false,
  setAgentDisplayName: () => false,
  modelChoiceOf: () => null,
  setModelChoice: () => false,
  handAddedModels: () => [],
  addHandAddedModel: () => [],
  deleteHandAddedModel: () => [],
  lastPicked: () => null,
  aPersonPicked: () => {},
  hasSealedApiKey: () => false,
  forgetSealedApiKey: () => {},
  conversationsPerIdentity: () => [],
  removeAgentIdentity: () => false,
  spawnPolicy: () => ({ spawningEnabled: false }),
  setSpawningEnabled: () => {},
  defaultApprovalModeChosen: () => false,
  defaultApprovalMode: () => 'ask',
  setDefaultApprovalMode: () => {},
  parentOf: () => null,
  ancestorsOf: () => [],
  importSnapshot: () => {},
  refreshAdopted: () => false,
  learnDescent: () => false,
  setApprovalMode: () => {},
  endPlanMode: () => {},
  startPlanMode: () => {},
  setModel: () => {},
  setReasoningEffort: () => {},
  aPersonSetItsModelOrEffort: () => {},
  setReportedModel: () => {},
  whatItRunsOn: () => null,
  workflowOutputPath: () => null,
  workflowAgentTask: () => null,
  workflowAgentIds: () => [],
  reportedSubAgent: () => false,
  ledgerStatus: () => ({
    present: false,
    derived: null,
    derivedThrough: 0,
    normalizerVersion: PRE_CONTRACT_NORMALIZER_VERSION,
    failure: null,
  }),
  beginGeneration: () => 0,
  clearOrphanBuilds: () => 0,
  settleOrphanRuns: () => 0,
  whatACrashLeftRunning: () => [],
  recordedTurnOpening: () => null,
  recordedTurnMessage: () => null,
  ensurePersonalRoot: () => {
    throw new Error('work is not being recorded')
  },
  theOpenTurn: () => null,
  theNewestTurn: () => null,
  theActiveGeneration: () => 0,
  aLifeOpenedTheTurn: () => false,
  howATurnEnded: () => null,
  whereItWasRouted: () => null,
  piecesOwnedBefore: () => [],
  whatBecameOfAMessage: () => 'absent',
  settleStrandedMessages: () => 0,
  messagesWaitingIn: () => [],
  // ⚠️ **0 for {@link settleStrandedMessages}' reason**: a store with no database repaired nothing.
  settleStrandedRequests: () => 0,
  stalledWorkNobodyWasToldAbout: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  stalledWorkItsGiverWasToldAbout: () => ({
    rows: [],
    walk: 'no-ledger',
    ledgers: 0,
    rowsUnread: 0,
  }),
  waitsThatNeedClassifying: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  stalledWorkAPersonGave: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  piecesWaitingOnWhoWrote: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  piecesWaitingOnWhoWroteIn: () => [],
  providerLimitsSeen: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  readAheadProviderWalls: () => true,
  // ⚠️ **0 for {@link settleStrandedRequests}' reason**: a store with no database repaired nothing.
  settleRestartedWork: () => 0,
  questionsAPersonMustAnswer: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  decisionsAwaitingAPerson: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  numberUnder: () => {
    throw new Error('no database: a piece of work cannot be numbered')
  },
  recordGive: () => {
    throw new Error('no database: a piece of work cannot be recorded')
  },
  reconciliationOwners: () => [],
  reconciliationWork: () => [],
  reconciliationReceiptsForOwner: () => [],
  reconciliationRecovery: () => null,
  reconciliationDrivenByTurn: () => [],
  reconciliationReceipts: () => [],
  reconciliationDelivery: () => 'not-delivered',
  workById: () => null,
  activityWorkNames: () => new Map(),
  workByLabel: () => null,
  rootOf: () => null,
  servicesBorn: () => [],
  workersBorn: () => [],
  workerGiverContains: () => false,
  workerInItsPlace: (conversation) => conversation,
  workerLedger: () => null,
  workerLineage: (conversation) => [conversation],
  workerQuestionTargets: () => null,
  rootDoneCondition: () => null,
  rootLines: () => ({ title: null, statusLine: null }),
  turnBlockRootLines: () => null,
  workThatNames: () => null,
  workThatNamesAndItsWait: () => ({ named: null, waitingOnPurpose: null }),
  workThatNamesUnder: () => null,
  workOnItsChainThatNames: () => null,
  childrenOf: () => [],
  depthOf: () => 0,
  pieceOfItsChainHeldBy: () => null,
  piecesOwnedBy: () => [],
  piecesWithTheirWaits: () => [],
  turnBlockPiecesOwnedBy: () => [],
  openPiecesOf: () => [],
  newestChildAs: () => null,
  conversationsOf: () => [],
  newestPiecesHeldIn: () => ({ rows: [], newest: 0, total: 0 }),
  pieceItWasStartedWith: () => null,
  addResource: () => {
    throw new Error('no database: a resource cannot be kept')
  },
  resourcesOf: () => [],
  untitledResources: () => [],
  titleResource: () => false,
  titledResources: () => [],
  retitleResource: () => false,
  filesKept: () => [],
  filesKeptTogether: () => ({ tree: [], added: [] }),
  madeBy: () => ({ rows: [], total: 0 }),
  keptFilesNewestFirst: () => ({ rows: [], through: null }),
  keptFilesBefore: () => 0,
  resource: () => null,
  digestWindow: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  activityWindow: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  conversationsHeldByNoAgent: () => 0,
  ...EMPTY_FOREST_STORE,
  workGivenOutBy: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  spawnedBy: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  conversationTree: () => [],
  whatTiesTheTreeOutside: () => [],
  providerSessionsOf: () => [],
  deleteTheTree: () => {
    throw new Error('there is no database to delete a conversation from')
  },
  conversationBinding: () => null,
  workThisOneGaveOut: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  workThisOneWasGiven: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  piecesGivenBy: () => [],
  workReportedTo: () => new Set<string>(),
  legacyOrdinaryStallWasReported: () => false,
  routedRequestsOf: () => [],
  questionsRoutedTo: () => [],
  questionsRaisedIn: () => new Map(),
  theDecisionOn: () => null,
  theRequestRouted: () => null,
  whoRoutedToWhom: () => [],
  conversationsHoldingACopyOf: () => [],
  fillQuestionCopies: () => ({ state: 'done', visited: 0, matched: 0 }),
  lastEndedTurn: () => null,
  routedRequestsAtHand: () => null,
  questionsRaisedAtHand: () => null,
  piecesAtHand: () => null,
  questionsRoutedToAtHand: () => null,
  whenAPersonLastWrote: () => null,
  requestsItsLastEndedTurnInterrupted: () => [],
  lastExchange: () => ({ received: null, answer: null }),
  whatOpenedTheLastEndedTurn: () => null,
  transcript: () => ({ turns: [], older: false }),
  lastAskToStop: () => null,
  appendGeneration: () => {},
  promoteGeneration: () => true,
  abandonGeneration: () => {},
  discardGeneration: () => 0,
  deadGenerations: () => [],
  findByProviderRef: () => null,
  nameItsLaunch: () => false,
  append: () => {},
  appendMany: () => {},
  atomically: (work) => work(),
  onCommitted: () => () => undefined,
  checkCommitted: () => undefined,
  resumable: () => [],
  unresumable: () => [],
  recorded: () => [],
  recordedOne: () => null,
  searchPastWork: () => ({ ok: false, reason: 'unavailable' }),
  closePastWorkSearch: () => {},
  pastWorkSearchSource: () => null,
  replacements: () => [],
  newestScheduleLevels: () => [],
  scheduleEvidenceRows: () => ({ rows: [], cut: false }),
  lastStatusAt: () => null,
  find: () => null,
  findLive: () => null,
  events: () => [],
  eventsFrom: () => [],
  ancestryContext: () => ({ epochs: [], entries: [], missing: [], truncated: false }),
  turnWindow: () => ({ entries: [], from: 0, hasOlder: false, turnAligned: true }),
  latestHumanAnswers: () => ({ latest: null, active: null }),
  humanFinalsInWindow: (): ReadonlyMap<number, HumanFinalContext> => new Map(),
  turns: () => [],
  closeOpenTurn: () => false,
  reopened: () => false,
  closedByTheQuit: () => {},
  backgroundTheRestartStopped: () => [],
  restartedWorkLate: () => {},
  whatTheQuitClosed: () => [],
  terminate: () => false,
  nextOrdinal: () => 0,
  lastOrdinalWrite: () => undefined,
}

interface SessionRow {
  id: string
  provider: string
  external_ref: string | null
  cwd: string
  status: string
  approval_mode: string | null
  profile_id: string | null
  reasoning_effort: string | null
  model: string | null
  plan_mode: number | null
  plan_ended_at: number | null
  model_or_effort_set_by_a_person_at: number | null
  reported_model: string | null
  reported_effort: string | null
  adopted_at: number | null
  restored_at: number | null
  child_descent: string | null
  has_events: number
  last_end_reason: string | null
  /** All null for a session with no `derived_generation` row — one this app recorded rather than projected. */
  normalizer_version: number | null
  building: number | null
  failure: string | null
  created_at: number
  updated_at: number
}

/** The generation columns of {@link SessionRow}, as the shape {@link derivedStateOf} reads. */
function derivedStateOfRow(row: SessionRow): DerivedState | null {
  if (row.normalizer_version === null) return null
  return derivedStateOf(
    {
      normalizerVersion: row.normalizer_version,
      building: row.building,
      failure: row.failure,
    },
    row.has_events !== 0,
  )
}

interface ProjectionState {
  normalizerVersion: number
  building: number | null
  failure: string | null
}

function derivedStateOf(row: ProjectionState | null, present: boolean): DerivedState | null {
  if (row === null) return null
  if (row.building !== null) return 'rebuilding'
  if (row.failure !== null) return 'failed'
  if (!present) return null
  return row.normalizerVersion < NORMALIZER_VERSION ? 'stale' : 'current'
}

function boundStoredEvent(event: TranscriptEvent): TranscriptEvent {
  return boundTheParts(boundOneRow(event))
}

function boundOneRow(event: TranscriptEvent): TranscriptEvent {
  return boundStoredPayloads(
    boundCardFacts(boundWorkReport(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event))))),
  )
}

function answerStoredOn(value: unknown): AnsweredQuestion | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const one = value as Record<string, unknown>
  if (
    !isAStoredId(one.requestId) ||
    !(one.answeredBy === null || isAStoredId(one.answeredBy)) ||
    typeof one.answer !== 'string' ||
    one.answer.length > REPLY_SUMMARY_LIMIT ||
    !(one.cannotAnswer === undefined || one.cannotAnswer === true) ||
    !(one.clipped === undefined || one.clipped === true)
  )
    return undefined
  return {
    requestId: one.requestId,
    answeredBy: one.answeredBy,
    answer: one.answer,
    ...(one.cannotAnswer === true ? { cannotAnswer: true } : {}),
    ...(one.clipped === true ? { clipped: true } : {}),
  }
}

function boundCardFacts(event: TranscriptEvent): TranscriptEvent {
  if (event.type === 'tool_result' && event.messageAct !== undefined) {
    const { messageAct, ...kept } = event
    return { ...kept, ...(isMessageAct(messageAct) ? { messageAct } : {}) }
  }
  if (event.type === 'message_sent') {
    const { messageAct, addressedAs, toLabel, ...kept } = event
    return {
      ...kept,
      ...(isMessageAct(messageAct) ? { messageAct } : {}),
      ...(isAStoredId(addressedAs) ? { addressedAs } : {}),
      ...(typeof toLabel === 'string' && toLabel.length > 0 && toLabel.length <= REPLY_SUMMARY_LIMIT
        ? { toLabel }
        : {}),
    }
  }
  if (event.type === 'tool_refused') {
    if (event.told === undefined) return event
    const { told: stored, ...kept } = event
    const told = storedRefusalTold(stored)
    return { ...kept, ...(told === undefined ? {} : { told }) }
  }
  if (
    event.type !== 'user_turn' &&
    event.type !== 'message_queued' &&
    event.type !== 'message_unqueued'
  )
    return event
  if (event.answeredQuestion === undefined) return event
  const { answeredQuestion: stored, ...kept } = event
  const answeredQuestion = answerStoredOn(stored)
  return { ...kept, ...(answeredQuestion === undefined ? {} : { answeredQuestion }) }
}

function boundTheParts(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' || event.parts === undefined) return event
  const stored: unknown = event.parts
  const parts = (Array.isArray(stored) ? (stored as unknown[]) : [])
    .slice(0, MAX_TURN_PARTS)
    .flatMap((one): UserTurnPart[] => {
      if (typeof one !== 'object' || one === null) return []
      const said = one as Record<string, unknown>
      if (typeof said.text !== 'string') return []
      const built: Record<string, unknown> = {}
      built.type = event.type
      for (const key of USER_TURN_PART_KEYS) if (said[key] !== undefined) built[key] = said[key]
      const bounded = boundOneRow(built as TranscriptEvent)
      if (bounded.type !== 'user_turn') return []
      const { type: _type, ...part } = bounded
      void _type
      return [part]
    })
  return { ...event, parts }
}

function authorshipStoredOn(payload: string | null): TurnAuthorship {
  const stored = aStoredObject(payload)
  if (stored === null) return {}
  const carried: Record<string, unknown> = {}
  for (const key of TURN_AUTHORSHIP_KEYS) {
    const value = stored[key]
    if (key === 'movedFrom') {
      const origin = moveOriginOf(value)
      if (origin !== undefined) carried[key] = origin
    } else if (key === 'answeredQuestion') {
      const answer = answerStoredOn(value)
      if (answer !== undefined) carried[key] = answer
    } else if (value !== undefined) carried[key] = value
  }
  return carried as TurnAuthorship
}

function attachmentsStoredOn(payload: string | null): { attachments?: HandedPath[] } {
  const attachments = aStoredObject(payload)?.attachments
  return attachments === undefined ? {} : { attachments: attachments as HandedPath[] }
}

function isMailboxKind(kind: unknown): kind is MailboxKind {
  return typeof kind === 'string' && (MAILBOX_KINDS as readonly string[]).includes(kind)
}

function theQuestionItAsks(stored: unknown): { readonly asks: TheQuestionItAsks } | null {
  if (typeof stored !== 'object' || stored === null) return null
  const { asker, requestId } = stored as Record<string, unknown>
  if (typeof asker !== 'string' || asker.length === 0) return null
  if (typeof requestId !== 'string' || requestId.length === 0) return null
  return { asks: { asker, requestId } }
}

function aStoredObject(payload: string | null): Record<string, unknown> | null {
  if (payload === null) return null
  let stored: unknown
  try {
    stored = JSON.parse(payload)
  } catch {
    return null
  }
  return typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : null
}

function boundPieceNamed(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' && event.type !== 'message_sent') return event
  if (event.piece === undefined && event.label === undefined) return event
  const aPiece = isAStoredId(event.piece)
  const aLabel = aPiece && typeof event.label === 'string' && pieceNumbersOf(event.label) !== null
  if (aPiece && (event.label === undefined || aLabel)) return event
  const { piece: _piece, label: _label, ...rest } = event
  void _piece
  void _label
  return (aPiece ? { ...rest, piece: event.piece } : rest) as TranscriptEvent
}

function boundTheDrive(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' && event.type !== 'message_queued') return event
  if (event.drives === undefined || isAStoredId(event.drives)) return event
  const { drives: _drives, ...rest } = event
  void _drives
  return rest as TranscriptEvent
}

function boundRelayedIdentity(event: TranscriptEvent): TranscriptEvent {
  if (event.type === 'work_interrupted' || event.type === 'stop_unanswered') {
    if (event.agentProfile === undefined) return event
    const asker: unknown = event.agentProfile
    if (typeof asker === 'string' && isPathSegment(asker) && typeof event.agent === 'string') {
      return event
    }
    const { agentProfile: _unplaced, ...kept } = event
    void _unplaced
    return kept as TranscriptEvent
  }
  if (
    event.type === 'user_turn' ||
    event.type === 'message_queued' ||
    event.type === 'message_unqueued'
  ) {
    if (event.relayedFromProfile === undefined) return event
    const slug: unknown = event.relayedFromProfile
    if (typeof slug === 'string' && isPathSegment(slug)) return event
    const { relayedFromProfile: _stored, ...rest } = event
    void _stored
    return rest as TranscriptEvent
  }
  return event
}

function boundStoredPayloads(event: TranscriptEvent): TranscriptEvent {
  if (
    (event.type === 'work_given' || event.type === 'work_rebriefed') &&
    event.definitionOfDone !== undefined &&
    (typeof event.definitionOfDone !== 'string' ||
      event.definitionOfDone.length > 512 ||
      event.definitionOfDone.trim() === '')
  )
    throw new Error('unread done condition')
  if (
    event.type === 'work_rebriefed' &&
    event.brief === undefined &&
    event.definitionOfDone === undefined
  )
    throw new Error('empty work revision')
  if (event.type === 'user_input_request') {
    return { ...event, questions: [...storedQuestionsParsed(event.questions)] }
  }
  if (
    (event.type === 'user_turn' ||
      event.type === 'message_queued' ||
      event.type === 'message_unqueued') &&
    event.attachments !== undefined
  ) {
    const kept = boundHandedPaths(event.attachments)
    if (kept.length > 0) return { ...event, attachments: kept }
    const { attachments: _dropped, ...rest } = event
    void _dropped
    return rest as TranscriptEvent
  }
  if (event.type === 'memory_note') {
    const notes = boundMemoryNotes(event.notes)
    const cut = Math.max(0, boundedLength(event.notes) - notes.length)
    const dropped =
      (typeof event.dropped === 'number' && event.dropped > 0 ? event.dropped : 0) + cut
    return { ...event, notes, ...(dropped > 0 ? { dropped } : {}) }
  }
  if (event.type === 'memory_loaded') {
    const usable =
      typeof event.index === 'string' &&
      event.index.length > 0 &&
      event.index.length <= MAX_STORED_PATH_CHARS
    const beside =
      typeof event.beside === 'number' && Number.isFinite(event.beside) && event.beside >= 0
        ? Math.floor(event.beside)
        : 0
    const lookedAt =
      typeof event.lookedAt === 'number' && Number.isFinite(event.lookedAt) && event.lookedAt > 0
        ? Math.floor(event.lookedAt)
        : undefined
    // CONSTRUCTED, never spread — the rule `boundMemoryNotes` records one function over.
    return {
      type: 'memory_loaded',
      index: usable ? event.index : '',
      beside,
      ...(lookedAt === undefined ? {} : { lookedAt }),
    }
  }
  if (event.type === 'memory_recall') {
    const claimed = Array.isArray(event.entries) ? event.entries.length : 0
    const sent = storedRecallEntries(event.entries)
    const bound = boundRecall(sent, storedThreadIds(event.threadIds))
    const dropped =
      (typeof event.dropped === 'number' && event.dropped > 0 ? event.dropped : 0) +
      (claimed - sent.length) +
      bound.dropped
    const threadsDropped =
      (typeof event.threadsDropped === 'number' && event.threadsDropped > 0
        ? event.threadsDropped
        : 0) + bound.threadsDropped
    const {
      threadIds: _storedIds,
      dropped: _storedDropped,
      threadsDropped: _storedThreadsDropped,
      ...rest
    } = event
    void _storedIds
    void _storedDropped
    void _storedThreadsDropped
    return {
      ...rest,
      entries: bound.entries,
      ...(dropped > 0 ? { dropped } : {}),
      ...(bound.threadIds.length > 0 ? { threadIds: bound.threadIds } : {}),
      ...(threadsDropped > 0 ? { threadsDropped } : {}),
    }
  }
  if (event.type !== 'unknown') return event
  const bounded = boundRaw(event.raw, event.label)
  // Returned by identity when nothing was over the limit, so the common path allocates nothing.
  return bounded === event.raw ? event : { ...event, raw: bounded }
}

function boundHandedPaths(attachments: unknown): HandedPath[] {
  return (Array.isArray(attachments) ? attachments : [])
    .filter(
      (each): each is HandedPath =>
        typeof each?.path === 'string' &&
        each.path.length > 0 &&
        each.path.length <= MAX_STORED_PATH_CHARS &&
        (each.kind === 'file' || each.kind === 'directory'),
    )
    .slice(0, MAX_HANDED_PATHS)
    .map((each) => ({ path: each.path, kind: each.kind, outsideCwd: each.outsideCwd === true }))
}

function boundWorkReport(event: TranscriptEvent): TranscriptEvent {
  if (
    event.type !== 'user_turn' &&
    event.type !== 'message_queued' &&
    event.type !== 'message_unqueued'
  ) {
    return event
  }
  if (event.work === undefined) return event
  const kept = isAWorkReport(event.work) ? boundedWorkReport(event.work) : null
  const { work: _stored, ...rest } = event
  void _stored
  return (kept === null ? rest : { ...rest, work: kept }) as TranscriptEvent
}

function isAStoredId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STORED_ID_CHARS
}

function boundedWorkReport(report: WorkReport): WorkReport | null {
  if (
    !isAStoredId(report.piece) ||
    !isAStoredId(report.state) ||
    pieceNumbersOf(report.label) === null
  ) {
    return null
  }
  const resources = Array.isArray(report.resources)
    ? report.resources.filter(isAStoredId).slice(0, MAX_RESOURCES_PER_REPLY)
    : []
  return {
    piece: report.piece,
    label: report.label,
    ...(isAStoredId(report.owner) ? { owner: report.owner } : {}),
    state: report.state,
    ...(isAStoredId(report.outcome) ? { outcome: report.outcome } : {}),
    ...(resources.length > 0 ? { resources } : {}),
    ...(report.needsUserAction === true ? { needsUserAction: true as const } : {}),
    ...(isAStoredId(report.stalledBecause) ? { stalledBecause: report.stalledBecause } : {}),
  }
}

/** How many entries the stored row claimed, so what the bound removed can be counted rather than guessed. */
function boundedLength(notes: unknown): number {
  return Array.isArray(notes) ? notes.length : 0
}

function storedRecallEntries(entries: unknown): MemoryRecallEntry[] {
  return (Array.isArray(entries) ? entries : [])
    .filter(
      (each): each is Record<string, unknown> =>
        typeof each === 'object' && each !== null && typeof each['path'] === 'string',
    )
    .map((each) => {
      const start = each['lineStart']
      const end = each['lineEnd']
      const ranged =
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end >= start
      return {
        path: each['path'] as string,
        ...(ranged ? { lineStart: start as number, lineEnd: end as number } : {}),
        ...(typeof each['note'] === 'string' ? { note: each['note'] } : {}),
      }
    })
}

function storedThreadIds(ids: unknown): string[] {
  return (Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === 'string')
}

function boundMemoryNotes(notes: unknown): MemoryNoteSeen[] {
  return (Array.isArray(notes) ? notes : [])
    .filter(
      (each): each is MemoryNoteSeen =>
        typeof each?.path === 'string' &&
        each.path.length > 0 &&
        each.path.length <= MAX_STORED_PATH_CHARS,
    )
    .slice(0, MEMORY_NOTES_PER_EVENT)
    .map((each) => {
      const text = typeof each.text === 'string' ? each.text.slice(0, MEMORY_NOTE_TEXT_CAP) : null
      return {
        path: each.path,
        ...(typeof each.bytes === 'number' && Number.isFinite(each.bytes) && each.bytes >= 0
          ? { bytes: each.bytes }
          : {}),
        ...(typeof each.unread === 'string' && each.unread.length > 0 && each.unread.length <= 64
          ? { unread: each.unread }
          : {}),
        ...(text === null ? {} : { text }),
        ...(each.truncated === true ||
        (typeof each.text === 'string' && each.text.length > MEMORY_NOTE_TEXT_CAP)
          ? { truncated: true }
          : {}),
      }
    })
}

const MAX_STORED_PATH_CHARS = 4096

const MAX_STORED_ID_CHARS = 200

function resolveEndReason(value: string | null): TurnEndReason | null {
  if (value === null) return null
  return turnEndingSchema.safeParse(value).success ? (value as TurnEndReason) : 'unknown'
}

/** The open-turn lookup's row — just enough to decide attribution and status. */
interface OpenTurnRow {
  id: string
  blocked_at: number | null
}

interface ExchangeRow {
  readonly type: string
  readonly payload: string | null
  readonly ordinal: number
}

interface ClosedTurnRow {
  id: string
  opened_at: number
  closed_at: number
}

interface AskRow {
  payload: string
  created_at: number
  turn_id: string | null
  type: string
  ordinal: number
}

export interface RecordedTurn {
  id: string
  ordinal: number
  prompt: string
  openedAt: number
  closedAt: number | null
  endReason: TurnEndReason | null
  /** Since when it has been waiting on the user, or null. */
  blockedAt: number | null
}

type TurnEndReason = TurnEnding

function parseBound(stored: number | null, fallback: number): number {
  if (stored === null) return fallback
  return Number.isInteger(stored) && stored >= 0 ? stored : 0
}

interface CapabilityRow {
  max_depth: number | null
  can_message: string | null
  can_assign_work: string | null
  can_create_agents: string | null
  can_write_rules: string | null
}

function parseChoice<K extends ChoiceKey>(key: K, stored: string | null): ProfileCapabilities[K] {
  const field = capabilityField(key) as unknown as CapabilityField<K>
  if (stored === null) return field.ruled
  const words: readonly string[] = field.vocabulary ?? []
  return words.includes(stored) ? (stored as ProfileCapabilities[K]) : field.narrowest
}

function parseStrings(stored: string | null): readonly string[] {
  if (stored === null) return []
  try {
    const raw: unknown = JSON.parse(stored)
    return Array.isArray(raw)
      ? raw.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
      : []
  } catch {
    return []
  }
}

type ChoiceKey = {
  [K in CapabilityKey]: ProfileCapabilities[K] extends string ? K : never
}[CapabilityKey]

/** How many of a conversation's newest turns are read to learn when a person last wrote. */
export const PERSON_LAST_WROTE_WITHIN_TURNS = 200

function theFoldIndexHolds(statement: { readonly source: string }): void {
  const sql = statement.source
  const lists = [...sql.matchAll(/(?<![.\w])type\s+in\s*\(([^)]*)\)/gi)].map((one) => one[1] ?? '')
  const named = [
    ...lists.flatMap((list) => [...list.matchAll(/'([^']*)'/g)].map((one) => one[1] ?? '')),
    ...[...sql.matchAll(/(?<![.\w])type\s*=\s*'([^']*)'/gi)].map((one) => one[1] ?? ''),
  ]
  const unreadable =
    /(?<![.\w])type\s+(?:not\s+in|like|glob)\b|(?<![.\w])type\s*(?:<>|!=|=\s*[?@:$])/i.test(sql) ||
    lists.some((list) => /[?@:$]/.test(list))
  const missing = named.filter((type) => !FOLD_EVENT_TYPES.includes(type))
  if (unreadable || missing.length > 0) {
    throw new Error(
      unreadable
        ? 'a read through events_fold_idx compares the event type in a way that cannot be checked ' +
            'against the types the index holds: name its types as literals'
        : `a read through events_fold_idx names ${missing.join(', ')}, which the index does not hold: ` +
            'add it to FOLD_EVENT_TYPES in db/fold-index.ts and generate the migration that ' +
            'recreates the index',
    )
  }
}

/** Times named read phases without receiving their SQL arguments or row contents. */
export interface SessionReadPhases {
  timed<T>(phase: string, read: () => T): T
}

/** A conversation's launch: where in its ledger and when. */
interface Launch {
  readonly ordinal: number
  readonly created_at: number
}
/** An error row that may say a provider wall, read once. */
interface WallRead {
  readonly session_id: string
  readonly ordinal: number
  readonly created_at: number
  /** The wall it says, `null` for none, or `unread` for a row this app could not read. */
  readonly said: ProviderLimitSeen | null | 'unread'
  /** When the life that wrote it began, once asked. */
  life?: number | null
}
/** A clear whose payload was not JSON: counted where it is met, never read as a clear. */
interface TornClear {
  readonly session_id: string
  readonly ordinal: number
  readonly generation: number
  readonly created_at: number
}
/** What the watch had counted when a walls read was made — see {@link watchProviderWalls}. */
interface WallWatchStamp {
  readonly revision: bigint
  readonly dataVersion: bigint
}
interface WallWatchStatements {
  readonly sample: AppStatement
  readonly added: AppStatement
  readonly emptied: AppStatement
  readonly empty: AppStatement
  readonly turnsFilled: AppStatement
  readonly turnsBegun: AppStatement
  readonly turnsReadTo: AppStatement
  readonly emptyTurns: AppStatement
  readonly keepTurn: AppStatement
  readonly turnsSince: AppStatement
}
/** A row of the walls read's types added since it was kept, as the watch's queue names it. */
interface AddedWallRow {
  /** Its place in the watch's queue. */
  readonly added: number
  readonly row: number
  readonly type: string
  readonly session_id: string
  readonly ordinal: number
  readonly generation: number
  readonly created_at: number
  /** An error row's payload where it may say a wall, otherwise `null`. */
  readonly payload: string | null
  readonly readable: number
  readonly window: string | null
  readonly provider: string
}
type SessionTakingWork = ProviderTakingWork & { readonly session_id: string }
interface WallsRead {
  /** What the watch had counted when it was read whole; `null` for a read that is not kept. */
  readonly stamp: WallWatchStamp | null
  /** The newest row of the watch's queue taken in. */
  added: number
  /** The oldest instant it holds the rows from. */
  since: number
  /** Where its next slice begins, in the error index's order; `null` once it is read whole. */
  next: { readonly at: number; readonly row: number } | null
  /** By rowid. */
  readonly rows: Map<number, WallRead>
  readonly launches: Map<string, Launch[]>
  /** The conversations launched too often for their launches to be kept. */
  readonly launchesNotKept: Set<string>
  /** The newest clear of each provider, conversation and window; torn clears are held by rowid. */
  readonly clears: Map<string, SessionTakingWork>
  readonly torn: Map<number, TornClear>
  /** Where its clears' next slice begins; `null` once they are read whole. */
  clearsNext: { readonly at: number; readonly row: number } | null
}
const wallsReadOn = new WeakMap<object, WallsRead>()
/** How many error rows one slice of the walls read reads. */
const WALLS_READ_AT_ONCE = 256
/** How many turn rows one slice of the completed-turns fill reads. */
const TURNS_READ_AT_ONCE = 10_000
/** How much further back than its lookback a kept walls read holds. */
const WALLS_KEPT_BEFORE_MS = 60 * 60 * 1000
const WALL_QUEUE_EMPTIED_FROM = 1024
/** How many launches of one conversation a kept walls read keeps. */
const LAUNCHES_KEPT_AT_MOST = 1024

export function createSessionStore(
  db: AppDatabase,
  now: () => number = Date.now,
  readPhases?: SessionReadPhases,
  /** Where a new agent's name is drawn from: a number in [0, 1), as `Math.random` gives. */
  random: () => number = Math.random,
  checkFoldState?: (state: readonly unknown[], complete?: boolean) => void,
  oneSnapshot = false,
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
  const phase = <T>(name: string, read: () => T): T =>
    readPhases === undefined ? read() : readPhases.timed(`store.providerLimitsSeen.${name}`, read)

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
  let spawnStatements: {
    readCapabilities: AppStatement
    writeCapabilities: AppStatement
    listIdentities: AppStatement
    ensureIdentityRow: AppStatement
    identityNameById: AppStatement
    identityBySlug: AppStatement
    namesInUse: AppStatement
    writeProvider: AppStatement
    writeDisplayName: AppStatement
    readModelChoice: AppStatement
    writeModelChoice: AppStatement
    deleteIdentity: AppStatement
    conversationsPerIdentity: AppStatement
    startedOnOf: AppStatement
    identityOfSession: AppStatement
    writeIdentityOnSession: AppStatement
    readPolicy: AppStatement
    readApprovalDefault: AppStatement
    writeApprovalDefault: AppStatement
    writePolicy: AppStatement
    readParent: AppStatement
    writeParent: AppStatement
    ancestors: AppStatement
    spawnedBy: AppStatement
    conversationBinding: AppStatement
  } | null = null
  const spawnSql = (): NonNullable<typeof spawnStatements> =>
    (spawnStatements ??= {
      readCapabilities: db.prepare(
        `SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE id = ?`,
      ),
      writeCapabilities: db.prepare(
        `UPDATE agent_identity SET ${CAPABILITY_COLUMNS.map((column) => `${column} = ?`).join(', ')}
          WHERE id = ?`,
      ),
      listIdentities: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity ORDER BY slug`),
      ensureIdentityRow: db.prepare(
        `INSERT OR IGNORE INTO agent_identity
           (id, slug, display_name, provider, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      namesInUse: db.prepare(`SELECT slug, display_name AS displayName FROM agent_identity`),
      identityBySlug: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity WHERE slug = ?`),
      identityNameById: db.prepare(
        'SELECT id, slug, display_name AS displayName FROM agent_identity WHERE id = ?',
      ),
      writeProvider: db.prepare(`UPDATE agent_identity SET provider = ? WHERE id = ?`),
      writeDisplayName: db.prepare(`UPDATE agent_identity SET display_name = ? WHERE id = ?`),
      readModelChoice: db.prepare(`SELECT model_choice FROM agent_identity WHERE slug = ?`),
      writeModelChoice: db.prepare(`UPDATE agent_identity SET model_choice = ? WHERE id = ?`),

      deleteIdentity: db.prepare(`DELETE FROM agent_identity WHERE id = ?`),
      conversationsPerIdentity: db.prepare(
        `SELECT agent_identity_id AS identity, provider, count(*) AS conversations,
                count(external_ref) AS started
           FROM provider_session
          WHERE agent_identity_id IS NOT NULL
          GROUP BY agent_identity_id, provider`,
      ),
      /** One identity's started conversations on each provider, through `provider_session_identity_idx`. */
      startedOnOf: db.prepare(
        `SELECT provider, count(*) AS started FROM provider_session
          WHERE agent_identity_id = ? AND external_ref IS NOT NULL
          GROUP BY provider`,
      ),
      identityOfSession: db.prepare(
        `SELECT identity.slug AS profile_slug
           FROM provider_session s
           JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id = ?`,
      ),
      writeIdentityOnSession: db.prepare(
        `UPDATE provider_session SET agent_identity_id = ? WHERE id = ?`,
      ),
      readPolicy: db.prepare(`SELECT spawning_enabled FROM app_policy WHERE id = 'policy'`),
      writePolicy: db.prepare(
        `UPDATE app_policy SET spawning_enabled = ?, updated_at = ? WHERE id = 'policy'`,
      ),
      readApprovalDefault: db.prepare(
        `SELECT default_approval_mode FROM app_policy WHERE id = 'policy'`,
      ),
      writeApprovalDefault: db.prepare(
        `UPDATE app_policy SET default_approval_mode = ? WHERE id = 'policy'`,
      ),
      readParent: db.prepare(`SELECT parent_session_id FROM provider_session WHERE id = ?`),
      spawnedBy: db.prepare(
        `SELECT s.id AS id, s.provider AS provider, identity.slug AS identity
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.parent_session_id = ?
          ORDER BY s.created_at, s.id`,
      ),
      conversationBinding: db.prepare(
        `SELECT s.provider AS provider, identity.slug AS identity
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id = ?`,
      ),
      writeParent: db.prepare(`UPDATE provider_session SET parent_session_id = ? WHERE id = ?`),
      ancestors: db.prepare(
        `WITH RECURSIVE ancestry(id, parent, depth) AS (
           SELECT id, parent_session_id, 0 FROM provider_session WHERE id = ?
           UNION ALL
           SELECT s.id, s.parent_session_id, a.depth + 1
             FROM provider_session s JOIN ancestry a ON s.id = a.parent
            WHERE a.depth < 64
         )
         SELECT id FROM ancestry WHERE depth > 0 AND id <> ? ORDER BY depth`,
      ),
    })

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

  let ownInstructionStatements: {
    versionsOf: AppStatement
    newestOf: AppStatement
    insertVersion: AppStatement
    versionOf: AppStatement
    seenOf: AppStatement
    markSeen: AppStatement
    newestDirect: AppStatement
  } | null = null
  const ownInstructionSql = (): NonNullable<typeof ownInstructionStatements> =>
    (ownInstructionStatements ??= {
      versionsOf: db.prepare(
        `SELECT version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at
           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC`,
      ),
      newestOf: db.prepare(
        `SELECT version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at
           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC LIMIT 1`,
      ),
      insertVersion: db.prepare(
        `INSERT INTO identity_instruction
           (id, identity_id, version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      versionOf: db.prepare(
        'SELECT text FROM identity_instruction WHERE identity_id = ? AND version = ?',
      ),
      seenOf: db.prepare(
        'SELECT seen_through FROM identity_instruction_seen WHERE identity_id = ?',
      ),
      markSeen:
        db.prepare(`INSERT INTO identity_instruction_seen (identity_id, seen_through) VALUES (?, ?)
        ON CONFLICT(identity_id) DO UPDATE SET seen_through = max(seen_through, excluded.seen_through)`),
      newestDirect: db.prepare(`SELECT max(version) AS version FROM identity_instruction
        WHERE identity_id = ? AND wrote_it = 'an-agent-direct'`),
    })

  /** One `identity_instruction` row as `better-sqlite3` hands it back. */
  type OwnInstructionRow = {
    version: number
    text: string
    wrote_it: unknown
    author: string | null
    by: unknown
    conversation_id: string | null
    said: string | null
    brought_back: number | null
    created_at: number
  }

  const foldWhoWroteIt = (stored: unknown): WhoWroteIt =>
    typeof stored === 'string' && (WHO_WROTE_IT as readonly string[]).includes(stored)
      ? (stored as WhoWroteIt)
      : 'an-agents-proposal'

  const actorOf = (stored: unknown): ActedBy => {
    if (typeof stored !== 'string') return actedByFrom(stored)
    try {
      return actedByFrom(JSON.parse(stored) as unknown)
    } catch {
      return THE_APP_DID_IT
    }
  }

  const authorFrom = (stored: string | null): RulesAuthor | undefined => {
    if (stored === null) return undefined
    try {
      const value: unknown = JSON.parse(stored)
      if (value === null || typeof value !== 'object') return undefined
      const fields = value as Record<string, unknown>
      return typeof fields['profile'] === 'string' && typeof fields['name'] === 'string'
        ? { profile: fields['profile'], name: fields['name'] }
        : undefined
    } catch {
      return undefined
    }
  }

  const ownInstructionFrom = (row: OwnInstructionRow): OwnInstructionsVersion => {
    const author = authorFrom(row.author)
    return {
      version: row.version,
      text: row.text,
      whoWroteIt: foldWhoWroteIt(row.wrote_it),
      by: actorOf(row.by),
      conversation: row.conversation_id,
      said: row.said,
      broughtBack: row.brought_back,
      writtenAt: row.created_at,
      ...(author === undefined ? {} : { author }),
    }
  }

  let memoryAmendmentStatements: {
    amendmentsOf: AppStatement
    newestOf: AppStatement
    newestForEntry: AppStatement
    amendmentById: AppStatement
    insertAmendment: AppStatement
  } | null = null
  const memoryAmendmentSql = (): NonNullable<typeof memoryAmendmentStatements> =>
    (memoryAmendmentStatements ??= {
      amendmentsOf: db.prepare(
        `SELECT id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at
           FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC`,
      ),
      newestOf: db.prepare(
        `SELECT seq FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC LIMIT 1`,
      ),
      newestForEntry: db.prepare(
        `SELECT id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at
           FROM identity_memory_amendment WHERE identity_id = ? AND provider = ? AND entry = ? AND outcome NOT IN ('pending', 'unchanged') ORDER BY seq DESC LIMIT 1`,
      ),
      amendmentById: db.prepare(
        'SELECT * FROM identity_memory_amendment WHERE identity_id = ? AND id = ?',
      ),
      insertAmendment: db.prepare(
        `INSERT INTO identity_memory_amendment
           (id, identity_id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    })

  /** One `identity_memory_amendment` row as `better-sqlite3` hands it back. */
  type MemoryAmendmentRow = {
    id: string
    seq: number
    provider: string
    entry: string
    act: unknown
    by: unknown
    text_before: string | null
    text_after: string | null
    created_at: number
    source_id: string | null
    outcome: MemoryOutcome
    actual: string | null
    settled_by: string | null
    settled_at: number | null
  }

  const foldAmendmentAct = (stored: unknown): MemoryAmendmentAct =>
    typeof stored === 'string' && (MEMORY_AMENDMENT as readonly string[]).includes(stored)
      ? (stored as MemoryAmendmentAct)
      : 'corrected'

  const memoryRecoveryFrom = (
    row: MemoryAmendmentRow,
  ): Pick<MemoryAmendment, 'outcome' | 'actual' | 'settlement'> => {
    if (
      row.outcome === 'done' &&
      row.actual === null &&
      row.settled_by === null &&
      row.settled_at === null
    )
      return {}
    if (
      row.outcome === 'pending' &&
      row.actual === null &&
      row.settled_by === null &&
      row.settled_at === null
    )
      return { outcome: 'pending' }
    const actual = row.actual === null ? null : memoryObservation(JSON.parse(row.actual))
    const observer = row.settled_by === null ? null : JSON.parse(row.settled_by)
    if (
      !['done', 'partial', 'unchanged'].includes(row.outcome) ||
      actual === null ||
      observer === null ||
      !isWhoDidIt(observer.who) ||
      (observer.who === 'an-agent' &&
        (typeof observer.agent !== 'string' || observer.agent === '')) ||
      !Number.isSafeInteger(row.settled_at) ||
      row.settled_at === null ||
      row.settled_at < 0
    )
      throw new Error('Memory recovery observation is unreadable')
    return {
      outcome: row.outcome,
      actual,
      settlement: { by: actedByFrom(observer), at: row.settled_at },
    }
  }

  const memoryAmendmentFrom = (row: MemoryAmendmentRow): MemoryAmendment => ({
    id: row.id,
    seq: row.seq,
    provider: parseProvider(row.provider) ?? DEFAULT_IDENTITY_PROVIDER,
    entry: row.entry,
    act: foldAmendmentAct(row.act),
    by: actorOf(row.by),
    textBefore: row.text_before,
    textAfter: row.text_after,
    at: row.created_at,
    ...memoryRecoveryFrom(row),
    ...(row.source_id === null ? {} : { sourceId: row.source_id }),
  })

  const appendMemoryAmendment = (
    said: MemoryAmendmentWrite,
    at: number,
    outcome: 'pending' | 'done',
  ): MemoryAmendment | null => {
    if (outcome === 'pending' && !validMemoryIntent(said, at)) return null
    const rowId = agentIdentityRowId(said.profileSlug)
    return db.transaction((): MemoryAmendment | null => {
      if (spawnSql().identityBySlug.get(foldProfileName(said.profileSlug)) === undefined) {
        return null
      }
      if (memoryRecoveryStore.hasPending(rowId)) return null
      const linked = said.act === 'restored' || said.sourceId !== undefined
      if (linked) {
        if (typeof said.sourceId !== 'string' || !Number.isSafeInteger(at) || at < 0) return null
        const raw = memoryAmendmentSql().newestForEntry.get(rowId, said.provider, said.entry) as
          MemoryAmendmentRow | undefined
        if (raw === undefined || raw.id !== said.sourceId) return null
        const source = memoryAmendmentFrom(raw)
        if (said.act === 'restored') {
          if (
            source.act !== 'removed' ||
            typeof source.textBefore !== 'string' ||
            said.textBefore !== null ||
            said.textAfter !== source.textBefore
          )
            return null
        } else if (said.act === 'removed') {
          if (
            source.act !== 'restored' ||
            typeof source.textAfter !== 'string' ||
            said.textBefore !== source.textAfter ||
            said.textAfter !== null
          )
            return null
        } else if (said.act === 'corrected' && outcome === 'pending') {
          if (
            source.act !== 'corrected' ||
            said.textBefore !== source.textAfter ||
            said.textAfter !== source.textBefore
          )
            return null
        } else return null
        if (!knownMemorySource(source, said.textBefore)) return null
      }
      const by = said.by
      const newest = memoryAmendmentSql().newestOf.get(rowId) as { seq: number } | undefined
      const seq = (newest?.seq ?? 0) + 1
      const id = memoryAmendmentRowId(said.profileSlug, seq)
      memoryAmendmentSql().insertAmendment.run(
        id,
        rowId,
        seq,
        said.provider,
        said.entry,
        said.act,
        JSON.stringify(by),
        said.textBefore,
        said.textAfter,
        at,
        said.sourceId ?? null,
        outcome,
      )
      return {
        id,
        seq,
        provider: said.provider,
        entry: said.entry,
        act: said.act,
        by,
        textBefore: said.textBefore,
        textAfter: said.textAfter,
        at,
        ...(outcome === 'pending' ? { outcome } : {}),
        ...(said.sourceId === undefined ? {} : { sourceId: said.sourceId }),
      }
    })()
  }

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

  const readCapabilities = (rowId: string): ProfileCapabilities | null => {
    const row = spawnSql().readCapabilities.get(rowId) as CapabilityRow | undefined
    if (row === undefined) return null
    return {
      maxDepth: parseBound(row.max_depth, DEFAULT_CAPABILITIES.maxDepth),
      canMessage: parseChoice('canMessage', row.can_message),
      canAssignWork: parseChoice('canAssignWork', row.can_assign_work),
      canCreateAgents: parseChoice('canCreateAgents', row.can_create_agents),
      canWriteRules: parseChoice('canWriteRules', row.can_write_rules),
    }
  }

  const IDENTITY_COLUMNS = `id, slug, display_name, provider, created_at, created_by, ${CAPABILITY_COLUMNS.join(', ')}`

  type IdentityRow = {
    id: string
    slug: string
    display_name: string | null
    provider: string | null
    created_at: number
    created_by: string | null
    [column: string]: string | number | null
  }

  const identityFrom = (row: IdentityRow): AgentIdentity => {
    const capabilities = readCapabilities(row.id) ?? DEFAULT_CAPABILITIES
    const chosen = Object.fromEntries(
      CAPABILITY_FIELDS.map((field) => [
        field.key,
        row[field.column] === null ? 'default' : 'chosen',
      ]),
    ) as CapabilityOrigins
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      createdAt: row.created_at,
      createdBy: readIdentityCreator(row.created_by),
      capabilities,
      chosen,
      provider: parseProvider(row.provider),
      externalMcpServerIds: grantedServerIds(row.id),
    }
  }

  type SaidAtCreation = {
    displayName: string | null
    provider: Provider | null
  }

  const nameForANewIdentity = (profileSlug: string): string | null => {
    const folded = foldProfileName(profileSlug)
    if (folded === DEFAULT_PROFILE_ID) return null
    if (spawnSql().identityBySlug.get(folded) !== undefined) return null
    const rows = spawnSql().namesInUse.all() as { slug: string; displayName: string | null }[]
    const taken: string[] = []
    for (const row of rows) {
      taken.push(row.slug)
      if (row.displayName !== null) taken.push(row.displayName)
    }
    return aNameForANewAgent(taken, random)
  }

  const writeIdentityRow = (
    profileSlug: string,
    at: number,
    said: SaidAtCreation,
    broughtIntoBeingBy: IdentityCreator | null,
  ): void => {
    spawnSql().ensureIdentityRow.run(
      agentIdentityRowId(profileSlug),
      foldProfileName(profileSlug),
      said.displayName,
      said.provider,
      at,
      broughtIntoBeingBy === null ? null : identityCreatorColumn(broughtIntoBeingBy),
    )
  }

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

  const identityRowFor = (profileSlug: string, at: number): string => {
    writeIdentityRow(
      profileSlug,
      at,
      {
        displayName: nameForANewIdentity(profileSlug),
        provider: seededProviderFor(profileSlug),
      },
      { by: 'this-app' },
    )
    return agentIdentityRowId(profileSlug)
  }
  const insertAdopted = db.prepare(
    `INSERT INTO provider_session (id, provider, external_ref, cwd, status, approval_mode, profile_id, created_at, updated_at, adopted_at, child_descent)
     VALUES (?, ?, ?, ?, 'ended', NULL, ?, ?, ?, ?, ?)`,
  )
  const touchAdopted = db.prepare(
    `UPDATE provider_session SET updated_at = ?
      WHERE id = ? AND adopted_at IS NOT NULL AND updated_at < ?`,
  )
  const markRestored = db.prepare(`UPDATE provider_session SET restored_at = ? WHERE id = ?`)
  const readAdoptedDescent = db.prepare(
    `SELECT child_descent FROM provider_session WHERE id = ? AND adopted_at IS NOT NULL`,
  )
  const writeAdoptedDescent = db.prepare(
    `UPDATE provider_session SET child_descent = ? WHERE id = ? AND adopted_at IS NOT NULL`,
  )
  const writeApprovalMode = db.prepare(
    `UPDATE provider_session SET approval_mode = ?, updated_at = ? WHERE id = ?`,
  )
  const writePlanEnded = db.prepare(
    `UPDATE provider_session SET plan_ended_at = ?, updated_at = ?
      WHERE id = ? AND plan_mode = 1 AND plan_ended_at IS NULL`,
  )
  const writePlanStarted = db.prepare(
    `UPDATE provider_session SET plan_mode = 1, plan_ended_at = NULL, updated_at = ? WHERE id = ?`,
  )
  const writeModel = db.prepare(
    `UPDATE provider_session SET model = ?, updated_at = ? WHERE id = ?`,
  )
  const writeReasoningEffort = db.prepare(
    `UPDATE provider_session SET reasoning_effort = ?, updated_at = ? WHERE id = ?`,
  )
  const writeSetByAPerson = db.prepare(
    `UPDATE provider_session SET model_or_effort_set_by_a_person_at = ?, updated_at = ? WHERE id = ?`,
  )
  const writeReported = db.prepare(
    `UPDATE provider_session SET reported_model = ?, reported_effort = ? WHERE id = ?`,
  )
  const readWhatItRunsOn = db.prepare(
    `SELECT model, reasoning_effort, model_or_effort_set_by_a_person_at, reported_model, reported_effort
       FROM provider_session WHERE id = ?`,
  )
  const selectByRef = db.prepare(
    `SELECT id FROM provider_session
      WHERE provider = ? AND json_extract(external_ref, '$.sessionId') = ?`,
  )
  let launchStatements:
    | { readonly write: AppStatement; readonly select: AppStatement; readonly name: AppStatement }
    | undefined
  const launchSql = (): NonNullable<typeof launchStatements> =>
    (launchStatements ??= {
      write: db.prepare(`UPDATE provider_session SET launched_as = ? WHERE id = ?`),
      select: db.prepare(`SELECT id FROM provider_session WHERE provider = ? AND launched_as = ?`),
      name: db.prepare(
        `UPDATE provider_session SET external_ref = ?
          WHERE id = ? AND external_ref IS NULL AND launched_as = ?`,
      ),
    })
  const insertEvent = db.prepare(
    `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertTurn = db.prepare(
    `INSERT INTO turn (id, session_id, ordinal, prompt, opened_at, generation)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  /** The open turn, if any. At most one: a second `user_turn` cannot arrive while one is open. */
  const selectOpenTurn = db.prepare(
    `SELECT id, blocked_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  /** The most recent turn whatever its state — what a late content event is attributed to. */
  const selectLastTurn = db.prepare(
    `SELECT id FROM turn WHERE session_id = ? AND generation = ? ORDER BY ordinal DESC LIMIT 1`,
  )
  type HumanPromptRow = EventRow & { turn_id: string | null }
  const latestHumanPrompt = db.prepare(
    `SELECT ordinal, payload, created_at, turn_id FROM events INDEXED BY events_human_prompt_idx
     WHERE session_id = ? AND generation = ? AND (${HUMAN_CONTEXT_TERM}) AND type = 'user_turn'
     ORDER BY ordinal DESC LIMIT 1`,
  )
  const humanBoundary = db.prepare(
    `SELECT ordinal FROM events INDEXED BY events_human_prompt_idx
     WHERE session_id = ? AND generation = ? AND (${HUMAN_CONTEXT_TERM}) AND type = ?
       AND ordinal > ? ORDER BY ordinal LIMIT 1`,
  )
  const turnOpeningForHuman = db.prepare(
    `SELECT ordinal, payload, created_at, turn_id FROM events INDEXED BY events_turn_opening_idx
     WHERE session_id = ? AND generation = ? AND turn_id = ? AND type = 'user_turn'
     ORDER BY ordinal LIMIT 1`,
  )
  const selectedHumanFinal = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_human_final_idx
     WHERE session_id = ? AND generation = ? AND turn_id = ? AND ${HUMAN_FINAL_TERM}
       AND ordinal > ? AND ordinal < ? ORDER BY ordinal DESC LIMIT 1`,
  )
  const finalRowsInHumanWindow = db.prepare(
    `SELECT ordinal, turn_id FROM events INDEXED BY events_session_ordinal_uq
     WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal <= ?
       AND ${HUMAN_FINAL_TERM} ORDER BY ordinal LIMIT 2500`,
  )

  function humanTurnAt(
    sessionId: string,
    generation: number,
    row: HumanPromptRow,
  ): { answer: HumanTurnAnswer; boundedAt: number } | null {
    const opening = toPersistedEvents([row])[0]
    const prompt = opening?.event.type === 'user_turn' ? humanPromptOf(opening.event) : null
    if (prompt === null || row.turn_id === null) return null
    const boundaries = ['reopened', 'status'].map(
      (type) =>
        (
          humanBoundary.get(sessionId, generation, type, row.ordinal) as
            { ordinal: number } | undefined
        )?.ordinal ?? Number.MAX_SAFE_INTEGER,
    )
    const boundedAt = Math.min(...boundaries)
    const final = selectedHumanFinal.get(
      sessionId,
      generation,
      row.turn_id,
      row.ordinal,
      boundedAt,
    ) as EventRow | undefined
    const said = final === undefined ? undefined : toPersistedEvents([final])[0]
    return {
      boundedAt,
      answer: {
        promptOrdinal: row.ordinal,
        prompt,
        final:
          said?.event.type === 'assistant_message'
            ? { text: said.event.text, ordinal: said.ordinal, at: said.at }
            : null,
      },
    }
  }

  const selectLastClosedTurn = db.prepare(
    `SELECT id, opened_at, closed_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectStatus = db.prepare(`SELECT status FROM provider_session WHERE id = ?`)
  const selectProviderOf = db.prepare(`SELECT provider FROM provider_session WHERE id = ?`)
  const selectTurnCount = db.prepare(
    `SELECT COUNT(*) AS n FROM turn WHERE session_id = ? AND generation = ?`,
  )
  const closeTurn = db.prepare(
    `UPDATE turn SET closed_at = ?, end_reason = ?, blocked_at = NULL
      WHERE id = ? AND closed_at IS NULL`,
  )
  const setTurnBlocked = db.prepare(`UPDATE turn SET blocked_at = ? WHERE id = ?`)
  const selectTurns = db.prepare(
    `SELECT id, ordinal, prompt, opened_at, closed_at, end_reason, blocked_at
       FROM turn WHERE session_id = ? AND generation = ? ORDER BY ordinal`,
  )
  const selectOpenTurnId = db.prepare(
    `SELECT id FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const updateRef = db.prepare(
    `UPDATE provider_session SET external_ref = ?, updated_at = ? WHERE id = ?`,
  )
  const updateStatus = db.prepare(
    `UPDATE provider_session SET status = ?, updated_at = ? WHERE id = ?`,
  )
  const stampClosedByTheQuit = db.prepare(
    `UPDATE provider_session SET closed_by_the_quit_at = ? WHERE id = ?`,
  )
  const clearClosedByTheQuit = db.prepare(
    `UPDATE provider_session SET closed_by_the_quit_at = NULL
      WHERE id = ? AND closed_by_the_quit_at IS NOT NULL`,
  )
  const selectClosedByTheNewestQuit = db.prepare(
    `SELECT id, closed_by_the_quit_at AS at FROM provider_session
      WHERE closed_by_the_quit_at = (SELECT max(closed_by_the_quit_at) FROM provider_session)
      ORDER BY id`,
  )
  const selectBackgroundNewestFirst = db.prepare(
    `SELECT type, payload FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND type IN ('background_work', 'launched')
      ORDER BY generation DESC, ordinal DESC LIMIT 200`,
  )
  const selectLastMomentBefore = db.prepare(
    `SELECT max(created_at) AS at FROM events WHERE session_id = ? AND created_at < ?`,
  )
  const selectClosedByTheQuit = db.prepare(
    `SELECT id FROM provider_session WHERE closed_by_the_quit_at IS NOT NULL
      ORDER BY closed_by_the_quit_at, id`,
  )
  const closedByTheQuitTx = db.transaction((sessionIds: readonly string[], at: number): void => {
    for (const id of sessionIds) stampClosedByTheQuit.run(at, id)
  })
  const SESSION_COLUMNS = `provider_session.id AS id, provider, external_ref, cwd, status, approval_mode, profile_id, reasoning_effort, model, plan_mode, plan_ended_at, model_or_effort_set_by_a_person_at, reported_model, reported_effort, adopted_at, restored_at, child_descent, provider_session.created_at AS created_at, provider_session.updated_at AS updated_at`
  const HAS_EVENTS_COLUMN = `EXISTS (SELECT 1 FROM events
                                       WHERE events.session_id = provider_session.id
                                         AND events.generation = coalesce(g.active, 0)) AS has_events`
  const GENERATION_COLUMNS = `${HAS_EVENTS_COLUMN},
            g.normalizer_version AS normalizer_version,
            g.building AS building,
            g.failure AS failure`
  const GENERATION_JOIN = `LEFT JOIN derived_generation g ON g.session_id = provider_session.id`
  const LAST_ENDING_COLUMN = `(SELECT t.end_reason FROM turn t
                                WHERE t.session_id = provider_session.id
                                  AND t.generation = coalesce(g.active, 0)
                                  AND t.closed_at IS NOT NULL
                                ORDER BY t.ordinal DESC LIMIT 1) AS last_end_reason`
  const selectAll = db.prepare(
    `SELECT ${SESSION_COLUMNS}, ${GENERATION_COLUMNS}, ${LAST_ENDING_COLUMN}
       FROM provider_session ${GENERATION_JOIN}
      ORDER BY provider_session.updated_at DESC`,
  )
  // Keep replacement insertion order across generations and require an existing target.
  const selectReplacements = db.prepare(
    `SELECT session_id, payload FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND type = 'replaced_by' AND json_valid(payload)
        AND EXISTS (SELECT 1 FROM provider_session
                     WHERE provider_session.id = json_extract(events.payload, '$.sessionId'))
      ORDER BY events.rowid`,
  )
  const selectNewestScheduleLevels = db.prepare(
    `WITH levels AS MATERIALIZED (
       SELECT session_id, created_at, generation, ordinal, payload
         FROM events INDEXED BY events_kind_owner_idx
        WHERE ${FOLD_TERM} AND type = 'scheduled_work'
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
       FROM candidates n`,
  )
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
  const selectOne = db.prepare(
    `SELECT ${SESSION_COLUMNS}, ${GENERATION_COLUMNS}, ${LAST_ENDING_COLUMN}
       FROM provider_session ${GENERATION_JOIN} WHERE provider_session.id = ?`,
  )
  const selectEvents = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? ORDER BY ordinal`,
  )
  const selectPieceEvents = db.prepare(
    `SELECT ordinal,
            CASE WHEN json_valid(payload) THEN json_remove(payload, '$.sent', '$.given')
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
        AND ordinal >= ?
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

  const countPlacedConversations = db.prepare(
    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NOT NULL`,
  )
  const selectDigestWindow = db.prepare(
    `SELECT e.session_id AS session_id, e.ordinal AS ordinal, e.payload AS payload,
            e.created_at AS created_at
       FROM provider_session s
       JOIN events e ON e.session_id = s.id
      WHERE s.agent_identity_id IS NOT NULL
        AND e.created_at >= ? AND e.created_at < ?
        AND e.generation = coalesce(
              (SELECT d.active FROM derived_generation d WHERE d.session_id = e.session_id), 0)
        AND e.type IN ('work_given', 'work_replied', 'work_taken_back', 'work_closed',
                       'request_routed',
                       'request_escalated', 'request_stranded', 'request_resolved',
                       'request_interrupted',
                       'question_asked', 'user_decision', 'work_interrupted',
                       'work_restarted', 'tool_refused', 'turn',
                       'sub_agent', 'workflow_run',
                       'tool_call', 'tool_result', 'message_unqueued')
      ORDER BY e.created_at, e.session_id, e.ordinal`,
  )
  const selectPlacedConversationIds = db.prepare(
    `SELECT id FROM provider_session WHERE agent_identity_id IS NOT NULL`,
  )
  // Its type list is `DIGEST_EVENT_TYPES` itself, so it cannot drift from the digest's vocabulary.
  const selectDigestRowsAfter = db.prepare(
    `SELECT session_id, ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ordinal <= ?
        AND type IN (${DIGEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
      ORDER BY ordinal`,
  )
  interface KeptDigestRow {
    readonly at: number
    /** `null` for a row too torn to read: counted, never shown. */
    readonly row: DigestRow | null
  }
  const keptDigest = new Map<
    string,
    { generation: number; through: number; rows: KeptDigestRow[] }
  >()
  // The oldest moment the kept rows reach back to; a read reaching further starts afresh.
  let keptDigestFrom: number | null = null
  // The Away page reads every 30 s while it is shown; once it has stopped, the rows are let go.
  const DIGEST_ROWS_KEPT_FOR_MS = 120_000
  let letTheDigestRowsGo: ReturnType<typeof setTimeout> | undefined
  function forgetTheDigestRows(): void {
    keptDigest.clear()
    keptDigestFrom = null
  }
  function keepTheDigestRowsAWhile(): void {
    clearTimeout(letTheDigestRowsGo)
    letTheDigestRowsGo = setTimeout(forgetTheDigestRows, DIGEST_ROWS_KEPT_FOR_MS)
    letTheDigestRowsGo.unref?.()
  }

  function keptDigestRowsOf(rows: DigestEventRow[], from: number): KeptDigestRow[] {
    return rows
      .filter((row) => row.created_at >= from)
      .map((row) => {
        const [entry] = toPersistedEvents([row], () => {})
        return {
          at: row.created_at,
          row:
            entry === undefined
              ? null
              : {
                  sessionId: row.session_id,
                  ordinal: entry.ordinal,
                  at: entry.at,
                  event: entry.event,
                },
        }
      })
  }

  const keptDigestRows = db.transaction((from: number): void => {
    const placed = (selectPlacedConversationIds.all() as { id: string }[]).map((one) => one.id)
    const newestOf = (id: string, generation: number): number =>
      (selectMaxOrdinal.get(id, generation) as { max_ordinal: number | null } | undefined)
        ?.max_ordinal ?? -1
    if (keptDigestFrom === null || from < keptDigestFrom) {
      keptDigest.clear()
      keptDigestFrom = from
      const all = selectDigestWindow.all(from, Number.MAX_SAFE_INTEGER) as DigestEventRow[]
      const bySession = new Map<string, DigestEventRow[]>()
      for (const row of all) {
        const own = bySession.get(row.session_id)
        if (own === undefined) bySession.set(row.session_id, [row])
        else own.push(row)
      }
      for (const id of placed) {
        const generation = activeGeneration(id)
        keptDigest.set(id, {
          generation,
          through: newestOf(id, generation),
          rows: keptDigestRowsOf(bySession.get(id) ?? [], from),
        })
      }
      return
    }
    const stillPlaced = new Set(placed)
    for (const id of [...keptDigest.keys()]) if (!stillPlaced.has(id)) keptDigest.delete(id)
    for (const id of placed) {
      const generation = activeGeneration(id)
      const newest = newestOf(id, generation)
      const kept = keptDigest.get(id)
      if (kept === undefined || kept.generation !== generation) {
        const rows = selectDigestRowsAfter.all(id, generation, -1, newest) as DigestEventRow[]
        keptDigest.set(id, { generation, through: newest, rows: keptDigestRowsOf(rows, from) })
        continue
      }
      if (newest > kept.through) {
        const rows = selectDigestRowsAfter.all(
          id,
          generation,
          kept.through,
          newest,
        ) as DigestEventRow[]
        for (const one of keptDigestRowsOf(rows, from)) kept.rows.push(one)
        kept.through = newest
      }
      const first = kept.rows[0]
      if (first !== undefined && first.at < from)
        kept.rows = kept.rows.filter((one) => one.at >= from)
    }
    keptDigestFrom = from
  })
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
        AND (? IS NULL OR (created_at, id) > (SELECT created_at, id FROM work WHERE id = ?))
      ORDER BY created_at, id LIMIT ?`,
  )
  const selectReconciliationOwners = db.prepare('SELECT DISTINCT owner_session_id AS id FROM work')
  const selectReconciliationOwnerReceipts = db.prepare(`SELECT payload, created_at FROM events
    WHERE type = 'work_reconciliation' AND session_id = ? ORDER BY generation, ordinal`)
  const selectReconciliationReceipts = db.prepare(
    `SELECT payload, created_at FROM events INDEXED BY events_work_piece_idx
      WHERE session_id = ? AND type = 'work_reconciliation'
        AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
      ORDER BY generation, ordinal`,
  )
  const selectUnreadReconciliationReceipt = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_work_piece_idx
      WHERE session_id = ? AND type = 'work_reconciliation'
        AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END IS NULL
      LIMIT 1`,
  )
  const selectReconciliationMessage = db.prepare(
    `SELECT generation, ordinal, payload FROM events
      WHERE session_id = ? AND type IN ('message_queued', 'message_unqueued')
        AND json_valid(payload) AND json_extract(payload, '$.messageId') = ?
      ORDER BY generation DESC, ordinal DESC LIMIT 1`,
  )
  const selectTurnAfterReconciliation = db.prepare(
    `SELECT e.payload, t.id AS turn, t.closed_at FROM events e LEFT JOIN turn t ON t.id = e.turn_id
      WHERE e.session_id = ? AND e.generation = ? AND e.ordinal > ?
        AND e.type IN ('user_turn', 'provider_turn', 'launched', 'reopened')
      ORDER BY e.ordinal LIMIT 1`,
  )
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
  const A_STATUS_THE_FOLD_ACTS_ON = `CASE WHEN type = 'status' THEN
          CASE WHEN json_valid(payload) AND json_type(payload) = 'object'
               THEN json_extract(payload, '$.state') IN ('ended', 'errored')
               ELSE 1 END
          ELSE 1 END`
  const selectRoutedRequestEvents = db.prepare(
    `SELECT ordinal,
            CASE WHEN json_valid(payload) THEN json_remove(payload, '$.sent', '$.given')
                 ELSE payload END AS payload,
            created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
        AND ${A_STATUS_THE_FOLD_ACTS_ON}
        AND (ordinal >= (SELECT min(ordinal) FROM events
                            INDEXED BY events_kind_owner_idx
                          WHERE ${FOLD_TERM} AND session_id = @session
                            AND generation = @generation
                            AND type IN ('request_routed', 'question_asked'))
             OR ordinal = (SELECT max(ordinal) FROM events
                              INDEXED BY events_kind_owner_idx
                            WHERE ${FOLD_TERM} AND session_id = @session
                              AND generation = @generation
                              AND type = 'launched'
                              AND ordinal < (SELECT min(ordinal) FROM events
                                                INDEXED BY events_kind_owner_idx
                                              WHERE ${FOLD_TERM} AND session_id = @session
                                                AND generation = @generation
                                                AND type IN ('request_routed', 'question_asked'))))
      ORDER BY ordinal`,
  )
  // The rows of those types written after a kept fold of them, to carry it forward.
  const selectRoutedRequestEventsAfter = db.prepare(
    `SELECT ordinal, type, json_valid(payload) AS readable,
            CASE WHEN json_valid(payload) THEN json_remove(payload, '$.sent', '$.given')
                 ELSE payload END AS payload,
            created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
        AND ordinal > @after
      ORDER BY ordinal`,
  )
  const selectSessionsThatRouted = db.prepare(
    `SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'`,
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
  const wallLike = (payload: string) => PHRASES.map(() => `${payload} LIKE ?`).join(' OR ')
  const wallTerms = PHRASES.map((one) => `%${one.phrase}%`)
  const selectProviderWalls = phase('prepare-walls', () =>
    db.prepare(
      `SELECT rowid AS row, session_id, ordinal, created_at,
              CASE WHEN ${wallLike('payload')} THEN payload END AS payload
         FROM events
        WHERE type = 'error' AND created_at >= @since
          AND likelihood((created_at, rowid) > (@at, @row), 0.00001)
        ORDER BY created_at, rowid LIMIT ${WALLS_READ_AT_ONCE}`,
    ),
  )
  const selectProviderWallsAtOnce = db.prepare(
    `SELECT rowid AS row, session_id, ordinal, payload, created_at FROM events
      WHERE type = 'error' AND likelihood(created_at >= ?, 0.00001) AND (${wallLike('payload')})`,
  )
  const selectLaunchesOf = db.prepare(
    `SELECT ordinal, created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND type = 'launched' AND session_id = ?`,
  )
  theFoldIndexHolds(selectLaunchesOf)
  function keepTheLaunchesOf(read: WallsRead, session: string, launches: Launch[]): void {
    if (launches.length <= LAUNCHES_KEPT_AT_MOST) {
      read.launches.set(session, launches)
      return
    }
    read.launches.delete(session)
    read.launchesNotKept.add(session)
  }
  function lifeSinceOf(read: WallsRead, row: WallRead): number | null {
    let launches = read.launches.get(row.session_id)
    if (launches === undefined) {
      launches = phase('read-launches', () => selectLaunchesOf.all(row.session_id)) as Launch[]
      keepTheLaunchesOf(read, row.session_id, launches)
    }
    let since: number | null = null
    for (const launch of launches) {
      if (launch.ordinal < row.ordinal && (since === null || launch.created_at > since))
        since = launch.created_at
    }
    return since
  }
  const selectTurnsCompletedSince = db.prepare(
    `SELECT t.session_id, ps.provider AS provider, MAX(t.closed_at) AS at
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.end_reason = 'completed' AND t.closed_at > ?
      GROUP BY ps.provider, t.session_id`,
  )
  const selectTurnsCompletedIn = db.prepare(
    `SELECT t.session_id, ps.provider AS provider, MAX(t.closed_at) AS at
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.rowid > @after AND t.rowid <= @after + ${TURNS_READ_AT_ONCE}
        AND t.end_reason = 'completed'
      GROUP BY ps.provider, t.session_id`,
  )
  const selectNewestTurnRow = db.prepare(`SELECT coalesce(max(rowid), 0) AS last FROM turn`)
  const selectLimitsClearedSince = db.prepare(
    `SELECT e.session_id, ps.provider AS provider,
            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window,
            MAX(e.created_at) AS at
       FROM events e JOIN provider_session ps ON ps.id = e.session_id
      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001) AND json_valid(e.payload)
      GROUP BY ps.provider, e.session_id, window`,
  )
  const accountLifeAt = (at: string) =>
    `(SELECT MAX(json_extract(value, '$.since')) FROM json_each(@sessionLives)
       WHERE json_extract(value, '$.since') <= ${at})`
  const accountTurnsSql = `SELECT t.session_id, ps.provider, MAX(t.closed_at) AS at,
            ${accountLifeAt('t.closed_at')} AS life
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.end_reason = 'completed' AND t.closed_at > @oldest
        AND t.session_id = @sessionId
      GROUP BY ps.provider, t.session_id, life`
  const accountClearsSql = `SELECT e.session_id, ps.provider,
            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window,
            MAX(e.created_at) AS at,
            ${accountLifeAt('e.created_at')} AS life
       FROM events e JOIN provider_session ps ON ps.id = e.session_id
      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > @oldest, 0.00001)
        AND json_valid(e.payload)
        AND e.session_id = @sessionId
      GROUP BY ps.provider, e.session_id, window, life`
  const selectAccountTurnsCompletedOf = db.prepare(accountTurnsSql)
  const selectAccountLimitsClearedOf = db.prepare(accountClearsSql)
  const selectTornLimitClearsSince = db.prepare(
    `SELECT e.session_id AS session_id, e.ordinal AS ordinal, e.rowid AS row,
            e.generation AS generation, e.created_at AS created_at
       FROM events e
      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001) AND NOT json_valid(e.payload)`,
  )
  // A kept clear is the newest of its provider, conversation and window.
  const keepTheNewestClear = (
    clears: Map<string, SessionTakingWork>,
    row: {
      readonly session_id: string
      readonly provider: string
      readonly window: string | null
      readonly at: number
    },
  ) => {
    const clear: SessionTakingWork = {
      session_id: row.session_id,
      provider: row.provider as Provider,
      window: row.window ?? '',
      at: row.at,
    }
    const key = `${clear.provider}\u0000${clear.session_id}\u0000${clear.window}`
    const held = clears.get(key)
    if (held === undefined || clear.at > held.at) clears.set(key, clear)
  }
  const selectLimitClearsFrom = db.prepare(
    `SELECT e.rowid AS row, e.session_id AS session_id, e.ordinal AS ordinal,
            e.generation AS generation, e.created_at AS created_at, ps.provider AS provider,
            json_valid(e.payload) AS readable,
            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window
       FROM events e JOIN provider_session ps ON ps.id = e.session_id
      WHERE e.type = 'provider_limit_clear' AND e.created_at > @since
        AND likelihood((e.created_at, e.rowid) > (@at, @row), 0.00001)
      ORDER BY e.created_at, e.rowid LIMIT ${WALLS_READ_AT_ONCE}`,
  )
  // A clear row taken in: the newest of its provider and window, or a torn one, counted later.
  function takeInAClear(
    read: WallsRead,
    row: TornClear & { row: number; provider: string; readable: number; window: string | null },
  ): void {
    if (row.readable === 1) keepTheNewestClear(read.clears, { ...row, at: row.created_at })
    else read.torn.set(row.row, row)
  }
  function readTheClearsOn(read: WallsRead, until: number): boolean {
    if (read.clearsNext === null) return true
    if (read.stamp === null) {
      for (const row of selectLimitsClearedSince.all(read.since) as {
        session_id: string
        provider: string
        window: string | null
        at: number
      }[])
        keepTheNewestClear(read.clears, row)
      for (const row of selectTornLimitClearsSince.all(read.since) as (TornClear & {
        row: number
      })[])
        read.torn.set(row.row, row)
      read.clearsNext = null
      return true
    }
    while (read.clearsNext !== null) {
      const from = read.clearsNext
      const rows = selectLimitClearsFrom.all({
        since: read.since,
        at: from.at,
        row: from.row,
      }) as Parameters<typeof takeInAClear>[1][]
      for (const row of rows) takeInAClear(read, row)
      const last = rows.at(-1)
      read.clearsNext =
        rows.length < WALLS_READ_AT_ONCE || last === undefined
          ? null
          : { at: last.created_at, row: last.row }
      if (read.clearsNext !== null && performance.now() >= until) return false
    }
    return true
  }
  // The newest completed turn of each provider after `oldest`.
  function completedTurnsSince(read: WallsRead, oldest: number): SessionTakingWork[] {
    const watch = read.stamp === null ? null : wallWatch()
    let rows: { session_id: string; provider: string; at: number }[]
    if (watch === null) {
      rows = selectTurnsCompletedSince.all(oldest) as typeof rows
    } else {
      if (read.stamp !== null) fillTheTurns(read.stamp, watch, Number.POSITIVE_INFINITY)
      rows = watch.turnsSince.all(oldest) as typeof rows
    }
    return rows.map((row) => ({
      session_id: row.session_id,
      provider: row.provider as Provider,
      window: '',
      at: row.at,
    }))
  }
  function fillTheTurns(stamp: WallWatchStamp, watch: WallWatchStatements, until: number): boolean {
    const filledFor = `${String(stamp.revision)}:${String(stamp.dataVersion)}`
    let filled = watch.turnsFilled.get() as {
      filledFor: string | null
      after: number
      last: number
    }
    if (filled.filledFor !== filledFor) {
      watch.emptyTurns.run()
      const last = (selectNewestTurnRow.get() as { last: number }).last
      watch.turnsBegun.run({ for: filledFor, last })
      filled = { filledFor, after: 0, last }
    }
    let after = filled.after
    while (after < filled.last) {
      const from = after
      const rows = phase('fill-turns', () => selectTurnsCompletedIn.all({ after: from })) as {
        session_id: string
        provider: string
        at: number
      }[]
      for (const row of rows) watch.keepTurn.run(row)
      after += TURNS_READ_AT_ONCE
      watch.turnsReadTo.run(after)
      if (after < filled.last && performance.now() >= until) return false
    }
    return true
  }
  const takingWorkSince = (
    walls: readonly ProviderLimitSeen[],
    read: WallsRead,
    noteTorn: (sessionId: string, ordinal: number) => void,
    accountLives: readonly ProviderLimitAccountLife[] | undefined,
    evaluatedAt: number,
  ): ProviderTakingWork[] => {
    const relevant = walls.filter((wall) => wall.resetsAt === null || wall.resetsAt > evaluatedAt)
    if (relevant.length === 0) return []
    const oldest = Math.min(...relevant.map((one) => one.at))
    phase('read-clears', () => readTheClearsOn(read, Number.POSITIVE_INFINITY))
    // The torn clears were read with the clears above; this counts them.
    phase('read-torn-clears', () => {
      for (const torn of read.torn.values()) {
        if (torn.created_at > oldest && torn.generation === activeGeneration(torn.session_id))
          noteTorn(torn.session_id, torn.ordinal)
      }
    })
    const turnRows = (rows: unknown): SessionTakingWork[] =>
      (rows as { session_id: string; provider: Provider; at: number }[]).map((row) => ({
        ...row,
        window: '',
      }))
    const clearRows = (rows: unknown): SessionTakingWork[] =>
      (rows as { session_id: string; provider: Provider; window: string | null; at: number }[]).map(
        (row) => ({ ...row, window: row.window ?? '' }),
      )
    // Read-only connections use one grouped scan; writable ones use the incremental summary.
    let turns = phase('read-completed-turns', () => completedTurnsSince(read, oldest))
    let cleared = [...read.clears.values()].filter((one) => one.at > oldest)
    const accountOf = accountLives === undefined ? undefined : providerLimitAccounts(accountLives)
    if (accountLives !== undefined && accountOf !== undefined) {
      const sessions = new Map<string, ProviderLimitAccountLife[]>()
      for (const life of accountLives) {
        const lives = sessions.get(life.sessionId) ?? []
        lives.push(life)
        sessions.set(life.sessionId, lives)
      }
      for (const [sessionId, lives] of sessions) {
        lives.sort((a, b) => a.since - b.since)
        let previous = accountOf(sessionId, oldest)
        let split = false
        for (const life of lives) {
          if (life.since <= oldest || life.since > evaluatedAt) continue
          if (life.account !== previous) split = true
          previous = life.account
        }
        if (!split) continue
        const input = { oldest, sessionId, sessionLives: JSON.stringify(lives) }
        if (turns.some((row) => row.session_id === sessionId)) {
          const rows = turnRows(selectAccountTurnsCompletedOf.all(input))
          turns = [...turns.filter((row) => row.session_id !== sessionId), ...rows]
        }
        if (cleared.some((row) => row.session_id === sessionId)) {
          const rows = clearRows(selectAccountLimitsClearedOf.all(input))
          cleared = [...cleared.filter((row) => row.session_id !== sessionId), ...rows]
        }
      }
    }
    return [...turns, ...cleared].map(({ session_id, provider, window, at }) => {
      const account = accountOf?.(session_id, at) ?? null
      return { provider, window, at, ...(account === null ? {} : { account }) }
    })
  }

  let wallWatchStatements: WallWatchStatements | undefined
  function wallWatch(): WallWatchStatements | null {
    if (wallWatchStatements !== undefined) {
      if (providerWallsWatched(connection)) return wallWatchStatements
      wallWatchStatements = undefined
      wallsReadOn.delete(connection)
    }
    if (!watchProviderWalls(connection)) return null
    wallWatchStatements = {
      sample: db
        .prepare(
          `SELECT revision, (SELECT data_version FROM pragma_data_version) AS version,
                max(emptied_through,
                    (SELECT coalesce(max(id), 0) FROM temp.provider_wall_added)) AS added,
                emptied_through AS emptiedThrough
           FROM temp.provider_wall_watch WHERE id = 0`,
        )
        .safeIntegers(true),
      added: db.prepare(
        `SELECT a.id AS added, e.rowid AS row, e.type AS type, e.session_id AS session_id,
                e.ordinal AS ordinal, e.generation AS generation, e.created_at AS created_at,
                ps.provider AS provider, json_valid(e.payload) AS readable,
                CASE WHEN e.type = 'error' AND (${wallLike('e.payload')}) THEN e.payload END AS payload,
                CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window
           FROM temp.provider_wall_added a
           JOIN main.events e ON e.rowid = a.event_row
           JOIN main.provider_session ps ON ps.id = e.session_id
          WHERE a.id > ? ORDER BY a.id LIMIT ${WALLS_READ_AT_ONCE}`,
      ),
      emptied: db.prepare(`UPDATE temp.provider_wall_watch SET emptied_through = ? WHERE id = 0`),
      empty: db.prepare(`DELETE FROM temp.provider_wall_added WHERE id <= ?`),
      turnsFilled: db.prepare(
        `SELECT turns_for AS filledFor, turns_after AS after, turns_last AS last
           FROM temp.provider_wall_watch WHERE id = 0`,
      ),
      turnsBegun: db.prepare(
        `UPDATE temp.provider_wall_watch SET turns_for = @for, turns_after = 0, turns_last = @last
          WHERE id = 0`,
      ),
      turnsReadTo: db.prepare(`UPDATE temp.provider_wall_watch SET turns_after = ? WHERE id = 0`),
      emptyTurns: db.prepare(`DELETE FROM temp.provider_wall_turns`),
      keepTurn: db.prepare(
        `INSERT OR REPLACE INTO temp.provider_wall_turns (provider, session_id, at)
         VALUES (@provider, @session_id, max(@at, coalesce(
           (SELECT at FROM temp.provider_wall_turns
             WHERE provider = @provider AND session_id = @session_id), @at)))`,
      ),
      turnsSince: db.prepare(
        `SELECT provider, session_id, at FROM temp.provider_wall_turns WHERE at > ?`,
      ),
    }
    return wallWatchStatements
  }
  // Put in place as the store is made, for the fold watch's reason.
  if (!connection.inTransaction && !db.readonly && db.pragma('query_only', { simple: true }) !== 1)
    wallWatch()
  function sampleTheWatch(watch: WallWatchStatements): {
    stamp: WallWatchStamp
    added: number
    emptiedThrough: number
  } {
    const sampled = watch.sample.get() as {
      revision: bigint
      version: bigint
      added: bigint
      emptiedThrough: bigint
    }
    return {
      stamp: { revision: sampled.revision, dataVersion: sampled.version },
      added: Number(sampled.added),
      emptiedThrough: Number(sampled.emptiedThrough),
    }
  }

  // One error row read as a wall, or as none, or as a row this app could not read.
  function wallReadFrom(row: {
    session_id: string
    ordinal: number
    payload: string
    created_at: number
  }): WallRead {
    const { session_id, ordinal, created_at } = row
    try {
      const event = JSON.parse(row.payload) as { message?: unknown }
      if (typeof event.message !== 'string') throw new Error('an error row with no message')
      return { session_id, ordinal, created_at, said: readProviderLimit(event.message, created_at) }
    } catch (error) {
      console.warn(
        `provider walls: ${session_id} ordinal ${ordinal} could not be read and was ` +
          `skipped (${error instanceof Error ? error.message : String(error)})`,
      )
      return { session_id, ordinal, created_at, said: 'unread' }
    }
  }

  // A walls read from `since` on, not yet read.
  function aWallsRead(since: number, stamp: WallWatchStamp | null, added: number): WallsRead {
    return {
      stamp,
      added,
      since,
      next: { at: since, row: -1 },
      rows: new Map(),
      launches: new Map(),
      launchesNotKept: new Set(),
      clears: new Map(),
      torn: new Map(),
      clearsNext: { at: since, row: -1 },
    }
  }

  // Reads a walls read's next slices until it is whole or `until` passes; true once whole.
  function readOnFrom(read: WallsRead, until: number): boolean {
    while (read.next !== null) {
      const from = read.next
      const rows = selectProviderWalls.all(...wallTerms, {
        since: read.since,
        at: from.at,
        row: from.row,
      }) as {
        row: number
        session_id: string
        ordinal: number
        created_at: number
        payload: string | null
      }[]
      phase('decode-walls', () => {
        for (const row of rows)
          if (row.payload !== null)
            read.rows.set(row.row, wallReadFrom({ ...row, payload: row.payload }))
      })
      const last = rows.at(-1)
      read.next =
        rows.length < WALLS_READ_AT_ONCE || last === undefined
          ? null
          : { at: last.created_at, row: last.row }
      if (read.next !== null && performance.now() >= until) return false
    }
    return true
  }

  function theKeptWallsRead(watch: WallWatchStatements, since: number): WallsRead {
    const sampled = sampleTheWatch(watch)
    const kept = wallsReadOn.get(connection)
    if (
      kept !== undefined &&
      kept.stamp !== null &&
      kept.stamp.revision === sampled.stamp.revision &&
      kept.stamp.dataVersion === sampled.stamp.dataVersion &&
      kept.added >= sampled.emptiedThrough &&
      since >= kept.since
    )
      return kept
    // The rows the watch added so far are read with the rest.
    const read = aWallsRead(since - WALLS_KEPT_BEFORE_MS, sampled.stamp, sampled.added)
    wallsReadOn.set(connection, read)
    return read
  }

  function theWallsRead(since: number): WallsRead {
    const watch = connection.inTransaction ? null : wallWatch()
    if (watch === null) {
      const read = aWallsRead(since, null, 0)
      read.next = null
      const rows = selectProviderWallsAtOnce.all(since, ...wallTerms) as {
        row: number
        session_id: string
        ordinal: number
        payload: string
        created_at: number
      }[]
      phase('decode-walls', () => {
        for (const row of rows) read.rows.set(row.row, wallReadFrom(row))
      })
      return read
    }
    const read = theKeptWallsRead(watch, since)
    readOnFrom(read, Number.POSITIVE_INFINITY)
    readTheQueueOn(read, watch, Number.POSITIVE_INFINITY)
    letTheOldGo(read, since)
    return read
  }

  // Lets go of what a kept read holds from before `since`, less its slack.
  function letTheOldGo(read: WallsRead, since: number): void {
    const floor = since - WALLS_KEPT_BEFORE_MS
    if (floor - read.since <= WALLS_KEPT_BEFORE_MS) return
    for (const [row, wall] of read.rows) if (wall.created_at < floor) read.rows.delete(row)
    for (const [row, torn] of read.torn) if (torn.created_at < floor) read.torn.delete(row)
    read.since = floor
    // A conversation's launches are kept only while a wall of it is.
    const walled = new Set([...read.rows.values()].map((wall) => wall.session_id))
    for (const session of read.launches.keys())
      if (!walled.has(session)) read.launches.delete(session)
    for (const session of read.launchesNotKept)
      if (!walled.has(session)) read.launchesNotKept.delete(session)
  }

  function readTheQueueOn(read: WallsRead, watch: WallWatchStatements, until: number): boolean {
    const sampled = sampleTheWatch(watch)
    while (read.added < sampled.added) {
      const after = read.added
      const rows = phase('read-added', () => watch.added.all(...wallTerms, after)) as AddedWallRow[]
      phase('decode-walls', () => takeInWhatWasAdded(read, rows))
      const last = rows.at(-1)
      read.added =
        rows.length < WALLS_READ_AT_ONCE || last === undefined ? sampled.added : last.added
      if (read.added < sampled.added && performance.now() >= until) return false
    }
    if (sampled.added - sampled.emptiedThrough >= WALL_QUEUE_EMPTIED_FROM) {
      watch.emptied.run(sampled.added)
      watch.empty.run(sampled.added)
    }
    return true
  }

  function readTheWallsAhead(now: number, until: number): boolean {
    if (connection.inTransaction) return false
    const watch = wallWatch()
    if (watch === null) return true
    const read = theKeptWallsRead(watch, now - PROVIDER_WALL_LOOKBACK_MS)
    if (!readOnFrom(read, until)) return false
    if (!readTheQueueOn(read, watch, until)) return false
    letTheOldGo(read, now - PROVIDER_WALL_LOOKBACK_MS)
    for (const wall of read.rows.values()) {
      if (read.launches.has(wall.session_id) || read.launchesNotKept.has(wall.session_id)) continue
      keepTheLaunchesOf(
        read,
        wall.session_id,
        phase('read-launches', () => selectLaunchesOf.all(wall.session_id)) as Launch[],
      )
      if (performance.now() >= until) return false
    }
    if (read.clearsNext !== null && !phase('read-clears', () => readTheClearsOn(read, until)))
      return false
    return read.stamp === null || fillTheTurns(read.stamp, watch, until)
  }

  function takeInWhatWasAdded(read: WallsRead, rows: readonly AddedWallRow[]): void {
    for (const row of rows) {
      if (row.type === 'error') {
        if (row.payload !== null && row.created_at >= read.since)
          read.rows.set(row.row, wallReadFrom({ ...row, payload: row.payload }))
      } else if (row.type === 'launched') {
        // A wall above this launch may have begun in its life.
        for (const wall of read.rows.values())
          if (wall.session_id === row.session_id && wall.ordinal > row.ordinal) delete wall.life
        const launches = read.launches.get(row.session_id)
        if (launches === undefined) continue
        // A launch read with its conversation's may be queued too.
        if (
          !launches.some((one) => one.ordinal === row.ordinal && one.created_at === row.created_at)
        )
          keepTheLaunchesOf(read, row.session_id, [
            ...launches,
            { ordinal: row.ordinal, created_at: row.created_at },
          ])
      } else {
        takeInAClear(read, row)
      }
    }
  }
  const selectQuestionsRaised = db.prepare(
    `SELECT COALESCE(json_extract(payload, '$.id'), json_extract(payload, '$.requestId')) AS id,
            -- The kind of the field the id above was read from.
            CASE WHEN json_extract(payload, '$.id') IS NOT NULL THEN json_type(payload, '$.id')
                 ELSE json_type(payload, '$.requestId') END AS idIs,
            json_type(payload, '$.prompt') AS promptIs,
            json_type(payload, '$.questions') AS questionsIs,
            json_type(payload, '$.piece') AS pieceIs,
            json_type(payload, '$.passedUpFrom') AS passedUpFromIs,
            json_type(payload, '$.context') AS contextIs,
            type AS type,
            json_extract(payload, '$.prompt') AS prompt,
            json_extract(payload, '$.questions') AS questions,
            json_extract(payload, '$.piece') AS piece,
            -- 611 · the two fields a PASSED-UP question carries (HO-088 3.2). SQL NULL for every
            -- row that is not one, which is every row written before 611 and every question an
            -- agent raised itself -- the same absence piece already answers with.
            -- (No backticks in this template literal: it is one, and a backtick ends it.)
            json_extract(payload, '$.passedUpFrom') AS passedUpFrom,
            json_extract(payload, '$.context') AS context,
            json_extract(payload, '$.move') AS move,
            json_extract(payload, '$.action') AS action,
            -- 671 · R18: which rows were torn, and where, so the reader COUNTS them.
            ordinal AS ordinal,
            readable AS readable
       FROM (SELECT ordinal, type, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload
               FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type IN ('user_input_request', 'question_asked'))
      ORDER BY ordinal`,
  )
  // Whether a question row was written after a kept fold of the questions.
  const selectQuestionsRaisedMoved = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND ordinal > @after AND type IN ('user_input_request', 'question_asked')
      LIMIT 1`,
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
  const selectAProviderTurnsOpening = db.prepare(
    `SELECT 1 AS began FROM events WHERE turn_id = ? AND type = 'provider_turn' LIMIT 1`,
  )
  const selectTheTurnsOpening = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE turn_id = ? AND type = 'user_turn'
      ORDER BY ordinal LIMIT 1`,
  )
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
    `SELECT payload, created_at, turn_id, type, ordinal
       FROM (SELECT session_id, generation, ordinal, created_at, turn_id, type,
                    json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload
               FROM events INDEXED BY events_fold_idx WHERE ${FOLD_TERM})
      WHERE session_id = ? AND generation = ? AND readable
        AND (type = 'work_interrupted'
             OR (type = 'user_decision' AND json_extract(payload, '$.outcome') = 'cancel'))
        AND NOT (type = 'user_decision' AND json_type(payload, '$.stopsNothing') IS 'true')
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTornAsksAfter = db.prepare(
    `SELECT ordinal
       FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND ordinal > ?
        AND type IN ('work_interrupted', 'user_decision')
        AND NOT json_valid(payload)`,
  )
  theFoldIndexHolds(selectLastAskToStop)
  theFoldIndexHolds(selectTornAsksAfter)
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

  function strandedMessages(): {
    stranded: { session_id: string; message_id: string; text: string | null; payload: string }[]
    torn: { session_id: string; ordinal: number }[]
  } {
    const stranded: {
      row: number
      session_id: string
      message_id: string
      text: string | null
      payload: string
    }[] = []
    const torn: { row: number; session_id: string; ordinal: number }[] = []
    for (const conversation of selectEveryConversationAndStatus.all() as {
      id: string
      status: string
    }[]) {
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
      const ended = new Set<unknown>()
      let lastTornEnding = -Infinity
      let lastStart = -Infinity
      for (const one of rows) {
        if (one.type === 'launched') lastStart = Math.max(lastStart, one.ordinal)
        else if (one.valid !== 1) {
          torn.push({ row: one.row, session_id: conversation.id, ordinal: one.ordinal })
          if (one.type === 'message_unqueued')
            lastTornEnding = Math.max(lastTornEnding, one.ordinal)
        } else if (one.type === 'message_unqueued') ended.add(one.message_id)
      }
      if (conversation.status === 'ended' || conversation.status === 'errored') continue
      for (const one of rows) {
        if (one.type !== 'message_queued' || one.valid !== 1 || one.message_id === null) continue
        if (one.payload === null) continue
        if (one.for_its_next_start === 1 && lastStart <= one.ordinal) continue
        const origin = moveOriginOf(aStoredObject(one.payload)?.movedFrom)
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
        if (ended.has(one.message_id) || lastTornEnding > one.ordinal) continue
        stranded.push({
          row: one.row,
          session_id: conversation.id,
          message_id: one.message_id as string,
          text: one.text as string | null,
          payload: one.payload,
        })
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
  const selectWorkflowOutput = db.prepare(
    `SELECT run.readable AS readable, run.ordinal AS ordinal,
            json_extract(run.body, '$.outputFile') AS path
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'workflow_run') run
      WHERE NOT run.readable
         OR (json_extract(run.body, '$.taskId') = ?
             AND json_extract(run.body, '$.outputFile') IS NOT NULL)
      ORDER BY run.ordinal DESC`,
  )
  const selectWorkflowAgentTask = db.prepare(
    `SELECT run.readable AS readable, run.ordinal AS ordinal,
            json_extract(run.body, '$.taskId') AS taskId
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'workflow_run') run
       LEFT JOIN json_each(run.body, '$.agents') AS agent
      WHERE NOT run.readable OR json_extract(agent.value, '$.agentId') = ?
      ORDER BY run.ordinal DESC`,
  )
  const selectWorkflowAgentIds = db.prepare(
    `SELECT json_extract(json_each.value, '$.agentId') AS agentId, MIN(run.ordinal) AS seen
       FROM (SELECT ordinal, CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'workflow_run') run,
            json_each(run.body, '$.agents')
      WHERE json_extract(run.body, '$.taskId') = ?
        AND agentId IS NOT NULL
      GROUP BY agentId
      ORDER BY seen`,
  )
  const selectSubAgentReported = db.prepare(
    `SELECT reported.readable AS readable, reported.ordinal AS ordinal
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'sub_agent') reported
      WHERE NOT reported.readable OR json_extract(reported.body, '$.agentId') = ?`,
  )
  const selectTornRuns = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'workflow_run'
        AND NOT json_valid(payload)`,
  )
  const firstReadable = <Row extends { readable: number; ordinal: number }>(
    sessionId: string,
    candidates: Iterable<Row>,
    unread: RowsUnread | undefined,
  ): Row | undefined => {
    for (const row of candidates) {
      if (row.readable) return row
      noteUnreadRow(sessionId, row.ordinal, unread?.in(sessionId))
    }
    return undefined
  }
  const selectEventWindow = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?`,
  )
  const selectNewestLaunched = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'launched'
        AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectThreadLeadRows = db.prepare(
    `SELECT ordinal, type,
            CASE WHEN type = 'launched'
                  AND json_type(payload, '$.given.thisConversation') = 'object'
                 THEN json_extract(payload, '$.given.thisConversation') END AS conversation,
            CASE WHEN type = 'user_turn' THEN json_type(payload, '$.sent') = 'text' END AS handed,
            CASE WHEN type = 'user_turn' AND json_type(payload, '$.sent') = 'text'
                   AND (json_extract(payload, '$.sent') LIKE ? ESCAPE '\\'
                        OR json_extract(payload, '$.sent') LIKE ? ESCAPE '\\')
                 THEN json_extract(payload, '$.sent') END AS sent,
            CASE WHEN type = 'user_turn' AND json_type(payload, '$.lead') = 'object'
                 THEN json_extract(payload, '$.lead') END AS lead,
            CASE WHEN type = 'turn'
                 THEN json_extract(payload, '$.state') = 'failed'
                      AND json_extract(payload, '$.wordOf') = 'this-app' END AS failed
       FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ?
        AND type IN (${THREAD_LEAD_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
        AND (type IN ('compaction', 'conversation_reset') OR json_valid(payload))
      ORDER BY ordinal`,
  )
  const selectNewestOfType = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND type = ? AND ordinal >= ? AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectEventRange = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ? ORDER BY ordinal`,
  )
  const selectTurnStarts = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'user_turn' AND ordinal < ?
      ORDER BY ordinal DESC LIMIT ?`,
  )
  /** The `maxEvents`-th event counting back — the floor the turn boundary is not allowed below. */
  const selectEventFloor = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal < ? ORDER BY ordinal DESC LIMIT 1 OFFSET ?`,
  )
  const selectAnyEventBelow = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events
                     WHERE session_id = ? AND generation = ? AND ordinal < ?) AS present`,
  )
  const selectToolsInForce = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_inventory_idx
      WHERE type = 'tool_inventory' AND session_id = ? AND generation = ? AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectAnyEvent = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?) AS present`,
  )
  const selectMaxOrdinal = db.prepare(
    `SELECT max(ordinal) AS max_ordinal FROM events WHERE session_id = ? AND generation = ?`,
  )

  const selectGeneration = db.prepare(
    `SELECT active, normalizer_version, derived_through, building, highest, failure
       FROM derived_generation WHERE session_id = ?`,
  )
  const startBuilding = db.prepare(
    `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
     VALUES (?, 0, ?, 0, 1, 1, NULL, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       building = highest + 1, highest = highest + 1, failure = NULL, updated_at = excluded.updated_at`,
  )
  /** The flip. `building` is cleared in the same write that makes its generation the active one. */
  const promoteBuilding = db.prepare(
    `UPDATE derived_generation
        SET active = ?, normalizer_version = ?, derived_through = ?, building = NULL, failure = NULL, updated_at = ?
      WHERE session_id = ? AND building = ?`,
  )
  /** Stop building. `failure` null is a cancellation, which is not a fault and is recorded as none. */
  const stopBuilding = db.prepare(
    `UPDATE derived_generation SET building = NULL, failure = ?, updated_at = ?
      WHERE session_id = ? AND building = ?`,
  )
  const clearBuilding = db.prepare(
    `UPDATE derived_generation SET building = NULL, updated_at = ? WHERE building IS NOT NULL
       AND session_id = ?`,
  )
  const selectBuildingSessions = db.prepare(
    `SELECT session_id FROM derived_generation WHERE building IS NOT NULL`,
  )
  const clearOrphanBuildsTx = db.transaction((at: number, running: ReadonlySet<string>): number => {
    const rows = selectBuildingSessions.all() as { session_id: string }[]
    let cleared = 0
    for (const row of rows) {
      if (running.has(row.session_id)) continue
      cleared += clearBuilding.run(at, row.session_id).changes
    }
    return cleared
  })
  const deleteEventGeneration = db.prepare(
    `DELETE FROM events WHERE rowid IN
       (SELECT rowid FROM events WHERE session_id = ? AND generation = ? LIMIT ?)`,
  )
  const generationHoldsRowsReadInEvery = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?
                       AND type IN ('instruction_proposed', 'instruction_settled'))
         OR EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?
                       AND type IN ('mcp_server_requested', 'mcp_server_request_settled')) AS holds`,
  )
  const deleteTurnGeneration = db.prepare(
    `DELETE FROM turn WHERE rowid IN
       (SELECT rowid FROM turn WHERE session_id = ? AND generation = ? LIMIT ?)`,
  )
  const writeGeneration = db.prepare(
    `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
     VALUES (?, 0, ?, ?, NULL, 0, NULL, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       normalizer_version = excluded.normalizer_version,
       derived_through = excluded.derived_through, building = NULL, failure = NULL,
       updated_at = excluded.updated_at`,
  )

  const appendTx = db.transaction(
    (
      sessionId: string,
      ordinal: number,
      incoming: TranscriptEvent,
      at: number,
      generation: number,
      reconcileStatus: boolean,
    ) => {
      const event = boundStoredEvent(incoming)
      if (A_FOLD_READS_IT.has(event.type)) forgetTheKeptFoldsOf(sessionId, ordinal)
      if (event.type === 'reopened') {
        const left = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
        if (left) closeTurn.run(at, 'unknown', left.id)
      }
      const already = (
        event.type === 'user_turn' || event.type === 'provider_turn'
          ? selectOpenTurn.get(sessionId, generation)
          : undefined
      ) as OpenTurnRow | undefined
      const joinsTheProvidersTurn =
        event.type === 'user_turn' &&
        already !== undefined &&
        selectAProviderTurnsOpening.get(already.id) !== undefined &&
        selectTheTurnsOpening.get(already.id) === undefined
      if (
        (event.type === 'user_turn' || event.type === 'provider_turn') &&
        !joinsTheProvidersTurn
      ) {
        if (already) closeTurn.run(at, 'unknown', already.id)
        const nth = (selectTurnCount.get(sessionId, generation) as { n: number }).n
        const prompt = event.type === 'user_turn' ? event.text : ''
        insertTurn.run(newTurnId(), sessionId, nth, prompt, at, generation)
      }

      const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
      ownFoldWrite = A_FOLD_READS_IT.has(event.type)
        ? { session: sessionId, generation, ordinal }
        : null
      insertEvent.run(
        newEventId(),
        sessionId,
        ordinal,
        event.type,
        JSON.stringify(event),
        at,
        turnFor(sessionId, event, open, generation),
        generation,
      )
      // A rolled-back write still invalidates a live allocator; it never publishes a floor.
      ledgerWrites.set(sessionId, { ordinal, generation })
      committed.appended(committedRowOf(sessionId, generation, ordinal, event))

      if (event.type === 'session' || event.type === 'conversation_reset') {
        updateRef.run(serializeSessionRef(event.ref), at, sessionId)
      }

      if (event.type === 'turn' && open) closeTurn.run(at, event.state, open.id)
      if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
        if (open) closeTurn.run(at, 'ended', open.id)
      }
      if (event.type === 'status' && open) {
        if (event.state === 'waiting_permission') setTurnBlocked.run(at, open.id)
        if (event.state === 'working') setTurnBlocked.run(null, open.id)
      }

      if (reconcileStatus)
        updateStatus.run(currentStatus(sessionId, event, generation), at, sessionId)
    },
  )

  const appendManyTx = db.transaction(
    (
      sessionId: string,
      entries: { ordinal: number; event: TranscriptEvent; at: number }[],
      generation: number,
      reconcileStatus: boolean,
    ) => {
      for (const entry of entries) {
        appendTx(sessionId, entry.ordinal, entry.event, entry.at, generation, reconcileStatus)
      }
    },
  )

  const CONTENT_EVENTS = new Set([
    'assistant_message',
    'assistant_delta',
    'tool_call',
    'tool_result',
    'thinking',
    'sub_agent',
    'plan_update',
    'image',
    'file_change',
    'memory_note',
  ])

  function turnFor(
    sessionId: string,
    event: TranscriptEvent,
    open: OpenTurnRow | undefined,
    generation: number,
  ): string | null {
    if (open) return open.id
    if (!CONTENT_EVENTS.has(event.type)) return null
    const last = selectLastTurn.get(sessionId, generation) as { id: string } | undefined
    return last?.id ?? null
  }

  function activeGeneration(sessionId: string): number {
    return (selectGeneration.get(sessionId) as GenerationRow | undefined)?.active ?? 0
  }

  /** One ledger's kept fold: the generation and newest fold row it was read at, and its answer. */
  interface KeptFold<T> {
    readonly generation: number
    readonly newest: number | null
    readonly answer: T
  }
  type CarriedForward<T> = (
    sessionId: string,
    generation: number,
    after: number,
    held: T,
  ) => T | null
  /** The requests one ledger routed, with what carries its fold forward. */
  interface RoutedRequestsKept {
    readonly answer: readonly RoutedRequest[]
    /** The first routing or question this app asked: the fold reads the ledger from there on. */
    readonly floor: number | null
    readonly entries: readonly PersistedEvent[] | null
  }
  // How many rows a routed fold keeps to be carried forward; a ledger with more is folded whole.
  const ROUTED_ENTRIES_KEPT_AT_MOST = 1024

  let ownFoldWrite: { session: string; generation: number; ordinal: number } | null = null
  let foldsWatched: 'not-yet' | 'yes' | 'never' = 'not-yet'
  let foldsSeenAt: unknown = null
  const selectDataVersion = db.prepare(`SELECT data_version AS version FROM pragma_data_version`)
  // Another connection's commits, and how many of this store's fold triggers are still on `events`.
  const selectWhatTheFoldsKnow = db.prepare(
    `SELECT data_version AS version,
            (SELECT count(*) FROM sqlite_temp_master
              WHERE type = 'trigger' AND tbl_name = 'events' AND name IN (?, ?, ?)) AS watching
       FROM pragma_data_version`,
  )
  function aFoldRowWasWritten(
    session: unknown,
    generation: unknown,
    ordinal: unknown,
    inserted: boolean,
  ): void {
    try {
      const own = ownFoldWrite
      ownFoldWrite = null
      if (
        inserted &&
        own !== null &&
        own.session === session &&
        own.generation === generation &&
        own.ordinal === ordinal
      )
        return
      if (typeof session !== 'string') return
      forgetTheKeptFoldsOf(session)
      namedByAPiece.delete(session)
      pieceFoldFloors.delete(session)
    } catch {
      // A store whose making failed keeps nothing.
    }
  }
  function theFoldsMayBeKept(): boolean {
    if (oneSnapshot) return true
    if (db.inTransaction) return false
    if (!watchTheFolds()) return false
    const known = selectWhatTheFoldsKnow.get(...foldWatchTriggers(aFoldRowWasWritten)) as {
      version: number
      watching: number
    }
    if (known.watching !== 3) {
      // Something took the watch away: nothing kept by it is trusted, and it is put back.
      forgetEveryFold()
      foldsWatched = 'not-yet'
      return watchTheFolds()
    }
    if (known.version !== foldsSeenAt) {
      forgetEveryFold()
      foldsSeenAt = known.version
    }
    return true
  }
  function forgetEveryFold(): void {
    for (const kept of keptFolds) kept.clear()
    namedByAPiece.clear()
    pieceFoldFloors.clear()
  }
  function watchTheFolds(): boolean {
    if (foldsWatched !== 'not-yet' || db.inTransaction) return foldsWatched === 'yes'
    if (db.readonly || db.pragma('query_only', { simple: true }) === 1) {
      foldsWatched = 'never'
      return false
    }
    if (!watchFoldWrites(connection, aFoldRowWasWritten)) return false
    foldsWatched = 'yes'
    foldsSeenAt = (selectDataVersion.get() as { version: number }).version
    return true
  }
  watchTheFolds()

  // The newest row a fold can read: the folds below read only the fold types, through their index.
  const selectNewestFoldRow = db.prepare(
    `SELECT max(ordinal) AS through FROM events
        INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?`,
  )
  theFoldIndexHolds(selectNewestFoldRow)

  function keptUntilItsLedgerGrows<T>(
    fold: (sessionId: string, noteSkip?: SkipNote) => T,
    carriedForward?: CarriedForward<T>,
  ): (sessionId: string, noteSkip?: SkipNote) => T {
    const folded = new Map<string, KeptFold<T>>()
    keptFolds.push(folded)
    const keep = (sessionId: string, kept: KeptFold<T>): void => {
      // Most recently used last, so the cap drops the conversation unread longest.
      folded.delete(sessionId)
      folded.set(sessionId, kept)
      if (folded.size > KEPT_FOLDS_AT_MOST) {
        const oldest = folded.keys().next().value
        if (oldest !== undefined) folded.delete(oldest)
      }
    }
    // The same answer, only where it is kept and still current: this read never makes the fold.
    onlyIfKept.set(fold, (sessionId) => {
      if (!theFoldsMayBeKept()) return null
      const generation = activeGeneration(sessionId)
      const newest =
        (selectNewestFoldRow.get(sessionId, generation) as { through: number | null } | undefined)
          ?.through ?? null
      const held = folded.get(sessionId)
      return held?.generation === generation && held.newest === newest
        ? { answer: held.answer }
        : null
    })
    return (sessionId, noteSkip) => {
      if (!theFoldsMayBeKept()) return fold(sessionId, noteSkip)
      const generation = activeGeneration(sessionId)
      const newest =
        (selectNewestFoldRow.get(sessionId, generation) as { through: number | null } | undefined)
          ?.through ?? null
      const held = folded.get(sessionId)
      if (held?.generation === generation) {
        if (held.newest === newest) {
          keep(sessionId, held)
          return held.answer
        }
        if (carriedForward !== undefined && newest !== null && newest > (held.newest ?? -1)) {
          const answer = carriedForward(sessionId, generation, held.newest ?? -1, held.answer)
          if (answer !== null) {
            keep(sessionId, { generation, newest, answer })
            return answer
          }
          folded.delete(sessionId)
        }
      }
      if (noteSkip === undefined) return fold(sessionId)
      let readEveryRow = true
      const answer = fold(sessionId, (ordinal, cause) => {
        readEveryRow = false
        noteSkip(ordinal, cause)
      })
      if (readEveryRow && (oneSnapshot || !db.inTransaction))
        keep(sessionId, { generation, newest, answer })
      return answer
    }
  }

  const keptFolds: Map<string, KeptFold<unknown>>[] = []
  // Each kept fold's read that answers only from what is kept ({@link theKeptOnly}).
  const onlyIfKept = new Map<unknown, (sessionId: string) => { readonly answer: unknown } | null>()
  function theKeptOnly<T>(
    fold: (sessionId: string, noteSkip?: SkipNote) => T,
  ): (sessionId: string) => T | null {
    return (sessionId) => {
      const kept = onlyIfKept.get(fold)?.(sessionId) ?? null
      return kept === null ? null : (kept.answer as T)
    }
  }
  // The event types a ledger fold reads: a write of one forgets that conversation's kept folds.
  const A_FOLD_READS_IT: ReadonlySet<string> = new Set(FOLD_EVENT_TYPES)
  const KEPT_FOLDS_AT_MOST = 2000
  /** Forgets one conversation's kept folds: all of them, or those a row written at `ordinal` is below. */
  function forgetTheKeptFoldsOf(sessionId: string, ordinal?: number): void {
    for (const kept of keptFolds) {
      const newest = kept.get(sessionId)?.newest
      if (newest === undefined) continue
      if (ordinal === undefined || (newest !== null && ordinal <= newest)) kept.delete(sessionId)
    }
  }

  const selectLegacyStallCut = db.prepare(
    'SELECT generation, through_ordinal FROM work_legacy_stall_cut WHERE session_id = ?',
  )
  const pieceStallOrdinals = new WeakMap<readonly PieceRow[], ReadonlyMap<string, number>>()
  const piecesOfSession = keptUntilItsLedgerGrows(foldPiecesOfSession)
  const turnBlockPiecesOfSession = keptUntilItsLedgerGrows((owner, noteSkip) =>
    foldPiecesOfSession(owner, noteSkip, true),
  )
  const stallsToldToSession = keptUntilItsLedgerGrows(
    foldStallsToldToSession,
    (session, generation, after, held) =>
      selectStallsToldMoved.get({ session, generation, after }) === undefined ? held : null,
  )
  const routedRequestsKept = keptUntilItsLedgerGrows(
    foldRoutedRequestsOfSession,
    carryTheRoutedRequestsForward,
  )
  const routedRequestsOfSession = (sessionId: string, noteSkip?: SkipNote) =>
    routedRequestsKept(sessionId, noteSkip).answer
  const questionsRaisedInSession = keptUntilItsLedgerGrows(
    foldQuestionsRaisedInSession,
    (session, generation, after, held) =>
      selectQuestionsRaisedMoved.get({ session, generation, after }) === undefined ? held : null,
  )
  const piecesAtHand = theKeptOnly(foldPiecesOfSession)
  const routedRequestsKeptOnly = theKeptOnly(foldRoutedRequestsOfSession)
  const routedRequestsAtHand = (sessionId: string) =>
    routedRequestsKeptOnly(sessionId)?.answer ?? null
  const questionsRaisedAtHand = theKeptOnly(foldQuestionsRaisedInSession)

  function foldPiecesOfSession(
    owner: string,
    noteSkip?: SkipNote,
    trackChanges = false,
    before?: number,
  ): readonly PieceRow[] {
    const generation = activeGeneration(owner)
    const provider = (selectProviderOf.get(owner) as { provider: string } | undefined)?.provider
    const backgroundWakesIt =
      provider !== undefined &&
      (SUPPORTED_PROVIDERS as readonly string[]).includes(provider) &&
      isAvailable(capabilitiesFor(provider as Provider).backgroundWake)
    let complete = true
    const skipped: SkipNote = (ordinal) => {
      complete = false
      noteSkip?.(ordinal)
    }
    return readOrSkip(owner, skipped, [], () => {
      const floor = pieceFoldFloor(owner, generation, backgroundWakesIt)
      if (floor === null) return []
      const rows = selectPieceEvents.iterate(owner, generation, floor) as Iterable<EventRow>
      function* beforeTheBound() {
        for (const row of rows) {
          if (before === undefined || row.ordinal < before) yield row
        }
      }
      const stalled = new Map<string, number>()
      const pieces = derivePieces(owner, persistedEventsFrom(beforeTheBound(), skipped), {
        ...(checkFoldState === undefined
          ? {}
          : { checkState: (state, complete) => checkFoldState([...state, stalled], complete) }),
        backgroundWakesIt,
        trackChanges,
        onStall: (piece, ordinal) => stalled.set(piece, ordinal),
        ...(provider !== undefined && (SUPPORTED_PROVIDERS as readonly string[]).includes(provider)
          ? { provider: provider as Provider }
          : {}),
      })
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

  const pieceFoldFloors = new Map<string, { readonly generation: number; readonly floor: number }>()

  const namedByAPiece = new Map<
    string,
    {
      readonly generation: number
      readonly through: number | null
      readonly pieces: readonly PieceForAName[]
      readonly waiting: PieceRow | null
    }
  >()

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
      payload.definitionOfDone.length > 512 ||
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

  function foldRoutedRequestsOfSession(sessionId: string, noteSkip?: SkipNote): RoutedRequestsKept {
    const generation = activeGeneration(sessionId)
    return readOrSkip(sessionId, noteSkip, { answer: [], floor: null, entries: [] }, () => {
      let floor: number | null = null
      let actedOn: PersistedEvent[] | null = []
      function* entries() {
        const rows = selectRoutedRequestEvents.iterate({
          session: sessionId,
          generation,
        }) as Iterable<EventRow>
        for (const entry of persistedEventsFrom(rows, noteSkip)) {
          if (entry.event.type === 'request_routed' || entry.event.type === 'question_asked')
            floor = floor === null ? entry.ordinal : Math.min(floor, entry.ordinal)
          if (actedOn !== null && aWaitIsReadFrom(entry.event)) {
            actedOn.push(entry)
            if (actedOn.length > ROUTED_ENTRIES_KEPT_AT_MOST) actedOn = null
          }
          yield entry
        }
      }
      const answer = deriveRoutedRequests(
        sessionId,
        entries(),
        (ordinal) => noteUnreadRow(sessionId, ordinal, noteSkip, 'is not a well-formed routing'),
        checkFoldState === undefined
          ? undefined
          : (state, complete) => checkFoldState([...state, actedOn], complete),
      )
      return {
        answer,
        floor,
        entries: actedOn,
      }
    })
  }

  function carryTheRoutedRequestsForward(
    sessionId: string,
    generation: number,
    after: number,
    held: RoutedRequestsKept,
  ): RoutedRequestsKept | null {
    const rows = selectRoutedRequestEventsAfter.all({
      session: sessionId,
      generation,
      after,
    }) as (EventRow & { readonly type: string; readonly readable: number })[]
    // A row the whole fold would count as unread, or a first routing, is the whole fold's to read.
    if (rows.some((row) => row.readable !== 1)) return null
    if (held.floor === null) {
      return rows.some((row) => row.type === 'request_routed' || row.type === 'question_asked')
        ? null
        : held
    }
    let skipped = false
    const added = toPersistedEvents(rows, () => {
      skipped = true
    }).filter((entry) => aWaitIsReadFrom(entry.event))
    if (skipped) return null
    if (added.length === 0) return held
    if (held.entries === null) return null
    const entries = [...held.entries, ...added]
    if (entries.length > ROUTED_ENTRIES_KEPT_AT_MOST) return null
    let wellFormed = true
    try {
      const answer = deriveRoutedRequests(sessionId, entries, () => {
        wellFormed = false
      })
      return wellFormed ? { answer, floor: held.floor, entries } : null
    } catch {
      return null
    }
  }

  function foldQuestionsRaisedInSession(
    sessionId: string,
    noteSkip?: SkipNote,
  ): ReadonlyMap<string, RaisedQuestion> {
    const rows = selectQuestionsRaised.all(
      sessionId,
      activeGeneration(sessionId),
    ) as RaisedQuestionRow[]
    return readOrSkip(sessionId, noteSkip, new Map<string, RaisedQuestion>(), () =>
      wordsIn(sessionId, rows, noteSkip),
    )
  }

  function aQuestionRaisedIn(row: RaisedQuestionRow): RaisedQuestion | null {
    const aTextOrAbsent = (is: string | null): boolean =>
      is === null || is === 'null' || is === 'text'
    if (row.id === null || row.prompt === null || row.questions === null) return null
    if (row.idIs !== 'text' || row.promptIs !== 'text' || row.questionsIs !== 'array') return null
    if (![row.pieceIs, row.passedUpFromIs, row.contextIs].every(aTextOrAbsent)) return null
    try {
      const questions = storedQuestionsParsed(JSON.parse(row.questions))
      const fromThisApp = row.type === 'question_asked'
      const move = fromThisApp && row.move !== null ? moveOfferOf(JSON.parse(row.move)) : undefined
      if (fromThisApp && row.move !== null && move === undefined) return null
      const action: unknown = fromThisApp && row.action !== null ? JSON.parse(row.action) : null
      if (fromThisApp && row.action !== null && !anActionAsked(action)) return null
      return {
        prompt: row.prompt,
        questions,
        piece: row.piece,
        passedUpFrom: row.passedUpFrom,
        context: row.context,
        raisedBy: row.type === 'question_asked' ? 'this-app' : 'the-provider',
        ...(move === undefined ? {} : { move }),
        ...(anActionAsked(action) ? { action: { files: action.files } } : {}),
      }
    } catch {
      return null
    }
  }

  function wordsIn(
    sessionId: string,
    rows: readonly RaisedQuestionRow[],
    noteSkip: SkipNote | undefined,
  ): ReadonlyMap<string, RaisedQuestion> {
    const words = new Map<string, RaisedQuestion>()
    for (const row of rows) {
      if (row.readable === 0) {
        noteUnreadRow(sessionId, row.ordinal, noteSkip)
        continue
      }
      const question = aQuestionRaisedIn(row)
      if (question === null || row.id === null) {
        noteUnreadRow(sessionId, row.ordinal, noteSkip, 'is not a well-formed question')
        continue
      }
      words.set(row.id, question)
    }
    return words
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
  ): WhatAConversationIsWaitingOn {
    const mine = unread?.in(sessionId)
    const routings = routedRequestsOfSession(sessionId, mine)
    const raised = questionsRaisedInSession(sessionId, mine)
    return {
      answers: new Set(openQuestionsByWork(routings, raised).keys()),
      aPerson: aPersonOwesAnAnswerIn(routings),
      childrenOpen: new Set(
        piecesGivenBySession(sessionId, unread)
          .filter((piece) => TASK_IS_OPEN[piece.state])
          .map((piece) => piece.parent),
      ),
    }
  }

  function oneWaitReadPerHolder(
    unread: RowsUnread,
  ): (holder: string) => WhatAConversationIsWaitingOn {
    const held = new Map<string, WhatAConversationIsWaitingOn>()
    return (holder) => {
      const mine = held.get(holder)
      if (mine !== undefined) return mine
      const outstanding = whatThisConversationIsWaitingOn(holder, unread)
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

  function whatOpenedTheLastEndedTurn(sessionId: string): ReceivedInATurn | null {
    const closed = selectLastClosedTurn.get(sessionId, activeGeneration(sessionId)) as
      ClosedTurnRow | undefined
    if (closed === undefined) return null
    const row = selectTheTurnsOpening.get(closed.id) as ExchangeRow | undefined
    return row === undefined ? null : receivedOn(sessionId, row, PREVIEW_CAP)
  }

  function replyQuestionWithoutARequest(conversation: string): string | null {
    const closed = selectLastClosedTurn.get(conversation, activeGeneration(conversation)) as
      ClosedTurnRow | undefined
    if (
      closed === undefined ||
      (selectClosedTurnReason.get(closed.id) as { end_reason: string }).end_reason !== 'completed'
    )
      return null
    const opening = selectTheTurnsOpening.get(closed.id) as ExchangeRow | undefined
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

  function wordsOf(sessionId: string, row: ExchangeRow): Words {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { unreadable: true }
    }
    // ⚠️ Cast to `unknown`-shaped and CHECKED — a ledger written by another build can hold anything.
    const said = JSON.parse(row.payload) as { text?: unknown }
    return capped(typeof said.text === 'string' ? said.text : '', WORDS_CAP)
  }

  function receivedOn(sessionId: string, row: ExchangeRow, cap = WORDS_CAP): ReceivedInATurn {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { from: { is: 'unreadable' }, words: { unreadable: true } }
    }
    return whatATurnDelivered(JSON.parse(row.payload) as UserTurnEvent, cap)
  }

  function lastExchangeIn(sessionId: string): Exchange {
    const generation = activeGeneration(sessionId)
    const got = selectNewestReceived.get(sessionId, generation) as ExchangeRow | undefined
    if (got === undefined) return { received: null, answer: null }
    const back = selectNewestAnswerAfter.get(sessionId, generation, got.ordinal) as
      ExchangeRow | undefined
    const sinceThen = selectAProviderTurnAfter.get(sessionId, generation, got.ordinal) !== undefined
    return {
      received: receivedOn(sessionId, got),
      answer: back === undefined ? null : wordsOf(sessionId, back),
      ...(sinceThen ? { sinceThenItsProviderStartedATurn: true as const } : {}),
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

  function actorOfTheAsk(row: AskRow): Pick<AskToStop, 'by' | 'asker'> | null {
    const asked = JSON.parse(row.payload) as { by?: unknown; agent?: unknown }
    if (row.type === 'user_decision') return whoCancelledIt(asked.by as ActedBy | undefined)
    if (!(WHO_STOPPED_IT as readonly unknown[]).includes(asked.by)) return null
    const by = asked.by as WhoStoppedIt
    return {
      by,
      asker: by === 'an-agent' && typeof asked.agent === 'string' ? asked.agent : null,
    }
  }

  function lastAskToStopOf(sessionId: string, noteSkip?: SkipNote): AskToStop | null {
    const generation = activeGeneration(sessionId)
    const row = selectLastAskToStop.get(sessionId, generation) as AskRow | undefined
    for (const torn of selectTornAsksAfter.all(sessionId, generation, row?.ordinal ?? -1) as {
      ordinal: number
    }[]) {
      noteUnreadRow(sessionId, torn.ordinal, noteSkip)
    }
    if (row === undefined) return null
    const asked = readOrSkip(sessionId, noteSkip, null, () => actorOfTheAsk(row))
    if (asked === null) return null
    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    const turn: WhereAnAskLanded =
      row.turn_id === null
        ? 'no-turn-was-running'
        : row.turn_id === closed?.id
          ? 'the-turn-that-ended-last'
          : row.turn_id === open?.id
            ? 'a-turn-that-is-running-now'
            : 'a-turn-that-ended-earlier'
    return { by: asked.by, asker: asked.asker, at: row.created_at, turn }
  }

  function currentStatus(
    sessionId: string,
    event: TranscriptEvent | null,
    generation: number,
  ): SessionStatus {
    if (event?.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      return event.state
    }
    const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
    if (row?.status === 'ended' || row?.status === 'errored') return row.status
    const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    if (!open) return 'idle'
    return open.blocked_at === null ? 'working' : 'waiting_permission'
  }

  const settleTx = db.transaction(
    (
      sessionId: string,
      reason: TurnEndReason,
      at: number,
      terminal: 'ended' | 'errored' | null,
    ): boolean => {
      const open = selectOpenTurnId.get(sessionId, activeGeneration(sessionId)) as
        { id: string } | undefined
      if (open) closeTurn.run(at, reason, open.id)
      const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
      if (row && row.status !== 'ended' && row.status !== 'errored') {
        updateStatus.run(terminal ?? 'idle', at, sessionId)
      }
      return open !== undefined
    },
  )

  const reopenTx = db.transaction((sessionId: string, at: number): boolean => {
    clearClosedByTheQuit.run(sessionId)
    const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
    if (row?.status !== 'ended' && row?.status !== 'errored') return false
    updateStatus.run('idle', at, sessionId)
    return true
  })

  const selectRunningSessions = db.prepare(
    `SELECT id FROM provider_session WHERE status IN ('working', 'waiting_permission')`,
  )

  const selectOwnersOfGivenPieces = db.prepare(
    `SELECT DISTINCT owner_session_id AS id FROM work WHERE parent_id IS NOT NULL`,
  )
  /** Every conversation with no parent that owns no root: only a service's birth makes one. */
  const selectServicesBorn = db.prepare(
    `SELECT s.id AS id, s.agent_identity_id AS identity FROM provider_session AS s
      WHERE s.parent_session_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM work AS w WHERE w.owner_session_id = s.id AND w.parent_id IS NULL
        )`,
  )
  // Worker birth is always the first row of the first life, so this is a constant index probe.
  const selectWorkerBirths = db.prepare(
    `SELECT s.id, s.agent_identity_id AS identity, a.created_at AS identityCreatedAt,
            substr(e.payload, 1, 4097) AS payload, length(e.payload) AS characters
       FROM (SELECT id, agent_identity_id FROM provider_session INDEXED BY provider_session_parent_identity_idx
             WHERE parent_session_id IS NOT NULL LIMIT 8193) AS s
       CROSS JOIN events AS e INDEXED BY events_session_ordinal_uq
         ON e.session_id = s.id AND e.generation = 0 AND e.ordinal = 0
       LEFT JOIN agent_identity AS a ON a.id = s.agent_identity_id
       WHERE e.type = 'worker_registered'
       ORDER BY s.id LIMIT 8193`,
  )
  const workerCandidateCount = db.prepare(
    `SELECT count(*) AS total FROM (SELECT 1 FROM provider_session INDEXED BY provider_session_parent_identity_idx
       WHERE parent_session_id IS NOT NULL LIMIT 8193)`,
  )
  const workerGiverReplacements = db.prepare(
    `SELECT substr(payload, 1, 4097) AS payload, length(payload) AS characters
       FROM events INDEXED BY events_kind_owner_idx WHERE ${FOLD_TERM}
         AND session_id = ? AND type = 'replaced_by'
       ORDER BY generation DESC, ordinal DESC LIMIT 2`,
  )
  function workerReplacementChain(first: string): readonly string[] {
    if (selectOne.get(first) === undefined) throw new Error('worker replacement record is missing')
    const seen = new Set<string>()
    const chain: string[] = []
    let current = first
    for (let hops = 0; hops < 64; hops += 1) {
      if (seen.has(current)) throw new Error('worker replacement lineage is cyclic')
      seen.add(current)
      chain.push(current)
      const rows = workerGiverReplacements.all(current) as { payload: string; characters: number }[]
      if (rows.length === 0) return chain
      const next = rows.map((row) => {
        if (row.characters > 4096) throw new Error('worker replacement is too large')
        const event = aStoredObject(row.payload)
        if (event?.type !== 'replaced_by' || !isAStoredId(event.sessionId)) {
          throw new Error('worker replacement is unreadable')
        }
        return event.sessionId
      })
      if (next.length !== 1) throw new Error('worker replacement is ambiguous')
      current = next[0]!
      if (selectOne.get(current) === undefined)
        throw new Error('worker replacement target is missing')
    }
    throw new Error('worker replacement lineage is too deep')
  }
  function workerGiverContains(giver: string, conversation: string): boolean {
    return workerReplacementChain(giver).includes(conversation)
  }
  function workerInItsPlace(conversation: string): string {
    return workerReplacementChain(conversation).at(-1)!
  }
  const workerLedgerBudget = db.prepare(
    `SELECT count(*) AS rows, coalesce(sum(length(CAST(payload AS BLOB))), 0) AS bytes
       FROM (SELECT payload FROM events INDEXED BY events_session_ordinal_uq
         WHERE session_id = ? AND generation = ? ORDER BY ordinal LIMIT 8193)`,
  )
  const workerLedgerRead = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_session_ordinal_uq
       WHERE session_id = ? AND generation = ? ORDER BY ordinal LIMIT 8193`,
  )
  function workerLedger(
    conversation: string,
    left?: { rowsLeft: number; bytesLeft: number },
  ): readonly PersistedEvent[] | null {
    if (left !== undefined && (left.rowsLeft <= 0 || left.bytesLeft <= 0)) return null
    if (selectOne.get(conversation) === undefined) return null
    const generation = activeGeneration(conversation)
    const budget = workerLedgerBudget.get(conversation, generation) as {
      rows: number
      bytes: number
    }
    if (
      budget.rows > 8192 ||
      budget.bytes > 8 * 1024 * 1024 ||
      (left !== undefined && (budget.rows > left.rowsLeft || budget.bytes > left.bytesLeft))
    ) {
      if (left !== undefined) {
        left.rowsLeft = 0
        left.bytesLeft = 0
      }
      return null
    }
    if (left !== undefined) {
      left.rowsLeft -= budget.rows
      left.bytesLeft -= budget.bytes
    }
    const rows = workerLedgerRead.all(conversation, generation) as EventRow[]
    try {
      return rows.map((row) => {
        const event = aStoredObject(row.payload)
        if (event === null || typeof event.type !== 'string')
          throw new Error('worker ledger unreadable')
        return {
          ordinal: row.ordinal,
          at: row.created_at,
          event: boundStoredEvent(event as unknown as TranscriptEvent),
        }
      })
    } catch {
      return null
    }
  }
  const workerRoutingRows = db.prepare(
    `SELECT session_id, substr(payload, 1, 4097) AS payload, length(payload) AS characters
       FROM events INDEXED BY events_request_routed_idx WHERE type = 'request_routed'
       ORDER BY session_id, ordinal LIMIT 8193`,
  )
  function workerQuestionTargets(): readonly { asker: string; recipient: string }[] | null {
    const rows = workerRoutingRows.all() as {
      session_id: string
      payload: string
      characters: number
    }[]
    if (rows.length > 8192) return null
    const targets: { asker: string; recipient: string }[] = []
    for (const row of rows) {
      if (row.characters > 4096) return null
      const event = aStoredObject(row.payload)
      if (
        event?.type !== 'request_routed' ||
        !isAStoredId(event.requestId) ||
        (event.parent !== null && !isAStoredId(event.parent))
      )
        return null
      if (event.parent !== null) targets.push({ asker: row.session_id, recipient: event.parent })
    }
    return targets
  }
  function workersBorn(): readonly WorkerBorn[] {
    const count = workerCandidateCount.get() as { total: number }
    if (count.total > 8192) throw new Error('too many worker birth candidates')
    const rows = selectWorkerBirths.all() as {
      id: string
      identity: string | null
      identityCreatedAt: number | null
      payload: string
      characters: number
    }[]
    if (rows.length > 8192) throw new Error('too many worker registrations')
    return rows.map((row) => {
      if (row.characters > 4096) throw new Error('worker registration is too large')
      const fact = workerRegistrationOf(JSON.parse(row.payload))
      if (
        fact === null ||
        fact.identity !== row.identity ||
        fact.identityCreatedAt !== row.identityCreatedAt
      ) {
        throw new Error('worker registration does not match its identity')
      }
      return {
        conversation: row.id,
        identity: fact.identity,
        identityCreatedAt: fact.identityCreatedAt,
        giver: fact.giver,
        number: fact.number,
      }
    })
  }

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
  const settleStrandedMessagesTx = db.transaction(
    (at: number, running: ReadonlySet<string>, unread?: RowsUnread): number => {
      const { stranded, torn } = strandedMessages()
      // Every torn row the sweep passes over, warned.
      for (const one of torn) noteUnreadRow(one.session_id, one.ordinal, undefined)
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
              detail: 'the app stopped while this message was still waiting to be sent',
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
    },
  )

  const selectALaunch = db.prepare(
    `SELECT 1 AS yes FROM events WHERE session_id = ? AND generation = ? AND type = 'launched' LIMIT 1`,
  )
  const settleStrandedRequestsTx = db.transaction(
    (at: number, running: ReadonlySet<string>, unread?: RowsUnread): number => {
      const candidates = selectSessionsThatRouted.all() as { id: string }[]
      let settled = 0
      for (const asker of candidates) {
        if (running.has(asker.id)) continue
        try {
          const generation = activeGeneration(asker.id)
          const launched = selectALaunch.get(asker.id, generation) !== undefined
          const raised = launched ? questionsRaisedInSession(asker.id, unread?.in(asker.id)) : null
          for (const request of routedRequestsOfSession(asker.id, unread?.in(asker.id))) {
            if (!REQUEST_IS_OPEN[request.state]) continue
            if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue
            const max = selectMaxOrdinal.get(asker.id, generation) as
              { max_ordinal: number | null } | undefined
            appendTx(
              asker.id,
              (max?.max_ordinal ?? -1) + 1,
              { type: 'request_stranded', requestId: request.requestId },
              at,
              generation,
              true,
            )
            settled += 1
          }
        } catch (error) {
          skipTheLedger(asker.id, error, unread?.in(asker.id))
        }
      }
      return settled
    },
  )

  const instructionAsksWaiting = (unread?: RowsUnread): readonly InstructionAskWaiting[] =>
    waitingOnAPerson(
      (
        selectInstructionAsks.all() as {
          conversation: string
          at: number
          ordinal: number
          readable: number
          payload: string
        }[]
      ).flatMap((row) => {
        if (row.readable === 0) {
          noteUnreadRow(row.conversation, row.ordinal, unread?.in(row.conversation))
          return []
        }
        try {
          const event = JSON.parse(row.payload) as
            InstructionProposedEvent | InstructionSettledEvent | null
          if (typeof event?.askId !== 'string') throw new Error('an instruction row with no ask id')
          return [{ conversation: row.conversation, at: row.at, event }]
        } catch (error) {
          console.warn(
            `session ledger: ${row.conversation} ordinal ${String(row.ordinal)} could not be read ` +
              `and was skipped (${error instanceof Error ? error.message : String(error)})`,
          )
          unread?.in(row.conversation)(row.ordinal)
          return []
        }
      }),
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
      (
        selectMcpServerRequests.all() as {
          conversation: string
          at: number
          ordinal: number
          readable: number
          payload: string
        }[]
      ).flatMap((row) => {
        if (row.readable === 0) {
          noteUnreadRow(row.conversation, row.ordinal, unread?.in(row.conversation))
          return []
        }
        try {
          const event = JSON.parse(row.payload) as
            McpServerRequestedEvent | McpServerRequestSettledEvent | null
          if (typeof event?.requestId !== 'string') {
            throw new Error('an MCP server request row with no request id')
          }
          return [{ conversation: row.conversation, at: row.at, event }]
        } catch (error) {
          console.warn(
            `session ledger: ${row.conversation} ordinal ${String(row.ordinal)} could not be read ` +
              `and was skipped (${error instanceof Error ? error.message : String(error)})`,
          )
          unread?.in(row.conversation)(row.ordinal)
          return []
        }
      }),
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
    ): number => {
      let written = 0
      const services = new Set((selectServicesBorn.all() as { id: string }[]).map(({ id }) => id))
      for (const worker of selectOwnersOfGivenPieces.all() as { id: string }[]) {
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

  let cutTurnStatements:
    | {
        readonly leftRunning: AppStatement
        readonly lastMoment: AppStatement
        readonly openTurn: AppStatement
        readonly newestTurn: AppStatement
        readonly turnFirstRow: AppStatement
        readonly lastLaunch: AppStatement
        readonly aTurn: AppStatement
        readonly turnBefore: AppStatement
        readonly itsRows: AppStatement
        readonly lastRouting: AppStatement
        readonly itsMessage: AppStatement
      }
    | undefined
  const cutTurnSql = (): NonNullable<typeof cutTurnStatements> =>
    (cutTurnStatements ??= {
      leftRunning: db.prepare(
        `SELECT id, status FROM provider_session WHERE status IN ('working', 'waiting_permission')`,
      ),
      lastMoment: db.prepare(
        `SELECT created_at AS at FROM events WHERE session_id = ? AND generation = ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      openTurn: db.prepare(
        `SELECT id, blocked_at, opened_at FROM turn
          WHERE session_id = ? AND generation = ? AND closed_at IS NULL
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      newestTurn: db.prepare(
        `SELECT id FROM turn WHERE session_id = ? ORDER BY generation DESC, ordinal DESC LIMIT 1`,
      ),
      turnFirstRow: db.prepare(
        `SELECT min(ordinal) AS first FROM events INDEXED BY events_turn_idx
          WHERE session_id = ? AND turn_id = ? AND generation = ?`,
      ),
      lastLaunch: db.prepare(
        `SELECT max(ordinal) AS last FROM events
          WHERE session_id = ? AND generation = ? AND ordinal < ?
            AND type IN ('launched', 'reopened')`,
      ),
      aTurn: db.prepare(
        `SELECT end_reason, generation, ordinal FROM turn WHERE id = ? AND session_id = ?`,
      ),
      turnBefore: db.prepare(
        `SELECT id, ordinal FROM turn WHERE session_id = ? AND generation = ? AND ordinal < ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      itsRows: db.prepare(
        `SELECT type, payload FROM events INDEXED BY events_turn_idx
          WHERE session_id = ? AND turn_id = ? AND generation = ?
            AND type IN ('turn', 'work_interrupted', 'user_decision', 'user_turn')`,
      ),
      lastRouting: db.prepare(
        `SELECT ordinal FROM events
          WHERE session_id = ? AND generation = ? AND type = 'request_routed'
            AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END = ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      itsMessage: db.prepare(
        `SELECT type, payload FROM events
          WHERE session_id = ? AND type IN ('message_queued', 'message_unqueued')
            AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') END = ?`,
      ),
    })
  const theOpenTurnOf = (sessionId: string): OpenTurn | null => {
    const generation = activeGeneration(sessionId)
    const row = cutTurnSql().openTurn.get(sessionId, generation) as
      { id: string; blocked_at: number | null; opened_at: number } | undefined
    if (row === undefined) return null
    return { id: row.id, generation, blocked: row.blocked_at !== null, openedAt: row.opened_at }
  }

  const settleOrphanRunsTx = db.transaction((at: number, running: ReadonlySet<string>): number => {
    const rows = selectRunningSessions.all() as { id: string }[]
    const stranded = rows.filter((row) => !running.has(row.id))
    for (const row of stranded) settleTx(row.id, 'unknown', at, null)
    return stranded.length
  })

  let workStatements: {
    bump: AppStatement
    last: AppStatement
    insert: AppStatement
    byId: AppStatement
    rootNumbered: AppStatement
    childNumbered: AppStatement
    rootOwnedBy: AppStatement
    children: AppStatement
    doneCondition: AppStatement
    newestLine: AppStatement
    turnRootLine: AppStatement
    retitlesIn: AppStatement
    childAs: AppStatement
    conversationsOf: AppStatement
    newestHeldIn: AppStatement
    heldInCount: AppStatement
    insertResource: AppStatement
    resourcesOf: AppStatement
    filesOnPiece: AppStatement
    filesAddedBy: AppStatement
    filesUnder: AppStatement
    madeBy: AppStatement
    madeByCount: AppStatement
    newestKeptAnywhere: AppStatement
    keptAnywhereCount: AppStatement
    newestKeptUnder: AppStatement
    keptUnderCount: AppStatement
    resourceById: AppStatement
    untitledResources: AppStatement
    titleResource: AppStatement
    titledResources: AppStatement
    retitleResource: AppStatement
  } | null = null
  const workSql = (): NonNullable<typeof workStatements> =>
    (workStatements ??= {
      bump: db.prepare(
        `INSERT INTO work_sequence (scope, last) VALUES (?, 1)
           ON CONFLICT(scope) DO UPDATE SET last = last + 1`,
      ),
      last: db.prepare(`SELECT last FROM work_sequence WHERE scope = ?`),
      insert: db.prepare(
        `INSERT INTO work
           (id, parent_id, number, owner_session_id, given_by_session_id, title, brief, folder,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      byId: db.prepare(`SELECT ${WORK_COLUMNS} FROM work WHERE id = ?`),
      rootNumbered: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id IS NULL AND number = ?`,
      ),
      childNumbered: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id = ? AND number = ?`,
      ),
      rootOwnedBy: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id IS NULL AND owner_session_id = ?`,
      ),
      children: db.prepare(`SELECT ${WORK_COLUMNS} FROM work WHERE parent_id = ? ORDER BY number`),
      doneCondition: db.prepare(
        `SELECT payload FROM events
          WHERE session_id = ? AND +generation = ?
            AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                         'work_status_set', 'work_rebriefed', 'work_closed')
            AND type = 'work_rebriefed'
            AND CASE WHEN json_valid(payload) THEN
              CASE WHEN json_type(payload, '$.piece') = 'text' THEN
                json_extract(payload, '$.piece') = ? AND json_type(payload, '$.definitionOfDone') IS NOT NULL
              ELSE 1 END ELSE 1 END
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      newestLine: db.prepare(
        `SELECT payload, created_at, ordinal FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type = ?
            AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
          ORDER BY ordinal DESC
          LIMIT 1`,
      ),
      // A malformed newest row could name this root; never skip it to claim absence.
      turnRootLine: db.prepare(
        `SELECT payload, created_at, ordinal FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type = ?
            AND CASE WHEN json_valid(payload)
              THEN CASE WHEN json_type(payload, '$.piece') = 'text'
                THEN json_extract(payload, '$.piece') = ? ELSE 1 END
              ELSE 1 END
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      retitlesIn: db.prepare(
        `SELECT payload FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                         'work_status_set', 'work_rebriefed', 'work_closed')
            AND type = 'work_retitled'
          ORDER BY ordinal DESC`,
      ),
      childAs: db.prepare(
        `SELECT id, created_at FROM provider_session
          WHERE parent_session_id = ? AND agent_identity_id = ?
            AND (? IS NULL OR provider = ?)
            AND id NOT IN (SELECT value FROM json_each(?))
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      ),
      conversationsOf: db.prepare(
        `SELECT id, parent_session_id, created_at, updated_at FROM provider_session
          WHERE agent_identity_id = ?
          ORDER BY updated_at DESC, id DESC`,
      ),
      newestHeldIn: db.prepare(
        `SELECT id, owner_session_id FROM work
          WHERE owner_session_id IN (SELECT value FROM json_each(?))
            AND parent_id IS NOT NULL
          ORDER BY created_at DESC, id DESC LIMIT ?`,
      ),
      heldInCount: db.prepare(
        `SELECT count(*) AS total FROM work
          WHERE owner_session_id IN (SELECT value FROM json_each(?))
            AND parent_id IS NOT NULL`,
      ),
      insertResource: db.prepare(
        `INSERT INTO work_resource
           (id, work_id, role, title, summary, name, sha256, bytes, added_by_session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      resourcesOf: db.prepare(
        `SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE work_id = ? ORDER BY created_at, id`,
      ),
      filesOnPiece: db.prepare(`SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE work_id = ?`),
      filesAddedBy: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE added_by_session_id = ?`,
      ),
      filesUnder: db.prepare(
        `${HELD_UNDER}
         SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE work_id IN (SELECT id FROM held)`,
      ),
      madeBy: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource
          WHERE role = 'made'
            AND work_id IN (SELECT w.id FROM work w
                              JOIN provider_session s ON s.id = w.owner_session_id
                             WHERE s.agent_identity_id = ?)
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      ),
      madeByCount: db.prepare(
        `SELECT count(*) AS total FROM work_resource
          WHERE role = 'made'
            AND work_id IN (SELECT w.id FROM work w
                              JOIN provider_session s ON s.id = w.owner_session_id
                             WHERE s.agent_identity_id = ?)`,
      ),
      newestKeptAnywhere: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource
          WHERE ${KEPT_BEFORE}
          ORDER BY rowid DESC
          LIMIT @limit`,
      ),
      keptAnywhereCount: db.prepare(
        `SELECT count(*) AS total FROM (SELECT 1 FROM work_resource WHERE ${KEPT_BEFORE} LIMIT @cap)`,
      ),
      newestKeptUnder: db.prepare(
        `${HELD_UNDER}
         SELECT ${KEPT_FILE_COLUMNS} FROM work_resource INDEXED BY work_resource_work_idx
          WHERE work_id IN (SELECT id FROM held) AND ${KEPT_BEFORE}
          ORDER BY rowid DESC
          LIMIT @limit`,
      ),
      keptUnderCount: db.prepare(
        `${HELD_UNDER}
         SELECT count(*) AS total FROM (
           SELECT 1 FROM work_resource INDEXED BY work_resource_work_idx
            WHERE work_id IN (SELECT id FROM held) AND ${KEPT_BEFORE}
            LIMIT @cap)`,
      ),
      resourceById: db.prepare(`SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE id = ?`),
      untitledResources: db.prepare(
        `SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE title IS NULL ORDER BY rowid LIMIT ?`,
      ),
      titleResource: db.prepare(
        `UPDATE work_resource SET title = ? WHERE id = ? AND title IS NULL`,
      ),
      titledResources: db.prepare(
        `SELECT rowid AS at, ${RESOURCE_COLUMNS} FROM work_resource
          WHERE title IS NOT NULL AND rowid > @after
            AND (title = name OR created_at < @keptBefore)
          ORDER BY rowid LIMIT @limit`,
      ),
      retitleResource: db.prepare(
        `UPDATE work_resource SET title = @title
          WHERE id = @id AND title = @was AND @title <> @was`,
      ),
    })

  const bumpSequence = (scope: string): number => {
    workSql().bump.run(scope)
    return (workSql().last.get(scope) as { last: number }).last
  }

  const openRoot = (owner: string, at: number): void => {
    workSql().insert.run(
      newWorkId(),
      null,
      bumpSequence(ROOTS_SCOPE),
      owner,
      null,
      null,
      null,
      null,
      at,
    )
  }

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

  const chainUp = (row: WorkDbRow): readonly WorkDbRow[] => {
    const chain = [row]
    let parent = row.parent_id
    while (parent !== null) {
      if (chain.length >= MAX_WORK_DEPTH_WALKED) {
        throw new Error(`the pieces above ${row.id} do not end in a root`)
      }
      const up = workSql().byId.get(parent) as WorkDbRow | undefined
      if (up === undefined) throw new Error(`piece ${row.id} names a parent this database lacks`)
      chain.push(up)
      parent = up.parent_id
    }
    return chain
  }

  const workRowFrom = (row: WorkDbRow, numbers: readonly number[]): WorkRow => ({
    piece: row.id,
    parent: row.parent_id,
    number: row.number,
    label: pieceCalled(numbers),
    owner: row.owner_session_id,
    givenBy: row.given_by_session_id,
    title: row.title,
    brief: row.brief,
    folder: row.folder,
    createdAt: row.created_at,
  })

  const workRowWalked = (row: WorkDbRow): WorkRow =>
    workRowFrom(
      row,
      [...chainUp(row)].reverse().map((each) => each.number),
    )

  const newestLineAbout = (
    piece: WorkDbRow,
    generation: number,
    type: 'work_retitled' | 'work_status_set',
  ): Record<string, unknown> | null => {
    const found = workSql().newestLine.get(piece.owner_session_id, generation, type, piece.id) as
      { payload: string; created_at: number; ordinal: number } | undefined
    if (found === undefined) return null
    const stored = aStoredObject(found.payload)
    return stored === null ? null : { ...stored, at: found.created_at, revision: found.ordinal }
  }

  const titleNow = (
    piece: WorkDbRow,
    generation: number,
    newestRetitle: (piece: WorkDbRow, generation: number) => Record<string, unknown> | null = (
      one,
      itsGeneration,
    ) => newestLineAbout(one, itsGeneration, 'work_retitled'),
  ): string | null => {
    return currentWorkTitle(piece.title, newestRetitle(piece, generation))
  }

  const retitlesOf = (
    owner: string,
    generation: number,
  ): ReadonlyMap<string, Record<string, unknown>> => {
    const newest = new Map<string, Record<string, unknown>>()
    for (const row of workSql().retitlesIn.all(owner, generation) as { payload: string }[]) {
      const stored = aStoredObject(row.payload)
      const piece = stored?.piece
      if (stored === null || typeof piece !== 'string' || newest.has(piece)) continue
      newest.set(piece, stored)
    }
    return newest
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
          const folded = foldPiecesOfSession(row.owner_session_id, () => {
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

  const insertAdoptedRow = (record: AdoptedSessionRecord, at: number): void => {
    const ref = serializeSessionRef({
      provider: record.provider,
      sessionId: record.sessionId,
      cwd: record.cwd,
      rotation: record.rotation ?? 0,
    })
    const identityId = record.profileId === null ? null : identityRowFor(record.profileId, at)
    insertAdopted.run(
      record.id,
      record.provider,
      ref,
      record.cwd,
      record.profileId,
      record.createdAt,
      record.updatedAt,
      at,
      record.child ? JSON.stringify(record.child) : null,
    )
    if (identityId !== null) spawnSql().writeIdentityOnSession.run(identityId, record.id)
    openRoot(record.id, at)
  }

  const importSnapshotTx = db.transaction((snapshot: SessionSnapshot) =>
    committed.asAWhole(() => importSnapshotRows(snapshot)),
  )
  const importSnapshotRows = (snapshot: SessionSnapshot): void => {
    committed.whole(snapshot.session.id, 'imported')
    const at = now()
    insertAdoptedRow(snapshot.session, at)
    markRestored.run(at, snapshot.session.id)
    for (const entry of snapshot.ledger) {
      appendTx(snapshot.session.id, entry.ordinal, entry.event, entry.at, 0, true)
    }
    writeGeneration.run(snapshot.session.id, NORMALIZER_VERSION, snapshot.derivedThrough, at)
  }

  const learnDescentTx = db.transaction((sessionId: string, child: ChildDescent | undefined) => {
    if (!child) return false
    const row = readAdoptedDescent.get(sessionId) as { child_descent: string | null } | undefined
    if (row === undefined) return false
    const merged = mergeDescent(parseChildDescent(row.child_descent), child)
    const next = merged === null ? null : JSON.stringify(merged)
    if (next === row.child_descent) return false
    writeAdoptedDescent.run(next, sessionId)
    return true
  })

  const refreshAdoptedTx = db.transaction(
    (sessionId: string, updatedAt: number, child: ChildDescent | undefined) => {
      touchAdopted.run(updatedAt, sessionId, updatedAt)
      return learnDescentTx(sessionId, child)
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
    } else if (record.service !== true) {
      openRoot(record.id, at)
    }
    if (record.worker !== undefined) {
      appendTx(record.id, 0, { type: 'worker_registered', ...record.worker }, at, 0, true)
    }
  })

  const adoptTx = db.transaction((record: AdoptedSessionRecord, at: number) => {
    insertAdoptedRow(record, at)
  })

  return {
    ...ownNotesStore,
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

    capabilitiesOf(profileSlug) {
      return readCapabilities(agentIdentityRowId(profileSlug))
    },

    ownInstructionsOf(profileSlug) {
      const identity = foldProfileName(profileSlug)
      const rows = ownInstructionSql().versionsOf.all(
        agentIdentityRowId(profileSlug),
      ) as OwnInstructionRow[]
      return { identity, versions: rows.map(ownInstructionFrom) }
    },

    configuredLayerFor(profileSlug) {
      const row = ownInstructionSql().newestOf.get(agentIdentityRowId(profileSlug)) as
        OwnInstructionRow | undefined
      return row === undefined
        ? null
        : configuredLayerOf({
            identity: foldProfileName(profileSlug),
            versions: [ownInstructionFrom(row)],
          })
    },

    writeOwnInstructions(said, at) {
      const rowId = agentIdentityRowId(said.profileSlug)
      return db.transaction((): OwnInstructionsVersion | null => {
        if (spawnSql().identityBySlug.get(foldProfileName(said.profileSlug)) === undefined) {
          return null
        }
        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined
        if (said.whoWroteIt === 'a-person' && said.by.who !== 'a-person') return null
        if (said.expectedVersion !== undefined && said.expectedVersion !== (newest?.version ?? 0))
          return null
        let text = said.text
        if (said.broughtBack !== null) {
          if (said.by.who !== 'a-person' || said.whoWroteIt !== 'a-person') return null
          if (said.broughtBack < 1 || said.broughtBack >= (newest?.version ?? 0) + 1) return null
          const historical = ownInstructionSql().versionOf.get(rowId, said.broughtBack) as
            { text: string } | undefined
          if (historical === undefined) return null
          if (said.text !== '' && said.text !== historical.text) return null
          text = historical.text
        }
        if (
          said.whoWroteIt === 'an-agent-direct' &&
          (said.by.who !== 'an-agent' ||
            said.author === undefined ||
            said.said === null ||
            said.said.trim() === '' ||
            said.text.length > OWN_INSTRUCTIONS_CHARS ||
            said.said.length > OWN_INSTRUCTIONS_CHARS ||
            said.expectedVersion === undefined)
        )
          return null
        if (said.whoWroteIt === 'an-agent-direct' && said.by.who === 'an-agent') {
          const identity = this.identityOf(said.by.agent)
          if (identity === null || said.conversation !== said.by.agent) return null
          const named = spawnSql().identityNameById.get(
            agentIdentityRowId(identity.profileSlug),
          ) as AgentIdentityName | undefined
          if (
            named === undefined ||
            said.author?.profile !== named.slug ||
            said.author.name !== agentName(named.slug, [named])
          )
            return null
        }
        const version = (newest?.version ?? 0) + 1
        ownInstructionSql().insertVersion.run(
          ownInstructionsRowId(said.profileSlug, version),
          rowId,
          version,
          text,
          said.whoWroteIt,
          said.author === undefined ? null : JSON.stringify(said.author),
          JSON.stringify(said.by),
          said.conversation,
          said.said,
          said.broughtBack,
          at,
        )
        return {
          version,
          text,
          whoWroteIt: said.whoWroteIt,
          by: said.by,
          conversation: said.conversation,
          said: said.said,
          broughtBack: said.broughtBack,
          writtenAt: at,
          ...(said.author === undefined ? {} : { author: said.author }),
        }
      })()
    },

    undoOwnInstructions(profileSlug, expectedVersion, by, at) {
      return db.transaction(() => {
        if (by.who !== 'a-person' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
          return null
        const newest = ownInstructionSql().newestOf.get(agentIdentityRowId(profileSlug)) as
          OwnInstructionRow | undefined
        if (newest?.version !== expectedVersion) return null
        return this.writeOwnInstructions(
          {
            profileSlug,
            text: '',
            expectedVersion,
            whoWroteIt: 'a-person',
            by,
            conversation: null,
            said: null,
            broughtBack: expectedVersion === 1 ? null : expectedVersion - 1,
          },
          at,
        )
      })()
    },

    instructionUnread(profileSlug) {
      const rowId = agentIdentityRowId(profileSlug)
      const seen = ownInstructionSql().seenOf.get(rowId) as { seen_through: number } | undefined
      const direct = ownInstructionSql().newestDirect.get(rowId) as { version: number | null }
      const seenThrough = seen?.seen_through ?? 0
      const newestDirectVersion = direct.version ?? 0
      return { seenThrough, newestDirectVersion, unread: newestDirectVersion > seenThrough }
    },

    markInstructionsSeen(profileSlug, version) {
      return db.transaction(() => {
        if (!Number.isSafeInteger(version) || version < 0) return false
        const rowId = agentIdentityRowId(profileSlug)
        if (spawnSql().identityBySlug.get(foldProfileName(profileSlug)) === undefined) return false
        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined
        if (version > (newest?.version ?? 0)) return false
        ownInstructionSql().markSeen.run(rowId, version)
        return true
      })()
    },

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

    memoryAmendmentsOf(profileSlug) {
      const rows = memoryAmendmentSql().amendmentsOf.all(
        agentIdentityRowId(profileSlug),
      ) as MemoryAmendmentRow[]
      return rows.map(memoryAmendmentFrom)
    },

    writeMemoryAmendment(said, at) {
      return appendMemoryAmendment(said, at, 'done')
    },
    beginMemoryAmendment(said, at) {
      return appendMemoryAmendment(said, at, 'pending')
    },
    settleMemoryAmendment(profileSlug, id, actual, by) {
      return memoryRecoveryStore.settle(
        agentIdentityRowId(foldProfileName(profileSlug)),
        id,
        actual,
        by,
      )
    },
    hasPendingMemoryAmendment(profileSlug) {
      return memoryRecoveryStore.hasPending(agentIdentityRowId(foldProfileName(profileSlug)))
    },
    memoryAmendment(profileSlug, id) {
      const row = memoryAmendmentSql().amendmentById.get(
        agentIdentityRowId(foldProfileName(profileSlug)),
        id,
      ) as MemoryAmendmentRow | undefined
      return row === undefined ? null : memoryAmendmentFrom(row)
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
      return (
        spawnSql().writeDisplayName.run(blankToNull(displayName), agentIdentityRowId(profileSlug))
          .changes > 0
      )
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

    setCapabilities(profileSlug, edit, externalMcpServerIds) {
      const rowId = agentIdentityRowId(profileSlug)
      const row = spawnSql().readCapabilities.get(rowId) as CapabilityRow | undefined
      if (row === undefined) return false
      const written: Record<CapabilityKey, string | number | null> = {
        maxDepth: edit.maxDepth === undefined ? row.max_depth : edit.maxDepth,
        canMessage: edit.canMessage === undefined ? row.can_message : edit.canMessage,
        canAssignWork: edit.canAssignWork === undefined ? row.can_assign_work : edit.canAssignWork,
        canCreateAgents:
          edit.canCreateAgents === undefined ? row.can_create_agents : edit.canCreateAgents,
        canWriteRules: edit.canWriteRules === undefined ? row.can_write_rules : edit.canWriteRules,
      }
      db.transaction(() => {
        spawnSql().writeCapabilities.run(
          ...CAPABILITY_FIELDS.map((field) => written[field.key]),
          rowId,
        )
        if (externalMcpServerIds === undefined) return
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

    spawnPolicy() {
      const row = spawnSql().readPolicy.get() as { spawning_enabled: number } | undefined
      return { spawningEnabled: row !== undefined && row.spawning_enabled === 1 }
    },

    setSpawningEnabled(enabled) {
      spawnSql().writePolicy.run(enabled ? 1 : 0, now())
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

    parentOf(sessionId) {
      const row = spawnSql().readParent.get(sessionId) as
        { parent_session_id: string | null } | undefined
      return row?.parent_session_id ?? null
    },

    ancestorsOf(sessionId) {
      const rows = spawnSql().ancestors.all(sessionId, sessionId) as { id: string }[]
      return rows.map((row) => row.id)
    },

    adopt(record) {
      adoptTx(record, now())
    },

    importSnapshot(snapshot) {
      withWindowWriteFence(connection, () => importSnapshotTx(snapshot))
    },

    refreshAdopted(sessionId, updatedAt, child) {
      return refreshAdoptedTx(sessionId, updatedAt, child)
    },

    learnDescent(sessionId, child) {
      return learnDescentTx(sessionId, child)
    },

    setApprovalMode(sessionId, mode) {
      writeApprovalMode.run(mode, now(), sessionId)
    },

    endPlanMode(sessionId, at) {
      writePlanEnded.run(at, at, sessionId)
    },
    startPlanMode(sessionId, at) {
      writePlanStarted.run(at, sessionId)
    },
    setModel(sessionId, model) {
      writeModel.run(model, now(), sessionId)
    },
    setReasoningEffort(sessionId, effort) {
      writeReasoningEffort.run(effort, now(), sessionId)
    },
    aPersonSetItsModelOrEffort(sessionId, at) {
      writeSetByAPerson.run(at, now(), sessionId)
    },
    setReportedModel(sessionId, model, effort) {
      writeReported.run(model, effort, sessionId)
    },
    whatItRunsOn(sessionId) {
      const row = readWhatItRunsOn.get(sessionId) as
        | {
            model: string | null
            reasoning_effort: string | null
            model_or_effort_set_by_a_person_at: number | null
            reported_model: string | null
            reported_effort: string | null
          }
        | undefined
      return row === undefined
        ? null
        : {
            model: row.model,
            reasoningEffort: row.reasoning_effort,
            aPersonChoseItAt: row.model_or_effort_set_by_a_person_at,
            reportedModel: row.reported_model,
            reportedEffort: row.reported_effort,
          }
    },

    findByProviderRef(provider, sessionId) {
      const row = selectByRef.get(provider, sessionId) as { id: string } | undefined
      if (row) return row.id
      const launched = launchSql().select.get(provider, sessionId) as { id: string } | undefined
      return launched?.id ?? null
    },

    nameItsLaunch(sessionId, ref) {
      return launchSql().name.run(serializeSessionRef(ref), sessionId, ref.sessionId).changes > 0
    },

    append(sessionId, ordinal, event, at) {
      appendTx(sessionId, ordinal, event, at, activeGeneration(sessionId), true)
    },

    appendMany(sessionId, entries) {
      if (entries.length === 0) return
      appendManyTx(sessionId, entries, activeGeneration(sessionId), true)
    },

    atomically(work) {
      return db.transaction(work)()
    },

    onCommitted(listener) {
      return committed.listen(listener)
    },

    checkCommitted() {
      committed.check()
    },

    find(sessionId) {
      const row = selectOne.get(sessionId) as SessionRow | undefined
      return row ? (toResumable(row) ?? null) : null
    },

    findLive(sessionId) {
      const row = selectOne.get(sessionId) as SessionRow | undefined
      if (!row) return null
      return {
        sessionId: row.id,
        profileId: row.profile_id,
        approvalMode:
          row.approval_mode === 'ask' || row.approval_mode === 'auto' ? row.approval_mode : null,
        ref: row.external_ref === null ? null : safeSessionRef(row.external_ref),
        model: row.model,
        reasoningEffort: row.reasoning_effort,
      }
    },

    workflowOutputPath(sessionId, taskId, unread) {
      const row = firstReadable(
        sessionId,
        selectWorkflowOutput.iterate(sessionId, activeGeneration(sessionId), taskId) as Iterable<{
          readable: number
          ordinal: number
          path: string | null
        }>,
        unread,
      )
      return row?.path ?? null
    },

    workflowAgentTask(sessionId, agentId, unread) {
      if (agentId === '') return null
      const row = firstReadable(
        sessionId,
        selectWorkflowAgentTask.iterate(
          sessionId,
          activeGeneration(sessionId),
          agentId,
        ) as Iterable<{
          readable: number
          ordinal: number
          taskId: string | null
        }>,
        unread,
      )
      return row?.taskId ?? null
    },

    workflowAgentIds(sessionId, taskId, unread) {
      if (taskId === '') return []
      const generation = activeGeneration(sessionId)
      const rows = selectWorkflowAgentIds.all(sessionId, generation, taskId) as {
        agentId: string
      }[]
      for (const torn of selectTornRuns.all(sessionId, generation) as { ordinal: number }[]) {
        noteUnreadRow(sessionId, torn.ordinal, unread?.in(sessionId))
      }
      return rows.map((row) => row.agentId)
    },

    reportedSubAgent(sessionId, agentId, unread) {
      if (agentId === '') return false
      const walk = selectSubAgentReported.iterate(
        sessionId,
        activeGeneration(sessionId),
        agentId,
      ) as Iterable<{ readable: number; ordinal: number }>
      const torn: number[] = []
      for (const row of walk) {
        if (row.readable) return true
        torn.push(row.ordinal)
      }
      for (const ordinal of torn) noteUnreadRow(sessionId, ordinal, unread?.in(sessionId))
      return false
    },

    events(sessionId) {
      return toPersistedEvents(
        selectEvents.all(sessionId, activeGeneration(sessionId)) as EventRow[],
      )
    },

    newestOfType(sessionId, type, before = Number.MAX_SAFE_INTEGER, from = 0) {
      const generation = activeGeneration(sessionId)
      for (let below = before; ;) {
        const rows = (
          type === 'launched'
            ? selectNewestLaunched.all(sessionId, generation, below)
            : type === 'tool_inventory'
              ? selectToolsInForce.all(sessionId, generation, below)
              : selectNewestOfType.all(sessionId, generation, type, from, below)
        ) as EventRow[]
        const row = rows[0]
        if (row === undefined || row.ordinal < from) return null
        const entry = toPersistedEvents(rows)[0]
        if (entry !== undefined) return entry
        below = row.ordinal
      }
    },

    threadLeadRows(
      sessionId,
      leadsOpenWith,
      before = Number.MAX_SAFE_INTEGER,
      historicalLeadsOpenWith = leadsOpenWith,
      fromOrdinal = Number.NEGATIVE_INFINITY,
    ) {
      const opening = `${leadsOpenWith.replace(/[\\%_]/g, (one) => `\\${one}`)}%`
      const historicalOpening = `${historicalLeadsOpenWith.replace(/[\\%_]/g, (one) => `\\${one}`)}%`
      const rows = selectThreadLeadRows.all(
        opening,
        historicalOpening,
        sessionId,
        activeGeneration(sessionId),
        fromOrdinal,
        before,
      ) as {
        ordinal: number
        type: ThreadLeadRow['rowType']
        conversation: string | null
        handed: number | null
        sent: string | null
        lead: string | null
        failed: number | null
      }[]
      const parsed = (text: string | null): unknown => {
        if (text === null) return null
        try {
          return JSON.parse(text) as unknown
        } catch {
          return null
        }
      }
      return rows.map((row) => ({
        ordinal: row.ordinal,
        rowType: row.type,
        conversation: parsed(row.conversation),
        handedOver: row.handed === 1,
        sent: row.sent,
        lead: parsed(row.lead),
        failedByThisApp: row.failed === 1,
      }))
    },

    eventsFrom(sessionId, fromOrdinal, limit) {
      const generation = activeGeneration(sessionId)
      for (let from = fromOrdinal; ;) {
        const rows = selectEventWindow.all(sessionId, generation, from, limit) as EventRow[]
        const last = rows[rows.length - 1]
        if (last === undefined) return []
        const entries = toPersistedEvents(rows)
        if (entries.length > 0) return entries
        from = last.ordinal + 1
      }
    },

    ancestryContext(sessionId, page, through, budget) {
      return readAncestryContext(
        db,
        sessionId,
        activeGeneration(sessionId),
        page,
        through,
        budget,
        (row) => toPersistedEvents([row])[0],
      )
    },

    turnWindow(sessionId, options) {
      const generation = activeGeneration(sessionId)
      const turns = Math.max(1, Math.floor(options.turns))
      const maxEvents = Math.max(1, Math.floor(options.maxEvents))
      const before =
        options.before ??
        ((selectMaxOrdinal.get(sessionId, generation) as { max_ordinal: number | null } | undefined)
          ?.max_ordinal ?? -1) + 1

      const floorRow = selectEventFloor.get(sessionId, generation, before, maxEvents - 1) as
        { ordinal: number } | undefined
      const eventFloor = floorRow?.ordinal ?? 0

      const starts = selectTurnStarts.all(sessionId, generation, before, turns) as {
        ordinal: number
      }[]

      let from = eventFloor
      let cutAtTurn = false
      if (starts.length >= turns) {
        for (const row of starts) {
          if (row.ordinal < eventFloor) break
          from = row.ordinal
          cutAtTurn = true
        }
      }

      const hasOlder =
        (selectAnyEventBelow.get(sessionId, generation, from) as { present: number }).present === 1
      const inForce = hasOlder
        ? (selectToolsInForce.get(sessionId, generation, from) as EventRow | undefined)
        : undefined
      const toolsInForce =
        inForce === undefined
          ? undefined
          : toPersistedEvents([inForce]).find((row) => row.event.type === 'tool_inventory')
      return {
        entries: toPersistedEvents(
          selectEventRange.all(sessionId, generation, from, before) as EventRow[],
        ),
        from,
        hasOlder,
        ...(toolsInForce === undefined ? {} : { toolsInForce }),
        turnAligned: cutAtTurn || !hasOlder,
      }
    },

    latestHumanAnswers(sessionId) {
      const generation = activeGeneration(sessionId)
      const row = latestHumanPrompt.get(sessionId, generation) as HumanPromptRow | undefined
      const human = row === undefined ? null : humanTurnAt(sessionId, generation, row)
      if (human === null) return { latest: null, active: null }
      const current = selectLastTurn.get(sessionId, generation) as { id: string } | undefined
      return {
        latest: human.answer,
        active:
          current?.id === row?.turn_id && human.boundedAt === Number.MAX_SAFE_INTEGER
            ? { promptOrdinal: human.answer.promptOrdinal, prompt: human.answer.prompt }
            : null,
      }
    },

    humanFinalsInWindow(sessionId, from, through) {
      const generation = activeGeneration(sessionId)
      const selected = new Map<number, HumanFinalContext>()
      const byTurn = new Map<string, ReturnType<typeof humanTurnAt>>()
      const rows = finalRowsInHumanWindow.all(sessionId, generation, from, through) as {
        ordinal: number
        turn_id: string | null
      }[]
      for (const row of rows) {
        if (row.turn_id === null) continue
        let human = byTurn.get(row.turn_id)
        if (human === undefined) {
          const prompt = turnOpeningForHuman.get(sessionId, generation, row.turn_id) as
            HumanPromptRow | undefined
          human = prompt === undefined ? null : humanTurnAt(sessionId, generation, prompt)
          byTurn.set(row.turn_id, human)
        }
        if (human?.answer.final?.ordinal === row.ordinal)
          selected.set(row.ordinal, {
            promptOrdinal: human.answer.promptOrdinal,
            prompt: human.answer.prompt,
          })
      }
      return selected
    },

    ledgerStatus(sessionId) {
      const row = (selectGeneration.get(sessionId) as GenerationRow | undefined) ?? null
      const generation = row?.active ?? 0
      const present =
        (selectAnyEvent.get(sessionId, generation) as { present: number }).present === 1
      return {
        present,
        derived: derivedStateOf(
          row === null
            ? null
            : {
                normalizerVersion: row.normalizer_version,
                building: row.building,
                failure: row.failure,
              },
          present,
        ),
        derivedThrough: row?.derived_through ?? 0,
        normalizerVersion: row?.normalizer_version ?? PRE_CONTRACT_NORMALIZER_VERSION,
        failure: row?.failure ?? null,
      }
    },

    beginGeneration(sessionId) {
      db.transaction(() => {
        committed.whole(sessionId, 'listing')
        startBuilding.run(sessionId, PRE_CONTRACT_NORMALIZER_VERSION, now())
      })()
      const row = selectGeneration.get(sessionId) as GenerationRow | undefined
      if (row?.building == null) {
        throw new Error(`could not open a generation to build for ${sessionId}`)
      }
      return row.building
    },

    appendGeneration(sessionId, generation, entries) {
      if (entries.length === 0) return
      withWindowWriteFence(connection, () =>
        committed.asStaged(() => appendManyTx(sessionId, entries, generation, false)),
      )
    },

    promoteGeneration(sessionId, generation, through) {
      return db.transaction(() => {
        const flipped = promoteBuilding.run(
          generation,
          through.normalizerVersion,
          through.derivedThrough,
          now(),
          sessionId,
          generation,
        )
        if (flipped.changes === 0) return false
        committed.whole(sessionId, 'promoted')
        ledgerWrites.set(sessionId, { ordinal: null, generation })
        const open = selectOpenTurnId.get(sessionId, generation) as { id: string } | undefined
        if (open) closeTurn.run(now(), 'unknown', open.id)
        const status = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
        if (status && status.status !== 'ended' && status.status !== 'errored') {
          updateStatus.run(currentStatus(sessionId, null, generation), now(), sessionId)
        }
        return true
      })()
    },

    abandonGeneration(sessionId, generation, failure) {
      db.transaction(() => {
        committed.whole(sessionId, 'listing')
        stopBuilding.run(failure, now(), sessionId, generation)
      })()
    },

    clearOrphanBuilds(running) {
      return clearOrphanBuildsTx(now(), running)
    },

    settleOrphanRuns(at, running) {
      return settleOrphanRunsTx(at, running)
    },

    whatACrashLeftRunning(running) {
      const sql = cutTurnSql()
      return (sql.leftRunning.all() as { id: string; status: LeftRunning['status'] }[])
        .filter((row) => !running.has(row.id))
        .map((row) => {
          const last = sql.lastMoment.get(row.id, activeGeneration(row.id)) as
            { at: number } | undefined
          return {
            sessionId: row.id,
            status: row.status,
            turn: theOpenTurnOf(row.id),
            lastAt: last?.at ?? null,
          }
        })
    },

    recordedTurnMessage(sessionId, turnId) {
      const row = db
        .prepare(
          `SELECT e.ordinal, e.payload, e.created_at FROM events e
        JOIN turn t ON t.id=e.turn_id AND t.session_id=e.session_id AND t.generation=e.generation
        WHERE t.id=? AND t.session_id=? AND e.type='user_turn' ORDER BY e.ordinal LIMIT 1`,
        )
        .get(turnId, sessionId) as EventRow | undefined
      const message = row === undefined ? undefined : toPersistedEvents([row])[0]
      return message?.event.type === 'user_turn'
        ? (message as PersistedEvent & { event: UserTurnEvent })
        : null
    },

    recordedTurnOpening(sessionId, turnId) {
      const owned = db
        .prepare('SELECT 1 FROM turn WHERE id = ? AND session_id = ? AND generation = ?')
        .get(turnId, sessionId, activeGeneration(sessionId))
      if (owned === undefined) return null
      const row = selectTheTurnsOpening.get(turnId) as ExchangeRow | undefined
      if (row === undefined || row.payload === null) return null
      const event = aStoredObject(row.payload)
      if (event?.type !== 'user_turn' || typeof event.text !== 'string')
        throw new Error('unread turn opening')
      return event as unknown as UserTurnEvent
    },

    ensurePersonalRoot(sessionId, at) {
      return db.transaction(() => {
        const existing = this.rootOf(sessionId)
        if (existing !== null) return existing
        openRoot(sessionId, at)
        const root = this.rootOf(sessionId)
        if (root === null) throw new Error('personal root was not written')
        return root
      })()
    },

    theOpenTurn(sessionId) {
      return theOpenTurnOf(sessionId)
    },

    theNewestTurn(sessionId) {
      const row = cutTurnSql().newestTurn.get(sessionId) as { id: string } | undefined
      return row?.id ?? null
    },

    theActiveGeneration(sessionId) {
      return activeGeneration(sessionId)
    },

    aLifeOpenedTheTurn(sessionId, turnId, life) {
      const sql = cutTurnSql()
      const turn = sql.aTurn.get(turnId, sessionId) as { generation: number } | undefined
      if (turn === undefined || turn.generation !== life.generation) return false
      const first = (
        sql.turnFirstRow.get(sessionId, turnId, life.generation) as { first: number | null }
      ).first
      if (first === null) return false
      const last = (
        sql.lastLaunch.get(sessionId, life.generation, first) as { last: number | null }
      ).last
      return last === life.launched
    },

    howATurnEnded(sessionId, turnId) {
      const sql = cutTurnSql()
      const row = sql.aTurn.get(turnId, sessionId) as
        { end_reason: string | null; generation: number; ordinal: number } | undefined
      if (row === undefined) return null
      let theAppsWord = false
      let stopAsked = false
      let aContinuation = false
      let aPersonStartedIt = false
      let endedOnALimit = false
      let refused = false
      const piecesItNamed = new Set<string>()
      /** The pieces a `user_turn` row's words name, into {@link piecesItNamed}. */
      const theyName = (parts: readonly Record<string, unknown>[]): void => {
        const named = thePiecesTheTurnNames(
          parts.map((part) => ({
            ...(typeof part['piece'] === 'string' ? { piece: part['piece'] } : {}),
            ...(typeof part['drives'] === 'string' ? { drives: part['drives'] } : {}),
          })),
        )
        for (const one of named) piecesItNamed.add(one)
      }
      const partsOf = (said: Record<string, unknown>): readonly Record<string, unknown>[] =>
        Array.isArray(said['parts']) ? (said['parts'] as Record<string, unknown>[]) : [said]
      let itAskedForTheStop = false
      for (const one of sql.itsRows.all(sessionId, turnId, row.generation) as {
        type: string
        payload: string
      }[]) {
        let said: Record<string, unknown>
        try {
          said = JSON.parse(one.payload) as Record<string, unknown>
        } catch {
          continue
        }
        if (one.type === 'turn' && said['wordOf'] === 'this-app') theAppsWord = true
        if (one.type === 'turn') {
          if (said['loginRefused'] === true || said['billingRefused'] === true) refused = true
          if (typeof said['limit'] === 'object' && said['limit'] !== null) endedOnALimit = true
        }
        if (one.type === 'work_interrupted') stopAsked = true
        if (
          one.type === 'user_decision' &&
          said['outcome'] === 'cancel' &&
          said['stopsNothing'] !== true
        ) {
          stopAsked = true
        }
        if (one.type === 'user_turn') {
          const parts = partsOf(said)
          for (const part of parts) {
            if (part['appNotice'] === 'a-turn-the-app-cut') aContinuation = true
            if (aPersonsOwnWords(part as Parameters<typeof aPersonsOwnWords>[0])) {
              aPersonStartedIt = true
            }
          }
          theyName(parts)
          if (said['askedForTheStop'] === true) itAskedForTheStop = true
        }
      }
      let asking = itAskedForTheStop
      let from = row.ordinal
      while (asking) {
        const before = sql.turnBefore.get(sessionId, row.generation, from) as
          { id: string; ordinal: number } | undefined
        if (before === undefined) break
        asking = false
        for (const one of sql.itsRows.all(sessionId, before.id, row.generation) as {
          type: string
          payload: string
        }[]) {
          if (one.type !== 'user_turn') continue
          let said: Record<string, unknown>
          try {
            said = JSON.parse(one.payload) as Record<string, unknown>
          } catch {
            continue
          }
          theyName(partsOf(said))
          if (said['askedForTheStop'] === true) asking = true
        }
        from = before.ordinal
      }
      const ending = row.end_reason === null ? null : turnEndingSchema.safeParse(row.end_reason)
      return {
        ending: ending === null ? null : ending.success ? ending.data : 'unknown',
        generation: row.generation,
        theAppsWord,
        stopAsked,
        aContinuation,
        aPersonStartedIt,
        endedOnALimit,
        refused,
        piecesItNamed: [...piecesItNamed],
      }
    },

    whereItWasRouted(sessionId, requestId) {
      try {
        const row = cutTurnSql().lastRouting.get(
          sessionId,
          activeGeneration(sessionId),
          requestId,
        ) as { ordinal: number } | undefined
        return row?.ordinal ?? null
      } catch (error) {
        console.warn(
          `session store could not find where ${requestId} was routed in ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      }
    },

    whatBecameOfAMessage(sessionId, messageId) {
      let held = false
      let ended: 'sent' | 'ended' | null = null
      for (const one of cutTurnSql().itsMessage.all(sessionId, messageId) as {
        type: string
        payload: string
      }[]) {
        if (one.type === 'message_queued') held = true
        else {
          let said: Record<string, unknown> = {}
          try {
            said = JSON.parse(one.payload) as Record<string, unknown>
          } catch {
            // An unreadable ending is still an ending.
          }
          ended = said['reason'] === 'sent' ? 'sent' : (ended ?? 'ended')
        }
      }
      if (ended !== null) return ended
      return held ? 'waiting' : 'absent'
    },

    settleStrandedRequests(at, running, unread) {
      return settleStrandedRequestsTx(at, running, unread)
    },

    stalledWorkNobodyWasToldAbout(counted) {
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
      const waiting = oneWaitReadPerHolder(unread)
      const walked = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (sessionId, noteSkip) =>
          composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).filter(
            (piece) => aStallItsGiverCanBeToldOf(piece) && !toldAbout(piece.giver).has(piece.piece),
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
    waitsThatNeedClassifying(counted) {
      const holders = selectOwnersOfGivenPieces.all() as { id: string }[]
      const found = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (holder, noteSkip) =>
          piecesOfSession(holder, noteSkip).filter(
            (piece) => TASK_IS_OPEN[piece.state] && aWaitNeedsClassifying(piece.statusLine),
          ),
        counted ?? rowsUnreadOnce(),
      )
      const when = (piece: PieceRow): number => piece.statusLine?.at ?? Number.MAX_SAFE_INTEGER
      return {
        walk: found.walk,
        ledgers: found.ledgers,
        rowsUnread: found.rowsUnread,
        ...ledgersSkippedOf(found.ledgersSkipped),
        rows: [...found.rows].sort(
          (left, right) => when(left) - when(right) || (left.piece < right.piece ? -1 : 1),
        ),
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
      const when = (piece: PieceRow): number => piece.stalledAt ?? Number.MAX_SAFE_INTEGER
      return {
        walk: found.walk,
        ledgers: found.ledgers,
        rowsUnread: found.rowsUnread,
        ...ledgersSkippedOf(found.ledgersSkipped),
        rows: [...found.rows].sort(
          (left, right) => when(left) - when(right) || (left.piece < right.piece ? -1 : 1),
        ),
      }
    },
    stalledWorkItsGiverWasToldAbout(counted) {
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
      const waits = oneWaitReadPerHolder(unread)
      const found = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (holder, noteSkip) =>
          composeWhatEachPieceIsWaitingOn(piecesOfSession(holder, noteSkip), waits).filter(
            (piece) => aStallItsGiverCanBeToldOf(piece) && wasToldOf(piece.giver, piece.piece),
          ),
        unread,
      )
      const when = (piece: PieceRow): number => piece.stalledAt ?? Number.MAX_SAFE_INTEGER
      return {
        walk: found.walk,
        ledgers: found.ledgers,
        rowsUnread: found.rowsUnread,
        ...ledgersSkippedOf(found.ledgersSkipped),
        rows: [...found.rows].sort(
          (left, right) => when(left) - when(right) || (left.piece < right.piece ? -1 : 1),
        ),
      }
    },
    piecesWaitingOnWhoWrote(counted) {
      const holders = selectOwnersOfPiecesAConversationGave.all() as { id: string }[]
      const unread = counted ?? rowsUnreadOnce()
      const itsWaits = oneWaitReadPerHolder(unread)
      const walked = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (sessionId, noteSkip) =>
          composeWhatEachPieceIsWaitingOn(
            piecesWaitingOnWhoWroteIn(sessionId, noteSkip),
            itsWaits,
          ).filter(waitsOnWhoWrote),
        unread,
      )
      return {
        walk: walked.walk,
        ledgers: walked.ledgers,
        rowsUnread: walked.rowsUnread,
        ...ledgersSkippedOf(walked.ledgersSkipped),
        rows: [...walked.rows].sort((left, right) => {
          if (left.answeredAPersonAt !== right.answeredAPersonAt) {
            return left.answeredAPersonAt - right.answeredAPersonAt
          }
          return left.piece < right.piece ? -1 : 1
        }),
      }
    },
    piecesWaitingOnWhoWroteIn(owner, unread) {
      return piecesWaitingOnWhoWroteIn(owner, unread?.in(owner))
    },
    providerLimitsSeen(now, signInChangedAt, accountLives) {
      const accountOf = accountLives === undefined ? undefined : providerLimitAccounts(accountLives)
      const since = now - PROVIDER_WALL_LOOKBACK_MS
      const read = phase('read-walls', () => theWallsRead(since))
      const candidates = [...read.rows.values()].filter((row) => row.created_at >= since)
      // Count candidate ledgers, including rows that are unread or rejected.
      const ledgers = phase(
        'count-ledgers',
        () => new Set(candidates.map((row) => row.session_id)).size,
      )
      let rowsUnread = 0
      const seen = phase('select-walls', () =>
        candidates.flatMap((row) => {
          if (row.said === 'unread') {
            rowsUnread += 1
            return []
          }
          if (row.said === null) return []
          const account = accountOf?.(row.session_id, row.created_at) ?? null
          const wall = account === null ? row.said : { ...row.said, account }
          const changed = signInChangedAt?.get(wall.provider)
          if (changed === undefined) return [wall]
          if (wall.at < changed) return []
          if (row.life === undefined) row.life = lifeSinceOf(read, row)
          return row.life !== null && row.life < changed ? [] : [wall]
        }),
      )
      const retractions = phase('retractions', () =>
        takingWorkSince(
          seen,
          read,
          (sessionId, ordinal) => {
            noteUnreadRow(sessionId, ordinal, undefined)
            rowsUnread += 1
          },
          accountLives,
          now,
        ),
      )
      return {
        rows: phase('fold-walls', () => foldProviderLimits(seen, retractions, now)),
        walk: 'every-provider-wall-recently-recorded',
        ledgers,
        rowsUnread,
      }
    },
    readAheadProviderWalls(now, budgetMs) {
      return readTheWallsAhead(now, performance.now() + budgetMs)
    },
    messagesWaitingIn(sessionId, unread, maximumRows) {
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
        unread?.in(sessionId)(THE_WHOLE_LEDGER)
        return []
      }
      for (const row of read) {
        if (row.valid !== 1 || !isAStoredId(row.message_id)) {
          unread?.in(sessionId)(row.ordinal)
        }
      }
      const ended = new Set<unknown>()
      let lastTornEnding = -Infinity
      for (const row of read) {
        if (row.type !== 'message_unqueued') continue
        if (row.valid === 1) ended.add(row.message_id)
        else lastTornEnding = Math.max(lastTornEnding, row.ordinal)
      }
      const rows = read.filter(
        (row): row is typeof row & { payload: string } =>
          row.type === 'message_queued' &&
          row.valid === 1 &&
          row.message_id !== null &&
          row.payload !== null &&
          !ended.has(row.message_id) &&
          lastTornEnding <= row.ordinal,
      )
      return rows.flatMap((row) => {
        const stored = aStoredObject(row.payload)
        const messageId = stored?.messageId
        if (stored === null || typeof messageId !== 'string') return []
        const piece = isAStoredId(stored.piece) ? stored.piece : null
        const label =
          piece !== null &&
          typeof stored.label === 'string' &&
          pieceNumbersOf(stored.label) !== null
            ? stored.label
            : null
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
            ...(theQuestionItAsks(stored.asks) ?? {}),
          },
        ]
      })
    },

    settleStrandedMessages(at, running, unread) {
      return settleStrandedMessagesTx(at, running, unread)
    },
    settleRestartedWork(at, running, unread, wokenForAJob, diedInTheBackground, continuing) {
      return settleRestartedWorkTx(
        at,
        running,
        unread,
        wokenForAJob,
        diedInTheBackground,
        continuing,
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

    reconciliationOwners() {
      return (selectReconciliationOwners.all() as { id: string }[]).map((one) => one.id)
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
        const receipt = reconciliationReceipt(JSON.parse(row.payload), row.created_at)
        if (receipt === null) throw new Error('an incident receipt could not be read')
        return receipt
      })
    },
    reconciliationRecovery(owner) {
      const row = db
        .prepare(
          `SELECT payload FROM events WHERE session_id = ? AND type = 'work_recovery'
        ORDER BY generation DESC, ordinal DESC LIMIT 1`,
        )
        .get(owner) as { payload: string } | undefined
      if (row === undefined) return null
      const read = workRecoveryEvent(JSON.parse(row.payload))
      if (read === null) throw new Error('a recovery receipt could not be read')
      return read
    },
    reconciliationDrivenByTurn(owner, turn) {
      const current = activeGeneration(owner)
      const ending = db
        .prepare(
          `SELECT e.ordinal FROM events e JOIN turn t ON t.id = e.turn_id
        WHERE t.session_id = ? AND t.id = ? AND t.generation = ?
          AND (e.type = 'turn' OR (e.type = 'status' AND json_valid(e.payload)
            AND json_extract(e.payload, '$.state') IN ('idle', 'ended', 'errored')))
        ORDER BY e.ordinal LIMIT 1`,
        )
        .get(owner, turn, current) as { ordinal: number } | undefined
      const known = db
        .prepare('SELECT 1 FROM turn WHERE id = ? AND session_id = ? AND generation = ?')
        .get(turn, owner, current)
      if (known === undefined) return []
      const unread = rowsUnreadOnce()
      const folded = foldPiecesOfSession(owner, unread.in(owner), false, ending?.ordinal)
      if (unread.count !== 0 || unread.ledgersSkipped !== 0)
        throw new Error('the cut work could not be read')
      const pieces = folded.filter((one) => one.state === 'working').map((one) => one.piece)
      const root = workSql().rootOwnedBy.get(owner) as WorkDbRow | undefined
      const opening = this.recordedTurnOpening(owner, turn)
      const named =
        opening === null
          ? []
          : theMessagesOf(opening).flatMap((one) => (one.drives === undefined ? [] : [one.drives]))
      if (root !== undefined && (named.length === 0 || named.includes(root.id)))
        pieces.push(root.id)
      return pieces
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
    reconciliationDelivery(target, messageId) {
      const message = selectReconciliationMessage.get(target, messageId) as
        { generation: number; ordinal: number; payload: string } | undefined
      if (message === undefined) return 'not-delivered'
      const event = JSON.parse(message.payload) as QueuedMessageEvent | UnqueuedMessageEvent
      if (event.type === 'message_queued') return 'pending'
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
        !theMessagesOf(turn).some(
          (one) => one.text === event.text && one.appNotice === 'a-work-wait-needs-attention',
        )
      )
        return 'not-delivered'
      return opened.closed_at === null ? 'running' : 'turn-ended'
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

    rootOf(conversation) {
      const row = workSql().rootOwnedBy.get(conversation) as WorkDbRow | undefined
      return row === undefined ? null : workRowFrom(row, [row.number])
    },

    workersBorn,
    workerGiverContains,
    workerInItsPlace,
    workerLedger,
    workerLineage: workerReplacementChain,
    workerQuestionTargets,

    servicesBorn() {
      return (selectServicesBorn.all() as { id: string; identity: string | null }[]).map(
        ({ id, identity }) => ({ conversation: id, identity }),
      )
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

    workThatNamesAndItsWait(conversation, unread) {
      const generation = activeGeneration(conversation)
      const held = heldForAName(conversation, generation, unread)
      return {
        named: theRootThatNames(conversation, generation) ?? theWorkThatNamesItAmong(held.pieces),
        waitingOnPurpose: held.waiting,
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
      return { label: workRowWalked(mine).label, title: titleNow(mine, generation) }
    },

    childrenOf(piece) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      if (row === undefined) return []
      const above = [...chainUp(row)].reverse().map((each) => each.number)
      return (workSql().children.all(piece) as WorkDbRow[]).map((child) =>
        workRowFrom(child, [...above, child.number]),
      )
    },

    depthOf(piece) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      if (row === undefined) throw new Error(`no piece ${piece} in this database`)
      return chainUp(row).findIndex((one) => one.given_by_session_id === null)
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

    searchPastWork(caller, words) {
      return searchPastWork(connection, this, caller, words)
    },

    pastWorkSearchSource(caller) {
      return pastWorkSource(connection, caller)
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

    piecesWithTheirWaits(owner, unread) {
      return composeWhatEachPieceIsWaitingOn(
        piecesOfSession(owner, unread?.in(owner)),
        oneWaitReadPerHolder(unread),
      )
    },

    turnBlockPiecesOwnedBy(owner, unread) {
      return turnBlockPiecesOfSession(owner, unread?.in(owner))
    },

    openPiecesOf(owner, unread) {
      return piecesOfSession(owner, unread?.in(owner)).filter((piece) => TASK_IS_OPEN[piece.state])
    },

    newestChildAs(parents, profileSlug, provider, except = []) {
      const identityId = agentIdentityRowId(profileSlug)
      let newest: { readonly id: string; readonly created_at: number } | undefined
      for (const parent of parents) {
        const found = workSql().childAs.get(
          parent,
          identityId,
          provider ?? null,
          provider ?? null,
          JSON.stringify(except),
        ) as { id: string; created_at: number } | undefined
        if (found === undefined) continue
        if (
          newest === undefined ||
          found.created_at > newest.created_at ||
          (found.created_at === newest.created_at && found.id > newest.id)
        ) {
          newest = found
        }
      }
      return newest?.id ?? null
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

    resourcesOf(piece) {
      return (workSql().resourcesOf.all(piece) as ResourceDbRow[]).map(resourceFrom)
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
      const selected = selectDigestWindow.all(from, to) as DigestEventRow[]
      const decoded = keptDigestRowsOf(selected, from)
      return {
        rows: decoded.flatMap((one) => (one.row === null ? [] : [one.row])),
        walk: 'one-window-over-every-agents-conversation',
        ledgers: (countPlacedConversations.get() as { n: number }).n,
        rowsUnread: decoded.filter((one) => one.row === null).length,
      }
    },

    digestWindow(from, to) {
      const insideATransaction = db.inTransaction
      try {
        keptDigestRows(from)
      } catch (error) {
        forgetTheDigestRows()
        throw error
      }
      keepTheDigestRowsAWhile()
      const ledgers = (countPlacedConversations.get() as { n: number }).n
      let rowsUnread = 0
      const rows: DigestRow[] = []
      for (const kept of keptDigest.values()) {
        for (const one of kept.rows) {
          if (one.at < from || one.at >= to) continue
          if (one.row === null) rowsUnread += 1
          else rows.push(one.row)
        }
      }
      if (insideATransaction) forgetTheDigestRows()
      // The window read's own order: by time, then conversation, then ordinal.
      rows.sort(
        (a, b) =>
          a.at - b.at ||
          (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
          a.ordinal - b.ordinal,
      )
      return {
        rows,
        walk: 'one-window-over-every-agents-conversation',
        ledgers,
        rowsUnread,
      }
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
      return lastExchangeIn(sessionId)
    },
    whatOpenedTheLastEndedTurn(sessionId) {
      return whatOpenedTheLastEndedTurn(sessionId)
    },
    transcript(sessionId, read) {
      return transcriptOf(sessionId, read)
    },
    lastAskToStop(sessionId, unread) {
      return lastAskToStopOf(sessionId, unread?.in(sessionId))
    },
    questionsRaisedIn(sessionId, unread) {
      return questionsRaisedInSession(sessionId, unread?.in(sessionId))
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
      return stallsToldToSession(sessionId)
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

    discardGeneration(sessionId, generation, limit) {
      return db.transaction(() =>
        committed.asStaged(() => {
          committed.staged(sessionId)
          // A batch that may take out such a row moves their readers; any other stays quiet.
          const seen = generationHoldsRowsReadInEvery.get(
            sessionId,
            generation,
            sessionId,
            generation,
          ) as { holds: number }
          const events = deleteEventGeneration.run(sessionId, generation, limit)
          if (seen.holds === 1 && events.changes > 0) committed.stagedRemovedSeen(sessionId)
          if (events.changes > 0) return events.changes
          return deleteTurnGeneration.run(sessionId, generation, limit).changes
        }),
      )()
    },

    deadGenerations(sessionId) {
      const row = selectGeneration.get(sessionId) as GenerationRow | undefined
      if (row === undefined) return []
      const dead: number[] = []
      for (let generation = 0; generation <= row.highest; generation++) {
        if (generation !== row.active) dead.push(generation)
      }
      return dead
    },

    turns(sessionId) {
      return (
        selectTurns.all(sessionId, activeGeneration(sessionId)) as {
          id: string
          ordinal: number
          prompt: string
          opened_at: number
          closed_at: number | null
          end_reason: string | null
          blocked_at: number | null
        }[]
      ).map((row) => ({
        id: row.id,
        ordinal: row.ordinal,
        prompt: row.prompt,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        endReason: resolveEndReason(row.end_reason),
        blockedAt: row.blocked_at,
      }))
    },

    closeOpenTurn(sessionId, reason, at) {
      return settleTx(sessionId, reason, at, null)
    },

    reopened(sessionId, at) {
      return reopenTx(sessionId, at)
    },

    closedByTheQuit(sessionIds, at) {
      closedByTheQuitTx(sessionIds, at)
    },

    whatTheQuitClosed() {
      return (selectClosedByTheQuit.all() as { id: string }[]).map((row) => row.id)
    },

    restartedWorkLate(conversation, pieces, at) {
      if (pieces.length === 0) return
      const generation = activeGeneration(conversation)
      const max = selectMaxOrdinal.get(conversation, generation) as
        { max_ordinal: number | null } | undefined
      appendTx(
        conversation,
        (max?.max_ordinal ?? -1) + 1,
        { type: 'work_restarted', pieces: [...pieces] },
        at,
        generation,
        false,
      )
    },

    backgroundTheRestartStopped(alsoTheseDied, before, notBefore) {
      const stamped = selectClosedByTheNewestQuit.all() as { id: string; at: number }[]
      const quit = stamped.filter((row) => row.at >= notBefore).map((row) => row.id)
      const found: { conversation: string; stopped: readonly string[]; endedAt: number }[] = []
      for (const conversation of new Set([...quit, ...alsoTheseDied])) {
        try {
          const ended = new Set<string>()
          let running: readonly string[] = []
          for (const row of selectBackgroundNewestFirst.all(conversation) as {
            type: string
            payload: string
          }[]) {
            if (row.type === 'launched') break
            const event = JSON.parse(row.payload) as {
              running?: { id: string; description?: string; kind?: string }[]
              ended?: { id: string }
            }
            if (event.running !== undefined) {
              running = event.running
                .filter((one) => !ended.has(one.id))
                .map((one) => one.description ?? one.kind ?? one.id)
              break
            }
            if (event.ended !== undefined) ended.add(event.ended.id)
          }
          if (running.length === 0) continue
          const last = (
            selectLastMomentBefore.get(conversation, before) as { at: number | null } | undefined
          )?.at
          found.push({ conversation, stopped: running, endedAt: last ?? before })
        } catch (error) {
          console.warn(
            `session store could not read what ${conversation} was running in the background: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      return found
    },

    terminate(sessionId, status, reason, at) {
      return settleTx(sessionId, reason, at, status)
    },

    lastOrdinalWrite(sessionId) {
      return db.inTransaction ? undefined : ledgerWrites.get(sessionId)
    },

    nextOrdinal(sessionId) {
      const row = selectMaxOrdinal.get(sessionId, activeGeneration(sessionId)) as
        { max_ordinal: number | null } | undefined
      return (row?.max_ordinal ?? -1) + 1
    },

    resumable() {
      return (selectAll.all() as SessionRow[]).flatMap((row) => {
        if (!hasSomewhereToReopen(row)) return []
        const session = toResumable(row)
        return session ? [session] : []
      })
    },

    unresumable() {
      // The same rows `resumable()` drops, kept with the reason they were dropped.
      return (selectAll.all() as SessionRow[]).flatMap((row) =>
        canReopen(row) ? [] : [{ ...describeRow(row), reason: whyNotResumable(row) }],
      )
    },

    recorded() {
      return (selectAll.all() as SessionRow[]).map(recordedOf)
    },

    replacements() {
      return (selectReplacements.all() as { session_id: string; payload: string }[]).flatMap(
        (row) => {
          try {
            const event = JSON.parse(row.payload) as { sessionId?: unknown }
            return typeof event.sessionId === 'string'
              ? [{ replaced: row.session_id, by: event.sessionId }]
              : []
          } catch (error) {
            console.warn(
              `session store skipped an unreadable replacement row in ${row.session_id}: ${error instanceof Error ? error.message : String(error)}`,
            )
            return []
          }
        },
      )
    },

    newestScheduleLevels() {
      const rows = selectNewestScheduleLevels.all() as {
        session_id: string
        payload: string
        first_listed: string | null
        compacted_at: number | null
      }[]
      return rows.flatMap((row) => {
        try {
          const said = notStartedSaidIn(row.payload)
          return [
            {
              conversation: row.session_id,
              level: scheduleLevelOf(row.payload, row.first_listed),
              compactedAt: row.compacted_at,
              ...(Object.keys(said).length === 0 ? {} : { notStartedSaid: said }),
            },
          ]
        } catch (error) {
          console.warn(
            `session store skipped an unreadable schedule in ${row.session_id}: ${error instanceof Error ? error.message : String(error)}`,
          )
          return []
        }
      })
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
      const row = selectOne.get(sessionId) as SessionRow | undefined
      return row === undefined ? null : recordedOf(row)
    },
  }
}

export function mergeDescent(
  stored: ChildDescent | null,
  live: ChildDescent | undefined,
): ChildDescent | null {
  if (!live) return stored
  const answered = Object.fromEntries(
    Object.entries(live).filter(([, value]) => value !== undefined),
  ) as ChildDescent
  return stored === null ? answered : { ...stored, ...answered }
}

function parseChildDescent(raw: string | null): ChildDescent | null {
  if (raw === null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as ChildDescent) : null
  } catch {
    return null
  }
}

function providerIdOf(row: SessionRow): string | null {
  if (row.external_ref === null) return null
  try {
    return parseSessionRef(row.external_ref).sessionId
  } catch {
    return null
  }
}

/** What a stored level says this app does not start its conversation for, by job; a word it does not know is passed over. */
function notStartedSaidIn(payload: string): Record<string, NotStartedBecause> {
  const level = JSON.parse(payload) as { jobs?: unknown }
  const said: Record<string, NotStartedBecause> = {}
  if (!Array.isArray(level.jobs)) return said
  for (const job of level.jobs as unknown[]) {
    if (typeof job !== 'object' || job === null) continue
    const { id, notStarted } = job as { id?: unknown; notStarted?: unknown }
    const known = NOT_STARTED_BECAUSE.find((word) => word === notStarted)
    if (typeof id === 'string' && known !== undefined) said[id] = known
  }
  return said
}

function scheduleLevelOf(payload: string, firstListed: string | null): ScheduleLevel {
  const level = JSON.parse(payload) as { jobs?: unknown; dropped?: unknown }
  const listed = (firstListed === null ? {} : JSON.parse(firstListed)) as Record<string, unknown>
  if (!Array.isArray(level.jobs)) throw new Error('its level lists no jobs')
  const jobs: ScheduledRow[] = []
  let unread = 0
  for (const job of level.jobs as unknown[]) {
    const row = job as { id?: unknown; schedule?: unknown; recurring?: unknown; prompt?: unknown }
    if (
      typeof job !== 'object' ||
      job === null ||
      typeof row.id !== 'string' ||
      (row.schedule !== undefined && typeof row.schedule !== 'string') ||
      (row.recurring !== undefined && typeof row.recurring !== 'boolean') ||
      (row.prompt !== undefined && typeof row.prompt !== 'string')
    ) {
      unread += 1
      continue
    }
    const since = listed[row.id]
    jobs.push({
      id: row.id,
      ...(row.schedule === undefined ? {} : { schedule: row.schedule }),
      ...(row.recurring === undefined ? {} : { recurring: row.recurring }),
      ...(row.prompt === undefined ? {} : { prompt: row.prompt }),
      ...(typeof since === 'number' ? { listedSince: since } : {}),
    })
  }
  const dropped = typeof level.dropped === 'number' ? level.dropped : 0
  return { jobs, dropped: dropped + unread }
}

export function aRowADeliveryCanStart(row: RecordedSession): boolean {
  return (
    !row.foundInUserHome && !row.restoredFromBundle && row.child === null && row.adoptedAt === null
  )
}

function recordedOf(row: SessionRow): RecordedSession {
  return {
    ...describeRow(row),
    providerSessionId: providerIdOf(row),
    derived: derivedStateOfRow(row),
    createdAt: row.created_at,
    unresumableReason: reopenRefusalOf(row),
    neverStarted: row.external_ref === null,
    child: parseChildDescent(row.child_descent),
  }
}

function reopenRefusalOf(row: ReopenFacts): string | null {
  return canReopen(row) ? whyNoDirectInput(row) : whyNotResumable(row)
}

/** The part of a row that reads the same whether or not it can be resumed. */
function describeRow(row: SessionRow): Omit<UnresumableSession, 'reason'> {
  return {
    sessionId: row.id,
    provider: row.provider as Provider,
    cwd: row.cwd,
    status: row.status as SessionStatus,
    profileId: row.profile_id,
    adoptedAt: row.adopted_at,
    updatedAt: row.updated_at,
    hasTranscript: row.has_events !== 0,
    foundInUserHome: foundInUserHome(row),
    restoredFromBundle: restoredFromBundle(row),
    lastEnding: resolveEndReason(row.last_end_reason),
  }
}

interface ReopenFacts {
  provider: string
  external_ref: string | null
  profile_id: string | null
  adopted_at: number | null
  restored_at: number | null
  child_descent: string | null
  has_events: number
}

function whyNotResumable(row: ReopenFacts): string {
  const provider = PROVIDER_NAME[row.provider as Provider]
  if (restoredFromBundle(row)) {
    const held =
      row.has_events === 0
        ? 'restored from a bundle that carried no conversation'
        : 'restored from a bundle — BroCrew has the whole conversation and can show it'
    return (
      `${held}, but ${provider} never ran it on this machine, so a message here has nothing to ` +
      'carry on from'
    )
  }
  if (foundInUserHome(row)) {
    return (
      `one of your own ${provider} conversations, found in ${provider}'s own folder — BroCrew can ` +
      `read it here, but a message here would start ${provider} in BroCrew's own folder, where ` +
      'this conversation is not'
    )
  }
  if (row.external_ref !== null) {
    return 'we can no longer read where this conversation lives, so a message here cannot carry it on'
  }
  return row.has_events === 0
    ? 'no turn was ever taken in this one, so there is nothing to carry on from'
    : `this one stopped before ${provider} gave it an id, so there is nothing to carry on from`
}

function foundInUserHome(row: ReopenFacts): boolean {
  return row.adopted_at !== null && row.profile_id === null
}

function restoredFromBundle(row: ReopenFacts): boolean {
  return row.restored_at !== null
}

function hasSomewhereToReopen(row: ReopenFacts): boolean {
  return !foundInUserHome(row) && !restoredFromBundle(row)
}

function canReopen(row: ReopenFacts): boolean {
  return hasSomewhereToReopen(row) && readableRef(row) !== null
}

function readableRef(
  row: Pick<ReopenFacts, 'external_ref'>,
): ReturnType<typeof parseSessionRef> | null {
  return row.external_ref === null ? null : safeSessionRef(row.external_ref)
}

function safeSessionRef(external: string): ReturnType<typeof parseSessionRef> | null {
  try {
    return parseSessionRef(external)
  } catch {
    return null
  }
}

function toResumable(row: SessionRow): ResumableSession | null {
  const ref = readableRef(row)
  if (ref === null) return null
  try {
    return {
      sessionId: row.id,
      provider: row.provider as Provider,
      ref,
      cwd: row.cwd,
      status: row.status as SessionStatus,
      approvalMode:
        row.approval_mode === 'ask' || row.approval_mode === 'auto' ? row.approval_mode : null,
      profileId: row.profile_id,
      reasoningEffort: row.reasoning_effort,
      model: row.model,
      planMode: row.plan_mode === null ? null : row.plan_mode !== 0,
      planEndedAt: row.plan_ended_at,
      modelOrEffortSetByAPersonAt: row.model_or_effort_set_by_a_person_at,
      reportedModel: row.reported_model,
      reportedEffort: row.reported_effort,
      adoptedAt: row.adopted_at,
      hasTranscript: row.has_events === 1,
      child: parseChildDescent(row.child_descent),
      resumeRefusal: whyNoDirectInput(row),
      homeRefusal: hasSomewhereToReopen(row) ? null : whyNotResumable(row),
      restoredFromBundle: restoredFromBundle(row),
      lastEnding: resolveEndReason(row.last_end_reason),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

function whyNoDirectInput(row: ReopenFacts): string | null {
  if (parseChildDescent(row.child_descent) === null) return null
  return 'a sub-agent conversation — another agent drove it, so it takes no message of its own'
}
