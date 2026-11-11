import type { ProviderUsageReading } from '../../shared/runtime-ipc'
import { usageWindowDetails } from '../../shared/usage-window'

/** Interpret a recorded window once at the core read boundary; raw words remain on the reading. */
export function usagePeriod(window: string): NonNullable<ProviderUsageReading['period']> {
  const details = usageWindowDetails(window)
  return {
    word: details.word,
    durationMs: details.lengthMs,
    bucket: details.hasBucket,
    bucketName: details.bucket,
  }
}
