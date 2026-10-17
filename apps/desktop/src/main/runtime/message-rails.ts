import { refusalReason } from '../../shared/refusals'
import type { ProfileCapabilities } from '../db/session-store'
import type { MessagingReach } from '../../shared/capabilities'
// ⛔ **`RailPermanence` is IMPORTED and not restated, which makes the shared closed vocabulary a
// compile-time fact rather than a sentence.** `341` fixed the payload shape at the spawn door
// *"precisely so this dispatch would not reinvent it"*, and `agent-tools.ts` publishes both
// grammars to one model through one set of tools. A new permanence added over there is a type
// error here on the day it lands.
import type { RailPermanence } from './spawn-rails'
// ⚑ **425 · from `shared/refusals.ts` and not through `spawn-rails.ts`'s re-export.** That
// re-export exists so `405` could move `RailPermanence` without touching seven readers; a word
// added today has no such history and names its own home.
import type { RefusalRemedy } from '../../shared/refusals'

/**
 * 🔴 **374 · the rails a message passes** — P3, the last rail dispatch of Slice 4.
 *
 * ## ⛔ Why this is its own vocabulary rather than more `SPAWN_RAILS`
 *
 * `341`'s list has a census over it: *"every rail in the vocabulary is REACHED by the door"*, which
 * greps `spawn-rails.ts` for `no('<rail>'`. A rail about an existing conversation could never
 * satisfy it, because the door it is refused at is not `admitGive`. ⚑ `agent-tools.ts` already
 * states the rule for its own vocabulary: *"folding them into `SPAWN_RAILS` would put words in
 * a list whose census asserts every member is demonstrated by a give's refusal. What they SHARE is
 * the shape and the permanence vocabulary, so a model meets one grammar everywhere."* This is that
 * argument applied at this door, and the shape is deliberately identical.
 *
 * ## 🔴 What these rails ask, and what they deliberately do NOT ask
 *
 * ⛔ **A capability here can only ever NARROW the entitlement in front of it; it can never widen
 * it.** What is left to decide is *which of the conversations I may reach may I do THIS to*, and
 * that is what `can_message` and `can_assign_work` answer.
 *
 * ⚠️ **The entitlement differs per act.** `send` and `queueMessage` ask
 * `RuntimeHost.requireToMessage`, which admits everything `mayCommand` admits **and** a
 * conversation the caller did not start when the grant reaches that far — see
 * {@link reachesWhatItDidNotStart}. ⛔ **So for `message` the caller has NOT necessarily been shown
 * to command the target**, which is why no sentence here says anything about the target. ⚑
 * `assign` has no target at all (D-016): `give_work` asks it of the caller alone, before it looks
 * up the one conversation the work goes to — the giver's own with that agent, so work flows down by
 * construction and no rail here needs to say so.
 *
 * ⚠️ **`any` reaches past what its holder started** (`431`): `430` measured that a grant which
 * reached only what its holder started left criterion 6 unreachable, because a conversation a
 * PERSON opened is neither the caller's own nor its commander's. ⚑ It is asked at FOUR doors (`433`)
 * — `message_agent`, `list_agents`, `get_agent_status` and `ask_question` for an agent it names
 * (`withdraw_task` asked it too until D-016, when it came to take a piece and name no agent) —
 * because a capability a model cannot discover is a capability it will not use. ⛔ **It is still not
 * a key to the app**: work goes only to the giver's own conversation with an agent, whatever its
 * reach — `give_work` names an agent, never a conversation.
 *
 * ## ⚑ Two fields, two gates
 *
 * `can_message` gates sending and seeing; `can_assign_work` gates giving work — HO-060 §2: *"anyone
 * may ask anyone; assigning work requires a relationship."* ⛔ **The fields hold the same closed
 * vocabulary and that is a shape, not a derivation**: an identity granted one and refused the other
 * is a state a person can configure.
 *
 * ## ⛔ Interrupting is not here
 *
 * ⚑ No grant gates it. `RuntimeHost.interruptAgent` admits a caller that commands the target or
 * sits above it in the chain that created it, and answers everyone else `not-below-you` (D-017:
 * `no-such-agent` only for an id no conversation has). The states that stop it are
 * `INTERRUPT_RAILS`'.
 *
 * ## 🔴 Every one of these rails is reachable from a wire
 *
 * ⛔ **No count is restated here, deliberately**: a sentence that counts goes stale the next time
 * the list moves. `a-task-you-can-see.test.ts` §1 asserts that surface's members BY NAME and is the
 * thing to read.
 *
 * ## ⚠️ A person never reaches this file
 *
 * HO-007 §2.1: *"the human unrestricted."* The gate asks `sessionSpeakingAs` first, and a
 * window sink and `THE_APP_ITSELF` both decode to `null` — there is no identity to look a
 * capability up for, because a person is not one. ⛔ **That is an absence of a question rather than
 * an exemption**, so there is no clause anywhere that a later widening could make say `true`.
 */

/**
 * The rails, as a closed vocabulary — `session-unavailable.ts`'s rule, `341`'s shape.
 *
 * 🔴 **They are per ACT rather than per CAPABILITY**, because a sentence is about the call that met
 * it: *"nothing was delivered"* and *"nothing was given"* are different facts about different
 * calls.
 */
export const MESSAGE_RAILS = [
  /**
   * ⛔ **This identity may send to nothing.** THREE causes reach it, and only two of them are about
   * a value: a person set `can_message` to `none`; the column holds something this app cannot read
   * (`parseChoice` folds an unknown word to the narrowest value, never to the default); or **there
   * was no identity to read a grant from at all** — a conversation with no `agent_identity_id`, which
   * `identityOf` documents as the one swept out of the user's own home.
   *
   * ⚠️ **The payload tells the first two apart from the third**: `detail.reach` is present only when
   * a grant was actually read. ⛔ There is deliberately no separate rail for the missing-identity
   * cause — it is the same refusal with the same remedy (a person), and `341`'s `unknown-profile`
   * is a rail because there the absence is the whole finding, which here it is not.
   */
  'may-not-message',
  /**
   * ⛔ **This identity may give work to nothing** — `can_assign_work` is `none` (553, HO-060 §2).
   *
   * ⚑ **Not a narrower {@link 'may-not-message'}, and the sentences say so.** A caller that meets
   * this one CAN still speak to agents: HO-060 §2.1 keeps the question arm fully open, so the
   * refusal has to say what was refused — the work — and name the act that is still available.
   * ⛔ A sentence that read *you are not allowed to send anything* would be false of the caller
   * standing in front of it.
   *
   * ⚠️ **The same three causes as {@link 'may-not-message'}**, and `detail.reach` tells the first
   * two from the third here for the same reason it does there.
   */
  'may-not-assign-work',
] as const

export type MessageRail = (typeof MESSAGE_RAILS)[number]

/**
 * ⛔ **One table, so `permanence` and `retryable` cannot disagree** — `341`'s rule, and the shared
 * closed vocabulary, so a model that learned the grammar at `give_work`'s door reads this one too.
 *
 * ⚑ **The `may-not-` rails are `until-a-person-changes-it`** (`486`, HO-031 §2.5: *a permanence
 * that describes the wrong thing is a promise about the world that is false*): each is refused by a
 * GRANT VALUE on one column on one sheet, and the moment a person widens it the IDENTICAL call
 * succeeds.
 */
const PERMANENCE: Readonly<Record<MessageRail, RailPermanence>> = {
  'may-not-message': 'until-a-person-changes-it',
  // ⚑ **553 · for the table's own argument above rather than by inheriting a constant.**
  // ⛔ `can_assign_work` is one column on one sheet: a person who widens it makes the IDENTICAL
  // call succeed, which is what `until-a-person-changes-it` says and what `permanent` would deny.
  'may-not-assign-work': 'until-a-person-changes-it',
}

export function messagePermanenceOf(rail: MessageRail): RailPermanence {
  return PERMANENCE[rail]
}

/**
 * **Would the identical call ever succeed on its own?**
 *
 * ⛔ **Only `while-this-holds` is retryable**, and no rail here has it: a capability nobody has
 * granted does not grant itself. ⚠️ **Written as
 * the same derivation `give_work`'s door uses rather than as `false`** — a new rail with a different
 * permanence would then answer for itself instead of inheriting a constant somebody typed.
 */
export function messageRetryableOf(rail: MessageRail): boolean {
  return messagePermanenceOf(rail) === 'while-this-holds'
}

/**
 * 🔴 **425 · what the caller may do instead — and for every rail here, nothing** (HO-023 §2.2).
 *
 * ⛔ **Not one rail here is `while-this-holds`**, so not one of them is a *busy* refusal with an act
 * waiting on the other side of it. ⚑ Both rows are capabilities a person has not granted, and
 * neither ends by an act this caller can perform.
 *
 * ⚠️ **The table is exhaustive anyway, and that is its whole job here.** A new rail — a
 * messaging state that really is transient — would fail to compile until somebody said what its
 * holder may do, which is exactly the decision `405` had no place to record.
 */
const REMEDY: Readonly<Record<MessageRail, RefusalRemedy | null>> = {
  'may-not-message': null,
  // 🔴 **553 · `null`, and these are the rows where a remedy was tempting.** ⛔ *Ask it instead*
  // is a real act and it is genuinely open to this caller — HO-060 §2.1 keeps the question arm
  // open — **but a `RefusalRemedy` is a word from a closed vocabulary meaning *the thing you were
  // trying to do is waiting on something*, and asking is a DIFFERENT act with a different
  // outcome.** ⚑ Offering it as a remedy would tell a caller its work is on its way when nothing
  // was given. ⚠️ The sentence says a note or a question is available; the remedy field does not
  // claim it is the same request retried.
  'may-not-assign-work': null,
}

/** ⛔ **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function messageRemedyOf(rail: MessageRail): RefusalRemedy | null {
  return REMEDY[rail]
}

/**
 * The facts a messaging refusal may state beyond the rail itself, carried as DATA (`341`, 100).
 *
 * ⛔ **Nothing in this shape names anything about the TARGET.** A refusal that volunteered a fact
 * about the conversation it refused would turn the one gate that says *"not yours to reach"* into a
 * reader; 086's rule is that a refusal names the path back because the model CHOSE it, and the
 * caller chose an agent id and nothing else. `374`'s `M12` is the row that keeps that true, and
 * `the-rails-a-message-passes.test.ts` §4 presses it.
 */
export interface MessageRefusalDetail {
  /**
   * ⛔ **The reach the caller's identity was granted — present ONLY when a grant was actually read.**
   *
   * ⚠️ **Absent when there was no identity to read one from**, which is a different fact from *a
   * person set `none`* and must not be reported as one. An agent whose conversation has no identity
   * reaches the same rail; telling it `reach: 'none'` would have it report a column value to a
   * person who would then open the sheet and see something else. 340's finding — *a reason
   * answering with another reason's sentence* — in a payload field.
   *
   */
  reach?: MessagingReach
  /** The conversation this call named, echoed back so a model can match refusal to request. */
  agent?: string
}

/**
 * 🔴 **A refusal, as a payload rather than a throw** — `341`'s shape, carried over MCP unchanged.
 */
export interface MessageRefusal {
  readonly rail: MessageRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** ⛔ **425 · the act left, as a word** — one of `REFUSAL_REMEDIES`, or `null`. All of them are. */
  readonly remedy: RefusalRemedy | null
  readonly detail: MessageRefusalDetail
}

/**
 * The sentence for each rail. **No session id, no internal state name, and no capability spelling.**
 *
 * ⚠️ **A refusal INSTRUCTS or STATES A FACT ABOUT THIS CALL; it does not describe how the system
 * works** (HO-015 §2, standing). None of these says what `can_message` is, what values it takes, or
 * where a person sets it — a sentence that describes a capability drifts every time the capability
 * changes. What each one says is what happened to THIS call and what would make it succeed.
 *
 * ⛔ **It takes NO detail**: none of the sentences needs a fact from the payload, which carries its
 * facts in {@link MessageRefusalDetail}, where a caller reads them off a field rather than matching
 * them out of prose (`100`'s split).
 *
 * ⚑ **A message is a note or a follow-up, a question is `ask_question`** (since D-010), and work is
 * `give_work` (D-016) — so no sentence here says *"as a question"*.
 */
export function describeMessageRail(rail: MessageRail): string {
  switch (rail) {
    case 'may-not-message':
      return (
        'You are not allowed to send to another conversation, so nothing was delivered. A ' +
        'person decides that and it cannot be widened from here: ask one, or do the work ' +
        'yourself.'
      )
    // ⛔ **A refusal reason is FACTORY TEXT** — HO-037 §4: *the app AUTHORS it, SHIPS it with the
    // release, and an AGENT READS it* — ⚠️ **so it may say only what this build does.**
    case 'may-not-assign-work':
      return (
        'You may not give work, so nothing was given. Send it as a note, ask with ask_question, ' +
        'or do the work yourself: a person decides that, and it cannot be widened from here.'
      )
  }
}

/**
 * ⚑ **Is this refusal one of this vocabulary's?** — for a door that answers in two: `give_work`
 * answers `may-not-assign-work` from here and every other rail from `SPAWN_RAILS`.
 */
export function isAMessageRefusal(refusal: { readonly rail: string }): refusal is MessageRefusal {
  return (MESSAGE_RAILS as readonly string[]).includes(refusal.rail)
}

/** Build the whole payload from the rail and its facts, so its policy fields cannot drift apart. */
export function refuseMessage(
  rail: MessageRail,
  detail: MessageRefusalDetail = {},
): MessageRefusal {
  return {
    rail,
    permanence: messagePermanenceOf(rail),
    retryable: messageRetryableOf(rail),
    reason: refusalReason(describeMessageRail(rail)),
    remedy: messageRemedyOf(rail),
    detail,
  }
}

/**
 * 🔴 **Which act is being asked for** — each named here because there is a gate per verb:
 * `message` at every door that delivers words, `assign` at `give_work` (D-016).
 *
 * ⛔ **Ending and interrupting are not acts here**: no grant gates them (see this file's header).
 * ⚑ **Seeing is not an act either**: `list_agents` and `get_agent_status` ask
 * `RuntimeHost.withinMessagingReach`, the question sending asks (`433` §B — *a caller may SEE
 * exactly what it may SEND to*).
 */
export const MESSAGING_ACTS = ['message', 'assign'] as const

/**
 * One of {@link MESSAGING_ACTS}.
 *
 * ⛔ **Derived from the list rather than written twice**, so a census that walks every act walks
 * every act. ⚑ The same argument {@link CAPABILITY_FIELDS} makes for the schema, one file over.
 */
export type MessagingAct = (typeof MESSAGING_ACTS)[number]

/** The rail each act is refused by when its grant reaches nothing. */
const RAIL_OF: Readonly<Record<MessagingAct, MessageRail>> = {
  message: 'may-not-message',
  assign: 'may-not-assign-work',
}

/** The capability each act reads — one lookup, so no gate can read another's field by accident. */
const REACH_OF: Readonly<
  Record<MessagingAct, keyof Pick<ProfileCapabilities, 'canMessage' | 'canAssignWork'>>
> = {
  message: 'canMessage',
  // 🔴 **553 · HO-060 §2, as a row.** *Anyone may ask anyone; giving work is its own grant* — so the
  // question *may I give a piece of WORK* is answered by its own column and by no other. ⛔ **This is
  // the row that makes HO-058 §1.2 describe the code**: sending and giving were *"separate names
  // under one gate"*, and a second row here is the second gate.
  assign: 'canAssignWork',
}

/**
 * 🔴 **Which reach values admit a conversation this identity did NOT START** (431 · criterion 6,
 * HO-024 §4 row 6, HO-022 §3).
 *
 * ⚠️ **It is asked about a conversation `mayCommand` has already refused**, and it decides whether
 * the grant admits it anyway: `none` reaches nothing, and `any` reaches every conversation, whoever
 * started it — HO-058 §1 made that the ruled default, *because a message consumes nothing, destroys
 * nothing, and transfers no authority.*
 *
 * ⚠️ **Be exact about what `any` therefore does, because the difference is WHO holds it and not
 * WHAT it reaches.** A conversation a person opened is reachable under `any`. ⛔ **So this table does
 * not protect a person's conversation from being messaged; it decides how many identities may do
 * it** — every one a person has not narrowed.
 *
 * ## ⛔ A TABLE, and not `reach === 'any'`
 *
 * A new word added to {@link MessagingReach} fails to compile until somebody has decided whether
 * it reaches past its holder's own conversations — {@link PERMANENCE}'s argument on a second axis,
 * and the opposite of a new value inheriting silence.
 *
 * ## ⚠️ What it does NOT answer
 *
 * ⛔ **Nothing about GIVING WORK or INTERRUPTING.** Work goes only to the giver's own conversation
 * with an agent (`give_work`'s lookup), and interrupting reaches only down the chain that created the
 * target — neither is widened by this table.
 *
 * 🔴 **It DOES answer who may be told a conversation exists, and that is `433` §B**: `list_agents`
 * and `get_agent_status` ask `RuntimeHost.withinMessagingReach`, whose clause 3 is this table. ⛔
 * **What it does not answer is whether a conversation will ACCEPT the words** — seeing is not
 * sending, and `agent-tools.ts`'s `list_agents` description says so to the model in as many words.
 */
const REACHES_WHAT_IT_DID_NOT_START: Readonly<Record<MessagingReach, boolean>> = {
  none: false,
  any: true,
}

/**
 * ⛔ **May this reach admit a conversation its holder did not start?** (431.)
 *
 * ⚑ **The answer is about the GRANT alone** — no session and no caller — because the facts that
 * follow it are asked by the door: `RuntimeHost.withinMessagingReach` is the only reader, and it
 * asks this last.
 */
export function reachesWhatItDidNotStart(reach: MessagingReach): boolean {
  return REACHES_WHAT_IT_DID_NOT_START[reach]
}

/**
 * 🔴 **The rails an act can meet with NO target: the caller's own grant** (486, HO-031 §2.5).
 *
 * ## ⛔ It is asked before an argument check, and at the verb
 *
 * ⚠️ **HO-031 §2.5 measured a wall arriving dressed as a typo**: `create_agent` validated the
 * caller's arguments first, so a caller with no grant was told `malformed-request · permanent` and
 * this app's own advice — *read it rather than retrying a permanent one* — pointed at the wrong
 * conclusion. ⛔ **The same inversion is at every door whose verb has a standing grant**, and the
 * fix at each of them is to ask the question that needs nothing from the caller's arguments first.
 *
 * ⚑ **The two causes it answers**: an identity this app cannot place, and a reach of `none`. Every
 * door that asks calls this rather than repeating it, so all of them agree about what a grant of
 * `none` means — `341`'s one-table rule, at a function boundary. ⚑ **For `assign` it is the whole
 * question** (D-016): a give has no target this rail could ask about.
 *
 * ⚠️ **`allowed === null` refuses, and the absence is the finding.** An identity with no row cannot
 * have been granted anything; falling back to `DEFAULT_CAPABILITIES` here would hand a caller
 * whose identity this app cannot find the ruled grant.
 *
 * @returns the rail that stops this caller from performing this act AT ALL, or `null`.
 */
export function admitReachAtAll(
  act: MessagingAct,
  allowed: ProfileCapabilities | null,
): MessageRefusal | null {
  // ⛔ **An identity this app cannot find is refused, and the payload says NOTHING about a grant**
  // (found reviewing this dispatch's own diff). Reporting `reach: 'none'` here would state a column
  // value that was never read — the row may not exist, or the conversation may have no identity at
  // all — and a model relaying it would send a person to a sheet showing something else.
  if (allowed === null) return refuseMessage(RAIL_OF[act])
  const reach: MessagingReach = allowed[REACH_OF[act]]
  if (reach === 'none') return refuseMessage(RAIL_OF[act], { reach })
  return null
}

/**
 * ⚑ **D-017 · R12 — the refusal for a conversation that EXISTS and is outside this caller's reach**
 * — the one `message_agent` answers, and every door that takes an id answers it too, so
 * `no-such-agent` is said only about an id no conversation has (`05` rule 6).
 *
 * ⚠️ **The grant is the only thing left that puts a conversation out of reach** (D-016): a reach of
 * `any` admits every conversation there is ({@link reachesWhatItDidNotStart}), so a caller is out
 * of reach only when its grant reaches nothing or it has no grant to read. ⚑ **`may-not-message`
 * without a `reach` stands for the rest**: the only other way to be refused is a grant that moved
 * between the reach being asked and this answer, and then the refusal is still the grant's — the
 * detail reports no value because none was read on the answer that refused.
 */
export function refuseOutOfReach(allowed: ProfileCapabilities | null): MessageRefusal {
  return admitReachAtAll('message', allowed) ?? refuseMessage('may-not-message')
}

/**
 * ⛔ **The refusal, as a value a caller can classify** — the shape `MessageAlreadyHeld` established
 * (`354`) and for its reason.
 *
 * ⚠️ **A typed class rather than a `SessionUnavailable`.** `RuntimeHost.refusalTranslated` converts
 * every `SessionUnavailable` into a plain `Error` carrying a human sentence, which is right for the
 * window that meets those — and it would destroy the machine-readable half here. `307` measured what
 * that costs a model: a transport-shaped error *"carries no machine-readable policy meaning"*, so
 * the child learns a tool broke rather than that a rule stopped it.
 *
 * ⚑ **Why a throw at all, when a give's refusal is a returned value.** `queueMessage` answers a
 * person's window with {@link QueueOutcome} across the IPC wire; giving it a third arm would make
 * every renderer caller handle a refusal that can never reach a renderer. The throw is caught in one
 * place — `agent-tools.ts`, where an agent's call is turned into a payload — and nowhere else.
 */
export class MessagingRefused extends Error {
  constructor(readonly refusal: MessageRefusal) {
    super(`${refusal.rail}: ${refusal.reason}`)
    this.name = 'MessagingRefused'
  }
}
