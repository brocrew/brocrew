"""698 · the wake's last stale sentences — `690` F-1, PM ruling R37 (`690` F-2), `690` F-3, `692` F-e.

⛔ **Ordered by the PM**: a busy child already holding a work message was answered *running —
message_agent reaches it*, and `message_agent` then refused it (F-1); a woken child that came back
WAITING left its waker to read an unread *"has ended"* before *"It is waiting"* (R37); an ending
handed over while the wake ran (F-3); and a parent told *"it is still open"* was corrected *"has not
ended after all"* (F-e).

## ⚠️ What a row here measures

 * ⚑ **M1–M10 are F-1** — the wake asking the held-work rail at all, each argument it asks it with
   (the kind, whether a message would be held, whose work, who is asking), the held message and the
   message door's sentence carried in `detail`, the wake's own sentence and its condition, the wait
   for work on its way, and the wake's OWN word rather than the borrowed rail's retry promise —
   killed by `the-wakes-last-stale-sentences.test.ts` §1 (M7 since `703` by
   `what-a-waker-reads-after-its-own-act.test.ts` §2.5, where the caller's own work is held).
 * ⚑ **M11–M18 are R37 and F-3** — the WAIT branch at all, only for the parent that woke it, the
   opener chosen by what the waker read, a failed retraction answered as one, and `698`'s review's
   *a stop read after the ask is still set right* on both arms, with the snapshot it rests on and
   the order it is asked in — killed by §2 and §3.3, and M18 by `what-a-wake-still-says-wrong.test.ts`
   §2.7.
 * ⚑ **M19–M20 are F-e** — the opener that answers *"has ended"* again, and the one that says nothing
   about what was read saying it anyway — killed by §4.1 and §2.1.
 * ⚑ **M21–M22 are round two of `698`'s review** — a stop about ANOTHER task read mid-wake, and a
   CORRECTION read mid-wake, each taken for a stop about this one — killed by §3.4 and §3.5.

## ⛔ What has NO row here, and who holds it instead

 * ⚠️ **The predicate itself** (`theWorkAHoldWaitsBehind`) and the idle read
   (`itTakesAMessageStraightIn`): `queueAs`'s own rows moved onto them — `394 M6`, `440 M1`/`M4`,
   `657 M4`, `670 M19`, each RE-ANCHORED at `698` and re-verified RED alone. ⛔ A second row here
   would be one verdict counted twice (`hoisting-a-shared-guard-moves-another-tables-row`).
 * ⚠️ **The WAIT's correction withheld from the waker** — `673 M13`, RE-AIMED onto `setRightAWait`
   (`698`'s review found it dark). **The wake's re-ask of *running***, **the retraction's
   `return false`**, **the waker's mark** and **the kept-open clause** — `690 M17`, `690 M19`,
   `673 M6` and `692 M33`, re-anchored.
 * ⚠️ **`itReadAStopSinceItAsked`'s `mark.by !== parent.id`**: both callers ask it only where the
   parent woke the child (the stall arm under `itsOwnWake`, the WAIT arm through `tookItBack`), so no
   mutation of it changes an outcome. It is kept because the snapshot describes ONE mailbox, and a
   third caller must not read another's (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`,
   stated rather than dressed as a row).
 * ⚠️ **The wake's single wait against `670`'s repeat flush** — a limit stated in the code, with no
   rig (`698`'s review, F4).
 * ⚠️ **`describe-event.ts`'s caption** for a `set-right` receipt — a raw-stream caption no assertion
   reads, `673`'s own B.
 * ⚠️ **F-3's residue** — a correction the waker's own QUESTION about the work makes stale: pinned
   here until `703`, which repaired it for a question naming the task (its F-A); §3.1 and §3.2 now
   assert that repair, and its rows are in `703`'s table.
 * ⚠️ **M5 also turns a source census red** — `a-service-accepts-any-caller.test.ts` pins one breadth
   read per door, and M5 removes the wake's — and **M9 also turns `the-act-inside-the-cut.test.ts`
   red**, whose act check measures M9's own defect (the condition gone from the sentence). ⚑ So a
   table run cannot name the behaviour test that kills either; each was verified RED alone against
   the test file its label names. (`698`'s review found M1, M2 and M8 in the same position: the
   `runningStateOf` census now pins the ask and its `return`, never the expression returned; M2
   plants its kind as `'notice' as MailboxKind`, which no census counts; M8 keeps the constant named
   in the spread and plants the table's sentence as its value.)

## ⛔ T-003 · M1–M10 retired by ruling (D-010, `8bc565fa`)

D-010 retired the wake's *"a message waits there"* answer with the one-held-message limit: a running
conversation is answered `that-conversation-is-running`, and message_agent is admitted, its message
waiting behind the turn.
`aMessageWaitsThere`, `theWorkAHoldWaitsBehind` and `A_MESSAGE_ALREADY_WAITS_THERE` are deleted, so
the ten rows that planted defects into them are retired beside each row (M1's defect became the
decision).

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

⚠️ M11's anchor (the wake's wait for work on its way) still applies and is still RED on §1.4, but its label
(*inside a flush it names a message that is being sent*) can no longer happen: since D-010 the wake names
no held message, and its own docblock says the reason for the wait is gone. Keep the wait and relabel
M11, or remove it by a dev card and retire M11: the PM's call.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · F-1 — the wake asks the held-work rail message_agent meets ──────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The row's defect is now the product's
        # decision. M1 planted 'the wake asks nothing of the mailbox and answers *running —
        # message_agent reaches it*'. D-010 deleted `aMessageWaitsThere`, and wakeSession now reads
        # `return said('that-conversation-is-running')`. Its anchor is left stale, so the census
        # records it retired (`anchor-absent`).
        "M1 · 🔴 F-1 undone · the wake asks nothing of the mailbox, so a busy child holding a work "
        "message is answered *running — message_agent reaches it* while message_agent refuses it · "
        "killed by `the-wakes-last-stale-sentences.test.ts` §1.1",
        [(HOST, "          return this.aMessageWaitsThere(slot.session, me) ?? said('that-conversation-is-running')\n", "          return said('that-conversation-is-running')\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The kind argument this row plants
        # belonged to `aMessageWaitsThere`'s call to `theWorkAHoldWaitsBehind`, and D-010 deleted
        # both methods ("and so is the wake's \"a message waits there\" answer"). Its anchor is left
        # stale, so the census records it retired (`anchor-absent`).
        "M2 · ⛔ the wake asks with a kind message_agent never holds · the held message goes unseen · "
        "killed by `the-wakes-last-stale-sentences.test.ts` §1.1",
        # ⚠️ Spelled `'notice' as MailboxKind` so no census reads it: `a-message-says-who-wrote-it`
        # counts every `'notice',` line (`698`'s review, round two).
        [(HOST, "      session,\n      'work',\n      this.itTakesAMessageStraightIn(session, 'as-it-finds-it'),\n", "      session,\n      'notice' as MailboxKind,\n      this.itTakesAMessageStraightIn(session, 'as-it-finds-it'),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The 'would it be HELD' argument
        # (`itTakesAMessageStraightIn` passed to `theWorkAHoldWaitsBehind`) existed only inside the
        # deleted `aMessageWaitsThere`. D-010: "the wake's \"a message waits there\" answer" is
        # retired. Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M3 · 🔴 the wake never asks whether a message would be HELD · it reads every running child as "
        "taking a message straight in, and the busy one's held message goes unseen · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §1.1",
        [(HOST, "      'work',\n      this.itTakesAMessageStraightIn(session, 'as-it-finds-it'),\n", "      'work',\n      true,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The wake no longer asks 'as somebody',
        # because the held-work rail with its caller comparison (`one.queuedBy === askedBy`) is
        # gone. D-010 also deleted the `QueuedMessage.queuedBy` field, `theWorkAHoldWaitsBehind` and
        # `aMessageWaitsThere`. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M4 · 🔴 the wake asks as somebody else · on a receiver that takes work from many callers the "
        "caller's OWN held message goes unseen, and the wake says *running* while message_agent "
        "refuses (`698`'s review) · killed by `the-wakes-last-stale-sentences.test.ts` §1.3b",
        [(HOST, "      this.itTakesAMessageStraightIn(session, 'as-it-finds-it'),\n      me,\n", "      this.itTakesAMessageStraightIn(session, 'as-it-finds-it'),\n      session.id,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** 'Whose held work' (the receiver's
        # `howManyCallersItTakesWorkFrom` breadth read at the wake) was an argument of the deleted
        # `aMessageWaitsThere`. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M5 · 🔴 the wake ignores WHOSE held work · a receiver a person granted many callers is refused "
        "at the wake on another caller's held message, while message_agent is admitted — the two "
        "readings diverging · killed by `the-wakes-last-stale-sentences.test.ts` §1.3",
        [(HOST, "      me,\n      this.howManyCallersItTakesWorkFrom(session.id),\n    )\n", "      me,\n      'one-caller',\n    )\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The agent-tools arm `if
        # (outcome.refusedBy === 'a-message-waits-there')`, which built `{ agent, holding:
        # outcome.holding }`, was deleted, and so was the `WakeOutcome` union member `refusedBy:
        # 'a-message-waits-there'`. The wake has no held message to name. Its anchor is left stale,
        # so the census records it retired (`anchor-absent`).
        "M6 · ⛔ the wake's `detail` drops the held message's id · message_agent names it and the wake "
        "does not · killed by `the-wakes-last-stale-sentences.test.ts` §1.1",
        # ⚑ **Anchor corrected in place by `703`**: the wake builds its detail by what is held, and
        # §1.1's held message is a PERSON's, so it walks the arm with no `said` (`698` F-B). ⛔ The
        # DEFECT is unchanged. Re-verified RED individually.
        [(TOOLS, "                  : { agent, holding: outcome.holding }\n", "                  : { agent, holding: 'a message' }\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The same deleted arm carried `said:
        # outcome.said` (MessageAlreadyHeld's sentence), and the class it came from is gone too. Its
        # anchor is left stale, so the census records it retired (`anchor-absent`).
        "M7 · ⛔ the message door's sentence not carried · the wake's `detail.said` is its own and no "
        "longer the one message_agent gives · killed by `what-a-waker-reads-after-its-own-act.test.ts` §2.5",
        # ⚑ **Anchor AND killer corrected in place by `703`**: since `698` F-B the wake carries
        # `message_agent`'s sentence only beside the caller's own WORK — §1.1 holds a person's
        # message, which carries none — and `703` §2.5 is the test that holds the caller's own work
        # at both doors. ⛔ The DEFECT is unchanged. Re-verified RED individually.
        [(TOOLS, "                  ? { agent, holding: outcome.holding, said: outcome.said }\n", "                  ? { agent, holding: outcome.holding, said: 'a message is waiting' }\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The constant
        # `A_MESSAGE_ALREADY_WAITS_THERE` and its `reason:` override at the wake were deleted with
        # the 'a-message-waits-there' arm. Its anchor is left stale, so the census records it
        # retired (`anchor-absent`).
        "M8 · 🔴 the table's sentence at the wake · *message_agent reaches it* about a child "
        "message_agent refuses · killed by `the-wakes-last-stale-sentences.test.ts` §1.1",
        # ⚠️ The constant is still NAMED in the spread, so the act census's roster of overrides
        # does not go red for the row (`698`'s review, round two); the VALUE is the table's.
        [(TOOLS, "                reason: A_MESSAGE_ALREADY_WAITS_THERE,\n", "                reason: A_MESSAGE_ALREADY_WAITS_THERE && refuseTool('that-conversation-is-running').reason,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The sentence 'that conversation is
        # running, so there was nothing to wake; it holds a message not yet sent, and message_agent
        # reaches it once that one has gone.' (`A_MESSAGE_ALREADY_WAITS_THERE`) was deleted by
        # D-010. Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M9 · ⚠️ the wake's sentence loses its condition · *message_agent reaches it* with nothing "
        "saying when, beside a door that refuses it now · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §1.1",
        [(TOOLS, "and message_agent reaches it once that one has gone.'", "and message_agent reaches it.'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The row plants the rail
        # `agent-already-has-a-message-waiting` into the wake's arm. Its anchor is left stale, so
        # the census records it retired (`anchor-absent`).
        "M10 · 🔴 the borrowed rail's price · the wake answers `agent-already-has-a-message-waiting`, "
        "`retryable: true`, about a call that can never wake a running child — the same call then "
        "meets `that-conversation-is-running`, `permanent` (`698`'s review) · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §1.1",
        # ⚑ **Anchor corrected in place by `703`**, which builds the wake's detail on its own line.
        # ⛔ The DEFECT is unchanged. Re-verified RED individually.
        [(TOOLS, "                ...refuseTool('that-conversation-is-running', held),\n", "                ...refuseTool('agent-already-has-a-message-waiting', held),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** wakeSession (the 'wake', i.e.
        # resume_agent) is entirely gone from runtime-host.ts — confirmed by grep for
        # wakeSession/WakeOutcome/WakeWord, all absent. The killer test file itself states this in
        # its own comment: "§1 retired with resume_agent (D-017, commit 3)... there is no wake left
        # to answer." §1.4, the specific sub-test this row depended on, is retired along with it;
        # this table's own docstring already flagged M11 as ambiguous pending 'the PM's call', and
        # D-017 commit 3 settles it by deleting the wake outright. Its anchor is left stale, so the
        # census records it retired.
        "M11 · 🔴 the wake does not wait for work on its way · inside a flush it names a message that "
        "is being sent, while message_agent waits it out and is admitted · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §1.4",
        [(HOST, "        await this.theWorkOnItsWayTo(slot.session, Date.now() + this.deliveryWaitMs)\n", "")],
    ),
    # ── §B · R37 — the WAIT arm takes back its own wake's unread ending ──────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect is now the
        # decision. D-017 R4 made an asking worker's stop push nothing, so a WAIT its own wake
        # brought back never has an unread 'has ended' to take back. the-wakes-last-stale-sentences
        # §2.1 now says so: "An asking worker's stop pushes no ending now — its question survives
        # the stop — so the waker holds nothing about it, and its wake takes nothing back and sets
        # nothing right". what-a-waker-reads-after-its-own-act retired §3.1 and §3.3 the same way.
        # The plant also names toldItNothing, which D-016b removed with setRightAWait's fifth
        # parameter. Its anchor is left stale, so the census records it retired.
        "M12 · 🔴 R37 undone · a WAIT falls through to the stall arm, which takes nothing back for it, "
        "and the waker reads *\"has ended\"* before *\"It is waiting\"* · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §2.1",
        # ⚑ **Anchor corrected in place by `703`** (F-C's argument). Re-verified RED individually.
        [(HOST, "      if ('waits' in standsOn)\n        return this.setRightAWait(parent, task, standsOn, mark, toldItNothing)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Its premise was removed on
        # purpose. The row is about a person's Reopen of an ASKING worker taking the parent's ending
        # back. D-017 R4 keeps the question across a Close, so that Reopen tells the parent nothing
        # to correct, and the old killer §2.3 is gone from the-wakes-last-stale-sentences (its §2
        # keeps only §2.1, the 'tells its parent nothing' arm). what-a-waker-reads-after-its-own-act
        # §1.1c says: "retired with its premise (D-017 · R4)". Its anchor is left stale, so the
        # census records it retired.
        "M13 · ⛔ R37 for EVERY parent · a PERSON's Reopen of an asking worker takes the parent's ending "
        "back too, though the parent did not wake it · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §2.3",
        [(HOST, "    const unread = itWokeIt ? this.theNoticesItHasNotRead(parent, task.taskId) : []\n", "    const unread = this.theNoticesItHasNotRead(parent, task.taskId)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The defect is now the
        # decision. The row needs a WAIT correction after the parent took back an unread ending or
        # was told nothing. D-017 R4 makes both unreachable, since an asking worker's stop pushes
        # nothing. `toldItNothing` and `itsOwnEndingThenItsOwnWake` (the `(tookItBack ||
        # toldItNothing)` term) went with D-016b, and what-a-waker-reads-after-its-own-act §3.3
        # ("told NOTHING, its-own-ending, then a person's Reopen and Close, then its own wake") was
        # retired with end_agent. Its anchor is left stale, so the census records it retired.
        "M14 · 🔴 the opener claims a notice it took back · the waker is told *\"after you were told it "
        "had stopped\"* about an ending it never read · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §2.1",
        # ⚑ **Anchor corrected in place by `703`** (F-C's argument). Re-verified RED individually.
        [(HOST, "      (tookItBack || toldItNothing) && !itReadOne ? 'nothing' : 'that-it-stopped',\n", "      'that-it-stopped',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `retractWhatItsWakeMadeFalse` and its false/true return are deleted, along with the
        # correction behind an ending. The commit removes "every set-right, correction and wake
        # take-back", and §2 of `what-a-wake-still-says-wrong.test.ts` and §3.1, §3.3, §3.4 and §3.5
        # of `the-wakes-last-stale-sentences.test.ts` went with their subject. Its anchor is left
        # stale, so the census records it retired.
        "M15 · ⛔ a failed retraction answered as one · the name read fails, nothing is taken back, and "
        "the correction behind the ending opens as if the parent never read it · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §2.4",
        [(HOST, "      return false\n    }\n    for (const one of unread) this.takeQueuedBack", "      return true\n    }\n    for (const one of unread) this.takeQueuedBack")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The stall-arm branch of `setRightANoticeAReopenMadeFalse`
        # (`retractWhatItsWakeMadeFalse(...) || !itReadOne`) no longer exists. The commit deletes
        # "the unwind of an ending, and every set-right, correction and wake take-back", so a waker
        # is never handed a stop or corrected about one. Its anchor is left stale, so the census
        # records it retired.
        "M16 · 🔴 a stop read after the ask is swallowed on the STALL arm · a waker handed the first of "
        "several notices while the wake ran has the rest taken back and is never set right — its "
        "last word *\"has ended\"* about a child it woke (`698`'s review) · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §3.3",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds on the stall arm: a stop the waker READ after it asked is still set right, even when
        # the other held notices are taken back. Only the names changed (task to piece, taskId to
        # piece.piece). The plant swallows the correction by making the read-a-stop test always
        # fail. Killed by `the-wakes-last-stale-sentences.test.ts`.
        [
            (HOST, '        if (!this.retractWhatItsWakeMadeFalse(parent, piece, unread) || !itReadOne) return\n', '        if (!this.retractWhatItsWakeMadeFalse(parent, piece, unread) || true) return\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `WakerMark.stopsHeldWhenAsked` and `theStopsHeldFor` are deleted (0 occurrences) along
        # with `wokenBy`. The snapshot existed only to decide whether a waker read a stop before a
        # correction, and no stop notice or correction is sent now. Its anchor is left stale, so the
        # census records it retired.
        "M17 · ⛔ the snapshot is never taken · nothing held when the waker asked is remembered, so a "
        "stop it read mid-wake reads as never read, on both arms · killed by "
        "`the-wakes-last-stale-sentences.test.ts` §3.3",
        [(HOST, "      stopsHeldWhenAsked: this.theStopsHeldFor(me),\n", "      stopsHeldWhenAsked: new Map<string, string>(),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `itReadAStopSinceItAsked` and the ordering against the take-back are deleted. R32's plain
        # case, a waker's unread "has ended" being withdrawn instead of corrected, went with the
        # `conversation_ended` notice: a stop tells nobody anything, so there is no unread stop
        # notice to withdraw or misjudge as read. Its anchor is left stale, so the census records it
        # retired.
        "M18 · 🔴 *read since it asked* is asked AFTER the taking back · the notices just taken back are "
        "gone from the mailbox and read as read, so R32's plain case sends the correction it exists to "
        "withhold · killed by `what-a-wake-still-says-wrong.test.ts` §2.7",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: 'read since it asked' must be asked BEFORE the taking back empties the mailbox. The
        # chain is unchanged in shape (`const itReadOne = ...` then the retract-or-return line, now
        # with piece names). The plant asks it after the retraction. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, '        const itReadOne = this.itReadAStopSinceItAsked(parent, mark, piece.piece)\n        if (!this.retractWhatItsWakeMadeFalse(parent, piece, unread) || !itReadOne) return\n', '        if (\n          !this.retractWhatItsWakeMadeFalse(parent, piece, unread) ||\n          !this.itReadAStopSinceItAsked(parent, mark, piece.piece)\n        )\n          return\n'),
        ],
    ),
    # ── §C · F-e — the opener answers what the parent read ───────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The correction opener "has not ended after all: that conversation was reopened" is gone
        # from `reply-rails.ts`, and no correction is composed.
        # `the-wakes-last-stale-sentences.test.ts` §4 is documented as "gone with its subject: the
        # correction's opener for a parent told its child was still open. No correction is sent
        # now." Its anchor is left stale, so the census records it retired.
        "M19 · 🔴 F-e undone · a parent told *\"it is still open\"* is corrected *\"has not ended after "
        "all: that conversation was reopened\"* — an answer to a notice it was never given · killed "
        "by `the-wakes-last-stale-sentences.test.ts` §4.1",
        # ⚑ 705 · re-anchored in place — the number is asked of `taskCalled` now (R38).
        # ⚑ **707 · re-anchored in place, not retired** — R40 spells the task once as `called` (`taskCalledFrom`); the row still answers a notice it was never sent.
        [(REPLY, "      : `${called} with ${holder}: that conversation was started again after you were told it had stopped.`,\n", "      : `${called} with ${holder} has not ended after all: that conversation was reopened after you were told it had stopped.`,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The "nothing" opener, "that conversation was started again" for a waker that read no stop,
        # is deleted with the correction sentence. The commit removes "every set-right, correction".
        # §2.1 of the killer file is now a different test (an asking worker's stop tells its parent
        # nothing) and no longer reaches this sentence. Its anchor is left stale, so the census
        # records it retired.
        "M20 · ⚠️ the *nothing* opener says it anyway · the sentence for a waker that read no stop names "
        "one · killed by `the-wakes-last-stale-sentences.test.ts` §2.1",
        # ⚑ 705 · re-anchored in place — the number is asked of `taskCalled` now (R38).
        # ⚑ **707 · re-anchored in place, not retired** — R40 spells the task once as `called` (`taskCalledFrom`); the row still names a stop nobody read.
        [(REPLY, "      ? `${called} with ${holder}: that conversation was started again.`\n", "      ? `${called} with ${holder}: that conversation was started again after you were told it had stopped.`\n")],
    ),
    # ── §D · round two of `698`'s review — what counts as a stop read since the ask ────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The mailbox scan `about === piece && !parent.mailbox.some(...)` lived in
        # `itReadAStopSinceItAsked`, which is deleted. There is no stop for a waker to have read
        # about another task, and the commit removes the wake take-back it served. §3.4 was deleted
        # from the killer test. Its anchor is left stale, so the census records it retired.
        "M21 · ⛔ another task's stop counts · a waker handed another child's *\"has ended\"* while "
        "it woke this one is sent a correction about this one, which it never read a stop about · "
        "killed by `the-wakes-last-stale-sentences.test.ts` §3.4",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: another piece's stop must not count as a stop read about this one. The guard is now
        # `about === piece`, and the plant drops it. The killer §3.4 (a stop about ANOTHER child
        # handed mid-wake) is still in the-wakes-last-stale-sentences. Killed by
        # `the-wakes-last-stale-sentences.test.ts`.
        [
            (HOST, '      if (about === piece && !parent.mailbox.some((one) => one.id === id)) return true\n', '      if (!parent.mailbox.some((one) => one.id === id)) return true\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `report?.state === 'stalled' && report.stalledBecause === 'conversation_ended'` filter
        # was inside `itReadAStopSinceItAsked` and is deleted with `conversation_ended` ("There is
        # no conversation_ended stall cause"). No correction is sent, so it cannot be counted as a
        # stop or answered with a second one. §3.5 was deleted from the killer test. Its anchor is
        # left stale, so the census records it retired.
        "M22 · 🔴 a CORRECTION counts as a stop · a waker handed *\"that conversation was started "
        "again\"* while the wake ran is sent a second correction, which goes stale in the turn it "
        "reads the first in · killed by `the-wakes-last-stale-sentences.test.ts` §3.5",
        [(HOST, "      if (report?.state === 'stalled' && report.stalledBecause === 'conversation_ended') {\n", "      if (report !== undefined) {\n")],
    ),
]
