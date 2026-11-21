import { agentIdentityRowId } from '../db/identity'
import type { ConversationTitle } from '../../shared/conversation-title'
import { profileLabel } from '../../shared/runtime-ipc'

/** What resolving an address reads. */
export interface ConversationAddressReads {
  workByLabel(label: string): { readonly owner: string } | null
}

/**
 * The conversation an address names: a task label names the conversation that owns that task,
 * and anything else (a conversation's own id) is read as written. Following a conversation that
 * took another's place happens at delivery, not here.
 */
export function resolveConversationAddress(
  address: string,
  reads: ConversationAddressReads,
): string {
  return reads.workByLabel(address)?.owner ?? address
}

interface AddressReads {
  firstTaskOf(conversation: string): { readonly label: string } | null
}

export function canonicalAddressOf(
  reads: AddressReads,
  conversation: string,
  service = false,
): string {
  return service ? conversation : (reads.firstTaskOf(conversation)?.label ?? conversation)
}

interface DisplayTitleReads {
  conversationTitle(conversation: string): ConversationTitle | null
  defaultConversationTitle(conversation: string, includeOpening?: boolean): string | null
  conversationBinding(conversation: string): { readonly identity: string | null } | null
  agentIdentityNameById(
    identity: string,
  ): { readonly slug: string; readonly displayName: string | null } | null
}

function conversationDisplayTitle(
  reads: DisplayTitleReads,
  conversation: string,
  service: boolean,
  savedTitle = reads.conversationTitle(conversation),
  includeOpening = false,
): { readonly title: string; readonly profileFallback?: true } {
  if (savedTitle !== null) return { title: savedTitle.title }
  if (!service) {
    const defaultTitle = reads.defaultConversationTitle(conversation, includeOpening)
    if (defaultTitle !== null) return { title: defaultTitle }
  }
  const identity = reads.conversationBinding(conversation)?.identity
  const profile =
    identity == null ? null : reads.agentIdentityNameById(agentIdentityRowId(identity))
  return {
    title: profile?.displayName ?? (profile === null ? 'untitled' : profileLabel(profile.slug)),
    profileFallback: true,
  }
}

export function describeConversation(
  reads: AddressReads & DisplayTitleReads,
  conversation: string,
  service: boolean,
  savedTitle?: ConversationTitle | null,
  includeOpening = false,
): {
  readonly address: string
  readonly title: string
  readonly line: string
  readonly profileFallback?: true
} {
  const address = canonicalAddressOf(reads, conversation, service)
  const resolved = conversationDisplayTitle(
    reads,
    conversation,
    service,
    savedTitle,
    includeOpening,
  )
  return { address, ...resolved, line: conversationLine(address, resolved.title) }
}

export function conversationLine(address: string, title: string): string {
  return `conversation ${address} · ${title}`
}

interface RecordedServiceReads {
  recordedOne(conversation: string): object | null
  parentOf(conversation: string): string | null
  rootOf(conversation: string): object | null
}

export function isRecordedServiceConversation(
  reads: RecordedServiceReads,
  conversation: string,
  root?: object | null,
): boolean {
  return (
    root == null &&
    reads.recordedOne(conversation) !== null &&
    reads.parentOf(conversation) === null &&
    (root === null || reads.rootOf(conversation) === null)
  )
}

export function describeConversationForRead(
  reads: AddressReads & DisplayTitleReads & RecordedServiceReads,
  conversation: string,
  itIsAService = isRecordedServiceConversation(reads, conversation),
  savedTitle?: ConversationTitle | null,
  includeOpening = false,
) {
  return describeConversation(reads, conversation, itIsAService, savedTitle, includeOpening)
}
