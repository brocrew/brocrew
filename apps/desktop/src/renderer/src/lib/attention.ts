import type {
  CreatedSession,
  PermissionDecision,
  Provider,
  UserInputResponse,
} from '../../../shared/runtime-ipc'
import type { CardNobodyHolds } from '../../../shared/questions'

import {
  ALLOW,
  I_OPENED_IT,
  ALLOW_FOR_THIS_CONVERSATION,
  ALLOW_ONCE,
  inTheAgentsWords,
  noWayToAllow,
  permissionDecisionFor,
  permissionOffer,
  whatTheMarksSay,
  wideGrantWarning,
  conversationGrantSaid,
  conversationGrantCovers,
  keptGrantOf,
  keptGrantSaid,
  ALWAYS_ALLOW,
  type PermissionOffer,
} from './permission-offer'
import { NEEDING_WORD } from './agent-state'
import { whereItWorks, type SessionRecord } from './session-record'
import {
  applyEvent,
  createTranscript,
  isAwaitingAnswer,
  markAnswerRefused,
  type PermissionRequestEvent,
  type TranscriptState,
} from './transcript'
import {
  serversAskOf,
  userInputOffer,
  type AttentionDecision,
  type AttentionLimit,
} from './user-input-offer'

/**
 * 🔴 **695 · R36 — the two optional fields a MARKED permission row carries**, and nothing on a row
 * the provider did not mark (so it is byte-identical to a row from before 695) — ⚠️ except the
 * provider's own words, which since `720` (R73) a Codex command an exec-policy rule stopped carries
 * too, with no mark, labelled `providerReasonFrom: 'a-policy-rule'` and drawn as its rule since `725`.
 */
function markFields(
  said: ReturnType<typeof whatTheMarksSay>,
  offer: PermissionOffer,
): { marksSay?: readonly string[]; refusesFirst?: true } {
  const lines = [said.grantWithheld, said.defaultIsNo, said.providerReason].filter(
    (one): one is string => one !== null,
  )
  return {
    ...(lines.length > 0 ? { marksSay: lines } : {}),
    ...(offer.primary === 'refuses' ? { refusesFirst: true as const } : {}),
  }
}

/**
 * ⛔ **Re-exported, not redeclared** (214 §3). Both types moved to `user-input-offer.ts` with the one
 * function that decides them, because holding the vocabulary here and the card's answer there is
 * what let Home say a plan could not be approved while the card beside it approved plans. Every
 * existing importer keeps its import; there is simply no second place left to change one of them.
 */
export type { AttentionDecision, AttentionLimit }

/**
 * ⛔ **What Open says when it cannot reach the card it was asked for** (236 §2).
 *
 * ⚠️ **A miss is possible even though the row was built from the record's own items**: the queue
 * walks `record.control.items`, the transcript renders `record.window.entries`, and the window is a
 * PAGE of that fold. A card old enough to have been released from the window is a card this cannot
 * scroll to — so the sentence names where it went rather than where it is not.
 *
 * ⚑ Here rather than in the component so a test can hold the surface to the exact words, which is
 * `169` §2's rule for every sentence the app says.
 */
export const OPEN_REQUEST_MISSED =
  'That request is not in the part of this conversation on screen — it is further back; ' +
  'load more of the transcript to reach the card.'

/**
 * **Everything that needs you, across every open conversation** (205, from 195 H3).
 *
 * Collect actions requiring the person's answer in one place across conversations and projects.
 *
 * 195 H3 measured what the absence costs: the PM drove two parallel Claude sessions and **one sat
 * frozen on a permission card for 63 seconds** while work happened in the other. The rail said
 * `waiting`; nothing said what was being asked, and `RuntimeScreen` mounts `ConversationPane` only
 * for `activeId`, so the pending request was not rendered anywhere else in the window.
 *
 * ## ⚠️ A projection, not a store — the same rule `session-panel.ts` states
 *
 * This is a pure function of the records the store already holds. It subscribes to nothing, caches
 * nothing and folds nothing: every fact below is read off `record.control`, the same fold the
 * conversation itself renders from. A queue that listened to events and kept its own list would
 * eventually disagree with the card it points at — a permission answered in one and still open in
 * the other — and no amount of care keeps two folds in step forever.
 *
 * ## ⛔ What it costs at 30 conversations, because that is the target
 *
 * `record.control.pending` is the fold's own O(1) count (099), so a conversation with nothing waiting
 * costs **one integer comparison** and is never walked. Only a conversation that IS waiting has its
 * `items` walked, once, which is the cost `sessionPanel` already pays for the conversation on screen.
 *
 * ⚑ **And the gate is what keeps this off the hot path, for a reason rather than by luck.** Reading
 * `pending` touches only that field, so a conversation streaming deltas does not invalidate this
 * computed at all — while a conversation that IS walked is one the provider has frozen on a card,
 * which is to say one that has stopped producing events. The expensive case and the noisy case are
 * disjoint by construction. 203's rail learned the other way round the hard way: gating on
 * `requestItems` made the whole rail re-render several times a second for any conversation that had
 * ever asked one permission, forever, because nothing prunes that map.
 */

export interface AttentionRequest {
  /** Distinct across conversations — the list renders on this. */
  key: string
  sessionId: string
  /** The PROVIDER's request id, which is what `respondPermission` / `respondUserInput` take. */
  requestId: string
  /** The transcript item, so opening the conversation can scroll to the card itself. */
  itemId: string
  /**
   * ⛔ **Which of the two populations this row is** — answered with `respondPermission` and
   * `respondUserInput` respectively. ⚑ `answerFor` is where that branch lives, so no surface has to
   * make it twice.
   */
  kind: 'permission' | 'question'
  /** WHICH conversation: the folder it runs in, or its id when it has no meta yet. */
  where: string
  /**
   * 🔴 **Whether a caller other than this window can drive the conversation this card came from**
   * (349, HO-006 §4.5).
   *
   * ⛔ **A person can answer a permission from *Waiting on you* without ever opening the conversation**, and the
   * one surface inside a conversation that carries this fact — Info's *other callers* row
   * (`info-has-a-commander`) — is inside one. So the one gesture the disclosure is about would be performed on a surface that
   * said nothing about there being another caller at all, which is criterion 9 on the row rather
   * than in the conversation.
   *
   * ⚠️ **A fact, never the id** (085), for the same reason `CreatedSession.hasACommander` is one.
   */
  hasACommander: boolean
  /**
   * ⚑ **D-017 · R19 — this app routed the request** (`PermissionItem.routed`): its parent answers
   * it, or the person's queue lists it from the host's read. ⚠️ Optional, as on the card: absent
   * where nothing routed it. See {@link listedNowhereElse}.
   */
  routed?: true
  provider: Provider | null
  /** The profile whose home it runs in, when the host has said. */
  profileId: string | null
  /**
   * 🔴 **714 · R41 (`712` F-4) — WHO it runs as, NAMED** — {@link profileId} through
   * {@link attentionQueue}'s `nameOf`, or `null` where the host has not said.
   *
   * ⛔ **The row drew {@link profileId} itself**, so an agent a person had named *Ada* sat on Home
   * as `web-frontend-pm`. ⚑ Kept beside the slug rather than replacing it: `profileId` is what the
   * host said, and this is the one a person reads.
   */
  who: string | null
  /**
   * ⚑ **203's word, reused rather than restated** — `needs you: permission` /
   * `needs you: question`.
   * `standingWord` is the one function that turns facets into this, and the rail draws its rows from
   * the same call, so the overview and the rail cannot describe one conversation differently.
   */
  standing: string
  /** WHAT IS ASKED — the provider's own sentence when it sent one, else the action. */
  asked: string
  /**
   * THE SCOPE, as the card discloses it (071: *"the whole command, tail and all"*).
   *
   * Lines rather than a paragraph, because 031's rule applies hardest here: at six rows a paragraph
   * per row is a surface nobody reads, which is worse than nothing.
   */
  scope: string[]
  /**
   * How many of the first {@link scope} lines are about this one action: the disclosure, where it
   * runs and what it touches. The lines after them say what a broader answer would install.
   * Absent on a question, whose every line is about the request itself.
   */
  actionLines?: number
  /**
   * ⛔ **The disclosure is NOT whole, and this surface says so exactly as the card does** (181).
   *
   * Two independent ways it can be short, and they are different facts:
   *  - {@link underDisclosed} — the ADAPTER could not represent the request's scope in the neutral
   *    shape at all, so what is shown is a floor and the real scope is broader.
   *  - {@link detailOmitted} — the disclosure was WHOLE and got bounded at
   *    `MAX_PERMISSION_DETAIL_CHARS`; this many characters of it are not here.
   */
  underDisclosed: boolean
  detailOmitted: number | null
  /**
   * 🔴 **Why this request offers no way to ALLOW it** (487) — the sentence, or null when it offers
   * one.
   *
   * ⛔ **A sentence and not the adapter’s word**, as the wholesale grant’s warning is: the
   * word crosses the wire, `permission-offer.ts` turns it into copy, and every surface that draws
   * this row quotes the same copy the card does. ⚠️ **Null on every question** — it carries no
   * permission outcomes, so it cannot be short of a positive.
   */
  noPositive: string | null
  /**
   * 🔴 **695 · R36 — what the provider's marks say**, from `whatTheMarksSay`, the function the card
   * reads — ⚑ and, since 700, the provider's own reason for them, last. ⚑ **Optional, and absent on
   * every row that carries neither a mark nor a provider's reason** — the same shape the marks have
   * on the event, so a row built before 695 is a row with nothing to say. ⚠️ Since `720` (R73) a
   * Codex command an exec-policy rule stopped carries the provider's words too, labelled
   * `providerReasonFrom: 'a-policy-rule'`, so an UNMARKED Codex row can carry this line — ⚑ drawn
   * since `725` as that provider's RULE (`inItsRulesWords`), named from {@link provider}.
   */
  marksSay?: readonly string[]
  /**
   * 🔴 **725 · R44 — what the MODEL wrote about this ask, as its agent's words** (`inTheAgentsWords`,
   * named from {@link who}): a command card's `agentReason`, or a grant's `permission.agentReason`.
   * ⛔ **Never a {@link scope} line** — a sentence the agent wrote about the access, not the access.
   * ⚑ **Optional, and absent on every row that carries no such field** — a row from before `709`
   * among them, whose grant `reason` stays the first scope line, drawn as it was.
   */
  agentSays?: string
  /**
   * 🔴 **695 · R36b — refusal is this row's default**: its refusals lead, and a surface must not
   * DIM them the way it dims a refusal that is not the expected answer. Absent otherwise.
   */
  refusesFirst?: true
  /**
   * HOW LONG it has been waiting — when the card arrived, epoch ms, or **null when the fold had no
   * clock**. Null is rendered as "no time recorded", never as zero and never as "just now": 195's
   * *"age"* is the whole argument for this surface and an invented one would undo it.
   */
  at: number | null
  /** THE DECISIONS ON OFFER — only ones this surface can send correctly. */
  decisions: AttentionDecision[]
  /** Why there is no one-click answer here, or null when there is one. */
  limit: AttentionLimit | null
  /**
   * ⛔ **An answer is already on its way, so nothing may be offered again** (207 M2).
   *
   * Read off the record's own request draft — `markSent` sets it before the first await, and both
   * ordinary cards consume it (`PermissionCard`, `UserInputCard`). This surface did not, so every
   * button stayed live after the first click: Allow took the broker slot, the still-enabled Deny was
   * refused as not-pending, and the row vanished on the decision the user did NOT press last. The
   * flag is 064's, and the defect was one surface not reading it.
   *
   * ⚠️ **`get`, never `requestDraft`.** The helper CREATES a draft when there is none, and a
   * projection that writes into the record it is projecting would grow `record.requests` once per
   * pending request per render — the unpruned-map shape 203 already paid for on the rail.
   */
  sent: boolean
  /**
   * 🔴 **Why the LAST answer sent from this window did not land, on a card that is STILL
   * waiting** (468) — `TranscriptItem.refused`, carried onto the projection unchanged.
   *
   * ⛔ **The opposite of {@link sent}, and they are drawn one after the other.** `sent` goes true
   * before the first await and false again the moment the host refuses something it left open, so
   * a person watching the queue sees the buttons go and come back. ⚠️ **What they did not see is
   * why**: `noteAnswer` writes the host's own sentence onto the transcript ITEM, and the card
   * three surfaces away draws it while the row that was pressed drew nothing at all.
   *
   * ⚑ **The item's field and not the ack, deliberately.** `RuntimeBridge` answers an `AnswerAck`
   * for all three doors (a `ProviderAnswerAck` for the two provider doors since `742`) and the
   * renderer store spends it on the card; reading the ack a second
   * time here would be a second derivation of one fact, free to disagree with the sentence a
   * person reads on the card. ⛔ The item already encodes the half that matters — `refused` is a
   * card that is still answerable and `note` is one that is over — so this reads the item.
   *
   * Null on every ordinary row: nothing has bounced.
   */
  refused: string | null
}

/**
 * How a permission outcome reads on a button. The provider chooses which of these it offers.
 *
 * ⚠️ **Keyed by `PermissionDecision['outcome']`, so a new outcome does not compile until it has a
 * word here.** The enum lives in the runtime and the renderer sees it through the wire type; a
 * `Record` over it is what makes an unlabelled outcome a build error rather than a blank button.
 */
const OUTCOME_LABEL: Record<PermissionDecision['outcome'], string> = {
  // ⚑ 737 · the one spelling a server form's card now says too (`permission-offer.ts`' `ALLOW`).
  allow: ALLOW,
  // ⚑ The card's word too: one choice, named once.
  allow_for_session: ALLOW_FOR_THIS_CONVERSATION,
  allow_all_for_session: 'Allow all for this conversation',
  // ⚑ 739 · `736` F-1 — R95's *Always allow*, the word the card says too.
  allow_always: ALWAYS_ALLOW,
  deny: 'Deny',
  cancel: 'Cancel',
}

/**
 * ⛔ **What a click on this surface actually SENDS** (205 §2).
 *
 * ⚠️ **A pure function, and separate from the component, because the risk it removes is invisible in
 * markup.** The overview's rows describe conversations that are mostly NOT the one on screen, so a
 * handler that reached for `activeId` — which is what every other answer path in `RuntimeScreen`
 * legitimately does — would answer the wrong conversation and look completely correct doing it. The
 * session id comes off the ROW; this decides only what the payload is; and both halves are asserted.
 *
 * ⚑ **The wire shapes are the card's own.** A permission answer is the plain outcome, and a question
 * answer is `{kind:'answer', answers:{[questionId]: option}}` — the same `UserInputResponse` the card
 * builds, keyed by the neutral question id the request carried.
 *
 * ## 🔴 Every arm builds a FRESH value, and one of them did not (473, from `469`)
 *
 * ⛔ **What this returns crosses `ipcRenderer.invoke`, so *handed over* and *built here* are not a
 * matter of taste.** `createPersonsQueue` keeps its world in a deep `ref`, so an
 * `AttentionDecision` this function is handed has been through Vue's reactivity and every OBJECT on
 * it is a `Proxy`.
 * 🔴 **Electron cannot structured-clone one**: the permission arm returned `decision.decision` —
 * the nested object, by reference — and a person pressing **Deny** on a spawned child's card got a
 * rejection before `ipcMain` ever saw the call, on a screen that said the answer had landed.
 *
 * ⚑ **A primitive read off a `Proxy` is a primitive**, which is why the other four arms were never
 * wrong: each builds its own literal and every field it did not build is a string or a boolean.
 * ⛔ **So the permission arm now does what its neighbours do** — it reads the OUTCOME off the
 * decision and {@link permissionDecisionFor} writes the value, which is the same call
 * `PermissionCard` makes. ⚠️ **The proof is not this paragraph**:
 * `the-press-that-cloned-nothing.test.ts` §1 drives every arm out of a genuinely reactive queue
 * and carries each one over a real structured clone, with the raw decision as the control.
 */
export function answerFor(
  decision: AttentionDecision,
): { permission: PermissionDecision } | { userInput: UserInputResponse } {
  // 🔴 **473 · the outcome, not the object** — see the ⛔ paragraph above. ⚠️ `decision.decision` is
  // a `Proxy` whenever the caller is the person's queue, and `decision.decision.outcome` is a
  // string whoever the caller is.
  if (decision.kind === 'permission')
    return { permission: permissionDecisionFor(decision.decision.outcome) }
  if (decision.kind === 'reject') return { userInput: { kind: 'reject' } }
  // ⛔ **A grant approves with NO answers, and that is the card's own payload** (207 M1). It reads
  // like a decline — `userInputDecline` sends the same empty object — and the difference is the
  // request: for `item/permissions/requestApproval` the adapter maps an answer to `approved` and a
  // reject to `denied` (`userInputPayloadFor`). Which is exactly why it is not spelled as an
  // `answer` with an invented question id: an id nobody asked for would be sent as a real key.
  if (decision.kind === 'approve') return { userInput: { kind: 'answer', answers: {} } }
  return { userInput: { kind: 'answer', answers: { [decision.questionId]: decision.option } } }
}

/**
 * ⛔ **The order, and it is a choice rather than a default** (§3).
 *
 * **Oldest first.** At six rows you skim; at thirty you read the top two. Whatever is at the top has
 * to be the one that has already cost the most, and AGE is the only fact on the row that measures
 * cost-so-far — a permission that arrived four seconds ago has frozen nothing yet, and the PM's
 * 63-second session is the whole argument for the surface. Sorting by kind would put a fresh
 * permission above a question that has been blocking a turn for two minutes; sorting by conversation
 * would make the order depend on which one you opened first, which is not a fact about urgency.
 *
 * ⚠️ **A card with NO recorded time sorts LAST, not first.** An unknown age is not an old age, and
 * `??  0` would have silently promoted every clockless card to the top of the list — which is 086's
 * rule applied to a comparator.
 *
 * **Permission before question on a tie**, and only on a tie: a permission freezes the composer
 * (063) as well as the turn, so with two cards of the same age it is the one that has stopped more.
 *
 * ⛔ **The tie-break is a `Record` rather than a ternary** (446). ⚠️ *"permission first, otherwise
 * the other one"* is a rule that reads as total and stops being total the moment there is a third
 * kind, which would sort below a question and above one depending on which side of the comparison
 * it landed — a list that re-orders itself between two looks. See {@link URGENCY_OF_KIND}.
 */
/**
 * 🔴 **Where each kind sits when two rows are the same age** (446) — exhaustive over
 * {@link AttentionRequest.kind}, so a new kind does not compile until somebody has decided. ⚑ The
 * order is by HOW MUCH IS STOPPED: *"a permission freezes the composer as well as the turn, so it is
 * the one that has stopped more"*.
 */
const URGENCY_OF_KIND: Readonly<Record<AttentionRequest['kind'], number>> = {
  permission: 0,
  question: 1,
}

function byUrgency(a: AttentionRequest, b: AttentionRequest): number {
  if (a.at !== b.at) {
    if (a.at === null) return 1
    if (b.at === null) return -1
    return a.at - b.at
  }
  if (a.kind !== b.kind) return URGENCY_OF_KIND[a.kind] - URGENCY_OF_KIND[b.kind]
  return a.key < b.key ? -1 : 1
}

/**
 * Everything waiting on the user, across `records`, oldest first.
 *
 * `standingFor` is passed in rather than imported so this stays a pure function of its arguments and
 * the caller keeps ONE `facets` call per conversation — the rail already makes it, and computing it
 * twice per render is how the rail and the pane came to disagree in 099.
 *
 * 🔴 **712 · R41 (`707` GAP-5) — `nameOf` names an identity a row speaks of** (since `714` the one
 * the conversation runs as — {@link AttentionRequest.who}), and it is passed in for `standingFor`'s reason: the screen holds the
 * roster and asks `agentName` over it (`agentHeadingFor`). ⚠️ Absent — a caller with no roster —
 * the raw slug stands. ⛔ That is NOT `agentName(slug, null)`, which folds the slug and reads
 * BroBot's as *BroBot*; the one caller that draws this, `RuntimeScreen`, always passes the roster's.
 */
export function attentionQueue<Conversation extends ConversationWithCards>(
  records: readonly Conversation[],
  standingFor: (record: Conversation) => string,
  nameOf: (slug: string) => string = (slug) => slug,
): AttentionRequest[] {
  const queue: AttentionRequest[] = []
  for (const record of records) {
    const state = record.control
    // O(1), and the reason this scales: a quiet conversation is never walked.
    if (state.pending.permissions + state.pending.questions === 0) continue
    const standing = standingFor(record)
    // ⚑ **470 · one owner for the rule, the fallback still this surface's** — {@link whereItWorks}.
    const where = whereItWorks(record) ?? record.sessionId
    // ⚠️ **ONE walk of `items`, not one lookup per request.** `requestItems` maps a request id to an
    // item id and `itemById` resolves that with `items.find` — so iterating the map would be
    // `requests × items` per render, and the item already carries its own `request.id`. This is the
    // cost `sessionPanel` pays for the conversation on screen, paid here for each conversation that
    // is WAITING — which is the set that, by definition, has stopped producing events.
    for (const item of state.items) {
      if (item.kind !== 'permission' && item.kind !== 'userInput') continue
      if (!isAwaitingAnswer(item)) continue
      const requestId = item.request.id
      const common = {
        key: `${record.sessionId}:${requestId}`,
        sessionId: record.sessionId,
        requestId,
        itemId: item.id,
        where,
        provider: record.meta?.provider ?? null,
        profileId: record.meta?.profileId ?? null,
        who: record.meta?.profileId == null ? null : nameOf(record.meta.profileId),
        standing,
        at: item.at ?? null,
        // ⚠️ Reading `.sent` off the draft tracks that one property; a keystroke into the same
        // request's `answers` does not invalidate this projection. See {@link AttentionRequest.sent}.
        sent: record.requests.get(requestId)?.sent === true,
        // 🔴 **468 · the sentence the host sent back, on a card it left answerable.** ⚠️ Read off
        // the ITEM rather than looked up a second time: `markAnswerRefused` writes here, and
        // `isAwaitingAnswer` deliberately ignores the field — which is what keeps a bounced answer
        // in this queue instead of settling it.
        refused: item.refused,
        // 🔴 **Whether somebody other than this window can drive the conversation this card came
        // from** (349, HO-006 §4.5). ⛔ **Here because this is where the DECISION is made.** Info's
        // *other callers* row says it inside a conversation; a person answering from
        // *Waiting on you* never opens one, and *"an agent can give this conversation work, but not decide what
        // that work is allowed to do"* is a sentence about exactly this gesture. ⚠️ `=== true`
        // rather than `??`, because `meta` is null until the conversation has been disclosed and a
        // missing answer is not a person's problem to guess at.
        hasACommander: record.meta?.hasACommander === true,
        ...(item.routed === true ? { routed: true as const } : {}),
      }
      if (item.kind === 'permission') {
        const scope = item.request.scope
        // ⛔ **The row and the wholesale grant come from ONE function, and the card calls the same
        // one** (299 §1). This used to be `availableDecisions.map(…)` — every offered outcome, in
        // the provider's own order, each one a peer button — while `PermissionCard` filtered the
        // wide grant out of its row under a comment saying it must never be a peer. Two consumers of
        // one fact, and only one of them held the rule. See `permission-offer.ts`.
        // ⚑ 695 · R36b: the request's own marks, so a `defaultToNo` ask leads with its refusals here too.
        const offer = permissionOffer(scope.availableDecisions, item.request.action, item.request)
        // ⚑ 728 · a SERVER's card says what the server is told, here as on the card.
        const server = serversAskOf(item.request)
        // 🔴 739 · what the two standing buttons install, in the words the card says under them
        // (`726` F-14, `736` F-1) — carried on the decision, never sent.
        const covers = conversationGrantCovers(scope)
        const keeps = keptGrantOf(scope)
        // 🔴 **743 · `739` F-1, ruled by the PM — the wholesale grant is a one-click answer here
        // too** (*"a surface that offers the choices offers ALL of them"*): after the row, where the
        // card draws it below its own, under the card's warning (058), and the person's queue copies
        // it. ⛔ Until `743` this row said instead that the grant was not offered here (299 §1).
        // ⚑ 730 · R80 — the request's own marks, so Codex's MCP grant is warned of in R80's words.
        const call = item.request.mcpToolCall
        const wide: AttentionDecision | null =
          offer.wide === null
            ? null
            : {
                kind: 'permission',
                label: offer.wide.label,
                decision: permissionDecisionFor(offer.wide.outcome),
                warns: wideGrantWarning(item.request.action, item.request, common.provider),
                ...(call === undefined
                  ? {}
                  : { mcpToolCall: { server: call.server, tool: call.tool } }),
              }
        queue.push({
          ...common,
          kind: 'permission',
          // The provider's own sentence when it sent one — *"Claude wants to read foo.txt"* — and
          // the action otherwise. Never instead of the disclosure below, always beside it (071).
          asked: item.request.summary ?? item.request.action,
          scope: permissionScopeLines(item.request.detail, scope),
          actionLines: actionScopeLines(item.request.detail, scope).length,
          underDisclosed: scope.underDisclosed,
          detailOmitted: item.request.detailOmitted ?? null,
          decisions: offer.row.map((outcome) => ({
            kind: 'permission' as const,
            // ⚑ 730 · R80 — *Allow once* on the row Codex raised before an MCP tool runs.
            label:
              outcome === 'allow' && server?.opensALink === true
                ? I_OPENED_IT
                : outcome === 'allow' && item.request.mcpToolCall !== undefined
                  ? ALLOW_ONCE
                  : OUTCOME_LABEL[outcome],
            // ⛔ **No `updatedInput` and no deny `message`, ever, from here.** Both are edits to what
            // will run, and editing what you cannot see is the defect 071 exists to prevent. The
            // card is where a request gets rewritten; this surface only ever sends the plain outcome.
            //
            // ⚠️ **`permissionDecisionFor` rather than `{ outcome } as PermissionDecision`** (473).
            // The cast was the wrong answer that compiles: it asserts a shape instead of building
            // one, so the sentence above was true only for as long as nobody widened this literal.
            // ⚑ It is also the ONE producer `answerFor` sends, which is what lets
            // `the-press-that-cloned-nothing.test.ts` §4 walk the renderer for a second
            // construction of this payload rather than only the door it goes through.
            decision: permissionDecisionFor(outcome),
            // 🔴 **730 · R81 — this Cancel asks no turn to stop**, and the line under it says so
            // (`whatThisAnswerDoes`, the card's own function). ⚑ Never sent: `answerFor` builds
            // the payload from the outcome alone.
            ...(outcome === 'cancel' && item.request.cancelStopsNothing === true
              ? { stopsNothing: true as const }
              : {}),
            // ⚑ 728 · a SERVER's card says what the server is told, here as on the card.
            ...(server === undefined ? {} : { server }),
            ...(outcome === 'allow_for_session' && covers !== null ? { covers } : {}),
            ...(outcome === 'allow_always' && keeps !== null ? { keeps } : {}),
          })),
          limit: null,
          // 🔴 **487 · and why there is no way to allow it, when there is none.** ⛔ The card, this
          // row and the person's queue read ONE function for it — a surface that stayed silent
          // here while the card explained itself is HO-030 §2's *"trains the reader out of
          // looking"* on the sentence rather than on the button.
          noPositive: noWayToAllow(scope.noPositiveBecause, offer)?.says ?? null,
          ...markFields(whatTheMarksSay(item.request, offer, common.provider), offer),
          ...(item.request.agentReason
            ? { agentSays: inTheAgentsWords(common.who, item.request.agentReason) }
            : {}),
        })
        // ⚑ 743 · appended to the row just pushed rather than written into its `decisions`
        // expression, which mutation rows in five tables anchor on as literal text. ⚠️ "Never the
        // second button" rests on the row holding two answers before it — true of every producer
        // since 487's floor (Deny and Cancel always published); a replayed pre-487 row offering only
        // the grant and one refusal draws it second.
        if (wide !== null) queue.at(-1)?.decisions.push(wide)
        continue
      }
      const questions = item.request.questions
      const grant = item.request.permission
      // ⛔ **The decisions come from ONE function, and only the SCOPE branches** (214 §3).
      //
      // This used to decide for itself, and it decided differently from the card: `questions.length
      // === 0 && grant !== undefined` offered Approve, so a Codex grant was approvable here and a
      // Claude `ExitPlanMode` — no questions, no grant, because a plan is not a sandbox scope — fell
      // through to the limit table and came back *"carries no question and nothing to approve"*.
      // 213 read that sentence directly under *"asks you to approve its plan"*, with an Approve
      // button one click away inside the conversation.
      //
      // ⚑ **What the grant actually decides is what to DISCLOSE, not what to offer.** A grant has a
      // neutral scope shape; a plan has the request's own prompt. So the branch below is about
      // `scope` alone, and both arms take `decisions`, `limit` and the button's word from
      // `userInputOffer` — the same call `UserInputCard` makes.
      // ⚠️ **The whole request, since 478** — the offer decides what the Approve on a zero-question
      // card SAYS, and the two facts that answer it (`permission`, `consent`) are fields of the
      // request. ⛔ Handing it `questions` was how one sentence came to cover three effects.
      const offer = userInputOffer(item.request)
      const only = questions.length === 1 ? questions[0] : undefined
      queue.push({
        ...common,
        kind: 'question',
        asked: only?.prompt ?? item.request.prompt,
        scope:
          grant !== undefined
            ? grantScopeLines(grant)
            : questionScopeLines(item.request.prompt, only?.prompt),
        // ⚑ **False for a REASON here, not by omission.** `codexUserPermission` fails the request
        // closed when it cannot represent a shape truthfully (039) — so a grant that reaches this
        // surface at all is one whose scope is whole — and a question has no neutral scope shape to
        // be short of; it is what it says. There is no bounded-detail cap on either, so there is
        // nothing for `detailOmitted` to count.
        underDisclosed: false,
        detailOmitted: null,
        // ⚑ Null for the same reason: a question has no permission outcomes to be short of.
        noPositive: null,
        decisions: offer.decisions,
        limit: offer.limit,
        ...(grant?.agentReason
          ? { agentSays: inTheAgentsWords(common.who, grant.agentReason) }
          : {}),
      })
    }
  }
  return queue.sort(byUrgency)
}

/** Said where a request is broader than its card can show. */
export const BROADER_THAN_SHOWN =
  'This request is broader than what is shown — the provider described it in a way BroCrew cannot fully represent.'

/** Said after {@link BROADER_THAN_SHOWN} on a request that can be allowed. */
export const OPEN_IT_BEFORE_YOU_ALLOW_IT = 'Open it before you allow it.'

/** Said where a request's disclosure was cut at its bound. */
export function charactersNotShown(count: number): string {
  return `${String(count)} more characters of this are not shown here.`
}

/** What {@link attentionQueue} reads off a conversation. */
export interface ConversationWithCards {
  readonly sessionId: string
  readonly meta: Partial<
    Pick<CreatedSession, 'provider' | 'profileId' | 'cwd' | 'hasACommander'>
  > | null
  readonly control: TranscriptState
  readonly requests: ReadonlyMap<string, { readonly sent: boolean }>
}

/**
 * The row for a request in a conversation this window does not hold, from the card the host read
 * in its record: {@link attentionQueue} over a conversation holding that one card, so it offers
 * what the card offers, in the card's words. `sent` while an answer from here is on its way;
 * `refused` the words the last one came back with.
 */
export function attentionToACardNobodyHolds(
  sessionId: string,
  card: CardNobodyHolds,
  press: { readonly sent: boolean; readonly refused: string | null },
  nameOf: (slug: string) => string,
): AttentionRequest | undefined {
  const control = createTranscript()
  applyEvent(control, card.asked)
  if (press.refused !== null) markAnswerRefused(control, card.asked.id, press.refused)
  const conversation: ConversationWithCards = {
    sessionId,
    meta: { provider: card.provider, profileId: card.profileId },
    control,
    requests: new Map([[card.asked.id, { sent: press.sent }]]),
  }
  const standing =
    NEEDING_WORD[card.asked.type === 'permission_request' ? 'permission' : 'question']
  return attentionQueue([conversation], () => standing, nameOf)[0]
}

/**
 * ⚑ **D-017 · R19 — the cards on this window's conversations that no host read lists** — all that
 * *Waiting on you* and its counts take from what this window holds.
 *
 * ⛔ **A routed card is its parent's to answer, or the person's queue lists it** from the host's read
 * over every conversation — so counting it here would put a parent's question on a person's list,
 * or one request on it twice. ⚑ Since D-017 a card in a
 * conversation nobody spawned is routed too — to a person — so it is counted once, from the host's
 * read, whichever window is open. ⚑ What is left is a card this app never routed: one raised before
 * that, or a degraded event no route reads.
 */
export function listedNowhereElse(requests: readonly AttentionRequest[]): AttentionRequest[] {
  return requests.filter((request) => request.routed !== true)
}

/**
 * 🔴 **Every `sessionId:requestId` this window has sent an answer for and not had put back**
 * (468) — the one fact that separates *the card here was answered* from *the card here was never
 * in this page*. See `PersonsQueueWorld.answeredFromHere`.
 *
 * ## ⛔ Why it lives here and not in `RuntimeScreen.vue`
 *
 * ⚑ **`isAwaitingAnswer`'s own reason, one file over**: *"it is a rule about the fold, and a rule
 * written inside a `.vue` file is a rule that can only be tested by rendering one."* ⚠️ The first
 * draft of this WAS a computed in the screen, and the only instrument that could have reached it
 * was a census over the file's text — which pins a line rather than a behaviour.
 *
 * ## ⚠️ It is a READ of the drafts, and that is the whole of why it is allowed
 *
 * ⛔ **`record.requests` is the session's own draft map**, and the field is `RequestDraft.answered`
 * rather than the `sent` {@link AttentionRequest.sent} carries. ⚠️ **The first draft of this read
 * `sent` and this dispatch's own review caught it**: `sent` is `064`'s in-flight guard and
 * `noteAnswer` takes it off on EVERY failure — including the refusals that also CLOSE the card
 * (`not-pending` and `not-offered`; ⚠️ **an unclassified fault was on this list until `473` and is
 * not a closing refusal any more**) — so
 * exactly the cards that are over dropped out of this set and went back to reading *"open it to
 * answer"*, which is the sentence `468` exists to retire.
 *
 * ⚑ **A dismissed-list would be a second opinion about what is closed** — `persons-queue.ts` says
 * so three times — and this is not one: it says what this window SENT, never what the ledger did
 * with it, and no row leaves the queue because of it. ⛔ **It is not consulted while the live
 * request is still there**, so a refusal that leaves a card answerable is unaffected: that row has
 * its buttons back and its reason beside them, from {@link AttentionRequest.refused}.
 *
 * ⚠️ **Drafts and not items, and the difference is a gate.** {@link attentionQueue} walks
 * transcripts under an `O(1)` skip — *"a quiet conversation is never walked"* — and a settled
 * conversation has `pending` zero, which is exactly the population this needs; so the walk it
 * would have reused is the walk it cannot. The draft maps hold one entry per request a person has
 * touched.
 *
 * ⛔ **`get`-free**: this iterates what is there and creates nothing, for {@link
 * AttentionRequest.sent}'s reason — a projection that wrote into the record it projects grows the
 * map once per render.
 */
export function answeredFromHere(records: readonly SessionRecord[]): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const record of records) {
    for (const [requestId, draft] of record.requests) {
      if (draft.answered) keys.add(`${record.sessionId}:${requestId}`)
    }
  }
  return keys
}

/**
 * What approving would authorize, as lines.
 *
 * The disclosure itself comes first because it is the thing Allow returns for; everything after it
 * is the neutral scope the adapters build beside it (014). Empty fields are dropped rather than
 * rendered as "none" — a row that lists what a request does NOT touch is the paragraph 031 warns
 * about, and absence here is not a claim.
 */
function permissionScopeLines(
  detail: string,
  scope: {
    cwd?: string
    paths: readonly string[]
    networkHosts: readonly string[]
    persistence: 'once' | 'session' | 'always'
    grantRoot?: string
    amendments: readonly { kind: string; detail: string }[]
    availableDecisions?: readonly string[]
    grants?: PermissionRequestEvent['scope']['grants']
  },
): string[] {
  const lines = actionScopeLines(detail, scope)
  // Only worth a line when it widens: `once` is the ordinary case and saying so on every row is
  // noise, while a conversation grant is the whole difference between one action and a standing one.
  // ⚑ 739 · and where the summary is `always` — R95's *Always allow*, drawn since `739`, which
  // has its own line below — only where a conversation grant is offered beside it (what `736`'s
  // `drawnPersistence` said, until `739` drew *Always allow* too). A row summarised `session` keeps
  // the line as it always had it.
  if (
    scope.persistence === 'session' ||
    (scope.persistence === 'always' &&
      (scope.availableDecisions ?? []).some(
        (one) => one === 'allow_for_session' || one === 'allow_all_for_session',
      ))
  ) {
    lines.push('for the whole conversation, not just this action')
  }
  // 🔴 736 · R94 — and what the conversation grant installs, in words ({@link conversationGrantSaid}).
  const covers = conversationGrantSaid(scope)
  if (covers !== null) lines.push(covers)
  // 🔴 739 · `736` F-1 — and what *Always allow* keeps, and where ({@link keptGrantSaid}).
  const kept = keptGrantSaid(keptGrantOf(scope))
  if (kept !== null) lines.push(kept)
  // ⛔ 697: it said *"also changes future exec: …"* — false. The provider PROPOSED it, and applies
  // one only on an answer that chooses it — since `739`, on a card that draws *Always allow* with
  // Codex's own prefix rule, that answer keeps a rule for future commands, and the kept line above
  // says which (Codex's offered rule, echoed verbatim — not rebuilt from this proposal).
  const keepsARule = (scope.grants?.allow_always ?? []).some(
    (rule) => rule.kind === 'command-prefix',
  )
  for (const amendment of scope.amendments) {
    if (keepsARule && amendment.kind === 'exec') {
      lines.push(
        `proposed for future ${amendment.kind}: ${amendment.detail} — only ${ALWAYS_ALLOW} keeps a rule here, the one said above`,
      )
      continue
    }
    lines.push(
      `proposed for future ${amendment.kind}, not applied by any answer here: ${amendment.detail}`,
    )
  }
  return lines
}

/** The first lines of {@link permissionScopeLines}: this one action, before anything a grant adds. */
function actionScopeLines(
  detail: string,
  scope: {
    cwd?: string
    paths: readonly string[]
    networkHosts: readonly string[]
    grantRoot?: string
  },
): string[] {
  const lines: string[] = []
  if (detail !== '') lines.push(detail)
  if (scope.cwd !== undefined && scope.cwd !== '') lines.push(`in ${scope.cwd}`)
  if (scope.paths.length > 0) lines.push(`paths: ${scope.paths.join(', ')}`)
  if (scope.networkHosts.length > 0) lines.push(`network: ${scope.networkHosts.join(', ')}`)
  if (scope.grantRoot !== undefined && scope.grantRoot !== '') {
    lines.push(`grants write under ${scope.grantRoot}`)
  }
  return lines
}

/** The request's own prompt, when it is not already the heading. */
function questionScopeLines(prompt: string, heading: string | undefined): string[] {
  return heading === undefined || heading === prompt || prompt === '' ? [] : [prompt]
}

/**
 * What a GRANT would authorize, in the same words a permission row uses (207 M1).
 *
 * ⚠️ **The neutral shapes differ and the vocabulary must not.** A `permission_request` carries
 * `networkHosts: string[]`; a grant carries `network: boolean`, because Codex's approval asks for
 * network access without naming a host. Two rows describing the same kind of consequence in two
 * dialects is the disagreement this whole projection exists to prevent, so the prefixes are shared
 * and only the network line says less — which is all the request said.
 *
 * ⚑ **Every path, and no summarising.** `permission.paths` is already access-labelled by the adapter
 * (`"write /work/out"`, `"read glob:**\/*.ts"`, `"restrict …"` for a sandbox DENY) precisely so a UI
 * can show what a positive decision grants; dropping any of them here would be the under-disclosure
 * the adapter fails closed to avoid.
 */
function grantScopeLines(grant: {
  cwd?: string
  reason?: string
  paths: readonly string[]
  network: boolean
}): string[] {
  const lines: string[] = []
  if (grant.reason !== undefined && grant.reason !== '') lines.push(grant.reason)
  if (grant.cwd !== undefined && grant.cwd !== '') lines.push(`in ${grant.cwd}`)
  if (grant.paths.length > 0) lines.push(`paths: ${grant.paths.join(', ')}`)
  if (grant.network) lines.push('network: access requested, without naming a host')
  return lines
}
