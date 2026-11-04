"""677 · each agent runs on the model and effort a person chose — what `677` newly carries.

⛔ **Ordered by the person's question** (*"when an agent is spawned, how and who decides what model and
effort level the agent is?"*) **and the PM's ruling R25**: a PERSON may set, per identity, the model
and effort its agent-started conversations run on; a spawner naming a different model is refused BY
NAME (`not-the-model-a-person-chose`); the choice is validated against the provider's own catalogue;
a spawn and a wake read the CURRENT choice; a person's own launch and Reopen do not.

## ⚠️ What a row here measures

 * ⚑ **M1–M10 and M38–M39, M42 are the rail and the spawn's resolution** in `spawn-rails.ts` — the
   refusal, its pair, the provider it reads, the empty argument, its permanence, its two sentences,
   and the whole-choice rule — killed by `the-model-a-person-chose.test.ts` §1.
 * ⚑ **M11, M31 and M32 are the spawn's launch**, killed by
   `a-spawn-reaches-the-provider-with-a-persons-model.test.ts` §1-§2 over the REAL adapters.
 * ⚑ **M12–M16, M33 and M40–M41 are the wake** in `runtime-host.ts`'s reopen, killed by the same file's
   §3 over a real host and `resume_agent`.
 * ⚑ **M17–M22, M34–M37 are the person's door** — existence before a probe, the never-run refusal,
   the catalogue's verdict, the shared memoized probe under the folder's spelling, the retry, the
   announcement, the person gate on both verbs, the wire's provider rule — killed by
   `the-model-a-person-chose.test.ts` §4 over a real host and `executeRuntimeCommand`.
 * ⚑ **M23–M25 are the rule** in `shared/model-choice.ts`, killed by §3's catalogues.
 * ⚑ **M26–M29 are the column and its fold**, killed by §4's read-back and §5.
 * ⚑ **M30 is the quit ruling**, killed by `shutdown-door.test.ts`.
 * ⚑ **M31–M42 were added for the review's first round**: the clauses it found without a row, and the
   whole-choice rule and the other-provider refusal it asked for. **M43–M46 for its second round**
   and for `spawn_agent`'s side, taken once `675` had landed: the answer that says what the child
   runs on, the `model` argument's sentence, the retry's scope, and the effort-only clause.

## ⛔ What this table cannot reach

 * 🔴 **What a PROVIDER does with the model it is handed.** Every row here is killed at our side of the
   seam — the SDK options, the JSON-RPC params, the row. What a resume with a changed model then RUNS
   on is `packages/runtime/smoke/{claude,codex}-resume-model-probe.smoke.ts`, run by hand, not in CI.
 * ⚠️ **The spawn rail's position relative to `unknown-profile` and the capacity rails** is asserted
   (§2) and is not a single-line edit, so it has no row: moving a rail is a block move.
 * ⚠️ **The whitespace half of M4** — a `'  '` model on an identity nobody chose for — reaches the
   provider as it did before `R25`; the row mutates the empty-string clause, which the tests kill, and
   the byte-identical control for whitespace is asserted rather than mutated.
"""

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
RULE = "apps/desktop/src/shared/model-choice.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0044_a_person_chooses_the_model.sql"
MIGRATION_0000_THE_TREE = "apps/desktop/src/main/db/migrations/0000_the_tree.sql"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):**
        # `not-the-model-a-person-chose` went with `spawn_agent` on purpose: the spawn-rails census
        # note reads 'a give names no model, provider or mode'. `giveRequestSchema` is `.strict()`
        # with no `model` key, and the rewritten test says 'a giver naming a model is refused by
        # name — the door takes no model at all'. `anotherModel` and `askedModel` are gone from
        # `spawn-rails.ts`, so a spawner's model cannot overrule a person's. Its anchor is left
        # stale, so the census records it retired.
        "M1 · 🔴 the rail is gone — a spawner's model overrules a person's · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the rail's model half is its own line since `R31a` added
        # the provider half beside it; the defect planted is unchanged.
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — the halves sit inside one `if (inForce !== null)` now (review).
        [(RAILS, "    const anotherModel = askedModel !== undefined && askedModel !== inForce.model\n", "    const anotherModel = false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The rail's comparison of the
        # asked model with the person's (`askedModel !== inForce.model`) went with the rail, since a
        # give names no model ('the door takes no model at all'). The a-refusal-carries-its-remedy
        # census records that `SPAWN_RAILS` lost `not-the-model-a-person-chose` with `spawn_agent`.
        # The anchor line no longer exists anywhere in `spawn-rails.ts`. Its anchor is left stale,
        # so the census records it retired.
        "M2 · ⛔ the rail refuses the SAME model and admits a stranger · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the comparison is `anotherModel`'s now.
        [(RAILS, "askedModel !== undefined && askedModel !== inForce.model\n", "askedModel !== undefined && askedModel === inForce.model\n")],
    ),
    (
        "M3 · 🔴 a choice for ANOTHER provider is read as this one's — a Codex model reaches a Claude child · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired, and the LABEL is untouched** (142's rule) — `R31a` made the
        # choice hold its provider, so the case left for "another provider" is a choice that contradicts
        # the identity's OWN provider (`aChoiceIsInForce`); this reads it as in force anyway.
        # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the start's provider is the agent's own first (theProviderAStartRunsOn), then its default's, the named model's and the giver's. The plant reads a default for another provider ahead of the agent's own.
        [(RAILS, "  if (its.provider !== null) return its.provider\n", "  if (its.provider !== null) return (known ? facts.modelChoiceOf(asked.profile) : null)?.provider ?? its.provider\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The empty-`model`
        # normalisation (`askedModel = asked.model === undefined || asked.model === '' ? undefined :
        # asked.model`) handled a spawner's `model` argument, which no longer exists. `.strict()`
        # refuses any `model` key as `malformed-request`, so an empty one is refused like any other.
        # Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ an EMPTY `model` meets the rail as a stranger model · killed by "
        "`the-model-a-person-chose.test.ts`",
        [(RAILS, "  const askedModel = asked.model === undefined || asked.model === '' ? undefined : asked.model", "  const askedModel = asked.model")],
    ),
    (
        "M5 · 🔴 the person's EFFORT is dropped from a spawn on their model · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — `onThisProvider` is `inForce` since `R31b`.
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — the resolver has one applied arm now.
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 removed spawn-rails' whatThisSpawnRunsOn; the person's default for an agent is now resolved by RuntimeHost.theSelectedPairIfNamed (R1). The plant drops its effort there. Killer: '🔴 THE PAIR · a give naming nothing starts on the agent's DEFAULT' (reasoningEffort 'high'). (moved from spawn-rails.ts)
        [("apps/desktop/src/main/runtime/runtime-host.ts", "      return { model: itsDefault.model, effort: itsDefault.effort, from: 'its-default' }\n", "      return { model: itsDefault.model, effort: null, from: 'its-default' }\n")],
    ),
    (
        "M6 · ⚠️ whose model it is is said wrong · killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — the resolver has one applied arm now.
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 replaced modelFrom 'a-person'|'nobody' with SelectedModel.from, set in RuntimeHost.theSelectedPairIfNamed; the plant credits the agent's default to the giver ('named' → 'the model you named'), as 'the-spawner' did. Killer: 'THE PAIR' expects runsOn.from 'its-default'. (moved from spawn-rails.ts)
        [("apps/desktop/src/main/runtime/runtime-host.ts", "      return { model: itsDefault.model, effort: itsDefault.effort, from: 'its-default' }\n", "      return { model: itsDefault.model, effort: itsDefault.effort, from: 'named' }\n")],
    ),
    (
        "M7 · 🔴 a choice passed over for another provider is not SAID · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — the passed-over provider is read where it is returned.
        [(RAILS, "      aChoiceForAnotherProvider: chosen === null ? null : chosen.provider,", "      aChoiceForAnotherProvider: null,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The price entry
        # `'not-the-model-a-person-chose': 'until-a-person-changes-it'` is gone with the rail.
        # a-refusal-carries-its-remedy.test.ts notes that `SPAWN_RAILS` 'lost `no-such-parent`,
        # `not-your-parent`, `not-the-model-a-person-chose`, `profile-already-live` and
        # `unknown-profile` with `spawn_agent`'. Its anchor is left stale, so the census records it
        # retired.
        "M8 · ⛔ the rail is priced `permanent` — a call one person's press unblocks · killed by "
        "`the-model-a-person-chose.test.ts`",
        [(RAILS, "  'not-the-model-a-person-chose': 'until-a-person-changes-it',", "  'not-the-model-a-person-chose': 'permanent',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The sentence 'Send this
        # again without model and it starts on...' belonged to the removed rail's `describeRail`
        # arm. Its rewritten test only asserts the `.strict()` `malformed-request` refusal that
        # names the `model` key. There is no rail for its act to be lost from. Its anchor is left
        # stale, so the census records it retired.
        "M9 · ⛔ the sentence loses its act — the caller is not told to drop the argument · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — the sentence names a model left to the provider too now.
        [(RAILS, "        ? `Send this again without model and it starts on ` +", "        ? `This spawn names a model: it would start on ` +")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The refusal detail `{
        # profileId, askedModel, chosenModel }` was the removed rail's. `SpawnRefusalDetail` and
        # `describeRail` keep no `askedModel`/`chosenModel`, and a give has no asked model to
        # compare with the person's. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the refusal names the ASKED model as the person's · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the detail's model is named once above the arms now.
        [(RAILS, "      ? { profileId: asked.profileId, askedModel, chosenModel }", "      ? { profileId: asked.profileId, askedModel, chosenModel: askedModel }")],
    ),
    (
        "M11 · 🔴 the spawn's launch loses the person's effort — the SDK options carry none · killed "
        "by `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a person's effort for the identity is carried into the SDK/JSON-RPC launch
        # options through the give. The line moved from `spawn_agent` (`admitted.runsOn`) to
        # `giveWork`'s `createSession` call (`start.runsOn`). The test file was rewritten around
        # `give_work` and still measures over the real Claude and Codex adapters. The plant deletes
        # the `reasoningEffort` spread. Killed by
        # `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) replaced start.runsOn with startsOn (the give's choice, or R1's pair). Without the effort, createSession resolves the model alone at its row default. Killer still holds: §2 CODEX expects terra at high (it would get medium) and listed('builder') at 0.
            (HOST, "        ...(startsOn?.effort == null ? {} : { reasoningEffort: startsOn.effort }),\n", ""),
        ],
    ),
    (
        "M12 · 🔴 a wake replays the recorded model instead of the person's CURRENT choice · killed by "
        "`a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The old call-site
        # (`resumeSession(..., 'as-its-identity-is-now')`) was refactored into `startForADelivery`,
        # D-017's single start door, which now passes `waker === null ? 'as-recorded' :
        # 'as-its-identity-is-now'` — `as-recorded` for a delivery nobody agent-caused,
        # `as-its-identity-is-now` for an agent's own wake (`resume_agent`, still routed through
        # this same door). The rule the row pins (a wake must read the person's CURRENT model
        # choice, not the recorded one) survives unchanged at this new site.
        [
            (HOST, "        waker === null ? 'as-recorded' : 'as-its-identity-is-now',\n      )\n", "        waker === null ? 'as-recorded' : 'as-recorded',\n      )\n"),
        ],
    ),
    (
        "M13 · 🔴 a wake reads a choice for ANOTHER provider · killed by "
        "`a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the wake's arms are `whatThisWakeResumesOn`'s since 682; this drops the
        # other-provider arm, so a Codex choice reaches a Claude conversation's resume.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) folded the wake's own read into R1 (theSelectedPairIfNamed), which a wake reads for a row that names nothing. Without the provider test, a Codex default is read at a Claude wake: the identity's provider is null, so aChoiceIsInForce does not stop it. Killer: '⛔ a default for ANOTHER provider is not read by R1 at the wake of a Claude conversation'.
        [(HOST, "      itsDefault.provider === provider &&\n", "")],
    ),
    (
        "M14 · ⛔ a PERSON's Reopen reads the identity's choice too (`R25` §1.4) · killed by "
        "`a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the choice is read in `whatThisWakeResumesOn`, asked only for a wake.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) removed the modelAndEffort switch: every reopen, a person's included, replays the row. Dropping the recorded model from reopenSession's resolution makes it read the identity's default again. This is broader than the old 'person only' plant, because the agent/person split is gone. Killer: '⛔ a PERSON's Reopen replays the row too' (expects haiku, would get opus).
        [(HOST, "      ...(recordedModel === undefined ? {} : { model: recordedModel }),\n", "")],
    ),
    (
        "M15 · ⚠️ a wake that moved the model leaves the row saying the old one · killed by "
        "`a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **Anchor CORRECTED IN PLACE BY 682, round two** — the write is gated on a wake that took the
        # choice (`movesTheRow`); the defect (the row left behind) is unchanged.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) dropped `movesTheRow &&`: reopenSession writes the model back whenever this start named another one than the row (R1 filling an empty row). Killer: '⚑ …and an agent's default IS sent … and records it' expects rowOf model opus.
        [(HOST, "    if (model !== recordedModel) {\n", "    if (false) {\n")],
    ),
    (
        "M16 · ⛔ a wake ignores the person's EFFORT · killed by "
        "`a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the reopen reads the wake's resolution as `resumesOn` now.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) replaced `resumesOn` with theSelectedModel's `selected`. The second line pins the anchor to reopenSession, since createSession has the same first line with input.provider. A wake of an empty row then sends R1's model without its effort. The '…an agent's default IS sent' test expects reasoningEffort 'high'.
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the runtime is now made before the model is chosen, so the line after the effort is no longer the runtime's; the anchor takes the recorded-effort lines above it instead, and the plant still sends the recorded effort at a wake rather than the chosen one
        [(HOST, "      ...(recordedEffort === undefined ? {} : { effort: recordedEffort }),\n    })\n    const model = selected.model\n    const reasoningEffort = selected.effort ?? undefined\n", "      ...(recordedEffort === undefined ? {} : { effort: recordedEffort }),\n    })\n    const model = selected.model\n    const reasoningEffort = recordedEffort\n")],
    ),
    (
        "M17 · 🔴 the door asks the provider BEFORE asking whether the identity exists — a folder with "
        "no identity is probed · killed by `the-model-a-person-chose.test.ts`",
        [(HOST, "    if (this.deps.store.capabilitiesOf(profileSlug) === null) {\n      return refuseModelChoice('no-such-agent', said)\n    }\n", "")],
    ),
    (
        "M18 · 🔴 an identity that never ran is probed — a provider child for a name with no folder · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — `R31d` replaced the refusal with a stand-in's list; the rule this row
        # keeps is the one under it — the door never makes a never-run identity's folder — and this
        # plants asking in its OWN home, which would.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) routed the door through theListFor → providerModels, where the stand-in is chosen (askIn). Planting at `standIn` itself is caught by the no-profile guard and spawns nothing. Probing under profileId spawns a child in the never-run name's folder. Killer: '682 · R31d — an identity that has NEVER RUN … its own folder is not made'.
        [(HOST, "    return this.modelsAskedAgainIfTheyFailed(provider, askIn).then((one) =>\n", "    return this.modelsAskedAgainIfTheyFailed(provider, profileId).then((one) =>\n")],
    ),
    (
        "M19 · 🔴 the catalogue's verdict is ignored — any model and any effort is saved · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) split judgeModelChoice's single verdict into the listed-row test and judgeAgainstTheList in setAgentModelAndEffort. The replacement removes both refusals, so any model and any effort is saved. Killers: 'a model the provider did not list is REFUSED' and 'an effort the model does not list is REFUSED'.
        [(HOST, "    if (row === undefined || (list.notAsked !== null && row.addedBy === 'a-person')) {\n      return list.notAsked === null\n        ? refuseModelChoice('model-not-offered', about)\n        : refuseModelChoice('models-unavailable', {\n            ...about,\n            ...(list.notAsked.reason === 'refused' ? { why: list.notAsked.detail } : {}),\n          })\n    }\n    // ⚑ A blank effort is the model's own default — ⛔ refused where nothing names one it offers.\n    const effort = choice.effort ?? theEffortWhenNoneIsNamed(row, list.rows)\n    // ⚑ Saved as the list spells the model, however it was named.\n    const pair =\n      effort === undefined ? null : { model: theListsSpelling(row, choice.model), effort }\n    if (pair === null || judgeAgainstTheList(list.rows, pair) !== null) {\n      return refuseModelChoice('effort-not-offered', { ...about, offered: theEffortsOf(row) })\n    }\n", "    const effort = choice.effort ?? theEffortWhenNoneIsNamed(row, list.rows) ?? null\n    const pair = { model: row === undefined ? choice.model : theListsSpelling(row, choice.model), effort }\n")],
    ),
    (
        "M20 · ⚠️ the door spawns its own probe instead of the memoized one · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — the door's one call into the probe is now the shared helper's, and
        # the row still makes THIS door spawn a probe the memo never sees (and no other door).
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042): the door now reaches the memo only through providerModels, which the window's `models` read shares, so the plant bypasses the memo for both. Killer: 'the catalogue is the models read's: asked once' expects no second child.
        [(HOST, "    return this.modelsAskedAgainIfTheyFailed(provider, askIn).then((one) =>\n", "    return this.askProviderForModels(provider, askIn).then((one) =>\n")],
    ),
    (
        "M21 · 🔴 the door is open to a channel no person is behind · killed by "
        "`the-model-a-person-chose.test.ts`",
        [(IPC, "      requireAPerson(sink, command.kind)\n      return host.setAgentModelAndEffort(", "      return host.setAgentModelAndEffort(")],
    ),
    (
        "M22 · ⛔ a model with no provider beside it passes the wire · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 rewrote the refine as a ternary on provider (a provider also needs a model); the plant lets a model or effort with no provider pass the wire. Killer: the-model-a-person-chose.test.ts:786-791.
        [(IPC, "          ? command.model === null && command.effort === null\n", "          ? true\n")],
    ),
    (
        "M23 · 🔴 with no model named, the efforts are POOLED — a level the default may not take · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 removed the no-model intersection (effortsAChoiceMayName) with the effort-only default; an effort named without a model is now judged in model-rails.ts' judgeAnAgentsChoice against the row it would run on. The plant pools the provider's whole ladder exactly when no model is named. Killer: the-model-a-person-chose.test.ts:355 ('never the menu's pool': luna + ultra refused). (moved from model-choice.ts)
        [("apps/desktop/src/main/runtime/model-rails.ts", "  const efforts = row === undefined ? ladder : theEffortsOf(row)\n", "  const efforts = row === undefined || asked.model === undefined ? ladder : theEffortsOf(row)\n")],
    ),
    (
        "M24 · 🔴 an undescribed model takes every level its neighbours take · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 moved the 'an undescribed row offers none' rule into the parameterless helper theEffortsOf, which has no list in scope; the plant gives an undescribed row the list's whole ladder in judgeAgainstTheList (the person's verdict). Killer: the-model-a-person-chose.test.ts:335 (haiku+high is effort-not-offered).
        [(RULE, "  const efforts = theEffortsOf(row)\n  if (choice.effort === null", "  const efforts = row.efforts === undefined ? theEffortLadder(list) : theEffortsOf(row)\n  if (choice.effort === null")],
    ),
    (
        "M25 · ⛔ a model the catalogue does not list is admitted · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 rewrote the catalogue check as judgeAgainstTheList (theListedRow by id or alias); the plant admits a model no row lists. Killer: the-model-a-person-chose.test.ts:326 (sonnet-9 is model-not-offered).
        [(RULE, "  if (row === undefined) return 'model-not-offered'\n", "  if (false) return 'model-not-offered'\n")],
    ),
    (
        "M26 · 🔴 an unreadable provider keeps its model — the fold that could cross providers · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 rewrote parseModelChoice: the line after the provider guard is now `const model = said['model']`; same guard. Killer: §5 fold case ({provider: gemini, model: opus} is null).
        [(STORE, "  if (provider === null) return null\n  const model = said['model']\n", "  const model = said['model']\n")],
    ),
    (
        "M27 · ⚠️ a choice of nothing reads as a choice · killed by `the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 folded 'a choice of nothing' into the model guard (a default with no model is NULL); the plant lets a null or blank model through, so {claude, null, null} reads as a choice. Killer: §5 fold case ('a choice of nothing is no choice').
        [(STORE, "  if (typeof model !== 'string' || model.trim() === '') return null\n", "  if (typeof model !== 'string' && model !== null) return null\n")],
    ),
    (
        "M28 · ⚠️ the reader stops folding the slug — `Worker` and `worker` are two identities · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — 682's provider transaction reads the column the same way, so the anchor
        # names the reader it was written for.
        [(STORE, "const row = spawnSql().readModelChoice.get(foldProfileName(profileSlug))", "const row = spawnSql().readModelChoice.get(profileSlug)")],
    ),
    (
        "M29 · 🔴 `0044` backfills a model — the app choosing on every person's behalf · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (0044 backfills a model, the app choosing on a person's behalf) lost its
        # migration: D-016 folded migrations into 0000_the_tree.sql. The rule survives as the
        # column's absence of a default: agent_identity.model_choice is NULL until a person chooses,
        # and ensureIdentityRow (INSERT OR IGNORE INTO agent_identity (id, slug, display_name,
        # provider, created_at, created_by)) omits it. Plant: give model_choice a DEFAULT of
        # {"provider":"claude","model":"opus","effort":null}, so every new identity row carries a
        # model nobody chose. Killers: the-model-a-person-chose.test.ts asserts
        # store.modelChoiceOf('worker') toBeNull() after anAgent('worker');
        # a-persons-choice-holds-the-whole-launch.test.ts asserts null read-backs. The pinned line
        # is the tab-indented column line only. Killed by `the-model-a-person-chose.test.ts`,
        # `a-persons-choice-holds-the-whole-launch.test.ts`.
        [
            (MIGRATION_0000_THE_TREE, '\t`model_choice` text,\n', '\t`model_choice` text DEFAULT \'{"provider":"claude","model":"opus","effort":null}\',\n'),
        ],
    ),
    (
        "M30 · ⚠️ a person's model choice is answered during a quit · killed by `shutdown-door.test.ts`",
        [(IPC, "  setAgentModelAndEffort: 'refused',\n", "  setAgentModelAndEffort: 'answered',\n")],
    ),
    (
        "M31 · 🔴 round 1 · the spawn's launch loses the person's MODEL — the SDK options carry none · "
        "killed by `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a person's model is carried into the launch options of the conversation a give
        # starts. The line moved from `admitted.runsOn.model` to `start.runsOn.model` in
        # `giveWork`'s `createSession` call. The killer test was rewritten around `give_work` and
        # still measures both real adapters. The plant deletes the `model` spread. Killed by
        # `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) replaced start.runsOn with startsOn. Without the model, createSession re-resolves R1. A give-named model is lost: the wake CONTROL's haiku becomes default/medium. A default's pair is re-derived, but that asks the list, so §2 CODEX's listed('builder') (expected 0) goes red.
            (HOST, "        ...(startsOn === null ? {} : { model: startsOn.model }),\n", ""),
        ],
    ),
    (
        "M32 · 🔴 round 1 · the host hands the rails no choice — the feature cut off at the host · "
        "killed by `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        [(HOST, "      modelChoiceOf: (profileSlug) => this.deps.store.modelChoiceOf(profileSlug),", "      modelChoiceOf: () => null,")],
    ),
    (
        "M33 · ⚠️ round 1 · a wake that moved the EFFORT leaves the row saying the old one · killed by "
        "`a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — since finding 5 the row records the effort that RUNS (`effortItRuns`).
        # ⚠️ **Anchor CORRECTED IN PLACE BY 682, round two** — the write is gated on a wake that took the
        # choice (`movesTheRow`); the defect (the row left behind) is unchanged.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) dropped `movesTheRow &&` and compares nullably. The effort write-back after a start that moved it is skipped. The '…an agent's default IS sent … and records it' test expects rowOf reasoning_effort 'high'.
        [(HOST, "    if ((reasoningEffort ?? null) !== (recordedEffort ?? null)) {\n", "    if (false) {\n")],
    ),
    (
        "M34 · 🔴 round 1 · the READ is open to a channel no person is behind · killed by "
        "`the-model-a-person-chose.test.ts`",
        [(IPC, "      requireAPerson(sink, command.kind)\n      return host.agentModelAndEffort(", "      return host.agentModelAndEffort(")],
    ),
    (
        "M35 · ⚠️ round 1 · a save is not announced — a second window draws the old choice · killed by "
        "`the-model-a-person-chose.test.ts`",
        [(HOST, "    this.theWorldMoved('agents')\n    return { ok: true, choice: this.deps.store.modelChoiceOf(profileSlug) }", "    return { ok: true, choice: this.deps.store.modelChoiceOf(profileSlug) }")],
    ),
    (
        "M36 · 🔴 round 1 · a cached FAILURE is never asked again — one blip refuses for the app's life · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — the re-ask is `modelsAskedAgainIfTheyFailed`'s now; the row takes
        # THIS door past it to the bare memo, so a cached failure is never asked again from a Save.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042): the door asks through providerModels, the one call to modelsAskedAgainIfTheyFailed on its path. Using the bare memo leaves a cached failure cached. Killer: '⚠️ a cached FAILURE is asked once more on the next Save'.
        [(HOST, "    return this.modelsAskedAgainIfTheyFailed(provider, askIn).then((one) =>\n", "    return this.probeModelsFor(provider, askIn).then((one) =>\n")],
    ),
    (
        "M37 · ⚠️ round 1 · the door asks under the SLUG, not the folder's spelling — a second child per "
        "Save · killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — the door's one call into the probe is now the shared helper's.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042): the folder-spelling lookup is now `own` in theListFor. Asking under the slug no longer pays a second child. providerModels' exact-name guard answers no-profile, so the Save is refused models-unavailable: the same plant, a different symptom. Killer: 'the catalogue is the models read's: asked once, and under the FOLDER's own spelling' expects ok.
        [(HOST, "    const catalogue = await this.providerModels(own, provider).catch((): ModelCatalogue => ({\n", "    const catalogue = await this.providerModels(profileId, provider).catch((): ModelCatalogue => ({\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The rail's `anotherProvider`
        # half (`asked.provider !== inForce.provider`) went with the spawner's `provider` argument.
        # `giveRequestSchema` has 'no provider, model or approval arguments (plan ruling 3)', and
        # `.strict()` refuses the key as `malformed-request`. The provider is now decided by a
        # person's choice, then the agent's own, then the giver's. Its anchor is left stale, so the
        # census records it retired.
        "M38 · 🔴 round 1 · naming `provider` walks past the rail — a spawner's model on another provider · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — `R31a` refuses the provider itself now, on its own line; this lets a
        # spawner's `provider` past the rail again.
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — inside the one `if (inForce !== null)`.
        [(RAILS, "    const anotherProvider = asked.provider !== undefined && asked.provider !== inForce.provider\n", "    const anotherProvider = false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** This planted a spawner-named
        # model beside the person's effort, which needs an asked model and a rail. A give carries
        # neither ('a give names no model, provider or mode'). The whole-choice rule survives in
        # `whatThisSpawnRunsOn`, but this row's defect has no way to occur and cannot be planted.
        # Its anchor is left stale, so the census records it retired.
        "M39 · 🔴 round 1 · half-and-half at a spawn — a person's effort beside a model the spawner named · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — `onThisProvider` is `inForce` since `R31b`.
        # ⚠️ **RE-AIMED AGAIN at 682, round two** — since 682 (`R31a`) the rail refuses ANY model beside an effort-only choice,
        # so the half this row plants needs two edits: the rail letting the model through, and the resolver
        # pairing it with the person's effort.
        [
            (RAILS, "    const anotherModel = askedModel !== undefined && askedModel !== inForce.model\n", "    const anotherModel = askedModel !== undefined && inForce.model !== null && askedModel !== inForce.model\n"),
            (RAILS, "    model: inForce.model,\n    modelFrom: inForce.model === null ? 'nobody' : 'a-person',\n", "    model: inForce.model ?? askedModel ?? null,\n    modelFrom: inForce.model === null ? 'nobody' : 'a-person',\n"),
        ],
    ),
    (
        "M40 · 🔴 round 1 · half-and-half at a wake — a chosen model inherits an effort recorded for an "
        "older one · killed by `a-spawn-reaches-the-provider-with-a-persons-model.test.ts` · killed by `a-persons-choice-holds-the-whole-launch.test.ts` (named by W4.78)",
        # ⚠️ **RE-AIMED at 682, not retired** — the applied arm is `whatThisWakeResumesOn`'s return.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) removed the wake's re-read of the saved choice. Half-and-half survives in theSelectedModel: an effort recorded without a model rides onto the model R1 picks only where that model offers it. The plant always keeps the recorded effort. The listed killer no longer covers it: its wakes either replay a whole row or name no effort. Proposed killer: a-persons-choice-holds-the-whole-launch.test.ts, '⚑ an effort recorded ALONE is applied at a wake … where that model offers it' (expects default/medium, would get max).
        [(HOST, "    return !judged || offered.includes(named.effort)\n", "    return true as boolean\n")],
    ),
    (
        "M41 · 🔴 round 1 · half-and-half at a wake — an effort-only choice beside a recorded model · "
        "killed by `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — the arm is `whatThisWakeResumesOn`'s fifth; removing it applies the
        # effort beside the recorded model's absence.
        [(HOST, "    if (saved.model === null && recordedModel !== undefined) {\n      return asRecorded(chose, 'an-effort-beside-a-recorded-model')\n    }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The other-provider sentence
        # ('Send this again without provider and model...') belonged to the removed rail's
        # `describeRail`. The rail is gone with `spawn_agent`, and `describeRail` has no
        # other-provider arm for a give. Its anchor is left stale, so the census records it retired.
        "M42 · ⛔ round 1 · the other-provider sentence loses its act · killed by "
        "`the-model-a-person-chose.test.ts`",
        # ⚠️ **RE-AIMED at 682, not retired** — `R31a` rewrote the other-provider sentence; this takes its act away.
        [(RAILS, "          `Send this again without provider${detail.askedModel === undefined ? '' : ' and model'} and ` +", "          `This spawn names another provider${detail.askedModel === undefined ? '' : ' and model'}, and ` +")],
    ),
    (
        "M43 · 🔴 round 2 · the spawn's answer stops SAYING a person's model — `R25` §1.2's *says so* · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 rewrote whatItRunsOnSaid: a person's choice for an agent is now its default (R2), and the give's answer says the pair and 'its default'; the plant drops the sentence exactly for that source, as `if (false)` did for modelFrom 'a-person'. Killer: §1b said({}) expects 'It runs on “opus” … — its default.'
        [(TOOLS, "    case 'started':\n      return `It runs ${pair} — ${whereItCameFromSaid(runsOn)}.`\n", "    case 'started':\n      return runsOn.from === 'its-default' ? '' : `It runs ${pair} — ${whereItCameFromSaid(runsOn)}.`\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `spawn_agent`'s `model`
        # argument and its 'Leave it out. If a person chose for this agent...' sentence went with
        # the tool. `give_work` has no `model` or `effort` key: the rewritten test asserts
        # `Object.keys(spawnTool.input)` contains neither, and the sentence occurs nowhere in
        # `agent-tools.ts`. Its anchor is left stale, so the census records it retired.
        "M44 · ⛔ round 2 · `spawn_agent`'s `model` loses its sentence — a model meets the rail blind · "
        "killed by `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`",
        # ⚠️ **Anchor CORRECTED IN PLACE BY 682, round two** — the sentence now says an effort-only
        # choice holds the model too (`R31a`); the defect (the sentence lost) is unchanged.
        [(TOOLS, "            'Leave it out. If a person chose for this agent — a model, or only an effort on its ' +", "            'A model name. The conversation starts ' +")],
    ),
    (
        "M45 · ⚠️ round 2 · a FRESH failure is asked again at once — a second child per failing Save · "
        "killed by `the-model-a-person-chose.test.ts`",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 689** — the helper's form of the same condition; `689` holds no copy of
        # this row, so its §3 control and this table's test both kill the one mutation.
        # ⚠️ **…and TWO edits since 689's review**: the helper now forgets only the promise it awaited,
        # and a Save that produced the failure itself awaited no cached one — so the fresh failure is
        # guarded twice, and the row takes BOTH away to plant what its label says.
        [
            (HOST, "    if (catalogue.ok || !stale || this.launches.closed) return catalogue\n", "    if (catalogue.ok || this.launches.closed) return catalogue\n"),
            (HOST, "    if (this.modelProbes.get(key) === cached) this.forgetModels(provider, folder)\n", "    this.forgetModels(provider, folder)\n"),
        ],
    ),
    (
        "M46 · ⚠️ round 2 · the sentence beside the control overstates an effort-only choice · killed "
        "by `the-model-a-person-chose.test.ts`",
        [(RULE, "      ? 'An effort chosen without a model is used only where no model is named. '", "      ? ''")],
    ),
]
