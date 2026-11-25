import { afterEach, describe, expect, it, vi } from 'vitest'
import { oneReadAtATime } from '../src/renderer/src/lib/one-read-at-a-time'

/** A read the test releases by hand, recording which version of the world each one saw. */
function gatedReads() {
  let world = 0
  const seen: number[] = []
  const waiting: (() => void)[] = []
  const read = (): Promise<void> => {
    const at = world
    return new Promise<void>((resolve) => {
      waiting.push(() => {
        seen.push(at)
        resolve()
      })
    })
  }
  return {
    read,
    change: () => (world += 1),
    get world() {
      return world
    },
    seen,
    started: () => waiting.length,
    release: async () => {
      const next = waiting.shift()
      if (next === undefined) throw new Error('no read is in flight')
      next()
      // let the drain loop reach its next `await` before the test looks again
      for (let i = 0; i < 5; i += 1) await Promise.resolve()
    },
  }
}

describe('a burst costs two reads, whatever its size', () => {
  it('six asks while one read is in flight start ONE more read — not five', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const first = ask()
    for (let i = 0; i < 5; i += 1) {
      g.change()
      void ask()
    }
    expect(g.started()).toBe(1)
    await g.release()
    // the owed read starts as the first one lands
    expect(g.started()).toBe(1)
    await g.release()
    await first
    expect(g.seen).toHaveLength(2)
  })

  it('one ask, one read, and nothing owed afterwards', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const only = ask()
    await g.release()
    await only
    expect(g.seen).toHaveLength(1)
    expect(g.started()).toBe(0)
  })
})

describe('the last change is always read', () => {
  it('a change announced after the in-flight read began is read by the owed one', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const done = ask()
    g.change()
    void ask()
    await g.release()
    await g.release()
    await done
    // the in-flight read saw the world BEFORE the change; only the owed one saw it
    expect(g.seen).toEqual([0, 1])
    expect(g.seen.at(-1)).toBe(g.world)
  })

  it('a change during the OWED read owes one more — the loop does not stop at two', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const done = ask()
    g.change()
    void ask()
    await g.release()
    // the owed read is in flight now, and the world moves again under it
    g.change()
    void ask()
    await g.release()
    await g.release()
    await done
    expect(g.seen).toEqual([0, 1, 2])
    expect(g.seen.at(-1)).toBe(g.world)
  })

  it('once everything has landed, the next ask starts a fresh read', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const one = ask()
    await g.release()
    await one
    g.change()
    const two = ask()
    expect(g.started()).toBe(1)
    await g.release()
    await two
    expect(g.seen).toEqual([0, 1])
  })

  it('a failed read does not swallow the one owed after it, and only the LAST outcome is reported', async () => {
    let calls = 0
    const ask = oneReadAtATime(async () => {
      calls += 1
      if (calls === 1) {
        void ask() // an announcement lands while the first read is failing
        throw new Error('the first read failed')
      }
    })
    await expect(ask()).resolves.toBeUndefined()
    expect(calls).toBe(2)
    // the last read failing IS reported
    const failing = oneReadAtATime(async () => {
      throw new Error('it failed')
    })
    await expect(failing()).rejects.toThrow('it failed')
  })
})

describe('reads that ask or throw as they start', () => {
  it('a successful read that asks as it starts never puts a second read beside itself', async () => {
    let inFlight = 0
    let most = 0
    let calls = 0
    const ask = oneReadAtATime(async () => {
      calls += 1
      inFlight += 1
      most = Math.max(most, inFlight)
      if (calls === 1) void ask() // an announcement the read itself wakes, synchronously
      await Promise.resolve()
      inFlight -= 1
    })
    await ask()
    expect(most, 'two reads were in the air at once').toBe(1)
    expect(calls, 'the ask made during the read was owed and read').toBe(2)
  })

  it('a caller’s promise waits for the OWED read — not only for the one in flight', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    let settled = false
    const done = ask().then(() => {
      settled = true
    })
    g.change()
    void ask()
    await g.release()
    // the first read landed, a read is still owed — the caller has not been told yet
    expect(settled).toBe(false)
    await g.release()
    await done
    expect(settled).toBe(true)
  })

  it('a read that throws before its first await still hands the caller a promise that rejects', async () => {
    const ask = oneReadAtATime((() => {
      throw new Error('it threw at once')
    }) as unknown as () => Promise<void>)
    const outcome = ask()
    expect(outcome, 'the caller was handed no promise').toBeInstanceOf(Promise)
    await expect(outcome).rejects.toThrow('it threw at once')
  })
})

describe('a spaced read waits one read between back-to-back reads, and still reads the last ask', () => {
  /** A read that takes `ms` of fake time, counting its starts. */
  function timedReads(ms: number) {
    const starts: number[] = []
    const read = async (): Promise<void> => {
      starts.push(performance.now())
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
    return { read, starts }
  }
  const useClock = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })

  afterEach(() => vi.useRealTimers())

  it('an owed read starts one read duration after the read that was out ended', async () => {
    useClock()
    const timed = timedReads(400)
    const ask = oneReadAtATime(timed.read, { spaced: true })
    const done = ask(true)
    void ask(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(timed.starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(399)
    expect(timed.starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(timed.starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(400)
    await done
    expect(timed.starts).toHaveLength(2)
  })

  it('an ask that is not patient ends the wait and reads now', async () => {
    useClock()
    const timed = timedReads(400)
    const ask = oneReadAtATime(timed.read, { spaced: true })
    const done = ask(true)
    void ask(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(timed.starts).toHaveLength(1)
    void ask()
    await vi.advanceTimersByTimeAsync(0)
    expect(timed.starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(400)
    await done
  })

  it('an ask that is not patient while a read is out is read at once when it lands', async () => {
    useClock()
    const timed = timedReads(400)
    const ask = oneReadAtATime(timed.read, { spaced: true })
    const done = ask(true)
    void ask(true)
    void ask()
    await vi.advanceTimersByTimeAsync(400)
    expect(timed.starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(400)
    await done
  })

  it('a listener that hands over an event object is not patient', async () => {
    useClock()
    const timed = timedReads(400)
    const ask = oneReadAtATime(timed.read, { spaced: true }) as (event?: unknown) => Promise<void>
    const done = ask({ type: 'click' })
    void ask({ type: 'click' })
    await vi.advanceTimersByTimeAsync(400)
    expect(timed.starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(400)
    await done
  })

  it('asks that never stop get a bounded wait, and the final state is read', async () => {
    useClock()
    const log: { at: number; world: number }[] = []
    let world = 0
    const read = async (): Promise<void> => {
      log.push({ at: performance.now(), world })
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    const ask = oneReadAtATime(read, { spaced: true })
    // a change every 100 ms for 10 s, each one asked for
    for (let step = 0; step < 100; step += 1) {
      world += 1
      void ask(true)
      await vi.advanceTimersByTimeAsync(100)
    }
    const lastChangeAt = performance.now()
    await vi.advanceTimersByTimeAsync(2_000)
    // one read per 800 ms (400 reading + 400 waiting), not one per 400 ms (about 30)
    expect(log.length).toBeLessThanOrEqual(15)
    expect(log.length).toBeGreaterThanOrEqual(11)
    const last = log.at(-1)!
    expect(last.world).toBe(world)
    // the last change is read within one wait and one read of being asked
    expect(last.at - lastChangeAt).toBeLessThanOrEqual(800)
    // never more than one read's wait between reads while changes kept coming
    for (let i = 1; i < log.length; i += 1)
      expect(log[i]!.at - log[i - 1]!.at).toBeLessThanOrEqual(800)
  })

  it('the wait is capped, so a very long read does not hold the follow-up for as long', async () => {
    useClock()
    const timed = timedReads(20_000)
    const ask = oneReadAtATime(timed.read, { spaced: true })
    const done = ask(true)
    void ask(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(timed.starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(timed.starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(timed.starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(20_000)
    await done
  })

  it('a read made without the option is never spaced', async () => {
    useClock()
    const timed = timedReads(400)
    const ask = oneReadAtATime(timed.read)
    const done = ask(true)
    void ask(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(timed.starts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(400)
    await done
  })
})
