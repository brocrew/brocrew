/**
 * ⛔ **What a profile IS, and what it is NOT, in the words two surfaces have to agree on** (384 §1.1).
 *
 * ⚑ **This file exists because a sentence that lives in one component cannot be rendered by a
 * second one.** {@link PROFILE_OWNS} was a `const` inside `NewConversation.vue`'s `<script setup>`
 * until 384. `SessionInfo.vue` said the same thing by typing it out again, and `167 §4`'s rule —
 * *"these two surfaces describe one boundary identically"* — was kept by a SOURCE census
 * (`the-layer-a-file-belongs-to.test.ts`) whose own docblock says it only exists because *"nothing
 * imports it, and a browser test cannot read the file"*. 🔴 **That census was the workaround. This
 * module is the fix**, and `356` is the evidence it was needed: the two copies had already drifted
 * once and had to be corrected in two places.
 *
 * ## ⛔ Why a new module rather than a home in one of the five that exist
 *
 * Every copy module in `lib/` is scoped by SUBJECT, and each one's first sentence says which:
 * `approval-mode.ts` is approvals, `plan-mode.ts` is plan mode, `credential-words.ts` is what this
 * app says about a credential, `profile-credential.ts` is what a profile does with a sign-in — and
 * that last one's constitutional rule is that **it holds no copy at all**, because the words are the
 * adapter's (`039`). ⚠️ None of them is *what a profile is*. Filing this under any of them would
 * have made that module's own first sentence false, which is the hazard rather than the tidy-up.
 *
 * ## ⚠️ What is NOT here
 *
 * ⛔ **The per-provider credential sentence is not here and must never be** — it is
 * `ProviderCapabilities.homeCredential`'s, chosen by `profileCredential()`, and `329` split it out
 * of {@link PROFILE_OWNS} precisely because one line said the same thing to two providers that do
 * opposite things. ⚑ And nothing here is rendered by anything this commit touches:
 * {@link PROFILE_IS_NOT} is a constant with a test and no call site, which is standing rule 5's
 * shape — *a safety sentence with no test is a comment* — arriving before the surface that will
 * draw it.
 */

/**
 * What a profile IS, said once, where the choice is made (167 §3).
 *
 * ⛔ **One line, per 031** — *"a surface nobody reads is worse than none"* — and it names the three
 * things that are now per profile rather than gesturing at "isolation": the folder its conversations
 * run in (021), the profile's own instruction file (158) and the memory the agent writes for itself,
 * which since 166 follows the profile into every folder it works in rather than being scoped to one
 * working directory.
 *
 * ## 🔴 It used to name a fourth thing, and that clause was false on one provider (329)
 *
 * It read *"the sessions **and sign-in** kept there"*. On Codex that is true and understated — the
 * sign-in kept there is a copy of the machine's, made without being asked. ⛔ **On Claude it is
 * simply wrong**: 015's hard rule is that nothing of the user's login is ever written into the
 * folder, and this same app's Info panel says so in as many words — *"the token is injected per
 * launch, never written here"*. One line said the same thing to both, which is `039` in copy.
 *
 * ⚑ **So the clause moved rather than being deleted**: `profileCredential` draws the per provider
 * truth directly beneath this line, from `homeCredential`, in the adapter's own words.
 *
 * 🔴 **`CLAUDE.md` was one provider's filename stated for both** (356, from 357). The other provider
 * reads no such file from a home — it reads its own name — and this app authors NEITHER leaf, so
 * naming one of the two told half the users the wrong filename to go and create. ⚑ **The THING is
 * what all three items name, so the thing is what this says.**
 */
export const PROFILE_OWNS =
  'A profile is an agent’s own home: the conversations it runs there, its own instruction file, ' +
  'and what it remembers — in every folder it works in.'

/*
 * ⛔ **`PROFILE_NEW_NOTE` went with `+ New profile…`** (417, HO-022 §2). It said what choosing to
 * create a profile committed you to, before it happened — and the launcher's profile menu was its
 * only renderer and the only place a person could create one. 🔴 **There is no person-operated way
 * to bring an identity into being at all now**; HO-022 §4 puts that on the roster, in Slice 5, and
 * the sentence belongs to whatever surface offers the gesture then rather than to a constant
 * nothing reads in the meantime.
 */

/**
 * ⛔ **What a profile is NOT** — the clause `382 §9.2` found v2.3 asserting with nothing behind it.
 *
 * The mock's launch explanation reads *"It is not a role or a trust boundary."* ⚑ **The claim is
 * true and it is the half a person most needs**, because a home that carries an agent's memory
 * across every project LOOKS like a rank; and until now no constant carried it, so no test could.
 *
 * ## ⚑ Each clause, and the code it is read off
 *
 * **"not a rank"** — an identity has no role: every rule reads the capability grants, and a row
 * nobody has changed follows the one default set every agent holds.
 *
 * **"read from its capability grants"** — 369 §3 moved the capability columns onto
 * `agent_identity` and the rule it recorded is that *"nothing that ENFORCES a capability has ever
 * been able to see a project"*. ⚑ Since D-016 the schema has no profile table at all:
 * `agent_identity` is the only table that carries a grant, so there is no profile row an answer
 * could be read from.
 *
 * ## ⚠️ What this deliberately does NOT say, and why the shorter claim would be false
 *
 * ⛔ **It does not say a profile grants nothing.** Most of `DEFAULT_CAPABILITIES` is not the
 * narrowest value, and each is a ruling: `canMessage`, `canAssignWork` and `canCreateAgents` rule to
 * `any`, and `maxDepth` to 6. A new identity therefore starts with real reach it was never granted
 * by a person. What is true is the thing said below: those defaults are the SAME for every
 * identity, so choosing a profile is not how anyone gets more of them.
 */
export const PROFILE_IS_NOT =
  'A profile is a home, not a rank. What an agent may do is read from its own capability grants — ' +
  'never from its name or the profile it runs in, and the defaults are the same for ' +
  'every agent until somebody changes them.'
