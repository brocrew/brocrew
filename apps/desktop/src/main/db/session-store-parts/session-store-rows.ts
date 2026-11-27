import type { GivenInput } from '../../../shared/documents'
import { type RowsUnread, type SkipNote } from '../rows-unread'
import type {
  MailboxKind,
  TheQuestionItAsks,
  TranscriptEvent,
  WorkerRegisteredEvent,
} from '../../../shared/conversation-events'
import type { TurnAuthorship } from '../../../shared/human-answer-contracts'
import type { PieceRow } from '../../../shared/task-contracts'
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { Provider, TurnEnding } from '@brobot2/shared'
import { type SpawnEdge } from '../../../shared/who-called-whom'
import type { ChildDescent } from '../../adopt/discover-sessions'
import { type ResourceRole } from '../../../shared/documents'

export type SpawnedConversation = Omit<SpawnEdge, 'running'>

export interface ConversationBinding {
  /** Always present when this app holds the row — the column is `NOT NULL`. */
  readonly provider: Provider
  readonly identity: string | null
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

export type ResourcePosition = Pick<ResourceRow, 'createdAt' | 'resource'>

export interface KeptFileRow {
  readonly group?: import('../../../shared/work-file-groups').WorkFileGroup
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

export interface KeptFilesFrom {
  readonly olderThan: string | null
  readonly limit: number
}

export interface GivenPiece {
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
  /** New services record this root and their independent birth together. */
  serviceStandingTitle?: string
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
  readonly providerFailureHolder?: string
  readonly asks?: TheQuestionItAsks
  readonly unansweredQuestion?: TheQuestionItAsks
  readonly messageAct?: string
}

export interface AdoptedSessionRecord {
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

export interface SessionSnapshot {
  session: AdoptedSessionRecord
  sourceSessionId?: string
  sourceSessionIds?: readonly string[]
  /** How many of the provider's lines the ledger was read from, as the bundle carried them. */
  derivedThrough: number
  /** The conversation, with the ordinals and times it was exported under. */
  ledger: { ordinal: number; event: TranscriptEvent; at: number }[]
}

export interface RaisedQuestionRow {
  files: string | null
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

export type PieceForAName = Pick<
  PieceRow,
  'piece' | 'label' | 'title' | 'owner' | 'giver' | 'givenAt' | 'state' | 'outcome' | 'endedAt'
>

export type PieceNamingStatus = PieceForAName & Pick<PieceRow, 'statusLine'>

export type PieceHeld = PieceForAName

/** Open work already read for this window snapshot, including its unread-row evidence. */
export interface WindowOpenWork {
  ownedBy(owner: string, noteSkip?: SkipNote): readonly PieceRow[]
  givenBy(giver: string, unread?: RowsUnread): readonly PieceRow[]
}

export interface GivenWorkRow {
  readonly id: string
  readonly identity: string | null
}

export interface BindingRow {
  readonly provider: string
  readonly identity: string | null
}

export interface SpawnedSessionRow {
  readonly id: string
  readonly provider: string
  readonly identity: string | null
}

export interface ForestSessionRow {
  readonly id: string
  readonly profile_slug: string
  readonly provider: string
  readonly status: string
  readonly created_at: number
  readonly updated_at: number
  readonly parent_session_id: string | null
}

export interface WorkDbRow {
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
export const WORK_COLUMNS =
  'id, parent_id, number, owner_session_id, given_by_session_id, title, brief, folder, created_at'

export interface ResourceDbRow {
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
export const RESOURCE_COLUMNS =
  'id, work_id, role, title, summary, name, sha256, bytes, added_by_session_id, created_at'

export interface KeptFileDbRow extends ResourceDbRow {
  readonly added_by_identity: string | null
}
export const KEPT_FILE_COLUMNS = `${RESOURCE_COLUMNS},
  (SELECT identity.slug FROM provider_session s
     JOIN agent_identity identity ON identity.id = s.agent_identity_id
    WHERE s.id = work_resource.added_by_session_id) AS added_by_identity`

export const HELD_UNDER = `WITH RECURSIVE held(id) AS (
           SELECT id FROM work
            WHERE owner_session_id = @holder OR given_by_session_id IN (SELECT value FROM json_each(@givers))
           UNION
           SELECT w.id FROM work w JOIN held h ON w.parent_id = h.id
         )`

export const KEPT_BEFORE = `rowid < coalesce((SELECT rowid FROM work_resource WHERE id = @from), 9223372036854775807)`

export function inLabelOrder(a: readonly number[], b: readonly number[]): number {
  for (let level = 0; level < Math.min(a.length, b.length); level += 1) {
    const apart = (a[level] ?? 0) - (b[level] ?? 0)
    if (apart !== 0) return apart
  }
  return a.length - b.length
}

/** What a session's `derived_generation` row holds, before it is turned into a {@link LedgerStatus}. */
export interface GenerationRow {
  active: number
  normalizer_version: number
  derived_through: number
  building: number | null
  highest: number
  failure: string | null
}

export const MAX_SCHEDULE_EVIDENCE_ROWS = 2_000

export const MAX_SCHEDULE_HISTORY_WALKED = 20_000

/** What {@link SessionStore.scheduleEvidenceRows} gives. */
export interface ScheduleEvidenceRead {
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

export type QueuedPromptProgress =
  'missing' | 'pending' | 'running' | 'turn-ended' | 'not-delivered'
export type ProviderFailureNoticeProgress = QueuedPromptProgress | 'retracted'

/** The open-turn lookup's row — just enough to decide attribution and status. */
export interface OpenTurnRow {
  id: string
  blocked_at: number | null
}

export interface ExchangeRow {
  readonly type: string
  readonly payload: string | null
  readonly ordinal: number
}

export type ProviderFailureEpisode =
  | 'none'
  | 'unknown'
  | {
      readonly generation: number
      readonly terminalOrdinal: number
      readonly turnId: string
      readonly cause: Omit<NonNullable<PieceRow['providerTurnFailure']>, 'turnOrdinal'>
      readonly asks: readonly TheQuestionItAsks[]
    }

export const CLOSED_TURNS_FOR_PROVIDER_FAILURE = 8

export interface ProviderFailureEvidence {
  checkedTurnEndings: number
  exceededPartLimit?: number
}

export interface ClosedTurnRow {
  id: string
  opened_at: number
  closed_at: number
}

export interface AskRow {
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

export type TurnEndReason = TurnEnding

/** How many of a conversation's newest turns are read to learn when a person last wrote. */
export const PERSON_LAST_WROTE_WITHIN_TURNS = 200
