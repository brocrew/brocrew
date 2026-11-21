import { expect } from 'vitest'
import type { SessionStore } from '../../src/main/db/session-store'
import { THE_APP_ITSELF, type RuntimeHost } from '../../src/main/runtime/runtime-host'
import { waitFor } from './f093-host'
import { newConversationGive } from './give-fixture'

type CallOn = (
  caller: string,
  name: 'give_work' | 'message_agent',
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>

/**
 * A worker the PM gave work, and that then STOPPED — the conversation a wake brings back. The give
 * starts it and gives it the work in one act; the app's own close is the stop.
 */
export async function stopAGivenWorker(
  { host, store }: { host: RuntimeHost; store: SessionStore },
  callOn: CallOn,
  pm: string,
): Promise<{ worker: string; label: string }> {
  const given = await callOn(
    pm,
    'give_work',
    newConversationGive('worker', 'The schema', 'migrate the schema'),
  )
  expect(given.outcome, JSON.stringify(given)).toBe('ok')
  const worker = given.agent as string
  await waitFor(
    () => store.piecesOwnedBy(worker).some((piece) => piece.giver === pm),
    'the give to open a piece',
  )
  await host.close(worker, THE_APP_ITSELF)
  await waitFor(() => !host.sessionIds.includes(worker), 'the worker to be over')
  return { worker, label: given.label as string }
}

/**
 * The wake is the start a message makes: a `message_agent` to a conversation that is not running
 * starts it. A follow-up naming the piece, because the worker holds the PM's open work.
 */
export function wakeWithAFollowUp(
  callOn: CallOn,
  pm: string,
  worker: string,
  label: string,
): Promise<Record<string, unknown>> {
  return callOn(pm, 'message_agent', {
    agent: worker,
    text: 'carry on',
    kind: 'follow-up',
    piece: label,
  })
}
