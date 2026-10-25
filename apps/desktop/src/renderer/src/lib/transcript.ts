import {
  moveOfferOf,
  moveOriginOf,
  moveReceiptOf,
  type MoveOffer,
  type MoveOrigin,
  type MoveReceipt,
} from '../../../shared/move-request'
import type {
  AnsweredQuestion,
  BackgroundWork,
  ContextReading,
  DeclaredToolset,
  FileChange,
  HandedPath,
  MemoryNoteSeen,
  MemoryRecallEntry,
  MessageSentEvent,
  PermissionDecision,
  ProviderCommandSet,
  PublishedInventory,
  QuestionAskedEvent,
  QueuedMessageEvent,
  RequestRoutedEvent,
  RuntimeEvent,
  ScheduledJob,
  SessionRef,
  SessionStatus,
  ToolNaming,
  TranscriptEvent,
  UnknownCategory,
  UserTurnPart,
  WorkflowAgent,
  WorkflowPhase,
  WorkRepliedEvent,
} from '../../../shared/runtime-ipc'
// ⚑ **D-027 · a value import with no cycle** — `runtime-ipc.ts` imports only types.
import { A_RENEWED_SIGN_IN_SAYS } from '../../../shared/a-renewed-sign-in'
import { PROVIDER_NAME, theMessagesOf } from '../../../shared/runtime-ipc'
import { aTurnsLimitSays } from './usage-limit'
import { clockTime, clockTimeFrom } from '../../../shared/clock'
import { scheduleLine } from './scheduled-work'
// ⚠️ **`apps/desktop/src/shared/`, which is NOT `@brobot2/shared`** — the 135 kB zod measurement
// is about the workspace PACKAGE, and this directory is inside the app. A value import here is
// what every neighbour in this folder already does (`runtime-ipc.ts`'s `providerName`, `YOLO_LABEL`).
import {
  isAgentMessageKind,
  isAWorkReport,
  type AgentMessageKind,
  type WorkReport,
} from '../../../shared/tasks'
import { endingMeans, rulesChangeLabel } from '../../../shared/own-instructions'
import {
  anEarlierMcpServerRequestEnded,
  isMcpServerRequestEnding,
  mcpServerRequestedSentence,
} from '../../../shared/mcp-server-requests'
// ⚑ **624 · a value import, and a cheap one** — `shared/app-notice.ts` holds two words, two
// sentences and two readers over them, and imports NOTHING. See `refusals.ts` below for what makes
// a shared import expensive.
import type { BackgroundRow, ScheduledRow } from '../../../shared/agent-state'
import type { BackgroundOutcome } from './background-work'
import {
  knownRefusal,
  providerErrorSentence,
  refusalSentence,
  turnFailureDetail,
} from './provider-error'
import type { ActedBy } from '../../../shared/who-did-it'
// ⚑ **405 · a value import, and a cheap one.** `shared/refusals.ts` holds three strings and one
// `includes` — see `a-value-import-from-shared-costs-the-renderer-135kb`'s lesson for what makes a
// shared import expensive, which is a module that drags zod or the database in behind it.
import {
  isRefusalRemedy,
  permanenceSaid,
  type RefusalRemedy,
  type RefusalTold,
} from '../../../shared/refusals'
import { mergeWorkflowAgents, mergeWorkflowPhases } from './workflow'
// ⚑ **658 · a value import with no cycle** — `tool-inventory.ts` imports only TYPES from this file.
import { splitQualified } from './tool-inventory'
import { argumentExcerpt } from './argument-excerpt'
import { drawsAsACard } from './draws-as-a-card'
import { readAnsweredQuestion } from './answered-question'
import { withoutHandles } from './outgoing-card'
import {
  endMessageRun,
  messageCall,
  messageReceipt,
  messageResult,
  rejectMessageReceipt,
  type MessageJoins,
} from './message-receipts'
// ⚑ **667 · a value import with no cycle** — `lost-reply.ts` reaches `outgoing-card.ts`, which imports
// only TYPES from this file.
import { isUndeliveredReason, lostReplySentence, type LostReply } from './lost-reply'
import { instructionAskedSentence, type InstructionAsked } from './instruction-asked'
import {
  askedToStopSays,
  stopUnansweredSays,
  type AskedToStop,
  type StopUnanswered,
} from './stop-unanswered'
// ⚑ **672 · a value import with no cycle** — `piece-called.ts` imports nothing.
import { pieceNumbersOf } from '../../../shared/piece-called'
import { textPackRefusedSaid } from '../../../shared/text-pack'
import type { HumanAnswers, HumanFinalContext } from '../../../shared/human-turn-answer'
import { startHumanAnswer, finishHumanAnswer } from './human-answers'

/**
 * The event stream, folded into what the screen shows.
 *
 * This is the only place `RuntimeEvent`s are interpreted: components render
 * items, they never read events. Keeping the fold here makes it a plain,
 * testable function — and keeps every component small enough to do one thing.
 *
 * It renders what the contract guarantees and nothing more: deltas are
 * progressive and best-effort, so the authoritative `assistant_message`
 * *replaces* the accumulated text rather than being appended to it; a
 * `tool_result` correlates to its call by id; and a request card is only ever
 * marked answered because the app answered it (or because teardown settled it),
 * never because a later event looked like an answer.
 */

export type PermissionRequestEvent = Extract<RuntimeEvent, { type: 'permission_request' }>
export type UserInputRequestEvent = Extract<RuntimeEvent, { type: 'user_input_request' }>
/** ⚠️ Not `ErrorEvent` — that is a DOM global, and this file is compiled with `lib.dom`. */
type RuntimeErrorEvent = Extract<RuntimeEvent, { type: 'error' }>
export type PermissionOutcome = PermissionDecision['outcome']
/**
 * ⛔ **Why a request offers no way to ALLOW it** (487) — the WORD the adapter wrote, whose sentence
 * `permission-offer.ts` renders. Derived from the event so a fourth reason is a compile error in
 * the `Record` that says what each one means, the way `PermissionOutcome` already is.
 */
export type NoPositiveBecause = NonNullable<PermissionRequestEvent['scope']['noPositiveBecause']>

export interface UserItem {
  movedFrom?: MoveOrigin
  kind: 'user'
  id: string
  text: string
  /**
   * 🔴 **F093 · the whole text the provider was handed for this turn** —
   * {@link UserTurnEvent.sent}, kept by {@link keepWhatWasSent}. ⚠️ Absent on turns from before it
   * was kept. ⛔ {@link text} stays the words alone, which is what the transcript draws.
   */
  sent?: string
  /** ⚑ {@link sent} carries the other messages of its turn too: they were handed over as one. */
  sentWithOthers?: true
  /**
   * Carried through from {@link UserTurnEvent.attribution} (074) — the bubble is the one surface
   * where "we watched this" and "a file says so" have to stop looking identical.
   *
   * ⚠️ **Narrower than the event's field, deliberately** (278 §1). That field grew a third value,
   * `'app_authored'`, and a turn carrying it never becomes a {@link UserItem} at all — the fold
   * makes a {@link ContinuationItem} instead. Widening this to match would be offering a state the
   * bubble has no way to draw honestly, which is how the "You" heading with a footnote gets built.
   */
  attribution?: 'provider_transcript'
  /**
   * ⛔ **Paths BroBot attached to this turn — never part of {@link text}** (216 §2).
   *
   * Expose attachment paths appended to the prompt separately from the person's words. The provider receives both, and the bubble must show which content BroBot supplied.
   *
   * ⚠️ **This is `214`'s defect prevented from the other end.** That dispatch removed 12,646 messages
   * that rendered injected material as *"You"*; folding the attachment block into `text` would put
   * BroBot's sentence inside somebody's quoted turn, permanently, with nothing to tell them apart.
   */
  attachments?: HandedPath[]
}

/**
 * 🔴 **A message BroBot sent, in BroBot's own words, because a person pressed a control** (278 §1,
 * from 276).
 *
 * Today there is exactly one: the plan go-ahead. `endPlanMode` composes the mode change with a real
 * message, and 276 measured against real Codex that the message is doing work the switch cannot —
 * the switch alone started **0/2** turns and produced **0/2** artifacts, the switch plus the
 * sentence executed **2/2**. So it is still sent, and it still reaches the model.
 *
 * ⚠️ **624 · *exactly one* stopped being true at `615` and is true again.** ⛔ A decision
 * carrier and a question answered by a PERSON both reached this entry with no subject, and both
 * inherited a caption about a button nobody had pressed (`HO-095` §6.3). ⚑ {@link AppNoticeItem}
 * is the entry they were missing; this one is the go-ahead's again, and
 * `a-message-says-who-wrote-it.test.ts` §5 is where the count is measured rather than claimed.
 *
 * ⛔ **Its own kind, not a {@link UserItem} with a flag, and 077's argument is the argument.**
 * `QueuedItem` is separate because a message that was sent and one that was not must not be
 * confusable at the type level; this is the same rule about a different axis — a message the person
 * WROTE and a message BroBot wrote for them. ⚠️ `214` removed 12,646 messages that rendered
 * injected material as *"You"*, and a go-ahead nobody typed rendered under a "You" heading with a
 * quiet footnote would be that defect surviving its own fix. The heading is BroBot's.
 *
 * ⚑ **It is still a TURN, and the ledger still says so.** The event underneath it is a `user_turn`
 * carrying {@link UserTurnEvent.attribution} `'app_authored'` — because `045` opens a turn row from
 * that event and from nothing else, and this really did start a turn on the provider. What is app-
 * authored is the AUTHORSHIP, and the authorship is all that changed.
 */
export interface ContinuationItem {
  kind: 'continuation'
  id: string
  /** The whole text the provider was handed for it, as {@link UserItem.sent}. */
  sent?: string
  /** As {@link UserItem.sentWithOthers}. */
  sentWithOthers?: true
  /**
   * The sentence that went to the provider, verbatim.
   *
   * Show the app-supplied text in full. The composer discloses it before the click through `GO_AHEAD_NOTE`; this item records the same text afterward.
   */
  text: string
}

/**
 * 🔴 **A turn this app sent to REPORT something it observed** (624, `HO-095` §6.1) — see
 * `shared/app-notice.ts`.
 *
 * ## ⛔ The defect it removes, photographed
 *
 * Classify approval carriers as app notices instead of {@link ContinuationItem}. Approving a proposal is not pressing Start work on this plan, and the app rather than the conversation's agent wrote the carrier.
 *
 * ## ⚑ Its own kind, for {@link WorkReportItem}'s reason and {@link RelayedItem}'s
 *
 * ⛔ **`app_authored` says the app wrote the words; it does not say what they are ABOUT.** ⚑ Three
 * subjects now select an entry — work this conversation gave out, another conversation's words,
 * and this app's own report — and the fourth case, NO subject, is the go-ahead and only the
 * go-ahead. ⚠️ **That is what makes the continuation's caption true again**: after this dispatch
 * nothing but `endPlanMode` can reach it.
 *
 * ## ⚠️ Why it is a TURN and counts as one
 *
 * ⛔ **`045` opens a turn row from `user_turn` and from nothing else**, and this really is one:
 * the provider receives the notice and answers it. ⚑ {@link appendAppNotice} bumps
 * `changes.turn` for {@link appendAppTurn}'s stated reason — a notice that did not count would
 * file everything the agent does about it under the previous prompt.
 */
export interface AppNoticeItem {
  answeredQuestion?: AnsweredQuestion
  kind: 'appNotice'
  id: string
  /** The whole text the provider was handed for it, as {@link UserItem.sent}. */
  sent?: string
  /** As {@link UserItem.sentWithOthers}. */
  sentWithOthers?: true
  /** The words that went to the provider, verbatim — {@link ContinuationItem.text}'s rule. */
  text: string
  /**
   * 🔴 **WHAT this app is reporting** — {@link UserTurnEvent.appNotice}, and the caption is
   * rendered from it.
   *
   * ⛔ **Read as a non-empty STRING, as {@link RelayedItem}'s relayer is** ({@link carriesANotice}):
   * a word this build no longer has a sentence for is still this app's own report — a row written
   * before D-016 carries `a-decision-a-person-made` — and reading it as a member would hand that row
   * the go-ahead's caption about a button nobody pressed, which is `HO-095` §6.3 again. ⚑
   * `noticeMeans` is the reader that says what any notice means when this build has no sentence
   * for the word.
   */
  notice: string
}

/**
 * 🔴 **What came back from work this conversation gave out** (406, HO-019 §2).
 *
 * ## ⛔ Its own kind, and it is {@link ContinuationItem}'s argument with a third producer
 *
 * ⚠️ **`app_authored` says BroBot wrote the words; it does not say what they are ABOUT.** Several
 * paths write it — the go-ahead, a child's reply, the notice that nothing is driving work, and
 * (`624`) this app's own report of what became of a question — and drawing any of them as a
 * continuation would put somebody else's words under *"sent for you"* and the go-ahead's own
 * authorship line. ⛔ One word answering two questions is `395`'s ruling; the subject travels on
 * {@link UserTurnEvent.work} and this is the item it selects.
 *
 * ⚑ **624 · the count is gone rather than corrected**, which is
 * `a-number-can-survive-the-death-of-its-derivation`: it read *three* and a fourth arrived, and
 * a fifth must not need this line edited again.
 *
 * ## ⚑ Why it is a transcript item at all, when `393` ruled the reply's own row is not
 *
 * ⚠️ **That ruling is about the CHILD's ledger and is untouched.** *"The conversation already
 * shows the reply: the agent called a tool"* — true where the tool call is, and the child's
 * transcript still draws no task ROW of its own: since `658` the reply's facts land on that call,
 * which draws as the reply's card (`OutgoingEntry`). ⛔ **This is the PARENT's ledger**, where the reply arrives
 * as words and there is nothing else: `derivePieces` folds one session's own rows, so the
 * conversation that gave the work cannot see the row that answers it.
 *
 * ## ⛔ It carries FACTS and never re-derives them
 *
 * ⚑ Every field below is {@link WorkReport}'s, copied. A renderer that read the outcome out of
 * {@link text} would be a second reading of a fold it cannot see, free to disagree with the
 * sentence printed beside it.
 */
export interface WorkReportItem {
  /** The recorded sender, retained for opening its conversation. */
  relayedFrom?: string
  kind: 'workReport'
  id: string
  /** The whole text the provider was handed for it, as {@link UserItem.sent}. */
  sent?: string
  /** As {@link UserItem.sentWithOthers}. */
  sentWithOthers?: true
  /** The words that went to the provider, verbatim — {@link ContinuationItem.text}'s rule. */
  text: string
  /** The facts, as the app reported them at that moment. */
  report: WorkReport
  /**
   * 🔴 **658 · the conversation whose reply this report carries** — a slug for {@link agentName}, or
   * absent.
   *
   * ⛔ **The event always carried it and this fold dropped it.** `deliverReplyTo` queues a reply with
   * the piece's owner as `carriedFor`, so the `user_turn` arrives with `relayedFrom` and
   * `relayedFromProfile` — but the `work` check runs FIRST and built this item from `text` and
   * `report` alone. ⚑ So a child's answer drew as its label with no word for who sent it, which is
   * the half of *"Ada to BroBot"* this row could never say.
   *
   * ⚠️ **Absent on a STALL notice, and that is true rather than lost**: `tellOneParent` queues the
   * app's own words about a child that stopped, with no `carriedFor`, so there is no relayer to keep.
   * Read through {@link relayerIdentity} — the same trust boundary {@link RelayedItem} uses.
   */
  relayedFromProfile?: string
  /**
   * 🔴 **658 · whether another conversation's words are on this row at all** — {@link QueuedItem.relayed}'s
   * flag, one row over, and for its stated reason.
   *
   * ⛔ **The two fields answer two questions**: this one decides that the row came from OUTSIDE,
   * and {@link relayedFromProfile} decides the NAME. ⚠️ A reply relayed by a conversation with no
   * identity row carries `relayedFrom` and no profile — still another conversation's words, drawn
   * shifted and headed by `AN_UNNAMED_RELAYER`. ⚑ Found by `658`'s own test: keyed on the name
   * alone, that reply drew as the app's own report.
   */
  relayed?: true
}

/**
 * 🔴 **Words another conversation wrote, carried here by BroBot** (413).
 *
 * ## ⛔ The producers, and what they were drawn as until this dispatch
 *
 *  - `message_agent` carries a note or follow-up from another agent; `give_work` briefs arrive through the same outside-message framing. Attribute them to their sender rather than the person.
 *  - `routeRequest` carries a child's question to its parent. It needs the relayed entry instead of the plan go-ahead's sent-for-you caption.
 *
 * ## ⚠️ Its own kind, for {@link ContinuationItem}'s reason and not as a variant of it
 *
 * ⛔ **A continuation with a flag would be one entry making two different claims**, and the
 * difference is not decoration: the go-ahead is BroBot speaking FOR the person, and this is
 * BroBot speaking for somebody else entirely. `395`'s ruling — one word answering two questions —
 * is the same ruling {@link WorkReportItem} above was split out under.
 *
 * ## ⛔ It named nobody, and `HO-054` §3 reversed exactly half of that
 *
 * ⚑ *"No invented actor … a turn attributed to the app is not a turn attributed to a named agent
 * unless the ledger holds that name."* ⛔ **The first clause SURVIVES and is not weakened by a
 * word**; what expired is the reason `413` gave for stopping there — *"the only thing the renderer
 * could print is a `sess_…` handle"* — because `449` made a conversation resolvable to an identity
 * and `545` put that identity on the row.
 *
 * ⚠️ **So the CONVERSATION id is still deliberately NOT on this item**: printing a handle as a
 * sender would be an actor invented out of an id, which is the half that did not move. ⚑ What is
 * here is {@link RelayedItem.relayedFromProfile} — the identity, which {@link agentName} turns into
 * the same word every other surface uses for that agent.
 */
export interface RelayedItem {
  answeredQuestion?: AnsweredQuestion
  /** The recorded sender, retained for opening its conversation. */
  relayedFrom?: string
  kind: 'relayed'
  id: string
  /** The words that went to the provider, verbatim — {@link ContinuationItem.text}'s rule. */
  text: string
  /**
   * 🔴 **F093 · the whole text the provider was handed for this turn** —
   * {@link UserTurnEvent.sent}, kept by {@link keepWhatWasSent}. ⚠️ Absent on turns from before it
   * was kept. ⛔ {@link text} stays the words alone, which is what the transcript draws.
   */
  sent?: string
  /** ⚑ {@link sent} carries the other messages of its turn too: they were handed over as one. */
  sentWithOthers?: true
  /**
   * 🔴 **WHO relayed it** (545) — {@link UserTurnEvent.relayedFromProfile}, the identity slug, and
   * never the conversation beside it.
   *
   * ⚠️ **Absent is a state a person meets today, not a defensive branch**: every row written before
   * `545` carries the conversation and not this. ⛔ The entry then says what it can — see
   * `relayed-turn.ts`'s `AN_UNNAMED_RELAYER` — rather than inventing a name.
   *
   * ⚑ **Read as a non-empty STRING and never as truthy**, for {@link
   * UserTurnEvent.relayedFrom}'s reason: replay is a trust boundary and a row edited on disk must
   * not be able to put an object where a heading goes.
   */
  relayedFromProfile?: string
  /**
   * 🔴 **678 · the piece these words GIVE, or give a new brief** (`671` G2 —
   * {@link UserTurnEvent.piece}), so the card can say the words arrived as WORK rather than as a
   * message. ⚑ `label` is the turn's own — the label is taken before the brief is sent (D-016 ·
   * R4), so both branches carry it — and `title` is the `work_given` row's.
   *
   * ## ⚠️ The title is joined in BOTH directions, because the ledger's order differs by branch
   *
   * ⚑ **Held:** the `work_given` row first, then this turn when the message flushes — the title is
   * in {@link TranscriptState.piecesGiven} already. ⚑ **Idle:** this turn FIRST, then the row — so
   * the turn waits in {@link TranscriptState.briefsAwaitingTheirTitle} and the row fills it in.
   * ⚑ **A new brief** comes after its piece's row on either branch, so its title is found the held
   * way.
   *
   * ⚠️ **`title` absent is one of TWO things, and the card says the label alone for both**, never a
   * title guessed from the words: a brief whose piece was never written down has a turn naming it and
   * no row (`recordTheGive`'s stated price); ⛔ **or the row is outside the loaded window**
   * (`678`'s review). On the HELD branch the row is written a turn earlier than the words, so a page
   * that starts at the flushed turn — a resume, a recording, a live window's release — has the turn
   * and not the row. ⚑ It corrects itself when older history loads. ⛔ **`label` absent** is a turn
   * whose stored label is not one `pieceCalled` spells, and no row in view names it: the card then
   * says *Piece* — the outgoing reply card's rule for the same honest absence.
   */
  opened?: { label?: string; title?: string }
  /**
   * 🔴 **688 · what the SENDER said these words are** (`687` H1) — {@link UserTurnEvent.says},
   * `note` or `follow-up` (since D-016; a row that says `work` is older and is no longer a kind), the
   * word the sender's own card draws from `message_sent.kind`.
   *
   * ⛔ **Absent is *not recorded*, and never *a question***: a row written before `687`, and every
   * relayed turn no agent declared — a question the app ROUTED for a child names the child and was
   * declared by nobody. ⚑ Read as a MEMBER ({@link isAgentMessageKind}) and only where the relay
   * itself was read, `545`'s rule for the relayer.
   */
  says?: AgentMessageKind
}

/**
 * A message the user wrote while a turn was running and asked us to hold (077).
 *
 * ⚠️ **Its own kind, not a {@link UserItem} with a flag.** A user item is a turn that was sent; this
 * is one that has not been, and the dispatch's rule — *"the transcript must not show a message as
 * sent before it was"* — is only enforceable if the two cannot be confused at the type level.
 *
 * When it is finally sent this item is REMOVED and the ordinary user bubble that follows takes its
 * place, so the same text is never on screen twice. Nothing is lost by that: the ledger keeps both
 * events, so "it was queued" stays recoverable in the raw stream even though the chat stops saying
 * it once it has stopped being true.
 */
export interface QueuedItem {
  movedFrom?: MoveOrigin
  answeredQuestion?: AnsweredQuestion
  /** The recorded sender, retained for opening its conversation. */
  relayedFrom?: string
  kind: 'queued'
  id: string
  /**
   * The words held. ⚑ **D-022 · R1 — a held give's card reads its piece's NEWEST brief**: a
   * `work_rebriefed` that rides it ({@link WorkRebriefedEvent.messageId}) rewrites it here, as the
   * turn it becomes will carry it. ⚠️ A card rebuilt from its ending alone (`054`) reads the words
   * it was queued with.
   */
  text: string
  /**
   * How it ended, or `null` while it is still waiting.
   *
   * In practice `'sent'` never survives here, because a sent message stops being a queued item at
   * all. The union carries it anyway because the EVENT does, and a narrower type here would make
   * the fold's removal look like a choice rather than the mechanical consequence it is.
   *
   * ⚑ **690 · `retracted`** — the app took back its own notice (R32). ⛔ It always carries a
   * `detail`, so `QueuedMessage.vue` draws it through the *not sent · detail* arm — ⚑ **701 · in the
   * quiet ending style every ending takes** (its `ended` class), and the export prints the detail.
   */
  outcome: 'sent' | 'cancelled' | 'retracted' | 'abandoned' | 'handover' | null
  /**
   * ⛔ **The paths queued with it** (216, review).
   *
   * Show attachments while a message is held, when the person can still cancel or revise it. Restoring it to the composer must also restore its paths so the draft is complete.
   */
  attachments?: HandedPath[]
  /** A more specific reason than the outcome word alone — see the event's `detail` (216). */
  detail?: string
  /**
   * 🔴 **What this held message reports about work, when the APP queued it** (406) — see
   * {@link WorkReportItem}.
   *
   * ⛔ **Present on the queued item as well as on the turn it becomes**, because a busy parent is
   * the ordinary case: a reply to a conversation that is mid-turn sits here first, and a row a
   * person reads must not say *"You"* for a few seconds and then stop. ⚠️ Absent for every
   * message a person wrote.
   */
  report?: WorkReport
  /**
   * 🔴 **Whether the HELD words came from another conversation** (413) — see {@link RelayedItem}.
   *
   * ⛔ **A message or a brief for a busy agent is held until that agent finishes what it is
   * doing**, so a busy child receives every piece as a held row. Until this dispatch that row
   * said *"You"* and offered **Cancel it** and **Put it back in the composer** — the first would
   * destroy a task another agent had already been told was accepted, and the second would load
   * another model's words into the person's draft. ⚑ `406` closed exactly this pair for a work
   * report; this is the half that reaches every task in the product.
   *
   * ⚠️ **A flag and not an id**, for {@link RelayedItem}'s stated reason — and it stays a flag
   * after `545`. ⛔ **The two fields answer two questions**: this one decides the ENTRY and the
   * controls, and {@link QueuedItem.relayedFromProfile} decides the NAME. ⚑ A relayed row this app
   * cannot name is still not the person's, so folding them into one field would put **Cancel it**
   * back on every held task written before `545`.
   */
  relayed?: true
  /**
   * 🔴 **WHO relayed the held words** (545) — {@link RelayedItem.relayedFromProfile}, on the row a
   * person reads first.
   *
   * ⚠️ **The held row and the turn it becomes are the same row a few seconds apart**, which is
   * `406`'s own rule for {@link QueuedItem.report}: a heading that named nobody while the words
   * waited and somebody once they went would be two answers to *whose words are these*.
   */
  relayedFromProfile?: string
  /**
   * 🔴 **This app's own report, on the row a person reads FIRST** (624, `HO-095` §6.1) — see
   * {@link AppNoticeItem}.
   *
   * Carry app-notice provenance while queued. Without it, a held notice can fall back to You and offer cancellation even though it reports an app-authored durable fact.
   *
   * ⚠️ **Present here as well as on the turn**, which is {@link QueuedItem.report}'s rule and its
   * reason: a row that said one thing while the words waited and another once they went would be
   * two answers to *whose words are these*, a few seconds apart.
   */
  appNotice?: string
  /**
   * 🔴 **688 · R22 — the held words are BroBot's plan go-ahead** (`687`,
   * {@link QueuedMessageEvent.attribution}).
   *
   * ⛔ **Present only when the row says `app_authored` and names NO subject** — no `work`, no
   * `relayedFrom`, no `appNotice`. That is the turn fold's own rule for the go-ahead's entry
   * ({@link ContinuationItem}), asked of the held row so the row and the turn it becomes answer
   * *whose words are these* the same way. ⚑ `687` measured it: `endPlanMode` holds the go-ahead as
   * `THE_APP_ITSELF`'s words when it loses its race to a turn, and nothing else writes that shape.
   *
   * ⚠️ **Absent on a person's own held message, and on every row written before `687`**, which
   * carried no authorship on a held row at all — so an older held go-ahead still draws as the
   * person's. ⛔ Never inferred from the TEXT: a person may type *"Go ahead with this plan."*.
   *
   * ⚑ **R33** — a person MAY take it back, from this row, in its own words; what follows is the
   * state `060` and `670` already name. See `QueuedMessage.vue`.
   */
  goAhead?: true
  /**
   * 🔴 **688 · what the SENDER said the held words are** — {@link RelayedItem.says}, on the row a
   * person reads first. ⛔ The same absence rule: *not recorded*, never *a question*.
   */
  says?: AgentMessageKind
  /**
   * 🔴 **WHICH held message this row is** (413, from `406`'s reported finding) — the
   * {@link QueuedMessageEvent.messageId} it was queued under.
   *
   * ## ⛔ Because a session can hold TWO, and has been able to since `394`
   *
   * ⚠️ **{@link openQueuedItem} used to answer *the last unresolved one*, on a stated premise:
   * *"the host allows only one queued message per session at a time."*** ⛔ `394` made the mailbox
   * hold a work message AND a question, and nothing corrected that sentence — so an ending named
   * one row and settled another. ⚑ **Measured before it was fixed**: queue `m_work`, queue `m_q`,
   * then send `m_work` — the QUESTION's row was spliced out and the work's stayed on screen with
   * no ending it could ever receive.
   *
   * ⚠️ **Optional, because a ledger written before `354` has no ids at all** — `messageId`'s own
   * absence rule, carried one layer out.
   */
  messageId?: string
  /**
   * 🔴 **537 · the LABEL of the piece these held words hand over, once `work_given` names it.**
   *
   * ## ⛔ Because the work arrives at QUEUE time and the words do not
   *
   * ⚠️ **A brief has two branches and this field is the second one's.** An idle owner takes the
   * words straight out; a BUSY one gets `message_queued` — and on that branch `recordTheGive` writes
   * {@link WorkGivenEvent} immediately after, carrying {@link WorkGivenEvent.messageId}. ⛔ **From
   * that moment `list_tasks` answers with the piece** — its label, `waiting`, and its brief — so the
   * receiving agent can read and act on work this row was calling `not sent`.
   *
   * 🔴 **Measured in the photograph `537` was dispatched from**: a held row reading *not sent ·
   * waiting for the turn to end* with the next assistant turn, in the same minute, saying *"a new
   * formal task arrived (`task_3b480f7e`)"*. ⚠️ **Both sentences were true of different things**,
   * which is what made the page read as a contradiction.
   *
   * ⛔ **Absent on every held message that hands over no work** — a person's own mid-turn message,
   * a routed question, a reply to a busy parent — and those rows go on saying `not sent`, because
   * for them nothing has arrived anywhere. ⚑ See {@link QueuedItem.report}, which is the same
   * shape for the same reason one subject over.
   */
  label?: string
}

export interface AssistantItem {
  /** A provider-marked final paired to an observed human turn. */
  humanFinal?: true
  humanFinalPromptOrdinal?: number
  kind: 'assistant'
  id: string
  text: string
  /** True while deltas are still landing in this item. */
  streaming: boolean
  /**
   * Set when this turn is a SUB-AGENT's words that had nowhere to go yet (131) — the exact twin of
   * {@link ToolItem.parentToolCallId}, for the same window and the same reason. A child can speak
   * before its `task_started` creates the card, and 128 dropped that sentence into the conversation
   * with nothing recording whose it was: `reclaimChildRows` understood tool rows only, so the words
   * stayed a loose parent-level turn forever. Remembering the owner is what lets the card take them
   * back, and what makes 127's *"never a loose top-level turn"* a rule rather than a hope.
   */
  parentToolCallId?: string
  /**
   * ⚑ **Questions this message asked without waiting** (provider follow-ups 1) — the event's own
   * `questions`, carried so a surface can draw the options as choices. The `text` already says them.
   * ⛔ Nothing waits on them, so nothing here makes the conversation "waiting on you".
   */
  questions?: readonly { title: string; options?: readonly string[] }[]
}

export interface ToolItem {
  kind: 'tool'
  id: string
  /** The provider's tool-use id — the correlation between a call and its result. */
  callId: string
  name: string
  summary: string
  /**
   * `at` on the result is when the RESULT landed, and the only reason it is kept: how long a tool
   * took is the difference between it and the call's own `at`. Measured from the two envelopes,
   * never from a clock read while rendering — a replayed conversation must show the durations it
   * actually had, not the age of the replay.
   *
   * ⚑ **`durationMs` is the same question answered by the provider instead** (327), and it is
   * carried so the row can show ONE duration rather than two derivations of it — `064`/`099`'s rule.
   * The subtraction above spans two `RuntimeHost` delivery stamps, so it includes transport and the
   * host's pump; measured, the envelopes were 7 ms apart for a call the provider timed at 4. See
   * {@link ToolEntry}'s `took`, which prefers this one and falls back to the subtraction.
   */
  result: { summary: string; ok: boolean; at?: number; durationMs?: number } | null
  /**
   * The whole sentence one of the app's own tools refused this call with, as the host kept it on
   * the refusal: the receipt above holds only its first part. Absent on a call that was not refused,
   * and on every refusal written before the host kept it.
   */
  told?: RefusalTold
  /** The rail from the uniquely matched refusal row for this call. */
  refusalRail?: 'that-agent-is-you'
  /**
   * 🔴 **What this call reached inside the profile's own memory store, relative to that store**
   * (330) — present only when the provider said where its store is and this call named a file in it.
   *
   * Preserve the known memory path so the row can identify memory activity without relying on the truncated end of a long filename.
   *
   * ⚑ **Relative, and that is `MemoryRecallEntry`'s own convention** — the other provider's memory
   * rows already show paths *"relative to the profile's memory base path"*. {@link summary} still
   * carries the whole absolute path, so nothing is hidden; this is what the row LEADS with.
   *
   * ⚠️ **Absent never means "not a memory".** See the event field: it means nothing said it was one.
   */
  memoryPath?: string
  /**
   * We stopped watching before this call reported back (074) — set by {@link stopOpenToolCalls} at
   * every boundary that ends the thing running it.
   *
   * ⚠️ Deliberately NOT an outcome. `result` stays `null`, because no result arrived; this says only
   * that none ever will, which is what turns a false "running…" into a true "did not finish".
   */
  unfinished?: boolean
  /**
   * This call is already rendered as something else, so the conversation should not show the same
   * fact twice (028). Set from a `plan_update`'s `supersedes`: Claude builds its checklist out of
   * `TaskCreate`/`TaskUpdate` calls, and without this a three-step plan appears as three tool rows
   * AND the checklist they produced — while Codex, whose plan is a notification, shows only the
   * checklist. The flag makes both providers render the same thing.
   *
   * It HIDES rather than deletes, and only in `normal`: debug still shows every call, because
   * debug's contract is that it shows what the provider really said.
   */
  superseded?: boolean
  /**
   * The sub-agents this call dispatched (029), nested rather than listed beside it. A `Task` row
   * with a card inside it reads as one thing that happened; the same two side by side read as two.
   */
  subAgents?: SubAgentCard[]
  /**
   * Set when this row is a SUB-AGENT's call that had nowhere to go yet (029): the child's tool
   * blocks can reach the fold before the `task_started` that creates its card, and a call dropped
   * into the conversation in that window is the exact misattribution 029 exists to end. Recording
   * whose it is means the card can reclaim it the moment it appears — see {@link reclaimChildRows}.
   */
  parentToolCallId?: string
  /**
   * The dynamic workflow this call launched (108), if it is a `Workflow` call — ONE evolving tree,
   * never a row per frame. See {@link WorkflowRunCard}.
   */
  workflow?: WorkflowRunCard
  /**
   * ⛔ **This call's work LEFT rather than finished** (248) — present only when the provider said so.
   *
   * ⚠️ **Presence is the whole flag, and it has exactly TWO writers.** From a receipt it is set from
   * `tool_result.backgrounded` alone — `247` is explicit about why not from the receipt's wording:
   * *"'Command running in background with ID: …' is the provider's sentence, it has changed shape
   * across pins, and the flag beside it is derived from the level set."* And never from
   * `backgroundId` — Codex attaches a `processId` to **every** PTY-backed command, foreground
   * included, so a card gated on having an id would put "still running" on finished commands, which
   * is the false-settled card's mirror image.
   *
   * ⛔ **The second writer is the LEVEL itself** ({@link markLevelRunning}, 287 finding 1), and it is
   * not the trap above wearing a hat: the level is read at a turn boundary and nowhere else, so a
   * row in it is work that outlived its turn — the definition of the subject. It exists because
   * Codex's detached commands produce no `tool_result` at all, so the receipt writer never fires and
   * the card had nothing to read.
   *
   * ⚑ **The card becomes the completion record.** While {@link DetachedWork.outcome} is absent the
   * work is still going; when `background_work.ended` names this call, the outcome, the summary and
   * the output file land here and the row stops saying *"still running"* — the half `245` measured
   * as never changing at all.
   */
  background?: DetachedWork
  /**
   * The provider's key for stopping this command independently of the turn, whether or not it detached.
   *
   * ## ⛔ Why this is a second field and not `background.id`
   *
   * ⚠️ **{@link detachment} refuses to read `backgroundId` and that refusal is right.** Codex
   * attaches a `processId` to every PTY-backed command, foreground included, so a card that called
   * itself detached because it had one would put *"still running"* on finished commands. ⚑ **That is
   * an argument about what having a key MEANS, not about whether to keep it** — and 248 kept neither,
   * so the app has been holding a working stop key for every Codex command and rendering nothing.
   *
   * ⛔ **Measured before it was built** (`probe:command-output` §C): while a turn was blocked on
   * `sleep 300.52243`, the card carried `backgroundId=77615`, `thread/backgroundTerminals/list`
   * carried `processId: "77615"` for the same `itemId`, `terminate` answered `{terminated:true}`, the
   * OS stopped listing the process — ⚑ **and the turn went on to complete**, with an honest
   * `ok=false` receipt and the model saying so. Stopping one command really does leave the
   * conversation alone.
   *
   * ## ⚠️ Which way this fails, and what keeps it safe
   *
   * **A provider id is not unique for ever.** Codex's `processId` is a counter it recycles, and a
   * transcript row lives as long as the conversation does — so a key pressed long after its command
   * died could name somebody else's process. ⛔ **What makes that unreachable is not this field but
   * WHEN the control is offered**: only while the row is still running, and `stopOpenToolCalls`
   * marks every open row `unfinished` at each boundary that ends the thing running it (074). A
   * replayed or reopened conversation therefore has no running rows at all, and inside one live
   * session the provider cannot have recycled the number of a process that is still alive.
   *
   * Absent for every call whose provider named no key — which is every Claude call that did not
   * detach, and is a real state rather than a gap: see `claude/normalize.ts`, which sets
   * `backgroundId` only alongside `backgrounded`.
   */
  stopKey?: string
  /**
   * 🔴 **658 · a call that put THIS conversation's words into ANOTHER one** — see {@link OutgoingWords}.
   *
   * Use dedicated cards for app messaging calls rather than generic MCP rows.
   *
   * Absent on every other call, and on these two when this session was never told its tools' names
   * ({@link ToolRegistry.set} `null`): ⛔ recognition is by the name THIS session was handed, never by
   * a provider's spelling written here.
   */
  outgoing?: OutgoingWords
}

/**
 * 🔴 **658 · What one of this app's two messaging tools DID, read off the host's own row.**
 *
 * ⛔ **The arguments are the model's, and both adapters bound them at 200 characters** — a reply's
 * summary may run to 1,280. The host's row is whole: `work_replied` carries a reply's words and
 * outcome, `message_sent` a message's recipient, kind and delivery. ⚑ **So the row lands on the call
 * that produced it**, and the card draws the row.
 *
 * ⚑ **678 · and since `671` the row carries a MESSAGE's words too** — `message_sent.text`, cut at
 * `REPLY_SUMMARY_LIMIT` and `clipped` when cut. ⚠️ **This said *"`message_sent` carries none"***,
 * which was true until `671`; a row written before it still carries none, and only then does the
 * card fall back to what survived the arguments' 200-character bound (`outgoing-card.ts`).
 *
 * ⚠️ **`null` until that row arrives, and for good when the call was refused** — a refused call wrote
 * no row, and its receipt ({@link ToolItem.result}) is the whole story.
 */
export type OutgoingWords =
  | { tool: 'reply_to_parent'; reply: OutgoingReply | null }
  | { tool: 'message_agent'; sent: OutgoingMessage | null }
  | { tool: 'ask_question'; asked: OutgoingQuestion | null }
  | { tool: 'pass_question_up'; asked: OutgoingQuestion | null }
  /**
   * Read the successful give's `work_sent` event from this ledger to show its complete title and brief before the call answers. Arguments can be cut at 200 characters; the separate `work_given` belongs to the recipient's ledger.
   */
  | { tool: 'give_work'; given: OutgoingGive | null }
  /**
   * 🔴 **UI-003 · a request its sender took on for the person** (F038) — `take_on_work`. ⚑ Its
   * `work_given` (`givenBy: null`, the one row only this door writes) is written into THIS ledger
   * and lands on the call, so the card draws the whole brief the arguments cut at 200.
   */
  | { tool: 'take_on_work'; taken: OutgoingTakeOn | null }
  /**
   * 🔴 **D-047 · a piece given a new brief** — an `update_work` call that carried one. ⚑ Its
   * `work_sent` (`as: 'rebriefed'`) lands here, so the card draws the new brief whole. ⚠️ Only a
   * call whose arguments carry a `brief` is this ({@link outgoingToolOf}); every other
   * `update_work` — a status, a title, a close — stays a tool row.
   */
  | { tool: 'update_work'; rebriefed: OutgoingRebrief | null }

/**
 * 🔴 **D-047 · a new brief this conversation gave a piece**, as its own ledger keeps it — off its
 * `work_sent` (`as: 'rebriefed'`).
 */
export interface OutgoingRebrief {
  readonly piece: string
  /** `W1.2` — the label the piece is known by everywhere. */
  readonly label: string
  /** The piece's title as it stood when the new brief went. */
  readonly title: string
  /** ⚑ The whole new brief. */
  readonly brief: string
  /** The conversation holding the piece, which the new brief went to. */
  readonly to: string
}

/**
 * ⚑ **UI-003 · the piece a conversation took on for the person** — off its own `work_given`.
 */
export interface OutgoingTakeOn {
  definitionOfDone?: string
  readonly piece: string
  /** `W1.7` — the label the piece is known by everywhere. */
  readonly label: string
  readonly title: string
  /** ⚑ The whole brief, as the door kept it. */
  readonly brief: string
  /**
   * ⚑ **The newest status line its holder set on it** (`update_work`) — until the reply that
   * finishes it, whose summary is its last word (`WorkStatusSetEvent`).
   */
  status?: string
}

/**
 * 🔴 **D-047 · a piece this conversation gave, as its own ledger keeps it** — off its `work_sent`.
 */
export interface OutgoingGive {
  /** `W1.2` — the label the piece is known by everywhere, which the give's receipt begins with. */
  readonly label: string
  readonly title: string
  /** ⚑ The whole brief, as the holder was given it. */
  readonly brief: string
  /** The conversation holding the piece, which the brief went to. */
  readonly to: string
}

/**
 * Render `ask_question` and `pass_question_up` as question cards. Their `question_asked` row is written before the call answers, with `request_routed` describing the destination, so the card can show the whole question and where it went.
 */
export type QuestionTool = 'ask_question' | 'pass_question_up'

/**
 * ⚑ **UI-009 · one part of a question this conversation sent, with the rules it is answered by** —
 * `question_asked.questions[n]`, read field by field (`UserInputQuestion`'s shape).
 */
export interface OutgoingQuestionPart {
  /** ⛔ The key an answer is filed under — `''` on a row that named none, which nothing can answer. */
  readonly id: string
  /** The provider's short label for the part, when it gave one. */
  readonly header?: string
  readonly prompt: string
  readonly options: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: true
  /** ⚑ An answer off the list is taken — `raiseAQuestion` sets it wherever it offers options. */
  readonly allowOther?: true
  readonly secret?: true
}

/**
 * ⚑ **`question_asked`, as the card draws it** — plus where `request_routed` sent it and how it
 * closed. ⚑ **UI-009 · and how it was answered**, when this conversation's own ledger says so: the
 * host writes `user_decision` into the ASKER's ledger for a question this app asked, so the card
 * stops offering an answer once one was given.
 */
export interface OutgoingQuestion {
  move?: MoveOffer
  movedTo?: MoveReceipt
  /** ⛔ The app's own `req_…` id — what `request_routed` and a closing row name. Never printed. */
  requestId: string
  /**
   * The piece it is about — absent on a question passed up, which names none of this conversation's,
   * and on a question about no piece.
   */
  piece?: string
  /** That piece's label — `question_asked.label`, present beside {@link piece}. */
  label?: string
  /** ⚑ The question it carries, when it was passed up — `question_asked.passedUpFrom`. */
  passedUpFrom?: string
  /** The words, as recorded — whole. */
  prompt: string
  /** Each part, its options, and the rules it is answered by. */
  parts: readonly OutgoingQuestionPart[]
  /** ⚑ What the conversation that passed it up added, beside the words and never instead of them. */
  context?: string
  /** Where it went — `request_routed.to`; absent until that row lands. */
  to?: RequestRoutedEvent['to']
  /** ⚑ The parent it went to, as a profile — the piece's giver. Absent where this ledger cannot say. */
  toProfile?: string
  /** ⛔ The conversation that answers it — `request_routed.parent`, for the card's press; never printed. */
  toConversation?: string
  /** ⚑ How it closed without an answer — `question_withdrawn`, `question_recipient_ended`. */
  closed?: 'withdrawn' | 'recipient-ended'
  /** ⚑ **UI-009 · how it was settled** — `user_decision`, in this conversation's own ledger. */
  answered?: 'answered' | 'rejected'
  /** ⚑ Who settled it — `user_decision.by`, beside {@link answered}. */
  by?: ActedBy
  /** ⚑ **UI-009 · the host's words for an answer from this window it did not take** — still open. */
  refused?: string
  /** ⚑ **UI-009 · the host's words for an answer it closed** — kept for a next start, or over. */
  note?: string
}

/**
 * ⚑ `work_replied`, as the card draws it — plus WHO it went to, from this ledger's `work_given` and
 * the brief that gave the piece.
 */
export interface OutgoingReply {
  piece: string
  outcome: WorkRepliedEvent['outcome']
  summary: string
  /** ⚑ The resources the reply handed in, by id — possibly none. */
  resources: readonly string[]
  needsUserAction?: true
  /** The label the piece is known by — absent when its `work_given` is before the retained suffix. */
  label?: string
  /**
   * ⚑ **The conversation that GAVE the piece, as a profile** — the relayer the brief that gave it
   * named (`user_turn.relayedFromProfile`). ⚠️ Absent when that turn is before the retained suffix
   * or names no identity: the card then says *its parent* rather than a name it guessed.
   */
  toProfile?: string
  /** ⚑ That conversation's id — `work_given.givenBy` — so the card can open it. Absent with the row. */
  toConversation?: string
  /**
   * ⚑ **D-016 · commit 6 · a piece a person gave** — `work_given.givenBy` is `null`: its holder
   * took it on for the person, and the reply went to no conversation (R5). ⚠️ Absent also where
   * this ledger's `work_given` is before the retained suffix — `work_replied` names no giver — and
   * the card then reads as any reply whose give is out of view: *its parent*, and — once the call
   * answered — the receipt, which says where the reply went, never *delivered*.
   */
  toThePerson?: true
  /**
   * 🔴 **The reply was recorded and did NOT reach its parent** — `reply_undelivered.because`, one of
   * `REPLY_DELIVERIES` that `REPLY_LANDED` says landed nowhere — ⚑ or, since `729` (R89),
   * `held-then-lost`: a reply HELD for its parent (the call said `held`, or `kept` — D-030) whose
   * held message then ended unsent, a row that arrives LATER, after the call answered.
   *
   * ⛔ **Without it the card would say *delivered* over a lost reply** — `HO-021`'s *"the one failure
   * mode with no signal"*, drawn as a success. ⚠️ Absent means no such row arrived; it is read as
   * *delivered* only once the call has answered, because the host writes the call's own row before it
   * does — and a card that read *delivered* moves when the later row comes.
   */
  undelivered?: string
}

/** ⚑ `message_sent`, as the card draws it. */
export interface OutgoingMessage {
  /** ⚠️ The recipient's PROFILE — `null` when its identity row was not written yet. */
  toProfile: string | null
  /** ⛔ The recipient CONVERSATION, for the card's press — never printed: it is a `sess_` handle. */
  toConversation: string
  /** The receiver's recorded conversation label, separate from the subject piece. */
  toLabel?: string
  /** The sender's claim — `null` when a replayed row carries a word this app does not know. */
  kind: MessageSentEvent['kind'] | null
  /** ⛔ `null` when a replayed row does not say — then nothing on the card claims it was sent. */
  delivery: MessageSentEvent['delivery'] | null
  /**
   * ⚑ **678 · the words, as the host recorded them** (`671` G1) — `null` on a row written before
   * `671`, and on one whose field is not a string: the card then reads the call's arguments.
   */
  text: string | null
  /** ⛔ **`text` is the head of a longer message** — `MessageSentEvent.clipped`, never inferred. */
  clipped: boolean
  /**
   * 🔴 **688 · the piece these words name, on the SENDER's card** (`687` H2; a piece since D-016) —
   * {@link RelayedItem.opened}'s shape, read by the same function (`pieceSays`), so a card names a
   * piece one way wherever it is drawn.
   *
   * ⚑ Present when the receipt names a piece ({@link MessageSentEvent.piece}) — a follow-up always
   * does, a note may; `label` when it also carries {@link MessageSentEvent.label} as a label
   * `pieceCalled` spells. ⚠️ **Absent** for a message about no piece. ⛔ **A piece with no readable
   * label is *Piece*** — never a label guessed.
   */
  about?: { label?: string }
}

/**
 * What became of one tool call's detached work (248) — see {@link ToolItem.background}.
 *
 * Deliberately NOT a transcript item, for the reason {@link WorkflowRunCard} is not: the call that
 * started it is already on screen, and a second row for the same event is `035`'s duplicate.
 */
export interface DetachedWork {
  /**
   * The provider's own stop key — Claude's `task_id`, Codex's `processId` — or absent when the
   * receipt carried none.
   *
   * ⛔ **It is the CORRELATION between this row and the registry above the composer**, and that is
   * what it is for rather than a field kept in case. The two surfaces show one piece of work in two
   * places on purpose (§3), and without a shared key on screen a reader cannot tell whether the row
   * saying *"still running"* is the row the bar is offering to stop. `ToolEntry` renders it as
   * `data-background-id`.
   *
   * ⚠️ **The stop is NOT gated on it.** That control lives in the registry, whose own rows carry a
   * required id; gating a second affordance on this one would be the *"one at a time"* shape `094`
   * is about. Absent is still a real state — the provider named no key — and it means only that this
   * row cannot be pointed at a bar row.
   */
  id?: string
  /** Only ever set from an ending the provider reported. Absent = still running. */
  outcome?: BackgroundOutcome
  /**
   * We stopped watching before this work reported back (074's rule, applied here) — set by
   * {@link stopOpenToolCalls} at every boundary that ends the thing running it.
   *
   * ⚠️ **Deliberately NOT an outcome.** `outcome` stays absent because none arrived; this says only
   * that none ever will, which is what turns a false *"still running"* into a true *"did not
   * finish"*. Without it a conversation quit mid-command would replay, forever, claiming a dead
   * process was live — `222`'s stale indicator arriving through the store rather than through a
   * missed bookend.
   */
  unfinished?: boolean
  /**
   * The provider's own sentence about how it ended — *"Background command … completed (exit code
   * 0)"*. Rendered in the card's body beside the receipt, so the row that said it LEFT also says
   * what became of it.
   */
  summary?: string
  /**
   * Where the work wrote its output.
   *
   * ⛔ **Nothing opens it, and that is named rather than implied.** `WorkflowRunCard` carries the
   * same field WITH an affordance behind it (`readWorkflowOutput` over IPC, an overlay in the pane);
   * background work has no such read, so writing one is a dispatch of its own rather than a line
   * here. It is kept because it is the provider's own fact about this row — a reader who opens the
   * Events tab can follow it today — and because the alternative is re-deriving it from a ledger
   * later. ⚠️ The doc it replaced said *"opened on request"*, which was `107` §4's rule quoted about
   * a control that does not exist.
   */
  outputFile?: string
  /**
   * When the ending landed, so the row can say how long the WORK took rather than how long the
   * detachment took.
   *
   * ⛔ Without this the card would print the receipt's duration — `1.2 s` for a command that ran for
   * half a minute — which is a smaller version of the same lie this whole task is about.
   */
  endedAt?: number
}

/**
 * **What is still running in this conversation, as the provider last stated the LEVEL** (248).
 *
 * ⛔ **REPLACE, never merge, and absent is not empty.** `247` carried the SDK's own instruction into
 * the event: *"consumers … should replace their set with each payload rather than pairing edges, so
 * a missed bookend cannot wedge a stale running indicator"*, and `[]` is the provider saying nothing
 * is running — the fact that clears this — while an event with no `running` at all did not state the
 * level and must change nothing. `222` is what a stale indicator costs.
 *
 * ## 🔴 Each row carries the COMMAND it is running (251 §2) — resolved once, and carried
 *
 * ⛔ **Not on the wire, and deliberately not added to it**: the `tool_call` that started the work
 * carries it and `toolCallId` is the join, so this is a read rather than a new fact. ⚠️ **Resolved
 * into the row rather than looked up when the bar renders**, because the registry outlives the items
 * — `carryForward` copies it across a slab release and carries no items — so a render-time join
 * would fall back to the description on a row that had not changed. ⚑ Which is also why
 * {@link withCommand} falls back to the PREVIOUS registry's answer: REPLACE governs *which work is
 * running*, and a row absent from the new payload stays gone.
 *
 * ⚑ **D-017 · R11 — the row is `shared/agent-state.ts`'s `BackgroundRow`**, which `main` fills the
 * same way from the same join, so an agent's *"running in the background · <command>"* is one
 * string in a tool's answer and on this window's plate.
 */
export interface BackgroundRegistry {
  /** Every piece of live background work after the last frame that stated the level. */
  running: BackgroundRow[]
  /**
   * ⚠️ **Rows the provider sent that the last level event did not carry** — past the cap, or with no
   * id at all. Non-zero means this list is UNDERSTATING what is running, and `247` §3 requires it
   * said out loud: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link running}, because it describes that level and no other. An event
   * carrying only an ending leaves both alone.
   */
  dropped: number
}

/**
 * **What this conversation has promised to do LATER, as the provider last stated the LEVEL** (258,
 * from `253`'s event).
 *
 * ⛔ **The same REPLACE rule as {@link BackgroundRegistry}, and the same absent-is-not-empty line.**
 * `jobs` absent is *"this frame did not state the level"* and must leave the screen alone; `jobs: []`
 * is *"the provider says nothing is scheduled"* and is the only thing that clears the list.
 * Conflating them cost `222` a whole dispatch, and here the cost is sharper than a stale indicator:
 * a level that arrives with only an ending would erase a job that really is still going to fire.
 *
 * ⚠️ **Two REGISTRIES rather than one, and they are not two readings of one fact** (`253`, which
 * measured the difference rather than assuming it). `background_work` says what is running NOW; this
 * says what will run LATER. A cron produced **0** of the five `task_*` frames a backgrounded `Bash`
 * produced one row later in the same capture, and the SDK's own `BackgroundTaskSummary.type` labels
 * (`shell | subagent | monitor | workflow`) have no scheduled member. Merging them would put a
 * Stop button on a row nothing can stop and a *"still running"* word on work that is not.
 */
/**
 * **What the running agent will answer to, as the provider last stated it** (279).
 *
 * ⛔ **`set: null` is not `set: {commands: []}`, and this is the registry where that distinction is
 * finally visible to a person.** `279` §2: *"A session that has not started has no provider
 * commands. Say so; do not show an empty section as though the agent had none."*
 *
 *  - **`null`** — nobody has told us. A session that has not started; a session whose provider read
 *    failed; a recorded conversation being read back. The band is ABSENT and a sentence says why.
 *  - **`{commands: []}`** — the provider answered, and the answer is that this agent has none. The
 *    band may say so.
 *
 * ⚠️ **The event cannot express the first**, deliberately: `provider_commands.commands` is required,
 * so *"we were not told"* is the absence of the event rather than a field inside one. That is what
 * makes `null` unforgeable here — no adapter can publish it by accident.
 */
export interface CommandRegistry {
  /** The list and its prefix, together, as one frame stated them — or `null` if none has. */
  set: ProviderCommandSet | null
  /**
   * ⚠️ **Rows the provider named that the last level event did not carry** — past the cap, or with
   * no usable name. Non-zero means this list is UNDERSTATING what the agent has, and `247` §3's rule
   * applies unchanged: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link set}, because it describes that list and no other.
   */
  dropped: number
}

/**
 * 🔴 **The tools this conversation has, as the last frame stated them** (358).
 *
 * ⛔ **THREE states, not two, and every one of them renders differently.** `279` needed
 * `null ≠ []`; this needs one more, because Codex will never publish an inventory and *"the
 * provider does not report one"* is permanently different from *"nobody has told us yet"*:
 *
 *  - **`set: null`** — nobody has told us. A session that has not started, one whose adapter
 *    published nothing, or a recorded conversation whose ledger holds no inventory up to the page
 *    being read (D-035: a page brings the one in force where it begins). ⛔ It must NOT read as a
 *    conversation with no tools.
 *  - **`set.published === null`** — the provider does not publish an inventory. BroBot's own
 *    declaration is known and may be shown as OFFERED; nothing here is confirmation, and the
 *    surface says which provider this is and why.
 *  - **`set.published !== null`** — the child stated its own inventory. Offered and confirmed can
 *    be told apart, and a tool BroBot declared that the child did not list is visible as exactly
 *    that.
 *
 * ⚠️ **The event cannot express the first**, deliberately: `tool_inventory.published` is required
 * and nullable, so *"we were not told"* is the absence of the event rather than a field inside one.
 * That is what makes `null` unforgeable here — no adapter can publish it by accident.
 */
export interface ToolRegistry {
  /** The last whole statement — both halves, as one frame made them — or `null` if none has. */
  set: ToolInventorySet | null
  /**
   * ⚠️ **Rows the last frame named that it did not carry** — past a cap, or with no usable name.
   * Non-zero means this inventory is UNDERSTATING what the conversation has, and `247` §3's rule
   * applies unchanged: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link set}, because it describes that statement and no other.
   */
  dropped: number
  /**
   * 🔴 **WHEN this statement was made, epoch ms** (444, `444` relay 1). Null when nothing has
   * reported, or when the fold had no clock — worded on {@link ContextMeter.at}, which is the
   * sibling arm this copies.
   *
   * ⛔ **A count with no moment is a count a person cannot read.** A conversation started before
   * `441` showed **15** tools and a new one showed **16**; both numbers were true, and nothing on
   * any surface said which instant either was true AT. ⚑ `agentToolsFor` runs at
   * `startSessionInProfile` and at `reopenSession` and nowhere else, so a live conversation keeps
   * the set it was built with until it is reopened — and the two answers differ for exactly that
   * long.
   *
   * ⚠️ **Required, not optional, and that is the point.** `transcript-window.ts`'s `carryForward`
   * builds this registry FIELD BY FIELD by hand — its own docblock says *"nothing in the
   * typechecker would have said this field was missing"* — so an optional moment would be dropped
   * at the first window release with no compile error and no red test.
   *
   * ⛔ **It is not the moment we ASKED, and not necessarily a launch.** Claude publishes on every
   * `system/init` and an identical re-publish writes no row at all (its `lastInventory` dedup), so
   * this is when the ANSWER last moved — which is usually a launch and is not only a launch.
   */
  at: number | null
}

/**
 * One whole statement about one moment: what was offered, and what the child said it has.
 *
 * ⛔ **They travel together for `provider_commands`' reason, applied to two fields instead of
 * three**: a consumer that took `declared` from this frame and `published` from the last would be
 * reporting a disagreement that never existed.
 */
export interface ToolInventorySet {
  /**
   * ⛔ **How this provider spells a server's tool.** Carried so nothing downstream has to recognise
   * a provider to read a name — `039`, enforced by `provider-neutrality.test.ts`.
   */
  naming: ToolNaming
  /** What BroBot handed this session — offered, never proof. */
  declared: DeclaredToolset | null
  /** What the child published about itself. `null` ⇒ this provider publishes none, ever. */
  published: PublishedInventory | null
}

export interface ScheduleRegistry {
  /**
   * Every job its provider listed in the last frame that stated the level — each with the moment
   * this fold first saw it listed ({@link ScheduledRow.listedSince}), which is what lets the one
   * state tell a one-shot's time from one that has passed. ⚠️ Not every job that will wake this
   * conversation: once it stops, the host starts it only for the jobs its provider will bring back
   * (D-029), and a view drawn from its ledger wears the host's word.
   *
   * ⛔ **Not swept at a session boundary**, as `stopDetachedWork` sweeps the registry above: `253`
   * measured a resumed session reporting the same job back on a `Stop` at 4 336 ms — *before its own
   * first prompt at 4 526 ms* — and ⚑ D-029 this app starts a stopped conversation in time for its
   * jobs, so a stop leaves its schedule its schedule.
   */
  jobs: ScheduledRow[]
  /**
   * ⚠️ **Rows the provider sent that the last level event did not carry** — past the 100 cap, or
   * with no id at all. Non-zero means this list is UNDERSTATING what is scheduled, and `247` §3's
   * rule applies unchanged: *"a registry that quietly undercounts is worse than none."*
   *
   * Replaced together with {@link jobs}, because it describes that level and no other.
   */
  dropped: number
  /**
   * ⚑ **F035 — the rows the last level took off, with their first listing**, so a job put back by
   * the level after keeps its moment. ⚠️ The host takes a one-shot whose minute had come off its own
   * level as the turn it began starts, and the provider's restated level puts it back when it had
   * not fired: listed again from that row's moment, a one-shot whose minute has passed would be
   * promised a year away. One level back only, which is the drop and its correction.
   */
  left: ScheduledRow[]
}

/**
 * One dynamic workflow, folded from its frames (108, designed in 107).
 *
 * ⚠️ **Not a transcript item, for the same reason {@link SubAgentCard} is not**, and with a sharper
 * consequence: the reproduction run sent **12 frames** and a 22-agent run would send far more. If
 * each were an item, asking for a workflow would bury the conversation under its own progress bar —
 * 078's *"without turning every usage update into a transcript row"*, which is the rule this whole
 * surface is built to keep.
 *
 * It belongs to the `Workflow` tool call that launched it, bound by `toolUseId`, and is mutated in
 * place by every later frame.
 */
export interface WorkflowRunCard {
  /** `task_id` — the correlation key across all four subtypes. */
  taskId: string
  /** The launching tool-use id, kept so an orphan can be adopted later (029's precedent). */
  toolUseId?: string
  /** The workflow's own name, from `task_started`. */
  name?: string
  /** What the run was asked to do. */
  description?: string
  phases: WorkflowPhase[]
  agents: WorkflowAgent[]
  /** Run-level totals, replaced wholesale on each frame — they are a statement about now. */
  usage?: { tokens?: number; toolCalls?: number; ms?: number }
  /** True until an ending arrives, or until the thing running it goes away. */
  running: boolean
  /** Only ever set from an ending the provider reported. Absent = still running. */
  outcome?: 'completed' | 'failed' | 'unknown'
  /** Where the run wrote its answer (107 §4). Opened on request, never inlined. */
  outputFile?: string
  /**
   * We stopped watching before this run reported back (074's rule, applied here). Deliberately NOT
   * an outcome: `outcome` stays absent because none arrived, and this says only that none ever will.
   */
  unfinished?: boolean
  /** Agents the provider named past the cap, so the tree can say so rather than look complete. */
  droppedAgents?: number
}

/**
 * One sub-agent the main agent dispatched (029) — what it is, what it is doing, and how it ended.
 *
 * It is NOT a transcript item. It belongs to the tool call that dispatched it, so it lives on that
 * {@link ToolItem} and is bound by `parentToolCallId` — never by being the most recent thing on
 * screen. `tools` is the child's OWN tool activity, which Claude forwards into the parent stream by
 * default; collecting it here is what turns a heartbeat counter into a nested transcript, without
 * enabling `forwardSubagentText`.
 */
export interface SubAgentCard {
  agentId: string
  /**
   * What kind of thing `agentId` IS (111), as the adapter stated it on the wire — a dispatch inside
   * the parent's process (`task`), or a real thread with a file of its own (`thread`).
   *
   * ⚠️ **Read, never derived.** The renderer may not recognise a provider (039), and this is the
   * fact that actually differs — see `subAgentEventSchema.idKind`.
   */
  idKind?: 'task' | 'thread'
  /** The dispatching tool-use id — the binding, kept so an orphan can be adopted later. */
  parentToolCallId?: string
  /**
   * How this agent became known (135) — see `subAgentEventSchema.origin`.
   *
   * ⚠️ **`observed` is the only value that changes what the card says, and the distinction it draws
   * is not "no `parentToolCallId`".** A Claude `task_updated` also arrives without one, and it is a
   * child whose dispatch we simply have not been told yet — `rehome` adopts it the moment we are.
   * An `observed` card is one nothing will ever adopt: its dispatch happened on another connection,
   * so its parent is unknown rather than pending, and the head must say so instead of showing a
   * nameless peer of the child that actually spawned it.
   */
  origin?: 'announced' | 'observed'
  kind?: string
  title?: string
  lastTool?: string
  usage?: { tokens?: number; toolCalls?: number; ms?: number }
  /** True until an ending arrives, or until the turn ends without one. */
  running: boolean
  /** Only ever set from an outcome the provider reported. Absent = "we were not told". */
  outcome?: 'completed' | 'failed' | 'interrupted'
  summary?: string
  /**
   * What the child DID and what it SAID, in the one order it arrived in (128).
   *
   * ⚠️ **One list, because 058's rule is about a single sequence.** `044` P3 shipped tools and text
   * in two collections and reassembled them for display, and the reassembly put a tool in front of
   * the text that preceded it. Two arrays merged at render is that same shape: an order held in two
   * places is an order that can disagree with itself. Here the sequence IS the storage, so a prose
   * run between two calls cannot be anywhere but between them.
   */
  body: SubAgentBodyRow[]
}

/** One of the child's own tool calls, as it appears in {@link SubAgentCard.body}. */
export interface SubAgentToolRow {
  kind: 'tool'
  callId: string
  name: string
  summary: string
  result?: { summary: string; ok: boolean }
  /** As {@link ToolItem.unfinished}, for the child's own rows. */
  unfinished?: boolean
  /**
   * As {@link ToolItem.background}, for the child's own rows (248).
   *
   * ⚑ **Not defensive.** `248` §5's probe measured a dispatched sub-agent running a `Bash` of its
   * own, and nothing stops that child asking for `run_in_background` — the same field, the same
   * receipt, one level down. A card row that stayed green while its command ran on would be the
   * defect this task exists to end, moved somewhere harder to see.
   */
  background?: DetachedWork
  /**
   * The agents THIS call dispatched (035) — an agent's agent, nested under the call that made it
   * rather than stranded at top level. Absent for the overwhelming majority of calls, which
   * dispatch nothing; a card is only ever added here by {@link placeCard} or {@link rehome}.
   */
  subAgents?: SubAgentCard[]
}

/**
 * A run of the child's own words, forwarded into the parent stream and owned by its card (128).
 *
 * ⛔ **A run, not a message, and never merged with its neighbours.** The adapter already flushes a
 * text run whenever a tool interrupts it (058), so two runs on a card are two things the child said
 * with work in between. Concatenating them here would undo the ordering the wire took care to keep.
 */
export interface SubAgentProse {
  kind: 'prose'
  id: string
  text: string
}

export type SubAgentBodyRow = SubAgentToolRow | SubAgentProse

/**
 * A sub-agent whose dispatching tool row is not on screen (029) — an out-of-order `task_started`,
 * or a provider that reports a sub-agent without naming its parent. It renders at top level rather
 * than being dropped, and is ADOPTED into the tool row if that row arrives later, which is what
 * makes the nesting a binding on `parentToolCallId` rather than on arrival order.
 */
export interface SubAgentItem {
  kind: 'subAgent'
  id: string
  card: SubAgentCard
}

/**
 * The agent's working checklist (028) — one item that updates IN PLACE for as long as the turn
 * runs, because it is the plan as it stands now and not a log of every revision it went through.
 *
 * `steps` is always the COMPLETE list: both adapters state it wholesale (the Claude one keeps the
 * running list itself, since its todo tools are incremental), so the fold replaces and never merges.
 */
export interface PlanItem {
  kind: 'plan'
  id: string
  steps: { text: string; status: 'pending' | 'active' | 'done' }[]
  /** Codex's `explanation` — a sentence about the plan, not a step in it. */
  note?: string
  /** A plan DOCUMENT. Unpopulated until 030 fills it from plan mode. */
  body?: string
}

export interface PermissionItem {
  kind: 'permission'
  id: string
  request: PermissionRequestEvent
  /** The decision this app sent, or null while the agent is still frozen on it. */
  outcome: PermissionOutcome | null
  /** Why it stopped being actionable without a decision (teardown), or why answering failed. */
  note: string | null
  /** {@link UserInputItem.refused} — the same field, for the same reason. */
  refused: string | null
  /**
   * 🔴 **Who answered it** (503) — {@link UserDecisionEvent.by}, carried off the row that set
   * {@link outcome} and off nothing else.
   *
   * ⛔ **OPTIONAL for one reason only: the row was written before this app recorded who** (HO-029
   * §2.2). ⚠️ It is NOT *an actor we failed to write* — every writer has written it since `477` —
   * and nothing backfills.
   *
   * ⚑ **Read only where {@link outcome} is non-null.** A card settled by a teardown has no
   * decision, so it has no answerer and no ledger gap either; see {@link whoAnsweredIt}.
   */
  by?: ActedBy
  /**
   * ⚑ **D-017 · R19 — this app routed the request** (`request_routed`): to the parent, which
   * answers it, or to a person's queue, which the host's own read lists. ⛔ So *Waiting on you*
   * never counts this card: it is listed there from the host's read or not at all. ⚠️ Optional,
   * because a card nothing routed — one in a conversation no agent started — carries no such row.
   */
  routed?: true
  /**
   * ⚑ **D-017 · R19 — the conversation this app routed it to, which owes its answer** — the row's
   * `parent`, on a card routed to the parent or to an agent it named, and absent on one routed to a
   * person. ⚑ While it waits, this conversation is *waiting on that one's answer*, never *needs you*
   * ({@link TranscriptState.routedAway}); a person may still answer it here.
   */
  routedTo?: string
}

/**
 * ⚑ **D-017 · R19 — the waiting cards this app routed to another conversation**
 * ({@link TranscriptState.routedAway}): how many of each, and the conversation owing the first of
 * them's answer.
 */
export interface RoutedAway {
  permissions: number
  questions: number
  to: string
}

export interface UserInputItem {
  kind: 'userInput'
  id: string
  request: UserInputRequestEvent
  answered: 'answered' | 'rejected' | null
  note: string | null
  /** {@link PermissionItem.by} — the same field, off the same row, for the same reason. */
  by?: ActedBy
  /** {@link PermissionItem.routed} — the same field, off the same row, for the same reason. */
  routed?: true
  /** {@link PermissionItem.routedTo} — the same field, off the same row, for the same reason. */
  routedTo?: string
  /**
   * Why the LAST attempt to answer did not land, on a card that is **still waiting** (146).
   *
   * ⛔ **A second field rather than a second meaning for `note`, because they are opposites.** A
   * note is an ending — teardown settled this card, the provider withdrew it, the host refused a
   * response for a request that has gone — and {@link isAwaitingAnswer} reads it as one. That is
   * exactly what killed a live card: the adapters refuse an unusable answer BEFORE it takes the
   * broker slot, so nothing is written and the question is still on screen, and writing a note
   * about it removed Answer, removed Reject, dropped the card from the waiting panel and unfroze
   * the composer while the provider went on waiting (145 HIGH 1).
   *
   * So this says the other thing: the gesture bounced, the sentence explains why, **and the card is
   * unchanged**. ⛔ **It is copy and not state**: {@link isAwaitingAnswer} ignores it, nothing
   * branches on it, and a card carrying one is exactly as answerable as a card carrying none.
   *
   * ⚠️ **It used to say *"nothing derived reads it"* and `468` made that false** — the sentence
   * survived the change that killed it, which is `458`'s subject. `attentionQueue` now carries it
   * onto {@link AttentionRequest.refused} so the person's own queue can draw the same sentence the
   * card does, from this one field. ⚑ **Still copy**: the projection renders it and decides
   * nothing with it.
   */
  refused: string | null
}

/**
 * The model's reasoning (027). One item per reasoning block, growing while it streams.
 *
 * Usually there are no WORDS: Claude reports a token estimate and never the text, and Codex only
 * sends a summary when the turn asked for one. `redacted` is what lets the UI say "it thought, and
 * we cannot show you what" instead of rendering an empty box — the same rule as `…` vs `n/a`.
 */
export interface ThinkingItem {
  kind: 'thinking'
  id: string
  /** The reasoning text so far. Empty is the normal case, not a failure. */
  text: string
  /** True when the provider told us it thought but withheld the words. */
  redacted: boolean
  /** Reasoning tokens, when counted. Claude's is an estimate. */
  tokens?: number
  /** True while the block is still growing. */
  streaming: boolean
}

export interface NoticeItem {
  kind: 'notice'
  id: string
  level: 'info' | 'warn' | 'error'
  /**
   * The sentence. ⚠️ **On a {@link lostReply} notice it is that sentence with NO roster** — the
   * parent under its slug — for a reader that has none (`readable-export.ts`); ⚑ the transcript
   * draws the same function WITH the roster, so the two differ only in which name the parent has.
   */
  text: string
  /**
   * 🔴 **667 · a reply that reached nobody, as facts** — see `lib/lost-reply.ts`. ⛔ Facts and not
   * the sentence, because the parent is named through a roster that lands after the ledger.
   */
  lostReply?: LostReply
  /**
   * 🔴 **F035 · the line naming the scheduled job that woke a turn its provider began** — `info`,
   * and shown in both modes all the same: it says what the turn acts on, which is content, as a
   * `continuation` is, and not lifecycle chrome like the plain *"turn started by Claude itself"*.
   */
  wokenByAJob?: true
  /**
   * 🔴 **712 · R41 — an agent's ask about an identity's own rules, as facts** — see
   * `lib/instruction-asked.ts`; ⚠️ {@link text} is then that sentence with NO roster, as for
   * {@link lostReply}.
   */
  instructionAsked?: InstructionAsked
  /** The MCP server request this line is about, so its ending can rewrite it. */
  mcpServerRequest?: { readonly requestId: string; readonly name: string; readonly url: string }
  /**
   * 🔴 **672 · the PROVIDER's own words, not a sentence this app wrote** — a turn's failure detail
   * or an error's message after {@link providerErrorSentence}. ⛔ Nothing bounds it on the way in
   * (`provider-error.ts`: *"a provider could hand the fold a megabyte"*), so where an app sentence
   * wraps whole, this one is clamped to a few lines with the whole of it on the title — `672`'s
   * review measured a 25,889-character warning drawn 2,118 px tall once warnings wrapped.
   */
  providersWords?: true
  /**
   * 🔴 **685 · what the refused call was TOLD, off its own receipt** (`675` F-d) — the row's
   * sentence after `refused (<rail>): `, with every `sess_` handle read aloud.
   *
   * ⛔ **Not on the `tool_refused` row and not composed here**: that row carries the rail and no
   * sentence by design (`ToolRefusedEvent`), and the words are the ones the model was handed —
   * `675` put the act inside the receipt's first 200 characters. ⚑ Joined by {@link tellItsRefusal}
   * to exactly one receipt of the same tool whose words begin with this rail's prefix, or not at
   * all: a row written before `675` (a Claude receipt was JSON) and two refusals of one tool on one
   * rail in flight both leave it absent, which says nothing rather than something wrong.
   *
   * ⚠️ **Its own field, never folded into {@link text}**: `text` is the app's sentence in the
   * third person (`REMEDY_SAID`'s register), and this is a quotation of what the model was told.
   *
   * ⛔ **The normalizer's cut mark is NOT inside it** (`685`'s review): a receipt cut at the row's
   * bound ends in `…` (Claude) or `… (200 of N characters)` (Codex), and neither was said to the
   * model. ⚑ The mark is removed here and {@link toldInPart} says the words are the first part.
   */
  told?: string
  /** ⚑ **685 · the receipt was cut at the row's bound**, so {@link told} is its first part. */
  toldInPart?: true
  /**
   * 🔴 **730 · R83 — a Stop the provider has not answered, as facts** — see `lib/stop-unanswered.ts`.
   * ⚠️ {@link text} is then that sentence with the provider unnamed (*the provider*), for a reader
   * that does not know it (`readable-export.ts`); ⚑ the transcript draws the same function WITH the
   * pane's provider, `lostReply`'s split over a different missing fact.
   */
  stopUnanswered?: StopUnanswered
  /**
   * 🔴 **737 · `734` F-2, `732` F-4 — an ask to stop, as facts** — who asked, and since `732` which
   * agent (`agentProfile`). ⚠️ {@link text} is then the sentence with the asker's CATEGORY
   * (*"asked to stop by an agent"*) — never the `sess_…` handle it printed before `737` — for a
   * reader with no roster (`readable-export.ts`); ⚑ the transcript draws the same function WITH the
   * roster and names the agent (`askedToStopSays`), {@link stopUnanswered}'s split over the other
   * missing fact.
   */
  askedToStop?: AskedToStop
}

/**
 * **Everything above this line is no longer in the model's head** (087, designed in 086).
 *
 * The one durable fact a compaction leaves behind, drawn where it happened. It is deliberately NOT a
 * {@link NoticeItem}: notices at `info` are dropped by the reading view (`transcript-mode.ts`), and
 * this is the opposite of chatter — it is the reason the agent will not remember what you told it an
 * hour ago, and a reader who cannot see it has no way to explain the amnesia. So it is its own kind
 * and it is exempt from the toggle.
 *
 * ⚠️ **Every magnitude is optional and a missing one is drawn as missing.** Codex reports none at
 * all; Claude reports `before` and sometimes `after`. The row says what it was told and no more.
 *
 * `compactionId` is the provider's identity for it, and it is what stops one compaction becoming two
 * rows — Codex announces its item on both `item/started` and `item/completed`.
 */
export interface CompactionItem {
  kind: 'compaction'
  id: string
  compactionId?: string
  before?: number
  after?: number
  trigger?: 'manual' | 'auto'
  /** The provider's own signal name, shown verbatim so the row cites its source. */
  source: string
}

/**
 * **The provider is no longer in the conversation above this line** (199, from 192 H5).
 *
 * A reset is a compaction's harsher sibling and it is drawn like one, for the reason spelled out on
 * {@link CompactionItem}: a compaction SUMMARIZED the earlier turns, and a reset dropped them
 * outright and opened a new provider conversation to carry on in. A reader who cannot see it has no
 * way to explain why the agent has forgotten everything rather than merely most things.
 *
 * ⛔ **Emphatically NOT a {@link NoticeItem}.** `session started · <id>` is already an `info` notice
 * and the reading view drops those — which is exactly how a reset that moves the session's identity
 * would have gone past a reader as one more line of chrome they never see.
 *
 * {@link sessionId} is the conversation the provider MOVED TO — the one a resume will reopen, and
 * the only fact on this row that a reader could ever need to cross-check against the session header
 * or an exported file.
 */
export interface ResetItem {
  kind: 'reset'
  id: string
  /** The provider's id for the conversation this session is on FROM here. */
  sessionId: string
  /** The provider's own signal name, shown verbatim so the row cites its source. */
  source: string
}

/**
 * A picture the agent made, in the conversation where it made it (067).
 *
 * ⚠️ **`path` may be absent, and that is a state to render, not an error to hide.** The runtime
 * sets it only after confirming a real, regular image file — wherever it is, since `726` · R92.
 * Codex's image-generation skill tells the model to move that file into the workspace for project
 * work, so an image whose file has legitimately walked away is an ordinary outcome. The entry says
 * the image was made and that its file is gone — which is more than the chatter line it replaces
 * ever said.
 */
export interface ImageItem {
  kind: 'image'
  id: string
  /** The provider's id for the image — the only stable handle when there is no file. */
  imageId: string
  /** Absolute path on disk, already checked by the runtime. Absent when no file was found. */
  path?: string
  /** What it was generated from. The caption, and the `alt` text. */
  prompt?: string
}

export interface UnknownItem {
  kind: 'unknown'
  id: string
  provider: string
  /**
   * The NEUTRAL classification from the runtime (049). The renderer switches on this alone —
   * never on Codex/Claude specifics — so recognized chatter renders quietly while a genuinely
   * `unrecognized` payload stays a prominent card.
   */
  category: UnknownCategory
  /**
   * The provider's own kind string, stamped by the adapter (072) — `thread/compacted`,
   * `thinking_delta`. Opaque here: the renderer displays it and never interprets it, which is what
   * keeps this layer provider-agnostic. Absent when the adapter had nothing meaningful to name.
   */
  label?: string
  raw: unknown
}

/**
 * When the thing an item represents happened, epoch ms — stamped from the envelope's `at` rather
 * than read from a clock here, so a replayed conversation shows the times it originally had.
 *
 * Optional because an item can be built without one: the fold is a pure function over events and
 * a caller that has no time to give (a test, a synthetic entry) should not be forced to invent
 * one. An item that keeps growing — an assistant block taking deltas — keeps the time it started.
 */
interface Timed {
  at?: number
}

/**
 * WHICH ledger event built this row — the envelope's `ordinal`, stamped for the same reason and in
 * the same place {@link Timed.at} is (299 §2, findings 4 and 5).
 *
 * ⛔ **The one identifier of a row that survives a RE-FOLD.** `item.id` is a per-fold counter, so a
 * prepend renumbers every row on screen — `assistant_1` becomes `assistant_1901` — and any surface
 * that remembered a row across a page-back was pointing at a different one. An ordinal is the
 * ledger's own number for the event, and the ledger does not renumber.
 *
 * ⚑ **What it made possible**, both in one dispatch: the transcript can find the row a reader was
 * looking at after a page has been inserted above it (`useOlderHistory`), and the change log can
 * tell which of its reports were built from events a window release has thrown away
 * (`carryForward`). Both used to be answered with arithmetic on heights and lengths that a
 * simultaneous release made wrong.
 *
 * Optional for the reason `at` is: the fold is a pure function over events and a caller with no
 * ordinal to give — a test, a synthetic entry, the read-only child viewer — should not have to
 * invent one. An item that keeps growing keeps the ordinal it started with.
 */
interface Placed {
  ordinal?: number
}

/**
 * 🔴 **A note appeared in this profile's memory store while this turn ran** (318 §2.1, friction F5).
 *
 * ⛔ **NOT a {@link ToolItem}, and the difference is the whole point.** A tool row says *the provider
 * reported this call*; nothing reported this. 316 measured fifteen config arms and found no event of
 * any kind for a memory write, so what the app has is a directory listing taken at each end of the
 * turn. Drawing that as a tool call would be inventing a wire fact, which is 009's rule and the
 * defect 305 was dispatched for.
 *
 * ⛔ **And NOT a {@link NoticeItem}**, for the reason {@link CompactionItem} and {@link ResetItem}
 * each record above: the reading view drops `info` notices, and this is the one row in the
 * conversation that answers *"you said you would remember that — where did it go?"*. A reader who
 * cannot see it is the reader who filed F4.
 *
 * ⚠️ **`notes` is never empty ON THIS ITEM**, and the fold is what makes that true rather than the
 * host: the host publishes no event for nothing, and the REPLAY path can still hand the fold a row
 * whose entries were all filtered away by the stored-event bound. `dropped` counts the notes past
 * the cap — on the way in AND on the way out — so a turn that wrote thirty cannot show twenty and
 * read as complete.
 */
export interface MemoryNoteItem {
  kind: 'memoryNote'
  id: string
  notes: MemoryNoteSeen[]
  /** Notes past the per-event cap. Absent or 0 normally, and the row says so when it is not. */
  dropped?: number
}

/**
 * 🔴 **The agent said it read these out of its memory** (319 §1, friction log F5).
 *
 * ⛔ **The OTHER half of {@link MemoryNoteItem}, and 319 §1.4 is the rule that keeps them apart.**
 * That row is *the agent wrote this* — a directory listing BroBot took itself, app-authored, and
 * carefully worded as *"seen on disk … not reported as a tool call"*. This row is *the agent read
 * this* — reported by the provider, on the message item, parsed by the app-server out of the model's
 * own citation block. ⚠️ **Two different sources of truth for two different acts**, and the reason
 * 318 was so careful about its own wording is precisely so this one can say something stronger.
 *
 * ⛔ **Still not a {@link ToolItem}.** What the provider structured is the model's CLAIM about what
 * it used; nothing watched a file being read. *"The agent cited"* is the strongest true verb, and
 * `009`'s rule — a disclosure must not say we saw what we were only told — is why it is not *"read"*.
 *
 * ⚑ **And it renders in BOTH modes**, for {@link MemoryNoteItem}'s reason: F5 is a person saying he
 * cannot see this happen, and a row only visible in debug mode is a row he would not have seen.
 */
export interface MemoryRecallItem {
  kind: 'memoryRecall'
  id: string
  /** The cited files, in the model's own order of importance. Never empty — see the fold. */
  entries: MemoryRecallEntry[]
  /** Entries the citation named that this row does not hold. Absent or 0 normally. */
  dropped?: number
  /**
   * ⚠️ **Carried to the row and drawn only as a COUNT** — 319 §1.2. These are ids of earlier Codex
   * sessions the model transcribed out of its own memory files; the provider calls the list *"for us
   * to track"* while calling the entries *"for rendering"*, and nothing in this app can resolve one
   * into a conversation a person would recognise. ⛔ Printing a raw UUID would be `106`: a thing on
   * screen that looks like a handle and that nothing can open.
   */
  threadIds?: string[]
  /** Ids past the wire cap, so a count on screen can never quietly understate. */
  threadsDropped?: number
}

/**
 * 🔴 **This conversation opened with the profile's memory index in the prompt** (332, friction F15).
 *
 * Distinguish memory loaded before the first turn from {@link MemoryNoteItem} writes and {@link MemoryRecallItem} citations during turns. An answer can come from the injected index without a read, tool call or citation; this row makes that launch source visible.
 *
 * ⚠️ **It is not a {@link NoticeItem}**, for {@link MemoryNoteItem}'s reason: the reading view drops
 * `info` notices, and a row only a debug toggle reveals is a row the person who filed this would
 * still not see.
 *
 * ⛔ **`index` is never empty ON THIS ITEM**, and the fold is what makes that true: the host
 * publishes nothing when nothing reaches the prompt, and the replay path can still hand the fold a
 * row whose path did not survive the stored-event bound.
 */
export interface MemoryLoadedItem {
  kind: 'memoryLoaded'
  id: string
  /** The index file that is in the prompt, absolute — which store, and pasteable. */
  index: string
  /** Memories on disk beside it. `0` draws no clause — see the component. */
  beside: number
}

export type TranscriptItem = (
  | UserItem
  | ContinuationItem
  | AppNoticeItem
  | WorkReportItem
  | RelayedItem
  | QueuedItem
  | AssistantItem
  | ToolItem
  | PermissionItem
  | UserInputItem
  | ThinkingItem
  | PlanItem
  | SubAgentItem
  | NoticeItem
  | CompactionItem
  | ResetItem
  | ImageItem
  | MemoryNoteItem
  | MemoryRecallItem
  | MemoryLoadedItem
  | UnknownItem
) &
  Timed &
  Placed

/**
 * What the context meter knows right now — a statement about the present, replaced wholesale.
 *
 * Deliberately NOT an item, for the same reason `activity` is not one (027): 078's whole point is
 * that a live gauge must absorb the usage stream instead of turning it into transcript rows. Codex
 * emits one of these per turn and Claude two per assistant message; as items they would bury the
 * conversation, and as a single replaced value they cost nothing.
 *
 * ⚠️ **`reading` is never null — it starts at `{kind:'unknown'}`.** A fresh conversation, a resumed
 * one that has not spoken and an imported read-only session all sit there, and the surface renders
 * *"no reading yet"* from a real value rather than from a null check that would tempt someone into
 * rendering a zero.
 */
export interface ContextMeter {
  reading: ContextReading
  /** The provider's own signal name it was read from. Null exactly while nothing has reported. */
  source: string | null
  /** When it was read, epoch ms. Null when nothing has reported, or when the fold had no clock. */
  at: number | null
}

/** One provider report of file changes, kept as it arrived (096). */
export interface ChangeReport {
  /** A monotonic id, so a row can point at the report holding its diff without holding the text. */
  id: string
  changes: FileChange[]
  /** Files the report named beyond the cap — surfaced, never swallowed. */
  dropped: number
  /** The provider's own signal name: `turn/diff/updated`, `Edit`, `Write`. */
  source: string
  /** Which turn it landed in, counting from 1. The pane's This turn / Whole conversation axis. */
  turn: number
  /** True once this report's diff bodies were released — see {@link MAX_HELD_DIFF_REPORTS}. */
  released: boolean
  /**
   * WHICH ledger event produced it, when the fold was given one — see {@link Placed} for why this
   * exists at all.
   *
   * ⛔ **It is what makes the log CARRYABLE across a window release** (299 §2 finding 5). The state
   * a carry is computed from covers a superset of the events about to be re-folded, so carrying the
   * reports whole would double every one the retained suffix restates. The ordinal answers *"will
   * the re-fold build this again?"* exactly, where a count or a length cannot.
   *
   * Absent on a report built by a fold with no ordinals. Such a report is NOT carried — dropping it
   * is what happened to every report before this dispatch, so an unstamped fold is left exactly as
   * it was rather than given a guess.
   */
  ordinal?: number
}

/**
 * What the agent has done to the working tree (096, designed in 092).
 *
 * ⚠️ **Not items, and for the same reason the context meter is not one** (087): the transcript is
 * what the reader scrolls, and a file change is not a line in the conversation — 092's whole thesis
 * is that the individual writes stay inline as tool rows and the PANE consolidates them. Putting
 * reports in `items` would also have quietly changed every count, every window and every "is this
 * conversation empty" answer in the app, which is a large blast radius for a facet nothing renders.
 */
export interface ChangeLog {
  reports: ChangeReport[]
  /** Turns so far — each user message opens one. Zero until the reader says something. */
  turn: number
  /** Monotonic counter behind {@link ChangeReport.id}. */
  seq: number
  /**
   * Reports this fold is no longer holding, because a window release carried more of them across
   * than {@link MAX_CARRIED_CHANGE_REPORTS} (299 §2 finding 5).
   *
   * ⛔ **A cap is never silent** — 092's rule, 096's precedent, and the same shape as
   * `background.dropped` and `schedule.dropped`. It is a count of REPORTS and not of files: what
   * was released is exactly what we can no longer name, so naming a number of files would be an
   * invention. The pane says how many observations it has stopped holding, and nothing more.
   *
   * Zero for the whole life of any conversation short enough never to roll its window.
   */
  dropped: number
}

/**
 * The most change reports a window release will carry forward.
 *
 * ⛔ **The carry is what makes this a bound rather than an accident.** Before 299 a release dropped
 * the change log entirely, so the rows were bounded by the window and the badge was WRONG; carrying
 * them makes the badge right and makes the list grow for the life of the session instead. A report
 * is a few hundred bytes ({@link MAX_HELD_DIFF_REPORTS} has already taken the diff bodies off every
 * one older than twenty), so 400 is well under a megabyte and far above what any conversation
 * measured on this machine has produced — and the surplus is COUNTED, into {@link ChangeLog.dropped}.
 */
export const MAX_CARRIED_CHANGE_REPORTS = 400

/**
 * How many reports keep their diff bodies.
 *
 * ⚠️ **The 054 hazard, bounded from the other end.** 054 measured the transcript fold going
 * quadratic — 2,646 ms and ~1 GB at 1,600 turns — and 092 named this pane *"that hazard with file
 * contents attached."* A per-report ceiling alone does not bound a conversation: 171 turns × a
 * 256 KiB report is 43 MB of diff text nobody asked to see. So only the most recent reports keep
 * their bodies; older ones keep every row and lose the text.
 *
 * That costs almost nothing in practice, because rows fold by path and later wins: an older report's
 * bodies are usually already superseded. A row whose body has been released stops being expandable
 * and says why — it does not silently render an empty diff.
 */
export const MAX_HELD_DIFF_REPORTS = 20

export interface TranscriptState {
  humanAnswers: HumanAnswers
  items: TranscriptItem[]
  status: SessionStatus
  /** The provider ref once announced — null for Claude until its first turn's init. */
  ref: SessionRef | null
  /** True once the session is terminal (closed or fatally errored): no further turns. */
  ended: boolean
  /** Monotonic item-id counter. */
  seq: number
  /** The assistant item currently receiving deltas. */
  streamingId: string | null
  /**
   * The streamed assistant block that no authoritative `assistant_message` has confirmed yet
   * (068, fixing 066 F5). Deltas are progressive rendering; the authoritative message is the truth.
   * A `tool_call` closes the streaming block, so without this the authoritative message could no
   * longer find it and appended a SECOND block with the same text.
   */
  provisionalId: string | null
  /**
   * What the agent is doing RIGHT NOW (027), or null when it is doing nothing we were told about.
   *
   * Deliberately NOT an item: this is a statement about the present, not a line in the transcript.
   * It is replaced wholesale as the phase changes and cleared when the turn ends.
   *
   * Only `turn` and `user_turn` clear activity. An activity event arriving between turns therefore survives until the next prompt; it cannot be assumed to end with the turn, especially for background sub-agent notifications.
   *
   * The field is kept rather than suppressed — it is a true report of what the provider is doing,
   * and throwing it away would lose information. What changed is that nothing may read it as proof
   * a turn is running: see `sessionDoing`, where `status` frames and this only refines.
   */
  activity: { phase: 'thinking' | 'tool' | 'waiting' | 'compacting'; detail?: string } | null
  /** The thinking block currently taking deltas, if any. */
  thinkingId: string | null
  /**
   * The checklist the CURRENT turn is updating, or null (028).
   *
   * Cleared when the turn ends, so a plan that carries on across turns is restated as a new block
   * rather than silently mutating one far above where the reader is. Both facts are complete and
   * true where they sit, and the transcript still reads in the order things happened.
   */
  planId: string | null
  /** tool-call id → item id. */
  toolItems: Record<string, string>
  /**
   * sub-agent id → the item that HOLDS its card (029): the dispatching tool row, or the top-level
   * `subAgent` item standing in for one that has not arrived. This is how a `progress` or `ended`
   * finds the card it belongs to — by identity, never by position.
   */
  subAgentHomes: Record<string, string>
  /**
   * A sub-agent's OWN tool call → the agent that made it (035).
   *
   * Index tool-use ids inside child cards separately from {@link toolItems}. A grandchild can name one as its parent even though that call has no top-level tool item; without this index the grandchild is stranded at the conversation root.
   */
  cardTools: Record<string, string>
  /**
   * sub-agent id → the answer whose echo has already been taken off that card (137).
   *
   * ⛔ **The memory {@link dropEchoedProse} did not have, and 136 measured what its absence cost.**
   * Removing "the most recent row equal to the summary" is a rule with no end: a card whose ending
   * arrives BEFORE the child's forwarded words removes one row per arriving message, so a child that
   * said the same sentence twice with work in between lost both copies and the body kept only the
   * tool. An echo is one event said twice, so exactly one removal answers it.
   *
   * Keyed by the ANSWER and not by a flag, because a summary can be restated and grow: a later,
   * longer answer is a different sentence and is allowed its own single removal.
   *
   * ⚠️ **Not carried across a window release, and the reason is on the other side of the carry**:
   * `asSubAgentEvent` deliberately does not restate a card's `summary`, so a rebuilt card has no
   * answer to measure anything against and there is no removal for the fresh fold to make twice.
   * ⛔ The first version of that carry DID restate it, and review measured the consequence — a
   * sentence spliced out of its chronological position, 136 §3 sequence two, reintroduced. Carrying
   * this map instead would not have fixed it and would have broken the other direction: a release
   * that leaves the echo ITSELF in the retained suffix needs the removal to happen, and a carried
   * memory would suppress it.
   */
  echoedAnswers: Record<string, string>
  /** request id → item id, for both permission and user-input cards. */
  /**
   * ⛔ **A `Map`, because the key is the PROVIDER's request id** (150, from 148 H3) — the same
   * reason and the same representation as {@link SessionRecord.requests}. Claude takes it straight
   * from the SDK's `toolUseID`, so `__proto__` is a legal one, and `state.requestItems['__proto__']
   * = itemId` on an ordinary object hits the inherited setter and stores nothing at all.
   */
  requestItems: Map<string, string>
  /**
   * 🔴 **474 · piece id → the label a person says out loud and the title it was given, for the work
   * THIS conversation was given** (from `463` F4; pieces since D-016).
   *
   * ⛔ **It draws no item of its own and exists only so another row can name its subject** — ⚑ and,
   * since UI-003, so a piece taken on for the person lands on its call's card.
   * `work_given` is ledger-only here and stays ledger-only — the brief above or below it already
   * says the work arrived — but the label it carries is the only thing in this ledger that turns the
   * `work_<uuid>` a reply's row names into something a reader recognises.
   *
   * ⛔ **A miss is a fact, not a gap**: a reply to a piece given before the retained suffix begins
   * finds nothing here, and its card says so rather than naming a label it guessed — which is the
   * digest's own rule for the same edge (`466`, *"the honest absence of it"*).
   */
  piecesGiven: Map<string, { label: string; title?: string }>
  /**
   * 🔴 **658 · who GAVE each piece in hand** — by piece id, so a reply's card can name the
   * conversation it goes to: the conversation from `work_given.givenBy`, and its identity from the
   * brief's own `relayedFromProfile`, since `work_given` names a conversation and no identity.
   * ⚑ **D-016 · commit 6 · or `person`**: a `work_given` whose `givenBy` is `null` — a piece its
   * holder took on for a person, which no brief gives. ⛔ The same retained-suffix rule as
   * {@link piecesGiven}: a miss is a fact, and the card says *its parent*.
   */
  pieceGivers: Map<string, { profile?: string; conversation?: string; person?: true }>
  /**
   * 🔴 **678 · a brief that arrived before the row that titles it** — the IDLE branch's order (see
   * {@link RelayedItem.opened}). ⚑ Emptied as each `work_given` arrives; a brief whose row never
   * comes stays here and goes on saying its label alone, which is the truth about it.
   */
  briefsAwaitingTheirTitle: Map<string, RelayedItem>
  /**
   * 🔴 **658 · a messaging row that landed BEFORE the call that wrote it** — see {@link landOutgoing}.
   *
   * ⚠️ **The host writes `work_replied`/`message_sent` inside the tool's handler** — ⚑ and D-047 a
   * give's `work_sent`, as late as the give takes — and nothing orders that write after the
   * provider-stream row announcing the call. ⛔ **Held until its call comes, and emptied by the
   * three things that mean it never will**: a `tool_result` whose call is not in view (a call before
   * the retained suffix), a sub-agent's `tool_result`, and the end of the run
   * ({@link stopOpenToolCalls}). ⚠️ **Never by an unrelated receipt** — an earlier call's result can
   * still be read after the handler wrote the row, and clearing there would lose it. ⚑ A give's
   * receipt takes the row it names ({@link settleTheGive}).
   */
  messageReceipts?: MessageJoins
  outgoingAhead: OutgoingWords[]
  /**
   * 🔴 **685 · a refusal notice waiting for its call's receipt** — see {@link NoticeItem.told}.
   *
   * ⚠️ **The host writes `tool_refused` inside the tool's handler**, so it lands before the receipt
   * and never after it. ⛔ Emptied as each receipt claims one, and by the end of the run
   * ({@link stopOpenToolCalls}): a refusal whose receipt never comes says only what it said.
   */
  /**
   * The rows this turn's errors drew so far, and its ending when it failed on a refused sign-in:
   * Codex's retry lines, the refusal, `turn failed`. Emptied at each turn a person or an agent
   * starts.
   */
  turnErrorRows: NoticeItem[]
  /**
   * The line a sign-in reopen drew, while a carrying-on turn may still come. An account change
   * keeps its message asking to send again until that turn is recorded; `name` is the provider's.
   */
  renewedLine: {
    readonly line: NoticeItem
    readonly name: string
    readonly replacedCopy?: true
  } | null
  refusalsAwaitingReceipt: {
    tool: string
    rail: string
    notice: NoticeItem
    told: RefusalTold | null
  }[]
  /**
   * How many cards are still waiting on the user, by kind (099).
   *
   * ⚠️ **Derived state, kept for exactly one reason: so a surface can ask WITHOUT walking the
   * transcript.** `sessionPanel` and `pendingKind` both answer this by scanning every item, which
   * is fine for the one conversation on screen and is not fine for the rail — it describes every
   * open conversation and re-renders whenever any of them changes, so a scan there makes the whole
   * rail re-render on every streaming delta. That cost is why the rail used to gate its scan on the
   * status column, and that gate is what made the rail's answer a SECOND derivation that could
   * differ from the pane's. This field removes the trade: the rail now feeds `needingFor` the same
   * numbers the pane does, in O(1), with no dependency on `items` at all.
   *
   * ⚠️ **Maintained by full RECOUNT, never by increments** — see {@link recountPending}. A counter
   * nudged at seven mutation sites is a counter that drifts the first time an eighth is added;
   * recomputing from `requestItems` costs nothing because it runs only when a request changes
   * state, which has happened 33 times in this app's entire recorded history.
   */
  pending: { permissions: number; questions: number }
  /**
   * ⚑ **D-017 · R19 — the cards in {@link pending} this app routed to ANOTHER conversation**
   * ({@link PermissionItem.routedTo}) — absent when none waits, as `routed` is on a card nothing
   * routed.
   *
   * ⛔ **Counted apart and never out of {@link pending}**: those counts gate the attention queue,
   * whose person's-queue answers read a live card whoever it was routed to. ⚑ A surface that says
   * whether a PERSON is owed something subtracts these — a question routed to the parent is the
   * parent's (R19) — and says the conversation is waiting on that one's answer instead. Kept by
   * {@link pending}'s own full recount, off the same items.
   */
  routedAway?: RoutedAway
  /** How full the context window is (087). See {@link ContextMeter} — never null, starts unknown. */
  meter: ContextMeter
  /** What the agent did to the working tree (096). See {@link ChangeLog} — never null, starts empty. */
  changes: ChangeLog
  /**
   * Every dynamic workflow this conversation has launched, by `task_id` (108).
   *
   * ⚠️ **The registry and the tool row hold the SAME object, not two copies.** A frame arrives with
   * a `task_id` and — on three of the four subtypes — a `tool_use_id`; the fold has to find the run
   * by the first and place it by the second. Copying would give the drawer and the transcript two
   * folds of one run, which is precisely the *"two answers to one question"* failure `session-panel`
   * exists to avoid. So this maps to the card the {@link ToolItem} also points at.
   *
   * It is keyed by `task_id` rather than by the anchor because `task_updated` — one of the two
   * endings — carries no anchor at all.
   */
  workflows: Record<string, WorkflowRunCard>
  /**
   * The last error notice this TURN drew — as it arrived, and as it was rendered (246 §1).
   *
   * ⛔ **Exactly one slot, and that is a decision rather than a shortcut.** The duplicate it exists
   * to catch is emitted back to back with what it repeats: `SessionMachine.completeTurn` says the
   * turn's terminal reason immediately after the provider's own `error` notification carried the
   * same text — measured in the same millisecond by 042, and in step 73's run at ledger ordinals 15
   * and 16 with nothing between them. A remembered SET would also swallow an error a turn genuinely
   * repeats (two failing tool calls with one message), and this fails the other way: an error in
   * between makes the ending say the cause a second time, which is a line too many rather than a
   * fact too few.
   *
   * ⚠️ **Both halves, because the two ends of the comparison are rendered differently.** A Codex
   * `auth` error is drawn as {@link AUTH_ERROR_NOTICE} while the turn's terminal message carries the
   * provider's own sentence verbatim; comparing only what was SHOWN would miss that pair, and
   * comparing only what ARRIVED would miss one whose envelope was unwrapped.
   *
   * ⛔ **Dropped when a turn OPENS**, so a cause said before a turn can never silence that turn's
   * ending — and dropped there and nowhere else. The first draft cleared it on the `turn` event too;
   * 246's mutation table returned that row GREEN, because a turn cannot begin without a `user_turn`
   * and the interval between them holds no terminal message. See `case 'turn'`.
   *
   * ⚠️ **Not carried across a window release** (`transcript-window.ts`'s `FoldCarry`), for the same
   * reason {@link TranscriptState.echoedAnswers} is not: a fold rebuilt from a suffix has not drawn
   * the cause, so it must be free to draw it. That is the direction that shows a fact rather than
   * hides one.
   */
  lastError: { raw: string; shown: string } | null
  /**
   * ⛔ **What is still running in the background right now** (248) — see {@link BackgroundRegistry}.
   *
   * ⚠️ **Not a `Record` keyed by id, and not merged.** Every other registry in this file accumulates;
   * this one is REPLACED wholesale by each frame that states the level, because that is what the
   * provider's own doc says a consumer must do, and because accumulating would mean pairing edges —
   * the one construction that can wedge a row on screen after its work has died.
   *
   * ⚑ **Carried across a window release**, unlike {@link TranscriptState.lastError}, and for the
   * opposite reason: a level is a statement about NOW rather than about the events in the window, so
   * a fold of a suffix that forgot it would drop a running row for work that is still going. The
   * carry cannot change what a fold of the same events would produce, because the last level event
   * wins either way.
   */
  background: BackgroundRegistry
  /**
   * ⛔ **What this conversation has promised to do LATER** (258) — see {@link ScheduleRegistry}.
   *
   * ⚑ **Carried across a window release for the reason {@link background} is**, and with a longer
   * reach: a schedule is republished only at TURN END, so a conversation that has rolled its window
   * mid-turn has thrown away the only events that would restate it and may not get another for
   * minutes. A registry rebuilt from a suffix would go quiet about a job that is still going to
   * fire, which is the exact silence this whole dispatch exists to remove.
   */
  schedule: ScheduleRegistry
  /**
   * ⛔ **What the running AGENT will answer to** (279) — see {@link CommandRegistry}.
   *
   * ⚑ **Carried across a window release for the reason {@link background} and {@link schedule} are,
   * and with the longest reach of the three**: this level is stated ONCE, at session start, and
   * again only if the provider changes its mind. A conversation long enough to roll its window would
   * otherwise forget the list for good — there is no next restatement to wait for.
   */
  commands: CommandRegistry
  /**
   * 🔴 **What tools this conversation has** (358) — see {@link ToolRegistry} for the three states.
   *
   * ⚑ **Beside `commands` rather than inside it**, though both are *"what the provider published
   * about itself"*: a command is something a PERSON types and a tool is something the MODEL calls,
   * they arrive on different frames, and Codex publishes one of them and not the other. One
   * registry would have had to carry a `null` meaning two different things.
   */
  tools: ToolRegistry
  /**
   * 🔴 **730 · R83 — the ask to stop the provider has not answered, while it stands**, or `null`.
   * ⚑ Read by the Stop control (`stopJoinsThatAsk`), which says a press joins it. ⚑ Cleared on the
   * next `turn` row and on a reopen (the host stops joining there), and on a newer ask
   * (`work_interrupted`) — which the host joins too, but nobody has waited on yet. ⚠️ A late answer
   * writes no row (`723` F-7), so between that answer and the `turn` this can outlive the ask — see
   * `lib/stop-unanswered.ts`.
   */
  stopUnanswered: StopUnanswered | null
  /**
   * 🔴 **D-001 · the requests a turn ended under while the host still held them** — by the
   * provider's request id, which survives a re-fold where an item id does not.
   *
   * ⛔ A turn's ending settles every open card on the premise that the adapter safe-rejects its
   * pending requests as it terminalises the turn. ⚠️ **Not always**: a Codex code-mode cell outlives
   * its turn with BroBot's own `give_work` card still claimed (`spawn_agent`'s when `738` P-1 measured
   * it, `sess_0d870a6d`), and a
   * Claude background agent can ask while the main turn's `result` lands. The machine keeps the
   * session on `waiting_permission` across that ending (122), so the card is still answerable —
   * and settling it froze the composer over a card with nothing to press.
   *
   * ⚑ So `case 'turn'` leaves those cards live and names them here, and `case 'status'` settles
   * whichever are still open once the status leaves `waiting_permission`: nothing holds them then.
   */
  heldPastTheirTurn: Set<string>
}

export function createTranscript(): TranscriptState {
  return {
    humanAnswers: { latest: null, active: null },
    items: [],
    status: 'idle',
    ref: null,
    ended: false,
    seq: 0,
    streamingId: null,
    provisionalId: null,
    activity: null,
    thinkingId: null,
    planId: null,
    toolItems: {},
    subAgentHomes: {},
    cardTools: {},
    echoedAnswers: {},
    pending: { permissions: 0, questions: 0 },
    requestItems: new Map(),
    piecesGiven: new Map(),
    pieceGivers: new Map(),
    briefsAwaitingTheirTitle: new Map(),
    outgoingAhead: [],
    turnErrorRows: [],
    renewedLine: null,
    refusalsAwaitingReceipt: [],
    meter: { reading: { kind: 'unknown' }, source: null, at: null },
    changes: { reports: [], turn: 0, seq: 0, dropped: 0 },
    workflows: {},
    lastError: null,
    background: { running: [], dropped: 0 },
    // ⚠️ **An empty list here is NOT "nothing is scheduled", and no surface may read it as one.**
    // The level is stated at turn end, so a conversation that has never ended a turn has never been
    // TOLD — and a Codex conversation can never be told at all (`253` checked four layers: no
    // thread-scoped scheduled job in the protocol, no `ClientRequest` method, and a schedule
    // vocabulary that cannot express *"every 2 minutes"*). What keeps the two apart is that nothing
    // draws a sentence from emptiness: an absent bar is not a claim, which is `248`'s own line.
    schedule: { jobs: [], dropped: 0, left: [] },
    // ⛔ **`null`, and it is the one initial value in this function that is not an empty collection**
    // (279 §2). Every other registry starts empty because empty is what it means; this one starts
    // *"nobody has told us"*, which is a different fact from *"this agent has no commands"* and is
    // rendered differently. A `[]` here would make a session that has not started look like an agent
    // with nothing to offer — the exact thing §2 forbids.
    commands: { set: null, dropped: 0 },
    // ⛔ **`null` for the reason above and for one more** (358). This registry's `null` is the FIRST
    // of three states rather than of two — the second, *"this provider publishes no inventory"*,
    // lives inside the set as `published: null` and is a thing only an adapter may say. Starting
    // here at `{ set: { declared: null, published: null } }` would put that sentence on screen for
    // every session before any adapter had said it.
    tools: { set: null, dropped: 0, at: null },
    stopUnanswered: null,
    heldPastTheirTurn: new Set(),
  }
}

/**
 * Drop the diff text from every report but the most recent {@link MAX_HELD_DIFF_REPORTS} (096 §4).
 *
 * The rows survive in full — path, status, counts — because they are what the collapsed pane draws
 * and they cost a few hundred bytes each. Only the bodies go, and `released` records that they did,
 * so a row can say *"the diff for this file is no longer held"* instead of expanding onto nothing.
 */
function releaseOldDiffBodies(log: ChangeLog): void {
  for (let index = 0; index < log.reports.length - MAX_HELD_DIFF_REPORTS; index += 1) {
    const report = log.reports[index]!
    if (report.released) continue
    report.changes = report.changes.map((change) => {
      const { diff, ...rest } = change
      void diff
      return rest
    })
    report.released = true
  }
}

function nextId(state: TranscriptState, prefix: string): string {
  state.seq += 1
  return `${prefix}_${state.seq}`
}

function itemById(state: TranscriptState, id: string | undefined): TranscriptItem | undefined {
  return id === undefined ? undefined : state.items.find((item) => item.id === id)
}

/**
 * The queued message an ending is ABOUT (077, corrected at 413) — **by name**, and by position
 * only where there is no name to go on.
 *
 * ## ⛔ The premise that stopped being true, and the row it settled
 *
 * ⚠️ **This used to return *the last unresolved one*, and said why**: *"the host allows only one
 * queued message per session at a time, so `the last unresolved one` and `the one this event is
 * about` are the same item by construction."* ⛔ **`394` made the mailbox hold a work message AND
 * a question, and that sentence was never revisited.** `406` reported the gap; this is it closed.
 *
 * 🔴 **Measured before it was fixed.** Queue `m_work`, queue `m_q`, then publish
 * `message_unqueued{messageId: 'm_work', reason: 'sent'}` — the fold spliced out the QUESTION's
 * row and left the work's on screen, where nothing would ever settle it. ⚑ Both halves are
 * damage: a child's question disappears from the one surface a person reads it on, and a message
 * that HAS been sent goes on saying *not sent · waiting for the turn to end* for ever.
 *
 * ## ⚠️ The fallback is for ledgers with no names, and only those
 *
 * ⛔ **A row that carries an id and does not match is NOT the answer.** Returning it would settle
 * the wrong row, which is the defect; returning nothing sends the fold down its rebuild branch,
 * which is right — an ending whose beginning is not on screen is exactly what that branch is for
 * (`054` pages the transcript). ⚑ Rows with no id at all are pre-`354` and pair only with endings
 * that have none either, so the two eras never mix in one window.
 */
function openQueuedItem(
  state: TranscriptState,
  messageId?: string,
): (QueuedItem & Timed) | undefined {
  let unnamed: (QueuedItem & Timed) | undefined
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'queued' || item.outcome !== null) continue
    if (messageId !== undefined && item.messageId === messageId) return item
    if (item.messageId === undefined) unnamed ??= item
  }
  return unnamed
}

/**
 * 🔴 **537 · the held row this id NAMES, and nothing else** — no fallback and no position.
 *
 * ⛔ **Deliberately NOT {@link openQueuedItem}, whose unnamed fallback would be wrong here.** That
 * one exists for a ledger written before `354`, where an ending with no id may only pair with a
 * beginning that has none either; this is asked by `work_given`, which is written by
 * `RuntimeHost.recordTheGive` and carries the held message's id whenever the brief was held, and
 * since D-022 by `work_rebriefed`, whose id names the held give a new brief rides. ⚠️
 * **So a miss here is a real absence** — `054` pages the transcript, and a window that joined this
 * window after the message was queued holds the give without the row it is about — and answering it
 * with *the oldest row nobody named* would put one message's label, or one piece's brief, on another
 * message.
 *
 * ⚑ **`outcome === null` for {@link openQueuedItem}'s reason**: a row that has already ended is not
 * waiting for anything, and a label or a brief would change a sentence nobody is still reading as
 * *now*.
 */
function heldMessageNamed(
  state: TranscriptState,
  messageId: string,
): (QueuedItem & Timed) | undefined {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'queued' || item.outcome !== null) continue
    if (item.messageId === messageId) return item
  }
  return undefined
}

/**
 * 🔴 **658 · which of this app's two messaging tools a call is — by the names THIS session was
 * handed.**
 *
 * ⛔ **Not by a provider's spelling written here.** Claude says `mcp__brobot__reply_to_parent` and
 * Codex `brobot__reply_to_parent`; both are the `tool_inventory` row's `naming` applied to its
 * `declared.server`, and {@link splitQualified} is the one reader of that convention. ⚠️ So a session
 * that was never told (`set` or `declared` null) recognises nothing, and its calls draw as every
 * other tool does — the honest fallback, not a guess.
 *
 * ⚠️ **The two TOOL names are this app's own and the same for every provider** — `agent-tools.ts`
 * declares them — and the call must also be one the session was declared, so a foreign server that
 * happened to share our server's name and a tool's name is not enough on its own.
 *
 * ⛔ **`name` is read as `unknown`**: replay is a trust boundary, and a row whose name is not a string
 * must draw as the tool row it always drew as rather than take the whole fold down.
 */
function outgoingToolOf(
  state: TranscriptState,
  name: unknown,
  summary: unknown,
): OutgoingWords['tool'] | null {
  const set = state.tools.set
  if (typeof name !== 'string' || set === null || set.declared === null) return null
  const split = splitQualified(set.naming, name)
  if (split === null || split.server !== set.declared.server) return null
  if (!set.declared.tools.some((tool) => tool.name === split.tool)) return null
  // ⚑ **And the two question tools** ({@link QuestionTool}) and the give, by the same
  // names-it-was-handed rule.
  return split.tool === 'reply_to_parent' ||
    split.tool === 'message_agent' ||
    split.tool === 'ask_question' ||
    split.tool === 'pass_question_up' ||
    split.tool === 'give_work' ||
    split.tool === 'take_on_work'
    ? split.tool
    : // ⚑ **D-047 · `update_work` only where its arguments carry a new brief** — a status, a title
      // or a close writes no `work_sent`, so it would wait for a row that never comes and stand
      // beside a real new brief as a second candidate for its row. ⚠️ A brief whose key was cut out
      // of the arguments' bound leaves the call a tool row, as it always drew.
      split.tool === 'update_work' &&
        typeof summary === 'string' &&
        argumentExcerpt(summary, 'brief') !== null
      ? split.tool
      : null
}

/**
 * ⚑ **Has this call's host row landed yet** — the one question {@link callsWaitingFor} asks of each
 * card, per tool.
 */
function awaitsItsRow(words: OutgoingWords | undefined): boolean {
  if (words === undefined) return false
  if (words.tool === 'reply_to_parent') return words.reply === null
  if (words.tool === 'message_agent') return words.sent === null
  if (words.tool === 'give_work') return words.given === null
  if (words.tool === 'take_on_work') return words.taken === null
  if (words.tool === 'update_work') return words.rebriefed === null
  return words.asked === null
}

/** ⚑ A recognised call with no host row on it yet. */
function noRowYet(tool: OutgoingWords['tool']): OutgoingWords {
  if (tool === 'reply_to_parent') return { tool, reply: null }
  if (tool === 'message_agent') return { tool, sent: null }
  if (tool === 'give_work') return { tool, given: null }
  if (tool === 'take_on_work') return { tool, taken: null }
  if (tool === 'update_work') return { tool, rebriefed: null }
  return { tool, asked: null }
}

/**
 * ⚑ **The ids a host row names, and the argument its call names them in** — `message_agent`'s
 * `agent` (the recipient conversation), and the `piece` of `reply_to_parent` and `ask_question`.
 *
 * ⚠️ **A piece has TWO spellings a call may use** — its id and its label, since D-016 every door
 * takes either — so a piece pairs by both. ⛔ **`labelUnknown` when the row's label is not in view**:
 * an argument spelled as a label cannot then be compared, and is not a mismatch.
 */
function pairingIdOf(
  words: OutgoingWords,
): { key: string; ids: readonly string[]; labelUnknown: boolean } | null {
  if (words.tool === 'message_agent') {
    return words.sent === null
      ? null
      : { key: 'agent', ids: [words.sent.toConversation], labelUnknown: false }
  }
  if (words.tool === 'reply_to_parent') {
    return words.reply === null ? null : aPieceNamed(words.reply.piece, words.reply.label)
  }
  // ⚑ **UI-003 · a take-on names no id** — its arguments are a title and a brief, and its row keeps
  // the title as the call wrote it (trimmed, by its door's schema), so it pairs by the title. ⚠️
  // Without it a row that came ahead of its call landed on an older take-on whose run died.
  // ⚑ **D-047 · a give's piece is minted by the give**, so its arguments name it nowhere either:
  // it pairs by the title the same way.
  if (words.tool === 'give_work') {
    return words.given === null
      ? null
      : { key: 'title', ids: [words.given.title], labelUnknown: false }
  }
  if (words.tool === 'take_on_work') {
    return words.taken === null
      ? null
      : { key: 'title', ids: [words.taken.title], labelUnknown: false }
  }
  // ⚑ **D-047 · a new brief names its piece** — by id or label, as `ask_question` does.
  if (words.tool === 'update_work') {
    return words.rebriefed === null
      ? null
      : aPieceNamed(words.rebriefed.piece, words.rebriefed.label)
  }
  // ⚑ **A question** — `ask_question` names the piece it is about, `pass_question_up` the question
  // it carries; ⚠️ one about no piece pairs by position alone.
  const asked = words.asked
  if (asked === null) return null
  if (words.tool === 'pass_question_up') {
    return asked.passedUpFrom === undefined
      ? null
      : { key: 'question', ids: [asked.passedUpFrom], labelUnknown: false }
  }
  return asked.piece === undefined ? null : aPieceNamed(asked.piece, asked.label)
}

/** ⚑ A piece's two spellings, as {@link pairingIdOf} compares them. */
function aPieceNamed(
  piece: string,
  label: string | undefined,
): { key: string; ids: readonly string[]; labelUnknown: boolean } {
  return label === undefined
    ? { key: 'piece', ids: [piece], labelUnknown: true }
    : { key: 'piece', ids: [piece, label], labelUnknown: false }
}

/**
 * 🔴 **658 · does this call's own argument name the row's id?** — `match`, `mismatch`, or `unknown`
 * when the argument is absent or was cut before it could say.
 *
 * ⚑ **A correlation between two records of ONE act**: the arguments the model sent, and the host's
 * row of what it did with them. ⛔ The value compared is an opaque id (`sess_…`, `work_…`) or a
 * piece's label — and a give's or a take-on's title, the one prose their rows repeat as it was
 * sent — and it decides only WHICH recognised call a row belongs to, never whether a call is ours.
 * ⚠️ **Why it exists**: the host's row names no call id (neither provider hands one to the tool
 * layer), and two calls of one tool in flight — a parallel batch, or a call whose turn died before it
 * answered — are otherwise told apart by position alone.
 */
function pairing(summary: unknown, words: OutgoingWords): 'match' | 'mismatch' | 'unknown' {
  // ⚑ **D-047 · a new brief is told apart by its brief as well as its piece** — the host keeps it
  // as the call sent it, so a call whose own brief differs is never its call. ⚠️ Without it, the
  // row of a call that was not recognised (its brief cut out of the arguments' bound) waits ahead
  // of every later call on that piece, and the next one would draw the brief before it.
  if (words.tool === 'update_work' && words.rebriefed !== null && typeof summary === 'string') {
    const brief = argumentExcerpt(summary, 'brief')
    if (brief !== null) {
      const same = brief.cut
        ? words.rebriefed.brief.startsWith(brief.text)
        : words.rebriefed.brief === brief.text
      if (!same) return 'mismatch'
    }
  }
  const want = pairingIdOf(words)
  if (want === null || typeof summary !== 'string') return 'unknown'
  const excerpt = argumentExcerpt(summary, want.key)
  if (excerpt === null) return 'unknown'
  // ⚑ **A title is kept trimmed** and the argument is as the model wrote it.
  const said = want.key === 'title' ? { ...excerpt, text: excerpt.text.trim() } : excerpt
  if (!said.cut) {
    if (want.ids.includes(said.text)) return 'match'
    return want.labelUnknown && isALabel(said.text) ? 'unknown' : 'mismatch'
  }
  return want.labelUnknown || want.ids.some((id) => id.startsWith(said.text))
    ? 'unknown'
    : 'mismatch'
}

/**
 * ⚑ **A non-empty string, as a replayed field actually is** — {@link relayerIdentity}'s discipline
 * for every id and slug the two messaging cards read.
 */
function isAnId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * ⚑ **688 · a piece's label, as a replayed or live field actually is** — a string `pieceCalled`
 * spells, the store's own replay bound (`boundPieceNamed`) asked again here, because a LIVE row
 * reaches the fold without passing through the store. ⛔ Never *W0*, never *W1.02*.
 */
export function isALabel(value: unknown): value is string {
  return typeof value === 'string' && pieceNumbersOf(value) !== null
}

/**
 * 🔴 **688 · R22 — is this held row BroBot's plan go-ahead?** See {@link QueuedItem.goAhead}.
 *
 * ⚑ **The `user_turn` arm's rule, asked of a held row and of its ending**: app-authored, and no
 * subject. ⛔ Each subject is read the way the arms read it — a report as a report, a relay and a
 * notice as a non-empty string — so a row edited on disk cannot make itself the go-ahead by carrying
 * a subject in a shape this fold ignores.
 */
function isTheGoAhead(
  event: Pick<QueuedMessageEvent, 'attribution' | 'work' | 'relayedFrom' | 'appNotice'>,
): boolean {
  return (
    event.attribution === 'app_authored' &&
    !isAWorkReport(event.work) &&
    !wasRelayed(event.relayedFrom) &&
    !carriesANotice(event.appNotice)
  )
}

/** One call a host row could belong to — the conversation's own, or a sub-agent's on its card. */
interface MessagingCall {
  readonly summary: unknown
  /** `null` for a sub-agent's call: its row lives on a card, which draws no outgoing card. */
  readonly item: ToolItem | null
}

/**
 * ⚑ **Every call of this tool still waiting for its host row** — at every depth.
 *
 * ⚠️ **A sub-agent's call counts** (found in review): its handler writes the same row into this
 * ledger, so it is a candidate even though it can never wear the card. ⛔ **A call whose run ended
 * without an answer stops waiting once a NEWER call of its tool exists** — a late row may still land
 * on it inside its own turn's aftermath, but a dead call must not stand beside every later one as a
 * second candidate for the rest of the window.
 */
function callsWaitingFor(state: TranscriptState, tool: OutgoingWords['tool']): MessagingCall[] {
  const mine = state.items.filter(
    (item): item is ToolItem & Timed => item.kind === 'tool' && item.outgoing?.tool === tool,
  )
  const newest = mine[mine.length - 1]
  const waiting: MessagingCall[] = mine
    .filter((item) => {
      if (item.result !== null || (item.unfinished === true && item !== newest)) return false
      return awaitsItsRow(item.outgoing)
    })
    .map((item) => ({ summary: item.summary, item }))
  for (const card of everyCard(state)) {
    for (const row of card.body) {
      if (row.kind !== 'tool' || row.result !== undefined || row.unfinished === true) continue
      if (outgoingToolOf(state, row.name, row.summary) === tool)
        waiting.push({ summary: row.summary, item: null })
    }
  }
  return waiting
}

/**
 * 🔴 **658 · the host's row lands on the call that wrote it** — one call, or none, never a guess.
 *
 * ⚑ **Chosen by the call's own argument first** ({@link pairing}): a call that names the row's id
 * wins when it is the only one; a call that names a DIFFERENT id is never a candidate. ⚠️ Failing
 * that, the one call left still waiting takes it. ⛔ **Two candidates the arguments cannot tell
 * apart** — a parallel batch whose arguments were cut before the id — **and the row lands on
 * neither**: both calls draw from their receipts, `heldMessageNamed`'s refusal to guess.
 *
 * ⚠️ **A row whose call is a SUB-AGENT's lands nowhere**: that call is on a card, which draws no
 * outgoing card. ⚑ **No candidate at all ⇒ the row came FIRST** — see
 * {@link TranscriptState.outgoingAhead}, where it waits for its call.
 */
function landOutgoing(state: TranscriptState, words: OutgoingWords): void {
  const open = callsWaitingFor(state, words.tool).filter(
    (call) => pairing(call.summary, words) !== 'mismatch',
  )
  const named = open.filter((call) => pairing(call.summary, words) === 'match')
  const chosen = named.length === 1 ? named[0] : open.length === 1 ? open[0] : undefined
  if (chosen !== undefined) {
    if (chosen.item !== null) chosen.item.outgoing = words
    return
  }
  if (open.length === 0) state.outgoingAhead.push(words)
}

/**
 * 🔴 **D-047 · a give's answer settles which `work_sent` is its own.** ⚠️ The row pairs by its title
 * alone ({@link pairingIdOf}), and a give whose call ended before its answer goes on in the host —
 * so its row lands on the newest give of that title still waiting, which can be a retry of it.
 * ⚑ **The receipt names the piece the call gave** — `give_work`'s own sentence begins *"W1.2 given
 * to …"* — so a row naming another comes off the call, which takes its own from those waiting ahead
 * of a call. ⛔ A call whose answer gave nothing — a refusal, an error — keeps none.
 */
function settleTheGive(state: TranscriptState, item: ToolItem): void {
  if (item.outgoing?.tool !== 'give_work' || item.result === null) return
  const { summary, ok } = item.result
  const itsOwn = (given: OutgoingGive): boolean =>
    ok && summary.startsWith(`${given.label} given to `)
  if (item.outgoing.given !== null && itsOwn(item.outgoing.given)) return
  const own = state.outgoingAhead.find(
    (words) => words.tool === 'give_work' && words.given !== null && itsOwn(words.given),
  )
  if (own === undefined) {
    if (item.outgoing.given !== null) item.outgoing = { tool: 'give_work', given: null }
    return
  }
  state.outgoingAhead = state.outgoingAhead.filter((words) => words !== own)
  item.outgoing = own
}

/**
 * ⚑ **UI-003 · the take-on that holds this piece** — on its call's card, or waiting ahead of its
 * call; the newest first. `null` for a piece no take-on in view holds.
 */
function takeOnOf(state: TranscriptState, piece: string): OutgoingTakeOn | null {
  for (const words of state.outgoingAhead) {
    if (words.tool === 'take_on_work' && words.taken?.piece === piece) return words.taken
  }
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing?.tool !== 'take_on_work') continue
    if (item.outgoing.taken?.piece === piece) return item.outgoing.taken
  }
  return null
}

/**
 * 🔴 **658 · the reply for this piece went nowhere** — marked on the card that carries it, or on the
 * row still waiting ahead of its call. ⚑ The newest such reply: a piece is answered once.
 */
function markUndelivered(state: TranscriptState, piece: string, because: string): void {
  for (const words of state.outgoingAhead) {
    if (words.tool === 'reply_to_parent' && words.reply?.piece === piece) {
      words.reply.undelivered = because
      return
    }
  }
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing?.tool !== 'reply_to_parent') continue
    if (item.outgoing.reply?.piece !== piece) continue
    item.outgoing.reply.undelivered = because
    return
  }
}

/**
 * ⚑ **A recognised call claims a row that landed ahead of it** — the one whose id its arguments name,
 * or else the only one of its tool waiting; never one its arguments contradict, and never a guess
 * between two. ⛔ **Not while a sub-agent's call of the same tool is waiting** unless the arguments
 * name the row: the row could be that call's.
 */
function claimAhead(
  state: TranscriptState,
  tool: OutgoingWords['tool'],
  summary: string,
): OutgoingWords {
  const ahead = state.outgoingAhead.filter(
    (words) => words.tool === tool && pairing(summary, words) !== 'mismatch',
  )
  const named = ahead.filter((words) => pairing(summary, words) === 'match')
  const nestedWaiting = callsWaitingFor(state, tool).some((call) => call.item === null)
  const only =
    named.length === 1 ? named[0] : ahead.length === 1 && !nestedWaiting ? ahead[0] : undefined
  if (only !== undefined) {
    state.outgoingAhead = state.outgoingAhead.filter((words) => words !== only)
    return only
  }
  return noRowYet(tool)
}

/**
 * ⚑ **The question this conversation sent, by its request id** — on the call that carries it, or
 * waiting ahead of its call; the newest first. `null` for a request that is not one of ours (a
 * provider's own card), or a question that landed on no card.
 */
function questionSent(state: TranscriptState, requestId: string): OutgoingQuestion | null {
  for (const words of state.outgoingAhead) {
    if ('asked' in words && words.asked?.requestId === requestId) return words.asked
  }
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing === undefined || !('asked' in item.outgoing))
      continue
    if (item.outgoing.asked?.requestId === requestId) return item.outgoing.asked
  }
  return null
}

/**
 * ⚑ **`question_asked`, read as the card draws it** — each field as a replayed row actually is:
 * an id a non-empty string, the words a string, a part only with a prompt, an option only with a
 * label. `null` for a row with no request id, which nothing could ever close.
 */
function questionAsked(event: QuestionAskedEvent): OutgoingQuestion | null {
  if (!isAnId(event.requestId)) return null
  const piece = isAnId(event.piece) ? event.piece : undefined
  const parts = Array.isArray(event.questions) ? event.questions : []
  return {
    requestId: event.requestId,
    ...(moveOfferOf(event.move) === undefined ? {} : { move: moveOfferOf(event.move) }),
    ...(piece === undefined ? {} : { piece }),
    ...(piece !== undefined && isALabel(event.label) ? { label: event.label } : {}),
    ...(isAnId(event.passedUpFrom) ? { passedUpFrom: event.passedUpFrom } : {}),
    prompt: typeof event.prompt === 'string' ? event.prompt : '',
    parts: parts.flatMap((part: unknown): OutgoingQuestionPart[] => {
      if (typeof part !== 'object' || part === null) return []
      const { id, header, prompt, options, multiSelect, allowOther, secret } = part as Record<
        string,
        unknown
      >
      if (typeof prompt !== 'string') return []
      const offered = (Array.isArray(options) ? options : []).flatMap((option: unknown) => {
        if (typeof option === 'string') return [{ label: option }]
        const { label, description } = (option ?? {}) as { label?: unknown; description?: unknown }
        if (typeof label !== 'string') return []
        return [typeof description === 'string' ? { label, description } : { label }]
      })
      // ⚑ **UI-009 · each rule only where the row states it** — an absent flag is *not said*, and the
      // card reads it as the narrower answer (`UserInputQuestion`'s own reading).
      return [
        {
          id: typeof id === 'string' ? id : '',
          ...(typeof header === 'string' && header !== '' ? { header } : {}),
          prompt,
          options: offered,
          ...(multiSelect === true ? { multiSelect: true as const } : {}),
          ...(allowOther === true ? { allowOther: true as const } : {}),
          ...(secret === true ? { secret: true as const } : {}),
        },
      ]
    }),
    ...(isAnId(event.context) ? { context: event.context } : {}),
  }
}

/**
 * ⚑ **UI-009 · the call whose card carries that question** — its item id, so *Open the
 * conversation* lands on the card; `undefined` while its row waits ahead of its call, or for a
 * question that is not on this page.
 */
export function askedQuestionItemIn(state: TranscriptState, requestId: string): string | undefined {
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i]
    if (item?.kind !== 'tool' || item.outgoing === undefined || !('asked' in item.outgoing))
      continue
    if (item.outgoing.asked?.requestId === requestId) return item.id
  }
  return undefined
}

/**
 * 🔴 **UI-011 · the row a piece's brief is drawn on, in the conversation it was given to** (F037)
 * — the relayed turn that opened it ({@link RelayedItem.opened}), or the held row still carrying it
 * ({@link QueuedItem.label}), by the piece's label; so a give card's cut note lands on the whole
 * brief. ⚑ **The FIRST**: a new brief opens a later turn under the same label, and the card shows
 * the brief it gave. `undefined` for a brief that is not on this page.
 */
export function briefItemIn(state: TranscriptState, label: string): string | undefined {
  for (const item of state.items) {
    if (item.kind === 'relayed' && item.opened?.label === label) return item.id
    if (item.kind === 'queued' && item.label === label) return item.id
  }
  return undefined
}
/**
 * What a reader is told when the provider rejected the credential mid-conversation (098).
 *
 * Deliberately says where to fix it. The launcher's panel is the only place that offers the two
 * remedies, and a session that is already open has no such panel — so the sentence has to carry the
 * direction, or it is the same dead end in friendlier words.
 */
const AUTH_ERROR_NOTICE =
  'This profile’s sign-in was rejected, so this conversation cannot continue. Start a new conversation to sign in again — the launcher will offer it.'

/**
 * The same rejection, where this app replaces a refused copy of the sign-in by itself: the copy an
 * agent's own home holds, replaced once from a newer sign-in to the same account, and the
 * conversation reopened. The row is written when the refusal arrives, before the app knows whether
 * a newer sign-in exists, so the sentence is true both ways. One template: `name` is the provider's.
 */
export function replacedSignInNotice(name: string): string {
  return (
    `${name} refused this agent’s sign-in, so this turn stopped. This app replaces it by itself ` +
    'when a newer sign-in to the same account is on this computer, and reopens this conversation. ' +
    `Signing in to ${name} again on the ${name} card in Providers gives it one.`
  )
}

/**
 * ⚑ **The same rejection, when the profile runs on the OpenAI API key a person saved** (`onAKey` on
 * the error, see `events.ts`). ⛔ *"Sign in again"* is no remedy for a key, and the launcher offers no
 * sign-in while one is saved. ⚑ So it names the key, the card's own “Check it works” — named by the
 * word on the button — and what a new conversation runs on. ⚠️ It names no vendor and does not say
 * the key is the saved one: a home copied from a machine whose own Codex runs on a key reads as a
 * key too, and saving one on the card is the remedy there as well. ⚠️ It does not promise this one carries
 * on after a new key: measured in the bundled Codex, a running app-server reloads its credential
 * after a refusal only for a ChatGPT sign-in (*"Skipping auth reload because no account id is
 * available"*).
 */
const AUTH_KEY_NOTICE =
  'The API key this conversation was started with was refused, so this conversation cannot run on ' +
  'it. Check or replace the key under “API key” on the Codex card in Providers — “Check it works” ' +
  'there asks whether a saved key still works — then start a new conversation, which runs on the ' +
  'key saved then.'

/**
 * The other rejected credential: the one **this conversation was launched with**, which a fresh
 * launch replaces (110).
 *
 * Distinguish an expired conversation credential snapshot from a broken machine login. A new session may authenticate successfully while the old one cannot, so do not tell the person to abandon work merely to sign in again.
 *
 * The last sentence is here because reopening is honest in **both** branches: if the machine login
 * has expired too, the reopen refuses before it starts anything — `prepareProviderHome` asks
 * `claudeAuthHealth()` and throws, and the rail row shows *"Run `claude` in a terminal once — it
 * refreshes on its own — then try again"*. So this never has to guess which case it is in, and never
 * has to ask.
 *
 * ⚠️ That is a DIFFERENT sentence from {@link AUTH_ERROR_NOTICE} above, and an earlier version of
 * this comment said it was the same one (review). They are two remedies on two paths: that notice
 * needs a live event stream carrying `cause: 'auth'`, which only Codex produces, and it never fires
 * on a Claude reopen. Nothing pins the two texts together, so nothing should imply they move
 * together.
 *
 * ⚠️ **It names the control by the word ON the control.** The first draft said "reopen it from the
 * rail" — and nothing in this app is labelled "rail".
 *
 * ## 🔴 672 · what it said for a year, and what was measured instead (`656` F6)
 *
 * ⛔ **It said *"Nothing here is lost — press Resume on it under the closed threads in the
 * sidebar"*.** ⚑ **D-017b · there is no closed list and no press to find**: a message sent from the
 * conversation's own view continues it, so that is what it says.
 *
 * ⛔ ***"Nothing here is lost"* was false on this path** — `reopening.ts` already called the phrase a
 * claim of more than happened. Measured by `672`, replaying the Claude ending on the real host,
 * store and fold: the transcript IS kept; the turn that was running fails and its answer never
 * comes; the reopened child starts with no *"Allow for this conversation"* approvals (a fresh
 * `SessionGrants`) and nothing running in the background (`markTerminal` → `stopDetachedWork`); a
 * queued message is not sent and its row offers the words back; and a draft is kept only while this
 * stays the selected conversation. ⚑ **So it says what is kept, where to press, and the two losses
 * the reopen itself carries** — the turn's failure has its own notice one row down (`turn failed`),
 * and the queued row says *not sent* on its own.
 *
 * ⚑ **The two clauses about the reopen were measured TRUE and stay**: the reopen re-reads the
 * machine login (`prepareProviderHome` → `claudeAuthHealth`), and an expired one refuses with the
 * store's own sentence on the rail row.
 *
 * ⛔ **One arm it cannot help**: a restored `.brobot` bundle replays this notice, where no message
 * continues the conversation — a recording's notices are history, as every other instruction in it is.
 *
 * 🔴 **D-004 · R101 — and it says the one case that needs no press**: when the machine login was
 * renewed elsewhere, the host reopens the conversation by itself ({@link
 * REOPENED_ON_A_RENEWED_SIGN_IN} is the line below it). ⚠️ *"Otherwise"* keeps the press true for
 * the same token, an expired login, and a reopen the host could not make.
 */
const STALE_AUTH_NOTICE =
  'The sign-in this conversation was launched with is no longer valid, so it cannot continue on ' +
  'it. Its transcript is kept. If your machine’s Claude login was renewed elsewhere on this computer, ' +
  'this app carries it on with the new login by itself, and a line below says so. Otherwise, send ' +
  'it a message to carry on: that reads your machine login again, and says so if that login has ' +
  'expired too. It carries on without its “Allow for this conversation” approvals or ' +
  'anything that was running in the background.'

/**
 * ⚑ **The same refusal, when the credential was the API key a person saved** (`onAKey` on the
 * error, see `events.ts`). ⛔ Every clause of {@link STALE_AUTH_NOTICE} about the Mac's login would be
 * false here: no Claude elsewhere renewed anything, nothing reopens by itself, and a fresh start reads
 * the same key. ⚑ So it names the key and the one place to check or replace it — the card's own
 * “Check it works”, named by the word on the button, asks Anthropic whether it still takes the
 * key — and what a message then does.
 */
const STALE_KEY_NOTICE =
  'Anthropic refused the API key this conversation was started with, so it cannot continue on it. ' +
  'Its transcript is kept. Press “Check it works” under “API key” on the Claude card in Providers, and ' +
  'replace the key if it is refused; then send this conversation a message to carry on, which ' +
  'starts it again and reads the key afresh. It carries on without its “Allow for this ' +
  'conversation” approvals or anything that was running in the background.'

/**
 * 🔴 **D-004 · R101 — what a conversation reopened by itself on a renewed sign-in says**, once, at
 * the seam ({@link ReopenedEvent.because}).
 *
 * ⚑ **The card's words.** ⛔ *"Nothing was re-sent"* is the promise the host keeps: the failed
 * turn's tool steps may already have run, so the person decides whether to ask again.
 */
export const REOPENED_ON_A_RENEWED_SIGN_IN =
  'Its sign-in changed since it started; reopened on the current one. Nothing was re-sent: send ' +
  'again to carry on.'

/**
 * ⚑ **What a conversation this app reopened on the current sign-in, for words held for it, says**
 * — once, at the seam ({@link ReopenedEvent.because} `the-sign-in-moved-on`). ⚑ What it carried
 * goes in next, and the one cost it paid is named: the reopen waited until it would stop no turn,
 * card, background work or planning.
 */
export const REOPENED_FOR_WHAT_WAITED =
  'Its sign-in changed after this conversation started, so this app reopened it on ' +
  'the current one to deliver what was waiting for it. It no longer has its “Allow for this ' +
  'conversation” approvals.'

/**
 * ⚑ **D-017 · R10 — what the conversation that could never be reopened says**, once, as its last
 * line ({@link ReplacedByEvent}). ⚑ The host follows the replacement for every sender — an agent,
 * the app, and a person's own send or Reopen, which opens the one in its place — so the line says
 * both.
 */
export const REPLACED_BY_A_NEW_CONVERSATION =
  'This conversation could not be reopened, so a new conversation of the same agent took its ' +
  'place — with the agent’s memory, not this history. What is sent to this one goes there, and ' +
  'reopening this one opens that one.'

/** ⚑ **D-017 · R10 — and the new one's first line** ({@link ReplacesEvent}), the other end. */
export const TOOK_THE_PLACE_OF_ONE =
  'This conversation took the place of one of the same agent’s that could not be reopened. It has ' +
  'the agent’s memory, not that conversation’s history.'

/**
 * What a billing refusal is said as: the credential it ran on, and the ways out. Credit for the
 * account carries this conversation on; a replaced key or a new one reaches only conversations
 * started after it, because a running one keeps the credential it started with. Removing the key to
 * run on a login is offered on the provider's card, which knows whether this computer has one.
 */
export function billingNotice(
  provider: keyof typeof PROVIDER_NAME | null,
  onAKey: boolean,
): string {
  if (provider === null) {
    return (
      'The provider would not run this turn on the account this conversation runs on, because of ' +
      'that account’s billing. Add credit to it, then send this conversation a message to carry on.'
    )
  }
  const name = PROVIDER_NAME[provider]
  return onAKey
    ? `This turn was refused on the API key saved for ${name}, because the account the key ` +
        'belongs to can’t pay for it. Add credit to that account, then send this conversation a ' +
        `message to carry on. Or replace the key under “API key” on the ${name} card in ` +
        'Providers; conversations started after that run on the new key.'
    : `This turn was refused on the account this conversation’s ${name} login belongs to, ` +
        'because of that account’s billing. Check its plan and billing, then send this ' +
        `conversation a message to carry on. Or save an API key under “API key” on the ${name} ` +
        'card in Providers; conversations started after that run on it.'
}

/**
 * A cause with no notice of its own is a compile error here (110 review).
 *
 * ⚠️ **It returns a sentence rather than throwing**, because the day this is reached at RUNTIME —
 * a ledger written by a newer build, replayed by an older one — the reader is owed a row, not a
 * crashed fold. The type is `never`, so that day cannot arrive from this build's own code.
 */
function assertNoUnhandledCause(cause: never): string {
  return `this conversation reported a problem this version does not recognize (${String(cause)})`
}

/**
 * What a typed `cause` is said as — the whole of 085's split in one function.
 *
 * ⚠️ **A function rather than three `notice` calls, since 246 §1**, because the fold now needs the
 * SENTENCE as a value: it remembers what this turn last said so the turn's own ending cannot say it
 * a second time. Drawing and remembering from two switches would be two answers to one question.
 */
function causeNotice(
  cause: NonNullable<RuntimeErrorEvent['cause']>,
  /** ⚑ The refused credential was the person's API key ({@link STALE_KEY_NOTICE}, {@link AUTH_KEY_NOTICE}). */
  onAKey: boolean,
  /**
   * The provider's name where the host says this app replaces a refused copy of this sign-in, else
   * `null`: no such fact on the row, or no provider to name.
   */
  replacedFor: string | null = null,
): string {
  switch (cause) {
    case 'auth':
      if (onAKey) return AUTH_KEY_NOTICE
      return replacedFor === null ? AUTH_ERROR_NOTICE : replacedSignInNotice(replacedFor)
    case 'auth_stale':
      return onAKey ? STALE_KEY_NOTICE : STALE_AUTH_NOTICE
    default:
      return assertNoUnhandledCause(cause)
  }
}

/**
 * 🔴 **425 · the five remedies, as the clause a person reads** (HO-023 §2.2) — the vocabulary is
 * `shared/refusals.ts`'s, and this is the only place in the renderer that says anything about it.
 *
 * ## ⛔ The person's register, and why it is not the model's sentence
 *
 * ⚠️ **The model is told *you may*; a person is told *it may*.** A transcript is read by somebody
 * watching an agent they did not send the call for, and a clause in the second person would be this
 * app instructing the reader to go and write a file. ⛔ **So this is a third-person clause
 * about the agent**, and the sentence the model got stays in `main/` where each door owns it.
 *
 * ⚑ **One policy word drives both, which is the whole point of a code.** The rail tables decide
 * WHETHER there is an act and WHICH; the two registers only spell it. Free text would have been two
 * independent sentences, free to promise different things about the same refusal.
 *
 * ⚠️ **Five clauses and no two alike.** `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`
 * is asserted over this table, because a nine-rail map folded onto five words is exactly the shape
 * where a copy-paste makes two rails say one thing and nothing fails.
 */
const REMEDY_SAID: Readonly<Record<RefusalRemedy, string>> = {
  'change-what-you-sent-and-call-again': 'it can change what it sent and call again',
  // ⛔ **Not *"will work"*, which is the promise `retryable` already makes one clause to the left.**
  // A launch in flight can also FAIL and abandon its reservation; this says what there is to do, and
  // the row's own `retrying may work` says whether it can succeed.
  'make-the-same-call-when-this-settles':
    'there is nothing to change — the same call again, once that has settled',
  'shorten-the-summary-and-attach-the-long-form':
    'it can shorten the summary and put the long form in a file it names',
  'shorten-the-answer-or-put-the-long-form-in-a-file':
    'it can shorten the answer, or put the long form in a file and name its full path in the answer',
  // ⚠️ **Not *"from the choices it was offered"*.** A free-form request offers none, and it reaches
  // this rail the moment a part is left out — see the vocabulary's own note.
  'answer-every-part-the-request-asks-for':
    'it can answer again, every part, in the form the request asks for',
  // 🔴 **733 · it said *"it can offer a different Markdown file"*** (`731` F-4). ⛔ Both conditions
  // were gone: the store holds more types than Markdown (`HO-097`), and `726` · R92 took away the
  // *workspace* the code word still spells. ⚑ The act is the model's sentence's own — *"Write a file
  // and offer that path instead — one of the types this app holds"* — in this register. ⚠️ The code
  // word stays: it is stored in `tool_refused` rows and read back by {@link isRefusalRemedy}.
  'offer-a-workspace-markdown-file-that-reads':
    'it can write a file of a type this app holds and offer that instead',
}

/**
 * ⛔ **The clause, or `null` because there is nothing to say** (425).
 *
 * 🔴 **Three inputs, one outcome: absent, `null`, and a word from a later build all draw NOTHING.**
 * ⚠️ **This is where it differs from `permanenceSaid`** — which `466` moved to
 * `shared/refusals.ts` so the digest could read it too — **and which prints a word it does not know
 * AS ITSELF.** A permanence is a fact about the refusal and every row has one, so the raw
 * word is the honest thing to show. ⛔ **A remedy is a PROMISE about an act**, and a build that does
 * not recognise the word cannot say the act still exists — advertising a gesture that no longer works
 * is the defect `421` spent a dispatch deleting, one surface over.
 *
 * ⚑ **The PO's own database is the fixture**: every `tool_refused` row written before this dispatch
 * arrives here with no field at all, and must read as a refusal that simply had nothing to offer.
 */
function remedySaid(remedy: unknown): string | null {
  return isRefusalRemedy(remedy) ? REMEDY_SAID[remedy] : null
}

/**
 * ⚑ **The clause with its separator, or an empty string** (425) — so the row that has nothing to
 * offer is drawn exactly as it was before this dispatch, down to the last character.
 *
 * ⛔ **`an-unenumerated-state-counts-as-success` is the trap this shape is written against.** A
 * reader that draws nothing for an absent remedy has to be MEASURED drawing nothing, with a present
 * one beside it — most rails take this branch, so it is the common case and
 * not the edge.
 */
function remedyClause(remedy: unknown): string {
  const said = remedySaid(remedy)
  return said === null ? '' : ` · ${said}`
}

function notice(
  state: TranscriptState,
  level: NoticeItem['level'],
  text: string,
  providersWords = false,
): void {
  state.items.push({
    kind: 'notice',
    id: nextId(state, 'notice'),
    level,
    text,
    ...(providersWords ? { providersWords: true as const } : {}),
  })
}

/**
 * ⚑ **685 · the notice just drawn for a refusal waits for its call's receipt** — see
 * {@link TranscriptState.refusalsAwaitingReceipt}. ⚠️ Called straight after {@link notice}, so the
 * last item IS that notice.
 */
function awaitItsReceipt(
  state: TranscriptState,
  tool: string,
  rail: string,
  told: RefusalTold | null,
): void {
  const drawn = state.items[state.items.length - 1]
  if (drawn?.kind !== 'notice') return
  state.refusalsAwaitingReceipt.push({ tool, rail, notice: drawn, told })
}

/**
 * 🔴 **685 · a receipt that IS a refusal hands its words to the notice** (`675` F-d).
 *
 * ⚑ **Every app refusal's receipt begins `refused (<rail>): `** — `agent-tools.ts` writes the
 * model's text that way, and each provider's normalizer keeps the head of it (the first 200
 * characters, where `675` put the act). ⛔ **The join is by content and by count**: the call must
 * be one of this app's own declared tools (a foreign server sharing a tool's name is not enough),
 * the receipt must begin with the waiting rail's prefix, and exactly ONE refusal may match — two of
 * one tool on one rail in flight draw nothing, the refusal to guess `landOutgoing` makes.
 *
 * ⚠️ **An outgoing card already prints this receipt** (`outgoing-card.ts`), so the refusal is
 * claimed and nothing is added — one account of one call.
 */
function tellItsRefusal(
  state: TranscriptState,
  name: unknown,
  summary: string,
  printedElsewhere: boolean,
  matched?: (rail: string) => void,
): RefusalTold | null {
  if (state.refusalsAwaitingReceipt.length === 0) return null
  const set = state.tools.set
  if (typeof name !== 'string' || set === null || set.declared === null) return null
  const split = splitQualified(set.naming, name)
  if (split === null || split.server !== set.declared.server) return null
  const matching = state.refusalsAwaitingReceipt.filter(
    (waiting) => waiting.tool === split.tool && summary.startsWith(`refused (${waiting.rail}): `),
  )
  const only = matching.length === 1 ? matching[0] : undefined
  if (only === undefined) return null
  matched?.(only.rail)
  state.refusalsAwaitingReceipt = state.refusalsAwaitingReceipt.filter((one) => one !== only)
  if (printedElsewhere) return only.told
  if (only.told !== null) {
    // The host kept the whole sentence: the notice quotes it whole, in part only if it was cut.
    only.notice.told = withoutHandles(only.told.text)
    if (only.told.dropped > 0) only.notice.toldInPart = true
    return only.told
  }
  const words = summary.slice(`refused (${only.rail}): `.length)
  const cut = RECEIPT_CUT.exec(words)
  only.notice.told = withoutHandles(cut === null ? words : words.slice(0, cut.index))
  if (cut !== null) only.notice.toldInPart = true
  return null
}

/**
 * ⚠️ **The mark each provider's normalizer puts on a receipt it cut at the row's bound** — Claude's
 * `truncate` appends `…`, and Codex's `boundedSummary` appends `… (N of M characters)`
 * (`packages/runtime`). ⛔ Read here as a SHAPE and never re-derived: a normalizer that changed its
 * mark would leave the mark inside the quotation — the old drawing — rather than cut a word.
 */
const RECEIPT_CUT = /…(?: \(\d+ of \d+ characters\))?$/

/**
 * ⚑ **685 · the short form a call's own row kept** — its receipt as the ledger has it, wherever the
 * row is drawn: a top-level row or a sub-agent card's. `null` when no row holds one.
 */
export function receiptOf(state: TranscriptState, callId: string): string | null {
  for (const row of everyToolRow(state))
    if (row.callId === callId) return row.result?.summary ?? null
  return null
}

/**
 * ⚑ **685 · the clause a refusal notice ends with** — the one spelling, read by the notice and by
 * the readable export. `''` when the call's receipt told it nothing this fold could join.
 */
export function toldClause(told: string | undefined, inPart = false): string {
  if (told === undefined) return ''
  return inPart ? ` · it was told, in part: “${told}”` : ` · it was told: “${told}”`
}

/**
 * The session is open again — the transcript we just replayed ends with it closing, and that
 * ending describes the session we resumed FROM, not the one now running.
 *
 * Called by the resume flow rather than driven off a `session:'resumed'` event, because the fact
 * is ours to state: the host has just handed back a live handle. Waiting for the provider to
 * announce itself would leave the composer shut for as long as it stayed quiet — and shut forever
 * if it never said anything at all.
 */
export function markReopened(state: TranscriptState): void {
  state.humanAnswers.active = null
  state.ended = false
  state.status = 'idle'
  // ⚠️ **The cards belong to the session we resumed FROM** (085 review, and the same call
  // `markReadOnly` has always made for the same reason). A ledger that ends mid-turn — the app was
  // quit, or died, while a question was on screen — has no `turn` or `session:'ended'` event to
  // settle it, so the replay rebuilds that card with its buttons live. Pressing one reaches a NEW
  // adapter that has never heard of the id and refuses. Nothing in the transcript was wrong about
  // the past; what was wrong was offering to act on it.
  settlePending(state, 'settled when this conversation was last open')
  // A recording can end mid-stream; without this the next turn's deltas would be appended to
  // the assistant block that was open when the app quit.
  closeStreaming(state)
  state.provisionalId = null
  // Everything the LAST turn was in the middle of doing (027). A ledger that ends mid-turn — the
  // app was quit while a tool ran — has no `turn` event to close it, so the replay leaves the pill
  // saying "running Bash" and a thinking block pulsing, about a process that died with the last
  // session. Both are claims about NOW, and the only true one on reopen is that nothing is running.
  state.activity = null
  const thinking = itemById(state, state.thinkingId ?? undefined)
  if (thinking?.kind === 'thinking') thinking.streaming = false
  state.thinkingId = null
  // The replayed checklist stands as the last state that turn recorded — it is history now, and a
  // NEW turn's plan must open its own block rather than overwrite what we just replayed (028).
  state.planId = null
  stopRunningSubAgents(state) // whatever it was doing died with the last session (029)
  stopOpenToolCalls(state) // and so did whatever it had running (074)
  stopDetachedWork(state) // …and so did what it had deliberately left running (248)
  state.stopUnanswered = null // …and so did any ask to stop it (730, R83): a new life asks afresh
  // ⛔ **The schedule did NOT die with it** (258 §2): its jobs stand until the new process restates
  // the level — ⚠️ though a resume does not bring back every one ({@link ScheduleRegistry.jobs}).
}

/**
 * This transcript is a RECORDING and nothing in it can be acted on (047).
 *
 * The read-only view folds the same events through the same `applyEvent` as a live conversation, so
 * what comes out the other side is identical — including a permission card left unanswered because
 * the app quit mid-request, which renders with its Allow and Deny buttons intact. Those buttons
 * would emit into a view with nothing wired behind them: a control that looks live, does nothing
 * when pressed, and gives no reason. Offering an action that cannot work is worse than not offering
 * it, which is the same rule that keeps a Resume button off these rows.
 *
 * It settles them with a note instead — the same mechanism a session ending uses, so a card that
 * stopped being answerable says so, in a sentence, wherever it happened.
 *
 * `ended` is deliberately NOT set. A recording is not a conversation that ended; some of these
 * genuinely never did, and the composer that flag governs is not mounted here at all.
 */
export function markReadOnly(state: TranscriptState, reason: string): void {
  closeStreaming(state)
  // ⚑ This is a RECORDING, so there is no host holding anything and no listener behind the button;
  // that is the whole reason this function settles at all (622).
  settlePending(state, reason)
  // Whatever the last turn was in the middle of doing died with the session that was doing it. The
  // same claim `markReopened` corrects, for the same reason: a pulsing "running Bash" in a
  // transcript being READ is a statement about now, and it is false.
  state.activity = null
  const thinking = itemById(state, state.thinkingId ?? undefined)
  if (thinking?.kind === 'thinking') thinking.streaming = false
  state.thinkingId = null
  stopRunningSubAgents(state)
  stopOpenToolCalls(state)
  stopDetachedWork(state) // a recording's background work is as dead as everything else in it (248)
  // ⚠️ Its schedule is left as the recording ends: no start reaches a recording, and `ReadingPane`
  // draws `TranscriptView` alone — no bar, no word — so nothing on screen promises its jobs.
  // A checklist frozen mid-step is the same false claim wearing different clothes: `PlanEntry`
  // animates an `active` step, so a recording of a session that died on step 2 of 5 sits there
  // pulsing under a "Read-only" banner. The step did not finish, so it goes back to `pending` —
  // which is what it was, and is the only one of the three that is still true.
  for (const item of state.items) {
    if (item.kind !== 'plan') continue
    for (const step of item.steps) if (step.status === 'active') step.status = 'pending'
  }
  // Both nulled for the same reason `markReopened` nulls them: they point INTO items, and a state
  // that is handed one more event would use them to overwrite what was just replayed —
  // `dropProvisional` splicing out the last streamed block, a `plan_update` clobbering the
  // checklist. Nothing feeds this state today; the asymmetry with `markReopened` is the trap.
  state.provisionalId = null
  state.planId = null
}

/** Stop attributing deltas to the open assistant item (a turn ended, or a message replaced it). */
function closeStreaming(state: TranscriptState): void {
  const open = itemById(state, state.streamingId ?? undefined)
  if (open?.kind === 'assistant') open.streaming = false
  state.streamingId = null
}

/**
 * Remove the unconfirmed streamed block, if any (068). Only ever called when an authoritative
 * message is about to render the same run of text, so nothing the user relies on is lost — the
 * alternative is showing that text twice.
 */
function dropProvisional(state: TranscriptState): void {
  const id = state.provisionalId
  state.provisionalId = null
  if (!id) return
  const index = state.items.findIndex((item) => item.id === id)
  if (index >= 0) state.items.splice(index, 1)
}

/**
 * ⚑ **D-017b · what a card its stop settled says** — one sentence for every stop: whether it was a
 * close, a quit or a failure is a fact about a process, and the card's reader is told only that the
 * question is not waiting any more (`05` rule 5).
 */
export const NOTHING_WAITS_FOR_THIS_ANSWER = 'nothing waits for this answer any more'

/**
 * The session reached a terminal state. Both signals that can announce it are
 * handled — `session:'ended'` and the lifecycle `status` — because a session that
 * never got a validated provider ref has no honest ref to announce and is closed
 * with `status:'ended'` alone. Whichever arrives first wins; the other is a no-op.
 */
function markTerminal(state: TranscriptState, reason: string): void {
  state.humanAnswers.active = null
  if (state.ended) return
  state.ended = true
  closeStreaming(state)
  // ⚑ The SESSION is over, so nothing holds a request past it.
  settlePending(state, reason)
  // A sub-agent cannot outlive the SESSION either (029, found by 037).
  //
  // Three of the four endings already said this — `turn`, `markReopened`, `markReadOnly` — and this
  // one did not, because in the ordinary case a turn ends before the session does and has already
  // swept them. The case that is not ordinary is a session closed or fatally errored MID-turn:
  // there is no `turn` event, so every card sat there claiming to be running, forever, about a
  // process that died with the session. The transcript could get away with that because a spinner
  // is easy to miss in a long thread; the panel cannot, because listing it is the whole feature.
  stopRunningSubAgents(state)
  // A tool call cannot outlive the session either — same boundary, same reason (074). A session
  // closed or fatally errored MID-CALL has no `tool_result` coming, because there is nothing left to
  // send one.
  stopOpenToolCalls(state)
  // ⛔ **And neither can work that was deliberately left running** (248). This is the boundary where
  // the two sweeps differ: a detached command survives its TURN by definition, and dies with the CLI
  // child that owns it — which is what this event says has happened.
  stopDetachedWork(state)
  // ⛔ **…but the SCHEDULE outlives this** (258 §2): the jobs stand, and this app starts the
  // conversation again in time for those its provider brings back (D-029) — see
  // {@link ScheduleRegistry.jobs}.
}

/**
 * ⛔ **Whether the HOST is still holding a request on the far side of this ending** (D-001, `738`
 * P-1).
 *
 * ⚑ It is asked as a fact about the ledger rather than as a flag, because every caller knows the
 * answer for certain and {@link settlePending}'s branch is the only place the consequence is
 * spelled out: an adapter safe-rejects its pending requests at a Stop and a teardown, but a
 * provider can keep one past an ordinary turn end — see {@link TranscriptState.heldPastTheirTurn}.
 */
type TheRequests = 'still-held' | 'released'

/**
 * The adapters safe-reject every still-pending request as part of teardown, so the
 * cards must stop offering buttons that would now fail — and say why, rather than
 * silently going quiet.
 *
 * ⚠️ **Except a request the provider keeps past its turn**, and {@link TheRequests} is the caller's
 * answer for it.
 */
function settlePending(
  state: TranscriptState,
  reason: string,
  requests: TheRequests = 'released',
): void {
  // ⚑ **D-001 · the set names what the LAST ending spared**, so every settle starts it afresh.
  state.heldPastTheirTurn.clear()
  for (const item of state.items) {
    if (item.kind === 'permission' && item.outcome === null && item.note === null) {
      holdOrSettle(state, item, reason, requests)
    }
    if (item.kind === 'userInput' && item.answered === null && item.note === null) {
      holdOrSettle(state, item, reason, requests)
    }
  }
  // Everything that was waiting has just stopped waiting, so the counts are zero — but written as a
  // recount rather than as `= 0`, so this stays right if a future settle ever spares one.
  recountPending(state)
}

/**
 * 🔴 **D-001 · a request the host still holds is left live, and named** — see
 * {@link TranscriptState.heldPastTheirTurn}.
 */
function holdOrSettle(
  state: TranscriptState,
  item: PermissionItem | UserInputItem,
  reason: string,
  requests: TheRequests,
): void {
  if (requests === 'still-held') state.heldPastTheirTurn.add(item.request.id)
  else item.note = reason
}

/**
 * 🔴 **D-001 · what a card that outlived its turn says once nothing holds it any more.**
 *
 * ⚑ Reached when the status leaves `waiting_permission` with the card neither answered nor
 * withdrawn: a Stop declined it (both adapters' `interrupt()` settles every open card), or the
 * provider let go of the call. ⚠️ A person's answer can land a moment after that status; its
 * `user_decision` clears this note ({@link markPermissionAnswered}), so the answer still wins.
 */
export const HELD_REQUEST_LET_GO = 'settled when the agent stopped waiting for it'

/** 🔴 **D-001 · settle the cards a turn left live**, once the status says nothing holds them. */
function letGoOfHeldRequests(state: TranscriptState): void {
  if (state.heldPastTheirTurn.size === 0) return
  for (const requestId of state.heldPastTheirTurn) {
    const item = itemById(state, state.requestItems.get(requestId))
    if (item?.kind === 'permission' && item.outcome === null && item.note === null) {
      item.note = HELD_REQUEST_LET_GO
    }
    if (item?.kind === 'userInput' && item.answered === null && item.note === null) {
      item.note = HELD_REQUEST_LET_GO
    }
  }
  state.heldPastTheirTurn.clear()
  recountPending(state)
}

/**
 * How a turn's ending is said to someone reading the card it killed (085).
 *
 * Three states, three words, and `completed` is deliberately not one of them: "settled when the
 * turn completed" reads as though completing were the thing that answered the question. It ended,
 * and the question ended with it. `interrupted` gets the passive because the alternative — "the
 * turn interrupted" — makes the turn the actor, and the reader is usually the one who stopped it.
 */
const TURN_END_WORD = {
  completed: 'ended',
  failed: 'failed',
  interrupted: 'was interrupted',
} as const satisfies Record<'completed' | 'failed' | 'interrupted', string>

/**
 * 🔴 **725 · R71 — an ending THIS APP wrote, said as its own word** (`709` F-1, ruled by the PM):
 * *"a stop the app forces is recorded as the app's act (`wordOf: 'this-app'`), never as the
 * provider's."*
 *
 * ⚑ **What the mark means, from its docblock** (`events.ts`): the machine's own three endings —
 * `forceEnd` (a Claude Stop after its receipt, a Close the provider did not answer first), `failTurn`, and a fatal error's
 * terminal — and nothing a provider said. `forceEnd` ends the turn AHEAD of the provider and absorbs
 * its later word unread, so on such a row the provider's own ending is in no row at all.
 *
 * ⚑ **The receipt keeps its words and gains a clause** — *"turn interrupted — this app's word, not
 * the provider's"* — so the state is still read first and the two cannot be read as two events.
 * ⛔ **It names nobody who ASKED** (a Stop's ask is its own row above, `ASKED_TO_STOP`; a Close
 * writes none) and ⛔ **claims nothing about what the provider did.**
 *
 * ⛔ **An UNMARKED ending gains nothing, and is not said to be the provider's.** Rows written before
 * `720` carry no mark whoever wrote them, and nothing is backfilled (`HO-029` §2.2) — so *no mark*
 * is a provider's word only from `720` on, and the notice stays as it always read.
 */
export const THE_APPS_OWN_WORD = 'this app’s word, not the provider’s'

/**
 * The user's own message — the runtime has no event for it, the app knows it sent one.
 *
 * `attribution` is spread rather than assigned so the ordinary case pushes an item with **no such
 * key at all**: absent is the honest reading of "the host recorded us sending this", and an
 * explicit `undefined` would be a field claiming to have been considered.
 */
/**
 * 🔴 **F093 · keep the whole text a turn handed the provider on the message it drew** — for "Show
 * what the model got". ⛔ A string, read as one: replay is a trust boundary.
 */
function keepWhatWasSent(
  state: TranscriptState,
  sent: unknown,
  from = state.items.length - 1,
): void {
  if (typeof sent !== 'string') return
  const drawn = state.items
    .slice(Math.max(0, from))
    .filter(
      (item) =>
        item.kind === 'user' ||
        item.kind === 'relayed' ||
        item.kind === 'appNotice' ||
        item.kind === 'workReport' ||
        item.kind === 'continuation',
    )
  for (const item of drawn) {
    item.sent = sent
    if (drawn.length > 1) item.sentWithOthers = true
  }
}

export function appendUserMessage(
  state: TranscriptState,
  text: string,
  attribution?: 'provider_transcript',
  attachments?: readonly HandedPath[],
): void {
  state.items.push({
    kind: 'user',
    id: nextId(state, 'user'),
    text,
    ...(attribution ? { attribution } : {}),
    // Spread, so an ordinary turn carries no such key — the same rule `attribution` follows above.
    ...(attachments && attachments.length > 0 ? { attachments: [...attachments] } : {}),
  })
  // 096: a user message opens a turn, and that is the Changes pane's scope axis. It is counted HERE
  // rather than read off a provider turn id because Codex's diff carries one and Claude's edits carry
  // nothing comparable — keying on it would hand the scope toggle to one provider and take it from
  // the other. Where the message sits in the transcript is a fact about both.
  state.changes.turn += 1
}

/**
 * 🔴 **The go-ahead, drawn as BroBot's and not as anybody's bubble** (278 §1, from 276).
 *
 * ⚑ **The turn counter is bumped here too, and that is not symmetry for its own sake.** 096's axis
 * is *"where a turn begins"*, and this begins one — the provider receives the message, works, and
 * writes files under it. A continuation that did not count would put every change it produced in
 * the previous turn's scope, which is the Changes pane quietly attributing work to the wrong prompt.
 *
 * This go-ahead currently carries no attachments: `endPlanMode` publishes only text and attribution. If paths are added later, this item and its component must display them. `app-authored-turn.test.ts` checks the absence on the event so that contract change becomes visible.
 */
export function appendAppTurn(state: TranscriptState, text: string): void {
  state.items.push({ kind: 'continuation', id: nextId(state, 'continuation'), text })
  state.changes.turn += 1
}

/**
 * 🔴 **A turn the app sent to report something it observed** (624) — see {@link AppNoticeItem}.
 *
 * ⚑ **`changes.turn` is bumped for {@link appendAppTurn}'s reason**: the provider receives this
 * and answers it, so a scope axis that did not count it would file whatever the agent does about
 * a decision or an answer under the prompt before it.
 *
 * ⛔ **A parameter rather than a field read off the event in here**, which is
 * {@link appendRelayedTurn}'s shape: this function is also the one `transcript.ts`' own tests
 * drive directly, and the fold above it is where a replayed word is checked.
 */
export function appendAppNotice(state: TranscriptState, text: string, notice: string): void {
  state.items.push({ kind: 'appNotice', id: nextId(state, 'appNotice'), text, notice })
  state.changes.turn += 1
}

/**
 * 🔴 **A turn the app sent to report on work this conversation gave out** (406) — see
 * {@link WorkReportItem}.
 *
 * ⚑ **`changes.turn` is bumped for {@link appendAppTurn}'s reason**: this really is a turn, the
 * provider really received it, and `045` opens a turn row from the event underneath it. A reader
 * that treated it as chrome would show work with no visible cause.
 */
export function appendWorkReport(
  state: TranscriptState,
  text: string,
  report: WorkReport,
  relayer: {
    readonly relayedFromProfile: string | undefined
    readonly relayedFrom?: string
  } | null = null,
): void {
  state.items.push({
    kind: 'workReport',
    id: nextId(state, 'workReport'),
    text,
    report,
    ...(relayer === null ? {} : { relayed: true as const }),
    ...relayNavigation(relayer?.relayedFrom),
    ...(relayer?.relayedFromProfile === undefined
      ? {}
      : { relayedFromProfile: relayer.relayedFromProfile }),
  })
  state.changes.turn += 1
}

/**
 * 🔴 **A turn whose words another conversation wrote** (413) — see {@link RelayedItem}.
 *
 * ⚑ **`changes.turn` is bumped for {@link appendAppTurn}'s reason** and it matters most here: a
 * piece one agent gives another is the turn the whole of that work happens under, so a scope axis
 * that did not count it would file every file the child touched under the previous prompt.
 */
export function appendRelayedTurn(
  state: TranscriptState,
  text: string,
  /**
   * ⚑ **545 · the relayer's identity, or `undefined` when the ledger cannot name one.** ⛔ A
   * parameter rather than a field read off the event inside here, because this function is also
   * the one `transcript.ts`'s own tests drive directly.
   */
  relayedFromProfile: string | undefined,
  /** ⚑ **688** — {@link RelayedItem.says}, already read as a member by the caller. */
  says?: AgentMessageKind,
  relayedFrom?: string,
): void {
  state.items.push({
    kind: 'relayed',
    ...relayNavigation(relayedFrom),
    id: nextId(state, 'relayed'),
    text,
    ...(relayedFromProfile === undefined ? {} : { relayedFromProfile }),
    ...(says === undefined ? {} : { says }),
  })
  state.changes.turn += 1
}

/**
 * 🔴 **678 · the relayed turn just appended gives a piece, or gives it a new brief** — title it now
 * if the row that titles it came first (held, and every new brief), or leave it waiting for that
 * row (idle). See {@link RelayedItem.opened}.
 *
 * ⚑ **688 · the turn's OWN label first** (`687` H6; D-016 · R4 puts it on both branches), so a page
 * that begins at that turn — the row a turn earlier is outside the window — still names the piece.
 * ⛔ Read as a label ({@link isALabel}) and never as truthy: a live row reaches this fold without the
 * store's replay bound.
 */
function openedAPiece(state: TranscriptState, piece: string, itsOwnLabel?: unknown): void {
  const turn = state.items[state.items.length - 1]
  if (turn?.kind !== 'relayed') return
  const given = state.piecesGiven.get(piece)
  const label = isALabel(itsOwnLabel) ? itsOwnLabel : given?.label
  turn.opened = {
    ...(label === undefined ? {} : { label }),
    ...(given?.title === undefined ? {} : { title: given.title }),
  }
  if (given === undefined) state.briefsAwaitingTheirTitle.set(piece, turn)
}

/**
 * ⚑ **658 · who gave a piece in hand, as far as this ledger says** — see
 * {@link TranscriptState.pieceGivers}. ⛔ Each row adds the half it carries — the give its
 * conversation, the brief its identity — whichever of the two arrives first. ⚑ A piece taken on for
 * a person has one row and one half: its `work_given` says the person gave it.
 */
function rememberTheGiver(
  state: TranscriptState,
  piece: string,
  half: { profile: string } | { conversation: string } | { person: true },
): void {
  state.pieceGivers.set(piece, { ...state.pieceGivers.get(piece), ...half })
}

/**
 * Recount {@link TranscriptState.pending} from the requests this fold knows about (099).
 *
 * ⚠️ **A full recount, deliberately, and it is what makes the field safe.** The alternative is
 * `pending.permissions--` at each of the seven places an item can stop awaiting — the two request
 * arms, the three `mark*` helpers, `request_resolved` and `settlePending` — and a counter nudged in
 * seven places is one an eighth path silently breaks. Recomputing cannot drift: it reads the same
 * `isAwaitingAnswer` the panel does, over the same items, and gets the same answer by construction.
 *
 * It is O(requests × items) and that is fine, because it runs only when a request CHANGES STATE.
 * Across every conversation this app has recorded, that has happened 33 times. What it buys is that
 * READING the answer — which the rail does for every open conversation on every render — costs
 * nothing and touches no field that a streaming delta mutates.
 */
function recountPending(state: TranscriptState): void {
  let permissions = 0
  let questions = 0
  // ⚑ **D-017 · R19 — and which of them went to another conversation**, in the same walk.
  let routedAway: RoutedAway | undefined
  for (const itemId of state.requestItems.values()) {
    const item = itemById(state, itemId)
    if (item === undefined || !isAwaitingAnswer(item)) continue
    if (item.kind === 'permission') permissions++
    else questions++
    if ((item.kind === 'permission' || item.kind === 'userInput') && item.routedTo !== undefined) {
      routedAway ??= { permissions: 0, questions: 0, to: item.routedTo }
      if (item.kind === 'permission') routedAway.permissions++
      else routedAway.questions++
    }
  }
  if (routedAway === undefined) delete state.routedAway
  else state.routedAway = routedAway
  state.pending = { permissions, questions }
}

/**
 * Record the decision this app sent for a permission card.
 *
 * ⚑ **503 · and who sent it.** `by` is assigned whether or not the row names anybody, which is
 * {@link whoCancelledIt}'s own rule one subject over: the field then says exactly what the ledger
 * says, and a card cannot inherit an actor from an earlier fold of the same request.
 */
export function markPermissionAnswered(
  state: TranscriptState,
  requestId: string,
  outcome: PermissionOutcome,
  by?: ActedBy,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'permission') {
    item.outcome = outcome
    item.note = null
    item.refused = null
    item.by = by
  }
  recountPending(state)
}

/** Record the answer this app sent for a user-input card. ⚑ **503 · and who sent it** — see
 *  {@link markPermissionAnswered}. */
export function markUserInputAnswered(
  state: TranscriptState,
  requestId: string,
  answered: 'answered' | 'rejected',
  by?: ActedBy,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'userInput') {
    item.answered = answered
    item.note = null
    item.refused = null
    item.by = by
  }
  recountPending(state)
}

/**
 * A response the host refused for a request that is GONE — already answered, unknown id, session
 * gone. The card stops being actionable.
 *
 * ⚠️ **It used to say *"or a fault nobody could classify"* and that clause is now unreachable**
 * (473, from `469` F2). An unclassified fault arrives at `noteAnswer` as `!ok` with no
 * {@link AnswerAck} at all, and this window cannot know from that whether the request was consumed
 * — so it goes to {@link markAnswerRefused} and the card stays live. ⛔ **Only a host that ANSWERED,
 * saying the request is gone, reaches this one.**
 */
export function markRequestFailed(
  state: TranscriptState,
  requestId: string,
  message: string,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'permission' || item?.kind === 'userInput') {
    item.note = message
    item.refused = null
  }
  // ⚑ **UI-009 · a question this conversation asked has no card of that kind** — its own card says
  // the host's words, and offers no answer again.
  const asked = questionSent(state, requestId)
  if (asked !== null) {
    asked.note = message
    delete asked.refused
  }
  recountPending(state)
}

/**
 * A response the host refused for a request that is **still pending** (146).
 *
 * The mirror of {@link markRequestFailed}, and deliberately the same shape so the two are read as
 * one decision with two outcomes rather than as a rule and an exception. See
 * {@link UserInputItem.refused}: this writes the sentence and changes nothing else, so the card
 * keeps its buttons, the panel keeps counting it and the composer stays frozen on a question that
 * really is still waiting.
 */
export function markAnswerRefused(
  state: TranscriptState,
  requestId: string,
  message: string,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'permission' || item?.kind === 'userInput') item.refused = message
  // ⚑ **UI-009 · and on a question this conversation asked**, which stays answerable.
  const asked = questionSent(state, requestId)
  if (asked !== null) asked.refused = message
  recountPending(state)
}

/* --- derived views of the fold (037) ------------------------------------------------------
 *
 * Everything below reads the state and decides nothing. They are exported so that a second
 * surface — the session panel — can be a PROJECTION of this fold rather than a parallel listener
 * on the same events. A second store would answer the same question twice and eventually give two
 * answers, which is worse than not answering it at all.
 */

/**
 * Whether this item is still waiting on the user, as opposed to settled by any of the four things
 * that can settle one: our own decision, the provider withdrawing it, teardown, or a refusal.
 *
 * Exported because two places need exactly this answer and must never disagree. The composer
 * freezes while something is unanswered and says so instead of accepting a message that answers
 * nothing; the panel lists precisely those items. Written twice, the two copies drift the first
 * time a fifth way to settle a card is added and only one of them learns about it.
 */
export function isAwaitingAnswer(item: TranscriptItem): boolean {
  if (item.kind === 'permission') return item.outcome === null && item.note === null
  if (item.kind === 'userInput') return item.answered === null && item.note === null
  return false
}

/**
 * What a list should key this item on — and for a CARD it is deliberately not `item.id` (064,
 * 061 finding 8).
 *
 * `item.id` is `${kind}_${seq}`, and `seq` restarts at zero in every fold. A re-fold therefore
 * renumbers everything; a list keyed on it sees rows it has never seen before, so it destroys the
 * components and builds new ones. For a message that is invisible. For a card it is what 061
 * measured: *"remounts existing interactive cards, discards typed answers, resets disclosure, and
 * can make an already-submitted permission decision clickable again."*
 *
 * A card has a name a re-fold cannot change — the provider's own request id, the same string the
 * decision goes back on. Everything else keeps its position, because for everything else position
 * IS the identity: an assistant block has no name of its own, and inventing one would be identity
 * theatre.
 *
 * Exported and living here rather than inside the component for the same reason
 * {@link isAwaitingAnswer} is: it is a rule about the fold, and a rule written inside a `.vue` file
 * is a rule that can only be tested by rendering one.
 */
export function itemKey(item: TranscriptItem): string {
  // The KIND is in the key as well as the id. Both adapters already refuse to reuse a request id
  // across the two kinds — Codex detects it as a collision, Claude routes one tool call to exactly
  // one broker — so this is hardening rather than a fix. It costs nothing and it means a provider
  // that ever did reuse one produces two distinct rows rather than two rows with the same key,
  // which is a rendered list quietly missing an entry.
  if (item.kind === 'permission' || item.kind === 'userInput') {
    return `request:${item.kind}:${item.request.id}`
  }
  return item.id
}

/**
 * ⛔ **Whether folding this event OPENS a turn** — the axis {@link ChangeLog.turn} counts (299 §2).
 *
 * ⚠️ **Stated once because a second consumer needed it, and pinned because saying it twice is how
 * two statements of one rule drift** (238). `carryForward` has to know how many turns the events it
 * is about to re-fold will open, so that a carried report's turn number means the same thing on
 * both sides of a window release — a base that was one out would put an old row inside *This turn*.
 *
 * ⚑ **`changes.test.ts` walks every event type in the schema and asserts this agrees with the fold
 * itself**, so the rule cannot be true here and different there.
 */
export function opensTurn(event: TranscriptEvent): boolean {
  return event.type === 'user_turn'
}

/**
 * Every sub-agent card in the transcript, however deep, paired with the transcript item that holds
 * it (037) — which is where a reader has to be taken to see it.
 *
 * The home is worked out STRUCTURALLY, by walking down from each item, rather than by reading
 * {@link TranscriptState.subAgentHomes}. That index answers a different question: it records the
 * immediate holder, and for a card nested inside another card's tool entry the holder is
 * `card:<agentId>` — not an item id at all, and nothing on screen to scroll to. Walking down gets
 * the item a grandchild is ultimately rendered inside, in one pass, with no chain to follow.
 */
export function cardHomes(state: TranscriptState): { card: SubAgentCard; itemId: string }[] {
  const out: { card: SubAgentCard; itemId: string }[] = []
  const walk = (cards: SubAgentCard[], itemId: string): void => {
    for (const card of cards) {
      out.push({ card, itemId })
      for (const row of card.body)
        if (row.kind === 'tool' && row.subAgents) walk(row.subAgents, itemId)
    }
  }
  for (const item of state.items) walk(cardsOf(item), item.id)
  return out
}

/**
 * Fold one event into the transcript, and stamp whatever it added with when it happened.
 *
 * The stamping is done HERE, around the fold, rather than inside each of its dozen branches:
 * every branch would have had to remember, and the one that forgot would be invisible. Items the
 * event MUTATES rather than adds — an assistant block taking another delta, a tool call receiving
 * its result — keep the time they were created with, which is when that message began.
 */
export function applyEvent(
  state: TranscriptState,
  event: TranscriptEvent,
  at?: number,
  ordinal?: number,
  humanFinal?: HumanFinalContext | null,
): void {
  const before = state.seq
  const from = state.items.length
  startHumanAnswer(state.humanAnswers, event, ordinal ?? state.seq)
  foldEvent(state, event, at, ordinal, humanFinal)
  followTheTurnsErrors(state, event, from)
  if ((at === undefined && ordinal === undefined) || state.seq === before) return
  // Walk back from the end while the items are ones this fold created. Counting by LENGTH would
  // have missed the commonest turn there is: text, a tool call, then more text — the authoritative
  // message drops the unconfirmed streamed block and pushes its own, so one item goes and one
  // arrives and the length never moves. New items are always appended, so this finds exactly them.
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (!item || itemSeq(item.id) <= before) break
    if (at !== undefined) item.at = at
    // ⚑ Stamped in the SAME walk, for the same reason: a dozen branches each remembering is a
    // dozen chances for one to forget, and the one that forgot would be invisible. See {@link Placed}.
    if (ordinal !== undefined) item.ordinal = ordinal
  }
}

/**
 * Keeps the rows this turn's errors drew, so a sign-in this app renewed can stand in for them, and
 * says the turn carried on once it did. A turn anybody else starts begins a new account.
 */
function followTheTurnsErrors(state: TranscriptState, event: TranscriptEvent, from: number): void {
  // A turn that failed on a refused sign-in is the turn a renewal follows: its ending folds too.
  if (
    event.type === 'error' ||
    (event.type === 'turn' && event.state === 'failed' && event.loginRefused === true)
  ) {
    for (const item of state.items.slice(from)) {
      if (item.kind === 'notice') state.turnErrorRows.push(item)
    }
    return
  }
  if (event.type !== 'user_turn') return
  const renewed = state.renewedLine
  if (event.carriesOn === true && renewed !== null) {
    if (event.carriedOnAfterAccountChange === true) {
      renewed.line.text = `${renewed.name} sign-in changed. The agent is carrying on.`
    } else if (renewed.replacedCopy === true) {
      renewed.line.text = A_RENEWED_SIGN_IN_SAYS.carriedOn(renewed.name)
    }
  }
  state.turnErrorRows = []
  state.renewedLine = null
}

/**
 * Nothing is running any more (029). A sub-agent card left mid-flight — the turn ended, or the app
 * was quit and the ledger replayed — must stop saying "running" about a process that is gone
 * (⚠️ 695: at a TURN, `sparing` names the agents that are NOT gone — see the loop's own note). It is
 * NOT given an outcome: "we were never told how it went" is a different fact from "it succeeded",
 * and only the provider gets to state the second one.
 *
 * 📌 **This is belt-and-braces since 075, and worth knowing which brace is which.** The adapters now
 * emit the missing ending into the STREAM at the same boundary
 * (`packages/runtime/src/internal/open-sub-agents.ts`), so an ordinary replay arrives here with the
 * cards already closed and this sweep finds nothing to do. It stays because it answers a question
 * the stream cannot: a ledger written before 075, or by anything that is not one of our adapters,
 * still has cards with no ending in it — and this is what makes those read honestly.
 *
 * ⚠️ It is also why 072 §5.1 mis-stated the defect. This line meant the UI was always right, so the
 * lie lived only in the record; a grep of `packages/runtime` and `apps/desktop` that missed it
 * concluded the card *"stays open forever — in the UI"*, and it never did.
 */
function stopRunningSubAgents(state: TranscriptState, sparing?: ReadonlySet<string>): void {
  // EVERY card, at every depth (035 review). This walked `cardsOf` — one level — which was the whole
  // truth until an agent's agent could nest inside a card's own tool entry. Adding a level without
  // widening this sweep left exactly the thing 029 wrote it to prevent: a grandchild still claiming
  // to be running, forever, about a process that ended with the turn.
  //
  // 🔴 **695 · …except an agent the provider still lists as running in the BACKGROUND**, which the
  // turn's own sweep passes as `sparing`. A backgrounded agent outlives its turn by definition, and
  // since `695` declared `perTaskStopAffordance` it outlives a Stop too — so marking its card ended
  // here drew *"finished"* over an agent the bar beside it still offers to stop. The session
  // boundaries pass nothing: the child's exit takes every task with it.
  for (const card of everyCard(state)) {
    if (sparing?.has(card.agentId) === true) continue
    card.running = false
  }
}

/**
 * The same claim, one component over: a tool row that never got its result (074, from 069 §2.3).
 *
 * `ToolEntry` reads `running` off the ABSENCE of a result, so a `Bash` the app was quit in the
 * middle of replays with its accent dot lit and the words "running…" beside it — about a process
 * that died with the session that started it. `markReopened` and `markReadOnly` already correct
 * exactly this claim for the activity pill, the thinking block, the plan's active step and every
 * sub-agent card, and their comments state the rule they were following: *"a pulsing 'running Bash'
 * in a transcript being READ is a statement about now, and it is false."* The tool row is the one
 * they name and the one they never swept.
 *
 * ⚠️ **It does not invent a result**, which is the whole reason this is a separate field rather than
 * a synthetic `{ ok: false }`. `stopRunningSubAgents` refuses the same shortcut for the same reason:
 * *"we were not told how it went"* is a different fact from "it failed", and only the provider gets
 * to state the second one. `unfinished` says the first and nothing more — and a real `tool_result`
 * arriving late still lands, because the fold writes `result` without ever consulting this flag.
 */
function stopOpenToolCalls(state: TranscriptState, sparing?: ReadonlySet<string>): void {
  // The conversation's own rows AND every child's, at every depth — a sub-agent's `Bash` is exactly
  // as dead as its parent's.
  //
  // ⛔ **Detached work is deliberately NOT swept here, and that is 248's own near-miss.** This
  // function is not only the session-death sweep: `case 'turn'` calls it at the end of EVERY turn,
  // which is precisely the boundary background work is defined to outlive. Marking it here would
  // have emptied the registry and flipped every card to *"did not finish"* at the exact instant
  // `245`'s window opens — the defect this task exists to end, inverted. See
  // {@link stopDetachedWork}, which the three session boundaries call and the turn does not.
  for (const row of everyToolRow(state)) {
    if (!row.result) row.unfinished = true
  }
  // ⛔ **658 · a messaging row that landed ahead of its call does not outlive the run that wrote
  // it** — see {@link TranscriptState.outgoingAhead}.
  state.outgoingAhead = []
  endMessageRun(state)
  // ⚑ **685 · …and neither does a refusal waiting for its receipt** — see
  // {@link TranscriptState.refusalsAwaitingReceipt}.
  state.refusalsAwaitingReceipt = []
  // A workflow whose session died is exactly as dead (108, on 074's rule). Its own tool row is
  // already marked above, but the tree draws its head from the RUN — so without this a reopened
  // conversation shows a blue running dot and a live phase, indefinitely, about agents that stopped
  // when the app did. `outcome` is deliberately left absent: none arrived, and inventing one here is
  // the failure the flag exists to avoid.
  //
  // 🔴 **D-003 · `738` P-3 — …except a run the provider still lists as running in the BACKGROUND**,
  // which the turn's own sweep passes as `sparing` (`stopRunningSubAgents`' rule since `695`). A
  // workflow outlives the turn that launched it; marking it here drew *"did not finish"* with its
  // agents not live, while the bar beside it listed it running, until the next progress frame
  // revived it (0.5–10 s, `smoke:ui` 57). The session boundaries pass nothing.
  for (const run of Object.values(state.workflows)) {
    if (!run.running) continue
    if (sparing?.has(run.taskId) === true) continue
    run.running = false
    run.unfinished = true
  }
}

/**
 * **Work that was left running cannot outlive the CONVERSATION either** (248, on 074's rule).
 *
 * ⛔ **A separate sweep from {@link stopOpenToolCalls}, and the separation is the whole point.** That
 * one is called by `case 'turn'` as well as by the three session boundaries, because a tool call
 * cannot outlive its turn. Detached work is defined by outliving exactly that — `247` measured a
 * command running for 26 seconds past the turn that started it — so hanging this on the same
 * function marked every card *"did not finish"* and emptied the registry at the instant `245`'s
 * window opens. Five independent readers of this diff found it before it shipped; the regression is
 * pinned in `background-work.test.ts` (*"a turn ending changes nothing"*).
 *
 * ⚠️ **It does not invent an outcome.** `unfinished` says only that no ending will ever arrive,
 * which is what turns a false *"still running"* into a true *"did not finish"* — and it is the one
 * sweep whose subject HAS a result, so `stopOpenToolCalls`'s own loop skips it by construction.
 *
 * ⚑ **`247` made the level self-correcting for a REPLAY** (`system/init` emits `running: []`). A
 * conversation that is closed, read-only, or reopened from a ledger never reaches an `init`, and
 * this is that door.
 */
function stopDetachedWork(state: TranscriptState): void {
  for (const row of everyToolRow(state)) {
    if (row.background && row.background.outcome === undefined) row.background.unfinished = true
  }
  // The registry is a claim about NOW, and the only true one here is that nothing of ours is
  // running. `dropped` goes with it: it describes a level that no longer stands.
  state.background = { running: [], dropped: 0 }
}

/**
 * Every tool row on screen, at every depth — the conversation's own and each sub-agent's (029/035).
 *
 * ⚑ **It replaces two loops that were already there**, spelled out one after the other in
 * {@link stopOpenToolCalls} because the conversation's rows and a card's rows live in different
 * places. 248 needed a third pass over the same set; naming the walk is what kept it from becoming a
 * third copy.
 */
function* everyToolRow(state: TranscriptState): Generator<ToolItem | SubAgentToolRow> {
  for (const item of state.items) if (item.kind === 'tool') yield item
  for (const card of everyCard(state)) {
    for (const row of card.body) if (row.kind === 'tool') yield row
  }
}

/**
 * ⛔ **What a receipt says about detachment**, or `undefined` when it says nothing — which is the
 * ordinary case and the answer for every foreground call (248).
 *
 * ⚠️ **Read from `backgrounded` and from nothing else.** Two other readings were available and both
 * are traps `247` §3 named:
 *
 *  - **The receipt's wording.** *"Command running in background with ID: …"* is the provider's
 *    sentence; it has already changed shape across pins, and the sub-agent door says something
 *    different again (*"Async agent launched successfully"*). The flag beside it is derived from the
 *    level set, which is a fact.
 *  - ⛔ **The presence of `backgroundId`.** Codex attaches a `processId` to **every** PTY-backed
 *    command, foreground included. A card gated on having an id would put "still running" on
 *    finished commands and a stop button beside them — the false-settled card's mirror image, and on
 *    an adapter that implements no stop at all.
 */
function detachment(
  event: Extract<RuntimeEvent, { type: 'tool_result' }>,
): DetachedWork | undefined {
  if (event.backgrounded !== true) return undefined
  // An empty object is the honest shape for "detached, and the provider named no stop key": the
  // presence of `background` is the flag, and `id` is what a stop control needs to exist.
  return event.backgroundId === undefined ? {} : { id: event.backgroundId }
}

/**
 * The tool row a provider call landed on — the conversation's own {@link ToolItem}, or the
 * {@link SubAgentToolRow} on the card of whichever agent made it (035).
 *
 * ⚠️ **Two lookups because there are two homes, and the id index is different in each.** A
 * top-level row is in `toolItems`; a child's call is deliberately not, and is reachable through
 * `cardTools` instead — see {@link cardOwningTool}.
 */
function toolRowFor(
  state: TranscriptState,
  callId: string,
): ToolItem | SubAgentToolRow | undefined {
  const item = itemById(state, state.toolItems[callId])
  if (item?.kind === 'tool') return item
  const card = cardOwningTool(state, callId)
  return card?.body.find(
    (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === callId,
  )
}

/**
 * 🔴 **F081 · frames a provider sends as housekeeping, by the label the row was stored with** —
 * folded as the quiet lifecycle frame whatever category the row carries, so the rows recorded
 * before the normalizer gave them a quiet category (F035's `command_lifecycle`, before 2026-10-03
 * 15:28; Claude's `vcs_state_changed`, a checkout's commit or branch; its `ping` keepalive, stored as
 * an incomplete stream frame) draw nothing outside debug mode, as new ones do. ⚑ No row in the database changes.
 */
const QUIET_BY_ITS_LABEL: ReadonlySet<string> = new Set([
  'command_lifecycle',
  'vcs_state_changed',
  // ⚑ Claude's `{"type":"ping"}` stream keepalive, once stored as a malformed frame (W1, F081).
  'ping (incomplete)',
])

/**
 * 🔴 **F035 — the line a turn the host names a scheduled job for draws**: *"Woken by its scheduled
 * job (14:45): check the deploy"*, with the day too when the turn began on another one. ⛔ The prompt
 * is the model's own and may come from a page it read, so it goes through the schedule bar's own
 * guard ({@link scheduleLine}): quoted when it holds a line break or a reordering character, and
 * clipped where the bar clips it.
 */
function wokenWords(
  job: NonNullable<Extract<TranscriptEvent, { type: 'provider_turn' }>['oneShotCameDue']>,
  at: number | undefined,
): string {
  const due = at === undefined ? clockTime(job.dueAt) : clockTimeFrom(job.dueAt, at)
  const woken = due === '' ? 'Woken by its scheduled job' : `Woken by its scheduled job (${due})`
  const asks = scheduleLine({
    id: job.id,
    ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
  }).asks
  if (asks === undefined) return woken
  return `${woken}: ${asks.text}${asks.cut > 0 ? '…' : ''}`
}

/**
 * ⚑ **D-017 · R11 — one scheduled job, with the moment this fold first saw it listed** — carried from
 * the level before while the id stays listed, or from the rows it took off (F035,
 * {@link ScheduleRegistry.left}), else the frame's own moment. ⛔ A copy, never the
 * event's own object: `carryForward` hands the registry to the next fold.
 *
 * ⚠️ **Not *when it was made*** — the level has no history in it (`253`) — but the level is stated at
 * the end of the turn that made the job, so it is the moment the provider first SAID the job exists,
 * and `shared/agent-state.ts`'s `nextWake` reads a one-shot's time from it. Absent only when the
 * frame carries no moment, and then no one-shot's time is promised.
 */
function listedSinceOf(
  before: ScheduleRegistry,
  job: ScheduledJob,
  at: number | undefined,
): ScheduledRow {
  const listed = (one: ScheduledRow): boolean => one.id === job.id
  const since = (before.jobs.find(listed) ?? before.left.find(listed))?.listedSince ?? at
  return since === undefined ? { ...job } : { ...job, listedSince: since }
}

/**
 * 🔴 **One level row, with the command it is running** — see {@link BackgroundRegistry} (251 §2).
 *
 * ⚠️ **`toolRowFor` rather than `state.toolItems`, and a sub-agent's own `Bash` is why.** `248` §5
 * measured that a dispatched agent joins the level set, and nothing stops that child backgrounding a
 * command of its own — one level down, on a card row that is deliberately not in the top-level
 * index. A lookup that only knew the conversation would have shown the description for exactly the
 * rows hardest to identify from it.
 *
 * ⚠️ **The FIRST frame of a piece of work resolves nothing, and that is measured, not a race we
 * lost.** `background_tasks_changed` is emitted before `task_started`, and `task_started` is what
 * carries `tool_use_id` into the binding `snapshot()` reads — so the first level payload has no
 * `toolCallId` on its rows at all. `248` §5's own capture has the two frames in the same millisecond.
 * The row shows the provider's description for that one frame and the command from the next.
 *
 * ⛔ **The previous answer is the second source, and it is what survives a slab release.** After a
 * release the items are rebuilt from the retained suffix while the registry is CARRIED, so the call
 * that started long-running work can genuinely be gone from the fold while the work runs on. Without
 * this the next level frame would take the command back off a row that had not changed.
 */
function withCommand(state: TranscriptState, row: BackgroundWork): BackgroundRow {
  const call = row.toolCallId === undefined ? undefined : toolRowFor(state, row.toolCallId)
  // ⚠️ `summary` is `z.string()` with no minimum, so an empty one is a shape the wire allows. It
  // falls through to the description rather than being carried as a command with nothing in it —
  // `backgroundWhat` would have to reject it a second time, and two places deciding one thing is how
  // they stop agreeing.
  const command =
    call !== undefined && call.summary !== ''
      ? { name: call.name, text: call.summary }
      : state.background.running.find((previous) => previous.id === row.id)?.command
  return command === undefined ? { ...row } : { ...row, command }
}

/**
 * # 🔴 **The LEVEL says this call's work is still going, so its card must stop saying it did not
 * finish** (287 §1, finding 1 — `280`'s fix-first).
 *
 * ## ⛔ The screen said both things at once, on every ordinary Codex command
 *
 * Codex's detachment stream is `tool_call` → `turn/completed` → `background_work.running`, and there
 * is **no `item/completed` and no `tool_result`, ever** — measured on the live wire by `275`, watched
 * for 30 seconds after the process had been killed. So the turn ends first, {@link stopOpenToolCalls}
 * finds a tool row with no result and marks it `unfinished`, and the level that arrives next updated
 * {@link TranscriptState.background} and nothing else. The bar then said **still running**, with a
 * working Stop; the card beside it said **did not finish**, whose sentence is *"the conversation
 * running it is gone, so nothing will ever report how it ended"*. Both about one live process.
 *
 * ⚠️ **Claude never took this path**, which is why nothing caught it: its `tool_result.backgrounded`
 * seeds `row.background` before the turn sweep can run, and every desktop test used that
 * Claude-shaped receipt.
 *
 * ## ⚑ What this states, and what it refuses to
 *
 * It writes the work's IDENTITY onto the card — the provider's own stop key — and clears the
 * *"we stopped watching"* flag that the level contradicts. It invents **no result and no outcome**:
 * `247`'s rule that `ok` was never wrong holds unchanged, and a card whose ending really has arrived
 * is left exactly as it is, because {@link DetachedWork.outcome} is a fact the provider stated and a
 * level is only ever a claim about now. That ordering is `backgroundState`'s own precedence, applied
 * one layer up so the two cannot disagree.
 *
 * ⚑ **Every card this seeds has a route to its own ending, and that is structural rather than
 * hopeful.** The row is only taken when it carries a `toolCallId`, and `endingsBetween` builds the
 * ending from that same field on that same row — so a card that can be marked running can always be
 * found again when the work leaves the level. The remaining door, for a conversation that closes
 * before either, is {@link stopDetachedWork}, unchanged.
 *
 * ## ⛔ Why this is not the `backgroundId` trap {@link detachment} refuses
 *
 * That rule — *"never from having a `backgroundId`"* — exists because Codex attaches a `processId` to
 * **every** PTY-backed command, foreground included, so a card gated on the id would put *"still
 * running"* on finished ones. ⚠️ **This is gated on the LEVEL, which is a different fact**: the level
 * is read at a turn boundary and nowhere else, so a row in it is by definition work that outlived its
 * turn. ⛔ **Which makes finding 2 the load-bearing half of this dispatch and not a separate ticket**
 * — a stale `turn/completed` that lists a foreground command would now poison that command's card as
 * well as the bar, so the two fixes ship together or neither does.
 */
function markLevelRunning(state: TranscriptState, running: readonly BackgroundRow[]): void {
  for (const item of running) {
    if (item.toolCallId === undefined) continue
    const call = toolRowFor(state, item.toolCallId)
    // ⚠️ **A row with nowhere to land is the ordinary case, not a miss.** The call may be behind a
    // released slab (`carryForward` keeps the registry and not the items), or the level may name work
    // this conversation's fold has never seen. The bar still shows it; there is simply no card here.
    if (call === undefined || call.background?.outcome !== undefined) continue
    const detached: DetachedWork = { ...call.background, id: item.id }
    delete detached.unfinished
    call.background = detached
  }
}

/**
 * The card for `agentId`, wherever it was placed (029) — the tool row that dispatched it, or the
 * standalone item standing in for a parent that never arrived. Found by identity, so a `progress`
 * that lands after a dozen other events still updates the right card.
 */
function findCard(state: TranscriptState, agentId: string): SubAgentCard | undefined {
  const home = itemById(state, state.subAgentHomes[agentId])
  if (home?.kind === 'tool') return home.subAgents?.find((card) => card.agentId === agentId)
  if (home?.kind === 'subAgent') return home.card
  // A card nested inside another CARD has no item to be found through (035): its home is recorded
  // as `card:<agentId>` precisely because there is no item id to record. Correlation is still by
  // identity — the same rule 029 set — it just has to walk the tree to do it.
  if (state.subAgentHomes[agentId] !== undefined) {
    return findCardWhere(state, (card) => card.agentId === agentId)
  }
  return undefined
}

/** Every card held by an item, whichever kind of home it is. */
function cardsOf(item: TranscriptItem | undefined): SubAgentCard[] {
  if (item?.kind === 'tool') return item.subAgents ?? []
  if (item?.kind === 'subAgent') return [item.card]
  return []
}

/**
 * Every card in the transcript, however deep (035).
 *
 * Nesting is recursive now — an agent's agent hangs off the call that dispatched it, inside its
 * parent's card — so any lookup that used to walk `state.items` has to walk the tree instead. The
 * depth is the agent's own doing and nothing here bounds it; in practice it is one or two.
 *
 * Exported since 137 for `carryForward`, which has to know which agents a fold is holding before it
 * throws that fold away. It is the only reader outside this file and it reads, never writes.
 */
export function everyCard(state: TranscriptState): SubAgentCard[] {
  const out: SubAgentCard[] = []
  findCardWhere(state, (card) => {
    out.push(card)
    return false // never satisfied, so the walk is exhaustive
  })
  return out
}

/**
 * The first card anywhere in the tree that satisfies `match` (035).
 *
 * Short-circuiting, and deliberately so: the lookups that run on EVERY tool call go through here,
 * and materializing the whole tree to find one card would make a long transcript quadratic. Only the
 * turn-end sweep, which genuinely wants all of them, pays for the array.
 */
function findCardWhere(
  state: TranscriptState,
  match: (card: SubAgentCard) => boolean,
): SubAgentCard | undefined {
  const walk = (cards: SubAgentCard[]): SubAgentCard | undefined => {
    for (const card of cards) {
      if (match(card)) return card
      // Walked in place rather than through a `.filter(…)` of the tool rows: this runs on every tool
      // call, and materializing an array per card is exactly the quadratic cost the comment above
      // says this function exists to avoid.
      for (const row of card.body) {
        if (row.kind !== 'tool' || !row.subAgents) continue
        const hit = walk(row.subAgents)
        if (hit) return hit
      }
    }
    return undefined
  }
  for (const item of state.items) {
    const hit = walk(cardsOf(item))
    if (hit) return hit
  }
  return undefined
}

/**
 * The card holding `callId` among its OWN tool calls, if any (035) — the second half of the parent
 * lookup, for a dispatch that happened inside a sub-agent rather than in the conversation.
 */
function cardOwningTool(state: TranscriptState, callId: string): SubAgentCard | undefined {
  const agentId = state.cardTools[callId]
  if (agentId === undefined) return undefined
  return findCardWhere(state, (card) => card.agentId === agentId)
}

/**
 * The card a sub-agent's OWN tool call belongs to, addressed by the dispatching tool-use id (029).
 *
 * A sub-agent's tool blocks carry `parent_tool_use_id`, which is that same id — so this is
 * the one lookup that goes the other way round from {@link findCard}: from the parent's id to
 * whichever card hangs off it. `undefined` means the child's call arrived before its
 * `task_started`, in which case it renders in the conversation rather than being swallowed.
 */
function cardFor(state: TranscriptState, parentToolCallId: string): SubAgentCard | undefined {
  const parent = itemById(state, state.toolItems[parentToolCallId])
  const onParent = cardsOf(parent).find((card) => card.parentToolCallId === parentToolCallId)
  if (onParent) return onParent
  // Anywhere else in the tree: still waiting at top level for this very row, or already nested
  // inside another agent's card because the dispatching call was that agent's own (035).
  return findCardWhere(state, (card) => card.parentToolCallId === parentToolCallId)
}

/**
 * Put a new card in its home: inside the dispatching row when it exists, inside the dispatching
 * CALL when that call belongs to another agent (035), else at top level.
 */
function placeCard(state: TranscriptState, card: SubAgentCard): SubAgentCard {
  const parentCallId = card.parentToolCallId ?? ''
  const parent = itemById(state, state.toolItems[parentCallId])
  if (parent?.kind === 'tool') {
    parent.subAgents = [...(parent.subAgents ?? []), card]
    state.subAgentHomes[card.agentId] = parent.id
    return card
  }
  if (nestUnderCardTool(state, card, parentCallId)) return card
  const id = nextId(state, 'subAgent')
  state.items.push({ kind: 'subAgent', id, card })
  state.subAgentHomes[card.agentId] = id
  return card
}

/**
 * Hang `card` off the call that dispatched it, when that call lives inside another agent's card
 * (035). True if it found a home.
 *
 * The home id is recorded as `card:<agentId>` rather than an item id, because there is no item —
 * the holder is a tool entry on a card. Nothing dereferences it: {@link itemById} returns undefined
 * for it, which is exactly what {@link rehome}'s "already nested, leave it alone" guard wants.
 */
function nestUnderCardTool(
  state: TranscriptState,
  card: SubAgentCard,
  parentCallId: string,
): boolean {
  const owner = cardOwningTool(state, parentCallId)
  const entry = owner?.body.find(
    (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === parentCallId,
  )
  if (!owner || !entry) return false
  entry.subAgents = [...(entry.subAgents ?? []), card]
  state.subAgentHomes[card.agentId] = `card:${owner.agentId}`
  return true
}

/**
 * Merge a usage report into the one the card already has, never letting a counter go BACKWARDS
 * (029).
 *
 * These are cumulative counters reported by different messages, and the last one is not
 * necessarily the largest: the live capture has a `task_notification` carrying `tool_uses: 0` — a
 * summary of the whole run written by a different path from the heartbeats. Taking it verbatim let
 * the header say "0 tools" while the card's own body listed the calls we had watched it make, and
 * two numbers on the same card contradicting each other is worse than either being absent.
 */
function mergeUsage(
  current: SubAgentCard['usage'],
  next: NonNullable<SubAgentCard['usage']>,
): SubAgentCard['usage'] {
  const keep = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.max(a, b)
  const tokens = keep(current?.tokens, next.tokens)
  const toolCalls = keep(current?.toolCalls, next.toolCalls)
  const ms = keep(current?.ms, next.ms)
  return {
    ...(tokens !== undefined ? { tokens } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(ms !== undefined ? { ms } : {}),
  }
}

/**
 * Drop the prose run that is the card's `summary` said a second time (131, from 130's review).
 *
 * ⚑ **Measured, not hypothetical.** In `sess_6b4380fa` ordinal 1776 is the child's forwarded
 * `assistant_message` and ordinal 1779 is the terminal `sub_agent.summary`: 357 characters each,
 * exactly equal. An older run holds the same collision at **3,970** characters. Before 128 the loose
 * prose and the summary were on different surfaces and the repeat was invisible; with the words
 * owned, both copies land inside one expanded card and the child's answer is drawn twice.
 *
 * ⛔ **The SUMMARY is what survives, and the prose is what goes.** The card already has one place
 * for an answer and it is rendered as one (`SubAgentEntry`'s `.answer`), so keeping the body row
 * instead would move the answer's position depending on whether the provider happened to forward
 * the text — the same sentence in two places on two runs. `hasBody` counts the summary, so a card
 * whose only row was the echo still opens.
 *
 * Called from both directions — the summary arriving after the prose is the ordinary case, the
 * reverse is the late-card one — because a rule that holds in one order is not a rule.
 *
 * ## What the rule is, after 136 measured what text equality alone does (137)
 *
 * The rule this replaced was *"remove the most recent prose row whose trimmed text equals the
 * summary"*, and 136's verdict on it was exact: ⛔ *"no provenance saying that row was the
 * completion echo, no adjacency requirement, and no memory that an echo has already been removed."*
 * Three deterministic failures followed, and each of the three clauses below answers one of them.
 *
 *  - **TERMINAL-ADJACENT.** Only the run of prose at the END of the body can be the echo. The old
 *    backward scan walked past intervening tools and past later, different prose to delete an
 *    EARLIER identical sentence — `says(S) · tool · says(D) · ended(summary=S)` moved the child's
 *    opening sentence from before its work to the terminal summary. A sentence with the child's own
 *    work after it is not the last thing it said, so it is not the echo of the last thing it said.
 *  - **ONE-SHOT.** {@link TranscriptState.echoedAnswers} remembers the answer already taken, so
 *    `ended(summary=S) · says(S) · tool · says(S)` — the late-card order — loses the echo and keeps
 *    the genuine repeat. The old rule removed both, and the card then showed a tool and nothing the
 *    child had said.
 *  - **THE WHOLE TRAILING RUN, not one row.** An answer forwarded as two messages while the summary
 *    is both of them joined matched no single row, so the duplicate this function exists to prevent
 *    survived — the failure in the other direction. Compared with whitespace normalized, which also
 *    settles the split's join: two forwarded blocks are separated by SOME whitespace or none, and
 *    which one is not a fact worth depending on.
 *
 * ⚠️ **A child that genuinely repeats itself mid-run still keeps both copies** — that is the
 * terminal-adjacent clause read the other way, and it is the negative bound the removal is allowed
 * to have. ⛔ **And a summary with no matching prose still renders**, which is what stops the whole
 * rule being satisfiable by discarding every summary.
 */
function dropEchoedProse(state: TranscriptState, card: SubAgentCard): void {
  const answer = normalizeSpeech(card.summary)
  if (!answer) return
  // Already answered for this exact sentence. A DIFFERENT summary — a restatement that grew — is a
  // different sentence and gets its own single removal.
  if (state.echoedAnswers[card.agentId] === answer) return
  let run = ''
  for (let index = card.body.length - 1; index >= 0; index--) {
    const row = card.body[index]
    // The first thing that is not prose ends the run: the child did something after saying this, so
    // nothing at or before it is the last thing it said.
    if (row?.kind !== 'prose') return
    run = run ? `${row.text} ${run}` : row.text
    if (normalizeSpeech(run) !== answer) continue
    card.body.splice(index, card.body.length - index)
    state.echoedAnswers[card.agentId] = answer
    return
  }
}

/**
 * The comparable form of something that was said — whitespace collapsed, ends trimmed.
 *
 * ⚠️ **Not cosmetic.** It is what makes a summary forwarded as two blocks comparable with the two
 * rows it was split into, whatever the provider put between them, and it is also why a summary that
 * differs from its echo only in trailing newlines is still recognised as the same sentence — 136
 * found both of those surviving the exact-equality version.
 */
function normalizeSpeech(text: string | undefined): string {
  return text === undefined ? '' : text.replace(/\s+/g, ' ').trim()
}

/**
 * Move a top-level card into its dispatch row once that row is known (029).
 *
 * Placement cannot be decided once and for all, because the phases disagree about parentage:
 * `task_updated` never carries the dispatch id, and a card can therefore be created — or merely
 * updated — by a message that does not know where it belongs. Re-evaluating on every phase is what
 * stops a card that arrived parentless from staying stranded at top level for the whole session
 * while its row sits visibly above it.
 *
 * Only ever moves top-level -> nested. A card already inside a row stays there: nothing later
 * should be able to tear it out of the story it is part of.
 */
function rehome(state: TranscriptState, card: SubAgentCard): void {
  if (!card.parentToolCallId) return
  const current = itemById(state, state.subAgentHomes[card.agentId])
  if (current?.kind !== 'subAgent') return // already nested, in a row or in another card
  const drop = (): void => {
    const index = state.items.findIndex((item) => item.id === current.id)
    if (index >= 0) state.items.splice(index, 1)
  }
  const parent = itemById(state, state.toolItems[card.parentToolCallId])
  if (parent?.kind === 'tool') {
    drop()
    parent.subAgents = [...(parent.subAgents ?? []), card]
    state.subAgentHomes[card.agentId] = parent.id
    return
  }
  // The grandchild case (035): the dispatching call is not a row in the conversation, it is one of
  // another agent's own calls. Checked SECOND because a real row is the stronger claim — a call id
  // cannot be both, but if it somehow were, the conversation is where the reader is looking.
  // `nestUnderCardTool` touches nothing when it finds no home, so a miss leaves the card where it is.
  if (nestUnderCardTool(state, card, card.parentToolCallId)) drop()
}

/**
 * Pull the child's own rows — what it DID and what it SAID — out of the conversation and onto its
 * card (029, extended to speech in 131).
 *
 * A sub-agent's tool blocks and its `task_started` arrive on DIFFERENT messages, so the child can
 * be seen working before it is known to exist. In that window {@link cardFor} finds nothing and the
 * call renders as the parent's own — the precise misattribution this task set out to end, surviving
 * as a race. The rows remember whose they were, so the card takes them back when it appears.
 *
 * ⚑ **ONE backward walk over `state.items`, and that is what recovers the ORDER.** 130 named the
 * cost of doing this — *"two reclaimed sequences have to be interleaved, and neither remembers when
 * it arrived"* — and the premise is false here by construction: `state.items` IS arrival order, so
 * a walk that takes both kinds in one pass and `unshift`s each finds them already interleaved.
 * Nothing has to remember a time, because nothing has to be re-sorted. Two sweeps, one per kind,
 * would have had exactly the problem described; that is the reason this is not two sweeps.
 */
function reclaimChildRows(state: TranscriptState, card: SubAgentCard): void {
  if (!card.parentToolCallId) return
  const reclaimed: string[] = []
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (!item) continue
    // Words the child said before its card existed (131). They become an ordinary prose run in the
    // body, indistinguishable from one that arrived after — because that is what they are.
    if (item.kind === 'assistant') {
      if (item.parentToolCallId !== card.parentToolCallId) continue
      state.items.splice(index, 1)
      card.body.unshift({ kind: 'prose', id: nextId(state, 'says'), text: item.text })
      continue
    }
    if (item.kind !== 'tool' || item.parentToolCallId !== card.parentToolCallId) continue
    state.items.splice(index, 1)
    delete state.toolItems[item.callId]
    // It stops being a row and becomes a dispatch point (035): same id, different kind of home.
    state.cardTools[item.callId] = card.agentId
    // ⛔ **Everything the row had, not only what it was born with** (248, found reviewing this diff).
    //
    // This literal REBUILDS the row rather than moving it, so any field the row acquired after its
    // `tool_call` is dropped on the floor — silently, in the one path that exists BECAUSE the card
    // arrived late, which is exactly when a row has had time to acquire something.
    //
    // ⚠️ **`unfinished` was already being lost, since 074**, and nothing noticed: a child's call
    // swept by a session boundary and then reclaimed came back reading *"running…"* about a dead
    // process. `background` would have joined it — the detachment fact, gone from the one row a
    // reader would go looking for it on.
    card.body.unshift({
      kind: 'tool',
      callId: item.callId,
      name: item.name,
      summary: item.summary,
      ...(item.result ? { result: { summary: item.result.summary, ok: item.result.ok } } : {}),
      ...(item.unfinished === true ? { unfinished: true } : {}),
      ...(item.background ? { background: { ...item.background } } : {}),
    })
    card.lastTool = item.name
    reclaimed.push(item.callId)
  }
  // A sentence reclaimed AFTER the ending already set the summary is the same sentence twice — the
  // ordinary shape when the card arrives late, so the echo is dropped here as well as on arrival.
  //
  // ⚑ **Unconditional again, and that is 137 removing a guard rather than adding one.** This used to
  // run only `if (tookWords)`, because the `sub_agent` case above has already de-duplicated for
  // `event.summary` and a second unconditional pass removed a SECOND row — a child that legitimately
  // repeated a sentence lost both copies. The memory in {@link TranscriptState.echoedAnswers} is what
  // that guard was standing in for, and it holds on every path rather than on this one: an echo is
  // one event said twice, so the second call finds the answer already taken and does nothing. One
  // rule, in one place, instead of a rule and a proxy for it.
  dropEchoedProse(state, card)
  // A card that was waiting on one of those calls can now find it — but only the calls that just
  // MOVED (035 review). Sweeping every entry would re-walk the whole tree on each progress
  // heartbeat, once per call the card has ever made, to re-discover nothing.
  for (const callId of reclaimed) adoptOrphans(state, callId)
}

/**
 * Move any top-level card that was waiting for `callId` into the row that just arrived (029).
 *
 * This is what makes the nesting a claim about IDENTITY rather than about ordering. In practice the
 * dispatch row always comes first — the `Task` block is in the assistant message that causes the
 * sub-agent to exist — so this path is the guard, not the norm, and it exists because a rule that
 * only holds when events are well-ordered is not a rule.
 */
/**
 * Put `run` on the tool row that launched it, if that row is on screen (108).
 *
 * ⚠️ **It assigns the SAME object rather than a copy**, so the registry and the row cannot drift.
 * That is what lets the drawer read one fold and the transcript read the other and always agree —
 * `session-panel`'s rule, one level down.
 *
 * Silent when there is no anchor yet (a `task_updated` arriving first) and when the row has not
 * appeared: the run stays in the registry and the next frame tries again.
 */
function attachWorkflow(state: TranscriptState, run: WorkflowRunCard): void {
  if (run.toolUseId === undefined) return
  const home = itemById(state, state.toolItems[run.toolUseId])
  if (home?.kind !== 'tool') return
  home.workflow = run
}

/**
 * Move any workflow that was waiting for `callId` onto the row that just arrived (108).
 *
 * The mirror of {@link adoptOrphans} for runs, and it exists for the same stated reason: in every
 * measured conversation the `Workflow` tool call leads its first `task_started` by six events, so
 * this is the guard rather than the norm — and a nesting rule that only holds when events are
 * well-ordered is not a rule.
 */
function adoptWorkflows(state: TranscriptState, callId: string): void {
  for (const run of Object.values(state.workflows)) {
    if (run.toolUseId === callId) attachWorkflow(state, run)
  }
}

function adoptOrphans(state: TranscriptState, callId: string): void {
  const home = state.toolItems[callId]
  const parent = itemById(state, home)
  // A dispatching call that lives on a CARD rather than in the conversation adopts just the same
  // (035) — `rehome` already knows how, and going through it keeps one description of what a home is.
  if (parent?.kind !== 'tool') {
    if (state.cardTools[callId] === undefined) return
    for (const card of [...everyCard(state)]) {
      if (card.parentToolCallId === callId) rehome(state, card)
    }
    return
  }
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]
    if (item?.kind !== 'subAgent' || item.card.parentToolCallId !== callId) continue
    state.items.splice(index, 1)
    parent.subAgents = [item.card, ...(parent.subAgents ?? [])]
    state.subAgentHomes[item.card.agentId] = parent.id
  }
}

/**
 * Set an optional field, or REMOVE it when the event no longer carries one (028). Plain assignment
 * would leave `note: undefined` on the item, which reads as present-but-empty to anything doing a
 * key check — and Codex's `explanation` really does go from absent to set within one plan, so the
 * reverse direction has to work too.
 */
function setOptional<K extends 'note'>(item: PlanItem, key: K, value: string | undefined): void {
  if (value === undefined) delete item[key]
  else item[key] = value
}

/** The counter value an item was created with, read back out of its id. */
function itemSeq(id: string): number {
  return Number(id.slice(id.lastIndexOf('_') + 1))
}

/**
 * ⛔ **Did another conversation write these words?** (413) — asked of the stored value, not of the
 * type.
 *
 * ⚠️ **`isAWorkReport` one field over states the reason and this inherits it**: a replayed event is
 * broadly cast after `JSON.parse`, `boundStoredEvent` has no arm for this key, and a row written by
 * a later build — or edited — can carry anything here. ⛔ A truthiness check would let `{}` or `0`
 * decide which entry a person reads.
 *
 * The navigation id is separately bounded by {@link relayNavigation}; this check decides authorship.
 */
/** Authorship is retained even when its navigation target cannot be used. */
function relayNavigation(value: unknown): { relayedFrom?: string } {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    ? { relayedFrom: value }
    : {}
}

function wasRelayed(relayedFrom: unknown): boolean {
  return typeof relayedFrom === 'string' && relayedFrom.length > 0
}

/**
 * ⚑ **This app's own report rides the row** — {@link AppNoticeItem.notice}'s reading: a non-empty
 * string, like {@link wasRelayed}'s, because a notice word this build has no sentence for is still
 * a notice and never the go-ahead.
 */
function carriesANotice(appNotice: unknown): appNotice is string {
  return typeof appNotice === 'string' && appNotice.length > 0
}

/**
 * ⛔ **WHO relayed them, as the stored value actually is** (545) — {@link wasRelayed}'s discipline,
 * one field over, and asked for the same reason.
 *
 * ⚠️ **Replay is a trust boundary**, so this reads a non-empty STRING rather than anything truthy:
 * a row edited on disk must not be able to put an object where a person reads a heading.
 * ⚑ **The LENGTH is the store's question and not this one** — `boundRelayedIdentity` drops a slug
 * that is not one — so this stays the same two-line shape as its neighbour rather than becoming a
 * second opinion about a format `runtime-ipc.ts` owns.
 *
 * ⛔ **`undefined` is *this app cannot name the relayer*** and the surface has a word for it; it is
 * never spelled as an empty string, which would be a heading nobody can read.
 */
function relayerIdentity(relayedFromProfile: unknown): string | undefined {
  return typeof relayedFromProfile === 'string' && relayedFromProfile.length > 0
    ? relayedFromProfile
    : undefined
}

/**
 * `at` is passed in for the one thing the stamping above cannot do: a `tool_result` MUTATES the
 * call's item instead of adding one, so the moment it landed has nowhere else to be recorded —
 * and without it a tool's duration would have to be invented.
 */
function foldEvent(
  state: TranscriptState,
  event: TranscriptEvent,
  at?: number,
  ordinal?: number,
  humanFinal?: HumanFinalContext | null,
): void {
  switch (event.type) {
    case 'user_turn': {
      const moved = moveOriginOf(event.movedFrom)
      if (moved !== undefined) {
        const uncertain = state.items.find(
          (one) =>
            one.kind === 'queued' &&
            one.outcome === 'handover' &&
            one.movedFrom?.sessionId === moved.sessionId &&
            one.movedFrom.requestId === moved.requestId,
        )
        if (uncertain !== undefined) state.items.splice(state.items.indexOf(uncertain), 1)
      }
      // 🔴 **D-027 · a turn that delivered several messages draws EACH of them** — as the turn of
      // one message it would have been, so each is drawn by the entry its own authorship picks,
      // under its own sender line — ⚑ and counts ONE turn: the Changes pane's axis (096) is where a
      // prompt begins, and this is one prompt. ⚠️ A part carries no parts, so this goes one level
      // down and no further; ⚑ a turn of one message, and every row written before D-027, takes
      // the arm below exactly as it always did.
      // ⛔ **A row with parts is never drawn as the turn itself** ({@link theMessagesOf}): its top
      // level carries no authorship, and drawn it would be the person's. ⚑ A part that reads is
      // drawn even alone; when none does, the words are drawn as this app's — the entry that
      // claims least, never "You". Reachable only from a row another build wrote, or one edited.
      if (event.parts !== undefined) {
        const messages = theMessagesOf(event)
        const drawn: readonly UserTurnPart[] =
          messages.length > 0 ? messages : [{ text: event.text, attribution: 'app_authored' }]
        const turns = state.changes.turn
        const from = state.items.length
        for (const one of drawn) foldEvent(state, { ...one, type: 'user_turn' }, at, ordinal)
        state.changes.turn = turns + 1
        // ⚑ The turn was handed over as ONE text, so each message drawn from it keeps that text,
        // and says it was handed over with the others.
        keepWhatWasSent(state, event.sent, from)
        return
      }
      endMessageRun(state)
      // Our own turn, echoed back by the host once the runtime accepted it. It arrives on
      // the stream like everything else, so a turn sent live and the same turn replayed on
      // resume land in the transcript by the same path.
      closeStreaming(state)
      // ⚠️ **A new turn inherits no activity from the last one** (099). The `turn` event clears this
      // field, but an activity that arrives AFTER that event is never cleared — 32% of them arrive
      // with no turn open — so without this line the next turn would open refined by a phase that
      // belongs to the previous one. `sessionDoing`'s precedence already makes a stale phase
      // harmless while the session is idle; this is what stops it becoming harmful again the moment
      // the session is not. A `{phase:'tool', detail:'Bash'}` left over from ten minutes ago would
      // otherwise put 089's exact sentence back on screen for the frame before the real phase lands.
      state.activity = null
      // ⚠️ **Nor any memory of what the LAST turn's errors said** (246 §1). A turn can be opened
      // without the previous one emitting a `turn` event — a session quit mid-turn and replayed, or
      // an imported ledger with back-to-back prompts — and an old cause left here would silence this
      // turn's ending, which is a fact removed rather than a duplicate.
      state.lastError = null
      // 🔴 **The one turn nobody typed** (278 §1, from 276). Everything above this line is turn
      // bookkeeping and applies to it unchanged — it IS a turn, the provider received it, and the
      // previous turn's activity and error memory have to go. What differs is only whose words
      // these are, so only the ITEM differs.
      // ⛔ **The SUBJECT picks the entry, and the authorship picks whether it is the person's**
      // (406, widened at 413). One writer puts all three keys on the event —
      // `RuntimeHost.whoseWordsTheseAre` — so this reads the subjects in turn and falls back to
      // the go-ahead's own entry, which is what an app-authored turn with no subject is.
      // ⚑ **That fallback is sound for every ledger ever written**: before `406` nothing carried
      // the attribution at all, and `406` gave both of its producers `work` in the same spread.
      // ⛔ **`relayedFrom` is read as a non-empty STRING and never as a truthy value** (406's own
      // lesson, one field over): replay is a trust boundary, `boundStoredEvent` does not touch this
      // key, and a row edited on disk must not be able to decide an entry with `{}`.
      //
      // 🔴 **624 · a THIRD subject, and the order is stated rather than inherited.** ⛔ No
      // producer writes {@link UserTurnEvent.appNotice} beside `work` or `relayedFrom` —
      // `deliverAnswer`'s ternary passes the notice or the relayer, never both — so the
      // combinations below it are unreachable from this app and reachable only
      // from a hand-edited ledger. ⚑ **On such a row the subject that NAMES somebody wins**,
      // because losing a relayer's name understates and heading another agent's words *This app*
      // does not. ⚠️ And a notice read as a non-empty string, `413`'s rule for `relayedFrom` — see
      // {@link carriesANotice}.
      // ⚑ **658 · the report keeps its relayer** — see {@link WorkReportItem.relayed}.
      if (isAWorkReport(event.work))
        appendWorkReport(
          state,
          event.text,
          event.work,
          wasRelayed(event.relayedFrom)
            ? {
                relayedFromProfile: relayerIdentity(event.relayedFromProfile),
                relayedFrom: event.relayedFrom,
              }
            : null,
        )
      else if (wasRelayed(event.relayedFrom))
        appendRelayedTurn(
          state,
          event.text,
          relayerIdentity(event.relayedFromProfile),
          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.
          isAgentMessageKind(event.says) ? event.says : undefined,
          event.relayedFrom,
        )
      else if (carriesANotice(event.appNotice)) appendAppNotice(state, event.text, event.appNotice)
      // ⚑ A turn that carries on after a repaired sign-in hands over no words, so there is nothing
      // to draw: the reopen above it says what happened. It still opens a turn.
      else if (event.carriesOn === true) state.changes.turn += 1
      else if (event.attribution === 'app_authored') appendAppTurn(state, event.text)
      else appendUserMessage(state, event.text, event.attribution, event.attachments)
      const answered = readAnsweredQuestion(event.answeredQuestion)
      const delivered = state.items.at(-1)
      if (delivered?.kind === 'user' && moveOriginOf(event.movedFrom) !== undefined)
        delivered.movedFrom = moveOriginOf(event.movedFrom)
      if (answered && (delivered?.kind === 'appNotice' || delivered?.kind === 'relayed'))
        delivered.answeredQuestion = answered
      keepWhatWasSent(state, event.sent)
      // 🔴 **678 · the piece these words give, or give a new brief** — see
      // {@link RelayedItem.opened}. ⚑ Asked of the item just appended, whichever arm appended it:
      // only a RELAYED turn takes it, because only an agent's brief names a piece this way
      // (`give_work`'s, or `update_work`'s new one), and a hand-edited row that put the key on a
      // report, a notice or a person's turn is refused by the item's kind rather than by a guess.
      // ⚑ **688 · and the label the turn itself carries** (`687` H6) — so a window that starts at
      // that turn does not need the row before it.
      if (isAnId(event.piece)) {
        openedAPiece(state, event.piece, event.label)
        // ⚑ **658 · and who gave it** — the brief is the giver's words, so its relayer is the giver.
        const giver = wasRelayed(event.relayedFrom)
          ? relayerIdentity(event.relayedFromProfile)
          : undefined
        if (giver !== undefined) rememberTheGiver(state, event.piece, { profile: giver })
      }
      return
    }

    case 'user_decision': {
      // Which button we pressed, echoed back like the turn itself. Each of these marks the
      // card of its own kind and is a no-op for the other, so the id decides, not the caller.
      // 🔴 **503 · the actor rides the same fold as the outcome**, so a card cannot draw one
      // without the other and the two can never come from different rows.
      if (event.outcome === 'answered' || event.outcome === 'rejected') {
        markUserInputAnswered(state, event.requestId, event.outcome, event.by)
        // ⚑ **UI-009 · and a question this conversation ASKED** — the host writes its decision
        // into the asker's ledger, so the card stops offering an answer once one was given.
        const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
        if (asked !== null) {
          asked.answered = event.outcome
          if (moveReceiptOf(event.movedTo) !== undefined)
            asked.movedTo = moveReceiptOf(event.movedTo)
          if (event.by === undefined) delete asked.by
          else asked.by = event.by
          delete asked.refused
        }
      } else {
        markPermissionAnswered(state, event.requestId, event.outcome, event.by)
      }
      return
    }

    case 'message_queued': {
      // Not sent, and shown as not sent (077). It arrives on the stream like everything else, so a
      // message queued live and the same message replayed on resume land by the same path.
      closeStreaming(state)
      // ⚑ **545 · read once, and only where the relay itself was read** — a row carrying an
      // identity and no conversation names nobody rather than heading a bubble nothing marked as
      // somebody else's.
      const relayer = wasRelayed(event.relayedFrom)
        ? relayerIdentity(event.relayedFromProfile)
        : undefined
      state.items.push({
        kind: 'queued',
        ...(moveOriginOf(event.movedFrom) === undefined
          ? {}
          : { movedFrom: moveOriginOf(event.movedFrom) }),
        id: nextId(state, 'queued'),
        text: event.text,
        outcome: null,
        // ⛔ **Its NAME, so an ending settles the row it names** (413) — see
        // {@link QueuedItem.messageId}. A session can hold two since `394`.
        ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
        ...(event.attachments ? { attachments: event.attachments } : {}),
        // ⚑ **406** — see {@link QueuedItem.report}. A reply held behind a running turn is drawn
        // here until it flushes, and it is not the person's message.
        ...(isAWorkReport(event.work) ? { report: event.work } : {}),
        // ⚑ **413** — see {@link QueuedItem.relayed}. A task held for a BUSY child is the ordinary
        // way work arrives, and this is the row a person reads while it waits.
        ...(wasRelayed(event.relayedFrom)
          ? { relayed: true as const, ...relayNavigation(event.relayedFrom) }
          : {}),
        // ⚑ **545 · and WHO, which is the same row's other question** — see
        // {@link QueuedItem.relayedFromProfile}.
        ...(relayer === undefined ? {} : { relayedFromProfile: relayer }),
        // ⚑ **624** — see {@link QueuedItem.appNotice}. ⛔ Read as a non-empty string, as
        // `relayedFrom` is — see {@link carriesANotice}.
        ...(carriesANotice(event.appNotice) ? { appNotice: event.appNotice } : {}),
        ...(readAnsweredQuestion(event.answeredQuestion)
          ? { answeredQuestion: readAnsweredQuestion(event.answeredQuestion) }
          : {}),
        // 🔴 **688 · R22** — see {@link QueuedItem.goAhead}: BroBot's go-ahead, never the person's.
        ...(isTheGoAhead(event) ? { goAhead: true as const } : {}),
        // ⚑ **688 · what the sender said it is** — only where the relay was read, like the name.
        ...(wasRelayed(event.relayedFrom) && isAgentMessageKind(event.says)
          ? { says: event.says }
          : {}),
      })
      return
    }

    case 'message_unqueued': {
      const waiting = openQueuedItem(state, event.messageId)
      if (event.reason === 'sent') {
        // It stopped being queued and became a turn: drop the placeholder, because the `user_turn`
        // that follows this event is the record of it now. Leaving both would show one message as
        // two.
        if (waiting) state.items.splice(state.items.indexOf(waiting), 1)
        return
      }
      // Cancelled, retracted or abandoned: it stays on screen, saying which — a message that was
      // never sent is exactly the thing that must not silently vanish.
      if (waiting) {
        waiting.outcome = event.reason
        // ⚑ **The paths are NOT re-set here, and that is measured rather than assumed.** Only
        // `cancelled`, `retracted` and `abandoned` reach this branch — `sent` splices the item out
        // above — and all three publish the queue-time copy, which is the copy the waiting item already holds from
        // its own `message_queued`. A line assigning it survived the mutation table because it
        // could not change anything: no fixture could make the two differ. ⛔ `detail` is the
        // opposite and belongs here: it exists only on the ending, and deleting this line renders
        // a message abandoned because its file vanished as one abandoned because the conversation
        // ended. The branch below, which never saw the queueing, is where the paths come from the
        // event.
        if (event.detail) waiting.detail = event.detail
        return
      }
      // ⚠️ **No matching item, which is a real case rather than a defensive one.** 054 pages the
      // transcript, so a window can hold the ending without the beginning. The event carries the
      // text for this: the message is still shown, still marked never-sent, still offered back.
      closeStreaming(state)
      // ⚑ **545 · the relayer's name on the rebuild too**, for the reason the relay flag is on this
      // branch at all: this row is built from this event alone, and a rebuild that kept the relay
      // and dropped the relayer would say *another agent* about a hop the ledger can name.
      const rebuiltRelayer = wasRelayed(event.relayedFrom)
        ? relayerIdentity(event.relayedFromProfile)
        : undefined
      state.items.push({
        kind: 'queued',
        id: nextId(state, 'queued'),
        text: event.text,
        outcome: event.reason,
        ...(moveOriginOf(event.movedFrom) === undefined
          ? {}
          : { movedFrom: moveOriginOf(event.movedFrom) }),
        // ⚑ **413** — a rebuilt row carries its name for the same reason the queued one does: a
        // second ending arriving in the same window must not find this row by position.
        ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
        ...(event.detail ? { detail: event.detail } : {}),
        ...(event.attachments ? { attachments: event.attachments } : {}),
        // ⚑ **406, from the review** — this branch never saw the `message_queued`, so without the
        // report on the ENDING an app-authored reply is rebuilt as the person's own bubble.
        ...(isAWorkReport(event.work) ? { report: event.work } : {}),
        // ⚑ **413, the same hazard one subject over** — and the one that offers the words back.
        ...(wasRelayed(event.relayedFrom)
          ? { relayed: true as const, ...relayNavigation(event.relayedFrom) }
          : {}),
        // ⚑ **545 · and WHO relayed them** — see {@link QueuedItem.relayedFromProfile}.
        ...(rebuiltRelayer === undefined ? {} : { relayedFromProfile: rebuiltRelayer }),
        // ⚑ **624, the same hazard one subject over** — a window that paged past the queueing
        // rebuilds this row from this event alone, and without the subject the app's own report
        // comes back as the person's own bubble with *Put it back in the composer* under it.
        ...(carriesANotice(event.appNotice) ? { appNotice: event.appNotice } : {}),
        ...(readAnsweredQuestion(event.answeredQuestion)
          ? { answeredQuestion: readAnsweredQuestion(event.answeredQuestion) }
          : {}),
        // 🔴 **688 · R22, the same hazard one subject over** — a go-ahead taken back in a window
        // that paged past its queueing is rebuilt from this ending alone; without this it comes
        // back as the person's words with *Put it back in the composer* under BroBot's sentence.
        ...(isTheGoAhead(event) ? { goAhead: true as const } : {}),
        ...(wasRelayed(event.relayedFrom) && isAgentMessageKind(event.says)
          ? { says: event.says }
          : {}),
      })
      return
    }

    case 'assistant_delta': {
      const open = itemById(state, state.streamingId ?? undefined)
      if (open?.kind === 'assistant') {
        open.text += event.text
        return
      }
      const id = nextId(state, 'assistant')
      state.items.push({ kind: 'assistant', id, text: event.text, streaming: true })
      state.streamingId = id
      state.provisionalId = id // unconfirmed until an authoritative message lands
      return
    }

    case 'assistant_message': {
      // Words spoken BY a sub-agent belong to that sub-agent's card, not to the conversation (128) —
      // the same routing, on the same id, that its tool calls have had since 029. Measured on
      // `sess_6b4380fa`: one child's six forwarded messages became six loose top-level turns wearing
      // the parent's voice, and a seven-agent fan-out would make that ~42.
      //
      // ⛔ **Checked BEFORE the streaming block below, and that ordering is the fix, not an
      // optimisation.** A child's message reaching that code would have found the PARENT's open
      // streamed block and overwritten its text with the child's — one turn's words replaced by
      // another's, with nothing on screen to betray it.
      //
      // ⛔ **The branch is on the OWNER, not on the card** (131, from 130's review). 128 returned
      // only on a `cardFor` HIT, and a miss fell straight through to the reconciler below — so the
      // defect this comment says was removed survived for the one window that matters:
      //
      //   `tool_call(dispatch) → assistant_delta("[MAIN] Still writ") → says(child) → sub_agent`
      //
      // The card cannot exist before its `sub_agent` (`cardFor` has nothing to find), so a child
      // that spoke first replaced the parent's open text with its own and closed the parent's
      // stream. 128's two tests each held one of the premises — one made the card first, the other
      // had no parent stream — and both passed over the sequence that corrupts the transcript.
      //
      // A message that names an owner is that owner's, whether or not we have drawn the card yet.
      // Nothing about the parent's turn is touched on either branch.
      if (event.parentToolCallId) {
        const voice = cardFor(state, event.parentToolCallId)
        if (voice) {
          voice.body.push({ kind: 'prose', id: nextId(state, 'says'), text: event.text })
          dropEchoedProse(state, voice)
          return
        }
        // The card has not arrived. It is still not swallowed — the same rule the unclaimed tool
        // call follows (029) — but it now REMEMBERS whose it is, which is the whole difference
        // between 128's fallback and this one: `reclaimChildRows` takes it back the moment the
        // card appears, so "loose top-level turn" is a window rather than a resting place (127's
        // altitude rule, which 130 correctly said 128 had not implemented).
        state.items.push({
          kind: 'assistant',
          id: nextId(state, 'assistant'),
          text: event.text,
          streaming: false,
          parentToolCallId: event.parentToolCallId,
        })
        return
      }
      const open = itemById(state, state.streamingId ?? undefined)
      if (open?.kind === 'assistant') {
        // Authoritative: the deltas were progressive rendering, not the source of truth.
        open.text = event.text
        open.streaming = false
        if (event.questions !== undefined) open.questions = event.questions
        finishHumanAnswer(state.humanAnswers, open, event, ordinal ?? state.seq, at, state.items, humanFinal)
        state.streamingId = null
        state.provisionalId = null
        return
      }
      // No OPEN block — but a provisional one may still be sitting above a `tool_call` that closed
      // it (068, fixing 066 F5). Its text is unconfirmed streaming output that this authoritative
      // message supersedes, so DROP it rather than render the same text twice. The message is then
      // appended in its true position, after the tool — which is also what 058's source ordering
      // says: the provider emitted the tool first and this text after it.
      dropProvisional(state)
      state.items.push({
        kind: 'assistant',
        id: nextId(state, 'assistant'),
        text: event.text,
        streaming: false,
        ...(event.questions === undefined ? {} : { questions: event.questions }),
      })
      finishHumanAnswer(state.humanAnswers, state.items.at(-1) as AssistantItem, event, ordinal ?? state.seq, at, state.items, humanFinal)
      return
    }

    case 'thinking': {
      // Reasoning closes the streamed assistant block for the same reason a tool call does: the
      // model has stopped writing prose and started doing something else, and text that resumes
      // afterwards is a new block rather than a continuation of the old one.
      if (event.phase === 'complete') {
        const open = itemById(state, state.thinkingId ?? undefined)
        if (open?.kind === 'thinking') open.streaming = false
        state.thinkingId = null
        return
      }
      // A delta carrying NOTHING is a part boundary (Codex's `summaryPartAdded`), so it does the
      // one thing a boundary can do: separate the parts already written. Never on an empty block —
      // there is nothing yet to separate — and never as a reason to open one.
      const bare = !event.text && event.tokens === undefined && event.redacted !== true
      const open = itemById(state, state.thinkingId ?? undefined)
      if (open?.kind === 'thinking') {
        if (bare) {
          if (open.text) open.text += '\n\n'
          return
        }
        // Text ACCUMULATES here — unlike a plan, reasoning is a growing paragraph, and each delta
        // is the next fragment of it rather than a fresh statement of the whole.
        if (event.text) open.text += event.text
        // Once ANY words arrive the block is no longer redacted, whatever it started as.
        if (event.text) open.redacted = false
        if (event.tokens !== undefined) open.tokens = event.tokens
        return
      }
      // A boundary that arrives with no block open — a straggler after `complete`, or events out of
      // order — must not conjure one. The block it would create says "thought" while being neither
      // redacted nor expandable: a claim that something was reasoned, with nothing behind it.
      if (bare) return
      // Only the START of a reasoning block closes the streamed text, not every delta that grows
      // it. Claude reports its thinking as a running token count — dozens of deltas per turn — and
      // closing on each one would chop a single reply into a dozen blocks the moment reasoning and
      // text ever overlapped. Thinking then speaking is a real boundary; thinking a bit more is not.
      closeStreaming(state)
      const id = nextId(state, 'thinking')
      state.items.push({
        kind: 'thinking',
        id,
        text: event.text ?? '',
        redacted: event.redacted === true && !event.text,
        ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
        streaming: true,
      })
      state.thinkingId = id
      return
    }

    case 'plan_update': {
      // The tool calls this checklist IS (028). Marked before anything else, so a `supersedes` that
      // names a call still applies even when the steps themselves turn out to be a no-op below.
      for (const callId of event.supersedes ?? []) {
        const tool = itemById(state, state.toolItems[callId])
        if (tool?.kind === 'tool') tool.superseded = true
      }
      const open = itemById(state, state.planId ?? undefined)
      if (open?.kind === 'plan') {
        // REPLACE, never merge — every event states the complete list, so anything else would let
        // a removed step (Claude's `deleted`) survive as a line the model has abandoned. Copied
        // rather than aliased: the event is persisted and replayed, and the item is mutable.
        open.steps = event.steps.map((step) => ({ ...step }))
        setOptional(open, 'note', event.note)
        // `body` is the ONE field here that is not restated on every event, and treating it like the
        // others erased it (030 review). The checklist and the note are STATES — Codex sets and
        // clears its `explanation` as the plan progresses, so "absent" genuinely means "no longer
        // true". The plan document is an EVENT: it was proposed once, and there is no un-proposing
        // it. Since only `ExitPlanMode` carries one, every ordinary todo call that followed sent
        // `body: undefined` and deleted the plan the user had just approved — mid-execution, from
        // under them, with the approval still on screen above it.
        if (event.body !== undefined) open.body = event.body
        return
      }
      // Nothing to say and no block to say it in — the same rule the bare thinking delta follows:
      // an empty checklist appearing out of nowhere claims a plan exists and shows none.
      if (event.steps.length === 0 && !event.note && !event.body) return
      // Only the START of a checklist closes the streamed text, not each revision of it — a plan
      // that ticks a box mid-sentence must not chop the reply into two blocks.
      closeStreaming(state)
      const id = nextId(state, 'plan')
      state.items.push({
        kind: 'plan',
        id,
        steps: event.steps.map((step) => ({ ...step })),
        ...(event.note !== undefined ? { note: event.note } : {}),
        ...(event.body !== undefined ? { body: event.body } : {}),
      })
      state.planId = id
      return
    }

    case 'sub_agent': {
      const existing = findCard(state, event.agentId)
      const card =
        existing ??
        placeCard(state, {
          agentId: event.agentId,
          ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
          // WHOSE kind of id this is (111), straight off the wire. Absent on an event persisted
          // before this existed, and the card then says "child agent" rather than guessing.
          ...(event.idKind ? { idKind: event.idKind } : {}),
          ...(event.origin ? { origin: event.origin } : {}),
          running: true,
          body: [],
        })
      // MERGE, never clobber: the phases carry different subsets of the truth — `task_updated` has
      // no `tool_use_id` or `subagent_type` at all — so an absent field means "not reported by this
      // message", never "cleared". Writing undefined over a title the start already gave us would
      // blank the card's heading the moment it finished.
      if (event.idKind) card.idKind = event.idKind
      // Merged like the rest, and it is the one field a later phase can only ever CORRECT upwards:
      // an `observed` card that turns out to have been announced after all is an announced card.
      if (event.origin) card.origin = event.origin
      if (event.parentToolCallId) card.parentToolCallId = event.parentToolCallId
      if (event.kind) card.kind = event.kind
      if (event.title) card.title = event.title
      if (event.lastTool) card.lastTool = event.lastTool
      if (event.usage) card.usage = mergeUsage(card.usage, event.usage)
      if (event.summary) {
        card.summary = event.summary
        dropEchoedProse(state, card)
      }
      if (event.outcome) card.outcome = event.outcome
      // Both endings are mapped, so this runs twice in the ordinary case and must be idempotent.
      if (event.phase === 'ended') card.running = false
      // A LATER phase can be the first to name the dispatch (`task_started` may omit it, and
      // `task_updated` always does), so placement is re-evaluated rather than decided once. Without
      // this the card would sit at top level for the rest of the session even though its row is
      // right there on screen.
      rehome(state, card)
      // …and any of the child's calls that landed in the conversation before this card existed are
      // pulled back where they belong.
      reclaimChildRows(state, card)
      return
    }

    case 'activity': {
      // Replaced wholesale, never appended: the pill states one thing about now.
      state.activity = {
        phase: event.phase,
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
      }
      return
    }

    case 'tool_call': {
      // A call made BY a sub-agent belongs to that sub-agent's card, not to the conversation (029).
      // Claude forwards the child's tool blocks into the parent stream by default, so before this
      // they rendered as the parent's own work — a misattribution with nothing on screen to betray
      // it. The card is the nested transcript; the parent flow stays the parent's.
      const owner = event.parentToolCallId ? cardFor(state, event.parentToolCallId) : undefined
      if (owner) {
        messageCall(state, event.id, null, false)
        // ⛔ **`memoryPath` is deliberately NOT carried onto a card row** (330, and 327's `durationMs`
        // is the precedent it follows). {@link SubAgentToolRow} declares `{kind, callId, name,
        // summary}` and `SubAgentEntry` draws no badge for any tool — a conditional spread writes
        // past that type with no excess-property error, so carrying it here would store a field
        // nothing declares and nothing renders. ⚠️ A sub-agent CAN write memory and the honest
        // consequence is that its card row does not say so; giving card rows this affordance is a
        // surface change 330 was not asked for, and is named in the response rather than smuggled in.
        owner.body.push({
          kind: 'tool',
          callId: event.id,
          name: event.name,
          summary: event.summary,
        })
        owner.lastTool = event.name
        // Remembered as a DISPATCH POINT (035). It is deliberately not in `toolItems` — there is no
        // item, the row lives on a card — but it is still an id a grandchild can name as its parent,
        // and without this index that grandchild's card could never find it and stranded at top
        // level. `adoptOrphans` is called for the same reason a row calls it: a card may already be
        // waiting for exactly this id.
        state.cardTools[event.id] = owner.agentId
        adoptOrphans(state, event.id)
        return
      }
      closeStreaming(state)
      // A running tool IS the activity — derived from the neutral event both providers already
      // produce, rather than each adapter emitting a duplicate `activity` beside every call.
      state.activity = { phase: 'tool', detail: event.name }
      const id = nextId(state, 'tool')
      state.items.push({
        kind: 'tool',
        id,
        callId: event.id,
        name: event.name,
        summary: event.summary,
        result: null,
        // ⚑ **The one thing that makes a memory write legible as one** (330). Spread rather than
        // assigned `undefined` so an ordinary row carries no key at all — the same absent-is-a-fact
        // shape `stopKey` uses one line down.
        ...(event.memoryPath === undefined ? {} : { memoryPath: event.memoryPath }),
        // ⛔ **Kept, and NOT read as a detachment** (300) — see {@link ToolItem.stopKey} for the whole
        // of that distinction, which `detachment` one screen down states from the other side.
        ...(event.backgroundId === undefined ? {} : { stopKey: event.backgroundId }),
      })
      state.toolItems[event.id] = id
      // 🔴 **658 · one of the two calls that speak to another conversation** — marked here, and the
      // host's row lands on it ({@link landOutgoing}), or already has ({@link claimAhead}).
      const outgoing = outgoingToolOf(state, event.name, event.summary)
      if (outgoing !== null) {
        const row = itemById(state, id)
        if (row?.kind === 'tool') row.outgoing = claimAhead(state, outgoing, event.summary)
      }
      // Whose call this was, if the card for it has not arrived yet — so it can be reclaimed.
      if (event.parentToolCallId) {
        const row = itemById(state, id)
        if (row?.kind === 'tool') row.parentToolCallId = event.parentToolCallId
      }
      const registered = itemById(state, id)
      messageCall(
        state,
        event.id,
        registered?.kind === 'tool' ? registered : null,
        outgoing === 'message_agent' && event.parentToolCallId === undefined,
      )
      // This row may be the parent a sub-agent card has been waiting for (029). Adopting here is
      // what makes the nesting a binding on the id rather than on which arrived first.
      adoptOrphans(state, event.id)
      // …and the row a workflow tree has been waiting for (108), by the same rule.
      adoptWorkflows(state, event.id)
      return
    }

    case 'tool_result': {
      messageResult(
        state,
        event.id,
        event.messageAct,
        event.ok,
        event.parentToolCallId !== undefined,
      )
      // ⛔ **This receipt may be a DETACHMENT rather than a completion** (248, from 247's field).
      // `ok` stays exactly as the provider sent it — the detach really did succeed — and the fact
      // goes beside it. See {@link detachment} for why it is read from `backgrounded` alone.
      const detached = detachment(event)
      // The child's results follow the child's calls, wherever those went.
      const owner = event.parentToolCallId ? cardFor(state, event.parentToolCallId) : undefined
      const nested = owner?.body.find(
        (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === event.id,
      )
      if (nested) {
        // ⛔ **`durationMs` is deliberately NOT carried onto a card row** (327, found reviewing this
        // dispatch's own diff). {@link SubAgentToolRow.result} declares `{summary, ok}` and
        // `SubAgentEntry` renders no duration for any tool — a spread writes past that type without
        // an excess-property error, so the first draft of this line stored a field nothing declared
        // and nothing read. Giving card rows a duration is a feature this dispatch was not asked
        // for; writing one nobody can see is worse than not writing it.
        nested.result = { summary: event.summary, ok: event.ok }
        tellItsRefusal(state, nested.name, event.summary, false)
        if (detached) nested.background = { ...nested.background, ...detached }
        // ⛔ **658 · a sub-agent's call is on its card, never a top-level item** — so a messaging row
        // it wrote is ahead of nothing that will come, and a LATER call of ours must not claim it.
        state.outgoingAhead = []
        return
      }
      const item = itemById(state, state.toolItems[event.id])
      if (item?.kind === 'tool') {
        // ⚠️ **`=== undefined`, never a truthiness test** (327): a tool that failed instantly reports
        // `durationMs: 0`, and `...(event.durationMs ? … : {})` would drop the duration of exactly
        // the rows where how fast it failed is the interesting part.
        item.result = {
          summary: event.summary,
          ok: event.ok,
          at,
          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        }
        delete item.refusalRail
        const told = tellItsRefusal(state, item.name, event.summary, drawsAsACard(item), (rail) => {
          if (rail === 'that-agent-is-you') item.refusalRail = rail
        })
        if (told !== null) item.told = told
        // 🔴 **D-047 · a give's answer says which `work_sent` is its own** ({@link settleTheGive}).
        settleTheGive(state, item)
        // ⚠️ **Merged rather than assigned, so a receipt can never erase an ending.** Nothing on the
        // wire orders `background_work.ended` after this frame — they come out of different system
        // messages — and an assignment would put a finished command back to "still running" on the
        // one ordering the provider has not promised against.
        if (detached) item.background = { ...item.background, ...detached }
        // ⛔ **The receipt is where CLAUDE names the key at all** (300): `claude/normalize.ts` sets
        // `backgroundId` only beside `backgrounded`, so a detached Claude task has no key until
        // this frame — where the Codex call already had one from `item/started`. ⚠️ Never cleared
        // by a receipt that carries none, for the reason the line above is merged rather than
        // assigned: a second frame must not be able to take away what a first one stated.
        if (event.backgroundId !== undefined) item.stopKey = event.backgroundId
        return
      }
      // A result with no call is surfaced, not dropped — it still tells the user
      // something ran.
      // ⛔ **658 · and it is the signature of a call before the retained suffix** — a messaging row
      // that landed ahead was that call's, so no later call may claim it.
      state.outgoingAhead = []
      state.items.push({
        kind: 'tool',
        id: nextId(state, 'tool'),
        callId: event.id,
        name: '(result without a call)',
        summary: '',
        result: { summary: event.summary, ok: event.ok },
        ...(detached ? { background: detached } : {}),
      })
      return
    }

    /**
     * 🔴 **582 · an agent asked for a rule against an identity's own instructions.**
     *
     * ## ⛔ A NOTICE and deliberately not a card, and the reason is where the answer lives
     *
     * ⛔ **An instruction ask is answered on the IDENTITY it is about**, beside the versions it would
     * change and the text it would replace — and a card here would have to draw a diff against a
     * history this transcript does not hold, or ask a person to approve text they cannot compare.
     *
     * ⚑ **`warn` and not `info`, because `info` is dropped by the reading view**
     * (`transcript-mode.ts`) and this is a thing waiting on the person rather than chatter.
     *
     * ⛔ **It does NOT move `state.pending`**, and that is stated rather than implied: `recountPending`
     * is what `attentionQueue` and the drawer badge count, and every one of those counts is about a
     * decision answerable HERE. ⚠️ **So an ask nobody opens the sheet for is not surfaced anywhere
     * else** — a line for the plan rather than a design (standing rule 14).
     */
    case 'instruction_proposed': {
      closeStreaming(state)
      // 🔴 **712 · R41 (`707` GAP-5) — both identities NAMED, by `NoticeEntry`, with the roster.**
      // ⛔ It printed both slugs. ⚑ The facts ride the item; `text` is the roster-less sentence for
      // a reader with no roster — `lostReply`'s split, below.
      const asked: InstructionAsked = {
        proposedBy: event.proposedBy,
        about: event.about,
        ask: event.ask,
        characters: event.text.length,
      }
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: instructionAskedSentence(asked, null),
        instructionAsked: asked,
      })
      return
    }

    /**
     * ⚑ **582 · how it ended** — a second notice rather than an annotation, because the first was a
     * notice and a notice has nothing to annotate. ⛔ The ENDING's own sentence comes from
     * {@link ENDING_MEANS}, rendered from the word (standing rule 8), so a fifth ending cannot
     * arrive here as an unexplained string.
     */
    case 'instruction_changed': {
      notice(
        state,
        'info',
        `${rulesChangeLabel({ whoWroteIt: 'an-agent-direct', author: event.author })} · ${event.profile} · v${event.version}`,
      )
      return
    }

    case 'instruction_settled': {
      notice(state, 'info', `Rules asked for earlier: ${endingMeans(event.ending)}.`)
      return
    }

    // An agent asked the person to register an MCP server. The card is under Waiting on you, so
    // this line only says it waits there; `warn`, because the reading view drops `info`.
    case 'mcp_server_requested': {
      closeStreaming(state)
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: mcpServerRequestedSentence(event.name, event.url, null),
        mcpServerRequest: { requestId: event.requestId, name: event.name, url: event.url },
      })
      return
    }

    // How it ended rewrites the request's own line, or adds one when that line is not on the page.
    case 'mcp_server_request_settled': {
      if (!isMcpServerRequestEnding(event.ending)) return
      // What the settled row carries, said with how it ended: the tools offered, or why not.
      const ended = {
        ending: event.ending,
        ...(Array.isArray(event.offered) ? { offered: event.offered } : {}),
        ...(typeof event.why === 'string' ? { why: event.why } : {}),
      }
      for (let at = state.items.length - 1; at >= 0; at--) {
        const item = state.items[at]
        if (item?.kind !== 'notice' || item.mcpServerRequest?.requestId !== event.requestId)
          continue
        const { name, url } = item.mcpServerRequest
        item.text = mcpServerRequestedSentence(name, url, ended)
        return
      }
      notice(state, 'info', anEarlierMcpServerRequestEnded(ended))
      return
    }

    case 'permission_request': {
      closeStreaming(state)
      const id = nextId(state, 'permission')
      state.items.push({
        kind: 'permission',
        id,
        request: event,
        outcome: null,
        note: null,
        refused: null,
      })
      state.requestItems.set(event.id, id)
      recountPending(state)
      return
    }

    case 'user_input_request': {
      closeStreaming(state)
      const id = nextId(state, 'userInput')
      state.items.push({
        kind: 'userInput',
        id,
        request: event,
        answered: null,
        note: null,
        refused: null,
      })
      state.requestItems.set(event.id, id)
      recountPending(state)
      return
    }

    case 'request_resolved': {
      // The PROVIDER withdrew the request (051). The adapter has already retired it — answering
      // is refused and nothing more goes on the wire — so the card must stop being actionable.
      // `note` is exactly that: why it stopped being actionable WITHOUT a decision from us.
      const item = itemById(state, state.requestItems.get(event.id))
      // ⚠️ **`note === null`, like every other writer** (085 review). Before 085 nothing had written a
      // note by the time this arrived, so an unguarded assignment was invisible; now the `turn` fold
      // settles first and an adapter that ALSO withdraws its requests during teardown would land
      // here a moment later and relabel "settled when the turn was interrupted" as "withdrawn by the
      // provider" — the vaguer of the two, replacing the one that says which ending it was.
      if ((item?.kind === 'permission' || item?.kind === 'userInput') && item.note === null) {
        item.note = 'withdrawn by the provider'
      }
      recountPending(state)
      return
    }

    case 'status': {
      state.status = event.state
      // ⛔ **`idle` clears the activity, and 123 is when the omission started to cost something.**
      // Two events cleared this field — `turn` and `user_turn` — and a burst the provider starts by
      // itself has NEITHER: it ends with the provider's own terminal, which draws no turn boundary
      // (there was no turn), so the phase it left behind used to survive for the life of the
      // conversation. Inert while the session read `idle`, because `sessionDoing` refuses to let
      // `activity` promote an idle session — and live again the instant the NEXT burst latched
      // `working`, which is what 123 made reachable. Measured shape: burst 1 runs `Read`, burst 2
      // starts thirty seconds later, and the pill says RUNNING READ about a call that finished
      // half a minute ago. That is 089's sentence, and this is the general form of the guard 099
      // wrote for `user_turn`: **a session that is not working is not doing anything.**
      if (event.state === 'idle') state.activity = null
      // 🔴 **D-001 · nothing is waiting on a person any more**, so a card its turn left live is held
      // by nobody. ⚠️ Not `ended`/`errored`: `markTerminal` below says which ending it was.
      if (event.state === 'idle' || event.state === 'working') letGoOfHeldRequests(state)
      // A session closed before it ever had a provider ref emits only this — there is
      // no `session:'ended'` to carry an honest ref — so status is terminal too.
      if (event.state === 'ended') markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
      if (event.state === 'errored') markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
      return
    }

    case 'session': {
      if (event.state === 'ended') {
        markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
        return
      }
      endMessageRun(state)
      // ⚠️ **A session announcing itself open ends the PREVIOUS life's latch** (085).
      //
      // Reset `state.ended` for a new life. `markTerminal` must ignore duplicate events for one ending, but a later close after resume must still settle cards, sub-agents and tool calls rather than leave dead controls active.
      //
      // So the flag answers "is this transcript over?", and the guard needs "have we already folded
      // THIS ending?". They agree until a transcript has two lives. Cleared here rather than by
      // widening the guard, because the event is the fact: a runtime does not say `started` or
      // `resumed` about a session that is over.
      //
      // ⚠️ Deliberately NOT `markReopened`, which 064 gives to the resume FLOW on purpose — that one
      // also states status, activity and streaming, and it must keep being said by the host handing
      // back a live handle rather than by a provider that may stay quiet.
      state.ended = false
      state.ref = event.ref
      notice(state, 'info', `session ${event.state} · ${event.ref.sessionId}`)
      return
    }

    /**
     * **The provider started a new conversation under this one** (199, from 192 H5).
     *
     * ⚠️ **A durable ROW, not a notice, and the difference is the whole finding.** The obvious
     * place for this was the `info` notice three lines above — and `transcript-mode.ts` drops
     * `info` notices out of the reading view, so filing it there would have hidden the single most
     * destructive thing a provider can do to a conversation in exactly the mode people read in.
     * The argument is `transcript-mode.ts`'s own, made for compaction and stronger here.
     *
     * ⚑ **`state.ref` moves and `state.ended` is NOT touched.** The ref is what the header and the
     * exporter name the conversation by, so it follows. The terminal latch is untouched because a
     * reset says nothing about whether this transcript is over: the clearing above is there for a
     * session ANNOUNCING ITSELF OPEN after a previous life ended, and a reset is not that event —
     * it arrives mid-life, from a session that never stopped.
     */
    case 'conversation_reset': {
      endMessageRun(state)
      state.ref = event.ref
      state.items.push({
        kind: 'reset',
        id: nextId(state, 'reset'),
        sessionId: event.ref.sessionId,
        source: event.source,
      })
      return
    }

    case 'provider_turn': {
      endMessageRun(state)
      // 🔴 **F080 — a turn the provider started by itself** (a background task ended, and Claude
      // woke its agent): the same turn bookkeeping a `user_turn` does — no activity and no error
      // memory carried over from the last turn — and a quiet line saying who began it. ⚑ It is no
      // prompt, so the Changes pane's turn axis ({@link opensTurn}) does not move.
      // 🔴 **F035 — and the job that woke it, when the host names one**: the one one-shot whose
      // minute had come, at its own minute. ⚠️ Unnamed, the line stays the plain one: none came due
      // (a background task's end, which is not *scheduled*) or several did, and which is not known.
      closeStreaming(state)
      state.activity = null
      state.lastError = null
      if (event.oneShotCameDue === undefined) {
        notice(
          state,
          'info',
          `turn started by ${state.ref === null ? 'the agent' : PROVIDER_NAME[state.ref.provider]} itself`,
        )
      } else {
        state.items.push({
          kind: 'notice',
          id: nextId(state, 'notice'),
          level: 'info',
          text: wokenWords(event.oneShotCameDue, at),
          wokenByAJob: true,
        })
      }
      return
    }

    case 'turn': {
      closeStreaming(state)
      // The turn is over, so nothing is happening: the pill goes, and a reasoning block still
      // marked as growing is closed rather than left spinning forever.
      state.activity = null
      const thinking = itemById(state, state.thinkingId ?? undefined)
      if (thinking?.kind === 'thinking') thinking.streaming = false
      state.thinkingId = null
      // The checklist stays on screen — it is what the turn set out to do, and that remains true
      // after the turn ends. Forgetting WHICH item it was is what makes the next turn open its own
      // block instead of rewriting this one under a reader who has scrolled past it (028).
      state.planId = null
      // Nor can a QUESTION outlive the turn that asked it (085, and 084's steal #1).
      //
      // Every adapter safe-rejects its pending requests as part of terminalising a turn — Codex
      // clears its pending server requests on turn start/completion/interruption, which is the same
      // protocol fact 051 relies on — so by the time this event exists the request is already gone
      // from the wire. What was missing is anyone saying so: the card kept its Answer button, and
      // pressing it reached an adapter that had spent the id and refused.
      //
      // ⚠️ **It says WHICH ending, not just that there was one.** "This question ended with the
      // turn" is the whole disclosure; a card that merely goes quiet is 063's other failure — a
      // question the user cannot know was asked, or in this case, cannot know was abandoned.
      // 🔴 **The only caller that has to ASK, because its arms do not agree** (D-001, `738` P-1).
      //
      // ⛔ A permission and a question die with the turn — each adapter safe-rejects its pending
      // requests as part of terminalising one. ⚠️ **Except where the provider keeps the request past
      // its turn** — a Codex code-mode cell still awaiting BroBot's own `give_work` card, a Claude
      // background agent asking — and the machine then keeps the status on `waiting_permission`
      // across this ending (122). ⛔ Settling those cards froze the composer over a card with nothing
      // to press, and only Stop got out. So `completed` / `failed` under a held wait leave them live;
      // `interrupted` settles them, because a Stop's `interrupt()` safe-rejects every open card
      // before the turn ends.
      settlePending(
        state,
        `settled when the turn ${TURN_END_WORD[event.state]}`,
        event.state !== 'interrupted' && state.status === 'waiting_permission'
          ? 'still-held'
          : 'released',
      )
      // A sub-agent cannot outlive the turn that dispatched it (029) — unless it was dispatched to
      // the BACKGROUND and the level still lists it (695, see `stopRunningSubAgents`).
      const stillListed = new Set(state.background.running.map((one) => one.id))
      stopRunningSubAgents(state, stillListed)
      // Nor can a tool call (074). The ordinary turn has already collected every result, so this
      // finds nothing; the turn that was INTERRUPTED is the one it is for — 042 measured that
      // ending, and a `Bash` still on screen afterwards is claiming to be running inside a turn the
      // transcript says is over. A `tool_result` that lands late still wins: the fold writes
      // `result` without consulting the flag, and the row prefers a real result to this.
      // ⚑ **D-003 · and a workflow run the level still lists is spared, as the agents are above.**
      stopOpenToolCalls(state, stillListed)
      // 🔴 **730 · R83 — and an ask to stop it is settled with it**: the host joins a Stop to the
      // standing ask only while its turn runs (`RuntimeHost.interrupt`).
      state.stopUnanswered = null
      // The turn is over: an unconfirmed streamed block will never be confirmed, so it stands as
      // the final rendering of that text (068). Forgetting it here is what stops a LATER turn's
      // authoritative message from deleting a block that belongs to this one.
      state.provisionalId = null
      // ⛔ **This line IS the receipt 246 §1 rules on**, and the cause was said above it.
      //
      // ⚠️ **`state.lastError` is deliberately NOT cleared here**, and the 246 mutation table is why:
      // the row that removed a clear on this event came back GREEN, because nothing could reach it.
      // A turn cannot begin without a `user_turn` or (F080) a `provider_turn`, and each drops the
      // memory — so a clear here protects an interval that does not exist. It was written and deleted rather than
      // kept as defence in depth, which is the affordance 106 is about.
      // 🔴 **725 · R71 — and whose word it is, when it is this app's** (`THE_APPS_OWN_WORD`).
      // ⚠️ Compared strictly: a replayed payload is a cast (`session-store.ts`), never re-parsed.
      // 🔴 **F074 — and a turn its provider refused for the usage limit says so, on its ending**,
      // with the reset: the limit is recorded IN the ending, never only among the errors beside it.
      notice(
        state,
        event.state === 'completed' ? 'info' : 'warn',
        event.wordOf === 'this-app'
          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`
          : event.state === 'failed' && event.limit !== undefined
            ? `turn ${event.state} — ${aTurnsLimitSays(event.limit, at)}`
            : `turn ${event.state}`,
      )
      return
    }

    case 'error': {
      // The runtime's notice that the model is still thinking is drawn as one live line at the
      // end, from the conversation's liveness, so it leaves no row behind once thinking ends.
      if (event.stall === true && event.thinking === true) return
      // ⚠️ **A rejected credential is the one error whose provider text is useless to a reader**
      // (098). The measured sentence is *"Your access token could not be refreshed because your
      // refresh token was already used. Please log out and sign in again."* — every word true, every
      // word written for whoever wrote Codex, and what it actually means is that nothing in this
      // conversation will work until the profile is signed in again. So the notice says THAT.
      //
      // The provider's own words are not lost: the event is stored verbatim in the ledger and the
      // debug stream still prints it (`describe-event.ts`), which is 085's split — the diagnostic
      // goes where diagnostics go, and the person gets a sentence they can act on. This is the
      // `cause` field's consumer, and it is why the field exists rather than being a comment.
      //
      // Always `error`, never `warn`, **and the two causes reach that for opposite reasons** (110).
      // Codex's `auth` arrives NON-fatal — the session stays open, and that is precisely the
      // misleading part, a "recoverable" tag over a turn that cannot be retried. Claude's
      // `auth_stale` arrives FATAL, because that session really is over. Reading the level off
      // `fatal` would therefore have printed a warning over one of them; it is pinned instead.
      //
      // ⚠️ **Exhaustive over the causes THAT EXIST, enforced by the compiler.** An earlier version
      // of this claimed exhaustiveness while ending in a `default` that fell through to the raw
      // provider message — which is the exact leak `cause` exists to stop, waiting for the third
      // member. Absence of a cause is handled first and separately, so `default` here really is
      // unreachable and a new `ErrorCause` is a BUILD failure rather than a sentence on screen. Same
      // guard, same reason, as the `Record` in `assistant-error.ts`.
      const refusal = knownRefusal(event.refusal)
      if (refusal !== null) {
        // 🔴 **A refusal the adapter RECOGNISED is said from its values, never from the provider's
        // advice** (680, R28c) — see {@link refusalSentence}. The provider's sentence is on
        // `event.message`, kept in the ledger and printed by the Events tab (085's split), and
        // remembered as `raw` so a later restatement of it is not drawn a second time.
        const shown = refusalSentence(refusal)
        notice(state, event.fatal ? 'error' : 'warn', shown)
        state.lastError = { raw: event.message, shown }
        if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
        return
      }
      if (event.billingRefused === true) {
        // The account can't pay: said with the ways out, since the provider's own sentence names
        // neither the key nor what to do. That sentence stays on the event, and is remembered as
        // `raw` so the turn's own ending doesn't repeat it. Not terminal: the conversation stays
        // open. A second refusal in the same turn (a sub-agent's, then the turn's) is said once.
        const shown = billingNotice(state.ref?.provider ?? null, event.onAKey === true)
        if (state.lastError?.shown !== shown) notice(state, 'error', shown)
        state.lastError = { raw: event.message, shown }
        return
      }
      if (event.cause === undefined) {
        // ⛔ **The turn's OWN ending, which the `turn` event above states in a word** (246 §1, from
        // 244's only finding). `completeTurn` re-says the provider's terminal reason as
        // `turn failed: <reason>` — so 244's conversation read the same 177-char HTTP envelope
        // twice and then read `turn failed`, four accounts of one failure.
        //
        // ⚑ **The prefix is dropped rather than the line**, because the reason is not always said
        // anywhere else: Claude's `result` carries only a subtype (`turn failed:
        // error_during_execution`) and there is no separate error notification behind it. So the
        // cause stands as its own line and the receipt states the ending — which is exactly what
        // 246 §1 ruled: *"one plain-language cause, then one durable `failed` receipt."*
        //
        // ⚠️ **And it is dropped ENTIRELY when the turn has already said it**, which is the case
        // 244 read. Nothing is lost: the event is in the ledger verbatim and the Events tab prints
        // it (`describe-event.ts`), 085's split.
        const ending = turnFailureDetail(event.message)
        if (ending !== null) {
          const reason = providerErrorSentence(ending)
          const said = state.lastError
          const repeat = said !== null && (ending === said.raw || reason === said.shown)
          if (reason !== '' && !repeat) notice(state, event.fatal ? 'error' : 'warn', reason, true)
          // Not remembered as `lastError`: this IS the ending, and nothing after it in this turn can
          // be a restatement of it.
          if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
          return
        }
        // ⛔ **The sentence inside the envelope** (246 §1). A 400's `message` is a real sentence;
        // `{"type":"error","status":400,…}` around it is not, and the notice row draws a few lines
        // of it at most (the provider's words are clamped since `672`; the whole is on the title).
        // `status` and `type` stay in the ledger and the Events tab, which is where a diagnostic
        // belongs (085).
        const shown = providerErrorSentence(event.message)
        notice(state, event.fatal ? 'error' : 'warn', shown, true)
        state.lastError = { raw: event.message, shown }
      } else {
        // ⚑ **Remembered by what ARRIVED as well as by what was drawn** (246 §1). `auth-state.ts`
        // records the pair: the credential refusal comes through as `cause: 'auth'` and is drawn as
        // the sentence above, and then the turn's terminal message repeats the provider's own
        // *"Your access token could not be refreshed…"* verbatim. Only `raw` catches that one.
        const provider = state.ref?.provider ?? null
        const shown = causeNotice(
          event.cause,
          event.onAKey === true,
          // The host's fact about what this app does with a refused copy, never about which
          // provider it is; the name is the conversation's own.
          event.replacesRefusedSignIn === true && provider !== null
            ? PROVIDER_NAME[provider]
            : null,
        )
        notice(state, 'error', shown)
        state.lastError = { raw: event.message, shown }
      }
      if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
      return
    }

    // One item per generated image (067). Not folded into the assistant block above it: the image
    // is its own artifact with its own home in the panel's index, and an item id is what a jump
    // from that index lands on.
    case 'image': {
      state.items.push({
        kind: 'image',
        id: nextId(state, 'image'),
        imageId: event.imageId,
        ...(event.path ? { path: event.path } : {}),
        ...(event.prompt ? { prompt: event.prompt } : {}),
      })
      return
    }

    // The live gauge (087). Replaced wholesale, never appended — see {@link ContextMeter} for why
    // this is the one place 078's *"the meter absorbs the stream"* is actually implemented.
    case 'context_reading': {
      state.meter = {
        reading: event.reading,
        source: event.source,
        at: at ?? null,
      }
      return
    }

    // Context was dropped (087) — one durable row, drawn where it happened.
    case 'compaction': {
      // ⚑ **717 · a compaction row ENDS a `compacting` pill.** Codex raises the phase when its
      // `contextCompaction` item OPENS and says nothing more until the item closes into this row, so
      // inside a turn that goes on working the pill would otherwise claim a compaction that is over
      // until some other activity happened to replace it. Claude's `compact_boundary` also lands
      // after its compaction is done, so the rule is true of both. ⛔ Only `compacting`: a row does
      // not end a `thinking` or a `tool` that is really still running. Before the dedup, so a
      // repeated announcement still ends it.
      if (state.activity?.phase === 'compacting') state.activity = null
      // ⚠️ **The dedup, and it is not defensive programming.** Codex announces its
      // `contextCompaction` item on BOTH `item/started` and `item/completed` — four events for two
      // compactions, measured. The normalizer already emits on `completed` only, so this is the
      // second line of defence and the one that also covers a ledger written by an older build:
      // events are persisted, so a fold running today can be replaying a stream that predates the
      // fix. Two rows for one compaction would also make the meter's tally say 2, and 086's whole
      // cross-reference rests on that count being the number of rows.
      if (
        event.compactionId !== undefined &&
        state.items.some(
          (item) => item.kind === 'compaction' && item.compactionId === event.compactionId,
        )
      )
        return
      state.items.push({
        kind: 'compaction',
        id: nextId(state, 'compaction'),
        // Absent stays absent, in all four. A compaction Codex reported carries no numbers at all,
        // and a row with a `0` in it would be a measurement we were never given.
        ...(event.compactionId !== undefined ? { compactionId: event.compactionId } : {}),
        ...(event.before !== undefined ? { before: event.before } : {}),
        ...(event.after !== undefined ? { after: event.after } : {}),
        ...(event.trigger !== undefined ? { trigger: event.trigger } : {}),
        source: event.source,
      })
      // A compaction that gave no size leaves the last reading untrue: the meter says nothing
      // until the next reading. One that gave its size is followed by that reading. A sub-agent's
      // compaction is its own context, never this conversation's.
      if (event.after === undefined && event.parentToolCallId === undefined) {
        state.meter = { reading: { kind: 'unknown' }, source: null, at: null }
      }
      return
    }

    /**
     * **A dynamic workflow ran** (108). Merged into one tree, never appended as rows.
     *
     * ⚠️ **The three merges here are three different rules, and they are not interchangeable.**
     *  - `agents`/`phases` merge BY IDENTITY and only when the frame carried them, because 19 of 41
     *    measured progress frames carry no roster at all (see `workflow-run.ts`). Replacing would
     *    blank the tree on every second tick; treating absence as `[]` would do the same.
     *  - `usage` is REPLACED wholesale, because it is a running total and states one thing about now
     *    — the same treatment `context_reading` gets, and for the same reason.
     *  - `name`/`description`/`outputFile` are FILLED IN and never cleared, because each arrives on
     *    one subtype only and a later frame's silence is not a retraction.
     */
    case 'workflow_run': {
      const known = state.workflows[event.taskId]
      const run: WorkflowRunCard = known ?? {
        taskId: event.taskId,
        phases: [],
        agents: [],
        running: true,
      }
      if (known === undefined) state.workflows[event.taskId] = run
      if (event.toolUseId !== undefined) run.toolUseId = event.toolUseId
      if (event.name !== undefined) run.name = event.name
      if (event.description !== undefined) run.description = event.description
      if (event.outputFile !== undefined) run.outputFile = event.outputFile
      if (event.usage !== undefined) run.usage = event.usage
      if (event.droppedAgents !== undefined && event.droppedAgents > 0)
        run.droppedAgents = event.droppedAgents
      run.phases = [...mergeWorkflowPhases(run.phases, event.phases)]
      run.agents = [...mergeWorkflowAgents(run.agents, event.agents)]
      // ⚠️ **A frame arriving after we stopped watching means we are watching again** (108 review).
      // `stopOpenToolCalls` marks an open run `unfinished` at every boundary that ends the thing
      // running it — including a TURN ending, and a dynamic workflow legitimately outlives the turn
      // that launched it (it is a background task; that is the whole feature). Without this the head
      // froze on "did not finish" while rows underneath it kept updating: two answers to one
      // question, in one card. A non-terminal frame is proof the run is alive.
      // ⚑ **D-003 · a TURN ending no longer marks a run the level still lists**, so this is now for
      // a run the level did not list at that turn end, and for a replay reopened mid-run.
      if (event.outcome === undefined && run.unfinished === true) {
        run.running = true
        delete run.unfinished
      }
      if (event.outcome !== undefined) {
        run.outcome = event.outcome
        run.running = false
        // A run that ENDED is not one we stopped watching — 074's distinction, both directions.
        // Without this a resumed conversation whose run was marked unfinished on reopen would keep
        // saying "did not finish" after the ending arrived and settled it.
        delete run.unfinished
      }
      // Place it on the launching row, if that row is here. The binding is the id, never arrival
      // order — `adoptOrphans`' rule, and the reason this is re-attempted on every frame rather than
      // only on the first: the `Workflow` tool call leads in every measured run, but a rule that
      // holds only for well-ordered events is not a rule.
      attachWorkflow(state, run)
      return
    }

    // **The agent changed files** (096). Recorded on its own facet, never as an item — see
    // {@link ChangeLog}. Each report is kept whole; the pane folds them to one row per path.
    case 'file_change': {
      const log = state.changes
      const previous = log.reports[log.reports.length - 1]
      const paths = new Set(event.changes.map((change) => change.path))
      // ⚠️ **The turn a report lands in, computed ONCE and used everywhere** (review). It used to be
      // `Math.max(log.turn, 1)` on the report and a bare `log.turn` in the fold, so a change reported
      // before the reader had said anything — a resumed session replaying, an agent that moves first
      // — was stamped turn 1 while the conversation was still on turn 0. "This turn" then matched
      // nothing and the pane drew an empty scope over rows it was holding.
      const turn = Math.max(log.turn, 1)
      // ⚠️ **A snapshot replaces; an increment appends.** Codex re-sends the whole turn's diff three
      // to five times — measured, byte-identical — so appending would keep four dead copies of every
      // file's text. Claude sends one edit at a time, and those must accumulate. Rather than branch
      // on the provider, the rule is about the DATA: a report that names everything the last one did
      // supersedes it. Both providers land on the right side of that without being asked.
      const supersedes =
        previous !== undefined &&
        !previous.released &&
        // ⚠️ **`.every` over an EMPTY array is `true`, and review caught it superseding.** A report
        // that named nothing — the under-disclosed case, a provider hiccup — would be replaced by
        // the next one regardless of what it said, and the empty report's own `dropped` count went
        // with it. A superset of nothing is not a superset.
        previous.changes.length > 0 &&
        previous.turn === turn &&
        previous.changes.every((change) => paths.has(change.path))
      const report: ChangeReport = {
        id: supersedes ? previous.id : `changes_${(log.seq += 1)}`,
        changes: event.changes,
        dropped: event.dropped ?? 0,
        source: event.source,
        turn,
        released: false,
        // ⛔ **WHICH ledger event this report is** (299 §2 finding 5). A superseding report takes the
        // NEW event's ordinal, not the one it replaced: the row now describes this frame, and the
        // whole use of the number is deciding whether a re-fold of the retained events will build
        // it again. See {@link ChangeReport.ordinal} and `carryForward`.
        ...(ordinal !== undefined ? { ordinal } : {}),
      }
      if (supersedes) log.reports[log.reports.length - 1] = report
      else log.reports.push(report)
      releaseOldDiffBodies(log)
      return
    }

    /**
     * 🔴 **The one row a memory write leaves** (318 §2.1) — an ITEM, unlike its neighbour below.
     *
     * ⛔ **Stated as a ruling, because the neighbouring arm is the opposite ruling and the two look
     * identical from the outside.** `user_command` is durable, ordinal-stamped, echoed to the window
     * and draws nothing; this is durable, ordinal-stamped, echoed and draws a row. The difference is
     * what the conversation already shows: a gesture's consequences are all on screen already, and a
     * memory write's are on screen NOWHERE — which is the whole of friction log F4.
     *
     * ⚠️ **The event is pushed through unchanged rather than reshaped.** The host has already
     * bounded it, the store re-bounds it on replay, and a fold that re-derived `dropped` or trimmed
     * `notes` here would be a third opinion about one payload.
     */
    case 'memory_note': {
      // ⛔ **An empty list draws nothing** (found reviewing this diff). The HOST never publishes one
      // — `notesThatAppeared` returns no event for no notes — but the REPLAY path can produce one:
      // `boundStoredEvent` filters a stored row, and a row whose every entry was malformed comes
      // back with `notes: []`. Pushed, that renders a heading announcing *"0 notes appeared"*.
      if (event.notes.length === 0) return
      state.items.push({
        kind: 'memoryNote',
        id: nextId(state, 'memoryNote'),
        notes: event.notes,
        ...(event.dropped ? { dropped: event.dropped } : {}),
      })
      return
    }

    // **Ledger-only, and stated here rather than reached by falling through** (097).
    //
    // ⚠️ A `return` with no item is exactly what a missing case would do, so the difference between
    // "decided" and "forgotten" lives in this comment — which is why there is one. 085 asked for a
    // breadcrumb to answer *"why did this happen"* from a query; the conversation already shows
    // every consequence of every gesture (the turn that stopped, the plan bar that went, the model
    // in the header), so drawing the gesture beside its own effect would say one thing twice in the
    // one surface that is supposed to read like a conversation. It is visible in the Events tab,
    // which filters nothing, and that is the surface a debugger opens.
    //
    // ⚠️ It follows that `transcript-mode.ts` is NOT touched: that switch is over ITEM kinds, and
    // this makes no item. A `user_command` item would have needed a visibility ruling; a breadcrumb
    // that never becomes one does not.
    case 'user_command':
      return

    /**
     * ⛔ **Ledger-only, exactly as `user_command` above it is** (379; a piece since D-016).
     *
     * ⚠️ **The conversation already shows the work**: the brief — a `message_queued` bubble or the
     * `user_turn` that this row names — sits immediately beside it, and a piece row drawn beside its
     * own brief would say the same thing twice in the one surface that is meant to read like a
     * conversation. ⚑ **What a piece is FOR is a board**, which is `list_tasks` and the Work tab, not
     * a transcript item — and the raw Events tab, which filters nothing, is where a debugger sees
     * this row (`describe-event.ts` gives it a line).
     *
     * 🔴 **474 · still no item, and it LEAVES something behind** — see
     * {@link TranscriptState.piecesGiven}. ⛔ The ruling above is about drawing a row for the give;
     * the label and title this row carries are what name the piece on the rows that follow — the
     * brief's card, the reply's card, a lost reply's notice. ⚠️ Recording them changes nothing a
     * reader sees for this row.
     *
     * ## 🔴 537 · the premise above is TRUE OF ONE BRANCH, and this is the other one
     *
     * ⛔ **The sentence *"the brief beside it already says the work arrived"* describes the IDLE
     * branch.** There the words go straight out and the bubble beside this row is a real turn.
     * ⚠️ **On the BUSY branch the bubble says the opposite** — `not sent · waiting for the turn to
     * end` — and this row, drawing nothing, would leave that standing. ⚑ So the correction is one
     * field on the row that is already there — see {@link QueuedItem.label}. ⛔ **Its own ledger's
     * `messageId` and never a position**: `354`'s rule, and {@link heldMessageNamed} is where the
     * refusal to guess lives. ⚠️ An absent `messageId` is the idle branch, where there is no held
     * row to correct and none is wanted.
     *
     * ## ⚑ D-016 · commit 6 · a piece taken on for a person has no brief at all
     *
     * ⚠️ Its owner wrote it with `take_on_work`, whose call is drawn beside it; nothing was sent,
     * so it carries no `messageId` and there is no bubble or held row. Its `givenBy` is `null`,
     * which is remembered so the reply's card says it went to the person
     * ({@link OutgoingReply.toThePerson}). ⚑ **UI-003 · and it lands ON that call** — the call's
     * card draws the piece, its title and its whole brief ({@link OutgoingTakeOn}).
     */
    case 'work_given': {
      if (!isAnId(event.piece) || !isALabel(event.label)) return
      const given = {
        label: event.label,
        ...(typeof event.title === 'string' && event.title !== '' ? { title: event.title } : {}),
      }
      state.piecesGiven.set(event.piece, given)
      // ⚑ **D-016 · commit 6 · `null` is a person** — a piece its holder took on for them.
      if (event.givenBy === null) rememberTheGiver(state, event.piece, { person: true })
      else if (isAnId(event.givenBy)) {
        rememberTheGiver(state, event.piece, { conversation: event.givenBy })
      }
      // ⚑ **537** — the held row learns that the WORK arrived, while the WORDS have not.
      if (event.messageId !== undefined) {
        const held = heldMessageNamed(state, event.messageId)
        if (held) held.label = event.label
      }
      // 🔴 **UI-003 · a piece taken on for the person lands on its call** — `givenBy: null` is
      // written by `take_on_work` alone, into this ledger, so its card draws the whole brief.
      if (
        event.givenBy === null &&
        typeof event.title === 'string' &&
        typeof event.brief === 'string'
      )
        landOutgoing(state, {
          tool: 'take_on_work',
          taken: {
            piece: event.piece,
            label: event.label,
            title: event.title,
            brief: event.brief,
            ...(event.definitionOfDone === undefined
              ? {}
              : { definitionOfDone: event.definitionOfDone }),
          },
        })
      // ⚑ **678** — the idle branch's brief came FIRST and has been waiting for this title.
      const turn = state.briefsAwaitingTheirTitle.get(event.piece)
      if (turn !== undefined) {
        turn.opened = { ...turn.opened, ...given }
        state.briefsAwaitingTheirTitle.delete(event.piece)
      }
      return
    }

    /**
     * ⛔ **Still no ROW of its own** (393) — and since `658`, the call's card draws it.
     *
     * A reply summary can exceed the adapters' 200-character argument preview. Land the complete row on its call through {@link landOutgoing} and draw one outgoing card for the act, without adding a duplicate item.
     *
     * ⚠️ **The PARENT's transcript is still where the reply arrives as words**, through
     * `queueMessage`; this card is the child's own record of what it sent, and to whom. ⚑ **D-016 ·
     * commit 6 · a reply to a piece a person gave arrives nowhere** (R5): the person reads it in
     * this conversation, and the card says it went to them ({@link OutgoingReply.toThePerson}).
     */
    case 'work_replied': {
      if (!isAnId(event.piece)) return
      const given = state.piecesGiven.get(event.piece)
      const giver = state.pieceGivers.get(event.piece)
      landOutgoing(state, {
        tool: 'reply_to_parent',
        reply: {
          piece: event.piece,
          outcome: event.outcome,
          summary: typeof event.summary === 'string' ? event.summary : '',
          resources: Array.isArray(event.resources) ? event.resources.filter(isAnId) : [],
          ...(event.needsUserAction === true ? { needsUserAction: true as const } : {}),
          ...(given === undefined ? {} : { label: given.label }),
          ...(giver?.profile === undefined ? {} : { toProfile: giver.profile }),
          ...(giver?.conversation === undefined ? {} : { toConversation: giver.conversation }),
          ...(giver?.person === true ? { toThePerson: true as const } : {}),
        },
      })
      // ⚑ **UI-003 · the reply's summary is the piece's last word** — its take-on's status goes.
      const taken = takeOnOf(state, event.piece)
      if (taken !== null) delete taken.status
      return
    }

    /**
     * 🔴 **D-022 · R1 — a new brief that rides its piece's held give**
     * ({@link WorkRebriefedEvent.messageId}): the held card reads the newest brief, as the turn it
     * becomes will carry it — the give's words are read off the piece as its handover begins.
     *
     * ⛔ **Still no item of its own.** A new brief that queued its own message is drawn by that
     * message, and one sent straight in by its turn — its giver's words, a relayed brief naming its
     * piece. ⚑ **By the message's own name, never a position** (`354`, {@link heldMessageNamed}): a
     * held card outside this window (`054` pages the transcript) is a real absence, and nothing
     * changes. ⚠️ The `message_queued` row keeps the words the give was queued with — a row is never
     * rewritten — so a card rebuilt from its ending alone reads those.
     */
    case 'work_rebriefed': {
      const taken = takeOnOf(state, event.piece)
      if (taken !== null) {
        if (typeof event.definitionOfDone === 'string')
          taken.definitionOfDone = event.definitionOfDone
        if (typeof event.brief === 'string') (taken as { brief: string }).brief = event.brief
      }
      if (event.messageId === undefined || typeof event.brief !== 'string') return
      const held = heldMessageNamed(state, event.messageId)
      if (held) held.text = event.brief
      return
    }

    /**
     * 🔴 **UI-003 · a status line set on a piece taken on for the person** lands on its take-on's
     * card — ⚠️ the Work tab lists no such piece, so this card is the one place a person reads it.
     * The newest stands. ⛔ No item: a status line on any other piece draws nothing here.
     */
    case 'work_status_set': {
      if (!isAnId(event.piece) || typeof event.line !== 'string' || event.line.trim() === '') return
      const taken = takeOnOf(state, event.piece)
      if (taken !== null) taken.status = event.line
      return
    }

    /**
     * ⛔ **No item — D-016 draws nothing for the rest of a piece's life in the transcript yet.**
     *
     * ⚠️ **A take-back and a close already reach this conversation as words**: the app tells the
     * owner with a notice turn (`a-piece-taken-back`, `a-piece-closed`), which draws as this app's
     * own report. A new brief reaches it as its giver's words — see the arm above. A title set on a
     * piece is the Work tab's and `list_tasks`' to show; a status line lands on a take-on's card
     * (the arm above). ⚑ The raw Events tab prints every one of them (`describe-event.ts`).
     */
    case 'work_taken_back':
    case 'work_retitled':
    case 'work_closed':
      return

    /**
     * 🔴 **D-047 · what this conversation gave, from its own end** — written as the give succeeds,
     * before its call answers. ⚑ **It lands on the give's call** ({@link landOutgoing}), so the card
     * draws the title and brief whole — after a restart and from history too: it is read with the
     * page it is on, as the call is.
     *
     * ⚑ **A new brief lands on its `update_work` call** the same way, so its card draws the new
     * brief whole. ⚑ The raw Events tab prints both (`describe-event.ts`).
     */
    case 'work_sent': {
      if (!isALabel(event.label) || !isAnId(event.to)) return
      if (typeof event.title !== 'string' || typeof event.brief !== 'string') return
      if (event.as === 'rebriefed') {
        if (!isAnId(event.piece)) return
        landOutgoing(state, {
          tool: 'update_work',
          rebriefed: {
            piece: event.piece,
            label: event.label,
            title: event.title,
            brief: event.brief,
            to: event.to,
          },
        })
        return
      }
      if (event.as !== 'given') return
      landOutgoing(state, {
        tool: 'give_work',
        given: { label: event.label, title: event.title, brief: event.brief, to: event.to },
      })
      return
    }

    /**
     * ⛔ **No item, and it is the reply row's ruling one subject over** (394).
     *
     * ⚠️ **The request itself already has a row.** A `permission_request` or `user_input_request` is
     * drawn as a card in this very transcript; this row says where the app SENT it, which is a fact
     * about the app rather than about the conversation. ⚑ And the parent's transcript is where a
     * routed question shows up as words — it arrives there as an ordinary turn through
     * `queueMessage`, which already renders, and that is criterion 9's *"rendered in both
     * transcripts"*.
     *
     * ⛔ **Drawing it here would also put a routing decision beside the card a person is answering**,
     * which reads as an instruction about who should answer — and a person may answer whatever they
     * like (HO-007 §2.1). The raw Events tab is where a debugger sees this row.
     *
     * ⚑ **D-017 · R19 — the card is marked routed** ({@link PermissionItem.routed}), so *Waiting on
     * you* leaves it to the host's reads: the parent's to answer, or listed by the person's queue.
     * ⚑ **And, when it went to another conversation, which one** ({@link PermissionItem.routedTo}):
     * this conversation's state is then *waiting on that one's answer*, never *needs you*.
     */
    case 'request_routed': {
      const routed = itemById(state, state.requestItems.get(event.requestId))
      if (routed?.kind === 'permission' || routed?.kind === 'userInput') {
        routed.routed = true
        // ⚠️ The LAST row says where it went: one routed again to a person is a person's.
        if (event.to !== 'a-person' && typeof event.parent === 'string') {
          routed.routedTo = event.parent
        } else {
          delete routed.routedTo
        }
        recountPending(state)
        return
      }
      // ⚑ **A question this conversation sent** — its card says where it went: a person, the
      // parent that gave the piece (named by the brief that gave it), or the agent it named.
      const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
      if (asked === null) return
      if (event.to !== 'the-parent' && event.to !== 'a-person' && event.to !== 'an-agent') return
      asked.to = event.to
      if (isAnId(event.parent)) asked.toConversation = event.parent
      else delete asked.toConversation
      const giver =
        event.to === 'the-parent' && asked.piece !== undefined
          ? state.pieceGivers.get(asked.piece)
          : undefined
      if (giver?.profile === undefined) delete asked.toProfile
      else asked.toProfile = giver.profile
      return
    }

    /**
     * ⛔ **437 · no item, and it is `request_routed`'s ruling for the same reason.**
     *
     * ⚠️ **The words are already in this transcript, twice over.** The worker's own turn shows the
     * `ask_question` tool call that carried them, and the PARENT's transcript shows them again as the
     * question it was asked — `deliverQuestion` → `queueMessage`, which already renders, which is
     * criterion 9's *"rendered in both transcripts"* with nothing added.
     *
     * ⚑ **So drawing a third copy would put one act on the page twice in one conversation**, and
     * the second copy would be the one with no sender — the shape `413` spent a dispatch removing.
     * The raw Events tab is where a debugger sees this row.
     *
     * ## 🔴 474 · the WORDS are still not drawn, and the EDGE now is (`463` F4)
     *
     * ⛔ **The ruling above is about the question's text and it stands whole.** What this row also
     * carries is the one thing nothing on this page says: WHICH WORK the conversation stopped over.
     * ⚠️ The `ask_question` call above it may name a `work_<uuid>` in its arguments, which is not a
     * sentence a person reads, and the turn that follows shows the conversation waiting with no
     * subject at all.
     *
     * ⚑ **`466` drew exactly this distinction in the digest** — *"this arm still draws no question;
     * what it draws is the EDGE, which nothing drew before"* — and the transcript is the other
     * reader `463` F4 named.
     *
     * ⛔ **`info`, not `warn`.** A worker asking its parent a question is the verb working, not
     * something going wrong; `work_interrupted` is `warn` because somebody stopped something.
     *
     * ⚠️ **The label, from the row itself** (D-016): `question_asked` carries the piece's label beside
     * its id, so the notice names the piece without a join, and a row whose label is not one
     * `pieceCalled` spells names none rather than a wrong one.
     *
     * ⛔ **It names NO recipient, and that is `465`'s rule rather than brevity.** HO-028 §2: *an
     * observation may not name an actor it did not observe.* ⚠️ This row carries a piece, a prompt
     * and parts and **no destination** — the sibling `request_routed` carries that, and `ask_question`
     * derives it from the piece's giver. ⚑ A sentence saying *asked the conversation that gave this
     * work* would be true by construction of the verb and unsupported by the row this arm reads.
     */
    case 'question_asked': {
      // 🔴 **611 · a PASSED-UP question names no piece of this conversation's** (HO-088 §3.2) — see
      // {@link QuestionAskedEvent.piece}. ⛔ The work belongs to the original asker's ledger. ⚑ The
      // sentence says what the row says: it carried somebody else's question up. ⚠️ **And a
      // question about no piece says so** — since D-016 an agent may ask another about none.
      notice(
        state,
        'info',
        isAnId(event.passedUpFrom)
          ? 'passed a question up'
          : !isAnId(event.piece)
            ? 'asked a question about no piece of work'
            : isALabel(event.label)
              ? // ⚑ **672 · the card's spelling** — the label, never an id of its own.
                `asked about ${event.label}`
              : 'asked about a piece of work',
      )
      // ⚑ **And the words land on the call that asked them** ({@link landOutgoing}), as a reply's
      // do: the call's card draws the question in place of its tool row — still one row for the act.
      const asked = questionAsked(event)
      if (asked !== null) {
        landOutgoing(state, {
          tool: asked.passedUpFrom === undefined ? 'ask_question' : 'pass_question_up',
          asked,
        })
      }
      return
    }

    /**
     * 🔴 **395 · a notice, and it is the ONE place `user_command`'s ledger-only ruling does not
     * reach.**
     *
     * ⛔ **`user_command` is drawn nowhere because *"the conversation already shows every
     * consequence: the interrupted turn, the plan bar disappearing, the model in the header"*.** ⚠️
     * That argument is true of every verb in that union except this one. The consequence a reader
     * sees here is `turn interrupted` — which had four producers and named none of them (since
     * `725` an ending this app wrote says it is this app's word, `THE_APPS_OWN_WORD`) — so the
     * conversation shows that the work stopped and cannot show that somebody stopped it. ⚑ **That is
     * the false-provider-bug this dispatch exists to prevent**, and it is prevented on this line.
     *
     * ⚠️ **Drawn for a person's own Stop as well**, which is not saying the same thing twice: a
     * transcript is read by somebody other than whoever pressed the button, and by the same person a
     * week later. ⛔ A notice that appeared only for an agent would make its own absence a claim.
     *
     * ⚑ **`warn`, like the turn it precedes.** An interruption is not an error and is not routine
     * either; `info` would hide it in the reading view (`transcript-mode.ts`), which is the one view
     * where the confusion happens.
     *
     * 🔴 **709 · R43 — the ASK, and never the stop.** ⛔ It said *"stopped by …"*, which was true
     * only because `SessionMachine` renamed whatever the provider did next `interrupted`. ⚑ The
     * turn below it is the provider's word now, and a provider can complete a turn it was asked to
     * stop (`probe:codex-early-interrupt`), so this row says what IT knows — who asked — in
     * {@link ASKED_TO_STOP}'s shared words, and the `turn …` notice under it says how the turn ended.
     * ⚠️ **Unless this app ended it first** (`720`, R71: a Claude Stop after its receipt, a Close
     * the provider did not answer first): that row carries `wordOf: 'this-app'`, and since `725` the
     * notice under this one says so ({@link THE_APPS_OWN_WORD}).
     */
    case 'work_interrupted': {
      // ⚑ **730 · R83 — a newer ask is the one a Stop would join**, and nobody has yet waited on it.
      state.stopUnanswered = null
      // 🔴 **737 · `734` F-2, `732` F-4 — the ask as facts, and the asker by its category here**: it
      // said *"asked to stop by sess_…"*. ⚑ The transcript names the agent with the roster
      // ({@link NoticeItem.askedToStop}); a reader with none reads the category.
      const asker = event.agent
      const askerIs = event.agentProfile
      const askedToStop: AskedToStop = {
        by: event.by,
        ...(asker === undefined ? {} : { agent: asker }),
        ...(askerIs === undefined ? {} : { agentProfile: askerIs }),
      }
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: askedToStopSays(askedToStop, null),
        askedToStop,
      })
      return
    }

    /**
     * 🔴 **730 · R83 — a Stop the provider has not answered, SAID** (`720` F-F; the fact is `723`'s).
     *
     * ⚑ **A `warn` notice, like the ask it is about**, in `lib/stop-unanswered.ts`' words — *"Codex
     * has not answered the stop asked for by a person"* — and the fact held on
     * {@link TranscriptState.stopUnanswered} so the Stop control can say a press joins it.
     * ⚠️ {@link NoticeItem.text} names no provider, whatever `state.ref` says: it is the form every
     * reader can use (the readable export), and the notice is re-said with the pane's provider off
     * {@link NoticeItem.stopUnanswered}.
     *
     * ⛔ **The asker never by `sess_` handle** — by its category here, and by its NAME where the
     * transcript has the roster (`737`) — see `stopUnansweredSays`.
     */
    case 'stop_unanswered': {
      const fact: StopUnanswered = {
        by: event.by,
        waitedMs: event.waitedMs,
        ...(event.agent === undefined ? {} : { agent: event.agent }),
        // ⚑ **737 · which agent asked** (`734`'s `agentProfile`), for the notice and the Stop to name.
        ...(event.agentProfile === undefined ? {} : { agentProfile: event.agentProfile }),
      }
      state.stopUnanswered = fact
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: stopUnansweredSays(fact, null),
        stopUnanswered: fact,
      })
      return
    }

    /**
     * ⛔ **No item, and it is `request_routed`'s ruling with one addition** (396).
     *
     * ⚠️ **The card is already gone from this transcript.** A stranded request is one this app
     * found open at a launch, so the conversation it belongs to has been reopened since — and the
     * `permission_request` or `user_input_request` it names was drawn in the life that ended, above
     * whatever this reader is looking at. ⚑ A notice here would announce the disappearance of
     * something the reader is not being shown.
     *
     * 🔴 **And the reader who needs it is not a person in this transcript — it is the PARENT**, and
     * it is told through `list_questions`, which is where the state has consequences. ⛔ Drawing a
     * row about the app's own restart into a conversation's words is `user_command`'s ruling: the
     * raw Events tab is where a debugger sees it.
     */
    case 'request_stranded':
      return

    /**
     * ⛔ **No item, and `request_stranded`'s ruling holds for a different reason** (397).
     *
     * ⚠️ **The notice is already on the screen, one row up.** `work_interrupted` draws *"asked to
     * stop by …"* (709) immediately before these, and the app writes one of these per open card — so a notice here
     * would print one act two, three or four times, in a row, under the sentence that already said
     * it.
     *
     * 🔴 **And the reader who needs the per-request fact is the PARENT**, which is `list_questions`'
     * job and where the word has consequences. ⛔ A person watching this conversation sees the card
     * leave the attention queue, which is the surface that owns *"what am I being asked"*.
     */
    case 'request_interrupted':
      return

    // No item, as for an ending of the piece the question it carried was about: the queue drops it.
    case 'question_ended_with_its_piece':
      return

    /**
     * ⛔ **D-009 · no item, for `request_interrupted`'s reason one act over.** A withdrawal is the
     * asker's own tool call, already on this screen; a recipient's ending reaches the asker as a
     * message the app sends it, which IS drawn. A row here would say either one twice.
     *
     * ⚑ **But the question's own card moves** — it is the same row, saying how it closed.
     */
    case 'question_withdrawn':
    case 'question_recipient_ended': {
      const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
      if (asked !== null) {
        asked.closed = event.type === 'question_withdrawn' ? 'withdrawn' : 'recipient-ended'
      }
      return
    }

    /**
     * ⛔ **No item, and this one is a ruling about a SURFACE rather than about a duplicate** (400).
     *
     * ⚠️ **The transcript is what a conversation SAID, and a restart is the app talking about it.**
     * The row lands at the top of a ledger whose next lines are the conversation being resumed, so a
     * reader watching this transcript is about to see the restart happen; a row announcing it would
     * be the app narrating the window the reader is looking at.
     *
     * 🔴 **The reader who needs it is the PARENT, and it has two doors** — {@link PieceRow.state}
     * through `list_tasks`, and the message `RuntimeHost.tellWhoeverGaveTheWork` pushes into the
     * parent's own conversation. ⛔ Neither of them is this transcript, which belongs to the CHILD:
     * the child did not do this and cannot act on it.
     */
    case 'work_restarted':
      return

    /**
     * ⛔ **No item, as for every reopen before this row existed** (673). The row is the seam `653`'s
     * renderer crosses, and where the PIECE fold resets the drive the last life left open (D-013)
     * — it moves no piece (D-016c); the transcript draws no line at the seam today —
     * `markReopened` settles the previous life's cards there without drawing anything, and the
     * earlier life is disclosed only in the instructions sheet (`TOLD_HAS_AN_EARLIER_LIFE`).
     * ⚠️ Whether a person should SEE the seam is a design question this row does not answer —
     * `673`'s response names it as a finding.
     *
     * 🔴 **D-004 · R101 — except a reopen this app made BY ITSELF, which says so in one line**:
     * the conversation died on a revoked sign-in and was reopened on the renewed one. ⚑ `warn`, so
     * the reading view keeps it: it is the answer to the stop drawn just above it. ⚑ And one this
     * app stopped and reopened on the current sign-in for words held for it, which says what it
     * cost.
     */
    case 'reopened':
      endMessageRun(state)
      if (
        event.because === 'the-sign-in-was-renewed' &&
        event.itsCopyWasReplaced === true &&
        state.ref !== null
      ) {
        // This app replaced the refused copy itself: the turn's error rows and the reopen are one
        // line. Until a turn carries on, the message has to be sent again.
        for (const row of state.turnErrorRows) {
          const index = state.items.indexOf(row)
          if (index >= 0) state.items.splice(index, 1)
        }
        const name = PROVIDER_NAME[state.ref.provider]
        notice(state, 'warn', A_RENEWED_SIGN_IN_SAYS.sendAgain(name))
        const line = state.items[state.items.length - 1]
        if (line?.kind === 'notice') state.renewedLine = { line, name, replacedCopy: true }
        state.turnErrorRows = []
      } else if (event.because === 'the-sign-in-was-renewed') {
        notice(state, 'warn', REOPENED_ON_A_RENEWED_SIGN_IN)
        const line = state.items[state.items.length - 1]
        if (state.ref !== null && line?.kind === 'notice') {
          state.renewedLine = { line, name: PROVIDER_NAME[state.ref.provider] }
        }
      }
      if (event.because === 'the-sign-in-moved-on') notice(state, 'warn', REOPENED_FOR_WHAT_WAITED)
      // A start that brought it back from the archive, in main's words.
      if (event.broughtBack !== undefined) notice(state, 'warn', event.broughtBack)
      return

    /**
     * An agent brought it back from the archive: one line, in main's words, `warn` so the reading
     * view keeps it.
     */
    case 'restored_from_archive':
      notice(state, 'warn', event.saying)
      return

    /**
     * ⛔ **No item** (D-017 · R4): the row is for the question fold (`deriveRoutedRequests`), which
     * reads it to keep this app's own questions open across a stop — `reopened`'s note: the
     * transcript draws no line at the seam. Except one line, in main's words, when the person's own
     * login was renewed for this launch, so no work under their account goes unsaid.
     */
    case 'launched':
      endMessageRun(state)
      if (event.loginRenewed !== undefined) notice(state, 'warn', event.loginRenewed)
      // ⚑ And one when this launch could not use the text pack it was named, from its own record.
      if (event.given?.textPack?.refused)
        notice(state, 'warn', textPackRefusedSaid(event.given.textPack))
      return

    /**
     * ⚑ **D-017 · R10 — a line at each end of a replacement**, `warn` and not `info` because the
     * reading view drops `info`, and a person reading either conversation needs to know the other one
     * holds what comes next. ⚑ Which conversation is the raw Events tab's (`describeEvent`).
     */
    case 'replaced_by':
      notice(state, 'warn', REPLACED_BY_A_NEW_CONVERSATION)
      return
    case 'replaces':
      notice(state, 'warn', TOOK_THE_PLACE_OF_ONE)
      return

    /**
     * ⛔ **No item, and the row is a RECEIPT for one that is already drawn** (404).
     *
     * ⚠️ **A `pushed` row lands in the PARENT's ledger, immediately after the notice it is
     * about** — and so did a `set-right` one, written until D-016c. That notice is an ordinary
     * `user_turn` and the transcript draws it; a second item saying *we told you that* would be
     * `035`'s duplicate, one line under the thing it duplicates.
     *
     * 🔴 **Its `its-own-wake`, `its-own-question` and `its-own-brief` members, rows written until
     * D-016c, draw nothing for a different reason** — there was no message. ⛔ The conversation woke
     * the holder itself (673) — by a message that started it, since D-017 — asked it about the work
     * (719), or gave it a new brief of the work (D-016); each is already in this transcript as the
     * tool call it was, and a row narrating that it counted as being told would be the app
     * explaining its own bookkeeping to a person.
     */
    case 'work_reconciliation':
    case 'work_recovery':
    case 'work_stall_told':
      return

    /**
     * ⛔ **No item, and it is `work_stall_told`'s argument pointed the other way** (439) — and since
     * `658`, the facts land ON the call ({@link landOutgoing}), which draws as a card.
     *
     * Draw the message call itself as the outgoing card, using `toProfile` to name its recipient rather than the session handle printed in the receipt. Do not add a second item.
     *
     * ⚠️ **This row lands in the SENDER's ledger, and the act it records is already drawn there**:
     * the model called `message_agent`, so the transcript holds that call and the answer it got
     * back — *"held for sess_… as note"*. ⛔ A second item narrating *you sent a message*
     * one line under the tool call that sent it is `035`'s duplicate exactly.
     *
     * 🔴 **What the row is FOR is the half a tool call cannot carry**: the provider's `tool_call`
     * payload is `JSON.stringify(input)` truncated to 200 characters, so the structured facts — who,
     * what kind, whether it was held, its internal held-message id, which piece it named, whether a
     * person is at this conversation — exist only here. ⚑ **The raw Events tab prints all of them**
     * (`describe-event.ts`), and a fold that wants them reads the row rather than parsing a summary —
     * ⚠️ **which `658` now does**: the card prints WHO (by name), what KIND and whether it was HELD.
     * ⚑ **678 · and the WORDS** — `671` put them on this row, up to 1,280 and `clipped` past that.
     * ⚑ **688 · and the PIECE it names, by its label** (`687` H2). The held-message id, the
     * piece's id itself and the person flag stay the Events tab's.
     *
     * ⚠️ **So criterion 23's *visible in both conversations* is not resting on this decision.** The
     * sending conversation shows the exchange to a person through the tool call it made; what `439`
     * added is the DURABLE, structured half that the truncation was losing.
     */
    case 'message_sent': {
      // ⛔ **Every field read as the stored value actually is** — replay is a trust boundary, and a
      // row missing its recipient is not one this card can name or open.
      if (!isAnId(event.to) || (event.messageAct !== undefined && event.to.length > 200)) {
        rejectMessageReceipt(state, event.messageAct)
        return
      }
      const sent: OutgoingMessage = {
        toProfile: isAnId(event.toProfile) ? event.toProfile : null,
        toConversation: event.to,
        ...(typeof event.toLabel === 'string' &&
        event.toLabel.length > 0 &&
        event.toLabel.length <= 1280 &&
        !/\bsess_[\w-]+/.test(event.toLabel)
          ? { toLabel: event.toLabel }
          : {}),
        kind: isAgentMessageKind(event.kind) ? event.kind : null,
        delivery: event.delivery === 'sent' || event.delivery === 'queued' ? event.delivery : null,
        // ⚑ **678 · the words** — read as the stored value is, like every field above.
        text: typeof event.text === 'string' ? event.text : null,
        clipped: typeof event.text === 'string' && event.clipped === true,
        // ⚑ **688 · the piece, and its label** (`687` H2) — see {@link OutgoingMessage.about}.
        ...(isAnId(event.piece)
          ? { about: isALabel(event.label) ? { label: event.label } : {} }
          : {}),
      }
      if (event.messageAct !== undefined) messageReceipt(state, event.messageAct, sent)
      else landOutgoing(state, { tool: 'message_agent', sent })
      return
    }

    /**
     * ⛔ **No item, and `request_interrupted`'s reason with the sign flipped** (398).
     *
     * ⚠️ **This row is written into the CHILD's ledger and is about the PARENT's silence.** The
     * conversation being drawn here did nothing; somebody upstream failed to answer it, and a notice
     * in this transcript would tell the wrong conversation about the wrong actor.
     *
     * ⚑ **Where it belongs is the person's queue**, which is what `RuntimeHost.questionsForAPerson`
     * answers.
     *
     * ⚠️ **612 · the sentence ended *"and what the escalation exists to fill"*** (HO-088 §3.1).
     * ⛔ **No escalation fills it**; an agent's own `who_answers` or a parent's `pass_question_up`
     * does. ⚑ **The arm stays and the reasoning is untouched** — a ledger written before `612`
     * holds these rows, and every word above is still why this transcript draws nothing for one.
     */
    case 'request_escalated':
      return

    /**
     * 🔴 **405 · a notice, and it is `work_interrupted`'s ruling on a second act** (HO-019 §4).
     *
     * ⛔ **`user_command`'s ledger-only rule is *"the conversation already shows every
     * consequence"*, and here it shows the WRONG one.** `402` F2 measured what a reader sees when
     * this app refuses a child: `tool_call brobot__spawn_agent` and `tool_result ok: true` — a tool
     * call that worked. ⚑ A refusal is a successful call whose payload denies the request (`307`),
     * so the two rows above this one are the same for a spawn that happened and a spawn that a rule
     * stopped, and nothing else in the transcript separates them.
     *
     * ⚠️ **HO-019 §4 is a sentence about this surface**: *"a person reading a transcript should be
     * able to see that an agent tried something and was told no."* ⛔ **And F4 is why it is not a
     * debugging nicety** — the only reason anybody saw a model route around one of our rails is that
     * a person was reading a live run.
     *
     * ⚑ **`warn`, like the interruption it reads like.** ⛔ **Not `info`**: `transcript-mode.ts`
     * drops `info` notices in the reading view, and the reading view is where the invisibility
     * HO-019 §4 names would come back. ⚠️ **And not `error`** — a rail refusing something is this
     * app working, and colouring it like a fault is `395`'s false-provider-bug one subject over.
     *
     * ⚠️ **It is not attached to the call above it, and {@link ToolRefusedEvent} says why**: no id
     * reaches the tool layer on either provider, so the row states which tool and which rule and
     * lets its position do the rest.
     *
     * ## 🔴 425 · and the fifth clause, when there is one
     *
     * ⛔ **The four facts above were the whole line, and HO-023 §2.2 is about what that cost**: the
     * rail had composed a way out, the model was handed it in `reason`, and the person watching this
     * transcript was handed a rule name. ⚑ {@link remedyClause} adds the act in the person's register — *it can ask
     * about the work that is open* — and adds **nothing at all** when the app does not know of one,
     * which is most of the rails and every row written before this dispatch.
     */
    case 'tool_refused':
      notice(
        state,
        'warn',
        `refused: ${event.tool} · ${event.rail} · ${permanenceSaid(event.permanence)} · ${
          event.retryable ? 'retrying may work' : 'retrying will not help'
        }${remedyClause(event.remedy)}`,
      )
      awaitItsReceipt(state, event.tool, event.rail, event.told ?? null)
      return

    /**
     * ⛔ **Still no item, and now that IS a ruling** (248 — 247 left this arm as a handoff).
     *
     * Two facts arrive here and they go to two different places, neither of them a transcript row:
     *
     *  - **`running` is the LEVEL** and becomes {@link TranscriptState.background}, which the
     *    standing registry above the composer renders. Not an item, for `078`'s reason and
     *    `WorkflowRunCard`'s: it is a statement about NOW, replaced by the next frame, and one row
     *    per level change would bury the conversation under its own progress bar. ⛔ **It also
     *    reaches the CARDS it names** ({@link markLevelRunning}, 287) — two surfaces showing one
     *    piece of work must not disagree about whether it is over.
     *  - **`ended` is an EDGE** and lands on the card of the call that started the work, which is
     *    already on screen. A second row for it would be `035`'s duplicate.
     *
     * ⛔ **REPLACE, and only when the level was stated.** `247` carried the SDK's own instruction:
     * *"consumers … should replace their set with each payload rather than pairing edges, so a
     * missed bookend cannot wedge a stale running indicator."* So `[]` clears the registry and an
     * event with no `running` at all leaves it exactly as it was — `222` is what conflating those
     * two costs.
     *
     * ⚠️ **`dropped` travels with `running` and is replaced with it**, because it counts rows THAT
     * level payload carried and this one does not. It is only ever produced beside a level
     * (`backgroundWorkEvents`'s `background_tasks_changed` arm is its one writer), so a
     * `dropped` arriving alone would be a count of a set nobody stated.
     */
    case 'background_work': {
      if (event.running !== undefined) {
        // ⚠️ **Named on its own line, and the reason is a reader rather than the language.**
        // {@link withCommand}'s second source is the PREVIOUS level, so this expression reads
        // `state.background` while the statement it belongs to replaces it. Inlined it would still
        // be correct — the right-hand side is evaluated in full before the assignment happens — and
        // it would look exactly like the bug it is not.
        //
        // ⛔ **The rows are new objects, never the event's own.** `withCommand` spreads rather than
        // mutating, because `event.running`'s objects are held by `window.entries` and re-folded on
        // every release: writing the command onto them would make it travel through the ledger as if
        // the provider had sent it, which is a second channel for a fact this file is the one owner
        // of.
        const running = event.running.map((row) => withCommand(state, row))
        state.background = { running, dropped: event.dropped ?? 0 }
        // 🔴 **…and the CARDS the level names** (287 finding 1). Before this, a stated level updated
        // the registry alone, and the card of the call that started the work went on reading *"did
        // not finish"* beside a bar offering to stop it. See {@link markLevelRunning}.
        markLevelRunning(state, running)
      }
      if (event.ended !== undefined) {
        // ⛔ **`toolCallId` is the only route, and the fallback a reader expects here is a guard for
        // a case that cannot occur** (106's rule, as 246 applied it). The card learns its
        // `background.id` from `tool_result.backgroundId`, which the adapter sets from
        // `BackgroundTasks.detachedAs` — and that answers only when the task↔tool binding exists.
        // The ending's own `toolCallId` comes from `toolFor`, the SAME binding, in a map that never
        // forgets. So an ending with no `toolCallId` is an ending whose card also has no id to be
        // found by: a scan would be searching for a key nothing could have written.
        const row = event.ended.toolCallId ? toolRowFor(state, event.ended.toolCallId) : undefined
        if (row) {
          row.background = {
            ...row.background,
            id: event.ended.id,
            outcome: event.ended.outcome,
            ...(event.ended.summary ? { summary: event.ended.summary } : {}),
            ...(event.ended.outputFile ? { outputFile: event.ended.outputFile } : {}),
            endedAt: at,
          }
        }
      }
      return
    }

    /**
     * ⛔ **A LEVEL and no item** (258, on `253`'s event) — the registry, and nothing in the
     * conversation.
     *
     * ## ⛔ The reading-view ruling, made deliberately because `return` is a decision either way
     *
     * **`scheduled_work` earns no card, and the reason is that it carries no EDGE.** The level is
     * restated at every turn end, and `253` measured what that means for a job that is actually
     * firing: one process, one `session_id`, `init` at 10 194 ms, 54 805 ms and 114 037 ms as the
     * cron woke the session twice — **three levels in under two minutes, all saying the same
     * thing.** A card per level frame is a card every two minutes for as long as the conversation
     * is open, which is `078`'s *"without turning every usage update into a transcript row"* with a
     * clock behind it.
     *
     * ⚠️ **And a card gated on CHANGE would be a claim this app cannot make.** A job appearing in
     * the level does not say when it was created — the level is a set, restated, with no history in
     * it — and a job DISAPPEARING has two readings that `253` proved indistinguishable here: a
     * one-shot that fired, or one the model deleted. `039` is what a renderer inventing a
     * provider's edge costs, and `074`'s rule is that a commitment we cannot observe must not be
     * drawn as one we can.
     *
     * ⚑ **Nothing is lost from the history by that ruling.** The `CronCreate` call that made the
     * job is already a tool row in this conversation, written by the model, in its own words. What
     * was missing was never the moment — it was the STANDING fact, and a standing fact belongs
     * beside the composer with the other one (`060`, `248`). {@link ScheduleRegistry} is that.
     *
     * ## The rule this arm exists to keep
     *
     * ⛔ **`jobs` absent leaves the screen alone; `jobs: []` clears it.** Absent is *"this frame did
     * not state the level"*; `[]` is the provider saying nothing is scheduled, and it is the only
     * thing that empties this list.
     *
     * ⚠️ **Today's one producer always states the level** — `session-crons.ts` returns nothing at all
     * for a payload it cannot read, and otherwise emits `jobs` (possibly `[]`) — so the absent case
     * is reachable from the SCHEMA rather than from the adapter, and the first draft of this comment
     * wrongly called it *"the normal shape"*. It is kept because the schema permits it and because a
     * second producer is exactly what `247`'s `running` had to survive; what it must never do is
     * clear a level nobody stated.
     *
     * ⚠️ **`dropped` travels with `jobs`** for the reason it travels with `running` above: it
     * describes THAT level and no other, so a frame that states no level cannot revise the count of
     * one — the old shortfall goes on describing the old level, which is the only thing standing.
     *
     * ⚠️ **The rows are COPIED, not aliased.** `carryForward` hands this array to the next fold, and
     * two folds sharing one array is a way for them to disagree later for no reason — the same copy
     * the registry above makes, for the same sentence.
     *
     * ⛔ **There is still no control to offer, and that has not changed since `253`.** The pinned
     * SDK exposes no cron method at all; cancelling is `CronDelete`, a tool in the MODEL's
     * vocabulary. `106`'s rule is that a control which cannot act is not offered, so the bar this
     * feeds has rows and no buttons.
     */
    case 'scheduled_work': {
      if (event.jobs !== undefined) {
        const before = state.schedule
        const jobs = event.jobs.map((job) => listedSinceOf(before, job, at))
        state.schedule = {
          jobs,
          dropped: event.dropped ?? 0,
          left: before.jobs.filter((one) => !jobs.some((job) => job.id === one.id)),
        }
      }
      return
    }

    case 'provider_commands': {
      // ⛔ **REPLACE, and the whole set travels together** (279) — the list, its prefix and the
      // shortfall are one statement about one moment, so a consumer that took the rows from this
      // frame and the count from the last would be reporting a number about a list it is not
      // showing. The same rule `background_work` states above, applied to three fields instead of
      // two.
      state.commands = {
        set: { commands: [...event.commands], prefix: event.prefix },
        dropped: event.dropped ?? 0,
      }
      return
    }

    /**
     * 🔴 **What tools this conversation has** (358) — see {@link ToolRegistry}.
     *
     * ⛔ **REPLACE, and both halves travel together**, which is the rule its neighbour above states
     * for three fields and this one states for two. Claude re-publishes the whole inventory on
     * every `system/init`, and a fold that merged them would make a server that dropped out of the
     * second frame immortal — `222`'s stale indicator wearing a new hat.
     *
     * ⚠️ **`published: null` is COPIED, never normalized to an empty inventory.** It is the
     * provider saying it does not publish one, and an `[]` here would be this app claiming a Codex
     * conversation has no tools while holding the five it declared for it.
     */
    case 'tool_inventory': {
      state.tools = {
        set: {
          naming: { prefix: event.naming.prefix, separator: event.naming.separator },
          declared:
            event.declared === null
              ? null
              : {
                  server: event.declared.server,
                  ...(event.declared.instructions === undefined
                    ? {}
                    : { instructions: event.declared.instructions }),
                  tools: event.declared.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters.map((parameter) => ({ ...parameter })),
                  })),
                },
          published:
            event.published === null
              ? null
              : {
                  tools: [...event.published.tools],
                  servers: event.published.servers.map((server) => ({ ...server })),
                },
        },
        dropped: event.dropped ?? 0,
        // ⛔ **The envelope's own stamp, not a clock read here** (444 relay 1). `at` is the value
        // the host wrote to `events.created_at` as it recorded the row, so a replay carries the
        // ORIGINAL moment rather than the moment of the replay — and the two callers that fold
        // without a clock (`ChildWorkViewer`, and the card path in `transcript-window`) land
        // `null` rather than a zero. Exactly `context_reading`'s arm, 600 lines up.
        at: at ?? null,
      }
      return
    }

    /**
     * 🔴 **How this conversation opened** (332 §2) — the row neither of its neighbours can draw.
     *
     * ⛔ **An empty path draws nothing**, which is the guard `memory_recall` states one arm down and
     * for the same reason: the host publishes no event for a profile with nothing in the prompt, so
     * the only way an empty one arrives here is REPLAY — a stored row whose path did not survive
     * `boundStoredEvent`, or one edited on disk. Pushed, it renders a row claiming memory is in the
     * prompt with no file behind it, which is `106` and the bare *"the agent used memory"* row
     * 319 §1.1 rules out by name.
     *
     * ⚠️ **`beside` is NOT part of that gate.** A store with an index and nothing beside it is a
     * real launch fact and the row for it is true; it is the component that declines to print a
     * count of nothing (317's empty state).
     */
    case 'memory_loaded': {
      if (event.index === '') return
      state.items.push({
        kind: 'memoryLoaded',
        id: nextId(state, 'memoryLoaded'),
        index: event.index,
        beside: event.beside,
      })
      return
    }

    /**
     * 🔴 **What the agent said it read** (319 §1) — the other half of `memory_note` above.
     *
     * ⛔ **It does NOT close the streamed assistant block, and that is deliberate.** Every other
     * item-pushing arm in this function ends a run of prose because the model stopped talking and
     * started doing something else. This one arrives AFTER the authoritative `assistant_message`
     * that already closed it — the adapter emits the pair in that order on purpose (see
     * `codex/normalize.ts`) — so calling `closeStreaming` here would be a second writer of a state
     * that is already settled, and on the one path where it is not (a citation with no message
     * before it, which the wire has never produced) it would end a block this row has nothing to
     * say about.
     */
    case 'memory_recall': {
      // ⛔ **An empty citation draws nothing** — the same guard `memory_note` states above, and for
      // a sharper reason: `codexMemoryRecall` already refuses to emit an event with no entries, so
      // the only way one arrives here is the REPLAY path — a stored row from a build whose caps
      // differed, or one edited on disk. Pushed, it renders a heading claiming a recall with no file
      // behind it, which is the bare *"the agent used memory"* row 319 §1.1 rules out by name.
      if (event.entries.length === 0) return
      state.items.push({
        kind: 'memoryRecall',
        id: nextId(state, 'memoryRecall'),
        entries: event.entries,
        ...(event.dropped ? { dropped: event.dropped } : {}),
        ...(event.threadIds?.length ? { threadIds: event.threadIds } : {}),
        ...(event.threadsDropped ? { threadsDropped: event.threadsDropped } : {}),
      })
      return
    }

    /**
     * 🔴 **415 · a notice, and it is `tool_refused`'s ruling one subject over** (HO-021 §5).
     *
     * ⛔ **`work_replied` above draws no row of its own because *"the conversation already shows the
     * reply"*** — since `658`, on the call's own card — **and that ruling is right about the reply
     * and silent about its DELIVERY.** ⚠️ The word is in
     * the `tool_result` the model was handed back — one of `REPLY_DELIVERIES`, as its `delivered`,
     * beside a sentence that says where the reply went — and `402` F2 is this project's reason for
     * not resting on that pair: it measured a refused
     * spawn and an admitted one *"reading identically"* through it.
     *
     * ⚑ **The PO named a lost reply the one failure mode with no signal.** A row a reader can see
     * and a fold can ask is the signal; the prose in a provider's receipt is not one.
     *
     * ⚠️ **This ledger is the REPLIER's, and that is the right transcript for once.** `work_replied`
     * argues the WORDS arrive in the parent's transcript as an ordinary turn — ⛔ **and this event is
     * precisely the case where they did not.** ⚑ **658 · this row also marks the reply's card *not
     * delivered*** ({@link markUndelivered}): `work_replied` records the reply, and this row is what
     * says it went nowhere — on the card and in the notice below it.
     */
    case 'reply_undelivered': {
      // ⚠️ **A row written before D-016 names no piece**, and nothing reads the key it used.
      if (!isAnId(event.piece)) return
      // 🔴 **658 · the reply's card must not say *delivered*** — see {@link OutgoingReply.undelivered}.
      // ⛔ A row with no word for WHY is still a lost reply — never read as delivered.
      markUndelivered(state, event.piece, isAnId(event.because) ? event.because : 'not-delivered')
      // 🔴 **667 · and the notice says it in the card's words** — *W1.2*, the parent's name and
      // the reason, never `work_…` or `sess_…`. See `lib/lost-reply.ts`.
      const given = state.piecesGiven.get(event.piece)
      const giver = state.pieceGivers.get(event.piece)
      const lost: LostReply = {
        ...(given === undefined ? {} : { label: given.label }),
        // ⛔ **Only when the give in view was THIS reply's parent's** — a name is never borrowed
        // from another conversation.
        ...(giver?.profile === undefined || giver.conversation !== event.parent
          ? {}
          : { toProfile: giver.profile }),
        because: isUndeliveredReason(event.because) ? event.because : null,
        ...(event.detail === undefined ? {} : { detail: event.detail }),
      }
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: lostReplySentence(lost, null),
        lostReply: lost,
      })
      return
    }

    /**
     * 🔴 **No item, and the silence is the ruling rather than an omission** (586, `HO-080` §1.3).
     *
     * ⛔ **`074` decided what a person is SHOWN and it still holds.** A routine `rate_limit_event`
     * fires once or twice per turn saying nothing is wrong; drawing one would put a row in front of
     * a reader on every turn to tell them the ordinary thing. ⚑ **What `586` changed is what the
     * LEDGER can be asked** — `providerLimitsSeen` matches this record against a wall — and that
     * needs a typed row, not a visible one.
     *
     * ⚠️ **It was already invisible here and it stays exactly as invisible.** Before the promotion
     * it arrived as `unknown{category:'lifecycle'}`, which `transcript-mode.ts` drops from the
     * reading view and the raw stream keeps, so nothing a person could previously read has been
     * taken away.
     */
    case 'provider_limit_clear':
      return

    /** ⚑ **Never reaches a window**: the host takes the reading before the ledger sees it. */
    case 'worker_registered':
      // Worker membership is read independently of the conversation text.
      return

    case 'provider_usage':
      return

    case 'unknown': {
      state.items.push({
        kind: 'unknown',
        id: nextId(state, 'unknown'),
        provider: event.provider,
        category:
          event.label !== undefined && QUIET_BY_ITS_LABEL.has(event.label)
            ? 'lifecycle'
            : event.category,
        ...(event.label ? { label: event.label } : {}),
        raw: event.raw,
      })
      return
    }

    default: {
      // A new event variant must be handled here, not silently ignored.
      const exhaustive: never = event
      void exhaustive
      return
    }
  }
}
