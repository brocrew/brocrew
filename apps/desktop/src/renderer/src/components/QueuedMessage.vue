<script setup lang="ts">
import { MOVE_SEND_UNCONFIRMED } from '../../../shared/move-request'
import { messageLimitDisplay } from '../lib/provider-limit-status'
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { AgentIdentity, HandedPath } from '../../../shared/runtime-ipc'
import type { QueuedItem, TranscriptItem } from '../lib/transcript'
import { RELAYED_MARK, relayedSender } from '../lib/relayed-turn'
import { APP_NOTICE_MARK, THE_APP_IS_THE_AUTHOR } from '../../../shared/app-notice'
import { WORK_REPORT_MARK, workReading, workSummary } from '../lib/work-report'
import { GO_AHEAD_HELD_WHY, GO_AHEAD_SENDER, TAKE_BACK_THE_GO_AHEAD } from '../lib/plan-mode'
import { THE_GO_AHEAD_TAKEN_BACK, THE_GO_AHEAD_WAS_NOT_SENT } from '../../../shared/the-go-ahead'
import WorkFacts from './WorkFacts.vue'
import OutsideCard from './OutsideCard.vue'
import MarkdownWords from './MarkdownWords.vue'
import { workIsWith } from '../lib/where-the-work-is'
import { fromOutside, inACard, THIS_CONVERSATION } from '../lib/from-outside'
import { MESSAGE_KIND_WORD } from '../lib/outgoing-card'
import { isOnlyAStopWord } from '../lib/a-stop-word'

/**
 * A message the user wrote while a turn was running and has NOT been sent (077).
 *
 * ⚠️ **It is deliberately not a {@link UserMessage}, and it must never look like one.** The
 * dispatch's rule is *"the transcript must not show a message as sent before it was"*, and the only
 * way to keep that is for the unsent state to be visibly a different thing: dashed rather than
 * solid, a hold glyph rather than a person, and a line that says in words what is going to happen
 * to it. ⚑ **658 · on a CARDED row — a held relay or report — the dashed edge is the card's own**
 * (`OutsideCard`'s `held`) and there is no glyph, because no card carries an avatar; the words
 * still say it has not gone.
 * A user bubble with a small badge would fail the moment anyone skim-read the column.
 *
 * The endings it can carry are all shown, because each is a different thing to know.
 *  - **waiting** — it will go when the turn ends, and it can still be taken back. 🔴 **537 split
 *    this arm in two and the split is about the WORK, not about the message**: a held brief says
 *    so, because `list_tasks` already gives that piece to the agent. See `arrived`.
 *  - **cancelled** — you took it back. Kept on screen because you wrote it, and because a message
 *    that vanished on cancel would leave you unsure whether it had been cancelled or sent.
 *  - **abandoned** — the conversation ended before it could go. Nobody chose this, so it is never
 *    worded as though somebody did, and the text is offered back rather than dropped.
 *  - **retracted** (690, R32) — this app took back its OWN notice before it was read, because a
 *    later fact made it false. It always carries a `detail`, so it is drawn by the *not sent ·
 *    detail* arm — ⚑ **701 · and in the quiet ending style**, like the two above: the rows ended,
 *    and the style is keyed on {@link QueuedItem.outcome} being set at all, so an ending added later
 *    is quiet too (`690`'s own was drawn in the waiting row's colours because a list of two had to
 *    be widened by hand).
 *
 * 🔴 **688 · R22 + R33 — a held plan go-ahead is BroBot's, and has its own entry.** ⛔ Never *You*,
 * never the person's *Cancel it*, never *Put it back in the composer* (R22). ⚑ A person MAY take it
 * back (R33), from here, with {@link TAKE_BACK_THE_GO_AHEAD}; what follows is the state `060` and
 * `670` already name, drawn in main's own words ({@link THE_GO_AHEAD_TAKEN_BACK} — ⚑ `696`: its
 * second half only while {@link mayCarryOn}, and {@link THE_GO_AHEAD_WAS_NOT_SENT} otherwise).
 */
const props = withDefaults(
  defineProps<{
    holdDisclosure?: import('../../../shared/runtime-ipc').QueuedMessageDisclosure | null
    limitNow?: number
    withinAnswer?: boolean
    held?: ReadonlySet<string> | null
    item: QueuedItem & Pick<TranscriptItem, 'at'>
    /**
     * ⚑ **The identity roster, so a held relayed row names its relayer** (545) — `RelayedEntry`'s own
     * prop, because the held row and the turn it becomes must not answer *whose words are these*
     * differently.
     */
    identities?: readonly AgentIdentity[] | null
    /** ⚑ **658/667** — the recipient, or `null` for *this conversation*. See `RelayedEntry`'s `ownAgent`. */
    ownAgent: string | null
    /**
     * 🔴 **696 · `688` L1 — whether a taken-back go-ahead may still say *type your next message to
     * carry on*** — `takenBackGoAheadsThatMayCarryOn`, decided by the transcript, which can see what
     * came after this row. ⛔ Absent is `false`: a row that cannot tell whether the conversation can
     * still take a message says only the half that is a fact about the past.
     */
    mayCarryOn?: boolean
    /**
     * ⚑ **D-017b · the conversation is drawn from its ledger** (`recorded`): a held row offers no
     * Cancel — only a conversation this window is fed takes one back. ⛔ Absent is `false`: a surface
     * that does not know says what a live conversation says.
     */
    recorded?: boolean
    /**
     * ⚑ **D-017 · R3 — a held row goes with the conversation's next message**, not when a turn ends:
     * it is drawn from its ledger and no window takes its turns. ⛔ Absent is `false` — and `false`
     * for one another window, or none since a hand-back, is working in: there it goes when that turn
     * ends.
     */
    withItsNextMessage?: boolean
    /**
     * Whether *Put it back in the composer* has a composer to reach. Off, an ended row keeps its
     * words and offers nothing.
     */
    canRestore?: boolean
    /** Whether the running turn can be stopped from here. */
    canStop?: boolean
  }>(),
  { canRestore: true },
)

const providerHold = computed(() =>
  props.item.outcome === null
    ? messageLimitDisplay(props.holdDisclosure, props.limitNow ?? Date.now())
    : null,
)

const emit = defineEmits<{
  openConversation: [sessionId: string]
  /**
   * Take it back before it goes. Only meaningful while it is still waiting.
   *
   * ⚑ **688 · it names THIS row** ({@link QueuedItem.messageId}). A conversation can hold two held
   * messages since `394`, and the go-ahead's take-back must take back the go-ahead, not whatever
   * sits at the head of the mailbox.
   *
   * ⛔ **A row with no name offers no control that could raise this** (`688`'s review). Only a
   * ledger written before `354` has one, and main's mailbox never holds such a message (`mailboxOf`
   * skips it) — so the old *take back the head* fallback always took back a DIFFERENT, newer
   * message, which since `670` can be BroBot's held go-ahead. 106's rule: a control that cannot act
   * is not offered.
   */
  cancel: [messageId: string]
  /** Take back this held stop word and stop the turn, so the word is never sent. */
  stop: [messageId: string]
  /**
   * Put the message back in the composer — the way out of the two endings that cannot be undone.
   *
   * ⛔ **The paths travel with the text** (216, review). Restoring the words alone handed somebody a
   * draft that looked complete and had quietly lost what they attached; the two were one message
   * when they were queued and they go back as one.
   */
  restore: [text: string, attachments: HandedPath[]]
}>()

const waiting = (): boolean => props.item.outcome === null

/** ⚑ **D-017 · R3** — see {@link withItsNextMessage}. */
const withTheNextMessage = computed(() => props.withItsNextMessage === true)

/** ⚑ **D-017b · whether this window may take it back** — see {@link recorded}. */
const mayTakeItBack = computed(() => props.recorded !== true)

/**
 * 🔴 **Whose message this is, and it is not always the person's** (406).
 *
 * ⛔ **A reply to a BUSY parent is held here first.** `deliverReply` and `tellOneParent` go through
 * `queueMessage`, which holds when the target is mid-turn — so until `406` a worker's answer sat in
 * the parent's transcript under `<strong>You</strong>`, with a cancel button offering to take back
 * words the person never wrote. ⚑ `214` removed 12,646 messages that rendered injected material as
 * *"You"*; this was one of them, in its interim state.
 *
 * ⚠️ **The heading is the PIECE, not BroBot**, which is `WorkReportEntry`'s choice and its reason:
 * the label is the handle a person says out loud, and the conversation that answered is named in
 * the words below rather than as an id in the meta row.
 *
 * 🔴 **545 · and where there is no report, it is the RELAYER rather than a constant.** ⛔ `HO-054`
 * §3 reversed `413` §4's second half: an actor that used to be uninventable is resolvable now, so
 * a piece a project manager handed down reads *project-manager* instead of *BroBot*. ⚑ The held row
 * and the turn it becomes ask the SAME function — `relayed-turn.ts`'s — for the reason this
 * component's own `WORK_REPORT_MARK` neighbour records: two spellings of one heading had already
 * diverged once.
 */
/**
 * ⚑ **508 · read ONCE for this row**, because the heading and the facts line are the same reading.
 * ⛔ `null` when the held message is not a work report at all — which is most of them.
 */
const reading = computed(() =>
  props.item.report === undefined ? null : workReading(props.item.report),
)

const heading = computed(() => {
  if (reading.value !== null) return reading.value.heading
  // 🔴 **545 · the RELAYER, through the app's one naming function** — see {@link relayedSender}.
  // ⛔ The flag still decides whether this is the person's row; the identity beside it decides the
  // NAME, and a relayed row this app cannot name is still not the person's.
  if (props.item.relayed === true)
    return relayedSender(props.item.relayedFromProfile, props.identities ?? null)
  // Attribute held app notices to the app, matching {@link AppNoticeEntry} after delivery. Without a report or relayer, falling back to You would wrongly claim the person's authorship. Keep queued and delivered attribution aligned as {@link QueuedItem.report} requires.
  if (props.item.appNotice !== undefined) return THE_APP_IS_THE_AUTHOR
  // 🔴 **688 · R22 — BroBot, when these are its plan go-ahead** — the heading the turn it becomes
  // draws (`ContinuationEntry`), so the row and the turn answer *whose words are these* alike.
  return props.item.goAhead === true ? GO_AHEAD_SENDER : 'You'
})

/**
 * 🔴 **Whether a person may act on this row** (413, widening 406).
 *
 * ⛔ **Both controls are person-only affordances and both are actively wrong on a row the person
 * did not write** — see the block above the buttons. ⚑ `406` gated them on a work REPORT, which
 * covered the two producers it knew about; `410` then measured two more, and the commonest of
 * them — a piece one agent gives another — carries no report at all. ⚠️ **A gate written as
 * *"everything except the shapes I have met"* is the same mistake this whole dispatch is about**,
 * so this asks the question the other way round: the controls are offered only on a row whose
 * words nothing on the event attributes to anybody but the person.
 */
const theirs = computed(
  () =>
    props.item.report !== undefined ||
    props.item.relayed === true ||
    // 🔴 **624 · and a row the APP wrote** (`HO-095` §6.2). ⛔ *Cancel it* on a delivered fact
    // would leave the proposer never learning it was approved, which is the exact defect `615`
    // built this carrier to close; *Put it back in the composer* would load this app's own
    // sentence into the person's draft, to be sent under their name. ⚑ **The capability itself
    // is refused at the host** — `RuntimeHost.cancelQueuedMessage` throws on a `'notice'` — so
    // this is the surface agreeing with a rail rather than a hidden button standing in for one.
    props.item.appNotice !== undefined ||
    // 🔴 **688 · R22 — and BroBot's plan go-ahead.** ⛔ *Put it back in the composer* would load
    // BroBot's sentence into the person's draft to be sent under their name, and *Cancel it* is
    // the PERSON's control over the PERSON's words. ⚑ The go-ahead has its own control instead
    // (R33) — see {@link goAhead}.
    props.item.goAhead === true,
)

/**
 * 🔴 **688 · R33 — this row is BroBot's held go-ahead**, and it offers its own take-back.
 * ⚑ Main allows it (`cancelQueuedMessage` refuses only a `notice`); the words are the go-ahead's.
 */
const goAhead = computed(() => props.item.goAhead === true)

/** A held message that is only "stop" is offered as a stop of the turn, in one press. */
const meansStop = computed(
  () =>
    props.canStop === true &&
    !(props.item.attachments?.length ?? 0) &&
    isOnlyAStopWord(props.item.text),
)

/**
 * 🔴 **658 · a HELD row sits in the frame its delivered row will** — `lib/from-outside.ts` decides.
 *
 * ⚑ A held relayed message and a held reply are carded and shifted, exactly as `RelayedEntry` and
 * `WorkReportEntry` draw them once sent; a held report with no relayer is carded and not shifted. ⛔ The
 * person's OWN held message keeps the participant's frame — it is theirs, and it is in the room.
 * ⚠️ **And the card's edge is DASHED while it is held** (`OutsideCard`'s `held`) — `077`'s *"visibly a
 * different thing"* from the row it becomes, kept now that no card carries the hold glyph.
 */
const carded = computed(() => inACard(props.item))
const framed = computed(() => carded.value && !props.withinAnswer)
const outside = computed(() => fromOutside(props.item))
const sender = computed(() => relayedSender(outside.value?.sender, props.identities ?? null))

/**
 * 🔴 **537 · the label of the piece these held words ALREADY handed over, or `null`** — see
 * {@link QueuedItem.label}.
 *
 * ## ⛔ Why this row may not lead with `not sent`
 *
 * A held brief gives the work at queue time but delivers its words at the next turn boundary. `recordTheGive` writes `work_given` after `message_queued`, so `list_tasks` already exposes the work and brief. Say whether the words were sent without implying that the work itself never arrived.
 *
 * ⚑ **Only while it is still HELD.** Once it ends, the ending is the thing to say — `sent` splices
 * this row out for the turn that replaces it, and `cancelled`/`abandoned` are about words that
 * genuinely never went. ⚠️ **`null` is therefore two facts folded into one answer** — *this row has
 * ended* and *these words carried no work* — and the line below says the same thing for both,
 * because for both of them nothing has arrived anywhere.
 */
const arrived = computed(() => (props.item.outcome === null ? (props.item.label ?? null) : null))
</script>

<template>
  <component
    :is="framed ? OutsideCard : 'div'"
    v-bind="framed ? { shifted: outside !== null, held: true } : {}"
    :exchange="
      outside && !withinAnswer
        ? {
            from: sender,
            to: props.ownAgent ?? THIS_CONVERSATION,
            kind: item.report
              ? 'reply'
              : item.label
                ? 'work'
                : item.says
                  ? MESSAGE_KIND_WORD[item.says]
                  : 'message',
            label: item.report?.label ?? item.label,
            text: item.text,
            at: item.at,
            state: [
              reading ? workSummary(reading) : null,
              arrived ? 'on its list · words held' : null,
              providerHold
                ? arrived
                  ? providerHold.heldShort
                  : providerHold.short
                : arrived
                  ? null
                  : item.outcome === null
                    ? 'held · not sent'
                    : `not sent · ${item.outcome}`,
            ]
              .filter(Boolean)
              .join(' · '),
            stateDetail: providerHold?.detail,
            where: workIsWith(
              { owner: item.relayedFrom ?? item.report?.owner },
              props.held ?? null,
            ),
          }
        : undefined
    "
    @open-conversation="(id: string) => emit('openConversation', id)"
  >
    <article
      class="msg queued"
      :class="[item.outcome ?? 'waiting', { carded, ended: !waiting() }]"
      data-cy="queued-entry"
      :data-carded="carded"
    >
      <!-- The recipient is already in the card's heading. -->
      <div v-if="outside && item.report" class="from-line">
        <strong class="from" data-cy="queued-from">{{ sender }}</strong>
      </div>
      <!-- ⚠️ **A pause, not a clock, since 082.** The clock survives on the agent's own plate, where it
         means "time is ELAPSING on a live turn" and counts up. This message is not elapsing — it is
         HELD before send — and one glyph carrying both meanings was the collision 081 ruled on.
         Everything else about this bubble is unchanged: still dashed, still not a person, still says
         in words that it has not gone. ⚑ 658 · the person's OWN held message only — a carded row
         has no avatar and is dashed at its card's edge. -->
      <div v-if="!carded" class="msg-avatar">
        <svg class="icon"><use href="#i-pause" /></svg>
      </div>
      <div class="msg-column">
        <button
          v-if="item.movedFrom"
          type="button"
          data-cy="queued-moved-from"
          @click="emit('openConversation', item.movedFrom.sessionId)"
        >
          Moved from {{ item.movedFrom.name }}.
        </button>
        <div class="msg-meta">
          <!-- The body keeps its sender or work heading without repeating the recipient. -->
          <strong data-cy="queued-heading"
            ><span data-cy="queued-sender">{{ heading }}</span></strong
          >
          <!-- 🔴 **688 · what the sender said the held words are** (`687` H1) — `RelayedEntry`'s
               word, before the same mark, so the row does not change what it says about itself
               when it stops being held. ⛔ Its own hook: `queued-about` is one per row. -->
          <span
            v-if="item.says && item.relayed && !item.report"
            class="about"
            data-cy="queued-says"
            >{{ MESSAGE_KIND_WORD[item.says] }}</span
          >
          <!-- ⚑ **406** — the same mark `WorkReportEntry` puts in this position, so the row does not
             change what it says about itself when it stops being held. -->
          <span v-if="item.report" class="about" data-cy="queued-about">{{
            WORK_REPORT_MARK
          }}</span>
          <!-- ⚑ **413** — the same mark `RelayedEntry` puts in this position, so the row does not
             change what it says about itself when it stops being held. -->
          <span v-else-if="item.relayed" class="about" data-cy="queued-about">{{
            RELAYED_MARK
          }}</span>
          <!-- ⚑ **624** — the same mark `AppNoticeEntry` puts in this position, so the row does not
             change what it says about itself when it stops being held. -->
          <span v-else-if="item.appNotice" class="about" data-cy="queued-about">{{
            APP_NOTICE_MARK
          }}</span>
          <!-- The state, in the meta row and in words. `not sent` is the part that matters and it
             leads, because it is what distinguishes this from every other bubble in the column.
             🔴 **537 · except on the one row where `not sent` is FALSE** — see the block above
             `arrived`. There the WORK is what led, because it is the half that has happened. -->
          <span
            class="state"
            data-cy="queued-state"
            :title="providerHold?.detail"
            :aria-description="providerHold?.detail"
            :tabindex="providerHold ? 0 : undefined"
          >
            <template v-if="arrived !== null">
              on its list as {{ arrived }} · these words
              <template v-if="providerHold">are held · {{ providerHold.heldWord }}</template>
              <template v-else
                >go
                {{ withTheNextMessage ? 'with the next message' : 'when the turn ends' }}</template
              >
            </template>
            <template v-else-if="providerHold">{{ providerHold.word }}</template>
            <!-- ⚑ **D-017 · R3** — held in a conversation drawn from its ledger: it goes first. -->
            <template v-else-if="item.outcome === null && withTheNextMessage"
              >not sent · it goes before the next message</template
            >
            <template v-else-if="item.outcome === null"
              >not sent · waiting for the turn to end</template
            >
            <!-- ⚑ **688 · R33** — the go-ahead was TAKEN BACK with its own control, so the state
                 names that act; the sentence under the words says what follows. -->
            <template v-else-if="item.outcome === 'cancelled' && goAhead"
              >not sent · you took it back</template
            >
            <template v-else-if="item.outcome === 'cancelled'"
              >not sent · you cancelled it</template
            >
            <!-- ⚠️ The specific reason wins when there is one (216). `abandoned` has several causes —
               "the conversation ended underneath it", "what you attached is no longer there" and,
               since 708, a command that met its flush with files on it — and only one of them is
               true of any given message; `detail` says which. ⚑ A ledger written before held words
               survived a moved sign-in can still carry that sentence (648). -->
            <template v-else-if="item.outcome === 'handover'">{{ MOVE_SEND_UNCONFIRMED }}</template>
            <template v-else-if="item.detail">not sent · {{ item.detail }}</template>
            <template v-else-if="item.outcome === 'abandoned'">
              not sent · the conversation ended first
            </template>
            <template v-else>not sent</template>
          </span>
          <span class="time">{{ clockTime(item.at) }}</span>
        </div>
        <!-- ⛔ **The glance, on the held row as well** (406) — see `WorkFacts.vue`. A fact that only
           appeared once the parent's turn ended would be invisible for exactly as long as the
           person is watching the conversation it is about. -->
        <WorkFacts v-if="reading" :reading="reading" />
        <!-- Same `data-cy` discipline as the user bubble: the body's text content is exactly what was
           typed, so a copy, a search or an assertion gets the message and nothing else. -->
        <div
          class="msg-body"
          data-cy="queued-message"
          :data-at="clockTime(item.at)"
          :title="fullTime(item.at)"
        >
          <MarkdownWords v-if="outside" :text="item.text" />
          <template v-else>{{ item.text }}</template>
        </div>
        <!-- ⛔ **What BroBot would add, shown while it can still be undone** (216 §2, review). Same
           shape and same reasoning as the sent bubble: outside `queued-message`, attributed to
           BroBot, never rendered as the person's own words (`214`). Here it does one more job —
           this is the only surface that says what is about to go, and a waiting message that hid
           its attachments made the injection invisible in the one window that is still undoable. -->
        <ul v-if="item.attachments?.length" class="attached" data-cy="queued-attachments">
          <li v-for="handed in item.attachments" :key="handed.path" :data-kind="handed.kind">
            <span class="by">This app attached</span>
            <span class="what mono" :data-cy="`queued-attached-${handed.kind}`">{{
              handed.path
            }}</span>
            <em v-if="handed.outsideCwd" class="outside" data-cy="queued-attached-outside"
              >outside this conversation’s folder</em
            >
          </li>
        </ul>
        <!-- 🔴 **Neither control is offered on a row the person did not write** (406, from the
           review). ⛔ Both are person-only affordances and both are actively wrong here:
           *Cancel it* would destroy a child's already-recorded reply on its way to the parent —
           and for an undriven-work notice it would suppress it PERMANENTLY, because
           `SessionStore.workReportedTo` withdraws `404`'s receipt on `abandoned` and never on
           `cancelled`, so the next launch inherits a claim that this conversation was told
           something it never heard. ⚠️ *Put it back in the composer* is worse in kind: it loads
           BroBot's own words into the person's draft, to be sent under their name — `214`'s
           defect manufactured by the row built to remove it.
           ⚑ **Nothing is lost.** The piece is answered whatever happens to the delivery
           (`WorkRepliedEvent`'s own ruling), the words are on this row, and `list_tasks` is the
           door that never depended on the message.
           ⛔ **413 widened the gate and did not copy it.** The same two buttons are worse on a
           relayed row than on a report: *Cancel it* destroys a brief `give_work` has already told
           the giving agent was accepted, with no rail anywhere that would mint it again,
           and *Put it back in the composer* loads another MODEL's words into the person's draft
           to be sent under their name. ⚑ See `theirs` — the question is asked the safe way
           round. -->
        <!-- 🔴 **688 · R22 — why BroBot's words are here, while they wait** — the held twin of
             `ContinuationEntry`'s `.why`, which says *sent* and is drawn once they have gone. -->
        <p v-if="goAhead && waiting()" class="why" data-cy="queued-go-ahead-why">
          {{ GO_AHEAD_HELD_WHY }}
        </p>
        <!-- 🔴 **688 · R33 — what follows a take-back, in the words main already says it in**
             (`060`, `670`). ⛔ Not on an ABANDONED go-ahead: *type your next message* is false of a
             conversation that ended. ⚑ **696 · nor on a TAKEN-BACK one, once the conversation has
             ended or the person has carried on** (`688` L1) — `mayCarryOn`; the first half is a
             fact about the past and stays. -->
        <p
          v-if="goAhead && item.outcome === 'cancelled'"
          class="why taken-back"
          data-cy="queued-go-ahead-taken-back"
        >
          {{ props.mayCarryOn === true ? THE_GO_AHEAD_TAKEN_BACK : THE_GO_AHEAD_WAS_NOT_SENT }}
        </p>
        <!-- 🔴 **688 · R33 — the go-ahead's own control**, never the person's *Cancel it*. -->
        <div
          v-if="goAhead && waiting() && mayTakeItBack && item.messageId !== undefined"
          class="msg-actions"
        >
          <button
            type="button"
            class="link"
            data-cy="take-back-go-ahead"
            @click="emit('cancel', item.messageId)"
          >
            {{ TAKE_BACK_THE_GO_AHEAD }}
          </button>
        </div>
        <div v-if="!theirs && (waiting() || props.canRestore)" class="msg-actions">
          <!-- ⛔ **688 · only a row with a NAME** — see `cancel`: a nameless row names nothing main
               holds, and a press there took back the head, a different message. -->
          <!-- ⚑ **D-017b** — none where this window is not fed it: nothing here holds it to take
               it back from. -->
          <button
            v-if="waiting() && mayTakeItBack && item.messageId !== undefined && meansStop"
            type="button"
            class="link"
            data-cy="stop-queued"
            @click="emit('stop', item.messageId)"
          >
            Stop now
          </button>
          <button
            v-if="waiting() && mayTakeItBack && item.messageId !== undefined"
            type="button"
            class="link"
            data-cy="cancel-queued"
            @click="emit('cancel', item.messageId)"
          >
            Cancel it
          </button>
          <!-- For the two endings there is no undoing: the message was never sent and this
             conversation may be over. Handing the text back to the composer is the only useful
             thing left, and it is strictly better than making someone retype it. -->
          <button
            v-else-if="!waiting() && props.canRestore"
            type="button"
            class="link"
            data-cy="restore-queued"
            @click="emit('restore', item.text, item.attachments ?? [])"
          >
            Put it back in the composer
          </button>
        </div>
      </div>
    </article>
  </component>
</template>

<style scoped>
/* ⚑ **406** — the same quiet subject mark `WorkReportEntry` carries, in the same position. */
.about {
  color: var(--faint);
  font-size: var(--type-caption);
}

.msg {
  display: grid;
  max-width: var(--measure-message);
  margin: 0 auto var(--space-10);
  gap: var(--space-5);
  grid-template-columns: var(--avatar) minmax(0, 1fr);
}

/* ⛔ **658 · inside a card the participant's grid is gone** — no avatar column, no own column: the
   frame is `OutsideCard`'s. */
.msg.carded {
  display: block;
  max-width: none;
  margin: 0;
}

.from-line {
  padding-bottom: var(--space-2);
}

.from {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.msg-column {
  min-width: 0;
}

/* DASHED, and that is the whole visual argument: everything else in this column has been said to
   somebody. A dashed edge reads as provisional at a glance, before any label is read. */
.msg-avatar {
  display: grid;
  width: var(--avatar);
  height: var(--avatar);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--faint);
  place-items: center;
}

.msg-avatar .icon {
  width: 15px;
  height: 15px;
}

.msg-meta {
  display: flex;
  /* ⚑ **714 · and it may WRAP** (714's review): with the longest heading a held row draws — two
     agents nobody named, the sender's word and the relay mark — the state had no room left on the
     line at all. It takes the next one instead. */
  flex-wrap: wrap;
  /* 🔴 **714 · `701` F-6 — a FLOOR, not a height.** ⛔ It was `height: 22px`, and the host's longest
     endings do not fit one line: measured at the 440 px column (`.stream` at its 560 px floor), a
     command refused at its flush wraps to three lines, 37 px in this 22 px row — 7 px spilled over
     the top and 7 px over the words below. ⚑ One line still draws 22 px tall. */
  min-height: 22px;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  row-gap: 0;
}

.msg-meta strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.state {
  /* Leave room for the heading and clock; wrap the status below them when needed. */
  min-width: 0;
  flex: 1 1 11em;
  color: var(--accent-text);
  font-size: var(--type-caption);
}

/* An ending that cannot be undone is stated more quietly than one still in play — it is history
   now, not something to act on. ⚑ **701 · every ending, by the `ended` class** (`outcome !== null`)
   rather than a list of their names: `retracted` (690) was added to the vocabulary and not to the
   list, and was drawn in the WAITING row's colours. */
.msg.ended .state {
  color: var(--faint);
}

.time {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
  opacity: 0.55;
  transition: opacity var(--dur-fast) ease;
}

.msg:hover .time {
  opacity: 1;
}

.msg-body {
  padding-top: var(--space-2);
  /* Muted rather than `--text-soft`: it is the same text a user bubble would carry, and the point
     is that it has not become one yet. */
  color: var(--muted);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
}

.msg.ended .msg-body {
  color: var(--faint);
}

/* ⛔ **The same register as the SENT bubble's strip**, because it is the same fact at two moments —
   and it had to be written out, because the markup was copied and the CSS was not (found in
   review, measured: `list-style: disc`, `padding-left: 40px`, a 16px UA margin and full-size body
   ink, beside an identical strip two turns below that had none of that). ⚑ A waiting attachment
   that looked like a different kind of thing from a sent one would make somebody wonder whether it
   was going to go the same way. */
.attached {
  display: grid;
  margin: var(--space-2) 0 0;
  padding: 0;
  gap: var(--space-1);
  list-style: none;
}

.attached li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.attached .by {
  color: var(--faint);
}

.attached .what {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}

.attached .outside {
  color: var(--faint);
  font-style: normal;
}

/* ⚑ **688** — `ContinuationEntry`'s `.why`, the register BroBot's own explanation is said in there. */
.why {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}

/* ⚑ **688 · main's sentence begins in lower case** (it is an error's words, `pane-error` draws it
   that way); on a line of its own it reads as a sentence. ⛔ The first letter is raised by the
   style and not in the bytes, so the row says main's sentence exactly. */
.taken-back::first-letter {
  text-transform: uppercase;
}

.msg-actions {
  display: flex;
  padding-top: var(--space-3);
  gap: var(--space-5);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
}

.link:hover {
  text-decoration: underline;
}
</style>
