<script setup lang="ts">
import { computed } from 'vue'
import { usePersonsQueue } from '../lib/persons-queue'
import { OPEN_THE_CONVERSATION } from '../lib/taking-over'
import { drawnFrom } from '../lib/waiting-order'
import StandingRuleAsk from './StandingRuleAsk.vue'

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
    /** The one card this copy draws, by key, where the page draws its cards one at a time. */
    only?: string
  }>(),
  { floating: false, only: undefined },
)

const queue = usePersonsQueue()
const rows = computed(() => drawnFrom(queue.asks.value?.rows ?? [], props.only, (one) => one.askId))

/** A look that has not answered, said by the corner; the page says it for the whole list. */
const unread = computed(() => {
  const asks = queue.asks.value
  return props.floating && asks !== null && (asks.partial || asks.stale)
})

/** ⚑ The page keeps the handles it shipped with; the corner's are its queue card's. */
const cy = computed(() => (props.floating ? 'persons-queue' : 'waiting'))
</script>

<template>
  <p
    v-if="unread"
    class="asks-unread bb-queue-note"
    :class="{ floating: props.floating }"
    :data-cy="props.floating ? 'persons-queue-asks-unread' : 'asks-unread'"
  >
    The asks to set agents' rules could not be read just now, so one may be missing.
  </p>
  <ol
    v-if="rows.length > 0"
    class="asks bb-queue-list"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-asks`"
  >
    <StandingRuleAsk
      v-for="one in rows"
      :key="one.askId"
      :why="one.why"
      :text="one.text"
      :cy="`${cy}-ask-${one.askId}`"
      :approve-cy="`${cy}-ask-approve-${one.askId}`"
      :refuse-cy="`${cy}-ask-refuse-${one.askId}`"
      :compact="props.floating"
      @decide="queue.decideInstruction(one.askId, $event)"
    >
      <template #who>
        <strong>{{ one.askedBy }}</strong> asked to set the rules {{ one.about }} follows
      </template>
      <button
        v-if="!floating"
        type="button"
        class="pq-go pq-door"
        :data-cy="`${cy}-ask-open-${one.askId}`"
        @click="queue.openWork(one)"
      >
        {{ OPEN_THE_CONVERSATION }}
        <svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>
      </button>
    </StandingRuleAsk>
  </ol>
</template>
