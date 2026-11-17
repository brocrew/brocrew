import type { SessionStore } from '../../../db/session-store'
import type { AgentMethods } from '../../methods'

export function createSqliteAgentMethods(
  store: Pick<
    SessionStore,
    | 'hasPendingMethodChange'
    | 'beginMethodChange'
    | 'settleMethodChange'
    | 'methodChange'
    | 'methodChanges'
  >,
): AgentMethods {
  return {
    async hasPendingMethodChange(profile) {
      return store.hasPendingMethodChange(profile)
    },
    async beginMethodChange(profile, said, by, at) {
      return store.beginMethodChange(profile, said, by, at)
    },
    async settleMethodChange(profile, id, outcome, actual, by) {
      return store.settleMethodChange(profile, id, outcome, actual, by)
    },
    async methodChange(profile, id) {
      return store.methodChange(profile, id)
    },
    async methodChanges(profile, offset = 0, limit = 50) {
      return store.methodChanges(profile, offset, limit)
    },
  }
}
