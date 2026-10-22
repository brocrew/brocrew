"""383 · one number a person can quote — each row is THE DEFECT, put back (131).

⛔ **This dispatch reconciled `379` and `380`, and its rows are about the seam.** The two tables it
merges keep their own rules and their own rows: `379` owns the mint, the fold and the crash repair,
and `380` owns the hash, the confinement, the crash states and the reader. ⚑ **What `383` decided —
and what these rows protect — is that a project has ONE sequence, and that a document's `taskId` is
validated against the ledger rather than stored on trust.**

🔴 **The safety property, in the direction the rows read.** Nothing here widens what an agent may do.
What is protected is that **a number a person quotes names one subject** (`M1`), and that
**`document.task_id` cannot point at work that does not exist** (`M2`-`M4`) — the column has no
foreign key, by `359`'s ruling, so the port is the only thing standing where a constraint would be.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M3` | ⚑ **`run_suite`** — `apps/desktop/test/one-number-a-person-can-quote.test.ts` §2 |
| `M4` | ⚑ **`run_suite`** — the same file, §1 |
| `M5` | ⚑ **`scripts/test/clean-base-without-running-it.test.mjs`** §2 (since `717`; the gate only from `706`) |

⛔ **706 · the `gate-only/` killers above run only inside `pnpm run ci`** — they spawn `clean-base`,
which standing rule §6 permits only inside the whole gate (`vitest.gate-only.config.ts`). ⚠️ **And `ci`
never applies a mutation row**: it runs these killers on the unmutated tree. So a row whose ONLY
killer is one of them can no longer be re-verified RED by anything — `verify_row.py` refuses the
killer, and no project a table run starts reaches it, so a table run reports the row SURVIVED. The
row keeps the verdict it last earned.

⚑ **717 · R45 split that file** (the PM's ruling): its tests that never spawn the script went back to
`scripts/test/clean-base-without-running-it.test.mjs`, and each row below was re-run ALONE against
it with `verify_row.py`. ⚑ **`M5` went RED** — §2's migration-count test is one of the moved ones — and its label now names its killer. ⚑ This table has no gate-only row left.

## ⛔ What this table deliberately does NOT contain

⛔ **No row that gives tasks their own counter.** That is `379`'s `M12`, rewritten by this dispatch
onto the allocator that replaced its `max`: putting the ledger maximum back is exactly the
two-allocator world, so a second row here would be the same defect twice.

⛔ **No row on the document side of the shared number.** `380`'s `M1`, `M2`, `M3` and `M4` already
own *the counter never moves*, *`MAX(sequence) + 1`*, *the stream is app-global* and *a document does
not take its task's number*; `383` moved two of their anchors and left the rules where they were.

⛔ **No row that reads the project off the EVENT PAYLOAD instead of the binding.** A
`task_assigned` event carries `projectSlug` and `taskNumberInProject` joins
`provider_session → agent_profile → project` instead — but `376` made a spawn inherit its parent's
project, so at this HEAD the two readings cannot disagree. ⚠️ A row here would be *"a comparison
tested where both sides agree"*, which is how three of `341`'s rows survived. The reason the join
wins is stated in the docblock and is about which spelling anything else can write, not about a
state this app can reach today.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
RAILS = "apps/desktop/src/main/documents/canonical-document.ts"
CLEAN = "scripts/clean-base.mjs"

MUTATIONS = [
    # ── the port 380 asked S1 for ─────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was the
        # (project, task) pair a document is filed under, and both halves are gone: 5e931be8
        # (feat(D-016): the tree) says "the project, proposal, binding, home and document tables go;
        # work, work_sequence and work_resource come". A resource now belongs to a piece by id, so
        # there is no project half to ignore and no registry that resolves one from the other;
        # `projectSlug` and `registeredForTask` no longer exist in session-store.ts. Its anchor is
        # left stale, so the census records it retired.
        "M1 · 🔴 the port ignores the PROJECT half of the pair · a task id resolves in whichever "
        "project it is named from, so a document is numbered in one project's stream and filed "
        "against work in another — and `380`'s *“the registry cannot resolve one from the other”* "
        "becomes a validation that never validated",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The (taskId,
        # projectSlug) pair is still validated by the port. The lookup now matches the `projectSlug`
        # the task's own assignment wrote, in the payload, instead of joining `proj.slug`. The plant
        # turns that comparison into an always-true one, and the bound `?` is kept so the statement
        # stays valid.
        [
            (STORE, "              AND json_extract(assigned.payload, '$.projectSlug') = ?)", '              AND (? IS NOT NULL))'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was the document
        # door consulting existing documents of a project before it knew the (project, task) pair
        # was real. The document registry and the project rows were removed on purpose by 5e931be8
        # ("the project, proposal, binding, home and document tables go"), and the `no-such-task`
        # check is absent from session-store.ts. A resource is filed against a piece id that the
        # foreign key validates, so the ordering the row protected has no place to occur. Its anchor
        # is left stale, so the census records it retired.
        "M2 · ⛔ the pair is taken on trust when a sibling exists · the door consults what documents "
        "are already there BEFORE it knows the task is real, so a caller holding an id that names "
        "nothing here learns which kinds this project already holds",
        [
            (
                STORE,
                # ⚑ 676 · anchor CORRECTED, not retired: F2 spelled the lookup `found` and gave the
                # refusal its count; the subject — asking BEFORE the sibling check — is unchanged.
                "        if (found.number === null) {\n"
                "          return { ok: false, rail: 'no-such-task', rowsUnread: found.rowsUnread }\n",
                "        if (\n"
                "          found.number === null &&\n"
                "          documentSql().registeredForTask.all(projectId, input.taskId).length === 0\n"
                "        ) {\n"
                "          return { ok: false, rail: 'no-such-task', rowsUnread: found.rowsUnread }\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at 424, deliberately, and it is the one kind of retirement that is
        # honest: the DEFECT this row describes became the DECISION.** HO-023 §2.1 asks whether a
        # `retryable: true` names something the caller can do, and `422` row 19 measured that it
        # does not here — `reply_to_parent` derives the `(taskId, projectSlug)` pair from the task
        # it was already admitted on, so *"asked in the wrong project"* is a call no model can
        # make. ⚑ **The rule is still measured, pointed the other way, at `424` `M15`**, which puts
        # `while-this-holds` back and watches the promise return. ⛔ Do NOT re-anchor this row: it
        # would assert the opposite of the shipped ruling.
        "M3 · ⚠️ `no-such-task` is PERMANENT · a model that asked in the wrong project is told the "
        "call can never succeed, so a task id that is perfectly good is abandoned on the strength of "
        "one wrong argument",
        [
            (
                RAILS,
                "  'no-such-task': 'while-this-holds',",
                "  'no-such-task': 'permanent',",
            )
        ],
    ),
    # ── the invariant on the task side ────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was a project
        # row that is gone silently restarting its numbering at 1 beside a #1 that is already there.
        # 5e931be8 removed the project table and `Task #N` numbering on purpose ("the project,
        # proposal, binding, home and document tables go; work, work_sequence and work_resource
        # come"); `cannot number work in a project` is absent from session-store.ts. Numbering is
        # now `bumpSequence(scope)` over `work_sequence`, an upsert that starts a new scope at 1 by
        # design, so the invariant this row guarded no longer exists. Its anchor is left stale, so
        # the census records it retired.
        "M4 · ⛔ a project this database does not hold silently restarts at 1 · the invariant becomes "
        "an answer, and work assigned in a project whose row is gone is numbered `#1` beside the "
        "`#1` that is already there",
        [
            (
                STORE,
                "      throw new Error(`cannot number work in a project this database does not hold: ${slug}`)",
                "      return 1",
            )
        ],
    ),
    # ── the manifest that has to know what the merge did ──────────────────────────────────────
    (
        # Same defect on its current subject; source-only, NOT VERIFIED.
        "M5 · ⛔ the reset's manifest is one migration behind the tree · the sentence a person "
        "reads before wiping their database describes a tree that no longer exists. ⚠️ **Re-anchored "
        "by `394`, `409`, `440`, `441`, `471`, `500`, `511`, `516`, `524`, `532`, `533`, `553`, `573`, `582`, `586` and `598`**, each of "
        "which added "
        "a migration — `383` counted 23, `394` 24, `409` 25, `440` 28, `441` 29, `471` 30, `500` 31, "
        "`511` 32, `516` 33, `524` 34, `532` 35, `533` 36, `553` 37, `573` 38, `582` 40, `586` 41 and `598` 42; the DEFECT is unchanged, and only the "
        "number it is "
        "measured against moved. "
        "⛔ Correcting it is free and retiring it would take the manifest out of the table for an "
        "edit that never touched the rule — killed by `clean-base-without-running-it.test.mjs`",
        # ⚑ **RE-ANCHORED again at 500**, which added `0030` on top of `471`'s `0029`. The row is
        # unchanged: the manifest a person reads before wiping their database must state the tree it
        # has.
            # ⚑ **Re-anchored by `419`** (`0026`), **`440`** (`0027`), **`441`** (`0028`), **`471`**
            # (`0029`), **`500`** (`0030`) **and `511`** (`0031`). ⛔ The ROW is unchanged: the
            # fresh-launch sentence states a count one short of the folder, which is the
            # literal-that-drifts this row exists to catch. Re-verified RED individually.
            #
            # ⚠️ **`419` was missing from this list until `511` counted the folder against it** — the
            # row's own label enumerated the dispatches that re-anchored it and had itself drifted,
            # which is the shape the row is about.
            # ⚑ **…and `516` (`0032`)**, which created the two external-MCP tables, **and `524`
            # (`0033`)**, which put `reach` on the registry row. The row is unchanged: the
            # fresh-launch sentence states a count one short of the folder.
            # ⚠️ **…and `532` (`0034`)**, which carries the project manager's two seeded grants to
            # databases whose creation is already past. ⛔ Eleventh re-anchor, same defect, same
            # line: a literal in a sentence a person reads before wiping their database.
            # ⚑ **…and `533` (`0035`)**, a partial index on the error rows, which put the folder
            # at 36. ⛔ **The anchor is CORRECTED, not retired**: the row's subject — *the
            # fresh-launch sentence states a count one short of the folder* — never moved, only its
            # bytes did (`correct-a-stale-mutation-anchor-dont-retire-it`).
            #
            # ⚑ **…and `582` (`0038` and `0039`)**, which is the first re-anchor to move the number
            # by TWO: a new table for the `configured` layer's versions, and one nullable column for
            # the grant that reaches it. ⛔ **Corrected, not retired**, and re-verified RED by hand.
            #
            # 🔴 **`532` and `533` corrected this same line to the same bytes from one base**, and
            # git merged the two identical edits without a conflict — so the anchor came out of the
            # merge stating 35 while the folder held 36. ⚠️ **A row two dispatches re-anchor in the
            # same window is silently one behind again the moment they are merged**, which is the
            # row's own defect happening to the row.
            # ⚑ **…and `553` (`0036`)**, `agent_identity.can_assign_work` — HO-060 §2's second
            # gate. ⛔ Thirteenth re-anchor, same defect, same line, and the row is unchanged: the
            # fresh-launch sentence states a count one short of the folder. Re-verified RED
            # individually after the correction.
            # ⚑ **…and `573` (`0037`)**, `agent_identity.can_staff` on BroBot's slug — HO-068 §1.
            # ⛔ **Fourteenth re-anchor, same defect, same line**, and the row is unchanged.
            # ⚠️ **It went dark rather than red**, which is `528`'s own point: the write-guard
            # named it, and this correction is what keeps the manifest in the table
            # (`correct-a-stale-mutation-anchor-dont-retire-it`). Re-verified RED individually.
            # ⚑ **…and `586` (`0040`)**, the partial index over the provider's own all-clear
            # records — `HO-080` §1.3's promotion needed one, because `rate_limit_event` is among
            # the densest types in the table. ⛔ **Fifteenth re-anchor, same defect, same line**,
            # and the row is unchanged: the fresh-launch sentence states a count one short of the
            # folder. ⚠️ **Dark again rather than red**, named by `528`'s write-guard, corrected in
            # place and re-verified RED by hand (`correct-a-stale-mutation-anchor-dont-retire-it`).
            # ⚑ **…and `598` (`0041`)**, `agent_identity.created_by` — `HO-084` §1's *who created
            # it*, the fact the ruling turns on and the one this app had never written down.
            # ⛔ **Sixteenth re-anchor, same defect, same line**, and the row is unchanged: the
            # fresh-launch sentence states a count one short of the folder. ⚠️ **Dark again rather
            # than red**, named by `528`'s write-guard, corrected in place and re-verified RED by
            # hand (`correct-a-stale-mutation-anchor-dont-retire-it`).
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 added migration 0046, so the manifest reads 47. The DEFECT this row plants is unchanged.
                # manifest's count moved from 43 to 44 — the SEVENTEENTH re-anchor of this one
                # line, and the count moves with every migration by design. ⛔ **CORRECTED, not
                # retired** — the subject is the sentence a person reads before wiping their data,
                # and it is still there. ⚠️ Re-verified RED by hand against
                # `scripts/test/clean-base.test.mjs` (`correct-a-stale-mutation-anchor-dont-retire-it`)
                # — the file `706` moved to `scripts/gate-only/`, and whose §2 `717` (R45) moved back as
                # `scripts/test/clean-base-without-running-it.test.mjs`: RED alone against it again.
                # ⚠️ **The replacement moves with the anchor**: the row is *one migration behind the
                # tree*, so it has to stay exactly one behind whatever the tree now says.
                # ⚑ **RE-ANCHORED AGAIN at `677`**: `0044` is `agent_identity.model_choice` (`R25`),
                # so the count moved from 44 to 45 — re-anchored again, same line, same defect,
                # CORRECTED and re-verified RED alone with `verify_row.py`. ⚠️ No ordinal: the label
                # above lists re-anchors only through `598`, and `618` and `625` also moved it.
                # ⚑ **…and AGAIN at `682`**: `0045` is `provider_session.model_or_effort_set_by_a_person_at`
                # (`R31c`), so the count moved from 45 to 46 — same line, same defect, one behind the
                # tree, CORRECTED and re-verified RED alone with `verify_row.py`.
                # ⚠️ **RE-ANCHORED at 699, not retired**: `0047` is `provider_session.closing_for_the_quit_at`
                # (`692` F-l), so the manifest reads 48 and one behind is 47. The DEFECT is unchanged.
                # ⛔ NOT re-verified alone: its only killer runs `clean-base`, which §6 permits only
                # inside `pnpm run ci` whole (`692` F-m's reason). ⚑ Until `717`: R45 moved that
                # killer back to the ordinary suite, and the row is RED alone against it since (header).
                # ⚑ **…and AGAIN at `727`**: `0048` is `provider_session.launched_as` (R87), so the
                # manifest reads 49 and one behind is 48 — same line, same defect, re-verified alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds: the reset's manifest count of migrations must equal the migrations the tree ships.
        # The tree now ships exactly one (`0000_the_tree.sql`) and `scripts/clean-base.mjs` carries
        # `const MIGRATIONS = 1`, so the plant is that manifest saying 0, one behind the tree. This
        # is read as text only and clean-base is never run. Killed by
        # `clean-base-without-running-it.test.mjs`.
        [
            ('scripts/clean-base.mjs', 'const MIGRATIONS = 18\n', 'const MIGRATIONS = 17\n'),
        ],
    ),
]
