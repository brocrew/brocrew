<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
type BookBridge = Pick<RuntimeBridge, 'agentRulesUnread'> &
  Partial<Pick<RuntimeBridge, 'onChanged' | 'agentOwnNotesUnread'>>
const props = defineProps<{ profileSlug: string; bridge?: BookBridge; compact?: boolean }>()
const emit = defineEmits<{ open: [profileSlug: string] }>()
const bridge = computed(() => props.bridge ?? window.api?.runtime)
const unread = ref<boolean | null>(null)
let sequence = 0
let stopped = false
let unsubscribe: (() => void) | undefined
function read() {
  const current = ++sequence
  const profileId = props.profileSlug
  const values: (boolean | undefined)[] = [undefined, undefined]
  const update = () => {
    if (stopped || current !== sequence) return
    unread.value = values.some((value) => value === true)
      ? true
      : values.every((value) => value === false)
        ? false
        : unread.value === true
          ? true
          : null
  }
  const sources = [
    () => bridge.value?.agentRulesUnread({ profileId }),
    () =>
      bridge.value?.agentOwnNotesUnread
        ? bridge.value.agentOwnNotesUnread({ profileId })
        : Promise.resolve({ unread: false }),
  ]
  for (const [index, source] of sources.entries()) {
    try {
      void Promise.resolve(source())
        .then((result) => {
          values[index] = result?.unread
          update()
        })
        .catch(update)
    } catch {
      update()
    }
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
const status = computed(() =>
  unread.value === true
    ? 'Unread changes'
    : unread.value === null
      ? "Couldn't check for changes"
      : undefined,
)
const label = computed(() =>
  unread.value === true
    ? 'Open agent knowledge · unread changes'
    : unread.value === null
      ? "Open agent knowledge \u00b7 couldn't check for changes"
      : 'Open agent knowledge',
)
</script>

<template>
  <button
    type="button"
    class="book-button"
    :class="{ compact: props.compact }"
    :title="label"
    :aria-label="props.compact ? 'Open agent knowledge' : label"
    :aria-description="props.compact ? status : undefined"
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
  color: var(--text);
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
