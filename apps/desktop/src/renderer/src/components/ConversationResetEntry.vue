<script setup lang="ts">
import TranscriptSeam from './TranscriptSeam.vue'
import type { ResetItem, TranscriptItem } from '../lib/transcript'

/**
 * **The conversation reset boundary** — one durable row per reset, drawn where it happened (199,
 * from 192 H5).
 *
 * A sibling of `CompactionEntry` on purpose, because the fact is a sibling: both say *"the model no
 * longer has what is above this line"*. The difference is the degree, and it is the whole reason
 * this row exists rather than reusing that one — a compaction SUMMARIZED the earlier turns, and a
 * reset dropped them and opened a different provider conversation to carry on in. A reader looking
 * at a seam has to be able to tell those apart.
 *
 * ⚠️ **Neutral, not amber and not red**, on `CompactionEntry`'s reasoning: it is history, not
 * attention, and nothing went wrong — `/clear` is a thing the user asked for. It is heavier than a
 * `NoticeEntry` hairline because the identity of the conversation changed underneath them.
 *
 * ⛔ **It names the new conversation id**, and that is not decoration. It is the value the session
 * will be RESUMED from, so it is the one thing on this row a reader can cross-check against the
 * session header or an exported file when they want to know which conversation they are in.
 */
const props = defineProps<{
  item: ResetItem & Pick<TranscriptItem, 'at'>
  /** The provider's display name — the row cites who reported it. */
  who?: string
}>()
</script>

<template>
  <TranscriptSeam
    data-cy="reset-boundary"
    icon="#i-refresh"
    title="Conversation reset"
    :at="props.item.at"
  >
    The provider started a new conversation here — everything above this line is gone from the
    model, not summarized.
    <!-- Cited, not asserted, exactly as the compaction row does it: the provider and its own
         signal name, so a reader can tell WHERE this came from. -->
    <b v-if="props.who">{{ props.who }}</b>
    <template v-if="props.who"> reported this on </template>
    <template v-else>Reported on </template>
    <span class="measured" data-cy="reset-source">{{ props.item.source }}</span>
    · continuing in
    <span class="measured" data-cy="reset-session-id">{{ props.item.sessionId }}</span>
  </TranscriptSeam>
</template>

<style scoped>
.measured {
  color: var(--muted);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
</style>
