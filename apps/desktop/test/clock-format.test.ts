import { describe, expect, it, vi } from 'vitest'
import { fullTime } from '../src/renderer/src/lib/clock'
// ⚑ D-017 · R11 — `clockTime` moved to `shared/clock.ts`, so `main` says a time as the window draws it.
import { clockTime } from '../src/shared/clock'

/**
 * 255 · **One formatter, not five thousand.**
 *
 * ⛔ **`212` recorded *"opening Events at the cap synchronously mounts every row — 148-171 ms"* and
 * attributed it to the row count.** Measured in Chromium on that exact corpus, by
 * `pnpm run probe:event-fold`: `describeEvent`, the other per-row string builder, costs **under a
 * millisecond** for 5,000 events; `clockTime` as shipped cost **140-146 ms**, and the same 5,000
 * through a REUSED `Intl.DateTimeFormat` cost **3.8-4.0 ms**. So the number in the ticket was not
 * five thousand rows paying for five elements each — it was one `Intl.DateTimeFormat` constructed
 * five thousand times, inside `Date.prototype.toLocaleTimeString`.
 *
 * ⚠️ **Nothing here is a TIMING assertion**, because a timing assertion in the gate is a machine
 * report rather than a claim about the app. The two things worth pinning are exact and cheap: that
 * the output did not change, and that the formatter is built once.
 *
 * ⛔ **What the second of those cannot see, said plainly.** `Date.prototype.toLocaleTimeString`
 * builds its formatter from the INTRINSIC `%DateTimeFormat%`, which a spy on the global cannot
 * reach — so this file cannot count the five thousand the old code made. What it does is narrower
 * and is the thing worth guarding: a revert to the `Date` methods in `clockTime` reads as ONE
 * construction through the global — `fullTime` still makes its own — and a memo lost from
 * `clockTime` reads as a thousand and one. Both redden `toBe(2)`; neither reads as 0 or 2,000, and
 * the exact numbers are what `255`'s mutation table publishes for `M19`/`M20`.
 */

/** A handful of instants that exercise midnight, noon, a minute boundary and a leap day. */
const INSTANTS = [
  0,
  1_700_000_000_000,
  Date.UTC(2024, 1, 29, 12, 0, 0),
  Date.UTC(2024, 6, 4, 23, 59, 59),
  Date.UTC(2025, 11, 31, 0, 0, 0),
  Date.UTC(2026, 2, 29, 1, 30, 0),
]

describe('the clock still says exactly what it said', () => {
  it('⛔ `clockTime` is byte-identical to the `Date` method it replaced', () => {
    for (const at of INSTANTS) {
      expect(clockTime(at), `at ${at}`).toBe(
        new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      )
    }
    // ⚑ Non-vacuity: the equality above would hold if both sides returned the empty string.
    expect(clockTime(INSTANTS[1]!)).toMatch(/\d/)
  })

  /**
   * ⛔ **The option list is spelled out in `clock.ts` because the two APIs do not default alike.**
   * `toLocaleString()` resolves through `ToDateTimeOptions(…, "any", "all")` and yields
   * year/month/day/hour/minute/second; `new Intl.DateTimeFormat(locale)` defaults to `"date"` and
   * would have dropped the time silently. This is the assertion that makes that a red rather than a
   * tooltip nobody reads.
   */
  it('⛔ `fullTime` is byte-identical too, seconds and all', () => {
    for (const at of INSTANTS) {
      expect(fullTime(at), `at ${at}`).toBe(new Date(at).toLocaleString())
    }
    expect(fullTime(INSTANTS[1]!)).toMatch(/\d.*\d.*\d/)
  })

  /**
   * ⛔ **`8.64e15 + 1` is the case the first draft of this list could not see, and it was a real
   * defect.** Every value the draft held was NON-finite, so `Number.isFinite` covered all of them —
   * and the one class where the two APIs diverge is a FINITE time value out of `Date`'s range:
   * `toLocaleTimeString` answers `"Invalid Date"`, `Intl.DateTimeFormat.format` throws a
   * `RangeError`. A bundle carrying `9e15` would have thrown inside a Vue render. Found by the
   * adversarial pass over 255's diff; `clock.ts`'s guard widened to cover it.
   */
  it('⚠️ and a moment that is not one is still the empty string', () => {
    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -Number.MAX_VALUE * 2,
      8.64e15 + 1,
      -8.64e15 - 1,
      9e15,
    ]) {
      expect(clockTime(value), `clockTime(${String(value)})`).toBe('')
      expect(fullTime(value), `fullTime(${String(value)})`).toBe('')
    }
    // ⚑ The boundary itself is a real moment and must still format — otherwise the guard above
    // could be `return ''` and this whole test would pass.
    expect(clockTime(8.64e15)).not.toBe('')
    expect(fullTime(-8.64e15)).not.toBe('')
  })
})

describe('the formatter is built once (255)', () => {
  it('⛔ a thousand calls construct ONE `Intl.DateTimeFormat` per format', async () => {
    vi.resetModules()
    const Real = Intl.DateTimeFormat
    let built = 0
    // ⚠️ A `function`, not an arrow: the module under test says `new Intl.DateTimeFormat(…)`, and an
    // arrow is not constructable. A constructor that returns an object returns THAT object, so the
    // real formatter is what the caller gets.
    function Counting(
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ): Intl.DateTimeFormat {
      built++
      return new Real(...args)
    }
    const spy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(Counting as unknown as typeof Intl.DateTimeFormat)

    try {
      // ⚑ The counter's own positive control, so an assertion of "2" cannot be a spy that counts
      // nothing. Without this, a `mockImplementation` that stopped being called would read as a
      // perfectly memoised module.
      new Intl.DateTimeFormat()
      new Intl.DateTimeFormat()
      expect(built).toBe(2)
      built = 0

      const fresh = await import('../src/renderer/src/lib/clock')
      const freshClock = await import('../src/shared/clock')
      for (let i = 0; i < 1_000; i++) {
        freshClock.clockTime(1_700_000_000_000 + i * 61_000)
        fresh.fullTime(1_700_000_000_000 + i * 61_000)
      }
      // One for the clock, one for the tooltip — and not two thousand.
      expect(built).toBe(2)
    } finally {
      spy.mockRestore()
      vi.resetModules()
    }
  })
})
