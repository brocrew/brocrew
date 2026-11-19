/**
 * A conversation's title: the job it holds ("DEV-100012", "Lisbon trip, March"), kept as an entry in
 * that conversation's own history. The newest entry stands. Each entry records who set it, so an
 * agent can tell when a person named the conversation and leave that title alone.
 *
 * Importing nothing, so main and the renderer read the same rule.
 */

/** The most characters a conversation's title may hold, the same bound as a piece's title. */
export const CONVERSATION_TITLE_CHARS = 200

/** Who set a title: a person, through a person's own surface, or the agent of a conversation. */
export type ConversationTitleAuthor =
  { readonly kind: 'person' } | { readonly kind: 'agent'; readonly conversation: string }

/** A title set on a conversation, in that conversation's ledger. */
export interface ConversationTitledEvent {
  type: 'titled'
  readonly title: string
  readonly author: ConversationTitleAuthor
}

/** A title as it reads now: the text, who set it and when. */
export interface ConversationTitle {
  readonly title: string
  readonly author: ConversationTitleAuthor
  readonly at: number
}

/** The title trimmed, or `null` unless it is one line of 1 to {@link CONVERSATION_TITLE_CHARS} characters. */
export function aConversationTitle(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > CONVERSATION_TITLE_CHARS) return null
  return /[\r\n\u2028\u2029]/.test(trimmed) ? null : trimmed
}

/** Whether a stored author is one of the two shapes; a conversation id is a non-empty string. */
export function aTitleAuthor(value: unknown): value is ConversationTitleAuthor {
  if (typeof value !== 'object' || value === null) return false
  const author = value as { kind?: unknown; conversation?: unknown }
  if (author.kind === 'person') return Object.keys(author).length === 1
  return (
    author.kind === 'agent' &&
    typeof author.conversation === 'string' &&
    author.conversation.length > 0 &&
    Object.keys(author).length === 2
  )
}
