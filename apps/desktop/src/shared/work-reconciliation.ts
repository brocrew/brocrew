import { TASK_STALL_CAUSES } from './task-contracts'
import type { TaskStallCause } from './task-contracts'
import type {
  HolderReconciliationReceipt,
  ReconciliationOutcome,
  ReconciliationReceipt,
  ReconciliationStep,
  WorkRecoveryEvent,
} from './reconciliation-contracts'

import { WORK_INCIDENT_KINDS, type WorkIncidentKind } from './work-incidents'

function receiptText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

function receiptNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function reconciliationReceipt(said: unknown, at: number): ReconciliationReceipt | null {
  if (typeof said !== 'object' || said === null) return null
  const r = said as Record<string, unknown>
  const text = (key: string) => receiptText(r[key])
  if (
    r.type !== 'work_reconciliation' ||
    !text('incident') ||
    !text('piece') ||
    !WORK_INCIDENT_KINDS.includes(r.kind as WorkIncidentKind) ||
    !receiptNumber(r.since) ||
    !['holder', 'giver', 'person', 'resolved'].includes(String(r.step)) ||
    !['planned', 'delivered', 'failed', 'listed', 'resolved'].includes(String(r.outcome)) ||
    (r.waitKey !== undefined && !text('waitKey')) ||
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

export function holderReconciliationReceipt(
  said: unknown,
  at: number,
): HolderReconciliationReceipt | null {
  if (typeof said !== 'object' || said === null) return null
  const r = said as Record<string, unknown>
  if (r.kind !== 'provider-turn-failed') return reconciliationReceipt(said, at)
  const { episode } = r
  if (
    r.type !== 'work_reconciliation' ||
    r.piece !== undefined ||
    !receiptText(r.incident) ||
    !receiptNumber(r.since) ||
    r.step !== 'giver' ||
    (r.outcome !== 'planned' && r.outcome !== 'delivered' && r.outcome !== 'failed') ||
    !receiptText(r.target) ||
    !receiptText(r.messageId) ||
    typeof episode !== 'object' ||
    episode === null ||
    !('generation' in episode) ||
    !('terminalOrdinal' in episode) ||
    !receiptNumber(episode.generation) ||
    !receiptNumber(episode.terminalOrdinal)
  )
    return null
  return {
    type: 'work_reconciliation',
    incident: r.incident,
    kind: r.kind,
    episode: { generation: episode.generation, terminalOrdinal: episode.terminalOrdinal },
    since: r.since,
    step: r.step,
    outcome: r.outcome,
    target: r.target,
    messageId: r.messageId,
    at,
  }
}

export function providerFailureDiagnosis(conversation: string, cause: string): string {
  const reason = cause.replace(/[.]$/, '')
  return `${conversation} couldn't run: ${reason}. Check its status and settings before choosing how to continue.`
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
