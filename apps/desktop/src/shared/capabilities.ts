/** How standing rules change, as every agent is told it. */
export const RULE_WRITING_POLICY =
  'Only the person and the profile that created an agent can change its standing rules; any conversation of that profile counts, and when no creating profile is recorded, only the person can. Being the same profile as the agent gives no right to change its rules: an agent never writes its own, and keeps its own notes instead. Anyone else, the agent included, can propose a change, and the person decides a proposal. Each version keeps its author and reason, and can be undone.'

/** What `list_profiles` counts, said beside the number. */
export const EVERY_AGENT_THIS_APP_HOLDS =
  'This counts every agent this app holds; any of them can be named to give_work.'

/**
 * 🔴 **What the door that starts an agent's conversation buys, and what it does not** (368, HO-012
 * §2).
 *
 * HO-012 §2: *"**'The interim rail buys consent, never containment'** is the honest description, and
 * it should be **in the disclosure itself**, not only in this correspondence. A person reading what a
 * mode does deserves **the limit of the protection along with its existence.**"* It is a constant
 * rather than markup for `171`/`168`'s reason: *"a rule can only be enforced on wording a test can
 * reach."*
 *
 * ## ⚑ Every clause, and the code it was read off
 *
 *  - 🔴 *"runs the way that agent does and can never be given more latitude in its approval mode"*
 *    — a conversation `give_work` starts runs in its giver's mode, and `spawn-rails.ts` refuses
 *    `wider-than-its-parent` when the new conversation would act past its folder with nobody asked
 *    where the giver keeps a card or a sandbox (HO-036: *inherit, never wider*; D-038). ⛔ **The
 *    ceiling is on the MODE and never on the grants**: any agent may give work to any identity, whose
 *    own grants may be wider than its giver's (D-014), so the sentence names the approval mode rather
 *    than saying *more* bare on a sheet of grants. ⚠️ It says *latitude* rather than *fewer prompts*
 *    because the ceiling is compared on reach past the folder — the card on Claude `ask`, the card
 *    and a sandbox on Codex `ask`, nothing in `auto` on either — and not on prompts (F050).
 *    ⏸ **Where it overstates, held for a ruling** (D-038 F-A, F-B): a Claude `ask` giver's Codex
 *    `ask` helper writes and runs commands in its folder, reads outside it and runs a server tool
 *    its server marks read-only, all with no card, which is more latitude, and is given; and since a
 *    child starts in its giver's mode, *the door refuses that* names a refusal no give meets today.
 *  - 🔴 *"nothing here bounds where a command it runs can reach"* — measured: on Claude nothing is
 *    sandboxed in either mode (`367`), and this app refuses no tool call because of WHERE a path it
 *    names is (`726` · R92); on Codex every preset reads a planted file outside the workspace
 *    (`366`).
 *  - *"what you approve is approved"* — HO-012's own words: nothing downstream of an allowed card
 *    re-reads the decision.
 *
 * ## ⚠️ What it deliberately does NOT say
 *
 *  1. ⛔ **That a spawned conversation cards its commands**: on Codex a permitted read denies
 *     nothing, so nothing escalates and nothing asks — writing it would claim a protection where none
 *     exists (`086`).
 *  2. ⚠️ **Anything about a conversation's LIFE** — it is about the door that starts one; a later
 *     `setApprovalMode` is recorded on the session's own header (`349`).
 *  3. ⛔ **Merging or production** — neither is a rule of this product (HO-035).
 *  4. ⚑ **No argument** — `approval-mode.ts`'s rule: no "unsafe", no scare quotes.
 *
 * ⚠️ **It renders on `CapabilitiesSheet.vue`, above the first grant control**, the one surface where
 * *"an agent created it"* is a certainty rather than an inference; nothing on the wire tells a
 * spawned session from a person's.
 */
// ⚠️ **The LAST line is byte-identical to the one `455` M16 anchors**, and the sentence is wrapped so
// that no forty contiguous characters of it sit in one literal — `consent-never-containment.test.ts`
// relies on that to tell a paste from the declaration.
export const SPAWN_RAIL_MEANS =
  'A conversation an agent starts runs the way that agent does and can never be given more ' +
  'latitude in its approval mode — the door refuses that. That buys the decision and not a ' +
  'boundary: nothing here ' +
  'bounds where a command it runs can reach, and what you approve is approved.'
