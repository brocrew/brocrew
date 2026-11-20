import type { SendRecipientState } from '../../../shared/tool-outcome'
import type { PreparedSendFiles, PreparedSendText } from '../send-overflow'
import type {
  AnswerWithItsStop,
  FactsAQueueCarries,
  InterruptOutcome,
  MessageNowOutcome,
  RecordedAgentMessage,
  TheDoorsReach,
} from '../message-records'
import type { ConversationTasksInput, ConversationTasksResult } from '../conversation-tasks'
import type { CompactConversationInput, CompactConversationOutcome } from '../compact-conversation'
import type {
  ActionAsked,
  QuestionRecipient,
  VisibleQuestion,
} from '../../../shared/question-contracts'
import type {
  AgentCard,
  AgentsListed,
  ArchivedListed,
  DirectoryPageInput,
} from '../agent-directory'
import type {
  ConversationRenameInput,
  ConversationRenameResult,
  ConversationTitleAuthor,
} from '../../../shared/conversation-title'
import type { AgentMessageKind, PieceRow, TaskOutcome } from '../../../shared/task-contracts'
import type { AgentModelChoice } from '../../../shared/model-choice-contracts'
import type {
  AgentOwnNotesOutcome,
  AgentRecordReading,
  AgentRulesOutcome,
  CreateAgentOutcome,
  McpServerAsked,
  McpServerRequestOutcome,
  ProposeRulesOutcome,
  RestoredByAnAgent,
  TakeBackOutcome,
  TakeOnWorkOutcome,
  UpdateWorkOutcome,
  WaitOnAsked,
} from '../host-split/host-command-contracts'
import type {
  AgentOwnNotesReading,
  OwnNotesReceipt,
  OwnNotesWrite,
} from '../../../shared/own-notes'
import type {
  AgentRulesReading,
  AgentRulesReceipt,
  AgentRulesWrite,
} from '../../../shared/agent-rules'
import type { AskOutcome, WithdrawQuestionOutcome } from '../question-rails'
import type { Caller } from '../conversation-caller'
import type { DocumentContent, DocumentForm } from '../../../shared/documents'
import type { Exchange, ReceivedInATurn, TranscriptTurn } from '../../../shared/last-exchange'
import type { FindFilesAsked, FoundFiles } from '../kept-file-search'
import type { GiveOutcome } from '../spawn-rails'
import type { HandedPath } from '../../../shared/attachment-contracts'
import type {
  MadeByItsProfile,
  PieceBoard,
  PieceRecord,
  TaskRecordSelection,
  WhatAPieceIsToIt,
} from '../work-records'
import type { MailboxKind } from '../../../shared/conversation-events'
import type { ModelRefusal } from '../../connections/model-rails'
import type { NewAgent, QueueOutcome } from '../../../shared/runtime-ipc'
import type { PastWorkSearchResult } from '../../../shared/past-work-search'
import type { ProfileReading } from '../agent-records'
import type { Provider } from '@brobot2/shared'
import type { RefusalFacts } from '../../../shared/refusals'
import type { ReplyOutcome } from '../reply-rails'
import type { ResourceRefusal } from '../../resources/resources'
import type { ResourceRow } from '../../db/session-store'
import type { ToolName } from './catalog'
import type { WorkSearchQuery, WorkSearchResult } from '../../../shared/work-search'
import type { ThemeStore } from '../../themes/store'

export interface AgentStatusRead {
  readonly card: AgentCard
  readonly failures: readonly {
    readonly piece: PieceRow['piece']
    readonly failure: NonNullable<PieceRow['providerTurnFailure']>
  }[]
  readonly questionFailure: NonNullable<PieceRow['providerTurnFailure']> | null
}

export interface AgentToolHost {
  readonly themes?: Pick<ThemeStore, 'refresh' | 'snapshot' | 'raw' | 'save' | 'set'>
  receiptForSend(
    facts: import('../send-receipt').SendFacts,
  ): ReturnType<typeof import('../send-receipt').sendReceipt>
  giveWork(input: unknown, by: Caller): Promise<GiveOutcome>
  takeOnWork(input: unknown, by: Caller): Promise<TakeOnWorkOutcome>
  updateWork(
    input: {
      readonly piece: string | null
      readonly title: string | null
      readonly status: string | null
      readonly on: WaitOnAsked | null
      readonly brief: string | null
      readonly definitionOfDone?: string | null
      readonly close: boolean
      readonly resources: readonly string[]
    },
    by: Caller,
  ): Promise<UpdateWorkOutcome>
  whatAPieceIsTo(sender: string, agent: string, spelled: string): WhatAPieceIsToIt
  readResource(
    resourceId: string,
  ):
    | { ok: true; resource: ResourceRow; form: DocumentForm; content: DocumentContent }
    | { ok: false; refusal: ResourceRefusal }
  queueMessage(
    sessionId: string,
    text: string,
    by: Caller,
    attachments?: readonly HandedPath[],
    kind?: MailboxKind,
    facts?: FactsAQueueCarries,
    says?: AgentMessageKind,
  ): Promise<QueueOutcome>
  holdAgentMessageForStart(
    sessionId: string,
    text: string,
    by: Caller,
    facts: FactsAQueueCarries,
    says: AgentMessageKind,
  ): Promise<RecordedAgentMessage | null> | null
  stateOfARecordedMessage(owner: string, id: string): SendRecipientState
  prepareTextForSend(sender: string, field: string, text: string, piece?: string): PreparedSendText
  prepareFilesForSend(sender: string, paths: readonly string[], piece?: string): PreparedSendFiles
  messageAgentNow(
    sessionId: string,
    text: string,
    by: Caller,
    says: AgentMessageKind,
    facts?: FactsAQueueCarries,
  ): Promise<MessageNowOutcome>
  agentsVisibleTo(by: Caller, me: string | null, input?: DirectoryPageInput): AgentsListed
  restoreAsAnAgent(address: string, by: Caller, me: string): RestoredByAnAgent
  archivedVisibleTo(by: Caller, me: string | null, input?: DirectoryPageInput): ArchivedListed
  whenItWasArchived(id: string): number | null
  agentCard(id: string, by: Caller, me: string | null): AgentCard | null
  agentStatus(id: string, by: Caller, me: string): AgentStatusRead | null
  servicePieceForStatus(owner: string): string | null | undefined
  whatOpenedItsLastTurn(id: string): {
    readonly took: ReceivedInATurn | null
    readonly readAt: number
  }
  messageDestination(address: string): string | null
  theConversationAddressed(
    address: string,
    by: Caller,
    me: string | null,
    reach: TheDoorsReach,
  ): string
  tookItsPlace(sessionId: string): string | null
  whyWhatIsHeldWaits(sessionId: string, itsStopIsSaid?: boolean): string | null
  profilesVisibleTo(after?: string): ProfileReading
  navigationIdentity?(profile: string): { readonly id: string; readonly name: string } | null
  navigationProfileForConversation?(conversation: string): string | null
  agentRecord(profile: string, by: Caller, me: string | null): AgentRecordReading
  replyToParent(
    input: {
      piece: string
      outcome: TaskOutcome
      summary: string
      savedMethod?: string
      resourcePaths: readonly string[]
      resultDocument?: string
      needsUserAction: boolean
    },
    by: Caller,
  ): Promise<ReplyOutcome>
  replyTaskChoice(caller: string): string | undefined
  maySaveMemory(sessionId: string): boolean
  pieceBoard(sessionId: string): PieceBoard
  answersHeldFor(sessionId: string): ReadonlySet<string>
  pieceRecord(sessionId: string, spelled: string, selection?: TaskRecordSelection): PieceRecord
  pieceIdForAddress(spelled: string): string | null
  listConversationTasks(input: ConversationTasksInput): ConversationTasksResult
  madeByItsProfile(sessionId: string): MadeByItsProfile
  findKeptFiles(asAgent: string, asked: FindFilesAsked): Promise<FoundFiles>
  searchWork?(asAgent: string, input: WorkSearchQuery): Promise<WorkSearchResult>
  searchPastWork?(
    asAgent: string,
    words: string,
    profile?: string,
    cursor?: string,
  ): Promise<PastWorkSearchResult>
  whatToCallTheConversation(conversation: string): string
  nameByItsWork(conversation: string): string
  nameByItsWorkUnder(conversation: string, piece: string | null): string
  addressOf(conversation: string): string
  renameConversation(
    input: ConversationRenameInput,
    author: ConversationTitleAuthor,
  ): Promise<ConversationRenameResult>
  takeBackPiece(
    input: { readonly piece: string; readonly reason?: string },
    by: Caller,
  ): Promise<TakeBackOutcome>
  takeBackWhatItsQuestionMadeFalse(
    input: { readonly agent: string; readonly piece: string },
    by: Caller,
  ): void
  answerQuestion(
    input: {
      questionId: string
      answers: readonly { part: string; answer: readonly string[] }[]
      askedBy?: string | null
      cannot?: string | null
      resources?: readonly string[]
      interrupt?: boolean
    },
    by: Caller,
  ): Promise<AnswerWithItsStop>
  interruptAgent(id: string, by: Caller, reason?: string): Promise<InterruptOutcome>
  compactConversation(input: CompactConversationInput): Promise<CompactConversationOutcome>
  questionsListedFor(sessionId: string): {
    readonly questions: readonly VisibleQuestion[]
    readonly rowsUnread: number
    readonly ledgersSkipped?: number
  }
  noteRefusal(sessionId: string, tool: ToolName, refused: RefusalFacts): void
  createAgentFor(
    me: string,
    said: NewAgent,
    by: Caller,
    itsOwnRules: string | null,
    itsDefault: AgentModelChoice | null,
  ): CreateAgentOutcome
  judgeTheDefaultItNames(
    me: string,
    named: Provider | null,
    asked: { readonly model?: string; readonly effort?: string },
  ): Promise<
    | { readonly ok: true; readonly chosen: AgentModelChoice }
    | { readonly ok: false; readonly refusal: ModelRefusal }
  >
  raiseAQuestion(
    input: {
      moveTo?: string
      piece: string | null
      question: string
      resources?: readonly string[]
      options: readonly string[]
      who: QuestionRecipient
      agent: string | null
      action?: ActionAsked
    },
    by: Caller,
  ): Promise<AskOutcome>
  requestAnAction(
    input: {
      readonly piece: string | null
      readonly action: string
      readonly files: readonly string[]
    },
    by: Caller,
  ): Promise<AskOutcome>
  withdrawQuestion(input: { requestId: string }, by: Caller): WithdrawQuestionOutcome
  readTranscript(
    target: string,
    read: { readonly back: number; readonly search: string | null },
  ):
    | { readonly ok: false; readonly refusal: 'no-such-agent' }
    | {
        readonly ok: true
        readonly name: string
        readonly lastExchange: Exchange
        readonly turns: readonly TranscriptTurn[]
        readonly older: boolean
      }
  requestMcpServer(me: string, said: McpServerAsked): McpServerRequestOutcome
  readOwnNotes(
    me: string,
    about: string | undefined,
    by: Caller,
  ): AgentOwnNotesOutcome<AgentOwnNotesReading>
  writeOwnNotes(me: string, said: OwnNotesWrite, by: Caller): AgentOwnNotesOutcome<OwnNotesReceipt>
  readAgentRules(me: string, about: string, by: Caller): AgentRulesOutcome<AgentRulesReading>
  writeAgentRules(
    me: string,
    said: AgentRulesWrite,
    by: Caller,
  ): AgentRulesOutcome<AgentRulesReceipt>
  proposeAgentRules(
    me: string,
    said: {
      readonly about: string
      readonly text: string
      readonly why: string
      readonly relaying: boolean
      readonly expectedVersion?: number
    },
    by: Caller,
  ): ProposeRulesOutcome
}
