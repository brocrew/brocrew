import { SUPPORTED_PROVIDERS } from '@brobot2/runtime'

/**
 * Thin stub for Step 0. The state machine, queues, leases, gates, event log,
 * and board projection are built in Slices 2+. This file exists
 * only to establish the package and prove the `workspace:*` dependency chain
 * (orchestration → runtime → shared) compiles.
 */
export function orchestrationReady(): boolean {
  return SUPPORTED_PROVIDERS.length > 0
}
