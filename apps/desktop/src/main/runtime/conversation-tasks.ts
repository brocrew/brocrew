import { z } from 'zod'
import { TASK_IS_OPEN } from '../../shared/tasks'
import type { TaskState } from '../../shared/task-contracts'
import type { SessionStore } from '../db/session-store'
import { rowsUnreadOnce } from '../db/rows-unread'
import { describeConversationForRead, resolveConversationAddress } from './conversation-address'

const cursorShape = z.object({
  conversation: z.string(),
  listing: z.enum(['open', 'all', 'ended']),
  at: z.number().finite(),
  piece: z.string(),
})

export interface ConversationTasksInput {
  readonly conversation: string
  readonly listing: 'open' | 'all' | 'ended'
  readonly limit: number
  readonly cursor?: string
}

interface ConversationTask {
  readonly piece: string
  readonly label: string
  readonly title: string | null
  readonly state: TaskState | null
  readonly at: number
}

export type ConversationTasksResult =
  | {
      readonly ok: true
      readonly conversation: string
      readonly line: string
      readonly tasks: readonly ConversationTask[]
      readonly next: string | null
      readonly ended: number
      readonly rowsUnread: number
      readonly ledgersSkipped: number
    }
  | { readonly ok: false; readonly reason: 'unknown-conversation' | 'invalid-cursor' }

export function listConversationTasks(
  input: ConversationTasksInput,
  store: Pick<
    SessionStore,
    | 'workByLabel'
    | 'conversationBinding'
    | 'rootOf'
    | 'turnBlockRootLines'
    | 'piecesWithTheirWaits'
    | 'firstTaskOf'
    | 'conversationTitle'
    | 'defaultTaskTitle'
    | 'agentIdentityNameById'
    | 'recordedOne'
    | 'parentOf'
  >,
  itIsAService?: (conversation: string) => boolean,
): ConversationTasksResult {
  const conversation = resolveConversationAddress(input.conversation, store)
  if (store.conversationBinding(conversation) === null)
    return { ok: false, reason: 'unknown-conversation' }
  let cursor: z.infer<typeof cursorShape> | null = null
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 2048) return { ok: false, reason: 'invalid-cursor' }
      cursor = cursorShape.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
      )
      if (cursor.conversation !== conversation || cursor.listing !== input.listing)
        return { ok: false, reason: 'invalid-cursor' }
    } catch {
      return { ok: false, reason: 'invalid-cursor' }
    }
  }

  const unread = rowsUnreadOnce()
  const owned = store.piecesWithTheirWaits(conversation, unread)
  const ended = owned.reduce((count, row) => count + Number(!TASK_IS_OPEN[row.state]), 0)
  const tasks: ConversationTask[] = owned.flatMap((row) => {
    const open = TASK_IS_OPEN[row.state]
    if (input.listing !== 'all' && open !== (input.listing === 'open')) return []
    return [
      { piece: row.piece, label: row.label, title: row.title, state: row.state, at: row.givenAt },
    ]
  })
  const root = input.listing === 'ended' ? null : store.rootOf(conversation)
  if (root !== null) {
    const lines = store.turnBlockRootLines(root.piece)
    if (lines === null) unread.in(conversation)('the-whole-ledger')
    else
      tasks.push({
        piece: root.piece,
        label: root.label,
        title: lines.title,
        state: null,
        at: root.createdAt,
      })
  }
  const page = tasks
    .filter(
      (row) =>
        cursor === null || row.at < cursor.at || (row.at === cursor.at && row.piece < cursor.piece),
    )
    .sort((left, right) => right.at - left.at || (left.piece < right.piece ? 1 : -1))
  const shown = page.slice(0, Math.min(input.limit, 50))
  const last = shown.at(-1)
  const next =
    last === undefined || page.length === shown.length
      ? null
      : Buffer.from(
          JSON.stringify({
            conversation,
            listing: input.listing,
            at: last.at,
            piece: last.piece,
          }),
        ).toString('base64url')
  return {
    ok: true,
    conversation,
    line: describeConversationForRead(store, conversation, itIsAService?.(conversation)).line,
    tasks: shown,
    next,
    ended,
    rowsUnread: unread.count,
    ledgersSkipped: unread.ledgersSkipped,
  }
}
