"""475 · the two projects the digest still reads partly — criterion 16's last closeable ground.

⛔ **What this table is aimed at.** `466` left three projects reading *partly* and `475` closed
one of them and shrank another. Every rule it added is one a mutation can delete without breaking
a type, and they fall into four groups:

 1. **The EDGE, and every way it must refuse to join.** ⚑ `message_unqueued` is in the read for
    one reason: its row names the held message and `task_assigned` names the same one, so the pair
    says WHICH piece of work stopped being driven. ⛔ `M1` widens the join to endings that are not
    abandonments — and `withdrawTask` publishes `message_unqueued: 'cancelled'` AND
    `task_withdrawn` for one task, so that row makes the digest count one withdrawal twice. `M2`
    deletes the number from the line.
 2. **The GAP's subtraction, which is what makes the new line worth having.** ⚠️ HO-024 §5.3: *"a
    digest that omits an unanswerable thing is worse than one that names it"*. ⛔ `M3` deletes the
    gap outright and the four causes go back to being a silence; `M4`, `M5` and `M6` each delete
    one of the three ways a piece of work stops being unaccounted for, so the card says it cannot
    speak for work it has just spoken for; `M7` counts every assignment and makes the subtraction
    itself a no-op.
 3. **The SHAPES a night proposed** — `463`'s own clause, *"three project shapes were proposed"*.
    ⛔ `M8` deletes the breakdown, `M9` deletes what feeds it, `M10` puts the shape back on the
    newest so the same sentence is printed twice, and `M11` drops the guard that keeps a shape
    this build cannot spell from printing as `undefined` in a sentence about somebody's project.
 4. **The two lists that are one fact.** 🔴 `selectTaskEvents`' rule, inherited: *a type the fold
    branches on and the statement omits reads as "that event never happened", silently.* ⛔ `M12`
    takes the new member out of the SQL and leaves it in the vocabulary, which is that silence
    from the side nobody watches.

⚠️ **What this table deliberately does NOT contain.**

 - ⛔ **No row aimed at `DIGEST_EVENT_TYPES`' own membership.** Deleting the member is a COMPILE
   error at the fold's `case`, and a mutation that cannot build is not a measurement (`472` M22's
   lesson). `M12` reaches the same rule from the half that still compiles.
 - ⛔ **No row on the `messageId === undefined` half of the join guard.** `354`'s rule —
   *"an unnamed ending pairs with nothing"* — is carried by the TYPE here: `messageId` is
   optional, so a fold that dropped the check does not compile. ⚑ The behaviour is pinned by a
   test with its own positive control instead, which is where a rule the compiler already holds
   belongs.
 - ⛔ **No row on the DETAIL that is not drawn.** There is no line to delete: the arm never reads
   `event.detail`, and a mutation that ADDS a draw would be measuring a defect nobody wrote.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1–M12 | `apps/desktop/test/the-two-projects-the-digest-still-reads-partly.test.ts` |
| M1, M3, M4, M6, M8, M9 | **also** `apps/desktop/test/a-nights-backlog-rehearsed.render.test.ts`, where `463`'s verdicts moved |
| M10 | **also** `apps/desktop/test/the-night-the-digest-could-not-describe.test.ts`, whose proposal sentence went with it |
| M12 | **also** `apps/desktop/test/the-digest-and-its-window.test.ts`, which is where the two lists are censused |
"""

FOLD = "apps/desktop/src/main/runtime/digest.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

# ⚑ The gap's own arithmetic, whole, so a row can neuter the subtraction without touching the
# filter around it.
THE_SUBTRACTION = (
    "  const workWithoutAnEnding = [...tally.numbers.keys()].filter(\n"
    "    (taskId) => !tally.spokenFor.has(taskId),\n"
    "  ).length\n"
)

# ⚑ The breakdown clause of the proposal sentence, which is the half `463` asked for.
THE_SHAPES = (
    " What each would be: ${eachWord(\n"
    "        tally.shapes,\n"
    "        (word) => (isProjectShape(word) ? SHAPE_MEANS[word] : word),\n"
    "      )}."
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the edge, and every way it must refuse to join ─────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT · the join stops asking HOW the held message ended, so `sent` and "
        "`cancelled` draw the line too. ⛔ `sent` is the ordinary path — every piece of work handed "
        "to a busy child gets one — so a normal night reads *this work was never sent* about work "
        "that went out fine. ⚠️ And `cancelled` is worse than wrong: `withdrawTask` publishes it "
        "AND `task_withdrawn` for one task, so a single withdrawal is drawn twice, once under each "
        "sentence, from two rows the app writes microseconds apart",
        [(FOLD, "        if (event.reason !== 'abandoned' || event.messageId === undefined) break",
          "        if (event.messageId === undefined) break")],
    ),
    (
        "M2 · ⛔ the line stops naming the work · the one thing the whole widening bought — WHICH "
        "piece of work — is replaced by the placeholder the type allows, and the sentence becomes a "
        "count nobody can act on. ⚑ This is the row that says the edge is the point: without the "
        "number, `message_unqueued` is a type in the read with no reason to be there",
        # ⚠️ **697 · CORRECTED IN PLACE** — the number is spelled `taskCalled(held.number)` (`672` H1:
        # *Task #7*, not a bare `#7`). The subject — the line names WHICH work — is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # work-not-sent line in the digest still names the held piece it carried, through
        # pieceLine(label, title); the rule is unchanged and only the spelling moved from the task
        # to the piece. The plant draws the line with no piece. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (FOLD, "        bump(tally, 'work-not-sent', row.at, pieceLine(held.label, held.title))\n", "        bump(tally, 'work-not-sent', row.at, null)\n"),
        ],
    ),
    # ── §2 · the gap, and the three ways work stops being unaccounted for ───────────────────────
    (
        "M3 · 🔴 the gap is not drawn at all · HO-024 §5.3 deleted — *\"a digest that omits an "
        "unanswerable thing is worse than one that names it, because omission is indistinguishable "
        "from nothing-happened\"*. ⛔ The four stall causes no row can attribute go back to being a "
        "silence, and a night in which nothing was driven reads exactly like a night in which "
        "everything finished",
        [(FOLD, "    gap('work-without-an-ending', workWithoutAnEnding),\n", "")],
    ),
    (
        "M4 · ⛔ a REPLY no longer accounts for its work · the ordinary ending stops subtracting, so "
        "a project whose every task was answered inside the window is told this digest cannot say "
        "what became of any of them. ⚠️ A gap that fires on a project with nothing wrong with it is "
        "the *gap on every project every time* `DIGEST_GAP_KINDS` says would mean the design is "
        "wrong rather than the ledger",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A work_replied
        # still marks its piece as spoken for, so it is taken off the 'work without an ending'
        # count. The statement survived; it now takes the piece and sits directly above `const
        # said`, and the plant deletes it. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (FOLD, '        tally.spokenFor.add(event.piece)\n        const said = name(row.sessionId)\n', '        const said = name(row.sessionId)\n'),
        ],
    ),
    (
        "M5 · ⛔ a WITHDRAWAL no longer accounts for its work · the card draws *1 piece of work was "
        "taken back* and, underneath it, that it cannot say what became of that same piece of work. "
        "⚑ Two sentences about one task that contradict each other on one screen",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A
        # work_taken_back still marks the piece spoken for, so a withdrawal takes one off the count.
        # The plant deletes that statement and keeps the given.get above it; the two-line anchor is
        # unique because the reply arm has a different neighbour. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the digest marks a piece as spoken for when a take-back ends its questions.
        # D-016c added the same two lines to the work_closed arm, so the old anchor matched twice.
        # Extending it with the comment line that only the work_taken_back arm carries makes it
        # unique. The plant removes the spokenFor.add from that arm. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (FOLD, "        tally.spokenFor.add(event.piece)\n        // ⚑ **D-016 · and the questions its owner asked about it end with it**, as a close's do", "        // ⚑ **D-016 · and the questions its owner asked about it end with it**, as a close's do"),
        ],
    ),
    (
        "M6 · 🔴 the NEVER-SENT message no longer accounts for its work · the pairing that makes "
        "475 worth building is deleted: the new line says *#4 was never sent* and the gap beside it "
        "goes on counting #4 as work nothing said anything about. ⛔ `request_resolved`'s own rule "
        "one subject over — *the fold reads it so the gap cannot claim an ending it is looking "
        "straight at*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A
        # message_unqueued that was never sent still marks the piece it carried as spoken for, so
        # its work-not-sent line is subtracted from the gap and not counted twice. The plant deletes
        # that statement, which now takes `held.piece`. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (FOLD, '        tally.spokenFor.add(held.piece)\n', ''),
        ],
    ),
    (
        "M7 · ⛔ the subtraction is a no-op · every assignment the window saw is counted as "
        "unaccounted for, whatever the card said about it. ⚑ Same destination as M4–M6 and a "
        "different road: those three delete one contribution each, this deletes the filter, so a "
        "table that killed only the three would still have a hole where the arithmetic is",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # subtraction still exists: workWithoutAnEnding filters the pieces given in the window by
        # spokenFor. The plant counts every piece given (a no-op subtraction), so an answered window
        # still reports a gap. Killed by `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (FOLD, '  const workWithoutAnEnding = [...tally.given.keys()].filter(\n    (piece) => !tally.spokenFor.has(piece),\n  ).length\n', '  const workWithoutAnEnding = tally.given.size\n'),
        ],
    ),
    # ── §3 · the shapes a night proposed ────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The shape breakdown (*three project
        # shapes were proposed*, SHAPE_MEANS, isProjectShape) belonged to the digest's
        # project-proposal line, and digest.ts now has no proposal, shape or SHAPE_MEANS at all.
        # Commit bd70d693: "Proposals go end to end, with the demo seed, the renderer fixtures and
        # takes_work_from". The killer clause and its `project_proposed` events no longer exist. Its
        # anchor is left stale, so the census records it retired.
        "M8 · 🔴 the shape breakdown goes · `463`'s clause — *\"three project shapes were "
        "proposed\"* — is missing again, and the line says three things were proposed without "
        "saying they were three different things. ⛔ This is the row that says the Waiting verdict "
        "moved on a sentence rather than on a re-scoring",
        [(FOLD, THE_SHAPES, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `countWord(tally.shapes, event.shape)`
        # fed the proposal shape breakdown, and `tally.shapes` and `event.shape` are gone from
        # digest.ts with proposals. The row's subject was removed on purpose in bd70d693 ("Proposals
        # go end to end"). Its anchor is left stale, so the census records it retired.
        "M9 · ⛔ nothing feeds the breakdown · the counter is never bumped, so the clause renders "
        "with an empty list — *What each would be: .* — which is a sentence that reads as complete "
        "and says nothing. ⚠️ Worse than M8's deletion, because the card still promises the fact",
        [(FOLD, "        countWord(tally.shapes, event.shape)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row prints the proposal's shape on
        # the newest-proposal sentence ("proposed by X: a project with an end in view"). Both the
        # sentence and the `project_proposed` event were deleted with proposals in bd70d693. There
        # is no proposal line left to print twice. Its anchor is left stale, so the census records
        # it retired.
        "M10 · ⚠️ the shape is printed twice · the newest keeps its own copy and the breakdown adds "
        "another, so a project holding ONE proposal reads *the most recent is “X”, proposed by "
        "brobot: a project with an end in view … What each would be: 1 · a project with an end in "
        "view …*. ⛔ Two spellings of one fact on one line is what a second account looks like "
        "before it drifts",
        # ⚑ **707 · re-anchored in place, not retired** — R41 names the proposer (`agentCalled`); the row still prints the shape twice.
        [(FOLD, "          `“${event.name}”, proposed by ${agentCalled(event.proposedBy)}`,",
          "          `“${event.name}”, proposed by ${agentCalled(event.proposedBy)}: ${\n            isProjectShape(event.shape) ? SHAPE_MEANS[event.shape] : event.shape\n          }`,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The guard was for a replayed project
        # shape this build cannot spell, and `isProjectShape` and `SHAPE_MEANS` no longer exist in
        # the digest. Project shapes went with proposals in bd70d693 ("Proposals go end to end").
        # Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ a shape this build cannot spell prints as `undefined` · the guard `466` wrote for "
        "the newest instance is not carried onto the breakdown it moved to. ⚠️ A ledger row is "
        "`JSON.parse`d and cast, so a build whose vocabulary has moved is the reachable case — and "
        "`undefined` in a sentence about somebody's project is the one thing this surface must "
        "never print",
        [(FOLD, "        (word) => (isProjectShape(word) ? SHAPE_MEANS[word] : word),\n"
                "      )}.`",
          "        (word) => SHAPE_MEANS[word as keyof typeof SHAPE_MEANS],\n"
          "      )}.`")],
    ),
    # ── §4 · the two lists that are one fact ────────────────────────────────────────────────────
    (
        "M12 · 🔴 the new type leaves the STATEMENT and stays in the vocabulary · "
        "`selectTaskEvents`' rule, inherited by this read and now broken for its newest member: "
        "*a type the fold branches on and the statement omits reads as \"that event never "
        "happened\", silently*. ⛔ The arm is still there, the census of branches still passes in "
        "the direction most people check, and no held message that was never sent is ever seen "
        "again",
        [(STORE, "'tool_call', 'tool_result', 'message_unqueued')", "'tool_call', 'tool_result')")],
    ),
]
