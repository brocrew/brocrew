/**
 * ⛔ **What this app says about a credential — the two gestures, in the exact words its buttons
 * use** (310).
 *
 * 🔴 **`733` · and no longer a promise about the files.** From 384 §1.1 until `733` this module also
 * held `CREDENTIAL_FILES_ARE_NOT_READ` — *"Nothing here reads a credential file … Reveal raises it in
 * Finder rather than opening it"* — the promise the design's paths view makes by hand. ⚑ The PM, on
 * `731` F-2, under R92 and R93: *"Offer Open as for any other file, and drop the credential
 * wording."* The Info panel's Open reads `auth.json` onto the app's paper like any other file, so
 * the promise is false and went with the rule it described; the design map files the design's
 * sentence `false` (`design-v2-map.ts`).
 *
 * `SignInPanel.vue` has said both sentences since 098, and it is the only place a person can press
 * them. When another surface has to point at one of those gestures — 310's model field, which can
 * refuse for exactly the reason the panel exists to fix — it must point at it **by the button's own
 * label**, not by a parallel phrasing.
 *
 * ⚠️ **This is `308` §5's mistake in the other direction, which is why it is a module and not a
 * convention.** Two surfaces describing one gesture in two wordings teaches a person that there are
 * two gestures; and a label edited on the button while a second copy went on saying the old thing
 * would be a lie that no test comparing a string to itself could catch. There is one string.
 *
 * ⚑ **Not a component and not in `SignInPanel.vue`.** A pure function decides what the model field
 * says (`model-field.ts`) and nothing may import a `.vue` for a constant, so the words live where
 * both a component and a function can reach them.
 *
 * 🔒 Nothing here is a credential, a token or an account name — these are labels on buttons.
 */

/** Sign in separately for this agent, when its provider supports that action. */
export const SIGN_IN_HERE = 'Sign in for this agent'

/**
 * The panel's fast, temporary remedy — offered when the provider declares `reprovisionAuth`
 * available.
 *
 * ⚠️ **A postponement rather than a fix**, and the panel says so beside it. Any surface that points
 * here inherits that: it must not present this as the answer where {@link SIGN_IN_HERE} is on offer.
 */
export const COPY_MACHINE_SIGN_IN = 'Copy my machine sign-in'
