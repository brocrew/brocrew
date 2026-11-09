import { managedPluginFailure } from '@brobot2/runtime/plugin-failure'
import { providerSchema, type Provider } from '@brobot2/shared'
import { createHmac, randomBytes } from 'node:crypto'
import { closeSync, fstatSync, ftruncateSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const conditions = [
  'bearer',
  'accepting',
  'current',
  'bridge-closed',
  'lease-invalid',
  'view-invalid',
  'incarnation-retired',
  'entry-replaced',
  'run-replaced',
  'workspace-ended',
  'plugin-blocked',
  'installation-replaced',
  'run-installation-replaced',
  'run-ended',
  'admission-error',
  'broker-discovery',
] as const
const errors = [
  'unknown',
  'state-corrupt',
  'state-conflict',
  'state-busy',
  'state-unsafe-path',
  'state-limit',
  'state-missing-guard',
  'state-unsupported',
  'supervisor-unavailable',
  'broker-invalid',
  'broker-unauthorized',
  'broker-unavailable',
  'broker-denied',
  'broker-busy',
  'broker-cancelled',
  'broker-deadline',
  'broker-downstream',
] as const
export interface AdmissionFailure {
  condition: (typeof conditions)[number]
  error?: (typeof errors)[number]
}
export type AdmissionObserver = (failure: AdmissionFailure) => void
export function observeAdmission(
  observer: AdmissionObserver | undefined,
  failure: AdmissionFailure,
) {
  try {
    observer?.(failure)
  } catch {
    /* An observer grants no authority. */
  }
}

const events = [
  'launch-attachment',
  'launch-discovery',
  'route-configured',
  'source-refresh',
  'release-received',
  'source-retired',
  'route-issued',
  'route-close-start',
  'route-close-complete',
  'http-bearer-refused',
  'http-broker-refused',
] as const
const identities = [
  'workspace',
  'source',
  'lease',
  'epoch',
  'route',
  'hostRun',
  'request',
  'launch',
  'incarnation',
  'attachmentRoute',
  'server',
  'plugin',
] as const
type Identity = (typeof identities)[number]
type Aliases = Partial<Record<Identity, string>>
const launchStages = [
  'initial-read',
  'before-send-read',
  'provider-discovery',
  'provider-launch',
] as const
const launchOutcomes = [
  'configured',
  'empty',
  'failed',
  'discovered',
  'unavailable',
  'timeout',
  'cancelled',
] as const
interface LaunchTraceDetail extends Aliases {
  stage?: (typeof launchStages)[number]
  outcome?: (typeof launchOutcomes)[number]
  provider?: Provider
  failureStage?: string
  configuredTools?: readonly string[]
  discoveredTools?: readonly string[]
  configuredCount?: number
  discoveredCount?: number
  serverCount?: number
  pending?: readonly string[]
  off?: readonly string[]
  unknown?: boolean
}
/** The random incarnation salts aliases shared by app and supervisor; never use a capability. */
export function attachmentTraceId(
  incarnation: string,
  kind: 'route' | 'server' | 'tool' | 'plugin' | 'incarnation',
  value: string,
): string {
  try {
    return createHmac('sha256', incarnation)
      .update(kind)
      .update('\0')
      .update(value)
      .digest('hex')
      .slice(0, 32)
  } catch {
    return ''
  }
}
export interface RouteAdmissionEvent extends Aliases, LaunchTraceDetail {
  process: string
  sequence: number
  event: (typeof events)[number]
  condition?: AdmissionFailure['condition']
  error?: AdmissionFailure['error']
}
export type RouteAdmissionSink = (event: RouteAdmissionEvent) => void
export interface RouteAdmissionTrace {
  aliases: Aliases
  attachmentId(kind: 'route' | 'server' | 'tool', value: string): string | undefined
  alias(kind: Identity, value: string): string | undefined
  fresh(kind: Identity): string | undefined
  emit(
    event: RouteAdmissionEvent['event'],
    detail?: Partial<AdmissionFailure> & LaunchTraceDetail,
    request?: string,
  ): void
}

/** One supervisor-local namespace, no alias registry and no credential-derived identifiers. */
export function createRouteAdmissionTrace(sink?: RouteAdmissionSink) {
  let key: Buffer | undefined,
    process: string | undefined,
    sequence = 0
  try {
    key = randomBytes(32)
    process = randomBytes(16).toString('hex')
  } catch {
    /* Missing diagnostics cannot prevent startup. */
  }
  const alias = (kind: Identity, value: string) => {
    try {
      if (key)
        return createHmac('sha256', key)
          .update(kind)
          .update('\0')
          .update(value)
          .digest('hex')
          .slice(0, 32)
    } catch {
      /* Identity observation only. */
    }
    return undefined
  }
  return (aliases: Aliases, incarnation?: string): RouteAdmissionTrace => ({
    aliases,
    attachmentId(kind, value) {
      try {
        return incarnation ? attachmentTraceId(incarnation, kind, value) : undefined
      } catch {
        return undefined
      }
    },
    alias,
    fresh(kind) {
      try {
        return alias(kind, randomBytes(16).toString('hex'))
      } catch {
        return undefined
      }
    },
    emit(event, detail, request) {
      try {
        if (process)
          sink?.({ ...aliases, process, sequence: ++sequence, event, ...detail, request })
      } catch {
        /* Includes observer serialization and file cleanup failures. */
      }
    },
  })
}

/** Fixed fields only; never use the tool-failure writer's raw error-message detail path. */
export function recordRouteAdmissionTrace(root: string, event: RouteAdmissionEvent): void {
  let fd: number | undefined
  try {
    const row: Record<string, string | number | boolean | readonly string[]> = {
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
    if (launchStages.includes(event.stage!)) row.stage = event.stage!
    if (launchOutcomes.includes(event.outcome!)) row.outcome = event.outcome!
    const provider = providerSchema.safeParse(event.provider)
    if (provider.success) row.provider = provider.data
    if (event.failureStage !== undefined)
      row.failureStage = managedPluginFailure(
        { pluginStage: event.failureStage, pluginCause: 'unknown' },
        'attachment-read',
      ).pluginStage
    for (const field of ['configuredTools', 'discoveredTools', 'pending', 'off'] as const) {
      const values = event[field]
      if (Array.isArray(values))
        row[field] = values
          .filter((value) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value))
          .slice(0, 512)
    }
    for (const field of ['configuredCount', 'discoveredCount', 'serverCount'] as const) {
      const value = event[field]
      if (Number.isSafeInteger(value) && value! >= 0) row[field] = value!
    }
    if (typeof event.unknown === 'boolean') row.unknown = event.unknown
    const line = JSON.stringify(row) + '\n'
    const path = join(root, 'plugin-route-admission.log')
    try {
      fd = openSync(path, 'r+')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fd = openSync(path, 'wx', 0o600)
    }
    const stat = fstatSync(fd)
    const full = stat.size + Buffer.byteLength(line) > 1024 * 1024
    if (full) ftruncateSync(fd, 0)
    writeSync(fd, line, full ? 0 : stat.size)
  } catch {
    /* Diagnostics never change admission. */
  } finally {
    try {
      if (fd !== undefined) closeSync(fd)
    } catch {
      /* Cleanup is observational too. */
    }
  }
}
