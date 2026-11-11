import { expect, it } from 'vitest'
import { usageWarnings } from '../src/shared/provider-limit'
import { warningWindow } from '../src/main/providers/usage-period'
import { usageForDisplay } from '../src/main/providers/usage-display'
import type { ProviderUsageReading } from '../src/shared/runtime-ipc'

const NOW = Date.UTC(2026, 10, 10)
const HOUR = 3_600_000
const reading = (
  window: string,
  usedPercent: number,
  resetsAt: number | null = NOW + HOUR,
): ProviderUsageReading => ({
  window,
  usedPercent,
  resetsAt,
  at: NOW,
})

it('keeps the policy for thresholds, buckets, reset bounds, and unconfirmed readings in the core', () => {
  const rows = [
    reading('seven_day', 79),
    reading('five_hour', 80),
    reading('a 7-day window (Fern)', 99),
    reading('daily', 99, NOW),
    reading('future opaque period', 83, null),
  ]
  const shown = usageForDisplay('claude', rows, false, NOW)
  expect(shown.map((one) => one.warning?.meaning ?? null)).toEqual([
    null,
    { word: '5-hour', used: 80, untimed: false },
    null,
    null,
    { word: null, used: 83, untimed: true },
  ])
  expect(usageForDisplay('claude', rows, true, NOW).map((one) => one.warning)).toEqual([
    null,
    null,
    null,
    null,
    null,
  ])
  expect(rows.every((one) => one.period === undefined && one.warning === undefined)).toBe(true)
})

it('retains the fullest slot and its own reset without warning twice for the same window', () => {
  const rows = [
    reading('its primary window', 81, NOW + HOUR),
    reading('its secondary window', 95, NOW + 2 * HOUR),
  ]
  const shown = usageForDisplay('codex', rows, false, NOW)
  expect(shown[0]?.warning).toBeNull()
  expect(shown[1]?.warning).toMatchObject({
    provider: 'codex',
    window: 'this window',
    resetsAt: NOW + 2 * HOUR,
    meaning: { word: null, used: 95, untimed: false },
  })
})

it('preserves supplied fictional and unknown period facts over contradictory raw names', () => {
  const period = { word: 'Fern', durationMs: 2 * HOUR, bucket: false, bucketName: null }
  const row = { ...reading('seven_day', 92), period }
  const shown = usageForDisplay('claude', [row], false, NOW)[0]!
  expect(shown.period).toBe(period)
  expect(shown.warning?.meaning).toEqual({ word: 'Fern', used: 92, untimed: false })
  expect(shown.warning?.said).toContain('seven_day')
  expect(
    usageForDisplay('claude', [{ ...row, period: { ...period, word: null } }], false, NOW)[0]
      ?.warning?.meaning?.word,
  ).toBeNull()
  expect(
    usageForDisplay('claude', [reading('seven_day', 92)], false, NOW)[0]?.warning?.meaning?.word,
  ).toBe('weekly')
})

it.each([
  ['its primary window', 'this window'],
  ['its secondary window', 'this window'],
  ['future slot', 'future slot'],
  ['future on the Fern limit', 'future on the Fern limit'],
])('keeps owner-bound identity for %s without inventing a duration', (window, expected) => {
  const row = reading(window, 95)
  const codex = usageForDisplay('codex', [row], false, NOW)[0]!
  const claude = usageForDisplay('claude', [row], false, NOW)[0]!
  expect(codex.warning?.window).toBe(expected)
  expect(claude.warning?.window).toBe(window)
  expect(codex.period?.durationMs).toBeNull()
  expect(row.window).toBe(window)
})

it.each(['Fictional warning identity', 'slot on the Fern limit', ''])(
  'keeps a supplied internal warning identity authoritative (%j)',
  (identity) => {
    const row = { ...reading('its primary window', 95), warningWindow: identity }
    const [selected] = usageWarnings({ codex: [row] }, [], NOW, warningWindow)
    expect(selected?.reading).toBe(row)
    expect(selected?.wall.window).toBe(identity)
    expect(row.window).toBe('its primary window')
  },
)
