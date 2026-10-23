import { providerRecord, SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import type { ProviderVersion } from '../../shared/runtime-ipc'

/**
 * How long a program gets to say its version; SIGKILL after it, as `--version` has nothing to clean
 * up. A large program read for the first time (on Windows, scanned first) can take seconds before it
 * prints anything.
 */
export const VERSION_TIMEOUT_MS = 15_000

/** Start each read in registry order, then retain the existing ordered await and output keys. */
export function orderedProgramVersions(
  readers: Readonly<Record<Provider, () => Promise<ProviderVersion>>>,
): () => Promise<Readonly<Record<Provider, ProviderVersion>>> {
  return async () => {
    const pending = providerRecord((provider) => readers[provider]())
    const answer = {} as Record<Provider, ProviderVersion>
    for (const provider of SUPPORTED_PROVIDERS) answer[provider] = await pending[provider]
    return answer
  }
}
