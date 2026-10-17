import type { AgentIdentity } from '../../../shared/runtime-ipc'
import { agentName } from '../../../shared/runtime-ipc'
import type { LedgerWalkKind } from '../../../shared/questions'
import { walkCovers } from '../../../shared/questions'
import type {
  ForestConversation,
  ForestParent,
  ForestTask,
  TheWholeForest,
} from '../../../shared/the-whole-forest'
import type { ConversationAtWork, WhatIsBeingDone } from '../../../shared/what-is-being-done'
import { byConversation, whatAPlateCanDraw } from '../../../shared/what-is-being-done'
import type { WhatEachConversationIsWaitingOn } from '../../../shared/tasks'
import { TASK_IS_OPEN } from '../../../shared/tasks'
import { theWaitIn, theWorkIn, whatTheWaitsCouldNotRead } from './conversation-waits'
import {
  activityLine,
  sessionFacets,
  standingOf,
  STANDING_LABEL,
  type AgentFacets,
  type RailSays,
  type Standing,
} from './agent-state'
import { workReading, type WorkReading } from './work-report'
import { OPEN_IN_ANOTHER_WINDOW, openElsewhere } from './taking-over'
import { unreadSays } from './rows-unread'
import { A_PERSON_ADDRESSED } from './outgoing-card'

/**
 * 🔴 **The whole forest, from the person down — as a person reads it** (641).
 *
 * ## Show the whole conversation and work hierarchy
 *
 * ⚠️ ***"In the Team ui: I want a tab to switch to a graph vue. we see the user at the top, followed
 * by all brobot conversations right after, and each brobot converation with its own children etc..
 * each of them represent a task or converation."***
 *
 * ## ⛔ A FLAT pre-order list, and the flatness is the design
 *
 * ⚠️ **A recursive component would have been the obvious drawing and it is the wrong one here.**
 * ⛔ **Depth is unbounded** — this is every conversation this app ever placed, and a chain is as
 * deep as the spawns that made it. ⚑ **A flat list carrying {@link ForestRow.depth} can be measured
 * in PIXELS** — `606`'s rule, which `631`'s own dom test states: *"the ORDER a person reads —
 * measured in pixels rather than in the source, because a `v-if` could reorder them without moving
 * a line."* 🔴 **A recursive tree can only be asserted structurally**, and a structural assertion
 * cannot tell a drawn row from a clipped one.
 *
 * ## ⛔ THE JOIN IS `conversation`. NEVER `identity`.
 *
 * ⚠️ **`637` F1 measured why, and it is silent when it is wrong:** `ConversationAtWork.identity` is
 * `HostedSession.profileId` = `input.profileId ?? DEFAULT_PROFILE_ID` — the launcher's raw spelling
 * — while {@link ForestConversation.identity} is `agent_identity.slug`, folded under a CHECK. *"**A
 * person who first launches an identity as `Dev` gets `slug = 'dev'` and a slot holding `'Dev'`.**"*
 * ⛔ **`ConversationWaiting.identity` is the same raw spelling**, so both live readings carry it.
 * 🔴 **`637` says this is the join *"the frontend seat would otherwise have written silently
 * wrong"*** — ⚑ silently, because it looks right on every agent whose two spellings happen to
 * match, which is most of them.
 *
 * ## ⚠️ Three readings, three moments, and they may not be merged
 *
 * ⛔ **`637` §5's third must-not:** *"Never draw an age from `TheWholeForest.readAt` beside a doing
 * word. Draw `WhatIsBeingDone.readAt` there — it is the one that moves in seconds."* ⚑ So
 * {@link ForestView.asOf} is the FOREST's moment and {@link ForestView.doingAsOf} is the live one,
 * and the two are separate fields because they are separate claims.
 *
 * ## ⚑ And the fourth, which reads like an optimisation and is a correctness rule
 *
 * ⛔ **`637` §5:** *"Never use `spawnedAt !== null` as *my parent is in this reading*. A node whose
 * parent fell past the bound keeps its real `spawnedAt`. The only test is
 * `under.is === 'a-conversation'`, and the same holds for the handoff edge: check `givenBy.is`,
 * never `work.from` alone."* ⚑ **Both tests below are spelled that way** and nothing here reads
 * `spawnedAt` or `work.from` to decide where a row hangs.
 *
 * ⚠️ **`637` §5 heads its list *"Three things the tab must NOT do"* and lists FOUR.** ⛔ Counted
 * rather than trusted ([[a-title-that-names-a-count-the-assertion-never-checks]]); all four are
 * quoted above and in this dispatch's response.
 */

/**
 * Distinguish conversation rows from work rows.
 */
export type ForestRowKind = 'a-conversation' | 'a-task'

/**
 * ⚑ **One row of the drawing**, in the order a person reads it.
 *
 * ⛔ **`depth` is the only record of who started whom, and nothing else derives it.** A row's parent
 * is always the nearest row above it with a smaller depth, which is what makes the flat list a tree
 * without a second structure to keep in step. ⚑ It was the INDENT until `668`; it is the generation
 * now — `forest-graph.ts` reads it and nothing else to place a card.
 */
export interface ForestRow {
  readonly kind: ForestRowKind
  /** ⛔ **The conversation this row IS** (a conversation) or **is held by** (a task). */
  readonly conversation: string
  /** ⚑ Stable across a re-read, because it is the node's own id and never a position. */
  readonly key: string
  /** 0 for a row directly under the person. */
  readonly depth: number
  /** ⚑ **The name a person reads** — {@link agentName}, the app's one naming function. */
  readonly name: string
  /** ⛔ **The plate.** `unknown` where no live reading names this conversation — never `idle`. */
  readonly facets: AgentFacets
  /**
   * ⚠️ **What it is doing, as a WORD**, or `null` where nothing is known.
   *
   * ⛔ **`standingOf` and not `facets.doing`**, because the DOING is `idle` for a conversation whose
   * work is out with somebody else — `HO-095` §5.1, which is the whole of `636`.
   *
   * ⚑ **645 · this word is no longer a workaround and its reason changed.** It was written while
   * `AgentState.vue` could not receive `636`'s facet at all; that hole is closed, and the plate now
   * says the wait in its accessible name. 🔴 **The word stays, and it is the ONE place the forest says
   * a wait to the eye**: a plate never draws one (`645`), and since `668` the task lines on the card
   * beneath this word carry no dot at all — they sit under the holder's own plate and this word.
   * ⛔ Remove it and a conversation waiting on a worker reads as plain idle —
   * `a-dot-says-one-thing.render.test.ts` §3 is what goes red.
   *
   * Use the rail's word when its reading is available so Graph and rail agree. A parent's open delegated work is shown by its dashed child link rather than an invented extra state word.
   */
  readonly says: string | null
  /** ⚑ The identity's slug, or `null` where this app never placed it as one. */
  readonly identity: string | null
  /** A conversation row's own facts. `null` on a task row. */
  readonly conversationRow: ConversationRow | null
  /** A task row's own facts. `null` on a conversation row. */
  readonly taskRow: TaskRow | null
}

/** ⚑ What only a CONVERSATION row carries. */
export interface ConversationRow {
  /**
   * ⚑ **D-017b · another window has it open** — `openElsewhere`, which needs the window's own
   * `held`; the one fact about where it is that a node says.
   */
  readonly elsewhere: boolean
  /** ⚑ {@link OPEN_IN_ANOTHER_WINDOW} when {@link elsewhere}, else `null`. */
  readonly whereSays: string | null
  /**
   * 🔴 **Its parent exists and this reading did not draw it** — the id, so a surface can offer
   * *open its parent*, and `null` on every row whose parent IS drawn or is the person.
   *
   * ⛔ **Never inferred from `spawnedAt`** — `637` §5's fourth must-not.
   */
  readonly parentNotDrawn: string | null
}

/** ⚑ What only a TASK row carries — a piece of work, since D-016. */
export interface TaskRow {
  readonly piece: string
  /** ⚑ The label and the state's own word — `work-report.ts`, shared with three other surfaces. */
  readonly reading: WorkReading
  /** The piece's title, whole — one line by construction; the row's `title` carries it too. */
  readonly said: string
  readonly open: boolean
  /**
   * ⚑ **Who GAVE it**, named — {@link A_PERSON_ADDRESSED} where a person gave it (work its holder
   * took on for them, D-016 · commit 6), never `agentName(null)`, which is BroBot.
   */
  readonly givenByName: string
  /**
   * ⚑ **UI-004 · the conversation that gave it**, where this reading draws it — `null` where a person
   * gave it, or where the giver is not drawn. ⛔ **`givenBy.is`, never `work.from` alone** — `637`
   * §5's fourth must-not, the handoff half.
   */
  readonly giver: string | null
  /**
   * 🔴 **The giver exists and this reading did not draw it** — the id, or `null` where it is drawn.
   *
   * ⛔ **`givenBy.is`, never `work.from` alone** — `637` §5's fourth must-not, the handoff half.
   */
  readonly giverNotDrawn: string | null
}

/**
 * ⛔ **What this reading LEFT OUT, in four separate facts** — none of which is *the tree is empty*.
 *
 * Disclose incomplete coverage for the whole forest. Large trees need this explanation even when the smaller conversation band omits general reassurance.
 */
export interface ForestCoverage {
  /** ⛔ **The walk's own sentence**, or `null` for a word this build cannot spell (fail-closed). */
  readonly covers: string | null
  /** ⚑ **How many conversations this app has PLACED** — counted before the bound. */
  readonly there: number
  /** ⚑ **How many this reading DREW.** */
  readonly drawn: number
  /**
   * ⚑ **D-034 · how many of those are drawn as the one that took their place** — each could never be
   * reopened and was replaced, so it has no card of its own.
   */
  readonly replaced: number
  /**
   * 🔴 **How many the bound cut**, or `0`.
   *
   * ⛔ **Only meaningful once {@link walked} is true.** `NULL_SESSION_STORE` answers `ledgers: 0`
   * and `placedConversations()` answers `0`, so `there === drawn` holds VACUOUSLY over a store that
   * never looked ([[a-comparison-tested-where-both-sides-agree]]).
   */
  readonly cut: number
  /**
   * ⚠️ **Ledger rows the walk could not parse.** ⛔ **678 · not only *"the TASK lists are short by
   * this"***, which is what this said: since `671` a torn row the walk MET is counted, and a row the
   * composed state of a drawn task depended on can leave that task in the wrong state — the count's
   * own docblock in `shared/the-whole-forest.ts` says so. ⚑ {@link short} is what a person reads.
   */
  readonly rowsUnread: number
  /**
   * ⚑ **678 · the sentence for {@link rowsUnread}** — `unreadSays`, one for every surface, with
   * D-017's records skipped whole; `null` when there is nothing to say.
   */
  readonly short: string | null
  /**
   * 🔴 **685 · the WAITS reading's own unread rows, as its sentence** (`676` F-R18a) — the plates'
   * *waiting on…* words are read from it, so a torn row there can leave a plate reading *idle*.
   * ⛔ **Its own count and never summed into {@link rowsUnread}**: both walks meet question and
   * routing rows, so a sum would count one torn row twice — `678`'s *one count, one sentence*.
   */
  readonly waitsShort: string | null
  /** ⛔ **The excluded population** — conversations no agent of this app holds. `637` measured 2,027. */
  readonly heldByNoAgent: number
  /** ⚑ **Whether the walk that actually looks is the walk that answered.** */
  readonly walked: boolean
}

export interface ForestView {
  /** ⚑ **Every row, in the order a person reads it** — pre-order, person first. */
  readonly rows: readonly ForestRow[]
  readonly coverage: ForestCoverage
  /** ⛔ **The FOREST's moment.** Never drawn beside a doing word — `637` §5's third must-not. */
  readonly asOf: number
  /** ⚑ **The LIVE moment**, or `null` — the one that moves in seconds, and the one a doing word owes. */
  readonly doingAsOf: number | null
  /**
   * ⚑ **D-034 · where a replaced conversation is drawn** — its id to its stand-in's, for each one
   * drawn in another's place, so a surface that names it finds the card. Absent, nothing was replaced.
   */
  readonly placeOf?: ReadonlyMap<string, string>
}

/** ⛔ The walk that actually looks at every conversation this app placed. */
const THE_WALK: LedgerWalkKind = 'every-conversation-this-app-placed'

export interface ForestViewInput {
  /** ⛔ **`null` is *the read did not answer*** — never a forest with no nodes. */
  readonly forest: TheWholeForest | null
  readonly atWork: WhatIsBeingDone | null
  readonly waits: WhatEachConversationIsWaitingOn | null
  readonly identities: readonly AgentIdentity[] | null
  /** ⛔ **The conversations THIS WINDOW holds** — what tells *open in another window* from *here*. */
  readonly held: ReadonlySet<string>
  /**
   * Use each conversation's rail plate and word so Graph updates with the same state reading as the right panel.
   *
   * ⛔ **The forest's own plate is a POLL** — {@link plateFor} over `whatIsBeingDone`, read on
   * arrival and every 30 seconds, worded by `STANDING_LABEL` — while the rail follows D-019's push
   * and speaks the app's one word table (`agentStateWords`; `standingWord` for a conversation this
   * window holds, from its own record — what `668` put here as `live`). ⚑ **So with a rail on
   * screen every card is the rail's row**: the same plate, the same word, the moment it moves; and a
   * conversation the rail does not name yet draws the faceless plate and no word, the chips' rule.
   *
   * ⚠️ **Optional, and absent or `null` is *no rail on screen*** — the poll answers for every row, as
   * it did before this field existed.
   */
  readonly said?: ReadonlyMap<string, RailSays> | null
}

/**
 * ⚑ **The plate for one conversation**, from the two live readings, joined on `conversation`.
 *
 * ⛔ **`plateOf`'s shape, not `plateOf` itself.** That one is private to `working-together.ts` and
 * takes no wait; exporting it and widening it would put `636`'s facet on the conversation band's
 * plates too, which is a change that band did not ask for.
 */
function plateFor(
  node: ForestConversation,
  atWork: ConversationAtWork | null,
  waits: WhatEachConversationIsWaitingOn | null,
): { facets: AgentFacets; standing: Standing } {
  // ⚠️ **The status is WITHHELD, never replaced** — `whatAPlateCanDraw`'s decision and not ours.
  const plate = atWork === null ? null : whatAPlateCanDraw(atWork, atWork.status)
  // ⛔ **ONE object, feeding both `sessionFacets` and `activityLine`** — `089`'s defect is two
  // objects that disagree about the same conversation.
  const told = {
    phase: null,
    // ⚑ **D-017b** — a conversation nothing runs has no plate to read, and its recorded status says
    // it is doing nothing here; one this app runs is what its plate says.
    status: plate?.status ?? (node.running === 'not-running' ? node.status : null),
    activity: plate?.activity ?? null,
    streaming: plate?.streaming ?? false,
    liveness: null,
    // ⛔ **`theWaitIn` and never `row?.waiting`** — it is the only place the three absences of
    // `whatEachConversationIsWaitingOn` are told apart, and an absent facet adds nothing.
    ...(theWaitIn(waits, node.conversation) !== undefined
      ? { waiting: theWaitIn(waits, node.conversation) }
      : {}),
    // 🔴 **D-006 · and where the work it holds stands**, on the same rule.
    ...(theWorkIn(waits, node.conversation) !== undefined
      ? { work: theWorkIn(waits, node.conversation) }
      : {}),
  }
  void activityLine(told)
  const facets = sessionFacets(told)
  return { facets, standing: standingOf(facets) }
}

/**
 * 🔴 **The forest, folded into rows** — pure, total, and `null` only where nothing has been read.
 *
 * ⚑ **`null` means *this window has not asked yet*.** ⛔ **A read that ANSWERED with no nodes is a
 * view with no rows and a coverage that says so**, which is the distinction `an-unenumerated-state-
 * counts-as-success` is about and `641` §5.5 requires.
 */
export function forestView(input: ForestViewInput): ForestView | null {
  const forest = input.forest
  if (forest === null) return null

  const atWork = input.atWork === null ? null : byConversation(input.atWork)
  /**
   * ⚑ **The app's ONE naming function, and it already answers for `null`** — `agentName` falls
   * through to `profileLabel`, which is `DEFAULT_PROFILE_LABEL` for a conversation this app never
   * placed as an identity.
   *
   * ⛔ **A first version wrote its own fallback here** — *"a conversation"* — and
   * that string is user-visible and nobody had classified it. ⚠️ It was
   * not only uncensused, it was a SECOND answer to a question `working-together.ts:775` already
   * answers the same way for the same nullable column.
   */
  const named = (identity: string | null): string => agentName(identity, input.identities)

  // ⛔ **Two passes, because the walk is HETEROGENEOUS and a task may precede nothing.** The rows
  // arrive as `[conversation, ...its tasks]` in `updated_at DESC` order, so a conversation's
  // CHILDREN can appear anywhere — including before it.
  const conversations = new Map<string, ForestConversation>()
  for (const node of forest.nodes.rows) {
    if (node.node === 'a-conversation') conversations.set(node.conversation, node)
  }

  // 🔴 **D-034 · a stand-in is drawn in its predecessor's place.** A conversation that could never
  // be reopened and was replaced is not drawn beside the one that took its place: its children, the
  // pieces it holds and the pieces it gave all hang on the stand-in, so the parent's line to a child
  // is dashed by work given before the replacement and after it alike. ⚑ Every link of a chain names
  // its end, so one lookup is enough. ⚠️ Looked up by id among this reading's conversations: a
  // stand-in past the bound is not here, and its predecessor stays drawn, with the words it has.
  const placeOf = new Map<string, string>()
  for (const node of conversations.values()) {
    for (const before of node.standsInFor) {
      if (before.conversation !== node.conversation)
        placeOf.set(before.conversation, node.conversation)
    }
    const after = node.inItsPlace?.conversation
    if (after !== undefined && after !== node.conversation && conversations.has(after)) {
      placeOf.set(node.conversation, after)
    }
  }
  // ⚠️ **Every entry lands on a final stand-in**, whatever the data says: the host names a chain's
  // end and a loop names none, but this fold is total, so a stale link is followed to its end and a
  // loop is dropped, and no conversation hides behind one that is itself hidden.
  const links = new Map(placeOf)
  for (const from of links.keys()) {
    const seen = new Set<string>([from])
    let at = links.get(from)
    while (at !== undefined && links.has(at) && !seen.has(at)) {
      seen.add(at)
      at = links.get(at)
    }
    if (at === undefined || seen.has(at)) placeOf.delete(from)
    else placeOf.set(from, at)
  }
  const place = (id: string): string => placeOf.get(id) ?? id
  /** A conversation drawn as a node: in this reading, and not standing behind its stand-in. */
  const drawn = (id: string): boolean => conversations.has(id) && !placeOf.has(id)

  const tasksOf = new Map<string, ForestTask[]>()
  for (const node of forest.nodes.rows) {
    if (node.node === 'a-conversation') continue
    const holder = place(node.under.conversation)
    const held = tasksOf.get(holder) ?? []
    held.push(node)
    tasksOf.set(holder, held)
  }

  /** ⚑ D-034 · the conversation a parent or a giver names, at its place: drawn, or `null`. */
  const placed = (named: ForestParent): string | null => {
    if (named.is === 'the-person') return null
    const at = place(named.conversation)
    return drawn(at) ? at : null
  }

  // ⚑ **Children by parent, and the ROOTS.** ⛔ `under.is` is the ONLY test — `637` §5's fourth
  // must-not, and a parent id that names no drawn node is a root with a note. ⚑ D-034 · the parent
  // is taken at its place, so a replaced parent's children hang on its stand-in.
  const childrenOf = new Map<string, ForestConversation[]>()
  const roots: ForestConversation[] = []
  for (const node of conversations.values()) {
    if (!drawn(node.conversation)) continue
    let parent = placed(node.under)
    // ⚑ A stand-in whose predecessor was its own parent takes that predecessor's parent.
    if (parent === node.conversation && node.under.is !== 'the-person') {
      const before = conversations.get(node.under.conversation)
      parent = before === undefined ? null : placed(before.under)
    }
    if (parent !== null && parent !== node.conversation) {
      const kin = childrenOf.get(parent) ?? []
      kin.push(node)
      childrenOf.set(parent, kin)
    } else roots.push(node)
  }

  /** The id a parent or a giver names that is not drawn here — never the person. */
  const notDrawn = (named: ForestParent): string | null =>
    named.is === 'the-person' || placed(named) !== null ? null : named.conversation

  const rows: ForestRow[] = []
  // ⚠️ **Iterative, not recursive**: depth is unbounded and a chain of two thousand would be a
  // stack a person's own data could overflow. ⛔ **668 · this comment was FALSE until `668`**: the
  // walk called itself once per child, and `668`'s 3,000-deep chain overflowed it. ⚑ An explicit
  // stack now, in the same pre-order — `visit` draws one conversation and its tasks, and the loop
  // below hands it the children. (`MAX_FOREST_CONVERSATIONS` is 500 today, which is why no real
  // reading ever reached the overflow.)
  const visit = (node: ForestConversation, depth: number): void => {
    // ⚑ **UI-004 · the rail's row, where a rail is on screen** — see {@link ForestViewInput.said}.
    const railed = input.said?.get(node.conversation)
    const polled =
      input.said === undefined || input.said === null
        ? plateFor(node, atWork?.get(node.conversation) ?? null, input.waits)
        : null
    const facets: AgentFacets = polled?.facets ?? railed?.facets ?? {}
    const says = polled === null ? (railed?.word ?? null) : STANDING_LABEL[polled.standing]
    const elsewhere = openElsewhere(node.running, input.held.has(node.conversation))
    rows.push({
      kind: 'a-conversation',
      conversation: node.conversation,
      key: node.conversation,
      depth,
      name: named(node.identity),
      facets,
      says,
      identity: node.identity,
      conversationRow: {
        elsewhere,
        whereSays: elsewhere ? OPEN_IN_ANOTHER_WINDOW : null,
        // ⛔ **Only where the parent really is outside this reading** — never where it is the person.
        parentNotDrawn: notDrawn(node.under),
      },
      taskRow: null,
    })
    for (const task of tasksOf.get(node.conversation) ?? []) {
      const reading = workReading(task.work)
      const open = Object.hasOwn(TASK_IS_OPEN, task.work.state)
        ? TASK_IS_OPEN[task.work.state]
        : false
      rows.push({
        kind: 'a-task',
        conversation: node.conversation,
        key: task.work.piece,
        depth: depth + 1,
        name: named(task.work.toIdentity),
        facets,
        says: reading.word,
        identity: task.work.toIdentity,
        conversationRow: null,
        taskRow: {
          piece: task.work.piece,
          reading,
          said: task.work.title,
          open,
          givenByName:
            task.givenBy.is === 'the-person' ? A_PERSON_ADDRESSED : named(task.work.fromIdentity),
          // ⚑ D-034 · the giver at its place, so a piece the replaced parent gave counts as its stand-in's.
          giver: placed(task.givenBy),
          // ⛔ **`givenBy.is`, never `work.from` alone** — `637` §5's fourth must-not.
          giverNotDrawn: notDrawn(task.givenBy),
        },
      })
    }
  }
  const pending: [ForestConversation, number][] = roots.map((root) => [root, 0])
  pending.reverse()
  const visited = new Set<string>()
  const walk = (): void => {
    while (pending.length > 0) {
      const [node, depth] = pending.pop()!
      if (visited.has(node.conversation)) continue
      visited.add(node.conversation)
      visit(node, depth)
      // ⚑ Children pushed LAST-first, so the first child is visited next — pre-order, as before.
      const kin = childrenOf.get(node.conversation) ?? []
      for (let i = kin.length - 1; i >= 0; i -= 1) pending.push([kin[i]!, depth + 1])
    }
  }
  walk()
  // ⚠️ **D-034 · no drawn conversation is left out**: parents taken at their place could, on data
  // the host never sends, close a ring with no root. Each one the walk missed starts a tree of its own.
  for (const node of conversations.values()) {
    if (!drawn(node.conversation) || visited.has(node.conversation)) continue
    pending.push([node, 0])
    walk()
  }

  const walked = forest.nodes.walk === THE_WALK
  return {
    rows,
    coverage: {
      covers: walkCovers(forest.nodes.walk),
      there: forest.conversations,
      drawn: forest.nodes.ledgers,
      replaced: [...conversations.keys()].filter((id) => placeOf.has(id)).length,
      // ⛔ **Never below zero, and only read where `walked`** — see {@link ForestCoverage.cut}.
      cut: Math.max(0, forest.conversations - forest.nodes.ledgers),
      rowsUnread: forest.nodes.rowsUnread,
      short: unreadSays(forest.nodes.rowsUnread, forest.nodes.ledgersSkipped),
      waitsShort: whatTheWaitsCouldNotRead(
        input.waits,
        rows.flatMap((row) => (row.kind === 'a-conversation' ? [row.conversation] : [])),
      ),
      heldByNoAgent: forest.heldByNoAgent,
      walked,
    },
    asOf: forest.readAt,
    doingAsOf: input.atWork?.readAt ?? null,
    ...(placeOf.size === 0 ? {} : { placeOf }),
  }
}
