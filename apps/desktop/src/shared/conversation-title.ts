/**
 * A conversation's title: the job it holds ("DEV-100012", "Lisbon trip, March"), kept as an entry in
 * that conversation's own history. The newest entry stands. Each entry records who set it, so an
 * agent can tell when a person named the conversation and leave that title alone.
 *
 * Importing nothing, so main and the renderer read the same rule.
 */

/** The most characters a conversation's title may hold, the same bound as a piece's title. */
export const CONVERSATION_TITLE_CHARS = 200
const LINE_BREAK = /[\r\n\u2028\u2029]/

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

export interface ConversationIdentity {
  readonly conversation: string
  readonly address: string
  readonly title: string
  readonly author: ConversationTitleAuthor | null
}

export const CONVERSATION_IDENTITY_BATCH_SIZE = 15

export interface ConversationIdentityBatchInput {
  readonly sessionIds: readonly string[]
}

export interface ConversationTitleHistoryCursor {
  readonly generation: number
  readonly ordinal: number
}

export interface ConversationTitleHistoryInput {
  readonly sessionId: string
  readonly before?: ConversationTitleHistoryCursor
}

export type ConversationTitleHistory =
  | {
      readonly kind: 'titles'
      readonly titles: readonly (ConversationTitle & { readonly ordinal: number })[]
      readonly rowsUnread: number
      readonly next: ConversationTitleHistoryCursor | null
    }
  | { readonly kind: 'generation-changed' }

export interface ConversationRenameInput {
  readonly conversation: string
  readonly title: string
}

export type ConversationRenameResult =
  | {
      readonly ok: true
      readonly conversation: string
      readonly address: string
      readonly title: string
      readonly author: ConversationTitleAuthor
      readonly previousTitle: string
      readonly previousAuthor: ConversationTitleAuthor | null
    }
  | {
      readonly ok: false
      readonly code: 'bad-title' | 'unknown-conversation'
      readonly reason: string
    }

/** The title trimmed, or `null` unless it is one line of 1 to {@link CONVERSATION_TITLE_CHARS} characters. */
export function aConversationTitle(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > CONVERSATION_TITLE_CHARS) return null
  return LINE_BREAK.test(trimmed) ? null : trimmed
}

/** The first nonblank line the person wrote. The rail decides how much fits on screen. */
export function titleFromOpeningMessage(message: string): string | null {
  const [first = ''] = message.trimStart().split(LINE_BREAK, 1)
  return first.trimEnd() || null
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
