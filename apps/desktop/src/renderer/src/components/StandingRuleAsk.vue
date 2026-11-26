<script setup lang="ts">
import MarkdownWords from './MarkdownWords.vue'
/**
 * One ask from an agent to set an identity's rules: who asked and about what (the caller's own
 * line), the reason it gave, labelled as its claim, the proposed rules, and Approve and Refuse.
 * Waiting on you, the overlay corner and the identity's own sheet all draw an ask with this, so
 * one ask never looks two ways. Each caller decides through its own door and may add controls.
 */
withDefaults(
  defineProps<{
    why: string
    text: string
    /** Handles the caller's tests already use. */
    cy: string
    approveCy: string
    refuseCy: string
    whyCy?: string
    busy?: boolean
    /** The overlay corner's denser row. */
    compact?: boolean
  }>(),
  { whyCy: undefined, busy: false, compact: false },
)

const emit = defineEmits<{ decide: [approve: boolean] }>()
</script>

<template>
  <li class="ask bb-request" :class="{ compact }" :data-cy="cy">
    <p class="ask-who"><slot name="who" /></p>
    <MarkdownWords class="ask-why" :data-cy="whyCy" lead="It said:" :text="'“' + why + '”'" />
    <MarkdownWords class="ask-text" :text="text" />
    <div class="ask-controls">
      <button type="button" :disabled="busy" :data-cy="approveCy" @click="emit('decide', true)">
        Approve
      </button>
      <button type="button" :disabled="busy" :data-cy="refuseCy" @click="emit('decide', false)">
        Refuse
      </button>
      <slot />
    </div>
  </li>
</template>

<style scoped>
.ask-who,
.ask-why {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

/* Rules are prose with newlines and can be long; the page itself must never scroll sideways. */
.ask-text {
  max-height: 200px;
  margin: 0;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  font: inherit;
  overflow: auto;
  white-space: pre-wrap;
}

.ask.compact .ask-text {
  max-height: 120px;
}

.ask-controls {
  display: flex;
  gap: var(--space-3);
}
</style>
