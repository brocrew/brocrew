<script setup lang="ts">
import { computed } from 'vue'
import { usePersonsQueue } from '../lib/persons-queue'

/**
 * ⚑ **D-017 · R19 · what an agent asked a person to approve about an identity's rules** — the asks
 * `persons-queue.ts` carries beside the queue's rows (`InstructionAsksView`), drawn in the two
 * places the queue is: *Waiting on you*, and the overlay layer's corner.
 *
 * ⛔ **One component, so the two places cannot draw one ask two ways.** It is the ask
 * `OwnInstructions` draws on its identity's sheet, decided here through the same door
 * (`decideInstruction`, handed in as the queue's door).
 *
 * ⚠️ **It draws the list and its hole, never a heading**: each place names it in its own register —
 * the page's group label, the corner's head (`cornerHead`).
 */
const props = withDefaults(
  defineProps<{
    /** ⛔ Whether this is the corner copy — `PersonsQueue`'s own prop, passed down. */
    floating?: boolean
  }>(),
  { floating: false },
)

const queue = usePersonsQueue()
const rows = computed(() => queue.asks.value?.rows ?? [])

/** ⛔ **A look that has not answered** — an ask may be missing, and the list says so. */
const unread = computed(() => {
  const asks = queue.asks.value
  return asks !== null && (asks.partial || asks.stale)
})

/** ⚑ The page keeps the handles it shipped with; the corner's are its queue card's. */
const cy = computed(() => (props.floating ? 'persons-queue' : 'waiting'))
</script>

<template>
  <p
    v-if="unread"
    class="asks-unread"
    :class="{ floating: props.floating }"
    :data-cy="props.floating ? 'persons-queue-asks-unread' : 'asks-unread'"
  >
    The asks to set agents' rules could not be read just now, so one may be missing.
  </p>
  <ol
    v-if="rows.length > 0"
    class="asks"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-asks`"
  >
    <li v-for="one in rows" :key="one.askId" class="ask" :data-cy="`${cy}-ask-${one.askId}`">
      <p class="ask-who">
        <strong>{{ one.askedBy }}</strong> asked to set the rules {{ one.about }} follows
      </p>
      <!-- ⚠️ **A CLAIM, and labelled as one** — `438`'s rule, as the sheet labels it. -->
      <p class="ask-why">It said: “{{ one.why }}”</p>
      <pre class="ask-text">{{ one.text }}</pre>
      <div class="ask-controls">
        <button
          type="button"
          :data-cy="`${cy}-ask-approve-${one.askId}`"
          @click="queue.decideInstruction(one.askId, true)"
        >
          Approve
        </button>
        <button
          type="button"
          :data-cy="`${cy}-ask-refuse-${one.askId}`"
          @click="queue.decideInstruction(one.askId, false)"
        >
          Refuse
        </button>
      </div>
    </li>
  </ol>
</template>

<style scoped>
/* ⚑ **The asks, as `OwnInstructions` draws them** — copied as declarations, for that file's own
   reason: `scoped` styles share nothing with another component. ⚠️ The page's gutter is the
   page's (`.attention-list` gives its children none); the corner's is its card's. */
.asks-unread {
  margin: 0;
  padding: 0 var(--space-9) var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
}

.asks {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 var(--space-9) var(--space-5);
  gap: var(--space-3);
  list-style: none;
}

.ask {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  gap: var(--space-2);
}

.ask-who,
.ask-why {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

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

.ask-controls {
  display: flex;
  gap: var(--space-3);
}

/* ⚑ **The corner copy: a row of the queue card** — `.pq-row`'s box and `.pq-rows`' gap, inside a
   card the corner bounds and scrolls. */
.asks-unread.floating {
  padding: 0;
  line-height: var(--leading-tight);
}

.asks.floating {
  padding: 0;
  gap: var(--space-4);
}

.asks.floating .ask {
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
}

.asks.floating .ask-text {
  max-height: 120px;
}
</style>
