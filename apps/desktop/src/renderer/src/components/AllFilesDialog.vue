<script setup lang="ts">
import { computed, ref } from 'vue'
import { clockTime } from '../../../shared/clock'
import type { KeptFile } from '../../../shared/runtime-ipc'
import { fullTime } from '../lib/clock'
import { fileKindOf, fileTitleSays, ROLE_WORD } from '../lib/files-kept'

/**
 * View all opens a popup for every file the agent added, sorted newest first or by name. Search name, title and work; filter by kind and show the match count. Opening a row uses the shared viewer.
 */
const props = defineProps<{
  files: readonly KeptFile[]
  canOpen: boolean
  /** The search the card's filter box already holds. */
  query?: string
}>()

const emit = defineEmits<{ close: []; openDocument: [resourceId: string] }>()

type Kind = 'all' | 'document' | 'image'
const KINDS: readonly { key: Kind; label: string }[] = [
  { key: 'all', label: 'All files' },
  { key: 'document', label: 'Documents' },
  { key: 'image', label: 'Images' },
]
const kind = ref<Kind>('all')
const sort = ref<'recent' | 'name'>('recent')
const query = ref(props.query ?? '')

const isImage = (file: KeptFile): boolean => {
  const of = fileKindOf(file)
  return of === 'image' || of === 'svg'
}

const counts = computed(() => ({
  all: props.files.length,
  image: props.files.filter(isImage).length,
  document: props.files.filter((file) => !isImage(file)).length,
}))

const shown = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const kept = props.files.filter(
    (file) =>
      (kind.value === 'all' || (kind.value === 'image') === isImage(file)) &&
      `${file.name} ${file.title} ${file.label}`.toLocaleLowerCase().includes(needle),
  )
  return sort.value === 'name'
    ? [...kept].sort((a, b) => a.title.localeCompare(b.title))
    : [...kept].sort((a, b) => b.keptAt - a.keptAt)
})

function open(file: KeptFile): void {
  if (!props.canOpen) return
  emit('openDocument', file.resourceId)
  emit('close')
}
</script>

<template>
  <section class="list-dialog" aria-labelledby="all-files-title" data-cy="all-files-dialog">
    <header class="list-head">
      <h2 id="all-files-title" class="bb-title">All files</h2>
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
          placeholder="Search files, types or task labels…"
          aria-label="Search all files"
          data-cy="all-files-search"
        />
      </label>
      <div class="list-controls">
        <div class="list-filters" role="group" aria-label="Show files">
          <button
            v-for="one in KINDS"
            :key="one.key"
            type="button"
            class="list-filter"
            :aria-pressed="kind === one.key"
            :data-cy="`all-files-filter-${one.key}`"
            @click="kind = one.key"
          >
            {{ one.label }} <span class="list-filter-count">{{ counts[one.key] }}</span>
          </button>
        </div>
        <select v-model="sort" class="list-sort" aria-label="Sort files" data-cy="all-files-sort">
          <option value="recent">Newest first</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <p class="list-count" role="status" data-cy="all-files-count">
        {{ shown.length }} {{ shown.length === 1 ? 'file' : 'files' }}
      </p>
      <ul v-if="shown.length > 0" class="file-rows">
        <li v-for="file in shown" :key="file.resourceId">
          <component
            :is="props.canOpen ? 'button' : 'div'"
            v-bind="props.canOpen ? { type: 'button' } : {}"
            class="file-row"
            :class="{ flat: !props.canOpen }"
            data-cy="card-file"
            :data-document="file.resourceId"
            :data-role="file.role"
            :title="fileTitleSays(file)"
            @click="open(file)"
          >
            <span class="file-glyph" :data-kind="fileKindOf(file)" aria-hidden="true">
              <svg class="icon">
                <use :href="isImage(file) ? '#i-image' : '#i-file'" />
              </svg>
            </span>
            <span class="file-copy">
              <span class="file-title">{{ file.title }}</span>
              <span class="file-meta" :title="fullTime(file.keptAt)"
                ><span class="file-tag" :title="file.pieceTitle ?? file.label">{{
                  file.label
                }}</span>
                {{ ROLE_WORD[file.role] }} · {{ clockTime(file.keptAt) }}</span
              >
            </span>
          </component>
        </li>
      </ul>
      <p v-else class="list-empty" data-cy="all-files-empty">No file matches this view.</p>
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

.list-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
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

.list-sort {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text-soft);
  font-size: var(--type-small);
}

.list-count,
.list-empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

.file-rows {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-2);
  list-style: none;
}

.file-row {
  display: flex;
  width: 100%;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  gap: var(--space-4);
  text-align: left;
}

.file-row:not(.flat) {
  cursor: pointer;
}

.file-row:not(.flat):hover {
  border-color: var(--accent-border);
  background: var(--accent-mix-5);
}

.file-glyph {
  display: grid;
  width: 30px;
  height: 32px;
  flex: none;
  border-radius: var(--radius-md);
  background: color-mix(
    in srgb,
    var(--_tint, var(--accent)) 12%,
    var(--panel)
  ); /* raw: mixes the tint this element sets for itself */
  color: var(--_tint, var(--accent));
  place-items: center;
}

.file-glyph[data-kind='image'] {
  --_tint: var(--success);
}

.file-glyph[data-kind='pdf'] {
  --_tint: var(--danger);
}

.file-glyph[data-kind='svg'] {
  --_tint: var(--waiting);
}

.file-glyph .icon {
  width: 18px;
  height: 18px;
}

.file-copy {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.file-title {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-2);
}

.file-tag {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--accent-mix-12);
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
</style>
