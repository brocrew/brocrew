"""630 · the clause that went false without anybody touching the string.

⛔ **`EXT-015` §2 asks for a *BroBot's rules* section at a second door.** ⚑ Building a second
consumer of the layer vocabulary is what surfaced the defect: 🔴 **`WHOSE_WORDS.factory.says`
claimed the factory half *"is the same for every agent"*, and `583` had already made that false.**

## 🔴 The property every row here is pointed at

⛔ **A person reading a group's membership sentence is told something TRUE about the bytes beside
it.** ⚑ `whose-groups.ts` maps a layer to `WHOSE_WORDS[whose].says` and `SessionInstructions.vue`
draws it beside that group — so the sentence is not documentation, it is the label on the evidence.

⚠️ **`whose` answers WHO MAY WRITE, never *is it the same for everyone*** — `factory-text.ts`'s own
words: *"it is FACTORY even though its lines are a function of the grants … the layer is decided by
WHO MAY WRITE, and nobody may write this."* ⛔ The sentence was claiming the second.

## ⚑ Two claims

 1. **Every clause that SURVIVED is load-bearing** (M1–M4). ⛔ Three are the promises `HO-009` §2
    actually rules — it ships with the app, a release changes it, nobody here may edit it — and the
    fourth is the replacement, which exists because a reader told only *nobody can edit this*
    assumes sameness by default.
 2. **The withdrawn clause stays withdrawn, at BOTH fields** (M1, M5). ⚠️ `short` never claimed
    sameness, so a re-introduction would most plausibly arrive there.
 3. **And the FACT is still true** (M6). 🔴 The sentence had to change because the code makes it
    change; a row that removes the dependency would make the old sentence honest again — and would
    do it by silently taking the grants out of what an agent is told.

## 🔴 The one a reader should look at first

⛔ **M6 makes the role section stop reading the grants.** ⚑ Nothing throws, the bundle still
composes, every string assertion still passes — 🔴 **and the agent is no longer told which acts it
may perform**, while the withdrawn sentence quietly becomes true again. ⚠️ It is the row that
proves this dispatch repaired a SENTENCE against a FACT rather than a sentence against a taste.

## ⛔ What this table does NOT cover, said out loud

 1. **The `brobots-rules` section itself.** ⚑ `630`'s response answers `§3.2` with *not yet, and
    here is the honest `why`* — there is no new door to guard.
 2. **`its-memory`.** ⛔ `625` built it whole and it is merged; `630` added no code there, so there
    is nothing here to mutate. ⚠️ Its rows are `625`'s.
 3. **The other five `WHOSE_WORDS` members.** ⚑ Only `factory`'s sentence was measured false;
    `583` owns the rest and `583 M8` already guards one of them.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M5 | `apps/desktop/test/a-sentence-the-product-can-be-held-to.test.ts` · `630 ·` the clause tests |
| M6 | `…a-sentence-the-product-can-be-held-to.test.ts` · the FACT behind it |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ Each red was
checked for the RIGHT reason: the output was searched for `SyntaxError`, `Transform failed` and
`error TS`.
"""

WORDS = "apps/desktop/src/shared/whose-text.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"

SAYS = (
    "      'Ships with the app: it changes when BroBot updates, and nobody here can edit it. ' +\n"
    "      'It is not word for word the same for every agent — the part addressed to this one’s role ' +\n"
    "      'names the acts it has been granted.',"
)

MUTATIONS = [
    (
        "M1 · 🔴 **THE WITHDRAWN CLAUSE IS PUT BACK** · the sentence claims the factory half is the "
        "same for every agent again. ⛔ Two identities of one role, one granted `canCreateAgents` "
        "and one not, read visibly different bytes under a label asserting sameness — and the "
        "label is drawn beside the evidence, so a person has both in one glance",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule still holds: the factory
        # half still branches on grants (`grantedActs` reads canMessage and canWriteRules in
        # `sharedAgentRules`/`findOutWhatHappened`). Re-verified RED alone.
        [
            # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the factory layer's sentence now names its one exception, BroBot's own part
            (WORDS, "      'It is the same for every agent, except that BroBot’s has a part of its own.',", "      'It is the same for every agent.',"),
        ],
    ),
    (
        "M2 · ⛔ *nobody here can edit it* goes · the one clause that IS the layer's definition "
        "(`HO-009` §2 — the layer is decided by who may write). ⚑ A person is left with a sentence "
        "about provenance and no statement of what they may do about it, beside a block they "
        "cannot change",
        [
            (
                WORDS,
                "and nobody here can edit it. ' +",
                "and this app records who last changed it. ' +",
            )
        ],
    ),
    (
        "M3 · ⚠️ *Ships with the app* goes · where the text comes from stops being said, so the "
        "half a release owns is indistinguishable from the half a person wrote — which is the "
        "whole axis this popup is organised on (`EXT-015` §2: *whose is this, and can I change "
        "it?*)",
        [(WORDS, "'Ships with the app: it changes when BroCrew updates", "'It changes when BroCrew updates")],
    ),
    (
        "M4 · 🔴 **THE REPLACEMENT CLAUSE GOES AND NOTHING SAYS WHAT VARIES** · the sentence is "
        "then true of every word it contains and still misleading: ⛔ a reader told only *nobody "
        "here can edit it* assumes sameness by default, which is exactly the claim `630` "
        "withdrew. ⚑ Withdrawing a false clause without replacing it is how the same belief "
        "survives the repair",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The replacement clause survives,
        # reworded by D-014 ('it names the acts this one has been granted'). Removing it still
        # leaves only 'nobody here can edit it', which implies sameness again. Re-verified RED
        # alone.
        [
            # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the factory layer's sentence now names its one exception, BroBot's own part
            (WORDS, "      'It is the same for every agent, except that BroBot’s has a part of its own.',", "      '',"),
        ],
    ),
    (
        "M5 · ⚠️ the SHORT form gains the withdrawn claim · the same false promise arrives through "
        "the other field. ⛔ `short` is what a narrow surface draws, so a repair that guarded only "
        "`says` would ship the sentence it removed — `an-exemption-must-be-honoured-by-every-enforcer`",
        [
            (
                WORDS,
                "    short: 'Ships with the app. Nobody here can edit it.',\n    says:\n      'Ships with the app: it changes",
                "    short: 'Ships with the app. The same for every agent.',\n    says:\n      'Ships with the app: it changes",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (W4.481, 56ee765e4): v6 core removes grant-adapted text.** The core
        # reads no grant, so there is no section left to stop reading them; what an agent may do is
        # said under "What you may do", from the grants. W4's go, 2026-10-12 (req_4dbebbdd,
        # req_cbf70476). Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M6 · 🔴 **THE ROLE SECTION STOPS READING THE GRANTS** · nothing throws, the bundle still "
        "composes, every string assertion still passes — ⛔ **and the agent is no longer told which "
        "acts it may perform**, while the withdrawn sentence quietly becomes true again. ⚑ It is "
        "the row that proves this dispatch repaired a sentence against a FACT rather than against "
        "a taste, and `ROLE_SECTIONS`' own lines are what a person reads back on the sheet",
        # ⚑ **T-002 · re-anchored in place, not retired** — PE-003's one set reads the grants once,
        # for its doors (`findOutWhatHappened`) and the rule relay. The row still hands it none.
        # Re-verified RED alone.
        [(FACTORY, "  const acts = grantedActs(context.capabilities)\n", "  const acts = grantedActs(null)\n")],
    ),
]
