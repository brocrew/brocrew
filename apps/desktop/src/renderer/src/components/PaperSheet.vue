<script setup lang="ts">
/**
 * The paper: the white sheet anything read as a document sits on, in every theme.
 *
 * `data-on-white` makes it an island, so ink, focus rings and scrollbars inside take the light
 * values whatever the conversation's theme. `flush` drops the padding for a sheet that brings its
 * own toolbar and content padding, such as `DocumentBody`.
 */
withDefaults(defineProps<{ flush?: boolean }>(), { flush: false })
</script>

<template>
  <div class="paper" :class="{ flush }" data-on-white>
    <slot />
  </div>
</template>

<style scoped>
.paper {
  padding: var(--space-6);
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-paper);
  background: var(--paper-bg);
  box-shadow: var(--paper-shadow);
  color: var(--paper-ink);
  /* `scrollbar-color` inherits as an already-resolved value, so a drawer's pale thumb would ride
     onto the white sheet. Declared again inside the island, it resolves to the paper's own thumb,
     and the scrolling `pre` and content boxes inside inherit that. */
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.flush {
  position: relative;
  overflow: hidden;
  padding: 0;
}

/* The exact characters, as written: every Raw view on paper. */
:slotted(.view-raw) {
  margin: 0;
  color: var(--paper-ink2);
  font: var(--type-small) / 1.65 var(--font-mono);
  white-space: pre-wrap;
}
</style>
