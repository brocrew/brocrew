<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  libraryUnavailable,
  type LibraryTask,
  type FilesLibraryResult,
  type LibraryUnavailable,
} from '../../../shared/files-library'
import { libraryFailureSays, type LibraryApi } from '../composables/useFilesLibrary'
import OverlayHost from './OverlayHost.vue'

const props = withDefaults(
  defineProps<{
    read: LibraryApi
    includeSubtasks: boolean
    canRetry?: boolean
    mutationVersion?: number
  }>(),
  { canRetry: true, mutationVersion: 0 },
)
const emit = defineEmits<{
  close: []
  choose: [task: LibraryTask, includeSubtasks: boolean]
  unavailable: [failure: LibraryUnavailable]
}>()
const query = ref(''),
  parent = ref<string | null>(null),
  parentName = ref('All root tasks')
const depth = ref(props.includeSubtasks),
  selected = shallowRef<LibraryTask | null>(null)
const result = shallowRef<Extract<FilesLibraryResult, { type: 'tasks' }> | null>(null)
const failure = ref<string | null>(null),
  busy = ref(false)
let generation = 0,
  timer: ReturnType<typeof setTimeout> | undefined
async function readTasks(more = false): Promise<void> {
  if (!props.canRetry) {
    failure.value = libraryFailureSays(libraryUnavailable('busy'))
    return
  }
  const current = ++generation,
    before = result.value,
    mutation = props.mutationVersion
  busy.value = true
  failure.value = null
  const answer = await props.read({
    operation: 'tasks',
    query: query.value,
    parent: parent.value,
    ...(more && before?.next ? { cursor: before.next } : {}),
  })
  if (current !== generation) return
  busy.value = false
  if (answer.type === 'tasks' && more && before !== null && answer.snapshot !== before.snapshot) {
    failure.value = libraryFailureSays(libraryUnavailable('invalid-cursor'))
    result.value = { ...before, stale: true }
  } else if (answer.type === 'tasks')
    result.value = {
      ...answer,
      stale:
        answer.stale ||
        (more && (before?.stale === true || result.value?.stale === true)) ||
        mutation !== props.mutationVersion,
      tasks: more && before !== null ? [...before.tasks, ...answer.tasks] : answer.tasks,
    }
  else if (answer.type === 'unavailable') {
    failure.value = libraryFailureSays(answer)
    emit('unavailable', answer)
  } else {
    failure.value = 'These tasks could not be read. Retry to read them again.'
  }
}
function browse(task: LibraryTask): void {
  parent.value = task.id
  parentName.value = `${task.label} · ${task.title ?? 'Untitled'}`
  query.value = ''
  selected.value = null
}
function roots(): void {
  parent.value = null
  parentName.value = 'All root tasks'
}
watch([query, parent], () => {
  generation++
  result.value = null
  selected.value = null
  clearTimeout(timer)
  timer = setTimeout(() => void readTasks(), 140)
})
watch(
  () => props.mutationVersion,
  () => {
    if (result.value !== null) result.value = { ...result.value, stale: true }
  },
)
onMounted(() => void readTasks())
onUnmounted(() => {
  generation++
  clearTimeout(timer)
})
</script>

<template>
  <OverlayHost label="Choose a task" @close="emit('close')">
    <section class="task-picker" data-cy="files-task-picker">
      <header>
        <h2>Choose a task</h2>
        <button type="button" aria-label="Close task picker" @click="emit('close')">
          <svg class="icon"><use href="#i-x" /></svg>
        </button>
      </header>
      <div class="picker-body">
        <label
          >Search tasks<input
            v-model="query"
            type="search"
            maxlength="200"
            data-cy="files-task-search"
            placeholder="Task label or current title"
        /></label>
        <div class="location">
          <button type="button" @click="roots">All roots</button><span>{{ parentName }}</span>
        </div>
        <p v-if="busy && result === null" role="status">Reading tasks…</p>
        <p v-if="failure" role="status" data-cy="files-task-error">
          {{ failure }}
          <button
            type="button"
            :disabled="busy || !props.canRetry"
            data-cy="files-task-retry"
            @click="readTasks()"
          >
            Retry
          </button>
        </p>
        <template v-if="result">
          <p class="count">
            {{ result.tasks.length }} of {{ result.total }} tasks<span v-if="result.stale">
              · Earlier reading — refresh before choosing</span
            >
          </p>
          <button
            v-if="result.stale"
            type="button"
            :disabled="busy || !props.canRetry"
            @click="readTasks()"
          >
            Refresh tasks
          </button>
          <ul>
            <li v-for="task in result.tasks" :key="task.id">
              <button
                type="button"
                class="task"
                :aria-pressed="selected?.id === task.id"
                data-cy="files-task-option"
                :data-task="task.id"
                @click="selected = task"
              >
                <strong>{{ task.label }} · {{ task.title ?? 'Untitled' }}</strong
                ><span>{{ task.breadcrumb }}</span
                ><small v-if="task.clipped">Some display details are shortened.</small>
              </button>
              <button
                v-if="task.children > 0"
                type="button"
                class="children"
                :aria-label="`Browse ${task.children} subtasks of ${task.label}`"
                @click="browse(task)"
              >
                {{ task.children }} subtasks <span aria-hidden="true">›</span>
              </button>
            </li>
          </ul>
          <p v-if="result.total === 0">No tasks match this view.</p>
          <button
            v-if="result.next"
            type="button"
            :disabled="busy || !props.canRetry"
            data-cy="files-task-more"
            @click="readTasks(true)"
          >
            Load more tasks
          </button>
        </template>
      </div>
      <footer>
        <label
          ><input v-model="depth" type="checkbox" data-cy="files-task-depth" /> Include
          subtasks</label
        >
        <div>
          <button type="button" data-cy="files-task-cancel" @click="emit('close')">Cancel</button
          ><button
            type="button"
            data-cy="files-task-use"
            :disabled="selected === null || result?.stale || busy"
            @click="selected && emit('choose', selected, depth)"
          >
            Use task
          </button>
        </div>
      </footer>
    </section>
  </OverlayHost>
</template>

<style scoped>
.task-picker {
  display: flex;
  flex-direction: column;
  width: min(620px, 94vw);
  max-height: 82dvh;
  min-height: 200px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  color: var(--text);
  font-size: 14px;
}
header,
footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--line);
}
h2 {
  font-size: 18px;
  margin: 0;
}
button,
input {
  font: inherit;
  color: inherit;
}
button {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 7px 10px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
button[aria-pressed='true'] {
  background: var(--accent-fill);
  border-color: var(--accent);
}
.picker-body {
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: grid;
  gap: 12px;
}
label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
input[type='search'] {
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
}
.location {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}
.location span {
  overflow-wrap: anywhere;
}
.count,
p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
li {
  display: flex;
  min-width: 0;
  gap: 6px;
  align-items: stretch;
}
.task {
  display: grid;
  gap: 5px;
  text-align: start;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.task span,
.task small {
  font-size: 13px;
  color: var(--muted);
}
.children {
  flex: none;
  font-size: 13px;
  max-width: 105px;
}
footer {
  border-top: 1px solid var(--line);
  border-bottom: 0;
  flex-wrap: wrap;
}
footer div {
  display: flex;
  gap: 8px;
}
</style>
