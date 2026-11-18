import type { AgentIdentities } from '../../../shared/runtime-ipc-parts/identity'
import { providersNotChosenIn } from './agent-store'
import type { PersonsQueue } from './persons-queue'

/**
 * Everything a person owes that is not one of this window's cards: the rows of their own queue,
 * the instruction and server asks, the work waiting on their reply, the to-dos and incidents, and
 * the agents whose provider they must choose. The sidebar badge and the Waiting on you page both
 * count this, so the two numbers cannot drift apart.
 */
export function owedHere(persons: PersonsQueue, identities: AgentIdentities | null): number {
  return (
    (persons.view.value?.count ?? 0) +
    (persons.asks.value?.rows.length ?? 0) +
    (persons.serverRequests.value?.rows.length ?? 0) +
    (persons.waitingOnWhoWrote.value?.rows.length ?? 0) +
    persons.workWaits.value.todos.rows.length +
    persons.workWaits.value.incidents.rows.length +
    providersNotChosenIn(identities).length
  )
}
