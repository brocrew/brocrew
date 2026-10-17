import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import type { RefusalTold } from '../../../shared/refusals'
import type { AgentMessageKind } from '../../../shared/tasks'
import type {
  OutgoingGive,
  OutgoingRebrief,
  OutgoingReply,
  OutgoingTakeOn,
  OutgoingWords,
  QuestionTool,
  ToolItem,
} from './transcript'
import { workReading, type WorkReading } from './work-report'
import { workIsWith, type WorkIsWith } from './where-the-work-is'
import { argumentExcerpt } from './argument-excerpt'
import { pieceSays } from './relayed-turn'
import { TO_WORD } from './from-outside'
import { pieceNumbersOf } from '../../../shared/piece-called'
import type { WorkEdge } from '../../../shared/who-called-whom'

/**
 * # 🔴 658 · The card a call draws when it put this conversation's words into ANOTHER one
 *
 * Render replies and messages to agents as dedicated outgoing cards rather than generic tool rows.
 *
 * ⛔ **Every judgement is made here and none in a template** — `tool-inventory.ts`' rule. The fold
 * decides WHICH calls these are ({@link ToolItem.outgoing}); this reads one into what its card says.
 *
 * ## ⚠️ The two halves of a card, and where each comes from
 *
 * | | reply_to_parent | message_agent |
 * |---|---|---|
 * | *to whom* | the relayer of this ledger's brief for the piece (`user_turn.relayedFromProfile`) | `message_sent.toProfile` |
 * | *the words* | `work_replied.summary`, whole | `message_sent.text`, bounded at 1,280 — ⚠️ or the call's arguments, bounded at 200, on a row written before `671` |
 * | *how it went* | `work_replied.outcome` | `message_sent.delivery` |
 *
 * ⚑ **678 · a message's words come from the host's row** — `671` put them there (`658`'s gap,
 * handed back and closed). ⚠️ **This said they existed only inside the call's arguments**, which
 * was true until `671`: both adapters bound those at 200 characters. ⛔ **A row written before `671`
 * still carries none**, and only then does the card read the arguments ({@link argumentExcerpt}).
 *
 * 🔴 **Either way, a cut body SAYS it was cut, in words** ({@link BODY_WAS_CUT}) — ⛔ never an
 * ellipsis, which the author may have typed themselves and which a reader cannot tell from theirs.
 */

/** ⚑ The recipient of a reply whose brief is not in view — the tool's own noun, never a guess. */
export const AN_UNNAMED_PARENT = 'its parent'

/** ⚑ The recipient of a message whose identity row was not written — never `agentName(null)`, which is BroBot. */
export const AN_UNNAMED_RECIPIENT = 'another agent'
export const AN_UNRESOLVED_RECIPIENT = 'the named agent'
export const ITSELF_ADDRESSED = 'itself'

/**
 * ⛔ **What a `sess_` handle reads as, in a receipt a person sees.**
 *
 * ⚠️ A receipt is the tool's own sentence to the MODEL — *"sess_… has been sent it straight away
 * as note."* — and the model needs the handle. ⚑ The card prints it only when no host
 * row landed (a refusal, a failure, or a row the fold would not guess an owner for), and `624` §6
 * found three sentences printing a handle to a person; this is not a fourth.
 */
export const A_HANDLE_READ_ALOUD = 'that conversation'

export function withoutHandles(text: string): string {
  return text.replace(/\bsess_[\w-]+/g, A_HANDLE_READ_ALOUD)
}

/** ⚑ What the card is, beside its heading — the `RELAYED_MARK` position. */
export const REPLY_MARK = 'reply'

/** ⚑ A piece of work this conversation gave, beside its heading. */
export const GIVE_MARK = 'work'

/** ⚑ **D-047 · the mark on a card that gave a piece a new brief.** */
export const NEW_BRIEF_MARK = 'New brief'

/**
 * ⚑ The recipient of a question addressed to a person — the one reading this window (UI-009's
 * `question-card.ts`). ⚑ **D-016 ·
 * commit 6 · and the person as a piece's giver**: the recipient of a reply to a piece they gave,
 * and the giver named on the cast's and the forest's lines of it.
 */
export const A_PERSON_ADDRESSED = 'you'

/**
 * ⚑ **Whom a person's work is for** — the person reading this window: a piece taken on for them
 * (UI-003) and, on the agent card's *Current task*, the work they gave a conversation (UI-008).
 */
export const FOR_A_PERSON = `for ${A_PERSON_ADDRESSED}`

/** ⚑ **UI-003 · what a take-on's sender did**, between its name and the piece: *BroBot took on*. */
export const TOOK_ON_WORD = 'took on'

/** ⚑ **UI-003 · the lead of a take-on's status line** — *Status: Running test 3 of 5*. */
export const STATUS_LEAD = 'Status:'

/**
 * ⚑ A message's kind, as the SENDER claimed it — `message_sent.kind`.
 *
 * ⛔ **A kind this build does not know draws no mark**: the fold reads the stored word as a MEMBER
 * (`isAgentMessageKind`) and keeps `null` for anything else, so a row written by a build whose
 * vocabulary has moved — an older row's `work`, since D-016 made work `give_work`'s — reaches this
 * table as no kind at all, never as a word looked up and missed.
 */
export const MESSAGE_KIND_WORD: Readonly<Record<AgentMessageKind, string>> = {
  note: 'note',
  'follow-up': 'follow-up',
}

/**
 * ⚑ **Where a call's words stand** — one word, and a closed set a test can enumerate.
 *
 * | state | means |
 * |---|---|
 * | `sending` | the call is running and nothing says where its words went yet |
 * | `sent` | a MESSAGE landed as sent — the recipient was idle and it is its next turn; ⚑ or a GIVE's receipt says its brief went straight away |
 * | `held` | a MESSAGE landed as held — it goes when the recipient's turn ends; ⚑ or a GIVE's receipt says its brief is held until the recipient is free |
 * | `delivered` | a REPLY was recorded, the call answered `ok`, no `reply_undelivered` came, and the give in view names the conversation that made it — `REPLY_LANDED`'s *landed*: sent to its parent, or held for its parent's next turn, or kept for its parent's next start (D-030); ⛔ never read before the answer, because the host writes that row first |
 * | `not-delivered` | a REPLY was recorded and reached nobody — `reply_undelivered`; ⚑ since `729` (R89) also one that was `delivered` — held for its parent, or kept for its next start — whose held message then ended unsent: the row comes later, and the card moves |
 * | `answered` | the call has a receipt and no row landed — a refusal, or a row this fold would not guess an owner for; ⛔ the receipt is the whole story, so the card prints it rather than a word that could be false — ⚑ or a reply to a piece a person gave, which went to no conversation (commit 6 · R5) — ⚑ since UI-003 with no receipt under it: the heading says it went to *you* — or one whose give is out of view, which may be such a piece |
 * | `failed` | the call ERRORED (`ok: false`) and no row landed — a thrown handler or a denied call; ⚠️ a REFUSAL is `ok: true` on both providers and lands in `answered` |
 * | `did-not-finish` | the run ended before the call answered |
 * | `taking-on` | ⚑ UI-003 · a TAKE-ON is running |
 * | `taken-on` | ⚑ UI-003 · a TAKE-ON answered with its own sentence, or its row landed — the piece is this conversation's, for the person |
 */
export type OutgoingState =
  | 'sending'
  | 'sent'
  | 'held'
  | 'delivered'
  | 'not-delivered'
  | 'answered'
  | 'failed'
  | 'did-not-finish'
  | 'taking-on'
  | 'taken-on'

export const OUTGOING_STATE_WORD: Readonly<Record<OutgoingState, string>> = {
  sending: 'sending…',
  sent: 'sent',
  held: 'held · goes when its turn ends',
  delivered: 'delivered',
  'not-delivered': 'not delivered',
  answered: '',
  failed: 'failed',
  'did-not-finish': 'did not finish',
  'taking-on': 'taking it on…',
  // ⚑ **UI-003 · whom a piece taken on is for** — the person, as a reply to it goes to *you*.
  'taken-on': FOR_A_PERSON,
}

/**
 * ⚑ **The calls this file draws** — every outgoing call but the two question tools, which UI-009's
 * `QuestionCard` draws on both its surfaces (`question-card.ts`).
 */
export type OutgoingCardWords = Exclude<OutgoingWords, { tool: QuestionTool }>

/** ⚑ Everything one card says — see the file's docblock. */
export interface OutgoingCardReading {
  readonly tool: OutgoingCardWords['tool']
  /** The piece a person may take back from the service it is on, by id; absent otherwise. */
  readonly takeBack?: string
  /**
   * ⚑ **UI-003 · the word between the sender and the recipient** — *to* on every card that goes to
   * someone; a card that goes to nobody says what its sender did instead (*took on*), or nothing.
   */
  readonly joiner: string
  /**
   * The name after {@link joiner} — a name a person gave, or {@link AN_UNNAMED_PARENT} /
   * {@link AN_UNNAMED_RECIPIENT}; ⚑ `''` for a card that names nobody.
   */
  readonly recipient: string
  readonly mark: string
  readonly state: OutgoingState
  /** ⚑ A reply's piece facts — its label and outcome badge, the parent's work-report card's own line. */
  readonly facts: WorkReading | null
  /**
   * 🔴 **688 · the piece a MESSAGE names** (`687` H2) — its label, *Piece* when no row spells one,
   * `null` when it names none. ⚑ `pieceSays`, the incoming card's own reader, so a card names one
   * piece one way wherever it is drawn. ⛔ Never on a reply: its piece is {@link facts}'.
   */
  readonly piece: string | null
  /**
   * ⚑ **A give's title**, above its brief — and a take-on's (UI-003); `null` on every other card, and
   * on a title that was cut.
   */
  readonly title: string | null
  readonly body: string | null
  /** ⛔ The body is the head of a longer text — the host's `clipped`, or an argument that did not end. */
  readonly bodyIsCut: boolean
  /**
   * 🔴 **UI-011 · where a give's cut brief is read whole** (F037) — the conversation its piece went
   * to, the piece's label (the brief's own row there is found by it), and the cut note's words,
   * which become the press ({@link readItWholeIn}). ⛔ `null` on every other card, on a brief that
   * ended, and wherever {@link where} is: nothing could open that conversation (`118`).
   */
  readonly wholeBrief: {
    readonly conversation: string
    readonly label: string
    readonly said: string
  } | null
  /** The tool's own answer, printed only in `answered` and `failed` — see {@link OutgoingState}. */
  readonly receipt: string | null
  /** The other conversation, when the card can open it — {@link workIsWith}'s press. */
  readonly where: WorkIsWith | null
  /** ⚑ The resources a reply handed in, by id — one press each; empty on every other card. */
  readonly resources: readonly string[]
  /**
   * ⚑ **UI-002 · the piece whose inputs a give lists** — its label, from the receipt; `null` on every
   * other card, and on a give whose receipt names no piece.
   */
  readonly inputsOn: string | null
  /**
   * ⚑ **UI-002 · when that piece was given** — the edge's `givenAt`, the moment its inputs were kept
   * with it; `null` where the cast has not read the edge.
   */
  readonly inputsUntil: number | null
  /**
   * ⚑ **UI-003 · a take-on's newest status line** (`update_work`), until the reply that finishes
   * it — `null` on every other card.
   */
  readonly status: string | null
}

export function outgoingCard(
  item: Pick<ToolItem, 'summary' | 'result' | 'unfinished' | 'told' | 'refusalRail'>,
  words: OutgoingCardWords,
  identities: readonly AgentIdentity[] | null,
  held: ReadonlySet<string> | null,
  /**
   * ⚑ **The work this conversation gave out, as the cast last read it** (`WhoCalledWhom.workGivenOut`)
   * — where a give's card finds the conversation its piece went to ({@link giveCard}). ⚠️ `null`
   * where the surface has no reading of this conversation's: a give's card then draws no press.
   */
  gaveOut: readonly WorkEdge[] | null = null,
): OutgoingCardReading {
  const state = stateOf(item, words)
  const receipt =
    (state === 'answered' || state === 'failed') && item.result !== null
      ? withoutHandles(wholeReceipt(item.result.summary, item.told))
      : null
  if (words.tool === 'give_work') {
    return giveCard(item, words.given, state, receipt, identities, held, gaveOut)
  }
  if (words.tool === 'take_on_work') return takeOnCard(item, words.taken, state, receipt)
  if (words.tool === 'update_work') {
    return rebriefCard(words.rebriefed, state, receipt, identities, held, gaveOut)
  }
  if (words.tool === 'reply_to_parent') {
    const reply = words.reply
    const excerpt = reply === null ? argumentExcerpt(item.summary, 'summary') : null
    return {
      tool: words.tool,
      joiner: TO_WORD,
      recipient:
        reply?.toThePerson === true
          ? A_PERSON_ADDRESSED
          : reply?.toProfile === undefined
            ? AN_UNNAMED_PARENT
            : agentName(reply.toProfile, identities),
      mark: REPLY_MARK,
      state,
      facts: reply === null ? null : replyFacts(reply),
      piece: null,
      title: null,
      body: reply?.summary ?? excerpt?.text ?? null,
      bodyIsCut: reply === null && excerpt?.cut === true,
      wholeBrief: null,
      // 🔴 **UI-003 · a reply to the person's own request says nothing under it** — the tool's
      // sentence is to the MODEL (*"…tell them here"*), and the card already says it went to *you*,
      // its piece and its outcome. ⚠️ Printed still where the call errored, or the give is out of view.
      receipt: reply?.toThePerson === true && state === 'answered' ? null : receipt,
      where:
        reply?.toConversation === undefined
          ? null
          : workIsWith({ owner: reply.toConversation }, held),
      resources: reply?.resources ?? [],
      inputsOn: null,
      inputsUntil: null,
      status: null,
    }
  }
  const sent = words.sent
  // ⚑ **678 · the host's words first** (`671` G1) — the call's arguments only where the row has none.
  const recorded = sent?.text ?? null
  const excerpt = recorded === null ? argumentExcerpt(item.summary, 'text') : null
  return {
    tool: words.tool,
    joiner: TO_WORD,
    recipient:
      item.refusalRail === 'that-agent-is-you'
        ? ITSELF_ADDRESSED
        : sent === null
          ? argumentExcerpt(item.summary, 'agent')?.text
            ? AN_UNRESOLVED_RECIPIENT
            : ''
          : sent.toProfile === null
            ? AN_UNNAMED_RECIPIENT
            : agentName(sent.toProfile, identities),
    mark: sent?.kind == null ? '' : MESSAGE_KIND_WORD[sent.kind],
    state,
    facts: null,
    piece: pieceSays(sent?.about),
    title: null,
    body: recorded ?? excerpt?.text ?? null,
    // ⛔ **The host's `clipped`, never inferred from a length** — a message can be exactly 1,280 long.
    bodyIsCut: recorded === null ? excerpt?.cut === true : sent?.clipped === true,
    wholeBrief: null,
    receipt,
    where: sent === null ? null : workIsWith({ owner: sent.toConversation }, held),
    resources: [],
    inputsOn: null,
    inputsUntil: null,
    status: null,
  }
}

/**
 * 🔴 **678 · what a cut body says, under it** — `F-G1`'s rule: *a cut message says it was cut*.
 *
 * ⛔ **Never `…`**: this card drew one until `678`, and an ellipsis is a thing the author may have
 * typed — a reader cannot tell the app's cut from their trailing-off. ⚑ **A sentence of its own,
 * outside the message's box**, so it cannot be read as the message's last words either, and the
 * box's `textContent` is exactly the words (`001`'s rule, `WorkReportEntry`'s note).
 *
 * ⚑ **`MemoryNoteEntry`'s sentence, word for word** — the one other place this product tells a
 * person it cut a text — so one product says it one way (standing rule 17.2's last paragraph).
 * ⚠️ **It does not say where the rest is**, on purpose: a body read out of a refused call's
 * arguments went nowhere. ⚑ **UI-011 · a give's brief that reached a conversation this card can
 * open says where instead**, and the sentence is the press ({@link readItWholeIn}).
 */
export const BODY_WAS_CUT = 'Cut at the size limit — this much of it is shown here.'

/**
 * The receipt as a person reads it: where the host kept a refusal's whole sentence, the receipt's
 * own lead (`refused (<rail>): `) followed by that whole sentence; otherwise the receipt as the
 * row holds it.
 */
function wholeReceipt(summary: string, told: RefusalTold | undefined): string {
  const lead = told === undefined ? null : /^refused \([^)]*\): /.exec(summary)
  return told === undefined || lead === null ? summary : `${lead[0]}${told.text}`
}

/**
 * Whether a receipt was cut at the row's bound: each provider's normalizer marks one it cut with
 * `…`, or `… (N of M characters)`. A cut receipt may have lost the part that says what to do, so
 * its card offers the whole answer. Where the host kept the refusal's whole sentence, it is cut
 * only if the host cut that.
 */
export function receiptIsCut(receipt: string | null, told?: RefusalTold): boolean {
  if (told !== undefined) return told.dropped > 0
  return receipt !== null && /…(?: \(\d+ of \d+ characters\))?$/.test(receipt)
}

/**
 * When a give's own full row is unavailable, pair {@link BODY_WAS_CUT} with the recipient conversation where its brief arrived. New ledgers also store the whole brief locally; the fallback covers older ledgers and calls `landOutgoing` could not distinguish in `transcript.ts`.
 */
export function readItWholeIn(recipient: string): string {
  return `Cut at the size limit — read it whole in ${recipient}’s conversation.`
}

/**
 * ⛔ **UI-011 · what that press says when the brief is not on the page it opened** — `106`'s rule
 * (a miss is said, never landed short of silently), in `OPEN_REQUEST_MISSED`'s words for a brief.
 */
export const THE_BRIEF_IS_FURTHER_BACK =
  'That brief is not in the part of this conversation on screen — it is further back; ' +
  'load more of the transcript to reach it.'

/**
 * ⚑ **Where the words stand** — see {@link OutgoingState}. ⛔ Each arm reads the fact that decides
 * it and nothing weaker: a message's delivery is the host's `message_sent.delivery`; a reply's is
 * the absence of `reply_undelivered` once the call has answered, over a give in view that a
 * conversation made. ⚑ **D-016 · commit 6 · a reply to a piece a person gave is delivered nowhere**
 * (R5), so it is never *delivered* — and neither is one whose give is out of view, which may be
 * such a piece: once the call answered either reads `answered`, and the receipt printed under it
 * says where the reply went.
 */
function stateOf(
  item: Pick<ToolItem, 'result' | 'unfinished'>,
  words: OutgoingCardWords,
): OutgoingState {
  // ⚑ **A give, off its receipt** — the one record here of how it went ({@link givenSaid}); ⚠️ a
  // receipt that is not the give's own sentence (a refusal, or one cut before it said) is printed
  // instead.
  if (words.tool === 'give_work' && item.result?.ok === true) {
    const given = givenSaid(item.result.summary)
    if (given !== null) return given.delivery
  }
  // ⚑ **UI-003 · a take-on** — running, then taken on once its row landed or its receipt says so;
  // ⚠️ a refusal or an error falls through to the receipt, as every other call's does.
  if (words.tool === 'take_on_work' && item.result === null && item.unfinished !== true)
    return 'taking-on'
  if (
    words.tool === 'take_on_work' &&
    item.result?.ok === true &&
    (words.taken !== null || tookOnSaid(item.result.summary) !== null)
  )
    return 'taken-on'
  if (words.tool === 'message_agent' && words.sent?.delivery === 'queued') return 'held'
  if (words.tool === 'message_agent' && words.sent?.delivery === 'sent') return 'sent'
  if (words.tool === 'reply_to_parent' && words.reply !== null) {
    if (words.reply.undelivered !== undefined) return 'not-delivered'
    // ⚑ D-016 · commit 6 · *delivered* only over a give in view that a conversation made — a piece
    // a person gave was delivered nowhere, and one whose give is out of view may be such a piece:
    // the receipt says where it went
    const toAConversation =
      words.reply.toConversation !== undefined || words.reply.toProfile !== undefined
    if (item.result?.ok === true && !toAConversation) return 'answered'
    // ⚠️ a call that errored after the reply was recorded says nothing about where it went
    if (item.result !== null) return item.result.ok ? 'delivered' : 'failed'
  } else if (item.result !== null) {
    return item.result.ok ? 'answered' : 'failed'
  }
  return item.unfinished === true ? 'did-not-finish' : 'sending'
}

/**
 * ⚑ **The parent's work-report line, drawn on the child's card** — the same label and the same
 * outcome badge, from `workReading`, so the two ends of one reply cannot word it differently.
 * ⚠️ A piece whose `work_given` is before the retained suffix is headed *Piece*, never a guess.
 */
function replyFacts(reply: OutgoingReply): WorkReading {
  return workReading({
    label: reply.label ?? 'Piece',
    state: 'answered',
    outcome: reply.outcome,
    ...(reply.needsUserAction === true ? { needsUserAction: true as const } : {}),
  })
}

/**
 * Build the outgoing card for a give of work.
 *
 * ⚑ **To whom** is the call's `profile`, named as every surface names it. 🔴 **D-047 · the words
 * are the give's own row** ({@link OutgoingGive}): its title and brief whole, written into this
 * ledger before the call answered. ⚠️ **Until it lands, and where none landed**, they are the call's
 * `title` and `brief` — the arguments, bounded at 200 characters, so a brief is usually cut and
 * says so. ⚑ **The label and how it went** are the receipt's ({@link givenSaid}). 🔴 **UI-011 · a
 * cut brief opens to the whole one** where the press does ({@link OutgoingCardReading.wholeBrief}).
 *
 * 🔴 **D-016 · commit 7 · the conversation it reached is the cast's, found by the label** — ⚑ else
 * the one the give's row says the brief went to. The receipt names the agent and never its
 * conversation's id (R1: *the ids are in the payload*), and the payload never reaches a tool row,
 * which carries the prose alone, cut at 200. ⚑ So the press opens the `to` of the edge the cast read
 * for the label the receipt names — one label names one piece for good. ⛔ **No edge and no row, no
 * press**: never a conversation guessed from a name.
 */
function giveCard(
  item: Pick<ToolItem, 'summary' | 'result'>,
  sent: OutgoingGive | null,
  state: OutgoingState,
  receipt: string | null,
  identities: readonly AgentIdentity[] | null,
  held: ReadonlySet<string> | null,
  gaveOut: readonly WorkEdge[] | null,
): OutgoingCardReading {
  const profile = argumentExcerpt(item.summary, 'profile')
  // ⚑ **D-047 · the row's words are whole**, read as an argument that ended.
  const title =
    sent === null ? argumentExcerpt(item.summary, 'title') : { text: sent.title, cut: false }
  const brief =
    sent === null ? argumentExcerpt(item.summary, 'brief') : { text: sent.brief, cut: false }
  const given = item.result?.ok === true && receipt === null ? givenSaid(item.result.summary) : null
  const edge = given === null ? undefined : gaveOut?.find((one) => one.label === given.label)
  const recipient =
    profile === null || profile.cut || profile.text.trim() === ''
      ? AN_UNNAMED_RECIPIENT
      : agentName(profile.text, identities)
  const to = edge?.to ?? sent?.to
  const where = to === undefined ? null : workIsWith({ owner: to }, held)
  return {
    tool: 'give_work',
    joiner: TO_WORD,
    recipient,
    mark: GIVE_MARK,
    state,
    facts: null,
    piece: given === null ? null : pieceSays({ label: given.label }),
    title: title === null || title.cut || title.text.trim() === '' ? null : title.text,
    body: brief?.text ?? null,
    bodyIsCut: brief?.cut === true,
    wholeBrief:
      brief?.cut === true && edge !== undefined && where !== null
        ? { conversation: where.conversation, label: edge.label, said: readItWholeIn(recipient) }
        : null,
    receipt,
    where,
    resources: [],
    inputsOn: given?.label ?? null,
    inputsUntil: edge?.givenAt ?? null,
    status: null,
    ...(edge?.aPersonMayTakeItBack === true ? { takeBack: edge.piece } : {}),
  }
}

/**
 * 🔴 **D-047 · a new brief, as a card** — *BroBot to another agent · W1.2 · New brief*, the piece's
 * title above the whole new brief, off its own `work_sent`. ⚑ **Drawn only once that row landed**
 * (`TranscriptView`): until then, and on a ledger written before D-047, the call is the tool row it
 * always was. ⚑ The conversation it went to: the cast's for the label, else the row's `to`.
 * ⚑ The agent is the cast's edge's (`toIdentity`), named as every surface names it; ⚠️ the row names
 * none, so without the edge it is {@link AN_UNNAMED_RECIPIENT}, as a message's card says it.
 */
function rebriefCard(
  rebriefed: OutgoingRebrief | null,
  state: OutgoingState,
  receipt: string | null,
  identities: readonly AgentIdentity[] | null,
  held: ReadonlySet<string> | null,
  gaveOut: readonly WorkEdge[] | null,
): OutgoingCardReading {
  const edge =
    rebriefed === null ? undefined : gaveOut?.find((one) => one.label === rebriefed.label)
  const to = edge?.to ?? rebriefed?.to
  return {
    tool: 'update_work',
    joiner: TO_WORD,
    recipient:
      edge?.toIdentity == null ? AN_UNNAMED_RECIPIENT : agentName(edge.toIdentity, identities),
    mark: NEW_BRIEF_MARK,
    state,
    facts: null,
    piece: rebriefed === null ? null : pieceSays({ label: rebriefed.label }),
    title: rebriefed === null || rebriefed.title.trim() === '' ? null : rebriefed.title,
    body: rebriefed?.brief ?? null,
    bodyIsCut: false,
    wholeBrief: null,
    receipt,
    where: to === undefined ? null : workIsWith({ owner: to }, held),
    resources: [],
    inputsOn: null,
    inputsUntil: null,
    status: null,
  }
}

/**
 * 🔴 **UI-003 · a request taken on, as a card** (F038) — *BroBot took on · W1.7 · for you*, its title
 * above its brief. ⚑ The whole brief where its `work_given` landed on the call; else the arguments'
 * excerpt, which says it was cut. ⛔ *took on* only once it was — a refusal names no piece and says
 * only its sender, with the receipt under it.
 */
function takeOnCard(
  item: Pick<ToolItem, 'summary' | 'result'>,
  taken: OutgoingTakeOn | null,
  state: OutgoingState,
  receipt: string | null,
): OutgoingCardReading {
  const said = item.result?.ok === true ? tookOnSaid(item.result.summary) : null
  const label = taken?.label ?? said?.label ?? null
  const asked = taken === null ? argumentExcerpt(item.summary, 'title') : null
  const brief = taken === null ? argumentExcerpt(item.summary, 'brief') : null
  return {
    tool: 'take_on_work',
    joiner: state === 'taken-on' ? TOOK_ON_WORD : '',
    recipient: '',
    mark: '',
    state,
    facts: null,
    piece: label === null ? null : pieceSays({ label }),
    title: taken !== null ? taken.title : asked !== null && !asked.cut ? asked.text : null,
    body: taken?.brief ?? brief?.text ?? null,
    bodyIsCut: taken === null && brief?.cut === true,
    wholeBrief: null,
    receipt,
    where: null,
    resources: [],
    inputsOn: null,
    inputsUntil: null,
    status: taken?.status ?? null,
  }
}

/**
 * ⚑ **The take-on's receipt, read as a SHAPE** — `take_on_work`'s own sentence (`agent-tools.ts`):
 * *"Took on W1.7 · Title, under W1, your conversation's own work…"*. ⛔ Only a label that is one.
 */
function tookOnSaid(summary: string): { label: string } | null {
  const current = /^Took on (\S+) under (\S+) for the person\./.exec(summary)
  const said = current ?? /^Took on (\S+?)(?:\.(?:$| )| · )/.exec(summary)
  const label = said?.[1]
  if (label === undefined || pieceNumbersOf(label) === null) return null
  return { label }
}

/**
 * ⚠️ **The give's receipt, read as a SHAPE** — `give_work`'s own sentence (`agent-tools.ts`):
 * *"W1.2 given to Ayo (dev); it went to Ayo straight away."*, or *"…; it is held until Ayo is free,
 * then goes out with whatever else is held for it, …"* ⚑ The fold reads a refusal's receipt the
 * same way (`refused (<rail>): `). ⛔ **`null` for anything else** — a refusal, a sentence cut
 * before it said how it went, or one a later build words differently: the card then prints the
 * receipt rather than a word it guessed. A test pins this shape to the tool's own template.
 */
function givenSaid(summary: string): { label: string; delivery: 'sent' | 'held' } | null {
  const said =
    /^(\S+) given to .+? \([^()]+\); it (went to .+? straight away|is held until .+? is free)/.exec(
      summary,
    )
  if (said === null) return null
  const [, label, went] = said
  if (label === undefined || went === undefined) return null
  if (pieceNumbersOf(label) === null) return null
  return { label, delivery: went.startsWith('went') ? 'sent' : 'held' }
}
