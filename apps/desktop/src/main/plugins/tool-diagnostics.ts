import type { PluginFailureStage, PluginFailureCause } from '@brobot2/runtime/plugin-failure'
import { logWarn } from '../logging/log'

export type PluginToolFailureReason =
  | 'invalid'
  | 'unauthorized'
  | 'unavailable'
  | 'denied'
  | 'busy'
  | 'cancelled'
  | 'deadline'
  | 'queue-deadline'
  | 'call-deadline'
  | 'downstream'
  | 'proof-rejected'
  | 'proof-timeout'
  | 'cancel-failed'
  | 'execution-invalid'
  | 'execution-failed'
  | 'reply-invalid'
  | 'owner-invalidated'
  | 'host-exited'
  | 'host-exit-unproven'
  | 'recovery-broker-completed'
  | 'recovery-host-started'
  | 'recovery-host-proven'
  | 'recovery-host-unproven'
  | 'recovery-route-close-failed'
  | 'recovery-rebind-failed'
  | 'recovery-restart-failed'
  | 'recovery-restarted'
  | 'recovery-rate-limited'
  | 'transport-connect-failed'
  | 'transport-call-failed'
  | 'transport-close-failed'
  | 'response-limit'
  | 'result-invalid'
  | 'tool-error'
  | 'binding-failed'
  | 'route-open-failed'
  | 'route-unavailable'
  | 'route-stale'
  | 'route-tool-unknown'
  | 'route-request-failed'
  | 'name-collision'
  | 'attachment-failed'
  | 'attachment-capacity'
  | 'transport-connection-reset'
  | 'transport-connection-refused'
  | 'transport-timeout'
  | 'transport-aborted'
  | 'transport-auth-refused'
  | 'call-state'
export interface PluginToolFailureDetail {
  stage: PluginFailureStage
  cause: PluginFailureCause
  correlation: string
  /** The real messages of the errors behind it, outermost first. */
  reason?: string
}
export type PluginToolDiagnostic = ((
  reason: PluginToolFailureReason,
  detail?: PluginDiagnosticDetail,
) => void) & { pending?(stage: PluginFailureStage): void }
export const pluginToolActivityStages = [
  'browser-ready',
  'page-ready',
  'page-response',
  'page-loaded',
  'screenshot-captured',
  'download-received',
  'download-saved',
] as const
export interface PluginCallDiagnostic {
  callId: string
  tool: string
  startedAt: string
  lastStage: (typeof pluginToolActivityStages)[number] | 'unknown'
  state: 'completion-unknown' | 'completed' | 'host-exited'
  hostRun?: string
}
export type PluginDiagnosticDetail = PluginToolFailureDetail | PluginCallDiagnostic
/** Diagnostics are observers, never execution or ownership authority. */
export function reportPluginToolFailure(
  diagnostic: PluginToolDiagnostic | undefined,
  reason: PluginToolFailureReason,
  detail?: PluginDiagnosticDetail,
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
  pluginId: string,
  reason: PluginToolFailureReason,
  detail?: PluginDiagnosticDetail,
): void {
  logWarn('plugin-tool', reason, {
    plugin: pluginId,
    ...(detail && 'tool' in detail
      ? {
          call: {
            callId: detail.callId,
            tool: detail.tool,
            startedAt: detail.startedAt,
            lastStage: detail.lastStage,
            state: detail.state,
            hostRun: detail.hostRun,
          },
        }
      : detail
        ? {
            stage: detail.stage,
            cause: detail.cause,
            correlation: detail.correlation,
            ...(detail.reason ? { error: detail.reason } : {}),
          }
        : {}),
  })
}
