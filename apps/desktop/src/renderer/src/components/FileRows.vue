<script setup lang="ts">
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
const props = defineProps<{
  files: readonly KeptFile[]
  /** ⚑ `true` where a reader can open a file, so each row is a press. */
  canOpen: boolean
}>()

const emit = defineEmits<{
  openDocument: [resourceId: string]
}>()

/** ⚑ The row's second line — its name, size, who and when; its title adds the day. */
const metaSays = (file: KeptFile): string =>
  `${file.name} · ${sizeWords(file.bytes)} · ${addedBySays(file)} · ${clockTime(file.keptAt)}`
</script>

<template>
  <ul v-if="props.files.length" class="file-rows" data-cy="file-rows">
    <li v-for="file in props.files" :key="file.resourceId">
      <component
        :is="props.canOpen ? 'button' : 'div'"
        v-bind="props.canOpen ? { type: 'button' } : {}"
        class="file-row"
        :class="{ flat: !props.canOpen }"
        data-cy="file-row"
        :data-document="file.resourceId"
        :data-role="file.role"
        :title="fileTitleSays(file)"
        @click="props.canOpen && emit('openDocument', file.resourceId)"
      >
        <span class="line">
          <svg class="icon" aria-hidden="true"><use href="#i-file" /></svg>
          <span class="title">{{ file.title }}</span>
          <span class="role">{{ ROLE_WORD[file.role] }}</span>
        </span>
        <span class="meta" :title="`${metaSays(file)} (${fullTime(file.keptAt)})`">{{
          metaSays(file)
        }}</span>
      </component>
    </li>
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
