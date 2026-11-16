import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { useProviderNames } from './useProviderNames'
import { useClientProviders } from '../client-provider/injection'

/** Metadata shared by connection labels; this does not prepare a provider. */
export function useProviderConnections() {
  const client = useClientProviders()
  const connections = shallowRef<readonly ProviderConnection[]>([])
  let open = true
  let asked = 0
  let stopListening: (() => void) | undefined
  async function read(): Promise<void> {
    const mine = ++asked
    try {
      const rows = await client.providerConnections()
      if (open && mine === asked) connections.value = rows
    } catch {
      // Recorded identity survives an unavailable metadata read.
    }
  }
  onMounted(() => {
    void read()
    try {
      stopListening = client.onProvidersChanged((message) => {
        if (message.what === 'login' || message.what === 'key' || message.what === 'connections')
          void read()
      })
    } catch {
      // Clients without notices still show the first metadata read.
    }
  })
  onBeforeUnmount(() => {
    open = false
    asked++
    stopListening?.()
  })
  return connections
}

export function useConversationConnectionLabel(
  session: () => { readonly provider: Provider; readonly connectionId?: string } | null,
  fallback: () => string | undefined,
) {
  const connections = useProviderConnections()
  const providerName = useProviderNames(useClientProviders())
  return computed(() => {
    const current = session()
    if (!current) return fallback() ?? ''
    const connection = connections.value.find(
      (row) => row.provider === current.provider && row.id === current.connectionId,
    )
    return connection
      ? `${providerName(current.provider) ?? current.provider} · ${connection.name}`
      : current.provider
  })
}
