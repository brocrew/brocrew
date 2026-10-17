import { afterEach, describe, expect, it } from 'vitest'
import { whenSaid } from '../src/renderer/src/lib/work-waits'
import { clockTime } from '../src/shared/clock'
import { readLocalTimeFrom, type LocalZone } from '../src/shared/local-time'

/**
 * A recovery's time says its day where it isn't today: "at 09:00", "tomorrow at 09:00", or the day.
 * "Tomorrow" is the next date on the Mac's calendar, so a day a clock change makes 23 or 25 hours
 * long still has a tomorrow.
 */

const PARIS: LocalZone = {
  before: 3_600_000,
  changes: [],
  rule: {
    standard: 3_600_000,
    daylight: {
      offset: 7_200_000,
      starts: { month: 3, week: 5, weekday: 0, time: 7_200_000 },
      ends: { month: 10, week: 5, weekday: 0, time: 10_800_000 },
    },
  },
}

const at = (iso: string): number => Date.parse(iso)

afterEach(() => readLocalTimeFrom(() => null))

describe('a recovery time on the Mac’s calendar, in Paris', () => {
  it('the night summer time ends (a 25-hour day): 09:00 the next day is tomorrow', () => {
    readLocalTimeFrom(() => PARIS)
    // 25 Oct 2026, 00:30 in Paris (summer time) and 26 Oct, 09:00 (winter time).
    const now = at('2026-10-24T22:30:00Z')
    const resumes = at('2026-10-26T08:00:00Z')
    expect(whenSaid(resumes, now)).toBe(`tomorrow at ${clockTime(resumes)}`)
  })

  it('the night summer time starts (a 23-hour day): 09:00 the next day is tomorrow', () => {
    readLocalTimeFrom(() => PARIS)
    // 28 Mar 2026, 23:30 in Paris (winter time) and 29 Mar, 09:00 (summer time).
    const now = at('2026-03-28T22:30:00Z')
    const resumes = at('2026-03-29T07:00:00Z')
    expect(whenSaid(resumes, now)).toBe(`tomorrow at ${clockTime(resumes)}`)
  })

  it('around midnight: a minute before it is today, a minute after it is tomorrow', () => {
    readLocalTimeFrom(() => PARIS)
    // 14 Oct 2026, 23:58 in Paris.
    const now = at('2026-10-14T21:58:00Z')
    const beforeMidnight = at('2026-10-14T21:59:00Z')
    const afterMidnight = at('2026-10-14T22:01:00Z')
    expect(whenSaid(beforeMidnight, now)).toBe(`at ${clockTime(beforeMidnight)}`)
    expect(whenSaid(afterMidnight, now)).toBe(`tomorrow at ${clockTime(afterMidnight)}`)
  })

  it('two days on is named by its day, not tomorrow', () => {
    readLocalTimeFrom(() => PARIS)
    const now = at('2026-10-14T21:58:00Z')
    const later = at('2026-10-16T07:00:00Z')
    expect(whenSaid(later, now)).toMatch(/^on Fri (16 Oct|Oct 16) at /)
  })
})
