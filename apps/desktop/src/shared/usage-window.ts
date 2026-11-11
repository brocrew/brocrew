export interface UsageWindowDetails {
  readonly word: string | null
  readonly lengthMs: number | null
  readonly bucket: string | null
  /** Parentheses anywhere exclude a reading from the aggregate window's cells. */
  readonly hasBucket: boolean
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
