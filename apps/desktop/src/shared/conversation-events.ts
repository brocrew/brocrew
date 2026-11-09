import type { AgentRulesReceipt } from './agent-rules'
import type { AppNotice } from './app-notice'
import type { HandedPath } from './attachment-contracts'
import type { WhoStoppedIt } from './how-work-stopped'
import type { AnsweredQuestion, UserTurnEvent } from './human-answer-contracts'
import type {
  McpServerRequestEnding,
  McpServerRequestWaiting,
  McpServerRequestWho,
} from './mcp-server-requests'
import type { MoveOrigin, MoveReceipt } from './move-contracts'
import type { InstructionAsk, InstructionEnding, RulesAuthor } from './own-instructions'
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
import type { WorkReconciliationEvent, WorkRecoveryEvent } from './reconciliation-contracts'
import type { RailPermanence, RefusalRemedy, RefusalTold } from './refusals'
import type {
  AgentMessageKind,
  WorkClosedEvent,
  WorkGivenEvent,
  WorkInterruptedEvent,
  WorkRebriefedEvent,
  WorkRepliedEvent,
  WorkReport,
  WorkRestartedEvent,
  WorkRetitledEvent,
  WorkSentEvent,
  WorkStallSetRightEvent,
  WorkStallToldEvent,
  WorkStatusSetEvent,
  WorkTakenBackEvent,
} from './task-contracts'
import type { WhatALaunchGave } from './what-this-agent-was-given'
import type { ActedBy } from './who-did-it'
import type { PermissionDecision, RuntimeEvent } from '@brobot2/runtime'

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
 * ⚑ **The question a notice of a question asks** — the conversation that asked it, and the request
 * id it is answered by. ⚑ Held with the notice so one whose question has stopped waiting is taken
 * back unread rather than sent.
 */
export interface TheQuestionItAsks {
  readonly asker: string
  readonly requestId: string
}

/**
 * A message the user wrote while a turn was running and chose to QUEUE rather than send (077).
 *
 * ⚠️ **This is deliberately not a {@link UserTurnEvent}, and that is the whole point.** 045 opens a
 * turn row from `user_turn` and from nothing else, so a queued message recorded as one would open a
 * turn for a prompt no provider has been given — the dispatch's *"do not invent a turn for a message
 * that has not gone"*. It is its own type, so the store's `appendTx` falls through to a plain event
 * insert and no turn exists until the message actually sends.
 *
 * ⚠️ **Recorded at QUEUE time, not at send time**, which is what makes the promise *"never silently
 * dropped"* durable rather than best-effort. Between queueing and sending, the text would otherwise
 * live only in the main process's memory; anything that killed the process there would take a
 * message the user had written and leave nothing behind that knew it had existed. Written here, the
 * transcript holds it from the moment it is queued, and {@link UnqueuedMessageEvent} always follows
 * to say how it ended.
 */
export interface QueuedMessageEvent {
  movedFrom?: MoveOrigin
  type: 'message_queued'
  /**
   * 🔴 **The name the held message was given** (354) — the same string {@link
   * QueuedMessageDisclosure.id} carries, the sender's durable receipt records, and a person's
   * cancel command accepts. ⛔ `message_agent` no longer returns it: no agent tool accepts this id,
   * so handing it to an agent looked like an actionable delivery receipt when it was neither
   * actionable nor a receipt (`490`).
   *
   * ⚠️ **OPTIONAL, and absence means one specific thing: this message was queued before messages
   * had names.** ⛔ It does NOT mean "an id we failed to write". Every `message_queued` this app
   * writes from `354` on carries one; the ledgers already on disk do not, and a required field
   * would be this type telling a reader something about those rows that is not true.
   *
   * ⚑ **In the ledger because the SLOT does not survive a restart and this does.** The held message
   * itself is deliberately never re-armed by a resume (077) — measured, and see
   * `RuntimeHost.cancelQueuedMessage` — so the pair of events is the only durable record that a
   * message was held at all, and the id is what lets a reader join the two halves by name rather
   * than by position.
   */
  messageId?: string
  /**
   * 🔴 **Which kind of thing was held** (394) — one of {@link MAILBOX_KINDS}.
   *
   * ⛔ **OPTIONAL, and absent means `work`.** Every `message_queued` written before this dispatch
   * held work, because work was the only thing that could be held; a required field would type
   * those rows as carrying something they do not. ⚑ Same shape and same reason as
   * {@link messageId}'s absence, one dispatch over — and `mailboxOf` reads the absence as `work`
   * rather than as unknown, which is the one reading the ledger actually supports.
   *
   * ⚠️ **Written even for `work`**, so the ledger says what a live host said rather than leaving a
   * reader to infer it from a gap that also means *old row*.
   */
  kind?: MailboxKind
  /**
   * The words held. ⚑ **D-022 · R1 — for a held give, the words that go out are its piece's NEWEST
   * brief, read when it is sent**: a {@link WorkRebriefedEvent} after this row names this message
   * when a new brief rode it, and the {@link UserTurnEvent} it becomes records the words sent.
   */
  text: string
  /**
   * ⛔ **The paths queued along with it** (216, review).
   *
   * Show attachment paths with held messages so the person can inspect the context BroBot adds while delivery is still reversible.
   *
   * ⚠️ Absent, never empty, so the ledger of a conversation that never attaches anything is
   * unchanged — the same shape {@link UserTurnEvent} uses.
   */
  attachments?: HandedPath[]
  /**
   * 🔴 **What the HELD message reports, when the app queued it about work** (406) — the same
   * {@link WorkReport} the {@link UserTurnEvent} below it will carry when it flushes.
   *
   * ## ⛔ On both rows, because a busy parent is the ordinary case and not an edge
   *
   * ⚠️ **A reply and an undriven-work notice are delivered through `queueMessage`**, which SENDS
   * when the target is idle and HOLDS when it is not — and a parent with two children is busy
   * exactly when one of them finishes. ⛔ Carrying the report on the turn alone would leave the
   * held row drawn as the person's own bubble until the flush, and then swap it for a work card:
   * the same fact rendered two ways a few seconds apart, and the first way is `214`'s defect.
   *
   * ⚑ **Absent is a held row with no report** — every one a composer produces, every
   * `message_queued` this app wrote before `406`, and every app-authored row about something else.
   * ⛔ **687 · it no longer says the PERSON queued it**: a held plan go-ahead has no subject at all
   * and is BroBot's words, and {@link attribution} is the key that tells the two apart (R22).
   */
  work?: WorkReport
  /**
   * 🔴 **The conversation whose agent wrote the HELD words** (413) — {@link
   * UserTurnEvent.relayedFrom}, on the row that is read first.
   *
   * ⛔ **Held work is the ordinary case for this field, not an edge.** A message or a brief sent to
   * a conversation mid-turn is held until it finishes what it is doing, so a busy owner receives
   * every new piece as a held row — and until `413` that row was drawn under *"You"* with a
   * **Cancel it** button on it. ⚑ `406` found the same pair on a reply and closed it for a report;
   * this is the half that reaches every piece of work in the product.
   *
   * ⚠️ **Absent is a held row nobody relayed**, which is {@link work}'s absence one subject over
   * — ⛔ not *the person's*: whose words they are is {@link attribution}'s answer since `687`.
   */
  relayedFrom?: string
  /**
   * 🔴 **WHO relayed the held words** (545) — {@link UserTurnEvent.relayedFromProfile}, on the row
   * that is read first.
   *
   * ⛔ **It reached this row without anybody remembering to widen it**: `heldAuthorship`, until
   * `687`, was `Omit<TurnAuthorship, 'attribution'>`, and its docblock predicted this field. ⚑ Since
   * `687` the held row takes {@link TurnAuthorship} whole, so the prediction holds for every key.
   * A held row and the turn it becomes are the same row a few seconds apart, and they may not
   * disagree about who is speaking.
   *
   * ⚠️ **Absent is reachable here for {@link UserTurnEvent.relayedFromProfile}'s two reasons**, and
   * on a held row for a third: the row was written before `545`.
   */
  relayedFromProfile?: string
  /**
   * 🔴 **This app's own report, on the row that is read FIRST** (624) —
   * {@link UserTurnEvent.appNotice}.
   *
   * ⛔ **A held notice is the ordinary case and not an edge.** `queueMessage` HOLDS when the
   * receiver is mid-turn, and a notice arrives while its conversation is working at least as often
   * as not — so this is the row a person meets first: without it, headed *You*, with **Cancel it**
   * under it.
   *
   * ⚑ **It reached this row the way {@link relayedFromProfile} did**, with nothing edited to carry
   * it. ⚠️ **Absent is a held row that is not the app's own report** — {@link work}'s absence one
   * subject over, and ⛔ not *the person's*: that is {@link attribution}'s answer since `687`.
   */
  appNotice?: AppNotice
  answeredQuestion?: AnsweredQuestion
  /**
   * 🔴 **Whose words these are, on the row that is read FIRST** (687, R22) —
   * {@link UserTurnEvent.attribution}, the same vocabulary and the same writer.
   *
   * ⛔ **The row this closes: a held plan GO-AHEAD** (`670` F-a). Its authorship is `app_authored`
   * with NO subject — BroBot's own sentence, sent because a person pressed a button — and until
   * `687` the held row dropped `attribution`, so it arrived as `{}`: the shape of the person's own
   * queued message. ⚑ A window drew it headed *You*, offered **Cancel it** as theirs, and after an
   * unsent ending offered **Put it back in the composer**, loading BroBot's sentence into their
   * draft. `214`'s defect, on the one producer with no subject to be read by.
   *
   * ⚑ **The PM's ruling, R22**: *"the hold is right; the ROW must tell the truth. A held go-ahead
   * is BroBot's words, so its queued row says app-authored, no subject."* ⛔ **Not a second word for
   * the same fact**: the turn's own field, carried by `RuntimeHost`'s held branch as it carries the
   * rest of {@link TurnAuthorship}.
   *
   * ⚠️ **Present on EVERY app-authored held row since `687`, not on the go-ahead's alone** — a reply,
   * a notice and an agent's brief carry it beside their subject, exactly as their turns do; the
   * subject still picks the entry. ⚠️ **Absent on a person's own held message**, and on every held
   * row written before `687` — where a row with a subject was app-authored anyway, and one with none
   * was the person's or, rarely, a go-ahead that lost its race: *not recorded*.
   */
  attribution?: UserTurnEvent['attribution']
  /**
   * 🔴 **What the AGENT that sent the held words said they are** (687 · `678` H1) —
   * {@link UserTurnEvent.says}, on the row that is read first, and absent for its reasons.
   */
  says?: AgentMessageKind
  /**
   * 🔴 **D-016 · the piece a HELD brief or new brief delivers** — {@link UserTurnEvent.piece}, on the
   * row that is read first.
   *
   * ⛔ **It is what keeps a held brief's piece across a quit**: a held message rebuilt from this row
   * at the next start still names the piece it carries, so the turn it becomes does too, and a hand
   * over of what a stopped conversation held knows it is work. ⚠️ Absent on every held row that is
   * not a brief, and on every row written before D-016.
   */
  piece?: string
  /** ⚑ **D-016 · the held brief's label** — {@link UserTurnEvent.label}, present only beside {@link piece}. */
  label?: string
  /**
   * 🔴 **D-016 · commit 6 · R4 — the piece of this conversation's the HELD words drive** —
   * {@link UserTurnEvent.drives}, on the row that is read first, for its reasons and absent for
   * them. ⚑ The turn these words become carries the same value, and while they wait, work they
   * drive is held for them (D-005a) — and work they do not drive is not.
   */
  drives?: string
  /**
   * 🔴 **F088 · the piece the HELD words name, when an agent's note or follow-up names one** — the
   * piece itself, which {@link drives} is not when it hangs under one of this conversation's. ⚑ On the
   * row so a held message rebuilt at a start still says, in its sender line, which piece it is about.
   * ⛔ Nothing folds it, and the {@link UserTurnEvent} these words become does not carry it: what they
   * drive is {@link drives}. ⚠️ Absent on held words that name no piece, and on every row written
   * before it.
   */
  about?: string
  /**
   * ⚑ **The question a held question's notice asks** — see {@link TheQuestionItAsks}. ⚑ On the row
   * so a held notice rebuilt after a quit still names it: one whose question has stopped waiting is
   * taken back unread at the start rather than sent. ⚠️ Absent on every other held row, and on
   * every question's row written before it.
   */
  asks?: TheQuestionItAsks
  /**
   * ⚑ **D-016 · the held words are a NEW brief of {@link piece}** (`update_work`), not the brief that
   * gave it — present only beside {@link piece}, and absent otherwise.
   *
   * ⛔ **What keeps the right sender line across a quit**: a held message rebuilt from this row says
   * it is the new brief of its piece, as the live one does.
   */
  rebrief?: true
  /**
   * 🔴 **D-030 · held while nothing ran in this conversation, for its next start** — written by
   * `RuntimeHost`'s hold for a conversation it is not running (a reply, an answer, a notice), and
   * read by the launch's sweep (`SessionStore.settleStrandedMessages`): no crash cut the life that
   * held it, so it waits for that start whatever ended the conversation's last life — ⚠️ a crash
   * before it leaves a row that says `idle`, so the row cannot say it. ⚑ Until a life begins after
   * it (`launched`): from then it is that life's, and a crash of that life settles it.
   * ⚠️ Absent on every other held row, and on every row written before D-030.
   */
  forItsNextStart?: true
}

/**
 * How a queued message ended (077). Always emitted, exactly once, for every {@link
 * QueuedMessageEvent} — the pairing is what stops a queued bubble sitting in a transcript forever
 * with no account of itself.
 *
 * The reasons name the real endings, and they are kept apart because a reader deserves to
 * know which one happened (three until `690` added `retracted`):
 *  - `handover` — a moved request left the durable queue before an opaque provider handoff.
 *    A following person turn confirms it; without that, delivery remains unconfirmed and never
 *    retries automatically.
 *  - `sent` — the turn ended and we sent it. A `user_turn` follows immediately, and THAT is the one
 *    that opens the turn row. Both events exist because "it was queued" and "it was sent" are two
 *    facts, and collapsing them would lose the first.
 *  - `cancelled` — somebody took it back before it went: a person, or (`withdraw_task`, 429) the
 *    agent that gave the work.
 *  - 🔴 **`retracted` — THIS APP took back its own notice before it was read, because a later fact
 *    made it false** (690, PM ruling R32, from `673` F-1). ⛔ Never dressed up as `cancelled`, which
 *    is somebody's own act; ⚑ {@link UnqueuedMessageEvent.detail} always says what made it false.
 *  - `abandoned` — the conversation ended underneath it. Never dressed up as `cancelled`: nobody
 *    chose this, which is 063's *"a plan approved by nobody"* in the other direction.
 *
 *    ⛔ **This used to end *"so it never could be sent"*, and 234 §1 made that too strong.** An
 *    ending can land while the message is being handed over — teardown cannot refuse the way a
 *    cancel can, so it takes the ending and the flush publishes nothing when it resumes. The
 *    message may therefore have reached the provider, which is stopped either side of that instant,
 *    so no answer can come back. ⚑ {@link UnqueuedMessageEvent.detail} carries the difference in
 *    words; the bare reason no longer claims the message never left.
 */
export interface UnqueuedMessageEvent {
  movedFrom?: MoveOrigin
  type: 'message_unqueued'
  /**
   * 🔴 **Which held message this is the ending of** (354).
   *
   * ⚠️ **Optional for the same reason and only that reason** — see {@link
   * QueuedMessageEvent.messageId}. ⛔ **A reader may not pair a named ending with an unnamed
   * beginning**: one of them predates `354` and the other does not, so an equality that treats
   * `undefined` as a match would join two different messages.
   */
  messageId?: string
  reason: 'sent' | 'cancelled' | 'retracted' | 'abandoned' | 'handover'
  /**
   * 🔴 **What the message REPORTED, when the app queued it** (406, from the review) — the same
   * {@link WorkReport} its {@link QueuedMessageEvent} carried.
   *
   * ## ⛔ Because a window can hold the ENDING without the beginning
   *
   * ⚠️ **`054` pages the transcript**, so the fold has a branch that rebuilds a queued row from
   * this event alone — *"the message is still shown, still marked never-sent, still offered
   * back"*. ⛔ Without the report on this row that rebuild draws an app-authored reply as the
   * person's own bubble, which is the defect `406` exists to remove reappearing on the one path
   * that never sees the row it repaired.
   *
   * ⚠️ **Absent on `reason: 'sent'`**, for {@link attachments}' stated reason one field down: the
   * fold splices the waiting item out on that ending and the `user_turn` beside it IS the record,
   * so a copy here would have no reader.
   */
  work?: WorkReport
  /**
   * 🔴 **Whose words the never-sent message was** (413) — {@link UserTurnEvent.relayedFrom}, on
   * the ending, for {@link work}'s stated reason one field up.
   *
   * ⛔ **The rebuild branch is the whole of it.** A window holding the ending without the
   * beginning rebuilds the row from this event alone; without this, a task one agent gave another
   * comes back as the person's own bubble — offering to put another model's words into their
   * composer.
   *
   * ⚠️ **Absent on `reason: 'sent'`**, as {@link work} is.
   */
  relayedFrom?: string
  /**
   * 🔴 **WHO relayed the never-sent words** (545) — {@link UserTurnEvent.relayedFromProfile}, on
   * the ending, for {@link relayedFrom}'s stated reason one field up.
   *
   * ⛔ **The rebuild branch is the whole of it**, exactly as it is for the field above: a window
   * that never saw the `message_queued` draws this row from this event alone, and a rebuild that
   * kept the relay and dropped the relayer would name nobody on a row whose sibling names somebody.
   */
  relayedFromProfile?: string
  /**
   * 🔴 **This app's own report, on the ENDING** (624) — {@link QueuedMessageEvent.appNotice}, for
   * {@link work}'s stated reason three fields up.
   *
   * ⛔ **The rebuild branch is the whole of it**, and it is reachable here for a reason the other
   * two do not have: a notice is `abandoned` when the conversation ends holding it, and the
   * window a person reads that on is routinely one that has paged past the queueing. ⚑ Without
   * this, the app's own report comes back as the person's own bubble — offering to put this app's
   * words into their composer, which is `214`'s defect manufactured by the row built to remove it.
   */
  appNotice?: AppNotice
  answeredQuestion?: AnsweredQuestion
  /**
   * 🔴 **Whose words the never-sent message was, on the ENDING** (687, R22) —
   * {@link QueuedMessageEvent.attribution}, for {@link work}'s stated reason.
   *
   * ⛔ **The rebuild branch is the whole of it, and the go-ahead is the row it matters for**: a
   * held go-ahead a person cancelled, or one a Close abandoned, is rebuilt from this event alone by
   * a window that paged past its queueing — and without this it comes back as the person's own
   * words, with *Put it back in the composer* under BroBot's sentence.
   *
   * ⚠️ **Absent on `reason: 'sent'`**, as {@link work} is.
   */
  attribution?: UserTurnEvent['attribution']
  /**
   * 🔴 **What the AGENT that sent the never-sent words said they are** (687 · `678` H1) —
   * {@link UserTurnEvent.says}, for {@link work}'s stated reason. ⚠️ Absent on `reason: 'sent'`.
   */
  says?: AgentMessageKind
  /**
   * The text that was queued, repeated here so this event can be read on its own.
   *
   * Redundant against the {@link QueuedMessageEvent} above it only while the whole ledger is in
   * hand: 054 pages the transcript, so the window a reader is looking at can legitimately contain
   * the ending without the beginning. Carrying the text means an abandoned message can still be
   * shown — and offered back — from a page that never saw it queued.
   */
  text: string
  /**
   * The paths, for exactly the reason the text is here (216, review): *offered back*.
   *
   * ⛔ A `cancelled` or `abandoned` message that returned its words and dropped its attachments
   * would hand somebody a restored draft that is quietly missing what they attached, and looks
   * complete. `reason: 'sent'` carries them too, though the {@link UserTurnEvent} beside it is the
   * authority there.
   */
  attachments?: HandedPath[]
  /**
   * ⚠️ **Why, when `abandoned` alone would say something untrue** (216, review).
   *
   * `abandoned` was built for one cause — *"the conversation ended underneath it"* — and the bubble
   * says exactly that in words. ⛔ **Other causes reach it, and each needs its own sentence:**
   *
   *  - a queued message whose attached file was deleted before the flush (216) — abandoned, and NOT
   *    the conversation ending;
   *  - a message an ending landed on MID-HANDOVER (234 §1) — abandoned, and the one case where we
   *    genuinely do not know whether the provider received it.
   *
   * ⚑ A queued message whose conversation holds a Claude sign-in the machine has moved on from is
   * not one of them any more (648 made it one): it stays held, and the reopen on the current
   * sign-in sends it.
   *
   * ⛔ Present only when there is a more specific sentence to give; the generic wording stands when
   * it is absent, and the absence is itself a claim — nothing was in flight.
   *
   * 🔴 **690 · and ALWAYS on `retracted`**, where it is the only place the later fact is named:
   * the word says the app took its notice back, and only this says why it had stopped being true.
   */
  detail?: string
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
   * limited to its explicit allowlist: `malformed-request` and `spawning-disabled`, each owned by
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

/**
 * 🔴 **A reply that was recorded and did not reach the conversation that gave the work** (415,
 * HO-021 §5) — the fourth property, named and built.
 *
 * ## ⛔ Why it is a row and not a returned word
 *
 * ⚠️ **`reply_to_parent` already answers `delivered`, a member of `REPLY_DELIVERIES`, so the AGENT is
 * told.** ⛔ **Nobody else was.** The answers classified by `REPLY_LANDED` as *nothing landed
 * anywhere* left at most a `console.warn` in a process nobody is watching — so a person reading the
 * child's transcript saw its work go `answered` and had no way to know the words had not arrived.
 *
 * ⚑ **The PO placed this above the rest of the round:** *"a lost reply is the worst outcome in this
 * system — worse than a refused one, worse than a duplicated task — because it is the one failure
 * mode with no signal."* ⚠️ **So the signal is a durable row**, and it is written where it can always
 * be written: the REPLYING conversation's own ledger, after its {@link WorkRepliedEvent}.
 * ⛔ The parent may have no live slot at all — that is one of the reasons this row exists — so a row
 * written there would be a record that vanished in exactly the case it is about.
 *
 * ## ⚠️ What it does NOT change
 *
 * ⛔ **The piece stays `answered`.** `393`'s ordering is deliberate — the ledger row cannot be
 * conditional on somebody being there to read it — and this row is a fact about the DELIVERY, never
 * about the work. ⚑ The reply is still in `list_tasks` for whoever opens the parent next, which is
 * why that reader exists.
 *
 * ## 🔴 729 · and written LATER too, when a reply held for its giver never reached it (R89)
 *
 * ⚑ **PM ruling R89:** *"Lost is lost, whatever lost it."* A reply `held` for a busy giver landed —
 * its words were in the giver's mailbox — and so did one `kept` for its next start (D-030), in its
 * ledger; and the message can still end unsent: a stop that cut its handover, a Cancel at its door
 * (no control offers one), or a crash. ⚑ **Then this row is written into the
 * replier's ledger when that ending is**, with `because` {@link AN_ANSWER_HELD_THEN_LOST}, by
 * `RuntimeHost` — and, for a crash, by the next launch's repair.
 * ⚠️ **So it no longer always follows its {@link WorkRepliedEvent} immediately**: turns can sit
 * between the reply and the row, and the row's moment is the loss.
 */
export interface ReplyUndeliveredEvent {
  type: 'reply_undelivered'
  /**
   * The piece that was answered — {@link WorkRepliedEvent.piece}. ⚠️ Every row this build writes
   * carries it; a row written before D-016 names a task under another key, and nothing reads it.
   */
  piece?: string
  /**
   * ⚠️ **The conversation the reply was for.** ⛔ An id and not a name: this row is read by a person
   * looking at a transcript, and the conversation it names may have ended.
   */
  parent: string
  /**
   * 🔴 **Which of `REPLY_DELIVERIES` happened**, carried rather than re-spelled — the same word the
   * replying agent was handed back, so a reader and the model are looking at one fact. ⚠️ **Or,
   * since `729` (R89), {@link AN_ANSWER_HELD_THEN_LOST}**: the agent was handed back `held` or `kept`
   * (D-030), which was true, and this is what became of the held message after — the giver's own
   * `message_unqueued` says which ending it was. ⚑ A reader with no words for it says the reply did
   * not arrive, and no reason (`lost-reply.ts`' `isUndeliveredReason`).
   *
   * ⛔ **Typed as a string for the reason {@link ToolRefusedEvent.rail} is**: this module is the
   * renderer's and holds no vocabulary of the main process's own. ⚑ `REPLY_LANDED` is the table that
   * decides which members reach here, and it is keyed by that vocabulary, so a new delivery answer
   * cannot be added without saying whether it landed. ⚠️ `no-conversation` is no longer written
   * (D-017): a giver that is not running is started for the reply. ⚑ **D-030** — and a delivery
   * that failed keeps it (`kept` or `held`, landed), so a start that failed writes no row.
   */
  because: string
  /**
   * ⚑ **D-017 · R14 — why it did not land, in words this app wrote** — ⚑ since D-030 why the words
   * could not even be kept for the giver's next start: its record would not take them, or they could
   * not be composed. ⛔ Never the
   * error's own message, which names ids and paths and goes to the log. Absent on rows written
   * before D-017, and on {@link AN_ANSWER_HELD_THEN_LOST}'s; ⚠️ a row an earlier build wrote may
   * name a start that failed.
   */
  detail?: string
}

/**
 * 🔴 **The SENDER's own record that it sent a message to another conversation** (439 · criterion 23).
 *
 * ## ⛔ The half of an exchange that was in one ledger and not the other
 *
 * ⚠️ **HO-024 §4 row 23 asks that *both sides of that exchange are visible in both conversations*,
 * and before this row the outgoing half was visible in one.** Every durable fact of an
 * agent-to-agent message landed in the RECIPIENT's ledger — `message_queued` and the `user_turn`
 * carrying the words — and the sender's ledger held one provider `tool_call` whose
 * payload is `JSON.stringify(input)` truncated to 200 characters. ⛔ **A conversation could not
 * durably say what it had asked, of whom, or whether the asking opened a piece of work.**
 *
 * ⚑ **`work_stall_told` is the precedent and the proof that the shape was always representable**
 * (`404`, as `work_reported`): a row in the GIVER's ledger recording that it was told something.
 * This is the same move for the other direction — a row in the SENDER's ledger recording that it
 * told somebody.
 *
 * ## 🔴 671 · it carries the WORDS too, bounded — and the reason it did not was false
 *
 * ⛔ **This section used to read *"It carries FACTS and not the words, deliberately"*, on the
 * premise that *"the words are the sending model's own output and are already in its
 * transcript."*** ⚠️ **They are not, and the paragraph above says so**: the sender's ledger holds
 * one provider `tool_call` whose payload is `JSON.stringify(input)` cut at 200 characters, so a
 * message longer than that was in this conversation's record as its first line and nowhere else.
 * `658` G1 put it on a screen — the sender's card ends in *…* where the message went on.
 * ⚑ **No ruling rested on the premise** (rule 19: it was a characterisation), and `671` §1 is the
 * PM's decision to carry them, *"the way a reply carries its summary."* See {@link text}.
 *
 * ⚠️ **It is still not a second spelling that can disagree**: the recipient's `user_turn` holds the
 * whole message and this row holds its head, cut at a stated bound and MARKED when cut
 * ({@link clipped}). ⚑ The facts the truncation also lost — who it reached, what the sender said it
 * was, whether it was held, which piece it named — are here.
 *
 * ## 🔴 `onBehalfOfAPerson` is DERIVED and can never be claimed
 *
 * Read presence from the sending slot's `SessionSlot.ownerIsAPerson`, copied from `RuntimeEventSink.aPersonIsBehindIt` on ownership. No tool argument lets the model declare this fact; accepting that claim would let agent words assume the person's authority.
 *
 * ⚑ **And it says a person is THERE, never that the words are theirs.** See
 * `messageNamingItsSender`, which is the sentence the receiving model reads.
 */
export interface MessageSentEvent {
  type: 'message_sent'
  /** The conversation the words went to. */
  to: string
  /** The identity behind {@link to}, or null when that conversation has no identity. */
  toProfile: string | null
  /** Matches the identity echoed by this sending call's tool_result. */
  messageAct?: string
  /** The validated address used by the sending tool, unchanged. */
  addressedAs?: string
  /** The receiver's conversation name when this delivery was admitted. */
  toLabel?: string
  /** What the SENDER said this message is — one of `AGENT_MESSAGE_KINDS`. A claim, and labelled. */
  kind: AgentMessageKind
  /** Whether it went straight out or was held behind a turn. */
  delivery: 'sent' | 'queued'
  /** The held message's id — present on the `queued` branch only, and the handle a cancel names. */
  messageId?: string
  /**
   * 🔴 **D-016 · the piece this message named** — a follow-up names the piece the sender gave that
   * conversation; a note may name one the sender holds or gave. ⚑ Absent when it named none, and on
   * every receipt written before D-016.
   */
  piece?: string
  /**
   * ⚑ **That piece's label** (687 · `678` H2's reason, as a task's number) — the sender's card names
   * the piece without walking the tree. ⛔ Present only beside {@link piece}.
   */
  label?: string
  /**
   * ⛔ **Whether a person is at the conversation that sent this.** Derived from the slot, never
   * stated by a caller — see this interface's own note.
   */
  onBehalfOfAPerson: boolean
  /**
   * 🔴 **The words the sender gave `message_agent`, verbatim up to `REPLY_SUMMARY_LIMIT` UTF-16
   * units** (671 · `658` G1) — never summarised, never re-wrapped.
   *
   * ## ⛔ Why THAT bound, and why not a new one
   *
   * ⚠️ **The message has no limit of its own to derive from**: `message_agent`'s `text` is a bare
   * `z.string()` and so is the command wire's (`wire-bounds.test.ts`'s table has no length for it).
   * ⚑ **`REPLY_SUMMARY_LIMIT` (`reply-rails.ts`, 1,280, measured by `353` §6.2) is the bound this
   * app already puts on every OTHER string one agent writes into another conversation** — a
   * reply's summary, an `ask_question` question and `pass_question_up`'s context. `message_agent`
   * has no bound of its own, so its receipt takes the family's number rather than a fourth.
   * ⚠️ **Not the only unbounded door, and the first draft said it was** (`671`'s review):
   * `answer_question`'s free-text answers reached the asker's conversation unbounded too, and `676`
   * F4 cut and marked them the way this receipt is. ⚠️ **`676`'s search found a third that is still
   * open**: a question a child's MODEL raises through its own provider reaches the parent's turn
   * unbounded (`deliverQuestion` → `questionText`), and `questionText` rules its labels verbatim,
   * so bounding it is a ruling rather than a repair. ⛔ **Cut here and never refused**: those three doors REFUSE past the bound, and
   * adding a refusal to `message_agent` would refuse calls that were correct yesterday — standing
   * rule 24's test fails, so this is a receipt's bound, not the tool's.
   *
   * ⚠️ **Absent on every row written before `671`**, which is the absence of a copy and not a
   * message with no words: a reader draws what it drew before. ⛔ **Not bounded again on replay**,
   * exactly as {@link WorkRepliedEvent.summary} and {@link UserTurnEvent.text} are not — free text
   * this app wrote is carried as written.
   */
  text?: string
  /**
   * ⛔ **Present, and `true`, exactly when {@link text} is the head of a longer message** — the
   * `Words.clipped` rule (614, `shared/last-exchange.ts` since D-012): a cut that is not SAID reads as the whole. ⚑ The whole is
   * in the recipient's conversation, which is what the sender's card opens.
   */
  clipped?: true
}

/**
 * 🔴 **An agent asked for something against one identity's own instructions** (582) — a ledger row,
 * folded by {@link waitingOnAPerson}.
 *
 * ⚑ **The row is appended the moment the ask is made** (`HO-062` §4): no tool can end it, and the
 * only door that can is a person's.
 */
export interface InstructionProposedEvent {
  type: 'instruction_proposed'
  /** `iprop_<uuid>` — minted by this app, which is why a person's door can find it. */
  askId: string
  /** ⚑ Which arm the agent took — see {@link INSTRUCTION_ASKS}. */
  ask: InstructionAsk
  /** The identity the rules are ABOUT, by folded slug — never the proposer. */
  about: string
  /** The proposing agent, by slug. ⚑ `438`'s rule: a claim carries its speaker. */
  proposedBy: string
  /** Snapshotted when proposed; legacy rows may not have recorded a name or baseline. */
  author?: RulesAuthor
  basedOnVersion?: number
  /** The rules it wants in force, whole. ⛔ Bounded by {@link OWN_INSTRUCTIONS_CHARS} at the door. */
  text: string
  /** ⚠️ **The agent's reasoning — a CLAIM.** Nothing in this app checked a word of it. */
  why: string
}

/**
 * 🔴 **How one {@link InstructionProposedEvent} stopped waiting** (582).
 *
 * ⛔ **There is no tool that can write this row**: `approved` and `refused` come from a person at
 * the sheet, `superseded` from this app when the person writes their own version, and `withdrawn`
 * when the work that asked was stopped.
 */
export interface InstructionSettledEvent {
  type: 'instruction_settled'
  /** The ask this ends — {@link InstructionProposedEvent.askId}. */
  askId: string
  /** One of {@link INSTRUCTION_ENDINGS}. */
  ending: InstructionEnding
  /**
   * ⛔ **Who settled it** — `RuntimeHost.whoDidIt`, read off the caller at the moment it stopped
   * waiting, and OPTIONAL: absence means *written before this app recorded who*.
   */
  by?: ActedBy
}

/**
 * An agent asked the person to register an external MCP server (`request_mcp_server`). The row is
 * written in the asking conversation's ledger and contacts nothing; only a person's press settles
 * it ({@link McpServerRequestSettledEvent}).
 */
export interface McpServerRequestedEvent {
  type: 'mcp_server_requested'
  /** `msreq_<uuid>`, made by this app. */
  requestId: string
  /** The server's name, folded, as it would be registered. */
  name: string
  /** The address, as `new URL(…).href` gives it, so its host is lowercase and in punycode. */
  url: string
  /** What the agent says the server can read and do. Its claim; nothing checked it. */
  reaches: string
  /** Who would get the server. */
  whoGetsIt: McpServerRequestWho
  /** With `only-these-agents`: the agents, by folded profile slug. */
  agents?: readonly string[]
  /** The asking agent, by profile slug. */
  requestedBy: string
  /** The asking conversation's own piece of work this is for, when it named one. */
  piece?: string
  /** That piece's label. Present only beside {@link piece}. */
  label?: string
}

/** One MCP server request waiting on a person, as the window reads it: with what its asker is called. */
export interface McpServerRequestForAPerson extends McpServerRequestWaiting {
  /** What the asking conversation is called, for the card's "reopens …". */
  readonly askerCalled: string
}

/**
 * How one {@link McpServerRequestedEvent} stopped waiting. No agent tool writes this row: a person's
 * press does, or this app when the person registers a server of that name themselves.
 */
export interface McpServerRequestSettledEvent {
  type: 'mcp_server_request_settled'
  /** The request this ends. */
  requestId: string
  ending: McpServerRequestEnding
  /** Who settled it. */
  by?: ActedBy
  /** With `approved`: the tool names the server offered when it was registered. */
  offered?: readonly string[]
  /** With `approved`: agents the request named that no longer existed, so got nothing. */
  notGiven?: readonly string[]
  /** With `could-not-register`: why. */
  why?: string
}

/** The durable binding of a normal worker, recorded with its first conversation row. */
export interface WorkerRegisteredEvent {
  type: 'worker_registered'
  identity: string
  identityCreatedAt: number
  giver: string
  number: number
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

export type TranscriptEvent =
  | WorkReconciliationEvent
  | WorkRecoveryEvent
  | WorkerRegisteredEvent
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

/** One recorded entry with the ordinal it was published under — the transcript, replayable. */
export interface PersistedEventInfo {
  /** Canonical human-final association for this history row; null means it is not selected. */
  humanFinal?: import('./human-answer-contracts').HumanFinalContext | null
  ordinal: number
  /** When it happened, epoch ms — the recorded time, not the moment it was replayed. */
  at: number
  event: TranscriptEvent
}

/**
 * 🔴 **What a mailbox slot is holding, as a closed vocabulary** (394, HO-007 S4).
 *
 * ## ⛔ Two kinds because one of them may be refused and the other may never be
 *
 * ⚠️ **`354`'s singleton is right for WORK and wrong for a QUESTION, and both halves are rulings.**
 * Criterion 13 is *"a second queued work message to a busy child is refused, naming the held one"*,
 * and `354` gave the reason: a second would replace words somebody meant to send. ⛔ A question
 * cannot be dropped on the floor, so it is held beside the work rather than instead of it.
 *
 * ⚑ **608 · the reason is now different for each of the two origins, and it survives for both**
 * (HO-084 §4). ⛔ **A PROVIDER-raised question still blocks**: the adapter sits on the request and
 * the conversation that raised it cannot go on until somebody answers. ⚠️ **An `ask_question`
 * question no longer blocks anybody** — the verb returns as soon as the rows are written — but a
 * refused delivery would mean the routed question never reached the parent's transcript at all,
 * and the worker would be waiting on an answer nobody was ever shown a reason to give. 🔴 **One
 * exemption, two reasons, and neither is *the asker is blocked* alone any more.**
 *
 * ⚑ **The widening is opt-in at the call site.** `RuntimeHost.queueMessage` takes `'work'` by
 * default and every existing caller keeps the singleton it had; only the routing chokepoint asks
 * for `'question'`. ⛔ **A shared gate loosened for one caller is loosened for all of them**, which
 * is `a-narrowing-is-opt-in-at-the-call-site-too` pointed the other way.
 *
 * ⚠️ **Order is a FACT and not an implementation detail**: the mailbox is a queue, deliveries are in
 * arrival order, and `mailboxOf` derives that order from the ledger so it can be read rather than
 * assumed. A question that arrives while an earlier one is unanswered does not wait for it — it
 * takes the next slot, and the two are answered BY ID in whatever order the parent chooses.
 *
 * ## 🔴 A third kind, because a NOTICE is neither of the first two (400, criterion 4)
 *
 * ⛔ **`notice` is the app telling a CONVERSATION something it observed.** ⚠️ It is not `work`:
 * nobody owes a reply, no task is minted, and criterion 13's *"a second queued work message is
 * refused, naming the held one"* must go on being exactly as true as it was, which it is — the
 * refusal reads `kind === 'work'` and this is not that. ⛔ **And it is not `question`**: nothing is
 * blocked on the receiver and there is no request id to answer. ⚑ Calling it either would put a
 * word in the ledger that says something nobody said, which is `395`'s ruling one vocabulary over.
 *
 * 🔴 **TWO producers, and the sentence above said *a parent* and *today* about one of them.**
 *
 *  - ⚑ **`400`** — work a parent gave out has stopped being driven.
 *  - ⚑ **`591`** — a question a WORKER asked has been answered (`RuntimeHost.deliverAnswer`,
 *    HO-082 §2). ⛔ It travels DOWN the edge the first one travels up, which is why the word is now
 *    *a conversation*: a notice is not a thing only parents get. ⚠️ **608 · it used to say *after
 *    its turn moved on*, which was the late case** — since the hold came off (`HO-084` §4) it is
 *    the ONLY case, and this producer carries every answer to every `ask_question` question.
 *
 * ⚠️ **It shares `question`'s exemption from the singleton and needs it for a different reason.** A
 * question that is refused never reaches the one conversation that can answer it; a notice that is
 * refused leaves the receiver never told, which is the whole of criterion 4 — *nobody waits forever
 * in silence* — failing silently, and failing exactly when the receiver is busy. 🔴 **`591`'s
 * producer needs the same exemption for the sharper version of that**: a worker that asked a
 * question and carried on working is busy BECAUSE it did not wait, so `work` would drop the answer
 * in precisely the case the answer exists for. ⛔ **608 made that the ordinary case rather than the
 * late one**, so this exemption is now load-bearing on every ask rather than on the slow ones.
 *
 * ## 🔴 624 · the word now decides a second thing
 *
 * ⚠️ Every producer has one shape: **every `notice` this app writes is the app reporting something
 * it observed, and none of them is anybody's words being carried.**
 *
 * 🔴 **That is why `RuntimeHost.cancelQueuedMessage` now READS this word** (`HO-095` §6.2: *a
 * person may not cancel the app's delivery of a fact*). ⛔ **`QueuedMessage.kind`'s *"and nothing
 * else"* was true until this dispatch and is not any more** — corrected where it is written
 * rather than left for the next reader who trusts it.
 *
 * ⚠️ **What it still does not decide is DELIVERY.** How a held message is carried and flushed is
 * identical for all three; what the word gates is whether a person may take it back out again,
 * and — since `690` — whether this app may: only a `'notice'` is ever ended `retracted` (R32).
 * ⛔ **It gated admission too until D-010**, which let a conversation hold any number of messages:
 * a `question` or `notice` no longer needs a slot beside the work, because every kind has one.
 */
export const MAILBOX_KINDS = ['work', 'question', 'notice'] as const

/** One of {@link MAILBOX_KINDS}. */
export type MailboxKind = (typeof MAILBOX_KINDS)[number]
