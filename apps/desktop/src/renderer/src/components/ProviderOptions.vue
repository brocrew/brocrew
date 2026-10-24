<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
defineProps<{ name: string }>()
const emit = defineEmits<{ setup: [] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
function outside(event: Event): void {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
function setup(): void {
  open.value = false
  emit('setup')
}
function key(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  event.stopPropagation()
  open.value = false
  root.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div ref="root" class="provider-options" @keydown="key">
    <button
      type="button"
      class="options-button"
      data-cy="provider-options"
      :aria-label="`${name} options`"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg class="icon" aria-hidden="true"><use href="#i-more" /></svg>
    </button>
    <div v-if="open" class="options-menu" role="menu" :aria-label="`${name} options`">
      <button type="button" role="menuitem" data-cy="provider-set-up" @click="setup">
        Set up {{ name }}
      </button>
    </div>
  </div>
</template>
<style scoped>
.provider-options {
  position: relative;
  margin-left: auto;
  flex: none;
}
.options-button {
  display: grid;
  place-items: center;
  width: var(--control-icon);
  height: var(--control-icon);
  padding: 0;
  background: var(--accent-fill);
  border-color: var(--accent-border-weak);
  color: var(--accent-text);
}
.options-menu {
  position: absolute;
  right: 0;
  top: calc(100% + var(--space-2));
  z-index: 2;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--shadow);
  white-space: nowrap;
}
.options-menu button {
  border: 0;
  background: transparent;
  color: var(--text);
  padding: var(--space-4) var(--space-6);
}
</style>
