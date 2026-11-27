/**
 * The message events in a conversation's ledger: a message queued, taken off the queue, sent, or
 * left undelivered, and the mailboxes they name. Split out of conversation-events.ts as a pure move.
 */
import type { TheQuestionItAsks } from './ask-delivery-contracts'
import type { AppNotice } from './app-notice'
import type { HandedPath } from './attachment-contracts'
import type { AnsweredQuestion, UserTurnEvent } from './human-answer-contracts'
import type { MoveOrigin } from './move-contracts'
import type { AgentMessageKind, WorkReport } from './task-contracts'

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
  /** The ledger holding the failure notice's receipt. */
  providerFailureHolder?: string
  /**
   * ⚑ **The question a held question's notice asks** — see {@link TheQuestionItAsks}. ⚑ On the row
   * so a held notice rebuilt after a quit still names it: one whose question has stopped waiting is
   * taken back unread at the start rather than sent. ⚠️ Absent on every other held row, and on
   * every question's row written before it.
   */
  asks?: TheQuestionItAsks
  /** The question an unanswered notice is about, used to retract the notice on settlement. */
  unansweredQuestion?: TheQuestionItAsks
  /** The explicit Message action that recorded these words. */
  messageAct?: string
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

/** App notices share the queue, but people cannot cancel them; only notices may be retracted. */
export const MAILBOX_KINDS = ['work', 'question', 'notice'] as const

/** One of {@link MAILBOX_KINDS}. */
export type MailboxKind = (typeof MAILBOX_KINDS)[number]
