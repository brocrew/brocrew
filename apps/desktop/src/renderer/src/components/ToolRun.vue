<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ANSWER_NOT_HELD } from '../lib/tool-answer'
import { TOOL_OUTCOME_WORD, didNotPlainlySucceed, toolOutcome, toolTook } from '../lib/tool-outcome'
import { runLine, type RunCall, type RunMember, type RunThought } from '../lib/tool-runs'
import type { ToolItem } from '../lib/transcript'
import ThinkingEntry from './ThinkingEntry.vue'

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
 * ## ⚑ Expanded: the two things a person could not see
 *
 * ⚠️ **`EXT-013` §3.1:** *"expanded → input AND output, both formatted"*, and *"several in a run →
 * a tab per tool."* ⛔ **The output was never missing** — `.tool-entry.folded .tool-body` hid it and
 * the row opened by itself — but it was behind a press on a row that gave no reason to press it,
 * which is `106`'s shape. ⚑ Now opening the run IS the gesture that asks for it, and both halves
 * arrive together under labels that say which is which.
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
    /** The run's members, tool calls and finished thoughts, in ledger order. */
    members: readonly RunMember[]
    /**
     * ⛔ **Whether this conversation can be asked what its tools answered** (462) —
     * `SessionLiveness.canReadToolAnswer`, passed straight through as `ToolEntry` takes it.
     * ⚑ `false` draws the GAP rather than nothing, which is `462` §2.2.
     */
    canReadAnswer?: boolean
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

/**
 * ⚑ **Pretty-print when it really is JSON, and otherwise print what we were given.**
 *
 * ⛔ **Never a claim that this is the whole input.** `summarizeToolInput` cut it in the ADAPTER, and
 * `normalize.ts` says the cut *"is irreversible: the full text is never carried on the event, so
 * nothing downstream can restore it"* — so a truncated object will not parse and falls through to
 * the raw branch, which is the honest outcome rather than a failure. ⚠️ **The cap's number is not
 * named here**, for `ANSWER_NOT_HELD`'s own reason: it lives in `@brobot2/runtime` and importing it
 * would cost the renderer 135 kB to print a figure.
 */
function formatted(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

const wordOf = (call: ToolItem): string => TOOL_OUTCOME_WORD[toolOutcome(call)]
const amissOn = didNotPlainlySucceed

const took = computed(() => {
  const call = shownCall.value
  return call === undefined ? null : toolTook(call, call.at)
})

/**
 * ⚠️ **Computed rather than called from the template**, found by the adversarial pass over this
 * dispatch's diff. `TranscriptView`'s `rows` rebuilds its `calls` arrays on every fold, so a
 * template call would re-run `JSON.parse` plus a pretty `stringify` on BOTH halves once per
 * streaming delta, for every open run on screen. ⛔ The card this replaces did no JSON work at all,
 * so it would have been a cost this dispatch introduced and never measured.
 */
const asked = computed(() => {
  const call = shownCall.value
  return call === undefined ? '' : formatted(call.summary)
})
const answered = computed(() => {
  const summary = shownCall.value?.result?.summary
  return summary === undefined ? '' : formatted(summary)
})

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
          :class="{ on: index === tab, amiss: member.kind === 'tool' && amissOn(member) }"
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
        <p class="what">
          <strong>{{ shownCall.name }}</strong>
          <span
            class="outcome"
            :class="{ amiss: amissOn(shownCall) }"
            :data-outcome="toolOutcome(shownCall)"
            data-cy="tool-run-outcome"
            >{{ wordOf(shownCall) }}</span
          >
          <span v-if="took" class="took" data-cy="tool-run-took">{{ took }}</span>
        </p>

        <!-- ⚠️ **A memory write says so here too** (330). The badge is the row's, moved: the path is
             what `summary` leads with and the word *memory* was never on screen without it. -->
        <p class="cap">
          what it was asked
          <span v-if="shownCall.memoryPath" class="memory-badge" data-cy="tool-run-memory"
            >this profile’s memory</span
          >
        </p>
        <pre class="text" data-cy="tool-run-input">{{ asked }}</pre>

        <p class="cap">what it answered</p>
        <pre
          v-if="shownCall.result"
          class="text"
          :class="{ bad: !shownCall.result.ok }"
          data-cy="tool-run-output"
          >{{ answered }}</pre>
        <!-- ⛔ **Says what we know and stops there** (074). No receipt arrived and none ever will;
             the outcome's own word is the whole of what this app can honestly report. -->
        <p v-else class="none" data-cy="tool-run-no-output">
          {{ wordOf(shownCall) }} — nothing was ever reported back
        </p>

        <!-- ⚑ **The ending's own sentence, under the receipt it follows** (248) — a SECOND block and
             never a replacement, because the receipt is what really happened at the time it says. -->
        <template v-if="shownCall.background?.summary">
          <p class="cap">what became of it</p>
          <p class="ended" data-cy="tool-run-background-summary">
            {{ shownCall.background.summary }}
          </p>
        </template>

        <!-- 🔴 **The door to the whole answer** (462), or the sentence that says there is none. -->
        <div v-if="shownCall.result" class="ask">
          <button
            v-if="props.canReadAnswer"
            class="ask-one"
            type="button"
            :data-cy="`tool-run-answer-open-${shownCall.id}`"
            title="Show everything this tool answered, not just the short form on this row."
            @click="emit('openAnswer', shownCall.callId, shownCall.name)"
          >
            Show the whole answer
          </button>
          <p v-else class="gone" :data-cy="`tool-run-answer-gone-${shownCall.id}`">
            {{ ANSWER_NOT_HELD }}
          </p>
        </div>
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

/* The thought's own row, inside the panel: no message-column indent of its own. */
.panel > .thinking {
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

.what {
  display: flex;
  align-items: baseline;
  margin: 0 0 var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.what strong {
  color: var(--text-soft);
  font-weight: var(--fw-bold);
}

.outcome.amiss {
  color: var(--waiting);
}

.took {
  color: var(--faint);
}

.cap {
  display: flex;
  align-items: center;
  margin: 0 0 var(--space-2);
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-3);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.cap + .text,
.cap + .ended {
  margin-bottom: var(--space-5);
}

.memory-badge {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
  letter-spacing: normal;
  text-transform: none;
}

.text {
  max-height: 220px;
  margin: 0;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--code-text-dim);
  font: var(--type-caption) / 1.55 var(--font-mono);
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.text.bad {
  color: var(--danger);
}

.none,
.ended {
  margin: 0;
  color: var(--muted);
  font: var(--type-caption) / 1.5 var(--font-sans);
}

.ask {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: var(--space-4);
  gap: var(--space-4);
}

.ask-one {
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.ask-one:hover {
  background: var(--wash-2);
}

.gone {
  margin: 0 auto 0 0;
  color: var(--muted);
  font: var(--type-caption) / 1.5 var(--font-sans);
}
</style>
