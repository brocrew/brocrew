import { refusalReason } from '../../shared/refusals'
import type { Provider } from '@brobot2/shared'
import {
  theEffortLadder,
  theEffortWhenNoneIsNamed,
  theEffortsOf,
  theListedRow,
  theListsSpelling,
  type ListedModel,
  type ModelAndEffort,
} from '../../shared/model-choice'
import { PROVIDER_NAME, type ModelList } from '../../shared/runtime-ipc'
import type { RailPermanence, RefusalRemedy } from '../../shared/refusals'

/**
 * # 🔴 D-042 · the ONE seam every agent's choice of a model passes (`09` §9–§11; R4)
 *
 * ⚑ **`give_work` and `create_agent` both ask {@link judgeAnAgentsChoice}**, in the ruling's order:
 * **the list, then the model's efforts.** Agents may pick anything in the list — the provider's own
 * models and the ones a person added by hand. ⛔ **A person's own choice in the window never passes
 * here**: their doors judge by the list alone (`judgeAgainstTheList`).
 *
 * ⚑ **Pure and synchronous**: the give reads the list before its rails and judges after them, so
 * D-016's stretch from the rails to the reservation awaits nothing (`RuntimeHost.giveWork`).
 *
 * ⚠️ **Every choice is named from what the provider answered and what a person added** — never a
 * list written here (card 5: *"naming the valid choices read from the provider itself"*).
 */
export const MODEL_RAILS = [
  /**
   * ⛔ **The model is not in the list** — the provider's own rows (an alias's target counts as the
   * alias) and the ones a person added by hand. ⚠️ **`until-a-person-changes-it`**: a model the
   * provider would take but the list lacks is one a person can add, and the sentence says so.
   */
  'model-not-in-the-list',
  /**
   * ⛔ **The model does not offer that effort** — or offers none, and one was named; or offers
   * efforts, none was named, and its provider's list names none of them its default. `permanent`.
   */
  'effort-not-offered',
  /**
   * ⚠️ **The provider could not be asked for its list, and no model a person added matches** — not
   * signed in, the program missing, a probe that timed out — ⚑ **or, for a give naming only an
   * effort, the list was read and marks no default model to run it on.** ⛔
   * **`until-a-person-changes-it`**, as `agent-did-not-start` is priced for its mixed causes: most of
   * them clear only when a person acts, and a retryable word would send an agent round a loop that
   * cannot pass (the list is asked again at the next call all the same).
   */
  'models-unavailable',
  /**
   * The provider did not answer in time when asked for its list, and no model a person added
   * matches. `while-this-holds`: nothing has to change before the same call, which asks again.
   */
  'models-not-read-in-time',
  /** ⛔ **`create_agent` named an effort with no model**: a default is a model and its effort. */
  'name-the-model-too',
  /**
   * ⚠️ **The provider the give would start on moved while its list was read** — a person changed
   * that agent's provider in that moment. ⚑ `while-this-holds`: the same give again reads the list
   * of the provider it now starts on.
   */
  'the-provider-moved-meanwhile',
] as const

export type ModelRail = (typeof MODEL_RAILS)[number]

const PERMANENCE: Readonly<Record<ModelRail, RailPermanence>> = {
  'model-not-in-the-list': 'until-a-person-changes-it',
  'effort-not-offered': 'permanent',
  'models-unavailable': 'until-a-person-changes-it',
  'models-not-read-in-time': 'while-this-holds',
  'name-the-model-too': 'permanent',
  'the-provider-moved-meanwhile': 'while-this-holds',
}

/**
 * ⚑ **425 · the act a caller may take** — only for the rails this app can retry, the same give once
 * the provider has settled or answers. ⛔ Every other rail carries none: `shared/refusals.ts`' biconditional —
 * a rail carries an act if and only if this app can retry it.
 */
const REMEDY: Readonly<Record<ModelRail, RefusalRemedy | null>> = {
  'model-not-in-the-list': null,
  'effort-not-offered': null,
  'models-unavailable': null,
  'models-not-read-in-time': 'make-the-same-call-when-this-settles',
  'name-the-model-too': null,
  'the-provider-moved-meanwhile': 'make-the-same-call-when-this-settles',
}

/** The facts a model refusal carries beside its sentence (`UnavailableContext`'s rule, 100). */
export interface ModelRefusalDetail {
  readonly door?: 'give' | 'create'
  readonly provider?: Provider
  readonly model?: string
  readonly effort?: string
  /** `model-not-in-the-list`: every model in the list, the provider's then a person's. */
  readonly choices?: readonly string[]
  /** `effort-not-offered`: what the model offers. */
  readonly efforts?: readonly string[]
  /** `models-unavailable`: why, in the probe's own word — absent when the list WAS read. */
  readonly why?: string
}

/** ⚑ The `341` shape every rail at a tool's door answers in — `ResourceRefusal`'s, field for field. */
export interface ModelRefusal {
  readonly outcome: 'refused'
  readonly rail: ModelRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  readonly remedy: RefusalRemedy | null
  readonly detail: ModelRefusalDetail
}

const listed = (values: readonly string[] | undefined): string =>
  values === undefined || values.length === 0 ? 'none' : values.map((one) => `“${one}”`).join(', ')

/**
 * ⚑ **What each refusal says** — one sentence, the act first, then what was not done. ⛔ Every
 * provider name is rendered from `PROVIDER_NAME`; every choice is one the detail carries.
 */
function describeModelRail(rail: ModelRail, detail: ModelRefusalDetail): string {
  const on = detail.provider === undefined ? 'the provider' : PROVIDER_NAME[detail.provider]
  const model = `“${detail.model ?? '?'}”`
  const nothing =
    detail.door === 'create'
      ? 'no agent was made'
      : detail.door === 'give'
        ? 'nothing was given'
        : 'nothing was done'
  switch (rail) {
    case 'model-not-in-the-list':
      return (
        `Pick a model from ${on}’s list: ${listed(detail.choices)}. ${model} is not in it, so ` +
        `${nothing}; a person can add a model to the list by hand.`
      )
    case 'effort-not-offered':
      // ⚑ Three causes, each said as it is: none offered, the one named not offered — or none named
      // and the list names none of them its default.
      if ((detail.efforts ?? []).length === 0) {
        return `Leave effort out: ${model} offers no effort levels, so ${nothing}.`
      }
      return detail.effort === undefined
        ? `Pick an effort ${model} offers: ${listed(detail.efforts)}. None of them is its ` +
            `default in ${on}’s list, so ${nothing}.`
        : `Pick an effort ${model} offers: ${listed(detail.efforts)}. It does not offer ` +
            `“${detail.effort}”, so ${nothing}.`
    case 'models-unavailable':
      // ⚑ Three causes, each said as it is: the list could not be read, for a model or for an
      // effort named alone — or it was read and marks no default model for that effort.
      if (detail.model !== undefined) {
        return (
          `Ask a person to check ${on}: it could not be asked which models it offers` +
          `${detail.why === undefined ? '' : ` (${detail.why})`}, so ${model} could not be checked ` +
          `and ${nothing}.`
        )
      }
      return detail.why === undefined
        ? `Name a model too: ${on}’s list marks no default model to run the effort ` +
            `“${detail.effort ?? '?'}” on, so ${nothing}.`
        : `Ask a person to check ${on}: it could not be asked which models it offers ` +
            `(${detail.why}), so no model was found to run the effort “${detail.effort ?? '?'}” on, ` +
            `and ${nothing}.`
    case 'models-not-read-in-time': {
      const again = detail.door === 'create' ? 'Make the agent again' : 'Give again'
      const unchecked =
        detail.model === undefined
          ? `no model was found to run the effort “${detail.effort ?? '?'}” on`
          : `${model} could not be checked`
      return (
        `${again} in a moment: ${on} did not answer in time when asked which models it offers, so ` +
        `${unchecked} and ${nothing}. Nobody has to change anything first.`
      )
    }
    case 'name-the-model-too':
      return `Name the model too: a default is a model and the effort it runs at, so ${nothing}.`
    case 'the-provider-moved-meanwhile':
      return (
        `Give again: that agent’s conversations now start on ${on}, which changed while this was ` +
        `being checked, so ${nothing}.`
      )
  }
}

/** ⛔ `retryable` is DERIVED from `permanence` through one table, so the two cannot disagree. */
export function refuseModel(rail: ModelRail, detail: ModelRefusalDetail = {}): ModelRefusal {
  const permanence = PERMANENCE[rail]
  return {
    outcome: 'refused',
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(describeModelRail(rail, detail)),
    remedy: REMEDY[rail],
    detail,
  }
}

/** Each provider's list as this app last read it, with a person's models; a provider not read yet is absent. */
export type ListsAsLastRead = Partial<Record<Provider, readonly ListedModel[]>>

/** How many of one provider's models a tool's description names before it leaves the rest to a refusal. */
export const MODELS_A_DESCRIPTION_NAMES = 8

/**
 * The models a description names for one provider: the whole list when it is short, else the
 * provider's own models up to {@link MODELS_A_DESCRIPTION_NAMES}, and how many it leaves out.
 */
function theModelsNamed(rows: readonly ListedModel[]): {
  readonly named: readonly ListedModel[]
  readonly left: number
} {
  if (rows.length <= MODELS_A_DESCRIPTION_NAMES) return { named: rows, left: 0 }
  const named = rows
    .filter((row) => row.addedBy === 'the-provider')
    .slice(0, MODELS_A_DESCRIPTION_NAMES)
  return { named, left: rows.length - named.length }
}

const theListsIn = (lists: ListsAsLastRead): (readonly [Provider, readonly ListedModel[]])[] =>
  (Object.keys(PROVIDER_NAME) as Provider[]).flatMap((provider) => {
    const rows = lists[provider]
    return rows === undefined ? [] : [[provider, rows] as const]
  })

/**
 * The words a `model` field's description ends with: the models in each provider's list, as the
 * refusal of a model outside it names them. Empty when no list has been read.
 */
export function theModelsSaid(lists: ListsAsLastRead): string {
  const read = theListsIn(lists)
  if (read.length === 0) return ''
  let anyLeft = false
  const said = read.map(([provider, rows]) => {
    const { named, left } = theModelsNamed(rows)
    anyLeft ||= left > 0
    const ids = named.length === 0 ? 'none' : named.map((row) => row.id).join(', ')
    return `${PROVIDER_NAME[provider]}: ${ids}${left === 0 ? '' : `, and ${String(left)} more`}`
  })
  return (
    ` Models to choose from, as last read — ${said.join(' · ')}` +
    (anyLeft ? '; a model outside its list is refused with the whole list.' : '.')
  )
}

/**
 * The words an `effort` field's description ends with: the efforts each model named by
 * {@link theModelsSaid} offers, models that offer the same ones said together. Empty when no list
 * has been read.
 */
export function theEffortsSaid(lists: ListsAsLastRead): string {
  const read = theListsIn(lists)
  if (read.length === 0) return ''
  const said = read.map(([provider, rows]) => {
    const { named, left } = theModelsNamed(rows)
    const groups = new Map<string, string[]>()
    for (const row of named) {
      const efforts = theEffortsOf(row)
      const offered = efforts.length === 0 ? 'none' : efforts.join(', ')
      groups.set(offered, [...(groups.get(offered) ?? []), row.id])
    }
    const each = [...groups].map(([offered, ids]) =>
      groups.size === 1 && left === 0 ? offered : `${offered} for ${ids.join(', ')}`,
    )
    return `${PROVIDER_NAME[provider]}: ${each.length === 0 ? 'none' : each.join('; ')}`
  })
  return ` Efforts each model offers, as last read — ${said.join(' · ')}.`
}

/** ⚑ **The list as the seam reads it** — its rows, and why the provider's own are missing. */
export interface TheListAsked {
  readonly rows: readonly ListedModel[]
  readonly notAsked: ModelList['notAsked']
}

/** ⚑ **Why the provider's rows are missing, in a word** — the probe's own, for the sentence. */
function whyNotAsked(notAsked: ModelList['notAsked']): string | undefined {
  if (notAsked === null) return undefined
  return notAsked.reason === 'refused' ? notAsked.detail : notAsked.reason
}

/**
 * 🔴 **D-042 · R4 — an agent's choice, judged: the list, then the model's efforts.**
 *
 *  1. **The model.** A named one must be a row of the list ({@link theListedRow}: its id, or what an
 *     alias points at). ⚑ Unnamed, it is `otherwise`'s — the conversation's own, or what it would
 *     start on.
 *  2. **The efforts** — a named effort must be one the row offers. Unnamed: the effort it runs at
 *     now when the row offers it, else the model's own default ({@link theEffortWhenNoneIsNamed}:
 *     the row's, else the provider's default row's where the row offers it), else none (a row that
 *     offers none). ⛔ A row that offers efforts with none of them named is refused: never an
 *     unnamed default.
 *
 * ⚑ A model of no row — a conversation running on a model the list no longer holds — offers the
 * provider's whole ladder, as a model a person added does.
 */
export function judgeAnAgentsChoice(
  asked: { readonly model?: string; readonly effort?: string },
  provider: Provider,
  list: TheListAsked,
  /** What it would run without this choice — the conversation's own pair, or what it starts on. */
  otherwise: ModelAndEffort | null,
  door: 'give' | 'create',
):
  | { readonly ok: true; readonly chosen: ModelAndEffort }
  | { readonly ok: false; readonly refusal: ModelRefusal } {
  const no = (rail: ModelRail, detail: Omit<ModelRefusalDetail, 'door' | 'provider'> = {}) =>
    ({ ok: false, refusal: refuseModel(rail, { door, provider, ...detail }) }) as const
  if (asked.model === undefined && asked.effort !== undefined && door === 'create') {
    return no('name-the-model-too')
  }
  const ladder = theEffortLadder(list.rows)
  const why = whyNotAsked(list.notAsked)
  // A list the provider was only too slow to give is asked again by the same call.
  const unread: ModelRail =
    list.notAsked?.reason === 'refused' && list.notAsked.tooSlow === true
      ? 'models-not-read-in-time'
      : 'models-unavailable'
  // 1 · the model.
  const model = asked.model ?? otherwise?.model
  if (model === undefined) {
    return no(unread, {
      ...(asked.effort === undefined ? {} : { effort: asked.effort }),
      ...(why === undefined ? {} : { why }),
    })
  }
  const row = theListedRow(list.rows, model)
  if (asked.model !== undefined && row === undefined) {
    return list.notAsked === null
      ? no('model-not-in-the-list', { model, choices: list.rows.map((one) => one.id) })
      : no(unread, { model, ...(why === undefined ? {} : { why }) })
  }
  const efforts = row === undefined ? ladder : theEffortsOf(row)
  // ⚑ The effort it would run at: the one named, else the one it runs at now when this model offers
  // it, else the model's own default. ⛔ A model that offers efforts, none of them named its
  // default, is refused: the agent names one.
  const carried =
    otherwise !== null && otherwise.effort !== null && efforts.includes(otherwise.effort)
      ? otherwise.effort
      : null
  const effort = asked.effort ?? carried ?? theEffortWhenNoneIsNamed(row, list.rows)
  if (effort === undefined) return no('effort-not-offered', { model, efforts })
  // 2 · the model's efforts. ⚠️ A list that could not be read leaves a model a person added with no
  // efforts at all — *"not known"*, never *"offers none"*: neither a named effort nor a missing one
  // can be judged, so both are refused as the list's absence. ⚑ Only the provider's own row says a
  // model offers none.
  const unknowable =
    efforts.length === 0 && list.notAsked !== null && row?.addedBy !== 'the-provider'
  if (asked.effort !== undefined && !efforts.includes(asked.effort)) {
    return unknowable
      ? no(unread, { model, ...(why === undefined ? {} : { why }) })
      : no('effort-not-offered', { model, effort: asked.effort, efforts })
  }
  if (effort === null && unknowable) {
    return no(unread, { model, ...(why === undefined ? {} : { why }) })
  }
  // ⚑ A model the list holds is chosen as the list spells it, however it was named.
  return {
    ok: true,
    chosen: { model: row === undefined ? model : theListsSpelling(row, model), effort },
  }
}
