<script setup lang="ts">
import { ref } from 'vue'
import { usePersonsQueue, type TodoCard } from '../lib/persons-queue'
import { TODO_CANT, TODO_DONE, TODO_NOTE } from '../lib/work-waits'

withDefaults(
  defineProps<{
    card: TodoCard
    cy: string
    canAnswer?: boolean
    openConversation?: boolean
  }>(),
  { canAnswer: true, openConversation: false },
)
const queue = usePersonsQueue()
const note = ref('')
</script>

<template>
  <div class="todo" :class="{ settled: card.taken }" :data-cy="`${cy}-todo-${card.row.key}`">
    <p class="todo-head" :data-cy="`${cy}-todo-head-${card.row.key}`">{{ card.row.head }}</p>
    <p class="todo-text" :data-cy="`${cy}-todo-text-${card.row.key}`">{{ card.row.text }}</p>
    <ul v-if="card.row.files.length" class="todo-files">
      <li v-for="file in card.row.files" :key="file.resource">
        <span :title="file.name">{{ file.name }}</span>
        <button
          type="button"
          :data-cy="`${cy}-todo-file-${card.row.key}-${file.resource}`"
          @click="queue.openFile(file.resource)"
        >
          Open
        </button>
      </li>
    </ul>
    <template v-if="canAnswer && card.listed && !card.taken">
      <textarea
        v-model="note"
        class="todo-note"
        rows="2"
        :placeholder="TODO_NOTE"
        :aria-label="TODO_NOTE"
        :disabled="card.pending"
        :data-cy="`${cy}-todo-note-${card.row.key}`"
      ></textarea>
      <div class="todo-controls">
        <button
          type="button"
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
      </div>
    </template>
    <p
      v-if="card.said !== null"
      class="todo-said"
      role="status"
      :data-cy="`${cy}-todo-said-${card.row.key}`"
    >
      {{ card.said }}
    </p>
    <div v-if="openConversation" class="todo-controls">
      <button
        type="button"
        :data-cy="`${cy}-todo-open-${card.row.key}`"
        @click="queue.openWork(card.row)"
      >
        Open the conversation
      </button>
    </div>
    <div v-if="!card.listed && !card.pending && cy !== 'inline'" class="todo-controls">
      <button
        type="button"
        :data-cy="`${cy}-todo-dismiss-${card.row.key}`"
        @click="queue.dismissTodo(card.row)"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>

<style scoped>
.todo {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}
.todo.settled {
  color: var(--muted);
}
.todo-head {
  margin: 0;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  overflow-wrap: anywhere;
}
.todo-text {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.todo-said {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.todo-files {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  gap: var(--space-2);
  list-style: none;
}
.todo-files li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--type-caption);
}
.todo-files span {
  min-width: 0;
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
.todo-note {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font: inherit;
  font-size: var(--type-reading);
  resize: vertical;
}
.todo-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
</style>
