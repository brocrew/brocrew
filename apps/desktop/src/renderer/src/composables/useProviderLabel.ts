import type { Provider } from '@brobot2/shared'
import { useClientApi } from '../client-provider/injection'
import { useProviderNames } from './useProviderNames'

/**
 * How the window says a provider's name: only the name the Client API's catalogue supplies. Until
 * the catalogue has answered, or for a provider it does not list, it is the empty string: the name
 * appears when the catalogue answers, and no word is made up meanwhile. `ProviderLabel` draws it; a
 * hover or an accessible name that needs it as text reads it here.
 */
export function useProviderLabel(): (provider: Provider) => string {
  const nameOf = useProviderNames(useClientApi())
  return (provider) => nameOf(provider) ?? ''
}
