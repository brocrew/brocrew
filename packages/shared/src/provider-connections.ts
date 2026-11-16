import type { Provider } from './providers'
import type { ConnectionAuthMethod, ConnectionCredentialSource } from './provider-capabilities'
export type {
  ConnectionAuthMethod,
  ConnectionCredentialSource,
  ProviderConnectionCapabilities,
} from './provider-capabilities'

/** A reference to configuration; never a credential or a provider/agent state directory. */
export interface ProviderConnection {
  readonly id: string
  readonly provider: Provider
  readonly name: string
  readonly description?: string | null
  readonly authMethod: ConnectionAuthMethod
  readonly credentialSource: ConnectionCredentialSource
  readonly baseUrl: string | null
  readonly enabled: boolean
  readonly contractVersion: 1
}

/** Stable identifiers have no dependency on this computer's paths or login identity. */
export function compatibilityConnectionId(
  provider: Provider,
  method: ConnectionAuthMethod,
): string {
  return `${provider}:${method}`
}

/**
 * The two built-in modes retain the existing local home and provider catalogue. A key using
 * that default home is accepted under the existing local account/machine compatibility rule.
 * Separating these modes later requires a migration of their recorded homes.
 */
export function additionalConnectionId(
  provider: Provider,
  connectionId?: string | null,
): string | undefined {
  return connectionId == null ||
    connectionId === compatibilityConnectionId(provider, 'sign-in') ||
    connectionId === compatibilityConnectionId(provider, 'api-key')
    ? undefined
    : connectionId
}
