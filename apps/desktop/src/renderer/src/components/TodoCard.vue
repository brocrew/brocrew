<script setup lang="ts">
/**
 * A to-do an agent asked of a person: who asks, the one thing to do, then every button on one line.
 * Longer words fold behind "Show more", and the note box opens only when asked for. Once answered,
 * the card shrinks to one line where it was. The same card on Waiting on you, in the corner and in
 * the conversation that asked.
 */
import { computed, ref } from 'vue'
import { usePersonsQueue, type TodoCard } from '../lib/persons-queue'
import { TODO_CANT, TODO_DONE, TODO_NOTE } from '../lib/work-waits'
import { legacyQuestionFiles } from '../lib/legacy-question-files'
import { cardLead } from '../lib/card-lead'
import FileRows from './FileRows.vue'
import MarkdownWords from './MarkdownWords.vue'

const props = withDefaults(
  defineProps<{
    card: TodoCard
    cy: string
    canAnswer?: boolean
    openConversation?: boolean
  }>(),
  { canAnswer: true, openConversation: false },
)
const emit = defineEmits<{ open: [] }>()
const queue = usePersonsQueue()
const note = ref('')
const noting = ref(false)
const open = ref(false)
const text = computed(() => legacyQuestionFiles(props.card.row.text, props.card.row.files).text)
const words = computed(() => cardLead(text.value))
/** Words longer than two short lines fold, so every card reads in a glance. */
const foldable = computed(() => words.value.rest.length > 160 || words.value.rest.includes('\n'))
/** An answered card is one line; the corner keeps its own way to put it away. */
const answeredLine = computed(() => props.card.taken && !props.card.pending)
const answerable = computed(() => props.canAnswer && props.card.listed && !props.card.taken)
</script>

<template>
  <div
    class="todo"
    :class="{ settled: card.taken, answered: answeredLine }"
    :data-cy="`${cy}-todo-${card.row.key}`"
  >
    <div v-if="answeredLine" class="todo-answered">
      <span
        class="todo-what"
        :title="words.lead || text"
        :data-cy="`${cy}-todo-lead-${card.row.key}`"
        >{{ words.lead || text }}</span
      >
      <span
        v-if="card.said !== null"
        class="todo-said"
        role="status"
        :data-cy="`${cy}-todo-said-${card.row.key}`"
      >
        <svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>{{ card.said }}
      </span>
      <span class="todo-spacer"></span>
      <button
        v-if="!card.listed && cy === 'persons-queue'"
        type="button"
        class="todo-quiet"
        :data-cy="`${cy}-todo-dismiss-${card.row.key}`"
        @click="queue.dismissTodo(card.row)"
      >
        Dismiss
      </button>
      <button
        v-if="openConversation"
        type="button"
        class="todo-door"
        :data-cy="`${cy}-todo-open-${card.row.key}`"
        @click="emit('open')"
      >
        Open the conversation
        <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
      </button>
    </div>
    <template v-else>
      <p class="todo-head" :data-cy="`${cy}-todo-head-${card.row.key}`">{{ card.row.head }}</p>
      <MarkdownWords
        v-if="words.lead"
        class="todo-lead"
        :data-cy="`${cy}-todo-lead-${card.row.key}`"
        :text="words.lead"
        :session-id="card.row.sessionId"
      />
      <MarkdownWords
        v-if="words.rest"
        class="todo-text"
        :class="{ folded: foldable && !open }"
        :data-cy="`${cy}-todo-text-${card.row.key}`"
        :text="words.rest"
        :session-id="card.row.sessionId"
      />
      <div v-if="foldable || card.row.files.length > 0" class="todo-fold">
        <button
          v-if="foldable"
          type="button"
          class="todo-more"
          :aria-expanded="open"
          :data-cy="`${cy}-todo-more-${card.row.key}`"
          @click="open = !open"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-chevron" /></svg>
          {{ open ? 'Show less' : 'Show more' }}
        </button>
        <FileRows :files="card.row.files" can-open @open-document="queue.openFile" />
      </div>
      <textarea
        v-if="answerable && noting"
        v-model="note"
        class="todo-note"
        rows="2"
        :placeholder="TODO_NOTE"
        :aria-label="TODO_NOTE"
        :disabled="card.pending"
        :data-cy="`${cy}-todo-note-${card.row.key}`"
      ></textarea>
      <p
        v-if="card.said !== null"
        class="todo-said-line"
        role="status"
        :data-cy="`${cy}-todo-said-${card.row.key}`"
      >
        {{ card.said }}
      </p>
      <div v-if="answerable || openConversation" class="todo-controls">
        <template v-if="answerable">
          <button
            type="button"
            class="todo-done"
            :disabled="card.pending"
            :data-cy="`${cy}-todo-done-${card.row.key}`"
            @click="queue.answerTodo(card.row, true, note)"
          >
            {{ TODO_DONE }}
          </button>
          <button
            type="button"
            :disabled="card.pending"
            :data-cy="`${cy}-todo-cant-${card.row.key}`"
            @click="queue.answerTodo(card.row, false, note)"
          >
            {{ TODO_CANT }}
          </button>
          <button
            type="button"
            class="todo-quiet"
            :aria-expanded="noting"
            :data-cy="`${cy}-todo-add-note-${card.row.key}`"
            @click="noting = !noting"
          >
            Add a note
          </button>
        </template>
        <span class="todo-spacer"></span>
        <button
          v-if="openConversation"
          type="button"
          class="todo-door"
          :data-cy="`${cy}-todo-open-${card.row.key}`"
          @click="emit('open')"
        >
          Open the conversation
          <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.todo {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
  container: todo / inline-size;
}

.todo-head {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}

.todo-lead {
  margin: 0;
  color: var(--text);
  font-size: var(--type-heading);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-snug);
  overflow-wrap: anywhere;
}

.todo-text {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}

/* Two lines, then "Show more": the whole words are one press away. */
.todo-text.folded {
  display: -webkit-box;
  overflow: clip;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.todo-fold {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-6);
}

/* A to-do's files read as chips on one row, beside "Show more". */
.todo-fold :deep(.file-rows) {
  flex-direction: row;
  flex-wrap: wrap;
  margin: 0;
}

.todo-fold :deep(.file-row) {
  width: auto;
}

.todo-more {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-3) 0 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  gap: var(--space-2);
}

.todo-more .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  transform: rotate(-90deg);
}

.todo-more[aria-expanded='true'] .icon {
  transform: none;
}

.todo-note {
  width: 100%;
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: var(--type-reading);
  resize: vertical;
}

.todo-said-line {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
}

/* Every button on one line: the answers on the left, the way to the conversation on the right. */
.todo-controls {
  display: flex;
  align-items: center;
  margin-top: var(--space-2);
  gap: var(--space-4);
}

.todo-controls > button {
  display: inline-flex;
  min-height: var(--control-h);
  flex: none;
  align-items: center;
  padding: 0 var(--space-7);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: var(--type-body);
  font-weight: var(--fw-medium);
  cursor: pointer;
}

.todo-controls > button:hover:not(:disabled) {
  border-color: var(--accent-border);
  background: var(--accent-fill);
}

.todo-controls > .todo-done {
  border-color: var(--accent-solid-bg);
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
  font-weight: var(--fw-semibold);
}

.todo-controls > .todo-done:hover:not(:disabled) {
  border-color: var(--accent-solid-bg);
  background: var(--accent-solid-bg);
  filter: brightness(0.92);
}

.todo-controls > .todo-quiet,
.todo-answered > .todo-quiet {
  padding: 0 var(--space-3);
  border-color: transparent;
  background: none;
  color: var(--text-soft);
}

.todo-spacer {
  min-width: var(--space-4);
  flex: 1;
}

.todo-controls > .todo-door,
.todo-answered > .todo-door {
  display: inline-flex;
  min-height: var(--control-h);
  flex: none;
  align-items: center;
  padding: 0 var(--space-2) 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--accent-2-text);
  font: inherit;
  font-size: var(--type-body);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  gap: var(--space-3);
}

.todo-controls > .todo-door:hover,
.todo-answered > .todo-door:hover {
  background: var(--accent-2-mix-7);
}

.todo-door .icon,
.todo-said .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

/* In a narrow corner the door keeps its line by dropping its words to one. */
@container todo (max-width: 470px) {
  .todo-controls {
    flex-wrap: wrap;
  }
}

/* Answered: one line, where it was, until the person puts it away. */
.todo-answered {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-6);
}

.todo-what {
  overflow: hidden;
  min-width: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  font-weight: var(--fw-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-said {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: var(--space-1) var(--space-5);
  border: var(--border-width) solid var(--success-border);
  border-radius: var(--radius-pill);
  background: var(--success-bg);
  color: var(--success-text);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: var(--space-2);
}
</style>
