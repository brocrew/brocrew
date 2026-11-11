import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'
import { useClientProviders } from '../client-provider/injection'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import type { Provider, ProviderUsageReading } from '../../../shared/runtime-ipc'

export type ProviderUsage = Readonly<Record<Provider, readonly ProviderUsageReading[]>>

/**
 * Each client's newest usage readings; the desktop client shares one holder across the window.
 *
 * Read when the first surface needs them and again on each `usage` notice, as the Providers screen
 * reads them: no timer. `null` until the first read answers; a refused read keeps the last answer.
 * The notice is listened to while at least one surface is using the readings.
 */
function createUsage(api: ClientProviderApi) {
  const usage = shallowRef<ProviderUsage | null>(null)
  let users = 0
  let stopListening: (() => void) | undefined
  let reading = 0

  async function readUsage(): Promise<void> {
    const ours = ++reading
    try {
      const next = await api.providerUsage()
      if (ours === reading) usage.value = next
    } catch {
      // The last good answer stays; the next notice asks again.
    }
  }

  return function useUsage(): Readonly<ShallowRef<ProviderUsage | null>> {
    users += 1
    if (users === 1) {
      void readUsage()
      try {
        stopListening = api.onProvidersChanged((message) => {
          if (message.what === 'usage' || message.what === 'login') void readUsage()
        })
      } catch {
        // A window without the bridge shows the readings as not read yet.
        stopListening = undefined
      }
    }
    onScopeDispose(() => {
      users -= 1
      if (users === 0) {
        reading++
        stopListening?.()
        stopListening = undefined
      }
    })
    return usage
  }
}

const shared = new WeakMap<ClientProviderApi, ReturnType<typeof createUsage>>()

export function useProviderUsage(): Readonly<ShallowRef<ProviderUsage | null>> {
  const api = useClientProviders()
  let useUsage = shared.get(api)
  if (!useUsage) {
    useUsage = createUsage(api)
    shared.set(api, useUsage)
  }
  return useUsage()
}
