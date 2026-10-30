<script setup lang="ts">
/**
 * # 🔴 658 · A call that put this conversation's words into ANOTHER one, drawn as a card
 *
 * Render replies and messages to other agents as dedicated outgoing cards rather than generic MCP tool entries.
 *
 * ⛔ **The card IS the call** — the same item, never a second row beside it (`035`). The fold marks
 * which calls these are and lands the host's row on them; `lib/outgoing-card.ts` decides every word.
 *
 * ## ⚑ In a card, and NOT shifted
 *
 * ⚠️ **These are this conversation's own agent's words going OUT** — a participant, speaking. So the
 * card is `OutsideCard`'s frame (the row is outside the two-party flow: it is addressed to somebody
 * who is not in this conversation) and `shifted` is false: nobody outside wrote it. ⚑ The heading
 * names the same two agents, in the same order, as the card the words become on the OTHER side —
 * BroBot's *"BroBot to Ada"* here arrives in Ada's conversation headed *"BroBot to Ada"*, shifted.
 * ⚑ **UI-003 · a request taken on goes to nobody** — its heading is its sender and what it did,
 * *"BroBot took on"*, and it arrives nowhere else.
 *
 * ## 🔴 UI-009 · a question it asked is `QuestionCard`, in this frame
 *
 * Render question tools with `QuestionCard`, shared with Waiting on you, inside the outgoing card's frame. A person asked to answer can press an option or type their own words here; see `question-card.ts`.
 */
import { computed, ref } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { OutgoingWords, ToolItem, TranscriptItem } from '../lib/transcript'
import {
  A_PERSON_ADDRESSED,
  BODY_WAS_CUT,
  OUTGOING_STATE_WORD,
  outgoingCard,
  receiptIsCut,
  STATUS_LEAD,
  TOOK_ON_WORD,
} from '../lib/outgoing-card'
import { workSummary } from '../lib/work-report'
import { ANSWER_NOT_HELD } from '../lib/tool-answer'
import { QUESTION_STATE_WORD } from '../lib/question-card'
import { questionInTheConversation } from '../lib/question-card'
import type { RequestDraft } from '../lib/session-record'
import { THIS_CONVERSATION_FIRST } from '../lib/from-outside'
import { openTheDocumentSaid } from '../lib/the-document-a-report-names'
import { namedBy, type FilesOnScreen } from '../lib/files-kept'
import { jsonInWords } from '../lib/words-with-json'
import type { AgentIdentity, UserInputResponse } from '../../../shared/runtime-ipc'
import type { WorkEdge } from '../../../shared/who-called-whom'
import OutsideCard from './OutsideCard.vue'
import MarkdownWords from './MarkdownWords.vue'
import WorkFacts from './WorkFacts.vue'
import WordsViews from './WordsViews.vue'
import ReadableWords from './ReadableWords.vue'
import FileRows from './FileRows.vue'
import QuestionCard from './QuestionCard.vue'
import type { PathsHere } from '../composables/useMessagePaths'
import TodoCard from './TodoCard.vue'
import { usePersonsQueue } from '../lib/persons-queue'
import { todoHead } from '../lib/work-waits'
import { TAKE_BACK } from '../lib/take-back'

const props = defineProps<{
  item: ToolItem & Pick<TranscriptItem, 'at'>
  /** The facts the fold landed on this call — `item.outgoing`, narrowed by the caller. */
  words: OutgoingWords
  sessionId?: string
  /**
   * ⚑ The name this conversation's own agent is headed with — the SENDER here. ⚠️ **667 · `null`
   * where nothing names it**, drawn as {@link THIS_CONVERSATION_FIRST} — never a provider.
   */
  ownAgent: string | null
  identities?: readonly AgentIdentity[] | null
  /** The conversations this window is running — see `WorkReportEntry.held`. */
  held?: ReadonlySet<string> | null
  /**
   * ⚑ **The work this conversation gave out, as the cast last read it** — where a give's card finds
   * the conversation its piece went to. See `outgoingCard`'s `gaveOut`.
   */
  gaveOut?: readonly WorkEdge[] | null
  canOpenDocument?: boolean
  /**
   * ⚑ **UI-002 · the files this conversation's tree has read** — a reply's files and a give's
   * inputs are drawn as rows under the words. ⛔ Absent or `null`: a reply keeps its presses.
   */
  kept?: FilesOnScreen | null
  /**
   * ⚑ **UI-009 · where a question's typed words live** — `TranscriptView.draftFor`, so they and its
   * in-flight mark outlive a remount. Absent: the card keeps its own.
   */
  draftFor?: (requestId: string) => RequestDraft
  /** ⚑ **UI-009 · a question asked of a person can be answered on this surface.** */
  canAnswer?: boolean
  /** This conversation's paths, for the words of a question it asked. */
  paths?: PathsHere | null
  /** Whether this conversation still holds what its tools answered in full. */
  canReadAnswer?: boolean
  /** Takes a piece back from the service it is on, as a person, and answers in words. */
  takeBack?: (piece: string) => Promise<string>
}>()

const emit = defineEmits<{
  /**
   * ⛔ Emitted, never performed — `WorkReportEntry`'s rule. ⚑ **UI-011 · `briefOf`**: the label of
   * the piece whose brief the opened conversation brings into view — a give's cut note's press.
   */
  openConversation: [sessionId: string, briefOf?: string]
  openDocument: [resourceId: string]
  /** The whole of what this call was answered, where its receipt was cut. Raised, never read here. */
  openAnswer: [callId: string, name: string]
  /** ⚑ **UI-009 · a person answered the question this call asked** — the screen sends it. */
  move: [requestId: string, decision: 'move' | 'here']
  respond: [requestId: string, response: UserInputResponse]
}>()

/** ⚑ **UI-009 · a question this call asked**, as `QuestionCard` draws it — `null` on every other card. */
const question = computed(() =>
  props.words.tool === 'ask_question' || props.words.tool === 'pass_question_up'
    ? questionInTheConversation(props.item, props.words.tool, props.words.asked, {
        ownAgent: props.ownAgent,
        identities: props.identities ?? null,
        held: props.held ?? null,
        canAnswer: props.canAnswer ?? false,
      })
    : null,
)

const card = computed(() =>
  props.words.tool === 'request_action' ||
  props.words.tool === 'ask_question' ||
  props.words.tool === 'pass_question_up'
    ? null
    : outgoingCard(
        props.item,
        props.words,
        props.identities ?? null,
        props.held ?? null,
        props.gaveOut ?? null,
      ),
)

const queue = usePersonsQueue()
const todo = computed(() => {
  if (props.words.tool !== 'request_action') return null
  const asked = props.words.asked
  if (!asked?.action) return null
  const name = props.ownAgent ?? THIS_CONVERSATION_FIRST
  const row = {
    key: asked.requestId,
    sessionId: props.sessionId ?? '',
    askedByName: name,
    head: todoHead({ askedByName: name, label: asked.label ?? null }),
    text: asked.prompt,
    files: asked.action.files,
  }
  const shared = queue.todoCards.value.find((one) => one.row.key === row.key)
  const ended =
    asked.answered !== undefined || asked.closed !== undefined || asked.note !== undefined
  return {
    row,
    listed: !ended,
    pending: shared?.pending ?? false,
    taken: ended || (shared?.taken ?? false),
    said:
      asked.note !== undefined
        ? asked.note
        : asked.answered !== undefined
          ? (shared?.said ?? 'Your answer was sent.')
          : asked.closed !== undefined
            ? 'This to-do has ended.'
            : (shared?.said ?? null),
  }
})

const agentQuestion = computed(
  () =>
    (props.words.tool === 'ask_question' || props.words.tool === 'pass_question_up') &&
    (props.words.asked?.to === 'the-parent' || props.words.asked?.to === 'an-agent'),
)
/** How a question stands once nobody is asked to answer it any more. */
const SETTLED: ReadonlySet<string> = new Set([
  'answered',
  'declined',
  'withdrawn',
  'not-answered',
  'closed',
])
/**
 * A question to the person that is settled folds like the agent cards. ⛔ One still waiting stays
 * open with its answer controls: a fold would hide something the person must act on.
 */
const settledForThePerson = computed(
  () =>
    (props.words.tool === 'ask_question' || props.words.tool === 'pass_question_up') &&
    props.words.asked?.to === 'a-person' &&
    question.value !== null &&
    SETTLED.has(question.value.state),
)
/**
 * A question call that ended with no question waiting — the app refused it, it failed, or it did
 * not finish — folds too, its receipt on the line so a refusal is still read without opening it.
 */
const callEnded = computed(() => {
  const ended = question.value
  if (ended === null) return false
  if (ended.state === 'failed' || ended.state === 'did-not-finish') return true
  const said = ended.receipt ?? ''
  // A refusal's receipt opens with `refused (<rail>): `; the rail ends at the first `)`.
  return (
    ended.state === 'receipt' &&
    said.startsWith('refused (') &&
    said.slice(said.indexOf(')')).startsWith('): ')
  )
})
/** A question card drawn folded to one line. */
const questionFolds = computed(
  () => agentQuestion.value || settledForThePerson.value || callEnded.value,
)
const agentCard = computed(() => {
  if (props.words.tool === 'reply_to_parent') {
    const reply = props.words.reply
    return (
      reply !== null &&
      reply.toThePerson !== true &&
      (reply.toConversation !== undefined || reply.toProfile !== undefined)
    )
  }
  return (
    props.words.tool === 'give_work' ||
    props.words.tool === 'update_work' ||
    props.words.tool === 'message_agent'
  )
})
/** A request this agent took on for a person: folded like the agent cards, naming the person. */
const takeOn = computed(() => card.value?.tool === 'take_on_work')
/** A piece handed back to the person who asked for it. */
const handBack = computed(
  () => props.words.tool === 'reply_to_parent' && props.words.reply?.toThePerson === true,
)
/** How many files a hand-back carries, said on its folded line so they stay findable. */
const filesSaid = computed(() => {
  const count = handBack.value ? (card.value?.resources.length ?? 0) : 0
  return count === 0 ? null : count === 1 ? '1 file' : `${count} files`
})
/** Cards drawn folded to one line, their words in markdown. */
const folds = computed(() => agentCard.value || takeOn.value || handBack.value)

/** ⚑ A give's card wears the send glyph: work handed over. */
const glyph = computed(() =>
  card.value?.tool === 'give_work'
    ? '#i-send'
    : // ⚑ **UI-003** — a request taken on wears the Current task's own mark: work this agent is on.
      card.value?.tool === 'take_on_work'
      ? '#i-play'
      : // ⚑ **D-047** — a new brief wears the glyph of words given again.
        card.value?.tool === 'update_work'
        ? '#i-refresh'
        : null,
)

/**
 * Offer Readable and Raw views when the words contain JSON, using `lib/words-with-json.ts`. A `null` result means the card needs only one view.
 */
const jsonParts = computed(() =>
  card.value === null || card.value.body === null ? null : jsonInWords(card.value.body),
)

/**
 * 🔴 **UI-002 · what this card handed over, as rows** (`07` §2 item 1) — a reply's files the tree
 * has read, or the inputs kept on the piece a give opened. ⛔ A reply's file not read yet keeps its
 * press in the meta row.
 */
const handedBack = computed(() => namedBy(card.value?.resources ?? [], props.kept ?? null))
const handedOver = computed(() =>
  card.value === null || card.value.inputsOn === null
    ? handedBack.value.rows
    : (props.kept?.inputsOn(
        card.value.inputsOn,
        // ⚑ The give's own inputs are kept the moment it is given, and its result lands after.
        card.value.inputsUntil ?? props.item.result?.at,
      ) ?? []),
)

/** ⚑ **UI-009 · the question's request id** — `null` until its row lands. */
const asking = computed(() => question.value?.requestId ?? null)

/** ⚑ **UI-009 · the question's draft, on the record that owns it** — none until its row lands. */
const draft = computed(() => (asking.value === null ? undefined : props.draftFor?.(asking.value)))

/** ⚑ **UI-009 · a person's answer, handed up** — ⛔ emitted, never performed. */
function answer(response: UserInputResponse): void {
  if (asking.value !== null) emit('respond', asking.value, response)
}
const view = ref<'readable' | 'raw'>('readable')

/** What the take-back answered on this card, and whether it is still on its way. */
const takenBack = ref<string | null>(null)
const takingBack = ref(false)
async function takeItBack(piece: string): Promise<void> {
  if (props.takeBack === undefined || takingBack.value) return
  takingBack.value = true
  try {
    takenBack.value = await props.takeBack(piece)
  } finally {
    takingBack.value = false
  }
}
</script>

<template>
  <!-- 🔴 **UI-009 · a question it asked — `QuestionCard`, in the same frame**, so the call is still
       one row and the card *Waiting on you* draws is this one. -->
  <OutsideCard
    v-if="todo"
    class="outgoing"
    :shifted="false"
    data-cy="outgoing"
    data-tool="request_action"
  >
    <TodoCard :card="todo" cy="inline" :can-answer="props.canAnswer && !!props.sessionId" />
  </OutsideCard>
  <OutsideCard
    v-else-if="question"
    class="outgoing"
    :shifted="false"
    data-cy="outgoing"
    :data-tool="props.words.tool"
    :data-state="question.state"
    :exchange="
      questionFolds
        ? {
            from: question.asker,
            to: question.askedOf,
            kind: 'question',
            label: question.piece,
            text: question.words ?? '',
            at: item.at,
            where: question.where,
            // The host's own note says what became of one it closed; a refusal's receipt says so.
            state: QUESTION_STATE_WORD[question.state] || question.note || question.receipt,
          }
        : undefined
    "
    @open-conversation="(id) => emit('openConversation', id)"
  >
    <QuestionCard
      :reading="question"
      :draft="draft"
      :paths="props.paths"
      :markdown="questionFolds"
      :without-recipient="questionFolds"
      @answer="answer"
      @move="(decision) => asking !== null && emit('move', asking, decision)"
      @open-conversation="(sessionId) => emit('openConversation', sessionId)"
    />
  </OutsideCard>
  <OutsideCard
    v-else-if="card"
    class="outgoing"
    :shifted="false"
    data-cy="outgoing"
    :data-tool="card.tool"
    :data-state="card.state"
    :exchange="
      takeOn
        ? {
            from: props.ownAgent ?? THIS_CONVERSATION_FIRST,
            to: A_PERSON_ADDRESSED,
            kind: TOOK_ON_WORD,
            label: card.piece,
            text: card.title ?? card.body ?? '',
            at: item.at,
            // The heading already names the person, so “for you” is not said twice.
            state: card.state === 'taken-on' ? null : OUTGOING_STATE_WORD[card.state],
          }
        : agentCard || handBack
          ? {
              from: props.ownAgent ?? THIS_CONVERSATION_FIRST,
              to:
                props.words.tool === 'message_agent' &&
                card.recipient === props.ownAgent &&
                props.words.sent?.toLabel
                  ? `${card.recipient} · ${props.words.sent.toLabel}`
                  : card.recipient,
              kind: card.mark || 'message',
              label: card.facts?.heading ?? card.piece,
              text: card.body ?? card.title ?? '',
              at: item.at,
              where: card.where,
              state: [
                card.facts ? workSummary(card.facts) : null,
                filesSaid,
                OUTGOING_STATE_WORD[card.state],
              ]
                .filter(Boolean)
                .join(' · '),
            }
          : undefined
    "
    @open-conversation="(id) => emit('openConversation', id)"
  >
    <div class="msg-meta">
      <strong class="heading" data-cy="outgoing-heading"
        ><svg v-if="glyph" class="icon" aria-hidden="true"><use :href="glyph" /></svg
        ><span data-cy="outgoing-sender">{{ props.ownAgent ?? THIS_CONVERSATION_FIRST }}</span>
        <template v-if="!folds"
          >{{ ' ' }}{{ card.joiner }}{{ ' ' }}
          <span v-if="card.recipient" data-cy="outgoing-recipient">{{
            card.recipient
          }}</span></template
        ></strong
      >
      <!-- ⚑ A reply names the piece it answers — the parent's report card leads with the same words.
           🔴 **688 · and a message or a question names the piece it is about** (`687` H2), in the
           same position and ink, with the incoming card's own words. -->
      <strong v-if="card.facts || card.piece" class="task" data-cy="outgoing-task">{{
        card.facts?.heading ?? card.piece
      }}</strong>
      <span v-if="card.mark" class="about" data-cy="outgoing-mark">{{ card.mark }}</span>
      <span
        v-if="OUTGOING_STATE_WORD[card.state]"
        class="about state"
        :class="{ failed: card.state === 'failed' }"
        data-cy="outgoing-state"
        >{{ OUTGOING_STATE_WORD[card.state] }}</span
      >
      <button
        v-if="card.where"
        class="press"
        type="button"
        data-cy="outgoing-where"
        :data-held="String(card.where.held)"
        @click="emit('openConversation', card.where.conversation)"
      >
        {{ card.where.action }}
      </button>
      <!-- A person may take back the piece a service is on, while it is on it. -->
      <button
        v-if="card.takeBack && props.takeBack"
        class="press"
        type="button"
        data-cy="outgoing-take-back"
        :disabled="takingBack"
        @click="takeItBack(card.takeBack)"
      >
        {{ TAKE_BACK }}
      </button>
      <template v-if="props.canOpenDocument">
        <button
          v-for="(resource, index) in handedBack.unread"
          :key="resource"
          class="press"
          type="button"
          data-cy="outgoing-document"
          :data-document="resource"
          @click="emit('openDocument', resource)"
        >
          {{ openTheDocumentSaid(index, handedBack.unread.length) }}
        </button>
      </template>
      <WordsViews v-if="jsonParts" v-model="view" class="views" />
      <span class="time" :class="{ beside: jsonParts }">{{ clockTime(item.at) }}</span>
    </div>
    <WorkFacts v-if="card.facts" :reading="card.facts" />
    <!-- ⚑ **A give's title, above its brief** — the piece's own name, as the tree lists it. -->
    <p v-if="card.title" class="title" data-cy="outgoing-title">{{ card.title }}</p>
    <ReadableWords
      v-if="jsonParts && view === 'readable'"
      class="msg-body"
      data-cy="outgoing-readable"
      :parts="jsonParts"
      :markdown="folds"
      :title="fullTime(item.at)"
    />
    <div
      v-else-if="card.body !== null"
      class="msg-body"
      data-cy="outgoing-message"
      :data-cut="card.bodyIsCut"
      :title="fullTime(item.at)"
    >
      <MarkdownWords v-if="view === 'readable' && folds" :text="card.body" />
      <template v-else>{{ card.body }}</template>
    </div>
    <!-- 🔴 **678 · a cut body SAYS it was cut, in words and outside the message's box** — never
         the `…` this drew until `678`, which the author may have typed (`BODY_WAS_CUT`).
         🔴 **UI-011 · a give's cut brief opens to the whole one** (F037) — the sentence says where it
         is and is the press: the owner's conversation, at the brief's own row. -->
    <p v-if="card.bodyIsCut" class="cut" data-cy="outgoing-cut">
      <button
        v-if="card.wholeBrief"
        class="press"
        type="button"
        data-cy="outgoing-read-whole"
        @click="emit('openConversation', card.wholeBrief.conversation, card.wholeBrief.label)"
      >
        {{ card.wholeBrief.said }}
      </button>
      <template v-else>{{ BODY_WAS_CUT }}</template>
    </p>
    <FileRows
      :files="handedOver"
      :can-open="props.canOpenDocument ?? false"
      @open-document="(resourceId) => emit('openDocument', resourceId)"
    />
    <!-- ⚑ **UI-003 · a take-on's newest status line**, small, until the reply that finishes it. -->
    <p v-if="card.status" class="status" data-cy="outgoing-status">
      <span class="status-lead">{{ STATUS_LEAD }}</span> {{ card.status }}
    </p>
    <p v-if="takenBack !== null" class="receipt" role="status" data-cy="outgoing-taken-back">
      {{ takenBack }}
    </p>
    <p
      v-if="card.receipt !== null"
      class="receipt"
      :class="{ failed: card.state === 'failed' }"
      data-cy="outgoing-receipt"
    >
      {{ card.receipt }}
    </p>
    <!-- A receipt cut at the row's bound may have lost what to do next: the whole answer is one
         press away while the conversation holds it, and the card says so when it no longer does. -->
    <p v-if="receiptIsCut(card.receipt, item.told)" class="cut" data-cy="outgoing-receipt-cut">
      <button
        v-if="props.canReadAnswer"
        class="press"
        type="button"
        data-cy="outgoing-whole-answer"
        title="Show everything this tool answered, not just the short form on this card."
        @click="emit('openAnswer', item.callId, item.name)"
      >
        Show the whole answer
      </button>
      <template v-else>{{ ANSWER_NOT_HELD }}</template>
    </p>
  </OutsideCard>
</template>

<style scoped>
/* ⚑ The incoming card's meta row, word for word — `RelayedEntry`'s — so the two directions of one
   exchange read as one vocabulary. */
.msg-meta {
  display: flex;
  min-height: 20px;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.heading {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

.about {
  color: var(--faint);
  font-size: var(--type-caption);
}

.task {
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

/* ⚑ `WorkReportEntry`'s press, by its declarations — a scoped class there matches nothing here. */
.press {
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

.press:hover,
.press:focus-visible {
  color: var(--text-soft);
  text-decoration-style: solid;
}

/* ⚑ The views ride the meta row's right edge, just before the clock. */
.views {
  margin-left: auto;
}

.time {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
  opacity: 0.55;
  transition: opacity var(--dur-fast) ease;
}

.time.beside {
  margin-left: 0;
}

.outgoing:hover .time {
  opacity: 1;
}

/* ⚑ The brief's own size, in bold — the title heads the words under it rather than labelling them. */
.title {
  margin: 0;
  padding-top: var(--space-2);
  color: var(--text);
  font-size: var(--type-reading);
  font-weight: var(--fw-bold);
  line-height: var(--leading-reading);
}

.msg-body {
  padding-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
}

.cut {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-style: italic;
}

/* ⚑ **UI-011** — the cut note as a press keeps the note's italic and size (`font: inherit`), and
   a line it wraps onto starts at the left like the note's. */
.cut .press {
  text-align: start;
}

.receipt {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  /* A reason is read whole: it wraps, and a long unbroken word breaks rather than run off the card. */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* ⚑ **The card's glyph, at the heading's size** — `WorkFacts`' mark icon, by its declarations. */
.heading .icon {
  width: 11px;
  height: 11px;
  margin-right: var(--space-2);
  vertical-align: -1px;
}

.status {
  margin: var(--space-3) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

.status-lead {
  font-weight: var(--fw-bold);
}

/* ⚑ `ToolEntry`'s failed body, by its token — a call that errored says so in the failure colour. */
.receipt.failed,
.outgoing .state.failed {
  color: var(--danger);
}
</style>
