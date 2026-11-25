<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { fullTime } from '../lib/clock'
import {
  useFilesLibrary,
  libraryFailureSays,
  type FilesLibraryController,
} from '../composables/useFilesLibrary'
import { useModalDepth } from './OverlayHost.vue'
import FilesTaskPicker from './FilesTaskPicker.vue'
import FileRows from './FileRows.vue'

const props = withDefaults(
  defineProps<{ controller?: FilesLibraryController; canOpen?: boolean; active?: boolean }>(),
  { canOpen: true, active: true },
)
const library = props.controller ?? useFilesLibrary()
const picker = ref(false),
  scroller = ref<HTMLElement | null>(null)
const modalDepth = useModalDepth()
const groups = computed(() => library?.page.value?.files ?? [])
const files = computed(() => groups.value.map((group) => group.file))
const matchingKeeps = computed(
  () => new Map(groups.value.map((group) => [group.file.resourceId, group.matchingKeeps])),
)
function openFile(resourceId: string, opener: HTMLElement): void {
  const file = files.value.find((one) => one.resourceId === resourceId)
  if (file) library?.open(file, opener)
}
const kinds = [
  ['all', 'All kinds'],
  ['documents', 'Documents'],
  ['images', 'Images'],
] as const
const roles = [
  ['all', 'All roles'],
  ['made', 'Made'],
  ['input', 'Inputs'],
] as const
const countSuffix = computed(() => (library?.page.value?.complete === false ? '+' : ''))
function onScroll(): void {
  if (!props.active || !library || !scroller.value) return
  const element = scroller.value
  library.state.scrollTop = element.scrollTop
  if (
    !library.page.value?.stale &&
    element.scrollHeight - element.clientHeight - element.scrollTop < 160
  )
    void library.more()
}
const currentScope = computed(() => library?.state.scope.type ?? 'workspace')
watch(
  () => library?.workspaceVersion.value,
  () => {
    picker.value = false
  },
)
function onKey(event: KeyboardEvent): void {
  if (
    !props.active ||
    event.key !== '/' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    modalDepth.value > 0
  )
    return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable=true]')
  )
    return
  event.preventDefault()
  library?.searchElement.value?.focus()
}
async function view(value: 'icons' | 'list'): Promise<void> {
  if (library === null) return
  const top = scroller.value?.getBoundingClientRect().top ?? 0
  const anchor = [...(scroller.value?.querySelectorAll<HTMLElement>('[data-hash]') ?? [])].find(
    (element) => element.getBoundingClientRect().bottom > top,
  )?.dataset.hash
  library.state.view = value
  await nextTick()
  if (anchor !== undefined)
    scroller.value
      ?.querySelector<HTMLElement>(`[data-hash="${CSS.escape(anchor)}"]`)
      ?.scrollIntoView({ block: 'start' })
}
watch(
  () => library?.state.scrollVersion,
  async () => {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = 0
  },
)
watch(
  () => props.active,
  async (active) => {
    if (!active) return
    library?.ensure()
    await nextTick()
    if (scroller.value && library) scroller.value.scrollTop = library.state.scrollTop
  },
)
watch(picker, (open) => {
  if (!open) library?.ensure()
})
onMounted(() => {
  if (props.active) library?.ensure()
  if (scroller.value && library) scroller.value.scrollTop = library.state.scrollTop
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="files-library" data-cy="files-library">
    <template v-if="library">
      <header class="compact-toolbar">
        <div class="toolbar-row scope-row">
          <div class="scope-buttons" role="group" aria-label="Files on work">
            <button
              type="button"
              :aria-pressed="currentScope === 'workspace'"
              data-cy="files-scope-workspace"
              @click="library.all()"
            >
              All workspace
            </button>
            <button
              type="button"
              class="scope-conversation"
              :title="
                currentScope === 'conversationWork'
                  ? library.state.scopeName
                  : 'Work held or given by the selected conversation'
              "
              :aria-pressed="currentScope === 'conversationWork'"
              :disabled="library.selected.value === null && currentScope !== 'conversationWork'"
              data-cy="files-scope-conversation"
              @click="currentScope !== 'conversationWork' && library.pinSelected()"
            >
              {{
                currentScope === 'conversationWork' ? library.state.scopeName : 'This conversation'
              }}
            </button>
            <button
              type="button"
              class="scope-task"
              :title="currentScope === 'task' ? library.state.scopeName : 'Choose any task'"
              :aria-pressed="currentScope === 'task'"
              data-cy="files-scope-task"
              :disabled="!library.canRetry.value"
              @click="picker = true"
            >
              {{ currentScope === 'task' ? library.state.scopeName : 'Choose task…' }}
            </button>
          </div>
          <button
            v-if="currentScope === 'conversationWork'"
            type="button"
            :disabled="library.selected.value === null"
            data-cy="files-use-selected"
            @click="library.pinSelected()"
          >
            Use selected
          </button>
          <label class="depth"
            ><input
              type="checkbox"
              data-cy="files-depth"
              :checked="currentScope === 'workspace' || library.state.includeSubtasks"
              :disabled="currentScope === 'workspace'"
              @change="library.state.includeSubtasks = ($event.target as HTMLInputElement).checked"
            />
            Include subtasks <span v-if="currentScope === 'workspace'">· All included</span></label
          >
          <div class="view-switch" role="group" aria-label="File view">
            <button
              v-for="one in ['icons', 'list'] as const"
              :key="one"
              type="button"
              :aria-pressed="library.state.view === one"
              :data-cy="`files-view-${one}`"
              @click="view(one)"
            >
              {{ one === 'icons' ? 'Icons' : 'List' }}
            </button>
          </div>
          <button type="button" data-cy="files-reset" @click="library.reset()">Reset</button>
        </div>
        <div class="toolbar-row filter-row">
          <label class="search"
            ><svg class="icon" aria-hidden="true"><use href="#i-search" /></svg
            ><input
              :ref="
                (element) => {
                  library!.searchElement.value = element as HTMLInputElement | null
                }
              "
              v-model="library.state.query"
              aria-label="Search workspace files"
              data-cy="files-search"
              type="search"
              maxlength="200"
              placeholder="Search files, people or tasks…"
          /></label>
          <select v-model="library.state.kind" aria-label="File kind" data-cy="files-kind">
            <option v-for="[kind, label] in kinds" :key="kind" :value="kind">
              {{ label
              }}{{
                library.page.value
                  ? ` (${library.page.value.facets.kinds[kind]}${countSuffix})`
                  : ''
              }}
            </option>
          </select>
          <select v-model="library.state.role" aria-label="File role" data-cy="files-role">
            <option v-for="[role, label] in roles" :key="role" :value="role">
              {{ label
              }}{{
                library.page.value
                  ? ` (${library.page.value.facets.roles[role]}${countSuffix})`
                  : ''
              }}
            </option>
          </select>
          <select v-model="library.state.sort" aria-label="Sort files" data-cy="files-sort">
            <option value="newest">Newest kept</option>
            <option value="oldest">Oldest kept</option>
            <option value="name">Name A–Z</option>
          </select>
          <span v-if="library.page.value" class="count" role="status" data-cy="files-count"
            >{{ library.page.value.totalFiles }}{{ countSuffix }} files ·
            {{ library.page.value.totalKeeps }}{{ countSuffix }} keeps</span
          >
        </div>
      </header>
      <div class="reading-status" aria-live="polite">
        <p
          v-if="!library.page.value && !library.busy.value && !library.error.value"
          data-cy="files-unread"
        >
          Files unavailable.
        </p>
        <p v-if="library.busy.value" data-cy="files-loading">Reading files…</p>
        <p
          v-if="
            library.page.value?.complete === false && !library.busy.value && !library.error.value
          "
          data-cy="files-reading-more"
        >
          File list incomplete.
        </p>
        <p v-if="library.error.value" data-cy="files-error">
          {{ libraryFailureSays(library.error.value) }}
          <button
            type="button"
            :disabled="library.busy.value || !library.canRetry.value"
            data-cy="files-retry"
            @click="library.refresh()"
          >
            {{ library.page.value ? 'Refresh' : 'Retry' }}
          </button>
        </p>
        <p v-if="library.page.value?.stale" data-cy="files-stale">
          Out of date · {{ fullTime(library.page.value.readAt) }}
          <button
            type="button"
            :disabled="library.busy.value || !library.canRetry.value"
            data-cy="files-refresh"
            @click="library.refresh()"
          >
            Refresh
          </button>
        </p>
      </div>
      <div ref="scroller" class="results" data-cy="files-results" @scroll="onScroll">
        <FileRows
          v-if="files.length"
          class="file-items"
          :class="{ 'view-icons': library.state.view === 'icons' }"
          collection="library"
          :files="files"
          :matching-keeps="library.state.view === 'list' ? matchingKeeps : undefined"
          :can-open="props.canOpen"
          @open-document="openFile"
        />
        <div
          v-else-if="
            library.page.value && library.page.value.complete !== false && !library.busy.value
          "
          class="empty"
          data-cy="files-empty"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg>
          <p>
            {{ library.page.value.scopeKeeps === 0 ? 'No files yet.' : 'No files match.' }}
          </p>
          <button
            v-if="library.page.value.scopeKeeps > 0"
            type="button"
            data-cy="files-clear"
            @click="library.clearFilters()"
          >
            Clear filters
          </button>
        </div>
        <div v-if="library.page.value?.next" class="load-more">
          <span
            ><template v-if="library.page.value.complete === false"
              >{{ library.page.value.files.length }} files loaded · more to read</template
            ><template v-else
              >{{ library.page.value.files.length }} of {{ library.page.value.totalFiles }} files
              loaded</template
            ></span
          ><button
            type="button"
            data-cy="files-more"
            :disabled="
              library.paging.value ||
              library.busy.value ||
              library.page.value.stale ||
              !library.canRetry.value
            "
            @click="library.more()"
          >
            {{ library.paging.value ? 'Reading…' : 'Load more' }}
          </button>
        </div>
      </div>
      <p v-if="library.page.value && !library.page.value.stale" class="read-at">
        Read {{ fullTime(library.page.value.readAt) }}
      </p>
      <FilesTaskPicker
        v-if="picker"
        :read="library.read"
        :include-subtasks="library.state.includeSubtasks"
        :can-retry="library.canRetry.value"
        :mutation-version="library.mutationVersion.value"
        @unavailable="library.cooldown"
        @close="picker = false"
        @choose="
          (task, depth) => {
            library!.state.includeSubtasks = depth
            library!.task(task)
            picker = false
          }
        "
      />
    </template>
    <p v-else class="empty" data-cy="files-unread">The workspace file reader is not available.</p>
  </section>
</template>

<style scoped>
.files-library {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--text);
  font-size: var(--type-body);
}
.compact-toolbar {
  display: grid;
  gap: 10px;
  flex: none;
  padding: 12px;
  border-bottom: var(--border-width) solid var(--line);
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.scope-buttons {
  display: flex;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
}
.scope-conversation,
.scope-task {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button,
select,
input {
  font: inherit;
  color: inherit;
}
button,
select {
  min-height: 34px;
  padding: 6px 9px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  cursor: pointer;
}
button[aria-pressed='true'] {
  background: var(--accent-fill);
  border-color: var(--accent);
  color: var(--text);
}
button:disabled {
  cursor: default;
  opacity: 0.6;
}
button:hover:not(:disabled) {
  background: var(--accent-fill);
}
.depth {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 34px;
  font-size: var(--type-small);
}
.depth span {
  color: var(--muted);
}
.depth input {
  margin: 0;
  accent-color: var(--accent);
}
.view-switch {
  display: flex;
  margin-left: auto;
  gap: 3px;
}
.filter-row {
  flex-wrap: nowrap;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 120px;
  padding: 5px 9px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
}
.search input {
  width: 100%;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  padding: 0;
  line-height: var(--leading-relaxed);
}
.search:focus-within {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.filter-row select {
  max-width: 180px;
  min-width: 0;
  font-size: var(--type-small);
}
.count {
  white-space: nowrap;
  font-size: var(--type-small);
  color: var(--muted);
}
.reading-status {
  flex: none;
}
.reading-status p {
  margin: 8px 12px;
  font-size: var(--type-small);
  color: var(--muted);
}
.reading-status button {
  min-height: 28px;
  padding: 3px 8px;
  margin-left: 8px;
  font-size: var(--type-small);
}
.results {
  min-height: 0;
  overflow: auto;
  flex: 1;
  scrollbar-gutter: stable;
}
.file-items {
  max-width: none;
  margin: 0;
  padding: var(--space-5);
}
.view-icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
  align-content: start;
}
.empty {
  padding: 28px;
  text-align: center;
  color: var(--muted);
  font-size: var(--type-body);
}
.empty .icon {
  width: 30px;
  height: 30px;
}
.load-more {
  padding: 12px;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  font-size: var(--type-small);
  color: var(--muted);
}
.read-at {
  margin: 0;
  padding: 6px 12px;
  font-size: var(--type-small);
  color: var(--muted);
  border-top: var(--border-width) solid var(--line);
}
@media (max-width: 1050px) {
  .filter-row {
    flex-wrap: wrap;
  }
  .search {
    flex-basis: 230px;
  }
  .scope-conversation,
  .scope-task {
    max-width: 200px;
  }
  .count {
    margin-left: auto;
  }
}
@media (max-width: 650px) {
  .compact-toolbar {
    padding: 10px;
  }
  .scope-buttons {
    width: 100%;
  }
  .scope-conversation,
  .scope-task {
    max-width: 100%;
  }
  .depth {
    width: 100%;
  }
  .view-switch {
    margin-left: auto;
  }
  .search {
    flex-basis: 100%;
    min-width: 0;
  }
  .filter-row select {
    flex: 1 1 140px;
    min-width: min(100%, 140px);
    max-width: none;
  }
  .filter-row .count {
    margin-left: auto;
  }
  .file-items {
    padding: 8px;
    gap: 6px;
  }
  .view-icons {
    grid-template-columns: repeat(auto-fill, minmax(142px, 1fr));
  }
  .load-more {
    flex-wrap: wrap;
  }
}
</style>
