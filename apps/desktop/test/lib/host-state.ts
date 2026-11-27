import { agentStateOf } from '../../src/shared/agent-state'
import type { AgentState } from '../../src/shared/agent-state-contracts'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'

/**
 * 501 · the state the host would push for a record with no wait, question or card: its own fold
 * ({@link agentStateOf}) over what the record left running and scheduled, and whether a turn runs.
 * The window derives no state of its own, so a test that draws one hands it the host's.
 */
export function hostStateOf(
  record: Pick<SessionRecord, 'control'>,
  over: { readonly active?: boolean } = {},
): AgentState {
  return agentStateOf(
    {
      needsYou: false,
      active: over.active === true,
      waitingOnTheAnswerOf: null,
      owesAnAnswerTo: [],
      background: record.control.background,
      scheduled: record.control.schedule,
      waitingOnTheWorkOf: [],
    },
    Date.now(),
  )
}
