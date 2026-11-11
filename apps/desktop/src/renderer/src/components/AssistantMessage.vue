<script setup lang="ts">
import { computed, ref } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import MarkdownWords from './MarkdownWords.vue'
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
        v-if="questionsWithoutProse.length > 0"
        class="msg-body"
        data-cy="structured-question-text"
      >
        <p v-for="(question, index) in questionsWithoutProse" :key="index">{{ question.title }}</p>
      </div>
      <!-- The message lists the choices; these controls send the chosen words. -->
      <div
        v-if="props.canAnswer === true && choices.length > 0"
        class="asked"
        data-cy="asked-without-waiting"
      >
        <p :id="noteId" class="asked-note" data-cy="asked-note">{{ SENT_AS_A_MESSAGE }}</p>
        <div
          v-for="(question, at) in choices"
          :key="at"
          class="asked-question"
          role="group"
          :aria-label="question.title"
          :aria-describedby="noteId"
        >
          <span
            v-if="choices.length > 1 && questionsWithoutProse.length === 0"
            class="asked-title"
            >{{ question.title }}</span
          >
          <button
            v-for="(option, index) in question.options"
            :key="index"
            type="button"
            class="asked-choice"
            data-cy="asked-choice"
            title="Sends this as a message"
            :disabled="pressed !== null"
            @click="choose(question, option)"
          >
            {{ option }}
          </button>
        </div>
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
.asked-question {
  display: flex;
  flex-wrap: wrap;
  margin-top: var(--space-5);
  gap: var(--space-5);
  align-items: center;
}
.asked-title {
  color: var(--text-soft);
  font-size: var(--type-caption);
}
.asked-choice {
  padding: var(--space-1) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: none;
  color: inherit;
  font: inherit;
  font-size: var(--type-small);
  cursor: pointer;
}
.asked-choice:hover:not(:disabled),
.asked-choice:focus-visible {
  border-color: var(--accent);
}
.asked-choice:disabled {
  cursor: default;
  opacity: 0.6;
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
