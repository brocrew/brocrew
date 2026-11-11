/** Retained diagnostics name durations, optionally after a metered bucket's name. */
export function usageWindowWord(window: string): string | null {
  const days = /\ba (\d+)-day window\b/.exec(window)?.[1]
  if (days !== undefined) return days === '7' ? 'weekly' : days === '1' ? 'daily' : `${days}-day`
  const hours = /\ba (\d+)-hour window\b/.exec(window)?.[1]
  return hours !== undefined ? `${hours}-hour` : null
}
