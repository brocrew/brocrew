import { usageWindowDetails, type UsageWindowDetails } from '../../../shared/usage-window'

const WINDOW_WORDS: ReadonlyMap<string, string> = new Map([
  ['five_hour', '5-hour'],
  ['seven_day', 'weekly'],
  ['seven_day_opus', 'weekly Opus'],
  ['seven_day_sonnet', 'weekly Sonnet'],
  ['seven_day_overage_included', 'weekly (extra usage included)'],
  ['overage', 'extra-usage'],
])

/** The native window key leads any bucket annotation in current and retained readings. */
export function usageWindow(window: string): UsageWindowDetails {
  return usageWindowDetails(window, WINDOW_WORDS.get(window.split(' ')[0] ?? '') ?? null)
}
