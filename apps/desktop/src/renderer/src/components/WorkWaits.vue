<script setup lang="ts">
import { computed } from 'vue'
import { LOOK, usePersonsQueue } from '../lib/persons-queue'
import { TAKE_BACK } from '../lib/take-back'
import type { TodoRow } from '../lib/work-waits'
import { drawnFrom } from '../lib/waiting-order'
import TodoCard from './TodoCard.vue'
import CloseWorkButton from './CloseWorkButton.vue'

/**
 * One of the three lists Waiting on you draws of work that waits on a person, needs a look, or is
 * being picked back up: the to-dos an agent asked of a person, answered here; the pieces no agent is
 * driving; and each recovery. One component, so the page and the corner draw each the same way. It
 * draws the list and its hole, never a heading: the page names it.
 */
const props = withDefaults(
  defineProps<{
    part: 'todos' | 'incidents' | 'recoveries'
    /** Whether this is the corner copy. */
    floating?: boolean
    /** The one card this copy draws, by key, where the page draws its cards one at a time. */
    only?: string
  }>(),
  { floating: false, only: undefined },
)
const emit = defineEmits<{ leave: [] }>()

const queue = usePersonsQueue()
const waits = computed(() => queue.workWaits.value)
const cy = computed(() => (props.floating ? 'persons-queue' : 'waiting'))

/** The work list's cards, for the two parts that list pieces. */
const cards = computed(() =>
  props.part === 'todos'
    ? []
    : drawnFrom(queue.workCards.value[props.part], props.only, ({ entry }) => entry.key),
)
const todoCards = computed(() =>
  drawnFrom(queue.todoCards.value, props.only, (card) => card.row.key),
)
const workPart = computed(() => (props.part === 'recoveries' ? 'recoveries' : 'incidents'))

const unreadSays: Record<typeof props.part, string> = {
  todos:
    'The last look for what agents asked you to do did not answer, so some may not be shown here.',
  incidents:
    'The last look for work that needs you did not answer, so some, or work being picked back up, may not be shown here.',
  recoveries: '',
}

/** A look that did not answer, said by the corner; the page says it for the whole list. */
const unread = computed(() => props.floating && waits.value[props.part].unread)

function openTodo(row: TodoRow): void {
  if (props.floating) emit('leave')
  queue.openWork(row)
}
</script>

<template>
  <p
    v-if="unread"
    class="waits-unread bb-queue-note"
    :class="{ floating }"
    :data-cy="`${cy}-${part}-unread`"
  >
    {{ unreadSays[part] }}
  </p>
  <p
    v-if="floating && waits[part].short"
    class="waits-unread bb-queue-note"
    :class="{ floating }"
    :data-cy="`${cy}-${part}-short`"
  >
    {{ waits[part].short }}
  </p>
  <ol
    v-if="part === 'todos' && todoCards.length > 0"
    class="waits bb-queue-list"
    :class="{ floating }"
    :data-cy="`${cy}-todos`"
  >
    <li
      v-for="card in todoCards"
      :key="card.row.key"
      class="wait bb-request"
      :class="{ settled: card.taken }"
    >
      <TodoCard :card="card" :cy="cy" open-conversation @open="openTodo(card.row)" />
    </li>
  </ol>
  <ol
    v-if="cards.length > 0"
    class="waits bb-queue-list"
    :class="{ floating }"
    :data-cy="`${cy}-${part}`"
  >
    <li
      v-for="{ entry: one, listed, pending, said } in cards"
      :key="one.key"
      class="wait bb-request"
      :class="{ settled: !listed }"
      :data-kind="one.kind"
      :data-cy="`${cy}-${part}-${one.key}`"
    >
      <p class="wait-says" :data-cy="`${cy}-${part}-says-${one.key}`">{{ one.says }}</p>
      <div v-if="listed || pending" class="wait-controls">
        <button
          v-if="one.mayTakeBack"
          type="button"
          :disabled="pending"
          :data-cy="`${cy}-${part}-take-back-${one.key}`"
          @click="queue.takeBackEntry(workPart, one)"
        >
          {{ TAKE_BACK }}
        </button>
        <CloseWorkButton
          v-if="part === 'incidents' && one.kind === 'stopped'"
          :piece="one.key"
          :disabled="pending"
          :cy="`${cy}-${part}-close-${one.key}`"
        />
        <button
          v-if="listed"
          type="button"
          class="wait-door"
          :data-cy="`${cy}-${part}-look-${one.key}`"
          @click="queue.openWork(one)"
        >
          {{ LOOK }}
          <svg class="icon"><use href="#i-arrow" /></svg>
        </button>
      </div>
      <p
        v-if="said !== null"
        class="wait-said"
        role="status"
        :data-cy="`${cy}-${part}-said-${one.key}`"
      >
        {{ said }}
      </p>
      <div v-if="!listed && !pending" class="wait-controls">
        <button
          type="button"
          :data-cy="`${cy}-${part}-dismiss-${one.key}`"
          @click="queue.dismissEntry(workPart, one)"
        >
          Dismiss
        </button>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.wait.settled {
  color: var(--muted);
}

.wait-text,
.wait-says,
.wait-said {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.wait-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.wait-controls .icon {
  width: 10px;
  height: 10px;
}
</style>
