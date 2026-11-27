import type { AgentState } from '../../../shared/agent-state-contracts'
import type { SessionRecord } from './session-record'

/**
 * A conversation's state is only what the host published for it; before one arrives it is unknown
 * (501). No window-side derivation stands in: every live record is seeded from the host, and a
 * recorded page reads its listed row.
 */
export function stateForRecord(record: Pick<SessionRecord, 'agentState'>): AgentState | undefined {
  return record.agentState ?? undefined
}
