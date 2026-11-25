<script setup lang="ts">
import type { PathsHere } from '../composables/useMessagePaths'
import { computed, ref, watch } from 'vue'
import { didNotPlainlySucceed } from '../lib/tool-outcome'
import { runLine, type RunCall, type RunMember, type RunThought } from '../lib/tool-runs'
import ThinkingEntry from './ThinkingEntry.vue'
import ToolEntry from './ToolEntry.vue'

/**
 * 🔴 **587 · a run of settled tool calls, as ONE quiet line** — `EXT-013` §3.1.
 *
 * ## ⛔ What changed, and the sizing IS the fix
 *
 * ⚠️ **`EXT-013` §3.2:** *"the agent's words are the small quiet part and the plumbing is the loud
 * part."* ⚑ **The inversion is the defect. The sizing is the fix.** This row takes six of
 * `ThinkingEntry`'s `.head` declarations exactly — `--text-3xs`, `--faint`, `border: 0`,
 * `background: transparent`, an 8 px chevron at `--text-5xs`, and `--space-3` between — because
 * `thought · ~434 tokens` is the line `EXT-013` names as the reference and *"do not invent a third
 * weight"* is the instruction. ⚠️ **It is not a copy**: this row is baseline-aligned where the
 * reference centres, because it carries a badge and a mark the reference does not.
 *
 * ⛔ **Which means the TYPE GOT BIGGER.** The card this replaces drew its tool name at `--text-4xs`
 * and its argument at `--text-5xs`, both smaller than the reference; what made seven of them
 * dominate a transcript was a `--line` border, a `--wash-1` fill and a 34 px floor. ⚑ **The chrome
 * was the loudness, and the chrome is what went.**
 *
 * ## ⚑ Expanded: a tab per call, each drawn by `ToolEntry`
 *
 * ⚑ The run owns the line and the tabs only. The selected call is `ToolEntry` opened, the same
 * drawing a call has on its own, and a selected thought is `ThinkingEntry` opened.
 *
 * ## 🔴 What is NOT in here, and each absence is somebody's ruling
 *
 * ⛔ **A live call never reaches this component** — `tool-runs.ts`'s `joinsARun` keeps it out, so
 * `300`'s Stop, `029`'s sub-agent cards and `108`'s workflow tree are all still drawn by
 * `ToolEntry` on a row of their own, outside every fold. ⚠️ **And a REFUSAL breaks a run rather
 * than joining one**: `tool-runs.ts` carries the measurement.
 *
 * ## ⚠️ What a keyboard does through one of these (`587` §4.1)
 *
 * ⛔ **A collapsed run is ONE tab stop where the cards were 2N** — a toggle and a *Show the whole
 * answer* per call. ⚑ **Opened, it is three**: the toggle, the tab strip, and whatever the open
 * panel offers. 🔴 **The strip is a real `tablist` with a ROVING `tabindex`** — the selected tab is
 * the only one in the tab order and `←`/`→`/`Home`/`End` move between them — so a transcript with
 * forty tool calls in it never becomes forty tab stops. ⚠️ **`tabindex="-1"` works here and would
 * not inside a custom focus trap** (`a-custom-focus-trap-is-the-tab-order`): nothing here overrides
 * the document's own order, so removing a node from it genuinely removes it.
 */
const props = withDefaults(
  defineProps<{
    paths?: PathsHere | null
    /** The run's members, tool calls and finished thoughts, in ledger order. */
    members: readonly RunMember[]
    /**
     * ⛔ **Whether this conversation can be asked what its tools answered** (462) —
     * `SessionLiveness.canReadToolAnswer`, passed straight through as `ToolEntry` takes it.
     * ⚑ `false` draws the GAP rather than nothing, which is `462` §2.2.
     */
    canReadAnswer?: boolean
    /** An answer already opened and held by the pane. */
    canReadAnswerFor?: (callId: string) => boolean
  }>(),
  { canReadAnswer: false },
)

const emit = defineEmits<{
  /**
   * ⛔ **Show the whole of what one tool answered** (462). Raised, never opened here — the overlay
   * is the pane's state, exactly as it is when `ToolEntry` raises the same thing.
   */
  openAnswer: [callId: string, name: string]
}>()

/** Closed by default: the whole point of the row is that a finished call asks for nothing. */
const open = ref(false)

const line = computed(() => runLine(props.members))
const calls = computed(() => props.members.filter((m): m is RunCall => m.kind === 'tool'))

/**
 * What gets a tab when the run is opened: every call, and every thought that has words, in ledger
 * order. A thought with no words is counted on the line and gets no tab, because its panel would
 * hold nothing to read.
 */
const tabbed = computed(() =>
  props.members.filter((m) => m.kind === 'tool' || m.text.trim() !== ''),
)

/**
 * ⛔ **The line, untruncated, on the row's own `title`** — `531`'s standard, and this row needs it.
 *
 * ⚠️ **`.detail` is the one part allowed to shorten** and it shortens with an ellipsis, so at a
 * narrow pane the tool names are text a browser cut and nothing brings back. ⚑ A `title` on the
 * element that carries them is what `titleRecovers` looks for, and it costs nothing.
 */
const whole = computed(() =>
  [
    line.value.head,
    ...(line.value.memory ? ['this profile’s memory'] : []),
    line.value.detail,
    line.value.thoughts,
    ...line.value.amiss,
  ]
    .filter(Boolean)
    .join(' · '),
)

/**
 * ⚠️ **The selected tab is an INDEX into a list that grows**, and the clamp is not defensive
 * tidiness. A run gains members as calls settle, and older history prepending can move its first
 * member — so the array this indexes is rebuilt under it while a person has it open.
 */
const tab = ref(0)
watch(
  () => tabbed.value.length,
  (length) => {
    if (tab.value >= length) tab.value = Math.max(0, length - 1)
  },
)
const shown = computed(() => tabbed.value[Math.min(tab.value, tabbed.value.length - 1)])
const shownCall = computed(() => (shown.value?.kind === 'tool' ? shown.value : undefined))
const shownThought = computed<RunThought | undefined>(() =>
  shown.value?.kind === 'thinking' ? shown.value : undefined,
)

function moveTab(event: KeyboardEvent, index: number): void {
  const last = tabbed.value.length - 1
  const to =
    event.key === 'ArrowRight'
      ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft'
        ? Math.max(index - 1, 0)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : -1
  if (to < 0) return
  event.preventDefault()
  tab.value = to
  // ⚠️ **Focus FOLLOWS selection**, which is the pattern a `tablist` with no lazy panels wants: the
  // panel is already rendered, so moving focus without selecting would leave a person hearing a tab
  // that is not the one on screen.
  const strip = event.currentTarget as HTMLElement | null
  const next = strip?.parentElement?.children[to]
  if (next instanceof HTMLElement) next.focus()
}
</script>

<template>
  <div
    class="tool-run"
    data-cy="tool-run"
    :data-calls="calls.length"
    :data-thoughts="members.length - calls.length"
    :data-open="open"
  >
    <!-- ⛔ **The whole row when it is closed, and it is a `<button>` with an `aria-expanded`** —
         `ThinkingEntry`'s own disclosure to the attribute, because a person who has learned to read
         one of those has learned to read this. -->
    <component
      :is="tabbed.length > 0 ? 'button' : 'span'"
      class="head"
      :class="{ static: tabbed.length === 0 }"
      :type="tabbed.length > 0 ? 'button' : undefined"
      :aria-expanded="tabbed.length > 0 ? open : undefined"
      :title="whole"
      data-cy="tool-run-toggle"
      @click="tabbed.length > 0 && (open = !open)"
    >
      <!-- Thoughts with no words have nothing behind them, so a run of only those is not a disclosure. -->
      <span v-if="tabbed.length > 0" class="chevron">{{ open ? '▾' : '▸' }}</span>
      <span class="label" data-cy="tool-run-head">{{ line.head }}</span>
      <!-- Keep the memory badge on the folded row, before `.detail`, so ellipsis truncates names rather than the activity label. -->
      <span v-if="line.memory" class="memory-mark" data-cy="tool-run-memory-mark"
        >this profile’s memory</span
      >
      <span v-if="line.detail" class="detail" data-cy="tool-run-detail">· {{ line.detail }}</span>
      <span v-if="line.thoughts" class="thoughts" data-cy="tool-run-thoughts"
        >· {{ line.thoughts }}</span
      >
      <!-- 🔴 **The one loud thing on a quiet line** (587 §3). Settled and not plainly done, computed
           as the COMPLEMENT of the two success words rather than from a list of failures — see
           `runLine`. It takes `--waiting`, which is the colour the refusal notice beside it already
           uses, so two kinds of *this did not go the ordinary way* read as one grammar. -->
      <span v-for="word in line.amiss" :key="word" class="amiss" data-cy="tool-run-amiss"
        >· {{ word }}</span
      >
    </component>

    <div v-if="open && tabbed.length > 0" class="body">
      <!-- ⚑ **A tab per tool** (`EXT-013` §3.1's fourth row), and only when there is more than one:
           a strip of one tab is chrome around a thing that has no alternative. -->
      <div
        v-if="tabbed.length > 1"
        class="tabs"
        role="tablist"
        :aria-label="
          calls.length === tabbed.length
            ? 'The tool calls in this run'
            : 'The tool calls and thoughts in this run'
        "
      >
        <button
          v-for="(member, index) in tabbed"
          :id="`tool-run-tab-${member.id}`"
          :key="member.id"
          class="tab"
          :class="{
            on: index === tab,
            amiss: member.kind === 'tool' && didNotPlainlySucceed(member),
          }"
          type="button"
          role="tab"
          :aria-selected="index === tab"
          :aria-controls="`tool-run-panel-${member.id}`"
          :tabindex="index === tab ? 0 : -1"
          :data-cy="`tool-run-tab-${member.id}`"
          @click="tab = index"
          @keydown="moveTab($event, index)"
        >
          {{ member.kind === 'tool' ? member.name : 'thought' }}
        </button>
      </div>

      <!-- ⚠️ **A `tabpanel` with no `tablist` is an orphan**, and a run of one draws no strip — so
           the role and its label arrive together or not at all. -->
      <div
        v-if="shownCall"
        :id="`tool-run-panel-${shownCall.id}`"
        class="panel"
        :role="tabbed.length > 1 ? 'tabpanel' : undefined"
        :aria-labelledby="tabbed.length > 1 ? `tool-run-tab-${shownCall.id}` : undefined"
        :data-cy="`tool-run-panel-${shownCall.id}`"
      >
        <ToolEntry
          :key="shownCall.id"
          :item="shownCall"
          :paths="props.paths"
          :can-read-answer="props.canReadAnswerFor?.(shownCall.callId) ?? props.canReadAnswer"
          opened
          @open-answer="(callId, name) => emit('openAnswer', callId, name)"
        />
      </div>

      <!-- A thought with words, drawn as it is on its own row and already open. -->
      <div
        v-else-if="shownThought"
        :id="`tool-run-panel-${shownThought.id}`"
        class="panel"
        :role="tabbed.length > 1 ? 'tabpanel' : undefined"
        :aria-labelledby="tabbed.length > 1 ? `tool-run-tab-${shownThought.id}` : undefined"
        :data-cy="`tool-run-panel-${shownThought.id}`"
      >
        <ThinkingEntry :key="shownThought.id" :item="shownThought" opened />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-run {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-6);
  padding-left: calc(var(--avatar-small) + var(--space-6));
}

.head {
  display: flex;
  max-width: 100%;
  align-items: center;
  padding: var(--space-6);
  border: var(--border-width) solid var(--line);
  background: var(--panel);
  /* The reasoning line's own ink, so the two quiet lines read as one kind of thing. */
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-5);
  text-align: left;
  width: 100%;
  min-height: var(--control-h-touch);
  border-radius: var(--radius-card);
}

.head:not(.static):hover {
  color: var(--muted);
}

.chevron {
  width: 8px;
  flex: 0 0 auto;
  font-size: var(--type-caption);
}

.detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thoughts {
  flex: 0 0 auto;
  white-space: nowrap;
}

/* The selected member's own row, inside the panel: no message-column indent of its own. */
.panel > .thinking,
.panel > .tool-entry {
  max-width: none;
  margin: 0;
  padding-left: 0;
}

.memory-mark {
  flex: 0 0 auto;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.amiss {
  color: var(--waiting);
  font-weight: var(--fw-semibold);
}

.body {
  margin-top: var(--space-3);
  padding: var(--space-6);
  border-left: var(--border-accent-width) solid var(--line-strong);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
  gap: var(--space-3);
}

.tab {
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-2xs);
  background: transparent;
  color: var(--faint);
  font-size: var(--type-caption);
}

.tab:hover {
  color: var(--muted);
}

.tab.on {
  border-color: var(--line-strong);
  background: var(--wash-2);
  color: var(--text-soft);
}

.tab.amiss,
.tab.on.amiss {
  color: var(--waiting);
}
</style>
