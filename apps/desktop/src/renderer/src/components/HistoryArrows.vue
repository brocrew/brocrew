<script setup lang="ts">
import { computed } from 'vue'
import { usePlaceNavigator } from '../composables/usePlaceNavigator'
import { platformHere } from '../lib/this-computer'

/** Back and Forward through the places this window has shown, in the window's top strip. */
const navigator = usePlaceNavigator()
const mac = /mac/i.test(platformHere())
const backKey = mac ? '⌘[' : 'Alt+←'
const forwardKey = mac ? '⌘]' : 'Alt+→'

const backTitle = computed(() => {
  const to = navigator?.backTo.value ?? null
  return to === null ? `Back (${backKey})` : `Back to ${to} (${backKey})`
})
const forwardTitle = computed(() => {
  const to = navigator?.forwardTo.value ?? null
  return to === null ? `Forward (${forwardKey})` : `Forward to ${to} (${forwardKey})`
})
</script>

<template>
  <div v-if="navigator" class="history-arrows">
    <button
      type="button"
      class="arrow"
      data-cy="nav-back"
      :disabled="navigator.backTo.value === null"
      :aria-label="backTitle"
      :title="backTitle"
      @click="navigator.back()"
    >
      <svg class="icon back" aria-hidden="true"><use href="#i-arrow" /></svg>
    </button>
    <button
      type="button"
      class="arrow"
      data-cy="nav-forward"
      :disabled="navigator.forwardTo.value === null"
      :aria-label="forwardTitle"
      :title="forwardTitle"
      @click="navigator.forward()"
    >
      <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
    </button>
  </div>
</template>

<style scoped>
.history-arrows {
  display: flex;
  flex: none;
  align-items: center;
  margin-left: var(--space-3);
  gap: var(--space-1);
}

/* The strip drags the window; a button that said nothing would be dragged with it. */
.arrow {
  display: grid;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--titlebar-ink, var(--muted));
  place-items: center;
  -webkit-app-region: no-drag;
}

.arrow:hover:not(:disabled) {
  background: var(--wash-5);
}

.arrow:disabled {
  opacity: 0.35;
}

.icon {
  width: 12px;
  height: 12px;
}

.icon.back {
  transform: scaleX(-1);
}
</style>
