const WINDOW_WORDS: ReadonlyMap<string, string> = new Map([
  ['five_hour', '5-hour'],
  ['seven_day', 'weekly'],
  ['seven_day_opus', 'weekly Opus'],
  ['seven_day_sonnet', 'weekly Sonnet'],
  ['seven_day_overage_included', 'weekly (extra usage included)'],
  ['overage', 'extra-usage'],
])

/** Native window keys lead any annotation on current or retained readings. */
export function usageWindowWord(window: string): string | null {
  return WINDOW_WORDS.get(window.split(' ')[0] ?? '') ?? null
}
