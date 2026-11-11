import type { Provider, ProviderCapabilityMap, CapabilityStatus } from '../../../shared/runtime-ipc'
import type { ReportedModel } from '../../../shared/model-choice-contracts'
import { MODEL_CHOICE_SAID, sameModel } from '../../../shared/model-choice'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import { modelField } from './model-field'
import {
  isNoLongerListed,
  NO_LONGER_LISTED,
  thePickerRows,
  theEffortsOffered,
  type ModelLists,
  type PickedModel,
} from './model-lists'

const PENDING: CapabilityStatus = {
  state: 'absent',
  reason: 'Still asking this provider what it can do.',
  checkedAgainst: 'the capability fetch has not returned yet',
}

export function modelPickerSection(
  lists: ModelLists,
  provider: Provider,
  profileId: string | undefined,
  ready: boolean | null,
  startsOn: PickedModel | null,
  capabilities: ProviderCapabilityMap | null,
) {
  const held = lists.held(provider, profileId)
  const list = held?.state === 'answered' ? held.list : null
  const name = PROVIDER_NAME[provider]
  const field =
    held?.state === 'unread'
      ? {
          message:
            ready === false
              ? `${name} isn't set up. Set it up in Settings → Providers.`
              : `${name} didn't answer. Try again.`,
          tone: 'warn' as const,
          remedy: null,
          detail: held.why,
          retry: ready !== false,
          notSetUp: ready === false,
        }
      : modelField({
          catalogue:
            list === null
              ? null
              : (list.notAsked ?? {
                  ok: true,
                  models: list.models.filter((row) => row.addedBy === 'the-provider'),
                }),
          ready,
          profileExists: true,
          provider: name,
          signIn: capabilities?.[provider]?.signIn ?? PENDING,
          reprovision: capabilities?.[provider]?.reprovisionAuth ?? PENDING,
        })
  const current = startsOn?.provider === provider ? startsOn.model : null
  return {
    provider,
    ready,
    name,
    list,
    field,
    rows: thePickerRows(list, current).map((one) => ({
      ...one,
      mark: one.row === null && isNoLongerListed(list, one.id) ? NO_LONGER_LISTED : null,
    })),
  }
}

export function modelPickerEffortWords(
  draft: { readonly provider: Provider; readonly model: string } | null,
  offered: ReturnType<typeof theEffortsOffered> | null,
  effort: string | null | undefined,
  profileId: string | undefined,
) {
  const model = draft?.model ?? null
  const levels = offered?.known === true ? offered.levels : []
  const description = levels.find((level) => level.id === effort)?.description ?? null
  const silence =
    draft === null || offered === null
      ? null
      : !offered.known
        ? `${PROVIDER_NAME[draft.provider]} could not be asked which efforts “${model}” offers.`
        : offered.levels.length === 0
          ? `“${model}” has no effort levels.`
          : null
  const wanted =
    model !== null && effort === undefined
      ? MODEL_CHOICE_SAID['effort-not-offered']({
          profileId: profileId ?? '',
          model,
          offered: levels.map((level) => level.id),
        })
      : null
  return { description, silence, wanted }
}

/** The provider's reported model beside the selected model, only where they differ. */
export function reportedModelSays(
  reported: ReportedModel | null,
  shown: PickedModel | null,
  providers: readonly Provider[],
): string | null {
  if (reported == null) return null
  const effortDiffers = reported.effort !== undefined && reported.effort !== shown?.effort
  if (shown !== null && sameModel(reported.model, shown.model) && !effortDiffers) return null
  const provider = shown?.provider ?? providers[0]
  if (provider === undefined) return null
  return `· ${PROVIDER_NAME[provider]} reports ${reported.model}${reported.effort === undefined ? '' : ` at ${reported.effort}`}`
}
