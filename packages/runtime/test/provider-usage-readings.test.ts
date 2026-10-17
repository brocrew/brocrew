import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { MAX_USAGE_WINDOWS, type RuntimeEvent } from '../src/index'
import { normalizeMessage } from '../src/claude/normalize'
import { RateLimitWatch, normalizeNotification, rateLimitUsage } from '../src/codex/normalize'

/**
 * # ⚑ Usage readings — how full each metered window is, for a person's Providers screen
 *
 * Landing coverage for the two adapters' `provider_usage`: a reading the host KEEPS and never records.
 * ⚑ Every reading, near a limit or not — so a frame that is quiet chatter still carries one beside
 * its chatter row; a frame that names no number carries none; the window is the provider's own word;
 * Claude's `utilization` is a fraction and its reset is seconds, Codex's percentage is already a
 * percentage and its reset is seconds too.
 */

const claudeFrame = (info: Record<string, unknown>): RuntimeEvent[] =>
  normalizeMessage({
    type: 'rate_limit_event',
    rate_limit_info: info,
    session_id: 's',
  } as unknown as SDKMessage)

const usageOf = (events: readonly RuntimeEvent[]) =>
  events.find((event) => event.type === 'provider_usage')

describe('Claude · rate_limit_event → provider_usage', () => {
  it('🔴 every unified window is a reading: the fraction becomes a percent to a tenth, seconds become ms', () => {
    const events = claudeFrame({
      status: 'allowed',
      unifiedWindows: {
        five_hour: { utilization: 0.92, resetsAt: 1_800_000_000 },
        seven_day: { utilization: 0.1234, resetsAt: 1_800_500_000 },
      },
    })
    expect(usageOf(events)).toEqual({
      type: 'provider_usage',
      readings: [
        { window: 'five_hour', usedPercent: 92, resetsAt: 1_800_000_000_000 },
        { window: 'seven_day', usedPercent: 12.3, resetsAt: 1_800_500_000_000 },
      ],
    })
    // The frame's own event is still there, and the reading rides beside it, last.
    expect(events.length).toBeGreaterThan(1)
    expect(events.at(-1)).toMatchObject({ type: 'provider_usage' })
  })

  it('⚑ a frame about ONE window reads that window, by the provider’s own word', () => {
    expect(
      usageOf(
        claudeFrame({ status: 'allowed', rateLimitType: 'seven_day', resetsAt: 1_800_000_000 }),
      ),
    ).toEqual({
      type: 'provider_usage',
      readings: [{ window: 'seven_day', usedPercent: null, resetsAt: 1_800_000_000_000 }],
    })
  })

  it('⛔ a throttle keeps its error AND carries the reading beside it', () => {
    const events = claudeFrame({
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: 1_800_000_000,
      unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1_800_000_000 } },
    })
    expect(events[0]).toMatchObject({ type: 'error', fatal: false })
    expect(usageOf(events)).toMatchObject({
      readings: [{ window: 'five_hour', usedPercent: 100 }],
    })
  })

  it('⚑ a window the frame gives no number for is no reading, and a frame with none is none at all', () => {
    expect(
      usageOf(
        claudeFrame({ status: 'allowed', unifiedWindows: { five_hour: {}, seven_day: 'x' } }),
      ),
    ).toBeUndefined()
    expect(usageOf(claudeFrame({ status: 'allowed' }))).toBeUndefined()
    expect(usageOf(claudeFrame({ status: 'allowed', unifiedWindows: 'nonsense' }))).toBeUndefined()
    // A negative number is not a reading either.
    expect(
      usageOf(claudeFrame({ unifiedWindows: { five_hour: { utilization: -1, resetsAt: -5 } } })),
    ).toBeUndefined()
  })

  it('⛔ no more than the bound is carried, and a window name cannot be longer than the wire allows', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_USAGE_WINDOWS + 6 }, (_, i) => [
        `window_${String(i)}`,
        { utilization: 0.5 },
      ]),
    )
    const reading = usageOf(claudeFrame({ unifiedWindows: many }))
    expect(reading?.type === 'provider_usage' && reading.readings).toHaveLength(MAX_USAGE_WINDOWS)
    const long = usageOf(
      claudeFrame({ unifiedWindows: { ['w'.repeat(500)]: { utilization: 0.5 } } }),
    )
    expect(long?.type === 'provider_usage' && long.readings[0]?.window).toHaveLength(120)
  })
})

describe('Codex · account/rateLimits/updated → provider_usage', () => {
  const LATER = 4_000_000_000
  const BUCKET = {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 74, windowDurationMins: 10080, resetsAt: LATER },
    secondary: { usedPercent: 12.5, windowDurationMins: 300, resetsAt: LATER + 60 },
    credits: null,
    planType: 'pro',
    rateLimitReachedType: null,
  }
  const frame = (rateLimits: unknown, watch?: RateLimitWatch) =>
    normalizeNotification('account/rateLimits/updated', { rateLimits }, watch)

  it('🔴 each slot is a reading named as the warning lines name it, with its reset in ms', () => {
    const events = frame(BUCKET)
    expect(events[0]).toMatchObject({ type: 'unknown', label: 'account/rateLimits/updated' })
    expect(usageOf(events)).toEqual({
      type: 'provider_usage',
      readings: [
        { window: 'a 7-day window', usedPercent: 74, resetsAt: LATER * 1000 },
        { window: 'a 5-hour window', usedPercent: 12.5, resetsAt: (LATER + 60) * 1000 },
      ],
    })
  })

  it('⚑ a window whose length the provider did not say is named by its slot', () => {
    const reading = usageOf(frame({ ...BUCKET, primary: { usedPercent: 50 }, secondary: null }))
    expect(reading).toMatchObject({ readings: [{ window: 'its primary window', usedPercent: 50 }] })
  })

  it('⚑ a metered model’s window carries the model’s own name, and another bucket the provider calls its main one carries its id', () => {
    const named = usageOf(frame({ ...BUCKET, limitName: 'GPT-5.3-Codex-Spark', secondary: null }))
    expect(named?.type === 'provider_usage' && named.readings[0]?.window).toBe(
      'a 7-day window (GPT-5.3-Codex-Spark)',
    )
    const watch = new RateLimitWatch()
    // The main bucket is the one the provider's full read names.
    watch.seed({ rateLimits: BUCKET })
    const other = usageOf(frame({ ...BUCKET, limitId: 'codex_other', secondary: null }, watch))
    expect(other?.type === 'provider_usage' && other.readings[0]?.window).toContain('(codex_other)')
  })

  it('⛔ a sparse frame does not read as a window that lost its reset: the held bucket is merged in', () => {
    const watch = new RateLimitWatch()
    frame(BUCKET, watch)
    const sparse = usageOf(
      frame({ limitId: 'codex', primary: { usedPercent: 80, windowDurationMins: 10080 } }, watch),
    )
    expect(sparse).toMatchObject({
      readings: [{ usedPercent: 80, resetsAt: LATER * 1000 }, { usedPercent: 12.5 }],
    })
  })

  it('⚑ a snapshot with no number in any window is no reading, and neither is no snapshot', () => {
    expect(usageOf(frame({ ...BUCKET, primary: {}, secondary: null }))).toBeUndefined()
    expect(rateLimitUsage(null)).toBeNull()
    expect(rateLimitUsage({ snapshot: 'nonsense', mainLimitId: null })).toBeNull()
    expect(new RateLimitWatch().lastReading()).toBeNull()
  })

  it('🔴 a wall is still said as the error it was, with the reading beside it', () => {
    const events = frame({
      ...BUCKET,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: LATER },
      rateLimitReachedType: 'rate_limit_reached',
    })
    expect(events[0]).toMatchObject({ type: 'error', fatal: false })
    expect(usageOf(events)).toMatchObject({
      readings: [{ usedPercent: 100 }, { usedPercent: 12.5 }],
    })
  })
})
