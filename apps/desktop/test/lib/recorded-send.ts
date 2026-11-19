import { waitFor } from './host-fixture'
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

export function expectRecordedMessageWithMissingProviderFile(
  result: Record<string, unknown>,
  recipientId: string,
  address: string,
): void {
  expect(result).toMatchObject({
    outcome: 'ok',
    receipt: {
      recorded: { kind: 'message', id: expect.any(String) },
      recipient: {
        id: recipientId,
        address,
        state: { kind: 'cannot-run', cause: { code: 'provider-file-missing' } },
      },
    },
  })
}

export async function expectRecordedMessageDelivered(
  events: () => readonly TranscriptEvent[],
  id: string,
  text: string,
): Promise<void> {
  const delivered = () =>
    events().filter((event) => event.type === 'message_unqueued' && event.messageId === id)
  await waitFor(() => delivered().length > 0, 'the recorded message to arrive')
  expect(delivered()).toEqual([expect.objectContaining({ reason: 'sent', text })])
}

export function expectHeldGiveWithoutMessage(
  result: Record<string, unknown>,
  worker: string,
): void {
  expect(result.outcome, JSON.stringify(result)).toBe('ok')
  expect(result.agent).toBe(worker)
  expect(result).not.toHaveProperty('message')
}
