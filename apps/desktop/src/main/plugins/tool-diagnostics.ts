import { closeSync, constants, fstatSync, ftruncateSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'
import { isPrivateEntry } from './private-files'

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
export type PluginToolDiagnostic = (reason: PluginToolFailureReason) => void
const allowed = new Set<string>(reasons)
/** Diagnostics are observers, never execution or ownership authority. */
export function reportPluginToolFailure(
  diagnostic: PluginToolDiagnostic | undefined,
  reason: PluginToolFailureReason,
): void {
  try {
    diagnostic?.(reason)
  } catch {
    /* A diagnostic cannot change a call or its proof. */
  }
}
/** Fixed reason words only. Detached supervisor stdio is not retained. */
export function recordPluginToolFailure(
  root: string,
  pluginId: string,
  reason: PluginToolFailureReason,
): void {
  if (!['chrome', 'whatsapp', 'host'].includes(pluginId) || !allowed.has(reason)) return
  let fd: number | undefined
  try {
    const path = join(root, 'plugin-tool-failures.log')
    try {
      fd = openNotThroughALink(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fd = createFreshFile(path, 0o600)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || !isPrivateEntry(stat)) return
    const line = `${new Date().toISOString()} [plugins] tool-failure plugin=${pluginId} reason=${reason}\n`
    // Keep accepting new reasons after the bounded history fills, without following another name.
    if (stat.size + Buffer.byteLength(line) > 1024 * 1024) ftruncateSync(fd, 0)
    writeSync(fd, line)
  } catch {
    /* Logging failure never changes admission, cancellation or exit proof. */
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
