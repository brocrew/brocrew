import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { WorkerBindingReading } from '../../../shared/worker-reading'
import { agentName, type AgentIdentities, type AgentIdentity } from '../../../shared/runtime-ipc'
import {
  HOLDING_SAYS,
  NONE_STARTED,
  theProviderOfAnAgent,
  whatHoldsIt,
  type IdentityUse,
  type WhatHoldsAnIdentity,
} from '../../../shared/agent-roster'
import {
  byIdentity,
  whatAPlateCanDraw,
  type ConversationAtWork,
  type WhatIsBeingDone,
} from '../../../shared/what-is-being-done'
import { providerLimitDisplay } from './provider-limit-status'
import { agentStateWords, type AgentState } from '../../../shared/agent-state'
import { theWorkThatNamesItSaid } from '../../../shared/piece-called'
import {
  activityLine,
  facetsOfState,
  sessionFacets,
  standingOf,
  STANDING_LABEL,
  STANDING_TONE,
  type ActivityLine,
  type AgentFacets,
  type SessionFacetInput,
  type Standing,
} from './agent-state'
import { agoWords } from './clock'
import { onPurposeSaid, type ListedConversation } from './conversation-list'
import { ACTIVITY_READ_EVERY_MS } from './recent-activity'
import { OPEN_IN_ANOTHER_WINDOW, OPEN_THE_CONVERSATION } from './taking-over'

/**
 * ⛔ **How often a window glances at what every agent is doing** — its tool, its phase — while a
 * person can see it (`RuntimeScreen`'s `glance`, W4.74).
 *
 * ⚑ **Recent activity's number BY DERIVATION rather than by coincidence, which is why it is that
 * symbol and not `30_000`.** Both are a reading nothing pushes a change of. 🔴 **One question, one
 * cadence** — a third number here would be a number somebody CHOSE, which is the thing
 * `LOOK_EVERY_MS`'s own docblock refuses. ⚑ **D-033 · the WORK is not on this clock any more**:
 * every move of a piece is pushed, and the forest is read again on it.
 *
 * ⚠️ **Arriving on the page re-reads immediately**, so the glance bounds how stale a page a person
 * is LOOKING AT can get, and never how stale the one they just opened is.
 */
export const ROSTER_EVERY_MS = ACTIVITY_READ_EVERY_MS

export type TeamFilter = 'all' | 'never-run' | 'worked'

/**
 * 🔴 **One conversation this app is running as an identity, as a Team card draws it** (593).
 *
 * ⛔ **A LIST and never one answer**, which is {@link byIdentity}'s own ruling read at the surface
 * it was written for: *"an identity running two conversations is doing two things and this app has
 * no ruling that says which one to show… the surface has the room to say* two conversations *and
 * this function has none."* ⚑ This is that room.
 */
export interface AtWorkNow {
  /** ⚑ **The conversation's own id** — what an `Open` press needs and what the reading is keyed by. */
  readonly conversation: string
  /**
   * ⚑ **The loud line** — `activityLine`'s answer, `null` when there is nothing to report.
   *
   * ⛔ **Absent, never a placeholder** (588's rule on the same line one surface over): `activityLine`
   * answers `null` for `idle` and for `unknown`, and a row with nothing to report says nothing
   * rather than *nothing*.
   */
  readonly doing: ActivityLine | null
  /** ⚑ **The standing, in the app's own nine words** — a projection of the plate, never a second read. */
  readonly standing: Standing
  /**
   * ⚑ **How long it has been THIS, or since a card settled** — {@link ConversationAtWork.since},
   * which is the event's own stamp, measured against {@link WhatIsBeingDone.readAt} and never
   * against a second clock.
   */
  readonly since: string
}

/**
 * 🔴 **What a person came to this page to find out** (593) — `EXT-012` §2: *"Who do I have, and what
 * are they doing?"*
 *
 * ⛔ **A discriminated union and not a word beside a reason** (`a-value-beside-a-word-or-a-union-of-arms`):
 * every arm is a different KIND of answer and only one of them has a standing to carry.
 *
 * ⚠️ **{@link doingSays} is the only place these become sentences**, so the card cannot spell one of
 * them its own way — which is the defect `EXT-012` §3.1 names: *"four surfaces each describing state
 * in a different number of words."*
 */
export type WhatTheyAreDoing =
  /**
   * ⚑ **Exactly one conversation is live and this app has a word for it** — so the card says the
   * word the rail and the conversation header both say about the same session.
   */
  | { readonly it: 'one-conversation'; readonly standing: Standing }
  /**
   * 🔴 **Running, and this app has NO word for what it is doing** — `standingOf` answered `unknown`.
   *
   * ⛔ **It is a distinct arm rather than `STANDING_LABEL.unknown`**, and the reason is that
   * *Unknown* would be the wrong half of a fact this reading holds: the app knows the conversation
   * is running, it does not know what is happening inside it. ⚑ *In a conversation right now* is
   * `EXT-012` §2.2's own sentence and it is true.
   *
   * ⚠️ **It survives `593` and is NARROWER than it was.** `sessionDoing` lets `activity` REFINE a
   * status and never PROMOTE one (`099`); until `593` this page held no `SessionStatus` at all and
   * every running conversation landed here. ⛔ It is now reached when the stream has genuinely said
   * nothing this app has a word for — `whatAPlateCanDraw` withholding a status under
   * `NOTHING_HAS_ARRIVED`, or `standingOf` answering `unknown` on a frame it cannot name.
   */
  | { readonly it: 'in-a-conversation' }
  /** ⛔ **Two or more** — {@link byIdentity}'s refusal to pick, kept where the room is. */
  | { readonly it: 'more-than-one'; readonly count: number }
  /** ⚑ **A launch is in flight and no row says so yet** — {@link IdentityUse.isLaunching}. */
  | { readonly it: 'starting' }
  /** ⛔ **Nothing has EVER run as it** — {@link IdentityUse.conversations} is zero. */
  | { readonly it: 'never-run' }
  /**
   * ⚑ **It has run, and this app is running nothing as it at {@link WhatIsBeingDone.readAt}.**
   *
   * ⛔ **Sound because the reading is COMPLETE** — {@link WhatIsBeingDone.conversations}' own
   * ruling: *"with the whole population and one `readAt`, this app is running nothing for that
   * identity is a sound inference; with a set, it is only ever a statement about the set."*
   */
  | { readonly it: 'not-right-now' }
  /**
   * ⚠️ **No reading has arrived, so the card may not say either way** — `086`'s *not asked* and
   * *asked and empty* are two facts and both are drawn.
   */
  | { readonly it: 'not-read' }

/**
 * ⛔ **The ONE place a {@link WhatTheyAreDoing} becomes a sentence** (593) — `HOLDING_SAYS`' shape
 * and `485`'s rule: the words a surface draws live with the vocabulary, never in the template.
 *
 * ⚑ **The `one-conversation` arm defers to {@link STANDING_LABEL}**, which is what `SessionHeader`
 * already says about the same sessions — a tenth word minted here would be the fourth vocabulary
 * `EXT-012` §3.1 is complaining about.
 */
export function doingSays(what: WhatTheyAreDoing): string {
  switch (what.it) {
    case 'one-conversation':
      return STANDING_LABEL[what.standing]
    case 'in-a-conversation':
      return 'In a conversation right now'
    case 'more-than-one':
      return `In ${String(what.count)} conversations right now`
    case 'starting':
      return 'Starting now'
    case 'never-run':
      return 'Never run'
    case 'not-right-now':
      return 'Not in a conversation right now'
    case 'not-read':
      return 'Not read yet'
  }
}

/**
 * ⚑ **The chip's ink, from {@link STANDING_TONE} and from nowhere else** (593).
 *
 * ⛔ **Every other arm is blank on purpose.** A running conversation this app has no word for is
 * not *work in progress* — it may be sitting at a prompt nobody has answered — and painting it the
 * accent blue would claim a working machine, which is `STANDING_TONE`'s own argument for the four
 * standings it leaves blank.
 */
export function doingTone(what: WhatTheyAreDoing): string {
  return what.it === 'one-conversation' ? STANDING_TONE[what.standing] : ''
}

export interface TeamMemberView {
  readonly identity: AgentIdentity
  readonly use: IdentityUse
  /**
   * ⚑ **What a person calls this identity, and it is {@link agentName} rather than a `??` written
   * here** (570, from 449 and 472).
   *
   * Use `agentName` (`displayName ?? profileLabel`) to preserve supplied names and name the seeded default as BroBot. Falling directly back to the slug shows `default` for that known identity instead.
   *
   * ⚑ **592 · the slug is `brobot` now** (`HO-078` §2), so the literal fallback would draw
   * *brobot* rather than *default*. ⛔ **The rename therefore does not retire this expression**:
   * the difference narrowed from a substituted word to a capital letter, and a person still reads
   * it on their own main agent's card.
   *
   * 🔴 **And a census exists to stop precisely this.** `a-row-that-says-who-is-in-it.test.ts` §3
   * refuses `identity.displayName ??` in `SideRail.vue` (449), and it is scoped by path — so `570`
   * widened it to this module rather than leaving the hole it was written for open one file over.
   */
  readonly heading: string
  readonly neverRun: boolean
  readonly provider: string | null
  readonly canRemove: boolean
  readonly held: readonly WhatHoldsAnIdentity[]
  /**
   * ⛔ **Why it may not be removed, in ENGLISH** (593) — {@link HOLDING_SAYS}, which `558` wrote for
   * this and which this page was not reading.
   *
   * ⚠️ **`EXT-012` §1.2 measured the cost**: the card drew `Removal unavailable: conversations,
   * a-project, this-app, a-launch.` — *"four internal reason codes shown to a person as a comma
   * list. `a-project` and `a-launch` are not English."* ⚑ The table was already there, already
   * asserted, and already read by `agent-store.ts` for the refusal a person gets AFTER the press.
   */
  readonly heldSays: readonly string[]
  /**
   * 🔴 **The plate** (593) — `AgentState`'s three facets, from the one derivation every other
   * surface draws from.
   *
   * ⛔ **It is the single live conversation's, or a faceless one.** With two conversations live
   * there is no single answer and {@link byIdentity} refuses to pick; with none there is no session
   * at all. ⚠️ In both cases the plate draws `081`'s faceless ring rather than a confident face,
   * which is `593` §3's question — *say what the avatar shows when the app does not know* —
   * answered by not answering.
   */
  readonly facets: AgentFacets
  /** ⚑ **`EXT-012` §2.1's second fact** — see {@link WhatTheyAreDoing}. */
  readonly doing: WhatTheyAreDoing
  /** ⚑ **One entry per conversation this app is running as it, right now.** */
  readonly atWork: readonly AtWorkNow[]
}

export interface TeamRosterView {
  readonly members: readonly TeamMemberView[]
  /**
   * ⚑ **How many identities EXIST, before the search box and the filter narrow them** (570).
   *
   * ⛔ **`EXT-008` §4.4 is the reason this is here rather than on the rail**: *"The rail says zero
   * and then names three agents… the Agents page is where it gets explained, not the rail."* ⚠️ A
   * count that is the length of {@link TeamRosterView.members} would drop to `0` the moment
   * somebody typed in the search box, which is the second way a count can lie about a roster.
   */
  readonly total: number
  readonly homeFoldersWithoutIdentity: readonly string[]
  /**
   * ⚑ **How old the live half of this page is, or `null` while nothing has been read** (593) —
   * `588`'s `asOf` one surface over, and for its reason: *"a plate that looks live and is half a
   * minute stale is a surface claiming a freshness it does not have."*
   */
  readonly asOf: string | null
}

/**
 * ⛔ **Everything the Team page folds, in one object** (593): a fold that takes five positional
 * arguments is a fold whose call sites drift.
 */
export interface TeamRosterInput {
  readonly source: AgentIdentities | null
  readonly query: string
  readonly filter: TeamFilter
  /**
   * 🔴 **`575`'s complete reading, or `null` — nothing has been read yet** (593).
   *
   * ⛔ **`byIdentity` is the door and it was built for this page**: *"A Team page's question: what
   * is this identity doing, anywhere?"* ⚠️ It reached no surface between `575` and here — `588`
   * took `byConversation`, and this is the other half.
   */
  readonly beingDone: WhatIsBeingDone | null
  /**
   * 🔴 **The LIVE instant, for {@link TeamRosterView.asOf} and for nothing else.**
   *
   * ⛔ **It was an implicit `Date.now()` inside the fold and that was a defect**, found reviewing
   * this dispatch's own diff: a fold that reads a clock is not a function of its arguments, so the
   * freshness line could not be pinned by any test and moved only when something else happened to
   * re-render. ⚑ Fed by `useMinuteClock`, which is what makes it keep moving while nobody touches
   * the page.
   */
  readonly now: number
  /**
   * ⚑ **UI-008 · the host's list of conversations** — its one state for a conversation at work says
   * whether that conversation NEEDS the person, which the stream's status cannot (F051: a question
   * asked, the turn ended, so the stream says idle). Absent or `null`: the stream's word alone.
   */
  readonly listed?: readonly ListedConversation[] | null
}

/**
 * 🔴 **The Team page's fold** (570, and the live half at 593).
 *
 * ## ⚑ The fact this page holds, and where it comes from
 *
 * ⛔ **`whatAPlateCanDraw` is handed {@link ConversationAtWork.status}, which is the only status
 * this page has** — an identity is not a conversation and no read here gives it a column. ⚠️ `575`
 * left that field off the wire because both of its callers held their own; this page was the third
 * and held none, so `593` published the one `BeingDoneTracker` was already keeping.
 *
 * 🔴 **It still cannot make a silent conversation look alive.** `whatAPlateCanDraw` withholds the
 * status while `NOTHING_HAS_ARRIVED` holds, so a conversation this app has been told nothing about
 * draws the faceless ring and {@link WhatTheyAreDoing} says *In a conversation right now* — the
 * honest sentence, not a fallback.
 *
 * ⚑ **And `099`'s ordering is untouched**: `activity` REFINES a status the host already calls busy
 * and may never PROMOTE one. ⛔ **What `593` changed is that the frame now ARRIVES**; nothing here
 * works around the ruling.
 *
 * ⚠️ **This section described the opposite until this dispatch's own settle** — it named the field
 * as missing in the file that had already published it, which is
 * `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves` at full strength.
 */
export function teamRoster(input: TeamRosterInput): TeamRosterView | null {
  const { source, query, filter, beingDone, now } = input
  if (source === null) return null
  const needle = query.trim().toLocaleLowerCase()
  const bySlug = new Map(source.use.map((use) => [use.slug, use]))
  // ⛔ **One selection for the whole page** — {@link byIdentity}, so no member writes it again.
  const atWork = beingDone === null ? null : byIdentity(beingDone)
  const stateOf = new Map((input.listed ?? []).map((row) => [row.sessionId, row.state]))
  const members = source.identities
    .map((identity): TeamMemberView => {
      const use = bySlug.get(identity.slug) ?? {
        slug: identity.slug,
        conversations: 0,
        thisAppMintsIt: false,
        isLaunching: false,
        // ⚑ **724** — the type, completed; nothing on this page reads it yet.
        isStarting: false,
        runsOn: theProviderOfAnAgent(identity.provider, NONE_STARTED),
      }
      const heldBy = whatHoldsIt(use)
      const running = atWork?.get(identity.slug) ?? []
      const rows = running.map((one) =>
        atWorkNow(one, beingDone?.readAt ?? one.since, stateOf.get(one.conversation)),
      )
      // Decide the state word first and derive its plate from the same arm, so the face and adjacent sentence agree even without session facets.
      const doing = whatTheyAreDoing(rows, use, atWork !== null)
      return {
        identity,
        use,
        heading: agentName(identity.slug, source.identities),
        neverRun: use.conversations === 0,
        provider: use.runsOn.provider,
        canRemove: heldBy.length === 0,
        held: heldBy,
        // ⛔ **Walked in {@link WHAT_HOLDS_AN_IDENTITY}'s own order**, which `whatHoldsIt` already
        // guarantees, so two readers cannot list the reasons differently.
        heldSays: heldBy.map((why) => HOLDING_SAYS[why]),
        facets: plateFor(running, doing, stateOf),
        doing,
        atWork: rows,
      }
    })
    .filter((member) => {
      if (filter === 'never-run' && !member.neverRun) return false
      if (filter === 'worked' && member.neverRun) return false
      if (needle.length === 0) return true
      return `${member.heading} ${member.identity.slug}`.toLocaleLowerCase().includes(needle)
    })
  return {
    members,
    total: source.identities.length,
    homeFoldersWithoutIdentity: source.foldersWithoutARow,
    asOf: beingDone === null ? null : agoWords(beingDone.readAt, now),
  }
}

/**
 * ⚑ **One running conversation, folded once** (593) — the plate's input and the row's words come
 * from the SAME object, so the word and the face cannot disagree (`089`).
 */
function atWorkNow(one: ConversationAtWork, readAt: number, state?: AgentState): AtWorkNow {
  const told = toldOf(one, state)
  return {
    conversation: one.conversation,
    doing: activityLine(told),
    standing: standingOf(sessionFacets(told)),
    // ⛔ **Against the reading's own moment and never a second clock** — {@link WhatIsBeingDone.readAt}
    // was stamped after every row was read, so one page cannot show two ages from two instants.
    since: agoWords(one.since, readAt),
  }
}

/**
 * ⛔ **The one input object** (593): the plate, the word and the standing are three readings of ONE
 * object, which is what makes them incapable of contradicting each other.
 */
function toldOf(one: ConversationAtWork, state?: AgentState): SessionFacetInput {
  // ⚑ **The status the STREAM carried** (593) — see {@link ConversationAtWork.status}.
  // ⛔ `whatAPlateCanDraw` still withholds it when nothing has arrived, so a conversation that has
  // said nothing draws the faceless ring either way.
  const plate = whatAPlateCanDraw(one, one.status)
  return {
    phase: null,
    status: plate.status,
    activity: plate.activity,
    streaming: plate.streaming,
    liveness: null,
    // ⚑ **UI-008 · and the host's one state, where it says the person is needed** — the stream
    // cannot say it, so the card's word and plate would read *idle* over a conversation that
    // needs you.
    ...(state?.is === 'needs-you' ? { waiting: 'waiting-on-a-person' as const } : {}),
  }
}

/**
 * 🔴 **The card's plate** (593) — the single live conversation's, the idle face, or faceless.
 *
 * ## ⛔ Why a quiet identity gets the IDLE face and not a ring
 *
 * Avoid two unknown marks for one absent activity reading. A faceless ring plus an unstarted dotted underline looks broken; whether the process was started is not an independent identity state to draw.
 *
 * ⚑ **`idle` is the true word for it, and it is `042`'s own**: *"idle means we are no longer
 * driving a turn"*. ⛔ With the reading COMPLETE, *this app is running nothing as this identity* is
 * a sound inference — {@link WhatIsBeingDone.conversations}' own ruling — so the idle face is a
 * fact and not a guess.
 *
 * ## ⚠️ And the three states that still draw no face, each for its own reason
 *
 * ⛔ **Nothing read yet** — no inference is available at all. ⛔ **Never run** — nothing has ever
 * driven a turn as it, and an idle face would show a bot resting from work it never did.
 * ⛔ **Two or more live** — {@link byIdentity} refuses to pick and *"a fold that picked would be a
 * decision taken in the wrong place"*; the card's own lines below say what each is doing.
 *
 * ⚑ **No underline in any arm.** It is the PROVIDER's liveness and this page has no read for one.
 */
function plateFor(
  running: readonly ConversationAtWork[],
  doing: WhatTheyAreDoing,
  stateOf: ReadonlyMap<string, AgentState>,
): AgentFacets {
  const one = running.length === 1 ? running[0]! : null
  if (one !== null) return sessionFacets(toldOf(one, stateOf.get(one.conversation)))
  // ⛔ **Read off the arm above rather than recomputed** — see {@link teamRoster}'s own note.
  return { doing: doing.it === 'not-right-now' ? 'idle' : 'unknown' }
}

/** ⛔ **The card's one state line** — see {@link WhatTheyAreDoing} for what each arm means. */
function whatTheyAreDoing(
  rows: readonly AtWorkNow[],
  use: IdentityUse,
  wasRead: boolean,
): WhatTheyAreDoing {
  if (rows.length === 1) {
    const standing = rows[0]!.standing
    return standing === 'unknown'
      ? { it: 'in-a-conversation' }
      : { it: 'one-conversation', standing }
  }
  if (rows.length > 1) return { it: 'more-than-one', count: rows.length }
  // ⛔ **A launch in flight outranks both counts below**, because it is the one state neither of
  // them can see: `isLaunching` is the host's word about a conversation whose rows do not exist yet
  // ({@link IdentityUse.isLaunching}), so `conversations` is still zero and the reading is still
  // empty while a person watches it start.
  if (use.isLaunching) return { it: 'starting' }
  if (use.conversations === 0) return { it: 'never-run' }
  // ⚠️ **Asked LAST, because an identity that has never run is the more specific fact.** A person
  // reading *not in a conversation right now* about an agent nothing has ever run has been told the
  // smaller half.
  return wasRead ? { it: 'not-right-now' } : { it: 'not-read' }
}

/**
 * One agent's conversation as drawn on its Team card, from the shared list.
 *
 * Include every conversation, not just running ones. Narrow `conversation-list.ts`'s rail rows to this agent so its card and the rail describe each conversation alike.
 */
export interface TheirConversation {
  readonly namingPiece: WorkThatNamesIt | null
  readonly worker?: WorkerBindingReading
  /** ⚑ **The conversation's own id** — what the one press sends back. */
  readonly conversation: string
  /** ⚑ **The one state, in its own words** — `agentStateWords`, the words the rail's row says. */
  readonly word: string
  readonly detail?: string
  /** ⚑ **Its standing, for the ink** — {@link STANDING_TONE} indexes it, and nothing else reads it. */
  readonly standing: Standing
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names it** (`W1.2 · Build the pages`), or `null`
   * when it holds none: what tells one agent's conversations apart on its shelf, as its rail row's
   * title.
   */
  readonly named: string | null
  /** ⚑ **Where it works** — its folder's name — or `null` when this app holds no path for it. */
  readonly place: string | null
  /**
   * ⚑ {@link OPEN_IN_ANOTHER_WINDOW} when another window has it open, else `null` — the one fact
   * about where a conversation is that a row says. ⚠️ A conversation THIS window holds is open in a
   * window too, and it is not *another* one: the window's own `held` decides it.
   */
  readonly says: string | null
  /** ⚑ **D-017b · the one press** — {@link OPEN_THE_CONVERSATION}: it opens in its full view. */
  readonly action: string
}

/**
 * 🔴 **One agent's conversations, ended or not, newest first** — or `null` while the one list has
 * not answered (`086`: *not read* is not *none*).
 *
 * ⛔ **Every conversation the list names that runs as this identity** — the list's own population,
 * which leaves out a conversation found in a person's own Claude or Codex folder and one restored
 * from a bundle, as the rail does.
 *
 * @param identity the FOLDED slug, which is what {@link ListedConversation.identity} carries.
 * @param held the conversations THIS window holds.
 */
export function theirConversations(
  listed: readonly ListedConversation[] | null,
  identity: string,
  held: ReadonlySet<string>,
): readonly TheirConversation[] | null {
  if (listed === null) return null
  return listed
    .filter((row) => row.identity === identity)
    .map((row) => {
      const limit = providerLimitDisplay(row, row.state, Date.now())
      const purpose = onPurposeSaid(row.state.is === 'idle', row.waitingOnPurpose)
      const elsewhere = row.inAnotherWindow && !held.has(row.sessionId)
      return {
        ...(row.worker ? { worker: row.worker } : {}),
        conversation: row.sessionId,
        word: limit?.short ?? purpose?.word ?? agentStateWords(row.state),
        ...(limit ? { detail: limit.detail } : purpose ? { detail: purpose.detail } : {}),
        standing: standingOf(facetsOfState(row.state)),
        named: row.named === null ? null : theWorkThatNamesItSaid(row.named),
        namingPiece: row.named,
        place: row.place,
        says: elsewhere ? OPEN_IN_ANOTHER_WINDOW : null,
        action: OPEN_THE_CONVERSATION,
      }
    })
}
