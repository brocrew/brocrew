/** A moment on the Mac's wall clock in 2026, whatever the zone. */
export const local = (
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number => new Date(2026, month - 1, day, hour, minute, second).getTime()
