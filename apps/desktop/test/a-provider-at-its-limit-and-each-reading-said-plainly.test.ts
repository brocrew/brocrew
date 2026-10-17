import { describe, expect, it } from 'vitest'
import { fullTime } from '../src/renderer/src/lib/clock'
import {
  atItsLimitSays,
  readingSays,
  readingTitle,
  resetWords,
  spanWords,
  timeGone,
  usageSays,
  usageTitle,
  windowLength,
} from '../src/renderer/src/lib/usage-limit'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import type { ProviderCondition } from '../src/shared/provider-limit'
import type { ProviderUsageReading } from '../src/shared/runtime-ipc'

/**
 * # W4.26 · W4.63 — the Providers card's usage, in a person's words
 *
 * ⚑ **`25cca325`** added `readingSays`: one line per metered window, near a limit or not —
 * *"Weekly limit: 42% used; it resets in 4 days."* — the reset relative to now, its exact moment on
 * the line's title. ⚑ **`b975fa15`** added `atItsLimitSays`: the
 * card's heading while the provider's wall is STOPPED — *"At its limit until 17:50"* — read from the
 * same wall F074's hold reads, so the card says "at its limit" exactly when the app holds work.
 *
 * ⚠️ Times are built with local-time constructors and compared against `clockTime` /
 * `clockTimeFrom` (the formatters the module itself uses) or `Intl` with the runtime's locale, so
 * no assertion here is about the machine's zone or locale (standing rule 22).
 */

/** A moment on the Mac's own calendar — October 2026. */
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 9, day, hour, minute).getTime()

const NOW = at(3, 9)

/** A Claude wall with a reset, as the adapter writes it. */
const TIMED = 'claude is rate-limited (five_hour); resets 2026-10-03T15:50:00.000Z'
/** A Claude wall that named no reset — a bare 429 beside the timed one. */
const UNTIMED = 'claude is rate-limited (seven_day)'
/** A line that is no wall at all — `readProviderLimit` answers `null` for it. */
const NOT_A_WALL = 'claude exited with code 1'

const wall = (
  said: readonly string[],
  over: Partial<Pick<ProviderCondition, 'provider' | 'standing' | 'resetsAt'>> = {},
): ProviderCondition => ({
  key: over.provider ?? 'claude',
  provider: 'claude',
  standing: 'stopped',
  says: '',
  said,
  resetsAt: at(3, 17, 50),
  ...over,
})

describe('b975fa15 · atItsLimitSays — the heading a stopped provider wears', () => {
  it('🔴 only a STOPPED wall heads the card; one about to stop says nothing there', () => {
    const reset = at(3, 17, 50)
    expect(atItsLimitSays(wall([TIMED]), NOW)).toBe(`At its limit until ${clockTime(reset)}`)
    // ⛔ The paired negative, one fact over: the same wall, still taking work.
    expect(atItsLimitSays(wall([TIMED], { standing: 'about-to-stop' }), NOW)).toBeNull()
    // …and about-to-stop with no reset is still nothing, not the "hasn't said" sentence.
    expect(
      atItsLimitSays(wall([TIMED], { standing: 'about-to-stop', resetsAt: null }), NOW),
    ).toBeNull()
  })

  it('⚑ a reset on another day names its day; one later today is a bare clock time', () => {
    const today = at(3, 17, 50)
    const tomorrow = at(4, 17, 50)
    expect(atItsLimitSays(wall([TIMED], { resetsAt: today }), NOW)).toBe(
      `At its limit until ${clockTime(today)}`,
    )
    const another = atItsLimitSays(wall([TIMED], { resetsAt: tomorrow }), NOW)
    expect(another).toBe(`At its limit until ${clockTimeFrom(tomorrow, NOW)}`)
    // ⛔ A bare time for tomorrow would read as today's.
    expect(another).not.toBe(`At its limit until ${clockTime(tomorrow)}`)
  })

  it('🔴 another of its walls named no reset: the time is the least it waits — "at least until"', () => {
    const reset = at(3, 17, 50)
    expect(atItsLimitSays(wall([TIMED, UNTIMED]), NOW)).toBe(
      `At its limit at least until ${clockTime(reset)}`,
    )
    // ⚑ The control: every wall timed is a plain "until".
    expect(atItsLimitSays(wall([TIMED]), NOW)).toBe(`At its limit until ${clockTime(reset)}`)
    // ⛔ A line that is not a wall at all is not an untimed wall.
    expect(atItsLimitSays(wall([TIMED, NOT_A_WALL]), NOW)).toBe(
      `At its limit until ${clockTime(reset)}`,
    )
  })

  it('⚑ a wall that named no reset says so rather than a time', () => {
    expect(atItsLimitSays(wall([UNTIMED], { resetsAt: null }), NOW)).toBe(
      'At its limit. It hasn’t said when that lifts.',
    )
    expect(
      atItsLimitSays(
        wall(['codex is rate-limited (weekly)'], { provider: 'codex', resetsAt: null }),
        NOW,
      ),
    ).toBe('At its limit. It hasn’t said when that lifts.')
  })

  it('🔴 a reset that has passed while the wall still stands is "was due to lift", never "until"', () => {
    const passed = at(3, 8)
    expect(atItsLimitSays(wall([TIMED], { resetsAt: passed }), NOW)).toBe(
      `At its limit. It was due to lift at ${clockTime(passed)}.`,
    )
    // ⚑ The boundary: a reset AT this moment has passed too.
    expect(atItsLimitSays(wall([TIMED], { resetsAt: NOW }), NOW)).toBe(
      `At its limit. It was due to lift at ${clockTime(NOW)}.`,
    )
    // ⚑ …and one minute ahead has not.
    const ahead = NOW + 60_000
    expect(atItsLimitSays(wall([TIMED], { resetsAt: ahead }), NOW)).toBe(
      `At its limit until ${clockTime(ahead)}`,
    )
  })
})

const reading = (
  window: string,
  usedPercent: number | null,
  resetsAt: number | null,
): ProviderUsageReading => ({ window, usedPercent, resetsAt, at: NOW })

describe('25cca325 · readingSays — one window’s newest reading, near a limit or not', () => {
  it('🔴 Claude’s window names are said in a person’s words, with how much is used and when it resets', () => {
    const later = at(3, 14)
    const week = at(7, 11)
    expect(readingSays(reading('five_hour', 12, later), NOW)).toBe(
      '5-hour limit: 12% used; it resets in 5 h.',
    )
    expect(readingSays(reading('seven_day', 42, week), NOW)).toBe(
      `Weekly limit: 42% used; it resets in 4 days.`,
    )
    expect(readingSays(reading('seven_day_opus', 3, week), NOW)).toBe(
      `Weekly Opus limit: 3% used; it resets in 4 days.`,
    )
    expect(readingSays(reading('seven_day_sonnet', 3, week), NOW)).toBe(
      `Weekly Sonnet limit: 3% used; it resets in 4 days.`,
    )
    expect(readingSays(reading('overage', 0, week), NOW)).toBe(
      `Extra-usage limit: 0% used; it resets in 4 days.`,
    )
  })

  it('⚑ Codex’s durations are said as limits, and a bucket it named stays beside the limit', () => {
    const week = at(7, 11)
    const said = (window: string): string => readingSays(reading(window, 50, week), NOW)
    expect(said('a 5-hour window')).toBe(`5-hour limit: 50% used; it resets in 4 days.`)
    expect(said('a 7-day window')).toBe(`Weekly limit: 50% used; it resets in 4 days.`)
    expect(said('a 1-day window')).toBe(`Daily limit: 50% used; it resets in 4 days.`)
    expect(said('a 3-day window')).toBe(`3-day limit: 50% used; it resets in 4 days.`)
    expect(said('a 7-day window (GPT-5.3-Codex-Spark)')).toBe(
      `Weekly limit (GPT-5.3-Codex-Spark): 50% used; it resets in 4 days.`,
    )
    // ⛔ The control: the main bucket names no bucket.
    expect(said('a 7-day window')).not.toContain('(')
  })

  it('⚑ a window this app has no word for is the provider’s own word — its bracket not said twice', () => {
    const week = at(7, 11)
    expect(readingSays(reading('monthly_thing', 5, week), NOW)).toBe(
      `monthly_thing: 5% used; it resets in 4 days.`,
    )
    expect(readingSays(reading('mystery (bucket)', 5, week), NOW)).toBe(
      `mystery (bucket): 5% used; it resets in 4 days.`,
    )
  })

  it('🔴 a number the provider did not say is said as not said — never 0% and never a time', () => {
    const week = at(7, 11)
    expect(readingSays(reading('seven_day', null, week), NOW)).toBe(
      `Weekly limit: how much is used isn’t said; it resets in 4 days.`,
    )
    expect(readingSays(reading('seven_day', 42, null), NOW)).toBe(
      'Weekly limit: 42% used; it hasn’t said when it resets.',
    )
    // ⚑ The control: a real 0 is said as 0%.
    expect(readingSays(reading('seven_day', 0, null), NOW)).toBe(
      'Weekly limit: 0% used; it hasn’t said when it resets.',
    )
  })

  it('⚑ the percentage is rounded to the nearest whole, not cut', () => {
    const said = (used: number): string => readingSays(reading('five_hour', used, null), NOW)
    expect(said(99.6)).toBe('5-hour limit: 100% used; it hasn’t said when it resets.')
    expect(said(12.5)).toBe('5-hour limit: 13% used; it hasn’t said when it resets.')
    expect(said(0.4)).toBe('5-hour limit: 0% used; it hasn’t said when it resets.')
  })
})

describe('the reset, said relative to now — one wording for every usage surface', () => {
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('🔴 under a minute, minutes, hours and minutes under a day, days from a day up', () => {
    expect(spanWords(0)).toBe('less than a minute')
    expect(spanWords(59_999)).toBe('less than a minute')
    expect(spanWords(MINUTE)).toBe('1 min')
    expect(spanWords(45 * MINUTE)).toBe('45 min')
    expect(spanWords(HOUR)).toBe('1 h')
    expect(spanWords(3 * HOUR + 12 * MINUTE)).toBe('3 h 12 min')
    expect(spanWords(23 * HOUR + 59 * MINUTE)).toBe('23 h 59 min')
    expect(spanWords(DAY)).toBe('1 day')
    expect(spanWords(2 * DAY + 5 * HOUR)).toBe('2 days')
    // ⚑ Rounded, not cut: two and a half days is three.
    expect(spanWords(2.5 * DAY)).toBe('3 days')
    // ⚑ Minutes round too, and an hour's worth of them reads as an hour.
    expect(spanWords(59 * MINUTE + 40_000)).toBe('1 h')
  })

  it('🔴 a reset ahead is "resets in", one passed is "reset … ago", and none is null', () => {
    expect(resetWords(NOW + 2 * HOUR + 30 * MINUTE, NOW)).toBe('resets in 2 h 30 min')
    expect(resetWords(NOW + 3 * DAY, NOW)).toBe('resets in 3 days')
    expect(resetWords(NOW + 20_000, NOW)).toBe('resets in less than a minute')
    expect(resetWords(NOW - 2 * DAY, NOW)).toBe('reset 2 days ago')
    // ⚑ The boundary: a reset AT this moment has passed.
    expect(resetWords(NOW, NOW)).toBe('reset less than a minute ago')
    expect(resetWords(null, NOW)).toBeNull()
  })

  it('⚑ a reading whose window has reset since is said in the past, relative to now', () => {
    expect(readingSays(reading('seven_day', 95, NOW - 2 * DAY), NOW)).toBe(
      'Weekly limit: was 95% used; it reset 2 days ago.',
    )
  })

  it('🔴 the exact moment stays on the title: the reading’s, and the warning’s', () => {
    const resetsAt = NOW + 2 * HOUR
    expect(readingTitle(reading('five_hour', 12, resetsAt), NOW)).toBe(
      `Resets ${fullTime(resetsAt)}\nReceived ${fullTime(NOW)}`,
    )
    expect(readingTitle(reading('five_hour', 12, NOW - HOUR), NOW)).toBe(
      `Reset ${fullTime(NOW - HOUR)}\nReceived ${fullTime(NOW)}`,
    )
    // ⛔ The control: no reset said, no reset line.
    expect(readingTitle(reading('five_hour', 12, null), NOW)).toBe(`Received ${fullTime(NOW)}`)
    const condition = wall([TIMED], { standing: 'about-to-stop', resetsAt })
    expect(usageSays(condition, NOW)).toBe('Claude is near its 5-hour limit; it resets in 2 h.')
    expect(usageTitle(condition)).toContain(fullTime(resetsAt))
  })
})

describe('the time gone in a window, beside how much of it is used', () => {
  const HOUR = 3_600_000
  const DAY = 24 * HOUR

  it('a window’s length comes from the word it is named by, and only from that', () => {
    expect(windowLength('five_hour')).toBe(5 * HOUR)
    expect(windowLength('seven_day')).toBe(7 * DAY)
    expect(windowLength('seven_day_opus')).toBe(7 * DAY)
    expect(windowLength('a 7-day window')).toBe(7 * DAY)
    expect(windowLength('a 5-hour window (GPT-5.3-Codex-Spark)')).toBe(5 * HOUR)
    expect(windowLength('a 1-day window')).toBe(DAY)
    expect(windowLength('a 30-day window')).toBe(30 * DAY)
    // No word, or a word that names no length: no length.
    expect(windowLength('overage')).toBeNull()
    expect(windowLength('a 90-minute window')).toBeNull()
    expect(windowLength('something new')).toBeNull()
  })

  it('🔴 the fraction is 1 - (resetsAt - now) / length, with the words the designer drew', () => {
    const five = timeGone(reading('five_hour', 42, NOW + 2.5 * HOUR), NOW)
    expect(five).toEqual({ fraction: 0.5, words: '2 h 30 min of 5 h gone', ahead: false })
    const week = timeGone(reading('seven_day', 67, NOW + 3 * DAY), NOW)
    expect(week?.fraction).toBeCloseTo(4 / 7, 10)
    expect(week?.words).toBe('4 of 7 days gone')
    expect(week?.ahead).toBe(true)
    expect(timeGone(reading('seven_day', 50, NOW + 6 * DAY), NOW)?.words).toBe('1 of 7 days gone')
    expect(timeGone(reading('seven_day', 50, NOW + 6.5 * DAY), NOW)?.words).toBe(
      '12 h of 7 days gone',
    )
  })

  it('clamps to 0..1: a reset further away than the window is no time gone', () => {
    expect(timeGone(reading('five_hour', 1, NOW + 6 * HOUR), NOW)?.fraction).toBe(0)
    expect(timeGone(reading('five_hour', 1, NOW + 1), NOW)?.fraction).toBeCloseTo(1, 6)
  })

  it('ahead only when the usage figure is past the time gone; an unsaid figure is never ahead', () => {
    expect(timeGone(reading('five_hour', 51, NOW + 2.5 * HOUR), NOW)?.ahead).toBe(true)
    expect(timeGone(reading('five_hour', 50, NOW + 2.5 * HOUR), NOW)?.ahead).toBe(false)
    expect(timeGone(reading('five_hour', null, NOW + 2.5 * HOUR), NOW)?.ahead).toBe(false)
  })

  it('🔴 nothing for an unknown window, an unsaid reset, or one already past', () => {
    expect(timeGone(reading('overage', 10, NOW + HOUR), NOW)).toBeNull()
    expect(timeGone(reading('five_hour', 10, null), NOW)).toBeNull()
    expect(timeGone(reading('five_hour', 10, NOW), NOW)).toBeNull()
    expect(timeGone(reading('five_hour', 10, NOW - HOUR), NOW)).toBeNull()
    // Control: the same reading with a reset still ahead.
    expect(timeGone(reading('five_hour', 10, NOW + HOUR), NOW)).not.toBeNull()
  })
})
