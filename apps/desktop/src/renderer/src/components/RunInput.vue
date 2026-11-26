<script setup lang="ts">
defineProps<{ text?: string; progress?: string; result?: string; pendingOutput?: boolean }>()
</script>
<template>
  <details v-if="text" class="run-input" open data-cy="run-input">
    <summary>Input</summary>
    <div>{{ text }}</div>
  </details>
  <p v-if="result ?? progress" class="run-state" data-cy="run-state">
    <strong>{{ result !== undefined ? 'Result' : 'Progress' }}</strong>
    <span>{{ result ?? progress }}</span>
  </p>
  <p v-else-if="pendingOutput" class="run-state" data-cy="run-no-output">No output yet.</p>
</template>
<style scoped>
.run-input {
  padding: var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  font-size: var(--type-small);
}
summary {
  cursor: pointer;
  font-weight: var(--fw-semibold);
}
.run-input div {
  margin-top: var(--space-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.run-state {
  padding: var(--space-5);
  margin: 0;
  font-size: var(--type-small);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.run-state strong {
  display: block;
  margin-bottom: var(--space-3);
}
</style>
