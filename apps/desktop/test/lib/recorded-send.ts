import { expect } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
} from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { SessionStore } from '../../src/main/db/session-store'
import type { SendReceipt } from '../../src/shared/tool-outcome'

export function expectRecordedCannotRun(
  result: Record<string, unknown>,
  kind: SendReceipt['recorded']['kind'],
  reason: string,
  needsPerson: boolean,
): SendReceipt {
  expect(result).toMatchObject({
    outcome: 'ok',
    receipt: {
      recorded: { kind, id: expect.any(String) },
      recipient: {
        id: expect.any(String),
        address: expect.any(String),
        state: {
          kind: 'cannot-run',
          cause: { code: 'could-not-start', reason: expect.stringContaining(reason) },
        },
      },
    },
  })
  const receipt = result.receipt as SendReceipt
  const state = receipt.recipient.state
  expect(state.kind === 'cannot-run' && state.needsPerson === true).toBe(needsPerson)
  return receipt
}

export function expectTaskKept(store: SessionStore, receipt: SendReceipt): void {
  const { recorded, recipient } = receipt
  expect(recorded.taskLabel).toMatch(/^W\d/)
  expect(store.workById(recorded.id)).toMatchObject({
    owner: recipient.id,
    label: recorded.taskLabel,
  })
  expect(store.conversationTitle(recipient.id)?.title).toBe(recipient.title)
}

export function expectRecordedGiveKept(
  store: SessionStore,
  result: Record<string, unknown>,
  reason: string,
  needsPerson: boolean,
): SendReceipt {
  const receipt = expectRecordedCannotRun(result, 'task', reason, needsPerson)
  expectTaskKept(store, receipt)
  return receipt
}

export function logKeepsFailure(calls: readonly (readonly unknown[])[], wanted: Error): boolean {
  return calls.flat().some((value) => {
    let error: unknown = value
    while (error instanceof Error) {
      if (error === wanted) return true
      error = error.cause
    }
    return false
  })
}

export function recordedSendNotices(events: readonly TranscriptEvent[]): string[] {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.items
    .filter((item): item is NoticeItem => item.kind === 'notice')
    .map((item) => item.text)
}

export function newestNamedHold(events: readonly TranscriptEvent[]): string {
  const queued = [...events].reverse().find((event) => event.type === 'message_queued')
  if (queued?.type !== 'message_queued' || queued.messageId === undefined) {
    throw new Error('The conversation has no named queued message.')
  }
  return queued.messageId
}

export function expectRecordedBriefBeforeFirstTurn(types: readonly TranscriptEvent['type'][]) {
  expect(types.filter((type) => type === 'user_turn')).toHaveLength(1)
  expect(types.filter((type) => type === 'work_given')).toHaveLength(1)
  const recorded = types.indexOf('work_given')
  const queued = types.indexOf('message_queued')
  expect(queued).toBeGreaterThan(-1)
  expect(queued).toBeLessThan(recorded)
  expect(recorded).toBeLessThan(types.indexOf('user_turn'))
}

export function expectDistinctSentGiveAndPersonMessage(
  endings: ReadonlyMap<string, readonly string[]>,
  events: readonly TranscriptEvent[],
  personText: string,
) {
  const holds = events.filter((event) => event.type === 'message_queued')
  const opening = holds.find((event) => event.kind === 'work')
  const words = holds.find((event) => event.text === personText)
  expect(opening?.messageId).toMatch(/^msg_/)
  expect(words?.messageId).toMatch(/^msg_/)
  expect(opening?.messageId).not.toBe(words?.messageId)
  expect(endings).toEqual(
    new Map([
      [opening?.messageId, ['sent']],
      [words?.messageId, ['sent']],
    ]),
  )
}
