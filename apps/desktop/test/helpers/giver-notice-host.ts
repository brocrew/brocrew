import { afterEach, expect } from 'vitest'
import type { SessionStore } from '../../src/main/db/session-store'
import { RuntimeHost as ProductRuntimeHost } from '../../src/main/runtime/runtime-host'
import type { ReconciliationPiece } from '../../src/main/runtime/work-reconciliation'
import type { ReconciliationReceipt } from '../../src/shared/work-reconciliation'

import { theMessagesOf } from '../../src/shared/runtime-ipc'

export * from '../../src/main/runtime/runtime-host'

const missingReceipts: string[] = []
afterEach(() => {
  expect(
    missingReceipts.splice(0),
    'every simulated delivery follows its persisted ladder step',
  ).toEqual([])
})

/** These fixtures reach giver notices through a holder whose reminder cannot be delivered. */
function declineTurnEndReminders(host: ProductRuntimeHost): void {
  const delivery = host as unknown as {
    deps: { store: SessionStore }
    deliverReconciliation(
      piece: ReconciliationPiece,
      receipt: ReconciliationReceipt,
    ): Promise<boolean>
  }
  const original = delivery.deliverReconciliation.bind(host)
  delivery.deliverReconciliation = (piece, receipt) => {
    if (receipt.cause === 'turn_ended') {
      if (receipt.step === 'holder') {
        if (
          !delivery.deps.store
            .reconciliationReceipts(piece.holder, piece.piece)
            .some(
              (one) =>
                one.incident === receipt.incident &&
                one.step === 'holder' &&
                one.outcome === 'planned',
            )
        )
          missingReceipts.push(`${piece.piece}: holder delivery lacked a planned receipt`)
        return Promise.resolve(false)
      }
      if (receipt.step === 'giver') {
        if (
          !delivery.deps.store
            .reconciliationReceipts(piece.holder, piece.piece)
            .some(
              (one) =>
                one.incident === receipt.incident &&
                one.step === 'holder' &&
                one.outcome === 'failed',
            )
        )
          missingReceipts.push(`${piece.piece}: giver delivery preceded the failed-holder receipt`)
      }
    }
    return original(piece, receipt)
  }
}

/** Ordinary stall fixtures decline the holder reminder before exercising the giver step. */
export class RuntimeHost extends ProductRuntimeHost {
  constructor(...args: ConstructorParameters<typeof ProductRuntimeHost>) {
    super(...args)
    declineTurnEndReminders(this)
  }
}

/** Both the existing stall notice and the serial ladder tell the giver its work needs attention. */
export function isGiverStallNotice(text: string): boolean {
  return text.includes('not being worked on') || text.includes('still needs attention:')
}

/** One notice, whether still queued or already sent, rather than both of its ledger rows. */
export function giverStallNotices(store: SessionStore, giver: string): string[] {
  const events = store.events(giver).map((one) => one.event)
  const sent = new Set(
    events.flatMap((event) =>
      event.type === 'message_unqueued' && event.reason === 'sent' && event.messageId !== undefined
        ? [event.messageId]
        : [],
    ),
  )
  return events.flatMap((event) => {
    if (event.type === 'message_queued')
      return (event.messageId === undefined || !sent.has(event.messageId)) &&
        isGiverStallNotice(event.text.split('\n')[0] ?? '')
        ? [event.text]
        : []
    if (event.type === 'user_turn')
      return theMessagesOf(event).flatMap((message) =>
        isGiverStallNotice(message.text.split('\n')[0] ?? '') ? [message.text] : [],
      )
    return []
  })
}

/** Accepted giver notices from either durable receipt vocabulary. */
export function giverStallReceipts(store: SessionStore, giver: string) {
  const events = store.events(giver).map((one) => one.event)
  const messages = new Set(
    events.flatMap((event) =>
      event.type === 'message_queued' && event.appNotice === 'a-work-wait-needs-attention'
        ? [event.messageId]
        : [],
    ),
  )
  return [
    ...events.flatMap((event) => (event.type === 'work_stall_told' ? [event] : [])),
    ...store
      .reconciliationOwners()
      .flatMap((owner) => store.reconciliationReceiptsForOwner(owner))
      .filter(
        (receipt) =>
          receipt.step === 'giver' &&
          receipt.outcome === 'delivered' &&
          (receipt.target === giver ||
            (receipt.messageId !== undefined && messages.has(receipt.messageId))),
      ),
  ]
}
