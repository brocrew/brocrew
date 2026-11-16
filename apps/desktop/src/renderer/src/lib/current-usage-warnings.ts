import { providerConditions, type ProviderCondition } from '../../../shared/provider-limit'
import type { ProviderUsageReading } from '../../../shared/runtime-ipc'
import { usageSays, usageTitle } from './usage-limit'

/** Read the current supplied warning facts, leaving retained and expired readings quiet. */
export function currentUsageWarnings(
  readings: readonly ProviderUsageReading[],
  now: number,
): ProviderCondition[] {
  return readings.flatMap((one) => {
    const warning = one.warning
    if (
      one.unconfirmed === true ||
      warning == null ||
      (warning.resetsAt !== null && warning.resetsAt <= now)
    ) {
      return []
    }
    return providerConditions([warning], now)
  })
}

/** Warning words for the caller's already-selected connection readings. */
export function connectionUsageWarning(
  readings: readonly ProviderUsageReading[] | null,
  now: number,
) {
  const warnings = currentUsageWarnings(readings ?? [], now)
  return {
    text:
      warnings.length > 0
        ? warnings.map((one) => usageSays(one, now)).join(' ')
        : readings === null
          ? 'Not read yet.'
          : 'No recorded warning attributed to this connection.',
    title: warnings.length > 0 ? warnings.map(usageTitle).join('\n') : null,
    tone: warnings.length > 0 ? 'warn' : 'note',
  }
}
