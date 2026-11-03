import type { ProviderConnection } from '@brobot2/shared'

/** Declared compatibility metadata for renderer tests; it reads no provider state. */
export function compatibilityConnections(): ProviderConnection[] {
  return (['claude', 'codex'] as const).map((provider) => ({
    id: `${provider}:sign-in`,
    provider,
    name: 'Fictional subscription',
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }))
}
