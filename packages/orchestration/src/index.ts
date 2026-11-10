import { SUPPORTED_PROVIDERS } from '@brobot2/shared'

/**
 * Thin stub for Step 0. The state machine, queues, leases, gates, event log,
 * and board projection are built in Slices 2+. This file exists
 * only to establish the package and prove the `workspace:*` dependency chain
 * (orchestration → shared) compiles.
 */
export function orchestrationReady(): boolean {
  return SUPPORTED_PROVIDERS.length > 0
}
