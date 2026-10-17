import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  MINUTE_MS,
  msUntilNextMinute,
  useMinuteClock,
} from '../src/renderer/src/composables/useMinuteClock'

/**
 * 211 §5 · **Home's "LOCAL TIME" was a navigation-time snapshot** (from 210 finding 6).
 *
 * > *"I opened Home at 00:43 and left it untouched. At 00:46 it still displayed 00:43. Navigating to
 * > a conversation and back refreshed it immediately to 00:46."*
 *
 * ⚑ **The smallest of the five, and the one that teaches a user not to trust the bigger ones** — a
 * clock is the one number on a screen that everybody can check.
 *
 * ⚑ **D-016 · Home and the seed's fixtures are deleted**, so the render half (the local-time stat,
 * and the fixture rows dated by the seed's own instant) went with them. The clock itself stays: the
 * rail, the session panel, the work shelf and the conversation's cast band still read it.
 */

describe('when the displayed minute stops being true', () => {
  it('is the distance to the next boundary, not a fixed interval', () => {
    expect(msUntilNextMinute(0)).toBe(MINUTE_MS)
    expect(msUntilNextMinute(MINUTE_MS - 1)).toBe(1)
    expect(msUntilNextMinute(MINUTE_MS + 20_000)).toBe(40_000)
  })

  it('⛔ a boundary exactly NOW is a whole minute away, never zero', () => {
    // Returning 0 would schedule a timeout that fires immediately, re-reads the same minute and
    // schedules another — a spin, on the surface whose whole point is that it costs nothing.
    for (const at of [0, MINUTE_MS, MINUTE_MS * 12_345]) {
      expect(msUntilNextMinute(at)).toBe(MINUTE_MS)
    }
  })

  it('never asks for more than a minute or less than a tick', () => {
    for (let ms = 0; ms < MINUTE_MS; ms += 997) {
      const wait = msUntilNextMinute(ms)
      expect(wait).toBeGreaterThan(0)
      expect(wait).toBeLessThanOrEqual(MINUTE_MS)
    }
  })
})

describe('the clock itself', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('⛔ THE BUG: it moves while nobody touches it', () => {
    let wall = MINUTE_MS * 10 + 43_000
    const scope = effectScope()
    const clock = scope.run(() => useMinuteClock(() => wall))!

    expect(clock.value).toBe(wall)

    // Three minutes pass with no navigation, no click, nothing.
    for (let i = 0; i < 3; i += 1) {
      wall += MINUTE_MS
      vi.advanceTimersByTime(MINUTE_MS)
    }
    expect(clock.value).toBe(wall)
    scope.stop()
  })

  it('lands ON the rollover: one change per minute, not one per second', () => {
    let wall = MINUTE_MS * 10 + 43_000
    const scope = effectScope()
    const clock = scope.run(() => useMinuteClock(() => wall))!

    // Every value the ref ever holds over three minutes of one-second steps. A `setInterval` short
    // enough to keep the minute honest would put 180 of them here; the boundary schedule puts 4 —
    // the one it started with, and one per rollover.
    const seen = new Set<number>([clock.value])
    for (let step = 0; step < 180; step += 1) {
      wall += 1_000
      vi.advanceTimersByTime(1_000)
      seen.add(clock.value)
    }
    expect(seen.size).toBe(4)
    // …and each change landed exactly on a boundary, which is what makes one-per-minute enough.
    for (const at of seen) expect(at % MINUTE_MS === 0 || at === MINUTE_MS * 10 + 43_000).toBe(true)
    scope.stop()
  })

  it('⛔ stops with the scope that owns it — a timer past its surface is 099’s cost', () => {
    let wall = MINUTE_MS * 10
    const scope = effectScope()
    const clock = scope.run(() => useMinuteClock(() => wall))!

    scope.stop()
    wall += MINUTE_MS * 5
    vi.advanceTimersByTime(MINUTE_MS * 5)

    expect(clock.value).toBe(MINUTE_MS * 10)
    expect(vi.getTimerCount()).toBe(0)
  })
})
