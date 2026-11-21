/**
 * Which of Claude's tracked tasks are sub-agents. `task_*` covers all tracked tasks, including
 * ordinary Bash work, so a `task_id` alone does not establish a sub-agent.
 *
 * It must remember: only `task_started` carries `subagent_type`, `task_type` and `skip_transcript`
 * together, `task_progress` carries only `subagent_type`, and `task_updated` (one of the two endings)
 * carries none. A gate asking each message to prove itself would drop every real sub-agent's ending
 * and leave its card spinning, so the decision is made once at start.
 *
 * It fails toward silence: a task whose start was never seen is admitted only if a later phase
 * carries `subagent_type` itself. That cannot strand a card, since an unopened card has nothing to
 * leave running.
 */

/**
 * The `task_type` that means "a sub-agent ran here". The SDK types it as a bare `string`, and the
 * only other value its comments mention is `'local_workflow'`. It is the weaker admission:
 * `subagent_type` alone is enough, so a `local_workflow` that declares a `subagent_type` is admitted
 * as a sub-agent, while an unrecognised `task_type` alone never creates a card.
 */
const AGENT_TASK_TYPE = 'local_agent'

export class SubAgentTasks {
  private readonly agents = new Set<string>()

  /**
   * Decide, at `task_started`, whether this task is a sub-agent, and remember it, since no later
   * phase can be asked. `skipTranscript` suppresses the opening: the SDK marks it as an ambient task
   * to hide, and a hidden task is not recorded.
   *
   * Admission is never revoked: a second `task_started` under an id we opened a card for is answered
   * from the registry. Re-deciding could evict a card already on screen and leave it with no legible
   * ending, because endings can only ask {@link knows}; a lingering card beats a spinning one.
   */
  start(taskId: string, subagentType: string, taskType: string, skipTranscript: boolean): boolean {
    if (skipTranscript) return this.agents.has(taskId)
    if (!subagentType && taskType !== AGENT_TASK_TYPE) return this.agents.has(taskId)
    this.agents.add(taskId)
    return true
  }

  /**
   * A `task_progress` names its own `subagent_type`, so a task whose start we never saw (a session
   * joined mid-flight) can still identify itself.
   */
  join(taskId: string, subagentType: string): boolean {
    if (!subagentType) return false
    this.agents.add(taskId)
    return true
  }

  /**
   * Is this task one we opened a card for? The only question the two endings can be asked. Nothing is
   * forgotten on an ending: both `task_updated` and `task_notification` report one, and the second
   * carries the usage and summary.
   */
  knows(taskId: string): boolean {
    return this.agents.has(taskId)
  }
}
