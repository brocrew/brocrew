<script setup lang="ts">
import type { LibraryPage } from '../../../shared/runtime-ipc'
import { A_PROVIDER_FOLDER } from '../../../shared/runtime-ipc'
import type { Constraint } from '../lib/library-filters'

/** The library's empty list: emptied by filters, by a search, on a first run, or with nothing found. */
defineProps<{
  filtered: boolean
  searching: boolean
  firstRun: boolean
  counts: LibraryPage['counts'] | null
  query: string
  scopeNote: string | null
  constraints: readonly Constraint[]
}>()

const emit = defineEmits<{
  dropConstraint: [constraint: Constraint]
  clearFilters: []
  clearSearch: []
}>()
</script>

<template>
  <div class="empty" data-cy="library-empty">
    <template v-if="filtered">
      <div class="mk" aria-hidden="true">⌗</div>
      <h2 data-cy="library-filtered-empty">No conversations match this combination</h2>
      <p>
        Nothing
        <template v-if="counts">across your {{ counts.total }} conversations </template>
        matches all these filters. Remove one.
      </p>

      <p v-if="scopeNote" class="scope" data-cy="library-filtered-scope">{{ scopeNote }}</p>
      <div class="constraints" data-cy="library-constraints">
        <button
          v-for="constraint in constraints"
          :key="constraint.key"
          type="button"
          class="cons-chip"
          :data-cy="`library-constraint-${constraint.key}`"
          :aria-label="`Remove ${constraint.chip}`"
          @click="emit('dropConstraint', constraint)"
        >
          {{ constraint.chip }} <span aria-hidden="true">×</span>
        </button>
      </div>
      <div class="relax">
        <button
          type="button"
          class="prim"
          data-cy="library-clear-filters"
          @click="emit('clearFilters')"
        >
          Clear filters
        </button>

        <button
          v-if="searching"
          type="button"
          data-cy="library-empty-clear-search"
          @click="emit('clearSearch')"
        >
          Clear search
        </button>
      </div>
    </template>

    <template v-else-if="searching">
      <div class="mk" aria-hidden="true">?</div>
      <h2 data-cy="library-no-match">Nothing matches “{{ query.trim() }}”</h2>

      <p>
        No title, first message, working directory or provider name
        <template v-if="counts">across your {{ counts.total }} conversations </template>
        contains that. Try fewer words, or a directory name.
      </p>

      <p v-if="scopeNote" class="scope" data-cy="library-search-scope">{{ scopeNote }}</p>
    </template>

    <template v-else-if="firstRun">
      <div class="mk" aria-hidden="true">◇</div>
      <h2 data-cy="library-first-run">Nothing swept yet</h2>
      <p>No conversations yet. Start one with New conversation.</p>
    </template>

    <template v-else>
      <h2>No conversations to show</h2>
      <p>None here or in {{ A_PROVIDER_FOLDER }}.</p>
    </template>
  </div>
</template>

<style scoped>
.empty {
  max-width: 440px;
  margin: var(--space-12) 0 0;
}

/* ⚠️ Not `--brand-mark-border`/`--brand-mark-fg`: both are defined in dark only, so the mark would
   have kept a blue rim and blue glyph on paper. The fill has a light value and the accent pair
   below it does too. */
.mk {
  display: grid;
  width: 34px;
  height: 34px;
  margin-bottom: var(--space-6);
  border: var(--border-width) solid var(--accent-border);
  border-radius: var(--radius-lg);
  background: var(--brand-mark-bg);
  color: var(--accent-text);
  font-size: var(--type-reading);
  place-items: center;
}

.empty h2 {
  margin: 0 0 var(--space-4);
  color: var(--text-soft);
  font-size: var(--type-reading);
  font-weight: var(--fw-semibold);
}

.empty p {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

/* Every constraint that produced this empty list, each one a real control that drops itself. A
   chip drawn with an × that does nothing is 106's unwired control at chip scale. */
.constraints {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-5) 0 0;
  gap: var(--space-3);
}

.cons-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--accent-2);
  border-radius: var(--radius-sm);
  background: var(--info-bg);
  color: var(--accent-2-text);
  cursor: pointer;
  font-size: var(--type-caption);
  gap: var(--space-2);
}

/* The filter's own indigo, as the facet row above it: never the warm accent. */
.cons-chip:hover {
  background: var(--info-bg);
  border-color: var(--accent-2);
}

.relax {
  display: flex;
  flex-wrap: wrap;
  margin: var(--space-6) 0 0;
  gap: var(--space-3);
}

.relax button {
  padding: var(--space-2) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--type-small);
}

.relax button:hover {
  background: var(--wash-2);
  color: var(--text-soft);
}

/* The likelier of the two hatches carries the accent, because the facets are what a person just
   set — but it is a border, not a fill: Import is this surface's one accent CTA and staying that
   way is 104's rule. */
.relax .prim {
  border-color: var(--accent-border);
  color: var(--accent-text-soft);
}

.relax .prim:hover {
  background: var(--accent-fill);
  color: var(--accent-text);
}

.empty p + p {
  margin-top: var(--space-4);
  color: var(--faint);
}

/* ⛔ **What the read could not look at, beside the claim about what it did** (329 §4.4). It would
   inherit `.empty p + p` above today, and says its own register anyway: an inherited rule is one
   reorder away from silently changing what this sentence looks like. Quieter than the claim it
   qualifies and NOT a caution — it reports the bound of a read, not something that went wrong. */
.scope {
  color: var(--faint);
}
</style>
