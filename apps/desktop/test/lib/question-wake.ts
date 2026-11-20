import { expect } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'

export function expectNoQuestionWake(events: readonly TranscriptEvent[]): void {
  expect(
    events.filter(
      (event) =>
        event.type === 'message_queued' &&
        (event.appNotice === 'an-answer-is-still-owed' ||
          event.appNotice === 'a-question-stayed-unanswered'),
    ),
  ).toEqual([])
}

export function recordFailedQuestionTurn(
  append: (conversation: string, event: TranscriptEvent) => number,
  input: { asker: string; holder: string; requestId: string; prompt: string; message: string },
): { turnOrdinal: number; terminal: TranscriptEvent } {
  const { asker, holder, requestId, prompt, message } = input
  append(asker, {
    type: 'question_asked',
    requestId,
    prompt,
    questions: [{ id: 'answer', prompt, options: [] }],
  })
  append(asker, { type: 'request_routed', requestId, to: 'an-agent', parent: holder })
  append(holder, {
    type: 'message_queued',
    messageId: requestId,
    kind: 'question',
    text: prompt,
    relayedFrom: asker,
    asks: { asker, requestId },
  })
  append(holder, { type: 'message_unqueued', messageId: requestId, reason: 'sent', text: prompt })
  append(holder, { type: 'user_turn', text: prompt, relayedFrom: asker })
  const terminal: TranscriptEvent = {
    type: 'turn',
    state: 'failed',
    wordOf: 'this-app',
    providerFailure: { message },
  }
  return { terminal, turnOrdinal: append(holder, terminal) }
}
