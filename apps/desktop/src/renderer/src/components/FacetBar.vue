<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { LibraryCounts, LibraryFilters } from '../../../shared/runtime-ipc'
import {
  KIND_OPTIONS,
  ORIGIN_OPTIONS,
  STATE_TOGGLES,
  anyFilter,
  providerOptions,
  stateCount,
  type StateKey,
} from '../lib/library-filters'

/**
 * **The facet row** (121, to `120` §2/§3) — three identity facets always visible, five state
 * predicates behind a disclosure, and a pinned declaration that the list is narrowed.
 *
 * ## It lives in the sticky head, and that is the design
 *
 * `120` §3: *"a filtered list that looks unfiltered is `086`'s fabricated number in a new hat."*
 * Three layers stop that, and this component is two of them — the row never scrolls away (it is
 * inside `.lib-top`, which does not scroll), active facets take an **accent fill** rather than a
 * quiet pressed state, and a `N match · Clear all` rides the right of the row whenever anything is
 * on, whether the result is bounded or complete.
 *
 * ## ⛔ Never amber
 *
 * `080` reserves amber for the attention channel — a question waiting on the person. A filter is
 * not a question, so the whole surface is blue: `--accent` for on, the ordinary panel ramp for off.
 * The amber on this screen belongs to a ROW asking to be rebuilt, and it stays there.
 *
 * ## Native controls, on purpose
 *
 * The three facets are `<select>`s and the state group is a `<details>`. `120`'s mock draws custom
 * popovers; a custom popover is also an outside-click handler, a focus trap and a keyboard map
 * written by hand, and every one of those is a way for a control to look pressable and not be
 * (`106`). The browser's own disclosure gets all of it right, and `SessionLibrary` already uses one
 * for the skipped-files footnote.
 */

const props = defineProps<{
  filters: LibraryFilters
  /** The whole-library tally — where the Provider options come from. Null before the first read. */
  counts: LibraryCounts | null
  /** How many rows matched `query ∧ filters`, counted main-side BEFORE the page was sliced. */
  matched: number | null
  /**
   * Whether only archived conversations are shown. Held beside `filters`, because the window
   * applies it to the rows in hand: main's filters have no key for it.
   */
  archived?: boolean
}>()

const emit = defineEmits<{
  'update:filters': [filters: LibraryFilters]
  'update:archived': [archived: boolean]
  /** Clear both axes — filters and the search box. The row's own clears are separate (120 §4). */
  clearAll: []
}>()

const providers = computed(() => providerOptions(props.counts))
const active = computed(() => anyFilter(props.filters))
const states = computed(() => stateCount(props.filters))

/**
 * Set or drop one facet. The empty option is not a value: `''` means "do not narrow by this", and
 * it is sent as an ABSENT key rather than as an empty string, because main-side an absent field is
 * what "unfiltered" means and a `''` provider would match nothing at all.
 */
function pick(key: 'provider' | 'origin' | 'kind', value: string): void {
  const next: LibraryFilters = { ...props.filters }
  if (value === '') delete next[key]
  // The cast is the one place a facet's string becomes its typed value. Every option rendered here
  // came from a typed list, so the set is closed — and the wire validates it again anyway (ipc.ts).
  else next[key] = value as never
  emit('update:filters', next)
}

/** Turn one of the five on or off. Off is an absent key, for the same reason as above. */
function toggle(key: StateKey, on: boolean): void {
  const next: LibraryFilters = { ...props.filters }
  if (on) next[key] = true
  else delete next[key]
  emit('update:filters', next)
}

/**
 * Getting OUT of the disclosure — the half a native `<details>` does not do (review).
 *
 * Escape returns focus to the summary, because a control that closes under the cursor and leaves
 * focus on nothing is worse than one that will not close. The outside-press listener exists only
 * while the panel is open, so the page carries no handler for a popover nobody has opened.
 */
const stateBox = ref<HTMLDetailsElement | null>(null)

function closeState(): void {
  const box = stateBox.value
  if (box === null || !box.open) return
  box.open = false
  box.querySelector('summary')?.focus()
}

function pressedOutside(event: Event): void {
  const box = stateBox.value
  if (box !== null && !event.composedPath().includes(box)) box.open = false
}

function watchOutside(): void {
  if (stateBox.value?.open === true) document.addEventListener('pointerdown', pressedOutside)
  else document.removeEventListener('pointerdown', pressedOutside)
}

// A panel left open by a navigation must not leave its listener on the document.
onUnmounted(() => document.removeEventListener('pointerdown', pressedOutside))
</script>

<template>
  <div class="facets" :data-active="active ? 'yes' : 'no'" data-cy="library-facets">
    <label class="facet" :class="{ on: filters.provider !== undefined }">
      <span class="k">Provider</span>
      <select
        data-cy="library-facet-provider"
        aria-label="Filter by provider"
        :value="filters.provider ?? ''"
        @change="pick('provider', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in providers" :key="option.value" :value="option.value">
          {{ option.label }}{{ option.total === null ? '' : ` (${option.total})` }}
        </option>
      </select>
    </label>

    <label class="facet" :class="{ on: filters.origin !== undefined }">
      <span class="k">Origin</span>
      <select
        data-cy="library-facet-origin"
        aria-label="Filter by where the conversation came from"
        :value="filters.origin ?? ''"
        @change="pick('origin', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in ORIGIN_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </label>

    <!-- The marquee (111→119): "is this a sub-agent" is the question five dispatches were about,
         and it is one facet away now instead of being read off a chip row by row. -->
    <label class="facet" :class="{ on: filters.kind !== undefined }">
      <span class="k">Kind</span>
      <select
        data-cy="library-facet-kind"
        aria-label="Filter by whether another conversation spawned it"
        :value="filters.kind ?? ''"
        @change="pick('kind', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in KIND_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </label>

    <!-- ⛔ FIVE separate predicates, and the disclosure hides the clutter rather than the
         distinction (061 finding 6). A closed disclosure still declares itself: the summary wears
         the accent fill and a count badge, so a state filter is never invisible. -->
    <!-- ⚠️ **Escape closes it, and a press outside closes it** (121 review). Native `<details>`
         does neither, and the argument for using one was that a hand-written popover is a focus
         map somebody has to get right — which is true of opening it and says nothing about getting
         out. A keyboard user who tabbed in had no way back but Shift+Tab, and a mouse user
         clicking a row underneath hit the panel and got nothing. -->
    <details
      ref="stateBox"
      class="facet state"
      :class="{ on: states > 0 }"
      data-cy="library-facet-state"
      @keydown.esc.stop.prevent="closeState"
      @toggle="watchOutside"
    >
      <summary>
        <span class="k">State</span>
        <span v-if="states > 0" class="badge" data-cy="library-state-count">{{ states }}</span>
      </summary>
      <div class="pop">
        <p class="p-head">State — each is its own filter</p>
        <label v-for="item in STATE_TOGGLES" :key="item.key" class="opt">
          <input
            type="checkbox"
            :data-cy="`library-state-${item.key}`"
            :checked="filters[item.key] === true"
            @change="toggle(item.key, ($event.target as HTMLInputElement).checked)"
          />
          <span class="l">{{ item.label }}</span>
          <span class="why">{{ item.why }}</span>
        </label>
        <p class="p-note">
          Readable, on-disk and complete are three separate facts about a conversation. They stay
          three filters.
        </p>
      </div>
    </details>

    <label class="facet check" :class="{ on: props.archived }">
      <input
        type="checkbox"
        data-cy="library-facet-archived"
        :checked="props.archived"
        @change="emit('update:archived', ($event.target as HTMLInputElement).checked)"
      />
      <span class="k">Archived</span>
    </label>

    <span class="spacer"></span>

    <!-- The always-visible declaration that this list is narrowed — present whether the result is
         bounded or complete, and it counts `matched` (whole library, pre-slice), never the rows on
         screen. `200 of 200` is therefore not a sentence this surface can say. -->
    <span v-if="active" class="pinned" data-cy="library-filter-count">
      <strong>{{ matched === null ? '—' : matched.toLocaleString() }}</strong> match
      <button type="button" class="clear" data-cy="library-clear-all" @click="emit('clearAll')">
        Clear all
      </button>
    </span>
  </div>
</template>

<style scoped>
.facets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.facet {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
  gap: var(--space-2);
}

.facet .k {
  color: var(--faint);
}

/* On = the indigo ramp. ⛔ Never amber: amber is the attention channel, and a filter is not a
   question — so not the warm accent either, which sits too close to it beside a "behind" warning. */
.facet.on {
  border-color: var(--accent-2);
  background: var(--info-bg);
}

.facet.on .k {
  color: var(--accent-2-text);
}

.facet select {
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font: inherit;
  font-weight: var(--fw-medium);
  cursor: pointer;
}

.facet.on select {
  color: var(--accent-2-text);
}

.facet.check {
  cursor: pointer;
}

.facet.check input {
  margin: 0;
}

/* The disclosure. `position: relative` so its panel is placed against the summary rather than
   against the page, and the panel is out of flow so opening it moves nothing in the head. */
.facet.state {
  position: relative;
  padding: 0;
}

.facet.state > summary {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--space-4);
  color: var(--text-soft);
  font-weight: var(--fw-medium);
  cursor: pointer;
  gap: var(--space-2);
  list-style: none;
}

.facet.state > summary::-webkit-details-marker {
  display: none;
}

.facet.state.on > summary {
  color: var(--accent-2-text);
}

.badge {
  display: inline-flex;
  min-width: 15px;
  height: 15px;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent-2);
  color: var(--accent-ink);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
}

/* Anchored to the RIGHT edge of the summary so a narrow pane grows it inward. Anchored left it
   would hang off the right of the window at 300px, which is the one direction a page can be made
   to scroll sideways. */
.pop {
  position: absolute;
  z-index: 5;
  top: calc(100% + 4px);
  right: 0;
  min-width: 244px;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-3);
  /* The declared overlay shadow, not a new token with a fallback: `105` found `var(--warning,
     var(--text-soft))` shipping the fallback on a token declared nowhere, which reads as a
     designed colour and is an accident. */
  box-shadow: var(--shadow);
}

.p-head {
  margin: 0 0 var(--space-3);
  color: var(--faint);
  font-size: var(--type-caption);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.opt {
  display: flex;
  align-items: baseline;
  padding: var(--space-2) 0;
  cursor: pointer;
  gap: var(--space-3);
}

.opt .l {
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.opt .why {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-note {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.spacer {
  flex: 1 1 auto;
}

.pinned {
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.pinned strong {
  color: var(--accent-2-text);
  font-weight: var(--fw-semibold);
}

.clear {
  height: 22px;
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--accent-2);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--accent-2-text);
  font-size: var(--type-caption);
  cursor: pointer;
}

.clear:hover {
  background: var(--info-bg);
}
</style>
