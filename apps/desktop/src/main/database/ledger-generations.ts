import type { TranscriptEvent } from '../../shared/conversation-events'

/**
 * The generations a provider file is projected into: one is built beside the active one, then
 * promoted, abandoned, or collected once nothing can read it.
 */
export interface LedgerGenerations {
  /** Whether the session already has a ledger to read. */
  hasLedger(sessionId: string): Promise<boolean>
  beginGeneration(sessionId: string): Promise<number>
  appendGeneration(
    sessionId: string,
    generation: number,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): Promise<void>
  /** False when another writer replaced the build first; nothing it wrote is readable then. */
  promoteGeneration(
    sessionId: string,
    generation: number,
    through: { normalizerVersion: number; derivedThrough: number },
  ): Promise<boolean>
  abandonGeneration(sessionId: string, generation: number, failure: string | null): Promise<void>
  deadGenerations(sessionId: string): Promise<number[]>
  /** Deletes at most `limit` rows of `generation`, and says how many it deleted. */
  discardGeneration(sessionId: string, generation: number, limit: number): Promise<number>
}
