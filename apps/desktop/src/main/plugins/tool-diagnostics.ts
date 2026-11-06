import { closeSync, constants, fstatSync, ftruncateSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'
import { isPrivateEntry } from './private-files'
import {
  managedPluginFailure,
  type PluginFailureStage,
  type PluginFailureCause,
} from '@brobot2/runtime'

const reasons = [
  'invalid',
  'unauthorized',
  'unavailable',
  'denied',
  'busy',
  'cancelled',
  'deadline',
  'queue-deadline',
  'call-deadline',
  'downstream',
  'proof-rejected',
  'proof-timeout',
  'cancel-failed',
  'execution-invalid',
  'execution-failed',
  'reply-invalid',
  'owner-invalidated',
  'host-exited',
  'host-exit-unproven',
  'recovery-broker-completed',
  'recovery-host-started',
  'recovery-host-proven',
  'recovery-host-unproven',
  'recovery-route-close-failed',
  'recovery-rebind-failed',
  'recovery-restart-failed',
  'recovery-restarted',
  'recovery-rate-limited',
  'transport-connect-failed',
  'transport-call-failed',
  'transport-close-failed',
  'response-limit',
  'credential-in-result',
  'result-invalid',
  'tool-error',
  'binding-failed',
  'route-open-failed',
  'route-unavailable',
  'route-stale',
  'route-tool-unknown',
  'route-request-failed',
  'name-collision',
  'attachment-failed',
  'attachment-capacity',
  'resource-policy-refused',
  'resource-policy-failed',
  'transport-connection-reset',
  'transport-connection-refused',
  'transport-timeout',
  'transport-aborted',
  'transport-auth-refused',
] as const
export type PluginToolFailureReason = (typeof reasons)[number]
export interface PluginToolFailureDetail {
  stage: PluginFailureStage
  cause: PluginFailureCause
  correlation: string
  /** The real messages of the errors behind it, outermost first. */
  reason?: string
}
export type PluginToolDiagnostic = (
  reason: PluginToolFailureReason,
  detail?: PluginToolFailureDetail,
) => void
const allowed = new Set<string>(reasons)
/** Diagnostics are observers, never execution or ownership authority. */
export function reportPluginToolFailure(
  diagnostic: PluginToolDiagnostic | undefined,
  reason: PluginToolFailureReason,
  detail?: PluginToolFailureDetail,
): void {
  try {
    if (detail) diagnostic?.(reason, detail)
    else diagnostic?.(reason)
  } catch {
    /* A diagnostic cannot change a call or its proof. */
  }
}
/** One line per failure, with the real error messages when they are known. */
export function recordPluginToolFailure(
  root: string,
  pluginId: string,
  reason: PluginToolFailureReason,
  detail?: PluginToolFailureDetail,
): void {
  if (!['chrome', 'whatsapp', 'host'].includes(pluginId) || !allowed.has(reason)) return
  let fd: number | undefined
  try {
    const path = join(root, 'plugin-tool-failures.log')
    try {
      // Windows append-only handles cannot truncate a full log. Pin one writable
      // descriptor, then write at its verified end (or zero after truncation).
      fd = openNotThroughALink(path, constants.O_WRONLY | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fd = createFreshFile(path, 0o600)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || !isPrivateEntry(stat)) return
    let context = ''
    if (detail && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(detail.correlation)) {
      const safe = managedPluginFailure(
        { pluginStage: detail.stage, pluginCause: detail.cause },
        'route-open',
      )
      context = ` stage=${safe.pluginStage} cause=${safe.pluginCause} correlation=${detail.correlation}${detail.reason ? ` error=${JSON.stringify(detail.reason)}` : ''}`
    }
    const line = `${new Date().toISOString()} [plugins] tool-failure plugin=${pluginId} reason=${reason}${context}\n`
    // Keep accepting new reasons after the bounded history fills, without following another name.
    const full = stat.size + Buffer.byteLength(line) > 1024 * 1024
    if (full) ftruncateSync(fd, 0)
    writeSync(fd, line, full ? 0 : stat.size)
  } catch {
    /* Logging failure never changes admission, cancellation or exit proof. */
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
