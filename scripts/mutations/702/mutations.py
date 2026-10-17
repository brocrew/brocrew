"""702 · the kept-open conversation, told everywhere — `699` F-1, F-2; `696` G1, G2; `697` H-f.

⛔ **Two readers still told a kept-open conversation's commander something false, and two facts the
Team page needs main had and did not hand over.** The PM's five:

 * **F-1** — a person's Close of a child the quit left open left its commander's held *"it is still
   open"* notice to be read, and the commander was never told the child closed. ⚑ *"Tell it — one
   true sentence, never the stale one."*
 * **F-2** — `list_projects` reported work a kept-open holder has as plain `conversation_ended`, while
   `list_tasks` and the push say open. ⚑ *"One reading."*
 * **G1** — the set-aside row and the spawner's and waker's answers named the stand-in by slug
   (*"brobot’s list"*). ⚑ Pass the identity's name.
 * **G2** — the Team page could not name a starting agent's project. ⚑ A field on `IdentityUse`.
 * **H-f** — `rebuildLedger` looked the row up with `find`, which drops a row with no provider ref.

## ⚑ What a row here measures

 * ⚑ **M1–M11 are F-1** — the closing asks the push at all (M1); the decision owes a `'kept-open'`
   report exactly when the stamp has gone, on both recipients (M2–M5); the stale notice is taken back
   (M6); the record says what was told, durably and in memory (M7–M9); a parent's own end is written
   down BEFORE the stamp goes, so nothing tells it about its own act (M10, M11).
 * ⚑ **M12–M14 are F-1's neighbours** — the two readers that asked *was it told it had stopped?* of
   `conversation_ended` alone must now ask it of `'kept-open'` too, or a start stops setting it right
   (M12, M13); and the retraction says a closing, not the parent's own end (M14).
 * ⚑ **M15–M17 are F-2** — read off the caller's own card, only for a holder in
   `open-nothing-running`, and carried into the payload.
 * ⚑ **M18–M21 are G1** — the name derived once where the verdict is made, and read by the row and by
   both arms of the answers.
 * ⚑ **M22–M24 are G2** — the launch's project added, handed through, and sorted.
 * ⚑ **M25 is H-f.**
 * ⚑ **M26–M27 are review round one's R11** — the band's row says what its giver WAS told, and only
   where it was.
 * ⚑ **M28 is review round two's S3** — a notice taken back unread is not a telling.

## ⛔ What this table cannot reach

 * ⚠️ **`takeBackWhatTheClosingMadeFalse`'s filter** — every held notice about a task at the moment
   its holder closes is a `'kept-open'` one: a task has one notice until a later fact, and the only
   later facts are a start (which clears the stamp and is corrected) and this closing.
 * ⚠️ **`tellOneParent`'s `=== cause` guard before it writes `'kept-open'`** — it protects a
   correction or its own end written between `tellIfNobodyHasYet` and its own chain step; nothing a
   test drives lands there (a parent acts only in a turn, after the chain has run).
 * ⚠️ **The own end's receipt written AGAIN inside the chain** (review round one's R2) — it matters
   only when a push was already on its way when the end landed (`tellOneParent` awaiting its send),
   the same race; everywhere else the synchronous row already said it.
 * ⚠️ **H-f's `providerSessionId === null` branch for the image resolver** — a Codex row always has
   a ref, and a Claude row has no resolver either way.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
ROSTER = "apps/desktop/src/shared/agent-roster.ts"

KILLER = "a-restart-keeps-what-was-open.test.ts"
CHOICE = "a-persons-choice-holds-the-whole-launch.test.ts"
ROSTER_KILLER = "every-identity-he-has.test.ts"
REBUILD = "derived-generation.test.ts"
WAKES = "the-wakes-last-stale-sentences.test.ts"
WAKE = "what-a-wake-still-says-wrong.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b removed the quit-stamp branch
        # of `close()` along with `forgetTheQuitOf` and `aQuitLeftItOpen`, so the
        # `this.tellWhoeverGaveTheWork(sessionId)` line the row deletes no longer exists. The defect
        # is now the decision, per the D-017 R2/R3 note in `a-restart-keeps-what-was-open.test.ts`:
        # "A Close is a STOP now, and a message still starts the child ... nothing is taken back and
        # nothing more is said". Its F-1 tests assert a Close tells the commander nothing more. Its
        # anchor is left stale, so the census records it retired.
        "M1 · 🔴 F-1 RESTORED · the closing of a conversation the quit left open asks the push "
        f"nothing, so a commander told it is still open is never told it closed · killed by `{KILLER}`",
        [(HOST, "    this.tellWhoeverGaveTheWork(sessionId)\n", "    void sessionId\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `aNoticeIsOwed` and the `'kept-open'` `LastToldAboutWork` value are deleted ("the
        # kept-open receipt and notices"). `workReportedTo` now returns a `ReadonlySet` of told
        # pieces, told once per piece. No clause remains that owes the ending of a kept-open holder.
        # Its anchor is left stale, so the census records it retired.
        "M2 · a `'kept-open'` report is never owed the ending — `aNoticeIsOwed` answers *told* · "
        f"killed by `{KILLER}`",
        [(TASKS, "    (lastTold === 'kept-open' &&\n", "    (false &&\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `itCanStillBeStarted` and the `'kept-open'` clause of `aNoticeIsOwed` are deleted from
        # tasks.ts ("the kept-open receipt and notices"). A stop and a Close now tell nobody
        # anything, so no notice is owed by the start-ability of a holder. The anchor has zero
        # occurrences. Its anchor is left stale, so the census records it retired.
        "M3 · the `'kept-open'` clause ignores the stamp, so a commander is re-told about a child "
        f"that is still open · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `aNoticeIsOwed`'s second
        # exception still gates on whether the holder can still be started before deciding the
        # ending is owed. The callback parameter was renamed from a hardcoded
        # `theQuitStillHoldsItOpen` reader to an injected `itCanStillBeStarted` (D-017 R2: "the
        # ROW's rule, whatever the holder's slot is doing"), but collapsing its negation to
        # unconditional `true` reproduces "ignores the stamp, so a commander is re-told about a
        # child that is still open."
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: aNoticeIsOwed's 'kept-open' clause must ask whether the holder can still be
        # started. Today that is `!itCanStillBeStarted(piece.owner)` in shared/tasks.ts (D-017 R2),
        # so the plant makes the clause fire for a holder that is still open. That would re-tell a
        # commander, and list a row in the person's band, about a child it was told is open. Killed
        # by `a-restart-keeps-what-was-open.test.ts`,
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (TASKS, '      !itCanStillBeStarted(piece.owner)) ||\n', '      true) ||\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The store's `itCanStillBeStarted` closure (the `aRowADeliveryCanStart(recordedOf(row))`
        # read) is deleted; the band's filter is now `stalledWithACause(piece) &&
        # !toldAbout(piece.giver).has(piece.piece)`. The kept-open stamp the row planted a defect in
        # is gone by the commit's decision (see other_notes for the surviving told-once rule). Its
        # anchor is left stale, so the census records it retired.
        "M4 · the person's band asks no stamp — it reads every child as closed and lists work its "
        f"commander was truly told about · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The person's band
        # (`stalledWorkNobodyWasToldAbout`'s walk in session-store.ts) still asks a real per-holder
        # startability read before deciding a notice is owed. The old one-line quit-stamp reader
        # (`theQuitHoldsIt`/`selectOneClosedByTheQuit.get(holder)`) was replaced by
        # `itCanStillBeStarted`, which reads the session row and asks `aRowADeliveryCanStart` (D-017
        # R2), but the rule — the band must ask the fact, not assume closed — is the same; forcing
        # it to always `false` reproduces "reads every child as closed."
        [
            (STORE, '        return row !== undefined && aRowADeliveryCanStart(recordedOf(row))\n', '        return false\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The push no longer asks a stamp: `tellIfNobodyHasYet` is now `if
        # (parent.toldAboutStall.has(piece.piece)) return` with no `aNoticeIsOwed(...,
        # aMessageStartsIt)` call. This follows from "its giver is told once, when it stalls. A
        # stop, a reopen and a start tell nobody anything". The anchor has zero occurrences. Its
        # anchor is left stale, so the census records it retired.
        "M5 · the push asks no stamp — a commander whose child is still open is told again at its "
        f"next registration · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The push side
        # (`tellIfNobodyHasYet`) still asks `aNoticeIsOwed` with a real per-holder startability
        # callback before re-telling a commander. The callback was renamed from
        # `this.deps.store.theQuitClosed(holder)` to `this.aMessageStartsIt(holder)` (D-017
        # generalised from the quit stamp to "can a message start it now"), but forcing it to `() =>
        # false` reproduces "the push asks no stamp — a commander whose child is still open is told
        # again." Note the string is no longer unique in the file (a second, NEW call site was added
        # in `startTheGiverFor` for D-017 R1); the edit anchors on the push's own site by including
        # the following line.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the push must ask the same 'can a message still start the holder' question as the
        # band. The call is still `aNoticeIsOwed(lastTold, piece, (holder) =>
        # this.aMessageStartsIt(holder))`. The plant answers 'no' for every holder, so the push
        # re-tells a commander whose child is still open at its next registration, while the band
        # half is untouched. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '    if (!aNoticeIsOwed(lastTold, piece, (holder) => this.aMessageStartsIt(holder))) return\n    parent.toldAboutStall.set(piece.piece, piece.stalledBecause)\n', '    if (!aNoticeIsOwed(lastTold, piece, () => false)) return\n    parent.toldAboutStall.set(piece.piece, piece.stalledBecause)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect is now the
        # decision. Its premise was that a person's Close makes the held 'still open' notice false.
        # D-017 R2/R3 made a Close a STOP that a message still starts, and
        # a-restart-keeps-what-was-open §8 says: "the held words are true, so nothing takes them
        # back, and the commander is told nothing more", with `expect(retracted(lead)).toEqual([])`
        # in the F-1 arms. Its F-c arm was retired with end_agent, and no test reaches
        # takeBackWhatTheClosingMadeFalse's retraction (no test asserts aNoticeAClosingRetracted's
        # 'has been closed since'). Its anchor is left stale, so the census records it retired.
        "M6 · the HELD *still open* notice is not taken back — the commander reads the stale words "
        f"before the true ones · killed by `{KILLER}`",
        [(HOST,
          "      parent.telling = parent.telling.then(() => this.takeBackWhatTheClosingMadeFalse(parent, task))\n",
          "      void 0\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `saidItIsOpen`/`holderKeptOpen: true` receipt field is deleted from the host, and
        # `WorkStallToldEvent.holderKeptOpen` is no longer written. The commit says "The only
        # receipt written is pushed", and "the kept-open receipt and notices" are gone. Only old
        # ledgers still carry the field. Its anchor is left stale, so the census records it retired.
        "M7 · the receipt does not record that the words said *still open* — a later launch reads "
        f"*told* · killed by `{KILLER}`",
        [(HOST, "        ...(saidItIsOpen ? { holderKeptOpen: true as const } : {}),\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The store's fold no longer maps a receipt to `'kept-open'` or a cause. `toldIn` returns a
        # `Set` of pieces, and its docblock says "Every receipt is a telling, whatever it says",
        # with old `holderKeptOpen` receipts counted as told. The anchor has zero occurrences. Its
        # anchor is left stale, so the census records it retired.
        "M8 · the store folds a *still open* receipt into its cause alone — the next registration "
        f"reads *told* · killed by `{KILLER}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the store must fold a pushed work_stall_told with holderKeptOpen into 'kept-open',
        # not into its cause alone. The fold is unchanged in behaviour (session-store.ts,
        # `event.holderKeptOpen === true ? 'kept-open' : event.cause`), only indented differently.
        # The plant folds to the cause, so the next registration reads 'told'. Killed by
        # `a-restart-keeps-what-was-open.test.ts`,
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (STORE, "            event.holderKeptOpen === true\n            ? 'kept-open'\n            : event.cause\n", '            event.cause\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect is now the
        # decision. The label is 'a commander that is RUNNING when the child closes is not told'.
        # D-017 R2/R3 ruled exactly that: a-restart-keeps-what-was-open §8 says the running
        # commander is "told nothing more" when a person closes the child, and
        # a-notice-that-cannot-be-true-is-replaced §3.4 says "a Close leaves the holder startable...
        # the giver is owed nothing". The in-memory 'kept-open' stamp is read only by the take-back
        # and by aNoticeIsOwed's not-startable clause, and both need a holder nothing can start,
        # which no test builds. Its anchor is left stale, so the census records it retired.
        "M9 · in memory, what the words said is never written — a commander that is RUNNING when the "
        f"child closes is not told · killed by `{KILLER}`",
        [(HOST, "      if (saidItIsOpen && parent.toldAboutStall.get(task.taskId) === cause) {\n",
          "      if (false) {\n")],
    ),
    (
        "M10 · a parent's OWN end of a child it was told is still open is not written down — the "
        f"closing tells it *has ended* about its own act · killed by `{KILLER}`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The exact `if
        # (parent.toldAboutStall.get(task.taskId) === 'kept-open')` gate from the deleted
        # `takeBackWhatItsOwnEndMadeFalse` survives as `if (lastTold === 'kept-open')` in
        # `tellIfNobodyHasYet`, still gating the call to `takeBackWhatTheClosingMadeFalse` (its own
        # docblock: '`699` F-1 — owed because "it is still open" went FALSE, so that notice is taken
        # back first'). Forcing it false still skips the retraction of a stale still-open notice.
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** the row is about a parent's own
        # `end_agent` making a held *…is still open* notice false; 5206d835 says *Nothing ends a
        # conversation*, and the killer file records the case retired with `end_agent`. The
        # re-anchor above is undone and the pre-landing anchor restored, so the census records it
        # retired.
        [
            (HOST, "        if (parent.toldAboutStall.get(task.taskId) === 'kept-open') {\n", '        if (false) {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** M11's hazard was two separate top-level
        # calls (`takeBackWhatItsOwnEndMadeFalse` then `forgetTheQuitOf`) where reordering let a
        # re-arm fire before the retraction read stale data; both calls and that structure are gone
        # with `endAgent`. Today's `tellIfNobodyHasYet` reads `lastTold` into a local BEFORE any
        # mutation and the retraction closure captures that same local, so the two steps are fused
        # into one atomic pass — the specific 'stamp goes before its own end is written down' race
        # can no longer be expressed as a two-line reorder. Its anchor is left stale, so the census
        # records it retired.
        "M11 · the stamp goes BEFORE its own end is written down — the re-arm fires first · "
        f"killed by `{KILLER}`",
        [(HOST,
          "    this.takeBackWhatItsOwnEndMadeFalse(sessionId, by)\n    this.forgetTheQuitOf(sessionId)\n",
          "    this.forgetTheQuitOf(sessionId)\n    this.takeBackWhatItsOwnEndMadeFalse(sessionId, by)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `setRightANoticeAReopenMadeFalse` is deleted, and the commit lists "every set-right,
        # correction and wake take-back" among what is gone. The rule is now the reverse: a start
        # tells nobody anything, so no notice is set right. The anchor `told !==
        # 'conversation_ended' && told !== 'kept-open'` has zero occurrences. Its anchor is left
        # stale, so the census records it retired.
        "M12 · a start no longer sets right a *still open* notice — only *has ended* is corrected · "
        f"killed by `{WAKES}` and `{WAKE}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: a start must set right a 'still open' notice as well as 'has ended'. The guard in
        # setRightANoticeAReopenMadeFalse is unchanged, at 4-space indent. The plant accepts only
        # 'conversation_ended', so a parent told 'kept-open' is never corrected. §4.1 and §4.2
        # (parent told KEPT_OPEN_UNDRIVEN, then the holder is resumed) both wait for a second
        # receipt. Killed by `the-wakes-last-stale-sentences.test.ts`,
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, "    if (told !== 'conversation_ended' && told !== 'kept-open') return false\n", "    if (told !== 'conversation_ended') return false\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The wake take-back's `const stopped = told === 'conversation_ended' || told ===
        # 'kept-open'` line is deleted with the rest of "every set-right, correction and wake
        # take-back". `toldAboutStall` is now a `Set<string>`, so it no longer records which stop a
        # waker was handed. Its anchor is left stale, so the census records it retired.
        "M13 · a waker is no longer counted as HANDED a *still open* notice it read · "
        f"killed by `{WAKE}`",
        [(HOST, "      const stopped = told === 'conversation_ended' || told === 'kept-open'\n",
          "      const stopped = told === 'conversation_ended'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Its subject was removed on
        # purpose. The plant names `aNoticeItsOwnEndRetracted`, the sentence for a parent that ended
        # the child itself, which went with `end_agent` (D-017 commit 3).
        # a-restart-keeps-what-was-open says: "F-1 control · `its commander’s OWN end is its
        # telling` retired with `end_agent` (D-017, commit 3) — nothing ends a conversation now".
        # The function does not exist, so the plant would be a ReferenceError. The take-back's
        # detail is also no longer reached by any test. Its anchor is left stale, so the census
        # records it retired.
        "M14 · the taken-back notice says the PARENT ended the child itself, when a closing did · "
        f"killed by `{KILLER}`",
        [(HOST,
          "      const detail = aNoticeAClosingRetracted(this.whatToCallTheConversation(task.assignedTo))\n",
          "      const detail = aNoticeItsOwnEndRetracted(this.whatToCallTheConversation(task.assignedTo))\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Commit message: 'list_projects drops
        # its process fields.' `projectWorkRow` now takes only `(task: TaskRow)` — the
        # `notRunning`/kept-open boolean second argument the plant targeted is gone entirely, and
        # `notRunning`/`running` were deleted from `reportOn` along with the
        # `'open-nothing-running'` card state. Its anchor is left stale, so the census records it
        # retired.
        "M15 · 🔴 F-2 RESTORED · `list_projects` rows carry no kept-open fact — *ended* where "
        f"`list_tasks` says open · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `list_projects`' per-task
        # work row still carries a kept-open/startable fact instead of always `false`. The set
        # feeding it was renamed from `keptOpen` to `notRunning` (still built off
        # `startable`-derived card state, per the comment "a conversation this app is not running is
        # one a message starts"), but the rule (`projectWorkRow(task, <it's still reachable>)`) is
        # the same.
        [
            (HOST, '        projectWorkRow(task, notRunning.has(task.assignedTo))\n', '        projectWorkRow(task, false)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same removal as M15:
        # `'open-nothing-running'` no longer exists as an `AgentCard` state (confirmed absent
        # outside comments and the one stale, explicitly-excluded test), and the
        # `live.filter(...).map((card) => card.agent)` line was deleted wholesale, replaced by
        # `conversationsVisibleTo`/`listedFrom` with no running/not-running split — exactly
        # 'list_projects drops its process fields.' Its anchor is left stale, so the census records
        # it retired.
        "M16 · the fact is read for EVERY holder the caller can see, running ones included · "
        f"killed by `{KILLER}`",
        [(HOST,
          "        live.filter((card) => card.state === 'open-nothing-running').map((card) => card.agent),\n",
          "        live.map((card) => card.agent),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `holder_kept_open`/`holderKeptOpen` no
        # longer appears anywhere in `agent-tools.ts` (grep confirms zero hits). `taskPayload`
        # replaced the standalone boolean with `given_to_is: agentStateWords(givenToIs)`, the 'one
        # state, derived once in shared/agent-state.ts... read by list_agents, get_agent_status,
        # list_tasks, list_projects' the commit message describes — a deliberate consolidation, not
        # a relocation of this exact field. Its anchor is left stale, so the census records it
        # retired.
        "M17 · the payload a model reads drops the field the host carried · "
        f"killed by `{KILLER}`",
        [(TOOLS,
          "  ...(row.holderKeptOpen === undefined ? {} : { holder_kept_open: row.holderKeptOpen }),\n",
          "")],
    ),
    (
        "M18 · 🔴 G1 RESTORED · the stand-in is named by its slug — *\"brobot’s list\"* — in the row "
        f"and both answers · killed by `{CHOICE}`",
        [(HOST,
          "    const named = (): string => agentName(standIn, this.deps.store.agentIdentities())\n",
          "    const named = (): string => standIn\n")],
    ),
    (
        "M19 · the conversation's own row reads the slug while the answers read the name · "
        f"killed by `{CHOICE}`",
        [(HOST,
          # ⚑ **707 · re-anchored in place, not retired** — R41 named the SUBJECT too (read in `judgedBy`, as `subjectNamed`); the row still hands the stand-in's slug.
          "      said: aSetAsideChoiceSaid(subjectNamed, choice, because, standInNamed, instead),\n",
          "      said: aSetAsideChoiceSaid(subjectNamed, choice, because, standIn, instead),\n")],
    ),
    (
        "M20 · the spawner's and waker's set-aside answer reads the slug · "
        f"killed by `{CHOICE}`",
        [(TOOLS,
          "        `${judged.standInNamed}’s list because it had no list of its own when it was chosen; its own ` +\n",
          "        `${judged.standIn}’s list because it had no list of its own when it was chosen; its own ` +\n")],
    ),
    (
        "M21 · the could-not-ask answer reads the slug · "
        f"killed by `{CHOICE}`",
        [(TOOLS,
          "    `A person’s choice for this agent was checked only against ${judged.standInNamed}’s ` +\n",
          "    `A person’s choice for this agent was checked only against ${judged.standIn}’s ` +\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed
        # `IdentityUse.projectsOfItsLaunches` (and `projects` and `projectsOfItsStarts`) from
        # agent-roster.ts, and `identityUse` now takes plain `ReadonlySet<string>` for launching and
        # starting. The commit says 'Projects stop being something a person or a model meets', and
        # the card lists 'projects ... project rooms ... go', so 'a launch names its project' is a
        # removed feature, not a moved rule. Its anchor is left stale, so the census records it
        # retired.
        "M22 · 🔴 G2 RESTORED · `IdentityUse` names no project for a launch in flight · "
        f"killed by `{ROSTER_KILLER}`",
        [(ROSTER, "      projectsOfItsLaunches: launching.get(identity.slug) ?? [],\n",
          "      projectsOfItsLaunches: [],\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `launchesByIdentity` now returns a
        # `ReadonlySet<string>` of folded slugs and no longer collects a project per launch; the
        # `projects.add(project)` line is gone. The G2 rule (a launch's project is listed on its
        # identity) was removed on purpose with projects, and `every-identity-he-has.test.ts` had
        # its `projectsOfItsLaunches` assertions deleted by D-016. Its anchor is left stale, so the
        # census records it retired.
        "M23 · a launch's project is never added to its identity's list · "
        f"killed by `{ROSTER_KILLER}`",
        [(HOST, "      if (project !== null) projects.add(project)\n", "      void project\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sorted list of projects per launch
        # no longer exists: `launchesByIdentity` returns a Set of slugs, so there is no launch-order
        # versus sorted distinction left to plant. The whole G2 field (`projectsOfItsLaunches`) was
        # deleted with projects in D-016 (card item 1), and its test assertions went with it. Its
        # anchor is left stale, so the census records it retired.
        "M24 · the projects are handed in launch order, not sorted · "
        f"killed by `{ROSTER_KILLER}`",
        [(HOST,
          "    return new Map([...where].map(([slug, projects]) => [slug, [...projects].sort()]))\n",
          "    return new Map([...where].map(([slug, projects]) => [slug, [...projects]]))\n")],
    ),
    (
        "M25 · 🔴 H-f RESTORED · `rebuildLedger` looks the row up with `find` — a closed conversation "
        f"with no provider ref answers `unknown-session` · killed by `{REBUILD}`",
        [(HOST,
          "    const row = this.deps.store.recordedOne(sessionId)\n    if (row === null) return { outcome: 'unknown-session', status: null }\n",
          "    const row = this.deps.store.find(sessionId) as never\n    if (row === null) return { outcome: 'unknown-session', status: null }\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect is now the
        # decision. The band row could say the giver was told 'still open' only for a holder a Close
        # had made unstartable. D-017 R2 ruled that a Close leaves the holder startable, and
        # a-notice-that-cannot-be-true-is-replaced §3.4 asserts the giver is owed nothing and "the
        # band does not list it". No host-level test now builds a band row with toldItWasStillOpen:
        # true, so 'always false' cannot be killed. Only hand-built rows in the render and dom files
        # carry true. Its anchor is left stale, so the census records it retired.
        "M26 · the band's row never says its giver was told the child was still open — review round "
        f"one's R11, main's half · killed by `{KILLER}`",
        [(HOST,
          "            toldItWasStillOpen: lastToldBy(task.assignedBy).get(task.taskId) === 'kept-open',\n",
          "            toldItWasStillOpen: false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `StalledWork.toldItWasStillOpen` is deleted from stalled-work.ts, along with `lastToldBy`
        # and the band row's `toldItWasStillOpen`/`toldItStartedAgain` fields ("the two R54 leads on
        # the stalled-work band"). The band row no longer says what its giver was told about a
        # kept-open holder. Its anchor is left stale, so the census records it retired.
        "M27 · …and says it of every row, a giver told nothing included · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the band row says a giver was told 'still open' only if it was, and a giver told
        # nothing must read false. The line is unchanged in behaviour (`toldItWasStillOpen:
        # lastToldBy(piece.giver).get(piece.piece) === 'kept-open'`), with 12-space indent. The
        # plant says true of every row, and the giver-told-nothing controls catch it. Killed by
        # `a-restart-keeps-what-was-open.test.ts`,
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, "            toldItWasStillOpen: lastToldBy(piece.giver).get(piece.piece) === 'kept-open',\n", '            toldItWasStillOpen: true,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The defect is now the decision. The commit says "a receipt stands unless its message was
        # abandoned", and stallsToldToSession's docblock says "A notice this app took back because a
        # later fact made it false stands too (D-016c)". `toldIn` collects only `abandoned`
        # messages, so a `retracted` one deliberately stands as a telling. Its anchor is left stale,
        # so the census records it retired.
        "M28 · a notice this app TOOK BACK unread still stands as what its parent was told — review "
        f"round two's S3 · killed by `{KILLER}`",
        [(STORE,
          "      if (event.reason !== 'abandoned' && event.reason !== 'retracted') continue\n",
          "      if (event.reason !== 'abandoned') continue\n")],
    ),
]
