"""661 · What a close does that a reopen never undoes.

⚑ **`656`'s F2, F3 and F4, repaired.** A person's Close and Reopen of a conversation an agent was
working in left three things behind that the reopen never put back: the hand-back an agent-asked
conversation was born with (F2), the question it was still asking (F3), and a parent's belief — told
to it by this app — that the conversation had ended (F4).

## 🔴 A · what the dispatch CHANGED

 1. **F2 · the birth fact has a second way to be true** — `bornWithoutASurface = ownerId === null ||
    anAgentAskedForIt`, where `anAgentAskedForIt` is the durable spawn provenance (341) on a reopen.
    A person's own conversation reopened by a window still ends with that window. ⚑ A slot still
    STARTING is closed when its window goes, whatever it was born as (review).
 2. **F3 · a question the app raised comes back with its conversation** — remembered just before
    the provider's terminal `status` abandons it (`abandonsEveryOpenRequest`, the fold's own test),
    routed again by the reopen in the same app run, and refused while the asker is closed with
    `the-conversation-that-asked-has-ended` (`until-a-person-changes-it`) at both doors. ⛔ Never a
    card the provider raised, never after a restart, never after the parent's `end_agent`.
 3. **F4 · a parent told *"has ended"* is told once that it has not** — `toldAboutStall` became a
    map to what the parent was LAST told (`LastToldAboutWork`), `workReportedTo` reads it off the
    last standing receipt, and `setRightANoticeAReopenMadeFalse` sends one correction when the
    holder is RUNNING again and the row is an open stall on another cause or an open wait. ⚑ Its
    receipt is `how: 'set-right'`, and the next ending is told again — by `aNoticeIsOwed`, the ONE
    predicate the push and the person's queue both read — and the REOPEN asks the question itself,
    because Claude writes nothing until its first turn (both from this dispatch's review).

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on the resume path's `anAgentAskedForIt: provenance !== null`.** On every path this
repository reaches, `provenance !== null` → `false` and dropping `|| anAgentAskedForIt` are the SAME
mutant — a spawn reserves with no sink, so the create path adds nothing either — so a second row
would be `M1`'s verdict counted twice (review). ⚑ The create path's OTHER direction is `M2`.

⚠️ **No row on the stall arm's `!== 'conversation_ended'`** — the second condition of
`setRightANoticeAReopenMadeFalse`'s `standsOn`. It is for a RUNNING holder
whose row a reopen left on the ending, which happens only when `648` had nothing to unwind, and no
path here produces that: a `working` task's turn is interrupted before `status: ended` lands, and a
`waiting` task — stalled by the ending with nothing displaced — is re-stalled `message_never_sent`
by the finalizer before any reopen (measured by §3.7). ⚑ **Measured, not argued**: it was a row and
it SURVIVED — 16/16 green, against this file as it stood before the review's additions. It is kept because it stops a correction that would contradict itself —
*"has not ended after all … the conversation it was given to has ended"* (since `698` the opener reads
*"that conversation was started again after you were told it had stopped"*; the contradiction is the same).

⚠️ **No row on `bringBackTheQuestionsItWasAsking`'s `last === undefined`.** A bug guard: every id it
walks was read off the same ledger's rows.

## 🔴 C · the killers

`apps/desktop/test/what-a-close-does-that-a-reopen-never-undoes.test.ts` for every row but `M2`: §1
for `M1` and `M3`, §2 for `M4`–`M11`, §3 for `M12`–`M26`. `M2` is killed by
`apps/desktop/test/the-door-a-session-can-be-created-through.test.ts` — `336`'s own departure
suite, which is where *a window's departure ENDS what it started* is measured. ⚑ Each row was
verified RED by hand against its killer, anchor count `== 1`, restored from saved bytes.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"

MUTATIONS = [
    # ── F2 · the hand-back ─────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the birth fact forgets who asked · a reopen by a window is a fresh reservation under "
        "that window, so an agent's child loses its hand-back and the window's departure ENDS a "
        "conversation its parent still commands — `656` F2 exactly",
        [
            (
                HOST,
                "      bornWithoutASurface: ownerId === null || anAgentAskedForIt,",
                "      bornWithoutASurface: ownerId === null,",
            )
        ],
    ),
    (
        "M2 · ⛔ every created conversation says an agent asked for it · a person's own conversation "
        "is released when its window goes instead of ended — `336`'s split undone from the other side",
        [(HOST, "          anAgentAskedForIt: spawn !== null,", "          anAgentAskedForIt: true,")],
    ),
    (
        "M3 · ⛔ a window that goes mid-reopen RELEASES the starting slot · the launch then registers "
        "with the departed window's sink while nobody owns it — the owner/sink split `release` exists "
        "to prevent, reachable only since `661`",
        [
            (
                HOST,
                "      if (slot.session === null) {\n        owned.push(slot)\n        continue\n      }\n",
                "",
            )
        ],
    ),
    # ── F3 · the question ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The entire mechanism this row protects
        # (`abandonsEveryOpenRequest`, `rememberTheQuestionsItLeftOpen`, and the map it wrote into)
        # is deleted outright in 45a11477, with zero remaining references anywhere under
        # apps/desktop/src. The card states the new rule directly: "A stop is not an ending: a
        # Close, a reload, a provider failure or a quit hands the messages it held to the next
        # start; only a cut handover is abandoned" — so an ordinary close no longer abandons open
        # questions at all, and there is nothing left to 'remember before' an abandoning ending. Its
        # anchor is left stale, so the census records it retired.
        "M4 · 🔴 nothing is remembered before the ending abandons it · the question is `abandoned` "
        "for ever after a close, and the parent owes an answer to work that vanished — `656` F3",
        [
            (
                HOST,
                "    if (abandonsEveryOpenRequest(wire)) this.rememberTheQuestionsItLeftOpen(session)\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `bringBackTheQuestionsItWasAsking`,
        # `questionsOpenWhenItEnded`, and the `if (session.endedByItsParent !== null) return` guard
        # in front of it are all deleted with no replacement. `end_agent`'s ending of the questions
        # it was asked is now recorded durably in the ASKER's own ledger via
        # `question_recipient_ended` (settled to the terminal `recipient-ended` state,
        # `REQUEST_IS_OPEN['recipient-ended'] === false`), so there is no live in-memory 'bring it
        # back on reopen' step left for a person's reopen to overturn — the design now makes that
        # impossible rather than merely guarding against it. Its anchor is left stale, so the census
        # records it retired.
        "M5 · ⛔ the parent's own ending is overturned by a person · a question the parent ended "
        "with `end_agent` comes back when somebody reopens the conversation (HO-082 §2.2)",
        [
            (
                HOST,
                "    if (session.endedByItsParent !== null) return\n    try {\n      const open = new Set<string>()",
                "    try {\n      const open = new Set<string>()",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The map this filter protected
        # (`questionsThisAppHolds` used to gate which requests got remembered by
        # `rememberTheQuestionsItLeftOpen`) is gone; nothing is remembered across an ordinary stop
        # any more, this-app or provider alike. A provider's own card now simply dies with its
        # process on any stop and is never revived — matching D-017 R1's explicit split, where only
        # a this-app-held question survives a stop (`theWordsOf`) and a provider-raised one with
        # nothing running is refused `the-conversation-that-asked-has-gone`. Its anchor is left
        # stale, so the census records it retired.
        "M6 · ⛔ a dead provider card is brought back · a permission the PROVIDER raised is routed "
        "again after the reopen, although the provider that could take the decision is gone",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 679, not retired.** The held words are asked by the conversation that ended and the id (`questionKey`, 675 F-b); the DEFECT this row plants is unchanged.
                "        if (!this.questionsThisAppHolds.has(questionKey(session.id, request.requestId))) continue\n        open.add",
                "        open.add",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The
        # `bringBackTheQuestionsItWasAsking(session)` call site is deleted outright, and so is the
        # function. There is no 'reopen routes nothing so it stays abandoned' defect reachable any
        # more, because a question's openness now simply survives a stop by staying `open` in the
        # durable ledger (read via `theWordsOf`/`REQUEST_IS_OPEN`) rather than needing an explicit
        # re-route step on reopen. Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 the reopen routes nothing · what the close remembered is never used, so the question "
        "stays `abandoned` and the answer door refuses it for ever with a rail that promises otherwise",
        [(HOST, "    this.bringBackTheQuestionsItWasAsking(session)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):**
        # `questionsOpenWhenItEnded.delete(session.id)` and the map itself are gone. The durable
        # replacement (`settle(event.requestId, 'recipient-ended', entry.at)` in the shared fold) is
        # idempotent by construction — a repeat write changes nothing — so there is no 'consume what
        # it brought back' step left to omit; the whole class of bug (a second reopen routing
        # something a first reopen already routed) cannot occur in the new design. Its anchor is
        # left stale, so the census records it retired.
        "M8 · ⛔ the reopen does not CONSUME what it brought back · a question routed again and then "
        "ended by the parent is still refused as one a reopen would bring back — and a second reopen "
        "routes it again over the parent's ending",
        [
            (
                HOST,
                "    this.questionsOpenWhenItEnded.delete(session.id)\n    try {\n      const routed",
                "    try {\n      const routed",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** This is literally the D-009 defect this
        # commit fixes, quoted in the card: "a person can't answer a question that survived a
        # quit... What we want: a person's answer reaches the asker like any other message, starting
        # the asker if needed, and the question closes." The
        # `aReopenWouldBringItBack`/`theAskerHasEnded` refusal at this exact site in
        # `answerQuestion` is deleted with no replacement; the door now delivers to a
        # closed-but-still-open asker and starts it (`ensureRunning`/`deliverAnswer`, D-017 R1)
        # instead of refusing it as ended. Its anchor is left stale, so the census records it
        # retired.
        "M9 · 🔴 the answer door calls it `question-has-already-ended` · a parent answering while the "
        "asker is closed is told the question is over for good, and the reopen then brings it back",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The ended check now names the asker, to choose the words that are true for this caller (675, 663 F3); The DEFECT this row plants is unchanged.
            (
                HOST,
                '    if (request !== undefined && this.aReopenWouldBringItBack(request)) {\n      return {\n        ok: false,\n        refusal: this.theAskerHasEnded(input.questionId, request.askedBy, by),',
                '    if (false) {\n      return {\n        ok: false,\n        refusal: this.theAskerHasEnded(input.questionId, request!.askedBy, by),',
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same fix, one door over, exactly as the
        # label anticipates ("the same false never, one door over"): the analogous
        # `aReopenWouldBringItBack`/`theAskerHasEnded` guard in `passQuestionUp` is deleted with no
        # replacement. `admitAnswer`'s own `REQUEST_IS_OPEN` check is now the single source of the
        # 'already ended' word for both doors, so a request that is genuinely still open can never
        # be told it has ended. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the pass-up door calls it `question-has-already-ended` · the same false *never*, "
        "one door over",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The ended check now names the asker, to choose the words that are true for this caller (675, 663 F3); The DEFECT this row plants is unchanged.
            (
                HOST,
                '    if (request !== undefined && this.aReopenWouldBringItBack(request)) {\n      return {\n        ok: false,\n        refusal: this.theAskerHasEnded(input.requestId, request.askedBy, by),',
                '    if (false) {\n      return {\n        ok: false,\n        refusal: this.theAskerHasEnded(input.requestId, request!.askedBy, by),',
            ),
        ],
    ),
    (
        "M11 · ⛔ the pass-up door reads the FIRST row for the id · after a reopen that is the "
        "abandoned one, so a live question is refused by quoting the ending before it",
        [
            (
                HOST,
                # ⚠️ **RE-ANCHORED at 679, not retired.** Since 679 the pass-up door finds its row through `theQuestionNamed` — by the ASKER and the id (675 F-b) — so this plants the FIRST routing of the question it found, at THIS door alone, keeping the asker the caller named (the review's correction: a first draft re-looked-up by the id alone and planted 675 F-b too). The DEFECT this row plants is unchanged.
                "    const named = this.theQuestionNamed(speaking, input.requestId, input.askedBy ?? null)\n    if (named.is === 'refused') return { ok: false, refusal: named.refusal }\n    const request = named.request\n",
                "    const named = this.theQuestionNamed(speaking, input.requestId, input.askedBy ?? null)\n    if (named.is === 'refused') return { ok: false, refusal: named.refusal }\n    const found = named.request\n    const request =\n      found &&\n      this.deps.store\n        .questionsRoutedTo(speaking)\n        .find((one) => one.askedBy === found.askedBy && one.requestId === found.requestId)\n",
            )
        ],
    ),
    # ── F4 · the notice ────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row removed the 'was anything reopened' guard of `setRightANoticeAReopenMadeFalse`,
        # the correction sent when a reopen made a stop notice false. 8d54d6dc removed 'every
        # set-right, correction and wake take-back', and 'A stop, a reopen and a start tell nobody
        # anything'. The function no longer exists, so the subject is gone. Its anchor is left
        # stale, so the census records it retired.
        "M12 · 🔴 the correction does not ask whether anything was reopened · a row that leaves "
        "`conversation_ended` inside the teardown that wrote it (`415`'s F-race) gets *\"that "
        "conversation was reopened\"* (since `698`: *\"…was started again\"*) about a conversation "
        "that is still ending",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The correction
        # must first ask whether the holder is running. A row that leaves conversation_ended inside
        # the teardown that wrote it would otherwise get 'started again' about a conversation still
        # ending. The same line now sits in setRightANoticeAReopenMadeFalse, keyed on piece.owner
        # instead of task.assignedTo, and section 3 of the killer covers it. Killed by
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — `runningStateOf(piece.owner)
        # === 'not-running'` is what stops a correction ('that conversation was started again') from
        # being sent for a piece whose holder was replaced (R10) and never restarted. Without the
        # guard, setRightANoticeAReopenMadeFalse takes back a notice that is still true and tells
        # the PM a falsehood. The scenario is a mid-turn worker, then Close (the PM is told it
        # stopped), then reopenForAPerson replaces the unreopenable conversation and the old piece
        # stalls could_not_be_reopened. It needs the mid-turn 661 shape; the auto `aWorkerOver`
        # shape tells the PM turn_ended first and the `told` guard returns before the plant matters.
        # Paired positive: an ordinary reopen (resumeSession) yields exactly one correction. Killed
        # by `the-survivors-the-tree-landing-left.test.ts`.
        [
            (HOST, "    if (this.runningStateOf(piece.owner) === 'not-running') return false\n", ''),
        ],
    ),
    (
        # ⚠️ **EQUIVALENT MUTANT on the tree, recorded rather than removed (landing D-016b part
        # 2):** The plant (`slots.get(owner)?.phase !== 'live'` in place of the running-state check)
        # differs from main only for a slot that is live while its session is finalizing, and the
        # only path there is settleTheNoticesFor after terminate. Getting there needs
        # told='conversation_ended', a message_never_sent stall from a message cut mid-handover, and
        # a correction deferred by aDeliveryIsAboutToDriveIt: a stop, an automatic restart and a
        # second provider death inside one gated handover. Since D-017 R3 a stop hands held messages
        # on rather than abandoning them, so the one-stop path is gone (§3.7b of the 661 file passes
        # on both main and plant), and no suite rig builds the rest. No test can kill it, so it
        # stays unrun.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row read 'running' from the slot phase alone inside the correction guard, and the
        # table already recorded it as an equivalent mutant. The correction and its guard were
        # removed by 8d54d6dc ('every set-right, correction and wake take-back'), so no line exists
        # for the plant. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ *running* is read off the slot's PHASE alone · a provider that ends its own stream "
        "never goes through `close()`, so its slot stays `live` through the finalizer and the false "
        "correction goes out there (found by this dispatch's review)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Same guard as
        # M12, and the same rule: 'running' is read off the runningStateOf answer, not the slot's
        # phase alone. A provider that ends its own stream never goes through close(), so its slot
        # stays live through the finalizer. The plant reads the phase alone and sends the false
        # correction there. The line is unchanged apart from task.assignedTo becoming piece.owner.
        # Killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (HOST, "    if (this.runningStateOf(piece.owner) === 'not-running') return false\n", "    if (this.slots.get(piece.owner)?.phase !== 'live') return false\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row removed the check that a correction goes only to a parent told
        # 'conversation_ended' or 'kept-open'. Neither notice exists any more ('There is no
        # conversation_ended stall cause'; 'the kept-open receipt and notices' are gone), and
        # neither does the correction, so the anchor and the rule are both removed. Its anchor is
        # left stale, so the census records it retired.
        "M14 · ⛔ the correction does not ask what the parent was told · a parent told *\"its turn "
        "ended\"* is told *\"has not ended after all\"* (since `698`: *\"that conversation was started "
        "again after you were told it had stopped\"*) about an ending it never heard of",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 records a *still open* notice apart (`'kept-open'`) and asks this question of both words; the row still removes the question. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a correction is sent only to a parent that was told the holder stopped, in
        # either notice's words (conversation_ended or kept-open). The guard is unchanged in
        # setRightANoticeAReopenMadeFalse and still keyed on the piece. A parent told nothing about
        # a stop must not be told it 'was started again'. Killed by
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (HOST, "    if (told !== 'conversation_ended' && told !== 'kept-open') return false\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row stopped a WAIT from being corrected after a reopen brought a question back.
        # Corrections are gone entirely ('every set-right, correction and wake take-back'), and a
        # reopen tells nobody anything, so there is no correction path left to take a wait through.
        # Its anchor is left stale, so the census records it retired.
        "M15 · ⛔ a WAIT is not corrected · a worker whose question a reopen brought back is waiting "
        "on its parent again, and the parent still believes it has ended",
        [(HOST, "      wait !== null\n        ? { waits: wait }", "      false\n        ? { waits: wait }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row dropped the first line of `tellIfNobodyHasYet`, which asked for the correction.
        # That line is gone, and `tellIfNobodyHasYet` now only tells a stalled piece's giver once.
        # The rule 'the parent's last word about the piece is corrected on a reopen' was removed on
        # purpose with the correction machinery. Its anchor is left stale, so the census records it
        # retired.
        "M16 · 🔴 the correction is never asked for · the one notice that stopped being true is the "
        "parent's last word about the task — `656` F4 exactly",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The correction
        # must actually be asked for from tellIfNobodyHasYet, because the one notice that stopped
        # being true is the parent's last word about the piece (656 F4). That first call is still
        # the first line of tellIfNobodyHasYet, now taking a PieceRow. Dropping it means a reopened
        # holder's parent is never corrected. Killed by
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (HOST, '    if (this.setRightANoticeAReopenMadeFalse(piece)) return\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row made the push record `null` instead of the cause it told, so a later 'has ended'
        # would never be set right. `toldAboutStall` is a `Set<string>` of piece ids again and
        # records no cause, because nothing is set right any more (8d54d6dc: 'The only receipt
        # written is pushed, and a receipt stands unless its message was abandoned'). The
        # once-per-piece rule is a different subject and is carried by rows 400:M7 and 557:M1. Its
        # anchor is left stale, so the census records it retired.
        "M17 · 🔴 the push forgets WHAT it told · every notice reads as *\"told nothing\"*, so no "
        "*\"has ended\"* is ever set right",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the push records what it told, so a later 'has ended' can be set right. The set
        # of toldAboutStall is now keyed by piece.piece and records piece.stalledBecause. The plant
        # records null, so every notice reads as 'told nothing' and no ending is ever set right.
        # Killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (HOST, '    parent.toldAboutStall.set(piece.piece, piece.stalledBecause)\n', '    parent.toldAboutStall.set(piece.piece, null)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row removed the mark that a correction had been sent (`toldAboutStall.set(piece,
        # 'set-right')`). There is no correction to mark, and 'set-right' is now only an inert type
        # value that nothing writes (`WorkStallSetRightEvent stays a type nothing writes`). Its
        # anchor is left stale, so the census records it retired.
        "M18 · ⛔ the correction forgets it was sent · the next status row from the reopened "
        "conversation sends it again, and again",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: once the correction is sent, the parent's record says 'set-right'. Without it
        # the next status row from the reopened holder sends the correction again and again. That
        # mark is still the line after the guard in setRightANoticeAReopenMadeFalse, keyed on the
        # piece. Killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (HOST, "    parent.toldAboutStall.set(piece.piece, 'set-right')\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row broke the clause of `aNoticeIsOwed` that set a correction right at the next ending
        # (close, reopen, close). `aNoticeIsOwed` is gone from tasks.ts and the store, because
        # 8d54d6dc removed the receipt words and 'every set-right, correction and wake take-back'.
        # Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 a CORRECTION is never set right · close, reopen, close: the parent's last word says "
        "the conversation is running while it has ended again — `656` F4 the other way round (found "
        "by this dispatch's review)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a CORRECTION is itself set right by the next ending (close, reopen, close), and
        # aNoticeIsOwed is still the one predicate the push and the person's queue both read. Its
        # last clause is unchanged, apart from the parameter now being a piece. The plant makes the
        # clause false, so a parent whose last word is 'started again' is never told the
        # conversation ended again. Killed by
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (TASKS, "    (lastTold === 'set-right' && piece.stalledBecause === 'conversation_ended')\n", '    false\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row made the receipts fold (`lastToldIn`) read every receipt as 'told nothing', so a
        # parent told 'has ended' was never set right after a restart. `lastToldIn` is replaced by
        # `toldIn`, which only collects piece ids, and there is no 'has ended' to set right. The
        # surviving rule, that receipts still count after a restart, is covered by 400:M7's seed row
        # and 557:M1. Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 the ledger forgets what the parent was told · after a restart every receipt reads "
        "as *\"told nothing\"*, so a parent told *\"has ended\"* before the app stopped is never set "
        "right when the conversation is reopened after it",
                # ⚑ **Anchor corrected in place by `673`**, which gave the correction a second member
                # (`its-own-wake`) and so re-spelled the ternary; the replacement is unchanged.
                # ⚠️ **RE-ANCHORED at 702, not retired.** 702 gives the `pushed` arm a second answer
                # (`'kept-open'`), so the row now forces the ternary's head: every receipt still reads
                # `null`. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: after a restart, lastToldIn (the ledger fold of work_stall_told receipts) must
        # read back what the parent was told, or a parent told 'has ended' before the app stopped is
        # never corrected. The its-own-ending branch went with D-017, so the plant makes the first
        # branch of the surviving ternary read every receipt as 'told nothing' (null). The fold is
        # otherwise unchanged and keyed by piece. Killed by
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (STORE, "        event.how === 'pushed'\n          ? // 🔴 **702 · a push that said the holder is STILL OPEN is its own answer** (`699` F-1)\n", "        true\n          ? null\n          : event.how === 'pushed'\n          ? // 🔴 **702 · a push that said the holder is STILL OPEN is its own answer** (`699` F-1)\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row made the ledger read a sent correction (`how: 'set-right'`) as 'told nothing'.
        # Only `pushed` receipts are written now, old set-right receipts 'count as told', and the
        # `how === 'set-right'` arm of the fold no longer exists in session-store.ts. Its anchor is
        # left stale, so the census records it retired.
        "M21 · ⛔ the ledger reads a correction as *\"told nothing\"* · after a restart, a parent whose "
        "last word was *\"has not ended after all\"* (since `698`: *\"that conversation was started "
        "again\"*) is never told the ending that made it false",
                # ⚑ **Anchor corrected in place by `673`**: the correction is now the ternary's last
                # arm, which `set-right` AND `673`'s `its-own-wake` reach. ⛔ The replacement nulls
                # only `set-right`, so the row stays this table's defect: nulling both would be
                # killed by `673`'s own restart test whatever §3.9b saw (`673 M10` is the other arm).
                # ⚑ **719 · replacement re-aimed in place, anchor unchanged**: R69 put a third member
                # (`its-own-question`) on this arm, and `=== 'its-own-wake' ? … : null` nulled it too —
                # so a table run would have been killed by `719`'s tests whatever this row's saw.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: after a restart a receipt of a sent correction (how set-right) reads back as
        # 'set-right', so the next ending re-arms. The same 'set-right' arm of lastToldIn now also
        # serves its-own-wake and its-own-question, but a sent correction still lands there. The
        # plant reads a sent correction as null. Killed by
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: after a restart the ledger must read a sent correction (how set-right) as
        # set-right, so the next ending re-arms. The comment above the returned literal was
        # re-wrapped to add its-own-brief, so the old two-line anchor stopped matching, but the last
        # comment line plus the literal matches once. The plant reads a sent set-right correction as
        # null. Killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`.
        [
            (STORE, "            // exactly as from a correction that was sent.\n            'set-right',\n", "            // exactly as from a correction that was sent.\n            event.how === 'set-right' ? null : 'set-right',\n"),
        ],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-correction-that-says-it-is-waiting-is-drawn-as-a-wait.test.ts` (the landing added it;
        # no existing test observed this plant).
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row made the report beside a WAIT correction draw as a stall, in
        # `tellOneParentItWasSetRight`. That function is gone, and its killer
        # `a-correction-that-says-it-is-waiting-is-drawn-as-a-wait.test.ts` was deleted by 8d54d6dc
        # ('4 go with their subject ... a correction drawn as a wait'). Its anchor is left stale, so
        # the census records it retired.
        "M22 · ⛔ the report beside a WAIT correction is a stall · the words say *\"it is waiting\"* "
        "and the entry drawn for them says *\"stalled\"* — two accounts of one row (review)",
                # ⚑ **707 · re-anchored in place, not retired** — R40 gave `workWaiting` the giver's project; the row still reports a wait as a stall.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — D-016a only dropped the
        # giversProject argument from workWaiting; the WAIT correction still builds its report in
        # tellOneParentItWasSetRight, so the defect (a WAIT correction beside a 'stalled' report) is
        # still plantable. Plant the same false-condition on the current two-argument line.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the report beside a correction over a WAIT must be drawn as that wait, not as a
        # stall. The choice is unchanged in tellOneParentItWasSetRight, apart from
        # workWaiting(piece, ...) and workUndriven(piece, ...) now taking a piece. The killer was
        # ported to give_work and piecesOwnedBy in 5e931be8. Killed by
        # `a-correction-that-says-it-is-waiting-is-drawn-as-a-wait.test.ts`.
        [
            (HOST, "            'waits' in standsOn\n              ? workWaiting(piece, standsOn.waits)", '            false\n              ? workWaiting(piece, standsOn.waits)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row changed the wording of a correction over a WAIT (`It is waiting: ...` versus
        # 'still not being worked on'). No correction is composed any more, so that sentence has no
        # caller; `WAITING_STANDS_FOR` remains only for `list_tasks`. The defect it planted was
        # removed on purpose with 'every set-right, correction and wake take-back'. Its anchor is
        # left stale, so the census records it retired.
        "M23 · ⛔ the correction says *\"still not being worked on\"* about a worker that is WAITING · "
        "a second false notice about the same task, written by the one meant to set the first right",
        [
            (
                RAILS,
                "      ? `It is waiting: ${WAITING_STANDS_FOR[standsOn.waits]}.`",
                "      ? `It is still not being worked on: ${undrivenNotice('turn_ended', task.stalledBy)}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row plants a defect in the set-right receipt path (the receipt not naming the held
        # message, so a quit-lost correction reads as told). Commit 8d54d6dc removed that path on
        # purpose: "Gone with it: the kept-open receipt and notices, ... the unwind of an ending,
        # and every set-right, correction and wake take-back. The only receipt written is pushed,
        # and a receipt stands unless its message was abandoned." There is no correction to lose to
        # a quit, so no rule is left to plant. Its anchor is left stale, so the census records it
        # retired.
        "M24 · ⛔ a correction a quit threw away reads as told · its receipt does not name the held "
        "message, so the next launch takes *\"set right\"* as heard and never says it again",
        [
            (
                HOST,
                "        how: 'set-right',\n        ...(delivery.outcome === 'queued' ? { messageId: delivery.messageId } : {}),\n",
                "        how: 'set-right',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** M25's defect only exists inside
        # settleTheNoticesFor's own-ending branch, gated on HostedSession.endedByItsParent ("written
        # by endAgent before the teardown", per the old doc comment at line ~197 of the diff) — the
        # finalizer's separate `!parent.toldAboutStall.has(...)` write of null was there
        # specifically to avoid stomping the pump's answer for an agent's OWN end_agent act. Commit
        # 5206d835 deletes end_agent entirely ("end_agent and resume_agent are gone... Nothing ends
        # a conversation") and endedByItsParent no longer exists anywhere in the codebase (grep
        # confirms zero hits). settleTheNoticesFor is now a 6-line loop that calls the single shared
        # tellIfNobodyHasYet(task) for every stalled task — the same function the pump uses — so
        # there is no longer a second write path that can race with or overwrite the pump's
        # toldAboutStall entry; the code's own comment says why: "D-017 · no stop is anybody's own
        # act any more (end_agent is gone), so there is no receipt to write in place of the
        # telling." The two-writers race the row modeled is structurally gone, not merely moved. Its
        # anchor is left stale, so the census records it retired.
        "M25 · ⛔ the finalizer overwrites what the pump already told · a parent pushed *\"has "
        "ended\"* by its own ending's teardown (`415`'s F-race) reads as told nothing in this run and "
        "as *\"has ended\"* after a restart — two answers from one ledger (review)",
        [
            (
                HOST,
                "        if (!parent.toldAboutStall.has(task.taskId)) parent.toldAboutStall.set(task.taskId, null)\n",
                "        parent.toldAboutStall.set(task.taskId, null)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row's rule is that a person's Reopen makes the host ask the giver again (set right, or
        # route a returned question). D-016c ruling (c) reverses this: "its giver is told once, when
        # it stalls. A stop, a reopen and a start tell nobody anything and announce no work." The
        # reopen now publishes only `{type:'reopened'}`, which resets the drive and moves no piece,
        # so there is nothing for it to ask. Its anchor is left stale, so the census records it
        # retired.
        "M26 · 🔴 the reopen does not ask · on Claude, whose reopened provider writes nothing until its "
        "first turn, a parent told *\"has ended\"* hears nothing when a person reopens the "
        "conversation — and a question the reopen routed back waits on a parent that was never told "
        "(round two of this dispatch's review)",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 hands the push the holder's id. The DEFECT this row plants is unchanged.
        # ⚑ **T-002 · re-anchored in place, not retired** — D-005a asks the same line in
        # `askOnceTheQueueLeftItUndriven`, so the anchor now carries the reopen's own next line.
        # Same defect. Re-verified RED alone.
        [(HOST, "    this.tellWhoeverGaveTheWork(session.id)\n\n    return this.discloseReopened(session, row, {\n",
          "\n    return this.discloseReopened(session, row, {\n")],
    ),
]
