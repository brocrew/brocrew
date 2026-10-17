"""508 · the work this conversation gave out — the seventh tab, and the read the panel could not make.

⛔ **What this table is aimed at.** `508` made five rules and every one of them is a rule a mutation
can delete while the compiler stays quiet:

 1. **The walk says what it read.** `tasksAssignedBy` folds ledgers and passes no skip counter, so a
    row it could not parse reaches nobody — `453`'s *a list of obligations may not be quietly short*.
    `M1`–`M6` are the ways the new reader rots back into the old one: the counter dropped, the two
    counts conflated, the order left to SQLite, the filter widened, and the holder's identity lost
    to an INNER join.
 2. **The wire carries the walk.** `M7`–`M9`: the quit door opened, the count flattened one layer
    up, and the renderer's refusal drawn as an empty list.
 3. **The fold words nothing of its own and claims nothing it cannot stand behind.** `M10`–`M19`:
    the empty certified over a read that failed, the doubt vocabulary collapsed, the tally drawn as
    a zero, the age threshold moved, the project chip made unconditional, the work's whole body
    drawn, the name taken off `agentName`, and the two guards that make the fold total.
 4. **The Open tab reads ONE boolean.** `M20`–`M22`: the precedence reversed, the sentence that
    names WHERE made vague, and the boolean made constant.
 5. **The strip.** `M23`–`M25`: the cadence chosen rather than derived, the tally drawn at zero, and
    the tally wearing the Changes tab's hook.

🔴 **The fail-safe direction, stated once.** ⛔ Every row here fails TOWARD a list that looks
complete and is not, or a count that looks current and is not — a parent told it handed out nothing
by a read that failed, a tally that says `0` over a list nobody has read, a row whose holder is
missing because a join dropped it. ⚑ That is the direction `453` built `LedgerWalk` for, and the
reason this reader exists beside `tasksAssignedBy` rather than replacing it.

⚠️ **`505`'s liveness is NOT in this table and its absence is deliberate.** Nothing `508` added
draws a word about whether a worker is alive — there is no field to delete and no predicate to
widen, so a row asserting *the worker's state stays off this surface* would be a row nothing can
make fail here. ⛔ The dom file asserts it as an absence with a positive control instead.

⛔ **Four things this table deliberately does not contain.**
  · **No row for `workGivenOut`'s builder.** It copies seven fields and the store is its only
    caller; a mutation that inlines it is byte-equivalent, which is
    `a-true-mutation-measures-nothing`.
  · **No row inside `walkLedgers`.** It is shared with four other readers, so a mutation there is a
    measurement of somebody else's table wearing this one's number.
  · **No row for `WorkFacts`' three elements.** `406` owns that markup and `406`'s rows already
    kill it; what `508` changed is the PROP, and `M21` is the closest thing to it that is this
    dispatch's own.
  · **No row for the tab's own CSS.** `a-style-mutations-control-is-the-state-it-falls-back-to`:
    the tab body has no variant to fall back to, so a deleted rule lands on the base and the dom
    file's overflow assertion is what would notice — which is a layout row, not a rule row.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer files run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
RSTORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
FOLD = "apps/desktop/src/renderer/src/lib/work-given-out.ts"
PANEL = "apps/desktop/src/renderer/src/lib/session-panel.ts"
DRAWER = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"
TASKS = "apps/desktop/src/shared/tasks.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the walk says what it read ─────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · the skip counter is not passed, so a ledger row this build "
        "cannot parse is dropped in silence and the list is short with nothing saying so — "
        "`toPersistedEvents`' own skip, which `150` ruled acceptable on a transcript and `453` ruled "
        "unacceptable on a list of obligations",
        # ⛔ **603 · ANCHOR CORRECTED IN PLACE, not retired.** `603` wrapped this walk in
        # `composeWaitingOnAnAnswer`, prettier joined the fold and its filter onto one line, and the
        # old anchor then matched `workEdgesGivenBy`'s line too — reported `anchor-ambiguous`,
        # which is the census refusing to guess. ⚡ The whole line is the anchor now, so it names one
        # place. Re-verified RED by hand.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 453's rule (a
        # list of obligations may not be quietly short) survives: the work-given-out walk still
        # hands `piecesOfSession` a skip counter (`noteSkip`), and `tasksOfSession` is now
        # `piecesOfSession` inside `walkWorkGivenBy`. The plant stops passing the counter, so a torn
        # `user_turn` row is dropped uncounted. The wait reads only touch routing and question rows,
        # so nothing else counts it. Killed by `the-work-this-conversation-gave-out.test.ts`.
        [
            (STORE, '          [...piecesOfSession(owner, noteSkip)].filter((piece) => piece.giver === sessionId),', '          [...piecesOfSession(owner)].filter((piece) => piece.giver === sessionId),'),
        ],
    ),
    (
        "M2 · ⛔ `ledgers` is derived from the ROWS · *what was found* answers a question that asked "
        "*what was read*, so a parent whose worker also works for somebody else is told it opened "
        "one ledger when it opened two — and `ledgers: 47, rows: 0` stops being sayable at all",
        # ⚑ **543 · ANCHOR CORRECTED IN PLACE, not retired.** The candidate set, the fold, the
        # filter and the order moved into `walkWorkGivenBy` — ONE walk mapped twice, because the
        # relationship read needed the same narrowing in a different shape — so these bytes sit two
        # spaces out and in a named function. ⛔ The SUBJECT is untouched and its blast radius is
        # now honestly WIDER: this row breaks both readers, which is what one derivation means.
        # ⚠️ Re-verified RED by hand.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The 'work this
        # conversation gave out' reader still copies ledgers straight from walked.ledgers (the
        # candidate-derived count) rather than deriving it from walked.rows.length. D-017 inserted a
        # `...ledgersSkippedOf(walked.ledgersSkipped),` line between rowsUnread and the rows spread,
        # breaking the old three-line contiguous anchor; the field and its value are otherwise
        # untouched.
        [
            (STORE, '      ledgers: walked.ledgers,\n      rowsUnread: walked.rowsUnread,\n      ...ledgersSkippedOf(walked.ledgersSkipped),\n      rows: [...walked.rows].sort(\n', '      ledgers: walked.rows.length,\n      rowsUnread: walked.rowsUnread,\n      ...ledgersSkippedOf(walked.ledgersSkipped),\n      rows: [...walked.rows].sort(\n'),
        ],
    ),
    (
        "M3 · ⚠️ the order is left to SQLite · `SELECT DISTINCT` states none, so the list reshuffles "
        "itself under a reader every time the poll comes back — the row this reverses the comparator "
        "on is the one that makes *the order the work was handed out* a fact rather than a hope",
        # ⚑ **543 · ANCHOR CORRECTED IN PLACE** — see `M2`'s note; the comparator moved with the
        # walk. ⚠️ Re-verified RED by hand.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The order the
        # work was handed out survives: `walkWorkGivenBy` sorts by `givenAt`, then piece id, because
        # the candidate query has no order. Only the field names changed (`assignedAt` to `givenAt`,
        # `taskId` to `piece`). The plant reverses the primary comparator. Killed by
        # `the-work-this-conversation-gave-out.test.ts`.
        [
            (STORE, '        (left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1),', '        (left, right) => right.givenAt - left.givenAt || (left.piece < right.piece ? -1 : 1),'),
        ],
    ),
    (
        "M4 · 🔴 the predicate that FOUND the ledger is trusted to be the answer · one conversation "
        "can hold work from two parents, so a candidate ledger is not an answer — this is the row "
        "that leaks one parent's work into another parent's list",
        # ⚑ **543 · ANCHOR CORRECTED IN PLACE** — see `M2`'s note; the filter moved with the walk.
        # ⚠️ Re-verified RED by hand.
        # ⛔ **603 · ANCHOR CORRECTED IN PLACE, not retired.** Same reformat as `M1` above: the
        # filter is no longer on a line of its own. ⚡ The predicate and the defect are unchanged.
        # Re-verified RED by hand.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The fold
        # decides which pieces are a giver's, not the candidate query: `walkWorkGivenBy` still
        # filters each owner's ledger on `piece.giver === sessionId`. One holder can hold work from
        # two parents, so the filter is what stops one parent's work leaking into another's list.
        # The plant widens the filter to accept every piece. Killed by
        # `the-work-this-conversation-gave-out.test.ts`.
        [
            (STORE, '          [...piecesOfSession(owner, noteSkip)].filter((piece) => piece.giver === sessionId),', '          [...piecesOfSession(owner, noteSkip)].filter(() => true),'),
        ],
    ),
    (
        "M5 · ⛔ the binding join stops being LEFT · a conversation this app never placed — `438`'s "
        "`never-placed`, `agent_profile_id IS NULL` — vanishes from a list whose whole subject is "
        "*what did I hand out*, and it vanishes silently because a JOIN is not a filter anybody reads",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a holder this app never placed still appears in the work-given-out walk, named
        # by nothing, because the identity join is LEFT. The plant makes it INNER and drops the row
        # silently. Killed by `the-work-this-conversation-gave-out.test.ts`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives and the spec pins it: 'SELECT DISTINCT w.owner_session_id ... LEFT JOIN
        # agent_identity', so an owner this app never placed still appears. The candidate query now
        # reads `work`, so the old `WHERE e.type = 'task_assigned'` context went dark. The plant
        # makes the identity join INNER and silently drops that row. Killed by
        # `the-work-this-conversation-gave-out.test.ts`.
        [
            (STORE, '       LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id\n      WHERE w.given_by_session_id = ?', '       JOIN agent_identity identity ON identity.id = s.agent_identity_id\n      WHERE w.given_by_session_id = ?'),
        ],
    ),
    (
        "M6 · ⚠️ the holder's identity is not read at all · every row reads as the default label, so "
        "*who is this work with* — the one question a list of handed-out work exists to answer — is "
        "answered the same way for every row on screen",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: the walk resolves the holder's identity from agent_identity (the field agentName
        # joins on). The plant stops resolving it. Killed by
        # `the-work-this-conversation-gave-out.test.ts`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Who the work
        # is with is still resolved in the candidate query from `agent_identity`, so the row names
        # its holder. The candidate query changed from events to the `work` table, so the old SELECT
        # text went dark. The plant selects NULL for `identity`, so every row reads as unnamed.
        # Killed by `the-work-this-conversation-gave-out.test.ts`.
        [
            (STORE, '    `SELECT DISTINCT w.owner_session_id AS id, identity.slug AS identity', '    `SELECT DISTINCT w.owner_session_id AS id, NULL AS identity'),
        ],
    ),
    # ── §2 · the wire ───────────────────────────────────────────────────────────────────────────
    (
        "M7 · ⛔ the quit door is opened · a read that touches `deps.store` is answered while the app "
        "is tearing down, which is the default this door's own docblock says the burden of proof is on",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The quit-door
        # rule survives. The command was renamed, not removed: the D-016 diff turns
        # `tasksAssignedBy: 'refused'` into `workGivenBy: 'refused'` in ipc.ts, and the default is
        # still 'refused'. The plant flips the renamed entry to 'answered'. Killed by
        # `shutdown-door.test.ts`.
        [
            (IPC, "  workGivenBy: 'refused',", "  workGivenBy: 'answered',"),
        ],
    ),
    (
        "M8 · 🔴 the host flattens the count on the way past · a window is told the list is whole over "
        "a walk that said it is short — `453`'s rule with the sign flipped, and the reason the host "
        "carries the walk instead of re-deriving it",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 hands the walk the kept-open fact per holder; the row still flattens the count on the way past. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — tasksAssignedBy still
        # passes the store's walk straight through without re-deriving or flattening its rowsUnread
        # count — only the holder-liveness predicate's name changed, from the quit-only
        # `this.keptOpen(holder)` to D-017's `this.startable(holder)` (699's own note in
        # mutations.py already re-anchored this row once for an unrelated reason, R2's rename is a
        # second).
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule holds: the host carries the store's walk through unchanged and never flattens its
        # `rowsUnread` count. `workGivenBy` is now `return
        # this.deps.store.workGivenOutBy(sessionId)` because D-016c removed the holder-liveness
        # predicate argument, so the plant wraps that call and forces the count to 0. Killed by
        # `the-work-this-conversation-gave-out.test.ts`.
        [
            (HOST, '    return this.deps.store.workGivenOutBy(sessionId)\n', '    return { ...this.deps.store.workGivenOutBy(sessionId), rowsUnread: 0 }\n'),
        ],
    ),
    (
        "M9 · ⛔ a dropped IPC call is drawn as an empty list · *this conversation has given nobody "
        "work* out of a failure, which is the sentence `434` spent a dispatch making unsayable by "
        "accident — and the fifth reader in this store with that shape loses it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A failed IPC
        # call must be `null`, never an empty walk. The renderer store's reader was renamed to
        # `workGivenBy`, and its catch still returns null. The plant returns an empty walk from the
        # catch, which draws 'gave nobody work' out of a failure. Killed by
        # `the-work-this-conversation-gave-out.test.ts`.
        [
            (RSTORE, '      try {\n        return await bridge.workGivenBy({ sessionId })\n      } catch {\n        return null\n      }', "      try {\n        return await bridge.workGivenBy({ sessionId })\n      } catch {\n        return { rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }\n      }"),
        ],
    ),
    # ── §3 · the fold ───────────────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 the open predicate is read with `Boolean` · `TASK_IS_OPEN['constructor']` is a "
        "FUNCTION and therefore truthy, so a state off an imported bundle counts as open and lands in "
        "the tally on the strip — `406`'s own finding, one file over",
        [(FOLD, "    open: Object.hasOwn(TASK_IS_OPEN, row.state) && TASK_IS_OPEN[row.state],",
          "    open: Boolean(TASK_IS_OPEN[row.state]),")],
    ),
    (
        "M11 · ⛔ the empty is certified over a read that FAILED · *this conversation has given nobody "
        "work* and *this list did not answer just now* on one screen, denying each other — `304`",
        # ⚑ **678 re-anchored and the ROW is unchanged** — the empty line gained a third guard
        # (F-R18d: never over rows the walk could not read); the row still drops the DOUBT guard.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — 304's rule ('never
        # certify empty over a read that failed') is untouched; the `empty` guard just grew a fourth
        # D-017 conjunct for skipped ledgers. Dropping `doubt === null` from the (now four-line)
        # conjunction reproduces exactly the same defect: an unanswered read with no rows still
        # draws NOTHING_GIVEN_OUT.
        [
            (FOLD, '    empty:\n      doubt === null &&\n      rows.length === 0 &&\n      !(reading.walk.rowsUnread > 0) &&\n      // ⚑ **D-017 · R8** — nor over a record it skipped whole.\n      !((reading.walk.ledgersSkipped ?? 0) > 0)\n        ? NOTHING_GIVEN_OUT\n        : null,\n', '    empty:\n      rows.length === 0 &&\n      !(reading.walk.rowsUnread > 0) &&\n      // ⚑ **D-017 · R8** — nor over a record it skipped whole.\n      !((reading.walk.ledgersSkipped ?? 0) > 0)\n        ? NOTHING_GIVEN_OUT\n        : null,\n'),
        ],
    ),
    (
        "M12 · ⚠️ the doubt vocabulary is asked in the wrong order · a refused read whose PREVIOUS "
        "answer carried an unspellable word reports the older problem, so the mark says *the app "
        "cannot explain this read* about a read that never happened",
        [(FOLD,
          "  const doubt: WorkDoubt | null = !reading.answered\n    ? 'the-read-did-not-answer'\n    : says === null\n      ? 'a-word-this-app-cannot-spell'\n      : null",
          "  const doubt: WorkDoubt | null =\n    says === null\n      ? 'a-word-this-app-cannot-spell'\n      : !reading.answered\n        ? 'the-read-did-not-answer'\n        : null")],
    ),
    (
        "M13 · ⛔ the tally is drawn at zero · `081`'s rule, on the one surface with no room for the "
        "sentence that would make a zero mean something — a `0` on the strip over a conversation "
        "whose work has not been read yet is a claim nobody made",
        [(FOLD, "    openCount: open === 0 ? null : open,", "    openCount: open,")],
    ),
    (
        "M14 · ⚠️ the age threshold moves off the poll · a reading exactly one poll old reads as "
        "fresh, which is the one moment the line exists for — the boundary, not the middle",
        # ⚑ W4.74 · re-anchored in place: the age no longer follows a poll (D-033 pushes every move),
        # it is said only for rows kept after a refused read; the plant draws it over an answered
        # list, the same false *stale* the threshold existed to prevent.
        [(FOLD, "    asOf: reading.answered ? null : agoWords(reading.at, input.now),",
          "    asOf: agoWords(reading.at, input.now),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed `projectElsewhere` and
        # the project slug on tasks ('a task reads "Task #N"'). The diff of work-given-out.ts
        # deletes the `elsewhere` computation and the `readersProject` argument, so there is no
        # project chip or 'Task #N in <project>' left to make unconditional. Its anchor is left
        # stale, so the census records it retired.
        "M15 · ⛔ every row names its project · a slug on every row, the reader's own included, which "
        "is the decoration naming a project only where it disambiguates exists to avoid (relabelled "
        "by 718: the chip and the whole-list rule it named are gone — R40 decides it per row)",
        # ⚑ ANCHOR AND LABEL CORRECTED IN PLACE BY 718 — `707` GAP-3 (R40): the whole-list `spans`
        # and the chip are gone and each row is decided against the READER's project
        # (`projectElsewhere`). ⚠️ The defect this row plants is the same one — *a slug on every row*
        # — now in the per-row decision. It overlaps `718` M32 (a reading with no reader), which
        # reaches it from the other side; kept rather than retired, because re-anchoring is the rule
        # and each kills a different line.
        [(FOLD, "  const elsewhere = projectElsewhere(row.projectSlug, readersProject)",
          "  const elsewhere: string | null = row.projectSlug")],
    ),
    (
        "M16 · ⚠️ the whole brief is drawn on the row · a 320px column asked to render an agent's "
        "entire assignment, where `list_tasks`' own reader takes the first line for the same reason",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds, reshaped. The rule is that the Work tab row draws the piece's short
        # NAME and never its whole brief in a 320px column. In the piece model the row draws
        # `row.title`, mapped from PieceRow.title by workGivenOut in shared/tasks.ts. WorkGivenOut
        # carries no brief field at all, so the renderer line `said: row.title` cannot be planted
        # with the brief. The plant is one layer up, where the field is filled: `title: row.brief`,
        # so the row's title becomes the whole brief. It type-checks (both are strings). NO existing
        # test fails: every give in the-work-this-conversation-gave-out.test.ts uses `brief: title`,
        # its row tests build WorkGivenOutRow values directly, and the other workGivenOutBy readers
        # assert states only. MISSING TEST (the-work-this-conversation-gave-out.test.ts section 1).
        # It gives one piece with title 'short name' and a multi-line brief ('a long first line\nand
        # a second line of detail'). It reads store.workGivenOutBy(pm, NOTHING_KEPT_OPEN).rows[0]
        # and asserts row.title === 'short name' and that JSON.stringify(row) does not contain
        # 'second line of detail'. It then draws the row through the Work tab view and asserts
        # `said` === 'short name'. Paired positive: a give whose title equals its brief still draws
        # the title whole (the existing case). ⚠️ No test kills it yet: the landing owes one (D-016b
        # part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — The Work tab row must carry the
        # piece's short title and never its whole brief, and every existing give uses brief equal to
        # title, so swapping the two fields in workGivenOut changes nothing any test sees. The
        # store-level read store.workGivenOutBy(pm, NOTHING_KEPT_OPEN).rows[0] is the cheapest place
        # to pin it with a give whose title and brief differ. Keep the plant (both are strings, so
        # it type-checks and fails only on the assertion). Killed by
        # `what-the-tree-landing-left-unpinned.test.ts`.
        [
            ('apps/desktop/src/shared/tasks.ts', '    title: row.title,\n    ...(row.definitionOfDone === undefined ? {} : { definitionOfDone: row.definitionOfDone }),\n    state: row.state,\n', '    title: row.brief,\n    ...(row.definitionOfDone === undefined ? {} : { definitionOfDone: row.definitionOfDone }),\n    state: row.state,\n'),
        ],
    ),
    (
        "M17 · 🔴 the name stops being `agentName`'s · a second answer to *what is this identity "
        "called*, free to disagree with the rail, the queue and the project room — `449`'s one "
        "naming function, and `467` §8.2's refusal to put a display name on a row",
        [(FOLD, "    who: agentName(row.givenToProfile, input.identities ?? null),",
          "    who: row.givenToProfile ?? '',")],
    ),
    (
        "M18 · ⛔ the conversation guard goes · a person who opens A and then B inside one round trip "
        "reads A's handed-out work under B's drawer — the strongest false claim this tab can make",
        [(FOLD, "  if (reading === null || reading.conversation !== input.forConversation) return null",
          "  if (reading === null) return null")],
    ),
    (
        "M19 · ⚠️ the fold stops being total over an OMITTED reading · `SessionDrawer` declares the "
        "prop as `… | null`, so a mount that omits it type-checks and passes `undefined` — and the "
        "computed throws, taking every such mount down with it",
        [(FOLD, "  const reading = input.reading ?? null", "  const reading = input.reading as WorkGivenOutReading | null")],
    ),
    # ── §4 · the Open tab's one boolean ─────────────────────────────────────────────────────────
    (
        "M20 · ⛔ handed-out work outranks a schedule · a conversation that is about to wake itself up "
        "is told about somebody else's work instead, which reverses the axis the other three arms are "
        "ordered on: what is happening HERE first",
        [(PANEL, "  if (panel.scheduled) return PANEL_EMPTY_WORDS.scheduled\n  return gaveWork ? PANEL_EMPTY_WORDS.gaveWork : PANEL_EMPTY_WORDS.quiet",
          "  if (gaveWork) return PANEL_EMPTY_WORDS.gaveWork\n  return panel.scheduled ? PANEL_EMPTY_WORDS.scheduled : PANEL_EMPTY_WORDS.quiet")],
    ),
    (
        "M21 · 🔴 the sentence stops naming WHERE · `239`'s rule — a refusal states its own workaround "
        "— and without it a person is told something exists and given no instrument, which is an "
        "alarm and no way to answer it",
        [(PANEL, "    body: 'This conversation has given out work — it is on the Work tab.',",
          "    body: 'This conversation has given out work.',")],
    ),
    (
        # The empty Open-tab paragraph and its gaveWork-only line are gone. panelEmptyWords has no
        # caller, so retain the absent anchor as retired.
        "M22 · ⚠️ the boolean is constant · every conversation's Open tab names a tab that is empty "
        "for most of them, which is `PANEL_EMPTY_WORDS.unnamed`'s measured defect arriving from the "
        "other direction: a pointer at a list that is not there",
        [(DRAWER, "const gaveWork = computed(() => (workView.value?.rows.length ?? 0) > 0)",
          "const gaveWork = computed(() => (workView.value?.rows.length ?? 0) > -1)")],
    ),
    # ── §5 · the strip ──────────────────────────────────────────────────────────────────────────
    (
        "M23 · ⛔ the cadence becomes a number somebody CHOSE · the thing `LOOK_EVERY_MS`' docblock "
        "refuses, and the seam `digest.ts` names — *if a measurement ever makes them two, the alias "
        "is the line to break* — deleted by writing the number out",
        # ⛔ **RETIRED BY RULING (W4.74, D-033's window half):** the Work tab has no cadence of its
        # own any more — every move of its work is pushed — so `WORK_EVERY_MS` is gone, and the test
        # now pins that the module names no cadence and no literal milliseconds. Its anchor is left
        # stale, so the census records it retired.
        [(FOLD, "export const WORK_EVERY_MS = DISTIL_EVERY_MS", "export const WORK_EVERY_MS = 30_000")],
    ),
    (
        "M24 · ⚠️ the tally is drawn whether or not there is one · an empty chip on the strip over a "
        "conversation whose work has not been read, which is a mark that says nothing standing where "
        "a mark means something",
        [(DRAWER, '          v-if="entry.id === \'work\' && working"', '          v-if="entry.id === \'work\'"')],
    ),
    (
        "M25 · 🔴 the tally wears the Changes tab's hook · two elements answering one `data-cy`, so "
        "four instruments that address the Changes count start reading whichever the query found "
        "first — `an-assertion-can-be-satisfied-by-a-neighbouring-element`, as a handle collision",
        [(DRAWER, '          data-cy="drawer-tab-work-count"', '          data-cy="drawer-tab-count"')],
    ),
]
