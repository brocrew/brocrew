import type { ServiceRegisteredEvent } from '../shared/conversation-events'

export function serviceRegistrationOf(value: unknown): ServiceRegisteredEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    row.type !== 'service_registered' ||
    typeof row.identity !== 'string' ||
    row.identity.length === 0 ||
    row.identity.length > 200 ||
    typeof row.identityCreatedAt !== 'number' ||
    !Number.isSafeInteger(row.identityCreatedAt) ||
    row.identityCreatedAt < 0 ||
    Object.keys(row).length !== 3
  ) {
    return null
  }
  return {
    type: 'service_registered',
    identity: row.identity,
    identityCreatedAt: row.identityCreatedAt,
  }
}
