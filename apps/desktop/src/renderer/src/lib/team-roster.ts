import type { AgentState } from '../../../shared/agent-state-contracts'
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
import type { UsageProviderNames } from './usage-limit'
import { agentStateWords } from '../../../shared/agent-state'
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
 * Derive the cadence from the shared activity interval instead of hardcoding 30_000 ms.
 * Opening refreshes immediately. Work changes refresh the forest through pushes.
 */
export const ROSTER_EVERY_MS = ACTIVITY_READ_EVERY_MS

export type TeamFilter = 'all' | 'never-run' | 'worked'

/** Show each running conversation for an identity, since no one conversation represents the rest. */
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

export type WhatTheyAreDoing =
  /**
   * ⚑ **Exactly one conversation is live and this app has a word for it** — so the card says the
   * word the rail and the conversation header both say about the same session.
   */
  | { readonly it: 'one-conversation'; readonly standing: Standing }
  /** Running is known even when the activity frame supplies no standing to show. */
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

/** Share {@link STANDING_LABEL} with the session header so the same status gets the same wording. */
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

/** Use {@link STANDING_TONE} only for a known standing. Running alone does not imply activity. */
export function doingTone(what: WhatTheyAreDoing): string {
  return what.it === 'one-conversation' ? STANDING_TONE[what.standing] : ''
}

export interface TeamMemberView {
  readonly identity: AgentIdentity
  readonly use: IdentityUse
  /** Use {@link agentName} to preserve supplied names and the seeded identity’s display name. */
  readonly heading: string
  readonly neverRun: boolean
  readonly provider: string | null
  readonly canRemove: boolean
  readonly held: readonly WhatHoldsAnIdentity[]
  /** Render removal reasons with {@link HOLDING_SAYS}. */
  readonly heldSays: readonly string[]
  /** Use one running conversation’s facets. With several, draw the faceless plate and list each below. */
  readonly facets: AgentFacets
  /** ⚑ **`EXT-012` §2.1's second fact** — see {@link WhatTheyAreDoing}. */
  readonly doing: WhatTheyAreDoing
  /** ⚑ **One entry per conversation this app is running as it, right now.** */
  readonly atWork: readonly AtWorkNow[]
}

export interface TeamRosterView {
  readonly members: readonly TeamMemberView[]
  /** Count identities before applying the search and filter. */
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
  /** The minute clock supplies the current time so the freshness label advances without interaction. */
  readonly now: number
  /**
   * ⚑ **UI-008 · the host's list of conversations** — its one state for a conversation at work says
   * whether that conversation NEEDS the person, which the stream's status cannot (F051: a question
   * asked, the turn ended, so the stream says idle). Absent or `null`: the stream's word alone.
   */
  readonly listed?: readonly ListedConversation[] | null
}

/**
 * Use the conversation status from the activity reading. Activity can refine an already busy
 * status. Until a usable frame arrives, show that the conversation is running with unknown activity.
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
 * A previously used identity with a complete, quiet reading shows idle. Unread, never-run and
 * multi-conversation states show a faceless plate. The roster has no independent liveness read.
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
 * List this identity’s conversations newest first, using the rail’s population of managed conversations.
 * Return null until the list answers. The folded slug identifies the agent and held is window-local.
 */
export function theirConversations(
  listed: readonly ListedConversation[] | null,
  identity: string,
  held: ReadonlySet<string>,
  names?: UsageProviderNames,
): readonly TheirConversation[] | null {
  if (listed === null) return null
  return listed
    .filter((row) => row.identity === identity)
    .map((row) => {
      const limit = providerLimitDisplay(row, row.state, Date.now(), names)
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
