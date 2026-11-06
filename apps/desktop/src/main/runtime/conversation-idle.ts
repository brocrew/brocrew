/**
 * How long a running conversation stays idle before this app stops its provider process. A running
 * process holds about 300 MB, so one minute frees it soon after an exchange ends; the next message to
 * a stopped conversation then waits a few seconds more while its history resumes. What counts as
 * idle is {@link RuntimeHost.idleEnoughToStop}'s rule, not this clock. A stop changes nothing about a
 * piece of work.
 */
const DEFAULT_IDLE_STOP_AFTER_MS = 60_000

interface ConversationIdleOperations {
  closed(): boolean
  isStillIdle(conversation: string): boolean
  close(conversation: string): Promise<void>
  errorMessage(error: unknown): string
}

export class ConversationIdle {
  /** ⚑ D-018 · see {@link DEFAULT_IDLE_STOP_AFTER_MS}. */
  private readonly idleStopAfterMs: number

  /**
   * 🔴 **D-018 · each running conversation's idle countdown, while it is idle** — armed by the flush
   * that derives it idle ({@link sayWhatMoved}, {@link idleEnoughToStop}), dropped by every mark
   * ({@link stateMayHaveMoved}) — the slot going is one — and run into {@link stopItIfStillIdle}.
   * ⛔ One per conversation and never a sweep; it belongs to this host and dies with it.
   */
  private readonly idleCountdowns = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly operations: ConversationIdleOperations,
    idleStopAfterMs?: number,
  ) {
    this.idleStopAfterMs = idleStopAfterMs ?? DEFAULT_IDLE_STOP_AFTER_MS
  }

  /**
   * ⚑ **D-018 · arm its idle countdown** ({@link idleCountdowns}) — the mark that asked for this
   * flush already dropped any earlier one.
   */
  countTheIdleMinutes(conversation: string): void {
    const countdown = setTimeout(
      () => void this.stopItIfStillIdle(conversation, countdown),
      this.idleStopAfterMs,
    )
    // ⛔ Never the reason this process stays alive — {@link awaitLaunch}'s bound's idiom.
    if (typeof countdown.unref === 'function') countdown.unref()
    this.idleCountdowns.set(conversation, countdown)
  }

  cancel(conversation: string): void {
    const countdown = this.idleCountdowns.get(conversation)
    if (countdown !== undefined) {
      clearTimeout(countdown)
      this.idleCountdowns.delete(conversation)
    }
  }

  /**
   * 🔴 **D-018 · a countdown ran out: stop the process if nothing moved and it is still idle** —
   * through the conversation's own close ({@link close}, {@link THE_APP_ITSELF}), the one a quit
   * uses.
   *
   * ⛔ **A countdown a mark dropped says nothing**: it is no longer this conversation's, so
   * something moved since it was armed. ⛔ **Nor once a quit has begun**
   * ({@link LaunchRegistry.closed}): the quit stops every process itself, and the database is
   * closing. ⚑ The one state is derived again at this instant, and {@link idleEnoughToStop}
   * re-reads what it does not carry.
   *
   * ⚑ The provider writes `session: ended` and `status: ended`, the row's status is recorded, the
   * slot goes and every window is told — D-019's marks and `conversations`. ⛔ No row of this app's,
   * and no piece moves (D-016c). ⚑ Its next message starts it again (D-017 · R1).
   */
  private async stopItIfStillIdle(
    conversation: string,
    countdown: ReturnType<typeof setTimeout>,
  ): Promise<void> {
    if (this.operations.closed() || this.idleCountdowns.get(conversation) !== countdown) return
    this.idleCountdowns.delete(conversation)
    try {
      if (!this.operations.isStillIdle(conversation)) return
    } catch (error) {
      console.warn(
        `runtime host could not tell whether ${conversation} is still idle: ${this.operations.errorMessage(error)}`,
      )
      return
    }
    console.info(
      `runtime host: ${conversation} was idle for ${this.idleStopAfterMs}ms — stopping its ` +
        'process; its next message starts it again',
    )
    try {
      await this.operations.close(conversation)
    } catch (error) {
      console.warn(
        `runtime host could not stop ${conversation}, idle: ${this.operations.errorMessage(error)}`,
      )
    }
  }
}
