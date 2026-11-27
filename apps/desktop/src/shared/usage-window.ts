export interface UsageWindowDetails {
  readonly word: string | null
  readonly lengthMs: number | null
  readonly bucket: string | null
  /** Parentheses anywhere exclude a reading from the aggregate window's cells. */
  readonly hasBucket: boolean
  /** Provider-owned identity for a derived warning; absent means keep the raw window. */
  readonly warningWindow?: string
}

/** Generic display geometry for a word supplied by the window's provider. */
export function usageWindowDetails(window: string, word: string | null): UsageWindowDetails {
  return {
    word,
    lengthMs: windowDuration(word),
    bucket: /\(([^)]+)\)\s*$/.exec(window)?.[1] ?? null,
    hasBucket: window.includes('('),
  }
}

/** The windows the title bar's usage cells draw, by period word, with the short name a cell uses. */
export const TITLE_BAR_WINDOWS = [
  { word: '5-hour', short: '5h' },
  { word: 'weekly', short: 'week' },
] as const

/** Whether the title bar draws a reading of this period: one of its words, and no bucket's. */
export function drawnInTheTitleBar(period: {
  readonly word: string | null
  readonly bucket: boolean
}): boolean {
  return !period.bucket && TITLE_BAR_WINDOWS.some((one) => one.word === period.word)
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

function windowDuration(word: string | null): number | null {
  if (word === null) return null
  if (word.startsWith('weekly')) return 7 * DAY
  if (word === 'daily') return DAY
  const said = /^(\d+)-(hour|day)$/.exec(word)
  if (said === null || Number(said[1]) <= 0) return null
  return Number(said[1]) * (said[2] === 'hour' ? HOUR : DAY)
}
