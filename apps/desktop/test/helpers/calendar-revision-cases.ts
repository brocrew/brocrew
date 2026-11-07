import { expect, it } from 'vitest'
import { hostCalendar } from '../../src/main/runtime/schedule-evidence'
import { nextCronOccurrence } from '../../src/shared/schedule-wake'
import { readLocalTimeFrom, type LocalZone } from '../../src/shared/local-time'

export function registerCalendarRevisionCases(Z_UTC: LocalZone, Z_NP: LocalZone): void {
  it('a scheduled job is placed on the Mac wall clock, and another zone is another calendar', () => {
    const from = Date.UTC(2026, 9, 1, 12, 0)
    const next = (zone: typeof Z_UTC): number | null => {
      readLocalTimeFrom(() => zone)
      const found = nextCronOccurrence('0 3 * * *', {
        after: from,
        inclusive: false,
        zone: 'UTC',
        calendar: hostCalendar(zone),
      })
      return found.kind === 'known' ? found.nominalAt : null
    }
    expect(next(Z_UTC)).toBe(Date.UTC(2026, 9, 2, 3, 0))
    // ⚑ The same expression and the same `from` in another zone: 03:00 at +5:45 is 21:15 UTC.
    expect(next(Z_NP)).toBe(Date.UTC(2026, 9, 1, 21, 15))
    // ⚑ A zone that moved is another version of the calendar, so a time placed on the one before
    // is placed again; the same zone read twice is the same one.
    expect(hostCalendar(Z_NP).version).not.toBe(hostCalendar(Z_UTC).version)
    expect(hostCalendar(Z_NP).version).toBe(hostCalendar({ ...Z_NP }).version)
    expect(hostCalendar(null).version).not.toBe(hostCalendar(Z_UTC).version)
  })

  it('persists the complete calendar revision across restart and distinguishes transition and rule changes', () => {
    const zone: LocalZone = {
      ...Z_UTC,
      changes: Array.from({ length: 400 }, (_, i) => ({
        at: Date.UTC(1800 + i, 0, 1),
        offset: (i % 2) * 3_600_000,
      })),
      rule: {
        standard: 0,
        daylight: {
          offset: 3_600_000,
          starts: { month: 3, week: 5, weekday: 0, time: 7_200_000 },
          ends: { month: 10, week: 5, weekday: 0, time: 7_200_000 },
        },
      },
    }
    const version = hostCalendar(zone).version
    expect(version.length).toBeLessThanOrEqual(16_384)
    expect(hostCalendar(JSON.parse(JSON.stringify(zone))).version).toBe(version)
    expect(
      hostCalendar({
        ...zone,
        changes: [
          ...zone.changes.slice(0, -1),
          { at: zone.changes.at(-1)!.at + 1, offset: zone.changes.at(-1)!.offset },
        ],
      }).version,
    ).not.toBe(version)
    expect(hostCalendar({ ...zone, rule: null }).version).not.toBe(version)
    expect(hostCalendar({ ...zone, before: 1 }).version).not.toBe(version)
    expect(JSON.parse(version)[1]).toHaveLength(400)
  })
}
