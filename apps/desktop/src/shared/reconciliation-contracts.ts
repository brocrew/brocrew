import type { TaskStallCause } from './task-contracts'
import type { WorkIncidentKind } from './work-incidents'

export type ReconciliationStep = 'holder' | 'giver' | 'person' | 'resolved'

export type ReconciliationOutcome = 'planned' | 'delivered' | 'failed' | 'listed' | 'resolved'

/** An incident's durable step, recorded before any delivery is attempted. */
export interface WorkReconciliationEvent {
  readonly type: 'work_reconciliation'
  readonly incident: string
  readonly piece: string
  readonly kind: WorkIncidentKind
  readonly since: number
  readonly waitKey?: string
  readonly due?: true
  readonly cause?: TaskStallCause
  readonly step: ReconciliationStep
  readonly outcome: ReconciliationOutcome
  readonly target?: string
  readonly messageId?: string
}

export interface ReconciliationReceipt extends WorkReconciliationEvent {
  readonly at: number
}

/** One recorded failed turn's notice to a recipient, independent of any work piece. */
export interface ProviderFailureReconciliationEvent {
  readonly type: 'work_reconciliation'
  readonly incident: string
  readonly kind: 'provider-turn-failed'
  readonly episode: { readonly generation: number; readonly terminalOrdinal: number }
  readonly since: number
  readonly step: 'giver'
  readonly outcome: 'planned' | 'delivered' | 'failed'
  readonly target: string
  readonly messageId: string
}

export type HolderReconciliationReceipt =
  ReconciliationReceipt | (ProviderFailureReconciliationEvent & { readonly at: number })

/** The existing sign-in reopen's observed steps; these rows never authorize a second reopen. */
export interface WorkRecoveryEvent {
  readonly type: 'work_recovery'
  readonly turn: string
  readonly pieces: readonly string[]
  readonly since: number
  readonly phase: 'pending' | 'sent' | 'declined' | 'failed'
}
