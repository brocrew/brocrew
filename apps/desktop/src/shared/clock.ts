import { localFormat, sameLocalDay } from './local-time'

/**
 * ⚑ **D-017 · R11 — a recorded moment as a clock time, on the Mac's clock** (D-031,
 * `local-time.ts`) — the one formatter every surface that says *when* reads, in the window and in
 * `main` alike, so *"scheduled · 04:53"* is one string wherever it is shown, and reads as the menu
 * bar does. ⚑ D-029 · {@link clockTimeFrom} says it with its day, where that day may not be today.
 *
 * ⛔ **Each formatter is built ONCE per offset** (`255`, `localFormat`):
 * `Date.prototype.toLocaleTimeString` builds a fresh `Intl.DateTimeFormat` on every call, which cost
 * 36× on the Events tab at its cap. ⚑ Lazy, so importing this file costs nothing.
 *
 * ⚠️ **The guard is wider than `Number.isFinite`**: `Intl.DateTimeFormat.prototype.format` throws a
 * `RangeError` past ECMA-262's `TimeClip` bound, so a moment that is not one reads as the empty
 * string, as every other unusable input does.
 */

/**
 * ECMA-262's `TimeClip` bound. Past it `Intl.DateTimeFormat.format` throws rather than answering —
 * the window's `fullTime` guards on the same number.
 */
export const MAX_INSTANT = 8.64e15

const clockFormat = localFormat({ hour: '2-digit', minute: '2-digit' })

export function clockTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) return ''
  return clockFormat(at)
}

const dayAndClockFormat = localFormat({
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * ⚑ **D-029 · a recorded moment, said as of another** — {@link clockTime}'s time when the two fall
 * on one day of the Mac's calendar, and the day before it when they do not: a job that came due
 * while nothing ran may have been due yesterday, and a bare time reads as today's. ⛔ Built once per
 * offset, lazily, for {@link clockTime}'s reason; ⚑ and `clockTime`'s guard decides what is no
 * moment at all.
 */
export function clockTimeFrom(at: number, now: number): string {
  const time = clockTime(at)
  if (time === '' || sameLocalDay(at, now)) return time
  return dayAndClockFormat(at)
}
