import { agentIdentityRowId } from '../db/identity'
import { aConversationTitle, type ConversationTitle } from '../../shared/conversation-title'

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

export function canonicalAddressOf(reads: AddressReads, conversation: string): string {
  return reads.firstTaskOf(conversation)?.label ?? conversation
}

interface DisplayTitleReads {
  conversationTitle(conversation: string): ConversationTitle | null
  latestTaskTitle(conversation: string): string | null
  conversationBinding(conversation: string): { readonly identity: string | null } | null
  agentIdentityNameById(
    identity: string,
  ): { readonly slug: string; readonly displayName: string | null } | null
}

function conversationDisplayTitle(
  reads: DisplayTitleReads,
  conversation: string,
  service: boolean,
): string {
  const title = reads.conversationTitle(conversation)?.title
  if (title !== undefined) return title
  if (!service) {
    const taskTitle = aConversationTitle(reads.latestTaskTitle(conversation))
    if (taskTitle !== null) return taskTitle
  }
  const identity = reads.conversationBinding(conversation)?.identity
  const profile =
    identity == null ? null : reads.agentIdentityNameById(agentIdentityRowId(identity))
  return profile?.displayName ?? profile?.slug ?? 'untitled'
}

export function describeConversation(
  reads: AddressReads & DisplayTitleReads,
  conversation: string,
  service: boolean,
): { readonly address: string; readonly title: string; readonly line: string } {
  const address = service ? conversation : canonicalAddressOf(reads, conversation)
  const title = conversationDisplayTitle(reads, conversation, service)
  return { address, title, line: `conversation ${address} · ${title}` }
}
