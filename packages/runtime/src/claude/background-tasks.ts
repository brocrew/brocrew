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
   * Replace the set from a `background_tasks_changed` payload. The SDK says consumers should replace
   * their set with each payload rather than pair edges, so a missed bookend cannot wedge a stale
   * running indicator.
   */
  replace(
    tasks: readonly { id: string; kind?: string; description?: string }[],
    dropped = 0,
  ): void {
    // The shortfall is kept with the set it belongs to: `task_started` re-emits this set (see
    // `backgroundWorkEvents`), and a consumer replacing both together must not lose a "list is
    // understating itself" notice while the set is still short.
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
    // The shortfall goes with the set it described; an empty level understates nothing.
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
    // The ceiling is enforced here too: `backgroundWorkSchema.running` is `.max(MAX_BACKGROUND_WORK)`
    // and `toWireEvent` re-validates every event, so an over-cap set would degrade the whole registry
    // frame to `unknown`. The level payload is sliced on the way in; this is the other door.
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
   * Did this task ever run in the background — the question an ending needs answered. Uses the
   * history, because completion and live-set updates can arrive in either order.
   */
  wasBackground(taskId: string): boolean {
    return this.everBackground.has(taskId)
  }

  /**
   * An ending we were told about, honoured directly. This is not the "pairing edges" the SDK warns
   * about (inferring the level by counting starts against ends): removing a task the provider named
   * as finished only errs towards forgetting, and the next level payload replaces the set.
   */
  finish(taskId: string): void {
    this.live.delete(taskId)
  }

  /**
   * How many rows the last level payload carried that {@link snapshot} does not. Read by every event
   * that states the level, so a consumer replacing `running` and `dropped` together never sees one
   * reset while the other is still short.
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
 * The `task_updated` statuses that mean the work is over (the SDK's union is `pending`, `running`,
 * `completed`, `failed`, `killed`, `paused`). `paused` is deliberately not here: paused work still
 * exists and has a stop control.
 */
const TERMINAL_STATUS = new Set(['completed', 'failed', 'killed'])
