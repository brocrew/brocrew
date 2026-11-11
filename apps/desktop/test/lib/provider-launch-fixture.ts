import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { AuthState, Provider, RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { ModelList } from '../../src/shared/model-choice-contracts'
import {
  providerLaunchChoices,
  resolveProviderLaunch,
} from '../../src/main/runtime/provider-launch'
import { createModelLists as holdModelLists } from '../../src/renderer/src/lib/model-lists'

type ListDoors = Pick<RuntimeBridge, 'modelList' | 'addHandAddedModel' | 'deleteHandAddedModel'> &
  Partial<Pick<ClientProviderApi, 'checkProviderAuth'>>
const UNKNOWN: AuthState = {
  state: 'unknown',
  reason: 'This fixture supplies no separate auth fact.',
}

export function launchFacts(list: ModelList, auth: AuthState = UNKNOWN) {
  return providerLaunchChoices(list, auth)
}

export function createModelLists(
  bridge: () => ListDoors,
  identityProvider: Provider | null = null,
) {
  return holdModelLists(() => ({
    providerLaunchChoices: async (input) => {
      const doors = bridge()
      const list = await doors.modelList(input)
      const auth = await doors.checkProviderAuth?.(input)
      return launchFacts(list, auth ?? UNKNOWN)
    },
    resolveProviderLaunch: async (input) => resolveProviderLaunch(input, identityProvider),
    addHandAddedModel: (input) => bridge().addHandAddedModel(input),
    deleteHandAddedModel: (input) => bridge().deleteHandAddedModel(input),
  }))
}

export { resolveProviderLaunch }
