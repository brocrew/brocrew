<script setup lang="ts">
import MarkdownWords from './MarkdownWords.vue'
import { vButtonKeys } from '../lib/button-keys'
import type { PanelRun } from '../lib/panel-runs'
defineProps<{
  run: PanelRun
  conversation?: string
  canStop?: boolean
  stopping?: boolean
  disabled?: boolean
  title?: string
}>()
defineEmits<{ open: []; stop: [] }>()
</script>
<template>
  <div class="run-row" :data-run-key="run.key" :data-cy="`panel-run-${run.key}`">
    <div
      class="run-open"
      role="button"
      :tabindex="disabled ? -1 : 0"
      v-button-keys
      data-cy="panel-row"
      :data-item="run.itemId"
      :aria-disabled="disabled"
      :title="title"
      @click="!disabled && $emit('open')"
    >
      <svg class="icon" aria-hidden="true"><use :href="run.icon" /></svg>
      <div class="copy">
        <MarkdownWords
          v-if="run.labelIsProse"
          class="label"
          data-cy="panel-run-label"
          :text="run.label"
          :session-id="conversation"
        />
        <strong v-else class="label" data-cy="panel-run-label">{{ run.label }}</strong>
        <div class="detail">
          {{ run.group }}<template v-if="run.detail"> · </template>
          <MarkdownWords
            v-if="run.detailIsProse && run.detail"
            :text="run.detail"
            :session-id="conversation"
          />
          <template v-else>{{ run.detail }}</template>
        </div>
        <span class="status" :class="{ failed: run.failed }"
          >{{ run.status }}<span v-if="run.time" class="time">{{ run.time }}</span></span
        >
      </div>
      <svg class="icon arrow" aria-hidden="true"><use href="#i-chevron" /></svg>
    </div>
    <button
      v-if="canStop && run.stopId"
      class="stop row-stop bb-button"
      type="button"
      :data-cy="`panel-stop-${run.stopId}`"
      :disabled="stopping"
      @click="$emit('stop')"
    >
      {{ stopping ? 'Stopping…' : 'Stop' }}
    </button>
  </div>
</template>
<style scoped>
.run-row {
  display: flex;
  align-items: center;
  border-bottom: var(--border-width) solid var(--line);
  min-width: 0;
}
.run-row:last-child {
  border-bottom: 0;
}
.run-open {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  width: 100%;
  min-width: 0;
  padding: var(--space-5) 0;
  border: 0;
  background: none;
  color: var(--text);
  text-align: left;
}
.run-open:hover {
  background: var(--accent-mix-5);
}
.copy {
  flex: 1;
  min-width: 0;
}
.label,
.detail,
.status {
  display: block;
}
.label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
}
.detail {
  color: var(--muted);
  font-size: var(--type-caption);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin-top: var(--space-1);
}
.detail :deep(.markdown-words),
.detail :deep(.md-chat),
.detail :deep(p) {
  display: inline;
}
.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--accent-text);
  font-size: var(--type-caption);
  margin-top: var(--space-1);
}
.time {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.failed {
  color: var(--danger);
}
.icon {
  color: var(--muted);
  flex: none;
  margin-top: var(--space-1);
}
.arrow {
  width: 12px;
  height: 12px;
}
.stop {
  flex: none;
  font-size: var(--type-caption);
}
</style>
