import type { NoticeItem } from '../transcript-message-contracts'
import type { TranscriptState } from '../transcript-state-contracts'
import type { TranscriptEvent } from '../../../../shared/conversation-events'
import { A_RENEWED_SIGN_IN_SAYS } from '../../../../shared/a-renewed-sign-in'
import { isRefusalRemedy } from '../../../../shared/refusals'
import type { RefusalRemedy, RefusalTold } from '../../../../shared/refusals'
import { splitQualified } from '../tool-inventory'
import { withoutHandles } from '../outgoing-card'
import { nextId } from './items'
import { everyToolRow } from './cards'

export const REOPENED_ON_A_RENEWED_SIGN_IN =
  'Its sign-in changed since it started; reopened on the current one. Nothing was re-sent: send ' +
  'again to carry on.'

/**
 * ⚑ **What a conversation this app reopened on the current sign-in, for words held for it, says**
 * — once, at the seam ({@link ReopenedEvent.because} `the-sign-in-moved-on`). ⚑ What it carried
 * goes in next, and the one cost it paid is named: the reopen waited until it would stop no turn,
 * card, background work or planning.
 */
export const REOPENED_FOR_WHAT_WAITED =
  'Its sign-in changed after this conversation started, so this app reopened it on ' +
  'the current one to deliver what was waiting for it. It no longer has its “Allow for this ' +
  'conversation” approvals.'

/**
 * ⚑ **D-017 · R10 — what the conversation that could never be reopened says**, once, as its last
 * line ({@link ReplacedByEvent}). ⚑ The host follows the replacement for every sender — an agent,
 * the app, and a person's own send or Reopen, which opens the one in its place — so the line says
 * both.
 */
export const REPLACED_BY_A_NEW_CONVERSATION =
  'This conversation could not be reopened, so a new conversation of the same agent took its ' +
  'place — with the agent’s memory, not this history. What is sent to this one goes there, and ' +
  'reopening this one opens that one.'

/** ⚑ **D-017 · R10 — and the new one's first line** ({@link ReplacesEvent}), the other end. */
export const TOOK_THE_PLACE_OF_ONE =
  'This conversation took the place of one of the same agent’s that could not be reopened. It has ' +
  'the agent’s memory, not that conversation’s history.'

/**
 * 🔴 **425 · the five remedies, as the clause a person reads** (HO-023 §2.2) — the vocabulary is
 * `shared/refusals.ts`'s, and this is the only place in the renderer that says anything about it.
 *
 * ## ⛔ The person's register, and why it is not the model's sentence
 *
 * ⚠️ **The model is told *you may*; a person is told *it may*.** A transcript is read by somebody
 * watching an agent they did not send the call for, and a clause in the second person would be this
 * app instructing the reader to go and write a file. ⛔ **So this is a third-person clause
 * about the agent**, and the sentence the model got stays in `main/` where each door owns it.
 *
 * ⚑ **One policy word drives both, which is the whole point of a code.** The rail tables decide
 * WHETHER there is an act and WHICH; the two registers only spell it. Free text would have been two
 * independent sentences, free to promise different things about the same refusal.
 *
 * ⚠️ **Five clauses and no two alike.** `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`
 * is asserted over this table, because a nine-rail map folded onto five words is exactly the shape
 * where a copy-paste makes two rails say one thing and nothing fails.
 */
const REMEDY_SAID: Readonly<Record<RefusalRemedy, string>> = {
  'change-what-you-sent-and-call-again': 'it can change what it sent and call again',
  // ⛔ **Not *"will work"*, which is the promise `retryable` already makes one clause to the left.**
  // A launch in flight can also FAIL and abandon its reservation; this says what there is to do, and
  // the row's own `retrying may work` says whether it can succeed.
  'make-the-same-call-when-this-settles':
    'there is nothing to change — the same call again, once that has settled',
  'shorten-the-summary-and-attach-the-long-form':
    'it can shorten the summary and put the long form in a file it names',
  'shorten-the-answer-or-put-the-long-form-in-a-file':
    'it can shorten the answer, or put the long form in a file and name its full path in the answer',
  // ⚠️ **Not *"from the choices it was offered"*.** A free-form request offers none, and it reaches
  // this rail the moment a part is left out — see the vocabulary's own note.
  'answer-every-part-the-request-asks-for':
    'it can answer again, every part, in the form the request asks for',
  // 🔴 **733 · it said *"it can offer a different Markdown file"*** (`731` F-4). ⛔ Both conditions
  // were gone: the store holds more types than Markdown (`HO-097`), and `726` · R92 took away the
  // *workspace* the code word still spells. ⚑ The act is the model's sentence's own — *"Write a file
  // and offer that path instead — one of the types this app holds"* — in this register. ⚠️ The code
  // word stays: it is stored in `tool_refused` rows and read back by {@link isRefusalRemedy}.
  'offer-a-workspace-markdown-file-that-reads':
    'it can write a file of a type this app holds and offer that instead',
}

/**
 * ⛔ **The clause, or `null` because there is nothing to say** (425).
 *
 * 🔴 **Three inputs, one outcome: absent, `null`, and a word from a later build all draw NOTHING.**
 * ⚠️ **This is where it differs from `permanenceSaid`** — which `466` moved to
 * `shared/refusals.ts` so the digest could read it too — **and which prints a word it does not know
 * AS ITSELF.** A permanence is a fact about the refusal and every row has one, so the raw
 * word is the honest thing to show. ⛔ **A remedy is a PROMISE about an act**, and a build that does
 * not recognise the word cannot say the act still exists — advertising a gesture that no longer works
 * is the defect `421` spent a dispatch deleting, one surface over.
 *
 * ⚑ **The PO's own database is the fixture**: every `tool_refused` row written before this dispatch
 * arrives here with no field at all, and must read as a refusal that simply had nothing to offer.
 */
function remedySaid(remedy: unknown): string | null {
  return isRefusalRemedy(remedy) ? REMEDY_SAID[remedy] : null
}

/**
 * ⚑ **The clause with its separator, or an empty string** (425) — so the row that has nothing to
 * offer is drawn exactly as it was before this dispatch, down to the last character.
 *
 * ⛔ **`an-unenumerated-state-counts-as-success` is the trap this shape is written against.** A
 * reader that draws nothing for an absent remedy has to be MEASURED drawing nothing, with a present
 * one beside it — most rails take this branch, so it is the common case and
 * not the edge.
 */
export function remedyClause(remedy: unknown): string {
  const said = remedySaid(remedy)
  return said === null ? '' : ` · ${said}`
}

export function notice(
  state: TranscriptState,
  level: NoticeItem['level'],
  text: string,
  providersWords = false,
): void {
  state.items.push({
    kind: 'notice',
    id: nextId(state, 'notice'),
    level,
    text,
    ...(providersWords ? { providersWords: true as const } : {}),
  })
}

export function signInNotice(
  state: TranscriptState,
  text: string,
  detail: string,
  retrying: boolean,
  needsSignIn = false,
  captions?: NonNullable<NoticeItem['signIn']>['captions'],
): void {
  const previous = state.items.find((item) => item.id === state.lastError?.signInNotice)
  const details = previous?.kind === 'notice' ? (previous.signIn?.details ?? []) : []
  const item: NoticeItem = {
    kind: 'notice',
    id: previous?.id ?? nextId(state, 'notice'),
    level: retrying ? 'warn' : 'error',
    text,
    signIn: {
      state: retrying ? 'retrying' : 'refused',
      ...(retrying && captions !== undefined ? { captions } : {}),
      ...(needsSignIn ? { needsSignIn: true as const } : {}),
      details: [...details, detail],
    },
  }
  if (previous?.kind === 'notice') Object.assign(previous, item)
  else state.items.push(item)
  state.lastError = { raw: detail, shown: text, signInNotice: item.id }
}

export function currentSignInNotice(state: TranscriptState): NoticeItem | null {
  const item = state.items.find((one) => one.id === state.lastError?.signInNotice)
  return item?.kind === 'notice' && item.signIn ? item : null
}

export function endSignInRetry(state: TranscriptState, stopped = false): void {
  const item = currentSignInNotice(state)
  if (item?.signIn?.state !== 'retrying') return
  item.signIn.state = 'ended'
  const text = item.signIn.captions?.[stopped ? 'stopped' : 'ended']
  if (text !== undefined) item.text = text
  item.level = 'info'
}

/**
 * ⚑ **685 · the notice just drawn for a refusal waits for its call's receipt** — see
 * {@link TranscriptState.refusalsAwaitingReceipt}. ⚠️ Called straight after {@link notice}, so the
 * last item IS that notice.
 */
export function awaitItsReceipt(
  state: TranscriptState,
  tool: string,
  rail: string,
  told: RefusalTold | null,
): void {
  const drawn = state.items[state.items.length - 1]
  if (drawn?.kind !== 'notice') return
  state.refusalsAwaitingReceipt.push({ tool, rail, notice: drawn, told })
}

/**
 * 🔴 **685 · a receipt that IS a refusal hands its words to the notice** (`675` F-d).
 *
 * ⚑ **Every app refusal's receipt begins `refused (<rail>): `** — `agent-tools.ts` writes the
 * model's text that way, and each provider's normalizer keeps the head of it (the first 200
 * characters, where `675` put the act). ⛔ **The join is by content and by count**: the call must
 * be one of this app's own declared tools (a foreign server sharing a tool's name is not enough),
 * the receipt must begin with the waiting rail's prefix, and exactly ONE refusal may match — two of
 * one tool on one rail in flight draw nothing, the refusal to guess `landOutgoing` makes.
 *
 * ⚠️ **An outgoing card already prints this receipt** (`outgoing-card.ts`), so the refusal is
 * claimed and nothing is added — one account of one call.
 */
export function tellItsRefusal(
  state: TranscriptState,
  name: unknown,
  summary: string,
  printedElsewhere: boolean,
  matched?: (rail: string) => void,
): RefusalTold | null {
  if (state.refusalsAwaitingReceipt.length === 0) return null
  const set = state.tools.set
  if (typeof name !== 'string' || set === null || set.declared === null) return null
  const split = splitQualified(set.naming, name)
  if (split === null || split.server !== set.declared.server) return null
  const matching = state.refusalsAwaitingReceipt.filter(
    (waiting) => waiting.tool === split.tool && summary.startsWith(`refused (${waiting.rail}): `),
  )
  const only = matching.length === 1 ? matching[0] : undefined
  if (only === undefined) return null
  matched?.(only.rail)
  state.refusalsAwaitingReceipt = state.refusalsAwaitingReceipt.filter((one) => one !== only)
  if (printedElsewhere) return only.told
  if (only.told !== null) {
    // The host kept the whole sentence: the notice quotes it whole, in part only if it was cut.
    only.notice.told = withoutHandles(only.told.text)
    if (only.told.dropped > 0) only.notice.toldInPart = true
    return only.told
  }
  const words = summary.slice(`refused (${only.rail}): `.length)
  const cut = RECEIPT_CUT.exec(words)
  only.notice.told = withoutHandles(cut === null ? words : words.slice(0, cut.index))
  if (cut !== null) only.notice.toldInPart = true
  return null
}

/**
 * ⚠️ **The mark each provider's normalizer puts on a receipt it cut at the row's bound** — Claude's
 * `truncate` appends `…`, and Codex's `boundedSummary` appends `… (N of M characters)`
 * (`packages/runtime`). ⛔ Read here as a SHAPE and never re-derived: a normalizer that changed its
 * mark would leave the mark inside the quotation — the old drawing — rather than cut a word.
 */
const RECEIPT_CUT = /…(?: \(\d+ of \d+ characters\))?$/

/**
 * ⚑ **685 · the short form a call's own row kept** — its receipt as the ledger has it, wherever the
 * row is drawn: a top-level row or a sub-agent card's. `null` when no row holds one.
 */
export function receiptOf(state: TranscriptState, callId: string): string | null {
  for (const row of everyToolRow(state))
    if (row.callId === callId) return row.result?.summary ?? null
  return null
}

/**
 * ⚑ **685 · the clause a refusal notice ends with** — the one spelling, read by the notice and by
 * the readable export. `''` when the call's receipt told it nothing this fold could join.
 */
export function toldClause(told: string | undefined, inPart = false): string {
  if (told === undefined) return ''
  return inPart ? ` · it was told, in part: “${told}”` : ` · it was told: “${told}”`
}

/**
 * Keeps the rows this turn's errors drew, so a sign-in this app renewed can stand in for them, and
 * says the turn carried on once it did. A turn anybody else starts begins a new account.
 */
export function followTheTurnsErrors(
  state: TranscriptState,
  event: TranscriptEvent,
  from: number,
): void {
  // A turn that failed on a refused sign-in is the turn a renewal follows: its ending folds too.
  if (
    event.type === 'error' ||
    (event.type === 'turn' && event.state === 'failed' && event.loginRefused === true)
  ) {
    for (const item of state.items.slice(from)) {
      if (item.kind === 'notice') state.turnErrorRows.push(item)
    }
    return
  }
  if (event.type !== 'user_turn') return
  const renewed = state.renewedLine
  const continued =
    event.attribution === 'app_authored' && event.appNotice === 'a-turn-continued-after-sign-in'
  if (continued && renewed !== null) {
    for (const row of state.turnErrorRows) {
      const index = state.items.indexOf(row)
      if (index >= 0) state.items.splice(index, 1)
    }
    renewed.line.text = `${renewed.name} sign-in changed. The agent is carrying on.`
  } else if (event.carriesOn === true && renewed !== null) {
    if (event.carriedOnAfterAccountChange === true) {
      renewed.line.text = `${renewed.name} sign-in changed. The agent is carrying on.`
    } else if (renewed.replacedCopy === true) {
      renewed.line.text = A_RENEWED_SIGN_IN_SAYS.carriedOn(renewed.name)
    }
  }
  state.turnErrorRows = []
  state.renewedLine = null
}
