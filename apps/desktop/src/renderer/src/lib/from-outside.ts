import type { TranscriptItem } from './transcript'
import { drawsAsACard } from './draws-as-a-card'

/**
 * # 🔴 658 · Whose words a row carries — and so whether it may be drawn as a participant's
 *
 * Draw incoming agent messages as outside cards with sender and recipient names, shifted right. The sender is not a participant in this conversation and does not gain access to the person's input by having its message displayed.
 *
 * ⛔ **The defect is a false claim the LAYOUT made.** A row drawn in the conversation's own column, at
 * the weight of the person's own messages, says *"this speaker is in the room and has read everything
 * above."* ⚠️ Another conversation's agent has read none of it. So this file answers one question per
 * row — *did these words come from a conversation OTHER than this one?* — and the entries that draw
 * such rows (`RelayedEntry`, `WorkReportEntry`, `QueuedMessage`) ask it: shifted right when they did,
 * and in a card when they did OR when the row is about a task.
 *
 * ## ⚑ Derived from the row's KIND and its own fields — never from its text
 *
 * {@link WHOSE_WORDS} classifies every {@link TranscriptItem} kind, and `satisfies` makes a NEW kind
 * a compile error until somebody decides whose words it carries — the classification cannot be
 * silently incomplete ([[an-unenumerated-state-counts-as-success]]). ⚠️ Two kinds are decided per
 * ROW, by {@link fromOutside}, because the same kind carries different voices.
 */

/**
 * Whose words a KIND carries.
 *
 * | value | means |
 * |---|---|
 * | `this-conversation` | the person, or this conversation's own agent and what it did — the two participants |
 * | `another-conversation` | an agent in a DIFFERENT conversation — always from outside |
 * | `the-app` | the app speaking in its own voice (a notice, a go-ahead, a report of a person's decision) |
 * | `shared-memory` | a note in the agent's memory store, which any conversation of that agent may write — no sender, by design |
 * | `depends-on-the-row` | decided by {@link fromOutside}, per row |
 * | `unknown` | a payload this app cannot read |
 */
export type WhoseWords =
  | 'this-conversation'
  | 'another-conversation'
  | 'the-app'
  | 'shared-memory'
  | 'depends-on-the-row'
  | 'unknown'

/**
 * ⛔ **Every kind, classified** — a kind added to {@link TranscriptItem} and not named here does not
 * compile.
 *
 * ⚠️ **Three `the-app` kinds report an act that happened ELSEWHERE**, and are still the app's words:
 * `notice` (e.g. a parent withdrew this work), `appNotice` (a question this conversation asked was
 * answered), `continuation` (the go-ahead BroBot sends for the person). ⚑ They are not carded here — they are the app speaking,
 * not another agent — and `658`'s response names them so the decision can be revisited.
 */
export const WHOSE_WORDS = {
  user: 'this-conversation',
  assistant: 'this-conversation',
  tool: 'this-conversation',
  thinking: 'this-conversation',
  plan: 'this-conversation',
  subAgent: 'this-conversation',
  image: 'this-conversation',
  permission: 'this-conversation',
  userInput: 'this-conversation',
  memoryRecall: 'this-conversation',
  continuation: 'the-app',
  appNotice: 'the-app',
  notice: 'the-app',
  compaction: 'the-app',
  reset: 'the-app',
  memoryLoaded: 'the-app',
  memoryNote: 'shared-memory',
  relayed: 'another-conversation',
  workReport: 'depends-on-the-row',
  queued: 'depends-on-the-row',
  unknown: 'unknown',
} as const satisfies Readonly<Record<TranscriptItem['kind'], WhoseWords>>

/**
 * ⚑ **A KIND's classification, as the wide type** — a function rather than an index, because an index
 * narrows to the one member it holds and would make a future `another-conversation` kind unreachable
 * to the comparison in {@link fromOutside}.
 */
export function whoseWordsOf(kind: TranscriptItem['kind']): WhoseWords {
  return WHOSE_WORDS[kind]
}

/** ⚑ The sender of a row from outside — a profile slug for `agentName`, or `undefined` when unnamed. */
export interface FromOutside {
  readonly sender: string | undefined
}

/**
 * 🔴 **Did this row's words come from a conversation OTHER than this one?** — and if so, who sent it.
 *
 * | kind | from outside when |
 * |---|---|
 * | `relayed` | always — its sender is `relayedFromProfile`, or unnamed |
 * | `workReport` | it was relayed: a child's REPLY, named or not. ⚠️ A STALL notice is the app's own words about a child and was relayed by nobody — a task, not an incoming message |
 * | `queued` | it is a held relayed message, or a held reply — the same two, waiting |
 *
 * ⛔ **Never from the text**: a row that merely MENTIONS another agent is still its author's.
 */
export function fromOutside(item: TranscriptItem): FromOutside | null {
  switch (item.kind) {
    case 'relayed':
      return { sender: item.relayedFromProfile }
    case 'workReport':
      return item.relayed === true ? { sender: item.relayedFromProfile } : null
    case 'queued':
      return item.relayed === true ? { sender: item.relayedFromProfile } : null
    default: {
      // ⚠️ **Widened on purpose.** Today `relayed` is the only `another-conversation` kind and the
      // compiler can prove this branch never sees one; a kind classified that way tomorrow is still
      // answered as from outside here, unnamed. ⛔ The ENTRY it is routed to must ask — this answer
      // draws nothing on its own.
      return whoseWordsOf(item.kind) === 'another-conversation' ? { sender: undefined } : null
    }
  }
}

/**
 * ⚑ **Whether a row sits in a card**: every row from outside, every row ABOUT a piece — a report on
 * work this conversation gave out, held or delivered — and every call of this app's two messaging
 * tools, which `OutgoingEntry` draws as a card that is NOT shifted (the conversation's own agent,
 * speaking outward).
 *
 * ⚠️ **A piece that also came from outside is ONE card, not a card in a card** — the card is the
 * row's frame, drawn once, and {@link fromOutside} only decides whether it is also shifted.
 * ⛔ **A piece GIVEN to this conversation arrives as a relayed message and is carded as one** — its
 * brief names the piece (`user_turn.piece`), which the card draws as the piece it gave
 * (`RelayedItem.opened`), and that is what tells it from a question.
 */
export function inACard(item: TranscriptItem): boolean {
  if (fromOutside(item) !== null) return true
  if (item.kind === 'workReport') return true
  if (item.kind === 'tool') return drawsAsACard(item)
  return item.kind === 'queued' && item.report !== undefined
}

/**
 * Keep the word between sender and recipient names in one constant so every outside card uses the same separator.
 */
export const TO_WORD = 'to'

/**
 * 🔴 **667 · this conversation's own agent, where the surface cannot name it** (`658`'s G4).
 *
 * ## ⛔ What the cards said instead
 *
 * ⚠️ **A recorded conversation headed its cards with the PROVIDER** — *"ada to claude"* — and the
 * child-work viewer with *"sub-agent"*: the word each surface heads the agent's own replies with,
 * handed to a card as though it were a name. ⛔ **Neither is a name; each is a false one** in a
 * heading whose grammar is *"Ada to BroBot"* — an agent to an agent.
 *
 * ⚑ **So a card takes the agent's NAME or nothing, and nothing reads as *this conversation***
 * — true on every surface that mounts a transcript, and the pair of `outgoing-card.ts`'s *"that
 * conversation"* for the other end. ⚠️ The name comes from `ConversationPane`'s `ownAgent` and,
 * since `678`, `ReadingPane`'s — a recording of OURS names its agent from `LibraryEntry.profileId`
 * (`671` G4a). ⚑ A sub-agent's viewer, and a recording this app did not run as anybody (found in the
 * person's own provider home, or restored from another machine), hand `null`.
 */
export const THIS_CONVERSATION = 'this conversation'

/** ⚑ The same words where they OPEN a heading — *"This conversation to Ada"*. */
export const THIS_CONVERSATION_FIRST = 'This conversation'
