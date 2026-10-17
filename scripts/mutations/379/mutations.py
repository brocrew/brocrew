"""379 · a task you can see — each row is THE DEFECT, put back (131).

⛔ **What this dispatch shipped is one ledger event and one pure fold.** A task is the assignment of
work by one identity to one conversation: `task_<uuid>`, numbered per project, minted in
`RuntimeHost.queueMessage` above the held/sent branch, recorded as one `task_assigned` row in the
ledger of the conversation that was given the work. ⚑ **There is no `task` table**, so HO-007
criterion 2 — *"drop the index, rebuild from the ledger, identical rows"* — is a property of
`shared/tasks.ts`'s import list rather than of a rebuild anybody has to remember to run.

🔴 **The safety property, in the direction the rows read.** Nothing here can widen what an agent may
do — `queueMessage`'s rails are `374`'s and are untouched. What these rows protect is **an honest
account of work**: a task that exists when the child was idle as well as when it was busy (`M2`), a
number a person can quote that no later task takes (`M11`, `M12`), a state that moves only because an
event landed (`M6`-`M10`), and a crashed message that stops reading as *still waiting* (`M13`-`M17`).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M5` | ⚑ **`run_suite`** — `apps/desktop/test/a-task-you-can-see.test.ts` §0, §1, §6 |
| `M6`-`M10` | ⚑ **`run_suite`** — the same file, §1 (the fold's transitions) |
| `M11`, `M12` | ⚑ **`run_suite`** — the same file, §4 (the number) |
| `M13`-`M17` | ⚑ **`run_suite`** — the same file, §3, and `test/the-message-that-has-no-name.test.ts` §3 |
| `M18`, `M19` | ⚑ **`run_suite`** — the same file, §2, §4, §7 (the narrow read and the ordering) |
| `M20`, `M21` | ⚑ **`run_suite`** — `test/transcript.test.ts` (the row a debugger sees) |
| `M22` | ⚑ **`run_suite`** — `test/migrate.test.ts` (the migration that reaches an installed copy) |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on which PROJECT numbers a task.** The rule is *the child's*, and at this HEAD the two
readings cannot disagree: only a spawned conversation carries a `commandedBy`, and `376` made a spawn
inherit its parent's project, so a parent and its child are always in one project. §4 of the suite
pins the EQUIVALENCE and says so; a mutation here would be *"a comparison tested where both sides
agree"*, which is how three of `341`'s rows survived.

⛔ **No row on the rails.** `queueMessage` asks `374`'s `assertMayReach` before any of this, and
`374`'s own table owns every reading of it. This dispatch added no rail and moved none.

⛔ **No row on `outcome`.** There was no such field when this table was written: *"an option with no
acceptance case is a maintenance surface, not a capability."* ⚑ **`393` added it along with the only
thing that can fill it**, and put its rows in `393`'s own table — where the reply that produces an
outcome is, rather than here, where nothing does.

⛔ **No row that ADDS a generation filter to `nextTaskNumber`.** It is deliberately unscoped — a
number handed out under a superseded projection was still handed out — and a row narrowing it would
be measured only by the same fixture `M12` already owns, from the other side.

⚠️ **`M12` was rewritten after the per-row check.** It first claimed a withdrawn task's number would
be reused, and that is false: a withdrawal leaves the `task_assigned` row exactly where it is, so
`max` and `count` agree on every ledger this app can produce by itself. **The row survived**, and the
real divergence — a rebuilt generation holding every assignment twice — is what it names now. ⛔ Three
other rows survived their first check for the same class of reason and each was answered by making
the readings disagree rather than by deleting the row.

## ⚑ ANCHOR CORRECTED IN PLACE BY 494

⛔ **`selectTaskEvents`' type list gained `'user_decision'`** — the second producer of an actor for
`TaskRow.stalledBy`, and a type the fold branches on has to be a type the statement selects.
⚠️ **The rule this row restores is unchanged**; only the bytes it anchors on moved. ⚑ `494` put the
new member on its OWN line so that `491 M6`, which anchors on the last two lines and is the only row
in this set whose table has been RUN, keeps the verdict it earned — *a corrected anchor keeps a
verdict it never earned*. This table is `unrun`, so the correction costs it nothing.

## ⚠️ T-003 · after D-005a and D-013

M6's gate-map line is stale: since D-005a the queue hold keeps a WAITING task waiting without the
`working` guard, so M6 now dies on the guard's other half (a stalled task re-stalled by a later
turn nothing drove), in `state-a-supervisor-can-trust.test.ts` §3. Its *said nothing* wording is the
`silent` word `400` retired. D-013 moved the guard into `endOfDrive`.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
FOLD = "apps/desktop/src/shared/tasks.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"

MUTATIONS = [
    # ── the mint, and where it sits ───────────────────────────────────────────────────────────
    (
        "M1 · 🔴 nothing is ever recorded · neither branch of `queueMessage` calls the mint, so work "
        "given through the one verb an agent has leaves the ledger exactly as it was before this "
        "dispatch — the whole of S1 missing",
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 439** — each edit is now the line it is ABOUT and
            # not that line plus its neighbour. `439` put a sender-side receipt between the mint and
            # the return on both branches, which is exactly the appended-neighbour shape
            # `a-source-census-that-pins-a-line-kills-every-row-on-it` warns about. ⛔ The defect is
            # unchanged: neither branch mints.
            # ⚑ ANCHOR CORRECTED IN PLACE BY 687: the mint now ANSWERS the number it wrote (`678` H2, H6), so both calls
            # are bound to `numbered`. ⛔ The defect is unchanged — neither branch mints — and the
            # replacement keeps the binding so the mutant still compiles to *no task, no number*.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives on pieces: `give_work` reaches `queueAs`, and both branches must call
        # `recordTheGive` or the ledger gets no `work` row and no `work_given` event. The plant
        # removes the idle-branch call and the held-branch call, so nothing is ever recorded. Killed
        # by `a-task-you-can-see.test.ts`.
        [
            (HOST, '      if (giving !== null) this.recordTheGive(session, giving, null)\n', ''),
            (HOST, '    if (giving !== null) this.recordTheGive(session, giving, id)\n', ''),
        ],
    ),
    (
        "M2 · 🔴 only the HELD branch mints · a child that happened to be idle is given work and no "
        "task exists for it — `354`'s deliberate gap (*“no id on this branch”*) inherited by a unit "
        "of work, where it is not deliberate at all",
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 439** — see `M1`. ⚑ ANCHOR CORRECTED IN PLACE BY 687 — see `M1`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a child that happens to be idle must get a piece exactly like a held one. The
        # plant deletes only the idle-branch `recordTheGive(session, giving, null)`, leaving the
        # held branch minting. Killed by `a-task-you-can-see.test.ts`.
        [
            (HOST, '      if (giving !== null) this.recordTheGive(session, giving, null)\n', ''),
        ],
    ),
    (
        "M3 · ⛔ the task is recorded BEFORE the message it names · a crash between the two appends "
        "leaves a row on somebody's board for work that was never handed over, which is the one "
        "ordering `publishOurs`'s own rule forbids",
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 439** — see `M1`. ⚠️ **And the two edits were
            # SWAPPED**, which is the other half of the correction: the insert creates a second
            # occurrence of the line the delete names, so a delete written second would find two.
            # ⛔ Deleting first keeps every anchor unique against the tree it is measured on, and
            # the ordering this row inverts is unchanged.
            # ⚑ ANCHOR CORRECTED IN PLACE BY 687 — see `M1`: the call is bound to `numbered`, and the binding moves with it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the `work` row and its `work_given` event are recorded AFTER the
        # `message_queued` it names, so a crash between the two never leaves a piece for work never
        # handed over. The plant moves the held-branch `recordTheGive` above the `message_queued`
        # publish. Killed by `a-task-you-can-see.test.ts`.
        [
            (HOST, '    if (giving !== null) this.recordTheGive(session, giving, id)\n', ''),
            (HOST, "    this.publishOurs(session, {\n      type: 'message_queued',", "    if (giving !== null) this.recordTheGive(session, giving, id)\n    this.publishOurs(session, {\n      type: 'message_queued',"),
        ],
    ),
    (
        "M4 · ⛔ a PERSON's message mints a task · every sentence typed into the composer becomes a "
        "unit of work assigned by the conversation to itself, so the board fills with a person "
        "talking to their own agent",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a person's message mints nothing, only an agent's `give_work` does. The plant
        # makes `queueMessage` mint a `giving` under the caller's own root for a person, and
        # `Omit<TurnFacts,'giving'> & { giving?: never }` is defeated with a cast. Killed by
        # `a-task-you-can-see.test.ts`.
        [
            (HOST, '    says: AgentMessageKind = WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,\n  ): Promise<QueueOutcome> {\n', '    says: AgentMessageKind = WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,\n  ): Promise<QueueOutcome> {\n    const rootOfTheCaller = aPersonTypedIt(by) ? this.deps.store.rootOf(sessionId) : null\n    if (rootOfTheCaller !== null) {\n      const minted = this.deps.store.numberUnder(rootOfTheCaller.piece)\n      facts = {\n        ...facts,\n        giving: {\n          piece: newWorkId(),\n          parent: rootOfTheCaller.piece,\n          number: minted,\n          label: `${rootOfTheCaller.label}.${String(minted)}`,\n          giver: sessionId,\n          title: text.slice(0, 80),\n          brief: text,\n          folder: null,\n        },\n      } as never\n    }\n'),
        ],
    ),
    (
        "M5 · ⛔ a task that went straight out starts at `waiting` · the absence of a held message "
        "stops meaning *the work is already with the child*, so a running task reads as queued "
        "behind a turn that is running it",
        [
            (
                FOLD,
                "        state: messageId === null ? 'working' : 'waiting',",
                "        state: 'waiting',",
            )
        ],
    ),
    # ── the fold's transitions ────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the turn guard is gone · a task queued behind a running turn sees THAT turn's "
        "ending and is marked as having said nothing, before its own message has been sent at all",
        # ⚑ **Re-anchored by `398` and again by `400`.** `398` widened the guarded set;
        # HO-018 §2 then merged `silent` into `stalled` and gave the transition a cause, so
        # the line is one call through a helper. ⛔ The ROW is unchanged in what it does and
        # in what its sentence claims: it removes the `working` guard, so a turn's ending
        # reaches a task whose message has not been sent. Re-verified RED individually.
        # ⚑ **484 · anchor corrected, not retired.** `stall` takes the moment the observation
        # was made; the ROW still drops the `working` guard and was re-verified RED.
        # ⚑ **T-002 · re-anchored in place, not retired** — D-005a turned the guard into its
        # own `continue` line (a message waiting in the queue now holds the stall). The row
        # still drops the `working` guard. Re-verified RED alone.
        # ⚑ T-003 · re-anchored in place, not retired — D-013 moved the turn's stall loop into
        # `endOfDrive`; the row still drops the `working` guard. ⚠️ Since D-005a the queue hold
        # keeps a WAITING task waiting without it, so the row dies on the other half: a stalled task
        # re-stalled by a later turn nothing drove. Re-verified RED alone.
        [
            (FOLD, "      if (held.row.state !== 'working') continue\n", ''),
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, by a RULING.** HO-018 §2 made the `interrupted` exclusion in the turn branch
        # the wrong behaviour rather than the guard against it, so there is nothing left
        # here to put back. ⚠️ Kept in place and named by the census (142's rule); the
        # subject moved to the `400` table.
        "M7 · ⛔ an INTERRUPTION ends the delivery · pressing Stop reports the work as *said "
        "nothing*, and ending a conversation mid-task reads as silence rather than abandonment, "
        "because a close interrupts the open turn before it writes the session's own ending",
        # 🔴 **RETIRED at `400`, and by a RULING rather than by drift.** ⛔ HO-018 §2.1 removed the
        # exclusion this row put back: an interrupted turn now stalls the task on purpose, with its
        # own cause. ⚠️ The row's own sentence is what made the change safe to state — the defect it
        # described was *reporting the work as said nothing*, and the word `silent` is gone. ⚑ The
        # replacement is `400 M5`, which asserts the cause rather than the exclusion.
        [
            (
                FOLD,
                "    if (event.type === 'turn' && event.state !== 'interrupted') {",
                "    if (event.type === 'turn') {",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `400`, by a RULING.** HO-018 §2 made the terminal closing on a conversation ending
        # the wrong behaviour rather than the guard against it, so there is nothing left
        # here to put back. ⚠️ Kept in place and named by the census (142's rule); the
        # subject moved to the `400` table.
        "M8 · ⛔ the conversation's ending re-labels a task that already delivered · *“never got its "
        "chance”* and *“said nothing about it”* collapse into one word, which is the distinction S3 "
        "is going to act on",
        [
            (
                FOLD,
                # 🔴 **RETIRED at `400`, by a RULING.** ⛔ HO-018 §2.3 struck out the closing this row
                # protected the shape of: a conversation ending no longer abandons anything, so the
                # distinction the row was about — *never got its chance* against *said nothing about
                # it* — is not one this branch can collapse any more. ⚑ What replaces it is
                # `400 M8`, which puts the terminal closing back.
                "        if (\n"
                "          held.row.state === 'waiting' ||\n"
                "          held.row.state === 'working' ||\n"
                "          held.row.state === 'stalled'\n"
                "        ) {",
                "        if (held.row.state !== 'withdrawn') {",
            )
        ],
    ),
    (
        "M9 · ⛔ an ending closes whichever task is open rather than the one it NAMES · a cancel "
        "aimed at the held message takes back the running one, which is `354`'s pairing rule "
        "(*“by id and never by position”*) undone one layer up",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the fold: an unqueue names its piece by messageId and never by position
        # (`byMessage.get(event.messageId)`). The plant takes whichever piece is first in the map,
        # so a cancel aimed at one held message closes another. Killed by
        # `finished-and-finished-with-a-question.test.ts`.
        [
            (FOLD, '      const piece = byMessage.get(event.messageId)\n', '      const piece = [...byMessage.values()][0]\n'),
        ],
    ),
    (
        "M10 · ⛔ an OPEN task is stamped with an ending · `endedAt` stops meaning *this closed* and "
        "starts meaning *something last happened to it*, so `silent` — the state S2 and S3 exist to "
        "resolve — reads as finished",
        [
            (
                FOLD,
                "    const endedAt = TASK_IS_OPEN[state] ? held.row.endedAt : at",
                "    const endedAt = at",
            )
        ],
    ),
    # ── the number ────────────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 the number is app-global · every project allocates out of the default project's "
        "counter, so a second project's first task is numbered after every task and every document "
        "in the first, and the sequence a person quotes is not the project's",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives as the numbering scope: a give is numbered under its PARENT's own sequence
        # (`work_sequence(parent.id)`), so `W1.1` and `W2.1` both exist. The plant sends every
        # parent's numbers through the one `ROOTS_SCOPE` counter that also numbers roots. Killed by
        # `one-number-a-person-can-quote.test.ts`, `a-task-you-can-see.test.ts`.
        [
            (STORE, '  const numberUnderTx = db.transaction((parent: string): number => bumpSequence(parent))', '  const numberUnderTx = db.transaction((_parent: string): number => bumpSequence(ROOTS_SCOPE))'),
        ],
    ),
    (
        "M12 · 🔴 the task keeps its OWN stream, read off the ledger · `383` merged `380` into this "
        "tree and one counter now serves both subjects — put the ledger maximum back and a number "
        "consumed by a registration that failed is handed out again, to a task, so `#1` names two "
        "things a person can quote",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the number is a COUNTER (`work_sequence`), not the maximum over surviving rows,
        # so a number taken and never used is burned and never handed out twice. The plant reads
        # `max(number)` from the `work` table under the parent, which cannot see a number that left
        # no row. Killed by `one-number-a-person-can-quote.test.ts`, `a-task-you-can-see.test.ts`.
        [
            (STORE, '  const numberUnderTx = db.transaction((parent: string): number => bumpSequence(parent))', "  const numberUnderTx = db.transaction(\n    (parent: string): number =>\n      ((\n        db.prepare('SELECT max(number) AS highest FROM work WHERE parent_id = ?').get(parent) as\n          | { highest: number | null }\n          | undefined\n      )?.highest ?? 0) + 1,\n  )"),
        ],
    ),
    # ── the repair a crash needs ──────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 the launch does not repair a stranded message · a task held when the power went "
        "out reads *waiting* for the life of the row, for a message nothing is holding and nothing "
        "will ever send — `354`'s measured gap, left open",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — settleStrandedMessages
        # gained a third `messagesSkipped` argument and its console line moved into sayTheSweep, but
        # it is still called exactly once at launch and its return still drives the same
        # held/waiting-task repair. Hardcoding waiting=0 still removes the repair entirely, leaving
        # a message nothing is holding read as 'still waiting' forever, matching `354`'s gap.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The launch-time repair of
        # stranded messages is still one line assigning `waiting`; D-017 R3 only changed which set
        # of sessions is exempted (`stillOpen` now also excludes what a quit left open, since those
        # are handled by the next start rather than by this sweep). Stubbing the call to `0` still
        # means a crash-held message is never repaired, which the same crash-recovery tests catch.
        [
            (HOST, '    const waiting = this.deps.store.settleStrandedMessages(this.now(), stillOpen, messagesSkipped)', '    const waiting = 0'),
        ],
    ),
    (
        "M14 · ⛔ the repair ignores what another live host holds · a second store opened over the "
        "same database writes an ending for a message the first host is about to send, which is the "
        "symptom `198` predicted for `settleOrphanRuns` one column over",
        [
            (
                STORE,
                "        if (running.has(held.session_id)) continue\n",
                "",
            )
        ],
    ),
    (
        "M15 · ⛔ the repair settles a message that has no NAME · a `message_queued` written before "
        "`354` is given an ending that cannot belong to it, joining two messages that are not the "
        "same message · killed by `a-task-you-can-see.test.ts`",
        [
            (
                STORE,
                # ⚑ 676 · anchor CORRECTED, not retired: the name test sits behind `json_valid` now
                # (a torn row raised the launch); dropping it is still *settle a nameless message*.
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still lets a held message with no id through, so the repair writes an ending that cannot belong to it
                "        if (one.type !== 'message_queued' || one.valid !== 1 || one.message_id === null) continue\n",
                "        if (one.type !== 'message_queued' || one.valid !== 1) continue\n",
            )
        ],
    ),
    (
        "M16 · ⛔ the repair says the message was CANCELLED · nobody chose this, and the transcript "
        "reports the app's own crash as the person taking their message back",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The M16 defect (the
        # crash-repair sweep writing reason 'cancelled' instead of 'abandoned') still lives at the
        # same statement. D-017 wrapped the per-ledger loop in a try/catch ('the outer net'),
        # shifting this line from 12 to 14 spaces indent and appending trailing prose to the
        # neighbouring comment, so the old byte-exact anchor no longer matches; the rule is
        # untouched.
        [
            (STORE, "              reason: 'abandoned',\n              // ⚠️ **The text is repeated because the ending is read on its own** (054 pages the", "              reason: 'cancelled',\n              // ⚠️ **The text is repeated because the ending is read on its own** (054 pages the"),
        ],
    ),
    (
        "M17 · ⛔ the repair drops its `detail` · the bubble falls back to `abandoned`'s built-in "
        "sentence — *“the conversation ended underneath it”* — about a conversation that did not "
        "end, which is `216`'s rule that a bare reason must not say something untrue",
        [
            (
                STORE,
                "            detail: 'the app stopped while this message was still waiting to be sent',\n",
                "",
            )
        ],
    ),
    # ── the reads ─────────────────────────────────────────────────────────────────────────────
    (
        "M18 · ⛔ the narrow read drops `status` · every event the fold acts on has to be SELECTED, "
        "and a conversation's own ending stops reaching the derivation — so a task abandoned by a "
        "closing session reads as running, on the replayed path only. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
                # ⚠️ **Anchor moved by `393`, and re-verified rather than assumed.** S2 added
                # `task_replied` to the fold and to this statement in the same commit — which is what
                # this row's own sentence says has to happen. ⛔ The row is unchanged in what it
                # does: it drops `status`, so a task abandoned by a closing session reads as running.
                # ⚑ **Re-anchored by `398`**, which added `work_quiet` to the list and
                # wrapped it across two lines. ⛔ The ROW is unchanged: it still drops `status`, so a
                # task abandoned by a closing session reads as running on the replayed path.
                # ⚑ **Re-anchored by `400`**, which retired `work_quiet` and added three types.
                # ⛔ The ROW is unchanged: it still drops `status`, so a task whose conversation
                # ended reads as running on the replayed path. Re-verified RED individually.
                # ⚑ **Re-anchored by `429`**, which added `task_withdrawn` to the fold and to this
                # statement in the same commit. ⛔ The ROW is unchanged: it still drops `status`, so a
                # task whose conversation ended reads as running on the replayed path. Re-verified
                # RED individually.
                # ⚑ Re-anchored by `491`, which added `user_turn`; the row still removes only
                # `status`.
                # ⚑ Re-anchored by `724` (R84), which added `reply_undelivered` on its own line after `reopened`; the row is unchanged.
                # ⚑ **T-002 · re-anchored in place, not retired** — D-005a added `message_queued` to the list on a line of its own; the row still drops the same type. Re-verified RED alone.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The shared
        # `selectTaskEvents` IN-list this row drops `'status'` from is untouched in rule by this
        # commit; the only reason the byte-for-byte anchor went dark is that D-017 · R10 inserted a
        # new `'replaced_by',` line into the SAME list (for the could-not-be-reopened stall).
        # Re-including that added line restores an exact, unique match; dropping `'status'` still
        # plants the same replayed-path defect.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: every event type the fold acts on must be in `selectPieceEvents`' narrow `type
        # IN (...)` list, and the fold still folds `status` (a conversation's own ending). The plant
        # drops `'status'` from the list. Killed by `a-task-you-can-see.test.ts`.
        [
            (STORE, "'user_turn', 'turn', 'status', 'work_interrupted', 'background_work',", "'user_turn', 'turn', 'work_interrupted', 'background_work',"),
        ],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-giver-reads-its-tasks-back-in-the-order-they-were-numbered.test.ts` (the landing added
        # it; no existing test observed this plant).
        "M19 · ⛔ a project's tasks come back in whatever order the conversations were visited in · "
        "the list stops being the sequence a person quotes and becomes an accident of which child "
        "was created first",
                # ⚑ 676 · anchor CORRECTED, not retired: the fold now takes the answer's unread note.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives in tasksAssignedBySession (session-store.ts:7954-7959,
        # behind the store's tasksAssignedBy and list_tasks' assigned half). Its candidate query is
        # a DISTINCT scan of events_task_assigned_idx with no ORDER BY, so the sort is what makes
        # the list ordered. NO EXISTING TEST KILLS THIS PLANT: the only pin, 'tasksIn is ordered by
        # the NUMBER', went with tasksIn, and every current fixture has one task per child or
        # numbers that agree with candidate order. A new test is needed in
        # the-work-this-conversation-gave-out.test.ts, which already has the
        # spawn-two-workers-and-withdraw idiom. The pm gives work to A (#1), A replies done, the pm
        # gives work to B (#2), then to A again (#3); assert st
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `piecesGivenBySession` returns a giver's pieces in the order they were given,
        # whatever order the ledger visits the conversations in. The plant drops the `.sort(...)`
        # after the giver filter. Killed by
        # `a-giver-reads-its-tasks-back-in-the-order-they-were-numbered.test.ts`.
        [
            (STORE, '      .filter((piece) => piece.giver === giver)\n      .sort((left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1))\n', '      .filter((piece) => piece.giver === giver)\n'),
        ],
    ),
    # ── what a debugger sees ──────────────────────────────────────────────────────────────────
    (
        "M20 · ⛔ the raw stream says nothing about the row · the Events tab filters nothing and is "
        "the only surface this event has, so an empty line there makes a task invisible to the one "
        "reader it was left visible for",
                # ⚑ **705 · re-anchored in place, not retired** — R38 spelled the number *Task #3 in
                # world-clock* (`taskCalledIn`); the row still empties the line.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The Events-tab line for
        # `task_assigned` still exists and must not be empty. Only its spelling changed: it now
        # reads `taskCalled(event.number)` and no longer has the project. The plant blanks the arm.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the raw Events tab is the only surface for a `work_given` event, so
        # `describeEvent` must say something for it (label, id, title, giver, sent or held). The
        # plant makes that arm return an empty string. Killed by
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`, `transcript.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the raw Events tab is the only surface for a
        # `work_given` event, so `describeEvent` must say something for it. The arm now has a
        # `givenBy === null` branch ('taken on for a person') and the sent/held word, and the plant
        # returns an empty string for the whole arm. Killed by
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`, `transcript.test.ts`.
        [
            (DESCRIBE, "    case 'work_given':\n      if (event.givenBy === null)\n        return `${event.label} · ${event.piece} · ${event.title} · taken on for a person (ours)`\n      return `${event.label} · ${event.piece} · ${event.title} · given by ${event.givenBy} · ${\n        event.messageId === undefined ? 'sent' : 'held'\n      } (ours)`\n", "    case 'work_given':\n      return ''\n"),
        ],
    ),
    (
        "M21 · ⛔ the task draws itself into the CONVERSATION · the message it names is already "
        "there, so one piece of work appears twice in the one surface meant to read like a "
        "conversation",
        # ⚑ **474 moved the anchor and not the rule** — the case now records the number a
        # `question_asked` notice needs and STILL draws no item, which is exactly what this row
        # deletes. ⛔ Corrected in place rather than retired: it protects the same sentence.
        #
        # ⚑ **537 moved it again, and again only the bytes** — the arm now also stamps the number
        # onto the HELD ROW the assignment names, and still draws no item of its own. ⛔ **Second
        # correction, same defect, same sentence** (`correct-a-stale-mutation-anchor-dont-retire-it`),
        # and the row was re-verified RED alone on the corrected bytes rather than inheriting a
        # verdict it never earned.
        #
        # ⚠️ **The anchor is the SHORTEST span the defect needs**, so a third dispatch adding a
        # statement to this arm moves it a third time only if it edits these two lines. `537`'s own
        # `M1` deletes the lines below them, which is why they are not in here.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a `work_given` event must not draw a second item in the conversation, because
        # the message it names is already there as a queued or user item. The plant pushes a
        # `queued` item from the brief in the `work_given` arm. Killed by `transcript.test.ts`.
        [
            (TRANSCRIPT, "    case 'work_given': {\n      if (!isAnId(event.piece) || !isALabel(event.label)) return\n", "    case 'work_given': {\n      closeStreaming(state)\n      state.items.push({\n        kind: 'queued',\n        id: nextId(state, 'queued'),\n        text: event.brief,\n        outcome: null,\n      })\n      if (!isAnId(event.piece) || !isALabel(event.label)) return\n"),
        ],
    ),
    # ── the migration that has to reach an installed copy ─────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the `when`
        # stamp of the old 0022/0023 migration in the drizzle journal, and 5e931be8 replaced all of
        # them: "The database is ONE migration, 0000_the_tree, on a fresh file only".
        # `_journal.json` now holds a single entry, so there is no stamp ordering left to get wrong
        # and no installed database to strand. Its anchor is left stale, so the census records it
        # retired.
        "M22 · 🔴 the journal keeps the stamp `drizzle-kit generate` wrote · `383` renumbered this "
        "migration to `0023` and generation stamped it EARLIER than `0022`'s, and drizzle applies a "
        "file only while the last applied stamp is lower — so the index exists on a fresh database "
        "and on no installed one, with no error anywhere",
        [(JOURNAL, '"when": 1789150791316', '"when": 1788829602807')],
    ),
]
