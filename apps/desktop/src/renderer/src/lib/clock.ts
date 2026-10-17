import { MAX_INSTANT } from '../../../shared/clock'
import { localFormat } from '../../../shared/local-time'

/**
 * How a recorded moment reads on screen.
 *
 * The transcript shows a clock time and nothing more — a conversation is read top to bottom, so
 * the date is noise on every line until you go looking for it. The full instant is kept for the
 * tooltip, where it costs nothing.
 *
 * ⚑ **D-017 · R11 — the clock time is `shared/clock.ts`'s `clockTime`**, moved there so an agent's
 * state says *"scheduled · 04:53"* in `main` exactly as the window draws it. The tooltip's
 * {@link fullTime} and {@link agoWords} stay here, and the notes below hold for both formatters.
 *
 * Both are rendered on the Mac's own clock deliberately (D-031, `shared/local-time.ts`): these are
 * timestamps for a person sitting in front of the machine, not for correlating logs across
 * timezones — so they read as the menu bar does, and the exact instant is always one hover away.
 *
 * ## ⛔ The formatters are built ONCE per offset, and that is 97% of the number `212` recorded (255)
 *
 * ⚠️ **Measured, in Chromium, on the corpus the Events tab holds at its cap** — re-derive with
 * `pnpm run probe:event-fold`. `clockTime` over 5,000 events cost **140-146 ms** and the same 5,000
 * through a REUSED `Intl.DateTimeFormat` cost **3.8-4.0 ms** — 36× — while `new Date(…)` alone cost
 * 13.2 ms and `describeEvent`, the function beside it on the same row, cost under a millisecond.
 * ⛔ So `212`'s *"opening Events at the cap mounts every row
 * — 148-171 ms"* was not the row count paying for five elements; it was one `Intl.DateTimeFormat`
 * constructed five thousand times. `Date.prototype.toLocaleTimeString` builds a fresh one on every
 * call, and V8's internal cache does not survive the `undefined` locale plus a fresh options object.
 *
 * ⚑ **Lazy rather than at module load**, so importing this file costs nothing and the locale is
 * resolved the first time a time is actually shown.
 *
 * ⚠️ **The options are SPELLED OUT because the two APIs do not default alike.** `toLocaleString()`
 * with no options resolves through `ToDateTimeOptions(…, "any", "all")` and yields
 * year/month/day/hour/minute/second; `new Intl.DateTimeFormat(locale)` defaults to `"date"` and
 * would silently drop the time. ⛔ That equivalence is not left to this comment —
 * `test/clock-format.test.ts` asserts both functions against the `Date` methods they replace, so a
 * wrong option set is a red rather than a tooltip nobody reads.
 *
 * ⚠️ **The guard had to WIDEN, and this is the one place the two APIs are not interchangeable.**
 * `Date.prototype.toLocaleTimeString` on an out-of-range time value returns the string
 * `"Invalid Date"`; `Intl.DateTimeFormat.prototype.format` runs `TimeClip` and **throws a
 * `RangeError`** past {@link MAX_INSTANT}. `Number.isFinite` lets those through — `9e15` is finite
 * — so a bundle carrying one would have thrown inside a Vue render, on a surface with no error
 * boundary, and blanked the transcript where the old code printed a wrong-looking string. ⛔ A
 * moment that is not one now reads as the empty string, which is what this function already
 * promised for every other unusable input. Found by the adversarial pass over 255's own diff.
 */

const fullFormat = localFormat({
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** The whole moment, for the tooltip — seconds included, because turns are fast. */
export function fullTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) return ''
  return fullFormat(at)
}

const dayFormat = localFormat({ year: 'numeric', month: 'numeric', day: 'numeric' })

/**
 * ⚑ **D-031 · the day alone** — `toLocaleDateString()`'s own options, on the Mac's calendar, behind
 * {@link fullTime}'s guard.
 */
export function calendarDay(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) return ''
  return dayFormat(at)
}

/**
 * "4m ago" — precise enough to pick the right conversation out of a list, without a date library.
 *
 * ⚑ **Lifted OUT of `ResumableSessions.vue` in 151, unchanged**, because the rail's closed rows now
 * say the same thing about the same rows and a second copy of the thresholds would be two answers
 * to one question, six inches apart, which is 099 in miniature.
 *
 * ⚠️ **`SessionLibrary` keeps its own and that is deliberate, not an oversight.** Its version starts
 * at minutes and turns to days at 48 hours, because that list is BANDED by day (`recencyOf`) and a
 * row reading "43s ago" under a "Today" heading is a precision the surface around it does not have.
 * Merging them would change one of the two surfaces' words, which is a behaviour change neither
 * this ticket nor `120` asked for. Two functions, two documented audiences — not one fact derived
 * twice.
 *
 * `now` is a parameter so a test can state the instant instead of racing the wall clock.
 */
export function agoWords(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}
