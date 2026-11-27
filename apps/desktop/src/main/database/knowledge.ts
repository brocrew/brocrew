import type {
  MemoryAmendment,
  MemoryAmendmentWrite,
  MemoryObservation,
} from '../../shared/agent-memory'
import type { ActedBy } from '../../shared/who-did-it'

export interface MemoryAmendmentJournal {
  memoryAmendmentsOf(profile: string): Promise<readonly MemoryAmendment[]>
  beginMemoryAmendment(said: MemoryAmendmentWrite, at: number): Promise<MemoryAmendment | null>
  settleMemoryAmendment(
    profile: string,
    id: string,
    actual: MemoryObservation,
    by: ActedBy,
  ): Promise<boolean>
  hasPendingMemoryAmendment(profile: string): Promise<boolean>
  memoryAmendment(profile: string, id: string): Promise<MemoryAmendment | null>
}
