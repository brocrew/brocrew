"""711 · a notice that cannot be true is replaced — R48, R49, R54, `701` F-1, `703` F-B2.

⛔ **Ordered by the PM** from `703` F-A1/F-A2/F-B2, `701` F-1/F-2 and `702` F-5: an answer that could
not be delivered left *"It has not been answered"* standing (R48); after a person's Reopen the
parent's own answer left *"It is waiting: …nobody has answered"* standing (R49); the band's row for
`661`'s re-arm carried no mark (R54); the room, the Team page and the forest read *Ended* over a
conversation a quit left open (`701` F-1); and the open-work sentence's `withdraw_task` clause sat
past the 200-character cut (`703` F-B2).

## ⚠️ What a row here measures

 * ⚑ **M1–M8 are R48** — the call, the snapshot taken as the answer lands, the *nothing held,
   nothing said* guard, the taking back, the reason on the row, the report beside the line, the
   line's words, and its scope (an answer that LANDED sends none) — killed by
   `a-notice-that-cannot-be-true-is-replaced.test.ts` §1.
 * ⚑ **M9–M15 are R49** — the call, the taking back, the record (`set-right`) and what it opened
   on, the snapshot of the correction on the wire, the flush guard, and the line's words — killed
   by §2.
 * ⚑ **M16–M17 are R54** — the mark and its scope — killed by §3.
 * ⚑ **M18–M22 are `701` F-1** — each list's fact, both ends of a spawn edge — killed by §4.
 * ⚑ **M23 is `703` F-B2** — the whole act inside the cut — killed by `the-act-inside-the-cut.test.ts`.
 * ⚑ **M24–M28 came from `711`'s own review** — R48's step-time half, R49 following a correction
   once, R54's control on the *still open* population, `respondUserInput`'s app-held arm, and the
   flush's positive record of a correction it handed over — killed by §1.5, §2.7, §3.4, §2.3 and
   §2.6.

## ⛔ What has NO row here, and who holds it instead

 * ⚠️ **R49's *still waiting on an answer?* check** (`itWaits === 'waiting-on-an-answer'`): no rig
   holds a second question about one piece of work across a reopen — `703`'s table says the same of
   its own copy of that check. Stated, not dressed as a row.
 * ⚠️ **R49's `report === null` return** — a row that is neither a stall nor a wait when a WAIT
   correction is held: no path produces one (a correction is only ever sent over those two).
 * ⚠️ **R49's `conversation_ended` return** (`711`'s review, round two) — the holder ended again
   before the question's ending reached the step: only a Stop pressed while a conversation whose
   provider ended its own stream is being finalized reaches it. Unrigged, and stated.
 * ⚠️ **`publishStateIfChanged` after each taking back** — the harnesses' sinks drop `sendLiveness`,
   as `690`'s, `699`'s and `703`'s tables say of theirs.
 * ⚠️ **R49's scope guard, `=== 'that-it-stopped'`, in `theWaitsThatSetRightAStop`**: a correction
   that opened on NOTHING is taken back one step EARLIER in the same chain (`703`'s
   `its-question-ended`), so every rigged path finds none left — the guard decides only for one on
   the wire as the question ends, which no rig holds (and which R49 does not reach: `711` F-3). A
   row planted there SURVIVES (measured by reading, not dressed as a row); §2.2 is its control.
 * ⚠️ **The prose rows of `701` F-2** — docblocks, which no test reads (standing rule 19).
 * ⚠️ **§5 was a measurement of a finding, not a repair** — ⚑ corrected in place by `719`: PM ruling R69
   repaired it, and §5 moved to `a-giver-that-asked-was-told.test.ts` §1, turned round, where table
   `719`'s M1–M6 guard it.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 deleted `OPEN_WORK_OUTLASTS_IT` with `a-message-you-cannot-withdraw-is-waiting`: M23 is retired
by ruling.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
KILLER = "a-notice-that-cannot-be-true-is-replaced.test.ts"
CUT = "the-act-inside-the-cut.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · R48 — an answer that could not be delivered ─────────────────────────────────────────
    (
        "M1 · 🔴 R48 undone · an undelivered answer leaves *\"It has not been answered\"* standing "
        f"about answered work · killed by `{KILLER}` §1.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R48 survives
        # under piece names: the reply tail in runtime-host.ts still calls
        # replaceWhatAnUndeliveredAnswerMadeFalse(piece, input, resources.map(one => one.resource),
        # heldAsItWasAnswered) when !REPLY_LANDED[delivered]. Only the task/documentId spelling and
        # the call's line breaks changed. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 038b7f1b (D-030) deleted replaceWhatAnUndeliveredAnswerMadeFalse. An answer whose delivery throws into a running giver is now held in its mailbox (deliverReplyTo's catch), answers 'held', and so reaches the shared take-back `if (REPLY_LANDED[delivered])`. The plant makes the undelivered-then-held road answer as not landed, so the push 'It has not been answered' stands about answered work. Killer §1.1 ('a delivery that threw holds the answer, and the push is taken back') expects delivered 'held' and a 'retracted' unqueue. Caveat: the plant also mis-states the delivery and writes a reply_undelivered row, which §1.1 also asserts against. It is a stronger mutant than the old deletion, but it is the only undelivered-specific spot left. The generic take-back line is 703 M2's anchor.
            (HOST, "      if (where === 'its-mailbox') return { delivered: 'held', why: null }\n", "      if (where === 'its-mailbox') return { delivered: 'not-delivered', why: null }\n"),
        ],
    ),
    (
        "M2 · ⛔ the notice is looked for only AFTER the delivery · a push the flush handed over while "
        f"the answer waited is read and nothing follows it · killed by `{KILLER}` §1.4",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R48's 'look
        # for the held push BEFORE the delivery' survives as `const heldAsItWasAnswered =
        # this.piecesWithANoticeHeldFor(piece.giver).has(piece.piece)` (tasksWithANoticeHeldFor
        # became piecesWithANoticeHeldFor; task.assignedBy became piece.giver). Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — `heldAsItWasAnswered` is a
        # snapshot taken BEFORE `await this.deliverReply(...)`, because a flush that hands the push
        # over removes it from the mailbox, so a read taken after the await sees nothing held and
        # the ANSWERED_NOT_DELIVERED line is lost. §1.4 of
        # a-notice-that-cannot-be-true-is-replaced.test.ts is vacuous for this: its injected failure
        # throws before the flush, so the mailbox still holds the push either way. The new test
        # makes the failure wait until the flush has handed the push over (unqueued reasons
        # ['sent'], one push read) and then throw, and asserts exactly one ANSWERED_NOT_DELIVERED
        # line held. The plant leaves zero lines, so it fails by assertion. Paired positive: the
        # §1.3 shape (nothing held, so no line) and the eager-failure arm. Killed by
        # `the-survivors-the-tree-landing-left.test.ts`.
        [
            (HOST, '    const heldAsItWasAnswered = this.piecesWithANoticeHeldFor(piece.giver).has(piece.piece)\n', '    const heldAsItWasAnswered = false\n'),
        ],
    ),
    (
        "M3 · ⛔ a line is sent with nothing held about the work · a giver never told the work was "
        f"unanswered is told it could not be delivered · killed by `{KILLER}` §1.3",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'nothing
        # held about the work means send no line' guard survives in
        # replaceWhatAnUndeliveredAnswerMadeFalse as `if (!heldAsItWasAnswered &&
        # !this.piecesWithANoticeHeldFor(giver.id).has(piece.piece)) return`, now split over two
        # lines by the formatter. Killed by `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, '        if (!heldAsItWasAnswered && !this.piecesWithANoticeHeldFor(giver.id).has(piece.piece))\n          return\n', ''),
        ],
    ),
    (
        "M4 · ⛔ nothing is taken back · the giver reads *\"It has not been answered\"* and then the "
        f"line that says it was · killed by `{KILLER}` §1.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # taking-back loop survives verbatim apart from the rename: `for (const stale of
        # this.theNoticesALaterFactMadeFalse(giver, piece, 'answered')) {` (task became piece).
        # Killed by `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # R48 still holds: an undelivered answer takes back the stale notices about the piece as
        # `retracted` before the one true line is queued. In replaceWhatAnUndeliveredAnswerMadeFalse
        # the loop is now `for (const stale of this.theNoticesItWillStillRead(giver, piece.piece))
        # {`, since theNoticesALaterFactMadeFalse and its third argument are gone. The plant empties
        # the iteration with .slice(0, 0). Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 038b7f1b (D-030) deleted replaceWhatAnUndeliveredAnswerMadeFalse's own loop. An undelivered (held) answer's push is now taken back by the shared takeBackWhatALaterFactMadeFalse(piece, 'answered') for a live giver, so 'nothing is taken back' is planted there (the auto-guess). It now hits every later fact's live take-back, not only the answer's. Killer §1.1 expects a 'retracted' unqueue and no push read. 703 M5 uses the same anchor with a different replacement.
            (HOST, "        const unread = this.theNoticesItWillStillRead(parent, piece.piece)\n", "        const unread = this.theNoticesItWillStillRead(parent, piece.piece).slice(0, 0)\n"),
        ],
    ),
    (
        "M5 · ⛔ the row says the giver withdrew the work · a person reads the wrong reason beside the "
        f"words this app took back · killed by `{KILLER}` §1.1",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 038b7f1b (D-030) deleted R48's own `aNoticeALaterFactRetracted('answered', holder)`. The undelivered (held) answer's take-back now names its fact at the shared call in replyToParent. The plant names 'withdrawn', so the retracted row says the giver took the work back. Killer §1.1 expects detail matching TAKEN_BACK_ANSWERED (/... answered that work$/). 703 M2 deletes this same line, a different replacement on the same anchor.
        [(HOST, "    if (REPLY_LANDED[delivered]) this.takeBackWhatALaterFactMadeFalse(piece, 'answered')\n", "    if (REPLY_LANDED[delivered]) this.takeBackWhatALaterFactMadeFalse(piece, 'withdrawn')\n")],
    ),
    (
        "M6 · ⛔ the line carries no report · the entry a person's transcript draws beside it says "
        f"nothing of the answer · killed by `{KILLER}` §1.1",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # undelivered-answer line carries the answer's own report so the person's transcript draws
        # it. Only the `giversProject` argument left `workAnswered`, and the queueMessage call in
        # `replaceWhatAnUndeliveredAnswerMadeFalse` is now `{ report: workAnswered(task, input,
        # documentId) }`. `{}` is a valid TurnFacts, and §1.1's `reportHeldWith(...)` then reads
        # `event.work` as undefined, so its `toMatchObject({taskId, state:'answered',
        # outcome:'done'})` fails as an assertion.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the undelivered-answer line still carries the answer's own report so a person's
        # transcript draws it. The call is now `{ report: workAnswered(piece, input, resources) }`;
        # `{}` is a valid facts argument. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 038b7f1b (D-030) removed R48's line and its `{ report: workAnswered(...) }`. What a person's transcript now draws beside the held words is the ANSWER's own report, in deliverReplyTo's facts. The killer re-aimed §1.1 there: reportHeldWith(pm, /the migration is finished/) expects piece/label/state 'answered'/outcome 'done'. Without `report`, authorshipOf writes no `work` on message_queued. `report` is optional on TurnFacts, so this type-checks. It may overlap a 406/439-era row on reply facts (439's own anchor for this block is the pre-D-016 spelling).
            (HOST, "          report: workAnswered(\n            piece,\n            input,\n            resources.map((one) => one.resource),\n          ),\n          carriedFor: piece.owner,\n", "          carriedFor: piece.owner,\n"),
        ],
    ),
    (
        "M7 · ⛔ the line drops *\"could not be delivered\"* · the giver is told the work was answered "
        f"and waits for words that are not coming · killed by `{KILLER}` §1.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The line's
        # words survive in reply-rails.ts anJustification: anAnswerThatCouldNotBeDelivered still
        # says 'was answered, but the answer could not be delivered to you'. Only the pointer
        # changed, to 'read its record with list_tasks, naming ${piece.label}'. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (REPLY, 'was answered, but the answer could not be delivered to you: read its record with list_tasks, naming', 'was answered: read its record with list_tasks, naming'),
        ],
    ),
    (
        "M8 · ⛔ a LANDED answer sends the line too · the giver reads *\"could not be delivered\"* about "
        f"an answer it is reading · killed by `{KILLER}` §1.2",
        [(HOST, "    if (!REPLY_LANDED[delivered]) {\n      this.replaceWhatAnUndeliveredAnswerMadeFalse(", "    if (delivered !== undefined) {\n      this.replaceWhatAnUndeliveredAnswerMadeFalse(")],
    ),
    # ── §B · R49 — the question a correction waits on ends ────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects R49: the parent's own answer must not leave the WAIT correction ('It is
        # waiting: ... nobody has answered') standing. The commit removed the WAIT correction and
        # its replacement ("every set-right, correction and wake take-back", and "a correction drawn
        # as a wait" among the tests that went with their subject). Section 2 of the killer was
        # already retired by D-017 (R4), and replaceWhatItsQuestionEndingMadeFalse /
        # putWhatIsTrueInPlaceOfTheWait no longer exist. Its anchor is left stale, so the census
        # records it retired.
        "M9 · 🔴 R49 undone · the parent's own answer leaves *\"It is waiting: …nobody has answered\"* "
        f"standing · killed by `{KILLER}` §2.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # Rule survives: when a question ends, the parent's held 'It is waiting' correction must be
        # replaced by one true line. takeBackWhatAnAnswerMadeFalse calls
        # takeBackWhatALaterFactMadeFalse(piece,'its-question-ended') and then
        # replaceWhatItsQuestionEndingMadeFalse(piece). Plant: delete the second call, so the held
        # correction is taken back and nothing true follows. The old killers were section 2 of
        # a-notice-that-cannot-be-true-is-replaced.test.ts, retired by D-017 R4 (a Close ends no
        # question; an asking worker's stop pushes nothing); sections 3.1 to 3.5 remain and never
        # call replaceWhatItsQuestionEndingMadeFalse. Structural censuses
        # (the-question-every-teardown-asks.test.ts line ~486 lists reader names only;
        # three-waits-one-family.test.ts ~985 counts === 'waiting-on-an-answer' comparisons in named
        # bodies) do not fail on this deletion. MISSING TEST: a real host where the giver was told
        # conversation_ended or kept-open, the child comes back waiting on a person's question so
        # the giver holds an 'It is waiting' correction opened that-it-stopped, the giver's mailbox
        # is busy so it is held, then the question ends leaving the child stalled with a cause other
        # than conversation_ended (a working child returns early on report === null and writes
        # nothing). It must also assert this state is reachable after D-017 R4. Assert the held
        # correction is retracted and exactly one 'no longer waiting on an answer' line follows; the
        # paired positive is the child still waiting (no replacement written). ⚠️ No test kills it
        # yet: the landing owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — R49 is real and reachable in
        # the product, but only when a woken child raises its question before anything else is
        # evaluated: a non-giver delivery defers the STALL correction unmarked, the child's turn is
        # open and it asks, and the first evaluation after that is the WAIT arm, which queues 'It is
        # waiting' behind the stop notice in a busy giver's mailbox. The giver's answer then has to
        # retract it and queue one true line. The shared double cannot open that window (in ask mode
        # the card is evaluated first and marks 'set-right'; in auto mode the turn ends at once),
        # but ResumeControl.pause in provider-double.ts holds the stream right after 'working', so a
        # test-local double that passes a pause to claudeOnAResume opens it. The plant (drop the
        # replaceWhatItsQuestionEndingMadeFalse call) is kept as written. Killed by
        # `what-the-tree-landing-left-unpinned.test.ts`.
        [
            (HOST, '        this.replaceWhatItsQuestionEndingMadeFalse(piece)\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects taking back the correction so the giver does not read 'nobody has
        # answered' and then the replacement line. That correction and the replacement line were
        # both removed by "every set-right, correction and wake take-back", and section 2.1 of the
        # killer was retired by D-017. The surviving R48 loop over the stall notice is row M4, which
        # is re-anchored. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the correction is not taken back · the giver reads *\"nobody has answered\"* and then "
        f"the line · killed by `{KILLER}` §2.1",
        [(HOST, "        if (wait === onTheWire) continue\n        this.takeQueuedBack(giver, wait, { reason: 'retracted', detail: why })\n", "        if (wait !== undefined) continue\n        this.takeQueuedBack(giver, wait, { reason: 'retracted', detail: why })\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects recording the replacement line as a correction in the ledger. The commit
        # says "The only receipt written is pushed" and "old receipts count as told", and
        # WorkStallSetRightEvent "stays a type nothing writes", so no set-right receipt is written
        # for the line. The anchor is gone from runtime-host.ts. Its anchor is left stale, so the
        # census records it retired.
        "M11 · 🔴 the line is not recorded as a correction · the ledger's last word about the work is "
        "the ending again, and a later launch is owed a correction the giver already read · killed by "
        f"`{KILLER}` §2.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # Rule survives: putWhatIsTrueInPlaceOfTheWait publishes a work_stall_told receipt
        # how:'set-right' carrying the queued messageId, so the ledger (workReportedTo) records that
        # the giver was set right and a later launch owes nothing twice. Plant: delete the
        # publishOurs receipt (its follow-on correctionsHeld.set(went.messageId,'that-it-stopped')
        # stays). No existing test asserts this receipt: the old section 2 killers of
        # a-notice-that-cannot-be-true-is-replaced.test.ts were retired by D-017 R4, and sections
        # 3.1 to 3.5 read receipts written by other paths (its-own-wake, kept-open, set-right from
        # setRightAWait). MISSING TEST: same premise as 711:M9 (held WAIT correction, question ends,
        # child stalled with a cause other than conversation_ended), then assert
        # store.workReportedTo(giver).get(piece) is 'set-right' and the event carries the messageId.
        # Paired positive: the giver is not sent a second correction after a relaunch. ⚠️ No test
        # kills it yet: the landing owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — Same rig as 711:M9, different
        # assertion: putWhatIsTrueInPlaceOfTheWait must record the replacement as a work_stall_told
        # how:'set-right' receipt carrying its messageId, because the first correction was retracted
        # and a retracted notice's receipt does not stand. Without that receipt the ledger's last
        # word about the piece falls back to the stop notice ('pushed'/kept-open), and a later
        # launch owes the giver a correction it already read. Assert on the store's last standing
        # report and on the receipt events; the old string occurs once. Killed by
        # `what-the-tree-landing-left-unpinned.test.ts`.
        [
            (HOST, "      this.publishOurs(giver, {\n        type: 'work_stall_told',\n        piece: piece.piece,\n        how: 'set-right',\n        ...(went.outcome === 'queued' ? { messageId: went.messageId } : {}),\n      })\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects recording what the line opened on so that a later withdrawal does not
        # take back the one line that sets right a stop the giver READ. There is no such line: "the
        # unwind of an ending, and every set-right, correction and wake take-back" are gone and "a
        # stop ... tell[s] nobody anything". The state it kept (correctionsHeld / heldAsItEnded) no
        # longer exists, and section 2.5 was retired with section 2. Its anchor is left stale, so
        # the census records it retired.
        "M12 · ⛔ what the line opened on is never recorded · a later withdrawal takes back the one "
        f"line that sets right a stop the giver READ · killed by `{KILLER}` §2.5",
        [(HOST, "      if (went.outcome === 'queued') giver.correctionsHeld.set(went.messageId, 'that-it-stopped')\n", "")],
    ),
    (
        # ⚠️ **EQUIVALENT MUTANT on the tree, recorded rather than removed (landing D-016b part
        # 2):** The only difference this plant makes is for a WAIT correction that a giver's flush
        # hands over (or has on the wire) between the moment the question ends, when heldAsItEnded
        # is snapshotted, and the moment the giver's telling chain reaches the step. That is a race
        # with no seam in the shared harness: the snapshot is taken synchronously, and a held
        # correction (the 711:M9 case) is found by theWaitsThatSetRightAStop inside the chain either
        # way, so the M9/M11 test cannot tell the plant from the original. Pinning it would need the
        # giver's flush ordered against its own telling chain, which no ProviderDouble or gate lever
        # does, and a test that wins the race only sometimes is worse than none. No test can kill
        # it, so it stays unrun.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects remembering the correction that is on the wire as the question ends, so
        # it is not lost when the chain runs after the handover. The correction and its flush
        # bookkeeping (correctionsHandedOver) were removed with "every set-right, correction and
        # wake take-back", and the anchor is absent from runtime-host.ts. Section 2 of the killer,
        # which held this case, was retired by D-017. Its anchor is left stale, so the census
        # records it retired.
        "M13 · ⛔ the correction on the wire as the question ends is not remembered · when the chain "
        "runs after the handover it is read, and nothing follows it · killed by "
        f"`{KILLER}` §2.6",
        # ⚠️ **RE-ANCHORED in `711`'s own review.** The snapshot became every such correction held as
        # the question ends, by id (R48's shape), so it follows one read before the chain reached
        # the step too; the mutant empties it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # Rule survives: the replacement snapshots heldAsItEnded (theWaitsThatSetRightAStop(giver,
        # piece.piece)) so a correction already on the wire or read is followed rather than
        # retracted. Plant: heldAsItEnded is an empty list, so no held WAIT correction is retracted
        # or tracked. No existing test builds a giver with a held correction at the moment its
        # question ends (section 2 of a-notice-that-cannot-be-true-is-replaced.test.ts retired by
        # D-017 R4). MISSING TEST: same premise as 711:M9; assert that a correction on the wire or
        # read (correctionsHandedOver) as the question ends is still followed by exactly one true
        # line; paired positive: a correction not yet on the wire is retracted and replaced. ⚠️ No
        # test kills it yet: the landing owes one (D-016b part 2).
        [
            (HOST, '    const heldAsItEnded = this.theWaitsThatSetRightAStop(giver, piece.piece).map((one) => one.id)\n', '    const heldAsItEnded: string[] = []\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects not taking back the correction a flush is handing over from under it, so
        # the ledger never says `retracted` about words the provider has. With no corrections left
        # ("every set-right, correction and wake take-back" are gone), the only handover exclusion
        # left is the single-notice `handingOver` guard in theNoticesItWillStillRead, which section
        # 1.12 of the 703 killer and section 1.4 of the 711 killer cover. Section 2.4 no longer
        # exists. Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ the correction a flush is handing over is taken back from under it · the ledger says "
        f"*retracted* about words the provider has · killed by `{KILLER}` §2.4",
        [(HOST, "        if (wait === onTheWire) continue\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects the sentence of correctedOnceItsQuestionEnded, 'It is no longer waiting
        # on an answer: ...', in reply-rails.ts. The commit deleted that function together with
        # correctedWorkText and the 'its-question-ended' cause ("every set-right, correction and
        # wake take-back"), so the anchor now has zero matches. Its named killer,
        # what-the-tree-landing-left-unpinned.test.ts, still imports both deleted names. Its anchor
        # is left stale, so the census records it retired.
        "M15 · ⛔ the line keeps *\"It is waiting\"*'s claim · the giver is told the conversation still "
        f"waits on the answer it gave · killed by `{KILLER}` §2.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # Rule survives: correctedOnceItsQuestionEnded in reply-rails.ts words the replacement line
        # as 'It is no longer waiting on an answer: read its record with list_tasks, naming
        # <label>'. Plant: the sentence says 'It is waiting on an answer', the very falsehood it
        # exists to replace. No existing test asserts the sentence (grep for 'no longer waiting on
        # an answer' finds no test hit after section 2 was retired). MISSING TEST: same premise as
        # 711:M9; assert the replacement line contains 'no longer waiting on an answer' and does not
        # contain 'It is waiting'. Paired positive: the original correction still says 'It is
        # waiting'. ⚠️ No test kills it yet: the landing owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — The replacement line's whole
        # point is its sentence 'It is no longer waiting on an answer', and no test asserts it since
        # section 2 was retired by R4. correctedOnceItsQuestionEnded is a pure exported function of
        # (piece, holder), so it needs no host and no rig, and the plant (which flips the sentence
        # to the very falsehood it replaces) is killed by a string assertion. Pair it with
        # correctedWorkText for the original correction to show the two share the opener and differ
        # only in the claim. Killed by `what-the-tree-landing-left-unpinned.test.ts`.
        [
            (REPLY, ' It is no longer waiting on an answer: read its record with list_tasks, naming ${piece.label}.`', ' It is waiting on an answer: read its record with list_tasks, naming ${piece.label}.`'),
        ],
    ),
    # ── §C · R54 — the band's mark ────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects R54's band mark reading the right receipt to tell a giver told 'started
        # again' from one told 'still open'. The commit says "Gone with it: the kept-open receipt
        # and notices ... the two R54 leads on the stalled-work band", and toldItStartedAgain /
        # toldItWasStillOpen no longer exist in src. Section 3 of the killer was retired by D-016c.
        # Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 R54's mark reads the wrong receipt · the band cannot tell a giver told *started "
        f"again* from one told *still open* · killed by `{KILLER}` §3.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R54's mark
        # survives in stalledWorkForAPerson: `toldItStartedAgain:
        # lastToldBy(piece.giver).get(piece.piece) === 'set-right'` (task.assignedBy became
        # piece.giver, task.taskId became piece.piece). Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, "            toldItStartedAgain: lastToldBy(piece.giver).get(piece.piece) === 'set-right',\n", "            toldItStartedAgain: lastToldBy(piece.giver).get(piece.piece) === 'kept-open',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects every band row not being marked 'told it started again' when its giver
        # was told nothing. The mark was removed ("the two R54 leads on the stalled-work band"), and
        # stalledWorkLead now returns one line that is true of every row, so there is no per-row
        # mark left to over-apply. Section 3.2 of the killer went with section 3. Its anchor is left
        # stale, so the census records it retired.
        "M17 · ⛔ every row is marked *told it started again* · a giver told nothing is said to have "
        f"been told · killed by `{KILLER}` §3.2",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Same anchor as
        # M16 (R54's mark on the band row), under piece names; the plant marks every giver that is
        # not 'kept-open', including one told nothing. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, "            toldItStartedAgain: lastToldBy(piece.giver).get(piece.piece) === 'set-right',\n", "            toldItStartedAgain: lastToldBy(piece.giver).get(piece.piece) !== 'kept-open',\n"),
        ],
    ),
    # ── §D · `701` F-1 — the kept-open fact on every list ───────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `keptOpenAcrossAQuit` is removed from
        # every list row and from the wire, so there is no field to plant `false` or `true` on. The
        # killer now asserts the opposite: `a-notice-that-cannot-be-true-is-replaced.test.ts` has
        # `expect(parent).not.toHaveProperty('keptOpenAcrossAQuit')`. The commit message says "One
        # Conversations list ... no open / closed / kept-open split". Its anchor is left stale, so
        # the census records it retired.
        "M18 · 🔴 the project's list carries `false` for an open conversation · the frontend's reader "
        f"would draw the room and the Team page *Ended* over it · killed by `{KILLER}` §4.1",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The private helper this
        # row plants on was renamed: `RuntimeHost.keptOpen(x) !== null` is now
        # `this.aQuitLeftItOpen(x)`, which returns the boolean directly, so the old text no longer
        # matches. `ProjectConversation.keptOpenAcrossAQuit` is still built from exactly that
        # boolean at the same call site in `conversationsInProject`, so the same `false` plant
        # recreates M18's defect.
        [
            (HOST, '        // {@link ProjectConversation.keptOpenAcrossAQuit}.\n        keptOpenAcrossAQuit: this.aQuitLeftItOpen(row.conversation),\n', '        // {@link ProjectConversation.keptOpenAcrossAQuit}.\n        keptOpenAcrossAQuit: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `keptOpenAcrossAQuit` field is
        # gone from every list (`grep` finds it only in comments and negative assertions), so a
        # plant of it in `runtime-host.ts` has nothing to land on. The killer's section 4.1/4.2 was
        # re-aimed to assert the field is absent. The commit message says "no open / closed /
        # kept-open split". Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 a child edge carries `false` for an open child · who-called-whom's reader would draw "
        f"it *Ended* · killed by `{KILLER}` §4.1",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same rename as M18
        # (`keptOpen(...) !== null` → `aQuitLeftItOpen(...)`); the `SpawnEdge.keptOpenAcrossAQuit`
        # field on each child edge in `conversationsInProject`'s `children.rows` map still reads
        # that boolean at an unchanged comment/site, so planting `false` there is the same defect
        # M19 protected.
        [
            (HOST, '          // 🔴 **711 · `701` F-1** — see {@link SpawnEdge.keptOpenAcrossAQuit}.\n          keptOpenAcrossAQuit: this.aQuitLeftItOpen(row.conversation),\n', '          // 🔴 **711 · `701` F-1** — see {@link SpawnEdge.keptOpenAcrossAQuit}.\n          keptOpenAcrossAQuit: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `keptOpenAcrossAQuit` field is
        # gone from every list (`grep` finds it only in comments and negative assertions), so a
        # plant of it in `runtime-host.ts` has nothing to land on. The killer's section 4.1/4.2 was
        # re-aimed to assert the field is absent. The commit message says "no open / closed /
        # kept-open split". Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 a forest node carries `false` for an open conversation · the Team forest's reader "
        f"would draw it *Ended* · killed by `{KILLER}` §4.1",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same rename again; the
        # forest node in `theWholeForest()`'s `rows` map still carries `keptOpenAcrossAQuit:
        # this.aQuitLeftItOpen(row.conversation)` at the same 16-space-indented site, so the `false`
        # plant is unchanged in effect.
        [
            (HOST, '                keptOpenAcrossAQuit: this.aQuitLeftItOpen(row.conversation),\n', '                keptOpenAcrossAQuit: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `keptOpenAcrossAQuit` field is
        # gone from every list (`grep` finds it only in comments and negative assertions), so a
        # plant of it in `runtime-host.ts` has nothing to land on. The killer's section 4.1/4.2 was
        # re-aimed to assert the field is absent. The commit message says "no open / closed /
        # kept-open split". Its anchor is left stale, so the census records it retired.
        "M21 · ⛔ the parent end of an edge carries `false` for an open parent · a child's own view "
        f"would read it ended · killed by `{KILLER}` §4.1",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The single-conversation
        # `spawnEdge()` method (parent end of an edge) still computes `keptOpenAcrossAQuit:
        # this.aQuitLeftItOpen(conversation)` at the same comment/site, just with the renamed
        # helper; the `false` plant is the same defect.
        [
            (HOST, '      keptOpenAcrossAQuit: this.aQuitLeftItOpen(conversation),\n', '      keptOpenAcrossAQuit: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `keptOpenAcrossAQuit` field is
        # gone from every list (`grep` finds it only in comments and negative assertions), so a
        # plant of it in `runtime-host.ts` has nothing to land on. The killer's section 4.1/4.2 was
        # re-aimed to assert the field is absent. The commit message says "no open / closed /
        # kept-open split". Its anchor is left stale, so the census records it retired.
        "M22 · ⛔ every conversation in a project carries `true` · a closed or started one would be "
        f"drawn open · killed by `{KILLER}` §4.2",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same site as M18
        # (`conversationsInProject`'s `ProjectConversation.keptOpenAcrossAQuit`), just planting
        # `true` for every row instead of `false`; the helper rename does not touch the rule the row
        # protects (a closed/started conversation must not be drawn open).
        [
            (HOST, '        // {@link ProjectConversation.keptOpenAcrossAQuit}.\n        keptOpenAcrossAQuit: this.aQuitLeftItOpen(row.conversation),\n', '        // {@link ProjectConversation.keptOpenAcrossAQuit}.\n        keptOpenAcrossAQuit: true,\n'),
        ],
    ),
    # ── §E · `703` F-B2 — the whole act inside the cut ───────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject is gone. The anchor was
        # `OPEN_WORK_OUTLASTS_IT`, the sentence for `a-message-you-cannot-withdraw-is-waiting` when
        # the next rail would refuse a WORK call. D-010 deleted both the constant and the rail on
        # purpose. Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M23 · 🔴 F-B2 undone · the open-work sentence's act ends past the 200 a person's row shows, "
        f"so Codex's row drops `withdraw_task` · killed by `{CUT}`",
        [(TOOLS, "  'nothing was sent: make the same call again once the work open there is finished (withdraw_task finishes yours) — that agent holds a message you cannot withdraw.'\n", "  'that agent holds a message you cannot withdraw, and work is open there, so nothing was sent: make the same call again once the work open there is finished (withdraw_task finishes yours).'\n")],
    ),
    # ── §F · found by `711`'s own review ──────────────────────────────────────────────────────────
    (
        "M24 · ⛔ a push held only after the answer is not found · it was composed before the answer "
        "and queued behind the flush, and *\"It has not been answered\"* stands · killed by "
        f"`{KILLER}` §1.5",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'push held
        # only after the answer landed' arm survives in the same guard as M3: `!heldAsItWasAnswered
        # && !this.piecesWithANoticeHeldFor(giver.id).has(piece.piece)`. The plant drops the second
        # half, so a push composed after the answer is not found. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, '        if (!heldAsItWasAnswered && !this.piecesWithANoticeHeldFor(giver.id).has(piece.piece))\n          return\n', '        if (!heldAsItWasAnswered) return\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects a correction being followed at most once, so that an answer and then a
        # Stop in one handover queue neither two lines nor two receipts. The commit removed
        # corrections and their receipts ("The only receipt written is pushed"), and the stop half
        # of the case is gone: "A stop, a reopen and a start tell nobody anything". Section 2.7 was
        # retired with section 2. Its anchor is left stale, so the census records it retired.
        "M25 · ⛔ a correction is followed more than once · an answer and then a Stop in one handover "
        f"queue two lines and two receipts · killed by `{KILLER}` §2.7",
        [(HOST, "      for (const id of [...readSince, ...followed]) giver.correctionsHeld.delete(id)\n", "")],
    ),
    (
        # ⚠️ **EQUIVALENT MUTANT on the tree, recorded rather than removed (landing D-016b part
        # 2):** The plant changes toldItStartedAgain from '=== set-right' to '!== undefined', which
        # differs only for a row the band admits whose last receipt is 'kept-open'.
        # stalledWorkNobodyWasToldAbout admits a kept-open row only when its holder can no longer be
        # started, and no product path makes a startable holder unstartable after the giver was
        # told: D-017 R2 keeps a closed holder startable, the adopted and restored flags are written
        # only at INSERT, and a bundle import over an existing id fails on the primary key. For
        # every other admitted receipt (set-right, pushed, its-own-wake and the rest) the two
        # predicates give identical output, so the mutant is equivalent on every reachable state. No
        # test can kill it, so it stays unrun.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects a giver told 'still open' not also being marked 'told it started again',
        # so one band row never carries two accounts. Both marks, and the kept-open receipt behind
        # the first, were removed ("the kept-open receipt and notices" and "the two R54 leads on the
        # stalled-work band"). Section 3.4 was retired by D-016c. Its anchor is left stale, so the
        # census records it retired.
        "M26 · ⛔ a giver told *still open* is marked *told it started again* too · one band row "
        f"carries two accounts · killed by `{KILLER}` §3.4",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # Rule survives: the band row's toldItStartedAgain is true only when the giver's last
        # receipt is 'set-right' (toldItWasStillOpen is the 'kept-open' receipt). Plant:
        # toldItStartedAgain becomes lastToldBy(...).get(piece.piece) !== undefined, so a giver told
        # kept-open (or anything else) also reads as told it started again. No host-level test
        # builds a band row for a giver told 'kept-open' whose holder is still open:
        # a-restart-keeps-what-was-open.test.ts:1682,
        # a-notice-that-cannot-be-true-is-replaced.test.ts:720 and :769,
        # a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts:793 and
        # work-that-stalls-with-nobody-to-tell.test.ts:447 assert toldItWasStillOpen false only for
        # givers told nothing or in other shapes; section 3.2 covers told-nothing, section 3.4 a
        # kept-open giver whose holder was closed (not listed), section 3.5 a set-right giver (the
        # plant leaves it true). M16 and M17 use the same old string with other plants and are not
        # duplicated. MISSING TEST: a giver whose last receipt is 'kept-open' with its holder still
        # open is listed; assert {toldItWasStillOpen: true, toldItStartedAgain: false}. Paired
        # positive: a giver told 'set-right' gives {toldItWasStillOpen: false, toldItStartedAgain:
        # true}. ⚠️ No test kills it yet: the landing owes one (D-016b part 2).
        [
            (HOST, "            toldItStartedAgain: lastToldBy(piece.giver).get(piece.piece) === 'set-right',\n", '            toldItStartedAgain: lastToldBy(piece.giver).get(piece.piece) !== undefined,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The row's own killer test file says so
        # in its own header: "⛔ D-017 · R4 retired those cases (§2.1, §2.3–§2.7): a Close no longer
        # ends an asking worker's question, so its parent is told nothing and a Reopen sets nothing
        # right." §2.3 (the row's cited section) is gone from
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`; only §2.2 (a different scenario, the
        # waker's own correction) survives under §2. The premise the row protected — a PERSON's
        # Reopen exposing a stale 'nobody has answered' correction after a Close ended the child's
        # question — cannot occur any more, since a Close is now a stop, not an ending. Its anchor
        # is left stale, so the census records it retired.
        "M27 · 🔴 a PERSON's answer to the child's question ends nothing a held correction said · "
        "*\"It is waiting: …nobody has answered\"* stands (`703`'s table called this arm unrigged) · "
        f"killed by `{KILLER}` §2.3",
        [(HOST, "      // ⚑ **703** — see {@link takeBackWhatAnAnswerMadeFalse}; a refusal ends the question too.\n      this.takeBackWhatAnAnswerMadeFalse(session)\n", "      // ⚑ **703** — see {@link takeBackWhatAnAnswerMadeFalse}; a refusal ends the question too.\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects recording a correction the flush hands over as READ, so that R49's step
        # following it does not run for words the provider already has. The correction, R49's step
        # and the flush record (correctionsHandedOver) were all removed with "every set-right,
        # correction and wake take-back". Section 2.6 was retired with section 2. Its anchor is left
        # stale, so the census records it retired.
        "M28 · ⛔ a correction the flush hands over is not recorded as READ · when R49's step runs "
        f"after the handover, nothing follows it · killed by `{KILLER}` §2.6",
        [(HOST, "    if (session.correctionsHeld.has(queued.id)) session.correctionsHandedOver.add(queued.id)\n", "")],
    ),
]
