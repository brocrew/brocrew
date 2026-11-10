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
