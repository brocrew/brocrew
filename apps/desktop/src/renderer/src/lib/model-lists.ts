import { shallowRef } from 'vue'
import type {
  EffortChoice,
  ModelList,
  Provider,
  RuntimeBridge,
  WhatAPickBecame,
} from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../../shared/runtime-ipc'
import {
  sameModel,
  theEffortLadder,
  theEffortWhenNoneIsNamed,
  theListedRow,
  type ListedModel,
  type ModelAndEffort,
} from '../../../shared/model-choice'
import type { LaunchChoices } from './launch-choices'
import { readableError } from './session-record'
import type { SessionStore } from './session-store'

/**
 * # 🔴 UI-012 · the lists the one model picker reads, and the window's one holder of them
 *
 * Use one popover picker wherever a model is chosen: launch form, conversation settings and agent sheet. `modelList` supplies the provider's models followed by models the person added.
 *
 * ⛔ **One holder for the window, keyed `provider:profile`**, so the three places read the same
 * answer and a hand-added model shows in all of them at once: hand-added models are per provider
 * and app-wide. ⚑ It is {@link createModelLists}; `composables/useModelLists.ts` binds it to the
 * window.
 *
 * ## ⚠️ A list read is a probe, and a probe is a LAUNCH
 *
 * ⚑ The host memoizes each provider's answer per home, so a GOOD list is re-read at no cost — that
 * is what {@link ModelLists.reread} does when the agents subject moves (a last pick, a default, a
 * hand-added model). ⛔ **A FAILED list is asked again only on a person's press** — the host
 * re-probes a cached failure once — and never on a roster change, which would be one child per
 * change.
 *
 * ## ⛔ No provider is named here
 *
 * Every sentence renders the provider from `PROVIDER_NAME`; nothing compares one to a literal
 * (`provider-neutrality.test.ts`).
 */

/** ⚑ **What a person picks** — a provider's model and the effort it runs at (`null`: none to name). */
export interface PickedModel {
  readonly provider: Provider
  readonly model: string
  readonly effort: string | null
}

/**
 * ⚑ **What the window holds for one list** — the read in flight, its answer, or why the read itself
 * threw (a quit's refusal, a missing person). ⚠️ An ANSWER may still say why the provider's own rows
 * are missing (`ModelList.notAsked`): that is the host's fact, and this is the window's.
 */
export type HeldList =
  | { readonly state: 'asking' }
  | { readonly state: 'answered'; readonly list: ModelList }
  | { readonly state: 'unread'; readonly why: string }

export interface ModelLists {
  /** What is held for one provider's list in one profile — `null`: nobody asked yet. */
  held(provider: Provider, profileId?: string): HeldList | null
  /**
   * Read one list. ⚑ Joins a read already out, and never re-asks a list the provider answered.
   * `once` (a screen warming up) re-asks nothing already held; without it (a person opening the
   * picker) a failed list is asked again.
   */
  read(provider: Provider, profileId?: string, options?: { readonly once?: boolean }): Promise<void>
  /**
   * ⚑ **The agents subject moved** — a last pick, a default or a hand-added model: every list the
   * provider ANSWERED is read again (the host's memo answers it with no child). ⛔ A failing one is
   * not, and a failed re-read keeps the answer it had.
   */
  reread(): Promise<void>
  /**
   * ⛔ **A credential gesture for this profile settled** (257 §2, 293 §5): every list of it goes,
   * and a read still out for the old account can no longer land.
   */
  forget(profileId: string): void
  /** ⚑ Add a model to a provider's list by hand — `null`, or the door's words. */
  add(provider: Provider, model: string): Promise<string | null>
  /** ⚑ Take a hand-added model off a provider's list — `null`, or the door's words. */
  remove(provider: Provider, model: string): Promise<string | null>
}

/** The three doors the holder reaches. */
type ListDoors = Pick<RuntimeBridge, 'modelList' | 'addHandAddedModel' | 'deleteHandAddedModel'>

/**
 * ⚑ **The holder, over a bridge it asks for only when it reads** — a thunk, so a server render that
 * draws the picker's face never reaches `window` (`useAgentStore`'s rule).
 */
export function createModelLists(bridge: () => ListDoors): ModelLists {
  const lists = shallowRef<Readonly<Record<string, HeldList>>>({})
  const asked = new Map<string, { readonly provider: Provider; readonly profileId?: string }>()
  const inFlight = new Map<string, Promise<void>>()
  /** ⛔ 293 §5 — the ticket a profile's reads are answered under; {@link ModelLists.forget} moves it. */
  const tickets = new Map<string, number>()

  const profileOf = (profileId: string | undefined): string => profileId ?? DEFAULT_PROFILE_ID
  const keyOf = (provider: Provider, profileId: string | undefined): string =>
    `${provider}:${profileOf(profileId)}`

  function put(key: string, next: HeldList): void {
    lists.value = { ...lists.value, [key]: next }
  }

  function ask(provider: Provider, profileId: string | undefined): Promise<void> {
    const key = keyOf(provider, profileId)
    const running = inFlight.get(key)
    if (running !== undefined) return running
    const profile = profileOf(profileId)
    const ticket = tickets.get(profile) ?? 0
    const ours = (): boolean => (tickets.get(profile) ?? 0) === ticket
    asked.set(key, profileId === undefined ? { provider } : { provider, profileId })
    // ⚑ An answer stays on screen while it is asked again; only nothing, or a failure, says *asking*.
    if (lists.value[key]?.state !== 'answered') put(key, { state: 'asking' })
    const read = async (): Promise<void> => {
      try {
        const list = await bridge().modelList({
          provider,
          ...(profileId === undefined ? {} : { profileId }),
        })
        if (ours()) put(key, { state: 'answered', list })
      } catch (error) {
        // ⛔ A failed re-read keeps the answer it had (`refreshProfiles`' rule).
        if (ours() && lists.value[key]?.state !== 'answered') {
          put(key, { state: 'unread', why: readableError(error) })
        }
      }
    }
    const going: Promise<void> = read().finally(() => {
      if (inFlight.get(key) === going) inFlight.delete(key)
    })
    inFlight.set(key, going)
    return going
  }

  /** ⚑ Asked again AFTER a read already out, so an answer from before a write is not the last word. */
  async function askAfresh(provider: Provider, profileId: string | undefined): Promise<void> {
    await inFlight.get(keyOf(provider, profileId))
    await ask(provider, profileId)
  }

  /** ⚑ Every held list of one provider, read again — hand-added models are per provider. */
  async function rereadProvider(provider: Provider): Promise<void> {
    await Promise.all(
      [...asked.values()]
        .filter((parts) => parts.provider === provider)
        .map((parts) => askAfresh(parts.provider, parts.profileId)),
    )
  }

  return {
    held(provider, profileId) {
      return lists.value[keyOf(provider, profileId)] ?? null
    },
    read(provider, profileId, options) {
      const key = keyOf(provider, profileId)
      const running = inFlight.get(key)
      if (running !== undefined) return running
      const now = lists.value[key]
      if (now?.state === 'answered' && now.list.notAsked === null) return Promise.resolve()
      if (options?.once === true && now !== undefined) return Promise.resolve()
      return ask(provider, profileId)
    },
    async reread() {
      await Promise.all(
        Object.entries(lists.value)
          .filter(([, held]) => held.state === 'answered' && held.list.notAsked === null)
          .flatMap(([key]) => {
            const parts = asked.get(key)
            return parts === undefined ? [] : [askAfresh(parts.provider, parts.profileId)]
          }),
      )
    },
    forget(profileId) {
      tickets.set(profileId, (tickets.get(profileId) ?? 0) + 1)
      const next = { ...lists.value }
      for (const [key, parts] of asked) {
        if (profileOf(parts.profileId) !== profileId) continue
        delete next[key]
        inFlight.delete(key)
        asked.delete(key)
      }
      lists.value = next
    },
    async add(provider, model) {
      try {
        await bridge().addHandAddedModel({ provider, model: model.trim() })
      } catch (error) {
        return readableError(error)
      }
      await rereadProvider(provider)
      return null
    },
    async remove(provider, model) {
      try {
        await bridge().deleteHandAddedModel({ provider, model })
      } catch (error) {
        return readableError(error)
      }
      await rereadProvider(provider)
      return null
    },
  }
}

/* ------------------------------------------------------------------ what the picker draws */

/**
 * ⚑ **The mark beside a model a list no longer holds** — a deleted hand-added one, a retired one, one
 * set before the list existed. ⚠️ Kept as a row, so the control never reads as another model.
 */
export const NO_LONGER_LISTED = '(no longer listed)'

/** One row of the picker — the list's own, or the current pick it does not hold (`row: null`). */
export interface PickerRow {
  /** The id sent, verbatim. */
  readonly id: string
  readonly row: ListedModel | null
}

/**
 * ⚑ **The rows a provider's section draws** — the provider's own, then the person's (`theList`'s
 * order), and the current pick as a row of its own when the list holds no row by its id.
 */
export function thePickerRows(list: ModelList | null, current: string | null): PickerRow[] {
  const rows: PickerRow[] = (list?.models ?? []).map((row) => ({ id: row.id, row }))
  return current === null || rows.some((one) => sameModel(one.id, current))
    ? rows
    : [...rows, { id: current, row: null }]
}

/**
 * ⚑ **A model id as the list spells it** — the row whose own id is the same model (`sameModel`:
 * case and surrounding spaces aside), else the id as given. ⚠️ Not an alias's target: a row is
 * matched by its own id only, so the picker checks the row a person picked.
 */
export function inTheListsSpelling(list: ModelList | null, id: string): string {
  return list?.models.find((row) => sameModel(row.id, id))?.id ?? id
}

/**
 * ⚑ **Whether a model is NOT in a list that answered** — `false` while the provider's own rows are
 * missing (`notAsked`): then nobody knows, and the mark would be a guess.
 */
export function isNoLongerListed(list: ModelList | null, id: string): boolean {
  return list !== null && list.notAsked === null && theListedRow(list.models, id) === undefined
}

/**
 * ⚑ **The efforts a model offers, as the host reads them** — known (possibly none), or UNKNOWN: a
 * model a person added while the provider's list cannot be read offers efforts nobody knows, never
 * *"none"* (`setAgentModelAndEffort`'s reading). ⚑ A model with no row offers the provider's whole
 * ladder (`model-rails.ts`).
 */
export type EffortsOffered =
  { readonly known: true; readonly levels: readonly EffortChoice[] } | { readonly known: false }

export function theEffortsOffered(list: ModelList | null, id: string): EffortsOffered {
  if (list === null) return { known: false }
  const row = theListedRow(list.models, id)
  if (row === undefined) {
    if (list.notAsked !== null) return { known: false }
    return {
      known: true,
      levels: theEffortLadder(list.models).map((level) => ({ id: level, label: level })),
    }
  }
  if (row.addedBy === 'a-person' && list.notAsked !== null) return { known: false }
  return { known: true, levels: row.efforts ?? [] }
}

/**
 * 🔴 **The effort a draft runs at — the host's own rule**, so what the panel shows is what runs:
 * the one held, where the model offers it; else the model's own default
 * (`theEffortWhenNoneIsNamed`). ⚑ `null` — none to name (the model offers none, or nobody knows
 * which). ⛔ `undefined` — the model offers efforts and nothing names one: a person picks one.
 */
export function theDraftEffort(
  list: ModelList | null,
  id: string,
  held: string | null,
): string | null | undefined {
  const offered = theEffortsOffered(list, id)
  if (!offered.known || offered.levels.length === 0) return null
  const row = list === null ? undefined : theListedRow(list.models, id)
  // ⚑ A model of no row keeps the effort it runs at, as the host keeps it (`theSettingNamed`).
  if (row === undefined) return held
  if (held !== null && offered.levels.some((level) => level.id === held)) return held
  return theEffortWhenNoneIsNamed(row, list?.models ?? [])
}

/**
 * 🔴 **R-1 · what the new-conversation form starts on — the last pick** (`09` §8: *"last one
 * picked"*), else what the host would start BroBot on. ⚑ Shown by name, like any choice.
 */
export function theFormStartsOn(list: ModelList | null): ModelAndEffort | null {
  const pair = list?.lastPicked ?? list?.startsOn ?? null
  return pair === null ? null : { model: pair.model, effort: pair.effort }
}

/**
 * 🔴 **R-1 · what the form SENDS** — a person's pick; else the last pick, only where it is not what
 * the host would start on anyway; else nothing, and the host resolves the same pair. ⚑ So a form
 * nobody touched, with no last pick, puts exactly `{provider, profileId, approvalMode}` on the wire.
 */
export function theFormSends(
  choices: LaunchChoices,
  list: ModelList | null,
): ModelAndEffort | null {
  const model = choices.model.trim()
  if (model !== '') {
    return { model, effort: choices.reasoningEffort === '' ? null : choices.reasoningEffort }
  }
  const last = list?.lastPicked ?? null
  const starts = list?.startsOn ?? null
  if (last === null) return null
  return starts !== null && sameModel(starts.model, last.model) && starts.effort === last.effort
    ? null
    : last
}

/**
 * 🔴 **A person's pick in a conversation — the model, then the effort, in that order** (`09` §7).
 *
 * Always send the model command, even when the model already runs: the person's selection updates the agent default and last pick. Then set effort only if it differs from the updated record. Sending both concurrently could reorder them while the host carries or reseeds effort.
 *
 * ⚑ A refusal is the conversation's own error line, where every conversation command's refusal goes
 * — so it stops the sequence and is not said twice.
 *
 * ⚑ **D-048 · it answers what the pick became**: the last command's own answer, for the pair as it
 * then stands — `undefined` where nothing answered.
 */
export async function pickInAConversation(
  store: Pick<SessionStore, 'get' | 'setSessionSetting'>,
  sessionId: string,
  pick: PickedModel,
): Promise<WhatAPickBecame | null | undefined> {
  const became = await store.setSessionSetting(sessionId, { kind: 'model', value: pick.model })
  const record = store.get(sessionId)
  if (record === null || record.error !== null || pick.effort === null) return became
  const settings = record.meta?.settings
  const holds =
    settings?.pendingReasoningEffort != null
      ? (settings.pendingReasoningEffort.value ?? null)
      : (settings?.reasoningEffort ?? null)
  if (holds === pick.effort) return became
  const effort = { kind: 'reasoningEffort', value: pick.effort } as const
  const then = await store.setSessionSetting(sessionId, effort)
  // ⚠️ An effort that stayed this conversation's alone does not undo a default the model already
  // made: the pair standing beyond it is still the one the model's answer named.
  if (then === undefined || (became?.itsAgentsDefault === true && then?.theLastPick !== true)) {
    return became
  }
  return then
}

/**
 * 🔴 **D-048 · what a person's pick in a conversation became**, from the host's answer — never a
 * prediction. Beyond this conversation, a pick becomes the agent's default (its new conversations
 * that name no model start on it) and the person's last pick on this provider, or it does not, and
 * the sentence says why in plain words.
 */
export function whatAPickBecameSays(became: WhatAPickBecame, provider: Provider): string {
  const name = PROVIDER_NAME[provider]
  if (became.itsAgentsDefault) {
    return `This conversation, this agent’s default for new conversations, and your last pick for ${name}.`
  }
  const lastPick = became.theLastPick ? `, and your last pick for ${name}` : ''
  switch (became.because) {
    case 'its-agent-runs-on-another-provider':
      return `This conversation${lastPick}. This agent runs on another provider, so its default stays as it is.`
    case 'it-names-no-agent':
      return `This conversation${lastPick}. No agent’s default changes.`
    case 'the-list-does-not-hold-it':
      return `This conversation only: ${name}’s list doesn’t have it.`
    case 'the-list-could-not-be-read':
      return `This conversation only: ${name}’s list couldn’t be read.`
    case 'no-model-is-named':
      return 'This conversation only.'
  }
}
