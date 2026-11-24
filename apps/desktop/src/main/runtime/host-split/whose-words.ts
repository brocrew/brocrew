import type { TurnFacts } from '../message-records'
import { type WhoseConversation } from '../agent-directory'
import { aPersonTypedIt, sessionSpeakingAs, type Caller } from '../conversation-caller'
import type { GivenFolder } from '../../../shared/work-folders'
import { agentName } from '../../../shared/runtime-ipc'
import type { AgentIdentity, AgentIdentityName } from '../../../shared/runtime-ipc'
import { formOfName } from '../../../shared/documents'
import { type KeptFile } from '../../../shared/runtime-ipc'
import type { TurnAuthorship } from '../../../shared/human-answer-contracts'
import type { KeptFileRow } from '../../db/session-store'
import { THE_PERSON_AT_A_WINDOW, type TurnOrigin } from '../turn-origin'
import { aPersonsCommand } from '../a-command-goes-as-typed'
import { AN_AGENT_THIS_APP_CANNOT_NAME } from '../reply-rails'
import type { AgentMessageKind } from '../../../shared/task-contracts'
import type { QueuedMessage } from '../queued-message'

/**
 * 🔴 **713 · `708` H-4 — what a gate decided about a person's command, carried to the next door.**
 *
 * ⚑ `R42`'s answer ({@link aPersonsCommand}): the command these words are, or `null` for words that
 * are not one — they go with their frame, or, for a person's `/compact` on a handle that compacts on
 * request, to that request (`R59`, which the handover asks before it reads this). ⛔ **Returned by
 * every gate, and CARRIED on one path**: interrupt-and-send, whose first gate answers before the
 * running turn is stopped and whose second gate and handover come after it. See
 * {@link RuntimeHost.runSendInterrupting}. ⚠️ **Not onto its lost-race HOLD**: `queueAs` asks the
 * queue's gates again against the conversation as it then is (670), so on that arm a moved list can
 * still refuse after the stop — as that arm's one-work-message rule already could. Reported in 713.
 */
interface WhatTheGateDecided {
  readonly command: ReturnType<typeof aPersonsCommand>
}

/** What a turn gate is asked about: the words, and what an earlier gate decided of them. */
interface WhatTheGateIsAsked {
  text: string
  attached: number
  /**
   * 🔴 **708 · who these words are from** — the same `from` {@link handToProvider} will be
   * handed, so the command this gate refuses is the command that door would have sent bare.
   * ⛔ **Required**, for {@link handToProvider}'s own reason: a caller that could omit it would
   * be a door whose person's commands the gate never looks at.
   */
  from: TurnOrigin | null
  /**
   * 🔴 **713 · `708` H-4 — what an EARLIER gate decided about these same words**, when there
   * was one. ⚑ Present on ONE call: interrupt-and-send's second gate, which comes after the
   * running turn was stopped — so a list that moved while the interrupt waited cannot make it
   * refuse, after the stop, a command its first gate let through (`R42`'s refusal comes before
   * the stop or not at all). ⚠️ **Absent everywhere else, and that is not a default a path
   * forgets**: every other door decides here — the lost-race hold included, which asks the
   * queue's gates again by design (670; {@link WhatTheGateDecided}).
   */
  decided?: WhatTheGateDecided
}

/**
 * 🔴 **D-010 · what a message the app or a person sends counts as** — `note`, which opens nothing.
 * ⚑ `says` is RECORDED only for an agent's message (`whoseWordsTheseAre`), and `message_agent`
 * always declares one; this is the host door's value for every other sender, which is never asked
 * to say. ⛔ No message opens a piece of work: only `give_work` gives one (D-016).
 */
const WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS: AgentMessageKind = 'note'

/** ⚑ **W4.189** — a launch's work folders, absent when there are none. */
const workFoldersIn = (folders: readonly string[]): { readonly workFolders?: readonly string[] } =>
  folders.length === 0 ? {} : { workFolders: folders }

/** ⚑ **W4.189** — a piece's grant, as {@link ThePieceATurnCarries.grant} spells it. */
const grantOf = (
  given: GivenFolder | null | undefined,
): { readonly grant?: string; readonly outputFolder?: string } => ({
  ...(given?.use === 'grant' ? { grant: given.folder } : {}),
  ...(given?.output === true ? { outputFolder: given.folder } : {}),
})

/**
 * 🔴 **Whose words a turn is, and what it is about — computed once, for every door** (413).
 *
 * ## ⛔ One writer for all three keys, which is `406`'s rule widened rather than copied
 *
 * ⚠️ **`406` wrote `attribution` and `work` in one spread so neither could travel without the
 * other**, and then had to mark each producer by hand. ⛔ **`410` counted what hand-marking
 * missed** — *"1 unattributed turn on Codex, 2 on Claude"* — and only one of the two was the
 * producer `406` had named. ⚑ **So the marking stopped being per-producer.** Every path that
 * publishes a `user_turn` asks this function, and a producer added tomorrow is app-authored by
 * forgetting.
 *
 * ## ⚠️ `report` is not what decides the attribution any more, and that is a widening
 *
 * ⛔ **A report still forces the marking** — a turn carrying `work` and no `attribution` would
 * render as the person's own bubble with the facts attached, which is `406`'s stated hazard — but
 * it is no longer the only thing that does. ⚑ The first clause is a belt: no caller passes a
 * report from a window today, and if one ever does, the turn is marked rather than credited to
 * the person.
 *
 * ## 🔴 `relayedFrom` comes from the CALLER, except where BroBot is carrying for somebody else
 *
 * ⚠️ **`message_agent` is derived** — {@link sessionSpeakingAs} names the conversation whose model
 * wrote the words, so nothing at that call site has to remember. ⛔ **An `ask_question` delivery
 * passes it**, because there the caller is {@link THE_APP_ITSELF} and the conversation the words
 * belong to is the one that asked, which no property of the caller can name.
 *
 * ## 🔴 545 · and the IDENTITY behind that conversation, written in the same expression
 *
 * ⛔ **`HO-054` §3 reversed `413` §4's second half and left its first half standing**: *"a turn
 * attributed to the app is not a turn attributed to a named agent unless the ledger holds that
 * name"* — so the ledger holds the name. ⚑ **{@link identityOf} is a PARAMETER and not a default**,
 * for {@link handToProvider}'s `from` reason exactly: a producer that may omit the relayer is a
 * producer that will, and the symptom would be a row silently falling back to
 * `AN_UNNAMED_RELAYER` on a hop this app could have named. 🔴 `a-default-no-call-site-reaches`,
 * pointed the same way — the default that would be silent is the wrong one, so there is no
 * default.
 *
 * ⚠️ **Resolved HERE rather than in the renderer, because the renderer cannot.** {@link agentName}
 * takes an identity slug; {@link UserTurnEvent.relayedFrom} is a `sess_…` handle; and no surface
 * that draws a transcript holds a conversation-to-identity map — a relayer is routinely a
 * conversation this window has never opened. ⛔ **The one place that can
 * answer is the door.**
 *
 * ⚑ **The two keys cannot travel apart**, which is this function's whole reason one field over:
 * they are set in one expression, off one value, and the held rows carry the value whole (687).
 */
export function whoseWordsTheseAre(
  by: Caller,
  /**
   * ⛔ **How a conversation is turned into the identity behind it** (545) — `SessionStore.identityOf`'s
   * `profileSlug`, or `null` when that conversation has no identity.
   *
   * ⚠️ **A function and not a store**, so this stays the pure expression `413` made it: the three
   * host doors pass {@link RuntimeHost.profileOf} and the tests pass a map, and neither can reach
   * anything else through it.
   */
  identityOf: (conversation: string) => string | null,
  /**
   * ⛔ **A `Pick`, and the keys it leaves out are the statement** (414). {@link TurnFacts.giving}
   * and {@link TurnFacts.rebriefing} say what work a turn hands over and {@link TurnFacts.aboutPiece}
   * what a message names; none says anything about whose words these are, and a signature that
   * accepted them could be read as though it might.
   */
  facts: Pick<TurnFacts, 'report' | 'carriedFor' | 'appNotice' | 'answeredQuestion'> = {},
  /**
   * 🔴 **What the caller said these words are** (687 · `678` H1) — {@link UserTurnEvent.says}.
   *
   * ⛔ **Written only when the caller is an AGENT's conversation** — `sessionSpeakingAs(by)` — so
   * what a window or {@link THE_APP_ITSELF} passes is inert. ⚑ A brief `give_work` sent passes none:
   * it says what it is by the piece it names. ⚠️ **Not `wroteIt`**:
   * a routed question is CARRIED for a child (`carriedFor`) and nobody declared it anything.
   *
   * ⚑ **A parameter and not a {@link TurnFacts} key**, because {@link RuntimeHost.queueMessage}
   * already takes it as its own argument and a second place to state it would be a second
   * spelling; only `queueAs` passes it, to both of its branches.
   */
  says?: AgentMessageKind,
): TurnAuthorship {
  const { report, carriedFor, appNotice, answeredQuestion } = facts
  const wroteIt = carriedFor ?? sessionSpeakingAs(by) ?? undefined
  // ⚑ **624 · a third subject in the same conjunction, and it is a BELT for {@link report}'s
  // reason** — no caller passes a notice from a window today, and if one ever does the turn is
  // marked rather than credited to the person. ⛔ **The dangerous default is the one that credits
  // a person with words they never wrote** (413 §3), and this clause is where a fourth subject
  // added tomorrow has to be named or a window's turn will swallow it.
  if (
    report === undefined &&
    wroteIt === undefined &&
    appNotice === undefined &&
    aPersonTypedIt(by)
  )
    return { humanInitiated: true }
  // ⚑ **545 · asked only when there IS a relayer**, so a person's turn and a go-ahead cost no
  // ledger read at all — {@link RuntimeHost.originOf}'s own rule one method over. ⛔ **`?? undefined`
  // and never `?? ''`**: an identity this app cannot name is the ABSENCE of the key, which is what
  // the renderer's fallback is keyed on, and an empty string would be a name nobody can read.
  const named = wroteIt === undefined ? undefined : (identityOf(wroteIt) ?? undefined)
  return {
    attribution: 'app_authored',
    ...(report === undefined ? {} : { work: report }),
    ...(wroteIt === undefined ? {} : { relayedFrom: wroteIt }),
    ...(named === undefined ? {} : { relayedFromProfile: named }),
    // ⚑ **624 · the fifth key, in the same one spread** — see {@link TurnFacts.appNotice}. ⛔
    // Spread and never assigned, so a turn that is not a notice carries no such key at all and
    // the absence goes on meaning *the plan go-ahead*, which is what every app-authored row in
    // every ledger written before `624` is.
    ...(appNotice === undefined ? {} : { appNotice }),
    ...(answeredQuestion === undefined ? {} : { answeredQuestion }),
    // ⚑ **687 · the sixth key, and the only one a CALLER declares** — see the parameter. ⛔ Asked of
    // `by` and never of `wroteIt`, so a question BroBot carries for a child says nothing.
    ...(says === undefined || sessionSpeakingAs(by) === null ? {} : { says }),
  }
}

/**
 * ⚠️ **How a refusal spells an owner that is not there** (336, and 074's rule about a third state).
 *
 * Interpolating `null` gives *"held for null"*, which reads as a bug in the sentence rather than as
 * a fact about the session. The two states are told apart because they are different: a session held
 * for a window that is not you, and a session held for nobody, are refused for different reasons and
 * a person acts differently on each.
 */
/**
 * ⚑ **D-017 · R3 — who sent a held message, read back off its authorship** —
 * {@link whoseWordsTheseAre} the other way: a person's words carry none, an agent's carry the kind it
 * declared beside the conversation that wrote them, and this app's own words have no sender line.
 * ⚑ **D-016 · a brief or a new brief declares no kind and names its piece**: its giver wrote it, so
 * it keeps its sender line across a quit.
 */
function theSenderItsAuthorshipNames(
  authorship: TurnAuthorship,
  /** ⚑ Whether the held message delivers a piece — a brief, or a new brief. */
  carriesAPiece: boolean,
  aPersonIsAt: (conversation: string) => boolean,
): TurnOrigin | null {
  if (authorship.attribution === undefined) return THE_PERSON_AT_A_WINDOW
  if (authorship.relayedFrom === undefined) return null
  if (authorship.says === undefined && !carriesAPiece) return null
  return {
    who: 'a-caller-with-an-id',
    caller: authorship.relayedFrom,
    profile: authorship.relayedFromProfile ?? null,
    aPersonIsBehindIt: aPersonIsAt(authorship.relayedFrom),
  }
}

/** ⚑ **F074 — a held message a person wrote**: its origin says so ({@link TurnOrigin}). */
function aPersonsOwn(queued: QueuedMessage): boolean {
  return queued.origin?.who === 'a-person'
}

function ownerName(ownerId: string | null): string {
  // ⚠️ **652 · "no surface asked for it", which is true of both doors.** It read *"it was created
  // without a surface"*, which was exact while `createSession` was the only door that reserved
  // under nobody — and is false of a reopen with no sink, which reserves the same way.
  return ownerId ?? 'nobody — no surface asked for it'
}

/** ⚑ **The arm that carries nothing, as a constant** — see {@link whoseConversationIs}. */
export const AN_IDENTITY_THIS_APP_CANNOT_NAME: WhoseConversation = {
  is: 'an-identity-this-app-cannot-name',
}

/**
 * 🔴 **Name the identity a conversation names, and NOTHING otherwise** (610 · HO-092 §2).
 *
 * ## ⛔ A POSITIVE test, and it is the conversation's own field rather than the ledger's
 *
 * ⚠️ **The brief asked for `foundInUserHome` in front of {@link agentName}, and that predicate is
 * the WRONG one here — narrower and wider than the question at once.** ⛔ Narrower: it answers
 * *"was this row swept out of the user's own folder"*, and says nothing about a reservation whose
 * identity has not arrived, which is the other way {@link AgentCard} reaches this function. ⛔
 * Wider: it is a LEDGER read, one per card, and {@link RuntimeHost.agentsVisibleTo} already states
 * its price as *"two ledger reads per slot the caller did not start"*.
 *
 * ⚑ **The renderer's own call site is the derivation, and what it does is NOT restate the
 * predicate.** `conversation-list.ts` drops `foundInUserHome` rows before the fold and says why in as
 * many words: *"The predicate is not restated here — the store computed it and the row carries the
 * answer (`032`)"*, and on its other half, *"Re-checking here would mean `ResumableSessionInfo`
 * carrying a flag whose only true value is unreachable, which is a second answer to a question
 * already settled one process away."*
 *
 * 🔴 **Here the answer is already carried too, by the SLOT.** A swept conversation reaches a slot
 * with `profileId: null` — `resumeSession` reserves it from `find(sessionId)?.profileId ?? null`
 * — and `reopenSession` then refuses it by `row.homeRefusal`, which is
 * `foundInUserHome(row) || restoredFromBundle(row)`. ⚠️ **So the slot field answers a strictly
 * WIDER question than the ledger predicate**, covering the swept row and every other slot that
 * cannot name its identity, and it is the honest bound for a surface that must still LIST the row
 * rather than drop it.
 *
 * ## ⚠️ `null` is TWO facts here and BOTH of them refuse a name
 *
 * ⛔ **{@link profileLabel}'s docblock separates them:** the pre-profiles row's `null` really did
 * run in the default profile, so labelling it is a report; the swept row's `null` is the absence of
 * any profile, so labelling it invents one. ⚑ **At this payload they are one answer**, because the
 * only moment a card carries `null` at all is a RESUME IN FLIGHT — after registration the session
 * carries `row.profileId ?? DEFAULT_PROFILE_ID`, so the pre-profiles row is named from the
 * identity it really ran as. ⚠️ **A card that cannot yet tell the two apart may not pick one**, and
 * this is the arm that says so.
 *
 * @param profile the slug this conversation names, or `null` for a slot that cannot name one.
 * @param roster the identities, or `null` before the read lands and on a host with no database —
 *   {@link agentName}'s own parameter, passed through unchanged.
 */
export function whoseConversationIs(
  profile: string | null,
  roster: readonly AgentIdentityName[] | null,
): WhoseConversation {
  if (profile === null) return AN_IDENTITY_THIS_APP_CANNOT_NAME
  return { is: 'an-identity-this-app-holds', profile, name: agentName(profile, roster) }
}

/**
 * 🔴 **The word a SENTENCE gets for a conversation** (624, `HO-095` §5.3) — the union folded to
 * one string, so a composer can be handed a word instead of a union it would have to branch on.
 *
 * ## ⛔ The whole of it is that the second arm is not the handle
 *
 * ⚠️ **`HO-095` §5.3: *"Task #1 (`task_…`) with `sess_a2d504f1…`. That is Ada. Say Ada."*** ⛔ A
 * repair that named the agent when it could and fell back to `sess_…` when it could not would
 * leave the defect alive on exactly the rows nobody tests. ⚑ {@link AN_AGENT_THIS_APP_CANNOT_NAME}
 * is a CATEGORY, which is `relayed-turn.ts`' `AN_UNNAMED_RELAYER` and `413` §4's surviving clause:
 * *a turn attributed to the app is not a turn attributed to a named agent unless the ledger holds
 * that name.*
 *
 * ⚑ **A free function and not a method**, so both arms are reachable from a test without a store:
 * the arm this app meets least often is the one a private method would leave unmeasured
 * (`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`).
 */
export function nameTheConversation(whose: WhoseConversation): string {
  return whose.is === 'an-identity-this-app-holds' ? whose.name : AN_AGENT_THIS_APP_CANNOT_NAME
}

/**
 * 🔴 **D-026 · R1 — a kept file as a window draws it** ({@link KeptFile}) — the door's row and the
 * push's, from this one mapper, so a file folded in off `runtime:states` is the row the door would
 * have answered.
 *
 * ⚑ Its adder is named as every row in the window names a conversation's agent
 * ({@link whoseConversationIs}, {@link nameTheConversation}), and its form is derived from its name
 * ({@link formOfName}), as a reading's is: one derivation each.
 */
function keptFileOf(kept: KeptFileRow, roster: readonly AgentIdentity[] | null): KeptFile {
  const { resource, addedByIdentity } = kept
  return {
    ...(kept.group === undefined ? {} : { group: kept.group }),
    ...(kept.mainResult === true ? { mainResult: true as const } : {}),
    resourceId: resource.resource,
    // ⚑ **D-026 · R2 — a file kept before titles were taken carries none**, and its name is the
    // rule's own *or else*.
    title: resource.title ?? resource.name,
    name: resource.name,
    form: formOfName(resource.name),
    bytes: resource.bytes,
    role: resource.role,
    keptAt: resource.createdAt,
    sha256: resource.sha256,
    addedBy:
      resource.addedBy === null
        ? null
        : {
            conversation: resource.addedBy,
            name: nameTheConversation(whoseConversationIs(addedByIdentity, roster)),
            identity: addedByIdentity,
          },
    piece: resource.piece,
    label: kept.label,
    pieceTitle: kept.pieceTitle,
  }
}

export {
  aPersonsOwn,
  grantOf,
  keptFileOf,
  ownerName,
  theSenderItsAuthorshipNames,
  WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
  type WhatTheGateDecided,
  type WhatTheGateIsAsked,
  workFoldersIn,
}
