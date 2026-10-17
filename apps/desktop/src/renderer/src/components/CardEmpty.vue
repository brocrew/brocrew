<script setup lang="ts">
/**
 * An empty agent-card section shows a dashed box, quiet icon, what is missing and where it comes from. The caller's hook falls through from its `<CardEmpty>` tag to the box.
 */
defineProps<{
  /** ⚑ A sprite symbol, `#i-…`. */
  icon: string
  /** ⚑ What is not there. */
  says: string
  /** ⚑ Where it will come from. */
  hint?: string
}>()
</script>

<template>
  <div class="card-empty">
    <svg class="icon" aria-hidden="true"><use :href="icon" /></svg>
    <p class="says">{{ says }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.card-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-7) var(--space-6);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius);
  gap: var(--space-2);
  text-align: center;
}

.icon {
  width: 22px;
  height: 22px;
  margin-bottom: var(--space-2);
  color: var(--faint);
}

.says {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-body);
}

.hint {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-caption);
}
</style>
