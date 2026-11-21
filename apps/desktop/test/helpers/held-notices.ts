import type { TranscriptEvent } from '../../src/shared/conversation-events'

/** Whether a notice held for a conversation's next input was marked sent with an input. */
export function aHeldNoticeWent(
  ledger: readonly TranscriptEvent[],
  appNotice: string,
  words = '',
): boolean {
  const notice = ledger.find(
    (row) =>
      row.type === 'message_queued' && row.appNotice === appNotice && row.text.includes(words),
  )
  return (
    notice?.type === 'message_queued' &&
    ledger.some(
      (row) =>
        row.type === 'message_unqueued' &&
        row.messageId === notice.messageId &&
        row.reason === 'sent',
    )
  )
}
