<script setup lang="ts">
import { computed } from 'vue'
import { NEEDING_WORD, summonsAttention, type AgentFacets } from '../lib/agent-state'

/**
 * 🔴 **The shelf under the conversation's header** — a question or permission that needs a person,
 * in its own row and its own colour. Each provider's usage is the title bar's (`TitleUsage`), and
 * what the agent is doing now ends the header's status line.
 *
 * ## The attention row
 *
 * Pending human attention stays apart from ordinary activity, so the activity does not compete
 * with it: the row renders `NEEDING_WORD` and never an activity string. Only a question or a
 * permission may summon attention (`summonsAttention`).
 */
const props = defineProps<{
  /** The three facets, from the one input the plate and the pill are also drawn from. */
  facets: AgentFacets
}>()

/**
 * The closed set, and it is the product's own: two kinds summon attention and nothing else does —
 * not a completion, not an error, not a long-running task, not a plan waiting for a go-ahead.
 */
const attention = computed<string | null>(() => {
  const needing = props.facets.needing
  return needing !== undefined && summonsAttention(needing) ? NEEDING_WORD[needing] : null
})
</script>

<template>
  <section
    class="session-shelf"
    :class="{ quiet: attention === null }"
    data-cy="session-shelf"
    aria-label="This session"
  >
    <!-- Its own element, its own colour, and it renders no activity string. -->
    <p
      v-if="attention"
      class="shelf-attention"
      data-cy="shelf-attention"
      :data-needing="props.facets.needing"
    >
      {{ attention }}
    </p>
  </section>
</template>

<style scoped>
.session-shelf {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  padding: 0 var(--space-12) var(--space-8);
  border-bottom: var(--border-width) solid var(--line);
  background: var(--panel);
  gap: var(--space-6);
}

/* With nothing waiting, the shelf is only the line under the header. */
.session-shelf.quiet {
  padding: 0;
}

.shelf-attention {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--waiting);
  border-radius: var(--radius-sm);
  color: var(--waiting-text-label);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  gap: var(--space-4);
}
</style>
