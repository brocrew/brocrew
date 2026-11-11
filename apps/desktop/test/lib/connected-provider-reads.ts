import { vi } from 'vitest'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'

export function connectedProviderReads() {
  return {
    checkProviderAuth: vi.fn<ClientProviderApi['checkProviderAuth']>(async () => ({
      state: 'usable',
      login: 'account',
      expiresAt: null,
    })),
    apiKeyStatus: vi.fn<ClientProviderApi['apiKeyStatus']>(async () => ({
      provider: 'claude',
      set: false,
      setAt: null,
      inUse: false,
    })),
  }
}
