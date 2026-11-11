import type { Provider } from '@brobot2/shared'
import type { ProviderProgram } from '@brobot2/runtime/provider-module'
import type { ModelAndEffort, ModelList } from './model-choice-contracts'

export interface ProviderLaunchChoices {
  readonly list: ModelList
  readonly ready: boolean | null
  readonly defaultModel: ModelAndEffort | null
  readonly defaultModelToSend: ModelAndEffort | null
}

export interface ResolveProviderLaunchInput {
  readonly profileId?: string
  readonly askedProvider: Provider | null
  readonly providers: readonly {
    readonly provider: Provider
    readonly ready: boolean | null
    readonly program?: Pick<ProviderProgram, 'standing'> | null
  }[]
}

export interface ResolvedProviderLaunch {
  readonly provider: Provider
  readonly pickerProvider: Provider | null
  readonly readiness: readonly { readonly provider: Provider; readonly ready: boolean | null }[]
}
