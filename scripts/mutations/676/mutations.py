"""676 · The rest of R18, and the answer with no bound (`671` F1–F4).

⚑ **`671` closed R18 on the five walks it was given and named four things it did not reach.** This
table breaks each of the four the way it was before `676`, one row at a time.

## 🔴 A · what the dispatch CHANGED

- **F2** — `selectTaskNumberInProject` guards its payload (`671`'s `CASE` in a subquery), so a torn
  assignment in a project no longer RAISES document registration; `no-such-task` carries how many
  rows of the project the lookup could not read (`rows_unread` in the refusal's detail).
- **F4** — `answer_question`'s own words reach the asker cut at `REPLY_SUMMARY_LIMIT` and MARKED in
  the words, on both branches; a chosen label is never cut; the answerer is told which parts.
- **F1** — `list_projects` and `whatEachConversationIsWaitingOn` (the Team plates and the rail)
  count what their reads could not read, and `list_projects` says it in `list_tasks`' words.
- **F3** — an agent card counts the rows its two ledger reads passed over (`AgentCard.rowsUnread`).
- **The wider search** — four more statements RAISED on one torn row, measured: the routing scan
  (every agent's `list_questions`/`answer_question`), the stranded-message sweep (the next LAUNCH),
  the reopen's attachment grant, and the limit band's retraction read. Each is guarded; the rows a
  counted reader meets are counted (`list_questions`' `rows_unread`, the limit walk's `rowsUnread`),
  and the two with no payload (launch, reopen) warn.
- **From `676`'s own review** — the stranded sweep's torn ending blocks only what was queued
  before it (`M37`); the child's last words are guarded and a torn one is SAID as unreadable
  (`M38`, `M39`); F4 bounds the whole answer, not each string, never marks a blank string and drops
  a part nobody asked (`M40`–`M42`).
- **Once `675` had landed** — the card's count, `list_questions`' count and a cut answer are said in
  the words each tool answers with (`M43`–`M45`).

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on the three notice pushes' absent count** — it is a docblock argument
(`RuntimeHost.oneWaitReadPerAnswer`), and a row cannot break a count that is not there. §3's push
test pins that the push still FIRES over a torn row, which is behaviour `671` already had.
⚠️ **No row on `taskNumberInProject`'s bare number** — nothing in the product reads it.
⚠️ **No row on the launch sweep's or the reopen's WARNING** — a log line no test can read is not a
rail (`671`'s stance); what they guard is rowed (`M31`–`M33`).
⚠️ **No row on the torn-clear count's GENERATION clause** — a copied torn clear needs a rebuild to
exist, and no harness here makes one; named rather than faked (`671`'s stance on the same clause).
⚠️ **No row on the mark's wording** — `M7` removes the mark, which is the subject; a reworded mark
is a sentence, and the test pins its two numbers rather than its prose.

## ⚑ C · the killers

`apps/desktop/test/the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (§1 F2 · §2 F4 · §3 F1 ·
§4 F3 · §5 the wider search), each row verified RED alone with `scripts/mutations/verify_row.py`.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REGISTRY = "apps/desktop/src/main/documents/document-registry.ts"

THE_NUMBER_GUARD = (
    "                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload\n"
    "               FROM events) assigned\n"
)
THE_TORN_CANDIDATES = (
    "        AND (json_extract(assigned.payload, '$.taskId') = ? OR NOT assigned.readable)\n"
)
THE_COUNTED_TORN = (
    "        noteUnreadRow(row.ledger, row.unreadAt, undefined)\n"
    "        rowsUnread += 1\n"
)
THE_REFUSAL_COUNT = "          return { ok: false, rail: 'no-such-task', rowsUnread: found.rowsUnread }\n"
THE_DETAIL_COUNT = (
    "        ...(opened.rail === 'no-such-task' ? { rows_unread: opened.rowsUnread } : {}),\n"
)
# ⚑ The F4 anchors are the WHOLE-answer helper `676`'s review made of the per-string one.
# ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 replaced `let left = REPLY_SUMMARY_LIMIT` (cut budget) with a refusal of `measured.units > REPLY_SUMMARY_LIMIT` placed ahead of both branches. With an infinite limit, an answer of any length reaches the asker whole on both branches. Caught by the HELD-branch and PROVIDER-branch refusal tests.
THE_BOUND = "    if (measured.units > REPLY_SUMMARY_LIMIT) {\n"
THE_LABEL_KEPT = "    return question === undefined || !isOfferedLabel(question, said)\n"
THE_PARTS_NAMED = "      cut.add(one.part)\n"
THE_HEAD = "      const head = left > 0 ? said.slice(0, headOf(said, left)) : ''\n"
THE_MARK = (
    "    if (answer !== undefined) answer[one.member] = one.head === '' ? mark : `${one.head}\\n${mark}`\n"
)
# ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 turned the per-string budget loop into a total `units` (oneAgentsAnswer). Measuring the longest string instead of the sum makes the bound per string again, so ten strings of 1,280 pass. 'the bound is on the WHOLE answer' expects a refusal with was: 12800.
THE_BUDGET_SPENT = "    .reduce((total, said) => total + said.length, 0)\n"
THE_ASKED_PARTS = (
    "    known === undefined ? given : given.filter((one) => questionOf(one.part) !== undefined)\n"
)
THE_BLANK = (
    # ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 moved blank-to-'' out of the cut loop into oneAgentsAnswer's `answers` map. The plant delivers a blank as it came. The BLANK-string test expects given.answers.q0 to equal ['A', ''].
    "    answer: one.answer.map((said) => (said.trim() === '' ? '' : said)),\n"
)
THE_LAST_WORDS_GUARD = (
    "        AND CASE WHEN json_valid(payload)\n"
    "                 THEN json_extract(payload, '$.parentToolCallId') IS NULL\n"
    "                 ELSE 1\n"
    "            END\n"
    "        AND turn_id = (SELECT id FROM turn\n"
)
THE_UNREADABLE_WORDS = "      return ITS_WORDS_COULD_NOT_BE_READ\n"
# ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 renamed `bounded` to `measured` (oneAgentsAnswer). The provider branch is handed the raw input. Blank strings of any length are not counted against the bound, so they reach the provider whole: the test sending 1,300 spaces expects ['A', ''].
THE_PROVIDER_ANSWERS = "    for (const one of measured.answers) answers[one.part] = [...one.answer]\n"
THE_HELD_ANSWERS = (
    # ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 renamed `bounded` to `measured`. The held branch delivers the raw input, so a part the question never asked (not counted, any length) reaches the asker. The '⛔ a part the question never asked does not reach the asker' case catches it.
    "      const said = measured.answers.map((one) => ({ part: one.part, answer: [...one.answer] }))\n"
)
THE_PLATES_COUNTED = (
    "    const waiting = this.oneWaitReadPerAnswer(unread)\n"
    "    const conversations = [...this.slots.entries()].flatMap(\n"
)
THE_PLATES_PAYLOAD = "    return { conversations, readAt: Date.now(), rowsUnread: unread.count }\n"
THE_REPORT_WAITS = (
    "    const waiting = this.oneWaitReadPerAnswer(unread)\n"
    "    return slugs.map((slug) => {\n"
)
THE_REPORT_TASKS = (
    "      const tasks = composeWhatEachTaskIsWaitingOn(this.deps.store.tasksIn(slug, unread), waiting)\n"
)
THE_NAMED_COUNT = "      return { outcome: 'ok', projects, reach, rowsUnread: unread.count }\n"
THE_LISTED_COUNT = (
    "      unread,\n"
    "    )\n"
    "    return { outcome: 'ok', projects, reach, rowsUnread: unread.count }\n"
)
THE_TOOL_COUNT = "              rows_unread: reading.rowsUnread,\n"
THE_TOOL_SENTENCE = (
    "              ...(reading.rowsUnread === 0 ? [] : [unreadRowsSentence(reading.rowsUnread)]),\n"
)
THE_CARD_COUNT = "      rowsUnread: unread.count,\n    }\n  }\n"
THE_CARD_ASK = "      lastAskToStop: this.deps.store.lastAskToStop(slot.id, unread),\n"
THE_CARD_ENDING = "      lastEndedTurn: this.deps.store.lastEndedTurn(slot.id, unread),\n"
THE_PASSED_OVER = "row?.ordinal ?? -1"
THE_TORN_ONLY = (
    "        AND type IN ('work_interrupted', 'user_decision')\n"
    "        AND NOT json_valid(payload)`,\n"
)
THE_EARLY_RETURN_AFTER = (
    "    // 🔴 **676 · F3 — every torn row the read passed over, warned always and counted when asked** —\n"
)

THE_ROUTING_GUARD = (
    "                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload\n"
    "               FROM events) routed\n"
)
THE_ROUTING_COUNTED = (
    "        noteUnreadRow(candidate.id, candidate.unreadAt, unread?.in(candidate.id))\n"
)
THE_QUESTIONS_COUNT = "              rows_unread: listed.rowsUnread,\n"
THE_QUESTIONS_SET = "    const questions = this.questionsWaitingOn(sessionId, unread)\n"
THE_NAMED_ONLY = (
    # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep now reads each conversation's queue rows in one query and pairs them in code; the plant still reads a torn row's id raw, so one torn queued message makes the next launch raise
    "            CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') END AS message_id,\n            CASE WHEN type = 'message_queued' AND json_valid(payload)\n"
)
THE_TORN_ENDING = "                       WHEN NOT json_valid(u.payload) THEN u.ordinal > q.ordinal\n"
THE_ATTACHMENTS_GUARD = (
    "        AND CASE WHEN json_valid(payload)\n"
    "                 THEN json_extract(payload, '$.attachments') IS NOT NULL\n"
    "                 ELSE 1\n"
    "            END\n"
)
THE_CLEAR_WINDOW = (
    "    `SELECT e.session_id, ps.provider AS provider,\n"
    "            CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.window') END AS window,\n"
)
# Source targeting only, NOT VERIFIED: preserve the torn-clear guards around the date predicate.
THE_CLEAR_FILTER = "      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001) AND json_valid(e.payload)\n"
THE_CLEAR_COUNTED = (
    "            noteUnreadRow(sessionId, ordinal, undefined)\n            rowsUnread += 1\n"
)

# Resume no longer re-grants handed paths. Keep the removed-code anchor recorded as retired.
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── F2 · the lookup a document registers through ───────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The commit deleted the
        # killer test's section 1 on purpose: 'D-016 · §1 went with its subject. It measured
        # `selectTaskNumberInProject`... Documents became a reply's resources... no registration to
        # raise and no project sequence to read.' `selectTaskNumberInProject`, the project sequence
        # and the `documents/` directory no longer exist, so the guarded number lookup has no home.
        # Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 **the number lookup reads the raw payload again** · `671` F2 back: one torn "
        "assignment in a project RAISES every document registration against a task there — "
        "killed by §1's *the arm that RAISED*",
        [(STORE, THE_NUMBER_GUARD, "                    payload AS payload\n               FROM events) assigned\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The 'torn row is a
        # candidate' predicate sat in the project task-number lookup that D-016 removed with
        # documents and projects (test note: 'there is no registration to raise and no project
        # sequence to read'). The `assigned.readable` statement and its `taskId`/`projectSlug` match
        # are gone. Nothing in the piece model refuses a registration over a torn row. Its anchor is
        # left stale, so the census records it retired.
        "M2 · ⛔ **a torn row is not a candidate** · the guard holds, so nothing raises — and the "
        "refusal reads `rows_unread: 0` beside a torn assignment it never looked at",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired —
        # `selectTaskNumberInProject` still counts a torn `task_assigned` row as a candidate, now
        # inside a two-column `(taskId = ? AND projectSlug = ?) OR NOT assigned.readable` clause,
        # and 'a torn row is not a candidate, so rows_unread reads 0' is still a live defect. Drop
        # the `OR NOT assigned.readable` arm and keep the parentheses balanced.
        [
            (STORE, "        AND ((json_extract(assigned.payload, '$.taskId') = ?\n              AND json_extract(assigned.payload, '$.projectSlug') = ?)\n             OR NOT assigned.readable)`,\n", "        AND (json_extract(assigned.payload, '$.taskId') = ?\n              AND json_extract(assigned.payload, '$.projectSlug') = ?)`,\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The `noteUnreadRow(...);
        # rowsUnread += 1` counting lived in that same project task-number lookup, whose
        # `no-such-task` answer went with it. The killer's section 1 ('the arm that RAISED') was
        # deleted as 'gone with D-016'. The surviving torn-row counts are the piece reads (M16, M18,
        # M20 and M21). Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ **the lookup does not count what it skipped** · the torn row is warned and "
        "forgotten; `no-such-task` states *there is no such task* as a fact with `0` beside it",
        [(STORE, THE_COUNTED_TORN, "        noteUnreadRow(row.ledger, row.unreadAt, undefined)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The store's `no-such-task`
        # refusal arm that handed up `rowsUnread` is gone: the rail is not in `0000_the_tree` or the
        # store, and the commit deleted the test section that measured it ('§1 went with its
        # subject'). The refusal it carried had no successor. Its anchor is left stale, so the
        # census records it retired.
        "M4 · ⛔ **the store's refusal drops the count** · the lookup counted it and the "
        "`no-such-task` arm hands `0` up",
        [
            (
                STORE,
                THE_REFUSAL_COUNT,
                "          return { ok: false, rail: 'no-such-task', rowsUnread: 0 }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The anchor file
        # `apps/desktop/src/main/documents/document-registry.ts` was deleted by the commit
        # ('Documents became a reply's resources... a reply's files are resources'). Its
        # `no-such-task` refusal detail with `rows_unread` went with it, and the rest of the
        # documents directory is gone too. Its anchor is left stale, so the census records it
        # retired.
        "M5 · ⛔ **the refusal a model reads carries no count** · the fact stops at the registry, "
        "and `rows_unread` is absent from `no-such-task`'s detail",
        [(REGISTRY, THE_DETAIL_COUNT, "")],
    ),
    # ── F4 · the answer's bound ────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 **the answer is UNBOUNDED again** · `671` F4 back: an agent's answer of any length "
        "reaches the asker whole, on both branches · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (named by W4.78)",
        [(HOST, THE_BOUND, "    if (measured.units > Number.POSITIVE_INFINITY) {\n")],
    ),
    (
        "M7 · 🔴 **a cut is not SAID** · the asker holds the first 1,280 units and reads them as the "
        "whole answer — `614`'s *a cut that is not said reads as the whole*",
        [(HOST, THE_MARK, "    if (answer !== undefined) answer[one.member] = one.head\n")],
    ),
    (
        "M8 · ⛔ **a chosen LABEL is cut too** · an offered option longer than the bound is cut, "
        "no longer matches, and a correct answer is refused as *not one of the offered options*",
        [(HOST, THE_LABEL_KEPT, "    return true\n")],
    ),
    (
        "M9 · ⚠️ **the answerer is not told** · the asker holds a cut answer and the caller's "
        "`cut` is empty, so it believes all of it went",
        [(HOST, THE_PARTS_NAMED, "")],
    ),
    (
        "M10 · ⚠️ **the cut splits a character** · an astral character straddling unit 1,280 leaves "
        "a lone high surrogate in the asker's turn",
        [(HOST, THE_HEAD, "      const head = left > 0 ? said.slice(0, left) : ''\n")],
    ),
    (
        "M11 · 🔴 **the PROVIDER branch hands over the raw answer** · the bounded copy is computed "
        "and a provider-raised question is answered with the unbounded one · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (named by W4.78)",
        [
            (
                HOST,
                THE_PROVIDER_ANSWERS,
                "    for (const one of input.answers) answers[one.part] = [...one.answer]\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **the HELD branch delivers the raw answer** · a question this app holds is answered "
        "in the asker's turn with the unbounded words · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (named by W4.78)",
        [
            (
                HOST,
                THE_HELD_ANSWERS,
                "      const said = input.answers.map((one) => ({ part: one.part, answer: [...one.answer] }))\n",
            )
        ],
    ),
    # ── F1 · the Team plates, the rail, and list_projects ───────────────────────────────────────
    (
        # ⚑ Landing D-017 (5206d835) · killer:
        # `a-closed-childs-torn-assignment-is-missed-by-the-plates-alone.test.ts` (the landing added
        # it: a question row can no longer reach the torn argument, so the row now shows through a
        # closed child's torn assignment).
        "M13 · 🔴 **the plates' wait reads count into nobody** · a torn question row makes a "
        "conversation read *waiting on nothing* and the answer says every row was read",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The Team-plates/rail
        # reader `whatEachConversationIsWaitingOn` still builds its own `unread` accumulator and
        # passes it into `oneWaitReadPerAnswer`, now alongside a shared `ledger` argument. Dropping
        # `unread` (passing `undefined`) reproduces 'a torn wait row counts into nobody' at the
        # reshaped call site.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives (the Team plates'/rail's answer must count rows its wait reads
        # could not read) but DEV's suggested plant, `oneWaitReadPerAnswer(undefined, ledger,
        # workOut)`, would now survive: since D-017 the question rows are read through `ledger` and
        # since D-036 the open-work scan through `workOut`, both built on the real `unread`, so the
        # argument only feeds readOrSkip's skip-note. The re-anchor therefore strips `unread` from
        # the two reads whose counts the plates carry (checked by reading, not by running). The
        # closed-child file's kill case meets its torn work_given row only through `workOut`, and
        # the r18 §3 torn user_input_request case only through `ledger`. Killed by
        # `a-closed-childs-torn-assignment-is-missed-by-the-plates-alone.test.ts`,
        # `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`.
        [
            (HOST, '    const ledger = this.oneLedgerReadPerAnswer(unread)\n    const workOut = this.oneWorkOutReadPerAnswer(unread)\n', '    const ledger = this.oneLedgerReadPerAnswer()\n    const workOut = this.oneWorkOutReadPerAnswer()\n'),
        ],
    ),
    (
        "M14 · ⛔ **the plates' answer drops its count** · counted, and `0` on the wire",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same return site as
        # 621:M9 (whatEachConversationIsWaitingOn's LAST return), now also carrying
        # `...ledgersSkippedOf(...)`. `rowsUnread: unread.count` is still 676 F1's own carried count
        # for the Team plates/rail answer; zeroing it still drops the count on the wire regardless
        # of what was actually unread.
        [
            (HOST, '    return {\n      conversations,\n      readAt: Date.now(),\n      rowsUnread: unread.count,\n      ...ledgersSkippedOf(unread.ledgersSkipped),\n    }\n', '    return {\n      conversations,\n      readAt: Date.now(),\n      rowsUnread: 0,\n      ...ledgersSkippedOf(unread.ledgersSkipped),\n    }\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `list_projects`' `reportOn` and its
        # wait reads are deleted (D-016a removes `list_projects`). The surviving reader of that
        # rule, `tasksVisibleTo`'s `oneWaitReadPerAnswer(unread)`, is already rowed by 671 M17, and
        # the Team plates' call by 676 M13. Its anchor is left stale, so the census records it
        # retired.
        "M15 · 🔴 **`list_projects`' wait reads count into nobody** · a torn question row behind "
        "open work is invisible to the report",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `reportOn`
        # (list_projects' per-project builder) still calls `this.oneWaitReadPerAnswer(unread)` to
        # build its wait reads. Dropping `unread` there reproduces 'list_projects' own wait reads
        # count into nobody' at the same, still-present line.
        [
            (HOST, '    // here and not in the fold.\n    const waiting = this.oneWaitReadPerAnswer(unread)', '    // here and not in the fold.\n    const waiting = this.oneWaitReadPerAnswer(undefined)'),
        ],
    ),
    (
        "M16 · ⛔ **`list_projects`' task read counts into nobody** · a torn row only the project's "
        "task fold meets — a torn reply — vanishes from the count",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The per-project
        # `tasksIn(slug, unread)` fold is gone, but the rule (the task fold must count what it could
        # not read, so a torn reply is met by that fold alone) survives in `tasksVisibleTo`'s
        # `tasksAssignedBy(sessionId, unread)`, and no row covers it. Drop `unread` from that call.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece board: the piece fold over the given-out work is the only read that
        # meets a torn `work_replied` row, so dropping `unread` from it makes the row vanish from
        # `rows_unread`. `list_projects`' `tasksAssignedBy(sessionId, unread)` is now
        # `piecesGivenBy(giver, unread)` inside `RuntimeHost.pieceBoard`. The plant is the same one,
        # unread dropped from that read. Killed by
        # `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`.
        [
            (HOST, 'composeWhatEachPieceIsWaitingOn(this.deps.store.piecesGivenBy(giver, unread), waiting),', 'composeWhatEachPieceIsWaitingOn(this.deps.store.piecesGivenBy(giver), waiting),'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about `list_projects` asked
        # for a project BY NAME reporting 0 while the listing counts, an exception at one depth of
        # the door. The named arm is gone ('list_projects' NAMED arm went with it', as the killer
        # test's own comment says), and `list_tasks` has one arm, so nothing is left to make an
        # exception in. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ **a project asked for BY NAME reports 0** · the listing counts and the named arm "
        "does not — an exception made at one depth of the door",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same named-arm return
        # site as 448:M9, but here the planted field is `rowsUnread` rather than `reach`.
        # list_projects' named arm still spreads `unread.count` through this literal; zeroing it
        # still makes a caller who asked about one project by name get told 0 while the unnamed
        # listing (M18) correctly counts, 'an exception made at one depth of the door'.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `projectsVisibleTo`'s
        # named-project arm still builds the report then returns `rowsUnread: unread.count`.
        # Hard-coding 0 there is the same 'a project asked for BY NAME reports 0' defect at the
        # current (renamed `list_projects` → `projectsVisibleTo`) location.
        [
            (HOST, "      const projects = this.reportOn([named], unread, by, me)\n      return {\n        outcome: 'ok',\n        projects,\n        reach,\n        rowsUnread: unread.count,\n        ...ledgersSkippedOf(unread.ledgersSkipped),\n      }\n", "      const projects = this.reportOn([named], unread, by, me)\n      return {\n        outcome: 'ok',\n        projects,\n        reach,\n        rowsUnread: 0,\n        ...ledgersSkippedOf(unread.ledgersSkipped),\n      }\n"),
        ],
    ),
    (
        "M18 · ⛔ **the LISTING reports 0** · the count is taken and the unnamed answer drops it",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same unnamed-arm return
        # site as 448:M10, with `rowsUnread` planted to 0 instead of `reach`. list_projects' unnamed
        # listing still spreads `unread.count`; zeroing it plants '676 F1 back' — the listing
        # itself, not just the named arm, drops its count.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The unnamed listing arm
        # of `projectsVisibleTo` still returns `rowsUnread: unread.count` after building every
        # admitted project's report. Hard-coding 0 there reproduces 'the LISTING reports 0' at the
        # current location.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — `list_projects`' listing
        # is gone, but the host answer of the surviving listing, `tasksVisibleTo`, still ends
        # `rowsUnread: unread.count`, and no row plants a `0` there (671 M16 plants the tool
        # payload). Hard-code 0 in that return, which is 'the count is taken and the answer drops
        # it'.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The listing's
        # count survives: `pieceBoard` (the unnamed `list_tasks` answer) takes the count and returns
        # it as `rows_unread`. The old `given, assigned, rowsUnread: unread.count` is now `hold,
        # gave, rowsUnread: unread.count`. The plant makes the board report 0 while the count was
        # taken. Killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`.
        [
            (HOST, '      gave,\n      rowsUnread: unread.count,\n', '      gave,\n      rowsUnread: 0,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted `rows_unread: 0` in
        # `list_projects`' payload, which no longer exists. The same defect on the surviving tool,
        # `list_tasks`' `rows_unread: rowsUnread,`, is 671 M16 (same payload-count line). Its anchor
        # is left stale, so the census records it retired.
        "M19 · 🔴 **the model's payload carries no count** · `list_projects` answers `rows_unread: 0` "
        "whatever the host counted",
        [(TOOLS, THE_TOOL_COUNT, "              rows_unread: 0,\n")],
    ),
    (
        "M20 · ⚠️ **the count is not SAID** · it is in the payload and not in the words a model reads",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — `list_projects`'
        # sentence spread is gone, but `list_tasks` still says the count with `...(rowsUnread === 0
        # ? [] : [unreadRowsSentence(rowsUnread)]),` and no row breaks it (448's row planted a
        # different edit on the deleted `reading.` form). Removing the line leaves the count in the
        # payload and out of the words.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `list_tasks`: the count is in the payload and said to the model in words
        # through `unreadRowsSentence`. The anchor moved only in indentation (now 12 spaces inside
        # `unreadLines`). The plant drops the sentence line, so `rows_unread` stays right in the
        # payload but the model reads nothing. Killed by
        # `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`.
        [
            (TOOLS, '            ...(rowsUnread === 0 ? [] : [unreadRowsSentence(rowsUnread)]),\n', ''),
        ],
    ),
    # ── F3 · the card ──────────────────────────────────────────────────────────────────────────
    (
        "M21 · 🔴 **the card carries no count** · `671` F3 back: both reads skip and the card says "
        "`0`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — This is the slot-based
        # cardFor (AgentCard) return, confirmed by the '676 · F3 — LAST' comment and by the §4 F3
        # killer test's use of a live agentCard() call; D-017 only added a sibling `ledgersSkipped:
        # unread.ledgersSkipped` line after it. `rowsUnread: unread.count` is still 671 F3's own
        # count of the two ledger reads this card makes; zeroing it still makes a card whose reads
        # passed over a torn row say '0'.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The card's
        # count survives: `cardFor` ends with `rowsUnread: unread.count` after `pieces:
        # this.piecesOnTheCard(slot.id, unread)`. The rule ('LAST, after every read has met what it
        # met') is unchanged. Only the comment wording and the closing lines drifted, so the anchor
        # is now the comment plus the count line, which `stoppedCard` does not share. Killed by
        # `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`.
        [
            (HOST, '      // 🔴 **676 · F3 — LAST, after every read has met what it met** ({@link AgentCard.rowsUnread}).\n      rowsUnread: unread.count,\n', '      // 🔴 **676 · F3 — LAST, after every read has met what it met** ({@link AgentCard.rowsUnread}).\n      rowsUnread: 0,\n'),
        ],
    ),
    (
        "M22 · ⛔ **the ask read counts into nobody** · a torn newer ask is passed over and the card "
        "says nobody passed anything",
        [
            (
                HOST,
                THE_CARD_ASK,
                "      lastAskToStop: this.deps.store.lastAskToStop(slot.id),\n",
            )
        ],
    ),
    (
        "M23 · ⛔ **the ended-turn read counts into nobody** · a torn row of the last closed turn is "
        "skipped and the card's `0` says the ending was read whole",
        [
            (
                HOST,
                THE_CARD_ENDING,
                "      lastEndedTurn: this.deps.store.lastEndedTurn(slot.id),\n",
            )
        ],
    ),
    (
        "M24 · ⚠️ **torn asks OLDER than the answer are counted** · rows the read never met — it "
        "stopped at the newer readable ask — reported as passed over",
        [(STORE, THE_PASSED_OVER, "-1")],
    ),
    (
        "M25 · ⚠️ **a READABLE non-ask is counted as unread** · an `allow` after the ask is one of the "
        "read's two types, skipped for its outcome, and counted as a torn row",
        [(STORE, THE_TORN_ONLY, "        AND type IN ('work_interrupted', 'user_decision')`,\n")],
    ),
    (
        "M26 · ⛔ **no readable ask, nothing counted** · the count is taken after the early return, "
        "so the one answer a torn newest row most falsifies — *nobody asked* — carries `0`",
        [
            (
                STORE,
                THE_EARLY_RETURN_AFTER,
                "    if (row === undefined) return null\n" + THE_EARLY_RETURN_AFTER,
            )
        ],
    ),
    # ── the wider search · four statements that raised ──────────────────────────────────────
    (
        "M27 · 🔴 **the routing scan reads the raw payload** · one torn routing ANYWHERE and every "
        "agent's `list_questions` and `answer_question` RAISE again (measured before `676`)",
        [
            (
                STORE,
                THE_ROUTING_GUARD,
                "                    payload AS payload\n               FROM events) routed\n",
            )
        ],
    ),
    (
        "M28 · ⛔ **a torn routing is warned and not counted** · `list_questions` answers "
        "`rows_unread: 0` beside a routing it could not read",
        [
            (
                STORE,
                THE_ROUTING_COUNTED,
                "        noteUnreadRow(candidate.id, candidate.unreadAt, undefined)\n",
            )
        ],
    ),
    (
        "M29 · 🔴 **`list_questions` carries no count** · the model's payload says `0` whatever was "
        "skipped",
        [(TOOLS, THE_QUESTIONS_COUNT, "              rows_unread: 0,\n")],
    ),
    (
        "M30 · ⛔ **the counted read hands no set down** · the reads skip and `questionsListedFor` "
        "reports what nobody noted",
        [(HOST, THE_QUESTIONS_SET, "    const questions = this.questionsWaitingOn(sessionId)\n")],
    ),
    (
        "M31 · 🔴 **the launch sweep reads a torn message's id raw** · one torn `message_queued` in "
        "any conversation and the next `RuntimeHost` RAISES at construction — the app does not start · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                THE_NAMED_ONLY,
                "            json_extract(payload, '$.messageId') AS message_id,\n            CASE WHEN type = 'message_queued' AND json_valid(payload)\n",
            )
        ],
    ),
    (
        "M32 · ⛔ **a torn ENDING is read as ending nothing** · the sweep writes a second ending over "
        "a message a torn row may already have ended · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The anchor now matches
        # twice (count_now 2, not 0): D-017 added `selectMessagesWaitingIn`, a new per-conversation
        # query for `ensureRunning`'s R3 (a stop hands held messages to the next start), that reuses
        # the identical torn-row CASE line verbatim alongside the original launch-sweep query
        # `selectStrandedMessages`. The row's actual subject — the launch sweep's `676` torn-ending
        # guard — is still exactly there; the fix is a longer, unique anchor that includes the `WHEN
        # NOT json_valid(q.payload) THEN 0` line only `selectStrandedMessages` has.
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still reads a torn ending as ending nothing, so the sweep writes a second ending over a message it may have ended
            (STORE, "          if (one.type === 'message_unqueued')\n            lastTornEnding = Math.max(lastTornEnding, one.ordinal)\n", ""),
        ],
    ),
    (
        "M33 · 🔴 **the reopen's grant reads every row raw** · one torn row of any type in a "
        "conversation and reopening it RAISES",
        [
            (
                STORE,
                THE_ATTACHMENTS_GUARD,
                "        AND json_extract(payload, '$.attachments') IS NOT NULL\n",
            )
        ],
    ),
    (
        "M34 · 🔴 **the retraction read reads a torn clear raw** · the limit band RAISES whenever a "
        "wall stands and one clear is torn",
        [
            (STORE, THE_CLEAR_WINDOW, "    `SELECT e.session_id, ps.provider AS provider,\n            json_extract(e.payload, '$.window') AS window,\n"),
            (
                STORE,
                THE_CLEAR_FILTER,
                "      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001)\n",
            ),
        ],
    ),
    (
        "M35 · ⛔ **a torn clear RETRACTS** · guarded but not excluded, it has no window, which the "
        "fold reads as *the provider as a whole* — every wall of its provider comes down",
        [
            (
                STORE,
                THE_CLEAR_FILTER,
                "      WHERE e.type = 'provider_limit_clear' AND likelihood(e.created_at > ?, 0.00001)\n",
            )
        ],
    ),
    (
        "M36 · ⚠️ **a torn clear is left out and not counted** · the band says every row was read",
        [(STORE, THE_CLEAR_COUNTED, "            noteUnreadRow(sessionId, ordinal, undefined)\n")],
    ),
    # ── what `676`'s own review found ─────────────────────────────────────────────────────────
    (
        "M37 · 🔴 **a torn ending blocks the messages queued AFTER it too** · a crashed message held "
        "behind an unreadable ending is never settled, launch after launch · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same anchor-collision
        # cause as M32 (the new `selectMessagesWaitingIn` query duplicates the CASE line).
        # Re-anchored with the same longer, unique fragment; only the planted replacement differs
        # (`THEN 1`, making any torn ending — even one before the queued message — count as its
        # end).
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still lets a torn ending block messages queued after it, so a crashed message behind it is never settled
            (STORE, "        if (ended.has(one.message_id) || lastTornEnding > one.ordinal) continue\n", "        if (ended.has(one.message_id) || lastTornEnding > -Infinity) continue\n"),
        ],
    ),
    (
        "M38 · 🔴 **the last-words read is unguarded** · a torn `assistant_message` RAISES, and the "
        "stall notice that quotes it is lost whole",
        # ⚑ T-003 · re-anchored in place, not retired — D-012 replaced 614's last-words read with
        # the last-exchange read, whose main-thread predicate keeps 676's guard word for word.
        # Re-verified RED alone.
        [
            (STORE, '      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ${MAIN_THREAD_WORDS}\n', "      WHERE session_id = ? AND generation = ? AND ordinal > ? AND type = 'assistant_message'\n        AND json_extract(payload, '$.parentToolCallId') IS NULL\n"),
        ],
    ),
    (
        "M39 · ⛔ **unreadable words are quoted as SILENCE** · the parent is told its child ended a "
        "turn saying nothing, about a turn whose words the app simply could not read",
        # ⚑ T-003 · re-anchored in place, not retired — D-012's `wordsOf` says a torn row as `{
        # unreadable: true }`; the row still makes it silence. Re-verified RED alone.
        [
            (STORE, '      answer: back === undefined ? null : wordsOf(sessionId, back),\n', "      answer: back === undefined || 'unreadable' in wordsOf(sessionId, back) ? null : wordsOf(sessionId, back),\n"),
        ],
    ),
    (
        "M40 · 🔴 **the bound is per STRING again** · whole strings never spend the budget, so ten of "
        "1,280 units reach the asker as 12,800 with nothing cut · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (named by W4.78)",
        [(HOST, THE_BUDGET_SPENT, "    .reduce((most, said) => Math.max(most, said.length), 0)\n")],
    ),
    (
        "M41 · ⛔ **a part nobody asked is delivered** · the held branch renders every part the "
        "answerer named into the asker's turn",
        [(HOST, THE_ASKED_PARTS, "    given\n")],
    ),
    (
        "M42 · ⚠️ **a blank string is delivered as it came** · 1,300 spaces reach the provider as a "
        "member, where `''` meant the same and cost nothing · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (named by W4.78)",
        [(HOST, THE_BLANK, "    answer: [...one.answer],\n")],
    ),
    # ── said where it is read, once `675` had landed ────────────────────────────────────────
    (
        "M43 · ⛔ **the card's count is not SAID** · `get_agent_status` and `list_agents` print the "
        "ordinary line over a card whose ending and ask may be older than the truth",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — D-017 appended `+
        # (card.ledgersSkipped === 0 ? '' : ' · its record could not be read')` onto cardText's
        # return expression, turning the old row's anchor (which ended right after the closing `)`
        # of the rowsUnread ternary) into `)  +` followed by a new line, so the literal old text no
        # longer occurs. The rule survives: cardText's rowsUnread ternary must still say the count
        # in words for get_agent_status/list_agents, so the defect is re-planted by blanking that
        # ternary's true branch to `''` while leaving the new trailing ` +` and the sibling
        # ledgersSkipped ternary intact.
        [
            (TOOLS, "    : ` · ${String(card.rowsUnread)} ${card.rowsUnread === 1 ? 'row' : 'rows'} of its record could not be read`) +", "    : '') +"),
        ],
    ),
    (
        "M44 · ⛔ **`list_questions`' count is not SAID** · an empty list reads *nobody asked you "
        "anything* beside a routing it could not read",
        [
            (
                TOOLS,
                "              ...(listed.rowsUnread === 0 ? [] : [unreadQuestionRowsSentence(listed.rowsUnread)]),\n",
                "",
            )
        ],
    ),
    (
        "M45 · 🔴 **a cut answer is reported as WHOLE to the answerer** · *has your answer and can go "
        "on* over an answer the asker received cut · killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` (named by W4.78)",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-009 put a decline arm ahead of this branch; the row still reports a cut answer as whole. Re-verified RED alone.
        # ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 stopped cutting answers (too long is now refused) and renamed AnswerOutcome.cut to notAsked — the parts that still do not reach the asker. The plant again reports a partly delivered answer as whole ('has your answer and can go on'); the 'cut' half of the label is gone, the 'or not at all' half is what remains.
        [(TOOLS, "                : answered.notAsked.length === 0\n", "                : true\n")],
    ),
]
