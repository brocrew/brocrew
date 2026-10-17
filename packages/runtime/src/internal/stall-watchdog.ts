/**
 * A turn that stops making progress must not present as a silent, permanent "working" (074).
 *
 * The live incident: a Claude turn produced its final message, then the provider went quiet without
 * ever sending `result`. The stream never ended, so nothing failed — the session simply sat on
 * `working` with the composer disabled and no explanation, recoverable only by a manual interrupt.
 *
 * This watchdog does not judge WHY progress stopped (rate limit, provider backoff, a genuinely slow
 * tool) and deliberately does **not** kill the turn — a long build is not an error. It only makes
 * the silence visible, so the user can see the situation and interrupt if they want to.
 *
 * Timers are injectable so tests drive this deterministically rather than by sleeping, and the real
 * timer is `unref`d: a watchdog must never be the reason a process stays alive.
 */

import type { RuntimeEvent } from '../events'

/**
 * Whether an event is the provider reasoning: a `thinking` event, the `thinking` activity, or a raw
 * reasoning frame kept as `unknown` (Claude's `thinking_delta`, Codex's `item/reasoning/textDelta`).
 */
export function isReasoning(event: RuntimeEvent): boolean {
  return (
    event.type === 'thinking' ||
    (event.type === 'activity' && event.phase === 'thinking') ||
    (event.type === 'unknown' && event.category === 'reasoning')
  )
}

/**
 * The stall notice, in words: "Still thinking" when the last provider event was reasoning, and the
 * no-activity sentence otherwise. The minutes are whole minutes of silence.
 */
export function stallNotice(idleMs: number, afterReasoning: boolean): string {
  if (afterReasoning)
    return `Still thinking (${String(Math.max(1, Math.floor(idleMs / 60_000)))} min).`
  return `still working — no activity for ${String(Math.round(idleMs / 1000))}s. The provider may be busy, rate-limited, or stalled; you can interrupt.`
}

export interface WatchdogTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const realTimers: WatchdogTimers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    // Node: don't hold the event loop open just to report a stall.
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Default idle window before a working turn is reported as stalled — generous on purpose. */
export const DEFAULT_STALL_TIMEOUT_MS = 120_000

export class StallWatchdog {
  private handle: unknown = null
  /** Reported once per stall: a repeating notice would be noise, and nothing new has happened. */
  private reported = false
  /** Whether the last progress was the model reasoning. */
  private afterReasoning = false

  constructor(
    private readonly onStall: (idleMs: number, afterReasoning: boolean) => void,
    private readonly timeoutMs: number = DEFAULT_STALL_TIMEOUT_MS,
    private readonly timers: WatchdogTimers = realTimers,
  ) {}

  /**
   * Progress happened (the turn started, or any event arrived): restart the window.
   *
   * Calling this on EVERY event is what keeps a legitimately busy turn from being flagged — the
   * watchdog measures silence, not duration. `reasoning` says whether this progress was the model
   * reasoning, so a silence after it can be said as thinking.
   */
  notice(reasoning = false): void {
    this.stop()
    this.reported = false
    this.afterReasoning = reasoning
    this.handle = this.timers.setTimeout(() => {
      this.handle = null
      if (this.reported) return
      this.reported = true
      this.onStall(this.timeoutMs, this.afterReasoning)
    }, this.timeoutMs)
  }

  /** The turn is over (terminal, interrupted, closed): stop watching. Idempotent. */
  stop(): void {
    if (this.handle !== null) {
      this.timers.clearTimeout(this.handle)
      this.handle = null
    }
  }

  /** Whether a stall window is currently armed (tests/diagnostics). */
  get armed(): boolean {
    return this.handle !== null
  }
}
