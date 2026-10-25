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
import { searchPastWork, closePastWorkSearch, pastWorkSource } from './past-work-search'
import type { PastWorkSearchResult, PastWorkSource } from '../../shared/past-work-search'
import {
  workRecoveryEvent,
  reconciliationReceipt,
  type WorkRecoveryEvent,
  type ReconciliationReceipt,
} from '../../shared/work-reconciliation'
import type { QuestionAskedEvent, WorkerRegisteredEvent } from '../../shared/runtime-ipc'
import type { WorkerBorn } from '../profile-execution-file'
import { workerRegistrationOf } from '../worker-registration'
import {
  moveOfferOf,
  moveOriginOf,
  moveReceiptOf,
  type MoveReceipt,
} from '../../shared/move-request'
import {
  boundRaw,
  boundRecall,
  // ⚑ **D-013** — whose background work wakes it, the provider's own declaration.
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
import { DEFAULT_IDENTITY_PROVIDER, providerSchema, turnEndingSchema } from '@brobot2/shared'
// The wire shapes live in the one module main, preload and the renderer all import — the same rule
// `session-library.ts` states. `LedgerStatus` crosses the boundary because the library and the
// reading pane are the two surfaces that have to be able to say "this is behind".
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
// ⚑ **729 · R89 — the answer a stranded message carries**, asked as `RuntimeHost` asks it.
import { AN_ANSWER_HELD_THEN_LOST, theAnswerItCarries } from '../../shared/tasks'
import { storedRefusalTold } from '../../shared/refusals'
// ⚑ **516 · the registry's shapes and its two derived ids** — a `src/shared` module with no zod and
// no main-only import, so the renderer names the same row this file writes.
import {
  externalMcpGrantRowId,
  externalMcpServerRowId,
  foldExternalMcpReach,
  type ExternalMcpServerReach,
  type ExternalMcpServerRow,
} from '../../shared/external-mcp'
import { THE_APP_DID_IT } from '../../shared/who-did-it'
// ⚑ **543 · the edge shapes and the one place a work edge is built from the row it comes from.**
// ⛔ A `src/shared` module with no zod and no main-only import, so the window reads the same edge
// this file walked.
import { workEdge, type SpawnEdge, type WorkEdge } from '../../shared/who-called-whom'
import type { ForestConversation, ForestParent, ForestTask } from '../../shared/the-whole-forest'
// ⚑ **533 · the recogniser, its vocabulary and its fold** — a `src/shared` module with no zod and
// no main-only import, so the window reads the same wall this file wrote out of the ledger.
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
import { sameModel, type AgentModelChoice, type ModelAndEffort } from '../../shared/model-choice'
import type { ChildDescent } from '../adopt/discover-sessions'
import type {
  InstructionProposedEvent,
  InstructionSettledEvent,
  McpServerRequestedEvent,
  McpServerRequestSettledEvent,
  AgentIdentity,
  AgentIdentityName,
  IdentityCreator,
  NewAgent,
  DerivedState,
  LedgerStatus,
  TheQuestionItAsks,
  TranscriptEvent,
  UserTurnEvent,
  WorkGivenEvent,
  UnqueuedMessageEvent,
  QueuedMessageEvent,
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
import { humanPromptOf, type HumanAnswers, type HumanFinalContext, type HumanTurnAnswer } from '../../shared/human-turn-answer'
// ⚑ **F071 · what the ledger folds read, and the term that reads it through its index.**
import {
  conversationTree,
  deleteTheTree,
  providerSessionsOf,
  whatTiesTheTreeOutside,
  type ProviderSessionOf,
  type TiedOutside,
  type TreeDeleted,
} from './conversation-tree'
import { FOLD_EVENT_TYPES, FOLD_TERM } from './fold-index'
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
import { MAX_HANDED_PATHS, type HandedPath } from '../../shared/runtime-ipc'
import { MAILBOX_KINDS, type MailboxKind } from '../../shared/runtime-ipc'
// ⚑ **545 · the slug rule itself and not a number chosen beside it** — see
// {@link boundRelayedIdentity}.
import { isPathSegment } from '../../shared/runtime-ipc'
// ⚑ **D-029 · a stored level, read back as the host holds one** — see {@link scheduleLevelOf}.
import type { ScheduledRow, ScheduleLevel } from '../../shared/agent-state'
// ⚑ **687 · what the launch sweep carries from a held row onto the ending it writes** — see
// {@link authorshipStoredOn}.
import {
  TURN_AUTHORSHIP_KEYS,
  type TurnAuthorship,
  type AnsweredQuestion,
} from '../../shared/runtime-ipc'
import { REPLY_SUMMARY_LIMIT } from '../runtime/reply-rails'
// ⚑ **D-027 · a turn's parts, each bounded as the row it would have been** — see
// {@link boundTheParts}.
import { MAX_TURN_PARTS, USER_TURN_PART_KEYS, type UserTurnPart } from '../../shared/runtime-ipc'
import {
  MEMORY_NOTES_PER_EVENT,
  MEMORY_NOTE_TEXT_CAP,
  type MemoryNoteSeen,
} from '../../shared/runtime-ipc'

export type { DerivedState, LedgerStatus }
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
  // ⚑ **603/609 · the ONE composition every surface that reports a piece's state reads**
  // (HO-091 §1), and it takes ONE source of everything a conversation is waiting on.
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
  type PieceRow,
  type PieceWaitingOnWhoWrote,
  type StatusLine,
  type WhatAConversationIsWaitingOn,
  type WorkGivenOut,
  type WorkReport,
} from '../../shared/tasks'
// ⚑ **D-016 · a piece's label** — `W1.4.2`, built and read by one module — and, since commit 7, the
// work that names a conversation.
import { pieceCalled, pieceNumbersOf, type WorkThatNamesIt } from '../../shared/piece-called'
import {
  REQUEST_IS_OPEN,
  // ⚑ **609 · the permission half of *a person owes something here*.**
  aPersonOwesAnAnswerIn,
  deriveRoutedRequests,
  // ⚑ **603 · the derivation the composition and the withdrawal door both resolve.**
  openQuestionsByWork,
  permissionShaped,
  anActionAsked,
  type LedgerWalk,
  type LedgerWalkKind,
  type ProviderRequestEvent,
  type RaisedQuestion,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
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
// ⚑ **D-012 · the last exchange and the transcript a giver reads** — see `exchangeOf`.
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
import { actedByFrom, type ActedBy } from '../../shared/who-did-it'
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
// ⚑ **D-016 · what a kept resource is to its piece, and how many one reply may hand in.**
import { formOfName, MAX_RESOURCES_PER_REPLY, type ResourceRole } from '../../shared/documents'
import { workFileGroup } from '../../shared/work-file-groups'

/**
 * ⚑ **One end of a spawn edge, as the STORE can answer it** (543).
 *
 * ⛔ **`running` is subtracted rather than the wire shape being re-typed**, and the subtraction is
 * the claim: whether this app is running a conversation right now lives in the host's slot map and
 * in no column (`421`). ⚑ Written as an `Omit` so a field added to {@link SpawnEdge} arrives here
 * as a compile error rather than as a second declaration free to drift.
 */
export type SpawnedConversation = Omit<SpawnEdge, 'running'>

/**
 * ⚑ **One conversation of the forest, as the STORE can answer it** (637) — {@link
 * SpawnedConversation}'s shape and its reason exactly.
 *
 * ⛔ **`running` is subtracted rather than the wire shape being re-typed**, and the subtraction is
 * the claim: whether this app is running a conversation right now lives in the host's slot map and
 * in no column (`421`). ⚑ Written as an `Omit` so a field added to {@link ForestConversation}
 * arrives here as a compile error rather than as a second declaration free to drift.
 *
 * ⚑ **D-034 · `standsInFor` and `inItsPlace` too**: who took whose place is in the host's memory,
 * read off the old ledgers once as it starts, so the forest adds no scan for it.
 */
export type ForestedConversation = Omit<
  ForestConversation,
  'running' | 'standsInFor' | 'inItsPlace'
>

/**
 * ⚑ **One node of the forest as the STORE can answer it** (637) — see
 * {@link SessionStore.everyPlacedConversation}.
 *
 * ⛔ **{@link ForestTask} is NOT subtracted from, because nothing on it is the slot map's.** A piece
 * is folded out of its owner's ledger and composed here, in the store (`664`), so the host adds
 * nothing to it — which is why only one arm of this union is an `Omit`.
 */
export type ForestedNode = ForestedConversation | ForestTask

/**
 * ⚑ **Which agent one conversation belongs to, and whether this app holds a row for it at all**
 * (543).
 *
 * ⛔ **Not {@link SessionStore.identityOf}, and the difference is the whole reason this exists.**
 * That reader answers `null` for a conversation this app never placed AND for a conversation id
 * that does not exist — *"two facts sharing one value"*, named in its own docblock and left there
 * because no caller could tell them apart. ⚑ A breadcrumb pointing at a parent is a caller that
 * must: {@link provider} is a `NOT NULL` column, so a row that exists always answers it.
 */
export interface ConversationBinding {
  /** Always present when this app holds the row — the column is `NOT NULL`. */
  readonly provider: Provider
  /**
   * The IDENTITY's folded slug (`agent_identity.slug`, through `agent_identity_id`), or `null`
   * when this app holds no identity for it (438).
   */
  readonly identity: string | null
}

/**
 * The durable half of a session: the row that says it existed, and the append-only
 * ledger of everything it emitted.
 *
 * Nothing wrote to these tables before — the schema was laid down in Step 0 and the
 * count on the start screen has read `0 persisted sessions` ever since. This is what
 * fills them, so a session can outlive the process that ran it.
 *
 * Two rules the rest of the app depends on:
 *  - **One transaction per event.** The ledger row and whatever durable state that
 *    event implies (the provider ref, the status) are written together or not at
 *    all, so the row and the summary can never disagree about what happened.
 *  - **Ordinals are the caller's.** The host already stamps a gap-free per-session
 *    ordinal on every event it forwards; reusing it here is what makes the ledger
 *    replayable in the exact order the UI saw.
 */

/**
 * ⚑ **The capability schema moved to `shared/capabilities.ts` at 355**, so a renderer can name it.
 *
 * ⛔ **Re-exported here and not re-declared.** `ProfileCapabilities`, `DEFAULT_CAPABILITIES` and
 * `CapabilityEdit` are this file's vocabulary — `capabilitiesOf` returns one, the folds below read
 * the second, `setCapabilities` takes the third — and every caller that had them from here still
 * does. What changed is where they are WRITTEN: 355 needed one enumerable place, because a surface
 * that hardcoded the field list would make P3's `can_interrupt` a rework of the dispatch that built
 * it (HO-008 §3). ⚠️ `CapabilityEdit` gained a `null` arm there: *use the default*, which is the
 * gesture a person needs and no caller inside this app had until there was a surface.
 */
export type {
  CapabilityGrant,
  CapabilityEdit,
  CapabilityKey,
  CapabilityOrigin,
  CapabilityOrigins,
  ProfileCapabilities,
} from '../../shared/capabilities'
export { CAPABILITY_FIELDS, DEFAULT_CAPABILITIES } from '../../shared/capabilities'

/**
 * 🔴 **D-016 · a `work` row, as every reader meets it** — what a piece IS, with the label it is
 * called by.
 *
 * ⚑ **`label` is computed on the read** from the numbers up the parents (`pieceCalled`), never
 * stored: a number is on each row, and a label is what those numbers spell from the root down.
 */
/** ⚑ A conversation's open turn: its row, its generation, whether a person's answer blocks it. */
export interface OpenTurn {
  readonly id: string
  readonly generation: number
  readonly blocked: boolean
  readonly openedAt: number
}

/** ⚑ A conversation a crash left running, as it stood before the launch's repair. */
export interface LeftRunning {
  readonly sessionId: string
  readonly status: 'working' | 'waiting_permission'
  readonly turn: OpenTurn | null
  /** Its last recorded moment, epoch ms; `null` for a ledger with no row. */
  readonly lastAt: number | null
}

/** ⚑ How a turn ended, and what its own rows say of it ({@link SessionStore.howATurnEnded}). */
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
  /**
   * The pieces the words this app handed it name, each once ({@link thePiecesTheTurnNames}): none
   * when they name none, or it was handed none. ⚑ With the words of each turn before it whose stop
   * they asked for, whose work it carries.
   */
  readonly piecesItNamed: readonly string[]
}

export interface WorkRow {
  /** `work.id`. */
  readonly piece: string
  /** The piece it was given under, or `null`: a root. */
  readonly parent: string | null
  readonly number: number
  /** `W1.4.2` — the root's number, then each number under it. */
  readonly label: string
  /** The conversation whose ledger holds its life. */
  readonly owner: string
  /**
   * The conversation that gave it, or `null`: a person — every root, and every piece its owner took
   * on for one (`take_on_work`, D-016 · commit 6).
   */
  readonly givenBy: string | null
  /**
   * As given. Always `null` on a root: its title is its newest `work_retitled` —
   * {@link SessionStore.rootLines}.
   */
  readonly title: string | null
  /** As given; `null` on a root. */
  readonly brief: string | null
  /** The folder the give asked for, as asked, or `null`. */
  readonly folder: string | null
  readonly createdAt: number
}

/** 🔴 **D-016 · a `work_resource` row** — one file kept for a piece, at `<resources>/<sha256>/<name>`. */
export interface ResourceRow {
  /** `res_<32 hex>` — `newResourceId`. */
  readonly resource: string
  readonly piece: string
  readonly role: ResourceRole
  /**
   * ⚑ **D-026 · R2 — the file's title, taken from its bytes when it was kept** (`resourceTitle`);
   * ⚠️ `null` on a row kept before titles were taken.
   */
  readonly title: string | null
  readonly summary: string | null
  readonly name: string
  readonly sha256: string
  readonly bytes: number
  /** The conversation that handed it in, or `null`: a person. */
  readonly addedBy: string | null
  readonly createdAt: number
}

/**
 * 🔴 **D-026 · a kept file on its piece, and whose identity added it** — what
 * {@link SessionStore.filesKept} and {@link SessionStore.madeBy} answer, each piece named one way.
 */
export interface KeptFileRow {
  readonly group?: import('../../shared/work-file-groups').WorkFileGroup
  readonly mainResult?: true
  readonly resource: ResourceRow
  /** The label of the piece it was kept on, as that piece's chain spells it. */
  readonly label: string
  /** The title that piece stands under now — `null`: a root nobody has titled. */
  readonly pieceTitle: string | null
  /**
   * The folded slug of the identity whose conversation added it — `null`: a person, or a
   * conversation this app holds no identity for.
   */
  readonly addedByIdentity: string | null
}

/**
 * 🔴 **D-026 · R1 — which kept files {@link SessionStore.filesKept} reads**, as the store holds them:
 *
 *  - **`tree`** — the pieces `holder` holds and those any of `givers` gave, and every piece under
 *    them, at any depth;
 *  - **`conversation`** — the files one conversation added;
 *  - **`piece`** — the files kept on one piece, by its id.
 */
export type KeptFilesAsked =
  | { readonly scope: 'tree'; readonly holder: string; readonly givers: readonly string[] }
  | { readonly scope: 'conversation'; readonly conversation: string }
  | { readonly scope: 'piece'; readonly piece: string }

/**
 * 🔴 **D-037 · which kept files {@link SessionStore.keptFilesNewestFirst} pages through** — a tree,
 * as {@link KeptFilesAsked} reads one, or every file this app keeps.
 */
export type KeptFilesPaged =
  Extract<KeptFilesAsked, { readonly scope: 'tree' }> | { readonly scope: 'everywhere' }

/**
 * ⚑ **D-037 · where a page of kept files begins**: kept before the file `olderThan` names (its id),
 * or the newest.
 */
export interface KeptFilesFrom {
  readonly olderThan: string | null
  readonly limit: number
}

/** 🔴 **D-016 · one input a give hands over** — its id minted by the giver's host before the send. */
export interface GivenInput {
  /** `res_<32 hex>` — `newResourceId`. */
  readonly resource: string
  /** 🔴 **D-026 · R2 — its title, taken as it was kept.** */
  readonly title: string
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

/**
 * 🔴 **D-016 · what {@link SessionStore.recordGive} writes** — a given piece's `work` row, whose
 * number was taken before the brief was sent ({@link SessionStore.numberUnder}), and its inputs; or
 * a piece taken on for a person (D-016 · commit 6), numbered the same way, with no brief sent and
 * no inputs.
 */
export interface GivenPiece {
  /** `work_<uuid>`, minted by the host (`newWorkId`) before it is sent or written. */
  readonly piece: string
  readonly parent: string
  readonly number: number
  /**
   * The conversation the brief actually reached — after a replacement, not the one looked up — or
   * the one that took the work on.
   */
  readonly owner: string
  /**
   * The conversation that gave it, or `null`: a person — work its owner took on for them
   * (`take_on_work`, D-016 · commit 6).
   */
  readonly givenBy: string | null
  readonly title: string
  readonly brief: string
  readonly folder: string | null
  /** The files the giver handed over with it, each kept as an `input` resource — empty for none. */
  readonly inputs: readonly GivenInput[]
}

export interface NewSessionRecord {
  /** A normal worker's binding, written atomically at ordinal zero of its first life. */
  worker?: Omit<WorkerRegisteredEvent, 'type'>
  id: string
  provider: Provider
  cwd: string
  /** Fixed at creation, and the one launch decision that cannot be re-derived later. */
  approvalMode: 'ask' | 'auto'
  /** The profile whose provider home it ran in — resume has to land in the same one. */
  profileId: string
  /**
   * The effort it was selected to run at (024; D-042 · R1); absent only for a model that offers
   * none. Replayed at every later start.
   */
  reasoningEffort?: string
  /**
   * 🔴 **The model it was selected to run (038)** — ⚑ D-042 · R1: the host names one at every start.
   * Replayed at every later start — idle stop, restart, replacement, a person's Reopen, an agent's
   * message. ⚠️ Absent writes NULL: a row nothing has selected a model for yet, which its next start
   * resolves and records.
   */
  model?: string
  /** Whether it was started in plan mode (030); absent when nobody asked. Replayed on resume. */
  planMode?: boolean
  /**
   * 🔴 **The conversation that started it** (341) — absent for one a person started, which gets a
   * ROOT in the same transaction: its own piece of work, numbered among the roots (D-016).
   */
  parentSessionId?: string
  /**
   * Made as a service's one conversation (`profile-execution-file.ts`): nothing started it, and it
   * owns no root, because every piece it holds is given to it by a caller, under the caller's work.
   */
  service?: true
  /**
   * 🔴 **727 · R87 — the provider session id this launch ASKED for** (`schema.ts`'s `launchedAs`),
   * written in the transaction that writes the row. ⛔ Genuinely absent — not null — for a launch
   * that named none: every Codex launch, whose id is in the handshake's own answer.
   */
  launchedAs?: string
}

/** A session that could be resumed: it has a provider ref to resume *from*. */
/**
 * ⚑ **D-017 · R3 — one held message a quit left waiting for its conversation's next start**, as its
 * `message_queued` row says it ({@link SessionStore.messagesWaitingIn}).
 */
export interface WaitingMessage {
  readonly messageId: string
  readonly kind: MailboxKind
  readonly text: string
  readonly attachments: readonly HandedPath[]
  readonly authorship: TurnAuthorship
  /** When it was held, epoch ms. */
  readonly at: number
  /**
   * ⚑ **D-016 · the piece a held brief or new brief delivers** — `QueuedMessageEvent.piece`, read off
   * the row, so the message rebuilt from it names its piece, its sender line says whose brief it is,
   * and a take-back or a close finds it. ⛔ Present only when the row names an id this app could have
   * minted.
   */
  readonly piece?: string
  /** ⚑ **D-016 · its label** — present only beside {@link piece}, and only when it is a label. */
  readonly label?: string
  /**
   * ⚑ **D-016 · the held words are a new brief of {@link piece}** (`update_work`), not the brief that
   * gave it — present only beside it.
   */
  readonly rebrief?: true
  /**
   * ⚑ **D-016 · commit 6 · R4 — the piece of this conversation's the held words drive**, off the row
   * — see `QueuedMessageEvent.drives`. ⛔ Present only when the row names an id this app could have
   * minted.
   */
  readonly drives?: string
  /**
   * ⚑ **F088 · the piece the held words name** — `QueuedMessageEvent.about`, off the row, so the
   * message rebuilt from it says which piece it is about. ⛔ Present only when the row names an id this
   * app could have minted.
   */
  readonly about?: string
  /** ⚑ **The question a held question's notice asks** — `QueuedMessageEvent.asks`. */
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
  /**
   * The effort last selected — at creation, by a person's change, by a give's choice, or by the
   * start that named one where none was recorded (D-042 · R1) — or null: nothing selected yet, or a
   * model that offers none. Never guessed.
   */
  reasoningEffort: string | null
  /**
   * The model last selected — written as {@link reasoningEffort} is — or null: nothing selected yet
   * (a row from before D-042 that has not started since, or an adopted one). Never guessed.
   */
  model: string | null
  /** Whether it was started in plan mode (030), or null for a row older than the column. */
  planMode: boolean | null
  /**
   * When the user gave that plan the go-ahead (060), or null while it is still planning. Only ever
   * meaningful alongside {@link planMode}: see the column's own comment for why the two are
   * separate facts rather than one flag.
   */
  planEndedAt: number | null
  /**
   * 🔴 **682 · when a PERSON last changed this conversation's model or its effort, or null — nobody
   * has** (`R31c`). ⚑ **D-042 · F1**: a give's choice then does not switch it — the person's pair
   * holds. See `provider_session.model_or_effort_set_by_a_person_at`.
   */
  modelOrEffortSetByAPersonAt: number | null
  /** ⚑ **D-042 · R5 — the model the provider last reported running**, or null — it has not said. */
  reportedModel: string | null
  /** ⚑ **D-042 · R5 — the effort the provider last reported**, or null — not reported. */
  reportedEffort: string | null
  /** When it was imported from a provider home, or null if this app ran it (087). */
  adoptedAt: number | null
  /** Whether there is a conversation to show on reopen — live, or imported (088). */
  hasTranscript: boolean
  /**
   * ⛔ **How this conversation's LAST turn ended** (222, from `220` finding 2) — or null when it has
   * never closed one.
   *
   * ## What it costs a person not to have it
   *
   * The Exploration Agent quit the app during a running shell command, reopened it, and read the
   * rail and the Sessions page *before* resuming anything. **Three closed threads, and every one of
   * them said the same word a clean finish gets.** The fact that a turn had been killed mid-flight
   * was in the ledger the whole time — one table down, in `turn.end_reason`, which 045 gave five
   * members precisely so this case would be recorded rather than back-filled. Nothing read it.
   *
   * ## ⚠️ It is about the TURN, and `status` is about the SESSION
   *
   * Session status says whether the conversation is over. The last turn's `completed`, `interrupted` or `unknown` reason separately says how its work ended.
   *
   * ⚑ **`unknown` is load-bearing and must not be smoothed away.** It means nobody observed the
   * ending: the app was killed, or 208 H3's case — the provider could not be confirmed stopped, so
   * the ending we recorded is *"we stopped waiting"* and not *"it stopped"*.
   */
  lastEnding: TurnEndReason | null
  /**
   * That another conversation spawned this one, and what the provider says about the descent (111),
   * or null for a row that is not a child.
   *
   * ⛔ **`111` added this to `RecordedSession` and to the library's entry, and NOT to this one —
   * so `toResumable` dropped it and the reopen list could not tell a sub-agent from a conversation
   * a person started.** That is `116` §5's headline defect: child identity was visible in the
   * Library and invisible to the one surface that offers a button. See {@link resumeRefusal}.
   */
  child: ChildDescent | null
  /**
   * Why Resume is not offered on this row, or null when it is (118).
   *
   * ⚠️ **A separate question from {@link SessionStore.unresumable}, and it has to be.** That list is
   * "there is nothing to resume FROM" — no provider ref, or a home we do not own. This row has a
   * perfectly good ref in a home we provision; what it does not have is an input end. Collapsing
   * the two would drop the row out of the reopen list altogether and take its export controls,
   * its profile and its recorded settings with it, for a conversation we hold in full.
   */
  resumeRefusal: string | null
  /**
   * 🔴 **Why there is no HOME to reopen this conversation into, or null when there is one** (214 §1).
   *
   * ⛔ **A fourth hand-written copy of this predicate is what made it necessary.** `resumable()`,
   * `unresumable()` and `recordedOf` each spelled out `!foundInUserHome(row)`; 214 unified those
   * three into {@link hasSomewhereToReopen} — and `RuntimeHost.reopenSession` had a FIFTH, written
   * as `row.adoptedAt !== null && row.profileId === null` at the boundary that actually starts a
   * provider. It was not extended for the restored origin, so a restored bundle whose `meta` carried
   * a profile passed it, a home that never held the transcript was provisioned, and the reopen came
   * back as the provider's *"unknown session"*. ⚑ **That is `194` M2 verbatim, closed in the two
   * list builders and open in the command** — which is exactly what `reopenSession`'s own comment
   * says a UI-only refusal cannot prevent.
   *
   * ⚠️ **The store's SENTENCE, not a flag**, following `resumeRefusal` beside it: the boundary shows
   * what the row says rather than composing its own, so the two cannot come to disagree about why.
   *
   * ⚑ **Always null on the reopen list**, because `resumable()` drops exactly the rows that have
   * one. It is reachable through {@link SessionStore.find}, which deliberately keeps returning these
   * rows so they stay readable and exportable — and which is how the command gets an id at all.
   */
  homeRefusal: string | null
  /**
   * Which of the two {@link homeRefusal} classes this row is — carried because the refusal a person
   * SEES is keyed by a reason code, not by this sentence (`session-unavailable.ts`), and the two
   * codes say opposite things about where the conversation came from.
   */
  restoredFromBundle: boolean
  /** When the session began — the provider's own time for an adopted one. */
  createdAt: number
  updatedAt: number
}

/**
 * ⛔ **What a RUNNING session's row is asked for, which is not what resume asks for** (172).
 *
 * {@link SessionStore.find} answers *"is there a row resume can use"*, and its first line drops any
 * row whose `external_ref` is null. `RuntimeHost.attachHeldSession` was using it to answer a
 * different question — *"what did we record about the session I am holding"* — and a Claude session
 * has no ref until its first turn's init. So for the whole of that first turn the host could not
 * hand a LIVE conversation back to the window that started it: measured, on my own instance, as an
 * `attachOpen()` that walked the slot and answered `[]`.
 *
 * Three fields, because three is what the hand-over reads. The ref is nullable here and that is the
 * point: a running session's ref is `session.handle.ref`, and this one is only the fallback for the
 * window before the provider has named the conversation.
 */
/**
 * 🔴 **One row a deadline says should be written, and when it fell due** (398).
 *
 * ⛔ **`at` is the DEADLINE and never the moment anybody looked**, which is the property that makes
 * *when we looked* invisible in the ledger — a question that ran out of time while nobody was
 * watching records the truth, and a look now and a look in an hour produce byte-identical rows.
 *
 * ⚠️ **There used to be a second one of these** (`WorkQuietDue`, 398) and HO-018 §2.2 withdrew the
 * criterion behind it; this is the only deadline left in the app.
 */
export interface LiveSessionRow {
  sessionId: string
  /** Null for rows written before profiles could be chosen — they ran in the default one. */
  profileId: string | null
  /** Null only for rows written before the column existed; never guessed. */
  approvalMode: 'ask' | 'auto' | null
  /** The parsed ref, or null while the provider has not named this conversation yet. */
  ref: ReturnType<typeof parseSessionRef> | null
  /**
   * ⚑ **D-017b · what its next start asks for** — the recorded model and effort, whatever the row's
   * ref: a conversation drawn from its ledger shows them, and a person may change them before its
   * next message. `null` is *nobody chose*, as on {@link ResumableSession}.
   */
  model: string | null
  reasoningEffort: string | null
}

/**
 * A conversation that already existed in a provider home, recorded so it can be reopened (087).
 *
 * Deliberately a different shape from {@link NewSessionRecord}: we did not run this session, so
 * there is no approval mode to record and no ordinal-zero to start from. Everything here was read
 * off the provider's own files.
 */
export interface AdoptedSessionRecord {
  id: string
  provider: Provider
  /** The provider's own id, which becomes the ref resume reattaches from. */
  sessionId: string
  cwd: string
  /**
   * The profile whose home it was found in, or **null when it was found in the user's own**
   * (046). Null is not "unknown": it is the statement that no home of ours holds this
   * conversation, which is what makes the row honestly unresumable rather than a pointer that
   * fails at reopen time. See `whyNotResumable`.
   */
  profileId: string | null
  /** When the provider last touched it — the row's updated time, not now. */
  updatedAt: number
  /** When the conversation began, as the provider records it. */
  createdAt: number
  /**
   * The rotation the ref carries (`external_ref`), which resume validates against. 0 unless a
   * bundle carried a different one.
   */
  rotation?: number
  /**
   * That the provider spawned this conversation from another one (111), as discovery read it.
   *
   * ⚠️ **Written at adoption because after adoption there is nowhere left to read it from.** The
   * descent lives in the provider's own state database beside the rollout file; the sweep exists
   * for the day that file is gone, and `109` measured what that costs today — *"an archived child
   * remains indistinguishable after its provider file disappears."*
   */
  child?: ChildDescent
}

/**
 * A recorded session that CANNOT be reopened, and why. It exists so the list can say so:
 * a session that quietly vanishes from the reopen list looks like the app lost it, which is
 * exactly the complaint this feature answers.
 */
export interface UnresumableSession {
  sessionId: string
  provider: Provider
  cwd: string
  status: SessionStatus
  profileId: string | null
  adoptedAt: number | null
  updatedAt: number
  /**
   * Whether opening it shows a conversation rather than an empty pane (088) — the same field
   * {@link ResumableSession} and {@link RecordedSession} already carry, off the same column.
   *
   * ⚑ **Added in 151, and the rail is why.** A row that cannot be reopened is offered READ instead
   * (118), and a row with neither is a control that can do nothing at all — `106`. The reopen list
   * could draw that distinction on its resumable half and not on this one, so every row here was
   * treated as unreadable whether or not we were holding its messages. It is the same
   * `has_events` read the other two shapes make; nothing new is queried for it.
   */
  hasTranscript: boolean
  /**
   * {@link foundInUserHome}'s answer, carried (154) — see the wire shape for why it travels
   * instead of being re-derived at the surface that acts on it.
   */
  foundInUserHome: boolean
  /**
   * {@link restoredFromBundle}'s answer, carried the same way (214 §1) — a conversation this app
   * did not run and whose provider has never held on this machine.
   */
  restoredFromBundle: boolean
  /**
   * How its last turn ended, or null (222) — see {@link ResumableSession.lastEnding}.
   *
   * ⚑ **On BOTH halves of the partition, and that is what makes it assertable.** A row that cannot
   * be reopened is exactly as likely to have been cut off mid-turn as one that can, and a field on
   * only the offerable half would have made "the two lists agree about the ending" true by there
   * being nothing to compare.
   */
  lastEnding: TurnEndReason | null
  /** Plain-language why, from the row itself — never a guess. */
  reason: string
}

/** ⚑ W4.179 — one row of {@link SessionStore.threadLeadRows}, as read: its fields unchecked. */
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

/**
 * One recorded session as the LIBRARY reads it (047): every row, whether or not it can be reopened,
 * carrying the provider's own id so a row can be matched against the file it came from.
 *
 * A third shape beside {@link ResumableSession} and {@link UnresumableSession} because the library
 * asks a question neither of them answers. Those two PARTITION the rows by "can this be reopened",
 * which is the reopen list's question; the library's question is "what do we hold", and it needs the
 * two halves in one list with the provider id on both. Narrowing `unresumable()` to carry a ref, or
 * widening `resumable()` to include rows it must never offer, would have made one list serve two
 * purposes — and the purpose that got it wrong would be the one that offers a Resume button.
 */
export interface RecordedSession {
  /** Our id for the row. */
  sessionId: string
  provider: Provider
  /**
   * The provider's own id, or null for a row that never got one (a Claude session closed before its
   * first turn). This is the key the library merges a row against a provider home on.
   */
  providerSessionId: string | null
  cwd: string
  status: SessionStatus
  profileId: string | null
  adoptedAt: number | null
  /** Whether opening it shows a conversation, rather than an empty pane (088). */
  hasTranscript: boolean
  /**
   * {@link foundInUserHome}'s answer, carried (154).
   *
   * ⚑ **The library had its own copy of this rule and now reads this instead.** `session-library.ts`
   * declared `fromUserHome(row)` with the same two-term body, to decide `origin: 'user-home' | 'ours'`
   * — the same question, asked a second time, a directory away from where its reason is written
   * down. `032`. There is one now, and it is the function below.
   */
  foundInUserHome: boolean
  /**
   * {@link restoredFromBundle}'s answer, carried (214 §1) — what the library turns into the
   * `restored` origin, so the chip and the refusal come from one reading of one column.
   */
  restoredFromBundle: boolean
  /**
   * Whether that conversation is COMPLETE, or null when it was recorded rather than derived (065).
   *
   * Separate from {@link hasTranscript} on purpose: the library was reading "there is a transcript"
   * as "there is the whole transcript", and those are the two facts 061 finding 6 says must stop
   * being one. See {@link DerivedState}.
   */
  derived: DerivedState | null
  /** How its last turn ended, or null (222) — see {@link ResumableSession.lastEnding}. */
  lastEnding: TurnEndReason | null
  createdAt: number
  updatedAt: number
  /** Why it cannot be reopened, or null when it can — the same answer the reopen list gives. */
  unresumableReason: string | null
  /**
   * ⚑ **D-017 · R10 — its provider never named it**: no provider id was ever recorded
   * (`external_ref` is null), so there is nothing a reopen could resume. ⚠️ Not a ref that stopped
   * parsing, which is a different fact (`whyNotResumable`'s own words for it).
   */
  neverStarted: boolean
  /**
   * The descent we recorded at adoption (111), or null for a row that is not a child — or one
   * recorded before the column existed. Deliberately the same value for both: see `childDescent`
   * on the schema.
   */
  child: ChildDescent | null
}

/**
 * Everything one imported conversation consists of: the row that says it existed, and the ledger the
 * app renders (051). One argument rather than several calls, because the point of it is that they
 * land together — see {@link SessionStore.importSnapshot}.
 */
export interface SessionSnapshot {
  session: AdoptedSessionRecord
  /** How many of the provider's lines the ledger was read from, as the bundle carried them. */
  derivedThrough: number
  /** The conversation, with the ordinals and times it was exported under. */
  ledger: { ordinal: number; event: TranscriptEvent; at: number }[]
}

export interface LedgerWindowQuery {
  /** How many turns to take, counting back. At least one is always taken when one exists. */
  turns: number
  /**
   * The ceiling on entries, whatever the turns cost. It is the bound that holds when a single turn
   * is enormous, which is the case a turn count alone cannot cover.
   */
  maxEvents: number
  /**
   * Take turns ending strictly BELOW this ordinal. Absent means "the newest" — the end of the
   * ledger. This is how paging backwards walks: each call passes the `from` the last one returned.
   */
  before?: number
}

/** One page of a session's ledger, and enough to ask for the page before it. */
export interface LedgerWindow {
  entries: PersistedEvent[]
  /**
   * The ordinal this page begins at. Pass it as the next call's `before` to get the page before
   * this one. Meaningless when `entries` is empty, and `hasOlder` is false there anyway.
   */
  from: number
  /** Whether any event exists below `from`. The cursor's "there is more", read rather than guessed. */
  hasOlder: boolean
  /**
   * Whether the page starts at a turn boundary. False when {@link LedgerWindowQuery.maxEvents} is
   * what cut, which means the page opens partway through somebody's turn — a fact the UI has to be
   * able to state rather than let the reader assume the conversation began there.
   */
  turnAligned: boolean
  /**
   * 🔴 **D-035 · the `tool_inventory` row in force at {@link from}** — the newest one below it.
   *
   * ⚑ The window names a give, a reply, a question or a request taken on by the tools the
   * conversation was handed, as it folds each call, and a provider states them once per start. So
   * a page that begins after that row would draw every such call as a plain tool line; this row is
   * folded ahead of the page instead. ⚠️ Absent when nothing precedes the page, or no inventory
   * does.
   */
  toolsInForce?: PersistedEvent
}

/** One recorded transcript entry, with the ordinal it was published under and when it happened. */
export interface PersistedEvent {
  ordinal: number
  /** The row's `created_at`: when the event happened, not when it was read back. */
  at: number
  event: TranscriptEvent
}

/**
 * 🔴 **One ledger row a digest read returns, with the conversation it came from** (438).
 *
 * ⛔ **`sessionId` is on the row and not on the query**, because {@link SessionStore.digestWindow}
 * asks about every placed conversation and gets back rows from many of them at once. ⚑ Every other event
 * read in this file is keyed to one session and can leave the id implicit; this is the first that
 * cannot, and it is the first for a second reason too — see the statement's own docblock.
 */
export interface DigestRow {
  readonly sessionId: string
  readonly ordinal: number
  /** The row's `created_at`: when the event happened, not when it was read back. */
  readonly at: number
  readonly event: TranscriptEvent
}

/** A ledger row as the database holds it, before its payload is parsed. */
export interface EventRow {
  ordinal: number
  payload: string
  created_at: number
}

/** ⚑ One row `selectQuestionsRaised` hands back — see `questionsRaisedInSession`. */
interface RaisedQuestionRow {
  move: string | null
  action: string | null
  id: string | null
  // ⛔ **602 · the row's OWN type**, which is the only thing that answers *what raised this*
  // — see {@link HowItWasRaised} for why it is not read off `piece`.
  type: string | null
  prompt: string | null
  questions: string | null
  piece: string | null
  passedUpFrom: string | null
  context: string | null
  ordinal: number
  readable: number
  /**
   * What JSON holds at each field, as `json_type` names it — `null` where the key is absent. A
   * field's value alone cannot say it: an object comes back as its JSON text, as a string would.
   */
  idIs: string | null
  promptIs: string | null
  questionsIs: string | null
  pieceIs: string | null
  passedUpFromIs: string | null
  contextIs: string | null
}

/**
 * Ledger rows → the entries a caller sees. ONE mapping, shared by the whole read and the windowed
 * one (053), because a window that decoded rows differently from the whole read would make an
 * export that streams differ from an export that does not — which is exactly the equivalence the
 * streaming export is verified against.
 *
 * Exported for the recovery window's history, which reads a restored copy without a store and must
 * read each row as this store does.
 */
export function toPersistedEvents(
  rows: EventRow[],
  noteSkip?: (ordinal: number) => void,
): PersistedEvent[] {
  return rows.flatMap((row) => {
    // A row we cannot parse is skipped rather than replayed as something else: a
    // transcript with a hole is honest, a transcript with a fabricated entry is not.
    try {
      return [
        {
          ordinal: row.ordinal,
          at: row.created_at,
          event: boundStoredEvent(JSON.parse(row.payload) as TranscriptEvent),
        },
      ]
    } catch (error) {
      // ⚠️ **A skip is silent to the READER by design and was silent to US by omission** (150,
      // ruling on 148 M4). An interior malformed row already shows up: the ordinals either side of
      // it do not meet and `reports a gap rather than pretending the conversation is whole` says so.
      // A leading, trailing, or only row leaves no gap to notice, so it vanishes indistinguishably
      // from a row that never existed — 086's visible-hole rule, unmet at exactly the edges.
      //
      // Rows are written from validated events, but a malformed row can still be skipped on read. The warning makes skipped edge rows diagnosable even when their position leaves no visible ordinal gap.
      //
      // What was NOT acceptable was leaving it undetectable to anyone at all. One warn costs
      // nothing, crosses no wire and adds no surface, and turns *"this can never be known to have
      // happened"* into *"the first occurrence is diagnosable"* — which is what makes the backlogged
      // item actionable if it ever fires.
      console.warn(
        `session ledger: ordinal ${row.ordinal} could not be read and was skipped ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      )
      // 🔴 **453 · and the skip is now COUNTABLE by a caller that has somewhere to put it.**
      // ⛔ The paragraph above backlogged the user-facing mark on the TRANSCRIPT and gave the
      // reason; a person's queue is a different bill — *"a summary may be scoped, a list of
      // obligations may not"* — so the three readers behind `LedgerWalk.rowsUnread` pass a counter
      // and everything else in this file goes on skipping silently, unchanged.
      noteSkip?.(row.ordinal)
      return []
    }
  })
}

/**
 * 🔴 **One row a STATEMENT could not read, handled the way {@link toPersistedEvents} handles one
 * JSON.parse could not** (671 · R18) — warned always, counted when the caller has somewhere to put
 * it.
 *
 * ⛔ **The statements that guard their payload in SQL** find a torn row without ever parsing it,
 * so the one warning this file gives for a skipped row would never fire for theirs. ⚑ This is that
 * warning and that note, spelled once for all of them (`671` wrote it for two; `676` routed the
 * rest of its guarded reads through it), so a torn row is never quieter for having been skipped by
 * SQL.
 */
function noteUnreadRow(
  sessionId: string,
  ordinal: number,
  noteSkip: ((ordinal: number) => void) | undefined,
  because = 'is not JSON',
): void {
  console.warn(
    `session ledger: ${sessionId} ordinal ${String(ordinal)} ${because} and was skipped by a guarded read`,
  )
  noteSkip?.(ordinal)
}

/**
 * 🔴 **One walk over candidate ledgers, saying what it walked** (453, HO-024 criterion 17's
 * *everything*).
 *
 * ⛔ **The counts are the QUERY's and never the result's.** `ledgers` is the candidate set's own
 * length — taken before a single ledger is folded — so it is an answer to *which conversations did
 * you read* rather than a restatement of how many rows came back. ⚑ `rows.length` can be zero with
 * `ledgers` at forty-seven, and the two sentences those support are different ones.
 *
 * ⚠️ **Shared by every reader that materialises its candidate list**, so the candidate set, the
 * fold and the counting are one derivation each — `questionsAPersonMustAnswer`' own *"the same candidate
 * set the sweep walks"* rule, extended to the fact about the walk. ⛔ **It said *all three of a
 * person's queue readers* until 467 added a fourth that is not a queue**, and 466 a fifth that
 * does not come through here at all: {@link SessionStore.digestWindow} counts its ledgers with a
 * `count(*)` because it never materialises them, so it builds its own {@link LedgerWalk}. ⚑ The
 * count is gone from this sentence rather than corrected, which is `458`'s rule — a number in
 * prose outlives the derivation that made it true.
 */
/**
 * 🔴 **The walk a LINEAGE reader answers when this app holds no conversation by that id** (543) —
 * one expression rather than a literal per reader, so two readers cannot answer this emptiness
 * differently.
 *
 * ⛔ **It is the lineage half's answer and never the work half's.** Parent and children are columns
 * of `provider_session`, and the work walks answer with their own words over the same id.
 */
function noSuchConversation<Row>(): LedgerWalk<Row> {
  return { rows: [], walk: 'no-such-conversation', ledgers: 0, rowsUnread: 0 }
}

/**
 * 🔴 **Where one node of the forest hangs, as a WORD** (637) — see {@link ForestParent}.
 *
 * ## ⛔ Three arms and each one is a different fact
 *
 * ⚑ **`null` is *no conversation of this app started it*** — its parent column is empty. ⚠️ It is
 * NOT *a person typed it*: {@link ForestParent}'s own docblock names the two rows that reach the
 * word and says what the app may claim about each.
 *
 * 🔴 **A parent NOT in {@link drawn} is *this reading did not draw it* and never *there is no such
 * conversation*.** ⛔ The FK on `parent_session_id` means the ROW exists, so the absence is always
 * about this answer and never about the ledger.
 *
 * ⚠️ **TWO things put a parent outside, and the first draft of this sentence named only one.**
 * ⛔ `MAX_FOREST_CONVERSATIONS` cutting the tail is one; **a parent this app never PLACED is the
 * other** — the FK proves the row exists and says nothing about it having an identity, and the
 * forest's candidate set is the placement JOIN. ⚑ The WORD is right for both and only the
 * explanation was narrow, which is `a-negative-is-only-as-strong-as-the-search-shape` pointed at a
 * docblock.
 *
 * ⚠️ **A pure function over a set, so it is testable without a database** — the fold that calls it
 * is not, which is why the decision is here rather than inline.
 */
export function underWhat(parent: string | null, drawn: ReadonlySet<string>): ForestParent {
  if (parent === null) return { is: 'the-person' }
  return drawn.has(parent)
    ? { is: 'a-conversation', conversation: parent }
    : { is: 'a-conversation-this-reading-did-not-draw', conversation: parent }
}

/**
 * 🔴 **The ledger rows ONE walk could not read — each counted ONCE, wherever it was met** (671 ·
 * R18, and `664` F4).
 *
 * ## ⛔ Why a SET, when {@link walkLedgers} counted with `+= 1` for eleven dispatches
 *
 * ⚠️ **A walk that folds each candidate once and reads nothing else meets each unreadable row
 * once.** ⛔ **A COMPOSED walk reads beyond its candidates** (since `603`/`664`, uncounted until
 * `671`): a wait
 * read opens the holder's routings and questions and the ledger of every conversation
 * the holder gave work to — so one torn row in a child's ledger is met by the forest's own fold of
 * that child AND by its parent's wait read. ⚑ Counted by `+= 1` that is one row reported as many;
 * keyed by the ledger and the row's place in it, it is one.
 *
 * ⚑ **The key is `(ledger, ordinal)` in the ledger's ACTIVE generation**, which is the generation
 * every fold in this file reads (`events.generation`'s rule: *a superseded projection's rows are
 * garbage, not history*). ⚠️ The scan that crosses generations — the routing scan (`676`) — notes
 * only the active one's torn rows for that reason; see `selectSessionsRoutingTo`.
 *
 * ⚠️ **A count, still, and never a cause** — {@link LedgerWalk.rowsUnread}'s own rule.
 */
export interface RowsUnread {
  /** ⚑ The skip note for ONE ledger — see {@link SkipNote}. */
  in(sessionId: string): SkipNote
  /** How many distinct rows have been noted. */
  readonly count: number
  /** ⚑ **D-017 · R8** — how many distinct ledgers were skipped whole. */
  readonly ledgersSkipped: number
}

/** ⚑ **D-017 · R8** — what a skip note is handed for a ledger whose fold threw. */
const THE_WHOLE_LEDGER = 'the-whole-ledger'

/**
 * ⚑ **The skip note for ONE ledger** — the `(ordinal) => void` every fold here takes, and since
 * D-017 {@link THE_WHOLE_LEDGER} when a fold over that ledger threw.
 */
export type SkipNote = (ordinal: number | typeof THE_WHOLE_LEDGER) => void

/**
 * ⚑ **F033 · one piece a conversation holds, as much as naming it reads** — a fold's row less its
 * brief, which a name never reads and a memo must not keep. ⚑ **F009 · and as much as an agent's
 * record reads** ({@link SessionStore.newestPiecesHeldIn}): who gave it and when, and its outcome.
 */
type PieceForAName = Pick<
  PieceRow,
  'piece' | 'label' | 'title' | 'owner' | 'giver' | 'givenAt' | 'state' | 'outcome' | 'endedAt'
>

/**
 * ⚑ **F009 · one piece as an agent's record says it** — its label and the title it stands under now,
 * the conversation holding it, who gave it and when, and how it stands: open, or how and when it
 * ended, with its outcome once answered. ⛔ An openness and an ending, never an open state: the
 * fold's own word for an open piece is not the word `list_tasks` composes, so a reader says *open*.
 */
export type PieceHeld = PieceForAName

/** ⚑ **A fresh {@link RowsUnread}, for one walk or one answer** — never shared across two. */
export function rowsUnreadOnce(): RowsUnread {
  const seen = new Set<string>()
  const skipped = new Set<string>()
  return {
    // ⚠️ **A NUL between the two halves**, so no conversation id and ordinal can spell another's.
    in: (sessionId) => (ordinal) => {
      if (ordinal === THE_WHOLE_LEDGER) {
        skipped.add(sessionId)
        return
      }
      seen.add(`${sessionId}\u0000${String(ordinal)}`)
    },
    get count() {
      return seen.size
    },
    get ledgersSkipped() {
      return skipped.size
    },
  }
}

/**
 * 🔴 **D-017 · R8 — one bad row never stops the app.** A ledger that throws is skipped, warned
 * with its id and the reason, and noted whole against the ledger that was READ, so a bad ledger is
 * named once and never blamed on whoever read it.
 */
export function skipTheLedger(
  sessionId: string,
  error: unknown,
  noteSkip: SkipNote | undefined,
): void {
  console.warn(
    `session ledger: ${sessionId} could not be read and was skipped ` +
      `(${error instanceof Error ? error.message : String(error)})`,
  )
  noteSkip?.(THE_WHOLE_LEDGER)
}

/**
 * ⚑ **D-017 · R8 — one ledger's fold, or `nothing` when it throws** ({@link skipTheLedger}).
 *
 * ⛔ **Only for a caller with a note to put the skip in** — a read that reports what it could not
 * read. A caller with none (a door that writes, a notice about one piece) gets the throw: an empty
 * fold there would answer a false *no such piece*.
 */
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

/**
 * ⚑ **D-017 · R8 — each row built, or skipped when building it throws** — {@link readOrSkip} per
 * row, keyed by the record the row's `key` names.
 */
export function eachOrSkipped<K extends string, Row extends Readonly<Record<K, string>>, Built>(
  rows: readonly Row[],
  key: K,
  unread: RowsUnread,
  build: (row: Row) => Built,
): Built[] {
  return rows.flatMap((row) => readOrSkip(row[key], unread.in(row[key]), [], () => [build(row)]))
}

/** ⚑ **D-017 · R8** — {@link LedgerWalk.ledgersSkipped}, present only when some were skipped. */
export function ledgersSkippedOf(count: number | undefined): { readonly ledgersSkipped?: number } {
  return count !== undefined && count > 0 ? { ledgersSkipped: count } : {}
}

function walkLedgers<Row, Candidate extends { id: string }>(
  walk: LedgerWalkKind,
  candidates: readonly Candidate[],
  /**
   * ⚑ **467 · the candidate itself is handed back as a THIRD argument**, for a fold whose row is
   * partly the candidate query's own columns. ⛔ It is third rather than first so the three folds
   * that take `(sessionId, noteSkip)` are still passed by name and unchanged — `453`'s call sites
   * are the pinned ones, and a reshuffle here would have rewritten them to say the same thing.
   */
  foldOne: (sessionId: string, noteSkip: SkipNote, candidate: Candidate) => readonly Row[],
  /**
   * 🔴 **671 · where the walk writes down what it could not read** — see {@link RowsUnread}.
   * ⚑ Handed in by a COMPOSED walk, which hands the same one to its wait reads so a row met twice
   * is one row; every other walk takes a fresh one and counts exactly what it did before.
   */
  unread: RowsUnread = rowsUnreadOnce(),
): LedgerWalk<Row> {
  const rows = candidates.flatMap((candidate) => {
    const noteSkip = unread.in(candidate.id)
    // 🔴 **D-017 · R8 — the outer net**: whatever else throws in one candidate's fold skips it.
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

/**
 * ⚑ **One conversation this one gave work to** (508) — the named shape {@link walkWorkGivenBy}
 * folds, read off `work` (D-016).
 *
 * ⛔ **`identity` is nullable because its join is LEFT**: an owner this app holds no identity for
 * was still given the work, and the row must survive with `identity` null rather than vanish from
 * a list whose whole subject is *what did I hand out*.
 */
interface GivenWorkRow {
  readonly id: string
  readonly identity: string | null
}

/** ⚑ **One conversation's provider and identity as `better-sqlite3` hands them back** (543). */
interface BindingRow {
  readonly provider: string
  readonly identity: string | null
}

/**
 * ⚑ **One recorded child as `better-sqlite3` hands it back** (543) — the named shape
 * {@link SessionStore.spawnedBy} maps, so the SELECT and its reader cannot quietly disagree about
 * which columns are there.
 */
interface SpawnedSessionRow {
  readonly id: string
  readonly provider: string
  readonly identity: string | null
}

/**
 * ⚑ **One node of the forest as `better-sqlite3` hands it back** (637) — the named shape
 * {@link SessionStore.everyPlacedConversation} maps, so the SELECT and its reader cannot quietly
 * disagree about which columns are there.
 *
 * ⛔ **`profile_slug` is NOT nullable here and is nullable on {@link SpawnedSessionRow}**, whose
 * query LEFT-joins the identity. ⚑ Here the join is INNER, so a conversation with no identity is
 * not selected at all, and {@link SessionStore.conversationsHeldByNoAgent} counts it instead.
 */
interface ForestSessionRow {
  readonly id: string
  readonly profile_slug: string
  readonly provider: string
  readonly status: string
  readonly created_at: number
  readonly updated_at: number
  readonly parent_session_id: string | null
}

/** ⚑ **D-016 · a `work` row as `better-sqlite3` hands it back** — {@link WORK_COLUMNS}, in order. */
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

/** ⚑ **D-016 · a `work_resource` row as `better-sqlite3` hands it back** — {@link RESOURCE_COLUMNS}. */
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

/** ⚑ **D-026 · a `work_resource` row with its adder's identity** — {@link KEPT_FILE_COLUMNS}. */
interface KeptFileDbRow extends ResourceDbRow {
  readonly added_by_identity: string | null
}
/**
 * ⚑ **D-026 · a kept file's columns and its adder's identity**, so the SELECT and
 * {@link KeptFileDbRow} cannot disagree — `identityOfSession`'s join, asked per row by two primary
 * keys. ⚠️ A scalar subquery and not a join, so {@link RESOURCE_COLUMNS} stays unprefixed.
 */
const KEPT_FILE_COLUMNS = `${RESOURCE_COLUMNS},
  (SELECT identity.slug FROM provider_session s
     JOIN agent_identity identity ON identity.id = s.agent_identity_id
    WHERE s.id = work_resource.added_by_session_id) AS added_by_identity`

/**
 * ⚑ **D-026 · a tree's pieces** — those `@holder` holds and those any of `@givers` (one JSON array,
 * read with `json_each`) gave (`work_owner_idx`, `work_given_by_idx`, one MULTI-INDEX OR), and every
 * piece under them (`work_parent_number_uq`). ⛔ **`UNION`, never `UNION ALL`**: a piece met twice —
 * held, and under one it gave — is one piece, and a chain edited by hand into a cycle ends the walk
 * instead of looping. ⚑ One walk, for the whole tree a window lists and for the pages an agent reads
 * (D-037).
 */
const HELD_UNDER = `WITH RECURSIVE held(id) AS (
           SELECT id FROM work
            WHERE owner_session_id = @holder OR given_by_session_id IN (SELECT value FROM json_each(@givers))
           UNION
           SELECT w.id FROM work w JOIN held h ON w.parent_id = h.id
         )`

/**
 * ⚑ **D-037 · the files kept before the one `@from` names** — by the row's place in `work_resource`,
 * the order this app kept them in — or every one, when `@from` is NULL. ⚑ One range on the rowid,
 * so SQLite reads it from the end and stops at the `LIMIT`.
 */
const KEPT_BEFORE = `rowid < coalesce((SELECT rowid FROM work_resource WHERE id = @from), 9223372036854775807)`

/**
 * ⚑ **D-016 · the most rows a walk up `parent_id` may meet** — a root, a piece taken on under it,
 * and the pieces given below. ⛔ No give can place a piece deeper than the widest `max_depth` a
 * person may grant ({@link MAX_CAPABILITY_COUNT}), counted from the work a person gave (`depthOf`),
 * so a longer chain is a database edited by hand.
 */
const MAX_WORK_DEPTH_WALKED = MAX_CAPABILITY_COUNT + 2

/**
 * ⚑ **D-026 · two pieces in label order, by the numbers their labels are made of** — one level at a
 * time, and a shorter prefix first, so `W1` comes before `W1.2`, `W1.2` before `W1.10`, and `W1.9.3`
 * before `W2`.
 */
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

/**
 * The most rows of each kind a conversation's scheduling evidence is built from — the receipts of
 * the calls that make and cancel jobs, its provider's levels, and its launches and life endings —
 * the newest of each. ⚑ Each kind is counted apart, so neither levels nor other scheduling calls
 * push a job's receipt out.
 */
export const MAX_SCHEDULE_EVIDENCE_ROWS = 2_000

/**
 * The most rows of a conversation the read of its scheduling evidence uses: its newest rows of the
 * kinds the folds read, whatever it holds. ⚑ The read walks one row more, to tell whether there is
 * more, and no further: its cost is bounded by this, never by the conversation's length. One that
 * holds more has its history cut, and the read says so.
 */
export const MAX_SCHEDULE_HISTORY_WALKED = 20_000

/** What {@link SessionStore.scheduleEvidenceRows} gives. */
export interface ScheduleEvidenceRead {
  /** The rows, oldest first. */
  readonly rows: readonly ScheduleEvidenceRow[]
  /**
   * Whether the conversation holds scheduling history older than these rows: the walk reached its
   * bound, or a kind its cap. ⚑ A job made before them is then known only from where a row here
   * still lists it, and nothing here says when it was made.
   */
  readonly cut: boolean
}

/**
 * One ledger row a conversation's scheduling evidence is built from, its payload parsed. ⚑ Its
 * moment and ordinal name it: they are the same when the row is taken as it is appended and when
 * it is read back later, so the evidence a restart rebuilds is the evidence the run before held.
 */
export interface ScheduleEvidenceRow {
  readonly ordinal: number
  /** When it was appended, epoch ms. */
  readonly at: number
  /** The row's type, as the ledger names it. */
  readonly rowType: string
  readonly payload: unknown
}

export interface SessionStore extends OwnNotesStore {
  piecesWithTheirWaits(owner: string, unread: RowsUnread): readonly PieceRow[]
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
  /**
   * Record a session the moment it starts, before anything it emits can arrive — and, when no
   * conversation started it, its ROOT in the same transaction (D-016): the work a person gave it,
   * numbered among the roots, untitled until its owner names it.
   */
  create(record: NewSessionRecord): void
  /**
   * A service's one conversation, recorded with nothing launched, launched for the first time under
   * its own id: what that launch runs on, as {@link create} records it for a new one. ⛔ Only a row
   * its provider never named: `false` for any other, and nothing is written.
   */
  firstLaunchOf(
    record: Pick<NewSessionRecord, 'id' | 'model' | 'reasoningEffort' | 'planMode' | 'launchedAs'>,
  ): boolean
  /**
   * Whether a launch of `sessionId` asked its provider for an id (`launched_as`) that its provider
   * never named back: a launch cut before its first answer, which may have left a record under that id.
   */
  aLaunchWentUnnamed(sessionId: string): boolean
  /**
   * Record a pointer to a conversation that already existed in a provider home (087) — with its
   * root, in the same transaction: an adopted conversation has no parent here (D-016).
   */
  adopt(record: AdoptedSessionRecord): void
  /**
   * The agent identity behind a session id (204, 369) — `agent_identity.slug`, through
   * `provider_session.agent_identity_id` — or null when it has none.
   *
   * Null is the user's-own-home row: swept out of `~/.claude` / `~/.codex`, attributed to no agent
   * of ours on purpose. See `provider_session.agentIdentityId`.
   *
   * ⚠️ **It is ALSO null for a session id that does not exist, and those are two facts sharing one
   * value.** Named rather than hidden: every caller today holds an id it has just written, so
   * nothing can currently tell the difference and nothing needs to. A caller that does should get a
   * shape that says which, rather than a second reading of this one.
   *
   * ⛔ **`profileSlug` is the identity's CANONICAL name — folded — and it is not a path** (238). A
   * session recorded under `Developer` answers `developer` here, because that is the one identity
   * the two spellings share. ⚠️ **A caller that needs the DIRECTORY must read
   * `provider_session.profile_id`** (through `find`/`findLive`), which keeps the exact spelling the
   * session ran under; every path derivation in the host already does. On a case-sensitive volume
   * those two can differ, and preferring this one would open a home the conversation never used.
   */
  identityOf(sessionId: string): {
    profileSlug: string
  } | null
  /**
   * 🔴 **What this identity may do, resolved — or NULL when there is no such identity** (341).
   *
   * ⛔ **The null is HO-005 criterion 12 and is the whole reason this returns one.** *"An unknown
   * profile slug is REFUSED, never created — a typo is not a mis-named agent, it is a new durable
   * identity with an empty memory and its own provider home."* One read answers both questions a
   * give has to ask about its agent — *does this exist* and *what may it do* — so no caller can
   * answer the second without having asked the first.
   *
   * ⚠️ **The row, not the directory.** `RuntimeHost.profiles()` lists folders, and a folder can
   * exist for a launch that was refused before it ever registered. An identity exists when the
   * database says so, which is after a session has actually run as it.
   */
  capabilitiesOf(profileSlug: string): ProfileCapabilities | null
  /**
   * 🔴 **Every identity a person could grant something to, with what each one holds** (355).
   *
   * ⛔ **Rows, and the distinction from `RuntimeHost.profiles()` is the whole reason this exists.**
   * That lists DIRECTORIES under `provider-homes/`, and a directory can exist for a launch that was
   * refused before it ever registered. {@link setCapabilities} answers `false` for every one of
   * those, so a picker built off folders would offer identities this door refuses — which is
   * criterion 12 turned into a UI defect.
   *
   * ⚑ **Each identity carries both readings**: `capabilities` is what the RAILS see, resolved;
   * `chosen` says, per field, whether the column is NULL or holds something. A surface needs the
   * second to avoid turning *"has not chosen"* into *"chose today's default"* the first time
   * somebody presses Save.
   *
   * ⚠️ **Reading this creates nothing.** No `INSERT OR IGNORE`, no row for a slug that has never
   * run — looking at the list of identities may not bring one into being.
   *
   * 🔴 **No project, and its absence is 369's ruling rather than a tidy-up.** The parameter was
   * never a choice a caller made: `assertThePinnedProject` threw for every value but one, while the
   * write beside it keyed on the constant regardless — *"a silent write into the wrong row, reported
   * as there is nothing here"*. An identity is global, so the list of identities is.
   */
  agentIdentities(): readonly AgentIdentity[]
  /** The naming columns of one identity, without capabilities or grants. */
  agentIdentityNameById(id: string): AgentIdentityName | null
  reconciliationNames(
    conversations: readonly string[],
  ): readonly (AgentIdentityName & { conversation: string })[]
  /**
   * 🔴 **Bring an identity into existence, or answer null because the name is taken** (419,
   * HO-023 §2.4) — the row both creation doors write, and the only writer of `agent_identity` that
   * is not a launch.
   *
   * ⛔ **Null is *that name is taken*, and it is the ONLY reason this answers null.** A caller turns
   * it into a sentence naming the folded slug; the store does not build prose. ⚠️ Compare
   * {@link setCapabilities}' `false`, which is the opposite fact one door over — *there is no such
   * identity to configure* — and criterion 12 is what makes the two different answers necessary:
   * configuring may not create, and creating may not adopt.
   *
   * ⛔ **It writes NO home and NO conversation.** An identity is a name; its home folder is laid
   * down by its first launch, under `HOME_FOLDER` like every other home (`provider-homes.ts`).
   *
   * ⚠️ **618 · *an identity is a name* is this METHOD's claim and not the app's** (`HO-078` §4).
   * `RuntimeHost.createAgentFor` writes an `identity_instruction` row beside the one this writes,
   * in the same synchronous stretch, when the creating agent sent rules — ⛔ **this statement is
   * still the only thing that mints the identity ROW**, which is what the paragraph above is about.
   */
  createAgentIdentity(said: NewAgent, broughtIntoBeingBy: IdentityCreator): AgentIdentity | null
  /**
   * ⚑ **Which provider this identity's NEXT conversation runs on, or null — nobody has said** (419,
   * HO-023 §3).
   *
   * ⛔ **A default a give that starts a conversation consults, never a setting on a live
   * conversation.** `417` measured
   * why it cannot be the second thing: `provider` is the only required field of
   * `CreateSessionInput`, no `UPDATE provider_session` sets it, `createRuntime` returns a different
   * class per provider, and `external_ref` holds the old provider's thread id.
   *
   * ⚠️ **Null for an identity that has never been created through the creation door**, including
   * every identity that exists today — a launch writes nothing here, because the provider a started
   * conversation happened to use is an accident rather than a preference.
   */
  providerOf(profileSlug: string): Provider | null
  /**
   * How many of this identity's conversations started on each provider: those its provider named a
   * thread for, which a conversation that never started has not.
   */
  startedOnOf(profileSlug: string): StartedOn
  /**
   * Save this identity's provider when none is saved, and answer whether it was written. Never over
   * a provider somebody saved, and its default model stays as it is.
   */
  saveProviderIfNoneIsSaved(profileSlug: string, provider: Provider): boolean
  /**
   * **Change one profile's capabilities**, and answer whether there was a row to change.
   *
   * ⛔ **It REFUSES to create the row, and that is criterion 12 from the other side.** Granting a
   * capability to a name nothing has ever run as would create the identity by configuring it — the
   * exact act give refuses unless its caller asked for a new agent by name (`no-such-profile`),
   * arriving through the door that writes the rule. So a person may only change an identity that
   * already exists.
   *
   * ⚠️ **There is no wire door onto this and 341 deliberately built none.** No IPC command, no tool.
   * `the-rails-before-anything-can-reach-them.test.ts` asserts that, so the surface that eventually
   * edits capabilities arrives as a deliberate act rather than as a consequence.
   */
  setCapabilities(
    profileSlug: string,
    edit: CapabilityEdit,
    externalMcpServerIds?: readonly string[],
  ): boolean
  /**
   * 🔴 **Every version of one identity's own instructions — the `configured` layer** (582,
   * `HO-009` §2). Newest first.
   *
   * ⛔ **An identity with no row and one nobody has written rules for answer the SAME `[]`**, and
   * that is deliberate rather than a gap: this is a READ, and criterion 12's *a person may not
   * configure an identity into existence* is enforced on the WRITE, one method down, where there is
   * something to refuse. ⚠️ A surface asking about a slug that does not exist is asking a question
   * with an honest empty answer.
   */
  ownInstructionsOf(profileSlug: string): OwnInstructions
  /**
   * 🔴 **What `composeProfileBundle` is handed for this launch, or `null`** — the seam, fed.
   *
   * ⛔ **Its own statement rather than {@link SessionStore.ownInstructionsOf} read at index 0**,
   * because this is on the launch path and a launch must not pay for a history it will not render.
   * ⚑ The two agree by construction: both order by `version`, which is what `whatIsInForce` defines
   * *in force* as.
   *
   * ⚠️ **Blank text answers `null`**, through `configuredLayerOf`, so the ONE place that decides
   * whether a launch has a configured layer is the shared fold and not a `trim()` in two files.
   */
  configuredLayerFor(profileSlug: string): string | null
  /**
   * 🔴 **Append one version. Answers what was written, or `null` when the identity has no row.**
   *
   * ## ⛔ `null` is criterion 12 arriving at this door, and it is the same shape as
   * {@link SessionStore.setCapabilities}' `false`
   *
   * ⚠️ **A slug with no `agent_identity` row writes nothing and says so.** ⛔ Writing the version
   * anyway would let a person — or an agent's relay — bring an identity into existence by giving it
   * a rule, which is the one act `341` built the whole creation door to keep deliberate.
   *
   * ## ⚑ The version number is allocated HERE, inside the transaction that writes it
   *
   * ⛔ **`MAX(version) + 1`, and it is safe only because nothing deletes** — see
   * `identity_instruction`'s own note. ⚠️ The derived id is what makes a lost race RAISE instead of
   * quietly overwriting: two writers that compute the same number collide on the primary key.
   */
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
  /**
   * 🔴 **Every amendment a PERSON has made to one identity's memory, newest first** (625,
   * `EXT-015` §3.3).
   *
   * ⛔ **An identity with no row and one nobody has amended answer the SAME `[]`**, which is
   * {@link SessionStore.ownInstructionsOf}' own contract one method up and for its reason: this is
   * a READ, and criterion 12 is enforced on the write where there is something to refuse.
   */
  memoryAmendmentsOf(profileSlug: string): readonly MemoryAmendment[]
  /**
   * 🔴 **Record one amendment. Answers what was written, or `null` when the identity has no row.**
   *
   * ⛔ **`null` is criterion 12 arriving at this door**, exactly as
   * {@link SessionStore.writeOwnInstructions}' is — a person may not bring an identity into
   * existence by editing memory it does not have.
   *
   * ## ⚠️ It is written AFTER the file has changed, and that ordering is a decision
   *
   * ⛔ **The act is a filesystem act and it is not transactional with this row.** So one of the two
   * orders has to be chosen, and each fails differently: a row written FIRST can describe a removal
   * that never happened, and a row written SECOND can miss one that did. ⚑ **The second is the only
   * survivable one** — a missing record is a person looking at a store that is short an entry with
   * nothing to say why, which is recoverable by looking; a record of a removal that did not happen
   * would tell somebody their memory is gone while the agent goes on reading it, which is
   * criterion 18 written into the durable record.
   *
   * ## ⛔ The sequence is allocated HERE, inside the transaction that writes it
   *
   * ⚑ `writeOwnInstructions`' own shape and for its reason: the derived id makes a lost race RAISE
   * rather than quietly overwrite.
   */
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
  /**
   * 🔴 **Every ask an agent has made against anybody's instructions that nobody has answered**
   * (582) — oldest first, across every conversation.
   *
   * ⛔ **`open` means *nothing has ended it in the ledger*, not *somebody is still waiting***, which
   * is `deriveRoutedRequests`' caveat and it applies here for its reason: an ask parks nobody, so
   * it stays in front of a person, whatever became of the conversation that made it, until they
   * decide it or save their own rules.
   */
  instructionAsksWaiting(): readonly InstructionAskWaiting[]
  /**
   * ⛔ **End one ask, by appending into the ledger of the conversation that made it.** `false` when
   * there was nothing waiting by that name — a second press, or an ask another host has already
   * settled.
   */
  settleInstructionAsk(askId: string, ending: InstructionEnding, by: ActedBy, at: number): boolean
  /** Every MCP server request no ending names yet, oldest first, across every conversation. */
  mcpServerRequestsWaiting(): readonly McpServerRequestWaiting[]
  /** Whether a request by this id was ever made, waiting or settled. */
  mcpServerRequestWasMade(requestId: string): boolean
  /**
   * Grant a registered server to these agents, adding to the grants they hold and never replacing
   * them. Answers which agents got it and which no longer exist, or `null` when no server by that
   * name is registered.
   */
  grantExternalMcpServer(
    serverName: string,
    profileSlugs: readonly string[],
  ): { readonly granted: readonly string[]; readonly missing: readonly string[] } | null
  /**
   * 🔴 **Every external MCP server a person has registered** (516) — oldest first, the order they
   * were added in.
   *
   * ⛔ **A registration grants nobody**, which is the whole shape HO-040 §4.2 ruled: the rows here
   * say what a person configured, and {@link SessionStore.setCapabilities}' third argument is the
   * only thing that lets an identity reach one.
   *
   * ⚠️ **Empty is a real answer and the normal one.** The table is created empty and nothing seeds
   * it — there is no built-in `brobot` row, because BroBot2's own in-process server is product
   * plumbing with no URL to store (`507` §2.3).
   */
  externalMcpServers(): readonly ExternalMcpServerRow[]
  /**
   * 🔴 **Register one server, or answer null because that name is taken** (516).
   *
   * ⛔ **Null is *that name is taken*, and it is the ONLY reason this answers null** —
   * {@link SessionStore.createAgentIdentity}'s rule one table over. A caller turns it into a
   * sentence naming the folded name; the store does not build prose.
   *
   * ⚠️ **It validates NOTHING about the name or the URL.** Those are the door's rules and they need
   * `AGENT_TOOL_SERVER` and `TOOL_NAMES`, which this file cannot see — `RuntimeHost.registerExternalMcpServer`
   * owns them, together with the tool-roster preflight that is the actual refusal rail.
   */
  registerExternalMcpServer(said: {
    name: string
    url: string
    /**
     * ⛔ **Required, never defaulted here** (524). The DEFAULT belongs to the registration FORM,
     * where a person can see it and change it; a `?? 'everyone'` in the store would be a second
     * place the ruling lives, free to disagree with the control the day either moves — and the half
     * that drifts is always the one that decides who reaches a tool server.
     */
    reach: ExternalMcpServerReach
  }): ExternalMcpServerRow | null
  /**
   * **Remove one registered server**, and answer whether there was a row to remove.
   *
   * ⛔ **Every grant naming it goes with it, by CASCADE** — see {@link EXTERNAL_MCP_REMOVAL_MEANS},
   * which is the sentence a person reads BEFORE the press, because the immutable URL makes
   * remove-and-add the only way to change an address.
   */
  removeExternalMcpServer(serverId: string): boolean
  /**
   * 🔴 **The servers one identity may use, as a LAUNCH resolves them** (516, widened by 524) — rows,
   * not ids, because an adapter needs a name and a URL.
   *
   * Include servers available to everyone and servers granted to this identity. {@link AgentIdentity.externalMcpServerIds} lists explicit grants only, so an identity with no grants can still resolve shared servers.
   *
   * ⛔ **It takes a SLUG and not an existence question.** An identity nothing has ever run as holds
   * no grants — but it is still an identity, so it resolves to every available-to-all server, the
   * same as one that exists. ⚑ That is deliberate and it is `HO-048` §1's *default belongs to the
   * server*: `capabilitiesOf` is where existence is decided (criterion 12), and a second answer here
   * would be a second place for it to be decided.
   */
  externalMcpServersFor(profileSlug: string): readonly ExternalMcpServerRow[]
  /**
   * **Say which provider this identity's NEXT conversation starts on**, and answer whether there
   * was a row to say it about (433, HO-024 §2.1/§2.2).
   *
   * ⛔ **`null` is *nobody has said*, written back into the column**, which is the gesture that
   * makes a choice reversible — {@link setCapabilities}' *use the default*, one column over. The
   * app's fallback then answers, and the two facts stay distinguishable: a person who cleared a
   * choice has not chosen the fallback's value.
   *
   * ⛔ **It REFUSES to create the row**, for {@link setCapabilities}' reason and criterion 12's: a
   * name nothing has ever run as is not a thing to configure into existence.
   *
   * ⚠️ **It writes `agent_identity` and reaches no conversation, running or recorded.** A session
   * takes its provider at launch and keeps it (`417`, `427`), which is what makes *the same
   * identity on Codex in one project and Claude in another* — HO-024 §2.1's restored case —
   * possible at all.
   */
  setAgentProvider(profileSlug: string, provider: Provider | null): boolean
  /**
   * 🔴 **Correct what this identity is CALLED, and answer whether there was a row to correct**
   * (558, `HO-063` gap 2).
   *
   * ⛔ **The second writer of the column, and the reason `538`'s refusal no longer binds.** `538`
   * declined to invent a display name on two measurements, and the second was *"`display_name` has
   * exactly one writer and no rename, so an invented word would be permanent and uncorrectable"*.
   * ⚑ This is the statement that retires the second half of that sentence: a name written by
   * anybody — a person, a seed, an agent's `create_agent` — can now be corrected by a person.
   *
   * 🔴 **`HO-016` §2 still governs and this is on the right side of it.** *The app may seed a
   * default at creation; it never re-grants what a person removed.* ⚠️ The app's writers are both
   * `INSERT OR IGNORE`, so neither can land on top of a rename; this one is reached only by a
   * person's verb. ⛔ **So a rename is never overwritten**, and that is a property of the two
   * statement shapes rather than of a rule anybody has to remember.
   *
   * ⚠️ **`null` is *nobody has named this*, written back into the column**, which is the gesture
   * that makes a name reversible — {@link setAgentProvider}'s own shape one column over. A blank
   * string folds to it.
   *
   * ⛔ **It REFUSES to create the row**, for {@link setCapabilities}' reason and criterion 12's.
   */
  setAgentDisplayName(profileSlug: string, displayName: string | null): boolean
  /**
   * 🔴 **D-042 · R2 — this identity's DEFAULT model and effort, or null — it has none** (677's
   * column): what its new conversations start on.
   *
   * ⚠️ **`undefined` and `null` collapse to one answer, {@link providerOf}'s argument exactly**: an
   * identity that does not exist has no default, and existence is `capabilitiesOf`'s question.
   *
   * ⛔ **An unreadable value folds to null** — see `parseModelChoice`. Every writer writes a pair a
   * list judged, or NULL, so what reaches the fold unreadable is a hand-edit or an older value.
   */
  modelChoiceOf(profileSlug: string): AgentModelChoice | null
  /**
   * 🔴 **Write an identity's default, or clear it with `null`, and answer whether there was a row**
   * (677; D-042 · R2).
   *
   * ⛔ **It REFUSES to create the row**, for {@link setCapabilities}' reason and criterion 12's.
   * ⚠️ **It reaches no conversation**: each keeps its own selected pair. ⚑ **It validates nothing
   * itself** — its writers asked the list first: a person's sheet, a person's change to one of its
   * conversations, and `create_agent`.
   */
  setModelChoice(profileSlug: string, choice: AgentModelChoice | null): boolean
  /**
   * 🔴 **D-042 · R3 — the models a person added by hand to one provider's list**, in the order added;
   * `[]` when none.
   */
  handAddedModels(provider: Provider): readonly string[]
  /**
   * ⚑ **D-042 · add a model to a provider's list by hand** — answers the hand-added models after it.
   * ⛔ Checked against nothing (R3: no test call, nothing spent); a model already there is not added
   * twice.
   */
  addHandAddedModel(provider: Provider, model: string, at: number): readonly string[]
  /** ⚑ **D-042 · take a hand-added model off the list** — answers the hand-added models after it. */
  deleteHandAddedModel(provider: Provider, model: string, at: number): readonly string[]
  /** 🔴 **D-042 · R2 — the model and effort a person last picked on this provider**, or null. */
  lastPicked(provider: Provider): ModelAndEffort | null
  /**
   * ⚑ **D-042 · R2 — a person picked this pair on this provider** — a setting they changed, an agent's
   * sheet, or a conversation they started naming a model. ⛔ A person's act only: no agent writes it.
   */
  aPersonPicked(provider: Provider, pair: ModelAndEffort, at: number): void
  /**
   * 🔒 **The API key a person entered for a provider, still SEALED** — `safeStorage`'s ciphertext as
   * base64 — and when it was saved, or null when none is set. ⛔ Never the key: only `api-keys.ts`
   * opens it, to hand it to a launch.
   */
  keptApiKey(provider: Provider): { readonly sealed: string; readonly setAt: number } | null
  /** 🔒 Keep a provider's sealed API key, replacing any before it. A person's act only. */
  keepSealedApiKey(provider: Provider, sealed: string, at: number): void
  /** 🔒 Forget a provider's API key — answers whether there was one. A person's act only. */
  forgetApiKey(provider: Provider): boolean
  /**
   * 🔴 **How many conversations have ever been recorded as each identity** (558, `HO-063` gap 1) —
   * one grouped statement, and no entry for an identity nothing has run as.
   *
   * ⛔ **A caller folds it against the roster** — see `identityUse` in `shared/agent-roster.ts`,
   * which is where an identity nothing has run as gets the entry saying so. ⚠️ It asks nothing
   * about `agent_identity` and joins nothing to it, so the cost does not move with the size of the
   * roster.
   */
  conversationsPerIdentity(): readonly IdentityHistory[]
  /**
   * 🔴 **Take one identity's row out of the database** (558, `HO-063` gap 1's *"a way to remove one
   * nothing runs"*).
   *
   * ⛔ **This is the WRITE and it is not the rail.** `RuntimeHost.removeAgent` decides, out of
   * `whatHoldsIt`, and this only ever runs against a row nothing holds. ⚠️ Called directly on a row
   * a conversation was recorded as, it THROWS — `provider_session.agent_identity_id` is the one
   * `NO ACTION` key that points here — and that raise is deliberately not caught here.
   *
   * ⚑ **Its `external_mcp_server_grant` rows, its instruction versions and its memory amendments go
   * with it, by CASCADE on the foreign keys** rather than by a second statement —
   * `removeExternalMcpServer`'s own ruling.
   *
   * ⛔ **Nothing on disk is touched.** See `AGENT_REMOVAL_MEANS`.
   */
  removeAgentIdentity(profileSlug: string): boolean
  /**
   * 🔴 **The global kill switch** (341, HO-005 criterion 7) — one row, app-wide.
   *
   * ⛔ **Absence is OFF.** No row, an older schema, no database at all: every one of them answers
   * `false`. A kill switch whose broken state is *on* is not a kill switch. See `schema.ts`'s
   * {@link appPolicy} for why the seeded value is nonetheless `1`.
   */
  spawnPolicy(): { spawningEnabled: boolean }
  /** Throw the switch. Nothing running is stopped — see {@link appPolicy}. */
  setSpawningEnabled(enabled: boolean): void
  /**
   * 🔴 **The mode a person's next conversation begins in** (500, HO-036 §3.1) — the other value on
   * the one row that is about nobody in particular.
   *
   * ## ⛔ It answers `'ask'` for everything it cannot read, and that is the whole safety of it
   *
   * ⚑ **There is no CHECK on the column** — `schema.ts` says why — so this fold IS the
   * vocabulary. It answers `'ask'` for a NULL, for a missing row, for a database that cannot be
   * read, and for any word this app does not recognise. ⛔ **`'auto'` is
   * reachable only by exact match**, which is `078`'s rule and `ApprovalModeSwitch`'s: the
   * dangerous value is asked for by name or not at all.
   *
   * ⚠️ **So a typo in this column cannot widen what an agent does without asking** — it narrows.
   * That is the opposite direction from {@link spawnPolicy}'s `false`, and the same reasoning:
   * each fails towards the state in which somebody is still being asked.
   *
   * ⛔ **Nothing below the IPC boundary reads this.** It is spent at the two doors a person
   * presses, and no rail reads it: a conversation an agent starts runs in its giver's mode.
   */
  defaultApprovalModeChosen(): boolean
  defaultApprovalMode(): 'ask' | 'auto'
  /**
   * Record what a person chose. ⚠️ **It changes nothing that is running and nothing that has run**
   * — it is read at the next launch a person makes, and by nothing else.
   */
  setDefaultApprovalMode(mode: 'ask' | 'auto'): void
  /**
   * 🔴 **The conversation that started this one, or `null`** — a person did, or no row holds that
   * id (341, criterion 8).
   *
   * ⚑ **Read from the database, so it survives a restart**: a commanding relationship does not
   * (340), and this is why that is survivable — the conversation comes back as a recording that
   * still says where it came from. ⛔ D-016 · the parent alone: why a conversation was started is
   * the brief of the piece it was given.
   */
  parentOf(sessionId: string): string | null
  /**
   * 🔴 **Every conversation ABOVE this one in the chain that created it, nearest first** (629,
   * `HO-095` §4).
   *
   * > ⛔ **The ruling:** *any agent above another in the spawn chain may interrupt it.*
   *
   * ## ⚑ Why the chain and not the live slot
   *
   * ⚠️ **`SessionSlot.spawnedBy` is the LIVE half and dies with the process**; this is the durable
   * one, `provider_session.parent_session_id`, which `341`'s criterion 8 made survive a restart
   * precisely so a relationship outlives the run that made it. ⛔ A reach derived from the slot
   * would mean a grandparent could stop a grandchild before a relaunch and not after, which is a
   * rail that reads liveness — {@link parentOf}'s own rule, one question over.
   *
   * ## ⛔ What an EMPTY answer means, and it is not *we could not look*
   *
   * ⚑ **`[]` is *nothing above it*** — a conversation a person started, or one whose parent row is
   * gone. ⚠️ **An ancestor with no row is not walked past**: the recursive step joins
   * `provider_session`, so a chain whose middle was deleted stops there and everything above it is
   * absent from this answer. ⛔ **That is the honest direction** — the ledger is what says the
   * chain exists, and a rail may not admit a relationship the ledger cannot show.
   *
   * ⚠️ **Bounded at 64 hops and self-excluding** — see the statement, which says why both.
   */
  ancestorsOf(sessionId: string): readonly string[]
  /**
   * Move an adopted row's timestamp forward when the provider has touched the conversation
   * since we recorded it. Only ever forward, and only ever for adopted rows: the list is
   * ordered by this, and a pointer frozen at the moment it was created would sink below
   * sessions it is now more recent than.
   *
   * ⚑ **And back-fill the descent while the home is still there to ask** (119). `111` wrote
   * `child_descent` on INSERT and nowhere else, so a row adopted before that migration stayed NULL
   * for ever — and `118` hangs the whole Resume refusal on that column. A correctness rule that only
   * holds for rows recorded after a migration is not a rule. The caller already has the live
   * answer in its hand; passing it costs one argument. See {@link mergeDescent} for what is
   * written, and in particular for what is never erased.
   *
   * ⚠️ **Returns whether the recorded descent CHANGED** (121) — not whether the clock moved, which
   * it always does. It is what the scan's freshness note counts, and it is the store's answer
   * rather than the caller's because only the store can see the stored value the merge ran against.
   */
  refreshAdopted(sessionId: string, updatedAt: number, child?: ChildDescent): boolean
  /**
   * **The descent half of {@link refreshAdopted}, without the clock** (119, review).
   *
   * ⚑ **The sweep is the other door, and it is the one that matters most.** `adoptSessions` scans the
   * homes this app provisions; the user's own `~/.claude` and `~/.codex` are adopted by `sweepOne`,
   * which writes the descent on its INSERT branch and nothing at all when the row is already known.
   * So `111`'s defect survived there in full — and `sweep.ts`'s own note says why that is the worse
   * half: *"it exists for the day the provider's file is gone,"* and after that day the row is the
   * only place a descent could have been.
   *
   * Keep this separate from `refreshAdopted` so the sweep does not change `updated_at` or reorder the person's reopen list. It uses the same {@link mergeDescent} without moving the clock.
   *
   * ⚠️ **Returns whether anything was learned** (121), on the same terms as {@link refreshAdopted}.
   */
  learnDescent(sessionId: string, child?: ChildDescent): boolean
  /**
   * Record a mode the user changed mid-conversation (034).
   *
   * The column already existed and already governed resume — it was simply written once, at
   * creation, because that was the only moment the mode could be chosen. Persisting the change is
   * what makes the control mean anything past a restart: a session resumed from a stale `ask` row
   * would start prompting again with no explanation, and one resumed from a stale `auto` row would
   * do something far worse.
   */
  setApprovalMode(sessionId: string, mode: 'ask' | 'auto'): void
  /**
   * Record a model the user changed mid-conversation (076) — the same shape, and the same reason, as
   * {@link setApprovalMode}.
   *
   * The column already existed and already governed resume; it was written once, at creation,
   * because that was the only moment a model could be chosen. `null` is meaningful and is not
   * "unchanged": it is *"nothing is selected yet"* — written back only when a give's switch is
   * taken back from a row that named none.
   *
   * 🔴 **677 · it said a `null` *"resumes onto the provider's own default"*, and that was measured
   * false.** ⛔ On BOTH providers a resume that names no model continues on the model the
   * conversation LAST ran (`{claude,codex}-resume-model-probe.smoke.ts`, step D1): the provider
   * keeps it, not this row. ⚑ **D-042 · R1 — so every start names it**: a row with `null` here is
   * resolved at its next start and written back; a give that switches the conversation writes it
   * too (R4).
   */
  setModel(sessionId: string, model: string | null): void
  /**
   * Record an effort the user changed mid-conversation (076). `null` is a model that offers no
   * effort level — or, as for {@link setModel}, nothing selected yet.
   *
   * ⚠️ **The column is free text and stays free text.** 076 opened `ReasoningEffort` because the
   * providers' vocabularies are open (Codex) and per-model (both), so a CHECK constraint here would
   * be the closed list all over again, in the one place a migration is needed to change it.
   */
  setReasoningEffort(sessionId: string, effort: string | null): void
  /**
   * 🔴 **682 · a PERSON changed this conversation's model or its effort while it ran** (`R31c`) —
   * stamped beside {@link setModel} / {@link setReasoningEffort} by the live-change door, and by
   * nothing else. ⚑ A WAKE writes those two columns too (677) and never this one: its write is the
   * app carrying a person's STANDING choice, which is exactly what this stamp outranks.
   */
  aPersonSetItsModelOrEffort(sessionId: string, at: number): void
  /**
   * 🔴 **D-042 · R5 — what the PROVIDER reports this conversation runs** — the model, and the effort
   * where the provider reports one (`null`: it does not). ⛔ **`updated_at` untouched**: a report is
   * not activity, and the lists order by it.
   */
  setReportedModel(sessionId: string, model: string | null, effort: string | null): void
  /**
   * ⚑ **D-042 · one conversation's selected pair, whether a person chose it, and its provider's last
   * report** — or null: no row. ⚑ Read for any row, a never-started one included (`find` drops
   * those).
   */
  whatItRunsOn(sessionId: string): {
    readonly model: string | null
    readonly reasoningEffort: string | null
    /** When a person last changed its model or effort, or null — `R31c`'s stamp. */
    readonly aPersonChoseItAt: number | null
    readonly reportedModel: string | null
    readonly reportedEffort: string | null
  } | null
  /**
   * Record that a planning session was given the GO-AHEAD (060) — the durable half of the gesture.
   *
   * Without this the release would live only in the handle, and reopening the conversation would put
   * it back to proposing with nothing on screen to explain why — the same failure
   * {@link setApprovalMode} exists to prevent, one setting along.
   *
   * ⚠️ **Only ever on a row whose `plan_mode` is set.** The two columns are read as a pair, and a
   * `plan_ended_at` on a session that never planned would have the adapter assert a collaboration
   * mode on a thread that has none — which replaces its developer instructions. The caller owns
   * that (the command is only reachable from a session that is planning); this states the contract.
   */
  endPlanMode(sessionId: string, at: number): void
  /**
   * Record that a conversation STARTED planning mid-flight (076) — the direction 060 could not go.
   *
   * 060's comment said `plan_ended_at` is *"written once and never cleared: a live conversation has
   * no way back into plan mode on either provider"*. That was true of 060 and is not true now:
   * `Query.setPermissionMode('plan')` and Codex's `collaborationMode` both take a session INTO
   * planning mid-conversation, so the pair has to be able to move back.
   *
   * Sets `plan_mode` and CLEARS `plan_ended_at` in one statement, because the two are read as a pair
   * and the intermediate state — planning, and already released — is the one that would have the
   * Codex adapter assert `{mode:'default'}` on a session the user just asked to plan.
   */
  startPlanMode(sessionId: string, at: number): void
  /**
   * The row that already points at this provider conversation, if any. Adoption asks first, so
   * running the scan twice records one session rather than two rows for the same thread.
   *
   * 🔴 **727 · R87 — by its ref first, then by the id its LAUNCH asked for** (`launched_as`). The
   * second answer is this app's own launch, whatever its ref says now: one killed or errored before
   * any ref reached the row, or one whose `/clear` has since moved the ref on (its first transcript
   * is still that conversation's own).
   */
  findByProviderRef(provider: Provider, sessionId: string): string | null
  /**
   * 🔴 **727 · R87 — give a row its ref from the transcript its launch wrote**, when the row has
   * none: the app was killed between the CLI's first write and `system/init`, the launch errored
   * before init, or its close's exit receipt timed out — each leaving a conversation the provider
   * holds and the row could not reopen.
   *
   * ⛔ **Only a row with NO ref, and only by the id it launched with** (`launched_as = ref.sessionId`)
   * — a ref a validated init or a close announced always wins, and a scan never renames a
   * conversation. ⚠️ **The ledger is not written**: the conversation's own record says what happened
   * to it; this is where the provider keeps it, which is what adoption writes for an adopted row.
   * `updated_at` is left alone — naming is not something the conversation did.
   *
   * Returns whether the row was named.
   */
  nameItsLaunch(sessionId: string, ref: ReturnType<typeof parseSessionRef>): boolean
  /**
   * Append one entry, with the durable state it implies, in one transaction.
   *
   * `at` is passed in rather than read from a clock here, so the value that reaches the renderer
   * and the value written to `created_at` are the same one. It is also what lets an IMPORT record
   * the provider's own timestamps instead of the moment we imported (Slice 2 · 001).
   */
  append(sessionId: string, ordinal: number, event: TranscriptEvent, at: number): void
  /**
   * Append a run of entries in ONE transaction (046). Identical in effect to calling
   * {@link append} for each — it drives the same per-event transaction, so every turn, status and
   * ref it implies is written exactly as before — but it commits once instead of once per event.
   *
   * That is not a micro-optimisation at the scale this exists for: measured here, a per-event
   * commit runs at ~18.8k rows/s and a 1,000-row commit at ~62k, and the sweep derives ledgers for
   * a corpus of 11.5 GB. `entries` is a batch the caller already holds, never the whole session.
   */
  appendMany(
    sessionId: string,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): void
  /**
   * Run `work` in ONE transaction, whatever it does (046).
   *
   * Exists for the ledger derive, which writes in batches for memory but must land all-or-nothing:
   * committing per batch meant a process killed mid-derive left a HALF transcript that `hasEvents`
   * would then defend forever. Nested calls inside (`appendMany`, `closeOpenTurn`) become
   * savepoints, so every rule they carry still runs — only the commit boundary moves.
   *
   * `work` must be SYNCHRONOUS. SQLite transactions are per-connection and better-sqlite3 is
   * synchronous by design; awaiting inside one would let another write interleave and commit
   * halfway through.
   */
  atomically<T>(work: () => T): T
  /** Sessions with a ref to resume from, most recently touched first. */
  resumable(): ResumableSession[]
  /** The recorded sessions that cannot be reopened, each with the reason it cannot. */
  unresumable(): UnresumableSession[]
  /**
   * EVERY recorded session, reopenable or not, with the provider id it was recorded under (047).
   * The library's own read — see {@link RecordedSession} for why it is not one of the two above.
   */
  recorded(): RecordedSession[]
  /**
   * ONE recorded session, by our own row id — the same shape {@link recorded} gives, from one
   * indexed lookup instead of a scan (119, from `118` §7.4).
   *
   * ⚠️ **One row must not be a second description of it.** Every door that asks about ONE
   * conversation — a look drawn from its ledger, a setting written for its next start, a rebuild —
   * reads it here, through the same mapping as {@link recorded}, so the row it gets cannot drift
   * from the row the full read produces.
   */
  recordedOne(sessionId: string): RecordedSession | null
  searchPastWork(caller: string, words: string): PastWorkSearchResult
  closePastWorkSearch(): void
  pastWorkSearchSource(caller: string): PastWorkSource | null
  /**
   * ⚑ **D-017 · R10 — every conversation that can never be reopened and was replaced, with the one
   * that took its place**, read off the old ledgers' `replaced_by` rows — one scan, for the host's
   * cache at launch. A replacement since deleted is not one: the old conversation stands as it was.
   */
  replacements(): readonly { readonly replaced: string; readonly by: string }[]
  /**
   * ⚑ **D-029 · every conversation whose newest schedule still holds a job** — its newest
   * `scheduled_work` level, across every life and generation, with each job's first listing and
   * the moment of its newest compaction, or `null` — one scan, for the host's wake-ups at launch. ⚠️ A newest row that is not JSON costs its own
   * conversation, warned (D-017 · R8), rather than bringing back the level before it.
   */
  newestScheduleLevels(): readonly {
    readonly conversation: string
    readonly level: ScheduleLevel
    readonly compactedAt: number | null
    /**
     * ⚑ What that row says this app does not start the conversation for, job by job — present only
     * when it says something.
     */
    readonly notStartedSaid?: Readonly<Record<string, NotStartedBecause>>
  }[]
  /**
   * The rows a conversation's scheduling evidence is built from, oldest first, across every life
   * and generation: each `scheduled_work` row that is the receipt of a call that made or cancelled
   * a job, a level its provider stated, or this app's mark of a reset of the provider's
   * conversation; each `launched`; and each `status` that ended a life.
   * Read through the fold's index. ⚑ A level this app wrote is left out: it is derived from the
   * rest. ⚑ So are the receipts of other scheduling calls: nothing is planned from them. ⚑ A row a
   * rebuilt generation holds again is given once, as its newest generation holds it. ⛔ **Bounded**:
   * only the conversation's newest {@link MAX_SCHEDULE_HISTORY_WALKED} fold rows are looked at,
   * and at most {@link MAX_SCHEDULE_EVIDENCE_ROWS} of each kind are given; the answer says when
   * either cut its history ({@link ScheduleEvidenceRead.cut}). ⚠️ A row that is not JSON is left
   * out.
   */
  scheduleEvidenceRows(sessionId: string): ScheduleEvidenceRead
  /**
   * When this conversation's provider last reported a status, in its newest generation — the last
   * moment it is known to have been running — or `null` when it never did.
   */
  lastStatusAt(sessionId: string): number | null
  /**
   * One session by id, **as resume can use it** — which drops a row with no provider ref.
   *
   * ⚠️ **The doc here read *"resumable or not"* and that was never what it did** (172, 142's rule).
   * `toResumable` returns null for `external_ref === null`, so this has always answered the
   * narrower question; the sentence is corrected rather than removed because a caller that needs
   * the row of a session that has no ref yet now has {@link findLive} to reach for instead of this.
   */
  find(sessionId: string): ResumableSession | null
  /** The recorded facts a LIVE session's hand-over needs (172) — see {@link LiveSessionRow}. */
  findLive(sessionId: string): LiveSessionRow | null
  /** One session's ledger in order: the transcript a reopened chat is rebuilt from. */
  /**
   * The path a workflow run reported writing its answer to (108), or null.
   *
   * ⚠️ **This is the only source the output viewer has, and that is the security boundary.** The
   * renderer names a session and a task; the PATH comes from here, out of the event this app
   * persisted when the provider sent it. See `workflow-output.ts` for why a renderer-supplied path
   * would be a different and much worse thing.
   */
  /**
   * ⚑ `unread` (697 · `676` §5): torn `workflow_run` rows newer than the answer — or all of them
   * when there is none — are warned and counted into it. Optional because only a caller with
   * somewhere to put the count passes one.
   */
  workflowOutputPath(sessionId: string, taskId: string, unread?: RowsUnread): string | null
  /**
   * The run an agent belongs to (112), or null when no readable row of this session reported it
   * (a torn one is counted into `unread` — `697`).
   *
   * ⚠️ **This is the whole allowlist for the child-transcript door**, and the same boundary
   * {@link workflowOutputPath} is: the renderer names a session and an agent, and only an agent
   * this app's own ledger recorded under a `workflow_run` can be opened. The task id comes back
   * because it is what the viewer's header says the child belongs to; the ANSWER being non-null is
   * what the door actually gates on. See `child-work.ts`.
   */
  workflowAgentTask(sessionId: string, agentId: string, unread?: RowsUnread): string | null
  /**
   * Every agent one run reported (112), oldest announcement first.
   *
   * The run's own artefacts — its journal and the script that fanned it out — live in a directory
   * named by a `runId` the provider does not put on the wire, so the only way to find it is through
   * an agent that has a file in it. Any single agent will not do: `agents[0]` is routinely one that
   * was still queued and never wrote anything.
   */
  workflowAgentIds(sessionId: string, taskId: string, unread?: RowsUnread): string[]
  /**
   * Whether this session ever reported that sub-agent (115) — the door's OTHER allowlist.
   *
   * ⚠️ **A plain `Task` child and a Codex child thread are in no run**, so {@link workflowAgentTask}
   * cannot speak for either: their whole announcement is a `sub_agent` event. This answers the same
   * question about the same ledger — *did we record this agent, in this session* — and it is what
   * lets the sub-agent CARD open a transcript without the renderer ever naming a path.
   */
  reportedSubAgent(sessionId: string, agentId: string, unread?: RowsUnread): boolean
  events(sessionId: string): PersistedEvent[]
  /**
   * A WINDOW of the ledger, from an ordinal (053).
   *
   * It exists for EXPORT. A bundle carries the provider's lines *and* our ledger, so streaming only
   * the lines would have been a bound in name: the ledger of a gigabyte-scale conversation is the
   * same order of magnitude as the file it was derived from, and `events()` materialises all of
   * it — every row parsed into an object, held at once, on the way into one JSON string.
   *
   * Windowed by ordinal: the unique index on `(session_id, ordinal)` makes the start a seek, where
   * `LIMIT ? OFFSET ?` would walk every row before it and turn one pass into a quadratic one.
   */
  eventsFrom(sessionId: string, fromOrdinal: number, limit: number): PersistedEvent[]
  /**
   * ⚑ **F093 · the newest row of one type in a conversation's ledger** — before `before` when it is
   * given — or `null` when it holds none: the agent-input popup's read of a closed conversation's
   * last launch, its tool list and its context, and the per-message view's launch and message.
   * ⚑ A seek back on the `(session_id, generation, ordinal)` index. ⚠️ Optional: a store without it
   * answers nothing, and the popup composes what it shows now.
   */
  newestOfType?(
    sessionId: string,
    type: TranscriptEvent['type'],
    before?: number,
    /**
     * ⚑ **W4.203 · a floor**: only rows at or past this ordinal are looked at, so a type no index
     * holds alone is looked for among a bounded stretch of the ledger, never the whole of it.
     */
    from?: number,
  ): PersistedEvent | null
  /**
   * ⚑ **W4.179 — the rows that say what a Codex thread holds of this conversation's own text**,
   * oldest first, before `before`: each launch with its text (`given.thisConversation`), each
   * message (with what it handed over only when that opens with this conversation's text, and its
   * `lead`), each turn's ending (whether this app ended it as failed), and each compaction or new
   * thread. ⚑ One read, ⚠️ unparsed: the caller checks every field. ⚠️ Optional: a store without it
   * says nothing, and the whole text is sent again, as before.
   */
  threadLeadRows?(
    sessionId: string,
    leadsOpenWith: string,
    before?: number,
    historicalLeadsOpenWith?: string,
    /** Inclusive ordinal floor for pages; omitted: the whole history before the upper bound. */
    fromOrdinal?: number,
  ): readonly ThreadLeadRow[]
  /**
   * The last `turns` turns of a session's ledger, ending just before `before` (054).
   *
   * ## Why the turn, and not a count of events
   *
   * `events()` hands back the whole ledger, and the whole ledger is what a reopened conversation
   * was built from — measured on the packaged app against a real 171-turn conversation: 27,251
   * entries, 22.6 MB across IPC, 7.6 seconds to first paint, 1.5 GB peak RSS. The corpus has an
   * 8× larger file than the one that produced those numbers.
   *
   * Page at turn boundaries using `turn_id`. A fixed event count can open the visible history halfway through a tool result, obscuring where the conversation actually began.
   *
   * ## The event cap is a second bound, and it can cut mid-turn
   *
   * One turn is not bounded: an agent may run for hours and emit tens of thousands of events inside
   * a single prompt. So `maxEvents` cuts regardless, and when it is what cuts, the window is NOT
   * turn-aligned. That is a real state and it is reported: `turnAligned` says which bound decided,
   * so nothing downstream has to infer it from the shape of the data.
   *
   * Both bounds are seeks on `(session_id, ordinal)`, never `LIMIT/OFFSET` — the same reason
   * {@link eventsFrom} gives: an offset walks every row before the window and turns paging back
   * through a long session into a quadratic scan.
   */
  turnWindow(sessionId: string, options: LedgerWindowQuery): LedgerWindow
  /** Bounded indexed context, independent of how many app turns follow the human turn. */
  latestHumanAnswers(sessionId: string): HumanAnswers
  humanFinalsInWindow(sessionId: string, from: number, through: number): ReadonlyMap<number, HumanFinalContext>
  /**
   * What this session's ledger claims about itself (065) — **the replacement for `hasEvents`**.
   *
   * `hasEvents` asked *does any row exist*, and four different callers were reading that as *is this
   * conversation complete*, and existence has nothing to say about that. See {@link LedgerStatus}
   * for the answers that replace the one boolean.
   */
  ledgerStatus(sessionId: string): LedgerStatus
  /**
   * Open a generation to build a replacement projection into, and return its number (065).
   *
   * The new rows are written **beside** the active ones, not over them, which is what makes a
   * rebuild survivable: nothing a half-finished build wrote is ever read, because reads are scoped
   * to the active generation and this one is not it yet.
   *
   * Also the self-healing step — it clears any rows left by a build that was abandoned, so a crash
   * mid-rebuild costs disk until the next attempt and nothing after that.
   */
  beginGeneration(sessionId: string): number
  /**
   * Clear every `building` marker left by a process that died, and say how many there were (065).
   *
   * ⚠️ **Called ONCE at launch, and only correct because of when.** A marker means "a projection is
   * being built right now", and nothing is building anything at the moment the host is constructed —
   * so any marker on disk belongs to a run that is over. Without this, a crash between opening a
   * generation and finishing it leaves the session reading `rebuilding` for the rest of its life:
   * the library shows "Rebuilding…" forever and offers no Rebuild button, because a session that is
   * already rebuilding does not need one. The state that cannot be left behind is the state nothing
   * can get out of.
   *
   * The rows the dead build wrote are NOT deleted here — they are unreachable either way, and the
   * next derive collects them in bounded steps. This clears the claim, not the garbage.
   *
   * ⛔ **`running` is the sessions something ALIVE is building or driving right now, and they are
   * left exactly as they are** (198, from 194 H1's second failure). "Nothing is building anything at
   * the moment the host is constructed" is an assumption about the process, and a second host in one
   * process makes it false: it clears the first one's `building = G` marker, the first goes on
   * writing rows into a generation nothing will ever promote, and `promoteGeneration` then updates
   * zero rows while `deriveLedgerFromArchive` still returns success. The caller is told the import
   * worked and the old projection is still the active one.
   *
   * ⚠️ **Required, not optional.** An empty set is the normal answer and produces the behaviour 065
   * shipped, byte for byte — but a default would let the next caller inherit the assumption without
   * being asked to think about it, which is exactly how this one survived being written down.
   */
  clearOrphanBuilds(running: ReadonlySet<string>): number
  /**
   * **Every session a previous run left claiming to be busy** — settled at launch (074, from 069
   * §2.5). Returns how many.
   *
   * ⚠️ **Called ONCE at launch, and only correct because of when** — the identical argument as
   * {@link clearOrphanBuilds}, about the other column a dead process can strand. `status` is written
   * as the session runs and reconciled by `settleTx`, which runs on resume and in the finalizer. A
   * clean quit reaches the finalizer. A crash, a SIGKILL or a power cut reaches neither, so the row
   * keeps saying `working` — and `resumable()` reads that column straight out to the reopen list,
   * where a conversation whose provider died months ago is still listed as running. It does not
   * repair itself: nothing revisits it until that one session is individually resumed.
   *
   * At construction nothing is running, so any row claiming to be is claiming it about a run that
   * ended without saying so. The reason code is `unknown` for the same reason resume's is: we did
   * not watch that turn end, and `completed` would be an invention.
   *
   * ⚠️ Terminal rows are untouched, because `settleTx` refuses to overwrite them — a session already
   * recorded `ended` or `errored` did say how it finished, and the FIRST ending recorded is the one
   * that stands. The rows themselves stay in the list either way: the fix is to stop the status
   * lying, never to hide the conversation.
   *
   * ⚠️ **"Nothing is running" is an assumption about the PROCESS, not about this object** (review).
   * It differs from {@link clearOrphanBuilds} in the way that matters: that one clears a marker,
   * this one WRITES a status. So a second `RuntimeHost` constructed against the same database while
   * a first still held live sessions would settle rows those sessions are actively using — and the
   * constructor has no guard, because one host per process is an invariant of the app rather than of
   * this class. Nothing does that today, in the app or in the tests. It is written down because the
   * day something does, the symptom is a live conversation quietly reading `idle`.
   *
   * ⛔ **Two independent reviewers found it before that day arrived** (198; 194 H1, 191 H6), and the
   * paragraph above is now a guard rather than a warning. `running` names the sessions something
   * alive is driving; they are skipped, and the count returned is of rows actually settled. The
   * symptom it prevents is the one predicted: B closes A's open turn as `unknown` and writes `idle`
   * over a session whose provider is mid-answer — and A's real turn terminal can never replace that
   * `unknown`, because `appendTx` closes only the turn that is currently open. `turns()` stays wrong
   * for the life of the row.
   *
   * ⚠️ **Required for the same reason as {@link clearOrphanBuilds}'s.** The empty set is the whole
   * of normal use.
   */
  settleOrphanRuns(at: number, running: ReadonlySet<string>): number
  /**
   * ⚑ **What {@link settleOrphanRuns} is about to settle**, read before it writes anything: each
   * conversation left `working` or `waiting_permission`, its open turn as it stands (blocked or not),
   * and its last recorded moment. The repair closes that turn and clears its block, so these facts
   * are only true before it. ⚑ `running` is honoured for the repair's reason.
   */
  whatACrashLeftRunning(running: ReadonlySet<string>): readonly LeftRunning[]
  /** ⚑ A conversation's open turn in its active generation, or `null` when none is open. */
  recordedTurnOpening(sessionId: string, turnId: string): UserTurnEvent | null
  ensurePersonalRoot(sessionId: string, at: number): WorkRow
  theOpenTurn(sessionId: string): OpenTurn | null
  /** ⚑ The id of a conversation's newest turn, in any generation, or `null` when it has none. */
  theNewestTurn(sessionId: string): string | null
  /** ⚑ The generation a conversation's rows are written in now. */
  theActiveGeneration(sessionId: string): number
  /**
   * ⚑ **Whether the life whose `launched` row is `life` opened this turn** — the turn is in that
   * generation, and the newest `launched` or `reopened` row before the turn's first row is that one:
   * every life writes a `launched` as it starts, and a reopen writes its `reopened` first, so a later
   * life's start makes another even if its own `launched` was never recorded.
   */
  aLifeOpenedTheTurn(
    sessionId: string,
    turnId: string,
    life: { readonly generation: number; readonly launched: number },
  ): boolean
  /**
   * ⚑ **How a turn ended, and what its own rows say of it** — whether its ending was this app's
   * word, whether a stop was asked in it (a card's Cancel is one), whether this app's continuation
   * started it, and whether a person's words did. `null` when no such turn is in that conversation.
   */
  howATurnEnded(sessionId: string, turnId: string): TurnAsItEnded | null
  /**
   * Where the newest `request_routed` row for `requestId` stands in a conversation's active
   * generation — its ordinal, the order this app recorded it in, which no clock can reorder — or
   * `null` when there is none, or it can't be read. ⚑ The newest, as the answer door takes it: a
   * provider that starts again may reuse an id.
   */
  whereItWasRouted(sessionId: string, requestId: string): number | null
  /**
   * The pieces `owner` held as its ledger stood just before `ordinal`, in its active generation,
   * folded as {@link piecesOwnedBy} folds them: not kept, so read once.
   */
  piecesOwnedBefore(owner: string, ordinal: number, unread?: RowsUnread): readonly PieceRow[]
  /**
   * ⚑ **What became of a held message, by its id**: `sent` (handed to its provider), `ended`
   * otherwise, `waiting` (held, with no ending), or `absent` (never held).
   */
  whatBecameOfAMessage(
    sessionId: string,
    messageId: string,
  ): 'sent' | 'ended' | 'waiting' | 'absent'
  /**
   * 🔴 **The ending a crash could not write** (379 §1, from `354`'s measurement) — startup repair for
   * a HELD MESSAGE, exactly as {@link settleOrphanRuns} is startup repair for a stranded run.
   *
   * ## ⛔ Why this is a WRITE and cannot be a derivation
   *
   * `UnqueuedMessageEvent`'s own first line claims an ending is *"always emitted, exactly once, for
   * every `message_queued`"*. `354` measured it: **false of a crash.** ⚑ **D-017 · R3**: a stop
   * hands what it held on to the next start (`runFinalize` → `handOnWhatItHeld`), and a quit leaves
   * its rows open for that start; a crash reaches neither, and the next launch wrote nothing either
   * — *"a second `RuntimeHost` over the same store leaves the ledger byte-identical."*
   *
   * ⛔ **And that is precisely why `derivePieces` must not answer it.** The ledger of an app that is
   * LIVE and holding a message and the ledger of an app that DIED holding one are the same bytes.
   * A function over the ledger alone cannot tell them apart, so the difference has to be recorded by
   * the one party that knows it — the launch that finds a held message nothing is holding. ⚠️ *"Still
   * running"* is the wrong answer `379` §1 names, and this is what stops the derivation having to
   * guess at it.
   *
   * ## ⚠️ What it writes, and what it refuses to write
   *
   * ⛔ **`abandoned`, never `cancelled`.** Nobody chose this — 077's rule, and 063's *"a plan approved
   * by nobody"* in the other direction. The {@link UnqueuedMessageEvent.detail} says which
   * abandonment it was, because the bare reason was built for *"the conversation ended underneath
   * it"* and that is not what happened here.
   *
   * ⚠️ **Only a message with a NAME** (`354`). A `message_queued` written before ids existed cannot
   * be paired with an ending, and inventing one would join two messages that are not the same
   * message. Those rows are left exactly as they are: a beginning with no ending, which is what they
   * have always been.
   *
   * ⛔ **`running` is honoured for {@link settleOrphanRuns}'s reason**, restated because it is the
   * half that is easy to drop: a second host over the same database must not settle a message the
   * first one is still holding. The count returned is of messages actually settled. ⚑ **D-017 ·
   * R3** — the host hands in the conversations a quit closed too: their held messages wait for their
   * next start ({@link messagesWaitingIn}).
   *
   * 🔴 **D-030 · and so does every message no crash cut** — decided per message, never by a quit's
   * stamp alone: ⚑ one this app held while nothing ran in its conversation
   * ({@link QueuedMessageEvent.forItsNextStart}) waits for that conversation's next start, whatever
   * ended its last life, until a life begins after it (`launched`); ⚑ one a life held waits when its
   * row says that life ended (`ended` or `errored` — a stop writes its terminal after handing on what
   * it held). ⚑ Only a message held in a life a crash cut is settled here: a crash writes no
   * terminal, a reopen clears the last one, and a life begins with `launched`.
   */
  settleStrandedMessages(
    at: number,
    running: ReadonlySet<string>,
    /** ⚑ **D-017 · R8** — where the sweep notes a ledger it skipped, for the launch's line. */
    unread?: RowsUnread,
  ): number
  /**
   * ⚑ **D-017 · R3 — the held messages a stop left in this conversation, or this app held for it
   * while it was not running, in the order they were held** (D-030): each named `message_queued`
   * with no ending, in the active generation, as its row says it.
   * ⚠️ A torn row is passed over, as the launch's repair passes it over.
   */
  messagesWaitingIn(
    sessionId: string,
    unread?: RowsUnread,
    maximumRows?: number,
  ): readonly WaitingMessage[]
  /**
   * 🔴 **Startup repair for a routed REQUEST nothing is holding** (396), exactly as
   * {@link settleStrandedMessages} is for a held message and {@link settleOrphanRuns} for a
   * stranded run.
   *
   * ⛔ **A request reading `open` after the power went out is an unenumerated state counting as
   * success** — the parent's `list_questions` would offer it, `answer_question` would admit it, and
   * the answer would reach a provider process that no longer exists. ⚠️ **No function over the
   * ledger can tell that apart from a live wait**; this launch can, for the reason its neighbours
   * give: at construction nothing is running.
   *
   * ⛔ **`running` is honoured** for {@link settleOrphanRuns}' reason, restated because it is the
   * half a second host in one process makes true.
   *
   * ⚑ **D-017 · R4 — a question this app asked in a launch that wrote `launched` is not stranded**:
   * its answer starts the asker again. Only the provider's own requests died with the process.
   *
   * @returns how many requests were settled — of what was found, never of what was looked at.
   */
  settleStrandedRequests(
    at: number,
    running: ReadonlySet<string>,
    /** ⚑ **D-017 · R8** — where the sweep notes a ledger it skipped, for the launch's line. */
    unread?: RowsUnread,
  ): number
  /**
   * 🔴 **Every piece of work in this database that has stopped and whose giver was never told**
   * (557, HO-018 §2.1 · criterion 4) — the durable half of *nobody waits forever in silence*.
   *
   * ## ⛔ The two clauses, and the second one is the whole point
   *
   *  1. **The work has stalled, and a conversation gave it** — {@link aStallItsGiverCanBeToldOf},
   *     the same predicate `RuntimeHost.tellIfNobodyHasYet` is admitted by.
   *  2. ⛔ **Its giver holds no standing receipt for it** — {@link SessionStore.workReportedTo},
   *     the push's own de-duplicator read from the other end. ⚑ **So a person is never told about
   *     work an agent was successfully told about**, and the two recipients are complements by
   *     construction — ONE set — rather than by two filters that happen to agree.
   *
   * ⚠️ **A receipt STANDS unless the message carrying it was abandoned** — that rule lives in
   * {@link SessionStore.workReportedTo} and is not re-decided here, which is why a notice this app
   * held and then dropped at a quit puts the row back rather than leaving it silently settled.
   *
   * ## 🔴 What this reader deliberately does NOT ask
   *
   * ⛔ **Whether anybody is running.** A slot is the host's and not the database's, and the live
   * half of the admission — *no agent can be told right now* — is
   * `RuntimeHost.stalledWorkForAPerson`'s. ⚑ Splitting it here is what keeps this answer derivable
   * from a `.brobot` bundle with no host at all.
   *
   * ⚑ **Whether a PERSON gave the work — asked, by that same predicate** (D-016 · commit 6). A root
   * is never a folded piece (D-016 · R1), but work its owner took on for a person is, and whatever
   * stalls it there is nobody to tell and no band row to draw: the person who asked reads its row.
   *
   * ## ⚠️ The candidate set is the owners of pieces a conversation gave
   *
   * ⛔ **Read off `work` — every conversation that owns a piece with a giver** — because the stall
   * is folded from the OWNER's rows, and a sweep reading the givers would watch the wrong
   * conversation go quiet. ⚑ A piece a person gave never draws here, so a conversation holding
   * only those is no candidate (D-016 · commit 6). ⚑ Its own walk word, because a person is not
   * inside one family: see `every-conversation-that-was-given-work`.
   *
   * ⚑ **Oldest FIRST, and a row with no stamp sorts LAST** — `byBlockedSince`'s ruling carried
   * rather than re-taken: *an unknown age is not an old age*.
   */
  stalledWorkNobodyWasToldAbout(
    /** ⚑ **D-017 · R8** — the answer's own set, when a caller reads more beside this walk. */
    unread?: RowsUnread,
  ): LedgerWalk<PieceRow>
  /**
   * Every piece of work a conversation gave that stalled, COMPOSED, and whose giver WAS told: the
   * complement of {@link stalledWorkNobodyWasToldAbout} over the same walk and the same receipts,
   * so no piece is in both. ⚑ Whether its holder has stopped with it, nothing on its way to it, is
   * the host's (`RuntimeHost.stoppedWorkForAPerson`). Oldest stall first.
   */
  stalledWorkItsGiverWasToldAbout(unread?: RowsUnread): LedgerWalk<PieceRow>
  /**
   * Every open piece a conversation holds — given by a conversation or a person, never a root —
   * whose status line marks it as waiting on purpose and names nothing it waits on
   * (`aWaitNeedsClassifying`). Oldest mark first.
   */
  waitsThatNeedClassifying(unread?: RowsUnread): LedgerWalk<PieceRow>
  /**
   * Every piece a person gave (work its owner took on) that stalled, COMPOSED: nothing drives it,
   * and its holder asked nothing about it, owes a person no card and handed none of it out. ⚑ No
   * conversation gave it, so none is told; a person is. Oldest stall first.
   */
  stalledWorkAPersonGave(unread?: RowsUnread): LedgerWalk<PieceRow>
  /**
   * List delegated work whose holder's latest turn was opened by the person's words and ended with the work still open. The Waiting on you list and rail badge read this state through `RuntimeHost.waitingOnWhoWroteForAPerson` and `RuntimeHost.readWorkspace`.
   *
   * ## ⛔ COMPOSED, as every reading of a piece's state a person or a model reads is
   *
   * ⚑ **The fold's wait, with what is more specific said instead** ({@link
   * composeWhatEachPieceIsWaitingOn}): a holder that asked another conversation about the piece, or
   * gave part of it out, waits on that and not on the person — and a card a person owes there is
   * counted once, as the card. ⚑ The host's one state reads it the same way
   * (`RuntimeHost.aPieceItHoldsWaitsOnWhoWrote`), so the badge and *needs you* agree.
   *
   * ## ⚑ Read every five seconds, so the fold is kept until its ledger grows
   *
   * ⚑ {@link piecesWaitingOnWhoWroteIn} — a ledger that has not grown since is one probe, and only a
   * holder with a row in that wait is composed (its three narrow wait reads).
   *
   * ## ⚑ The stall band's candidates, and its walk word
   *
   * ⚑ **The owners of pieces a conversation gave** (`selectOwnersOfPiecesAConversationGave`) — the
   * fold enters this wait only over such a piece, so a conversation holding none could never yield a
   * row. ⚑ **Still candidates and no more: the fold decides**, and the walk is
   * `every-conversation-that-was-given-work`, whose sentence is as true of this read as of
   * {@link stalledWorkNobodyWasToldAbout}'s.
   *
   * ⚑ **Oldest FIRST, and a row with no stamp sorts LAST** — `byBlockedSince`'s ruling, carried as
   * that walk carries it.
   */
  piecesWaitingOnWhoWrote(
    /** ⚑ **D-017 · R8** — the answer's own set, when a caller reads more beside this walk. */
    unread?: RowsUnread,
  ): LedgerWalk<PieceWaitingOnWhoWrote>
  /**
   * ⚑ **F097 · the open pieces one conversation holds that its fold left waiting on the person who
   * wrote to it** — as the fold left them, NOT composed: the caller composes them with the wait
   * reads it already holds (`RuntimeHost.whoOwesIt`). ⚑ **Kept until its ledger grows**, so asking
   * it at every state flush costs one probe when nothing was written; a fold that could not read
   * every row is never kept.
   */
  piecesWaitingOnWhoWroteIn(owner: string, unread?: RowsUnread): readonly PieceWaitingOnWhoWrote[]
  /**
   * 🔴 **Every provider wall this app recorded lately, newest first** (533, HO-052 §4).
   *
   * ⛔ **Not a fourth thing waiting on a person** — see `persons-queue.ts`' `providerLimitsView` for
   * why a wall is carried beside the queue's rows and never as one. ⚠️ It reaches a person through
   * the same look, because the alternative is what happened: **the wall was written into a
   * conversation's ledger as a non-fatal `error` and read by nobody.**
   *
   * ## ⚑ Why this one does not go through {@link walkLedgers}
   *
   * ⛔ **Its candidate set is ROWS and not conversations.** The three queue readers materialise a
   * list of ledgers and fold each one whole; the question here is *the newest error rows across
   * every conversation at once*, bounded by the clock — so it builds its own {@link LedgerWalk}, the
   * way {@link SessionStore.digestWindow} does and for the same reason. ⚑ `ledgers` is still the
   * QUERY's number: how many distinct conversations the predicate touched, counted before a single
   * row is read.
   *
   * ⚠️ **NOT narrowed to the live projection**, which every other walk in this file is. A wall is a
   * fact about the provider's account rather than about a conversation, so a rebuilt projection does
   * not un-say it — and a limit dropped because its ledger was replaced is a limit a person is not
   * told about while it is still standing.
   *
   * @param now the instant the fold is against — a wall whose window has already reset is dropped.
   * @param signInChangedAt when each provider's sign-in last changed, as the host saw it: a wall
   *   recorded before was the sign-in before's, and is dropped BEFORE the fold — so it cannot hide
   *   the current sign-in's `about-to-stop`. ⛔ One in the same instant stays (`retractedBy`'s rule).
   */
  providerLimitsSeen(
    now: number,
    signInChangedAt?: ReadonlyMap<Provider, number>,
    accountLives?: readonly ProviderLimitAccountLife[],
  ): LedgerWalk<ProviderLimitSeen>
  /**
   * Reads ahead, for about `budgetMs`, what {@link providerLimitsSeen} keeps between calls: the
   * walls of the lookback before `now`, the launches of the conversations that wrote them, the
   * clears, and the newest completed turns. True once all of it is kept and current, so a caller
   * can stop asking until it asks again later. Called in short steps after launch, it keeps a
   * month of walls from being read at once by the first hold or look.
   */
  readAheadProviderWalls(now: number, budgetMs: number): boolean
  /**
   * 🔴 **Startup repair for WORK a restart left with nobody driving it** (400, HO-018 §2.3 ·
   * criterion 14), the LAST of the repairs a launch runs and the one the PO's own correction asked
   * for.
   *
   * ## ⛔ The case that wrote nothing at all
   *
   * ⚠️ **HO-018: *"I meant the app being killed while work is in progress. That is the realistic
   * case and it is the one that does not survive."*** ⛔ {@link settleOrphanRuns} closes the turn row
   * and reconciles the status column and **appends no event**, so a piece whose owner was mid-turn
   * when the app died derived `working` for the rest of its life — and `settleTx` is not the place
   * to fix that, because the turn is a different subject from the work.
   *
   * ⚑ **`settleStrandedMessages` already covers the sibling case** — work still HELD when the app
   * went away — and this deliberately does not duplicate it: a piece whose brief was abandoned is
   * already `stalled` by the time this looks.
   *
   * ## ⚠️ Idempotent by construction, with nothing remembered
   *
   * ⛔ **It writes only for a conversation that still owns an open piece in `waiting` or
   * `working`**, and the row names those pieces (`work_restarted.pieces`). After it lands each of
   * them is `stalled`, so the next launch finds nothing to say — the latch is the derived state
   * itself rather than a column or a marker that could disagree with it. ⚠️ **Never a root** (D-016
   * · R1): a root's state is its conversation's, and a restart is not a stall of it.
   *
   * ⛔ **`running` is honoured** for {@link settleOrphanRuns}' reason, and here it also carries the
   * ordinal rule: nothing outside `RuntimeHost` may append to a ledger it is running.
   *
   * @returns how many conversations were written about — of what was found, never of what was
   *   looked at.
   */
  settleRestartedWork(
    at: number,
    running: ReadonlySet<string>,
    /** ⚑ **D-017 · R8** — where the sweep notes a ledger it skipped, for the launch's line. */
    unread?: RowsUnread,
    /**
     * 🔴 **The conversations a wake-up will start for a job still ahead** — their work held for the
     * background is not named: the job the app starts them for drives it, so it reads `working`, as
     * it did before the restart, and nobody is told it stopped.
     */
    wokenForAJob?: ReadonlySet<string>,
    /**
     * ⚑ Filled with each conversation whose work it names while that work waited on background
     * work — after a crash, the work that died with the app.
     */
    diedInTheBackground?: Set<string>,
    /**
     * ⚑ **The conversations a continuation of their cut turn will start** — none of their work is
     * named: the continued turn drives it, and nobody is told it stopped unless the continuation
     * does not go.
     */
    continuing?: ReadonlySet<string>,
  ): number
  /**
   * ⛔ **612 · `escalationsDue` stood here and is GONE** (HO-088 §3.1) — with
   * `RequestEscalationDue`, `escalationsDueNow` and the only producer of
   * `RequestEscalatedEvent` this app ever had — a type this file no longer needs to name, which
   * is the import `612` removed beside the code.
   *
   * ⚑ **It answered *which routed questions have gone unanswered past their deadline*** and the
   * HOST wrote the rows, because ordinals have an owner. ⚠️ **Nothing asks that question now**:
   * the PO ruled that a clock may not decide a parent failed to answer, for the same reason one
   * may not decide a child failed (`HO-018` §2.1) or a person did (`HO-082` §2).
   *
   * 🔴 **{@link SessionStore.questionsAPersonMustAnswer} still reads `escalatedAt`**, and that is
   * deliberate: a ledger written before `612` holds stamps, every one of them a question a person
   * really was told about, and dropping the arm would delete answerable rows from a person's
   * queue.
   */
  /**
   * 🔴 **Every open question that is a PERSON's to answer, whichever way it became one** (398,
   * criterion 11 · 611, HO-090 §4).
   *
   * ## ⛔ 611 · it was `escalatedQuestions`, and the name had become one of two causes
   *
   * ⚠️ **Its population was *a question a deadline has already made a person's*.** ⛔ `HO-088` §2
   * added a second way — an asker that ADDRESSES its question to a person — and a reader admitting
   * only the first would have left those rows in NO population at all: not here, and not in
   * {@link decisionsAwaitingAPerson}, which selects on the channel's refusal. ⚑ **That hole is
   * what `HO-090` §4's *same queue item* names**, and the name now says the question it answers
   * rather than one of the answers (`a-column-name-is-a-claim`).
   *
   * ⛔ **Across every conversation, because a person is not inside one family.** {@link
   * questionsRoutedTo} answers a parent about its own children; this answers *"what is waiting on
   * somebody at all"*, which is a different question and has no parent to be scoped by.
   *
   * ⚠️ **The FOLD decides, as everywhere else here.** The SQL finds candidate ledgers; whether a row
   * is still open and whether it was ever escalated are both properties of a derivation, and a
   * predicate that tried to answer them would be `deriveRoutedRequests` written a second time.
   *
   * ## ⚑ 453 · a {@link LedgerWalk} rather than a bare list, and the reason is the EMPTY case
   *
   * ⛔ **`rows: []` used to be the same bytes whether every ledger in the workspace had been walked
   * or none had** — see `LEDGER_WALK_KINDS`. The walk now says which candidate set it started from, how
   * many ledgers it opened and how many ledger ROWS it could not read.
   */
  questionsAPersonMustAnswer(
    /** ⚑ **D-017 · R8** — the answer's own set, when a caller reads more beside this walk. */
    unread?: RowsUnread,
  ): LedgerWalk<RoutedRequest>
  /**
   * 🔴 **Every open routed request that NEVER travelled** (403, from `402` F1) — what only a person
   * may settle, across every conversation this database holds.
   *
   * ## ⛔ Why it is a second reader and not an argument to the first
   *
   * ⚠️ **{@link questionsAPersonMustAnswer} carries criterion 10's negative and must go on carrying
   * it.** Its population is *a question that is a person's with nothing refused* — and a permission
   * cannot be in it, structurally, because that reader excludes
   * {@link WhereARequestWent}'s refused arm by name. ⛔ Widening that predicate would widen every
   * question the field answers, and one of them is *may a parent be handed this?* So the strict
   * one stays strict and this is the named second one.
   *
   * ⛔ **611 · that sentence read *"and a permission cannot be in it… because `escalationsDue`
   * never returns a routing with a `because`"*.** ⚠️ It was true and it was an argument about a
   * DEADLINE, and the reader beside it no longer admits only what a deadline stamped — so the
   * exclusion is now stated where it is enforced rather than inherited from a sweep.
   *
   * ## 🔴 There is no deadline here, and there is nothing for one to mean
   *
   * ⛔ **A request refused entry to the channel was ALWAYS a person's**, so there is no parent that
   * failed to answer in time and nothing an escalation would record. ⚑ **The age a surface shows is
   * {@link RoutedRequest.at}** — how long this has been waiting on somebody at all — and the row is
   * a person's from the instant it is written rather than one window later.
   *
   * ## ⚠️ Every refusal, not the one the briefs talk about
   *
   * ⛔ **{@link permissionShaped} is the selector**, so this admits all five members of
   * `ChannelRefusal` — a permission decision, a grant of access, a consent with nothing to answer,
   * a shape this app has not been taught, and a secret only a person can type. ⚑ Each is a
   * different sentence to a reader and the same fact about who may settle it; a reader that matched
   * `'a-permission-decision'` alone would be blind to four of them and would go on being blind as
   * the vocabulary grows.
   *
   * ⚠️ **The FOLD decides**, as everywhere else here — the SQL finds candidate ledgers and
   * `deriveRoutedRequests` says whether a row is still open.
   *
   * ⚑ **453 · a {@link LedgerWalk}**, for {@link questionsAPersonMustAnswer}' reason exactly, and carrying
   * the SAME walk word because it is the same candidate query over the same event type.
   */
  decisionsAwaitingAPerson(
    /** ⚑ **D-017 · R8** — the answer's own set, when a caller reads more beside this walk. */
    unread?: RowsUnread,
  ): LedgerWalk<RequestOnlyAPersonCanSettle>
  // ── the tree (D-016) ──────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **Take the next number under one piece** — `work_sequence(parent)` plus one, in its own
   * transaction.
   *
   * ⛔ **Taken before the brief is sent, and burned if it never is** (D-016 · R4): the owner is told its
   * label in the brief's sender line, so the number has to exist first. A give whose send then fails
   * leaves a gap, which is honest — a counter never hands a number out twice.
   */
  numberUnder(parent: string): number
  /**
   * 🔴 **A given piece, or one taken on for a person (D-016 · commit 6): its `work` row, its
   * inputs' `work_resource` rows and its opening `work_given` row in the OWNER's ledger, in ONE
   * transaction** — so a crash cannot leave a row with no life or a life with no row, and a give
   * that never lands keeps no inputs.
   *
   * ⚑ **A give's is called once the brief is delivered or held** (D-016 · R4), naming the owner the
   * brief actually reached; a piece taken on is written as its owner takes it, and nothing is sent.
   * The ordinal is the caller's, as for every append to a ledger this app is running.
   */
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
  /** One `work` row by its id, or `null`. */
  workById(piece: string): WorkRow | null
  /** Canonical labels and current titles, with one retitle walk per owner. */
  activityWorkNames(
    pieces: readonly string[],
  ): ReadonlyMap<string, { readonly label: string; readonly title: string | null } | null>
  /**
   * One `work` row by its label — `W1.4.2` is the root numbered 1, then 4 under it, then 2 under
   * that: one indexed probe per level. `null` for a label that names none, or is not a label.
   */
  workByLabel(label: string): WorkRow | null
  /** The root this conversation owns, or `null`: a conversation another one started owns none. */
  rootOf(conversation: string): WorkRow | null
  /**
   * Every conversation with no parent that owns no root, and the identity it runs as: only a
   * service's start makes one ({@link NewSessionRecord.service}).
   */
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
  /**
   * 🔴 **A root's title and status line — its newest `work_retitled` and `work_status_set`**, in
   * its owner's active generation, read through `events_work_idx`.
   *
   * ⛔ **A root is never a folded piece** (D-016 · R1): no `work_given` opens it, so the fold has no
   * row for it, and its state is its conversation's. ⚑ These two lines are all its own record
   * holds.
   */
  rootDoneCondition(root: string): string | null
  rootLines(root: string): { readonly title: string | null; readonly statusLine: StatusLine | null }
  /** Root lines for the closing block: null means unread, rather than absent. */
  turnBlockRootLines(
    root: string,
  ): { readonly title: string | null; readonly statusLine: StatusLine | null } | null
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names a conversation**: the root it owns — its label
   * and newest title, `null` until titled — or, owning none, ⚑ **F033** the newest OPEN piece it
   * holds and how many more it holds open, else the piece that ENDED LAST, marked with how it ended
   * (`theWorkThatNamesItAmong`); `null` when it holds none. ⚑ Through the existing indexes: the root
   * and its title are two probes (`work_one_root_per_conversation_uq`, `events_work_idx`) and are
   * read every time; a piece is the owner's fold, remembered until its ledger grows.
   *
   * ⛔ **A name is never a door** (D-017 · R8): a ledger whose fold throws names nothing — `null`,
   * warned, and noted in `unread` when one is handed in — so one bad ledger stops neither a listing
   * nor a sentence that names its conversation.
   */
  workThatNames(
    conversation: string,
    /** ⚑ {@link piecesOwnedBy}'s counted door: a reader that reports what it could not read. */
    unread?: RowsUnread,
  ): WorkThatNamesIt | null
  /**
   * {@link workThatNames}, and the newest open piece the conversation holds when its fold reads it
   * as waiting on purpose (`null` otherwise) — both from one read of its pieces, kept until its
   * ledger grows. ⚑ For a root owner, the pieces it took on. ⛔ Raw: a caller composes the piece
   * ({@link composeWhatEachPieceIsWaitingOn}) before it says it waits on purpose.
   */
  workThatNamesAndItsWait(
    conversation: string,
    unread?: RowsUnread,
  ): {
    readonly named: WorkThatNamesIt | null
    readonly waitingOnPurpose: PieceRow | null
  }
  /**
   * 🔴 **F033 · the work that names a conversation in a sentence about ONE piece** — a question
   * asked under it, an answer to that question, a message that gives, drives or reports on it: its
   * root, when it owns one, else its OWN piece on that piece's chain — the piece itself when it
   * holds it, else the nearest above it that it holds — by its label and title, with no word on how
   * it ended and no count of more. ⛔ Never what it holds now: an old question read as asked under
   * the asker's newest piece. ⚑ With none of its own on the chain, it is {@link workThatNames}.
   */
  workThatNamesUnder(
    conversation: string,
    /** The piece the sentence is about, by id. */
    piece: string,
    unread?: RowsUnread,
  ): WorkThatNamesIt | null
  /**
   * ⚑ **{@link workThatNamesUnder}, where it folds no ledger**: a conversation's root, else its own
   * piece on that piece's chain, both read off the work table — and `null` where it has neither.
   * ⛔ Never the piece that names it now, which is found by folding its ledger: for a reader that
   * must not wait on a fold.
   */
  workOnItsChainThatNames(conversation: string, piece: string): WorkThatNamesIt | null
  /** The rows given under one piece, by number — rows, not folded. */
  childrenOf(piece: string): readonly WorkRow[]
  /**
   * **How far below the work a person gave a piece sits** — a root is 0, and so is a piece its
   * owner took on for a person (`W1.2`, D-016 · commit 6); `W1.1` and `W1.2.1` are 1. One read per
   * level, up `parent_id`; give's depth rail counts on this.
   */
  depthOf(piece: string): number
  /**
   * 🔴 **D-016 · commit 6 · R4 — the piece `owner` holds that `piece` is, or hangs under at any
   * depth** — the piece itself, or its giver's piece above it — or `null` when none up its chain is
   * `owner`'s. ⚑ One read per level (`chainUp`, bounded as a label's walk is). ⚠️ A chain this
   * database cannot walk answers `null`, warned.
   */
  pieceOfItsChainHeldBy(piece: string, owner: string): string | null
  /**
   * **The pieces one conversation OWNS, folded from its ledger** (379, as tasks).
   *
   * ⚠️ **Narrow by construction**, on 053's rule: the event types the fold acts on, from its first
   * `work_given` row onward — or from the drive and the background levels that row was written
   * under (D-016 · commit 6) — and never the whole session. A conversation that was never given a
   * piece — a root owner that has taken nothing on among them — reads no rows at all.
   * ⛔ **Never a root** (D-016 · R1): a root has no `work_given`, so the fold opens no row for it.
   */
  piecesOwnedBy(
    owner: string,
    /**
     * ⚑ **671 · R18 — where a COUNTED answer writes down what this read could not** — see
     * {@link RowsUnread}. ⛔ Optional because only a caller with somewhere to put the count passes
     * one; every other caller skips a torn row with a warning.
     */
    unread?: RowsUnread,
  ): readonly PieceRow[]
  /** {@link piecesOwnedBy}, OPEN only ({@link TASK_IS_OPEN}). ⛔ Never a root (D-016 · R1). */
  turnBlockPiecesOwnedBy(owner: string, unread?: RowsUnread): readonly PieceRow[]
  openPiecesOf(owner: string, unread?: RowsUnread): readonly PieceRow[]
  /**
   * **The newest conversation one of `parents` started as the identity `profileSlug`**, or `null`
   * — give's lookup, over the rows (`provider_session_parent_identity_idx`). ⚠️ Rows only: a start
   * still in flight has no row yet, and is the host's to see.
   */
  newestChildAs(
    parents: readonly string[],
    profileSlug: string,
    provider?: Provider,
    except?: readonly string[],
  ): string | null
  /**
   * 🔴 **D-024 · R1 — the conversations the identity `profileSlug` runs, newest activity first**,
   * each with the conversation that started it (`null`: a person) — through
   * `provider_session_identity_idx`, ordered by `updated_at`, which every appended row moves (the
   * rail's own order), so no ledger is read to rank them. ⚠️ Rows only: a conversation adopted
   * from the user's own home (`~/.claude`, `~/.codex`) carries no identity and is in no identity's
   * list; one adopted from a profile's home, or imported with a profile (a bundle with no profile
   * field imports as the default), is that identity's, and is listed and read as any other.
   * ⚑ **F009 · with when each was created and when its row last moved**, off the same row.
   */
  conversationsOf(profileSlug: string): readonly {
    readonly conversation: string
    readonly parent: string | null
    readonly startedAt: number
    readonly lastActiveAt: number
  }[]
  /**
   * 🔴 **F009 · the newest pieces held in some conversations, and how each stands** — at most
   * `limit`, the newest given first, and how many there are in all.
   *
   * ⚑ **Bounded by the answer, never by the ledgers**: one read of `work` by holder
   * (`work_owner_idx`) for the newest rows and one for the count — a root is never one: it is its
   * conversation's own work and never ends — then each conversation holding one of those, and no
   * other, folded once through the naming memo ({@link workThatNames}'s), which keeps a fold until
   * that ledger grows. ⚠️ A piece its holder's fold has no row for (a torn `work_given`) is left out
   * of `rows` and still counted in `newest`, and the rows a fold could not read are noted in
   * `unread`; ⛔ a ledger whose fold throws folds to no pieces, warned and noted there: one bad ledger
   * never stops a record.
   */
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
  /**
   * ⚑ **F009 · the piece a conversation was started with** — the piece the first message of its
   * first `user_turn` gave ({@link theMessagesOf}), by id: a give's brief is a new conversation's
   * first turn, and only a brief (or a new brief) names a piece it gives. `null` when its first words
   * gave none — a conversation a message started, as one standing in another's place usually is —
   * when it has received nothing, and when that row cannot be read (noted in `unread`). ⚑ One read,
   * walked forward from the start of its ledger to the first message it received.
   */
  pieceItWasStartedWith(conversation: string, unread?: RowsUnread): string | null
  /**
   * 🔴 **Keep a resource's row** — the file is already at `<resources>/<sha256>/<name>`. ⚠️ Not a
   * transaction of its own: a reply writes its resources and its `work_replied` row in one;
   * `update_work`'s files are rows alone, in one `atomically`. A give's inputs are
   * {@link recordGive}'s. ⚑ **D-026 · R2 — always with its title**, taken as it was kept.
   */
  addResource(
    input: Omit<ResourceRow, 'resource' | 'createdAt' | 'title'> & { readonly title: string },
    at: number,
  ): ResourceRow
  /** The resources kept for one piece, oldest first. */
  resourcesOf(piece: string): readonly ResourceRow[]
  /**
   * 🔴 **D-026 · R1 — the files kept in one scope** ({@link KeptFilesAsked}): a tree, what one
   * conversation added, or one piece — each on its piece, named by its label and the title it stands
   * under now, with the identity that added it.
   *
   * ⚑ **In label order, then oldest first within a piece** — a piece before the pieces under it,
   * siblings and roots by number — the order the labels give every surface. Resource rows are
   * named by each owner's canonical piece fold, with one fold and one indexed retitle read per
   * owner. The whole scope is returned, without a page or limit.
   */
  filesKept(asked: KeptFilesAsked): readonly KeptFileRow[]
  /** Both opening lists, named in one pass over their union. */
  filesKeptTogether(asked: Extract<KeptFilesAsked, { scope: 'tree' }>): {
    readonly tree: readonly KeptFileRow[]
    readonly added: readonly KeptFileRow[]
  }
  /**
   * 🔴 **D-024 · R3 — the files the identity `profileSlug`'s conversations MADE**, newest first, at
   * most `limit` of them, and how many there are in all: role `made` on a piece one of its
   * conversations owns (`provider_session_identity_idx`, `work_owner_idx`, then
   * `work_resource_work_idx`). ⚑ **D-026 · each on its piece, named as {@link filesKept} names it.**
   */
  madeBy(
    profileSlug: string,
    limit: number,
  ): { readonly rows: readonly KeptFileRow[]; readonly total: number }
  /**
   * 🔴 **D-037 · a page of the files kept in a scope, newest first** ({@link KeptFilesPaged}) — kept
   * before the file `olderThan` names when it names one, at most `limit`, each on its piece as
   * {@link filesKept} names it.
   *
   * ⚑ **Newest is the order this app kept them in** — the row's place in `work_resource`, which
   * nothing rewrites — so a page boundary neither repeats nor skips a file, and a page everywhere is
   * read from the end of the table and never sorted. ⚑ **Only the rows on the page are named**:
   * naming walks each piece owner's work rows ({@link filesKept}'s cost — measured at 554 ms for
   * 9,960 files on 5,040 pieces), so a caller pages and never names a whole store.
   */
  keptFilesNewestFirst(
    asked: KeptFilesPaged,
    page: KeptFilesFrom,
  ): {
    readonly rows: readonly KeptFileRow[]
    /**
     * ⚑ The id of the last file the page read, named or not — where the next page begins — or
     * `null` when it read none.
     */
    readonly through: string | null
  }
  /**
   * ⚑ **D-037 · how many files in a scope were kept before the file `olderThan` names** — counted
   * up to `cap` and no further, so a count costs what `cap` rows cost and never what the store
   * holds.
   */
  keptFilesBefore(asked: KeptFilesPaged, olderThan: string, cap: number): number
  /** One resource by its id, or `null`. */
  resource(id: string): ResourceRow | null
  /**
   * ⚑ **F046 — files kept before titles were taken** (`title` NULL), oldest first, at most `limit`:
   * what `RuntimeHost.titleTheOlderFiles` titles once, from their kept bytes.
   */
  untitledResources(limit: number): readonly ResourceRow[]
  /**
   * ⚑ **F046 — a title for a file kept before titles were taken**, written only while it has none:
   * a title taken as the file was kept is never replaced. Answers whether it wrote one.
   */
  titleResource(id: string, title: string): boolean
  /**
   * ⚑ **The files whose title an older reader may have given**: titled by their name, or kept before
   * `keptBefore` (epoch ms) — in the order they were kept, after the row `after` (`0` for the first
   * page), at most `limit`, each with its row's place, for the next page. ⚑ What
   * `RuntimeHost.titleTheOlderFiles` reads again: a file kept while its front matter's title was not
   * read was titled by its first heading or its name.
   */
  titledResources(
    after: number,
    limit: number,
    keptBefore: number,
  ): readonly { readonly at: number; readonly row: ResourceRow }[]
  /**
   * ⚑ **A new title for a file, written only while its title is still `was`** and the new one
   * differs: whatever wrote a title since the caller read it is never overwritten. Answers whether
   * it wrote one.
   */
  retitleResource(id: string, was: string, title: string): boolean
  /**
   * 🔴 **Every digest-eligible ledger row inside `[from, to)`, from every conversation this app
   * placed** (438, HO-025 §2 criterion 16/19; one list since D-016).
   *
   * ## ⛔ A reader bounded by a CLOCK, and it says so rather than implying a pattern
   *
   * ⚠️ **Most `events` reads here are bounded by `session_id` + `generation`, narrowed by
   * `type IN (…)` and floored by an `ordinal >= (SELECT min(…))` subquery**. `created_at` is carried OUT as
   * {@link PersistedEvent.at} and filtered in JavaScript afterwards, by every one of them. ⛔ **There
   * is no time index to lean on** — `events` is indexed on `(session_id, generation, ordinal)` and
   * on `session_id`, and `432` measured what that costs: the window read is approximately linear in
   * the old rows, because `created_at` and `type` are residual filters after the seek.
   *
   * ## ⛔ The generation is resolved PER ROW, in SQL, and that is load-bearing
   *
   * ⚠️ Every sibling read that asks about ONE conversation threads {@link activeGeneration} as a
   * bind parameter. This asks about many, so the active generation is a correlated
   * `coalesce((SELECT active …), 0)` on the row's own session — the same `?? 0` default, written
   * where the row is. ⛔ **Without it a rebuilt
   * conversation's superseded rows land in the window beside the live ones**, timestamped
   * identically, and the digest counts the same work twice.
   *
   * ## ⚠️ It finds rows. It decides nothing.
   *
   * ⛔ **The FOLD decides**, which is this file's rule stated four times over. A row is returned
   * because its type is in the digest vocabulary and its stamp is in the window; whether it
   * becomes an `observed` line, a `claimed` one or a gap is `main/runtime/digest.ts`'s answer.
   */
  digestWindow(from: number, to: number): LedgerWalk<DigestRow>
  /** The same vocabulary, materialized only inside this exact window and never cached. */
  activityWindow(from: number, to: number): LedgerWalk<DigestRow>
  /**
   * ⛔ **How many conversations no agent of this app holds** (438) — counted so the digest and the
   * forest can say what they do not cover.
   *
   * ⚠️ **A conversation swept out of the user's own provider home has no identity of ours and is
   * given none**, so neither read can reach it. ⚑ Reporting the count turns an invisible exclusion
   * into a disclosed one, which is HO-024 §5.3 applied to the READ rather than to a row: omission
   * is indistinguishable from nothing-happened.
   */
  conversationsHeldByNoAgent(): number
  /**
   * 🔴 **Every conversation this app has PLACED, with the work each one holds** (637) — see
   * {@link TheWholeForest}, which carries the whole argument.
   *
   * ## ⛔ Why the LIMIT is an argument and not a constant in this file
   *
   * ⚠️ **`MAX_FOREST_CONVERSATIONS` is on the WIRE** — `the-whole-forest.ts` — and it is there
   * because `WALK_COVERS`' own sentence spells it for a person. ⛔ A second copy here would be
   * `169` §1's drift with a number in it; the host passes the one value, and
   * `the-whole-forest.test.ts` §4 pins the sentence against the constant.
   *
   * ⚑ **The bound is not defaulted.** `a-script-with-an-optional-target-defaults-to-the-live-one`
   * is the shape of that mistake one tool over: an optional limit here would make *every row* the
   * answer a caller gets by forgetting, which is the one answer this read must never give by
   * accident.
   *
   * ## ⚠️ What `[]` means, three ways
   *
   * ⛔ **The walk word carries it and `rows.length` carries none of it.** `no-ledger` is *this app
   * has no database*; `every-conversation-this-app-placed` with no rows is *this app has placed no
   * conversation anywhere*. ⚑ There is no third word here — no id was asked about, so there is
   * nothing for `no-such-conversation` to be about.
   *
   * ⚑ **`ledgers` is the number of conversations DRAWN**: the candidate set is the answer, one
   * conversation one ledger. ⛔ **How many there
   * ARE is a separate read** — {@link placedConversations} — because past the bound those two
   * numbers differ and `rows.length` would answer the wrong one.
   */
  everyPlacedConversation(limit: number, hidden?: readonly string[]): LedgerWalk<ForestedNode>
  /**
   * ⚑ **How many conversations this app has placed** (637) — the population
   * {@link everyPlacedConversation} and {@link digestWindow} draw from, counted before any bound.
   *
   * ⛔ **Not derived from a walk and not the whole table.** The first would answer *what was
   * drawn*; the second would include the `agent_identity_id IS NULL` population that the forest's
   * JOIN excludes and {@link conversationsHeldByNoAgent} counts.
   */
  placedConversations(hidden?: readonly string[]): number
  /**
   * 🔴 **The pieces one conversation GAVE, in the order they were given** (393; D-016).
   *
   * ⛔ **Derived, like every other piece question** — the owners are read off `work` (the rows
   * whose giver is this conversation) and each owner's ledger is FOLDED; the fold's `giver` is what
   * decides, so a row the table names and the fold does not is caught rather than inherited.
   *
   * ⚑ **This is the surface `393` §5's *"a derived state a parent can see"* rests on**, and the
   * only one that survives its child: `list_agents` reads live slots, and a conversation that ended
   * with work unfinished has none. ⛔ Its `silent` and `abandoned` rows are what a parent would
   * otherwise wait on for ever.
   */
  piecesGivenBy(
    sessionId: string,
    /**
     * ⚑ **671 · R18 — where a COUNTED answer writes down what this read could not** — see
     * {@link RowsUnread}. ⛔ Optional because only a caller with somewhere to put the count passes
     * one — since `676` the host's `list_tasks` and plates-and-rail answers, through their wait
     * reads; every other caller skips a torn row with a warning.
     */
    unread?: RowsUnread,
  ): readonly PieceRow[]
  /**
   * 🔴 **The work one conversation gave out, as the WINDOW that gave it reads it** (508) — the same
   * derivation {@link piecesGivenBy} answers, walked rather than listed.
   *
   * ⛔ **A {@link LedgerWalk} and not an array**: a ledger row that could not be parsed is COUNTED,
   * so a person reading *what did I hand out* is told when the answer is short — `453`'s ruling on
   * a list of obligations.
   *
   * ⚠️ **Rows are narrowed to {@link WorkGivenOut} rather than handed over as {@link PieceRow}** —
   * see that interface for why, and `WorkReport`'s *"every field is READ"* rule for whose it is.
   */
  workGivenOutBy(sessionId: string): LedgerWalk<WorkGivenOut>
  /**
   * 🔴 **Every conversation this app recorded one conversation as having STARTED** (543,
   * `540` §7 slice 1) — the other end of {@link parentOf}'s edge.
   *
   * ## ⛔ Why it is a walk and not an array
   *
   * ⚠️ **`rows: []` is three different facts** and only {@link LedgerWalk.walk} tells them apart:
   * `no-ledger` is *this app has no database*; `no-such-conversation` is *this app holds no
   * conversation by that id*; `every-conversation-this-one-spawned` with no rows is *that
   * conversation spawned nothing*. ⛔ **Drawing the first two as the third is `452` §5.1's
   * forbidden sentence one noun over** — *nothing was spawned from here*, out of a failure.
   *
   * ⚑ **{@link LedgerWalk.rowsUnread} is always 0 here**: the edge is the parent column alone, so
   * there is no partial row for this end to refuse.
   *
   * ⚑ **No ledger is opened at all**, so nothing here is folded from a transcript and this reader
   * costs one indexed lookup plus one indexed range scan. See `LEDGER_WALK_KINDS`' own entry.
   */
  spawnedBy(sessionId: string): LedgerWalk<SpawnedConversation>
  /** A conversation and every conversation below it (`conversation-tree.ts`): itself first. */
  conversationTree(root: string): string[]
  /** What ties a tree's conversations to conversations outside it (`conversation-tree.ts`). */
  whatTiesTheTreeOutside(tree: readonly string[]): TiedOutside[]
  /** Every provider session a conversation had, by the ids its provider's files are named by. */
  providerSessionsOf(conversation: string): ProviderSessionOf[]
  /** Deletes every row of a tree's conversations, in one transaction (`conversation-tree.ts`). */
  deleteTheTree(tree: readonly string[]): TreeDeleted
  /**
   * ⚑ **Which agent one conversation belongs to, or `null` because this app holds no row for that
   * id** (543) — see {@link ConversationBinding} for why {@link identityOf} could not answer it.
   */
  conversationBinding(sessionId: string): ConversationBinding | null
  /**
   * 🔴 **The work one conversation gave out, as an EDGE that names both ends** (543) — the same
   * candidate set and the same fold {@link workGivenOutBy} walks, mapped to the shape that carries
   * the recipient's conversation id.
   *
   * ⛔ **Two mappings over ONE walk, and that is the whole of the difference between them.** The
   * candidate query, the fold, the `giver` filter and the order are `walkWorkGivenBy`'s and are
   * written once: a second copy would be free to narrow differently, and *"what did I hand out"*
   * would have two answers.
   *
   * ⚠️ **`WorkGivenOut` was not widened instead, and its own docblock is why**: it says *"No session
   * id … a conversation id here would be a field with no reader"*, which was true of the Work tab
   * and is not true of a relationship panel. ⛔ Widening a durable wire shape to serve a second
   * surface is how a row comes to carry fields half its readers ignore — `WorkReport`'s standing
   * rule, quoted there.
   */
  workThisOneGaveOut(sessionId: string): LedgerWalk<WorkEdge>
  /**
   * 🔴 **The work one conversation WAS GIVEN, as the same edge** (543) — its own ledger, read whole,
   * and every row COMPOSED (`664`) as {@link workThisOneGaveOut}'s are.
   *
   * ⚠️ **The composition reads beyond that ledger, and since `671` the count follows it**: an OPEN
   * row's state asks what the holder is waiting on — its routings, its questions, and the
   * ledgers of the work it gave out — and an unreadable row in one of those is COUNTED into
   * {@link LedgerWalk.rowsUnread} (`RowsUnread`, R18). ⛔ Until `671` it was skipped uncounted or,
   * where the SQL read into the payload, RAISED (`664` F1). ⚑ `ledgers` does not follow it: it is
   * the one ledger WALKED, below.
   *
   * ⛔ **One ledger WALKED, always, and {@link LedgerWalk.ledgers} is therefore always 1.** {@link
   * PieceRow.owner} is *the ledger this row was folded from*, so the work given TO a conversation is
   * exactly the work its own ledger holds — which is why this is not {@link workThisOneGaveOut} with
   * the arguments swapped and could not be.
   *
   * ⚑ **Both identities are read HERE and not passed in**, so a caller cannot name one conversation
   * and hand over another's slug: the owner's once, and each giver's once per walk.
   */
  workThisOneWasGiven(sessionId: string): LedgerWalk<WorkEdge>
  /**
   * 🔴 **The pieces this conversation has already been TOLD are not being driven** (404,
   * criterion 4) — its `work_stall_told` receipts, read off its OWN ledger, which is what makes the
   * answer survive a restart.
   *
   * ⛔ **`400` asked this question of the owner's rows and it is the wrong ledger to ask.** A piece
   * carried into a new slot already `stalled` was taken as *already reported*; for
   * `TaskStallCause.app_restarted` that is provably false, because the row is written at
   * construction when nothing is running and nobody can have been told. ⚑ `402` measured the
   * consequence: `1 inbound row on the pm; "is not being worked on" ABSENT`.
   *
   * ⚠️ **A receipt whose held message was later abandoned does NOT count** — see
   * {@link WorkStallToldEvent.messageId}. ⛔ A set of pieces, which is `400`'s ruling that a giver is
   * not told again when the cause moves: it is told once per piece (D-016c).
   */
  workReportedTo(sessionId: string): ReadonlySet<string>
  /** A pre-upgrade ordinary stall covered by a standing notice in its giver lineage. */
  legacyOrdinaryStallWasReported(owner: string, piece: string, giver: string): boolean
  /**
   * **The requests one conversation RAISED**, derived from its ledger (394).
   *
   * ⚠️ **Narrow by construction** — see `selectRoutedRequestEvents`. A conversation that has never
   * raised one while it had a parent reads no rows at all.
   */
  routedRequestsOf(
    sessionId: string,
    /**
     * ⚑ **671 · R18 — where a COUNTED answer writes down what this read could not** — see
     * {@link RowsUnread}. ⛔ Optional because only a caller with somewhere to put the count passes
     * one — since `676` the host's `list_tasks` and plates-and-rail answers, through their wait
     * reads; every other caller skips a torn row with a warning.
     */
    unread?: RowsUnread,
  ): readonly RoutedRequest[]
  /**
   * 🔴 **Every request routed to this conversation by something it spawned** (394) — the parent's
   * side, and the scope `answer_question` is entitled to.
   *
   * ⛔ **It contains the ones a PERSON has to answer as well**, and that is criterion 10's
   * instrument rather than a leak. `394` §2: a filter justified by *"we never see permissions here"*
   * blinds the instrument that would show you one — so the routing is recorded on both arms, this
   * reader finds both, and `admitAnswer` refuses the permission-shaped ones BY NAME. ⚑ A rail
   * nothing can reach passes vacuously; this is what makes that one reachable.
   *
   * ⚠️ **Ordered by when each was routed**, so the parent reads them the way they happened.
   */
  questionsRoutedTo(
    parentSessionId: string,
    /**
     * ⚑ **676 — where a COUNTED answer writes down what this read could not** — see
     * {@link RowsUnread}. ⛔ Optional: only `list_questions` has somewhere to put the count; the
     * answer door and `pass_question_up` are rails, and a torn routing they meet is warned.
     */
    unread?: RowsUnread,
  ): readonly RoutedRequest[]
  /**
   * ⚑ **F036 — every conversation that has routed a question to another, and to which** — each
   * (asker, parent) pair once, off the routings' own index: read ONCE per app run, to seed the
   * host's index of who may owe whom an answer, which every later routing keeps up to date. ⚠️ A
   * torn routing names no parent and is left out, ⚑ and so is a routing to a person: the parent it
   * names may still answer it, but does not owe it.
   */
  whoRoutedToWhom(): readonly { readonly asker: string; readonly parent: string }[]
  /**
   * The conversations holding a question passed up from `requestId` — a copy of it, as
   * `pass_question_up` writes one — off the question rows themselves, whatever a routing row says.
   * ⚑ A request id this app mints names one question in the whole workspace. ⚠️ Candidates: the
   * conversation's own read of its questions decides, in its active generation; a row that is not
   * JSON names nothing here, and that read counts it.
   */
  conversationsHoldingACopyOf(requestId: string): readonly string[]
  /**
   * ⚑ **F026 — how one question this conversation asked was decided, and by whom** — the newest
   * `user_decision` its ledger holds for that id: its outcome, and its actor ({@link ActedBy}, `null`
   * on a row that names none). `null` while nothing decided it.
   */
  generationOf?(sessionId: string): number
  latestMoveOffer?(sessionId: string): import('../../shared/runtime-ipc').QuestionAskedEvent | null
  theDecisionOn(
    sessionId: string,
    requestId: string,
  ): {
    readonly outcome: string
    readonly by: ActedBy | null
    readonly movedTo?: MoveReceipt
  } | null
  /**
   * The provider's request a routing row names, as its card was drawn from it, or `null` when the
   * ledger holds none.
   */
  theRequestRouted(sessionId: string, requestId: string): ProviderRequestEvent | null
  /**
   * 🔴 **The WORDS of the questions one conversation raised, by request id** (396).
   *
   * ⛔ **What makes `list_questions` a door rather than a list of ids.** A question a parent was not
   * live to receive reached it as no message at all, so the id alone names something it cannot
   * answer: `answer_question` takes one entry per PART, and the part ids are in the request. ⚑ Read
   * back from the request's own row, so a parent reads the words the card was drawn from.
   *
   * ⚠️ **`user_input_request` only.** A permission's text is a person's to read — see
   * `selectQuestionsRaised`.
   *
   * ⛔ **LAST wins for a repeated id, which is the same rule `RuntimeHost.answerQuestion` takes.**
   * `394` §5 measured that a request id is unique per PROVIDER SESSION and a resumed conversation is
   * a new one, so one ledger can hold `ui_1` twice — once per life. ⚑ The rows are walked in ordinal
   * order and the later one overwrites, so the words a caller reads belong to the LIVE request,
   * which is the only one it can answer.
   *
   * ⚠️ **The cost is stated rather than hidden**: a CLOSED row carrying the same id then reads the
   * newer question's words. Nothing can be done about that from a map keyed by an id the provider
   * reuses, and it costs nobody an action — the closed row is refused at the answer door by name.
   */
  questionsRaisedIn(
    sessionId: string,
    /**
     * ⚑ **671 · R18 — where a COUNTED answer writes down what this read could not** — see
     * {@link RowsUnread}. ⛔ Optional because only a caller with somewhere to put the count passes
     * one — since `676` the host's `list_tasks`, plates-and-rail and `list_questions` answers; every
     * other caller skips a torn row with a warning.
     */
    unread?: RowsUnread,
  ): ReadonlyMap<string, RaisedQuestion>
  /**
   * ⚑ **What a turn's last block says, where the store already holds it** — a conversation's own
   * routed requests, the questions raised in it, the pieces it owns, and the requests routed to
   * it, each as its fold answers ({@link routedRequestsOf}, {@link questionsRaisedIn},
   * {@link piecesOwnedBy}, {@link questionsRoutedTo}).
   *
   * ⛔ **None of them makes a fold.** Each answers only from a fold kept for that ledger and still
   * current — no row a fold reads was written to it since — and `null` otherwise: *not at hand*,
   * never *none*. ⚑ `questionsRoutedToAtHand` is `null` when the fold of any conversation that
   * routes to it is not at hand.
   */
  routedRequestsAtHand(sessionId: string): readonly RoutedRequest[] | null
  questionsRaisedAtHand(sessionId: string): ReadonlyMap<string, RaisedQuestion> | null
  piecesAtHand(owner: string): readonly PieceRow[] | null
  questionsRoutedToAtHand(parentSessionId: string): readonly RoutedRequest[] | null
  /**
   * ⚑ **When a person last wrote in this conversation**, or `null`: the newest turn that carries
   * words a person wrote, among its newest {@link PERSON_LAST_WROTE_WITHIN_TURNS} turns. ⛔ Bounded,
   * so a conversation only agents drive is not walked to its beginning; `null` is *not within
   * those*, never *never*.
   */
  whenAPersonLastWrote(sessionId: string): number | null
  /**
   * ⚑ **The requests ended while this conversation's last ENDED turn ran**, by id: the turn of
   * {@link lastEndedTurn}, and its own rows only. ⛔ A request ended with no turn open is in no
   * answer.
   */
  requestsItsLastEndedTurnInterrupted(sessionId: string): readonly string[]
  /**
   * 🔴 **How this conversation's last ENDED turn stopped, who asked, and when** (395 §1, 484).
   *
   * ⛔ **The reading a PARENT is given**, through {@link AgentCard.lastEndedTurn}: after a fault and
   * after an interruption a card's `state` is `idle` either way, so this is the only thing on that
   * surface that can tell *somebody stopped this* from *this broke*.
   *
   * ⚠️ **`null` means no closed turn**, which is a different answer from a reading of
   * `nothing-has-said` — see `lastEndedTurnOf`.
   *
   * 🔴 **484 · it names the turn's own closing time and whether anything has started since.** ⛔ The
   * narrowing on `closed_at IS NOT NULL` has been here since `395` and the VALUE never said so, so a
   * parent reading it beside a live `state` had to resolve *stale* against *an older turn* out of a
   * docblock it cannot see. See {@link LastEndedTurn}.
   */
  lastEndedTurn(
    sessionId: string,
    /**
     * ⚑ **676 · F3 — where the CARD writes down what this read could not** — see
     * {@link RowsUnread}. ⛔ Optional: only a caller with somewhere to put the count passes one
     * (`RuntimeHost.cardFor`); every other caller skips a torn row with a warning.
     */
    unread?: RowsUnread,
  ): LastEndedTurn | null
  /**
   * 🔴 **D-012 · this conversation's last exchange** (proposal §6.2) — the last message it received,
   * with its sender, and its latest main-thread words back since, in a turn still running as much as
   * in one that ended. See `shared/last-exchange.ts`: a READ of the ledger, never a record of its
   * own. ⚠️ Total: `null` halves are facts (nothing received; nothing said back yet).
   */
  lastExchange(sessionId: string): Exchange
  /**
   * ⚑ **What opened its last turn that ended** — its sender and the start of its words — or `null`:
   * no turn has ended, or no row of that turn says. For `get_agent_status`, beside
   * {@link lastEndedTurn}'s when.
   */
  whatOpenedTheLastEndedTurn(sessionId: string): ReceivedInATurn | null
  /**
   * 🔴 **D-012 · the turns a giver reads** — the last `back` messages received, each with what was
   * said back to it; or, with `search`, the last `back` turns whose words contain it (case folded).
   * ⚑ Oldest first. `older` says whether turns before the first one exist.
   */
  transcript(
    sessionId: string,
    read: { readonly back: number; readonly search: string | null },
  ): { readonly turns: readonly TranscriptTurn[]; readonly older: boolean }
  /**
   * 🔴 **The last time anybody asked this conversation's work to stop** (484, HO-031 §2.1).
   *
   * ⛔ **Scoped to the CONVERSATION and to no turn**, which is the whole reason it is a second
   * question. `turnFor` gives `work_interrupted` a `turn_id` only when a turn is open, so a Stop
   * pressed on an idle or stalled conversation is a row {@link lastEndedTurn} cannot reach — and
   * this app then recorded an actor and answered `who: null`, which is HO-031 §2.1's measurement.
   *
   * ⚠️ **`null` is *no row says*, and it is the honest absence** HO-029 §2.2 keeps: a conversation
   * nobody has ever asked to stop, and one whose ledger predates `395`, both answer it.
   *
   * ⚑ **494 · a permission answered `cancel` is such an ask, and it is here for a reason about
   * this payload rather than about that door.** ⛔ {@link AgentCard} carries this field and
   * {@link lastEndedTurn} together; `494` teaches the second to name a person for a cancel, and a
   * field beside it answering *no row says* about the same press is `484`'s own defect — two
   * neighbouring facts a reader has to choose between.
   */
  lastAskToStop(
    sessionId: string,
    /** ⚑ **676 · F3** — as {@link lastEndedTurn}'s. */
    unread?: RowsUnread,
  ): AskToStop | null
  /**
   * Append a batch into a generation that is being built. One transaction per call.
   *
   * Identical to {@link appendMany} in every rule it carries — it drives the same `appendTx`, so
   * turns, the `unknown` bound and event attribution are the ones the live path uses — except that
   * it writes into `generation` and leaves the session's durable STATUS alone. The status belongs to
   * the projection being read, and this one is not being read yet; {@link promoteGeneration}
   * reconciles it at the flip.
   */
  appendGeneration(
    sessionId: string,
    generation: number,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): void
  /**
   * Make a built generation the one every read sees — **the flip** (065).
   *
   * One small transaction whatever the size of the ledger: it writes the generation number, the
   * watermark and the normalizer version, and reconciles the session's status against the turns of
   * the projection that just became current. The rows were already written; nothing is copied here.
   * That is the whole reason for the column — an atomic promotion that does not depend on how big
   * the conversation is.
   *
   * 🔴 **Returns whether the flip HAPPENED** (293 §4, from 289 rank 3). The `building = ?` guard in
   * the statement has always refused a promotion of a generation nobody opened — but the refusal was
   * `void`, so a caller could not tell it apart from a success. `one-app.test.ts` wrote the
   * consequence down in 198 and left it: *"B clears A's `building = G`, A goes on writing rows into a
   * generation nothing will promote, `promoteGeneration` then updates zero rows — and the derive
   * still returns success, so the caller is told the import worked."* ⛔ **A caller that cannot see a
   * refusal reports it as an import.**
   */
  promoteGeneration(
    sessionId: string,
    generation: number,
    through: { normalizerVersion: number; derivedThrough: number },
  ): boolean
  /**
   * Give up on a generation being built. The active one is untouched.
   *
   * `failure` is the message a FAILED rebuild leaves for the user, or **null for a cancelled one** —
   * being asked to stop during a quit is not a fault, and recording it as one would put a red state
   * on a session because somebody closed the app.
   */
  abandonGeneration(sessionId: string, generation: number, failure: string | null): void
  /**
   * Delete up to `limit` rows of a superseded generation; returns how many went.
   *
   * Bounded because the largest measured conversation is 1.53 GB and a `DELETE` over all of it is
   * the same unbounded transaction 061 said had expired. The caller loops and yields between calls,
   * and stopping early costs disk rather than correctness — the rows are unreachable either way.
   */
  discardGeneration(sessionId: string, generation: number, limit: number): number
  /**
   * Every generation number that is not the active one — where {@link discardGeneration} should
   * look.
   *
   * ⚠️ **"Could hold garbage", not "does".** It is computed from the record (`0…highest`, minus the
   * active one) rather than scanned out of `events`, because `SELECT DISTINCT generation` over a
   * session's rows is an index walk proportional to the conversation — and this is asked on every
   * derive, including on the 1.53 GB one. Collecting a generation that is already empty costs two
   * index lookups; scanning to find out would cost the walk.
   *
   * Every number, not just the one before: a build that was abandoned and one that was superseded
   * are both garbage, and a caller that only ever cleared the previous active generation would leave
   * the abandoned ones on disk with nothing that would ever look at them again.
   *
   * **From ZERO** (073, 068 finding 5), which is where everything this app INHERITED lives —
   * `importSnapshot` writes `generation 0` and `active = 0`, as the backfill that introduced
   * generations did. A range starting at 1 could never return the old projection of such a session, so
   * the first rebuild of one kept the whole thing beside its replacement, forever. Excluding
   * `active` is what keeps that safe: 0 is a live projection at rest and a dead one after a
   * promotion, and the record says which.
   */
  deadGenerations(sessionId: string): number[]
  /**
   * This session's turns, in order (045) — the index over the ledger that makes "what happened, and
   * how did each turn end" a query rather than a scan of every event.
   */
  turns(sessionId: string): RecordedTurn[]
  /**
   * Close a turn we will never see the end of, with an honest reason.
   *
   * Called on RESUME: a turn that was open when the app quit has no ending in the ledger, and
   * nothing else would ever close it. `unknown` is the only truthful answer — we did not observe how
   * it went — and recording that is the whole reason the enum has the member.
   *
   * Returns whether there was one to close, so the caller can say so rather than assume.
   */
  closeOpenTurn(sessionId: string, reason: TurnEndReason, at: number): boolean
  /**
   * **A conversation is running again, so its row stops saying `ended`** (179).
   *
   * Terminal status persists within one life; reopening starts another. Clear the recorded terminal only when that new life begins, so {@link resumable} and the Sessions page do not describe a running conversation as ended.
   *
   * ⚠️ **Called when the new life BEGINS, not when it is attempted.** The resume path's
   * {@link closeOpenTurn} runs before the provider is asked and must not clear anything: a resume
   * that then failed would leave a row calling a session that never came back `idle`.
   *
   * ⚠️ **`idle`, not a derivation.** The orphan turn is closed before the launch, so there is
   * nothing open to derive from, and the first `status` event of the new life moves the row from
   * here — through the ONE writer 045 left. Returns whether a terminal was actually cleared.
   *
   * 🔴 **692 · and it forgets that a quit closed this conversation** (R34, `closed_by_the_quit_at`),
   * whatever the status said — unconditionally, because every reopen runs through here and a
   * conversation started again is no longer one the quit is holding open. ⚑ **That is what makes
   * R34c true of a conversation started and then CRASHED**: its stamp went at this reopen, and no
   * quit ran to write another.
   */
  reopened(sessionId: string, at: number): boolean
  /**
   * 🔴 **692 · R34a — record which conversations the QUIT closed**, once it has closed them.
   *
   * ⚑ **Its one caller is `RuntimeHost.closeAll`**, which takes the set before its first `await` and
   * hands it in after its teardown — only conversations nothing else was already ending: never one
   * a person closed or was closing, one whose provider failed or ended on its own, or one an agent
   * ended, even while the quit ran. ⛔ **One transaction**: all of them or none — and a crash before
   * the call records none, which is R34c.
   *
   * ⚠️ **It never un-stamps.** A conversation that came back open and was never spoken to is not in
   * the host's slot map at the next quit, so this is not handed it — and its stamp from the previous
   * quit is exactly the fact that is still true. See {@link whatTheQuitClosed}.
   */
  closedByTheQuit(sessionIds: readonly string[], at: number): void
  /**
   * 🔴 **692 · R34b — the conversations a quit closed that nothing has reopened since** — what a
   * launch reads to tell a quit's stop from a crash's: which held messages survive for their
   * recipient's next start, and whose open questions a launch leaves open rather than settling as
   * stranded (D-017 · R3; D-009 · F012 decision 4). ⚑ **D-030** — held messages survive wherever no
   * crash cut the life that held them, quit or not ({@link settleStrandedMessages}).
   *
   * ⚑ **Read LIVE rather than loaded once**: the stamp is cleared by the next reopen
   * ({@link reopened}), so a reader asking later is told the truth about now.
   */
  whatTheQuitClosed(): readonly string[]
  /**
   * 🔴 **The background work a restart stopped** — for each conversation the newest quit closed, and
   * each of `alsoTheseDied` (a crash's, found by the launch's sweep), the background work its newest
   * level still listed running when its life ended: what the provider called each one. ⚑ Only the
   * conversations that had any. `endedAt` is its ledger's last moment — when it stopped.
   *
   * ⚠️ **The newest quit only, and only when it is newer than `notBefore`**, never every stamp: a
   * quit's stamp stays on a conversation nothing has reopened since, and a launch must not wake a
   * conversation an older quit stopped long ago. ⚠️ **And only work its newest life listed**: a level
   * stated before its newest `launched` row is an earlier life's, which a stop already took.
   */
  /**
   * ⚑ **The launch's own restart row, for one conversation, late** — the pieces the sweep left
   * `working` because a wake-up would start their owner for a job, when that wake-up is dropped. The
   * same row {@link settleRestartedWork} writes, so the fold stalls them `app_restarted`. ⛔ Never for
   * a conversation this app is running.
   */
  restartedWorkLate(conversation: string, pieces: readonly string[], at: number): void
  backgroundTheRestartStopped(
    alsoTheseDied: readonly string[],
    /** ⚑ The launch's own moment: its ledger is read as it stood before the launch wrote to it. */
    before: number,
    /** ⚑ A quit older than this wakes nobody. */
    notBefore: number,
  ): readonly { conversation: string; stopped: readonly string[]; endedAt: number }[]
  /**
   * Record that a session is OVER — the terminal status and the ending of whatever turn was open,
   * together (051).
   *
   * The same transaction as {@link closeOpenTurn}, pointed the other way. Resume closes a turn and
   * leaves the session alive (`idle`); this closes a turn because the session itself has stopped.
   * They are one write because splitting them is how the two halves of "this is over" came to
   * disagree in the first place.
   *
   * **Why the host needs it at all.** `appendTx` terminalizes on a `status` event, and the ending
   * that matters most does not arrive as one: an event stream that FAILS produces
   * `error{fatal:true}`, which is terminal to liveness (`liveness.ts`) and to the renderer, and
   * means nothing to this reducer. The row was left at `working` with its turn still open — a
   * session that would come back from a restart claiming to be mid-turn forever.
   *
   * Terminal is permanent, as everywhere else here: a row that already says `ended` or `errored` is
   * not rewritten, so the first ending recorded is the one that stands.
   *
   * Returns whether a turn was actually abandoned — only the store can tell, and the host logs it.
   */
  terminate(
    sessionId: string,
    status: 'ended' | 'errored',
    reason: TurnEndReason,
    at: number,
  ): boolean
  /**
   * Record a whole imported conversation — the row and our ledger — in ONE transaction (051, from
   * 048 §1 finding 5).
   *
   * It exists for BUNDLE import specifically. `importBundle` wrote the session row, then one
   * committed transaction PER ledger entry, and its retry check is "does a row for
   * this provider ref exist". A failure after entry N therefore left a row whose conversation stops
   * mid-sentence, and the next attempt saw the row, said "already have it", and returned. A partial
   * transcript became the accepted history, permanently, with nothing anywhere reporting it.
   *
   * All-or-nothing removes the state that made that possible: there is no moment at which the row
   * exists and the conversation does not, so "the row exists" is no longer a claim about a write
   * that may not have finished.
   *
   * ⚠️ **The import from a provider home still commits in two steps, and is meant to.** `adopt` →
   * `deriveLedger` writes a row, then a generation in batches that is promoted in one small
   * transaction. That looks like the same shape and is not, because the state it can stop in is
   * RESUMABLE: a row with no ledger re-derives, and nothing reads a generation until it is promoted.
   * It has to stay chunked — the largest measured conversation is 1.53 GB, which is not a
   * transaction.
   *
   * **No separate validation pass.** The dispatch's direction was "validate first, then commit"; the
   * shape here is "commit inside the rules the schema already enforces". Ordinal uniqueness, the
   * `end_reason` CHECK and the foreign keys are constraints on the transaction itself, so a bad
   * snapshot rolls the whole thing back — where a hand-written pre-check would be a second opinion
   * about the same rules, free to drift from them and impossible to bypass-test.
   */
  importSnapshot(snapshot: SessionSnapshot): void
  /**
   * Where a resumed session's ordinals carry on from. Restarting at 0 would collide
   * with the rows already there and rewind the seam, so the count continues across a
   * quit exactly as if the process had never stopped.
   */
  nextOrdinal(sessionId: string): number
  lastOrdinalWrite(sessionId: string): LedgerWriteStamp | undefined
}

/**
 * For hosts that genuinely have no database — tests that are not about persistence.
 * Explicit rather than an optional dependency, so a real host cannot silently end up
 * without a store and quietly stop recording.
 */
export const NULL_SESSION_STORE: SessionStore = {
  create: () => {},
  firstLaunchOf: () => false,
  aLaunchWentUnnamed: () => false,
  adopt: () => {},
  // Null rather than a fabricated identity: a host with no database has not recorded one, and
  // answering with one would be this store claiming a row it never wrote.
  identityOf: () => null,
  // ⚑ **Null, and it is a shrug rather than `capabilitiesOf`'s answer** (419). A store with no
  // database cannot bring an identity into being, and the host turns this into the *name is
  // taken* sentence — which is wrong about WHY and right about the only thing a caller can act on:
  // nothing was created. ⛔ It is never reached in the app; `NULL_SESSION_STORE` exists so a host
  // that lost its store fails loudly rather than recording nothing.
  createAgentIdentity: () => null,
  // ⚠️ **Null is *nobody has said*, which is the answer that changes nothing** — a give that starts
  // a conversation then falls back to the giver's provider exactly as it did before this column
  // existed.
  providerOf: () => null,
  startedOnOf: () => NONE_STARTED,
  saveProviderIfNoneIsSaved: () => false,
  // ⛔ **Null, and it is the criterion-12 answer rather than a shrug** (341): a store with no
  // database has no identity by that name, so a give to it is refused as *no such profile* — which
  // is the correct refusal, arriving from the correct fact.
  capabilitiesOf: () => null,
  // ⛔ **Empty, and it is not the same shrug as `capabilitiesOf`'s null.** A store with no database
  // holds no identities, so the grant surface draws a list with nothing in it and says so — which is
  // true. ⚠️ `RuntimeHost.agentIdentities` still reports the FOLDERS beside it, so a person on a
  // host with no ledger sees exactly the honest picture: directories on disk, no identity to
  // configure, and the reason.
  agentIdentityNameById: () => null,
  reconciliationNames: () => [],
  agentIdentities: () => [],
  // Nothing was written, so nothing may be claimed to have been. A `true` here would be this store
  // attesting a grant it cannot hold.
  setCapabilities: () => false,
  // ⚑ **582 · a store with no database holds no versions**, which is the honest empty answer the
  // read's own contract already names — and the identity is echoed back so a surface can say which
  // agent it found nothing for.
  ownNotesOf: () => null,
  currentOwnNotesOf: () => null,
  writeOwnNotes: () => null,
  undoOwnNotes: () => null,
  ownNotesUnread: () => ({ seenThrough: 0, newestAgentVersion: 0, unread: false }),
  markOwnNotesSeen: () => false,
  ownInstructionsOf: (profileSlug) => ({ identity: foldProfileName(profileSlug), versions: [] }),
  // ⛔ **No configured layer, so the seam renders nothing** — never an empty heading (086).
  configuredLayerFor: () => null,
  // ⛔ **Nothing was written, so nothing may be claimed to have been** — `setCapabilities`'s `false`
  // one method up, in the shape this door answers with.
  writeOwnInstructions: () => null,
  undoOwnInstructions: () => null,
  instructionUnread: () => ({ seenThrough: 0, newestDirectVersion: 0, unread: false }),
  beginMethodChange: () => null,
  settleMethodChange: () => false,
  hasPendingMethodChange: () => false,
  methodChange: () => null,
  methodChanges: () => [],
  markInstructionsSeen: () => false,
  // ⚑ **Empty, exactly as `ownInstructionsOf` is** — a store with no database holds no record of
  // anybody amending anything, which is true of it.
  memoryAmendmentsOf: () => [],
  // ⛔ **Null, and it is criterion 12's answer rather than a shrug**, exactly as
  // `writeOwnInstructions` above: a store with no database has no identity by that name.
  writeMemoryAmendment: () => null,
  beginMemoryAmendment: () => null,
  settleMemoryAmendment: () => false,
  hasPendingMemoryAmendment: () => false,
  memoryAmendment: () => null,
  // ⛔ **No ledger, so nothing has been asked** — and `false` says that nothing was settled.
  instructionAsksWaiting: () => [],
  turnBlockCandidates: () => null,
  instructionAsksWaitingIn: () => null,
  replyQuestionWithoutARequest: () => null,
  settleInstructionAsk: () => false,
  // No ledger and no registry: nothing waits, nothing settles, and there is no server to grant.
  mcpServerRequestsWaiting: () => [],
  mcpServerRequestWasMade: () => false,
  grantExternalMcpServer: () => null,
  // ⚑ **516 · empty, and it is `agentIdentities`' shrug rather than `capabilitiesOf`'s null.** A
  // store with no database holds no registry, so the surface draws an empty list and says so — which
  // is true — and a launch resolves no servers, which is what every launch did before this build.
  externalMcpServers: () => [],
  // ⛔ **Null is *that name is taken*, and here it is `createAgentIdentity`'s shrug for its reason**:
  // a store with no database cannot register anything, and the host turns this into a sentence
  // rather than reporting a registration that did not happen.
  registerExternalMcpServer: () => null,
  // Nothing was removed, so nothing may be claimed to have been — `setCapabilities`'s `false`.
  removeExternalMcpServer: () => false,
  externalMcpServersFor: () => [],
  // ⚑ **`false`, for `setCapabilities`' reason one line up**: nothing was written, so nothing may be
  // claimed to have been, and the door turns it into the same *there is nothing here* a slug with no
  // row gets.
  setAgentProvider: () => false,
  // ⚑ **`false`, for `setAgentProvider`'s reason exactly** (558): nothing was renamed, so nothing
  // may be claimed to have been.
  setAgentDisplayName: () => false,
  // ⚑ **677 · `providerOf`'s answer and `setAgentProvider`'s `false`, one column over**: a store with
  // no database has no identity, so nobody chose anything and nothing may be claimed written.
  modelChoiceOf: () => null,
  setModelChoice: () => false,
  // ⚑ **D-042 · a store with no database holds no list of a person's**: nothing added, nothing
  // picked — and a write has nowhere to go.
  handAddedModels: () => [],
  addHandAddedModel: () => [],
  deleteHandAddedModel: () => [],
  lastPicked: () => null,
  aPersonPicked: () => {},
  // 🔒 **A store with no database holds no key**: the provider runs on its machine login, and a key
  // given to it has nowhere to be kept — said by the door that keeps one (`api-keys.ts`).
  keptApiKey: () => null,
  keepSealedApiKey: () => {
    throw new Error('there is no database to keep the API key in')
  },
  forgetApiKey: () => false,
  // ⛔ **Empty, and it is the fail-closed direction here** (558). A store with no database has not
  // learned that nothing has ever run an identity; but the only reader of that emptiness is
  // `whatHoldsIt`, and `RuntimeHost.removeAgent` reaches it only after `agentIdentities()` has
  // already answered with the same empty list — so there is no identity for an empty history to
  // make removable. ⚠️ The pair is asserted rather than reasoned about:
  // `every-identity-he-has.test.ts` §6 drives a null store at both verbs.
  conversationsPerIdentity: () => [],
  // ⚑ **`false`, for `removeExternalMcpServer`'s reason**: nothing was removed, so nothing may be
  // claimed to have been.
  removeAgentIdentity: () => false,
  // ⛔ **The fail-closed half of the kill switch, and the one that matters most.** A host with no
  // database lets no agent start a conversation — not *"cannot check, so go ahead"*.
  spawnPolicy: () => ({ spawningEnabled: false }),
  setSpawningEnabled: () => {},
  // ⛔ **`'ask'` for a host with no database**, which is the narrowest answer rather than the
  // convenient one: a store that cannot tell you what a person chose has not learned that they
  // chose to stop being asked. Same direction as `spawnPolicy` above, arrived at from the other end.
  defaultApprovalModeChosen: () => false,
  defaultApprovalMode: () => 'ask',
  setDefaultApprovalMode: () => {},
  parentOf: () => null,
  // ⚑ **629 · nothing above anything, which is this store's answer to every question** — and it
  // is the SAFE one here: an empty chain admits no interrupt that the direct relationship did not
  // already admit.
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
  // ⚠️ **0 for {@link settleOrphanRuns}'s reason**: a store with no database repaired nothing, which
  // is the honest count rather than a claim that there was nothing to repair.
  settleStrandedMessages: () => 0,
  messagesWaitingIn: () => [],
  // ⚠️ **0 for {@link settleStrandedMessages}' reason**: a store with no database repaired nothing.
  settleStrandedRequests: () => 0,
  // ⚑ **557 · `no-ledger`**: a store with no database holds no ledger, so *nothing has stopped with
  // nobody to tell* would be a claim about a workspace this store has never read.
  stalledWorkNobodyWasToldAbout: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  stalledWorkItsGiverWasToldAbout: () => ({
    rows: [],
    walk: 'no-ledger',
    ledgers: 0,
    rowsUnread: 0,
  }),
  waitsThatNeedClassifying: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  stalledWorkAPersonGave: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  // ⚑ **F097 · `no-ledger`**, for its neighbour's reason: *nothing waits on the person who wrote*
  // would be a claim about a workspace this store has never read.
  piecesWaitingOnWhoWrote: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  piecesWaitingOnWhoWroteIn: () => [],
  // ⚑ **533 · `no-ledger`**: a store with no database has read nothing, and *"no provider has
  // walled"* is a claim it is not entitled to make.
  providerLimitsSeen: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  readAheadProviderWalls: () => true,
  // ⚠️ **0 for {@link settleStrandedRequests}' reason**: a store with no database repaired nothing.
  settleRestartedWork: () => 0,
  // ⚑ **453 · `no-ledger`**: a store with no database has walked nothing, and an empty answer must
  // not read as *nothing is waiting on you*.
  questionsAPersonMustAnswer: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  // ⚑ **403.** Empty for `questionsAPersonMustAnswer`' reason: a store with no database holds no ledger,
  // so nothing was ever routed and nothing can be waiting on anybody. ⚑ **453 · and it says so**.
  decisionsAwaitingAPerson: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  // ── the tree (D-016) ───────────────────────────────────────────────────────────────────────────
  //
  // ⛔ **The writers THROW, and that is this block's one departure from the vacuous contract.** A
  // number handed out, a piece recorded and a resource kept are each a fact a caller goes on to state
  // — a label in a brief, a receipt to a giver, an id in a reply — so a store with no database must
  // not pretend to have written one. ⚑ The readers answer *nothing here*, which is true of it.
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
  // ⛔ **Empty rows, and that is honest here precisely because the DIGEST's own vocabulary can
  // say so one layer up** (438). Every other reader in this file has to choose between *"nothing
  // happened"* and *"I cannot tell you"* with one value; a digest does not — the renderer's
  // reading is `null` when the read did not answer, and a store with no database is a read that
  // answered nothing rather than a workspace in which nothing happened.
  // ⚑ **466 · `no-ledger` here too**, for the reason it exists on the three queue readers: an empty
  // digest out of a store with no database must not read as a quiet night.
  digestWindow: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  activityWindow: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  // ⚠️ **Zero, and it is the same shrug.** A store with no database knows of no conversation at
  // all, so it can honestly say none of them is uncovered — and the empty `digestWindow` above is
  // what stops that reading as *"full coverage"*.
  conversationsHeldByNoAgent: () => 0,
  // ⛔ **`no-ledger` and never the walk's own word** (637) — the empty store has no database, and
  // answering `every-conversation-this-app-placed` with no rows would be this app saying *you have
  // placed no conversations* when it has not looked. ⚑ Its neighbour above carries the same rule.
  everyPlacedConversation: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  placedConversations: () => 0,
  // ⛔ **`no-ledger`, and it is the word that keeps this apart from a parent who gave nobody work**
  // (508). Both answer zero rows; only the WALK says which — `LEDGER_WALK_KINDS`' own reason for
  // existing, and the reason the surface above this draws no *"you have given out no work"*
  // sentence over it.
  workGivenOutBy: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  // ⛔ **543 · `no-ledger`, and never `no-such-conversation`.** A store with no database cannot
  // look an id up, so it has nothing to say about whether that conversation exists — answering the
  // narrower word would be this store making a claim about the workspace out of its own absence,
  // which is `LEDGER_WALK_KINDS`' whole reason for holding both.
  spawnedBy: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  conversationTree: () => [],
  whatTiesTheTreeOutside: () => [],
  providerSessionsOf: () => [],
  deleteTheTree: () => {
    throw new Error('there is no database to delete a conversation from')
  },
  // ⚑ **Null for `identityOf`'s reason, and the ambiguity it exists to remove is not reachable
  // here**: a store with no database has no row for any id, so the two facts this shape separates
  // collapse into the same true answer.
  conversationBinding: () => null,
  workThisOneGaveOut: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  workThisOneWasGiven: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),
  // ⚑ **Empty because there is no ledger to fold, not because nothing was given** — `piecesOwnedBy`'s
  // reading, from the other direction. A host with no database records no piece and can report none.
  piecesGivenBy: () => [],
  // ⛔ **An empty set, which is *nothing has been told* and NEVER *everything has*** (404). A store
  // with no ledger answers the safe direction: the push is attempted and the parent may hear the
  // same notice twice, which costs a message. The other reading costs the fact.
  workReportedTo: () => new Set<string>(),
  legacyOrdinaryStallWasReported: () => false,
  // ⚑ **Empty because there is no ledger to fold, not because nothing was routed** —
  // `piecesOwnedBy`'s reading, one subject over. A host with no database records no routing and can
  // report none.
  routedRequestsOf: () => [],
  questionsRoutedTo: () => [],
  // ⚑ **396.** An empty map, for the reason every reader above returns nothing: a store with no
  // database holds no ledger to read words out of.
  questionsRaisedIn: () => new Map(),
  theDecisionOn: () => null,
  theRequestRouted: () => null,
  whoRoutedToWhom: () => [],
  conversationsHoldingACopyOf: () => [],
  lastEndedTurn: () => null,
  routedRequestsAtHand: () => null,
  questionsRaisedAtHand: () => null,
  piecesAtHand: () => null,
  questionsRoutedToAtHand: () => null,
  whenAPersonLastWrote: () => null,
  requestsItsLastEndedTurnInterrupted: () => [],
  // ⚑ **D-012** — a store with no ledger holds no message sent to anybody.
  lastExchange: () => ({ received: null, answer: null }),
  whatOpenedTheLastEndedTurn: () => null,
  transcript: () => ({ turns: [], older: false }),
  // ⚑ **484 · `null` is *no row says*, which is exactly what a store with no ledger can honestly
  // report** — the same shrug `lastEndedTurn` makes one line up, and not *nobody asked*.
  lastAskToStop: () => null,
  appendGeneration: () => {},
  // ⚠️ **`true`, because this store's contract is that everything asked of it succeeds vacuously**
  // (293 §4). `false` would mean "somebody else promoted a different generation", which is a claim
  // a store with no database is in no position to make.
  promoteGeneration: () => true,
  abandonGeneration: () => {},
  discardGeneration: () => 0,
  deadGenerations: () => [],
  findByProviderRef: () => null,
  nameItsLaunch: () => false,
  append: () => {},
  appendMany: () => {},
  atomically: (work) => work(),
  resumable: () => [],
  unresumable: () => [],
  recorded: () => [],
  recordedOne: () => null,
  searchPastWork: () => ({ ok: false, reason: 'unavailable' }),
  closePastWorkSearch: () => {},
  pastWorkSearchSource: () => null,
  replacements: () => [],
  // ⚑ **D-029** — a store with no ledger has scheduled nothing.
  newestScheduleLevels: () => [],
  scheduleEvidenceRows: () => ({ rows: [], cut: false }),
  lastStatusAt: () => null,
  find: () => null,
  findLive: () => null,
  events: () => [],
  eventsFrom: () => [],
  turnWindow: () => ({ entries: [], from: 0, hasOlder: false, turnAligned: true }),
  turns: () => [],
  closeOpenTurn: () => false,
  reopened: () => false,
  // ⚑ **692 · no database, no quit to record** — a host that cannot write the stamp keeps R34c's
  // fallback: a launch treats every stop as a crash's.
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
  /** 682 · `R31c` — when a person last set its model or effort, or null. */
  model_or_effort_set_by_a_person_at: number | null
  /** D-042 · R5 — what the provider last reported running, or null. */
  reported_model: string | null
  reported_effort: string | null
  adopted_at: number | null
  /** 214 §1 — when a BUNDLE was restored into this row, or null for every other row. */
  restored_at: number | null
  /** 111 — the descent, as JSON, or null for a session that is nobody's child. */
  child_descent: string | null
  has_events: number
  /** 222 — the newest CLOSED turn's reason, or null for a session that has never finished one. */
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

/**
 * The three fields that decide a projection's state — and deliberately ONLY those three (review).
 *
 * It used to take a whole `GenerationRow`, which meant the library's caller had to invent an
 * `active` and a `highest` it does not select, and did so by writing `0`. That was harmless only for
 * as long as nothing read them: a later branch that consulted `active` would have silently received
 * a zero rather than the number on disk. A parameter that cannot be supplied wrongly is better than
 * a comment explaining which fields are safe to make up.
 */
interface ProjectionState {
  normalizerVersion: number
  building: number | null
  failure: string | null
}

/**
 * **Is this projection current?** — computed, never stored (065, from 061 finding 6).
 *
 * "Stale" is a projection an older version of the app read: the version it was read with is on
 * disk, and so is the one shipping now. A stored flag would be a third opinion about them.
 *
 * Order matters. `rebuilding` outranks `stale` because a rebuild is the answer to being stale and
 * saying both would read as two problems; `failed` outranks it for the same reason pointed the other
 * way — the user needs to know the attempt did not land, and that what they are reading is still the
 * previous projection, whole.
 */
function derivedStateOf(row: ProjectionState | null, present: boolean): DerivedState | null {
  if (row === null) return null
  if (row.building !== null) return 'rebuilding'
  if (row.failure !== null) return 'failed'
  // ⚠️ **No projection, nothing to describe.** A build that found no conversation, or one that was
  // cancelled before it promoted anything, leaves a record behind and no ledger — and calling that
  // `stale` would claim there is an old tail on screen to be behind. `null` is what a session whose
  // ledger was never projected says, and this is one of them. A `failed` or `rebuilding` record is
  // returned above regardless, because those two are worth saying with nothing on screen.
  if (!present) return null
  return row.normalizerVersion < NORMALIZER_VERSION ? 'stale' : 'current'
}

/**
 * Make a stored event match the shape the type promises, on the one path that never re-parses.
 *
 * ## The size bound (052 review)
 *
 * `wrapUnknown` bounds a payload where the ADAPTERS build one, and that was assumed to be the only
 * entrance. It is not: `importBundle` appends a ledger read from a file, and every row written
 * before the bound existed is still on disk at full size — including, on the machine this was
 * dispatched from, one 2,147,667-byte payload. Replay would have handed that straight back out of
 * `events()` into an IPC structured clone and the renderer's fold, which is the same retention the
 * bound was added to prevent, reached by a door nobody had counted.
 *
 * Only `unknown` carries an unbounded field, so only `unknown` is touched.
 *
 * ## The option shape (143)
 *
 * ⛔ **A `user_input_request` written before 143 has `options: string[]`, and the type now says
 * `UserInputOption[]`.** Nothing on this path would have noticed: `toPersistedEvents` CASTS
 * (`JSON.parse(row.payload) as TranscriptEvent`), `historyWindow` hands `entry.event` to the
 * renderer unchanged, and `toWireEvent` — which does re-parse, and whose Zod union coerces the old
 * form — is on the live emit path only. So every chip on every stored question card would have
 * rendered its `label` as `undefined`: blank buttons, in a transcript, with no error anywhere.
 *
 * ⚠️ **Five such rows exist in the live database this was measured against** — three with one
 * question and four options, two with two questions and seven options, all 26 options bare strings
 * — and one of the two-question rows is the call 139 was raised for. This is a migration with real
 * subjects, not a defensive cast.
 *
 * ⛔ **143 hand-wrote that coercion and 145 found what it trusted: everything else** (MEDIUM 1). It
 * looked for strings and CAST the rest, so `[{label: 42}]` reached `label.trim()` and threw, and a
 * `questions` field that was not an array threw inside the coercion itself. So it PARSES now, with
 * the same schema the live path uses — see `storedQuestionsParsed`. One definition of an option,
 * and nothing left to keep in step by hand.
 *
 * ⚠️ **A row that does not parse throws, and `toPersistedEvents` catches it** — its own comment is
 * the policy: *"A row we cannot parse is skipped rather than replayed as something else."* Three
 * different malformed shapes now reach one documented outcome instead of three accidents.
 *
 * The `unknown` bound is identity-preserving when it finds nothing to do. The question parse is not
 * — it allocates per replayed card, which is 7 rows in the database this was measured on, and the
 * price of the type finally being true.
 */
function boundStoredEvent(event: TranscriptEvent): TranscriptEvent {
  return boundTheParts(boundOneRow(event))
}

/**
 * ⛔ **Every bound a row's OWN keys meet** — the composition {@link boundStoredEvent} was until
 * D-027, named so that each part of a turn ({@link boundTheParts}) is bounded by exactly what a row
 * is, and nothing re-enters the whole (`518`'s lesson, below at {@link boundStoredPayloads}).
 */
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
  // ⚑ A refusal's kept sentence: its shape checked and its bound met again, or the key dropped.
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

/**
 * 🔴 **D-027 · a turn's parts, bounded as the turns they would have been** — see
 * {@link UserTurnEvent.parts}. ⚑ At most {@link MAX_TURN_PARTS}, each BUILT from
 * {@link USER_TURN_PART_KEYS} — never spread, `boundHandedPaths`' rule — and passed through
 * {@link boundOneRow} as a `user_turn` of its own. ⛔ A part that is not an object with words is
 * dropped, ⛔ **and the key stays however few are left**, none included: a row with parts carries no
 * authorship of its own, so without the key it would read as a person's turn (`theMessagesOf`).
 */
function boundTheParts(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' || event.parts === undefined) return event
  const stored: unknown = event.parts
  const parts = (Array.isArray(stored) ? (stored as unknown[]) : [])
    .slice(0, MAX_TURN_PARTS)
    .flatMap((one): UserTurnPart[] => {
      if (typeof one !== 'object' || one === null) return []
      const said = one as Record<string, unknown>
      if (typeof said.text !== 'string') return []
      // ⚑ Built as a turn of its own, key by key, so every bound a row meets is met by the part.
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

/**
 * 🔴 **The authorship a stored `message_queued` carries, read back for the ending that closes it**
 * (687) — the launch sweep's copy of what `RuntimeHost` spreads from its mailbox entry.
 *
 * ⛔ **Copied AS STORED and never re-derived**: the host decided these keys at the door, and a
 * repair that recomputed them would be a second writer free to disagree. ⚠️ **Not bounded here** —
 * the ending is replayed through {@link boundStoredEvent} like every other row, so it is bounded
 * exactly as the row it was copied from would be. ⚑ {@link TURN_AUTHORSHIP_KEYS} is exhaustive by
 * construction, so a key added to the value tomorrow reaches this ending too.
 *
 * ⚠️ **`{}` for a payload that does not parse or is not an object** — the person's shape, which is
 * what the sweep wrote for every ending before `687`.
 */
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

/**
 * 🔴 **The paths a stored `message_queued` carries, read back for the ending that closes it**
 * (689, from `687` inbox 3) — {@link authorshipStoredOn}'s rule, one field over.
 *
 * ⛔ **`216`'s *offered back***: a crashed message whose ending dropped its paths hands a person
 * a restored draft quietly missing what they attached, and it looks complete — the reason every
 * host writer of an ending that offers the message back (`cancelled`, `abandoned`) already carries
 * them. ⚑ `sent` carries none, on purpose: the turn beside it is the record.
 *
 * ⚠️ **Copied AS STORED and never bounded here**, exactly as the authorship is: every reader of the
 * field bounds it — {@link boundStoredPayloads} on replay — so a check here would be a second
 * bound no reader could tell from the first. ⚑ Absent when the held row carried none, which is the writer's own rule.
 */
function attachmentsStoredOn(payload: string | null): { attachments?: HandedPath[] } {
  const attachments = aStoredObject(payload)?.attachments
  return attachments === undefined ? {} : { attachments: attachments as HandedPath[] }
}

/** ⚑ **D-017 · R3** — a stored `kind` this build still has a mailbox for. */
function isMailboxKind(kind: unknown): kind is MailboxKind {
  return typeof kind === 'string' && (MAILBOX_KINDS as readonly string[]).includes(kind)
}

/**
 * ⚑ **The question a held row's notice asks, as `{ asks }`, or `null`** — both halves non-empty
 * strings: a provider's request id is not one this app minted.
 */
function theQuestionItAsks(stored: unknown): { readonly asks: TheQuestionItAsks } | null {
  if (typeof stored !== 'object' || stored === null) return null
  const { asker, requestId } = stored as Record<string, unknown>
  if (typeof asker !== 'string' || asker.length === 0) return null
  if (typeof requestId !== 'string' || requestId.length === 0) return null
  return { asks: { asker, requestId } }
}

/** ⚑ A stored payload as an object, or `null` for one that does not parse or is not an object. */
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

/**
 * 🔴 **The piece a turn or a message names, bounded the day it was written** (671, 687; a piece
 * since D-016) — {@link UserTurnEvent.piece} and {@link MessageSentEvent.piece}, with the label a
 * card draws beside them.
 *
 * ⚑ **`545`'s rule, applied at birth rather than on the day a reader arrives**: the fields exist so
 * a transcript can JOIN a turn or a message to its piece and name it. ⛔ **So a stored value this
 * app could not have minted is DROPPED**: a piece id that is not {@link isAStoredId}, and a label
 * that is not one `pieceCalled` spells — or that names no piece beside it, so a replayed row never
 * shows a label with nothing to join on. The turn still reads as relayed:
 * {@link UserTurnEvent.relayedFrom} is untouched.
 *
 * ⚠️ **Stripped and never overridden**, `boundRelayedIdentity`'s own rule: a conditional override
 * leaves the stored value in place on exactly the path that matters. ⚑ The declaration beside them,
 * {@link UserTurnEvent.says}, is NOT bounded here: a closed vocabulary is checked by its reader, as
 * {@link MessageSentEvent.kind} is (`isAgentMessageKind`).
 */
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

/**
 * 🔴 **D-016 · commit 6 · R4 — the piece a delivery row drives, bounded the day it was written** —
 * {@link UserTurnEvent.drives} and {@link QueuedMessageEvent.drives}.
 *
 * ⚑ **{@link boundPieceNamed}'s rule, one key over**: the fold reads the value as a piece id, so a
 * stored value this app could not have minted — not {@link isAStoredId} — is DROPPED, and the row
 * then drives every open piece, as a row written before commit 6 does. ⚠️ **Stripped and never
 * overridden**, `boundRelayedIdentity`'s own rule.
 */
function boundTheDrive(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'user_turn' && event.type !== 'message_queued') return event
  if (event.drives === undefined || isAStoredId(event.drives)) return event
  const { drives: _drives, ...rest } = event
  void _drives
  return rest as TranscriptEvent
}

/**
 * 🔴 **The relayer's identity, bounded the day it gained a transcript reader** (545).
 *
 * ## ⛔ Why this one is bounded and {@link UserTurnEvent.relayedFrom} beside it is not
 *
 * ⚠️ **`runtime-ipc.ts` classifies that field as *an id printed unbounded in the DEBUG STREAM*,
 * and closes the paragraph with the rule this function obeys:** *"The day either of these gains a
 * reader outside `describe-event.ts`, it leaves the class too."* ⛔ **{@link
 * UserTurnEvent.relayedFromProfile} never belonged to that class**: it is drawn as the HEADING of
 * a relayed bubble from the commit that added it, so an imported ledger could otherwise put a
 * megabyte of text where a person reads a name — `518`'s report ids, one field over.
 *
 * ## ⚑ The rule is `isPathSegment`, and it is the slug's OWN rule rather than a length beside it
 *
 * ⛔ **A number chosen here would be a second opinion about a format `runtime-ipc.ts` owns** —
 * {@link MAX_STORED_ID_CHARS}' own reasoning, pointed at a different field. ⚠️ Every value this
 * app writes here came out of `SessionStore.identityOf`, whose `agent_identity.slug` is folded
 * under a CHECK and entered through `agentSlug` / `profileId`, both of which ARE this refinement —
 * so the bound refuses nothing this process could have written, which is standing rule 24's test
 * for a narrowing.
 *
 * ⛔ **Dropped rather than shortened**, exactly as an oversized id in a report is: a cut slug is a
 * name that belongs to somebody else, and the surface has a word for an unnameable relayer
 * (`AN_UNNAMED_RELAYER`) and none for a truncated one.
 *
 * ⚠️ **It says nothing about {@link UserTurnEvent.relayedFrom}.** A row whose identity is dropped
 * still says *these words came from another conversation*, which is the fact `413` §4 shipped and
 * the half that must keep working.
 *
 * ## ⚠️ The guard is spelled POSITIVELY, and that is not style
 *
 * ⛔ **`518 M5` anchors on {@link boundWorkReport}'s three-arm `!==` guard**, and a second copy of
 * those three lines anywhere in this file makes that row match twice and retire — somebody else's
 * row going dark because of a guard written here. ⚑ `runtime-host.ts` keeps the same rule for
 * `noteTheSending`'s parameter name: *"a mutation table's anchor is a fact about the source, and a
 * new method that collides with one is the new method's to avoid."*
 */
function boundRelayedIdentity(event: TranscriptEvent): TranscriptEvent {
  // 🔴 **732 · the asker's identity on `work_interrupted`, by the same rule** (`730` F-4) — a slug
  // meant to be named where a person reads a name, and one that never travels without the
  // conversation beside it ({@link WorkInterruptedEvent.agentProfile}). ⚑ **734 · and on
  // `stop_unanswered`**, which carries the same asker from the same builder (`732` F-5).
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
    // ⚠️ **`undefined` returns by identity and it is the ordinary row** — every turn a person typed
    // and every turn nobody relayed.
    if (event.relayedFromProfile === undefined) return event
    const slug: unknown = event.relayedFromProfile
    if (typeof slug === 'string' && isPathSegment(slug)) return event
    // ⛔ **STRIPPED and never overridden**, which is `boundWorkReport`'s own rule a few lines down:
    // a conditional override leaves the stored value in place on exactly the path that matters.
    const { relayedFromProfile: _stored, ...rest } = event
    void _stored
    return rest as TranscriptEvent
  }
  return event
}

/**
 * ⛔ **Everything {@link boundStoredEvent} bounds except the work report** — the arms as they were,
 * given a name so the report can be bounded in FRONT of them rather than inside them (518).
 *
 * ⚠️ **The report could not have been an ARM of this function, and that is why it is outside it.**
 * `work` rides on exactly the three types the attachments arm handles — `user_turn`,
 * `message_queued`, `message_unqueued` — and that arm RETURNS: an arm added after it would never
 * be reached by a turn carrying both, and a turn carrying no attachment falls past every arm to
 * `return event`. ⛔ Placed before it, it would have had to hand its result back INTO the chain,
 * which is the re-entry the section below is about.
 *
 * ⚑ **Composed, the order of the two stops mattering** — neither can return past the other, and
 * swapping them in {@link boundStoredEvent} would not be a defect. 🔴 **The hazard is removed
 * rather than guarded**, which is why no mutation row protects the ordering and two rows protect
 * the composition instead.
 *
 * ## 🔴 A composition rather than a re-entry, and that is not a style choice
 *
 * ⛔ **The first version of `518` did `if (carried !== event) return boundStoredEvent(carried)`**
 * and argued the recursion was one level because the work bound is idempotent and returns by
 * identity. ⚠️ **It was one level for every value but one.** `isAWorkReport` admits
 * `number: NaN` — `typeof NaN === 'number'` — and the identity check compared field values with
 * `===`, under which `NaN` is never equal to itself. So the bound rebuilt the report every pass,
 * every pass looked like a change, and a single stored row took `store.append` to
 * `RangeError: Maximum call stack size exceeded`. 🔴 **A crash reachable from one imported ledger
 * row, produced by an optimisation that existed to save an allocation.**
 *
 * ⚑ **Composed, the identity question disappears**: nothing re-enters, so nothing has to prove it
 * cannot. `boundWorkReport` allocates once per event that actually carries a report — a small
 * fraction of any ledger — and no other path pays anything.
 */
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
  // ⛔ **A replayed turn's attachments are BOUNDED here** (216 §2), which is the bound `215` §3.5
  // asks for by name: *"attachment paths, arrays, sizes and ownership cannot be added without
  // stored-event bounds."* Replay is a trust boundary — the stored payload is broadly cast after
  // `JSON.parse` — so a ledger row written by a later build, or edited, cannot hand the renderer an
  // unbounded array or a path of unbounded length. ⚠️ **Dropped rather than refused**: a
  // conversation is worth more than the caption on one of its turns, and a turn that shows its
  // words without its attachment line is a smaller loss than one that will not render.
  //
  // ⛔ **EVERY event that can carry paths, not only the sent one** (review). `message_queued` and
  // `message_unqueued` carry them too, and a bound that covered one of the three would leave the
  // gap exactly where the next one is added. The bound travels with the field.
  if (
    (event.type === 'user_turn' ||
      event.type === 'message_queued' ||
      event.type === 'message_unqueued') &&
    event.attachments !== undefined
  ) {
    const kept = boundHandedPaths(event.attachments)
    if (kept.length > 0) return { ...event, attachments: kept }
    // An empty list is the ABSENCE of one — the same rule the writer follows, so a replayed turn and
    // a live one produce the identical shape rather than one carrying `attachments: []`.
    const { attachments: _dropped, ...rest } = event
    void _dropped
    return rest as TranscriptEvent
  }
  // ⛔ **A memory note carries a path AND a body, so it is bounded on the way out** (318, 216 §2's
  // rule). This is the first app-authored event to carry file CONTENT, which is why the note above
  // about free text not being bounded does not reach it: `text` here is a file the agent wrote into
  // a directory it controls, replayed from a payload that is broadly cast after `JSON.parse`, and a
  // row written by a later build — or edited — must not be able to hand the renderer a megabyte.
  if (event.type === 'memory_note') {
    const notes = boundMemoryNotes(event.notes)
    // ⛔ **A cap that goes silent on the way OUT is the same defect as one that goes silent on the
    // way in** (092 §4, and found reviewing this diff). The writer counts what it dropped; this
    // side cut more, and a row that kept the writer's count while showing fewer rows would report a
    // number about a list it is not showing.
    const cut = Math.max(0, boundedLength(event.notes) - notes.length)
    const dropped =
      (typeof event.dropped === 'number' && event.dropped > 0 ? event.dropped : 0) + cut
    return { ...event, notes, ...(dropped > 0 ? { dropped } : {}) }
  }
  // ⛔ **A launch row carries ONE path and ONE count, and both are bounded on the way out** (332,
  // the same 216 §2 rule its two neighbours state).
  if (event.type === 'memory_loaded') {
    // ⛔ **A path that does not survive is EMPTIED, and the FOLD is what refuses the row** — the
    // shape `memory_note` uses one block up rather than a new one, because this function's contract
    // is that an event comes back. ⚠️ The renderer's `memory_loaded` arm carries the same *"an empty
    // one draws nothing"* guard `memory_recall` states, so a row whose only claim was cut produces
    // no row at all rather than one saying memory is in the prompt and unable to say which
    // (`106`). ⛔ Truncating was the other option and it is worse: a cut path looks like a real one
    // and sends a person to a file that is not there (086).
    const usable =
      typeof event.index === 'string' &&
      event.index.length > 0 &&
      event.index.length <= MAX_STORED_PATH_CHARS
    // ⚑ **A count that is not a finite non-negative number is re-derived to `0`, which draws no
    // clause at all** — so a stored row whose number was garbage says only the part that survived,
    // rather than printing `NaN memories` into a sentence.
    const beside =
      typeof event.beside === 'number' && Number.isFinite(event.beside) && event.beside >= 0
        ? Math.floor(event.beside)
        : 0
    // 🔴 **604 · the look time, and it is here because *constructed, never spread* would have
    // eaten it.** ⛔ A field added to `MemoryLoadedEvent` and not added here is carried live and
    // LOST on the next replay — a row that says when we looked until the app restarts and then
    // stops saying it is worse than one that never said it, because only the first teaches a
    // person to expect the sentence.
    //
    // ⚑ **Absent is the re-derived value, exactly as `0` is `beside`'s.** The field is optional by
    // design — every row written before 604 has none — so a stored number this app could not have
    // taken comes back missing rather than wrong, and reads as the old row it is indistinguishable
    // from. ⚠️ **What it refuses is only that**: the far end, where a finite number is past
    // `TimeClip` and `Intl.DateTimeFormat` throws rather than answering, is refused by
    // `clock.ts`'s `MAX_INSTANT` at the moment of formatting — one derivation rather than a second
    // copy of that constant on this side of the wire (169 §1).
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
  // ⛔ **And a memory RECALL carries paths and free text, so it is bounded here too** (319, the same
  // `216` §2 rule its neighbour above states, in the wording that comment ends on: *"the bound
  // travels with the field."*). A stored row is broadly cast after `JSON.parse` — nothing schema-
  // parses it — so a ledger written by a later build, or edited, can otherwise hand the renderer an
  // unbounded array of unbounded strings to paint into the DOM.
  //
  // ⚑ **It calls the ADAPTER's own rule rather than restating it** — `boundRecall`, the same
  // function `codex/normalize.ts` runs on the wire, which is why `memory-recall.ts` exports it.
  // ⚠️ Its neighbour above could not do this: `memory_note` is app-authored and its caps live in
  // `runtime-ipc.ts`. This one's live in the runtime package, and one rule spelled twice is `169`
  // §1 — the shape this file has been bitten by before.
  if (event.type === 'memory_recall') {
    const claimed = Array.isArray(event.entries) ? event.entries.length : 0
    const sent = storedRecallEntries(event.entries)
    const bound = boundRecall(sent, storedThreadIds(event.threadIds))
    // ⛔ **The writer's count, the type gate's cut AND the bound's cut are ADDED, never replaced** —
    // 318's ruling one block up, for its reason: a row that kept the writer's number while showing
    // fewer entries would be reporting a shortfall about a list it is not showing.
    //
    // ⚠️ **`claimed - sent.length` is the term this shipped WITHOUT, and the test beside it is what
    // found it.** {@link storedRecallEntries} drops what cannot be an entry at all — a number, a
    // string, a `null` — before `boundRecall` ever counts, so those rows vanished from a payload of
    // ten and the row said seven. That is `092` §4's silent cap, inside the block whose own comment
    // forbids it.
    const dropped =
      (typeof event.dropped === 'number' && event.dropped > 0 ? event.dropped : 0) +
      (claimed - sent.length) +
      bound.dropped
    const threadsDropped =
      (typeof event.threadsDropped === 'number' && event.threadsDropped > 0
        ? event.threadsDropped
        : 0) + bound.threadsDropped
    // ⛔ **The three bounded fields are STRIPPED before the spread, never merely overridden**
    // (found reviewing this diff, and it is the whole bound rather than a detail). `{ ...event }`
    // followed by a CONDITIONAL override leaves the stored value in place on exactly the paths that
    // matter: a row whose every id was too long to carry sets `threadIds: []`, the conditional does
    // not fire, and the original unbounded array of unbounded strings rides straight into the
    // renderer — the payload this whole block exists to stop. `dropped` and `threadsDropped` are the
    // same shape with a smaller blast radius: a stored `dropped: '<a megabyte>'` is not a number,
    // fails every `typeof` test above, and is then painted by `{{ props.item.dropped }} more`.
    // ⚑ The idiom is `boundHandedPaths`' own, one bound up: destructure the field out, rebuild it.
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

/**
 * ⛔ **The bound itself, as ONE expression** (216, review).
 *
 * Three event types carry attachments and a fourth will; written out at each call site, the version
 * that drifts is the one nobody is looking at. ⚠️ **Order matters**: the filter runs before the
 * `slice`, so a payload that puts ten malformed entries first cannot push every valid one out of
 * the window — the mistake a `slice`-then-`filter` reading makes and a fixture with the malformed
 * entries at the END cannot detect (which is exactly how the first version of the test for this was
 * vacuous).
 *
 * ⚑ Free text — `text`, `detail` — is deliberately NOT bounded here, matching what this function
 * has always done: only `unknown`'s `raw` is, because that one is the provider's bytes. Bounding
 * some strings and not others would read as a rule and be a coincidence.
 */
function boundHandedPaths(attachments: unknown): HandedPath[] {
  return (
    (Array.isArray(attachments) ? attachments : [])
      .filter(
        (each): each is HandedPath =>
          typeof each?.path === 'string' &&
          each.path.length > 0 &&
          each.path.length <= MAX_STORED_PATH_CHARS &&
          (each.kind === 'file' || each.kind === 'directory'),
      )
      .slice(0, MAX_HANDED_PATHS)
      // ⛔ **CONSTRUCTED, never spread** (review). `{ ...each }` copied every own key off the stored
      // payload, so the bound held the array length and the path length and nothing else: a ledger
      // row — or a `.brobot` bundle, which `read-bundle.ts` validates with `.passthrough()` — could
      // carry `{ path, kind, outsideCwd, blob: <100 MB> }` straight through `boundStoredEvent` into
      // the renderer. ⚠️ Naming the three fields is what makes this a bound rather than a filter.
      .map((each) => ({ path: each.path, kind: each.kind, outsideCwd: each.outsideCwd === true }))
  )
}

/**
 * ⛔ **The stored-side bound on a turn's WORK REPORT** (518, from `510` F3) — the fourth member of
 * the family {@link boundHandedPaths} opened.
 *
 * ⚑ **A report's fields are read off a replayed row by the window** — the piece and its owner by
 * `where-the-work-is.ts`, the resources by the reader that opens them — drawn as `data-*`
 * attributes on a transcript row, and sent back over the command wire when a person presses. So
 * `work` is bounded here, and not left as an id printed unbounded in the debug stream.
 *
 * ## ⛔ DROPPED rather than refused, and rather than shortened
 *
 * ⚠️ **A report whose `piece`, `label` or `state` does not survive loses the whole key.** The
 * attachments arm's rule, for its reason — *a conversation is worth more than the caption on one of
 * its turns* — and `memory_loaded`'s: ⛔ **truncating is worse than dropping, because a cut id
 * looks like a real one.** A shortened resource id draws a press the wire then refuses, and a
 * shortened piece id is a row claiming a piece that is not the one it names. ⚑ An absent `work` is
 * the ordinary shape of every turn a person typed, so the fold has a reader for it already.
 *
 * ⚠️ **And a `work` that is not a report at all goes the same way** — a stored `work: null`, or a
 * report written before D-016 (`{taskId, number}`), which {@link isAWorkReport} does not admit.
 * ⛔ That gate is the one the fold sites already use — one reading, not a fourth.
 *
 * ## ⚑ CONSTRUCTED, never spread — and here that is the whole bound
 *
 * ⛔ `{ ...report }` would hold the string lengths and nothing else, so a `.brobot` ledger — whose
 * events are validated as `{ type: string }.passthrough()` — could carry an extra key of any size
 * on the report and ride it into the renderer. ⚠️ **Naming the fields is what makes this a
 * bound**, and it is why a field added to {@link WorkReport} has to be classified here; the
 * required ones are a compile error and the optional ones are pinned by a census.
 *
 * ⚠️ **LENGTHS, not vocabularies.** `state`, `outcome` and `stalledBecause` are closed sets, and
 * each already has a reader that answers for a value this app has never heard of — `stateWord`'s
 * *"in a state this app has not been taught"*, `knownOutcome`, `undrivenReason`. ⛔ A membership
 * test here would be a fourth reading free to disagree with those three, which is exactly what
 * {@link isAWorkReport}'s own docblock refuses. ⚑ A string too long to be a member is dropped for
 * being too long, and what it is not remains the other three's answer.
 */
function boundWorkReport(event: TranscriptEvent): TranscriptEvent {
  if (
    event.type !== 'user_turn' &&
    event.type !== 'message_queued' &&
    event.type !== 'message_unqueued'
  ) {
    return event
  }
  // ⚠️ **`undefined` is the only value that returns by identity, and it is the ordinary one** —
  // every turn a person typed. ⛔ `null` is NOT folded in with it: a stored `work: null` is a value
  // this bound exists to remove, and a reader that checks only for presence would throw on it.
  if (event.work === undefined) return event
  const kept = isAWorkReport(event.work) ? boundedWorkReport(event.work) : null
  // ⛔ **STRIPPED before the spread, never merely overridden** — `memory_recall`'s rule two arms
  // down, for its reason: a conditional override leaves the stored value in place on exactly the
  // path that matters, which here is the report that did not survive at all.
  const { work: _stored, ...rest } = event
  void _stored
  return (kept === null ? rest : { ...rest, work: kept }) as TranscriptEvent
}

/** ⚑ A string this app could have minted — see {@link MAX_STORED_ID_CHARS}. */
function isAStoredId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STORED_ID_CHARS
}

/**
 * ⛔ **The report itself, field by field** (518) — `null` when it names a piece it cannot name.
 *
 * ⚠️ **It always REBUILDS, and the identity shortcut its neighbours use is deliberately absent.**
 * `boundStoredEvent`'s `unknown` arm returns by identity so the common path allocates nothing, and
 * the first version of this did the same by comparing the constructed keys and values against the
 * stored ones. ⛔ **That comparison is what took a stored `number: NaN` to a stack overflow**:
 * `NaN === NaN` is false, so every pass looked like a change and the re-entry above never
 * terminated. 🔴 **An economy that can be wrong is worse than an allocation that cannot** — and
 * with the composition upstairs there is nothing left for the identity to be load-bearing for.
 */
function boundedWorkReport(report: WorkReport): WorkReport | null {
  // ⛔ **A report that cannot say WHICH piece it is, is not a report** — its id, its state, and the
  // label a person says out loud. ⚑ A label that is not one `pieceCalled` spells has no
  // re-derivation available — a wrong label is worse than a missing clause — so the key goes.
  if (
    !isAStoredId(report.piece) ||
    !isAStoredId(report.state) ||
    pieceNumbersOf(report.label) === null
  ) {
    return null
  }
  // ⚑ **At most as many resources as one reply may hand in**, each an id this app could have
  // minted — an imported ledger cannot ride a thousand ids into a row.
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
    // ⚠️ **An id, never a member** — a report written before D-016c can name `conversation_ended`,
    // which the vocabulary no longer has, and it is kept as what was said (`WorkReport.stalledBecause`).
    ...(isAStoredId(report.stalledBecause) ? { stalledBecause: report.stalledBecause } : {}),
  }
}

/**
 * ⛔ **The stored-side bound on a memory-note row** (318) — the same shape, and the same reasoning,
 * as {@link boundHandedPaths} one function up.
 *
 * ⚑ **CONSTRUCTED, never spread**, for the reason that function records the hard way: `{ ...each }`
 * holds the array length and the string lengths and nothing else, so an edited row could carry a
 * fourth key of any size straight into the renderer. Naming the fields is what makes this a bound.
 *
 * ⚠️ **A note with no readable text keeps its row.** `text` is optional on the wire precisely
 * because an unreadable or vanished note still appeared (and, in a row written before `733`, a
 * linked one), and a bound that dropped those rows would turn
 * `074`'s stated absence back into a silent one.
 */
/** How many entries the stored row claimed, so what the bound removed can be counted rather than guessed. */
function boundedLength(notes: unknown): number {
  return Array.isArray(notes) ? notes.length : 0
}

/**
 * ⛔ **A stored citation entry, CONSTRUCTED field by field** (319) — the rule {@link boundMemoryNotes}
 * below records: `{ ...each }` keeps the lengths and nothing else, so an edited row could carry a
 * fifth key of any size straight into the renderer. Naming the fields is what makes this a bound.
 *
 * ⚠️ **`boundRecall` bounds LENGTHS; it does not check TYPES**, and it cannot — on the wire the
 * adapter has already read every field with `readString`/`readNumber`. Here the payload is broadly
 * cast after `JSON.parse`, so a row whose `note` is an object would reach `.trim()` and throw, and a
 * throw on this path is a whole conversation that will not replay. The type gate belongs this side
 * of the call.
 *
 * ⚑ **The range is re-checked as a PAIR, to the adapter's own rule** — both integral, both
 * non-negative, in order — so a replayed row cannot draw `234-3` where a live one could not.
 */
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

/**
 * The same gate for the ids: strings only, and everything else dropped rather than stringified.
 *
 * ⚠️ **A non-string is not counted as a shortfall, and an over-long string IS** — the split
 * `boundRecall` makes, reached the same way here. A `42` in a stored id array is corruption rather
 * than an earlier session the model named, and the wire path drops one the same way and for the same
 * reason; a 300-character string is something that WAS named and that this event will not carry, so
 * `boundRecall` counts it and the row's total stays honest. See `memory-recall.ts` for why these are
 * carried at all and never drawn as ids.
 */
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
        // ⚠️ A stored `bytes` is a number off a broadly-cast payload. Anything that is not a finite
        // non-negative number is DROPPED rather than read as zero: `0 B` is a measurement, and the
        // field is optional precisely so a size nobody took is absent instead of invented (074).
        ...(typeof each.bytes === 'number' && Number.isFinite(each.bytes) && each.bytes >= 0
          ? { bytes: each.bytes }
          : {}),
        ...(typeof each.unread === 'string' && each.unread.length > 0 && each.unread.length <= 64
          ? { unread: each.unread }
          : {}),
        ...(text === null ? {} : { text }),
        // ⛔ Re-derived, not trusted: a row claiming `truncated: false` over text this bound has
        // just cut would say the model wrote exactly what is on screen. The stored flag still counts
        // — the writer's cut is a fact this side cannot see — so the two are OR-ed.
        ...(each.truncated === true ||
        (typeof each.text === 'string' && each.text.length > MEMORY_NOTE_TEXT_CAP)
          ? { truncated: true }
          : {}),
      }
    })
}

/**
 * How long a stored attachment path may be (216).
 *
 * `PATH_MAX` on macOS with room to spare — the same ceiling the wire holds a fresh one to, so a
 * path that could be sent is a path that can be replayed.
 */
const MAX_STORED_PATH_CHARS = 4096

/**
 * ⛔ **How long a stored ID may be** (518) — a piece, its owner, a resource, and the two closed
 * vocabularies beside them.
 *
 * ⚑ **200, because that is what the command wire already accepts back**, which is the whole reason
 * for the number rather than a coincidence with it: a session id and a resource id are each
 * `z.string().min(1).max(200)` in `main/runtime/ipc.ts`, and each is a value the renderer reads OFF
 * a stored `work` report and sends straight back. ⚠️ **A stored id past this ceiling draws a
 * live-looking control whose press the wire refuses** — `Too big: expected string to have <=200
 * characters` in an error line — which is `221 §3`'s own defect arriving from the one direction
 * `wire-bounds.test.ts` cannot see. 🔴 So a looser ceiling here would publish ids this app has
 * already agreed not to accept, and a tighter one would be a second opinion about a format
 * `identity.ts` and `ids.ts` own.
 *
 * ⚠️ **The ids this app mints are nowhere near it**: `work_<uuid4>` and `sess_<uuid4>` are 41
 * characters, and a resource id is 36. ⛔ The bound is for the rows this
 * process did not write — an imported `.brobot` ledger (`read-bundle.ts` validates the event as
 * `{ type: string }.passthrough()`), or a row edited on disk.
 */
const MAX_STORED_ID_CHARS = 200

/**
 * Narrow a stored reason, so an unrecognized one reads as `unknown` rather than as itself.
 *
 * ⚠️ **Against the shared enum rather than a five-term `||` chain** (222). The chain was a second
 * copy of a list that already existed twice — in this file's type and in the schema's CHECK — and
 * `unknown` is exactly the value a member missing from one of those copies would silently become.
 */
function resolveEndReason(value: string | null): TurnEndReason | null {
  if (value === null) return null
  return turnEndingSchema.safeParse(value).success ? (value as TurnEndReason) : 'unknown'
}

/** The open-turn lookup's row — just enough to decide attribution and status. */
interface OpenTurnRow {
  id: string
  blocked_at: number | null
}

/**
 * ⚑ **484 · the last CLOSED turn, with the column that decides which turn it is.**
 *
 * ⛔ **`closed_at` is not decoration.** {@link LastEndedTurn} is about a turn that ENDED and has to
 * say when, or a reader holding it beside a live `state` is back to resolving *stale* against *an
 * older turn* out of a docblock — which is the defect HO-031 §2.2 named.
 */
/** ⚑ **D-012** — a received message or words said back, as the exchange reads return it. */
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

/**
 * ⚑ **484 · one `work_interrupted` row, with the turn it landed on.**
 *
 * ⛔ **`turn_id` is nullable and the null is the subject**, not a gap: `turnFor` gives a row written
 * with nothing running no turn at all, and that is the ask every turn-narrowed reader is blind to.
 */
interface AskRow {
  payload: string
  created_at: number
  turn_id: string | null
  /** ⚑ **494 · which of the two producers wrote it** — see `selectLastAskToStop`. */
  type: string
  /** ⚑ **676 · F3 — where it sits**, so the torn rows the read passed over can be counted. */
  ordinal: number
}

/**
 * One recorded turn (045). `endReason` is non-null exactly when `closedAt` is — the database holds
 * the two together, so a turn can never be closed without saying how it ended.
 */
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

/**
 * How a turn ended. The first three are the `turn` event's own states; `ended` is the session going
 * terminal underneath an open turn; `unknown` is a turn whose ending we never observed — the app was
 * quit mid-turn — and it exists so that case is recorded rather than back-filled as `completed`.
 *
 * ⚑ **An alias since 222**, when the list moved to `@brobot2/shared` so a surface could read it.
 * The name stays because it is what this file's ten references and the CHECK constraint call this
 * fact here; `TurnEnding` is the same five values under the name the wire and the renderer use.
 */
export type TurnEndReason = TurnEnding

/**
 * A stored bound: null is the ruled default, and anything that is not a whole count is `0`. ⚠️ The
 * column's CHECK admits only a whole count from 0 to `MAX_CAPABILITY_COUNT` (D-016 · R6); this fold is the reader's half
 * of the same rule, for a row no CHECK saw — one copied into this database, or edited by hand.
 */
function parseBound(stored: number | null, fallback: number): number {
  if (stored === null) return fallback
  return Number.isInteger(stored) && stored >= 0 ? stored : 0
}

/**
 * ⛔ **One capability row, as the two readers of it see it** (374).
 *
 * ⚠️ **Hand-written, and it is the honest price rather than an oversight.** The two STATEMENTS are
 * derived from {@link CAPABILITY_COLUMNS} and cannot drift; this is the shape those columns come
 * back in, and `better-sqlite3` types a row as `unknown`. ⚑ One name, one place, and
 * {@link SessionStore.setCapabilities}'s `Record<CapabilityKey, …>` is still the compile error that
 * makes somebody decide what a new column's WRITE looks like.
 *
 * ⛔ **Only the columns {@link CAPABILITY_FIELDS} names** — which, since D-016, are every capability
 * column the table has.
 */
interface CapabilityRow {
  max_depth: number | null
  can_message: string | null
  /** ⚑ **553** — see {@link ProfileCapabilities.canAssignWork}; a word, read by `parseChoice`. */
  can_assign_work: string | null
  can_create_agents: string | null
  /** ⚑ **582** — see {@link ProfileCapabilities.canWriteRules}; a word, read by `parseChoice`. */
  can_write_rules: string | null
}

/**
 * 🔴 **The read-side fold of EVERY `choice` column, from the field's own descriptor** (374,
 * generalising 341's `parseCanMessage`) — the same descriptor each column's CHECK is built from
 * (D-016 · R6), so the database and this reader admit one vocabulary.
 *
 * ⛔ **Derived rather than repeated, because 374 added the second one.** `parseCanMessage` spelled
 * its three words in its body, three lines below the same three words in
 * `CAPABILITY_FIELDS`. A `parseCanInterrupt` beside it would have made that four spellings of one
 * vocabulary — and `shared/capabilities.ts` already promises the opposite in words: *"a fold is
 * needed only for a KIND that is new"*. ⚑ **That was false for `choice` as 341 implemented it —
 * the three words lived in `parseCanMessage`'s body — and this is what makes it true for a field
 * whose VALUE TYPE this app already folds.** ⛔ A `choice` holding something other than a
 * {@link MessagingReach} is still real work, and it is a compile error at this function's return
 * rather than a silent cast; `capabilities.ts` states both halves.
 *
 * ⚠️ **The two folds are unchanged in behaviour**: `null` is the ruled default — *nobody has
 * chosen* — and any other unreadable value is {@link CapabilityField.narrowest}, never the default,
 * so a word the CHECK admits and this build cannot read can only ever NARROW a grant. 341's rule,
 * applied through the descriptor instead of through a literal.
 */
function parseChoice<K extends ChoiceKey>(key: K, stored: string | null): ProfileCapabilities[K] {
  // ⚠️ **The cast is over the GENERIC, not over the value** (419). `capabilityField` answers
  // `Extract<AnyCapabilityField, { key: K }>`, which TypeScript cannot see a common `ruled` on while
  // `K` is still a parameter — so the descriptor is named as the field type it is, and every read
  // below is then checked against {@link ProfileCapabilities} for that same `K`. ⛔ It does not widen
  // anything a caller can reach: `ChoiceKey` is what decides which keys arrive here.
  const field = capabilityField(key) as unknown as CapabilityField<K>
  if (stored === null) return field.ruled
  // ⚠️ **`vocabulary` is optional on the descriptor and `?? []` is not defensive padding**: a
  // `choice` with no words is refused at the IPC door (`capabilityValueSchema`) and would refuse
  // every value here, which is the narrow direction and the right one for a schema nobody finished.
  const words: readonly string[] = field.vocabulary ?? []
  return words.includes(stored) ? (stored as ProfileCapabilities[K]) : field.narrowest
}

/**
 * 🔴 **The provider a column says, or NULL — the one rule for a vocabulary the schema closes by
 * this fold rather than by a CHECK** (419).
 *
 * ⛔ **NOT `parseChoice`, and the difference is which list it is checked against.** That one reads
 * `CapabilityField.vocabulary` off the capability schema, and `agent_identity.provider` is not a
 * capability: it grants nothing and no rail reads it. ⚑ **Its vocabulary is `providerSchema`'s**,
 * which is the same list the wire, the adapters and `provider_session_provider_ck` all speak, so
 * there is one answer to *what is a provider* and this is a reader of it rather than a copy.
 *
 * ⚠️ **An unreadable word folds to NULL and never to a provider** — the same direction `parseChoice`
 * folds, argued on the same ground: *nobody has said* is the only safe reading
 * of *we cannot read what this row says*, and it is the value that changes nothing. ⛔ Folding to
 * `'codex'` would let a hand-edit or a future rename silently move an identity onto a provider
 * nobody chose, and it would be indistinguishable from a person who chose it.
 */
function parseProvider(stored: string | null): Provider | null {
  return providerSchema.safeParse(stored).data ?? null
}

/**
 * 🔴 **677 · an identity's default model and effort, read back — or NULL, *it has none*** (D-042 ·
 * R2).
 *
 * ⚑ **One JSON value, `{"provider","model","effort"}`**, because a model name belongs to a provider
 * — see `agent_identity.model_choice`.
 *
 * ⛔ **Anything it cannot read folds to NULL, WHOLE** — never a half. A value with an unreadable
 * provider is not *a model for some provider*: keeping the model and guessing the provider is the
 * one fold that could send a Claude model to Codex. ⚑ **D-042 · a value naming no model is NULL
 * too** — a default is a model and the effort it runs at, and `677`'s effort-only value names no
 * model a new conversation could start on. ⚠️ A blank effort is `null`: a model that offers none.
 * ⚑ A `standIn` key `682` wrote is not read: no launch judges a default again (D-042).
 */
export function parseModelChoice(stored: string | null): AgentModelChoice | null {
  if (stored === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const said = raw as Record<string, unknown>
  const provider = parseProvider(typeof said['provider'] === 'string' ? said['provider'] : null)
  if (provider === null) return null
  const model = said['model']
  if (typeof model !== 'string' || model.trim() === '') return null
  const effort = said['effort']
  if (effort === null || effort === undefined) return { provider, model, effort: null }
  if (typeof effort !== 'string') return null
  return { provider, model, effort: effort.trim() === '' ? null : effort }
}

/**
 * ⚑ **The one serialisation {@link parseModelChoice} reads** — key order fixed, so two writes of one
 * default are the same bytes. ⛔ `null` is written as NULL: *clear it*.
 */
export function modelChoiceWritten(choice: AgentModelChoice | null): string | null {
  if (choice === null) return null
  return JSON.stringify({ provider: choice.provider, model: choice.model, effort: choice.effort })
}

/**
 * ⚑ **D-042 · the JSON string array of the models a person added by hand** — NULL and unreadable
 * both fold to `[]` (none), the reading that adds nothing to the list.
 */
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

/**
 * ⛔ **Every capability whose stored value is ONE WORD — DERIVED from the schema, so a fourth one
 * costs this file nothing** (374, widened by 419).
 *
 * ⚠️ **It is not *"every field whose editor is `choice`"***, and the difference is the type checker.
 * `editor` is a fact about the CONTROL a person gets; this is a fact about what the column holds,
 * and only the second one can make {@link parseChoice}'s return type honest.
 *
 * 🔴 **It said `extends MessagingReach` until 419, and `canCreateAgents` is the field that made the
 * narrower predicate wrong rather than strict.** `374` wrote the trip-wire itself — *"a future
 * `choice` with a different vocabulary is NOT admitted here; it becomes a compile error at
 * `parseChoice`'s return rather than a silent cast"* — and that is exactly what happened. ⛔ **What
 * it must NOT become is `extends string` with a `parseChoice` that still returns
 * {@link MessagingReach}**: that would hand a `CreationReach` column back cast to a vocabulary it was
 * never checked against, which is the silent cast `374` refused. ⚑ **So the predicate widened AND
 * the return type became the field's own** — `ProfileCapabilities[K]` — and the fold is still
 * checked against the descriptor the value came from, one word at a time.
 */
type ChoiceKey = {
  [K in CapabilityKey]: ProfileCapabilities[K] extends string ? K : never
}[CapabilityKey]

/** How many of a conversation's newest turns are read to learn when a person last wrote. */
export const PERSON_LAST_WROTE_WITHIN_TURNS = 200

/**
 * ⛔ **A statement read through `events_fold_idx` may name only the types it holds** — every other
 * row is invisible to it, so a type added to a fold's own list and not to {@link FOLD_EVENT_TYPES}
 * would read as *that event never happened*. ⚑ Thrown as the store is built, so it cannot ship.
 *
 * ⚠️ **It reads the types a statement names as literals** — `type IN ('…')` and `type = '…'`, in
 * any case and spacing. A comparison it cannot read that way (`NOT IN`, `LIKE`, `<>`, a bound
 * parameter) is refused too: through this index it would see only these types, and nothing here
 * could say whether that is all it meant. ⚑ `x.type` is another table's column and is not read.
 */
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
/**
 * The provider walls read from a lookback on, with the launches, clears and torn clears that date
 * and retract them. ⚑ Kept per connection, so every store on one connection shares it and the
 * watch's queue.
 */
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
/**
 * How many rows the watch's queue holds before a read that has taken them all in empties it; the
 * watch itself empties it past `WALL_QUEUE_AT_MOST` ({@link watchProviderWalls}).
 */
const WALL_QUEUE_EMPTIED_FROM = 1024
/** How many launches of one conversation a kept walls read keeps. */
const LAUNCHES_KEPT_AT_MOST = 1024

export function createSessionStore(
  db: AppDatabase,
  now: () => number = Date.now,
  readPhases?: SessionReadPhases,
  /** Where a new agent's name is drawn from: a number in [0, 1), as `Math.random` gives. */
  random: () => number = Math.random,
): SessionStore {
  const connection = db
  const ownNotesStore = createOwnNotesStore(connection)
  const methodChangeStore = createMethodChangeStore(connection, now)
  const memoryRecoveryStore = createMemoryRecoveryStore(connection, now)
  let reconciliationNames: AppStatement | undefined
  const ledgerWrites = ledgerWritesFor(connection)
  db = withOptionalIndexes(db)
  const phase = <T>(name: string, read: () => T): T =>
    readPhases === undefined ? read() : readPhases.timed(`store.providerLimitsSeen.${name}`, read)

  const insertSession = db.prepare(
    `INSERT INTO provider_session (id, provider, cwd, status, approval_mode, profile_id, reasoning_effort, model, plan_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?)`,
  )
  /**
   * **A field a person cleared is null, and a field they never touched is also null** (339).
   *
   * ⛔ **What this must NOT do is turn a null into an empty string, and it does not**: `null` and
   * `undefined` fall through the trim and answer null. It folds one direction only — whitespace to
   * absence — because a person who types four spaces into a description has said nothing, and
   * recording four spaces would be 086's fabricated value in its smallest form.
   *
   * ⚠️ **It is NOT a reader.** A row that already holds `''` — from an older writer, a repair, a
   * hand-edited database — keeps it, and every reader has to tell that from null on its own.
   */
  const blankToNull = (value: string | null | undefined): string | null => {
    if (value === null || value === undefined) return null
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  // --- D-042 · the model list a person keeps, one row per provider ---
  //
  // ⚑ **Read, changed and written in ONE transaction**, so two doors writing one provider's row in
  // one tick cannot drop each other's half.
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
  // --- a person's API keys, sealed, one row per provider ---
  let apiKeyStatements: { read: AppStatement; write: AppStatement; forget: AppStatement } | null =
    null
  const apiKeySql = (): NonNullable<typeof apiKeyStatements> =>
    (apiKeyStatements ??= {
      read: db.prepare(`SELECT sealed, updated_at FROM provider_api_key WHERE provider = ?`),
      write: db.prepare(
        `INSERT INTO provider_api_key (provider, sealed, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET
           sealed = excluded.sealed, updated_at = excluded.updated_at`,
      ),
      forget: db.prepare(`DELETE FROM provider_api_key WHERE provider = ?`),
    })
  // --- the rails (341) ---
  //
  // ⚑ **Lazy, like every bag of statements in this file**: prepared on first use and kept together
  // by subject. ⚠️ Until D-016 the laziness let a store be BUILT over an older schema; since the one
  // migration there is no older schema, and what is left is the grouping.
  let spawnStatements: {
    readCapabilities: AppStatement
    writeCapabilities: AppStatement
    listIdentities: AppStatement
    ensureIdentityRow: AppStatement
    identityNameById: AppStatement
    identityBySlug: AppStatement
    /**
     * ⚑ **584 · every name anything already answers to, in BOTH columns** (`HO-078` §5.2) — read by
     * {@link nameForANewIdentity} so uniqueness is enforced AT ASSIGNMENT rather than refused after.
     *
     * ⛔ **`slug` as well as `display_name`, and that is the point of the pair**: an agent addressed
     * as `nadia` beside one displayed as *Nadia* is a collision a person trips over whichever column
     * produced it. ⚠️ The comparison is `human-names.ts`'s, so *the same name* is answered once.
     */
    namesInUse: AppStatement
    writeProvider: AppStatement
    /** ⚑ **558 · the rename** — the second writer of `display_name` and the first that corrects. */
    writeDisplayName: AppStatement
    /** ⚑ **677 · an identity's default**, read by slug — its own statement, see its definition. */
    readModelChoice: AppStatement
    /** ⚑ **677 · an identity's default, written** — and `setAgentProvider`'s clear of it (682). */
    writeModelChoice: AppStatement
    /** ⚑ **558 · the removal**, and the one `NO ACTION` key that makes it raise is the backstop. */
    deleteIdentity: AppStatement
    /** ⚑ **558 · index-backed on `provider_session_identity_idx`.** */
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
    /** ⚑ **629 · the chain above a conversation** — see {@link SessionStore.ancestorsOf}. */
    ancestors: AppStatement
    spawnedBy: AppStatement
    conversationBinding: AppStatement
  } | null = null
  const spawnSql = (): NonNullable<typeof spawnStatements> =>
    (spawnStatements ??= {
      // ⛔ **Both column lists come from {@link CAPABILITY_FIELDS} and neither is typed out** (355).
      // They were two hand-written lists that had to agree with each other, with the row cast below,
      // and with the ORDER of the arguments `setCapabilities` passes — four spellings of one fact,
      // and the last of them positional. ⚑ A fifth capability now changes none of them.
      // 🔴 **`agent_identity`, from 369 onward.** A grant is a fact about WHO an agent is, and every
      // rail that enforces one reads it by a bare slug.
      readCapabilities: db.prepare(
        `SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE id = ?`,
      ),
      writeCapabilities: db.prepare(
        `UPDATE agent_identity SET ${CAPABILITY_COLUMNS.map((column) => `${column} = ?`).join(', ')}
          WHERE id = ?`,
      ),
      /**
       * ⚑ **Every identity there is, and the surface that grants a capability needs it** (355).
       * `RuntimeHost.profiles()` lists DIRECTORIES; this lists ROWS, and the two disagree — a folder
       * can exist for a launch that was refused before it ever registered, and `setCapabilities`
       * answers `false` for every one of those. ⛔ A picker built off the folders would offer
       * identities the door refuses, so the door's own list is what it is built from.
       *
       * 🔴 **`WHERE project_id = ?` is GONE, and its absence is the ruling** (369). The parameter was
       * never a choice: `assertThePinnedProject` refused every value but one, and the write beside it
       * keyed on the constant regardless — *"a silent write into the wrong row, reported as there is
       * nothing here"* is the defect that pairing produced. An identity is global, so the list is.
       */
      listIdentities: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity ORDER BY slug`),
      /**
       * ⚑ **The identity row, `INSERT OR IGNORE` on its own derived id** (369) — the whole
       * concurrency control it needs: two writers racing to start the first conversation as an
       * identity cannot make two of it.
       *
       * ⛔ **No capability column** (D-014): a new row is NULL in every one of them, which is *nobody
       * has chosen*, so every identity starts with the one default set.
       */
      ensureIdentityRow: db.prepare(
        `INSERT OR IGNORE INTO agent_identity
           (id, slug, display_name, provider, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      /**
       * ⚑ **584 · the whole roster's two name columns, and nothing else** — see the declaration
       * above. ⛔ **No `WHERE display_name IS NOT NULL`**: the fold has to see the slug of a row
       * whose name is null, which is every row a launch minted before this dispatch.
       */
      namesInUse: db.prepare(`SELECT slug, display_name AS displayName FROM agent_identity`),
      /**
       * 🔴 **ONE identity, by name — the existence check, the read-back and the provider lookup**
       * (419).
       *
       * ⛔ **`INSERT OR IGNORE` could not answer the existence question and that is why this exists.**
       * It reports how many rows it wrote, so a creation built on it would say *nothing happened* for
       * a slug that is taken — the same answer it gives for a race it lost — and the door has to tell
       * a person BY NAME that the name is taken.
       *
       * ⚑ **Keyed on the FOLDED slug**, because `Worker` and `worker` are one identity (238) and
       * `agent_identity_slug_uq` is `COLLATE NOCASE` — so this asks the same question the unique
       * index would, one statement earlier, where there is a sentence to say.
       *
       * ⚠️ **The same {@link IDENTITY_COLUMNS} as the list**, so the row a creation answers with and
       * the rows a surface lists cannot be two shapes; {@link identityFrom} reads both.
       */
      identityBySlug: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity WHERE slug = ?`),
      identityNameById: db.prepare(
        'SELECT id, slug, display_name AS displayName FROM agent_identity WHERE id = ?',
      ),
      /**
       * 🔴 **The SECOND writer of `agent_identity.provider`, and the first one a person drives**
       * (433, HO-024 §2.2).
       *
       * ⛔ **Its own statement rather than a sixth column on `writeCapabilities`.** That statement's
       * column list is {@link CAPABILITY_COLUMNS} and is derived from the schema; appending a
       * column that is not a capability would make one writer answer two questions and would put
       * `provider` inside a `Record<CapabilityKey, …>` it is not a member of. ⚑ **Provider is not a
       * capability** — no rail reads it, it grants nothing — which is `419` §3's ruling and the
       * reason the column exists apart from them.
       *
       * ⚠️ **`WHERE id = ?` and no `INSERT`**, so a slug with no row writes nothing and
       * {@link SessionStore.setAgentProvider} answers `false` — criterion 12, exactly as
       * {@link SessionStore.setCapabilities} answers it: asking to configure something that does
       * not exist may not bring it into being.
       *
       * ⛔ **It writes `agent_identity` and cannot reach a conversation.** `provider_session` has no
       * writer of this column anywhere in the app and `a-front-door-that-asks-nothing.test.ts` §1
       * is the census that keeps it that way.
       */
      writeProvider: db.prepare(`UPDATE agent_identity SET provider = ? WHERE id = ?`),
      /**
       * 🔴 **The SECOND writer of `agent_identity.display_name`, and the first that can CORRECT one**
       * (558, `HO-063` gap 2).
       *
       * ⛔ **Its own statement, for {@link writeProvider}'s reason exactly**: `writeCapabilities`'
       * column list is {@link CAPABILITY_COLUMNS} and is derived from the schema, and a display name
       * is not a capability — no rail reads it and it grants nobody.
       *
       * 🔴 **`HO-016` §2 is what shapes it: *the app may seed a default at creation; it never
       * re-grants what a person removed*.** ⚑ So the direction matters. This statement is reached
       * ONLY by a person's verb; the app's own two writers are still
       * {@link ensureIdentityRow}'s `INSERT OR IGNORE`, which cannot overwrite a row that exists.
       * ⚠️ **There is therefore no path on which a seed lands on top of a rename**, and that is a
       * property of the statement shapes rather than of anybody remembering the order.
       *
       * ⚠️ **`WHERE id = ?` and no `INSERT`**, so a slug with no row writes nothing and
       * {@link SessionStore.setAgentDisplayName} answers `false` — criterion 12, exactly as
       * {@link writeProvider} answers it.
       */
      writeDisplayName: db.prepare(`UPDATE agent_identity SET display_name = ? WHERE id = ?`),
      /**
       * 🔴 **677 · an identity's default model and effort, by FOLDED slug** (D-042 · R2).
       *
       * ⛔ **Its own statement and NOT a column of `IDENTITY_COLUMNS`**: `AgentIdentity` does not
       * carry the choice (see `RuntimeCommand` `agentModelAndEffort` for why), so `identityFrom` would
       * be selecting a column it has no field to put in.
       */
      readModelChoice: db.prepare(`SELECT model_choice FROM agent_identity WHERE slug = ?`),
      /**
       * 🔴 **677 · the writer of an identity's default to `agent_identity.model_choice`** (D-042 · R2).
       * ⚠️ **The ONE statement**: `setAgentProviderTx` writes NULL through it when the provider moves
       * (`R31b`) — one UPDATE per question on this table, which
       * `a-gesture-that-creates-an-agent.test.ts` counts.
       *
       * ⛔ **Its own statement, for {@link writeProvider}'s reason exactly**: `writeCapabilities`'
       * column list is derived from the capability schema, and a model choice is not a capability —
       * it grants nothing, and no rail reads it as one.
       *
       * ⚠️ **`WHERE id = ?` and no `INSERT`**, so a slug with no row writes nothing and
       * {@link SessionStore.setModelChoice} answers `false` — criterion 12, as {@link writeProvider}
       * answers it. ⛔ **It reaches no conversation**: `provider_session.model` has its own two
       * writers and neither of them is this.
       */
      writeModelChoice: db.prepare(`UPDATE agent_identity SET model_choice = ? WHERE id = ?`),

      /**
       * 🔴 **The only statement in this app that removes an identity** (558, `HO-063` gap 1's *"a
       * way to remove one nothing runs"*).
       *
       * ⛔ **It is NOT the rail.** `provider_session.agent_identity_id` points here with `NO ACTION`,
       * so this statement RAISES for an identity that has ever run, under
       * `PRAGMA foreign_keys = ON` (`connection.ts`). ⚑ That refusal is real and it is the last
       * line of defence; it is not what a person is shown, because *FOREIGN KEY constraint failed*
       * names nothing a person can act on. {@link SessionStore.removeAgentIdentity} asks
       * {@link whatHoldsIt} first and this only ever runs on a row nothing holds.
       *
       * ⚠️ **What DOES go with it goes by CASCADE, declared on the foreign keys** — its
       * `external_mcp_server_grant` rows, its instruction versions and its memory amendments —
       * rather than by a second `DELETE` here, which is `deleteServer`'s own ruling one table over:
       * a second statement would be a
       * second answer to *what does removing this mean*.
       *
       * 🔴 **And what it does NOT reach is the point of {@link AGENT_REMOVAL_MEANS}**: the folder
       * under `provider-homes/` is bytes a person cannot get back, and no row in this database is
       * worth deleting one.
       */
      deleteIdentity: db.prepare(`DELETE FROM agent_identity WHERE id = ?`),
      /**
       * 🔴 **How many conversations have ever been recorded as each identity** (558) — ended or
       * not, ONE grouped statement for the whole roster.
       *
       * ⚑ **Index-backed**: `provider_session_identity_idx` is on `agent_identity_id`.
       */
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
      /**
       * ⚑ **One conversation's identity, through `provider_session.agent_identity_id`** — what
       * {@link SessionStore.identityOf} answers.
       */
      identityOfSession: db.prepare(
        `SELECT identity.slug AS profile_slug
           FROM provider_session s
           JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id = ?`,
      ),
      /**
       * ⛔ **The session's own identity, a SECOND statement in the same transaction** (369), so the
       * one INSERT serves every row and only a conversation with an identity of ours writes this —
       * one adopted from the user's own home has none.
       */
      writeIdentityOnSession: db.prepare(
        `UPDATE provider_session SET agent_identity_id = ? WHERE id = ?`,
      ),
      readPolicy: db.prepare(`SELECT spawning_enabled FROM app_policy WHERE id = 'policy'`),
      writePolicy: db.prepare(
        `UPDATE app_policy SET spawning_enabled = ?, updated_at = ? WHERE id = 'policy'`,
      ),
      /**
       * ⚠️ **Its own pair of statements rather than widening the two above** (500). `readPolicy` is
       * prepared once and its row shape is what `spawnPolicy` destructures; adding a column to that
       * SELECT would make the kill switch's reader carry a field it has no opinion about.
       *
       * 🔴 **And the writer does NOT touch `updated_at`, which is the half worth stating.** That
       * column's own docblock says what it is: *"when the SWITCH was last thrown, so a person can
       * tell a fresh install from a decision."* ⛔ Stamping it here would make one column answer two
       * questions and answer neither — the defect `ownerId` cost this project three dispatches to
       * split. ⚑ Nothing reads it today, so this is cheap now and impossible later: *when did the
       * person set their mode* is its own column and its own decision, and `500` did not make it.
       */
      readApprovalDefault: db.prepare(
        `SELECT default_approval_mode FROM app_policy WHERE id = 'policy'`,
      ),
      writeApprovalDefault: db.prepare(
        `UPDATE app_policy SET default_approval_mode = ? WHERE id = 'policy'`,
      ),
      readParent: db.prepare(`SELECT parent_session_id FROM provider_session WHERE id = ?`),
      /**
       * 🔴 **The other end of {@link readParent}'s edge** (543) — every conversation this app
       * recorded as having been started by one, with what it takes to NAME each of them.
       *
       * ⛔ **Served by `provider_session_parent_idx`**, the index `204` put on the self-FK for a
       * population nothing read until now.
       *
       * ⛔ **The join is LEFT, and an INNER join would have been a silent filter**: a conversation
       * this app never placed has `agent_identity_id IS NULL` (`438`), and it was still started. ⚑
       * It must survive with a null identity rather than vanish from a list whose whole subject is
       * *what did this conversation start*.
       *
       * ⚑ **In the order they were started** — `created_at`, then the id, so two rows written in one
       * millisecond cannot swap places between two reads.
       */
      spawnedBy: db.prepare(
        `SELECT s.id AS id, s.provider AS provider, identity.slug AS identity
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.parent_session_id = ?
          ORDER BY s.created_at, s.id`,
      ),
      /**
       * ⚑ **Which agent one conversation belongs to, for a reader that must tell *no identity* from
       * *no such row*** (543) — see {@link ConversationBinding}, which says why `identityOf` could
       * not answer it.
       */
      conversationBinding: db.prepare(
        `SELECT s.provider AS provider, identity.slug AS identity
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id = ?`,
      ),
      /** ⚑ **The parent, written in the transaction that writes the row** — `createTx`. */
      writeParent: db.prepare(`UPDATE provider_session SET parent_session_id = ? WHERE id = ?`),
      /**
       * 🔴 **629 · the chain above one conversation, nearest first** (`HO-095` §4) — see
       * {@link SessionStore.ancestorsOf}.
       *
       * ⚠️ **Bounded at 64 hops**, for a chain this query could be handed that nothing in this app
       * made — a hand-edited database, a restored bundle, a repair that pointed a row at its own
       * descendant. A recursive CTE over a cycle does not return, and a rail that hangs is worse
       * than a rail that refuses.
       *
       * ⚑ **`depth > 0` drops the conversation itself**, which is the seed row. ⛔ **`id <> ?` is
       * NOT that clause twice**: on a CYCLE the walk comes back round and would list the seed as
       * its own ancestor, and an entitlement predicate reading that list would admit a
       * conversation interrupting itself. ⚠️ A corrupt chain degrades to *not above you*, which is
       * the direction a rail may fail in.
       *
       * ⚠️ **On an ACYCLIC ledger either clause alone suffices, and that is written down rather
       * than left to be rediscovered**: `629 M3` removes BOTH because removing one is a mutation
       * that changes nothing (`a-mutation-that-changes-nothing-reports-as-a-survivor`), and
       * `629 M4` keeps the `id <> ?` half as a declared EXPECTED SURVIVOR — the ledger it guards
       * against is one no door in this app can make, so no fixture can reach it through a door.
       *
       * ⚠️ **Nearest first**, so a reader that wants the direct parent takes `[0]` and a reader
       * that wants membership asks `includes` — and neither has to know how the rows were ordered.
       */
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

  /**
   * 🔴 **The external MCP registry's two tables, in their own lazy bag** (516) — see
   * {@link spawnSql} for the rule.
   *
   * ⚠️ **What forces this bag:** the registry door, the capability sheet's save, a launch that has a
   * grant to resolve — and {@link identityFrom}, because an identity carries the servers it may
   * reach.
   */
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
      /**
       * ⚑ **Every registered server, oldest first** — the order a person added them in, which is the
       * only order this app knows anything about. ⛔ Not `ORDER BY name`: a registry is a list of
       * acts, and re-sorting it alphabetically would move a row a person is looking at when they add
       * an unrelated one.
       */
      listServers: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server ORDER BY registered_at, name`,
      ),
      /**
       * ⛔ **ONE server, by folded name — the existence check the creation door needs** (419's
       * `identityBySlug`, one table over, for its reason). `INSERT OR IGNORE` reports how many rows
       * it wrote, so a registration built on it alone would say *nothing happened* for a name that is
       * taken — the same answer it gives for a race it lost — and the door has to tell a person BY
       * NAME that the name is taken.
       */
      serverByName: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server WHERE name = ?`,
      ),
      /**
       * ⛔ **ONE server, by id — what a SAVE spells the grant's derived id from.** The grant id is
       * `emg:<identity>:<server name>`, so the write needs the NAME a payload only names by id.
       * ⚠️ Its own statement rather than a scan of {@link listServers}: a save naming ten servers
       * would otherwise read the whole registry ten times.
       */
      serverById: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server WHERE id = ?`,
      ),
      insertServer: db.prepare(
        `INSERT OR IGNORE INTO external_mcp_server (id, name, url, registered_at, reach)
         VALUES (?, ?, ?, ?, ?)`,
      ),
      /**
       * ⛔ **The row goes and every grant goes with it** — by CASCADE, declared on the foreign key,
       * rather than by a second `DELETE` here. ⚠️ A second statement would be a second answer to
       * *what does removing a server mean*, free to disagree with the schema the day somebody adds a
       * third table pointing at this one.
       */
      deleteServer: db.prepare(`DELETE FROM external_mcp_server WHERE id = ?`),
      /** Which servers one identity is granted, as ids — what a surface ticks its boxes from. */
      grantsOf: db.prepare(
        `SELECT server_id FROM external_mcp_server_grant WHERE identity_id = ? ORDER BY server_id`,
      ),
      /**
       * 🔴 **What a LAUNCH resolves — TWO ways to reach a server, and the first needs no grant**
       * (524, `HO-048` §1).
       *
       * ⛔ **`s.reach = 'everyone'` is the ruling, written as the thing the database compares.** The
       * column carries no CHECK (`schema.ts` says why), so this equality IS the fold on the launch
       * path: a hand-edited row and a word a later build writes are both `NOT 'everyone'` and both
       * need a grant. ⚑ **The
       * narrow direction is the one you get for free**, which is the only shape worth having here.
       *
       * ⛔ **`EXISTS` and no longer a `JOIN`**, and the change is not cosmetic: a JOIN returns a row
       * TWICE for a server that is everyone's AND separately granted — a grant made before `524`
       * survives beside the reach — and a duplicated server would reach the adapter as two entries
       * under one name. ⚑ `EXISTS` cannot produce one, so the shape refuses the duplicate rather
       * than a reader remembering to.
       *
       * ⚑ **The rows themselves and never ids**, because an adapter needs a URL and a name.
       */
      // ⚠️ **Renamed from `serversGrantedTo` at 524** (standing rule 25 — a name is a claim). It
      // answers *what may this identity use*, of which a grant is now one of two reasons; the old
      // name would have read as the grant table's own question and sent the next reader to the
      // wrong column.
      serversUsableBy: db.prepare(
        `SELECT s.id, s.name, s.url, s.registered_at, s.reach
           FROM external_mcp_server s
          WHERE s.reach = 'everyone'
             OR EXISTS (SELECT 1 FROM external_mcp_server_grant g
                         WHERE g.server_id = s.id AND g.identity_id = ?)
          ORDER BY s.registered_at, s.name`,
      ),
      /**
       * ⚑ **`INSERT OR IGNORE` on a DERIVED id**, which is this schema's concurrency control
       * everywhere: two windows ticking the same box cannot make two grants out of it.
       */
      insertGrant: db.prepare(
        `INSERT OR IGNORE INTO external_mcp_server_grant (id, identity_id, server_id, granted_at)
         VALUES (?, ?, ?, ?)`,
      ),
      /**
       * ⛔ **A save replaces the whole set**, so this clears and the inserts re-write — inside the
       * one transaction `setCapabilities` runs in. ⚠️ **A diff would have been the clever shape and
       * the wrong one**: the wire carries the COMPLETE set (`507` §5), so a person who unticked
       * everything and a payload that named nothing are the same act, and a diff would have had to
       * invent the difference.
       */
      clearGrantsOf: db.prepare(`DELETE FROM external_mcp_server_grant WHERE identity_id = ?`),
    })

  /**
   * 🔴 **The `configured` layer's statements — `identity_instruction`'s own lazy bag** (582) — see
   * {@link spawnSql} for the rule. ⚠️ `configuredLayerFor` forces it on every launch.
   */
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
      /**
       * ⚑ **Every version of one identity, NEWEST FIRST** — the order the sheet draws them in, and
       * the order a person reads a history in. ⛔ Index-backed on
       * `identity_instruction_identity_idx`, which is keyed `(identity_id, version)`; SQLite reads
       * that index backwards for a `DESC` on its second column.
       */
      versionsOf: db.prepare(
        `SELECT version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at
           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC`,
      ),
      /**
       * 🔴 **The ONE row a launch needs** — and it is its own statement rather than
       * `versionsOf[0]` because a launch must not pay for a history.
       *
       * ⛔ **`MAX(version)` and not `ORDER BY created_at`**: two versions written in the same
       * millisecond order by the number that cannot tie, and the number is what *in force* is
       * defined by — see `whatIsInForce`, which is the shared fold this agrees with.
       */
      newestOf: db.prepare(
        `SELECT version, text, wrote_it, author, by, conversation_id, said, brought_back, created_at
           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC LIMIT 1`,
      ),
      /**
       * ⛔ **A plain `INSERT`, never `OR IGNORE`** — and that is the whole of the append-only
       * guarantee. ⚑ The id is `ins:<slug>:<version>`, so two writers that computed the same next
       * version RAISE here rather than one of them silently doing nothing; `OR IGNORE` would report
       * a lost race as a successful save and the person would be looking at somebody else's text.
       */
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
    /** ⛔ **`unknown`, even though the column CHECKs it** — see {@link foldWhoWroteIt}. */
    wrote_it: unknown
    author: string | null
    by: unknown
    conversation_id: string | null
    said: string | null
    brought_back: number | null
    created_at: number
  }

  /**
   * ⛔ **`wrote_it` is folded here and nowhere else**, which is `foldExternalMcpReach`'s shape one
   * table over.
   *
   * The column's CHECK normally guarantees valid provenance. For an unreadable value, fold to `an-agents-proposal`, the least definite claim in `WROTE_IT_MEANS`, rather than asserting that the person wrote it.
   */
  const foldWhoWroteIt = (stored: unknown): WhoWroteIt =>
    typeof stored === 'string' && (WHO_WROTE_IT as readonly string[]).includes(stored)
      ? (stored as WhoWroteIt)
      : 'an-agents-proposal'

  /**
   * 🔴 **618 · the `by` column is TEXT to this reader, and `actedByFrom` wants an OBJECT.**
   *
   * ⛔ **Measured, not inferred:** `actedByFrom('{"who":"an-agent","agent":"sess_1"}')` answers
   * `{who: 'the-app-itself'}` — its first line is `typeof stored !== 'object'` — while the same
   * value parsed answers the agent. ⚠️ **`schema.ts` declares the column `mode: 'json'` and this
   * store does not read through drizzle**: every statement here is a raw `better-sqlite3` prepare,
   * so the column arrives as the string it is stored as.
   *
   * 🔴 **So every version of every identity's rules has read back as *the app itself* since `582`,
   * whoever performed the act.** ⛔ **Nothing a person saw was wrong** — `OwnInstructions.vue`
   * draws `WROTE_IT_MEANS[whoWroteIt]` and does not draw this field at all — which is exactly why
   * nothing went red: a field with no reader is a field with no test
   * (`a-field-is-proven-by-emptying-it`, one direction over).
   *
   * ⚑ **`618` gives it a reader and a meaning**: `whoWroteIt: 'its-creator'` says what KIND of act
   * wrote a version, and this is the only thing that says WHICH conversation did it.
   *
   * ⛔ **The catch answers the same narrow word the fold does**, so a hand-edited column that is
   * not JSON at all still says *this app does not know who* rather than throwing on a read.
   */
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
      // ⚑ **`actedByFrom` is the same fold every other stored `ActedBy` passes through**, so a row
      // this build cannot read answers *this app does not know who* rather than naming somebody.
      by: actorOf(row.by),
      conversation: row.conversation_id,
      said: row.said,
      broughtBack: row.brought_back,
      writtenAt: row.created_at,
      ...(author === undefined ? {} : { author }),
    }
  }

  /**
   * 🔴 **`identity_memory_amendment`'s statements — its own lazy bag** (625) — see {@link spawnSql}
   * for the rule. ⚑ Nothing on the LAUNCH path forces it; only the popup does.
   */
  let memoryAmendmentStatements: {
    amendmentsOf: AppStatement
    newestOf: AppStatement
    newestForEntry: AppStatement
    amendmentById: AppStatement
    insertAmendment: AppStatement
  } | null = null
  const memoryAmendmentSql = (): NonNullable<typeof memoryAmendmentStatements> =>
    (memoryAmendmentStatements ??= {
      /**
       * ⚑ **Every amendment of one identity, NEWEST FIRST** — the order a person reads a history
       * in. ⛔ Index-backed on `identity_memory_amendment_identity_idx`, keyed `(identity_id, seq)`;
       * SQLite reads that index backwards for a `DESC` on its second column.
       */
      amendmentsOf: db.prepare(
        `SELECT id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at
           FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC`,
      ),
      /** 🔴 **The ONE row the allocator needs** — its own statement, so a write never pays for a history. */
      newestOf: db.prepare(
        `SELECT seq FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC LIMIT 1`,
      ),
      newestForEntry: db.prepare(
        `SELECT id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at
           FROM identity_memory_amendment WHERE identity_id = ? AND provider = ? AND entry = ? AND outcome NOT IN ('pending', 'unchanged') ORDER BY seq DESC LIMIT 1`,
      ),
      /**
       * ⛔ **A plain `INSERT`, never `OR IGNORE`** — `insertVersion`'s own note and for its reason:
       * the id is `mem:<slug>:<seq>`, so two writers that computed the same next sequence RAISE
       * here rather than one of them silently doing nothing. ⚠️ `OR IGNORE` would report a lost
       * race as a recorded amendment, and the record is the only thing that survives the file.
       */
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
    /** ⛔ **`string`, and the column CHECKs the two words** — see the fold at `memoryAmendmentFrom`. */
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

  /**
   * ⛔ **`act` is folded here and nowhere else**, which is `foldWhoWroteIt`'s shape one table over.
   *
   * ⚠️ **The column carries a CHECK, so this can only fire on a hand-edited database** — and it
   * still folds rather than throws, in the direction that CLAIMS LESS: an unreadable act becomes
   * `corrected`, whose sentence says a person replaced text. ⛔ Folding to `removed` would make
   * this app tell somebody a memory was destroyed when the row it read is one it cannot read at
   * all, which is the direction that alarms (086's shape, pointed the other way from
   * `foldWhoWroteIt`'s because the reassuring arm here is the one that is still standing).
   */
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
      !['a-person', 'the-app-itself'].includes(observer.who) ||
      !Number.isSafeInteger(row.settled_at) ||
      row.settled_at === null ||
      row.settled_at < 0
    )
      throw new Error('Memory recovery observation is unreadable')
    return {
      outcome: row.outcome,
      actual,
      settlement: { by: { who: observer.who }, at: row.settled_at },
    }
  }

  const memoryAmendmentFrom = (row: MemoryAmendmentRow): MemoryAmendment => ({
    id: row.id,
    seq: row.seq,
    // ⚑ **`parseProvider` is the same fold every other stored provider word passes through.**
    // ⚠️ **The `??` arm is reachable only on a hand-edited database** — `identity_memory_amendment_provider_ck`
    // is what keeps it so — and it is a display fallback rather than a claim: {@link MemoryAmendment.entry}
    // is an absolute path THROUGH the provider home, so which store this row is about is legible
    // beside it whatever this word folds to.
    // The stored legacy display fallback stays fixed when new providers are added.
    provider: parseProvider(row.provider) ?? DEFAULT_IDENTITY_PROVIDER,
    entry: row.entry,
    act: foldAmendmentAct(row.act),
    // ⚑ **`actorOf`, which is the JSON-aware fold `618` added** — the column is `mode: 'json'` in
    // the schema and arrives here as the string it is stored as.
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
      // ⛔ **EXISTENCE first, and it is criterion 12 at this door** — `writeOwnInstructions`'
      // own line and for its reason: the INSERT would succeed on the foreign key only to leave a
      // record about nobody.
      if (spawnSql().identityBySlug.get(foldProfileName(said.profileSlug)) === undefined) {
        return null
      }
      if (memoryRecoveryStore.hasPending(rowId)) return null
      const linked = said.act === 'restored' || said.sourceId !== undefined
      if (linked) {
        if (
          said.by.who !== 'a-person' ||
          typeof said.sourceId !== 'string' ||
          !Number.isSafeInteger(at) ||
          at < 0
        )
          return null
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
      const by: ActedBy = linked || outcome === 'pending' ? { who: 'a-person' } : said.by
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
    /** ⛔ **`unknown`, because the column carries no CHECK** — see {@link foldExternalMcpReach}. */
    reach: unknown
  }

  /**
   * ⛔ **`reach` is FOLDED here and nowhere else** (524): every reader of an
   * {@link ExternalMcpServerRow} gets one of two words, and a value this build cannot read has
   * already become the narrow one before anybody asks a question of it.
   */
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

  /**
   * 🔴 **The two folds this file makes for every capability column, stated once** (341):
   *
   *  - **NULL is the ruled default.** Nobody has chosen, so `DEFAULT_CAPABILITIES` answers.
   *  - ⛔ **A value that is not the right SHAPE is the NARROWEST value, never the default.** A
   *    corrupt list, a hand-edited number, a word from outside `can_message`'s vocabulary — every one
   *    of them means *we cannot read what this row says*, and the only safe reading of that is *this
   *    identity may do nothing*. Falling back to the default would let a typo WIDEN a profile, which
   *    is the whole shape of defect these rails exist to refuse. ⚑ **Since D-016 each column's CHECK
   *    refuses a word outside its vocabulary and anything but a whole count from 0 to
   *    `MAX_CAPABILITY_COUNT`** (R6), so what still reaches this fold is a row no CHECK saw.
   */
  const readCapabilities = (rowId: string): ProfileCapabilities | null => {
    const row = spawnSql().readCapabilities.get(rowId) as CapabilityRow | undefined
    if (row === undefined) return null
    return {
      maxDepth: parseBound(row.max_depth, DEFAULT_CAPABILITIES.maxDepth),
      canMessage: parseChoice('canMessage', row.can_message),
      // 🔴 **553 · the grant that answers *may this identity GIVE WORK to that conversation*.**
      // ⛔ Read by {@link parseChoice} like every other word, and its `narrowest` is `'none'` —
      // which on this field means *not even a conversation it started itself*, so an unreadable
      // column can only ever stop an assignment and never admit one.
      canAssignWork: parseChoice('canAssignWork', row.can_assign_work),
      canCreateAgents: parseChoice('canCreateAgents', row.can_create_agents),
      // ⚑ **582 · read by {@link parseChoice} like every other word**, so a value this app cannot
      // read folds to `narrowest` — which on this field is `'none'`, the answer that reaches
      // nobody's instructions.
      canWriteRules: parseChoice('canWriteRules', row.can_write_rules),
    }
  }

  /**
   * ⛔ **The columns an identity is READ by, in ONE place** (419) — shared by the list and by the
   * by-name lookup, so the creation door's answer and the surface's list cannot come to two shapes.
   * ⚠️ The capability columns are {@link CAPABILITY_COLUMNS} and are therefore never typed out here.
   */
  const IDENTITY_COLUMNS = `id, slug, display_name, provider, created_at, created_by, ${CAPABILITY_COLUMNS.join(', ')}`

  /**
   * ⛔ **One row of {@link listIdentities}, as `better-sqlite3` hands it back** (419) — the named
   * shape {@link identityFrom} reads, so the SELECT and its reader cannot quietly disagree about
   * which columns are there. ⚠️ The index signature is what carries the capability columns, which
   * are {@link CAPABILITY_COLUMNS} and are therefore not spellable here.
   */
  type IdentityRow = {
    id: string
    slug: string
    display_name: string | null
    provider: string | null
    created_at: number
    /** ⚑ **598 · selected since this dispatch** — see {@link AgentIdentity.createdBy}. */
    created_by: string | null
    [column: string]: string | number | null
  }

  /**
   * 🔴 **One identity row, as a surface reads it** (355; extracted at 419 so the LIST and the
   * CREATION cannot come to two spellings of one record).
   */
  const identityFrom = (row: IdentityRow): AgentIdentity => {
    // ⚑ **The same resolver the rails use, by id**, rather than a second fold over `row`. One
    // extra statement per identity buys one answer to *what may this agent do* — and a list
    // whose numbers could disagree with the door's is worse than no list.
    //
    // ⚠️ **Before `chosen`, and the ORDER is load-bearing for the mutation table rather than for
    // the code.** With it below, a row that computed `chosen` from the resolved values would
    // have died of a temporal-dead-zone error instead of of the thing it names, and a row that
    // kills for the wrong reason measures nothing (found in review).
    const capabilities = readCapabilities(row.id) ?? DEFAULT_CAPABILITIES
    // ⛔ **`chosen` is read off the RAW column and nothing else** (355). It is `column === null`,
    // which is exact and needs no second opinion about what the text means. ⚠️ What it therefore
    // cannot say is whether a non-null column is READABLE — see `CapabilityOrigin` for why that
    // third state is deliberately absent rather than guessed at here.
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
      // 🔴 **598 · who brought this row into being, folded through the one reader of the encoding**
      // (`HO-084` §1). ⛔ **`readIdentityCreator` and never a comparison here**: `db/identity.ts` is
      // where `aid:` is derived, so a second place that knew the prefix would be free to disagree
      // with it. ⚠️ **An unreadable value is NULL — *nobody recorded it*** — so a hand-edited
      // column cannot put a claim into a row nobody wrote one into.
      createdBy: readIdentityCreator(row.created_by),
      capabilities,
      chosen,
      // ⛔ **Folded, and an unreadable word is NULL** (419) — see {@link parseProvider}. A surface
      // must not be handed `'clade'` to draw as a provider, and *nobody has said* is the reading of
      // an unreadable column that changes nothing.
      provider: parseProvider(row.provider),
      // 🔴 **516 · which registered servers this identity was GRANTED — ids, and the ROW's presence
      // is the grant** (HO-040 §4.2, endorsed in `HO-042` §6). ⚠️ **Since 524 that is no longer the
      // same question as *may reach*** (`HO-048` §1): an available-to-all server is usable by every
      // identity and appears in none of these lists, so a surface drawing this set as *what this
      // identity may use* under-reports it — see {@link SessionStore.externalMcpServersFor}, which
      // is the question a LAUNCH asks. ⛔ **Read as a second statement rather
      // than folded into `IDENTITY_COLUMNS`**: a grant is a RELATION and not a column, which is
      // `507` §5's ruling that server ids do not belong in the fixed `CAPABILITY_FIELDS` fold. ⚑ One
      // extra statement per identity, exactly as `readCapabilities` above already costs one — and
      // for the same reason: a list whose grants could disagree with the launch's is worse than no
      // list.
      externalMcpServerIds: grantedServerIds(row.id),
    }
  }

  /**
   * 🔴 **The two facts a CALLER may say about a new identity** (419) — everything else about the
   * row is derived, and no capability column is written at all.
   *
   * ⛔ **Each is `null` for *nobody has said* rather than absent**, which is 339's `.nullable()`
   * ruling arriving one layer down: a launch and a creation both have to answer both, so another
   * writer cannot be added without deciding what it says about each of them.
   */
  type SaidAtCreation = {
    displayName: string | null
    provider: Provider | null
  }

  /**
   * 🔴 **The name this app gives an identity it is bringing into being** (584, `HO-078` §5) — or
   * null when there is nobody new to name.
   *
   * ## ⛔ Why it asks whether the row is there first
   *
   * ⚑ **{@link writeIdentityRow} is `INSERT OR IGNORE` and runs on EVERY launch**, so a name
   * computed unconditionally would be computed once per conversation and thrown away for every
   * identity that already exists, and a draw that names nobody would still spend the random
   * source. ⛔ **So the generator runs only where a row is actually being minted**, which is what
   * makes *the app assigns a name when it brings an agent into being* literally true rather than
   * approximately.
   *
   * ⚠️ **The check is one indexed lookup on `agent_identity_slug_uq`**, the same statement the
   * creation door already asks one line earlier — so this is redundant on that path and correct on
   * both, which is `a-guard-that-only-a-live-run-can-trip-is-dark-by-default` in the direction that
   * costs a read rather than a defect.
   *
   * ## 🔴 The default profile is the one it deliberately leaves nameless
   *
   * ⛔ **{@link profileLabel} already answers *BroBot* for {@link DEFAULT_PROFILE_ID}, with a roster
   * and without one**, so a generated handle there would put a second answer in front of the one
   * every surface already gives. ⚠️ **A display fact**, compared on the folded slug and read by
   * nothing that decides what an agent may do.
   *
   * ⚑ **It runs INSIDE the caller's transaction**, so the roster it reads and the row it names
   * cannot be separated by another writer — which is the whole of *checkable before, not refused
   * after* on a column carrying no unique index.
   */
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

  /**
   * 🔴 **ONE identity row, `INSERT OR IGNORE` on its own derived id** (369; extracted at 419).
   *
   * ⚑ **`INSERT OR IGNORE` is the whole mechanism**: the columns below are written on the launch or
   * the creation that brings an identity into being and by nothing after it, so nothing a person
   * later sets is ever overwritten by a restart. ⛔ **No capability column and no role** (D-014): a
   * new row is NULL in all of them and follows the one default set.
   *
   * ⚠️ **The PROVIDER is the caller's, verbatim** (433) — see {@link identityRowFor} for where the
   * launch resolves `SEEDED_PROVIDERS`, and the argument below for why this row does not.
   *
   * ⚠️ **ONE writer of this row**, so the launch and the creation door cannot come to disagree
   * about what a new column gets.
   */
  const writeIdentityRow = (
    profileSlug: string,
    at: number,
    said: SaidAtCreation,
    broughtIntoBeingBy: IdentityCreator,
  ): void => {
    spawnSql().ensureIdentityRow.run(
      agentIdentityRowId(profileSlug),
      foldProfileName(profileSlug),
      said.displayName,
      // 🔴 **The provider is the CALLER's, verbatim, and the seed is NOT applied here** (433).
      //
      // ⛔ 339's `.nullable()` ruling makes *the caller did not mention it* and *the caller said
      // `null`* **one value** — which is right for a wire and wrong for a seed, because the two
      // doors mean opposite things by it. ⚠️ A LAUNCH mentions nothing: the provider it happens to
      // run on is an accident (`370`). ⛔ **A PERSON at the creation door who picks `Nobody has
      // said` has ANSWERED**, and `NewAgent.vue` tells them in as many words what that answer means
      // — so a seed that overrode it would record a word they declined to choose.
      said.provider,
      at,
      // 🔴 **598 · WHO — a REQUIRED argument and deliberately not part of {@link SaidAtCreation}**
      // (`HO-084` §1). ⛔ **`said` is what a CALLER SAYS about the new identity; this is who the
      // caller IS**, so a door cannot decline to mention it. ⚠️ **It is `INSERT OR IGNORE`, so this
      // lands only on the row that is actually being minted** — a fact about a row's BIRTH rather
      // than about the last thing that touched it.
      identityCreatorColumn(broughtIntoBeingBy),
    )
  }

  /**
   * 🔴 **An identity comes into existence, or the name is already taken** (419, HO-023 §2.4).
   *
   * ⛔ **ONE transaction, because the read and the write are one decision.** Two callers creating
   * the same name in the same tick would otherwise both read *nothing there* and both insert; inside a transaction the second one's read sees the first
   * one's row. ⚠️ That is not theoretical here at all: the two doors are a window and an agent's
   * tool, and both are live at once.
   *
   * ⚑ **The unique index would refuse the second one anyway** — `agent_identity_slug_uq` is
   * `COLLATE NOCASE` — and this exists so the refusal is a SENTENCE naming the taken name rather
   * than a constraint error crossing a process boundary.
   *
   * ⛔ **The FOLDED slug is what is looked up AND what is written**, so `Worker` collides with
   * `worker` rather than making a second identity over one home (238). The sentence the door builds
   * names the folded spelling, because that is the row that exists.
   *
   * 🔴 **It writes an `agent_identity` row and NOTHING ELSE — no home and no conversation** (§2 of
   * the brief). ⚠️ The home folder is laid down by the identity's first LAUNCH, under `HOME_FOLDER`
   * like every other home (`provider-homes.ts`).
   */
  /**
   * 🔴 **682 · an identity's provider, and a model choice that no longer belongs to it, in ONE
   * transaction** (`R31b`: *"`setAgentProvider` moving an identity to another provider clears its
   * choice in the same act"*).
   *
   * ⚑ **Cleared whenever the new provider is not the choice's** — a move, and also a re-save of the
   * provider an identity already had under a contradiction written before `682` (`677`'s door never
   * compared the two). ⛔ **A clear to NULL leaves the choice**: *nobody has said* is not another
   * provider, and a default is what then holds the provider its new conversations start on
   * (`aChoiceIsInForce`). ⚠️ A stored value this app cannot read is left alone — it reads as no
   * default, to every reader, already.
   */
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

  // ⚑ Read and written in one transaction, so a person's choice saved meanwhile is never written
  // over. ⚠️ Through `writeProvider`, the column's one statement, and never `setAgentProviderTx`:
  // that one clears a default model for another provider, and this save changes nothing else. ⚑ A
  // value this app cannot read is no provider, to every reader, so it is written over too.
  const saveProviderIfNoneIsSavedTx = db.transaction(
    (profileSlug: string, provider: Provider): boolean => {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      if (row === undefined || parseProvider(row.provider) !== null) return false
      return spawnSql().writeProvider.run(provider, row.id).changes > 0
    },
  )

  const createAgentIdentityTx = db.transaction(
    (said: NewAgent, at: number, broughtIntoBeingBy: IdentityCreator): AgentIdentity | null => {
      const slug = foldProfileName(said.slug)
      if (spawnSql().identityBySlug.get(slug) !== undefined) return null
      writeIdentityRow(
        slug,
        at,
        {
          // ⚠️ **Blank is NULL** ({@link blankToNull}): a display name somebody cleared and one
          // nobody ever typed are the same fact, and an empty string rendered as a value is a claim
          // nobody made (086).
          //
          // 🔴 **584 · and NULL now falls through to the generator** (`HO-078` §5). ⛔ **The two
          // callers mean opposite things by an absence and both are served by this line.** An AGENT
          // sends nothing because `create_agent` advertises no such field any more — *"the app
          // assigns; the agent does not choose it and does not ask"* — so there is no answer to
          // overrule. ⚑ **A PERSON at `NewAgent` who typed a name still wins**, because their string
          // arrives here and `??` never reaches past it; a person who left the box empty gets the
          // same handle a launch would have given, which is the one thing they could not get before.
          displayName: blankToNull(said.displayName) ?? nameForANewIdentity(slug),
          provider: said.provider,
        },
        // 🔴 **598 · the CALLER, and this door has two of them** (`HO-084` §1). ⛔ The window's is
        // `a-person` and the tool's is the identity that asked; neither is decided here, because
        // *who is creating* is a fact about the door and not about the row — see
        // `RuntimeHost.createAgent` and `RuntimeHost.createAgentFor`, which are the two places that
        // know, and `mayCreateAgents`, which is where the agent arm is resolved exactly once.
        broughtIntoBeingBy,
      )
      return identityFrom(spawnSql().identityBySlug.get(slug) as IdentityRow)
    },
  )

  /**
   * Make sure the global IDENTITY exists as a row, and answer with its id.
   *
   * ⚑ **The ONE place `profile_id` (the free string, and the directory name) becomes
   * `agent_identity_id` (the relation).** Both inserts below call it, in their own transaction, so
   * there is no path that writes one without the other and no second reading of what a profile is.
   *
   * ⛔ **D-016 · no binding.** A conversation is found by its agent: the schema has no binding
   * table, and `provider_session.agent_identity_id` is the conversation's one link to its identity.
   */
  const identityRowFor = (profileSlug: string, at: number): string => {
    // ⚠️ **A launch's CALLER says nothing about the two facts a creation says** (419) — which is
    // why both are answered here by this app rather than left null. ⛔ **The provider a launch
    // happens to run on is an accident, not a preference** — recording it would make
    // `agent_identity.provider` mean *the one this identity was first started on* (`370`), so the
    // launch records {@link seededProviderFor} instead: a first-run convenience keyed on the
    // identity (433). ⚑ **Not inside {@link writeIdentityRow}**, which the creation door also goes
    // through: there, `null` is a person who picked *Nobody has said* and must be left alone.
    //
    // ⚑ **The display name rides beside it for the same reason** — a launch names nobody, so an
    // identity this app brings into being by STARTING it is handed a generated name
    // ({@link nameForANewIdentity}, `HO-078` §5).
    //
    // 🔴 **598 · `this-app`, never whoever was in the conversation** (`HO-084` §1): who happened to
    // trip over a name is the same accident as the provider a launch ran on. ⚑ Give refuses a name
    // with no row (`no-such-profile`) unless its caller asked for a new agent, which it creates
    // through `createAgentIdentity` — so what reaches this line for a new identity is the front
    // door's first launch and `insertAdoptedRow`'s sweep, and in both this app is the only actor
    // there is.
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
  /**
   * An adopted row lands complete: it already has its ref, it is not running, and its approval
   * mode stays NULL because we genuinely do not know how it was run — 083 made that column
   * nullable for exactly this kind of honest gap.
   */
  const insertAdopted = db.prepare(
    `INSERT INTO provider_session (id, provider, external_ref, cwd, status, approval_mode, profile_id, created_at, updated_at, adopted_at, child_descent)
     VALUES (?, ?, ?, ?, 'ended', NULL, ?, ?, ?, ?, ?)`,
  )
  const touchAdopted = db.prepare(
    `UPDATE provider_session SET updated_at = ?
      WHERE id = ? AND adopted_at IS NOT NULL AND updated_at < ?`,
  )
  /**
   * ⛔ **A restored bundle says so on its own row** (214 §1). Its own statement rather than a
   * fourteenth `?` on {@link insertAdopted}: that INSERT is shared with `adopt()`, which writes
   * conversations that ARE in a home we provision, and a column only one of the two callers ever
   * sets is a column the other has to remember to pass NULL to. It runs inside
   * `importSnapshotTx`, so the row is never visible without it.
   */
  const markRestored = db.prepare(`UPDATE provider_session SET restored_at = ? WHERE id = ?`)
  /**
   * The descent back-fill (119). Two statements rather than one `UPDATE … SELECT`, because the rule
   * that decides what to write is {@link mergeDescent} and it is not expressible in SQL — "never
   * erase, prefer the richer field" is a merge of two JSON documents, not a coalesce.
   *
   * Do not touch `updated_at` when learning descent: it records provider activity and orders the person's reopen list. `touchAdopted` alone moves that clock using the provider's timestamp.
   *
   * ⚠️ **`adopted_at IS NOT NULL` on both**, like every statement in this pair: the column is only
   * ever written for a conversation discovery read out of a provider home. A session this app RAN
   * has no descent to learn — it has an input end by construction.
   */
  const readAdoptedDescent = db.prepare(
    `SELECT child_descent FROM provider_session WHERE id = ? AND adopted_at IS NOT NULL`,
  )
  const writeAdoptedDescent = db.prepare(
    `UPDATE provider_session SET child_descent = ? WHERE id = ? AND adopted_at IS NOT NULL`,
  )
  // `updated_at` moves with it: changing how a conversation is being run IS touching it, and the
  // reopen list is ordered by that column.
  const writeApprovalMode = db.prepare(
    `UPDATE provider_session SET approval_mode = ?, updated_at = ? WHERE id = ?`,
  )
  // `plan_mode` is deliberately NOT cleared — see the column comment: the pair is what a resume
  // reads, and one flag cannot say "it planned, and it no longer does". The `WHERE` makes that
  // pairing a property of the write rather than a rule the caller has to remember, and makes the
  // gesture idempotent: a second go-ahead keeps the first one's timestamp.
  const writePlanEnded = db.prepare(
    `UPDATE provider_session SET plan_ended_at = ?, updated_at = ?
      WHERE id = ? AND plan_mode = 1 AND plan_ended_at IS NULL`,
  )
  // The other direction (076). Both columns move in ONE statement because a resume reads them as a
  // pair: `plan_mode = 1` with a surviving `plan_ended_at` is "planned and released", which is
  // exactly the state that would have the Codex adapter assert `{mode:'default'}` on a session the
  // user has just asked to start planning.
  const writePlanStarted = db.prepare(
    `UPDATE provider_session SET plan_mode = 1, plan_ended_at = NULL, updated_at = ? WHERE id = ?`,
  )
  const writeModel = db.prepare(
    `UPDATE provider_session SET model = ?, updated_at = ? WHERE id = ?`,
  )
  const writeReasoningEffort = db.prepare(
    `UPDATE provider_session SET reasoning_effort = ?, updated_at = ? WHERE id = ?`,
  )
  // 🔴 **682 · `R31c`'s stamp** — its own statement, so the two writers above stay the ones a WAKE
  // uses too and this one stays the live-change door's alone.
  const writeSetByAPerson = db.prepare(
    `UPDATE provider_session SET model_or_effort_set_by_a_person_at = ?, updated_at = ? WHERE id = ?`,
  )
  // 🔴 **D-042 · R5 — what the provider reports it runs**, and ⛔ NOT `updated_at`: a report is not
  // activity, and the lists order by it.
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
  /** ⚑ **727 · R87's three statements, prepared on first use** — {@link spawnSql}'s rule. */
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
  // --- the turn table (045) ---
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

  function humanTurnAt(sessionId: string, generation: number, row: HumanPromptRow):
    { answer: HumanTurnAnswer; boundedAt: number } | null {
    const opening = toPersistedEvents([row])[0]
    const prompt = opening?.event.type === 'user_turn' ? humanPromptOf(opening.event) : null
    if (prompt === null || row.turn_id === null) return null
    const boundaries = ['reopened', 'status'].map((type) =>
      (humanBoundary.get(sessionId, generation, type, row.ordinal) as { ordinal: number } | undefined)?.ordinal
        ?? Number.MAX_SAFE_INTEGER,
    )
    const boundedAt = Math.min(...boundaries)
    const final = selectedHumanFinal.get(sessionId, generation, row.turn_id, row.ordinal, boundedAt) as EventRow | undefined
    const said = final === undefined ? undefined : toPersistedEvents([final])[0]
    return { boundedAt, answer: {
      promptOrdinal: row.ordinal, prompt,
      final: said?.event.type === 'assistant_message'
        ? { text: said.event.text, ordinal: said.ordinal, at: said.at } : null,
    } }
  }

  /**
   * ⚑ **The most recent CLOSED turn** (395) — the subject `selectLastTurnEndingEvents` narrows to,
   * asked separately so *"no rows"* can be told from *"no turn"*. ⛔ Not {@link selectLastTurn},
   * whose answer includes the turn that is running right now.
   */
  const selectLastClosedTurn = db.prepare(
    `SELECT id, opened_at, closed_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectStatus = db.prepare(`SELECT status FROM provider_session WHERE id = ?`)
  // ⚑ **D-013 · whose background work wakes it** — the provider decides, by its capability.
  const selectProviderOf = db.prepare(`SELECT provider FROM provider_session WHERE id = ?`)
  const selectTurnCount = db.prepare(
    `SELECT COUNT(*) AS n FROM turn WHERE session_id = ? AND generation = ?`,
  )
  // `closed_at` and `end_reason` are written together, which is what the table's CHECK enforces.
  // `blocked_at` is cleared on close: a finished turn is not waiting on anybody, and leaving the
  // mark would describe a closed turn as still blocked on an answer nobody can now give.
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
  /**
   * ⚑ **692 · the quit's stamp, and its eraser** — see `SessionStore.closedByTheQuit`.
   * ⚠️ `updated_at` is NOT touched by either: the rail orders by it, and a quit is not something a
   * conversation DID — a stamp that moved every row to the top at every restart would reorder a
   * person's list for nothing.
   */
  const stampClosedByTheQuit = db.prepare(
    `UPDATE provider_session SET closed_by_the_quit_at = ? WHERE id = ?`,
  )
  const clearClosedByTheQuit = db.prepare(
    `UPDATE provider_session SET closed_by_the_quit_at = NULL
      WHERE id = ? AND closed_by_the_quit_at IS NOT NULL`,
  )
  /** ⚑ The conversations the NEWEST quit stamped — one quit stamps all it closed with one moment. */
  const selectClosedByTheNewestQuit = db.prepare(
    `SELECT id, closed_by_the_quit_at AS at FROM provider_session
      WHERE closed_by_the_quit_at = (SELECT max(closed_by_the_quit_at) FROM provider_session)
      ORDER BY id`,
  )
  /**
   * ⚑ A conversation's background rows and its starts, newest first — bounded, read until a level
   * is stated or a start is passed.
   */
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
  /**
   * The generation a session's reads are scoped to, as SQL — for the two whole-table reads that
   * cannot take it as a parameter because they look at every row at once (065).
   *
   * `coalesce(…, 0)` is what makes every session written before this table existed, and every live
   * session that will never have a row in it, read exactly as it always did.
   */
  const SESSION_COLUMNS = `provider_session.id AS id, provider, external_ref, cwd, status, approval_mode, profile_id, reasoning_effort, model, plan_mode, plan_ended_at, model_or_effort_set_by_a_person_at, reported_model, reported_effort, adopted_at, restored_at, child_descent, provider_session.created_at AS created_at, provider_session.updated_at AS updated_at`
  /**
   * Every row's completeness contract, read alongside the row (065).
   *
   * ⚠️ **One LEFT JOIN, not five correlated subqueries** (review, LOW). The first version asked
   * `derived_generation` once per column and once more, nested, inside `has_events` — six correlated
   * lookups per session, on a query that runs on every library read and every keystroke of its
   * search box. The join answers all of it in one pass, and `coalesce(g.active, 0)` inside the
   * `EXISTS` is what keeps a session with no row (one this app RAN) reading exactly as it always
   * did rather than dropping out of the list.
   *
   * LEFT and not INNER for that same reason: a session with no generation record is not a session
   * with no history — it is one whose ledger was recorded rather than projected, and the nulls that
   * come back ARE that statement.
   */
  /**
   * ⛔ **504 · whether this conversation has a ledger — ONE definition.**
   *
   * ⚑ **Lifted out of {@link GENERATION_COLUMNS} in 504 for a second statement, which D-016
   * deleted; {@link GENERATION_COLUMNS} is its one reader now.** ⚠️ The `coalesce(g.active, 0)` is the
   * load-bearing part: without it a session with no `derived_generation` row — one this app RAN
   * rather than projected — reads as having no transcript at all, which takes the Read gesture off
   * every row it is the answer for.
   */
  const HAS_EVENTS_COLUMN = `EXISTS (SELECT 1 FROM events
                                       WHERE events.session_id = provider_session.id
                                         AND events.generation = coalesce(g.active, 0)) AS has_events`
  const GENERATION_COLUMNS = `${HAS_EVENTS_COLUMN},
            g.normalizer_version AS normalizer_version,
            g.building AS building,
            g.failure AS failure`
  const GENERATION_JOIN = `LEFT JOIN derived_generation g ON g.session_id = provider_session.id`
  /**
   * **How this conversation's LAST turn ended** (222) — the fact `220` had to open a conversation
   * to find out.
   *
   * Derive this from the `turn` table rather than add a second stored copy of the ending. `turn_session_ordinal_uq` makes the lookup an index seek per conversation rather than a scan.
   *
   * ⛔ **CLOSED turns only.** An open turn has no ending, and taking its null would make a running
   * conversation indistinguishable from one whose last turn completed. The newest CLOSED one is the
   * last ending this conversation actually had.
   *
   * Generation-scoped like everything else read here: a rebuilt projection's turns are the ones the
   * surface is showing (065).
   */
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
    `SELECT session_id, payload FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND type = 'replaced_by' AND json_valid(payload)
        AND EXISTS (SELECT 1 FROM provider_session
                     WHERE provider_session.id = json_extract(events.payload, '$.sessionId'))
      ORDER BY events.rowid`,
  )
  // Rank levels across generations before reading history and compactions for live candidates.
  // A torn newest level must suppress older jobs; a JSON row without jobs states no level.
  const selectNewestScheduleLevels = db.prepare(
    `WITH levels AS MATERIALIZED (
       SELECT session_id, created_at, generation, ordinal, payload
         FROM events INDEXED BY events_fold_idx
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
  // The newest turns of a conversation, as the rows that opened them: one walk back down the index,
  // which stops at its bound.
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
  // A conversation's receipts, its provider's levels, and its launches and life endings: the newest
  // of each kind, in the order they were written. ⚑ One walk back down the index, which stops one
  // row past its bound, so the work does not grow with the conversation; ⚑ the last row the
  // statement gives says how far it went (`walked`), so whether there is more needs no second walk.
  // ⚑ `json_valid` first: the JSON functions throw on a payload that is not JSON.
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
  /**
   * 🔴 **The rows `derivePieces` folds, from the owner's {@link pieceFoldFloor} on** (379, as
   * tasks; D-016).
   *
   * ⛔ **Narrow for 053's reason**: *"a whole session is never held in memory"*, and a session may
   * hold 181,791 rows. ⚑ **The floor is the bound that matters**, and a conversation that was never
   * given a piece has none: nothing is read at all.
   *
   * ⚠️ **The type list is the fold's, and the two must move together.** ⛔ **Stated without a
   * COUNT** (`396`'s rule): a type the fold branches on and this list omits reads as *"that event
   * never happened"* — silently, and only on the replayed path, which is every path after a
   * restart. ⚑ The easiest to drop are the ones that change no piece's STATE: `request_stranded`
   * sets {@link PieceRow.questionLostAtRestart}, and `user_decision` and `work_interrupted` name who
   * stopped a turn ({@link PieceRow.stalledBy}).
   *
   * ⚑ **Read through `events_fold_idx`** ({@link FOLD_EVENT_TYPES}): a fold from its floor on reads
   * the rows of these types, not every row after the floor.
   */
  // ⚑ **F093 · R2** — a turn's `sent` is not the fold's: dropped in SQL, so the fold parses no more
  // than it did before a turn carried its whole text. ⚠️ Only from a payload that IS JSON: a row that
  // will not parse still reaches `toPersistedEvents`, which skips it, rather than failing the read.
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
  /**
   * 🔴 **The owner's first `work_given`** — where {@link pieceFoldFloor} begins (379, as tasks;
   * D-016).
   *
   * ⚑ **`events_work_idx` serves it**: it names the index's seven types in the index's own order
   * beside the one it asks for — SQLite uses a partial index only for a WHERE that implies the
   * index's, the trick `newestLine` uses too.
   *
   * 🔴 **`+generation`, and the plus is load-bearing.** ⛔ Without it SQLite prefers
   * `events_session_ordinal_uq`, whose two equality columns look narrower, and walks the ledger
   * row by row to its first piece row — measured on a 90,000-row ledger, 9.6 ms a read against
   * 0.005 ms, with and without `ANALYZE`. ⚑ The unary plus changes no value; it keeps `generation`
   * out of index selection, so the partial index answers and the generation is checked on the one
   * row it finds.
   *
   * ⛔ **The first `work_given` ONLY, not the first of the seven.** A root owner's ledger holds
   * `work_retitled` and `work_status_set` rows about its root — the factory text asks it to title
   * its root on its first turn — and a `work_given` only for work it took on (`take_on_work`, D-016
   * · commit 6), so a floor on any of the seven would fold its whole ledger from that first title
   * on, on every read, to find nothing. ⚑ No line about a piece is lost: no title, status, reply or
   * taking back can name a piece before its `work` row, written with its `work_given`, exists — and
   * the fold passes over a line about a piece it holds no row for.
   */
  const selectFirstPieceGiven = db.prepare(
    `SELECT min(ordinal) AS ordinal FROM events
      WHERE session_id = ? AND +generation = ?
        AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                     'work_status_set', 'work_rebriefed', 'work_closed')
        AND type = 'work_given'`,
  )
  /**
   * ⚑ **D-016 · commit 6 · the turn a row was written in, or the last turn before the wake it was
   * written in** — the newest `user_turn` below an ordinal, walked back under
   * `events_session_ordinal_uq` to the first one it meets.
   */
  const selectTurnOpenedBefore = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal < ? AND type = 'user_turn'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  /**
   * ⚑ **D-016 · commit 6 · the newest row below an ordinal that STATES a level** — a
   * `background_work` with `running`, or a `scheduled_work` with `jobs` (`@path`), and how many it
   * stated. ⛔ An edge — `ended` — states none, and `absent ≠ []` (`247`). ⚑ The payload is guarded
   * with a `CASE`, the only order SQLite promises, so a torn row is passed over rather than raising.
   */
  const selectLevelStatedBefore = db.prepare(
    `SELECT ordinal, json_array_length(payload, @path) AS stated FROM events
      WHERE session_id = @session AND generation = @generation AND ordinal < @before
        AND type = @type
        AND CASE WHEN json_valid(payload) THEN json_type(payload, @path) END = 'array'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  /**
   * 🔴 **Every conversation this app has PLACED — the forest's own candidate set** (637) — see
   * {@link SessionStore.everyPlacedConversation}.
   *
   * ⚑ **Placed is `agent_identity_id IS NOT NULL`, read as `JOIN agent_identity`** (D-016: a
   * conversation is found by its agent): a conversation with no identity is one swept out of the
   * person's own provider home, held by no agent of this app, and the INNER join is what keeps it
   * out — {@link countConversationsHeldByNoAgent} counts it instead.
   *
   * ## ⚑ `GENERATION_JOIN` is deliberately ABSENT, and that is not an oversight
   *
   * ⛔ **Nothing this SELECT returns is generation-scoped.** The generation columns exist so a
   * reader can tell a live projection from one this app has replaced, and every column here is on
   * `provider_session` itself — an id, an identity, a status and the parent, none of which a
   * re-projection moves. ⚠️ **The LEDGER fold is where the generation matters**, and
   * `piecesOfSession` asks `activeGeneration(sessionId)` for itself; adding the join here would
   * pay for it twice and imply this row was scoped by it.
   *
   * ## 🔴 `LIMIT ?` — bound on the CANDIDATE SET, and bound NEWEST first
   *
   * ⚠️ **What is unusual is WHERE the bound sits** — every other `LIMIT` in this file caps a lookup
   * (`LIMIT 1`) or a page a caller asked for, and this one caps the POPULATION a read about the
   * whole workspace is willing to walk.
   *
   * ⛔ **`ORDER BY updated_at DESC`**: this order DECIDES WHAT IS DROPPED, and the conversations a
   * person can afford to lose are the ones they stopped looking at. 🔴 **`updated_at` and not
   * `created_at`**: `created_at` is when a conversation BEGAN, so a bound over it drops a month-old
   * conversation somebody is still working in before a new one nobody has touched. ⚑
   * {@link selectAll}, the Library's own read, has ordered by `updated_at DESC` since `047` for the
   * same reason.
   *
   * ⚑ `id DESC` is the tiebreak, so two conversations whose rows last moved in the same
   * millisecond cannot straddle the bound differently on two reads.
   */
  const selectEveryPlacedConversation = db.prepare(
    `SELECT provider_session.id AS id, identity.slug AS profile_slug,
            provider_session.provider AS provider, provider_session.status AS status,
            provider_session.created_at AS created_at,
            provider_session.updated_at AS updated_at,
            provider_session.parent_session_id AS parent_session_id
       FROM provider_session
       JOIN agent_identity identity ON identity.id = provider_session.agent_identity_id
      ORDER BY provider_session.updated_at DESC, provider_session.id DESC
      LIMIT ?`,
  )

  /**
   * ⚑ **How many conversations this app has placed** (637) — the forest's candidate set and the
   * digest's, counted.
   *
   * ⛔ **A statement rather than `rows.length`**: *"the party that WALKED is the only one that can
   * say what it walked"* — and past `MAX_FOREST_CONVERSATIONS` the two numbers differ, which is the
   * entire point of having it. ⚠️ It is not the whole table: `agent_identity_id IS NOT NULL` is what
   * makes it the population the forest and the digest are about — the forest's JOIN, counted.
   */
  const countPlacedConversations = db.prepare(
    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NOT NULL`,
  )
  /** How many of a list of conversations are placed: the ones a person's lists leave out. */
  const countPlacedAmong = db.prepare(
    `SELECT count(*) AS n FROM provider_session
      WHERE agent_identity_id IS NOT NULL AND id IN (SELECT value FROM json_each(?))`,
  )

  /**
   * 🔴 **The digest read: every digest-eligible row a placed conversation produced inside a window**
   * (438; one list since D-016).
   *
   * ⛔ **ONE FLAT TEMPLATE LITERAL.** An interpolated `${…}` type list would make the statement a
   * fragment to anything that reads it out of this file by name.
   *
   * ⚑ **Driven from the placed conversations** (`agent_identity_id IS NOT NULL`), then each
   * session's own `(session_id, generation, ordinal)` range — one seek per placed conversation, with
   * `created_at` and `type` as residual filters.
   *
   * ⛔ **The types are the digest vocabulary, spelled out, and the two lists are one fact.** They are
   * `DIGEST_EVENT_TYPES` in `shared/digest.ts`, and the two lists must move together for exactly
   * the reason `selectPieceEvents`' note gives about its own: a type the fold branches on and this
   * statement omits reads as *"that event never happened"*, silently. A census asserts the pair.
   *
   * ⚠️ **`[from, to)` — half-open.** Two adjacent windows must not both contain a row stamped on
   * the boundary, or a person reading yesterday and today sees one turn twice.
   */
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
  // The digest's rows are kept per conversation between reads (see `keptDigestRows`): the Away
  // page asks every 30 s for a window that slides forward, and a ledger is only ever appended to, so
  // a later read takes only the rows above each conversation's newest-read ordinal.
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

  /**
   * Every placed conversation's digest rows from `from` on, brought up to date in one read
   * transaction. The first read, or one reaching earlier than the kept rows, is the full window
   * read; after that each conversation adds only its rows above the newest ordinal it was read to,
   * and is read afresh when its ledger was rebuilt (a new active generation).
   */
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
  /**
   * ⚑ **Conversations no agent of this app holds** (438) — the digest's and the forest's coverage
   * hole, counted.
   *
   * ⛔ **`agent_identity_id IS NULL` is the whole of it** — the placed reads' exact complement, so
   * the two counts add up to the table. No identity reaches such a conversation, so neither read
   * covers it — and a count a person can act on beats a taxonomy they cannot.
   */
  const countConversationsHeldByNoAgent = db.prepare(
    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NULL`,
  )
  /**
   * 🔴 **The conversations one giver's pieces went to — read off `work`** (393 as tasks; D-016).
   *
   * ⛔ **Candidates, and nothing more**: the answer is still the fold, run over each owner's ledger
   * and filtered on the giver the fold read, so a row this table names and the fold does not is
   * caught rather than inherited. ⚑ Served by `work_given_by_idx`; no ledger is scanned to find
   * them, and a torn ledger row cannot hide one.
   *
   * ⚑ **`identity` is the owner's `agent_identity` slug**, read beside the candidate so the two
   * cannot come from two reads and disagree. ⛔ **Both joins are LEFT**: an owner this app holds no
   * identity for was still given the work, and must survive with `identity` null rather than
   * vanish from a list whose whole subject is *what did I hand out*.
   */
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
  /**
   * 🔴 **What this conversation has already been TOLD about pieces it gave** (404) — its
   * `work_stall_told` receipts, the durable half of criterion 4's push.
   *
   * ⛔ **Two types, and the second one is what makes the first honest.** A receipt says a notice was
   * accepted; a notice that was HELD rather than sent can still be abandoned, and the ending for it
   * is a `message_unqueued` row in this same ledger. ⚑ Reading both here is what lets one pass
   * answer *"was it really told?"* instead of *"did we try?"*.
   *
   * ⚠️ **`ordinal >= (SELECT min(…))` over the receipts, which is sound because a receipt is written
   * AFTER the message it names**: `queueMessage` records the held message first and this row
   * second, so no ending that matters can sit above the first receipt — and a conversation that has
   * never been told anything reads no rows at all, the NULL subquery
   * {@link selectRoutedRequestEvents} relies on for the same reason.
   *
   * ⚑ **Read through the event-kind index**: the person's look asks it of every giver whose work
   * stalled, every five seconds, and through `events_fold_idx` it walked every fold row of the
   * giver's ledger.
   */
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
  // Whether a row written after a kept fold of the receipts can change it: a receipt, an abandoned
  // message, or a row the fold would count as unread.
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
  /** ⚑ **F036** — {@link SessionStore.whoRoutedToWhom}'s pairs, by the routings' own index. */
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
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.passedUpFrom') END = ?`,
  )
  /** ⚑ **F026** — {@link SessionStore.theDecisionOn}'s one row, by the fold's own index. */
  const selectLatestMoveOffer = db.prepare(
    `SELECT payload FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'question_asked'
        AND CASE WHEN json_valid(payload) THEN json_type(payload, '$.move') END = 'object'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTheDecisionOn = db.prepare(
    `SELECT payload FROM events
        INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type = 'user_decision'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END = ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  /**
   * {@link SessionStore.theRequestRouted}'s row: the newest provider request before the routing
   * that names it. The routing is written right after its request, so the scan back stops at once.
   */
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
  /**
   * 🔴 **One conversation's routed requests, narrowly** (394) — `selectPieceEvents`' shape, one
   * subject over. ⚠️ **Not served by `events_request_routed_idx`**: since D-017 · R4 the floor names
   * `question_asked` beside `request_routed`, which that index's predicate does not cover. ⚑ **Read
   * through the event-kind index**, so the floor and its rows skip unrelated work history.
   *
   * ⚠️ **Narrow by construction**, on 053's rule: the types the fold acts on, from the first
   * routing's ordinal onward, and never the whole session. A conversation that has never routed
   * anything reads no rows at all — the `ordinal >= (SELECT min…)` is NULL, which matches nothing.
   *
   * ⛔ **Stated without a COUNT.** It read *"four event types"* while listing five, because `396`
   * added one and left the sentence — `396`'s own rule, applied to the sentence that escaped it.
   *
   * ⚑ **`request_interrupted` is here for `397`, and `work_taken_back` and `work_closed` for D-016**
   * — a piece taken back or closed ends the owner's questions about it — **and the census in
   * `a-question-finds-a-person.test.ts` is what makes forgetting either impossible**: a type the
   * fold branches on and this query does not select reads as *that event never happened*,
   * silently, and only on the replayed path — which is every path after a restart.
   *
   * ⚑ **D-017 · R4** — bounded by the first question this app asked or the first routing, whichever
   * came first (a `question_asked` precedes its own routing), plus the last `launched` row before
   * that bound: the one fact the fold needs from the rows it does not read.
   */
  // ⚑ **F093 · R2** — a launch's `given` is not the fold's: dropped in SQL, so the fold parses no more
  // than it did before a launch kept its record. Of the `status` rows, only those that end the
  // provider are read, and those the fold cannot read, which it counts: it acts on no other state,
  // and an agent at work writes them by the thousand.
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
  /**
   * 🔴 **Every conversation that has ever routed a request** (396) — `selectSessionsRoutingTo`'s
   * shape with the predicate dropped, and served by the same `events_request_routed_idx`.
   *
   * ⛔ **The candidates for the startup sweep, and only the candidates.** The FOLD decides which of
   * them still holds something open — `piecesGivenBy`'s rule, and here it is the whole design:
   * *"nothing has ended it"* is a property of a ledger and not of a row, so no SQL predicate can
   * answer it without becoming a second copy of `deriveRoutedRequests`.
   *
   * ⚠️ **No generation filter here**, deliberately: `routedRequestsOfSession` scopes to the ACTIVE
   * generation, and a session whose only routing lives in a superseded projection reads no open rows
   * and is skipped by the fold rather than by this query.
   *
   * ## ⛔ What it costs at every launch, and the cheaper filter that would be WRONG
   *
   * ⚠️ **One narrow read per candidate**, and the candidates are conversations that have both a
   * parent and a raised request — a small population.
   *
   * ⛔ **Skipping sessions whose `provider_session.status` is terminal was considered and refused.**
   * It would remove nearly every historical conversation and it is not sound: `settleOrphanRuns`
   * and `terminate` move that COLUMN and append no event, so a session can read `ended` while its
   * ledger holds no `status: ended` for the fold to abandon on — and the request it was holding
   * would then stay `open` for ever, which is the exact state this sweep exists to end.
   */
  const selectSessionsThatRouted = db.prepare(
    `SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'`,
  )
  /**
   * 🔴 **Every instruction ask and every ending, across every conversation** (582) — served by
   * `events_instruction_ask_idx`.
   *
   * ⛔ **Cross-session, which is where it differs from every ledger read above it.** The surface
   * that answers an ask is an IDENTITY's sheet, and an identity is not a conversation — so the
   * question is *what is waiting for me anywhere*, which no `(session_id, ordinal)` index can
   * serve.
   *
   * ⚠️ **NOT scoped by generation, and the fold is what makes that safe.** A rebuild replays an ask
   * verbatim into a new generation, so a conversation whose transcript was rebuilt holds the same
   * `askId` twice — and `waitingOnAPerson` keys a MAP by `askId`, so a duplicate collapses rather
   * than putting the same decision in front of a person twice. ⛔ Scoping here would need the
   * active generation of every session in the database, which is the walk this index exists to
   * avoid.
   *
   * ⚑ **Ordered by the clock and then by the ordinal**, because the fold needs an ask to be seen
   * before its ending and two rows of one conversation can share a millisecond.
   */
  const selectInstructionAsks = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal,
            -- D-017 · R8: which rows are torn, so the reader skips them and says so.
            json_valid(payload) AS readable, payload
       FROM events
      WHERE type IN ('instruction_proposed', 'instruction_settled')
      ORDER BY created_at, session_id, ordinal`,
  )
  /**
   * Every MCP server request and every ending, across every conversation, served by
   * `events_mcp_request_idx`. Not scoped by generation, for `selectInstructionAsks`' reason: the
   * fold keys requests by id, so one a rebuild replayed collapses. Ordered so a request is read
   * before its ending.
   */
  const selectMcpServerRequests = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal,
            json_valid(payload) AS readable, payload
       FROM events
      WHERE type IN ('mcp_server_requested', 'mcp_server_request_settled')
      ORDER BY created_at, session_id, ordinal`,
  )
  /**
   * 🔴 **Every recorded line that could be a provider wall, newest first** (533) — served by
   * `events_error_idx`, and narrowed three ways before a single payload is parsed.
   *
   * ⛔ **The `LIKE` terms are `PHRASES`' own, built from the array rather than typed here.** A
   * hand-written filter beside a recogniser drifts from it silently and in the one direction nobody
   * can see — `a-filter-can-blind-the-instrument-that-justifies-it`. ⚑ It is a PREFILTER and not a
   * second opinion: it decides which rows are worth `JSON.parse`, and `readProviderLimit` decides
   * what a wall is.
   *
   * ⚠️ **Why it is needed at all.** Every provider retry, every unusable model and every failed
   * sandbox writes a non-fatal `error` row, so *the errors of the last month* is a population
   * thousands deep in a workspace this app is used in — and this read runs every five seconds
   * behind a person's queue. The type index bounds it to errors; the clock bounds it to the
   * lookback; this bounds what is decoded to the handful that mention a limit.
   *
   * ⚑ **Read in slices, in the index's own order**, so a month of errors can be read a few hundred
   * rows at a time: right after launch in short steps ({@link SessionStore.readAheadProviderWalls}),
   * or at once by a caller that needs the answer now. The `ORDER BY` is the index's and costs no
   * sort; a slice ends only where the next one starts, so the read is never short. It returns every
   * error row in the range, and the payload only of one the prefilter keeps, so a slice's bound is
   * the rows it reads; the hint is on the slice's own start, so SQLite seeks to it. A read that is
   * not kept reads them at once instead. {@link foldProviderLimits} picks the newest observation per
   * wall off each row's own stamp, so the order decides nothing there.
   *
   * ⛔ **No `generation` filter, and since `586` it is one of THREE reads in this file that want
   * none** — this one, and the two that retract what it finds. A wall is a fact about the
   * provider's account, not about a conversation, so a projection this app has replaced has not
   * un-spent the window, and has not un-answered a turn either.
   */
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
  // A read that is not kept reads them at once, the prefilter in the statement: inside a
  // transaction, or on a connection the watch cannot be put on, as the limits worker's.
  const selectProviderWallsAtOnce = db.prepare(
    `SELECT rowid AS row, session_id, ordinal, payload, created_at FROM events
      WHERE type = 'error' AND likelihood(created_at >= ?, 0.00001) AND (${wallLike('payload')})`,
  )
  // A conversation's launches. A wall's life (when the life that recorded it began) is the
  // latest-stamped of them below the wall's ordinal, `null` on a ledger written before these rows.
  // Every generation is read: a rebuilt one holds the errors imported from the transcript but no
  // launches. Read once per conversation, not once per wall, through the event-kind index.
  const selectLaunchesOf = db.prepare(
    `SELECT ordinal, created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND type = 'launched' AND session_id = ?`,
  )
  theFoldIndexHolds(selectLaunchesOf)
  // A conversation's launches, kept with the read; those of one launched more often than
  // LAUNCHES_KEPT_AT_MOST are read again whenever a wall of it needs its life worked out.
  function keepTheLaunchesOf(read: WallsRead, session: string, launches: Launch[]): void {
    if (launches.length <= LAUNCHES_KEPT_AT_MOST) {
      read.launches.set(session, launches)
      return
    }
    read.launches.delete(session)
    read.launchesNotKept.add(session)
  }
  // A wall's life is read only when its provider changed sign-in before the wall, which is rarely,
  // so a conversation's launches are read only then, and kept with the read.
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
  /**
   * 🔴 **The last moment each provider was answering, INFERRED from a turn that completed** (586,
   * `HO-080` §1).
   *
   * ⛔ **It reads the `turn` TABLE and not the `turn` EVENT, and the column is checked rather than
   * assumed** (standing rule 25). `end_reason` is written by `closeTurn` from the event's own
   * `state` — `if (event.type === 'turn' && open) closeTurn.run(at, event.state, open.id)` — and
   * `closed_at` is written in the same statement, which the table's `turn_end_reason_ck` enforces.
   * ⚑ So `end_reason = 'completed'` IS *a `turn` event with `state: 'completed'`*, indexed, one row
   * per turn instead of one row per event.
   *
   * The newest completed turn is kept per provider and conversation. A conversation crossing an
   * account boundary is read separately through its session index when identities are available.
   *
   * ⛔ **No `generation` filter**, for `selectProviderWalls`' reason exactly: a wall is a fact about
   * the provider's account, and a projection this app has replaced has not un-answered a turn.
   *
   * ## ⚑ Why this one has no index of its own and is still bounded
   *
   * ⛔ **It only runs when a wall is standing**, which is almost never — {@link
   * SessionStore.providerLimitsSeen} skips it entirely when nothing came back from the read above,
   * so the five-second poll pays nothing in the ordinary case. ⚠️ **A kept read asks it once
   * instead**: `provider_wall_turns` holds each provider's newest completed turn, filled from every
   * turn row in slices (read ahead after launch), and the watch's triggers keep it current
   * ({@link watchProviderWalls}). A read that is not kept asks this from the OLDEST wall's own
   * stamp: a record older than the wall could not retract it.
   */
  const selectTurnsCompletedSince = db.prepare(
    `SELECT t.session_id, ps.provider AS provider, MAX(t.closed_at) AS at
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.end_reason = 'completed' AND t.closed_at > ?
      GROUP BY ps.provider, t.session_id`,
  )
  // The newest of each provider over one slice of the turn table: how `provider_wall_turns` is
  // filled. ⚑ Every turn: the newest completed turn is the answer whatever wall it is asked about.
  const selectTurnsCompletedIn = db.prepare(
    `SELECT t.session_id, ps.provider AS provider, MAX(t.closed_at) AS at
       FROM turn t JOIN provider_session ps ON ps.id = t.session_id
      WHERE t.rowid > @after AND t.rowid <= @after + ${TURNS_READ_AT_ONCE}
        AND t.end_reason = 'completed'
      GROUP BY ps.provider, t.session_id`,
  )
  const selectNewestTurnRow = db.prepare(`SELECT coalesce(max(rowid), 0) AS last FROM turn`)
  /**
   * 🔴 **The last moment each provider SAID a window of its own is not blocking work** (586,
   * `HO-080` §1.3) — served by `events_provider_clear_idx`.
   *
   * ⛔ **This is the provider's own word and the read above is an inference**, which is why both
   * exist: `LimitStanding` holds `stopped` to the provider's own word, and `HO-080` §1.3 holds the
   * retraction to the same standard. ⚑ **It is also the only one that carries a WINDOW**, which is
   * what lets `allowed (five_hour)` disprove a `five_hour` wall and leave a `seven_day` one
   * standing — `HO-080` §1.2's requirement, and no completed turn can meet it.
   *
   * Grouped by provider, conversation and window so different accounts remain distinct.
   * `json_extract` answers `NULL` for a payload with no `window` key and such a row could only
   * come from a schema that no longer exists. ⛔ **It does not match "no wall"** — this said so until
   * `676`'s review: `takingWorkSince` folds `NULL` to `''`, which `foldProviderLimits` reads as *the
   * provider as a whole*, so a no-window clear retracts every wall of its provider.
   *
   * 🔴 **676 · a torn clear is EXCLUDED, not grouped** — one whose payload was not JSON made this
   * RAISE whenever a wall was standing, and the person's limit band with it. ⛔ **Excluded rather
   * than read as `'{}'`**: a guarded payload has no `window`, which the fold reads as *the provider
   * as a whole* (the paragraph above) — so a torn clear would RETRACT every wall of its provider. ⚑ Left out,
   * the wall stays standing, which is the direction a person can act on. The `CASE` is kept
   * because an order inside WHERE is not promised; {@link selectTornLimitClearsSince} warns and
   * counts what was left out.
   */
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
  /**
   * ⚑ **676** — the torn clears {@link selectLimitsClearedSince} leaves out, for its walk's count.
   * ⚠️ **The ACTIVE generation only** (`676`'s review): the walk counts rows, and a torn clear a
   * rebuild copied would otherwise be two — `RowsUnread`'s rule, kept by hand where they are
   * counted ({@link takingWorkSince}), since a read is kept across a rebuild's promotion.
   */
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
    // ⚑ **`null` is a payload with no `window` key and it folds to `''`**, which this app reads
    // as *the provider as a whole*. It is unreachable from the current schema and it is written
    // rather than asserted away, because a stored row outlives the code that wrote it.
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
  // Every clear from a kept read's lookback on, a slice at a time, in the clear index's order: a
  // month of them is read ahead after launch as the walls are.
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
  // Reads a walls read's clears on until they are whole or `until` passes; true once whole. A read
  // that is not kept reads them at once, grouped, as the limits worker's bound expects.
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
  /**
   * Fills `provider_wall_turns`, a slice of the turn table at a time, until it is filled or `until`
   * passes; true once filled. A turn completed meanwhile is kept by the watch. How far it is filled
   * is kept with the table, for what the watch had counted, so every store on the connection
   * shares one fill.
   */
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
  /**
   * 🔴 **Every record that could retract one of these walls, and nothing wider** (586, `HO-080` §1).
   *
   * ⛔ **Bounded by the oldest unexpired wall in the list**, which is the only floor that loses nothing: a
   * record stamped before every standing wall cannot be newer than any of them, and
   * {@link foldProviderLimits} requires strictly newer. ⚑ So the reads below answer about the
   * narrowest window that can still change an answer.
   *
   * ⚠️ **An empty list reads NOTHING at all.** `providerLimitsSeen` runs behind a five-second poll
   * and no provider has walled on almost every one of those ticks — ⛔ a retraction read that ran
   * anyway would be a cost with no question behind it, on the path `533` already narrowed three
   * ways before parsing a single payload.
   *
   * ⛔ **Two sources and they are not merged** — see {@link ProviderTakingWork}. A completed turn is
   * this app inferring the provider answered, and carries no window; a `provider_limit_clear` is the
   * provider's own word and carries the window it named.
   */
  const takingWorkSince = (
    walls: readonly ProviderLimitSeen[],
    read: WallsRead,
    // ⚑ **676 · each torn clear this read left out** — warned and counted by the caller's walk.
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

  /**
   * The watch's statements on this connection, once its temp tables and triggers are in place, or
   * `null` where they cannot be ({@link watchProviderWalls}).
   */
  let wallWatchStatements: WallWatchStatements | undefined
  function wallWatch(): WallWatchStatements | null {
    if (wallWatchStatements !== undefined) {
      if (providerWallsWatched(connection)) return wallWatchStatements
      wallWatchStatements = undefined
      wallsReadOn.delete(connection)
    }
    // A watch that is not whole, found by this store or any other, is put back whole with a new
    // revision, so every read kept on this connection begins again and the turns are filled anew.
    // Tried again at the next read when it cannot be: a connection busy with another read refuses.
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
    // ⚑ **A row this app cannot read is SKIPPED and COUNTED** — `toPersistedEvents`' rule, which
    // `453` made countable because *"a summary may be scoped, a list of obligations may not"*. ⛔
    // Here the bill is smaller and the rule is the same: a wall in a payload that would not parse
    // is a wall a person is not being told about.
    const { session_id, ordinal, created_at } = row
    try {
      const event = JSON.parse(row.payload) as { message?: unknown }
      if (typeof event.message !== 'string') throw new Error('an error row with no message')
      return { session_id, ordinal, created_at, said: readProviderLimit(event.message, created_at) }
    } catch (error) {
      // ⚑ **One warn, for `toPersistedEvents`' reason exactly**: the count tells a person their
      // list may be short and says nothing about WHICH row, and *"this can never be known to have
      // happened"* is the state that rule exists to end. Warned as the row is read.
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

  // The walls read kept on this connection, begun again where it cannot be carried forward: a
  // removed or rewritten row, another connection's write, a clock gone back past what it holds, or
  // rows of the queue emptied before it read them.
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

  /**
   * The walls read, kept on this connection and brought up to date: a month of error rows is read
   * and parsed once, then only the rows written since. On the main thread this read ran after each
   * error, clear or turn row, and a whole read of a large workspace took seconds.
   *
   * The watch says what moved ({@link watchProviderWalls}). Each added row of the read's types is
   * read by itself. Anything a kept read cannot carry forward begins it again. Nothing is kept
   * inside a transaction, whose rows may yet roll back, nor where the watch cannot be put: those
   * read everything. ⚑ A kept read holds {@link WALLS_KEPT_BEFORE_MS} more than asked, so a clock
   * that steps back a little reads nothing again; a caller filters by its own lookback.
   */
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
    // At most WALL_QUEUE_AT_MOST rows: the watch empties the queue past that, and the read then
    // begins again.
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

  /**
   * Takes in the rows the watch queued since the read last did, a slice at a time, until it has
   * every row queued when it began or `until` passes; true once it has. Then, if the queue is
   * long, empties it up to there: another read that had not taken all of it in begins again
   * ({@link watchProviderWalls}).
   */
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

  /**
   * Reads ahead what {@link theWallsRead} would read at once, until `until` passes: the walls, the
   * launches of each conversation that wrote one, the clears and the completed turns. True once all
   * of it is read and kept.
   */
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
  /**
   * 🔴 **The words of every question this conversation raised** (396) — what `list_questions` hands
   * a parent that was not there when its child asked.
   *
   * ⛔ **Read back from the request's OWN row rather than copied onto the routing**, so the two
   * cannot drift: what a parent reads is the event the card was drawn from. ⚑ `394` deliberately
   * kept the text off `RequestRoutedEvent` and this keeps it off — the routing row still says only
   * that a request exists and where it went.
   *
   * ## ⚠️ What this `type` filter is for, corrected by its own mutation row
   *
   * ⛔ **It is `053`'s narrow read and NOT a safety gate**, and the first version of this note said
   * otherwise. `396` wrote a row that widened it to admit `permission_request` and the row SURVIVED,
   * because the mutation is a no-op: that event carries `kind`, `action` and `detail` and has no
   * `prompt` and no `questions`, so the rows come back with two SQL `NULL`s and the caller skips a
   * row it cannot read.
   *
   * 🔴 **What actually keeps a permission's words from a parent is
   * `RuntimeHost.questionsWaitingOn`'s narrowing on {@link WhereARequestWent}'s REFUSED arm**
   * (`611`; it was `because === null` until `HO-088` §2 gave a second way to be a person's), and it
   * has to be a field rather than a type: a Codex grant of access arrives ON `user_input_request`
   * WITH a prompt and parts, told apart by a field — so no filter over `type` could ever see it.
   * ⚑ `InterruptRefusalDetail`'s omission, one subject over: the door that refuses a parent by name
   * must not hand back what it just refused.
   */
  /**
   * 🔴 **The words of every question this conversation raised, whoever raised it** (396; widened by
   * `437`).
   *
   * ## ⛔ Two types, because there are two authors and only one of them is a provider
   *
   * ⚠️ **`user_input_request` is the model's question and `question_asked` is the app's** — a worker
   * that called `ask_question`. ⛔ The app may not write the first: `RuntimeHost`'s two app-authored
   * doors take a closed union that has never held a provider event type, and widening it so this
   * query could stay one-typed would have made *"the model asked"* and *"the app asked"* one row.
   * ⚑ **So the LEDGER distinguishes them and this reader does not need to** — `questionsWaitingOn`
   * renders either with one `questionText`, which is what keeps a parent's `list_questions` one list.
   *
   * ## ⚠️ `COALESCE`, because the two rows spell the id differently
   *
   * ⛔ **`$.id` on the provider's row and `$.requestId` on ours**, and that is deliberate rather
   * than an oversight: every row THIS APP authors about a request calls it `requestId` —
   * `request_routed`, `user_decision`, `request_escalated` — and a new app row spelling it `id` to
   * suit one query would be the odd one out in its own family. ⚑ `deriveRoutedRequests` already
   * carries this exact idiom for `request_resolved`, *"two spellings of one correlation, and the
   * fold has to know both"*.
   *
   * ⚠️ **`json_extract` returns NULL for a key that is not there**, so each row contributes exactly
   * one id and the coalesce cannot mask a row that has both — no row has both.
   *
   * ## 🔴 474 · `$.piece`, which only one of the two rows carries (the piece since D-016)
   *
   * ⛔ **`json_extract` returns NULL for a key that is not there**, so a `user_input_request`
   * contributes no piece and a `question_asked` contributes the piece it is about — one column, two
   * populations, no branch. ⚠️ A `question_asked` written before D-016 carries a `taskId` this
   * reads nothing from: it is about no piece, which is what it now is.
   *
   * ## 🔴 671 · R18 — a torn question row no longer RAISES either
   *
   * ⛔ **`json_extract` in a SELECT list raises on a payload that is not JSON, exactly as it does in
   * a WHERE** — `664`'s review found this second path: one torn `user_input_request` in a holder's
   * own ledger failed every wait read of that holder, and through the composition the Team forest
   * and the receiver's line. ⚑ **So the payload is guarded in a subquery**, and every extraction
   * below reads the guarded column, unchanged; `readable` says which rows were torn and `ordinal` is
   * what the caller counts them by. ⛔ The guard is a `CASE`, the only order SQLite promises: two
   * `AND`-ed terms may be evaluated in either order.
   *
   * ⚑ **Read through the event-kind index**, for the look's reason: it reads the question rows and
   * no other fold row.
   */
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
  // ⛔ **The reads through `events_fold_idx` name only types it holds** — see
  // {@link theFoldIndexHolds}.
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
  /**
   * 🔴 **The rows that say how ONE turn stopped** (395) — the last CLOSED turn of a session.
   *
   * ⛔ **Narrowed by `events.turn_id` and not by ordinal**, which is the whole reason this question
   * is answerable at all. `045` gave every row the turn it belongs to precisely so *"what happened
   * during that turn"* is a join rather than a guess about ordering, and an ordinal window would
   * sweep in the next turn's `error` the moment a conversation carried on.
   *
   * ⚠️ **Three types and deliberately not `status`.** A status is about the SESSION — `idle` follows
   * a stop and a recoverable fault alike — and it arrives AFTER the terminal that closed the turn,
   * so it carries no `turn_id` to be narrowed by. See `how-work-stopped.ts`'s note.
   *
   * ⚑ **The last CLOSED turn**, so a conversation working right now reports the ending before this
   * one rather than an empty reading of a turn that has not finished.
   */
  /**
   * ⚑ **The rows {@link howWorkStopped} folds, for the last CLOSED turn** (395, 484).
   *
   * ⛔ **494 · `user_decision` is the fourth type and the second that carries an ACTOR.** ⚠️ The
   * fold and this list are the pair that can drift, exactly as `selectPieceEvents` and
   * `derivePieces` are: a type the fold branches on and this statement omits reads as *that event
   * never happened*, silently. ⚑ `the-interruption-that-looks-like-a-fault.test.ts` censuses the
   * two against each other for that reason.
   *
   * ⚑ **The turn narrowing is what makes the join sound.** `events.turn_id` takes the OPEN turn at
   * append time, and a permission is answered INSIDE the turn it stops — so the decision row and
   * the terminal that closes the turn are on the same id, and a cancel from an earlier turn cannot
   * reach this reading at all.
   */
  // Read by the turn's own index; the conversation's index would walk its whole ledger to find
  // one turn's rows.
  const selectLastTurnEndingEvents = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_turn_idx
      WHERE session_id = ? AND generation = ?
        AND type IN ('turn', 'error', 'work_interrupted', 'user_decision')
        AND turn_id = (SELECT id FROM turn
                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
                        ORDER BY ordinal DESC LIMIT 1)
      ORDER BY ordinal`,
  )
  /**
   * ⚑ **The requests ended while the last CLOSED turn ran**: that turn's own
   * `request_interrupted` rows, by `events.turn_id`. ⛔ Never by their time: two turns can share a
   * millisecond, and a clock can go back. ⚑ A row written with no turn open carries no turn, so it
   * is in no answer; a torn row names no request.
   */
  const selectRequestsTheLastClosedTurnInterrupted = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END AS request
       FROM events INDEXED BY events_turn_idx
      WHERE session_id = ? AND generation = ? AND type = 'request_interrupted'
        AND turn_id = (SELECT id FROM turn
                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
                        ORDER BY ordinal DESC LIMIT 1)
      ORDER BY ordinal`,
  )
  // 🔴 **D-012 · the last exchange's and the transcript's reads.** ⚑ A torn row is a CANDIDATE and
  // comes back with `payload` null (`676`'s guard): it cannot say whether a sub-agent wrote it.
  // ⚠️ `main-thread` = `parentToolCallId IS NULL`, which is what `614` read as *its own agent*.
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
  /** ⚑ **F080** — whether a turn opened as one its provider began by itself (`provider_turn`). */
  const selectAProviderTurnsOpening = db.prepare(
    `SELECT 1 AS began FROM events WHERE turn_id = ? AND type = 'provider_turn' LIMIT 1`,
  )
  /** ⚑ The `user_turn` row that opened a turn — its own, by `events_turn_idx`. */
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
  /**
   * ⚑ **F009 · the first message a conversation received** — its first `user_turn`, walked forward
   * under `events_session_ordinal_uq`: a conversation's first turn opens with it, so the walk stops
   * among its first rows. ⚑ Guarded with a `CASE`, so a torn row reads as one rather than raising.
   */
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
  // 🔴 **F080 — a transcript's turns begin at a received message or at a turn its provider started
  // by itself** (`provider_turn`), so a wake's words are never filed under the message before it.
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
  /**
   * ⚑ **F080 — what a turn its provider started followed**: the provider's own summary of each
   * piece of background work that ended since this conversation's previous turn — its ending, its
   * opening, or a reopen, whichever is newest — and before the `provider_turn` at the given
   * ordinal, oldest first.
   */
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
  /** ⚑ **F080** — a turn its provider started by itself after an ordinal (a received message). */
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
  // ⚠️ `instr` over `lower()` rather than `LIKE`: nothing in a person's search needs escaping, and
  // `lower` folds ASCII only — said as a limit, not hidden.
  // ⚑ Each hit answered by the RECEIVED message its turn starts at — or (F080) the turn its
  // provider started — distinct, newest first; one query, so nothing else runs on the connection
  // while it is read.
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
  /**
   * 🔴 **The last time anybody asked this conversation's work to stop** (484, HO-031 §2.1).
   *
   * ⛔ **Not narrowed by `turn_id`, and the absence of that clause is the whole statement.**
   * {@link selectLastTurnEndingEvents} one query up joins on the last closed turn, which is correct
   * for a question about a TURN and blind to every ask written while nothing was running — and
   * `turnFor` writes exactly that row with `turn_id = null`. ⚑ The column is SELECTED instead, so
   * the reader can say which turn the ask landed on rather than having its answer decided by a
   * `WHERE` it cannot see.
   *
   * ⚠️ **One row, the newest.** `394`'s rule at `howWorkStopped` — *the LAST ask wins* — asked of a
   * conversation instead of a turn: somebody stopping work an agent already asked about is the same
   * shape, one subject up.
   *
   * ## 🔴 494 · a permission answered `cancel` is such an ask, so it is in the OR
   *
   * ⛔ **Left out, one payload would contradict itself.** `AgentCard` carries {@link
   * AgentCard.lastEndedTurn} and {@link AgentCard.lastAskToStop} together, and `494` teaches the
   * first to name a person for a cancel. ⚑ A second field on the SAME card answering *no row says*
   * about that same press is `484`'s own defect — two neighbouring facts a reader has to choose
   * between — arriving through the door `484` opened.
   *
   * ⚠️ **`json_extract` narrows to the one outcome that is an ask**, the idiom this file already
   * uses over `payload`. ⛔ It runs on `user_decision` rows and on no others: the type equality is
   * the left conjunct, so `allow` and `deny` cost one comparison each and never a JSON parse.
   * ⚑ **`type` is SELECTED** because the reader has two row shapes to tell apart and must not
   * infer which it has from a field one of them happens to lack.
   *
   * ## 🔴 723 · R81 — a cancel that asked nothing is not in it
   *
   * ⚑ A `user_decision` marked `stopsNothing` answered an MCP elicitation card (every one since
   * `736`, R97; until then only one whose frame named no turn): its Cancel asked no turn to stop
   * (*"the host records no ask"*). ⛔ **The folds' own predicate, exactly** — a
   * `user_decision` whose `stopsNothing` is JSON `true` — so the two readers of one ledger cannot come
   * to disagree over a row this build did not write (`723`'s review: `IS NULL` also passed over a
   * `false`, a string, and a `work_interrupted` carrying the field, which the folds count). ⚠️ **`IS`,
   * not `=`**: on every other row `json_type` is NULL, and `NOT (… AND NULL)` is NULL, which drops the
   * row — the first draft of this line passed over every real ask.
   *
   * ## 🔴 671 · R18 — a torn row is passed over, not raised on
   *
   * ⛔ **The `json_extract` above RAISED on a torn `user_decision`, and a torn `work_interrupted` got
   * through to an unguarded `JSON.parse`** — so one torn row in a holder's ledger failed every
   * `AgentCard` of it, and through `list_tasks`' per-row card lookup the whole of `list_tasks`
   * (found by `671`'s own review). ⚑ **The payload is guarded in a subquery**, the shape the two
   * walk statements take, and a torn row is NOT a candidate: the newest READABLE ask answers.
   *
   * 🔴 **676 · F3 — and the torn rows it passed over are COUNTED** — {@link selectTornAsksAfter},
   * on the card since `676` ({@link AgentCard.rowsUnread}). ⛔ `671` left them uncounted because a
   * card carried no count; ⚑ `ordinal` is selected so the count can start where this answer is.
   *
   * Both of its types are fold types, so it and the count below read `events_fold_idx`, which holds
   * a fraction of the ledger: with no ask in it, the conversation's index would walk every row.
   */
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
  /**
   * 🔴 **676 · F3 — the torn rows {@link selectLastAskToStop} passed over on its way to its answer**:
   * every row of its two types in the active generation, AFTER the ask it found (after nothing
   * when it found none), whose payload is not JSON.
   *
   * ⛔ **Only after the answer**, because those are the rows that read met: it walks from the
   * newest down and stops at the first readable ask, so a torn row older than that ask was never a
   * row it could have answered with. ⚠️ **A torn `user_decision` is counted though it may have been
   * an `allow`** — a torn row cannot say which outcome it carried, and that is what the count is
   * for: *this answer may be older than the truth.*
   */
  const selectTornAsksAfter = db.prepare(
    `SELECT ordinal
       FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND ordinal > ?
        AND type IN ('work_interrupted', 'user_decision')
        AND NOT json_valid(payload)`,
  )
  theFoldIndexHolds(selectLastAskToStop)
  theFoldIndexHolds(selectTornAsksAfter)
  /**
   * 🔴 **Which conversations have routed a request to THIS one** (394) — the parent's side.
   *
   * ⛔ **The other party is a field on the asker's row rather than a second row in the parent's
   * ledger**, so this is a predicate over the payload and never a query for a copy. ⚑ **`type =
   * 'request_routed'` is written out** even though `$.parent` alone would find it, because that is
   * what lets SQLite answer from `events_request_routed_idx` — a partial index is only usable by a
   * query whose WHERE implies the partial condition.
   *
   * ⚠️ **It finds routings to a PERSON as well as to the parent**, and that is deliberate rather
   * than sloppy: `394` §2 forbids a gate that makes the evidence unaskable, so the answer door's
   * scope has to contain the requests it will refuse. See `question-rails.ts`.
   */
  /*
   * 🔴 **676 · the routing scan's payload is GUARDED** (measured: one `request_routed` whose payload
   * was not JSON, in ANY conversation, made every agent's `list_questions` and `answer_question`
   * RAISE — this statement evaluates `$.parent` on every routing row in the database). ⚑ The `CASE`
   * in the subquery is the only form that guarantees evaluation order; a torn row in its ledger's
   * ACTIVE generation comes back with `unreadAt` set, for every parent, because a torn row cannot
   * say whose it was — {@link SessionStore.questionsRoutedTo} warns and counts it.
   */
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
  // Both halves of a held message use the event-kind index, paired in code: matching
  // each held message against every ending in SQL was quadratic in the conversation's ledger.
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
  // The conversations the launch sweep looks in, and one pass over each one's held messages, their
  // endings and its starts, through `events_fold_idx` (see `strandedMessages`). Every events row
  // belongs to a conversation row (foreign keys are on), so walking the conversations reaches them all.
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

  /**
   * The messages a crash left held, for the launch sweep to end, and the queue rows too torn to
   * read, for it to warn about — each in the order the rows were written.
   *
   * A held message is a named `message_queued` in a conversation's active generation with no
   * ending, in a conversation whose last life did not end (`ended` or `errored`: every stop writes
   * its ending after handing on what it held). An ending names its message by id; a torn ending
   * ends every message held before it, since it cannot say which. A message held while nothing
   * ran (`forItsNextStart`) waits for that start, so it counts only once a `launched` row follows
   * it. A torn `message_queued` has no id to end, and is left as it is.
   *
   * One pass over each conversation's own rows, paired in code: a correlated subquery per held
   * message walked the whole ledger again for each one.
   */
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
  // The one output file a workflow reported (108). Narrow on purpose: the alternative is
  // `events()`, which decodes every row of a session that may hold a hundred thousand of them, to
  // find one string. `json_extract` reads the persisted payload rather than a column, so no schema
  // change is needed for a fact only this query asks about.
  //
  // ⚠️ **LAST wins.** Both endings can carry an `output_file` (029's deliberate redundancy, which
  // 108 inherited), so a run can report one twice; the later row is the later truth. ⚑ The last
  // READABLE row since `697` — a torn one newer than it is counted, never taken as an answer.
  /*
   * 🔴 **697 · `676` §5 — the four reads below guard their payload, as `671`/`676` guarded the rest.**
   * ⛔ Each read `json_extract`/`json_each` over `events.payload` bare, so ONE torn `workflow_run` or
   * `sub_agent` row in a conversation made that conversation's own workflow and sub-agent doors
   * RAISE (`SqliteError: malformed JSON`) — every click, and every two seconds while a viewer
   * followed. ⚑ The same `CASE`: a torn row reads as `'{}'`, which names no task, no agent and no
   * output, so it is never an answer.
   *
   * ⚑ **And each read COUNTS what it passed over in the same walk** — a torn row comes back as a
   * candidate (`readable = 0`) beside the rows that match, and the reader stops at the first readable
   * answer: the index walks `ordinal` backwards (`EXPLAIN QUERY PLAN`: `SEARCH events USING INDEX
   * events_session_ordinal_uq`, no temp B-tree), so the torn rows met on the way are exactly the ones
   * newer than the answer, and a hit stops the walk where `LIMIT 1` used to. ⛔ A second statement
   * for the count doubled the walk on the child viewer's two-second follow (`697`'s review).
   * ⚠️ The column is `body`, not `payload`, and each subquery has its own alias — a byte-copy of
   * `671`'s shape would darken the rows anchored on it (`671` M10/M11/M22).
   */
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
  /**
   * Which run an agent belongs to (112) — the child-transcript door's allowlist.
   *
   * `json_each` over the run's own `agents[]`, because the agent ids are inside the payload and
   * there is no column for them. ⚠️ **`type = 'workflow_run'` is not decoration**: it keeps the
   * JSON expansion to the handful of workflow rows in a session that may hold a hundred thousand
   * events. Measured on the largest session on this machine — 181,791 events — the whole lookup
   * takes 50 ms, and it runs once per click.
   *
   * LAST wins, on the same reasoning as `selectWorkflowOutput`: a run reports its agents many times
   * over its life and the later row is the later truth — the last READABLE one since `697`.
   */
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
  /**
   * Every agent id one run has reported, in the order it first announced them (112).
   *
   * Use `DISTINCT` because each workflow frame repeats its whole roster. Order agents by the ordinal at which each id first appeared, matching the tree, and narrow by `type` as in the lookup above.
   */
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
  /**
   * Whether this session's own ledger ever reported that sub-agent (115) — the OTHER half of the
   * child door's allowlist.
   *
   * Plain `Task` dispatches and Codex child threads are announced by `sub_agent` events rather than workflow rosters. Permit lookup only for an agent whose event this session persisted.
   *
   * ⚠️ **`type = 'sub_agent'` is the narrowing, exactly as above.** A `json_extract` over every row
   * of a session that may hold a hundred thousand events is not a lookup anyone should do per click;
   * confined to the handful of `sub_agent` rows it is nothing. It also closes the door a wider
   * predicate would open — any other event that happened to carry an `agentId` field would
   * otherwise become a way in.
   *
   * `LIMIT 1`: a sub-agent reports `started`, `progress` and `ended` under one id, and the question
   * is whether it was ever reported at all, not how often.
   */
  const selectSubAgentReported = db.prepare(
    `SELECT reported.readable AS readable, reported.ordinal AS ordinal
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'sub_agent') reported
      WHERE NOT reported.readable OR json_extract(reported.body, '$.agentId') = ?`,
  )
  /**
   * ⚑ **697 · the torn `workflow_run` rows a ROSTER read met** — every one of them, since any may
   * have announced one more agent of the run. The roster read groups, so its count is its own walk;
   * it runs once per click (a journal or a script is never followed). ⚠️ A count and never a cause.
   */
  const selectTornRuns = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'workflow_run'
        AND NOT json_valid(payload)`,
  )
  /**
   * ⚑ **One walk that answers and counts** — the first READABLE candidate is the answer, and every
   * torn one met before it is noted. Iterated rather than `.all()`, so a hit ends the walk there.
   */
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
  // Windowed by ORDINAL rather than by OFFSET: the unique index on (session_id, ordinal) makes the
  // start a seek, where `LIMIT ? OFFSET ?` would walk every row before it.
  const selectEventWindow = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?`,
  )
  // ⚑ **F093** — the newest row of one type: `newestOfType`. ⚠️ A partial index serves only a WHERE
  // that names its own term word for word, so `launched` has its own statement, through
  // `events_fold_idx`; `tool_inventory` asks `selectToolsInForce`, below, from past the end.
  const selectNewestLaunched = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'launched'
        AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  // ⚑ **W4.179** — what a Codex thread holds of this conversation's text (`threadLeadRows`). ⚠️ One
  // pass over the conversation's rows, made at a Codex life's start and by the per-message read; the
  // JSON is opened only on the rows of its five types, ⛔ and only where it is valid.
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
  // ⚑ **W4.203** — with a floor (`ordinal >= ?`), so the seek back is a bounded range.
  const selectNewestOfType = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND type = ? AND ordinal >= ? AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  // A window bounded at BOTH ends — paging backwards needs the upper bound, since `before` is where
  // the page we already hold begins.
  const selectEventRange = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ? ORDER BY ordinal`,
  )
  /**
   * Where the Nth-from-last turn begins, in ordinal space (054).
   *
   * A turn's first event is its `user_turn` — `appendTx` inserts the turn row and then writes that
   * event into it, so the two cannot disagree. Read off `events` rather than joined to `turn` on
   * purpose: it takes no join, it works for a session recorded before 045 had a turn table at all,
   * and it walks the SAME index the page itself is read from.
   *
   * Walks backwards under `LIMIT`, so SQLite stops as soon as it has enough boundaries — the rows
   * it scans are the rows of the page being asked for, not of the session.
   */
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
  /**
   * 🔴 **D-035 · the tool inventory in force where a page begins** — the newest `tool_inventory`
   * row below it ({@link LedgerWindow.toolsInForce}).
   *
   * ⚑ **Read through `events_inventory_idx`**, one seek however far behind the page the row is: a
   * provider states its inventory once per start, so the row is usually a whole life back, and a
   * conversation that has none would otherwise be walked to its start on every page. ⛔ The term is
   * the index's own, word for word, or SQLite cannot read through it.
   */
  const selectToolsInForce = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_inventory_idx
      WHERE type = 'tool_inventory' AND session_id = ? AND generation = ? AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  // EXISTS, not count(*): the question is "any at all", and a session with thousands of events
  // should not have them all counted to answer it.
  const selectAnyEvent = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?) AS present`,
  )
  const selectMaxOrdinal = db.prepare(
    `SELECT max(ordinal) AS max_ordinal FROM events WHERE session_id = ? AND generation = ?`,
  )

  // --- the derived-generation contract (065, from 061 finding 6) ---
  const selectGeneration = db.prepare(
    `SELECT active, normalizer_version, derived_through, building, highest, failure
       FROM derived_generation WHERE session_id = ?`,
  )
  /**
   * Open a build, on a generation number that has never been used before.
   *
   * UPSERT rather than insert-or-update in the caller, so a session deriving for the FIRST time (no
   * row) and one being rebuilt (a row) take the same path — and `active` is left alone on conflict,
   * because opening a build must never move what is being read.
   *
   * ⚠️ **`highest + 1`, never `active + 1`.** Reusing a number would mean deleting whatever a failed
   * or cancelled build left at it *before* this one could write, and on the measured corpus that is
   * millions of rows in one synchronous transaction — precisely the unbounded step this task exists
   * to retire. SQLite evaluates every `SET` expression against the OLD row, so both references below
   * mean the same value.
   */
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
  /**
   * Every marker a dead process left. See {@link SessionStore.clearOrphanBuilds} for why doing this
   * at launch is safe and doing it at any other moment would not be.
   *
   * No `failure` is written: the app going away is not a fault, and a session that showed a red
   * state because the machine was rebooted would send someone looking for a bug that is not there.
   */
  const clearBuilding = db.prepare(
    `UPDATE derived_generation SET building = NULL, updated_at = ? WHERE building IS NOT NULL
       AND session_id = ?`,
  )
  /**
   * Which sessions carry a marker, read before any of them is cleared (198).
   *
   * ⚠️ **A select-then-update and not one statement with a `NOT IN`**, because the exclusion list is
   * a JavaScript set of unbounded length and the alternative is building SQL by string. The two
   * statements run inside {@link clearOrphanBuildsTx}, so nothing can open a marker between them.
   */
  const selectBuildingSessions = db.prepare(
    `SELECT session_id FROM derived_generation WHERE building IS NOT NULL`,
  )
  /**
   * The whole sweep in one transaction — see {@link SessionStore.clearOrphanBuilds}.
   *
   * One transaction rather than per-marker for the same reason {@link settleOrphanRunsTx} gives: a
   * crash partway through startup repair would leave some markers cleared and some not, and the next
   * launch would have to tell those apart, which is this problem again one level up.
   */
  const clearOrphanBuildsTx = db.transaction((at: number, running: ReadonlySet<string>): number => {
    const rows = selectBuildingSessions.all() as { session_id: string }[]
    let cleared = 0
    for (const row of rows) {
      if (running.has(row.session_id)) continue
      cleared += clearBuilding.run(at, row.session_id).changes
    }
    return cleared
  })
  // `rowid IN (… LIMIT ?)` is what makes the delete BOUNDED: SQLite has no `DELETE … LIMIT` without
  // a compile flag, and an unbounded delete over a 1.53 GB conversation is the same one-big-
  // transaction 061 said had expired.
  const deleteEventGeneration = db.prepare(
    `DELETE FROM events WHERE rowid IN
       (SELECT rowid FROM events WHERE session_id = ? AND generation = ? LIMIT ?)`,
  )
  const deleteTurnGeneration = db.prepare(
    `DELETE FROM turn WHERE rowid IN
       (SELECT rowid FROM turn WHERE session_id = ? AND generation = ? LIMIT ?)`,
  )
  /**
   * A finished projection, stated outright — the bundle path, which builds nothing.
   *
   * `active` and `highest` are both 0: a bundle's ledger arrived whole and no generation was ever
   * handed out for it, so the next rebuild takes 1 like any first build would.
   */
  const writeGeneration = db.prepare(
    `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
     VALUES (?, 0, ?, ?, NULL, 0, NULL, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       normalizer_version = excluded.normalizer_version,
       derived_through = excluded.derived_through, building = NULL, failure = NULL,
       updated_at = excluded.updated_at`,
  )

  /**
   * The ledger row, the TURN it belongs to, and the state it implies — atomically (045).
   *
   * Every event reaches here: live, replayed, and imported. That is why turn bookkeeping lives in
   * this transaction rather than in the host — the ledger and the turn table are written together
   * or not at all, so they cannot disagree, and an imported session grows turns for free.
   */
  const appendTx = db.transaction(
    (
      sessionId: string,
      ordinal: number,
      incoming: TranscriptEvent,
      at: number,
      generation: number,
      /**
       * Whether this write is to the projection being READ (065).
       *
       * False for a rebuild, and it governs exactly one thing: the durable `status` column. That
       * column describes the conversation the app is showing, and a rebuild is not showing one yet —
       * so reconciling it here would let a half-built projection move a live session's status and
       * then leave it there if the build failed. {@link promoteGeneration} reconciles it in the same
       * transaction as the flip, which is the only moment it is true of anything.
       */
      reconcileStatus: boolean,
    ) => {
      // The store is a DOOR, not a pipe (052 review). `wrapUnknown` bounds a payload as the
      // adapters build it, but that is only the live stream's entrance — `importBundle` appends a
      // ledger straight from a file, and a session recorded BEFORE the bound existed has full-size
      // rows on disk already. Bounding on the way in and on the way out means the database can
      // neither accept nor hand back a payload the rest of the app has agreed not to hold.
      // Idempotent, so an event that arrived through `wrapUnknown` is unchanged here.
      const event = boundStoredEvent(incoming)
      if (A_FOLD_READS_IT.has(event.type)) forgetTheKeptFoldsOf(sessionId, ordinal)
      // OPEN, before the event is written, so the `user_turn` itself carries the turn it starts.
      // 🔴 **F080 — and so does a `provider_turn`**: a turn the provider began by itself (a wake
      // after a background task ended) is a turn, with no prompt; its `turn` row closes it.
      // ⚑ **F080 — a reopen ends whatever turn the life before left open**, as the host does at the
      // reopen itself (`closeOpenTurn`, `unknown`), so a ledger replayed through here never lets a
      // message after the reopen join a row a crash left open. Live, nothing is open by then.
      if (event.type === 'reopened') {
        const left = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
        if (left) closeTurn.run(at, 'unknown', left.id)
      }
      const already = (
        event.type === 'user_turn' || event.type === 'provider_turn'
          ? selectOpenTurn.get(sessionId, generation)
          : undefined
      ) as OpenTurnRow | undefined
      // 🔴 **F080 — a message that joins a turn its provider started is that turn's**: the CLI
      // folds it into the loop it is running, and that loop's ending closes the one row
      // (`SessionMachine.beginTurn`). ⚑ The host writes `user_turn` once the provider has the
      // message, so a provider's turn still open here is the one it joined.
      // ⚠️ Only a row no message has joined yet: a second `user_turn` is a turn of its own.
      const joinsTheProvidersTurn =
        event.type === 'user_turn' &&
        already !== undefined &&
        selectAProviderTurnsOpening.get(already.id) !== undefined &&
        selectTheTurnsOpening.get(already.id) === undefined
      if (
        (event.type === 'user_turn' || event.type === 'provider_turn') &&
        !joinsTheProvidersTurn
      ) {
        // A turn still open when the next one begins is one whose ending we never saw — an imported
        // ledger with back-to-back prompts, or a provider that re-prompted. Closed as `unknown`
        // rather than left open: every lookup takes the NEWEST open turn, so an orphan behind it
        // would be unreachable by any store API and would hold the session at `working` for good.
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

      // ⛔ **A `conversation_reset` writes the ref for exactly the same reason a `session` does**
      // (199, from 192 H5): this column is what `resumeSession` reopens from, and after a `/clear`
      // the conversation it must reopen is the new one. Written here rather than by the host so the
      // ledger and the row cannot disagree — an imported bundle carrying a reset moves the ref too,
      // and a rebuild replays to the same answer.
      //
      // ⚠️ **Deliberately NOT a turn boundary.** A reset clears the provider's context; it does not
      // end a turn, so nothing below this line fires for it. A turn open across a reset still ends
      // on its own `turn` event, which is the only thing that knows how it ended.
      if (event.type === 'session' || event.type === 'conversation_reset') {
        updateRef.run(serializeSessionRef(event.ref), at, sessionId)
      }

      // CLOSE. The `turn` event is the turn's ending — the provider's own word, or, marked
      // `wordOf: 'this-app'` on the event row (720, R71), this app's; a session going terminal while a turn
      // is open is an ending too, and it is a different one — `ended`, not `completed`.
      if (event.type === 'turn' && open) closeTurn.run(at, event.state, open.id)
      if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
        if (open) closeTurn.run(at, 'ended', open.id)
      }
      // BLOCKED. ⚠️ **The adapters used to emit `waiting_permission`/`working` around their own
      // awaits, bypassing the session machine entirely (042) — and 122 is the commit that stopped
      // them.** The count now lives in `SessionMachine` and every `status` comes from one derivation.
      // This write survives it and is still the right shape: `blocked_at` is what makes the column
      // able to say WHICH silence a turn is in, and it is recorded from the event rather than
      // re-derived, so the column and the stream cannot come to two opinions.
      //
      // ⛔ **It only fires for a card raised INSIDE a turn, and that is now a reachable gap.** ⚑ Since
      // F080 a burst the provider started is a turn with its own row, so a card raised in one is
      // inside a turn. A question asked with no turn and no burst open — the 122 shape — has no row
      // to write to, so the stream says `waiting_permission` and this column says `idle`. Giving it
      // one would mean inventing a turn nobody started (045's rule); recording it on the SESSION is
      // a schema change and a different dispatch.
      if (event.type === 'status' && open) {
        if (event.state === 'waiting_permission') setTurnBlocked.run(at, open.id)
        if (event.state === 'working') setTurnBlocked.run(null, open.id)
      }

      // RECONCILED ON EVERY EVENT, not only on the ones that happen to be about status.
      //
      // Deriving only from `status` events left a window the review found: a `turn` event closes the
      // row but is not itself a status event, so between it and the machine's following `idle` the
      // column still said `working` — and if that `idle` were ever lost, permanently. Recomputing
      // here means the column cannot drift from the turn table at all, which is the whole point of
      // having one source of truth rather than two.
      if (reconcileStatus)
        updateStatus.run(currentStatus(sessionId, event, generation), at, sessionId)
    },
  )

  /**
   * A run of entries, one commit (046). It DELEGATES to `appendTx` rather than reimplementing it —
   * better-sqlite3 nests a transaction as a savepoint, so every rule above still runs per event and
   * there is no second version of the turn bookkeeping to keep in step. All that changes is how
   * often the write is committed.
   */
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

  /**
   * The events that are the CONVERSATION, as opposed to lifecycle bookkeeping (045).
   *
   * Exactly the set 042's handover invariant names: *no content event may follow a turn terminal
   * before the next `user_turn`*. Only these are attributed to a closed turn when one arrives late;
   * a `session`/`status`/`turn` row legitimately sits outside any turn and is left null.
   */
  const CONTENT_EVENTS = new Set([
    'assistant_message',
    'assistant_delta',
    'tool_call',
    'tool_result',
    'thinking',
    'sub_agent',
    'plan_update',
    // ⚠️ **A generated image is content — the most literal kind** (067). It is the thing the turn
    // produced. Added here rather than left out because this Set is a plain lookup and NOT
    // exhaustiveness-checked: a new event type omitted from it is attributed to no turn at all, and
    // nothing anywhere fails. That is how a picture would have gone missing from 042's late-content
    // query while every test stayed green.
    'image',
    // ⚠️ **A file change is content, and this Set is where 096 would otherwise have gone wrong** —
    // the comment above says how: it is a plain lookup with no exhaustiveness check, so an omitted
    // type is attributed to no turn and nothing fails. It belongs here for the same reason `image`
    // does: it is what the turn PRODUCED. And it is the type most likely to arrive late — Codex
    // sends `turn/diff/updated` three to five times per turn and the last one lands on the boundary,
    // so without this the files a turn changed would be exactly the rows 042's late-content query
    // cannot see.
    'file_change',
    // ⚠️ **A memory note is content, and it is the type that lands LATEST of all** (318). It is
    // published from the `idle` status — the turn boundary itself — so a turn that ends before its
    // note is written down would have the one row a person went looking for attributed to no turn at
    // all. The same silent-omission hazard the two comments above describe, in the one case where
    // the event is emitted from the boundary rather than merely arriving near it.
    'memory_note',
    // ⚠️ **`memory_loaded` is deliberately NOT here** (332), written down for the reason the
    // paragraph below gives about `user_command`: an omission from this Set is silent, so it has to
    // be stated or it is indistinguishable from the mistake the three comments above describe.
    // ⛔ It is published at ordinal 0, before the pump and before any turn of this session exists —
    // so there is no turn it could belong to, and `turnFor` finding none is the right answer rather
    // than a gap. ⚑ It is also not something a turn PRODUCED, which is the test this Set applies:
    // it is a fact about how the conversation opened.
    // ⚠️ **`user_command` is deliberately NOT here** (097), and given the warning above that an
    // omission from this Set is silent, the absence has to be written down or it is indistinguishable
    // from the mistake. A gesture is not something the turn produced — it is something a person did
    // to the conversation. Pressing Stop DURING a turn still lands on that turn, because `turnFor`
    // stamps the open turn whatever the type is; what this omission decides is the other case, where
    // a model is changed between turns and belongs to neither. Attributing that to the turn that has
    // just finished would put a decision made after it inside its record.
  ])

  /**
   * Which turn an event belongs to. The open one, or — for content with no turn open — the most
   * recently closed one, which is what makes 042's anomaly a JOIN instead of an invisible ordering.
   *
   * Stamping a closed turn is not silent re-parenting: `turn.closed_at` is right there, so
   * `created_at > closed_at` says "this arrived after it ended" in the data itself.
   */
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

  /**
   * The generation this session's reads are scoped to — 0 for everything that has never been
   * derived, which is every live session and every row written before 065.
   */
  function activeGeneration(sessionId: string): number {
    return (selectGeneration.get(sessionId) as GenerationRow | undefined)?.active ?? 0
  }

  /** One ledger's kept fold: the generation and newest fold row it was read at, and its answer. */
  interface KeptFold<T> {
    readonly generation: number
    readonly newest: number | null
    readonly answer: T
  }
  /**
   * A kept fold's answer with the rows written since it was kept, every one above `after`, or
   * `null` where only a whole fold can say. It answers only when it read every one of those rows.
   */
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
    /**
     * The rows read that the fold acts on, in the ledger's order; `null` past
     * {@link ROUTED_ENTRIES_KEPT_AT_MOST}, when only a whole fold reads it again.
     */
    readonly entries: readonly PersistedEvent[] | null
  }
  // How many rows a routed fold keeps to be carried forward; a ledger with more is folded whole.
  const ROUTED_ENTRIES_KEPT_AT_MOST = 1024

  // The fold row this store is writing now, which its own watch passes over: the writer has
  // already forgotten what that row changes.
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
  // A fold row written on this connection, by anyone: unless this store is inserting it itself,
  // what is kept of its conversation is forgotten. ⛔ Never throws: it runs inside the write, and a
  // throw would fail it.
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
  /**
   * Whether a fold may be kept or answered from what is kept: never inside a transaction, whose
   * rows may yet roll back, and only while every write of a fold row that this store did not make
   * reaches it — on its connection through {@link watchFoldWrites}, and from another connection
   * through `data_version`, which forgets everything kept. A connection that cannot hold the watch
   * keeps nothing, and one whose watch was taken away forgets everything and puts it back. Every
   * cache of what a fold read answers through this: the kept folds, the names, the fold floors.
   */
  function theFoldsMayBeKept(): boolean {
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
  // Put in place as the store is made where it can be, before anything reads: a temp trigger added
  // later changes the temp schema under a window read's writer stamp, which then reads again.
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

  /**
   * One ledger's fold, kept until a row it can read is added to that ledger or the ledger is
   * rebuilt. Rows are only ever appended above the newest one, so an unchanged newest fold row and
   * generation mean an unchanged answer, whatever else the conversation writes meanwhile. The
   * person's look asks these folds of every conversation every few seconds; most have not changed.
   *
   * Only a fold that read every row is kept, and only when a counted reader saw that it did: an
   * uncounted reader is not told of a row it skipped. Nothing is kept inside a transaction, and a
   * write of a fold row this store did not make forgets that conversation's kept folds
   * ({@link theFoldsMayBeKept}). Callers must treat what they get as read-only.
   *
   * A fold that can be carried forward reads only the rows written above the newest it kept, so a
   * row it never acts on (an agent's `status`, mostly) costs a short read instead of a whole fold.
   */
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
      const answer = fold(sessionId, (ordinal) => {
        readEveryRow = false
        noteSkip(ordinal)
      })
      if (readEveryRow && !db.inTransaction) keep(sessionId, { generation, newest, answer })
      return answer
    }
  }

  // Every kept fold, so a write through this store below a kept fold's newest row forgets that
  // conversation's at once. A row appended above it is one the newest row, and so the next read,
  // already notices.
  const keptFolds: Map<string, KeptFold<unknown>>[] = []
  // Each kept fold's read that answers only from what is kept ({@link theKeptOnly}).
  const onlyIfKept = new Map<unknown, (sessionId: string) => { readonly answer: unknown } | null>()
  /**
   * A kept fold's answer for one ledger, or `null` where none is kept or a row the fold reads was
   * written since. ⛔ It never makes the fold: for a reader that must not wait on one.
   */
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
  // How many conversations' folds are kept, per fold. Kept pieces carry their briefs, so the cap
  // bounds the memory; it is well above the conversations a person's look walks.
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

  /**
   * 🔴 **One conversation's ledger, folded into the pieces it OWNS** (379, as tasks; D-016).
   *
   * ⚑ **A local function and not a method, because several readers share it** — one derivation, so
   * two surfaces can never come to two opinions about the same piece. ⛔ Scoped to the ACTIVE
   * generation: a superseded projection's rows are garbage, not history (`events.generation`).
   * ⛔ **Never a root** (D-016 · R1): a root has no `work_given`, so the fold opens no row for it.
   */
  function foldPiecesOfSession(
    owner: string,
    /**
     * ⚑ **467 · handed in by a COUNTED reader** — the walks (`walkLedgers`' own note), the giver's
     * folds since `671` (`piecesGivenBySession`), and `piecesOwnedBy`'s counted door. ⛔ A caller
     * with nowhere to put the count skips an unreadable row with a warning.
     */
    noteSkip?: SkipNote,
    trackChanges = false,
    /** ⚑ Only the rows before this ordinal: the pieces as they stood then. */
    before?: number,
  ): readonly PieceRow[] {
    const generation = activeGeneration(owner)
    // 🔴 **D-013 · does its provider wake it when its background work ends?** — `backgroundWake`,
    // the provider's own declaration; a session with no row reads `false` (nothing wakes it).
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
      const rows = selectPieceEvents.all(owner, generation, floor) as EventRow[]
      const stalled = new Map<string, number>()
      const pieces = derivePieces(
        owner,
        toPersistedEvents(
          before === undefined ? rows : rows.filter((row) => row.ordinal < before),
          skipped,
        ),
        {
          backgroundWakesIt,
          trackChanges,
          onStall: (piece, ordinal) => stalled.set(piece, ordinal),
          // ⚑ **F076** — whose login a refusal names.
          ...(provider !== undefined &&
          (SUPPORTED_PROVIDERS as readonly string[]).includes(provider)
            ? { provider: provider as Provider }
            : {}),
        },
      )
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

  /**
   * ⚑ **D-016 · commit 6 · where each owner's fold starts, once found** — see
   * {@link pieceFoldFloor}. ⛔ **Valid for one generation**: every row below a first `work_given`
   * is already written — a ledger is only appended to, and a rebuilt projection is a new
   * generation — so the walk back, which may cross the whole ledger, is paid once per conversation.
   */
  const pieceFoldFloors = new Map<string, { readonly generation: number; readonly floor: number }>()

  /**
   * ⚑ **D-016 · commit 7 · R2 — what names a conversation that owns no root, once folded** — see
   * {@link SessionStore.workThatNames}. ⛔ **Valid while its ledger has not grown**: every piece row
   * is written with its `work_given`, and every later line about it is a row in the same ledger, so
   * the newest ordinal moving is the only way the answer can change; a rebuilt projection is a new
   * generation. ⚠️ A fold that could not read every row is never remembered, so it is noted each
   * time it is read.
   *
   * ⚑ **F033 · its pieces, as much of each as a name reads** — what is open, what ended last and
   * how ({@link theWorkThatNamesItAmong}) — ⚑ F009 · and an agent's record (who gave each, when,
   * its outcome: {@link SessionStore.newestPiecesHeldIn}) — and never a brief.
   */
  const namedByAPiece = new Map<
    string,
    {
      readonly generation: number
      readonly through: number | null
      readonly pieces: readonly PieceForAName[]
      readonly waiting: PieceRow | null
    }
  >()

  /**
   * ⚑ **F033 · one conversation's pieces, in the order they were given, as {@link namedByAPiece}
   * keeps them** — read once per ledger growth.
   */
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
    // ⛔ **Every row read, or not remembered** — and a fold that throws is skipped, warned: a name
    // is never a door (D-017 · R8).
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

  /**
   * ⚑ **A root names the conversation that owns it, in every sentence** — its label and newest
   * title — or `null`: it owns none. ⚑ Read every time: two probes, and a root is written with its
   * conversation's row — before that ledger's first row, so a memo keyed on the ledger could keep a
   * `null` from before it.
   */
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

  /**
   * 🔴 **F033 · what names a conversation now** — {@link SessionStore.workThatNames}: its root, else
   * {@link theWorkThatNamesItAmong} the pieces it holds.
   */
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

  /**
   * 🔴 **Where one owner's fold starts — its first `work_given`, or earlier where the fold needs what
   * came before it** (D-016 · commit 6), or `null`: it was never given a piece, and nothing is read.
   *
   * ⚠️ **A root owner's first `work_given` lands mid-life** — work it took on (`take_on_work`) — and
   * a fold starting at it would not know what drove it or what ran in the background then: a wake
   * it was taken on in would never end, and work held for a command started earlier would read as
   * waiting on the person. ⚑ So the floor is the earliest of that row; the `user_turn` that opened
   * the turn it was written in, or the last turn before the wake it was written in — the fold then
   * sees that turn open and end, the ask that ended it, and every message queued since; and, where
   * the background wakes this conversation, the newest `background_work` and `scheduled_work` rows
   * before it that state a level, when that level is not empty. ⚑ A conversation a give started has
   * none of them: its ledger begins with its first brief.
   *
   * ⚠️ **What it drops, said**: a message queued before that turn opened that still waits — it
   * drives every open piece when it goes out, so work taken on meanwhile reads waiting on the person
   * until then — and a question routed before the floor, whose stranding then marks no piece: it
   * was asked before any of this work existed.
   */
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

  /**
   * 🔴 **The work one conversation gave out, walked ONCE and mapped twice** (543, from 508).
   *
   * ⛔ **Two readers, one derivation** — `169` §1's rule, and here the thing that must not be
   * written twice is a narrowing: the candidate query, the ledger fold, the `giver` filter and the
   * total order. ⚠️ **{@link SessionStore.workGivenOutBy} answers the Work tab's row and
   * {@link SessionStore.workThisOneGaveOut} the relationship panel's edge**, and the ONLY difference
   * between them is which shape a {@link PieceRow} is mapped into.
   *
   * ⚑ **The fold decides, not the row that found the ledger** — `piecesGivenBy`'s own rule, carried
   * here rather than restated at each caller: every row an owner's ledger produces is checked
   * against the giver.
   *
   * 🔴 **Ordered HERE and by a TOTAL order, because the candidate query has none.** `SELECT
   * DISTINCT` states no ordering, so the ledgers arrive in whatever order SQLite found them and a
   * list would reshuffle itself under a reader on every poll. ⛔ Not by a number: numbers are per
   * parent, so a giver holding two pieces gets two sequences interleaved into one column that goes
   * up and down. ⚑ `givenAt` is *the order the work was given*, and the piece id after it makes the
   * order total — two gives can share a millisecond.
   */
  function walkWorkGivenBy<Row extends { readonly givenAt: number; readonly piece: string }>(
    sessionId: string,
    map: (piece: PieceRow, candidate: GivenWorkRow) => Row,
  ): LedgerWalk<Row> {
    // 🔴 **671 · R18 — ONE set of unread rows for the whole walk**, the folds' and the wait reads'
    // alike — see {@link RowsUnread}.
    const unread = rowsUnreadOnce()
    const owners = selectOwnersGivenWorkBy.all(sessionId) as GivenWorkRow[]
    // ⚑ **603/609 · ONE wait read per owner, for this walk only** — {@link oneWaitReadPerHolder}.
    // ⛔ `walkLedgers` visits each candidate once, so the memo exists to stop the three narrow reads
    // being taken per PIECE rather than per conversation.
    const waiting = oneWaitReadPerHolder(unread)
    const walked = walkLedgers(
      'every-conversation-this-one-gave-work-to',
      owners,
      (owner, noteSkip, candidate) =>
        // 🔴 **603/609 · the COMPOSITION and never the raw fold** (HO-091 §1). ⛔ Both readers of
        // this walk report a piece's state to somebody — the Work tab's {@link WorkGivenOut} to a
        // PERSON and `WorkEdge` to the relationship panel — and a surface left on the raw fold would
        // be an exception made at one depth of a walk.
        composeWhatEachPieceIsWaitingOn(
          [...piecesOfSession(owner, noteSkip)].filter((piece) => piece.giver === sessionId),
          waiting,
        ).map((piece) => map(piece, candidate)),
      unread,
    )
    // ⛔ **Every field spelled out** — `a-spread-writes-past-a-declared-type`: a spread into an
    // object literal is checked for what it brings and not for what the literal owes, and the three
    // counts are the half of this answer a caller cannot recompute.
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

  /**
   * 🔴 **One conversation's ledger, folded into the pieces it has already been TOLD about** (404).
   *
   * ⛔ **A report STANDS unless the message carrying it was abandoned.** A notice `queueMessage` sent
   * left no `messageId` on the row and always stands; one it HELD named the held message, and a
   * quit or the next launch can still end that message `abandoned` — in which case the parent was
   * never told and the report must not silence the next push.
   *
   * ⚑ **A notice this app took back because a later fact made it false stands too** (D-016c): the
   * giver's own question or new brief told it (R69), and a take-back, a close or an answer leaves the
   * piece closed, which is owed nothing.
   *
   * ⚑ **Every receipt is a telling, whatever it says** — a ledger written before D-016c holds
   * receipts of stops (`conversation_ended`, some with `holderKeptOpen`), and corrections and wakes
   * (`WorkStallSetRightEvent`), and each told the giver about the piece. ⛔ **Once per piece**: `400`
   * ruled that a parent is not told again when the cause MOVES — *"a notice whose frequency tracked
   * how chatty a child is would not be a fact about the work"* — and since D-016c neither a stop nor a
   * start is told at all.
   */
  function foldStallsToldToSession(
    sessionId: string,
    /**
     * ⚑ **671 · R18 — handed in by the stalled-work walk**, the one reader whose answer a person's
     * queue is built from; the door `workReportedTo` passes none and skips a torn row with a warning.
     */
    noteSkip?: SkipNote,
  ): ReadonlySet<string> {
    const generation = activeGeneration(sessionId)
    const entries = toPersistedEvents(
      selectStallsTold.all(sessionId, generation, sessionId, generation) as EventRow[],
      noteSkip,
    )
    // 🔴 **D-017 · R8** — a counted read skips a ledger whose fold throws ({@link readOrSkip}).
    return readOrSkip(sessionId, noteSkip, new Set<string>(), () => toldIn(entries))
  }

  /** ⚑ **{@link stallsToldToSession}'s fold** — the pieces one ledger's entries told it about. */
  function toldIn(entries: readonly PersistedEvent[]): ReadonlySet<string> {
    // ⛔ **Both passes over ONE read, and the abandonment is collected first** because a report and
    // the ending of its message are ordered by the ledger and not by this loop.
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

  /**
   * 🔴 **One conversation's ledger, folded into the requests it raised** (394).
   *
   * ⚑ **A local function for {@link piecesOfSession}'s reason** — two readers, one derivation, so
   * `routedRequestsOf` and `questionsRoutedTo` can never come to two opinions about one request.
   * ⛔ Scoped to the ACTIVE generation: a superseded projection's rows are garbage, not history.
   */
  function foldRoutedRequestsOfSession(
    sessionId: string,
    /** ⚑ **453 · handed in by a counted reader** — the queue walks, and since `671` every wait read. */
    noteSkip?: SkipNote,
  ): RoutedRequestsKept {
    const generation = activeGeneration(sessionId)
    // 🔴 **D-017 · R8** — a counted read skips a ledger whose fold throws ({@link readOrSkip}).
    return readOrSkip(sessionId, noteSkip, { answer: [], floor: null, entries: [] }, () => {
      const entries = toPersistedEvents(
        selectRoutedRequestEvents.all({ session: sessionId, generation }) as EventRow[],
        noteSkip,
      )
      const answer = deriveRoutedRequests(
        sessionId,
        entries,
        // ⚑ A routing that is no well-formed routing is counted like a torn row.
        (ordinal) => noteUnreadRow(sessionId, ordinal, noteSkip, 'is not a well-formed routing'),
      )
      const opening = entries.filter(
        (entry) => entry.event.type === 'request_routed' || entry.event.type === 'question_asked',
      )
      const actedOn = entries.filter((entry) => aWaitIsReadFrom(entry.event))
      return {
        answer,
        floor: opening.length === 0 ? null : Math.min(...opening.map((entry) => entry.ordinal)),
        entries: actedOn.length > ROUTED_ENTRIES_KEPT_AT_MOST ? null : actedOn,
      }
    })
  }

  /**
   * {@link foldRoutedRequestsOfSession}'s answer with the rows written since it was kept: folded
   * again from the rows it acts on, which are few, instead of every row since the first routing.
   * ⚑ A ledger with no routing yet answers nothing until one is written, which only a whole fold
   * reads, with the launch before it.
   */
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

  /**
   * 🔴 **One conversation's ledger, folded into the WORDS of the questions it raised** (396,
   * extracted 603).
   *
   * ⚑ **A local function for {@link routedRequestsOfSession}'s reason** — two readers, one
   * derivation. ⛔ The door `questionsRaisedIn` is one; {@link walkWorkGivenBy}'s composition is
   * the other, and a second copy of this read is how the Work tab and `list_tasks` would come to
   * two opinions about which question names which work.
   */
  function foldQuestionsRaisedInSession(
    sessionId: string,
    /**
     * ⚑ **671 · handed in by a counted read** — a wait read inside a walk, or one of the host's
     * counted answers (`list_tasks`; since `676` the plates-and-rail read and `list_questions`). ⛔ Every other caller skips a torn row with a warning and no count. ⚠️ **Before
     * `671` a torn row here RAISED** — `json_extract` in the statement's SELECT list.
     */
    noteSkip?: SkipNote,
  ): ReadonlyMap<string, RaisedQuestion> {
    const rows = selectQuestionsRaised.all(
      sessionId,
      activeGeneration(sessionId),
    ) as RaisedQuestionRow[]
    // 🔴 **D-017 · R8** — a counted read skips a ledger whose fold throws ({@link readOrSkip}).
    return readOrSkip(sessionId, noteSkip, new Map<string, RaisedQuestion>(), () =>
      wordsIn(sessionId, rows, noteSkip),
    )
  }

  /**
   * The question a row raised, read whole, or `null` when the row is no well-formed question: an
   * id, a prompt and its questions as their writers write them, and every other field it carries of
   * the kind it is written as. ⛔ The one reader of a raised question's row, so a row a reader skips
   * is always a row it counts ({@link wordsIn}). ⚑ A field written only when it applies is read as
   * absent when it is absent, or JSON null.
   */
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
        // ⛔ **474 · `null` for a provider's row, and never `undefined`** — see
        // {@link RaisedQuestion.piece}. ⚠️ `json_extract` of a key that is not there is SQL
        // NULL, so the absence is the same value for a `user_input_request` and for a
        // `question_asked` this build cannot find the field on.
        piece: row.piece,
        // 🔴 **611 · the hop, and what the hop added** — see {@link QuestionAskedEvent.passedUpFrom}
        // and its `context`. ⛔ Read out of the row rather than composed, so a reader can check
        // *the original words travelled* against the row they were copied from.
        passedUpFrom: row.passedUpFrom,
        context: row.context,
        // ⛔ **602 · the WHERE clause above admits exactly two types**, so the ternary is
        // exhaustive over what this statement can return. ⚠️ Written as *is it the app's row*
        // rather than *is it the provider's*, because the app's is the one whose name this
        // file mints and the provider's is a whole family this app does not own.
        raisedBy: row.type === 'question_asked' ? 'this-app' : 'the-provider',
        ...(move === undefined ? {} : { move }),
        ...(anActionAsked(action) ? { action: { files: action.files } } : {}),
      }
    } catch {
      return null
    }
  }

  /** ⚑ **{@link questionsRaisedInSession}'s fold** — the words of each question in one ledger. */
  function wordsIn(
    sessionId: string,
    rows: readonly RaisedQuestionRow[],
    noteSkip: SkipNote | undefined,
  ): ReadonlyMap<string, RaisedQuestion> {
    const words = new Map<string, RaisedQuestion>()
    for (const row of rows) {
      // 🔴 **671 · R18 — a payload that is not JSON is COUNTED, then skipped** — see
      // `selectQuestionsRaised`. ⛔ It used to raise out of the statement itself, so nothing below
      // ever saw it.
      if (row.readable === 0) {
        noteUnreadRow(sessionId, row.ordinal, noteSkip)
        continue
      }
      // ⛔ **A row we cannot read as a question is SKIPPED and COUNTED, never repaired into a
      // shape** — `toPersistedEvents`' rule: a reader with a hole is honest, a reader with an
      // invented question is not. ⚑ Counted like a torn row, so a reader that must see every
      // question — the walk that ends the copies of a piece's questions — knows it did not.
      const question = aQuestionRaisedIn(row)
      if (question === null || row.id === null) {
        noteUnreadRow(sessionId, row.ordinal, noteSkip, 'is not a well-formed question')
        continue
      }
      words.set(row.id, question)
    }
    return words
  }

  /**
   * 🔴 **The pieces one conversation GAVE, folded** (393) — lifted out of
   * {@link SessionStore.piecesGivenBy} by `609` so the public reader and
   * {@link whatThisConversationIsWaitingOn} cannot come to two opinions about what this
   * conversation handed out.
   *
   * ⛔ **The fold decides, not the row that found the ledger**: every row an owner's fold produces
   * is checked against the giver before it is returned.
   *
   * ## ⚠️ What it costs, because `609` put it on a read that runs on a clock
   *
   * ⚑ **`work_given_by_idx` is the CHEAP GATE and it fires first.** A conversation that has never
   * given work owns no `work` row naming it as giver, so the answer is one indexed lookup and an
   * empty array — which is every worker, and the overwhelming majority of holders in the walk
   * {@link SessionStore.stalledWorkNobodyWasToldAbout} takes every five seconds.
   *
   * ⛔ **A conversation that HAS given work pays one ledger fold per owner.** ⚠️ There is no cheaper
   * honest answer: *is that work still open* is {@link TASK_IS_OPEN} over a FOLD, and a SQL
   * predicate that guessed at it would be *a second opinion about which states are over*.
   */
  function piecesGivenBySession(giver: string, unread?: RowsUnread): readonly PieceRow[] {
    return (selectOwnersGivenWorkBy.all(giver) as GivenWorkRow[])
      .flatMap((row) => [...piecesOfSession(row.id, unread?.in(row.id))])
      .filter((piece) => piece.giver === giver)
      .sort((left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1))
  }

  /**
   * ⛔ **Everything one conversation is waiting ON** (603 as one question, generalised by 609) —
   * the store's own reader of the three derivations, so the Work tab's rows carry the same composed
   * state `list_tasks` does.
   *
   * ⚑ **The SAME three reads `RuntimeHost.oneWaitReadPerAnswer` takes**, and that is the property a
   * census asserts rather than a coincidence: two layers, one set of sources, so a piece cannot read
   * one word in a window and another in a tool.
   *
   * ⚠️ **Memoised by the caller and not here**, because the answer moves the moment a question is
   * answered, a card is pressed or a child replies — that method's rule, one layer up.
   *
   * 🔴 **D-016 · waiting on a child is PER PIECE**: {@link WhatAConversationIsWaitingOn.childrenOpen}
   * holds each piece that has an OPEN piece given under it, so one piece's open child no longer
   * silences its siblings. ⛔ Read off the RAW fold of the pieces it gave — the hand-over fact —
   * and never the composition this feeds, which would compose inside its own source.
   */
  function whatThisConversationIsWaitingOn(
    sessionId: string,
    /**
     * 🔴 **671 · where the walk that asked writes down what these reads could not** (R18, `664`
     * F4) — see {@link RowsUnread}.
     */
    unread?: RowsUnread,
  ): WhatAConversationIsWaitingOn {
    const mine = unread?.in(sessionId)
    // ⛔ **ONE read of the routings, read twice** — the host's own memo takes it the same way.
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

  /**
   * ⚑ **664 · ONE {@link whatThisConversationIsWaitingOn} per HOLDER, for ONE answer** — the memo
   * {@link walkWorkGivenBy} and `stalledWorkNobodyWasToldAbout` each spelled inline, extracted when
   * two more readers needed it (`D32`).
   *
   * ⛔ **Why a memo at all:** {@link composeWhatEachPieceIsWaitingOn} asks its lookup once per OPEN
   * row, and every row it is asked about in one walk can share a holder — so an unmemoised lookup
   * takes the three narrow reads per PIECE. ⚠️ **Per answer and never per store**: the answer moves
   * the moment a question is answered, a card is pressed or a child replies, so a memo that
   * outlived the call would draw yesterday's state — `whatThisConversationIsWaitingOn`'s own rule.
   *
   * ⚑ **What each caller gains or loses by sharing it** (`extracting-a-shared-guard-exports-its-
   * policy`): the two that had it inline lose nothing — the same map, keyed by the same id, living
   * for the same one call. `workThisOneWasGiven` and `everyPlacedConversation` gain the bound they
   * had no need of while they read the raw fold.
   *
   * 🔴 **671 · and the walk's {@link RowsUnread} rides with it**, so what a wait read could not read
   * is counted by the walk that asked — ONCE, however many holders meet the same torn row. ⛔ Every
   * caller passes its own: a memo with no counter would be the silent read `664` F4 recorded.
   */
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

  /**
   * 🔴 **How the last ENDED turn stopped, who asked, and when** (395, 484) — `null` when there is
   * none.
   *
   * ⛔ **`null` and `nothing-has-said` are different answers and both are reachable.** A session
   * that has never closed a turn has nothing to report; one whose turn closed with no `turn` row in
   * its ledger — a sweep-written `unknown`, an imported projection — has an ending this app never
   * saw. ⚑ `222` §3's rule: say what was not seen, never what did not happen.
   *
   * ## 🔴 484 · the turn table is read FIRST now, and that is the ruling rather than a refactor
   *
   * ⛔ **The narrowing was always `closed_at IS NOT NULL` and the VALUE never carried it**, so a
   * parent holding this beside a live `state` had to decide for itself whether it was reading the
   * situation or its history — HO-031 §2.2's *"stale or describing an older turn, unclear which,
   * which is itself the defect"*. ⚑ `closed_at` is the field that makes the other reading
   * unrepresentable, and it comes off the same row the query narrows by, so the two cannot
   * disagree.
   *
   * ⚠️ **`since` is read from the OPEN turn and not computed from ordinals**: at most one turn is
   * open (`selectOpenTurn`'s own rule), and a later turn that had also ended would BE this turn.
   */
  function lastEndedTurnOf(
    sessionId: string,
    // ⚑ **676 · F3 — the card's count** ({@link RowsUnread}'s per-ledger note).
    noteSkip?: SkipNote,
  ): LastEndedTurn | null {
    const generation = activeGeneration(sessionId)
    // ⛔ **The turn, before its rows.** A reading with no closing time is the thing this function
    // stopped being allowed to return, so the row that carries one is what decides whether there is
    // an answer at all.
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
    // ⚠️ **No rows means the turn closed by something that appended no event** — `settleOrphanRuns`
    // and `terminate` both write `end_reason` and nothing to the ledger.
    const nothingHasSaid: StopReading = { how: 'nothing-has-said', who: null, asker: null }
    // 🔴 **D-017 · R8 — a fold that throws skips this ledger**, for a counted read: the turn did
    // close, and nothing this read could fold says how.
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

  /**
   * ⚑ **What opened the last turn that ended** — the message, or messages delivered together, its
   * `user_turn` row carries, words capped to a preview; `null` with no ended turn, or no such row in
   * it. ⚑ The row is the turn's own (`events.turn_id`), found by `events_turn_idx`.
   */
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

  /**
   * 🔴 **D-012 · one row's words, capped** — a torn row is `unreadable`, warned once, never a guess.
   */
  function wordsOf(sessionId: string, row: ExchangeRow): Words {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { unreadable: true }
    }
    // ⚠️ Cast to `unknown`-shaped and CHECKED — a ledger written by another build can hold anything.
    const said = JSON.parse(row.payload) as { text?: unknown }
    return capped(typeof said.text === 'string' ? said.text : '', WORDS_CAP)
  }

  /**
   * ⚑ **D-012 · what a received row delivered** — who sent it, off its own fields, and its words,
   * capped; 🔴 **D-027 · of several, the last, with the ones that came with it**
   * ({@link whatATurnDelivered}). ⛔ A torn row is `unreadable`, warned once, never a guess.
   */
  function receivedOn(sessionId: string, row: ExchangeRow, cap = WORDS_CAP): ReceivedInATurn {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { from: { is: 'unreadable' }, words: { unreadable: true } }
    }
    return whatATurnDelivered(JSON.parse(row.payload) as UserTurnEvent, cap)
  }

  /**
   * 🔴 **D-012 · the last exchange** — see {@link SessionStore.lastExchange}. ⚑ Two reads: the
   * newest message received, then the newest main-thread words after it. ⛔ Not narrowed to a
   * closed turn: *"the text back is replaced at every message, not only at the end of a turn"*.
   */
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

  /**
   * 🔴 **D-012 · the turns from one received message to the next** — every main-thread word said
   * back to it, joined, then capped (a turn's words, not each message's). ⚑ **F080** — or from a
   * turn its provider started by itself, with what ended just before it.
   */
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

  /** ⚑ **D-012 · rows from `from` (a received message) up to, not including, `until`.** */
  function turnRows(sessionId: string, generation: number, from: number, until: number) {
    return selectExchangeRowsBetween.all(sessionId, generation, from, until) as ExchangeRow[]
  }

  /**
   * 🔴 **D-012 · the transcript a giver reads** — see {@link SessionStore.transcript}. ⚑ Bounded by
   * `back` turns either way; a search folds case (ASCII) and matches a received message or the words
   * said back, and hands back the WHOLE turn each hit is in.
   */
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

  /**
   * 🔴 **The last ask to stop this conversation's work, whatever turn it landed on** (484,
   * HO-031 §2.1) — `null` when no row says.
   *
   * ⛔ **Not narrowed by turn, and that absence IS the function.** `turnFor` hands a
   * `work_interrupted` written with nothing running a `turn_id` of `null`, so the one gesture whose
   * author this app records is unreachable from every reader that joins on the turn — and the ledger
   * then held `{"by":"a-person"}` while `get_agent_status` answered `who: null`.
   *
   * ⚠️ **A row whose `by` this build has no word for is DROPPED rather than guessed at.** The
   * boundary is the ledger and not the wire (`isWhoDidIt`'s rule): payloads are `JSON.parse`d and
   * cast, so a word from a build whose vocabulary has moved reaches here as a string, and reporting
   * it as `a-person` is the confident sentence criterion 18 exists to prevent.
   */
  /**
   * 🔴 **The actor on either row `selectLastAskToStop` can return** (494) — `null` when none.
   *
   * ## ⛔ Two producers, two SHAPES, and neither is lifted into the other
   *
   * ⚠️ **`work_interrupted` states it FLAT** — `by` plus an `agent` that is *present if and only
   * if* the agent arm — and **`user_decision` states it as {@link ActedBy}, the union.** ⛔ The
   * tempting tidy-up is to lift the flat pair into the union and share one reader; it cannot be
   * done honestly, because a `work_interrupted` written before this app named the asker carries
   * `by: 'an-agent'` and NO id, and the union's agent arm requires one. ⚑ A lift would have to
   * invent an empty string, and `stoppedBy`'s *"'an agent' when the row carries no id"* — the
   * honest generalisation — would be replaced by a blank.
   *
   * ⚠️ **What IS shared is the second shape's rules**, through `whoCancelledIt`: one derivation for
   * the three readers that fold a cancel, so the card's two fields cannot come to two opinions
   * about one press.
   *
   * ## ⛔ `null` here ends the read, and it does not fall back to an older row
   *
   * ⚠️ **The statement takes the NEWEST ask of either kind and this decides whether it can be
   * named.** ⛔ So a cancel this app cannot name the author of makes the whole answer `null`, even
   * with an older `work_interrupted` standing behind it. ⚑ That is *the last ask wins* held to,
   * rather than abandoned the moment it is inconvenient: reaching past the newest row would report
   * an earlier actor as the one who last asked — which is the attribution `491` measured and this
   * dispatch's folds clear for the same reason.
   */
  function actorOfTheAsk(row: AskRow): Pick<AskToStop, 'by' | 'asker'> | null {
    const asked = JSON.parse(row.payload) as { by?: unknown; agent?: unknown }
    if (row.type === 'user_decision') return whoCancelledIt(asked.by as ActedBy | undefined)
    // ⚠️ **A row whose `by` this build has no word for is DROPPED rather than guessed at** — the
    // ledger boundary, `isWhoDidIt`'s rule, asked of the flat shape.
    //
    // ⛔ **501 · DERIVED, and it was a hand-written pair.** The test read
    // `asked.by !== 'a-person' && asked.by !== 'an-agent'` — the event's old two-member vocabulary
    // restated as literals in a second file. ⚠️ **It would not have gone red; it would have gone
    // QUIET**: the day the writer gained its third word this reader would have dropped every row
    // carrying it, and `AgentCard.lastAskToStop` would have said *nobody asked* about an ask this
    // app recorded — which is the absence {@link whoCancelledIt} exists to keep meaning one thing.
    // ⚑ That function asks membership this way one producer over, off the same derived list.
    //
    // ⚠️ **`readonly unknown[]` and not `readonly string[]`**, which is the one spelling
    // difference from that function: `by` is typed there and is `unknown` off a parsed payload
    // here, and a `typeof` line in front would be a line no mutation could ever make red.
    if (!(WHO_STOPPED_IT as readonly unknown[]).includes(asked.by)) return null
    const by = asked.by as WhoStoppedIt
    return {
      by,
      asker: by === 'an-agent' && typeof asked.agent === 'string' ? asked.agent : null,
    }
  }

  function lastAskToStopOf(
    sessionId: string,
    // ⚑ **676 · F3 — the card's count** ({@link RowsUnread}'s per-ledger note).
    noteSkip?: SkipNote,
  ): AskToStop | null {
    const generation = activeGeneration(sessionId)
    const row = selectLastAskToStop.get(sessionId, generation) as AskRow | undefined
    // 🔴 **676 · F3 — every torn row the read passed over, warned always and counted when asked** —
    // {@link selectTornAsksAfter}. ⚠️ Before the early return, because *no readable ask* is exactly
    // the answer a torn newest row can make false.
    for (const torn of selectTornAsksAfter.all(sessionId, generation, row?.ordinal ?? -1) as {
      ordinal: number
    }[]) {
      noteUnreadRow(sessionId, torn.ordinal, noteSkip)
    }
    if (row === undefined) return null
    // 🔴 **D-017 · R8** — a counted read skips a ledger whose fold throws ({@link readOrSkip}).
    const asked = readOrSkip(sessionId, noteSkip, null, () => actorOfTheAsk(row))
    if (asked === null) return null
    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    // ⛔ **Compared against the two turn ids rather than against a time**, so the answer is the same
    // fact the reader's other field is derived from. ⚑ `turn_id` is `null` for an ask nothing was
    // running for, and only then: an ask is no content, so `turnFor` names the turn open as it is
    // written or none. ⚑ A turn named and neither of those two ended with another after it.
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

  /**
   * ONE answer to "is this session busy" (045), replacing three that could disagree.
   *
   * Terminal is the machine's to declare and is taken as stated. Everything else is DERIVED from
   * the turn table, so the persisted column is a view of the turn rather than a peer of it:
   *
   *   open turn + blocked  → waiting_permission   (blocked on us — the third silence)
   *   open turn            → working
   *   no open turn         → idle                 (waiting for the user)
   *
   * `waiting_permission` survives because it is the only signal for "blocked on an answer". ⚠️ The
   * machine DOES learn about it now (122) — it owns the wait count and derives the same three
   * answers this function does — so the two are no longer independent opinions but two readings of
   * one fact.
   *
   * ## ⛔ 123 §3 · where the column and the stream part company, and why that stands
   *
   * They disagreed in exactly two states, and both had the same shape: **provider work with no turn
   * row to hang off.** A card raised outside a turn has nothing to carry `blocked_at`; a burst of
   * work nobody asked for had nothing at all. ⚑ **F080 — a burst now opens a turn row of its own**
   * (`provider_turn`), so this column says `working` through it, and a card raised in it has that
   * row. What remains is a card raised with no turn and no burst open: while the app is running,
   * the stream can say `waiting_permission` where this column says `idle`, and the Library's
   * filters (121) read this column.
   *
   * **Ruled: no schema change.**
   *
   * ⛔ **The first version of this comment gave a reason that is FALSE, and a reviewer measured it.**
   * It said the burst's end is *"structurally invisible in the record this column is derived from"*,
   * because `normalizeMessage` maps `case 'result': return []`. The premise is true and the
   * conclusion does not follow: 123 turns that frame into a `status` event, `status` events are
   * persisted like any other (686 rows in the live ledger), so BOTH edges of a burst are already
   * durable. A `currentStatus` that fell back to the last persisted `status` when no turn is open
   * was available without touching the schema at all.
   *
   * **The real reason is 045's own, and it is enough.** This column is a VIEW of the turn table —
   * one derivation, so that "whichever writer landed last" can never come back (042 measured three
   * of them). Reading a second source when the first says nothing is exactly a second derivation,
   * and the two would disagree in the ordinary case: the burst's `working` persists, the app is
   * killed before its `idle` does, and the row asserts live work forever. That is a row
   * {@link selectRunningSessions} then sweeps on the next launch — recoverable, but it is a busy
   * flag whose truth depends on the app surviving long enough to retract it, which is the property
   * 045 removed.
   *
   * **What it costs, stated rather than waved at.** ⚠️ *While the app runs*: the event stream says
   * `waiting_permission` where this column says `idle`. ⚠️ **The Library does not
   * show it** — `LibraryEntry` carries no status and `library-filters.ts` has no status facet, so
   * the contradiction reaches no list a user reads; a reviewer checked, and the first version of
   * this comment over-claimed the cost as well as under-arguing the reason. The one surface that
   * renders this column is `ResumableSessions.vue`, which lists CLOSED conversations, where a burst
   * cannot occur. ⚠️ *On quit*: nothing is lost that could be repaired — nothing is running any
   * more, so `idle` is the true durable answer for both states, and the sweep exists for rows that
   * ASSERT live work. What is genuinely unavailable is asking the DATABASE which conversations were
   * busy outside a turn, and nothing asks it today.
   */
  function currentStatus(
    sessionId: string,
    event: TranscriptEvent | null,
    generation: number,
  ): SessionStatus {
    // Terminal is the machine's to declare, and it is permanent: once a session has ended or
    // errored, no later event un-ends it. `null` is the promotion's ask — "reconcile against the
    // turns, there is no event driving this" — and it falls straight through to the row.
    if (event?.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      return event.state
    }
    const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
    if (row?.status === 'ended' || row?.status === 'errored') return row.status
    const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    if (!open) return 'idle'
    return open.blocked_at === null ? 'working' : 'waiting_permission'
  }

  /**
   * Close whatever is open and reconcile the status — in ONE transaction (045 review, generalised
   * by 051).
   *
   * Two bare writes could be split by a crash, and the halves are not equally survivable: the turn
   * would be closed while the column still said `working`, and the next call would find nothing open
   * and return early, leaving that session busy forever with no path back. One transaction, so
   * either both facts land or neither does.
   *
   * The status is reconciled EVEN WHEN NOTHING WAS OPEN. That is what repairs a row written before
   * this table existed: a pre-045 session left at `working` has no turns to close, and would
   * otherwise keep claiming to be running for the rest of its life.
   *
   * ONE transaction serves both endings a session can have, because they differ in exactly one
   * value. `terminal` null is resume's ending — the TURN is over, the session is not, so it settles
   * to `idle`. A terminal status is the host finalizer's ending: the session itself has stopped.
   * Writing that as a second, nearly-identical transaction is how the rule below (terminal is
   * permanent) would come to be stated twice and then hold in only one of them.
   */
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
      // Terminal is permanent, here as in `currentStatus`: the FIRST ending recorded is the one that
      // stands, so a close that follows a provider's own `session: ended` does not overwrite it.
      if (row && row.status !== 'ended' && row.status !== 'errored') {
        updateStatus.run(terminal ?? 'idle', at, sessionId)
      }
      return open !== undefined
    },
  )

  /**
   * The other half of {@link settleTx}: a session coming BACK — see `SessionStore.reopened` for
   * what was wrong and how it was measured.
   *
   * Its own transaction rather than a fourth parameter on `settleTx`, because it is the one write
   * here whose whole purpose is to overwrite a terminal, and burying that in the transaction whose
   * stated rule is *"terminal is permanent"* would leave the rule readable and false.
   */
  const reopenTx = db.transaction((sessionId: string, at: number): boolean => {
    // ⚑ **692 · before the early return, and that order is the point** — see `SessionStore.reopened`.
    clearClosedByTheQuit.run(sessionId)
    const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
    if (row?.status !== 'ended' && row?.status !== 'errored') return false
    updateStatus.run('idle', at, sessionId)
    return true
  })

  /**
   * The rows a dead process left claiming to be busy (074).
   *
   * `idle`, `ended` and `errored` are all settled answers; these two are the only ones that assert
   * something is happening RIGHT NOW, which is the assertion a crash strands. Named as a pair rather
   * than written `NOT IN ('idle','ended','errored')` so that a sixth status added to
   * `sessionStatusSchema` has to be classified deliberately instead of being swept by default.
   */
  const selectRunningSessions = db.prepare(
    `SELECT id FROM provider_session WHERE status IN ('working', 'waiting_permission')`,
  )

  /**
   * One transaction for the whole sweep — see {@link SessionStore.settleOrphanRuns}.
   *
   * Whole-sweep rather than per-session because this is startup repair: a crash partway through it
   * would leave some rows reconciled and some not, and the next launch would have to be able to tell
   * those apart, which is the same problem again one level up. `settleTx` nests as a savepoint.
   */
  /**
   * 🔴 **Write the ending a crash could not** — see {@link SessionStore.settleStrandedMessages}.
   * ⚑ **D-030** — only for a message held in a life a crash cut ({@link strandedMessages}).
   *
   * ⚠️ **One transaction for the whole sweep, for {@link settleOrphanRunsTx}'s stated reason**: a
   * crash partway through startup repair would leave some sessions repaired and some not, and the
   * next launch would have to tell those apart — which is this problem again, one level up.
   */
  /**
   * 🔴 **Every conversation that was ever GIVEN a piece** (398; read off `work` since D-016) —
   * served by `work_owner_idx`.
   *
   * ⛔ **The candidates for the restart sweep, and only the candidates.** Which of them still owns
   * an OPEN piece is a property of a ledger, not of a row, so the FOLD decides — the rule
   * {@link settleStrandedRequestsTx} states and this one inherits unchanged.
   *
   * ⚠️ **The OWNER, so it is the ledger the work LANDED in** — a sweep reading the givers would
   * watch the wrong conversation go quiet. ⛔ **`parent_id IS NOT NULL`: never a root's owner for its
   * root** (D-016 · R1) — a root's state is its conversation's, and no giver waits on it. ⚑ A root
   * owner that took work on is one, for that work (D-016 · commit 6): a crash can leave it
   * `working`, and the sweep must reach it.
   */
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
       FROM events INDEXED BY events_fold_idx WHERE ${FOLD_TERM}
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

  /**
   * 🔴 **Every conversation another conversation ever gave a piece** — the stall band's candidates
   * ({@link SessionStore.stalledWorkNobodyWasToldAbout}), served by `work_owner_idx` as its
   * neighbour is. ⚑ **F097 · and the candidates of the work waiting on the person who wrote**
   * ({@link SessionStore.piecesWaitingOnWhoWrote}): the fold enters that wait over no other piece.
   *
   * ⛔ **Narrower than {@link selectOwnersOfGivenPieces} on purpose** (D-016 · commit 6): the band
   * draws only a piece a conversation gave (`aStallItsGiverCanBeToldOf`), and a conversation that
   * holds only work a person gave — every root owner, which nobody gives to — could never yield a
   * row, yet would be folded every five seconds to find that out. ⚑ Still candidates and no more:
   * the fold decides. ⚑ A giver on a piece implies a parent (`work_a_root_is_given_by_a_person_ck`).
   */
  const selectOwnersOfPiecesAConversationGave = db.prepare(
    `SELECT DISTINCT owner_session_id AS id FROM work WHERE given_by_session_id IS NOT NULL`,
  )
  // ⚑ **729 · R89 — the two questions the crash repair asks before it records a lost answer**: is the
  // replier a conversation this database holds, and is its loss already recorded? See the repair.
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
      // ⚠️ **`held` and not `row`, which is not style.** `198`'s `M19` anchors on
      // `if (running.has(row.session_id)) continue` inside `clearOrphanBuildsTx`, and a second copy
      // of that line anywhere in this file makes that row match twice and RETIRE — somebody else's
      // mutation going dark because of a variable name here.
      for (const held of stranded) {
        // ⛔ **Skipped, not repaired, exactly as a run held by another host is.** A second store over
        // a database whose first host is still holding that message would otherwise write an ending
        // for a message that is about to be sent.
        if (running.has(held.session_id)) continue
        // 🔴 **D-017 · R8 — the outer net**: a ledger that throws is skipped; the sweep goes on.
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
              // ⚠️ **The text is repeated because the ending is read on its own** (054 pages the
              // transcript). ⛔ `''` rather than dropping the field: `text` is required on this
              // event, and a repair inventing prose would be worse than a repair admitting it had
              // none.
              text: held.text ?? '',
              // ⛔ **`abandoned` alone would say something untrue here.** Its built-in sentence is
              // *"the conversation ended underneath it"*, and this one did not end — the app
              // stopped while the message was still waiting. `216`'s rule: present only when there
              // is a more specific sentence to give.
              detail: 'the app stopped while this message was still waiting to be sent',
              // 🔴 **687 · whose words, and what about — carried from the held row** (R22, found by
              // `687`'s review). ⛔ This is the SIXTH writer of a held row's ending and the one
              // `406`, `413`, `545`, `624` and `687` all missed: it wrote none of the subject, so a
              // window that paged past the queueing rebuilt a crashed go-ahead, reply, brief or
              // notice as the person's own words, with *Put it back in the composer* under it.
              ...authorshipStoredOn(held.payload),
              // 🔴 **689 · and the paths it was queued with** (`687` inbox 3) — without them a
              // crashed message is offered back without its files. See {@link attachmentsStoredOn}.
              ...attachmentsStoredOn(held.payload),
            },
            at,
            generation,
            true,
          )
          // 🔴 **729 · PM ruling R89 — and an ANSWER that crash stranded is a lost answer** (`724`
          // F-1): the host writes this row for every other ending of a held answer
          // (`RuntimeHost.recordAnAnswerItsGiverNeverGot`), and a crash reaches none of them.
          // ⚑ Into the REPLIER's ledger, in this transaction, so the ending and the record land
          // together. ⛔ Skipped for a replier another live host is holding, for the reason the
          // ending above is: that host numbers its own rows, and a row written under it would take
          // its next ordinal.
          //
          // 🔴 **And never at the cost of the launch** (`729`'s review, round one). ⚠️ The replier
          // is an id read out of a STORED row, and a ledger imported from a bundle names
          // conversations this database may never have held: an append there fails the events
          // table's foreign key, and a throw here would reach the outer net below and count this
          // settled ledger as skipped (it unwound the whole launch until D-017). ⚑ So: only a
          // conversation this database holds, only once per answer (a host that recorded the loss
          // before its giver's own ending failed to record leaves both a record and a stranded
          // message), and a write that still fails is warned about and passed.
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
  /**
   * 🔴 **Write the ending a crash could not, for a REQUEST** (396) — see
   * {@link SessionStore.settleStrandedRequests}.
   *
   * ⛔ **The candidate ledgers come from SQL and the decision comes from the FOLD.** `open` means
   * *nothing in this ledger has ended it*, which no `NOT EXISTS` can spell: the endings are four
   * event types, one of them keyed under a different field name (`request_resolved.id`), and one of
   * them session-wide (`status`). ⚑ A predicate that tried would be `deriveRoutedRequests` written a
   * second time in SQL, free to disagree with the reader every surface uses.
   *
   * ⚠️ **One transaction for the whole sweep, for {@link settleOrphanRunsTx}'s stated reason.**
   *
   * ⚑ **Idempotent by construction**: the second run folds the rows this one closed and finds them
   * `stranded`, so it writes nothing.
   */
  const settleStrandedRequestsTx = db.transaction(
    (at: number, running: ReadonlySet<string>, unread?: RowsUnread): number => {
      const candidates = selectSessionsThatRouted.all() as { id: string }[]
      let settled = 0
      for (const asker of candidates) {
        // ⛔ **Skipped, not repaired, exactly as a run held by another host is** — the same sentence
        // {@link settleStrandedMessagesTx} makes: a second store over a database whose first host is
        // still running that conversation would otherwise strand a request somebody is answering.
        if (running.has(asker.id)) continue
        // 🔴 **D-017 · R8 — the outer net**: a ledger that throws is skipped; the sweep goes on.
        try {
          const generation = activeGeneration(asker.id)
          // ⚑ **D-017 · R4** — a question this app asked in a launch that wrote `launched` outlives
          // the stop: its answer starts the asker again, so only the provider's own requests strand.
          const launched = selectALaunch.get(asker.id, generation) !== undefined
          const raised = launched ? questionsRaisedInSession(asker.id, unread?.in(asker.id)) : null
          for (const request of routedRequestsOfSession(asker.id, unread?.in(asker.id))) {
            if (!REQUEST_IS_OPEN[request.state]) continue
            if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue
            // ⚠️ **Re-read per row and not hoisted**: `appendTx` moves the maximum, and a hoisted
            // ordinal would write two rows at one ordinal for a conversation holding two open
            // requests — which `unique(session_id, generation, ordinal)` refuses, and the outer net
            // below would skip this ledger half settled.
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

  /**
   * 🔴 **Every instruction ask anybody is still waiting on** (582) — the cross-session fold.
   *
   * ⛔ **`JSON.parse … as` with no schema**, which is this file's boundary everywhere and the
   * reason `isInstructionEnding` and `foldWhoWroteIt` exist: a row written by a build whose
   * vocabulary has moved reaches a reader as a word it does not know, and every consumer of these
   * folds narrows rather than casts.
   */
  const instructionAsksWaiting = (): readonly InstructionAskWaiting[] =>
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
        // 🔴 **D-017 · R8 — one torn row is skipped, never the whole read** (`noteUnreadRow`).
        if (row.readable === 0) {
          noteUnreadRow(row.conversation, row.ordinal, undefined)
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
          return []
        }
      }),
    )

  /**
   * ⛔ **Append one settlement into the ledger of the conversation that ASKED** (582) — and answer
   * whether there was anything to settle.
   *
   * ⚑ **The ordinal is re-read inside the transaction**, because every append moves the maximum and
   * a hoisted read would write two rows at one ordinal for a conversation holding two asks — which
   * `unique(session_id, generation, ordinal)` refuses.
   *
   * ⚠️ **It refuses an ask that is already settled**, so a second press writes no second row. ⛔
   * That is the LEDGER's state and not a caller's map: two hosts over one ledger is what every test
   * does, and one can be holding what the other has already settled.
   */
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
  const mcpServerRequestsWaitingNow = (): readonly McpServerRequestWaiting[] =>
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
          noteUnreadRow(row.conversation, row.ordinal, undefined)
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

  /**
   * ⛔ **612 · `escalationsDueNow` stood here and is GONE** (HO-088 §3.1) — the whole deadline.
   *
   * ⚑ **It computed the moment a question FELL DUE** — `request.at + windowMs` — *"so a question
   * that ran out of time while nobody was looking records the truth rather than the look"*, which
   * is what made looking more often free and a missed look harmless.
   *
   * ⚠️ **It survived `HO-018` §2.2, which withdrew its sibling over a working child's silence**,
   * on the ground that it inferred nothing from an absence of events: *"a question nobody answered
   * is a row that is still open, and a parent that is busy working is still not answering."*
   * 🔴 **`HO-088` §3.1 took that ground away**: the row it wrote says a PARENT failed to answer,
   * and the app never observed that — it observed a window passing.
   *
   * ⛔ **Nothing in this app now looks at an absence and writes a row about it.**
   */
  /**
   * 🔴 **Write down that a restart left this work with nobody driving it** (400) — see
   * {@link SessionStore.settleRestartedWork}.
   *
   * ⚠️ **One transaction for the whole sweep, for {@link settleOrphanRunsTx}'s stated reason**: a
   * crash partway through startup repair would leave some conversations repaired and some not, and
   * the next launch would have to tell those apart.
   *
   * ⛔ **The FOLD decides, and no predicate here does.** *"Does this conversation still own a piece
   * nobody finished?"* is a property of a ledger, not of a row — the rule
   * {@link settleStrandedRequestsTx} states and this inherits unchanged. ⚑ The candidates are the
   * owners of given pieces, never a root's owner for its root (D-016 · R1).
   *
   * ⚑ **D-016 · commit 6 · a piece a person gave that waits on them is neither `waiting` nor
   * `working`**, so it is never named: a relaunch leaves it waiting (D-016c ruling (c)).
   *
   * ⚑ **Stamped at NOW, and there is nothing back-stamped anywhere in this sweep.** The app really
   * did restart, and the launch really is when we learned it — so unlike `398`'s withdrawn deadline
   * there is no reader anywhere that has to exclude this row from *"the last thing that happened"*.
   */
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
      // ⛔ A service's pieces whose brief was never handed over are queued, not cut by a restart.
      const services = new Set((selectServicesBorn.all() as { id: string }[]).map(({ id }) => id))
      for (const worker of selectOwnersOfGivenPieces.all() as { id: string }[]) {
        // ⛔ **Skipped, not repaired, exactly as a run held by another host is** — and a store-side
        // append into a LIVE ledger is a defect rather than a race: `RuntimeHost` holds its own
        // ordinal counter per session, so a row written from outside it collides on
        // `unique(session_id, generation, ordinal)`, `record()` marks the conversation as no longer
        // recorded, and every later durable event of a conversation somebody is having is dropped.
        if (running.has(worker.id)) continue
        // 🔴 **D-017 · R8 — the outer net**: a ledger that throws is skipped; the sweep goes on.
        try {
          // ⚠️ **`waiting` or `working` and never `stalled`** — see {@link TaskState.stalled}. A
          // piece already stalled has already said that nothing is driving it, and a second row
          // would repeat that at every launch for the rest of the conversation's life.
          // ⚑ …and never one held for the background by a job a wake-up will start it for: that
          // job drives it, and *"not being worked on"* would be false the moment it fires.
          const woken = wokenForAJob?.has(worker.id) === true
          // ⚑ A piece read as waiting on purpose is judged by the state under its mark.
          const listed = piecesOfSession(worker.id, unread?.in(worker.id)).filter(
            (piece) =>
              piece.state === 'waiting' ||
              piece.state === 'working' ||
              piece.parkedOver === 'working',
          )
          const open = services.has(worker.id)
            ? listed.filter((piece) => piece.state !== 'waiting')
            : listed
          // ⚑ Work left `working` for its job may still have waited on commands a crash killed:
          // its owner is reported too, and the launch reads its ledger for running work.
          if (woken && open.some((piece) => piece.inTheBackground !== undefined)) {
            diedInTheBackground?.add(worker.id)
          }
          const named = open.filter((piece) => !(woken && piece.inTheBackground !== undefined))
          const undriven = named.map((piece) => piece.piece)
          if (undriven.length === 0) continue
          if (named.some((piece) => piece.inTheBackground !== undefined)) {
            diedInTheBackground?.add(worker.id)
          }
          // ⚑ A conversation a continuation will start: its continued turn drives its work. Its
          // background work that died is still reported, so one start carries both.
          if (continuing?.has(worker.id) === true) continue
          const generation = activeGeneration(worker.id)
          // ⚠️ **Re-read per row and not hoisted**, for {@link settleStrandedRequestsTx}'s reason:
          // `appendTx` moves the maximum.
          const max = selectMaxOrdinal.get(worker.id, generation) as
            { max_ordinal: number | null } | undefined
          appendTx(
            worker.id,
            (max?.max_ordinal ?? -1) + 1,
            // ⚑ **D-016 · the pieces it names** are the ones the fold stalls: a piece given after
            // this row, or one that had already stalled, is not a restart's to stall.
            { type: 'work_restarted', pieces: undriven },
            at,
            generation,
            // ⚠️ **`false`, as its three neighbours pass**: this row opens no turn, closes none and
            // carries no terminal, so the status column derives to exactly what it already holds.
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

  /** ⚑ The cut-turn reads' statements, prepared on first use — {@link spawnSql}'s rule. */
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
    // ⛔ **Filtered, and the COUNT is of what was settled** (198). Returning `rows.length` over a
    // filtered loop would report the app repairing conversations it deliberately left alone, and
    // that number is what the launch log tells the user.
    const stranded = rows.filter((row) => !running.has(row.id))
    for (const row of stranded) settleTx(row.id, 'unknown', at, null)
    return stranded.length
  })

  // --- the tree (D-016) ---
  //
  // ⚑ `work`, `work_sequence` and `work_resource`: what a piece IS, the counters that number
  // pieces, and the files kept for them. Lazy, by {@link spawnSql}'s rule.
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
      /**
       * ⛔ **`+ 1` in SQL, and the first number in a scope is written by whoever gets there first**,
       * so a caller cannot be handed a stale number it read a moment earlier. ⚑ Always inside a
       * caller's transaction, with {@link last} read straight after it.
       */
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
      /** ⚑ Served by `work_root_number_uq` — the first probe of a label. */
      rootNumbered: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id IS NULL AND number = ?`,
      ),
      /** ⚑ Served by `work_parent_number_uq` — every later probe of a label. */
      childNumbered: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id = ? AND number = ?`,
      ),
      /** ⚑ Served by `work_one_root_per_conversation_uq`, which also makes the answer unique. */
      rootOwnedBy: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id IS NULL AND owner_session_id = ?`,
      ),
      children: db.prepare(`SELECT ${WORK_COLUMNS} FROM work WHERE parent_id = ? ORDER BY number`),
      /**
       * 🔴 **A piece's newest title or status line** — a root's ({@link SessionStore.rootLines}, and
       * the title {@link SessionStore.workThatNames} names its owner by) and, D-026, the title any
       * kept file's piece stands under ({@link titleNow}).
       *
       * ⛔ **The seven types are spelled out beside the one asked for**, because SQLite uses
       * `events_work_idx` only for a WHERE that implies the index's own; the index is what lets this
       * walk one ledger's piece rows from the newest down instead of the whole ledger — and
       * `+generation` is {@link selectFirstPieceGiven}'s plus, for its reason. ⚑ The payload is guarded
       * with a `CASE`, the only order SQLite promises, so a torn row answers nothing rather than
       * raising.
       */
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
        `SELECT payload, created_at FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type = ?
            AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
          ORDER BY ordinal DESC
          LIMIT 1`,
      ),
      // A malformed newest row could name this root; never skip it to claim absence.
      turnRootLine: db.prepare(
        `SELECT payload, created_at FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type = ?
            AND CASE WHEN json_valid(payload)
              THEN CASE WHEN json_type(payload, '$.piece') = 'text'
                THEN json_extract(payload, '$.piece') = ? ELSE 1 END
              ELSE 1 END
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      /**
       * ⚑ **D-037 · every `work_retitled` in one owner's ledger, newest first** — {@link newestLine}'s
       * walk once for all of that owner's pieces rather than once for each: what names a page of
       * kept files reads, so a page costs one walk per owner on it.
       */
      retitlesIn: db.prepare(
        `SELECT payload FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                         'work_status_set', 'work_rebriefed', 'work_closed')
            AND type = 'work_retitled'
          ORDER BY ordinal DESC`,
      ),
      /**
       * ⚑ **Give's lookup, one parent at a time** — served by `provider_session_parent_identity_idx`,
       * keyed on the identity's DERIVED id (`agentIdentityRowId`), so no join to `agent_identity` is
       * needed. ⛔ Newest by `created_at`, then the id, so two rows written in one millisecond cannot
       * swap.
       */
      childAs: db.prepare(
        `SELECT id, created_at FROM provider_session
          WHERE parent_session_id = ? AND agent_identity_id = ?
            AND (? IS NULL OR provider = ?)
            AND id NOT IN (SELECT value FROM json_each(?))
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      ),
      /**
       * ⚑ **D-024 · an identity's conversations** — served by `provider_session_identity_idx`,
       * keyed on the DERIVED id as {@link childAs} is. ⛔ Newest by `updated_at`, then the id.
       */
      conversationsOf: db.prepare(
        `SELECT id, parent_session_id, created_at, updated_at FROM provider_session
          WHERE agent_identity_id = ?
          ORDER BY updated_at DESC, id DESC`,
      ),
      /**
       * ⚑ **F009 · the newest pieces some conversations hold** — served by `work_owner_idx`, one probe
       * per conversation named in the JSON array, and sorted: what it sorts is those conversations'
       * pieces and never the table. ⛔ Newest by `created_at`, then the id, so two given in one
       * millisecond cannot swap. ⚑ A root (`parent_id IS NULL`) is never one.
       */
      newestHeldIn: db.prepare(
        `SELECT id, owner_session_id FROM work
          WHERE owner_session_id IN (SELECT value FROM json_each(?))
            AND parent_id IS NOT NULL
          ORDER BY created_at DESC, id DESC LIMIT ?`,
      ),
      /** ⚑ {@link newestHeldIn}'s whole count, through the same index. */
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
      /** ⚑ **D-026 · the files kept on one piece** — served by `work_resource_work_idx`. */
      filesOnPiece: db.prepare(`SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE work_id = ?`),
      /**
       * ⚑ **D-026 · the files one conversation added** — ⚠️ a SCAN of `work_resource`: nothing
       * indexes `added_by_session_id`, and the scope cannot go through `work` exactly, because a
       * conversation standing in for a giver (D-017 · R10) adds files to a piece another gave. One
       * row per kept file and never a ledger row (measured: 2–3 ms over 50,000 rows).
       */
      filesAddedBy: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE added_by_session_id = ?`,
      ),
      /**
       * ⚑ **D-026 · the files on a tree** — its pieces ({@link HELD_UNDER}), then their files
       * (`work_resource_work_idx`).
       */
      filesUnder: db.prepare(
        `${HELD_UNDER}
         SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE work_id IN (SELECT id FROM held)`,
      ),
      /**
       * ⚑ **D-024 · R3 — what an identity's conversations made, newest first** — the pieces they
       * own (`provider_session_identity_idx`, then `work_owner_idx`) as a list
       * `work_resource_work_idx` is probed with. ⛔ Newest by `created_at`, then the id.
       */
      madeBy: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource
          WHERE role = 'made'
            AND work_id IN (SELECT w.id FROM work w
                              JOIN provider_session s ON s.id = w.owner_session_id
                             WHERE s.agent_identity_id = ?)
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      ),
      /** ⚑ {@link madeBy}'s whole count, through the same indexes. */
      madeByCount: db.prepare(
        `SELECT count(*) AS total FROM work_resource
          WHERE role = 'made'
            AND work_id IN (SELECT w.id FROM work w
                              JOIN provider_session s ON s.id = w.owner_session_id
                             WHERE s.agent_identity_id = ?)`,
      ),
      /**
       * ⚑ **D-037 · a page of every kept file, newest first** — read backwards from the end of
       * `work_resource` by its rowid, and never sorted: a page costs what its rows cost, whatever the
       * store holds.
       */
      newestKeptAnywhere: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource
          WHERE ${KEPT_BEFORE}
          ORDER BY rowid DESC
          LIMIT @limit`,
      ),
      /** ⚑ **D-037** — counted no further than `@cap`. */
      keptAnywhereCount: db.prepare(
        `SELECT count(*) AS total FROM (SELECT 1 FROM work_resource WHERE ${KEPT_BEFORE} LIMIT @cap)`,
      ),
      /**
       * ⚑ **D-037 · a page of a tree's files, newest first** — its pieces ({@link HELD_UNDER}), their
       * files through `work_resource_work_idx`, then sorted: a page costs what the tree's files cost,
       * and never what the store holds.
       */
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
      /** ⚑ **F046** — a scan of `work_resource`, run once after a launch, bounded by its `LIMIT`. */
      untitledResources: db.prepare(
        `SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE title IS NULL ORDER BY rowid LIMIT ?`,
      ),
      titleResource: db.prepare(
        `UPDATE work_resource SET title = ? WHERE id = ? AND title IS NULL`,
      ),
      /** ⚑ A scan of `work_resource` too, run after a launch, a page at a time by `rowid`. */
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

  /**
   * ⚑ **The next number in one scope** — a parent's `work.id`, or {@link ROOTS_SCOPE}. ⛔ Runs
   * INSIDE the caller's transaction: the bump and its read are one decision.
   */
  const bumpSequence = (scope: string): number => {
    workSql().bump.run(scope)
    return (workSql().last.get(scope) as { last: number }).last
  }

  /**
   * 🔴 **A conversation's ROOT — the work a person gave it** (D-016), written inside the transaction
   * that writes the conversation's row: numbered among the roots, given by a person, untitled.
   *
   * ⛔ **No event** (D-016 · R1): a root is never a folded piece, and its state is its conversation's.
   */
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

  /**
   * ⚑ **D-016 · one conversation's identity slug, memoised for ONE answer** — a piece carries its
   * giver's conversation and not its identity, so an edge's `fromIdentity` is read here, once per
   * giver. ⚠️ Per answer and never per store: a memo that outlived the call would draw yesterday's.
   * ⚑ **D-016 · commit 6** — a person, a piece's `null` giver, has none.
   */
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

  /**
   * ⚑ **One piece's chain, from it up to its root** — one read per level.
   *
   * ⛔ **Throws on a chain it cannot walk**: a parent the foreign key promises and the table does not
   * hold, or a walk longer than any give could make — both a database edited by hand. A label built
   * from part of a chain would name a different piece.
   */
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

  /** ⚑ A `work` row as every reader meets it, with the label its chain spells. */
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

  /** ⚑ {@link workRowFrom} for a row whose chain has not been walked yet. */
  const workRowWalked = (row: WorkDbRow): WorkRow =>
    workRowFrom(
      row,
      [...chainUp(row)].reverse().map((each) => each.number),
    )

  /**
   * ⚑ **A piece's newest `work_retitled` or `work_status_set`**, as stored and with the moment it
   * was written, or `null` — through `newestLine`, in its owner's ledger and `generation`, where
   * every line about a piece is written.
   */
  const newestLineAbout = (
    piece: WorkDbRow,
    generation: number,
    type: 'work_retitled' | 'work_status_set',
  ): Record<string, unknown> | null => {
    const found = workSql().newestLine.get(piece.owner_session_id, generation, type, piece.id) as
      { payload: string; created_at: number } | undefined
    if (found === undefined) return null
    const stored = aStoredObject(found.payload)
    return stored === null ? null : { ...stored, at: found.created_at }
  }

  /**
   * ⚑ **D-016 · commit 7 · D-026 · the title a piece stands under now, read ONE way** — by
   * {@link SessionStore.rootLines} and {@link SessionStore.workThatNames}, so a card and a header
   * cannot title one root two ways, and by the kept files' pieces ({@link onTheirPieces}).
   *
   * ⚑ **Its newest `work_retitled`, else its title as given** — the fold's own rule
   * (`PieceRow.title`: the give's title, then the newest `work_retitled` about it, whoever wrote it,
   * open or ended), read as the one line that decides it and never by folding a ledger. A root's as
   * given is `null`, so a root nobody titled answers `null`. ⚠️ **One line read, not one row
   * visited**: `newestLine` walks the owner's work rows newest first until one names this piece, so
   * a piece nobody retitled walks every one of them.
   *
   * ⚠️ **A row that does not say what it should reads as nothing**, never as an empty title: a torn
   * or hand-edited line is passed over, as every other fold here passes one over.
   *
   * ⚑ **D-037 · `newestRetitle` is where that one line is found** — {@link newestLineAbout} for one
   * piece, or a reader that has walked the owner's retitles once for many ({@link onTheirPieces}).
   */
  const titleNow = (
    piece: WorkDbRow,
    generation: number,
    newestRetitle: (piece: WorkDbRow, generation: number) => Record<string, unknown> | null = (
      one,
      itsGeneration,
    ) => newestLineAbout(one, itsGeneration, 'work_retitled'),
  ): string | null => {
    const retitled = newestRetitle(piece, generation)
    return typeof retitled?.title === 'string' ? retitled.title : piece.title
  }

  /**
   * ⚑ **D-037 · each piece's newest `work_retitled` in one owner's ledger**, from one walk
   * ({@link retitlesIn}): the first row that names a piece, newest first, is its newest — as
   * {@link newestLine} answers it. ⛔ A row whose payload cannot be read names no piece and is passed
   * over, as `newestLine`'s `json_valid` passes it over.
   */
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

  /** ⚑ A `work_resource` row as every reader meets it. The role CHECK is what makes the cast true. */
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

  /** ⚑ **A tree's parameters for {@link HELD_UNDER}** — its holder, and its givers as one JSON array. */
  const treeOf = (
    asked: Extract<KeptFilesAsked, { readonly scope: 'tree' }>,
  ): { readonly holder: string; readonly givers: string } => ({
    holder: asked.holder,
    givers: JSON.stringify(asked.givers),
  })

  /**
   * ⚑ **D-026 · kept files, each on its piece** — the label its chain spells and the title it
   * stands under now ({@link titleNow}), each piece read once per answer and each owner's generation
   * and retitles once ({@link retitlesOf}, D-037: a long-lived owner's ledger walked once, not once
   * per piece); with the numbers the label is made of, for {@link SessionStore.filesKept}'s order.
   *
   * ⛔ **A chain this database cannot walk throws** ({@link chainUp}'s rule: a label built from part
   * of a chain would name a different piece). ⚠️ A file whose piece this database lacks — which the
   * foreign key rules out — is left out.
   */
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

  /**
   * 🔴 **{@link SessionStore.recordGive}: the row, its inputs and its opening event, ONE
   * transaction.** ⚑ The event goes through {@link appendTx}, so it is bounded and stamped exactly
   * as every other row. ⛔ The inputs go after the row, whose id they name.
   */
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

  /**
   * The adopted row's INSERT, shared by `adopt()` and `importSnapshot()` so a bundle's row and a
   * discovered conversation's row are written by the same statement with the same rules (051) —
   * and each gets its ROOT (D-016): an adopted or imported conversation never has a parent here.
   */
  const insertAdoptedRow = (record: AdoptedSessionRecord, at: number): void => {
    const ref = serializeSessionRef({
      provider: record.provider,
      sessionId: record.sessionId,
      cwd: record.cwd,
      // ⛔ **The REF keeps the number it arrived with, verbatim** (204). It is the provider's handle
      // — 0 for a conversation found on disk, whatever a bundle was exported with otherwise — and
      // resume validates against it.
      rotation: record.rotation ?? 0,
    })
    // ⛔ **`null` here is the user's OWN home, and it must not become the app's own profile**
    // (`homeProfileOf`, 188 §1 from 168 M6) — ⚠️ **620 · that profile was spelled `default` here
    // until `592` renamed it**. `sweepOne` blanks the profile for a conversation read out of `~/.claude` /
    // `~/.codex`: no home of ours holds it, so it gets no identity. ⚑ **And a BUNDLE arrives here
    // the same way**: `importBundle` keeps an explicit `null`
    // explicitly null and defaults only a MISSING field (188 §1, from 168 L5), so a bundle exported
    // from a `~/.claude` row imports with no profile too — which is the case that would otherwise
    // have re-claimed it on the way back in.
    const identityId = record.profileId === null ? null : identityRowFor(record.profileId, at)
    insertAdopted.run(
      record.id,
      record.provider,
      ref,
      record.cwd,
      record.profileId,
      // The provider's own times, not ours: this conversation existed before we saw it, and
      // `adopted_at` is where "when we recorded it" belongs.
      record.createdAt,
      record.updatedAt,
      at,
      // ⚠️ `null`, not `'{}'`, for a session with no descent: the column's absence IS the statement
      // that this is not a child, and an empty object would read as "a child we know nothing about".
      record.child ? JSON.stringify(record.child) : null,
    )
    // 🔴 **An adopted conversation gets its identity too** (369), by the same second statement
    // `createTx` uses. ⛔ **None for a conversation with no profile**, so `agent_identity_id IS NULL`
    // is exactly the rows adopted with no profile — the user's own home's conversations, which no
    // agent of this app holds and the placed reads leave out.
    if (identityId !== null) spawnSql().writeIdentityOnSession.run(identityId, record.id)
    // 🔴 **D-016 · and its root**, whatever its profile: a conversation nobody here started is
    // one a person started, so its work is a person's.
    openRoot(record.id, at)
  }

  /**
   * A whole imported conversation, in one commit (051). See {@link SessionStore.importSnapshot}.
   *
   * It DELEGATES to the writes it is composed of rather than reimplementing them — better-sqlite3
   * nests a transaction as a savepoint, so the adopted row's ref serialization and every rule
   * `appendTx` carries (turn bookkeeping, the `unknown` size bound, the derived status) all still run exactly as they do on their own. The only thing this
   * changes is where the commit is, which is the entire point: there is no longer a moment at which
   * the row exists and the conversation does not.
   */
  const importSnapshotTx = db.transaction((snapshot: SessionSnapshot) => {
    const at = now()
    insertAdoptedRow(snapshot.session, at)
    // ⛔ **In the same commit as the row, so a restored bundle is never briefly resumable** (214 §1).
    // `resumable()` reads this column; a second transaction would open a window in which the reopen
    // list offered a conversation whose transcript is in no home we provision — 194 M2 exactly.
    markRestored.run(at, snapshot.session.id)
    for (const entry of snapshot.ledger) {
      appendTx(snapshot.session.id, entry.ordinal, entry.event, entry.at, 0, true)
    }
    // A bundle's ledger is not something we projected — it is a copy of one another machine
    // recorded, and re-deriving it would hand back something other than what was exported. It gets
    // a generation record anyway, and the record is the honest one: this projection is CURRENT for
    // the importer shipping now, and it covers every line the bundle carried.
    writeGeneration.run(snapshot.session.id, NORMALIZER_VERSION, snapshot.derivedThrough, at)
  })

  /**
   * One rescan's worth of catching up on an adopted row: the provider's clock, and the descent
   * (119).
   *
   * ⚠️ **One transaction, because a read decides the write.** The merge needs the stored value, and
   * two concurrent rescans reading the same NULL and writing different answers is exactly the
   * interleaving `atomically` exists to prevent elsewhere in this file.
   */
  const learnDescentTx = db.transaction((sessionId: string, child: ChildDescent | undefined) => {
    // ⚑ **Nothing live to say means nothing to do, and that is the rule rather than an
    // optimisation** — `mergeDescent(stored, undefined)` is `stored` for every input, so the read
    // below would prove only that we were about to write back what was already there. It also
    // keeps the ordinary pass free: most of a home is not children, and the sweep runs over
    // thousands of rows.
    if (!child) return false
    const row = readAdoptedDescent.get(sessionId) as { child_descent: string | null } | undefined
    if (row === undefined) return false
    // ⚠️ **An UNREADABLE cell is the one place "never erase" does not hold, and it is the right
    // trade** (review). `parseChildDescent` maps corrupt JSON to null so one bad cell cannot take
    // the whole library down — so the merge takes the fill path and this replaces it. Only genuine
    // corruption gets here (any future JSON *object* shape still parses), and a cell nothing can
    // read holds nothing to protect.
    const merged = mergeDescent(parseChildDescent(row.child_descent), child)
    const next = merged === null ? null : JSON.stringify(merged)
    // Nothing changed: an idempotent pass writes no rows, which is what makes running one cheap
    // enough to run often.
    if (next === row.child_descent) return false
    writeAdoptedDescent.run(next, sessionId)
    // ⚑ **The answer to "how many", and it is the write itself rather than a tally beside it**
    // (121). Every early return above is a reason nothing was learned, so a caller counting these
    // is counting rows that genuinely changed — not rows that were looked at, which is the number
    // a caller-side count would have produced and printed under the same caption.
    return true
  })

  const refreshAdoptedTx = db.transaction(
    (sessionId: string, updatedAt: number, child: ChildDescent | undefined) => {
      touchAdopted.run(updatedAt, sessionId, updatedAt)
      return learnDescentTx(sessionId, child)
    },
  )

  /**
   * One transaction for a created session (204): the identity, the session, and — for one no
   * conversation started — its root (D-016).
   *
   * ⛔ **Whole-transaction because they are one fact.** A crash between the identity insert and the
   * session insert would leave an identity with no session in it; one between the session and its
   * root would leave a person's conversation with no work of its own to hang a give under, and no
   * later write puts one there.
   */
  const writeAFirstLaunch = db.prepare(
    `UPDATE provider_session SET reasoning_effort = ?, model = ?, plan_mode = ?, updated_at = ?
      WHERE id = ? AND external_ref IS NULL`,
  )
  const selectALaunchUnnamed = db.prepare(
    `SELECT 1 FROM provider_session
      WHERE id = ? AND external_ref IS NULL AND launched_as IS NOT NULL`,
  )
  const firstLaunchTx = db.transaction(
    (
      record: Pick<
        NewSessionRecord,
        'id' | 'model' | 'reasoningEffort' | 'planMode' | 'launchedAs'
      >,
      at: number,
    ): boolean => {
      const wrote = writeAFirstLaunch.run(
        record.reasoningEffort ?? null,
        record.model ?? null,
        record.planMode === undefined ? null : record.planMode ? 1 : 0,
        at,
        record.id,
      )
      if (wrote.changes === 0) return false
      if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)
      return true
    },
  )

  const createTx = db.transaction((record: NewSessionRecord, at: number) => {
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
      // Null, not a default: "nobody chose" and "chose medium" are different facts, and only
      // the second may come back as this conversation's setting.
      record.reasoningEffort ?? null,
      // ⚑ D-042 · NULL only for a row nothing has selected a model for yet — its next start does.
      record.model ?? null,
      // Null vs 0 again: "nobody asked" and "asked for no plan mode" are different rows, and only
      // the second is a decision this conversation made.
      record.planMode === undefined ? null : record.planMode ? 1 : 0,
      at,
      at,
    )
    // 🔴 **The identity, in the SAME transaction as the row** (369). ⛔ It is what every placed read
    // keys on (`agent_identity_id IS NOT NULL`), so a created conversation is found by its agent.
    spawnSql().writeIdentityOnSession.run(identityId, record.id)
    // 🔴 **727 · R87 — the id this launch asked for, in the SAME transaction as the row.** ⛔ This
    // runs from `onRegistered`, before the host sends anything, and the CLI writes nothing until a
    // message reaches it — so no transcript under the id this LAUNCH handed the CLI can exist while
    // no row names it. ⚠️ Not a later life's: after a `/clear` the CLI mints the next id itself,
    // and the app learns it only from the init that follows (`721`, R75) — see the 727 response.
    if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)
    // 🔴 **The parent, in the SAME transaction as the row it is about** (341, criterion 8) — or,
    // for a conversation no conversation started, its ROOT (D-016): every conversation with no
    // parent owns one, from the moment its row exists.
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

  /**
   * {@link SessionStore.adopt}'s writes — the row, its identity and its root — for the same reason
   * {@link createTx} is one.
   */
  const adoptTx = db.transaction((record: AdoptedSessionRecord, at: number) => {
    insertAdoptedRow(record, at)
  })

  return {
    ...ownNotesStore,
    canReadFreshSnapshot() {
      return (
        selectWorkflowOutput.busy === false &&
        selectWorkflowAgentTask.busy === false &&
        selectSubAgentReported.busy === false &&
        selectNewestTurnsOpened.busy === false
      )
    },
    create(record) {
      createTx(record, now())
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
      // ⚑ **The SHARED fold decides, on a one-version reading** — so the launch and the sheet agree
      // about *is there a configured layer* by construction rather than by two `trim()`s.
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
        // ⛔ **EXISTENCE first, and it is criterion 12 at this door** — see the interface. A slug
        // with no identity row writes nothing, and `.changes` cannot report that here because the
        // INSERT would succeed on the foreign key only to leave a version for nobody.
        //
        // ⚠️ **`identityBySlug` and not `capabilitiesOf`**, which resolves defaults for a row it
        // did not find; this asks whether the ROW is there, which is the question being refused.
        if (spawnSql().identityBySlug.get(foldProfileName(said.profileSlug)) === undefined) {
          return null
        }
        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined
        if (said.whoWroteIt === 'a-person' && said.by.who !== 'a-person') return null
        if (said.expectedVersion !== undefined && said.expectedVersion !== (newest?.version ?? 0))
          return null
        if (said.currentText !== undefined && said.currentText !== (newest?.text ?? '')) return null
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
            said.expectedVersion === undefined ||
            said.currentText === undefined)
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
            currentText: newest.text,
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

    markInstructionsSeen(profileSlug, version, by) {
      return db.transaction(() => {
        if (by.who !== 'a-person' || !Number.isSafeInteger(version) || version < 0) return false
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

    instructionAsksWaiting() {
      return instructionAsksWaiting()
    },

    settleInstructionAsk(askId, ending, by, at) {
      return settleInstructionAskTx(askId, ending, by, at)
    },

    mcpServerRequestsWaiting() {
      return mcpServerRequestsWaitingNow()
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
      // ⚠️ **`undefined` and `null` collapse to the same answer here, and that is right**: an
      // identity that does not exist has said nothing about a provider, exactly as one that exists
      // and has chosen nothing has. ⛔ Give asks EXISTENCE through `capabilitiesOf`, which is
      // criterion 12's rail; a second existence answer on this path would be a second place for
      // `no-such-profile` to be decided.
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
      // ⛔ **`.changes`, and it is the whole of the criterion-12 refusal** (433). The statement is a
      // bare `UPDATE … WHERE id = ?`: a slug with no row matches nothing and writes nothing, and
      // reporting THAT rather than `true` is what stops a person configuring an identity into
      // existence. ⚠️ It is the same shape {@link SessionStore.setCapabilities} gets from its own
      // `readCapabilities` returning `undefined`, reached one statement earlier because there is no
      // prior value this write has to preserve.
      //
      // ⚑ **`provider` is written verbatim or NULL, and NOT folded on the way in.** The wire's
      // `providerSchema` is what decides whether a word is a provider, and
      // {@link parseProvider} folds again on the way out — so a column this app cannot read answers
      // *nobody has said* to every reader, which is the narrow direction and the value that changes
      // nothing.
      //
      // 🔴 **682 · and a choice for ANOTHER provider is cleared in the same transaction** (`R31b`):
      // a person's two doors never leave a contradiction. See {@link setAgentProviderTx}.
      return setAgentProviderTx(profileSlug, provider)
    },

    setAgentDisplayName(profileSlug, displayName) {
      // ⛔ **`blankToNull` on the way in, so *clear it* and *name it nothing* are one value** (558).
      // The column's readers already treat null as *nobody has named this identity* — a `''` would be a third state every one of
      // them would have to learn.
      //
      // ⚑ **`.changes`, and it is the whole of the criterion-12 refusal**, exactly as
      // {@link SessionStore.setAgentProvider} takes it one statement over: a slug with no row
      // matches nothing and writes nothing, and reporting THAT rather than `true` is what stops a
      // person naming an identity into existence.
      return (
        spawnSql().writeDisplayName.run(blankToNull(displayName), agentIdentityRowId(profileSlug))
          .changes > 0
      )
    },

    modelChoiceOf(profileSlug) {
      const row = spawnSql().readModelChoice.get(foldProfileName(profileSlug)) as
        { model_choice: string | null } | undefined
      // ⚠️ **No row and no choice are ONE answer**, {@link SessionStore.providerOf}'s collapse: give
      // has already asked existence through `capabilitiesOf` by the time it reads this.
      return row === undefined ? null : parseModelChoice(row.model_choice)
    },

    setModelChoice(profileSlug, choice) {
      // ⛔ **`.changes`, and it is the whole of the criterion-12 refusal** (677), exactly as
      // {@link SessionStore.setAgentProvider} takes it: a slug with no row writes nothing, and saying
      // so is what stops a person configuring an identity into existence.
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
          // ⚑ A model already added, apart from letter case, is not added again.
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
    aPersonPicked(provider, pair, at) {
      writeTheList(provider, (held) => ({ ...held, lastPicked: pair }), at)
    },

    keptApiKey(provider) {
      const row = apiKeySql().read.get(provider) as
        { sealed: string; updated_at: number } | undefined
      return row === undefined || row.sealed === ''
        ? null
        : { sealed: row.sealed, setAt: row.updated_at }
    },
    keepSealedApiKey(provider, sealed, at) {
      apiKeySql().write.run(provider, sealed, at)
    },
    forgetApiKey(provider) {
      return apiKeySql().forget.run(provider).changes > 0
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
      // ⛔ **`.changes`, for {@link SessionStore.setAgentProvider}'s reason read backwards**: a slug
      // with no row deletes nothing, and `false` is how this says so.
      //
      // ⚠️ **This statement does NOT decide whether a removal is allowed** — `RuntimeHost.removeAgent`
      // asks `whatHoldsIt` first, so that a person gets a sentence rather than *FOREIGN KEY
      // constraint failed*. ⛔ The `NO ACTION` key that points here is still the last line of
      // defence and its raise is deliberately not caught: a raise that reached a person would be a
      // defect in the door above, and swallowing it here is how it would stay invisible.
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
      // ⛔ **`.changes`, and it is the whole of the *that name is taken* answer** (419's creation
      // door, one table over). `INSERT OR IGNORE` writes nothing for a name that already has a row
      // AND writes nothing for a race it lost — and both of those are the same fact here, because
      // the id is derived from the name: whoever holds the row holds the name.
      // ⛔ **Folded on the way IN as well as on the way out** (524). The column has no CHECK, so
      // this is the only thing that stops a caller writing a word no reader recognises — and the
      // fold's narrow direction means the worst a bad value can do is register a server nobody
      // reaches without a grant.
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
      // ⚠️ **Read back rather than echoed**, which is 339's shape everywhere in this file: a surface
      // draws what the database now says. `undefined` here is unreachable — the INSERT reported a
      // row — and answering null for it is the narrow direction rather than a `!`.
      return row === undefined ? null : externalMcpFrom(row)
    },

    removeExternalMcpServer(serverId) {
      // ⛔ **`.changes` again, and the grants go by CASCADE** — `PRAGMA foreign_keys = ON` is set in
      // `connection.ts`, and `an-external-server-and-the-names-it-may-not-take.test.ts` §2 drives a
      // granted identity through a removal rather than trusting the declaration.
      return externalMcpSql().deleteServer.run(serverId).changes > 0
    },

    externalMcpServersFor(profileSlug) {
      return (
        externalMcpSql().serversUsableBy.all(agentIdentityRowId(profileSlug)) as ExternalMcpRow[]
      ).map(externalMcpFrom)
    },

    grantExternalMcpServer(serverName, profileSlugs) {
      // Adds grants and never clears any, unlike `setCapabilities`, which writes a whole set. An
      // agent removed since it was named is skipped and answered as missing, rather than left to the
      // foreign key to refuse.
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
      // ⛔ **Read the RAW columns, not {@link SessionStore.capabilitiesOf}.** Round-tripping through
      // the resolver would write today's defaults into every field the caller did not name, freezing
      // them into the row — a decision nobody made, indistinguishable from one a person did. A field
      // nobody edits stays whatever it was, null included.
      const row = spawnSql().readCapabilities.get(rowId) as CapabilityRow | undefined
      // ⛔ **No row means NO, and it does not mean create one** — see the interface for why that is
      // criterion 12 arriving through the configuration door.
      if (row === undefined) return false
      /**
       * ⛔ **Three answers per field, not two** (355). `undefined` is *this caller does not know
       * about the field* and leaves the column alone; `null` is *use the default* and writes NULL,
       * which is the gesture that makes the surface reversible; anything else is a choice.
       *
       * ⚑ **A `Record<CapabilityKey, …>`, so the NEXT capability is a compile error here** — writing
       * a new SHAPE into a column is real work and this is where somebody has to do it. What is no
       * longer anybody's work is the ORDER: the `.run()` below reads {@link CAPABILITY_FIELDS}, so
       * an argument can no longer land in the wrong column's `?`.
       */
      const written: Record<CapabilityKey, string | number | null> = {
        maxDepth: edit.maxDepth === undefined ? row.max_depth : edit.maxDepth,
        canMessage: edit.canMessage === undefined ? row.can_message : edit.canMessage,
        // ⚑ **A word, written exactly as the `choice` fields around it are** (553) — HO-008 §3's
        // promise: a capability whose editor already exists costs this writer one line and costs
        // `CapabilitiesSheet.vue` nothing at all.
        canAssignWork: edit.canAssignWork === undefined ? row.can_assign_work : edit.canAssignWork,
        canCreateAgents:
          edit.canCreateAgents === undefined ? row.can_create_agents : edit.canCreateAgents,
        canWriteRules: edit.canWriteRules === undefined ? row.can_write_rules : edit.canWriteRules,
      }
      /**
       * 🔴 **516 · the capability columns and the external-server grants commit TOGETHER, or
       * neither does** (`507` §5).
       *
       * ⛔ **One transaction, because the sheet has one Save button.** Two writes behind one press
       * can half-succeed, and the surface would then have to draw a state that is neither saved nor
       * unsaved — which is the argument `CapabilitiesSheet` already makes for keeping the PROVIDER
       * choice out of Save, arriving at the opposite conclusion for a different reason: a provider
       * is its own gesture, and this is part of the same one.
       *
       * ⚠️ **`undefined` leaves the grants ALONE**, which is `CapabilityEdit`'s three-answer rule
       * one argument over: a caller that does not know about external servers must not clear them.
       * ⛔ An EMPTY array is a person unticking every box and writes the clear — the two are
       * different intents and the type distinguishes them.
       *
       * ⚑ **The whole set is rewritten rather than diffed**, because the wire carries the whole set:
       * see {@link externalMcpSql}'s `clearGrantsOf`.
       */
      db.transaction(() => {
        spawnSql().writeCapabilities.run(
          ...CAPABILITY_FIELDS.map((field) => written[field.key]),
          rowId,
        )
        if (externalMcpServerIds === undefined) return
        externalMcpSql().clearGrantsOf.run(rowId)
        const at = now()
        for (const serverId of new Set(externalMcpServerIds)) {
          // ⛔ **A server id this app does not hold a row for writes NOTHING**, and the refusal is
          // the FOREIGN KEY rather than a check here — which is the same shape `no-such-profile`
          // has at give: a name nobody registered is not a grant to make. ⚠️ The id is
          // derived from the two names, so the row is looked up to spell it; a payload naming a
          // server that has since been removed finds none and is skipped rather than throwing,
          // because a save must not fail over a row somebody else deleted while the sheet was open.
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
      // ⛔ **`undefined` is `false`.** No row is not *"the switch has not been thrown"*; it is *"this
      // database cannot tell me"*, and the safe reading of that is off. See {@link appPolicy}.
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
      // ⛔ **Exact match, and everything else is `'ask'`** — NULL, a missing row, and a word this
      // build does not know all land here together. The column carries no CHECK, so this line IS
      // the vocabulary, and it closes towards the mode that still asks.
      return row?.default_approval_mode === 'auto' ? 'auto' : 'ask'
    },

    setDefaultApprovalMode(mode) {
      // 🔴 **No fold on the way IN, and `500`'s own mutation row is what removed it.** ⛔ The first
      // draft wrote `mode === 'auto' ? 'auto' : 'ask'` here *"so the write and the read fold the
      // same way"* — and the row that breaks that fold SURVIVED, because `mode` is already one of
      // the two words: the wire is a `z.enum`, this signature is the union, and every caller is
      // this app's own code. ⚠️ **A line no mutation can kill is a line carrying no rule.**
      // ⚑ **The READ's fold is the one that matters and it stays**, because a ROW can hold a word
      // no caller ever passed — an older build, a hand edit, a column with no CHECK.
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
      // ⚑ 727 · R87 — …or the row whose launch asked for this id (see the interface).
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
        // ⚠️ **A ref this cannot read is `null`, not a refusal.** `toResumable` drops the whole row
        // when the ref will not parse, because resume has nothing to reattach from; a session that
        // is RUNNING has its ref on the live handle, and losing the row over an unreadable column
        // would take the profile and the mode with it.
        ref: row.external_ref === null ? null : safeSessionRef(row.external_ref),
        model: row.model,
        reasoningEffort: row.reasoning_effort,
      }
    },

    workflowOutputPath(sessionId, taskId, unread) {
      // ⚑ 697: LAST wins among READABLE rows, so a torn row newer than the answer may have held a
      // later output — counted; with no answer, every torn row may have held this one.
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
      // ⚑ Every torn run row: any of them may have announced one more agent of this run.
      for (const torn of selectTornRuns.all(sessionId, generation) as { ordinal: number }[]) {
        noteUnreadRow(sessionId, torn.ordinal, unread?.in(sessionId))
      }
      return rows.map((row) => row.agentId)
    },

    reportedSubAgent(sessionId, agentId, unread) {
      // The same guard `workflowAgentTask` carries: an empty id is not a question, and asking it
      // would compare `''` against every `sub_agent` payload in the session.
      if (agentId === '') return false
      // ⚑ A `yes` is proven by a readable row and no torn row can take it back, so a hit counts
      // nothing and ends the walk; a `no` is only as good as the rows that could be read, so every
      // torn `sub_agent` row is counted beside it.
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
      // ⚑ A row that will not parse is passed over for the next older one, as `eventsFrom` passes
      // over it for the next newer: a hole in the ledger is never read as "none".
      for (let below = before; ;) {
        const rows = (
          type === 'launched'
            ? selectNewestLaunched.all(sessionId, generation, below)
            : type === 'tool_inventory'
              ? selectToolsInForce.all(sessionId, generation, below)
              : selectNewestOfType.all(sessionId, generation, type, from, below)
        ) as EventRow[]
        const row = rows[0]
        // ⚑ The floor: the two indexed statements seek their own rows, and are held to it here.
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
      // ⚑ `LIKE` with the opening as a bound prefix: its `%` and `_` are escaped.
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
      // ⚠️ A window whose rows ALL fail to decode must not come back empty. Rows that will not parse
      // are skipped here exactly as `events()` skips them — a transcript with a hole is honest — but
      // a caller pulling windows until one comes back empty would read that as the end of the
      // ledger and stop, turning a run of corrupt rows into a silently truncated export. So the
      // scan carries on past them and only a genuine end of rows returns nothing. The alternative
      // was to make every caller carry a second "how far did you scan" value, which is the same
      // invariant stated in more places and free to be forgotten in one of them.
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

    turnWindow(sessionId, options) {
      const generation = activeGeneration(sessionId)
      const turns = Math.max(1, Math.floor(options.turns))
      const maxEvents = Math.max(1, Math.floor(options.maxEvents))
      // Exclusive upper bound. Absent means the end of the ledger, and `+1` is what makes the last
      // event fall inside a strictly-less-than range rather than just outside it.
      const before =
        options.before ??
        ((selectMaxOrdinal.get(sessionId, generation) as { max_ordinal: number | null } | undefined)
          ?.max_ordinal ?? -1) + 1

      // The floor first, because it OVERRIDES the turn boundary rather than competing with it: a
      // page may be shorter than `turns` turns, never longer than `maxEvents` entries.
      //
      // `OFFSET` is a walk, and here that is fine and deliberate — it is bounded by `maxEvents`,
      // so it scans one page's worth of index entries, not one session's. That is the distinction
      // `eventsFrom` is avoiding when it refuses OFFSET: there the offset grows with how far into
      // the session you are, here it is a constant.
      const floorRow = selectEventFloor.get(sessionId, generation, before, maxEvents - 1) as
        { ordinal: number } | undefined
      const eventFloor = floorRow?.ordinal ?? 0

      const starts = selectTurnStarts.all(sessionId, generation, before, turns) as {
        ordinal: number
      }[]

      // Descending, so overwriting on each qualifying row leaves the OLDEST boundary that still
      // fits under the floor — the most turns we can honestly show.
      let from = eventFloor
      let cutAtTurn = false
      // FEWER boundaries than asked for means there are no more turns below: we have reached the
      // start of the conversation, and "the last twelve turns" of a one-turn session is that whole
      // session. Cutting at the first `user_turn` anyway would drop the events that PRECEDE it —
      // the `session` and `status` that open every recording — and leave `hasOlder` true so the
      // reader could scroll back to find two lifecycle notices and nothing else. Taking everything
      // down to the floor is both cheaper and what the question meant.
      if (starts.length >= turns) {
        for (const row of starts) {
          if (row.ordinal < eventFloor) break
          from = row.ordinal
          cutAtTurn = true
        }
      }

      const hasOlder =
        (selectAnyEventBelow.get(sessionId, generation, from) as { present: number }).present === 1
      // ⚑ **D-035** — only where something precedes the page. A row that cannot be read is skipped
      // as a page row is, and the page then goes without one, as it did before this field.
      // ⛔ **Kept only if its payload says what its column does**: the window folds it ahead of
      // every page, and a row whose two disagree would put anything there.
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
        // Reaching the start of the ledger is as aligned as a page gets: nothing was cut off, so
        // there is no partial turn at the top to warn anyone about.
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
        active: current?.id === row?.turn_id && human.boundedAt === Number.MAX_SAFE_INTEGER
          ? { promptOrdinal: human.answer.promptOrdinal, prompt: human.answer.prompt } : null,
      }
    },

    humanFinalsInWindow(sessionId, from, through) {
      const generation = activeGeneration(sessionId)
      const selected = new Map<number, HumanFinalContext>()
      const byTurn = new Map<string, ReturnType<typeof humanTurnAt>>()
      const rows = finalRowsInHumanWindow.all(sessionId, generation, from, through) as { ordinal: number; turn_id: string | null }[]
      for (const row of rows) {
        if (row.turn_id === null) continue
        let human = byTurn.get(row.turn_id)
        if (human === undefined) {
          const prompt = turnOpeningForHuman.get(sessionId, generation, row.turn_id) as HumanPromptRow | undefined
          human = prompt === undefined ? null : humanTurnAt(sessionId, generation, prompt)
          byTurn.set(row.turn_id, human)
        }
        if (human?.answer.final?.ordinal === row.ordinal) selected.set(row.ordinal, {
          promptOrdinal: human.answer.promptOrdinal, prompt: human.answer.prompt,
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
      startBuilding.run(sessionId, PRE_CONTRACT_NORMALIZER_VERSION, now())
      // Read BACK rather than computed here: the statement above decides the number, and computing
      // it a second time in JS would be a second opinion about the same increment — free to differ
      // from the one on disk if two callers ever interleaved.
      const row = selectGeneration.get(sessionId) as GenerationRow | undefined
      if (row?.building == null) {
        throw new Error(`could not open a generation to build for ${sessionId}`)
      }
      return row.building
    },

    appendGeneration(sessionId, generation, entries) {
      if (entries.length === 0) return
      withWindowWriteFence(connection, () => appendManyTx(sessionId, entries, generation, false))
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
        // Guarded by `building = ?` in the statement itself, so a promotion of a generation nobody
        // opened — a double promote, a stale caller — changes nothing rather than making unreadable
        // rows visible. There is still no half-flipped state to report; what changed in 293 §4 is
        // that the refusal is REPORTED rather than silent, because a caller that cannot see it calls
        // it an import.
        if (flipped.changes === 0) return false
        ledgerWrites.set(sessionId, { ordinal: null, generation })
        // An imported transcript has the user's prompts but NO `turn` events (045), so the last turn
        // of a derived ledger is left open. Closed as `unknown` — the ending is genuinely one we
        // never watched — in the same transaction as the flip, so a promoted projection can never be
        // read with a turn still hanging and its status stuck at `working`.
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
      stopBuilding.run(failure, now(), sessionId, generation)
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
        // ⚑ A card's Cancel stops the turn too, unless it asked no turn to stop (`stopsNothing`).
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
      // ⚑ A turn whose words asked the one before it to stop carries that turn's work too, as the
      // fold reads it: what that one's words named is named here, back along the chain.
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
      // ⛔ **Not the candidate query the launch's own quiet sweep runs, and the difference is the
      // band's guard** (D-016 · commit 6): that sweep must reach work a person gave, left `working`
      // by a crash, and this list never draws it ({@link selectOwnersOfPiecesAConversationGave}).
      // ⚑ Every ledger that could hold a row here is still one both read.
      const holders = selectOwnersOfPiecesAConversationGave.all() as { id: string }[]
      // 🔴 **671 · R18 — ONE set of unread rows for EVERY read this walk makes**: the holders' folds,
      // their wait reads, and the givers' receipts below — so a torn row this queue could not read
      // is COUNTED once rather than raising or vanishing. ⛔ The receipts were the read `671`'s first
      // cut missed (its review): a torn receipt listed work as never told with a count of 0.
      const unread = counted ?? rowsUnreadOnce()
      // ⚑ **One receipts fold per GIVER, memoised across the whole answer** — a giver that handed
      // ten pieces of work to one agent is one ledger read and not ten, and this read runs every
      // five seconds for the life of a window.
      const told = new Map<string, ReadonlySet<string>>()
      const toldAbout = (giver: string): ReadonlySet<string> => {
        const held = told.get(giver)
        if (held !== undefined) return held
        const receipts = stallsToldToSession(giver, unread.in(giver))
        told.set(giver, receipts)
        return receipts
      }
      // ⚑ **603/609 · and ONE wait read per HOLDER, memoised the same way** — the composition asks
      // its lookup once per OPEN row, so an unmemoised one would take three narrow reads per piece
      // on a read that runs every five seconds. ⛔ Keyed by the holder and shared across the whole
      // walk, exactly as `toldAbout` above it is keyed by the giver — {@link oneWaitReadPerHolder}.
      const waiting = oneWaitReadPerHolder(unread)
      const walked = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (sessionId, noteSkip) =>
          // 🔴 **603/609 · COMPOSED, and this is the PERSON's half of `aStallItsGiverCanBeToldOf`'s
          // pair.** ⛔ Its own docblock requires the two readers to be complements and never
          // overlap, so a composition applied to the agent's half alone would break the property it
          // names. ⚑ The predicate needs no new condition: a {@link TaskWait} row carries no cause,
          // so it falls out here exactly as it does at the push — and a piece a person gave falls
          // out whatever stalled it (D-016 · commit 6).
          //
          // ⚠️ **One wait read per HOLDER, and this walk already opens each holder's ledger once**
          // — the cost sentence matters because this read runs every five seconds for the life of a
          // window. ⛔ `selectRoutedRequestEvents` is bounded below by the first routing's ordinal,
          // which is NULL for a conversation that never asked anything, and the giver's read is
          // gated the same way: no `work` row naming this conversation as giver means one indexed
          // lookup and nothing folded.
          composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).filter(
            // ⛔ **The fold decides and the candidate query does not** — `piecesGivenBy`'s own
            // rule. A `NOT EXISTS` over the receipts would be `stallsToldToSession` written a
            // second time in SQL, free to disagree with the push that reads it.
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
            // ⛔ **Null LAST, on both sides, and never through an arithmetic default** —
            // `byBlockedSince`'s own lines, because two lists a person reads in one panel may not
            // sort an unknown two different ways.
            if (left.stalledAt === null) return 1
            if (right.stalledAt === null) return -1
            return left.stalledAt - right.stalledAt
          }
          // ⚑ **Total, so the band does not re-order itself between two looks** — two stalls can
          // share a millisecond, and the piece id is the only field that cannot.
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
      // ⚑ The same candidates, receipts and composition as the walk above, with the receipt asked
      // the other way, so the two lists never share a piece.
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
      // ⚑ Oldest stall first, then by piece, so a look never re-orders it; a stall always has its
      // moment, and one without would sort last, as the walk above sorts it.
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
      // ⚑ **The stall band's candidates** — the fold enters this wait only over a piece a
      // conversation gave ({@link selectOwnersOfPiecesAConversationGave}).
      const holders = selectOwnersOfPiecesAConversationGave.all() as { id: string }[]
      const unread = counted ?? rowsUnreadOnce()
      // ⚑ **One wait read per holder, and only for a holder with a row in the wait** — the
      // composition asks its lookup for the rows it is handed, and nearly every holder hands none.
      const itsWaits = oneWaitReadPerHolder(unread)
      const walked = walkLedgers(
        'every-conversation-that-was-given-work',
        holders,
        (sessionId, noteSkip) =>
          // ⚑ **Composed** — a more specific wait (an answer it is owed, a card a person owes, a
          // child of its own) is said instead, and such a row is not the person's to answer here.
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
          // ⚑ **Total**, for the stall walk's reason: the piece id is the one field two rows
          // cannot share.
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
          // ⚑ **A wall the sign-in before reached is not this sign-in's** — left out before the fold:
          // one recorded before the change, and one recorded after it by a life that began before
          // it, whose turn ran on the login before.
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
        // ⛔ **Folded HERE and not in the window** (533 §2.3). ⚠️ The fold needs the whole
        // population — *is there a `stopped` for this provider* is a question about every row at
        // once — and a window that folded a list it had been handed already folded would be a
        // second answer to *what is one wall*.
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
      // A message is still held unless an ending names it, or an ending too torn to name one
      // came after it.
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
        // ⚑ **D-016 · the piece, bounded as `boundPieceNamed` bounds a turn's**: an id this app could
        // have minted, a label only beside it, and the new-brief mark only beside a piece.
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
            // ⚑ **D-016 · commit 6 · R4 — what the held words drive, bounded as `boundTheDrive`
            // bounds it** — absent, they drive every open piece.
            ...(isAStoredId(stored.drives) ? { drives: stored.drives } : {}),
            // ⚑ **F088 · and the piece they name, bounded the same way** — absent, the sender line
            // names none.
            ...(isAStoredId(stored.about) ? { about: stored.about } : {}),
            // ⚑ **The question a held question's notice asks** — a provider's request id is not
            // one this app minted, so each half is read as any non-empty string.
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
      // ⚑ **The same candidate set the sweep walks**, so a question this store would escalate and a
      // question it reports back cannot come from two different populations.
      const candidates = selectSessionsThatRouted.all() as { id: string }[]
      // 🔴 **453 · and the candidate set is now REPORTED** — see {@link walkLedgers}. ⛔ Without it
      // `[]` from this reader and `[]` from `NULL_SESSION_STORE` were the same bytes, and *"Nothing
      // is waiting on you"* was drawn from both.
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
          // ⛔ **The REFUSED arm is excluded here since `403`, and it is not redundant with
          // the deadline's own skip** (it was `because === null` until `611` gave the destination
          // three named arms, and the skip itself went with the clock at `612`). ⚑ That skip was
          // what stopped a permission being ESCALATED; this is what stops one being READ back as
          // escalated, and only this half survives — which is the half that matters now, because
          // the rows it guards against are the ones a ledger already holds. ⚠️ The reachable
          // path is `396 §3`'s: a request id repeats across a resume, `deriveRoutedRequests` resolves
          // a `request_escalated` through `everSeen`, which points at the LATEST row that id opened —
          // so a stamp computed for a travelling question can land on a permission-shaped row raised
          // later under the same id. ⛔ Without this the same request is in BOTH populations, the
          // person's count is one too high, and the row is drawn as something a parent might still
          // answer. ⚑ Nothing is dropped: `routedRequestsOf` and `permissionShaped` still see it.
          .filter(
            (request) =>
              REQUEST_IS_OPEN[request.state] &&
              // 🔴 **611 · TWO ways a question is a person's, and the deadline is only one of
              // them** (HO-088 §2, HO-090 §4). ⛔ An asker that addressed its question to a person
              // was never going to be escalated — nothing escalates anything since `612` — so a
              // reader that admitted only `escalatedAt !== null` would leave it in NO population
              // at all: not here, not in `decisionsAwaitingAPerson`, which selects on the refusal.
              // ⚑ **That is the hole `HO-090` §4's *same queue item* names**, and this is where
              // the two entrances become one row.
              (request.escalatedAt !== null || request.went.is === 'the-person-the-asker-named') &&
              // ⛔ **The refused arm stays out, and the reason is unchanged** — see the paragraph
              // above: it belongs to `decisionsAwaitingAPerson`, and a request in both populations
              // is counted twice in front of a person.
              request.went.is !== 'the-person-the-channel-left-it-with',
          )
          // ⚑ **611 · sorted by the moment it BECAME a person's**, which is the deadline's stamp
          // for an escalation and the routing's own `at` for an addressed one. ⛔ `escalatedAt ?? 0`
          // put every addressed question at the head of the queue for ever, ordered by nothing.
          .sort(
            // ⚠️ **`?? left.at` is a BUG GUARD and not a fallback anything reaches** — the filter
            // above admits only rows with a stamp or with `to: 'a-person'`, which is exactly
            // {@link aPersonsSince}'s non-null condition, and TypeScript cannot see a filter
            // through a function boundary. ⛔ It answers with the row's own routing time rather
            // than with `0`, so a row that somehow arrived here sorts by when it happened instead
            // of jumping to the head of a person's queue for ever.
            (left, right) => (aPersonsSince(left) ?? left.at) - (aPersonsSince(right) ?? right.at),
          ),
      }
    },

    decisionsAwaitingAPerson(unread) {
      // ⚑ **The same candidate SET as `questionsAPersonMustAnswer`, and a second run of the same query.**
      // ⚠️ **Not one query serving both**, and saying so because the first draft of this comment
      // claimed it was: the two readers are separate by design, so a poll that asks for both walks
      // every ledger that has ever routed a request twice. ⛔ That cost is real and is filed as a
      // finding rather than hidden here — see `403`'s response. What the shared query DOES buy is
      // that neither population can be drawn from a set of ledgers the other never looked at.
      const candidates = selectSessionsThatRouted.all() as { id: string }[]
      // ⚑ **453 · the SAME walk word as the reader above**, because it is the same candidate query
      // over the same event type — see {@link LEDGER_WALK_KINDS}. ⛔ A second word for a second reader of
      // one population would be a distinction the SQL does not make.
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
          // ⛔ **Oldest FIRST, by the routing's own stamp** — `questionsAPersonMustAnswer` sorts by the
          // moment a row became a person's, and for these that moment is when it was routed. The two
          // lists are therefore ordered by the same fact under two names, which is what lets a
          // surface draw them together without the order meaning two things.
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
      // ⚑ **One indexed probe per level**, from the root down — the label's own numbers, so no
      // walk back up is needed to spell it.
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
      // ⛔ **A root only**: a given piece's lines are read with its life, by its fold
      // (`piecesOwnedBy`). ⚑ D-026 · a kept file's piece is titled by {@link titleNow}, the one line
      // that decides the fold's title, because a file list folds no ledger.
      if (row === undefined || row.parent_id !== null) return { title: null, statusLine: null }
      const generation = activeGeneration(row.owner_session_id)
      const statusSet = newestLineAbout(row, generation, 'work_status_set')
      return {
        title: titleNow(row, generation),
        // ⚠️ **A row that does not say what it should reads as nothing** — {@link titleNow}'s
        // rule, for the status line.
        statusLine:
          typeof statusSet?.line === 'string' &&
          typeof statusSet.by === 'string' &&
          typeof statusSet.at === 'number'
            ? {
                text: statusSet.line,
                by: statusSet.by,
                at: statusSet.at,
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
          { payload: string; created_at: number } | undefined
        if (found === undefined) return { kind: 'absent' as const }
        const payload = aStoredObject(found.payload)
        if (payload?.piece !== root || payload.type !== type) return { kind: 'unread' as const }
        return { kind: 'present' as const, payload, at: found.created_at }
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
      // ⚑ **A conversation that owns a root goes by it here too** — a piece it took on for its
      // person hangs under it, and so does every piece it gave.
      const root = theRootThatNames(conversation, generation)
      if (root !== null) return root
      // ⚑ **Its own piece on that piece's chain** — the piece itself when it holds it, else the
      // nearest above it that it holds (`pieceOfItsChainHeldBy`'s walk, `chainUp`).
      let mine: WorkDbRow | undefined
      try {
        const row = workSql().byId.get(piece) as WorkDbRow | undefined
        mine =
          row === undefined
            ? undefined
            : chainUp(row).find((one) => one.owner_session_id === conversation)
      } catch (error) {
        // ⚠️ **A chain this database cannot walk names it as it stands now** — a name is never a
        // door (D-017 · R8).
        console.warn(
          `session store could not walk up from ${piece} for ${conversation}: ${error instanceof Error ? error.message : String(error)}`,
        )
        mine = undefined
      }
      // ⚑ **None on the chain**: nothing in the sentence's piece is its own, so it goes by its name now.
      if (mine === undefined) {
        return theWorkThatNamesItAmong(piecesForAName(conversation, generation, unread))
      }
      // ⚑ **That piece, by its label and the title it stands under now** — ⛔ never marked with how
      // it ended, nor with how many more it holds: the sentence is about this one piece, and says
      // what became of it itself (*"is waiting on an answer"*, a question's *answered*).
      return { label: workRowWalked(mine).label, title: titleNow(mine, generation) }
    },

    childrenOf(piece) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      if (row === undefined) return []
      // ⚑ **The parent's numbers once**, and each child's label is them plus its own number.
      const above = [...chainUp(row)].reverse().map((each) => each.number)
      return (workSql().children.all(piece) as WorkDbRow[]).map((child) =>
        workRowFrom(child, [...above, child.number]),
      )
    },

    depthOf(piece) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      // ⛔ **A piece this database does not hold is refused, not placed at the root**: the rail
      // that asks has already found the piece, so an unknown id here is a caller's defect, and
      // answering `0` would be the most permissive number there is.
      if (row === undefined) throw new Error(`no piece ${piece} in this database`)
      // 🔴 **D-016 · commit 6 · counted from the nearest piece up its chain that a PERSON gave** — a
      // root, or work its owner took on for them — so a conversation's pieces all sit at its chain's
      // depth, the one it is told (spec D23): only a conversation's parent gives it work, and work a
      // person gave is 0 wherever it hangs. ⚑ Always found: a chain ends in a root, and a person
      // gave every root (`work_a_root_is_given_by_a_person_ck`).
      return chainUp(row).findIndex((one) => one.given_by_session_id === null)
    },

    pieceOfItsChainHeldBy(piece, owner) {
      try {
        const row = workSql().byId.get(piece) as WorkDbRow | undefined
        if (row === undefined) return null
        // ⚑ **The lowest of its chain that `owner` holds** — the piece itself when it is `owner`'s,
        // else the first piece above it that is.
        return chainUp(row).find((one) => one.owner_session_id === owner)?.id ?? null
      } catch (error) {
        // ⚠️ **A chain this database cannot walk answers `null`**, as one holding none of `owner`'s
        // pieces does — `chainUp`'s two hand-edited shapes — and the walk is warned.
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
      // ⚑ **Each holder folded once, through the naming memo** — and only the holders of these. ⚑ A
      // ledger whose fold throws folds to nothing there, warned and noted (D-017 · R8).
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
      // ⚠️ Read as `unknown` and CHECKED — a ledger written by another build can hold anything, and a
      // row that is not a turn is noted as one this read cannot speak for.
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
      // ⚑ **Named as {@link filesKept} names them**, and only these: the order is the page's own.
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
      // Rows read inside a transaction may yet be rolled back, so they are not kept past this read;
      // nor is anything after a read that failed halfway.
      const insideATransaction = db.inTransaction
      try {
        keptDigestRows(from)
      } catch (error) {
        forgetTheDigestRows()
        throw error
      }
      keepTheDigestRowsAWhile()
      // ⚑ **The count is the candidate set, taken before a single row is folded** — the forest's
      // own count, because the two read the same placed conversations.
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
        // ⚑ **466 · the word is the digest's own** — see `LEDGER_WALK_KINDS`. ⛔ The forest's word
        // promises *"no window"*, and this read is one.
        walk: 'one-window-over-every-agents-conversation',
        ledgers,
        rowsUnread,
      }
    },

    conversationsHeldByNoAgent() {
      return (countConversationsHeldByNoAgent.get() as { n: number }).n
    },

    placedConversations(hidden = []) {
      const placed = (countPlacedConversations.get() as { n: number }).n
      if (hidden.length === 0) return placed
      return placed - (countPlacedAmong.get(JSON.stringify(hidden)) as { n: number }).n
    },

    everyPlacedConversation(limit, hidden = []) {
      // The hidden are left out after the read, which reads as many more as there are of them.
      const hiding = new Set(hidden)
      const placed = (selectEveryPlacedConversation.all(limit + hiding.size) as ForestSessionRow[])
        .filter((row) => !hiding.has(row.id))
        .slice(0, limit)
      // 🔴 **The DRAWN set, built before the fold and from the rows this read actually returned.**
      // ⛔ It is what tells `a-conversation` from `a-conversation-this-reading-did-not-draw`, and
      // it must be the query's own output rather than a second `SELECT id` — a set read separately
      // could disagree with the rows past the bound, and then a node would claim a parent this
      // very answer does not contain.
      const drawn = new Set(placed.map((row) => row.id))
      // ⚑ **664 · one wait read per HOLDER for the whole forest** — {@link oneWaitReadPerHolder}.
      // 🔴 **671 · R18 — and the forest's ONE set of unread rows**, so a torn row a wait read met
      // is counted into `nodes.rowsUnread` once and the forest still ANSWERS.
      const unread = rowsUnreadOnce()
      const waiting = oneWaitReadPerHolder(unread)
      // ⚑ **D-016 · each giver's identity, read once for the whole forest** — a piece carries its
      // giver's conversation and not its identity, so the edge's `fromIdentity` is read here.
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
              // ⛔ **The IDENTITY's slug and never `provider_session.profile_id`** — the directory
              // name keeps the caller's spelling verbatim and this one is folded: it is
              // `agent_identity.slug`, under `agent_identity_slug_folded_ck`. ⚠️ Until D-016 it was
              // the binding's `agent_profile.slug`, folded by construction only. ⚑ It is what
              // `agentName` joins on.
              identity: row.profile_slug,
              provider: row.provider as Provider,
              // ⚑ **The column, cast as every other row shape in this file casts it** — the CHECK is
              // what closes the vocabulary, and a fold here would be a second opinion about it.
              status: row.status as SessionStatus,
              startedAt: row.created_at,
              updatedAt: row.updated_at,
            },
            // 🔴 **Each drawn conversation's OWN ledger, folded for the pieces it OWNS** —
            // `piecesOfSession`, with the walk's skip counter — so folding per owner reaches every
            // piece exactly once, in the one ledger `derivePieces` is scoped to. ⛔ Never a root
            // (D-016 · R1): a conversation's root shows through the conversation itself.
            //
            // 🔴 **664 · and COMPOSED, as the giver's own drawer is** (`D32`, HO-091 §1), so a piece
            // whose owner a person owes an answer reads `waiting-on-a-person` here as it does in the
            // giver's drawer. ⚠️ **Cost**: one {@link whatThisConversationIsWaitingOn} per
            // conversation that owns OPEN work, and none for one whose work has all finished — see
            // `theWholeForest`'s price.
            ...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).map(
              (piece) => ({
                node: 'a-task' as const,
                // ⚑ **The owner is this conversation, by construction** — `derivePieces(owner, …)`
                // was handed this id, so nothing folded here can name another. That is what makes
                // the narrow arm on {@link ForestTask.under} sound rather than optimistic.
                under: { is: 'a-conversation' as const, conversation: row.id },
                // 🔴 **The giver gets a WORD and the owner does not** — see
                // {@link ForestTask.givenBy}. ⛔ Same function, same set: a giver past the bound,
                // or one this app never placed, is a conversation this reading did not draw, and
                // the renderer must not be handed a bare id it cannot find. ⚑ A `null` giver is a
                // person (D-016 · commit 6): `the-person`.
                givenBy: underWhat(piece.giver, drawn),
                // ⛔ **Both identities are read HERE and not passed in** — `workThisOneWasGiven`'s
                // rule: a caller cannot name one conversation and hand over another's slug.
                work: workEdge(piece, row.profile_slug, identityOfGiver(piece.giver)),
              }),
            ),
          ]
        },
        unread,
      )
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
      return (selectConversationsHoldingACopyOf.all(requestId) as { id: string }[]).map(
        (row) => row.id,
      )
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
      // ⚑ **676 · a torn routing is warned, counted when asked, and never a candidate** — see
      // `selectSessionsRoutingTo`.
      const sessions = (
        selectSessionsRoutingTo.all(parentSessionId) as { id: string; unreadAt: number | null }[]
      ).filter((candidate) => {
        if (candidate.unreadAt === null) return true
        noteUnreadRow(candidate.id, candidate.unreadAt, unread?.in(candidate.id))
        return false
      })
      // ⛔ **The fold decides, not the predicate that found the ledger** — `piecesGivenBy`'s rule: a
      // candidate ledger is not an answer; every row it produces is checked against the caller
      // before it is returned.
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
      // ⚑ **A ledger walk, and it is the same candidate set {@link piecesGivenBy} uses.** What
      // the walk adds is the two facts that reader cannot state: how many ledgers were opened, and
      // how many rows inside them could not be read. ⛔ `piecesGivenBy` answers an ARRAY, so a
      // caller that hands it no `RowsUnread` has its unparseable rows dropped with only a warning
      // — `453`'s rule is that a list of obligations may not be quietly short, and the work a
      // giver gave out is exactly that.
      //
      // ⚠️ **543 · the candidate set, the fold, the filter and the order moved into
      // {@link walkWorkGivenBy} and NOTHING about this answer moved with them.** A second reader
      // needed the same walk mapped into a different shape, and two copies of one narrowing is how
      // *"what did I hand out"* comes to have two answers.
      return walkWorkGivenBy(sessionId, (piece, candidate) =>
        workGivenOut(piece, candidate.identity),
      )
    },

    workThisOneGaveOut(sessionId) {
      // ⛔ **The owner's identity comes off the CANDIDATE row and never off a second lookup** —
      // `selectOwnersGivenWorkBy` carries it, LEFT-joined, so the ledger a piece was folded from and
      // the identity drawn beside it cannot come from two reads and disagree (508). ⚑ The giver is
      // this conversation, so its identity is read once.
      const giver = identitiesOnce()(sessionId)
      return walkWorkGivenBy(sessionId, (piece, candidate) =>
        workEdge(piece, candidate.identity, giver),
      )
    },

    workThisOneWasGiven(sessionId) {
      // ⚑ **Read here rather than taken as an argument**, so a caller cannot name one conversation
      // and hand over another's slug. ⛔ `null` covers both *this app holds no identity for it* and
      // *this app holds no row for it*, which on THIS field is the same null `agentName` already folds —
      // the distinction that matters is on {@link SpawnEdge}, where a breadcrumb has to point.
      const mine = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined
      const identity = mine?.identity ?? null
      const identityOfGiver = identitiesOnce()
      // ⛔ **ONE ledger — its own — and `ledgers: 1` is a fact about the shape rather than about the
      // workspace.** {@link PieceRow.owner} is the ledger a row was folded from, so the work a
      // conversation was GIVEN is exactly what its own ledger holds. ⚑ The counter is threaded, so a
      // row this app could not parse is counted rather than silently shortening the list.
      //
      // 🔴 **664 · COMPOSED, as the giver's end of the same edge is** (`D32`, HO-091 §1). ⛔ Until
      // `664` this walk handed the receiver's line the RAW fold while {@link workThisOneGaveOut}
      // handed the giver's drawer the composition, so one piece read two states at the two ends of
      // one edge. ⚑ One holder, so {@link oneWaitReadPerHolder} takes at most ONE wait read here,
      // and none when every piece of work this conversation holds has finished.
      // 🔴 **671 · R18 — ONE set of unread rows for the walk and its wait read**, so what the wait
      // read met is counted here — and `ledgers: 1` is still the shape: the wait read's reads are
      // counted in `rowsUnread` and never as ledgers this walk opened.
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
      // 🔴 **Existence is asked BEFORE the walk, and the answer is a different word rather than the
      // same empty list.** ⛔ Answering
      // `every-conversation-this-one-spawned` with no rows for an id this app has never seen would
      // be this store saying *that conversation started nothing* about a conversation it does not
      // hold.
      if (spawnSql().conversationBinding.get(sessionId) === undefined) return noSuchConversation()
      const children = spawnSql().spawnedBy.all(sessionId) as SpawnedSessionRow[]
      return walkLedgers('every-conversation-this-one-spawned', children, (id, _noteSkip, row) => [
        {
          conversation: id,
          identity: row.identity,
          // ⚑ **The column, cast as every other row shape in this file casts it** — the CHECK is
          // what closes the vocabulary, and a second fold here would be a second opinion.
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
      // Events first: `events.turn_id` is `ON DELETE SET NULL`, so taking the turns out from under
      // them would rewrite every row of a generation that is about to be deleted anyway.
      const events = deleteEventGeneration.run(sessionId, generation, limit)
      if (events.changes > 0) return events.changes
      return deleteTurnGeneration.run(sessionId, generation, limit).changes
    },

    deadGenerations(sessionId) {
      const row = selectGeneration.get(sessionId) as GenerationRow | undefined
      if (row === undefined) return []
      // Computed from the RECORD, never scanned out of `events`. `SELECT DISTINCT generation` over a
      // session's rows is an index walk proportional to the conversation, and this runs on every
      // derive — on the 1.53 GB session that is the cost of the thing it is trying to make cheap.
      //
      // ⚠️ **From 0, not from 1 (073, 068 finding 5).** `beginGeneration` hands out 1…`highest`, so
      // "the dead ones are all of them but one" was true of everything this app DERIVES — and false
      // for everything it inherited: the backfill that introduced generations stamped every row it
      // found `generation 0` with `active = 0, highest = 0`, and `importSnapshot` writes a bundle
      // the same way. The first rebuild of such a session promotes generation 1 and the whole old
      // projection stays beside the new one, on a 2.3 GB store, with no enumeration that could ever
      // return it.
      //
      // `active` is what makes starting at zero safe rather than catastrophic, and it is load-
      // bearing in both directions: a migrated session at rest is `active = 0`, so 0 is excluded
      // and its only projection is not deleted out from under it; a build that opened generation 1
      // and then FAILED leaves `active = 0, highest = 1`, so the partial 1 is collected and the 0
      // that is still being read is not. Zero is a real generation here, not a sentinel.
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
        // The column is free text to SQLite; the CHECK guards writes, and this guards reads, so a
        // row from a later version resolves to `unknown` rather than being handed on as a state
        // nothing here knows how to render.
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
          // ⚑ The level REPLACES and an `ended` edge takes one row away (`background_work`'s own
          // rule): the newest stated level, less what was said to end after it — in its newest life.
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
        // Excluded HERE rather than in `toResumable`, so `find()` keeps returning the row: reading
        // and exporting a conversation we cannot reopen must still work.
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
      // Both halves of the partition above, in one list. The reason is computed by the SAME
      // `whyNotResumable` the reopen list uses, so the library can never explain a row differently
      // from the list that refuses to offer it.
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
      // ⚑ The row that says how far the walk went sorts first (no moment), and is no evidence.
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
        // ⚑ The newest generation's copy comes first, and is the one given.
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
      // ⚑ **The same mapper, and that is the whole safety argument for the cheap path** (119). A
      // second row-to-entry description here would be free to drift from the one above, and the
      // surface reading it — a `ReadingPane` opened straight off a refused row — would explain a
      // conversation differently depending on which door it came through.
      return row === undefined ? null : recordedOf(row)
    },
  }
}

/**
 * **What a rescan is allowed to write over a descent we already recorded** (119).
 *
 * Three rules, and the second is the one with a measurement behind it.
 *
 * | | |
 * |---|---|
 * | **1 · fill** | a NULL column takes the live home's answer — the ordinary case, and the whole point |
 * | **2 · ⛔ never erase** | a live answer of *"not a child"* over a recorded descent keeps the recorded one |
 * | **3 · merge, do not replace** | field by field: the live answer wins on every field it ANSWERS, and a field it omits keeps what we recorded |
 *
 * ## Why 2 is not paranoia
 *
 * `111` measured that no single column finds every child — `thread_source` misses 9 legacy rows,
 * `thread_spawn_edges` misses 3 — and `114`/`115` measured the provider's answers getting *weaker*
 * over time: `agent_role` stopped being written around 2026-07-20, and 8 of 8 recent child rollouts
 * carry it explicitly null. A rescan that found a thinner answer and wrote it back would erase what
 * an earlier, richer scan had recorded, permanently, with nowhere left to read it from once the
 * provider file goes. So the column only ever gains.
 *
 * ## Why 3 is a MERGE, chosen rather than fallen into
 *
 * `086`/`104`'s rule is that more truth beats stale truth, so a live answer that has gained a
 * nickname or a parent id must land. Replacement would deliver that and also do rule 2's damage one
 * field at a time — the same `agent_role` that stopped being written would blank a role we hold.
 * Merging is the only reading of "more truth" that never subtracts: it is rule 2, per field.
 *
 * ⚠️ **An empty live descent is not a thin one, it is a full stop.** `{"subagent":{"other":"guardian"}}`
 * — three real rows — says *this is a child and I cannot say whose*. It arrives here as `{}`, and by
 * rule 3 it changes nothing on a row that already knows the parent, which is right: it did not
 * disagree, it declined to answer.
 */
export function mergeDescent(
  stored: ChildDescent | null,
  live: ChildDescent | undefined,
): ChildDescent | null {
  if (!live) return stored
  // ⚠️ **Only the fields the live answer ANSWERS.** A plain `{...stored, ...live}` copies an
  // explicitly-undefined field over a recorded one, which is rule 2 broken by syntax. The
  // provider's own reader builds these with conditional spreads and would never produce one — but
  // this function is the rule, and a rule that holds only for its current caller is not one.
  //
  // ⛔ `Object.fromEntries` and a spread, never `Object.assign` or `merged[key] = …`: both of those
  // go through [[Set]], so a `__proto__` key — which `JSON.parse` really does produce as an own
  // property — would reach `Object.prototype`'s setter instead of landing as data.
  const answered = Object.fromEntries(
    Object.entries(live).filter(([, value]) => value !== undefined),
  ) as ChildDescent
  return stored === null ? answered : { ...stored, ...answered }
}

/**
 * The descent column, back as an object — or null for a row that is not a child (111).
 *
 * ⚠️ **Unreadable JSON reads as "not a child", never as a throw.** This runs over EVERY row on the
 * way to the library, and one malformed cell taking the whole list down would hide every
 * conversation in it — the same rule `providerIdOf` below already follows for a broken ref.
 */
function parseChildDescent(raw: string | null): ChildDescent | null {
  if (raw === null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as ChildDescent) : null
  } catch {
    return null
  }
}

/**
 * The provider's own id for a row, or null when there is none to give.
 *
 * A ref that no longer parses reads as null rather than throwing: this runs over EVERY row, and one
 * unreadable ref taking the whole library down would hide every session in it.
 */
function providerIdOf(row: SessionRow): string | null {
  if (row.external_ref === null) return null
  try {
    return parseSessionRef(row.external_ref).sessionId
  } catch {
    return null
  }
}

/**
 * ⚑ **D-029 · one stored `scheduled_work` level, read back as the host holds one** — each job with
 * when its ledger first listed it (`firstListed`, a JSON object of id → moment).
 *
 * ⚠️ **A job this cannot read back is counted, not dropped** — `dropped` is *rows the level carried
 * that could not be listed*, and a level that understates says so. ⛔ A payload that does not parse
 * throws, and the caller skips that conversation alone.
 */
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

/**
 * One row as the library reads it — the shared body of `recorded()` and `recordedOne()` (119).
 *
 * A free function rather than a closure so it cannot capture anything: the two callers differ only
 * in which rows they select, and everything after the SELECT has to be identical or the shortcut
 * `recordedOne` exists for stops being a shortcut and becomes a second opinion.
 */
/**
 * ⚑ **D-017 · R2 — a recorded conversation a delivery can start**: the row's half of
 * `RuntimeHost.startable` — not one of the person's own, not a bundle, not a sub-agent with no input
 * end, and not one adopted from a provider home. ⚑ One rule, read by the host and by the person's
 * stalled-work walk, so the two stay complements.
 */
export function aRowADeliveryCanStart(row: RecordedSession): boolean {
  return (
    !row.foundInUserHome && !row.restoredFromBundle && row.child === null && row.adoptedAt === null
  )
}

function recordedOf(row: SessionRow): RecordedSession {
  return {
    ...describeRow(row),
    providerSessionId: providerIdOf(row),
    // ⚠️ **`hasTranscript` comes from `describeRow` since 151** — it moved there when the
    // unresumable shape needed it too, and a second `row.has_events` read here would be the same
    // fact derived twice, free to drift from the one the reopen list reads.
    derived: derivedStateOfRow(row),
    createdAt: row.created_at,
    // ⛔ **`whyNoDirectInput` is asked here too, and 118 shipped without it** (review, twice).
    // The comment above promises the library can never explain a row differently from the list
    // that refuses to offer it — and an app-owned adopted CHILD passed both tests here, so the
    // Library said nothing while the reopen list printed a refusal and removed the button. The
    // `ReadingPane` that the refusal's own Read control opens reads this same field, so the
    // destination was silent about why the reader had been sent there.
    unresumableReason: reopenRefusalOf(row),
    neverStarted: row.external_ref === null,
    child: parseChildDescent(row.child_descent),
  }
}

/**
 * 🔴 **Why a reopen will not work, or null when it will — the ONE answer** (504, from 118 review).
 *
 * ⛔ **It was an expression inside {@link recordedOf}.** The library asks it and the reopen list
 * asks its two halves — and the promise `recordedOf`'s own comment makes is that *"the library can
 * never explain a row differently from the list that refuses to offer it"*. ⚑ A second copy of
 * `canReopen(row) ? whyNoDirectInput(row) : whyNotResumable(row)` is a second chance for that to
 * stop being true, which is `214` §1's measurement about `!foundInUserHome(row)` exactly.
 *
 * ⚠️ **The fork is not decorative.** A row that CAN be reopened may still refuse direct input — an
 * app-owned adopted child — and a row that cannot needs the home-or-ref answer instead; asking
 * only one of them is `118`'s defect in each direction.
 */
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
    // ⚑ **Computed once, here, for every shape that leaves this file** (154). Both readers that
    // act on it — the rail's closed list and the library's `origin` — get the same answer from the
    // same call, which is what stops them disagreeing about whose conversation a row is.
    foundInUserHome: foundInUserHome(row),
    // ⛔ **The same discipline for the second provenance** (214 §1). The library turns this into the
    // `restored` origin and the row's chip; nothing downstream re-derives it, so *"where did this
    // come from"* has one answer for every surface that asks.
    restoredFromBundle: restoredFromBundle(row),
    // ⛔ **222 — the ending, on the SAME shape every list already shares.** `220` found three closed
    // conversations described by one word; the reason all three said it is that this function is
    // where a row stops carrying anything about how it stopped. Put here rather than on each list
    // so the rail and the Sessions page physically cannot describe one conversation's ending
    // differently — the same argument the two provenance fields above it make.
    lastEnding: resolveEndReason(row.last_end_reason),
  }
}

/**
 * The provider's name as a person writes it. Two values, and the app has no other providers — a
 * lookup rather than a capitalise so a third one has to be given a name deliberately.
 *
 * ⚠️ **Moved to `shared/runtime-ipc.ts` by 169 and imported back**, because the sweep that put
 * *"Claude's own folder"* into the renderer's prose needed the same two words there. Two tables
 * would be two answers to "what is this program called", on surfaces that name it in the same
 * sentence.
 */

/**
 * 🔴 **The columns a reopen refusal is decided from, and nothing else** (504).
 *
 * ⛔ **A narrow shape rather than {@link SessionRow}**: these seven columns are the whole of what a
 * reopen refusal is decided from, and a reader that does not hold a whole row can still ask.
 *
 * ⚑ **`SessionRow` satisfies it structurally**, so every existing caller is unchanged and the
 * declaration is the CONTRACT: a statement that wants a refusal must select these seven columns,
 * and a predicate that starts reading an eighth stops compiling for the reader that cannot supply
 * it. ⚠️ That is the half a comment could not do — `214` §1's three hand-copied
 * `!foundInUserHome(row)` are the measurement, one level up.
 */
interface ReopenFacts {
  provider: string
  external_ref: string | null
  profile_id: string | null
  adopted_at: number | null
  restored_at: number | null
  child_descent: string | null
  has_events: number
}

/**
 * Why a recorded session cannot be reopened — read off the row, not assumed.
 *
 * ## Explain why this recorded conversation cannot resume
 *
 * ⛔ **It was true and it was jargon.** *"Provider home"* is this repo's word for a directory the
 * app provisions per profile; nothing a user sees anywhere else in the product teaches it, and the
 * sentence it appeared in was the ONLY place a person meets the concept. `086`'s rule cuts both
 * ways here — the reason is the interesting part and must not soften into *"unavailable"* — so
 * these say the same three things in words that carry themselves: **whose the conversation is,
 * that it can still be read, and why a reopen will not work.**
 *
 * ⚠️ **The mechanism is stated, not invented.** A resume starts a provider in the home we
 * provision for the row's profile, and a conversation swept out of the user's own home is not in
 * it — see {@link foundInUserHome}, which is where that was measured. The sentence says exactly
 * that and claims nothing about writing to directories we do not own.
 *
 * ⚑ **`whyNoDirectInput` below was judged against the same bar and LEFT.** Its words are
 * *"another agent drove it, so there is no input end to reopen"* — a fact about this app, in
 * ordinary words, naming no internal concept. It is also the sentence `116`/`118` negotiated down
 * from a claim about provider capabilities nothing here has measured, and rewriting it would put
 * that back in play for a readability problem it does not have.
 */
function whyNotResumable(row: ReopenFacts): string {
  const provider = PROVIDER_NAME[row.provider as Provider]
  // ⛔ **First, because it is the strongest fact about the row** (214 §1, closing 194 M2). A bundle
  // carries the conversation and cannot carry the provider's own copy of it: nothing put a
  // transcript into the home a reopen would start `provider` in, so the attempt would come back
  // "session missing" for a conversation whose every word we are holding. Said in the same three
  // parts 151 asked for — whose it is, that it can still be read, and why a reopen will not work.
  if (restoredFromBundle(row)) {
    // ⚠️ **`has_events` first, because the first clause is a CLAIM.** A bundle can legitimately carry
    // an empty ledger — `writeBundleExport` writes `"ledger": []` without complaint — and telling
    // somebody BroBot has the whole conversation about a row holding none of it is the kind of
    // sentence `086` exists to stop. The second half is true either way and is the part that
    // answers the question.
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
  // ⛔ **A row with no ref is NOT always a row nothing happened in** (163, from `smoke:ui` step 44).
  //
  // The sentence below used to be said about both, and 151's note explaining why — *"a row with no
  // ref is one no turn was recorded for"* — is the assumption that is wrong. The ref arrives when
  // the provider answers the handshake, which for Claude is partway through the FIRST turn: kill the
  // app in between and the ledger holds a `user_turn`, a `working` status and an open turn row,
  // while `external_ref` is still NULL. The app then told the user *"no turn was ever taken in this
  // one"* about a conversation whose own turn table contradicts it, in the one list that exists to
  // explain why something cannot be reopened.
  //
  // ⚑ **086, in the direction that is easy to miss**: never claim more than happened, and never
  // claim something ELSE instead. Both branches below are true of the row they are said about, and
  // the second names the fact that decides it without inventing a cause for it — we do not know
  // whether the app crashed, was killed, or was quit; we know the provider never named this
  // conversation and that something was recorded before that.
  return row.has_events === 0
    ? 'no turn was ever taken in this one, so there is nothing to carry on from'
    : `this one stopped before ${provider} gave it an id, so there is nothing to carry on from`
}

/**
 * A conversation swept out of `~/.claude` or `~/.codex` (046) — adopted, but belonging to no
 * profile of ours.
 *
 * Resume reopens a provider in the app-owned home for the row's profile, so a row from the user's
 * own home has nowhere to be reopened: the transcript resume looks for is not in any home we
 * provision, and the attempt would fail as "session missing" — which reads like data loss for a
 * session whose bytes we are in fact holding. It is reported as unresumable WITH that reason
 * instead, which is both true and useful.
 *
 * Deliberately not a new column: `profile_id` already means "which of our homes it was found in",
 * and null is the answer for a directory we do not own. Adding a second field to say the same thing
 * is the kind of duplicate fact 045 spent a task removing.
 */
function foundInUserHome(row: ReopenFacts): boolean {
  return row.adopted_at !== null && row.profile_id === null
}

/**
 * A conversation **restored from a bundle** (214 §1) — someone else's machine ran it, and we have
 * the document.
 *
 * ⛔ **The second way a row can hold a perfectly good ref with nothing behind it**, and the reason
 * this is its own predicate rather than a widening of {@link foundInUserHome}: both mean *"a reopen
 * would start a provider in a home that does not contain this conversation"*, and they mean it for
 * opposite reasons. One is the user's own file, in their own folder, that we may only read. This is
 * a file that was never on this machine at all. `whyNotResumable` says which, and a shared
 * predicate could only have said one of them.
 *
 * ⚠️ **`194` M2 is the defect it closes**: *"import persists a provider ref without restoring the
 * provider-side referent, then advertises Resume"* — measured before this dispatch wired the door,
 * so opening the door without this would have shipped it.
 */
function restoredFromBundle(row: ReopenFacts): boolean {
  return row.restored_at !== null
}

/**
 * ⛔ **Is there a home a reopen could find this conversation in?** — the one predicate three
 * readers used to spell out for themselves (214 §1).
 *
 * `resumable()`, `unresumable()` and `recordedOf` each carried `!foundInUserHome(row)` written out
 * by hand, and the whole safety argument for the pair is that they are complements: *"the library
 * can never explain a row differently from the list that refuses to offer it"*. Three copies of a
 * condition is three chances for that to stop being true, and adding a second reason to be
 * unreopenable is exactly the change that would have found out — as `194` M2 predicted it would.
 *
 * ⚠️ **Separate from {@link canReopen} because `resumable()` needs the ref anyway.** This answers
 * only the home question; `canReopen` folds in "and the ref still parses", which is `toResumable`'s
 * own verdict and is not free to compute.
 */
function hasSomewhereToReopen(row: ReopenFacts): boolean {
  return !foundInUserHome(row) && !restoredFromBundle(row)
}

/**
 * The complete answer: a home to reopen into, and a ref this build can still read.
 *
 * ⚑ **504 · it asks {@link readableRef} rather than `toResumable`, and the answer is the same
 * one.** ⛔ `toResumable` returns null on exactly two conditions — no ref, or a ref that will not
 * parse — and both are {@link readableRef}'s, so this is the same verdict without building a
 * {@link ResumableSession} to throw away. ⚠️ It is also what lets this take {@link ReopenFacts}:
 * the wide shape was never read for the verdict, only for the object.
 */
function canReopen(row: ReopenFacts): boolean {
  return hasSomewhereToReopen(row) && readableRef(row) !== null
}

/**
 * 🔴 **Where resume would look for this conversation, or null when nothing can** (504, from 172).
 *
 * ⛔ **ONE definition of *the ref this build can still read*, and it had two.** `toResumable`
 * spelled `external_ref === null` and then a `try`/`catch` around {@link safeSessionRef}, and
 * {@link canReopen} asked the same question by constructing a whole row and testing it for null.
 * ⚠️ Two spellings of one fact are two chances for a reader to disagree with the list that offers
 * the button — which is the pairing `214` §1 spent a dispatch making structural.
 */
function readableRef(
  row: Pick<ReopenFacts, 'external_ref'>,
): ReturnType<typeof parseSessionRef> | null {
  return row.external_ref === null ? null : safeSessionRef(row.external_ref)
}

/** The parsed ref, or null when the column holds something this build cannot read (172). */
function safeSessionRef(external: string): ReturnType<typeof parseSessionRef> | null {
  try {
    return parseSessionRef(external)
  } catch {
    return null
  }
}

/**
 * A row as something resume can actually use, or null. A ref that no longer parses
 * makes the row unusable — skipping it is honest, and far better than handing the
 * resume path something it would only fail on later.
 */
function toResumable(row: SessionRow): ResumableSession | null {
  // ⚑ **504 · the one derivation, asked here too** — see {@link readableRef}. ⛔ The `try` is left
  // exactly where it was: what moved out is the question of whether resume has an ADDRESS at all —
  // which {@link canReopen} used to answer by building this whole object and testing it for null —
  // and narrowing a `catch` this dispatch did not measure the reach of is a second change wearing a
  // refactor's clothes.
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
      // 222 — the same read `describeRow` makes for the other two shapes, off the same column.
      lastEnding: resolveEndReason(row.last_end_reason),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

/**
 * **Why this conversation will not take direct input, or null when it will** (118, from `116` §5).
 *
 * A provider child may be recorded while refusing direct input (`canAcceptDirectInput:false`). Do not offer Resume as though it accepted the same messages as a parent conversation.
 *
 * ## Why the test is DESCENT and not the provider's own flag
 *
 * `canAcceptDirectInput` is on `Thread` (`packages/runtime/src/codex/protocol/v2/Thread.ts:90`) and
 * its own doc says why it cannot be the test here: *"`None` means the capability is unavailable,
 * such as for an unloaded stored thread."* Every row in this list is an unloaded stored thread —
 * asking the provider would mean loading each one to draw a list, and the answer for a stored thread
 * is `null` in any case. The durable fact we already hold is the descent, written at adoption
 * because after adoption there is nowhere left to read it from.
 *
 * ## What it does NOT refuse — three rows that look alike
 *
 * | row | answer |
 * |---|---|
 * | app-owned adopted **parent** | ✅ **offered** — `109`'s "a generic resume would be false for both providers" is about children, and `116` sharpened it: an ordinary adopted parent is a different case |
 * | app-owned adopted **child** | ⛔ refused here |
 * | anything from the user's own home | never reaches this function — `foundInUserHome` drops it first, for its own reason |
 *
 * ⚠️ **Descent, not provider.** A `child_descent` is only ever written for a conversation the
 * provider said was spawned by another, and that is the whole fact: this app never held the input
 * end of it, whoever ran it.
 *
 * ⛔ **The sentence says only what is known here, and review is why.** An earlier wording — *"the
 * provider does not accept direct input on a thread it did not start"* — asserted a capability
 * nothing in this repo has measured, generically, for every provider, on a row that prints its own
 * provider two lines above. `116` cites Codex reporting `canAcceptDirectInput:false`, and that is
 * the PM's ground truth rather than this file's; Claude descent discovery is still out, so there is
 * no Claude measurement at all. What IS true of every child, by construction, is that another agent
 * drove it and this app has no input end to reopen — so that is what it says.
 *
 * ⚠️ **It is also the LIBRARY's sentence**, not just this list's: `recorded()` asks the same
 * function, so the two surfaces cannot explain one conversation differently.
 */
function whyNoDirectInput(row: ReopenFacts): string | null {
  if (parseChildDescent(row.child_descent) === null) return null
  return 'a sub-agent conversation — another agent drove it, so it takes no message of its own'
}
