/**
 * Which of Claude's tracked tasks are **dynamic workflows** (108) — and what the `Workflow` tool call
 * that launched each one was called.
 *
 * This is {@link SubAgentTasks} solving the same problem for a different `task_type`, and it is a
 * separate registry rather than a flag on that one because the two admissions are mutually exclusive
 * by design: a `local_workflow` is deliberately **not** admitted as a sub-agent
 * (`AGENT_TASK_TYPE = 'local_agent'`), which is exactly why a 22-agent run had nothing on screen.
 *
 * ## Why it has to remember two things
 *
 * Measured across every `task_*` message in this machine's database (4 real workflow runs, 8
 * `local_bash` tasks, 95 messages):
 *
 * ```
 * task_started       task_type ✓   tool_use_id ✓   workflow_name ✓   prompt ✓ (the whole script)
 * task_progress      task_type ✗   tool_use_id ✓   workflow_progress ✓ on 22 of 41
 * task_updated       task_type ✗   tool_use_id ✗   ← carries a bare task_id and a patch
 * task_notification  task_type ✗   tool_use_id ✓   status ✓  output_file ✓
 * ```
 *
 * So **admission** is place-once (only `task_started` says `task_type`) and **the anchor** is nearly
 * place-once too: `task_updated` sends no `tool_use_id` at all, and it is one of the two endings. A
 * run whose ending arrived on `task_updated` would otherwise have nowhere to land, and the tree it
 * belongs to would sit "running" forever.
 *
 * ## Which way it fails
 *
 * Toward silence, exactly as 035 chose. A task we never saw start is admitted only if it names itself
 * — and the only self-naming a workflow does is carrying a `workflow_progress` roster. That cannot
 * strand a tree, because a tree that was never opened has nothing to leave running.
 */

/** The `task_type` that means "a dynamic workflow ran here". Observed on 4 of 4 real runs. */
const WORKFLOW_TASK_TYPE = 'local_workflow'

export class WorkflowTasks {
  /** task_id → the `Workflow` tool call's id, or `''` when we were admitted without ever seeing one. */
  private readonly runs = new Map<string, string>()
  /**
   * Tasks we saw start and deliberately did NOT open (108 review).
   *
   * ⚠️ **A refusal has to leave a trace, or it is not a refusal.** {@link start} declining a
   * `skip_transcript` task used to record nothing, so the very next `task_progress` — which carries a
   * roster and therefore names itself — walked in through {@link join} and un-hid the exact task the
   * SDK asked us to hide. 035's rule is that a task hidden at birth has no ending to report; this is
   * what makes it true for more than one message.
   */
  private readonly hidden = new Set<string>()

  /**
   * Decide, at `task_started`, whether this task is a workflow — and remember its anchor.
   *
   * ⚠️ **`subagentType` REFUSES admission here, and that is deference rather than caution.**
   * `sub-agent-tasks.ts` documents that a `local_workflow` which also declares `subagent_type` is
   * correctly admitted as a sub-agent — *"at that point the provider has told us it is one"*. If this
   * registry also claimed it, one task would render as a sub-agent card **and** a workflow tree: the
   * same fact twice, which is the defect class 028 and 037 exist to prevent. Never observed on the
   * wire (0 of 12 `task_started` messages carry both), and settled here so it cannot become a race
   * between two registries later.
   *
   * `skipTranscript` suppresses the OPENING, on 035's reasoning verbatim: the SDK documents it as an
   * ambient task the consumer should hide, and a task hidden at birth has no ending to show.
   */
  start(taskId: string, taskType: string, subagentType: string, skipTranscript: boolean): boolean {
    if (this.runs.has(taskId)) return true
    if (skipTranscript) {
      this.hidden.add(taskId)
      return false
    }
    if (subagentType) return false
    if (taskType !== WORKFLOW_TASK_TYPE) return false
    this.runs.set(taskId, '')
    return true
  }

  /**
   * A `task_progress` carrying a roster names itself, so a session joined mid-flight still draws its
   * tree. Nothing else can: `usage` and `last_tool_name` are what a `local_bash` task sends too.
   */
  join(taskId: string, carriesRoster: boolean): boolean {
    if (this.runs.has(taskId)) return true
    // Hidden at birth, hidden for good — a roster does not overrule the SDK asking us not to show it.
    if (this.hidden.has(taskId)) return false
    if (!carriesRoster) return false
    this.runs.set(taskId, '')
    return true
  }

  /** Is this task one we opened a tree for? The only question the two endings can be asked. */
  knows(taskId: string): boolean {
    return this.runs.has(taskId)
  }

  /**
   * Remember the anchoring tool-use id the first time a message carries one.
   *
   * **First wins, and it is not arbitrary.** Every message that carries the id carries the same one
   * (measured: 34 of 34 agree within a run), so a later value can only ever be a different run's id
   * arriving under a task id we already know — which would move a live tree onto someone else's tool
   * call. Keeping the first makes that impossible without needing to detect it.
   */
  anchor(taskId: string, toolUseId: string): void {
    if (!toolUseId) return
    if (this.runs.get(taskId)) return
    if (!this.runs.has(taskId)) return
    this.runs.set(taskId, toolUseId)
  }

  /** The `Workflow` tool call this run hangs off, or `''` if no message has ever named one. */
  anchorOf(taskId: string): string {
    return this.runs.get(taskId) ?? ''
  }
}
