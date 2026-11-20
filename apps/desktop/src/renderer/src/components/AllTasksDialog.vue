<script setup lang="ts">
import ListDialogShell from './ListDialogShell.vue'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type {
  AllConversationTasksResult,
  AllTasksFilter,
} from '../../../shared/conversation-task-page'
import type { AgentIdentity } from '../../../shared/runtime-ipc'
import type { TaskPageSource } from '../composables/useConversationTaskPage'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type { TranscriptState } from '../lib/transcript'
import { taskGivenToThisOne, type CastCard, type CastTask } from '../lib/working-together'
import { ROWS_UNREAD_LEAD, unreadSays } from '../lib/rows-unread'
import { briefsOf } from '../lib/piece-briefs'
import TaskList from './TaskList.vue'

/**
 * All tasks opens the scrollable history while the card keeps current work visible. List work oldest first, with the person's root first, and offer search, state filtering and a match count. Reuse `TaskList` so rows read the same in both places.
 */
const props = defineProps<{
  tasks: readonly CastTask[]
  root: WorkThatNamesIt | null
  canOpen: boolean
  conversation?: string
  source?: TaskPageSource
  parent?: CastCard | null
  identities?: readonly AgentIdentity[] | null
  /** Its transcript, for each piece's brief. */
  state: TranscriptState
}>()

const emit = defineEmits<{ close: []; openConversation: [conversation: string] }>()

const FILTERS: readonly { key: AllTasksFilter; label: string }[] = [
  { key: 'all', label: 'All tasks' },
  { key: 'active', label: 'In progress' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
]
const filter = ref<AllTasksFilter>('all')
const query = ref('')

const statusOf = (one: CastTask): Exclude<AllTasksFilter, 'all'> =>
  !one.piece.open ? 'closed' : one.piece.state === 'working' ? 'active' : 'open'

const localCounts = computed(() => {
  const found = { all: props.tasks.length + (props.root ? 1 : 0), active: 0, open: 0, closed: 0 }
  for (const one of props.tasks) found[statusOf(one)] += 1
  // ⚑ The root a person gave is open for as long as its conversation is.
  if (props.root) found.open += 1
  return found
})

const matches = (text: string): boolean =>
  text.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())

const localTasks = computed(() =>
  props.tasks.filter(
    (one) =>
      (filter.value === 'all' || statusOf(one) === filter.value) &&
      matches(`${one.piece.reading.heading} ${one.piece.said}`),
  ),
)
const localRoot = computed(() =>
  props.root &&
  (filter.value === 'all' || filter.value === 'open') &&
  matches(`${props.root.label} ${props.root.title ?? ''}`)
    ? props.root
    : null,
)
type TaskPage = Extract<AllConversationTasksResult, { ok: true }>
const page = shallowRef<TaskPage | null>(null)
const pending = ref(false)
const failed = ref(false)
const paged = computed(() => props.source?.readAll !== undefined)
const text = computed(() => query.value.trim())
let request = 0

async function read(cursor?: string): Promise<void> {
  const reader = props.source?.readAll
  const sessionId = props.conversation
  if (!reader || !sessionId) return
  const mine = ++request
  pending.value = true
  failed.value = false
  try {
    const result = await reader({
      sessionId,
      filter: filter.value,
      ...(text.value ? { text: text.value } : {}),
      ...(cursor === undefined ? {} : { cursor }),
    })
    if (mine !== request) return
    if (!result.ok) {
      if (result.reason === 'invalid-cursor' && cursor !== undefined) {
        page.value = null
        await read()
      } else {
        failed.value = true
      }
      return
    }
    if (result.conversation !== sessionId) {
      failed.value = true
      return
    }
    const previous = cursor === undefined ? null : page.value
    page.value = previous
      ? { ...result, root: previous.root, tasks: [...previous.tasks, ...result.tasks] }
      : result
  } catch {
    if (mine === request) failed.value = true
  } finally {
    if (mine === request) pending.value = false
  }
}

watch(
  [
    () => props.conversation,
    () => props.source?.readAll,
    () => props.source?.revision,
    filter,
    text,
  ],
  () => {
    request++
    page.value = null
    pending.value = false
    failed.value = false
    void read()
  },
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => {
  request++
})

const shownTasks = computed(() => {
  if (!paged.value) return localTasks.value
  const at = Date.now()
  return (
    page.value?.tasks.map((row) =>
      taskGivenToThisOne(row, props.identities ?? null, props.parent ?? null, at),
    ) ?? []
  )
})
const shownRoot = computed(() => (paged.value ? (page.value?.root ?? null) : localRoot.value))
const shown = computed(() => shownTasks.value.length + Number(shownRoot.value !== null))
const counts = computed(() => (paged.value ? page.value?.counts : localCounts.value))
const found = computed(() => (paged.value ? page.value?.matched : shown.value))
const gaps = computed(() =>
  page.value ? unreadSays(page.value.rowsUnread, page.value.ledgersSkipped) : null,
)

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
          {{ one.label }}
          <span v-if="counts" class="list-filter-count">{{ counts[one.key] }}</span>
        </button>
      </div>
      <p
        v-if="found != null && (!paged || found > 0)"
        class="list-count"
        role="status"
        data-cy="all-tasks-count"
      >
        <template v-if="paged">{{ shown }} of </template>{{ found }}
        {{ found === 1 ? 'task' : 'tasks' }}
      </p>
      <p
        v-else-if="page && found == null"
        class="list-count"
        role="status"
        data-cy="all-tasks-count"
      >
        {{ shown }} {{ shown === 1 ? 'task' : 'tasks' }} shown
      </p>
    </template>
    <template #results>
      <p v-if="pending && !page" class="list-count" role="status">Reading tasks…</p>
      <p v-if="failed" class="list-count" role="alert">Could not read this conversation’s tasks.</p>
      <TaskList
        v-if="shown > 0"
        data-cy="cast-taken"
        :tasks="shownTasks"
        :root="shownRoot"
        :current-piece="page?.newestOpenMatch"
        :can-open="props.canOpen"
        :briefs="briefs"
        mode="all"
        @open-conversation="(conversation) => emit('openConversation', conversation)"
      />
      <p v-else-if="found === 0" class="list-empty" data-cy="all-tasks-empty">
        No task matches this view.
      </p>
      <p v-if="gaps" class="list-count" data-cy="all-tasks-unread">
        {{ ROWS_UNREAD_LEAD }}. {{ gaps }}
      </p>
      <button
        v-if="page?.next || (failed && !page)"
        type="button"
        class="bb-button"
        data-cy="all-tasks-more"
        :disabled="pending"
        @click="read(page?.next ?? undefined)"
      >
        {{
          failed && !page
            ? 'Try again'
            : found == null
              ? 'Show more'
              : `Show ${Math.min(20, found - shown)} more`
        }}
      </button>
    </template>
  </ListDialogShell>
</template>
