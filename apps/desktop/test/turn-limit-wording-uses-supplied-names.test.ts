import { afterEach, expect, it, vi } from 'vitest'
import type { TurnLimit } from '@brobot2/runtime'
import { clockTimeFrom } from '../src/shared/clock'
import { aTurnsLimitSays, type UsageProviderNames } from '../src/renderer/src/lib/usage-limit'

const AT = Date.UTC(2026, 10, 11, 12)
const RESET = AT + 2 * 3_600_000
const names: UsageProviderNames = { claude: 'Fern', codex: 'Birch' }
const opposite: UsageProviderNames = { claude: 'Birch', codex: 'Fern' }
const refusal = 'refused the turn on its plan or usage; what it said is just above'
const untimed = 'usage limit was reached; it hasn’t said when it resets'

afterEach(() => vi.useRealTimers())

it.each(['claude', 'codex'] as const)(
  'uses each current supplied name for %s with the same complete recorded limit facts',
  (provider) => {
    const limit: TurnLimit = {
      provider,
      window: 'opaque-slot',
      resetsAt: RESET,
      creditsRequired: true,
    }
    const before = JSON.stringify(limit)
    expect(aTurnsLimitSays(limit, AT, names)).toBe(
      `${names[provider]}’s usage limit was reached; it resets at ${clockTimeFrom(RESET, AT)}`,
    )
    expect(aTurnsLimitSays(limit, AT, opposite)).toBe(
      `${opposite[provider]}’s usage limit was reached; it resets at ${clockTimeFrom(RESET, AT)}`,
    )
    expect(JSON.stringify(limit)).toBe(before)
    expect(limit.creditsRequired).toBe(true)
  },
)

it('uses generic words for an explicitly unread selected context without static or opaque fallback', () => {
  expect(aTurnsLimitSays({ provider: 'claude' }, AT, {})).toBe(`This provider ${refusal}`)
  expect(aTurnsLimitSays({ provider: 'codex', window: 'opaque-slot' }, AT, {})).toBe(
    `the provider’s ${untimed}`,
  )
  expect(aTurnsLimitSays({ provider: 'claude', resetsAt: RESET }, AT, {})).toBe(
    `the provider’s usage limit was reached; it resets at ${clockTimeFrom(RESET, AT)}`,
  )
})

it('retains omitted-context compatibility for both native providers and both refusal shapes', () => {
  expect(aTurnsLimitSays({ provider: 'claude' }, AT)).toBe(`Claude ${refusal}`)
  expect(aTurnsLimitSays({ provider: 'codex', window: 'opaque-slot' }, AT)).toBe(
    `Codex’s ${untimed}`,
  )
  expect(aTurnsLimitSays({ provider: 'claude', resetsAt: RESET }, AT)).toBe(
    `Claude’s usage limit was reached; it resets at ${clockTimeFrom(RESET, AT)}`,
  )
})

it('keeps the original instant, not the render clock, and never announces a reset already passed then', () => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2050, 0, 1))
  const limit: TurnLimit = {
    provider: 'claude',
    window: 'unknown native spelling',
    resetsAt: RESET,
  }
  expect(aTurnsLimitSays(limit, AT, names)).toBe(
    `Fern’s usage limit was reached; it resets at ${clockTimeFrom(RESET, AT)}`,
  )
  expect(aTurnsLimitSays(limit, RESET, names)).toBe('Fern’s usage limit was reached')
  expect(aTurnsLimitSays(limit, RESET + 1, names)).toBe('Fern’s usage limit was reached')
  expect(aTurnsLimitSays(limit, undefined, names)).toBe(
    `Fern’s usage limit was reached; it resets at ${clockTimeFrom(RESET, RESET)}`,
  )
})

it('leaves unsaid and empty windows distinct and retains supplied names verbatim', () => {
  expect(aTurnsLimitSays({ provider: 'claude' }, AT, names)).toBe(`Fern ${refusal}`)
  expect(aTurnsLimitSays({ provider: 'claude', window: '' }, AT, names)).toBe(`Fern’s ${untimed}`)
  expect(
    aTurnsLimitSays({ provider: 'claude', window: 'raw-seven-day' }, AT, { claude: 'Fern/Birch' }),
  ).toBe(`Fern/Birch’s ${untimed}`)
})
