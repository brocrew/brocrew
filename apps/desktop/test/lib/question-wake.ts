import { expect } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'

export function expectNoQuestionWake(events: readonly TranscriptEvent[]): void {
  expect(
    events.filter(
      (event) =>
        event.type === 'message_queued' &&
        (event.appNotice === 'an-answer-is-still-owed' ||
          event.appNotice === 'a-question-stayed-unanswered' ||
          event.appNotice === 'an-answerer-was-stopped'),
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

/** A provider-failure notice the holder planned for its asker, still queued for the asker. */
export function planProviderFailureNotice(
  append: (conversation: string, event: TranscriptEvent) => number,
  input: {
    asker: string
    holder: string
    terminalOrdinal: number
    since: number
    incident: string
    messageId: string
    text: string
  },
) {
  const { asker, holder, terminalOrdinal, since, incident, messageId, text } = input
  append(holder, {
    type: 'work_reconciliation',
    incident,
    kind: 'provider-turn-failed',
    episode: { generation: 0, terminalOrdinal },
    since,
    step: 'giver',
    outcome: 'planned',
    target: asker,
    messageId,
  })
  const held = {
    messageId,
    text,
    attribution: 'app_authored',
    appNotice: 'a-provider-turn-failed',
  } as const
  append(asker, { ...held, type: 'message_queued', kind: 'notice', providerFailureHolder: holder })
  return held
}
