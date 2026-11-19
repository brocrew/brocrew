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

  /** One deadline per eligible live conversation. */
  private readonly idleCountdowns = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly operations: ConversationIdleOperations,
    idleStopAfterMs?: number,
  ) {
    this.idleStopAfterMs = idleStopAfterMs ?? DEFAULT_IDLE_STOP_AFTER_MS
  }

  /** Arm a new deadline when the conversation first becomes eligible. */
  countTheIdleMinutes(conversation: string): void {
    if (this.idleCountdowns.has(conversation)) return
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
   * The callback must still own the current deadline. Recheck live eligibility before closing.
   * During quit, the host's shutdown path stops the processes.
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
