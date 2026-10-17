/**
 * Which of Claude's tracked tasks are actually SUB-AGENTS (035).
 *
 * Claude uses `task_*` for all tracked tasks, including ordinary Bash work. A `task_id` alone does not establish a sub-agent; classify the task type so command tracking does not create a false agent card.
 *
 * ## Why this needs to remember anything
 *
 * The discriminator is PLACE-ONCE information, exactly as parentage turned out to be in 029. From
 * the pinned SDK (`sdk.d.ts` 4424-4505):
 *
 * ```
 * task_started       subagent_type?  task_type?  skip_transcript?   ← the only one with all three
 * task_progress      subagent_type?  —           —
 * task_updated       —               —           —                  ← carries NEITHER
 * task_notification  —               —           skip_transcript?
 * ```
 *
 * `task_updated` has no discriminator at all, and it is one of the two ENDINGS. So a gate that asked
 * each message to prove itself would drop every real sub-agent's ending and leave its card spinning
 * forever — trading an honesty bug for a worse one. The decision has to be made once, where the
 * evidence is, and remembered for the task's lifetime.
 *
 * ## Which way it fails
 *
 * Toward silence. A task we never saw START is not admitted on the strength of a later phase, unless
 * that phase carries `subagent_type` itself. This cannot strand a card, because a card that was
 * never opened has nothing to leave running — and it is the direction the dispatch asked for.
 */

/**
 * The `task_type` that means "a sub-agent ran here".
 *
 * Captured live, in this repo's own fixture (`claude-normalize.test.ts:594`). The SDK types it as a
 * bare `string` with no union, and the only other value its comments mention is `'local_workflow'`.
 *
 * This value is the weaker of the two admissions: `subagent_type` alone is enough on its own, and a
 * `task_type` we do not recognise is only rejected when there is no `subagent_type` either. So a
 * `local_workflow` that declared itself a sub-agent WOULD be admitted — correctly, because at that
 * point the provider has told us it is one, and `subagent_type` is the field it says that with. What
 * is refused is inventing a card from an unrecognised `task_type` alone.
 */
const AGENT_TASK_TYPE = 'local_agent'

export class SubAgentTasks {
  private readonly agents = new Set<string>()

  /**
   * Decide, at `task_started`, whether this task is a sub-agent — and remember it, because no later
   * phase can be asked the same question.
   *
   * `skipTranscript` suppresses the OPENING: the SDK documents it as *"Ambient/housekeeping task.
   * Consumers should hide this from the inline transcript"*, and a task hidden at birth is not
   * recorded, so nothing later can show it either.
   *
   * **Admission is never revoked** (035 review). A second `task_started` under an id we already
   * opened a card for is answered from the registry rather than from that message, whatever it
   * carries. The alternative — re-deciding, and evicting on a weaker restart — would leave a card
   * that is ALREADY ON SCREEN with no legible ending, because the endings can only ask
   * {@link knows}. Between "a card that lingers" and "a card that spins forever", 029 chose against
   * the spinner and so does this.
   */
  start(taskId: string, subagentType: string, taskType: string, skipTranscript: boolean): boolean {
    if (skipTranscript) return this.agents.has(taskId)
    if (!subagentType && taskType !== AGENT_TASK_TYPE) return this.agents.has(taskId)
    this.agents.add(taskId)
    return true
  }

  /**
   * A `task_progress` names its own `subagent_type`, so a task whose start we never saw — a session
   * joined mid-flight — can still identify itself. Nothing else can.
   */
  join(taskId: string, subagentType: string): boolean {
    if (!subagentType) return false
    this.agents.add(taskId)
    return true
  }

  /**
   * Is this task one we opened a card for? The only question the two endings can be asked.
   *
   * Nothing is ever forgotten on an ending: BOTH `task_updated` and `task_notification` report one
   * (029's deliberate redundancy), and the second is the one carrying the usage and the summary.
   */
  knows(taskId: string): boolean {
    return this.agents.has(taskId)
  }
}
