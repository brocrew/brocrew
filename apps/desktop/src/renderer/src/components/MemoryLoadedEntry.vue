<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import type { MemoryLoadedItem, TranscriptItem } from '../lib/transcript'

const props = withDefaults(
  defineProps<{
    item: MemoryLoadedItem & Pick<TranscriptItem, 'at'>
    canOpenStore?: boolean
  }>(),
  { canOpenStore: false },
)

const emit = defineEmits<{ (event: 'openInstructions'): void }>()

const indexName = computed(
  () => props.item.index.split('/').filter(Boolean).slice(-1)[0] ?? props.item.index,
)

const store = computed(() => {
  const cut = props.item.index.lastIndexOf('/')
  return cut <= 0 ? '' : props.item.index.slice(0, cut)
})
</script>

<template>
  <div class="memory-loaded" data-cy="memory-loaded">
    <div class="ml-head">
      <svg class="icon"><use href="#i-file" /></svg>
      <strong data-cy="memory-loaded-heading">
        This conversation opened with this profile’s memory index in the prompt
      </strong>
      <span class="time" :title="fullTime(props.item.at)">{{ clockTime(props.item.at) }}</span>
    </div>

    <p class="ml-by" data-cy="memory-loaded-by">
      The provider puts this file in front of the model itself, before the first message. This app
      did not put it there and does not see the prompt the provider builds.
    </p>

    <p class="ml-sub" data-cy="memory-loaded-provenance">
      This app looked at that store as this session was launched — it read this index and listed
      what sits beside it, so this row could name them. Nothing here is a tool call.
    </p>

    <div class="ml-name" data-cy="memory-loaded-name">
      <span class="ml-file">{{ indexName }}</span>
      <span v-if="store" class="ml-in">in {{ store }}</span>
    </div>
    <div class="ml-path" data-cy="memory-loaded-path">{{ props.item.index }}</div>

    <p v-if="props.item.beside > 0" class="ml-beside" data-cy="memory-loaded-beside">
      {{ props.item.beside }} {{ props.item.beside === 1 ? 'memory sat' : 'memories sat' }} beside
      it in this store as this session was launched — which the agent reads only if it chooses to.
    </p>

    <button
      v-if="props.canOpenStore"
      class="ml-link"
      type="button"
      data-cy="memory-loaded-open-store"
      @click="emit('openInstructions')"
    >
      Where this profile keeps its memory
      <svg class="icon arrow"><use href="#i-arrow" /></svg>
    </button>
  </div>
</template>

<style scoped>
.memory-loaded {
  max-width: var(--measure-message);
  margin: var(--space-9) 0;
  padding: var(--space-5) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
}

.ml-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.ml-head .icon {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--muted);
}

.ml-head strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.ml-head .time {
  margin-left: auto;
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.ml-by {
  margin: var(--space-4) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.ml-sub {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.ml-name {
  display: flex;
  align-items: baseline;
  margin-top: var(--space-5);
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.ml-in {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.ml-path {
  color: var(--faint);
  cursor: text;
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  user-select: all;
}

.ml-beside {
  margin: var(--space-4) 0 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  line-height: 1.5;
}

.ml-link {
  display: inline-flex;
  align-items: center;
  margin-top: var(--space-5);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text-soft);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-2);
}

.ml-link:hover {
  text-decoration: underline;
}

.ml-link .arrow {
  width: 11px;
  height: 11px;
  color: var(--accent);
}
</style>
