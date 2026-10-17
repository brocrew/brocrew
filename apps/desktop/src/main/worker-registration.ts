import type { WorkerRegisteredEvent } from '../shared/runtime-ipc'

const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200

/** A worker birth is never inferred from a partly readable registration. */
export function workerRegistrationOf(value: unknown): WorkerRegisteredEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    row.type !== 'worker_registered' ||
    !id(row.identity) ||
    !id(row.giver) ||
    typeof row.identityCreatedAt !== 'number' ||
    !Number.isSafeInteger(row.identityCreatedAt) ||
    row.identityCreatedAt < 0 ||
    typeof row.number !== 'number' ||
    !Number.isSafeInteger(row.number) ||
    row.number < 1 ||
    Object.keys(row).some(
      (key) => !['type', 'identity', 'identityCreatedAt', 'giver', 'number'].includes(key),
    )
  )
    return null
  return {
    type: 'worker_registered',
    identity: row.identity,
    identityCreatedAt: row.identityCreatedAt,
    giver: row.giver,
    number: row.number,
  }
}
