import type { TranscriptEvent } from '../../shared/conversation-events'
import type { ScheduleLevel } from '../../shared/agent-state-contracts'
import type { PieceRow } from '../../shared/task-contracts'
import { PIECE_EVENT_TYPES, TASK_IS_OPEN } from '../../shared/tasks'
import { ROUTED_REQUEST_EVENT_TYPES } from '../db/session-store'

export function earliest(moments: readonly number[]): number | null {
  return moments.length === 0 ? null : Math.min(...moments)
}

export const GRANTS_MAY_MOVE: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>(['work_given', 'work_replied', 'work_taken_back', 'work_closed', 'message_unqueued'])

// Text, token and tool frames do not change the canonical state inputs.
export const MOVES_A_LIVE_FACT: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  'status',
  'background_work',
  'scheduled_work',
  'conversation_reset',
  'instruction_proposed',
  'instruction_settled',
])

export const MOVES_A_PIECE_THAT_WAITS_ON_WHO_WROTE: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  'user_turn',
  'turn',
  'message_queued',
  'message_unqueued',
  'work_replied',
  'work_status_set',
  'replaced_by',
])

// Job ordering does not change a schedule level.
export const theSameLevel = (one: ScheduleLevel, other: ScheduleLevel): boolean =>
  one.dropped === other.dropped &&
  one.jobs.length === other.jobs.length &&
  one.jobs.every((job) => {
    const beside = other.jobs.find((held) => held.id === job.id)
    return (
      beside !== undefined &&
      beside.schedule === job.schedule &&
      beside.recurring === job.recurring &&
      beside.prompt === job.prompt &&
      beside.nominalAt === job.nominalAt &&
      beside.notStarted === job.notStarted
    )
  })

export const MOVES_ITS_NAME: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([...PIECE_EVENT_TYPES, 'replaced_by'])

export const MOVES_WHAT_A_PERSON_IS_ASKED: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  ...ROUTED_REQUEST_EVENT_TYPES,
  ...PIECE_EVENT_TYPES,
  ...MOVES_A_PIECE_THAT_WAITS_ON_WHO_WROTE,
  'permission_request',
  'user_input_request',
  'instruction_proposed',
  'instruction_settled',
  'mcp_server_requested',
  'mcp_server_request_settled',
  'work_stall_told',
  'work_interrupted',
  'work_restarted',
  'status',
  // A level's end can leave a person's own turn's piece waiting on them.
  'background_work',
  'scheduled_work',
])

export const NAMES_WHAT_A_PERSON_IS_ASKED: ReadonlySet<string> = new Set(['agent_identity'])

export const MOVES_ITS_GIVERS_WAIT: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>(['work_given', 'work_replied', 'work_taken_back', 'work_closed'])

export function howItsWorkIsDrawn(composed: readonly PieceRow[]): ReadonlyMap<string, string> {
  return new Map(
    composed
      .filter((piece) => TASK_IS_OPEN[piece.state])
      .map((piece) => [piece.piece, asItIsDrawn(piece)] as const),
  )
}

function asItIsDrawn(piece: PieceRow): string {
  return piece.stalledBecause === null ? piece.state : `${piece.state} · ${piece.stalledBecause}`
}
