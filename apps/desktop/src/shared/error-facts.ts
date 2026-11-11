/** Core's reading of a diagnostic, carried beside its unchanged recorded event. */
export interface ErrorFacts {
  sentence: string
  /** The runtime's failure receipt, including an empty reason when none was recorded. */
  ending?: { raw: string; sentence: string }
}
