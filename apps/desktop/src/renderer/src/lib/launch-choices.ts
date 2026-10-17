import type { Provider } from '../../../shared/runtime-ipc'

/**
 * 🔴 **What a person chose at the front door before pressing send** (435, HO-025 §4/§5).
 *
 * ## ⛔ Why this is a type at all, and why it does not live in the component
 *
 * **HO-025 §5 reversed half of HO-023 §3.** *"What `asks nothing` meant was: do not make
 * configuring a session the price of starting a conversation. It did not mean the choices should be
 * unavailable."* ⚑ **The front door asks nothing and offers everything** — so there are three
 * answers a person may give, and every one of them may also be left ungiven.
 *
 * 🔴 **And ungiven has to be a VALUE, not an absence in a different shape.** `provider` is required
 * on the wire and `model`/`reasoningEffort` are omissions, so *"we did not ask"* is spelled three
 * different ways downstream. It is spelled ONE way here — `null`, `''`, `''` — and each door out of
 * this object converts it exactly once: {@link NO_LAUNCH_CHOICES} is what an untouched front door
 * holds, and an untouched front door must put the same three fields on the wire it put there
 * before this dispatch existed — ⚑ unless the person's last pick is not what the host would start
 * on, which the form then sends (UI-012 · R-1, `theFormSends`). ⚑ A launch spends the model and
 * effort put here: the host made them the last pick, which the form starts on from then.
 *
 * ## ⚠️ It lives above the component, and `210` is why
 *
 * ⛔ **`NewConversation` is torn down the moment a conversation is opened over it** (`RuntimeScreen`
 * renders it under a `v-else`), so anything it owns is gone when a person comes back. `211 §1`
 * built a whole `LaunchDraft` for exactly this: *"210 typed a prompt, chose Claude, chose the
 * `field-notes` profile and a folder, looked at an existing conversation and returned — to the
 * prompt, under Codex, in BroBot's home, with a blank folder."*
 *
 * ⚑ **`417` deleted `lib/launch-draft.ts` on a premise it was entitled to at the time** — *"The
 * launcher decides nothing now, so there is nothing to carry"* — and this dispatch falsifies it.
 * ⛔ **Three fields, not `211`'s eight**: the profile, the project, the folder, the approval mode
 * and the two fold flags are still not the front door's to decide, and a carrier with room for them
 * is an invitation to put them back.
 *
 * ⚠️ **In memory, for this run of the app.** This is a half-finished thought about a conversation
 * that has not started, not a preference to persist — the rule `211` applied to the words beside it
 * too, until `744` (R100) kept those words and their paths across a restart. ⛔ **Nothing writes
 * THESE to disk**, and a person who restarts BroBot2 meets the resolved defaults again.
 */
export interface LaunchChoices {
  /**
   * 🔴 **The first term of `providerForALaunch`** — *what the person asked for*, ahead of *what
   * BroBot's identity says* and *what the app frame falls back to*.
   *
   * ⛔ **`null` is not `DEFAULT_PROVIDER` spelled differently.** An identity that names a provider
   * (`433` is landing the verb that writes it) must move the front door's answer for as long as
   * nobody has overruled it, and a resolved value copied in here at mount would freeze the
   * resolution at whatever it happened to be.
   */
  provider: Provider | null
  /**
   * The model id to ask for — `''` for *we did not ask*: then the form names the last pick, or
   * leaves the host to name what it starts on (`lib/model-lists.ts`' `theFormSends`, UI-012 · R-1).
   *
   * ⚠️ **A string and not a union**, because the id vocabulary is the provider's and moves without
   * us — and since UI-012 it is what the model picker's Take put here, a row of a provider's list or
   * one a person added by hand.
   */
  model: string
  /** The level to ask for — `''` for *we did not ask*. Free text for {@link LaunchChoices.model}'s reason. */
  reasoningEffort: string
}

/**
 * ⛔ **An untouched front door**, and the three values that make its launch byte-identical to the
 * one `417` shipped — where no last pick says otherwise (UI-012 · R-1).
 *
 * ⚑ **Frozen**, because it is handed out as the initial value and a caller that mutated it would
 * change what *untouched* means for every later conversation in that run of the app.
 */
export const NO_LAUNCH_CHOICES: Readonly<LaunchChoices> = Object.freeze({
  provider: null,
  model: '',
  reasoningEffort: '',
})
