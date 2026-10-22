<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
type BookBridge = Pick<RuntimeBridge, 'agentRulesUnread'> &
  Partial<Pick<RuntimeBridge, 'onChanged'>>
const props = defineProps<{ profileSlug: string; bridge?: BookBridge; compact?: boolean }>()
const emit = defineEmits<{ open: [profileSlug: string] }>()
const bridge = computed(() => props.bridge ?? window.api?.runtime)
const unread = ref<boolean | null>(null)
let sequence = 0
let stopped = false
let unsubscribe: (() => void) | undefined
async function read() {
  const current = ++sequence
  const profileId = props.profileSlug
  try {
    const result = await bridge.value?.agentRulesUnread({ profileId })
    if (!stopped && current === sequence) unread.value = result?.unread ?? null
  } catch {
    // Keep an existing unread notice until the app confirms it has been seen.
    if (!stopped && current === sequence && unread.value !== true) unread.value = null
  }
}
watch(
  () => props.profileSlug,
  () => {
    unread.value = null
    void read()
  },
  { immediate: true },
)
onMounted(() => {
  unsubscribe = bridge.value?.onChanged?.((change) => {
    if (change.what === 'agents') void read()
  })
})
onBeforeUnmount(() => {
  stopped = true
  sequence++
  unsubscribe?.()
})
const label = computed(() =>
  unread.value === true
    ? 'Open agent knowledge · new rule change'
    : unread.value === null
      ? "Open agent knowledge \u00b7 couldn't check for rule changes"
      : 'Open agent knowledge',
)
</script>

<template>
  <button
    type="button"
    class="book-button"
    :class="{ compact: props.compact }"
    :title="label"
    :aria-label="label"
    data-cy="agent-book-button"
    @click.stop="emit('open', props.profileSlug)"
  >
    <svg class="icon" aria-hidden="true"><use href="#i-book" /></svg>
    <span v-if="!props.compact">Book</span>
    <span
      v-if="unread === true"
      class="unread"
      data-cy="agent-book-unread"
      aria-hidden="true"
    ></span>
    <span v-else-if="unread === null" class="unknown" aria-hidden="true">?</span>
  </button>
</template>

<style scoped>
.book-button {
  display: inline-flex;
  position: relative;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--text);
  font-size: var(--type-small);
  cursor: pointer;
}
.icon {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
.unread {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.unknown {
  color: var(--muted);
}
.compact {
  width: 30px;
  min-width: 30px;
  padding: var(--space-2);
}
.compact .unread,
.compact .unknown {
  position: absolute;
  top: -3px;
  right: -3px;
}
</style>
