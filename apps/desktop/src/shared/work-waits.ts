import type { ActionFile } from './questions'
import type { WorkIncidentKind } from './work-incidents'

/** The three kinds Waiting on you draws as recovery, apart from the rest. */
export const RECOVERY_KINDS: ReadonlySet<WorkIncidentKind> = new Set([
  'recovery-pending',
  'recovery-declined',
  'recovery-failed',
])

/** Something an agent asked a person to do (`request_action`), still open. */
export interface PersonTodo {
  readonly requestId: string
  /** The conversation that asked, by id: an answer is sent to it. */
  readonly askedBy: string
  readonly askedByName: string
  readonly label: string | null
  readonly text: string
  readonly files: readonly ActionFile[]
  readonly at: number
}

/**
 * Why the app cut a turn and picks it back up, as the host puts it on a recovery incident
 * (`recovery`), with when it starts (`null` when no time is known).
 * ⚑ `app-restart`: BroCrew quit or crashed, and restarted.
 */
export const RECOVERY_BECAUSE = ['usage-limit', 'sign-in', 'program', 'app-restart'] as const
export type RecoveryBecause = (typeof RECOVERY_BECAUSE)[number]
export interface RecoveryDetail {
  readonly because: RecoveryBecause
  readonly resumesAt: number | null
}
