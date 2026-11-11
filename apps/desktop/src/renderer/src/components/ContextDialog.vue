<script setup lang="ts">
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import type { CompactionFacts } from '../lib/compaction-offer'
import type { TranscriptState } from '../lib/transcript'
import SessionContext from './SessionContext.vue'

const props = defineProps<{
  state: TranscriptState
  shown?: TranscriptState

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
        :provider="props.provider"
        :capability="props.capability"
        :conversation="props.conversation"
        @navigate="(itemId) => emit('navigate', itemId)"
        @compact-now="(intent) => emit('compactNow', intent)"
      />
    </div>
  </section>
</template>

<style scoped src="./dialog-presentation.css"></style>

<style scoped>
.list-body {
  min-height: 0;
  overflow: auto;
}
</style>
