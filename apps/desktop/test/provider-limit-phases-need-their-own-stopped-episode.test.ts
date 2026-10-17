import { describe, expect, it } from 'vitest'
import { CurrentProviderLimitFacts } from '../src/main/runtime/current-provider-limit-facts'
import type { ProviderLimitSeen } from '../src/shared/provider-limit'
import type { LedgerWalk } from '../src/shared/questions'

const AT = Date.UTC(2026, 9, 8, 10)
const wall = (resetsAt: number | null, window = 'five_hour'): ProviderLimitSeen => ({
  provider: 'claude',
  standing: 'stopped',
  window,
  resetsAt,
  at: AT,
  said: 'fictional provider wall',
})
const walk = (
  rows: readonly ProviderLimitSeen[],
  rowsUnread = 0,
): LedgerWalk<ProviderLimitSeen> => ({
  walk: 'every-provider-wall-recently-recorded',
  rows,
  rowsUnread,
  ledgers: 2,
})
const clear = { status: 'current', value: null }
const unavailable = { status: 'unavailable' }

function stopped() {
  const facts = new CurrentProviderLimitFacts()
  const life = {}
  facts.begin('A', life, 'claude', true)
  facts.observe(
    'A',
    life,
    'claude',
    {
      type: 'error',
      message: 'claude is rate-limited (five_hour)',
      fatal: false,
    },
    AT,
  )
  facts.prepare(walk([wall(null)]), AT)
  facts.gate('claude', null, AT)
  return { facts, life }
}

describe('current provider stops and unchanged global holds', () => {
  it.each([false, true])(
    'has no limit override without an own stop, with automatic mail %s',
    (mail) => {
      const facts = new CurrentProviderLimitFacts()
      const life = {}
      facts.begin('idle', life, 'claude', false)
      expect(facts.block('idle', life, 'claude', false, mail, AT)).toEqual(clear)
      expect(facts.block('recorded', null, 'claude', false, mail, AT)).toEqual(clear)
      expect(facts.block('never-run', {}, 'claude', false, mail, AT)).toEqual(clear)
      expect(facts.hold('claude', false, AT)).toEqual(unavailable)
      facts.observe('idle', life, 'claude', { type: 'turn', state: 'completed' }, AT)
      expect(facts.block('idle', life, 'claude', false, mail, AT)).toEqual(clear)
      facts.invalidate()
      expect(facts.block('idle', life, 'claude', false, mail, AT + 1)).toEqual(clear)
      expect(facts.hasStoppedEpisode('idle', life, 'claude')).toBe(false)
    },
  )

  it('keeps unavailable specific to an own stopped episode while the reading is unknown', () => {
    const { facts, life } = stopped()
    facts.invalidate()
    expect(facts.hasStoppedEpisode('A', life, 'claude')).toBe(true)
    expect(facts.hasStoppedEpisode('A', {}, 'claude')).toBe(false)
    expect(facts.hasStoppedEpisode('A', life, 'codex')).toBe(false)
    expect(facts.block('A', life, 'claude', false, false, AT)).toEqual(unavailable)
    expect(facts.block('A', {}, 'claude', false, false, AT)).toEqual(clear)
    expect(facts.block('A', life, 'codex', false, false, AT)).toEqual(clear)
    facts.prepare(walk([wall(null)]), AT)
    expect(facts.block('A', life, 'claude', false, false, AT)).toEqual({
      status: 'current',
      value: { provider: 'claude', resetsAt: null },
    })
    facts.observe('A', life, 'claude', { type: 'turn', state: 'completed' }, AT + 1)
    expect(facts.block('A', life, 'claude', false, true, AT + 1)).toEqual(clear)
  })

  it('never turns a display-only poll into a gate decision', () => {
    const facts = new CurrentProviderLimitFacts()
    facts.prepare(walk([wall(AT + 20_000)]), AT)
    expect(facts.hold('claude', false, AT)).toEqual(unavailable)
    facts.gate('claude', AT + 20_000, AT)
    facts.prepare(walk([]), AT + 1)
    expect(facts.hold('claude', false, AT + 1)).toMatchObject({ value: { resetsAt: AT + 20_000 } })
    facts.invalidate()
    facts.prepare(walk([]), AT + 2)
    expect(facts.hold('claude', false, AT + 2)).toEqual(unavailable)
  })

  it('keeps an omitted turn window and reset unknown without requiring a preceding error', () => {
    const facts = new CurrentProviderLimitFacts()
    const life = {}
    facts.begin('A', life, 'claude', true)
    facts.observe(
      'A',
      life,
      'claude',
      { type: 'turn', state: 'failed', limit: { provider: 'claude' } },
      AT,
    )
    facts.prepare(walk([wall(null, '')]), AT)
    facts.gate('claude', null, AT)
    expect(facts.block('A', life, 'claude', false, false, AT)).toEqual({
      status: 'current',
      value: { provider: 'claude', resetsAt: null },
    })
    expect(facts.hold('claude', false, AT)).toEqual(clear)
  })

  it('requires an own unknown-reset episode rather than an unrelated global wall', () => {
    const { facts, life } = stopped()
    const other = {}
    facts.begin('B', other, 'claude', true)
    expect(facts.block('A', life, 'claude', false, false, AT)).toEqual({
      status: 'current',
      value: { provider: 'claude', resetsAt: null },
    })
    expect(facts.block('B', other, 'claude', false, false, AT)).toEqual(clear)
    expect(facts.block('recorded', null, 'claude', false, false, AT)).toEqual(clear)
    expect(facts.hold('claude', false, AT)).toEqual(clear)
  })

  it('uses the unchanged global maximum finite reset and exempts the actual person origin', () => {
    const facts = new CurrentProviderLimitFacts()
    facts.prepare(walk([wall(null), wall(AT + 10_000, 'short'), wall(AT + 20_000, 'long')]), AT)
    facts.gate('claude', AT + 20_000, AT)
    const held = {
      status: 'current',
      value: { is: 'provider-limit', provider: 'claude', resetsAt: AT + 20_000 },
    }
    expect(facts.hold('claude', false, AT)).toEqual(held)
    expect(facts.hold('claude', true, AT)).toEqual(clear)
    expect(facts.block('unrelated', null, 'claude', false, true, AT)).toEqual({
      status: 'current',
      value: { provider: 'claude', resetsAt: AT + 20_000 },
    })
  })

  it('does not retire an episode just because a requested start temporarily takes precedence', () => {
    const { facts, life } = stopped()
    expect(facts.block('A', life, 'claude', true, false, AT)).toEqual(clear)
    expect(facts.block('A', life, 'claude', false, false, AT)).toMatchObject({
      status: 'current',
      value: { resetsAt: null },
    })
    facts.observe('A', life, 'claude', { type: 'status', state: 'working' }, AT)
    expect(facts.block('A', life, 'claude', false, false, AT)).toMatchObject({
      value: { resetsAt: null },
    })
  })

  it('retires the unknown stop on real output and never borrows the global wall to revive it', () => {
    const { facts, life } = stopped()
    facts.observe(
      'A',
      life,
      'claude',
      { type: 'assistant_delta', text: 'actual new words' },
      AT + 1,
    )
    expect(facts.block('A', life, 'claude', false, false, AT + 1)).toEqual(clear)
  })

  it('suppresses the primary phase during a person turn while automatic words keep their finite reason', () => {
    const { facts, life } = stopped()
    facts.prepare(walk([wall(AT + 20_000)]), AT)
    facts.gate('claude', AT + 20_000, AT)
    expect(facts.block('A', life, 'claude', true, true, AT)).toEqual(clear)
    expect(facts.hold('claude', false, AT)).toMatchObject({ value: { resetsAt: AT + 20_000 } })
    expect(facts.hold('claude', true, AT)).toEqual(clear)
    expect(facts.block('A', life, 'claude', false, true, AT)).toMatchObject({
      value: { resetsAt: AT + 20_000 },
    })
  })

  it('keeps the failed ending of a recognized limit, then supersedes it on a different ending', () => {
    const { facts, life } = stopped()
    facts.observe('A', life, 'claude', { type: 'turn', state: 'failed' }, AT + 1)
    expect(facts.block('A', life, 'claude', false, false, AT + 1)).toMatchObject({
      value: { resetsAt: null },
    })
    facts.observe('A', life, 'claude', { type: 'turn', state: 'failed' }, AT + 2)
    expect(facts.block('A', life, 'claude', false, false, AT + 2)).toEqual(clear)
  })

  it.each(['rowsUnread', 'ledgersSkipped'] as const)(
    'does not prove an own stop across incomplete %s coverage',
    (field) => {
      const { facts, life } = stopped()
      facts.invalidate()
      facts.prepare({ ...walk([wall(null)]), [field]: 1 }, AT)
      expect(facts.block('A', life, 'claude', false, false, AT)).toEqual(unavailable)
      expect(facts.hold('claude', false, AT)).toEqual(unavailable)
      facts.prepare({ ...walk([wall(AT + 20_000)]), [field]: 1 }, AT)
      facts.gate('claude', AT + 20_000, AT)
      expect(facts.hold('claude', false, AT)).toMatchObject({ value: { resetsAt: AT + 20_000 } })
      expect(facts.hold('claude', true, AT)).toEqual(clear)
    },
  )

  it('publishes unavailability after invalidation or failure without a false clear', () => {
    const { facts, life } = stopped()
    facts.invalidate()
    expect(facts.block('A', life, 'claude', false, false, AT)).toEqual(unavailable)
    expect(facts.hold('claude', false, AT)).toEqual(unavailable)
    facts.prepare(walk([wall(null)]), AT)
    expect(facts.block('A', life, 'claude', false, false, AT)).toMatchObject({
      value: { resetsAt: null },
    })
  })

  it('does not declare clear when expiry can reveal a discarded older wall', () => {
    const facts = new CurrentProviderLimitFacts()
    facts.prepare(walk([wall(AT + 100)]), AT)
    facts.gate('claude', AT + 100, AT)
    expect(facts.hold('claude', false, AT + 99)).toMatchObject({ value: { resetsAt: AT + 100 } })
    expect(facts.hold('claude', false, AT + 100)).toEqual(unavailable)
    facts.prepare(walk([wall(null)]), AT + 100)
    expect(facts.hold('claude', false, AT + 100)).toEqual(unavailable)
    facts.gate('claude', null, AT + 100)
    expect(facts.hold('claude', false, AT + 100)).toEqual(clear)
  })

  it('does not let a clear episode revive from a later unrelated provider wall', () => {
    const { facts, life } = stopped()
    facts.prepare(walk([]), AT + 1)
    expect(facts.block('A', life, 'claude', false, false, AT + 1)).toEqual(clear)
    facts.prepare(walk([{ ...wall(null), at: AT + 2 }]), AT + 2)
    expect(facts.block('A', life, 'claude', false, false, AT + 2)).toEqual(clear)
  })

  it('declines episodes from an older life and does not invent stopped history after a restart', () => {
    const { facts, life } = stopped()
    const renewed = {}
    facts.begin('A', renewed, 'claude', false)
    facts.observe('A', life, 'claude', { type: 'assistant_delta', text: 'late old output' }, AT + 1)
    expect(facts.block('A', renewed, 'claude', false, false, AT + 1)).toEqual(clear)
    facts.signInChanged(['A'])
    expect(facts.block('A', renewed, 'claude', false, false, AT + 1)).toEqual(clear)
    facts.observe(
      'A',
      renewed,
      'claude',
      { type: 'assistant_delta', text: 'new life output' },
      AT + 2,
    )
    expect(facts.block('A', renewed, 'claude', false, false, AT + 2)).toEqual(clear)
  })

  it('copies prepared evidence and rejects clock reversal', () => {
    const { facts, life } = stopped()
    const rows = [{ ...wall(AT + 20_000) }]
    facts.prepare(walk(rows), AT)
    rows[0]!.resetsAt = AT + 10
    expect(facts.block('A', life, 'claude', false, false, AT)).toMatchObject({
      value: { resetsAt: AT + 20_000 },
    })
    expect(facts.block('A', life, 'claude', false, false, AT - 1)).toEqual(unavailable)
  })
  it('does not revive an expired snapshot when the clock later moves backwards', () => {
    const { facts, life } = stopped()
    facts.prepare(walk([wall(AT + 100)]), AT)
    facts.gate('claude', AT + 100, AT)
    facts.expire(AT + 100)
    expect(facts.block('A', life, 'claude', false, false, AT + 99)).toEqual(unavailable)
    expect(facts.hold('claude', false, AT + 99)).toEqual(unavailable)
  })

  it('does not erase an unconfirmed turn-only stop just because the error population is empty', () => {
    const facts = new CurrentProviderLimitFacts(),
      life = {}
    facts.begin('A', life, 'claude', true)
    facts.observe(
      'A',
      life,
      'claude',
      { type: 'turn', state: 'failed', limit: { provider: 'claude' } },
      AT,
    )
    facts.prepare(walk([]), AT + 1)
    expect(facts.block('A', life, 'claude', false, false, AT + 1)).toEqual(unavailable)
  })

  it('does not borrow a discarded older wall for a newer own stopped episode', () => {
    const { facts, life } = stopped()
    facts.prepare(walk([wall(AT + 100)]), AT)
    facts.expire(AT + 100)
    facts.prepare(walk([{ ...wall(null), at: AT - 1 }]), AT + 100)
    expect(facts.block('A', life, 'claude', false, false, AT + 100)).toEqual(unavailable)
  })
})
