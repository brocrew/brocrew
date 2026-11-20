<script setup lang="ts">
import { computed } from 'vue'
import type {
  ConversationTaskPageResult,
  ConversationTaskPageRow,
} from '../../../shared/conversation-task-page'
import { TASK_IS_OPEN } from '../../../shared/tasks'
import { agoWords, fullTime } from '../lib/clock'
import { useMinuteClock } from '../composables/useMinuteClock'
import { A_PERSON_ADDRESSED } from '../lib/outgoing-card'
import { ROWS_UNREAD_LEAD, unreadSays } from '../lib/rows-unread'
import { workReading } from '../lib/work-report'
import type { CastTask } from '../lib/working-together'
import CardEmpty from './CardEmpty.vue'
import TaskList from './TaskList.vue'

const props = defineProps<{
  page: Extract<ConversationTaskPageResult, { ok: true }> | null
  pending: boolean
  error: string | null
  known?: readonly CastTask[]
  canOpen: boolean
}>()
const emit = defineEmits<{ more: []; openConversation: [conversation: string] }>()
const knownTasks = computed(() => new Map(props.known?.map((one) => [one.piece.piece, one])))

function forList(row: ConversationTaskPageRow): CastTask[] {
  const state = row.state
  if (state === null) return []
  const known = knownTasks.value.get(row.piece)
  const related = known?.piece.from === row.giver ? known : undefined
  const name = related?.toName ?? (row.giver === null ? A_PERSON_ADDRESSED : 'An agent')
  const definitionOfDone = row.definitionOfDone ?? null
  return [
    {
      facets: related?.facets ?? null,
      toName: name,
      piece: {
        piece: row.piece,
        state,
        reading:
          related?.piece.state === state
            ? { ...related.piece.reading, definitionOfDone }
            : workReading({ label: row.label, state, definitionOfDone }),
        open: TASK_IS_OPEN[state],
        said: row.title ?? '',
        from: row.giver,
        fromName: name,
        given: agoWords(row.givenAt),
      },
    },
  ]
}

const current = computed(() => (props.page?.current ? forList(props.page.current) : []))
const root = computed(() => {
  const row = props.page?.current
  if (row?.kind !== 'root') return null
  return { label: row.label, title: row.title, definitionOfDone: row.definitionOfDone ?? null }
})
const briefs = computed(() => {
  const row = props.page?.current
  return row?.brief ? new Map([[row.label, row.brief]]) : undefined
})
const minute = useMinuteClock()
const other = computed(() => props.page?.other.flatMap(forList) ?? [])
const otherTotal = computed(() => {
  const counts = props.page?.counts
  if (!counts) return null
  return (
    counts.active + counts.open + counts.closed - (props.page?.current?.kind === 'held' ? 1 : 0)
  )
})
const moreCount = computed(() =>
  otherTotal.value === null ? 5 : Math.min(5, otherTotal.value - other.value.length),
)
const gaps = computed(() =>
  props.page ? unreadSays(props.page.rowsUnread, props.page.ledgersSkipped) : null,
)
const status = computed(() => props.page?.current?.statusLine ?? null)
</script>

<template>
  <p v-if="error" class="task-note" role="alert">{{ error }}</p>
  <p v-else-if="!page" class="task-note" role="status">Reading tasks…</p>
  <template v-if="page">
    <TaskList
      v-if="page.current"
      :key="page.current.piece"
      data-cy="cast-taken"
      mode="current"
      :tasks="current"
      :root="root"
      :briefs="briefs"
      :can-open="canOpen"
      @open-conversation="emit('openConversation', $event)"
    />
    <CardEmpty
      v-else-if="!gaps"
      icon="#i-check"
      says="No current task"
      hint="Work given to this agent appears here."
      data-cy="card-task-empty"
    />
    <details
      v-if="other.length"
      :key="page.conversation"
      class="task-other"
      data-cy="card-other-tasks"
    >
      <summary>
        Other tasks in this conversation
        <span v-if="otherTotal !== null">{{ otherTotal }}</span>
      </summary>
      <TaskList
        data-cy="cast-other"
        mode="other"
        :tasks="other"
        :can-open="canOpen"
        @open-conversation="emit('openConversation', $event)"
      />
      <button
        v-if="page.next"
        type="button"
        data-cy="card-other-tasks-more"
        :disabled="pending"
        @click="emit('more')"
      >
        Show {{ moreCount }} more<span v-if="otherTotal !== null">
          · {{ other.length }} of {{ otherTotal }}</span
        >
      </button>
    </details>
    <p
      v-if="page.counts && otherTotal !== null && otherTotal + current.length > 0"
      class="task-note"
      data-cy="card-task-counts"
    >
      {{ page.counts.active }} active · {{ page.counts.open }} open ·
      {{ page.counts.closed }} closed
    </p>
    <p v-if="gaps" class="task-note" data-cy="cast-taken-short">
      <strong>{{ ROWS_UNREAD_LEAD }}</strong> {{ gaps }}
    </p>
    <div v-if="status" class="task-status" data-cy="card-task-status">
      <h4>Latest status</h4>
      <time
        v-if="fullTime(status.at)"
        :title="fullTime(status.at)"
        :aria-label="fullTime(status.at)"
      >
        {{ agoWords(status.at, minute) }}
      </time>
      <p>{{ status.text }}</p>
    </div>
  </template>
</template>

<style scoped>
h4,
p {
  margin: 0;
}
h4 {
  font-size: var(--type-caption);
}
.task-note,
time {
  color: var(--muted);
  font-size: var(--type-caption);
}
.task-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: var(--space-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.task-status p {
  grid-column: 1 / -1;
  font-size: var(--type-caption);
}
.task-other summary {
  cursor: pointer;
  font-size: var(--type-caption);
}
.task-other summary span {
  margin-inline-start: var(--space-2);
  color: var(--muted);
}
.task-other button {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--text-soft);
  cursor: pointer;
  font: inherit;
}
</style>
