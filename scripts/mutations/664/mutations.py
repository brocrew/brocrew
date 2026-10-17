"""664 · One task, one reading, in every place it is drawn (`D32`, found by `654`).

⚑ **One task, three places, and until `664` two of them read the RAW fold.** The giver's drawer
walks `workThisOneGaveOut`, which composes through `walkWorkGivenBy`; the receiver's line walks
`workThisOneWasGiven` and the Team forest folds each conversation's own ledger, and neither
composed — **measured on `8e414e9e`: a task whose holder a person owed an answer read
`waiting-on-a-person` in the giver's drawer, `list_tasks` and the Work tab, and `working` on the
receiver's line and in the forest.**

## 🔴 A · what the dispatch CHANGED

⛔ **Both raw readers compose**, through `composeWhatEachTaskIsWaitingOn` and ONE shared memo,
`oneWaitReadPerHolder` — extracted from the two readers that spelled it inline
(`walkWorkGivenBy`, `stalledWorkNobodyWasToldAbout`), which lose nothing by sharing it.

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on the memo's LIFETIME in the forest** (built once per walk rather than once per
conversation): every holder appears in the forest exactly once, so a per-conversation memo takes
the same one read per holder — a row there would be a true mutation, and a true mutation measures
nothing. ⚠️ **No row on the two extracted callers**: they asked the same memo before `664`, and
`603`/`609`'s tables already hold their composition.

## ⚑ C · the killers

`apps/desktop/test/one-task-one-reading.test.ts` — §1 (five readings of one waiting task, with the
untinted control), §2 (the counted price: one proposal read per holder), §3 (the census of every
call). Every row verified RED by hand, anchor count `== 1`, restored from saved bytes.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"

THE_TAKEN_WALK = (
    "          composeWhatEachTaskIsWaitingOn(tasksOfSession(held, noteSkip), waiting).map((task) =>\n"
)
THE_FOREST_ROWS = (
    "            ...composeWhatEachTaskIsWaitingOn(tasksOfSession(sessionId, noteSkip), waiting).map(\n"
)
THE_MEMO = "      if (mine !== undefined) return mine\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **the receiver's line goes back to the raw fold** · `D32` itself, at the band's "
        "taken end: one task reads `waiting-on-a-person` in the giver's drawer and `working` on the "
        "line of the conversation that holds it — two states at the two ends of one edge",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: one piece reads one state at both ends of an edge, so the receiver's line must
        # compose. workThisOneWasGiven now folds through
        # composeWhatEachPieceIsWaitingOn(piecesOfSession(held, noteSkip), waiting). The killer was
        # re-aimed at give_work pieces in 5e931be8 and is keyed by piece id. Killed by
        # `one-task-one-reading.test.ts`.
        [
            (STORE, '          composeWhatEachPieceIsWaitingOn(piecesOfSession(held, noteSkip), waiting).map((piece) =>\n', '          piecesOfSession(held, noteSkip).map((piece) =>\n'),
        ],
    ),
    (
        "M2 · 🔴 **the Team forest's task rows go back to the raw fold** · the same task reads "
        "`working` in the forest while its giver's drawer tints it as a person's to answer",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the Team forest's piece rows must compose as the giver's drawer does (D32). The
        # forest's per-owner fold is now composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId,
        # noteSkip), waiting). The plant puts the raw fold back there. Killed by
        # `one-task-one-reading.test.ts`.
        [
            (STORE, '            ...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).map(\n', '            ...piecesOfSession(sessionId, noteSkip).map(\n'),
        ],
    ),
    (
        "M3 · ⚠️ **the memo forgets** · every OPEN row takes the four narrow reads of its holder "
        "instead of one read per holder — the bound `walkWorkGivenBy` held since `603`, lost on "
        "every reader that shares it at once, on reads a window polls",
        [(STORE, THE_MEMO, "      if ((false as boolean) && mine !== undefined) return mine\n")],
    ),
]
