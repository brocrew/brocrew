import { MAX_BACKGROUND_WORK, type BackgroundWork } from '../background-work'

/**
 * Each background_tasks_changed payload replaces the per-process membership, so the next level
 * corrects any missed start or finish edge.
 */
export class BackgroundTasks {
  /** The level: task id → what the provider said about it. Replaced wholesale, never merged. */
  private live = new Map<string, { kind?: string; description?: string }>()
  /** How many rows the last level payload carried that {@link live} does not — 0 normally. */
  private droppedCount = 0
  /** The binding, from the frames that carry both ids. Outlives the level, so an ending can name it. */
  private readonly toolOf = new Map<string, string>()
  private readonly taskOf = new Map<string, string>()
  /** Keep past membership so either ending frame can report the task after its live entry is gone. */
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

  /** Each handle attaches one query, so later system/init frames belong to the same CLI process. */
  private announced = false

  /**
   * Clear replayed membership on the first system/init. A scheduled wake can send another init
   * in the same CLI process while background work is still running.
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

  /** A stop key requires both the tool-to-task binding and current background membership. */
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
   * Use the history, because completion and live-set updates can arrive in either order.
   * SDK 0.3.322 removes a finished task after its ending, unlike the earlier ordering.
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
