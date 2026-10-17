<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { EXTERNAL_MCP_EVERYONE_MEANS } from '../../../shared/external-mcp'
import { usePersonsQueue } from '../lib/persons-queue'

/**
 * The agents' requests to register an MCP server, each with what approving it would do, drawn in
 * Waiting on you, the overlay's corner and the Tools page. One component, so the three cannot draw
 * one request three ways.
 *
 * The card shows exactly what would be registered: the full address, never shortened, the agent's
 * own words about what the server can do (its claim), and who would get it. The person approves or
 * refuses it as asked; the card cannot change it. It draws the list and its hole, never a heading:
 * each place names it in its own words.
 */
const props = withDefaults(
  defineProps<{
    /** Whether this is the corner copy. */
    floating?: boolean
    /** The page's handle prefix, for the copy drawn on the Tools page. */
    place?: 'waiting' | 'tools'
  }>(),
  { floating: false, place: 'waiting' },
)

const queue = usePersonsQueue()
/**
 * The cards: each waiting request, then the ones decided here, which keep the host's words for how
 * they ended (`said`) in place of the buttons until the person dismisses them.
 */
const cards = computed(() => [
  ...(queue.serverRequests.value?.rows ?? []).map((row) => ({ row, said: null })),
  ...queue.serverRequestsSettled.value,
])

/** A look that has not answered: a request may be missing, and the list says so. */
const unread = computed(() => {
  const requests = queue.serverRequests.value
  return requests !== null && (requests.partial || requests.stale)
})

const cy = computed(() => (props.floating ? 'persons-queue' : props.place))

const list = ref<HTMLOListElement | null>(null)
/** The press whose button had the focus, which follows the card once that press is over. */
const focusFollows = ref<{ readonly requestId: string; readonly approve: boolean } | null>(null)

function press(requestId: string, approve: boolean, event: MouseEvent): void {
  focusFollows.value =
    event.currentTarget === document.activeElement ? { requestId, approve } : null
  queue.decideMcpServerRequest(requestId, approve)
}

// Once the press is over, a focus the card lost goes to its Dismiss when the request ended, or back
// to the button pressed when it still waits. A focus the person has since moved elsewhere stays.
watch(
  () => focusFollows.value !== null && !queue.deciding.has(focusFollows.value.requestId),
  async (over) => {
    const followed = focusFollows.value
    if (!over || followed === null) return
    focusFollows.value = null
    await nextTick()
    const now = document.activeElement
    if (now !== null && now !== document.body && list.value?.contains(now) !== true) return
    const button = (what: string): HTMLButtonElement | null =>
      list.value?.querySelector<HTMLButtonElement>(
        `[data-cy="${cy.value}-server-request-${what}-${followed.requestId}"]`,
      ) ?? null
    ;(button('dismiss') ?? button(followed.approve ? 'approve' : 'refuse'))?.focus()
  },
)
</script>

<template>
  <p
    v-if="unread"
    class="requests-unread"
    :class="{ floating: props.floating, tools: props.place === 'tools' }"
    :data-cy="`${cy}-server-requests-unread`"
  >
    The requests to add MCP servers could not be read just now, so one may be missing.
  </p>
  <ol
    v-if="cards.length > 0"
    ref="list"
    class="requests"
    :class="{ floating: props.floating, tools: props.place === 'tools' }"
    :data-cy="`${cy}-server-requests`"
  >
    <li
      v-for="{ row: one, said } in cards"
      :key="one.requestId"
      class="request"
      :class="{ settled: said !== null }"
      :data-cy="`${cy}-server-request-${one.requestId}`"
    >
      <p class="request-who">
        <strong>{{ one.askedBy }}</strong> asks you to add an MCP server
      </p>
      <p class="request-line">Name: {{ one.name }}</p>
      <p class="request-line">
        Address: <code class="request-url">{{ one.url }}</code> (on this computer)
      </p>
      <!-- The agent's own words, labelled as its claim, and drawn as plain text. -->
      <p class="request-line">It says this server can: “{{ one.reaches }}”</p>
      <p v-if="one.only === null" class="request-line">
        Who gets it: every agent. {{ EXTERNAL_MCP_EVERYONE_MEANS }}
      </p>
      <p v-else class="request-line">Who gets it: only {{ one.only.join(', ') }}.</p>
      <p
        v-if="said !== null"
        class="request-settled"
        :data-cy="`${cy}-server-request-settled-${one.requestId}`"
      >
        {{ said }}
      </p>
      <p v-else class="request-means">
        <span v-if="one.reopensTheAsker"
          >Approving asks this address what tools it offers, registers it if none clash with
          BroCrew's own, and reopens {{ one.askerCalled }} once it is idle so it gets them, unless
          that would stop its background work or end its planning. Other conversations get it when
          they next start or reopen.</span
        >
        <span v-else
          >Approving asks this address what tools it offers and registers it if none clash with
          BroCrew's own. The agents it names get it when their conversations next start or
          reopen.</span
        >
      </p>
      <div v-if="said !== null" class="request-controls">
        <button
          type="button"
          :data-cy="`${cy}-server-request-dismiss-${one.requestId}`"
          @click="queue.dismissServerRequest(one.requestId)"
        >
          Dismiss
        </button>
      </div>
      <template v-else>
        <!-- What the last press came to, when it left the request waiting. -->
        <p
          v-if="queue.serverRequestPressed.has(one.requestId)"
          class="request-pressed"
          :data-cy="`${cy}-server-request-pressed-${one.requestId}`"
        >
          {{ queue.serverRequestPressed.get(one.requestId) }}
        </p>
        <div class="request-controls">
          <button
            type="button"
            :data-cy="`${cy}-server-request-approve-${one.requestId}`"
            :disabled="queue.deciding.has(one.requestId)"
            @click="press(one.requestId, true, $event)"
          >
            Approve
          </button>
          <button
            type="button"
            :data-cy="`${cy}-server-request-refuse-${one.requestId}`"
            :disabled="queue.deciding.has(one.requestId)"
            @click="press(one.requestId, false, $event)"
          >
            Refuse
          </button>
        </div>
      </template>
    </li>
  </ol>
</template>

<style scoped>
/* The requests, drawn as the instruction asks beside them are: copied as declarations, since
   scoped styles share nothing with another component. */
.requests-unread {
  margin: 0;
  padding: 0 var(--space-9) var(--space-3);
  color: var(--muted);
  font-size: var(--type-caption);
}

.requests {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 var(--space-9) var(--space-5);
  gap: var(--space-3);
  list-style: none;
}

.request {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  gap: var(--space-2);
}

.request-who,
.request-line,
.request-means {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.request-means {
  color: var(--muted);
}

.request-settled,
.request-pressed {
  margin: 0;
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.request.settled {
  color: var(--muted);
}

.request-url {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.request-controls {
  display: flex;
  gap: var(--space-3);
}

/* The Tools page copy sits inside its band, which has its own gutter. */
.requests-unread.tools,
.requests.tools {
  padding: 0;
}

/* The corner copy: a row of the queue card. */
.requests-unread.floating {
  padding: 0;
  line-height: var(--leading-tight);
}

.requests.floating {
  padding: 0;
  gap: var(--space-4);
}

.requests.floating .request {
  padding: var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
}
</style>
