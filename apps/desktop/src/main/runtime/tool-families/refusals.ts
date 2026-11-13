import {
  type InterruptRefusal,
  interruptPermanenceOf,
  interruptRemedyOf,
  interruptRetryableOf,
} from '../interrupt-rails'
import {
  type MessageRefusal,
  messagePermanenceOf,
  messageRemedyOf,
  messageRetryableOf,
} from '../message-rails'
import {
  type QuestionRefusal,
  questionPermanenceOf,
  questionRemedyOf,
  questionRetryableOf,
} from '../question-rails'
import {
  type RailPermanence,
  type SpawnRefusal,
  permanenceOf,
  problemsInItsOwnWords,
  remedyOf,
  retryableOf,
} from '../spawn-rails'
import {
  type RefusalRemedy,
  type RefusalFacts,
  type ToolRefusal,
  isRailPermanence,
  isRefusalRemedy,
  refusalReason,
  refusalToldOf,
} from '../../../shared/refusals'
import {
  type ReplyRefusal,
  replyPermanenceOf,
  replyRemedyOf,
  replyRetryableOf,
} from '../reply-rails'
import { type ResourceRefusal } from '../../resources/resources'
import { THEME_TOOL_REASONS } from '../../themes/tool-words'
import { appOnlyRefusalQuote } from '../agent-tool-answer-words'

// Tool refusal vocabulary, payloads and carriers; admission remains at the host.

export type { ToolRefusal } from '../../../shared/refusals'

export const TOOL_PERMANENCE: Readonly<Record<ToolRefusal, RailPermanence>> = {
  'theme-invalid': 'while-this-holds',
  'theme-is-built-in': 'permanent',
  'theme-exists': 'while-this-holds',
  'theme-unknown': 'while-this-holds',
  'theme-too-large': 'while-this-holds',
  // **`permanent` since `424`, and the note here read *"an id that is not yours now can become
  // yours — you can spawn it"*** (HO-023 §2.1, `422` row 4). **That answers about a DIFFERENT
  // id.** A spawn mints a new `sess_<uuid4>`; it does not make the id in this call reachable, and
  // no claim or grant verb does. *"Change the call, not the world"* is precisely what
  // `list_agents` is for, and the sentence already says so.
  //
  // **D-017 · R12 — and it no longer overstates**: it is said only about an id no conversation
  // has, and nothing makes an id exist.
  'no-such-agent': 'permanent',
  // **D-017 · R12** — nothing the caller does starts it, and waiting does not either.
  'that-conversation-takes-no-messages': 'permanent',
  'that-agent-has-several-conversations': 'permanent',
  // Permanent for THIS request: the same arguments will be malformed forever.
  'malformed-request': 'permanent',
  'agent-cannot-take-a-message': 'until-a-person-changes-it',
  // **A launch in flight clears with nobody acting** (650): the provider registers and the same
  // call is admitted, or the launch fails and the reservation is abandoned, and the same call then
  // meets `no-such-agent` — at `withdraw_task` (since `657`) `not-a-piece-you-gave`, that door's
  // ended-child fold. The same permanence `INTERRUPT_RAILS` gives this word — the census
  // that lets it be shared checks that they match.
  'that-conversation-has-not-started': 'while-this-holds',
  // **Permanent: a conversation can never send itself a message.** See the rail's own note.
  'that-agent-is-you': 'permanent',
  // **A person has to throw the switch back**, which is exactly what this word is for — and it is
  // the same permanence `SPAWN_RAILS` gives the same switch.
  'spawning-disabled': 'until-a-person-changes-it',
  // **657 · an end its commander asked for, a shutdown, a sign-in or config** — somebody has to
  // decide something first (after an end, the caller itself: a new spawn is a new decision), and none
  // clears because time passes. See the word's own note. A binary was here until `716` (R67).
  'agent-did-not-start': 'until-a-person-changes-it',
  // **657 · a provider that did not answer in time** — the timed-out launch is stopped and its
  // reservation abandoned, so the same call is a fresh launch nobody has to act before.
  'agent-took-too-long-to-start': 'while-this-holds',
  // **D-016 · the start it waited on has landed, and failed** — nothing is left in flight, and the
  // identical give starts a new conversation with nobody acting first.
  'the-start-it-waited-on-did-not-happen': 'while-this-holds',
  // **707 · a machine that ran short** — the launch is abandoned (its reservation dropped; a
  // provider home it prepared stays, and the next launch reuses it), so the same call is a fresh
  // launch; what it waits on is the machine getting back what it lent out.
  'agent-could-not-start-just-now': 'while-this-holds',
  // **710 · R51 — a program this machine cannot run** stays that way until somebody puts it back,
  // makes it runnable or gives the child its folder again — the wake's mirror word's permanence.
  'agent-could-not-be-started': 'until-a-person-changes-it',
  // **A person has to widen the grant.** Nothing the caller can do changes it, and no retry helps.
  'may-not-create-agents': 'until-a-person-changes-it',
  // **Permanent: the same arguments name the same taken name forever.** Unlike its two
  // neighbours, this is a fact about the CALL rather than about the world — `malformed-request`'s
  // shape, one rail over.
  'agent-name-taken': 'permanent',
  // A person turns services on; nothing the caller can do does.
  'services-are-off-so-none-is-made': 'until-a-person-changes-it',
  // **Permanent: a name that names nothing of yours will not start naming something** (429) —
  // see the rail's own note.
  'not-a-piece-you-gave': 'permanent',
  // **Permanent: `answered` is terminal.** No person, no grant and no later state of the world
  // un-answers a piece, and `429` §3.1 forbids the one verb that might have looked like a way back.
  'that-piece-was-already-answered': 'permanent',
  // **Permanent: taken back is terminal too**, and there is no verb that reopens a piece.
  'that-piece-was-already-taken-back': 'permanent',
  // **Transient by construction — a flush ends at the next turn boundary**, and the retry lands
  // on the arm of this verb that never touches a mailbox. See the rail's own note.
  'that-work-is-being-sent': 'while-this-holds',
  'a-conversation-with-its-questions-is-starting': 'while-this-holds',
  'its-questions-could-not-all-be-read': 'while-this-holds',
  // Direct writing follows a fixed host role; a per-profile grant cannot enable it.
  'may-not-write-rules': 'permanent',
  // **`until-a-person-changes-it`, and the person could change it two ways** — by widening the
  // grant, or by answering the proposal this caller may still make. Either way the thing that
  // moves is a person, which is what this word means.
  'may-not-relay-a-rule': 'until-a-person-changes-it',
  // **628 · `permanent`, and it is `that-agent-is-you`'s row one object over.** A
  // `message_agent` naming work this caller HOLDS can never become the right call however long
  // anybody waits: the direction is wrong, not the world. *Change the call, not the world* — and
  // the call to change it to is named in the sentence.
  'that-is-work-you-hold': 'permanent',
  // **D-016** — the same row for the caller's own root.
  'that-is-your-own-work': 'permanent',
  // **663 · a stop in flight** — the same call once it has landed, `that-conversation-has-not-
  // started`'s shape on the other side of a run.
  'that-conversation-is-still-stopping': 'while-this-holds',
  // **663 · a person's to look at** — see the rail's own note for why not `permanent`.
  'that-conversation-could-not-be-resumed': 'until-a-person-changes-it',
  // **705 · R39 — `while-this-holds`, and the thing that ends it is the machine**: a descriptor,
  // a process slot or memory something else lets go of. The identical wake then succeeds with
  // nobody acting (`apps/desktop/test/a-shortage-that-clears-by-itself.test.ts`, walked to `ok`).
  'that-conversation-could-not-be-woken-just-now': 'while-this-holds',
  // **D-016 · the name, the piece's giver and whether it has ended do not change by waiting.**
  'no-piece-by-that-name': 'permanent',
  'the-giver-names-a-piece': 'permanent',
  'that-piece-has-ended': 'permanent',
  'the-giver-briefs-and-closes-a-piece': 'permanent',
  // **Permanent: closed is terminal too**, as taken back is.
  'that-piece-was-already-closed': 'permanent',
  // **D-016 · commit 6 — a conversation never gains a root.**
  'no-work-of-your-own': 'permanent',
  'work-record-unavailable': 'while-this-holds',
  // **F009 — the name is the call's**: the same name names nothing the next time either.
  'no-agent-by-that-name': 'permanent',
  'that-conversation-is-not-archived': 'permanent',
  // The archive or the delete lands by itself.
  'it-is-being-archived-or-deleted': 'while-this-holds',
  // A person has to let this app write the file it keeps the archived conversations in.
  'it-could-not-be-restored': 'until-a-person-changes-it',
  'server-already-registered': 'permanent',
  // The person deciding the waiting request, or requests, is what clears these two.
  'server-already-asked-for': 'until-a-person-changes-it',
  'too-many-server-requests': 'until-a-person-changes-it',
  // Once the piece is handed over, the same message reaches the service.
  'that-piece-is-still-queued': 'while-this-holds',
}

const TOOL_REMEDY: Readonly<Record<ToolRefusal, RefusalRemedy | null>> = {
  'theme-invalid': 'change-what-you-sent-and-call-again',
  'theme-exists': 'change-what-you-sent-and-call-again',
  'theme-unknown': 'change-what-you-sent-and-call-again',
  'theme-too-large': 'change-what-you-sent-and-call-again',
  'theme-is-built-in': null,
  'no-such-agent': null,
  'that-conversation-takes-no-messages': null,
  'that-agent-has-several-conversations': null,
  'malformed-request': null,
  'agent-cannot-take-a-message': null,
  // **650 · the arm split out of the fold above carries the word that fold never could.**
  // It clears with nobody acting, so it is retryable, and `shared/refusals.ts`' biconditional
  // — *a rail carries an act if and only if this app can retry it* — requires the act. It says
  // what to DO and never that it will work: a launch that fails meets `no-such-agent` on the retry
  // (`not-a-piece-you-gave` at `withdraw_task`, since `657`).
  // (`650` split a second arm here, the lost race; `657` made that a hold and retired its word.)
  'that-conversation-has-not-started': 'make-the-same-call-when-this-settles',
  // **424's new rail, and this line is the compile error it caused.** `425` merged `424` and
  // the build refused: *"Property 'that-agent-is-you' is missing"*. **That is the whole argument
  // for the exhaustive `Record` in one message** — a rail added by another dispatch could not reach
  // a model until somebody said what its holder may do. **Nothing**: the words were the caller's
  // own, no verb in the roster makes a session command itself, and *"change the call, not the
  // world"* is what `permanent` already tells it.
  'that-agent-is-you': null,
  'spawning-disabled': null,
  // **657 · nothing this caller can do** — the biconditional's other half.
  'agent-did-not-start': null,
  // **657 · the same call, once the stopped launch is gone** — which is this word's own
  // definition: something in flight, and the act is the same call after it has landed.
  'agent-took-too-long-to-start': 'make-the-same-call-when-this-settles',
  // **D-016 · the same call, now the start it waited on has settled** — the biconditional's
  // other half: retryable, so it carries the act.
  'the-start-it-waited-on-did-not-happen': 'make-the-same-call-when-this-settles',
  // **707 · the same call, once the shortage has cleared** — the wake's act (`705`), at this door.
  'agent-could-not-start-just-now': 'make-the-same-call-when-this-settles',
  // **710 · nothing this caller can do** — the biconditional's other half, as for the wake's mirror.
  'agent-could-not-be-started': null,
  'may-not-create-agents': null,
  'agent-name-taken': null,
  'services-are-off-so-none-is-made': null,
  // **429 · three nulls and one word, and the biconditional decided all four before this table
  // was written.** `list_tasks` composes a DIFFERENT call and that is not a remedy —
  // `reply-rails.ts` ruled it: *finding another id is not making this id succeed*.
  'not-a-piece-you-gave': null,
  // **Nothing, and `429` §4 predicted a word here.** §3.1 of the same brief refuses to withdraw
  // an answered task, and it is right — taking back work somebody already did is a different claim
  // about history. **Giving the same words as new work is a DIFFERENT call**, which is what
  // `permanent` says. See the rail.
  'that-piece-was-already-answered': null,
  // **Nothing: the caller already did this.** There is no act left on a piece it took back itself.
  'that-piece-was-already-taken-back': null,
  // **The one rail `429` adds that carries an act**, and the only one of the four that is
  // `while-this-holds`. **It is not hope**: the flush ends at the next turn boundary and the
  // retry meets the arm of this verb that never touches a mailbox.
  'that-work-is-being-sent': 'make-the-same-call-when-this-settles',
  'a-conversation-with-its-questions-is-starting': 'make-the-same-call-when-this-settles',
  'its-questions-could-not-all-be-read': 'make-the-same-call-when-this-settles',
  // **Nothing, and the biconditional decided it** — *"a rail carries an act if and only if this
  // app can retry it"*. Neither is `while-this-holds`, and the act that clears both is a person's.
  'may-not-write-rules': null,
  // **Nothing, and NOT *ask instead***. `REFUSAL_REMEDIES` names acts this app can RETRY, and
  // asking is a different call with a different outcome — `not-a-piece-you-gave`'s ruling:
  // *finding another id is not making this id succeed*. The SENTENCE tells the caller it may ask;
  // the remedy field would promise this call could be replayed, and it cannot.
  'may-not-relay-a-rule': null,
  // **663 · the biconditional's other half**: retryable, so it carries the act.
  'that-conversation-is-still-stopping': 'make-the-same-call-when-this-settles',
  'that-conversation-could-not-be-resumed': null,
  // **705 · R39 — the biconditional's other half, as `that-conversation-is-still-stopping`'s**:
  // retryable, so it carries the act, and the act is the same call once the shortage has passed.
  'that-conversation-could-not-be-woken-just-now': 'make-the-same-call-when-this-settles',
  // **D-016 · not retryable, so none carries an act** — the biconditional; each sentence names
  // the call that is right instead.
  'no-piece-by-that-name': null,
  'the-giver-names-a-piece': null,
  'that-piece-has-ended': null,
  'the-giver-briefs-and-closes-a-piece': null,
  // **Nothing: the caller already did this**, as for a piece it took back itself.
  'that-piece-was-already-closed': null,
  // **D-016 · commit 6 · not retryable, so it carries no act** — the biconditional; the sentence
  // says what to do instead.
  'no-work-of-your-own': null,
  'work-record-unavailable': 'make-the-same-call-when-this-settles',
  // **F009 · permanent, so no act** — the sentence names the door that lists every agent.
  'no-agent-by-that-name': null,
  'that-conversation-is-not-archived': null,
  'it-is-being-archived-or-deleted': 'make-the-same-call-when-this-settles',
  'it-could-not-be-restored': null,
  // Not retryable, so no act: the sentences say what to do instead.
  'server-already-registered': null,
  'server-already-asked-for': null,
  'too-many-server-requests': null,
  'that-is-work-you-hold': null,
  // **D-016 · null, for the same reason** — permanent; the act is in the sentence.
  'that-is-your-own-work': null,
  'that-piece-is-still-queued': 'make-the-same-call-when-this-settles',
}

/** **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function toolRemedyOf(rail: ToolRefusal): RefusalRemedy | null {
  return TOOL_REMEDY[rail]
}

export type PublishedRefusal = {
  readonly outcome: 'refused'
  readonly rail: string
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string

  readonly remedy: RefusalRemedy | null
  /**
   * **`object`, and the looseness is a TypeScript fact rather than a design one.** Each door
   * declares its own `…RefusalDetail` as an INTERFACE, and an interface has no implicit index
   * signature — so `Readonly<Record<string, unknown>>` here would reject the door-specific detail
   * interfaces. Nothing
   * in this app reads a detail structurally: it is carried to the model verbatim, and `405` §2 keeps
   * it off the ledger row entirely.
   */
  readonly detail: object
}

/** A refusal in `341`'s shape, from this file's vocabulary. */
export interface ToolRefusalPayload {
  readonly outcome: 'refused'
  readonly rail: ToolRefusal
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** **425 · the act left, as a word** — see {@link PublishedRefusal.remedy}. */
  readonly remedy: RefusalRemedy | null
  readonly detail: Readonly<Record<string, unknown>>
}

export const TOOL_SENTENCES: Readonly<Record<ToolRefusal, string>> = {
  ...THEME_TOOL_REASONS,
  'no-such-agent':
    'no conversation available to this call goes by that id or piece label, so nothing was done. list_agents names the conversations this app can run; list_profiles names every agent this app holds.',
  // **D-017 · R12** — the act first, inside the cut; then which kinds of conversation this is.
  // The detail carries every label; the refusal sentence names up to five.
  'that-agent-has-several-conversations':
    'make the same call with agent set to one of that agent\u2019s conversations, by a label the detail lists. It has more than one you can reach, so nothing was done.',
  'that-conversation-takes-no-messages':
    'that conversation cannot be started by a message, so nothing was sent to it; list_agents names the conversations this app can run. It is a read-only copy, a provider\u2019s own sub-agent, or a conversation this app did not start.',
  'malformed-request':
    'the arguments did not match what this tool accepts, so nothing was done. The problems are listed in the detail: fix each one and call this tool again.',
  // **It says who can change it, because nothing the caller does will** (424). The old sentence
  // stopped at the state and carried `retryable: true`, which read as *come back in a minute*.
  'agent-cannot-take-a-message':
    'ask a person to inspect why that conversation cannot take a message; do what you can here. Nothing was queued, and retrying will not help until its state changes.',
  // **650 · a launch in flight.** Its own sentence and not `INTERRUPT_RAILS'`: that one says
  // *nothing running to interrupt*, which is about the other door's act. It says both ways the
  // wait can end, because the retry after a launch that fails meets `no-such-agent` (at
  // `withdraw_task`, `not-a-piece-you-gave`; at `update_work`, `no-piece-by-that-name`).
  // **657 · and it is said at THREE doors of this vocabulary now** — `message_agent`,
  // `withdraw_task` and, since D-016, `update_work`'s close — so its first clause names what was
  // refused of none of them: it said *nothing was sent or queued*, which is a message's fact, and a
  // withdrawal or a close is not a message.
  'that-conversation-has-not-started':
    'that conversation has not started yet, so nothing was done to it. It comes up or fails to launch on its own: make the same call again in a moment.',
  // **It names the mistake rather than the state** (424). A caller that addressed itself was
  // told its target was busy, which is the one thing it was not.
  'that-agent-is-you':
    'that is this conversation: a conversation cannot send itself a message, so nothing was queued. Whatever you meant to send, do it yourself — or send it to another agent.',
  // **The sentence carries what the switch's own label does not.** A person turned agent
  // creation off by switching off agents starting new conversations, and a refusal that said only
  // *no* would leave a model retrying a rule only a person can change. It says nothing was
  // created, because the one thing a caller must not have to guess is whether a durable row exists
  // now. D-016 · ruling 12's words for the switch (spec D30).
  'spawning-disabled':
    'creating agents is off: a person has switched off agents starting new conversations. Nothing was created, and no retry will pass until they switch it back on.',
  // **657 · it says no RULE refused it**, because the row a person reads says *refused* — and a
  // launch that failed is not a policy. Short enough to reach a person whole (the 200 cut).
  // **True on every arm, which its first draft was not**: it said *a person has to change that
  // first*, and the arm `657`'s own test ran was a parent ending its own starting child — nobody else
  // was involved, and the same call then starts (review of `657`). **D-017** — *ended* went with
  // `end_agent`. What stops a launch in flight is a person's Close of it in this app (`cancelled`)
  // or this app quitting (`shutting-down`), and *somebody stopped it first* is true of both.
  'agent-did-not-start':
    'ask a person to read the detail and decide whether to start that conversation again. It did not start, no rule refused it, and nothing was sent: somebody stopped it first or a person must fix something.',
  'agent-took-too-long-to-start':
    'that agent\u2019s conversation did not answer in time and was stopped before it started, so nothing was sent. Nobody has to act: make the same call again.',
  // **D-016 · the act first, inside the cut.** Why the start failed is not this call's to say:
  // the call that was starting it met that failure and answers it.
  'the-start-it-waited-on-did-not-happen':
    'your conversation with that agent was still starting and never came up, so nothing was given. Give it again: that starts a new one.',
  // **707 · R39, extended — the act first, inside the 200-character receipt**
  // (`the-act-inside-the-cut`), and the reason after it: the wake's sentence (`705`), at this door.
  'agent-could-not-start-just-now':
    'that agent\u2019s conversation could not be started just now, so nothing was sent. Make the same call again in a moment: its provider could not be started because this machine ran short of open files, processes or memory, which usually clears by itself.',
  // **710 · R51 — the act first, inside the 200-character receipt** (`the-act-inside-the-cut`),
  // then what is wrong in words — the wake's permanent sentence (`that-conversation-could-not-be-resumed`),
  // at this door. It says *may*: Node names the program for a missing folder too.
  'agent-could-not-be-started':
    'that agent\u2019s conversation could not be started, so nothing was sent. Starting it again will not help until a person has looked: this machine could not run its provider\u2019s program \u2014 it may be missing or not runnable, or the folder it runs in may be gone. The detail names the error.',
  'may-not-create-agents':
    'ask a person to grant agent creation. You do not have that right, so nothing was created; repeating this call will not grant it.',
  // **It teaches the remedy, which is a different name** — and it says the comparison ignores
  // case, because a model that tried the same name capitalised differently would meet this twice.
  'agent-name-taken':
    'there is already an agent with that name, so nothing was created. Names are compared without case. Choose a different name, or use the agent that exists.',
  'services-are-off-so-none-is-made':
    'Not created: services are off. A person turns them on in Team.',
  // **It names where the right label is and promises nothing about this one** — the split
  // `reply-rails.ts` made between a sentence that helps and a field that promises. **Two doors
  // say it and only one names an agent** — `message_agent`'s follow-up, not `withdraw_task` — so
  // the agent clause is said as the condition it is.
  'not-a-piece-you-gave':
    'that is not a piece you gave (or, when the call names an agent, not one you gave that agent), so nothing was done. list_tasks lists the open pieces you gave out, and with state: "all" the ended ones too; the name may belong to another conversation, or to nothing at all.',
  // **HO-023 §5's second clause is in the DETAIL and the sentence points at it.** The label, the
  // outcome and the resources are facts about work that exists; a sentence that merely said *no*
  // would leave a giver re-sending blind, which is the measurement this rail came from.
  'that-piece-was-already-answered':
    'that piece was already answered, so there was nothing to take back and nothing was done. Read the reply first; for genuinely new work, give it with give_work. Its label, the outcome the agent gave and the resources its reply handed in, if any, are in the detail.',
  // **It says the caller did this**, because the alternative sentence — *that piece is finished* —
  // would send a giver looking for a reply nobody wrote.
  'that-piece-was-already-taken-back':
    'you have already taken that piece back, so there was nothing left to take back and nothing was done. No further action on this piece is owed.',
  // **D-016 · said at `withdraw_task` and at `update_work`'s close**, so it names both acts.
  'that-work-is-being-sent':
    'the message carrying that work is being sent right now, so nothing was done: make this call again once it has gone. Work cannot be taken back or closed while that message is mid-flight.',
  // Said with the piece's label at each door (`aPieceNotEndedWhileAQuestionStarts`).
  'a-conversation-with-its-questions-is-starting':
    "that piece wasn't taken back or closed: a conversation with a question about it is still starting. Try again in a moment.",
  // Said with the piece's label at each door (`aPieceNotEndedItsQuestionsUnread`).
  'its-questions-could-not-all-be-read':
    "that piece wasn't taken back or closed: its question records could not be read. Check that record, then retry this call.",
  // Grants do not select the app's direct writer.
  'may-not-write-rules':
    'Only BroBot writes other agents’ standing rules directly. You can propose a change with propose_agent_rules, and the person decides. Nothing was written.',
  // **It tells the caller what it MAY do**, because the narrower grant it holds is a real answer
  // rather than a consolation: the proposal arm is open to it and a person will decide.
  'may-not-relay-a-rule':
    'you may ask for these rules but not write them, so nothing was written and nobody asked. Ask again without claiming it was already agreed, and a person will decide: relaying a rule on somebody’s behalf is a separate grant you do not hold.',
  'that-is-work-you-hold':
    'that is a piece you are HOLDING, so nothing was sent. To ask about it, call ask_question naming that piece; to hand it back finished, call reply_to_parent. A follow-up is about a piece you gave to somebody else; with ask_question the work stays yours and stays open, and reply_to_parent ends it.',
  // **D-016 · the act first, inside the cut** — and it names no verb that refuses a root. Said
  // at `message_agent` and at `update_work`, so it says *nothing was done*, true at both, and names
  // the acts of both doors and no other (D-023 · R2).
  'that-is-your-own-work':
    'that is this conversation\u2019s own work, from a person, so nothing was done: ask a person with ask_question naming it, and answer the person here when it is done. Follow-ups, new briefs and closing are for pieces one conversation gives another.',
  // **663 · it gives the reason as the rule, not as the state**: a model told only *not yet* would
  // reasonably try another way in, and there is none that is safe.
  'that-conversation-is-still-stopping':
    'that conversation has not been confirmed stopped since its last run, so it was not started and nothing was sent. Make the same call again in a moment: two runs of one conversation must never overlap.',
  'that-conversation-could-not-be-resumed':
    'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: its provider may need signing in again, or could not be started.',
  // **705 · R39 — the act first, inside the 200-character receipt** (`the-act-inside-the-cut`), and
  // the reason after it. *usually*, because a machine that stays short keeps refusing — the
  // sentence says what to do and never that it will work.
  'that-conversation-could-not-be-woken-just-now':
    'that conversation could not be started just now, so nothing was sent. Make the same call again in a moment: its provider could not be started because this machine ran short of open files, processes or memory, which usually clears by itself.',
  // **D-016 · the act first, inside the cut** — where the right label is.
  'no-piece-by-that-name':
    'no piece by that name is available to this call, so nothing was done. Check its label or id with search_work or list_tasks.',
  // **D-016 · it says what the caller MAY do**: the status line is its, and the name is its giver's.
  'the-giver-names-a-piece':
    'the one that gave you that piece names it, so its title was not changed. To have it called something else, ask it; you may set its status line.',
  // **D-016 · said about a status line, a new brief, a close and kept files**, so it says nothing
  // was changed, which is true of each. **F059** — `update_work` says which ending, when and by
  // whom ({@link anEndedPieceSaid}); this sentence is its fallback for a state that function does
  // not name, which no ended piece reaches today.
  'that-piece-has-ended':
    'that piece has ended — answered, closed or taken back — so nothing was changed: its last word stands. Only its title may still be changed.',
  // **D-016 · the act first, inside the cut** — then what the owner may do instead. **Commit 6
  // · true of both kinds of piece**: a person's piece has no giver's conversation to brief or
  // close it, and no door for the person either.
  'the-giver-briefs-and-closes-a-piece':
    'only a conversation that gave a piece gives it a new brief or closes it, so nothing was changed. Ask with ask_question to change or stop the work; you may set its status line, keep files you made for it, or hand it back with reply_to_parent.',
  // **It says the caller did this**, as `that-piece-was-already-taken-back` does.
  'that-piece-was-already-closed':
    'you have already closed that piece, so there was nothing left to take back and nothing was done. No further action on this piece is owed.',
  // A personal request must belong to the admitted, recorded turn.
  'work-record-unavailable': 'Your current work could not be read. Try again in a moment.',
  'no-work-of-your-own':
    'This is not a recorded person request. Use give_work for an agent’s work.',
  // **F009 · the act first, inside the cut** — spell a name the roster holds.
  'no-agent-by-that-name':
    'name an agent by the profile list_profiles gives it: no agent has that profile, so there is no record to read. list_profiles without profile names every agent.',
  'that-conversation-is-not-archived':
    'that conversation is not archived, nor is any below it, so nothing was restored. list_agents with archived: true names the archived ones you can reach.',
  'it-is-being-archived-or-deleted':
    'that conversation is being archived or deleted right now, so nothing was restored. Call this tool again once that is done; a deleted one is then gone.',
  'it-could-not-be-restored':
    'this app could not change its list of archived conversations, so nothing was restored. Tell the person: the detail says what they need to do.',
  // The general forms; `request_mcp_server` says each with the name and numbers it met.
  'server-already-registered':
    'ask the person with ask_question (a-person) to grant it to your profile if you need that server: one by that name or at that address is already registered, and a request cannot change a registered server, so nothing was asked.',
  'server-already-asked-for':
    'wait for the person to decide the request already waiting for a server by that name, so nothing new was asked. The conversation that made it is told when they decide.',
  'too-many-server-requests':
    'wait until one is decided: as many server requests as may wait are already waiting on the person, so nothing was asked.',
  // Said with the piece's label in place of “that piece” ({@link aMessageAboutAQueuedPiece}).
  'that-piece-is-still-queued':
    'Not sent: that piece is still queued. Change its brief with update_work.',
}

/**
 * **Derived, never written twice** — `retryable` comes from `permanence` through one table, so
 * the two cannot disagree. `341`'s rule, and the reason it is a function rather than a field.
 */
export function refuseTool(
  rail: ToolRefusal,
  detail: Readonly<Record<string, unknown>> = {},
): ToolRefusalPayload {
  const permanence = TOOL_PERMANENCE[rail]
  return {
    outcome: 'refused',
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(TOOL_SENTENCES[rail]),
    remedy: toolRemedyOf(rail),
    detail,
  }
}

/** A spawn rail's refusal, carried over MCP **unchanged** — see the module note. */
export function carryRailRefusal(refusal: SpawnRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    // **Re-derived from the rail rather than copied off the payload**, so a refusal that somehow
    // arrived with a permanence its rail does not have is corrected here rather than published.
    permanence: permanenceOf(refusal.rail),
    retryable: retryableOf(refusal.rail),
    reason: refusal.reason,
    // **425 · re-derived from the rail for the permanence's reason one line up.** A payload that
    // arrived promising an act its rail does not offer is corrected here rather than published.
    remedy: remedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * A messaging rail's refusal, carried over MCP **unchanged** — the same treatment, one door over.
 *
 * **Re-derived through `message-rails.ts`'s own table**, for `carryRailRefusal`'s reason: the
 * payload states the permanence, and a payload is a thing that can be built wrong.
 */
export function carryMessageRefusal(refusal: MessageRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: messagePermanenceOf(refusal.rail),
    retryable: messageRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: messageRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * **Carry reply and resource refusals over MCP** — `carryRailRefusal`'s shape.
 *
 * **Permanence is RE-DERIVED from the rail rather than copied off the incoming payload**, which
 * is what the remaining carriers do and for their reason: a payload that arrived with the fields
 * disagreeing would be carried out disagreeing. **A `ResourceRefusal` already carries `outcome`
 * and is already `341`-shaped**, so it is spread unchanged — `read_document`'s handling, and its
 * sentences were written for this caller.
 */
export function carryReplyRefusal(refusal: ReplyRefusal | ResourceRefusal): PublishedRefusal {
  if ('outcome' in refusal) return { ...refusal }
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: replyPermanenceOf(refusal.rail),
    retryable: replyRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: replyRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * **Carry an interrupt refusal over MCP** — `carryRailRefusal`'s shape for `INTERRUPT_RAILS`.
 *
 * **Permanence is RE-DERIVED from the rail rather than copied off the incoming payload**, which
 * every other carrier in this file does and for their reason: a payload that arrived with the two
 * disagreeing would be carried out disagreeing.
 */
export function carryInterruptRefusal(refusal: InterruptRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: interruptPermanenceOf(refusal.rail),
    retryable: interruptRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: interruptRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

export function carryQuestionRefusal(refusal: QuestionRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: questionPermanenceOf(refusal.rail),
    retryable: questionRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: questionRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * **The refusal facts, or `null` because this answer is not a refusal at all** (405).
 *
 * **`outcome` is the discriminant and it is the only one that may answer quietly.** An `ok`
 * payload is the overwhelmingly common case and there is nothing to say about it.
 *
 * **A payload that SAYS refused and cannot be read is a defect, and it is reported as one.** It
 * cannot be published as a partial row: a refusal drawn with a blank rail tells a person a rule
 * stopped their agent and refuses to say which, which is worse than the silence `402` F2 measured
 * because it looks like an answer. It cannot be silently dropped either — that is the same bug in
 * a quieter costume — so it goes to the log with the tool that produced it.
 */
export function refusalIn(
  tool: string,
  structured: Readonly<Record<string, unknown>> | undefined,
  text?: string,
): RefusalFacts | null {
  const facts = thePolicyFactsIn(tool, structured)
  if (facts === null) return null
  // Detail stays in the model's answer; the ledger adds only the reviewed app-only clauses, and a
  // request's problems when they are all this app's words.
  const told = appOnlyRefusalQuote(structured, text, problemsInItsOwnWords(structured?.['detail']))
  return typeof told === 'string' && told !== '' ? { ...facts, told: refusalToldOf(told) } : facts
}

/** The policy facts of {@link refusalIn}, read back out of the payload — its note says how. */
function thePolicyFactsIn(
  tool: string,
  structured: Readonly<Record<string, unknown>> | undefined,
): RefusalFacts | null {
  if (structured === undefined || structured['outcome'] !== 'refused') return null
  const rail = structured['rail']
  const permanence = structured['permanence']
  const retryable = structured['retryable']
  // **425 · a remedy this build does not recognise is NOT a reason to drop the row.** Unlike the
  // the required fields above it, the absence of an act is the ORDINARY answer — most rails have
  // none — so an unreadable one reads as *none* rather than as a defect, and
  // the row still says which rule stopped the call. Nothing in this build can produce one: every
  // payload comes from `refuseTool` or a carrier, and every producer re-derives it from a typed table.
  const remedy = structured['remedy']
  const said = isRefusalRemedy(remedy) ? remedy : null
  if (typeof rail === 'string' && rail.length > 0 && isRailPermanence(permanence)) {
    if (typeof retryable === 'boolean') return { rail, permanence, retryable, remedy: said }
  }
  console.warn(
    `${tool} refused a call with a payload this app cannot record: ` +
      `rail=${typeof rail} permanence=${String(permanence)} retryable=${typeof retryable}`,
  )
  return null
}
