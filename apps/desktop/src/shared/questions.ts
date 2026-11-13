import type { PersistedEventInfo, TranscriptEvent } from './conversation-events'
import type { QuestionEndedWithItsPieceEvent, RequestRoutedEvent } from './question-contracts'
import { PASS_UP_RECIPIENTS } from './question-contracts'
import type {
  AboutWork,
  AboutWorkIs,
  ActionAsked,
  ActionFile,
  ChainHop,
  ChainReading,
  EscalationChain,
  EscalationLink,
  LedgerWalkKind,
  OfferedAnswer,
  PassUpRecipient,
  QuestionRecipient,
  RaisedQuestion,
  RequestOnlyAPersonCanSettle,
  RequestState,
  RoutedRequest,
  WhereARequestWent,
  WorkInHand,
} from './question-contracts'

import type { ChannelRefusal } from '@brobot2/runtime'

/** ⛔ **Whether this request is still somebody's to answer** — one table rather than a `!==` list. */
export const REQUEST_IS_OPEN: Readonly<Record<RequestState, boolean>> = {
  open: true,
  answered: false,
  rejected: false,
  decided: false,
  withdrawn: false,
  abandoned: false,
  // ⚑ **396.** ⛔ Nobody is waiting: the provider that raised it died with the app that was running
  // it, so an answer would reach nothing. `admitAnswer` refuses through this table rather than
  // through a list of its own.
  stranded: false,
  // ⚑ **397.** ⛔ The card was safe-rejected to the provider when the turn was stopped, so there is
  // no longer a request on the other side to receive anything. `admitAnswer` refuses through this
  // table, and now NAMES this ending rather than falling through to the adapter's `not-pending`.
  interrupted: false,
  // ⚑ **591.** ⛔ The work it was about is gone, so there is nothing left for an answer to decide.
  // ⚠️ **This is the one entry `591` added, and adding it is what the closed table is for**: a
  // ledger row whose subject is already dead is a lie whatever the window is (HO-082 §4.1).
  'work-withdrawn': false,
  // ⚑ **D-016.** ⛔ The work it was about was closed by its giver: nothing is left to decide.
  'work-closed': false,
  // ⛔ The work it was about was handed back: nothing is left to decide.
  'work-replied': false,
  // ⚑ **D-009.** ⛔ Nobody is left to answer it: the conversation it was addressed to has ended.
  'recipient-ended': false,
}

/** ⛔ The members, in the order a model is shown them. */
export const QUESTION_RECIPIENTS = [
  'the-parent',
  'a-person',
  // 🔴 **D-009 · F012 — a third end: an agent the asker names** (ruling 1–2, which amends HO-088
  // §2.1: open messaging carries the ask and never the answer). ⚑ By the piece it owns or by its
  // conversation id (D-016 · commit 7 · R1).
  'an-agent',
] as const satisfies readonly QuestionRecipient[]

/**
 * ⚑ **What each one means, for a MODEL choosing between them** (611).
 *
 * ⚠️ **It INSTRUCTS and states a fact about the call; it does not describe how routing works**
 * (HO-015 §2) — neither sentence says what a channel is, what escalation is, or what the app does
 * afterwards. ⛔ And neither promises an answer: `581`'s bound is that we can prove what was sent
 * and never what was heeded.
 */
export const RECIPIENT_MEANS: Readonly<Record<QuestionRecipient, string>> = {
  'the-parent':
    "'the-parent' sends it to the conversation that gave you this work, which is where a question about the work belongs unless you were told otherwise.",
  'a-person':
    "'a-person' puts it in front of the person running this app, for something only they can decide — what they want, which of two things to do, a fact nobody here has.",
  'an-agent':
    "'an-agent' sends it to the agent you name in agent, by the piece it owns (W1.2) or by its id from list_agents; it answers, or says it cannot, and it cannot pass your question on.",
}

/**
 * ⚑ **The {@link ChannelRefusal} on a routing, or `null` because nothing refused it** (611).
 *
 * ⛔ **ONE narrowing, shared**, so a payload, a line, a smoke assertion and a queue row cannot
 * disagree about whether a row has one. ⚠️ The field lives on exactly one arm of
 * {@link WhereARequestWent}, and every reader that wants the word rather than the ARM comes
 * through here.
 */
export function theChannelRefusalIn(request: RoutedRequest): ChannelRefusal | null {
  return request.went.is === 'the-person-the-channel-left-it-with' ? request.went.because : null
}

/**
 * ⛔ **Is this one of the two ends?** — asked of a value that has crossed a tool boundary (611).
 *
 * ⚑ **`325`'s rule: a vocabulary the validator has not been taught is a refusal, never a pass.**
 * ⚠️ And a MISSING value fails it too, which is `HO-088` §2.2 in code — the app does not default
 * the recipient, so a call that did not name one is refused rather than routed somewhere.
 */
export function isQuestionRecipient(value: unknown): value is QuestionRecipient {
  return typeof value === 'string' && (QUESTION_RECIPIENTS as readonly string[]).includes(value)
}

/** ⛔ {@link isQuestionRecipient}'s rule, for the pass-up door's narrower list. */
export function isPassUpRecipient(value: unknown): value is PassUpRecipient {
  return typeof value === 'string' && (PASS_UP_RECIPIENTS as readonly string[]).includes(value)
}

/**
 * ⛔ **What each arm stands for, in one line** — the exhaustive `Record` every closed vocabulary in
 * this app owns, so a fourth arm is a compile error rather than a blank space on a surface
 * (`a-closed-vocabulary-guards-what-a-member-says`).
 *
 * ⚠️ **For a reader of a LEDGER and never for a model.** `CHANNEL_REFUSAL_SENTENCES` is the
 * vocabulary a refusal is explained to a caller in, and `QUESTION_SENTENCES` is what a refused call
 * reads; neither is spliced in here, for `question-rails.ts`' stated reason.
 */
export const WENT_STANDS_FOR: Readonly<Record<WhereARequestWent['is'], string>> = {
  'the-parent': 'the conversation that gave the asker its work owes the answer',
  'the-person-the-asker-named': 'the asker addressed it to a person, and nothing refused it',
  'the-agent-the-asker-named': 'the asker addressed it to an agent it named, which owes the answer',
  'the-person-the-channel-left-it-with':
    'the channel refused it, so it never left the conversation that raised it',
}

/**
 * 🔴 **Read one routing row's destination** (611) — the ONE place the wire's two fields become the
 * union above, so no reader has to know the correspondence.
 *
 * ## ⛔ The refusal is asked FIRST, and the order is a fail-closed choice
 *
 * ⚠️ **A row carrying a {@link ChannelRefusal} is a person's whatever else it says.** ⛔ Reading
 * `to` first would let a row that somehow carried both be handed to a parent as answerable, which
 * is the one direction that costs something — `question-rails.ts`' own *"asked BEFORE the ending"*
 * argument, one field over.
 *
 * ## ⚑ Nothing new is written to the wire, and that is deliberate
 *
 * ⛔ **`to` IS the declaration.** {@link RequestRoutedEvent} already carried both fields; what
 * `611` changed is that `to: 'a-person'` may now arrive without a `because`, and this fold is where
 * that stops being a surprise. ⚠️ **Every row written before `611` is read the same way it always
 * was**: the only writer of `to: 'a-person'` was the refused branch, so the middle arm is
 * unreachable for historic rows rather than guessed at for them.
 */
export function whereItWent(event: RequestRoutedEvent): WhereARequestWent {
  if (event.because !== undefined) {
    return { is: 'the-person-the-channel-left-it-with', to: 'a-person', because: event.because }
  }
  if (event.to === 'a-person') return { is: 'the-person-the-asker-named', to: 'a-person' }
  if (event.to === 'an-agent') return { is: 'the-agent-the-asker-named', to: 'an-agent' }
  return { is: 'the-parent', to: 'the-parent' }
}

/**
 * Whether a routing row reads as its writers write one: the request's id, where it went, a refusal
 * as words when it carries one, and — where it went to the parent or to an agent the asker named —
 * who that is. ⚑ Only a request that went to a person may name no conversation: one raised where
 * nobody spawned the asker. ⛔ The one check {@link deriveRoutedRequests} folds a routing by, so a
 * routing every reader leaves out is one a counted reader counts.
 */
export function aWellFormedRouting(event: RequestRoutedEvent): boolean {
  const routing = event as unknown as Readonly<Record<string, unknown>>
  const aName = (value: unknown): value is string => typeof value === 'string' && value !== ''
  if (!aName(routing['requestId'])) return false
  if (routing['because'] !== undefined && typeof routing['because'] !== 'string') return false
  const parent = routing['parent']
  if (routing['to'] === 'a-person') return parent === undefined || parent === null || aName(parent)
  return (routing['to'] === 'the-parent' || routing['to'] === 'an-agent') && aName(parent)
}

/** Whether a stored value is an {@link ActionAsked}, every file named in full. */
export function anActionAsked(value: unknown): value is ActionAsked {
  if (value === null || typeof value !== 'object') return false
  const files = (value as { files?: unknown }).files
  return (
    Array.isArray(files) &&
    files.every(
      (one: unknown) =>
        one !== null &&
        typeof one === 'object' &&
        typeof (one as ActionFile).resource === 'string' &&
        typeof (one as ActionFile).name === 'string',
    )
  )
}

/**
 * 🔴 **Whether a person can answer this question where there is no card, and with what** (619).
 *
 * ⛔ **Three refusals, and each one is a fact about the question rather than a policy.**
 *
 * 1. ⚠️ **A read that missed** (`undefined`). `questionsRaisedInSession` SKIPS a row it cannot
 *    parse — *"a reader with a hole is honest, a reader with an invented question is not"* — and
 *    inventing an offer out of that absence would put buttons on a question nobody can read.
 * 2. ⛔ **A question the PROVIDER raised.** It has a card, `transcript.ts` draws it, and
 *    `attention.ts` already carries what it offers; a second offer composed here is `214 §3`'s
 *    defect — two surfaces deciding what one request offers.
 * 3. ⚠️ **More than one part, or a part with no options.** `AttentionLimit` already rules both:
 *    `'multiple'` because *"one click cannot answer two, and answering one is not an answer"*, and
 *    `'free-form'` because *"no options at all, so there is nothing to click; the answer is
 *    typed"*. ⚑ **This is that rule, not a second one** — stated here because this population has
 *    no live row to carry an {@link AttentionLimit} on.
 *
 * 🔴 **It does NOT ask whether anybody still holds the conversation.** ⛔ That is the WINDOW's
 * question and the window is the only thing that can answer it; folding it in here would make a
 * fact about the question depend on which window asked.
 */
export function whatTheAskerOffered(raised: RaisedQuestion | undefined): OfferedAnswer | null {
  if (raised === undefined) return null
  if (raised.raisedBy !== 'this-app') return null
  // ⛔ **Exactly one**, and `[0]` is guarded by the length test rather than by a non-null
  // assertion: a list this app composed has one part and a passed-up one has as many as the
  // provider asked for.
  if (raised.questions.length !== 1) return null
  const part = raised.questions[0]
  if (part === undefined) return null
  // ⚠️ **`label` and never a second spelling** — it is the string `answerToForward` matches an
  // answer against, so a button that sent anything else would be refused as not one of the
  // responses this request offers.
  //
  // ⛔ **The empty label is dropped, and it is reachable rather than defensive**: `ask_question`
  // bounds the options' total LENGTH and nothing refuses an empty one, so a model may offer a
  // choice with no word on it — and a blank button is `106`'s control that cannot say what it
  // does. ⚑ When every label is empty this returns `null`, which is the same absence as offering
  // none.
  const options = part.options.map((one) => one.label).filter((label) => label !== '')
  if (options.length === 0) return null
  return { part: part.id, options }
}

/**
 * 🔴 **One session's ledger folded into the requests it raised.**
 *
 * ⛔ **Pure, total, and ordered by the ledger it was handed.**
 *
 * ## ⚠️ The transitions
 *
 * ⚠️ **Stated without a COUNT** (`396`'s correction, kept): a list whose sentence counts itself goes
 * quietly wrong the first time anything is added to it.
 *
 *  - **`request_routed`** opens the row at `open`. ⛔ A second routing for an id that is still OPEN
 *    is ignored — a duplicate would be a bug, not a state. ⚑ One for an id whose last row is CLOSED
 *    opens a new row: a resume's repeated provider id (`396` §3).
 *  - **`user_decision`** closes it: `answered` and `rejected` are the user-input outcomes, and every
 *    other value is a PERMISSION outcome and lands on `decided`. ⚑ Derived from the value rather
 *    than from which kind of card it was, because the ledger row is what a reader has.
 *  - **`request_resolved`** closes it `withdrawn` — the provider cleared it on its own (`051`).
 *  - **`request_stranded`** closes it `stranded` — a launch found it open with nothing behind it
 *    (`396`). ⛔ **A transition no provider can produce**, which is the point: it is the app writing
 *    down a difference the ledger could not otherwise hold. ⚠️ It read *"the ONE transition"* until
 *    `397` added the second, which is what a sentence that counts itself always does.
 *  - **`request_interrupted`** closes it `interrupted` — the turn it was raised in was stopped and
 *    every open card went with it (`397`). ⛔ **The other one no provider can produce**, and the
 *    writer emits one per open request rather than one for the conversation, because
 *    `RequestBroker.settleAll` kills them one by one and a single row would be a summary of an act
 *    the ledger could then not enumerate.
 *  - **`work_taken_back`** closes `work-withdrawn` every open request whose question named THAT
 *    piece — the giver took back the work the question was about, so there is nothing left to decide
 *    (591, HO-082 §2.2; one row for the piece since D-016). ⛔ **The third ending no provider can
 *    produce**, and it reaches only questions this app raised about the piece: a provider's own
 *    request names no piece.
 *  - **`work_closed`** closes `work-closed` exactly the requests `work_taken_back` would — the giver
 *    closed the work the question was about (D-016) — and it too is an ending no provider can
 *    produce.
 *  - **`request_escalated`** closes NOTHING (398), and since `612` NOTHING WRITES ONE — this
 *    branch reads a ledger that already holds them and no new row will ever reach it (HO-088
 *    §3.1). It stamps {@link RoutedRequest.escalatedAt} on a
 *    row this ledger still holds, open or closed, and leaves the state exactly where it was — the
 *    one transition in this fold that is not a transition. ⛔ It is applied to a CLOSED row too, so
 *    that a stamp written at the deadline and an answer that arrived a moment earlier cannot make
 *    the fold depend on which of the two the sweep happened to see first.
 *  - **`status: ended | errored`** abandons what the stopped provider held: the conversation went
 *    away with somebody waiting on it. ⚑ **D-017 · R4 — from a `launched` row on, a question
 *    this app asked (its `question_asked` row) outlives it**: it stays open until it is answered or
 *    withdrawn, and the answer starts the conversation again. ⚠️ A ledger with no such row replays
 *    as it always did: every open request is abandoned.
 *  - **`launched`** and **`question_asked`** close nothing: they say which of the requests a stop
 *    leaves open — and `question_asked` which piece a question is about, for the take-back and the
 *    close above.
 *  - **nothing else**, which is why a fold over a long conversation costs one comparison per row.
 *
 * ⛔ **A routing that is no well-formed routing opens nothing** ({@link aWellFormedRouting}): it is
 * left out and told to `notWellFormed` by its ordinal, so a counted reader knows it did not read
 * every request — never folded into one whose destination or answerer is a guess.
 */
export function deriveRoutedRequests(
  askedBy: string,
  entries: Iterable<PersistedEventInfo>,
  notWellFormed?: (ordinal: number) => void,
  checkState?: (state: readonly unknown[], complete?: boolean) => void,
): readonly RoutedRequest[] {
  const rows: RoutedRequest[] = []
  const open = new Map<string, number>()
  // ⚑ **The LATEST row each id opened** (398) — because {@link settle} deletes from `open` and a
  // stamp that is not an ending must still reach a row after it has closed. ⛔ Two maps rather than
  // one that is never pruned: `open` answers *what is still somebody's to answer* and is walked on a
  // session ending, and putting closed rows into it would abandon them a second time.
  const everSeen = new Map<string, number>()
  // ⚑ **D-017 · R4** — the questions this app asked, and whether a launch has said they outlive a stop.
  const oursToOutlive = new Set<string>()
  let questionsOutliveAStop = false
  // ⚑ **D-016 · the piece each question this app asked is about** — what a take-back or a close ends.
  const pieceOf = new Map<string, string>()

  const settle = (requestId: string, state: RequestState, at: number): void => {
    const index = open.get(requestId)
    if (index === undefined) return
    rows[index] = { ...rows[index]!, state, endedAt: at }
    open.delete(requestId)
  }

  for (const entry of entries) {
    checkState?.([rows, open, everSeen, oursToOutlive, pieceOf])
    const event = entry.event
    if (event.type === 'launched') {
      questionsOutliveAStop = true
      continue
    }
    if (event.type === 'question_asked') {
      oursToOutlive.add(event.requestId)
      if (event.piece !== undefined) pieceOf.set(event.requestId, event.piece)
      continue
    }
    if (event.type === 'request_routed') {
      if (!aWellFormedRouting(event)) {
        notWellFormed?.(entry.ordinal)
        continue
      }
      if (open.has(event.requestId)) continue
      open.set(event.requestId, rows.length)
      // ⚑ **Overwritten, never guarded** (398). One id CAN legitimately open a second row — a
      // request id repeated across a resume, which `396` §3 measured — and this map exists only so a
      // stamp can reach a row after {@link settle} has taken it out of `open`. ⛔ Using it to refuse
      // the second routing would delete that second row, which is a behaviour `396` built on
      // purpose.
      everSeen.set(event.requestId, rows.length)
      rows.push({
        requestId: event.requestId,
        askedBy,
        // ⚑ **611 · absent is NULL and never a string** — see {@link RoutedRequest.parent}.
        parent: event.parent ?? null,
        // ⚑ **611 · one reading of the two wire fields, in one place** — see {@link whereItWent}.
        went: whereItWent(event),
        at: entry.at,
        state: 'open',
        endedAt: null,
        escalatedAt: null,
      })
      continue
    }
    if (event.type === 'user_decision') {
      // ⛔ **The two user-input outcomes by name, and everything else is a permission's.**
      // `UserDecisionEvent.outcome` is `PermissionDecision['outcome'] | 'answered' | 'rejected'`, so
      // an `else` here is not a catch-all — it is the other half of a union the compiler already
      // closed, and adding a permission outcome cannot silently become an answer.
      settle(
        event.requestId,
        event.outcome === 'answered'
          ? 'answered'
          : event.outcome === 'rejected'
            ? 'rejected'
            : 'decided',
        entry.at,
      )
      continue
    }
    if (event.type === 'request_stranded') {
      // ⛔ **`settle` is a no-op for a row that is already closed**, which is what makes a second
      // sweep over a ledger it has already repaired cost nothing and change nothing — the same
      // property `settleStrandedMessages` gets from its `NOT EXISTS`, here from the fold.
      settle(event.requestId, 'stranded', entry.at)
      continue
    }
    if (event.type === 'request_resolved') {
      // ⚠️ **`id`, not `requestId`, and the difference is the provider's** — `requestResolvedSchema`
      // carries *"the SAME neutral request id the card carries"* under `id`, while the decision this
      // app writes calls it `requestId`. ⛔ Two spellings of one correlation, and the fold has to
      // know both or a withdrawal would silently match nothing.
      settle(event.id, 'withdrawn', entry.at)
      continue
    }
    if (event.type === 'question_withdrawn') {
      // 🔴 **D-009 · the asker withdrew it** — `withdrawn`, the asker's side ending it, as a
      // provider withdrawing its own request already reads. Idempotent through {@link settle}.
      settle(event.requestId, 'withdrawn', entry.at)
      continue
    }
    if (event.type === 'question_ended_with_its_piece') {
      // A question this conversation passed up ends as the one it carried did, when its piece ended.
      settle(event.requestId, event.ending, entry.at)
      continue
    }
    if (event.type === 'question_recipient_ended') {
      // 🔴 **D-009 · the conversation it was addressed to ended without answering it.**
      settle(event.requestId, 'recipient-ended', entry.at)
      continue
    }
    if (event.type === 'work_taken_back') {
      // ⛔ **D-016 · the piece was taken back, so every question still open about it ends with it**
      // (591). ⚑ Idempotent through {@link settle} for `request_stranded`'s reason: a request an
      // earlier ending already closed is not in `open`, so the first ending stands — which is the
      // ending that governs what a reader should do next.
      for (const requestId of [...open.keys()]) {
        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-withdrawn', entry.at)
      }
      continue
    }
    if (event.type === 'work_closed') {
      // ⛔ **D-016 · the piece was closed by its giver** — the take-back arm above, ending in its own
      // word. Idempotent through {@link settle} for the same reason.
      for (const requestId of [...open.keys()]) {
        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-closed', entry.at)
      }
      continue
    }
    if (event.type === 'work_replied') {
      // ⛔ The piece was handed back, so every question and to-do still open about it ends with it —
      // the close arm above, in its own word.
      for (const requestId of [...open.keys()]) {
        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-replied', entry.at)
      }
      continue
    }
    if (event.type === 'request_interrupted') {
      // ⛔ **Written BEFORE the provider is asked** (`RuntimeHost.askTheWorkToStop`), which is what
      // makes this ending exist at all on a provider whose `interrupt()` never returns — Codex awaits
      // the answer to its own `turn/interrupt` request, unbounded (709). ⚑ Idempotent through {@link settle} for
      // `request_stranded`'s reason: a second interruption over a ledger the first already closed
      // costs nothing and changes nothing.
      settle(event.requestId, 'interrupted', entry.at)
      continue
    }
    if (event.type === 'request_escalated') {
      // 🔴 **The one branch that is not a transition** (398). It stamps and returns; the state
      // is untouched, because a question a person was told about is still the parent's to answer.
      //
      // ⛔ **`everSeen` and not `open`, deliberately.** A parent that answered between the deadline
      // falling due and the sweep looking leaves a CLOSED row, and dropping the stamp there would
      // make *"was a person ever told?"* depend on the order two independent writers happened to
      // run in. ⚑ The pair `(state, escalatedAt)` then says the useful thing: it escalated, and it
      // was answered anyway.
      //
      // ⚠️ **First stamp wins.** The writer refuses to escalate twice, and this refuses to record it
      // if it ever did — the moment a person was first told is not a thing a later row may move.
      const index = everSeen.get(event.requestId)
      if (index === undefined) continue
      if (rows[index]!.escalatedAt !== null) continue
      rows[index] = { ...rows[index]!, escalatedAt: entry.at }
      continue
    }
    if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      // ⚠️ **A snapshot, because {@link settle} writes to the map it is walking.**
      for (const requestId of [...open.keys()]) {
        if (questionsOutliveAStop && oursToOutlive.has(requestId)) continue
        settle(requestId, 'abandoned', entry.at)
      }
    }
  }

  checkState?.([rows, open, everSeen, oursToOutlive, pieceOf], true)
  return rows
}

/**
 * ⚑ **D-019 · the row types a conversation's two wait reads select** — `selectRoutedRequestEvents`'
 * (the rows {@link deriveRoutedRequests} folds) and `selectQuestionsRaised`' (`user_input_request`
 * and `question_asked`), both in `db/session-store.ts`. ⛔ Three lists say the same words: this one
 * and the two statements. ⚑ `status` is not here: {@link aWaitIsReadFrom} asks its state.
 */
const WHAT_THE_WAIT_READS_SELECT: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  'request_routed',
  'user_decision',
  'request_resolved',
  'request_stranded',
  'request_interrupted',
  'work_taken_back',
  'work_closed',
  'work_replied',
  'request_escalated',
  'question_withdrawn',
  'question_recipient_ended',
  'question_ended_with_its_piece',
  'question_asked',
  'launched',
  'user_input_request',
])

/** How a piece ended, as the question passed up about it ended with it, in a reader's words. */
export const HOW_ITS_PIECE_ENDED = {
  'work-replied': 'handed back',
  'work-withdrawn': 'taken back',
  'work-closed': 'closed',
} as const satisfies Record<QuestionEndedWithItsPieceEvent['ending'], string>

/**
 * Why `label` did not end as `ending` says: a conversation holding a copy passed up of a question
 * about it is starting, so that copy could not end with it.
 */
export function aPieceNotEndedWhileAQuestionStarts(
  label: string,
  ending: QuestionEndedWithItsPieceEvent['ending'],
): string {
  return `${label} wasn't ${HOW_ITS_PIECE_ENDED[ending]}: a conversation with a question about it is still starting. Try again in a moment.`
}

/** The question or ledger row that prevented a piece from ending. */
export interface UnreadQuestion {
  readonly ledger: string
  readonly question?: string
  readonly row?: number
  readonly cause: string
}

/** Why `label` did not end as `ending` says: the questions about it could not all be read. */
export function aPieceNotEndedItsQuestionsUnread(
  label: string,
  ending: QuestionEndedWithItsPieceEvent['ending'],
  unread?: UnreadQuestion,
): string {
  const where =
    unread === undefined
      ? 'its question records could not be read'
      : `${unread.question === undefined ? 'question records for conversation' : `question ${unread.question} in conversation`} ${unread.ledger}${unread.row === undefined ? '' : `, row ${String(unread.row)}`}: ${unread.cause}`
  return `${label} wasn't ${HOW_ITS_PIECE_ENDED[ending]}: ${where}. Check that record, then retry this call.`
}

/**
 * 🔴 **D-019 · a row that can move who owes a conversation its next move** — one its two wait reads
 * select and fold, so the answer they gave before it was written may not be the answer now.
 *
 * ⚑ **A `status` counts only when it ends the provider** (`ended` | `errored`): the statement selects
 * every status, and {@link deriveRoutedRequests}' one status arm acts on those two alone — so a
 * turn's `working` and `idle` move nothing it folds.
 */
export function aWaitIsReadFrom(event: TranscriptEvent): boolean {
  return aWaitReads(event.type, event.type === 'status' ? event.state : undefined)
}

/** {@link aWaitIsReadFrom}, from a row's type and, for a status, its state. */
export function aWaitReads(type: TranscriptEvent['type'], state?: string): boolean {
  if (type === 'status') return state === 'ended' || state === 'errored'
  return WHAT_THE_WAIT_READS_SELECT.has(type)
}

/**
 * 🔴 **The moment this request became a PERSON's to answer** (611, HO-090 §4).
 *
 * ## ⛔ Two clocks, one question, and the row says which it answered from
 *
 * ⚑ **A question the parent owed becomes a person's when the deadline stamps it** —
 * {@link RoutedRequest.escalatedAt}. ⚠️ **One an asker ADDRESSED to a person was a person's from
 * the instant it was written**, so its moment is {@link RoutedRequest.at} — which is the argument
 * `SessionStore.decisionsAwaitingAPerson` already makes for a refused routing, in its own words:
 * *"there is no parent that failed to answer in time and nothing an escalation would record… the
 * row is a person's from the instant it is written rather than one window later."*
 *
 * ⛔ **One function, because the ORDER and the AGE are the same fact.** The store sorts a person's
 * queue by it and the window draws *"waiting 14 minutes"* from it; two spellings would let the
 * oldest row and the one drawn as oldest be different rows.
 *
 * ⚠️ **It is not asked of a request that is nobody's** — a routing to the parent with no stamp
 * answers `null`, and a caller that has one of those is holding a row the person's queue never
 * admitted.
 */
export function aPersonsSince(request: RoutedRequest): number | null {
  if (request.escalatedAt !== null) return request.escalatedAt
  return request.went.to === 'a-person' ? request.at : null
}

/**
 * 🔴 **Has anything permission-shaped arrived at this channel?** — criterion 10, as a fold.
 *
 * ⛔ **The whole reason the routing is recorded on both arms.** A gate that dropped these would make
 * this function's answer permanently `[]` and permanently uninformative; because nothing is dropped,
 * an empty answer means *none arrived* and a non-empty one names each shape that did.
 *
 * ⚠️ **Every arrival, not the first.** A reader that returned one would pass a control that plants
 * two — standing rule 12, and the exact defect it exists to catch.
 */
export function permissionShaped(
  requests: readonly RoutedRequest[],
): readonly RequestOnlyAPersonCanSettle[] {
  return requests.filter(
    (one): one is RequestOnlyAPersonCanSettle =>
      one.went.is === 'the-person-the-channel-left-it-with',
  )
}

/**
 * 🔴 **Is a PERSON still on the hook for something this conversation raised?** (609) — the question
 * half of {@link WhatAConversationIsWaitingOn.aPerson}.
 *
 * ## ⛔ Two conditions and both are necessary
 *
 * ⚑ **{@link WhereARequestWent}'s `to` says *a person has it*; {@link REQUEST_IS_OPEN} says *it
 * can still be settled*.** ⚠️ Either alone is a different question: the first is true for ever
 * about a card somebody answered an hour ago, and the second is true of a question the PARENT owes
 * — which is {@link composeWhatEachPieceIsWaitingOn}'s FIRST arm and not this one.
 *
 * ## 🔴 611 · it reads the RECIPIENT now, and it used to read the refusal
 *
 * ⛔ **It was `permissionShaped(requests).some(...)`, which is *only a person MAY settle it*.**
 * ⚠️ Since `HO-088` §2 a conversation can also be waiting on a person because its asker ADDRESSED
 * a question there, and nothing refused anything — so the old spelling reported a conversation
 * parked on a person as having nobody outstanding at all, which is `603`'s own defect with the
 * subject changed. ⚑ **The question this answers is *is a person on the hook*, and that is `to`.**
 *
 * ## ⚠️ Escalation is deliberately not here
 *
 * ⛔ **{@link RoutedRequest.escalatedAt} does not make a request a person's for this purpose.** A
 * question routed to the parent that escalates is still the parent's to answer — `escalatedAt`'s
 * own docblock: *"Escalating does not end anything"* — and it already reads
 * `waiting-on-an-answer`. ⚑ Admitting it here would move a piece's state at an escalation while
 * nothing about the work changed, which is the exact claim `603` refused when it named the state
 * after what the worker did rather than after who owes the answer.
 *
 * ⚑ **A boolean and not a list**, because nothing joins one of these to a piece of work: a
 * provider-raised question carries {@link RaisedQuestion.piece}` === null` for ever (`430`), so
 * the fact is the conversation's and a list would suggest a join the ledger does not hold.
 */
export function aPersonOwesAnAnswerIn(requests: readonly RoutedRequest[]): boolean {
  return requests.some((one) => one.went.to === 'a-person' && REQUEST_IS_OPEN[one.state])
}

/**
 * ⛔ **What each {@link AboutWorkIs} means, for a surface that has to say something** — the
 * exhaustive table that makes a fourth member a compile error rather than a blank.
 *
 * ⚑ **The row carries the WORD and the surface carries the sentence**, so a fourth member cannot
 * reach a person as an empty line.
 *
 * ⚠️ **The first member's sentence names no label**, because the label is on the arm and only a
 * surface holding it can say `W1.2` — see `PersonsQueue.vue`, where all three are drawn.
 */
export const ABOUT_WORK_SAYS: Readonly<Record<AboutWorkIs, string>> = {
  'the-asker-named-it': 'The conversation that asked said which piece of work this is about.',
  'named-work-nothing-answers-to':
    'The conversation that asked named the piece of work this is about, and no piece this app can read answers to it.',
  'nothing-recorded-it': 'Nothing this app records says which piece of work this is about.',
}

/**
 * 🔴 **The ONE fold from *a piece a row named* to *which work, and why that answer*** (474).
 *
 * ⛔ **The WORK is read before the word**: the arm that carries work is chosen because work was
 * FOUND, never because a caller said so, and the failing direction is always the weaker claim.
 *
 * ⚠️ **`find` is handed in rather than reached for**, which is what keeps this module free of a
 * database exactly as {@link escalationChain}'s `openQuestionOf` is — and what lets the same
 * derivation serve a host that reads a store and a test that plants two rows.
 */
export function aboutTheWork(
  named: string | null,
  find: (piece: string) => WorkInHand | null,
): AboutWork {
  const found = named === null ? null : find(named)
  if (found !== null) return { is: 'the-asker-named-it', work: found }
  return { is: named === null ? 'nothing-recorded-it' : 'named-work-nothing-answers-to' }
}

/**
 * ⛔ **What a population that CANNOT name work carries** (474) — a permission, whose event type
 * has no piece to read at all.
 *
 * ⚑ **Derived through {@link aboutTheWork} rather than spelled**, so the call sites in the person's
 * queue have one derivation between them and a fourth member of {@link AboutWork} cannot
 * reach a surface by being forgotten here.
 */
export const NOTHING_NAMED_THE_WORK: AboutWork = aboutTheWork(null, () => null)

/**
 * 🔴 **The still-open questions one conversation has raised, grouped by the PIECE each one names**
 * (603, HO-091 §1) — the one derivation two doors ask in opposite directions.
 *
 * ## ⛔ Two readers, and they must agree by construction rather than by care
 *
 * ⚑ **A take-back or a close COUNTS them** — the questions it ends with the piece, in the words it
 * answers with (`591`'s repair; the ending itself is folded from the take-back or close row,
 * {@link deriveRoutedRequests}). ⚠️ **The composition READS them** —
 * `WhatAConversationIsWaitingOn.answers`, so a piece whose question is open says
 * `waiting-on-an-answer` rather than `stalled`.
 *
 * 🔴 **Spelling the pair twice is how the two would come to disagree**: a piece that goes on reading
 * *waiting on an answer* about a question the take-back or close already ended, or the reverse.
 * ⛔ **One derivation is what makes the complement provable** — `aStallItsGiverCanBeToldOf`'s own
 * argument, one subject over.
 *
 * ## ⚠️ Only `question_asked` names work, and that is the wire rather than this filter
 *
 * ⛔ **A permission-shaped routing can never appear here.** `430` measured that a provider-raised
 * question identifies its request and its parent and NOT the work, so `user_input_request` carries
 * {@link RaisedQuestion.piece}` === null` for ever and is walked past. ⚑ **Which is the right
 * answer and not a lucky one**: a giver must not be told its owner is *asking about work* because a
 * provider put a command-approval card on the screen.
 *
 * ## ⚠️ A question about NO piece holds no piece (D-016)
 *
 * ⛔ **A question to another agent may name none**, and it is not in this map: it holds none of the
 * asker's work, and no piece of it reads *waiting on an answer* because of it. ⚑ Until D-016 such a
 * question held every task its asker had; a piece now waits only on a question about itself.
 *
 * ## ⚑ {@link REQUEST_IS_OPEN} and never a list written here
 *
 * ⛔ **The same table `admitAnswer` refuses through**, so another ending cannot make this read
 * disagree with the door a giver answers at.
 *
 * ## ⚠️ A list per piece rather than a boolean, and one reader needs the list
 *
 * ⛔ **An owner may have more than one question open about one piece** — nothing refuses a second
 * `ask_question` while the first is unanswered — and a take-back or a close says how many it ended.
 */
export function openQuestionsByWork(
  requests: readonly RoutedRequest[],
  raised: ReadonlyMap<string, Pick<RaisedQuestion, 'piece'>>,
): ReadonlyMap<string, readonly RoutedRequest[]> {
  const byWork = new Map<string, RoutedRequest[]>()
  for (const request of requests) {
    if (!REQUEST_IS_OPEN[request.state]) continue
    const named = raised.get(request.requestId)?.piece ?? null
    if (named === null) continue
    const held = byWork.get(named)
    if (held === undefined) byWork.set(named, [request])
    else held.push(request)
  }
  return byWork
}

/**
 * ⛔ **The bound the walk refuses at**, and the answer to *"is a cycle impossible or refused?"* —
 * **refused**, and here.
 *
 * ⚠️ **A cycle is also unreachable today, and saying so is not the same as guarding.** A
 * conversation's parent is written exactly once, inside `createTx`, in the same transaction as the
 * row's INSERT; the child's id is minted before its slot is reserved so a give cannot name an
 * existing conversation as the child; no re-parent path exists; and `ancestorsOf`'s own CTE bounds
 * at 64 while `maxDepth` defaults to 6. ⛔ **All four of those are properties of code that could
 * change, and a walk that relied on them would hang rather than refuse when one did** — which is the
 * judgement `ancestorsOf`' bound already records.
 *
 * ⚑ **8 rather than 64**, because this walks a chain of conversations that are waiting on each other
 * and `maxDepth` defaults to 6: a chain of eight is already past the default, and a bound that is
 * reachable only by a defect should be small enough that the defect is obvious.
 */
export const CHAIN_HOP_LIMIT = 8

/**
 * 🔴 **Walk up from the conversation that asked, and say who owes what** (398).
 *
 * ⛔ **A fold, not a stored string.** `394` routed the questions and `396` gave a parent a reader for
 * them; the chain is those rows read transitively, and nothing here is written down anywhere.
 *
 * ⚠️ **The lookup is handed in rather than reached for**, which is what keeps this module free of a
 * database exactly as {@link deriveRoutedRequests} is. `openQuestionOf` answers *"is this
 * conversation itself waiting on an answer from ITS parent?"* — one open, parent-routed request, or
 * null.
 *
 * ⛔ **`seen` is the cycle refusal and {@link CHAIN_HOP_LIMIT} is the backstop**, and they are not
 * redundant: `seen` catches a loop, the limit catches a chain that is merely absurd. Either one
 * leaves `endsWithAPerson` false, because what the walk found was not an ending.
 *
 * ## 🔴 474 · `seen` held CONVERSATIONS and REQUEST IDS in one set, and that was a defect
 *
 * ⛔ **A provider's request id is session-local and this walk crosses conversations.** Codex's is a
 * JSON-RPC `RequestId` rendered by `requestKey` as `number:1` for the first server request of every
 * connection, so two conversations blocked on their first question both carry `number:1`; Claude's
 * is an SDK `toolUseID`, *"unique per tool call and scoped to the turn that raised them"*. ⚠️ **So
 * `seen.has(next.requestId)` compared two ids minted in two different namespaces**, and a parent
 * whose open question happened to share a descendant's id was refused as a CYCLE — the walk stopped,
 * `endsWithAPerson` went false, and the queue drew *"the chain above this could not be followed"*
 * over a chain that was perfectly followable. 🔴 `463` F2, on the reader nobody had looked at.
 *
 * ⛔ **The half is REMOVED rather than re-keyed**, and that is the honest version. Keyed by
 * `(conversation, request)` it could never fire: `openQuestionOf(cursor.parent)` answers with a
 * request whose `askedBy` IS `cursor.parent`, so a repeated pair implies a repeated conversation and
 * the line above has already returned. ⚑ A conjunct no input can make fail is not carrying a rule
 * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`); the conversation set is the rule, and it
 * is the one that was always doing the work.
 */
export function escalationChain(
  from: RoutedRequest,
  openQuestionOf: (sessionId: string) => RoutedRequest | null,
): EscalationChain {
  // 🔴 **611 · a question addressed to a PERSON has no hop above it** (HO-088 §2.3).
  //
  // ⛔ **The walk asks *who owes this answer*, and for an addressed question the answer is the
  // person from the first link on.** ⚠️ Walking to `parent` anyway would draw *"Ali waiting on
  // Ada, Ada waiting on you"* about a question Ada was never asked and is not waiting on — a chain
  // that names a conversation as an answerer this app did not ask, which is exactly the sentence
  // {@link decisionReading} exists rather than to print.
  //
  // ⚑ **And it is that reader's argument, not a new one**: *"a request refused entry to the
  // channel was ALWAYS a person's and no parent ever had a chance to answer it."* `HO-088` §2
  // adds a second way for that to be true, and the walk has to honour both.
  const links: EscalationLink[] = [
    {
      waiting: from.askedBy,
      requestId: from.requestId,
      on: from.went.to === 'a-person' ? null : from.parent,
    },
  ]
  if (from.went.to === 'a-person') return { links, endsWithAPerson: true }
  const seen = new Set<string>([from.askedBy])
  let cursor = from
  while (links.length < CHAIN_HOP_LIMIT) {
    // ⚑ **611 · a conversation nobody spawned ends the walk at the person** — see
    // {@link RoutedRequest.parent}. ⛔ It is the ordinary ending and not a refusal: there is no
    // hop above a top-level conversation, so nothing above it is unknown.
    const next = cursor.parent === null ? null : openQuestionOf(cursor.parent)
    // ⚑ **The ordinary ending**: the conversation that owes the answer is not itself blocked, so it
    // is the one a person has to move.
    if (next === null) return { links, endsWithAPerson: true }
    // ⛔ **A CONVERSATION seen twice is a cycle**, and it is refused rather than walked — see the
    // docblock for why the request id is no longer asked the same question.
    if (seen.has(next.askedBy)) return { links, endsWithAPerson: false }
    seen.add(next.askedBy)
    links.push({ waiting: next.askedBy, requestId: next.requestId, on: next.parent })
    cursor = next
  }
  return { links, endsWithAPerson: false }
}

/**
 * 🔴 **Read the chain into named hops** (401), with the same `name` the sentence is given.
 *
 * ⚠️ **`endsWithAPerson` alone does not settle it.** An empty `links` is unreachable from
 * {@link escalationChain} and still legal in the type, and the sentence has always refused to print
 * *"you"* for one — so the `undefined` check is the second conjunct here exactly as it was there.
 */
export function chainReading(
  chain: EscalationChain,
  name: (sessionId: string) => string,
): ChainReading {
  // ⚑ **611 · a link that owes nobody is already the person's hop** — see {@link EscalationLink.on}.
  const hops: ChainHop[] = chain.links.map((link) => ({
    waiting: name(link.waiting),
    on: link.on === null ? null : name(link.on),
  }))
  const last = chain.links[chain.links.length - 1]
  if (chain.endsWithAPerson && last !== undefined) {
    // ⛔ **611 · nothing is appended when the last link already ends at the person.** ⚠️ The push
    // exists to turn *"X waiting on Y"* into a chain that says what Y owes; a link whose `on` is
    // null has no Y, and appending would have called `name(null)`. ⚑ `unfollowable` stays false:
    // the walk ENDED, which is what that field is about.
    if (last.on !== null) hops.push({ waiting: name(last.on), on: null })
    return { hops, unfollowable: false }
  }
  return { hops, unfollowable: true }
}

/**
 * 🔴 **The chain as a sentence a person reads** (398) — HO-007 criterion 11's evidence line.
 *
 * ⛔ **The names are handed in.** A conversation has no title column; to a person it is its agent's
 * name (R41, since `734` — the basename of its working directory before) and to an agent it is its
 * agent's name and the piece it owns (D-016 · commit 7 · R3 — `sess_<uuid>` before), and which of
 * those a surface wants is the surface's business. ⚑ This owns the SHAPE of the sentence so two
 * surfaces cannot render one chain two ways.
 *
 * ⚠️ **`waiting on you` is appended only when the walk ENDED.** A chain that was refused says so
 * instead — printing *"you"* after a cycle would name a person as the answerer on the strength of a
 * walk that never reached them.
 *
 * ⚑ **A join of {@link chainReading} since `401`, and not a second walk.** The bytes it produces are
 * unchanged; what changed is that the surface drawing hops and the surface printing the line are
 * reading one derivation, which is the property `398`'s own note claimed for `links` and could not
 * deliver because links carry no names.
 */
export function chainSentence(chain: EscalationChain, name: (sessionId: string) => string): string {
  return readingSentence(chainReading(chain, name))
}

/**
 * 🔴 **A reading, joined into the line a person reads** (403) — lifted out of {@link chainSentence}
 * unchanged, because a second population now renders one.
 *
 * ⛔ **The JOIN is what both populations share, and the WALK is what they do not.** An escalated
 * question is a walk up the parents; a request only a person can settle never travelled and has
 * exactly one hop. ⚑ Giving the second its own sentence function would be two spellings of
 * *"X waiting on Y"*, free to disagree the day either is reworded — which is the drift
 * {@link chainReading} was extracted at `401` to make impossible one layer up.
 *
 * ⚠️ **`waiting on you` is still the null hop and never a name.** See {@link ChainHop.on}: an agent
 * — or a working folder — called `you` must not be able to impersonate the person.
 */
export function readingSentence(reading: ChainReading): string {
  const clauses = reading.hops.map((hop) => `${hop.waiting} waiting on ${hop.on ?? 'you'}`)
  if (reading.unfollowable) clauses.push('and the chain above that could not be followed')
  return clauses.join(', ')
}

/**
 * 🔴 **The chain for something that never travelled: one hop, and it ends at you** (403, from
 * `402` F1).
 *
 * ⛔ **A permission has no middle, whatever the depth.** A question may travel — worker to PM to a
 * person — because knowledge escalates; authority does not, so a request refused entry to the
 * channel was ALWAYS a person's and no parent ever had a chance to answer it. ⚠️ **So the walk is
 * not shortened here; there is no walk.** Rendering a PM link for one would name a conversation as
 * an answerer that this app has refused, by rail, to ask.
 *
 * ⚑ **`unfollowable` is false and that is a fact rather than a default.** The walk is not *stopped*
 * — a cycle or {@link CHAIN_HOP_LIMIT} — it is complete in one step, so a surface may print
 * *"you"* after it. See {@link ChainReading.unfollowable} for the state this is not.
 *
 * ⚠️ **A chain of one is still a chain** (`401` §2), which is why this returns a reading rather
 * than a bare name: the surface that draws hops and the surface that prints the line read one
 * derivation for both populations.
 */
export function decisionReading(
  /** 🔴 **The conversation that is waiting**, by id (403's shape, one argument narrower). */
  askedBy: string,
  name: (sessionId: string) => string,
): ChainReading {
  return { hops: [{ waiting: name(askedBy), on: null }], unfollowable: false }
}

/**
 * 🔴 **What each walk COVERS, in words a person reads** — `448`'s reach sentences, one axis over.
 *
 * ⛔ **Each sentence is about the WALK and never about what it found.** A count is what it found;
 * this is the question that produced it, which is the half `rows.length` can never supply. ⚑ Same
 * rule `448` stated for its own: *each sentence says what the LIST is, never what the caller
 * may do about it.*
 *
 * ⚠️ **The generation clause is in every sentence that read a ledger, and it is the one narrowing
 * they share.** `routedRequestsOfSession`, `piecesOfSession` and `selectDigestWindow` all read the
 * ACTIVE generation — *"a superseded projection's rows are
 * garbage, not history"* — so a row that exists only in a projection this app has replaced is not
 * counted. ⛔ Leaving it out would make *"whole workspace"* the strongest claim in the app and a
 * false one.
 *
 * 🔴 **466 · the forest's sentence carries it too.** Its rows are conversations, and the generation
 * cannot remove one of those — but each conversation's open work is folded through `piecesOfSession`
 * at `activeGeneration(sessionId)`, so a conversation whose piece rows live only in a replaced
 * projection is drawn with NO open work beside it. ⛔ The narrowing lands one field in, on `work`,
 * and the sentence says so.
 */
export const WALK_COVERS: Readonly<Record<LedgerWalkKind, string>> = {
  'every-conversation-that-routed':
    'Every conversation in this app that has ever routed a request was read: no window, no page and no limit narrowed it. Only each conversation’s live projection is read, so a request that exists solely in one this app has replaced is not counted.',
  'one-window-over-every-agents-conversation':
    'Every conversation one of this app’s agents holds was read, and from each one only the rows stamped inside the window you chose: no page and no limit narrowed it further. Only each conversation’s live projection is read, so a row that exists solely in one this app has replaced is not counted.',
  // The clause about a parent outside the reading keeps the picture honest: the tree is short at
  // the top, which is the end a person would not notice.
  'every-conversation-this-app-placed':
    'Every conversation in this reading was read: the window or tree you chose, and the conversations above them that connect them. A drawn conversation whose parent is outside the reading says so rather than pointing at nothing. A conversation no agent of this app holds is in no forest and is counted separately. Only each conversation’s live projection is read, so work that exists solely in one this app has replaced is not drawn beside it.',
  'every-conversation-this-one-gave-work-to':
    'Every conversation this one has ever given work to was read, whether or not anything is still open in it: no window, no page and no limit narrowed it. Only each of those conversations’ live projections is read, so work that exists solely in one this app has replaced is not counted.',
  // ⛔ **The one sentence in this table that promises nothing about a ledger, because this walk
  // opens none** — see this word's own entry.
  'every-conversation-this-one-spawned':
    'Every conversation this app recorded as started by this one was read, whether or not this app is still running it: no window, no page and no limit narrowed it. No conversation’s record was opened, so nothing here is folded from a transcript.',
  'every-piece-of-work-this-one-was-given':
    'This conversation’s own record was read whole for the work it was given, whoever gave it: no window, no page and no limit narrowed it. Only its live projection is read, so work that exists solely in one this app has replaced is not counted.',
  'every-conversation-that-holds-work': 'Every conversation that holds work, including roots.',
  'every-conversation-that-was-given-work':
    'Every conversation in this app that another conversation has ever given work to was read, whichever one gave it: no window, no page and no limit narrowed it. Only each conversation’s live projection is read, so work that exists solely in one this app has replaced is not counted.',
  // ⛔ **"the last month" is a SPELLING of `PROVIDER_WALL_LOOKBACK_MS` and not a second opinion
  // about it** — `a-wall-he-finds-out-about.test.ts` §1 pins the two against each other, which is
  // this repository's own device for a constant that cannot be imported without a cycle (331).
  // ⚑ The generation clause every sentence above carries is deliberately absent; see this word's
  // own entry in `LEDGER_WALK_KINDS` for why it would be false here.
  'every-provider-wall-recently-recorded':
    'Every conversation in this app was read, and from all of them together the moments a provider reported a limit inside the last month: no page narrowed it. A wall whose window has already reset is not counted, and neither is one this app recorded before that stretch began.',
  'no-such-conversation':
    'Nothing was read, because this app holds no conversation by that id. An empty list here is a statement about the id that was asked for and not about what anybody spawned or was given.',
  'no-ledger':
    'Nothing was read, because this app has no ledger open. An empty list here is a statement about this app and not about what is waiting on you.',
}

/**
 * 🔴 **{@link WALK_COVERS}, read fail-closed** (472, spending `467` F7).
 *
 * ## ⛔ Why a lookup that cannot miss needs a function
 *
 * ⚠️ **The type says it cannot miss and the WIRE says otherwise.** `preload/index.ts` casts —
 * `command({…}) as Promise<…>` — and nothing between the host and a fold validates the word that
 * arrives, so a {@link LedgerWalkKind} this build does not spell is reachable the moment the two
 * sides are not the same build. ⛔ `WALK_COVERS[walk]` then answers `undefined`, which type-checks,
 * and a surface that draws it prints the word **undefined** where a sentence about what was read
 * belongs.
 *
 * ⚑ **`438` ruled the neighbouring register must be fail-closed and `467` filed this one as F7.**
 * The ruling is here: a word with no sentence is **not an answer**, and a caller treats it exactly
 * as it treats a read that did not answer — it does not draw the rows as an authoritative list and
 * it does not claim the list is empty.
 *
 * ⛔ **`persons-queue.ts` still reads the record directly and that is UNCHANGED by this dispatch**
 * ({@link QueueCoverage.says} is typed `string`, so making it honest widens a field `453`'s surface
 * and four of its tests read). 🔴 **F7 is open for that caller and closed for this one.**
 */
export function walkCovers(walk: LedgerWalkKind): string | null {
  return WALK_COVERS[walk] ?? null
}
