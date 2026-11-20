import type { TaskState } from './task-contracts'

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
