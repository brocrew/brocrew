import { providerDescriptor, providerRecord, type Provider } from '@brobot2/shared'

export type WhyUnreadable = 'storage-not-answering' | 'sealed-with-another-key' | 'not-known'

export const PROVIDER_CARD: Readonly<Record<Provider, string>> = providerRecord(
  (provider) => providerDescriptor(provider).displayName,
)

// A saved key that cannot open must refuse launch instead of falling back to a login.
export class ApiKeyUnreadableError extends Error {
  readonly provider: Provider

  constructor(
    provider: Provider,
    platform: NodeJS.Platform = process.platform,
    why: WhyUnreadable = 'not-known',
  ) {
    const card = PROVIDER_CARD[provider]
    super(
      `BroCrew can’t read the API key saved for ${card} on this computer. ` +
        (platform === 'darwin' ? SAID_ON_A_MAC[why] : '') +
        `Save it again under “API key” ` +
        `on the ${card} card in Providers, or remove it there to use your sign-in instead.`,
    )
    this.name = 'ApiKeyUnreadableError'
    this.provider = provider
  }
}

const SAID_ON_A_MAC: Readonly<Record<WhyUnreadable, string>> = {
  'storage-not-answering': 'macOS may be waiting for permission to read its saved key. ',
  'sealed-with-another-key':
    'It was saved with a Keychain entry this version of BroCrew doesn’t have. ',
  'not-known': '',
}
