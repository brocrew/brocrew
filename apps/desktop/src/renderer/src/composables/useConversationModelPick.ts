import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type {
  CreatedSession,
  ProviderCapabilityMap,
  WhatAPickBecame,
} from '../../../shared/runtime-ipc'
import { whatAPickBecameSays, type PickedModel } from '../lib/model-lists'

/**
 * A conversation's model and effort, chosen in the one model picker: what the picker shows, what
 * its draft starts on, what its Take does and what the last pick became. The agent panel's model
 * and effort mount the picker with these.
 */
export interface ConversationModelPickSources {
  readonly session: () => CreatedSession | null
  /** The screen's pick, carried out for this conversation; absent, nothing here can change it. */
  readonly pickModel: () =>
    ((pick: PickedModel) => Promise<WhatAPickBecame | null | undefined>) | undefined
  /** Nothing set here would reach the conversation (`CreatedSession.settingsFixed`). */
  readonly fixed: () => boolean
  readonly capabilities: () => ProviderCapabilityMap | null
}

/** The bindings `ModelPicker` takes for a conversation. */
export interface ConversationPickerProps {
  readonly providers: readonly CreatedSession['provider'][]
  readonly profileId: string | undefined
  readonly shown: PickedModel | null
  readonly drafted: PickedModel | null
  readonly empty: string
  readonly reported: CreatedSession['settings']['reported'] | null
  readonly fixed: boolean
  readonly takeWords: string
  readonly take: (pick: PickedModel) => Promise<string | null>
  readonly capabilities: ProviderCapabilityMap | null
}

export interface ConversationModelPick {
  /** `null` with no conversation. */
  readonly picker: ComputedRef<ConversationPickerProps | null>
  /** Whether a pick here can reach the conversation. */
  readonly changeable: ComputedRef<boolean>
  /** What the last pick became, as the host answered it — until another pick or conversation. */
  readonly became: Ref<string | null>
}

export function useConversationModelPick(
  sources: ConversationModelPickSources,
): ConversationModelPick {
  const became = ref<string | null>(null)
  // Which press is the latest, so a slow answer to an earlier one draws nothing.
  let presses = 0

  watch(
    () => sources.session()?.sessionId,
    () => {
      became.value = null
    },
  )

  const changeable = computed(
    () => sources.session() !== null && !sources.fixed() && sources.pickModel() !== undefined,
  )

  // The picker's Take. A refusal is the conversation's own line, so Take itself refuses nothing.
  async function take(pick: PickedModel): Promise<string | null> {
    const session = sources.session()
    if (session === null) return null
    became.value = null
    const asked = session.sessionId
    const press = ++presses
    const answer = await sources.pickModel()?.(pick)
    if (press === presses && asked === sources.session()?.sessionId && answer) {
      became.value = whatAPickBecameSays(answer, session.provider)
    }
    return null
  }

  const picker = computed<ConversationPickerProps | null>(() => {
    const session = sources.session()
    if (session === null) return null
    const settings = session.settings
    // The face shows the pair the conversation RUNS; the queued pair has its own words.
    const shown: PickedModel | null =
      settings.model === null
        ? null
        : { provider: session.provider, model: settings.model, effort: settings.reasoningEffort }
    // The draft starts on the queued pair, where one is: Take re-sends the model, so a draft
    // started on the running pair would undo a switch already queued. A queued provider default
    // has no name to draft, so the running model stands in for it.
    const { pendingModel, pendingReasoningEffort } = settings
    const queuedModel =
      pendingModel === null && pendingReasoningEffort === null
        ? null
        : (pendingModel?.value ?? settings.model)
    const drafted: PickedModel | null =
      queuedModel === null
        ? null
        : {
            provider: session.provider,
            model: queuedModel,
            effort:
              pendingReasoningEffort === null
                ? settings.reasoningEffort
                : (pendingReasoningEffort.value ?? null),
          }
    return {
      providers: [session.provider],
      profileId: session.profileId,
      shown,
      drafted,
      empty: 'Not named yet',
      reported: settings.reported ?? null,
      fixed: !changeable.value,
      takeWords: 'Switch from your next message',
      take,
      capabilities: sources.capabilities(),
    }
  })

  return { picker, changeable, became }
}
