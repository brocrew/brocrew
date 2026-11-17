import type { SessionStore } from '../../../db/session-store'
import type { SessionModels } from '../../session-models'

export function asyncSessionModels(
  store: Pick<SessionStore, 'whatItRunsOn' | 'setReportedModel'>,
): SessionModels {
  return {
    async whatItRunsOn(sessionId) {
      return store.whatItRunsOn(sessionId)
    },
    async setReportedModel(sessionId, model, effort) {
      store.setReportedModel(sessionId, model, effort)
    },
  }
}
