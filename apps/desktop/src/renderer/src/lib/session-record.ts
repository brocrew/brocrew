import type {
  CreatedSession,
  HistoryWindow,
  PersistedEventInfo,
  RuntimeEventMessage,
  SessionLiveness,
} from '../../../shared/runtime-ipc'
import { agentName, HELD_ELSEWHERE, providerName } from '../../../shared/runtime-ipc'
import type { AgentIdentity } from '../../../shared/runtime-ipc'
import {
  mergeProviderBlock,
  mergeHeldMessages,
  type ProviderBlockFacts,
} from './provider-limit-status'
import { openingLine } from './opening-line'
import { basenameOf } from './paths'
import { applyEvent, createTranscript, type TranscriptState } from './transcript'
import { copyHumanAnswers } from './human-answers'
import {
  WINDOW_MAX_EVENTS,
  appendLive,
  carryForward,
  createWindow,
  foldWindow,
  liveDisposition,
  openAt,
  prependPage,
  tailWindow,
  type WindowState,
} from './transcript-window'

/**
 * One session's renderer state, and the rules for feeding it.
 *
 * Plain TypeScript on purpose — no Vue. The store wraps these in `reactive()`, but everything
 * that decides what a session looks like lives here, where it can be driven directly by a test
 * without a component, a DOM, or a bridge.
 *
 * Every session gets its own record. That is the whole difference from the single-session
 * composable this replaces: the host has always been multi-session, and a renderer that could
 * only hold one session is what made a second one "already open" instead of just another chat.
 */

/**
 * Where a session is in its life, from the renderer's point of view.
 *
 *  - `opening` — events may already be arriving, but the host has not yet told us what this
 *    session IS. They are held, not dropped.
 *  - `open` — live, and the only state a message can be sent in.
 *  - `closing` — we have asked the host to close it and the ending has not landed yet (089). It is
 *    still in the open list, because it is still open; what has changed is that we know it is on
 *    its way out. ⚠️ **This is the renderer's own statement, and it has to be** — the host tracks
 *    the same window on `SlotPhase` but that field is on no wire, and `LivenessState` says `live`
 *    for the whole teardown. 064 settled the principle on the way in: the fact is ours to state,
 *    and waiting for the provider to announce itself leaves the surface stale for as long as it
 *    stays quiet. This is the same fact on the way out.
 *  - `recorded` — ⚑ **D-017b** — drawn from its ledger, and this window is not fed its events: nothing
 *    runs it here (it stopped, or it runs somewhere this window does not hold). ⚑ It is drawn in the
 *    same full view as an open one, and a message sent from it continues it
 *    (`SessionStore.startAndSend`). A live record reaches it when its fold ends.
 */
export type SessionPhase = 'opening' | 'open' | 'closing' | 'recorded'

/**
 * What the person has done with a card that the ledger does not know about yet (061 finding 8).
 *
 * All three used to be `ref`s inside the card component, which made them properties of a COMPONENT
 * INSTANCE rather than of the request. Every re-fold rebuilds the item list, Vue remounts whatever
 * it can no longer match, and a half-typed answer, an expanded disclosure and — worst — the flag
 * that stops a second decision racing the first all went with it. 061: *"loading older history or
 * releasing a slab remounts existing interactive cards, discards typed answers, resets disclosure,
 * and can make an already-submitted permission decision clickable again."*
 *
 * Keyed by the PROVIDER's request id, which is the one name for this request that survives a
 * re-fold, a window move, and the card leaving the screen entirely and coming back.
 */
export interface RequestDraft {
  /**
   * Answers typed or chosen but not yet sent, by question id.
   *
   * ⚑ **`string[]` for a multi-select question** (139) — the same union the neutral answer contract
   * has carried since 033, held here so that a half-made multi-select choice survives a re-fold
   * exactly as a half-typed one does. A single-select question and a free-form field still hold a
   * plain string, and the card sends one: the union is what the QUESTION is, not a widening of every
   * answer.
   *
   * ⛔ **A `Map`, because the keys are the PROVIDER'S** (146, from 145 HIGH 2). A question id is an
   * unrestricted string on both wires, so `__proto__` is a legal one, and an object cannot hold it:
   *
   *  - `answers['__proto__'] = value` on an ordinary object sets the PROTOTYPE and stores nothing.
   *  - `Object.create(null)` fixes the write — and does not fix the card, because
   *    `@vue/reactivity`'s `isNonTrackableKeys` is `__proto__,__v_isRef,__isVue`. **Vue refuses to
   *    track that key by NAME**, whatever the prototype is. Measured on 3.5.40: the value lands,
   *    the render effect never re-runs, so the chip never lights and Answer never enables. A
   *    question the user can click forever and never answer.
   *  - A reactive `Map` tracks it like any other key, because the collection handlers key their
   *    deps off the argument rather than off a property name.
   *
   * ⚑ **Affordable here precisely because this map never leaves the renderer.** The answer that
   * crosses IPC and reaches a provider is built fresh in `UserInputCard.answer()` and is a
   * null-prototype OBJECT — a `Map` survives neither Electron's `contextBridge` nor
   * `JSON.stringify`. Two representations, each measured against the boundary it has to cross.
   */
  answers: Map<string, string | string[]>
  /**
   * A response for this request has been handed to the store.
   *
   * ⚠️ **Written by the store, never by the card.** It is a fact about the session — a response is
   * on its way — and the card only reads it. That is what makes it impossible for a re-fold to
   * offer an already-submitted decision again: the guard no longer lives in the thing being rebuilt.
   */
  sent: boolean
  /**
   * 🔴 **This window SENT an answer for this request, and it was not put back** (468, UI-009).
   *
   * ⛔ **Not {@link sent}, and the difference is what each one is for.** `sent` is `064`'s in-flight
   * GUARD: it comes off the moment the host answers, because a card the host refused is a card a
   * person may press again and a permanently dead button with no reason on it is the failure that
   * fix exists to prevent. ⚠️ This is a different question — *did this window act on this request*
   * — and its answer does not change when the act fails in a way that closes the card.
   *
   * ⚑ **`answeredFromHere` reads THIS**, so the person's queue can tell *the card here is settled*
   * from *the card here was never in the page this window holds*. ⛔ Reading `sent` instead left
   * every refusal that CLOSES a card — `not-pending` and `not-offered` (⚠️ **an unclassified fault
   * left this list at `473`**: it is a call that never reached the host, so the card stays live) —
   * drawing *"open it to answer"* over a card that is over, which is the retired sentence `468`
   * exists to remove.
   *
   * ⚠️ **Cleared only by a refusal that leaves the card OPEN** (`noteAnswer`, UI-009) — that
   * request was put back on the table, so nothing here acted on it, and *Waiting on you* offers it
   * again beside the card that does. ⚑ Otherwise it stands: a request id is answered once, and this
   * window's draft map is reset wholesale when a conversation is reopened — which is exactly
   * right: a reopened conversation has been answered by nobody in this window.
   */
  answered: boolean
  /** A settled card is showing its whole self (034). */
  open: boolean
}

export interface SessionRecord {
  readonly sessionId: string
  /** What the host said this session is; null until it says. */
  meta: CreatedSession | null
  earlyProviderBlock?: ProviderBlockFacts
  /**
   * The fold the READER is looking at — the movable window (054).
   *
   * ⚠️ **This is a view of history and nothing more.** Everything that decides what the session
   * can be told to do next reads {@link control}. They are the same object for every ordinary
   * moment of a conversation; see there for when and why they come apart.
   */
  transcript: TranscriptState
  /**
   * The fold that says what this session IS, right now (061 finding 5).
   *
   * ⚠️ **The SAME object as {@link transcript} while the window holds the tail** — which is every
   * ordinary moment, including the whole of a session nobody scrolls back in. Not a copy kept in
   * step: literally the same state, so there is no second fold to pay for and no way for the two to
   * disagree.
   *
   * They come apart at exactly one moment: a reader pages back far enough that the window releases
   * the newest events. Before 064 the live events that arrived after that were counted and dropped,
   * and the header, the composer, the panel badge and the send/interrupt choice all went on reading
   * a fold of *old history* as though it were the present. 061's list of what that costs: *"a
   * permission or user-input card can disappear from effective state, the composer can unfreeze, a
   * provider-ended session can remain open, and send can call the wrong bridge operation."*
   *
   * So while the reader is away, this keeps folding the live tail — through the same
   * {@link applyEvent}, over the events {@link tail} holds. **One exhaustive fold, two projections**
   * (048 §3, restated by 061); there is no second event switch anywhere.
   */
  control: TranscriptState
  /**
   * The live tail, held ONLY while the reading window is away from it; `null` when the two
   * projections are one object.
   *
   * `tail === null` is exactly `window.atTail`, and that is by construction rather than by
   * agreement: `atTail` goes false in one place ({@link prependOlder}, via `prependPage`) and true
   * in one place ({@link reopenAtLatest}), and this is set and cleared in the same two.
   */
  tail: WindowState | null
  /**
   * The ordinal this session's CURRENT life begins at, or null if it was never reopened (064).
   *
   * The resume epoch, and the reason it lives on the record rather than being applied once to a
   * transcript: every re-fold rebuilds the state from raw events, and raw events say the session
   * ended — because it did, before it was resumed. One value here, read by one helper
   * ({@link refold}), is what stops a prepend, a release or a jump resurrecting that ending.
   */
  liveFrom: number | null
  /**
   * ⛔ **What this conversation was opened with, in one line — or `null` when we cannot say** (211
   * §3, from 210 finding 4).
   *
   * The one fact that tells two conversations sharing a profile AND a folder apart; see
   * {@link openingLine} for why it is the first message rather than an age or a session suffix.
   *
   * ⚑ **Captured ONCE, in {@link acceptEvent}, and never revised.** Not derived from
   * `transcript.items` on demand, for two reasons that are really the same one: a reader who pages
   * back is looking at a window whose first `user` row is not the conversation's first, and a live
   * conversation long enough to release a slab loses its own beginning out of the front of the
   * array. Deriving it would make the row's identity change under the reader, or name the
   * conversation after the oldest message it happens to be holding — which is `086` in the place
   * this whole ticket is about.
   *
   * ⛔ **`null` is a REFUSAL and never a fallback.** It is what a session reopened part-way through a
   * long ledger honestly has: the beginning was never loaded, so nothing here knows it. The row then
   * says what it always said and no more. A "title" taken from whatever was loaded would look
   * exactly like a real one.
   */
  opening: string | null
  /**
   * What has been typed into, expanded on, or answered for each open request (061 finding 8).
   *
   * ⛔ **A `Map`, because the key is the PROVIDER's request id** (150, from 148 H3). Claude passes
   * the SDK's `toolUseID` through untouched — typed only as `string` — so `__proto__`,
   * `constructor`, `toString` and `hasOwnProperty` are all ids it may legally send, and on an
   * ordinary object every one of them reads back truthy without ever having been stored.
   *
   * ⚠️ **`Object.create(null)` was measured and rejected one layer down, and the measurement
   * applies here too** (146, `RequestDraft.answers`): `@vue/reactivity` lists `__proto__` in
   * `isNonTrackableKeys`, so it refuses to track that key BY NAME whatever the prototype is — the
   * value lands and the screen does not move. A reactive `Map` tracks it like any other key.
   */
  requests: Map<string, RequestDraft>
  /**
   * The slice of the ledger this session is showing (054) — its events, and where they sit.
   *
   * `window.entries` is ONE array serving two purposes, deliberately. It was `record.events`, the
   * debug drawer's raw stream, and it was never released — which made it the single largest thing a
   * reopened session retained: measured at 317 MB of structured-clone for a 500-turn conversation,
   * held for the life of the window. Making the drawer's array BE the window means the bound that
   * keeps the conversation small is the same bound that keeps this small, and there is no second
   * copy to forget to bound.
   */
  window: WindowState
  /** The next ordinal expected on this session's stream; a mismatch is reported, not hidden. */
  nextOrdinal: number
  /**
   * 🔴 **Which ordinals this window has NOT seen — the set {@link nextOrdinal} is not** (623,
   * `HO-095` §2).
   *
   * ⚠️ **`nextOrdinal` is the highest seen plus one, and {@link acceptEvent}'s own note has said so
   * since `320`:** *"not a set of what arrived"*. ⛔ **So it can say a hole OPENED and it can never
   * say one CLOSED** — which is the whole of `HO-095`'s first question. The PO read *"expected
   * ordinal 486, got 487"* and asked *was an event lost, or did the numbering skip*, and the notice
   * that produced it cannot answer either: it is true at the instant it is written and nothing ever
   * revisits it. ⚑ **This is the set, so a late arrival can take its own sentence back.**
   *
   * ⛔ **BOUNDED, and the bound is on the LIST rather than on the fact** — see
   * {@link MOST_MISSING_ORDINALS_TRACKED}. A window handed ordinal 40,000 as its first event must
   * not allocate forty thousand numbers to say *a lot is missing*, and it must not stop counting
   * either: {@link missingBeyondTheList} carries what the list declined to hold.
   */
  missing: Set<number>
  /**
   * ⚠️ **How many missing ordinals {@link missing} declined to list**, because the list is capped.
   *
   * ⚑ **It is a COUNT and never a claim about WHICH**, which is what keeps the weaker sentence
   * available: a window in this state can still say how much it is short by, and can never say a
   * late arrival closed the last hole — because it does not know which holes it has.
   */
  missingBeyondTheList: number
  /**
   * At least one command for THIS session is in flight — ⚑ since `737` (`730` F-7) lowered by the
   * last of them to settle, never by the first (`session-store.ts`' `commandsInFlight`) — 🔴 and
   * since `739` (`737` F-6) no longer counting one that has had no answer for
   * `A_COMMAND_IS_WAITED_ON_MS`: see {@link unanswered}.
   */
  busy: boolean
  /** The last failure from a command for this session. */
  error: string | null
  /**
   * 🔴 **739 · `737` F-6 — how many of this session's commands have had no answer for
   * `A_COMMAND_IS_WAITED_ON_MS`** and stopped holding {@link busy} up. ⚑ Counted down by each one's
   * own late answer, success or failure (a failure's sentence is then {@link error}), and only by a
   * command its bound released — so never below zero. While above zero the pane says so
   * (`A_COMMAND_HAS_NOT_ANSWERED`): the buttons it held dark are lit again, and a person is told why.
   */
  unanswered: number
  phase: SessionPhase
  /**
   * Events that arrived before the host resolved what this session is. Per record, not shared:
   * the old single-session code cleared one global buffer on every reset, which with two
   * sessions starting at once would have thrown away the other one's opening events.
   */
  earlyEvents: RuntimeEventMessage[]
  /**
   * 🔴 **A hand-over for this session is in the air, so live events must WAIT** (242 §3, from 239).
   *
   * ⛔ **`meta !== null` was the routing test, and a reopened conversation has `meta`** — it is the
   * record the previous life left behind. So the events the new life emitted between the host's
   * `register` and the answer arriving here were folded into a transcript {@link openWindow} was
   * about to clear, and the page it replaced them with ends BEFORE them. ⚠️ **Measured: three
   * events per Codex reopen, gone, and the next one reported as *"event stream gap: expected
   * ordinal 108, got 111"* in the middle of the conversation.**
   *
   * ⚑ **The buffer that fixes it already existed.** {@link earlyEvents} plus {@link adoptSession}'s
   * drain — ordinals below `nextOrdinal` skipped, so an event that is also in the replayed page
   * cannot be folded twice — is exactly this problem, solved, for the one case where the record had
   * no `meta` yet. This is what makes a reopen take the same road.
   *
   * ⛔ **A COUNT, not a boolean, and that is a defect found by an adversarial pass over this diff.**
   * Two reopens of one session are reachable — `store.resume` is wired to `@reopen` from both the
   * side rail and the session library, and their re-entrancy guards are separate per-component maps
   * that do not consult each other. As a boolean, the second press's `finally` lowered the flag
   * while the FIRST was still waiting on the provider, and every event from that moment was folded
   * into the transcript `replayInto` was about to clear — 242 §3's defect, reintroduced by 242 §3's
   * fix. ⚠️ **Nothing is buffered until every hand-over in flight has let go.**
   */
  handover: number
  /** Only the latest matters — this is a state, not a log. */
  earlyLiveness: SessionLiveness | null
}

/**
 * 🔴 **WHERE a conversation is working, or `null` — this app holds no path for it** (470, from
 * `449`).
 *
 * ⛔ **One owner, because there were three.** `SideRail.placeOf`, `attention.ts`'s `where` and
 * `470`'s own offer row each wrote `basenameOf(record.meta?.cwd ?? '') || null` out in full, and
 * each was pinned by its own mutation row — so a change to the rule would have gone red in one
 * place and stayed silent in the other two. ⚠️ Counted by review, in the dispatch that added the
 * third.
 *
 * ⚑ **The FALLBACK stays at the call site**, because it differs and the difference is the point:
 * the rail draws one fewer thing rather than an empty separator (`449`), the attention queue and
 * the grant sheet fall back to the session id. ⛔ `conversation-list.ts` is deliberately not a
 * caller — it derives from a host row and has no `SessionRecord` to hand.
 */
export function whereItWorks(record: {
  readonly meta: { readonly cwd?: string } | null
}): string | null {
  return theFolderOf(record.meta?.cwd)
}

/**
 * ⚑ **The same rule, for a caller that holds a CWD and not a record** (631).
 *
 * ⛔ **Added rather than copied.** The docblock above this pair exists because three call sites
 * each wrote `basenameOf(cwd) || null` out in full and a change would have gone red in one and
 * stayed silent in two. ⚠️ `SessionDrawer` holds a `CreatedSession`, which carries `cwd` and no
 * record — so it needs an entry point, not a fourth copy.
 */
export function theFolderOf(cwd: string | null | undefined): string | null {
  return basenameOf(cwd ?? '') || null
}

/**
 * ⚑ **D-017b · the identity a conversation runs as — its profile — or `null` for one this app ran
 * as nobody** ({@link CreatedSession.ranAsNobody}): a person's own conversation found in their
 * provider folder, or one restored from a bundle. ⛔ Never `default` for those: that would invent an
 * identity (154), and a model list or a profile line would then be about an agent nobody ran.
 */
export function profileItRunsAs(meta: CreatedSession | null): string | null {
  if (meta === null || meta.ranAsNobody !== undefined) return null
  return meta.profileId
}

/**
 * ⚑ **D-017b · who is in a conversation, by name** — its agent's name ({@link agentName}), or for
 * one this app ran as nobody, its provider's: a person's own Claude conversation is Claude's, and
 * calling it BroBot would invent an identity (154).
 */
export function whoIsIn(meta: CreatedSession, identities: readonly AgentIdentity[] | null): string {
  const profile = profileItRunsAs(meta)
  return profile === null ? providerName(meta.provider) : agentName(profile, identities)
}

/**
 * ⚑ **D-017b · where a conversation this app ran as nobody came from**, in the library's words
 * (`ResumableSessions`' unresumable rows), or `null` for one of ours — a surface that says *agent:*
 * of ours says this of the others.
 */
export function whereItCameFrom(meta: CreatedSession): string | null {
  if (meta.ranAsNobody === 'bundle') return 'from a bundle'
  if (meta.ranAsNobody === 'user-home') return `from ${providerName(meta.provider)}'s own folder`
  return null
}

/** ⚑ **D-017b** — see {@link turnsTakenWithoutThisWindow}. */
export type TakenWithoutThisWindow = 'by-another-window' | 'by-no-window'

/**
 * ⚑ **D-017b · a conversation this window draws from its ledger while its turns are taken without
 * this window** — by another window (the host said so: {@link HELD_ELSEWHERE}), or by none since a
 * hand-back — or `null`: it is fed here, or its next message is what continues it.
 *
 * ⚑ **Read off the host's recorded hand-over**, which carries no `liveFrom` for such a conversation:
 * there is nothing to settle, because its page is the present. ⚠️ A record its own fold moved to
 * `recorded` still holds the last life's `meta` until it is looked at again, and that stop is not a
 * turn taken elsewhere — so only a `recorded` hand-over answers.
 *
 * ⚑ **What it changes on screen**: its cards are answered by whichever window holds it, a message
 * held in it goes when its turn ends and not with the next message, and nothing set here reaches it.
 */
export function turnsTakenWithoutThisWindow(record: SessionRecord): TakenWithoutThisWindow | null {
  const meta = record.meta
  if (record.phase !== 'recorded' || meta === null) return null
  if (meta.cannotTakeAMessage === HELD_ELSEWHERE) return 'by-another-window'
  if (!('handover' in meta) || meta.handover !== 'recorded') return null
  return record.liveFrom === null ? 'by-no-window' : null
}

export function createSessionRecord(sessionId: string): SessionRecord {
  // ONE state, held twice. A fresh session is at its own tail by definition, so the reading
  // projection and the control projection start out as the same object — which is the ordinary
  // case and stays the case until somebody scrolls back past a slab.
  const transcript = createTranscript()
  return {
    sessionId,
    meta: null,
    transcript,
    control: transcript,
    tail: null,
    liveFrom: null,
    opening: null,
    requests: new Map(),
    window: createWindow(),
    nextOrdinal: 0,
    missing: new Set(),
    missingBeyondTheList: 0,
    busy: false,
    error: null,
    unanswered: 0,
    phase: 'opening',
    earlyEvents: [],
    handover: 0,
    earlyLiveness: null,
  }
}

/**
 * Re-fold a run of events for THIS session — the one door every re-fold goes through (064).
 *
 * There is nothing to it but {@link foldWindow} plus the session's own resume epoch, and that is
 * the point: the epoch is a property of the session, the re-fold happens in four places, and three
 * of them used to forget. A helper cannot be forgotten in the same way, because forgetting it means
 * writing `foldWindow` by hand where a test is looking for it.
 *
 * ## `carryFrom` — what a RELEASE must not reconstruct from nothing (068 finding 4)
 *
 * `entries` is the whole story only when it is the whole of the session's current life. A release
 * makes it a SUFFIX, and a fold of a suffix begins at `idle`, `ref:null`, `ended:false` with no open
 * requests — so 068 found the app resetting current lifecycle and request truth every time a
 * bounded window let go of a slab.
 *
 * Passing the outgoing state here says "these entries are a suffix, and this is what came before
 * it"; see {@link carryForward} for exactly which facts survive and why the item indexes are not
 * among them. Omitting it says "these entries are the whole story", which is what a fold of pure
 * HISTORY is — the reading projection after a prepend that released the tail is a view of old
 * events, and seeding it with the present would be the mirror of the bug being fixed.
 *
 * ⚑ **D-035 · `toolsInForce`** — the page's own tool inventory where `entries` begin, from a caller
 * that has just set the window's start from that page ({@link foldWindow}).
 */
export function refold(
  record: SessionRecord,
  entries: readonly RuntimeEventMessage[],
  carryFrom: TranscriptState | null = null,
  toolsInForce: PersistedEventInfo | null = null,
): TranscriptState {
  const carry = carryFrom === null ? null : carryForward(carryFrom, entries)
  return foldWindow(entries, record.liveFrom, carry, toolsInForce)
}

/**
 * The draft for a request, made on first sight.
 *
 * Made lazily rather than at fold time because the fold has no record to write to — it is a pure
 * function of events, and keeping it that way is what lets the read-only pane use it. The card asks
 * for its draft when it renders, and a request nobody ever looked at costs nothing.
 */
export function requestDraft(record: SessionRecord, requestId: string): RequestDraft {
  // ⛔ **This lookup used to trust anything truthy, and the key is the provider's** (150, 148 H3).
  // `record.requests['__proto__']` returned `Object.prototype`; `constructor`/`toString`/
  // `hasOwnProperty` returned the inherited FUNCTION. Each is truthy, so each was handed back as a
  // draft: `UserInputCard` calls `draft.answers.get(...)` on something with no `answers` and throws
  // during render, and `PermissionCard`'s click writes `draft.sent = true` onto `Object.prototype`
  // itself — poisoning every draft in the app. A `Map` has no inherited entries to find.
  const existing = record.requests.get(requestId)
  if (existing) return existing
  // A `Map` is load-bearing — see {@link RequestDraft.answers} (146).
  record.requests.set(requestId, {
    answers: new Map(),
    sent: false,
    answered: false,
    open: false,
  })
  // ⚠️ Read BACK out of the record rather than returning the literal above. The store wraps a record
  // in `reactive()`, which proxies on ACCESS — so the object just written is the RAW one, and a card
  // handed that would mutate the data without Vue ever hearing about it. Every keystroke would
  // change the draft and nothing on screen would move.
  return record.requests.get(requestId) as RequestDraft
}

/**
 * ⛔ **The most ordinals {@link SessionRecord.missing} will name, before it starts merely counting.**
 *
 * ⚠️ **A bound on the LIST, never on the fact** — {@link SessionRecord.missingBeyondTheList} carries
 * the rest, so *how short is this window* stays exact at every width. ⛔ **The hazard it closes is a
 * loop, not memory**: the width of a gap is `arrival − expected`, and a window whose first arrival is
 * ordinal 40,000 would otherwise walk forty thousand integers to say a sentence that does not name
 * one of them.
 *
 * ⚑ **The number is chosen for what the SENTENCE can use.** Below this, a hole is something a late
 * arrival can plausibly close and the notice can say so when it does; above it, the honest reading is
 * *reopen this conversation*, and which ordinals are absent stops being a thing anybody acts on.
 */
export const MOST_MISSING_ORDINALS_TRACKED = 256

/**
 * 🔴 **What this window is short by, and the sentence a person gets for it** (623, `HO-095` §2).
 *
 * ## ⛔ Three arms, because there are three facts and they are not the same fact
 *
 * | | what actually happened | what it may be told |
 * |---|---|---|
 * | **higher than expected** | events between the last one folded and this one have not reached this window | ⚠️ that something is missing, and how much |
 * | **lower, and it was one we were short by** | the hole this window reported has just been filled | ⚑ that it filled — which is the sentence `320` could not write |
 * | **lower, and it was not** | an event arrived after a later one, and nothing was ever short because of it | ⛔ that it is here, out of place — and NOTHING about the others |
 *
 * ⚠️ **The third arm is 074's rule, kept.** `320` corrected *"nothing is missing"* to a claim this
 * record can make, and the correction survives here in a stronger form: the record now HOLDS what it
 * is short by, so the only arm that says *nothing is missing* is the one that has just counted zero.
 *
 * ## ⚑ Why the log and not a field on the notice
 *
 * ⛔ **The ordinals are what made `HO-095` §2 possible and they are not thrown away** (§3.3, which
 * offers *a detail disclosure, the control projection, or a log* and takes any of the three). ⚠️ The
 * `console.warn` below names BOTH numbers beside each other, which is the whole diagnosis and is
 * where a diagnosis is read.
 *
 * ⛔ **And the Events tab is a weaker second place than it looks — said here because I checked.**
 * `EventStream.vue` puts each arrival's ordinal on the row as `data-ordinal` and PRINTS the type,
 * the time and the detail; ⚠️ so the number is in the DOM and not on the screen. ⚑ Printing it is a
 * one-line change in that component and is deliberately not made here: `HO-095` §3.3 is satisfied by
 * the log, and a second surface is the PO's call rather than a thing to take while passing.
 */
function theHoleMoved(record: SessionRecord, message: RuntimeEventMessage): void {
  if (message.ordinal > record.nextOrdinal) {
    // ⛔ **Bounded by construction rather than by a `break` inside the loop.** How many this list has
    // room for is arithmetic; walking to find out is the unbounded walk the cap exists to refuse.
    const shortBy = message.ordinal - record.nextOrdinal
    const listed = Math.min(
      shortBy,
      Math.max(0, MOST_MISSING_ORDINALS_TRACKED - record.missing.size),
    )
    for (let step = 0; step < listed; step += 1) record.missing.add(record.nextOrdinal + step)
    record.missingBeyondTheList += shortBy - listed
    console.warn(
      `session ${record.sessionId}: expected ordinal ${record.nextOrdinal}, got ${message.ordinal} ` +
        `— short by ${shortBy}`,
    )
    say(record, message, missingSentence(howShort(record)))
    return
  }
  // ⚠️ **`delete` answers whether it was there**, which is the whole discriminant: a window that was
  // never short by this ordinal has not just been made whole by it, and must not say it has.
  const filledAHole = record.missing.delete(message.ordinal)
  const short = howShort(record)
  console.warn(
    `session ${record.sessionId}: ordinal ${message.ordinal} arrived after ` +
      `${record.nextOrdinal - 1} — short by ${short}`,
  )
  say(record, message, lateSentence(filledAHole, short))
}

/**
 * ⚑ **Everything this record was short by, dropped because the anchor it was short OF has moved.**
 *
 * ⛔ **Its own function because there are two re-anchorings and a third would forget** — the same
 * argument {@link refold} makes one door over, and `061` finding 5's shape: a correction applied at
 * one of the places that needs it is a correction the others throw away.
 */
function forgetWhatWasMissing(record: SessionRecord): void {
  record.missing.clear()
  record.missingBeyondTheList = 0
}

/** How many events this window is short by — the list it can name, plus the ones it cannot. */
function howShort(record: SessionRecord): number {
  return record.missing.size + record.missingBeyondTheList
}

/** The notice, on the projection and with the stamp this instrument has used since 064. */
function say(record: SessionRecord, message: RuntimeEventMessage, text: string): void {
  applyEvent(record.control, { type: 'error', message: text, fatal: false }, message.at)
}

/**
 * 🔴 **The clause that IS the claim, exported because the instruments aimed at it are mostly
 * NEGATIVES** (623, `HO-095` §2).
 *
 * ⛔ **A negative aimed at a string literal goes vacuous the day the string is reworded, silently
 * and while staying green** — and this dispatch reworded exactly that string. ⚠️ **Most of the
 * assertions that read it say a hole was NOT reported**, and several are about a conversation handed
 * from one window to another, which is `HO-095` §2's own hypothesis about what went wrong. ⚑ Aimed
 * at an import, a rewording moves them or breaks them; aimed at a word, it silences them.
 *
 * ⚠️ **No count is written here on purpose** (`never-name-a-count-of-surfaces-in-a-brief`). ⛔ What
 * IS asserted is the other half: `the-event-that-did-not-arrive.test.ts` §4 walks every source the
 * app ships and refuses *"event stream gap"* and *"event out of order"* anywhere in it, so the words
 * `HO-095` §2 removed cannot come back through a second producer.
 *
 * ⚑ **The whole-sentence assertions in `out-of-order-arrival.test.ts` stay literals, deliberately.**
 * ⛔ A partial match belongs on this export; a claim that the sentence reads EXACTLY this is supposed
 * to break when somebody rewords it, which is `320 M11`'s own argument.
 */
export const NOT_REACHED_THIS_WINDOW = 'not reached this window'

/**
 * ⛔ **What is affected** — `HO-095` §2's first thing, and the third is a sentence of its own because
 * it is a LATER fact: see {@link lateSentence}. ⚑ **D-017b · the second — what they can do — is no
 * longer said**: *opening it again* re-read the record when opening meant ending and reopening it,
 * and no press re-reads a conversation this window is fed now, so a remedy here would be false.
 *
 * ⚠️ **It has to fit on ONE LINE and that is measured, not hoped** (`the-event-that-did-not-arrive.dom.test.ts`,
 * as a LINE COUNT since `672`). ⛔ `NoticeEntry.vue` drew a notice as a single ellipsised row inside
 * `--measure-message`, so a longer sentence was one whose second half did not exist for the reader —
 * ⚑ the same defect `HO-095` §2 rules against, wearing better words. ⚠️ **Since `672` a warning
 * WRAPS instead** (its whole sentence is drawn), so a longer one would no longer be cut: it would
 * turn a hairline into a paragraph, and the one-line budget is kept as a design rule on its own.
 */
function missingSentence(short: number): string {
  return (
    `${short} ${short === 1 ? 'event' : 'events'} of this conversation ${short === 1 ? 'has' : 'have'} ` +
    `${NOT_REACHED_THIS_WINDOW}, so what you are reading is missing ${short === 1 ? 'it' : 'them'}.`
  )
}

/**
 * 🔴 **Whether it is still true NOW — `HO-095` §2's third thing, and the one `320` could not say.**
 *
 * ⛔ **Three arms, because a low arrival is three different facts** and only one of them is *the hole
 * you were told about has closed*. ⚠️ `filledAHole` is the discriminant and `short` is the bound:
 * the record may only say *nothing is missing* when it has counted zero, which is 074's rule with a
 * set behind it instead of a maximum.
 */
function lateSentence(filledAHole: boolean, short: number): string {
  if (filledAHole && short === 0) {
    return (
      'The missing part of this conversation has reached this window — nothing is missing from ' +
      'what you are reading.'
    )
  }
  if (short > 0) {
    return (
      'An earlier part of this conversation arrived after a later one; ' +
      `${short} ${short === 1 ? 'event is' : 'events are'} still missing.`
    )
  }
  return (
    'An earlier part of this conversation arrived after a later one, so it is at the end of this ' +
    'list rather than in its place.'
  )
}

/**
 * Fold one message into a session, live or replayed — the single door every event goes through.
 *
 * The ordinal check is the reason it is a single door: it is what tells the difference between
 * "the conversation continues" and "we missed something", and a second path into the transcript
 * would be a path with no such check.
 *
 * The phase is settled HERE, in the same call that folded the terminal event, rather than by
 * watching `transcript.ended`. A watcher would leave a tick in which the session is finished but
 * the list still says it is running.
 */
export function acceptEvent(record: SessionRecord, message: RuntimeEventMessage): void {
  if (message.ordinal !== record.nextOrdinal) {
    // ⚠️ On the CONTROL projection, not the reading one (064, found by review). A gap is a fact
    // about the STREAM, and the two are the same object for every ordinary moment — but when they
    // are not, the reader is somewhere in old history, and putting the notice there dated it to
    // now, at the bottom of a page it did not happen on, where the next re-fold silently deleted
    // it. Reported where the session's state lives, it survives and it is in the right place.
    //
    // Stamped with the arriving event's time: the gap was noticed when this landed, and giving the
    // notice no time at all would drop it out of a timeline it belongs in.
    //
    // 🔴 **Which of the two things happened, because they are not the same fact** (320 §5). This
    // said *"event stream gap"* in both directions, and in one of them that was not a harsh sentence
    // — it was a FALSE one. A gap is a claim that something is MISSING:
    //
    //  - **higher than expected** — the events in between have not reached this window. Something
    //    really is absent from what you are reading, and "gap" is the word for it.
    //  - **lower than expected** — this event arrived AFTER one that comes later. THIS event is
    //    not missing: the line below folds it in like any other, at the end of the list rather than
    //    in its own place.
    //
    // ⛔ **And the low sentence claims nothing about the OTHERS, which is a correction to its own
    // first draft** (found reviewing this diff). It said *"nothing is missing"*, and this record
    // cannot know that: `nextOrdinal` is the highest seen plus one, not a set of what arrived. Feed
    // it `100, 104, 101, 102, 103` and the old wording prints *"nothing is missing"* three times
    // while 102 and 103 have genuinely not arrived. ⚑ 074's rule, and the same shape `unfinished`
    // was written for one field over: say the weaker fact you know rather than the stronger one you
    // would like. A real hole is still reported, by its own notice, in its own words.
    //
    // ⚑ **The instrument earned its place and keeps it** (118, 009): it caught 320's own defect on
    // its first day, and neither sentence is softened — both are still non-fatal `error` events on
    // the CONTROL projection, which `transcript.ts` draws as a `warn` notice and `transcript-mode.ts`
    // keeps in the reading view. ⚠️ Measured, not assumed: a notice at `info` is DROPPED by the
    // reading view, so demoting the out-of-order case would have been softening it out of existence
    // — which is exactly what 320 §5 refuses.
    //
    // 🔴 **623 · and what 320 left is a sentence that cannot be taken back** (`HO-095` §2). ⛔ The PO
    // read *"event stream gap: expected ordinal 486, got 487"* and asked *was an event lost, or did
    // the numbering skip* — ⚠️ **and this instrument answered neither, because it never looked
    // again.** ⚑ `320`'s own measurement is the proof: feed it `182` then `181` and it prints the
    // gap, then prints *"not lost, only late"* one event later, and leaves the first standing over
    // the second. 🔴 **The window KNEW, and had no way to say so.**
    //
    // ⛔ **So the ordinals move to {@link SessionRecord.missing} and the WORDS become a person's.**
    // ⚠️ HO-095 §2's second half is a ruling — *"raw diagnostic text does not reach a person; if it
    // matters, say what it means for them"* — and `expected 486, got 487` says what is affected,
    // whether it is still true, and what to do about it in none of its six words. ⚑ The ordinals are
    // not thrown away: they are what made the finding possible, so they go to the log below and they
    // are already on every row of the Events tab, which draws `message.ordinal` per arrival.
    theHoleMoved(record, message)
  } // The ordinal counter advances WHATEVER the window does with this event. It is a fact about the
  // stream, not about what happens to be on screen, and stopping it here would make the next event
  // look like a gap.
  //
  // ⛔ **ADVANCES — it never goes backwards** (320, measured). This was an assignment, and a late
  // arrival therefore walked the counter BACK: 181 landing after 182 reset it from 183 to 182, so
  // the NEXT event, 183, arriving in perfect sequence, was reported as a gap as well. One reorder,
  // **three** notices — the third dated to whatever the user did next, which is why he photographed
  // two and would have got a third the moment he typed. ⚠️ An instrument that manufactures a false
  // positive out of a true one is one you stop believing, which is the whole cost of this line.
  //
  // ⚑ **A deliberate rewind is somebody else's assignment, not this one.** `openWindow` re-anchors
  // to the page it just loaded and `reopenAtLatest` to the end of one; both write `nextOrdinal`
  // directly, and neither goes through this door.
  record.nextOrdinal = Math.max(record.nextOrdinal, message.ordinal + 1)

  // ⛔ **The opening line, taken the one moment it is knowable** (211 §3). See
  // {@link SessionRecord.opening}.
  //
  // ⚠️ **`!record.window.hasOlder` is what makes it TRUE rather than merely first.** `openWindow`
  // writes that flag from the host's page before a single replayed event comes through this door, so
  // a session reopened part-way through its ledger never claims an opening it was not shown — and a
  // live conversation that later releases a slab has already captured its own, because the flag only
  // turns true after the release, long after the first prompt.
  //
  // Before the `behind` branch below deliberately: which events the READER is looking at decides
  // what is rendered and nothing else (064), and this is a fact about the conversation.
  if (
    record.opening === null &&
    !record.window.hasOlder &&
    message.event.type === 'user_turn' &&
    // Do not use a `provider_transcript` turn as an unmarked rail opening. The transcript can disclose that its words came from a provider file; this compact cue cannot, and the app did not observe anyone typing them.
    //
    // ## ⛔ **Written `=== undefined` until 413, and that spelling became wrong the day the
    // default flipped**
    //
    // ⚠️ **`413` made a turn unmarked only when a WINDOW sent it**, so a spawned conversation's
    // first turn — the task an agent gave it — stopped being `undefined` and started being
    // `app_authored`. ⛔ Under the old spelling **every spawned conversation silently lost its rail
    // label and its palette detail**: the row a person picks a worker out of a list by went blank,
    // and nothing in this dispatch's own tests would have said so.
    //
    // ⚑ **The rule this line was always making is about provenance this app CANNOT verify**, and
    // that is exactly one value. A turn BroBot wrote or carried is provenance the app knows first
    // hand — there is nothing to forge — and the task a worker was given is the best name that
    // conversation will ever have. ⚠️ **A rail label is a TITLE, not an attribution**: it names
    // the conversation, and `413`'s whole subject is the bubble that claimed somebody typed
    // something. Those are different sentences.
    message.event.attribution !== 'provider_transcript'
  ) {
    record.opening = openingLine(message.event.text)
  }

  // The window has been scrolled back off the end of the ledger, so this event has no place in the
  // thing the reader is LOOKING at. Counted rather than folded there — see `liveDisposition` for
  // why folding it anyway would put an invisible hole in the conversation. Nothing is lost: it is
  // in the ledger, and returning to the tail re-reads it.
  //
  // ⚠️ **The control projection folds it anyway (064).** "Not on screen" and "not happening" are
  // different sentences, and reading the second off the first is 061 finding 5. Where the reader
  // has scrolled decides what is rendered and NOTHING else.
  if (liveDisposition(record.window) === 'behind') {
    record.window.behind += 1
    foldIntoTail(record, message)
    if (record.control.ended) record.phase = 'recorded'
    return
  }

  const { released } = appendLive(record.window, message)
  if (released > 0) {
    // The incremental fold is no longer valid — items at the front describe events that are gone —
    // so the transcript is rebuilt over what remains. Rare by construction (`WINDOW_RELEASE_CHUNK`),
    // because this is the one place a live event can pay for a whole re-fold.
    //
    // ⚠️ **Rebuilt over what remains PLUS what the released events established (068 finding 4).**
    // This state is the control projection too — the window holds the tail, so there is one object
    // here — and rebuilding it from the suffix alone is what unfroze the composer and idled a
    // running session after a busy turn overflowed the window.
    record.transcript = refold(record, record.window.entries, record.transcript)
  } else {
    applyEvent(record.transcript, message.event, message.at, message.ordinal, message.humanFinal)
  }
  // Still the same object — the window kept the tail, so there is one projection here, and the
  // re-fold above replaced it. Assigned rather than left alone because `refold` returns a NEW state.
  record.control = record.transcript
  if (record.control.ended) record.phase = 'recorded'
}

/**
 * Fold a live event into the CONTROL projection while the reader is away from the tail (064).
 *
 * Bounded exactly as the reading window is, by the same {@link appendLive} — an excursion into
 * history must not be a way to make the app grow without limit, which is the whole of 054.
 */
function foldIntoTail(record: SessionRecord, message: RuntimeEventMessage): void {
  // The ordinary way off the tail is {@link prependOlder}, which leaves the control projection
  // holding the fold that still included the tail and hands this the events it released — a fork
  // that costs nothing because the object already existed. Anything ELSE that takes the window off
  // the tail arrives here with the two projections still one object, and folding a live event into
  // that would write straight into what the reader is looking at. So the fork is made explicitly.
  if (record.tail === null) {
    record.tail = tailWindow([])
    if (record.control === record.transcript) {
      record.control = refold(record, record.window.entries, record.transcript)
    }
  }
  const { released } = appendLive(record.tail, message)
  // The tail is bounded by the same cap the reading window is, so a long unattended run releases
  // from it exactly as the live path does — and the state being rebuilt here is the ONLY control
  // truth this session has while the reader is away. 068's *"an open permission/user-input card can
  // leave effective state"* is this line without the carry (068 finding 4).
  if (released > 0) record.control = refold(record, record.tail.entries, record.control)
  else applyEvent(record.control, message.event, message.at, message.ordinal, message.humanFinal)
}

/**
 * Take the first page of a reopened session's history, before any of it is folded (054).
 *
 * It exists for ONE reason, and the reason is the ordinal check in {@link acceptEvent}. That check
 * is what tells "the conversation continues" from "we missed something", and a page that starts at
 * ordinal 25,000 would trip it on its very first event — a gap notice at the top of every reopened
 * long conversation, announcing a hole that is not one.
 *
 * So the record is told where the page BEGINS. The check is not weakened: it still holds across
 * every event from here on, including the seam between the replay and the live stream, which is
 * the join it was written to guard.
 */
export function openWindow(record: SessionRecord, page: HistoryWindow): void {
  // ⚠️ **Everything this record was showing goes first, and 064 found out the hard way that it has
  // to.** `store.resume` reuses the record a CLOSED session left behind in the map — that is how a
  // conversation gets back into the open list — so this can run over a window that already holds
  // that session's entire previous life, and the replay then went in on top of it. Measured: a
  // three-message conversation closed and reopened rendered six messages, with the ordinal check
  // silent about it because the second run of ordinals was continuous with itself.
  //
  // Both projections are replaced with one state, because a session reopening is at its own tail by
  // definition, and the drafts go with them: they belong to requests that this session's previous
  // life settled.
  record.window.entries = []
  const transcript = createTranscript()
  // 🔴 **D-035 · …and the tools this conversation had where the page begins go in first.** Its gives,
  // replies, questions and requests taken on are drawn as cards only for the tool names it was
  // handed, read as each call is folded, and a provider states those once per start — so a page
  // that begins after that row drew every one of them as a plain tool line.
  const inForce = page.toolsInForce
  if (page.humanAnswers !== undefined) transcript.humanAnswers = copyHumanAnswers(page.humanAnswers)
  if (inForce !== undefined) applyEvent(transcript, inForce.event, inForce.at, inForce.ordinal)
  record.transcript = transcript
  record.control = transcript
  record.tail = null
  record.requests = new Map()
  // Otherwise only the CURSOR here. The entries themselves go in through `acceptEvent`, so the
  // ordinal check and the fold see the replay by the same door the live stream uses — which is the
  // property `acceptEvent`'s own doc calls the reason it is a single door.
  record.window.from = page.from
  record.window.hasOlder = page.hasOlder
  record.window.turnAligned = page.turnAligned
  record.window.atTail = true
  record.window.behind = 0
  // The first event of the page is the next one expected. An EMPTY page leaves the counter alone:
  // a session with no history at all starts at 0, and `page.from` would say 0 there anyway.
  const first = page.entries[0]
  if (first) record.nextOrdinal = first.ordinal
  // 🔴 **623 · and what this record was SHORT BY goes with the entries it was short from.**
  //
  // ⛔ **`nextOrdinal` is being re-anchored, so every ordinal below it stops meaning *absent* and
  // starts meaning *before this page*.** ⚠️ Carrying the set across would have a window report a
  // hole from a life this page replaces — the same shape 064 found in the entries themselves, one
  // field over, and the reason that clearing is the first thing this function does.
  forgetWhatWasMissing(record)
}

/**
 * Whether the CONTROL projection holds the conversation's start, so its first message is the
 * first. ⚠️ While the reader is away from the tail, control folds the tail, whose window always has
 * older events, even when the reading window has reached the start.
 */
export function controlHoldsTheStart(record: SessionRecord): boolean {
  return !(record.tail ?? record.window).hasOlder
}

/**
 * Put an older page in front of what this session is showing, and re-fold (054).
 *
 * Re-folded rather than prepended into the existing items — see `transcript-window.ts` for the
 * three ways concatenating two independently-folded states goes wrong. It is the same call the
 * read-only pane makes, so a live conversation and a recording page back identically.
 */
export function prependOlder(record: SessionRecord, page: HistoryWindow): void {
  const { tail } = prependPage(record.window, page, record.sessionId)
  // ⚠️ **This is where the two projections come apart (064).** The window has just let go of the
  // newest events, so what it holds from here on is history. `record.transcript` at this instant is
  // still the fold that INCLUDED those events — which is exactly the control state — so it is left
  // where it is and the reading fold is rebuilt over it. No copy, no snapshot: the old object stops
  // being the reading projection and carries on as the control one.
  //
  // A SECOND page back releases more events, and they go in FRONT of what the tail already holds —
  // a release always comes off the newest end, so a later one is strictly older than an earlier one
  // and the two are contiguous. Skipping them (which is what this did until the review asked what
  // happens next) left a hole: `record.control` still had them, but the moment the tail overflowed
  // and rebuilt the control fold from its own entries, the range between the two releases was gone
  // — and with it any card that was open in it. Trimmed to the same ceiling, so paging back for a
  // long time cannot make this the unbounded thing 054 exists to prevent.
  if (tail.length > 0) {
    if (record.tail === null) record.tail = tailWindow(tail)
    else {
      record.tail.entries = [...tail, ...record.tail.entries].slice(-WINDOW_MAX_EVENTS)
      record.tail.from = record.tail.entries[0]?.ordinal ?? record.tail.from
    }
  }
  // Two different folds wearing one call, and the ternary is which one (068 finding 4). With a tail
  // held, this is a view of HISTORY and the control state is the object left behind above — seeding
  // a history fold with the present would put a live card and a running status at the top of a page
  // that is thousands of events in the past. With no tail it is BOTH projections, and a carry is
  // what keeps an earlier release's open card alive through a prepend that does not re-read it.
  const carry = record.tail === null ? record.transcript : null
  // ⚑ **D-035** — the window now begins where this page does, so its tools there go in first.
  record.transcript = refold(record, record.window.entries, carry, page.toolsInForce ?? null)
  // Nothing was released, so the window still holds the tail and there is still one projection.
  if (record.tail === null) record.control = record.transcript
}

/**
 * Put a session back on the newest page of its ledger (054) — "jump to latest".
 *
 * The way out of a window that scrolled far enough back to release the tail. Everything is replaced
 * rather than merged: the page IS the newest events, including the ones counted in `behind` while
 * the window was away, so splicing would duplicate them.
 *
 * `nextOrdinal` is re-anchored to the end of the page for the same reason {@link openWindow}
 * anchors it to the start of one — the next live event has to look like a continuation, and the
 * counter is the only thing that decides whether it does.
 *
 * ⚠️ **And it carries, which 073's own review found it was not doing.** "Re-read rather than
 * reconciled" is true of the ENTRIES and was quietly being read as true of the state: a page is
 * bounded, so a card opened before it, or a `working` established before it, is not in it — and
 * jumping to latest threw away the tail fold that DID know about them. That is 068 finding 4 through
 * the last door it had left, and worse than the release version, because here the app is discarding
 * knowledge it is holding rather than failing to reconstruct knowledge it lost. The page and the
 * tail overlap, which is exactly what {@link carryForward}'s restated-id filter is for.
 */
export function reopenAtLatest(record: SessionRecord, page: HistoryWindow): void {
  // Read BEFORE `openAt` replaces the window, and from `control` rather than `transcript`: the two
  // have been apart for the whole excursion, and the one that knows what the session is is the one
  // that went on folding the tail.
  const carry = record.control
  openAt(record.window, page, record.sessionId)
  // ⚑ **D-035** — the window now begins where this page does, so its tools there go in first.
  record.transcript = refold(record, record.window.entries, carry, page.toolsInForce ?? null)
  if (page.humanAnswers !== undefined)
    record.transcript.humanAnswers = copyHumanAnswers(page.humanAnswers)
  // Back on the tail, so the two projections are ONE object again and the separate tail goes.
  record.control = record.transcript
  record.tail = null
  const last = page.entries.at(-1)
  if (last) record.nextOrdinal = last.ordinal + 1
  // ⚑ **623 · re-anchored, so the same clearing {@link openWindow} makes.** ⛔ This page IS the
  // newest events, including the ones counted in `behind` while the window was away — so an ordinal
  // this record was short by is either in it or is below it, and neither is missing any more.
  forgetWhatWasMissing(record)
}

/** Fold a state-channel reading without changing ordinary state or queue membership. */
export function acceptProviderBlock(record: SessionRecord, facts: ProviderBlockFacts): void {
  if (record.meta !== null)
    record.meta = { ...record.meta, ...mergeProviderBlock(record.meta, facts) }
  else record.earlyProviderBlock = mergeProviderBlock(record.earlyProviderBlock, facts)
}

/** Apply liveness to a session that already knows what it is. */
export function acceptLiveness(record: SessionRecord, liveness: SessionLiveness): void {
  if (record.meta === null) {
    record.earlyProviderBlock = mergeProviderBlock(record.earlyProviderBlock, liveness)
    // Thinking and detail describe this packet; omission clears them while disclosures accumulate.
    const earlier: Partial<SessionLiveness> = { ...record.earlyLiveness }
    delete earlier.thinking
    delete earlier.detail
    record.earlyLiveness = {
      ...earlier,
      ...liveness,
      ...(liveness.queued !== undefined
        ? { queued: mergeHeldMessages(record.earlyLiveness?.queued, liveness.queued) }
        : {}),
      ...mergeProviderBlock(record.earlyLiveness, liveness),
    }
    return
  }
  // The approval disclosure rides the liveness channel (034) but belongs on the session itself —
  // it is what the header reads, and there must be exactly one copy of it. Folded in here rather
  // than read from two places, so a header that shows the mode can never be showing the older one.
  record.meta = {
    ...record.meta,
    ...mergeProviderBlock(record.meta, liveness),
    ...(liveness.approval ?? {}),
    // Folded the same way and for the same reason (060): the pane reads `meta`, so a second place
    // to look for "is this plan waiting on me" would be a second answer.
    ...(liveness.plan ?? {}),
    // …and the three live settings (076), under their OWN key rather than spread. Spreading would
    // put `model` on `meta` beside `CreatedSession.model` — the model the session was CREATED with —
    // and one of the two would silently overwrite the other. They are different facts and the header
    // needs both: what it was started with, and what it is running now.
    ...(liveness.settings ? { settings: liveness.settings } : {}),
    // …and the message waiting to be sent (077).
    //
    // ⚠️ **Tested against `undefined`, not truthiness — unlike every line above it.** `null` here is
    // a real value meaning *"nothing is queued any more"*, and it is precisely the value a flush
    // publishes. A `?? {}` or a truthiness test would drop that message and leave the composer
    // offering to cancel something that had already been sent — the one update this disclosure
    // exists to deliver. Only genuine absence, on a liveness message published before the session
    // was described, leaves the current value alone.
    ...(liveness.queued !== undefined
      ? { queued: mergeHeldMessages(record.meta.queued, liveness.queued) }
      : {}),
    liveness,
  }
}

/**
 * Take ownership of a session the host has now described, and drain whatever arrived while it
 * was still being opened — in arrival order, through the same door, so the ordinal check applies
 * to them too.
 */
export function adoptSession(record: SessionRecord, created: CreatedSession): void {
  // ⚠️ **The early liveness is FOLDED, not just attached** (077, found in review). This used to
  // override only the `liveness` key, so any disclosure that arrived before the session was
  // described was stranded on `record.meta.liveness` where nothing reads it — `queued` is read from
  // `meta.queued`, not from `meta.liveness.queued`. Unreachable today, because the host cannot queue
  // a message before it has described the session; a latent inconsistency all the same, and the
  // kind that surfaces the moment a disclosure starts being published earlier.
  record.meta = {
    ...created,
    queued: mergeHeldMessages(record.meta?.queued, created.queued),
    ...mergeProviderBlock(created, created.liveness),
  }
  if (record.earlyLiveness) acceptLiveness(record, record.earlyLiveness)
  record.earlyLiveness = null
  if (record.earlyProviderBlock) acceptProviderBlock(record, record.earlyProviderBlock)
  delete record.earlyProviderBlock
  if (record.phase === 'opening') record.phase = 'open'
  foldHeldEvents(record)
}

/**
 * Fold whatever arrived while this session could not take it, in arrival order, through the same
 * door — so the ordinal check applies to them too.
 *
 * ⛔ **Its own function since 242 §3**, because there are two callers now: {@link adoptSession},
 * which runs when a hand-over succeeded, and the resume that FAILED — where the buffer would
 * otherwise be a set of events this window received, holds, and will never draw.
 */
export function foldHeldEvents(record: SessionRecord): void {
  const held = record.earlyEvents
  record.earlyEvents = []
  for (const message of held) {
    // ⚠️ **An event can be in the buffer AND in the page that was just replayed** (100, found in
    // review), and applying it twice is not a near-miss: `acceptEvent` compares the arriving ordinal
    // with the one it expects, so the second copy is folded in AND reported as a gap — a duplicated
    // reply under a notice blaming the ledger for a hole that is not there.
    //
    // It became reachable when a LIVE session could be handed over. The host writes an event to the
    // ledger and then pushes it to the sink, so an event that lands here while the hand-over is in
    // flight is already in the history the host read a moment later; the buffer holds it because
    // this record had no `meta` yet. A conversation that has stopped cannot produce one, which is
    // why the resume path never met it.
    //
    // Below `nextOrdinal` means "already folded", because that is exactly what `nextOrdinal` is:
    // the ordinal this record is waiting for. A fresh session starts at 0 and buffers from 0, so
    // this drops nothing on the path that has always worked.
    if (message.ordinal < record.nextOrdinal) continue
    acceptEvent(record, message)
  }
}

/**
 * `ipcMain.handle` rejections arrive wrapped; the message underneath is the useful part.
 * Electron serializes the main-process error as `${name}: ${message}`, and subclasses carry
 * their class name — `CodexUnavailableError: …`, `AuthUnavailableError: …` — which is exception
 * taxonomy, not something to show a person. Any single-word `…Error:` prefix is the wrapper's,
 * so it goes too; a real message that happened to start with such a token would be naming a
 * class at the user anyway.
 */
export function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(\w*Error:\s*)?/, '')
}

/**
 * 🔴 **When this conversation last recorded anything — from the LIVE window, never the one being
 * read** (389 §3).
 *
 * ⛔ **The hazard this exists to remove is a reader who has paged back.** {@link SessionRecord.tail}
 * holds the live slice exactly while the reader is looking at an older one — the invariant is stated
 * on the field itself: *"`tail === null` is exactly `window.atTail`, and that is by construction
 * rather than by agreement."* So a shelf that read `window.entries.at(-1)` would tell a person the
 * conversation last reported an hour ago **because they scrolled up**, which is a claim about the
 * agent made out of a fact about the reader.
 *
 * ⚑ **The time is the envelope's, not the provider's.** `RuntimeEventMessage.at` is stamped by the
 * host as it records the event and is the same value the ledger's `created_at` gets, so the wire and
 * the database cannot disagree about when something happened — and a replayed event keeps its
 * original stamp rather than the moment it was replayed.
 *
 * ⚠️ **`null` is the ordinary opening state and it is not a gap**: a conversation with no events yet
 * has no report to time, and a surface must say so rather than stamping the moment it drew.
 *
 * ⛔ **It is a stamp and not a freshness claim.** Nothing here subtracts a clock; how long ago that
 * was is a different question, and one that decays between the render and the reading.
 */
export function lastReportAt(record: SessionRecord): number | null {
  const live = record.tail ?? record.window
  return live.entries.at(-1)?.at ?? null
}
