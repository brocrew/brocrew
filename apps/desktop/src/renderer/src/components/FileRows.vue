<script setup lang="ts">
import { ref } from 'vue'
import type { QuestionFiles } from '../../../shared/question-contracts'
import type { PathsHere } from '../composables/useMessagePaths'
import { clockTime } from '../../../shared/clock'
import type { KeptFile } from '../../../shared/runtime-ipc'
import { fullTime } from '../lib/clock'
import { addedBySays, fileTitleSays, ROLE_WORD, sizeWords } from '../lib/files-kept'

/**
 * # ⚑ UI-002 · the files a card hands over, one row each
 *
 * ⚑ **`07-where-resources-show` §2 item 1**: *"what was handed over here?"* — the give card lists
 * its inputs and the reply card the files it handed back, one row per file: its title, its name,
 * size, who, when, and *input* or *made*. ⚑ A press opens the file in the pane's one viewer.
 *
 * ⛔ **Nothing an agent wrote runs here**: every word is interpolated as text, and the viewer that
 * opens the file never runs it either.
 */
type FileRow = KeptFile | QuestionFiles[number]

const props = defineProps<{
  files: readonly FileRow[]
  paths?: PathsHere | null
  /** ⚑ `true` where a reader can open a file, so each row is a press. */
  canOpen: boolean
}>()

const emit = defineEmits<{
  openDocument: [resourceId: string]
}>()

const failure = ref<string | null>(null)
const keyOf = (file: FileRow): string =>
  'resourceId' in file ? file.resourceId : 'path' in file ? file.path : file.resource
const nameOf = (file: FileRow): string =>
  'resourceId' in file
    ? file.title
    : 'path' in file
      ? (file.name ?? file.path.split(/[\\/]/).at(-1) ?? '')
      : file.name
const canOpen = (file: FileRow): boolean => ('path' in file ? props.paths != null : props.canOpen)

async function open(file: FileRow): Promise<void> {
  if (!canOpen(file)) return
  failure.value = null
  if ('path' in file) failure.value = (await props.paths?.press(file.path, 'file')) ?? null
  else emit('openDocument', keyOf(file))
}

/** ⚑ The row's second line — its name, size, who and when; its title adds the day. */
const metaSays = (file: KeptFile): string =>
  `${file.name} · ${sizeWords(file.bytes)} · ${addedBySays(file)} · ${clockTime(file.keptAt)}`
</script>

<template>
  <ul v-if="props.files.length" class="file-rows" data-cy="file-rows">
    <li v-for="file in props.files" :key="keyOf(file)">
      <component
        :is="canOpen(file) ? 'button' : 'div'"
        v-bind="canOpen(file) ? { type: 'button' } : {}"
        class="file-row"
        :class="{ flat: !canOpen(file) }"
        data-cy="file-row"
        :data-document="'path' in file ? undefined : keyOf(file)"
        :data-role="'role' in file ? file.role : undefined"
        :title="'resourceId' in file ? fileTitleSays(file) : nameOf(file)"
        @click="open(file)"
      >
        <span class="line">
          <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg>
          <span class="title">{{ nameOf(file) }}</span>
          <span v-if="'role' in file" class="role">{{ ROLE_WORD[file.role] }}</span>
        </span>
        <span
          v-if="'resourceId' in file"
          class="meta"
          :title="`${metaSays(file)} (${fullTime(file.keptAt)})`"
          >{{ metaSays(file) }}</span
        >
      </component>
    </li>
    <li v-if="failure" class="message-path-failure" role="status">{{ failure }}</li>
  </ul>
</template>

<style scoped>
.file-rows {
  display: flex;
  max-width: 480px;
  margin: var(--space-4) 0 0;
  padding: 0;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
}

/* ⚑ **One file, one small framed row** — its title and what it is to its piece on the first line,
   its name, size, who and when under it. */
.file-row {
  display: flex;
  width: 100%;
  min-width: 0;
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
  color: inherit;
  font: inherit;
  flex-direction: column;
  gap: var(--space-1);
  text-align: left;
}

.file-row:not(.flat) {
  cursor: pointer;
}

.file-row:not(.flat):hover {
  border-color: var(--accent);
}

.line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

.icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--muted);
}

.title {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--text);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: var(--type-caption);
}

.meta {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
