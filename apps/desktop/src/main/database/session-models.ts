export interface SessionModelReading {
  readonly model: string | null
  readonly reasoningEffort: string | null
  /** When a person last changed its model or effort, or null. */
  readonly aPersonChoseItAt: number | null
  readonly reportedModel: string | null
  readonly reportedEffort: string | null
}

export interface SessionModels {
  whatItRunsOn(sessionId: string): Promise<SessionModelReading | null>
  setReportedModel(sessionId: string, model: string | null, effort: string | null): Promise<void>
}
