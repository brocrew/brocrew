/**
 * ⚑ **A metered window, in a person's words** — Claude's `rateLimitType` (`seven_day` → *weekly*),
 * Codex's duration (*"a 7-day window"* → *weekly*); `null` for one this app has no word for, which
 * then names no limit. ⚑ One reading of a window's name for every surface: the Providers screen, the
 * band of limits, and what an agent is told (`list_profiles`).
 */
export function usageWindowWord(window: string): string | null {
  // ⚑ Claude's `rateLimitType` leads what `readProviderLimit` read — the parenthetical.
  const named = CLAUDE_WINDOW.get(window.split(' ')[0] ?? '')
  if (named !== undefined) return named
  // ⚑ Codex says a duration — *"95% of a 7-day window used"* — after any bucket it named.
  const days = /\ba (\d+)-day window\b/.exec(window)?.[1]
  if (days !== undefined) return days === '7' ? 'weekly' : days === '1' ? 'daily' : `${days}-day`
  const hours = /\ba (\d+)-hour window\b/.exec(window)?.[1]
  if (hours !== undefined) return `${hours}-hour`
  return null
}

/** ⚑ Claude's own window names — `rate_limit_info.rateLimitType`, and its `unifiedWindows` keys. */
const CLAUDE_WINDOW: ReadonlyMap<string, string> = new Map([
  ['five_hour', '5-hour'],
  ['seven_day', 'weekly'],
  ['seven_day_opus', 'weekly Opus'],
  ['seven_day_sonnet', 'weekly Sonnet'],
  ['seven_day_overage_included', 'weekly (extra usage included)'],
  ['overage', 'extra-usage'],
])
