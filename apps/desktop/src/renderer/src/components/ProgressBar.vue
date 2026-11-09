<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{
  phase: 'downloading' | 'checking'
  received: number
  total?: number
}>()
const maximum = computed(() =>
  props.total !== undefined && Number.isFinite(props.total) && props.total > 0
    ? props.total
    : undefined,
)
const value = computed(() =>
  props.phase === 'downloading' && maximum.value !== undefined
    ? Math.min(props.received, maximum.value)
    : undefined,
)
</script>
<template>
  <progress class="progress-bar" :max="maximum" :value="value" />
</template>
<style scoped>
.progress-bar {
  width: 100%;
  min-width: 0;
  height: 8px;
  accent-color: var(--accent);
}
</style>
