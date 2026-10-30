<script setup lang="ts">
import { usePersonsQueue } from '../lib/persons-queue'
defineProps<{ piece: string; cy: string; disabled?: boolean }>()
const queue = usePersonsQueue()
</script>
<template>
  <span class="close-work">
    <button
      type="button"
      :data-cy="cy"
      :disabled="disabled || queue.closingWork.has(piece) || queue.closedWork.get(piece)?.ok"
      @click="queue.closeWork(piece)"
    >
      Close
    </button>
    <span v-if="queue.closedWork.has(piece)" role="status" :data-cy="`${cy}-said`">{{
      queue.closedWork.get(piece)?.said
    }}</span>
  </span>
</template>
<style scoped>
.close-work {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.close-work > button {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel);
  font-size: var(--type-caption);
}
.close-work > span {
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
