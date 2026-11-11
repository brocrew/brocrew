import { providerConditions, type ProviderCondition } from '../../../shared/provider-limit'
import type { ProviderUsageReading } from '../../../shared/runtime-ipc'

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
