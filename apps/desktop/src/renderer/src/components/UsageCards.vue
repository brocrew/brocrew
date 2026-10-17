<script setup lang="ts">
import { TOTALS, type UsageCell } from '../composables/useUsageCells'

/**
 * Each provider's usage cards, then the agents running and their memory. A card says the provider
 * and window with the reading's age, then how much is used and when it resets; the exact reset and
 * when the reading arrived are on its title, and it takes focus with all of it as its name, so a
 * keyboard reaches what a pointer hovers. A window with no reading says so.
 */
const props = defineProps<{ cells: readonly UsageCell[] }>()
</script>

<template>
  <div class="shelf-settings" data-cy="shelf-settings">
    <div
      v-for="cell in props.cells"
      :key="cell.key"
      class="fact"
      :class="{ 'fact-providers': cell.key === 'agents' }"
      :data-cy="`shelf-usage-${cell.key}`"
      :data-read="cell.value !== null"
      :title="cell.title ?? undefined"
      :aria-label="cell.name"
      role="group"
      tabindex="0"
    >
      <span class="fact-label usage-label">
        <span>{{ cell.label }}</span>
        <span v-if="cell.age !== null" class="usage-age" data-cy="shelf-usage-age">{{
          cell.age
        }}</span>
      </span>
      <span
        v-if="cell.value !== null"
        class="fact-value"
        :class="{ 'fact-lines': cell.key === 'agents' }"
        data-cy="shelf-usage-value"
        >{{ cell.value }}</span
      >
      <span
        v-else
        class="fact-value fact-missing"
        :data-cy="TOTALS.has(cell.key) ? 'shelf-total-missing' : 'shelf-missing'"
        >Not read yet</span
      >
    </div>
  </div>
</template>

<style scoped>
.shelf-settings {
  display: grid;
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--panel-2);
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
}

.fact {
  min-width: 0;
  padding: var(--space-5) var(--space-6);
  border-right: var(--border-width) solid var(--line);
  line-height: var(--leading-normal);
}

.fact-providers {
  padding-inline: var(--space-5);
}

.fact:last-child {
  border-right: 0;
}

/* Inside the cell: the strip clips anything drawn past its border. */
.fact:focus-visible {
  outline-offset: calc(var(--focus-ring-width) * -1);
}

.fact-label {
  display: block;
  color: var(--muted);
  font-size: var(--type-caption);
  letter-spacing: var(--tracking-normal);
  text-transform: none;
}

/* The provider and window on the left, the reading's age on the right, on one line. */
.usage-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  white-space: nowrap;
}

/* One weight for every value line, read or not: only the colour says a window is unread. */
.fact-value {
  display: block;
  overflow: visible;
  color: var(--text);
  font-size: var(--type-small);
  font-weight: var(--fw-normal);
  white-space: normal;
  overflow-wrap: anywhere;
  margin-top: var(--space-2);
}

.fact-missing {
  color: var(--faint);
  font-weight: var(--fw-normal);
}

.fact-value.fact-lines {
  white-space: pre-line;
}
</style>
