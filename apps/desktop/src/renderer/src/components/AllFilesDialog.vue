<script setup lang="ts">
import ListDialogShell from './ListDialogShell.vue'
import { computed, ref } from 'vue'
import type { KeptFile } from '../../../shared/runtime-ipc'
import { fileKindOf } from '../lib/files-kept'
import FileRows from './FileRows.vue'

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

function open(resourceId: string): void {
  emit('openDocument', resourceId)
  emit('close')
}
</script>

<template>
  <ListDialogShell title-id="all-files-title" data-cy="all-files-dialog" @close="emit('close')">
    <template #title>All files</template>
    <template #search>
      <input
        v-model="query"
        type="search"
        placeholder="Search files, types or task labels…"
        aria-label="Search all files"
        data-cy="all-files-search"
      />
    </template>
    <template #controls>
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
    </template>
    <template #results>
      <FileRows
        v-if="shown.length > 0"
        class="all-files-rows"
        :files="shown"
        :can-open="props.canOpen"
        collection="card"
        @open-document="open"
      />
      <p v-else class="list-empty" data-cy="all-files-empty">No file matches this view.</p>
    </template>
  </ListDialogShell>
</template>

<style scoped>
.all-files-rows {
  max-width: none;
  margin: 0;
}
</style>
