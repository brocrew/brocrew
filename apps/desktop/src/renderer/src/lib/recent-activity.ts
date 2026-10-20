import { clockTime } from '../../../shared/clock'
import { localFields, localFormat, sameLocalDay } from '../../../shared/local-time'
import type { ActivityLine, RecentActivityReading } from '../../../shared/recent-activity'

/**
 * The windows Recent activity offers: four named spans, not a duration a person types, since a
 * read's cost grows with its span.
 */
export const ACTIVITY_WINDOWS = [
  { label: 'hour', ms: 3_600_000 },
  { label: '12 hours', ms: 12 * 3_600_000 },
  { label: '24 hours', ms: 24 * 3_600_000 },
  { label: '7 days', ms: 7 * 24 * 3_600_000 },
] as const

export const DEFAULT_ACTIVITY_WINDOW_MS = 12 * 3_600_000

/** How often a window reads activity again while a page that shows it is open. */
export const ACTIVITY_READ_EVERY_MS = 30_000

/** What each kind of line says after the agent's name. */
export const WHAT_WORDS: Readonly<Record<ActivityLine['what'], string>> = {
  finished: 'reported done',
  failed: 'failed',
  started: 'started',
  stopped: 'stopped',
}

/** How a line is known, on the line: an outcome the agent reported is not one this app checked. */
export const REGISTER_SAYS: Readonly<Record<ActivityLine['register'], string>> = {
  observed: 'This app recorded this.',
  claimed: 'The agent reported this; nothing in this app checked it.',
}

/** The icon each kind of line draws, from the window's sprite. */
export const WHAT_ICON: Readonly<Record<ActivityLine['what'], string>> = {
  finished: '#i-check',
  failed: '#i-alert',
  started: '#i-play',
  stopped: '#i-pause',
}

/**
 * What a reading has to say about itself: not read yet (which is not "nothing happened"), read in
 * part (some rows or ledgers could not be read), read whole and empty, or lines.
 */
export type ActivitySays = 'not-read' | 'read-in-part' | 'nothing-recorded' | 'lines'

export function activitySays(reading: RecentActivityReading | null): ActivitySays {
  if (reading === null) return 'not-read'
  if (reading.read.rowsUnread > 0 || (reading.read.ledgersSkipped ?? 0) > 0) return 'read-in-part'
  return reading.lines.length === 0 &&
    !reading.transcriptsCleared?.length &&
    !reading.skillImports?.length
    ? 'nothing-recorded'
    : 'lines'
}

const dayFormat = localFormat({ weekday: 'long', day: 'numeric', month: 'long' })

/** The local calendar date of an instant, as one comparable number. */
function calendarDay(at: number): number {
  const { year, month, date } = localFields(at)
  return Date.UTC(year, month, date)
}

/**
 * "Today", "Yesterday", or nothing, for the day a line is on: calendar days on the Mac's clock, so
 * a day that is 23 or 25 hours long around a clock change is still one day.
 */
export function dayWord(at: number, now: number): string | null {
  const day = calendarDay(at)
  const today = calendarDay(now)
  if (day === today) return 'Today'
  if (day === today - 24 * 3_600_000) return 'Yesterday'
  return null
}

export interface ActivityDay {
  readonly key: string
  /** "Today", "Yesterday", or `null` for an older day. */
  readonly word: string | null
  /** "Friday, 16 October". */
  readonly date: string
  readonly lines: readonly ActivityLine[]
}

/** The lines, newest first, grouped by the local day they happened on. */
export function byDay(lines: readonly ActivityLine[], now: number): ActivityDay[] {
  const days: ActivityDay[] = []
  for (const line of [...lines].sort((a, b) => b.at - a.at)) {
    const date = dayFormat(line.at)
    const last = days.at(-1)
    if (last !== undefined && last.date === date) {
      ;(last.lines as ActivityLine[]).push(line)
      continue
    }
    days.push({ key: date, word: dayWord(line.at, now), date, lines: [line] })
  }
  return days
}

/** How many lines "Since you were last here" shows before sending the person to the page. */
export const SINCE_SHOWN = 5

export interface SinceView {
  /** Finished and failed since the person was last here, newest first, at most {@link SINCE_SHOWN}. */
  readonly lines: readonly ActivityLine[]
  /** Every one there was, counted before the cap. */
  readonly finished: number
  readonly failed: number
  /** Some of the record could not be read, so there may be more. */
  readonly partial: boolean
  /** The read stopped at its newest lines, so older ones since then may be missing. */
  readonly capped: boolean
}

/**
 * What finished or failed since `since`, or `null` when there is nothing honest to say: no
 * last-seen record, or no reading yet.
 */
export function sinceView(
  reading: RecentActivityReading | null,
  since: number | null,
): SinceView | null {
  if (reading === null || since === null) return null
  const outcomes = reading.lines
    .filter((line) => line.at >= since && (line.what === 'finished' || line.what === 'failed'))
    .sort((a, b) => b.at - a.at)
  return {
    lines: outcomes.slice(0, SINCE_SHOWN),
    finished: outcomes.filter((line) => line.what === 'finished').length,
    failed: outcomes.filter((line) => line.what === 'failed').length,
    partial: activitySays(reading) === 'read-in-part',
    capped: reading.capped,
  }
}

/**
 * "Today, since 09:10 · 2 reported done · 1 failed". "Nothing finished or failed" is said only
 * over a whole, uncapped read: over any other, finding none is not knowing there was none.
 */
export function sinceWords(view: SinceView, since: number, now: number): string {
  const when = sameLocalDay(since, now)
    ? `Today, since ${clockTime(since)}`
    : `Since ${dayFormat(since)}, ${clockTime(since)}`
  const counts = [
    view.finished > 0 ? `${String(view.finished)} reported done` : null,
    view.failed > 0 ? `${String(view.failed)} failed` : null,
  ].filter((part): part is string => part !== null)
  if (counts.length > 0) return `${when} · ${counts.join(' · ')}`
  return view.partial || view.capped ? when : `${when} · nothing finished or failed`
}

/** "W1.3 · Check the release notes", or the label alone when the piece has no title. */
export function pieceWords(line: ActivityLine): string {
  return line.piece.title === null ? line.piece.label : `${line.piece.label} · ${line.piece.title}`
}
