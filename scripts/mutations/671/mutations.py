"""671 · What main hands the cards (`658` G1/G2, `667` G4a/G5a, and R18 — `664` F1 ruled).

⚑ **Five facts the renderer could not draw because main never sent them, and one ruling.**

## 🔴 A · what the dispatch CHANGED

- **G1** — `message_sent` carries the words, cut at `REPLY_SUMMARY_LIMIT` (the bound on every other
  string one agent writes into another conversation) and MARKED `clipped` when cut.
- **G2** — the relayed `user_turn` names the task it OPENED (`taskId`), on the idle branch from
  `TurnFacts.taskToQuote` and on the held branch from the flushed message; bounded on replay.
- **G4a** — `LibraryEntry.profileId`, on an `origin: 'ours'` entry and on no other.
- **G5a** — `agentName` folds its own fallback.
- **R18** — the two statements that raised on a torn payload guard it first; every skipped row is
  counted ONCE per walk (`RowsUnread`), the wait reads count into the walk that asked, and
  `list_tasks` carries `rows_unread` and says it.
- **From `671`'s own review** — the G1 cut never splits a surrogate pair (`M20`); the stalled
  queue's receipt read counts into its walk (`M21`); the card's ask-to-stop read, which `list_tasks`
  reaches per holder, guards its payload and passes over a torn row (`M22`, `M23`).

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on `noteUnreadRow`'s warning**: a log line no test can read is not a rail. ⚠️ **No row
on the superseded-generation clause of the assignment scan**: a torn row in a superseded projection
is a row no reader opens, so dropping the clause changes a count nothing can reach from a real
ledger without a rebuild harness — named here rather than faked. ⚠️ **No row on the forest's shared
memo alone**: `M19` sends the forest's wait reads to a counter of their own, which is that subject.

## ⚑ C · the killers

`apps/desktop/test/what-main-hands-the-cards.test.ts` (§1–§5), with `one-task-one-reading.test.ts`
§2 and `who-called-whom.test.ts` §3 re-aimed in this dispatch, and `a-row-that-says-who-is-in-it`
for G5a. Every row verified RED by hand, anchor count `== 1`, restored from saved bytes.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
LIB = "apps/desktop/src/main/library/session-library.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"

THE_WORDS = "      text: words.slice(0, headOf(words, REPLY_SUMMARY_LIMIT)),\n"
THE_CUT_MARK = "      ...(words.length > REPLY_SUMMARY_LIMIT ? { clipped: true as const } : {}),\n"
THE_IDLE_TASK = "      ...(facts.taskToQuote === undefined ? {} : { taskId: facts.taskToQuote }),\n"
THE_HELD_TASK = "      ...(queued.taskId === undefined ? {} : { taskId: queued.taskId }),\n"
THE_TASK_BOUND = "  if (isAStoredId(stored)) return event\n"
THE_OURS_ONLY = "    ...(origin === 'ours' ? { profileId: row.profileId ?? DEFAULT_PROFILE_ID } : {}),\n"
THE_FOLDED_FALLBACK = "  return named ?? profileLabel(slug)\n"
THE_SCAN_GUARD = (
    "                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload\n"
    "               FROM events) e\n"
)
THE_QUESTION_GUARD = (
    "                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload\n"
    "               FROM events\n"
)
THE_SCAN_NOTE = "      noteUnreadRow(row.id, row.unreadAt, unread?.in(row.id))\n"
THE_QUESTION_NOTE = "        noteUnreadRow(sessionId, row.ordinal, noteSkip)\n"
THE_ONE_ROW_ONCE = "      seen.add(`${sessionId}\\u0000${String(ordinal)}`)\n"
THE_WAIT_COUNTED = "      const outstanding = whatThisConversationIsWaitingOn(holder, unread)\n"
THE_PAYLOAD_COUNT = "              rows_unread: rowsUnread,\n"
# ⚑ 676 · anchor CORRECTED, not retired: `reportOn` and `whatEachConversationIsWaitingOn` spell the
# same line now, so the anchor carries `tasksVisibleTo`'s next line to stay its own.
THE_ANSWER_COUNTED = (
    "    const waiting = this.oneWaitReadPerAnswer(unread)\n"
    "    const given = composeWhatEachTaskIsWaitingOn(\n"
)
THE_STALL_SHARES = (
    "      const waiting = oneWaitReadPerHolder(unread)\n"
    "      const walked = walkLedgers(\n"
    "        'every-conversation-that-was-given-work',\n"
)
THE_FOREST_SHARES = (
    "      const waiting = oneWaitReadPerHolder(unread)\n"
    "      return walkLedgers(\n"
    "        'every-conversation-this-app-placed',\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── G1 · the words on the receipt ───────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the receipt carries the words UNBOUNDED** · a message of any length is copied "
        "whole into the sender's ledger, and the bound `671` derived from the family is gone",
        [(HOST, THE_WORDS, "      text: words,\n")],
    ),
    (
        "M2 · 🔴 **a cut is not SAID** · the receipt holds the head of a longer message and reads as "
        "the whole of it — `614`'s *a cut that is not said reads as the whole*",
        [(HOST, THE_CUT_MARK, "")],
    ),
    (
        "M3 · ⛔ **the receipt carries no words at all** · `658` G1 back: the sender's card has the "
        "call's 200-character summary and nothing else",
        [(HOST, THE_WORDS, "")],
    ),
    (
        "M20 · ⚠️ **the cut splits a character** · an astral character straddling unit 1,280 leaves a "
        "lone high surrogate on the stored receipt, which every later read draws as U+FFFD",
        [
            (
                HOST,
                "  return before >= 0xd800 && before <= 0xdbff ? limit - 1 : limit\n",
                "  return limit\n",
            )
        ],
    ),
    # ── G2 · the turn names its task ────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 **the IDLE branch's turn names no task** · `658` G2 itself: the receiver cannot tell "
        "work that went straight out from a question",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives, with the task id replaced by the piece: the turn the receiver runs when a brief
        # goes straight out names its piece and label (`658` G2). `taskId: facts.taskToQuote` is now
        # `piece` and `label` from `facts.giving` in `sendAs`'s `user_turn`. Deleting that spread
        # leaves the receiver unable to tell a brief from a question. Killed by
        # `what-main-hands-the-cards.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # idle branch's user_turn still names its piece, but D-016c builds that from `handing =
        # this.thePieceItCarries(facts)` (a give or a new brief) instead of `facts.giving`, so the
        # old three-line spread matches nothing. The new one-line anchor removes the same `piece`
        # and `label` spread from the idle user_turn, which is the label's defect. Killed by
        # `what-main-hands-the-cards.test.ts`.
        [
            (HOST, '      ...(handing === null ? {} : { piece: handing.piece, label: handing.label }),\n', ''),
        ],
    ),
    (
        "M5 · ⛔ **the HELD branch's flushed turn names no task** · the branch that was linked only "
        "while it waited loses the link the moment it is handed over",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a held brief keeps its link to the piece when it is flushed into a turn. The old
        # `queued.taskId` spread is now `queued.piece` and `queued.label` in the held-flush
        # `user_turn`; the anchor includes the `...(` and `? {}` lines, which tells it apart from
        # the other occurrence near line 15074. Deleting it drops the link the moment the message is
        # handed over. Killed by `what-main-hands-the-cards.test.ts`.
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
            (HOST, "        ...(queued.piece === undefined || queued.label === undefined\n          ? {}\n          : { piece: queued.piece, label: queued.label }),\n", ""),
        ],
    ),
    (
        "M6 · ⚠️ **replay keeps any stored task id** · a row written by a later build, or edited, "
        "hands the renderer's join key a value this app could never have minted",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: replay drops a stored piece id this app could not have minted (over 200
        # characters, or not a string). The old `isAStoredId(stored)` line is now `const aPiece =
        # isAStoredId(event.piece)` in `boundPieceNamed`. Making it always true keeps any stored
        # value, and the test's 201-character and numeric ids come back on the event. Killed by
        # `what-main-hands-the-cards.test.ts`.
        [
            (STORE, '  const aPiece = isAStoredId(event.piece)\n', '  const aPiece = (true as boolean) || isAStoredId(event.piece)\n'),
        ],
    ),
    # ── G4a · a recording names its agent ───────────────────────────────────────────────────────
    (
        "M7 · 🔴 **every origin names an identity** · a conversation from the person's own provider "
        "home, and a bundle another machine ran, are named as agents of this app",
        [(LIB, THE_OURS_ONLY, "    ...(true ? { profileId: row.profileId ?? DEFAULT_PROFILE_ID } : {}),\n")],
    ),
    (
        "M8 · ⚠️ **a pre-profile row names nobody** · a conversation that ran in the default profile "
        "before profiles could be chosen is handed an empty identity",
        [(LIB, THE_OURS_ONLY, "    ...(origin === 'ours' ? { profileId: row.profileId ?? '' } : {}),\n")],
    ),
    # ── G5a · one spelling ──────────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 **the fallback is the directory spelling again** · `Dev` beside `dev` on one card, "
        "and every future caller must remember `oneSpelling`",
        [(IPC, THE_FOLDED_FALLBACK, "  return named ?? profileLabel(profileId)\n")],
    ),
    # ── R18 · skipped, counted, SAID ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was the
        # assignment scan that read every `task_assigned` row in the database through `CASE WHEN
        # json_valid(payload)`. 5e931be8 removed it on purpose: tasks and `task_assigned` are
        # replaced by pieces, and "the project, proposal, binding, home and document tables go;
        # work, work_sequence and work_resource come". `selectOwnersGivenWorkBy` now reads the
        # `work` table, and its docblock says "no ledger is scanned to find them, and a torn ledger
        # row cannot hide one", so the CASE guard has no statement left to sit in. Its anchor is
        # left stale, so the census records it retired.
        "M10 · 🔴 **the assignment scan extracts from an unguarded payload** · `664` F1 back: one torn "
        "`task_assigned` row anywhere RAISES the forest, the line, the drawer, `list_tasks` and the "
        "stalled-work queue",
        [(STORE, THE_SCAN_GUARD, "                    payload AS payload\n               FROM events) e\n")],
    ),
    (
        "M11 · 🔴 **the questions statement extracts from an unguarded payload** · one torn question "
        "row in a holder's ledger raises every wait read of that holder",
        [(STORE, THE_QUESTION_GUARD, "                    payload AS payload\n               FROM events\n")],
    ),
    (
        "M12 · ⛔ **the scan's torn rows are skipped UNCOUNTED** · the drawer answers and says it read "
        "everything, about a row it could not read",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece model: a torn row met while folding a ledger is skipped but must be
        # counted, so the drawer, line, forest, `list_tasks` and stalled queue do not claim they
        # read everything. The scan that carried the old anchor is gone, and the counting now lives
        # in the catch block of `toPersistedEvents`, whose only `noteSkip?.(row.ordinal)` is the
        # call that feeds every `LedgerWalk.rowsUnread`. Planting `void noteSkip` there skips the
        # torn row uncounted. Killed by `what-main-hands-the-cards.test.ts`.
        [
            (STORE, 'noteSkip?.(row.ordinal)', 'void noteSkip'),
        ],
    ),
    (
        "M13 · ⛔ **a torn question row is skipped UNCOUNTED** · the wait read goes quietly short",
        [(STORE, THE_QUESTION_NOTE, "        noteUnreadRow(sessionId, row.ordinal, undefined)\n")],
    ),
    (
        "M14 · ⚠️ **one row met twice is counted twice** · the forest meets a torn assignment in its "
        "own fold AND in a holder's scan, and reports one row as two",
        [
            (
                STORE,
                THE_ONE_ROW_ONCE,
                "      seen.add(`${sessionId}\\u0000${String(ordinal)}\\u0000${String(seen.size)}`)\n",
            )
        ],
    ),
    (
        "M15 · 🔴 **the wait read counts into nobody** · a composed walk's wait reads skip their torn "
        "rows silently — `664` F4, back",
        [(STORE, THE_WAIT_COUNTED, "      const outstanding = whatThisConversationIsWaitingOn(holder)\n")],
    ),
    (
        "M16 · 🔴 **`list_tasks` carries no count** · the model is handed lists short by a row and "
        "`rows_unread: 0`, which is the one number that must not be a constant",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `list_tasks` carries the unread-row count in its payload, and `0` must be a
        # measurement and not a constant. The anchor moved from `rows_unread: rowsUnread,` to the
        # `PieceBoard` field read in the no-argument board branch of `list_tasks`, `rows_unread:
        # board.rowsUnread,`. Planting the constant `0` there hides every torn row from the model.
        # Killed by `what-main-hands-the-cards.test.ts`.
        [
            (TOOLS, 'rows_unread: board.rowsUnread,', 'rows_unread: 0,'),
        ],
    ),
    (
        "M17 · ⛔ **`list_tasks`' wait reads count into nobody** · the tool's lists compose through a "
        "memo that was never handed the answer's counter",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the wait reads behind `list_tasks` must count into the answer's own counter.
        # `composeWhatEachTaskIsWaitingOn` and the `given` half became `RuntimeHost.pieceBoard`,
        # whose memo is `this.oneWaitReadPerAnswer(unread)`. Dropping the argument makes the wait
        # reads count into nobody, while `pieceRecord`'s identical line is left alone by the
        # two-line anchor. Killed by `what-main-hands-the-cards.test.ts`.
        [
            (HOST, '    const waiting = this.oneWaitReadPerAnswer(unread)\n    const root = this.deps.store.rootOf(sessionId)\n', '    const waiting = this.oneWaitReadPerAnswer()\n    const root = this.deps.store.rootOf(sessionId)\n'),
        ],
    ),
    (
        "M18 · ⚠️ **the stalled-work queue's wait reads count into a counter nobody reads** · the "
        "person's stall band goes quietly short",
        [
            (
                STORE,
                THE_STALL_SHARES,
                THE_STALL_SHARES.replace("oneWaitReadPerHolder(unread)", "oneWaitReadPerHolder(rowsUnreadOnce())"),
            )
        ],
    ),
    (
        "M19 · ⚠️ **the forest's wait reads count into a counter nobody reads** · the Team page says "
        "nothing is missing about a row its composition could not read",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the forest's wait reads count into the forest's own `RowsUnread`, so the Team
        # page says a row could not be read. The forest is now the `everyPlacedConversation` walk,
        # and its `oneWaitReadPerHolder(unread)` call is one of four with the same text, so the
        # anchor takes the comment line above it, which is unique. Planting a fresh
        # `rowsUnreadOnce()` gives the wait reads a counter nobody reads, and `unread` stays used by
        # `walkLedgers`. Killed by `what-main-hands-the-cards.test.ts`.
        [
            (STORE, 'and the forest still ANSWERS.\n      const unread = rowsUnreadOnce()\n      const waiting = oneWaitReadPerHolder(unread)\n', 'and the forest still ANSWERS.\n      const unread = rowsUnreadOnce()\n      const waiting = oneWaitReadPerHolder(rowsUnreadOnce())\n'),
        ],
    ),
    # ── R18 · the two reads `671`'s own review found ─────────────────────────────────────────────
    (
        "M21 · 🔴 **the stalled queue's receipts are read UNCOUNTED** · a torn `work_reported` lists "
        "work as never told while the queue claims it read every row",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the stalled queue reads each giver's receipts through the walk's counter, so a
        # torn `work_stall_told` (formerly `work_reported`) is counted and not listed as never told.
        # The call is now `stallsToldToSession(giver, unread.in(giver))` in the stalled-work walk.
        # Dropping the second argument reads the receipts uncounted. Killed by
        # `what-main-hands-the-cards.test.ts`.
        [
            (STORE, 'const receipts = stallsToldToSession(giver, unread.in(giver))', 'const receipts = stallsToldToSession(giver)'),
        ],
    ),
    (
        "M22 · 🔴 **the card's ask-to-stop read does not handle a torn row at all** · neither the "
        "guard nor the filter: one torn `user_decision` in a holder's ledger RAISES every card of it, "
        "and `list_tasks` with them. ⚠️ **Both halves, because the guard alone is unmeasurable**: with "
        "`readable` in the WHERE, this SQLite evaluates the filter first and the unguarded "
        "`json_extract` never meets the torn row — measured, dropping the CASE alone survived the "
        "whole suite. The CASE is kept because that order is not promised · killed by `what-main-hands-the-cards.test.ts` · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                # ⚑ **W4.265 · re-anchored in place, not retired** — W4.265 · the ask-to-stop read now goes through the fold index; the plant still drops both the readable guard and its filter, so one torn row raises the card
                "                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload\n               FROM events INDEXED BY events_fold_idx WHERE ${FOLD_TERM})\n      WHERE session_id = ? AND generation = ? AND readable\n",
                "                    payload AS payload\n               FROM events INDEXED BY events_fold_idx WHERE ${FOLD_TERM})\n      WHERE session_id = ? AND generation = ?\n",
            )
        ],
    ),
    (
        "M23 · ⚠️ **a torn row is a candidate for the last ask** · a torn NEWEST ask stands in front "
        "of the readable one before it, and the card says nobody asked",
        [
            (
                STORE,
                "      WHERE session_id = ? AND generation = ? AND readable\n",
                "      WHERE session_id = ? AND generation = ?\n",
            )
        ],
    ),
]
