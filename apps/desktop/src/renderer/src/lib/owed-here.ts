import type { AgentIdentities } from '../../../shared/runtime-ipc-parts/identity'
import { providersNotChosenIn } from './agent-store'
import type { AttentionRequest } from './attention'
import type { PersonsQueue } from './persons-queue'
import { isAnApproval } from './persons-queue-rows'

/** The five lists of Waiting on you, in the order its pills draw them. */
export type WaitingList = 'questions' | 'todo' | 'approvals' | 'work' | 'reply'

/**
 * What a person owes, split into the lists of Waiting on you: the rows of their own queue, the
 * instruction and server asks, the work waiting on their reply, the to-dos and incidents, the
 * agents whose provider they must choose, and `live`, this window's own cards. Stopped and stalled
 * work and recoveries are drawn in the work list but owed by nobody.
 */
export function owedByList(
  persons: PersonsQueue,
  identities: AgentIdentities | null,
  live: readonly AttentionRequest[] = [],
): Readonly<Record<WaitingList, number>> {
  const rows = persons.view.value?.rows ?? []
  const approvals = rows.filter(isAnApproval).length
  const livePermissions = live.filter((one) => one.kind === 'permission').length
  return {
    questions: live.length - livePermissions + rows.length - approvals,
    todo: persons.workWaits.value.todos.rows.length,
    approvals:
      livePermissions +
      approvals +
      (persons.asks.value?.rows.length ?? 0) +
      (persons.serverRequests.value?.rows.length ?? 0) +
      providersNotChosenIn(identities).length,
    work: persons.workWaits.value.incidents.rows.length,
    reply: persons.waitingOnWhoWrote.value?.rows.length ?? 0,
  }
}

/**
 * Everything a person owes that is not one of this window's cards. The sidebar badge and the
 * Waiting on you page both count with {@link owedByList}, so the two numbers cannot drift apart.
 */
export function owedHere(persons: PersonsQueue, identities: AgentIdentities | null): number {
  return Object.values(owedByList(persons, identities)).reduce((sum, n) => sum + n, 0)
}
