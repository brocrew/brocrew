<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import {
  COMPACT_IT,
  COMPACT_LINE,
  COMPACT_NOW,
  compactHeading,
  compactionOffer,
  KEEP_EVERYTHING,
  type CompactionFacts,
} from '../lib/compaction-offer'

/**
 * Place Compact now beside the context figure. Reuse the Context popup's `compactionOffer` gate, provider capability, conversation send facts, person-only action, confirmation and `compactNow` intent.
 */
const props = defineProps<{
  capability: CapabilityStatus | null
  conversation: CompactionFacts | null
}>()

const emit = defineEmits<{ compactNow: [intent: 'now' | 'queue'] }>()

const offer = computed(() => compactionOffer(props.capability, props.conversation))

/** ⚑ The confirm, open or shut — shut whenever what the answer would do changes under it. */
const confirming = ref(false)
watch(
  () => (offer.value.offered ? offer.value.intent : null),
  (intent, before) => {
    if (intent !== before) confirming.value = false
  },
)
const heading = computed(() => (offer.value.offered ? compactHeading(offer.value.intent) : ''))
const why = computed(() =>
  offer.value.offered ? COMPACT_NOW : `${offer.value.lead} ${offer.value.why}`,
)

function compactIt(): void {
  const now = offer.value
  // ⛔ Read BEFORE the door is shut: an answer with no open question, or a withdrawn offer, sends
  // nothing.
  const open = confirming.value
  confirming.value = false
  if (open && now.offered) emit('compactNow', now.intent)
}
</script>

<template>
  <button
    type="button"
    class="compact-press"
    :disabled="!offer.offered"
    :aria-expanded="confirming"
    :title="why"
    :aria-label="why"
    data-cy="card-run-compact"
    @click="offer.offered && (confirming = !confirming)"
  >
    <svg class="icon" aria-hidden="true"><use href="#i-compact" /></svg>
  </button>
  <!-- ⚑ A sibling of the press, so in the card's wrapping row it takes a line of its own under it. -->
  <div
    v-if="confirming && offer.offered"
    class="compact-door"
    role="group"
    :aria-label="heading"
    data-cy="card-compact-door"
  >
    <p class="door-copy">
      <strong data-cy="card-compact-heading">{{ heading }}</strong>
      <small>{{ COMPACT_LINE }}</small>
    </p>
    <div class="door-acts">
      <button
        type="button"
        class="door-keep"
        data-cy="card-compact-keep"
        @click="confirming = false"
      >
        {{ KEEP_EVERYTHING }}
      </button>
      <button type="button" class="door-compact" data-cy="card-compact-it" @click="compactIt">
        {{ COMPACT_IT }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.compact-press {
  display: inline-grid;
  width: 22px;
  height: 22px;
  padding: 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--accent);
  cursor: pointer;
  place-items: center;
}

.compact-press:disabled {
  color: var(--faint);
  cursor: default;
}

.compact-press:hover:not(:disabled),
.compact-press[aria-expanded='true'] {
  border-color: var(--accent-border);
}

.compact-press .icon {
  width: 12px;
  height: 12px;
}

.compact-door {
  display: grid;
  flex-basis: 100%;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
  gap: var(--space-3);
}

.door-copy {
  display: grid;
  margin: 0;
  gap: var(--space-1);
}

.door-copy strong {
  color: var(--text);
  font-size: var(--type-small);
}

.door-copy small {
  color: var(--muted);
  font-size: var(--type-caption);
}

.door-acts {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.door-keep,
.door-compact {
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--type-caption);
}

.door-compact {
  border-color: var(--accent-border);
  background: var(--accent-mix-10);
  color: var(--accent-text);
}
</style>
