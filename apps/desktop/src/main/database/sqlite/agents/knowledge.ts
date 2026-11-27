import type { SessionStore } from '../../../db/session-store'
import type { MemoryAmendmentJournal } from '../../knowledge'

export function createSqliteMemoryAmendmentJournal(
  store: Pick<SessionStore, keyof MemoryAmendmentJournal>,
): MemoryAmendmentJournal {
  return {
    async memoryAmendmentsOf(profile) {
      return store.memoryAmendmentsOf(profile)
    },
    async beginMemoryAmendment(said, at) {
      return store.beginMemoryAmendment(said, at)
    },
    async settleMemoryAmendment(profile, id, actual, by) {
      return store.settleMemoryAmendment(profile, id, actual, by)
    },
    async hasPendingMemoryAmendment(profile) {
      return store.hasPendingMemoryAmendment(profile)
    },
    async memoryAmendment(profile, id) {
      return store.memoryAmendment(profile, id)
    },
  }
}
