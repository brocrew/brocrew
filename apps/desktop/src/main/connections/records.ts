import {
  compatibilityConnectionId,
  type ConnectionAuthMethod,
  type Provider,
  type ProviderConnection,
} from '@brobot2/shared'
import type { AppDatabase } from '../db/connection'
import type { UpdateProviderConnectionInput } from '../../shared/provider-connection-edit'

interface ConnectionRow {
  id: string
  provider: string
  name: string
  description: string | null
  auth_method: string
  credential_source: string
  base_url: string | null
  enabled: number
  contract_version: number
}

export class ProviderConnectionUnavailable extends Error {
  constructor(message = 'The selected connection is unavailable') {
    super(message)
  }
}

function compatibilityRecord(
  db: AppDatabase,
  provider: Provider,
  method: ConnectionAuthMethod,
): ProviderConnection | null {
  const row = db
    .prepare(
      `SELECT id, provider, name, description, auth_method, credential_source, base_url, enabled, contract_version
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
  return {
    id: row.id,
    provider,
    name: row.name,
    description: row.description,
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

/** Omitted legacy choices keep today's key precedence, rather than freezing it at migration. */
export function resolveProviderConnection(
  db: AppDatabase,
  selection: {
    readonly provider: Provider
    readonly connectionId?: string | null
    readonly keySaved: boolean
  },
): ProviderConnection {
  const { provider, keySaved } = selection
  const requested = selection.connectionId
  const named =
    requested == null
      ? undefined
      : (db
          .prepare(
            `SELECT id FROM provider_connection
             WHERE id = ? OR (provider = ? AND name = ? COLLATE NOCASE)
             ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1`,
          )
          .get(requested, provider, requested, requested) as { id: string } | undefined)
  const connectionId = named?.id ?? requested
  const currentMethod = keySaved ? 'api-key' : 'sign-in'
  const method =
    connectionId == null
      ? currentMethod
      : connectionId === compatibilityConnectionId(provider, 'api-key')
        ? 'api-key'
        : connectionId === compatibilityConnectionId(provider, 'sign-in')
          ? 'sign-in'
          : null
  const record = method === null ? null : compatibilityRecord(db, provider, method)
  if (!record) throw new ProviderConnectionUnavailable()
  return record
}

/** Rename an existing supported connection without changing its route or recorded bindings. */
export function updateProviderConnection(
  db: AppDatabase,
  input: UpdateProviderConnectionInput,
): ProviderConnection {
  const selected = listProviderConnections(db, input.provider).find(
    (row) => row.id === input.connectionId,
  )
  if (!selected) throw new ProviderConnectionUnavailable()
  const name = input.name.trim()
  if (!name) throw new Error('Give this connection a name.')
  const duplicate = db
    .prepare(
      'SELECT id FROM provider_connection WHERE provider = ? AND name = ? COLLATE NOCASE AND id <> ?',
    )
    .get(input.provider, name, selected.id)
  if (duplicate) throw new Error('A connection with this name already exists.')
  const description = input.description?.trim() || null
  db.prepare(
    'UPDATE provider_connection SET name = ?, description = ? WHERE id = ? AND provider = ?',
  ).run(name, description, selected.id, input.provider)
  return { ...selected, name, description }
}
