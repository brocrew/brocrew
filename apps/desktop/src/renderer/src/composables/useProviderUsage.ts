import { onScopeDispose, shallowRef, type ShallowRef } from 'vue'
import type { Provider, ProviderUsageReading } from '../../../shared/runtime-ipc'

export type ProviderUsage = Readonly<Record<Provider, readonly ProviderUsageReading[]>>

/**
 * Each provider's newest usage readings, shared by every surface in the window that shows them.
 *
 * Read when the first surface needs them and again on each `usage` notice, as the Providers screen
 * reads them: no timer. `null` until the first read answers; a refused read keeps the last answer.
 * The notice is listened to while at least one surface is using the readings.
 */
const usage = shallowRef<ProviderUsage | null>(null)
let users = 0
let stopListening: (() => void) | undefined

async function readUsage(): Promise<void> {
  try {
    usage.value = await window.api.runtime.providerUsage()
  } catch {
    // The last good answer stays; the next notice asks again.
  }
}

export function useProviderUsage(): Readonly<ShallowRef<ProviderUsage | null>> {
  users += 1
  if (users === 1) {
    void readUsage()
    try {
      stopListening = window.api.runtime.onProvidersChanged((message) => {
        if (message.what === 'usage') void readUsage()
      })
    } catch {
      // A window without the bridge shows the readings as not read yet.
      stopListening = undefined
    }
  }
  onScopeDispose(() => {
    users -= 1
    if (users === 0) {
      stopListening?.()
      stopListening = undefined
    }
  })
  return usage
}
