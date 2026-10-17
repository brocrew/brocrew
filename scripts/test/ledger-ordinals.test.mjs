import { describe, expect, it } from 'vitest'
import { assertGapFree } from '../lib/ledger-ordinals.mjs'

/**
 * ⛔ **196 H3, from 193: the "gap-free" claim that could not see a gap.**
 *
 * `ui-live-smoke.mjs` step 27 archives 2,500 frames, exports them and reported *"ordinals
 * gap-free"* — on a test that rejected only `n <= previous`. The exact shape it claimed to exclude
 * (a window that dropped one entry) is strictly increasing, so it passed; so did an empty ledger.
 *
 * ⚑ **The first two tests are the finding and its paired positive on the SAME sequence** — the gap
 * is one missing value in an otherwise perfect run of 2,500, which is what the step really produces.
 */
describe('assertGapFree (196 H3)', () => {
  const run = (from, count) => Array.from({ length: count }, (_, i) => from + i)

  it('⛔ catches the hole an increasing sequence can hide — the case that used to pass', () => {
    const withHole = [...run(0, 1_000), ...run(1_001, 1_499)] // 2,499 entries, ordinal 1000 missing
    expect(
      withHole.every((n, i) => i === 0 || n > withHole[i - 1]),
      'still increasing',
    ).toBe(true)
    expect(() => assertGapFree(withHole, 'the exported bundle ledger')).toThrow(
      /1 ordinal\(s\) are missing/,
    )
    // The failure names WHERE, because "there is a gap" in 2,500 entries sends nobody anywhere.
    expect(() => assertGapFree(withHole, 'the exported bundle ledger')).toThrow(/0\.\.2499/)
  })

  it('⚑ the paired positive — the same run with nothing missing passes and says what it saw', () => {
    expect(assertGapFree(run(0, 2_500), 'the exported bundle ledger')).toBe(
      '2500 entries, ordinals 0..2499, gap-free',
    )
    // …and a window that legitimately does not begin at zero is not called broken for it.
    expect(assertGapFree(run(1_200, 300), 'a window')).toBe(
      '300 entries, ordinals 1200..1499, gap-free',
    )
  })

  it('an EMPTY ledger is not gap-free — it is nothing, and `some` was false over it', () => {
    expect(() => assertGapFree([], 'the exported bundle ledger')).toThrow(/no entries at all/)
  })

  it('still catches what the old check did catch: a repeat and a step backwards', () => {
    expect(() => assertGapFree([0, 1, 1, 2], 'x')).toThrow(/not strictly increasing/)
    expect(() => assertGapFree([0, 1, 5, 4], 'x')).toThrow(/5 is followed by 4 at entry 3/)
  })

  it('refuses a non-integer ordinal rather than doing arithmetic on it', () => {
    // `undefined` is what `bundle.ledger.map((e) => e.ordinal)` yields if the field is ever renamed,
    // and `last - first + 1` over it is `NaN` — which compares false against everything and would
    // have thrown a confusing error instead of naming the entry.
    expect(() => assertGapFree([0, 1, undefined], 'x')).toThrow(/entry 2 has a non-integer ordinal/)
  })
})
