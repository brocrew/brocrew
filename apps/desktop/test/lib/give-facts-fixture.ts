import type { ApprovalMode } from '@brobot2/runtime'
import { agentCallerId } from '../../src/main/runtime/agent-tools'
import type { Provider } from '@brobot2/shared'
import type {
  GiveAdmission,
  GiveFacts,
  GivingConversation,
} from '../../src/main/runtime/spawn-rails'

export function giveFactsForTest(
  giver: GivingConversation,
  childProvider: Provider | null,
  override: Partial<GiveFacts> = {},
): GiveFacts {
  return {
    giver: () => giver,
    held: () => [{ piece: 'work_root', label: 'W1', root: true, giver: null, received: true }],
    drivenByTheTurn: () => null,
    isAHelper: () => false,
    agentExists: () => true,
    conversationAt: () => null,
    recentWith: () => ({ rows: [], more: false }),
    serviceAt: () => ({ is: 'normal' }),
    spawningEnabled: () => true,
    itsProvider: () =>
      childProvider === null
        ? { provider: null, from: 'nothing-yet' }
        : { provider: childProvider, from: 'saved' },
    theNamedModelsProvider: () => null,
    modelChoiceOf: () => null,
    checkFolder: (path) => ({ ok: true, path }),
    ...override,
  }
}

export function givingTestParent(cwd: string, provider: Provider, approvalMode: ApprovalMode) {
  const giver: GivingConversation = {
    sessionId: 'sess_parent',
    profileId: 'pm',
    provider,
    cwd,
    approvalMode,
  }
  return giver
}

export function callerOfTestGiver(giver: GivingConversation) {
  return { ownerId: agentCallerId(giver.sessionId) }
}

export function admittedGiveStart(
  out: GiveAdmission,
): { provider: Provider; approvalMode: ApprovalMode } | null {
  if (!out.ok) return null
  if (out.goes.to !== 'a-new-conversation') throw new Error('nothing was found, so it must start')
  return { provider: out.goes.start.provider, approvalMode: out.goes.start.approvalMode }
}
