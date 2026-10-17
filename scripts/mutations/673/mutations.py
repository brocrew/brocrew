"""673 · What a wake still says wrong.

⚑ **`663`'s F1, F6 and F8, repaired — and F5's double folded into one.** A woken or reopened
conversation left a parent reading the ending's cause beside a running holder on Claude (F1); a
parent that woke its child itself was then told, as news, that the child had not ended (F8); and
Codex turned an expired sign-in at a resume into *"could not be resumed"* (F6).

## 🔴 A · what the dispatch CHANGED

 1. **F1 · the host says the reopen, as a row** — `reopenSession` publishes `{type: 'reopened'}`
    right after the column write: the FIRST row of the new life, so it sits at the seam `653`
    crosses, and before `tellWhoeverGaveTheWork`, which reads the tasks it restores (M4).
    `selectTaskEvents` reads it, and `deriveTasks` fires `648`'s ONE unwind on it as on a
    non-terminal `status`: whichever arrives first spends the snapshot. ⚑ Measured on Claude's
    shape (red before) with the Fake's as the control (green before). ⚑ And the reopen announces
    `work` when the conversation holds OPEN work, announcing anyway if that read fails (`638`'s
    rule; this dispatch's review — M16–M18).
 2. **F8 · a parent that woke the holder ITSELF, about an ending it had already been handed, is not
    set right** — `wakeSession` marks `wokenBy[woken] = { by, handedWhenAsked }` (since `698` built by
    `markTheWaker`, with `heldWhenAsked` beside it) for exactly the
    length of its `resumeSession` (set only by the call that found it empty, cleared only by that
    call); `handedWhenAsked` is `endingsHandedTo(waker)` at that moment — told *"has ended"*, and no
    notice about it still held (a queued notice carries its task as `authorship.work`).
    `setRightANoticeAReopenMadeFalse` then writes a `work_reported` receipt `how: 'its-own-wake'`
    instead of the correction, and `workReportedTo` reads it as `'set-right'`, so the NEXT ending
    re-arms, in this run and after a restart. ⛔ **Everything else stays a correction** (this
    dispatch's review, three rounds): a WAIT (M13); an ending held when it asked, not yet written
    because the child was on its way out, or handed over while the wake ran (M14, M15, M20); and
    another giver's work on a holder that takes work from many callers (its task is never in the
    waker's set). 🔴 **`690` (R32) moved the first two**: an ending the waker has still NOT read at
    the reopen is taken back (`retracted`) and answered `its-own-wake`, so only one handed over
    while the wake ran stays a correction — and that is the world M14 and M15 are killed in now
    (§2.9). ⚑ **Its own ending, then its own wake, re-arms too** (M19): a parent whose last
    word was `its-own-ending` (`null`) is written the same receipt.
 3. **F6 · Codex's resume** rethrows `AuthUnavailableError` untouched, and every other failure
    inside its handshake is a `ResumeError` carrying what it wrapped as `cause` — Claude's shape.

## ⛔ B · what has NO row, said rather than left out

⚠️ **Types only — `tsc` is their gate, not a test**: `ReopenedEvent` and its two union members
(`publishOurs`, `recordOurs`), and `WorkSetRightEvent.how` widened by `its-own-wake`.

⚠️ **The renderer's three lines for the new row** — `describe-event.ts`'s two labels (a raw-stream
caption a person reads; no assertion reads it), `transcript.ts`'s `case 'reopened': return` (an
exhaustive switch: removing the case fails `tsc`, and `transcript.test.ts`'s `adds: 0` row pins
that it draws nothing), and `EventStream.vue`'s class.

⚠️ **`mark?.by === parent.id` cannot be made to fail today, measured** — a row replacing it with
`mark !== undefined` SURVIVED `§2.10`. On the correction path the waker's `handedWhenAsked` holds
only work the waker gave, so another giver's task is never its wake either way; on the own-ending
path only the conversation that ended its child reads `null`, and only its commander — the one
conversation that may wake it — can end it. Kept, with this beside it: the rule is *the parent
that woke it*, and a second way in would make it load-bearing with nothing going red.

⚠️ **The second ask of what is held, inside the chain** (`!this.tasksWithANoticeHeldFor(parent.id)
.has(...)`) has no row. 🔴 **Since `690` (R32) it decides only while a flush is in flight**: a
notice still held when the chain step runs — told-not-yet-queued at the ask included — is taken
back before this ask is reached, and a flush in flight is the one moment nothing is taken back. No
test reaches that window.

⚠️ **The `catch` around the reopen's work read** has no row: nothing in a test makes the store's
read throw. It announces anyway, which over-announcing's contract makes free.

⚠️ **The order of the `reopened` row against `bringBackTheQuestionsItWasAsking`** decides nothing:
that call reads no task. Only `tellWhoeverGaveTheWork` reads what the row restores (M4).

⚠️ **F5 is test code** — `claudeOnAResume` and `closingOnlyWhenReleased` in
`test/lib/provider-double.ts`, adopted by `653`'s and `663`'s files and by the gate. ⚑ It changed
which rows other tables' killers see, and that is where it was measured: every row of `653`, `661`
and `663`, re-verified. ⚠️ **`653 M8` and `M9` were re-aimed by this dispatch**: once the host's
`reopened` sat at the seam, the renderer's end-of-page crossing and its `>=` could each be removed
alone with nothing going red, so each row now takes the replay's epoch one row on, past it, in the
renderer — never by dropping the host's row, which `M1` here drops and this file's fold tests kill
whatever `653`'s drawing tests see. And `661 M21` now nulls only the `set-right` arm; `M10` here is
the `its-own-wake` arm.

⚠️ **Rows keep the text a census counts** (this dispatch's review): the runner runs whole projects,
so a row that deleted a line `a-task-you-can-see`'s roster, `664`'s host census or `638`'s count
reads would be killed by that census whatever its own killer saw. M2 and M16–M18 are written so.

## 🔴 C · the killers

`apps/desktop/test/what-a-wake-still-says-wrong.test.ts` for M1–M10, M13–M15 and M19–M20: §1 (F1 on
both shapes) for the row, its reader and its fold; §2 (F8 on both shapes) for the mark, its
lifetime, the race guard (§2.5), the receipt, what a restart reads back (§2.3), the WAIT arm
(§2.6), the held ending (§2.7, control §2.8 — retracted since `690`), the ending handed while the wake ran
(§2.9, M14's and M15's killer since `690`), its own
ending then its own wake (§2.11) and an ending written during the wake (§2.12). ⚠️ M4 is killed on
CLAUDE's shape only (§2.1, §2.2 there): on the Fake a later provider `status` asks again.
`packages/runtime/test/codex-runtime.test.ts` for M11–M12.
`apps/desktop/test/work-moved-and-nothing-announced-it.test.ts` for M16–M18 (§2's reopen trio).
⚑ Each row was verified RED alone against its own killer (`scripts/mutations/verify_row.py`),
anchor count `== 1`, restored from saved bytes.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"

# ⚑ **ANCHOR CORRECTED IN PLACE BY T-002**: D-004 gave the row a `because` (a reopen this app made
# by itself on a renewed sign-in). It is the same publish at the same place: M1 still drops it and
# M4 still moves it, whole, after the reopen's reads. Both re-verified RED alone.
# ⚑ **W4.78 · re-anchored in place, not retired** — the reopen's reason is now `why` (e0e93e6e kept it on
# the host so whichever start answers says it); the same publish, so M1 still drops it.
# ⚑ **F098 · re-anchored in place, not retired, by hand** — the row is built by spreads now, so it
# can also carry the sentence a start that brought it back from the archive writes; the same publish
# at the same place, so M1 still drops it. Shared with M4, which stays retired (its tell is gone).
THE_ROW = (
    "    this.publishOurs(session, {\n"
    "      type: 'reopened',\n"
    "      ...(why === undefined ? {} : { because: why }),\n"
    "      ...(broughtBack === undefined ? {} : { broughtBack }),\n"
    "    })\n"
)
# ⚠️ **RE-ANCHORED at `702`, not retired**: the push takes the holder's id. M4 still moves the row
# after the reopen's reads.
# ⚑ **T-002 · re-anchored in place, not retired**: D-005a asks the same line in
# `askOnceTheQueueLeftItUndriven`, so the anchor carries the reopen's comment line above it. M4
# still puts the row right after the reopen's tell. Re-verified RED alone.
THE_TELL = (
    "    // nobody told. ⚑ The Fake publishes `idle` on construction, which is why no test saw it.\n"
    "    this.tellWhoeverGaveTheWork(session.id)\n"
)
THE_WAKER = "    const itsOwnWake = 'stalledBecause' in standsOn && mark?.by === parent.id\n"
# ⚑ **RE-ANCHORED at `698`, not retired**: the mark is built by one method both doors call
# (`markTheWaker`), so the wake's line names it. The row still takes the mark away.
THE_MARK = "      this.wokenBy.set(sessionId, this.markTheWaker(me))\n"
THE_READ = (
    "      itHoldsWork = this.deps.store.tasksOf(sessionId).some((task) => TASK_IS_OPEN[task.state])\n"
)

MUTATIONS = [
    # ── F1 · the host's own reopen, as a row the fold reads ─────────────────────────────────────
    (
        "M1 · 🔴 the host says nothing at the reopen · on Claude, whose reopened provider writes "
        "nothing until its first turn, a parent reads `conversation_ended` beside a running holder "
        "until then — `663` F1 exactly · killed by `the-message-that-has-no-name.test.ts` (named by W4.78)",
        # ⚑ **a turn that carries on after a repaired sign-in · re-anchored in place, not retired** —
        # the reopened row carries one more field, that it was on a replaced copy of a sign-in; the
        # row's defect is unchanged. Its own literal: `THE_ROW` is also read by the retired M4.
        [
            (
                HOST,
                "    this.publishOurs(session, {\n"
                "      type: 'reopened',\n"
                "      ...(why === undefined ? {} : { because: why }),\n"
                "      ...(onAReplacedCopy && why === 'the-sign-in-was-renewed' ? { itsCopyWasReplaced: true } : {}),\n"
                "      ...(broughtBack === undefined ? {} : { broughtBack }),\n"
                "    })\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the fold's `reopened` arm unwinding the ending's `conversation_ended`
        # cause. The commit removed both the cause and the unwind: "There is no conversation_ended
        # stall cause" and "Gone with it: ... the unwind of an ending". In tasks.ts the `reopened`
        # arm now only resets `aTurnIsOpen` and `driving`. A piece stalls on its turn's own cause
        # and a reopen does not touch it. Its anchor is left stale, so the census records it
        # retired.
        "M2 · 🔴 the fold ignores the host's row · `reopened` is read and never unwinds, so the "
        "ending's cause stands on Claude until a provider `status` — a row that may never come",
        [
            (
                TASKS,
                "    if ((event.type === 'status' || event.type === 'reopened') && stalledBeforeTheEnding.size > 0) {",
                # ⛔ The literal stays in the source (`673`'s review): `a-task-you-can-see`'s census
                # reads every `event.type === '…'` in this file, and a row that deleted it would be
                # killed by that roster whatever the fold did.
                "    if ((event.type === 'status' || (false && event.type === 'reopened')) && stalledBeforeTheEnding.size > 0) {",
            )
        ],
    ),
    (
        "M3 · ⛔ the store never hands the fold the row · `selectTaskEvents` leaves `reopened` out, "
        "so the unwind's trigger is written and never read",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the store must hand the fold the `reopened` row, because the unwind's trigger is
        # written and only read in `derivePieces` (`shared/tasks.ts` lines 2701 and 2750).
        # `selectTaskEvents` is now `selectPieceEvents`, and `'reopened'` is in its type list on the
        # `user_decision` line. Leaving it out means the fold never sees it. Killed by
        # `what-a-wake-still-says-wrong.test.ts`,
        # `what-a-close-does-that-a-reopen-never-undoes.test.ts`,
        # `a-woken-conversation-drawn-as-ended.test.ts`.
        [
            (STORE, "'user_decision', 'reopened', 'reply_undelivered', 'message_queued',", "'user_decision', 'reply_undelivered', 'message_queued',"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the ordering of the `reopened` row against the reopen's own reads. Those
        # reads asked the parent about work the fold still called `conversation_ended`. Ruling (c)
        # removed them: "A stop, a reopen and a start tell nobody anything". The reopen publishes
        # `reopened` and asks nobody, so there is no read that ordering could put before the row.
        # Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ the row lands AFTER the reopen's own reads · the parent is asked about work the fold "
        "still calls `conversation_ended`, so on Claude a parent told *\"has ended\"* by a person's "
        "Reopen is set right only at the child's first turn",
        [
            (HOST, THE_ROW, ""),
            (HOST, THE_TELL, THE_TELL + THE_ROW),
        ],
    ),
    # ── F8 · the waker, and how long it is the waker ──────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row's subject is the waker mark keyed by the woken conversation, so that a parent's
        # own wake is not corrected. The mark (`wokenBy`, `markTheWaker`, `WakerMark`) went with the
        # corrections it filtered, per "every set-right, correction and wake take-back" in the
        # commit message. The pre-commit lookup no longer exists. Its anchor is left stale, so the
        # census records it retired.
        "M5 · 🔴 the waker is looked up by the wrong id · the mark is keyed by the conversation WOKEN, "
        "so asking by the parent's id never matches and the waker is told *\"has not ended after "
        "all\"* (since `698`: *\"that conversation was started again\"*) about its own wake — `663` "
        "F8 exactly",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the waker mark is keyed by the conversation WOKEN, so the lookup must use the
        # piece's owner. Today it is `this.wokenBy.get(piece.owner)` in
        # `setRightANoticeAReopenMadeFalse` (`task.assignedTo` became `piece.owner`). Asking by the
        # parent's id never matches, so the waker is told *that conversation was started again*
        # about its own wake. Killed by `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, 'const mark = this.wokenBy.get(piece.owner)\n', 'const mark = this.wokenBy.get(parent.id)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row's subject is that a wake marks its waker so the waker's own correction is skipped.
        # The commit removed the waker mark and the corrections together: "Gone with it: ... every
        # set-right, correction and wake take-back". D-017's `startForADelivery` no longer marks
        # anyone, since a start tells nobody anything. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⛔ the wake never marks its waker · every correction goes out, the waker's included",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The `wokenBy`
        # waker-marking mechanism is fully alive, just reshaped: D-017's message-triggered start
        # (`startForADelivery`) now does the marking that `resumeSession`'s old wake path did, using
        # `waker`/`unmarked` in place of `me`/`marks`. `what-a-wake-still-says-wrong.test.ts` was
        # explicitly updated for commit 3 (its own comments say 'Until commit 3 this was two
        # resume_agent calls') to test the identical race and marking rules through the new message
        # path.
        [
            (HOST, 'if (waker !== null && unmarked) this.wokenBy.set(sessionId, this.markTheWaker(waker))\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the waker mark outliving its wake, so that a later Reopen is taken for
        # the parent's own wake. The mark is gone (`wokenBy`, `markTheWaker`, `endingsHandedTo`),
        # and with no correction there is nothing the mark could suppress. It went with "every
        # set-right, correction and wake take-back". Its anchor is left stale, so the census records
        # it retired.
        "M7 · 🔴 the mark outlives its wake · a later PERSON's Reopen of the same conversation is "
        "taken for the parent's own wake, and the parent keeps believing *\"has ended\"*",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same reshaped `wokenBy`
        # mechanism as M6: the mark's removal moved from `wakeSession`'s `finally { if (marks)
        # this.wokenBy.delete(sessionId) }` into `startForADelivery`'s `finally { if (unmarked)
        # this.wokenBy.delete(sessionId) ... }`. Dropping the delete leaves the mark outliving its
        # wake, exactly the defect the row names, now provoked through a person's Reopen after the
        # parent's own message-start.
        [
            (HOST, 'if (unmarked) this.wokenBy.delete(sessionId)\n', ''),
        ],
    ),
    (
        "M8 · ⛔ a second wake racing the first erases the first one's mark · two `resume_agent` "
        "calls in one turn: the refused one clears on its way out, and the waker is told about its "
        "own wake after all",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same reshaped mechanism:
        # `const marks = !this.wokenBy.has(sessionId)` became `const unmarked = waker !== null &&
        # !this.wokenBy.has(sessionId)`. Forcing it to `waker !== null` (always true when a waker is
        # present) drops the 'already marked' guard, so a second concurrent start racing the first
        # erases the first one's mark — the exact race `what-a-wake-still-says-wrong.test.ts` §2.5
        # was written to pin for commit-3's 'two starts of one conversation at once' shape.
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** the row's race is two `resume_agent`
        # calls in one turn, and 5206d835 says *end_agent and resume_agent are gone*; the
        # message-driven start that took its place is serialised per conversation, so no successor
        # race exists. The re-anchor above is undone and the pre-landing anchor restored, so the
        # census records it retired.
        [
            (HOST, '    const marks = !this.wokenBy.has(sessionId)\n', '    const marks = true\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row plants `how: 'set-right'` in place of `how: 'its-own-wake'` on a receipt. The
        # commit removed that receipt kind: "The only receipt written is pushed". The anchor text
        # `how: 'its-own-wake' })` no longer exists, and what-a-wake-still-says-wrong.test.ts says
        # its F8 section (the its-own-wake receipt) is gone with its subject. Its anchor is left
        # stale, so the census records it retired.
        "M9 · ⛔ the receipt says a correction was sent · `set-right` where nothing was, so the "
        "ledger claims the parent was told a sentence it never received",
        [(HOST, "how: 'its-own-wake' })", "how: 'set-right' })")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the `its-own-wake` receipt re-arming after a restart, read back from the
        # store so the next ending is told. The receipt is no longer written ("The only receipt
        # written is pushed, and a receipt stands unless its message was abandoned"), and the giver
        # is told once, at the stall. There is no wake receipt to read back. Its anchor is left
        # stale, so the census records it retired.
        "M10 · 🔴 its own wake does not re-arm after a restart · the receipt reads back as nothing "
        "owed, so the NEXT ending is never told — the parent keeps the wake as its last word about a "
        "conversation that has ended again",
                # ⚑ **719 · replacement re-aimed in place, anchor unchanged**: R69 put a third member
                # (`its-own-question`) on this arm, and `=== 'set-right' ? … : null` nulled it too — so
                # a table run would have been killed by `719`'s tests whatever this row's saw.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a parent's own wake is its correction, and after a restart its receipt must
        # still re-arm so the next ending is told. Today the rule is `set-right` in `lastToldIn`,
        # and `aNoticeIsOwed` re-arms only on `set-right` over `conversation_ended`; `null` no
        # longer exists in `LastToldAboutWork`. The plant reads an `its-own-wake` receipt back as
        # `conversation_ended`, which is a cause and so nothing is owed. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired —
        # lastToldIn still folds a wake by this conversation into 'set-right'; D-016c added
        # `its-own-brief` to the same else-branch and rewrapped its comment, so the old comment line
        # no longer matches. The new anchor is the last comment line plus `'set-right',` (count 1)
        # and the plant still reads `its-own-wake` as `conversation_ended`, so the next ending is
        # never re-armed. Killed by `what-a-wake-still-says-wrong.test.ts`.
        [
            (STORE, "            // exactly as from a correction that was sent.\n            'set-right',\n", "            // exactly as from a correction that was sent.\n            event.how === 'its-own-wake' ? 'conversation_ended' : 'set-right',\n"),
        ],
    ),
    # ── F6 · what Codex's resume says when it fails ───────────────────────────────────────────
    (
        "M11 · 🔴 an expired sign-in at a Codex resume is a lost conversation again · wrapped in a "
        "`ResumeError`, it reaches *\"could not be resumed\"* instead of the sign-in word — `663` F6",
        [(CODEX, "      if (error instanceof AuthUnavailableError) throw error\n", "")],
    ),
    (
        "M12 · ⛔ a Codex resume failure drops what it wrapped · the `ResumeError` carries no `cause`, "
        "so the error the transport or the provider actually raised is gone past the adapter — the "
        "contract both adapters now keep (`runtime.ts`). ⚠️ The wake reads the cause chain's errno "
        "(`705` R39, `transientSetupFailureOf`), and since `706` the host's let-go reads "
        "`noSuchSession`, not `cause`; this pins the adapter's promise, not a sentence",
        # ⚠️ **RE-ANCHORED at 706, not retired.** `706` gave the same `throw` a second option —
        # `noSuchSession`, the thread the app-server says it no longer has — so the call spans four
        # lines and `cause` is one of them. ⚑ The DEFECT is unchanged: the wrapped error is dropped.
        # Re-verified RED alone with `verify_row.py`.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-039 (17a9220d) reshaped the end of CodexRuntime.resume: noSuchSession is now a
        # local const and the wrapped error is carried as `cause: noSuchSession ? error :
        # aFailedStart(error)`, so the old two-line anchor is gone. The rule survives (the adapter
        # must carry what it wrapped; D-039's own comment says 'carried as the cause'), so the plant
        # drops that cause line and leaves a ResumeError with no cause. Read, not run:
        # codex-runtime.test.ts reads `(lost as Error).cause` and toMatchObject on it, and the 706
        # file reads `.cause` of the no-rollout answer. Killed by `codex-runtime.test.ts`,
        # `a-session-the-provider-no-longer-has.test.ts`.
        [
            (CODEX, '        cause: noSuchSession ? error : aFailedStart(error),\n        noSuchSession,\n', '        noSuchSession,\n'),
        ],
    ),
    # ── F8 · the cases that stay corrections (this dispatch's review, two rounds) ───────────────
    (
        # ⚠️ **EQUIVALENT MUTANT on the tree, recorded rather than removed (landing D-016b part
        # 2):** The WAIT arm with mark.by === parent.id cannot be reached, so the plant is an
        # equivalent mutant. The waker mark lives only inside startForADelivery (set before
        # resumeSession, deleted in the finally), so setRightAWait sees itWokeIt only for an
        # evaluation made during the resume; there the piece is a STALL (the displaced cause the
        # reopen unwinds), and the waker is never deferred, so that arm writes its-own-wake. A giver
        # is told stopped only about a piece that was not WAIT at the stop, because
        # composeWhatEachPieceIsWaitingOn keeps a piece with an open question WAIT through a Close
        # (D-017 R4), and nothing can open a question in a closed child, so no WAIT is standing
        # during the resume. This is why the old WAIT cases in what-a-waker-reads-after-its-own-act
        # were retired by R4 and DEV's premise 'the child comes back WAITING' has no path left. No
        # test can kill it, so it stays unrun.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about withholding the WAIT arm of the correction (`setRightAWait`) from the
        # waker. The commit removed `setRightAWait` with every other set-right, and "a correction
        # drawn as a wait" is among the four things that went with their subject. No correction is
        # sent to any parent, so there is no arm left to withhold. Its anchor is left stale, so the
        # census records it retired.
        "M13 · 🔴 the WAIT arm is withheld from the waker too · a question the wake brought back "
        "reaches the parent only through the correction's *\"It is waiting\"*, so the waker waits for "
        "a question that never comes while its child waits on the waker's answer",
        # ⚑ **RE-AIMED at `698`, not retired** (`698`'s review found it dark): R37 sends a WAIT to
        # `setRightAWait` before `itsOwnWake` is ever read, so the old anchor could no longer withhold
        # anything. ⚑ The defect is the same — the WAIT's correction withheld from the parent that
        # woke the child — planted where R37 put the decision. ⚑ **Anchor corrected in place by
        # `703`**, whose opener also claims nothing for a parent told nothing (F-C). Re-verified RED.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (the WAIT arm is withheld from the waker too) is a live rule in setRightAWait
        # (itWokeIt = mark?.by === parent.id): a parent that woke the child itself is still told 'It
        # is waiting'. Plant: return early when itWokeIt before the tellOneParentItWasSetRight call.
        # No existing test fails on it. The only test that shows 'It is waiting' to a parent,
        # a-correction-that-says-it-is-waiting-is-drawn-as-a-wait.test.ts (~line 227), gets its
        # start from a Close hand-on, which has no waker mark, so itWokeIt is false there; no other
        # test reaches setRightAWait with mark.by === parent.id. MISSING TEST: on a real host, the
        # parent messages a stopped child (told conversation_ended, so startForADelivery sets the
        # waker mark); the child comes back WAITING (parked on a card or a person's question); check
        # the parent's mailbox and assert exactly one 'It is waiting: ...' correction reaches the
        # parent (work_stall_told how set-right). Paired positive: a non-waker parent, or a person's
        # Reopen, gets the same correction, so the test fails only when the waker is skipped. ⚠️ No
        # test kills it yet: the landing owes one (D-016b part 2).
        [
            (HOST, "    return this.tellOneParentItWasSetRight(\n      parent,\n      piece,\n      standsOn,\n      tookItBack && !itReadOne ? 'nothing' : 'that-it-stopped',\n    )\n", "    if (itWokeIt) return Promise.resolve()\n    return this.tellOneParentItWasSetRight(\n      parent,\n      piece,\n      standsOn,\n      tookItBack && !itReadOne ? 'nothing' : 'that-it-stopped',\n    )\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about whether an ending still held when the waker asked counts as handed to it
        # (`endingsHandedTo`, `itReadAStopSinceItAsked`). The commit removed that bookkeeping along
        # with the wake correction it decided: "every set-right, correction and wake take-back". The
        # waker is never told about its wake, so nothing decides read or unread against the ask. Its
        # anchor is left stale, so the census records it retired.
        "M14 · 🔴 an ending still HELD when the waker asked counts as handed · handed over while the "
        "wake runs — the waker's turn ended, a person's Stop — it reads as read before it asked, and "
        "the waker's last word is *\"has ended\"* about a conversation it has just woken",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 counts a *still open* notice as a stop too (`stopped`); the row still drops the held-notice test. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: an ending still HELD when the waker asked must not count as handed to it. The
        # ledger is now `PieceRow`s and the loop in `endingsHandedTo` reads `if (stopped &&
        # !held.has(piece)) handed.add(piece)`. The plant counts held endings as handed, with `void
        # held` keeping the local used. Killed by `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, '      if (stopped && !held.has(piece)) handed.add(piece)\n', '      void held\n      if (stopped) handed.add(piece)\n'),
        ],
    ),
    (
        # ⚑ **RELABELLED at 690, not retired**: R32 takes back an ending still held at the reopen by
        # its own predicate, so the world this label first named cannot occur; the row is killed in
        # §2.9's, and it says what happens there. Re-verified RED alone after the relabel.
        "M15 · ⛔ a held notice is not recognised as one · the mailbox is read for the wrong kind, so an "
        "ending held when the waker asked and handed over while its wake ran reads as handed before "
        "it asked, and `its-own-wake` replaces the correction the waker is owed",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a held notice is recognised by its mailbox kind, so an ending held when the
        # waker asked is not read as handed. The old `authorship.work?.taskId` is now
        # `authorship.work?.piece` in `piecesWithANoticeHeldFor`, and `'work'` is still a valid
        # `MAILBOX_KINDS` value. Reading the wrong kind empties the held set. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, "queued.kind === 'notice' ? queued.authorship.work?.piece : undefined", "queued.kind === 'work' ? queued.authorship.work?.piece : undefined"),
        ],
    ),
    # ⚑ **689 · M16–M18 moved with their lines, unchanged**, into `announceTheWorkItHolds` — which
    # the reopen and, since `689`, the ENDING both call. ⚠️ So each now mutates the ending's
    # announcement too; this table's killer still kills each on the reopen, and `689`'s own §1 on the
    # ending. The reopen's CALL has its own row there (`689` M10).
    (
        "M16 · 🔴 the reopen moves work and says nothing · a window's Work tab keeps *\"has ended\"* "
        "beside a running holder until its 30 s tick — two answers on one screen",
        [(HOST, "    if (itHoldsWork) this.theWorldMoved('work')\n", "    if (false) this.theWorldMoved('work')\n")],
    ),
    (
        "M17 · ⛔ every reopen announces work · a conversation holding none makes every window re-read "
        "a population nothing moved — the channel starts shouting",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reopen announces `work` only when the conversation holds work, so a
        # conversation with none does not make every window re-read. The guard is now
        # `this.deps.store.openPiecesOf(sessionId).length > 0` in `announceTheWorkItHolds`. The
        # plant makes it always true. Killed by `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, 'itHoldsWork = this.deps.store.openPiecesOf(sessionId).length > 0\n', 'itHoldsWork = this.deps.store.openPiecesOf(sessionId).length > 0 || true\n'),
        ],
    ),
    (
        "M18 · ⛔ a reopen over CLOSED work announces · an answered task is still in the ledger, and "
        "nothing a reopen puts back changes what it reads",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reopen over CLOSED work announces nothing, because the answered piece is still
        # in the ledger and nothing a reopen puts back changes what it reads. The guard is
        # `openPiecesOf(...).length > 0`, which excludes closed pieces and roots. The plant counts
        # every owned piece (`piecesOwnedBy`), closed ones included. Killed by
        # `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, 'itHoldsWork = this.deps.store.openPiecesOf(sessionId).length > 0\n', 'itHoldsWork = this.deps.store.piecesOwnedBy(sessionId).length > 0\n'),
        ],
    ),
    # ── F8 · round three (this dispatch's review) ───────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was a parent
        # that ended the child itself and then woke it, re-armed by `itsOwnEndingThenItsOwnWake`
        # over `toldItNothing`. Both are gone: `what-a-wake-still-says-wrong.test.ts` says "D-016
        # retired §2.11 (its own ENDING, then its own wake): `its-own-ending` is no receipt any
        # more", and D-017 removed `end_agent` and `resume_agent`, so a parent no longer ends its
        # child. `runtime-host.ts` has no `toldItNothing` or `itsOwnEndingThenItsOwnWake` left to
        # plant on. Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 its own ending, then its own wake, re-arms nothing · a parent that ended the child "
        "itself and then woke it is never told the child's NEXT ending — in this run or after a restart",
        # ⚑ **Anchor corrected in place by `703`**, which widened this line to the WAIT arm (`698`
        # F-C). ⛔ The DEFECT is unchanged — nothing re-arms. Re-verified RED individually.
        [
            (
                HOST,
                "    const itsOwnEndingThenItsOwnWake = toldItNothing && mark?.by === parent.id\n",
                "    const itsOwnEndingThenItsOwnWake = false && mark?.by === parent.id\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about deciding the waker's own-wake status from what was held at the reopen
        # versus what was handed when it asked (`handedWhenAsked`). Both the own-wake decision and
        # the handed-over bookkeeping (`correctionsHandedOver`, `endingsHandedTo`) are removed. The
        # commit says "A stop, a reopen and a start tell nobody anything", so the reopen decides
        # nothing about the waker. Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 its own wake is decided from what is held at the REOPEN, not what was handed when it "
        "asked · an ending that did not exist yet — the child on its way out — and was handed over "
        "while the wake ran reads as read before it asked",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: an own wake is decided from the endings handed when the waker ASKED
        # (`mark.handedWhenAsked`), not from what is held at the reopen. The line is now `const
        # wokeItItself = itsOwnWake && mark.handedWhenAsked.has(piece.piece)` in
        # `setRightANoticeAReopenMadeFalse`. The plant asks `endingsHandedTo(parent.id)` at the
        # reopen instead. Killed by `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, 'itsOwnWake && mark.handedWhenAsked.has(piece.piece)', 'itsOwnWake && this.endingsHandedTo(parent.id).has(piece.piece)'),
        ],
    ),
]
