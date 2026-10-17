<script setup lang="ts">
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import type { CompactionFacts } from '../lib/compaction-offer'
import type { TranscriptState } from '../lib/transcript'
import type { TranscriptMode } from '../lib/transcript-mode'
import SessionContext from './SessionContext.vue'

/**
 * Open Context from the card's context figure in the same popup shell as All tasks. Show the complete meter: gauge, reading, source, compaction history and Compact now.
 */
const props = defineProps<{
  state: TranscriptState
  shown?: TranscriptState
  mode: TranscriptMode
  provider: string
  capability: CapabilityStatus | null
  conversation: CompactionFacts | null
}>()

const emit = defineEmits<{
  close: []
  navigate: [itemId: string]
  compactNow: [intent: 'now' | 'queue']
}>()
</script>

<template>
  <section class="list-dialog" aria-labelledby="context-title" data-cy="context-dialog">
    <header class="list-head">
      <h2 id="context-title" class="bb-title">Context</h2>
      <button
        class="bb-button bb-button--icon"
        type="button"
        aria-label="Close"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>
    <div class="list-body">
      <SessionContext
        :state="props.state"
        :shown="props.shown"
        :mode="props.mode"
        :provider="props.provider"
        :capability="props.capability"
        :conversation="props.conversation"
        @navigate="(itemId) => emit('navigate', itemId)"
        @compact-now="(intent) => emit('compactNow', intent)"
      />
    </div>
  </section>
</template>

<style scoped>
.list-dialog {
  display: flex;
  width: min(560px, calc(100% - 2 * var(--lane-clear)));
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
}

.list-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--control-gap);
}

.list-head h2 {
  margin: 0;
}

/* ⚑ The meter's sections carry their own padding and rules, so the body adds none: it scrolls. */
.list-body {
  min-height: 0;
  overflow: auto;
}
</style>
