import { describe, expect, it } from 'vitest'
import {
  MEMORY_FLOOR_BYTES,
  MEMORY_STEP_BYTES,
  startMemoryWatch,
  type MemoryWatchOptions,
} from '../src/main/memory-watch'

/**
 * The watchdog 052 added because the incident it was dispatched for left no evidence at all: a
 * manual kill writes no crash report, the dev server's console was never captured, and the app's
 * own last database write was seven minutes before the growth started.
 *
 * What is pinned here is mostly what it does NOT do — a diagnostic that chatters in normal use is
 * one somebody turns off before the day it would have mattered.
 */
const GB = 1024 ** 3

/** Feed the watchdog one RSS reading per sample and return whatever it chose to say. */
function harness(samples: number[]): { logs: string[] } {
  const logs: string[] = []
  // An array rather than a `let`: the callback assigns it, which is a shape TypeScript narrows to
  // `never` at the call site.
  const registered: (() => void)[] = []
  const options: MemoryWatchOptions = {
    sample: () => samples.shift() ?? 0,
    log: (message) => logs.push(message),
    setInterval: (fn) => {
      registered.push(fn)
      return 1
    },
    clearInterval: () => {},
  }
  const watch = startMemoryWatch(options)
  const tick = registered[0]
  expect(tick, 'the watchdog must register a timer').toBeDefined()
  // Driven by hand, once per sample: the subject is the threshold arithmetic, not the clock.
  const count = samples.length
  for (let i = 0; i < count; i++) tick?.()
  watch.stop()
  return { logs }
}

describe('the main-process memory watchdog (052)', () => {
  it('says nothing at all in a healthy run', () => {
    // 0.9 GB is the measured idle figure and 0.72 GB the heaviest reproduction's peak. Both are
    // ordinary, and an ordinary run must produce no output.
    const { logs } = harness([0.4 * GB, 0.72 * GB, 0.9 * GB, 1.9 * GB])
    expect(logs).toEqual([])
  })

  it('reports once when it first crosses the floor', () => {
    const { logs } = harness([1.9 * GB, 2.1 * GB, 2.2 * GB, 2.9 * GB])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('2.10 GB')
    expect(logs[0]).toContain('heap snapshot')
  })

  it('carries the per-process breakdown, which is the fact the incident lacked', () => {
    // Nobody could say WHICH process held the 26 GB. A total with no breakdown would leave the
    // next report exactly as ambiguous.
    const logs: string[] = []
    const registered: (() => void)[] = []
    const watch = startMemoryWatch({
      sample: () => 3 * GB,
      detail: () => 'Browser:0.4GB Tab:2.6GB',
      log: (m) => logs.push(m),
      setInterval: (fn) => {
        registered.push(fn)
        return 1
      },
      clearInterval: () => {},
    })
    registered[0]?.()
    watch.stop()
    expect(logs[0]).toContain('Tab:2.6GB')
  })

  it('reports each further gigabyte, so the log shows the shape of the climb', () => {
    const { logs } = harness([2.1 * GB, 3.2 * GB, 4.5 * GB, 26 * GB])
    expect(logs).toHaveLength(4)
    // Every reading, not just the count and the last one: an arithmetic bug that reported the
    // THRESHOLD instead of the reading would still produce four lines ending at 26 GB.
    expect(logs[0]).toContain('2.10 GB')
    expect(logs[1]).toContain('3.20 GB')
    expect(logs[2]).toContain('4.50 GB')
    expect(logs[3]).toContain('26.00 GB')
  })

  it('does not re-report an oscillation across one boundary', () => {
    // The same episode wobbling over a threshold is not news, and repeating it would bury the
    // climb the log exists to show.
    const { logs } = harness([2.1 * GB, 1.5 * GB, 2.2 * GB, 1.4 * GB, 2.3 * GB])
    expect(logs).toHaveLength(1)
  })

  it('uses a floor above anything this app has been measured doing', () => {
    expect(MEMORY_FLOOR_BYTES).toBeGreaterThan(GB) // idle is 0.9 GB
    expect(MEMORY_STEP_BYTES).toBe(GB)
  })
})
