<script lang="ts">
import type { RuntimeBridge } from '../../../shared/runtime-ipc'

export interface TitleHistorySource {
  readonly read: RuntimeBridge['readConversationTitleHistory']
  readonly revision: number
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type {
  ConversationTitleHistory,
  ConversationTitleHistoryCursor,
} from '../../../shared/conversation-title'
import { fullTime } from '../lib/clock'
import { readableError } from '../lib/session-record'

type TitlePage = Extract<ConversationTitleHistory, { kind: 'titles' }>

const props = defineProps<{
  conversation: string
  who?: string
  source: TitleHistorySource
}>()

const open = ref(false)
const page = ref<TitlePage | null>(null)
const pending = ref(false)
const error = ref<string | null>(null)
let reading = 0

async function read(before?: ConversationTitleHistoryCursor): Promise<void> {
  const mine = ++reading
  const sessionId = props.conversation
  pending.value = true
  error.value = null
  try {
    const answer = await props.source.read(before ? { sessionId, before } : { sessionId })
    if (mine !== reading) return
    if (answer?.kind === 'generation-changed' && before) {
      page.value = null
      await read()
      return
    }
    if (answer?.kind !== 'titles') {
      error.value = 'Title history is unavailable.'
      return
    }
    const previous = before ? page.value : null
    page.value = previous
      ? {
          ...answer,
          titles: [...previous.titles, ...answer.titles],
          rowsUnread: previous.rowsUnread + answer.rowsUnread,
        }
      : answer
  } catch (cause) {
    if (mine === reading) error.value = readableError(cause)
  } finally {
    if (mine === reading) pending.value = false
  }
}

watch(
  [open, () => props.conversation, () => props.source.revision],
  () => {
    reading += 1
    page.value = null
    error.value = null
    pending.value = false
    if (open.value) void read()
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  reading += 1
})
</script>

<template>
  <details
    class="title-history"
    data-cy="conversation-title-history"
    @toggle="open = ($event.currentTarget as HTMLDetailsElement).open"
  >
    <summary>Title history</summary>
    <template v-if="open">
      <p v-if="error" role="alert">{{ error }}</p>
      <ol v-if="page?.titles.length">
        <li v-for="one in page.titles" :key="one.ordinal" data-cy="conversation-saved-title">
          <strong>{{ one.title }}</strong>
          <span v-if="one.author.kind === 'person'">Named by you</span>
          <span v-else>
            Named by {{ one.author.conversation === conversation && who ? who : 'an agent' }}
          </span>
          <time v-if="fullTime(one.at)">{{ fullTime(one.at) }}</time>
        </li>
      </ol>
      <p v-if="page?.rowsUnread">
        {{ page.rowsUnread }} saved {{ page.rowsUnread === 1 ? 'title' : 'titles' }} could not be
        read.
      </p>
      <p v-else-if="page && !page.titles.length && !page.next">No saved titles.</p>
      <p v-if="pending" role="status">Reading titles…</p>
      <button
        v-if="page?.next"
        type="button"
        :disabled="pending"
        data-cy="conversation-title-history-more"
        @click="read(page.next ?? undefined)"
      >
        Show older titles
      </button>
    </template>
  </details>
</template>

<style scoped>
.title-history {
  color: var(--text-soft);
  font-size: var(--type-caption);
}

summary {
  cursor: pointer;
  font-weight: var(--fw-medium);
}

ol {
  display: grid;
  margin: var(--space-3) 0;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}

li {
  display: grid;
  min-width: 0;
  overflow-wrap: anywhere;
}

li strong {
  color: var(--text);
}

time {
  color: var(--muted);
}

button {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--text-soft);
  cursor: pointer;
  font: inherit;
}

button:disabled {
  cursor: default;
}
</style>
