<script setup lang="ts">
import { computed, reactive } from 'vue'
import { LOOK, usePersonsQueue } from '../lib/persons-queue'
import { TAKE_BACK } from '../lib/take-back'
import { TODO_CANT, TODO_DONE, TODO_NOTE } from '../lib/work-waits'

/**
 * One of the three lists Waiting on you draws of work that waits on a person, needs a look, or is
 * being picked back up: the to-dos an agent asked of a person, answered here; the pieces no agent is
 * driving; and each recovery. One component, so the page and the corner draw each the same way. It
 * draws the list and its hole, never a heading: the page names it.
 */
const props = withDefaults(
  defineProps<{
    part: 'todos' | 'incidents' | 'recoveries'
    /** Whether this is the corner copy. */
    floating?: boolean
  }>(),
  { floating: false },
)

const queue = usePersonsQueue()
const waits = computed(() => queue.workWaits.value)
const cy = computed(() => (props.floating ? 'persons-queue' : 'waiting'))

/** The note typed on each to-do, by request id. */
const notes = reactive(new Map<string, string>())

/** The work list's cards, for the two parts that list pieces. */
const cards = computed(() => (props.part === 'todos' ? [] : queue.workCards.value[props.part]))
const workPart = computed(() => (props.part === 'recoveries' ? 'recoveries' : 'incidents'))

const unreadSays: Record<typeof props.part, string> = {
  todos:
    'The last look for what agents asked you to do did not answer, so some may not be shown here.',
  incidents:
    'The last look for work that needs you did not answer, so some, or work being picked back up, may not be shown here.',
  recoveries: '',
}

const unread = computed(() => waits.value[props.part].unread)
</script>

<template>
  <p v-if="unread" class="waits-unread" :class="{ floating }" :data-cy="`${cy}-${part}-unread`">
    {{ unreadSays[part] }}
  </p>
  <p
    v-if="waits[part].short"
    class="waits-unread"
    :class="{ floating }"
    :data-cy="`${cy}-${part}-short`"
  >
    {{ waits[part].short }}
  </p>
  <ol
    v-if="part === 'todos' && queue.todoCards.value.length > 0"
    class="waits"
    :class="{ floating }"
    :data-cy="`${cy}-todos`"
  >
    <li
      v-for="card in queue.todoCards.value"
      :key="card.row.key"
      class="wait"
      :class="{ settled: card.taken }"
      :data-cy="`${cy}-todo-${card.row.key}`"
    >
      <p class="wait-head" :data-cy="`${cy}-todo-head-${card.row.key}`">{{ card.row.head }}</p>
      <p class="wait-text" :data-cy="`${cy}-todo-text-${card.row.key}`">{{ card.row.text }}</p>
      <ul v-if="card.row.files.length > 0" class="wait-files">
        <li v-for="file in card.row.files" :key="file.resource">
          <span class="wait-file" :title="file.name">{{ file.name }}</span>
          <button
            type="button"
            :data-cy="`${cy}-todo-file-${card.row.key}-${file.resource}`"
            @click="queue.openFile(file.resource)"
          >
            Open
          </button>
        </li>
      </ul>
      <template v-if="card.listed && !card.taken">
        <textarea
          class="wait-note"
          rows="2"
          :placeholder="TODO_NOTE"
          :aria-label="TODO_NOTE"
          :disabled="card.pending"
          :value="notes.get(card.row.key) ?? ''"
          :data-cy="`${cy}-todo-note-${card.row.key}`"
          @input="notes.set(card.row.key, ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <div class="wait-controls">
          <button
            type="button"
            :disabled="card.pending"
            :data-cy="`${cy}-todo-done-${card.row.key}`"
            @click="queue.answerTodo(card.row, true, notes.get(card.row.key) ?? '')"
          >
            {{ TODO_DONE }}
          </button>
          <button
            type="button"
            :disabled="card.pending"
            :data-cy="`${cy}-todo-cant-${card.row.key}`"
            @click="queue.answerTodo(card.row, false, notes.get(card.row.key) ?? '')"
          >
            {{ TODO_CANT }}
          </button>
        </div>
      </template>
      <p
        v-if="card.said !== null"
        class="wait-said"
        role="status"
        :data-cy="`${cy}-todo-said-${card.row.key}`"
      >
        {{ card.said }}
      </p>
      <div v-if="!card.listed && !card.pending" class="wait-controls">
        <button
          type="button"
          :data-cy="`${cy}-todo-dismiss-${card.row.key}`"
          @click="queue.dismissTodo(card.row)"
        >
          Dismiss
        </button>
      </div>
    </li>
  </ol>
  <ol v-if="cards.length > 0" class="waits" :class="{ floating }" :data-cy="`${cy}-${part}`">
    <li
      v-for="{ entry: one, listed, pending, said } in cards"
      :key="one.key"
      class="wait"
      :class="{ settled: !listed }"
      :data-kind="one.kind"
      :data-cy="`${cy}-${part}-${one.key}`"
    >
      <p class="wait-says" :data-cy="`${cy}-${part}-says-${one.key}`">{{ one.says }}</p>
      <div v-if="listed || pending" class="wait-controls">
        <button
          v-if="listed"
          type="button"
          :data-cy="`${cy}-${part}-look-${one.key}`"
          @click="queue.openWork(one)"
        >
          {{ LOOK }}
          <svg class="icon"><use href="#i-arrow" /></svg>
        </button>
        <button
          v-if="one.mayTakeBack"
          type="button"
          :disabled="pending"
          :data-cy="`${cy}-${part}-take-back-${one.key}`"
          @click="queue.takeBackEntry(workPart, one)"
        >
          {{ TAKE_BACK }}
        </button>
      </div>
      <p
        v-if="said !== null"
        class="wait-said"
        role="status"
        :data-cy="`${cy}-${part}-said-${one.key}`"
      >
        {{ said }}
      </p>
      <div v-if="!listed && !pending" class="wait-controls">
        <button
          type="button"
          :data-cy="`${cy}-${part}-dismiss-${one.key}`"
          @click="queue.dismissEntry(workPart, one)"
        >
          Dismiss
        </button>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.waits-unread {
  margin: 0;
  padding: 0 var(--space-9) var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
}

.waits {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 var(--space-9) var(--space-5);
  gap: var(--space-3);
  list-style: none;
}

.wait {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  gap: var(--space-2);
}

.wait.settled {
  color: var(--muted);
}

.wait-head {
  margin: 0;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  overflow-wrap: anywhere;
}

.wait-text,
.wait-says,
.wait-said {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.wait-files {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  gap: var(--space-2);
  list-style: none;
}

.wait-files li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--type-caption);
}

.wait-file {
  min-width: 0;
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.wait-note {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font: inherit;
  font-size: var(--type-caption);
  resize: vertical;
}

.wait-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.wait-controls .icon {
  width: 10px;
  height: 10px;
}

.waits-unread.floating {
  padding: 0;
  line-height: var(--leading-tight);
}

.waits.floating {
  padding: 0;
  gap: var(--space-4);
}

.waits.floating .wait {
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
}
</style>
