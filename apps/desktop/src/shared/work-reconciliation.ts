import { TASK_STALL_CAUSES, type TaskStallCause } from './tasks'
import { WORK_INCIDENT_KINDS, type WorkIncidentKind } from './work-incidents'

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

export function reconciliationReceipt(said: unknown, at: number): ReconciliationReceipt | null {
  if (typeof said !== 'object' || said === null) return null
  const r = said as Record<string, unknown>
  const text = (key: string) =>
    typeof r[key] === 'string' && r[key].length > 0 && r[key].length <= 512
  if (
    r.type !== 'work_reconciliation' ||
    !text('incident') ||
    !text('piece') ||
    !WORK_INCIDENT_KINDS.includes(r.kind as WorkIncidentKind) ||
    typeof r.since !== 'number' ||
    !Number.isSafeInteger(r.since) ||
    r.since < 0 ||
    !['holder', 'giver', 'person', 'resolved'].includes(String(r.step)) ||
    !['planned', 'delivered', 'failed', 'listed', 'resolved'].includes(String(r.outcome)) ||
    (r.waitKey !== undefined &&
      (typeof r.waitKey !== 'string' || !/^[0-9a-f]{64}$/.test(r.waitKey))) ||
    (r.due !== undefined && r.due !== true) ||
    (r.cause !== undefined && !TASK_STALL_CAUSES.includes(r.cause as TaskStallCause)) ||
    (r.target !== undefined && !text('target')) ||
    (r.messageId !== undefined && !text('messageId'))
  )
    return null
  if (
    (r.step === 'holder' || r.step === 'giver') &&
    (!text('target') ||
      !text('messageId') ||
      !['planned', 'delivered', 'failed'].includes(String(r.outcome)))
  )
    return null
  if (
    (r.step === 'person' && r.outcome !== 'listed') ||
    (r.step === 'resolved' && r.outcome !== 'resolved')
  )
    return null
  return {
    type: 'work_reconciliation',
    incident: r.incident as string,
    piece: r.piece as string,
    kind: r.kind as WorkIncidentKind,
    since: r.since,
    step: r.step as ReconciliationStep,
    outcome: r.outcome as ReconciliationOutcome,
    at,
    ...(r.waitKey === undefined ? {} : { waitKey: r.waitKey as string }),
    ...(r.due === true ? { due: true as const } : {}),
    ...(r.cause === undefined ? {} : { cause: r.cause as TaskStallCause }),
    ...(r.target === undefined ? {} : { target: r.target as string }),
    ...(r.messageId === undefined ? {} : { messageId: r.messageId as string }),
  }
}

/** The existing sign-in reopen's observed steps; these rows never authorize a second reopen. */
export interface WorkRecoveryEvent {
  readonly type: 'work_recovery'
  readonly turn: string
  readonly pieces: readonly string[]
  readonly since: number
  readonly phase: 'pending' | 'sent' | 'declined' | 'failed'
}

export function workRecoveryEvent(said: unknown): WorkRecoveryEvent | null {
  if (typeof said !== 'object' || said === null) return null
  const r = said as Record<string, unknown>
  if (
    r.type !== 'work_recovery' ||
    typeof r.turn !== 'string' ||
    r.turn.length === 0 ||
    !Array.isArray(r.pieces) ||
    r.pieces.some((one) => typeof one !== 'string' || one.length === 0) ||
    typeof r.since !== 'number' ||
    !Number.isSafeInteger(r.since) ||
    r.since < 0 ||
    !['pending', 'sent', 'declined', 'failed'].includes(String(r.phase))
  )
    return null
  return {
    type: 'work_recovery',
    turn: r.turn,
    pieces: r.pieces as string[],
    since: r.since,
    phase: r.phase as WorkRecoveryEvent['phase'],
  }
}
