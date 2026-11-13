import { givenByAConversation } from './given-by-a-conversation'
export { givenByAConversation } from './given-by-a-conversation'
import type { ActedBy } from './who-did-it'
import type { PersistedEventInfo, TranscriptEvent } from './conversation-events'
import type { WorkInHand } from './question-contracts'
import { AGENT_MESSAGE_KINDS, TASK_STATES } from './task-contracts'
import type {
  AgentMessageKind,
  ConversationWait,
  HeldWork,
  PieceRow,
  PieceWaitingOnWhoWrote,
  StatusLine,
  StoppedOnALimit,
  StoppedOnALogin,
  TaskStallCause,
  TaskState,
  TaskWait,
  TurnLimitOnTheRow,
  WaitOn,
  WhatAConversationIsWaitingOn,
  WorkGivenOut,
  WorkReport,
} from './task-contracts'
import { whoCancelledIt, type AskToStop } from './how-work-stopped'

import { aPersonsOwnWords } from './a-persons-own-words'
// ⚑ **A TYPE and nothing else** (467), so this module's own rule survives the import: it cannot
// reach a database, a host, a clock or a filesystem, and an edge that is erased at build time
// cannot give it one. ⚠️ `questions.ts` does not import this file, so the checker sees no cycle.

import type { HowAPieceEnded, WorkThatNamesIt } from './piece-called'

/** ⚑ **The same waits as data**, filtered out of {@link TASK_STATES} rather than retyped. */
export const TASK_WAITS: readonly TaskWait[] = TASK_STATES.filter((state): state is TaskWait =>
  state.startsWith('waiting-on-'),
)

/** Narrow a task state to its waiting forms. */
export function theWaitIn(state: TaskState): TaskWait | null {
  return state.startsWith('waiting-on-') ? (state as TaskWait) : null
}

/** ⚑ The same, as data — filtered out of {@link TASK_WAITS}, never retyped. */
export const CONVERSATION_WAITS: readonly ConversationWait[] = TASK_WAITS.filter(
  (wait): wait is ConversationWait =>
    wait !== 'waiting-on-the-person-who-asked' &&
    wait !== 'waiting-on-the-person-who-wrote' &&
    wait !== 'waiting-on-purpose',
)

/**
 * ⛔ **One sentence per cause, and each one names the EVENT rather than a conclusion** (400).
 *
 * ⚠️ **A closed record keyed by {@link TaskStallCause}**, so a fourth cause cannot be added without
 * somebody deciding what a parent is told about it — the shape `an-unenumerated-state-counts-as-
 * success` exists to force, applied to the sentence rather than to the state.
 *
 * ⚑ **It lives in `shared/` since `406`, and the move is the rule it already carried.** `400` wrote
 * *"one table and two callers, never two tables"* with `undrivenWorkText` and `list_tasks` as the
 * two; `406` adds a third — the row a PERSON reads in the conversation that gave the work — and
 * the renderer cannot import `main/`. ⛔ Duplicating five sentences into the renderer instead is
 * `169` §1's hazard, and the copy that drifts is always the one further from the thing it is about.
 *
 * ## 🔴 624 · `turn_ended` said one thing too many, and `614` is what made it visible
 *
 * ⛔ **It read *its turn ended and it replied nothing*, and `undrivenWorkText` then QUOTED what
 * the agent had said** — `HO-095` §5.2: *"The stall report contradicts itself. It says 'its turn
 * ended and it replied nothing' and then quotes what the agent replied."* ⚠️ Both halves were
 * written honestly: *replied* meant `reply_to_parent`, which really had not been called. ⛔ **A
 * person does not read it that way and neither does a model** — it is the app's word for one tool
 * beside the agent's own prose, and `HO-095` §3 traces what the pair cost: a false stall woke
 * BroBot, took a turn to disprove, and ended with a FALSE LESSON written to its permanent memory.
 *
 * ⚑ **The PO's replacement is a decomposition and not a rewording:** *the turn ended with the
 * task still open, and here is the last thing it said.* 🔴 **Two facts, both true, neither
 * implying the other** — the first is this entry, the second is the last exchange (`exchangePreviewLines` since D-012), and the
 * line that used to fold them into one claim is gone.
 *
 * ⚠️ **The other four are unchanged and were never this shape.** Each of them names an event this
 * app observed — a turn stopped, a restart, a message never sent, a replacement — and none of them
 * says anything about what the agent did or did not SAY.
 */
export const UNDRIVEN_SENTENCES: Readonly<Record<TaskStallCause, string>> = {
  // 🔴 **624 · what is claimed is the WORK's state and never the agent's speech** (`HO-095` §5.2).
  // ⛔ *and it replied nothing* was false beside `614`'s quotation of the agent's own last words.
  turn_ended: 'its turn ended with this work still open.',
  turn_interrupted: 'the turn it was running in was stopped.',
  app_restarted: 'the app restarted while it was open.',
  // 🔴 **648 · it said *the app stopped*, and not every producer is the app stopping** (`624`'s
  // repair, one member over). ⛔ A vanished attachment path ends a held message while the app runs
  // on. ⚑ **The member's own
  // headline was already the true sentence** — *the message carrying this work was never sent* —
  // and the specific reason rides {@link UnqueuedMessageEvent.detail}, where a person reads it on
  // the row the message left behind.
  message_never_sent: 'the message carrying it was never sent.',
  could_not_be_reopened:
    'the conversation it was given to could not be reopened, and a new conversation of the same agent took its place.',
  background_stopped:
    'it was waiting on background work, and that work stopped when its conversation ended.',
  // ⚑ **F074** — the provider and the reset are said where the row carries them
  // ({@link PieceRow.stoppedOnALimit}, `reply-rails.ts`' `theLimitSentence`); this is the sentence
  // without them.
  provider_limited: 'its turn ended because its provider’s usage limit was reached.',
  // ⚑ **F076** — whether this app reopened it is said where the row carries it
  // ({@link PieceRow.stoppedOnALogin}, `reply-rails.ts`' `theLoginSentence`); this is the sentence
  // without it.
  // ⚑ The login may be a sign-in or an API key a person saved, on either provider; the row says
  // which ({@link StoppedOnALogin}).
  login_refused:
    'its turn failed because its provider refused the sign-in or API key its conversation was started with.',
  billing_refused:
    'its turn failed because its provider would not bill the account it runs on; a person has to add credit to that account.',
}

/**
 * 🔴 **What each of the waits STANDS FOR, in the register a state name cannot carry** (603 as one
 * constant, generalised by 609).
 *
 * ⛔ **`pieceText`'s own rule (`taskText` until D-016), which every member owes exactly as the five causes do:** *"A state
 * name is this app's vocabulary; 'its turn ended with this work still open' is the fact it stands
 * for, and a reader deciding what to do next needs the fact."* ⚠️ **`624` moved the words that
 * rule is quoted with and not the rule** — see {@link UNDRIVEN_SENTENCES}.
 *
 * ⚑ A bare `waiting-on-a-person` on a line a model reads would be a word with nothing behind it —
 * `a-closed-vocabulary-guards-what-a-member-says`.
 *
 * ## ⚠️ Keyed by {@link TaskWait} and not by {@link TaskState}, and the narrowing is the point
 *
 * ⛔ **A `Record<TaskState, string | null>` would have made `null` mean two things** — *this state
 * needs no fact* for `answered`, and *this state's fact lives in another table keyed by another
 * vocabulary* for `stalled`. ⚑ Keying it to the family keeps one meaning: **every entry here is the
 * fact a wait stands for, and a wait cannot be added without one.**
 *
 * ⚠️ **Not in {@link UNDRIVEN_SENTENCES}, and the separation is the invariant.** That table is
 * keyed by {@link TaskStallCause} and every entry answers *what the engine observed STOPPING this
 * work*; nothing stopped in any of these. ⛔ An entry there would make `stalledBecause` non-null
 * for a state that is not `stalled`, which is the one thing {@link composeWhatEachPieceIsWaitingOn}
 * clears the fields to prevent — and the one thing the fold's own wait never writes.
 *
 * ⚑ **No full stop and no speaker**, {@link A_PERSON_MUST_ACT}'s shape: the line each lands on
 * already names the piece and the reader.
 *
 * 🔴 **Each one says what the LEDGER holds and never who must move.** *"Nobody has"* rather than
 * *"you have not"*: a permission can be answered by any person at the machine, and a question
 * routed to a parent can become a person's at an escalation without the work changing.
 */
export const WAITING_STANDS_FOR: Readonly<Record<TaskWait, string>> = {
  'waiting-on-an-answer': 'it asked about this and nobody has answered',
  'waiting-on-a-person': 'it raised something only a person can settle and nobody has',
  'waiting-on-a-worker': 'it handed work out and that work is still open',
  // ⚑ **D-016 · commit 6 · R3** — entered at a turn's end and left on any drive, a person's words
  // included: the ledger holds that nothing drove it since, and names nobody who must move.
  'waiting-on-the-person-who-asked':
    'its turn ended, and the person who asked for it has not written since',
  // ⚑ **F097** — the same shape: entered at the end of a turn a person's words opened, and left on
  // any drive; the ledger holds that a person wrote and nothing drove it since.
  'waiting-on-the-person-who-wrote':
    'a person wrote to it, its turn ended, and that person has not written since',
  'waiting-on-purpose': 'its status line marks it as waiting on purpose',
}

/**
 * ⚑ **The same sentence without its full stop, for a line that is already a list item** (400).
 *
 * ⛔ **One table and THREE callers, never three tables.** `list_tasks` renders the cause beside the
 * state, `undrivenWorkText` renders it in the message a parent is pushed, and `406`'s work row
 * renders it under the state word a person reads; two spellings of one observation is how a parent
 * comes to read two different accounts of one event.
 */
export function undrivenSentence(cause: TaskStallCause): string {
  return UNDRIVEN_SENTENCES[cause].replace(/\.$/, '')
}

/**
 * 🔴 **`720` · R72 — the stall causes an ASK to stop can ride beside**, as a closed record so a sixth
 * cause cannot be added without somebody deciding whether an ask reaches it.
 *
 * ⚑ **The ruling** (`709` F-2): *"A turn asked to stop that the provider completed anyway stalls with
 * the provider's word AND the one who asked (R43's two facts)."* ⛔ Until `720` only
 * `turn_interrupted` carried the ask, so a turn somebody asked to stop that Codex completed anyway
 * (`probe:codex-early-interrupt`, `709`) stalled `turn_ended` naming nobody — while
 * `howWorkStopped`, reading the same rows, said who asked.
 *
 * ⚠️ **The CAUSE is still the `turn` row's word** — the provider's, or this app's where that row
 * carries `wordOf: 'this-app'` (`720`, R71: a Claude Stop after its receipt, a Close). `turn_ended`
 * stays `turn_ended`; what rides beside it is who ASKED, never who stopped it — and the words that
 * carry it say so (`theStallAndItsAsk` in `reply-rails.ts`).
 */
export const AN_ASK_RIDES_ON: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  turn_interrupted: true,
  app_restarted: false,
  message_never_sent: false,
  could_not_be_reopened: false,
  background_stopped: false,
  // ⚑ **F074** — a turn's ending, so an ask before it rides beside it as on `turn_ended`.
  provider_limited: true,
  // ⚑ **F076** — a turn's ending too.
  login_refused: true,
  billing_refused: true,
}

/**
 * 🔴 **D-005 · F019 — the stalls its owner starting to run again ends**, as a closed record so a
 * sixth cause cannot be added without somebody deciding.
 *
 * ⛔ **Measured (F019, 2026-09-25):** an owner waits on its helpers, its turn ends, and its work is
 * read `waiting-on-a-worker`. The last helper's task closes BEFORE its reply reaches the owner, so the
 * owner's work read `stalled` again — and the reply starting the owner's next turn pushed its giver
 * *"not being worked on"* at the one moment it demonstrably was, and the work read `stalled` until
 * the owner replied.
 *
 * ⚑ **A turn starting on the owner is a row in its OWN ledger** — `user_turn`, or the `status:
 * working` that precedes it on Claude and is the notice's trigger there — so the work goes back to
 * `working` there. ⚠️ **Only where the owner already HOLDS the work**: a turn ended or stopped with it
 * open, or a restart while it was open. ⛔ Not a message that never went out (the owner never got
 * the work, so its turn is not about it).
 *
 * 🔴 **D-016 · commit 6 · R4 — and only the piece that turn is about**: the piece its row names, or
 * every open piece when it names none ({@link UserTurnEvent.drives}); a `status: working` whose
 * turn's row has not come yet counts as naming none until it does. ⚑ A piece a person gave that
 * waits on them is driven the same way — it is no stall, so this table is not asked for it.
 *
 * ⚑ **Its own ledger says so two more ways** ({@link derivePieces}): its own status line on a piece,
 * written while it runs, drives that piece; and a turn an interrupt made room for goes back to what
 * the interrupt cut once its owner has answered what the turn was started for — provisionally, so
 * a drive that ends with nothing naming it again leaves the earlier stall standing.
 */
export const ITS_OWNER_RUNNING_AGAIN_DRIVES_IT: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  turn_interrupted: true,
  app_restarted: true,
  message_never_sent: false,
  // ⚑ **D-017 · R10** — nothing runs the old conversation again.
  could_not_be_reopened: false,
  // ⚑ Its owner, started again, is told what stopped and drives the work again.
  background_stopped: true,
  // ⚑ **F074** — its next turn, after the limit, drives it again.
  provider_limited: true,
  // ⚑ **F076** — its next turn, on the current login, drives it again.
  login_refused: true,
  billing_refused: true,
}

/**
 * 🔴 **F097 · the endings on which a turn a person's own words opened leaves a piece a conversation
 * gave waiting on that person** (`waiting-on-the-person-who-wrote`) rather than stalled — as a
 * closed record, so a new cause cannot be added without somebody deciding.
 *
 * ⚑ **Only the turn ending on its own**: its provider finished it, and nobody asked it to stop (the
 * fold asks that beside this). The owner answered the person who wrote to it, and the next move is
 * theirs. ⛔ **Every other ending is a fact the giver is owed**, so it stalls as it always did: a
 * stop, a usage limit, a refused sign-in, background work its conversation's end took — and the
 * causes no turn ends on at all (a launch, a message never sent, a replacement).
 */
export const A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  // ⚑ The other endings of a turn, each a fact its giver is owed.
  turn_interrupted: false,
  provider_limited: false,
  login_refused: false,
  billing_refused: false,
  background_stopped: false,
  // ⚑ And the causes no turn ends on.
  app_restarted: false,
  message_never_sent: false,
  could_not_be_reopened: false,
}

/**
 * 🔴 **Is this work stopped, and did the engine say what it observed?** (557)
 *
 * ⚑ **D-016 · commit 6 · its two readers ask it through {@link aStallItsGiverCanBeToldOf}** — the
 * agent's notice and the person's band — which adds that a CONVERSATION gave the piece; the
 * argument that those two are complements is carried there.
 *
 * ## ⚠️ The second clause is the fold's own invariant, carried rather than re-decided
 *
 * ⛔ **{@link PieceRow.stalledBecause} is non-null if and only if {@link PieceRow.state} is
 * `stalled`** — `derivePieces` cannot write the state and the cause independently — so this reads
 * as a narrowing that can never fire. ⚑ **It is a TYPE GUARD rather than a check**: what it buys is
 * that neither reader needs a non-null assertion to hand the cause on, and a `!` is how an
 * invariant becomes a claim nothing checks.
 */
export function stalledWithACause<T extends Pick<PieceRow, 'state' | 'stalledBecause'>>(
  piece: T,
): piece is T & { readonly stalledBecause: TaskStallCause } {
  return piece.state === 'stalled' && piece.stalledBecause !== null
}

/**
 * ⚑ **D-016 · commit 6** — whether a conversation gave this piece; see
 * {@link PieceAConversationGave}.
 */

/**
 * 🔴 **D-016 · commit 6 · R3 — a stall its giver can be told of: stalled with a cause, and given by
 * a CONVERSATION** — the one predicate both recipients are admitted by (557's, widened), so they
 * stay complements. ⛔ A piece a person gave is left out of both, whatever stalled it: nobody could
 * be told, and the person who asked reads its row.
 *
 * ## ⛔ Why it is a function and not two comparisons written twice
 *
 * ⚠️ **There are TWO readers of *this work has stalled and nobody has been told***:
 * `RuntimeHost.tellIfNobodyHasYet` decides whether an AGENT is owed a notice, and
 * `SessionStore.stalledWorkNobodyWasToldAbout` decides whether a PERSON is. ⛔ **They must be
 * complements of each other and never overlap** — HO-062 §2's row promises the work *stalls and the
 * parent is told*, and a person told about work an agent was successfully told about is `452`
 * §5.1's queue of things already handled.
 *
 * ⚑ **One derivation is what makes the complement provable**: a mutation on this line takes both
 * arms down, which is the measurement that they are one rule and not two that happen to agree.
 *
 * ## 🔴 603/609 · both arms are handed COMPOSED rows, and that is what keeps them complements
 *
 * ⛔ **A task whose conversation is waiting on something reads a {@link TaskWait}, which carries no
 * cause**, so this predicate answers `false` for it and NEITHER recipient is owed a notice — the
 * parent is not told *its turn ended with this work still open* about a child waiting on the
 * parent itself, on a person, or on a worker of its own, and a person does not collect a row
 * about it.
 * ⚑ Neither reader needed a new condition: {@link composeWhatEachPieceIsWaitingOn} clears the cause
 * with the state, which is {@link stalledWithACause}'s invariant doing the work.
 *
 * ⚠️ **609 widened the population this excludes, and that is a behaviour change rather than a
 * tidy-up.** ⛔ Work whose giver is waiting on a person or on a worker used to reach both readers
 * as `stalled`/`turn_ended`. 🔴 **The notice is not lost — it moves to the link that actually
 * stopped**, because the child's own row still stalls and whoever gave THAT work out is still
 * told.
 *
 * ⚠️ **Composing ONE arm would have broken the property this docblock names.** `RuntimeHost`
 * composes at both of its triggers and `SessionStore.stalledWorkNobodyWasToldAbout` at its walk;
 * a dispatch that moved only the agent's half would leave the two reading different populations
 * of the same ledgers.
 */
export function aStallItsGiverCanBeToldOf<
  T extends Pick<PieceRow, 'state' | 'stalledBecause' | 'giver'>,
>(piece: T): piece is T & { readonly giver: string; readonly stalledBecause: TaskStallCause } {
  return stalledWithACause(piece) && givenByAConversation(piece)
}

/**
 * ⛔ **The agent's claim, said ONCE and rendered in two registers** (406) —
 * {@link undrivenSentence}'s rule one subject over: *one table and two callers, never two tables.*
 *
 * ⚠️ **Three surfaces spell this claim and they are one string plus one composition.** A PERSON
 * reads {@link A_PERSON_MUST_ACT} as the mark on the work row; a parent AGENT reads
 * {@link A_PERSON_MUST_ACT_SENTENCE} in the words `replyText` sends it; and the raw event stream
 * prints the mark. ⛔ Two spellings of one claim is how a person and the agent beside them come to
 * two accounts of what a worker said, and this is the claim a decision hangs on.
 *
 * ⚑ **The mark is the whole subject-and-verb and the sentence is BUILT from it**, so there is one
 * owner and nothing to keep in step — `331`'s remedy without `331`'s cost. ⚠️ **No full stop and
 * no speaker**: the message says *"That agent said …"* and the row's heading says who.
 *
 * ⛔ **It is not a summons and must never be rendered as one** (HO-019 §2, and this dispatch's §3).
 * The status grammar's amber means *frozen, waiting for a human*; a task that is answered is
 * neither. This is a claim an agent made about what happens next, kept where the rest of what the
 * agent said is kept.
 */
export const A_PERSON_MUST_ACT = 'a person has to act'

/**
 * ⚑ **The mark as a sentence, for a reader who is already reading** — see
 * {@link A_PERSON_MUST_ACT}.
 *
 * ⚠️ **Composed, never re-typed.** A second literal here would be the one that drifts, and it is
 * the half a parent AGENT acts on: `replyText` is the only account of the reply a parent that is
 * not this window's gets.
 */
export const A_PERSON_MUST_ACT_SENTENCE = `${A_PERSON_MUST_ACT} before this can go further`

/**
 * Whether a value crossing in from a model's arguments is one of {@link AGENT_MESSAGE_KINDS}.
 *
 * 🔴 **D-010 · the kind is REQUIRED, at the handler** (plan §3.1). ⛔ It defaulted to `question`
 * (`553`) and to `work` before that; each default was a decision the caller had not made. ⚑ Still
 * OPTIONAL in the advertised schema, and `538` §3.3 is why: a schema-required argument fails on
 * Claude before the tool's own door runs (an `McpError`), and is a mere hint on Codex — so the
 * handler refuses a missing kind itself, the same way on both, with a sentence that names the two.
 * ⚠️ A row written before D-016 may say `work`, which is no longer a kind: this answers `false`,
 * and readers show nothing for it.
 */
export function isAgentMessageKind(value: unknown): value is AgentMessageKind {
  return typeof value === 'string' && (AGENT_MESSAGE_KINDS as readonly string[]).includes(value)
}

/**
 * 🔴 **729 · PM ruling R89 — the word a lost answer's record carries when it was HELD and then
 * lost** — `ReplyUndeliveredEvent.because`, beside the one `REPLY_DELIVERIES` member that lands
 * nowhere.
 *
 * ⚑ **R89 (`724` F-1, extends R84) · Lost is lost, whatever lost it:** *"An answer is not delivered
 * when it never reached the giver, by any road: refused (`reply_undelivered`), or held for a busy
 * giver and then abandoned by a Close, a quit, a crash or a sign-in latch. Its `list_tasks` row
 * carries the summary in every one of those cases."* ⚑ A Close, a quit and a sign-in latch no longer
 * abandon held words — the next start, or the reopen on the current sign-in, sends them.
 *
 * ⛔ **Not a `REPLY_DELIVERIES` member, and that is the fact rather than a gap**: the replying agent
 * was handed back `held` or `kept` (D-030) — which was true — and this is what became of the held
 * message later. ⚠️ So the row's `because` is no longer always *"the word the agent was handed
 * back"*; on this row it is the later ending, and the giver's own `message_unqueued` says which
 * ending it was.
 */
export const AN_ANSWER_HELD_THEN_LOST = 'held-then-lost'

/**
 * 🔴 **729 · R89 — the answer a held message carries, or `null` when it carries none** — asked of a
 * held message's AUTHORSHIP as it ends without being sent.
 *
 * ⚑ **An answer is the reply itself**: `deliverReply` queues it with the answer's own report
 * (`workAnswered`, `state: 'answered'`) and `carriedFor` the conversation that answered, which is
 * where `relayedFrom` comes from — the report's own `owner`. ⛔ **Both**: the report says the work
 * was answered, and `relayedFrom` says these are the answerer's words, carried — the app's own
 * notices are relayed from nobody.
 *
 * ⚠️ **Structural, so both writers can ask it**: `RuntimeHost` over a held message's
 * `TurnAuthorship`, and `SessionStore`'s crash repair over the stored row — one question, asked of
 * the same two keys. ⛔ **A report with no `owner` carries no answer here**: the record is written
 * into that conversation's ledger, and there would be none to write it into — nor could two absent
 * keys be read as a match.
 *
 * ⚠️ **A value that is not a report answers `null`, and never throws** ({@link isAWorkReport}, never
 * `!== undefined`) — `729`'s review. ⚑ The store's door already drops such a `work` on the way in,
 * import included (`boundWorkReport`), so the crash repair meets none; the predicate answers for
 * itself anyway, since the host hands it live authorship too.
 */
export function theAnswerItCarries(authorship: {
  readonly work?: WorkReport
  readonly relayedFrom?: string
}): (WorkReport & { readonly owner: string }) | null {
  const { work } = authorship
  if (!isAWorkReport(work)) return null
  const replier: unknown = work.owner
  return work.state === 'answered' &&
    typeof replier === 'string' &&
    authorship.relayedFrom === replier
    ? { ...work, owner: replier }
    : null
}

/**
 * 🔴 **Whether a value off the wire is shaped like a report at all** (406, from the review).
 *
 * ⛔ **The three fields with no fallback of their own.** `state` is read through a guard that answers
 * something true for a value this app has never heard of; {@link WorkReport.piece} and
 * {@link WorkReport.label} are printed. ⚠️ A `work: "hello"` on an imported ledger passes
 * `!== undefined`, reaches the row, and draws a label of *undefined* — the SHAPE of the value was the
 * one thing nothing checked.
 *
 * ⚑ **D-016 · and it is what keeps an older report inert.** A report written before D-016 names a
 * task by id and number, and has neither of these keys, so no reader takes it for a piece's.
 *
 * ⚑ **Structural and not exhaustive, deliberately.** It answers *is this a report* and not *is
 * every field a member of its vocabulary*, because the second question already has answers further
 * in and another here would be a second reading free to disagree with them.
 */
export function isAWorkReport(value: unknown): value is WorkReport {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Partial<WorkReport>
  return (
    typeof one.piece === 'string' && typeof one.label === 'string' && typeof one.state === 'string'
  )
}

/**
 * ⛔ **{@link WorkGivenOut} from the row it is derived from, in one place** (508).
 *
 * ⚠️ **Here rather than in the store, because it is a fact about the two SHAPES** and neither of
 * them can reach a database. ⛔ The absences are built the way the wire spells them —
 * `...(x === null ? {} : { x })` — so a row this app wrote and a row read back out of a
 * `.brobot` bundle are the same value.
 */
export function workGivenOut(row: PieceRow, givenToProfile: string | null): WorkGivenOut {
  return {
    piece: row.piece,
    label: row.label,
    title: row.title,
    ...(row.definitionOfDone === undefined ? {} : { definitionOfDone: row.definitionOfDone }),
    state: row.state,
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    ...(row.needsUserAction ? { needsUserAction: true as const } : {}),
    ...(row.stalledBecause === null ? {} : { stalledBecause: row.stalledBecause }),
    givenToProfile,
    givenAt: row.givenAt,
    ...(row.givenFolder === undefined ? {} : { givenFolder: row.givenFolder }),
  }
}

/**
 * ⛔ **Whether a task in this state is still somebody's to finish** — the one derived predicate, as
 * a table rather than as a `!==` list.
 *
 * ⚠️ **`stalled` is OPEN**, and that is the entry worth arguing about — HO-018 §2.1 took it
 * explicitly (*"take `TASK_IS_OPEN.stalled`"*). Calling it closed would be the *"unenumerated state
 * counting as success"* shape with a name on it: a task nobody will ever look at again because the
 * app decided that a turn ending, or a Stop, or a restart was an ending of the WORK. ⚑ **And it is
 * what makes a late reply possible**: a child that finished its turn and called `reply_to_parent` on
 * the next one still lands, because {@link derivePieces} only refuses a reply to a task it has
 * already CLOSED.
 *
 * ⛔ **`answered` is CLOSED, and it is the only state a reply produces.** `393`: a second reply to
 * one task is a refusal and it is permanent, which is a property of this row rather than of the
 * rail that reads it.
 *
 * 🔴 **There are three closed states, and every one of them is somebody DECIDING** (400, D-016).
 * `answered` is the agent saying how it went; `withdrawn` is the parent taking the work back;
 * `closed` is the parent ending the work without a reply. ⛔ **Everything else that happens to work
 * is a condition on an open task** — a turn ending, a Stop, a restart, a replacement — which is
 * HO-018 §2's principle stated as a table rather than as a sentence: *the engine never terminally
 * closes work it did not observe finishing.*
 */
export const TASK_IS_OPEN: Readonly<Record<TaskState, boolean>> = {
  waiting: true,
  working: true,
  // ⚑ **603/609 · every wait is open, for `stalled`'s reason and not for a new one.** ⛔ The work
  // is still somebody's to finish, and the thing each one is waiting on is exactly what would put
  // it back in motion — see {@link TASK_WAITS}, and {@link composeWhatEachPieceIsWaitingOn} for why
  // the fold writes only two of them: the folded waits are the fold's own observation (commit 6,
  // F097), and the others are joins across derivations that stay above the fold.
  //
  // 🔴 **A wait that was CLOSED could never be answered** — `393`'s rule that a second reply is a
  // permanent refusal — so a parent that answered a question, approved a permission or got its
  // worker's reply would find nothing left to reopen, and a person's request nothing to finish.
  'waiting-on-an-answer': true,
  'waiting-on-a-person': true,
  'waiting-on-a-worker': true,
  'waiting-on-the-person-who-asked': true,
  'waiting-on-the-person-who-wrote': true,
  'waiting-on-purpose': true,
  stalled: true,
  answered: false,
  withdrawn: false,
  closed: false,
}

/** A stored row's {@link WaitOn}, or `undefined` where the row does not say one. */
export function aWaitOnOf(value: unknown): WaitOn | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const one = value as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof one[key] === 'string' && one[key] !== '' ? (one[key] as string) : null
  const piece = text('piece')
  const label = text('label')
  const request = text('request')
  const job = text('job')
  const background = text('background')
  switch (one.kind) {
    case 'agent':
      if (piece !== null && label !== null) return { kind: 'agent', piece, label }
      return request === null ? undefined : { kind: 'agent', request }
    case 'person':
      return request === null ? undefined : { kind: 'person', request }
    case 'time':
      return typeof one.at === 'number' && Number.isFinite(one.at)
        ? { kind: 'time', at: one.at }
        : undefined
    case 'event':
      if (job !== null) return { kind: 'event', job }
      return background === null ? undefined : { kind: 'event', background }
    default:
      return undefined
  }
}

/**
 * The wait a status row marks, as its line carries it: none, one that names nothing, or one on a
 * target the row states in full ({@link aWaitOnOf}).
 */
export function theWaitItMarks(event: { readonly waiting?: unknown; readonly on?: unknown }): {
  readonly waiting?: true
  readonly on?: WaitOn
} {
  if (event.waiting !== true) return {}
  const on = aWaitOnOf(event.on)
  return on === undefined ? { waiting: true } : { waiting: true, on }
}

/** Whether a status line marks a wait that names nothing it waits on. */
export function aWaitNeedsClassifying(line: StatusLine | null): boolean {
  return line?.waiting === true && line.on === undefined
}

/**
 * ⚑ **F074 — the usage limit a `turn` row says its turn ended on**, for {@link derivePieces}: only
 * a `failed` turn's, and ⛔ a reset at or before the row's own moment is none — the provider's
 * remembered word about a limit that had already reset is not about this turn.
 */
function theLimitItEndedOn(
  event: Extract<TranscriptEvent, { type: 'turn' }>,
  at: number,
): StoppedOnALimit | undefined {
  if (event.state !== 'failed' || event.limit === undefined) return undefined
  const { provider, resetsAt, window } = event.limit
  return {
    provider,
    ...(resetsAt !== undefined && resetsAt > at ? { resetsAt } : {}),
    ...(window === undefined ? {} : { window }),
  }
}

export const waitsOnWhoWrote = (row: PieceRow): row is PieceWaitingOnWhoWrote =>
  row.state === 'waiting-on-the-person-who-wrote'

/**
 * 🔴 **The open work a conversation is holding, as a person refers to it** (467) — one derivation,
 * for the two readers that have to agree.
 *
 * ⛔ **{@link TASK_IS_OPEN} decides what *open* means, and `stalled` is inside it**: nothing is
 * driving that work and the work has not ended, which is exactly the state a person wants to see
 * beside a frozen child. ⚠️ A second reader filtering by hand would have been free to read
 * `stalled` as closed, and the two lists would have disagreed about one conversation.
 *
 * ⚑ **The order is the fold's own** — the order the pieces were given in — and is not re-imposed
 * here. A caller that wants another one sorts what it is given. ⚠️ A root is not a row, so it is not
 * here: what a root-owner holds beside its pieces is its conversation's own work.
 */
export function openWorkOf(pieces: readonly PieceRow[]): readonly WorkInHand[] {
  return pieces
    .filter((piece) => TASK_IS_OPEN[piece.state])
    .map((piece) => ({ label: piece.label }))
}

/**
 * 🔴 **The one piece of work an id names, as a person refers to it — or `null` because this
 * conversation holds no such row** (474, from `463` F4).
 *
 * ⛔ **{@link TASK_IS_OPEN} is NOT asked here, and the difference from {@link openWorkOf} is the
 * point.** A question outlives the work it was about: a worker asks about W1.3, the giver answers a
 * day later, and it has finished in between. ⚠️ Filtering to open work would turn *"this is about
 * W1.3"* into *"nothing answers to it"* the moment the work ended, which is a sentence about this
 * app's filter wearing the clothes of a sentence about the ledger.
 *
 * ⚑ **The FIRST match, and a second cannot exist**: a piece id is `work_<uuid4>` and
 * `derivePieces` opens one row per give, so an id that matches twice in one ledger is a defect
 * elsewhere and not a state this predicate should have an opinion about.
 */
export function workNamed(pieces: readonly PieceRow[], piece: string): WorkInHand | null {
  const found = pieces.find((one) => one.piece === piece)
  return found === undefined ? null : { label: found.label }
}

/**
 * ⚑ **D-017 · R8 — the wait of a conversation whose record could not be read**: nothing this read
 * saw is outstanding, and the answer that skipped it says so.
 */
export const NOTHING_IT_WAITS_ON: WhatAConversationIsWaitingOn = {
  answers: new Set(),
  aPerson: false,
  childrenOpen: new Set(),
}

/**
 * 🔴 **The one composition: a piece whose conversation is waiting on something reads which WAIT it
 * is in, and not {@link TaskState.stalled}** (603 as one wait, generalised by 609 · HO-091 §1 ·
 * HO-088 §5; per piece since D-016).
 *
 * ## ⛔ Compose ONCE, read many times — and the alternative was ruled out rather than skipped
 *
 * ⚑ **`HO-091` §1:** *"Compose once, above both folds. Every surface that reports a task's state
 * reads that one composition."* ⚠️ The shape it refused is one surface composing and another not:
 * *"The disagreement is certain, not hypothetical. One surface composes and one does not, so they
 * differ by construction"*.
 *
 * ⛔ **So this is not a helper a reader may choose.** Every surface in this app that reports a
 * piece's state calls it — ⚠️ **since `664`, and not before**: the receiver's line and the Team
 * forest read the raw fold until then (`D32`).
 *
 * ## 🔴 The PRECEDENCE, and it is held HERE so that no caller can hold it
 *
 * ⚑ **answer → person → worker**, and the order is derived rather than chosen:
 *
 *  1. ⛔ **An answer this piece is owed** — the reader of the row is exactly who owes it.
 *  2. ⚠️ **`aPerson` next**, because somebody must move and it is not the agent.
 *  3. ⚑ **An open child of THIS piece last**, because NOBODY must move — the work is simply out.
 *     ⛔ When two are true, the one worth saying is the one somebody can act on.
 *
 * 🔴 **A row carries one word and the others are not lost**: the question is still in
 * `list_questions`, the card is still in the person's queue, and the handed-out work is still on
 * the Work tab.
 *
 * ## ⚠️ Why it is here and not inside {@link derivePieces}
 *
 * ⛔ **`400`'s rule, at the fold's own `travelled` set:** *"Ids only: what became of each one is
 * `deriveRoutedRequests`' answer and this fold must not grow a second opinion about it."* ⚑ Whether
 * a question is still open IS that answer, and the same is true of a permission and of another
 * conversation's work. 🔴 **The join therefore lives above the fold, where every derivation is
 * already in hand.**
 *
 * ⚑ **D-016 · commit 6 · the folded waits are no such join** — `waiting-on-the-person-who-asked`
 * and (F097) `waiting-on-the-person-who-wrote` are the fold's own observations (a drive ending over
 * a row whose giver is a person; a turn a person's words opened ending), so {@link derivePieces}
 * writes them and this composition does not. ⚠️ **It reads over them all the same**: an answer
 * owed, a card a person owes or an open child of the piece is the more specific wait, and is said
 * instead — and F097's moment is then read by nobody ({@link PieceRow.answeredAPersonAt}); with
 * none, the folded wait stands.
 *
 * ## ⛔ Every OPEN state, and no exception for any of them
 *
 * ⚑ **{@link TASK_IS_OPEN} is the whole condition.** ⚠️ A rule that fired only on `stalled` would
 * leave a giver reading `working` about an owner waiting on the giver itself; one that fired only on
 * `working` would leave `turn_ended` standing over every one of the three. ⛔ **A closed piece is
 * never touched**: a question outlives the work it was about ({@link workNamed}'s own rule), and a
 * piece taken back or closed ends its questions in the same fold that reads them.
 *
 * ## 🔴 The stall fields are CLEARED, because the invariant is load-bearing
 *
 * ⛔ **{@link PieceRow.stalledBecause} is non-null if and only if the state is `stalled`** — held by
 * construction in {@link derivePieces}, read as a type guard by {@link stalledWithACause}, and
 * spelled again on {@link WorkReport.stalledBecause}. ⚑ A composed row that kept its cause would
 * break all three at once.
 *
 * 🔴 **That clearing is also what carries the rule into the notice paths for free.**
 * {@link stalledWithACause} answers `false` for a composed row, so any reader handed composed rows
 * stops owing a stall notice about work whose question, decision or child is outstanding — and the
 * notice MOVES to the link that actually stopped: the child's own row stalls, and whoever gave THAT
 * piece out is told.
 *
 * ## ⚑ D-016 · the worker arm is THIS piece's
 *
 * ⚠️ **Until D-016 a conversation's open hand-over held every task it held**, so one task's open
 * child silenced its siblings' stalls (design notes §4). ⛔ **Now only the piece a child hangs under
 * reads `waiting-on-a-worker`**, and a sibling whose turn ended with nothing out stalls and is
 * reported.
 *
 * ## ⚑ The lookup is handed in rather than reached for
 *
 * ⛔ **Which is what keeps this module free of a database**, and what lets one test plant two rows
 * against the same derivation a host reads a store for. ⚠️ **It is asked of
 * {@link PieceRow.owner}**, the conversation HOLDING the work, because all three facts are about the
 * conversation that has to move next; asking the giver would walk the edge the wrong way. ⚠️ **It
 * is asked only for OPEN rows**, so a conversation whose work has all finished costs no read at all.
 */
export function composeWhatEachPieceIsWaitingOn<
  T extends Pick<PieceRow, 'piece' | 'owner' | 'state'>,
>(
  pieces: readonly T[],
  /** ⛔ **Everything the conversation holding a row is waiting on** — one read per conversation. */
  outstandingFor: (sessionId: string) => WhatAConversationIsWaitingOn,
): readonly T[] {
  return pieces.map((piece) => {
    if (!TASK_IS_OPEN[piece.state]) return piece
    const outstanding = outstandingFor(piece.owner)
    // ⛔ **THIS row's question and THIS row's children** — see {@link whichWait}, which holds the
    // precedence for both readers.
    const wait = whichWait(
      outstanding.answers.has(piece.piece),
      outstanding.aPerson,
      outstanding.childrenOpen.has(piece.piece),
    )
    if (wait === null) return piece
    return { ...piece, state: wait, stalledBecause: null, stalledAt: null, stalledBy: null }
  })
}

/**
 * 🔴 **The PRECEDENCE, spelled ONCE and read by both projections of it** (621, `HO-095` §5.1).
 *
 * ⛔ **Two spellings of *answer beats person beats worker* is exactly the shape `HO-091` §1 refused
 * one layer up** (*"one surface composes and one does not, so they differ by construction"*), so the
 * ladder is here and each reader hands it the facts about its own SUBJECT.
 *
 * ## ⛔ The two keyed arms are the caller's question, and the middle one is not
 *
 * ⚑ **{@link WhatAConversationIsWaitingOn.answers} and {@link WhatAConversationIsWaitingOn.childrenOpen}
 * are SETS keyed by piece**, so each has two honest readings and they belong to different subjects:
 *
 *  - ⛔ **about ONE ROW** — `has(piece.piece)`, which is the most specific true statement about that
 *    row;
 *  - ⛔ **about the CONVERSATION** — `size > 0`, which is *it asked, or handed work out, and that is
 *    still open*. ⚠️ See {@link theWaitAConversationIsIn}.
 *
 * 🔴 **Neither reading is derivable from the other**, which is why the arms are PARAMETERS rather
 * than a branch on a nullable id. ⚑ **`aPerson` is already a conversation-wide boolean** and is read
 * identically by both.
 */
function whichWait(
  /** ⛔ **An answer is outstanding FOR THE SUBJECT THE CALLER IS ASKING ABOUT.** */
  anAnswerIsOutstanding: boolean,
  aPersonOwesSomething: boolean,
  /** ⛔ **Work handed out under THE CALLER'S SUBJECT is still open.** */
  aChildIsOpen: boolean,
): ConversationWait | null {
  return anAnswerIsOutstanding
    ? 'waiting-on-an-answer'
    : aPersonOwesSomething
      ? 'waiting-on-a-person'
      : aChildIsOpen
        ? 'waiting-on-a-worker'
        : null
}

/**
 * 🔴 **What ONE CONVERSATION is waiting on — the waits a conversation can be in
 * ({@link ConversationWait}), about the conversation itself rather than about a row it holds** (621,
 * `HO-095` §5.1 · `EXT-014` §5).
 *
 * ## ⛔ The hole this closes, measured rather than argued
 *
 * ⚠️ **`HO-095` §5.1:** *"BroBot's header, avatar and rail row read* Idle *while Task #1 was being
 * worked on by Ada."* ⛔ **Every fact needed to say otherwise was already folded** — ⚑ **and the only
 * PLACE the app could say it was a task row.** 🔴 A conversation a person started held no task row at
 * all, so the composition had nothing to write the wait onto and every agent-state surface read
 * `idle`. ⚠️ **It still holds no ROW since D-016**: its root is its own work, and a root is never a
 * row (R1). ⚑ **D-036 · the ONE state says the worker wait now**, of every conversation whatever
 * its depth, and names who holds the work (`agentStateOf`'s *waiting on <name>*). ⚠️ **So this —
 * the poll's `waiting` — has no reader in the app**: every row the host builds carries its
 * verdicts, which the window reads instead, and only a reading built without them (a test's
 * hand-made one) falls back to it.
 *
 * ## ⚠️ It answers a DIFFERENT question from the composition, and that is the whole point
 *
 * ⛔ **`621` §4.4 named the two and forbade conflating them**, and they stay two reads over one
 * source:
 *
 * | | |
 * |---|---|
 * | ⚑ **{@link composeWhatEachPieceIsWaitingOn}** | *is THIS PIECE OF WORK waiting on something* — a row's `state` |
 * | ⚑ **this** | *is THIS CONVERSATION waiting on something* — true of a conversation that holds no piece row at all |
 *
 * 🔴 **One field does NOT answer both**, which is
 * `widening-a-predicate-widens-every-question-its-field-answers` honoured rather than risked: a
 * conversation with one open piece waiting on an answer and a second waiting on nothing gets ONE
 * conversation-level word and TWO different row words, and both are true.
 *
 * ## ⛔ Why `size > 0` is the honest keyed arm
 *
 * ⚑ **A non-empty {@link WhatAConversationIsWaitingOn.answers} is *this conversation asked about
 * work it holds and nobody has answered*** — its root included, which `ask_question` counts as held
 * work — and a non-empty {@link WhatAConversationIsWaitingOn.childrenOpen} is *it handed work out
 * and that work is still open*: claims about the conversation, not about which row.
 *
 * ⛔ **`null` is a real answer and means *nothing this app has recorded is outstanding here*** —
 * never *we did not look*. ⚑ The caller that builds the {@link WhatAConversationIsWaitingOn} is
 * what decides whether a look happened, exactly as it does for the fold.
 */
export function theWaitAConversationIsIn(
  outstanding: WhatAConversationIsWaitingOn,
): ConversationWait | null {
  return whichWait(
    outstanding.answers.size > 0,
    outstanding.aPerson,
    outstanding.childrenOpen.size > 0,
  )
}

/**
 * 🔴 **D-006 · the one derivation of {@link HeldWork}**, over the pieces a conversation was GIVEN,
 * COMPOSED ({@link composeWhatEachPieceIsWaitingOn}) — so a turn that ended with its work out with a
 * helper reads that wait, never *stalled* (`609`: a stall is reported at the broken link).
 *
 * ⚑ **Open work speaks first**: any of it stalled → `stalled`; any other open work → `null` (a wait,
 * or a turn driving it, already says so — and a piece a person gave, waiting on them, is said on
 * the piece only: plan ruling 9). ⚑ **With nothing open, the work that ended LAST** decides:
 * `answered`, with what its owner said of it; taken back or closed → `null`. No work → `null`.
 */
export function whereTheWorkItHoldsStands(
  held: readonly PieceRow[],
  /**
   * A root belongs to a person-started conversation whose overall work stays open. Answered work taken on for that person must not make the conversation read as over; it awaits their next words. Open held work, including stalls, still contributes here.
   */
  ownsARoot = false,
): HeldWork | null {
  const open = held.filter((piece) => TASK_IS_OPEN[piece.state])
  if (open.length > 0) {
    return open.some((piece) => piece.state === 'stalled') ? { state: 'stalled' } : null
  }
  if (ownsARoot) return null
  const last = theOneThatEndedLast(held)
  return last?.state === 'answered' ? { state: 'answered', outcome: last.outcome } : null
}

/**
 * ⚑ **The piece that ended last**, among pieces in the order they were given — the latest
 * `endedAt`, and of two that ended together the one given later. ⚠️ One choice for
 * {@link whereTheWorkItHoldsStands} and {@link theWorkThatNamesItAmong}, so a plate's word and the
 * name beside it are never about two different pieces.
 */
function theOneThatEndedLast<Piece extends Pick<PieceRow, 'endedAt'>>(
  held: readonly Piece[],
): Piece | null {
  let last: Piece | null = null
  for (const piece of held) {
    if (last === null || (piece.endedAt ?? 0) >= (last.endedAt ?? 0)) last = piece
  }
  return last
}

/**
 * 🔴 **F033 · the work that names a conversation that owns no root, among the pieces it holds** —
 * in the order they were given, the fold's own.
 *
 * ⚑ **Open work names it**: the newest open piece, and how many more it holds open. ⚑ **With
 * nothing open, the piece that ended last names it, marked with how** — answered, taken back or
 * closed ({@link theOneThatEndedLast}). No piece at all → `null`: its agent's name alone.
 *
 * ⛔ **Never the newest piece however it ended** (F033): an idle helper read as the owner of work it
 * had already handed back — Arjun as *"the owner of W1.48"* with nothing held, and Ada as working on
 * a test taken back two and a half hours before. ⚑ **The last piece, marked, rather than the name
 * alone**: two conversations of one agent stay two names, and the address a sentence hands back
 * stays a label — an ended piece's label still names its owner.
 */
export function theWorkThatNamesItAmong(
  held: readonly Pick<PieceRow, 'label' | 'title' | 'state' | 'endedAt'>[],
): WorkThatNamesIt | null {
  const open = held.filter((piece) => TASK_IS_OPEN[piece.state])
  const newest = open.at(-1)
  if (newest !== undefined) {
    return {
      label: newest.label,
      title: newest.title,
      ...(open.length > 1 ? { more: open.length - 1 } : {}),
    }
  }
  const last = theOneThatEndedLast(held)
  if (last === null) return null
  return { label: last.label, title: last.title, ...howItEnded(last.state) }
}

/** ⚑ **F033** — `{ ended }` for a state a piece ends in, and nothing for an open one. */
function howItEnded(state: TaskState): { readonly ended?: HowAPieceEnded } {
  return state === 'answered' || state === 'withdrawn' || state === 'closed' ? { ended: state } : {}
}

/**
 * ⚑ **F088 · one piece, as a sentence about it names it** — its label and the title it stands under
 * now, marked with how it ended once it has ({@link howItEnded}), so the piece a message is about
 * reads as {@link theWorkThatNamesItAmong} would mark it. ⚑ No count: it is one piece.
 */
export function onePieceAsItStands(
  piece: Pick<PieceRow, 'label' | 'title' | 'state'>,
): WorkThatNamesIt {
  return { label: piece.label, title: piece.title, ...howItEnded(piece.state) }
}

/**
 * 🔴 **D-016 · the seven piece events, in the order `events_work_idx` lists them** — every event type
 * that is about one piece, in its owner's ledger (R5).
 *
 * ⛔ **Three lists must say the same seven words**: this one, the partial index in `db/schema.ts`
 * and the store's piece reads — a partial index serves a query only when the query's type list
 * implies the index's. ⚑ Typed against the union, so a renamed event is a compile error here.
 */
export const PIECE_EVENT_TYPES = [
  'work_given',
  'work_replied',
  'work_taken_back',
  'work_retitled',
  'work_status_set',
  'work_rebriefed',
  'work_closed',
] as const satisfies readonly TranscriptEvent['type'][]

/**
 * The stalls a wait on purpose outlasts: the drive ended while nothing was owed. ⛔ Not a
 * brief that never reached its holder, nor a holder that can never be reopened — both leave the
 * piece with nobody, and its giver must be told — nor a stall only a person can clear.
 */
export const A_WAIT_ON_PURPOSE_OUTLASTS: Readonly<Record<TaskStallCause, boolean>> = {
  turn_ended: true,
  turn_interrupted: true,
  app_restarted: true,
  background_stopped: true,
  message_never_sent: false,
  could_not_be_reopened: false,
  provider_limited: false,
  login_refused: false,
  billing_refused: false,
}

/**
 * ⚑ **D-016 · commit 6 · R4 — the piece a delivery row names for THIS ledger**: a brief's or a new
 * brief's own `piece`, else the piece it `drives`; `null` — it names none — drives every open
 * piece. ⛔ A row never carries both (`UserTurnEvent.drives`).
 *
 * ⚑ **D-022 · R4 — one spelling, read by the fold ({@link derivePieces}) and by the host**, which
 * keeps what each conversation's open turn drives, for `give_work`'s inference.
 */
export function theDriveOf(event: {
  readonly piece?: string
  readonly drives?: string
}): string | null {
  return event.piece ?? event.drives ?? null
}

function aNoteExpectsNoReply(
  one: Pick<
    Extract<TranscriptEvent, { type: 'user_turn' }>,
    'says' | 'attribution' | 'work' | 'relayedFrom' | 'appNotice' | 'piece'
  >,
): boolean {
  return (
    one.says === 'note' &&
    !aPersonsOwnWords(one) &&
    one.piece === undefined &&
    one.work === undefined &&
    one.appNotice === undefined
  )
}

/** Personal words drive their targets unless another substantive message names the same piece. */
function aPersonOpenedTheTurnFor(
  parts: readonly Pick<
    Extract<TranscriptEvent, { type: 'user_turn' }>,
    'attribution' | 'work' | 'relayedFrom' | 'appNotice' | 'piece' | 'drives' | 'says'
  >[],
): (piece: string) => boolean {
  const theirs = parts.filter(aPersonsOwnWords)
  if (theirs.length === 0) return () => false
  const everyPiece = theirs.some((one) => theDriveOf(one) === null)
  const theirPieces = new Set(theirs.map(theDriveOf).filter((one): one is string => one !== null))
  const anotherNamed = new Set(
    parts
      .filter((one) => !aPersonsOwnWords(one) && !aNoteExpectsNoReply(one))
      .map(theDriveOf)
      .filter((one): one is string => one !== null),
  )
  return (piece) => (everyPiece || theirPieces.has(piece)) && !anotherNamed.has(piece)
}

/**
 * 🔴 **D-027 · the one piece a delivered turn drives** — {@link theDriveOf} of every message it
 * delivered (`theMessagesOf`), when they all name the same one. ⛔ `null` when one of them names
 * none — the turn drives every open piece — or two of them name different pieces: a turn that drives
 * several is about no one piece. ⚑ A turn of one message answers what {@link theDriveOf} answers.
 */
export function theDriveOfTheTurn(
  messages: readonly { readonly piece?: string; readonly drives?: string }[],
): string | null {
  const drives = new Set(messages.map(theDriveOf))
  const [only] = drives
  return drives.size === 1 ? (only ?? null) : null
}

/**
 * The pieces a turn's messages name, each once, oldest first — where {@link theDriveOfTheTurn}
 * answers `null` both for words that name none and for words that name different pieces, this
 * tells the two apart. ⚑ Words that name none add nothing.
 */
export function thePiecesTheTurnNames(
  messages: readonly { readonly piece?: string; readonly drives?: string }[],
): readonly string[] {
  return [...new Set(messages.flatMap((one) => theDriveOf(one) ?? []))]
}

/**
 * 🔴 **The whole of S1: one conversation's ledger folded into the pieces it was given** (379 as
 * tasks; pieces since D-016).
 *
 * ⛔ **Pure, total, and ordered by the ledger it was handed.** The caller supplies the entries in
 * ordinal order — every reader in the app already does — and the fold walks them once.
 *
 * ## ⚠️ The transitions, and the guard each one needs
 *
 * ⚠️ **Stated without a COUNT** (`396`'s rule, and `398` needed it here): a list whose sentence
 * counts itself goes quietly wrong the first time anything is added to it.
 *
 *  - **`work_given`** opens the row: `waiting` when it carries a {@link WorkGivenEvent.messageId}
 *    (the owner was busy and the brief is being held), `working` when it does not (the owner was
 *    idle and the brief went straight out — or the owner took the work on itself, mid-turn, with
 *    `take_on_work`). ⛔ Two starting states because there are two branches in the delivery, not
 *    because a caller chose. ⚑ Its giver is copied as given: `null` is a person (D-016 · commit 6).
 *    ⚑ **A root has no such row, so no root is ever a row here** (D-016 · R1).
 *  - **`message_queued`** records nothing on a piece; it notes what the held words will drive when
 *    they go out (D-005a) — the piece its row names, or every open piece (D-016 · commit 6 · R4).
 *  - **`message_unqueued`** ends the wait, and only for the piece holding THAT message id — `354`'s
 *    rule that an unnamed ending may not be paired with a named beginning is why the comparison is
 *    on the string and never on position. `sent` → `working`; `cancelled` → `withdrawn`;
 *    `abandoned` → `stalled`, because the app went away before the work was ever handed over
 *    (400 — it used to be terminal, and see {@link TaskStallCause.app_restarted}). ⚑ And held work
 *    no waiting message drives any more is let go (D-005a): it stalls, or waits on the person who
 *    asked, on its turn's cause — except what the message that went out drives.
 *  - **`work_replied`** closes the row at `answered`, carrying the outcome, the summary (719) — which
 *    is also its status line, said by the owner — the resources and the person-flag off the event.
 *    ⛔ **Only for a piece this ledger still holds OPEN**, which is the whole of *"a second reply is
 *    a refusal"* expressed as a fold rather than as a check somebody has to remember: a closed piece
 *    is not in `open`, so a duplicate event lands on nothing. ⚑ It is ABOVE the turn branch on
 *    purpose — the reply is a tool call INSIDE the turn it ends, so the piece is already `answered` by
 *    the time the turn's ending arrives and the `working` guard below passes over it. **That ordering
 *    is what makes a stall mean *no reply* rather than *no reply yet*.** ⚑ And once its owner has
 *    answered every piece its open turn was started for, the turn goes back to what an interrupt cut
 *    to make room for it — provisionally ({@link cutByAnInterrupt}).
 *  - **`reply_undelivered`** moves nothing; on a row already `answered` it sets
 *    {@link PieceRow.answerReachedNobody} (`724`, R84) — the owner's own record, written after its
 *    reply, that the words reached no conversation (since `729`, R89, also when they were held and
 *    then lost). ⛔ A row no reply closed is passed over, and so is one that names no piece.
 *  - **`work_retitled`**, **`work_status_set`** and **`work_rebriefed`** set the row's title, its
 *    status line or its brief, open or ended — the newest one stands. ⛔ A row this ledger holds no
 *    piece for is passed over, and that is every line about the owner's own ROOT, which is never a
 *    row. ⚑ A new brief's own `user_turn` drives its piece again, as any turn naming it does. ⚑ **The
 *    owner's own status line, written while it runs, drives its piece** — the owner saying where it
 *    stands on that work is the owner working it; ⛔ the rest move nothing.
 *  - **`turn`** stalls a `working` piece a conversation gave, whichever way the turn ended:
 *    `completed` and `failed` carry {@link TaskStallCause.turn_ended}, `interrupted` carries
 *    {@link TaskStallCause.turn_interrupted} — and an ask to stop that preceded it rides on
 *    either as {@link PieceRow.stalledBy} (`720`, R72). ⚑ A `working` piece a person gave waits on
 *    them instead, with no cause (`waiting-on-the-person-who-asked`, D-016 · commit 6 · R3).
 *    ⚑ **F097** — and one a conversation gave waits on the person who wrote, with no cause, when a
 *    person's own words opened the turn, it ended on its own and nobody asked it to stop
 *    (`waiting-on-the-person-who-wrote`). ⚑ Unless something holds it — a waiting message that will drive it, running background work,
 *    or an earlier drive's hold this turn did not drive ({@link endOfDrive}).
 *    ⚠️ **The `working` guard is load-bearing and its absence is a real defect rather than a tidy
 *    one**: a piece queued behind a running turn sees THAT turn's ending arrive before its own
 *    brief is ever sent, so an unguarded rule would report work as undriven that had not yet been
 *    handed over. ⚑ What the turn went back to, with nothing naming it since, stands as its earlier
 *    stall instead; and an interrupted turn — or one a stop was asked of (F075) — hands what it
 *    stalled to the next turn ({@link cutByAnInterrupt}).
 *  - **`work_taken_back`** closes the row at `withdrawn` — the giver taking the work back (429).
 *    ⛔ **Only for a piece this ledger still holds OPEN**, which is `work_replied`'s sentence one
 *    verb over and is what makes *a piece is taken back once* a property of the fold rather than a
 *    check the door has to remember. ⚑ **It is the SECOND producer of that state and not the
 *    first**: `message_unqueued` with `cancelled` already reached a piece whose brief was still held,
 *    and the two are one act at that door — the take-back cancels the held brief and then writes
 *    this row, so a `waiting` piece derives `withdrawn` from whichever row the fold meets first and
 *    from the other one never.
 *  - **`work_closed`** closes the row at `closed` — the giver ending the work without a reply
 *    (D-016). ⛔ **Only for a piece this ledger still holds OPEN**, `work_taken_back`'s sentence in
 *    its own state; its door writes it before it takes back any held brief, so a `waiting` piece
 *    derives `closed` and not `withdrawn`.
 *  - **`work_restarted`** stalls each piece it NAMES that is still `waiting` or `working` at
 *    {@link TaskStallCause.app_restarted} — the launch found work nobody had finished. ⛔ It passes
 *    over a piece that is already `stalled`, which is what makes the sweep that writes it idempotent
 *    across launches without needing to remember anything; and over a piece given after it, which
 *    it cannot name. ⚑ A drive still waiting for its turn's row when the app went away drove every
 *    open piece first (D-016 · commit 6 · R4) — the launch read that named them saw it so. ⚑ What a
 *    drive had gone back to stands as its earlier stall first ({@link restoreTheEarlierStalls}).
 *  - **`user_turn`** records nothing on a piece; it opens a new turn, so it clears an older
 *    remembered ask before that different turn can end, and it drives again what its owner already
 *    holds (D-005) — since D-016 · commit 6 · R4 only the piece it names ({@link
 *    UserTurnEvent.piece}, or {@link UserTurnEvent.drives}), or every open piece when it names
 *    none. ⛔ An idle Stop has no terminal underneath it, and without this boundary its actor could
 *    leak onto a later cancellation (491). ⚑ It notes what the turn was started for, and what the
 *    last interrupt cut that it does not name ({@link cutByAnInterrupt}). ⚑ A turn whose words asked
 *    for that interrupt drives what the cut turn was driving, at once and as its own
 *    ({@link UserTurnEvent.askedForTheStop}). ⚑ **F097** — and whose words drove each piece it
 *    drives, which a wake after it keeps ({@link whoseWordsDroveItLast}).
 *  - **`user_decision`** records nothing and moves nothing; a `cancel` remembers WHO pressed it,
 *    for the `turn` ending underneath it (494). ⛔ **Every other outcome is passed over** — they
 *    answer a request rather than stopping a turn. ⚑ It is the same branch shape as the one below
 *    it and the same field, which is what makes *the last ask wins* one rule rather than two.
 *  - **`work_interrupted`** records nothing and moves nothing; it remembers WHO asked, for the
 *    `turn` ending underneath it (484). ⛔ **Not a transition** — the ask is not what stalls the
 *    work, the ending is — and it is cleared by that ending whether or not anything used it, or by
 *    a later `user_turn` when no such ending belonged to the ask.
 *  - **`request_routed`** records nothing and moves nothing; it only remembers which question ids
 *    were the PARENT's to answer, which is what the branch below needs and cannot get from its own
 *    event.
 *  - **`request_stranded`** sets {@link PieceRow.questionLostAtRestart} on everything still open, for
 *    a question that had travelled, and changes no state. ⚑ **The one branch here that is not a transition**, which is the shape
 *    `deriveRoutedRequests` already carries for `request_escalated`: *has this ended?* and *was
 *    something lost underneath it?* are two questions, and one vocabulary answering both is how a
 *    word comes to imply something nobody said.
 *  - **`status`** — `working` and `idle` start and end a drive (D-013); a drive asked to stop is
 *    carried on by the next turn whose words asked for that stop ({@link theCutTurnDrove}), as a
 *    `turn` a stop cut is. ⚑ A `working` with no turn
 *    open leaves what it drives to the turn's row (D-016 · commit 6 · R4): a drive that ends, or a
 *    read that stops, before any such row came drove every open piece. ⛔ **A terminal one
 *    (`ended` | `errored`) is no cause of its own** (D-016c, `05`): the open turn's own row, which
 *    `close()` and a fatal error write first, has decided what it drove — a background wake's too,
 *    since F080 (`startedBy`); a wake in a ledger written before, which has no such row, is ended
 *    here as an interrupted turn ({@link endOfDrive}); and the background commands die with the
 *    process while the schedule does not ({@link backgroundMoved}). ⚑ What a drive had gone back to stands as its
 *    earlier stall first ({@link restoreTheEarlierStalls}).
 *    ⚑ So a piece stalls on a turn's cause and never on a stop. ⚠️ It closed them until `400`
 *    (HO-018 §2.3), and stalled them `conversation_ended` until D-016c.
 *    ⛔ **A stream that FAILED under the host is a stop this fold is not told about**: the host
 *    writes a fatal `error`, which no branch here reads, and the adapter's own `turn` and terminal
 *    `status` go into a queue that has already failed. What its owner was driving reads `working`
 *    until a row moves it — the end of its owner's next drive, or the next launch's
 *    `work_restarted`.
 *  - **nothing else.** Every other event type is passed over, which is why a fold over a 27,000-row
 *    conversation costs one comparison per row.
 *
 * ## ⛔ Why a crashed `message_queued` cannot be answered here
 *
 * ⚠️ **A ledger holding `message_queued` with no ending is BYTE-IDENTICAL in the two cases that
 * matter** — the app is live and holding the message, and the app died holding it (`354` measured
 * both, and measured that the next launch wrote no ending either). ⛔ **So no function over the
 * ledger alone can tell them apart, and this one must not try.** A dangling held message derives to
 * `waiting`, truthfully, and the repair belongs where the difference is knowable: at startup, in
 * `SessionStore.settleStrandedMessages`, which writes the ending the crash could not. ⚑ **`400` is
 * the same sentence one case over**: a piece whose brief HAD been sent leaves a ledger that is
 * byte-identical for an owner still thinking and an owner whose app was killed, so
 * `SessionStore.settleRestartedWork` writes that difference down too, at the one moment nothing is
 * running.
 */
export function derivePieces(
  owner: string,
  entries: Iterable<PersistedEventInfo>,
  /**
   * 🔴 **D-013 · does this conversation's provider wake it when its background work ends?** — the
   * provider's own `backgroundWake` capability, read by the store. ⚑ Claude does (a backgrounded
   * command's notification, a scheduled job firing); Codex does not (`275`, measured: a background
   * terminal's end reaches no model), so its background work holds nothing.
   */
  options: {
    readonly trackChanges?: boolean
    readonly checkState?: (state: readonly unknown[], complete?: boolean) => void
    /** The source ordinal of each observed stall, kept outside the public piece row. */
    readonly onStall?: (piece: string, ordinal: number) => void
    readonly backgroundWakesIt?: boolean
    /** ⚑ **F076** — this conversation's provider, for whose login a refusal names ({@link StoppedOnALogin.provider}). */
    readonly provider?: TurnLimitOnTheRow['provider']
  } = {},
): readonly PieceRow[] {
  const rows: PieceRow[] = []
  const changeTimes = new Map<string, { at: number; order: number }>()
  let changeAt = 0
  let changeOrder = 0
  let sourceOrdinal = -1
  const noteChange = (before: PieceRow, after: PieceRow): void => {
    if (
      options.trackChanges &&
      (theStateAsRead(before) !== theStateAsRead(after) ||
        before.statusLine !== after.statusLine ||
        before.definitionOfDone !== after.definitionOfDone) &&
      (changeTimes.get(after.piece)?.order ?? -1) <= changeOrder
    )
      changeTimes.set(after.piece, { at: changeAt, order: changeOrder })
  }
  // ⚠️ **Mutable state per open piece, folded down at the end.** A `PieceRow` is `readonly` because a
  // caller must not be able to edit a derivation; the fold keeps its own boxes.
  const open = new Map<string, { row: PieceRow; index: number }>()
  // ⚑ **724 · where each piece's row is, open or not** — `reply_undelivered` lands AFTER the reply
  // that closed the piece, and a line about a title or a status can land on an ended one, so `open`
  // has already let it go.
  const indexOfPiece = new Map<string, number>()
  const byMessage = new Map<string, string>()
  // ⚑ **Which of this conversation's questions were the PARENT's to answer** (400) — see
  // {@link PieceRow.questionLostAtRestart}. ⛔ Ids only: what became of each one is
  // `deriveRoutedRequests`' answer and this fold must not grow a second opinion about it.
  const travelled = new Set<string>()
  /**
   * 🔴 **484/491 · the ask the current turn ending belongs to, and nothing further back.**
   *
   * ⛔ **Consumed by the `turn` row it precedes, or discarded when a later `user_turn` opens.**
   * Those are the terminal and opener boundaries that keep it a fact about one turn rather than a
   * name that leaks forward. ⚠️ **The clearing is the load-bearing half**: a permission answered
   * `cancel` ends its turn `interrupted` — in the provider's own word since 709, unless the stream
   * then dies and the latch makes it this app's marked word (`720`, R71) — with NO
   * `work_interrupted` row at all,
   * so an idle ask left standing across the new turn would put a person's name on a cancellation
   * they never touched — which is `222`'s false sentence arriving through a different door.
   *
   * ⚑ **The LAST ask wins**, which is `howWorkStopped`'s own rule in this fold's currency: a person
   * stopping a turn an agent already asked about is named as the person.
   *
   * ⛔ **494 · TWO producers write into this box now**, and the sentence above is why that is safe
   * rather than ambiguous: whichever row the fold met last is the ask the ending belongs to.
   * ⚠️ The clearing paragraph's example moved with it — a permission answered `cancel` now writes
   * its own actor here, so what an idle ask must not cross into is a LATER turn, not this one.
   */
  let asked: Pick<AskToStop, 'by' | 'asker'> | null = null
  /** Whose words last drove each piece; notes preserve the author behind an existing person wait. */
  const whoseWordsDroveItLast = new Map<string, boolean>()
  let aPersonOpenedThisTurnFor: ((piece: string) => boolean) | null = null
  /** ⚑ **F097** — a person's own words last drove this piece ({@link whoseWordsDroveItLast}). */
  const aPersonOpenedItFor = (piece: string): boolean => whoseWordsDroveItLast.get(piece) === true
  /**
   * ⚑ **F097** — the ending each piece waiting on the person who wrote went to wait from: its moment
   * ({@link PieceRow.answeredAPersonAt}) and its cause, for a reply held for it ({@link aReplyIsHeldFor}).
   */
  const waitsOnWhoWroteSince = new Map<
    string,
    { readonly at: number; readonly cause: TaskStallCause }
  >()

  // ⚠️ **`carried` is what the REPLY brings and nothing else ever passes** — every other transition
  // moves a state and touches no field the agent authored. ⛔ Written as an explicit parameter
  // rather than as a mutation after the call, so a transition that forgot to clear it is a compile
  // error at the call site instead of a row that inherits another event's outcome.
  //
  // 🔴 **`stalledBecause` is CLEARED here and set nowhere but {@link stall}** (400). That is what
  // makes *"non-null if and only if the state is `stalled`"* a property of the code rather than a
  // sentence in a docblock: this function cannot write the state and the cause independently.
  const settle = (
    piece: string,
    state: Exclude<TaskState, 'stalled'>,
    at: number,
    /** 🔴 **D-025 · whose act the row is** — {@link PieceRow.endedBy}: `null` when it names nobody. */
    by: string | null,
    carried: Pick<
      PieceRow,
      | 'outcome'
      | 'summary'
      | 'resources'
      | 'needsUserAction'
      | 'statusLine'
      | 'resultDocument'
      | 'savedMethod'
    > | null = null,
    actor?: ActedBy,
  ): void => {
    const held = open.get(piece)
    if (held === undefined) return
    // ⛔ **The ending is stamped only for a state the table calls closed.** `stalled` is open, so it
    // carries no `endedAt` — see {@link PieceRow.endedAt}.
    const endedAt = TASK_IS_OPEN[state] ? held.row.endedAt : at
    // ⚑ **D-025 · and whose act it was, by the same rule** — the moment and the actor come off one
    // row, so they are stamped, and kept, together.
    const endedBy = TASK_IS_OPEN[state] ? held.row.endedBy : by
    const next: PieceRow = {
      ...held.row,
      ...(carried ?? {}),
      // ⚑ **D-025 · above `state`, and not beside `endedAt`**: `400` anchors the three lines from
      // `state,` to `stalledBecause: null,`, and a line among them would change their bytes.
      endedBy,
      ...(actor === undefined || TASK_IS_OPEN[state] ? {} : { endedByActor: actor }),
      state,
      endedAt,
      stalledBecause: null,
      // ⚑ **484 · cleared with the cause, because they are one fact written in three fields.**
      // {@link PieceRow.stalledBecause}'s own rule — *the fold cannot write the state and the cause
      // independently* — extended to the moment and the actor, so a `working` row can never carry
      // *who stopped it* from a stall it has since come back from.
      stalledAt: null,
      stalledBy: null,
    }
    noteChange(held.row, next)
    rows[held.index] = next
    if (TASK_IS_OPEN[state]) open.set(piece, { row: next, index: held.index })
    else {
      open.delete(piece)
      if (held.row.messageId !== null) byMessage.delete(held.row.messageId)
    }
  }

  /**
   * 🔴 **The only way into `stalled`, and it cannot be taken without saying what was observed**
   * (400).
   *
   * ⛔ **`stalled` is OPEN**, so nothing is stamped and nothing leaves `open` — the piece is still
   * somebody's to finish and a later reply or a later turn still reaches it.
   */
  const stall = (
    piece: string,
    cause: TaskStallCause,
    at: number,
    /** ⚑ **D-005a** — the ask of the turn that ended, for a stall written after it ({@link heldForTheQueue}). */
    by: PieceRow['stalledBy'] = asked,
    /** ⚑ What was running in the background for it and stopped — {@link PieceRow.stoppedInTheBackground}. */
    stopped: readonly string[] = [],
    /** ⚑ **F074** — the usage limit its turn ended on — {@link PieceRow.stoppedOnALimit}. */
    limit?: StoppedOnALimit,
    /** ⚑ **F076** — an earlier login stall this one restores — {@link PieceRow.stoppedOnALogin}. */
    login?: StoppedOnALogin,
  ): void => {
    const held = open.get(piece)
    if (held === undefined) return
    // ⚑ **D-017 · R10 — `could_not_be_reopened` is final** (its own note): a row written after the
    // `replaced_by` — the message that carried the work, ended as what it held was handed on — does
    // not re-word it.
    if (held.row.stalledBecause === 'could_not_be_reopened') return
    // ⚑ Written or dropped at every stall, so a row never carries an earlier stall's list or limit.
    const {
      stoppedInTheBackground: earlier,
      stoppedOnALimit: earlierLimit,
      stoppedOnALogin: earlierLogin,
      ...unstalled
    } = held.row
    void earlier
    void earlierLimit
    void earlierLogin
    const next: PieceRow = {
      ...unstalled,
      ...(stopped.length > 0 ? { stoppedInTheBackground: stopped } : {}),
      // ⚑ **F074** — handed only with `provider_limited`, by the turn that ended on the limit.
      ...(limit === undefined ? {} : { stoppedOnALimit: limit }),
      // ⚑ **F076** — handed only with `login_refused`, by the drive that failed on the login; and
      // reopened when a `reopened` row has come since.
      ...(login === undefined
        ? {}
        : {
            stoppedOnALogin:
              login.reopened || reopenedSinceItsLoginWasRefused
                ? { ...login, reopened: true }
                : login,
          }),
      state: 'stalled',
      endedAt: null,
      stalledBecause: cause,
      stalledAt: at,
      // 🔴 **484 · who asked is carried only where a TURN's ask can reach** — and since `720` (R72)
      // that is both turn causes: {@link AN_ASK_RIDES_ON}. ⛔ A launch sweep, a message the app
      // never sent and a replacement have no turn ending for an ask to precede, and a `by` on any
      // of them would be this fold guessing at an author the ledger does not record.
      stalledBy: AN_ASK_RIDES_ON[cause] ? by : null,
    }
    noteChange(held.row, next)
    rows[held.index] = next
    open.set(piece, { row: next, index: held.index })
    options.onStall?.(piece, sourceOrdinal)
  }

  /**
   * 🔴 **D-016 · commit 6 · R3 — the drive that held this piece ended with it open.** A piece
   * stalls on the drive's cause; ⚑ a piece a PERSON gave waits on them instead — no cause, no
   * notice, no band (`waiting-on-the-person-who-asked`) — where their own words opened the turn, it
   * ended on its own and nobody asked it to stop. ⚑ **F097 · and a piece a conversation
   * gave waits on the person who wrote** (`waiting-on-the-person-who-wrote`) when a person's own
   * words opened the turn, it ended on its own ({@link A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON}) and
   * nobody asked it to stop. ⚑ Every caller hands it a `working`
   * piece: the end of a drive ({@link endOfDrive}) and the holds let go after one
   * ({@link nothingWillDriveIt}, {@link backgroundMoved}, and the queue's own per piece).
   */
  const endedWithItOpen = (
    piece: string,
    cause: TaskStallCause,
    at: number,
    by: PieceRow['stalledBy'] = asked,
    stopped: readonly string[] = [],
    limit?: StoppedOnALimit,
    login?: StoppedOnALogin,
    /**
     * ⚑ **F097** — a person's own words opened the turn this is the end of, for this piece: the
     * drive's own, or what a hold kept of the drive whose ending it put off.
     */
    aPersonWroteIt = aPersonOpenedItFor(piece),
    /** ⚑ **F097** — since when it waited on that person, when a reply held for it is let go. */
    since?: number,
  ): void => {
    const held = open.get(piece)
    if (held === undefined) return
    if (
      held.row.giver !== null &&
      aPersonWroteIt &&
      by === null &&
      A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[cause]
    ) {
      const waits: PieceRow = {
        ...held.row,
        state: 'waiting-on-the-person-who-wrote',
        endedAt: null,
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
      }
      noteChange(held.row, waits)
      rows[held.index] = waits
      open.set(piece, { row: waits, index: held.index })
      waitsOnWhoWroteSince.set(piece, { at: since ?? at, cause })
      return
    }
    // ⚑ A piece a person gave waits on them only where they asked in the turn that ended: their own
    // words opened it, it ended on its own, and nobody asked it to stop. ⛔ Otherwise it stopped,
    // with its cause, and nothing says the person owes it anything.
    if (
      held.row.giver !== null ||
      !aPersonWroteIt ||
      by !== null ||
      !A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[cause]
    ) {
      stall(piece, cause, at, by, stopped, limit, login)
      return
    }
    const next: PieceRow = {
      ...held.row,
      state: 'waiting-on-the-person-who-asked',
      endedAt: null,
      stalledBecause: null,
      stalledAt: null,
      stalledBy: null,
    }
    noteChange(held.row, next)
    rows[held.index] = next
    open.set(piece, { row: next, index: held.index })
  }

  /**
   * 🔴 **D-005a · F019 — the messages waiting in this conversation's OWN queue**, by id.
   *
   * ⚑ Measured by BroBot (F019's fix check, 2026-09-27, task #25): both helpers answered while their
   * owner was mid-turn, so their answers waited in its queue. Its turn ended with no helper work
   * open, the fold stalled its work, and the giver was told *"not being worked on"* about 10 s before
   * those answers started the owner's next turn. ⛔ **A message waiting here IS something driving
   * the work**: it starts the next turn when it goes out.
   *
   * ⚠️ An unnamed row (written before messages had names, `354`) pairs with nothing and is not
   * counted: counted, it could never leave, and the work would never stall.
   *
   * 🔴 **D-016 · commit 6 · R4 — each one maps to what it will drive** when it goes out
   * ({@link theDriveOf}): the one piece its row names, or `null` — every open piece, as every row
   * written before commit 6 does. ⚑ So work is held only for a message that will drive it.
   */
  const waitingToDriveIt = new Map<string, { target: string | null; note: boolean }>()
  const aWaitingMessageDrives = (piece: string, preservesPersonWait = false): boolean =>
    [...waitingToDriveIt.values()].some(
      ({ target, note }) =>
        (!preservesPersonWait || !note) && (target === null || target === piece),
    )
  /**
   * 🔴 **D-005a · work a turn ended on while something waited to drive it** — what that turn's end
   * would have written (a stall, or since D-016 · commit 6 the wait on the person who asked), kept so
   * that it is still written if no waiting message that drives it goes out (HO-018 §2.1: *nobody
   * waits forever in silence*). The row reads `working` meanwhile.
   */
  const heldForTheQueue = new Map<
    string,
    {
      readonly cause: TaskStallCause
      readonly by: PieceRow['stalledBy']
      readonly stopped?: readonly string[]
      /** ⚑ **F076** — the login rider its drive's end chose, handed on at the release. */
      readonly login?: StoppedOnALogin
      /** ⚑ **F097** — a person's own words opened the turn that drive ended, handed on at the release. */
      readonly aPersonWroteIt?: boolean
      /** ⚑ **F097** — since when it waited on that person, for a reply held for it ({@link aReplyIsHeldFor}). */
      readonly since?: number
    }
  >()
  const holdsAPersonReply = (
    piece: string,
    held:
      { aPersonWroteIt?: boolean; by: PieceRow['stalledBy']; cause: TaskStallCause } | undefined,
  ): boolean => {
    const row = open.get(piece)?.row
    return (
      row !== undefined &&
      row.giver !== null &&
      held?.aPersonWroteIt === true &&
      held.by === null &&
      A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[held.cause]
    )
  }
  /**
   * 🔴 **D-013 · the background work this conversation's provider reports running** — ids to what
   * each is (`background_work`'s level, less what it says ENDED) and the wake-ups it has scheduled
   * (`scheduled_work`'s level). Levels REPLACE, never merge (`247`).
   */
  const inTheBackground = new Map<string, string>()
  const scheduled = new Map<string, string>()
  const backgroundWakesIt = options.backgroundWakesIt === true
  /** ⚑ **D-013 · a drive ended on these while waking background work ran** — see {@link PieceRow.inTheBackground}. */
  const heldForTheBackground = new Map<
    string,
    {
      readonly cause: TaskStallCause
      readonly by: PieceRow['stalledBy']
      /** ⚑ **F076** — the login rider its drive's end chose, handed on at the release. */
      readonly login?: StoppedOnALogin
      /** ⚑ **F097** — a person's own words opened the turn that drive ended, handed on at the release. */
      readonly aPersonWroteIt?: boolean
    }
  >()
  /**
   * ⚑ **F076 — work its held background stalled as that work finished, while the provider's wake
   * was still to come** ({@link backgroundWakesIt}), by when: the wake's drive judges it again — and
   * a session a refused login ends before that wake ran stalls it on the login instead. ⚑ **F097** —
   * work that release left waiting on the person who wrote, too, by the same moment.
   */
  const stalledAsItsWakeWasDue = new Map<string, number>()
  /**
   * ⚑ **F076 — the stop being read ended the session on a refused login** — set around the stop
   * arm's own {@link endOfDrive}, so the drive it cut stalls `login_refused` rather than
   * `turn_interrupted`.
   */
  let theStopWasARefusedLogin = false
  /** ⚑ …and that login was an API key a person saved (`onAKey` on the stop's `status`). */
  let theStopWasOnAKey = false
  /**
   * ⚑ **F076 — a `reopened` row since the last refused login** — so a stall written after the
   * reopen (a hold let go later, a stall put back) says it was reopened.
   */
  let reopenedSinceItsLoginWasRefused = false
  /** ⚑ **D-013 · a turn is open** (a received message opened it, and its `turn` has not closed it). */
  let aTurnIsOpen = false
  /**
   * 🔴 **D-016 · commit 6 · R4 — a drive began (`status: working` with no turn open) and its turn's
   * row has not come**: that row says what it drives. ⚑ Until it comes — and for a wake, which no
   * message opens — the drive is every open piece's, as a `status: working` was before per-piece driving:
   * a stall notice asked at this row must not tell a giver *"not being worked on"* about work the
   * coming turn drives. ⚑ Resolved by {@link aDriveNamedNothing} wherever the drive's end is judged,
   * and at the end of the read.
   */
  let aDriveWaitsForItsTurn = false
  let pendingDriveAt = 0
  let pendingDriveOrder = 0
  /**
   * ⚑ **D-013 · the provider is running and no `turn` has ended the drive yet** — set by `working`,
   * cleared by a `turn` or a stop. ⚑ A background wake ends on its own `turn` row since F080
   * (`startedBy`); in a ledger written before, it went idle again, or was stopped, with no turn.
   */
  let driving = false
  /**
   * 🔴 **The work an interrupt cut, and the turn it made room for** — measured: an interrupt made
   * room for another piece's brief, and its owner answered that piece and went back, in the same
   * turn, to the work the interrupt had stopped — which read stalled until its own reply, and
   * refused every give to its owner meanwhile.
   *
   *  - {@link cutByAnInterrupt} — what an interrupted turn stalled, each by the moment of that stall,
   *    handed to the next turn. ⚑ **F075** — and what a turn a stop was asked of stalled, when its
   *    provider ended it otherwise (`completed`, or `failed` short of a usage limit or a refused
   *    login).
   *  - {@link theTurnNames} — the pieces that turn was started for, when its row named each of them;
   *    `null` when it named none, which drove every open piece already.
   *  - {@link theTurnGoesBackTo} — what the interrupt cut and that turn does not name. ⛔ Only a
   *    piece still standing on the stall the interrupt made is gone back to.
   *
   * ⚑ **Once its owner has answered every piece it was started for and the turn goes on, it goes
   * back to those** ({@link goBackToWhatTheInterruptCut}) — ⚠️ provisionally ({@link wentBackTo}): at
   * the turn's end, one nothing named since stands as its earlier stall, cause, moment and ask whole
   * ({@link restoreTheEarlierStalls}) — ⛔ never a new `turn_ended`, and never held for the
   * background.
   */
  let cutByAnInterrupt = new Map<string, number>()
  let theTurnNames: Set<string> | null = null
  let theTurnGoesBackTo = new Map<string, number>()
  /**
   * ⚑ **What a drive a stop cut was driving, as the cut left each piece** — stalled at a moment
   * (and whether that drive had only gone back to it), waiting on the person who gave it, or held
   * for the background — for a next turn whose words asked for that stop
   * ({@link UserTurnEvent.askedForTheStop}): it carries on with them, as the cut drive did.
   */
  type AsTheCutLeftIt =
    | { readonly stalledAt: number; readonly wentBack: boolean }
    | { readonly waitsOnItsPerson: true }
    | { readonly heldForTheBackground: true }
  let theCutTurnDrove = new Map<string, AsTheCutLeftIt>()
  const wentBackTo = new Map<
    string,
    {
      readonly cause: TaskStallCause
      readonly at: number
      readonly by: PieceRow['stalledBy']
      readonly limit?: StoppedOnALimit
      readonly login?: StoppedOnALogin
    }
  >()
  /**
   * ⚑ **D-005a** — nothing will go out of the queue (the conversation was replaced): write what each
   * held piece's drive ended as, now.
   */
  const nothingWillDriveIt = (at: number): void => {
    for (const [piece, was] of heldForTheQueue) {
      if (open.get(piece)?.row.state === 'working') {
        endedWithItOpen(
          piece,
          was.cause,
          at,
          was.by,
          was.stopped,
          undefined,
          was.login,
          was.aPersonWroteIt === true,
          was.since,
        )
      }
    }
    heldForTheQueue.clear()
  }

  /**
   * ⚑ **F097 · a person's own words, held while their conversation is busy, are their reply** — so
   * each piece waiting on the person who wrote that those words will drive (`target`, or every piece
   * when they name none) is `working` again, held for the queue with the ending it waited from
   * (D-005a): the words going out drive it, and their being taken back leaves it waiting on that
   * person again, since the moment it first did. ⛔ Until then the person's list and count would ask
   * them for a reply they already wrote.
   */
  const aReplyIsHeldFor = (target: string | null): void => {
    for (const [piece, held] of [...open]) {
      if (held.row.state !== 'waiting-on-the-person-who-wrote') continue
      if (target !== null && target !== piece) continue
      const was = waitsOnWhoWroteSince.get(piece)
      if (was === undefined) continue
      heldForTheQueue.set(piece, {
        cause: was.cause,
        by: null,
        aPersonWroteIt: true,
        since: was.at,
      })
      const driven: PieceRow = { ...held.row, state: 'working' }
      noteChange(held.row, driven)
      rows[held.index] = driven
      open.set(piece, { row: driven, index: held.index })
    }
  }

  /**
   * 🔴 **D-013 · the background moved** — and when nothing waking is left, the work it held stalls
   * (*"it stalls only if that ends with no reply"*). ⚠️ The provider's wake, if one comes, starts a
   * drive ({@link drivenAgain}) and its end is judged again by {@link endOfDrive}.
   */
  const backgroundMoved = (
    at: number,
    /**
     * ⚑ **What a conversation's END stopped**, and the cause its producer named for it — handed in,
     * so this helper names no cause of its own: the work held on it stalls on that, never on its
     * turn's own cause.
     */
    ended: {
      readonly cause: TaskStallCause
      readonly by: PieceRow['stalledBy']
      readonly stopped: readonly string[]
    } | null = null,
  ): void => {
    if (inTheBackground.size + scheduled.size > 0) return
    for (const [piece, was] of heldForTheBackground) {
      if (open.get(piece)?.row.state !== 'working') continue
      const why = ended ?? was
      // ⚑ **D-016 · commit 6 · R4 — a message queued since, that will drive it, holds it now**, as
      // it would have held it at its drive's end: a drive that named another piece left this hold
      // standing ({@link drivenAgain}), and a message waiting IS something driving the work.
      if (aWaitingMessageDrives(piece, ended === null && holdsAPersonReply(piece, was)))
        heldForTheQueue.set(piece, why)
      else {
        endedWithItOpen(
          piece,
          why.cause,
          at,
          why.by,
          ended?.stopped,
          undefined,
          ended === null ? was.login : undefined,
          ended === null && was.aPersonWroteIt === true,
        )
        // ⚑ **F076** — finished, not stopped, on a provider whose wake comes next.
        if (ended === null && backgroundWakesIt) stalledAsItsWakeWasDue.set(piece, at)
      }
    }
    heldForTheBackground.clear()
  }

  /**
   * ⚑ **The drive that went back ends**: each piece it went back to that nothing named since stands
   * as its earlier stall again ({@link wentBackTo}) — a stall it was handed, put back, so it names
   * none of its own. Answers which.
   */
  const restoreTheEarlierStalls = (): string[] => {
    const restored: string[] = []
    for (const [piece, was] of wentBackTo) {
      if (open.get(piece)?.row.state !== 'working') continue
      stall(piece, was.cause, was.at, was.by, [], was.limit, was.login)
      restored.push(piece)
    }
    wentBackTo.clear()
    return restored
  }

  /** Drive the target work; informational notes keep existing person waits and their pending holds. */
  const drivenAgain = (target: string | null, preservesPersonWait = false): void => {
    // ⚑ **D-005a** — and what its queue was holding for it has driven it: nothing is owed.
    // ⚑ **D-013** — nor what the background held: the drive that ends next decides again.
    if (target === null) {
      for (const holds of [heldForTheQueue, heldForTheBackground]) {
        for (const [piece, held] of holds) {
          if (!preservesPersonWait || !holdsAPersonReply(piece, held)) holds.delete(piece)
        }
      }
    } else {
      for (const holds of [heldForTheQueue, heldForTheBackground]) {
        if (!preservesPersonWait || !holdsAPersonReply(target, holds.get(target)))
          holds.delete(target)
      }
    }
    for (const [piece, held] of [...open]) {
      if (target !== null && piece !== target) continue
      // Notes leave the person wait in place; substantive drives clear it.
      if (held.row.state === 'waiting-on-the-person-who-wrote') {
        if (preservesPersonWait) continue
        const driven: PieceRow = { ...held.row, state: 'working' }
        noteChange(held.row, driven)
        rows[held.index] = driven
        open.set(piece, { row: driven, index: held.index })
        continue
      }
      const cause = held.row.stalledBecause
      // ⚑ **D-016 · commit 6 · R3** — a piece a person gave that waits on them is driven as a stall
      // its owner running again ends is; neither leaves any other state.
      if (held.row.state !== 'waiting-on-the-person-who-asked') {
        if (held.row.state !== 'stalled' || cause === null) continue
        if (!ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[cause]) continue
      }
      const next: PieceRow = {
        ...held.row,
        state: 'working',
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
      }
      noteChange(held.row, next)
      rows[held.index] = next
      open.set(piece, { row: next, index: held.index })
    }
  }

  /**
   * ⚑ **D-016 · commit 6 · R4 — the drive that began with no turn open is judged, or the read ends,
   * and no turn's row said what it drives**: it drove every open piece
   * ({@link aDriveWaitsForItsTurn}).
   */
  const aDriveNamedNothing = (): void => {
    if (!aDriveWaitsForItsTurn) return
    aDriveWaitsForItsTurn = false
    drivenAgain(null)
  }

  /**
   * ⛔ **A note on every open piece, and never a transition** (400) — see
   * {@link PieceRow.questionLostAtRestart}.
   *
   * ⚠️ **Every OPEN one, because the ROUTING rows do not name a piece.** A conversation asks its
   * parent a question while it is doing work; which of the pieces it holds a MODEL-raised question
   * was about is not a fact the ledger contains, and inventing an attribution would be worse than
   * saying it of all the work that was in flight.
   *
   * 🔴 **`437` made that conditional, and this fold has not caught up.** {@link QuestionAskedEvent}
   * carries a `piece`, so a question raised through `ask_question` IS attributable — and this branch
   * still marks every open piece, because it matches on `travelled`, which holds ids and not
   * subjects. ⛔ **Stated rather than quietly narrowed**: making it exact would mean reading a
   * second event type here to learn one id's subject, and `400`'s rule is that this fold keeps no
   * second opinion about a question. ⚠️ **A finding for whoever needs the precision**, not a defect
   * — the flag is deliberately generous and says so.
   *
   * ⚑ **474 took the precision somewhere else rather than narrowing this** (`463` F4). {@link
   * workNamed} resolves `question_asked.piece` for the readers that ASK about one question, so a
   * person's queue and the transcript name the work exactly — and this flag goes on being generous,
   * because it answers a different question: *which of this conversation's work lost a question at
   * a restart*, of which the ledger records the ids and not the subjects. ⛔ Widening it here would
   * still be a second opinion, and `400`'s rule still holds.
   */
  const noteTheLostQuestion = (requestId: string): void => {
    if (!travelled.has(requestId)) return
    for (const [piece, held] of [...open]) {
      if (held.row.questionLostAtRestart) continue
      const next: PieceRow = { ...held.row, questionLostAtRestart: true }
      noteChange(held.row, next)
      rows[held.index] = next
      open.set(piece, { row: next, index: held.index })
    }
  }

  /**
   * 🔴 **D-013 · a drive ENDED — a turn, or a background wake (its own turn since F080)** (and D-016c: a
   * stop that cut either) — and what each piece of work still `working` becomes: held for the queue
   * (D-005a) when a waiting message will drive it (per piece since D-016 · commit 6), held for the
   * background, or ended open — stalled, or waiting on the person who asked
   * ({@link endedWithItOpen}). ⚑ ONE decision for every edge, so a wake's end and a stop's cannot be
   * judged by another rule.
   *
   * ⛔ **D-016 · commit 6 · R4 — a piece already held is not this drive's to judge.** A drive drops
   * the hold of every piece it drives ({@link drivenAgain}), so a piece still held for the queue or
   * the background was held by an earlier drive this one did not drive: its pending ending — that
   * drive's cause and ask — stands, and a drive that named another piece neither re-causes it nor
   * puts it in the second hold. ⚑ So a piece sits in one hold at most.
   */
  const endOfDrive = (
    interrupted: boolean,
    at: number,
    /** ⚑ **F074** — the usage limit the turn ended on, when its `turn` row carries one. */
    limit?: StoppedOnALimit,
    /** ⚑ **F076** — its provider refused the login the turn's conversation was started with (`loginRefused`). */
    loginRefused = false,
    /** ⚑ …and that login was an API key a person saved (`onAKey`). */
    onAKey = false,
    /** Its provider would not bill the account the turn ran on (`billingRefused`). */
    billingRefused = false,
  ): void => {
    // 🔴 **The ONE place the two TURN causes are produced** — for a `turn`, a wake and a stop
    // alike, so a wake's end is a turn's end, said the same way (`400`'s one producer per cause).
    //
    // 🔴 **`interrupted` is INCLUDED, and `393` and `398` both excluded it** (400). ⛔ Their
    // reason was that folding it here *"would report work as `said nothing` the instant somebody
    // pressed Stop"* — a complaint about the word `silent`, which is gone. ⚑ An interrupted turn
    // is nothing driving the work, said plainly, and it is exactly what criterion 4 is for; the
    // cause below is what keeps the two distinguishable.
    // ⚑ **F074 — and a turn its provider refused for its usage limit is the third**, which says so.
    const cause: TaskStallCause = interrupted
      ? 'turn_interrupted'
      : limit !== undefined
        ? 'provider_limited'
        : billingRefused
          ? 'billing_refused'
          : 'turn_ended'
    // ⚑ **F076 — and one that failed on a login this Mac moved on from, the fourth**: its `turn`
    // row, or the stop of the session that login ended ({@link theStopWasARefusedLogin}).
    const onTheLogin = loginRefused || theStopWasARefusedLogin
    const because: TaskStallCause = onTheLogin ? 'login_refused' : cause
    const keyRefused = loginRefused ? onAKey : theStopWasARefusedLogin && theStopWasOnAKey
    const login: StoppedOnALogin | undefined = onTheLogin
      ? {
          reopened: false,
          ...(keyRefused ? { onAKey: true } : {}),
          ...(options.provider === undefined ? {} : { provider: options.provider }),
        }
      : undefined
    if (onTheLogin) reopenedSinceItsLoginWasRefused = false
    for (const [piece, held] of [...open]) {
      if (held.row.state !== 'working') continue
      if (heldForTheQueue.has(piece) || heldForTheBackground.has(piece)) continue
      // ⚑ **F074 — a turn its provider refused for the usage limit is said at once**: what waits to
      // drive the work — a held message, a background wake — meets the same limit, and the app
      // holds its own until the reset, so its giver would hear nothing for hours.
      // ⚑ **F097** — each hold keeps whose words opened the turn, for the ending it puts off.
      // A billing refusal is said at once for the same reason: what waits meets the same refusal
      // until a person pays.
      const saidAtOnce = limit !== undefined || billingRefused
      const personWait =
        held.row.giver !== null &&
        aPersonOpenedItFor(piece) &&
        asked === null &&
        A_TURN_THAT_ANSWERED_A_PERSON_ENDS_ON[because]
      if (!saidAtOnce && aWaitingMessageDrives(piece, personWait)) {
        heldForTheQueue.set(piece, {
          cause: because,
          by: asked,
          ...(login ? { login } : {}),
          aPersonWroteIt: aPersonOpenedItFor(piece),
        })
      } else if (!saidAtOnce && backgroundWakesIt && inTheBackground.size + scheduled.size > 0) {
        heldForTheBackground.set(piece, {
          cause: because,
          by: asked,
          ...(login ? { login } : {}),
          aPersonWroteIt: aPersonOpenedItFor(piece),
        })
      } else endedWithItOpen(piece, because, at, asked, [], limit, login)
    }
  }

  /**
   * ⚑ **The open turn's owner has answered what it was started for, and the turn goes on: it goes
   * back to what the interrupt cut** — each still stalled by that interrupt is driven again,
   * remembering its stall ({@link wentBackTo}).
   */
  const goBackToWhatTheInterruptCut = (): void => {
    for (const [piece, cutAt] of theTurnGoesBackTo) {
      const held = open.get(piece)?.row
      if (held?.state !== 'stalled' || held.stalledAt !== cutAt) continue
      if (held.stalledBecause === null) continue
      wentBackTo.set(piece, {
        cause: held.stalledBecause,
        at: cutAt,
        by: held.stalledBy,
        ...(held.stoppedOnALimit === undefined ? {} : { limit: held.stoppedOnALimit }),
        ...(held.stoppedOnALogin === undefined ? {} : { login: held.stoppedOnALogin }),
      })
      drivenAgain(piece)
    }
    theTurnGoesBackTo = new Map()
  }

  /**
   * ⚑ **A drive a stop cut has ended: note what it was driving, as the cut left it** — see
   * {@link theCutTurnDrove}. `heldBefore` is the background's hold as the drive's end found it.
   */
  const noteWhatTheCutDrove = (
    driven: readonly string[],
    wentBack: readonly string[],
    heldBefore: ReadonlySet<string>,
  ): void => {
    theCutTurnDrove = new Map()
    for (const piece of [...driven, ...wentBack]) {
      const row = open.get(piece)?.row
      if (row?.state === 'stalled' && row.stalledAt !== null) {
        theCutTurnDrove.set(piece, { stalledAt: row.stalledAt, wentBack: wentBack.includes(piece) })
      } else if (row?.state === 'waiting-on-the-person-who-asked') {
        theCutTurnDrove.set(piece, { waitsOnItsPerson: true })
      } else if (
        row?.state === 'working' &&
        heldForTheBackground.has(piece) &&
        !heldBefore.has(piece)
      ) {
        theCutTurnDrove.set(piece, { heldForTheBackground: true })
      }
    }
  }

  /**
   * ⚑ **The turn opened by words that asked for the stop carries on with what it cut** — each piece
   * still as the cut left it is driven again: as this turn's own, or, where the cut drive had only
   * gone back to it and this turn does not name it, provisionally again ({@link wentBackTo}).
   */
  const carryOnWithWhatTheCutDrove = (
    cut: ReadonlyMap<string, AsTheCutLeftIt>,
    startedFor: ReadonlySet<string> | null,
  ): void => {
    for (const [piece, how] of cut) {
      const row = open.get(piece)?.row
      if (row === undefined) continue
      if ('waitsOnItsPerson' in how) {
        if (row.state === 'waiting-on-the-person-who-asked') drivenAgain(piece)
      } else if ('heldForTheBackground' in how) {
        if (row.state === 'working' && heldForTheBackground.has(piece)) drivenAgain(piece)
      } else if (row.state === 'stalled' && row.stalledAt === how.stalledAt) {
        if (row.stalledBecause === null) continue
        if (how.wentBack && startedFor !== null && !startedFor.has(piece)) {
          wentBackTo.set(piece, {
            cause: row.stalledBecause,
            at: how.stalledAt,
            by: row.stalledBy,
            ...(row.stoppedOnALimit === undefined ? {} : { limit: row.stoppedOnALimit }),
            ...(row.stoppedOnALogin === undefined ? {} : { login: row.stoppedOnALogin }),
          })
        }
        drivenAgain(piece)
      }
    }
  }

  const checkState = (complete = false) => {
    options.checkState?.(
      [
        rows,
        changeTimes,
        open,
        indexOfPiece,
        byMessage,
        travelled,
        whoseWordsDroveItLast,
        waitsOnWhoWroteSince,
        waitingToDriveIt,
        heldForTheQueue,
        inTheBackground,
        scheduled,
        heldForTheBackground,
        stalledAsItsWakeWasDue,
        cutByAnInterrupt,
        theTurnNames,
        theTurnGoesBackTo,
        theCutTurnDrove,
        wentBackTo,
      ],
      complete,
    )
  }

  for (const entry of entries) {
    checkState()
    changeAt = entry.at
    sourceOrdinal = entry.ordinal
    changeOrder += 1
    const event = entry.event
    if (event.type === 'user_turn') {
      // ⚑ **F076** — a turn of ours runs: what it drives is its own to judge.
      stalledAsItsWakeWasDue.clear()
      // 🔴 **491 · a new turn is the boundary an idle ask cannot cross.** A person's Stop
      // while nothing is running still writes `work_interrupted`, truthfully, but a later permission
      // can be cancelled without writing another ask. Keeping the idle row until that later turn's
      // terminal would name the person as the author of a cancellation they did not perform.
      //
      // ⛔ **The boundary is the durable row that OPENS the turn**, not `work_given`: a piece can
      // be given while an older turn is still running, and clearing there would erase the real
      // author of that older turn's ending. `SessionStore.appendTx` opens turns on this exact event.
      asked = null
      aTurnIsOpen = true
      // ⚑ **D-016 · commit 6 · R4** — the drive a `status: working` began is this turn's, and this
      // row says what it drives.
      aDriveWaitsForItsTurn = false
      // 🔴 **D-005 · and the turn it opens drives the work its owner already holds** (F019) — since
      // D-016 · commit 6 · R4 the piece it names, or every open piece when it names none.
      // ⚑ **D-027 · a turn that delivered several messages drives what each of them drives** — its
      // parts as the store's replay bound left them (`boundTheParts`): each an object with words.
      // ⚠️ A row whose parts none read drives every open piece, as a turn that names none does.
      const parts = event.parts ?? [event]
      // Track personal authorship for each piece that a substantive message drives.
      const aPersonsFor = aPersonOpenedTheTurnFor(parts)
      aPersonOpenedThisTurnFor = aPersonsFor
      const substantive = parts.filter((one) => !aNoteExpectsNoReply(one))
      // ⚑ **What it was started for, and what it would go back to** ({@link cutByAnInterrupt}).
      const named = parts.map(theDriveOf).filter((one): one is string => one !== null)
      const startedFor = parts.length > 0 && named.length === parts.length ? new Set(named) : null
      theTurnNames = startedFor
      // ⚑ **Words that asked for the stop carry on with what it cut** — see
      // {@link carryOnWithWhatTheCutDrove}.
      const carriesOn =
        event.askedForTheStop === true ? theCutTurnDrove : new Map<string, AsTheCutLeftIt>()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo =
        startedFor === null
          ? new Map()
          : new Map(
              [...cutByAnInterrupt].filter(
                ([piece]) => !startedFor.has(piece) && !carriesOn.has(piece),
              ),
            )
      cutByAnInterrupt = new Map()
      // ⚑ **F097** — whose words drove each piece this turn drives: the pieces its messages name,
      // every open one when one names none, and what it carries on with.
      const drivesEvery = parts.length === 0 || named.length < parts.length
      for (const piece of [...(drivesEvery ? open.keys() : []), ...named, ...carriesOn.keys()]) {
        if (
          (open.get(piece)?.row.state === 'waiting-on-the-person-who-wrote' ||
            holdsAPersonReply(piece, heldForTheQueue.get(piece)) ||
            holdsAPersonReply(piece, heldForTheBackground.get(piece))) &&
          parts.length > 0 &&
          !substantive.some((one) => theDriveOf(one) === null || theDriveOf(one) === piece)
        )
          continue
        whoseWordsDroveItLast.set(piece, aPersonsFor(piece))
      }
      // A follow-up naming a piece ends its wait on purpose; any other words leave it standing.
      for (const one of parts) {
        const followedUp = one.says === 'follow-up' ? theDriveOf(one) : null
        const index = followedUp === null ? undefined : indexOfPiece.get(followedUp)
        const held = index === undefined ? undefined : rows[index]
        if (followedUp === null || index === undefined || held?.statusLine?.waiting !== true)
          continue
        const next: PieceRow = { ...held, statusLine: withoutTheWait(held.statusLine) }
        noteChange(held, next)
        rows[index] = next
        if (open.has(followedUp)) open.set(followedUp, { row: next, index })
      }
      carryOnWithWhatTheCutDrove(carriesOn, startedFor)
      if (parts.length === 0) drivenAgain(null)
      for (const one of parts) drivenAgain(theDriveOf(one), aNoteExpectsNoReply(one))
      continue
    }
    if (event.type === 'work_given') {
      const messageId = event.messageId ?? null
      const row: PieceRow = {
        piece: event.piece,
        label: event.label,
        parent: event.parent,
        title: event.title,
        brief: event.brief,
        definitionOfDone: event.definitionOfDone ?? null,
        giver: event.givenBy,
        owner,
        givenAt: entry.at,
        messageId,
        state: messageId === null ? 'working' : 'waiting',
        endedAt: null,
        endedBy: null,
        outcome: null,
        stalledBecause: null,
        stalledAt: null,
        stalledBy: null,
        questionLostAtRestart: false,
        summary: null,
        answerReachedNobody: false,
        resources: [],
        needsUserAction: false,
        statusLine: null,
        // ⚑ **W4.189** — the folder its give named, as recorded with it; an older give has none.
        ...(event.givenFolder === undefined ? {} : { givenFolder: event.givenFolder }),
        ...(event.asked === undefined ? {} : { asked: event.asked }),
        // ⚑ **W4.189** — a brief that went straight out was handed over with its give.
        ...(messageId === null ? { briefHandedOver: true as const } : {}),
      }
      indexOfPiece.set(event.piece, rows.length)
      open.set(event.piece, { row, index: rows.length })
      if (messageId !== null) byMessage.set(messageId, event.piece)
      rows.push(row)
      // ⚑ Work its owner took on for a person in a turn: whose words opened that turn drove it.
      if (event.givenBy === null && aTurnIsOpen && aPersonOpenedThisTurnFor !== null) {
        whoseWordsDroveItLast.set(event.piece, aPersonOpenedThisTurnFor(event.piece))
      }
      continue
    }
    if (event.type === 'message_queued') {
      // 🔴 **D-005a** — see {@link waitingToDriveIt}.
      if (event.messageId !== undefined) {
        waitingToDriveIt.set(event.messageId, {
          target: theDriveOf(event),
          note: aNoteExpectsNoReply(event),
        })
      }
      // ⚑ **F097** — a person's own words, held, are their reply ({@link aReplyIsHeldFor}).
      if (event.messageId !== undefined && aPersonsOwnWords(event)) {
        aReplyIsHeldFor(theDriveOf(event))
      }
      continue
    }
    if (event.type === 'message_unqueued') {
      // ⛔ **An unnamed ending pairs with nothing** (`354`). A ledger written before messages had
      // names holds `message_unqueued` rows with no `messageId`, and treating `undefined` as a match
      // would close whichever piece happened to be open.
      if (event.messageId === undefined) continue
      // 🔴 **D-005a · the last message that would have driven it left without going out** — so what
      // its turn's end was holding is written now. ⚑ `sent` writes nothing: the turn it starts drives
      // what it drives ({@link drivenAgain}).
      // ⚑ **D-016 · commit 6 · R4 — per piece**: held work no waiting message drives any more is let
      // go. A message that names no piece drives every one, so a ledger written before commit 6 lets
      // go exactly as it did — all at once, when the queue empties with nothing sent.
      // 🔴 **D-027 · a message SENT lets go of nothing**, for work it drives or not: several go out
      // together, each ending written before the ONE turn that delivers them all, so the work the
      // first drives would be let go at the second's ending, a moment before that turn drives it.
      // ⚑ Nothing moves for a ledger written before D-027: there each `sent` is followed by its own
      // turn, and held work whose last driving message went out is that turn's.
      if (waitingToDriveIt.delete(event.messageId) && event.reason !== 'sent') {
        for (const [one, was] of [...heldForTheQueue]) {
          if (aWaitingMessageDrives(one, holdsAPersonReply(one, was))) continue
          heldForTheQueue.delete(one)
          if (open.get(one)?.row.state === 'working') {
            endedWithItOpen(
              one,
              was.cause,
              entry.at,
              was.by,
              was.stopped,
              undefined,
              was.login,
              was.aPersonWroteIt === true,
              was.since,
            )
          }
        }
      }
      const piece = byMessage.get(event.messageId)
      if (piece === undefined) continue
      if (event.reason === 'sent') {
        const held = open.get(piece)
        if (held !== undefined) {
          // 🔴 **648 · all THREE stall fields, because they are one fact written in three** —
          // `484`'s rule, stated at {@link PieceRow.stalledAt} (*"non-null exactly when
          // `stalledBecause` is"*) and held everywhere but here. ⛔ This branch cleared the cause
          // and left the moment and the actor standing, so a `working` row could carry *who
          // stopped it* from a stall it had come back from — the exact sentence `settle`'s own
          // comment forbids, in the one writer that is neither `settle` nor `stall`.
          // ⚠️ **Unreachable today and repaired anyway**: every path that stalls a piece also ends
          // its held message, so no fold has yet had a `stalled` row whose message then went out.
          const next: PieceRow = {
            ...held.row,
            state: 'working',
            stalledBecause: null,
            stalledAt: null,
            stalledBy: null,
            // ⚑ **W4.189** — its brief went out with this turn.
            briefHandedOver: true,
          }
          noteChange(held.row, next)
          rows[held.index] = next
          open.set(piece, { row: next, index: held.index })
        }
        continue
      }
      if (event.reason === 'cancelled') {
        // ⚑ **D-025 · the row names nobody**, whoever cancelled the held brief
        // ({@link PieceRow.endedBy}).
        settle(piece, 'withdrawn', entry.at, null)
        continue
      }
      // 🔴 **`abandoned` names what happened to the MESSAGE and no longer to the piece** (400,
      // HO-018 §2.3). ⛔ The app went away before this work was handed over — *"nothing about a quit
      // tells us the work failed"* — so the giver is told nothing is driving it and decides.
      stall(piece, 'message_never_sent', entry.at)
      continue
    }
    if (event.type === 'work_replied') {
      // ⛔ **`settle` is the whole rule and there is no second check.** A reply naming a piece this
      // ledger never opened, or one it has already closed, finds nothing in `open` and changes
      // nothing — which is the same sentence the rail refuses at the tool, arrived at from the
      // other side. ⚑ Both readings agree here BECAUSE the tool refuses first; if it ever stopped,
      // this fold would still not let a second reply overwrite the first.
      settle(event.piece, 'answered', entry.at, owner, {
        outcome: event.outcome,
        // ⚑ **719 · R70 — the words, as the agent wrote them** — see {@link PieceRow.summary}.
        summary: event.summary,
        ...(event.savedMethod === undefined ? {} : { savedMethod: event.savedMethod }),
        resources: event.resources,
        ...(event.resultDocument === undefined ? {} : { resultDocument: event.resultDocument }),
        needsUserAction: event.needsUserAction === true,
        // ⚑ **D-016 · and the piece's last status line, said by its owner** — see
        // {@link PieceRow.statusLine}.
        statusLine: { text: event.summary, by: owner, at: entry.at },
      })
      // ⚑ **…and once its owner has answered everything its open turn was started for, the turn
      // goes back to what an interrupt cut for it** — see {@link cutByAnInterrupt}.
      if (aTurnIsOpen && theTurnNames?.delete(event.piece) === true && theTurnNames.size === 0) {
        theTurnNames = null
        goBackToWhatTheInterruptCut()
      }
      continue
    }
    if (event.type === 'reply_undelivered') {
      // 🔴 **724 · R84 — the answer reached no conversation** ({@link PieceRow.answerReachedNobody}).
      // ⛔ **Only on a row the fold has ANSWERED**: the words are the reply's, and a row naming a
      // piece this ledger never opened, or one no reply closed, has none to carry — nor does a row
      // written before D-016, which names no piece.
      if (event.piece === undefined) continue
      const index = indexOfPiece.get(event.piece)
      const answered = index === undefined ? undefined : rows[index]
      if (index !== undefined && answered?.state === 'answered') {
        rows[index] = { ...answered, answerReachedNobody: true }
      }
      continue
    }
    if (event.type === 'work_taken_back') {
      // 🔴 **The giver took the work back** (429). ⛔ **`settle` is the whole rule, exactly as it is
      // for a reply**: a take-back naming a piece this ledger never opened, or one it has already
      // closed, finds nothing in `open` and changes nothing. ⚑ So the door's own ended-piece rails
      // and this fold agree without either checking the other, and a ledger holding two take-backs
      // of one piece derives the same row as one.
      //
      // ⚠️ **It carries none of the owner's words onto the row** — `carried` is a reply's alone. A
      // take-back is the giver speaking about its own decision; `outcome`, `summary` (719),
      // `resources` and `needsUserAction` are the owner's words about work it did, and a piece taken
      // back has none of them. ⚑ **D-025 · only who took it back** ({@link PieceRow.endedBy}).
      settle(event.piece, 'withdrawn', entry.at, event.by, null, event.actor)
      continue
    }
    if (event.type === 'work_closed') {
      // 🔴 **D-016 · the giver closed the work without a reply** — `work_taken_back`'s arm in its own
      // state. ⛔ **`settle` is the whole rule**: a close of a piece this ledger never opened, or one
      // already ended, changes nothing. ⚠️ It carries none of the owner's words onto the row, for
      // the take-back's reason: nobody replied — ⚑ only who closed it (D-025).
      settle(event.piece, 'closed', entry.at, event.by, null, event.actor)
      continue
    }
    if (
      event.type === 'work_retitled' ||
      event.type === 'work_status_set' ||
      event.type === 'work_rebriefed'
    ) {
      // 🔴 **D-016 · a line about the piece, not a transition** — the newest title, status line or
      // brief stands, open or ended. ⛔ **A piece this ledger holds no row for is passed over**, and
      // that is every line about the owner's own ROOT: a root is never a row here (R1), and the store
      // reads a root's lines off the rows themselves.
      const index = indexOfPiece.get(event.piece)
      const held = index === undefined ? undefined : rows[index]
      if (index === undefined || held === undefined) continue
      const next: PieceRow =
        event.type === 'work_retitled'
          ? { ...held, title: event.title }
          : event.type === 'work_rebriefed'
            ? {
                ...held,
                ...(event.brief === undefined
                  ? {}
                  : { brief: event.brief, statusLine: withoutTheWait(held.statusLine) }),
                ...(event.definitionOfDone === undefined
                  ? {}
                  : { definitionOfDone: event.definitionOfDone }),
              }
            : {
                ...held,
                statusLine: {
                  text: event.line,
                  by: event.by,
                  at: entry.at,
                  revision: entry.ordinal,
                  ...theWaitItMarks(event),
                },
              }
      noteChange(held, next)
      rows[index] = next
      if (open.has(event.piece)) open.set(event.piece, { row: next, index })
      // ⚑ **Its OWNER saying where it stands, while it runs, is its owner working it** — so the
      // line drives that piece. ⛔ Not its giver's line, nor a title or a new brief: none of those is
      // the owner at work.
      if (event.type === 'work_status_set' && event.by === owner && (aTurnIsOpen || driving)) {
        if (aTurnIsOpen && aPersonOpenedThisTurnFor !== null) {
          whoseWordsDroveItLast.set(event.piece, aPersonOpenedThisTurnFor(event.piece))
        }
        drivenAgain(event.piece)
        // ⚑ Driven for real now, so its drive's end judges it as any other.
        wentBackTo.delete(event.piece)
      }
      continue
    }
    if (event.type === 'work_restarted') {
      // ⚑ **D-016 · commit 6 · R4 — a drive the app went away in, before its turn's row came, drove
      // every open piece** — the read the launch named its pieces from ended there, and saw it so.
      aDriveNamedNothing()
      // ⚑ …and what a drive went back to stands as it was, as at every end of a drive
      // ({@link restoreTheEarlierStalls}): the stall the interrupt made, never `app_restarted`.
      restoreTheEarlierStalls()
      cutByAnInterrupt = new Map()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo = new Map()
      // 🔴 **The launch found work nobody had finished** (400, criterion 14). ⛔ **The pieces it
      // NAMES, and `waiting` and `working` only**: a piece already `stalled` has already told its
      // giver that nothing is driving it, and re-stating that at every launch would put a row in the
      // ledger whose only content is *the app started again*. ⚑ That guard is also the sweep's whole
      // idempotence — after this row lands, there is nothing left for the next launch to say. ⚠️ A
      // row written before D-016 names nothing, and stalls nothing. ⚑ D-016 · commit 6 · a piece a
      // person gave that waits on them is neither, so no launch names it: it stays waiting — ⚑ and
      // so does one waiting on the person who wrote (F097).
      // ⚑ A piece held for the background names what it was waiting on: after a crash nothing ended
      // the conversation in the ledger, so the work it was running is still listed here — and the
      // launch only names a piece held on a schedule when no wake-up will run it.
      const waitedOn = [...inTheBackground.values(), ...scheduled.values()]
      for (const piece of event.pieces ?? []) {
        const held = open.get(piece)
        if (held?.row.state === 'waiting' || held?.row.state === 'working') {
          stall(
            piece,
            'app_restarted',
            entry.at,
            asked,
            heldForTheBackground.has(piece) ? waitedOn : [],
          )
        }
      }
      continue
    }
    if (event.type === 'request_routed') {
      // ⛔ **No `because` is *the PARENT could have answered it*** — which is what this set is
      // for, one subject over: a question a parent could answer is one a stranding can lose.
      //
      // ⚠️ **611 · the sentence that stood here is FALSE** (HO-088 §2, standing rule 8.1). It read
      // *"the event carries `because` if and only if it carries `to: 'a-person'`, which `394` made
      // one fact seen twice"*. ⛔ **The *only if* half survives and the *if* half does not**: an
      // asker may now address a question to a person with nothing refused. ⚑ **The SET is still
      // right** — `questionLostAtRestart`'s own question is *could the parent have re-answered
      // it*, and the parent can answer an addressed question (`admitAnswer`) — so what moved is
      // the reason rather than the membership. ⚠️ Read off the EVENT here and not off
      // {@link WhereARequestWent}, because this fold has no derivation in hand.
      if (event.because === undefined) travelled.add(event.requestId)
      continue
    }
    if (event.type === 'request_stranded') {
      // 🔴 **Not a transition** (400) — see {@link noteTheLostQuestion}. The request's own fold
      // closes it `stranded`; this only reports, on the row a parent is already reading.
      noteTheLostQuestion(event.requestId)
      continue
    }
    if (event.type === 'user_decision') {
      // 🔴 **494 · the SECOND producer of an ask, and it is not a transition either.** ⛔ A
      // permission answered `cancel` ASKS the turn to stop on every door that offers it — except an
      // external-MCP elicitation card's, which since `736` (R97) asks nothing and whose row says so
      // (`stopsNothing`, passed over below; `720`'s R74 had it ask when its frame named the turn), and
      // `RuntimeHost.respondPermission` — its single writer — has recorded the caller since `477`.
      // ⚑ This fold was the missing half: the actor was in the ledger and nothing read it, which
      // is `484`'s own sentence recurring inside the reader `484` built.
      //
      // ⚠️ **`cancel` and no other outcome.** `allow`, `deny`, `answered` and `rejected` are
      // answers to a REQUEST; only this one is about the turn. ⛔ A branch that remembered them all
      // would name the person who allowed a tool as the author of whatever ended the turn next.
      //
      // ⛔ **Assigned whether or not it names anybody** — {@link whoCancelledIt}'s rule. A cancel
      // written before `477` carries no actor, and letting an earlier `work_interrupted` stand
      // would credit that person with a press they did not make, which is `491`'s defect exactly.
      if (event.stopsNothing === true) continue
      if (event.outcome === 'cancel') asked = whoCancelledIt(event.by)
      continue
    }
    if (event.type === 'work_interrupted') {
      // 🔴 **484 · remembered, never applied here** (HO-029 §2.1). ⛔ An ask is not a transition:
      // it moves no piece and stamps nothing, and the row that DOES stall the work is the `turn`
      // ending underneath it. ⚑ `397` put the actor on the neighbouring row precisely so a reader
      // joins the two rather than either one claiming the other's subject, and this fold is that
      // join performed once.
      //
      // ⚠️ **`agent` is present if and only if `by` is `an-agent`** — `WorkInterruptedEvent`'s own
      // rule — and it is cleared on every ask, so a person stopping a turn an agent already asked
      // about does not inherit the agent's name.
      asked = { by: event.by, asker: event.by === 'an-agent' ? (event.agent ?? null) : null }
      continue
    }
    if (event.type === 'turn' && event.startedBy === 'the-provider' && !aTurnIsOpen) {
      // 🔴 **F080 — the end of a turn the provider started by itself is a WAKE's end**, judged as
      // the `idle` below judges one written before F080 (with no `turn` row): only a wake that was
      // driving — and now told what the row says: a stop, a usage limit, a refused login. ⚑ So the
      // `idle` or the stop after it ends nothing more (`driving` is cleared here). ⚠️ A wake a
      // message joined (its `user_turn` opened a turn here) ends as that turn, in the arm below.
      if (driving) {
        aDriveNamedNothing()
        const heldBefore = new Set(heldForTheBackground.keys())
        const working = [...open]
          .filter(([, held]) => held.row.state === 'working')
          .map(([piece]) => piece)
        endOfDrive(
          event.state === 'interrupted',
          entry.at,
          theLimitItEndedOn(event, entry.at),
          event.state === 'failed' && event.loginRefused === true,
          event.state === 'failed' && event.onAKey === true,
          event.state === 'failed' && event.billingRefused === true,
        )
        theCutTurnDrove = new Map()
        if (asked !== null) noteWhatTheCutDrove(working, [], heldBefore)
      }
      driving = false
      // ⛔ **484 · the ask belongs to the drive it ended**, the `turn` arm's rule: an ask that
      // survived this wake would name its author as the stopper of the next one.
      asked = null
      continue
    }
    if (event.type === 'turn') {
      // ⚠️ **A snapshot, because {@link stall} writes to the map it is walking**, so the walk never
      // sees a row it has just changed. ⚑ **D-013 · the walk is {@link endOfDrive}'s**, which a
      // background wake's end asks too, and D-005a's queue and D-013's background hold it there.
      // ⚑ **D-016 · commit 6 · R4** — a drive whose turn's row never came drove every open piece.
      aDriveNamedNothing()
      // What this turn went back to, with nothing naming it since, stands as its earlier stall, and
      // what an interrupt cuts is handed to the next turn (see {@link cutByAnInterrupt}). A turn a
      // stop was asked of also cuts what it drove, however its provider ended it (Codex can say
      // `completed`), but not one that ended on a usage limit, a refused login or a billing
      // refusal: those wait for a reset, a reopen or a person paying, not for the next turn. Its
      // stall keeps the provider's word.
      const cut =
        event.state === 'interrupted' ||
        (asked !== null &&
          theLimitItEndedOn(event, entry.at) === undefined &&
          !(event.state === 'failed' && event.loginRefused === true) &&
          !(event.state === 'failed' && event.billingRefused === true))
      const wentBack = restoreTheEarlierStalls()
      const heldBefore = new Set(heldForTheBackground.keys())
      const working = cut
        ? [...open].filter(([, held]) => held.row.state === 'working').map(([piece]) => piece)
        : []
      endOfDrive(
        event.state === 'interrupted',
        entry.at,
        theLimitItEndedOn(event, entry.at),
        event.state === 'failed' && event.loginRefused === true,
        event.state === 'failed' && event.onAKey === true,
        event.state === 'failed' && event.billingRefused === true,
      )
      // ⚑ What this turn had not gone back to yet is still cut, by the same stall.
      cutByAnInterrupt = new Map(cut ? theTurnGoesBackTo : [])
      for (const piece of cut ? [...wentBack, ...working] : []) {
        const row = open.get(piece)?.row
        if (row?.state === 'stalled' && row.stalledAt !== null) {
          cutByAnInterrupt.set(piece, row.stalledAt)
        }
      }
      // ⚑ And what it was driving, for a next turn whose words asked for this stop.
      noteWhatTheCutDrove(working, cut ? wentBack : [], heldBefore)
      aTurnIsOpen = false
      aPersonOpenedThisTurnFor = null
      driving = false
      theTurnNames = null
      theTurnGoesBackTo = new Map()
      // ⛔ **484 · cleared whether or not anything used it**, and the `working` guard above is why
      // it has to be here rather than inside {@link stall}: a turn that stalled nothing has still
      // ENDED, and an ask that survived it would name the author of the next one.
      asked = null
      continue
    }
    if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      // 🔴 **D-016c · a stop is no cause of its own — it ends the drive it cut, as an interrupted
      // turn does** (`05`: an agent is never dead). ⛔ It closed every open piece until `400`
      // (HO-018 §2.3) and stalled it `conversation_ended` until D-016c; no piece reads the stop
      // itself — ⚑ only what it took away: background work a piece waited on (below).
      //
      // ⚑ **A turn it cut has already decided what it drove**: `close()` and a fatal error write the
      // open turn's own `turn` row first — and, since F080, a background WAKE's too (`startedBy`,
      // the arm above). ⚠️ **A wake in a ledger written before F080 has no such row**, and no `idle`
      // ahead of this, so a stop that cut one ends it here, `interrupted` — else its work would read
      // `working` with nothing behind it until the next start. ⛔ A stream that failed under the
      // host writes no terminal `status`, and never reaches this arm (this function's docblock).
      //
      // ⚑ **The commands it ran in the background died with it, and its schedule did not** (`253`: a
      // schedule survives a resume) — so the running level goes first, and work held on it alone
      // stalls `background_stopped`, naming those commands ({@link backgroundMoved}): never *in the
      // background* about a command that is gone, and never its turn's own cause either. ⚑ Work held for its own queue stays held: a stop hands what it held
      // on to its next start (D-017 · R3), and that message drives it.
      aDriveNamedNothing()
      // ⚑ What a drive went back to stands as it was ({@link restoreTheEarlierStalls}).
      restoreTheEarlierStalls()
      // 🔴 **…and the work held on what was RUNNING stalls on what the stop did**: its background
      // work stopped with it (`background_stopped`, naming it) — never its turn's own cause, *"its
      // turn ended with this work still open"*, which reads as the agent giving up.
      // 🔴 **F076 — a session its provider ended on a refused login**: the drive it cut failed on
      // the login ({@link theStopWasARefusedLogin}), and work whose wake never got to run stalls on
      // it too — never *its turn ended*.
      const onARefusedLogin = event.state === 'errored' && event.loginRefused === true
      theStopWasARefusedLogin = onARefusedLogin
      theStopWasOnAKey = onARefusedLogin && event.onAKey === true
      // ⚑ **The wake that never ran is the drive this stop cut**: what it would have driven, still
      // as its background's end left it, is driven again here and ends with it, on the login.
      if (onARefusedLogin) {
        for (const [piece, stalledAt] of stalledAsItsWakeWasDue) {
          const row = open.get(piece)?.row
          // ⚑ **F097** — or left waiting on the person who wrote, by that same release.
          const asItsReleaseLeftIt =
            row?.state === 'stalled'
              ? row.stalledAt === stalledAt
              : row?.state === 'waiting-on-the-person-who-wrote' &&
                waitsOnWhoWroteSince.get(piece)?.at === stalledAt
          if (!asItsReleaseLeftIt) continue
          drivenAgain(piece)
          driving = true
        }
      }
      stalledAsItsWakeWasDue.clear()
      const stoppedByTheEnd = [...inTheBackground.values()]
      inTheBackground.clear()
      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)
      theStopWasARefusedLogin = false
      theStopWasOnAKey = false
      backgroundMoved(
        entry.at,
        stoppedByTheEnd.length > 0
          ? { cause: 'background_stopped', by: null, stopped: stoppedByTheEnd }
          : null,
      )
      aTurnIsOpen = false
      driving = false
      theTurnNames = null
      cutByAnInterrupt = new Map()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo = new Map()
      // ⛔ **484 · the ask belongs to the drive it ended**, the `turn` arm's rule.
      asked = null
      continue
    }
    if (event.type === 'replaced_by') {
      // ⚑ **D-017 · R10 — it can never be reopened, and a new conversation took its place**: every
      // open piece it held stalls `could_not_be_reopened` — nothing will run it again.
      nothingWillDriveIt(entry.at)
      for (const [piece, held] of [...open]) {
        if (TASK_IS_OPEN[held.row.state]) stall(piece, 'could_not_be_reopened', entry.at)
      }
      continue
    }
    if (event.type === 'background_work') {
      // 🔴 **D-013** — the level REPLACES; an ending edge takes its one row away.
      if (event.running !== undefined) {
        inTheBackground.clear()
        for (const one of event.running) {
          inTheBackground.set(one.id, one.description ?? one.kind ?? one.id)
        }
      }
      if (event.ended !== undefined) inTheBackground.delete(event.ended.id)
      backgroundMoved(entry.at)
      continue
    }
    if (event.type === 'scheduled_work') {
      // A row that states no level (a scheduling call's receipt) moves nothing held on the level.
      if (event.jobs === undefined) continue
      scheduled.clear()
      for (const job of event.jobs) {
        scheduled.set(job.id, `a scheduled wake-up${job.schedule ? ` (${job.schedule})` : ''}`)
      }
      backgroundMoved(entry.at)
      continue
    }
    if (event.type === 'reopened') {
      stalledAsItsWakeWasDue.clear()
      restoreTheEarlierStalls()
      // ⚑ **F076 — reopened since its login was refused**, by whoever reopened it: each piece that
      // refusal stalled says so — after the stalls a drive went back to are restored, so a restored
      // one says so too — and so does one stalled later.
      reopenedSinceItsLoginWasRefused = true
      for (const [piece, held] of [...open]) {
        if (held.row.state !== 'stalled' || held.row.stoppedOnALogin === undefined) continue
        const next: PieceRow = {
          ...held.row,
          stoppedOnALogin: { ...held.row.stoppedOnALogin, reopened: true },
        }
        noteChange(held.row, next)
        rows[held.index] = next
        open.set(piece, { row: next, index: held.index })
      }
      aTurnIsOpen = false
      driving = false
      theTurnNames = null
      cutByAnInterrupt = new Map()
      theCutTurnDrove = new Map()
      theTurnGoesBackTo = new Map()
      // ⚑ **D-016 · commit 6 · R4** — a drive the last life began and never judged drives nothing
      // now.
      aDriveWaitsForItsTurn = false
    }
    if (event.type === 'status') {
      // 🔴 **D-013 · a background WAKE ends with no `turn`** (F019's second half, `P-001`): the
      // provider ran the model on its own and went idle again. ⚑ So *idle again, driving, with no
      // turn open* is the end of a drive, judged by the same {@link endOfDrive}. ⚑ **F080** — since
      // then a wake writes its own `turn` row, marked `startedBy` (the arm above), and this judges a
      // wake in a ledger written before. ⚠️ **Kept for those ledgers, and only for them**: every
      // conversation recorded before F080 holds its wakes this way and the fold reads the whole
      // ledger on every read, so without it a piece whose last drive was such a wake would read
      // `working`, with nothing behind it, until its holder's next turn.
      // ⚠️ Only `working` starts a drive, and `idle` ends one here (a stop, above): a card in the
      // middle of a wake (`waiting_permission`) is still that wake.
      if (event.state === 'idle') {
        if (driving && !aTurnIsOpen) {
          aDriveNamedNothing()
          // ⚑ A wake that was asked to stop is a cut drive, for words that asked for the stop.
          const heldBefore = new Set(heldForTheBackground.keys())
          const working = [...open]
            .filter(([, held]) => held.row.state === 'working')
            .map(([piece]) => piece)
          endOfDrive(false, entry.at)
          theCutTurnDrove = new Map()
          if (asked !== null) noteWhatTheCutDrove(working, [], heldBefore)
          // ⛔ **484** — the ask belongs to the drive it ended, as above.
          asked = null
        }
        driving = false
      }
      // 🔴 **D-005 · the turn's `status: working` drives again what its owner holds** — Claude writes
      // it before the turn's `user_turn`, and the owner's `status` is the row the stall notice is
      // decided on. ⚑ **D-016 · commit 6 · R4 — pending**: with no turn open, the turn's row is still
      // to say which piece it drives ({@link aDriveWaitsForItsTurn}).
      if (event.state === 'working') {
        if (!aTurnIsOpen) {
          aDriveWaitsForItsTurn = true
          pendingDriveAt = entry.at
          pendingDriveOrder = changeOrder
        }
        driving = true
      }
      // ⚑ **F076** — the wake came: its drive judges what it drives.
      if (event.state === 'working') stalledAsItsWakeWasDue.clear()
    }
  }

  // ⚑ **D-016 · commit 6 · R4 — a read taken between a `status: working` and its turn's row** sees
  // the work driven, as it did when that row drove every piece.
  if (aDriveWaitsForItsTurn) {
    changeAt = pendingDriveAt
    changeOrder = pendingDriveOrder
  }
  aDriveNamedNothing()

  // ⚑ **D-013 · what each held piece of work waits on in the background, as the reader sees it.**
  for (const [piece] of heldForTheBackground) {
    const held = open.get(piece)
    if (held === undefined || held.row.state !== 'working') continue
    rows[held.index] = {
      ...held.row,
      inTheBackground: [...inTheBackground.values(), ...scheduled.values()],
    }
  }

  // ⚑ **F075 — what a turn may still go back to**: cut by the last interrupt, while the turn it made
  // room for has not started, or is open and has not gone back to it — still on that same stall.
  for (const [piece, cutAt] of [...cutByAnInterrupt, ...(aTurnIsOpen ? theTurnGoesBackTo : [])]) {
    const held = open.get(piece)
    if (held?.row.state !== 'stalled' || held.row.stalledAt !== cutAt) continue
    rows[held.index] = { ...held.row, aTurnMayGoBackToIt: true }
  }

  // ⚑ **F097 — since when each piece still waiting on the person who wrote has waited** — see
  // {@link PieceRow.answeredAPersonAt}.
  for (const [piece, { at }] of waitsOnWhoWroteSince) {
    const held = open.get(piece)
    if (held?.row.state !== 'waiting-on-the-person-who-wrote') continue
    rows[held.index] = { ...held.row, answeredAPersonAt: at }
  }

  // ⚑ **A piece its status line marks as waiting reads so** ({@link theStateAsRead}): nothing
  // is owed until its wait is over, so no turn's end stalls it.
  for (const [piece, held] of open) {
    if (!readsAsWaitingOnPurpose(held.row)) continue
    rows[held.index] = asWaitingOnPurpose(held.row)
    open.set(piece, { row: rows[held.index] as PieceRow, index: held.index })
  }

  checkState(true)
  return options.trackChanges
    ? rows.map((row) => ({ ...row, lastRecordedChangeAt: changeTimes.get(row.piece)?.at ?? null }))
    : rows
}

/**
 * A piece read as waiting on purpose: what a stall or a drive left on the row is dropped, since
 * neither is what it stands on now.
 */
function asWaitingOnPurpose(row: PieceRow): PieceRow {
  const next: { -readonly [K in keyof PieceRow]: PieceRow[K] } = {
    ...row,
    state: 'waiting-on-purpose',
    parkedOver: row.state,
    stalledBecause: null,
    stalledAt: null,
    stalledBy: null,
  }
  delete next.stoppedInTheBackground
  delete next.stoppedOnALimit
  delete next.stoppedOnALogin
  delete next.aTurnMayGoBackToIt
  delete next.answeredAPersonAt
  return next
}

/**
 * Whether a piece reads as waiting on purpose: its newest status line carries the mark, and
 * what the fold sees under it is a drive's end or a wait on a person, never a piece left with nobody
 * or a stall a person must act on ({@link A_WAIT_ON_PURPOSE_OUTLASTS}).
 */
function readsAsWaitingOnPurpose(row: PieceRow): boolean {
  if (row.statusLine?.waiting !== true) return false
  if (row.state === 'stalled') {
    return row.stalledBecause !== null && A_WAIT_ON_PURPOSE_OUTLASTS[row.stalledBecause]
  }
  return (
    row.state === 'working' ||
    row.state === 'waiting-on-the-person-who-asked' ||
    row.state === 'waiting-on-the-person-who-wrote'
  )
}

/** The state a reader is shown: `waiting-on-purpose` where the mark covers what is under it. */
export function theStateAsRead(row: PieceRow): TaskState {
  return readsAsWaitingOnPurpose(row) ? 'waiting-on-purpose' : row.state
}

/** A status line with its wait on purpose taken off, or the line as it was when it marks none. */
function withoutTheWait(line: StatusLine | null): StatusLine | null {
  if (line?.waiting !== true) return line
  return { text: line.text, by: line.by, at: line.at }
}
