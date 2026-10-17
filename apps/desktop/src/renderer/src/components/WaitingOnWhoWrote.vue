<script setup lang="ts">
import { computed } from 'vue'
import { usePersonsQueue, type WaitingOnWhoWroteRow } from '../lib/persons-queue'

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
  }>(),
  { floating: false },
)

/**
 * ⚑ **Asked for by the corner copy only** — `PersonsQueue`'s `leave`, for its reason: the press
 * leaves the sheet the corner is drawn over, and only the `OverlayHost` that raised it closes it.
 */
const emit = defineEmits<{ leave: [] }>()

const queue = usePersonsQueue()
const view = computed(() => queue.waitingOnWhoWrote.value)
const rows = computed(() => view.value?.rows ?? [])

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
    v-if="view?.unread"
    class="replies-short"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-replies-unread`"
  >
    The work waiting on your reply could not be read just now, so a piece may be missing.
  </p>
  <!-- ⛔ **A look that answered and could not read some rows** — the one sentence every surface
       draws for that count (`rows-unread.ts`). -->
  <p
    v-if="view?.short"
    class="replies-short"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-replies-short`"
  >
    {{ view.short }}
  </p>
  <ol
    v-if="rows.length > 0"
    class="replies"
    :class="{ floating: props.floating }"
    :data-cy="`${cy}-replies`"
  >
    <li v-for="row in rows" :key="row.key" class="reply" :data-cy="`${cy}-reply-${row.key}`">
      <p class="reply-who">
        <strong>{{ row.agent }}</strong> is waiting on your reply · it answered you
        {{ row.since }}
      </p>
      <!-- ⚑ **The piece, by its label and its title** — `:title` carries the line whole, `530`'s
           pairing: the line is clamped, and a value that is never on screen is the defect. -->
      <p class="reply-what" :title="`${row.label} · ${row.what}`">
        {{ row.label }} · {{ row.what }}
      </p>
      <button
        class="reply-go"
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
/* ⚑ **The rows, as `InstructionAsks` draws its own** — copied as declarations, for that file's
   reason: `scoped` styles share nothing with another component. ⚠️ The page's gutter is the page's
   (`.attention-list` gives its children none); the corner's is its card's. */
.replies-short {
  margin: 0;
  padding: 0 var(--space-9) var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
}

.replies {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 var(--space-9) var(--space-5);
  gap: var(--space-3);
  list-style: none;
}

.reply {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  gap: var(--space-2);
}

.reply-who {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

/* ⚑ **The piece's line, clamped** — `.pq-stall-what`'s declarations: a title can be long. */
.reply-what {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* ⚑ **The stalled band's button** — `.pq-go`'s declarations, the same press. */
.reply-go {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel);
  font-size: var(--type-caption);
  gap: var(--space-2);
}

.reply-go .icon {
  width: 10px;
  height: 10px;
}

/* ⚑ **The corner copy: a row of the queue card** — `.pq-row`'s box and `.pq-rows`' gap, inside a
   card the corner bounds and scrolls. */
.replies-short.floating {
  padding: 0;
  line-height: var(--leading-tight);
}

.replies.floating {
  padding: 0;
  gap: var(--space-4);
}

.replies.floating .reply {
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
}
</style>
