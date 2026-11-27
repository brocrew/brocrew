<script setup lang="ts">
/**
 * The panel a document opens in over the conversation: a kept file, a workflow's output, a
 * sub-agent's record and a tool's whole answer all sit in this one frame, so they read as the same
 * kind of thing opening.
 *
 * The head carries what the caller puts in `head`, then `actions` and the close button at its end.
 * `notes` are the stated
 * limits under it (a cut file, unreadable lines); `refusal` says why there is nothing to show. The
 * default slot is the body; a `.stage` there is the one scroller.
 *
 * `fill` takes the whole allowed width, for a body whose content would shrink-wrap the panel.
 *
 * Esc, the backdrop, the focus trap and returning focus belong to `OverlayHost`, which wraps this.
 */
withDefaults(
  defineProps<{
    notes?: readonly { text: string; cy: string }[]
    refusal?: { text: string; cy: string } | null
    fill?: boolean
  }>(),
  { notes: () => [], refusal: null, fill: false },
)

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="viewer-frame" :class="{ fill }">
    <header class="viewer-head">
      <slot name="head" />
      <div class="head-end">
        <slot name="actions" />
        <button
          class="icon-button"
          type="button"
          aria-label="Close"
          data-cy="close-overlay"
          @click="emit('close')"
        >
          <svg class="icon"><use href="#i-x" /></svg>
        </button>
      </div>
    </header>
    <p v-for="note in notes" :key="note.cy" class="note" :data-cy="note.cy">{{ note.text }}</p>
    <slot />
    <p v-if="refusal" class="refusal" :data-cy="refusal.cy">{{ refusal.text }}</p>
  </div>
</template>

<style scoped>
/* `--drawer-solid`: the opaque fill for something floating over the transcript, with a value in
   both themes. `--paper-bg` has no dark value and would put the head's pale ink on white.
   The width keeps clear of the Waiting on you corner, which `OverlayHost` draws at the layer's left
   edge, `--lane-clear` wide: centred, it gives that band back on both sides. */
.viewer-frame {
  display: flex;
  max-width: min(900px, 92vw, calc(100% - 2 * var(--lane-clear)));
  max-height: 88vh;
  flex-direction: column;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius);
  background: var(--drawer-solid);
}

/* A tool's whole answer is short JSON lines, which would shrink-wrap the panel to about 400 px. */
.fill {
  width: min(900px, 92vw);
}

.viewer-head {
  display: flex;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-4);
}

/* Never shrinks: a long title gives way, and the buttons stay inside the panel. */
.head-end {
  display: flex;
  flex: none;
  align-items: center;
  margin-left: auto;
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

/* In a narrow window, giving the corner's band back on both sides leaves too little to read in.
   The corner is only at the left, so the viewer clears it there and takes the rest of the width. */
@media (max-width: 1000px) {
  .viewer-frame {
    max-width: calc(100% - var(--lane-clear) - var(--space-5));
    margin-left: var(--lane-clear);
  }
}
</style>
