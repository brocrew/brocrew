<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import { backgroundWhat } from '../../../shared/agent-state'
import { BACKGROUND_WORD, cutNote, droppedNote } from '../lib/background-work'
import type { BackgroundRegistry } from '../lib/transcript'

/**
 * **What is still running in this conversation** (248) — `245`'s *"See what is still running."*
 *
 * ## ⛔ Where it lives, and the ruling that put it there
 *
 * Background work does not require an answer and belongs outside the person's attention queue. `attention.ts` gathers pending permissions and questions whose conversations wait for an answer; adding unblocked work would contradict that queue's empty state.
 *
 * **Here instead: beside the composer, with the plan bar and the activity pill.** That slot already
 * has a stated reason and it is this one, from `060` — *"the plan is a transcript entry that scrolls
 * away and this is a standing property of the conversation."* The level is a statement about NOW;
 * the card that started the work is a row that scrolls. And this is where the danger is felt: the
 * composer is free, the turn is over, and `245` ranked that state 1 because *"it can make closing
 * the app, changing branches or starting dependent work unsafe."*
 *
 * ## ⚠️ Sub-agents are in it, and that was measured rather than assumed
 *
 * `248` §5's probe: a dispatched sub-agent joins the level set as `local_agent` unless the dispatch
 * sends `run_in_background: false`, and the false-settled window through that door is **21 759 ms**
 * on Haiku and **21 515 ms** on Sonnet — turn idle, agent still working. Filtering them out would
 * leave this bar silent during the exact window it exists for.
 *
 * ⛔ **And it is not `035`'s duplicate of `226`'s cards.** That card is the nested transcript of what
 * one agent is DOING — its tools, its words, its usage — inside a view that scrolls; this is one
 * standing line answering *"is anything still running"*, **and it is the only place the work can be
 * stopped**. The card carries no control at all.
 */
const props = defineProps<{
  /** The storage key that remembers whether the block is folded; absent, it does not fold. */
  fold?: string
  registry: BackgroundRegistry
  /**
   * 🔴 **Which conversation these rows belong to** (287 §2, finding 4) — the record's own session id.
   *
   * ⛔ **This component is REUSED across conversations and does not remount.** `RuntimeScreen` hands
   * `ConversationPane` a different active record without a `key`, so `asked` — component state about
   * one conversation's in-flight stop — would follow the reader to the next one. A provider id is
   * only unique within a session, and `background-terminals.test.ts` brings a Codex `processId` back
   * on purpose because *"the provider's counter is not unique for ever"*: two conversations holding
   * the same number is not a hypothesis this app is allowed to make.
   *
   * ⚠️ **An identity rather than a `key` on the parent**, because remounting the pane to fix a latch
   * would throw away the transcript's scroll position, the drawer and the draft. The cheap answer is
   * for the one piece of state that is scoped to a conversation to say which conversation it is.
   */
  conversation: string
  /**
   * ⛔ **Whether this session's adapter can stop one piece of work** — `SessionLiveness`'s
   * `canStopBackgroundWork`, absent-not-false (Codex today, and every read-only transcript).
   *
   * `106`: a control that cannot act is not offered. `118`: absent rather than greyed, because a
   * greyed button still says *"this is the thing to do here, later"* and there is no later.
   */
  canStop: boolean
  /**
   * ⛔ **Ask the host to stop one piece of work, and TELL THIS BAR what happened.**
   *
   * ⚠️ **A function prop rather than an emit, and the difference is a stranded control.** An emit is
   * fire-and-forget: the first version of this component disabled the row's button the moment it was
   * pressed and had no way to learn that the request had failed, so a stop the bridge threw on left
   * the ONLY control for still-running work reading *"Stopping…"* for ever — `106`'s control that
   * cannot act, manufactured by the app itself. `TranscriptView`'s `loadOlder`/`jumpToLatest` are the
   * same shape for the same reason.
   *
   * ⚑ Resolves `true` when the request went out. `false` covers both real answers — the work had
   * already finished (`247` §3), or the bridge refused and put the reason beside the conversation —
   * and both of them mean the button must come back rather than sit there reassuring.
   */
  onStop: (id: string) => Promise<boolean>
}>()

/** Folds as an agent card's sections do: the heading is the button, and only the rows hide. */
// Folded until a person opens it: one line says how many things run.
const folded = usePersistentToggle(
  props.fold ?? '',
  Boolean(props.fold),
  props.fold ? undefined : null,
)
const bodyId = useId()

/**
 * The ids whose stop is IN FLIGHT.
 *
 * ⚠️ **Component state on purpose, and it is allowed to be forgotten.** The durable answer is the
 * registry itself: the row leaves when the provider says the work is gone, and that is the only fact
 * this app holds. This exists so the button does not invite a second press during the round trip —
 * and if the pane remounts and it resets, the worst case is stopping a task that is already
 * stopping, which `Query.stopTask` treats as the no-op it is.
 *
 * ⛔ **Cleared when the answer comes back anything but `true`.** A request that never landed must
 * give the control back: the work is still running and this is the only place to act on it. Leaving
 * it disabled was the first draft, and it turned a failed stop into a permanently reassuring button.
 *
 * 🔴 **…and RETIRED when the row it is about goes** (287 finding 4), which the paragraph above
 * quietly assumed and nothing did. A stop that SUCCEEDS never comes back `false`, so the id stayed
 * in this set for the life of the component while the row left on the very next level frame — and
 * the next piece of work born with that id was born disabled, reading **Stopping…**, over a request
 * nobody had made for it. ⚠️ **Id reuse is in this code's own model rather than a worry**: Codex's
 * `processId` is a counter the provider recycles, and `background-terminals.test.ts` brings one back
 * deliberately. See {@link retire}.
 */
const asked = ref(new Set<string>())

/**
 * ⛔ **An in-flight stop is scoped to ONE conversation and ONE standing row, and it ends with either.**
 *
 * ⚠️ **Two watchers rather than one, because they are two different facts.** A row leaving is the
 * provider saying that work is over — the latch has nothing left to be about. A conversation change
 * is the reader looking at something else entirely, where the same id means different work or no
 * work at all. Deriving the disabled state instead (`asked.has(id) && stillListed(id)`) would look
 * like it covered the first one and would not: a row that leaves and comes back is a new task
 * wearing an old number, and a pure expression cannot tell it from the one we asked about.
 *
 * ⚑ **A row that is still listed while its stop is in flight is untouched**, which is the whole
 * working case: the provider goes on reporting the work until it actually stops, which on Codex is
 * up to one two-second poll away.
 */
function retire(keep: ReadonlySet<string>): void {
  if (asked.value.size === 0) return
  const next = new Set([...asked.value].filter((id) => keep.has(id)))
  if (next.size !== asked.value.size) asked.value = next
}

watch(
  // ⚠️ Joined with a separator no provider id can carry, so `['a b']` and `['a', 'b']` are not
  // one key — `published.ids` in `background-terminals.ts` uses the same one for the same reason.
  () => props.registry.running.map((row) => row.id).join('\u0000'),
  () => retire(new Set(props.registry.running.map((row) => row.id))),
)

// ⚠️ The set is emptied rather than filtered: nothing this conversation is holding is a statement
// about the next one, even where the ids happen to match.
watch(
  () => props.conversation,
  () => {
    if (asked.value.size > 0) asked.value = new Set()
  },
)

/**
 * Show each running row's command so it is recognizable beyond the model's description of the work.
 *
 * ⚠️ **One `computed`, not `backgroundWhat(row)` called from five places in the template.** The
 * template needs the answer's `from`, its `name`, its `text`, its `cut` and its `full`; asking five
 * times per row per render would run the quoting and the code-point slice five times over, and — the
 * half that actually bites — a later edit could change one call site and leave a row whose `title`
 * did not match its own text. `250` §2's rule about surfaces agreeing, one component down.
 */
const rows = computed(() =>
  props.registry.running.map((row) => ({ row, what: backgroundWhat(row) })),
)

function forget(id: string): void {
  const next = new Set(asked.value)
  next.delete(id)
  asked.value = next
}

async function stop(id: string): Promise<void> {
  asked.value = new Set(asked.value).add(id)
  // ⚠️ No `catch` that swallows: `SessionStore.stopBackgroundWork` already turns a refusal into
  // `false` AND the sentence beside the conversation, so a rejection reaching here would be a
  // contract break rather than an outcome — and hiding it would make this the second place that
  // decides what a failed stop means.
  if (!(await props.onStop(id))) forget(id)
}
</script>

<template>
  <aside
    v-if="props.registry.running.length > 0"
    class="bg-bar"
    data-cy="background-bar"
    :data-folded="props.fold ? folded : undefined"
  >
    <component
      :is="props.fold ? 'button' : 'p'"
      v-bind="
        props.fold ? { type: 'button', 'aria-expanded': !folded, 'aria-controls': bodyId } : {}
      "
      class="bg-head"
      :class="{ 'bg-fold': props.fold }"
      :data-cy="props.fold ? 'background-fold' : undefined"
      @click="props.fold && (folded = !folded)"
    >
      <svg v-if="props.fold" class="bg-chevron" :class="{ folded }" aria-hidden="true">
        <use href="#i-chevron" />
      </svg>
      <span class="bg-dot"></span>
      <!-- The same word the tool card uses, out of the same table (222 §4's one-vocabulary rule):
           a person must not meet "still running" here and a different phrase on the row it names. -->
      <strong data-cy="background-count">{{ props.registry.running.length }}</strong>
      {{ props.registry.running.length === 1 ? 'thing is' : 'things are' }}
      {{ BACKGROUND_WORD.running }}
      <!-- ⚠️ **No `BACKGROUND_SENTENCE` here, and that is 222 §4 rather than a shortcut.** That
           table's sentences are written about ONE piece of work — *"the receipt said it started, not
           that it finished"* — and this heading is about a set. Rendering one of them over a list
           would be a sentence answering a question nobody asked here; composing a plural version at
           this call site would be the second vocabulary the rule forbids. The heading IS the
           sentence, and every row below it carries the provider's own description. -->
    </component>
    <div v-show="!folded" :id="bodyId" class="bg-body">
      <ol class="bg-rows">
        <li
          v-for="{ row, what } in rows"
          :key="row.id"
          class="bg-row"
          :data-cy="`background-row-${row.id}`"
          :data-kind="row.kind ?? ''"
        >
          <!-- Show the command actually running, rather than relying only on the model's description.

             ⛔ **`data-from` says WHICH of the three answers this is**, because they are not equally
             specific and a person reading the row deserves to know: `command` is the call's own
             text, `description` is the provider's sentence about it (a row with no `toolCallId`, and
             every row's first frame), `id` is the last resort. It is the same string the tool card
             prints, from the same fold — 099/064's one fact, two surfaces.

             ⚠️ **`<strong>`+`<code>` is `ToolEntry`'s own shape**, deliberately: a person meeting the
             same command twice must not meet it in two typographies. -->
          <span
            class="bg-what"
            :data-cy="`background-what-${row.id}`"
            :data-from="what.from"
            :title="what.full"
          >
            <!-- 🔴 **The space is WRITTEN, and it has to be** (found by this dispatch's live run).
               Vue's default `whitespace: 'condense'` deletes a whitespace-only text node between two
               elements when it contains a newline — so `<strong>` and `<code>` on their own lines
               rendered `Bashnode -e "setTimeout(…"`, one word, on screen and in the live step's
               reading. `ToolEntry` has the same two elements on ONE line with a literal space
               between them, which is why the card never showed it.

               ⚠️ **The separator is an INTERPOLATION, and the two simpler forms both failed.**
               A trailing space inside the `<strong>` is stripped as end-of-children whitespace, so
               it still rendered `Bashnode`. A literal space between the two elements on one line
               survives — but it survives the `v-if` being FALSE too, and a row with no name then
               rendered ` b1`, a leading space in front of the only thing naming it. `{{ ' ' }}` is
               an expression rather than whitespace, so it exists exactly when the name does; the
               newline before `<code>` is the whitespace-only node `condense` removes. Both cases
               are asserted in `background-bar.render.test.ts`, which is what found the second one. -->
            <template v-if="what.name"
              ><strong>{{ what.name }}</strong
              >{{ ' ' }}</template
            >
            <code>{{ what.text }}</code>
            <!-- ⛔ **A cut is COUNTED, never a browser's ellipsis** (092, and see `cutNote`). This row
               used to be `text-overflow: ellipsis`, which draws a `…` indistinguishable from one the
               command ends with and says nothing about how much is behind it. -->
            <span v-if="what.cut > 0" class="bg-cut" :data-cy="`background-cut-${row.id}`">{{
              cutNote(what.cut)
            }}</span>
          </span>
          <!-- The provider's own word for the kind. ⚠️ `local_bash` and `local_agent` are shown AS
             SENT, on 072's precedent for an adapter's neutral kind string: a friendlier translation
             is a hand-maintained map of values that a new pin can add to — the SDK types `task_type`
             as an open `string` and its own doc names a third, `local_workflow` — and 039 is what a
             renderer inventing a provider's vocabulary costs. ⛔ **And 251 §1 is the ruling that it
             must not be translated**: a Monitor IS a shell, `local_bash` is honest, and the word for
             it only ever reaches us in the ENDING summary — after the one moment it was needed. -->
          <span v-if="row.kind" class="bg-kind">{{ row.kind }}</span>
          <!-- ⛔ ONE gate, read by the button and by nothing else — 094's rule, which exists because
             three stop affordances were gated on `busy` one at a time and left a turn nobody could
             abandon. `canStop` is the whole condition: the row is in the registry, so it IS running;
             the adapter said it can stop; there is nothing else to ask. -->
          <button
            v-if="props.canStop"
            class="bg-stop"
            type="button"
            :disabled="asked.has(row.id)"
            :title="
              asked.has(row.id)
                ? 'Asked to stop. The provider reports the ending on its own.'
                : 'Stop this one. The conversation keeps running.'
            "
            :data-cy="`background-stop-${row.id}`"
            @click="void stop(row.id)"
          >
            {{ asked.has(row.id) ? 'Stopping…' : 'Stop' }}
          </button>
        </li>
      </ol>
      <!-- ⛔ **The registry saying it is UNDERSTATING itself** (247's `dropped`, 092's no-silent-cap
         rule). Non-zero means rows the provider sent that the event does not carry — past the 200
         ceiling, or with no id at all. A list that looks complete is read as complete, and `247` §3
         is blunt about the cost: *"a registry that quietly undercounts is worse than none."* -->
      <p v-if="props.registry.dropped > 0" class="bg-dropped" data-cy="background-dropped">
        {{ droppedNote(props.registry.dropped) }}
      </p>
    </div>
  </aside>
</template>

<style scoped>
/* A section of the agent card, as Current task is: the panel's width, its heading at the left. */
.bg-bar {
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) solid var(--drawer-card-line, var(--line));
  border-radius: var(--radius-lg);
  background: var(--drawer-card-bg, var(--panel));
}

.bg-head {
  display: flex;
  align-items: baseline;
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

/* The same accent-plus-glow the tool row's running dot has, for the same reason it has it: this is
   work in progress, and the whole defect was that it did not look like any. */
.bg-dot {
  width: 5px;
  height: 5px;
  flex: none;
  align-self: center;
  border-radius: var(--radius-pill);
  background: var(--accent);
  box-shadow: var(--accent-glow-weak);
}

/* The heading itself, unstyled and pressable, as an agent card's folding sections. */
.bg-fold {
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

/* Down while open, right while folded. */
.bg-chevron {
  width: 11px;
  height: 11px;
  flex: none;
  align-self: center;
  color: var(--faint);
  transform: rotate(90deg);
}

.bg-chevron.folded {
  transform: none;
}

.bg-rows {
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.bg-row {
  display: grid;
  align-items: center;
  padding: var(--space-3) 0;
  gap: var(--space-4);
  grid-template-columns: minmax(0, 1fr) auto auto;
}

/* ⛔ **It WRAPS, and that is 092 rather than a layout preference** (251 §2). This was
   `white-space: nowrap` + `text-overflow: ellipsis`, which hides an unbounded amount of a command
   behind a glyph the browser draws and the reader cannot tell from the command's own last character.
   The ceiling is in `background-work.ts` now, where it can be counted and said out loud, and
   `overflow-wrap` is what keeps one unbroken 160-character argument inside the column instead of
   pushing the Stop button off the bar. */
.bg-what {
  min-width: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.bg-what strong {
  color: var(--text-soft);
  font-weight: var(--fw-bold);
}

.bg-what code {
  color: var(--mono-text);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

/* The count, in the same colour as `dropped` one block down: both say "this surface is showing you
   less than there is", and a reader who has learnt one has learnt the other. */
.bg-cut {
  margin-left: var(--space-3);
  color: var(--waiting);
  font-size: var(--type-caption);
}

.bg-kind {
  color: var(--faint);
  font: var(--type-caption) / 1.4 var(--font-mono);
}

.bg-stop {
  padding: var(--space-3) var(--space-5);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-soft);
  font-size: var(--type-caption);
}

.bg-stop:hover:not(:disabled) {
  background: var(--wash-2);
}

.bg-stop:disabled {
  color: var(--faint);
}

.bg-dropped {
  margin: var(--space-4) 0 0;
  color: var(--waiting);
  font-size: var(--type-caption);
}
</style>
