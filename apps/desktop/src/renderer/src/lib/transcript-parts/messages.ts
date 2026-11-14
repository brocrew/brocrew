import type { QueuedItem } from '../transcript-message-contracts'
import type {
  ToolItem,
  OutgoingWords,
  OutgoingTakeOn,
  OutgoingGive,
  OutgoingQuestionPart,
  OutgoingQuestion,
} from '../transcript-tool-contracts'
import type { TranscriptState } from '../transcript-state-contracts'
import type { HandedPath } from '../../../../shared/attachment-contracts'
import type { QueuedMessageEvent } from '../../../../shared/conversation-events'
import type { QuestionAskedEvent } from '../../../../shared/question-contracts'
import type { AgentMessageKind, WorkReport } from '../../../../shared/task-contracts'
import { moveOfferOf, moveOriginOf } from '../../../../shared/move-request'
import { anActionAsked } from '../../../../shared/questions'
import { isAgentMessageKind, isAWorkReport } from '../../../../shared/tasks'
import { splitQualified } from '../tool-inventory'
import { argumentExcerpt } from '../argument-excerpt'
import { readAnsweredQuestion } from '../answered-question'
import { pieceNumbersOf } from '../../../../shared/piece-called'
import { type Timed, nextId } from './items'
import { everyCard } from './cards'

/**
 * The queued message an ending is ABOUT (077, corrected at 413) — **by name**, and by position
 * only where there is no name to go on.
 *
 * ## ⛔ The premise that stopped being true, and the row it settled
 *
 * ⚠️ **This used to return *the last unresolved one*, and said why**: *"the host allows only one
 * queued message per session at a time, so `the last unresolved one` and `the one this event is
 * about` are the same item by construction."* ⛔ **`394` made the mailbox hold a work message AND
 * a question, and that sentence was never revisited.** `406` reported the gap; this is it closed.
 *
 * 🔴 **Measured before it was fixed.** Queue `m_work`, queue `m_q`, then publish
 * `message_unqueued{messageId: 'm_work', reason: 'sent'}` — the fold spliced out the QUESTION's
 * row and left the work's on screen, where nothing would ever settle it. ⚑ Both halves are
 * damage: a child's question disappears from the one surface a person reads it on, and a message
 * that HAS been sent goes on saying *not sent · waiting for the turn to end* for ever.
 *
 * ## ⚠️ The fallback is for ledgers with no names, and only those
 *
 * ⛔ **A row that carries an id and does not match is NOT the answer.** Returning it would settle
 * the wrong row, which is the defect; returning nothing sends the fold down its rebuild branch,
 * which is right — an ending whose beginning is not on screen is exactly what that branch is for
 * (`054` pages the transcript). ⚑ Rows with no id at all are pre-`354` and pair only with endings
 * that have none either, so the two eras never mix in one window.
 */
export function openQueuedItem(
  state: TranscriptState,
  messageId?: string,
): (QueuedItem & Timed) | undefined {
  let unnamed: (QueuedItem & Timed) | undefined
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'queued' || item.outcome !== null) continue
    if (messageId !== undefined && item.messageId === messageId) return item
    if (item.messageId === undefined) unnamed ??= item
  }
  return unnamed
}

/**
 * 🔴 **537 · the held row this id NAMES, and nothing else** — no fallback and no position.
 *
 * ⛔ **Deliberately NOT {@link openQueuedItem}, whose unnamed fallback would be wrong here.** That
 * one exists for a ledger written before `354`, where an ending with no id may only pair with a
 * beginning that has none either; this is asked by `work_given`, which is written by
 * `RuntimeHost.recordTheGive` and carries the held message's id whenever the brief was held, and
 * since D-022 by `work_rebriefed`, whose id names the held give a new brief rides. ⚠️
 * **So a miss here is a real absence** — `054` pages the transcript, and a window that joined this
 * window after the message was queued holds the give without the row it is about — and answering it
 * with *the oldest row nobody named* would put one message's label, or one piece's brief, on another
 * message.
 *
 * ⚑ **`outcome === null` for {@link openQueuedItem}'s reason**: a row that has already ended is not
 * waiting for anything, and a label or a brief would change a sentence nobody is still reading as
 * *now*.
 */
export function heldMessageNamed(
  state: TranscriptState,
  messageId: string,
): (QueuedItem & Timed) | undefined {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'queued' || item.outcome !== null) continue
    if (item.messageId === messageId) return item
  }
  return undefined
}

/**
 * 🔴 **658 · which of this app's two messaging tools a call is — by the names THIS session was
 * handed.**
 *
 * ⛔ **Not by a provider's spelling written here.** Claude says `mcp__brobot__reply_to_parent` and
 * Codex `brobot__reply_to_parent`; both are the `tool_inventory` row's `naming` applied to its
 * `declared.server`, and {@link splitQualified} is the one reader of that convention. ⚠️ So a session
 * that was never told (`set` or `declared` null) recognises nothing, and its calls draw as every
 * other tool does — the honest fallback, not a guess.
 *
 * ⚠️ **The two TOOL names are this app's own and the same for every provider** — `agent-tools.ts`
 * declares them — and the call must also be one the session was declared, so a foreign server that
 * happened to share our server's name and a tool's name is not enough on its own.
 *
 * ⛔ **`name` is read as `unknown`**: replay is a trust boundary, and a row whose name is not a string
 * must draw as the tool row it always drew as rather than take the whole fold down.
 */
export function outgoingToolOf(
  state: TranscriptState,
  name: unknown,
  summary: unknown,
): OutgoingWords['tool'] | null {
  const set = state.tools.set
  if (typeof name !== 'string' || set === null || set.declared === null) return null
  const split = splitQualified(set.naming, name)
  if (split === null || split.server !== set.declared.server) return null
  if (!set.declared.tools.some((tool) => tool.name === split.tool)) return null
  // ⚑ **And the two question tools** ({@link QuestionTool}) and the give, by the same
  // names-it-was-handed rule.
  return split.tool === 'reply_to_parent' ||
    split.tool === 'message_agent' ||
    split.tool === 'ask_question' ||
    split.tool === 'request_action' ||
    split.tool === 'pass_question_up' ||
    split.tool === 'give_work' ||
    split.tool === 'take_on_work'
    ? split.tool
    : // ⚑ **D-047 · `update_work` only where its arguments carry a new brief** — a status, a title
      // or a close writes no `work_sent`, so it would wait for a row that never comes and stand
      // beside a real new brief as a second candidate for its row. ⚠️ A brief whose key was cut out
      // of the arguments' bound leaves the call a tool row, as it always drew.
      split.tool === 'update_work' &&
        typeof summary === 'string' &&
        argumentExcerpt(summary, 'brief') !== null
      ? split.tool
      : null
}

/**
 * ⚑ **Has this call's host row landed yet** — the one question {@link callsWaitingFor} asks of each
 * card, per tool.
 */
function awaitsItsRow(words: OutgoingWords | undefined): boolean {
  if (words === undefined) return false
  if (words.tool === 'reply_to_parent') return words.reply === null
  if (words.tool === 'message_agent') return words.sent === null
  if (words.tool === 'give_work') return words.given === null
  if (words.tool === 'take_on_work') return words.taken === null
  if (words.tool === 'update_work') return words.rebriefed === null
  return words.asked === null
}

/** ⚑ A recognised call with no host row on it yet. */
function noRowYet(tool: OutgoingWords['tool']): OutgoingWords {
  if (tool === 'reply_to_parent') return { tool, reply: null }
  if (tool === 'message_agent') return { tool, sent: null }
  if (tool === 'give_work') return { tool, given: null }
  if (tool === 'take_on_work') return { tool, taken: null }
  if (tool === 'update_work') return { tool, rebriefed: null }
  return { tool, asked: null }
}

/**
 * ⚑ **The ids a host row names, and the argument its call names them in** — `message_agent`'s
 * `agent` (the recipient conversation), and the `piece` of `reply_to_parent` and `ask_question`.
 *
 * ⚠️ **A piece has TWO spellings a call may use** — its id and its label, since D-016 every door
 * takes either — so a piece pairs by both. ⛔ **`labelUnknown` when the row's label is not in view**:
 * an argument spelled as a label cannot then be compared, and is not a mismatch.
 */
function pairingIdOf(
  words: OutgoingWords,
): { key: string; ids: readonly string[]; labelUnknown: boolean } | null {
  if (words.tool === 'message_agent') {
    return words.sent === null
      ? null
      : { key: 'agent', ids: [words.sent.toConversation], labelUnknown: false }
  }
  if (words.tool === 'reply_to_parent') {
    return words.reply === null ? null : aPieceNamed(words.reply.piece, words.reply.label)
  }
  // ⚑ **UI-003 · a take-on names no id** — its arguments are a title and a brief, and its row keeps
  // the title as the call wrote it (trimmed, by its door's schema), so it pairs by the title. ⚠️
  // Without it a row that came ahead of its call landed on an older take-on whose run died.
  // ⚑ **D-047 · a give's piece is minted by the give**, so its arguments name it nowhere either:
  // it pairs by the title the same way.
  if (words.tool === 'give_work') {
    return words.given === null
      ? null
      : { key: 'title', ids: [words.given.title], labelUnknown: false }
  }
  if (words.tool === 'take_on_work') {
    return words.taken === null
      ? null
      : { key: 'title', ids: [words.taken.title], labelUnknown: false }
  }
  // ⚑ **D-047 · a new brief names its piece** — by id or label, as `ask_question` does.
  if (words.tool === 'update_work') {
    return words.rebriefed === null
      ? null
      : aPieceNamed(words.rebriefed.piece, words.rebriefed.label)
  }
  // ⚑ **A question** — `ask_question` names the piece it is about, `pass_question_up` the question
  // it carries; ⚠️ one about no piece pairs by position alone.
  const asked = words.asked
  if (asked === null) return null
  if (words.tool === 'pass_question_up') {
    return asked.passedUpFrom === undefined
      ? null
      : { key: 'question', ids: [asked.passedUpFrom], labelUnknown: false }
  }
  return asked.piece === undefined ? null : aPieceNamed(asked.piece, asked.label)
}

/** ⚑ A piece's two spellings, as {@link pairingIdOf} compares them. */
function aPieceNamed(
  piece: string,
  label: string | undefined,
): { key: string; ids: readonly string[]; labelUnknown: boolean } {
  return label === undefined
    ? { key: 'piece', ids: [piece], labelUnknown: true }
    : { key: 'piece', ids: [piece, label], labelUnknown: false }
}

/**
 * 🔴 **658 · does this call's own argument name the row's id?** — `match`, `mismatch`, or `unknown`
 * when the argument is absent or was cut before it could say.
 *
 * ⚑ **A correlation between two records of ONE act**: the arguments the model sent, and the host's
 * row of what it did with them. ⛔ The value compared is an opaque id (`sess_…`, `work_…`) or a
 * piece's label — and a give's or a take-on's title, the one prose their rows repeat as it was
 * sent — and it decides only WHICH recognised call a row belongs to, never whether a call is ours.
 * ⚠️ **Why it exists**: the host's row names no call id (neither provider hands one to the tool
 * layer), and two calls of one tool in flight — a parallel batch, or a call whose turn died before it
 * answered — are otherwise told apart by position alone.
 */
function pairing(summary: unknown, words: OutgoingWords): 'match' | 'mismatch' | 'unknown' {
  // ⚑ **D-047 · a new brief is told apart by its brief as well as its piece** — the host keeps it
  // as the call sent it, so a call whose own brief differs is never its call. ⚠️ Without it, the
  // row of a call that was not recognised (its brief cut out of the arguments' bound) waits ahead
  // of every later call on that piece, and the next one would draw the brief before it.
  if (words.tool === 'update_work' && words.rebriefed !== null && typeof summary === 'string') {
    const brief = argumentExcerpt(summary, 'brief')
    if (brief !== null) {
      const same = brief.cut
        ? words.rebriefed.brief.startsWith(brief.text)
        : words.rebriefed.brief === brief.text
      if (!same) return 'mismatch'
    }
  }
  const want = pairingIdOf(words)
  if (want === null || typeof summary !== 'string') return 'unknown'
  const excerpt = argumentExcerpt(summary, want.key)
  if (excerpt === null) return 'unknown'
  // ⚑ **A title is kept trimmed** and the argument is as the model wrote it.
  const said = want.key === 'title' ? { ...excerpt, text: excerpt.text.trim() } : excerpt
  if (!said.cut) {
    if (want.ids.includes(said.text)) return 'match'
    return want.labelUnknown && isALabel(said.text) ? 'unknown' : 'mismatch'
  }
  return want.labelUnknown || want.ids.some((id) => id.startsWith(said.text))
    ? 'unknown'
    : 'mismatch'
}

/**
 * ⚑ **A non-empty string, as a replayed field actually is** — {@link relayerIdentity}'s discipline
 * for every id and slug the two messaging cards read.
 */
export function isAnId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * ⚑ **688 · a piece's label, as a replayed or live field actually is** — a string `pieceCalled`
 * spells, the store's own replay bound (`boundPieceNamed`) asked again here, because a LIVE row
 * reaches the fold without passing through the store. ⛔ Never *W0*, never *W1.02*.
 */
export function isALabel(value: unknown): value is string {
  return typeof value === 'string' && pieceNumbersOf(value) !== null
}

/**
 * 🔴 **688 · R22 — is this held row BroBot's plan go-ahead?** See {@link QueuedItem.goAhead}.
 *
 * ⚑ **The `user_turn` arm's rule, asked of a held row and of its ending**: app-authored, and no
 * subject. ⛔ Each subject is read the way the arms read it — a report as a report, a relay and a
 * notice as a non-empty string — so a row edited on disk cannot make itself the go-ahead by carrying
 * a subject in a shape this fold ignores.
 */
function isTheGoAhead(
  event: Pick<QueuedMessageEvent, 'attribution' | 'work' | 'relayedFrom' | 'appNotice'>,
): boolean {
  return (
    event.attribution === 'app_authored' &&
    !isAWorkReport(event.work) &&
    !wasRelayed(event.relayedFrom) &&
    !carriesANotice(event.appNotice)
  )
}

/** One call a host row could belong to — the conversation's own, or a sub-agent's on its card. */
interface MessagingCall {
  readonly summary: unknown
  /** `null` for a sub-agent's call: its row lives on a card, which draws no outgoing card. */
  readonly item: ToolItem | null
}

/**
 * ⚑ **Every call of this tool still waiting for its host row** — at every depth.
 *
 * ⚠️ **A sub-agent's call counts** (found in review): its handler writes the same row into this
 * ledger, so it is a candidate even though it can never wear the card. ⛔ **A call whose run ended
 * without an answer stops waiting once a NEWER call of its tool exists** — a late row may still land
 * on it inside its own turn's aftermath, but a dead call must not stand beside every later one as a
 * second candidate for the rest of the window.
 */
function callsWaitingFor(state: TranscriptState, tool: OutgoingWords['tool']): MessagingCall[] {
  const mine = state.items.filter(
    (item): item is ToolItem & Timed => item.kind === 'tool' && item.outgoing?.tool === tool,
  )
  const newest = mine[mine.length - 1]
  const waiting: MessagingCall[] = mine
    .filter((item) => {
      if (item.result !== null || (item.unfinished === true && item !== newest)) return false
      return awaitsItsRow(item.outgoing)
    })
    .map((item) => ({ summary: item.summary, item }))
  for (const card of everyCard(state)) {
    for (const row of card.body) {
      if (row.kind !== 'tool' || row.result !== undefined || row.unfinished === true) continue
      if (outgoingToolOf(state, row.name, row.summary) === tool)
        waiting.push({ summary: row.summary, item: null })
    }
  }
  return waiting
}

/**
 * 🔴 **658 · the host's row lands on the call that wrote it** — one call, or none, never a guess.
 *
 * ⚑ **Chosen by the call's own argument first** ({@link pairing}): a call that names the row's id
 * wins when it is the only one; a call that names a DIFFERENT id is never a candidate. ⚠️ Failing
 * that, the one call left still waiting takes it. ⛔ **Two candidates the arguments cannot tell
 * apart** — a parallel batch whose arguments were cut before the id — **and the row lands on
 * neither**: both calls draw from their receipts, `heldMessageNamed`'s refusal to guess.
 *
 * ⚠️ **A row whose call is a SUB-AGENT's lands nowhere**: that call is on a card, which draws no
 * outgoing card. ⚑ **No candidate at all ⇒ the row came FIRST** — see
 * {@link TranscriptState.outgoingAhead}, where it waits for its call.
 */
export function landOutgoing(state: TranscriptState, words: OutgoingWords): void {
  const open = callsWaitingFor(state, words.tool).filter(
    (call) => pairing(call.summary, words) !== 'mismatch',
  )
  const named = open.filter((call) => pairing(call.summary, words) === 'match')
  const chosen = named.length === 1 ? named[0] : open.length === 1 ? open[0] : undefined
  if (chosen !== undefined) {
    if (chosen.item !== null) chosen.item.outgoing = words
    return
  }
  if (open.length === 0) state.outgoingAhead.push(words)
}

/**
 * 🔴 **D-047 · a give's answer settles which `work_sent` is its own.** ⚠️ The row pairs by its title
 * alone ({@link pairingIdOf}), and a give whose call ended before its answer goes on in the host —
 * so its row lands on the newest give of that title still waiting, which can be a retry of it.
 * ⚑ **The receipt names the piece the call gave** — `give_work`'s own sentence begins *"W1.2 given
 * to …"* — so a row naming another comes off the call, which takes its own from those waiting ahead
 * of a call. ⛔ A call whose answer gave nothing — a refusal, an error — keeps none.
 */
export function settleTheGive(state: TranscriptState, item: ToolItem): void {
  if (item.outgoing?.tool !== 'give_work' || item.result === null) return
  const { summary, ok } = item.result
  const itsOwn = (given: OutgoingGive): boolean =>
    ok && summary.startsWith(`${given.label} given to `)
  if (item.outgoing.given !== null && itsOwn(item.outgoing.given)) return
  const own = state.outgoingAhead.find(
    (words) => words.tool === 'give_work' && words.given !== null && itsOwn(words.given),
  )
  if (own === undefined) {
    if (item.outgoing.given !== null) item.outgoing = { tool: 'give_work', given: null }
    return
  }
  state.outgoingAhead = state.outgoingAhead.filter((words) => words !== own)
  item.outgoing = own
}

/**
 * ⚑ **UI-003 · the take-on that holds this piece** — on its call's card, or waiting ahead of its
 * call; the newest first. `null` for a piece no take-on in view holds.
 */
export function takeOnOf(state: TranscriptState, piece: string): OutgoingTakeOn | null {
  for (const words of state.outgoingAhead) {
    if (words.tool === 'take_on_work' && words.taken?.piece === piece) return words.taken
  }
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing?.tool !== 'take_on_work') continue
    if (item.outgoing.taken?.piece === piece) return item.outgoing.taken
  }
  return null
}

/**
 * 🔴 **658 · the reply for this piece went nowhere** — marked on the card that carries it, or on the
 * row still waiting ahead of its call. ⚑ The newest such reply: a piece is answered once.
 */
export function markUndelivered(state: TranscriptState, piece: string, because: string): void {
  for (const words of state.outgoingAhead) {
    if (words.tool === 'reply_to_parent' && words.reply?.piece === piece) {
      words.reply.undelivered = because
      return
    }
  }
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing?.tool !== 'reply_to_parent') continue
    if (item.outgoing.reply?.piece !== piece) continue
    item.outgoing.reply.undelivered = because
    return
  }
}

/**
 * ⚑ **A recognised call claims a row that landed ahead of it** — the one whose id its arguments name,
 * or else the only one of its tool waiting; never one its arguments contradict, and never a guess
 * between two. ⛔ **Not while a sub-agent's call of the same tool is waiting** unless the arguments
 * name the row: the row could be that call's.
 */
export function claimAhead(
  state: TranscriptState,
  tool: OutgoingWords['tool'],
  summary: string,
): OutgoingWords {
  const ahead = state.outgoingAhead.filter(
    (words) => words.tool === tool && pairing(summary, words) !== 'mismatch',
  )
  const named = ahead.filter((words) => pairing(summary, words) === 'match')
  const nestedWaiting = callsWaitingFor(state, tool).some((call) => call.item === null)
  const only =
    named.length === 1 ? named[0] : ahead.length === 1 && !nestedWaiting ? ahead[0] : undefined
  if (only !== undefined) {
    state.outgoingAhead = state.outgoingAhead.filter((words) => words !== only)
    return only
  }
  return noRowYet(tool)
}

/**
 * ⚑ **The question this conversation sent, by its request id** — on the call that carries it, or
 * waiting ahead of its call; the newest first. `null` for a request that is not one of ours (a
 * provider's own card), or a question that landed on no card.
 */
export function questionSent(state: TranscriptState, requestId: string): OutgoingQuestion | null {
  for (const words of state.outgoingAhead) {
    if ('asked' in words && words.asked?.requestId === requestId) return words.asked
  }
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing === undefined || !('asked' in item.outgoing))
      continue
    if (item.outgoing.asked?.requestId === requestId) return item.outgoing.asked
  }
  return null
}

/** End actions when their own piece ends, including rows waiting for their tool call. */
export function endActionsAbout(state: TranscriptState, piece: unknown): void {
  if (!isAnId(piece)) return
  const end = (words: OutgoingWords | undefined): void => {
    if (words?.tool !== 'request_action') return
    const asked = words.asked
    if (asked?.piece === piece && asked.answered === undefined) asked.closed = 'withdrawn'
  }
  for (const words of state.outgoingAhead) end(words)
  for (const item of state.items) if (item.kind === 'tool') end(item.outgoing)
}

/**
 * ⚑ **`question_asked`, read as the card draws it** — each field as a replayed row actually is:
 * an id a non-empty string, the words a string, a part only with a prompt, an option only with a
 * label. `null` for a row with no request id, which nothing could ever close.
 */
export function questionAsked(event: QuestionAskedEvent): OutgoingQuestion | null {
  if (!isAnId(event.requestId)) return null
  const piece = isAnId(event.piece) ? event.piece : undefined
  const parts = Array.isArray(event.questions) ? event.questions : []
  return {
    requestId: event.requestId,
    ...(anActionAsked(event.action) ? { action: event.action } : {}),
    ...(moveOfferOf(event.move) === undefined ? {} : { move: moveOfferOf(event.move) }),
    ...(piece === undefined ? {} : { piece }),
    ...(piece !== undefined && isALabel(event.label) ? { label: event.label } : {}),
    ...(isAnId(event.passedUpFrom) ? { passedUpFrom: event.passedUpFrom } : {}),
    prompt: typeof event.prompt === 'string' ? event.prompt : '',
    parts: parts.flatMap((part: unknown): OutgoingQuestionPart[] => {
      if (typeof part !== 'object' || part === null) return []
      const { id, header, prompt, options, multiSelect, allowOther, secret } = part as Record<
        string,
        unknown
      >
      if (typeof prompt !== 'string') return []
      const offered = (Array.isArray(options) ? options : []).flatMap((option: unknown) => {
        if (typeof option === 'string') return [{ label: option }]
        const { label, description } = (option ?? {}) as { label?: unknown; description?: unknown }
        if (typeof label !== 'string') return []
        return [typeof description === 'string' ? { label, description } : { label }]
      })
      // ⚑ **UI-009 · each rule only where the row states it** — an absent flag is *not said*, and the
      // card reads it as the narrower answer (`UserInputQuestion`'s own reading).
      return [
        {
          id: typeof id === 'string' ? id : '',
          ...(typeof header === 'string' && header !== '' ? { header } : {}),
          prompt,
          options: offered,
          ...(multiSelect === true ? { multiSelect: true as const } : {}),
          ...(allowOther === true ? { allowOther: true as const } : {}),
          ...(secret === true ? { secret: true as const } : {}),
        },
      ]
    }),
    ...(isAnId(event.context) ? { context: event.context } : {}),
  }
}

/**
 * ⚑ **UI-009 · the call whose card carries that question** — its item id, so *Open the
 * conversation* lands on the card; `undefined` while its row waits ahead of its call, or for a
 * question that is not on this page.
 */
export function askedQuestionItemIn(state: TranscriptState, requestId: string): string | undefined {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing === undefined || !('asked' in item.outgoing))
      continue
    if (item.outgoing.asked?.requestId === requestId) return item.id
  }
  return undefined
}

/**
 * 🔴 **UI-011 · the row a piece's brief is drawn on, in the conversation it was given to** (F037)
 * — the relayed turn that opened it ({@link RelayedItem.opened}), or the held row still carrying it
 * ({@link QueuedItem.label}), by the piece's label; so a give card's cut note lands on the whole
 * brief. ⚑ **The FIRST**: a new brief opens a later turn under the same label, and the card shows
 * the brief it gave. `undefined` for a brief that is not on this page.
 */
export function briefItemIn(state: TranscriptState, label: string): string | undefined {
  for (const item of state.items) {
    if (item.kind === 'relayed' && item.opened?.label === label) return item.id
    if (item.kind === 'queued' && item.label === label) return item.id
  }
  return undefined
}

/**
 * The user's own message — the runtime has no event for it, the app knows it sent one.
 *
 * `attribution` is spread rather than assigned so the ordinary case pushes an item with **no such
 * key at all**: absent is the honest reading of "the host recorded us sending this", and an
 * explicit `undefined` would be a field claiming to have been considered.
 */
/**
 * 🔴 **F093 · keep the whole text a turn handed the provider on the message it drew** — for "Show
 * what the model got". ⛔ A string, read as one: replay is a trust boundary.
 */
export function keepWhatWasSent(
  state: TranscriptState,
  sent: unknown,
  from = state.items.length - 1,
): void {
  if (typeof sent !== 'string') return
  const drawn = state.items
    .slice(Math.max(0, from))
    .filter(
      (item) =>
        item.kind === 'user' ||
        item.kind === 'relayed' ||
        item.kind === 'appNotice' ||
        item.kind === 'workReport' ||
        item.kind === 'continuation',
    )
  for (const item of drawn) {
    item.sent = sent
    if (drawn.length > 1) item.sentWithOthers = true
  }
}

export function appendUserMessage(
  state: TranscriptState,
  text: string,
  attribution?: 'provider_transcript',
  attachments?: readonly HandedPath[],
): void {
  state.items.push({
    kind: 'user',
    id: nextId(state, 'user'),
    text,
    ...(attribution ? { attribution } : {}),
    // Spread, so an ordinary turn carries no such key — the same rule `attribution` follows above.
    ...(attachments && attachments.length > 0 ? { attachments: [...attachments] } : {}),
  })
  // 096: a user message opens a turn, and that is the Changes pane's scope axis. It is counted HERE
  // rather than read off a provider turn id because Codex's diff carries one and Claude's edits carry
  // nothing comparable — keying on it would hand the scope toggle to one provider and take it from
  // the other. Where the message sits in the transcript is a fact about both.
  state.changes.turn += 1
}

/**
 * 🔴 **The go-ahead, drawn as BroBot's and not as anybody's bubble** (278 §1, from 276).
 *
 * ⚑ **The turn counter is bumped here too, and that is not symmetry for its own sake.** 096's axis
 * is *"where a turn begins"*, and this begins one — the provider receives the message, works, and
 * writes files under it. A continuation that did not count would put every change it produced in
 * the previous turn's scope, which is the Changes pane quietly attributing work to the wrong prompt.
 *
 * This go-ahead currently carries no attachments: `endPlanMode` publishes only text and attribution. If paths are added later, this item and its component must display them. `app-authored-turn.test.ts` checks the absence on the event so that contract change becomes visible.
 */
export function appendAppTurn(state: TranscriptState, text: string): void {
  state.items.push({ kind: 'continuation', id: nextId(state, 'continuation'), text })
  state.changes.turn += 1
}

/**
 * 🔴 **A turn the app sent to report something it observed** (624) — see {@link AppNoticeItem}.
 *
 * ⚑ **`changes.turn` is bumped for {@link appendAppTurn}'s reason**: the provider receives this
 * and answers it, so a scope axis that did not count it would file whatever the agent does about
 * a decision or an answer under the prompt before it.
 *
 * ⛔ **A parameter rather than a field read off the event in here**, which is
 * {@link appendRelayedTurn}'s shape: this function is also the one `transcript.ts`' own tests
 * drive directly, and the fold above it is where a replayed word is checked.
 */
export function appendAppNotice(state: TranscriptState, text: string, notice: string): void {
  state.items.push({ kind: 'appNotice', id: nextId(state, 'appNotice'), text, notice })
  state.changes.turn += 1
}

/**
 * 🔴 **A turn the app sent to report on work this conversation gave out** (406) — see
 * {@link WorkReportItem}.
 *
 * ⚑ **`changes.turn` is bumped for {@link appendAppTurn}'s reason**: this really is a turn, the
 * provider really received it, and `045` opens a turn row from the event underneath it. A reader
 * that treated it as chrome would show work with no visible cause.
 */
export function appendWorkReport(
  state: TranscriptState,
  text: string,
  report: WorkReport,
  relayer: {
    readonly relayedFromProfile: string | undefined
    readonly relayedFrom?: string
  } | null = null,
): void {
  state.items.push({
    kind: 'workReport',
    id: nextId(state, 'workReport'),
    text,
    report,
    ...(relayer === null ? {} : { relayed: true as const }),
    ...relayNavigation(relayer?.relayedFrom),
    ...(relayer?.relayedFromProfile === undefined
      ? {}
      : { relayedFromProfile: relayer.relayedFromProfile }),
  })
  state.changes.turn += 1
}

/**
 * 🔴 **A turn whose words another conversation wrote** (413) — see {@link RelayedItem}.
 *
 * ⚑ **`changes.turn` is bumped for {@link appendAppTurn}'s reason** and it matters most here: a
 * piece one agent gives another is the turn the whole of that work happens under, so a scope axis
 * that did not count it would file every file the child touched under the previous prompt.
 */
export function appendRelayedTurn(
  state: TranscriptState,
  text: string,
  /**
   * ⚑ **545 · the relayer's identity, or `undefined` when the ledger cannot name one.** ⛔ A
   * parameter rather than a field read off the event inside here, because this function is also
   * the one `transcript.ts`'s own tests drive directly.
   */
  relayedFromProfile: string | undefined,
  /** ⚑ **688** — {@link RelayedItem.says}, already read as a member by the caller. */
  says?: AgentMessageKind,
  relayedFrom?: string,
): void {
  state.items.push({
    kind: 'relayed',
    ...relayNavigation(relayedFrom),
    id: nextId(state, 'relayed'),
    text,
    ...(relayedFromProfile === undefined ? {} : { relayedFromProfile }),
    ...(says === undefined ? {} : { says }),
  })
  state.changes.turn += 1
}

/**
 * 🔴 **678 · the relayed turn just appended gives a piece, or gives it a new brief** — title it now
 * if the row that titles it came first (held, and every new brief), or leave it waiting for that
 * row (idle). See {@link RelayedItem.opened}.
 *
 * ⚑ **688 · the turn's OWN label first** (`687` H6; D-016 · R4 puts it on both branches), so a page
 * that begins at that turn — the row a turn earlier is outside the window — still names the piece.
 * ⛔ Read as a label ({@link isALabel}) and never as truthy: a live row reaches this fold without the
 * store's replay bound.
 */
export function openedAPiece(state: TranscriptState, piece: string, itsOwnLabel?: unknown): void {
  const turn = state.items[state.items.length - 1]
  if (turn?.kind !== 'relayed') return
  const given = state.piecesGiven.get(piece)
  const label = isALabel(itsOwnLabel) ? itsOwnLabel : given?.label
  turn.opened = {
    ...(label === undefined ? {} : { label }),
    ...(given?.title === undefined ? {} : { title: given.title }),
  }
  if (given === undefined) state.briefsAwaitingTheirTitle.set(piece, turn)
}

/**
 * ⚑ **658 · who gave a piece in hand, as far as this ledger says** — see
 * {@link TranscriptState.pieceGivers}. ⛔ Each row adds the half it carries — the give its
 * conversation, the brief its identity — whichever of the two arrives first. ⚑ A piece taken on for
 * a person has one row and one half: its `work_given` says the person gave it.
 */
export function rememberTheGiver(
  state: TranscriptState,
  piece: string,
  half: { profile: string } | { conversation: string } | { person: true },
): void {
  state.pieceGivers.set(piece, { ...state.pieceGivers.get(piece), ...half })
}

/**
 * ⛔ **Did another conversation write these words?** (413) — asked of the stored value, not of the
 * type.
 *
 * ⚠️ **`isAWorkReport` one field over states the reason and this inherits it**: a replayed event is
 * broadly cast after `JSON.parse`, `boundStoredEvent` has no arm for this key, and a row written by
 * a later build — or edited — can carry anything here. ⛔ A truthiness check would let `{}` or `0`
 * decide which entry a person reads.
 *
 * The navigation id is separately bounded by {@link relayNavigation}; this check decides authorship.
 */
/** Authorship is retained even when its navigation target cannot be used. */
function relayNavigation(value: unknown): { relayedFrom?: string } {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    ? { relayedFrom: value }
    : {}
}

export function wasRelayed(relayedFrom: unknown): boolean {
  return typeof relayedFrom === 'string' && relayedFrom.length > 0
}

/**
 * ⚑ **This app's own report rides the row** — {@link AppNoticeItem.notice}'s reading: a non-empty
 * string, like {@link wasRelayed}'s, because a notice word this build has no sentence for is still
 * a notice and never the go-ahead.
 */
export function carriesANotice(appNotice: unknown): appNotice is string {
  return typeof appNotice === 'string' && appNotice.length > 0
}

/**
 * ⛔ **WHO relayed them, as the stored value actually is** (545) — {@link wasRelayed}'s discipline,
 * one field over, and asked for the same reason.
 *
 * ⚠️ **Replay is a trust boundary**, so this reads a non-empty STRING rather than anything truthy:
 * a row edited on disk must not be able to put an object where a person reads a heading.
 * ⚑ **The LENGTH is the store's question and not this one** — `boundRelayedIdentity` drops a slug
 * that is not one — so this stays the same two-line shape as its neighbour rather than becoming a
 * second opinion about a format `runtime-ipc.ts` owns.
 *
 * ⛔ **`undefined` is *this app cannot name the relayer*** and the surface has a word for it; it is
 * never spelled as an empty string, which would be a heading nobody can read.
 */
export function relayerIdentity(relayedFromProfile: unknown): string | undefined {
  return typeof relayedFromProfile === 'string' && relayedFromProfile.length > 0
    ? relayedFromProfile
    : undefined
}

/**
 * What a held message is and who it came from, read from its `message_queued` or, when the window
 * paged past that, from its `message_unqueued` alone. Each fact is read the way the user_turn arm
 * reads it, and a fact that is absent or malformed is left off.
 *
 * - `messageId` is its name, so an ending settles the row it names (see {@link QueuedItem.messageId}).
 * - `report`: a reply held behind a running turn is not the person's message.
 * - `relayed` and `relayedFromProfile` come only where the relay itself was read, so a row with an
 *   identity and no conversation names nobody; `says` likewise.
 * - `appNotice` is read as a non-empty string (see {@link carriesANotice}).
 * - `goAhead` marks BroBot's go-ahead, never the person's (see {@link isTheGoAhead}).
 */
export function queuedProvenance(
  event: Pick<
    QueuedMessageEvent,
    | 'movedFrom'
    | 'messageId'
    | 'attachments'
    | 'work'
    | 'relayedFrom'
    | 'relayedFromProfile'
    | 'appNotice'
    | 'answeredQuestion'
    | 'attribution'
    | 'says'
  >,
): Omit<QueuedItem, 'kind' | 'id' | 'text' | 'outcome' | 'detail'> {
  const movedFrom = moveOriginOf(event.movedFrom)
  const relayed = wasRelayed(event.relayedFrom)
  const relayer = relayed ? relayerIdentity(event.relayedFromProfile) : undefined
  const answeredQuestion = readAnsweredQuestion(event.answeredQuestion)
  return {
    ...(movedFrom === undefined ? {} : { movedFrom }),
    ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
    ...(event.attachments ? { attachments: event.attachments } : {}),
    ...(isAWorkReport(event.work) ? { report: event.work } : {}),
    ...(relayed ? { relayed: true as const, ...relayNavigation(event.relayedFrom) } : {}),
    ...(relayer === undefined ? {} : { relayedFromProfile: relayer }),
    ...(carriesANotice(event.appNotice) ? { appNotice: event.appNotice } : {}),
    ...(answeredQuestion ? { answeredQuestion } : {}),
    ...(isTheGoAhead(event) ? { goAhead: true as const } : {}),
    ...(relayed && isAgentMessageKind(event.says) ? { says: event.says } : {}),
  }
}
