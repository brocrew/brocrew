import type { Provider } from '@brobot2/shared'
import type { GiveFacts, GivingConversation } from '../../src/main/runtime/spawn-rails'

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
    helperAs: () => null,
    serviceAt: () => ({ is: 'normal' }),
    spawningEnabled: () => true,
    creatorOf: () => null,
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
