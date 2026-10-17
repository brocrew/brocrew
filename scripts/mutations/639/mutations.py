"""639 · Approving a standing-agent proposal, and the two sentences that came with it.

⛔ **Ordered by the person, who looked at his Team page and asked *"why do we have an agent called
Machine check that is not even doing anything?"*** ⚑ No test caught it, no gate caught it, and the
ledger recorded every step correctly — the events were all there and all honest; nothing was
reading them.

## 🔴 What the dispatch decided, and therefore what has to be killable

 * ⛔ **The brief's premise was that approving wrote a HALF agent.** ⚠️ It did not:
   `bringItIntoExistence`'s agent arm performs ONE durable write with one door in front of it, and
   every absence the brief listed is the app's own creation contract — `createAgentIdentity`
   *"writes an `agent_identity` row and NOTHING ELSE"*. ⚑ The CONTROL in §1 of
   `a-name-a-person-approved.test.ts` is what establishes that, and no mutation can establish it.
 * 🔴 **The defect is the SENTENCE, twice.** The NOUN was hard-coded `the project` over all three
   shapes while `ProposalCard.vue` has rendered it from `SHAPE_CREATES` since `441`; and the
   clause `create_agent` and `spawn_agent` both carry — *a name is not a grant* — was missing from
   the third door that mints a name.
 * ⚠️ **And a second half-write, in the arm the brief was not looking at.** The project arm made a
   DIRECTORY before it asked whether the name was free, then told both readers *"nothing was
   created"*. ⛔ The name question moved in front of the `mkdir`.

## The row groups

 * `M1`-`M3`   🔴 **the noun** — hard-coded back, the table collapsed onto one word, and the table
                swapped so both shapes are told the other thing.
 * `M4`-`M6`   ⛔ **the clause** — the arm inverted, the clause on every arm, and the half of the
                sentence that names a live door removed.
 * `M7`-`M8`   ⚠️ **the shape reaching the words** — the carrier pins a literal shape, and the
                composer is handed one.
 * `M9`-`M10`  ⛔ **the ordering** — the name door removed from in front of the `mkdir`, and the
                wrong refusal composed after it.
 * `M11`       ⚑ **the name a person READ** — the row takes a generated handle instead of the one
                on the card.

## ⚠️ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row removes the `foldProfileName` on either side of the new name check.**
   `slugFromName` already folds, and `createProjectTx` stores the folded spelling — so both sides
   are folded by construction and a row dropping either fold would change no outcome and record as
   a phantom survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ The folds are
   kept because they ask `createProjectTx`'s identical question rather than a friendlier copy of
   it (169 §1), and that is a property of the code rather than of any input this table can plant.
 * ⚠️ **No row writes a `role` on the approved identity.** `agent_identity_role_ck` admits `NULL`
   or one of three words, so such a row would abort the transaction rather than produce a
   measurable difference — ⛔ **and it is the shape §3.2's open product question turns on**: *"a
   full agent"* needs a migration before it needs a mutation.
 * ⛔ **No row on `not-your-project`.** That rail is correct, its sentence already carries the
   performable act, and `the-project-a-spawn-lands-in.test.ts` §4 already pins the exact chain
   the person's ledger walked. ⚑ Re-measuring it here would be the same reading twice.

## ⚑ WRITTEN, not run

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** No
`mutations.txt` exists at this HEAD and its absence is the honest state. ⚠️ Every row below was
verified RED on its own — applied alone, its killer file run, the tree restored from bytes and the
restore asserted by SHA-256 — which is `verify-each-mutation-row-without-running-the-table`.
"""

from __future__ import annotations

RAILS = "apps/desktop/src/main/runtime/proposal-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SHARED = "apps/desktop/src/shared/proposals.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the noun ──────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The mutated sentence lived in
        # proposal-rails.ts, which D-016a deleted whole (215 lines). Commit bd70d693: "Proposals go
        # end to end, with the demo seed, the renderer fixtures and takes_work_from"; nothing
        # proposes or approves a standing agent now, so there is no decision sentence left to
        # mutate. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 **the noun is hard-coded back to `the project`** · exactly the sentence the "
        "proposer read at 02:07:46 about an agent, and the reason `project: \"machine-check\"` "
        "went into the `spawn_agent` call thirty seconds later. ⛔ The rail it met was blameless",
        [
            (
                RAILS,
                "`A person decided on ${THE_THING_DECIDED_ON[SHAPE_CREATES[proposal.shape]]} you proposed, ${proposal.name}.`",
                "`A person decided on the project you proposed, ${proposal.name}.`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The THE_THING_DECIDED_ON table ("'an
        # agent': 'the agent'") was in proposal-rails.ts, deleted by D-016a with "Proposals go end
        # to end". The noun the person was told about a decided proposal no longer exists anywhere.
        # Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ **the table exists and says one word** · the derivation is in place, the lookup "
        "runs, and both shapes come out `the project` — ⚑ a rendering that renders a constant, "
        "which is the shape a reviewer's eye slides past",
        [(RAILS, "  'an agent': 'the agent',", "  'an agent': 'the project',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The swapped shape table was in
        # proposal-rails.ts (deleted); the file no longer exists, so the anchor cannot come back.
        # Removed on purpose by "Proposals go end to end" in bd70d693, and ProposalCard.vue, which
        # rendered from the same SHAPE_CREATES, went in the same commit. Its anchor is left stale,
        # so the census records it retired.
        "M3 · ⚠️ **the table is swapped** · every shape is told the OTHER thing, so the project "
        "arms break in the direction the agent arm used to. ⛔ A test that only ever asserted the "
        "agent case would call this green",
        [
            (
                RAILS,
                "  'a project': 'the project',\n  'an agent': 'the agent',",
                "  'a project': 'the agent',\n  'an agent': 'the project',",
            )
        ],
    ),
    # ── B · what a name does not buy ──────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The arm that adds the spawn_agent
        # identity clause to a decided proposal (SHAPE_CREATES[made.shape] === 'an agent') was in
        # the deleted proposal-rails.ts. D-016a removed proposals end to end, so no approval
        # sentence carries or omits that clause. Its anchor is left stale, so the census records it
        # retired.
        "M4 · 🔴 **the arm is inverted** · a new PROJECT is told how `spawn_agent` picks an "
        "identity and a new AGENT is told nothing — ⛔ the clause on the arm it means nothing to, "
        "missing from the one it was written for",
        [
            (
                RAILS,
                "    return SHAPE_CREATES[made.shape] === 'an agent'",
                "    return SHAPE_CREATES[made.shape] !== 'an agent'",
            )
        ],
    ),
    (
        # ⚠️ **Landing D-014 · a RULING IS OWED, and the row is left as it was.** D-014 deleted
        # `A_NAME_IS_NOT_A_GRANT` (see `M6`), so the clause this row appends no longer exists. But the
        # project arm it anchors on did not change, so the anchor still applies and the census cannot
        # record the row retired. ⛔ A run of it now fails on a `ReferenceError`, not on any test —
        # that verdict measures nothing. Rewriting it to the nearest surviving sentence would give it
        # a verdict about something it never measured. Raised in L-001 for the PM.
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The approval sentence ("approved.
        # ${name} exists now, and nothing else was made") was composed in proposal-rails.ts, deleted
        # by D-016a ("Proposals go end to end"). Nothing composes an approval for a person's
        # decision any more. Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ **the clause is appended to EVERY arm** · the positive still passes and the "
        "sentence now teaches a model its plumbing at the moment the model is reading its mail. "
        "⚑ The control in §2 is the only thing standing between here and that",
        [
            (
                RAILS,
                "      : `approved. ${name} exists now, and nothing else was made — no conversation was started and nothing was sent.`",
                "      : `approved. ${name} exists now, and nothing else was made — no conversation was started and nothing was sent. ${A_NAME_IS_NOT_A_GRANT}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted `A_NAME_IS_NOT_A_GRANT`
        # ('Making a name does not by itself grant you the right to start it…'). Its premise is
        # gone: 'Any agent may start a conversation as any existing profile'. Its anchor is left
        # stale, so the census records it retired.
        "M6 · ⚠️ **the half that names a live door is removed** · the sentence still says a name "
        "buys nothing and no longer says where to look — ⛔ `HO-070` §3's rule broken while the "
        "claim stays true, which is the version no assertion about the FACT would catch",
        [
            (
                SHARED,
                "  'Making a name does not by itself grant you the right to start it: spawn_agent runs only as agents your own grant admits, and list_profiles is what tells you which.'",
                "  'Making a name does not by itself grant you the right to start it.'",
            )
        ],
    ),
    # ── C · the shape reaching the words ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The mutation planted on
        # this.deliverDecision(...) in runtime-host.ts; deliverDecision and the whole
        # proposal-decision path are gone (0 hits in runtime-host.ts). bd70d693: "Proposals go end
        # to end". Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ **the carrier pins a literal shape** · the type carries it, the table renders it, "
        "and the one call site that knows overwrites it — ⚑ `a-report-must-be-computed-from-the-"
        "outcome` with the outcome already in hand",
        [
            (
                HOST,
                "    void this.deliverDecision(sessionId, proposal, ending, created)",
                "    void this.deliverDecision(\n      sessionId,\n      { ...proposal, shape: 'bounded-project' },\n      ending,\n      created,\n    )",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The whatTheDecisionMeans(decided,
        # {created, slug, shape}) call was in the deleted proposal-rails.ts. With proposals removed
        # end to end (bd70d693) there is no composer to hand a fixed shape. Its anchor is left
        # stale, so the census records it retired.
        "M8 · ⚠️ **the composer is handed a fixed shape** · the heading is right and the "
        "consequence is the other shape's, so one sentence disagrees with the next — ⛔ `169` §1's "
        "*a row saying approved beside words saying refused* one subject over",
        [
            (
                RAILS,
                "    whatTheDecisionMeans(decided, { created, slug: proposal.slug, shape: proposal.shape }),",
                "    whatTheDecisionMeans(decided, { created, slug: proposal.slug, shape: 'bounded-project' }),",
            )
        ],
    ),
    # ── D · a door in front of each write ─────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The name door placed before the mkdir
        # was the project arm of approving a proposal (this.deps.store.projects()...
        # foldProfileName(proposal.slug)); the arm, the proposal and the project folder are all
        # removed. a-name-a-person-approved.test.ts now says: "proposals are gone ... this file's
        # proposal arm, its sentences and its project half-write went with them". Its anchor is left
        # stale, so the census records it retired.
        "M9 · 🔴 **the name door goes back behind the `mkdir`** · a proposal whose name went first "
        "while the card was on screen makes a DIRECTORY and both readers are told *nothing was "
        "created*. ⛔ And the card is answerable for ever, so the second press meets "
        "`folder-already-exists` naming a directory this app made itself",
        [
            (
                HOST,
                "    if (\n      this.deps.store\n        .projects()\n        .some((one) => foldProfileName(one.slug) === foldProfileName(proposal.slug))\n    ) {\n      return { refused: theNameWentFirst(proposal.shape, proposal.slug) }\n    }\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The mutation deleted the name-taken
        # refusal that guards approving a proposal (foldProfileName(one.slug) ===
        # foldProfileName(proposal.slug) in runtime-host.ts); that approval path was removed by
        # D-016a ("Proposals go end to end"), so no ordering of sentences is left to be wrong. Its
        # anchor is left stale, so the census records it retired.
        "M10 · ⛔ **the wrong sentence is composed after it** · the ordering is right, nothing is "
        "left on disk, and the person is told a FOLDER went away when a NAME went first — ⚠️ both "
        "sentences end *nothing was created*, so a test asserting that clause alone reads green",
        [
            (
                HOST,
                "        .some((one) => foldProfileName(one.slug) === foldProfileName(proposal.slug))\n    ) {\n      return { refused: theNameWentFirst(proposal.shape, proposal.slug) }\n    }",
                "        .some((one) => foldProfileName(one.slug) === foldProfileName(proposal.slug))\n    ) {\n      return { refused: theFolderWentAway(proposal.slug) }\n    }",
            )
        ],
    ),
    # ── E · the name a person read ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's displayName: proposal.name
        # was the standing-agent approval's identity write. Approving a proposal no longer exists
        # ("Proposals go end to end", bd70d693), and nothing proposes or approves a standing-agent
        # now. Its anchor is left stale, so the census records it retired.
        "M11 · ⚑ **the row takes a generated handle instead of the name on the card** · `584`'s "
        "fallback fires because the door sends nothing, so a person who approved *Machine check* "
        "finds *Ada* on the Team page. ⛔ `HO-095` §1's rule is that the app names an agent it "
        "invented — not one a person read a name for and pressed Approve on",
        [(HOST, "          displayName: proposal.name,", "          displayName: null,")],
    ),
]
