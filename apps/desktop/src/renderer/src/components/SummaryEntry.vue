<script setup lang="ts">
import type { TranscriptItem } from '../lib/transcript-message-contracts'
import { turnSummaryLine } from '../lib/summary-line'

defineProps<{ item: Extract<TranscriptItem, { kind: 'turnSummary' | 'commandSummary' }> }>()
</script>

<template>
  <p class="summary" :data-cy="item.kind === 'turnSummary' ? 'turn-summary' : 'command-summary'">
    {{ item.kind === 'turnSummary' ? turnSummaryLine(item) : item.description }}
  </p>
</template>

<style scoped>
.summary {
  max-width: var(--measure-message);
  margin: var(--space-4) 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}
</style>
