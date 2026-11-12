import type { RuntimeEventMessage, SessionLivenessMessage } from '../../shared/runtime-ipc'
import { THE_APP_DID_IT, type ActedBy } from '../../shared/who-did-it'
import { aWindowIsAsking } from './window-caller'

/** Where one session's events go. Implemented over `WebContents` in the app, faked in tests. */
export interface RuntimeEventSink {
  /** Stable id of the surface that owns this sink, so a window's sessions can be torn down together. */
  readonly ownerId: string
  /**
   * 🔴 **Is a PERSON behind this surface?** (349, HO-006 §3.1, for HO-005 Q2.)
   *
   * ⛔ **The fact {@link mayAnswerAsAHuman} used to infer from ownership, said out loud.** That
   * predicate asked whether the caller OWNS the session, and ownership is taken by
   * {@link RuntimeHost.claimSession}, which takes one of these — a type any caller can implement.
   * So an agent that presented a sink could claim its own child and then legally answer the
   * permission prompt that child stopped on. ⚡ **What stopped that was a fact, not a check**:
   * nothing but the IPC boundary calls the claim door, and the only sink reaching it is a window's.
   * `340` wrote that fact down as a source census; this field is what makes it a rail.
   *
   * ⚠️ **It is a statement about where the QUESTION IS DISPLAYED, which is why it is here and
   * not on {@link Caller}.** A caller exists for the length of one call and anything can construct
   * one; a sink is the channel a permission card actually travels down, and the only person who may
   * answer a card is the person it was shown to. {@link RuntimeHost.claimSession} copies this onto
   * the slot at the instant ownership is taken — see {@link SessionSlot.ownerIsAPerson} — so the
   * answer door reads what the OWNER declared when it took the conversation, never what the caller
   * says about itself at the moment of asking.
   *
   * ⛔ **Required, and never defaulted — in either direction.** A field that defaulted to `true`
   * would make every future sink a person by forgetting, which is the shape this rail exists to
   * refuse. A field that defaulted to `false` would be safe and silent: the next non-window
   * transport would compile without its author ever deciding. Required is the only spelling under
   * which *"is there a person here"* has to be answered by somebody rather than inherited.
   *
   * ⚡ **Exactly one thing in this app says `true`** — `webContentsSink`, which is minted from an
   * Electron `WebContents` at the one `sinkFor:` in `index.ts`. {@link NO_SURFACE} says `false`.
   */
  readonly aPersonIsBehindIt: boolean
  /** False once the surface is gone; the host stops delivering rather than throwing into a dead window. */
  readonly alive: boolean
  send(message: RuntimeEventMessage): void
  /** Provider liveness — its own path, because the transition worth reporting is silence. */
  sendLiveness(message: SessionLivenessMessage): void
}

/**
 * **The app acting on its own behalf, with no surface behind the gesture** (203, from 195 H1).
 *
 * ⛔ **It is a superuser and this line is the saying-so.** It skips the owner check in
 * {@link RuntimeHost.mayControl} entirely, so every use of it is a place where this app decided that
 * *nobody* is asking. There are exactly four legitimate reasons for that, and all four are the app's
 * own lifecycle rather than anyone's request:
 *
 *  - **the quit** — `closeAll()` ends every session, including sessions of windows already gone;
 *  - **a window that went away** — `closeSessionsForOwner` is triggered by `did-navigate`,
 *    `render-process-gone` and `destroyed`, at which point the owner cannot ask for anything;
 *  - **the host's own launch machinery** — `cancelLaunch` has already matched the owner itself, and
 *    the `close` it then performs is this host finishing its own gesture;
 *  - **the finalizer** — an ending that arrived from the provider, which has no owner at all.
 *
 * ⚠️ **What it is NOT is "the main process", and the difference matters for what comes next.** A
 * caller that reaches this host over a channel — today the one renderer IPC channel, tomorrow the
 * MCP tool a PM would spawn agents through — is a caller with an identity, and it passes that
 * identity. It does not become the app by virtue of running inside it. So the answer to *"what does
 * owner mean for a caller that is not a window"* is: **the same thing it means for a window — a
 * stable `ownerId` string it does not choose for itself.** `sinkOwnerId` mints `webContents:<id>`
 * for a renderer; a future MCP client gets its own prefix from whatever registers it, and its
 * sessions are the ones reserved under that id. Nothing about {@link RuntimeHost} needs to change
 * for that, which is the point of putting the check here rather than at the one door that exists
 * today.
 *
 * ⛔ **And it is NOT what a session created with no surface is owned by, which is 336 §2.1's
 * question asked and answered.** They are different kinds of thing: this symbol answers *"who is
 * asking"* for one gesture — it is a {@link Caller}, it exists only for the length of a call, and it
 * is a superuser — while an owner is an identity a SLOT is reserved under and holds for as long as
 * the session runs. Reserving a slot under this symbol would make every window's gesture legal on
 * it, since {@link mayControl}'s first clause is unconditional; it would make `closeSessionsForOwner`
 * unable to name it; and it would say *"the app asked for this"* about a session the app did not ask
 * for. ⚑ **A session nobody asked for has no owner, and that is spelled `null`** — see
 * {@link SessionSlot.ownerId} and {@link mayClaim}.
 *
 * A symbol, so it cannot be spelled by anything crossing a wire: {@link runtimeCommandSchema} can
 * only produce strings, and `ownerId` is compared, never parsed.
 */
export const THE_APP_ITSELF = Symbol('the app itself')

/**
 * **Who is asking** (203). Either a surface — anything carrying a stable `ownerId`, which every
 * {@link RuntimeEventSink} does — or {@link THE_APP_ITSELF}.
 *
 * ⛔ **Every control verb on this host takes one, and that is the whole fix for 195 H1.** Before
 * this, `send`, `interrupt`, `close`, the permission and user-input answers, the approval mode and
 * every live setting took a `sessionId` and nothing else — so a window that `attachOpen` returned
 * nothing for and `resume` refused could still drive somebody else's conversation with an id it can
 * read out of the session library. Making the caller a REQUIRED parameter is what stops the next
 * door being opened without one: there is no way to name a session here without also naming who is
 * naming it.
 */
export type CallerIdentity = Pick<RuntimeEventSink, 'ownerId'>

export type Caller = CallerIdentity | typeof THE_APP_ITSELF

/**
 * **One predicate, both ends** (203; the shape 187 §1 used for the profile name).
 *
 * `attachHeldSession`, `attachOpenSessions` and every control verb ask this same question of the
 * same field, so 062's *"the loser is TOLD rather than silently attached"* and 203's *"and it cannot
 * act on it either"* cannot come to disagree about what a loser is.
 *
 * ⚠️ **340 did not widen this, and the two questions it added are beside it rather than inside it.**
 * {@link mayCommand} is wider — it also admits the caller a session was SPAWNED for —
 * and {@link mayAnswerAsAHuman} is narrower, refusing even {@link THE_APP_ITSELF}. ⛔ This one is
 * still the whole of *"is this yours"*, and it is still what the two attach paths ask, because
 * *"who may drive this"* and *"who is this conversation's stream going to"* stopped being the same
 * question the moment a caller with no surface could drive one.
 */
export function mayControl(slot: { readonly ownerId: string | null }, by: Caller): boolean {
  return by === THE_APP_ITSELF || slot.ownerId === by.ownerId
}

/**
 * 🔴 **May this surface become the owner of a session that has none?** (336 §2.3.)
 *
 * ⛔ **A different question from {@link mayControl}, asked of the same field, copying none of its
 * answer** — which is the whole of 169 §1's rule as it applies here. `mayControl` asks *"is this
 * already yours"*; this asks *"is this nobody's"*. ⚑ **They are disjoint by construction**: this one
 * is true only when `ownerId` is `null`, and `mayControl`'s second clause can never be true of a
 * `null` owner because no {@link RuntimeEventSink} has a null `ownerId`. So no slot is reachable
 * through both doors, and neither door can be widened into the other by a later edit without that
 * showing up as a `null` on one side of a `===`.
 *
 * ⚠️ **It takes no {@link Caller}, and that absence is load-bearing.** A claim is not a gesture some
 * identity may perform on a session — it is *becoming* the identity, so the only thing that decides
 * it is whether the session already has one. {@link THE_APP_ITSELF} is therefore not accepted here at
 * all: the app cannot own a conversation, it can only act on one. The caller is a sink because a
 * claimer must be somewhere the stream can go.
 */
export function mayClaim(slot: { readonly ownerId: string | null }): boolean {
  return slot.ownerId === null
}

/**
 * 🔴 **May this surface give a session BACK to nobody?** (523, from `519` item 3 and HO-045 §1.)
 *
 * ⛔ **The inverse of {@link mayClaim} and not its negation.** `mayClaim` asks one question of one
 * field; this asks two of two, and the second one is not about ownership at all. ⚑ **`ownerId` is
 * the reversible half and {@link SessionSlot.bornWithoutASurface} is the frozen half**, so this
 * predicate is a conjunction of something that moves and something that cannot — which is what makes
 * it impossible for a later edit to widen it by accident: there is no assignment anywhere in this
 * file that could make the second clause true of a session it was false for.
 *
 * ⚠️ **Both clauses NARROW, so nothing this admits was refused before.** `mayControl`'s owner arm is
 * the first clause exactly, and the second only removes slots from it. ⛔ **No existing predicate
 * moves and no existing predicate reads this one** — the four that decide who may control, command,
 * claim and answer are untouched by `523`, which is the whole of that dispatch's Q5.
 *
 * ⛔ **{@link THE_APP_ITSELF} is not accepted, for {@link mayClaim}'s reason read backwards.** The app
 * cannot own a conversation, so it can have nothing to hand back; what it does at a window's
 * departure is {@link RuntimeHost.release} directly, which is the app noticing rather than a gesture
 * it performs. ⚑ A {@link CallerIdentity} parameter is how that is spelled: the symbol is a type
 * error here rather than a clause.
 *
 * 🔴 **And the order it is asked in is load-bearing** — see {@link RuntimeHost.releaseSession}.
 * Entitlement is refused BEFORE the birth fact, so a caller that does not own the conversation is
 * never told how it came to exist.
 */
export function mayHandBack(
  slot: { readonly ownerId: string | null; readonly bornWithoutASurface: boolean },
  by: CallerIdentity,
): boolean {
  return slot.ownerId === by.ownerId && slot.bornWithoutASurface
}

/**
 * 🔴 **May this caller GIVE this session work?** (340, from 336's finding.)
 *
 * ⛔ **The whole ticket in one line.** 336 built a door a session can exist behind with no renderer,
 * and then measured that nothing could drive one: every control verb asks {@link mayControl}, and
 * for an owner of `null` that admits only {@link THE_APP_ITSELF}. So a spawned agent sat idle until
 * a person took it over, which is the opposite of what spawning one is for.
 *
 * ⚑ **`ownerId` answers three questions at once — who may command, who is receiving, whose
 * departure ends it — and a caller with no surface answers YES to the first and NO to the other
 * two.** This predicate is the first question, split out; {@link SessionSlot.commandedBy} is the
 * field it reads and the only thing about it that is new.
 *
 * ⚠️ **Wider than {@link mayControl} and it does not replace it.** Widening `mayControl` itself
 * would have been one line and would have moved the other two questions with it:
 * `attachOpenSessions` and `attachHeldSession` ask `mayControl` to decide who a running
 * conversation's STREAM is handed to, and `close`/`closeSessionsForOwner` ask it to decide whose
 * departure ends one. A commander is entitled to neither, so the widening has to be a second
 * question rather than a bigger answer to the first.
 *
 * ⛔ **`null` matches nothing, by construction and not by care.** `commandedBy` is `string | null`
 * and a {@link CallerIdentity}'s `ownerId` is `string`, so a session nobody was given command of is
 * unreachable through this clause for the same reason a `null` owner is unreachable through
 * `mayControl`'s — which is what lets both stay `===` rather than growing a guard.
 */
export function mayCommand(
  slot: { readonly ownerId: string | null; readonly commandedBy: string | null },
  by: Caller,
): boolean {
  if (by === THE_APP_ITSELF) return true
  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId
}

/**
 * 🔴 **May this caller answer a question this session stopped to ask a PERSON?** (340 §2.)
 *
 * ⛔ **HO-005 Q2, ruled 2026-09-05, and this is the chokepoint it names**: *"Permissions: always the
 * human. Never a parent agent. An agent answering another agent's permission prompt is the kill
 * switch with extra steps. Build it so no path exists."* ⚑ The sentence to encode is *knowledge
 * escalates, authority does not* — so {@link mayCommand} is deliberately wider than `mayControl`
 * and this one is deliberately NARROWER.
 *
 * ⛔ **Narrower in two directions, and both are the rule rather than an accident.**
 *
 *  - **A commander is refused.** It may hand this session work; it may not decide what that work is
 *    allowed to do. Nothing about giving an agent a task makes the giver the person the agent
 *    stopped to ask.
 *  - ⚠️ **{@link THE_APP_ITSELF} is refused**, which is the one place in this file where the
 *    superuser is not one. The symbol means *"nobody is asking"* — it is the quit, a window that has
 *    gone, the finalizer — and *"nobody"* is precisely who may not answer for a person. Nothing
 *    passes it here today (`ipc.ts` is the only caller of either answer verb and it always holds a
 *    window's sink), so this costs nothing and closes the shortest path to the defect: a later
 *    lifecycle gesture reaching for the superuser because every other verb accepts it.
 *
 * 🔴 **349 REFUTED the paragraph that used to stand here.** It said *"it reads `ownerId` and
 * nothing else, so it cannot be widened by a field — a slot's owner is a surface a stream is going
 * to, which is the whole of what 'there is a person here' can mean in this process."* ⛔ **The
 * second half was already false when it was written, and 340 said so in the same dispatch**: a
 * slot's owner is whatever last got through {@link RuntimeHost.claimSession}, which takes a
 * {@link RuntimeEventSink} — a four-member structural type any caller can satisfy. So *"a surface a
 * stream is going to"* included any caller willing to receive a stream, and an agent that presented
 * one could claim its own child and then answer that child's permission prompt legally. ⚡ **What
 * actually stopped it was a fact about the callers that exist, not this predicate**, and 340 wrote
 * that fact down as a source census rather than as a check.
 *
 * ⛔ **So it now reads a SECOND field, and that field is a declaration rather than an inference.**
 * {@link SessionSlot.ownerIsAPerson} is {@link RuntimeEventSink.aPersonIsBehindIt}, copied from the
 * sink at the instant it took ownership. Ownership is untouched: the same caller still owns the
 * same sessions, still receives the stream, still takes down the ones it STARTED when it goes —
 * `523` corrected that clause, which had been a universal since `349` and stopped being one at
 * `336`, one dispatch earlier. What changed is
 * that owning is no longer, by itself, a claim to be a person.
 *
 * ⚠️ **A conjunction, and every conjunct answers a different question.** `by !== THE_APP_ITSELF` —
 * is anybody asking at all. `slot.ownerIsAPerson` — is the surface this card was DISPLAYED on one a
 * person is behind. `slot.ownerId === by.ownerId` — and is this caller that surface. ⛔ **Dropping
 * the third would let one window answer another's card** (062), and dropping the second is the
 * defect this dispatch closes; they are not two spellings of one test.
 *
 * ⛔ **The bound worth stating, because it is the door left open.** A caller that can spell an
 * owner's `ownerId` is that owner as far as the third conjunct is concerned — which is 195 H1's
 * territory and unchanged here: the ids are minted at the boundary (`webContents:<id>`,
 * `agent:<sessionId>`) and never parsed off a wire. What 349 removes is the need to FORGE anything:
 * before it, an agent could become an owner honestly, through the front door, and inherit the
 * answer with it.
 *
 * See {@link RuntimeHost.assertMayAnswer} for why the refusal is its own reason rather than
 * `not-yours`.
 */
export function mayAnswerAsAHuman(
  slot: { readonly ownerId: string | null; readonly ownerIsAPerson: boolean },
  by: Caller,
): boolean {
  return by !== THE_APP_ITSELF && slot.ownerIsAPerson && slot.ownerId === by.ownerId
}

/** For a diagnostic line: who asked, in the same vocabulary `SessionSlot.ownerId` is written in. */
export function callerName(by: Caller): string {
  return by === THE_APP_ITSELF ? 'the app itself' : by.ownerId
}

/**
 * ⛔ **Did a PERSON type this?** (413.) — a positive test, and the only way a turn reaches the
 * LEDGER unmarked.
 *
 * ⚠️ **607 · *unmarked* needed a noun**, because this function gained a second reader and the two
 * answers point opposite ways. ⛔ **On the ledger** it is still *the only way a turn carries no
 * `attribution`* — {@link whoseWordsTheseAre} is unchanged. ⚑ **On the PROVIDER's string it is now
 * the opposite**: {@link RuntimeHost.originOf} asks this and answers {@link THE_PERSON_AT_A_WINDOW},
 * so a person's turn is the one that gains a sentence rather than the one that goes without.
 * 🔴 A word whose meaning depends on which surface you are standing on is the shape `HO-070` §3
 * warns about, so it is named here rather than left to a reader to notice.
 *
 * ⚠️ **The tempting spelling is `by !== THE_APP_ITSELF && sessionSpeakingAs(by) === null`, and it
 * is the defect.** That reads *"not the app and not an agent"*, which puts every caller that does
 * not exist yet on the person's side — and {@link THE_APP_ITSELF}'s own docblock names the next
 * one: *"tomorrow the MCP tool a PM would spawn agents through … gets its own prefix from whatever
 * registers it."* ⛔ `413` §3: *"the dangerous default is the one that credits a person with words
 * they never wrote."*
 *
 * ⚑ **It reads the id rather than a flag the caller supplies.** {@link CallerIdentity} is
 * `Pick<RuntimeEventSink, 'ownerId'>` on purpose, and widening it to carry
 * `aPersonIsBehindIt` would make authorship something a caller says about itself at the moment of
 * asking — which is the shape {@link RuntimeEventSink.aPersonIsBehindIt}'s own docblock refuses
 * for the answer door. The ids are minted at the boundary and never parsed off a wire.
 */
export function aPersonTypedIt(by: Caller): boolean {
  return by !== THE_APP_ITSELF && aWindowIsAsking(by.ownerId)
}

/**
 * ⚑ **D-017 · R6 — a person is asking**: a window's caller, or a surface that says a person is
 * behind it. ⛔ Never an agent and never this app.
 */
export function aPersonIsAsking(by: Caller): boolean {
  if (by === THE_APP_ITSELF) return false
  return aPersonTypedIt(by) || (by as Partial<RuntimeEventSink>).aPersonIsBehindIt === true
}

/**
 * ⚑ **D-017 · R5 — the surface a call came through** — a person's window, when a person asked — or
 * null for an agent, this app, or a caller that is only an id: the sink a start it causes belongs to.
 */
export function theSurfaceAsking(by: Caller): RuntimeEventSink | null {
  if (by === THE_APP_ITSELF) return null
  const sink = by as Partial<RuntimeEventSink>
  return typeof sink.send === 'function' && typeof sink.sendLiveness === 'function'
    ? (by as RuntimeEventSink)
    : null
}

/**
 * 🔴 **Who is performing this act — the ONE derivation, and nothing a caller can say** (477,
 * HO-029 §2.1).
 *
 * ## ⛔ Derived, at the moment it happens, and unclaimable by construction
 *
 * ⚑ **It reads the {@link Caller} and nothing else**, which is
 * {@link MessageSentEvent.onBehalfOfAPerson}'s standard stated as a function: *"there is no
 * argument, on any tool, by which a model can say it."* ⛔ {@link CallerIdentity} is
 * `Pick<RuntimeEventSink, 'ownerId'>` — one opaque id, minted at a boundary and never parsed off a
 * wire — so there is no field for a caller to put an actor in, and no tool advertises one.
 *
 * ⚠️ **One fold rather than a spelling at each writer**, for {@link whoseWordsTheseAre}'s measured
 * reason: `410` counted what per-producer marking missed, and the answer was that a producer which
 * has to remember is a producer that will forget.
 *
 * ## 🔴 THREE positive tests, and the fourth word is what lets them stay positive
 *
 * ⛔ **Every arm asks what the caller IS, never what it is not.** {@link aPersonTypedIt} is
 * already the positive test for a window and is reused rather than re-spelled. ⚠️ The tempting
 * shape is `sessionSpeakingAs(by) === null ? 'a-person' : 'an-agent'`, and it puts every caller
 * that does not exist yet on the person's side. ⚑ `a-caller-this-app-cannot-name` is where such a
 * caller lands instead; see {@link WhoDidIt}.
 *
 * ⚑ **{@link RuntimeHost.recordTheAsk} wrote that tempting shape one row over until `501`**, and
 * this docblock said so for four dispatches. ⛔ It calls this function now, so the sentence is
 * history rather than a warning about live code — and `the-act-this-app-knows-the-author-of.test.ts`
 * asserts the old spelling is absent from this file, with a control that fires.
 *
 * ## ⚠️ What `a-person` claims here, and what the answer doors additionally prove
 *
 * ⛔ **This says a WINDOW asked.** At {@link RuntimeHost.requireToAnswer}'s two doors
 * {@link mayAnswerAsAHuman} has already held, so the surface has also declared a person is behind
 * it and the caller is that surface — `465`'s requirement — but the word is not allowed to depend
 * on a gate the other writers do not pass.
 */
export function whoDidIt(by: Caller): ActedBy {
  if (by === THE_APP_ITSELF) return THE_APP_DID_IT
  const speaking = sessionSpeakingAs(by)
  if (speaking !== null) return { who: 'an-agent', agent: speaking }
  if (aPersonTypedIt(by)) return { who: 'a-person' }
  return { who: 'a-caller-this-app-cannot-name' }
}

export const agentCallerId = (sessionId: string): string => `agent:${sessionId}`

/**
 * ⛔ **Which session is speaking, when the caller is an agent rather than a window** — the exact
 * inverse of {@link agentCallerId}, and `null` for every other kind of caller (347).
 *
 * ⚠️ **This is a decoder, not a permission.** It answers *"who is this"*, and every use of it has to
 * decide for itself what that entitles. It lives beside the encoder so the two spellings cannot
 * drift apart, which is the only reason a prefix scheme is safe to depend on.
 */
export function sessionSpeakingAs(by: Caller): string | null {
  if (typeof by !== 'object' || by === null) return null
  const ownerId: unknown = (by as { ownerId?: unknown }).ownerId
  if (typeof ownerId !== 'string' || !ownerId.startsWith('agent:')) return null
  const said = ownerId.slice('agent:'.length)
  return said.length === 0 ? null : said
}
