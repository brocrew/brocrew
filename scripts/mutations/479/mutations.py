"""479 · what approving a proposal actually does — criterion 20's fourth item.

⛔ **What this table is aimed at.** `476` §3.4 and §3.5 found two sentences on the control a
person presses, and both were false on a branch an ordinary press reaches:

> *"what was proposed is created, and the agent is told you approved it"*
> *"nothing is created, and the agent is told you said no"*

⚑ **Two independent conditions took them apart**, and every row here is one of them or one of the
host rules the new witnesses are the first thing in this repository able to reach:

 1. **The APPROVAL can create nothing.** ⛔ `RuntimeHost.bringItIntoExistence` is called BEFORE
    `proposal_ended`, before the row and before the held call settles, and it refuses two ways —
    a name that went first, and a declared folder that no longer resolves (`471`). ⚠️ Standing
    rule 18 is the whole of why this matters: nothing was recorded, so nothing may read settled.
 2. **The AGENT may not hear it.** ⛔ `PROPOSAL_BOUND_MS` releases the proposing call and leaves
    the proposal answerable — criterion 21, and `441 M17` is the row that keeps the hold open.
    ⚑ It is the SAME condition under Approve and under No, which is why it rides the ROW rather
    than either button, and why `M5` — drawing it on every row — is as wrong as `M4` dropping it.

⚠️ **What this table deliberately does NOT contain.**

 - ⛔ **No row on the ordering inside `decideProposal`** — the row before the settle. The door is
   SYNCHRONOUS, so swapping those two lines is invisible to every awaiting observer and the
   mutation would report a survivor it had never been possible to kill
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ `M11` reaches the same ordering
   from the half that IS observable: `created` can only be non-null because creation ran first.
 - ⛔ **No row on `holding.settle(...)`** — that is `441 M21`, and a second copy of somebody
   else's row is a second thing to keep in step for no extra measurement.
 - ⛔ **No row on `AN_APPROVAL_CAN_BOUNCE`'s own membership of the import** — deleting it is a
   compile error at both call sites, and a mutation that cannot build is not a measurement.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1, M2, M3 | `apps/desktop/test/what-approving-a-proposal-actually-does.test.ts` §5 |
| M1, M3, M4, M5 | `apps/desktop/test/a-nights-backlog-rehearsed.render.test.ts`, criterion 20's own oracle |
| M6, M7, M8, M9 | `apps/desktop/test/dom/what-approving-a-proposal-actually-does.dom.test.ts` |
| M10, M11, M12 | `apps/desktop/test/what-approving-a-proposal-actually-does.test.ts` §1–§4, the four witnesses |
"""

OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
QUEUE = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
CARD = "apps/desktop/src/renderer/src/components/ProposalCard.vue"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# ⚑ The row's own sentence, whole, so a row can delete it without touching the paragraph above it.
THE_ROWS_SENTENCE = (
    "            <p\n"
    '              v-if="row.kind === \'a-proposal\'"\n'
    '              class="pq-after"\n'
    "              :data-cy=\"`persons-queue-heard-${row.key}`\"\n"
    "            >\n"
    "              {{ THE_AGENT_HEARS_IT_ONLY_IF_WAITING }}\n"
    "            </p>\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the two sentences, and the branch each clause is about ─────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The Approve sentence *what was
        # proposed is created* and `AN_APPROVAL_CAN_BOUNCE` are gone from user-input-offer.ts,
        # because the proposal card and creation-on-approval went with proposals. Commit bd70d693:
        # "Proposals go end to end". Killer what-approving-a-proposal-actually-does.test.ts was
        # deleted. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT, half of it restored · the Approve sentence promises creation again. "
        "⛔ A person reads *what was proposed is created* on the control that creates it, presses "
        "it against a name somebody took thirty seconds ago, and gets a card that is still there "
        "— having been told, by this app, on this button, that it would not be. ⚠️ `476` §3.4 is "
        "the measurement and `bringItIntoExistence` is the code",
        [
            (
                OFFER,
                "      ? `what was proposed is created and your approval is recorded. ${AN_APPROVAL_CAN_BOUNCE}`",
                "      ? 'what was proposed is created and your approval is recorded'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** This row plants a bounce caveat on the
        # *No* branch of the proposal card's offer text, and the sentence pair and
        # `AN_APPROVAL_CAN_BOUNCE` are gone from user-input-offer.ts. The proposal card was deleted
        # by bd70d693 ("Proposals go end to end"). Its anchor is left stale, so the census records
        # it retired.
        "M2 · ⛔ the bounce condition is put on NO as well · a branch the host has not got. "
        "`decideProposal` never reaches `bringItIntoExistence` on a refusal — there is nothing to "
        "create and nothing that can go first — so the card would warn that saying no might fail "
        "to create nothing. ⚑ This is the row that makes the Approve sentence a MEASUREMENT rather "
        "than a caveat sprayed over both answers",
        [
            (
                OFFER,
                "      : 'nothing is created and your refusal is recorded'",
                "      : `nothing is created and your refusal is recorded. ${AN_APPROVAL_CAN_BOUNCE}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** *nothing is created, and the agent is
        # told you said no* was the proposal card's refuse sentence, which is no longer in
        # user-input-offer.ts. It was removed with the proposal card and creation in bd70d693
        # ("Proposals go end to end"). Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 THE DEFECT, the other half restored · both sentences claim the agent was told. "
        "⛔ After the bound the proposing call has already been answered *nobody answered*, and no "
        "later decision can reach back into a call that has returned — so this is the app telling "
        "a person their answer was delivered at the one moment it certainly was not. ⚠️ `476` §3.5",
        [
            (
                OFFER,
                "      : 'nothing is created and your refusal is recorded'",
                "      : 'nothing is created, and the agent is told you said no'",
            )
        ],
    ),
    # ── §2 · where the bound's sentence is said, and where it is not ────────────────────────────
    (
        "M4 · ⛔ the row says nothing about the bound · a person answering from the queue is not "
        "told that the agent may have stopped listening, and the gap is not disclosed anywhere "
        "else on that surface. ⚑ HO-024 §5.3: *a digest that omits an unanswerable thing is worse "
        "than one that names it*",
        [(QUEUE, THE_ROWS_SENTENCE, "")],
    ),
    (
        "M5 · ⚠️ every row says it · a permission decision and an escalated question both carry a "
        "sentence about a parked proposal call, which is a mechanism neither population has. ⛔ "
        "Same destination as M4 and the opposite road: a table that killed only the deletion would "
        "leave the `kind` guard untested, and a condition printed everywhere is how a real one "
        "stops being read",
        [(QUEUE, "              v-if=\"row.kind === 'a-proposal'\"\n", '              v-if="true"\n')],
    ),
    (
        "M6 · ⛔ the CARD stops saying it · the queue keeps the sentence and the card loses it, so "
        "the same proposal tells a person two different things about whether their answer arrives "
        "— which is `214 §3`'s defect with the two surfaces swapped",
        [
            (
                CARD,
                '        <p class="means-if" data-cy="proposal-heard">{{ THE_AGENT_HEARS_IT_ONLY_IF_WAITING }}</p>\n',
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The file ProposalCard.vue was deleted
        # (count_now -1; `git show --stat` lists it as removed) and its dom killer with it. Commit
        # bd70d693: "Proposals go end to end". Its anchor is left stale, so the census records it
        # retired.
        "M7 · 🔴 the card stops saying an approval can bounce · and this is the card whose button "
        "actually creates the thing. ⛔ The line above it still reads *Approving creates a "
        "project*, unconditionally, which is exactly the sentence `476` §3.4 found false",
        [
            (
                CARD,
                # ⚡ **Re-anchored TWICE in one day, both in place** (142's rule). ⛔ `591`
                # moved it out of the `<template v-if="!settled">` wrapper when HO-082 §2 took
                # the second sentence; `595` then moved the first behind the card's ONE
                # disclosure, where the control names it — *what could stop this* — and it is
                # composed in the script rather than typed in the template. ⚑ The row is
                # unchanged through both: it takes the sentence off the card. ⚠️ Re-verified RED
                # by hand on the rebased tree.
                "      key: 'bounce',\n"
                "      label: FOLDED_AWAY.bounce,\n"
                "      text: AN_APPROVAL_CAN_BOUNCE,\n",
                "      key: 'bounce',\n"
                "      label: FOLDED_AWAY.bounce,\n"
                "      text: '',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** ProposalCard.vue (a settled card that
        # goes on predicting) is deleted, together with `predicts` and the dom test that killed the
        # row. Commit bd70d693: "Proposals go end to end". Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⚠️ a settled card goes on predicting · *If the name has been taken…* printed under "
        "*You approved this* is a condition on a press that has already happened, and a person "
        "reading it cannot tell whether it is a warning about the record in front of them. ⛔ "
        "`458`'s rule in prose form: a sentence that no longer has anything to condition",
        # ⚡ **595 re-anchored this in place** (142's rule): the guard was on a `<template>`
        # wrapping two sentences, `591` moved it onto the one that was left, and `595` moved it
        # into the script — the row that builds what the disclosure holds. ⛔ The rule is
        # unchanged: **a settled card predicts nothing.** ⚠️ **What changed is where a person
        # meets it**: the prediction is now under the card's one disclosure, so the sentence
        # reads *"printed under You approved this, one press away"* — a quieter defect than the
        # one `479` measured and the same rule. ⚑ Re-verified RED by hand.
        [(CARD, "  if (predicts.value) {", "  if (true) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** ProposalCard.vue is deleted, so "the
        # card spells its own, shorter" has no card, and `AN_APPROVAL_CAN_BOUNCE` (the one shared
        # spelling it protected) is also gone. Subject removed by bd70d693 ("Proposals go end to
        # end"). Its anchor is left stale, so the census records it retired.
        "M9 · ⛔ the card spells its own, shorter · one fact, two spellings, free to drift — and "
        "the drift is silent because each surface is internally consistent. ⚑ `214 §3` is the "
        "ruling and `proposal-offer.ts` is where this project already put the two WORDS for the "
        "same reason; this is the same argument about the two CONDITIONS",
        [
            (
                CARD,
                # ⚡ **Re-anchored twice too**, for the row above's reason — by `591` onto the
                # bare `<p v-if>`, then by `595` into the script row the disclosure renders.
                # ⛔ The row is unchanged: it spells a second, shorter copy of one fact, free to
                # drift from the queue's. ⚠️ Re-verified RED by hand on the rebased tree.
                "      text: AN_APPROVAL_CAN_BOUNCE,",
                "      text: 'If the name has gone, nothing happens.',",
            )
        ],
    ),
    # ── §3 · the host rules these witnesses are the first thing able to reach ───────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `bringItIntoExistence`'s refusal and
        # the `stillOpen: true` on `brought.refused` belonged to decideProposal, which is deleted.
        # The other `stillOpen` returns in runtime-host.ts belong to question answers, which other
        # tables own. Subject removed by bd70d693 ("Proposals go end to end"). Its anchor is left
        # stale, so the census records it retired.
        "M10 · 🔴 a bounce SETTLES the card · standing rule 18, inverted at the one door it was "
        "written about: creation was refused, nothing was recorded, the agent is still waiting — "
        "and the card reads decided, loses both buttons and keeps the reason as an epitaph. ⛔ "
        "`469`'s sentence exactly: *an error projection, not a settlement*",
        [
            (
                HOST,
                "        return { outcome: 'refused', reason: brought.refused, stillOpen: true }",
                "        return { outcome: 'refused', reason: brought.refused, stillOpen: false }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `created = brought.created` was the
        # proposing `create_project` call reporting the created project's name to the agent.
        # `create_project` and proposals are removed ("create_project and list_projects ... are
        # removed"), and the anchor and its witness test are deleted. Its anchor is left stale, so
        # the census records it retired.
        "M11 · ⛔ the agent is told a decision and not a NAME · the proposing call comes back "
        "`approved` with `created: null`, so a model that has just been granted a project cannot "
        "say which one and has to go and look. ⚑ It is also the observable half of the ordering "
        "this table declines to pin directly: a non-null `created` is proof that creation ran "
        "before the settle",
        [(HOST, "      created = brought.created\n", "      created = null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `holding.waiting = false` closed the
        # proposal hold in decideProposal, and no such line exists in the host now. The two-guard
        # scenario (map, then ledger) was proposal-only, and its killer test was deleted. Commit
        # bd70d693: "Proposals go end to end". Its anchor is left stale, so the census records it
        # retired.
        "M12 · ⚠️ the hold is never closed · a decided proposal stays `waiting` in this host's own "
        "map, so the door falls through to the LEDGER check behind it and answers a second press "
        "with the wrong sentence — *already settled* where the truth is *nobody is waiting*. ⛔ The "
        "two guards exist because they are about different things, and a map that never closes "
        "makes the first one dead code",
        [
            (
                HOST,
                # ⚑ **Re-anchored by `615`**, which put the once-only read between these two
                # lines. ⛔ The DEFECT is unchanged: the close is simply deleted.
                "    holding.waiting = false\n",
                "",
            )
        ],
    ),
]
