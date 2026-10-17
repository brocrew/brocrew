"""491 · three fields nobody had seen carry a value.

⚠️ **`724` · R82 — the wire key these labels call `stalled_by` is `asked_to_stop_by` since `724`.**
The labels are the ones this table's run artefact (`mutations.txt`) records, so they are kept as
written; the anchors that spell the key were re-anchored in place and re-verified RED alone.

⛔ **The required question is literal here.** `M1`–`M3` hard-wire each public `list_tasks`
field to `null`, one at a time. The fresh-database product test must make every row red: a task
interrupted by a person supplies the two stall values, and the same task while its product-created
permission is pending supplies the live holder state.

🔴 The investigation also found two differently shaped defects. `M4` restores the sentence that
calls every row *frozen* when their shared conversation is waiting, including closed history. `M5`
and `M6` independently remove the two halves of the idle-ask boundary: the fold's reset and the
narrow reader's access to the durable `user_turn` opener. `M7` makes the public actor a person
constant while preserving null, so the second admitted actor must be observed too.

## Gate map

| rows | killer |
|---|---|
| `M1`–`M3` | `apps/desktop/test/state-a-supervisor-can-trust.test.ts` §7's same-run task |
| `M4` | the same section's closed-history/open-work pair |
| `M5`, `M6` | the same section's idle Stop → later permission cancellation regression |
| `M7` | the same public read over the `an-agent` vocabulary control |

⚠️ **T-002 measured the `M5`/`M6` line of this map blind.** Since `494` a Cancel writes its own
author over the fold's ask (`whoCancelledIt`), so in §7's idle Stop → later Cancel test the idle
ask is overwritten whether or not the new turn clears it: both rows SURVIVE that file alone. Both
are still killed, applied alone: `M5` by `the-act-this-app-knows-the-author-of.test.ts` (720's
controls: an ask from another turn, on a turn the provider finished), `M6` by
`a-task-you-can-see.test.ts` (the narrow read's type census) and
`the-work-this-conversation-gave-out.test.ts`. The recorded run predates `494`.

⚠️ No live provider is priced here. `FakeRuntime` produces the permission request and drives the
shared `SessionMachine`; the real `RuntimeHost`, SQLite store, task fold, disclosure door and
published `list_tasks` tool are the subject of every assertion.
"""

TASKS = "apps/desktop/src/shared/tasks.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

MUTATIONS = [
    (
        "M1 · 🔴 `stalled_at` is hard-wired to null at the public door · the ledger still "
        "holds the terminal time, but the supervisor can no longer distinguish the first ending "
        "from the later turn it can also see",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # piece read carries `stalled_at`, the moment it stalled, on the `list_tasks` wire)
        # survives: `piecePayload` in agent-tools.ts still emits `stalled_at: piece.stalledAt`. Only
        # the variable renamed (`task` to `piece`), so the old anchor went dark. The plant
        # hard-codes null, which the fresh-task and stalled-task cases in the killer read as a lost
        # timestamp. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            (TOOLS, '  stalled_at: piece.stalledAt,\n', '  stalled_at: null,\n'),
        ],
    ),
    (
        "M2 · ⛔ `stalled_by` is hard-wired to null at the public door · a person's real Stop "
        "still writes its neighbouring ask, and `list_tasks` reports the act while naming nobody",
        # ⚑ Re-anchored by `724` (R82): the key is `asked_to_stop_by`; the row is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `asked_to_stop_by` is still emitted by `piecePayload` from `piece.stalledBy` (the person
        # or agent that asked the stop). Only the variable name changed. The plant hard-codes null,
        # so the killer's stalled-by-person and stalled-by-agent expectations fail for the label's
        # reason. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            (TOOLS, '  asked_to_stop_by: piece.stalledBy,\n', '  asked_to_stop_by: null,\n'),
        ],
    ),
    (
        "M3 · 🔴 `given_to_is` is hard-wired to null at the public door · the holder's live "
        "card still says `waiting_permission`, but the task row goes back to the exact state BroBot "
        "could not distinguish from a permanently empty field",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The public door still
        # writes `given_to_is` from the live holder state (now via `agentStateWords(givenToIs)`
        # instead of the old bare `givenToIs`), so hard-wiring it to `null` still plants exactly
        # M3's defect: the structured field goes back to indistinguishable-from-empty while the
        # holder's live card still knows better. Only the RHS expression changed shape (state-object
        # -> word), not the field or the rule.
        [
            (TOOLS, '  given_to_is: givenToIs === null ? null : agentStateWords(givenToIs),', '  given_to_is: null,'),
        ],
    ),
    (
        "M4 · ⚠️ closed history gets the holder's live clause · one conversation's current "
        "permission is again printed on every task it ever held, turning a true conversation-wide "
        "state into a task-specific implication · killed by `state-a-supervisor-can-trust.test.ts` · killed by `one-task-one-reading.test.ts` · killed by `agent-state.render.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The two-part defect —
        # dropping the TASK_IS_OPEN guard so closed history inherits the holder's live clause, and
        # reusing that guard's sentence for a task-specific 'frozen' claim — still applies to the
        # same line, just with the state-object discriminant (`.is === 'needs-you'`) in place of the
        # old bare string. The test suite even keeps an assertion (`not.toContain('frozen:')`) that
        # appears written specifically against this row's own planted wording, confirming the anchor
        # and its replacement text still line up with live coverage.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # closed piece never gets the holder's live 'waiting for a person' clause) survives in
        # `pieceText`: the clause is still guarded by `TASK_IS_OPEN[piece.state]` and `givenToIs?.is
        # === 'needs-you'`. Only the variable renamed and the sentence was reworded. The plant drops
        # the open guard and swaps in the 'frozen' wording the killer forbids. Killed by
        # `state-a-supervisor-can-trust.test.ts`.
        [
            (TOOLS, "    TASK_IS_OPEN[piece.state] && givenToIs?.is === 'needs-you'\n", "    givenToIs?.is === 'needs-you'\n"),
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · F097 (a032e58f) reworded the clause to 'waiting on a person'; edit 0 (the open-task guard) is unchanged
            # ⚑ **a helper stopped on a person · re-anchored in place, not retired** — the clause now ends with what the holder's turn is stopped on, as its card says it; edit 0 (the open-task guard) is unchanged, and the plant still swaps in the 'frozen' wording
            (TOOLS, "      ? ` · the conversation holding it is waiting on a person${theStopOnAPerson(stoppedOnAPerson)}`\n", "      ? ' · frozen: a person is being asked something and only they can clear it'\n"),
        ],
    ),
    (
        "M5 · 🔴 a new turn does not clear the idle ask · cancelling a later permission, "
        "which writes no ask of its own, falsely attributes that new task's interrupted turn to "
        "the person who pressed Stop while nothing was running",
        [
            (
                TASKS,
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-005 put `drivenAgain()` between the reset
                # and the `continue`, so the anchor ends at the reset. Same line, same defect.
                # ⚠️ Its gate-map killer no longer sees it (see the gate map): re-verified RED alone
                # on `the-act-this-app-knows-the-author-of.test.ts` (720's controls).
                "      // author of that older turn's ending. `SessionStore.appendTx` opens turns on this exact event.\n"
                "      asked = null\n",
                "      // author of that older turn's ending. `SessionStore.appendTx` opens turns on this exact event.\n"
                "      asked = asked\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the narrow task read drops `user_turn` · the live fold has the boundary and the "
        "replayed/product read does not, so the same idle person's name crosses into a later task "
        "only after the database is read back",
                # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # narrow piece read must select every type the fold acts on, including `user_turn`, so a
        # replayed read matches the live fold) survives in `selectPieceEvents`. The type list was
        # reflowed when the seven piece events replaced the three task types, so the old two-line
        # anchor went dark. The plant removes `user_turn` from the current single line. Killed by
        # `a-task-you-can-see.test.ts`, `the-work-this-conversation-gave-out.test.ts`.
        [
            (STORE, "                     'user_turn', 'turn', 'status', 'work_interrupted', 'background_work',\n", "                     'turn', 'status', 'work_interrupted', 'background_work',\n"),
        ],
    ),
    (
        "M7 · 🔴 every non-null `stalled_by` becomes the person constant · null causes still "
        "read null and the person's Stop still looks right, while an agent's recorded id is erased",
                # ⚑ Re-anchored by `724` (R82): the key is `asked_to_stop_by`; the row is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # `asked_to_stop_by` payload still distinguishes an agent asker (`{ by: 'an-agent', asker
        # }`) from a person. Only the variable name changed. The plant collapses every non-null
        # cause to the person constant, which the agent-asker case in the killer catches. Killed by
        # `state-a-supervisor-can-trust.test.ts`.
        [
            (TOOLS, '  asked_to_stop_by: piece.stalledBy,\n', "  asked_to_stop_by:\n    piece.stalledBy === null ? null : { by: 'a-person', asker: null },\n"),
        ],
    ),
]
