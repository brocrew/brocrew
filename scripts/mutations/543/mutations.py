"""543 · Who called whom — the read that has to exist first.

⛔ **the person asked for a picture** — *"I need to see who's calling who and to navigate between
them."* — and `540` measured that it cannot be wired, naming the line:

> ⛔ **`TaskRow` has `assignedBy` and `assignedTo`, but `WorkGivenOut` exposes only
> `givenToProfile` and explicitly has no session id.** ⚠️ **The recipient CONVERSATION is dropped on
> the way to the renderer.**

⚑ **So the fact existed and the projection threw it away.** ⛔ Nothing can draw an edge from an
identity slug: one identity holds several conversations, which is the exact failure `540` names for
a role-first list — and it is the case `M2` puts back.

## 🔴 A · the two halves of `main`'s behaviour, put back separately

⚠️ **A test that names a seam `main` does not have cannot be run on `main`.** `M1` and `M2` are the
two halves of what `main` can answer today — *no child list at all* and *no recipient conversation*
— reproduced one at a time, so the suite's red is attributable rather than a single heap.

## ⛔ B · the rules that are cheap to lose and expensive to notice

⚑ **Five of the rows below are about a list going SHORT or a word going WIDE**, which is `453`'s
family: a walk that drops a row it could not read, a walk that claims a population it did not open,
and an existence question answered as an emptiness. ⛔ `452` §5.1's forbidden sentence — *nothing
was spawned from here*, drawn out of a failure — is `M6`.

## ⚠️ What this table does NOT cover

 1. **The panel.** `540`'s slice 2, and a UI seat's; nothing here touches the renderer.
 2. **`runtime:changed`.** `534` owns that channel and its subjects; `543` added none, and §9 of the
    suite is the measurement behind that rather than a rail this table could break.
 3. **The grandchild document rail.** ⛔ A product question with the PO — this dispatch makes the
    EDGES visible and says nothing about what may be read across them.
"""

EDGES = "apps/desktop/src/shared/who-called-whom.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ---- A · main's behaviour, put back, in its two halves -----------------------------------
    (
        "M1 · 🔴 **MAIN'S BEHAVIOUR, HALF ONE** · this app cannot see what a conversation STARTED. "
        "⛔ The self-FK has been indexed since `204` and read by nothing; with the walk emptied, "
        "`children` answers the word and no rows for every conversation in the database — which is "
        "exactly what a window could learn before this dispatch",
        [
            (
                STORE,
                "      const children = spawnSql().spawnedBy.all(sessionId) as SpawnedSessionRow[]",
                "      const children = [] as SpawnedSessionRow[]",
            )
        ],
    ),
    (
        "M2 · 🔴 **MAIN'S BEHAVIOUR, HALF TWO** · `540`'s measured line, put back: the recipient "
        "CONVERSATION is dropped and both ends of the edge name the giver. ⛔ Two conversations of "
        "one identity become one row twice, which is the failure the whole dispatch exists for",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece model: a work edge must name the receiving conversation
        # (`row.owner`), not the giver, or two conversations of one identity collapse into one row.
        # Only the field changed from `assignedTo` to `owner`; the anchor is moved to the
        # `to:`/`toIdentity` pair so it does not share a line with M13's `fromIdentity`. Killed by
        # `who-called-whom.test.ts`.
        [
            (EDGES, '    to: row.owner,\n    toIdentity,', '    to: row.giver,\n    toIdentity,'),
        ],
    ),
    # ---- B · a spawn and a handoff are two edges ----------------------------------------------
    (
        "M3 · ⛔ the child list is DERIVED from the work list · a spawn invented out of a handoff, "
        "which is `540` §3.1's rule broken at its own door: work is admitted by `can_message` and "
        "not by descent, so a conversation given work becomes a child it never was",
        [
            (
                HOST,
                "    const children = this.deps.store.spawnedBy(sessionId)",
                "    const children = {\n"
                "      ...this.deps.store.spawnedBy(sessionId),\n"
                "      rows: this.deps.store.workThisOneGaveOut(sessionId).rows.map((row) => ({\n"
                "        conversation: row.to,\n"
                "        identity: row.toIdentity,\n"
                "        projectSlug: row.projectSlug,\n"
                "        provider: null,\n"
                "        spawnedAt: row.assignedAt,\n"
                "        spawnReason: row.request,\n"
                "      })),\n"
                "    }",
            )
        ],
    ),
    # ---- C · the list that may not be quietly short --------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** A half-written spawn
        # (spawned_at or spawn_reason NULL) can no longer exist: those columns are gone.
        # who-called-whom.ts says 'D-016 · the parent is the whole of the edge ... since a give
        # starts a conversation, the reason is the brief of the piece it was given ... so the spawn
        # edge says only who started whom', and commit 5e931be8 replaced every old migration with
        # one `0000_the_tree`. `noteSkip(0)` for a half-written spawn no longer appears in
        # session-store.ts. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ a half-written spawn is dropped in SILENCE · the row is still refused and the "
        "count is not kept, so the child list is short with nothing saying so — `453`'s rule, and "
        "the one thing that makes this walk's zero a measurement rather than a constant",
        [
            (
                STORE,
                "          noteSkip(0)\n          return []",
                "          return []",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is
        # `spawnProvenance` answering null for a row whose `spawned_at`/`spawn_reason` is NULL.
        # Those columns and that function are gone: who-called-whom.ts says 'the parent is the whole
        # of the edge ... the spawn edge says only who started whom', and the commit removed the old
        # schema ('One migration, 0000_the_tree'). A `row.spawned_at === null` guard no longer
        # exists in session-store.ts, so there is no line to plant on. Its anchor is left stale, so
        # the census records it retired.
        "M5 · 🔴 a half-written spawn is REPORTED as a spawn · `spawnProvenance` answers `null` for "
        "it at the parent's end, so the two ends of one edge disagree about whether the edge "
        "exists — and a breadcrumb that points at nothing is drawn",
        [
            (
                STORE,
                "        if (row.spawned_at === null || row.spawn_reason === null) {",
                "        if (false) {",
            )
        ],
    ),
    (
        "M6 · ⛔ **`452` §5.1's FORBIDDEN SENTENCE** · existence is not asked, so an id this app "
        "holds no conversation for answers `every-conversation-this-one-spawned` with no rows — "
        "*nothing was spawned from here*, drawn out of a failure",
        [
            (
                STORE,
                "      if (spawnSql().conversationBinding.get(sessionId) === undefined) return noSuchConversation()",
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ the LEDGER half refuses on the LINEAGE's question · a ledger can hold work rows for "
        "a `session_id` no `provider_session` row names — `selectSessionsAssignedBy` LEFT-joins for "
        "exactly that — so answering `no-such-conversation` there hides work this app really holds",
        [
            (
                STORE,
                "      const mine = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined\n"
                "      const identity = mine?.identity ?? null",
                "      const mine = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined\n"
                "      if (mine === undefined) return noSuchConversation()\n"
                "      const identity = mine?.identity ?? null",
            )
        ],
    ),
    (
        "M8 · ⛔ `ledgers` is folded out of the ROWS · {@link LedgerWalk.ledgers}' absolute rule — "
        "*from the candidate query and never from the rows* — so a walk that refused a row claims "
        "never to have opened it, and *what was read* is answered with *what was found*",
                # ⚑ **671 · anchor corrected in place** — `rowsUnread: unread.count`. Re-verified RED.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — This is the same shared
        # walkLedgers return statement as 453:M1 (LedgerWalk.ledgers must come from the candidate
        # query, never from the rows found) — both tables independently pinned it. D-017's reshape
        # from a one-line return to a multi-line object literal broke the old single-line anchor;
        # the field itself is unchanged.
        [
            (STORE, '    ledgers: candidates.length,\n', '    ledgers: rows.length,\n'),
        ],
    ),
    # ---- D · the three rulings this dispatch was asked to make ---------------------------------
    (
        "M9 · 🔴 **§3.2 REVERSED** · the aggregate becomes four awaited reads, so `readAt` is one "
        "number over four moments — `540` MI-19's *would overclaim*, and `HO-050` §3's animal: a "
        "figure that is not measuring what it claims",
        [
            (
                HOST,
                "  whoCalledWhom(sessionId: string): WhoCalledWhom {",
                "  async whoCalledWhom(sessionId: string): Promise<WhoCalledWhom> {\n"
                "    await Promise.resolve()",
            )
        ],
    ),
    (
        "M10 · 🔴 **§3.3 REVERSED** · the lossy fold moves INTO the read, so `waiting` and `stalled` "
        "reach a surface as `working` and the product's five states become v2.8's two. ⛔ *The "
        "status fold is lossy and must not silently be*",
        [
            (
                EDGES,
                "    state: row.state,",
                "    state: row.state === 'answered' || row.state === 'withdrawn' ? row.state : 'working',",
            )
        ],
    ),
    (
        "M11 · 🔴 **§3.4 COLLAPSED** · the child row's `running` becomes a constant, so "
        "`hereIsOf(running, held)` can never reach `open-in-another-window` — the fourth navigation "
        "state, gone at the one place that could still have carried it",
        # ⚠️ **RE-ANCHORED at 711, not retired.** `711` carries the kept-open fact on each child edge
        # (`701` F-1), one line inside this map, so the anchor ends at that line's comment and the
        # mutant keeps it. The DEFECT this row plants is unchanged: `running` a constant.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule that the child
        # row's `running` is the host's own `runningStateOf` answer, not a constant, survives:
        # `openElsewhere(running, held)` still needs 'in-a-window' to be reachable. Only the
        # `keptOpenAcrossAQuit` comment line inside the map was removed by D-017b, so the anchor now
        # ends at the closing `})),`. The plant is the same constant as before, `'unwatched' as
        # const`, which type-checks.
        [
            (HOST, '        rows: children.rows.map((row) => ({\n          ...row,\n          running: this.runningStateOf(row.conversation),\n        })),\n', "        rows: children.rows.map((row) => ({\n          ...row,\n          running: 'unwatched' as const,\n        })),\n"),
        ],
    ),
    # ---- E · the two halves of the work edge ----------------------------------------------------
    (
        "M12 · ⛔ `workTakenIn` becomes `workThisOneGaveOut` with the argument swapped · it is not "
        "that walk and could not be: `assignedTo` is *the ledger this row was folded from*, so the "
        "work a conversation was GIVEN is exactly its own ledger — one, not a candidate set",
                # ⚑ **671 · anchor corrected in place** — the walk takes its `RowsUnread` now.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `workThisOneWasGiven` must read exactly its own conversation's ledger (walk
        # `every-piece-of-work-this-one-was-given`, `ledgers: 1`), not run the giver-side candidate
        # walk. The body is now `walkLedgers(...)` over `piecesOfSession` and
        # `composeWhatEachPieceIsWaitingOn`, and the plant swaps it for the local
        # `walkWorkGivenBy(sessionId, ...)` that `workThisOneGaveOut` uses. Killed by
        # `who-called-whom.test.ts`.
        [
            (STORE, "      return walkLedgers(\n        'every-piece-of-work-this-one-was-given',\n        [{ id: sessionId }],\n        (held, noteSkip) =>\n          composeWhatEachPieceIsWaitingOn(piecesOfSession(held, noteSkip), waiting).map((piece) =>\n            workEdge(piece, identity, identityOfGiver(piece.giver)),\n          ),\n        unread,\n      )", '      return walkWorkGivenBy(sessionId, (piece) =>\n        workEdge(piece, identity, identityOfGiver(piece.giver)),\n      )'),
        ],
    ),
    (
        "M13 · ⚠️ the giver's identity is thrown away · {@link TaskRow.assignedByProfile} is the "
        "identity RECORDED at the assignment, *which survives a rotation it does not*, and an edge "
        "with a null there cannot name who gave the work a month later",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The defect
        # still holds: an edge whose `fromIdentity` is null cannot name who gave the work. The
        # mechanism in the label is stale, because `assignedByProfile` no longer exists and the
        # giver's identity is now an argument to `workEdge`, resolved at read time
        # (`identityOfGiver(piece.giver)`). The plant is `fromIdentity: null` on the field that
        # receives it. Killed by `who-called-whom.test.ts`.
        [
            (EDGES, '    from: row.giver,\n    fromIdentity,\n', '    from: row.giver,\n    fromIdentity: null,\n'),
        ],
    ),
]
