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
