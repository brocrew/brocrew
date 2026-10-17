import { describe, expect, it } from 'vitest'
import { CurrentProviderLimitFacts } from '../src/main/runtime/current-provider-limit-facts'
import type { ProviderLimitSeen } from '../src/shared/provider-limit'
import type { LedgerWalk } from '../src/shared/questions'

const AT = Date.UTC(2026, 9, 8, 21)
const RESET = AT + 3 * 60 * 60_000
const wall = (resetsAt: number | null): ProviderLimitSeen => ({
  provider: 'claude',
  window: 'five_hour',
  standing: 'stopped',
  resetsAt,
  at: AT,
  said: 'fictional limit',
})
const walk = (rows: readonly ProviderLimitSeen[]): LedgerWalk<ProviderLimitSeen> => ({
  walk: 'every-provider-wall-recently-recorded',
  rows,
  rowsUnread: 0,
  ledgers: rows.length,
})

function stopped(resetsAt: number | null = RESET) {
  const facts = new CurrentProviderLimitFacts()
  const life = {}
  facts.begin('fictional', life, 'claude', true)
  facts.observe(
    'fictional',
    life,
    'claude',
    {
      type: 'error',
      message: 'claude is rate-limited (five_hour)',
      fatal: false,
    },
    AT,
  )
  facts.prepare(walk([wall(resetsAt)]), AT + 1, AT + 2)
  const history = (now = AT + 3) => facts.lastKnown('fictional', life, 'claude', false, now)
  expect(facts.block('fictional', life, 'claude', false, false, AT + 3)).toEqual({
    status: 'current',
    value: { provider: 'claude', resetsAt },
  })
  return { facts, life, history }
}

describe('historical provider stops carry no current or admission authority', () => {
  it('requires a prior complete confirmation of this own life, never a global warning', () => {
    const facts = new CurrentProviderLimitFacts()
    const life = {}
    facts.begin('fictional', life, 'claude', true)
    facts.prepare(walk([wall(RESET)]), AT)
    expect(facts.lastKnown('fictional', life, 'claude', false, AT)).toBeNull()
    facts.observe(
      'fictional',
      life,
      'claude',
      {
        type: 'error',
        message: 'claude is rate-limited (five_hour)',
        fatal: false,
      },
      AT,
    )
    facts.prepare({ ...walk([wall(RESET)]), rowsUnread: 1 }, AT)
    expect(facts.lastKnown('fictional', life, 'claude', false, AT)).toBeNull()
  })

  it('retains the original date through rejected preparations and retires at the known reset', () => {
    const { facts, life, history } = stopped()
    facts.invalidate()
    const original = { provider: 'claude', resetsAt: RESET, asOf: AT + 1 }
    expect(history()).toEqual(original)
    facts.gate('claude', RESET, AT + 3)
    expect(history(RESET - 1)).toEqual(original)
    expect(history(RESET)).toBeNull()
    expect(facts.block('fictional', life, 'claude', false, false, RESET)).toEqual({
      status: 'unavailable',
    })
  })

  it('unknown reset expires five minutes from confirmation, without expiring a valid current fact', () => {
    const { facts, life, history } = stopped(null)
    const end = AT + 1 + 5 * 60_000
    expect(history(end - 1)).toMatchObject({ asOf: AT + 1, resetsAt: null })
    expect(history(end)).toBeNull()
    expect(facts.block('fictional', life, 'claude', false, false, end)).toEqual({
      status: 'current',
      value: { provider: 'claude', resetsAt: null },
    })
    facts.prepare(walk([wall(null)]), end + 1)
    expect(history(end + 1)).toBeNull()
  })

  it('newer complete canonical contradiction retires history with current unavailable and gate unchanged', () => {
    const { facts, life, history } = stopped()
    facts.invalidate()
    facts.gate('claude', RESET, AT + 3)
    const gate = facts.hold('claude', false, AT + 4)
    expect(history(AT + 4)).not.toBeNull()
    expect(facts.retireUnsupportedHistory(walk([]), AT + 120_000, AT + 120_001)).toBe(true)
    expect(history(AT + 120_002)).toBeNull()
    expect(facts.block('fictional', life, 'claude', false, false, AT + 120_002)).toEqual({
      status: 'unavailable',
    })
    expect(facts.hold('claude', false, AT + 120_002)).toEqual(gate)
    facts.prepare(walk([wall(RESET)]), AT + 120_003)
    expect(history(AT + 120_003)).toBeNull()
  })

  it.each(['rowsUnread', 'ledgersSkipped'] as const)(
    'partial %s evidence cannot retire history',
    (field) => {
      const { facts, history } = stopped()
      expect(facts.retireUnsupportedHistory({ ...walk([]), [field]: 1 }, AT + 20, AT + 21)).toBe(
        false,
      )
      expect(history(AT + 22)).not.toBeNull()
    },
  )

  it('no-ledger or a snapshot pinned before confirmation cannot contradict the confirmed stop', () => {
    const { facts, history } = stopped()
    expect(
      facts.retireUnsupportedHistory({ ...walk([]), walk: 'no-ledger' }, AT + 20, AT + 21),
    ).toBe(false)
    expect(facts.retireUnsupportedHistory(walk([]), AT + 1, AT + 100)).toBe(false)
    expect(history(AT + 101)).not.toBeNull()
    expect(facts.retireUnsupportedHistory(walk([wall(RESET)]), AT + 102, AT + 103)).toBe(false)
    expect(history(AT + 104)).toMatchObject({ asOf: AT + 1 })
  })

  it.each([NaN, AT - 1])('a nonfinite or backwards age clock retires history (%s)', (now) => {
    const { history } = stopped()
    expect(history(now)).toBeNull()
    expect(history()).toBeNull()
  })

  it('retires on real progress, clear, new life, sign-in and deletion', () => {
    for (const reason of ['progress', 'clear', 'life', 'signin', 'delete'] as const) {
      const { facts, life, history } = stopped()
      if (reason === 'progress')
        facts.observe(
          'fictional',
          life,
          'claude',
          { type: 'assistant_delta', text: 'new provider words' },
          AT + 3,
        )
      if (reason === 'clear')
        facts.observe(
          'fictional',
          life,
          'claude',
          { type: 'provider_limit_clear', window: 'five_hour', source: 'rate_limit_event' },
          AT + 3,
        )
      if (reason === 'life') facts.begin('fictional', {}, 'codex', true)
      if (reason === 'signin') facts.signInChanged(['fictional'])
      if (reason === 'delete') facts.forget('fictional')
      expect(history(), reason).toBeNull()
    }
  })

  it('a requested start suppresses history without inventing real progress or renewing its date', () => {
    const { facts, life, history } = stopped()
    expect(facts.lastKnown('fictional', life, 'claude', true, AT + 3)).toBeNull()
    facts.observe('fictional', life, 'claude', { type: 'status', state: 'working' }, AT + 4)
    expect(history(AT + 5)).toMatchObject({ asOf: AT + 1 })
  })

  it('a backwards clock inside the age window cannot extend a retained stop', () => {
    const { history } = stopped(null)
    expect(history(AT + 120_000)).not.toBeNull()
    expect(history(AT + 60_000)).toBeNull()
    expect(history(AT + 121_000)).toBeNull()
  })
})
