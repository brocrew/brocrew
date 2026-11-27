import type {
  AskHandoffAttempted,
  AskHandoffNotAccepted,
  AskProvenanceUnresolved,
} from './ask-delivery-contracts'
import type { AgentRulesReceipt } from './agent-rules'
import type { ConversationOwnRow } from './conversation-title'
import type { KeptPromptStart } from './instruction-contracts'
import type { UserTurnEvent } from './human-answer-contracts'
import type {
  McpServerRequestedEvent,
  McpServerRequestSettledEvent,
  McpServerRequestWaiting,
} from './mcp-server-requests'
import type { MoveReceipt } from './move-contracts'
import type { InstructionProposedEvent, InstructionSettledEvent } from './own-instructions'
import type {
  QuestionAskedEvent,
  QuestionEndedWithItsPieceEvent,
  QuestionRecipientEndedEvent,
  QuestionWithdrawnEvent,
  RequestEscalatedEvent,
  RequestInterruptedEvent,
  RequestRoutedEvent,
  RequestStrandedEvent,
} from './question-contracts'
import type {
  ProviderFailureReconciliationEvent,
  WorkReconciliationEvent,
  WorkRecoveryEvent,
} from './reconciliation-contracts'
import type { RailPermanence, RefusalRemedy, RefusalTold } from './refusals'
import type {
  WorkClosedEvent,
  WorkGivenEvent,
  WorkInterruptedEvent,
  WorkRebriefedEvent,
  WorkRepliedEvent,
  WorkRestartedEvent,
  WorkRetitledEvent,
  WorkSentEvent,
  WorkStallSetRightEvent,
  WorkStallToldEvent,
  WorkStatusSetEvent,
  WorkTakenBackEvent,
} from './task-contracts'
import type { WhatALaunchGave } from './what-this-agent-was-given'
import type { ActedBy, WhoStoppedIt } from './who-did-it'
import type { PermissionDecision, RuntimeEvent } from '@brobot2/runtime'

export type { InstructionProposedEvent, InstructionSettledEvent } from './own-instructions'
export type { McpServerRequestedEvent, McpServerRequestSettledEvent } from './mcp-server-requests'
export type { TheQuestionItAsks } from './ask-delivery-contracts'
import {
  type MessageSentEvent,
  type QueuedMessageEvent,
  type ReplyUndeliveredEvent,
  type UnqueuedMessageEvent,
} from './message-events'
export {
  MAILBOX_KINDS,
  type MailboxKind,
  type MessageSentEvent,
  type QueuedMessageEvent,
  type ReplyUndeliveredEvent,
  type UnqueuedMessageEvent,
} from './message-events'

/**
 * A decision this app sent for a request card — which button was pressed. Ours for the same
 * reason as {@link UserTurnEvent}: the provider is told the answer, it never reports it back.
 * Without it a reopened session shows every card you allowed as if nobody had ever answered.
 *
 * ## 🔴 Five writers, two kinds of actor — and until `477` one row for both (HO-029 §2.1)
 *
 * ⛔ **`463` drove the production answer door with a parent AGENT's caller, for a spawned worker's
 * question, and the digest drew *"1 request was answered by a person"*.** ⚑ `465` narrowed the
 * sentence, because the row genuinely did not know; {@link by} is what makes the row know.
 *
 * ⚠️ **The two doors are `RuntimeHost.answerQuestion` — an agent, which `sessionSpeakingAs`
 * already names — and the three behind `RuntimeHost.requireToAnswer`, which have already proved a
 * person.** ⛔ Both computed the actor to decide whether to refuse, and both threw it away.
 */
export interface UserDecisionEvent {
  movedTo?: MoveReceipt
  type: 'user_decision'
  requestId: string
  /** A permission outcome, or how a user-input card was settled. */
  outcome: PermissionDecision['outcome'] | 'answered' | 'rejected'
  /**
   * 🔴 **Who answered it** (477) — {@link RuntimeHost.whoDidIt}, read off the caller at the moment
   * the answer was taken.
   *
   * ⛔ **DERIVED and never claimed**, to {@link MessageSentEvent.onBehalfOfAPerson}'s standard:
   * there is no argument on any tool, and no field on any IPC payload, by which a caller can say
   * who answered. ⚠️ `'a-person'` means *the window this card was shown on asked* — at all three
   * person doors `mayAnswerAsAHuman` had already held, so that surface had also declared a person
   * behind it — and never *a named human*, which this app has no way to know.
   *
   * ⛔ **OPTIONAL, and absence means one specific thing: written before this app recorded who**
   * (HO-029 §2.2). ⚑ It is NOT *"an actor we failed to write"* — every writer writes it
   * unconditionally — and nothing backfills, so the digest's sentence for the old population stays
   * right for that population for ever. The precedent is {@link QueuedMessageEvent.messageId},
   * twice over.
   *
   * ## 🔴 494 · this row is the SECOND producer of *who asked the work to stop*
   *
   * ⛔ **`492` measured `stalled_by: null` (the key `list_tasks` spells `asked_to_stop_by` since
   * `724`, R82) for a turn a person had genuinely cancelled and priced a new event for it.** ⚑ This field was already the answer: `outcome: 'cancel'` is the one
   * decision that ASKS a turn to stop (720, R72: the provider may finish it anyway),
   * {@link RuntimeHost.respondPermission} is its only writer, and
   * `whoCancelledIt` is the derivation the three readers of it share.
   *
   * ⚠️ **What a READING may name is {@link WhoStoppedIt} and not this type's four words.**
   * `mayAnswerAsAHuman` refuses {@link THE_APP_ITSELF}, so the app cannot answer a card and never
   * appears here; the other three do.
   *
   * ⚑ **723 · R81 — except a `cancel` that carries {@link stopsNothing}**, which asked no turn.
   */
  by?: ActedBy
  /**
   * 🔴 **723 · R81 — this `cancel` asked no turn to stop.** Present only as `true`, only beside
   * `outcome: 'cancel'`, and only for a card raised with `cancelStopsNothing`: every MCP elicitation
   * card since `736` (R97) — Codex's, whether or not its frame named a turn, and Claude's server form
   * since `728` — or, from `723` until `736`, a Codex elicitation whose frame named no turn. Its
   * Cancel sends the provider no `turn/interrupt` and latches nothing.
   *
   * ⚑ The ruling (`720` F-B): *"When the frame names no turn, its line says only what the press does
   * (the request is cancelled; the turn is not asked to stop), and the host records no ask."* ⛔ So
   * the row is still written — the request WAS cancelled, and the readers that settle a card read
   * it — and every reader of an ask passes it over: `howWorkStopped`, `derivePieces` and the store's
   * `selectLastAskToStop`. ⚠️ Absent on every row written before 723, which asked (`720`, R74) or
   * said it did.
   */
  stopsNothing?: true
}

/**
 * **Which control the user pressed** (097, from 085's *"the thing that would have saved me an hour"*).
 *
 * 085 could prove from the ledger that a conversation had closed, and could not prove *what closed
 * it* — the Close button, the window going away, or the app quitting all produce the same
 * `session:'ended'`. The same blindness covers every other control: `turn:'interrupted'` does not
 * say whether Stop was pressed or a replacement message was sent through it, and a model change
 * leaves a settings row with no moment attached to it at all.
 *
 * ## The gesture, never the message
 *
 * ⚠️ **This carries a verb and at most a short object, and never any text the user wrote.** The
 * transcript already holds every message; copying prose into a second place would be a privacy and
 * a size decision nobody made, and a breadcrumb that quotes you is not a breadcrumb. `target` is
 * only ever a setting's new VALUE — a model name, an effort level, `ask`/`auto` — each already
 * bounded by the command schema that admitted it (120, 60 and an enum respectively).
 *
 * ## The line this union draws, so there is no third way to say "the app did something"
 *
 * ⚠️ **A gesture that already has a durable event of its own does not get a second one.** Queueing
 * a message is {@link QueuedMessageEvent}; answering a card is {@link UserDecisionEvent}; sending
 * is {@link UserTurnEvent}. Those are not breadcrumbs of a control, they are the thing itself, and
 * recording them twice would be the duplicate mechanism this event exists to avoid. What is left is
 * exactly the set of controls that changed the conversation and left nothing behind saying so.
 *
 * ## Where it is written, and what that excludes
 *
 * ⚠️ **At the IPC boundary, because that boundary IS "a person pressed something."** Every gesture
 * the renderer can make arrives through `executeRuntimeCommand` and nothing else does — so the
 * window closing underneath a session and the app quitting call the very same `host.close()` and
 * correctly leave no breadcrumb, without anyone having to remember to suppress one.
 *
 * ⚠️ **It opens no turn**, like {@link QueuedMessageEvent} before it: 045 opens a turn row from
 * `user_turn` and from nothing else, and a gesture is not a prompt. It is not a content event
 * either, so between turns it is attributed to none — while a Stop pressed DURING a turn lands on
 * that turn, which is exactly where the question "why did this end?" is asked from.
 *
 * ## It does not render in the conversation
 *
 * ⚠️ **Ledger-only, deliberately.** 085's motivation was debugging, and the conversation already
 * shows every consequence: the interrupted turn, the plan bar disappearing, the model in the
 * header. Drawing the gesture beside its own effect would say the same thing twice in the one
 * surface that is meant to read like a conversation. It is visible where a debugger looks — the
 * Events tab, which filters nothing — and `applyEvent` states this rather than falling through.
 */
export interface UserCommandEvent {
  type: 'user_command'
  /**
   * The verb. A closed set, because the value of this event is that it can be COUNTED and grouped
   * in a query — `SELECT json_extract(payload,'$.command'), count(*)` is the one-liner 085 wanted,
   * and free text would have made it a grep.
   */
  command:
    | 'closed'
    | 'interrupted'
    | 'interrupted_to_send'
    | 'entered_plan_mode'
    | 'left_plan_mode'
    | 'started_the_plan'
    | 'changed_model'
    | 'changed_effort'
    | 'changed_approval_mode'
  /**
   * What it was changed TO, for the verbs that have an object.
   *
   * Absent means the user cleared the setting back to the provider's own default — the same
   * absent-is-a-fact convention the rest of this file uses, rather than a `'default'` string that
   * would be indistinguishable from a provider that really is called that.
   */
  target?: string
}

/**
 * One file **BroBot found in the memory store that was not there when this turn began** (318 §2.1).
 *
 * ⛔ **Not "the agent called a tool".** Nothing on any wire said so — 316 measured fifteen config
 * arms and found no provider event for a memory write, in any of them. What this app can observe is
 * a directory, so what this record claims is a directory: a name that is there now and was not
 * before. The wording on screen has to survive that distinction, and {@link MemoryNoteEvent} says
 * why it is worth saying anyway.
 */
export interface MemoryNoteSeen {
  /** The file, absolute — where it is, so the claim is checkable and the path is pasteable. */
  path: string
  /**
   * Its size — the size of the file it IS, a link followed (`733`, as its text is).
   *
   * ⛔ **Optional, because a size we did not measure must not be printed as one** (074). A note
   * that is not a regular file, or a link to nothing, has no size to give, and a `0` would be a
   * measurement nobody made. Absent, the row prints no size at all. (Until `733` this was an
   * `lstat` on the entry, because the row refused to follow a link.)
   */
  bytes?: number
  /**
   * Its text, verbatim, up to {@link MEMORY_NOTE_TEXT_CAP}.
   *
   * ⚠️ **Absent means we did not read it, not that it was empty**, and {@link unread} says which of
   * the several reasons applied. The file appeared either way, and that is the observation.
   */
  text?: string
  /** True when {@link text} is the head of the file and not the whole of it. */
  truncated?: boolean
  /**
   * 🔴 **Why {@link text} is absent** — the reader's own reason, carried rather than guessed.
   *
   * ⛔ **A row that named ONE cause for five was the defect this field exists to stop.** The reader
   * declines a note for `symlink`, `not-a-regular-file`, `too-large`, `not-utf8`, `unreadable` and
   * `absent` — a note that vanished between the listing and the read — and a sentence that blamed a
   * link for all of them would be false four times out of five and would send a person looking for a
   * link that is not there (086, and 314 §3's ruling one field over).
   *
   * 🔴 **`733` · the row follows links now**, so `symlink` is a loop of links (or a row written
   * before `733`, when every link was refused), and a link to nothing is `dangling-link`.
   *
   * ⚠️ Present only when {@link text} is absent; undefined is the ordinary case.
   */
  unread?: string
}

/**
 * 🔴 **A memory the agent was asked to keep, said in the conversation where it happened** (318 §2.1,
 * from friction log F4/F5).
 *
 * Saved notes exist on disk even though the pinned app-server emits no `item/*` for memory calls nested inside code-mode `exec`. Report the observed note files rather than inventing a tool-call event.
 *
 * ⚑ **What there IS, is a file.** The store is a directory this app already reads for the
 * instructions panel, and a turn is already delimited in the ledger — so *"this name is in the store
 * now and was not when the turn began"* is an observation BroBot can make honestly, at a cost of one
 * `readdir` at each end of a turn. That is the whole of this event.
 *
 * ## ⛔ The three things it deliberately does not claim
 *
 *  - **Not a tool call.** See {@link MemoryNoteSeen}. The renderer says *seen on disk*, and 009's
 *    rule is why: a row that read as a reported call would be inventing a wire fact.
 *  - **Not "the agent on screen wrote it".** A profile IS the shared-memory boundary (085), so any
 *    session in this profile can write this directory. The row says *this profile's store*, which is
 *    what was measured, rather than attributing it to the conversation it appears in.
 *  - **Not the background pipeline.** `MEMORY.md`, `memory_summary.md`, `raw_memories.md` and
 *    `rollout_summaries/` are rewritten asynchronously and, 312 measured, **after a LATER session's
 *    turn** (14 s and 51 s). A change to those is not this turn remembering something, and treating
 *    it as one would be a fabricated causal link. Only the ad-hoc notes directory is watched.
 *
 * ## ⚠️ Provider-shaped, and that is a ruling rather than an omission
 *
 * ⛔ **This is only ever published for a provider whose memory writes produce no tool call.** The
 * other one writes its memory with ordinary file tools, which already produce a `tool_call` naming
 * the full path and a `file_change` row beside it — measured in `normalize.ts`. A disk observation
 * published next to a real reported call would be a second, weaker claim about one act, which is the
 * duplicate 035 rules out and the misattribution this event is built to avoid, arriving from the
 * other side. See `memory-notes.ts` for where that gate is.
 */
export interface MemoryNoteEvent {
  type: 'memory_note'
  /** The notes that appeared, newest name first. Never empty — no event is published for none. */
  notes: MemoryNoteSeen[]
  /**
   * Notes past the listing cap. Absent or 0 normally.
   *
   * ⚠️ **A cap that can never be silent** (092 §4's rule, `provider_commands` and `file_change`'s
   * precedent). A turn that wrote thirty notes must not show twenty and read as complete.
   */
  dropped?: number
}

/**
 * 🔴 **This conversation opened with the profile's memory index already in the prompt** (332,
 * friction F15).
 *
 * Report memory loaded at launch, independently of recall. The provider can inject `MEMORY.md` before the first token, letting an answer use it without a lookup or tool call; disclose that source in the conversation.
 *
 * ## ⛔ The three things it does not claim
 *
 *  - **Not a recall.** 319 §3 forbids inventing one on this provider and that ruling is untouched:
 *    the CLI publishes no citation, {@link SessionInstructions.recallsReported} is `false` as a
 *    measurement, and nothing here says the agent looked anything up. {@link beside} is a count of
 *    files ON DISK, and the renderer's sentence says the agent reads one *only if it chooses to* —
 *    322's own wording on the panel rows, kept identical on purpose.
 *  - **Not a tool call, and not the provider's voice.** {@link MemoryNoteEvent} is the precedent:
 *    this app looked at a directory and says so. ⚠️ **What is BroBot's here is the reading**; that
 *    the index reaches the prompt is 312's measurement of a real child, carried today by
 *    `InjectedInstruction.reach` and stated on the panel in those words. One fact, one derivation —
 *    this row does not re-decide it.
 *  - **Not a per-answer event.** Published exactly once, at session creation, before the pump — so
 *    it is the first row of the conversation and cannot be read as something that happened for an
 *    answer. ⛔ A resume publishes nothing: the ledger already holds this row from the life that
 *    opened the conversation, and a second one would turn a launch into a recurrence.
 *
 * ## ⚠️ Why it is not keyed on the wire fact 330 measured, which is what the dispatch expected
 *
 * 330 put `system/init.memory_paths.auto` on the record — the CLI's own resolver naming the store.
 * ⛔ **It cannot key this row, because it does not exist yet.** Claude's `system/init` arrives on
 * the MESSAGE stream, on the first turn (`claude-runtime.ts`: *"Claude's ref only arrives on the
 * message stream"*), and a launch row keyed on it would appear under the user's first message
 * instead of above it. ⚑ So this event rests on the launch-time disk read the panel already rests
 * on, and §3's *"a build that stops sending `memory_paths` must leave the row absent"* does not
 * reach it — nothing here reads that field.
 */
export interface MemoryLoadedEvent {
  type: 'memory_loaded'
  /**
   * The index file that is in the prompt, absolute.
   *
   * ⚠️ **The path is the disclosure**, as it is on every other memory row: it names WHICH store,
   * which is the claim {@link MemoryLoadedEvent} is allowed to make, and it is pasteable.
   */
  index: string
  /**
   * How many memory files sit beside it in that store.
   *
   * ⛔ **The count ON DISK, not the count the panel lists** (092 §4). The drawer's list is capped at
   * `AGENT_MEMORY_NOTES_SHOWN` and trimmed again by a byte budget, and a row that reported that
   * number would silently understate a store of forty as twenty — a cap going quiet in the one row
   * whose whole job is to say memory is in play.
   *
   * ⚠️ **`0` is a measured answer and draws no clause**, rather than being absent: the store had an
   * index and nothing beside it. 317's empty-state rule is about a row that says *"0 memories"*, and
   * the renderer's `v-if` is where that is enforced — not by dropping a number we took.
   *
   * ⚑ **And since 604 it is a count with a MOMENT attached** — see {@link lookedAt}. *"3 memories
   * sat beside it when this app looked"* is only a checkable claim once the row can say when that
   * was; `601` put the sentence in the past tense and left the number to this field.
   */
  beside: number
  /**
   * 🔴 **When THIS APP looked at the store this row names** (604, from `601` §1.3) — epoch
   * milliseconds, this machine's wall clock.
   *
   * ## ⛔ Whose act it times, which is the whole of the name
   *
   * ⚠️ **Three acts sit behind this row and only one of them is ours to date** (`601` §1.1):
   *
   * | the act | whose | dated here? |
   * |---|---|---|
   * | loading {@link index} into the model's system prompt | ⛔ **the provider's** | 🔴 **never** — unobservable to this app at any time, by design (170 §2) |
   * | looking at the store: listing it, and reading the same file so this row can name it | ⚑ **ours** | ⚑ **this number** |
   * | appending this row to the ledger | ours | `TranscriptItem.at` — a different number, see below |
   *
   * ⛔ **So it is not `readAt`, and the easy reason for that is the wrong one.** `601` measured
   * that this app does genuinely open the index — `readMemoryStore` puts it through the same guarded
   * reader as everything else — so *"we never read it"* would be false. ⚑ **`readAt` is wrong
   * because of what it would be a time OF:** `599` gave that word to ONE FILE's bytes, on a row that
   * carries those bytes, and this number's principal consumer is {@link beside} — a count that came
   * from a DIRECTORY LISTING and from no file at all. ⚠️ **`lookedAt` covers both halves of the
   * one act**, the listing and the read, and it is the verb the row already uses on screen (`601`:
   * *"sat beside it in this store when this app looked"*).
   *
   * ## ⚑ ONE number over a walk that reads several things, and which END it is taken at
   *
   * ⛔ **Stamped on the ASK** — the first line of `readClaudeAgentMemory`, above every syscall in
   * it (`stamp-a-measurement-when-you-ask-not-when-it-answers`, and {@link InjectedInstruction.readAt}
   * one layer over). ⚠️ **That is what makes a single number honest here**, because that walk does
   * real I/O between its parts and a stamp taken at the END would date the listing with the moment
   * the last file finished — *"we saw 3 beside it at 14:02"* about a directory listed at 14:01, which
   * is the confident-wrong direction. ⚑ **Taken at the ask, every fact on this row is from
   * at-or-after it**, and the only mistake it can make is telling a person their 14:02 edit missed a
   * look that might just have caught it — the answer that sends somebody to relaunch.
   *
   * ⚠️ **Per ROW rather than per file, and that is not `599`'s case narrowed.** That field sits on
   * a list whose members are separate files with separate bytes; this row carries one path and one
   * count, taken by one call, so there is one look to date.
   *
   * ## 🔴 It is NOT {@link TranscriptItem.at}, and the gap is measured rather than remembered
   *
   * ⛔ **The look happens at `readInstructions`; the row is appended after `awaitLaunch`, a provider
   * spawn bounded by `DEFAULT_LAUNCH_TIMEOUT_MS`.** ⚠️ **So the ledger's own stamp can be fifteen
   * seconds later** (`601` §1.2) — and the row renders `HH:MM`, so that gap prints a different minute
   * often enough to matter. ⚑ `memory-loaded-host.test.ts` §4 holds the two apart over a real host
   * with a fixed clock, so pointing this field at the publish stamp goes red rather than unnoticed;
   * `when-we-looked-is-not-when-it-was-loaded.test.ts` is the reader's own half.
   *
   * ## ⚠️ It is the LAUNCH's look, and a resume does not refresh it — which is the opposite of 599
   *
   * ⛔ **This row is published once, at creation, and a resume publishes none** (332). ⚑ So the
   * number a person reads a week later is the moment the conversation OPENED, not the moment the
   * app last looked — and that is right for a row whose sentence is *how this conversation opened*.
   * ⚠️ **{@link InjectedInstruction.readAt} behaves the other way** and must: its reader runs again
   * on every resume (158 §2), so the drawer shows a fresh read while this row keeps the original.
   * 🔴 **Two surfaces, two moments, both correct** — and saying so here is the point, because a
   * sentence about WHEN a fact is read is itself a fact about the system (`HO-070` §3).
   *
   * ## ⚠️ A look is not a verification
   *
   * ⛔ **It says when this app looked at a directory. It says nothing about what the provider put
   * in the prompt, and nothing in this app can** (604 §3, 170 §2). ⚑ A number is the easiest thing
   * on a row to mistake for evidence, so the type says it: this is evidence of OUR look and of
   * nothing else.
   *
   * ## ⛔ Optional, because the ledger already holds rows without it
   *
   * ⚠️ **Every `memory_loaded` row appended before 604 has no `lookedAt` and a replay must render
   * those unchanged** — the standing {@link MemoryNoteEvent.dropped} has, for its own reason. 🔴 **And
   * nothing downstream may fill one in**: `publishOurs` takes this event as the reader built it, and
   * the clock it does reach for is the ledger's `at`, which is the number this field exists to not
   * be.
   */
  lookedAt?: number
}

/**
 * 🔴 **723 · R83 — an ask to stop that the provider has not answered** (`720` F-F).
 *
 * ⚑ The ruling: *"When Codex does not acknowledge a Stop within the bound, the conversation says so
 * in words (Codex has not answered the stop), and a second press does not queue a second ask behind
 * the first."* ⚑ **This row is the FACT; the words are the surface's** — the row carries the word,
 * the surface carries the sentence.
 *
 * ⚑ **Written by the host, once per ask** — a person's Stop, interrupt-and-send or `interrupt_agent`
 * — when {@link waitedMs} has passed with the ask unanswered and its turn still running. It names
 * the ask it is about by its asker ({@link by}, {@link agent}), never by its position: another
 * door's ask can land between the two rows. ⛔ **Never when the turn ended first** — a provider
 * that ended the turn has stopped it, whether or not it answered the request — **and not on
 * Claude**, whose own stop bounds its ack at the same two seconds and forces the ending itself, so
 * the ask is settled before this bound passes (pinned beside the R83 tests).
 *
 * ⚠️ **It is a statement about THEN.** Codex may still answer, or end the turn in its own word, after
 * this row (R43), and no row says the late answer: the fact stands until Codex answers or the next
 * `turn` row. ⚑ Until then a person's second Stop asks nothing new (`RuntimeHost.interrupt`); after a
 * late answer it asks again, because Codex heard the first.
 */
export interface StopUnansweredEvent {
  type: 'stop_unanswered'
  /** How long this app waited for the provider's answer before saying so — the ask's own bound. */
  waitedMs: number
  /** ⚑ Who asked — {@link WorkInterruptedEvent.by}'s word, for the ask this row is about. */
  by: WhoStoppedIt
  /** The asking conversation — present if and only if {@link by} is `an-agent`, as on the ask. */
  agent?: string
  /**
   * 🔴 **734 · `732` F-5 — WHO the asking agent is: its identity, as the folded slug** — the ask's
   * own {@link WorkInterruptedEvent.agentProfile}, from the same builder, so the two rows about one
   * ask cannot name two identities.
   *
   * ⛔ **Until `734` this row carried the conversation alone**, and a surface could only say
   * *"asked by sess_…"* or the category. ⚑ **For a reader to name** with `agentName(agentProfile,
   * identities)` (R41) — ⚑ since `737` the notice and the Stop control do (`stop-unanswered.ts`). Every
   * rule of `WorkInterruptedEvent.agentProfile` holds here word for word: never a display name;
   * absent on rows before `734`, for a person's ask, and for a conversation this app holds no
   * identity for — a reader then says the category, never the handle; a reader with no roster says
   * the category; bounded on replay (`boundRelayedIdentity`) on the PERSISTED copy only.
   */
  agentProfile?: string
}

/**
 * 🔴 **673 · this app has reopened this conversation — it is running again** (`663` F1).
 *
 * ⚑ **The host's first row of every life it reopens** — a person's Reopen and an agent's wake
 * alike — because a reopen is a fact the host knows at the moment it happens, and until this row
 * nothing in the ledger said so on Claude, which writes nothing until its first TURN. ⚑ It is the
 * seam `653`'s renderer crosses, the row a window takes a conversation back on (D-004,
 * {@link because}), and where `derivePieces` ends whatever drive the last life left open (D-013).
 * ⛔ **It moves no piece** (D-016c, `05`): a reopen says nothing about the work. ⛔ **Not a
 * `status` and not a `session`** — those are the provider's rows, and a host writing them would be
 * the app speaking for a provider that has said nothing yet.
 *
 * ⛔ **The row names nobody**: a person's Reopen writes no row naming them, and what caused a wake
 * is the delivery that carried it, recorded on its own row — a gap stated (`who-did-it.test.ts`),
 * not a design claimed.
 */
export interface ReopenedEvent {
  type: 'reopened'
  /**
   * 🔴 **D-004 · R101 — why this app reopened it BY ITSELF**, and absent on every other reopen.
   *
   * ⚑ `the-sign-in-was-renewed`: a Claude child died on a revoked sign-in (`auth_stale`), and the
   * machine login then held a different valid token — another Claude on this Mac renewed it — so
   * the host reopened the conversation on the new one (`RuntimeHost.reopenOnARenewedSignIn`).
   * ⚠️ Nothing was re-sent: the failed turn's tool steps may already have run. The transcript says
   * so in one line, and a window that watched the conversation die takes it back on this row.
   *
   * ⚑ `the-sign-in-moved-on`: a live Claude child was holding a sign-in this Mac had moved on from,
   * with words held for it, and nothing a reopen would lose — no turn, no card waiting on a person,
   * no background work, no planning — so the host closed it and started it again on the current one
   * (`RuntimeHost.reopenForWhatWaits`). The held words go first. Its *"allow for this session"*
   * approvals did not come with it, and the transcript says so in one line.
   */
  because?: 'the-sign-in-was-renewed' | 'the-sign-in-moved-on'
  /**
   * ⚑ Beside `the-sign-in-was-renewed` only: what was renewed was this conversation's copy of its
   * Codex sign-in, which this app replaced with a fresher copy of the same account. A turn carrying
   * on may follow ({@link UserTurnEvent.carriesOn}); where none does, the refused message was not
   * answered. A window says it in the words of `A_RENEWED_SIGN_IN_SAYS` (`shared/a-renewed-sign-in.ts`).
   */
  itsCopyWasReplaced?: true
  /**
   * The sentence that says this start brought the conversation back from the archive, and what
   * brought it: who gave it work or wrote to it, an answer to its question, or a person opening it.
   * Absent on every other reopen.
   */
  broughtBack?: string
}

/**
 * An agent brought this conversation back from the archive, to the lists, and sent it nothing: the
 * sentence that says so and names the agent, written before the conversation carries on. A start
 * that brings one back says it on its own row ({@link ReopenedEvent.broughtBack}).
 */
export interface RestoredFromTheArchiveEvent {
  type: 'restored_from_archive'
  saying: string
}

/**
 * ⚑ **D-017 · R4 — this app launched this conversation's provider**: the first app row of every life
 * it starts or reopens.
 *
 * ⚑ From this row on, a provider's terminal `status` abandons only the requests the provider held;
 * a question this app asked (`question_asked`) stays open until it is answered or withdrawn, and the
 * answer starts the conversation again (`deriveRoutedRequests`). ⚠️ A ledger with none replays as it
 * always did.
 */
export interface LaunchedEvent {
  type: 'launched'
  promptStart?: KeptPromptStart
  /**
   * What this launch gave its agent, every text in full ({@link WhatALaunchGave}). Absent on older
   * rows, and on a launch with no instruction reader.
   */
  given?: WhatALaunchGave
  /**
   * The person's own login had expired and their provider's program renewed it for this launch: the
   * sentence that tells them so. Absent otherwise.
   */
  loginRenewed?: string
}

/**
 * ⚑ **D-017 · R10 — this conversation can never be reopened, and a new one took its place** — the
 * last row of the old conversation's ledger (`05` rule 3).
 *
 * ⚑ Written when a delivery to it found that its provider no longer has it (`noSuchSession`), or
 * that its provider never named it (a row with no provider id). The new conversation is the same
 * agent — same identity, folder and parent — and keeps that agent's memory, not this
 * history. ⚠️ Open work this conversation held stalls `could_not_be_reopened`; later messages to its
 * id go to {@link sessionId}.
 */
export interface ReplacedByEvent {
  type: 'replaced_by'
  /** The conversation that took its place. */
  sessionId: string
}

/**
 * ⚑ **D-017 · R10 — this conversation took the place of one that can never be reopened** — the
 * first app row of its ledger after `launched`; {@link ReplacedByEvent}'s other end.
 */
export interface ReplacesEvent {
  type: 'replaces'
  /** The conversation whose place it took. */
  sessionId: string
}

/**
 * 🔴 **405 · an agent asked this app for something and a rule said no** (HO-019 §4, `402` F2).
 *
 * ## ⛔ The defect, measured on a live run
 *
 * `402` F2, from a real Codex worker this app refused:
 *
 * ```
 * tool_call    name: brobot__spawn_agent   summary: dynamicToolCall
 * tool_result  summary: dynamicToolCall    ok: true
 * ```
 *
 * ⚑ **`ok: true` is CORRECT** — `307` measured that a refusal must be a SUCCESSFUL call whose
 * payload denies the request, because a thrown handler becomes transport-shaped `-32603` and
 * *"carries no machine-readable policy meaning"*. ⛔ **And nothing normalises `structured`**, so a
 * refused call and an admitted one are the same two rows, and *"a person reading the transcript of a
 * child this app refused sees a tool call that worked."*
 *
 * 🔴 **HO-019 §4 states the consequence:** *"Our entire rail discipline is demonstrated by an actual
 * refusal — and if the ledger cannot tell the two apart, that discipline is provable in TESTS and
 * invisible in PRODUCTION."* ⚠️ **F4 is the proof of why it matters:** the only reason anybody saw a
 * model route around a refusal is that a person happened to be reading a live run.
 *
 * ## ⛔ Written by THIS APP, and that is what makes it provider-neutral
 *
 * ⚠️ **Not read back off the provider's echo of our payload.** Both providers now carry the payload
 * as a second TEXT part under the sentence — Codex because `DynamicToolCallOutputContentItem` has
 * nowhere else for it, Claude since `675` because the CLI replaced the text with the JSON whenever
 * `structuredContent` was present (`probe:claude-tool-answer`). A row derived
 * from what came back would be two different derivations, both of them parsing our own words out of
 * a provider's transport, and both silently empty the day either reworded anything.
 *
 * ⚑ **The app REFUSED. It knows.** This row is written where the decision is made, from the payload
 * that was handed to the model, before it goes anywhere near a wire.
 *
 * ## ⛔ There is no call id on it, and that is measured rather than an omission
 *
 * ⚠️ **Nothing correlates this row to the `tool_call` row above it, because no id reaches the tool
 * layer on either provider.** `AgentToolDefinition.call` takes arguments and nothing else, and that
 * is what both adapters can supply: Claude's `createSdkMcpServer` hands the handler `(args)` and the
 * MCP request id it does hold is a JSON-RPC id, not the `tool_use` id the `tool_call` row carries;
 * Codex's `DynamicToolCallParams` does carry a `callId`, and whether it equals the `itemId` the
 * `tool_call` row is keyed on is a claim no test in this repository makes.
 *
 * ⛔ **So this row does not claim to be attached to a particular call.** It says which TOOL was
 * refused and by which rule, and it lands in the same ledger, in order, between the call and its
 * receipt. ⚠️ **An id present on one provider and absent on the other would be worse than none**:
 * a fold that joined on it would draw the refusal onto the call for Codex readers and silently
 * nowhere for Claude ones, and the difference would look like a Claude bug.
 *
 * ## ⚠️ The REQUEST is not on this row, deliberately
 *
 * ⛔ **`405` §2: record the refusal, not the request.** A tool's arguments can carry a path, a
 * prompt or a person's words — `give_work`'s `brief` and `message_agent`'s `text` are the work
 * itself.
 *
 * ⚑ **§2's policy facts, and where each one is.** *That* a call was refused is the ROW's existence;
 * *which rail* is {@link rail}; *whether it is permanent* is {@link permanence}; *whether it is
 * retryable* is {@link retryable}. {@link tool} says which door, because a
 * transcript with two refusals in it is otherwise a transcript that cannot say which call. ⛔ The
 * `detail` a caller gets back — which names ids, folders and the problems with its arguments — is
 * not among them.
 */
export interface ToolRefusedEvent {
  type: 'tool_refused'
  /**
   * The tool the agent called, **unqualified** — `give_work`, never `mcp__brobot__give_work`.
   *
   * ⚠️ **One of `TOOL_NAMES`, and typed as a string here on purpose.** That list is `main/`'s and a
   * value import of it would cost the renderer a module it has no other reason to load; what the
   * renderer does with this field is print it. ⛔ The WRITER is narrowed — `RuntimeHost.noteRefusal`
   * takes a `ToolName` — so nothing can publish a name no tool has.
   */
  tool: string
  /**
   * ⛔ **Which rule said no**, in the word the door that refused it already uses.
   *
   * ⚑ **`405` §2: render them, do not re-spell them.** The registered closed rail vocabularies
   * produce this word, so it answers *which rule stopped this call* whichever door built the
   * payload; the derived census, rather than this paragraph, enumerates those owners.
   *
   * ⚠️ **What guarantees that, said exactly.** `what-an-agent-is-told-about-its-work.test.ts` §3
   * asserts absolute SENTENCE uniqueness over a vocabulary list DERIVED from the modules — so a
   * list this paragraph has never heard of is covered on the commit that adds it. ⚑ NAME sharing is
   * limited to its explicit allowlist: `malformed-request`, owned by
   * `SPAWN_RAILS` and `TOOL_REFUSALS`.
   *
   * ⛔ **`405` F8 reported three of seven checked and `412` found that stale in both halves.** Two
   * narrower assertions already existed — `the-rails-a-message-passes.test.ts` §6 over three lists
   * and `a-reply-and-its-absence.test.ts` §7 over five — so the real gap was `QUESTION_RAILS` and
   * `INTERRUPT_RAILS`, and the sentence a reader would have acted on named four. ⚠️ **This
   * paragraph also carried a COUNT of the names**, which is the thing that cannot be maintained;
   * the assertion counts them and this does not.
   *
   * ⚠️ **A union of every main-process rail vocabulary would be a `main/` type in a renderer
   * file** and would have to be re-widened by every future door. The writer is narrowed instead;
   * see {@link tool}.
   */
  rail: string
  /** How long the refusal is expected to be true for — a member of `RAIL_PERMANENCES`. */
  permanence: RailPermanence
  /**
   * ⚠️ **Recorded beside {@link permanence} even though every door DERIVES it from that word.**
   *
   * ⛔ **`341`'s rule is that one table produces both so they cannot disagree** — and that is a rule
   * about the doors, not about this row. A ledger row is read back by a build that is not the one
   * that wrote it, and re-deriving here would silently republish today's table over a refusal made
   * under yesterday's. ⚑ The row says what the model was told.
   */
  retryable: boolean
  /**
   * 🔴 **425 · what the app told the caller it could do instead, or nothing** (HO-023 §2.2).
   *
   * ## ⛔ The named policy fields above this one are the defect
   *
   * ⚠️ **The PO read his own ledger and found exactly them** — *"refused: spawn_agent ·
   * profile-already-live · while this holds · retrying may work"* — while the model, one layer up,
   * had been handed a composed way out. ⛔ **`405` §2's *record the refusal, not the request* threw
   * away something that was neither**: the app's own knowledge of what was still available.
   *
   * ⚑ **And it is still not the request.** A `RefusalRemedy` is a word from a closed list that
   * carries no data — no id, no path, no slot to put one in — so nothing a caller wrote can ride in
   * on it. `405` §2 survives; what it loses is only the thing it should never have taken.
   *
   * ## ⚠️ Optional, and that is the durable-reader hazard rather than an undecided writer
   *
   * ⛔ **`RuntimeHost.noteRefusal` always writes this field**, `null` included. ⚑ **It is optional
   * because the ROWS ALREADY IN THE DATABASE do not have it**: a `tool_refused` row written before
   * this dispatch is replayed by a build that has it, and `TranscriptEvent` is parsed from JSON with
   * no schema between the store and the fold. 🔴 **Absent, `null` and a word from a later build are
   * three inputs and one outcome in both readers: nothing is drawn.** An unrecognised word is never
   * printed, because a remedy is a promise about an act and a build that does not know the word
   * cannot vouch that the act exists.
   *
   * ⚠️ **`RefusalRemedy` and not `string`, unlike {@link rail} and {@link tool}.** Those two are
   * widened because their vocabularies live in `main/` and a value import would cost the renderer a
   * module; this one is already in `shared/refusals.ts`, beside {@link permanence}, and the renderer
   * imports the guard as a value in any case.
   */
  remedy?: RefusalRemedy | null
  /**
   * ⚑ **The sentence the caller was handed, whole** — the refusal's own words, without the
   * `refused (<rail>): ` its receipt opens with — so a person can read all of it after a restart.
   * The receipt's row keeps only its first 200 characters, and the rest was held in memory alone.
   *
   * ⛔ **Still not the request**: the door that refused composed these words, and none of them is
   * the work a caller wrote (a brief, a title, a message). ⚠️ They can name what the app looked at
   * to refuse: a piece's label, an agent, a model, the folder a start would have used, and on two
   * rails a failure in the words it arrived in (a folder that could not be used, a model list that
   * could not be read).
   *
   * ⚑ Bounded by `refusalToldOf`, on the way in and again when a stored row is read.
   * ⚠️ Optional: absent on every row written before this field, and on a refusal whose payload
   * carried no sentence. A reader then has the receipt's first words, as before.
   */
  told?: RefusalTold
}

/** One MCP server request waiting on a person, as the window reads it: with what its asker is called. */
export interface McpServerRequestForAPerson extends McpServerRequestWaiting {
  /** What the asking conversation is called, for the card's "reopens …". */
  readonly askerCalled: string
}

/** The durable binding of a normal worker, recorded with its first conversation row. */
export interface WorkerRegisteredEvent {
  type: 'worker_registered'
  identity: string
  identityCreatedAt: number
  giver: string
  number: number
}

/** The durable identity of a service, recorded with its standing root. */
export interface ServiceRegisteredEvent {
  type: 'service_registered'
  identity: string
  identityCreatedAt: number
}

/** A direct change names its author and durable history version without duplicating the text. */
export interface InstructionChangedEvent {
  type: 'instruction_changed'
  readonly conversation: AgentRulesReceipt['conversation']
  readonly profile: AgentRulesReceipt['profile']
  readonly version: AgentRulesReceipt['version']
  readonly previousVersion: AgentRulesReceipt['previousVersion']
  readonly author: AgentRulesReceipt['author']
  readonly replacedPersonVersion: AgentRulesReceipt['replacedPersonVersion']
}

/** A deferred native compaction; the newest record stands, and null consumes the request. */
export interface PendingCompactionEvent {
  readonly type: 'pending_compaction'
  readonly request: { readonly agent: string; readonly reason?: string } | null
}

export type TranscriptEvent =
  | AskHandoffAttempted
  | AskHandoffNotAccepted
  | AskProvenanceUnresolved
  | PendingCompactionEvent
  | WorkReconciliationEvent
  | ProviderFailureReconciliationEvent
  | WorkRecoveryEvent
  | WorkerRegisteredEvent
  | ServiceRegisteredEvent
  | RuntimeEvent
  | UserTurnEvent
  | UserDecisionEvent
  | QueuedMessageEvent
  | UnqueuedMessageEvent
  | UserCommandEvent
  | MemoryNoteEvent
  | MemoryLoadedEvent
  // ⚑ **D-016 · the seven piece events**, in the owner's ledger — see {@link WorkGivenEvent}. ⛔ The
  // same seven words as `PIECE_EVENT_TYPES` and `events_work_idx`.
  | WorkGivenEvent
  | WorkRepliedEvent
  | WorkTakenBackEvent
  | WorkRetitledEvent
  | WorkStatusSetEvent
  | WorkRebriefedEvent
  | WorkClosedEvent
  | RequestRoutedEvent
  // ⚑ **437's own question row** — see {@link QuestionAskedEvent} for why it is not the provider's.
  | QuestionAskedEvent
  // ⚑ **582's pair** — an agent asked for a rule against an identity's own instructions, and a
  // person decided.
  | InstructionProposedEvent
  | InstructionChangedEvent
  | InstructionSettledEvent
  // An agent asked the person to register an MCP server, and how that ended.
  | McpServerRequestedEvent
  | McpServerRequestSettledEvent
  | WorkInterruptedEvent
  // ⚑ **723's** — a person's Stop the provider has not answered; see {@link StopUnansweredEvent}.
  | StopUnansweredEvent
  | RequestStrandedEvent
  | RequestInterruptedEvent
  | QuestionWithdrawnEvent
  | QuestionRecipientEndedEvent
  | QuestionEndedWithItsPieceEvent
  | WorkRestartedEvent
  | ReopenedEvent
  | RestoredFromTheArchiveEvent
  | LaunchedEvent
  // ⚑ **D-017 · R10's pair** — see {@link ReplacedByEvent}.
  | ReplacedByEvent
  | ReplacesEvent
  // ⚑ **661 · {@link WorkStallTold}'s two members, as two arms** — `event-vocabulary.test.mjs`
  // reads one `export interface` per arm, and a union alias here would be an arm with none.
  | WorkStallToldEvent
  | WorkStallSetRightEvent
  // ⚑ **439's sender-side receipt** — see {@link MessageSentEvent} for the half it puts back.
  | MessageSentEvent
  // ⚑ **D-047 · the giver's own record of a give or a new brief** — see {@link WorkSentEvent}.
  | WorkSentEvent
  | ReplyUndeliveredEvent
  | RequestEscalatedEvent
  | ToolRefusedEvent
  // A conversation's title and its current rules, in its own ledger; the newest of each stands.
  | ConversationOwnRow

/** Recorded provider work relationships, in first-observed order. */
export interface WorkAncestryFacts {
  /** Native ordinal of the reset beginning this provider life; -1 precedes its first life. */
  readonly after?: number
  /** Recorded display facts needed by this receiver before the referenced work arrives. */
  readonly baseline?: readonly PersistedEventInfo[]
  readonly agents: readonly {
    readonly agentId: string
    readonly dispatch?: string
    /** Immediate parent supplied by core; the complete chain consists of these canonical links. */
    readonly parentAgentId?: string
    readonly complete: boolean
  }[]
  readonly tools: readonly {
    readonly callId: string
    /** Absent until a recorded dispatch identifies the agent that made this call. */
    readonly agentId?: string
  }[]
  readonly dispatches: readonly {
    readonly callId: string
    readonly agentIds: readonly string[]
  }[]
}

export interface WorkAncestryContext {
  readonly missing: readonly { readonly kind: 'agent' | 'tool' | 'dispatch'; readonly id: string }[]
  readonly truncated: boolean
}

export type WorkAncestry =
  | (WorkAncestryFacts & WorkAncestryContext & { readonly update?: false; readonly reset?: true })
  | (WorkAncestryFacts &
      Partial<WorkAncestryContext> & { readonly update: true; readonly reset?: true })

/** One recorded entry with the ordinal it was published under — the transcript, replayable. */
export interface PersistedEventInfo {
  /** Display projection only; the ledger keeps the event's original diagnostic. */
  errorFacts?: import('./error-facts').ErrorFacts
  workAncestry?: WorkAncestry
  ancestryContext?: readonly PersistedEventInfo[]
  /** Canonical human-final association for this history row; null means it is not selected. */
  humanFinal?: import('./human-answer-contracts').HumanFinalContext | null
  ordinal: number
  /** When it happened, epoch ms — the recorded time, not the moment it was replayed. */
  at: number
  event: TranscriptEvent
}
