interface Waiter<T> {
  resolve: (result: IteratorResult<T>) => void
  reject: (error: unknown) => void
}

/** Default cap on buffered items before a slow consumer trips the overflow policy. */
const DEFAULT_HIGH_WATER_MARK = 16_384

/**
 * A push-based async queue: the producer side `push`es values, a single consumer
 * `for await`s them. Hardened (019, fixing 007 P2-3):
 *
 *  - **Unambiguous end.** Delivery is driven by buffer LENGTH, not a sentinel
 *    value, so a falsy item (`0`, `''`, `false`, even `undefined`) is delivered
 *    as a real value — `push(undefined)` is no longer mistaken for "empty".
 *  - **Error channel.** {@link fail} propagates a producer error to the consumer:
 *    the `for await` THROWS it (after draining any already-buffered items),
 *    instead of a silent {@link close} or a hang.
 *  - **Cancellation.** Breaking out of / `return()`ing the iterator settles its
 *    pending waiter (no leak) and marks the queue ended so further `push`es are
 *    cleanly ignored (single consumer).
 *  - **Bounded (backpressure policy).** The buffer is capped at `highWaterMark`;
 *    a producer that outruns the consumer past the cap {@link fail}s the queue
 *    with an overflow error rather than growing memory without bound.
 *
 * `close()` (the normal end) and `push`/ordering semantics are unchanged, so the
 * 008–012 lifecycle that flows through this queue (close/terminal/settle) is
 * preserved.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = []
  private readonly waiters: Waiter<T>[] = []
  /** Ended = closed OR failed OR consumer-cancelled — no further values are produced. */
  private ended = false
  private failure: { error: unknown } | null = null

  constructor(private readonly highWaterMark: number = DEFAULT_HIGH_WATER_MARK) {}

  push(value: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.buffer.push(value)
    if (this.buffer.length > this.highWaterMark) {
      this.fail(
        new Error(
          `AsyncQueue overflow: buffered more than ${this.highWaterMark} items (consumer too slow)`,
        ),
      )
    }
  }

  /** Propagate a producer failure — the consumer's `for await` throws `error`. */
  fail(error: unknown): void {
    if (this.ended) return
    this.ended = true
    this.failure = { error }
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  /** The normal end: iteration finishes once the buffer drains. */
  close(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
  }

  /**
   * An **explicit** async iterator (019 used an async-generator; 032 fixes the 023
   * P2 hang). An async-generator parked at an `await` in `next()` cannot run its
   * `return()` cleanup until the awaited promise settles, so cancelling a parked
   * consumer hangs. This iterator's {@link return} instead SYNCHRONOUSLY resolves +
   * removes the parked waiter, so `return()` (or `break`ing out of a `for await`)
   * while parked in `next()` cancels at once. Buffered drain-by-length, `fail`
   * propagation, bounded-overflow, and unambiguous falsy delivery are unchanged.
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    const FINISHED: IteratorResult<T> = { value: undefined, done: true }
    /**
     * EVERY waiter this iterator has parked — not just the latest (054, fixing 044 P2 #4).
     * A single slot meant a second concurrent `next()` overwrote the first, and `return()`
     * then settled only the newer one while the older stayed parked forever: `return()` also
     * ends the queue, so no later `push` could ever resolve it. A permanently-hung consumer.
     */
    const parked = new Set<Waiter<T>>()
    let done = false

    // Arrow functions so `this` stays the queue instance (no `this`-aliasing).
    const next = (): Promise<IteratorResult<T>> => {
      if (done) return Promise.resolve(FINISHED)
      // Delivery driven by buffer LENGTH — a falsy buffered item is a real value (019).
      if (this.buffer.length > 0) {
        return Promise.resolve({ value: this.buffer.shift() as T, done: false })
      }
      // A producer failure THROWS once (after the buffer drains); then the iterator is done.
      if (this.failure) {
        done = true
        return Promise.reject(this.failure.error)
      }
      if (this.ended) {
        done = true
        return Promise.resolve(FINISHED)
      }
      // Park until push/close/fail resolves us — or return() cancels us. `this.waiters` is
      // FIFO, so concurrent callers are served in call order.
      let waiter!: Waiter<T>
      return new Promise<IteratorResult<T>>((resolve, reject) => {
        waiter = { resolve, reject }
        parked.add(waiter)
        this.waiters.push(waiter)
      }).then(
        (result) => {
          parked.delete(waiter)
          if (result.done) done = true
          return result
        },
        (error) => {
          parked.delete(waiter)
          done = true
          throw error
        },
      )
    }

    /**
     * Cancel iteration. Resolves **every** parked `next()` to `{done:true}` and removes their
     * waiters **synchronously**, so a consumer parked in `next()` cancels at once — never
     * waiting on a promise that will not settle (023 P2; all-waiters in 054).
     *
     * Then ends the queue via {@link close}, which settles anything still parked: once
     * cancelled, no `push` can ever resolve a waiter, so leaving one parked would hang it for
     * good. Settle-once holds throughout — a waiter already resolved elsewhere is simply absent
     * from the lists, and re-resolving a settled promise is a no-op. Idempotent.
     */
    const returnIteration = (): Promise<IteratorResult<T>> => {
      done = true
      for (const waiter of parked) {
        parked.delete(waiter)
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        waiter.resolve(FINISHED)
      }
      this.close()
      return Promise.resolve(FINISHED)
    }

    const iterator: AsyncIterableIterator<T> = {
      next,
      return: returnIteration,
      [Symbol.asyncIterator]: () => iterator,
    }
    return iterator
  }
}
