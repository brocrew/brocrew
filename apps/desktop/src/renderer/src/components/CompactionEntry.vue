<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { formatTokens } from '../lib/context-meter'
import type { CompactionItem, TranscriptItem } from '../lib/transcript'

/**
 * **The compaction boundary** — one durable row per compaction, drawn where it happened (087,
 * designed in 086).
 *
 * The ruling this half of the feature exists to serve: *"the meter is a live gauge and lives in the
 * tab; the compaction boundary is a fact about history and lives in the transcript."* The meter
 * absorbs the usage stream so it never becomes rows; this is the ONE thing worth keeping — everything
 * above it is no longer in the model's head.
 *
 * ⚠️ **Neutral, not amber and not red.** It is history, not attention (a compaction is not a
 * question) and not an error (nothing went wrong). It is heavier than a `NoticeEntry` hairline
 * because silent context loss is the worst thing that can happen to a long conversation, and lighter
 * than a card because it is not asking for anything.
 */
const props = defineProps<{
  item: CompactionItem & Pick<TranscriptItem, 'at'>
  /** The provider's display name — the row cites who reported it. */
  who?: string
}>()

/**
 * The magnitude, or nothing.
 *
 * ⚠️ **Both ends or neither.** Codex reports no numbers at all, and a row that showed `≈128k → —`
 * would be worse than one that shows nothing: it invites the reader to fill in the blank. `≈` is on
 * the figures because {@link formatTokens} rounds, and a rounded number presented as exact is the
 * small lie this feature is named after.
 */
const magnitude = computed(() => {
  const { before, after } = props.item
  if (before === undefined || after === undefined) return null
  return `≈${formatTokens(before)} → ${formatTokens(after)}`
})
</script>

<template>
  <div class="compaction-boundary" data-cy="compaction-boundary">
    <div class="cb-rule">
      <span class="cb-chip">
        <svg class="icon"><use href="#i-compact" /></svg>
        <strong>Context compacted</strong>
        <span class="time" :title="fullTime(props.item.at)">{{ clockTime(props.item.at) }}</span>
      </span>
    </div>
    <p class="cb-sub">
      Earlier turns were summarized to free space — the model no longer sees them verbatim.
      <!-- Cited, not asserted: the provider and its own signal name, so a reader can tell WHERE this
           came from rather than taking our word that it happened. -->
      <b v-if="props.who">{{ props.who }}</b>
      <template v-if="props.who"> reported this on </template>
      <template v-else>Reported on </template>
      <span class="measured" data-cy="compaction-source">{{ props.item.source }}</span>
      <!-- Only when the provider gave both ends. Codex gives neither, and this simply does not
           render — which is the honest outcome, not a degraded one. -->
      <template v-if="magnitude">
        · <span class="measured" data-cy="compaction-magnitude">{{ magnitude }}</span> in context
      </template>
      <!-- A `manual` boundary records compaction requested by a person rather than triggered by a full context window. The request can come from a provider slash command typed into this app, so do not attribute it solely to an external client. -->
      <template v-if="props.item.trigger === 'manual'">
        · <span class="measured" data-cy="compaction-trigger">at someone’s request</span>
      </template>
    </p>
  </div>
</template>

<style scoped>
.compaction-boundary {
  display: flex;
  max-width: var(--measure-message);
  flex-direction: column;
  align-items: center;
  margin: var(--space-11) auto;
}

/* A dashed rule either side of the chip. Dashed rather than solid so it reads as a seam in the
   conversation rather than as a divider between two of its sections. */
.cb-rule {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-6);
}

.cb-rule::before,
.cb-rule::after {
  flex: 1;
  height: 0;
  border-top: var(--border-width) dashed var(--line-strong);
  content: '';
}

.cb-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-3) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  /* `--wash-2`, not `--wash-4`: 086 caught that `--wash-4` has no light-scope value in `tokens.css`,
     so it would inherit the dark near-transparent white and vanish on paper. */
  background: var(--wash-2);
  color: var(--muted);
  gap: var(--space-4);
}

.cb-chip .icon {
  width: 14px;
  height: 14px;
  color: var(--muted);
}

.cb-chip strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.cb-chip .time {
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.cb-sub {
  max-width: 440px;
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
  text-align: center;
}

.cb-sub b {
  color: var(--muted);
  font-weight: var(--fw-semibold);
}

.measured {
  color: var(--muted);
  font-family: var(--font-mono);
}
</style>
