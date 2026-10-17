import type { ContextReading } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
// ⚑ **TYPES and nothing else, in both directions** (543) — `tasks.ts`' own rule, kept for the same
// reason: an edge that is erased at build time cannot hand this module a database, a host or a
// clock, and `runtime-ipc.ts` imports the shapes below the same way. ⛔ There is no value import
// here at all, so nothing this file does can cost a renderer a bundle (`a-value-import-from-shared-costs-the-renderer-135kb`).
import type { LedgerWalk } from './questions'
import type { RunningState } from './runtime-ipc'
import type { PieceRow, TaskOutcome, TaskState } from './tasks'

/**
 * 🔴 **Who called whom — one conversation's own edges, in ids that name CONVERSATIONS** (543,
 * `540` §7 slice 1).
 *
 * ## ⛔ The fact existed and the projection threw it away
 *
 * Carry conversation ids across the renderer boundary to draw caller relationships and navigate them. `WorkGivenOut`'s identity slug alone cannot identify a recipient because one identity can hold several conversations.
 *
 * ⚑ **And BroBot measured the same hole from inside:** *"Visibility stops one level down. I can see
 * that my grandchild exists, its state, and who spawned it — but not a word it said."*
 *
 * ## 🔴 The property this shape exists to make true
 *
 * > ⚑ **A window can ask, for one conversation: who started it, what it started, and what work
 * > passed between them — in ids that name conversations, not slugs.**
 *
 * ## ⛔ Two kinds of edge, and they are NOT the same edge
 *
 * ⚠️ **A spawn and a handoff are independent**, which `540` §5 measured rather than assumed: a
 * conversation may give work to one it never spawned and may spawn one it never gives work to.
 * ⛔ **So {@link children} and {@link workGivenOut} are two lists and one may never be derived from
 * the other** — v2.8's *other conversations given work* group is a real product case and not
 * authored decoration.
 *
 * 🔴 **553 · this said *work is admitted by `can_message` and not by descent*, and HO-060 §2 made
 * both halves false.** ⛔ Work is admitted by `can_assign_work`, and since D-014 only to a
 * conversation the giver started — since D-016 a give starts it when there is none — so every work
 * edge has a spawn edge under it. ⚠️ **The two lists still cannot be derived from each other**: one
 * spawn edge carries every piece its giver gave that conversation, and a conversation may be
 * started once and given work many times. ⚑ `553` is why the sentence says the property rather than
 * the gate.
 *
 * ## ⚠️ What is NOT here, and where each of those lives
 *
 * ⛔ **No `HereIs` and no gesture.** {@link SpawnEdge.running} is the raw fact and `hereIsOf` is the
 * fold, because the fourth navigation state — `open-in-another-window` — is *running, owned by a
 * surface that is not this one*, and **whether a surface is THIS one is a question the host cannot
 * answer** (`RUNNING_STATES`' own docblock). ⚑ Folding here would collapse the state this read is
 * required to leave reachable (`540` MI-20); the mapping is `540`'s slice 4.
 *
 * ⛔ **No ancestor chain and no recursive traversal.** `540`'s slice 1 is the DIRECT edges, and
 * `SessionStore.ancestorsOf`'s own CTE is bounded at 64 precisely because a hand-edited row can make
 * a cycle — a walk this read performed for a window would be a bound nobody has priced.
 *
 * ⛔ **Nothing a transcript says.** ⚑ **549 · this said the rail was *a product question with the
 * PO*, and HO-057 answered it**: any agent may read what another handed back. ⚠️ **That changes
 * nothing here** — a transcript is not a resource, and this shape still makes the EDGES visible and
 * nothing about the words across them. ⚑ W4.203 · beside the edges, {@link WhoCalledWhom.lastReported}
 * says what each conversation last ran on and how full its context was — facts about it, never its
 * words.
 */
export interface WhoCalledWhom {
  /** The conversation that was asked about — echoed, so a late answer can be matched to its ask. */
  readonly conversation: string
  /**
   * 🔴 **Who started it, or `null` because nobody in this app did.**
   *
   * ⛔ **`null` is `SessionStore.parentOf`'s null**: the conversation's row names no parent — a
   * person started it, or it was swept in from a provider home. ⚠️ It is never *the read did not
   * answer*, which is the renderer's own absence and is a different fact.
   */
  readonly parent: SpawnEdge | null
  /**
   * ⚑ **What it started — the DIRECT children, each with its own completeness.**
   *
   * ⛔ **`rows: []` is never *nothing was spawned* on its own** — see {@link LedgerWalk.walk},
   * whose `no-such-conversation` member is *this app holds no conversation by that id*. `452` §5.1's
   * forbidden sentence, one noun over.
   */
  readonly children: LedgerWalk<SpawnEdge>
  /** ⚑ **The work this conversation handed out** — every row has `from` equal to {@link conversation}. */
  readonly workGivenOut: LedgerWalk<WorkEdge>
  /** ⚑ **The work this conversation was given** — every row has `to` equal to {@link conversation}. */
  readonly workTakenIn: LedgerWalk<WorkEdge>
  /**
   * 🔴 **What each conversation this read names last reported**, keyed by conversation id: this
   * one, its parent, its children, and both ends of every piece of work above — every one this app
   * holds a row for. ⚑ For a conversation that is not running as much as for one that is: an ended
   * or replaced conversation's last model, effort and context reading stay on its own record.
   *
   * ⚠️ **Optional in the type only**, so a window's existing answers stay valid; the host always
   * sends it.
   */
  readonly lastReported?: Readonly<Record<string, LastReported>>
  /**
   * 🔴 **The one moment every list above had been read by** (543, answering `540` MI-19).
   *
   * ## ⛔ Why ONE number is honest here and would not have been before
   *
   * ⚠️ **`540` ruled the condition rather than the answer:** *"One timestamp is honest only if the
   * host performs one atomic/defined aggregate read and records the common completion point."* ⛔
   * Two IPC round trips run on two independent clocks, and a single number over them would be
   * `HO-050` §3's animal — a figure that is not measuring what it claims.
   *
   * ⚑ **This is the aggregate that condition asks for.** `RuntimeHost.whoCalledWhom` is
   * synchronous, like every read on this wire: `better-sqlite3` executes on the calling thread and
   * there is no `await` anywhere between the first statement and this stamp, so nothing can be
   * written between two of these lists and land in one of them. ⛔ **Stamped LAST**, after every
   * walk has returned, so it is a completion point and not a start time.
   *
   * ⚠️ **It is not a claim about how FRESH any of this is.** A surface that draws an age draws it
   * from here; a surface that wants *it went quiet* needs a cadence, and an aggregate read is not
   * one (`534` F4).
   */
  readonly readAt: number
}

/**
 * ⚑ **Where a {@link LastReported} value was read**:
 * - `its-provider` — its provider reported running it (the conversation's `reported_model` /
 *   `reported_effort`, the newest report). ⚑ F099 · for a Claude conversation from before models
 *   were recorded here, the model Claude Code's own transcript names on its newest reply, put on
 *   its record once; ⚑ Claude's effort is the one it states at each turn's end;
 * - `its-setting` — what it was set to run: chosen for it, or carried from its agent's default. For
 *   an effort, what was ASKED for — Claude reports one only once a turn has ended.
 */
export type ReportedFrom = 'its-provider' | 'its-setting'

/**
 * ⚑ **What one conversation last reported** ({@link WhoCalledWhom.lastReported}), read from its own
 * record.
 */
export interface LastReported {
  /**
   * The model its provider last reported running, else the model it was last set to run. `null`
   * when neither is on record: a conversation from before models were recorded here whose
   * provider's own record is gone or names no model, or one brought in from elsewhere.
   */
  readonly model: string | null
  /** Where {@link model} was read; `null` exactly when it is. */
  readonly modelFrom: ReportedFrom | null
  /**
   * The effort its provider last reported, else the effort it was last set to run at; or `null`
   * when neither is on record. ⚠️ Claude's transcripts record no effort, so a Claude conversation
   * that has not ended a turn since efforts were read back has only what was asked for.
   */
  readonly effort: string | null
  /** Where {@link effort} was read; `null` exactly when it is. */
  readonly effortFrom: ReportedFrom | null
  /**
   * How full its context was at its newest reading, and when that reading was recorded (epoch ms);
   * `null` when its ledger holds none — ⚠️ or none in the stretch looked at: its last 2,000 rows the
   * first time, and only the rows written since after that.
   */
  readonly context: { readonly reading: ContextReading; readonly at: number } | null
}

/**
 * ⚑ **One end of a SPAWN edge — the conversation at the other end of it.**
 *
 * ⛔ **The direction is structural and is not a field.** {@link WhoCalledWhom.parent} is the edge
 * INTO this conversation and {@link WhoCalledWhom.children} the edges out of it, so
 * {@link conversation} is always *the other end* and a `from`/`to` pair here would be two spellings
 * of one fact that the shape already decides. ⚠️ {@link WorkEdge} names both ends for the opposite
 * reason, and its docblock says which.
 *
 * ⚑ **D-016 · the parent is the whole of the edge.** `341` recorded a moment and a reason beside it;
 * since a give starts a conversation, the reason is the brief of the piece it was given, and a piece
 * has its own row — so the spawn edge says only who started whom.
 */
export interface SpawnEdge {
  /** The conversation at the other end — never a slug, and never a profile id. */
  readonly conversation: string
  /**
   * 🔴 **The identity it runs as — the IDENTITY's folded slug**, which is what `agentName` joins on.
   *
   * ⛔ **`null` is *this app holds no identity for that conversation*** — one swept in from a
   * person's own provider home, or imported without one. ⚠️ It is NOT *there is no such
   * conversation*: that is
   * {@link provider} being null, and telling the two apart is the whole reason both fields are
   * here rather than one. ⚑ `WorkGivenOut.givenToProfile` folds them together and says so; this
   * shape does not have to, because it reads the row.
   */
  readonly identity: string | null
  /**
   * 🔴 **`null` if and only if this app holds no `provider_session` row for {@link conversation}.**
   *
   * ⛔ **The column is `NOT NULL`**, so a row that exists always answers — which makes this the one
   * field on this shape whose null is about the READ rather than about a placement. ⚠️ Reachable
   * on a parent id only through a database this app did not write (a hand edit, a restored bundle);
   * it is a field rather than a refusal because a breadcrumb that silently vanished would be worse
   * than one that says it cannot name what it points at.
   */
  readonly provider: Provider | null
  /**
   * ⚑ **What this app is doing with it, from the slot map** — `RuntimeHost.runningStateOf`, and
   * for a reason: `status` is a COLUMN that
   * `settleOrphanRuns` settles to `idle`, so a crashed run and a live one say the same word.
   *
   * ⛔ **Left UNFOLDED on purpose.** `hereIsOf(running, held)` needs the window's own `held` to
   * reach `open-in-another-window`, and no host knows which window is asking — see
   * {@link WhoCalledWhom}.
   */
  readonly running: RunningState
}

/**
 * 🔴 **One piece of work that passed between two conversations, named at both ends** (543).
 *
 * ## ⛔ Why both ends, when one of them is always the conversation that was asked about
 *
 * ⚠️ **`540` MI-18 lists *Sender* and *Recipient* as two fields of the record**, and the two lists
 * this row appears in constantly merge: v2.8 draws work beside the child that is doing it and work
 * for conversations that are not children in a group of its own. ⛔ **A row whose direction had to
 * be recovered from which array it came out of would be a fact carried by an enclosing shape** —
 * exactly what `540` §3.1 forbids one level up, *never derive lineage from anything but explicit
 * ids*.
 *
 * ## ⚠️ The status is the PRODUCT's and the fold is the surface's
 *
 * ⛔ **{@link state} is the {@link TaskState} the ledger folded to, COMPOSED** — `waiting`,
 * `working`, `stalled`, `answered`, `withdrawn`, `closed`, and the waits: those the composition
 * writes over an open row, and the one the fold writes on a piece a person gave (D-016 · commit 6)
 * — and v2.8's two-valued `open | answered` is a VIEW of it. 🔴 `540`:
 * *"the status fold is lossy and must not silently be"*, so the lossy half is drawn and never
 * stored. ⚑ `TASK_IS_OPEN` is the table that does the folding, and `stalled` is open in it.
 *
 * ⛔ **And it is never inferred from a CONVERSATION's state.** An owner that stopped with work
 * unfinished leaves that work open; reading *answered* off a stopped conversation would be this app
 * claiming an ending HO-018 §2 explicitly refuses.
 *
 * ## ⚑ What it does not carry, and the rule that decides
 *
 * ⛔ **No stall cause, no asker, no person-flag, no held message and no resources** — `WorkReport`'s
 * rule, which is the rule rather than the precedent: *"a dead field on a DURABLE wire contract is
 * worse than dead code."* ⚠️ Those are the Work tab's fields and `WorkGivenOut` already carries the
 * ones it draws; this shape is about the EDGE.
 */
export interface WorkEdge {
  /** Null is known absence; omitted when the ledger read was incomplete. */
  readonly definitionOfDone?: string | null
  /** The piece, by id — {@link PieceRow.piece}, copied. */
  readonly piece: string
  /** The label a person says out loud — {@link PieceRow.label}. */
  readonly label: string
  /** What the piece is called — {@link PieceRow.title}: the newest title, whoever set it. */
  readonly title: string
  /**
   * 🔴 **The CONVERSATION that gave the work** — {@link PieceRow.giver}, copied — or `null`: a
   * person (work its owner took on for them, D-016 · commit 6).
   */
  readonly from: string | null
  /**
   * ⚑ **The identity behind {@link from}** — the giver's `agent_identity` slug, resolved where the
   * identity lives. ⚠️ `null` is *this app has no identity for that conversation*, the same null
   * `agentName` already folds — and `null` also when a person gave it.
   */
  readonly fromIdentity: string | null
  /**
   * 🔴 **The CONVERSATION the work was given to** — {@link PieceRow.owner}, which is the ledger
   * this row was folded from. ⛔ **This is the field `540` measured as missing**, and the whole
   * reason this shape exists rather than `WorkGivenOut` being widened.
   */
  readonly to: string
  /**
   * ⚑ **The identity behind {@link to}, resolved where the identity lives** — `WorkGivenOut.givenToProfile`'s
   * rule and its reason: `agentIdentities()` is re-read *"at mount and after a successful launch,
   * and at no other time"*, so a conversation created since this window mounted is in no roster the
   * renderer holds and could not be named at all if main did not join. ⚠️ `null` is *this app has
   * no identity for that conversation*, the same null `agentName` already folds.
   */
  readonly toIdentity: string | null
  /**
   * Where the fold left it, composed. See this interface's own note on why it is not folded
   * further.
   *
   * ⚑ **603 · COMPOSED before it reaches here, by EVERY producer** (`664`) — an edge about work
   * whose question nobody has answered reads `waiting-on-an-answer` and not `stalled`, and `609`
   * added its two neighbours. ⛔ Nothing is folded FURTHER here; the composition is above the fold
   * and this row carries its answer across.
   *
   * 🔴 **The producers are `SessionStore`'s three, and all three compose**: `workThisOneGaveOut`
   * (through `walkWorkGivenBy`, shared with the Work tab), `workThisOneWasGiven`, and
   * `everyPlacedConversation`'s piece nodes. ⚠️ {@link workEdge} copies whatever state it is handed,
   * so the composition is the CALLER's.
   */
  readonly state: TaskState
  /** How the owner said it went. ⛔ **Absent, never null** — `WorkReport.outcome`'s rule. */
  readonly outcome?: TaskOutcome
  /** Epoch ms the piece was given — {@link PieceRow.givenAt}. */
  readonly givenAt: number
  /**
   * Epoch ms of the event that CLOSED it, or `null` while it is open.
   *
   * ⚠️ **Null for `stalled`**, because `stalled` is open: a turn ending, a Stop and a restart are
   * none of them the work ending. See {@link PieceRow.endedAt}, whose rule this copies rather than
   * restates.
   */
  readonly endedAt: number | null
  /**
   * Present only while a person may take this piece back: services run, its owner is a service,
   * and this is the piece that service is on.
   */
  readonly aPersonMayTakeItBack?: true
}

/**
 * ⛔ **{@link WorkEdge} from the row it is derived from, in ONE place** — `workGivenOut`'s rule,
 * one shape over.
 *
 * ⚠️ **Here rather than in the store, because it is a fact about the two SHAPES** and neither of
 * them can reach a database. ⛔ The absence is built the way the wire spells it —
 * `...(x === null ? {} : { x })` — so a row this app wrote and a row read back out of a `.brobot`
 * bundle are the same value.
 *
 * ⚑ **Both identities are arguments** (D-016): the row names two conversations and no identity, so
 * the store resolves each where the identity lives and hands them in.
 */
export function workEdge(
  /**
   * ⛔ **A COMPOSED row** — see {@link WorkEdge.state}. This function copies the state it is handed
   * and cannot tell a composed row from a raw one, which is why every producer composes first.
   */
  row: PieceRow,
  toIdentity: string | null,
  fromIdentity: string | null,
): WorkEdge {
  return {
    piece: row.piece,
    label: row.label,
    title: row.title,
    ...(row.definitionOfDone === undefined ? {} : { definitionOfDone: row.definitionOfDone }),
    from: row.giver,
    fromIdentity,
    to: row.owner,
    toIdentity,
    state: row.state,
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    givenAt: row.givenAt,
    endedAt: row.endedAt,
  }
}
