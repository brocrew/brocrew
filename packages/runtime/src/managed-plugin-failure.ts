export const PLUGIN_FAILURE_STAGES = [
  'attachment-read',
  'attachment-schema',
  'wrapper-wait',
  'sdk-refresh',
  'sdk-inventory',
  'provider-reopen',
  'provider-retire',
  'owner-local-state',
  'owner-features',
  'owner-mutation-status',
  'owner-response',
  'owner-generation',
  'catalogue-composition',
  'plugin-settings',
  'admission-read',
  'route-binding',
  'binding-connection',
  'binding-endpoint',
  'binding-connect',
  'binding-inventory',
  'binding-current',
  'binding-close',
  'route-open',
  'ipc-request',
  'ipc-reply',
] as const
export type PluginFailureStage = (typeof PLUGIN_FAILURE_STAGES)[number]
const causes = [
  'unavailable',
  'busy',
  'unsafe-path',
  'corrupt',
  'unsupported',
  'conflict',
  'limit',
  'io-denied',
  'io-failed',
  'transport-closed',
  'invalid-reply',
  'timeout',
  'cancelled',
  'pending',
  'off',
  'unknown',
] as const
export type PluginFailureCause = (typeof causes)[number]

/** Only fixed vocabulary crosses an attachment diagnostic boundary; raw errors stay local. */
export class ManagedPluginFailure extends Error {
  constructor(
    readonly pluginStage: PluginFailureStage,
    readonly pluginCause: PluginFailureCause,
  ) {
    super(`Plugin unavailable at ${pluginStage}: ${pluginCause}.`)
    this.name = 'ManagedPluginFailure'
  }
}
export function managedPluginFailure(
  error: unknown,
  stage: PluginFailureStage,
): ManagedPluginFailure {
  const seen = new Set<unknown>()
  let normalized: PluginFailureCause = 'unknown'
  for (
    let depth = 0;
    depth < 6 && error && typeof error === 'object' && !seen.has(error);
    depth++
  ) {
    seen.add(error)
    try {
      if (error instanceof ManagedPluginFailure) return error
      const one = error as {
        code?: unknown
        cause?: unknown
        name?: unknown
        pluginStage?: unknown
        pluginCause?: unknown
      }
      if (
        PLUGIN_FAILURE_STAGES.includes(one.pluginStage as PluginFailureStage) &&
        causes.includes(one.pluginCause as PluginFailureCause)
      )
        return new ManagedPluginFailure(
          one.pluginStage as PluginFailureStage,
          one.pluginCause as PluginFailureCause,
        )
      if (normalized === 'unknown') {
        if (one.name === 'TimeoutError' || (one.name === 'McpError' && one.code === -32001))
          normalized = 'timeout'
        else if (one.name === 'AbortError') normalized = 'cancelled'
        else if (one.name === 'ZodError') normalized = 'invalid-reply'
      }
      if (typeof one.code === 'string') {
        // A generic outer refusal must not hide an inner, already classified failing seam.
        if (normalized === 'unknown') {
          if (causes.includes(one.code as PluginFailureCause))
            normalized = one.code as PluginFailureCause
          else if (one.code === 'EACCES' || one.code === 'EPERM') normalized = 'io-denied'
          else if (one.code === 'ETIMEDOUT') normalized = 'timeout'
          else if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(one.code))
            normalized = 'transport-closed'
          else if (/^E[A-Z0-9_]{1,30}$/.test(one.code)) normalized = 'io-failed'
        }
      }
      error = one.cause
    } catch {
      break
    }
  }
  return new ManagedPluginFailure(stage, normalized)
}
