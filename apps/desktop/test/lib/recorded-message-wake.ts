import { expect } from 'vitest'
import type { SessionStore } from '../../src/main/db/session-store'

export function recordedMessageWakeFailure(
  store: SessionStore,
  recipient: string,
  result: Readonly<Record<string, unknown>>,
  code: 'could-not-start' | 'provider-file-missing',
  reason: RegExp,
  needsPerson = false,
): string {
  expect(result).toMatchObject({
    outcome: 'ok',
    delivery: 'queued',
    agent: recipient,
    receipt: {
      recorded: { kind: 'message', id: expect.any(String) },
      recipient: {
        id: recipient,
        state: { kind: 'cannot-run', cause: { code, reason: expect.stringMatching(reason) } },
      },
    },
  })
  const receipt = result.receipt as {
    recorded: { id: string }
    recipient: { state: { needsPerson?: true } }
  }
  expect(receipt.recipient.state.needsPerson === true).toBe(needsPerson)
  const id = receipt.recorded.id
  expect(store.messagesWaitingIn(recipient).filter((one) => one.messageId === id)).toHaveLength(1)
  return id
}
