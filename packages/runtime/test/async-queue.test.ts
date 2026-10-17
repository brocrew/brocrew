import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../src/internal/async-queue'

async function drain<T>(q: AsyncQueue<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of q) out.push(v)
  return out
}

/** Reject if `p` doesn't settle within `ms` — so a HANG (pre-fix) fails the assertion promptly. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ])
}

describe('AsyncQueue — hardened (007 P2-3)', () => {
  it('drains pushed values in order, then ends on close()', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    q.close()
    expect(await drain(q)).toEqual([1, 2, 3])
  })

  it('delivers falsy values — a pushed `undefined`/`0`/`""`/`false` is a real item, not "end"', async () => {
    const q = new AsyncQueue<unknown>()
    q.push(0)
    q.push('')
    q.push(false)
    q.push(undefined)
    q.push(null)
    q.close()
    expect(await drain(q)).toEqual([0, '', false, undefined, null])
  })

  it('fail(error) propagates: the consumer drains buffered items, then throws', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.fail(new Error('boom'))
    const seen: number[] = []
    let error: unknown
    try {
      for await (const v of q) seen.push(v)
    } catch (e) {
      error = e
    }
    expect(seen).toEqual([1, 2]) // buffered items delivered first
    expect((error as Error).message).toBe('boom')
  })

  it('fail(error) rejects a parked consumer (no silent close, no hang)', async () => {
    const q = new AsyncQueue<number>()
    const consumer = (async () => {
      for await (const _v of q) void _v
    })()
    await new Promise((r) => setTimeout(r, 5)) // let the consumer park on an empty queue
    q.fail(new Error('parked-boom'))
    await expect(consumer).rejects.toThrow('parked-boom')
  })

  it('breaking out of the iterator ends the queue — further pushes are ignored', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    const seen: number[] = []
    for await (const v of q) {
      seen.push(v)
      break // cancel while (possibly) parked / mid-iteration
    }
    expect(seen).toEqual([1])
    q.push(2) // ignored — queue is ended
    expect(await drain(q)).toEqual([])
  })

  it('a bounded queue fails on overflow instead of growing unboundedly', async () => {
    const q = new AsyncQueue<number>(3) // highWaterMark = 3
    q.push(1)
    q.push(2)
    q.push(3)
    q.push(4) // exceeds the cap → fail(overflow)
    let error: unknown
    try {
      await drain(q)
    } catch (e) {
      error = e
    }
    expect((error as Error).message).toMatch(/overflow/)
  })

  it('push after close() or fail() is a clean no-op', async () => {
    const closed = new AsyncQueue<number>()
    closed.close()
    expect(() => closed.push(1)).not.toThrow()
    expect(await drain(closed)).toEqual([])

    const failed = new AsyncQueue<number>()
    failed.fail(new Error('x'))
    expect(() => failed.push(1)).not.toThrow()
  })
})

describe('AsyncQueue — explicit-iterator cancellation (023 P2 / 032)', () => {
  it('return() while parked in next() cancels IMMEDIATELY (no hang) and settles the parked next()', async () => {
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    const nextP = it.next() // parks on the empty queue
    // Pre-fix (async-generator): return() cannot run its `finally` until the awaited
    // promise settles, so BOTH promises hang. Post-fix: return() resolves at once.
    const retP = it.return!()
    await expect(withTimeout(retP, 250)).resolves.toEqual({ value: undefined, done: true })
    await expect(withTimeout(nextP, 250)).resolves.toEqual({ value: undefined, done: true })
    // Subsequent next() is done; the queue is ended (single consumer).
    await expect(it.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('return() removes the parked waiter so a later push cannot leak to it, and the queue is ended', async () => {
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    void it.next() // park
    await withTimeout(it.return!(), 250)
    // The waiter was removed + the queue ended → a push is a clean no-op, drain is empty.
    expect(() => q.push(99)).not.toThrow()
    expect(await drain(q)).toEqual([])
    await expect(it.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('return() is idempotent and safe after normal completion', async () => {
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    q.push(7)
    q.close()
    expect(await it.next()).toEqual({ value: 7, done: false })
    expect(await it.next()).toEqual({ value: undefined, done: true }) // ended
    await expect(it.return!()).resolves.toEqual({ value: undefined, done: true })
    await expect(it.return!()).resolves.toEqual({ value: undefined, done: true }) // idempotent
  })
})

describe('AsyncQueue — concurrent next() waiters (044 P2 #4)', () => {
  /** Settled-or-not without hanging the test: pending stays pending past a macrotask. */
  const settled = async <T>(p: Promise<T>): Promise<{ done: boolean; value?: T }> => {
    const marker = Symbol('pending')
    const result = await Promise.race([p, new Promise((r) => setTimeout(() => r(marker), 40))])
    return result === marker ? { done: false } : { done: true, value: result as T }
  }

  it("return() settles EVERY parked next(), not just the latest — the reviewer's probe", async () => {
    // Pre-fix the iterator kept ONE `parked` slot: the second next() overwrote the first, so
    // return() settled only the second and the FIRST stayed pending forever (return() also ends
    // the queue, so no push could ever reach it).
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    const first = it.next()
    const second = it.next()

    await withTimeout(it.return!(), 250)

    expect(await settled(first), 'the FIRST parked next() must settle').toEqual({
      done: true,
      value: { value: undefined, done: true },
    })
    expect(await settled(second), 'the second parked next() must settle').toEqual({
      done: true,
      value: { value: undefined, done: true },
    })
  })

  it('N concurrent next() all settle on return() — none left pending', async () => {
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    const pending = [it.next(), it.next(), it.next(), it.next(), it.next()]

    await withTimeout(it.return!(), 250)

    const results = await withTimeout(Promise.all(pending), 250)
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ value: undefined, done: true })))
  })

  it('concurrent next() are served in CALL order by successive pushes', async () => {
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    const first = it.next()
    const second = it.next()

    q.push(1)
    q.push(2)

    expect(await withTimeout(first, 250)).toEqual({ value: 1, done: false })
    expect(await withTimeout(second, 250)).toEqual({ value: 2, done: false })
  })

  it('close() settles every concurrent waiter; fail() rejects every one', async () => {
    const closing = new AsyncQueue<number>()
    const closeIt = closing[Symbol.asyncIterator]()
    const closePending = [closeIt.next(), closeIt.next()]
    closing.close()
    expect(await withTimeout(Promise.all(closePending), 250)).toEqual([
      { value: undefined, done: true },
      { value: undefined, done: true },
    ])

    const failing = new AsyncQueue<number>()
    const failIt = failing[Symbol.asyncIterator]()
    const failPending = [failIt.next(), failIt.next()]
    failing.fail(new Error('producer died'))
    await expect(failPending[0]).rejects.toThrow('producer died')
    await expect(failPending[1]).rejects.toThrow('producer died')
  })

  it('a waiter already resolved by a push is not double-settled by a later return()', async () => {
    const q = new AsyncQueue<number>()
    const it = q[Symbol.asyncIterator]()
    const first = it.next()
    const second = it.next()

    q.push(1) // settles `first` only
    expect(await withTimeout(first, 250)).toEqual({ value: 1, done: false })

    await withTimeout(it.return!(), 250)
    // `first` keeps its real value (not overwritten by the cancel), `second` is cancelled.
    expect(await withTimeout(first, 250)).toEqual({ value: 1, done: false })
    expect(await withTimeout(second, 250)).toEqual({ value: undefined, done: true })
  })
})
