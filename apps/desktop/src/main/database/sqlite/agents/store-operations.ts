import type { SessionModelReading } from '../../session-models'

export interface SessionModelsStore {
  setModel(sessionId: string, model: string | null, connectionId?: string): void
  setReasoningEffort(sessionId: string, effort: string | null): void
  aPersonSetItsModelOrEffort(sessionId: string, at: number): void
  setReportedModel(sessionId: string, model: string | null, effort: string | null): void
  whatItRunsOn(sessionId: string): SessionModelReading | null
}
