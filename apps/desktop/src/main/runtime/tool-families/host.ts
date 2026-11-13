import type {
  AProfileNames,
  AnswerWithItsStop,
  FactsAQueueCarries,
  InterruptOutcome,
  MessageNowOutcome,
  OutOfReach,
  TheDoorsReach,
} from '../message-records'
import type {
  ActionAsked,
  QuestionRecipient,
  VisibleQuestion,
} from '../../../shared/question-contracts'
import type { AgentCard, AgentsListed, ArchivedListed } from '../agent-directory'
import type { AgentMessageKind, TaskOutcome } from '../../../shared/task-contracts'
import type { AgentModelChoice } from '../../../shared/model-choice-contracts'
import type {
  AgentOwnNotesOutcome,
  AgentRecordReading,
  AgentRulesOutcome,
  CreateAgentOutcome,
  MayCreateAgents,
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
import type { AskOutcome, PassUpOutcome, WithdrawQuestionOutcome } from '../question-rails'
import type { Caller } from '../conversation-caller'
import type { DocumentContent, DocumentForm } from '../../../shared/documents'
import type { Exchange, ReceivedInATurn, TranscriptTurn } from '../../../shared/last-exchange'
import type { FindFilesAsked, FoundFiles } from '../kept-file-search'
import type { GiveOutcome } from '../spawn-rails'
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { MadeByItsProfile, PieceBoard, PieceRecord, WhatAPieceIsToIt } from '../work-records'
import type { MailboxKind } from '../../../shared/conversation-events'
import type { MessageRefusal, MessagingAct } from '../message-rails'
import type { ModelRefusal } from '../model-rails'
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

export interface AgentToolHost {
  readonly themes?: Pick<ThemeStore, 'refresh' | 'snapshot' | 'raw' | 'save' | 'set'>
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
  messageAgentNow(
    sessionId: string,
    text: string,
    by: Caller,
    says: AgentMessageKind,
    facts?: FactsAQueueCarries,
  ): Promise<MessageNowOutcome>
  agentsVisibleTo(by: Caller, me: string | null): AgentsListed
  restoreAsAnAgent(address: string, by: Caller, me: string): RestoredByAnAgent
  archivedVisibleTo(by: Caller, me: string | null): ArchivedListed
  whenItWasArchived(id: string): number | null
  agentCard(id: string, by: Caller, me: string | null): AgentCard | null
  whatOpenedItsLastTurn(
    id: string,
    me: string | null,
  ): { readonly took: ReceivedInATurn | null; readonly readAt: number }
  whyItIsOutOfReach(
    id: string,
    by: Caller,
    me: string | null,
    forAMessage?: boolean,
  ): OutOfReach | null
  theConversationAddressed(
    address: string,
    by: Caller,
    me: string | null,
    reach: TheDoorsReach,
  ): string
  theConversationAProfileNames(
    address: string,
    by: Caller,
    me: string | null,
    forAMessage?: boolean,
  ): AProfileNames
  tookItsPlace(sessionId: string): string | null
  whyWhatIsHeldWaits(sessionId: string, itsStopIsSaid?: boolean): string | null
  profilesVisibleTo(): ProfileReading
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
  maySaveMemory(sessionId: string): boolean
  pieceBoard(sessionId: string): PieceBoard
  answersHeldFor(sessionId: string): ReadonlySet<string>
  pieceRecord(sessionId: string, spelled: string): PieceRecord
  madeByItsProfile(sessionId: string): MadeByItsProfile
  findKeptFiles(asAgent: string, asked: FindFilesAsked): Promise<FoundFiles>
  searchWork?(asAgent: string, input: WorkSearchQuery): Promise<WorkSearchResult>
  searchPastWork?(asAgent: string, words: string): Promise<PastWorkSearchResult>
  whatToCallTheConversation(conversation: string): string
  nameByItsWork(conversation: string): string
  nameByItsWorkUnder(conversation: string, piece: string | null): string
  addressOf(conversation: string): string
  addressOfUnder(conversation: string, piece: string | null): string
  takeBackPiece(input: { readonly piece: string }, by: Caller): Promise<TakeBackOutcome>
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
      interrupt?: boolean
    },
    by: Caller,
  ): Promise<AnswerWithItsStop>
  interruptAgent(id: string, by: Caller): Promise<InterruptOutcome>
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
  mayCreateAgents(me: string): MayCreateAgents
  mayReachAtAll(act: MessagingAct, by: Caller): MessageRefusal | null
  raiseAQuestion(
    input: {
      moveTo?: string
      piece: string | null
      question: string
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
  ): Promise<AskOutcome | { readonly ok: false; readonly resourceRefusal: ResourceRefusal }>
  passQuestionUp(
    input: {
      requestId: string
      who: Exclude<QuestionRecipient, 'an-agent'>
      context: string | null
      askedBy?: string | null
    },
    by: Caller,
  ): Promise<PassUpOutcome>
  withdrawQuestion(input: { requestId: string }, by: Caller): WithdrawQuestionOutcome
  readTranscript(
    target: string,
    reader: string,
    read: { readonly back: number; readonly search: string | null },
  ):
    | { readonly ok: false; readonly refusal: 'not-a-conversation-below-you' }
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
