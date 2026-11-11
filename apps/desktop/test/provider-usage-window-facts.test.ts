import { expect, it } from 'vitest'
import { usagePeriod } from '../src/main/providers/usage-period'
import { usageForDisplay } from '../src/main/providers/usage-display'

const HOUR = 3_600_000
const DAY = 24 * HOUR

it.each([
  ['five_hour', '5-hour', 5 * HOUR],
  ['seven_day', 'weekly', 7 * DAY],
  ['seven_day_opus', 'weekly Opus', 7 * DAY],
  ['seven_day_sonnet', 'weekly Sonnet', 7 * DAY],
  ['seven_day_overage_included', 'weekly (extra usage included)', 7 * DAY],
  ['overage', 'extra-usage', null],
] as const)('the Claude producer names retained native window %s', (window, word, durationMs) => {
  expect(usagePeriod('claude', window)).toEqual({
    word,
    durationMs,
    bucket: false,
    bucketName: null,
  })
})

it.each([
  ['a 7-day window', 'weekly', 7 * DAY],
  ['a 1-day window', 'daily', DAY],
  ['a 3-day window', '3-day', 3 * DAY],
  ['a 5-hour window', '5-hour', 5 * HOUR],
] as const)('the Codex producer names retained duration %s', (window, word, durationMs) => {
  expect(usagePeriod('codex', window)).toEqual({
    word,
    durationMs,
    bucket: false,
    bucketName: null,
  })
})

it('retains bucket geometry without inventing an aggregate window', () => {
  expect(usagePeriod('codex', 'a 7-day window (Fern model)')).toEqual({
    word: 'weekly',
    durationMs: 7 * DAY,
    bucket: true,
    bucketName: 'Fern model',
  })
  expect(usagePeriod('claude', 'five_hour (Fern) annotation')).toEqual({
    word: '5-hour',
    durationMs: 5 * HOUR,
    bucket: true,
    bucketName: null,
  })
})

it.each([
  ['claude', 'future_window'],
  ['claude', ''],
  ['codex', 'its primary window'],
  ['codex', 'a 90-minute window'],
  ['codex', ''],
] as const)('keeps unknown period facts null for %s %s', (provider, window) => {
  expect(usagePeriod(provider, window)).toEqual({
    word: null,
    durationMs: null,
    bucket: false,
    bucketName: null,
  })
})

it('projects old readings without changing raw tooltip data, percentages, reset or confirmation', () => {
  const row = { window: 'seven_day', usedPercent: 42.5, resetsAt: null, at: 100 }
  const shown = usageForDisplay('claude', [row], true, 200)[0]!
  expect(shown).toMatchObject({
    ...row,
    unconfirmed: true,
    warning: null,
    period: { word: 'weekly', durationMs: 7 * DAY, bucket: false, bucketName: null },
  })
  expect(row).toEqual({ window: 'seven_day', usedPercent: 42.5, resetsAt: null, at: 100 })
  const period = { word: null, durationMs: null, bucket: false, bucketName: null }
  expect(usageForDisplay('claude', [{ ...row, period }], false, 200)[0]?.period).toBe(period)
})
