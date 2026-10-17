import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  probeRunDeadline,
  ProbeRunDeadlineExpired,
  RUN_BUDGET_MARGIN,
  runBudgetMs,
  TEST_TIMEOUT_MARGIN_MS,
} from '../smoke/probe-run-deadline'

/**
 * ⛔ **`655` · the probes' one outer deadline, measured on the clock rather than read off the
 * source** (`649` F3).
 *
 * `649`'s censuses could only pin the deadline's TEXT, because it lived inside two probe files
 * nothing can import. ⚑ Lifted into `smoke/probe-run-deadline.ts`, it runs here under fake timers,
 * and each property the probes rely on is a behaviour — with a control one fact over wherever the
 * property is a difference between two readings.
 */

/** A promise the test settles by hand — the probe's capture, standing still. */
function held<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-23T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('655 · runBudgetMs is 042’s rule as arithmetic', () => {
  it('⛔ comfortably exceeds the sum of every serial wait, and moves when one does', () => {
    expect(runBudgetMs([30_000, 60_000, 15_000])).toBe(Math.ceil(105_000 * RUN_BUDGET_MARGIN))
    expect(runBudgetMs([30_000, 60_000, 15_000])).toBeGreaterThan(105_000)
    // ⚑ The control: one wait longer, and the budget follows it — no constant to re-invert.
    expect(runBudgetMs([30_000, 90_000, 15_000])).toBeGreaterThan(
      runBudgetMs([30_000, 60_000, 15_000]),
    )
  })

  it('⚠️ gives vitest a timeout PAST the deadline, so the deadline — with its teardown — fires first', () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    expect(deadline.testTimeoutMs).toBe(1_000 + 100 + TEST_TIMEOUT_MARGIN_MS)
    expect(deadline.testTimeoutMs).toBeGreaterThan(deadline.budgetMs + 100)
  })
})

describe('655 · probeRunDeadline', () => {
  it('🔴 expiry starts owned teardown BEFORE the awaiter hears, and says NOT PERFORMED', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const order: string[] = []
    const capture = held<string>()
    const release = deadline.own(async () => {
      order.push('teardown started')
      await new Promise((resolve) => setTimeout(resolve, 40))
      order.push('teardown finished')
    })
    const run = deadline
      .within('measuring', () => capture.promise)
      .catch((error: unknown) => {
        order.push('rejected')
        return error
      })

    await vi.advanceTimersByTimeAsync(999)
    expect(order, 'one millisecond early, nothing').toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(order, 'started, and the awaiter has NOT heard yet').toEqual(['teardown started'])
    await vi.advanceTimersByTimeAsync(40)
    const error = await run
    // ⛔ `655` review: a teardown merely STARTED dies with the fork vitest stops after the
    // rejection. The rejection waits for it to FINISH.
    expect(order).toEqual(['teardown started', 'teardown finished', 'rejected'])
    expect(error).toBeInstanceOf(ProbeRunDeadlineExpired)
    expect((error as Error).message).toBe(
      'NOT PERFORMED — the test probe exceeded its 1000ms total budget while measuring',
    )
    release()
  })

  it('⛔ is born ONCE: a second call gets what remains, never a fresh budget', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const first = held<void>()
    const firstRun = deadline.within('arms A–C', () => first.promise)
    await vi.advanceTimersByTimeAsync(400)
    first.resolve()
    await firstRun

    const second = deadline.within('arm D', () => new Promise<never>(() => {}))
    const outcome = second.then(
      () => 'resolved',
      () => 'rejected',
    )
    // ⚑ 600 ms remain. A fresh budget would still have 400 ms to run at this point.
    await vi.advanceTimersByTimeAsync(600)
    expect(await outcome).toBe('rejected')

    // ⚑ The control, one fact over: a second call that finishes INSIDE what remains succeeds.
    const control = probeRunDeadline('test probe', 1_000, 100)
    const one = held<void>()
    const oneRun = control.within('arms A–C', () => one.promise)
    await vi.advanceTimersByTimeAsync(400)
    one.resolve()
    await oneRun
    const two = control.within('arm D', async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return 'measured'
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(await two).toBe('measured')
  })

  it('⛔ a teardown that hangs cannot hold the rejection forever — it waits teardownMs, then rejects', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const release = deadline.own(() => new Promise<void>(() => {}))
    const run = deadline
      .within('measuring', () => new Promise<never>(() => {}))
      .then(
        () => 'resolved',
        () => 'rejected',
      )
    let settled = false
    void run.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(1_000 + 99)
    expect(settled, 'still inside the teardown bound').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run).toBe('rejected')
    release()
  })

  it('⚑ the control: work that finishes in time returns its value and leaves no timer behind', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const value = await deadline.within('measuring', async () => 'measured')
    expect(value).toBe('measured')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('⛔ once expired, nothing new starts: within and refuse both throw, and tear down', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const expired = deadline.within('first', () => new Promise<never>(() => {}))
    const settled = expired.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(1_000)
    await settled

    let stops = 0
    const release = deadline.own(async () => {
      stops += 1
    })
    let workRan = false
    await expect(
      deadline.within('second', async () => {
        workRan = true
        return 'never run'
      }),
    ).rejects.toThrow(/NOT PERFORMED — .* while second$/)
    expect(workRan, 'refused BEFORE the work was called').toBe(false)
    expect(() => deadline.refuse('a third capture')).toThrow(/while a third capture$/)
    expect(stops).toBe(2)
    release()
  })

  it('🔴 refuse reads the CLOCK as well as the bit — a lagging timer cannot let a capture start', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    let stopped = false
    const release = deadline.own(async () => {
      stopped = true
    })
    const capture = held<void>()
    const run = deadline.within('measuring', () => capture.promise).catch((e: unknown) => e)

    // ⚠️ The wall clock passes the deadline; the timer has NOT fired (a sleep, a loaded loop).
    vi.setSystemTime(Date.now() + 1_500)
    expect(() => deadline.refuse('starting arm B')).toThrow(ProbeRunDeadlineExpired)
    expect(stopped).toBe(true)
    // ⚑ The control, one fact over: before the deadline the same call refuses nothing.
    const fresh = probeRunDeadline('fresh probe', 1_000, 100)
    void fresh.within('measuring', () => new Promise<never>(() => {})).catch(() => undefined)
    expect(() => fresh.refuse('starting arm B')).not.toThrow()

    capture.resolve()
    expect(await run).toBeInstanceOf(ProbeRunDeadlineExpired)
    release()
  })

  it('🔴 a refusal the work SWALLOWS still cannot turn into a pass', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const run = deadline
      .within('measuring', async () => {
        await Promise.resolve()
        vi.setSystemTime(Date.now() + 2_000)
        try {
          deadline.refuse('starting the next arm')
        } catch {
          // ⛔ an adopter that catches its own refusal and carries on
        }
        return 'looked green'
      })
      .then(
        (value) => value,
        (error: unknown) => error,
      )
    expect(await run).toBeInstanceOf(ProbeRunDeadlineExpired)
  })

  it('🔴 work that RESOLVES after the clock passed is the deadline’s, even with the bit unset', async () => {
    // ⚑ `655` review: the success path was only ever tested where a refusal had set the bit.
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const run = deadline
      .within('measuring', async () => {
        await Promise.resolve()
        vi.setSystemTime(Date.now() + 2_000)
        return 'looked green'
      })
      .then(
        (value) => value,
        (error: unknown) => error,
      )
    expect(await run).toBeInstanceOf(ProbeRunDeadlineExpired)
  })

  it('⚠️ a work that throws SYNCHRONOUSLY leaves no timer armed behind it', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    await expect(
      deadline.within('measuring', () => {
        throw new Error('thrown before any promise')
      }),
    ).rejects.toThrow('thrown before any promise')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('⚠️ a work error after the deadline is the deadline’s, not the error’s own', async () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const run = deadline
      .within('measuring', async () => {
        await Promise.resolve()
        vi.setSystemTime(Date.now() + 2_000)
        throw new Error('the transport closed under the arm')
      })
      .catch((error: unknown) => error)
    expect(await run).toBeInstanceOf(ProbeRunDeadlineExpired)
    // ⚑ The control: the same error INSIDE the budget is reported as itself.
    const inTime = probeRunDeadline('test probe', 1_000, 100)
    await expect(
      inTime.within('measuring', async () => {
        throw new Error('the transport closed under the arm')
      }),
    ).rejects.toThrow('the transport closed under the arm')
  })

  it('⛔ owns one capture at a time, and a release clears only its own', () => {
    const deadline = probeRunDeadline('test probe', 1_000, 100)
    const stop = async (): Promise<void> => {}
    const releaseFirst = deadline.own(stop)
    expect(() => deadline.own(async () => {})).toThrow(/two captures at once/)
    releaseFirst()
    const releaseSecond = deadline.own(async () => {})
    releaseFirst()
    expect(
      () => deadline.own(async () => {}),
      'a stale release must not free the live one',
    ).toThrow()
    releaseSecond()
  })
})
