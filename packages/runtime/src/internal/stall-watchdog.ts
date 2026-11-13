import type { SessionStatus } from '@brobot2/shared'
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

/** Whole minutes of silence after reasoning; the ordinary no-activity notice otherwise. */
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
  static reporterFor(
    machine: { readonly isTerminal: boolean; readonly hasProviderWork: boolean },
    terminated: () => boolean,
    status: () => SessionStatus,
    emit: (event: RuntimeEvent) => void,
  ): (idleMs: number, afterReasoning?: boolean) => void {
    return (idleMs, afterReasoning = false) => {
      if (terminated() || machine.isTerminal || !machine.hasProviderWork) return
      if (status() === 'waiting_permission') return
      emit({
        type: 'error',
        fatal: false,
        message: stallNotice(idleMs, afterReasoning),
        stall: true,
        ...(afterReasoning ? { thinking: true as const } : {}),
      })
    }
  }

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

  /** Restart on every event: the watchdog measures silence, not the length of a turn. */
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

  /** Keep the watchdog in step with the turn: any event is progress; a terminal ends the watch. */
  progress(event: RuntimeEvent, hasProviderWork: boolean): void {
    if (event.type === 'turn' || (event.type === 'session' && event.state === 'ended')) {
      this.stop()
      return
    }
    if (event.type === 'status') {
      if (event.state === 'working') this.notice()
      else this.stop()
      return
    }
    // The stall notice itself is not provider progress: counting it would re-arm the watchdog and
    // forget that the silence followed reasoning.
    if (event.type === 'error' && event.stall) return
    // Provider work includes activity outside an explicit turn.
    if (hasProviderWork) this.notice(isReasoning(event))
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
