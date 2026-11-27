import type { SessionStore } from '../../../db/session-store'
import type { LedgerGenerations } from '../../ledger-generations'

export function asyncLedgerGenerations(
  store: Pick<
    SessionStore,
    | 'ledgerStatus'
    | 'beginGeneration'
    | 'appendGeneration'
    | 'promoteGeneration'
    | 'abandonGeneration'
    | 'deadGenerations'
    | 'discardGeneration'
  >,
): LedgerGenerations {
  return {
    async hasLedger(sessionId) {
      return store.ledgerStatus(sessionId).present
    },
    async beginGeneration(sessionId) {
      return store.beginGeneration(sessionId)
    },
    async appendGeneration(sessionId, generation, entries) {
      store.appendGeneration(sessionId, generation, entries)
    },
    async promoteGeneration(sessionId, generation, through) {
      return store.promoteGeneration(sessionId, generation, through)
    },
    async abandonGeneration(sessionId, generation, failure) {
      store.abandonGeneration(sessionId, generation, failure)
    },
    async deadGenerations(sessionId) {
      return store.deadGenerations(sessionId)
    },
    async discardGeneration(sessionId, generation, limit) {
      return store.discardGeneration(sessionId, generation, limit)
    },
  }
}
