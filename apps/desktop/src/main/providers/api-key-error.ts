import type { Provider } from '@brobot2/shared'

export const SAVED_KEY_UNREADABLE = 'Saved key can’t be read, save it again in Settings.'

// A saved key that can't be used stops that provider's start; it never falls back to the sign-in.
export class ApiKeyUnreadableError extends Error {
  readonly provider: Provider

  constructor(provider: Provider) {
    super(SAVED_KEY_UNREADABLE)
    this.name = 'ApiKeyUnreadableError'
    this.provider = provider
  }
}
