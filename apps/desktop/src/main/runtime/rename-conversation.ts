import {
  aConversationTitle,
  type ConversationRenameInput,
  type ConversationRenameResult,
  type ConversationTitleAuthor,
  type ConversationTitledEvent,
} from '../../shared/conversation-title'
import type { SessionStore } from '../db/session-store'
import {
  canonicalAddressOf,
  conversationDisplayTitle,
  resolveConversationAddress,
} from './conversation-address'

interface RenameConversationDependencies {
  readonly store: Pick<
    SessionStore,
    | 'workByLabel'
    | 'firstTaskOf'
    | 'latestTaskTitle'
    | 'conversationBinding'
    | 'agentIdentityNameById'
    | 'conversationTitle'
  >
  readonly beforeWriting: (conversation: string) => Promise<void>
  readonly record: (conversation: string, title: ConversationTitledEvent) => void
}

export async function renameConversation(
  input: ConversationRenameInput,
  author: ConversationTitleAuthor,
  { store, beforeWriting, record }: RenameConversationDependencies,
): Promise<ConversationRenameResult> {
  const title = aConversationTitle(input.title)
  if (title === null)
    return {
      ok: false,
      code: 'bad-title',
      reason: 'Not changed: a title is one line of 1 to 200 characters.',
    }
  const conversation = resolveConversationAddress(input.conversation, store)
  const unknown = (): ConversationRenameResult => ({
    ok: false,
    code: 'unknown-conversation',
    reason: `Not changed: no conversation has the address ${input.conversation}. search_work finds conversations.`,
  })
  if (store.conversationBinding(conversation) === null) return unknown()
  await beforeWriting(conversation)
  if (store.conversationBinding(conversation) === null) return unknown()

  const address = canonicalAddressOf(store, conversation)
  const previous = store.conversationTitle(conversation)
  const previousTitle = previous?.title ?? conversationDisplayTitle(store, conversation)
  record(conversation, { type: 'titled', title, author })
  return {
    ok: true,
    conversation,
    address,
    title,
    author,
    previousTitle,
    previousAuthor: previous?.author ?? null,
  }
}
