import { DEFAULT_CONVERSATION_PROVIDER, type Provider } from '@brobot2/shared'
import type { AuthState } from '@brobot2/runtime'
import type { ModelAndEffort, ModelList } from '../../shared/model-choice-contracts'
import type { ProviderProgram } from '../../shared/runtime-ipc'
import { sameModel } from '../../shared/model-choice'
import type {
  ProviderLaunchChoices,
  ResolveProviderLaunchInput,
  ResolvedProviderLaunch,
} from '../../shared/provider-launch'

/** Resolve existing launch choices without treating a refused catalogue as an empty answer. */
export function providerLaunchChoices(
  list: ModelList,
  auth: AuthState,
  program?: Pick<ProviderProgram, 'standing'> | null,
): ProviderLaunchChoices {
  const notAsked = list.notAsked
  const setupRequired = notAsked?.reason === 'refused' && notAsked.setupRequired === true
  const ready =
    program?.standing === 'missing' ||
    auth.state === 'absent' ||
    auth.state === 'stale' ||
    setupRequired
      ? false
      : auth.state === 'usable' || notAsked === null
        ? true
        : null
  const reason =
    ready === true
      ? undefined
      : auth.state === 'absent' || auth.state === 'stale'
        ? auth.reason
        : notAsked?.reason === 'refused'
          ? notAsked.detail
          : auth.state === 'unknown'
            ? auth.reason
            : undefined
  const row = list.models.find((model) => model.isDefault)
  const fallback: ModelAndEffort | null =
    row === undefined ? null : { model: row.id, effort: row.defaultEffort ?? null }
  const start = list.lastPicked ?? list.startsOn ?? fallback
  const last = list.lastPicked
  const startsOn = list.startsOn
  return {
    list,
    ready,
    ...(reason === undefined ? {} : { reason }),
    defaultModel: start === null ? null : { model: start.model, effort: start.effort },
    defaultModelToSend:
      last === null ||
      (startsOn !== null &&
        sameModel(startsOn.model, last.model) &&
        startsOn.effort === last.effort)
        ? null
        : last,
  }
}

/** Select from already supplied facts only; no provider read is started by this operation. */
export function resolveProviderLaunch(
  input: ResolveProviderLaunchInput,
  identityProvider: Provider | null,
): ResolvedProviderLaunch {
  const preferred = input.askedProvider ?? identityProvider ?? DEFAULT_CONVERSATION_PROVIDER
  const readiness = input.providers.map(({ provider, ready, program }) => ({
    provider,
    ready: program?.standing === 'missing' ? false : ready,
  }))
  const first = readiness.find((one) => one.ready === true)?.provider ?? null
  const isReady = (provider: Provider): boolean =>
    readiness.some((one) => one.provider === provider && one.ready === true)
  return {
    readiness,
    provider: isReady(preferred) ? preferred : (first ?? preferred),
    pickerProvider:
      input.askedProvider !== null && isReady(input.askedProvider) ? input.askedProvider : first,
  }
}
