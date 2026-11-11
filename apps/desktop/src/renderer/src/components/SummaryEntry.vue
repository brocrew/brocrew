<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { TranscriptItem } from '../lib/transcript-message-contracts'
import { turnSummaryLine } from '../lib/summary-line'

const props = defineProps<{
  item: Extract<TranscriptItem, { kind: 'turnSummary' | 'commandSummary' }>
}>()
const text = computed(() =>
  props.item.kind === 'turnSummary' ? turnSummaryLine(props.item) : props.item.description,
)
</script>

<template>
  <div class="line-lane">
    <p
      class="summary line-card"
      :data-cy="item.kind === 'turnSummary' ? 'turn-summary' : 'command-summary'"
    >
      <svg class="line-icon" aria-hidden="true">
        <use :href="item.kind === 'turnSummary' ? '#i-check' : '#i-terminal'" />
      </svg>
      <span class="line-words" data-cy="summary-words" :title="text">{{ text }}</span>
      <span
        v-if="item.at !== undefined"
        class="line-time"
        data-cy="summary-time"
        :title="fullTime(item.at)"
        >{{ clockTime(item.at) }}</span
      >
    </p>
  </div>
</template>

<style scoped src="./summary-notice-presentation.css"></style>
<style scoped>
.summary {
  margin: 0;
}
</style>
