/**
 * Usage-only frames omit agents. Merge reported roster entries by agentId so missing data cannot
 * erase rows. Keep scripts and repeated preview text out of events to bound the stored ledger.
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

/** Keep queued and failed distinct. Unrecognized provider states draw with the unknown treatment. */
export type WorkflowAgentState = 'queued' | 'running' | 'done' | 'failed' | 'unknown'

/** Keep queuedAt and startedAt separate so a queued agent need not look like it has started. */
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
 * One frame for the fold to merge. Absent agents or phases mean the frame supplied no update.
 * An empty array is an explicit report of no rows.
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

/** Bound persisted roster size. Report any omitted rows through droppedAgents. */
export const MAX_WORKFLOW_AGENTS = 200

/** Match the normalizer’s 200 characters plus ellipsis so bounded labels pass schema validation. */
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
