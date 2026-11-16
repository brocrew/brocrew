import type { ProviderConnection } from '@brobot2/shared'
import type {
  Provider,
  ProviderCapabilityMap,
  CapabilityStatus,
  ProviderProgram,
} from '../../../shared/runtime-ipc'
import type { ModelList, ReportedModel } from '../../../shared/model-choice-contracts'
import { MODEL_CHOICE_SAID, sameModel, theListedRow } from '../../../shared/model-choice'
import { modelField } from './model-field'
import {
  inTheListsSpelling,
  isNoLongerListed,
  NO_LONGER_LISTED,
  thePickerRows,
  theEffortsOffered,
  type ModelLists,
  type PickedModel,
} from './model-lists'

export interface ModelPickerProps {
  providers: readonly Provider[]
  /** Fresh-conversation and default editors may choose a connection; model-only hosts do not. */
  chooseConnection?: boolean
  recordedConnection?: boolean
  connectionName?: string
  /** Stored read route, including conversations with no selected model. */
  connectionId?: string
  readiness?: Readonly<Partial<Record<Provider, boolean | null>>> | null
  programs?: Readonly<Partial<Record<Provider, ProviderProgram>>> | null
  setUp?: (provider: Provider) => void
  profileId?: string
  shown: PickedModel | null
  drafted?: PickedModel | null
  empty?: string
  reported?: ReportedModel | null
  takeWords: string
  /** Commits the draft: answers the door's refusal, verbatim, or `null`. */
  take: (pick: PickedModel) => Promise<string | null>
  reaches?: ((pick: PickedModel, list: ModelList | null) => string | null) | undefined
  note?: string | null
  fixed?: boolean
  readOnly?: boolean
  /** Faceless hosts supply opener buttons that name this panel and receive focus back. */
  faceless?: boolean
  capabilities?: ProviderCapabilityMap | null
  lists?: ModelLists
}

export const modelPickerDefaults = {
  profileId: undefined,
  chooseConnection: false,
  recordedConnection: false,
  connectionName: undefined,
  connectionId: undefined,
  readiness: null,
  programs: null,
  setUp: undefined,
  empty: 'Nothing chosen',
  reported: null,
  drafted: null,
  reaches: undefined,
  note: null,
  fixed: false,
  readOnly: false,
  faceless: false,
  capabilities: null,
  lists: undefined,
}

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
  suppliedName: string | undefined,
  selectedConnectionId?: string,
  readConnectionId?: string,
) {
  const held = lists.held(provider, profileId, readConnectionId)
  const list = held?.state === 'answered' ? held.list : null
  const name = suppliedName ?? 'This provider'
  const connections =
    (lists.choices(provider, profileId, readConnectionId) ?? lists.choices(provider, profileId))
      ?.connections ?? []
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
    connections,
    selectable:
      (readConnectionId === undefined || held?.state === 'answered') &&
      (ready === true || connections.some((row) => row.id === selectedConnectionId)),
    name,
    readyWords: ready === false ? ' · Not set up' : ready !== true ? ' · Checking…' : ' · Ready',
    list,
    field,
    rows: thePickerRows(list, current).map((one) => ({
      ...one,
      mark: one.row === null && isNoLongerListed(list, one.id) ? NO_LONGER_LISTED : null,
    })),
  }
}

export function modelPickerWords(providerName: (provider: Provider) => string | undefined) {
  function face(
    world: {
      readonly shown: PickedModel | null
      readonly chooseConnection?: boolean
      readonly recordedConnection?: boolean
      readonly connectionName?: string
      readonly connectionId?: string
      readonly providers: readonly Provider[]
      readonly reported: ReportedModel | null
      readonly empty: string
    },
    listOf: (provider: Provider) => ModelList | null,
    lists?: ModelLists,
    profileId?: string,
  ): string {
    const shown = world.shown
    if (shown === null) return world.empty
    const name = providerName(shown.provider)
    const legacy = lists?.choices(shown.provider, profileId)
    const id =
      world.connectionId ??
      shown.connectionId ??
      (world.chooseConnection && !world.recordedConnection
        ? legacy?.defaultConnectionId
        : undefined)
    const choices = lists?.choices(shown.provider, profileId, id) ?? legacy
    const connection = choices?.connections?.find((row) => row.id === id)
    const connectionName = world.connectionName ?? connection?.name
    const who =
      connectionName !== undefined
        ? `${name ?? 'Provider'} · ${connectionName} · `
        : world.providers.length > 1 && name !== undefined
          ? `${name} · `
          : ''
    const selected = inTheListsSpelling(listOf(shown.provider), shown.model)
    const row = theListedRow(listOf(shown.provider)?.models ?? [], selected)
    const model =
      world.recordedConnection && row?.resolvesTo ? `${selected} → ${row.resolvesTo}` : selected
    const pair = shown.effort === null ? model : `${model} · ${shown.effort}`
    const said = reported(world.reported, shown, world.providers)
    return `${who}${pair}${said === null ? '' : ' (selected)'}`
  }

  function effort(
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
          ? `${providerName(draft.provider) ?? 'This provider'} could not be asked which efforts “${model}” offers.`
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
  function reported(
    reported: ReportedModel | null,
    shown: PickedModel | null,
    providers: readonly Provider[],
  ): string | null {
    if (reported == null) return null
    const effortDiffers = reported.effort !== undefined && reported.effort !== shown?.effort
    if (shown !== null && sameModel(reported.model, shown.model) && !effortDiffers) return null
    const provider = shown?.provider ?? providers[0]
    if (provider === undefined) return null
    return `· ${providerName(provider) ?? 'This provider'} reports ${reported.model}${reported.effort === undefined ? '' : ` at ${reported.effort}`}`
  }

  function connection(
    provider: Provider | undefined,
    id: string | undefined,
    rows: readonly ProviderConnection[],
    name?: string,
  ) {
    const row = rows.find((row) => row.provider === provider && row.id === id)
    return `${provider === undefined ? 'Provider' : (providerName(provider) ?? provider)} · ${name ?? row?.name ?? id ?? 'Connection not recorded'}`
  }

  function unlistedConnection(
    world: Pick<ModelPickerProps, 'recordedConnection' | 'providers' | 'connectionName'>,
    sections: readonly Pick<ReturnType<typeof modelPickerSection>, 'connections'>[],
    selected?: string,
  ): string | null {
    return !world.recordedConnection ||
      sections.some((section) => section.connections.some((row) => row.id === selected))
      ? null
      : connection(world.providers[0], selected, [], world.connectionName)
  }
  return { face, effort, reported, connection, unlistedConnection }
}

/** The existing picker face and provider report, used by the conversation's custom opener. */
export function conversationModelFace(
  picker: {
    readonly faceWords: string
    readonly reportedSays: string | null
    readonly panelId: string
    readonly isOpen: boolean
  } | null,
  connectionId: string | undefined,
  model: string | null | undefined,
  canChange: boolean,
  canOpen: boolean,
) {
  const text = picker && (connectionId || model === 'default') ? picker.faceWords : model
  const title = [text ? `Model: ${text}` : 'No model named yet', picker?.reportedSays]
    .filter(Boolean)
    .join(' ')
  const attributes = canOpen
    ? {
        type: 'button' as const,
        popovertarget: picker?.panelId,
        'aria-haspopup': 'dialog' as const,
        'aria-expanded': picker?.isOpen ?? false,
        'aria-label': text
          ? `${canChange ? 'Change' : 'View'} model, now ${text}`
          : canChange
            ? 'Choose a model'
            : 'View models',
      }
    : {}
  return { text, title, attributes }
}
