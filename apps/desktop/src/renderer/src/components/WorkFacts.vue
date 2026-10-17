<script setup lang="ts">
import type { WorkReading } from '../lib/work-report'
import StateBadge from './StateBadge.vue'

/**
 * 🔴 **The glance — one line, and the whole of HO-019 §2's property** (406).
 *
 * ## ⛔ Its own component because TWO rows carry it, and they must not diverge
 *
 * ⚠️ **A reply to a BUSY parent is drawn as a queued row first** and as a work report when it
 * flushes. ⛔ If the queued row omitted this line, the one fact a decision hangs on would be
 * invisible for as long as the parent's turn runs — which is exactly the window in which a person
 * is watching the conversation. ⚑ One owner, and it is stated rather than counted now: **every
 * surface that draws how a piece of work is going draws this line.**
 *
 * ## 🔴 508 · it takes the READING, and it used to take the report
 *
 * ⛔ **A third caller is not a report at all.** The Work tab's rows are {@link WorkGivenOut},
 * derived NOW from the same {@link PieceRow} fields rather than copied off a message BroBot sent —
 * so a prop typed `WorkReport` would have forced either a cast or a second copy of the three-element
 * markup, and the markup is the thing this component exists to keep from diverging.
 *
 * ⚑ **The words are still {@link workReading}'s and there is still one of them.** What moved is
 * WHERE it is called: at each caller, over whatever carrier that caller holds. ⚠️ That is the same
 * shape `panelEmptyWords` has — a words function the surface calls — and it is what let
 * `work-given-out.ts` spread the reading onto its row instead of re-deriving it in a template.
 *
 * ## 🔴 What is on it, and what may never be
 *
 *  - **The outcome, coloured by `StateBadge`** — the one place a state's colour is decided, so
 *    `done` is the same green everywhere and this component carries no colour of its own.
 *  - **The state word** when there is no outcome to draw, which is every report that is not a
 *    reply. ⚠️ Never *"nothing needed"*: an absent claim on a report that is not `answered` means
 *    *nobody has said* — see `personsPart`.
 *  - **The mark**, present only when an agent said a person must act. ⛔ **Achromatic.** The status
 *    grammar's amber means *frozen, waiting for a human*, and finished work is neither; painting
 *    this amber would merge it with what `401` and `403` built.
 *
 * ⛔ **No control, no count, no live region.** Nothing here summons anybody: it is a record of
 * what an agent said, and the difference between the two rows HO-019 §2 names is whether this line
 * has one child or two.
 */
defineProps<{
  /** ⛔ **The words, already read** — {@link workReading}'s answer, from whichever carrier. */
  reading: WorkReading
}>()
</script>

<template>
  <p class="wr-facts" data-cy="work-facts">
    <!-- ⚠️ **Wrapped, and the wrapper is not decoration.** `StateBadge`'s root is a `v-for`, so a
         `data-cy` written on the tag is a fallthrough attribute onto a fragment and lands on
         NOTHING — found in the DOM project, where the query came back null. ⛔ The badge keeps its
         own `state-taskOutcome` handle; this one names the slot on THIS row. -->
    <span v-if="reading.outcome" class="wr-outcome" data-cy="work-report-outcome">
      <StateBadge :task-outcome="reading.outcome" />
    </span>
    <!-- ⚑ **The cause when there is one, the state word otherwise** — see `WorkReading.word`. -->
    <span v-else class="wr-word" data-cy="work-report-word">{{ reading.word }}</span>
    <span v-if="reading.mark" class="wr-mark" data-cy="work-report-mark">
      <svg class="icon"><use href="#i-user" /></svg>
      {{ reading.mark }}
    </span>
  </p>
</template>

<style scoped>
.wr-outcome {
  display: inline-flex;
}

/* ⚠️ **No `flex-wrap`, and its absence is a decision.** It was here, and the row verifier could
   not kill it: this line holds at most TWO children — an outcome badge and the mark — and a stall,
   which is the only report with a long pill, can never carry a mark (the claim requires
   `answered`). ⛔ `a-line-no-mutation-can-kill-is-not-carrying-its-rule`: a guard no mutation can
   trip is not carrying its rule, and a third chip here is a change that has to look at this line
   anyway. */
.wr-facts {
  display: flex;
  margin: var(--space-3) 0 0;
  align-items: center;
  gap: var(--space-4);
}

/* The state word, for a report with no outcome to draw — a stall, or a state this app cannot
   produce today. Neutral: it is a fact about where the work is, not a verdict on it. */
.wr-word {
  display: inline-flex;
  height: 20px;
  align-items: center;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  white-space: nowrap;
}

/* ⛔ **Achromatic, and every declaration here is load-bearing.** No `--waiting` token, so the
   amber channel stays the attention channel's; a SOLID border and `--text-soft` ink, so it is not
   the dashed `--faint` mark this app uses for "not built yet"; and the same 20px pill height as
   `StateBadge`, so the two sit on one line and the row does not grow when a report has both. */
.wr-mark {
  display: inline-flex;
  height: 20px;
  align-items: center;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  gap: var(--space-3);
  white-space: nowrap;
}

.wr-mark .icon {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
}
</style>
