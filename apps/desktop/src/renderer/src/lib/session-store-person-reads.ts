import type { ClientSessionApi } from '../../../shared/client-session-api'
import { readPersonsQueue } from './read-persons-queue'
import type {
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
} from '../../../shared/question-contracts'
import type { McpServerRequestForAPerson } from '../../../shared/conversation-events'
import type { WhatEachConversationIsWaitingOn, WorkGivenOut } from '../../../shared/task-contracts'
import type { WhoCalledWhom } from '../../../shared/who-called-whom'
import type { ProviderLimitSeen } from '../../../shared/provider-limit'
import type { LimitsDisplayAnswer } from '../../../shared/limits-display'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import type { WorkIncident } from '../../../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
import type { RecentActivityReading } from '../../../shared/recent-activity'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import type { WhatIsBeingDone } from '../../../shared/what-is-being-done'
import type { ForestNodesPage, ForestReading } from '../../../shared/the-whole-forest'
import type { ProcessMemory } from '../../../shared/runtime-ipc'
import type { SessionStore } from './session-store-contract'

/** What the window reads for the person: the queue, the ledgers they act on, and the app's readings. */
export function createPersonReads(
  bridge: ClientSessionApi,
): Pick<
  SessionStore,
  | 'personsQueue'
  | 'questionsForAPerson'
  | 'decisionsForAPerson'
  | 'limitsForAPerson'
  | 'readLimitsDisplay'
  | 'stalledWorkForAPerson'
  | 'stoppedWorkForAPerson'
  | 'workIncidentsForAPerson'
  | 'waitingOnWhoWroteForAPerson'
  | 'instructionAsksForAPerson'
  | 'mcpServerRequestsForAPerson'
  | 'readWorkspace'
  | 'whatIsBeingDone'
  | 'whatEachConversationIsWaitingOn'
  | 'forestReading'
  | 'forestNodes'
  | 'processMemory'
  | 'recentActivity'
  | 'workGivenBy'
  | 'whoCalledWhom'
> {
  return {
    /**
     * ⚑ **The one read in this store whose refusal is a VALUE rather than a rejection** (401).
     *
     * ⛔ **`null`, never `[]`.** Every other degrading read here answers with the empty thing
     * because empty and unknown mean the same to its caller; here they do not. An empty queue is
     * the sentence *"nothing is waiting on you"* — the strongest claim this app makes about a
     * person's own workload — and a dropped IPC call must not be able to make it.
     */
    personsQueue: () => readPersonsQueue(bridge),

    async questionsForAPerson(): Promise<LedgerWalk<PersonsQuestion> | null> {
      try {
        return await bridge.questionsForAPerson()
      } catch {
        return null
      }
    },

    /**
     * ⚑ **The second read whose refusal is a VALUE** (403) — the note above, unchanged.
     *
     * ⛔ **`null`, never `[]`**, and here the claim empty would make is stronger still: a person is
     * the ONLY party who may settle one of these rows, so *"nothing is waiting on you"* drawn out
     * of a dropped IPC call names nobody else who could pick it up.
     */
    async decisionsForAPerson(): Promise<LedgerWalk<PersonsDecision> | null> {
      try {
        return await bridge.decisionsForAPerson()
      } catch {
        return null
      }
    },

    /**
     * ⚑ **The fifth read whose refusal is a VALUE** (533) — the notes above, with one difference.
     *
     * ⛔ **`null`, never `[]`**, and here the all-clear is about the WORLD rather than about a
     * person's workload: an empty list says no provider has walled, which is the sentence `533` §0
     * measured this app being unable to make honestly.
     */
    async limitsForAPerson(): Promise<LedgerWalk<ProviderLimitSeen> | null> {
      try {
        return await bridge.limitsForAPerson()
      } catch {
        return null
      }
    },
    async readLimitsDisplay(): Promise<LimitsDisplayAnswer | null> {
      try {
        return await bridge.readLimitsDisplay()
      } catch {
        return null
      }
    },
    /**
     * ⚑ **The sixth read whose refusal is a VALUE** (557) — the notes above, with the sharpest
     * all-clear of them.
     *
     * ⛔ **`null`, never `[]`**: an empty list is the claim *nothing has stopped with nobody to
     * tell*, and a dropped call answering it would restate the defect this read exists to close.
     */
    async stalledWorkForAPerson(): Promise<LedgerWalk<StalledWork> | null> {
      try {
        return await bridge.stalledWorkForAPerson()
      } catch {
        return null
      }
    },
    async stoppedWorkForAPerson(): Promise<LedgerWalk<StoppedWorkForAPerson> | null> {
      try {
        return await bridge.stoppedWorkForAPerson()
      } catch {
        return null
      }
    },
    async workIncidentsForAPerson(): Promise<LedgerWalk<WorkIncident> | null> {
      try {
        return await bridge.workIncidentsForAPerson()
      } catch {
        return null
      }
    },
    /**
     * ⚑ **F097 — a read whose refusal is a VALUE**, for the notes above: `null`, never `[]`, because
     * empty would claim nobody's agent is waiting on their reply.
     */
    async waitingOnWhoWroteForAPerson(): Promise<LedgerWalk<WaitingOnWhoWrote> | null> {
      try {
        return await bridge.waitingOnWhoWroteForAPerson()
      } catch {
        return null
      }
    },
    /**
     * ⚑ **D-017 · R19 — a read whose refusal is a VALUE**, for the notes above: `null`, never `[]`,
     * because empty would claim no agent is waiting on a person's word about its rules.
     */
    async instructionAsksForAPerson(): Promise<readonly InstructionAskWaiting[] | null> {
      try {
        return await bridge.instructionAsksForAPerson()
      } catch {
        return null
      }
    },
    /** A read whose refusal is a value, for its neighbour's reason. */
    async mcpServerRequestsForAPerson(): Promise<readonly McpServerRequestForAPerson[] | null> {
      try {
        return await bridge.mcpServerRequestsForAPerson()
      } catch {
        return null
      }
    },
    /**
     * ⚑ **The seventh read whose refusal is a VALUE** (571) — the notes above, on the one read
     * here that answers with a shape rather than a list.
     *
     * ⛔ **`null`, never a reading assembled here.** The two arms a caller might reach for are both
     * worse than nothing: zeros would claim a quiet workspace out of a dropped call, and
     * `not-at-all` would carry a {@link WorkspaceReading.readAt} this window minted rather than
     * measured — which is the one thing that stamp may never be
     * (*"Delivering a refresh intent, resolving its callback or repainting a page never produces a
     * newer reading"*).
     */
    async readWorkspace(): Promise<WorkspaceReading | null> {
      try {
        return await bridge.readWorkspace()
      } catch {
        return null
      }
    },
    /**
     * ⚑ **The eighth read whose refusal is a VALUE** (575) — the notes above, unchanged.
     *
     * ⛔ **`null`, never `{ conversations: [], readAt: … }`.** That literal is a REAL answer
     * meaning *this app is running nothing*, and minting one out of a dropped call would draw every
     * agent as stopped and stamp the claim with a moment this window never measured.
     */
    async whatIsBeingDone(): Promise<WhatIsBeingDone | null> {
      try {
        return await bridge.whatIsBeingDone()
      } catch {
        return null
      }
    },
    /**
     * ⚑ **The ninth read whose refusal is a VALUE** (621) — the notes above, unchanged.
     *
     * ⛔ **`null`, never `{ conversations: [], readAt: … }`.** That literal is a REAL answer
     * meaning *nothing in this app is waiting on anybody*, and minting one out of a dropped call
     * would take every wait off every surface and stamp it with a moment this window never
     * measured.
     */
    async whatEachConversationIsWaitingOn(): Promise<WhatEachConversationIsWaitingOn | null> {
      try {
        return await bridge.whatEachConversationIsWaitingOn()
      } catch {
        return null
      }
    },
    async forestReading(scope): Promise<ForestReading | null> {
      try {
        return await bridge.forestReading(scope)
      } catch {
        return null
      }
    },
    async forestNodes(reading, conversations): Promise<ForestNodesPage | null> {
      try {
        return await bridge.forestNodes(reading, conversations)
      } catch {
        return null
      }
    },
    /** ⚑ **D-018 · a read that did not answer is `null`** — the interface's note says why. */
    async processMemory(): Promise<ProcessMemory | null> {
      try {
        return await bridge.processMemory()
      } catch {
        return null
      }
    },
    async recentActivity(from: number, to: number): Promise<RecentActivityReading | null> {
      try {
        return await bridge.recentActivity({ from, to })
      } catch {
        return null
      }
    },

    /** ⛔ **`null`, never an empty walk** — Recent activity's rule, for the same reason (508). */
    async workGivenBy(sessionId: string): Promise<LedgerWalk<WorkGivenOut> | null> {
      try {
        return await bridge.workGivenBy({ sessionId })
      } catch {
        return null
      }
    },

    /**
     * ⛔ **`null`, never an empty answer** — the reader above's rule, for the same reason (547).
     * ⚑ **And never a partial one**: the three walks inside it carry their own completeness, so a
     * caller that got an object got all three of them stamped at one moment.
     */
    async whoCalledWhom(sessionId: string): Promise<WhoCalledWhom | null> {
      try {
        return await bridge.whoCalledWhom({ sessionId })
      } catch {
        return null
      }
    },
  }
}
