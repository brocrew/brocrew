<script setup lang="ts">
import { computed } from 'vue'
import { activityWords, type ActivityLine } from '../lib/agent-state'

/**
 * What the agent is doing RIGHT NOW (027) — the answer to "is it stuck or is it working?".
 *
 * ONE pill. It is replaced as the state changes and disappears when there is nothing to say,
 * because it is a statement about the present rather than a line in the transcript.
 *
 * It sits above the composer rather than in the stream, so it does not fight the streaming block's
 * caret (005) and does not push the conversation around as it changes.
 *
 * ⚠️ **This component decides NOTHING** (089). It used to hold its own map from `activity.phase` to
 * a word, which meant the app answered "what is it doing" in two places — and the two disagreed for
 * the length of every reply that followed a tool call, because `activity` is only cleared at turn
 * end while `AgentState` had already moved on to `replying`. The plate was right and the pill said
 * "RUNNING BASH" underneath it. There is now one rule, `activityLine` in `lib/agent-state.ts`,
 * feeding both; what is left here is markup. Do not re-derive anything in this file.
 */
const props = defineProps<{ line: ActivityLine | null }>()

// ⛔ **588 · the composition moved to `agent-state.ts` when a SECOND surface needed it** — the Team
// page's rows draw the same line, and this file's own rule ("Do not re-derive anything in this
// file") is the reason it is not spelled twice.
const text = computed(() => activityWords(props.line))
</script>

<template>
  <!-- `data-doing`, not `data-phase`: what it carries is the shared DOING vocabulary, and a name
       from the old one would be the same drift in an attribute. -->
  <p
    v-if="props.line"
    class="activity"
    :class="props.line.tone"
    data-cy="activity-pill"
    :data-doing="props.line.doing"
  >
    <span class="dot"></span>{{ text }}
  </p>
</template>

<style scoped>
.activity {
  display: flex;
  max-width: var(--measure-composer);
  align-items: center;
  margin: 0 auto;
  padding: var(--space-2) var(--space-9) 0;
  color: var(--accent-text-soft);
  font-size: var(--type-caption);
  gap: var(--space-3);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.activity.waiting {
  color: var(--waiting-text-label);
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  animation: pulse 1.4s ease-in-out infinite;
  background: var(--accent);
  box-shadow: var(--accent-glow);
}

.activity.waiting .dot {
  background: var(--waiting);
  box-shadow: var(--waiting-glow);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}
</style>
