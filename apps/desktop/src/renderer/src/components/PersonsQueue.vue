<script setup lang="ts">
import { computed, ref, useId } from 'vue'
// 🔴 **`KIND_WORDS` and `sinceWords` were declared HERE until `452 relay 1`** — *one derivation,
// wherever it lives* is `persons-queue.ts`' rule: two sentences for one `kind` are free to
// disagree about who else might still pick a row up. See `KIND_WORDS` there, and note that
// `403 M23`'s anchor moved with `SINCE_PHRASE`'s lines.
import {
  DID_WORDS,
  KIND_WORDS,
  LOOK,
  actionLinesOf,
  broaderLinesOf,
  isAPrimaryAnswer,
  sinceWords,
  usePersonsQueue,
  namesakeSays,
  namesakesIn,
  type NoAnswerHere,
  type PersonsQueueRow,
  type StalledWorkRow,
} from '../lib/persons-queue'
import {
  BROADER_THAN_SHOWN,
  charactersNotShown,
  OPEN_IT_BEFORE_YOU_ALLOW_IT,
  type AttentionDecision,
} from '../lib/attention'
import type { WorkInHand } from '../../../shared/questions'
import {
  LIMIT_WORDS,
  WHAT_COMES_AFTER_IS_NOT_OURS,
  isRefusal,
  whatThisAnswerDoes,
} from '../lib/user-input-offer'
import { TAKE_BACK } from '../lib/take-back'
import { TAKE_IT_OVER_TO_ANSWER_HERE } from '../lib/taking-over'
import { ADDED_BESIDE, questionOnTheQueue, type QuestionPart } from '../lib/question-card'
import type { UserInputResponse } from '../../../shared/runtime-ipc'
import InstructionAsks from './InstructionAsks.vue'
import McpServerRequests from './McpServerRequests.vue'
import WorkWaits from './WorkWaits.vue'
import CloseWorkButton from './CloseWorkButton.vue'
import QuestionCard from './QuestionCard.vue'
import WaitingOnWhoWrote from './WaitingOnWhoWrote.vue'

/** ⚑ D-046 · what a provider's question part takes, beside its choices — drawn, not answered here. */
function partTakes(part: QuestionPart): string | null {
  const takes = [
    part.multiSelect ? 'takes several answers' : null,
    part.typed
      ? part.options.length === 0
        ? 'takes a typed answer'
        : 'also takes an answer of your own'
      : null,
    part.secret ? 'the answer is hidden' : null,
  ].filter((one): one is string => one !== null)
  return takes.length === 0 ? null : takes.join(' · ')
}

/**
 * 🔴 **The queue that ends at a person** (401, HO-007 criterion 11) — what has been escalated to
 * you, the chain that says why, and the way to the card.
 *
 * ## ⛔ One component, two places, because a question is what a person opens a sheet to answer
 *
 * ⚠️ **`390`'s finding with the subject changed.** Every `OverlayHost` is a fixed `inset: 0`
 * `aria-modal` layer with a focus trap and it covers the rail and the surface behind it, so a
 * queue that lived only on one page would be unreachable at exactly the moment somebody is reading
 * a sheet about the thing they were asked. ⛔ So it is drawn twice — in the overlay layer, where
 * `OverlayHost` hosts it beside the emergency stop, and on *Waiting on you*, where the app answers
 * *"what needs you"* — and `persons-queue.ts` holds the one state and every word so the two cannot
 * disagree.
 *
 * ## ⛔ ONE band, and it is the band the layer already reserved
 *
 * ⚑ **The overlay layer now carries exactly two controls, and they are the two things that may
 * take a person out of what they are doing**: a stop and a summons. ⛔ **They share one column**
 * — `.overlay-corner` in `OverlayHost`, `left: 10px`, `width: 200px`, bottom-anchored — so
 * neither can be positioned into the other, and the layer occupies one band rather than two.
 *
 * ⚠️ **The first version mirrored the stop into the bottom RIGHT and it was wrong**, which is
 * worth writing down because the arithmetic was right: two 200px cards 10px from opposite edges
 * clear each other at any width above 420px. ⛔ What they did not clear was the right-hand drawer
 * of the time, which was `width: min(640px, 56vw); height: 100%; margin-left: auto` — so the
 * mirrored card sat inside the drawer's own footer and took its one door. ⚑ A right-hand panel is
 * the shape this app's overlays take, so the corner stayed on the left.
 *
 * ⚠️ **Drawn only when there is something to say**, which is the same rule the rail's badge
 * follows — so in the ordinary case this covers nothing, and the one state in which it sits
 * over a sheet is the state in which it is the most important thing on the screen.
 *
 * ## 🔴 Amber, and the licence it is spent under
 *
 * ⛔ **The status grammar says two things may summon attention — a question and a permission** —
 * and `SessionShelf`'s closed set is the app's own spelling of it. This queue is the first of
 * those two, arriving from a conversation no other surface in this window can see, so it may take
 * the channel. ⚠️ **It takes it through the pill grammar and not through `var(--waiting)`**:
 * `OverlayHost` carries `data-chat-theme="light"`, in which `--waiting` resolves to `#784f10`, a
 * near-black — the three tokens below are the pair that is legible in both scopes.
 *
 * ## ⛔ What it does not do
 *
 * **It never answers.** There is one button per row and it travels; the card answers for itself,
 * in the conversation it was raised in, through the door a person has always used. ⛔ **It never
 * names an actor** — the payload carries none and this invents none. ⛔ **And it never says a
 * question can still be answered**: a row was open when the look landed, and what the button
 * promises is arrival.
 *
 * ## 🔴 Two populations, one list, and a label only when there are two of them
 *
 * ⛔ **`403` added the rows a spawned child actually produces** — a permission it parked on, which
 * `401`'s reader was structurally unable to list. ⚑ They are drawn in the same list as the
 * escalated questions, because a person has one inbox and one count; what stops that being a
 * blend is the group LABEL whenever both are present, and `pq-says` on every row of the second
 * population whether or not the label is there.
 *
 * ⚠️ **`says` is the reliable discriminator and the chain is NOT**, which is worth stating because
 * the first draft of this note claimed all three. An escalated row whose walk was STOPPED draws
 * two names and no `you`, and *no time recorded* is a state both populations can be in — so a
 * reader told to tell them apart by shape would be told wrong. ⛔ `PersonsQueueRow.kind` is on the
 * row for exactly this reason: the surface reads the fact rather than inferring it.
 *
 * ⚠️ **The label appears only when both groups are** — `305 §1`'s rule, one level down: one list
 * needs no label, two do, and a label over the only list on screen is noise a reader has to rule
 * out. ⛔ **The `<ol>`s are separate and the SCROLLER is not**: a bounded band with two scrollers
 * in it can hide a whole group behind the other's overflow.
 *
 * ## 🔴 UI-009 · a question this app asked IS its card (F052)
 *
 * For `PersonsQueueRow.question`, render the shared `QuestionCard` with asker, related work, folded words, options and input, plus Open the conversation. The conversation renders the same card at the asking call. Show escalation only when it happened; keep decision consequences, gaps and work details on decision rows rather than repeating machinery explanations on questions.
 *
 * ## ⚑ UI-009 · the providers' usage limits are not drawn here
 *
 * ⚑ *Waiting on you* draws them at its top, outside *Yours to settle* — nothing in them is a person's
 * to settle — and the corner draws none: a usage warning is not a summons.
 *
 * ## ⚑ D-017 · R19 · the corner also carries the asks against an identity's rules
 *
 * ⛔ **The corner is the queue's copy on the layer that covers everything else, so it owes what the
 * page it summarises owes**: *Waiting on you* draws the instruction asks beside these rows, and the
 * corner counts them in its head and lists them under the rows (`InstructionAsks`), in the same
 * scroller. ⚠️ The in-flow copy does not: that page draws them as a group of its own.
 *
 * ⚑ **F097 · and the work whose agent answered a person**, for the same reason and the same way:
 * counted in the head, listed under the asks (`WaitingOnWhoWrote`), in flow only by the page.
 */
const props = withDefaults(
  defineProps<{
    /**
     * ⛔ **Whether this is the copy in the OVERLAY layer** — the one that is positioned, bounded
     * and scrolls. ⚠️ Defaults to false so a bare mount is the in-flow one, which is what *Waiting
     * on you* gives it and what a test measuring its content rather than its corner wants.
     */
    floating?: boolean
  }>(),
  { floating: false },
)

/**
 * ⚑ **Asked for by the overlay copy only, and it is not a close of its own.** A person pressing
 * *"take me to it"* inside a modal is leaving that modal, and the only party that knows how to
 * close one is the `OverlayHost` that raised it — which already closes on Esc and on the backdrop.
 * ⛔ So this asks, and the host emits its own `close`, which is what every one of its seven mount
 * sites already handles.
 */
const emit = defineEmits<{ leave: [] }>()

const queue = usePersonsQueue()
const expanded = ref(false)
const bodyId = useId()
const view = computed(() => queue.view.value)
const rows = computed(() => view.value?.rows ?? [])
/** 🔴 **737 · `734` F-2 — the rows whose asker reads the same name as another conversation's.** */
const namesakes = computed(() => namesakesIn(rows.value))
/**
 * ⚑ **557 · what the queue says about work that STOPPED with nobody left to tell** — a third
 * computed off the same composable, and `StalledWorkView`'s docblock is why it is not a fourth
 * population of `view` either.
 */
const stalled = computed(() => queue.stalled.value)
const stalledRows = computed(() => stalled.value?.rows ?? [])
/** The pieces whose holder stopped with them, its giver told: beside the stalled band. */
const stopped = computed(() => queue.stopped.value)
const stoppedCards = computed(() => queue.stoppedCards.value)
/**
 * ⚑ **D-017 · R19 · the asks against an identity's rules, and the corner's head over them** — see
 * `InstructionAsksView`. ⛔ **Drawn here by the CORNER copy only**: in flow, *Waiting on you* draws
 * them as a group of their own under its own label, and a second list there would draw each twice.
 */
const asks = computed(() => queue.asks.value)
const asksSaySomething = computed(
  () =>
    asks.value !== null && (asks.value.rows.length > 0 || asks.value.partial || asks.value.stale),
)
/**
 * ⚑ **F097 · the work whose agent answered a person** — drawn here by the CORNER copy only, the
 * asks' rule: in flow, *Waiting on you* draws it as a group of its own.
 */
const replies = computed(() => queue.waitingOnWhoWrote.value)
const repliesSaySomething = computed(
  () =>
    replies.value !== null &&
    (replies.value.rows.length > 0 || replies.value.unread || !!replies.value.short),
)
/**
 * The agents' requests to register an MCP server, drawn here by the corner copy only, as the asks:
 * those waiting, and those decided in this window until the person dismisses them, wherever they
 * were decided. A decided card alone opens the corner, and counts nothing there.
 */
const serverRequests = computed(() => queue.serverRequests.value)
const serverRequestsSaySomething = computed(
  () =>
    queue.serverRequestsSettled.value.length > 0 ||
    (serverRequests.value !== null &&
      (serverRequests.value.rows.length > 0 ||
        serverRequests.value.partial ||
        serverRequests.value.stale)),
)
const corner = computed(() => queue.corner.value)

/** ⛔ **Go to the conversation the work is in** — `PersonsQueueDoors.open`, and it settles nothing. */
function openStalled(row: StalledWorkRow): void {
  queue.openWork(row)
}

/**
 * ⛔ **Why a row cannot be settled here, and what to do instead** — see `NoAnswerHere`. Every arm
 * names a different next move, because one shrug over every state at once is `106`. ⚠️ **Stated
 * without a COUNT since `468` added a fifth** — `396`'s correction, and this sentence is the one
 * that went stale while the `Record` over the union kept the vocabulary itself honest.
 */
const NO_ANSWER_HERE_WORDS: Readonly<Record<NoAnswerHere, string>> = {
  'not-yours-yet':
    'Nobody is holding that conversation, so its card cannot be answered from here yet.',
  'not-in-this-window':
    'This window holds that conversation and its card is not in the part on screen — open it to answer.',
  'answer-sent': 'An answer is already on its way — waiting for the conversation to settle.',
  // 🔴 **468 · the only member whose next move is NOTHING**, and it is a next move. ⛔ The list
  // behind this row is up to five seconds old; the request it names was settled in this window,
  // and every other sentence here would send a person somewhere there is nothing to do.
  //
  // 🔴 **619 · it said *"That CARD is no longer waiting"* and this dispatch made that false**
  // (standing rule 8.1). ⛔ **Found by this dispatch's own PHOTOGRAPH** (rule 17.2) and by nothing
  // else: until `619` this arm was reachable only from a row that HAS a card, so the noun was
  // exact. ⚠️ **A question `ask_question` raised now reaches it too** — it is what a person sees
  // for the five seconds between pressing an answer here and the next ledger walk — and *that
  // card* over a row with no card is `602`'s false instruction arriving through the one door this
  // dispatch opened. ⚑ **The replacement names the ACT instead of the object**, which is true of
  // both populations and is what `468` said this member means in the first place: *this window
  // answered it and the list has not caught up*.
  'no-longer-waiting': 'That was answered from this window — this list has not caught up yet.',
  // ⚠️ **487 · reachable only off an event this window did not produce.** Every producer this app
  // owns keeps both refusals on every offer it publishes, so a row with nothing on it is a ledger
  // replayed from before that, or an adapter this window has never met. ⛔ It does not say WHO
  // offered nothing, because nothing here knows — that is the mistake `483` found on the card.
  'nothing-on-offer': 'That request reached this list with no answers on it — open it to answer.',
}

/** ⛔ **`W1.2`** — since `672` in the card's spelling, the piece's label, never an id. */
function saidWork(work: WorkInHand): string {
  return work.label
}

/**
 * 🔴 **Criterion 20's *about which work*** (434) — on a decision's row, the one population that
 * draws it.
 *
 * ⚑ **UI-009 · one arm is left.** A permission names no piece (`NOTHING_NAMED_THE_WORK`), and the
 * only rows whose asker can name one — a question this app asked — are drawn as their card, which
 * carries the piece in its head. ⚑ `430`'s sentence, in a piece's words since D-016.
 *
 * ⚠️ **The conversation's other work is drawn beside the edge and never instead of it.** A person
 * moving a blocked conversation wants to see everything it is holding.
 */
function workWords(row: PersonsQueueRow): string {
  const held = row.work.map(saidWork).join(', ')
  return held === ''
    ? 'No piece of work is recorded for the conversation that asked.'
    : `That conversation is working on ${held} — which of it this is about is not recorded.`
}

/** Whether the row offers a choice broader than this one request, drawn under more options. */
function hasBroaderAnswers(row: PersonsQueueRow): boolean {
  return row.answers.some((decision) => !isAPrimaryAnswer(decision))
}

/** Whether the row's more-options disclosure has anything to hold. */
function hasDetails(row: PersonsQueueRow): boolean {
  if (row.question) return false
  return (
    row.kind === 'a-decision' ||
    row.blockedSinceIs === 'told' ||
    row.says !== null ||
    row.alsoOnScreen ||
    hasBroaderAnswers(row)
  )
}

/**
 * The id of the line that says what a primary answer does, which its button is described by —
 * named by the copy too, since the page and the corner can both be on screen.
 */
function doesId(row: PersonsQueueRow, index: number): string {
  return `pq-does-${props.floating ? 'overlay' : 'in-flow'}-${row.key}-${String(index)}`
}

function go(row: PersonsQueueRow): void {
  // ⛔ **Leave first, travel second.** The host's `close` returns focus to whatever opened it, and
  // a surface swap underneath an open modal is a screen a person cannot see the result of.
  if (props.floating) emit('leave')
  queue.take(row)
}

/**
 * ⛔ **Settle it here, and do NOT leave** (434) — which is the whole of *clearing it there*. ⚠️ The
 * overlay copy stays open on purpose: a person clearing three things should not have the layer
 * close under them after the first.
 */
function settle(row: PersonsQueueRow, decision: AttentionDecision): void {
  queue.settle(row, decision)
}

/** ⛔ **Take it over without going to it**, so the answers appear on this row. */
function takeOver(row: PersonsQueueRow): void {
  queue.takeOver(row)
}

/**
 * ⚑ **UI-009 · answer a question this app asked, on its card, and do NOT leave** — `settle`'s rule:
 * a person clearing three things should not have the corner close under them.
 */
function answer(row: PersonsQueueRow, response: UserInputResponse): void {
  void queue.answer(row, response)
}
</script>

<template>
  <!-- ⚠️ **`v-if` on there being a row, not on the view being non-null**, and the two are different
       absences: `null` is *the first look has not landed*, and an empty list is *nothing is
       waiting*. Neither draws anything here — a queue is a summons, and a summons with nothing in
       it is noise — but only the second is a fact this app is allowed to state, and the surface
       that states it is *Waiting on you*'s own "Nothing here is blocked on an answer from you",
       which counts this list.

       ⛔ **…and a THIRD absence draws after all** (403, from the review): one read refused while
       the other came back empty. `rows.length` is 0 there and the first version therefore drew
       nothing at all — which put the screen back to *"the workspace is quiet"* over a population
       the app had failed to read. ⚑ A card carrying only the short-list line is the honest screen. -->
  <!-- ⚠️ **606 · `data-place`'s second value names WHAT THIS COPY IS, not the screen it is on.**
       ⛔ It read `home` until `EXT-008` §3 gave the queue its own destination, and a word that
       names a screen is a claim that expires the moment the screen moves —
       `a-column-name-is-a-claim`, and rule `27.1`'s *a guard scoped by where things live today
       expires silently*. ⚑ `overlay` and `in-flow` are the two things this component actually is,
       on any page that mounts it. -->
  <section
    v-if="
      (view !== null &&
        (rows.length > 0 || view.partial || view.stale || view.noLedger || view.rowsDropped)) ||
      stalledRows.length > 0 ||
      stalled?.unread === true ||
      !!stalled?.short ||
      stoppedCards.length > 0 ||
      stopped?.unread === true ||
      !!stopped?.short ||
      (props.floating &&
        (asksSaySomething ||
          repliesSaySomething ||
          serverRequestsSaySomething ||
          queue.todoCards.value.length > 0 ||
          queue.workWaits.value.todos.unread))
    "
    class="persons-queue"
    :class="{ floating: props.floating }"
    :data-place="props.floating ? 'overlay' : 'in-flow'"
    data-cy="persons-queue"
  >
    <!-- ⛔ **The header belongs to the CORNER copy, and only to it.** In the overlay layer nothing
         else on screen explains what this box is; in flow it sits under a group label that names
         it. ⚑ **UI-009 · and the corner's line is gone** — *"Nobody above them has answered. This
         takes you to the card…"* explained the machinery, and was false of a question asked
         directly. -->
    <!-- ⚑ **D-017 · R19 · `corner`, and not `view`, at the head** — the queue's heading and count
         widened by the asks this copy lists and (F097) the work waiting on the reply (`cornerHead`),
         so the corner counts what *Waiting on you* draws. ⛔ `null` under the same rule as before:
         nothing is said over lists nobody has read. -->
    <header v-if="props.floating" class="pq-head">
      <button
        type="button"
        class="pq-toggle"
        data-cy="persons-queue-toggle"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        @click="expanded = !expanded"
      >
        <span class="pq-mark" aria-hidden="true"
          ><svg class="icon"><use href="#i-question" /></svg
        ></span>
        <strong data-cy="persons-queue-heading">{{
          expanded ? (corner?.heading ?? 'Waiting on you') : 'Waiting on you'
        }}</strong>
        <span
          v-if="!expanded || (corner?.count ?? 0) > 0"
          class="pq-count"
          data-cy="persons-queue-count"
          >{{ corner?.count ?? 0 }}</span
        >
      </button>
    </header>

    <div
      v-show="!props.floating || expanded"
      :id="bodyId"
      class="pq-body"
      data-cy="persons-queue-body"
    >
      <!-- 🔴 **557 · WORK THAT STOPPED WITH NOBODY LEFT TO TELL** — see `StalledWorkView`.

           ⛔ **A band and not a row, and the module's docblock is the argument**: there is no card —
           no request, no answer to send and nothing frozen behind it. ⚑ **It DOES have a control**:
           the work is in a conversation a person can open and message, and HO-018 §2.1's *wait,
           interrupt, re-assign or end* is theirs to choose.

           ⚠️ **Above the rows.** This is work that has already stopped; the rows below are things
           somebody is frozen waiting on. -->
      <ul v-if="stalledRows.length > 0" class="pq-stalled" data-cy="persons-queue-stalled">
        <li
          v-for="work in stalledRows"
          :key="work.key"
          class="pq-stall"
          data-cy="persons-queue-stall"
        >
          <!-- ⛔ **The consequence, and nothing else on this line** (533 §1.1's rule). What the
               engine observed is the line under it, and the work's own words are under that. -->
          <p class="pq-stall-says" :data-cy="`persons-queue-stall-says-${work.key}`">
            {{ work.says }}
          </p>
          <p class="pq-stall-said" :data-cy="`persons-queue-stall-said-${work.key}`">
            {{ work.said }}<template v-if="work.since"> · {{ work.since }}</template>
          </p>
          <!-- ⚑ **The assignment's own first line**, so two stalled pieces of work are tellable
               apart without opening either. ⛔ **`:title` carries that line whole** — `530`'s
               pairing: a value that is never on screen is the defect it measured, and this line is
               an agent's own words about work a person is deciding on. ⚠️ **It recovers the LINE
               and not the assignment**: the rest is behind the button beside it, where the work
               report draws the text unshortened. -->
          <p
            class="pq-stall-what"
            :title="work.what"
            :data-cy="`persons-queue-stall-what-${work.key}`"
          >
            {{ work.what }}
          </p>
          <!-- ⛔ **What the button DOES is said before it is pressed** — `openingAction`, the same
               two words the rows below use, because a person reading one card may not be told the
               same act in two vocabularies. -->
          <div class="pq-stop-actions pq-stall-actions">
            <CloseWorkButton :piece="work.key" :cy="`persons-queue-stall-close-${work.key}`" />
            <button
              class="pq-go"
              type="button"
              :data-cy="`persons-queue-stall-go-${work.key}`"
              @click="openStalled(work)"
            >
              {{ work.action }}
              <svg class="icon"><use href="#i-arrow" /></svg>
            </button>
          </div>
        </li>
      </ul>
      <!-- 🔴 **557 · the stall look has stopped answering.** ⛔ Drawn rather than left blank: a band
           that vanishes reads as an all-clear, and this all-clear is *every piece of work that
           stopped has reached somebody*. -->
      <p v-if="stalled?.unread" class="pq-short" data-cy="persons-queue-stalled-unread">
        The last look for work that has stopped did not answer, so something nobody has been told
        about may not be shown here.
      </p>
      <!-- 🔴 **678 · F-R18b — the look answered, and could not read some rows.** ⛔ Not the line
           above, which is *the look did not answer*: this one is `rowsUnread` on a walk that did,
           in the one sentence every surface draws for that count (`rows-unread.ts`). ⚠️ Until
           `678` nothing drew it, and the section's `v-if` above now opens for it alone. -->
      <p v-if="stalled?.short" class="pq-short" data-cy="persons-queue-stalled-short">
        {{ stalled.short }}
      </p>
      <!-- Work whose holder stopped with it, its giver told: the piece, when it stopped, and the two
           things a person can do about it. -->
      <!-- A card the list no longer holds stays while its hand-back is on its way, then says the
           answer until the person dismisses it. -->
      <ul v-if="stoppedCards.length > 0" class="pq-stalled" data-cy="persons-queue-stopped">
        <li
          v-for="card in stoppedCards"
          :key="`${card.row.key}@${card.row.at}`"
          class="pq-stall"
          :data-cy="`persons-queue-stopped-${card.row.key}`"
          :data-listed="card.listed"
        >
          <p class="pq-stop-who" :data-cy="`persons-queue-stopped-who-${card.row.key}`">
            {{ card.row.who }}
          </p>
          <p class="pq-stall-what" :title="card.row.what">{{ card.row.what }}</p>
          <p
            v-if="card.listed"
            class="pq-stall-says"
            :data-cy="`persons-queue-stopped-says-${card.row.key}`"
          >
            {{ card.row.says }}
          </p>
          <div v-if="card.listed || card.pending" class="pq-stop-actions">
            <button
              v-if="card.listed"
              class="pq-go"
              type="button"
              :data-cy="`persons-queue-stopped-look-${card.row.key}`"
              @click="queue.openWork(card.row)"
            >
              {{ LOOK }}
              <svg class="icon"><use href="#i-arrow" /></svg>
            </button>
            <button
              class="pq-go"
              type="button"
              :disabled="card.pending"
              :data-cy="`persons-queue-stopped-hand-back-${card.row.key}`"
              @click="queue.handBack(card.row)"
            >
              {{ TAKE_BACK }}
            </button>
            <CloseWorkButton
              :piece="card.row.key"
              :disabled="card.pending"
              :cy="`persons-queue-stopped-close-${card.row.key}`"
            />
          </div>
          <p
            v-if="card.said !== null"
            class="pq-short"
            role="status"
            :data-cy="`persons-queue-stopped-said-${card.row.key}`"
          >
            {{ card.said }}
          </p>
          <button
            v-if="!card.listed && !card.pending"
            class="pq-go"
            type="button"
            :data-cy="`persons-queue-stopped-dismiss-${card.row.key}`"
            @click="queue.dismissHandBack(card.row)"
          >
            Dismiss
          </button>
        </li>
      </ul>
      <p v-if="stopped?.unread" class="pq-short" data-cy="persons-queue-stopped-unread">
        The last look for work whose agent stopped did not answer, so some may not be shown here.
      </p>
      <p v-if="stopped?.short" class="pq-short" data-cy="persons-queue-stopped-short">
        {{ stopped.short }}
      </p>
      <!-- ⛔ **One of the two reads did not answer, so this list is short and says so** (403,
           from the review). ⚠️ The first version returned NO view at all in this state, which put
           the screen back to *"the workspace is quiet"* over rows it had just read. ⚑ Drawn in
           BOTH copies, because it is a disclosure about the list rather than the corner card's
           chrome, and the in-flow copy draws the same list. ⚠️ **606 · that copy is on
           `WaitingOnYou`** — `EXT-008` §3. -->
      <p v-if="view?.partial" class="pq-short" data-cy="persons-queue-partial">
        One of these lists could not be read just now, so there may be more than this.
      </p>
      <!-- 🔴 **453 · there was no ledger behind the answer at all.** ⛔ This is the disclosure the
           card could not draw before, and it is the one that mattered most: every reader answered
           an empty list, `partial` and `stale` were both false, and the honest screen was
           indistinguishable from a quiet workspace. -->
      <p v-if="view?.noLedger" class="pq-short" data-cy="persons-queue-no-ledger">
        This app has no record to read just now, so an empty list here says nothing about what is
        waiting on you.
      </p>
      <!-- 🔴 **453 · the list is short by rows this app could not read** — `150`'s skip, which has
           been silent above the store since it was written. ⛔ The cause is genuinely unknown and
           the sentence says so rather than guessing at one. -->
      <p v-if="view?.rowsDropped" class="pq-short" data-cy="persons-queue-rows-dropped">
        Part of this app’s own record could not be read, so something waiting on you may be missing
        from this list.
      </p>
      <!-- 🔴 **The list is not being read any more** (434) — a different hole from the one above,
           and the reachable one. ⛔ The screen keeps each population's last good answer on a
           refusal, which is right; what it cannot do is keep drawing that answer silently, because
           everything that arrived since is omitted and an omission reads as *nothing arrived*. -->
      <p v-if="view?.stale" class="pq-short" data-cy="persons-queue-stale">
        The last look at one of these lists did not answer, so this is what it said before that —
        anything that has arrived since is not here.
      </p>
      <!-- 🔴 **ONE list, oldest-blocked first** (434, criterion 17) — the groups are gone. ⛔ A
           group is a second ordering, and with two of them a nine-minute permission sat below a
           four-second question because of which READER found it. ⚑ What the group label carried
           — which population a row is — is now on the row, where `PersonsQueueRow.kind` always
           said it was.

           ⚠️ **The list is NAMED with its own ordering**, so a screen reader browsing the card
           hears what the order means rather than a bare *"list, 4 items"*. -->
      <ol
        class="pq-rows"
        aria-label="Waiting on you, the longest-blocked first"
        data-cy="persons-queue-rows"
      >
        <li
          v-for="row in rows"
          :key="row.key"
          class="pq-row"
          :data-kind="row.kind"
          :data-cy="`persons-queue-row-${row.key}`"
        >
          <!-- 🔴 **UI-009 · a question this app asked is its card** — see `PersonsQueueRow.question`.
               ⚑ The press's outcome is the queue's, so both copies draw it. -->
          <QuestionCard
            v-if="row.question"
            :reading="questionOnTheQueue(row, row.question, queue.presses.get(row.key))"
            fold
            @answer="(response) => answer(row, response)"
            @move="(decision) => queue.move(row, decision)"
          />

          <!-- ⛔ **The chain, drawn from the hops the host NAMED** (401) — one name per
               participant, in order, the last of them `you` WHEN THE WALK ENDED; a stopped one
               ends at a conversation and says so in the `pq-gap` below. ⚑ The prose line HO-007
               asked for is the same walk joined, and it is the accessible name of this list
               rather than a second visible copy of it.

               ⚠️ **A decision's chain is one hop and that is not a shortened walk** (403): the
               request never travelled, so there is no parent to draw — see `decisionReading`.

               🔴 **It is also criterion 20's *who asked*** (434): the first hop is the
               conversation that raised the card, named the way a person reads it. -->
          <ol
            v-if="!row.question"
            class="pq-chain"
            :aria-label="row.sentence"
            :data-cy="`persons-queue-chain-${row.key}`"
          >
            <li
              v-for="(hop, index) in row.chain"
              :key="index"
              class="pq-hop"
              :class="{ you: hop.you }"
              :data-did="hop.did"
            >
              <!-- ⛔ **The NAME keeps the mark and keeps the whole of its element's text** — the
                   chain's own rule one rule down: *what a test reads back out of these is what the
                   host named, and nothing else*. ⚑ The act below is a sibling rather than more
                   text here, so `613` added a word to the row without changing what any reader of
                   a hop has ever read. -->
              <span :data-cy="hop.you ? 'persons-queue-you' : 'persons-queue-hop'">{{
                hop.name
              }}</span>
              <!-- ⛔ **A real space, and it is not decoration** (613). ⚑ Vue's `condense`
                   whitespace drops a whitespace-only text node that contains a newline, so two
                   spans on two lines render with NOTHING between them: `innerText` reads
                   `worker-7asked`, and that is what a screen reader announces for the hop.
                   ⚠️ **The gap a person SEES is `margin-left`; the gap a person HEARS is this.**
                   Measured on this dispatch's own first run, which is the only reason it is
                   here. -->
              {{ ' ' }}
              <!-- 🔴 **What this participant DID** (613, `HO-088` §6) — `Ali asked · Ada has not
                   answered`. ⛔ **Drawn from `DID_WORDS` and never spelled here**: `KIND_WORDS`' own
                   argument is that a second vocabulary is two sentences for one fact.
                   ⚠️ **Absent on the person's hop, and that is the null rather than a blank
                   word** — `PersonsQueueHop.did`: every act in that vocabulary is a
                   CONVERSATION's, and `you` is the one answerer that is not one. -->
              <span v-if="hop.did !== null" class="pq-did" data-cy="persons-queue-did">{{
                DID_WORDS[hop.did]
              }}</span>
            </li>
          </ol>
          <!-- 🔴 **737 · `734` F-2 — two conversations of one agent, told apart** (`namesakesIn`):
               beside the name and OUTSIDE the chain, whose hops say only what the host named. -->
          <p
            v-if="namesakes.has(row.key)"
            class="pq-namesake"
            :data-cy="`persons-queue-namesake-${row.key}`"
          >
            {{ namesakeSays(namesakes.get(row.key)!) }}
          </p>

          <!-- 🔴 **D-046 · a provider's question, as it was asked — for reading only.** Its card in
               its asker's conversation answers it; the row's own answers and its press below are
               unchanged. -->
          <div v-if="row.words" class="pq-asked" :data-cy="`persons-queue-asked-${row.key}`">
            <p v-if="row.words.prompt.trim() !== ''" class="pq-asked-words">
              {{ row.words.prompt }}
            </p>
            <p v-if="row.words.context" class="pq-asked-context">
              {{ ADDED_BESIDE }} {{ row.words.context }}
            </p>
            <div
              v-for="(part, index) in row.words.parts"
              :key="part.id || index"
              class="pq-asked-part"
              data-cy="persons-queue-asked-part"
            >
              <p v-if="part.header" class="pq-asked-prompt">
                <strong>{{ part.header }}</strong>
              </p>
              <p v-if="part.prompt" class="pq-asked-prompt">{{ part.prompt }}</p>
              <!-- ⚑ Not where the row's own answers draw the same labels as presses below. -->
              <ul
                v-if="part.options.length > 0 && row.answers.length === 0"
                class="pq-asked-options"
              >
                <li v-for="(option, at) in part.options" :key="`${at}:${option.label}`">
                  {{ option.label
                  }}<span v-if="option.description" class="pq-asked-note">
                    — {{ option.description }}</span
                  >
                </li>
              </ul>
              <p v-if="partTakes(part)" class="pq-asked-note">{{ partTakes(part) }}</p>
            </div>
          </div>

          <!-- What the request asks, as its card discloses it, on a row that offers answers: its
               words, then this action's own scope on code lines. A long line scrolls and is never
               shortened; what a broader answer would install is drawn under more options. -->
          <div v-if="row.disclosed" class="pq-asked" :data-cy="`persons-queue-request-${row.key}`">
            <div class="pq-request-what">
              <p class="pq-asked-words">{{ row.disclosed.asked }}</p>
              <div
                v-if="actionLinesOf(row.disclosed).length > 0"
                class="pq-request-line"
                tabindex="0"
                role="group"
                aria-label="The request in full"
                :data-cy="`persons-queue-in-full-${row.key}`"
              >
                <code v-for="(line, index) in actionLinesOf(row.disclosed)" :key="index">{{
                  line
                }}</code>
              </div>
            </div>
            <p v-if="row.disclosed.agentSays" class="pq-asked-context">
              {{ row.disclosed.agentSays }}
            </p>
            <p v-if="row.disclosed.underDisclosed" class="pq-refused">
              {{ BROADER_THAN_SHOWN }}
              <template v-if="row.noPositive === null">{{ OPEN_IT_BEFORE_YOU_ALLOW_IT }}</template>
            </p>
            <p v-if="row.disclosed.detailOmitted !== null" class="pq-refused">
              {{ charactersNotShown(row.disclosed.detailOmitted) }}
            </p>
          </div>

          <!-- Since when: after the request in reading order, and on the card's top line beside
               who asked on the page. -->
          <p v-if="!row.question" class="pq-meta">
            <span :data-cy="`persons-queue-since-${row.key}`">{{ sinceWords(row) }}</span>
          </p>

          <!-- ⛔ **A walk that was STOPPED says so, and no hop above says `you`.** A cycle and the
               hop bound are one state on the wire, so this sentence names neither: what it
               reports is that the walk did not reach anybody, which is the whole of what is
               known. -->
          <p
            v-if="row.unfollowable && !row.question"
            class="pq-gap"
            :data-cy="`persons-queue-unfollowable-${row.key}`"
          >
            The chain above this could not be followed, so nobody past the last conversation named
            here has been identified as the one to answer.
          </p>

          <!-- 🔴 **What came back from the LAST press, on a row that is still answerable** (468).
               ⛔ **Above the buttons, which is where `PermissionCard` puts the same sentence**, and
               it is the same sentence: the host's own words, off the transcript item, drawn here
               rather than derived a second time. ⚠️ Before this the buttons vanished and came back
               with nothing said, because `noteAnswer` puts the request back on the table for
               exactly the refusals that leave a card answerable. -->
          <p v-if="row.refused" class="pq-refused" :data-cy="`persons-queue-refused-${row.key}`">
            {{ row.refused }}
          </p>

          <!-- 🔴 **Why nothing here can ALLOW it, on a row that can still refuse it** (487).
               ⛔ **The card's own sentence, from the one function that makes it**, because HO-030
               §2 rules that a sentence true on one surface and absent on another *"trains the
               reader out of looking"* — and this is the surface a person reaches a spawned child's
               card from. ⚠️ **Above the buttons, beside the refusal**, which is where this
               component already puts what bounds an answer rather than what an answer does. -->
          <p
            v-if="row.noPositive"
            class="pq-refused"
            :data-cy="`persons-queue-cannot-allow-${row.key}`"
          >
            {{ row.noPositive }}
          </p>

          <!-- 🔴 **701 · the provider's marks, beside what else bounds an answer** (`700` §5 GAP 1) —
               the lines *Waiting on you* and the card draw, from the one function that makes them, in its
               order. ⛔ Nothing here quotes them: a comment is rendered into the markup. -->
          <p
            v-for="line in row.marksSay"
            :key="line"
            class="pq-refused"
            :data-cy="`persons-queue-mark-${row.key}`"
          >
            {{ line }}
          </p>

          <!-- 🔴 **The answers, HERE** (434, criterion 17's *clearing it there clears it
               everywhere*). ⛔ They go through `respondPermission` / `respondUserInput` — the door
               a person has always answered through — so the request fold closes the row and every
               projection refolds off the ledger. ⚠️ **Nothing in this window records that a row
               was cleared**; a dismissed-list here would be a second opinion about what is closed.

               ⛔ **Dead the instant one is pressed** (`207` M2), through
               `PersonsQueueRow.noAnswerHere === 'answer-sent'`, which replaces the buttons with
               the reason rather than leaving four live controls over a request that has gone.

               The request's own answers stand side by side, each in the words its card supplies;
               every broader choice is under more options, with what it does and covers. -->
          <p
            v-if="row.answers.length > 0 && row.limit"
            class="pq-limit"
            :data-cy="`persons-queue-limit-${row.key}`"
          >
            {{ LIMIT_WORDS[row.limit] }}
          </p>

          <!-- ⛔ **Why not, in a sentence that names the next move** — never an absence, and never
               a dead button (`106`). -->
          <p
            v-if="row.answers.length === 0 && row.noAnswerHere"
            class="pq-no-answer"
            :data-cy="`persons-queue-no-answer-${row.key}`"
          >
            {{ NO_ANSWER_HERE_WORDS[row.noAnswerHere] }}
          </p>

          <div class="pq-actions" :data-cy="`persons-queue-actions-${row.key}`">
            <template v-for="(decision, index) in row.answers" :key="index">
              <button
                v-if="isAPrimaryAnswer(decision)"
                class="pq-answer"
                :class="{ deny: isRefusal(decision) && !row.refusesFirst }"
                type="button"
                :aria-describedby="row.kind === 'a-decision' ? doesId(row, index) : undefined"
                :data-cy="`persons-queue-answer-${row.key}`"
                @click="settle(row, decision)"
              >
                <strong>{{ decision.label }}</strong>
                <span
                  v-if="decision.kind === 'permission' && decision.warns"
                  class="pq-warns"
                  :data-cy="`persons-queue-wide-warning-${row.key}`"
                  >{{ decision.warns }}</span
                >
              </button>
            </template>

            <details
              v-if="hasDetails(row)"
              class="pq-more"
              :data-cy="`persons-queue-more-${row.key}`"
            >
              <summary>
                {{ hasBroaderAnswers(row) ? 'More options and details' : 'Details' }}
              </summary>
              <div class="pq-more-body">
                <!-- ⛔ **Which population** — see `KIND_WORDS`: drawn for every decision and every
                     question that was escalated, and not on a question asked of you directly,
                     where *"nobody above has answered"* is false. -->
                <p
                  v-if="row.kind === 'a-decision' || row.blockedSinceIs === 'told'"
                  class="pq-kind"
                  :data-cy="`persons-queue-kind-${row.key}`"
                >
                  {{ KIND_WORDS[row.kind] }}
                </p>
                <!-- ⛔ What kind of thing only a person may settle, in the vocabulary's own words;
                     `null` on an escalated row. -->
                <p v-if="row.says" class="pq-says" :data-cy="`persons-queue-says-${row.key}`">
                  {{ row.says }}
                </p>
                <!-- ⚑ About which work, on a decision's row; `data-about` carries the arm. -->
                <p
                  v-if="row.kind === 'a-decision'"
                  class="pq-work"
                  :data-cy="`persons-queue-work-${row.key}`"
                  :data-about="row.about.is"
                >
                  {{ workWords(row) }}
                </p>
                <!-- ⚑ Said, not hidden: this window runs the conversation the card is in, so the
                     card can be answered there too. -->
                <p
                  v-if="row.alsoOnScreen"
                  class="pq-also"
                  :data-cy="`persons-queue-also-${row.key}`"
                >
                  Its card is open in this window too.
                </p>
                <!-- ⚑ The gap, said once per row: the model's next step is the same unknown for
                     every answer. -->
                <p
                  v-if="row.kind === 'a-decision' && row.answers.length > 0"
                  class="pq-after"
                  :data-cy="`persons-queue-after-${row.key}`"
                >
                  {{ WHAT_COMES_AFTER_IS_NOT_OURS }}
                </p>
                <ul
                  v-if="row.disclosed && broaderLinesOf(row.disclosed).length > 0"
                  class="pq-request-scope"
                  :data-cy="`persons-queue-scope-${row.key}`"
                >
                  <li v-for="(line, index) in broaderLinesOf(row.disclosed)" :key="index">
                    {{ line }}
                  </li>
                </ul>
                <!-- Every answer in the card's own order: what each primary one does, and each
                     broader choice as its own button, its warning and effect inside it. -->
                <template v-for="(decision, index) in row.answers" :key="index">
                  <p
                    v-if="isAPrimaryAnswer(decision) && row.kind === 'a-decision'"
                    :id="doesId(row, index)"
                    class="pq-does"
                  >
                    {{ decision.label }}: {{ whatThisAnswerDoes(decision) }}
                  </p>
                  <button
                    v-else-if="!isAPrimaryAnswer(decision)"
                    class="pq-answer"
                    :class="{ deny: isRefusal(decision) && !row.refusesFirst }"
                    type="button"
                    :data-cy="`persons-queue-answer-${row.key}`"
                    @click="settle(row, decision)"
                  >
                    <strong>{{ decision.label }}</strong>
                    <!-- 🔴 **743 · `739` F-1, ruled — the wholesale grant, one click here too,
                         under its own warning** (058): copied off the live row, never composed
                         here. -->
                    <span
                      v-if="decision.kind === 'permission' && decision.warns"
                      class="pq-warns"
                      :data-cy="`persons-queue-wide-warning-${row.key}`"
                      >{{ decision.warns }}</span
                    >
                    <!-- ⛔ The IMMEDIATE effect, on the control it is about; a decision's only. -->
                    <small v-if="row.kind === 'a-decision'">{{
                      whatThisAnswerDoes(decision)
                    }}</small>
                  </button>
                </template>
              </div>
            </details>

            <div class="pq-controls">
              <!-- 🔴 **Take it over WITHOUT going to it** (434) — `336`'s door with the navigation
                   left off, so the answers land on this row and the person never leaves the one
                   list. ⚠️ Its word says it is a take-over, because it is: this window becomes the
                   owner, and the owner is who may send to it, answer it and end it.
                   ⛔ **It is not who the conversation ends WITH, and this comment said it was until
                   `523`.** These rows are conversations nobody is holding, which is what an
                   agent-spawned child is — and `closeSessionsForOwner` RELEASES one of those when the
                   window goes, rather than closing it. ⚑ So the press is undoable: `handing-it-back.ts`
                   is the one that undoes it. -->
              <!-- ⛔ **One arm reaches this button**: `not-yours-yet`, *its card cannot be answered
                   from here yet*. ⚑ **D-017 · R6** — a question this app asked is answered on its card
                   whoever holds the conversation, so it needs no take-over. ⛔ **Not folded into
                   `!row.held`**, because `held` is false on rows this gesture cannot help. -->
              <button
                v-if="row.noAnswerHere === 'not-yours-yet'"
                class="pq-take-over"
                type="button"
                :data-cy="`persons-queue-take-over-${row.key}`"
                @click="takeOver(row)"
              >
                {{ TAKE_IT_OVER_TO_ANSWER_HERE }}
              </button>

              <!-- ⛔ **One button, and it travels.** ⚠️ Its word says which of two gestures it is
                   before it is pressed: opening a conversation this window is running, or taking
                   over one nobody holds — `336`'s door, and a widening a person is told about in
                   advance.

                   ⛔ **It says the same thing for both populations, and that is deliberate**: the
                   promise is ARRIVAL, and a word that changed with the kind would be this surface
                   claiming to know what a person will be able to do when they get there. -->
              <button
                class="pq-go"
                type="button"
                :data-cy="`persons-queue-go-${row.key}`"
                @click="go(row)"
              >
                {{ row.action }}
                <svg class="icon"><use href="#i-arrow" /></svg>
              </button>
            </div>
          </div>
        </li>
      </ol>

      <!-- ⚑ **D-017 · R19 · the asks, in the corner** — below the rows, each decided on its own row.
           ⛔ The corner copy only; see `asks` above. -->
      <InstructionAsks v-if="props.floating" floating />
      <!-- The agents' requests to register an MCP server, in the corner, each decided on its row. -->
      <McpServerRequests v-if="props.floating" floating />
      <WorkWaits v-if="props.floating" part="todos" floating @leave="emit('leave')" />
      <!-- ⚑ **F097 · the work waiting on the person's reply, in the corner** — below the asks, each
           row a door to its conversation. ⛔ The corner copy only; see `replies` above. -->
      <WaitingOnWhoWrote v-if="props.floating" floating @leave="emit('leave')" />
    </div>
  </section>
</template>

<style scoped>
/* ⚑ **The pill grammar, not `var(--waiting)`.** `OverlayHost` carries `data-chat-theme="light"`,
   where `--waiting` is `#784f10` — a near-black that reads as ink rather than as a summons. These
   three are the trio every other amber surface in this app uses for exactly that reason. */
/* ⚑ **Layout only.** The chrome below belongs to the corner copy: in-flow this is one group in a
   list of groups, and a bordered card there would be the only boxed thing in a column of rows. */
.persons-queue {
  display: flex;
  flex-direction: column;
  color: var(--text-soft);
  gap: var(--space-3);
}

/* ⚠️ **The list's own gutter, taken from the label above it.** `.attention-list` has no padding of
   its own — every child supplies it, which is why `.attention-clear.inline` carries the same three
   values — so a group without this runs to the panel's edge while its label does not. */
.persons-queue:not(.floating) {
  padding: 0 var(--space-9) var(--space-5);
}

/* ⛔ **Out of flow, for `SpawnStopLane`'s reason rather than a placement preference.**
   `.overlay-host` is `display: flex` with the panel centred in it; a second IN-FLOW child would
   make the panel one of two flex items and move every sheet in the app sideways.

   ⚠️ **`z-index: 2`, matching the stop, and for the same panel.** A sheet's sticky header at
   `z-index: 1`, as a sticky descendant of a non-positioned panel, paints in the HOST's stacking
   context — at the same level this would be. */
/* ⚑ **Placement belongs to `.overlay-corner`, not to this card** (401) — the host reserves one
   band and lays both of its cards out in it, so neither can be positioned into the other. What is
   here is the chrome that makes it a card. */
.persons-queue.floating {
  min-height: 0;
  /* ⛔ **Clipped, because `min-height: 0` is what lets it shrink past its own header** (403, from
     the review). At a short viewport the band gives this card less than the heading plus the line,
     and without this those two paint OUTSIDE the bordered box — over the emergency stop's opaque
     card 8px below, which is the one thing that may never be covered. */
  overflow: hidden;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-md);
  /* 🔴 **Opaque, and `390` is why it is not the 9% amber tint.** A translucent fill on the dim,
     blurred overlay backdrop composites the near-black app underneath it — measured on the stop
     lane, whose heading was invisible until it took `--panel`. The tint is spent on the mark and
     on the count instead, where it sits on this opaque card. */
  background: var(--panel);
  box-shadow: var(--shadow);
}

.pq-toggle {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  gap: var(--space-4);
}

.pq-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.pq-mark {
  display: grid;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-sm);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
  place-items: center;
}

.pq-mark .icon {
  width: 10px;
  height: 10px;
}

.pq-head strong {
  min-width: 0;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
  line-height: 1.25;
}

.pq-count {
  display: inline-flex;
  min-width: 18px;
  height: 16px;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--waiting-pill-border);
  border-radius: var(--radius-pill);
  background: var(--waiting-bg);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-heavy);
}

.pq-rows {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-4);
  list-style: none;
}

/* ⛔ **One scroller for both groups** (403). The bounded band holds a label, a list, a second
   label and a second list; a scroller per list would let one group's overflow hide the other
   group entirely — and the group most likely to be hidden is the one added last. */
/* ⛔ **A gap WIDER than the rows' own** (403, from the review). `.pq-rows` is `var(--space-4)` =
   8px, so a 6px gap here put a group's label 2px closer to the list ABOVE it than two sibling rows
   are to each other — and proximity then reads the label as a footnote on the wrong group. ⚑ The
   thing separating the two populations has to be the biggest gap in the card. */
.pq-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-5);
}

/* ⚠️ **Scrollable only in the corner copy.** *Waiting on you* has a column to spend; this shares a bounded
   band with the emergency stop, and a list that grew without limit would push the stop off the
   screen — which is the one thing this card may never do. The bound itself is the column's
   `max-height`; `min-height: 0` is what lets a flex item honour it instead of its content. */
.persons-queue.floating .pq-body {
  min-height: 0;
  overflow-y: auto;
}

/* ⚑ **The group label, quiet on purpose.** It separates two populations; it is not a second
   heading, and the row under it carries the words that matter. */
/* ⛔ **Which population, on the row** (434) — the group label's weight, on the row's first line,
   because the group it used to head cannot exist inside one ordering. */
.pq-kind {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-medium);
  line-height: var(--leading-tight);
}

/* Who asked and since when share the card's top line; everything else spans the card, in reading
   order. Since when comes after the request in the markup, so a reader hears who, what, then when. */
.pq-row {
  display: grid;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  gap: var(--space-3);
  grid-template-columns: minmax(0, 1fr) auto;
}

.pq-row > * {
  min-width: 0;
  grid-column: 1 / -1;
}

.pq-row > .pq-chain {
  grid-column: 1;
  grid-row: 1;
}

.pq-row > .pq-meta {
  align-self: baseline;
  grid-column: 2;
  grid-row: 1;
}

/* The corner is 200px wide: one column, so since when sits under the request instead. */
.persons-queue.floating .pq-row {
  grid-template-columns: minmax(0, 1fr);
}

.persons-queue.floating .pq-row > .pq-meta {
  grid-column: 1;
  grid-row: auto;
}

/* The chain itself. ⚑ The arrow is a pseudo-element, so no separator is ever read back as text.
   ⛔ **613 · a hop draws two marked elements, not one** — the NAME and, beside it, what that
   participant did. The rule the sentence here used to state is now about the name's own element,
   which still holds what the host named and nothing else; the act is its sibling. */
.pq-chain {
  display: flex;
  padding: 0;
  margin: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  list-style: none;
}

.pq-hop {
  color: var(--text-soft);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

/* ⚑ **The act, quieter than the name it is about** (613). ⛔ `--faint` and the normal weight, so
   the NAMES stay the thing a person scans and the verbs read as the annotation they are — the same
   register `.pq-gap` uses for the sentence about a walk that stopped. ⚠️ **No `font-size` of its
   own**: it inherits the hop's, because two sizes inside one clause would read as two facts. */
.pq-did {
  margin-left: var(--space-2);
  color: var(--faint);
  font-weight: var(--fw-normal);
}

.pq-hop + .pq-hop::before {
  margin-right: var(--space-2);
  color: var(--faint);
  content: '→';
}

/* ⛔ **The end of the chain is the only amber word on the row.** It is the answer that is owed by
   a person, which is the fact this surface exists to state. */
.pq-hop.you {
  color: var(--waiting-text-label);
  font-weight: var(--fw-heavy);
}

.pq-gap {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* 🔴 **557 · the stopped-work band.** ⛔ Set apart by the body's own gap: this is a different KIND
   of fact from the rows under it — nothing is frozen waiting on an answer, the work has simply
   stopped. ⚑ It carries a control, because there is somewhere to go. */
.pq-stalled {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.pq-stall {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
}

/* ⛔ **The consequence, in the summons register** — through the pill token and never
   `var(--waiting)`, which resolves to near-black inside `OverlayHost`'s light scope. */
.pq-stall-says {
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* ⚑ **What the engine observed, and how long ago.** Quiet, because it is the measurement rather
   than the consequence. */
.pq-stall-said {
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* ⚑ **The work's own first line, clamped**: an assignment can be long, and a value that is never on
   screen is the defect `530` measured — its `:title` carries the line whole. */
.pq-stall-what {
  display: -webkit-box;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* The piece and its holder, in the row's own ink. */
.pq-stop-who {
  color: var(--text);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  line-height: var(--leading-tight);
}

.pq-stop-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* ⚑ **Quiet, because it is a caveat and not a summons.** What it discloses is that a read did not
   answer; the rows below it are still the thing to look at. */
.pq-short {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* 🔴 **737 · `734` F-2** — the namesake line: context, in the row's own muted ink, not a state. */
.pq-namesake {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* ⛔ **Amber, and it is the second half of the licence this surface spends** (403). The status
   grammar says a question and a permission may summon attention; this line is the permission
   saying which kind of permission it is. ⚠️ Through the pill token and never `var(--waiting)`,
   for the reason at the top of this file: in the host's light scope that resolves to a near-black
   that reads as ink. */
.pq-asked {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.pq-asked p,
.pq-asked ul {
  margin: 0;
}

.pq-asked-words {
  color: var(--text);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.pq-asked-context,
.pq-asked-prompt,
.pq-asked-options {
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.pq-asked-options {
  padding-left: var(--space-6);
}

.pq-request-scope {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-1);
  list-style: none;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.pq-asked-note {
  color: var(--muted);
  font-size: var(--type-caption);
}

/* What it asks, then the action itself: beside each other where there is room. */
.pq-request-what {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
}

.pq-request-what > .pq-asked-words {
  flex: 0 1 auto;
}

/* The complete command or file, never shortened: a line wider than the card scrolls, and the box
   takes focus so a keyboard can scroll it too. */
.pq-request-line {
  display: flex;
  min-width: 0;
  flex: 1 1 16em;
  flex-direction: column;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  line-height: var(--leading-relaxed);
  overflow-x: auto;
}

.pq-request-line code {
  width: max-content;
  font: inherit;
  white-space: pre;
}

.pq-says {
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.pq-meta {
  display: flex;
  flex-wrap: wrap;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.pq-also {
  color: var(--muted);
}

.pq-go {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel);
  font-size: var(--type-caption);
  gap: var(--space-2);
}

.pq-go .icon {
  width: 10px;
  height: 10px;
}

/* ⚑ **Criterion 20's *about which work*, quiet like the other caveats** — it is context for the
   ask above it and never the ask itself. */
.pq-work {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* The request's own answers side by side, then more options, then the way to the conversation at
   the far end. Opened, the disclosure takes a line of its own. */
.pq-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-3);
}

.pq-actions > .pq-answer {
  min-width: 72px;
  min-height: 32px;
  align-items: center;
  justify-content: center;
}

.pq-actions > .pq-controls {
  margin-left: auto;
}

/* ⛔ **A column in the corner and not a row of buttons**: `.overlay-corner` is 200px wide, and
   side-by-side controls there are unreadable ones. */
.persons-queue.floating .pq-actions {
  flex-direction: column;
  align-items: stretch;
}

.persons-queue.floating .pq-actions > .pq-controls {
  margin-left: 0;
}

.pq-more {
  color: var(--muted);
  font-size: var(--type-caption);
}

.pq-more[open] {
  flex: 1 0 100%;
}

.pq-more > summary {
  display: flex;
  min-height: 32px;
  align-items: center;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  list-style: none;
}

.pq-more > summary::-webkit-details-marker {
  display: none;
}

.pq-more > summary::before {
  display: inline-block;
  margin-right: var(--space-2);
  content: '›';
}

.pq-more[open] > summary::before {
  transform: rotate(90deg);
}

.pq-more-body {
  display: flex;
  flex-direction: column;
  padding: var(--space-3) var(--space-4);
  border-top: var(--border-width) solid var(--line);
  gap: var(--space-3);
}

.pq-more-body p,
.pq-more-body ul {
  margin: 0;
}

.pq-does {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.pq-answer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  font-size: var(--type-caption);
  gap: 1px;
  text-align: left;
}

.pq-answer strong {
  color: var(--text);
  font-weight: var(--fw-medium);
}

/* ⚠️ **The consequence is quiet and the word is not.** A person scans the labels; the sentence is
   there for the press they are not sure about. */
.pq-answer small {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* 🔴 743 · the wholesale grant's warning, inside its button — `AttentionQueue`'s `.request-warns`. */
.pq-answer .pq-warns {
  color: var(--waiting);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* ⛔ **A refusal is never the loud button** — `AttentionQueue`'s rule, and the same predicate
   (`isRefusal`) decides it on both surfaces. */
.pq-answer.deny strong {
  color: var(--muted);
}

.pq-limit,
.pq-after,
.pq-no-answer {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

/* ⚑ **468 · the card's own weight for the same sentence.** `PermissionCard`'s `.refused` is
   `var(--muted)`, and a refusal drawn louder here than on the card it came from would make the
   quieter surface look like the less important one. ⛔ Its own rule rather than another selector on
   the group above: those are *why nothing can be pressed*, and this one is drawn beside buttons
   that CAN be. */
.pq-refused {
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.pq-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* ⚑ **Beside the travel button and weighted the same.** Taking a conversation over to answer it
   here and taking it over to open it are one act with two destinations; drawing one as primary
   would be this surface having an opinion about which a person wants. */
.pq-take-over {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel);
  font-size: var(--type-caption);
}
</style>
