import type { ModelChoice } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

/**
 * # 🔴 D-042 · every call names its model and effort, and agents choose their helpers'
 *
 * Choose models and reasoning effort consistently across picker surfaces:
 *
 *  - **R1 · every call names its model and effort.** Every conversation holds a selected pair on its
 *    row, and every start, wake and turn names it. Where it comes from, in this order: what a give or
 *    a person named for that conversation; else its agent's default; else the last pair the person
 *    picked on that provider; else the provider's own default, BY NAME — one entry in the list,
 *    never an absence.
 *  - **R2 · defaults.** A person's change to a conversation's model or effort, or to an agent's
 *    sheet, becomes that agent's default ({@link AgentModelChoice}); its other open conversations
 *    keep their own. ⛔ A give never changes a default; `create_agent` may set the new agent's.
 *  - **R3 · the list, one door**: the provider's own models (with what an alias points at, and each
 *    model's efforts), then the models a person added by hand ({@link theList}).
 *  - **R4 · agents choose** anything in that list — the person's hand-added ones included. ⚑ The
 *    agents' seam is `main/runtime/model-rails.ts`; ⛔ a person's own choice in the window never
 *    passes it.
 *
 * ## ⚑ Validated against what the PROVIDER answered, never a list written here
 *
 * ⛔ **There is no model id and no effort level anywhere in this file.** Every verdict reads the
 * catalogue the provider answered (`ModelChoice.efforts`, `.resolvesTo`, `.isDefault`) and the
 * person's own additions.
 *
 * ⚠️ **Here, in `shared/`, so the control a person will press can ask the same question before the
 * press that main asks after it** — `485`'s rule for a grant's words applied to a choice. It takes
 * no value from `@brobot2/shared` (`a-value-import-from-shared-costs-the-renderer-135kb`).
 */

/**
 * ⚑ **A model and the effort it runs at** — `effort` is `null` only for a model whose list row
 * offers no effort level (Claude's `haiku`, measured): there is nothing to name.
 */
export interface ModelAndEffort {
  readonly model: string
  readonly effort: string | null
}

/**
 * 🔴 **An agent's default — a pair FOR a provider** (R2; `agent_identity.model_choice`).
 *
 * ⚑ **The provider is part of it**, because a model name belongs to a provider: a Claude model is
 * never sent to Codex ({@link aChoiceIsInForce}).
 */
export interface AgentModelChoice extends ModelAndEffort {
  readonly provider: Provider
}

/** ⚑ **D-042 · R1 — where a conversation's selected pair came from**, in the ruling's order. */
export type WhereItCameFrom = 'named' | 'its-default' | 'the-last-pick' | 'the-providers-default'

/** ⚑ **D-042 · a conversation's selected pair, and where it came from.** */
export interface SelectedModel extends ModelAndEffort {
  readonly from: WhereItCameFrom
}

/**
 * ⚑ **One row of the list** — the provider's own, or one a person added by hand (R3). ⚠️ Only a
 * person's can be deleted: the provider's come back at its next answer.
 */
export interface ListedModel extends ModelChoice {
  readonly addedBy: 'the-provider' | 'a-person'
}

export type ModelChoiceRail = (typeof MODEL_CHOICE_RAILS)[number]

/** The facts a refusal may carry, as data beside the sentence (`UnavailableContext`'s rule, 100). */
export interface ModelChoiceRefusalDetail {
  readonly profileId: string
  readonly provider?: Provider
  readonly model?: string
  readonly effort?: string
  /** `models-unavailable`'s own reason, in the provider's words. */
  readonly why?: string
  /** `effort-not-offered`: what the model's row DOES offer, so a person can pick one of them. */
  readonly offered?: readonly string[]
  /** 682 · `not-its-provider`: the provider the identity itself runs on. */
  readonly itsProvider?: Provider
  /**
   * 🔴 **707 · R41 — `not-its-provider`: the identity by the roster's NAME** (`agentName`), resolved
   * by the caller — this module reads no roster. ⚠️ {@link profileId} stays the KEY.
   */
  readonly named?: string
}

/**
 * ⚑ **What the door answers** — the saved default read back, or the rail that stopped it.
 *
 * ⛔ **A refusal is a VALUE**, `AgentRemoved`'s shape: every one of these is a person's ordinary
 * mistake or an ordinary state of the machine. ⚠️ **`requireAPerson` still THROWS**: a caller that is
 * not a person reaching this door is the one thing it exists to prevent.
 */
export type ModelChoiceSaved =
  | { readonly ok: true; readonly choice: AgentModelChoice | null }
  | {
      readonly ok: false
      readonly rail: ModelChoiceRail
      readonly reason: string
      readonly detail: ModelChoiceRefusalDetail
    }

/**
 * The three settings a user can change mid-conversation, as the UI sees them (076).
 *
 * Each is a pair for the reason `ApprovalModeDisclosure` is: what the session is RUNNING with, and
 * what it will run with from the next turn. The header discloses the first and promises the second.
 *
 * ⚠️ **The `pending*` fields for model and effort are WRAPPED, and the wrapper is load-bearing.**
 * A queued `undefined` is a real thing to queue — since D-042 (R1: every change is named, the
 * provider's default by its name) only for an EFFORT, on a model whose list row offers none. A bare
 * `string | undefined` could not tell that apart from "nothing is queued". `null` means nothing
 * pending; `{ value: undefined }` means "pending: no effort named".
 */
export interface SessionSettingsDisclosure {
  /**
   * The model this conversation is selected to run (D-042 · R1: every call names one), or `null`
   * only for a conversation that has named none yet — an adopted one, or a row from before D-042.
   */
  model: string | null
  pendingModel: { value: string | undefined } | null
  /**
   * The reasoning effort, in the provider's own spelling — `null` where the model offers none, or
   * nothing has been named yet.
   */
  reasoningEffort: string | null
  pendingReasoningEffort: { value: string | undefined } | null
  /** Whether the session is planning. */
  planMode: boolean
  pendingPlanMode: boolean | null
  /**
   * 🔴 **D-042 · R5 — what the PROVIDER last reported running**, absent until it has said: the
   * model, and the effort where the provider reports one (Codex with its settings; Claude as each
   * turn ends — until then its effort is what was requested). ⚑ A window draws it beside
   * {@link model} when the two differ — an alias's target, a reroute. ⚠️ Optional, `AgentInfo`'s
   * idiom: absent is *not reported*.
   */
  reported?: ReportedModel
}

/**
 * 🔴 **D-048 · the answer to a person's change of a conversation's setting** — the settings after
 * it, and, for a model or an effort, what the pair became beyond this conversation.
 */
export interface SessionSettingChanged {
  /** The settings after the change, so the caller never has to guess what landed. */
  settings: SessionSettingsDisclosure
  /** What the model and effort became beyond this conversation — `null` for plan mode. */
  thePick: WhatAPickBecame | null
}

/**
 * ⚑ **What a person's model and effort for one conversation became beyond it**, so a window draws
 * what happened rather than a guess. Either it became the agent's default — its new conversations
 * that name no model start on it — and the person's last pick on this provider, or it did not, and
 * `because` says why. A default is only ever for the agent's own provider (or an agent that has
 * none of its own), and only for a pair the provider's list holds.
 */
export type WhatAPickBecame =
  | { itsAgentsDefault: true; theLastPick: true }
  | {
      itsAgentsDefault: false
      /**
       * The person's last pick on this provider now: a new conversation that names no model, of
       * an agent with no default of its own on this provider, starts on it.
       */
      theLastPick: boolean
      /**
       * Why it is not the agent's default:
       *  - `its-agent-runs-on-another-provider` — a default is always for the agent's own provider;
       *    it is still the last pick;
       *  - `it-names-no-agent` — the conversation names no agent of its own (an adopted one, or one
       *    from before agents); it is still the last pick;
       *  - `the-list-does-not-hold-it` — the provider's list holds no such model, or the model offers
       *    no such effort: it is this conversation's alone;
       *  - `the-list-could-not-be-read` — nothing could be checked: it is this conversation's alone;
       *  - `no-model-is-named` — the conversation names no model to keep: it is this conversation's
       *    alone.
       */
      because:
        | 'its-agent-runs-on-another-provider'
        | 'it-names-no-agent'
        | 'the-list-does-not-hold-it'
        | 'the-list-could-not-be-read'
        | 'no-model-is-named'
    }

/** ⚑ **D-042 · R5 — the model a provider reported running, and its effort where it reports one.** */
export interface ReportedModel {
  model: string
  effort?: string
}

/**
 * 🔴 **What one provider says it can run in one profile home (058) — and, when it says nothing, WHY**
 * (310).
 *
 * ## The defect this union exists to remove
 *
 * This was `ModelChoice[] | null`, and the `null` carried at least three different facts:
 *
 *  1. **we did not ask**, because the profile has no home yet — deliberate, and not an error;
 *  2. **we asked and could not be answered** — no login, no binary, a provider that rejected;
 *  3. **the app is closing**, so no probe was allowed to start.
 *
 * A plain input must distinguish a profile that does not yet exist, a provider refusal and a catalogue still loading from an available menu that is merely closed. Otherwise a healthy provider can appear to have no model list.
 *
 * ⚑ **The remedy is `305`'s**: make the distinction a FIELD, decided once where the fact is known,
 * and let every surface read it rather than re-deriving it from an absence. The host is where the
 * fact is known — the not-asked branch returns before any probe, the refused branch is a caught
 * rejection — and until this type existed both collapsed at the boundary.
 *
 * ## ⚠️ `ok: true` with an EMPTY list is a fourth fact and NOT a refusal
 *
 * `{ ok: true, models: [] }` is the provider answering that it has none. That has never happened,
 * and it must not be renderable as *"we could not ask"* — we could, and it said none. Downstream it
 * still gives the same INSTRUCTION as a refusal (no menu: a `datalist` with nothing in it is a
 * dropdown arrow onto emptiness, 058 review), and that collapse now happens in exactly one place,
 * `renderer/src/lib/model-field.ts`, which keeps the two sentences apart while keeping the one rule.
 *
 * ⚠️ **There is no `in-flight` arm and there cannot be**, because this type is what a settled probe
 * produced. *"Still asking"* is a fact about the RENDERER — no answer is held for that profile yet —
 * and it is the fourth silence, added on top of these by `renderer/src/lib/model-field.ts`.
 */
export type ModelCatalogue =
  /**
   * The provider answered. ⚠️ **May be empty**, which is an answer and not a silence.
   *
   * 🔴 **682 · `standIn` — the list was asked in ANOTHER profile's home** (`R31d`), because the
   * profile asked about is an agent that has never run and asking in its own home would create it.
   * ⚑ It names that profile (BroBot's own, `STAND_IN_PROFILE`), and it is ABSENT whenever the
   * profile's own home answered. ⚠️ Every home keeps its own copy of the provider's catalogue
   * (measured, 682 §1); ⚑ D-042 · a model this list holds that the agent's own home refuses is said
   * at that call, in the provider's own words (D-039). ⛔ An identity with no row still answers
   * `no-profile` — a name somebody is typing is not an agent.
   */
  | { ok: true; models: ModelChoice[]; standIn?: string }
  /**
   * We did not ask, because this profile has no home yet — so asking would CREATE one.
   *
   * 🔒 The guard that returns this is `098`'s *"asking a question wrote a credential to disk"*, held
   * by `257 §2`: `prepareProviderHome` is the first thing a probe does, and for Codex it copies the
   * machine credential in. ⛔ **It is the normal path for every first conversation in a new profile,
   * and a surface must not render it as an error.**
   */
  | { ok: false; reason: 'no-profile' }
  /**
   * We did not ask, because a quit had already started and the probe registry refused to open one.
   *
   * ⚠️ **A fact about US.** Saying it in the same sentence as a login failure would blame a provider
   * for the one cause that has nothing to do with it (070, from 068 finding 7) — an argument that
   * has been in `askProviderForModels`'s comment since then, with both branches returning the same
   * `null` underneath it.
   *
   * ⛔ **Its own arm rather than sharing one with `no-profile`**, and not only for the sentence: a
   * union member whose discriminant is itself a union does not narrow member-by-member, so the two
   * would have had to be told apart by hand at every reader.
   */
  | { ok: false; reason: 'closing' }
  /**
   * We asked, and could not be answered — no login, no binary, a provider that rejected.
   *
   * ⚠️ **`detail` is the provider's own diagnostic and it is the only copy of it.** 🔒 It is never a
   * credential, on the same rule and for the same reason as {@link ProviderSignInResult.detail}: its
   * one producer is `errorMessage(error)` over a failed `listModels`, which is a sentence about the
   * call. `098`'s lesson is that the sentence alone is *"accurate and useless"* — so the surface
   * shows it beside a remedy rather than instead of one.
   *
   * `tooSlow` is `true` when the provider did not answer in time: nothing has to change before the
   * next ask, which may find it answering.
   */
  | {
      ok: false
      reason: 'refused'
      detail: string
      tooSlow?: true
      /** The original typed launch failure requires provider sign-in or program setup. */
      setupRequired?: true
    }

/**
 * 🔴 **D-042 · R3 — the ONE list a person picks from, for one provider** (`09` §2, §4–§6): the
 * provider's own models, then the ones a person added by hand, with what the person last picked
 * and what a new conversation of this agent starts on.
 *
 * ⚑ **Read by the one picker UI-012 draws**, wherever a model is chosen. ⛔ A model added by hand is
 * a row like any other, marked `a-person`, and only those can be deleted.
 */
export interface ModelList {
  readonly provider: Provider
  /**
   * ⚑ **`null` when the provider answered**; otherwise why its own rows are missing — the probe's
   * own word, so a list of only a person's models can say why.
   */
  readonly notAsked: Exclude<ModelCatalogue, { ok: true }> | null
  /** ⚑ {@link ModelCatalogue}'s `standIn`: the list was asked in BroBot's home for an agent with none. */
  readonly standIn: string | null
  /**
   * The provider's rows — each with what an alias points at (`resolvesTo`), its efforts, its default
   * effort and the provider's default mark (`isDefault`) — then the person's.
   */
  readonly models: readonly ListedModel[]
  /** The model and effort the person last picked on this provider, or `null`. */
  readonly lastPicked: ModelAndEffort | null
  /**
   * What a new conversation of this agent on this provider starts on when nothing is named —
   * R1's order (its default, else the last pick, else the provider's default) — or `null` only when
   * nothing can name one (the provider's list could not be read, or marks no default it names an
   * effort for, and nothing else names a model).
   */
  readonly startsOn: SelectedModel | null
}

/**
 * ⛔ **Why a person's choice was not saved** — each a fact the door can state, never a sentence the
 * door has to invent. ⚑ See {@link MODEL_CHOICE_SAID} for what each says.
 */
export const MODEL_CHOICE_RAILS = [
  /** ⛔ Criterion 12: a name with no identity row is not a thing to configure into existence. */
  'no-such-agent',
  /**
   * 🔴 **682 · the choice names another provider than the identity's own** (`R31b`). ⛔ Asked before
   * any provider is, because it needs none. ⚑ An identity with NO provider of its own takes either.
   */
  'not-its-provider',
  /** The provider was asked and did not answer — not signed in, the program missing, a quit. */
  'models-unavailable',
  /** The list — the provider's rows and the person's own — does not hold the model. */
  'model-not-offered',
  /** The model's row does not offer the effort — or offers efforts and none was named. */
  'effort-not-offered',
] as const
