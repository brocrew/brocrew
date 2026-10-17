<script setup lang="ts">
import ModelGotSwitch from './ModelGotSwitch.vue'
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { TranscriptItem, WorkReportItem } from '../lib/transcript'
import { WORK_REPORT_MARK, needsThePerson, workReading, workSummary } from '../lib/work-report'
import { theResourcesAReportNames, openTheDocumentSaid } from '../lib/the-document-a-report-names'
import { workIsWith } from '../lib/where-the-work-is'
import WorkFacts from './WorkFacts.vue'
import OutsideCard from './OutsideCard.vue'
import MarkdownWords from './MarkdownWords.vue'
import { fromOutside, inACard, THIS_CONVERSATION } from '../lib/from-outside'
import { relayedSender } from '../lib/relayed-turn'
import { namedBy, type FilesOnScreen } from '../lib/files-kept'
import type { AgentIdentity } from '../../../shared/runtime-ipc'
import FileRows from './FileRows.vue'

/**
 * 🔴 **What came back from work this conversation gave out, drawn as a record and not as your
 * message** (406, HO-019 §2).
 *
 * ## ⛔ The two things wrong with this row before it existed
 *
 * ⚠️ **It was the person's own bubble.** `reply_to_parent` and the undriven-work notice both reach
 * a parent through `queueMessage`, which publishes a plain `user_turn` — so `UserMessage.vue` drew
 * a worker's answer under `<strong>You</strong>` with the user avatar beside it. ⛔ `214` removed
 * 12,646 messages that rendered injected material as *"You"*, and `278` built
 * `ContinuationEntry.vue` to stop the go-ahead being one more; these are two more, shipped after
 * both. ⚑ **Its own component, never `UserMessage.vue` with a badge** — `ContinuationEntry`'s own
 * ruling, quoted because it is the reason this file exists: *"a 'You' heading with a disclaimer
 * under it is that defect wearing a label."*
 *
 * ⚠️ **And the fact a decision hangs on was in the last paragraph of the prose.** HO-019 §2's
 * property is *"at a glance and WITHOUT READING"*; the mark below is the whole of it.
 *
 * ## 🔴 A pill may restate what the prose says. A second PROSE LINE may not.
 *
 * ⛔ **The photograph is what settled this, and two lines came out because of it.** A `.why`
 * paragraph under the body — `ContinuationEntry`'s, borrowed — was three identical grey sentences
 * on one screen, because reports arrive in runs where a go-ahead happens once; and a cause line
 * above the body printed *the app restarted while it was open* directly above
 * `undrivenWorkText`'s own first line saying the same words. ⚑ Both facts survive: the author is
 * in the meta row and the cause is in the pill. ⚠️ **46 assertions were green over both.**
 *
 * ## ⛔ Not `ContinuationEntry`, and the difference is the SUBJECT rather than the authorship
 *
 * ⚑ Both are `attribution: 'app_authored'` and both are BroBot's words. That entry says *you
 * pressed a button and I sent this for you*; this one says *work you gave out came back*. ⚠️
 * Drawing them as one would put a worker's answer under `sent for you` and the go-ahead's own
 * authorship line, which is false of every report — one word answering two questions (`395`).
 *
 * ## 🔴 The mark is NOT the attention treatment, and that is a ruling rather than a choice
 *
 * ⛔ **The status grammar: only a question and a permission may summon attention, and amber means
 * frozen, waiting for a human.** A finished task that raised a decision is neither — the work is
 * done and nothing is blocked on an answer. ⚑ So the mark is achromatic: it takes
 * `--line-strong` and `--text-soft`, spends none of the `--waiting` ramp, adds no row to `401`/`403`'s queue, adds
 * nothing to any count, and enters no live region. ⚠️ **It is also not a dashed grey mark** — solid
 * border, and `--text-soft` rather than `--faint`, because this is the realest thing on the row.
 *
 * ⚑ **The COLOUR on the row is the outcome's, through {@link StateBadge}**, which is the one place
 * a task outcome's colour is decided, so the difference this component adds is a second mark rather
 * than a different green.
 */
const props = defineProps<{
  item: WorkReportItem & Pick<TranscriptItem, 'at' | 'ordinal'>
  /**
   * 🔴 **The conversations THIS WINDOW is running** (506) — `store.open`'s ids, the set
   * `persons-queue.ts` is handed too.
   *
   * ⛔ **Absent is a real state and not a default worth guessing**: `ReadingPane` and
   * `ChildWorkViewer` render this entry with no runtime behind them, so they pass nothing and the
   * row offers no press — `TranscriptView`'s `canOpenStore` default, one prop over. See
   * `where-the-work-is.ts`, which folds both absences into one `null`.
   */
  held?: ReadonlySet<string> | null
  /**
   * 🔴 **Whether this surface can ask for a kept file's bytes** (510) — `TranscriptView`'s
   * `canOpenDocument`, which is `canOpenStore`'s idiom and its ruling.
   *
   * ⛔ **Default absent, and the default is the ruling.** `ReadingPane` and `ChildWorkViewer`
   * render the same row with no reader behind them; a press there would do nothing when pressed,
   * which `106` forbids. ⚠️ Separate from {@link held} rather than folded into it: that one
   * answers *what conversations is this window running*, and a file read needs no session at
   * all — collapsing the two would be `506 M5`'s hazard with a third question in it.
   */
  canOpenDocument?: boolean
  /** ⚑ **658** — the roster, so a reply's sender is the name a person gave it. */
  identities?: readonly AgentIdentity[] | null
  /** ⚑ **658/667** — the recipient, or `null` for *this conversation*. See `RelayedEntry`'s `ownAgent`. */
  ownAgent: string | null
  /**
   * ⚑ **UI-002 · the files this conversation's tree has read** — a file the reply handed back that
   * it names is drawn as a row under the words. ⛔ Absent or `null`: every file keeps its press.
   */
  kept?: FilesOnScreen | null
}>()

const emit = defineEmits<{
  /**
   * ⛔ **Emitted, never performed**: a surface that performed either itself would be a second route
   * into the routing `095` spent a dispatch collecting into one place. ⚑ The claim-if-needed and the navigation both live in
   * `RuntimeScreen`, where `goToQuestion` already does exactly this for the person's queue.
   */
  openConversation: [sessionId: string]
  /**
   * ⛔ **510 · emitted, never performed**, for its neighbour's reason exactly. ⚑ The fetch and the
   * panel both live in `ConversationPane`, where `openWorkflowOutput` already does this shape:
   * this row holds no bridge, and a surface that read the bytes itself would be a second route
   * into a door `095` spent a dispatch collecting into one place.
   */
  openDocument: [resourceId: string]
}>()

const reading = computed(() => workReading(props.item.report))

/**
 * 🔴 **658 · a REPLY is from outside; a STALL notice is not** — see `lib/from-outside.ts`.
 *
 * ⚑ A child's answer carries its relayer since `658` kept it in the fold, so it is shifted and headed
 * *"Ada to BroBot"*. ⚠️ A stall notice is the app's own words about a child that stopped — no relayer
 * on the event at all — so it is a piece in a card, in the conversation's column, not shifted.
 */
const outside = computed(() => fromOutside(props.item))
const carded = computed(() => inACard(props.item))
const sender = computed(() => relayedSender(outside.value?.sender, props.identities ?? null))

/**
 * ⚑ **Where the work is, and what a press on it would do** (506) — see `where-the-work-is.ts`.
 *
 * ⚠️ **`?? null` because the prop is OPTIONAL and `undefined` is the same answer as `null` here**:
 * this surface has no way to ask what the window holds. The lib takes one null so the two absences
 * cannot be told apart by accident at a call site.
 */
const where = computed(() => workIsWith(props.item.report, props.held ?? null))

/**
 * ⚑ **The files this row names, and whether there is anywhere to open them** (510; resources since
 * D-016) — see `the-document-a-report-names.ts`.
 *
 * ⚠️ **`?? false` because the prop is OPTIONAL and absent means the same as `false` here**: a
 * surface that did not say it has a reader does not have one. ⛔ The lib takes one boolean so the
 * two spellings cannot be told apart by accident at a call site.
 */
const resources = computed(() =>
  theResourcesAReportNames(props.item.report, props.canOpenDocument ?? false),
)

/**
 * 🔴 **UI-002 · the files handed back, as rows** (`07` §2 item 1) — each one the tree has read,
 * under the words; ⛔ one it has not read yet keeps its press in the meta row, never a guessed row.
 */
const handedBack = computed(() =>
  namedBy(theResourcesAReportNames(props.item.report, true), props.kept ?? null),
)
const presses = computed(() =>
  resources.value.filter((resource) => handedBack.value.unread.includes(resource)),
)

/**
 * The card's one-line head, closed by default like a message card. A reply is headed by who wrote
 * to whom; the app's own report is headed by the piece and the mark. Either opens by itself when a
 * person has to act on it.
 */
const exchange = computed(() => {
  // The head already names the piece, so a report's own leading "<label> · " is not said twice on
  // the line; the opened body keeps it.
  const lead = `${props.item.report.label} · `
  const words = props.item.text.startsWith(lead)
    ? props.item.text.slice(lead.length)
    : props.item.text
  const shared = {
    text: words,
    at: props.item.at,
    where: where.value,
    state: workSummary(reading.value),
    open: needsThePerson(props.item.report),
  }
  return outside.value
    ? {
        ...shared,
        from: sender.value,
        to: props.ownAgent ?? THIS_CONVERSATION,
        kind: 'reply',
        label: props.item.report.label,
      }
    : { ...shared, heading: `${reading.value.heading} · ${WORK_REPORT_MARK}` }
})
</script>

<template>
  <!-- 🔴 **658 · the card and the shift are `from-outside.ts`' answers**, asked here rather than
       assumed: `inACard` says a report is carded (every one is — a report is about a piece), and
       `fromOutside` says whether it came from another conversation. -->
  <component
    :is="carded ? OutsideCard : 'div'"
    v-bind="carded ? { shifted: outside !== null } : {}"
    :exchange="carded ? exchange : undefined"
    @open-conversation="(id: string) => emit('openConversation', id)"
    class="work"
    data-cy="work-report"
    :data-state="props.item.report.state"
  >
    <!-- The recipient is already in the card's heading. -->
    <div v-if="outside" class="from-line">
      <strong class="from" data-cy="work-report-from"
        ><span data-cy="work-report-sender">{{ sender }}</span></strong
      >
    </div>
    <div class="msg-column">
      <div class="msg-meta">
        <!-- Never "You". The whole entry exists because this was "You" and should not have been. -->
        <strong data-cy="work-report-heading">{{ reading.heading }}</strong>
        <!-- ⛔ **The author AND the subject, in the meta row, said once** (406, from the
             photograph). ⚠️ This used to be *"work you gave out"* with a `.why` paragraph under
             the body naming BroBot — and with three reports on one screen that paragraph was three
             identical grey sentences competing with the words they explain. ⚑ `ContinuationEntry`
             can afford its own `.why` because a go-ahead happens once; reports arrive in runs. -->
        <span class="about" data-cy="work-report-about">{{ WORK_REPORT_MARK }}</span>
        <!-- 🔴 **506 · the row names a conversation, so it can take you there.** ⛔ In the META row
             and NOT on the facts line: `WorkFacts` carries *"No control, no count, no live region"*
             as its own ruling and is shared with the queued twin. ⚠️ And not a second prose line
             under the body either — `406`'s photograph settled that, and the words here are the
             gesture rather than a restatement of the sentence. -->
        <button
          v-if="where"
          class="go-to-conversation"
          type="button"
          data-cy="work-report-where"
          :data-held="String(where.held)"
          @click="emit('openConversation', where.conversation)"
        >
          {{ where.action }}
        </button>
        <!-- 🔴 **510 · the row names the files kept with the reply, so it can open them.** ⛔ The
             META row again, for `506`'s reason and `WorkFacts`' own: that line carries *"No
             control, no count, no live region"* and is shared with the queued twin. ⚠️ **And not a
             second prose line under the body** — `406`'s photograph settled that, and the ids are
             already IN the body, in a sentence addressed to an agent. ⚑ One press per file the
             report carries, and none on a report that carries none. -->
        <button
          v-for="(resource, index) in presses"
          :key="resource"
          class="go-to-conversation"
          type="button"
          data-cy="work-report-document"
          :data-document="resource"
          @click="emit('openDocument', resource)"
        >
          {{ openTheDocumentSaid(index, presses.length) }}
        </button>
        <!-- In the META row, never inside the body — 001's rule: the message's `textContent` has to
             be exactly what went to the provider. -->
        <span class="time">{{ clockTime(item.at) }}</span>
      </div>
      <!-- ⛔ **The facts line, and it is the whole of "at a glance"** — see `WorkFacts.vue`. Its
           own component because the QUEUED row carries the same line, and a fact that appears only
           once the parent's turn ends is invisible in the window a person is watching. -->
      <WorkFacts :reading="reading" />
      <div
        class="msg-body"
        data-cy="work-report-message"
        :data-at="clockTime(item.at)"
        :title="fullTime(item.at)"
      >
        <MarkdownWords v-if="outside" :text="item.text" />
        <template v-else>{{ item.text }}</template>
      </div>
      <FileRows
        :files="handedBack.rows"
        :can-open="props.canOpenDocument ?? false"
        @open-document="(resourceId) => emit('openDocument', resourceId)"
      />
      <ModelGotSwitch
        :words="item.text"
        :sent="item.sent"
        :together="item.sentWithOthers === true"
        :ordinal="item.ordinal"
      />
    </div>
  </component>
</template>

<style scoped>
/* ⛔ **658 · no `.msg` grid and no avatar** — the frame is `OutsideCard`'s. It used to be
   `ContinuationEntry`'s, *"deliberately"*, and that shared frame is what drew a child's reply at a
   participant's weight. */
.msg-column {
  min-width: 0;
}

.from-line {
  padding-bottom: var(--space-2);
}

/* ⚑ Discreet, and the same weight as a relayed card's heading. */
.from {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.msg-meta {
  display: flex;
  height: 22px;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.msg-meta strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.about {
  color: var(--faint);
  font-size: var(--type-caption);
}

/* ⛔ **A destination, not a form control**: no border, no background, `font: inherit`, and a
   dotted underline that goes solid on hover. ⚑ That is the affordance an in-text destination in
   this app uses, and the meta row is 22px high — a bordered button would grow it and move the
   whole entry. */
.go-to-conversation {
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}

.go-to-conversation:hover,
.go-to-conversation:focus-visible {
  color: var(--text-soft);
  text-decoration-style: solid;
}

.time {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
  opacity: 0.55;
  transition: opacity var(--dur-fast) ease;
}

.work:hover .time {
  opacity: 1;
}

.msg-body {
  padding-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
}
</style>
