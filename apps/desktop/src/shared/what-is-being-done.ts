import type { SessionStatus } from '@brobot2/shared'
// ⚑ **TYPES and nothing else, in both directions** (575) — `workspace-reading.ts`' rule, kept for
// its reason: an edge erased at build time cannot hand this module a database, a host, a clock or a
// provider, and nothing here can cost a renderer a bundle
// (`a-value-import-from-shared-costs-the-renderer-135kb`). ⛔ This file's own exports ARE values; it
// lives in `apps/desktop/src/shared`, which is inside the app and free to import from both sides.
import type { ContextReading, RuntimeEvent } from '@brobot2/runtime'

/**
 * 🔴 **What this app has been TOLD each conversation it is running is doing, as of ONE stated
 * moment** (575, `HO-063` §3 · `HO-054` §5).
 *
 * ## ⛔ The complaint, and the one thing this shape refuses to do about it
 *
 * ⚠️ **`HO-063` §3:** *"A person looking at a project gets `working`, and nothing else, for as long
 * as the work takes."* ⚑ BroBot said the same of itself: *"I could not distinguish thinking from
 * stuck in a loop from waiting on a prompt nobody will answer."*
 *
 * 🔴 **And the refusal: nothing in this file produces a WORD.** `agent-state.ts`' `sessionDoing` is
 * *"the ONLY answer to 'what is it doing right now' in the app"* (089), and this app has paid three
 * times for a second one — `042` (idle while a workflow ran), `089` (*"running Bash"* while the
 * model was already replying) and `099` (a `working` plate beside an `Idle` pill). ⛔ A word
 * composed here, published on a wire and drawn beside that one on the same row would be the fourth.
 * ⚑ **So this carries the FACTS the existing derivation was missing and lets it do the deriving** —
 * `HO-015` §2's rule (*render it from the thing rather than assert it about the thing*) applied to a
 * read instead of to a template. {@link whatAPlateCanDraw} and {@link activityOf} are the doors out
 * of here, and both return an INPUT: the second for a window that takes a running conversation over,
 * whose page may not hold the row that set its activity.
 *
 * ## ⚑ What the facts are, and why these three
 *
 * ⛔ **{@link ConversationAtWork.told} and {@link ConversationAtWork.streaming} were the two fields
 * of `SessionFacetInput` that `575` could fill from nowhere but a live event stream**, and both
 * surfaces that drew a plate off a LIST passed them empty: the project roster (gone with projects
 * in D-016) passed `activity: null, streaming: false` with the note *"this band reads a LIST, not
 * a live session"*, and the rail's one list does the same for a row it does not hold. ⚠️ The
 * other fields are already on the row those bands read, or are the renderer's own.
 *
 * 🔴 **593 · and {@link ConversationAtWork.status} is the third, because that last sentence was
 * true of the two callers `575` had and false of the third.** ⛔ A Team page groups these rows by
 * IDENTITY and holds no status column at all — an identity is not a conversation — and without one
 * `sessionDoing` answers `unknown` however much the provider published, because `099` lets an
 * activity refine a status and never promote one. ⚑ The field was already being kept privately by
 * `BeingDoneTracker` for its own turn boundary; this publishes it and derives nothing.
 *
 * ## 🔴 The three honesty rules this shape enforces, each from a rule this project already paid for
 *
 * 1. ⛔ **A conversation that has said NOTHING may not read as `idle`** —
 *    `a-door-that-answers-before-it-can-know`. {@link NOTHING_WAS_SAID}'s first member is that
 *    state, and {@link whatAPlateCanDraw} withholds the recorded status when it holds, so the
 *    faceless ring is what gets drawn.
 * 2. ⛔ **Something this build has no word for may not render as the last word it did have** —
 *    `an-unenumerated-state-counts-as-success`. An activity frame that failed its own schema
 *    arrives as `unknown{degradedFrom:'activity'}` (`235`), and the third member of
 *    {@link NOTHING_WAS_SAID} is what this app says about it: the previous phase is deliberately
 *    dropped rather than carried.
 * 3. ⛔ **Say WHEN it was true** — `a-measured-fact-has-a-time-it-becomes-available`.
 *    {@link ConversationAtWork.since} is when the pair above last moved, or a card settled, and
 *    {@link readAt} is when the reading was finished; neither is a claim about now.
 *
 * ## ⚠️ It is a SNAPSHOT and it inherits `567`'s limit, more sharply than `567` does
 *
 * ⛔ **`WorkspaceReading.readAt`'s own sentence:** *"It is not a claim about NOW and it is not a
 * cadence. A surface that wants* this went quiet *needs a reader whose re-read interval is shorter
 * than a silence window, and an aggregate read is not one"* (`534` F4, `509`'s rule). 🔴 **The same
 * holds here and the margin is far worse**: `livenessStateOf` may be published by a 30 s reader
 * because `DEFAULT_SILENCE_WINDOW_MS` is 120 s, and a tool call or a thinking phase lives for
 * SECONDS. ⚠️ So a 30-second reader draws a phase that may have been superseded twenty-nine seconds
 * ago, and the age has to be drawn beside it — which is what `LiveSignalView.asOf` is.
 *
 * ⚑ **What is NOT the same as liveness, and it is the part worth carrying forward.** `live →
 * silent` moves on a TIMER with no act behind it, so there is nothing for a channel to announce
 * from; every fact here moves because an EVENT arrived at `RuntimeHost.deliver`. ⛔ So this one CAN
 * be pushed — and `RUNTIME_CHANGED_CHANNEL` is not the carrier, because its contract is *re-read
 * the whole population* and one re-read per provider event is not a channel, it is a storm. 🔴 The
 * push this fact wants is a per-conversation stream to a surface that does not own the
 * conversation, which is `512` increment 1 and is deliberately not here.
 */
export interface WhatIsBeingDone {
  /**
   * 🔴 **The one moment every row below had been read by** (575) — `WhoCalledWhom.readAt`'s and
   * `WorkspaceReading.readAt`'s rule, and the same argument: {@link WhatIsBeingDone} is assembled
   * from an in-memory map with no `await` anywhere in it, so nothing can move between two of these
   * rows and land in one of them.
   *
   * ⚑ **The app's WALL clock**, and stamped LAST — a completion point, never a start time.
   *
   * ⛔ **It is not a claim about NOW** — see this interface's own note, where the cadence argument
   * is written down.
   */
  readonly readAt: number
  /**
   * ⚑ **Every conversation this app was RUNNING at {@link readAt}, and no others** — the whole of
   * the population, which is what makes an absence readable.
   *
   * ⛔ **Complete rather than asked-for, and that is a ruling.** A caller that handed in a set
   * would get an answer bounded by the question it happened to ask, and *"nothing is running in
   * this project"* is the one sentence a roster must never say by accident (`452` §5.1). ⚠️ With
   * the whole population and one {@link readAt}, *this app is running
   * nothing for that identity* is a sound inference; with a set, it is only ever a statement about
   * the set. ⚑ The two questions the two surfaces actually ask are {@link byConversation} and
   * {@link byIdentity}, named here so neither component writes the selection a second time.
   *
   * ⚠️ **The order is the slot map's and carries no fact.** Read this list through one of the two
   * selectors; nothing here is sorted and nothing may be concluded from a position.
   */
  readonly conversations: readonly ConversationAtWork[]
}

/**
 * 🔴 **One conversation this app is running, and what it last said it was doing** (575).
 *
 * ⛔ **Both facts are the PROVIDER's, reported** — nothing here is an observation this app made
 * about a provider that said nothing, which is the digest's own `observed`/`claimed` split one
 * vocabulary over.
 */
export interface ConversationAtWork {
  /** The conversation's own id — what every other door on this wire calls `sessionId`. */
  readonly conversation: string
  /**
   * 🔴 **The identity this conversation runs as** — `HostedSession.profileId`, the slug resolved
   * once at launch.
   *
   * ## ⛔ 637 · this said it is *"the same value a roster's `identity` carries"* and that is FALSE
   *
   * ⚠️ **It is `input.profileId ?? DEFAULT_PROFILE_ID`, the LAUNCHER's spelling, kept verbatim.**
   * ⛔ A roster's `identity` is `agent_identity.slug`, which `foldProfileName` folds under a
   * CHECK — *"the directory name keeps the caller's spelling verbatim and this one is folded"*, in
   * that field's own words. 🔴 **A person who first launches an identity as `Dev` gets
   * `agent_identity.slug = 'dev'` and a slot holding `'Dev'`**, and the two lists then do not join
   * on this field at all.
   *
   * ⚑ **The sentence is corrected rather than the behaviour**, which is standing rule 19's
   * corollary read honestly: folding here changes a field `team-roster.ts` and `632`'s cast band
   * read, and that is a dispatch rather than a clause. ⚠️ **What is MEASURED and what is not**: a
   * reader keyed on {@link conversation} (`byConversation`) is unharmed; `team-roster.ts` keys on
   * `identity.slug`
   * (`byIdentity`) and is the one surface that can miss — and no fixture reaches it with the two
   * spellings apart, so the defect is reasoned from the two definitions rather than observed.
   *
   * 🔴 **So every reader of this list joins on {@link conversation}**, which is the id both sides
   * spell the same way — `TheWholeForest`'s field list says so for the graph, and this is the
   * reason.
   *
   * ⚑ **It is here so the caller can ask its own question** — a conversation list matches these
   * rows by {@link conversation}, and a Team page groups them by this. ⛔ **And no name**:
   * `agentName(identity, identities)` is the app's one naming function (`449`) and a display name
   * computed on this row would be a second answer to *what is this identity called*.
   */
  readonly identity: string
  /** ⚑ **The last thing this app was told about it** — see {@link WhatThisAppWasTold}. */
  readonly told: WhatThisAppWasTold
  /**
   * 🔴 **The last `status` this conversation's stream carried, and `idle` before the first one**
   * (593) — the field `sessionDoing` needs before it will let an activity say anything at all.
   *
   * ## ⛔ Why it is here, when `575` deliberately left it out
   *
   * ⚠️ **`575` had two callers and both held their own status column** (the project roster, gone
   * with projects in D-016, read its conversation's recorded status), and `whatAPlateCanDraw`'s
   * `recorded` parameter says so in as many words: *"or `null` for a surface that holds no status
   * for this conversation, which draws the same faceless ring."* ⛔ **The Team page is the third
   * caller and it has no such column** — an identity is not a conversation and no read gives it
   * one.
   *
   * 🔴 **And without a status, `099`'s ordering makes the whole read silent.** `sessionDoing` lets
   * `activity` REFINE a session the host already calls busy and may NEVER promote one — *"`status`
   * FRAMES and `activity` REFINES"* — so a conversation whose provider is publishing `thinking`
   * draws `unknown` for a caller passing `null`, however much arrived. ⚑ **That ruling is right and
   * is untouched.** What was missing was the frame, not a way around it.
   *
   * ## ⚑ It is ALREADY COMPUTED — this publishes it rather than deriving it
   *
   * ⛔ **`BeingDoneTracker` had kept this privately since `575`**, as the turn boundary its own
   * `status` arm is built on — *"the TURN BOUNDARY, and since `593` also the frame `current`
   * reports."* ⚑ `593` did not compute it; it published what was already there. ⚠️ So this costs no database read, no new event, no
   * second clock and no second derivation — it reports a field the tracker was already keeping.
   *
   * ⚑ **`idle` before any `status` event, because that is what the sentence means** — `042`:
   * *"idle means we are no longer driving a turn"*, and a conversation this app has just registered
   * is one it is driving no turn in. ⛔ **Not `null`, and that was measured**: `SessionMachine.sync`
   * publishes a status only when the derived one CHANGES, so a conversation that was already quiet
   * when this app registered it publishes none — and a caller reading `null` drew a faceless ring
   * at a live conversation every other surface was calling `idle`.
   *
   * ⚠️ **It cannot make a silent conversation look alive**: {@link whatAPlateCanDraw} withholds it
   * while {@link NOTHING_HAS_ARRIVED} holds, which is this file's first honesty rule.
   */
  readonly status: SessionStatus
  /**
   * ⚠️ **Assistant text is arriving right now** — the fact that OUTRANKS {@link told} in
   * `sessionDoing`, and it is on this row rather than folded into it for exactly that reason.
   *
   * ⛔ **`089`'s defect, measured:** after a tool returns, the last activity still says `tool`
   * while the model is already streaming its answer, and the pill read *"running Bash"* into the
   * middle of the reply. ⚑ `sessionDoing` puts `streaming` above `activity` and that ordering is
   * what fixes it — so a row that carried only {@link told} would hand the one derivation an input
   * it could not order.
   */
  readonly streaming: boolean
  /**
   * 🔴 **When {@link told} and {@link streaming} last MOVED** — epoch ms, and never when this
   * reading was taken. ⚑ **Or a card settled**: an approval, a denial or an answer counts as
   * activity, so the age a surface draws restarts from it (`BeingDoneTracker`).
   *
   * ⛔ **It is the event's own stamp**, the same `at` `RuntimeHost.deliver` puts on the ledger row
   * and on the message it sends — that method's own rule, *"when did this happen has to be a single
   * answer"*. ⚠️ A conversation that has said nothing carries the moment it registered, which is
   * the honest answer to *how long has it been silent* for a session that never spoke.
   */
  readonly since: number
  /**
   * ⚑ **F093 · how full its context is: the latest `context_reading` this app holds for it**, or
   * `null` when it holds none — a provider that has not reported one in this life.
   */
  readonly context: ContextReading | null
}

/**
 * ⛔ **What the provider last published, or the reason there is nothing to publish** (575) — a
 * union, so a reader cannot add a phase to an absence by accident.
 *
 * ⚑ **`WorkspaceReading`'s `OneCount` shape exactly**: the arm that has no answer carries NO
 * `phase` field at all, so *nothing was said* cannot be mistaken for a phase this build could not
 * spell, and a reader that wants the phase has to narrow the union first.
 */
export type WhatThisAppWasTold =
  | {
      readonly said: 'an-activity'
      readonly phase: ActivityPhase
      /**
       * ⚑ **The provider's own short qualifier — a tool name, most often** — or `null`, which is
       * *the provider published a phase and no detail* and is the ordinary state for `thinking`.
       *
       * ⚠️ **`null` and never `''`**: a cleared field arrives as null everywhere on this wire, and
       * an empty string would be a name nobody wrote. ⛔ **And a surface may only draw it while the
       * phase that produced it is still the one being drawn** — `activityLine`'s own rule: *"the
       * detail belongs to the phase that produced it, and dies with it… appending it would put the
       * lie back one word to the right — REPLYING BASH."*
       */
      readonly detail: string | null
    }
  | { readonly said: 'nothing'; readonly because: NothingWasSaid }

/**
 * 🔴 **Why there is nothing to report, as a closed vocabulary** (575) — three members, and each one
 * is a sentence a surface has to say differently.
 *
 * ⛔ **A fourth member owes its own sentence**, `WHY_NOTHING_WAS_COUNTED`'s discipline one shape
 * over: *a walk needs a word of its own when no existing word's sentence is TRUE of it.* ⚠️ The
 * pair this deliberately does NOT split is *the provider published an activity and a turn boundary
 * cleared it* and *this provider has never published one at all* — {@link NOTHING_RIGHT_NOW}'s
 * sentence is true of both, and nothing a surface does with them differs.
 */
export const NOTHING_WAS_SAID = [
  /**
   * ⛔ **This app is running it and NOT ONE event has arrived on its stream.**
   *
   * 🔴 **It is the only member that changes what a surface may draw from its other fields**, and
   * that is `a-door-that-answers-before-it-can-know` exactly: the recorded status of a conversation
   * nothing has happened in is `idle`, and `idle` is a claim — *this app is no longer driving a
   * turn* (`042`) — about a conversation that has never had one. ⚑ {@link whatAPlateCanDraw}
   * withholds the status here, so the faceless ring is drawn instead of a confident face.
   */
  'nothing-has-arrived',
  /**
   * ⚑ **Events have arrived and no activity is current** — the ordinary quiet, and the answer for
   * almost every row almost all of the time.
   *
   * ⚠️ **It says nothing about whether a turn is running**, and must not be read as `idle`: that is
   * the recorded status's question, and `sessionDoing` is where the two meet.
   */
  'no-activity-right-now',
  /**
   * 🔴 **The last frame that would have said arrived in a shape this build could not read** (235's
   * `degradedFrom`) — so the previous phase is DROPPED rather than carried.
   *
   * ⛔ **`an-unenumerated-state-counts-as-success`, and the reachable instance of it.** A fifth
   * activity phase, or a malformed one, fails `activityEventSchema` and is replaced with an
   * `unknown` carrying `degradedFrom: 'activity'`. ⚠️ Holding the old phase through that would let
   * *doing something I have no word for* render as the last word this app did have, which is the
   * defect `HO-063` §3 was written about with better spelling.
   */
  'a-frame-this-app-could-not-read',
] as const

/** One of {@link NOTHING_WAS_SAID}. */
export type NothingWasSaid = (typeof NOTHING_WAS_SAID)[number]

/** ⚑ **The ordinary quiet, spelled once** — see {@link NOTHING_WAS_SAID}'s second member. */
export const NOTHING_RIGHT_NOW: WhatThisAppWasTold = {
  said: 'nothing',
  because: 'no-activity-right-now',
}

/** ⚑ **Registered and silent, spelled once** — see {@link NOTHING_WAS_SAID}'s first member. */
export const NOTHING_HAS_ARRIVED: WhatThisAppWasTold = {
  said: 'nothing',
  because: 'nothing-has-arrived',
}

/**
 * ⛔ **The phase vocabulary, as the PROVIDER publishes it** (575) — a value, so a `Record` keyed by
 * it stops compiling when a fifth phase is added to `activityEventSchema`.
 *
 * ## ⚠️ It is the THIRD spelling of these four words, and the two below pin it in both directions
 *
 * 🔴 **`activityEventSchema.phase` is the first** (in `packages/runtime`, a zod enum) **and
 * `TranscriptState.activity.phase` is the second** (in the renderer, a literal union) — and the
 * app already lives with that pair. ⛔ A third that could drift from either would be a vocabulary
 * with two chances to disagree, so the compile-time proof below makes a phase the runtime knows
 * and this list does not a TYPECHECK failure, and `what-each-agent-is-doing.test.ts` reads the
 * schema's own options back out of the discriminated union and asserts the list against them.
 *
 * ⚑ **Spelled rather than derived, for `WHAT_NEEDS_A_PERSON`'s reason**: the zod enum is a VALUE in
 * `packages/runtime`, and this module imports types and nothing else.
 */
export const ACTIVITY_PHASES = [
  'thinking',
  'tool',
  'waiting',
  'compacting',
] as const satisfies readonly PublishedPhase[]

/** One of {@link ACTIVITY_PHASES}. */
export type ActivityPhase = (typeof ACTIVITY_PHASES)[number]

/** The phase the runtime's own `activity` event carries. */
type PublishedPhase = Extract<RuntimeEvent, { type: 'activity' }>['phase']

/**
 * ⛔ **The other half of {@link ACTIVITY_PHASES}' pin, and it is a compile error rather than a
 * test.** `satisfies` above refuses a word the runtime does not have; this refuses a word the
 * runtime HAS and this list does not — which is the direction that costs a person something,
 * because a phase nobody lists is a phase no surface can draw.
 *
 * ⚑ **`claude-runtime.ts`' `_ClaudeEffortsAreExhaustive` shape, deliberately**: the same proof
 * exists one package over for the same reason, and a second spelling of it would be a second thing
 * to keep true.
 */
type _EveryPublishedPhaseIsNamed =
  Exclude<PublishedPhase, ActivityPhase> extends never
    ? true
    : ['a phase this list has missed', Exclude<PublishedPhase, ActivityPhase>]
const everyPublishedPhaseIsNamed: _EveryPublishedPhaseIsNamed = true
void everyPublishedPhaseIsNamed

/**
 * 🔴 **A list's question: which row is this conversation's?** (575)
 *
 * ⚑ **Keyed by {@link ConversationAtWork.conversation}**, which is what a list band already has on
 * every row — so it matches by id and never by identity, and a conversation the list does not draw
 * simply does not match. ⛔ That is what makes one complete read safe for a surface that draws part
 * of the population.
 */
export function byConversation(reading: WhatIsBeingDone): ReadonlyMap<string, ConversationAtWork> {
  return new Map(reading.conversations.map((one) => [one.conversation, one]))
}

/**
 * 🔴 **A Team page's question: what is this identity doing, anywhere?** (575)
 *
 * ⛔ **A LIST per identity and never one answer**, because an identity running two conversations is
 * doing two things and this app has no ruling that says which one to show. ⚠️ A fold that picked
 * would be a decision taken in the wrong place — the surface has the room to say *two
 * conversations* and this function has none.
 *
 * ⚑ **An identity with no entry is absent from this map**, which — on a COMPLETE reading — is
 * *this app is running nothing for it at {@link WhatIsBeingDone.readAt}*. See
 * {@link WhatIsBeingDone.conversations} for why that inference is sound here and would not be from
 * a set-shaped read.
 */
export function byIdentity(
  reading: WhatIsBeingDone,
): ReadonlyMap<string, readonly ConversationAtWork[]> {
  const grouped = new Map<string, ConversationAtWork[]>()
  for (const one of reading.conversations) {
    const held = grouped.get(one.identity)
    if (held === undefined) grouped.set(one.identity, [one])
    else held.push(one)
  }
  return grouped
}

/**
 * 🔴 **The three inputs a plate was missing, in the shape `sessionFacets` takes** (575) — a door out
 * of this module that hands back an INPUT rather than a word, as {@link activityOf}, the other, does.
 *
 * ## ⛔ Why a surface may not assemble this itself
 *
 * ⚠️ **`468`'s lesson:** a derivation written inside an SFC is reachable by no mutation row and by
 * no test that is not a render. ⛔ **And there are three surfaces** — the team roster, the forest
 * and *Working together* — so a fold written in a component would be written three times and the
 * three would be free to disagree: `169` §1, which is the reason each of them asks this.
 *
 * ## 🔴 The one DECISION on this function: the recorded status is WITHHELD, never overwritten
 *
 * ⛔ **A conversation this app has been told nothing about hands `sessionDoing` a `null` status**,
 * which is that function's *"No word from the host, so no claim — 081's faceless ring rather than a
 * confident face"*. ⚑ The alternative was letting the recorded `idle` through, and `idle` in this
 * app means *we are no longer driving a turn* (`042`) — a sentence about a conversation that has
 * never had one, arriving on the surface built to say what each agent is doing.
 *
 * ⚠️ **It withholds and does not REPLACE.** Nothing here invents a status, and the caller's own
 * column is untouched for every other row — which is why this takes the recorded value rather than
 * reading a second one: the row's own status is the column and a live second opinion beside it is
 * `421`'s defect with the axis changed.
 *
 * @param recorded what the CALLER already knows — the row's own status for a list band,
 * {@link ConversationAtWork.status} for a Team card. ⚑ `null` remains legal and draws the faceless
 * ring, but since `593` no caller in this app passes it: a surface with no status column of its own
 * reads the one on the row.
 */
export function whatAPlateCanDraw(
  one: ConversationAtWork,
  recorded: SessionStatus | null,
): {
  readonly status: SessionStatus | null
  readonly activity: { phase: ActivityPhase; detail?: string } | null
  readonly streaming: boolean
} {
  const nothingHasArrived =
    one.told.said === 'nothing' && one.told.because === 'nothing-has-arrived'
  return {
    // ⛔ **The one decision** — see this function's own note.
    status: nothingHasArrived ? null : recorded,
    activity: activityOf(one.told),
    streaming: one.streaming,
  }
}

/**
 * ⚑ **{@link WhatThisAppWasTold} in the renderer's own `activity` spelling**, or `null` for every
 * arm that has no phase.
 *
 * ⛔ **`detail` is ABSENT rather than `undefined`**, because `TranscriptState.activity` declares it
 * optional and `activityLine` branches on `!== undefined` — a key written with an undefined value
 * reads the same there, and absent is what the fold that produced the original does.
 */
export function activityOf(
  told: WhatThisAppWasTold,
): { phase: ActivityPhase; detail?: string } | null {
  if (told.said === 'nothing') return null
  return { phase: told.phase, ...(told.detail === null ? {} : { detail: told.detail }) }
}
