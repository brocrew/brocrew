<script setup lang="ts">
import { computed, ref } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import MarkdownWords from './MarkdownWords.vue'
import QuestionCard from './QuestionCard.vue'
import type { UserInputResponse } from '../../../shared/runtime-ipc'
import type { QuestionCardReading } from '../lib/question-card'
import {
  answerFor,
  questionsWithChoices,
  goesAsAMessage,
  SENT_AS_A_MESSAGE,
  type AskedWithoutWaiting,
} from '../lib/asked-without-waiting'
import type { PathsHere } from '../composables/useMessagePaths'
import type { AssistantItem, TranscriptItem } from '../lib/transcript'

/** Stream plain text while growing; render Markdown once settled, including interrupted tails. */
const props = defineProps<{
  item: AssistantItem & Pick<TranscriptItem, 'at'>
  /** Who is speaking, as the header shows it. */
  who?: string
  /** App-provided document ids for links; absent rosters draw no document controls. */
  documents?: readonly string[]
  /** Draw question choices only when the conversation can take a message. */
  canAnswer?: boolean
  /** This conversation's paths. Absent: a path in the reply stays plain text. */
  paths?: PathsHere | null
}>()

const emit = defineEmits<{
  /** The pane owns document reads; forward through the transcript's existing event. */
  openDocument: [resourceId: string]
  /** Raise the chosen words; the pane owns sending and holding them while busy. */
  answer: [text: string]
}>()

const choices = computed(() =>
  props.item.streaming ? [] : questionsWithChoices(props.item.questions),
)
const questionsWithoutProse = computed(() =>
  !props.item.streaming && props.item.text.trim() === '' ? (props.item.questions ?? []) : [],
)
/** Block repeated presses until the transcript records the reply and disables the choices. */
const pressed = ref<string | null>(null)

function choose(question: AskedWithoutWaiting, option: string): void {
  if (pressed.value !== null) return
  const text = answerFor(choices.value, question, option)
  pressed.value = text
  emit('answer', text)
}

const displayedQuestions = computed(() =>
  questionsWithoutProse.value.length > 0
    ? questionsWithoutProse.value
    : props.canAnswer === true
      ? choices.value
      : [],
)
const showChoices = computed(() => props.canAnswer === true && choices.value.length > 0)

function choicesReading(question: AskedWithoutWaiting): QuestionCardReading {
  const choices = showChoices.value ? (question.options ?? []) : []
  return {
    requestId: null,
    asker: props.who ?? '',
    verb: 'asked',
    askedOf: '',
    piece: null,
    via: null,
    at: null,
    atTitle: null,
    words:
      questionsWithoutProse.value.length > 0 || displayedQuestions.value.length > 1
        ? question.title
        : null,
    wordsAreCut: false,
    wordsMissing: false,
    context: null,
    parts:
      choices.length === 0
        ? []
        : [
            {
              id: 'choice',
              header: null,
              prompt: null,
              multiSelect: false,
              typed: false,
              secret: false,
              options: choices.map((label) => ({ label, description: null })),
            },
          ],
    state: pressed.value === null ? 'open' : 'answered',
    answeredBy: null,
    answerable: showChoices.value && pressed.value === null,
    refused: null,
    note: null,
    receipt: null,
    where: null,
  }
}

function answer(question: AskedWithoutWaiting, response: UserInputResponse): void {
  if (response.kind !== 'answer') return
  const value = response.answers.choice
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'string') choose(question, first)
}

/** Distinct per message, so each choice group names the note that explains it. */
const noteId = computed(() => `asked-note-${props.item.id}`)
</script>

<template>
  <article
    class="msg assistant"
    :class="{ 'human-final': item.humanFinal }"
    :data-human-final="item.humanFinal ? 'true' : undefined"
  >
    <div class="msg-avatar">
      <svg class="icon"><use href="#i-bot" /></svg>
    </div>
    <div class="msg-column">
      <div class="msg-meta">
        <strong data-cy="assistant-author">{{ who || 'Assistant' }}</strong>
        <span v-if="item.humanFinal" class="final-label">Answer to you</span>
        <span v-if="item.streaming" class="live-tag" data-cy="streaming-tag">
          <span class="dot"></span>streaming
        </span>
        <!-- No clock while it is still being written: a time on an unfinished block reads as if
             the message had already landed. -->
        <span v-else class="time">{{ clockTime(item.at) }}</span>
      </div>
      <div
        class="msg-body"
        data-cy="assistant-message"
        :data-streaming="item.streaming ? 'true' : 'false'"
        :data-at="item.streaming ? '' : clockTime(item.at)"
        :title="item.streaming ? '' : fullTime(item.at)"
      >
        <template v-if="item.streaming"
          >{{ item.text }}<span class="stream-caret" aria-hidden="true"></span
        ></template>
        <MarkdownWords
          v-else
          data-cy="assistant-markdown"
          :text="item.text"
          :paths="props.paths"
          :documents="props.documents"
          @open-document="(resourceId) => emit('openDocument', resourceId)"
        />
      </div>
      <div
        v-if="displayedQuestions.length > 0"
        class="asked"
        :data-cy="showChoices ? 'asked-without-waiting' : undefined"
      >
        <p v-if="showChoices" :id="noteId" class="asked-note" data-cy="asked-note">
          {{ SENT_AS_A_MESSAGE }}
        </p>
        <QuestionCard
          v-for="(question, index) in displayedQuestions"
          :key="index"
          :reading="choicesReading(question)"
          :aria-label="question.title"
          :aria-describedby="showChoices ? noteId : undefined"
          role="group"
          compact
          choices-only
          @answer="(response) => answer(question, response)"
        />
        <p v-if="pressed !== null" class="asked-sent" data-cy="asked-pressed" aria-live="polite">
          {{ goesAsAMessage(pressed) }}
        </p>
      </div>
    </div>
  </article>
</template>

<style scoped src="./message-presentation.css"></style>

<style scoped>
.msg-body :deep(.open-the-document) {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.msg-body :deep(.open-the-document:hover),
.msg-body :deep(.open-the-document:focus-visible) {
  color: var(--accent-text-soft);
}

.asked {
  margin-top: var(--space-5);
}
.asked-note,
.asked-sent {
  color: var(--muted);
  font-size: var(--type-caption);
}
.live-tag {
  display: inline-flex;
  align-items: center;
  color: var(--accent-text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-2);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.live-tag .dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  animation: pulse 1.4s ease-in-out infinite;
  background: var(--accent);
  box-shadow: var(--accent-glow);
}

.msg-body {
  padding-top: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  overflow-wrap: anywhere;
}

.human-final .msg-column {
  background: var(--accent-2-mix-7);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}

.final-label {
  color: var(--text);
  font-size: var(--type-small);
}

/* Preserve streamed newlines without adding whitespace to rendered Markdown. */
.msg-body[data-streaming='true'] {
  white-space: pre-wrap;
}

.stream-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 1px;
  animation: blink 1s steps(1) infinite;
  background: var(--accent);
  vertical-align: -2px;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}
</style>
