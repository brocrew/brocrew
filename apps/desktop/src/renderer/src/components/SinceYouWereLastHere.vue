<script setup lang="ts">
/**
 * What finished or failed since the person was last here, as one chip in the head of Waiting on
 * you. It opens Recent activity, where each line is listed.
 */
import { computed } from 'vue'
import { sinceWords, type SinceView } from '../lib/recent-activity'

const props = defineProps<{
  view: SinceView
  since: number
  clock: number
}>()

const emit = defineEmits<{ seeAll: [] }>()

const summary = computed(() => sinceWords(props.view, props.since, props.clock))
const someMissing = computed(() => props.view.partial || props.view.capped)
</script>

<template>
  <button
    type="button"
    class="since"
    data-cy="since-last-here"
    title="See all in Recent activity"
    @click="emit('seeAll')"
  >
    <svg class="icon done" aria-hidden="true"><use href="#i-check" /></svg>
    <span data-cy="since-summary">{{ summary }}</span>
    <span v-if="someMissing" class="missing" data-cy="since-some-missing"
      >· some may be missing</span
    >
    <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
  </button>
</template>

<style scoped>
.since {
  display: inline-flex;
  min-height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: var(--type-small);
  font-weight: var(--fw-medium);
  cursor: pointer;
  gap: var(--space-3);
}

.since:hover,
.since:focus-visible {
  border-color: var(--accent-border);
  background: var(--accent-fill-weak);
}

.icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.done {
  color: var(--success-text);
}

.missing {
  color: var(--muted);
}
</style>
