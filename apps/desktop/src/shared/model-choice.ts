import type { AgentModelChoice, ListedModel, ModelAndEffort, ModelChoiceRail, ModelChoiceRefusalDetail, ModelChoiceSaved } from './model-choice-contracts'
import type { Provider } from '@brobot2/shared'
import type { ModelChoice } from '@brobot2/runtime'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME } from './runtime-ipc'

/**
 * ⚑ **682 · whose home a list is read in for an agent with no folder of its own** — the product's
 * own identity, whose home the app may always open. ⛔ Asking in the agent's own home would create
 * its folder, and only a launch does that. ⚠️ Its login is the machine's as BroBot's home holds it.
 */
export const STAND_IN_PROFILE: string = DEFAULT_PROFILE_ID

/**
 * 🔴 **682 · is an agent's default IN FORCE for an identity whose own provider is `itsProvider`?**
 * (`R31b`: *"the choice is always for the identity's own provider"*).
 *
 * ⚑ **Yes when it names that provider, or when the identity has no provider of its own** — then the
 * default is what holds the provider of its new conversations (`R31a`). ⛔ **No when the two name
 * different providers**, and a default not in force is read by nothing: a new conversation resolves
 * as though it had none. ⚠️ It stays stored — it is a person's, and a person clears it.
 */
export function aChoiceIsInForce(choice: AgentModelChoice, itsProvider: Provider | null): boolean {
  return itsProvider === null || choice.provider === itsProvider
}

/**
 * ⚑ **D-042 · the provider's effort ladder** — every level any of its rows offers, in the
 * provider's own order: each row's list is merged in, a level it adds placed after the one before it
 * in that row. ⚑ What a hand-added model offers ({@link theList}), and a model the list no longer
 * holds (`main/runtime/model-rails.ts`).
 */
export function theEffortLadder(rows: readonly ModelChoice[]): readonly string[] {
  const ladder: string[] = []
  for (const row of rows) {
    let after = -1
    for (const { id } of row.efforts ?? []) {
      const at = ladder.indexOf(id)
      if (at === -1) {
        ladder.splice(after + 1, 0, id)
        after += 1
      } else {
        after = at
      }
    }
  }
  return ladder
}

/**
 * 🔴 **D-042 · R3 — the list: the provider's rows, then each model a person added by hand** that no
 * provider row lists (by its id or what it points at).
 *
 * ⚑ **A hand-added model is never checked** (R3: no test call, nothing spent), so it offers the
 * provider's whole {@link theEffortLadder}, at the provider's default row's own default effort. ⚠️ A
 * provider that refuses it says so in its own words at the call that names it (D-039).
 */
export function theList(
  rows: readonly ModelChoice[],
  handAdded: readonly string[],
): readonly ListedModel[] {
  const ladder = theEffortLadder(rows)
  const itsDefault = rows.find((row) => row.isDefault === true)?.defaultEffort
  const theirs = rows.map((row): ListedModel => ({ ...row, addedBy: 'the-provider' }))
  const added = handAdded
    .filter((id) => theListedRow(rows, id) === undefined)
    .map((id): ListedModel => ({
      id,
      label: id,
      ...(ladder.length === 0 ? {} : { efforts: ladder.map((one) => ({ id: one, label: one })) }),
      ...(itsDefault !== undefined && ladder.includes(itsDefault)
        ? { defaultEffort: itsDefault }
        : {}),
      addedBy: 'a-person',
    }))
  return [...theirs, ...added]
}

/**
 * ⚑ **Whether two model ids name the same model, as a person types one** — letter case, and spaces
 * around the id, are no part of a model's name: Claude took `claude-opus-5-5[1M]` and reports it as
 * `claude-opus-5-5[1m]`, and every provider's own ids are lower case.
 */
export function sameModel(one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase()
}

/**
 * ⚑ **The row a model id names** — its own id first, else the alias row that points at it (Claude's
 * `opus` for `claude-opus-5-5`), each as {@link sameModel} reads them. ⚠️ What is stored and sent
 * is the list's own spelling ({@link theListsSpelling}).
 */
export function theListedRow<Row extends ModelChoice>(
  list: readonly Row[],
  id: string,
): Row | undefined {
  return (
    list.find((row) => sameModel(row.id, id)) ??
    list.find((row) => row.resolvesTo !== undefined && sameModel(row.resolvesTo, id))
  )
}

/**
 * ⚑ **The list's own spelling of a model id one of its rows names** ({@link theListedRow}): the row's
 * id, or — named as what an alias points at — that model's id as the row spells it.
 */
export function theListsSpelling(row: ModelChoice, named: string): string {
  return sameModel(row.id, named) ? row.id : (row.resolvesTo ?? row.id)
}

/**
 * ⚑ **The effort levels a row offers**, exactly. ⚠️ A row the provider left undescribed offers NONE:
 * *"the provider did not say"* is not *"it takes anything"*.
 */
export function theEffortsOf(row: ModelChoice | undefined): readonly string[] {
  return (row?.efforts ?? []).map((one) => one.id)
}

/**
 * ⚑ **The default effort a row names for itself** — `null` when it names none, as a row that offers
 * no effort never does. ⚠️ Not what a model named alone runs at: that is
 * {@link theEffortWhenNoneIsNamed}, which reads the provider's default row too.
 */
export function theDefaultEffortOf(row: ModelChoice | undefined): string | null {
  return theEffortsOf(row).length === 0 ? null : (row?.defaultEffort ?? null)
}

/**
 * 🔴 **D-042 · R1 — the effort a model runs at when none is named**: its row's own default
 * ({@link theDefaultEffortOf}); else the provider's default row's own default effort, where this
 * row offers it. ⚑ **`null` only for a row that offers no effort**: there is none to name. ⛔
 * **`undefined` when the row offers efforts and nothing names one of them** — a Claude row without
 * `medium`, a Codex row without `defaultReasoningEffort`: a caller refuses rather than send an
 * unnamed default (D-042 F2).
 */
export function theEffortWhenNoneIsNamed(
  row: ModelChoice | undefined,
  list: readonly ModelChoice[],
): string | null | undefined {
  const efforts = theEffortsOf(row)
  if (efforts.length === 0) return null
  const theProviders = list.find((one) => one.isDefault === true)?.defaultEffort
  return (
    theDefaultEffortOf(row) ??
    (theProviders !== undefined && efforts.includes(theProviders) ? theProviders : undefined)
  )
}

/**
 * ⚑ **The list's verdict on a pair** — `null` when the list admits it: the model is a row of it, and
 * the effort one that row offers (`null` only for a row that offers none).
 */
export function judgeAgainstTheList(
  list: readonly ModelChoice[],
  choice: ModelAndEffort,
): 'model-not-offered' | 'effort-not-offered' | null {
  const row = theListedRow(list, choice.model)
  if (row === undefined) return 'model-not-offered'
  const efforts = theEffortsOf(row)
  if (choice.effort === null ? efforts.length > 0 : !efforts.includes(choice.effort)) {
    return 'effort-not-offered'
  }
  return null
}

const quoted = (values: readonly string[]): string => values.map((one) => `“${one}”`).join(', ')

/**
 * ⚑ **What each refusal SAYS to the person who pressed Save** — one sentence, the act first.
 *
 * ⛔ **Every provider name is rendered from `PROVIDER_NAME`**, never typed — the neutrality census's
 * rule (`provider-neutrality.test.ts`).
 */
export const MODEL_CHOICE_SAID: Readonly<
  Record<ModelChoiceRail, (detail: ModelChoiceRefusalDetail) => string>
> = {
  'no-such-agent': (detail) =>
    `There is no agent called “${detail.profileId}”, so there is nothing to choose a model for.`,
  'not-its-provider': (detail) =>
    `Choose a ${detail.itsProvider === undefined ? 'model on its own provider' : `${PROVIDER_NAME[detail.itsProvider]} model`}: ` +
    `${detail.named ?? `“${detail.profileId}”`} runs on ${detail.itsProvider === undefined ? 'another provider' : PROVIDER_NAME[detail.itsProvider]}, ` +
    `and a choice is always for its own provider — change its provider first to choose for ` +
    `${detail.provider === undefined ? 'another' : PROVIDER_NAME[detail.provider]}. Nothing was saved.`,
  'models-unavailable': (detail) =>
    `Nothing was saved: ${detail.provider === undefined ? 'the provider' : PROVIDER_NAME[detail.provider]} ` +
    `could not be asked which models it offers${detail.why === undefined ? '' : ` — ${detail.why}`}.`,
  'model-not-offered': (detail) =>
    `Pick a model from the list: “${detail.model ?? '?'}” is not in ` +
    `${detail.provider === undefined ? 'the provider' : PROVIDER_NAME[detail.provider]}’s list, nor one you added.`,
  'effort-not-offered': (detail) =>
    (detail.offered ?? []).length === 0
      ? `Leave the effort out: “${detail.model ?? '?'}” offers no effort level.`
      : `Pick an effort “${detail.model ?? '?'}” offers: ${quoted(detail.offered ?? [])}.` +
        (detail.effort === undefined ? '' : ` It does not offer “${detail.effort}”.`),
}

/**
 * ⚑ **The refusal, whole** — the one constructor, so the rail, the detail and the sentence cannot
 * be built apart.
 */
export function refuseModelChoice(
  rail: ModelChoiceRail,
  detail: ModelChoiceRefusalDetail,
): ModelChoiceSaved {
  return { ok: false, rail, reason: MODEL_CHOICE_SAID[rail](detail), detail }
}

/**
 * 🔴 **What an agent's default REACHES, said beside the control** (R2; standing rule 8.2: render it
 * from the thing rather than assert it about the thing).
 *
 * ⛔ **The scopes it must not overstate**: it is what the agent's NEW conversations start on —
 * whoever starts them — while a conversation already open keeps its own until it is changed there,
 * and an agent giving work may name another pair for its one conversation with this agent (R4).
 * ⚑ It names the provider it holds (`R31a`). ⛔ **It describes a default IN FORCE**
 * ({@link aChoiceIsInForce}); a surface draws it only for one.
 */
export function whatAModelChoiceReaches(choice: AgentModelChoice): string {
  return (
    `Its new conversations start on this, on ${PROVIDER_NAME[choice.provider]} — the ones you start ` +
    'and the ones another agent starts for it. A conversation already open keeps its own until it ' +
    'is changed there, and an agent that gives it work may name another for that one conversation.'
  )
}

/**
 * ⚑ **682 · a choice in words** — `“gpt-5.6-terra” at high effort on Codex`, or `“haiku” on Claude`
 * for a model that offers no effort. ⛔ Rendered from the choice, so no sentence can name a half the
 * choice does not hold.
 */
export function aChoiceInWords(choice: AgentModelChoice): string {
  return `${aPairInWords(choice)} on ${PROVIDER_NAME[choice.provider]}`
}

/** ⚑ **D-042 · a pair in words** — `“opus” at max effort`, or `“haiku”` for a model with none. */
export function aPairInWords(pair: ModelAndEffort): string {
  return `“${pair.model}”${pair.effort === null ? '' : ` at ${pair.effort} effort`}`
}
