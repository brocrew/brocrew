<script setup lang="ts">
import { computed } from 'vue'
import { foldWindow, type WindowState } from '../lib/transcript-window'
import { markReadOnly } from '../lib/transcript'
import TranscriptView from './TranscriptView.vue'

const props = defineProps<{
  history: WindowState
  title: string
  loadOlder: () => Promise<void>
}>()
const transcript = computed(() => {
  const read = foldWindow(props.history.entries)
  markReadOnly(read, 'Read-only.')
  return read
})
</script>

<template>
  <section
    class="linked-history"
    data-cy="linked-history"
    data-read-only="true"
    data-chat-theme="light"
  >
    <header class="linked-history-head">
      <h2>{{ title }}</h2>
      <p>Read-only.</p>
    </header>
    <p v-if="transcript.items.length === 0">This conversation has nothing to show.</p>
    <TranscriptView
      v-else
      :items="transcript.items"
      mode="normal"
      :recorded="true"
      :has-older="history.hasOlder"
      :turn-aligned="history.turnAligned"
      :load-older="history.hasOlder ? loadOlder : undefined"
      :can-read-images="false"
      :can-open-images="false"
      :can-open-child-work="false"
      :can-open-workflow-output="false"
      :can-restore-queued="false"
    />
  </section>
</template>

<style scoped>
.linked-history {
  display: flex;
  width: min(900px, calc(100% - 2 * var(--lane-clear)));
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
}
.linked-history-head {
  display: grid;
  flex: none;
  padding: var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--space-4);
}
.linked-history-head > button {
  justify-self: start;
}
.linked-history-head > p,
.linked-history > p {
  color: var(--muted);
}
.linked-history-head > h2 {
  margin: 0;
  color: var(--text);
  font-size: var(--type-heading);
}
@media (max-width: 1000px) {
  .linked-history {
    width: min(calc(1000px - 2 * var(--lane-clear)), calc(100% - 2 * var(--space-8)));
  }
}
</style>
