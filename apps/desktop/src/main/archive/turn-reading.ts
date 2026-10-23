import type { AsSentPart, TurnAsSent, WhatTheRecordLeavesOut } from '../../shared/turn-as-sent'
/**
 * 🔴 **W4.164 · F093 R1 — reading one turn out of a provider's own file, a line at a time.**
 *
 * The turn is the message BroBot handed over, found by **the exact text it handed over** — the
 * ledger's `user_turn.sent` (F093 R2), which each provider keeps as it got it: a message's text
 * blocks are that text, character for character, and nothing else is ({@link textOf}). ⚑ Which of
 * the messages with that text it is: each earlier message of this provider conversation (`life`)
 * with the same text takes the first record its own rule finds, in order, and the turn is the next
 * one its rule finds ({@link TurnAsked.before}); a `/clear`, or a new thread, starts again. ⛔ W4.172 ·
 * never by words inside a message: those found a message that only quoted them. On both rules, the
 * saved methods' lines in this app's Codex lead are compared as the ledger keeps them
 * (`codexMessageAsKept`).
 *
 * ⚑ **A turn this app read from the provider's record itself** — a conversation adopted from a
 * provider's home, whose ledger was read from that record — is found by the text its importer took
 * from that record, by the importer's own rule: Claude Code's string content as it is, Codex's message
 * text split from what Codex put around it (`import-claude.ts`, `import-codex.ts`). Exact too.
 *
 * ⚑ **Each provider keeps its turn its own way**:
 *  - **Claude Code**: the message is a `user` record; its reminders and context follow it as
 *    `attachment` records, each with the text it was rendered as (`rendered`) and its role
 *    (`renderedRole`): one in the user's role went at the head of the message. One in the system's
 *    went in the context message after it, unwrapped, on a model that takes one, and at the head of
 *    the message, wrapped, on a model that takes none (Haiku) — which this reader asks of the model
 *    the turn's answer names ({@link TurnReadingOptions.hasAContextMessage}). Until the model's answer.
 *  - **Codex**: a turn runs from `task_started` to `task_complete`; its messages to the model are
 *    `response_item` messages — each content block as sent — up to the model's first output. Its
 *    base prompt is in the file's `session_meta`, in front of every request.
 *
 * ⛔ **A record this build does not know is kept raw**, never dropped, and so is one it knows is
 * sent but cannot render; what the provider keeps for itself (a queue, a cost, a token count) is
 * named and marked not sent.
 */

/** Which turn: the message with this text, after the earlier ones, in the provider conversation `life`. */
export interface TurnAsked {
  /**
   * Which text: the text BroBot handed over for the turn, exactly (`user_turn.sent`), or — for a
   * turn read from this record (`its-own-record`) — the text its importer took from it.
   */
  readonly by: 'handed-over' | 'its-own-record'
  readonly text: string
  /**
   * 🔴 **W4.204 · the earlier messages of this conversation with the same text, in order, each by
   * how it is found** — each takes the first record ITS rule finds, before this turn's is looked for.
   * ⛔ A count of one kind only was wrong: a record read from the provider's own file and one this
   * app handed over can carry the same text, and the file cannot say which is which — so a message
   * handed over after a read one was answered with the read one's record.
   */
  readonly before: readonly TurnAsked['by'][]
  /** The provider's id for the conversation the turn was in; `null` when the ledger names none. */
  readonly life: string | null
}

/**
 * ⚑ **What a reading may ask of this build**: whether a Claude model, as a turn's answer names it,
 * takes a context message — `true`, `false`, or `null`: this build holds no snapshot of it.
 */
export interface TurnReadingOptions {
  readonly hasAContextMessage?: (model: string) => boolean | null
}

/** A reading in progress: fed one line at a time, until it has the turn. */
export interface TurnReading {
  /** One line of the file; `done` once the turn is whole and nothing after it matters. */
  line(text: string): 'more' | 'done'
  /** The turn, or why there is none. */
  answer(): TurnAsSent
}

/** How much of a record this build cannot read is kept for the window: enough to see what it is. */
const RAW_MAX = 20_000

export type Json = Record<string, unknown>

export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A record kept as written — or its first characters, for one too large to carry whole. */
export function kept(raw: unknown): unknown {
  const written = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return written.length <= RAW_MAX ? raw : { cutAt: RAW_MAX, start: written.slice(0, RAW_MAX) }
}

/** A block of a message's content, as sent: a text block's text, or an image named, never read. */
interface Block {
  readonly text: string
  readonly isText: boolean
}

export const TEXT_BLOCKS = new Set(['text', 'input_text', 'output_text'])

/** A message's content, block by block, as sent. */
export function blocksIn(content: unknown): Block[] {
  if (typeof content === 'string') return [{ text: content, isText: true }]
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown): Block[] => {
    if (!isRecord(block)) return []
    const kind = asText(block['type'])
    if (TEXT_BLOCKS.has(kind)) return [{ text: asText(block['text']), isText: true }]
    if (kind === 'image' || kind === 'input_image') return [{ text: '[an image]', isText: false }]
    return []
  })
}

/** The blocks of a message's content, one text per block; an image named, never read. */
export const blocksOf = (content: unknown): string[] => blocksIn(content).map((block) => block.text)

/**
 * 🔴 **The text a message carried, to match against what BroBot handed over** — its text blocks
 * alone, joined as they are rendered; an image beside them is no part of it.
 */
export function textOf(content: unknown): string {
  return blocksIn(content)
    .filter((block) => block.isText)
    .map((block) => block.text)
    .join('\n\n')
}

/** One line of a provider's file, parsed — or kept as text when it is not JSON. */
export function parsed(text: string): Json | { readonly unreadable: string } {
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : { unreadable: text }
  } catch {
    return { unreadable: text }
  }
}

/**
 * ⚑ What a reading holds none of: a system prompt where it read none, and what came after the
 * model's first answer, where every reading stops.
 */
export function whatItLeavesOut(standing: readonly AsSentPart[]): WhatTheRecordLeavesOut[] {
  return [
    ...(standing.length === 0 ? ['the-system-prompt' as const] : []),
    'after-its-first-answer',
  ]
}

/**
 * ⚑ Why a turn is not found, in what is true either way: no message has its text — whether the
 * provider never got it or kept it otherwise.
 */
export function notInTheRecord(provider: string, asked: TurnAsked): string {
  return asked.by === 'handed-over'
    ? `No message in ${provider}’s own record of the conversation has exactly the text this app handed over.`
    : `No message in ${provider}’s own record of the conversation has the text this app read from it.`
}
