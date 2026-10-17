/**
 * 108 · **The dynamic workflow that ran, lifted out of `unknown{raw}` into a vocabulary** (designed
 * in 107).
 *
 * Classify workflow frames as workflow state rather than chatter so a multi-agent run remains visible in normal mode.
 *
 * ## Everything here is measured, and the measurement changed the design twice
 *
 * Read from this machine's own database (2.5 GB, 19 sessions carrying `task_*` traffic, **4 real
 * workflow runs**: `haiku-panel-demo`, `demo-name-panel`, `simple-demo-workflow`, `ui-smoke-test`).
 *
 * **1 · Fewer than half the progress frames carry a roster.** 41 `local_workflow` `task_progress`
 * events; **22 carry `workflow_progress`, 19 do not.** The 19 carry `usage` and `last_tool_name` and
 * nothing else. So a fold that treated each frame as the current picture would blank the tree on
 * 46% of ticks — the agents would strobe in and out for the length of the run. {@link WorkflowRun}
 * therefore makes `agents` **absent** on those frames rather than empty, and the two are different
 * sentences: absent is "this tick said nothing about the roster", empty is "there are none".
 *
 * **2 · The roster is cumulative and never shrinks.** Across all four runs the agent count only ever
 * rose (3 → 4 as the second phase opened), and an entry once present was present in every later
 * frame with the same `agentId`. So a frame that carries a roster carries *what is known so far*,
 * which is why the merge is by `agentId` and why a later frame's silence about an agent is not its
 * removal.
 *
 * ## What is deliberately NOT carried, and it is the 052 line
 *
 * The wire's `workflow_agent` is **~1,114 bytes** (measured mean over 75 entries), and roughly 800 of
 * those are two fields: `promptPreview` (210–401 bytes, byte-identical on every frame for the life of
 * an agent) and `resultPreview` (up to ~370). A 22-agent run at the observed cadence would persist
 * close to a megabyte of the same preview strings — 052 exists because an unbounded verbatim copy of
 * provider output reached 26 GB, and this is that hazard with a smaller constant.
 *
 * ⚠️ **The dispatch named a different field.** It warned that `task_started.prompt` — the entire
 * workflow script — must not be persisted per event. Measured: `prompt` appears on `task_started`
 * **only**, once per run (4 of 4), never on a progress frame. The script is a real ~2.4 KB blob and
 * it is not carried here, but it was never the repeating one. The repeating one is `promptPreview`,
 * and the reason to drop it is the same reason stated about the wrong field.
 *
 * Neither preview is drawn by 107's surface — a running agent's line shows its **last tool**, and the
 * prose a run produces is the `outputFile`, opened on demand and never inlined (078). So this is not
 * a bound on something we need; it is the omission of something nothing reads.
 */

/**
 * One phase of a run — a heading with an index, and nothing else on the wire.
 *
 * `{type, index, title}` in 44 of 44 observed entries, no other key ever. Its **state is derived**
 * from the agents that name it (107 §3), never sent: there is no `workflow_phase.state` field to
 * read, and inventing one would be a claim the provider never made.
 */
export interface WorkflowPhase {
  /** The provider's own 1-based index. The chip's number, and the agents' `phaseIndex` join key. */
  readonly index: number
  readonly title: string
}

/**
 * What an agent is doing, in the provider's own words.
 *
 * ⚠️ **Three of these five were never observed, and that is recorded rather than resolved.** In 75
 * agent entries across 4 runs the wire said only `start`, `progress` and `done`; `attempt` was `1`
 * every time, and **no agent ever carried a `queuedAt` without a `startedAt`** (they arrive ~10 ms
 * apart). So `queued` and `failed` are here because 107 designed states for them and because the
 * alternative — mapping an unrecognised state onto a state we have seen — is the fabrication this
 * project keeps finding. They are reachable, they are rendered, and no test claims the provider
 * emits them.
 *
 * An unrecognised value becomes {@link WorkflowAgent.state} `'unknown'`, which draws a faceless ring:
 * the honest picture of an agent whose state we were told and did not understand.
 */
export type WorkflowAgentState = 'queued' | 'running' | 'done' | 'failed' | 'unknown'

/**
 * One agent inside a run.
 *
 * ⚠️ **`queuedAt` and `startedAt` are separate and both optional, and flattening them is exactly what
 * 107 refused.** "Queued but not yet started" is a real state of a fan-out that is wider than the
 * concurrency cap, and `subAgentFacets` has no value for it — which is the whole reason workflow
 * agents do not go through it.
 */
export interface WorkflowAgent {
  /** The provider's `agentId` — the merge key across frames, and the only stable handle. */
  readonly agentId: string
  /** The run's own name for this agent (`poet:fan-out`, `judge`). The row's label. */
  readonly label: string
  /** Which {@link WorkflowPhase.index} it belongs to. */
  readonly phaseIndex: number
  readonly state: WorkflowAgentState
  /** Which model ran it, when the provider said. Shown verbatim, never normalised. */
  readonly model?: string
  /** When it was put in the queue. Present without {@link startedAt} means it is still waiting. */
  readonly queuedAt?: number
  /** When it actually began. */
  readonly startedAt?: number
  /**
   * Which try this is. **1 is not the same as absent** — 1 says the provider counted and it is the
   * first, absent says it did not count. The retry tag is drawn only above 1.
   */
  readonly attempt?: number
  /** The tool it most recently ran — the running row's one line of detail. */
  readonly lastTool?: string
  /** The provider's own short gloss on that tool call (`fan-out`). Small; kept. */
  readonly lastToolSummary?: string
  /** Verbatim per-agent numbers (086): shown labelled, never combined into a rate or a percentage. */
  readonly tokens?: number
  readonly toolCalls?: number
  readonly durationMs?: number
}

/**
 * A run, as one frame described it — the unit the fold merges.
 *
 * `agents` and `phases` are **absent** rather than empty when a frame said nothing about them; see
 * this module's header for the 22-vs-19 measurement that makes the distinction load-bearing.
 */
export interface WorkflowRun {
  /** `task_id` — stable for the run's whole life, and the only key `task_updated` carries. */
  readonly taskId: string
  /** The anchoring `tool_use_id`; the `Workflow` tool call's own id. Absent on `task_updated`. */
  readonly toolUseId?: string
  /** `workflow_name`, from `task_started`. */
  readonly name?: string
  /** The run's `description` / `summary` — what it was asked to do. */
  readonly description?: string
  readonly phases?: readonly WorkflowPhase[]
  readonly agents?: readonly WorkflowAgent[]
  /** The run-level totals the provider reports on every frame. */
  readonly usage?: { readonly tokens?: number; readonly toolCalls?: number; readonly ms?: number }
  /** Set only on an ending. `unknown` is a real answer: an ending we saw and could not read. */
  readonly outcome?: 'completed' | 'failed' | 'unknown'
  /** Where the run wrote its answer. Opened as a document on request, never inlined (107 §4). */
  readonly outputFile?: string
  /**
   * Agents past {@link MAX_WORKFLOW_AGENTS}, so a cap can never be silent (092's rule, 096's
   * precedent). Absent or 0 normally.
   */
  readonly droppedAgents?: number
}

/**
 * The most agents one frame will carry rows for.
 *
 * At the measured ~300 bytes per retained agent (the wire's ~1,114 less the two previews this module
 * does not carry — see the header), 200 agents is a ~60 KB frame, well under 052's 64 KiB
 * `unknown{raw}` ceiling that the untyped path would otherwise have applied to a payload three times
 * the size. The surplus is COUNTED into {@link WorkflowRun.droppedAgents} rather than dropped
 * quietly, because a roster that looks complete and is not is the failure this project keeps finding.
 */
export const MAX_WORKFLOW_AGENTS = 200

/**
 * The ceiling on a provider STRING carried on this event, in characters (299 §2, from 297 finding 2).
 *
 * ⛔ **`workflow_run` was the fifth family in a set of five and the only one with no bound at all.**
 * `background-work.test.ts`'s docblock is the rule, and it is this file's rule too:
 * ⚑ *"a bound the PRODUCER can exceed is not a bound, it is a delete."* The schema said `.max(200)`
 * and the normalizer truncated nothing, so a run whose author wrote a long `label` failed
 * `runtimeEventSchema` at `toWireEvent` and {@link degradeEvent} replaced the WHOLE event with
 * `unknown{degradedFrom:'workflow_run'}` — the card drawn with its name, its description and its
 * running totals, and **no phases and no agents**, for the life of the run and permanently in the
 * stored ledger and every resume, then reported `completed` under an empty tree.
 *
 * ⚠️ **The asymmetry that makes it reachable was read out of the pinned SDK**, not assumed: the
 * *default* agent label is `.slice(0, 60)` and an EXPLICIT `opts.label` is not sliced at all. The
 * shape that reaches it is the ordinary one — a dynamic workflow fanning out over a list and passing
 * each item as its agent's label. Same for `meta.phases[].title` and `meta.name`, which an author
 * writes by hand with nothing between them and the wire.
 *
 * ⛔ **201, not 200, and the odd number is the same one {@link MAX_BACKGROUND_TEXT} explains.**
 * `truncate` keeps `TOOL_SUMMARY_MAX` (200) characters **and then appends an ellipsis**, so every
 * string it actually shortens is 201 long — and a `.max(200)` schema would reject precisely the
 * strings that had just been bounded, degrading the event the bound exists to save.
 */
export const MAX_WORKFLOW_TEXT = 201

/**
 * The ceiling on the run's `description` — its own brief, and the one field that is a sentence
 * rather than a name.
 *
 * 2 001 for the reason {@link MAX_WORKFLOW_TEXT} is 201: the schema has always allowed 2 000 here,
 * and a truncation to 2 000 plus an ellipsis is 2 001 characters long.
 */
export const MAX_WORKFLOW_DESCRIPTION = 2_001

/** The provider's state word → {@link WorkflowAgentState}. Anything else is honestly `unknown`. */
export function workflowAgentState(wire: string): WorkflowAgentState {
  switch (wire) {
    // Observed: 26 `start`, 6 `progress`, 43 `done`. Both live words mean the same thing to a
    // reader — it is running — and 107 gives them one row shape.
    case 'start':
    case 'progress':
    case 'running':
      return 'running'
    case 'done':
    case 'completed':
      return 'done'
    // ⚠️ Never observed. Kept because a run CAN fail and a state we cannot read must not be rounded
    // to `done`, which is the one reading that would put a green tick under a failure.
    case 'failed':
    case 'error':
      return 'failed'
    case 'queued':
    case 'pending':
      return 'queued'
    default:
      return 'unknown'
  }
}
