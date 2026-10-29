<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUpdates } from '../composables/useUpdates'
import { readableError } from '../lib/session-record'
const props = defineProps<{ version?: string | null; open: boolean; collapsed?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const updates = useUpdates()
const state = computed(() => updates.snapshot.value?.state ?? null)
const version = computed(() => updates.snapshot.value?.version ?? props.version ?? '')
const unavailable = computed(() => state.value?.kind === 'not-here')
const checking = ref(false)
const error = ref('')
watch(state, () => {
  error.value = ''
})
const offered = computed(() =>
  ['available', 'downloading', 'ready', 'waiting-to-restart'].includes(state.value?.kind ?? ''),
)
const label = computed(() => {
  const current = state.value
  if (error.value) return 'Check failed'
  if (current && 'version' in current && current.kind !== 'downloading')
    return `Update to ${current.version}`
  if (unavailable.value)
    return version.value.startsWith('dev') ? version.value : `dev ${version.value}`
  const base = version.value ? `v${version.value}` : 'Version'
  return current?.kind === 'idle' && current.upToDate ? `${base} ✓` : base
})
const progress = computed(() =>
  state.value?.kind === 'downloading' ? Math.max(0, Math.min(100, state.value.percent)) : null,
)
const busy = computed(() => checking.value || state.value?.kind === 'checking')
const title = computed(
  () =>
    error.value ||
    (unavailable.value
      ? 'Updates are not available in this build.'
      : busy.value
        ? 'Checking for updates…'
        : label.value),
)
async function check() {
  if (busy.value || unavailable.value) return
  checking.value = true
  error.value = ''
  try {
    await updates.checkNow()
  } catch (why) {
    error.value = readableError(why)
  } finally {
    checking.value = false
  }
}
const button = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => button.value?.focus() })
</script>
<template>
  <div class="version-control" :class="{ offered, collapsed }" data-cy="rail-version-control">
    <div class="version-line">
      <button
        ref="button"
        type="button"
        class="version-button"
        :aria-expanded="open"
        aria-haspopup="dialog"
        :aria-label="`BroCrew version and updates: ${label}`"
        :title="title"
        data-cy="rail-version"
        @click="emit('toggle')"
      >
        <span v-if="busy" class="spinner" aria-hidden="true"></span
        ><span
          v-else-if="offered"
          class="update-dot"
          aria-hidden="true"
          data-cy="rail-update-dot"
        ></span
        ><svg v-if="collapsed" class="icon" aria-hidden="true"><use href="#i-refresh" /></svg
        ><span v-else class="version-label">{{ label }}</span>
      </button>
      <button
        v-if="!offered"
        class="refresh-button"
        type="button"
        aria-label="Check for updates"
        :title="unavailable ? 'Updates are not available in this build.' : 'Check for updates'"
        :disabled="unavailable || busy"
        data-cy="rail-version-check"
        @click="check"
      >
        <svg class="icon" aria-hidden="true"><use href="#i-refresh" /></svg>
      </button>
    </div>
    <progress
      v-if="progress !== null"
      :value="progress"
      max="100"
      :aria-label="`Downloading ${Math.round(progress)}%`"
      data-cy="rail-update-progress"
    />
    <span v-if="error" class="version-error" role="alert">{{ error }}</span>
  </div>
</template>
<style scoped>
.version-control {
  position: relative;
  flex: none;
  width: 120px;
  min-height: 42px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--space-2) var(--space-1);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
}
.version-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 0;
}
.version-button,
.refresh-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  border: 0;
  background: transparent;
  color: var(--text-soft);
  padding: 0;
  font: inherit;
  font-size: var(--type-caption);
  cursor: pointer;
  min-width: 0;
}
.version-button {
  font-weight: var(--fw-semibold);
}
.version-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.refresh-button {
  flex: none;
  width: 24px;
  height: 26px;
  border-left: var(--border-width) solid var(--line);
  padding-left: var(--space-2);
  color: var(--accent-text);
}
.refresh-button:disabled {
  color: var(--faint);
  cursor: default;
}
.icon {
  width: 16px;
  height: 16px;
  flex: none;
}
.offered {
  border-color: var(--accent);
  background: var(--accent-fill);
}
.offered .version-button {
  color: var(--accent-text);
}
.update-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  flex: none;
  animation: turn 1s linear infinite;
}
progress {
  width: 100%;
  height: 3px;
  margin-top: var(--space-1);
}
.version-error {
  position: absolute;
  bottom: calc(100% + var(--space-4));
  right: 0;
  width: var(--rail-menu-w);
  padding: var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--panel);
  color: var(--danger-text-notice);
  z-index: 30;
  overflow-wrap: anywhere;
}
.collapsed {
  width: 42px;
}
.collapsed .refresh-button {
  display: none;
}
@keyframes turn {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
