import { onMounted } from 'vue'
import type { Provider } from '@brobot2/shared'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import { providerCatalogue } from '../client-provider/catalogue'

export function useProviderNames(client: ClientProviderApi) {
  const catalogue = providerCatalogue(client)
  onMounted(() => void catalogue.read())
  return (provider: Provider): string | undefined => {
    const answer = catalogue.held.value
    return answer.state === 'answered'
      ? answer.providers.find((entry) => entry.id === provider)?.displayName
      : undefined
  }
}
