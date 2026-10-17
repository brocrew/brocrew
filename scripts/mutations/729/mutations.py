"""729 · the words that were lost, and who asked — R89, R90, `725` draw 9.

⛔ **Ordered by the PM** from `724` F-1 (R89: a reply HELD for a busy giver and then lost carried no
words on `list_tasks`, and the replier's ledger said nothing), `724` F-2 (R90: the asker, named since
`724`, is usually the reader — a giver was told *"…, by Ada"* about its own interrupt) and `725` draw 9
(GAP-M3: `StalledWork` carried no ask, so a person's band could not say who asked).

## ⚠️ What a row here measures

 * ⚑ **M1–M12 are R89** — the one door every host-written ending of a held message passes
   (`publishOurs`) records a held ANSWER that ended unsent (M1), for every ending but `sent` (M2),
   into the REPLIER's ledger (M3); only the answer itself counts (M4–M6: `theAnswerItCarries`); the record goes through a live
   replier's own session (M7) and waits for one mid-reopen (M8); it names the giver and says the
   word (M9, M12); and the crash's ending, which the store writes at the next launch, writes the same
   row (M10, M11) — killed by `the-words-that-were-lost-and-who-asked.test.ts` §1 and §2, and M4 by
   `a-notice-that-cannot-be-true-is-replaced.test.ts` §1.6 on both provider shapes.
 * ⚑ **M13–M17 are R90** — the reader's own ask is said as its own act (M13, M15), another asker is
   still named (M14), and both the line `list_tasks` hands its caller (M16) and the notice pushed to
   the giver (M17) ask for the right reader — killed by `state-a-supervisor-can-trust.test.ts`, whose
   `720`/`724` tests are re-aimed to R90 on both provider shapes and whose ancestor tests are the
   controls, and at the composer by §3.
 * ⚑ **M18–M20 are `725` draw 9** — the band's row carries who asked (M18), with the asker's id
   (M20) and its IDENTITY's name (M19) — killed by `state-a-supervisor-can-trust.test.ts`' `729`
   draw-9 test and `work-that-stalls-with-nobody-to-tell.test.ts`.
 * ⚑ **M21–M25 are `729`'s review** — the answer being handed over is recorded like any other (M21
   plants the exemption round one added and round two removed);
   the crash repair never TRIES a conversation this database does not hold (M22 — a bundle's
   stranded answer naming one used to stop the launch) and records once (M24); the predicate never
   reads a non-report as one (M23, at its API: the store's door already drops that shape); and the
   band's asker name is read per look (M25) — killed by §1b, §2.5 and the draw-9 test.

## ⛔ What has NO row here, and who holds it instead

 * ⚠️ **The correction's call site** (`tellOneParentItWasSetRight` → `correctedWorkText`): its stall
   arm carries an ask only when a reopen restores a stall whose own push the giver never read, and no
   rig here builds that (`724` F-8, unchanged). ⚑ The arm is pinned at its composer (§3.1) and the
   reader it asks for is `parent.id`, as the push's is (M17); a call site that handed another reader
   would survive, and that is stated rather than dressed as a row.
 * ⚠️ **The deferred write's loop guard** (`writeTheLostAnswer`): a slot that settles WITHOUT
   registering and stays in the map is not a state any launch here leaves, so dropping the guard
   (re-asking forever) is not reachable by a test — the guard is argued in its docblock.
 * ⚠️ **The crash road's `running` skip** — a replier another live host holds: two hosts over one
   database are a test construct, and the ending above it carries the same skip for the same reason.
 * ⚠️ **The hook's `reason !== 'sent'` guard** — measured an equivalent: the first M3 dropped it and
   SURVIVED, because a `sent` ending carries no report at all (`UnqueuedMessageEvent.work` is absent
   on `sent`, and `runFlush` spreads no authorship there), so `theAnswerItCarries` answers `null`
   either way. ⚑ The guard stays as the rule's own words; M3 now plants a real defect.
 * ⚠️ **The crash repair's `try`/`catch`** around the record's append: once the replier is known
   to be held here (M22's check), no reachable failure is left for it to catch — it is the
   *never at the cost of the launch* guard for a failure nobody has found, argued in its comment.
 * ⚠️ **The prose rows** — docblocks, which no test reads (standing rule 19).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
WORDS = "the-words-that-were-lost-and-who-asked.test.ts"
NOTICE = "a-notice-that-cannot-be-true-is-replaced.test.ts"
SUPERVISOR = "state-a-supervisor-can-trust.test.ts"
BAND = "work-that-stalls-with-nobody-to-tell.test.ts"

PUSH_READER = """          // 🔴 **724 · `720` F-C — and whoever ASKED is named too**, the same way — ⚑ unless it is
          // the parent reading this (`729`, R90): then it is said as its own act.
          theAskNamed(
            task.stalledBy,
            (conversation) => this.whatToCallTheConversation(conversation),
            // 🔴 **729 · R90 — the parent this is written to READS it**, so an ask it made itself is
            // said as its own act — `parent.id`, the conversation the words go to.
            parent.id,
"""

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · R89 — an answer held for its giver and then lost ───────────────────────────────────
    (
        "M1 · 🔴 R89 undone · no held answer that ends unsent is recorded — `main`'s silence: the "
        f"giver's Close leaves the replier's ledger saying nothing and the row wordless · killed by `{WORDS}`",
        [(HOST, "      this.recordAnAnswerItsGiverNeverGot(session, event)\n", "")],
    ),
    (
        "M2 · ⛔ only an ABANDONED held answer is recorded · a Cancel at its door takes the answer out "
        "of the giver's mailbox and the loss is never written (R89's *by any road*; no control offers "
        f"one today) · killed by `{WORDS}`",
        [(HOST, "    if (event.type === 'message_unqueued' && event.reason !== 'sent') {\n", "    if (event.type === 'message_unqueued' && event.reason === 'abandoned') {\n")],
    ),
    (
        "M3 · 🔴 the record is written into the GIVER's ledger · the fold reads the replier's, so the "
        f"row stays wordless and the child's card still says delivered · killed by `{WORDS}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `writeTheLostAnswer` was
        # renamed/merged into the generic `writeIntoItsLedger` (D-017's 'whatever state it is in'
        # writer, now shared by lost answers, withdrawals and question endings), but
        # `recordAnAnswerItsGiverNeverGot` still calls it with `answer.assignedTo` as the target
        # ledger. Swapping to `giver.id` recreates the exact same 'written into the GIVER's ledger
        # instead of the replier's' defect.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # lost answer is recorded in the ledger of the conversation that wrote it) still holds.
        # R89's `recordAnAnswerItsGiverNeverGot` calls `writeIntoItsLedger(answer.owner, …)`, the
        # old `writeTheLostAnswer`. The plant writes it into the giver's ledger instead, so the
        # worker's ledger has no `reply_undelivered` record. Killed by
        # `the-words-that-were-lost-and-who-asked.test.ts`.
        [
            (HOST, '    this.writeIntoItsLedger(answer.owner, {\n', '    this.writeIntoItsLedger(giver.id, {\n'),
        ],
    ),
    (
        "M4 · ⛔ R48's own line counts as the answer · a giver closed holding *\"…could not be delivered "
        f"to you\"* records the loss a second time · killed by `{NOTICE}` and `{WORDS}`",
        [(TASKS, "    authorship.relayedFrom === replier\n", "    true\n")],
    ),
    (
        "M5 · ⛔ any report relayed from the conversation it names is an answer · a stall notice would "
        "be recorded as a lost reply — a shape no writer here makes, and one a bundle's ledger can "
        f"bring; killed at the predicate's own API · killed by `{WORDS}`",
        [(TASKS, "  return work.state === 'answered' &&\n", "  return true &&\n")],
    ),
    (
        "M6 · ⛔ two absent keys match · a report from before `506`, or a bundle's, names no replier "
        "and is read as an answer with nowhere to write it; killed at the predicate's own API · "
        f"killed by `{WORDS}`",
        [(TASKS, "    typeof replier === 'string' &&\n", "")],
    ),
    (
        "M7 · 🔴 a LIVE replier is written through the store · its window never sees the row, and the "
        "row takes the ordinal the live session is about to — the conversation stops recording · "
        f"killed by `{WORDS}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The live-write branch M7
        # protected moved from `writeTheLostAnswer` into the new shared `writeIntoItsLedger`, whose
        # live branch is `if (slot?.session != null) { this.publishOurs(slot.session, row); ... }`;
        # the not-running branch calls the sibling `appendIntoItsLedger`. Routing the live case
        # through `appendIntoItsLedger` instead reproduces M7's defect (a live replier's window
        # never sees the row; it silently takes the store's ordinal).
        [
            (HOST, '    const slot = this.slots.get(sessionId)\n    if (slot?.session != null) {\n      this.publishOurs(slot.session, row)\n      landed?.()\n      return\n    }\n', '    const slot = this.slots.get(sessionId)\n    if (slot?.session != null) {\n      this.appendIntoItsLedger(sessionId, row)\n      landed?.()\n      return\n    }\n'),
        ],
    ),
    (
        "M8 · 🔴 a replier mid-REOPEN is written at once · the reopen took its first ordinal before its "
        "provider answered, so the row takes it and the conversation stops recording · killed by "
        f"`{WORDS}`",
        [(HOST, "    if (slot !== undefined) {\n      void slot.arrived.then(() => {\n", "    if (slot === null) {\n      void slot.arrived.then(() => {\n")],
    ),
    (
        "M9 · ⛔ the record names the REPLIER as the conversation it was for · the lost reply points at "
        f"itself · killed by `{WORDS}`",
        [(HOST, "      parent: giver.id,\n      because: AN_ANSWER_HELD_THEN_LOST,\n", "      parent: answer.assignedTo,\n      because: AN_ANSWER_HELD_THEN_LOST,\n")],
    ),
    (
        "M10 · 🔴 a CRASH's lost answer is never recorded · the next launch ends the held message and "
        f"the replier's ledger stays silent · killed by `{WORDS}`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The crash-repair path in
        # settleStrandedMessagesTx still guards recording a lost answer on `answer !== null`, so a
        # crash-stranded held answer is still written into the replier's ledger at the next launch.
        # D-017's try/catch wrap (explicitly discussed in the surrounding comment as 'until D-017')
        # added two spaces of indent to this exact two-line guard, so the old anchor no longer
        # matches; the R89 rule it protects is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # crash repair at the next launch records the answer the giver never got) still holds. The
        # guard is now in `settleStrandedMessagesTx` in session-store.ts, where `answer !== null`
        # opens the repair. The plant makes it `false &&`, so a stranded answer is abandoned with no
        # lost-answer record. Killed by `the-words-that-were-lost-and-who-asked.test.ts`.
        [
            (STORE, '            answer !== null &&\n            !running.has(answer.owner) &&\n', '            false &&\n            !running.has(answer.owner) &&\n'),
        ],
    ),
    (
        "M11 · ⛔ the crash's record names the REPLIER as the conversation it was for · killed by "
        f"`{WORDS}`",
        [(STORE, "                parent: held.session_id,\n", "                parent: answer.assignedTo,\n")],
    ),
    (
        "M12 · ⛔ the later loss says it happened at the call (`not-delivered`) · a reader cannot tell "
        f"a reply refused from one held and then lost · killed by `{WORDS}`",
        [(HOST, "      because: AN_ANSWER_HELD_THEN_LOST,\n    })\n  }\n", "      because: 'not-delivered',\n    })\n  }\n")],
    ),
    # ── §B · R90 — the reader's own ask, said as its own act ────────────────────────────────────
    (
        "M13 · 🔴 R90 undone · the reader is never the asker — a giver that stopped its own worker is "
        f"told *\"…, by Ada\"*, on both provider shapes · killed by `{SUPERVISOR}` and `{WORDS}`",
        [(RAILS, "  if (ask.by === 'an-agent' && ask.asker !== null && ask.asker === reader) {\n", "  if (false) {\n")],
    ),
    (
        "M14 · ⛔ every agent's ask is the reader's own · Ada is told *\"you asked it to stop\"* about "
        f"Grace's ask · killed by `{SUPERVISOR}` and `{WORDS}`",
        [(RAILS, "  if (ask.by === 'an-agent' && ask.asker !== null && ask.asker === reader) {\n", "  if (ask.by === 'an-agent' && ask.asker !== null) {\n")],
    ),
    (
        "M15 · ⛔ the composer does not read `byTheReader` · the reader's own ask reads *\"…, by an "
        f"agent\"* · killed by `{SUPERVISOR}` and `{WORDS}`",
        [(RAILS, "  if (by?.byTheReader === true) return `${stall}; ${YOU_ASKED_IT_TO_STOP}`\n", "")],
    ),
    (
        "M16 · ⛔ `list_tasks`' line asks for the HOLDER as its reader · the caller that asked is named "
        f"to itself · killed by `{SUPERVISOR}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (R90:
        # the list_tasks line says the READER's own ask as its own act) still holds.
        # `theAskNamed(piece.stalledBy, whatToCall, reader)` in agent-tools.ts takes the reader. The
        # plant passes the piece's owner as the reader, so the giver's own stop reads as someone
        # else's ask. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the asker is named by its piece on the chain of the piece whose turn it stopped
            (TOOLS, "theAskNamed(piece.stalledBy, (asker) => whatToCall(asker, piece.piece), reader)", "theAskNamed(piece.stalledBy, (asker) => whatToCall(asker, piece.piece), piece.owner)"),
        ],
    ),
    (
        "M17 · ⛔ the pushed notice asks for the HOLDER as its reader · the giver that asked is named to "
        f"itself · killed by `{SUPERVISOR}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (R90:
        # the pushed notice says the reader's own ask as its own act, so it is told the parent's id)
        # still holds at the push site in runtime-host.ts. The plant passes the piece's owner as the
        # reader, so the parent's own stop is worded as someone else's. Killed by
        # `state-a-supervisor-can-trust.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The R90 rule is unchanged: the pushed notice asks `theAskNamed` for
        # the parent as its reader, so the parent's own ask is said as its own act. The row's old
        # comment anchor is gone, but the same call still passes `parent.id,` under the new comment,
        # so the plant passes `piece.owner` (the holder) as the reader instead. The giver that asked
        # is then named to itself wrongly in the pushed notice, which the supervisor tests assert
        # against. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            (HOST, '            // said as its own act — `parent.id`, the conversation the words go to.\n            parent.id,\n', '            // said as its own act — `parent.id`, the conversation the words go to.\n            piece.owner,\n'),
        ],
    ),
    # ── §C · `725` draw 9 — the band says who asked ──────────────────────────────────────────────
    (
        "M18 · 🔴 draw 9 undone · the band's row carries no ask — `725` GAP-M3 · killed by "
        f"`{SUPERVISOR}` and `{BAND}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # person's band carries `askedToStop` only when the piece was asked to stop) still holds in
        # `stalledWorkForAPerson`. `askedToStop` is set only when `piece.stalledBy !== null`, and
        # the plant makes it always true, so a band with no ask says it was asked to stop. Killed by
        # `state-a-supervisor-can-trust.test.ts`, `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (HOST, '            askedToStop:\n              piece.stalledBy === null\n', '            askedToStop:\n              true\n'),
        ],
    ),
    (
        "M19 · ⛔ the asker is named by its FOLDER · beside a holder and a giver named by identity since "
        "`732`, one row names agents two ways and Grace reads as the folder every agent in it shares "
        f"(R41) · killed by `{SUPERVISOR}`",
        # ⚠️ **732 · RE-ANCHORED, the subject unchanged** (found by `732`'s review): `732` removed the
        # folder memo `name` from `stalledWorkForAPerson` (`729` F-1), so this replacement planted a
        # `ReferenceError` — killed by a crash, not by the folder. It calls the folder naming itself now.
        # ⚠️ **734 · RE-ANCHORED AGAIN, the subject unchanged**: `nameForAPerson` names the AGENT since
        # `734` (`732` F-1) and takes the roster, so the old replacement named Grace rightly or threw —
        # the folder read is `folderOf` now, and that is what this plants.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (`askedToStop.askerName` is what a person calls the asker, not its folder) still holds in
        # `stalledWorkForAPerson`, which builds it from `whatToCall(piece.stalledBy.asker)`. The
        # plant names it by its folder. Killed by `state-a-supervisor-can-trust.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — `stalledWorkForAPerson` now names the asker with
        # `piece.stalledBy.asker === null ? null : nameByItsWork(piece.stalledBy.asker)`. The plant
        # names the asker by its FOLDER instead (`this.folderOf`, a private method of the same
        # class), so one row names agents two ways and Grace reads as the folder every agent in it
        # shares (R41). The killer asserts `askerName: theConversationCalled('Grace', itsWork)` and
        # 'Gina' beside it. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the asker is named by its piece on the chain of the piece whose turn it stopped, which wraps the line
            (HOST, "                      piece.stalledBy.asker === null\n                        ? null\n                        : nameByItsWork(piece.stalledBy.asker, piece.piece),\n", "                      piece.stalledBy.asker === null\n                        ? null\n                        : this.folderOf(piece.stalledBy.asker),\n"),
        ],
    ),
    (
        "M20 · ⛔ the band's ask drops the asking conversation · a person cannot go to it · killed by "
        f"`{SUPERVISOR}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (`askedToStop.asker` carries the asker's conversation id so a rename is followed) still
        # holds in `stalledWorkForAPerson`. The plant sets `asker: null`, so the band cannot follow
        # the asker. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            (HOST, '                    asker: piece.stalledBy.asker,\n', '                    asker: null,\n'),
        ],
    ),
    # ── §D · `729`'s review, round one — where no record is owed, and the launch it must never cost ─
    (
        "M21 · 🔴 the answer being HANDED OVER as the giver ends is exempted · the exemption `729` built "
        "and removed: a Close stops the provider first, the held send is refused, and the row goes "
        f"wordless over words that never arrived · killed by `{WORDS}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired —
        # `recordAnAnswerItsGiverNeverGot` (now calling `writeIntoItsLedger` instead of
        # `writeTheLostAnswer`) still has no handingOver exemption, matching the card's own note
        # that '729 built and then removed an exemption' and 'the answer being HANDED OVER as the
        # giver ended is recorded too'. `HostedSession.handingOver` and
        # `UnqueuedMessageEvent.messageId` are unchanged fields, so re-inserting the same
        # early-return exemption recreates the exact regression the row guards against.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (an
        # answer already handed over to its giver is not recorded as lost, R89 §1.10) still holds in
        # `recordAnAnswerItsGiverNeverGot`. The plant skips the handed-over check that keeps the
        # record off the row. Killed by `the-words-that-were-lost-and-who-asked.test.ts`.
        [
            (HOST, '    const answer = theAnswerItCarries(ending)\n    if (answer === null) return\n    this.writeIntoItsLedger(answer.owner, {\n', '    const answer = theAnswerItCarries(ending)\n    if (answer === null) return\n    if (giver.handingOver !== null && giver.handingOver.id === ending.messageId) return\n    this.writeIntoItsLedger(answer.owner, {\n'),
        ],
    ),
    (
        "M22 · 🔴 the crash repair writes into a conversation this database never held · a bundle's "
        "stranded answer makes the append fail the foreign key — caught, warned, but TRIED · killed by "
        f"`{WORDS}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # lost answer is not recorded for a conversation this install does not hold) still holds in
        # the crash repair in session-store.ts (`selectConversationHeld.get(answer.owner) !==
        # undefined`). The plant removes that condition, so a foreign conversation gets a record and
        # a warn. Killed by `the-words-that-were-lost-and-who-asked.test.ts`.
        [
            (STORE, '            selectConversationHeld.get(answer.owner) !== undefined &&\n', ''),
        ],
    ),
    (
        "M23 · ⛔ a value that is not a report is read as one · `work: null` throws inside the "
        "predicate — a shape the store's door drops on the way in (`boundWorkReport`), so no product "
        f"path reaches it; killed at the predicate's own API · killed by `{WORDS}`",
        [(TASKS, "  if (!isAWorkReport(work)) return null\n", "  if (work === undefined) return null\n")],
    ),
    (
        "M24 · ⛔ the crash repair records a loss the host already recorded · the child's transcript "
        f"draws a second *\"did not reach\"* · killed by `{WORDS}`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (one
        # record per lost answer: no second record when it is already there, R89 §1.12) still holds
        # in the crash repair, where `selectALostAnswerRecorded.get(answer.owner, answer.piece) ===
        # undefined` opens the write. The plant makes the check always true, so every repair writes
        # another record. Killed by `the-words-that-were-lost-and-who-asked.test.ts`.
        [
            (STORE, '            selectALostAnswerRecorded.get(answer.owner, answer.piece) === undefined\n', '            true\n'),
        ],
    ),
    (
        "M25 · ⛔ the band's asker names outlive one answer · a renamed agent is still called by its "
        f"old name on every look for the life of the app · killed by `{SUPERVISOR}`",
        [(HOST, "    const called = new Map<string, string>()\n", "    const called = ((this as unknown as { calledOnce?: Map<string, string> }).calledOnce ??=\n      new Map<string, string>())\n")],
    ),
]
