<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import OwnInstructions from './OwnInstructions.vue'
import SavedMethods from './SavedMethods.vue'
import MemoryBook from './MemoryBook.vue'
import type { AgentStore } from '../lib/agent-store'
import type { RuntimeBridge } from '../../../shared/runtime-ipc'
const props = defineProps<{
  profileSlug: string
  agentName?: string | null
  store?: AgentStore
  bridge?: RuntimeBridge
}>()
const emit = defineEmits<{ close: [] }>()
const tabs = [
  { key: 'rules', name: 'Standing rules' },
  { key: 'methods', name: 'Saved methods' },
  { key: 'memory', name: 'Memory' },
] as const
const selected = ref<(typeof tabs)[number]['key']>('rules')
const nav = ref<HTMLElement | null>(null)
const id = useId()
watch(
  () => props.profileSlug,
  () => {
    selected.value = 'rules'
  },
)
function move(event: KeyboardEvent) {
  const index = tabs.findIndex((tab) => tab.key === selected.value)
  const next =
    event.key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft'
        ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : null
  if (next === null) return
  event.preventDefault()
  selected.value = tabs[next]!.key
  nav.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
</script>

<template>
  <section class="agent-book" data-cy="agent-sections-sheet" data-subject="agent">
    <header>
      <svg class="glyph-icon" aria-hidden="true"><use href="#i-book" /></svg>
      <div class="title">
        <strong>Agent knowledge</strong><span>{{ props.agentName ?? props.profileSlug }}</span>
      </div>
      <button
        type="button"
        class="close"
        aria-label="Close agent knowledge"
        data-cy="close-overlay"
        @click="emit('close')"
      >
        <svg aria-hidden="true"><use href="#i-x" /></svg>
      </button>
    </header>
    <nav ref="nav" role="tablist" aria-label="Agent knowledge" @keydown="move">
      <button
        v-for="tab in tabs"
        :id="`${id}-tab-${tab.key}`"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="selected === tab.key"
        :aria-controls="`${id}-panel-${tab.key}`"
        :tabindex="selected === tab.key ? 0 : -1"
        :data-cy="`agent-book-tab-${tab.key}`"
        @click="selected = tab.key"
      >
        {{ tab.name }}
      </button>
    </nav>
    <div class="book-body">
      <!-- Keep each editor mounted while switching sections so unsaved text and confirmations stay intact. -->
      <section
        v-show="selected === 'rules'"
        :id="`${id}-panel-rules`"
        role="tabpanel"
        :aria-labelledby="`${id}-tab-rules`"
        tabindex="0"
      >
        <OwnInstructions
          :profile-slug="props.profileSlug"
          :store="props.store"
          :bridge="props.bridge"
          heading="Standing rules"
        />
        <p>Read the rules for a conversation inside that conversation.</p>
      </section>
      <section
        v-show="selected === 'methods'"
        :id="`${id}-panel-methods`"
        role="tabpanel"
        :aria-labelledby="`${id}-tab-methods`"
        tabindex="0"
      >
        <SavedMethods :profile-slug="props.profileSlug" :bridge="props.bridge" />
      </section>
      <section
        v-show="selected === 'memory'"
        :id="`${id}-panel-memory`"
        role="tabpanel"
        :aria-labelledby="`${id}-tab-memory`"
        tabindex="0"
      >
        <MemoryBook :profile-slug="props.profileSlug" :bridge="props.bridge" />
      </section>
    </div>
  </section>
</template>

<style scoped>
.agent-book {
  display: flex;
  flex-direction: column;
  width: min(780px, calc(100% - 2 * var(--lane-clear)));
  max-height: 88vh;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}
header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
}
.glyph-icon {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  color: var(--accent);
}
.title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}
.title span {
  font-size: var(--type-small);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
}
.close svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
}
nav button {
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--muted);
  cursor: pointer;
}
nav button[aria-selected='true'] {
  color: var(--text);
  border-color: var(--accent);
}
.book-body {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-7);
}
.agent-book .book-body :deep(h3) {
  margin: 0;
  color: inherit;
  font-size: var(--type-heading);
  font-weight: var(--fw-bold);
  letter-spacing: normal;
  text-transform: none;
}
.book-body > section {
  min-width: 0;
}
</style>
