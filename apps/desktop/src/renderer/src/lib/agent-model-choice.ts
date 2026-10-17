import type { AgentIdentity, Provider } from '../../../shared/runtime-ipc'
import { PROVIDER_NAME, agentName } from '../../../shared/runtime-ipc'
import {
  aChoiceInWords,
  aChoiceIsInForce,
  whatAModelChoiceReaches,
  type AgentModelChoice,
} from '../../../shared/model-choice'

/**
 * # 🔴 685 · the control `677` built the doors for — a person chooses each agent's model and effort
 *
 * ⚑ **D-042 · what it chooses is the agent's DEFAULT** (R2): what its new conversations start on. A
 * default is a model and the effort it runs at, so the model menu has no blank — the provider's
 * own default is a row of it, by name — and a blank effort is the model's own default effort,
 * named by the door. ⚑ **UI-012 draws it with the one model picker** (`ModelPicker.vue`, over
 * `lib/model-lists.ts`): what was this module's menus, its pre-press verdict and its draft went with
 * the `<select>`s they fed.
 *
 * ⚑ **`677` §7, in its own words**: read the choice with `agentModelAndEffort`, save with
 * `setAgentModelAndEffort`, clear with all three `null`, draw the refusal's `reason`, and render
 * `whatAModelChoiceReaches` beside it. ⚠️ **This module is the half of that which has no Vue in
 * it**, so a node test over the real host reaches every word `AgentModelChoice.vue` draws without
 * mounting it (`home-attention.ts`' reason).
 *
 * ## ⚠️ Which provider the menus are for
 *
 * ⚑ **The one the sheet's *Runs on* row resolves** (`CapabilitiesSheet`'s `runsOn`) — the control
 * sits beside that choice and is about the same agent — ⚠️ **except, since `696`, for an agent with
 * no provider of its own holding a choice**, whose agent-started launches run on the CHOICE's
 * provider (`R31a`); see {@link theMenusAreFor}. ⛔ It offers no provider of its own: a model
 * belongs to a provider (`R25` §1.2), and a second provider menu beside the first would be two
 * answers to *what does this agent run on*.
 */

/**
 * 🔴 **685 · what the row adds when the held choice is NOT IN FORCE** — or `null` when it is.
 *
 * ⚑ **`691` · the question is `682`'s own {@link aChoiceIsInForce}** (`R31b`) — the one
 * {@link heldReachesSays} asks too, so the row draws a choice as in force exactly when main reads it.
 * ⚑ `null` when the agent has no provider of its own: the choice is then what holds its launches
 * (`R31a`). ⚠️ **Only a choice written before `682` can reach the sentence** — the model door now
 * refuses a choice for another provider (`not-its-provider`) and `setAgentProvider` clears one.
 *
 * 🔴 **`696` · in `R31b`'s own terms: such a choice is read by NOTHING.** ⛔ It said *"a launch on
 * Codex does not read it"*, which was true under `677` and is now the smaller half: a spawn resolves
 * its provider and model as though nobody had chosen (the spawner's own `model` is admitted, where a
 * choice in force refuses it), a wake resumes as recorded, and `list_profiles` does not list it
 * (`682` §3). ⚑ **Then the two presses beside it, and what each does**: its picker lists the agent's
 * own provider's models ({@link theMenusAreFor}), so a save replaces it; *Clear* takes it
 * away. ⚠️ The provider row above is a third way — moving it back brings the choice into force —
 * and it is not named here, because this sentence is about THIS control.
 */
export function aChoiceForAnotherProviderSays(
  choice: AgentModelChoice,
  itsProvider: Provider | null,
): string | null {
  // ⚠️ `aChoiceIsInForce` already answers yes for `null`; the first test is here to narrow the type.
  if (itsProvider === null || aChoiceIsInForce(choice, itsProvider)) return null
  return (
    `It is for ${PROVIDER_NAME[choice.provider]}, and this agent runs on ` +
    `${PROVIDER_NAME[itsProvider]}, so no launch reads it: another agent that starts this one, or ` +
    'whose message starts it, does so as though nobody had chosen. Its picker picks a ' +
    `${PROVIDER_NAME[itsProvider]} model in its place, and Clear takes it away.`
  )
}

/**
 * 🔴 **`696` · which provider the menus are for** — `688` §1b, the half `691` left (§8.3).
 *
 * ⚑ **The sheet's resolved *Runs on*, except where a choice holds the provider instead.** An agent
 * with NO provider of its own resolves to the app's default for a launch a person starts
 * (`providerForALaunch`), and ⛔ **an agent-started launch of it runs on its CHOICE's provider**
 * (`R31a`: `inForce?.provider` is the first term of `admitGive`'s order). ⚠️ Until `696` the menus
 * were the screen's fallback provider's regardless — Codex (`RuntimeScreen`'s `DEFAULT_PROVIDER`) —
 * so *Change…* on a Claude choice opened Codex's rows, seeded nothing, and a save moved every
 * agent-started launch of it to Codex without a word.
 *
 * ⚑ With its own provider the menus are that provider's — the choice is either for it (in force) or
 * read by nothing ({@link aChoiceForAnotherProviderSays}), and neither is a reason to offer the
 * other provider's rows. ⚑ With no choice they are the resolved one, as `685` built.
 */
export function theMenusAreFor(
  runsOn: Provider,
  itsProvider: Provider | null,
  held: AgentModelChoice | null,
): Provider {
  return itsProvider === null && held !== null ? held.provider : runsOn
}

/**
 * 🔴 **`696` · the stand-in named the way every other surface names that agent** — {@link agentName}.
 *
 * ⛔ **`standIn` is a SLUG** — `STAND_IN_PROFILE`, BroBot's own, spelled `brobot` since `592` — and
 * printed as given the sheet read *"brobot’s list"* about the agent the rail, the Team page and the
 * header all call *BroBot*. ⚠️ `570`'s finding one word over: the difference narrowed to a capital
 * letter, and a person still reads it about their own main agent. ⚑ So the menus' note is handed the
 * NAME.
 */
export function theStandInNamed<C extends { readonly standIn: string | null }>(
  choice: C,
  identities: readonly AgentIdentity[] | null,
): C {
  return choice.standIn === null
    ? choice
    : { ...choice, standIn: agentName(choice.standIn, identities) }
}

/**
 * 🔴 **`696` · what the provider press CLEARED, in words** — `682`'s `R31b`: *"`setAgentProvider`
 * moving an identity to another provider clears its choice in the same act, and its answer says
 * so."* ⚑ The answer's `modelChoiceCleared` rendered, after the door has written it (HO-029 §3) —
 * never predicted.
 *
 * ⚑ **It names what was taken**, whole ({@link aChoiceInWords}), so a person who moves the provider
 * back knows what to choose again; and **why**, in the door's own clause (`not-its-provider`'s *"a
 * choice is always for its own provider"*). ⚠️ **"Its provider is now X"** — the column — and not
 * *"it now runs on X"* (review): a conversation already running keeps its provider, and a spawner
 * may still name another once no choice holds it.
 */
export function whatTheProviderPressCleared(cleared: AgentModelChoice, nowOn: Provider): string {
  return (
    `The model and effort chosen for it — ${aChoiceInWords(cleared)} — were cleared: a choice ` +
    `is always for its own provider, and its provider is now ${PROVIDER_NAME[nowOn]}.`
  )
}

/**
 * 🔴 **712 · R56 (`696` L2) — what the provider press WILL clear, said before it** — or `null` when
 * nothing is held (or the choice has not been read: *not known* is not *nothing clears*).
 *
 * ⚑ **R56:** *"When moving an agent's provider will clear a model choice a person made, the provider
 * control says so before the press, in words. It keeps saying what it cleared after the press
 * (HO-029 §3)."* ⚑ The after half is {@link whatTheProviderPressCleared}, from the door's answer.
 *
 * ⛔ **The condition is main's, read off `setAgentProviderTx`, not guessed from a catalogue**: the
 * door clears a held choice whenever the new provider is a provider and not the choice's own —
 * *whether that provider offers the model* is never asked — and a move to no provider saved keeps
 * it. ⚑ So the sentence names the one provider that keeps it and the one option that does, and
 * nothing it would have to predict. ⚠️ **A prediction about a write, and said as one**: another
 * window may move the choice between this read and the press; the after-press line is the record.
 */
export function whatAProviderPressWouldClear(held: AgentModelChoice | null): string | null {
  if (held === null) return null
  return (
    `Moving it to a provider other than ${PROVIDER_NAME[held.provider]} clears the model and ` +
    `effort chosen for it — ${aChoiceInWords(held)}: a choice is always for its own provider. ` +
    'Leaving no provider saved keeps it.'
  )
}

/**
 * 🔴 **`691` · the sentence beside a HELD choice — `whatAModelChoiceReaches`, for a choice in force
 * only**, or `null`.
 *
 * ⛔ **Its first clause is false of a choice not in force**: *"another agent that starts this one,
 * or whose message starts it, runs it on Claude, and cannot pick another provider or model"*, beside a Claude choice on
 * a Codex agent, which main reads nothing of — a spawn resolves as though nobody had chosen
 * (`R31b`). ⚑ So the row says nothing it cannot keep, and {@link aChoiceForAnotherProviderSays}
 * says what is true instead. ⚠️ Found by `691`'s review: the sheet drew both, one under the other.
 */
export function heldReachesSays(
  held: AgentModelChoice,
  itsProvider: Provider | null,
): string | null {
  return aChoiceIsInForce(held, itsProvider) ? whatAModelChoiceReaches(held) : null
}
