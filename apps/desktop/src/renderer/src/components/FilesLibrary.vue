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
import type { LibraryKeep } from '../../../shared/files-library'

const props = withDefaults(
  defineProps<{ controller?: FilesLibraryController; canOpen?: boolean; active?: boolean }>(),
  { canOpen: true, active: true },
)
const library = props.controller ?? useFilesLibrary()
const picker = ref(false),
  scroller = ref<HTMLElement | null>(null)
const modalDepth = useModalDepth()
const shortTime = (at: number): string =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
const accessible = (file: LibraryKeep): string =>
  `${file.title}. ${file.name}. ${file.label}${file.pieceTitle ? ` · ${file.pieceTitle}` : ''}. Kept by ${file.addedBy?.name ?? 'a person'}, ${fullTime(file.keptAt)}. ${file.role}. ${file.sha256}${file.clipped ? '. Some display details are shortened' : ''}`
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
              }}{{ library.page.value ? ` (${library.page.value.facets.kinds[kind]})` : '' }}
            </option>
          </select>
          <select v-model="library.state.role" aria-label="File role" data-cy="files-role">
            <option v-for="[role, label] in roles" :key="role" :value="role">
              {{ label
              }}{{ library.page.value ? ` (${library.page.value.facets.roles[role]})` : '' }}
            </option>
          </select>
          <select v-model="library.state.sort" aria-label="Sort files" data-cy="files-sort">
            <option value="newest">Newest kept</option>
            <option value="oldest">Oldest kept</option>
            <option value="name">Name A–Z</option>
          </select>
          <span v-if="library.page.value" class="count" role="status" data-cy="files-count"
            >{{ library.page.value.totalFiles }} files ·
            {{ library.page.value.totalKeeps }} keeps</span
          >
        </div>
      </header>
      <div class="reading-status" aria-live="polite">
        <p
          v-if="!library.page.value && !library.busy.value && !library.error.value"
          data-cy="files-unread"
        >
          Files have not been read yet.
        </p>
        <p v-if="library.busy.value" data-cy="files-loading">Reading files…</p>
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
          Earlier reading · {{ fullTime(library.page.value.readAt) }}
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
      <div
        ref="scroller"
        class="results"
        data-cy="files-results"
        @scroll="props.active && (library.state.scrollTop = scroller?.scrollTop ?? 0)"
      >
        <ul
          v-if="library.page.value && library.page.value.files.length > 0"
          class="file-items"
          :class="`view-${library.state.view}`"
          data-cy="files-items"
        >
          <li
            v-for="group in library.page.value.files"
            :key="group.file.sha256"
            :data-hash="group.file.sha256"
          >
            <component
              :is="props.canOpen ? 'button' : 'div'"
              v-bind="props.canOpen ? { type: 'button' } : {}"
              class="file-item"
              :title="accessible(group.file)"
              :aria-label="accessible(group.file)"
              :data-document="group.file.resourceId"
              data-cy="library-file"
              @click="
                props.canOpen && library.open(group.file, $event.currentTarget as HTMLElement)
              "
            >
              <span class="glyph" :data-kind="group.file.form ?? 'unknown'" aria-hidden="true"
                ><svg class="icon">
                  <use :href="group.file.form === 'image' ? '#i-image' : '#i-file'" /></svg
                ><span>{{
                  group.file.form === 'image'
                    ? 'IMG'
                    : group.file.form === null
                      ? '?'
                      : group.file.form === 'markdown'
                        ? 'MD'
                        : group.file.form.toUpperCase()
                }}</span></span
              >
              <span class="file-copy"
                ><span class="file-title">{{ group.file.title }}</span
                ><span class="file-meta"
                  ><span>{{ group.file.label }}</span> ·
                  <span>{{ group.file.addedBy?.name ?? 'Person' }}</span></span
                ><time
                  class="kept-time"
                  :datetime="new Date(group.file.keptAt).toISOString()"
                  :title="`Kept ${fullTime(group.file.keptAt)}`"
                  >{{ shortTime(group.file.keptAt) }}</time
                ><span v-if="library.state.view === 'list'" class="extra"
                  >{{ group.file.name }} · {{ group.file.role === 'made' ? 'Made' : 'Input' }} ·
                  {{ group.matchingKeeps }} {{ group.matchingKeeps === 1 ? 'keep' : 'keeps' }}</span
                ></span
              >
            </component>
          </li>
        </ul>
        <div
          v-else-if="library.page.value && !library.busy.value"
          class="empty"
          data-cy="files-empty"
        >
          <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg>
          <p>
            {{
              library.page.value.scopeKeeps === 0
                ? 'No files kept on this work yet.'
                : 'No files match these filters.'
            }}
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
            >{{ library.page.value.files.length }} of {{ library.page.value.totalFiles }} files
            loaded</span
          ><button
            type="button"
            data-cy="files-more"
            :disabled="library.paging.value || library.busy.value || library.page.value.stale"
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
  font-size: 14px;
}
.compact-toolbar {
  display: grid;
  gap: 10px;
  flex: none;
  padding: 12px;
  border-bottom: 1px solid var(--line);
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
  border: 1px solid var(--line);
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
  font-size: 13px;
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
  border: 1px solid var(--line);
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
  line-height: 22px;
}
.search:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.filter-row select {
  max-width: 180px;
  min-width: 0;
  font-size: 13px;
}
.count {
  white-space: nowrap;
  font-size: 13px;
  color: var(--muted);
}
.reading-status {
  flex: none;
}
.reading-status p {
  margin: 8px 12px;
  font-size: 13px;
  color: var(--muted);
}
.reading-status button {
  min-height: 28px;
  padding: 3px 8px;
  margin-left: 8px;
  font-size: 13px;
}
.results {
  min-height: 0;
  overflow: auto;
  flex: 1;
  scrollbar-gutter: stable;
}
.file-items {
  list-style: none;
  margin: 0;
  padding: 12px;
  display: grid;
  gap: 8px;
}
.file-items li {
  min-width: 0;
}
.view-icons {
  grid-template-columns: repeat(auto-fill, minmax(142px, 1fr));
  align-content: start;
}
.file-item {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  border-radius: var(--radius-sm);
  text-align: center;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.view-icons .file-item {
  min-height: 148px;
}
.file-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 0;
  width: 100%;
}
.file-title {
  color: var(--text);
  font-size: 14px;
  line-height: 19px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
  font-weight: var(--fw-semibold);
}
.file-meta,
.kept-time,
.extra {
  font-size: 13px;
  line-height: 18px;
  color: var(--muted);
  overflow-wrap: anywhere;
  max-width: 100%;
}
.file-meta {
  color: var(--text-soft);
}
.glyph {
  position: relative;
  display: flex;
  width: 48px;
  height: 55px;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  flex: none;
}
.glyph .icon {
  width: 42px;
  height: 48px;
}
.glyph > span {
  position: absolute;
  font-size: 10px;
  font-weight: 700;
  bottom: 9px;
  left: 5px;
  right: 5px;
  text-align: center;
  background: var(--panel);
}
.glyph[data-kind='image'] {
  color: var(--accent);
}
.view-list {
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.view-list .file-item {
  flex-direction: row;
  text-align: start;
  gap: 12px;
  min-height: 76px;
}
.view-list .file-copy {
  align-items: flex-start;
  gap: 2px;
}
.view-list .file-title {
  display: block;
  white-space: normal;
}
.view-list .glyph {
  width: 34px;
  height: 42px;
}
.view-list .glyph .icon {
  width: 30px;
  height: 38px;
}
.view-list .glyph > span {
  font-size: 8px;
  bottom: 6px;
}
.view-list .file-meta {
  display: inline;
}
.empty {
  padding: 28px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
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
  font-size: 13px;
  color: var(--muted);
}
.read-at {
  margin: 0;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--muted);
  border-top: 1px solid var(--line);
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
    flex: 1;
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
