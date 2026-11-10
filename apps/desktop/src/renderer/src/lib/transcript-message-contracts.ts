import type { HandedPath } from '../../../shared/attachment-contracts'
import type { MemoryNoteSeen } from '../../../shared/conversation-events'
import type { AnsweredQuestion } from '../../../shared/human-answer-contracts'
import type { MoveOrigin } from '../../../shared/move-contracts'
import type { MemoryRecallEntry, UnknownCategory } from '../../../shared/runtime-ipc'
import type { AgentMessageKind, WorkReport } from '../../../shared/task-contracts'
import type { InstructionAsked } from './instruction-asked'
import type { AskedToStop, StopUnanswered } from './stop-unanswered'
import type {
  PermissionItem,
  PlanItem,
  SubAgentCard,
  ToolItem,
  UserInputItem,
} from './transcript-tool-contracts'

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
  providerMessageId?: string
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

/**
 * A sub-agent whose dispatching tool row is not on screen (029) — an out-of-order `task_started`,
 * or a provider that reports a sub-agent without naming its parent. It renders at top level rather
 * than being dropped, and is ADOPTED into the tool row if that row arrives later, which is what
 * makes the nesting a binding on `parentToolCallId` rather than on arrival order.
 */
interface SubAgentItem {
  kind: 'subAgent'
  id: string
  card: SubAgentCard
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
  /** Claude retries and the final refusal share one row; diagnostics stay in Details. */
  signIn?: {
    state: 'retrying' | 'refused' | 'recovered' | 'ended'
    needsSignIn?: true
    details: string[]
  }
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
 * 🔴 **667 · a reply that reached nobody, said the way its card says it** (`658`'s G3).
 *
 * ## ⛔ What the notice printed until this dispatch
 *
 * > *"the reply to task_… did not reach sess_…: no-conversation"*
 *
 * ⚠️ **Three words a person cannot read, beside a card that already said all of it in words** — the
 * card reads *"Ada to BroBot · W1.2 · reply · not delivered"*. ⛔ A raw id where the card says
 * *W1.2*, a `sess_` handle where the card names the agent, and a closed-vocabulary word where a
 * person needs a reason.
 *
 * ## ⚑ Three facts, each asked of the function the card asks
 *
 * | fact | ⚑ from |
 * |---|---|
 * | the piece | its label, from this ledger's `work_given` — the work report's heading and the card's, one spelling |
 * | the parent | {@link agentName} over the roster, or {@link AN_UNNAMED_PARENT} — the card's recipient word |
 * | why | {@link UNDELIVERED_REASON_WORDS} — exhaustive over the delivery's reasons, so no raw word reaches a person; ⚠️ since `729` (R89) main also writes `held-then-lost`, a LATER loss with no words here yet (the frontend's), so the sentence gives no reason; ⚑ since D-017 (R14) the row's `detail` follows, in the words of what failed |
 */

/**
 * 🔴 **The answers `reply_to_parent`'s delivery can give that landed NOWHERE** — `REPLY_DELIVERIES`'
 * members that `REPLY_LANDED` marks `false`, in `main/runtime/reply-rails.ts`.
 *
 * ## ⛔ Spelled here because the renderer cannot import `main/`, and PINNED so it cannot drift
 *
 * ⚠️ **`tsconfig.web.json` holds `renderer/` and `shared/` and nothing else**, so this type cannot
 * be `Exclude<ReplyDelivery, …>`. ⚑ **`test/the-three-sentences-beside-the-cards.test.ts` §1 is
 * compiled by `tsconfig.node.json`, which sees both sides, and it asserts at the TYPE level that main's
 * vocabulary is exactly this one plus the three that landed** — so a new delivery answer in main
 * is a compile error in `pnpm run typecheck`, and never a raw word on a person's screen.
 * ⚑ **D-017 · R14 — `no-conversation` is gone**: a giver that is not running is started for the
 * reply, so a row that still says it is read with no reason.
 */
export type UndeliveredReason = 'not-delivered'

/**
 * ⚑ **What the fold knows about a lost reply**, kept as FACTS so the sentence can name the parent
 * through the roster at the moment it is drawn — the roster arrives later than the ledger, and a
 * name frozen into the row at fold time would be the slug forever.
 */
export interface LostReply {
  /** The piece's label, when its `work_given` is in this transcript. */
  readonly label?: string
  /**
   * The identity that gave the piece — ⛔ **only when the brief in view names it**, so a name is
   * never borrowed from a different giver.
   */
  readonly toProfile?: string
  /** ⛔ `null` for a word this build does not know: the sentence then gives no reason, never the word. */
  readonly because: UndeliveredReason | null
  /**
   * ⚑ **D-017 · R14 — what failed, in its own words** (`ReplyUndeliveredEvent.detail`): since D-030
   * why nothing could hold the words for the giver — its record would not take them, or they could
   * not be composed; ⚠️ a row an earlier build wrote may name a start that failed. Absent on rows
   * written before D-017.
   */
  readonly detail?: string
}
