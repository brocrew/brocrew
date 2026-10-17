<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { TranscriptState } from '../lib/transcript'
import type { CastTask } from '../lib/working-together'
import TaskList from './TaskList.vue'

/**
 * All tasks opens the scrollable history while the card keeps current work visible. List work oldest first, with the person's root first, and offer search, state filtering and a match count. Reuse `TaskList` so rows read the same in both places.
 */
const props = defineProps<{
  tasks: readonly CastTask[]
  root: WorkThatNamesIt | null
  canOpen: boolean
  /** Its transcript, for each piece's brief. */
  state: TranscriptState
}>()

const emit = defineEmits<{ close: []; openConversation: [conversation: string] }>()

type Filter = 'all' | 'active' | 'open' | 'closed'
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'all', label: 'All tasks' },
  { key: 'active', label: 'In progress' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
]
const filter = ref<Filter>('all')
const query = ref('')

const statusOf = (one: CastTask): Exclude<Filter, 'all'> =>
  !one.piece.open ? 'closed' : one.piece.state === 'working' ? 'active' : 'open'

const counts = computed(() => {
  const found = { all: props.tasks.length + (props.root ? 1 : 0), active: 0, open: 0, closed: 0 }
  for (const one of props.tasks) found[statusOf(one)] += 1
  // ⚑ The root a person gave is open for as long as its conversation is.
  if (props.root) found.open += 1
  return found
})

const matches = (text: string): boolean =>
  text.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())

const shownTasks = computed(() =>
  props.tasks.filter(
    (one) =>
      (filter.value === 'all' || statusOf(one) === filter.value) &&
      matches(`${one.piece.reading.heading} ${one.piece.said}`),
  ),
)
const shownRoot = computed(() =>
  props.root &&
  (filter.value === 'all' || filter.value === 'open') &&
  matches(`${props.root.label} ${props.root.title ?? ''}`)
    ? props.root
    : null,
)
const found = computed(() => shownTasks.value.length + (shownRoot.value ? 1 : 0))

/** ⚑ Each piece's brief, by its label — the words that gave it, newest winning. */
const briefs = computed(() => {
  const byLabel = new Map<string, string>()
  for (const item of props.state.items) {
    const label = item.kind === 'relayed' ? item.opened?.label : undefined
    if (label !== undefined && item.kind === 'relayed' && item.text.trim() !== '')
      byLabel.set(label, item.text.trim())
  }
  return byLabel
})
</script>

<template>
  <section class="list-dialog" aria-labelledby="all-tasks-title" data-cy="all-tasks-dialog">
    <header class="list-head">
      <h2 id="all-tasks-title" class="bb-title">All tasks</h2>
      <button
        class="bb-button bb-button--icon"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>
    <div class="list-body">
      <label class="list-search">
        <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>
        <input
          v-model="query"
          type="search"
          placeholder="Search tasks…"
          aria-label="Search all tasks"
          data-cy="all-tasks-search"
        />
      </label>
      <div class="list-filters" role="group" aria-label="Show tasks">
        <button
          v-for="one in FILTERS"
          :key="one.key"
          type="button"
          class="list-filter"
          :aria-pressed="filter === one.key"
          :data-cy="`all-tasks-filter-${one.key}`"
          @click="filter = one.key"
        >
          {{ one.label }} <span class="list-filter-count">{{ counts[one.key] }}</span>
        </button>
      </div>
      <p class="list-count" role="status" data-cy="all-tasks-count">
        {{ found }} {{ found === 1 ? 'task' : 'tasks' }}
      </p>
      <TaskList
        v-if="found > 0"
        data-cy="cast-taken"
        :tasks="shownTasks"
        :root="shownRoot"
        :can-open="props.canOpen"
        :briefs="briefs"
        mode="all"
        @open-conversation="(conversation) => emit('openConversation', conversation)"
      />
      <p v-else class="list-empty" data-cy="all-tasks-empty">No task matches this view.</p>
    </div>
  </section>
</template>

<style scoped>
.list-dialog {
  display: flex;
  width: min(560px, calc(100% - 2 * var(--lane-clear)));
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
}

.list-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--control-gap);
}

.list-head h2 {
  margin: 0;
}

.list-body {
  display: grid;
  min-height: 0;
  padding: var(--dialog-padding);
  overflow: auto;
  align-content: start;
  gap: var(--space-4);
  /* ⚑ F100 · each row as tall as its content, however many there are: the body scrolls instead. */
  grid-auto-rows: max-content;
}

.list-search {
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-md);
  color: var(--muted);
  gap: var(--space-3);
}

.list-search:focus-within {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.list-search .icon {
  width: 13px;
  height: 13px;
  flex: none;
}

.list-search input {
  min-width: 0;
  flex: 1;
  padding: var(--space-3) 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--type-small);
  outline: none;
}

.list-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.list-filter {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--type-small);
  gap: var(--space-2);
}

.list-filter[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent-mix-10);
  color: var(--accent-text);
}

.list-filter-count {
  color: var(--muted);
}

.list-count,
.list-empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
