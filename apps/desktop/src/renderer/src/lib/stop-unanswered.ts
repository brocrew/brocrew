import type { StopUnansweredEvent } from '../../../shared/conversation-events'
import type { WorkInterruptedEvent } from '../../../shared/task-contracts'
import { ASKED_TO_STOP, stoppedBy } from '../../../shared/how-work-stopped'
import {
  agentName,
  providerName,
  type AgentIdentity,
  type Provider,
} from '../../../shared/runtime-ipc'

export type StopUnanswered = Pick<StopUnansweredEvent, 'by' | 'agent' | 'agentProfile' | 'waitedMs'>

export type AskedToStop = Pick<WorkInterruptedEvent, 'by' | 'agent' | 'agentProfile'>

export function whoAskedItToStop(
  fact: AskedToStop,
  identities: readonly AgentIdentity[] | null,
): string {
  const named =
    fact.by === 'an-agent' && fact.agentProfile !== undefined && identities !== null
      ? agentName(fact.agentProfile, identities)
      : null
  return stoppedBy(fact.by, named)
}

export function askedToStopSays(
  fact: AskedToStop,
  identities: readonly AgentIdentity[] | null,
): string {
  return `${ASKED_TO_STOP} by ${whoAskedItToStop(fact, identities)}`
}

export function stopUnansweredSays(
  fact: StopUnanswered,
  provider: Provider | null,
  identities: readonly AgentIdentity[] | null = null,
): string {
  const who = provider === null ? `The provider` : providerName(provider)
  return `${who} has not answered the stop asked for by ${whoAskedItToStop(fact, identities)}`
}

export function stopJoinsThatAsk(
  fact: StopUnanswered,
  provider: Provider | null,
  identities: readonly AgentIdentity[] | null = null,
): string {
  const who = provider === null ? `the provider` : providerName(provider)
  return `${stopUnansweredSays(fact, provider, identities)} — while that ask stands, Stop joins it rather than asking ${who} again`
}

export const A_STOP_ASKS_THE_TURN = `the turn is ${ASKED_TO_STOP}`

export const A_STOP_THEN_THIS_IS_SENT = `${A_STOP_ASKS_THE_TURN}; this is sent once it has ended`
