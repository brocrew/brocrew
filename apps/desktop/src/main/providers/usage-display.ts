import { usageWarnings } from '../../shared/provider-limit'
import type { Provider, ProviderUsageReading } from '../../shared/runtime-ipc'
import { usagePeriod } from './usage-period'

/** Supply current warning decisions without changing the readings kept on disk. */
export function usageForDisplay(
  provider: Provider,
  readings: readonly ProviderUsageReading[],
  unconfirmed: boolean,
  now: number,
): readonly ProviderUsageReading[] {
  const shown = readings.map(
    ({ window, usedPercent, resetsAt, at, period, unconfirmed: kept }) => ({
      window,
      usedPercent,
      resetsAt,
      at,
      period: period ?? usagePeriod(provider, window),
      ...(unconfirmed || kept === true ? { unconfirmed: true as const } : {}),
    }),
  )
  const warnings = new Map(
    usageWarnings({ [provider]: shown.filter((one) => one.unconfirmed !== true) }, [], now).map(
      ({ reading, wall }) => [reading, wall],
    ),
  )
  return shown.map((reading) => ({ ...reading, warning: warnings.get(reading) ?? null }))
}
