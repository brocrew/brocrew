import { createHmac, randomBytes } from 'node:crypto'
import { closeSync, fstatSync, ftruncateSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const conditions = [
  'bearer', 'accepting', 'current', 'bridge-closed', 'lease-invalid', 'view-invalid',
  'incarnation-retired', 'entry-replaced', 'run-replaced', 'workspace-ended',
  'plugin-blocked', 'installation-replaced', 'run-installation-replaced', 'run-ended',
  'admission-error', 'broker-discovery',
] as const
const errors = [
  'unknown', 'state-corrupt', 'state-conflict', 'state-busy', 'state-unsafe-path',
  'state-limit', 'state-missing-guard', 'state-unsupported', 'supervisor-unavailable',
  'broker-invalid', 'broker-unauthorized', 'broker-unavailable', 'broker-denied',
  'broker-busy', 'broker-cancelled', 'broker-deadline', 'broker-downstream',
] as const
export interface AdmissionFailure {
  condition: (typeof conditions)[number]
  error?: (typeof errors)[number]
}
export type AdmissionObserver = (failure: AdmissionFailure) => void
export function observeAdmission(observer: AdmissionObserver | undefined, failure: AdmissionFailure) {
  try { observer?.(failure) } catch { /* An observer grants no authority. */ }
}

const events = [
  'source-refresh', 'release-received', 'source-retired', 'route-issued', 'route-reused',
  'route-close-start', 'route-close-complete', 'http-bearer-refused',
  'http-current-refused', 'http-broker-refused', 'tool-current-refused',
] as const
const identities = ['workspace', 'source', 'lease', 'epoch', 'route', 'hostRun', 'request'] as const
type Identity = (typeof identities)[number]
type Aliases = Partial<Record<Identity, string>>
export interface RouteAdmissionEvent extends Aliases {
  process: string
  sequence: number
  event: (typeof events)[number]
  condition?: AdmissionFailure['condition']
  error?: AdmissionFailure['error']
}
export type RouteAdmissionSink = (event: RouteAdmissionEvent) => void
export interface RouteAdmissionTrace {
  aliases: Aliases
  alias(kind: Identity, value: string): string | undefined
  fresh(kind: Identity): string | undefined
  emit(event: RouteAdmissionEvent['event'], detail?: AdmissionFailure, request?: string): void
}

/** One supervisor-local namespace, no alias registry and no credential-derived identifiers. */
export function createRouteAdmissionTrace(sink?: RouteAdmissionSink) {
  let key: Buffer | undefined, process: string | undefined, sequence = 0
  try {
    key = randomBytes(32)
    process = randomBytes(16).toString('hex')
  } catch { /* Missing diagnostics cannot prevent startup. */ }
  const alias = (kind: Identity, value: string) => {
    try {
      if (key) return createHmac('sha256', key).update(kind).update('\0').update(value).digest('hex').slice(0, 32)
    } catch { /* Identity observation only. */ }
    return undefined
  }
  return (aliases: Aliases): RouteAdmissionTrace => ({
    aliases,
    alias,
    fresh(kind) {
      try { return alias(kind, randomBytes(16).toString('hex')) } catch { return undefined }
    },
    emit(event, detail, request) {
      try {
        if (process) sink?.({ ...aliases, process, sequence: ++sequence, event, ...detail, request })
      } catch { /* Includes observer serialization and file cleanup failures. */ }
    },
  })
}

/** Fixed fields only; never use the tool-failure writer's raw error-message detail path. */
export function recordRouteAdmissionTrace(root: string, event: RouteAdmissionEvent): void {
  let fd: number | undefined
  try {
    const row: Record<string, string | number> = {
      at: new Date().toISOString(),
      process: /^[a-f0-9]{32}$/.test(event.process) ? event.process : '',
      sequence: Number.isSafeInteger(event.sequence) && event.sequence > 0 ? event.sequence : 0,
      event: events.includes(event.event) ? event.event : '',
    }
    if (conditions.includes(event.condition!)) row.condition = event.condition!
    if (errors.includes(event.error!)) row.error = event.error!
    for (const field of identities) {
      const value = event[field]
      if (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)) row[field] = value
    }
    const line = JSON.stringify(row) + '\n'
    const path = join(root, 'plugin-route-admission.log')
    try { fd = openSync(path, 'r+') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fd = openSync(path, 'wx', 0o600)
    }
    const stat = fstatSync(fd)
    const full = stat.size + Buffer.byteLength(line) > 1024 * 1024
    if (full) ftruncateSync(fd, 0)
    writeSync(fd, line, full ? 0 : stat.size)
  } catch { /* Diagnostics never change admission. */ }
  finally {
    try { if (fd !== undefined) closeSync(fd) } catch { /* Cleanup is observational too. */ }
  }
}
