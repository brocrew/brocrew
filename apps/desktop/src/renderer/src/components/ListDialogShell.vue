<script setup lang="ts">
defineProps<{ titleId: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <section class="list-dialog" :aria-labelledby="titleId">
    <header class="list-head">
      <h2 :id="titleId" class="bb-title"><slot name="title" /></h2>
      <button
        class="bb-button bb-button--icon"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="$emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>
    <div class="list-body">
      <label class="list-search">
        <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>
        <slot name="search" />
      </label>
      <slot name="controls" />
      <slot name="results" />
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
  /* Rows keep their content height while the body scrolls. */
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

.list-search :deep(input) {
  min-width: 0;
  flex: 1;
  padding: var(--space-3) 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--type-small);
  outline: none;
}

:deep(.list-controls) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

:deep(.list-filters) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

:deep(.list-filter) {
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

:deep(.list-filter[aria-pressed='true']) {
  border-color: var(--accent);
  background: var(--accent-mix-10);
  color: var(--accent-text);
}

:deep(.list-filter-count) {
  color: var(--muted);
}

:deep(.list-sort) {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--control-border);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text-soft);
  font-size: var(--type-small);
}

:deep(.list-count),
:deep(.list-empty) {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
