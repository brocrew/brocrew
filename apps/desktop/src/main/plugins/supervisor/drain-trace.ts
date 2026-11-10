import { logError, logInfo } from '../../logging/log'
import type { StopReason } from './protocol'

export interface DrainTrace {
  stage:
    | 'drain'
    | 'invalidation'
    | 'group-cleanup'
    | 'child-stop'
    | 'child-exit'
    | 'descendants'
    | 'revoke'
    | 'stop-write'
    | 'child-start'
    | 'child-proofs'
    | 'server.close'
    | 'stopped-write'
    | 'blocked-write'
    | 'closed'
  state: 'waiting' | 'complete' | 'failed'
  epoch?: string
  reason?: StopReason
  cause?: string
  attempt?: number
  errno?: string
}
/** One log line per drain step; a failed step is an error. */
export function recordDrainTrace(event: DrainTrace): void {
  const { stage, state, ...facts } = event
  if (state === 'failed') logError('drain', stage, { state, ...facts })
  else logInfo('drain', stage, { state, ...facts })
}
