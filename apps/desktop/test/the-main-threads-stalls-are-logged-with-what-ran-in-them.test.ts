import { describe, expect, it } from 'vitest'
import {
  MainThreadWork,
  WhatTheAppWasDoing,
  aRunSays,
  aStallSays,
  startStallWatch,
  startWatchHealth,
  timedMethods,
  watchHealthSays,
  type StallWatch,
} from '../src/main/stall-watch'

/**
 * # The stall recorder · a late tick is logged with the work that ran in it
 *
 * `stall-watch.ts` takes its clock, its CPU reading, its interval and its deferral as options, so
 * every rule below runs on a fake clock with no timer and no garbage collector. No other test
 * imports the file.
 *
 * | § | what it pins | why the existing tests do not reach it |
 * |---|---|---|
 * | 1 | a tick late by under the floor is not a stall; at the floor it is | nothing drives `startStallWatch` |
 * | 2 | a late tick with little CPU is a wait, logged as one with its work; a sleep or a window out of sight during it is only counted | same |
 * | 3 | work timed during a quiet tick is forgotten, so the next stall names only its own work | same |
 * | 4 | a stall's line names at most six kinds of work, longest first, none under a millisecond, and says how often a repeated one ran | nothing calls `take()` or `aStallSays` |
 * | 5 | the line says most of the stall ran outside the timed work only when the longest total covers under half of it; collection time counts as cover | same |
 * | 6 | a timed method that throws is still counted; a non-method property comes back as is; each method has one wrapper | nothing calls `timedMethods` |
 * | 7 | the health line counts ticks, stalls and waits per period, says when the watch stopped ticking, and runs on its own timer | nothing reads the counts |
 * | 8 | after nine hours the watch still counts and logs; a log that throws does not stop it | same |
 * | 9 | ticks each late by less than the floor, back to back, are one run, logged when they add up to the floor | nothing logged them |
 *
 * Which collections fall inside a stall's window is not pinned: the watch reads them from the
 * runtime's own `PerformanceObserver`, which a test cannot feed. Writing `stalls.log` goes through
 * Electron's `app` and is not pinned either.
 */

const TICK = 100
const FLOOR = 500

/** A watch on a fake clock: `advance` moves time and CPU, then fires the one tick. */
function aWatch(
  options: {
    lifecycle?: (now: () => number) => WhatTheAppWasDoing
    log?: (line: string) => void
    later?: (run: () => void) => void
  } = {},
): {
  work: MainThreadWork
  lines: string[]
  advance: (ms: number, cpuMs: number) => void
  stop: () => void
  cleared: unknown[]
  watch: StallWatch
  lifecycle: WhatTheAppWasDoing | undefined
  now: () => number
  /** Move the clock without a tick. */
  wait: (ms: number) => void
} {
  let at = 0
  let cpuMicros = 0
  let tick: (() => void) | undefined
  const lines: string[] = []
  const cleared: unknown[] = []
  const work = new MainThreadWork(() => at)
  const lifecycle = options.lifecycle?.(() => at)
  const watch = startStallWatch({
    work,
    log: options.log ?? ((line) => lines.push(line)),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    now: () => at,
    cpuMicros: () => cpuMicros,
    tickMs: TICK,
    floorMs: FLOOR,
    setInterval: (run) => {
      tick = run
      return 'the-handle'
    },
    clearInterval: (handle) => cleared.push(handle),
    later: options.later ?? ((run) => run()),
    observeGc: false,
  })
  return {
    work,
    lines,
    cleared,
    stop: () => watch.stop(),
    watch,
    lifecycle,
    now: () => at,
    wait: (ms) => {
      at += ms
    },
    advance: (ms, cpuMs) => {
      at += ms
      cpuMicros += cpuMs * 1000
      if (tick === undefined) throw new Error('the watch never set its interval')
      tick()
    },
  }
}

const OUTSIDE = 'most of it ran outside the timed work'

function tally(
  what: string,
  ms: number,
): { what: string; count: number; ms: number; longest: number } {
  return { what, count: 1, ms, longest: ms }
}

describe('§1 · the floor: a stall is a tick late by the floor or more', () => {
  it('⛔ late by one millisecond under the floor → nothing logged; ⚑ late by exactly the floor → one line', () => {
    const watch = aWatch()
    watch.advance(TICK + FLOOR - 1, TICK + FLOOR - 1)
    watch.advance(TICK, TICK)
    expect(watch.lines).toEqual([])

    watch.advance(TICK + FLOOR, TICK + FLOOR)
    expect(watch.lines).toHaveLength(1)
    expect(watch.lines[0]).toMatch(/^main thread blocked for up to 600 ms; frozen; /)
  })

  it('⚑ stopping the watch clears the interval it was handed', () => {
    const watch = aWatch()
    watch.stop()
    expect(watch.cleared).toEqual(['the-handle'])
  })
})

it('records a measured main-thread block as frozen, apart from hidden-page starvation', () => {
  const watch = aWatch()
  watch.work.timed('command start', () => watch.wait(700))
  watch.advance(100, 800)
  expect(watch.lines).toEqual([
    'main thread blocked for up to 800 ms; frozen; during it: command start 700 ms',
  ])
  expect(watch.lines.join('\n')).not.toContain('starved')
})

describe('§2 · a late tick with little CPU is a wait, unless the system paused it', () => {
  it('⚑ late by 2000 ms with 100 ms of CPU → a wait; ⚑ with 1900 ms of CPU → a stall', () => {
    const watch = aWatch()
    watch.advance(TICK + 2000, 100)
    expect(watch.lines).toEqual([
      `main thread waited up to 2100 ms using 100 ms of CPU; no timed work ran in it; ${OUTSIDE} (event delivery or a timer)`,
    ])

    watch.advance(TICK + 2000, 1900)
    expect(watch.lines).toHaveLength(2)
    expect(watch.lines[1]).toMatch(/^main thread blocked for up to 2100 ms; frozen; /)
  })

  it('⚑ a named 1,900 ms wait with little CPU is logged with its work', () => {
    const watch = aWatch()
    watch.work.add('command start', 1900)
    watch.advance(TICK + 1900, 50)
    expect(watch.lines).toEqual([
      'main thread waited up to 2000 ms using 50 ms of CPU; during it: command start 1900 ms',
    ])
  })

  it('⛔ a low-CPU gap the computer slept in, or the window was out of sight in, is counted, not logged; ⚑ one after they ended is logged', () => {
    const watch = aWatch({ lifecycle: (now) => new WhatTheAppWasDoing(true, now) })
    const lifecycle = watch.lifecycle as WhatTheAppWasDoing
    lifecycle.asleep()
    watch.advance(TICK + 5000, 10)
    lifecycle.awake()
    watch.advance(TICK, TICK)
    lifecycle.outOfSight()
    watch.advance(TICK + 3000, 10)
    lifecycle.inSight()
    watch.advance(TICK, TICK)
    expect(watch.lines).toEqual([])
    expect(watch.watch.takeCounts()).toMatchObject({ asleep: 1, outOfSight: 1, waits: 0 })

    watch.advance(TICK + 2000, 100)
    expect(watch.lines).toHaveLength(1)
    expect(watch.lines[0]).toMatch(/^main thread waited up to 2100 ms/)
  })

  it('⛔ a window hidden after the gap, before its line is written, does not excuse it', () => {
    const pending: (() => void)[] = []
    const watch = aWatch({
      lifecycle: (now) => new WhatTheAppWasDoing(true, now),
      later: (run) => pending.push(run),
    })
    watch.advance(TICK + 2000, 100)
    watch.wait(10)
    ;(watch.lifecycle as WhatTheAppWasDoing).outOfSight()
    for (const run of pending.splice(0)) run()
    expect(watch.lines).toHaveLength(1)
  })

  it('⚑ a wait that begins as the window comes into sight is logged', () => {
    const watch = aWatch({ lifecycle: (now) => new WhatTheAppWasDoing(false, now) })
    watch.advance(TICK, TICK)
    ;(watch.lifecycle as WhatTheAppWasDoing).inSight()
    watch.advance(TICK + 2000, 100)
    expect(watch.lines).toHaveLength(1)
    expect(watch.lines[0]).toMatch(/^main thread waited up to 2100 ms/)
  })

  it('⛔ a window out of sight from the start excuses its gaps until it is shown', () => {
    const watch = aWatch({ lifecycle: (now) => new WhatTheAppWasDoing(false, now) })
    watch.advance(TICK + 2000, 100)
    expect(watch.lines).toEqual([])
    ;(watch.lifecycle as WhatTheAppWasDoing).inSight()
    watch.advance(TICK, TICK)
    watch.advance(TICK + 2000, 100)
    expect(watch.lines).toHaveLength(1)
  })
})

describe('§3 · work from a quiet tick is not blamed on the next stall', () => {
  it('⛔ work timed before a quiet tick is absent from the stall; ⚑ work timed after it is named', () => {
    const watch = aWatch()
    watch.work.add('old', 50)
    watch.advance(TICK, TICK)
    expect(watch.lines).toEqual([])

    watch.work.add('new', 600)
    watch.advance(TICK + 1000, 1000)
    expect(watch.lines).toHaveLength(1)
    expect(watch.lines[0]).toContain('during it: new 600 ms')
    expect(watch.lines[0]).not.toContain('old')
  })
})

describe('§4 · the line names the worst first, at most six, none under a millisecond', () => {
  it('⚑ eight tallies from take() → the six longest, longest first, a repeat with its count; ⛔ the seventh and the sub-millisecond one are absent', () => {
    const work = new MainThreadWork(() => 0)
    work.add('b', 20)
    work.add('tiny', 0.4)
    work.add('e', 50)
    work.add('x', 25)
    work.add('g', 10)
    work.add('c', 30)
    work.add('f', 60)
    work.add('x', 45)
    work.add('d', 40)

    const taken = work.take()
    expect(taken.map((one) => one.what)).toEqual(['x', 'f', 'e', 'd', 'c', 'b', 'g', 'tiny'])
    expect(aStallSays(1000, taken)).toBe(
      'main thread blocked for up to 1000 ms; frozen; during it: x 70 ms (2×, longest 45 ms), f 60 ms, ' +
        'e 50 ms, d 40 ms, c 30 ms, b 20 ms; ' +
        `${OUTSIDE} (event delivery or a timer)`,
    )
    expect(work.take()).toEqual([])
  })

  it('⛔ a tally under a millisecond is left out even when there is room; ⚑ one of a millisecond is named', () => {
    expect(aStallSays(10, [tally('one', 1), tally('tiny', 0.4)])).toBe(
      'main thread blocked for up to 10 ms; frozen; during it: one 1 ms; ' +
        `${OUTSIDE} (event delivery or a timer)`,
    )
  })
})

describe('§5 · "most of it ran outside the timed work"', () => {
  it('⚑ timed work covering 400 of 1000 ms → said; ⛔ covering 500 or 600 → not said', () => {
    expect(aStallSays(1000, [tally('a', 400)])).toContain(OUTSIDE)
    expect(aStallSays(1000, [tally('a', 500)])).not.toContain(OUTSIDE)
    expect(aStallSays(1000, [tally('a', 600)])).not.toContain(OUTSIDE)
  })

  it('⛔ no timed work but 600 ms of collection → not said, and the collection is named; ⚑ no work and no collection → said', () => {
    expect(aStallSays(1000, [], 600)).toBe(
      'main thread blocked for up to 1000 ms; frozen; during it: garbage collection 600 ms',
    )
    expect(aStallSays(1000, [])).toBe(
      `main thread blocked for up to 1000 ms; frozen; no timed work ran in it; ${OUTSIDE} (event delivery or a timer)`,
    )
  })

  it('⛔ collection under a millisecond is not named; ⚑ one of a millisecond is', () => {
    expect(aStallSays(1000, [tally('a', 600)], 0.4)).not.toContain('garbage collection')
    expect(aStallSays(1000, [tally('a', 600)], 1)).toContain('garbage collection 1 ms')
  })
})

describe('§6 · timedMethods', () => {
  function aTimedStore() {
    let at = 0
    const work = new MainThreadWork(() => at)
    const target = {
      size: 3,
      boom(): never {
        at += 7
        throw new Error('boom')
      },
      double(n: number): number {
        at += 3
        return n * 2
      },
    }
    return { work, store: timedMethods(target, 'store', work) }
  }

  it('⚑ a method that returns is counted under its name; ⛔ one that throws is counted too', () => {
    const { work, store } = aTimedStore()
    expect(store.double(5)).toBe(10)
    expect(() => store.boom()).toThrow('boom')
    expect(work.take()).toEqual([
      { what: 'store.boom', count: 1, ms: 7, longest: 7 },
      { what: 'store.double', count: 1, ms: 3, longest: 3 },
    ])
  })

  it('⚑ a property that is not a method comes back as is; ⚑ each method has one wrapper, read twice', () => {
    const { work, store } = aTimedStore()
    expect(store.size).toBe(3)
    expect(store.double).toBe(store.double)
    expect(work.take()).toEqual([])
  })
})

describe('§7 · the health line', () => {
  it('⚑ counts ticks, stalls and waits in the period, then starts afresh', () => {
    const watch = aWatch()
    watch.advance(TICK, TICK)
    watch.advance(TICK + 2000, 1900)
    watch.advance(TICK + 1000, 10)
    const counts = watch.watch.takeCounts()
    expect(counts).toMatchObject({ ticks: 3, stalls: 1, waits: 1, longestLateMs: 2000 })
    expect(watchHealthSays(counts, 600_000, watch.now())).toBe(
      'the stall watch ticked 3 times in the last 10 min: 1 stall, 1 wait, 0 late while asleep or out of sight; longest late tick 2000 ms',
    )
    expect(watch.watch.takeCounts()).toMatchObject({ ticks: 0, stalls: 0, waits: 0 })
  })

  it('⛔ a watch that did not tick says so, and when it last did', () => {
    expect(
      watchHealthSays(
        {
          ticks: 0,
          stalls: 0,
          waits: 0,
          asleep: 0,
          outOfSight: 0,
          longestLateMs: 0,
          lastTickAt: 1_000,
        },
        600_000,
        601_000,
      ),
    ).toBe('the stall watch did not tick in the last 10 min; it last ticked 600 s ago')
  })

  it('⚑ runs on a timer of its own, adds what else it is given, and outlives a throwing addition', () => {
    const watch = aWatch()
    const lines: string[] = []
    let run: (() => void) | undefined
    let pageSays: () => string | null = () => 'the page reported 3 times'
    startWatchHealth({
      watch: watch.watch,
      log: (line) => lines.push(line),
      andAlso: () => pageSays(),
      now: watch.now,
      everyMs: 600_000,
      setInterval: (tick) => {
        run = tick
        return 'health'
      },
    })
    watch.advance(TICK, TICK)
    run?.()
    expect(lines[0]).toMatch(/^the stall watch ticked 1 times .*; the page reported 3 times$/)
    pageSays = () => {
      throw new Error('no page')
    }
    run?.()
    expect(lines[1]).toMatch(
      /^the stall watch did not tick in the last 10 min; it last ticked 0 s ago$/,
    )
  })
})

describe('§8 · nine hours on', () => {
  it('⚑ after nine hours of quiet ticks a stall is still logged and counted', () => {
    const watch = aWatch()
    for (let tick = 0; tick < (9 * 3_600_000) / TICK; tick++) watch.advance(TICK, 1)
    watch.advance(TICK + 800, 800)
    expect(watch.lines).toHaveLength(1)
    expect(watch.watch.takeCounts()).toMatchObject({ ticks: 324_001, stalls: 1 })
  })

  it('⛔ a log that throws loses its line, not the watch', () => {
    let calls = 0
    const watch = aWatch({
      log: () => {
        calls += 1
        throw new Error('disk full')
      },
    })
    watch.advance(TICK + 1000, 1000)
    watch.advance(TICK + 1000, 1000)
    expect(calls).toBe(2)
    expect(watch.watch.takeCounts()).toMatchObject({ stalls: 2 })
  })
})

describe('§9 · a run of late ticks', () => {
  it('⚑ three blocks of 450 ms back to back, with their work → one run line when a tick comes on time', () => {
    const watch = aWatch()
    for (let block = 0; block < 3; block++) {
      watch.work.add('command listResumable', 450)
      watch.advance(TICK + 450, 450)
    }
    expect(watch.lines).toEqual([])
    watch.advance(TICK, TICK)
    expect(watch.lines).toEqual([
      aRunSays(1650, 3, 1350, 1350, [
        { what: 'command listResumable', count: 3, ms: 1350, longest: 450 },
      ]),
    ])
    expect(watch.lines[0]).toBe(
      'main thread fell behind 3 times in a row over 1650 ms, 1350 ms late in all, using 1350 ms of CPU; during it: command listResumable 1350 ms (3×, longest 450 ms)',
    )
  })

  it('⛔ late ticks that never add up to the floor are nobody’s: no line, and their work is forgotten', () => {
    const watch = aWatch()
    watch.work.add('small', 200)
    watch.advance(TICK + 200, 200)
    watch.advance(TICK + 200, 200)
    watch.advance(TICK, TICK)
    expect(watch.lines).toEqual([])
    watch.work.add('later', 700)
    watch.advance(TICK + 700, 700)
    expect(watch.lines).toEqual([
      'main thread blocked for up to 800 ms; frozen; during it: later 700 ms',
    ])
  })

  it('⚑ a run that ends in a stall is one line over the whole span', () => {
    const watch = aWatch()
    watch.advance(TICK + 300, 300)
    watch.advance(TICK + 600, 600)
    expect(watch.lines).toEqual([
      `main thread fell behind 2 times in a row over 1100 ms, 900 ms late in all, using 900 ms of CPU; no timed work ran in it; ${OUTSIDE} (event delivery or a timer)`,
    ])
  })

  it('⚑ a run with little CPU is a wait, and the computer sleeping through it excuses it', () => {
    const watch = aWatch({ lifecycle: (now) => new WhatTheAppWasDoing(true, now) })
    watch.advance(TICK + 300, 10)
    watch.advance(TICK + 300, 10)
    watch.advance(TICK, TICK)
    expect(watch.lines).toEqual([
      `main thread fell behind 2 times in a row over 800 ms, 600 ms late in all, using 20 ms of CPU; no timed work ran in it; ${OUTSIDE} (event delivery or a timer)`,
    ])
    ;(watch.lifecycle as WhatTheAppWasDoing).asleep()
    watch.advance(TICK + 300, 10)
    watch.advance(TICK + 300, 10)
    ;(watch.lifecycle as WhatTheAppWasDoing).awake()
    watch.advance(TICK, TICK)
    expect(watch.lines).toHaveLength(1)
  })
})
