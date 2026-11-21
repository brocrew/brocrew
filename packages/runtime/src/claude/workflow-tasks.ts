/**
 * Which of Claude's tracked tasks are dynamic workflows, and the `Workflow` tool call that launched
 * each. Like {@link SubAgentTasks} for a different `task_type`, and a separate registry because the
 * admissions are mutually exclusive: a `local_workflow` is deliberately not admitted as a sub-agent
 * (`AGENT_TASK_TYPE = 'local_agent'`).
 *
 * It must remember two things. Only `task_started` carries `task_type`, and `task_updated` (one of
 * the two endings) carries neither `task_type` nor `tool_use_id`, so an ending arriving there would
 * otherwise have no tree to land on and the tree would stay "running" forever.
 *
 * It fails toward silence: a task whose start was never seen is admitted only if it names itself, and
 * the only self-naming a workflow does is carrying a `workflow_progress` roster. That cannot strand a
 * tree, because a tree that was never opened has nothing to leave running.
 */

/** The `task_type` that means "a dynamic workflow ran here". */
const WORKFLOW_TASK_TYPE = 'local_workflow'

export class WorkflowTasks {
  /** task_id → the `Workflow` tool call's id, or `''` when we were admitted without ever seeing one. */
  private readonly runs = new Map<string, string>()
  /**
   * Tasks we saw start and deliberately did not open. Declining a `skip_transcript` task must leave a
   * trace, or the next `task_progress` (which carries a roster and so names itself) would walk in
   * through {@link join} and un-hide a task the SDK asked us to hide.
   */
  private readonly hidden = new Set<string>()

  /**
   * Decide, at `task_started`, whether this task is a workflow, and remember its anchor.
   *
   * `subagentType` refuses admission: `sub-agent-tasks.ts` admits a `local_workflow` that declares
   * `subagent_type` as a sub-agent, and claiming it here too would render one task as both a sub-agent
   * card and a workflow tree. `skipTranscript` suppresses the opening: the SDK marks it as an ambient
   * task to hide, and a task hidden at birth has no ending to show.
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
    // Hidden at birth, hidden for good: a roster does not overrule the SDK asking us not to show it.
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
   * Remember the anchoring tool-use id the first time a message carries one. First wins: every
   * message carrying it carries the same one, so a later value could only be another run's id under a
   * task id we already know, which would move a live tree onto someone else's tool call.
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
