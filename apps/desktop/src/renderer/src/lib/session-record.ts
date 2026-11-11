import type { PersistedEventInfo } from '../../../shared/conversation-events'
import type { AgentState } from '../../../shared/agent-state-contracts'
import type { RuntimeStatesMessage } from '../../../shared/runtime-ipc'
import type {
  CreatedSession,
  HistoryWindow,
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
import {
  applyEvent,
  acceptWorkAncestry,
  createTranscript,
  type TranscriptState,
} from './transcript'
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



export type SessionPhase = 'opening' | 'open' | 'closing' | 'recorded'

export interface RequestDraft {
  
  answers: Map<string, string | string[]>
  
  sent: boolean
  
  answered: boolean
  /** A settled card is showing its whole self (034). */
  open: boolean
}

export interface SessionRecord {
  readonly sessionId: string
  /** What the host said this session is; null until it says. */
  meta: CreatedSession | null
  /** Undefined is an older envelope; null means core has not yet published a current state. */
  agentState?: AgentState | null
  agentStatePublication?: NonNullable<RuntimeStatesMessage['published']>
  earlyProviderBlock?: ProviderBlockFacts
  
  transcript: TranscriptState
  
  control: TranscriptState
  
  tail: WindowState | null
  
  liveFrom: number | null
  
  opening: string | null
  
  requests: Map<string, RequestDraft>
  
  window: WindowState
  /** The next ordinal expected on this session's stream; a mismatch is reported, not hidden. */
  nextOrdinal: number
  
  missing: Set<number>
  
  missingBeyondTheList: number
  
  busy: boolean
  /** The last failure from a command for this session. */
  error: string | null
  
  unanswered: number
  phase: SessionPhase
  
  earlyEvents: RuntimeEventMessage[]
  
  handover: number
  /** Only the latest matters — this is a state, not a log. */
  earlyLiveness: SessionLiveness | null
}

export function whereItWorks(record: {
  readonly meta: { readonly cwd?: string } | null
}): string | null {
  return theFolderOf(record.meta?.cwd)
}

function theFolderOf(cwd: string | null | undefined): string | null {
  return basenameOf(cwd ?? '') || null
}

export function profileItRunsAs(meta: CreatedSession | null): string | null {
  if (meta === null || meta.ranAsNobody !== undefined) return null
  return meta.profileId
}

export function whoIsIn(meta: CreatedSession, identities: readonly AgentIdentity[] | null): string {
  const profile = profileItRunsAs(meta)
  return profile === null ? providerName(meta.provider) : agentName(profile, identities)
}

export function whereItCameFrom(meta: CreatedSession): string | null {
  if (meta.ranAsNobody === 'bundle') return 'from a bundle'
  if (meta.ranAsNobody === 'user-home') return `from ${providerName(meta.provider)}'s own folder`
  return null
}

/** ⚑ **D-017b** — see {@link turnsTakenWithoutThisWindow}. */
export type TakenWithoutThisWindow = 'by-another-window' | 'by-no-window'

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

export function refold(
  record: SessionRecord,
  entries: readonly RuntimeEventMessage[],
  carryFrom: TranscriptState | null = null,
  toolsInForce: PersistedEventInfo | null = null,
): TranscriptState {
  const carry = carryFrom === null ? null : carryForward(carryFrom, entries)
  return foldWindow(entries, record.liveFrom, carry, toolsInForce)
}

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

export const MOST_MISSING_ORDINALS_TRACKED = 256

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

export const NOT_REACHED_THIS_WINDOW = 'not reached this window'

function missingSentence(short: number): string {
  return (
    `${short} ${short === 1 ? 'event' : 'events'} of this conversation ${short === 1 ? 'has' : 'have'} ` +
    `${NOT_REACHED_THIS_WINDOW}, so what you are reading is missing ${short === 1 ? 'it' : 'them'}.`
  )
}

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
    applyEvent(
      record.transcript,
      message.event,
      message.at,
      message.ordinal,
      message.humanFinal,
      message.workAncestry,
      message.ancestryContext,
    )
  }
  // Still the same object — the window kept the tail, so there is one projection here, and the
  // re-fold above replaced it. Assigned rather than left alone because `refold` returns a NEW state.
  record.control = record.transcript
  if (record.control.ended) record.phase = 'recorded'
}

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
  else
    applyEvent(
      record.control,
      message.event,
      message.at,
      message.ordinal,
      message.humanFinal,
      message.workAncestry,
      message.ancestryContext,
    )
}

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
  if (page.workAncestry !== undefined) acceptWorkAncestry(transcript, page.workAncestry)
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

export function controlHoldsTheStart(record: SessionRecord): boolean {
  return !(record.tail ?? record.window).hasOlder
}

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

export function reopenAtLatest(record: SessionRecord, page: HistoryWindow): void {
  // Read BEFORE `openAt` replaces the window, and from `control` rather than `transcript`: the two
  // have been apart for the whole excursion, and the one that knows what the session is is the one
  // that went on folding the tail.
  const carry = record.control
  openAt(record.window, page, record.sessionId)
  // ⚑ **D-035** — the window now begins where this page does, so its tools there go in first.
  record.transcript = foldWindow(
    record.window.entries,
    record.liveFrom,
    carryForward(carry, record.window.entries, true),
    page.toolsInForce ?? null,
  )
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

export function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(\w*Error:\s*)?/, '')
}

export function lastReportAt(record: SessionRecord): number | null {
  const live = record.tail ?? record.window
  return live.entries.at(-1)?.at ?? null
}
