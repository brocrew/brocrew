"""682 · a person's choice holds the whole launch — PM ruling R31, four parts, and six findings.

⛔ **Ordered by the PM's ruling R31**, on `677`'s inbox: a person's choice holds the whole launch,
provider included (R31a); it is always for the identity's own provider (R31b); a person's live act on
a conversation outranks it for that conversation (R31c); and an identity that has never run can be
given one (R31d). ⚑ Findings 4, 5, 8, 9, 10 and 12 of that inbox ride along.

## ⚠️ What a row here measures

 * ⚑ **M1–M6 are R31a and R31b in the rails and the rule** — the provider held, the in-force fold (at a
   spawn, and M5 at a wake), the stand-in's verdict carried to the launch — killed by
   `the-model-a-person-chose.test.ts` §1 and `a-persons-choice-holds-the-whole-launch.test.ts`.
 * ⚑ **M7–M14 are the two person doors and the store under them** (R31b, inbox 10): the refusal by
   name, the clear in the same transaction and its guard, the answer that says so, both announcements,
   and the compare-and-set a confirmed verdict writes through.
 * ⚑ **M15–M26 are R31d** — the stand-in's list at the door and on the `models` read, the provenance on
   the saved value, the first launch's second judgement, the set-aside that sends nothing, the row on
   the conversation, the answer, and the transcript drawing it.
 * ⚑ **M27–M34 are the wake** — R31c's stamp and its arm, inbox 4's sentence relay, inbox 5's default
   effort and the recorded echo, and R31d's set-aside there.
 * ⚑ **M35–M41 are the rest**: inbox 9's reason, inbox 8's listing, the sentence beside the control,
   the refusal's own words, inbox 12's counted sentence, and `0045`'s shape.
 * ⚑ **M42–M46 were added for the review's first round**: the door's second R31b check after its
   await, a wake that would ask for a refused pair again, inbox 5's probe only where a thread holds an
   effort, and the two sentences that said a wake resumes on a default. **M47–M49 for its second**:
   the row a refused-pair wake keeps, the words naming what continues, and an effort-only wake's
   sentence.
 * ⚑ **M50–M51 were added by `691`** (682 landing second), whose review found R31d's provisional
   clause false once the agent HAS run — a person's own launch never judges a choice, so `standIn`
   outlives the agent's first run, and *"this agent has never run; its first launch checks it"* went
   on being drawn — and then found the two assertions of the clause's ABSENCE asking for words the
   rewording removed, so they could not fail (M51).

## ⛔ What this table cannot reach

 * 🔴 **What a PROVIDER's catalogue holds in a real home.** Every row is killed against a double that
   answers each home its own list; that two real homes CAN answer different lists is measured from
   the providers' own caches in the person's disposable homes (682's response §1), not in CI.
 * ⚠️ **The door never creating a never-run identity's folder** is `677` M18, re-aimed at 682, and is
   not repeated here.
 * ⚠️ **The rail's model and provider halves** are `677` M1, M2 and M38, re-aimed at 682.
"""

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RULE = "apps/desktop/src/shared/model-choice.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
SCHEMA = "apps/desktop/src/main/db/schema.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0045_a_persons_live_act_outranks_the_choice.sql"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · R31a and R31b in the rails and the rule ─────────────────────────────────────────────
    (
        "M1 · 🔴 R31a undone · the child's provider is the spawner's again, so a chosen identity runs "
        "its person's model on whatever provider its parent runs on · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R31a (a
        # person's chosen model/provider in force beats the spawner's) survives in the give rails:
        # `admitGive` in spawn-rails.ts still computes `inForce?.provider ?? itsProvider ??
        # giving.provider`. The plant removes the in-force term, so the child runs on its giver's
        # provider again. Killed by `the-model-a-person-chose.test.ts`,
        # `a-persons-choice-holds-the-whole-launch.test.ts`.
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the start's provider is the agent's own first (theProviderAStartRunsOn), then its default's, the named model's and the giver's. The plant drops the default's provider.
            (RAILS, "  return chosen?.provider ?? theNamedModels ?? giving.provider\n", "  return theNamedModels ?? giving.provider\n"),
        ],
    ),
    (
        "M2 · 🔴 R31b's rule gone · every choice is in force, so a contradiction written before 682 holds "
        "the launch and the door takes a choice for another provider · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(RULE, "  return itsProvider === null || choice.provider === itsProvider\n", "  return true\n")],
    ),
    (
        "M3 · ⛔ an identity with NO provider of its own takes no choice · the door refuses a choice for "
        "either provider, and a choice made for it holds nothing · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(RULE, "  return itsProvider === null || choice.provider === itsProvider\n", "  return choice.provider === itsProvider\n")],
    ),
    (
        "M4 · 🔴 a stand-in's verdict is never judged again · the rails hand the launch nothing to ask, so "
        "a choice BroBot's list admitted is sent to a home whose own list refuses it · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(RAILS, "    toJudgeAgain: inForce.standIn === null ? null : inForce,\n", "    toJudgeAgain: null,\n")],
    ),
    (
        "M5 · 🔴 a WAKE applies a choice that is not in force · a contradiction written before 682 moves "
        "a conversation on its own provider onto a choice no door could write now · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚑ (`677` M7, re-aimed at 682, now plants *not said* at the spawn; this is the wake's half.)
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) moved the not-in-force check out of the wake's choice fold and into R1's theSelectedPairIfNamed. A wake reaches it whenever its row names nothing. The plant lets a pre-682 contradiction (identity on Codex, choice for Claude) move a Claude conversation onto that choice. Killer §4 'D-042 · R1 — a wake whose row names NOTHING names R1's pair' expects ['default','medium'], and the mutant sends 'wide'/'high'. the-model-a-person-chose.test.ts ('a default NOT IN FORCE is read by nothing') should go RED too.
        # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the pair reads the provider the agent runs on (itsProvider) instead of the raw column.
        [(HOST, "      itsDefault.provider === provider &&\n      aChoiceIsInForce(itsDefault, this.itsProvider(profileSlug).provider)\n    ) {\n", "      itsDefault.provider === provider\n    ) {\n")],
    ),
    (
        "M6 · ⚠️ the not-in-force sentence loses its reason · it says the choice was not used without "
        "saying it is not the agent's own provider · killed by `the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042: the not-used sentence now explains another provider for the model the giver named (whatItRunsOnSaid's another-provider case); the reason is dropped as before (W4.78 reviewer disagreed with retiring it)
        [(TOOLS, "`It runs ${pair}: the conversation that took its place runs on ${PROVIDER_NAME[runsOn.provider]}, ${unused}.`", "`It runs ${pair}: ${unused}.`")],
    ),
    # ── §B · the two person doors, and the store under them ──────────────────────────────────────
    (
        "M7 · 🔴 R31b at the door gone · a choice for another provider than the identity's own is saved, "
        "and holds its next spawn there · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    if (!aChoiceIsInForce(choice, itsProvider)) {\n", "    if (false) {\n")],
    ),
    (
        "M8 · 🔴 a provider move leaves the choice · `setAgentProvider` writes the new provider and keeps a "
        "choice for the old one — the contradiction R31b rules no door may leave · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(STORE, "      if (choice !== null && choice.provider !== provider) {\n", "      if (false) {\n")],
    ),
    (
        "M9 · ⛔ clearing the provider clears the choice · *nobody has said* is read as another provider, "
        "so a person taking the provider back also loses their model · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(STORE, "      if (provider === null) return true\n", "")],
    ),
    (
        "M10 · ⚠️ the answer does not say what it cleared · the choice is gone and the person pressing "
        "the provider control is told nothing · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const cleared = before !== null && this.deps.store.modelChoiceOf(profileSlug) === null\n", "    const cleared = false\n")],
    ),
    (
        "M11 · ⚠️ inbox 10 · `setAgentProvider` announces nothing · a second window goes on drawing the old "
        "provider and a choice that no longer exists · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    // would otherwise draw the old provider — and, now, a choice that no longer exists.\n    this.theWorldMoved('agents')\n", "    // would otherwise draw the old provider — and, now, a choice that no longer exists.\n")],
    ),
    (
        "M12 · ⚠️ inbox 10 · `setCapabilities` announces nothing · a second window draws grants a spawn no "
        "longer reads · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    // nothing, so there is nothing to tell.\n    this.theWorldMoved('agents')\n", "    // nothing, so there is nothing to tell.\n")],
    ),
    (
        "M13 · 🔴 a confirmed verdict writes over a person's newer choice · the compare-and-set compares "
        "nothing, so a launch confirming yesterday's choice overwrites the one a person saved since · "
        "killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(STORE, "      if (held?.model_choice !== modelChoiceWritten(judged)) return false\n", "")],
    ),
    (
        "M14 · ⚠️ a confirmed verdict is not announced · a sheet goes on saying the choice was checked "
        "only against BroBot's list · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    if (this.deps.store.confirmModelChoice(folder, judged)) this.theWorldMoved('agents')\n", "    this.deps.store.confirmModelChoice(folder, judged)\n")],
    ),
    # ── §C · R31d ─────────────────────────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 the saved choice forgets whose list judged it · a never-run identity's choice is stored "
        "as its own home's verdict, so no launch ever judges it again · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const standIn = own === undefined ? STAND_IN_PROFILE : null\n", "    const standIn = null\n")],
    ),
    (
        "M16 · 🔴 R31d's menu gone · the `models` read answers a never-run agent `no-profile` again, and "
        "the control has nothing to draw · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const standIn = this.hasNeverRun(profileId) ? STAND_IN_PROFILE : null\n", "    const standIn = null\n")],
    ),
    (
        "M17 · ⛔ a name somebody is typing is an agent · the identity-row check goes, so a launcher's "
        "half-typed name is answered BroBot's list as though an agent by that name existed · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    if (this.deps.store.capabilitiesOf(profileSlug) === null) return false\n    const folded = foldProfileName(profileSlug)\n    return !this.profiles()", "    const folded = foldProfileName(profileSlug)\n    return !this.profiles()")],
    ),
    (
        "M18 · ⚠️ a stand-in's list is not marked · the menu for a never-run agent reads as its own "
        "home's answer · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — the mark is on `providerModels`' one catalogue now.
        [(HOST, "      standIn !== null && one.ok ? { ...one, standIn } : one,\n", "      one,\n")],
    ),
    (
        "M19 · 🔴 the launch never asks its own list · the stand-in's verdict goes to the provider unjudged "
        "· killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const toJudgeAgain = spawn?.runsOn.toJudgeAgain ?? null\n", "    const toJudgeAgain = null\n")],
    ),
    (
        "M20 · 🔴 a refused choice is SENT anyway · its own list refused the model, and the launch asks "
        "the provider for it regardless · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const model = setAside ? undefined : input.model\n", "    const model = input.model\n")],
    ),
    (
        "M21 · ⛔ half a refused choice is sent · the model is set aside and the effort chosen beside it "
        "still goes — a pair nobody checked · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const reasoningEffort = setAside ? undefined : input.reasoningEffort\n", "    const reasoningEffort = input.reasoningEffort\n")],
    ),
    (
        "M22 · 🔴 the conversation says nothing · a set-aside choice leaves no row on the conversation, so "
        "a reader takes it to be running the person's model · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "        if (judgedAgain?.verdict === 'set-aside') {\n          this.publishOurs(\n            registered,\n", "        if (false) {\n          this.publishOurs(\n            registered,\n")],
    ),
    (
        "M23 · 🔴 the spawner is told the choice ran · a set-aside launch answers as though the person's "
        "model were sent · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "        : judgedAgain.verdict === 'set-aside'\n", "        : false\n")],
    ),
    (
        "M24 · 🔴 its own list's refusal is not a refusal · every choice a stand-in admitted is confirmed "
        "whatever the identity's own home answers · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const wrong = judgeModelChoice(judged, catalogue.models)\n    if (wrong !== null) {\n", "    const wrong = judgeModelChoice(judged, catalogue.models)\n    if (false) {\n")],
    ),
    (
        "M25 · ⚠️ the answer drops what its own list said · a set-aside or an unasked list is not in "
        "`spawn_agent`'s answer · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(TOOLS, "  said.push(...whatItsOwnListSaid(runsOn.judgedAgain, 'it runs on the provider’s default model'))\n", "")],
    ),
    (
        "M26 · ⚠️ the transcript draws nothing · `model_choice_set_aside` is folded to no row, so the "
        "conversation a person reads does not say it · killed by `transcript.test.ts`",
        [(TRANSCRIPT, "    case 'model_choice_set_aside':\n      state.items.push({\n", "    case 'model_choice_set_aside':\n      return\n      state.items.push({\n")],
    ),
    # ── §D · the wake — R31c, inbox 4 and 5, and R31d there ───────────────────────────────────────
    (
        "M27 · 🔴 R31c undone · a give naming another pair overwrites a model a PERSON set live on a "
        "conversation they claimed · killed by `a-give-keeps-the-model-a-person-set-live.test.ts` "
        "(named by W4.91)",
        # ⚑ **W4.91** — it survived W4.78: a wake replays the row whether a person stamped it or not, so
        # the wake test named before could not see the guard. The give is where it decides now.
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 moved the person-set-live guard from the wake to the give: a give that names another model now leaves a pair a person chose (switchedFor); dropping the guard lets a give overwrite it (reviewer's re-anchor) (W4.78 reviewer disagreed with retiring it)
        [(HOST, "    if (this.deps.store.whatItRunsOn(conversation)?.aPersonChoseItAt != null) {\n      return 'a-person-chose-it'\n    }\n", "")],
    ),
    (
        "M28 · 🔴 a person's live MODEL is not recorded as theirs · the live-change door writes the model "
        "and no stamp, so the next wake takes it back · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "        // is a claim this line keeps. ⛔ After the write, and only once the provider took it.\n        this.record(session, () =>\n          this.deps.store.aPersonSetItsModelOrEffort(sessionId, this.now()),\n        )\n", "        // is a claim this line keeps. ⛔ After the write, and only once the provider took it.\n")],
    ),
    (
        "M29 · ⚠️ a person's live EFFORT is not recorded as theirs · the pair is overwritten at the next "
        "wake · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "        // 🔴 **682 · `R31c`**, as the model arm above.\n        this.record(session, () =>\n          this.deps.store.aPersonSetItsModelOrEffort(sessionId, this.now()),\n        )\n", "        // 🔴 **682 · `R31c`**, as the model arm above.\n")],
    ),
    (
        "M30 · ⛔ the stamp is never read back · the row carries it and the reopen sees NULL · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(STORE, "      modelOrEffortSetByAPersonAt: row.model_or_effort_set_by_a_person_at,\n", "      modelOrEffortSetByAPersonAt: null,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row plants a defect in the WAKE's
        # own tool-answer text (`whatAWakeRunsOnSaid`, called from `agent-tools.ts`'s wake handler).
        # D-017 commit 3 deliberately removed `resume_agent` ("end_agent and resume_agent are gone
        # (21 tools)"), and with it any tool call that returns a runsOn sentence for a restart —
        # `whatAWakeRunsOnSaid` no longer exists anywhere in the tree, and `message_agent` (which
        # now starts a stopped conversation) returns no such text. The row's own killer test file
        # says so directly: "D-017: the waker's answer, which said it too, went with `resume_agent`"
        # (a-persons-choice-holds-the-whole-launch.test.ts, e.g. near the `R31d on a wake` cases),
        # and now checks only the provider call and the conversation's `model_choice_set_aside`
        # event, never a returned answer. Its anchor is left stale, so the census records it
        # retired.
        "M31 · 🔴 inbox 4 · a wake's answer says nothing of the choice · `resume_agent` answers as before "
        "682 whatever the reopen did with a person's choice · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(TOOLS, "              const runsOn = whatAWakeRunsOnSaid(outcome.runsOn)\n", "              const runsOn = ''\n")],
    ),
    (
        "M32 · 🔴 inbox 5 · a chosen model's effort is left to the thread · nothing is sent, and a Codex "
        "thread keeps the effort it last ran — one nobody chose for this model · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) rewrote the wake: a recorded model with no effort now goes through theSelectedModel's model-named-alone branch, which looks up that model's own default effort (theEffortOfAModelNamedAlone). The plant hands back no effort, so the resume sends none and the thread keeps the effort it last ran. Killer §4 'inbox 5 · a recorded model whose effort was left to the provider is SENT that model's own default' still asserts it (expects resume effort 'medium' and records it).
        [(HOST, "      return { model: named.model, effort, from: 'named' }\n", "      return { model: named.model, effort: null, from: 'named' }\n")],
    ),
    (
        "M33 · ⚠️ inbox 5 · the row says NULL while an effort runs · the effort the provider reported "
        "keeping is not recorded · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042 · R5) moved where the reported effort is kept. It no longer overwrites reasoning_effort: recordWhatItReportsRunning keeps it in reported_effort beside the selected pair. The plant drops the reported effort, so the row says NULL while an effort runs. Killer §4 'inbox 5 → D-042 · R5 · what the provider REPORTS is kept' still expects reported_effort 'xhigh'.
        [(HOST, "    const effort = info?.reasoningEffortReported === true ? (info.reasoningEffort ?? null) : null\n", "    const effort: string | null = null\n")],
    ),
    (
        "M34 · 🔴 R31d on a wake · a stand-in's verdict its own list refuses is applied to the resume "
        "anyway · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    if (judgedAgain?.verdict === 'set-aside') {\n      // 🔴 **…and never re-sends", "    if (false) {\n      // 🔴 **…and never re-sends")],
    ),
    # ── §E · the rest ─────────────────────────────────────────────────────────────────────────────
    (
        "M35 · 🔴 inbox 9 · a Claude machine login that is unavailable reads `closing` again · the app "
        "says it is quitting about a person who is not signed in · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚑ **710 · re-anchored in place, not retired** — `710`'s review routed this `detail` through `howAFailureReads`; the row still reads an unavailable login as `closing`.
        [(HOST, "      console.warn(`model list for ${provider} unavailable: ${errorMessage(error)}`)\n      return { ok: false, reason: 'refused', detail: this.howAFailureReads(error) }\n    }\n    let launch: Launch | null = null\n", "      console.warn(`model list for ${provider} unavailable: ${errorMessage(error)}`)\n      return { ok: false, reason: 'closing' }\n    }\n    let launch: Launch | null = null\n")],
    ),
    (
        "M36 · 🔴 inbox 8 · `list_profiles` carries no choice · a spawner learns a person's model only by "
        "meeting the rail · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 · R6 renamed list_profiles' `a_person_chose` to `default_model` (report.defaultModel); same field. Killer: a-persons-choice-holds-the-whole-launch.test.ts:1115.
        [(TOOLS, "            ...(report.defaultModel === null ? {} : { default_model: report.defaultModel }),\n", "")],
    ),
    (
        "M37 · ⚠️ inbox 8 · a contradiction is listed as in force · the listing names a choice no launch "
        "will read · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the listing asks whether the default is in force against the provider the agent runs on.
        [(HOST, "          chosen !== null && aChoiceIsInForce(chosen, runsOn)\n", "          chosen !== null\n")],
    ),
    (
        "M38 · ⚠️ the sentence beside the control forgets R31a · it no longer says a spawn cannot pick "
        "another provider or model · killed by `the-model-a-person-chose.test.ts`",
        [(RULE, "    'and cannot pick another provider or model. ' +\n", "")],
    ),
    (
        "M39 · ⚠️ the door's refusal loses its act · `not-its-provider` no longer starts with what to "
        "choose · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(RULE, "    `Choose a ${detail.itsProvider === undefined ? 'model on its own provider' : `${PROVIDER_NAME[detail.itsProvider]} model`}: ` +", "    `That choice is refused: ` +")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Its subject (a 'N foreign
        # keys point here' sentence on `agent_identity` in schema.ts, held to the snapshot) was
        # removed on purpose: 5e931be8 says 'The database is ONE migration, 0000_the_tree, on a
        # fresh file only', and the sentence is gone from schema.ts. The test header records it: '§7
        # · gone at D-016 commit 3 — the database is ONE migration … and `schema.ts` no longer
        # states a foreign-key count to hold to the snapshot.' Its anchor is left stale, so the
        # census records it retired.
        "M40 · ⚠️ inbox 12 · a foreign-key count goes stale again · a sentence on `agent_identity` states "
        "a number the snapshot does not hold · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(SCHEMA, "`DROP TABLE` in it, and six foreign keys point here now.", "`DROP TABLE` in it, and four foreign keys point here now.")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Its subject was
        # `0045_…sql`'s ALTER on `provider_session`, and every migration 0001-0042 and 0045 went in
        # the single-migration reset (5e931be8: 'The database is ONE migration, 0000_the_tree').
        # `migrations/` now holds only 0000_the_tree.sql and meta/, and the test header says
        # `0045`'s ALTER 'went with the history'. Its anchor is left stale, so the census records it
        # retired.
        "M41 · ⚠️ `0045` grows a CHECK · a constraint on an existing table, which drizzle turns into a "
        "rebuild · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(MIGRATION, "ALTER TABLE `provider_session` ADD `model_or_effort_set_by_a_person_at` integer;", "ALTER TABLE `provider_session` ADD `model_or_effort_set_by_a_person_at` integer CHECK (`model_or_effort_set_by_a_person_at` > 0);")],
    ),
    (
        "M42 · 🔴 R31b raced · the door checks the provider, awaits its list, and writes without asking "
        "again — a provider moved in between leaves the contradiction no door may leave · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    if (!aChoiceIsInForce(choice, itsProviderNow)) {\n", "    if (false) {\n")],
    ),
    (
        "M43 · 🔴 a wake asks for the refused pair again · a first launch that could not ask its own list "
        "recorded the stand-in's choice, and a wake whose own list refuses it replays the record · killed "
        "by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "      const recordedIsTheRefusedPair = (recordedModel ?? null) === saved.model\n", "      const recordedIsTheRefusedPair = false\n")],
    ),
    (
        "M44 · ⚠️ inbox 5 asks for nothing it can use · a thread that holds no effort is sent a probe "
        "child all the same, to look up a default nothing would send · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "      saved.model !== null && saved.effort === null && recordedEffort !== undefined\n", "      saved.model !== null && saved.effort === null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same removed mechanism as M31: the
        # row's `old` line is the WAKE's call to `whatItsOwnListSaid(runsOn.judgedAgain,
        # aWakeSetAsideInstead(...))` inside the tool-answer builder in `agent-tools.ts`. Today that
        # file has only ONE call to `whatItsOwnListSaid`, in the surviving spawn-only
        # `whatItRunsOnSaid`, and it always passes the literal string `'it runs on the provider's
        # default model'` — there is no second, wake-flavoured call site left to mutate.
        # `aWakeSetAsideInstead` still exists in `shared/model-choice.ts`, but its only caller now
        # is `runtime-host.ts`'s `aSetAsideRow`, which writes the `said` field straight onto the
        # `model_choice_set_aside` conversation event rather than into any tool's returned text — a
        # different mechanism the test file explicitly attributes to D-017 removing `resume_agent`'s
        # answer. Its anchor is left stale, so the census records it retired.
        "M45 · ⚠️ a wake's set-aside says a spawn's words · the waker is told the conversation runs on the "
        "provider's default when it resumes on its record · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        # ⚠️ **Anchor CORRECTED IN PLACE at round two** — the wake's words come from one composer now.
        [(TOOLS, "  said.push(...whatItsOwnListSaid(runsOn.judgedAgain, aWakeSetAsideInstead(runsOn, chose.provider)))\n", "  said.push(...whatItsOwnListSaid(runsOn.judgedAgain, 'it runs on the provider’s default model'))\n")],
    ),
    (
        "M46 · 🔴 a resume that names nothing is said to fall back to a default · measured false (677 D1): "
        "it continues on the model it last ran · killed by `a-persons-choice-holds-the-whole-launch.test.ts`",
        [(RULE, "'the model it last ran'", "'the provider’s own default'")],
    ),
    (
        "M47 · 🔴 a refused-pair wake blanks the row · it names nothing, the provider continues on the "
        "pair it last ran (677 D1/D2), and the row stops saying so · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(HOST, "    const movesTheRow = resumesOn === null || resumesOn.from === 'the-choice'\n", "    const movesTheRow = true\n")],
    ),
    (
        "M48 · ⚠️ a refused-pair wake does not say what continues · the answer and the row say it resumes "
        "on what it last ran, and never name the refused pair that runs · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(RULE, "  return resumed.continuesOn === undefined\n", "  return true\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Also the WAKE's own answer text: the
        # `runsOn.model === null && runsOn.effort !== null` conditional it mutates lived in the
        # removed wake-answer builder, not in the surviving `whatItRunsOnSaid` (spawn's answer),
        # which uses a differently-shaped `modelFrom === 'a-person'` / `effortFrom === 'a-person'`
        # check instead. The surviving effort-only-wake coverage
        # (`a-persons-choice-holds-the-whole-launch.test.ts`, "an effort-only choice is applied at a
        # wake, on the model it last ran") now asserts only `lastResume()` — the provider call —
        # never a returned sentence, matching the file's own note that the wake's answer "went with
        # `resume_agent`". Its anchor is left stale, so the census records it retired.
        "M49 · ⚠️ an effort-only wake says a person chose the MODEL · the model it last ran is attributed "
        "to the person who chose only an effort · killed by "
        "`a-persons-choice-holds-the-whole-launch.test.ts`",
        [(TOOLS, "            runsOn.model === null && runsOn.effort !== null\n", "            false\n")],
    ),
    (
        "M50 · ⚠️ the provisional clause says the agent HAS NEVER RUN · true only until its first run, "
        "and a person's own launch never clears `standIn` (`691`'s review) · killed by "
        "`an-agents-model-on-screen.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule this row
        # protects — the provisional clause must say *"had no list of its own when it was chosen"*,
        # never the time-bound *"has never run"* (691's review: `standIn` can outlive an agent's
        # first run) — is unchanged and still lives in `whatAModelChoiceReaches` in
        # `apps/desktop/src/shared/model-choice.ts`. Only the sentence's SECOND half moved, from "A
        # launch another agent starts or wakes asks..." to "A launch another agent causes asks...",
        # reflecting D-017's own words ("there is no wake; a delivery starts its recipient"). The
        # `old` string below is an exact, single-occurrence match in the current file.
        [
            (RULE, "      : ` It was checked against ${standIn}’s list because this agent had no list of its own when ` +\n        'it was chosen. A launch another agent causes asks this agent’s own list before ' +\n        'using it, and says so if that list does not offer it or cannot be asked.')\n", "      : ` It was checked against ${standIn}’s list because this agent has never run; its first ` +\n        'launch checks it again against its own, and says so if that list does not offer it.')\n"),
        ],
    ),
    (
        "M51 · ⚠️ the provisional clause is drawn for EVERY choice · a choice its own home judged is "
        "said to have been checked against another's list · killed by "
        "`an-agents-model-on-screen.test.ts`",
        [(RULE, "    (standIn === null\n", "    (false\n")],
    ),
]
