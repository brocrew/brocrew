<script setup lang="ts">
/**
 * ⚑ **Readable | Raw, for a message whose words carry JSON** — the tool-answer viewer's two views,
 * with its names, at a card's size (`lib/words-with-json.ts`).
 *
 * ⛔ **Drawn in the card's META row, never in its body** — `001`'s rule: the body's `textContent` is
 * exactly the words, and a control inside it would join them.
 */
const view = defineModel<'readable' | 'raw'>({ required: true })
</script>

<template>
  <span class="views" role="group" aria-label="How the words are shown" data-cy="words-views">
    <button
      class="view"
      :class="{ on: view === 'readable' }"
      type="button"
      :aria-pressed="view === 'readable'"
      data-cy="words-view-readable"
      @click="view = 'readable'"
    >
      Readable
    </button>
    <button
      class="view"
      :class="{ on: view === 'raw' }"
      type="button"
      :aria-pressed="view === 'raw'"
      data-cy="words-view-raw"
      @click="view = 'raw'"
    >
      Raw
    </button>
  </span>
</template>

<style scoped>
/* ⚑ `ToolAnswerViewer`'s segmented control, by its declarations, at the meta row's size. */
.views {
  display: inline-flex;
  flex: none;
  padding: 1px;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-xs);
  background: var(--wash-2);
}

.view {
  display: inline-flex;
  height: 16px;
  align-items: center;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-2xs);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.view:hover {
  color: var(--text-soft);
}

/* `--accent-ink` on `--accent` — the viewer's own pairing: ink on a solid accent fill. */
.view.on {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}
</style>
