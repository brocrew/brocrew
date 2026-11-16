import type { AppDatabase } from '../../../db/connection'
import type { SessionModelsStore } from './store-operations'

export function createSqliteSessionModels(db: AppDatabase, now: () => number): SessionModelsStore {
  const writeModel = db.prepare(
    `UPDATE provider_session SET model = ?, connection_id = COALESCE(?, connection_id), updated_at = ? WHERE id = ?`,
  )
  const writeReasoningEffort = db.prepare(
    `UPDATE provider_session SET reasoning_effort = ?, updated_at = ? WHERE id = ?`,
  )
  const writeSetByAPerson = db.prepare(
    `UPDATE provider_session SET model_or_effort_set_by_a_person_at = ?, updated_at = ? WHERE id = ?`,
  )
  const writeReported = db.prepare(
    `UPDATE provider_session SET reported_model = ?, reported_effort = ? WHERE id = ?`,
  )
  const readWhatItRunsOn = db.prepare(
    `SELECT model, reasoning_effort, model_or_effort_set_by_a_person_at, reported_model, reported_effort
       FROM provider_session WHERE id = ?`,
  )
  return {
    setModel(sessionId, model, connectionId) {
      writeModel.run(model, connectionId ?? null, now(), sessionId)
    },
    setReasoningEffort(sessionId, effort) {
      writeReasoningEffort.run(effort, now(), sessionId)
    },
    aPersonSetItsModelOrEffort(sessionId, at) {
      writeSetByAPerson.run(at, now(), sessionId)
    },
    setReportedModel(sessionId, model, effort) {
      writeReported.run(model, effort, sessionId)
    },
    whatItRunsOn(sessionId) {
      const row = readWhatItRunsOn.get(sessionId) as
        | {
            model: string | null
            reasoning_effort: string | null
            model_or_effort_set_by_a_person_at: number | null
            reported_model: string | null
            reported_effort: string | null
          }
        | undefined
      return row === undefined
        ? null
        : {
            model: row.model,
            reasoningEffort: row.reasoning_effort,
            aPersonChoseItAt: row.model_or_effort_set_by_a_person_at,
            reportedModel: row.reported_model,
            reportedEffort: row.reported_effort,
          }
    },
  }
}
