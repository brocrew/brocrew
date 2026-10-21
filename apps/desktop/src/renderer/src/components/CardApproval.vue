<script setup lang="ts">
import { FIXED_SAYS, type ApprovalControl } from '../composables/useConversationControls'
const props = defineProps<{ approval: ApprovalControl }>()
const emit = defineEmits<{ choose: [mode: 'ask' | 'auto'] }>()
function choose(event: Event): void {
  const input = event.target as HTMLInputElement
  const mode = input.checked ? 'auto' : 'ask'
  if (props.approval.changeable && !props.approval.saving) emit('choose', mode)
}
</script>
<template>
  <label class="card-approval" :title="props.approval.changeable ? props.approval.now : FIXED_SAYS">
    <span>Ask</span>
    <input
      class="mode-switch"
      type="checkbox"
      role="switch"
      aria-label="Auto mode"
      data-cy="card-approval"
      :data-mode="props.approval.mode"
      :data-changeable="props.approval.changeable"
      :data-pending="props.approval.pending ?? ''"
      :checked="(props.approval.pending ?? props.approval.mode) === 'auto'"
      :disabled="!props.approval.changeable || props.approval.saving"
      @change="choose"
    />
    <span>Auto</span>
  </label>
</template>
<style scoped>
.card-approval {
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-left: auto;
  gap: var(--space-3);
  font-size: var(--type-small);
}
.mode-switch {
  width: 36px;
  height: 22px;
  flex: none;
  margin: 0;
  appearance: none;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--panel-2);
  background-image: radial-gradient(circle, var(--muted) 0 7px, transparent 7.5px);
  background-position: left 2px center;
  background-repeat: no-repeat;
  background-size: 18px 18px;
  cursor: pointer;
}
.mode-switch:checked {
  border-color: var(--accent);
  background-color: var(--accent);
  background-image: radial-gradient(circle, var(--panel) 0 7px, transparent 7.5px);
  background-position: right 2px center;
}
.mode-switch:focus-visible {
  outline: var(--border-accent-width) solid var(--accent);
  outline-offset: var(--space-1);
}
</style>
