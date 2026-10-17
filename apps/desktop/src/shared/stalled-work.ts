import type { WhoStoppedIt } from './how-work-stopped'
import type { TaskStallCause } from './tasks'
import { undrivenSentence } from './tasks'

/**
 * 🔴 **Work that has stopped with nobody left to tell** (557, HO-018 §2.1 · criterion 4).
 *
 * ## ⛔ The half of criterion 4's amendment that had no mechanism
 *
 * ⚠️ **HO-018 §2.1 amended criterion 4 to a PROPERTY: *nobody waits forever in silence*** — *"mark
 * it `stalled` immediately, no timer, and push it to the parent."* ⛔ `400` and `404` built the
 * push, and `555` §3.1 measured what it cannot reach: `RuntimeHost.tellIfNobodyHasYet` returns
 * unless the conversation that gave the work is LIVE in this host at that moment, **and HO-018
 * §2.2 removed the timeout, so there is no sweep and no deadline**. ⚑ A parent that is never
 * relaunched is never told by anything, and no person is ever told at all.
 *
 * 🔴 **So the property loses its subject.** *Nobody waits forever in silence* is a claim about
 * somebody being told, and when the only recipient the mechanism knows about was never reached the
 * sentence is false with nothing red. ⛔ **The repair is not a second detector**: the stall is
 * already a fact on the row, permanent, named and derived from the ledger. ⚑ **It is a second
 * RECIPIENT** — the person — admitted exactly where the first one holds no receipt, which is the
 * one durable fact that says an agent was successfully told.
 *
 * ## ⚠️ What a row of this is, and what it is not
 *
 * ⛔ **It is not a request, it has no card and nobody is blocked on an answer to it.** The
 * conversation holding the work is idle; the work is simply not being driven and the conversation
 * that gave it out has not been told. ⚑ That is why this is carried BESIDE a person's queue rather
 * than as a row in it — see `persons-queue.ts`' `stalledWorkView` for the table that decides it.
 *
 * ⚠️ **Every field is copied off a `PieceRow` the fold already derived**, except the names — the
 * owner's, the giver's and, since `729`, an agent asker's ({@link StalledWork.askedToStop}) —
 * which are composed main-side for `PersonsQuestion`'s reason: a renderer cannot turn a
 * `sess_<uuid>` into a word, and `agentIdentities()` is re-read at mount and after a launch only.
 * ⚑ **All three are identity names since `732`** (R41) — the owner and the giver were folders — and
 * since D-016 · commit 7 the asker's name also says the piece it owns (R3).
 *
 * ⛔ **Never a root** (D-016 · R1): a root's state is its conversation's, and no giver waits on it.
 * ⛔ **And never a piece a person gave** (D-016 · commit 6): nobody could be told, and the person
 * who asked reads its row (`aStallItsGiverCanBeToldOf` in `tasks.ts`).
 */
export interface StalledWork {
  /** The piece, by id — `PieceRow.piece`, copied. */
  readonly piece: string
  /** The label a person says out loud — `PieceRow.label`. */
  readonly label: string
  /** What the piece is called — `PieceRow.title`, the newest title. */
  readonly title: string
  /** ⛔ **The conversation HOLDING the work** — `PieceRow.owner`. This is where a person goes. */
  readonly owner: string
  /**
   * What the AGENT holding it is called, in a sentence a person reads —
   * `RuntimeHost.whatToCallTheConversation`, the identity's name (PM ruling R41).
   *
   * 🔴 **732 · `729` F-1 — its folder until now** (`nameForAPerson`, `398`): in the default folder
   * the band read *"…with brobot-workspace is not being worked on, and brobot-workspace — which gave
   * it out — …"*. ⚑ Read per look, so a rename is the next look's word.
   */
  readonly ownerName: string
  /**
   * 🔴 **The conversation that GAVE the work out — the one nobody could tell** — `PieceRow.giver`.
   *
   * ⛔ **Read off the row and never looked up**, which is `tellIfNobodyHasYet`'s own rule: a giver
   * that has since been replaced or stopped is still the conversation that gave it out.
   */
  readonly giver: string
  /** What the giver is called in a sentence a person reads — {@link ownerName}'s naming (`732`). */
  readonly giverName: string
  /**
   * ⛔ **What the engine OBSERVED stopped it** — `PieceRow.stalledBecause`, which is non-null if and
   * only if the state is `stalled` and is therefore never optional here.
   */
  readonly because: TaskStallCause
  /**
   * 🔴 **729 · `725` draw 9 (GAP-M3) — who ASKED the turn to stop, when anybody did** —
   * `PieceRow.stalledBy`, with the asker NAMED for a person; `null` when nobody asked — ⚠️ and `null`
   * when the row's cause is one an ask does not ride on (`AN_ASK_RIDES_ON`).
   *
   * ⛔ **Until `729` the band could not say it**: `stalledWorkForAPerson` copied ten fields off a row
   * that carried the ask and dropped that one (`725` §1.9) — while the notice pushed to the giver and
   * `list_tasks`' line both said it (`720`, R72).
   *
   * ⚑ **An ASK, never an ending** (`720` F-D, R82's reading): the provider may have finished the turn
   * anyway ({@link because} `turn_ended`) — the same two facts `theStallAndItsAsk` says to a model.
   * ⚠️ The words are the renderer's; `stoppedBy(by, askerName)` is the phrasing every surface shares.
   */
  readonly askedToStop: StalledWorkAsk | null
  /**
   * 🔴 **When that observation was made, epoch ms, or null because the row predates the stamp**
   * (484 added `stalledAt`).
   *
   * ⛔ **Null is ordered explicitly and never by a `?? 0`** — `byBlockedSince`'s ruling, which this
   * band's own order carries rather than re-decides: an unknown age is not an old age.
   */
  readonly stalledAt: number | null
}

/**
 * 🔴 **729 · who asked a stalled piece of work's turn to stop** — {@link StalledWork.askedToStop}.
 *
 * ⚑ **The row's two facts, and the name main can make of the second** — the band's own reason for
 * naming main-side: a renderer cannot turn a `sess_<uuid>` into a word.
 */
export interface StalledWorkAsk {
  /** ⛔ Off the row's own actor (`AskToStop.by`) — a person, an agent, or a caller this app cannot name. */
  readonly by: WhoStoppedIt
  /** ⚑ The asking conversation — present only when {@link by} is `an-agent`, else `null`. */
  readonly asker: string | null
  /**
   * 🔴 **The asking conversation, named by its agent and the piece it owns** (D-016 · commit 7 · R3)
   * — `RuntimeHost.nameByItsWork`: `Ada (the owner of W1.2 · Build the pages)`, or the agent's name
   * alone when it holds no piece. The agent's name is the identity's (PM ruling R41: *"every
   * identity a person reads is NAMED, never by slug"*): its name, or its folded slug when nobody has
   * named it, or `an agent this app cannot name`. `null` when {@link asker} is. ⛔ Never the id
   * (`HO-095` §5.3).
   *
   * ⚑ **The piece is what {@link StalledWork.ownerName}'s naming leaves out**: the owner and the
   * giver are named beside the piece this row is about, which has one of each, while the asker can
   * be any of one agent's conversations. ⚠️ Until `732` (`729` F-1) all three read the
   * conversation's FOLDER (`nameForAPerson`, `398`), which every agent working in one folder shares.
   */
  readonly askerName: string | null
}

/**
 * ⛔ **One piece of work, as the band renders on** — the piece id and nothing else.
 *
 * ⚠️ **Unlike a person's queue row, which is `sessionId:requestId`**, a piece id is minted by this
 * app and is unique across every conversation, so a second component would be a second spelling of
 * one fact. ⚑ It is a function rather than the bare field for `providerLimitKey`'s reason: what
 * *one row* means is a decision, and a decision has a place.
 */
export const stalledWorkKey = (work: StalledWork): string => work.piece

/*
 * ⛔ **697 · `672` H2 — `stalledWorkSays` is gone.** The consequence line moved to the renderer as
 * `persons-queue.ts`' `stalledWorkLead` in `672`, where it can name the piece the card's way; this
 * copy kept a third name for one piece and had no product caller left. ⚑ The OBSERVATION stays here:
 * {@link stalledWorkSaid}.
 */

/**
 * ⛔ **What the engine observed, in the app's ONE set of words for it** — `UNDRIVEN_SENTENCES`
 * through `undrivenSentence`, capitalised for a line of its own.
 *
 * ⚑ **A fourth caller of that table and not a fourth table** (400's rule, carried): `list_tasks`
 * renders the cause beside the state, `undrivenWorkText` renders it in the message a parent is
 * pushed, `406`'s work row renders it under the state word — and a person reading this band and a
 * parent reading its notice must not be given two accounts of one event.
 */
export function stalledWorkSaid(work: StalledWork): string {
  const said = undrivenSentence(work.because)
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
}
