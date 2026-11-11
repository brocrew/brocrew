import type { ProviderUsageReading } from '../../shared/runtime-ipc'
import { providerDefinitions } from './index'
import type { Provider } from '@brobot2/shared'

/** Interpret a recorded window once at the core read boundary; raw words remain on the reading. */
export function usagePeriod(provider: Provider, window: string): NonNullable<ProviderUsageReading['period']> {
  const details = providerDefinitions[provider].usageWindow(window)
  return {
    word: details.word,
    durationMs: details.lengthMs,
    bucket: details.hasBucket,
    bucketName: details.bucket,
  }
}
