<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CapabilityStatus, ChildWorkInput, CommandTail } from '../../../shared/runtime-ipc'
import { BACKGROUND_SENTENCE, BACKGROUND_WORD, backgroundState } from '../lib/background-work'
import { commandIsLive, outputStandingFor, tailAbsence, tailDroppedNote } from '../lib/command-tail'
import { ANSWER_NOT_HELD } from '../lib/tool-answer'
import { toolOutcome, toolTook } from '../lib/tool-outcome'
import type { ToolItem, TranscriptItem } from '../lib/transcript'
import SubAgentEntry from './SubAgentEntry.vue'
import WorkflowEntry from './WorkflowEntry.vue'

/**
 * One thing the agent did: a foldable row, with its output underneath when it lands.
 *
 * ⚑ **Since `587` this draws the tool calls a quiet run may NOT hold** — a live one (`300`'s Stop
 * must not go behind a triangle), one with sub-agent cards (`029`), one with a workflow tree
 * (`108`), and detached work that has reported back while still running. ⛔ **A settled, childless
 * call is a member of a `ToolRun` line instead**, which is where most of a transcript's tool rows
 * now live. See `tool-runs.ts`.
 *
 * ⚠️ **658 · and not a call of this app's two messaging tools** — `reply_to_parent` and
 * `message_agent` draw as `OutgoingEntry`'s card, routed before this one in `TranscriptView`.
 */
const props = withDefaults(
  defineProps<{
    item: ToolItem & Pick<TranscriptItem, 'at'>
    /**
     * ⛔ **What this command has printed, while it runs** (300) — supplied by whoever is FOLLOWING
     * it, and `null` for every reason there could be one. See `command-tail.ts`.
     *
     * ⚠️ **A prop rather than a read of its own.** This component is rendered once per tool row in a
     * virtualized list; a card that fetched for itself would be N pollers whose lifetimes are the
     * scroller's, and `255` is the dispatch about what that costs. The pane owns the one timer.
     */
    tail?: CommandTail | null
    /**
     * Whether this session's handle can be asked at all — `SessionLiveness.canReadCommandOutput`.
     * A recording is `false` however capable its provider is.
     */
    canWatch?: boolean
    /**
     * This provider's `commandOutput` standing, so the card can say WHY there will never be a tail
     * in the provider's own words rather than in a copy of them (039).
     */
    outputCapability?: CapabilityStatus | null
    /**
     * This provider's `backgroundCommandOutput` standing — read instead of {@link outputCapability}
     * once the command is background work, because the two halves have different answers on Claude
     * (provider follow-ups 1).
     */
    backgroundOutputCapability?: CapabilityStatus | null
    /**
     * ⛔ **Whether one command can be stopped without stopping the turn** —
     * `SessionLiveness.canStopBackgroundWork`, the SAME gate the registry's own button reads.
     *
     * ⚠️ **One predicate, two surfaces, and that is 094's rule rather than a convenience.** Three
     * stop affordances gated on `busy` one at a time is what 094 was written about; a card whose
     * Stop survived a teardown the bar's Stop had already withdrawn would be the same shape.
     */
    canStop?: boolean
    /**
     * A stop this card asked for is still in flight — the pane owns the latch, as the bar does,
     * and keys it by this row's CALL id rather than by the provider's recyclable one.
     */
    stopping?: boolean
    /**
     * ⛔ **Whether this conversation can be asked what its tools answered** (462) —
     * `SessionLiveness.canReadToolAnswer`.
     *
     * ⚠️ **A boolean rather than the answer itself, and that is `255` again.** This component is
     * rendered once per tool row in a virtualized list; a row that fetched its own answer on mount
     * would be N reads of a hold nobody has asked to see. The answer is read once, by the pane,
     * when a person presses the button — see the `openAnswer` emit.
     *
     * ⚑ **`false` draws the gap rather than nothing**, which is `462` §2.2's instruction: a replayed
     * conversation holds no answers at all, and a row that simply omitted the door would let a
     * person believe the 200-character receipt was the whole of it.
     */
    canReadAnswer?: boolean
    /**
     * Whether a sub-agent's transcript, or a workflow's agents, journal and script, have somewhere
     * to open. Off, the nested cards draw no button for them.
     */
    canOpenChild?: boolean
    /** Whether a workflow's output file has somewhere to open. Off, only its name is shown. */
    canOpenOutput?: boolean
  }>(),
  {
    tail: null,
    canWatch: false,
    outputCapability: null,
    backgroundOutputCapability: null,
    canStop: false,
    stopping: false,
    canReadAnswer: false,
    canOpenChild: true,
    canOpenOutput: true,
  },
)

const emit = defineEmits<{
  /** A workflow's output file (108). Raised, never handled here — an overlay is the pane's state. */
  openOutput: [taskId: string, workflow: string]
  /** What one sub-agent did (112). Raised for the same reason, and carries no path. */
  openChild: [what: ChildWorkInput, label: string]
  /**
   * ⛔ **This card wants to be followed, or has stopped wanting to** (300).
   *
   * ⚑ **Raised rather than polled here, for `openOutput`'s reason and one of its own**: a follow is
   * a timer, and a timer belongs to the surface that outlives the row. It carries the CALL id
   * because that is the handle the provider streams against — measured equal to its own `itemId`.
   */
  watch: [callId: string, on: boolean]
  /**
   * Stop this command without stopping the whole turn.
   *
   * ⚠️ **BOTH ids, and the pair is the fix rather than convenience.** The provider's key is what a
   * stop is SENT with; the call id is what the in-flight latch is KEYED by. They are different
   * strings and only one of them is unique: Codex's `processId` is a counter it recycles, so a latch
   * keyed on it cannot tell the command we asked about from the next one born wearing its number —
   * which is `BackgroundBar`'s own note about a row that leaves and comes back, and the defect the
   * first draft of this shipped. Handled by the pane, which owns the request and the latch.
   */
  stop: [callId: string, key: string]
  /**
   * ⛔ **Show the whole of what this tool answered** (462).
   *
   * ⚑ **Raised rather than opened here, and the reason is already written above `openOutput`**: an
   * overlay is the pane's state. ⚠️ It carries the CALL id, which is the key the adapter holds the
   * answer under — the provider's own id for the row, never one this app derived — and the NAME,
   * because the panel's heading is about this call and the pane has no row to read it off.
   */
  openAnswer: [callId: string, name: string]
}>()

/** Folded by default — a turn can run a dozen of these, and the output is for when you ask. */
const folded = ref(true)

/**
 * ⛔ **What became of this call's DETACHED work, or null for the ordinary call** (248).
 *
 * Presence is the whole flag and it comes from `tool_result.backgrounded` alone — never from the
 * receipt's wording, and never from having a `backgroundId`, which Codex puts on every PTY-backed
 * command it runs. See `transcript.ts`'s `detachment()`.
 */
const background = computed(() =>
  props.item.background ? backgroundState(props.item.background) : null,
)

/**
 * ⚠️ **`running` is a claim about NOW, so it may not be read off the absence of a result** (074,
 * from 069 §2.3).
 *
 * That absence has two causes and they are opposite facts: the call is in flight, or the thing that
 * was running it is gone and nothing will ever answer. This used to say `running` for both, so a
 * transcript replayed after the app was quit mid-`Bash` sat there with the accent dot lit,
 * indefinitely, about a dead process — the same false statement `markReopened` and `markReadOnly`
 * were written to correct everywhere else on the screen.
 *
 * The real result still wins wherever there is one: `unfinished` is only ever consulted after
 * `result` has been found missing, so a late `tool_result` renders as the result it is.
 *
 * ⛔ **And since 248 a DETACHMENT outranks the receipt, because the receipt answers the wrong
 * question.** `result.ok` says *"did the provider succeed at what it was asked"* — for a backgrounded
 * command it succeeded at LEAVING, which is true and is why `247` kept `ok` as it was. What the dot
 * says is whether this row is finished, and until the work ends the honest answer is no. `245`
 * measured 24.5 seconds of green on exactly this row.
 *
 * ⚑ **587 · the derivation itself moved to `tool-outcome.ts` and this READS it.** ⛔ **It was copied
 * nowhere**: a collapsed run has to say whether anything in it did not plainly succeed, and the one
 * place a second spelling would have been invisible is the line nobody expanded. `064`/`099`.
 */
const status = computed(() => toolOutcome(props.item))

/** The glance and the whole sentence, from the ONE vocabulary both surfaces read (222 §4). */
const backgroundWord = computed(() =>
  background.value === null ? null : BACKGROUND_WORD[background.value],
)
const backgroundNote = computed(() =>
  background.value === null ? undefined : BACKGROUND_SENTENCE[background.value],
)

/**
 * How long it took, measured between the two envelopes — the call's time and the result's. Absent
 * whenever either is missing (a result with no call, an item built without times), because the
 * alternative is a number that looks measured and is not.
 *
 * ⛔ **For detached work the far end is the ENDING, not the receipt** (248). The receipt is when the
 * command LEFT — `247` measured that at 6 102 ms for work that ran until 36 150 ms — so printing it
 * here would put "1.2 s" beside "still running", which is the same lie this row exists to stop, in
 * a smaller font. While the work is going there is no duration to state, and `endedAt` is absent, so
 * this is null by construction rather than by a branch.
 *
 * ⚑ **587 · moved to `tool-outcome.ts` with {@link status}, and for the same reason** — the run's
 * expanded panel states a duration too, and two of these would drift the day one of them was fixed.
 */
const took = computed(() => toolTook(props.item, props.item.at))

/**
 * ⛔ **Is this command going ON, right now** (300) — the one predicate both new affordances read.
 *
 * ⚠️ **`commandIsLive`, and NOT `status.value === 'running' || 'background'`, which is what the
 * first draft said.** The two agree on every input — `status` is derived from the same two fields —
 * and that is the problem: the pane has to ask the same question to retire an in-flight stop, and it
 * has no `status` to ask. Two derivations that match today are the shape `099` and `064` are about.
 * See `command-tail.ts`, where the one answer lives.
 */
const live = computed(() => commandIsLive(props.item))

/**
 * ⛔ **May this card offer to stop this command** (300) — and the gate is deliberately NOT just
 * "there is a key".
 *
 * ⚠️ **{@link live} is what keeps a recycled provider id unreachable.** Codex's `processId` is a
 * counter it reuses; a transcript row lives for ever. `stopOpenToolCalls` marks every open row
 * `unfinished` at each boundary that ends the thing running it, so a replayed conversation offers
 * nothing — and inside one live session, a number belonging to a process that is still alive cannot
 * yet have been handed to a second one. See `ToolItem.stopKey`.
 */
const stoppable = computed(() => props.canStop && live.value && props.item.stopKey !== undefined)

/**
 * ⛔ **This card is asking to be followed** — open, and about something still going.
 *
 * ⚑ **Folded counts as not asking**, which is what keeps the cost honest: a turn that ran a dozen
 * commands has a dozen rows and none of them is watched until somebody opens one. `275` §1's
 * *"an unnecessary request to a provider is a new failure mode"* is the rule, and this read is
 * cheaper than that — a buffer, not a wire — which is exactly why it must still not be made blindly.
 */
const watching = computed(() => !folded.value && live.value)

/**
 * 🔴 **What this card last TOLD the pane — not what it would say if asked now** (587, from the
 * adversarial pass over that dispatch's own diff).
 *
 * ## ⛔ The leak this closes, and `587` opened it
 *
 * ⚠️ **Before `587` a settled call kept its card**, so `watching` went `true → false` while the row
 * was still mounted and the watcher below raised the withdrawal. ⛔ **Since `587` the row is
 * REMOVED at the moment it settles** — it joins the quiet run beside it (`tool-runs.ts`) and this
 * instance unmounts in the same flush, which disposes the queued watcher job before it can run.
 *
 * 🔴 **And `onBeforeUnmount` then asked the wrong question.** It read `watching.value`, which
 * recomputes from `live` — already `false` by then — so an open, followed command withdrew nothing
 * on its way out. ⚠️ **The pane keeps the call id in `following` for ever and goes on issuing one
 * `readCommandOutput` per second for the rest of the conversation**, because `stopFollowing` only
 * fires when that set empties.
 *
 * ⚑ **A plain local, not a computed**, and that is the fix: the pane's bookkeeping is a record of
 * what was SENT, and only a record of what was sent can undo it. ⛔ It also subsumes the guard this
 * replaced — on the immediate run `on` and `told` are both `false`, so a folded card still raises
 * no withdrawal for a follow nobody asked for.
 */
let told = false
watch(
  watching,
  (on) => {
    if (on === told) return
    told = on
    emit('watch', props.item.callId, on)
  },
  { immediate: true },
)

/**
 * ⛔ **A row scrolled out of the virtualizer withdraws its own follow** (300).
 *
 * ⚠️ **`onBeforeUnmount`, and `onUnmounted` would have been a silent leak.** Vue drops emissions
 * from an instance that is already unmounted — `292` paid for that lesson on a different component —
 * so a withdrawal raised there reaches nobody and the pane goes on reading a buffer for a card that
 * is gone. `255` virtualizes this list, so a long conversation unmounts rows constantly; this is the
 * ordinary path rather than a corner.
 *
 * ⚑ **`587` added a SECOND unmount path and it is the commoner one**: a call that settles stops
 * being a card at all. See {@link told} for why this reads a record rather than the live predicate.
 */
onBeforeUnmount(() => {
  if (told) emit('watch', props.item.callId, false)
})

/**
 * ⚠️ **A function rather than `emit('stop', item.stopKey as string)` in the template**, found by the
 * adversarial pass. That cast asserts what {@link stoppable} already guarantees — which makes it
 * true and unchecked, and the compiler stops being the thing that keeps it true if the guard ever
 * changes. The narrowing here is real.
 */
function stopThis(): void {
  const key = props.item.stopKey
  if (key !== undefined) emit('stop', props.item.callId, key)
}

/** What the card says instead of a tail — see `command-tail.ts` for the four different silences. */
const absence = computed(() =>
  tailAbsence(
    props.tail,
    props.canWatch,
    outputStandingFor(
      background.value !== null,
      props.outputCapability,
      props.backgroundOutputCapability,
    ),
  ),
)
const droppedNote = computed(() =>
  props.tail && props.tail.dropped > 0 ? tailDroppedNote(props.tail.dropped) : null,
)
</script>

<template>
  <!-- ⛔ `data-background-id` is the CORRELATION between this row and the registry above the
       composer (248 §3). The two surfaces show one piece of work in two places on purpose — the
       conversation says what happened, the bar says what is still happening and offers the stop —
       and without a shared key on screen a reader cannot tell that the row saying "still running"
       is the row the bar is offering to stop. Absent whenever the provider named no key.

       ⚑ **`587` · and it leaves the screen when the work ENDS**, because the row stops being a card
       at that moment. ⚠️ That is the same instant the registry above the composer drops it, so the
       two surfaces still agree — the key exists for exactly as long as there are two of them. -->
  <div
    class="tool-entry"
    :class="{ folded }"
    data-cy="tool-entry"
    :data-status="status"
    :data-background-id="item.background?.id"
  >
    <button
      class="tool-head"
      type="button"
      :data-cy="`tool-toggle-${item.id}`"
      @click="folded = !folded"
    >
      <svg class="icon"><use href="#i-terminal" /></svg>
      <!-- Label memory activity explicitly because ellipsis can hide the informative end of a long path. Put the relative filename first and retain the full path on `title`, in selectable body text and on the event. Derive the store from `system/init.memory_paths.auto`. Keep the tool's own `Write`/`Edit`/`Read` name first: it says what happened, while the badge says where. -->
      <span class="tool-summary">
        <strong>{{ item.name }}</strong>
        <!-- ⚠️ **Truthiness, and deliberately** (found reviewing this diff). `target` never produces
             an empty relative path — the store directory itself is refused there — but the ledger's
             bound is a `.max()` and a REPLAYED row from a build whose rules differed reaches this
             component without passing the adapter again. An empty label draws a badge with nothing
             beside it; this draws the ordinary row instead, which is the safe direction and does not
             cost the whole event a degradation the way a `.min(1)` on the schema would. -->
        <template v-if="item.memoryPath">
          <span class="memory-badge" data-cy="tool-memory">this profile’s memory</span>
          <code :title="item.summary" data-cy="tool-memory-path">{{ item.memoryPath }}</code>
        </template>
        <code v-else>{{ item.summary }}</code>
      </span>
      <span class="tool-meta">
        <span class="status-dot" :class="status"></span>
        <!-- ⛔ The detached row's own word, FIRST, because it is the fact the row was missing (248).
             It sits beside `took` rather than instead of it: once the work ends, how long it really
             ran is the other half of the completion record, and the two are one sentence — "finished
             · 30.1 s". While it runs there is no duration, so there is nothing to sit beside. -->
        <span
          v-if="backgroundWord"
          class="took background"
          :title="backgroundNote"
          data-cy="tool-background"
          >{{ backgroundWord }}</span
        >
        <span v-if="took" class="took" data-cy="tool-took">{{ took }}</span>
        <!-- Says what we know and stops there (074). "did not finish" is a fact — the result never
             came and never will; "failed" would be a verdict nobody reported. -->
        <!-- ⚠️ `!item.result` first, and it is not redundant with `took` (found in review). `took`
             is null whenever EITHER timestamp is missing, so a result that arrived without an `at`
             falls through — and without this guard the row would read "did not finish" about a call
             that finished. The `status` computed already prefers the result; this makes the label
             agree with it rather than with the clock. -->
        <span
          v-else-if="!item.result && item.unfinished"
          class="took unfinished"
          data-cy="tool-unfinished"
        >
          did not finish
        </span>
        <span v-else-if="!item.result" class="took">running…</span>
        <svg class="icon chevron"><use href="#i-chevron" /></svg>
      </span>
    </button>
    <!-- Stops only this command and leaves the turn running.

         ⚑ **Measured before it was drawn** (`probe:command-output` §C): with a turn blocked on
         `sleep 300.52243`, the key on this very card stopped the process, the OS confirmed it, and
         the turn went on to complete with an honest failed receipt. Ending a command is not ending
         a conversation, and until now the app had no way to say so.

         ⚠️ **OUTSIDE the fold button and not inside it**, because the head is a `<button>` and a
         button inside a button is invalid HTML that browsers reflow unpredictably. It is its own
         row so that pressing Stop can never be a mis-aimed press on the toggle. -->
    <div v-if="stoppable" class="tool-stop">
      <button
        class="stop-one"
        type="button"
        :disabled="props.stopping"
        :title="
          props.stopping
            ? 'Asked to stop. The provider reports the ending on its own.'
            : 'Stop this one command. The conversation keeps running.'
        "
        :data-cy="`tool-stop-${item.id}`"
        @click="stopThis"
      >
        {{ props.stopping ? 'Stopping…' : 'Stop this command' }}
      </button>
    </div>
    <!-- Show command output while it is being printed.

         ⛔ **Only while it is LIVE, and only when the row is open.** A finished command has a
         receipt two blocks down and that receipt is the record; showing a tail beside it would be
         two accounts of one thing, which is exactly what §4 warns will end up disagreeing.

         ⚠️ **`absence` is a SENTENCE and never a blank.** There are three ways to have no tail and
         they are three different facts — see `command-tail.ts` — and on a provider that will never
         stream, the sentence is the provider's own, out of its capability. `106`: a surface that
         shows nothing where something was expected is a surface a person cannot act on. -->
    <div v-if="!folded && live" class="tool-tail" :data-cy="`tool-tail-${item.id}`">
      <p v-if="absence" class="tail-absent" :data-cy="`tool-tail-absent-${item.id}`">
        {{ absence }}
      </p>
      <template v-else>
        <!-- ⛔ **A COUNT of what is gone, never a leading ellipsis** (092, and `cutNote` one surface
             over): a `…` the renderer draws cannot be told from one the command printed. -->
        <p v-if="droppedNote" class="tail-cut" :data-cy="`tool-tail-dropped-${item.id}`">
          {{ droppedNote }}
        </p>
        <pre class="tail-text" :data-cy="`tool-tail-text-${item.id}`">{{ props.tail?.text }}</pre>
      </template>
    </div>
    <div v-if="item.result" class="tool-body" :class="item.result.ok ? 'out-ok' : 'out-bad'">
      {{ item.result.summary }}
    </div>
    <!-- ⛔ **The provider's own sentence about how the detached work ended** (248) — *"Background
         command … completed (exit code 0)"*. It is a SECOND block rather than a replacement for the
         one above: that one is the detachment receipt, which is what really happened at the time it
         says, and overwriting it would delete a fact to show a fact. Together they are the whole
         record — it left, and this is what became of it — which is the half `245` measured as never
         arriving at all. -->
    <div v-if="item.background?.summary" class="tool-body ended" data-cy="tool-background-summary">
      {{ item.background.summary }}
    </div>
    <!-- 🔴 **The door to the whole answer** (462), or the sentence that says there is none.
         ⛔ **INSIDE the fold, and that is the opposite call from the Stop above** — deliberately.
         `300` put the Stop outside because the one control this app has over a running command must
         not be behind a disclosure triangle. This is not a control over anything: it is more of what
         the row already shows, and opening the row IS the gesture that asks for more. ⚠️ The tail is
         inside for the same reason and they are neighbours on purpose.
         ⚑ **And where it cannot be asked, the GAP is drawn in its place** rather than the row going
         quiet — see `ANSWER_NOT_HELD`. -->
    <div v-if="item.result" class="answer-ask">
      <button
        v-if="props.canReadAnswer"
        class="ask-one"
        type="button"
        :data-cy="`tool-answer-open-${item.id}`"
        title="Show everything this tool answered, not just the short form on this row."
        @click="emit('openAnswer', item.callId, item.name)"
      >
        Show the whole answer
      </button>
      <p v-else class="answer-gone" :data-cy="`tool-answer-gone-${item.id}`">
        {{ ANSWER_NOT_HELD }}
      </p>
    </div>
    <!-- The agents this call dispatched (029), NESTED rather than shown beside it. They sit outside
         the fold on purpose: a sub-agent running for minutes is the most important thing on screen
         while it runs, and burying it under the parent row's collapsed output would hide exactly
         the thing 029 exists to surface. The cards collapse themselves. -->
    <div v-if="item.subAgents?.length" class="subagents" data-cy="tool-subagents">
      <SubAgentEntry
        v-for="card in item.subAgents"
        :key="card.agentId"
        :card="card"
        placement="nested"
        :can-read-answer="props.canReadAnswer"
        :can-open-transcript="props.canOpenChild"
        @open-child="(what, label) => emit('openChild', what, label)"
        @open-answer="(callId, name) => emit('openAnswer', callId, name)"
      />
    </div>
    <!-- The workflow this call launched (108), nested for exactly the reason the cards above are:
         a `Workflow` row with its tree inside reads as one thing that happened. It sits outside the
         fold on the same argument — a workflow running for minutes is the most important thing on
         screen while it runs, and burying it under the row's collapsed output would hide the very
         thing this task exists to surface. The tree collapses itself. -->
    <div v-if="item.workflow" class="subagents" data-cy="tool-workflow">
      <WorkflowEntry
        :run="item.workflow"
        :can-open-child="props.canOpenChild"
        :can-open-output="props.canOpenOutput"
        @open-output="(taskId, workflow) => emit('openOutput', taskId, workflow)"
        @open-child="(what, label) => emit('openChild', what, label)"
      />
    </div>
  </div>
</template>

<style scoped>
.subagents {
  padding: 0 var(--space-4) var(--space-4);
}

.tool-entry {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  overflow: hidden;
}

.tool-head {
  display: grid;
  width: 100%;
  min-height: var(--control-h-touch);
  align-items: center;
  padding: var(--space-6);
  border: 0;
  background: transparent;
  color: var(--muted);
  gap: var(--space-6);
  grid-template-columns: 15px minmax(0, 1fr) auto;
  text-align: left;
}

.tool-head:hover {
  background: var(--wash-2);
}

.tool-head .icon {
  width: 14px;
  height: 14px;
  color: var(--faint);
}

.tool-summary {
  overflow: hidden;
  min-width: 0;
  font-size: var(--type-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-summary strong {
  color: var(--text-soft);
  font-weight: var(--fw-bold);
}

.tool-summary code {
  color: var(--mono-text);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

.memory-badge {
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-2xs);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.tool-meta {
  display: inline-flex;
  align-items: center;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.status-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--faint);
}

.status-dot.running,
.status-dot.background {
  background: var(--accent);
  box-shadow: var(--accent-glow-weak);
}

.took.unfinished {
  color: var(--faint);
}

.status-dot.done,
.status-dot.completed {
  background: var(--success);
}

.status-dot.error,
.status-dot.failed {
  background: var(--danger);
}

.took.background {
  color: var(--faint);
}

.chevron {
  transition: transform var(--dur-fast) ease;
}

.tool-entry.folded .tool-body {
  display: none;
}

.tool-entry.folded .chevron {
  transform: rotate(90deg);
}

.tool-entry.folded .answer-ask {
  display: none;
}

.answer-ask {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-4) var(--space-6);
  border-top: var(--border-width) solid var(--line);
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

.answer-gone {
  margin: 0 auto 0 0;
  color: var(--muted);
  font: var(--type-caption) / 1.5 var(--font-sans);
}

.tool-stop {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--space-6) var(--space-4);
}

.stop-one {
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.stop-one:hover:not(:disabled) {
  background: var(--wash-2);
}

.stop-one:disabled {
  color: var(--faint);
}

.tool-tail {
  border-top: var(--border-width) solid var(--line);
  background: var(--code-bg);
}

.tail-text {
  max-height: 220px;
  margin: 0;
  padding: var(--space-5) var(--space-6);
  overflow: auto;
  color: var(--code-text-dim);
  font: var(--type-caption) / 1.55 var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tail-absent,
.tail-cut {
  margin: 0;
  padding: var(--space-4) var(--space-6);
  color: var(--muted);
  font: var(--type-caption) / 1.5 var(--font-sans);
}

.tail-cut {
  color: var(--waiting);
  font-size: var(--type-caption);
}

.tool-body {
  padding: var(--space-5) var(--space-6);
  border-top: var(--border-width) solid var(--line);
  background: var(--code-bg);
  color: var(--code-text-dim);
  font: var(--type-caption) / 1.55 var(--font-mono);
  overflow-x: auto;
  white-space: pre-wrap;
}

.tool-body.out-bad {
  color: var(--danger);
}

.tool-body.ended {
  color: var(--text-soft);
  font: var(--type-caption) / 1.55 var(--font-sans);
  white-space: normal;
}
</style>
