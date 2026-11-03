import type { Provider } from './providers'

export type ConnectionAuthMethod = 'sign-in' | 'api-key'
export type ConnectionCredentialSource = 'provider-sign-in' | 'provider-api-key'

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

/** Static adapter capabilities, separate from mutable configuration and program versions. */
export interface ProviderConnectionCapabilities {
  readonly contractVersion: 1
  readonly authMethods: readonly ConnectionAuthMethod[]
  readonly protocol: 'claude-agent-sdk' | 'codex-app-server'
  readonly versionSource: 'sdk' | 'app-server'
  readonly additionalConnections: false
}

/** Stable identifiers have no dependency on this computer's paths or login identity. */
export function compatibilityConnectionId(provider: Provider, method: ConnectionAuthMethod): string {
  return `${provider}:${method}`
}
