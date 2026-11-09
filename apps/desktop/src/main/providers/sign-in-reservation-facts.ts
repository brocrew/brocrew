import type { Provider } from '@brobot2/shared'
import { providerDefinitions } from './index'

export function signInKey(provider: Provider, profileId: string): string {
  return providerDefinitions[provider].signInKey(profileId)
}

export function signInHeldBy(provider: Provider, holder: string, asked: string): Error {
  return providerDefinitions[provider].signInConflict(holder, asked)
}
