<script setup lang="ts">
import ListDialogShell from './ListDialogShell.vue'
import { computed, ref } from 'vue'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { TranscriptState } from '../lib/transcript'
import type { CastTask } from '../lib/working-together'
import { briefsOf } from '../lib/piece-briefs'
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

const briefs = computed(() => briefsOf(props.state))
</script>

<template>
  <ListDialogShell title-id="all-tasks-title" data-cy="all-tasks-dialog" @close="emit('close')">
    <template #title>All tasks</template>
    <template #search>
      <input
        v-model="query"
        type="search"
        placeholder="Search tasks…"
        aria-label="Search all tasks"
        data-cy="all-tasks-search"
      />
    </template>
    <template #controls>
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
    </template>
    <template #results>
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
    </template>
  </ListDialogShell>
</template>
