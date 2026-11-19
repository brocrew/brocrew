import { z } from 'zod'
import { TASK_IS_OPEN } from '../../shared/tasks'
import type { PieceRow, StatusLine, TaskState } from '../../shared/task-contracts'
import type {
  ConversationTaskPageInput,
  ConversationTaskPageResult,
  ConversationTaskPageRow,
} from '../../shared/conversation-task-page'
import type { SessionStore } from '../db/session-store'
import { rowsUnreadOnce } from '../db/rows-unread'
import { describeConversationForRead, resolveConversationAddress } from './conversation-address'

const cursorShape = z.object({
  conversation: z.string(),
  listing: z.enum(['open', 'all', 'ended']),
  at: z.number().finite(),
  piece: z.string(),
})

const panelCursorShape = cursorShape
  .omit({ listing: true })
  .extend({ current: z.string().nullable() })
const OTHER_TASKS_PER_PAGE = 5

type TaskPoint = { readonly piece: string; readonly at: number }
const olderThan = (row: TaskPoint, cursor: TaskPoint): boolean =>
  row.at < cursor.at || (row.at === cursor.at && row.piece < cursor.piece)
const newestFirst = (left: TaskPoint, right: TaskPoint): number =>
  right.at - left.at || (left.piece < right.piece ? 1 : -1)

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
    | 'latestTaskTitle'
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
  const page = tasks.filter((row) => cursor === null || olderThan(row, cursor)).sort(newestFirst)
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

const statusOf = (status: StatusLine | null): ConversationTaskPageRow['statusLine'] =>
  status === null ? null : { text: status.text, at: status.at }

function heldTask(row: PieceRow): ConversationTaskPageRow {
  const { piece, label, title, brief, giver, definitionOfDone, state, givenAt } = row
  return {
    kind: 'held',
    piece,
    label,
    title,
    brief,
    giver,
    ...(definitionOfDone === undefined ? {} : { definitionOfDone }),
    state,
    givenAt,
    statusLine: statusOf(row.statusLine),
  }
}

export function readConversationTasks(
  input: ConversationTaskPageInput,
  store: Pick<
    SessionStore,
    | 'conversationBinding'
    | 'piecesWithTheirWaits'
    | 'rootOf'
    | 'turnBlockRootLines'
    | 'rootDoneCondition'
  >,
): ConversationTaskPageResult {
  const conversation = input.sessionId
  if (store.conversationBinding(conversation) === null) {
    return { ok: false, reason: 'unknown-conversation' }
  }
  let cursor: z.infer<typeof panelCursorShape> | null = null
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 2048) return { ok: false, reason: 'invalid-cursor' }
      cursor = panelCursorShape.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
      )
      if (cursor.conversation !== conversation) return { ok: false, reason: 'invalid-cursor' }
    } catch {
      return { ok: false, reason: 'invalid-cursor' }
    }
  }

  const unread = rowsUnreadOnce()
  const held = store.piecesWithTheirWaits(conversation, unread)
  const order = held.map((row) => ({ row, piece: row.piece, at: row.givenAt })).sort(newestFirst)
  const newest = order.find(({ row }) => TASK_IS_OPEN[row.state])
  let current = newest === undefined ? null : heldTask(newest.row)
  if (current === null) {
    const root = store.rootOf(conversation)
    if (root !== null) {
      const lines = store.turnBlockRootLines(root.piece)
      if (lines === null) unread.in(conversation)('the-whole-ledger')
      else {
        current = {
          kind: 'root',
          piece: root.piece,
          label: root.label,
          title: lines.title,
          brief: root.brief,
          giver: null,
          definitionOfDone: store.rootDoneCondition(root.piece),
          state: null,
          givenAt: root.createdAt,
          statusLine: statusOf(lines.statusLine),
        }
      }
    }
  }

  const currentId = current?.piece ?? null
  if (cursor !== null && cursor.current !== currentId)
    return { ok: false, reason: 'invalid-cursor' }
  const other = order.filter(
    (row) => row.piece !== currentId && (cursor === null || olderThan(row, cursor)),
  )
  const shown = other.slice(0, OTHER_TASKS_PER_PAGE)
  const last = shown.at(-1)
  const counts = { active: 0, open: 0, closed: 0 }
  for (const { state } of held) {
    if (state === 'working') counts.active++
    else if (TASK_IS_OPEN[state]) counts.open++
    else counts.closed++
  }

  return {
    ok: true,
    conversation,
    current,
    other: shown.map(({ row }) => heldTask(row)),
    counts: unread.count === 0 && unread.ledgersSkipped === 0 ? counts : null,
    next:
      last === undefined || other.length === shown.length
        ? null
        : Buffer.from(
            JSON.stringify({ conversation, current: currentId, at: last.at, piece: last.piece }),
          ).toString('base64url'),
    rowsUnread: unread.count,
    ledgersSkipped: unread.ledgersSkipped,
  }
}
