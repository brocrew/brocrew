<script setup lang="ts">
import { ref } from 'vue'
import WhatTheModelGot from './WhatTheModelGot.vue'

/**
 * 🔴 **F093 (C9 d) · "Show what the model got", under one message in the transcript** — closed by
 * default, so the transcript reads as before. ⛔ Outside the message body: its `textContent` stays
 * what was sent (001's rule).
 */
defineProps<{
  words: string
  /** The whole text the provider was handed — absent on turns from before it was kept. */
  sent?: string
  /** The paths BroBot attached to the words, as recorded. */
  attached?: readonly string[]
  together?: boolean
  why?: string
  /** Its ledger ordinal: the per-message read's address. */
  ordinal?: number
  /** The go-ahead this app sent so the agent carries on. */
  goAhead?: boolean
}>()
const open = ref(false)
</script>

<template>
  <div class="model-got">
    <button
      type="button"
      class="model-got-switch"
      :aria-expanded="open"
      data-cy="model-got-switch"
      @click="open = !open"
    >
      {{ open ? 'Hide what the model got' : 'Show what the model got' }}
    </button>
    <WhatTheModelGot
      v-if="open"
      :words="words"
      :sent="sent"
      :attached="attached"
      :together="together"
      :why="why"
      :ordinal="ordinal"
      :go-ahead="goAhead"
    />
  </div>
</template>

<style scoped>
.model-got {
  display: grid;
  margin-top: var(--space-2);
  gap: var(--space-2);
}

.model-got-switch {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
  font-size: var(--type-caption);
}

.model-got-switch:hover,
.model-got-switch:focus-visible {
  color: var(--accent-text);
}
</style>
