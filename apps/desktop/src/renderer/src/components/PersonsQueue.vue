<script setup lang="ts">
import type { WorkInHand } from '../../../shared/question-contracts'

import { computed, ref, useId } from 'vue'
// Shared kind and time wording is read by both queue and conversation cards.
import {
  DID_WORDS,
  isAnApproval,
  KIND_WORDS,
  LOOK,
  usePersonsQueue,
  namesakeSays,
  stopKey,
  type NoAnswerHere,
  type PersonsQueueRow,
  type StalledWorkRow,
} from '../lib/persons-queue'
import { sinceWords } from '../lib/queue-time'
import { permissionOutcomes, permissionShortcutFor, shortcutFor } from '../lib/attention'
import { LIMIT_WORDS } from '../lib/user-input-offer'
import { TAKE_BACK } from '../lib/take-back'
import { drawnFrom } from '../lib/waiting-order'
import { TAKE_IT_OVER_TO_ANSWER_HERE } from '../lib/taking-over'
import { questionOnTheQueue, type QuestionCardReading } from '../lib/question-card'
import type { PermissionDecision, UserInputResponse } from '../../../shared/runtime-ipc'
import InstructionAsks from './InstructionAsks.vue'
import McpServerRequests from './McpServerRequests.vue'
import WorkWaits from './WorkWaits.vue'
import CloseWorkButton from './CloseWorkButton.vue'
import QuestionCard from './QuestionCard.vue'
import PermissionCard from './PermissionCard.vue'
import WhatComesAfter from './WhatComesAfter.vue'
import WaitingOnWhoWrote from './WaitingOnWhoWrote.vue'

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
 * `401`'s reader was structurally unable to list. ⚑ On *Waiting on you* they are its Approvals
 * list and the escalated questions its Questions list (`part`); the corner draws both in one.
 *
 * ⚠️ **`says` is the reliable discriminator and the chain is NOT**, which is worth stating because
 * the first draft of this note claimed all three. An escalated row whose walk was STOPPED draws
 * two names and no `you`, and *no time recorded* is a state both populations can be in — so a
 * reader told to tell them apart by shape would be told wrong. ⛔ `PersonsQueueRow.kind` is on the
 * row for exactly this reason: the surface reads the fact rather than inferring it.
 *
 * ⛔ **The `<ol>`s are separate and the SCROLLER is not**: a bounded band with two scrollers in it
 * can hide a whole group behind the other's overflow.
 *
 * ## 🔴 UI-009 · a question this app asked IS its card (F052)
 *
 * For `PersonsQueueRow.question`, render the shared `QuestionCard` with asker, related work, folded words, options and input, plus Open the conversation. The conversation renders the same card at the asking call. Show escalation only when it happened; keep decision consequences, gaps and work details on decision rows rather than repeating machinery explanations on questions.
 *
 * ## ⚑ UI-009 · the providers' usage limits are not drawn here
 *
 * ⚑ *Waiting on you* draws them in its head — nothing in them is a person's to settle — and the
 * corner draws none: a usage warning is not a summons.
 *
 * ## ⚑ D-017 · R19 · the corner also carries the asks against an identity's rules
 *
 * ⛔ **The corner is the queue's copy on the layer that covers everything else, so it owes what the
 * page it summarises owes**: *Waiting on you* draws the instruction asks beside these rows, and the
 * corner counts them in its head and lists them under the rows (`InstructionAsks`), in the same
 * scroller, as it does the work whose agent answered a person (`WaitingOnWhoWrote`). The in-flow
 * copy does not: the page draws those in lists of their own.
 */
const props = withDefaults(
  defineProps<{
    /**
     * ⛔ **Whether this is the copy in the OVERLAY layer** — the one that is positioned, bounded
     * and scrolls. ⚠️ Defaults to false so a bare mount is the in-flow one, which is what *Waiting
     * on you* gives it and what a test measuring its content rather than its corner wants.
     */
    floating?: boolean
    /**
     * Which of Waiting on you's lists this copy draws: its questions, its permission decisions, or
     * the work that stopped. Every kind when it is left out, as the corner draws them.
     */
    part?: 'questions' | 'approvals' | 'work'
    /** The one card this copy draws, by key, where the page draws its cards one at a time. */
    only?: string
  }>(),
  { floating: false, part: undefined, only: undefined },
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
/** Whether this copy draws the given kind of thing. */
function draws(part: 'questions' | 'approvals' | 'work'): boolean {
  return props.part === undefined || props.part === part
}
const rows = computed(() =>
  drawnFrom(view.value?.rows ?? [], props.only, (row) => row.key).filter((row) =>
    draws(isAnApproval(row) ? 'approvals' : 'questions'),
  ),
)
/** The rows whose asker reads the same name as another conversation's, read once per look. */
const namesakes = queue.namesakes
/**
 * ⚑ **557 · what the queue says about work that STOPPED with nobody left to tell** — a third
 * computed off the same composable, and `StalledWorkView`'s docblock is why it is not a fourth
 * population of `view` either.
 */
const stalled = computed(() => queue.stalled.value)
const stalledRows = computed(() =>
  draws('work') ? drawnFrom(stalled.value?.rows ?? [], props.only, (row) => row.key) : [],
)
/** The pieces whose holder stopped with them, its giver told: beside the stalled band. */
const stopped = computed(() => queue.stopped.value)
const stoppedCards = computed(() =>
  draws('work') ? drawnFrom(queue.stoppedCards.value, props.only, (card) => stopKey(card.row)) : [],
)
/** The asks against an identity's rules, drawn here by the corner copy only: the page lists them. */
const asks = computed(() => queue.asks.value)
const asksSaySomething = computed(
  () =>
    asks.value !== null && (asks.value.rows.length > 0 || asks.value.partial || asks.value.stale),
)
/** The work whose agent answered a person, drawn here by the corner copy only, as the asks. */
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

function hasDetails(row: PersonsQueueRow): boolean {
  return (
    !row.question &&
    (row.kind === 'a-decision' ||
      row.blockedSinceIs === 'told' ||
      row.says !== null ||
      row.alsoOnScreen)
  )
}

function recordedQuestion(row: PersonsQueueRow): QuestionCardReading {
  return {
    ...questionOnTheQueue(row, { words: row.words, offered: null, sent: false }, undefined),
    answerable: false,
  }
}

function go(row: PersonsQueueRow): void {
  // ⛔ **Leave first, travel second.** The host's `close` returns focus to whatever opened it, and
  // a surface swap underneath an open modal is a screen a person cannot see the result of.
  if (props.floating) emit('leave')
  queue.take(row)
}

function settlePermission(row: PersonsQueueRow, response: PermissionDecision): void {
  const offered = permissionShortcutFor(row.answers, response.outcome)
  if (offered) queue.settle(row, offered)
}

function settleQuestion(row: PersonsQueueRow, response: UserInputResponse): void {
  const offered = shortcutFor(row.answers, response)
  if (offered) queue.settle(row, offered)
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
       waiting*. Neither draws anything here: *Waiting on you* says which one it is, per list.

       ⛔ **…and a THIRD absence draws after all** (403, from the review): one read refused while
       the other came back empty. `rows.length` is 0 there and the first version therefore drew
       nothing at all — which put the screen back to *"the workspace is quiet"* over a population
       the app had failed to read. ⚑ A card carrying only the short-list line is the honest screen. -->
  <!-- `data-place` names what this copy is, not the screen it is on, so it stays true when it moves. -->
  <section
    v-if="
      rows.length > 0 ||
      stalledRows.length > 0 ||
      stoppedCards.length > 0 ||
      (props.floating &&
        ((view !== null && (view.partial || view.stale || view.noLedger || view.rowsDropped)) ||
          stalled?.unread === true ||
          !!stalled?.short ||
          stopped?.unread === true ||
          !!stopped?.short ||
          asksSaySomething ||
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
    <!-- The corner's head counts every list this copy draws (`cornerHead`); `null` says nothing
         over lists nobody has read. -->
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
              class="pq-answer"
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
            <button
              v-if="card.listed"
              class="pq-go pq-door"
              type="button"
              :data-cy="`persons-queue-stopped-look-${card.row.key}`"
              @click="queue.openWork(card.row)"
            >
              {{ LOOK }}
              <svg class="icon"><use href="#i-arrow" /></svg>
            </button>
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
      <!-- What the corner says when a list it reads could not be read whole. In flow, Waiting on you
           says it once for the open list. -->
      <template v-if="props.floating">
        <p v-if="stalled?.unread" class="pq-short" data-cy="persons-queue-stalled-unread">
          The last look for work that has stopped did not answer, so something nobody has been told
          about may not be shown here.
        </p>
        <p v-if="stalled?.short" class="pq-short" data-cy="persons-queue-stalled-short">
          {{ stalled.short }}
        </p>
        <p v-if="stopped?.unread" class="pq-short" data-cy="persons-queue-stopped-unread">
          The last look for work whose agent stopped did not answer, so some may not be shown here.
        </p>
        <p v-if="stopped?.short" class="pq-short" data-cy="persons-queue-stopped-short">
          {{ stopped.short }}
        </p>
        <p v-if="view?.partial" class="pq-short" data-cy="persons-queue-partial">
          One of these lists could not be read just now, so there may be more than this.
        </p>
        <p v-if="view?.noLedger" class="pq-short" data-cy="persons-queue-no-ledger">
          This app has no record to read just now, so an empty list here says nothing about what is
          waiting on you.
        </p>
        <p v-if="view?.rowsDropped" class="pq-short" data-cy="persons-queue-rows-dropped">
          Part of this app’s own record could not be read, so something waiting on you may be
          missing from this list.
        </p>
        <p v-if="view?.stale" class="pq-short" data-cy="persons-queue-stale">
          The last look at one of these lists did not answer, so this is what it said before that —
          anything that has arrived since is not here.
        </p>
      </template>
      <!-- 🔴 **Oldest-blocked first** (434, criterion 17): which population a row is, is on the row
           (`PersonsQueueRow.kind`). ⚠️ The list is NAMED with its ordering, so a screen reader
           hears what the order means rather than a bare *"list, 4 items"*. -->
      <ol
        v-if="rows.length > 0"
        class="pq-rows"
        aria-label="Waiting on you, the longest-blocked first"
        data-cy="persons-queue-rows"
      >
        <li
          v-for="row in rows"
          :key="row.key"
          class="pq-row"
          :class="{ 'with-live-card': row.liveCard !== undefined }"
          :data-kind="row.kind"
          :data-cy="`persons-queue-row-${row.key}`"
        >
          <QuestionCard
            v-if="row.question"
            :reading="questionOnTheQueue(row, row.question, queue.presses.get(row.key))"
            :path-session-id="row.sessionId"
            can-open-document
            fold
            @open-document="queue.openFile"
            @answer="(response) => answer(row, response)"
            @move="(decision) => queue.move(row, decision)"
          >
            <template #door>
              <button
                class="pq-go"
                type="button"
                :data-cy="`persons-queue-go-${row.key}`"
                @click="go(row)"
              >
                {{ row.action }}
                <svg class="icon"><use href="#i-arrow" /></svg>
              </button>
            </template>
          </QuestionCard>

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

          <QuestionCard
            v-if="!row.question && row.liveCard?.kind === 'userInput'"
            :item="row.liveCard"
            :added-context="row.words?.context"
            :own-agent="row.chain[0]?.name ?? null"
            :path-session-id="row.sessionId"
            :queue-sent="row.noAnswerHere === 'answer-sent'"
            :queue-offers="row.answers"
            :hide-choice-effects="row.kind !== 'a-decision'"
            inline-queue-choices
            compact
            fold
            @respond="(_, response) => settleQuestion(row, response)"
          />
          <PermissionCard
            v-else-if="!row.question && row.liveCard?.kind === 'permission'"
            :item="row.liveCard"
            :own-agent="row.chain[0]?.name ?? null"
            :provider="row.cardProvider ?? null"
            :queue-sent="row.noAnswerHere === 'answer-sent'"
            :queue-outcomes="permissionOutcomes(row.answers)"
            :after-said-elsewhere="hasDetails(row)"
            compact
            @decide="(_, decision) => settlePermission(row, decision)"
          >
            <template #door>
              <button
                class="pq-go pq-door"
                type="button"
                :data-cy="`persons-queue-go-${row.key}`"
                @click="go(row)"
              >
                {{ row.action }}
                <svg class="icon"><use href="#i-arrow" /></svg>
              </button>
            </template>
          </PermissionCard>
          <QuestionCard
            v-else-if="row.words"
            :reading="recordedQuestion(row)"
            :path-session-id="row.sessionId"
            :data-cy="`persons-queue-asked-${row.key}`"
            compact
            fold
            read-only
          />

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
            <details
              v-if="hasDetails(row)"
              class="pq-more"
              :data-cy="`persons-queue-more-${row.key}`"
            >
              <summary>Details</summary>
              <div class="pq-more-body">
                <WhatComesAfter
                  v-if="row.liveCard?.kind === 'permission' && row.answers.length > 0"
                  class="pq-says"
                />
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
              </div>
            </details>

            <div class="pq-controls">
              <!-- 🔴 **Take it over WITHOUT going to it** (434) — `336`'s door with the navigation
                   left off, so the answers land on this row and the person never leaves the one
                   list. ⚠️ Its word says it is a take-over, because it is: this window becomes the
                   owner, and the owner is who may send to it, answer it and end it. ⚑ The press is
                   undoable: `handing-it-back.ts` undoes it (`523`). -->
              <!-- ⛔ Only `not-yours-yet` reaches it (a question this app asked needs no take-over,
                   D-017 · R6); not `!row.held`, which is false on rows this cannot help. -->
              <button
                v-if="row.noAnswerHere === 'not-yours-yet'"
                class="pq-take-over"
                type="button"
                :data-cy="`persons-queue-take-over-${row.key}`"
                @click="takeOver(row)"
              >
                {{ TAKE_IT_OVER_TO_ANSWER_HERE }}
              </button>

              <!-- ⛔ **One button, and it travels**, its word saying which gesture it is before it is
                   pressed (`336`'s door). A question's and a live permission's ride on their card's
                   answer line instead. -->
              <button
                v-if="!row.question && row.liveCard?.kind !== 'permission'"
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

.pq-row.with-live-card {
  gap: var(--space-2);
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

.persons-queue.floating .with-live-card > .pq-meta {
  grid-row: 2;
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

.pq-says {
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.pq-meta {
  margin: 0;
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

.with-live-card .pq-go {
  padding: 0;
  border: 0;
  background: transparent;
  text-decoration: underline dotted;
}
.with-live-card .pq-go .icon {
  display: none;
}
.with-live-card .pq-more > summary {
  min-height: 22px;
  padding: 0;
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

.pq-actions > .pq-controls {
  margin-left: auto;
}

.persons-queue.floating :deep(.permission-actions) {
  flex-direction: column;
  align-items: stretch;
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

.persons-queue.floating .with-live-card .pq-actions {
  flex-flow: row wrap;
  align-items: baseline;
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

.pq-limit,
.pq-no-answer {
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
