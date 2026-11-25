<script setup lang="ts" generic="T extends string">
/**
 * Two or more views of one thing, one press apart: Markdown | Raw, Transcript | Raw,
 * Readable | Raw, Unified | Split. Every switch between views is this control.
 *
 * `tone="paper"` draws it on a white paper toolbar; the default draws it on the panel's chrome.
 * `size="tight"` fits a 30 px paper bar.
 */
withDefaults(
  defineProps<{
    options: readonly { value: T; label: string; cy: string }[]
    tone?: 'chrome' | 'paper'
    size?: 'regular' | 'tight'
  }>(),
  { tone: 'chrome', size: 'regular' },
)

const view = defineModel<T>({ required: true })
</script>

<template>
  <span class="seg-group" :class="[`on-${tone}`, size]" role="group">
    <button
      v-for="option in options"
      :key="option.value"
      class="seg"
      :class="{ on: view === option.value }"
      type="button"
      :aria-pressed="view === option.value"
      :data-cy="option.cy"
      @click="view = option.value"
    >
      {{ option.label }}
    </button>
  </span>
</template>

<style scoped>
.seg-group {
  display: inline-flex;
  flex: none;
  padding: var(--space-1);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-seg-group);
  background: var(--wash-2);
}

.seg {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-seg);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.seg:hover {
  color: var(--text-soft);
}

.on-paper {
  border-color: var(--paper-line);
  background: var(--paper-seg-bg);
}

.on-paper .seg {
  color: var(--paper-muted);
}

.on-paper .seg:hover {
  color: var(--paper-ink);
}

.tight {
  border-radius: var(--radius-xs);
}

.tight .seg {
  height: 18px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-seg-tight);
}

/* Ink on a solid accent fill: `--accent-ink`, never the badge's white, which fails on dark's pale
   accent. Last and as specific as the hover rules, so the chosen view keeps its ink under the pointer. */
.seg-group .seg.on {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}
</style>
