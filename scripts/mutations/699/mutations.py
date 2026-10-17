"""699 · what a quit left open, everywhere — `692` F-c, F-d and F-l, ruled.

⛔ **`692` brought the conversation a quit left open into being, and three places still read it as
ended or said nothing after a crash.** The PM ruled all three:

 * **F-c — parity.** *"The same ending writes the same record — its work stalls under the same word
   either way."* `end_agent` on a conversation the quit left open wrote no `work_interrupted`;
   ending a RUNNING child does.
 * **F-d — main's half.** The Work tab said *has ended* about work a quit-left-open conversation
   holds. *"Give the reading a live fact beside the durable one — `holderKeptOpen` is the model."*
 * **F-l — after a crash, say why.** *"Conversations open when the app did NOT finish quitting come
   back closed, and the reading says so … Main's half: the fact, at launch."*

## ⚑ What a row here measures

 * ⚑ **M1–M3 are F-c's ask** — the kept-open end records it at all, through the no-session arm, and
   with the ORIGINAL caller rather than the app.
 * ⚑ **M4–M7 are F-d's LIVE fact on the Work tab** — the host hands it in, it is not handed in for
   every holder, the shared builder writes it, and the ending that clears it tells a window.
 * ⚑ **M8–M10 are F-d's DURABLE fact on the notice's own report** — written, written only where the
   words say open, and read back by the store's field-by-field bound.
 * ⚑ **M11–M15 are F-l's derivation** — the rail row carries the fact, a slot excludes it, and each
   half of the terminal test is its own row.
 * ⚑ **M16–M18 are review round one's F-c** — the ask when a start is in flight; the held notice the
   parent's own end made false, taken back; and the receipt that says it was the parent's own act.
 * ⚑ **M19–M23 are review round one's F-l** — a quit that BEGAN and never recorded finishing: read at
   launch, written at all, cleared by the quit's own record and by a reopen; and the unresumable half
   carries the fact too.
 * ⚑ **M24–M26 are review round two's** — the mark written BEFORE the teardown and not after it (the
   mirror of `692`'s record-after order); a held notice whose words are still TRUE is not taken back;
   and the in-flight end takes back what it made false too.

## ⛔ What this table cannot reach

 * ⚠️ **The order inside `endWhatTheQuitClosed`** — the ask before the stamp goes — is observable
   only through a ledger write that throws; no test breaks the store mid-end.
 * ⚠️ **The correction's `workUndriven(…, false)`** — a correction is owed because the holder was
   REOPENED, which clears the quit's record, so `true` there is a state nothing reaches.
 * ⚠️ **The second-live-host blind spot of `aRunThatDidNotQuitLeftIt`** is stated, not guarded:
   two hosts over one ledger object is a test-only shape (`live-hosts.ts`).
 * ⚠️ **`takeBackWhatItsOwnEndMadeFalse`'s FIRST filter conjunct** (`holderKeptOpen`) — every notice
   held at the moment of an end was composed in this app run, after the launch that left its holder
   open, so a commander's always carries it. ⛔ **The SECOND (the cause) IS reachable and is M25**
   (round two corrected this list, which called both unreachable): work a busy child held at the quit
   becomes `message_never_sent`, whose notice is still true. ⚠️ Its `parent === null` return is the
   compiler's: the caller of `end_agent` is a live conversation by construction.
 * ⚠️ **`toldAboutStall.set(…, null)` after a retraction** decides what a LATER person's Reopen tells
   that parent (`661`'s correction is not owed for its own ending); no test reopens it afterwards.
 * ⚠️ **The in-flight branch's `theQuitClosed` conjunct** — without it, a parent's end of a CLOSED
   conversation whose ordinary reopen is in flight would write an ask too; no test ends one there.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"

KILLER = "a-restart-keeps-what-was-open.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The commit message states 'end_agent
        # and resume_agent are gone (21 tools)... Nothing ends a conversation.' The plant targeted
        # `endWhatTheQuitClosed`'s ask-recording inside the `endAgent` method; both
        # `endWhatTheQuitClosed` and `endAgent` are entirely deleted (confirmed absent by grep), so
        # there is no longer an agent verb that 'ends' a conversation to compare against a running
        # child's end. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 F-c RESTORED · `end_agent` on a conversation the quit left open records no ask, "
        f"where a running child's end records one · killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 puts the own-end mark between the ask and the stamp's clearing, so the row anchors on the method's head. The DEFECT this row plants is unchanged.
        [(HOST, "  private endWhatTheQuitClosed(sessionId: string, by: Caller): EndOutcome {\n    this.recordTheAsk(sessionId, by)\n",
          "  private endWhatTheQuitClosed(sessionId: string, by: Caller): EndOutcome {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same removal as M1: this row targeted
        # the no-session ledger write inside the deleted `endWhatTheQuitClosed`. `recordTheAsk`'s
        # own signature was narrowed by this commit from `(session: HostedSession | string, by:
        # Caller)` to `(session: HostedSession, by: Caller)`, confirming the string/no-session arm
        # existed only for `end_agent` and left with it. Its anchor is left stale, so the census
        # records it retired.
        "M2 · the ask built for a conversation with no session is never written into its ledger · "
        f"killed by `{KILLER}`",
        [(HOST, "    this.deps.store.append(session, this.deps.store.nextOrdinal(session), ask, this.now())\n",
          "    void ask\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The plant targeted `endAgent`'s `if
        # (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)` branch. The whole
        # `endAgent` method (and `endWhatTheQuitClosed`) is deleted by this commit as part of
        # 'end_agent and resume_agent are gone', so there is no caller left to swap `by` for
        # `THE_APP_ITSELF` in. Its anchor is left stale, so the census records it retired.
        "M3 · the kept-open end is recorded as the APP's, which writes no row — the parent that asked "
        f"goes unnamed · killed by `{KILLER}`",
        [(HOST, "    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)\n",
          "    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, THE_APP_ITSELF)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `workGivenOutBy(sessionId, (holder) => this.startable(holder) !== null)` is now
        # `workGivenOutBy(sessionId)`, with no per-holder liveness predicate. The commit removes
        # "the window's left-open and idle words", so the Work tab is no longer told, or made to
        # say, whether a holder is open. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 F-d RESTORED · the Work tab is never told a holder is open, so it can only say *has "
        f"ended* · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The rule survives:
        # `tasksAssignedBy` still asks a per-holder predicate to mark Work-tab rows as kept-open.
        # Only the predicate's name changed, from `keptOpen(holder) !== null` (quit-only) to
        # `startable(holder) !== null` (D-017 R2, reachable however it stopped) — the commit's own
        # words: "startable replaces the quit-only keptOpen." Forcing it to `() => false` reproduces
        # "never told a holder is open."
        [
            (HOST, '    return this.deps.store.workGivenOutBy(sessionId, (holder) => this.startable(holder) !== null)\n', '    return this.deps.store.workGivenOutBy(sessionId, () => false)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The per-holder predicate that this row's plant replaces with `() => true` no longer
        # exists, since `workGivenOutBy` takes only the session id. The Work tab draws no "open" or
        # "has ended" word from a process fact: "A process stopping ... changes nothing about a
        # piece". Its anchor is left stale, so the census records it retired.
        "M5 · the Work tab calls EVERY holder open — a running child and a crash-closed one too · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same call site as M4,
        # opposite plant: forcing the predicate to always-true reproduces "every holder called open,
        # including a crash-closed one." The rule (the Work tab asks `startable`, not a
        # stale/blanket flag) is unchanged; only the predicate's name moved from `keptOpen` to
        # `startable`.
        [
            (HOST, '    return this.deps.store.workGivenOutBy(sessionId, (holder) => this.startable(holder) !== null)\n', '    return this.deps.store.workGivenOutBy(sessionId, () => true)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The shared builder's `holderKeptOpen` parameter and its spread are removed from
        # `shared/tasks.ts` (0 occurrences). It was the row-side half of the left-open word the
        # commit deletes. Its anchor is left stale, so the census records it retired.
        "M6 · the shared builder drops the fact it was handed, so no row carries it · "
        f"killed by `{KILLER}`",
        [(TASKS, "    ...(holderKeptOpen ? { holderKeptOpen: true as const } : {}),\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'ending that clears the quit's
        # record' was `forgetTheQuitOf`, which D-017b deleted. `close()` of a conversation with no
        # slot is now `// ⚠️ The tolerant no-op for an id nothing is running: there is nothing to
        # stop`, so a person's Close of a quit-left-open conversation ends nothing and clears no
        # stamp. The remaining `announceTheWorkItHolds(…,'ending')` sites are the teardown (table
        # 689's row, `THE_ENDING`) and the replacement path, so no row is left to re-anchor here.
        # Its anchor is left stale, so the census records it retired.
        "M7 · the ending that clears the quit's record tells no window about the work it holds, so the "
        f"rows a Work tab holds keep `holderKeptOpen` until its tick · killed by `{KILLER}`",
        [(HOST, "    this.theWorldMoved('conversations')\n    this.announceTheWorkItHolds(sessionId, 'ending')\n",
          "    this.theWorldMoved('conversations')\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `keptOpen` is no longer an argument of `undrivenWorkText` or `workUndriven`, and the
        # notice's report carries no such fact. The commit removes "the kept-open receipt and
        # notices", and the F-d test now asserts only "the turn the quit interrupted, and nothing
        # about a process". Its anchor is left stale, so the census records it retired.
        "M8 · the notice's own report never carries the fact, so its row says *has ended* under words "
        f"that say open · killed by `{KILLER}`",
        [(REPLY, "    ...(keptOpen ? { holderKeptOpen: true as const } : {}),\n", "")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-giver-that-may-not-reach-its-holder-is-not-told-it-is-open.test.ts` (the landing added
        # it; no existing test observed this plant).
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `workUndriven(piece, cause, keptOpen)` call is now `workUndriven(piece, cause)`. The
        # reach question that fed `keptOpen` (`aMessageStartsIt && withinMessagingReach`) is
        # deleted, so there is no longer a report that can say "open" while the words say "has
        # ended". Its anchor is left stale, so the census records it retired.
        "M9 · the report says open to a giver whose words say *has ended* — the reach its words asked "
        f"is skipped · killed by `{KILLER}`",
        # ⚑ **707 · re-anchored in place, not retired** — R40 gave the report the giver's project; the row still skips the reach its words asked.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The report to a giver
        # still asks whether a message would start the holder and whether the giver may reach it,
        # but `giversProject` is gone from `workUndriven` and `keptOpen` is a local built from
        # `aMessageStartsIt(...) && withinMessagingReach(...)`; `this.keptOpen(...)` no longer
        # exists. The plant swaps that local for the unrestricted `aMessageStartsIt` call, which
        # skips the reach the giver's words asked. Caveat: since D-014 `assertMayAssign` requires
        # `mayCommand`, a task's giver commands its holder, so this is probably an equivalent mutant
        # unless a test narrows a giver's reach after the assignment.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the report beside the words must not say 'kept open' to a giver whose words do not.
        # The local `keptOpen` is still `aMessageStartsIt(owner) && withinMessagingReach(...)`, so
        # the plant hands the report only the first half. The table's 'probably an equivalent
        # mutant' caveat is refuted: a-giver-that-may-not-reach-its-holder-is-not-told-it-is-open
        # plants an outsider giver whose grant reaches nothing, and asserts the report has no
        # holderKeptOpen. The label's killer names a-restart-keeps-what-was-open, but the real
        # killer is the a-giver-that-may-not-reach... file. Killed by
        # `a-giver-that-may-not-reach-its-holder-is-not-told-it-is-open.test.ts`.
        [
            (HOST, '        { report: workUndriven(piece, cause, keptOpen) },\n', '        { report: workUndriven(piece, cause, this.aMessageStartsIt(piece.owner)) },\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The store's read-back no longer has a `holderKeptOpen` line: the field was removed from
        # `WorkReport` and "Old ledgers read inertly", so nothing reads the stored flag. The commit
        # removes "the kept-open receipt and notices". Its anchor is left stale, so the census
        # records it retired.
        "M10 · the store's field-by-field read-back drops the fact, so the ledger holds it and no "
        f"reader gets it · killed by `{KILLER}`",
        [(STORE, "    ...(report.holderKeptOpen === true ? { holderKeptOpen: true as const } : {}),\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted the field this row
        # plants on: the rail row lost `closedBecauseTheAppDidNotFinishQuitting`, and
        # `aRunThatDidNotQuitLeftIt` is gone (0 hits in src). The killer's own docblock says so:
        # "D-017b retired F-l's reading... *closed because BroBot did not finish quitting* is a
        # sentence about a process, and no row says one now". The card says the same: "no sentence
        # about whether anything is running". Its anchor is left stale, so the census records it
        # retired.
        "M11 · 🔴 F-l RESTORED · after a crash the rail's row carries no reason — closed, with nothing to "
        f"say why · killed by `{KILLER}`",
        [(HOST, "      closedBecauseTheAppDidNotFinishQuitting: this.aRunThatDidNotQuitLeftIt(session),\n",
          "      closedBecauseTheAppDidNotFinishQuitting: false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The slot guard sat inside
        # `aRunThatDidNotQuitLeftIt`, which D-017b deleted along with
        # `closedBecauseTheAppDidNotFinishQuitting`. There is no longer any 'closed by a crash' word
        # that a running conversation could wrongly carry. The killer now asserts only that every
        # row lists as `{ running: 'not-running' }`, with no word saying why. Its anchor is left
        # stale, so the census records it retired.
        "M12 · a conversation the app is running again is said to be closed by a crash · "
        f"killed by `{KILLER}`",
        [(HOST, "    if (this.slots.has(session.sessionId)) return false\n    if (session.status !== 'ended'",
          "    if (session.status !== 'ended'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** This row degraded the terminal-status
        # test inside `aRunThatDidNotQuitLeftIt`, which the commit removed. The 'closed because a
        # crash' reading of a rail row was retired on purpose: F-l's positive arm became a negative
        # one ("after a CRASH or a quit that did not finish, every row is listed as any other — no
        # word says why"). The row no longer has a defect to plant. Its anchor is left stale, so the
        # census records it retired.
        "M13 · every row says a crash closed it — a person's Close, an agent's end and a failure too · "
        f"killed by `{KILLER}`",
        [(HOST, "    if (session.status !== 'ended' && session.status !== 'errored') return true\n"
                "    return this.deps.store.theQuitWasClosing(session.sessionId)\n",
          "    return true\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Half of the deleted
        # `aRunThatDidNotQuitLeftIt` status test, whose `errored` arm distinguished a failed
        # provider from a crash-closed one. That distinction fed a rail word that no longer exists.
        # D-017b's rule is that a conversation is listed the same however it stopped; the killer's
        # §3 test 'a conversation whose provider failed before the quit is listed as the ones the
        # quit stopped' now pins that. Its anchor is left stale, so the census records it retired.
        "M14 · a conversation whose provider FAILED is said to be closed by a crash · "
        f"killed by `{KILLER}`",
        [(HOST, "    if (session.status !== 'ended' && session.status !== 'errored') return true\n",
          "    if (session.status !== 'ended') return true\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The other half of the deleted status
        # test: a person's Close or an agent's end must not read 'closed by a crash'. The whole word
        # is gone, and so is the Close-versus-crash distinction on the rail. The listing is now the
        # same for every kind of stop, so there is nothing left for this defect to be. Its anchor is
        # left stale, so the census records it retired.
        "M15 · a conversation a person closed or an agent ended is said to be closed by a crash · "
        f"killed by `{KILLER}`",
        [(HOST, "    if (session.status !== 'ended' && session.status !== 'errored') return true\n",
          "    if (session.status !== 'errored') return true\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The plant targeted the in-flight-start
        # branch inside `endAgent` (`if (slot.session === null &&
        # this.deps.store.theQuitClosed(sessionId)) { this.recordTheAsk(...) ... }`). That whole
        # branch was part of `endAgent`, which the commit deletes outright with `end_agent`. Its
        # anchor is left stale, so the census records it retired.
        "M16 · a parent's end while a START of the child is in flight records no ask — the same ending, "
        f"no record · killed by `{KILLER}`",
        [(HOST, "    if (slot.session === null && this.deps.store.theQuitClosed(sessionId)) {\n"
                "      this.recordTheAsk(sessionId, by)\n",
          "    if (slot.session === null && this.deps.store.theQuitClosed(sessionId)) {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The plant targeted `endAgent`'s own
        # closing sequence (`takeBackWhatItsOwnEndMadeFalse` → `forgetTheQuitOf` → `return
        # 'ended'`). `endAgent` and `takeBackWhatItsOwnEndMadeFalse` are both gone; the surviving
        # sibling mechanism for a person's Close / a start that can't succeed
        # (`takeBackWhatTheClosingMadeFalse`) is a pre-existing, untouched function with no
        # standalone two-call sequence of this shape to mutate (its own surviving gate is covered
        # separately at 702:M10). Its anchor is left stale, so the census records it retired.
        "M17 · 🔴 a parent's own end does not take back what it made false — since `702` the closing "
        "then takes the HELD *\"it is still open\"* notice back in ITS words and tells the parent *has "
        f"ended* about its own act (on `main`: the notice was delivered) · killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 702, not retired — and its LABEL moved with its effect** (`702`'s review,
        # round two). 702 moved the taking-back ahead of the stamp's clearing; the row still removes it.
        # ⛔ *"Delivered anyway"* is now held twice over — the own end's retraction AND the closing's
        # (`702` M6) — so no single row plants it; this one plants the own end's half, which the
        # killer's `itself` detail and `its-own-ending` receipt still catch. Re-verified RED.
        [(HOST, "    this.takeBackWhatItsOwnEndMadeFalse(sessionId, by)\n    this.forgetTheQuitOf(sessionId)\n    return 'ended'\n",
          "    this.forgetTheQuitOf(sessionId)\n    return 'ended'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `how: 'its-own-ending'` is no longer
        # written anywhere in the app (grep across main/db confirms zero write sites); the union
        # member is kept only so old ledger rows still read back. The new docblock at
        # `settleTheNoticesFor` says why directly: 'D-017 · no stop is anybody's own act any more
        # (`end_agent` is gone), so there is no receipt to write in place of the telling.' Its
        # anchor is left stale, so the census records it retired.
        "M18 · the notice is taken back and the receipt does not say it was the parent's own act · "
        f"killed by `{KILLER}`",
        [(HOST, "{ type: 'work_reported', taskId, cause, how: 'its-own-ending' }",
          "{ type: 'work_reported', taskId, cause, how: 'pushed' }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `SessionStore.theQuitWasClosing` and
        # the `closing_for_the_quit_at` mark were deleted (0 hits in src), together with the only
        # reader, `aRunThatDidNotQuitLeftIt`. The killer's F-l test states it: "the quit's *began
        # closing* record it was read off (`theQuitIsClosing`)" was retired. What a quit that began
        # and never finished says about its rows is now nothing, and the test's final arm asserts
        # exactly that. Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 a quit that BEGAN and never recorded finishing is read as a person's Close — its "
        f"teardown wrote `ended` and nothing else is asked · killed by `{KILLER}`",
        [(HOST, "    return this.deps.store.theQuitWasClosing(session.sessionId)\n", "    return false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `recordWhatTheQuitIsClosing` was
        # deleted from `closeAll` and from the host, and the quit no longer writes the began-closing
        # mark at all. Nothing reads that mark any more, so a cut-short quit leaving nothing to read
        # is the intended state. `closeAll` still calls `recordWhatTheQuitClosed` in its `finally`,
        # and that ordering is covered by table 692. Its anchor is left stale, so the census records
        # it retired.
        "M20 · the quit never writes what it began, so a quit cut short leaves nothing to read · "
        f"killed by `{KILLER}`",
        [(HOST, "    this.recordWhatTheQuitIsClosing(theQuitCloses)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The store's `clearClosingForTheQuit`
        # prepared statement and its clearing loop in `closedByTheQuit` were deleted. Nothing writes
        # the began-closing mark, so there is no mark to leave behind or to clear. It belongs to the
        # same mechanism D-017b retired: F-l's reading and the quit's began-closing record. Its
        # anchor is left stale, so the census records it retired.
        "M21 · a quit that FINISHED leaves its mark behind, so a conversation it kept open also reads as "
        f"closed by a quit that did not finish · killed by `{KILLER}`",
        [(STORE, "    for (const id of sessionIds) clearClosingForTheQuit.run(id)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `reopened()` no longer clears
        # `closing_for_the_quit_at`, because `clearClosingForTheQuit` is gone. Nothing sets the
        # column either, so 'a reopen leaves the mark' cannot be planted. The rail no longer
        # distinguishes a conversation closed by a person from one closed by an unfinished quit. Its
        # anchor is left stale, so the census records it retired.
        "M22 · a reopen leaves the mark, so a conversation a person later closed still reads as closed by "
        f"an unfinished quit · killed by `{KILLER}`",
        [(STORE, "    clearClosingForTheQuit.run(sessionId)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The unresumable half of the rail no
        # longer carries `closedBecauseTheAppDidNotFinishQuitting`: `unresumableSessions()` now maps
        # `running` and `state` only. The killer asserts
        # `expect(unresumable).not.toHaveProperty('closedBecauseTheAppDidNotFinishQuitting')`. The
        # reading was retired by D-017b, so the defect 'carries no reason' is now the decision. Its
        # anchor is left stale, so the census records it retired.
        "M23 · the UNRESUMABLE half carries no reason — a conversation a crash caught before its first "
        f"turn is closed with nothing to say why · killed by `{KILLER}`",
        [(HOST, "      closedBecauseTheAppDidNotFinishQuitting: this.aRunThatDidNotQuitLeftIt(row),\n",
          "      closedBecauseTheAppDidNotFinishQuitting: false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row's first edit removes
        # `recordWhatTheQuitIsClosing`, which D-017b deleted, so the began-closing mark it orders no
        # longer exists. Its second edit still anchors once, but it would only insert a call to that
        # deleted method, which is a TypeError rather than the label's defect. The rule 'the quit
        # records what it closed only AFTER the teardown' survives and is already held by table 692
        # (lines 81 and 88 on `recordWhatTheQuitClosed`) and the killer's 'crash before then records
        # nothing' test. Its anchor is left stale, so the census records it retired.
        "M24 · the quit writes what it began only AFTER the teardown, so a quit cut short mid-teardown "
        f"leaves `ended` rows unmarked — the defect the mark exists for · killed by `{KILLER}`",
        [(HOST, "    this.recordWhatTheQuitIsClosing(theQuitCloses)\n", ""),
         (HOST, "      this.recordWhatTheQuitClosed(theQuitCloses)\n",
          "      this.recordWhatTheQuitIsClosing(theQuitCloses)\n      this.recordWhatTheQuitClosed(theQuitCloses)\n")],
    ),
    (
        # ⚠️ Landing D-017 (5206d835) · a KNOWN SURVIVOR: a task can never read `conversation_ended`
        # while its holder is unstartable (a replacement re-stalls it to `could_not_be_reopened` in
        # the same step), so the check this plant removes never sees a notice of another cause. Kept
        # so a later change that lets them meet is measured.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `takeBackWhatTheClosingMadeFalse` and its `holderKeptOpen === true && stalledBecause ===
        # 'conversation_ended'` filter are deleted, along with the "kept-open" telling and "the
        # unwind of an ending". §8 F-1 of the killer file now asserts that a person's Close of a
        # quit-left-open child leaves the held notice standing and "nothing more is said", so there
        # is no taking back to over-reach. Its anchor is left stale, so the census records it
        # retired.
        "M25 · a held notice whose words are still TRUE — *the message carrying it was never sent* — is "
        f"taken back as if its parent's end had made it false · killed by `{KILLER}`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The plant's exact text
        # lived inside `takeBackWhatItsOwnEndMadeFalse` (deleted with `end_agent`), but the
        # identical filter — 'only retract a held notice whose own report really says
        # conversation_ended, not just holderKeptOpen' — survives byte-for-byte (different
        # indentation) inside the pre-existing sibling `takeBackWhatTheClosingMadeFalse`, called
        # from `tellIfNobodyHasYet`. The surface moved (function, indentation) but the rule is
        # unchanged.
        [
            (HOST, "          one.authorship.work?.holderKeptOpen === true &&\n          one.authorship.work.stalledBecause === 'conversation_ended',\n", '          one.authorship.work?.holderKeptOpen === true,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same in-flight branch of `endAgent` as
        # M16 (`this.recordTheAsk(sessionId, by); this.takeBackWhatItsOwnEndMadeFalse(sessionId,
        # by)`), deleted wholesale with `end_agent`. Its anchor is left stale, so the census records
        # it retired.
        "M26 · a parent's end while a START is in flight does not take back what it made false — since "
        "`702` the closing takes the held *still open* notice back in ITS words and tells the parent "
        f"*has ended* about its own act (on `main`: the notice was read) · killed by `{KILLER}`",
        # ⚠️ **LABEL corrected at 702** (`702`'s review, round two): the anchor is untouched, but 702's
        # closing re-arm now retracts the notice too, so the row plants the own end's half — as M17.
        [(HOST, "      this.recordTheAsk(sessionId, by)\n      this.takeBackWhatItsOwnEndMadeFalse(sessionId, by)\n",
          "      this.recordTheAsk(sessionId, by)\n")],
    ),
]
