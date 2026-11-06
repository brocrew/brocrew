import { describe, expect, it } from 'vitest'
import { budgetClock } from '../lib/step-budget.mjs'

describe('the clock the step spends', () => {
  it('hands out the smaller of the wish and what is left, and throws the step’s own expiry at zero', () => {
    let now = 1_000
    const budget = budgetClock({
      deadlineAt: 5_000,
      expire: () => new Error('the step deadline'),
      now: () => now,
    })
    expect(budget(10_000)).toBe(4_000)
    expect(budget(1_000)).toBe(1_000)
    now = 5_000
    expect(() => budget(1)).toThrow('the step deadline')
  })
})
