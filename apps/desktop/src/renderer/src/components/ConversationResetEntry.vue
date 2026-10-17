<script setup lang="ts">
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
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
  <div class="reset-boundary" data-cy="reset-boundary">
    <div class="rb-rule">
      <span class="rb-chip">
        <svg class="icon"><use href="#i-refresh" /></svg>
        <strong>Conversation reset</strong>
        <span class="time" :title="fullTime(props.item.at)">{{ clockTime(props.item.at) }}</span>
      </span>
    </div>
    <p class="rb-sub">
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
    </p>
  </div>
</template>

<style scoped>
.reset-boundary {
  display: flex;
  max-width: var(--measure-message);
  flex-direction: column;
  align-items: center;
  margin: var(--space-11) auto;
}

/* Dashed either side of the chip, like the compaction seam — it is a break in the conversation
   rather than a divider between two of its sections. */
.rb-rule {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-6);
}

.rb-rule::before,
.rb-rule::after {
  flex: 1;
  height: 0;
  border-top: var(--border-width) dashed var(--line-strong);
  content: '';
}

.rb-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-3) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  /* `--wash-2` for the reason 086 found: `--wash-4` has no light-scope value in `tokens.css`, so it
     inherits the dark near-transparent white and vanishes on paper. */
  background: var(--wash-2);
  color: var(--muted);
  gap: var(--space-4);
}

.rb-chip .icon {
  width: 14px;
  height: 14px;
  color: var(--muted);
}

.rb-chip strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.rb-chip .time {
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.rb-sub {
  max-width: 440px;
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
  text-align: center;
}

.rb-sub b {
  color: var(--muted);
  font-weight: var(--fw-semibold);
}

.measured {
  color: var(--muted);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
</style>
