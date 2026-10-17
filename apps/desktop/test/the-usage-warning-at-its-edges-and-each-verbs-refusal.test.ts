import { describe, expect, it } from 'vitest'
import { noPersonBehindIt } from '../src/main/runtime/ipc'
import { USAGE_NEARS_ITS_LIMIT_AT, wallsFromUsage } from '../src/shared/provider-limit'
import type { ProviderUsageReading } from '../src/shared/runtime-ipc'

/**
 * # F096 · the usage warning at its edges, and 28085e11 · each person's verb says what it does
 *
 * ⚑ `a-providers-usage-is-kept-told-to-agents-and-warned.test.ts` reads 79% and 82%, and its passed
 * reset and stopped provider go through the host's fold, which drops both on its own. These are
 * `wallsFromUsage`'s own edges, asked of the pure rule:
 *
 *  - §1 · exactly 80% warns, and just under does not.
 *  - §2 · ⛔ a reading whose window has reset since, a reset past what a date can hold, and a
 *    provider a wall already stopped make no warning — each beside a reading that does.
 *  - §3 · 28085e11: a person's verb refused from no person says what THAT verb does; ⛔ a listed verb
 *    is never said as one that changes what agents are allowed to do.
 */

const WEEK = 7 * 24 * 60 * 60 * 1000
const clock = Date.UTC(2026, 9, 5, 9, 0)

const aReading = (over: Partial<ProviderUsageReading> = {}): ProviderUsageReading => ({
  window: 'seven_day',
  usedPercent: 92,
  resetsAt: clock + WEEK,
  at: clock,
  ...over,
})

describe('F096 · the usage warning at its edges', () => {
  it('🔴 §1 · exactly 80% warns; 79.9% does not', () => {
    expect(USAGE_NEARS_ITS_LIMIT_AT).toBe(80)
    const at = wallsFromUsage({ claude: [aReading({ usedPercent: 80 })] }, [], clock)
    expect(at).toHaveLength(1)
    expect(at[0]).toMatchObject({ provider: 'claude', standing: 'about-to-stop' })
    expect(at[0]?.said).toContain('80% used')
    expect(wallsFromUsage({ claude: [aReading({ usedPercent: 79.9 })] }, [], clock)).toEqual([])
  })

  it('⛔ §2 · a reading whose window has reset since makes no warning — one still running does', () => {
    expect(wallsFromUsage({ claude: [aReading({ resetsAt: clock - 1 })] }, [], clock)).toEqual([])
    expect(wallsFromUsage({ claude: [aReading({ resetsAt: clock })] }, [], clock)).toEqual([])
    expect(wallsFromUsage({ claude: [aReading({ resetsAt: clock + 1 })] }, [], clock)).toHaveLength(
      1,
    )
  })

  it('⛔ §2 · a reset past what a date can hold makes no warning, and does not throw', () => {
    expect(() =>
      wallsFromUsage({ claude: [aReading({ resetsAt: 9e15 })] }, [], clock),
    ).not.toThrow()
    expect(wallsFromUsage({ claude: [aReading({ resetsAt: 9e15 })] }, [], clock)).toEqual([])
    // ⚑ The control: no reset said at all still warns, with no date on it.
    const noReset = wallsFromUsage({ claude: [aReading({ resetsAt: null })] }, [], clock)
    expect(noReset).toHaveLength(1)
    expect(noReset[0]?.said).not.toContain('resets')
  })

  it('⛔ §2 · a provider a wall already stopped gets no usage warning — another provider still does', () => {
    const stopped = {
      provider: 'claude' as const,
      window: 'five_hour',
      standing: 'stopped' as const,
      resetsAt: clock + 60_000,
      said: 'claude hit its rate limit (five_hour)',
      at: clock,
    }
    const usage = { claude: [aReading()], codex: [aReading({ window: 'a 7-day window' })] }
    const walls = wallsFromUsage(usage, [stopped], clock)
    expect(walls.map((one) => one.provider)).toEqual(['codex'])
    // ⚑ The control: with no wall, both warn.
    expect(
      wallsFromUsage(usage, [], clock)
        .map((one) => one.provider)
        .sort(),
    ).toEqual(['claude', 'codex'])
  })
})

describe('28085e11 · a person’s verb refused says what that verb does', () => {
  const GENERIC = 'changes what agents are allowed to do'

  it('🔴 a read says it reads — its own words, never the generic sentence', () => {
    expect(noPersonBehindIt('agentMemory')).toBe(
      'agentMemory reads an agent’s own memory, so it is refused unless a person is asking',
    )
    expect(noPersonBehindIt('whatTheModelGot')).toBe(
      'whatTheModelGot reads a message as the model got it, with the agent’s own instructions, so it is refused unless a person is asking',
    )
    for (const kind of ['agentMemory', 'modelList', 'retitleWork', 'setApiKey'] as const) {
      expect(noPersonBehindIt(kind), kind).not.toContain(GENERIC)
    }
  })

  it('⚑ a verb with no sentence of its own keeps the generic one', () => {
    expect(noPersonBehindIt('setCapabilities')).toBe(
      `setCapabilities ${GENERIC}, so it is refused unless a person is asking`,
    )
  })
})
