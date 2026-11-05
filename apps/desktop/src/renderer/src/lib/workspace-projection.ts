import type { StoppedPiece } from '../../../shared/agent-state'
import type {
  AgentIdentity,
  AgentStateMoved,
  ProcessMemory,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import type {
  ConversationWait,
  HeldWork,
  WhatEachConversationIsWaitingOn,
} from '../../../shared/tasks'
import type { TheWholeForest } from '../../../shared/the-whole-forest'
import type { WorkEdge } from '../../../shared/who-called-whom'
import type { ListedConversation } from './conversation-list'
import type { WaitReading } from './conversation-waits'
import type { ProviderBlockFacts } from './provider-limit-status'

/** A running conversation, as the band and the Team page name it. */
export interface RunningConversation {
  readonly sessionId: string
  readonly provider: ResumableSessionInfo['provider']
  readonly state: ListedConversation['state']
}

/** Everything the host's waits reading says of one conversation, kept as one stable object. */
export interface WaitOf {
  /** The three absences, told apart. */
  readonly reading: WaitReading
  /** The one wait for a facet: `undefined` for both absences and for a read saying none. */
  readonly wait: ConversationWait | undefined
  readonly work: HeldWork | undefined
  readonly answerFrom: string | null
  readonly workWith: readonly string[]
  readonly stoppedWork: readonly StoppedPiece[]
  readonly began: { readonly answer: number | null; readonly work: number | null }
}

/** What the projection reads but never writes. */
export interface WorkspaceInputs {
  readonly identities: () => readonly AgentIdentity[] | null
  readonly providerSaid: () => ReadonlyMap<string, ProviderBlockFacts> | undefined
}

/**
 * The window's one owner of workspace metadata. Its ingestion methods are the only writers; every
 * surface reads through its selectors, which return the same object for as long as what it says
 * has not changed.
 */
export interface WorkspaceProjection {
  /** Numbers a list read before either half of it is asked. */
  listAsked(): number
  /** Takes a list read in; `false` when a newer read was asked since, and nothing changes. */
  listAnswered(
    ticket: number,
    resumable: readonly ResumableSessionInfo[],
    unresumable: readonly UnresumableSessionInfo[],
  ): boolean
  /** A list read that did not answer: the last good list stays, with the reason beside it. */
  listRefused(ticket: number, why: string): void
  /** States main pushed since the list was asked. */
  statesMoved(moved: readonly AgentStateMoved[]): void
  /** The waits reading; `null` (a read that did not answer) keeps the last good one. */
  waitsRead(reading: WhatEachConversationIsWaitingOn | null): void
  forestRead(forest: TheWholeForest): void
  /** The process figures; `null` draws none, as a figure is a live process's. */
  memoryRead(held: ProcessMemory | null): void
  /** Back to nobody has looked; a read already in flight is dropped when it lands. */
  reset(): void

  /** The listed conversations, newest first; `null` until the first list read lands. */
  listed(): readonly ListedConversation[] | null
  listError(): string | null
  running(): readonly RunningConversation[] | null
  conversation(id: string): ListedConversation | undefined
  ofIdentity(identity: string): readonly ListedConversation[]
  waits(): WhatEachConversationIsWaitingOn | null
  waitOf(id: string): WaitOf
  forest(): TheWholeForest | null
  /** The open pieces a conversation holds, as the forest names them. */
  piecesHeldBy(id: string): readonly WorkEdge[]
  memoryOf(id: string): number | undefined
  memoryUnmeasured(): string | null
}

export function createWorkspaceProjection(
  inputs: Partial<WorkspaceInputs> = {},
): WorkspaceProjection {
  void inputs
  throw new Error('The workspace projection is not built yet.')
}
