<script setup lang="ts">
/**
 * The panel a document opens in over the conversation: a kept file, a workflow's output, a
 * sub-agent's record and a tool's whole answer all sit in this one frame, so they read as the same
 * kind of thing opening.
 *
 * The head carries what the caller puts in `head` and the close button. `notes` are the stated
 * limits under it (a cut file, unreadable lines); `refusal` says why there is nothing to show. The
 * default slot is the body; a `.stage` there is the one scroller.
 *
 * Esc, the backdrop, the focus trap and returning focus belong to `OverlayHost`, which wraps this.
 */
withDefaults(
  defineProps<{
    notes?: readonly { text: string; cy: string }[]
    refusal?: { text: string; cy: string } | null
  }>(),
  { notes: () => [], refusal: null },
)

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="viewer-frame">
    <header class="viewer-head">
      <div class="head-main">
        <slot name="head" />
      </div>
      <button
        class="icon-button"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>
    <p v-for="note in notes" :key="note.cy" class="note" :data-cy="note.cy">{{ note.text }}</p>
    <slot />
    <p v-if="refusal" class="refusal" :data-cy="refusal.cy">{{ refusal.text }}</p>
  </div>
</template>

<style scoped>
/* `--drawer-solid`: the opaque fill for something floating over the transcript, with a value in
   both themes. `--paper-bg` has no dark value and would put the head's pale ink on white. */
.viewer-frame {
  display: flex;
  max-width: min(900px, 92vw);
  max-height: 88vh;
  flex-direction: column;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--drawer-solid);
}

.viewer-head {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

.head-main {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-4);
}

.viewer-head :slotted(.name) {
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.viewer-head :slotted(.file) {
  color: var(--faint);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

.note {
  margin: 0;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--muted);
  font-size: var(--type-caption);
}

:slotted(.stage) {
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.refusal {
  margin: 0;
  padding: var(--space-6) var(--space-5);
  color: var(--muted);
  font-size: var(--type-caption);
}
</style>
