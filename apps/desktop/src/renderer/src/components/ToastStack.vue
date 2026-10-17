<script setup lang="ts">
import { useOverlays } from '../lib/overlay-store'

/**
 * What just happened, bottom-right, briefly.
 *
 * In Slice 2 almost everything it says is what did NOT happen — a confirm that is not wired says
 * so here. That is the point: the alternative to an honest toast is a button that looks like it
 * worked.
 */
const overlays = useOverlays()
</script>

<template>
  <!-- Set a light scope on the toast stack because it is fixed to the app frame rather than hosted in an overlay. Its background and shadow tokens must work over paper surfaces. -->
  <div class="toast-stack" data-cy="toast-stack" data-chat-theme="light">
    <button
      v-for="toast in overlays.toasts.value"
      :key="toast.id"
      class="toast"
      type="button"
      data-cy="toast"
      @click="overlays.dismiss(toast.id)"
    >
      <!-- `#i-info`, not the `i-help` that was never in the sprite and painted nothing (089). A
           toast states what just happened — or, here, what deliberately did not — which is the `i`
           rather than a question mark. (Written without its `#` on purpose: the sprite test reads
           prose and markup alike, and it is right to.) -->
      <svg class="icon"><use href="#i-info" /></svg>
      <span>{{ toast.text }}</span>
    </button>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  right: var(--space-9);
  bottom: var(--space-9);
  z-index: 100;
  display: flex;
  width: 300px;
  flex-direction: column;
  /* Same as the two carriers above (346). The chip below declares `--text-soft` for itself, so this
     changes no pixel today — it is here so a toast that adds an element cannot inherit the chrome's
     near-white onto paper. */
  color: var(--text);
  gap: var(--space-4);
}

.toast {
  display: grid;
  min-height: 46px;
  align-items: center;
  padding: var(--space-5) var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-toast);
  background: var(--toast-bg);
  box-shadow: var(--toast-shadow);
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-4);
  grid-template-columns: 18px 1fr;
  line-height: 1.4;
  text-align: left;
}

.icon {
  width: 15px;
  height: 15px;
  color: var(--faint);
}
</style>
