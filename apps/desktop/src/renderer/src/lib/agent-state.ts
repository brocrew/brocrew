import {
  type LivenessState,
  type SessionStatus,
  type WorkflowAgent,
} from '../../../shared/runtime-ipc'
// ⚑ **636 · a TYPE only.** The waits are {@link TASK_STATES}' own `waiting-on-` family — a
// conversation's are all but the one said on a piece only ({@link ConversationWait}, D-016 · commit
// 6) — and this file names none of them a second time — see {@link AgentFacets.waiting}.
import type { ConversationWait, HeldWork } from '../../../shared/tasks'
// ⚑ **D-017 · R11 — the ONE state is `shared/agent-state.ts`'s** — its order, its details and its
// words — which `main` says in `list_agents` and `get_agent_status`: this file feeds it what the
// window holds and never ranks or words those states again.
import {
  SCHEDULED,
  agentStateArm,
  agentStateOf,
  agentStateWords,
  scheduleHeld,
  somethingRunning,
  type AgentState,
  type AgentStateArmFacts,
  type ScheduleLevel,
  type StoppedPiece,
} from '../../../shared/agent-state'
import { BACKGROUND_WORD } from './background-work'
// 🔴 **636 · the WORD each wait is drawn with, DERIVED from the table that owns it** — the same
// move `BACKGROUND_WORD` and `SCHEDULED` a few lines up are here for, and `222` §4's rule: a
// person meets one phrase for one fact. ⛔ Writing *"waiting on a worker"* in this file would be a
// second spelling of a sentence `work-report.ts` already owns and already draws on the Work tab.
import { WORK_STATE_WORD } from './work-report'
import type { SessionPhase, SessionRecord } from './session-record'
import type { RoutedAway, SubAgentCard, TranscriptState, WorkflowRunCard } from './transcript'

/**
 * How a LIVE AGENT is drawn, as rules rather than as markup (081/082).
 *
 * Define the three composable facets: `doing` avatar, `being` underline and `needing` corner badge on a white plate. Keep vocabularies, tokens, small-size priority, accessible sentences and fact-to-facet mapping together.
 *
 * It is pure on purpose, and for the same reason `drawer.ts` is: the component is almost entirely
 * conditional rendering, the renderer tests are SSR-only, and a rule that lives in a template is a
 * rule nothing can assert without a browser (067).
 *
 * ⚠️ **This is a SIBLING of `StateBadge.vue`, not a replacement.** StateBadge draws a DOCUMENT —
 * lifecycle, condition, outcome. This draws an agent. They stay visually distinct so that a row
 * never suggests a document is thinking.
 */

/* ---------------------------------------------------------------------------
   The three vocabularies
   --------------------------------------------------------------------------- */

/** What the agent is DOING — the illustrated avatar. */
export const DOINGS = [
  'idle',
  'working',
  'thinking',
  'tool',
  'compacting',
  'replying',
  /**
   * The honest seventh. A faceless dashed ring, never one of the six — showing a face would claim
   * a DOING we do not have (029/030/035/065). It is what an ABSENT `doing` renders as.
   */
  'unknown',
] as const
export type Doing = (typeof DOINGS)[number]

/** What the agent IS — one value at a time, drawn as the underline beneath the plate. */
export const BEINGS = [
  'unstarted',
  'starting',
  'live',
  'silent',
  'closing',
  'ended',
  'errored',
] as const
export type Being = (typeof BEINGS)[number]

/**
 * What the agent NEEDS FROM YOU — the top-right badge, and the only facet that can demand.
 *
 * ⚑ The exhaustive `Record`s below are what make a member with nothing to draw a compile error
 * rather than a blank badge. ⚠️ **This said *three* until `577` added a fourth**
 * ({@link NEEDING_NOUN}); the number is gone rather than bumped, because a count in prose that
 * nothing checks goes false the next time somebody adds one.
 */
export const NEEDINGS = ['permission', 'question', 'plan'] as const
export type Needing = (typeof NEEDINGS)[number]

/**
 * ⛔ **The FOURTH facet: work this session left running outside the turn** (250, from 248's registry).
 *
 * ## Why a facet, and not a sixth DOING
 *
 * ⚠️ **"Idle AND something is running" is genuinely two facts**, and the three existing vocabularies
 * are each single-valued. A `doing: 'background'` would have to be chosen INSTEAD of `replying`,
 * `tool` or `idle` — so a model streaming its answer while a detached command ran could say only one
 * of the two true things. It would also need an avatar (`DOINGS` is the illustration set), and
 * promoting an idle session to a busy DOING is exactly the 042/089/099 bug `sessionDoing`'s own
 * precedence exists to prevent.
 *
 * ⛔ **And not a BEING.** `BEINGS` are the PROVIDER's liveness plus the two states we state ourselves;
 * they draw the underline, one value at a time. `background` there would shadow `live`/`silent` and
 * re-hue a line that means something else.
 *
 * Background work is not a `needing`: it asks nothing from the person and must not spend the attention channel. {@link workflowRunFacets} follows the same distinction.
 *
 * ## What it draws: a WORD, and nothing new
 *
 * ⚑ **No new avatar, no new badge, no fourth corner.** `081` collision A already spends the two
 * right-hand corners (NEEDING top, condition bottom), and inventing a mark would be a design
 * decision this dispatch has no design behind. The fact is ALREADY drawn — `248`'s registry sits
 * above the composer with the description, the kind and the stop button. What was missing is that
 * the WORDS disagreed with it. So this changes {@link standingOf} and nothing else, which is `219`'s
 * rule (*do not invent a second mechanism*) and `099`'s (one derivation, two projections).
 *
 * ⚠️ **The plate keeps the idle face, and that is the honest reading rather than an oversight.** The
 * avatar answers *what is the AGENT doing*, and the agent is not doing anything — a process it
 * detached is. `042`'s ruling stands: *"idle means we are no longer driving a turn."* What was never
 * true is that the one-word surfaces could stop there.
 */
/**
 * ⚑ **One rail row's plate and word** — what the rail draws for a conversation, and so what every
 * other surface drawing that conversation draws (`TheCast.railSays`; UI-001, UI-004). ⚑ Here, beside
 * the plate's own type, so a fold in `lib/` can take it without reaching into a composable.
 */
export interface RailSays {
  readonly detail?: string
  readonly facets: AgentFacets
  readonly word: string
  /**
   * ⚑ **W4.162 · the model and effort its row names** — the host's list's own (`model`,
   * `reasoningEffort`, or what the provider reported), for the agent panel's sub-agent cards.
   * Absent where the row names none.
   */
  readonly model?: string
  readonly effort?: string
}

export interface AgentFacets {
  doing?: Doing
  being?: Being
  needing?: Needing
  /**
   * Work this session started that is STILL RUNNING outside the turn — `248`'s level set, non-empty.
   *
   * ⚠️ Named for `DetachedWork` / `stopDetachedWork` / `BackgroundTasks.detachedAs`, which is what
   * this app already calls the fact. `running` was the first name and it was rejected: a prop called
   * `running` on an agent plate reads as *the agent is running*, which is the opposite of the state
   * it exists to describe.
   */
  detached?: boolean
  /**
   * 🔴 **The FIFTH facet: work this session has promised to do LATER** (258, from `253`'s level).
   *
   * Read scheduled state separately from {@link detached}. The background registry cannot identify a waiting cron when no process is currently running.
   *
   * A schedule is independent of avatar activity and provider liveness. It asks nothing from the person, so it also cannot use the needing badge. Keep it as a separate facet, allowing a model reply and waiting schedule to coexist.
   *
   * ⚑ **The bar's own condition** (`scheduleHeld`), whether or not the conversation's process runs.
   * ⚠️ Read off this window's fold, which lists what the provider last stated — so a view drawn from
   * its ledger wears the host's word instead, which knows whether a start will bring those jobs
   * back (D-029).
   */
  scheduled?: boolean
  /**
   * 🔴 **The SIXTH facet: the one wait this CONVERSATION is in** (636, from `621` §5.1 ·
   * `HO-095` §5.1 · `HO-096` §4) — the host's verdicts on who owes it the next move
   * ({@link ConversationWaiting.needsYou}, `.waitingOnTheAnswerOf`, `.waitingOnTheWorkOf`: D-017 ·
   * R19, D-036), read off `whatEachConversationIsWaitingOn` through `theWaitAsTheHostOwesIt` and
   * narrowed by {@link theWaitIn}.
   *
   * ## Represent a conversation's wait independently of its local activity
   *
   * > 🔴 ***He watched `Idle` on BroBot's header while Ada was actively working for him.***
   *
   * ⚠️ **Every fact needed to say otherwise was already folded** — `621` measured `aWorker` true
   * for that conversation the whole time — ⛔ **and there was no FACET to put it on.** The five
   * above are all read off `control`, which is this window's own fold of its own ledger; a child's
   * `work_replied` is written into the CHILD's ledger, so `RuntimeScreen`'s own note applies: *"no
   * window can derive this from its own stream."*
   *
   * ## ⚠️ Why a facet and not a sixth DOING, a BEING or a NEEDING — 250's three arguments, checked
   *
   * ⛔ **Not a DOING.** The vocabularies are single-valued, and a conversation replying while work
   * it gave out is still open would have to say one of two true things. ⚑ It would also need an
   * avatar, and the plate's honest face here is `idle`: the AGENT is doing nothing — another one
   * is.
   *
   * ⛔ **Not a BEING.** `BEINGS` are the PROVIDER's liveness plus the two states we state
   * ourselves, one at a time; this would shadow `live`/`silent` and re-hue a line about something
   * else.
   *
   * 🔴 **And not a NEEDING for two of its three values, which is the whole of `621` §5.2.**
   * {@link NEEDINGS} is *what the agent needs FROM YOU*. ⛔ `waiting-on-a-worker` **asks nobody for
   * anything** — `tasks.ts`' own docblock: *"It is the one wait with no addressee … the work is
   * simply out"* — and `waiting-on-an-answer` asks the AGENT that gave this conversation its work.
   * ⚠️ Mapping either onto a `Needing` would raise the `waiting` standing, put an amber *needs you*
   * mark on a conversation nobody is waiting on, and inflate `SideRail`'s `needingCount`, whose
   * title is *"N waiting on you"* — `HO-092` §3's shape exactly: **a count he cannot clear.**
   *
   * ⚑ **The third value IS a `Needing`-shaped fact and is treated as one** — see
   * {@link waitSummonsAPerson}, which is where that single-member split is argued and pinned.
   *
   * ## ⛔ Absent means *nothing was read*, never *nothing is outstanding*
   *
   * ⚠️ **Three absences reach this slot as one `undefined`, deliberately and only here** — see
   * {@link WaitReading}, which keeps them apart one call earlier. ⛔ An absent facet ADDS nothing:
   * the word a person then reads is the one the five facets above were already producing, and no
   * claim about work is made out of a read that did not happen.
   *
   * ⛔ **D-016 · commit 6 · a {@link ConversationWait}**: *waiting on you*, the wait a piece a
   * person gave reads, is said on the piece only (plan ruling 9) and never reaches this slot.
   */
  waiting?: ConversationWait
  /**
   * 🔴 **The SEVENTH facet: where the work this conversation HOLDS stands** (D-006 · F018) —
   * {@link ConversationWaiting.work}, read off the same reading as {@link waiting} through
   * `theWorkIn`.
   *
   * Turn status reports whether the agent runs, not whether delegated work is answered or stalled. Read the work facet only on an idle plate through {@link standingOf}; a running turn is already driving its work.
   *
   * ⛔ **Absent adds nothing**, on {@link waiting}'s rule: never *answered*, never *stalled*.
   */
  work?: HeldWork
  /**
   * 🔴 **F036 · the EIGHTH facet: who waits on an answer from THIS conversation** — its turn ended
   * with a question still open that another conversation put to it, as its parent or by name. The
   * askers, named as the host names them (`the owner of W1.2 · …`), oldest first; never empty.
   *
   * ⚑ **The host's word, carried on the state it pushes** (`runtime:states`): the window holds no
   * other conversation's ledger, so it reads this off the one state the host says of the
   * conversation (`whoItOwesIn`). ⛔ Absent adds nothing, {@link waiting}'s rule.
   */
  owes?: readonly [string, ...string[]]
}

/* ---------------------------------------------------------------------------
   Words — the accessible name, and the label a row carries beside the mark
   --------------------------------------------------------------------------- */

export const DOING_WORD: Record<Doing, string> = {
  idle: 'idle',
  working: 'working',
  thinking: 'thinking',
  tool: 'using a tool',
  compacting: 'compacting context',
  replying: 'replying',
  unknown: 'state unknown',
}

export const BEING_WORD: Record<Being, string> = {
  unstarted: 'not started',
  starting: 'starting',
  live: 'live',
  silent: 'silent',
  closing: 'closing',
  ended: 'ended',
  errored: 'errored',
}

/**
 * 🔴 **UI-008 · the one state's word for a person's answer or approval waiting** (F051) —
 * `agentStateWords`' *needs you*, the word the tools say, spelled once: the rail row, the word
 * under the plate, the pill, the shelf's attention row and the accessible name all take it here.
 * ⛔ It said *waiting*, *Waiting on you* and *idle* on three surfaces for one state.
 */
export const NEEDS_YOU = agentStateWords({ is: 'needs-you' })

/**
 * ⚑ **UI-008 · the two needings that make the state *needs you* say its word** — a permission and
 * a question ({@link summonsAttention}). ⛔ **`plan` keeps its own phrase**: a go-ahead blocks
 * nothing and is never the *needs you* state ({@link standingOf}), so it may not wear that word.
 */
export const NEEDING_WORD: Record<Needing, string> = {
  permission: `${NEEDS_YOU} (permission)`,
  question: `${NEEDS_YOU} (question)`,
  plan: 'waiting on you (plan approval)',
}

/**
 * 🔴 **The PLURAL NOUN a surface names a NEEDING by, when it is counting them** (577).
 *
 * ⛔ **Not {@link NEEDING_WORD}, and the difference is grammatical rather than editorial.** That
 * map writes an accessible name for ONE open card (*"needs you (permission)"*); this one writes
 * the noun a sentence about a POPULATION needs — *"No permissions or questions are on a card here"*
 * (⚑ **re-worded at `602`**; it read *"have been raised here"* until `589` measured
 * that a question `ask_question` raised IS raised here and draws no card). ⚠️ A surface that reached
 * for `NEEDING_WORD` to build that sentence would put *needs you* into a heading, which is
 * the collision `250` refused in `session-panel.ts`'s own docblock and `STANDING_LABEL.waiting`
 * already owns.
 *
 * ⛑ **Exhaustive over {@link NEEDINGS} for that vocabulary's own stated reason** — *"the … `Record`s
 * below are what make a member with nothing to draw a compile error rather than a blank badge"*.
 * ⚠️ **That sentence counts THREE and there are four of them now**; `577` added this one and left
 * the count out of the quotation rather than restating a number in prose that nothing checks
 * (`a-number-can-survive-the-death-of-its-derivation`). ⚑ `plan` has a noun even though
 * {@link summonsAttention} refuses it today: the
 * entry is what a heading would say if that predicate ever widened, and it is the negative control
 * `the-heading-and-what-it-counts.test.ts` sweeps against.
 */
export const NEEDING_NOUN: Record<Needing, string> = {
  permission: 'permissions',
  question: 'questions',
  plan: 'go-aheads',
}

/* ---------------------------------------------------------------------------
   Tokens — 081 §7. No component carries a colour.
   --------------------------------------------------------------------------- */

/**
 * The underline's colour, per BEING.
 *
 * ⚠️ **`closing` is `--muted` and not the poster's orange**, because orange is `--auto` and belongs
 * to the auto-approve session that never asks. A second meaning for it would break the one place
 * this app shouts. `closing` carries its own weight with motion instead.
 */
export const BEING_TOKEN: Record<Being, string> = {
  unstarted: '--faint',
  starting: '--accent',
  live: '--accent',
  silent: '--waiting',
  closing: '--muted',
  ended: '--faint',
  errored: '--danger',
}

export const NEEDING_TOKEN: Record<Needing, string> = {
  permission: '--waiting',
  question: '--accent',
  plan: '--success',
}

export const NEEDING_GLYPH: Record<Needing, string> = {
  permission: '#i-lock',
  question: '#i-question',
  plan: '#i-check',
}

/** The neutral mark, and the ring an absent `doing` draws. No hue = no claim. */
export const UNKNOWN_TOKEN = '--faint'

/**
 * The bottom-right badge, for the two BEINGs that carry a condition worth a glyph.
 *
 * ⚠️ **The corner is deliberately NOT the top-right one**, which NEEDING owns (081 collision A).
 * `errored + permission` therefore draws BOTH facts rather than picking one; it is safe because
 * BEING is a single value, so the clock and the `!` can never want the same corner.
 *
 * ⚠️ **The clock means "time is ELAPSING on a live turn"** — it counts up. That is why 077's queued
 * message moved to a pause: a message held before send is not elapsing, and one glyph meaning both
 * was the collision (081 collision B).
 */
const CONDITION_BADGE = {
  silent: { glyph: '#i-clock', token: '--waiting' },
  errored: { glyph: '#i-bang', token: '--danger' },
} as const satisfies Partial<Record<Being, { glyph: string; token: string }>>

export function beingCondition(being: Being | undefined): { glyph: string; token: string } | null {
  if (being === 'silent' || being === 'errored') return CONDITION_BADGE[being]
  return null
}

/**
 * Every token drawn ON the white plate, and therefore every token `tokens.css` §14 has to
 * re-declare at its paper value.
 *
 * Derived from the maps above rather than listed, so a new badge colour cannot be added here and
 * forgotten there — which would ship a bright-on-white smear that nothing but an eye would catch.
 */
export const PLATE_TOKENS: readonly string[] = [
  ...new Set([
    ...Object.values(NEEDING_TOKEN),
    ...Object.values(CONDITION_BADGE).map((badge) => badge.token),
    UNKNOWN_TOKEN,
  ]),
].sort()

export interface Underline {
  token: string
  /** Dotted: a state that is not steadily running. */
  dotted: boolean
  /** The only motion in the component — and `prefers-reduced-motion` removes it. */
  pulse: boolean
}

export function underlineFor(being: Being): Underline {
  return {
    token: BEING_TOKEN[being],
    dotted: being === 'silent' || being === 'starting' || being === 'unstarted',
    pulse: being === 'starting' || being === 'closing',
  }
}

/* ---------------------------------------------------------------------------
   Size, and the floor
   --------------------------------------------------------------------------- */

/**
 * Seven sizes, xl → dot. The name is what callers use; the number is what the CSS gets.
 *
 * Retain `xl` as an available size even though current callers use `hero`. An unused supported size is different from an impossible state.
 */
export const SIZES = {
  xl: 128,
  hero: 96,
  card: 60,
  row: 40,
  avatar: 28,
  compact: 24,
  dot: 16,
} as const
export type SizeName = keyof typeof SIZES

/**
 * Below this the illustration is mud, so the avatar stops being an avatar (081 §4).
 *
 * The floor is a NUMBER rather than a list of names, which is what makes `dot` ordinary: it is not
 * a special case in the component, it is simply the one built-in size that falls under the line.
 */
export const PLATE_FLOOR = 24

export function platePx(size: SizeName | number | undefined): number {
  if (size === undefined) return SIZES.avatar
  return typeof size === 'number' ? size : SIZES[size]
}

export function isDotOnly(px: number): boolean {
  return px < PLATE_FLOOR
}

/**
 * The ONE colour a below-floor mark gets, in priority order: **NEEDING > errored > live > silent >
 * DOING**.
 *
 * A dot can say exactly one thing, so it says the most important one and the row's own text carries
 * the word. What it must never do is fall back to a DOING colour while something is waiting — that
 * would be an unanswered card with no visible trace, which is the guarantee 063/079 §5 exist for.
 */
/**
 * What a mark says it needs a person for: the kind where it is known, else a question where it
 * waits on a person and the kind is not said. Only a glyph: the plate's name says what is known,
 * and a dot's colour stays the priority rule's, which a wait does not move.
 */
export function needsMarkOf(facets: Pick<AgentFacets, 'needing' | 'waiting'>): Needing | null {
  return facets.needing ?? (facets.waiting === 'waiting-on-a-person' ? 'question' : null)
}

export function priorityDotToken(facets: AgentFacets): string {
  if (facets.needing) return NEEDING_TOKEN[facets.needing]
  if (facets.being === 'errored') return '--danger'
  if (facets.being === 'live' || facets.being === 'starting') return '--accent'
  if (facets.being === 'silent') return '--waiting'
  if (facets.being === 'closing' || facets.being === 'ended' || facets.being === 'unstarted')
    return '--muted'
  if (facets.doing === undefined || facets.doing === 'unknown') return UNKNOWN_TOKEN
  if (facets.doing === 'idle') return '--ready'
  return '--accent'
}

/* ---------------------------------------------------------------------------
   The accessible name
   --------------------------------------------------------------------------- */

export interface AccessibleNameInput extends AgentFacets {
  /** The subject of the sentence. Renames the agent; never re-hues it (mirrors StateBadge). */
  label?: string
  /** Counted by whoever owns the clock — this file never counts (082 hazard 1). */
  silentSeconds?: number
}

/**
 * `{label} — {doing}{, being (silentSeconds)}{, needing}`, e.g.
 * *"claude — thinking, silent 40s, needs you (permission)"*.
 *
 * Words, never glyphs: a screen reader cannot read a lock, and "the badge is amber" is not a fact
 * about the session. An absent facet is simply absent from the sentence rather than said to be
 * absent — "no permission needed" is noise on every row that never needed one.
 */
export function accessibleName(input: AccessibleNameInput): string {
  const parts = [DOING_WORD[input.doing ?? 'unknown']]
  if (input.being) {
    parts.push(
      input.being === 'silent' && input.silentSeconds !== undefined
        ? `silent ${input.silentSeconds}s`
        : BEING_WORD[input.being],
    )
  }
  // ⛔ **A screen reader gets the fourth facet too, and it has to** (250). The sighted reading of
  // this state is the registry above the composer — a list, with a button — and a sentence that
  // stopped at *"claude — idle, live"* would leave the one person who cannot see that list with the
  // exact impression this dispatch exists to remove. Words, never a glyph, like everything else here.
  //
  // ⚠️ **After BEING and before NEEDING**, which is the order of the facets themselves rather than
  // an aesthetic: it is a statement about the session, and the ask — when there is one — is last
  // because it is what the listener has to act on.
  if (input.detached) parts.push('work still running')
  // ⛔ **And the fifth, for the identical reason** (258). The sighted reading of this state is the
  // schedule bar above the composer; a sentence that stopped short would leave the one person who
  // cannot see that bar being told a conversation is idle when it is going to wake at 2 a.m.
  //
  // ⚠️ **Deliberately not *"scheduled"* alone, which is the word the pill has room for.** A listener
  // hearing *"claude — idle, live, scheduled"* has been told an adjective with no subject; this says
  // what the fact is about. Same rule as `NEEDING_WORD`, whose values are phrases for the same
  // reason.
  if (input.scheduled) parts.push('work scheduled')
  // 🔴 **And the sixth, for the fourth and fifth's reason exactly** (636). ⛔ The sighted reading
  // of this state is the pill and the word under the plate; a sentence that stopped at *"brobot —
  // idle, live"* would leave the one person who cannot see either being told a conversation is
  // idle while another agent is working for it — which is `HO-095` §5.1 with the screen off.
  //
  // ⚠️ **`WORK_STATE_WORD` and not a phrase of its own**, like everything else here: it is already
  // the app's sentence for this fact, it is already a phrase rather than an adjective (*"waiting
  // on a worker"*, not *"elsewhere"*), and `NEEDING_WORD`'s values are phrases for the same
  // reason.
  //
  // ⛔ **Skipped for `waiting-on-a-person` when a NEEDING is already being said**, because the
  // needing below is the SAME fact stated more specifically — *"needs you (permission)"* names the
  // card; *"needs you"* again would be the app saying it twice in one sentence. ⚑ With no needing
  // it is said, and that is `621` F2's case: the question was routed to a person and this
  // transcript draws no card for it.
  //
  // 🔴 **UI-008 · a person's wait is said in the one state's word** (F051), as the plate's word
  // says it — *needs you*, not the Work tab's *waiting on a person*, which words the PIECE.
  if (
    input.waiting !== undefined &&
    !(waitSummonsAPerson(input.waiting) && summonsAttention(input.needing))
  ) {
    parts.push(waitSummonsAPerson(input.waiting) ? NEEDS_YOU : WORK_STATE_WORD[input.waiting])
  }
  // ⚑ **F036 · and the eighth** — another agent waits on this one's answer.
  // ⚠️ The short phrase, `waiting`'s rule: the row's own word beside the plate names WHO.
  if (input.owes !== undefined) parts.push('owes another agent an answer')
  // ⚑ **D-006 · the idle plate's word about the work it holds**, and only on an idle plate.
  const standing = standingOf(input)
  if (standing === 'stalled' || standing === 'answered') parts.push(standingWord(input))
  if (input.needing) parts.push(NEEDING_WORD[input.needing])
  return `${input.label ?? 'agent'} — ${parts.join(', ')}`
}

/* ---------------------------------------------------------------------------
   What this app actually knows — the adapters
   ---------------------------------------------------------------------------

   ⚠️ Everything below maps REAL state onto the vocabularies above. Where no source exists, the
   facet is left ABSENT rather than guessed: an avatar is a claim about right now, and 035 already
   cost us one invented one. The gaps are named where they are, not hidden.
   --------------------------------------------------------------------------- */

export interface SessionFacetInput {
  /**
   * The renderer's own lifecycle: `opening` is the only source `starting` has. ⚑ **D-017b** —
   * `recorded` draws no process fact: nothing is doing anything in it here, and the plate says only
   * what the one state says.
   */
  phase: SessionPhase | null
  /** The host's word about the session. Never re-derived from a count (080). */
  status: SessionStatus | null
  activity: TranscriptState['activity']
  /** `control.streamingId !== null` — text is arriving right now. */
  streaming: boolean
  /** The host's word about the PROVIDER, which is what BEING is about. */
  liveness: LivenessState | null
  needing?: Needing
  /**
   * ⛔ **Is anything this session started still running outside the turn** (250).
   *
   * ⚠️ **Ask {@link somethingRunning} for it; do not compute it here.** The registry it reads carries
   * two facts — the rows it can name and the rows it was told about and cannot — and a caller that
   * checked only `running.length` would answer *"idle"* on the one payload the provider had already
   * said was short. One predicate, every consumer asks it (`223`).
   */
  detached?: boolean
  /**
   * ⛔ **Is anything scheduled** (258) — see {@link AgentFacets.scheduled}.
   *
   * ⚠️ **Ask `scheduleHeld` for it; do not compute it here.** It folds in the `dropped` count — a
   * level can name rows this app cannot list — and a caller that checked only `jobs.length` would
   * answer *"idle"* on the one payload the provider had already said was short.
   */
  scheduled?: boolean
  /**
   * ⛔ **The one wait this conversation is in** (636) — see {@link AgentFacets.waiting}.
   *
   * ⚠️ **Ask {@link theWaitIn} for it; do not compute it here.** It is the only place the three
   * absences of `whatEachConversationIsWaitingOn` are told apart, and a caller that read
   * `row?.waiting` itself would answer `undefined` for *the poll has not landed* and for *the
   * reading says nothing is outstanding* out of one expression — which is the collapse
   * {@link WaitReading} exists to refuse.
   */
  waiting?: ConversationWait
  /** ⚑ **D-006** — {@link AgentFacets.work}; ask `theWorkIn` for it, as {@link waiting} asks `theWaitIn`. */
  work?: HeldWork
  /**
   * ⚑ **D-017 · R19 — every card this conversation is parked on went to ANOTHER conversation**,
   * which owes its answer — ask {@link parkedOnAnotherAnswer}. ⚑ The agent is then doing nothing:
   * its DOING is `idle`, `636`'s honest face for a conversation another agent owes the next move,
   * and its state *waiting on an answer from <name>* — never *active*, as `main` says of a turn
   * parked on a card.
   */
  parkedOnAnotherAnswer?: boolean
  /** ⚑ **F036 · the eighth facet** — see {@link AgentFacets.owes}. */
  owes?: readonly [string, ...string[]]
}

/**
 * ⚑ **D-017b · nothing is doing anything in it here** — a conversation drawn from its ledger, or one
 * whose fold or provider has said it stopped. ⛔ A stop ends nothing, so this is never drawn as a
 * word or a ring of its own: the plate says `idle` and the one state says the rest. ⚑ A view drawn
 * from its ledger that the one list names draws the HOST's state instead (`facetsOfState`, as its
 * row does): its page is not the present, and another window may be working in it.
 *
 * ⚠️ **The channels land in either order, and both facets have to agree about it** — the fold's
 * `status` and the provider's `liveness` are published separately, so one predicate is asked by both.
 */
function nothingDoingHere(input: SessionFacetInput): boolean {
  return (
    input.phase === 'recorded' ||
    input.status === 'ended' ||
    input.status === 'errored' ||
    input.liveness === 'ended' ||
    input.liveness === 'errored'
  )
}

/** The activity phase this app publishes, and which DOING each one is. */
type ActivityPhase = NonNullable<TranscriptState['activity']>['phase']

/**
 * Which DOING an activity phase means — the map, so that the two readers of `activity` cannot
 * disagree about what a phase is.
 *
 * `waiting` is an activity phase but not a DOING: what it is waiting FOR is the NEEDING badge's
 * job, and a seventh face for it would say the same thing twice in two grammars.
 */
const DOING_OF_PHASE = {
  thinking: 'thinking',
  tool: 'tool',
  compacting: 'compacting',
  waiting: 'working',
} as const satisfies Record<ActivityPhase, Doing>

/**
 * What the agent is doing, from the fields that know.
 *
 * ⚠️ **`status` FRAMES and `activity` REFINES — this order is the whole of 099, and it is the third
 * time this app has got the same class of thing wrong.** The three incidents are one bug:
 *
 *  - **042** — idle while a workflow was still running. Fixed by making the persisted status a view
 *    of the turn table instead of a fourth opinion.
 *  - **089** — the pill said "running Bash" while the model was already replying. Fixed by putting
 *    `streaming` above `activity`, immediately below.
 *  - **099** — the plate said `working` at a quiet conversation while the top bar said `Idle`.
 *
 * Each time the loser was a fact with a defined END and the winner was one without. That is the
 * rule this function now states: **a fact that closes itself beats a fact that does not.**
 * `streaming` closes at `assistant_message`; `status` is derived from the turn table, which opens
 * and closes with a reason and is repaired on resume and at startup. `activity` is a fire-and-forget
 * notification with no ending of its own — the `turn` event clears the one that described that turn
 * and `user_turn` refuses to inherit one into the next, but between those two nothing does, so one
 * that arrives when no turn is open survives until the next prompt.
 *
 * Activity can arrive outside an open turn, including when a background child finishes. With no turn to clear it, a fire-and-forget activity value can remain indefinitely; it must not promote an idle conversation to busy.
 *
 * So `activity` can no longer PROMOTE an idle session to a busy one. It says what KIND of busy a
 * session the host already calls busy is. The direction that made 042 is measured shut rather than
 * argued shut: on the wire `status: working` lands *before* `user_turn`, which lands before the
 * first `activity` — 19:08:33.565 / .566 / .576, and the same order at every turn boundary in the
 * ledger — so there is no window in which `activity` is the fresher fact.
 *
 * ⚠️ **WHAT THIS COST, said plainly, because it was a real cost and review named it.** A background
 * sub-agent that was genuinely running read as `idle` on every surface, because the host was
 * genuinely not driving a turn. That is 042's ruling — *"idle means we are no longer driving a
 * turn"* — and it was deliberate, but it was not free.
 *
 * The alternative was believing `activity` again, and that is what put `working` on a conversation
 * that had been finished for a minute and a half. Between an answer that is briefly too quiet and
 * one that is indefinitely too loud, this took the first — and this comment then named the way out:
 * *"the honest way to remove the trade is a signal that says 'the provider is busy outside a turn',
 * which the app does not have and must not invent (035)."*
 *
 * ⚑ **123 built that signal, and nothing in this file had to change to read it.** `SessionMachine`
 * now derives `working` from the MAIN agent's content arriving with no turn open — a fact with a
 * measured ending (the burst's own `result`), unlike `activity`, which is why one may be latched on
 * and the other may not. So the `status` this function reads is already true while the main agent
 * works outside a turn (a notification turn, a backgrounded command waking it), `activity` is
 * allowed to refine it exactly as it refines a turn, and the four-minute silence 122 measured in
 * `sess_6b4380fa` reads as what it was.
 *
 * ⚠️ **The trade's own case is not that signal's** (D-040): a background sub-agent's content opens
 * no burst, so `status` stays `idle` and this function says `idle`, which is true of the agent; the
 * words say *running in the background* through the background level ({@link AgentFacets.detached},
 * 250, D-013). The trade above is gone either way; the ORDER that removed 099 is untouched, and
 * must stay — `activity` still refines and never promotes.
 *
 * Give `streaming` priority over both activity and status. Tool activity may lag behind an arriving reply, and text can continue after a turn-completed event; the current delta is the freshest evidence of replying.
 *
 * ⚠️ **This is the ONLY answer to "what is it doing right now" in the app** (089). The activity pill
 * used to read `activity.phase` itself and therefore said "running Bash" into the middle of the
 * reply — the same fact, derived twice, disagreeing. The pill now renders {@link activityLine},
 * and the two WORD surfaces render {@link standingOf}, so there is one rule and one place to fix it.
 *
 * ⚑ **`575` widened who can FEED it and did not add a second one.** Until then `activity` and
 * `streaming` existed only inside the window streaming that one conversation, so every list passed
 * them empty; `WhatIsBeingDone` carries both for every conversation the host is running, and
 * `whatAPlateCanDraw` hands them here. ⛔ **That read composes no word of its own** — it has no
 * `Doing`, no map and no function that returns one — precisely so this sentence stays true.
 */
export function sessionDoing(input: SessionFacetInput): Doing {
  if (nothingDoingHere(input)) return 'idle'
  if (input.streaming) return 'replying'
  // ⚑ **D-017 · R19 — parked on a card another conversation answers**: the agent is doing nothing
  // (see {@link SessionFacetInput.parkedOnAnotherAnswer}).
  if (input.status === 'waiting_permission' && input.parkedOnAnotherAnswer === true) return 'idle'
  // The host's word about whether a turn is being driven at all. Below this line the session is
  // busy, and `activity` is allowed to say what kind of busy.
  if (input.status === 'working' || input.status === 'waiting_permission') {
    const refined = input.activity ? DOING_OF_PHASE[input.activity.phase] : undefined
    return refined ?? 'working'
  }
  if (input.status === 'idle') return 'idle'
  // No word from the host, so no claim — 081's faceless ring rather than a confident face (099 §3).
  return 'unknown'
}

/* ---------------------------------------------------------------------------
   The coarse word — the same answer, for a surface that has room for one word
   --------------------------------------------------------------------------- */

/**
 * What a TEXT surface says about a session — the top bar's pill and the rail row's word (099).
 *
 * Use the plate's shared derivation for status words too. Reading raw fold status independently can make the header and rail say Idle while {@link sessionDoing} renders a working plate.
 *
 * ⚠️ **It takes {@link AgentFacets}, not {@link SessionFacetInput}, and that is deliberate.** A
 * function of the facets is a PROJECTION of the answer the plate is already drawing; a function of
 * the input would be a second derivation, which is the thing being removed. There is no arrangement
 * of arguments by which this can disagree with the plate — it cannot see the fields the plate reads.
 */
export const STANDINGS = [
  'unknown',
  'idle',
  /**
   * ⛔ **Not driving a turn, and something it started is still running** (250) — see
   * {@link AgentFacets.detached}.
   *
   * ⚠️ **A distinct word rather than a re-used `working`**, and the reason is what a person READS,
   * not what the app would then do.
   *
   * ⛔ **An earlier draft of this note gave two reasons and the adversarial pass over 250's diff
   * falsified both.** It said `working` here would make *"the composer read as busy"* and the pill
   * *"pulse blue"*. Neither is a thing this app does: nothing gates the composer on `standingOf` —
   * `ConversationPane` reads its state off the conversation (`composerState`) and computes the
   * frozen hint from `control.pending` (⚠️ **737 · corrected**: this said it disabled the composer
   * on `record.busy || control.ended`, which is the plan-leave button's guard) — and `.liveness.live` sets border, background and colour with no
   * animation anywhere. The tone `background` takes IS `live`, deliberately, so the pill already
   * looks the same as a working one.
   *
   * ⚑ **The real reason is the sentence.** `working` claims the agent is taking a turn, and it is
   * not; the rail would print `claude · working` at a conversation whose composer is free, which is
   * `042`'s lie in the other direction. This word says both true things at once — the conversation
   * is yours again AND the machine is not finished — and it is `248`'s own, so a person meets one
   * phrase for one fact (`222` §4).
   */
  'background',
  /**
   * 🔴 **F036 · not driving a turn, and ANOTHER AGENT waits on an answer from this one** — see
   * {@link AgentFacets.owes}. ⚑ Where the one order ranks it: below *waiting on an answer*, above the
   * background and the schedule — a question put to it holds its asker, and only it can move that.
   * ⛔ Not `elsewhere`: that family is *another agent owes the next move*, and here this one owes it.
   * ⛔ No new tone or mark, `elsewhere`'s rule: the WORD is the fix.
   */
  'owes',
  /**
   * 🔴 **Not driving a turn, nothing running, and something will wake it later** (258) — see
   * {@link AgentFacets.scheduled}.
   *
   * Represent a pending schedule even when the background registry is empty.
   *
   * ⚠️ **Below `background` on purpose, and the order is a fact rather than a taste.** Something
   * RUNNING is happening now; something scheduled is not happening at all yet. With both true, the
   * one word this surface has must name the one a person could still act on — and `248`'s bar is
   * the only one of the two with a Stop button behind it.
   *
   * ⛔ **And it is a distinct word rather than a re-used `idle`, which is the entire complaint.**
   * `042`'s ruling stands untouched: *"idle means we are no longer driving a turn"*, and that is
   * still true here — the plate keeps the idle face. What was never true is that a one-word surface
   * could stop there while the machine had a 2 a.m. appointment.
   */
  'scheduled',
  /**
   * 🔴 **THE WORD `621` REFUSED TO CHOOSE, AND THIS IS THE CHOICE** (636, `621` §5.2 ·
   * `HO-096` §4) — not driving a turn, and **the next move belongs to ANOTHER AGENT.**
   *
   * ⛔ **`621` stopped exactly here and said why:** *"`waiting-on-a-worker` must NOT become the
   * `waiting` standing. It asks nobody for anything; the renderer needs a new word and that is a
   * design decision I did not make."*
   *
   * ## ⚑ What the word has to be true of — TWO of a conversation's waits, and the pair is provable
   *
   * ⛔ **`waiting-on-a-worker`** — this conversation handed work out and that work is still open.
   * The holder of handed-out work is always an AGENT: `RuntimeHost.recordTheGive` is the one
   * writer of `work_given`, and every one names an owner that is an agent's conversation — a
   * give's, or one that took a person's request on (`take_on_work`, D-016 · commit 6) — ⚠️ **so a
   * person can never be the worker.**
   *
   * ⛔ **`waiting-on-an-answer`** — this conversation asked about work it HOLDS and nobody has
   * answered. The answerer is the conversation that gave it that work — an agent; a question about
   * work a person gave goes to a person, which the host's verdict reads as *needs you* first
   * (`theWaitAsTheHostOwesIt`).
   *
   * 🔴 **So both are *another agent owes the next move*, and NEITHER is ever a person's** — which
   * is precisely why neither may be a {@link Needing} (*what the agent needs FROM YOU*) and why
   * neither may raise `waiting`. ⚑ The third, `waiting-on-a-person`, is a person's by
   * construction and raises `waiting` — {@link waitSummonsAPerson}.
   *
   * ## ⚠️ One member and not two, and the shape it copies is `waiting`'s
   *
   * ⛔ **`background` and `scheduled` are two words because they are two facts a person acts on
   * differently** — one has a Stop button behind it, the other has an appointment. ⚑ **These two
   * are one fact at this altitude**: nobody at this machine can move either of them along, and
   * `081`'s rule for a one-word surface is that it says the most important thing rather than every
   * thing. ⚠️ **The distinction is not lost** — it is where `waiting`'s is, in
   * {@link standingWord}, which names WHICH wait exactly as it names which needing.
   *
   * ## ⛔ It brings no new badge, no new glyph and no new tone
   *
   * ⚑ `250`'s rule, applied twice over: *"inventing a mark would be a design decision this
   * dispatch has no design behind"*. ⚠️ See {@link STANDING_TONE}, where the blank is argued rather
   * than defaulted.
   *
   * ## ⚑ D-017 · where each of the two ranks — the one order's answer, not this file's
   *
   * ⚑ **`waiting-on-an-answer` is the one state's *waiting on an answer from <name>*** (R19) — a
   * card routed to another conversation reaches it too ({@link theWaitHere}) — so it ranks where
   * {@link agentStateArm} ranks it: above the background and the schedule. ⚑ **D-036 ·
   * `waiting-on-a-worker` is the one state's *waiting on <name>*** — work it gave out, still open —
   * and ranks where this standing always ranked it: below the schedule, above *idle*.
   */
  'elsewhere',
  /**
   * 🔴 **D-006 · F018 — idle, and the work it holds is not being worked on** — see
   * {@link AgentFacets.work}. ⚑ **Below `background`, `scheduled` and both `elsewhere`s**: each of
   * those is something that will move it (a process, a wake-up, another agent), and this is the
   * state with nothing to. ⛔ No new tone or mark, `elsewhere`'s rule: the WORD is the fix.
   */
  'stalled',
  /**
   * The idle agent's latest assigned work is answered. Rank stalled open work above answered work.
   */
  'answered',
  'working',
  'waiting',
] as const
export type Standing = (typeof STANDINGS)[number]

/**
 * 🔴 **Which of the waits is a PERSON's — the single-member split, in ONE place** (636).
 *
 * ⛔ **`summonsAttention`'s shape, one vocabulary over, and for its reason exactly**: `446` had to
 * widen four copies of a closed set for one new member, and `037`'s rule is that a rule stated in
 * two places is a rule free to be forgotten in one.
 *
 * `waiting-on-a-person` means an unresolved permission or question only the person can settle. It matches `NEEDINGS`, raises waiting, joins the rail's needing count and uses the attention color.
 *
 * 🔴 **It is NOT a double count.** A permission parked in this conversation already
 * reaches `waiting` through `control.pending` and {@link needingFor}; what this ADDS is the case
 * that fold cannot see — `passQuestionUp` writes `request_routed{to:'a-person'}` into the passer's
 * ledger and the transcript draws no card for it (`394`'s ruling, reaffirmed at `437`), so
 * `pending` is 0 while a person genuinely owes an answer. ⛔ **That is `621` F2, and this line is
 * the half of it a facet can close.**
 *
 * ⚑ **A conversation's wait only** — the cast asked it of a piece's state for `654`'s tint, which
 * went with the given-out lines (PM ruling, 2026-10-01). ⛔ So *replied* — a piece a person gave,
 * whose owner's turn ended with it open (F083: it read *waiting on you* until then) — cannot be
 * handed it: the type keeps it out, and it is said on the piece only and is never *needs you* (plan
 * ruling 9).
 */
export function waitSummonsAPerson(waiting: ConversationWait | undefined): boolean {
  return waiting === 'waiting-on-a-person'
}

export function standingOf(facets: AgentFacets): Standing {
  // ⚑ **D-017b · no standing says whether it stopped** (`05` rule 5): a conversation nothing is
  // doing anything in reads by the one state, like any other.
  //
  // ⚠️ **Blocked on you outranks the DOING, because it is the more specific fact and the one that
  // has to reach the user** (063/079 §5). An open permission or question is proof a turn is in
  // flight whatever the status column has caught up to; `plan` is deliberately not here, since a
  // go-ahead blocks nothing and can be pressed whenever.
  //
  // Rank needing attention above background work: a permission freezes the composer while detached work blocks nothing. Keep {@link summonsAttention} as the shared predicate, also used by `SessionShelf.vue`. `agent-state.test.ts` and `status-agreement.dom.test.ts` retain independent expected values.
  //
  // 🔴 **636 · and what a person owes that this record cannot see joins it here** (`621` §5.2) —
  // ⚑ **D-017 · R19: as the HOST read it**, carried on the wait (`theWaitIn`): a question asked of a
  // person or passed up to one, a decision, a rules ask. ⚑ **It is an OR and not a second branch**
  // because the two sources answer one question: a card parked in this conversation reaches it
  // through `pending`, and the rest through the ledger read `pending` cannot see. ⚠️ See
  // {@link waitSummonsAPerson}, where the not-a-double-count argument lives.
  //
  // ⚑ **D-017 · R11 — ranked by the ONE order** ({@link agentStateArm}, `shared/agent-state.ts`),
  // the one `list_agents` and `get_agent_status` rank this conversation by: *needs you*, *active*,
  // *waiting on an answer from <name>* (R19), *running in the background*, *scheduled*, *waiting on
  // <name>* (D-036), *idle*. ⚑ This standing only maps its arms onto the words a one-word surface
  // has, and refines two of them: `unknown` (the host has said nothing) and an idle plate's work
  // (D-006).
  const arm = agentStateArm(armFactsOf(facets))
  if (arm === 'needs-you') return 'waiting'
  // ⚠️ **`unknown` keeps its precedence, deliberately** (250). It means the host has said nothing
  // about this session at all, and *"we do not know what this is doing"* is a larger caveat than
  // *"and something is running"*. `081`'s faceless ring is a refusal to claim, and a refusal that
  // can be talked over by a smaller fact is not one.
  if (facets.doing === undefined || facets.doing === 'unknown') return 'unknown'
  switch (arm) {
    // Every busy DOING is a kind of working, which is exactly what a one-word surface can say.
    // ⚠️ **A working session with background work stays `working`, and that is not a gap.** The
    // word is already true, the registry is on screen underneath it, and `081`'s rule for a
    // one-word surface is that it says the most important thing rather than every thing.
    case 'active':
      return 'working'
    // 🔴 **636 · R19 — another agent owes this conversation an answer**: `HO-095` §5.1's *"BroBot's
    // header, avatar and rail row read `Idle` while Task #1 was being worked on by Ada"*, one wait
    // over. ⚑ Above the background: an unanswered question holds the conversation.
    case 'waiting-on-an-answer':
      return 'elsewhere'
    // ⚑ **F036 · another agent waits on an answer from this one** — its own standing, ranked where
    // the one order ranks it: below *waiting on an answer*, above the background.
    case 'owes-an-answer':
      return 'owes'
    // Rank background above scheduled: work happening now takes precedence over a future wake and has a Stop action. Neither should be flattened to idle.
    case 'in-the-background':
      return 'background'
    case 'scheduled':
      return 'scheduled'
    // ⚑ **D-036 · work it gave out is still open** — the one state's own arm now, ranked where this
    // standing always ranked it (below the schedule), and said with who holds it.
    case 'waiting-on-a-worker':
      return 'elsewhere'
    // For an idle plate, distinguish stalled open work from work already answered rather than interpreting every idle agent as stuck.
    case 'idle':
      if (facets.work?.state === 'stalled') return 'stalled'
      return facets.work?.state === 'answered' ? 'answered' : 'idle'
  }
}

/**
 * ⚑ **D-017 · R11 — the facets as the one order's questions** ({@link agentStateArm}), asked by
 * {@link standingOf} and {@link stateHere} alike so the word and the state cannot rank one
 * conversation's facts two ways.
 *
 *  - **needs you** — a live card here that a person answers ({@link summonsAttention}),
 *    or the wait the HOST says is a person's ({@link waitSummonsAPerson}) — ⚑ **D-017 · R19: its
 *    verdict, not this window's** (`theWaitIn`, off `ConversationWaiting.needsYou`): a question asked
 *    of a person or passed up to one, a decision, a rules ask, which this window may not hold.
 *    ⚠️ A card routed to another conversation is not a person's (R19): the needing handed in here has
 *    already left it out ({@link forAPerson}).
 *  - **active** — a DOING that is a kind of working; `unknown` is not one.
 *  - **waiting on an answer** — the wait the host says another conversation owes (R19), which it
 *    names (`whoseAnswerIn`).
 *  - **owes an answer** — F036 · another conversation waits on this one's answer, as the host's
 *    state says it ({@link AgentFacets.owes}).
 *  - **the background and the schedule** — the two facets the registries feed.
 *  - **waiting on a worker** — the wait the host says holds work this one gave out (D-036), whose
 *    holders it names (`whoseWorkIn`).
 */
function armFactsOf(facets: AgentFacets): AgentStateArmFacts {
  return {
    needsYou: summonsAttention(facets.needing) || waitSummonsAPerson(facets.waiting),
    active: facets.doing !== undefined && facets.doing !== 'idle' && facets.doing !== 'unknown',
    waitingOnAWorker: facets.waiting === 'waiting-on-a-worker',
    waitingOnAnAnswer: facets.waiting === 'waiting-on-an-answer',
    owesAnAnswer: facets.owes !== undefined,
    inTheBackground: facets.detached === true,
    scheduled: facets.scheduled === true,
  }
}

/**
 * ⚑ **F023 · which of the two things it left behind the plate's mark shows** — a command running in
 * the background or a scheduled wake-up — ⚑ **D-017 · R11: ranked by the ONE order**
 * ({@link agentStateArm}): the background first, as every word reads them. `null` for neither.
 */
export function workLeftBehind(
  facets: Pick<AgentFacets, 'detached' | 'scheduled'>,
): 'background' | 'scheduled' | null {
  const arm = agentStateArm({
    needsYou: false,
    active: false,
    waitingOnAnAnswer: false,
    inTheBackground: facets.detached === true,
    scheduled: facets.scheduled === true,
    waitingOnAWorker: false,
  })
  return arm === 'in-the-background' ? 'background' : arm === 'scheduled' ? 'scheduled' : null
}

/**
 * ⚑ **D-017 · R11 — this conversation's ONE state, off what this window holds of it**
 * ({@link agentStateOf}) — the state `list_agents` reports, with its details: what it left running,
 * when it next wakes, whose answer it waits on, and who holds the work it gave out. ⚑ The rail row,
 * the plate and the palette word the arms that carry a detail from it ({@link standingWord}), so
 * none of them derives a detail of its own.
 *
 * @param answerFrom what the HOST calls the conversation a question it asked went to (R19,
 *   `whoseAnswerIn` over the same reading the wait came from), or `null` — the state then says only
 *   what the other facets do.
 * @param workWith ⚑ D-036 · what the HOST calls each conversation holding open work this one gave
 *   (`whoseWorkIn`, over the same reading), or none — the state then says only what the other
 *   facets do.
 * @param since when each wait began, as the HOST read it (`whenItsWaitsBeganIn`, and
 *   `whenItOwedIn` off its listed state); a wait whose start is not given carries none.
 * @param stopped the pieces it gave whose holder stopped with them open (`stoppedWorkIn`, over the
 *   same reading), or none.
 */
export function stateHere(
  record: Pick<SessionRecord, 'control' | 'transcript' | 'window'>,
  facets: AgentFacets,
  answerFrom: string | null,
  workWith: readonly string[],
  since: {
    readonly answer?: number | null
    readonly owes?: number | null
    readonly work?: number | null
  } = {},
  stopped: readonly StoppedPiece[] = [],
): AgentState {
  const { needsYou, active, waitingOnAnAnswer, waitingOnAWorker } = armFactsOf(facets)
  return agentStateOf(
    {
      needsYou,
      active,
      waitingOnTheAnswerOf: waitingOnAnAnswer ? answerFrom : null,
      waitingOnTheAnswerSince: waitingOnAnAnswer ? since.answer : null,
      // ⚑ **F036** — who waits on its answer, as the host's state names them.
      owesAnAnswerTo: facets.owes ?? [],
      owesAnAnswerSince: since.owes,
      background: record.control.background,
      scheduled: scheduleHere(record),
      waitingOnTheWorkOf: waitingOnAWorker ? workWith : [],
      waitingOnTheWorkSince: waitingOnAWorker ? since.work : null,
      stoppedWork: waitingOnAWorker ? stopped : [],
    },
    Date.now(),
  )
}

/**
 * ⚑ **D-017 · R11 — the schedule this window can stand behind.**
 *
 * ⛔ **A one-shot's time only where this fold holds the conversation from its first event.** A
 * one-shot fires at the first match after it was FIRST listed (`nextWake`), and the fold knows that
 * moment only when it saw the ledger from the start — `!record.window.hasOlder` on the one fold,
 * {@link SessionRecord.opening}'s own rule. ⚠️ A conversation reopened part-way through its history
 * first sees a job at a later restatement, and would promise a passed one-shot's time a year on;
 * there the job keeps no first listing and its word is plain *scheduled* — saying less, where
 * `main` reads the first listing off the whole ledger.
 */
function scheduleHere(
  record: Pick<SessionRecord, 'control' | 'transcript' | 'window'>,
): ScheduleLevel {
  const schedule = record.control.schedule
  if (record.control === record.transcript && !record.window.hasOlder) return schedule
  return { ...schedule, jobs: schedule.jobs.map((job) => ({ ...job, listedSince: undefined })) }
}

/**
 * ⚑ **D-017 · R19 — the cards a PERSON owes an answer to**: every card waiting here but those this
 * app routed to another conversation ({@link TranscriptState.routedAway}), which that one answers.
 */
export function forAPerson(
  waiting: { readonly permissions: number; readonly questions: number },
  routedAway: RoutedAway | undefined,
): { permissions: number; questions: number } {
  return {
    permissions: waiting.permissions - (routedAway?.permissions ?? 0),
    questions: waiting.questions - (routedAway?.questions ?? 0),
  }
}

/**
 * ⚑ **D-017 · R19 — is every card this conversation waits on one another conversation answers** —
 * the cards {@link forAPerson} leaves are none, and one went elsewhere.
 */
export function parkedOnAnotherAnswer(
  yours: { readonly permissions: number; readonly questions: number },
  routedAway: RoutedAway | undefined,
): boolean {
  return routedAway !== undefined && yours.permissions === 0 && yours.questions === 0
}

/**
 * ⛔ **What a whole conversation's plate and word are drawn from — ONE derivation** (082, 099;
 * lifted out of `SideRail.vue` by 205).
 *
 * ⚑ **It moved here the moment a second surface needed it.** 205's attention queue describes the
 * same conversations the rail does, and a copy of these nine lines two components apart is exactly
 * the second derivation 099 spent a dispatch removing — the rail said `idle` while the pane said
 * `working` about one session. One function, two callers, no way to disagree.
 *
 * The original note, kept because it is still the reason the rail draws a plate at all:
 *
 * ⚠️ **The generic chat glyph is gone from these rows and this is what replaced it.** Every open
 * conversation showed the same `#i-chat`, which said "a conversation" — something the section
 * heading already said — while the one thing that differs between two rows, what each agent is
 * doing, was a word in 9.5px grey at the end of a line that ellipsizes. The plate carries it at a
 * glance and the word stays where it was, so nothing that reads this row's text changes.
 *
 * Read from CONTROL because the rail describes conversations that are mostly not the one on screen
 * (064).
 */
export function recordFacets(
  record: SessionRecord,
  /**
   * 🔴 **636 · the one fact this record CANNOT hold, handed in** — see {@link AgentFacets.waiting}.
   *
   * ⛔ **Optional, and an omitted argument means *nothing was read*, never *nothing is
   * outstanding*.** ⚑ That is what lets a caller with no poll behind it — `RuntimeScreen`'s
   * attention queue is one — keep calling this with one argument and keep getting exactly the
   * answer it got before, rather than a widened one it never asked for
   * (`an-entitlement-widening-must-be-opt-in-at-the-call-site`, on a derivation).
   *
   * ⚠️ **Narrowed by {@link theWaitIn} before it arrives**, because the three absences may only be
   * collapsed in one place.
   */
  waiting?: ConversationWait,
  /** ⚑ **D-006** — `theWorkIn` of the same reading `waiting` is read from; optional for the same reason. */
  work?: HeldWork,
  /** ⚑ **F036** — who waits on its answer (`whoItOwesIn`); optional for the same reason. */
  owes?: readonly [string, ...string[]],
): AgentFacets {
  // ⚠️ **THE SAME FUNCTION THE PANE CALLS, ON THE SAME NUMBERS** (099). This used to scan the
  // transcript with `pendingKind`, gated on `status === 'waiting_permission'` so it did not walk
  // every item on every render — and that gate is what made the rail's answer a SECOND derivation.
  // It was measurably behind: across every permission this app has recorded, 33 of 33, the CARD
  // arrives BEFORE the status event, so the gate was shut for exactly the window in which the
  // answer had already changed.
  //
  // ⚠️ **Widening the gate was the wrong fix and review caught it.** Gating on `requestItems`
  // instead made the answer right and made the rail depend on `state.items`, which every streaming
  // delta mutates — so the whole rail re-rendered several times a second for any conversation that
  // had ever asked one permission, forever, since nothing prunes that map. Correct and expensive is
  // not better than wrong and cheap; it is a different bug.
  //
  // `control.pending` is the fold's own count, recomputed only when a request changes state. Reading
  // it is O(1), touches nothing a delta writes, and is the identical input `ConversationPane` gives
  // `needingFor` — so the rail and the pane cannot answer differently, which is the whole task.
  // ⚑ **D-017 · R19 — less the cards routed to another conversation** ({@link forAPerson}), which
  // that one answers: the pane subtracts the same count.
  const yours = forAPerson(record.control.pending, record.control.routedAway)
  const needing = needingFor({
    permissions: yours.permissions,
    questions: yours.questions,
    planNeedsGoAhead: record.meta?.planNeedsGoAhead ?? false,
  })
  return sessionFacets({
    phase: record.phase,
    status: record.control.status,
    activity: record.control.activity,
    streaming: record.control.streamingId !== null,
    liveness: record.meta?.liveness.state ?? null,
    ...(needing ? { needing } : {}),
    parkedOnAnotherAnswer: parkedOnAnotherAnswer(yours, record.control.routedAway),
    // ⛔ **From CONTROL, like every other field here, and that is what makes the RAIL able to say it**
    // (250, on 064). The registry lands on whichever projection folded the event, and `acceptEvent`
    // folds into `control` on both of its branches — so a conversation the reader is not looking at,
    // or has scrolled back inside, still knows what it left running. A rail that read `transcript`
    // would go quiet about every conversation but one, which is the class of bug 064 exists for.
    //
    // ⚑ It is also O(1): two number reads on a field only a level payload writes, so this stays off
    // the streaming hot path exactly as `control.pending` does (203).
    detached: somethingRunning(record.control.background),
    // ⛔ **The fifth, from CONTROL like every other field here — and that is what lets the RAIL say
    // it** (258, on 064). A schedule is republished only at turn END, so a conversation the reader
    // is not looking at may hold a level nothing will restate for minutes; reading `transcript`
    // would go quiet about every conversation but one, which is the class of bug 064 exists for.
    //
    // ⚑ O(1): a length and a count on a field only a level payload writes, so this stays off the
    // streaming hot path exactly as `control.pending` does (203).
    scheduled: scheduleHeld(record.control.schedule),
    // ⛔ **The sixth, and the ONLY one on this list that is not read off `record`** (636) — which
    // is the whole reason it is a parameter. ⚑ `control` is this window's fold of THIS
    // conversation's ledger, and a child's `work_replied` is written into the CHILD's ledger, so
    // `RuntimeScreen`'s own note holds: *"the conversation that gave the work is told nothing at
    // all when the work moves."* ⚠️ No fold and no push can produce it; only a read can.
    // ⚑ **D-017 · R19 — the HOST's verdict on who owes it the next move rides here** (`theWaitIn`):
    // a person's (*needs you*), another conversation's answer, or ⚑ D-036 the reply to work it gave
    // out — never this record's own reading.
    ...(waiting ? { waiting } : {}),
    ...(work ? { work } : {}),
    ...(owes ? { owes } : {}),
  })
}

/**
 * ⚑ **D-017b · the plate of a conversation this window is not fed** — the one state the host says of
 * it (`ResumableSessionInfo.state`), as the facets a plate draws. ⛔ **Nothing is added**: whose answer
 * it waits on, who holds the work it gave out and what runs in its background travel on the state
 * and are worded from it ({@link agentStateWords}); the plate only takes the arm, so it cannot say
 * a second thing.
 */
export function facetsOfState(state: AgentState, needs?: Needing): AgentFacets {
  switch (state.is) {
    // The state says it needs a person and not for what: a caller that knows the kind gives it,
    // and without one no kind is claimed. The plate marks the wait on a person either way.
    case 'needs-you':
      return {
        doing: 'idle',
        waiting: 'waiting-on-a-person',
        ...(needs === undefined ? {} : { needing: needs }),
      }
    case 'active':
      return { doing: 'working' }
    case 'waiting-on-an-answer':
      return { doing: 'idle', waiting: 'waiting-on-an-answer' }
    // ⚑ **F036** — an idle plate whose eighth facet says who waits on its answer.
    case 'owes-an-answer':
      return { doing: 'idle', owes: state.to }
    case 'in-the-background':
      return { doing: 'idle', detached: true }
    case 'scheduled':
      return { doing: 'idle', scheduled: true }
    case 'waiting-on-a-worker':
      return { doing: 'idle', waiting: 'waiting-on-a-worker' }
    case 'idle':
      return { doing: 'idle' }
  }
}

/**
 * ⛔ **What a row SAYS, which is the standing except that *needs you* names what it is waiting for**
 * (203, from 195 H3).
 *
 * `standingOf` folds an open permission and an open question into one standing, `waiting`, and that
 * fold is correct for a one-word surface — but the words that tell them apart existed ONLY in
 * {@link accessibleName}. `NEEDING_WORD.permission` was *"waiting on you (permission)"*; a sighted
 * person read `codex · waiting` for both, and the two are not the same ask: a permission FREEZES the
 * composer (063), a question holds the turn.
 *
 * ⚠️ **`plan` is deliberately absent from this** — from `waiting`'s own needing, and from the
 * detail beside *needs you* when the host reports a person's wait and a go-ahead is open. A go-ahead
 * blocks nothing and can be pressed whenever — {@link standingOf} says so — so a row holding one
 * keeps its own doing word and wears the green check on its plate. Naming it here would be a second,
 * louder opinion than the one the design settled.
 */
export function standingWord(facets: AgentFacets, state?: AgentState): string {
  const standing = standingOf(facets)
  // ⚑ **F036 · *owes an answer to <name>*, in the one state's words** — off the state where the
  // caller holds it, else off the facet, which carries the same names.
  if (standing === 'owes') {
    if (state?.is === 'owes-an-answer') return agentStateWords(state)
    return facets.owes === undefined
      ? standing
      : agentStateWords({ is: 'owes-an-answer', to: facets.owes })
  }
  // ⚠️ **F023 re-worded this row's background word from `248`'s *still running*** to the PM's
  // *running in the background · <command>* — the registry's own head and the tool card keep
  // `BACKGROUND_WORD.running`; this is the ONE word every surface drawing an agent shows (rail row,
  // plate, palette), so those still cannot disagree with each other. The ENUM stays `background` —
  // `data-standing` is a key, and a key with a space in it is a key nobody can select on.
  // ⚑ **F023 · one state everywhere the agent appears, with the detail a person needs** — the
  // background command, and the time it next wakes (BroBot's findings: the rail said *scheduled*
  // while the plate said *idle*, and neither said what or when). ⚑ **D-017 · R11 — the one state's
  // own words** ({@link agentStateWords} of {@link stateHere}), the ones an agent reads about this
  // conversation, with its details; ⚠️ a caller that holds no state gets the arm's plain word.
  if (standing === 'background')
    return agentStateWords(
      state?.is === 'in-the-background' ? state : { is: 'in-the-background', what: null },
    )
  if (standing === 'scheduled')
    return agentStateWords(state?.is === 'scheduled' ? state : { is: 'scheduled', dueAt: null })
  // 🔴 **636 · the family is ONE standing and the row still says WHICH wait** — `waiting`'s own
  // shape three lines down, and the reason is the same: the fold is correct for a one-word
  // surface, and the words that tell the members apart may not live only in
  // {@link accessibleName}. ⛔ *waiting on a worker* and *waiting on an answer* are not the same
  // fact — one has nobody to chase and the other has the agent that gave this work out.
  //
  // ⚑ **`WORK_STATE_WORD` and not a phrase written here** — see this file's import, and `222` §4.
  // ⚠️ The ENUM stays `elsewhere`: `data-standing` is a key, and a key with a space in it is a key
  // nobody can select on (`250`'s line for `background`, which holds for every member).
  //
  // ⚠️ **The `undefined` arm is UNREACHABLE by construction** — {@link standingOf} returns
  // `elsewhere` only for the one order's two arms read off `facets.waiting` (`waiting-on-an-answer`
  // and `waiting-on-a-worker`, {@link armFactsOf}), and an absence is neither. ⛔ It is written
  // rather than cast because a `!` here would be this file asserting an invariant it does not hold,
  // and it is PINNED as an invariant instead of left as a claim
  // (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, answered by an assertion over
  // `everyFacetState()` rather than by an invented row).
  //
  // ⚑ **D-017 · R19 — *waiting on an answer from <name>*, in the one state's words**, where the
  // state names who owes it, ⚑ and D-036's *waiting on <name>* where it names who holds the work;
  // the Work tab's *waiting on an answer* or *waiting on a worker* where this window cannot name
  // them.
  if (standing === 'elsewhere') {
    if (state?.is === 'waiting-on-an-answer' || state?.is === 'waiting-on-a-worker') {
      return agentStateWords(state)
    }
    return facets.waiting === undefined ? standing : WORK_STATE_WORD[facets.waiting]
  }
  // 🔴 **D-006 · the Work tab's own words for the work** (`222` §4), and the outcome its owner
  // reported beside *answered*, as `list_tasks` says it.
  if (standing === 'stalled') return WORK_STATE_WORD.stalled
  // Use `agentStateWords`' active wording for a running turn, matching the rail and Graph. Keep the `working` key for `data-standing`; keys and displayed words serve different purposes.
  if (standing === 'working') return agentStateWords({ is: 'active' })
  if (standing === 'answered') {
    const outcome = facets.work?.state === 'answered' ? facets.work.outcome : null
    return outcome === null ? WORK_STATE_WORD.answered : `${WORK_STATE_WORD.answered} (${outcome})`
  }
  if (standing !== 'waiting') return standing
  // 🔴 **UI-008 · a person's answer or approval waiting is the one state's *needs you*** (F051).
  // ⛔ It said `waiting`, the standing's own key, while a conversation this window does not hold
  // said `agentStateWords`' *needs you* on the same rail, the pill *Waiting on you* and the card
  // *idle* — four words for one state. ⚑ The key stays `waiting`: `data-standing` is a key.
  // ⛔ Only a card that SUMMONS a person is named after it: a plan go-ahead beside a person's wait
  // is not what needs them (it blocks nothing), so it is not said here.
  return summonsAttention(facets.needing) ? `${NEEDS_YOU}: ${facets.needing}` : NEEDS_YOU
}

/**
 * 🔴 **The word under the PLATE — the DOING, except where the DOING is not the whole truth** (258).
 *
 * The avatar describes the agent, so detached processes and waiting crons can correctly leave its face idle. `SessionBot` in `SessionPanel.vue` also needs a word for background or scheduled work; derive that rule here through `standingOf` rather than a component-specific exception.
 *
 * ⚑ **So the rule lives with the vocabulary rather than in the component** (`223`: one predicate,
 * every consumer asks it). The next facet author changes `STANDINGS` and this function together, or
 * the test below fails; they cannot change one and leave a component holding the old list.
 *
 * ⚠️ **Scoped to exactly those two standings and nothing else**, which is `250`'s own scoping kept:
 * `standingWord` would say `working` where `DOING_WORD` says *using a tool*, and re-registering this
 * surface on the coarse word is a change nobody asked for. The two states here are the two where a
 * one-word answer has a SECOND fact to tell.
 *
 * 🔴 **UI-008 · and *needs you* outranks the DOING here too** (F051). ⛔ A question a person was
 * asked draws no card and its turn has ended, so the DOING is `idle` — and the card printed *idle*
 * under the plate while the rail, the pill and the tools said a person owes it an answer. ⚑ The
 * one order ranks *needs you* first ({@link agentStateArm}); this word does now, whatever the
 * avatar's face.
 */
export function plateWord(facets: AgentFacets, state?: AgentState): string {
  const standing = standingOf(facets)
  // Use the standing word when the idle face alone would omit another fact: needing an answer, owing one, work elsewhere, background work, a schedule, or the state of held work.
  return standing === 'waiting' ||
    standing === 'owes' ||
    standing === 'background' ||
    standing === 'scheduled' ||
    standing === 'elsewhere' ||
    standing === 'stalled' ||
    standing === 'answered'
    ? standingWord(facets, state)
    : // 🔴 **UI-004 · a running turn with nothing finer to say is the one state's *active*** — the
      // rail row, the Graph and the pill say it; ⚑ *thinking*, *using a tool*, *replying* and
      // *compacting* keep this card's finer register (`258`).
      standing === 'working' && facets.doing === 'working'
      ? standingWord(facets, state)
      : DOING_WORD[facets.doing ?? 'unknown']
}

/** A pill's register: the table's own word, first letter raised. One rule, so it cannot drift. */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The word a person reads. `unknown` says we do not know, never a state we are guessing at. */
export const STANDING_LABEL: Record<Standing, string> = {
  unknown: 'Unknown',
  idle: 'Idle',
  // ⛔ **DERIVED from `248`'s table, not copied from it** (250, tightened by the adversarial pass over
  // its own diff). `background-work.ts`'s header states the rule this file has to obey: *"One
  // vocabulary, no call-site phrasing… no surface can name one state its own way."* Three literals
  // were written here first, in the one file whose whole subject is that two derivations of a fact
  // drift — and `BACKGROUND_WORD` is explicitly expected to be revised in its own file, so a copy
  // would go stale silently. ⚠️ Deliberately NOT "Background work", which names a category; the
  // table's word names what is happening, and the pill only capitalises it.
  background: capitalise(BACKGROUND_WORD.running),
  // ⛔ **DERIVED from the schedule vocabulary, not written twice** (258, on the rule `250` states
  // one line up). `SCHEDULED` is the word the bar's own heading is built from — *"1 job is still
  // scheduled"* — so the pill and the list cannot come to name one state two ways.
  scheduled: capitalise(SCHEDULED),
  // 🔴 **636 · the FAMILY, coarser than the row's word, and that is `waiting`'s own arrangement**
  // rather than a shortcut. ⛔ This table is `Record<Standing, string>` — one label per member —
  // and `waiting` has said one label over four different needings since `082` (*Needs you* since
  // UI-008), while {@link standingWord} names which. ⚑ Same here: the pill says the family, the
  // rail row says the member.
  //
  // ⚠️ **Not derived, because there is nothing to derive it from.** `background` and `scheduled`
  // above take their labels from the vocabulary that owns the fact; the two waits have per-member
  // phrases in `WORK_STATE_WORD` and no phrase for the pair, so this is a new sentence and is
  // pinned as one. ⛔ **It says *another agent* and never *somebody else***: a person can never be
  // either party — see {@link STANDINGS}' `elsewhere`, where that is proved from the one writer of
  // `work_given`.
  elsewhere: 'Waiting on another agent',
  // 🔴 **F036 · the family word, as `elsewhere`'s** — the rail row names WHO ({@link standingWord}).
  owes: 'Owes another agent an answer',
  // ⛔ **D-006 · DERIVED from the Work tab's table**, `background`'s rule: one phrase for one fact.
  stalled: capitalise(WORK_STATE_WORD.stalled),
  answered: capitalise(WORK_STATE_WORD.answered),
  // ⛔ **UI-004 · DERIVED from the one state's words**, `background`'s rule — a running turn is
  // *active* wherever an agent is drawn, and the pill only capitalises it.
  working: capitalise(agentStateWords({ is: 'active' })),
  // ⛔ **UI-008 · DERIVED from the one state's words**, `working`'s rule — a person's answer or
  // approval waiting is *needs you* wherever an agent is drawn (F051). ⚑ The *Waiting on you* page
  // keeps its name: it names a place, and this names a state.
  waiting: capitalise(NEEDS_YOU),
}

/** The design's pill tones, unchanged from the ones `SessionHeader` used to hold. */
export const STANDING_TONE: Record<Standing, string> = {
  unknown: '',
  idle: '',
  // ⛔ **Blank, and that is the honest hue rather than a gap** (258). `background` below is `live`
  // because work is genuinely in progress; nothing is in progress here, and painting a schedule the
  // same blue would claim a running machine for a conversation whose composer is free and whose
  // provider is doing nothing. ⚠️ It is not `waiting` either — nothing is waiting on anybody.
  // `250`'s own rule, applied to a colour: inventing a mark would be a design decision this dispatch
  // has no design behind, and the WORD is the fix. The mark for *later* is the bar above the
  // composer. ⚑ The two entries are adjacent on purpose — a reader meeting one should meet the
  // argument for the other in the same glance.
  scheduled: '',
  // Keep elsewhere uncolored: the person cannot settle this wait, and no local work is running. The other conversation has its own activity color; the word explains this conversation's state.
  elsewhere: '',
  // ⚑ **F036 · blank, `elsewhere`'s argument**: nothing runs here, and amber would say a person is
  // asked — another agent is waiting, not you.
  owes: '',
  // ⚑ **D-006 · blank, `elsewhere`'s argument**: nothing is in progress here, and amber would say a
  // person must act — the stall notice goes to the agent that gave the work.
  stalled: '',
  answered: '',
  // ⚠️ **`live`, the same blue the registry's own dot takes** (`BackgroundBar`'s `.bg-dot` is
  // `--accent`), because it means the same thing there: work is in progress. It is deliberately not
  // `waiting` — nothing is waiting on anybody — and deliberately not blank, which is what `idle`
  // wears and is the exact impression `250` existed to remove.
  background: 'live',
  working: 'live',
  waiting: 'waiting',
}

/**
 * The pill's word, per DOING.
 *
 * Deliberately NOT {@link DOING_WORD}, and the difference is register rather than meaning:
 * `DOING_WORD` writes the subject of a screen-reader sentence (*"claude — using a tool"*), while
 * this is a two-word uppercase label that a tool name is appended to (*"RUNNING BASH"*). Same
 * vocabulary, same source, two voices — which is why the map is keyed by `Doing` and not by phase.
 */
const PILL_WORD = {
  working: 'working',
  thinking: 'thinking',
  tool: 'running',
  compacting: 'compacting context',
  replying: 'replying',
} as const satisfies Record<Exclude<Doing, 'idle' | 'unknown'>, string>

/**
 * Blue is running, amber is waiting on something — the pill's only two tones.
 *
 * ⚠️ **`compacting` is amber, and it is amber because it always was.** The map this replaced keyed
 * tone by activity phase and gave `compacting` the waiting colour: the context window is being
 * rewritten and the conversation cannot take a turn until it is done, which is a wait even though
 * work is happening. Re-deriving the tone from the DOING alone quietly turned it blue — a colour
 * change nobody asked for, smuggled in under a refactor. Found in review.
 */
const PILL_TONE = {
  working: 'live',
  thinking: 'live',
  tool: 'live',
  compacting: 'waiting',
  replying: 'live',
} as const satisfies Record<Exclude<Doing, 'idle' | 'unknown'>, 'live' | 'waiting'>

export interface ActivityLine {
  doing: Exclude<Doing, 'idle' | 'unknown'>
  word: string
  /** The tool's name, when a tool is what is running. Absent otherwise. */
  detail?: string
  /** Blue is running, amber is waiting on something. The pill's only two tones. */
  tone: 'live' | 'waiting'
}

/**
 * What the pill above the composer says (027), from the same input the plate is drawn from (089).
 *
 * It returns `null` in **two** cases, and both are removals rather than additions — this can never
 * put a pill on screen where there was not one before:
 *
 *  1. **No activity at all.** The pill states one thing about now; with nothing to state it is
 *     absent, exactly as it always has been. A session that is merely `working` with no phase
 *     published gets no pill, because "working" is what the plate is for.
 *  2. **The session is over, or we do not know it.** `activity` is cleared at turn end, but a
 *     session that died mid-turn never got a `turn` event to clear it — so the field outlives the
 *     conversation, and the old pill went on pulsing "running Bash" at a dead session. `sessionDoing`
 *     already knows better; asking it is what fixes that too.
 */
export function activityLine(input: SessionFacetInput): ActivityLine | null {
  const activity = input.activity
  if (!activity) return null
  const doing = sessionDoing(input)
  if (doing === 'idle' || doing === 'unknown') return null
  // ⚠️ **The detail belongs to the phase that produced it, and dies with it.** `detail` is the tool's
  // name, written beside `phase: 'tool'`; once the doing has moved on (to `replying`, most often)
  // the name is a fact about a finished call, and appending it would put the lie back one word to
  // the right — "REPLYING BASH".
  const current = DOING_OF_PHASE[activity.phase] === doing
  const waiting = current && activity.phase === 'waiting'
  return {
    doing,
    // `waiting` reads "waiting", not "working": the phase exists for Claude's `requesting` status,
    // which means a request is in flight and the model has not begun. "Working" would claim activity
    // that has not started — and the amber dot beside it already says we are waiting on something.
    word: waiting ? 'waiting' : PILL_WORD[doing],
    ...(current && activity.detail !== undefined ? { detail: activity.detail } : {}),
    tone: waiting ? 'waiting' : PILL_TONE[doing],
  }
}

/**
 * 🔴 **{@link ActivityLine} as a person reads it** — *thinking*, *running Bash* — or `''` for no
 * line at all (588).
 *
 * ⛔ **It lived inside `ActivityPill.vue` and a SECOND surface now draws this**, which is `169` §1
 * exactly: two components composing one sentence are two sentences free to disagree. ⚠️ That file's
 * own docblock is the rule being obeyed — *"There is now one rule, `activityLine` in
 * `lib/agent-state.ts`, feeding both… Do not re-derive anything in this file"* — and a template
 * interpolation is a derivation the day somebody changes the separator.
 *
 * ⚑ **The separator is a SPACE and it has to be written, not implied.** A Vue template that puts
 * the detail in a `<template v-if>` beside the word loses the whitespace between them to the
 * compiler's own condensing — measured, and it drew `runningBash`.
 */
export function activityWords(line: ActivityLine | null): string {
  if (line === null) return ''
  return line.detail === undefined ? line.word : `${line.word} ${line.detail}`
}

/**
 * What the agent IS.
 *
 * ⚠️ **`closing` is OUR statement, not the provider's** (089, and 064's principle exactly). The
 * host does observe this window — `SlotPhase` in `runtime-host.ts` goes `starting → live → closing`
 * — but that field is internal to the slot registration race and is on no wire (the reopen lists
 * carry the host's own `closing` since `716`, and a row there says so since `725`; this plate still
 * reads the phase this window wrote): `LivenessState` is
 * `live | silent | ended | errored`, so nothing the provider tells us can ever say "closing". The
 * source that IS available costs nothing, because the renderer asked for the close itself: the
 * moment `close()` is sent, this app knows a fact about the session that no channel is going to
 * confirm until the ending lands. 064 already settled that this is ours to state — waiting for the
 * provider to announce itself is what leaves a surface stale — so `session-store.close()` writes
 * `phase: 'closing'` before it awaits, and this reads it.
 *
 * It sits BELOW the stopped check on purpose: once the stop has landed, "closing" is the older and
 * weaker fact.
 */
export function sessionBeing(input: SessionFacetInput): Being | undefined {
  if (input.phase === 'opening') return 'starting'
  // ⚠️ **Stopped first, and by the SAME predicate `sessionDoing` uses** — so a fold that has
  // recorded a stop never draws a live line while the liveness channel catches up. ⚑ **D-017b · and
  // it draws NO line**: whether anything runs is not the plate's to say (`05` rule 5).
  if (nothingDoingHere(input)) return undefined
  // Not over, and on its way out. Above `liveness`, which still says `live` for the whole teardown.
  //
  // ⚠️ **This does shadow `silent`, and that is the intended order** (089 review). A provider that
  // goes quiet while it is being torn down has not gone wrong — quiet is what teardown looks like —
  // so the clock badge `silent` would raise is an alarm about the expected. `closing` is the more
  // specific fact and the one that explains the silence.
  if (input.phase === 'closing') return 'closing'
  // Not over: the provider's own state is what this facet is about, and it is the host's word rather
  // than a second reading of ours (080's ruling about the status pill, other axis) — ⚑ **D-017b · but
  // only where it is a condition**: `silent`, a turn that has gone quiet. ⛔ `live` draws nothing,
  // because a plate that said it would tell a conversation this window runs from one drawn from its
  // ledger by whether a provider process runs here — the fact `05` rule 5 keeps off every surface.
  if (input.liveness === 'silent') return 'silent'
  // Running with nothing to say, or no liveness yet: no underline is drawn.
  return undefined
}

export function sessionFacets(input: SessionFacetInput): AgentFacets {
  const being = sessionBeing(input)
  return {
    doing: sessionDoing(input),
    ...(being ? { being } : {}),
    ...(input.needing ? { needing: input.needing } : {}),
    // Absent rather than `false`, exactly as the three above are: an absent facet is simply absent
    // from the object and from the sentence, which is what {@link accessibleName} is written around.
    ...(input.detached ? { detached: true } : {}),
    // The fifth, absent rather than `false` for the reason the four above are (258).
    ...(input.scheduled ? { scheduled: true } : {}),
    // ⛔ **The sixth, absent rather than `null`, for the five above's reason and one of its own**
    // (636): `null` here would be a THIRD spelling of an absence {@link WaitReading} has already
    // told apart, and the only one of the three this object can carry is *nothing was read*.
    ...(input.waiting ? { waiting: input.waiting } : {}),
    ...(input.work ? { work: input.work } : {}),
    ...(input.owes ? { owes: input.owes } : {}),
  }
}

/**
 * 🔴 **Which NEEDINGS may summon attention — the closed set, in ONE place** (446).
 *
 * ⛔ **`plan` is the exclusion.** A permission freezes the composer and a question holds the turn.
 * ⚑ A go-ahead is an offer the conversation carries on without, so it is a NEEDING and is
 * deliberately not attention: a surface that treated it as one would put an amber
 * row on a conversation nobody is waiting on.
 *
 * ⚠️ **A predicate rather than a list, and it is exported because it had FOUR copies.** `standingOf`
 * held one, `SessionShelf.vue`'s attention row held another, and each of the two behavioural
 * oracles holds its own — so a member added to {@link NEEDINGS} was four edits, and `446` made all
 * four. ⛔ The two oracles keep theirs on purpose (a test that asked this function would measure
 * nothing); the two PRODUCT copies are now one.
 */
export function summonsAttention(needing: Needing | undefined): boolean {
  return needing === 'permission' || needing === 'question'
}

/**
 * Which badge a conversation wears, from what is actually open in it.
 *
 * Permission outranks question outranks plan: a permission freezes the composer (063), a question
 * holds the turn, and a plan go-ahead blocks nothing at all — it is standing and can be pressed
 * whenever. One slot, most-blocking first.
 *
 * ⛔ **This is the function the rail and the pane BOTH call, on the same numbers** — `099`'s whole
 * repair, and the reason `recordFacets`' comment says *"the rail and the pane cannot answer
 * differently"*.
 */
export function needingFor(input: {
  permissions: number
  questions: number
  planNeedsGoAhead: boolean
}): Needing | undefined {
  if (input.permissions > 0) return 'permission'
  if (input.questions > 0) return 'question'
  if (input.planNeedsGoAhead) return 'plan'
  return undefined
}

/**
 * A **workflow agent's** facets (108, designed in 107) — the same six words, a different container.
 *
 * ⚠️ **This exists instead of routing workflow agents through {@link subAgentFacets}, and the reason
 * is a measurement rather than a preference.** That function collapses everything non-running and
 * non-ended to `{doing:'unknown'}`: it has no `queued`, and it cannot see an `attempt`. Those are
 * exactly the two facts a workflow carries and a sub-agent does not — a fan-out wider than the
 * concurrency cap leaves agents holding a queue slot, and a retry is a second try rather than a new
 * agent. 107: *"the two facts `subAgentFacets` would flatten."*
 *
 * ⚠️ **Every value it returns is an existing 081 facet. No new vocabulary.** A person who has learned
 * to read a sub-agent's live/ended/errored reads a workflow agent's identically, which is the other
 * half of the ruling — same plate and words, different shape.
 *
 * ⚠️ **There is deliberately NO `needing` parameter, and its absence is the honest reading of 107
 * §6** (108 review). An earlier version took one, no call site ever passed it, and the component's
 * own comment described an amber badge that could not appear — which is precisely the "an unwired
 * control must not be hinted at" rule 106 was caught by. The wire carries nothing linking a
 * permission to a workflow AGENT: `permission_request` has no `agentId` and no `task_id`, in any of
 * the measured payloads. So the ruling still holds, by a different route — a workflow agent's
 * permission IS a real question and DOES count, because it arrives as an ordinary
 * `permission_request` card and is counted by the same code as every other one, with no special
 * case anywhere. What does not exist is a badge on the row, and nothing pretends otherwise.
 *
 * ⚠️ **`run` is the SECOND argument because `state` alone is not enough to answer the question**
 * (118, from 117 §2). See {@link frozenInsideAnEndedRun}. It is required rather than optional so
 * that a call site cannot forget it and quietly get the old, wrong answer back.
 */
export function workflowAgentFacets(
  agent: Pick<WorkflowAgent, 'state' | 'lastTool'>,
  run: Pick<WorkflowRunCard, 'running'>,
): AgentFacets {
  switch (agent.state) {
    // Waiting for a slot: no face, and a dotted underline saying it has not begun. `unstarted` is
    // 081's own word for exactly this and it did not need a new one.
    //
    // ⚠️ Deliberately NOT corrected when the run is over: an agent that never got a slot never
    // started and now never will, so "not started" is not a stale claim about now — it is the
    // permanent truth about that row, and it is the same sentence before and after the ending.
    case 'queued':
      return { doing: 'unknown', being: 'unstarted' }
    case 'running':
      if (workflowAgentStopped(agent, run)) return { doing: 'unknown' }
      return { doing: agent.lastTool ? 'tool' : 'working', being: 'live' }
    case 'done':
      return { doing: 'idle', being: 'ended' }
    case 'failed':
      return { doing: 'idle', being: 'errored' }
    // A state the provider sent and we could not read. The faceless ring says so, and — exactly as
    // in {@link subAgentFacets} — the absent underline says we were not told how it is going. It is
    // never rounded to `running`, which would be a claim, or to `done`, which would be a worse one.
    default:
      return { doing: 'unknown' }
  }
}

/**
 * **An agent still holding `running` inside a run that is OVER** (118, from 117 §2).
 *
 * ⛔ **Exported, because the plate is not the only thing on the row.** The first version of this
 * corrected the avatar and left the words: review found a killed run rendering `judge ·
 * StructuredOutput · running` beside a faceless ring whose accessible name said *state unknown* —
 * two answers in one row, which is the defect restated rather than fixed. The status word, the tool
 * chip, the row's `data-state` and the head's tally all ask this same function now.
 *
 * 117 measured the real case rather than imagining it: a `Workflow` the provider KILLED when the
 * model stopped talking — `"status":"killed"`, `error: "Workflow aborted"`, `result: null`, and no
 * terminal notification ever sent — leaves the run's last frame saying its Judge agent is
 * `running`. The run's own head settles (`stopOpenToolCalls` sets `running:false, unfinished:true`),
 * and until this the row underneath it went on saying **working · live** forever, inside a tree
 * whose header already said the run was over. Two answers to one question, in one card.
 *
 * ⚑ **The precedent was already in this repo, one surface over.** `stopRunningSubAgents` closes
 * every sub-agent card when the turn that dispatched it ends (but, since 695, one whose agent the
 * provider still lists in the background level), and the live smoke's step 17 enforces
 * it in as many words: *"one still `running` at the end is the spinning card this task exists to
 * prevent."* The sub-agent card had that rule; the workflow tree did not.
 *
 * ## What it says instead, and why it is not `done`
 *
 * `{doing:'unknown'}` — the faceless ring, and NO underline. It is 039's vocabulary and not a
 * fabricated outcome: *the provider stopped saying*. The three wrong answers this deliberately
 * refuses are worth naming, because each is a smaller lie than the one before:
 *
 *  - **`live`** — what it said until now. False about NOW, which is the only tense a face has.
 *  - **`ended`** — a claim the agent finished. Nobody told us that; the run was killed mid-flight.
 *  - **`errored`** — a claim it failed. Worse still: an outcome, invented, on a row that has none.
 *
 * ⛔ **And never amber** (108). A finished run may not spend the attention channel, and `needing`
 * is unreachable from this function by construction — there is no parameter that could carry one.
 *
 * ⚠️ **This is a DERIVATION and the agent's own `state` is left alone.** 039's rule is that a
 * provider's word is read, never rewritten; overwriting `state` to `unknown` in the fold would
 * destroy the one fact that says what the run was doing when it was killed. The run's terminal
 * status is known and sits in the same card, so the row can be drawn honestly without touching it.
 *
 * ⚠️ **`running: false` and not `unfinished`, deliberately.** 074 separates *"it ended"* from *"we
 * stopped watching"*, and this row needs neither: both mean **nothing more has arrived**, which is
 * the only premise its `live` ever rested on. Keying on `unfinished` would leave the row lying for
 * every run that ended properly with an agent still marked `running`.
 *
 * ⚠️ **And "nothing more has arrived" is not "nothing more will arrive"** — an earlier version of
 * this comment said the second, and the fold measured it false. `stopOpenToolCalls` settles an open
 * run at every boundary that ends the thing running it, *including an ordinary turn end*, while a
 * dynamic workflow legitimately outlives its turn — so between that turn ending and the run's next
 * progress frame, a genuinely working agent reads `unknown` here and returns to `working · live`
 * when the frame lands. ⚑ **That is the honest reading and not a regression**: in exactly that
 * window the run's own head already says *did not finish*, so the row now AGREES with the header
 * above it. Before this change the head said one thing and every row under it said the other.
 * Telling a killed run from a live-but-unwatched one is 074's open question, and it is not this.
 */
export function workflowAgentStopped(
  agent: Pick<WorkflowAgent, 'state'>,
  run: Pick<WorkflowRunCard, 'running'>,
): boolean {
  return agent.state === 'running' && !run.running
}

/**
 * A whole **workflow run**'s facets, for the one row it gets in the drawer's Open tab (108).
 *
 * ⚠️ **`needing` is deliberately impossible here**, and it is 107 §6's whole ruling in one signature.
 * A running workflow is *happening*, not *waiting on you*: it may not badge the drawer toggle, dot
 * the Open tab or raise the attention bar. Giving this function no way to express one means the rule
 * cannot be broken by a caller passing a flag — the only amber on this surface comes from
 * {@link workflowAgentFacets}, where a real question is being asked.
 */
export function workflowRunFacets(run: {
  running: boolean
  outcome?: 'completed' | 'failed' | 'unknown'
}): AgentFacets {
  if (run.running) return { doing: 'working', being: 'live' }
  switch (run.outcome) {
    case 'completed':
      return { doing: 'idle', being: 'ended' }
    case 'failed':
      return { doing: 'idle', being: 'errored' }
    // `unknown` (an ending we could not read) and absent (we stopped watching, 074) are both "over,
    // and we cannot say how" — the faceless ring with no underline, which is the same sentence
    // {@link subAgentFacets} reserves for an unreported ending.
    default:
      return { doing: 'unknown' }
  }
}

/**
 * A sub-agent's facets, from its card (029/035).
 *
 * ⚠️ **`unreported` becomes `unknown` with NO underline, and that is the whole point of both.** A
 * sub-agent whose ending we were never told about is not "completed" and not "interrupted"; the
 * faceless ring says we do not know, and the missing underline says we were not told how it ended.
 * The written word beside it still distinguishes all five outcomes.
 *
 * ⚠️ **It needs no second argument, unlike {@link workflowAgentFacets}, and the asymmetry is real
 * rather than an oversight** (118). `running` on a card is corrected in the FOLD —
 * `stopRunningSubAgents` walks every card at every depth when the turn ends, sparing only an agent
 * the background level still lists (695) — so by the time this
 * function sees one, "still running" has already been reconciled against the turn that dispatched
 * it. A workflow agent's `state` is the provider's own word inside a frame, and nothing sweeps it.
 */
export function subAgentFacets(
  card: Pick<SubAgentCard, 'running' | 'outcome' | 'lastTool'>,
): AgentFacets {
  if (card.running) return { doing: card.lastTool ? 'tool' : 'working', being: 'live' }
  switch (card.outcome) {
    case 'completed':
      return { doing: 'idle', being: 'ended' }
    case 'failed':
      return { doing: 'idle', being: 'errored' }
    // Over, and not cleanly — but `interrupted` is a transcript mark rather than a face (081), so
    // the underline says "over" and the row's own word says how.
    case 'interrupted':
      return { doing: 'idle', being: 'ended' }
    default:
      return { doing: 'unknown' }
  }
}
