<script lang="ts">
// ⚠️ **A TYPE, and it is the whole cost of putting the task vocabulary here** — see
// {@link TASK_OUTCOME_LOOK}.
import type { TaskOutcome } from '../../../shared/tasks'

/**
 * The task outcome's colour grammar, as data.
 *
 * This is the ONE place a task outcome's colour is decided. Every surface that draws one renders it
 * through this component, so re-hueing it is one edit here rather than a search for every green in
 * the app — and an outcome can never be drawn in two different colours on two different screens.
 *
 * Each entry names a TOKEN. Nothing here is a colour; components may not carry one.
 */
export interface BadgeLook {
  label: string
  /** The token the dot and the text take their colour from. */
  token: string
  /** Its 10% tint, for the pill behind them. */
  tint: string
}

/**
 * 🔴 **How a TASK turned out, as the agent that did it said so** (406) — `TASK_OUTCOMES`, in the
 * one place its colour is decided.
 *
 * ## ⛔ Here rather than in the component that draws it, and that is this file's own rule
 *
 * ⚠️ A `done` chip with a hex in a template is how the next surface comes to draw the same word a
 * different green.
 *
 * ## ⛔ Two of the three take one hue, and `tokens.css` §4 already says so
 *
 * ⚠️ *"failed / no-response / blocked → `--danger` red (bad/terminal)."* ⚑ `blocked` and `failed`
 * differ in what the agent will do next, not in what a glance needs: both are work that did not
 * get done. The difference between them is a WORD, which is what the label carries, and the
 * grammar's rule is one hue per meaning rather than one hue per name.
 */
export const TASK_OUTCOME_LOOK: Record<TaskOutcome, BadgeLook> = {
  done: { label: 'Done', token: '--success', tint: '--success-bg' },
  blocked: { label: 'Blocked', token: '--danger', tint: '--danger-bg' },
  failed: { label: 'Failed', token: '--danger', tint: '--danger-bg' },
}
</script>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * How a task turned out, drawn as a pill — {@link TASK_OUTCOME_LOOK}'s label in its token's ink.
 */
const props = defineProps<{
  /** 🔴 **How a real task turned out** (406) — see {@link TASK_OUTCOME_LOOK}. */
  taskOutcome?: TaskOutcome
}>()

const badges = computed(() =>
  props.taskOutcome ? [{ facet: 'taskOutcome', ...TASK_OUTCOME_LOOK[props.taskOutcome] }] : [],
)
</script>

<template>
  <span
    v-for="badge in badges"
    :key="badge.facet"
    class="state-badge"
    :style="{ '--badge': `var(${badge.token})`, '--badge-tint': `var(${badge.tint})` }"
    :data-cy="`state-${badge.facet}`"
    :data-token="badge.token"
    :title="badge.label"
  >
    <span class="dot"></span>
    <span class="label">{{ badge.label }}</span>
  </span>
</template>

<style scoped>
.state-badge {
  display: inline-flex;
  height: 20px;
  align-items: center;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  /* Both come from the token named in the map above — never from a value written here. */
  background: var(--badge-tint);
  color: var(--badge);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
  white-space: nowrap;
}

.dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--badge);
}
</style>
