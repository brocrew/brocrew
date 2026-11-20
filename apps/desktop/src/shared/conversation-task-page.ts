import type { TaskState } from './task-contracts'
import type { WorkThatNamesIt } from './piece-called'
import type { WorkEdge } from './who-called-whom'

export const ALL_TASKS_FILTERS = ['all', 'active', 'open', 'closed'] as const
export type AllTasksFilter = (typeof ALL_TASKS_FILTERS)[number]

export interface AllConversationTasksInput {
  readonly sessionId: string
  readonly filter: AllTasksFilter
  readonly text?: string
  readonly cursor?: string
}

export type AllConversationTasksResult =
  | {
      readonly ok: true
      readonly conversation: string
      readonly root: WorkThatNamesIt | null
      readonly tasks: readonly WorkEdge[]
      readonly counts: Readonly<Record<AllTasksFilter, number>> | null
      readonly matched: number | null
      readonly newestOpenMatch: string | null
      readonly next: string | null
      readonly rowsUnread: number
      readonly ledgersSkipped: number
    }
  | { readonly ok: false; readonly reason: 'unknown-conversation' | 'invalid-cursor' }

export interface ConversationTaskPageInput {
  readonly sessionId: string
  readonly cursor?: string
}

export interface ConversationTaskPageRow {
  readonly kind: 'held' | 'root'
  readonly piece: string
  readonly label: string
  readonly title: string | null
  readonly brief: string | null
  readonly giver: string | null
  readonly definitionOfDone?: string | null
  readonly state: TaskState | null
  readonly givenAt: number
  readonly statusLine: { readonly text: string; readonly at: number } | null
}

export type ConversationTaskPageResult =
  | {
      readonly ok: true
      readonly conversation: string
      readonly current: ConversationTaskPageRow | null
      readonly other: readonly ConversationTaskPageRow[]
      readonly counts: {
        readonly active: number
        readonly open: number
        readonly closed: number
      } | null
      readonly next: string | null
      readonly rowsUnread: number
      readonly ledgersSkipped: number
    }
  | { readonly ok: false; readonly reason: 'unknown-conversation' | 'invalid-cursor' }
