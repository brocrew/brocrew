import type { WorkAncestry } from '../../../shared/work-ancestry'
import type { TranscriptState } from './transcript-state-contracts'
import type { HumanFinalContext } from '../../../shared/human-answer-contracts'
import type { TranscriptEvent } from '../../../shared/conversation-events'
import type { ErrorFacts } from '../../../shared/error-facts'
import { startHumanAnswer } from './human-answers'
import { followTheTurnsErrors } from './transcript-parts/notices'
import { itemSeq } from './transcript-parts/lifecycle'
import { acceptWorkAncestry, findCard } from './transcript-parts/cards'
import { foldEvent } from './transcript-parts/events'

export type {
  UserItem,
  ContinuationItem,
  AppNoticeItem,
  WorkReportItem,
  RelayedItem,
  QueuedItem,
  AssistantItem,
  ThinkingItem,
  NoticeItem,
  CompactionItem,
  ResetItem,
  ImageItem,
  UnknownItem,
  MemoryNoteItem,
  MemoryRecallItem,
  MemoryLoadedItem,
  TranscriptItem,
} from './transcript-message-contracts'
export type {
  PermissionRequestEvent,
  UserInputRequestEvent,
  PermissionOutcome,
  NoPositiveBecause,
  ToolItem,
  OutgoingWords,
  QuestionTool,
  OutgoingQuestionPart,
  OutgoingQuestion,
  DetachedWork,
  WorkflowRunCard,
  SubAgentCard,
  SubAgentToolRow,
  PlanItem,
  PermissionItem,
  RoutedAway,
  UserInputItem,
} from './transcript-tool-contracts'
export type {
  BackgroundRegistry,
  CommandRegistry,
  ToolRegistry,
  ScheduleRegistry,
  ChangeLog,
  TranscriptState,
} from './transcript-state-contracts'
export {
  MAX_CARRIED_CHANGE_REPORTS,
  MAX_HELD_DIFF_REPORTS,
  createTranscript,
  markReopened,
  markReadOnly,
  NOTHING_WAITS_FOR_THIS_ANSWER,
  HELD_REQUEST_LET_GO,
  THE_APPS_OWN_WORD,
  markPermissionAnswered,
  markUserInputAnswered,
  markRequestFailed,
  markAnswerRefused,
  isAwaitingAnswer,
  itemKey,
  opensTurn,
} from './transcript-parts/lifecycle'
export {
  REOPENED_ON_A_RENEWED_SIGN_IN,
  REOPENED_FOR_WHAT_WAITED,
  receiptOf,
  toldClause,
} from './transcript-parts/notices'
export {
  isALabel,
  askedQuestionItemIn,
  briefItemIn,
  appendUserMessage,
  appendAppNotice,
} from './transcript-parts/messages'
export { cardHomes, acceptWorkAncestry, everyCard, restoreSubAgent } from './transcript-parts/cards'

/**
 * Fold one event and stamp added rows with its ledger time and ordinal.
 * Mutated rows keep the time they were created with.
 */
export function applyEvent(
  state: TranscriptState,
  event: TranscriptEvent,
  at?: number,
  ordinal?: number,
  humanFinal?: HumanFinalContext | null,
  workAncestry?: WorkAncestry,
  ancestryContext?: readonly import('../../../shared/conversation-events').PersistedEventInfo[],
  errorFacts?: ErrorFacts,
): void {
  if (workAncestry !== undefined) acceptWorkAncestry(state, workAncestry)
  for (const row of workAncestry?.baseline ?? []) {
    if (row.event.type === 'sub_agent' && findCard(state, row.event.agentId) !== undefined) continue
    if (
      row.event.type === 'tool_call' &&
      (state.toolItems[row.event.id] !== undefined || state.cardTools[row.event.id] !== undefined)
    )
      continue
    applyEvent(
      state,
      row.event,
      row.at,
      row.ordinal,
      undefined,
      undefined,
      undefined,
      row.errorFacts,
    )
  }
  for (const row of ancestryContext ?? []) {
    if (
      row.event.type === 'tool_call' &&
      (state.toolItems[row.event.id] !== undefined || state.cardTools[row.event.id] !== undefined)
    )
      continue
    if (
      row.event.type === 'sub_agent' &&
      row.event.phase === 'started' &&
      findCard(state, row.event.agentId) !== undefined
    )
      continue
    applyEvent(
      state,
      row.event,
      row.at,
      row.ordinal,
      undefined,
      undefined,
      undefined,
      row.errorFacts,
    )
  }
  const before = state.seq
  const from = state.items.length
  startHumanAnswer(state.humanAnswers, event, ordinal ?? state.seq)
  foldEvent(state, event, at, ordinal, humanFinal, errorFacts)
  followTheTurnsErrors(state, event, from)
  if ((at === undefined && ordinal === undefined) || state.seq === before) return
  // Sequence identifies new rows even when a confirmed message replaced a streamed row.
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (!item || itemSeq(item.id) <= before) break
    if (at !== undefined) item.at = at
    // Stamp each new row's ledger position in the same walk. See {@link Placed}.
    if (ordinal !== undefined) item.ordinal = ordinal
  }
}
