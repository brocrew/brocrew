<script setup lang="ts">
import { computed, ref } from 'vue'
import { pathTail } from '../../../shared/path-tail'
import { workflowAgentFacets, workflowAgentStopped } from '../lib/agent-state'
import type { ChildWorkInput } from '../../../shared/runtime-ipc'
import type { WorkflowRunCard } from '../lib/transcript'
import { workflowPhaseState } from '../lib/workflow'
import AgentState from './AgentState.vue'

/**
 * A dynamic workflow, drawn where it was launched (108, designed in 107).
 *
 * Render workflow frames explicitly instead of filtering them out as chatter.
 *
 * **One evolving structure, collapsed by default.** The reproduction run sent twelve frames; a
 * 22-agent run sends far more. They mutate this tree in place and add nothing to the conversation —
 * 078's *"without turning every usage update into a transcript row."* Collapsed is the default for
 * the same reason {@link SubAgentEntry} is: a heartbeat must never shove the reader's place.
 *
 * ⚠️ **Never amber, anywhere, and that is 080's line rather than a palette choice.** `--waiting` IS
 * the attention channel, so a workflow that is merely BUSY may not spend it. The five states land on
 * `--accent` / `--accent-2` / `--success` / `--danger` / `--faint`, all already declared.
 *
 * ⚠️ This comment used to name an exception — an agent's own permission badge — and the exception
 * did not exist (108 review). Nothing on the wire links a permission to a workflow agent, so no row
 * here can wear one. 107 §6's ruling that such a permission "counts" is still kept, by the route
 * that is actually real: it arrives as an ordinary `permission_request` card in the conversation and
 * is counted like any other. Describing a badge this component cannot draw is the "unwired control
 * hinted at" defect 106 was caught by.
 */
const props = withDefaults(
  defineProps<{
    run: WorkflowRunCard
    /**
     * Whether an agent's transcript, the journal and the script have somewhere to open. Off, none
     * of those buttons is drawn and each agent's label is plain text.
     */
    canOpenChild?: boolean
    /** Whether the output file has somewhere to open. Off, its name is shown as plain text. */
    canOpenOutput?: boolean
  }>(),
  { canOpenChild: true, canOpenOutput: true },
)

const emit = defineEmits<{
  /**
   * Read the run's output file. Raised, never handled here — an overlay is the pane's state.
   *
   * ⚠️ **It carries the run's IDENTITY, not its path.** The path is resolved in the main process
   * from the ledger; a renderer that passed one would make the read channel an arbitrary-file
   * reader. See `main/workflow-output.ts`.
   */
  openOutput: [taskId: string, workflow: string]
  /**
   * Open what one agent did (112) — its own transcript, or the run's journal, or the script.
   *
   * The same rule as `openOutput`: an IDENTITY, never a path. ⚠️ **A transcript is addressed by the
   * agent and a journal or a script by the RUN**, because those two belong to the run and not to any
   * one agent — see `ChildWorkInput`.
   */
  openChild: [what: ChildWorkInput, label: string]
}>()

/** Folded by default. The head states everything that changes, so folded is never uninformative. */
const open = ref(false)

/**
 * Which finished phases the reader has asked to see (112).
 *
 * While running, expand the phase being worked on. Afterward, allow completed phases to expand too, so their agent rows remain reachable instead of only showing counts.
 *
 * So the default is unchanged and the restraint holds — a finished phase is still collapsed to its
 * tally, and a 22-agent run is still one row. What changed is that the tally is now a BUTTON.
 */
const asked = ref(new Map<number, boolean>())

function togglePhase(phase: { index: number; state: string; agents: unknown[] }): void {
  const next = new Map(asked.value)
  next.set(phase.index, !listsRows(phase))
  asked.value = next
}

/**
 * Whether a phase would list its rows with nobody having said anything — 107's rule, unchanged.
 */
function listsByDefault(state: string): boolean {
  return state === 'running' || state === 'failed'
}

/**
 * Whether a phase lists its rows.
 *
 * ⚠️ **The map holds ABSOLUTE intent — open or closed — and not a delta against the default.** The
 * first version stored "the reader changed this one" and XOR'd it against the phase's current
 * default; review reproduced what that does, and it is the opposite of what the comment promised.
 * A reader collapses the RUNNING phase to get it out of the way (default `true` XOR toggled `true`
 * → closed, correct); the phase then finishes, its default flips to `false`, nothing else changes,
 * and `false XOR true` → **it pops back open on its own**. Storing the answer rather than the
 * difference makes a state change under the reader unable to move anything they asked for.
 */
function listsRows(phase: { index: number; state: string; agents: unknown[] }): boolean {
  if (phase.agents.length === 0) return false
  return asked.value.get(phase.index) ?? listsByDefault(phase.state)
}

/**
 * Whether the phase head is a control at all.
 *
 * ⛔ **A phase with no agents gets no button**, because there is nothing behind it — 106's "unwired
 * control hinted at" is a control that looks like it does something and does not. `0 agents · not
 * started` is already the whole truth about that phase.
 */
function phaseControl(phase: { agents: unknown[] }): boolean {
  return phase.agents.length > 0
}

const bodyId = computed(() => `workflow-body-${props.run.taskId}`)

/**
 * What the run is, in one word.
 *
 * ⚠️ **`unfinished` is not an outcome and is kept apart from one** (074). "We stopped watching"
 * and "it failed" are different sentences, and only one of them is a verdict.
 */
const status = computed(() => {
  if (props.run.running) return 'running'
  if (props.run.unfinished === true) return 'unfinished'
  return props.run.outcome ?? 'unknown'
})

const STATUS_WORD: Record<string, string> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  // An ending we saw and could not read. Not rounded to `completed`, which would put a green word
  // under a run nobody said succeeded.
  unknown: 'ended, outcome not reported',
  unfinished: 'did not finish',
}

const statusWord = computed(() => STATUS_WORD[status.value] ?? status.value)

/** Phases in the provider's own order, each with the state its agents imply. */
const phases = computed(() =>
  props.run.phases.map((phase) => {
    const agents = props.run.agents.filter((agent) => agent.phaseIndex === phase.index)
    return {
      ...phase,
      state: workflowPhaseState(props.run.agents, phase.index),
      agents,
      done: agents.filter((agent) => agent.state === 'done').length,
      failed: agents.filter((agent) => agent.state === 'failed').length,
    }
  }),
)

/**
 * **Which phase is being worked on, of how many** — the head's one line of progress.
 *
 * Reads the LAST phase with any activity rather than the first unfinished one: a run whose phases
 * overlap (a pipeline, which is the tool's default) has several in flight, and "phase 1 of 5" while
 * phase 4 is running would be a number that is true of nothing.
 */
const phaseOf = computed(() => {
  const started = phases.value.filter((phase) => phase.state !== 'empty')
  if (started.length === 0 || phases.value.length === 0) return ''
  return `phase ${started[started.length - 1]!.index} of ${phases.value.length}`
})

/** Live counts for the head — running / done / failed, and each only when it is non-zero. */
const tally = computed(() => {
  const agents = props.run.agents
  if (agents.length === 0) return ''
  // ⚠️ **`stopped` and not `state === 'running'`** (118). A killed run's frozen agent used to be
  // counted here too, so the head read `1 running` directly beside its own word for the run —
  // *did not finish*. One predicate answers for the plate, the row's word and this count.
  const stopped = agents.filter((agent) => workflowAgentStopped(agent, props.run)).length
  const running = agents.filter((agent) => agent.state === 'running').length - stopped
  const queued = agents.filter((agent) => agent.state === 'queued').length
  const done = agents.filter((agent) => agent.state === 'done').length
  const failed = agents.filter((agent) => agent.state === 'failed').length
  return [
    running > 0 ? `${running} running` : '',
    // 039's vocabulary, and the same words the row underneath uses: the provider stopped saying.
    stopped > 0 ? `${stopped} not reported` : '',
    queued > 0 ? `${queued} queued` : '',
    done > 0 ? `${done} done` : '',
    failed > 0 ? `${failed} failed` : '',
  ]
    .filter(Boolean)
    .join(' · ')
})

/**
 * The provider's own numbers, labelled, and nothing derived (086 / 107 §5).
 *
 * ⚠️ **`—` for absent, never `0`.** A run that reported no tool calls and a run that made none are
 * different facts, and `0 tools` claims the second about the first. Zero IS shown where zero is what
 * was measured: `toolCalls: 0` appears on real agents, and printing `—` there would be the same lie
 * in the other direction.
 */
function usageLine(u: { tokens?: number; toolCalls?: number; ms?: number } | undefined): string {
  if (!u) return ''
  const parts = [
    u.tokens !== undefined ? `${Math.round(u.tokens / 100) / 10}k tokens` : '',
    u.toolCalls !== undefined ? `${u.toolCalls} tool${u.toolCalls === 1 ? '' : 's'}` : '',
    u.ms !== undefined
      ? u.ms < 1000
        ? `${Math.round(u.ms)} ms`
        : `${(u.ms / 1000).toFixed(1)} s`
      : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

const runUsage = computed(() => usageLine(props.run.usage))

/** An agent's own numbers, in the same units and by the same rule. */
function agentUsage(agent: { tokens?: number; toolCalls?: number; durationMs?: number }): string {
  return usageLine({
    ...(agent.tokens !== undefined ? { tokens: agent.tokens } : {}),
    ...(agent.toolCalls !== undefined ? { toolCalls: agent.toolCalls } : {}),
    ...(agent.durationMs !== undefined ? { ms: agent.durationMs } : {}),
  })
}

const AGENT_WORD: Record<string, string> = {
  queued: 'queued',
  running: 'running',
  done: 'completed',
  failed: 'failed',
  unknown: 'state not reported',
}

/**
 * What a failure has to say for itself, docked under its row (107 §3, from 101).
 *
 * ⚠️ **The wire carries no failure reason, and this says so rather than inventing one.** In 75 agent
 * entries across 4 real runs no agent ever failed, so there is no observed `error`/`reason` field to
 * read — the states that exist are `start`, `progress` and `done`. What we would genuinely have is
 * the last tool it was on, so that is what docks; with nothing at all, the dock states the absence.
 * A blank dock would read as "failed, and that is all there is to know", which is a claim.
 */
function failureNote(agent: { lastTool?: string; lastToolSummary?: string }): string {
  if (agent.lastToolSummary) return `last: ${agent.lastTool ?? 'a tool'} — ${agent.lastToolSummary}`
  if (agent.lastTool) return `last: ${agent.lastTool}`
  return 'no reason was reported'
}

/**
 * Whether this run has anything for the journal and the script buttons to find (112).
 *
 * ⚠️ **The run directory on disk is named by a `runId` the wire does not carry**, so the main
 * process finds it through whichever of the run's agents has a file. A run that has announced no
 * agents at all gives it nothing to look with — and gets no buttons, rather than two that refuse.
 */
const hasAgents = computed(() => props.run.agents.length > 0)

/** The file name alone — the whole path is a temp directory nobody wants to read on a footer. */
const outputName = computed(() => {
  const path = props.run.outputFile
  if (path === undefined) return ''
  return pathTail(path) || path
})
</script>

<template>
  <div class="workflow" data-cy="workflow-entry" :data-status="status" :data-task-id="run.taskId">
    <button
      class="wf-head"
      type="button"
      :aria-expanded="open"
      :aria-controls="open ? bodyId : undefined"
      data-cy="workflow-head"
      @click="open = !open"
    >
      <!-- ⚠️ The dot is `running | completed | failed | unknown | unfinished` and NEVER amber — see
           the component comment. Colour is not alone: the status word is written beside it. -->
      <span class="wf-dot" :class="status"></span>
      <span class="wf-who">
        <strong data-cy="workflow-name">{{ run.name || 'workflow' }}</strong>
        <span v-if="run.description" class="wf-desc" data-cy="workflow-description">
          {{ run.description }}
        </span>
      </span>
      <span class="wf-meta">
        <span v-if="phaseOf" class="wf-phase-of" data-cy="workflow-phase-of">{{ phaseOf }}</span>
        <span v-if="tally" class="wf-tally" data-cy="workflow-tally">{{ tally }}</span>
        <span class="wf-status" data-cy="workflow-status">{{ statusWord }}</span>
        <span v-if="runUsage" class="wf-usage" data-cy="workflow-usage">{{ runUsage }}</span>
        <svg class="icon chevron" :class="{ open }"><use href="#i-chevron" /></svg>
      </span>
    </button>

    <!-- ⚠️ **The tree owns a BOUNDED scroll** (107 §3). 22 agents must not become 22 rows of
         transcript height; past `--wf-tree-max` the tree scrolls inside itself and the conversation
         below stays where the reader left it. -->
    <div v-if="open" :id="bodyId" class="wf-tree" data-cy="workflow-tree">
      <section
        v-for="phase in phases"
        :key="phase.index"
        class="wf-phase"
        :data-state="phase.state"
        :data-cy="`workflow-phase-${phase.index}`"
      >
        <!-- ⚠️ **A finished phase still collapses to its tally** (107 §3) — the restraint on a long
             run is paid out here. What 112 changed is that the tally is a BUTTON when there is
             anything behind it: applied to a run that has ENDED, "only the running phase lists
             rows" left the whole record unreachable, which was the ticket. -->
        <component
          :is="phaseControl(phase) ? 'button' : 'div'"
          class="wf-phase-head"
          :class="{ control: phaseControl(phase) }"
          :type="phaseControl(phase) ? 'button' : undefined"
          :aria-expanded="phaseControl(phase) ? String(listsRows(phase)) : undefined"
          :aria-controls="listsRows(phase) ? `${bodyId}-p${phase.index}` : undefined"
          :data-cy="`workflow-phase-head-${phase.index}`"
          @click="phaseControl(phase) && togglePhase(phase)"
        >
          <span class="wf-chip" :class="phase.state" data-cy="workflow-phase-chip">
            <template v-if="phase.state === 'done'">✓</template>
            <template v-else-if="phase.state === 'failed'">!</template>
            <template v-else>{{ phase.index }}</template>
          </span>
          <strong class="wf-phase-title">{{ phase.title }}</strong>
          <span class="wf-phase-tally" data-cy="workflow-phase-tally">
            {{ phase.agents.length }}
            {{ phase.agents.length === 1 ? 'agent' : 'agents' }}
            <template v-if="phase.state === 'done'"> · done</template>
            <template v-else-if="phase.state === 'failed'"> · {{ phase.failed }} failed</template>
            <template v-else-if="phase.state === 'empty'"> · not started</template>
            <template v-else> · {{ phase.done }} of {{ phase.agents.length }} done</template>
          </span>
          <svg
            v-if="phaseControl(phase)"
            class="icon chevron"
            :class="{ open: listsRows(phase) }"
            data-cy="workflow-phase-chevron"
          >
            <use href="#i-chevron" />
          </svg>
        </component>

        <ol
          v-if="listsRows(phase)"
          :id="`${bodyId}-p${phase.index}`"
          class="wf-agents"
          :data-cy="`workflow-agents-${phase.index}`"
        >
          <li
            v-for="agent in phase.agents"
            :key="agent.agentId"
            class="wf-agent"
            :data-state="workflowAgentStopped(agent, props.run) ? 'unknown' : agent.state"
            data-cy="workflow-agent"
          >
            <div class="wf-agent-row">
              <!-- ⚠️ **The RUN goes in beside the agent** (118, from 117 §2). A row whose `state`
                   is still `running` inside a run that is over says "working · live" about agents
                   that stopped when the run was killed — inside this very tree, under a head that
                   already says it is over. `props.run` is where the terminal status lives, and it
                   is right here. See `frozenInsideAnEndedRun`. -->
              <AgentState
                size="compact"
                v-bind="workflowAgentFacets(agent, props.run)"
                :label="agent.label"
              />
              <span class="wf-agent-who">
                <!-- ⚠️ **The label is the door to the child's own transcript** (112). It is a
                     button rather than a whole-row click target so the row's meta stays selectable
                     — an id you cannot copy is an id you cannot use (111's ruling, same place). -->
                <button
                  v-if="agent.state !== 'queued' && props.canOpenChild"
                  class="wf-agent-open"
                  type="button"
                  data-cy="workflow-agent-label"
                  :title="`Open what ${agent.label} did`"
                  @click="
                    emit('openChild', { part: 'transcript', agentId: agent.agentId }, agent.label)
                  "
                >
                  {{ agent.label }}
                </button>
                <!-- ⛔ **A QUEUED agent is not a control** (review). It is waiting for a slot and has
                     written no file at all, so the button could only ever refuse — 106's dead
                     control, with a sentence instead of a shrug. It still reads as itself, and
                     `awaiting a slot` beside it already says why there is nothing to open. Plain
                     too where this surface has nothing that could open it. -->
                <strong v-else data-cy="workflow-agent-label-plain">{{ agent.label }}</strong>
                <!-- Surface the provider's `lastToolSummary` where it arrives, including any person-requested prefix. Identity still comes from `agentId` and `label`, not a naming convention in the text. Omit the summary for failed agents whose failure dock already shows it. -->
                <span
                  v-if="agent.lastToolSummary && agent.state !== 'failed'"
                  class="wf-summary"
                  data-cy="workflow-agent-summary"
                >
                  {{ agent.lastToolSummary }}
                </span>
                <!-- ⚠️ **`attempt` rides alongside and is NOT flattened into the state** (107 §3).
                     A retry is a second try at the same work, which is a different fact from a
                     second agent — and `subAgentFacets` has nowhere to put it, which is half the
                     reason workflow agents do not go through it. -->
                <span v-if="(agent.attempt ?? 1) > 1" class="wf-attempt" data-cy="workflow-attempt">
                  attempt {{ agent.attempt }}
                </span>
                <span v-if="agent.state === 'queued'" class="wf-queued" data-cy="workflow-queued">
                  awaiting a slot
                </span>
              </span>
              <span class="wf-agent-meta">
                <!-- ⚠️ **The last tool goes with the last state** (118). It is no more current
                     than the `running` beside it was, and a killed run showing `StructuredOutput`
                     reads as a tool call in flight. -->
                <span
                  v-if="agent.lastTool && !workflowAgentStopped(agent, props.run)"
                  class="wf-tool"
                  data-cy="workflow-agent-tool"
                >
                  {{ agent.lastTool }}
                </span>
                <span class="wf-agent-status" data-cy="workflow-agent-status">
                  {{
                    workflowAgentStopped(agent, props.run)
                      ? AGENT_WORD.unknown
                      : (AGENT_WORD[agent.state] ?? agent.state)
                  }}
                </span>
                <span
                  v-if="agentUsage(agent)"
                  class="wf-agent-usage"
                  data-cy="workflow-agent-usage"
                >
                  {{ agentUsage(agent) }}
                </span>
              </span>
            </div>
            <!-- The reason, docked BELOW the row rather than squeezed into it (101). -->
            <p v-if="agent.state === 'failed'" class="wf-reason" data-cy="workflow-agent-reason">
              {{ failureNote(agent) }}
            </p>
          </li>
        </ol>
      </section>

      <!-- A cap can never be silent (092's rule, 096's precedent). -->
      <p v-if="run.droppedAgents" class="wf-dropped" data-cy="workflow-dropped">
        {{ run.droppedAgents }} more agents were reported than this view holds.
      </p>

      <!-- ⚠️ **The output is an affordance, never auto-inlined** (078 / 107 §4). It opens in the one
           document viewer — paper plus the Markdown/Raw toggle — because a workflow returns prose to
           be read. A `.jsonl` journal opens on Raw, same standard, no special case. -->
      <footer v-if="!run.running" class="wf-foot" data-cy="workflow-foot">
        <span class="wf-foot-status" :class="status">{{ statusWord }}</span>
        <span v-if="runUsage" class="wf-foot-usage">{{ runUsage }}</span>
        <!-- ⚠️ **Both of these are addressed by an AGENT, not by the run** (112), and that is not a
             convenience: the run id these two files are filed under is the one thing the provider
             does not put on the wire, so the run directory is found BY the agent's own file. No
             agents, no id to find, and no button — never a dead one. -->
        <button
          v-if="hasAgents && props.canOpenChild"
          class="wf-open"
          type="button"
          data-cy="workflow-open-journal"
          title="Each agent's actual return value"
          @click="
            emit('openChild', { part: 'journal', taskId: run.taskId }, run.name || 'workflow')
          "
        >
          Journal →
        </button>
        <button
          v-if="hasAgents && props.canOpenChild"
          class="wf-open"
          type="button"
          data-cy="workflow-open-script"
          title="The script that fanned these agents out"
          @click="emit('openChild', { part: 'script', taskId: run.taskId }, run.name || 'workflow')"
        >
          Script →
        </button>
        <button
          v-if="run.outputFile && props.canOpenOutput"
          class="wf-open"
          type="button"
          data-cy="workflow-open-output"
          @click="emit('openOutput', run.taskId, run.name || 'workflow')"
        >
          Open output →
          <span class="wf-file">{{ outputName }}</span>
        </button>
        <span v-else-if="run.outputFile" class="wf-output-name" data-cy="workflow-output-name">
          output <span class="wf-file">{{ outputName }}</span>
        </span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* How tall the expanded tree may get before it scrolls inside itself. Chosen so a five-phase run
   shows its running phase and the tallies around it without the conversation below leaving the
   viewport. */
.workflow {
  --wf-tree-max: 340px;

  margin: var(--space-3) 0 0;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
}

.wf-head {
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
  grid-template-columns: auto minmax(0, 1fr) auto;
  text-align: left;
}

.wf-head:hover {
  background: var(--wash-3);
}

.wf-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--faint);
}

.wf-dot.running {
  background: var(--accent);
  box-shadow: var(--accent-glow-weak);
}

.wf-dot.completed {
  background: var(--success);
}

.wf-dot.failed {
  background: var(--danger);
}

/* ⚠️ There is deliberately NO rule for `.wf-dot.unfinished` or `.wf-dot.unknown` — the base
   `--faint` with no glow is exactly what "we were not told" should look like, and it is 074's
   ruling on the tool row's own dot restated one level down. Named so the absence reads as a
   decision rather than an oversight. */

.wf-who {
  overflow: hidden;
  min-width: 0;
}

.wf-who strong {
  color: var(--text-soft);
  font-weight: var(--fw-bold);
}

.wf-desc {
  display: block;
  overflow: hidden;
  color: var(--faint);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-meta {
  display: inline-flex;
  align-items: center;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.wf-phase-of {
  color: var(--accent-2-text);
}

.wf-usage,
.wf-agent-usage,
.wf-foot-usage {
  font-family: var(--font-mono);
}

.chevron {
  width: 12px;
  height: 12px;
  transform: rotate(90deg);
  transition: transform var(--dur-fast) ease;
}

.chevron.open {
  transform: none;
}

.wf-tree {
  max-height: var(--wf-tree-max);
  padding: 0 var(--space-6) var(--space-4);
  border-top: var(--border-width) solid var(--line);
  overflow-y: auto;
}

.wf-phase {
  padding: var(--space-4) 0 0;
}

.wf-phase-head {
  display: flex;
  width: 100%;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  text-align: left;
}

.wf-phase-head.control:hover .wf-phase-tally {
  color: var(--muted);
}

.wf-phase-head .chevron {
  width: 10px;
  height: 10px;
  margin-left: auto;
  color: var(--faint);
}

.wf-chip {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border: var(--border-width) dashed var(--faint);
  border-radius: var(--radius-pill);
  color: var(--faint);
  font-size: var(--type-caption);
}

/* ⛔ **This said `var(--badge-ink)` — `#ffffff` in both themes — on `--accent`, which in dark is
   the pale `#7dbbff`: white on pale blue, 2.01:1** (measured by 126, fixed here by 129). It is the
   identical defect 126 found at `ChildWorkViewer`'s `.seg.on`, one surface over: the running phase
   chip on the workflow tree rather than a toggle on paper. `--accent-ink` is the token that MEANS
   "ink on a solid accent fill" and it is what `DocumentBody`'s own chip already uses.

   ⚠️ **`--badge-ink` belongs to `AgentState`** — 126's words, and this was the last consumer of it
   outside that component. It is the plate's own white disc, white in both themes on purpose, and
   `agent-state.test.ts` pins it there. Grepped: three uses remain, all three in `AgentState.vue`,
   all three the plate itself. There is no third wrong consumer. */
.wf-chip.running {
  border-style: solid;
  border-color: var(--accent);
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

.wf-chip.done {
  border-style: solid;
  border-color: var(--success);
  color: var(--success);
}

.wf-chip.failed {
  border-style: solid;
  border-color: var(--danger);
  color: var(--danger);
}

.wf-phase-title {
  color: var(--text-soft);
}

.wf-phase-tally {
  color: var(--faint);
  font-size: var(--type-caption);
}

.wf-agents {
  margin: var(--space-3) 0 0;
  padding: 0 0 0 var(--space-6);
  list-style: none;
}

.wf-agent {
  padding: var(--space-2) 0;
}

.wf-agent-row {
  display: grid;
  align-items: center;
  gap: var(--space-4);
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.wf-agent-who {
  overflow: hidden;
  min-width: 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The label, which is now the door to the child's transcript. It keeps the weight the `strong` had
   so the row does not read as having changed shape; only the pointer and the underline on hover say
   it is a control. */
.wf-agent-open {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font-size: inherit;
  font-weight: var(--fw-bold);
  text-align: left;
}

.wf-agent-open:hover {
  color: var(--accent-text);
  text-decoration: underline;
}

/*
 * Style the provider-reported summary as a fact rather than a control.
 */
.wf-summary {
  margin-left: var(--space-3);
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

/* Violet is the queued register (107 §7) — it is the one hue that is neither "running" nor
   "finished" and is emphatically not the amber that means someone is waiting on YOU. */
.wf-attempt,
.wf-queued {
  margin-left: var(--space-3);
  color: var(--accent-2-text);
  font-size: var(--type-caption);
}

.wf-agent-meta {
  display: inline-flex;
  align-items: center;
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.wf-agent[data-state='failed'] .wf-agent-status {
  color: var(--danger);
}

.wf-agent[data-state='done'] .wf-agent-status {
  color: var(--success);
}

.wf-reason {
  margin: var(--space-2) 0 0 var(--space-7);
  color: var(--danger);
  font-size: var(--type-caption);
}

.wf-dropped {
  margin: var(--space-4) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

.wf-foot {
  display: flex;
  align-items: center;
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: var(--border-width) solid var(--line);
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.wf-foot-status.completed {
  color: var(--success);
}

.wf-foot-status.failed {
  color: var(--danger);
}

.wf-open {
  margin-left: auto;
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent-text);
  font-size: var(--type-caption);
}

.wf-open:hover {
  background: var(--wash-3);
}

.wf-output-name {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--type-caption);
  user-select: text;
}

.wf-file {
  margin-left: var(--space-3);
  color: var(--faint);
  font-family: var(--font-mono);
}
</style>
