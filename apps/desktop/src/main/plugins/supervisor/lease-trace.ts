import { closeSync, constants, fstatSync, ftruncateSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'
import { isPrivateEntry } from '../private-files'

export interface LeaseTrace {
  role: 'app' | 'owner'
  stage:
    | 'timer-start'
    | 'request-dispatch'
    | 'request-received'
    | 'request-complete'
    | 'request-retry'
    | 'renewal-accepted'
    | 'renewal-refused'
    | 'lease-expired'
    | 'lease-ended'
  epoch: string
  generation: string
  counter: number
  elapsedMs?: number
  timerDelayMs?: number
  leaseAgeMs?: number
  cause?:
    | 'no-reply'
    | 'expired'
    | 'owner-not-accepting'
    | 'record-unreadable'
    | 'refused-or-invalid'
    | 'lease-not-current'
    | 'counter'
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Fixed vocabulary and public incarnation/counter correlation only. Never lease/owner keys. */
export function recordLeaseTrace(root: string, event: LeaseTrace): void {
  let fd: number | undefined
  try {
    if (!uuid.test(event.epoch) || !uuid.test(event.generation)) return
    if (
      !['app', 'owner'].includes(event.role) ||
      ![
        'timer-start',
        'request-dispatch',
        'request-received',
        'request-complete',
        'request-retry',
        'renewal-accepted',
        'renewal-refused',
        'lease-expired',
        'lease-ended',
      ].includes(event.stage)
    )
      return
    if (!Number.isSafeInteger(event.counter) || event.counter < 0) return
    const numbers: string[] = []
    for (const key of ['elapsedMs', 'timerDelayMs', 'leaseAgeMs'] as const) {
      const value = event[key]
      if (value !== undefined) {
        if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return
        numbers.push(`${key}=${Math.floor(value)}`)
      }
    }
    if (
      event.cause !== undefined &&
      ![
        'no-reply',
        'expired',
        'owner-not-accepting',
        'record-unreadable',
        'refused-or-invalid',
        'lease-not-current',
        'counter',
      ].includes(event.cause)
    )
      return
    const path = join(root, 'plugin-lease.log')
    try {
      fd = openNotThroughALink(path, constants.O_WRONLY | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fd = createFreshFile(path, 0o600)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || !isPrivateEntry(stat)) return
    const line = `${new Date().toISOString()} [plugins] lease role=${event.role} stage=${event.stage} epoch=${event.epoch} generation=${event.generation} counter=${event.counter}${numbers.length ? ` ${numbers.join(' ')}` : ''}${event.cause ? ` cause=${event.cause}` : ''}\n`
    const full = stat.size + Buffer.byteLength(line) > 4 * 1024 * 1024
    if (full) ftruncateSync(fd, 0)
    writeSync(fd, line, full ? 0 : stat.size)
  } catch {
    // Observation cannot change renewal, expiry, retry, drain or authority.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
