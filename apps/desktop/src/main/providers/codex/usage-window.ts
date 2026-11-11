import { usageWindowDetails, type UsageWindowDetails } from '../../../shared/usage-window'

/** Retained diagnostics name durations, optionally after a metered bucket's name. */
export function usageWindow(window: string): UsageWindowDetails {
  const days = /\ba (\d+)-day window\b/.exec(window)?.[1]
  const hours = /\ba (\d+)-hour window\b/.exec(window)?.[1]
  const word =
    days !== undefined
      ? days === '7'
        ? 'weekly'
        : days === '1'
          ? 'daily'
          : `${days}-day`
      : hours !== undefined
        ? `${hours}-hour`
        : null
  const details = usageWindowDetails(window, word)
  return /^its (primary|secondary) window$/.test(window)
    ? { ...details, warningWindow: 'this window' }
    : details
}
