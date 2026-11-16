import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ProviderProgram } from '@brobot2/runtime/provider-module'
import type { ModelAndEffort, ModelList } from './model-choice-contracts'

/** A model read names configuration without invoking a credential gesture. */
export interface ProviderModelReadInput {
  readonly provider: Provider
  readonly profileId?: string
  readonly connectionId?: string
}

export interface ProviderLaunchChoices {
  readonly list: ModelList
  readonly connections?: readonly ProviderConnection[]
  readonly defaultConnectionId?: string
  /** Settled knowledge; null is unknown readiness, not an outstanding read. */
  readonly ready: boolean | null
  readonly reason?: string
  readonly defaultModel: ModelAndEffort | null
  readonly defaultModelToSend: ModelAndEffort | null
}

export interface ResolveProviderLaunchInput {
  readonly profileId?: string
  readonly askedProvider: Provider | null
  readonly askedConnectionId?: string
  readonly providers: readonly {
    readonly provider: Provider
    readonly ready: boolean | null
    readonly program?: Pick<ProviderProgram, 'standing'> | null
  }[]
}

export interface ResolvedProviderLaunch {
  readonly connectionId?: string
  readonly provider: Provider
  readonly pickerProvider: Provider | null
  readonly readiness: readonly { readonly provider: Provider; readonly ready: boolean | null }[]
}

export type ProviderReadiness =
  | { readonly state: 'pending' }
  | { readonly state: 'settled'; readonly ready: boolean | null; readonly reason: string | null }
