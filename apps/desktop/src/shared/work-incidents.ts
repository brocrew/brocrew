import type { TaskStallCause } from './tasks'

/**
 * What can be wrong with an open piece that no other list shows a person:
 *  - `wait-needs-classification` — it is marked as waiting on purpose but names nothing that will
 *    end the wait: a mark from before a wait named its target;
 *  - `stopped` — work a person gave that a drive left open: nothing drives it and it waits on
 *    nothing, with the cause seen;
 *  - `wait-target-ended` — the piece or question it waits on has ended;
 *  - `wait-target-missing` — the question, job or background task it waits on is gone or unreadable;
 *  - `notice-not-delivered` — a reminder or notice about it could not be delivered;
 *  - `recovery-pending`, `recovery-declined`, `recovery-failed` — the app's continuing of a turn
 *    it cut is waiting, was declined, or failed.
 */
export const WORK_INCIDENT_KINDS = [
  'wait-needs-classification',
  'stopped',
  'wait-target-ended',
  'wait-target-missing',
  'notice-not-delivered',
  'recovery-pending',
  'recovery-declined',
  'recovery-failed',
] as const
export type WorkIncidentKind = (typeof WORK_INCIDENT_KINDS)[number]

/** One open piece and what is wrong with it, as *Waiting on you* draws it. */
export interface WorkIncident {
  /** The piece, by id. */
  readonly piece: string
  /** The label a person says out loud, such as `W6.4.1`. */
  readonly label: string
  /** Its title, as it stands now. */
  readonly title: string | null
  /** The conversation holding it, by id. */
  readonly holder: string
  /** What to call that conversation: its agent's name. */
  readonly holderName: string
  /** The conversation that gave it, by id; `null` for work a person gave. */
  readonly giver: string | null
  /** What to call the giver: its agent's name; `null` for work a person gave. */
  readonly giverName: string | null
  readonly recovery?: {
    readonly because: 'usage-limit' | 'sign-in' | 'program' | 'app-restart'
    readonly resumesAt: number | null
  }
  readonly kind: WorkIncidentKind
  /** Since when, epoch ms: the row that put the piece in this state. */
  readonly since: number
  /** For `stopped`: what stopped driving it. */
  readonly cause?: TaskStallCause
  /** When its holder and its giver were told of it, epoch ms; absent until each is. */
  readonly told?: { readonly holder?: number; readonly giver?: number }
}
