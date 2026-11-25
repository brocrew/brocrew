import type { TranscriptEvent } from '../../shared/conversation-events'
import type { ResourceRow, SessionStore } from '../db/session-store'
import { textWithOverflowResource } from './send-overflow'

type WorkRepliedEvent = Extract<TranscriptEvent, { type: 'work_replied' }>

interface ReplyWrite {
  readonly conversation: string
  readonly ordinal: number
  readonly at: number
  readonly reply: Omit<WorkRepliedEvent, 'resources' | 'resultDocument'>
  readonly resultIndex: number
  readonly overflowIndex: number
}

/** Inside the caller's transaction, bind actual resource IDs before recording the reply. */
export function appendWorkReplyInTransaction(
  store: Pick<SessionStore, 'append'>,
  { conversation, ordinal, at, reply, resultIndex, overflowIndex }: ReplyWrite,
  keepResources: () => readonly ResourceRow[],
  endQuestionCopies: () => () => void,
) {
  const resources = keepResources()
  const resultDocument = resources[resultIndex]?.resource
  const event: WorkRepliedEvent = {
    ...reply,
    summary: textWithOverflowResource(reply.summary, resources[overflowIndex]?.resource),
    resources: resources.map((one) => one.resource),
    ...(resultDocument === undefined ? {} : { resultDocument }),
  }
  store.append(conversation, ordinal, event, at)
  const publishQuestionEndings = endQuestionCopies()
  return {
    resources,
    entry: { sessionId: conversation, ordinal, at, event },
    publishQuestionEndings,
  }
}
