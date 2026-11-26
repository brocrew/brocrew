<script setup lang="ts">
import { computed } from 'vue'
import { usePersonsQueue, type WaitingOnWhoWroteRow } from '../lib/persons-queue'
import { drawnFrom } from '../lib/waiting-order'

/**
 * 🔴 **F097 · the work whose agent answered a person and waits on their next words** — the rows
 * `persons-queue.ts` carries beside the queue's (`WaitingOnWhoWroteView`), drawn in the two places the
 * queue is: *Waiting on you*, and the overlay layer's corner.
 *
 * ⛔ **One component, so the two places cannot draw one piece two ways** — `InstructionAsks`' shape.
 * ⚑ Each row names the agent, the piece and how long ago its turn answered the person, and carries
 * the stalled band's one door: the conversation, where the person's next words go
 * (`PersonsQueueDoors.open`).
 *
 * ⚠️ **It draws the list and its holes, never a heading**: each place names it in its own register —
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

/**
 * ⚑ **Asked for by the corner copy only** — `PersonsQueue`'s `leave`, for its reason: the press
 * leaves the sheet the corner is drawn over, and only the `OverlayHost` that raised it closes it.
 */
const emit = defineEmits<{ leave: [] }>()

const queue = usePersonsQueue()
const view = computed(() => queue.waitingOnWhoWrote.value)
const rows = computed(() => drawnFrom(view.value?.rows ?? [], props.only, (row) => row.key))

/** ⚑ The page's handles say `waiting`; the corner's are its queue card's. */
const cy = computed(() => (props.floating ? 'persons-queue' : 'waiting'))

/**
 * ⛔ **Leave first, travel second** — `PersonsQueue`'s `go`: a surface swapped underneath an open
 * sheet is a screen a person cannot see the result of.
 */
function open(row: WaitingOnWhoWroteRow): void {
  if (props.floating) emit('leave')
  queue.openWork(row)
}
</script>

<template>
  <!-- ⛔ **A look that did not answer** — a row may be missing, and the list says so rather than
       vanishing into an all-clear. -->
  <p
    v-if="props.floating && view?.unread"
    class="replies-short bb-queue-note"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-replies-unread`"
  >
    The work waiting on your reply could not be read just now, so a piece may be missing.
  </p>
  <!-- ⛔ **A look that answered and could not read some rows** — the one sentence every surface
       draws for that count (`rows-unread.ts`). -->
  <p
    v-if="props.floating && view?.short"
    class="replies-short bb-queue-note"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-replies-short`"
  >
    {{ view.short }}
  </p>
  <ol
    v-if="rows.length > 0"
    class="replies bb-queue-list"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-replies`"
  >
    <li
      v-for="row in rows"
      :key="row.key"
      class="reply bb-request"
      :data-cy="`${cy}-reply-${row.key}`"
    >
      <p class="reply-who">
        <strong>{{ row.agent }}</strong> is waiting on your reply · it answered you
        {{ row.since }}
      </p>
      <!-- ⚑ **The piece, by its label and its title** — `:title` carries the line whole, `530`'s
           pairing: the line is clamped, and a value that is never on screen is the defect. -->
      <p class="reply-what bb-queue-clamp" :title="`${row.label} · ${row.what}`">
        {{ row.label }} · {{ row.what }}
      </p>
      <button
        class="reply-go bb-queue-go"
        type="button"
        :data-cy="`${cy}-reply-go-${row.key}`"
        @click="open(row)"
      >
        {{ row.action }}
        <svg class="icon"><use href="#i-arrow" /></svg>
      </button>
    </li>
  </ol>
</template>

<style scoped>
.reply {
  align-items: flex-start;
}

.reply-who {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.reply-what {
  margin: 0;
}
</style>
