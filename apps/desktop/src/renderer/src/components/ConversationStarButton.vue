<script setup lang="ts">
import { computed } from 'vue'
import { useConversationStars, type StarTarget } from '../composables/useConversationStars'

const props = defineProps<{ target: StarTarget }>()
const stars = useConversationStars()
const starred = computed(() => stars?.isStarred(props.target))
</script>

<template>
  <button
    v-if="starred !== undefined"
    class="conversation-star"
    type="button"
    aria-label="Star conversation"
    :aria-pressed="starred"
    :title="starred ? 'Unstar conversation' : 'Star conversation'"
    data-cy="conversation-star"
    @click.stop="stars?.set(props.target, !starred)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    </svg>
  </button>
</template>

<style scoped>
.conversation-star {
  display: inline-grid;
  flex: none;
  width: var(--space-10);
  height: var(--space-10);
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-soft);
}

.conversation-star:hover {
  background: var(--wash-4);
}

.conversation-star[aria-pressed='true'] {
  color: var(--accent-text);
}

.conversation-star svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  fill: none;
  stroke: currentColor;
  stroke-width: var(--icon-stroke);
  stroke-linejoin: round;
}

.conversation-star[aria-pressed='true'] svg {
  fill: currentColor;
}
</style>
