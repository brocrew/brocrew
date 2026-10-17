<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { TASK_STATES, type TaskState } from '../../../shared/tasks'
import { WORK_STATE_WORD } from '../../../shared/work-state-words'
import type {
  WorkSearchHit,
  WorkSearchPage,
  WorkSearchQuery,
  WorkSearchResult,
} from '../../../shared/work-search'
import { WORK_SEARCH_REFUSAL_WORDS, WORK_SEARCH_WORDS } from '../../../shared/work-search-words'
import OverlayHost from './OverlayHost.vue'

const props = defineProps<{
  conversation: string
  canOpen: boolean
  search: (query: WorkSearchQuery) => Promise<WorkSearchResult>
}>()
const emit = defineEmits<{ close: []; openWork: [hit: WorkSearchHit] }>()
const scope = ref<'mine' | 'this-conversation' | 'all'>('this-conversation')
const state = ref<TaskState | ''>('')
const words = ref('')
const result = ref<WorkSearchPage | null>(null)
const failure = ref<string | null>(null)
const busy = ref(false)
let request = 0

watch([() => props.conversation, scope, state, words], () => {
  request++
  result.value = null
  failure.value = null
  busy.value = false
})
onBeforeUnmount(() => {
  request++
})

async function runSearch(more = false): Promise<void> {
  if (busy.value) return
  const cursor = more ? result.value?.next_cursor : null
  if (more && !cursor) return
  const mine = ++request
  busy.value = true
  failure.value = null
  try {
    const answer = await props.search({
      scope: scope.value,
      ...(state.value === '' ? {} : { state: state.value }),
      words: words.value,
      limit: 20,
      ...(cursor ? { cursor } : {}),
    })
    if (mine !== request) return
    if (!answer.ok) {
      failure.value =
        WORK_SEARCH_REFUSAL_WORDS[answer.reason] ?? WORK_SEARCH_REFUSAL_WORDS.unavailable
      return
    }
    const previous = more ? result.value : null
    result.value =
      previous === null
        ? answer.page
        : {
            ...answer.page,
            hits: [
              ...new Map(
                [...previous.hits, ...answer.page.hits].map((hit) => [hit.piece, hit]),
              ).values(),
            ],
            searched: previous.searched + answer.page.searched,
            rows_unread: previous.rows_unread + answer.page.rows_unread,
            ledgers_skipped: previous.ledgers_skipped + answer.page.ledgers_skipped,
            complete:
              previous.rows_unread === 0 && previous.ledgers_skipped === 0 && answer.page.complete,
          }
  } catch {
    if (mine === request) failure.value = WORK_SEARCH_REFUSAL_WORDS.unavailable
  } finally {
    if (mine === request) busy.value = false
  }
}
</script>

<template>
  <OverlayHost :label="WORK_SEARCH_WORDS.action" @close="emit('close')">
    <section class="work-search" data-cy="work-search">
      <h2>{{ WORK_SEARCH_WORDS.action }}</h2>
      <form class="query" @submit.prevent="runSearch()">
        <input
          v-model="words"
          type="search"
          maxlength="200"
          :aria-label="WORK_SEARCH_WORDS.input"
          :placeholder="WORK_SEARCH_WORDS.input"
          data-cy="work-search-words"
        />
        <select v-model="scope" :aria-label="WORK_SEARCH_WORDS.action" data-cy="work-search-scope">
          <option value="mine">{{ WORK_SEARCH_WORDS.mine }}</option>
          <option value="this-conversation">{{ WORK_SEARCH_WORDS.conversation }}</option>
          <option value="all">{{ WORK_SEARCH_WORDS.all }}</option>
        </select>
        <select v-model="state" :aria-label="WORK_SEARCH_WORDS.states" data-cy="work-search-state">
          <option value="">{{ WORK_SEARCH_WORDS.states }}</option>
          <option v-for="one in TASK_STATES" :key="one" :value="one">
            {{ WORK_STATE_WORD[one] }}
          </option>
        </select>
        <button type="submit" :disabled="busy" data-cy="work-search-submit">
          {{ WORK_SEARCH_WORDS.search }}
        </button>
      </form>
      <p v-if="failure !== null" role="alert" data-cy="work-search-failure">{{ failure }}</p>
      <template v-if="result !== null">
        <p v-if="result.hits.length === 0" data-cy="work-search-empty">
          {{ WORK_SEARCH_WORDS.empty }}
        </p>
        <ol class="hits" data-cy="work-search-hits">
          <li v-for="hit in result.hits" :key="hit.piece">
            <component
              :is="props.canOpen === false ? 'div' : 'button'"
              v-bind="props.canOpen === false ? {} : { type: 'button' }"
              class="hit"
              :title="hit.title ?? hit.label"
              data-cy="work-search-hit"
              @click="props.canOpen !== false && emit('openWork', hit)"
            >
              <strong
                >{{ hit.label }}<template v-if="hit.title"> · {{ hit.title }}</template
                ><template v-if="hit.clipped.title"> (clipped)</template></strong
              >
              <span
                >{{
                  hit.state === null
                    ? `conversation: ${hit.conversation_state ?? 'unknown'}`
                    : WORK_STATE_WORD[hit.state]
                }}
                · {{ hit.owner.name ?? hit.owner.profile ?? 'an agent this app cannot name' }}</span
              >
              <span v-if="hit.definition_of_done !== undefined"
                >Done when: {{ hit.definition_of_done ?? 'Not recorded' }}</span
              >
              <span v-if="hit.status"
                >Status: {{ hit.status
                }}<template v-if="hit.clipped.status"> (clipped)</template></span
              >
              <span v-if="hit.result"
                >Result: {{ hit.result.outcome
                }}<template v-if="hit.result.summary"> · {{ hit.result.summary }}</template
                ><template v-if="hit.clipped.result"> (clipped)</template></span
              >
            </component>
          </li>
        </ol>
        <p v-if="result.rows_unread > 0 || result.ledgers_skipped > 0" data-cy="work-search-unread">
          {{ WORK_SEARCH_WORDS.unread }}
        </p>
        <p v-if="result.next_cursor !== null" data-cy="work-search-older">
          {{ WORK_SEARCH_WORDS.older }}
        </p>
        <button
          v-if="result.next_cursor !== null"
          type="button"
          :disabled="busy"
          data-cy="work-search-more"
          @click="runSearch(true)"
        >
          {{ WORK_SEARCH_WORDS.more }}
        </button>
        <p>{{ WORK_SEARCH_WORDS.changing }}</p>
      </template>
    </section>
  </OverlayHost>
</template>

<style scoped>
.work-search {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: min(48rem, calc(100vw - var(--space-8)));
  max-height: 80vh;
  overflow-y: auto;
  padding: var(--space-6);
}
h2,
p {
  margin: 0;
}
.query {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
input {
  flex: 1 1 100%;
  min-width: 0;
}
input,
select,
button {
  font: inherit;
  color: var(--text);
  background: var(--panel);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}
select {
  min-width: 0;
  flex: 1 1 auto;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.6;
}
.hits {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.hit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  gap: var(--space-2);
  text-align: left;
  overflow-wrap: anywhere;
}
</style>
