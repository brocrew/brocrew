<script setup lang="ts">
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'

/**
 * A seam in the conversation: a dashed rule either side of a chip that names what happened and
 * when, and a sentence under it. Compaction and a provider reset are both drawn by this.
 */
defineProps<{
  /** A sprite symbol, `#i-…`. */
  icon: string
  title: string
  at: number
}>()
</script>

<template>
  <div class="seam">
    <div class="seam-rule">
      <span class="seam-chip">
        <svg class="icon"><use :href="icon" /></svg>
        <strong>{{ title }}</strong>
        <span class="time" :title="fullTime(at)">{{ clockTime(at) }}</span>
      </span>
    </div>
    <p class="seam-sub">
      <slot />
    </p>
  </div>
</template>

<style scoped>
.seam {
  display: flex;
  max-width: var(--measure-message);
  flex-direction: column;
  align-items: center;
  margin: var(--space-11) auto;
}

/* Dashed rather than solid, so it reads as a seam in the conversation rather than a divider
   between two of its sections. */
.seam-rule {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-6);
}

.seam-rule::before,
.seam-rule::after {
  flex: 1;
  height: 0;
  border-top: var(--border-width) dashed var(--line-strong);
  content: '';
}

.seam-chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-3) 13px;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  /* `--wash-2`, not `--wash-4`: `--wash-4` has no light-scope value in `tokens.css`, so it would
     inherit the dark near-transparent white and vanish on paper. */
  background: var(--wash-2);
  color: var(--muted);
  gap: var(--space-4);
}

.seam-chip .icon {
  width: 14px;
  height: 14px;
  color: var(--muted);
}

.seam-chip strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.seam-chip .time {
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.seam-sub {
  max-width: 440px;
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
  text-align: center;
}

.seam-sub :slotted(b) {
  color: var(--muted);
  font-weight: var(--fw-semibold);
}
</style>
