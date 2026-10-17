import type { AttentionSignal } from '../shared/attention-signals'

export interface AttentionSignalEffects {
  readonly platform: string
  isFocused(): boolean
  badge(count: number): void
  bounce(kind: 'informational'): number | undefined
  cancelBounce(id: number): void
  flash(active: boolean): void
  overlay(count: number): void
}

/** A burst gets one summons; no delayed timer replays arrivals after focus or disable. */
export const ATTENTION_SIGNAL_INTERVAL_MS = 3_000

/** Native attention belongs to the window that supplied the Waiting on you reading. */
export class AttentionSignals {
  private initialized = false
  private enabled = false
  private count = -1
  private bounce: number | undefined
  private arrival = 0
  private lastSummonedAt = -Infinity

  constructor(
    private readonly effects: AttentionSignalEffects,
    private readonly now: () => number = () => performance.now(),
  ) {}

  update(signal: AttentionSignal): void {
    const freshArrival = signal.arrival > this.arrival
    this.arrival = Math.max(this.arrival, signal.arrival)
    const count = signal.enabled ? signal.count : 0
    if (count !== this.count) {
      if (this.effects.platform === 'win32') this.effects.overlay(count)
      else this.effects.badge(count)
      this.count = count
    }
    if (count === 0 || !signal.enabled) this.stop()
    if (
      this.initialized &&
      this.enabled &&
      signal.enabled &&
      count > 0 &&
      freshArrival &&
      !this.effects.isFocused() &&
      this.now() - this.lastSummonedAt >= ATTENTION_SIGNAL_INTERVAL_MS
    ) {
      this.lastSummonedAt = this.now()
      if (this.effects.platform === 'darwin') {
        this.stop()
        this.bounce = this.effects.bounce('informational')
      } else if (this.effects.platform === 'win32') {
        this.effects.flash(true)
      }
    }
    this.enabled = signal.enabled
    this.initialized = true
  }

  focused(): void {
    this.stop()
  }

  clear(): void {
    this.update({ enabled: false, count: 0, arrival: this.arrival })
  }

  /** Native document replacement resets the replay baseline; the rate budget survives it. */
  reloaded(): void {
    this.clear()
    this.initialized = false
    this.arrival = 0
  }

  private stop(): void {
    if (this.effects.platform === 'win32') this.effects.flash(false)
    if (this.bounce !== undefined) {
      this.effects.cancelBounce(this.bounce)
      this.bounce = undefined
    }
  }
}
