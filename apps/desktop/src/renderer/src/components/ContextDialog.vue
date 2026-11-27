<script setup lang="ts">
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import type { CompactionFacts } from '../lib/compaction-offer'
import type { TranscriptState } from '../lib/transcript'
import ListDialogShell from './ListDialogShell.vue'
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
  <ListDialogShell title-id="context-title" data-cy="context-dialog" @close="emit('close')">
    <template #title>Context</template>
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
  </ListDialogShell>
</template>

<style scoped>
.list-body {
  min-height: 0;
  overflow: auto;
}
</style>
