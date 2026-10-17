<script setup lang="ts">
import { computed, ref } from 'vue'
import { subAgentFacets } from '../lib/agent-state'
import { BACKGROUND_SENTENCE, BACKGROUND_WORD, backgroundState } from '../lib/background-work'
import { renderChatMarkdown } from '../lib/markdown'
import type { SubAgentCard } from '../lib/transcript'
import type { ChildWorkInput } from '../../../shared/runtime-ipc'
import AgentState from './AgentState.vue'
import { usePathsIn, type PathsHere } from '../composables/useMessagePaths'

/**
 * An agent the agent dispatched (029) — collapsed by default, and deliberately so.
 *
 * **It must not shove the conversation around while it runs.** A sub-agent emits a heartbeat every
 * few seconds for minutes; if the card grew with each one, the reader's place in the parent
 * conversation would move under them repeatedly. So the head is fixed-height and states everything
 * that changes — kind, title, live status, the tool it is on, its usage — and the body, which holds
 * the child's own tool transcript and its final answer, only opens when asked for.
 *
 * The head reads as one sentence: *what kind of agent · what it was asked to do · what it is doing
 * now*. Since 082 the mark at the front is the shared {@link AgentState} plate rather than a dot of
 * this card's own, and it is still not colour alone — the status word is written out beside it,
 * because a mark is not a sentence and two of those colours are indistinguishable to a red-green-blind
 * reader.
 *
 * "ended with no outcome" is a real state and is rendered as itself. It means the turn finished, or
 * the app was quit and the ledger replayed, without the provider ever saying how the sub-agent went
 * — which is a different fact from success, and the card must not round it to one.
 *
 * ⚠️ **It used to be EVERY Codex sub-agent's ending, and since 226 it is not** (033, corrected). A
 * Codex child ends twice on the wire: its thread goes `idle`, which says only that it stopped, and
 * then its own `turn/completed` says how — `completed`, `interrupted` or `failed`, from the
 * provider's own union. So this state now means what it says everywhere: nobody told us.
 */
const props = withDefaults(
  defineProps<{
    card: SubAgentCard
    /**
     * Where this card sits, which is the one thing about it that is not the card's own business
     * (034). Both placements are first-class — 029 renders a card whose dispatching row is not on
     * screen at top level BY DESIGN — and they need different geometry, so the container says
     * which it is rather than the card guessing:
     *
     *  - `'transcript'` — a transcript entry in its own right, so it obeys the reading measure and
     *    carries the same trailing space as every other entry. Without this it ran the full width
     *    of the pane and sat flush against whatever followed it.
     *  - `'nested'` — inside the dispatch row that spawned it, which already owns the measure and
     *    the padding; adding either again would double it.
     *
     * Defaults to `'transcript'`: a new call site that forgets gets the standalone treatment,
     * which is wrong-looking rather than broken-looking.
     */
    placement?: 'transcript' | 'nested'
    /**
     * ⛔ **Whether this conversation can be asked what its tools answered** (462) — the same boolean
     * `ToolEntry` takes, travelling the whole recursion for the reason `openChild` does: an agent's
     * agent's row is a row too.
     *
     * ⚠️ **What a child's row gets out of it differs by PROVIDER, and the panel says so rather than
     * this prop.** Claude forwards a sub-agent's `tool_result` blocks into the parent stream, so a
     * child's receipt lands in the same hold under its own id; a Codex child is a separate THREAD
     * and `namesForeignThread` refuses its frames before anything holds them. ⛔ **Neither is a
     * branch here** — the read answers what it answers and the panel draws it.
     */
    canReadAnswer?: boolean
    /**
     * Whether a press on *Open transcript* has somewhere to go. Off, the button is not drawn; the
     * card's own id stays, so the record is still there to read and copy. Passed down to nested cards.
     */
    canOpenTranscript?: boolean
    /** The parent conversation's paths. Absent: a path in what the child said stays plain text. */
    paths?: PathsHere | null
  }>(),
  { placement: 'transcript', canReadAnswer: false, canOpenTranscript: true },
)

/**
 * Give plain sub-agent cards the same child-transcript destination available from workflow trees, using the recorded child identity.
 *
 * ⚠️ **An IDENTITY, never a path** — the same rule `WorkflowEntry` states at its own `openChild`.
 * The card contributes the agent id its own event carried; the host decides whether this session
 * ever reported it, and only then does anything touch a filesystem.
 */
const emit = defineEmits<{
  openChild: [what: ChildWorkInput, label: string]
  /**
   * ⛔ **Show the whole of what one of this child's tools answered** (462) — raised, never handled
   * here, and it travels up through every level of the recursion because only the pane at the top
   * owns an overlay. Exactly `openChild`'s own route.
   */
  openAnswer: [callId: string, name: string]
}>()

const open = ref(false)

/** A disclosure needs both halves of the ARIA pair: the button announces the state, `aria-controls`
 *  says WHAT it controls. The agent id is already unique per card, so it doubles as the anchor.
 *
 *  Bound only while the body is actually rendered. The body is `v-if="open && hasBody"`, so a card
 *  with a body that is closed — the state every card starts in — had a button naming an element that
 *  was not in the document (034 review; the same shape as the permission card's, and here since
 *  029). `aria-expanded`, the half that carries the meaning, is unaffected. */
const bodyId = computed(() => `subagent-body-${props.card.agentId}`)

const status = computed(() => {
  if (props.card.running) return 'running'
  return props.card.outcome ?? 'unreported'
})

/**
 * The same five states, in the agent grammar (082).
 *
 * ⚠️ **This does not duplicate `status` above; it says a different thing about it.** `status` is the
 * OUTCOME — the word, and its colour — and the agent facets are what the sub-agent was doing and
 * whether it is still with us. `completed` and `interrupted` both end up as `ended` on the plate,
 * which is not a loss: the line means "over", and the word beside it still says how.
 */
const facets = computed(() => subAgentFacets(props.card))

const statusLabel = computed(
  () =>
    ({
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      // Stopped from outside (033): neither a success nor the sub-agent's fault, so it says so
      // rather than borrowing the red of `failed` or the silence of `ended`.
      interrupted: 'interrupted',
      unreported: 'ended',
    })[status.value],
)

/**
 * What kind of id this is, in the provider's own terms (111).
 *
 * ⚠️ **The wording is the point, not the label.** Claude's `agentId` is a task id living inside the
 * parent's process; Codex's is a real **thread** id. One word — "ID" versus "thread" — is the
 * difference between "a handle on some work" and "a conversation that exists somewhere".
 *
 * ⛔ **This comment used to end "…and there is nothing to open", and that was FALSE** (115). A plain
 * `Task` child writes an ordinary transcript to `subagents/agent-<agentId>.jsonl` beside its
 * parent's, and 11 of the 12 this app has ever recorded are on disk right now. Both kinds open, by
 * different lookups the host owns; what differs is the file, not whether one exists.
 */
const identity = computed(() => IDENTITY[props.card.idKind ?? 'unknown'])

/**
 * What to call an agent that reported no name for itself.
 *
 * ⚑ **A grandchild reports LESS than a child, and the word carries the difference** (135). Codex
 * announces a depth-1 agent with the name the model coined for it (`ui_test`); an agent nothing
 * announced is a thread we only ever saw go active. `nested agent` is what is actually known about
 * it — that it is an agent, below us, and not one of the ones we were told about. It is a WORD, not
 * a face: see {@link facets}, which is untouched.
 *
 * ⛔ **A DEPTH-2 agent is no longer one of these, and that is what `225` was looking at** (226).
 * Its birth does reach this app — measured on the wire as `/root/coordinator/gamma`, carrying the
 * same `agentPath` and dispatching call a depth-1 child's does — and the adapter now adopts it, so
 * a grandchild arrives here named `coordinator/gamma` with a parent to point at. Two children that
 * both read `nested agent` is therefore a bug report about the adapter, not a fact about Codex,
 * and it is fixed one layer down rather than papered over with a better word here.
 */
const anonymous = computed(() => (props.card.origin === 'observed' ? 'nested agent' : 'agent'))

/**
 * What to call this child in the viewer's header — the same sentence the head reads as.
 *
 * Falls back to the kind, and then to `agent`. ⚠️ **111 measured "neither a title nor a kind" and
 * the kind half was never true** — `subAgentBirth` has set it from `agentPath` since 033, which is
 * how a card reads `alpha` rather than `agent`. A Codex child still reports no TITLE, and an empty
 * header is not a label, so the chain stays.
 */
const openLabel = computed(() => props.card.title || props.card.kind || anonymous.value)

/**
 * ⚠️ **Offered on EVERY card, and that is a decision rather than an oversight.**
 *
 * Nothing on the wire says whether a child's file exists — `107` could put "Open output →" behind a
 * reported `outputFile`, and there is no equivalent here for either provider. Hiding the button
 * until we were sure would hide it always. So it is always offered and the refusal is honest: the
 * door answers `gone` with a sentence naming both of its causes, an agent that has not written
 * anything yet and a home that has since been cleaned.
 */
function openTranscript(): void {
  emit('openChild', { part: 'transcript', agentId: props.card.agentId }, openLabel.value)
}

/**
 * ⚠️ **Keyed on the wire fact, NOT on the provider — and that is `039`'s guard doing its job.**
 * `111` asked for *"Claude child ID"* versus *"Codex child thread"*, and `provider-neutrality.test.ts`
 * refuses a renderer that recognises a provider by name: a surface deciding what to say from a brand
 * is a capability decided in the wrong place. What genuinely differs is the KIND of identifier, and
 * each adapter states it (`subAgentEventSchema.idKind`), so the wording follows a fact instead of a
 * comparison. The provider's own name is on the session header, where it is already true.
 */
const IDENTITY: Record<string, string> = {
  task: 'child task ID',
  thread: 'child thread ID',
  // Nothing said it. It names what it has rather than picking one of the two.
  unknown: 'child agent',
}

/**
 * ⚠️ **This used to say a Codex child reports no usage, and 226 measured that it does** (111
 * criterion 3, corrected). The old note was accurate about the LEDGER it read — three `sub_agent`
 * events carrying an id, a parent call and nothing else — and wrong about the provider: a child's
 * `thread/tokenUsage/updated`, its tool items and its `turn/completed` all arrive on this
 * connection under the child's own thread id, and this session was discarding them unread. The card
 * now shows tokens, a tool count, a duration and an outcome for a Codex child, the same four things
 * a Claude child has always shown.
 *
 * ⛔ **The blank stays, because a blank is still reachable and still means something.** A child
 * killed with its parent never reports a `turn/completed`; a session replayed from a ledger written
 * before this existed has no usage in it. `086`/`104`'s rule holds for those: an honest blank beats
 * a fabricated number, and `0 tools · 0k tokens` would read as a child that did nothing rather than
 * a report we never received.
 */
const usageUnreported = computed(() => props.card.usage === undefined)

/** Usage, in the units a reader actually thinks in. Each part is shown only if it was reported. */
const usage = computed(() => {
  const u = props.card.usage
  if (!u) return ''
  const parts = [
    u.toolCalls !== undefined ? `${u.toolCalls} tool${u.toolCalls === 1 ? '' : 's'}` : '',
    u.tokens !== undefined ? `${Math.round(u.tokens / 100) / 10}k tokens` : '',
    u.ms !== undefined
      ? u.ms < 1000
        ? `${Math.round(u.ms)} ms`
        : `${(u.ms / 1000).toFixed(1)} s`
      : '',
  ].filter(Boolean)
  return parts.join(' · ')
})

const summaryHtml = computed(() =>
  props.card.summary ? renderChatMarkdown(props.card.summary) : '',
)
const hasBody = computed(() => props.card.body.length > 0 || Boolean(props.card.summary))

/**
 * **The child's own voice, one line, in the head** (128, from 127's ruling).
 *
 * ⚠️ **Derived from the body rather than buffered beside it**, which is the same choice
 * {@link SubAgentCard.body} makes one layer down: a stored `saying` is a second copy of a sentence
 * that is already on the card, and the two could disagree about what the child last said.
 *
 * ⛔ **Only while it RUNS.** *"now saying…"* about an agent that finished is a present tense with
 * nothing behind it — the same false claim `074` swept out of the tool rows and `stopRunningSubAgents`
 * out of the plate. Once it is over, the last word is in the body where it belongs, and the head goes
 * back to saying how it ended.
 *
 * Newlines are collapsed because this is ONE line by construction, and the **clipping** is CSS's, so
 * the ellipsis the reader sees is the engine's rather than a number in here.
 *
 * ⚠️ **{@link GLIMPSE_CHARS} is a memory bound, NOT the visible one**, which is the only reason it
 * can be a plain number without being the bound nobody chose (052's shape, one surface over). The
 * card is at most `--measure-message` wide and this line is `--text-3xs`, so the widest glimpse this
 * app can draw is on the order of a hundred characters; the cut is several times past anything the
 * ellipsis could ever reach. What it stops is a child that forwards a megabyte holding that megabyte
 * TWICE — once in the body that renders it and once in a head that shows one line of it.
 */
const GLIMPSE_CHARS = 240

const saying = computed(() => {
  if (!props.card.running) return ''
  for (let i = props.card.body.length - 1; i >= 0; i--) {
    const row = props.card.body[i]
    if (row?.kind === 'prose') {
      return row.text.slice(0, GLIMPSE_CHARS).replace(/\s+/g, ' ').trim()
    }
  }
  return ''
})

/**
 * The body, render-ready — the same rows in the same order, with prose turned into markup once.
 *
 * ⚠️ **A computed rather than a function called from the template, and the difference is real
 * work.** A running sub-agent heartbeats every few seconds and each beat writes `usage` on this
 * card; a `v-html="said(row.text)"` would re-parse every paragraph the child has ever said on every
 * one of those beats. The computed's dependencies are the body's rows and their text, which a usage
 * write does not touch, so the markdown is parsed when the child speaks and not again.
 *
 * ⛔ **Never trusted as HTML.** `renderChatMarkdown` runs markdown-it with `html: false` (see
 * `lib/markdown.ts`), so a child that emits a `<script>` gets a `<script>` on screen as text. This
 * is forwarded provider output — the one class of string in this app that a hostile file can reach —
 * and it takes the same door the parent's own prose takes.
 */
const rows = computed(() =>
  props.card.body.map((row) =>
    row.kind === 'prose' ? { ...row, html: renderChatMarkdown(row.text) } : row,
  ),
)

/** Asked about once the child has finished and its body is open. */
const paths = usePathsIn(
  () => props.paths,
  () =>
    open.value && !props.card.running
      ? [
          ...rows.value.flatMap((row) => (row.kind === 'prose' ? [row.html] : [])),
          summaryHtml.value,
        ]
      : [],
)

/** What is drawn: the same rows, with the paths main found marked. */
const drawnRows = computed(() =>
  rows.value.map((row) => (row.kind === 'prose' ? { ...row, html: paths.mark(row.html) } : row)),
)
const summary = computed(() => paths.mark(summaryHtml.value))
</script>

<template>
  <div
    class="subagent"
    data-cy="subagent-entry"
    :data-status="status"
    :data-placement="placement"
    :data-agent-id="card.agentId"
  >
    <component
      :is="hasBody ? 'button' : 'div'"
      class="head"
      :type="hasBody ? 'button' : undefined"
      :aria-expanded="hasBody ? open : undefined"
      :aria-controls="hasBody && open ? bodyId : undefined"
      data-cy="subagent-head"
      @click="hasBody && (open = !open)"
    >
      <!-- ⚠️ **The bare coloured dot is gone (082).** It said one thing in one colour; the plate says
           what the agent is DOING and what it IS, in two facets, and `unreported` finally has an
           honest drawing — a faceless mark with no underline, because "we were never told" is not
           "it completed". The five written outcomes below are untouched and still carry the word. -->
      <AgentState size="compact" v-bind="facets" :label="card.kind || anonymous" />
      <span class="who">
        <strong data-cy="subagent-kind">{{ card.kind || anonymous }}</strong>
        <span v-if="card.title" class="title" data-cy="subagent-title">{{ card.title }}</span>
        <!-- ⚠️ **Inside the head's existing row, never a line of its own** (128). The card's whole
             contract is that it must not shove the conversation while it runs, and a glimpse that
             appears when the child starts talking would move every following turn down the moment
             it did. Here it takes the space the title was clipping into: the row height is the same
             sentence with or without it. -->
        <span v-if="saying" class="saying" data-cy="subagent-saying">{{ saying }}</span>
      </span>
      <span class="meta">
        <!-- While it runs, the tool it is on is the most useful thing on the row; once it is over,
             what matters is how it went. Never both — the row must not change height. -->
        <span v-if="card.running && card.lastTool" class="doing" data-cy="subagent-last-tool">
          {{ card.lastTool }}
        </span>
        <span class="status" data-cy="subagent-status">{{ statusLabel }}</span>
        <span v-if="usage" class="usage" data-cy="subagent-usage">{{ usage }}</span>
        <!-- ⛔ Never a zero. See {@link usageUnreported}: this is a provider that does not say, and
             `0 tools · 0k tokens` would be a number we made up about a child that may have done a
             great deal. Only once the card is over — while it runs, "no usage yet" is ordinary. -->
        <span
          v-else-if="!card.running && usageUnreported"
          class="usage quiet"
          data-cy="subagent-usage-unreported"
        >
          usage not reported
        </span>
        <svg v-if="hasBody" class="icon chevron" :class="{ open }"><use href="#i-chevron" /></svg>
      </span>
    </component>

    <!-- ⚠️ **The identity we already held and never showed** (111, from 109 item 1). It is outside
         the disclosure button on purpose: it is not part of the sentence the head reads as, and it
         must be selectable — an id you cannot copy is an id you cannot use. -->
    <div class="ident" data-cy="subagent-ident">
      <span class="ident-what">{{ identity }}</span>
      <code class="ident-id" data-cy="subagent-agent-id">{{ card.agentId }}</code>
      <!-- The dispatch that made it. 029 renders a card whose row is not on screen BY DESIGN, so
           this is often the only visible link back to the work that asked for it. -->
      <span v-if="card.parentToolCallId" class="ident-parent" data-cy="subagent-parent">
        from <code>{{ card.parentToolCallId }}</code>
      </span>
      <!-- ⛔ **The blank that 111 argued for, said out loud** (135). ⚠️ **The reason has changed and
           the blank has not** (226): this was written for a child of ours spawning a child of its
           own, and that case now arrives announced, named and with a call to show. What still
           reaches this branch is a thread that went active having been announced by nothing at all —
           for which there genuinely is no id, and never will be. Saying nothing would leave a
           nameless card sitting beside agents it is not a peer of; naming a parent we were never
           told about would be the fabrication 035 forbids. So it says which of the two it is.
           `v-else-if` on `origin`, never on a missing id: a Claude `task_updated` also arrives
           without one, and that parent is pending rather than unknown. -->
      <span
        v-else-if="card.origin === 'observed'"
        class="ident-parent quiet"
        data-cy="subagent-parent-unknown"
      >
        nested — parent not reported
      </span>
      <!-- ⚠️ Said only when the provider said it. "ended with no outcome" is already carried by the
           status word; repeating it here as "outcome: unknown" would be two claims about one silence. -->
      <span v-if="card.outcome" class="ident-outcome" data-cy="subagent-outcome">
        ended {{ card.outcome }}
      </span>
      <!-- Put Open in the identity row because the head is already a disclosure button. Nesting the action inside that button would produce invalid interactive markup. -->
      <button
        v-if="props.canOpenTranscript"
        class="ident-open"
        type="button"
        data-cy="subagent-open-transcript"
        @click="openTranscript"
      >
        Open transcript →
      </button>
    </div>

    <div v-if="open && hasBody" :id="bodyId" class="body" @click="paths.clicked">
      <!-- The child's OWN calls and its OWN words, which Claude forwards into the parent stream.
           Collected here they are a nested transcript; left in the parent flow they read as the
           parent's own work — which is what the calls wrongly did before 029 and what the speech
           wrongly did before 128. ONE list, in one order: 058's rule is about a single sequence,
           and merging two collections at render is how 044 P3 put a tool in front of the text that
           preceded it. -->
      <ol v-if="rows.length" class="rows" data-cy="subagent-rows">
        <template v-for="row in drawnRows" :key="row.kind === 'tool' ? row.callId : row.id">
          <!-- ⚠️ `pending` means "still to come", and for a child of a session that is gone nothing
               is coming (074). Only `false` is styled, so this is a read-out rather than a colour —
               but it is the read-out a test, an inspector or anything reading the DOM gets, and
               "pending" forever is the same false claim `running…` was on the parent row. -->
          <li
            v-if="row.kind === 'tool'"
            class="tool"
            :data-ok="
              row.result ? String(row.result.ok) : row.unfinished ? 'unfinished' : 'pending'
            "
          >
            <strong>{{ row.name }}</strong>
            <code>{{ row.summary }}</code>
            <!-- ⛔ **A child's command can be detached too** (248), and `data-ok` cannot say so: that
                 attribute reports the RECEIPT, which for a backgrounded command is `true` and
                 correct. The word is the second fact beside it, out of the same table the parent
                 row and the registry read (222 §4), so one state is never named two ways. -->
            <small
              v-if="row.background"
              class="row-background"
              :title="BACKGROUND_SENTENCE[backgroundState(row.background)]"
              :data-cy="`subagent-tool-background-${row.callId}`"
              >{{ BACKGROUND_WORD[backgroundState(row.background)] }}</small
            >
            <!-- 🔴 **What the child's tool ANSWERED** (462, closing `457`'s *"a sub-agent's result
                 summary is never drawn at all"*). ⛔ **It was on the card and on the wire and
                 nowhere on the screen**: `SubAgentToolRow.result` has carried `{summary, ok}` since
                 029, and this row drew the CALL and an ok/pending attribute about the result while
                 saying not one word of it. ⚠️ Dimmer than the call above it and on its own line,
                 because it is the second half of one row rather than a second row.
                 ⚑ **And the door to the whole of it, beside the sentence it summarises** — the same
                 gesture as the parent row's, one level in. -->
            <template v-if="row.result">
              <small class="row-said" :data-cy="`subagent-tool-result-${row.callId}`">{{
                row.result.summary
              }}</small>
              <button
                v-if="props.canReadAnswer"
                class="row-ask"
                type="button"
                :data-cy="`subagent-tool-answer-${row.callId}`"
                title="Show everything this tool answered, not just the short form on this row."
                @click="emit('openAnswer', row.callId, row.name)"
              >
                the whole answer
              </button>
            </template>
            <!-- Nest each child's card under the call that dispatched it so its connection to the work stays visible. Recurse through this same component for agents' agents. -->
            <!-- An agent's agent's transcript is a transcript too: the request travels up through
                 every level of the recursion, because only the pane at the top owns an overlay. -->
            <SubAgentEntry
              v-for="child in row.subAgents ?? []"
              :key="child.agentId"
              :card="child"
              placement="nested"
              :can-read-answer="props.canReadAnswer"
              :can-open-transcript="props.canOpenTranscript"
              @open-child="(what, label) => emit('openChild', what, label)"
              @open-answer="(callId, name) => emit('openAnswer', callId, name)"
            />
          </li>
          <!-- ⚑ **The child speaking, in the card that says who it is** (128). No nametag on the
               line: attribution here is POSITION — the head above already states the identity, and a
               coloured prefix on every sentence is the manual workaround this change exists to
               retire. The accent rule on the left is what marks it as speech rather than a row. -->
          <li v-else class="says" data-cy="subagent-says">
            <!-- eslint-disable-next-line vue/no-v-html -- see `rows`: markdown-it runs with
                 `html: false`, the same door the parent's own prose takes. -->
            <div class="md-chat" v-html="row.html"></div>
          </li>
        </template>
      </ol>
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it runs with `html: false`; see
           lib/markdown.ts. -->
      <div v-if="summary" class="md-chat answer" data-cy="subagent-summary" v-html="summary"></div>
      <p
        v-if="paths.failure.value"
        class="message-path-failure"
        role="status"
        data-cy="message-path-failure"
      >
        {{ paths.failure.value }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.ident {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  padding: 0 var(--space-3) var(--space-2);
  font-size: var(--type-caption);
  color: var(--muted);
}

.ident code {
  font-family: var(--font-mono);
  /* Selectable, and it must stay so: the whole value of an id on screen is being able to take it. */
  user-select: text;
  word-break: break-all;
}

.ident-what {
  font-weight: var(--fw-semibold);
}

/* A link in weight, a button in behaviour — it is the same affordance the workflow tree's agent
   labels carry, and it must not compete with the head for the eye. */
.ident-open {
  padding: 0;
  border: 0;
  margin-left: auto;
  background: transparent;
  color: var(--accent-text-soft);
  font: inherit;
}

.ident-open:hover {
  color: var(--accent-text);
  text-decoration: underline;
}

/* `quiet` says the same thing in both places it appears: this is the app admitting it was not told
   something, not a state of the agent. No colour of its own — the ident row is already `--muted`,
   and a second hue would read as a status. */
.usage.quiet,
.ident-parent.quiet {
  font-style: italic;
  opacity: 0.85;
}

.subagent {
  margin: var(--space-3) 0 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
}

/* A sub-agent nested in another draws no wash of its own: the outermost card's wash is the one
   surface its whole tree stands on, however deep it goes. */
.subagent .subagent {
  background: none;
}

/* A card standing on its own in the stream is a transcript entry, and every transcript entry obeys
   the same two rules: the reading measure, and space beneath it (034). It had neither — it ran the
   full width of the pane, which read as "this one is more important", and its bottom edge sat flush
   against the next entry. The nested placement keeps `margin: … 0 0` above: the dispatch row it
   sits in already owns both. */
[data-placement='transcript'] {
  max-width: var(--measure-message);
  margin: var(--space-3) auto var(--space-6);
}

.head {
  display: grid;
  width: 100%;
  min-height: 28px;
  align-items: center;
  padding: var(--space-3) var(--space-6);
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  /* 24px is the plate's floor (081 §4) — the smallest size at which the illustration is still an
     illustration rather than mud. The row was 28px tall for a 6px dot and still is; the plate fits
     inside it without moving anything below. */
  grid-template-columns: 24px minmax(0, 1fr) auto;
  text-align: left;
}

button.head:hover {
  color: var(--text-soft);
}

.who {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-3);
}

.who strong {
  color: var(--text-soft);
  font-weight: var(--fw-bold);
  white-space: nowrap;
}

/* The title is the part that can be long, so it is the part that clips — the kind and the status
   must always stay readable. `flex: 0 1 auto`: it gives way to the glimpse beside it rather than
   holding its full width and pushing the child's words out of the row entirely. */
.title {
  overflow: hidden;
  flex: 0 1 auto;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ⛔ **One line, and it takes only what is left** (128). `flex: 1 1 0` with `min-width: 0` is what
   keeps the head one row tall no matter how much the child says: the basis is zero, so a six-
   paragraph message occupies the same space as a six-word one, and the ellipsis is the reader's
   visible sign that there is more of it in the body. Italic and recessed because it is a glimpse of
   speech, not a field of the card. */
.saying {
  overflow: hidden;
  flex: 1 1 0;
  min-width: 0;
  color: var(--faint);
  font-style: italic;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
  white-space: nowrap;
}

.doing {
  font-family: var(--font-mono);
}

.status {
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

[data-status='completed'] .status {
  color: var(--success);
}

[data-status='failed'] .status {
  color: var(--danger);
}

[data-status='running'] .status {
  color: var(--accent-text-soft);
}

[data-status='interrupted'] .status {
  color: var(--text-soft);
}

.chevron {
  width: 10px;
  height: 10px;
  transition: transform var(--dur-fast) ease;
}

.chevron.open {
  transform: rotate(90deg);
}

/* Same horizontal inset as the head, so the child's transcript lines up under the name of the
   agent that produced it rather than starting somewhere of its own.

   ⛔ **Bounded, since the body started carrying speech** (128). A child that narrates six paragraphs
   used to be a reading problem either way; now it is one that lives inside this box. Past
   `--child-body-max` the card scrolls inside itself and the parent's next sentence stays where the
   reader left it — the same bargain `WorkflowEntry`'s `--wf-tree-max` makes for the same reason, and
   the reason the card's own comment gives for being collapsed at all. **Open transcript →** is still
   the door to the whole thing.

   ⚠️ **The same 340px as the workflow tree, deliberately.** Two collapsible bodies in the same
   column that stop growing at different heights would read as two different rules; this is one rule
   with two local names, because scoped styles cannot share a property and neither belongs in
   `tokens.css` — a palette entry is a decision about the app, and this is a decision about a box.
   No new design token (127 §8). */
.body {
  --child-body-max: 340px;

  max-height: var(--child-body-max);
  padding: var(--space-4) var(--space-6);
  border-top: var(--border-width) solid var(--line);
  overflow-y: auto;
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Speech, marked as speech. The rule on the left is the recess: it says "these words came from
   inside this card" without putting a coloured name on every line — attribution here is position
   (127 Q3), and the head one row up already states whose card this is. */
.says {
  padding: var(--space-2) 0 var(--space-2) var(--space-4);
  border-left: var(--border-accent-width) solid var(--accent-border);
  margin: var(--space-3) 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}

.tool {
  display: flex;
  align-items: baseline;
  padding: 1px 0;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-3);
}

.tool[data-ok='false'] strong {
  color: var(--danger);
}

.tool code {
  overflow: hidden;
  color: var(--faint);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The detached word (248). `flex: none` so it survives the ellipsis above it: the whole point of
   the line is that this fact reaches the reader, and a row whose command has a long summary is
   exactly the row where it would otherwise be the first thing squeezed out. */
.row-background {
  flex: none;
  color: var(--faint);
  font-size: var(--type-caption);
}

/* ⛔ **What the child's tool answered** (462). ⚠️ **It clips like `.tool code` beside it rather than
   wrapping, and that is the ROW's existing design being kept rather than a new choice**: this line
   is one line, `.row-background`'s note above records what happens to a row that lets a long summary
   push things around, and the whole of the answer is one press away in the panel. `min-width: 0` is
   what actually lets a flex item shrink below its content — without it `overflow: hidden` has
   nothing to hide. */
.row-said {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--faint);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* `flex: none` for `.row-background`'s stated reason, and it matters more here: this is the only
   control on the line, and a control squeezed to nothing is 106's control that cannot act. A link
   rather than the parent row's bordered button — a child's row is a line of text, and a box on it
   would outweigh the card it sits inside. */
.row-ask {
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-2-text);
  font-size: var(--type-caption);
  text-decoration: underline;
}

.answer {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
  color: var(--text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-relaxed);
}
</style>
