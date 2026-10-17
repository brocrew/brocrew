/**
 * # 🔴 D-012 · a conversation's last exchange, and the words a giver can read (proposal §6.2, §6.5)
 *
 * ⛔ **A stall notice quoted up to 4 KB of the child's last message**, because a giver had no other
 * way to read its child — and a long last message cost the giver that context at every stall.
 * ⚑ Now the notice PREVIEWS the last exchange, and a giver reads more only when it needs to, with
 * `read_transcript` (conversations below it, and — since D-024 · R2 — its own profile's other
 * conversations).
 *
 * ## ⚑ A read of the ledger, never a record of its own (design notes §1)
 *
 * ⚠️ *"The app keeps, per conversation, the last message received and the latest text back, each
 * replaced every time"* — and the ledger already holds both, in order: the newest `user_turn` is the
 * last message received, and the newest main-thread `assistant_message` after it is the latest text
 * back, in a turn still running as much as in one that ended. ⛔ A second copy would be a second
 * thing to keep in step with the first (`379`'s rule: state is derived, never stored).
 *
 * ## ⛔ Whose words, read off the row's own fields — never off the words
 *
 * ⚑ `whoseWordsTheseAre` writes the fields at the door: nothing on a person's turn; `relayedFrom`
 * AND `says` on an agent's own message, and `relayedFrom` AND `piece` on a brief an agent gave, or
 * its new brief (D-016: a brief is the giver's own words, and says no kind); `relayedFrom` alone
 * where this app carries a conversation's words (a reply, a routed question); `app_authored` alone
 * for this app's own. A message cannot make itself look like a person's by what it says.
 */

import { theMessagesOf, type UserTurnEvent, type UserTurnPart } from './runtime-ipc'

/** ⚑ **Who sent the message a conversation received.** */
export type WhoSentIt =
  | { readonly is: 'a-person' }
  | ({ readonly is: 'an-agent' } & AConversation)
  /** ⚑ This app — its own sentence, or (`carrying`) a conversation's words it delivered. */
  | { readonly is: 'this-app'; readonly carrying: AConversation | null }
  /** ⚑ Typed into the provider's own CLI, before or outside this app (an adopted history). */
  | { readonly is: 'its-own-cli' }
  /** ⚑ A row this app's record could not read — whose it was is not known. */
  | { readonly is: 'unreadable' }

/** ⚑ **Words as the ledger holds them**, capped — or the fact that the row could not be read. */
export type Words =
  { readonly text: string; readonly clipped: boolean } | { readonly unreadable: true }

/** ⚑ **One message a conversation received** — who sent it, and its words. */
export interface Received {
  readonly from: WhoSentIt
  readonly words: Words
}

/**
 * 🔴 **D-027 · what one turn delivered** — its LAST message, the newest the conversation received,
 * and (`cameWith`) the messages delivered with it in that same turn, oldest first. ⛔ `cameWith` is
 * absent for a turn of one message, so that reading is what it always was, key for key.
 */
export interface ReceivedInATurn extends Received {
  readonly cameWith?: readonly Received[]
}

/**
 * ⚑ **The last exchange**: the last message received, with its sender, and the latest text back
 * after it. `null` halves are facts: nothing received yet, or nothing said back since.
 */
export interface Exchange {
  readonly received: ReceivedInATurn | null
  readonly answer: Words | null
  /**
   * 🔴 **F080 — since that message, its provider started a turn by itself** (a wake after its
   * background work ended), so its last turn answered no message and its latest words may be that
   * turn's. Absent when no such turn came after the last message received.
   */
  readonly sinceThenItsProviderStartedATurn?: true
}

/**
 * ⚑ **One turn of a transcript, as `read_transcript` reads it** — the message received and every
 * main-thread word said back to it, in order, joined. ⚠️ Tool calls and sub-agents' words are not
 * in it: the transcript a giver reads is what was said, not what was run.
 *
 * 🔴 **F080 — or a turn its provider started by itself** (a wake when its background work ended):
 * no message opened it, so it carries what its provider said ended just before it instead.
 */
export type TranscriptTurn = {
  readonly at: number
  readonly said: Words | null
} & (
  { readonly received: ReceivedInATurn } | { readonly startedByItsProvider: TurnItsProviderStarted }
)

/** ⚑ **F080 — what a turn its provider started by itself followed**, as far as the record says. */
export interface TurnItsProviderStarted {
  /**
   * The provider's own words for each piece of background work that ended between this
   * conversation's previous turn and this one, oldest first — what woke it (*"Background command
   * "sleep 20" completed (exit code 0)"*). Empty when the record holds none.
   */
  readonly after: readonly string[]
}

/** ⚑ **How much of one message a read hands back** — the 4 KB the stall notice used to quote. */
export const WORDS_CAP = 4 * 1024

/** ⚑ **How many turns back `read_transcript` reads at most**, and by default. */
export const TURNS_BACK_MAX = 20
export const TURNS_BACK_DEFAULT = 3

/** ⚑ **How much of a message a notice previews.** */
export const PREVIEW_CAP = 200

/** ⚑ Capped words — measured on the text that arrived, never on the text that leaves. */
export function capped(text: string, cap: number = WORDS_CAP): Words {
  return { text: text.slice(0, cap), clipped: text.length > cap }
}

/** ⚑ **The sender, read off the row's fields** — see the module's own note on whose words. */
export function senderOf(
  turn: Pick<
    UserTurnEvent,
    'attribution' | 'relayedFrom' | 'relayedFromProfile' | 'says' | 'piece' | 'drives' | 'work'
  >,
): WhoSentIt {
  if (turn.attribution === undefined) return { is: 'a-person' }
  if (turn.attribution === 'provider_transcript') return { is: 'its-own-cli' }
  // ⚑ **F033 · the piece the words were sent under** — the one a reply reports on, a brief gives
  // or the words drive, as the row keeps it.
  const about = turn.work?.piece ?? turn.piece ?? turn.drives
  const who =
    turn.relayedFrom === undefined
      ? null
      : {
          conversation: turn.relayedFrom,
          profile: turn.relayedFromProfile ?? null,
          ...(about === undefined ? {} : { about }),
        }
  if (who !== null && (turn.says !== undefined || turn.piece !== undefined)) {
    return { is: 'an-agent', ...who }
  }
  return { is: 'this-app', carrying: who }
}

/**
 * 🔴 **D-027 · what one delivered turn is read as** — see {@link ReceivedInATurn}. ⚑ Each message's
 * sender off its own fields ({@link senderOf}) and its words capped; ⚠️ words that are not a string
 * on a row another build wrote are read as none, as a turn's always were. ⛔ **A turn of several
 * none of whose messages reads is `unreadable`** ({@link theMessagesOf}): its words are there,
 * joined, and whose they were is not.
 */
export function whatATurnDelivered(turn: UserTurnEvent, cap: number = WORDS_CAP): ReceivedInATurn {
  const words = (said: unknown): Words => capped(typeof said === 'string' ? said : '', cap)
  const one = (message: UserTurnPart): Received => ({
    from: senderOf(message),
    words: words(message.text),
  })
  const messages = theMessagesOf(turn)
  const last = messages[messages.length - 1]
  if (last === undefined) return { from: { is: 'unreadable' }, words: words(turn.text) }
  const earlier = messages.slice(0, -1)
  return earlier.length === 0 ? one(last) : { ...one(last), cameWith: earlier.map(one) }
}

/**
 * ⚑ **A preview: the start of the words, on one line** — newlines folded to spaces, cut at a word
 * boundary, and an ellipsis where something was left out.
 */
export function previewOf(words: Words): string | null {
  if ('unreadable' in words) return null
  const flat = words.text.replace(/\s+/g, ' ').trim()
  if (flat.length <= PREVIEW_CAP && !words.clipped) return flat
  const cut = flat.slice(0, PREVIEW_CAP)
  const atAWord = cut.lastIndexOf(' ')
  return `${(atAWord > PREVIEW_CAP / 2 ? cut.slice(0, atAWord) : cut).trimEnd()}…`
}

/** ⚑ **A conversation the sender line names** — its id and its identity, for the host to name. */
export interface AConversation {
  readonly conversation: string
  readonly profile: string | null
  /**
   * ⚑ **F033 · the piece its words were sent under** — the one a reply reports on, a brief gives,
   * or the words drive (`UserTurnEvent.work`, `.piece`, `.drives`) — so the host names the sender
   * by it rather than by what it holds now. ⚠️ Absent when the row names none.
   */
  readonly about?: string
}

/**
 * ⚑ **The lead-in naming who sent it, ending where the quotation starts** — one decision per kind
 * of sender, so the verb fits: a person or an agent *wrote*, this app *wrote* its own sentence or
 * carried somebody else's, and a CLI's words were *typed*.
 */
export function whoSentItLeadIn(from: WhoSentIt, nameOf: (who: AConversation) => string): string {
  switch (from.is) {
    case 'a-person':
      return 'a person, who wrote'
    case 'an-agent':
      return `${nameOf(from)}, who wrote`
    case 'this-app':
      return from.carrying === null
        ? 'this app, which wrote'
        : `this app, carrying the words of ${nameOf(from.carrying)}`
    case 'its-own-cli':
      return 'words typed into its own CLI'
    case 'unreadable':
      return 'a message this app could not read'
  }
}

/**
 * 🔴 **The notice's preview of the last exchange** (proposal §6.5) — *"Its last turn answered Sam,
 * who wrote: 'Use the new logo.' Ali's answer starts: 'Which colours should…'"*.
 *
 * ⛔ **Each quotation is a paragraph of its own**, never folded into this app's sentence — `614`'s
 * placement, and `214`'s reason: a model's prose inside the app's clause reads as the app's.
 *
 * ⚑ `holder` is the name the notice's first line already used, so one conversation is called one
 * thing; `nameOf` names a sender conversation the way every surface does (`agentName`).
 */
export function exchangePreviewLines(
  holder: string,
  exchange: Exchange,
  nameOf: (who: AConversation) => string,
): readonly string[] {
  if (exchange.received === null) {
    return [`This app holds no message sent to ${holder}, so there is no exchange to show.`]
  }
  const leadIn = whoSentItLeadIn(exchange.received.from, nameOf)
  const received = previewOf(exchange.received.words)
  // ⚑ **D-027 · a turn that delivered several says so**, and previews the last of them.
  const together = exchange.received.cameWith?.length ?? 0
  // 🔴 **F080 — a turn its provider started after that message answered nothing**: the message is
  // the last one it received, and its last turn was its provider's own.
  const answered =
    exchange.sinceThenItsProviderStartedATurn === true
      ? together === 0
        ? `Its last turn was one its provider started by itself. The last message it received came from ${leadIn}`
        : `Its last turn was one its provider started by itself. The last ${String(together + 1)} messages it received came together; the last was from ${leadIn}`
      : together === 0
        ? `Its last turn answered ${leadIn}`
        : `Its last turn answered ${String(together + 1)} messages delivered together; the last was from ${leadIn}`
  const lines =
    received === null
      ? [`${answered} — words this app's record could not read.`]
      : [`${answered}:`, received]
  if (exchange.answer === null) {
    lines.push(`${holder} said nothing back to it.`)
    return lines
  }
  const answer = previewOf(exchange.answer)
  if (answer === null) {
    lines.push(`${holder}'s answer could not be read from this app's record.`)
    return lines
  }
  lines.push(
    exchange.sinceThenItsProviderStartedATurn === true
      ? `${holder}'s latest words start:`
      : `${holder}'s answer starts:`,
    answer,
  )
  return lines
}
