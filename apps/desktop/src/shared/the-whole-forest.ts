import type { Provider } from '@brobot2/shared'
// ⚑ **TYPES and nothing else, in both directions** (543) — `who-called-whom.ts`' own rule, kept
// for the same reason: an edge that is erased at build time cannot hand this module a database, a
// host or a clock. ⛔ There is no value import here at all, so nothing this file does can cost a
// renderer a bundle (`a-value-import-from-shared-costs-the-renderer-135kb`).
import type { LedgerWalk } from './questions'
import type { RunningState, SessionStatus } from './runtime-ipc'
import type { WorkEdge } from './who-called-whom'

/**
 * 🔴 **How many conversations one forest draws, and what happens past it** (637 §2.2).
 *
 * ## ⛔ Why a bound exists at all, measured rather than imagined
 *
 * The person's provider-home history, listed by `session-library.ts` and `SessionLibrary.vue`, can be much larger than the app's hierarchy. {@link TheWholeForest} queries conversations held by app agents and separately counts excluded history through {@link TheWholeForest.heldByNoAgent}; the bound applies to that narrower forest population.
 *
 * ## ⚑ 500, and the number is the ledger fold rather than the row
 *
 * ⛔ **The structural half needs no bound and is deliberately not given one.** It is one indexed
 * scan of `provider_session`, and `selectAll` — the Library's own read — already
 * runs `FROM provider_session … ORDER BY updated_at DESC` over the whole table with no `LIMIT`
 * over those 2,027 rows. ⚠️ A second, tighter rule about the same scan would be this app
 * disagreeing with itself about what one table costs.
 *
 * ⚑ **What this bounds is the LEDGERS.** Every drawn conversation's own record is folded for the
 * work it holds, and that is the half that grows with what each agent did rather than with how many there
 * are. ⚠️ **Since `664` it is not that cost EXACTLY**: a drawn conversation holding OPEN work also
 * takes one wait read to compose its rows, and that read folds the ledger of every conversation it
 * handed work to, which this bound does not cover — see `RuntimeHost.theWholeForest`'s price.
 *
 * ## 🔴 Past it the answer is SHORT and says so — it is never a refusal
 *
 * ⛔ **`read-bundle.ts`' discipline is *"Nothing is silently truncated"* and this honours it the
 * LIBRARY's way, not the bundle's.** ⚠️ A bundle past `MAX_BUNDLE_BYTES` is refused whole, because
 * half a bundle is not a bundle; a forest past this is the newest {@link MAX_FOREST_CONVERSATIONS}
 * of it, with {@link TheWholeForest.conversations} beside {@link LedgerWalk.ledgers} so a person
 * can see how short it is. 🔴 **Standing rule 8.4 is why**: a person with six hundred conversations
 * would meet a refusal they could never clear, and *"the LIMIT is the finding rather than the
 * test"*. ⚑ `LibraryPage`'s own sentence, one surface over — *"silently showing 50 of 500 is the
 * kind of truncation this app treats as a lie about coverage"* — is the shape this copies.
 *
 * ⛔ **And the tree stays a tree, at BOTH of its edges.** A drawn conversation whose parent fell
 * past the bound reads {@link ForestParent} `a-conversation-this-reading-did-not-draw`, and so does
 * a piece whose GIVER did — {@link ForestTask.givenBy}. ⚠️ **Two edges, so two words**: the first
 * draft gave the spawn edge the protection and left the handoff edge a bare id, which is the same
 * dangling pointer one arrow over.
 */
export const MAX_FOREST_CONVERSATIONS = 500

/**
 * 🔴 **Where one node hangs — a WORD, because a null parent spells three different facts** (637
 * §3.1).
 *
 * ## ⛔ The nullable parent this replaces, and what it could not say
 *
 * ⚠️ **`provider_session.parent_session_id` is null for a population that is not one population**
 * — its own docblock says *"null, which means a person did"*, and a conversation swept in from a
 * provider home carries the same null (`schema.ts`). ⛔ A shape
 * that handed that null to a renderer would make it guess, and `a-value-beside-a-word-or-a-union-of-arms`
 * is this repository's rule for exactly that: a value that stands on one arm belongs on that arm.
 *
 * ⚑ **The third arm is about THIS READING and never about the ledger** — two things put a
 * conversation outside it: {@link MAX_FOREST_CONVERSATIONS} cutting the tail, and a conversation
 * no agent of this app holds. ⚠️ The word is the same for both because the fact is the same: the row
 * exists and this answer does not contain it.
 */
export type ForestParent =
  /**
   * Use an explicit person root above app conversations; it has no session id.
   *
   * ## ⚠️ What this word claims, and the one thing it must not be read as
   *
   * This root means no parent was recorded, not that the person typed the request. It includes direct starts and adopted sessions lacking recorded lineage. Draw both below the person without asserting who started them. A conversation's own root work shares its state and is not a separate node.
   *
   * ⛔ **A conversation swept out of his OWN provider homes never reaches this arm at all**: it is
   * not in this reading, because no agent of this app holds it. ⚠️ That exclusion is counted rather
   * than silent — {@link TheWholeForest.heldByNoAgent}.
   *
   * ⚑ **As a piece's giver ({@link ForestTask.givenBy}) it is *a person gave this work*** — work its
   * owner took on for them (D-016 · commit 6): the work row names no giving conversation.
   */
  | { readonly is: 'the-person' }
  /** ⚑ **Another node in this reading** — see {@link UnderAConversation}. */
  | UnderAConversation
  /**
   * 🔴 **That conversation exists and this reading did not draw it** (637 §2.2) — reached by the
   * bound cutting the tail, and by a conversation no agent of this app holds.
   *
   * ⛔ **A WORD rather than an id the renderer would have to look up and fail to find.** ⚠️ The
   * alternative was measured on paper and it is worse both ways: dropping the child hides work a
   * person did today, and leaving `a-conversation` pointing at a node that is not in `nodes` makes
   * every reader write the same missing-parent check — `an-unenumerated-state-counts-as-success`
   * with a tree drawn on it.
   *
   * ⚑ **The id is carried anyway**, because a surface that wants to offer *open its parent* has
   * the one thing it needs, and `504`'s rule is that a row which cannot say why offers no press.
   */
  | { readonly is: 'a-conversation-this-reading-did-not-draw'; readonly conversation: string }

/**
 * ⚑ **The one arm that names a node in this reading** — its own interface, because
 * {@link ForestTask} may hold ONLY this one and a wide {@link ForestParent} there would admit a
 * piece hanging off the person, which nothing can produce.
 */
export interface UnderAConversation {
  readonly is: 'a-conversation'
  /** ⛔ **A conversation in {@link TheWholeForest.nodes}** — never a slug and never a profile id. */
  readonly conversation: string
}

/**
 * ⚑ **D-034 · a conversation another node names, and whether this reading drew it** —
 * {@link ForestParent} less the person, who stands in for no conversation and is replaced by none.
 */
export type NamedConversation = Exclude<ForestParent, { readonly is: 'the-person' }>

/**
 * 🔴 **One conversation as a node of the forest** (637).
 *
 * ## ⛔ What it carries, and the three facts it deliberately does NOT
 *
 * ⚠️ **`whatIsBeingDone` and `whatEachConversationIsWaitingOn` are already population-wide reads on
 * this same wire**, and neither is folded in here. ⛔ **That is a ruling and not an omission**:
 * `whatIsBeingDone`'s own docblock promises *"No store read of any kind"* and argues it, and
 * `WhatEachConversationIsWaitingOn`'s says *"the pairing is the CALLER's, never a reading
 * pretending to be two"* — so a forest carrying either would be a second answer to a question that
 * already has one (`HO-095` §4). ⚑ **`RuntimeScreen.readTheCast` already pairs a lineage read with
 * a population one in a single `Promise.all`** — `whoCalledWhom(asked)` beside `whatIsBeingDone()`
 * — and stamps its own instant; this read joins a call of that shape. ⚠️ **Not *two of these
 * three***: only one of the three population reads is in that call today, and saying otherwise
 * would be citing a precedent that does not exist.
 *
 * ⛔ **Join those readings on {@link conversation} and never on {@link identity}** — see that
 * field, where the measurement is.
 *
 * ⚑ **{@link running} IS here**, and it was the one live fact this row carried until `711`:
 * `SpawnEdge.running` is the precedent, `runningStateOf` is the same private method rather than a
 * second derivation, and the slot map is in memory so nothing awaits between it and
 * {@link TheWholeForest.readAt}.
 *
 * ⚑ **D-034 · and where it stands in a replacement** — {@link standsInFor} and {@link inItsPlace},
 * from the replacements the host keeps in memory, so they cost no read either.
 */
export interface ForestConversation {
  /** ⛔ **Which kind of node this is** — §0's *"each of them represent a task or conversation"*. */
  readonly node: 'a-conversation'
  /** The conversation's own id — what every other door on this wire calls `sessionId`. */
  readonly conversation: string
  /** 🔴 **Where it hangs** — see {@link ForestParent}. */
  readonly under: ForestParent
  /**
   * 🔴 **The identity it runs as — the IDENTITY's folded slug**, exactly as `SpawnEdge.identity`
   * answers it, and never `provider_session.profile_id`, which keeps the caller's spelling verbatim.
   *
   * ⛔ **Never null on this list, and the reason is structural rather than lucky**: a conversation
   * with no identity is excluded by the JOIN that selects this list.
   *
   * ## ⚠️ A DEFECT one reading over, and why the field list says *join on the conversation*
   *
   * ⛔ **`ConversationAtWork.identity` is `HostedSession.profileId`** — `input.profileId ??
   * DEFAULT_PROFILE_ID`, the launcher's raw spelling, and that differs from this field whenever a
   * person first launched an identity under a spelling the fold changes: the slot holds `Dev` and
   * `agent_identity.slug` holds `dev`.
   */
  readonly identity: string
  readonly provider: Provider
  /**
   * ⛔ **What the LEDGER recorded** — the column, and not a second opinion about whether this app
   * is running it. ⚠️ `settleOrphanRuns` settles a crashed run to `idle`, so `idle` is what a live
   * conversation and one a power cut ended three weeks ago both say; {@link running} is the field
   * that tells them apart.
   */
  readonly status: SessionStatus
  /**
   * 🔴 **What this app is doing with it** — `SpawnEdge.running`'s field, from the same private
   * `runningStateOf` rather than a second derivation.
   *
   * ⛔ **Left UNFOLDED on purpose.** `hereIsOf(running, held)` needs the window's own `held` to
   * reach `open-in-another-window`, and whether a surface is THIS one is a question the host cannot
   * answer about a list command — `RUNNING_STATES`' own docblock.
   */
  readonly running: RunningState
  /**
   * 🔴 **D-034 · the conversations this one stands in for**, in no particular order — each that
   * could never be reopened and was replaced (D-017 · R10), its chain of replacements ending at this
   * one: it took their place, the work they gave is its own, and the conversations they started are
   * commanded by it. `[]` when it replaced none, and for one that was itself replaced since: the
   * one at the end of the chain stands in for them all.
   *
   * ⚑ **So a window draws it where they stood** — under their parent, over their children — and a
   * line to a child it, or any of them, gave open work to is dashed. ⛔ Each is named with whether
   * this reading drew it, so one past the bound is still named and never dropped.
   */
  readonly standsInFor: readonly NamedConversation[]
  /**
   * 🔴 **D-034 · the conversation standing where this one stood**, at the end of its chain of
   * replacements — or `null` when none took its place. ⚑ The other end of {@link standsInFor}: a
   * window that draws that conversation draws it here, instead of this one. ⚠️ A chain that loops —
   * only a hand-edited ledger can make one — has no end, and names none.
   */
  readonly inItsPlace: NamedConversation | null
  /** When the conversation was created. */
  readonly startedAt: number
  /** When its row last moved. */
  readonly updatedAt: number
}

/**
 * 🔴 **One piece of work as a node of the forest** (637, §0's other half; a piece since D-016).
 *
 * ## ⛔ It hangs off the conversation that HOLDS it, and that is what makes the tree total
 *
 * ⚠️ **The brief's §3 pointed at the GIVER's view.** ⛔ The ledger says otherwise: every piece event
 * is published into the OWNER's ledger, and `derivePieces(owner, entries)` folds one owner's record
 * — so the forest folds each drawn conversation's own ledger and every piece appears exactly once.
 * ⚑ **That is also what makes {@link under} sound**: the owner IS the conversation whose ledger
 * produced this row, so a piece can never hang off a node this reading did not draw.
 *
 * ⛔ **The giver is a FIELD and not the parent** — {@link WorkEdge.from}, which that shape already
 * carries *"named at both ends"*. ⚠️ A renderer drawing the handoff has both ids without a second
 * read, and `540` §3.1's *never derive lineage from anything but explicit ids* is honoured.
 *
 * ## ⚑ `WorkEdge` whole, rather than a second spelling of a piece
 *
 * ⛔ **Nothing here re-shapes a piece.** `WorkEdge` is the durable wire shape for one piece of work
 * and `workEdge` is its one constructor; a forest-flavoured copy would be a second answer to *what is
 * this work* with the same fields in a different order.
 *
 * ⚠️ **A root is never a node** (D-016 · R1): its state is its conversation's, and the conversation
 * is the node. ⚑ A piece's own parent piece is not drawn as an edge here either — the forest's
 * edges are conversations and hand-overs — so the graph's piece nodes are leaves.
 */
export interface ForestTask {
  /** ⛔ **Which kind of node this is** — §0's *"each of them represent a task or conversation"*. */
  readonly node: 'a-task'
  /**
   * 🔴 **The conversation HOLDING this work** — narrow on purpose, and equal to
   * {@link WorkEdge.to} by construction.
   *
   * ⛔ **A derivable duplicate, and it is the one this shape keeps.** `SpawnEdge`'s rule is that a
   * direction the shape already decides must not also be a field; here the shape decides nothing,
   * because {@link TheWholeForest.nodes} is a HETEROGENEOUS list and a renderer walks one field
   * across all of it. ⚑ Narrowing the type to {@link UnderAConversation} is what keeps the
   * duplicate safe: this arm cannot hold `the-person` and cannot hold the bound's word.
   */
  readonly under: UnderAConversation
  /**
   * 🔴 **The conversation that GAVE this work, and whether this reading drew it** (637).
   *
   * ## ⛔ Why the giver needs a word when the owner does not
   *
   * ⚠️ **{@link under} is sound by construction and this is not.** The owner IS the conversation
   * whose ledger produced this row, so it is always in `nodes`; the giver is a different
   * conversation entirely and two things can put it outside this reading — the bound cutting an
   * older parent, and a giver no agent of this app holds. ⛔ **`WorkEdge.from` alone would be a
   * dangling id** and every renderer drawing the handoff would write the same membership check,
   * which is `an-unenumerated-state-counts-as-success` with an arrow drawn on it.
   *
   * ⚑ **{@link ForestParent} reused rather than a second vocabulary**, and `the-person` is a piece
   * a person gave — work its owner took on for them (D-016 · commit 6), drawn under the person as a
   * root's conversation is; a root itself is never a node.
   */
  readonly givenBy: ForestParent
  /**
   * ⚑ **The work itself, as the band carries it** — see {@link WorkEdge}, whose `state` arrives
   * COMPOSED here exactly as it does on both ends of the band (`664`, `D32`).
   */
  readonly work: WorkEdge
}

/** ⛔ **One node of the forest** — discriminated on `node`, which is §4's criterion 3. */
export type ForestNode = ForestConversation | ForestTask

/**
 * The whole forest from the person down.
 *
 * > ⚑ ***"In the Team ui: I want a tab to switch to a graph vue. we see the user at the top,
 * > followed by all brobot conversations right after, and each brobot converation with its own
 * > children etc.. each of them represent a task or converation."***
 *
 * ## ⛔ Why this is a new read and not `whoCalledWhom` called N times
 *
 * ⚠️ **`whoCalledWhom` answers *who did THIS conversation spawn* and cannot be walked upward.**
 * Its own docblock rules the wider walk out of that file: *"No ancestor chain and no recursive
 * traversal… a walk this read performed for a window would be a bound nobody has priced."* ⛔ N
 * calls would be N round trips on N clocks, and one `readAt` over them would be `HO-050` §3's
 * animal — a figure that is not measuring what it claims.
 *
 * ⚑ **And it is not a recursive CTE either.** `629` wrote one for *is A above B*, seeded at one id
 * and bounded at 64 hops against a cycle a hand edit could make. 🔴 **A forest needs every root,
 * not one leaf's line** — and `parent_session_id` IS the edge, so the whole shape is that column
 * selected beside the node facts and assembled in memory. ⛔ **One flat indexed scan beats a
 * recursion here and cannot hang**: a cycle in the data makes a node whose parent is also drawn,
 * which is a picture, not a walk that does not return.
 *
 * ## ⚠️ What it is NOT a claim about
 *
 * ⛔ **{@link readAt} is not a claim about NOW**, and the forest is the slowest-moving of the three
 * population reads: it moves when a conversation is created or spawned and when work is given or
 * closed. ⚑ A surface drawing an age beside a doing word draws `WhatIsBeingDone`'s stamp and not
 * this one.
 */
export interface TheWholeForest {
  /**
   * 🔴 **The one moment every node below had been read by** — `WhoCalledWhom.readAt`'s rule and the
   * same argument: `better-sqlite3` executes on the calling thread, every statement is synchronous,
   * and there is no `await` anywhere between the first of them and this stamp.
   *
   * ⚑ **Stamped LAST**, after every ledger has been folded — a completion point, never a start
   * time.
   */
  readonly readAt: number
  /**
   * ⚑ **Every node, conversations and pieces together, as ONE walk.**
   *
   * ⛔ **`rows: []` is never *this workspace is empty* on its own** — `LedgerWalk.walk` is what
   * tells `no-ledger` from a real reading, which is `452` §5.1's forbidden sentence one noun over.
   * ⚠️ **{@link LedgerWalk.ledgers} is the number of drawn conversations whose ledgers were
   * folded** — the wait reads that compose a piece's state open more, and are not counted THERE.
   * ⚑ **{@link LedgerWalk.rowsUnread} is every row this reading could not read, wherever it met
   * it** (`671` R18): the drawn ledgers, AND the holder's routings and questions and the ledgers of
   * the work it gave out, each row counted once however many holders met it. ⛔ **Until
   * `671` the wait reads' rows were skipped uncounted, and one torn assignment anywhere raised the
   * whole read** (`664` F1) — the Team page drew *"Nothing has been read about this workspace
   * yet"*. ⚠️ So a non-zero count is not only *a piece list short by a row*: a piece's composed
   * STATE may be wrong by one too, and the count cannot say which.
   *
   * ⛔ **MOST RECENTLY ACTIVE FIRST, and here the order is the BOUND's rather than a preference.**
   * Conversations arrive by `updated_at` descending and each one's pieces follow it, because
   * {@link MAX_FOREST_CONVERSATIONS} cuts the tail — and the tail a person can afford to lose is
   * the one they stopped looking at. ⚠️ **Not `created_at`**: a conversation begun a month ago and
   * worked in this morning must outrank one opened yesterday and never touched. ⚠️ Nothing else may be concluded from a position: a surface
   * that wants any other order sorts on a field it can name.
   */
  readonly nodes: LedgerWalk<ForestNode>
  /**
   * 🔴 **How many conversations this app's agents hold — the whole population, before the bound.**
   *
   * ⛔ **Counted rather than derived from {@link nodes}** — *"the party that WALKED is the only one
   * that can say what it walked"*, and `rows.length` would
   * answer *what was drawn* to a question that asked *how many there are*. ⚑ It is what makes
   * {@link MAX_FOREST_CONVERSATIONS} visible: equal to `nodes.ledgers` means nothing was left out.
   */
  readonly conversations: number
  /**
   * ⚠️ **How many conversations this app records that no agent of this app holds** — the count the
   * digest discloses too, read rather than recomputed.
   *
   * Count excluded conversations held by no app agent, including discovered history in the person's own provider homes. Report the exclusion so the forest does not appear to cover them.
   */
  readonly heldByNoAgent: number
}
