import type { RuntimeEvent } from '../events'

/**
 * Coalesces streamed `assistant_delta` events into fewer, larger chunks (019,
 * fixing 007 P2-3) so a high token rate can't flood the event stream one event
 * per token. Delta text is buffered and flushed as a single `assistant_delta` on
 * a size or time window — AND, critically, flushed BEFORE any non-delta event
 * (the authoritative `assistant_message` and every terminal `turn`/`session`/
 * `status`). So the 008 ordering invariants (deltas → message; terminal `turn` →
 * `idle`) and message-as-source-of-truth still hold; only delta granularity
 * changes, not the `RuntimeEvent` contract.
 */
export class DeltaCoalescer {
  private buffer = ''
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly out: (event: RuntimeEvent) => void,
    private readonly windowMs = 30,
    private readonly maxChars = 8192,
  ) {}

  /** Feed one event: buffer deltas, pass everything else through (flushing first). */
  feed(event: RuntimeEvent): void {
    if (event.type === 'assistant_delta') {
      this.buffer += event.text
      if (this.buffer.length >= this.maxChars) {
        this.flush() // size window
      } else if (this.timer === null) {
        this.timer = setTimeout(() => this.flush(), this.windowMs) // time window
        if (typeof this.timer.unref === 'function') this.timer.unref()
      }
      return
    }
    // Any non-delta event: the buffered deltas must land first (ordering).
    this.flush()
    this.out(event)
  }

  /** Emit the buffered deltas as a single `assistant_delta` (a no-op when empty). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return
    const text = this.buffer
    this.buffer = ''
    this.out({ type: 'assistant_delta', text })
  }
}
