import { providerRecord, SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import type { ProviderVersion } from '@brobot2/runtime/provider-module'
export type { ProviderProgramOperations } from '@brobot2/runtime/provider-module'

/**
 * How long a program gets to say its version; SIGKILL after it, as `--version` has nothing to clean
 * up. A large program read for the first time (on Windows, scanned first) can take seconds before it
 * prints anything.
 */
export const VERSION_TIMEOUT_MS = 15_000

/** Start each read in registry order, then retain the existing ordered await and output keys. */
export function orderedProgramVersions(
  readers: Readonly<Partial<Record<Provider, () => Promise<ProviderVersion>>>>,
): () => Promise<Readonly<Record<Provider, ProviderVersion>>> {
  return async () => {
    const pending = providerRecord((provider) => {
      const read = readers[provider]
      return read === undefined
        ? Promise.resolve<ProviderVersion>({
            version: null,
            reason: 'This provider does not publish a program version.',
          })
        : read()
    })
    const answer = {} as Record<Provider, ProviderVersion>
    for (const provider of SUPPORTED_PROVIDERS) answer[provider] = await pending[provider]
    return answer
  }
}
