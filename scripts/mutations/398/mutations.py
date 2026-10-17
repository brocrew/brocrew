"""398 · the two clocks — each row is THE DEFECT, put back (131).

🔴 **Two criteria, two clocks, one mechanism.** HO-007 criterion 5 — *an idle timeout fails the task
the same way* — and criterion 11 — *an unanswered question escalates on timeout, chain visible* —
were the last two of the fifteen that nobody built and nobody deferred. Both are a DEADLINE computed
from the ledger: the last relevant row plus a window, written as a row the fold then reads.

⛔ **The ruling that made them buildable is `396` §4 read properly.** *"No timer"* forbids a FOLD
that infers failure from silence; HO-007 S3 requires an ENGINE that observes it and writes a row —
*"observed by the engine, never declared by an agent"*. ⚑ Every row below is that distinction broken
in one specific place.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M6` | ⚑ **`run_suite`** — `apps/desktop/test/the-two-clocks.test.ts` §1–§3 |
| `M7`–`M12` | ⚑ **`run_suite`** — the same file's §1, §7, and `a-task-you-can-see.test.ts` §1, §7 |
| `M13`–`M16` | ⚑ **`run_suite`** — the same file's §2, §8, §9 |
| `M17`–`M22` | ⚑ **`run_suite`** — the same file's §4, §5, §9, and `a-question-finds-a-person.test.ts` §6 |
| `M23`–`M25` | ⚑ **`run_suite`** — the same file's §6 |

## ⛔ What this table deliberately does NOT contain

⛔ **No row making the idle timeout CLOSE a task.** ⚠️ That is a RULING and not a mechanism: a task
closed on a deadline can never be answered (`393`: a second reply is a permanent refusal), so a child
that was merely slow would lose the reply it was already writing. ⚑ The decision lives in
`TASK_IS_OPEN` and `M9` is the row that puts the other reading back — a single table entry, which is
what makes it cheap for the PO to overrule.

⛔ **No row on `settleStrandedRequests`, `settleStrandedMessages` or `settleOrphanRuns`.** `396` and
`379` own them. What `398` changes about them is only WHERE it stands relative to them, which is
`M13`.

⛔ **No row deleting the `LivenessTracker` hook or the escalation timer.** ⚠️ **They are
optimisations and the suite says so**: a look that never happens changes nothing a launch would not
also write, so a row there would record as a SURVIVOR and mean nothing. ⚑ What IS a row is `M14` —
the store writing into a ledger the host owns the ordinals of — because that one is a defect whatever
triggered it.

⛔ **No row on `permissionShaped` or on the `because` gate in `questionsWaitingOn`.** `394` owns both;
`M19` is this dispatch's own half of criterion 10 — the escalation refusing to carry authority.

## 🔴 RETIRED AT `400` — twelve rows, by a RULING and not by drift

⛔ **HO-018 §2.2 withdrew criterion 5.** *"An idle timeout on a WORKING child is the guess, and your
measurement says we cannot pick the number honestly. Record last activity and show it. No automatic
state change."* ⚑ The quiet clock and everything that decided it came out of the app, so `M1`–`M8`,
`M10`, `M11`, `M13` and `M14` describe code that no longer exists.

⚠️ **They are kept in place, annotated, and named by the census as protecting nothing** — 142's rule,
and it matters more here than usual: these rows are the evidence that the mechanism the PO retracted
was BUILT and was measured, which is what makes the retraction a decision rather than a gap.
⛔ **`400` ran the 26 assertions that asserted the state change RED before removing them**, and its
own table covers the subjects that survived.

## ⚑ What did NOT retire

**`M9`, `M15`, and `M17`–`M25` still apply.** `M9` is `TASK_IS_OPEN.stalled`, which HO-018 §2.1 took
explicitly; `M15` is the window guard at construction; the rest are criterion 11's, which HO-018 left
alone. ⚠️ `M12` and `M16` were RE-ANCHORED rather than retired — their subjects moved rather than
going away — and each was re-verified RED individually.

## 🔴 `M4` is a defect this table FOUND, not one it was written to describe

⚠️ **The first `M4` compared the resumption by TIME instead of by ORDINAL and it SURVIVED** — the two
readings agree everywhere the suite could reach, which is `a-rule-measured-only-where-both-readings-agree`.
⛔ **Asking where they could ever diverge is what found the real bug**: `selectLastEvent` was reading
the app's OWN back-stamped rows as *the last thing that happened*, so a conversation that held work
and had a question escalated would have its silence measured from a moment the app invented. ⚑ The
statement now excludes both back-stamped types, `M4` is that exclusion removed, and the ordinal
comparison it used to be about is left as the question actually being asked rather than as a guard —
its docblock says so.

## ⚠️ Rows this table does not contain because their defect is UNREACHABLE

⛔ **No row on the `waiting`-task guard in the fold or in the store measured end to end.** A task
still queued sits behind a turn parked on a card, and the `waiting_permission` suspension already
refuses there — so an end-to-end row would be measured where both readings agree. ⚑ `M6` and `M8` are
those guards, and the suite reaches them the only way that diverges: §3 plants the ledger onto a
conversation nobody is running, and §7 hands the same shape to the fold directly.

## ⚑ ANCHOR CORRECTED IN PLACE BY 494

⛔ **`selectTaskEvents`' type list gained `'user_decision'`** — the second producer of an actor for
`TaskRow.stalledBy`, and a type the fold branches on has to be a type the statement selects.
⚠️ **The rule this row restores is unchanged**; only the bytes it anchors on moved. ⚑ `494` put the
new member on its OWN line so that `491 M6`, which anchors on the last two lines and is the only row
in this set whose table has been RUN, keeps the verdict it earned — *a corrected anchor keeps a
verdict it never earned*. This table is `unrun`, so the correction costs it nothing.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them.** The paragraph that
# argues *"the time it was actually DUE"* sits inside this literal in the source; an anchor spanning
# it dies the next time somebody edits a sentence
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
BEGAN_PUSH = (
    "      due.push({\n"
    "        sessionId: worker.id,\n"
    "        // 🔴 **The time it was actually DUE, never the time we noticed.**\n"
    "        at: deadline,\n"
    "        event: { type: 'work_quiet', state: 'began', since: last.created_at },\n"
    "      })\n"
)

ESCALATE_PUSH = (
    "        due.push({\n"
    "          sessionId: asker.id,\n"
    "          at: deadline,\n"
    "          event: { type: 'request_escalated', requestId: request.requestId },\n"
    "        })\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the quiet window is observed at all ───────────────────────────────────────────────
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the quiet decision itself
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M1 · 🔴 the quiet window is never written · nothing in the app ever records that a "
        "conversation has produced nothing while work is outstanding, so a wedged child reads "
        "`working` for ever and criterion 5 is exactly as unbuilt as `393` left it",
        [(STORE, BEGAN_PUSH, "")],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the back-stamped `began` row
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M2 · 🔴 the row is stamped when we LOOKED, not when it fell DUE · a window that elapsed "
        "with the app shut down records the launch time instead, so *the deadline passed at 3am* "
        "becomes *the deadline passed when you started the app* — the one fact a deadline has that a "
        "timer does not",
        [
            (
                STORE,
                "        // 🔴 **The time it was actually DUE, never the time we noticed.**\n"
                "        at: deadline,\n",
                "        at,\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the `ended` edge
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M3 · ⛔ the quiet never ENDS · a provider that was merely slow comes back and the task goes "
        "on reading `stalled` for the rest of its turn, so a parent reading `list_tasks` is told to "
        "end a child that is working — a state that can only be entered is a state that lies",
        [
            (
                STORE,
                "        if (!tasks.some((task) => task.state === 'stalled')) continue\n",
                "        continue\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the back-stamped-row exclusion in `selectLastEvent`
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M4 · 🔴 the deadline is measured from one of the app's OWN back-stamped rows · a child that "
        "holds work AND asked its parent something is the ordinary shape of a spawned worker, and "
        "`request_escalated` is stamped in the PAST — so the silence is measured from a moment the "
        "app invented and the conversation is reported quiet before it is",
        [
            (
                STORE,
                "      WHERE session_id = ? AND generation = ?\n"
                "        AND type NOT IN ('work_quiet', 'request_escalated')\n"
                "      ORDER BY ordinal DESC LIMIT 1`,",
                "      WHERE session_id = ? AND generation = ?\n"
                "      ORDER BY ordinal DESC LIMIT 1`,",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so `353`'s `waiting_permission` suspension
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M5 · ⛔ the `waiting_permission` suspension is dropped · a child parked on a card nobody has "
        "answered is written down as having gone quiet, so every question a person is still looking "
        "at makes its task read `stalled` — `353` measured this suspension and this is it removed",
        [
            (
                STORE,
                "      if (status?.state === 'waiting_permission') continue\n",
                "",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the `working`-task requirement
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M6 · ⚠️ work still QUEUED counts as gone quiet · a second task held behind a running turn "
        "has not been handed over, and reporting the conversation's silence against it blames a "
        "child for not answering a message it has never been sent",
        [
            (
                STORE,
                "      if (!tasks.some((task) => task.state === 'working')) continue\n",
                "      if (!tasks.some((task) => task.state === 'working' || task.state === 'waiting'))\n"
                "        continue\n",
            )
        ],
    ),
    # ── §2 · the fold, and the word ────────────────────────────────────────────────────────────
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the `work_quiet` branch in the fold
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M7 · 🔴 the fold cannot see the row · `work_quiet` is written, stored and rendered and "
        "changes no task state at all — *nothing unwired implies a working state*, with the wire cut "
        "one layer below where anybody would look",
        [
            (
                TASKS,
                "    if (event.type === 'work_quiet') {\n",
                "    if (false as boolean) {\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the per-state guard on `began`
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M8 · ⛔ `began` reaches a WAITING task · work that has not been handed over is reported "
        "`stalled`, which is the same defect as `M6` arriving from the other side — the guard is "
        "per-STATE in both places for exactly this reason",
        [
            (
                TASKS,
                "        if (event.state === 'began' && held.row.state === 'working') {\n",
                "        if (event.state === 'began') {\n",
            )
        ],
    ),
    (
        "M9 · 🔴 `stalled` is CLOSED · a deadline ends the task, so the reply a slow child is already "
        "writing meets `393`'s permanent refusal and the work is lost — a guess dressed as a fact, "
        "given teeth, on a window with one sample's headroom",
        [(TASKS, "  stalled: true,", "  stalled: false,")],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the `stalled` arm of the turn branch
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M10 · ⛔ a completed turn no longer settles a `stalled` task · the ending arrives and the "
        "task keeps saying *nothing is happening*, for ever — the observation creating the state it "
        "exists to end",
        [
            (
                TASKS,
                "        if (held.row.state === 'working' || held.row.state === 'stalled') {\n"
                "          settle(taskId, 'silent', entry.at)\n"
                "        }\n",
                "        if (held.row.state === 'working') settle(taskId, 'silent', entry.at)\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the `stalled` arm of the session-ending branch
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M11 · ⛔ a conversation that ENDS leaves its quiet work behind · the session is gone and the "
        "task still reads `stalled`, so a parent is told to keep waiting on a conversation that no "
        "longer exists rather than `abandoned`",
        [
            (
                TASKS,
                "          held.row.state === 'working' ||\n          held.row.state === 'stalled'\n",
                "          held.row.state === 'working'\n",
            )
        ],
    ),
    (
        "M12 · 🔴 the store's narrow read does not select it · every stalled task derives as "
        "`working` on the REPLAYED path — which is every path after a restart — while the live path "
        "is right, so the two readings of one ledger disagree and only one of them is ever seen. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
                # ⚑ **Re-anchored by `400`.** HO-018 §2.2 withdrew the quiet window, so the type this
                # row drops is now `work_restarted` — the launch's own row about work a restart left
                # undriven. ⛔ The ROW's sentence is unchanged and is if anything sharper: a
                # `work_restarted` folded but not selected leaves every task a restart stalled
                # deriving as `working` on the REPLAYED path, which is the only path that row exists
                # on. Re-verified RED individually.
                # ⚑ **Re-anchored by `429`**, which added `task_withdrawn`. ⛔ The ROW is unchanged:
                # it still drops `work_restarted`, so every task a restart stalled derives as
                # `working` on the replayed path. Re-verified RED individually.
                # ⚑ Re-anchored by `491`, which added `user_turn`; the row still removes only
                # `work_restarted`.
                # ⚑ Re-anchored by `673`, which added `reopened` on a line of its own; the row still
                # removes only `work_restarted`.
                # ⚑ Re-anchored by `724` (R84), which added `reply_undelivered` on its own line after `reopened`; the row is unchanged.
                # ⚑ **T-002 · re-anchored in place, not retired** — D-005a added `message_queued` to the list on a line of its own; the row still drops the same type. Re-verified RED alone.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same shared
        # `selectTaskEvents` IN-list, same reason the byte anchor went dark (the inserted
        # `'replaced_by',` line). Dropping `'work_restarted'` (and leaving `'status'` relocated onto
        # the following line, matching the row's own rearrangement) still derives every
        # restart-stranded task as `working` on the replayed path only.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the piece narrow read (`selectPieceEvents`) must select the restart event, or
        # every stalled piece derives as `working` on the replayed path while the live path is
        # right. Piece events are now `work_restarted{pieces}`, and the plant drops
        # `'work_restarted'` from that list. It is in the same statement as 393 M7, so the harness
        # must not apply the two together. Killed by `a-task-you-can-see.test.ts`,
        # `never-close-what-you-did-not-see-finish.test.ts`, `the-two-clocks.test.ts`.
        [
            (STORE, "                     'replaced_by', 'work_restarted', 'request_routed', 'request_stranded',\n", "                     'replaced_by', 'request_routed', 'request_stranded',\n"),
        ],
    ),
    # ── §3 · where the sweep stands, and who is allowed to write ───────────────────────────────
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the sweep running before the launch repairs
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M13 · 🔴 the deadline sweep runs AFTER the launch repairs · `settleStrandedMessages` and "
        "`settleStrandedRequests` append rows stamped at NOW into exactly the ledgers a crash left "
        "with work outstanding, so the launch reads its own housekeeping as activity and resets "
        "every deadline it was there to collect",
        [
            (
                HOST,
                "    const quiet = this.deps.store.settleQuietWork(this.now(), this.quietWindowMs, elsewhere)\n"
                "    if (quiet > 0) {\n"
                "      console.info(`tasks: wrote ${quiet} quiet-window row(s) whose deadline had already passed`)\n"
                "    }\n",
                "",
            ),
            (
                HOST,
                "    const asked = this.deps.store.settleStrandedRequests(this.now(), elsewhere)\n",
                "    const quiet = this.deps.store.settleQuietWork(this.now(), this.quietWindowMs, elsewhere)\n"
                "    if (quiet > 0) {\n"
                "      console.info(`tasks: wrote ${quiet} quiet-window row(s) whose deadline had already passed`)\n"
                "    }\n"
                "    const asked = this.deps.store.settleStrandedRequests(this.now(), elsewhere)\n",
            ),
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** HO-018 §2.2
        # withdrew criterion 5 outright — *"an idle timeout on a working child is the
        # guess, and your measurement says we cannot pick the number honestly"* — so the live-ledger guard on the quiet sweep
        # no longer exists to be put back. ⚠️ **The row is kept in place rather than deleted**
        # (142's rule) and the census names it as protecting nothing; what took over the
        # subject, where anything did, is the `400` table.
        "M14 · 🔴 the LAUNCH sweep writes into a ledger the host is running · `HostedSession.ordinal` "
        "is the host's own counter, so the append collides on `unique(session_id, generation, "
        "ordinal)`, `record()` marks the conversation as no longer recorded, and every later durable "
        "event of a conversation somebody is having is dropped — silently",
        [
            (
                STORE,
                "      const due = quietWorkDueNow(at, windowMs, (sessionId) => !running.has(sessionId))\n",
                "      const due = quietWorkDueNow(at, windowMs, () => true)\n",
            )
        ],
    ),
    (
        # ⛔ **616 relay 1 · RETIRED, and it is the only row in this project killed by a MERGE
        # rather than by a dispatch.** ⚑ `612` kept `positiveWindow` because `616`'s branch still
        # called it for `proposalBoundMs`; `616` kept it because `612`'s branch still called it
        # for `escalationWindowMs`. ⚠️ **Neither branch removed its last caller — the merge did**,
        # and `@typescript-eslint/no-unused-vars` is what said so.
        #
        # 🔴 **The SUBJECT died rather than moved** (the question the census refuses to answer for
        # you): there is no deadline window left on this class to refuse a non-positive value FOR.
        # ⛔ **The RULE is kept in words** where the function stood — zero and negative are not
        # short windows, they are windows that have always elapsed — with the note that a future
        # deadline owes it re-written, never restored as a function nothing calls.
        "M15 · ⛔ RETIRED BY 616 relay 1 — by the MERGE and by neither branch · a zero or "
        "negative window is accepted at construction · every working task is written quiet on "
        "the first look and every question escalated the instant it is asked — a guard that "
        "fails OPEN while reading as though it had been tightened",
        [
            (
                HOST,
                "  if (!Number.isFinite(value) || value <= 0) {\n"
                "    throw new TypeError(`${named} must be a positive number of milliseconds, not ${String(value)}`)\n"
                "  }\n",
                "",
            )
        ],
    ),
    # ── ⛔ RETIRED BY 612 · the SUBJECT was deleted, and that is the whole reason ──────────────
    #
    # 🔴 **`HO-088` §3.1 removed the escalation deadline**, and with it `SessionStore.escalationsDue`,
    # `escalationsDueNow` and `RequestEscalationDue`. ⚑ **These five rows all anchor inside that one
    # deleted sweep** — the store's own guard, its push, its stamp, its permission skip and its
    # once-only check. ⛔ **Nothing they describe exists to be mutated**, and nothing writes a
    # `request_escalated` event in this app any more.
    #
    # ⚠️ **This is a DEATH, not a move** (census Q3), which is why each is named here rather than
    # re-anchored: there is no surviving line that carries the sentence. ⛔ **`M19` is the sharpest
    # of them** — `611` corrected its anchor in place four days of work ago because the skip had
    # started reading the RECIPIENT; `612` then deleted the loop the skip lived in. ⚑ A row can be
    # repaired once and retired the next time, and the repair was not wasted: it is what made this
    # retirement a clean deletion rather than an ambiguous absence.
    #
    # ⚑ **What still guards the behaviour they were protecting**, because a retirement that leaves
    # a hole is a retirement that should have been a re-anchor:
    #   · **`M19`'s rule — a permission is never a question** — is `612 M5` at the READER that now
    #     carries the whole of it (`questionsAPersonMustAnswer`'s refused-arm exclusion), and
    #     `611 M4` at the admission beside it.
    #   · **`M17`'s rule — a question must still reach a person** — is `612`'s subject entire:
    #     `pass_question_up` is the only route left and `the-two-clocks.test.ts` §5 walks it.
    #   · **`M18`/`M20`'s rule — the stamp is a fact about the question, not about a timer** — is
    #     `612 M1` and `M2`, which keep every historic stamp readable now that nothing can rewrite
    #     one.
    #   · **`M16`'s rule — a hatch every enforcer must honour** — had exactly two enforcers and
    #     `612` deleted the second; `positiveWindow` is still guarded at its surviving caller by
    #     `the-two-clocks.test.ts` §9.
    (
        "M16 · ⛔ RETIRED BY 612 (the sweep is deleted) · the STORE stops refusing the same window · the host's guard is honoured and the "
        "store's is not, so a caller that reaches the decision directly gets the fail-open reading — "
        "*an exemption must be honoured by every enforcer*, and a hatch one of them ignores is a "
        "hatch",
        [
            (
                STORE,
                # ⚑ **Re-anchored by `400`.** The quiet decider it used to guard is gone with its
                # criterion; the ESCALATION decider still carries the same refusal and the row's
                # sentence is unchanged — a hatch one enforcer honours is a hatch.
                "    if (!Number.isFinite(windowMs) || windowMs <= 0) return []\n"
                "    const due: RequestEscalationDue[] = []\n",
                "    const due: RequestEscalationDue[] = []\n",
            )
        ],
    ),
    # ── §4 · the escalation, and what it must not do ───────────────────────────────────────────
    (
        "M17 · ⛔ RETIRED BY 612 (the sweep is deleted) · no question is ever escalated · a child waits on a parent that is not listening and "
        "nothing ever tells a person, which is criterion 11 exactly as unbuilt as `394` and `396` "
        "left it",
        [(STORE, ESCALATE_PUSH, "")],
    ),
    (
        "M18 · ⛔ RETIRED BY 612 (the sweep is deleted) · the escalation is stamped when we LOOKED · `M2`'s defect on the other clock, and it "
        "matters for the same reason: *when a person became responsible* is a fact about the "
        "deadline, not about when a timer happened to fire",
        [
            (
                STORE,
                "          sessionId: asker.id,\n          at: deadline,\n",
                "          sessionId: asker.id,\n          at,\n",
            )
        ],
    ),
    (
        "M19 · ⛔ RETIRED BY 612 (the sweep is deleted) · a PERMISSION is escalated · authority travels the channel knowledge was built for, "
        "which is HO-005 §2 Q2 written into the ledger — *an agent answering another agent's "
        "permission prompt is the kill switch with extra steps*, arriving as a hand-off this app had "
        "already refused",
        # ⚠️ **611 · CORRECTED IN PLACE, never retired** — the skip reads the RECIPIENT since
        # HO-088 §2 gave a second way to be a person's. Deleting it still escalates a request
        # that was always a person's, which is this row's subject.
        [(STORE, "        if (request.went.to === 'a-person') continue\n", "")],
    ),
    (
        "M20 · ⛔ RETIRED BY 612 (the sweep is deleted) · a question is escalated again and again · the stamp moves every window, so *the "
        "moment a person was first told* becomes *the last time anybody looked*, and the instrument "
        "that would say how often an escalation turned out to be unnecessary answers nothing",
        [(STORE, "        if (request.escalatedAt !== null) continue\n", "")],
    ),
    (
        "M21 · 🔴 escalating ENDS the question · the parent's own answer is refused after a deadline "
        "it never saw, so *knowledge escalates* becomes *the parent loses its turn* — and criterion "
        "11's own sentence says the chain is still waiting on it",
        [
            (
                QUESTIONS,
                "      if (rows[index]!.escalatedAt !== null) continue\n"
                "      rows[index] = { ...rows[index]!, escalatedAt: entry.at }\n",
                "      if (rows[index]!.escalatedAt !== null) continue\n"
                "      rows[index] = { ...rows[index]!, escalatedAt: entry.at }\n"
                "      settle(event.requestId, 'rejected', entry.at)\n",
            )
        ],
    ),
    (
        "M22 · ⛔ the stamp is lost when the parent answered first · a question answered between the "
        "deadline falling due and the sweep looking keeps no record that a person was told, so *was "
        "anybody paged for this?* depends on the order two independent writers happened to run in",
        [
            (
                QUESTIONS,
                "      const index = everSeen.get(event.requestId)\n",
                "      const index = open.get(event.requestId)\n",
            )
        ],
    ),
    # ── §5 · the chain a person reads ──────────────────────────────────────────────────────────
    (
        "M23 · 🔴 a cycle is walked instead of refused · a conversation that is its own ancestor "
        "makes the walk run to its bound and then claim a person is next, which is the failure mode "
        "`depthOf`'s own 64-hop guard exists to avoid — a rail that hangs rather than refusing",
        [
            (
                QUESTIONS,
                # ⚑ **474 removed the second conjunct and kept the rule.** `seen` held session ids
                # and PROVIDER request ids in one set while walking across conversations, so a
                # parent sharing a descendant's session-local id was refused as a cycle. ⛔ The
                # cycle refusal itself is what this row deletes, and it is still here.
                "    if (seen.has(next.askedBy)) return { links, endsWithAPerson: false }\n",
                "",
            )
        ],
    ),
    (
        "M24 · ⛔ a walk that was STOPPED still says a person is next · the sentence ends *waiting on "
        "you* after a cycle or a bound, naming somebody as the answerer on the strength of a walk "
        "that never reached them",
        [
            (
                QUESTIONS,
                "  if (chain.endsWithAPerson && last !== undefined) hops.push(`${name(last.on)} waiting on you`)\n"
                "  else hops.push('and the chain above that could not be followed')\n",
                "  if (last !== undefined) hops.push(`${name(last.on)} waiting on you`)\n",
            )
        ],
    ),
    (
        "M25 · ⚠️ the chain stops at one hop · a PM blocked on its OWN question is reported as the "
        "person to chase, so HO-007's *worker waiting on PM, PM waiting on you* names the wrong "
        "party — the whole point of the chain being transitive rather than a pair",
        [
            (
                QUESTIONS,
                # ⚠️ **611 · CORRECTED IN PLACE** — the walk stops at a conversation nobody
                # spawned, which is the hop `pass_question_up` created (HO-088 §3.2).
                "    const next = cursor.parent === null ? null : openQuestionOf(cursor.parent)\n",
                "    const next = null as RoutedRequest | null\n",
            )
        ],
    ),
]
