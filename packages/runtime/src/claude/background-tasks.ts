import { MAX_BACKGROUND_WORK, type BackgroundWork } from '../background-work'

/**
 * Which of Claude's tracked tasks are running in the BACKGROUND right now (247).
 *
 * `SubAgentTasks` is the shape this follows and the reason is the same one: the discriminator is
 * place-once information, and the frames that need it most carry none. It is a different question,
 * though, and deliberately a different object — `SubAgentTasks` asks *"is this task a sub-agent"*
 * and never forgets; this asks *"is this task still running"* and must forget, because forgetting is
 * the whole point of a level signal.
 *
 * ## ⛔ What the wire actually says, measured rather than read off the types
 *
 * Four live turns (`smoke/background-reach-probe.smoke.ts`). A model asked to run a 30-second
 * command in the background produced:
 *
 * ```
 * background_tasks_changed {tasks:[{task_id, task_type:'local_bash', description}]}   ← the level
 * task_started             {task_id, tool_use_id, task_type, description}             ← the binding
 * tool_result              {tool_use_id, is_error:false, content:'Command running in background…'}
 * background_tasks_changed {tasks:[]}                                                 ← the level again
 * task_updated             {task_id, patch:{status:'completed', end_time}}
 * task_notification        {task_id, tool_use_id, status:'completed', summary, output_file}
 * ```
 *
 * ⚠️ **The control — same tool, same command, not detached — produced `task_started` and
 * `task_notification` and NO `background_tasks_changed` at all.** That is what makes membership of
 * the level set the live discriminator, and it is why {@link detachedAs} asks the set rather
 * than looking for a flag.
 *
 * ⛔ **`is_backgrounded` did not appear in ANY of the four captures**, and the dispatch named it as
 * the thing to carry. It is the CONVERSION signal — a foreground task being detached by
 * `Query.backgroundTasks()` — which is the path `245`'s harness took and production could not. It is
 * still honoured in {@link update} for a reason that is not speculative: 247 exposes that very
 * control, so the conversion path becomes reachable for the first time with this change.
 *
 * ## ⚠️ Which way it fails
 *
 * Toward forgetting. Every level payload REPLACES the set, and the FIRST `system/init` empties it —
 * the SDK's own instruction, because *"the level is per-process"* and nothing is emitted at startup.
 * ⚠️ **The first one only, since 257**; see {@link processRestarted} for the cron fire that made the
 * difference between *"an init"* and *"a restart"* a live defect. A task we never saw in a level
 * payload is not called backgrounded on the strength of a later frame.
 * The alternative failure — a card that says "still running" forever because one bookend went
 * missing — is the one `222` cost a dispatch, and the SDK's doc warns against it by name.
 */
export class BackgroundTasks {
  /** The level: task id → what the provider said about it. Replaced wholesale, never merged. */
  private live = new Map<string, { kind?: string; description?: string }>()
  /** How many rows the last level payload carried that {@link live} does not — 0 normally. */
  private droppedCount = 0
  /** The binding, from the frames that carry both ids. Outlives the level, so an ending can name it. */
  private readonly toolOf = new Map<string, string>()
  private readonly taskOf = new Map<string, string>()
  /**
   * Every task this session ever saw running in the background.
   *
   * ⛔ **Separate from {@link live} because BOTH endings must be able to report, and the first one
   * empties the set.** `029` established the redundancy and the reason: `task_updated` and
   * `task_notification` both close the same task, whichever arrives first wins, and the other
   * enriches. Measured at this pin they arrive in the same millisecond — but `task_updated` carries
   * neither `tool_use_id` nor a summary, so gating on membership would have let the poorer bookend
   * silence the richer one every time.
   */
  private readonly everBackground = new Set<string>()

  /**
   * Replace the set from a `background_tasks_changed` payload.
   *
   * ⛔ **REPLACE, in the SDK's own word.** *"consumers that only need 'is background work running'
   * should replace their set with each payload rather than pairing edges, so a missed bookend cannot
   * wedge a stale running indicator."*
   */
  replace(
    tasks: readonly { id: string; kind?: string; description?: string }[],
    dropped = 0,
  ): void {
    // ⛔ **The shortfall is remembered with the set it belongs to** (248). `task_started` re-emits
    // this very set — see `backgroundWorkEvents` — and the first version of that re-emission carried
    // no `dropped`, so a consumer replacing both together (which the event's own doc tells it to do)
    // wiped a *"this list is understating itself"* notice one millisecond after it appeared, while
    // the set was still short. Keeping the two facts in one place is what makes them arrive together.
    this.droppedCount = dropped
    this.live = new Map(
      tasks.slice(0, MAX_BACKGROUND_WORK).map((task) => [
        task.id,
        {
          ...(task.kind ? { kind: task.kind } : {}),
          ...(task.description ? { description: task.description } : {}),
        },
      ]),
    )
    for (const task of tasks) this.everBackground.add(task.id)
  }

  /**
   * Whether a `system/init` has been seen by THIS instance yet — the whole of 257's discriminator.
   *
   * ⚑ **One instance is one CLI process, by construction rather than by belief.** This object is a
   * field on `ClaudeSessionHandle`, and `ClaudeRuntime.start` and `ClaudeRuntime.resume` are the only
   * two places a handle is built — each of them constructs one, hands it exactly one `query()` via
   * `attachQuery`, and nothing ever re-attaches. So a second `init` reaching this object cannot be a
   * second process: it is the same one speaking again.
   */
  private announced = false

  /**
   * A `system/init` arrived. **True when it means the CLI process (re)started** — the only condition
   * the SDK's reset rule names — in which case the set is emptied. False for every later one.
   *
   * ## 🔴 It used to reset on EVERY `init`, and `253` measured why that is wrong (257 §0)
   *
   * `247` read an `init` as *"a new process"* and implemented it as *"every init"*, which was the
   * same thing at the pin it measured. ⚑ **It also anticipated this cost and measured it away**: on
   * both rows that produced a second `init`, the level payload had already said `[]` 15 ms and 42 ms
   * earlier, so the reset was a no-op exactly where it looked alarming.
   *
   * 🔴 **`253`'s capture broke that.** One process, one `query()`, one `session_id` — `init` at
   * 10 194 ms, then **54 805 ms and 114 037 ms** as a scheduled job woke the session twice. **A cron
   * fire is an `init` that is NOT a restart**, and a session holding a detached command AND a
   * schedule lost its running-work card the moment the job fired. Both halves shipped in the same
   * week — `247` built the registry, `253` built the schedules — and nothing tested the pair.
   *
   * ⛔ **So the ruling is the SDK's own sentence, taken literally**: reset when the *CLI process*
   * (re)starts. The message cannot say whether it did; this object's own lifetime can, and that is
   * the discriminator — see {@link announced}. A `session_id` comparison was the other candidate and
   * is weaker: it is unchanged across all three of the inits above, so it would have to read
   * *changed* as the restart signal, and a changed id in one process is a `/clear` — a conversation
   * reset, which restarts nothing and kills no background task.
   *
   * ⛔ **The arm is not simply deleted, and that is the difference from `253`.** `253` could delete
   * its own `init` arm because a cron demonstrably SURVIVES the process — measured, on a resume — so
   * a replayed ledger was already telling the truth. Background work does not: the SDK says the level
   * is per-process and that nothing is emitted at startup, so a reopened conversation replaying a
   * non-empty last word would resurrect a row for work that died with the process. That correction
   * still has to happen, and the first `init` is exactly when it is due.
   *
   * ⚠️ The residual is unchanged and still named: a genuine restart while work is live under-reports
   * until the next membership change. That is the direction that cannot wedge, and it is the
   * provider's instruction; the opposite choice is the one `222` paid for.
   */
  processRestarted(): boolean {
    if (this.announced) return false
    this.announced = true
    this.live = new Map()
    // …and the shortfall goes with the set it described (248). A reset states an EMPTY level, and an
    // empty level cannot be understating anything.
    this.droppedCount = 0
    return true
  }

  /** Remember the task ↔ tool binding from a frame that carried both (`task_started`, `task_notification`). */
  bind(taskId: string, toolUseId: string): void {
    if (!taskId || !toolUseId) return
    this.toolOf.set(taskId, toolUseId)
    this.taskOf.set(toolUseId, taskId)
  }

  /**
   * A `task_updated` patch. Returns the ENDING when this task reached a terminal status, else null.
   *
   * `isBackgrounded` is the conversion signal; a task named by it joins the set even if no level
   * payload has mentioned it yet, because the alternative is a window in which the app holds a
   * detach receipt it has been told about and refuses to believe.
   */
  update(taskId: string, patch: { status?: string; isBackgrounded?: boolean }): 'ended' | null {
    // ⛔ **The ceiling is enforced HERE, not only at the caller, and that is not belt-and-braces.**
    // `backgroundWorkSchema.running` is `.max(MAX_BACKGROUND_WORK)`, and `toWireEvent` re-validates
    // every event — so a set one over the cap would fail the contract and the WHOLE registry frame
    // would degrade to `unknown`. The level payload is already sliced on the way in; the conversion
    // signal is the other door into this map, and a class that owns a bound has to own both.
    if (
      patch.isBackgrounded === true &&
      !this.live.has(taskId) &&
      this.live.size < MAX_BACKGROUND_WORK
    ) {
      this.live.set(taskId, {})
      this.everBackground.add(taskId)
    }
    if (patch.isBackgrounded === false) this.live.delete(taskId)
    if (patch.status && TERMINAL_STATUS.has(patch.status)) {
      this.live.delete(taskId)
      return 'ended'
    }
    return null
  }

  /**
   * **The stop key for this tool call, if its work is running in the background right now** — and
   * `undefined` otherwise, which is the ordinary case.
   *
   * ⚑ **One question, not two, and the first draft asked two.** It had `isBackgrounded(): boolean`
   * beside `idFor(): string | undefined`, so the caller wrote `detached && stopId` — a guard for a
   * combination that cannot occur, since the only way to be backgrounded is to have a binding. A
   * redundant guard is a claim that the case exists; someone maintaining it later would have had to
   * work out that it does not.
   */
  detachedAs(toolUseId: string): string | undefined {
    const taskId = this.taskOf.get(toolUseId)
    return taskId !== undefined && this.live.has(taskId) ? taskId : undefined
  }

  /** The tool call a task belongs to, if we were ever told. */
  toolFor(taskId: string): string | undefined {
    return this.toolOf.get(taskId)
  }

  /** Is this task in the live set — the question a level re-emission needs answered. */
  has(taskId: string): boolean {
    return this.live.has(taskId)
  }

  /**
   * Did this task EVER run in the background — the question an ending needs answered.
   *
   * ⚠️ Never `has`. An ending arrives after the level payload that removed the task, so asking the
   * live set would report `false` on every real completion — which is the one moment a card most
   * needs to change.
   */
  wasBackground(taskId: string): boolean {
    return this.everBackground.has(taskId)
  }

  /**
   * An ending we were told about, honoured directly.
   *
   * ⚠️ **This is not "pairing edges", and the distinction matters.** The hazard the SDK warns about
   * is INFERRING the level from bookends — reconstructing membership by counting starts against
   * ends, where one missed frame wedges the set forever. Removing a task the provider has just named
   * as finished only ever fails toward forgetting, and the next level payload REPLACES the set
   * outright, so a premature removal is corrected by the very next thing the provider says.
   */
  finish(taskId: string): void {
    this.live.delete(taskId)
  }

  /**
   * How many rows the last level payload carried that {@link snapshot} does not (248).
   *
   * ⚠️ Read by every event that states the level, including the `task_started` re-emission — so a
   * consumer that replaces `running` and `dropped` together, which is what the event's doc asks for,
   * never sees the second silently reset while the first is still short.
   */
  dropped(): number {
    return this.droppedCount
  }

  /** The level, as the event carries it: ids, plus whatever binding and description we hold. */
  snapshot(): BackgroundWork[] {
    return [...this.live.entries()].map(([id, about]) => {
      const toolCallId = this.toolOf.get(id)
      return {
        id,
        ...(toolCallId ? { toolCallId } : {}),
        ...(about.kind ? { kind: about.kind } : {}),
        ...(about.description ? { description: about.description } : {}),
      }
    })
  }
}

/**
 * The `task_updated` statuses that mean the work is over.
 *
 * Taken from the pinned SDK's own union (`sdk.d.ts:5864`), which is
 * `'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'`. ⚠️ **`paused` is
 * deliberately NOT here**: paused work still exists and still has a stop control, and removing it
 * from the set would tell the user it finished.
 */
const TERMINAL_STATUS = new Set(['completed', 'failed', 'killed'])
