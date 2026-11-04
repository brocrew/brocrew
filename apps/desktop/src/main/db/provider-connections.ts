import {
  compatibilityConnectionId,
  PROVIDER_DESCRIPTORS,
  type ConnectionAuthMethod,
  type Provider,
  type ProviderConnection,
} from '@brobot2/shared'
import type { AppDatabase } from './connection'

interface ConnectionRow {
  id: string
  provider: string
  name: string
  auth_method: string
  credential_source: string
  base_url: string | null
  enabled: number
  contract_version: number
}

/** Only metadata is inspected; the existing key service remains the sole credential reader. */
function hasSavedKey(db: AppDatabase, provider: Provider): boolean {
  return db.prepare('SELECT 1 FROM provider_api_key WHERE provider = ?').get(provider) !== undefined
}

function compatibilityRecord(
  db: AppDatabase,
  provider: Provider,
  method: ConnectionAuthMethod,
): ProviderConnection | null {
  const row = db
    .prepare(
      `SELECT id, provider, name, auth_method, credential_source, base_url, enabled, contract_version
     FROM provider_connection WHERE id = ?`,
    )
    .get(compatibilityConnectionId(provider, method)) as ConnectionRow | undefined
  const source = method === 'api-key' ? 'provider-api-key' : 'provider-sign-in'
  if (
    !row ||
    row.provider !== provider ||
    row.auth_method !== method ||
    row.credential_source !== source ||
    row.base_url !== null ||
    row.enabled !== 1 ||
    row.contract_version !== 1 ||
    !row.name.trim()
  )
    return null
  if (method === 'api-key' && !hasSavedKey(db, provider)) return null
  return {
    id: row.id,
    provider,
    name: row.name,
    authMethod: method,
    credentialSource: source,
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

/** No probe, setup or directory access; additional rows remain unavailable until qualified. */
export function listProviderConnections(db: AppDatabase, provider: Provider): ProviderConnection[] {
  return (['sign-in', 'api-key'] as const).flatMap((method) => {
    const record = compatibilityRecord(db, provider, method)
    return record ? [record] : []
  })
}

/** Resolve a declared entry before planning work; addresses and credentials are never selectors. */
export function resolveNamedProviderConnection(
  db: AppDatabase,
  selection: { readonly connection: string; readonly provider?: Provider },
): ProviderConnection {
  const named = selection.connection.trim()
  const records = PROVIDER_DESCRIPTORS.flatMap(({ id }) => listProviderConnections(db, id))
  const knownId = PROVIDER_DESCRIPTORS.some(({ id }) =>
    (['sign-in', 'api-key'] as const).some(
      (method) => compatibilityConnectionId(id, method) === named,
    ),
  )
  const matches = records.filter((record) => {
    if (selection.provider !== undefined && record.provider !== selection.provider) return false
    if (knownId) return record.id === named
    const provider = PROVIDER_DESCRIPTORS.find(({ id }) => id === record.provider)
    const folded = named.toLowerCase()
    return (
      record.name.trim().toLowerCase() === folded ||
      `${provider?.displayName} · ${record.name}`.toLowerCase() === folded
    )
  })
  if (matches.length !== 1) throw new Error('The selected connection is unavailable')
  return matches[0]!
}

/** Omitted legacy choices keep today's key precedence, rather than freezing it at migration. */
export function resolveProviderConnection(
  db: AppDatabase,
  selection: { readonly provider: Provider; readonly connectionId?: string | null },
): ProviderConnection {
  const { provider, connectionId } = selection
  const method =
    connectionId == null
      ? hasSavedKey(db, provider)
        ? 'api-key'
        : 'sign-in'
      : connectionId === compatibilityConnectionId(provider, 'api-key')
        ? 'api-key'
        : connectionId === compatibilityConnectionId(provider, 'sign-in')
          ? 'sign-in'
          : null
  const record = method === null ? null : compatibilityRecord(db, provider, method)
  if (!record) throw new Error('The selected connection is unavailable')
  return record
}
