import { vi } from 'vitest'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { ProvidersChangedMessage } from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'

export function usageClient() {
  const listeners = new Set<(message: ProvidersChangedMessage) => void>()
  const read = vi.fn<ClientProviderApi['providerUsage']>(async () => ({ claude: [], codex: [] }))
  const off = vi.fn()
  const subscribe = vi.fn<ClientProviderApi['onProvidersChanged']>((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      off()
    }
  })
  const api = {
    ...createDesktopProviderApi(
      (): never => {
        throw new Error('Unexpected provider door')
      },
      () => undefined,
    ),
    providerUsage: read,
    onProvidersChanged: subscribe,
  }
  return {
    api,
    read,
    off,
    subscribe,
    listeners,
    notice(what: ProvidersChangedMessage['what']) {
      for (const listener of [...listeners]) listener({ what, provider: 'claude' })
    },
  }
}
