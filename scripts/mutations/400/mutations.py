"""400 · never close what you did not see finish — each row is THE DEFECT, put back (131).

🔴 **One principle, three amended criteria.** HO-018 §2: *"the engine never terminally closes work it
did not observe finishing. It records what it observed, surfaces it, and the parent decides."* ⛔ Its
§3 says why all three had to move together: *"three of my fifteen criteria specified a MECHANISM where
they should have specified a PROPERTY."*

⚑ **Every row below is that principle broken in one specific place** — either something the engine
watched is not recorded, or something it did not watch is treated as an ending.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M4` | ⚑ **`run_suite`** — `apps/desktop/test/never-close-what-you-did-not-see-finish.test.ts` §1 |
| `M5`–`M9` | ⚑ **`run_suite`** — the same file's §2, and `a-task-you-can-see.test.ts` §1 |
| `M10`–`M14` | ⚑ **`run_suite`** — the same file's §3 and §5, and `a-reply-and-its-absence.test.ts` §6 |
| `M15`–`M18` | ⚑ **`run_suite`** — the same file's §4 and §6 |

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting the PUSH.** ⚠️ `M9` is the row that reaches it, and it is about the mailbox KIND
rather than about the call: a notice that takes the `work` slot is refused by criterion 13's singleton
exactly when the parent is busiest, which is criterion 4 failing silently. ⚑ Removing the call itself
would be a row whose defect is *the feature is not built*, which `M1` already is one layer down.

⛔ **No row on the de-duplicator.** `HostedSession.toldAboutStall` decides how often a parent hears
about work it has already been told about; a row there records as a survivor unless a test pins a
count, and the count it would pin is a judgement rather than a property.

⛔ **No row on `settleStrandedRequests`, `settleStrandedMessages` or `settleOrphanRuns`.** `396` and
`379` own them, and what `400` changes about them is only where the new sweep stands relative to them
— which is `M12`.

⛔ **No row inverting `REQUEST_IS_OPEN.abandoned`.** HO-018 §4: *"do not touch the request one, and
assert that you did not."* ⚑ That vocabulary is `394`/`396`/`397`'s, and asserting the negative is
`never-close-what-you-did-not-see-finish.test.ts` §1's job rather than a mutation's.

## ⚠️ Rows this table does not contain because their defect is UNREACHABLE

⛔ **No row removing the `travelled` gate in the fold measured end to end from a live app.** A worker
parked on a permission card has a permission-shaped routing open at every crash, so the gate is
reachable — but a row that only ever met a ledger with one kind of routing would be measured where
both readings agree. ⚑ `M15` is that gate, and §6's PURE fold reaches it the only way that diverges:
one planted routing that travelled and one control with it removed.

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
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
RESTART_APPEND = (
        "        appendTx(\n"
        "          worker.id,\n"
        "          (max?.max_ordinal ?? -1) + 1,\n"
        "          { type: 'work_restarted' },\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the word, and the two vocabularies staying two ───────────────────────────────────
    (
        "M1 · 🔴 nothing is ever written about work a restart left undriven · the launch finds a task "
        "whose child was mid-turn when the app died and says nothing at all, which is criterion 14 "
        "exactly as unbuilt as `379` and `396` left it — `settleOrphanRuns` closes the turn ROW and "
        "appends no event, so the fold reads `working` for the life of the row",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The launch sweep
        # (settleRestartedWorkTx) still needs to append a work_restarted event for undriven work;
        # today's code does this correctly. D-017 wrapped the loop body in a try/catch, adding two
        # spaces of indent to the appendTx call, so the old anchor (built for the un-wrapped
        # indentation) no longer matches. Re-anchored as a clean no-op guard rather than reproducing
        # the old comma-expression trick, since the label only requires that nothing is written.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the restart sweep (`settleRestartedWorkTx`) must append a `work_restarted` event
        # for owners of given pieces, or the fold reads `working` for a child the app killed. The
        # plant disables the append with `if (false)`. A comment now sits between the ordinal
        # argument and the event object, so the anchor is the three code lines that open the call.
        # Killed by `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`.
        [
            (STORE, '          appendTx(\n            worker.id,\n            (max?.max_ordinal ?? -1) + 1,\n', '          if (false) appendTx(\n            worker.id,\n            (max?.max_ordinal ?? -1) + 1,\n'),
        ],
    ),
    (
        "M2 · ⛔ `stalled` is CLOSED · a turn ending, a Stop or a restart terminally ends the work, so "
        "the reply a child is about to write meets `393`'s permanent refusal — HO-018 §2.1 took this "
        "entry explicitly, and this is the one table cell that puts the other reading back",
        [(TASKS, "  stalled: true,", "  stalled: false,")],
    ),
    (
        "M3 · 🔴 the cause is written independently of the state · `settle` stops clearing it, so a "
        "task that was answered or taken back keeps saying why it had stopped being driven — a "
        "sentence beside a state, free to disagree with it, which is the whole shape the invariant "
        "*non-null if and only if `stalled`* exists to make unreachable",
                # ⚑ **484 · anchor corrected, not retired.** `settle` gained two more fields to clear when
                # the fold started recording WHEN a stall was observed and WHO asked for it. ⛔ The ROW is
                # unchanged and was re-verified RED individually.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the stall cause is non-null if and only if the piece is `stalled`. In
        # derivePieces the `settle` helper clears `stalledBecause`, `stalledAt` and `stalledBy`, so
        # the plant stops it clearing the cause. A piece that was answered or taken back keeps
        # saying why it had stopped being driven. Killed by
        # `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`,
        # `a-reply-and-its-absence.test.ts`.
        [
            (TASKS, '      state,\n      endedAt,\n      stalledBecause: null,\n', '      state,\n      endedAt,\n'),
        ],
    ),
    (
        "M4 · ⛔ a stall is stamped as an ENDING · `stalled` carries an `endedAt`, so every reader that "
        "asks *has this closed?* by looking for a moment rather than at the table gets the opposite "
        "answer — and the two readings of one row disagree",
        [
            (
                TASKS,
                # ⚑ **484 · anchor corrected, not retired.** `stall` now writes the moment and the actor
                # beside the cause; the ROW still stamps an open task as ended and was re-verified RED.
                "      endedAt: null,\n      stalledBecause: cause,\n",
                "      endedAt: at,\n      stalledBecause: cause,\n",
            )
        ],
    ),
    # ── §2 · criterion 4 · the observation, and the parent being told ──────────────────────────
    (
        "M5 · 🔴 an interrupted turn is excluded again · pressing Stop leaves the work reading "
        "`working` for ever with nobody told, which is `393`'s exclusion restored after HO-018 §2.1 "
        "removed it — the ruling was about the WORD and this puts the behaviour back",
        # ⚑ T-003 · re-anchored in place, not retired — D-013 folded the cause choice into
        # `endOfDrive(interrupted, at)`; the row still excludes an interrupted turn from the stall.
        # Re-verified RED alone.
        [
            # ⚑ **F074 · re-anchored in place, not retired** — F074 added the usage limit's cause to the choice; the row still excludes an interrupted turn from the stall.
            # ⚑ **the refused bill · re-anchored in place, not retired** — the turn branch chooses a fifth word now, a refused bill; the row still drops the interrupted turn's stall
            (TASKS, "    const cause: TaskStallCause = interrupted\n      ? 'turn_interrupted'\n      : limit !== undefined\n        ? 'provider_limited'\n        : billingRefused\n          ? 'billing_refused'\n          : 'turn_ended'\n", "    if (interrupted) return\n    const cause: TaskStallCause =\n      limit !== undefined ? 'provider_limited' : billingRefused ? 'billing_refused' : 'turn_ended'\n"),
        ],
    ),
    (
        "M6 · ⛔ the parent is never told · the condition is recorded and surfaced and nothing is "
        "pushed at anybody, so criterion 4 is back to *visible to a poll* — which HO-018 §2.1 says is "
        "not what the criterion was for: **nobody waits forever in silence**",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 hands the push the holder's id (a closing has no session to hand in); the row still removes the pump's trigger. The DEFECT this row plants is unchanged.
        [
            (
                HOST,
                "    if (event.type === 'turn' || event.type === 'status') {\n      this.tellWhoeverGaveTheWork(session.id)\n",
                "    if (event.type === 'turn' || event.type === 'status') {\n",
            )
        ],
    ),
    (
        "M7 · ⛔ every restart re-tells the parent · a slot seeded EMPTY reports work a previous life "
        "of the app had already stalled, so how often a parent hears about one piece of work becomes "
        "a function of how often somebody reopened the app rather than of anything the work did",
        # ⚠️ **TWO earlier `M7`s died of the same disease and both were found by this verification.**
        # The first removed a prune from `toldAboutStall` — unreachable, because `deriveTasks` has no
        # way back from `stalled`. The second removed a `TASK_STALL_IS_PUSHED` guard — also
        # unreachable, because every cause it refused arrives outside the pump the push hangs off.
        # ⛔ **Both lines were DELETED rather than the rows weakened**
        # (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`), and this is the third try: a seed
        # that is genuinely load-bearing, on a path a resume really walks.
                # ⚑ **Anchor CORRECTED by `404`, not retired** — that dispatch re-expressed the
                # seed, reading the conversation's own `work_reported` rows instead of the child's
                # task rows, and the rule this row carries is untouched: *seeded empty, a parent
                # hears about one piece of work once per launch for ever*.
                # ⛔ Re-verified RED against this table's own file at the commit that moved it —
                # `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
                #
                # ⚑ **Corrected again by `661`, not retired** — the seed became a MAP from task to the
                # cause last reported (`656` F4 needs *what* a parent was told, for one comparison),
                # and the rule is the same one: seeded empty, every launch re-tells. ⛔ Re-verified
                # RED against this table's own file at the commit that moved it.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule holds: a slot seeded empty re-tells a parent of every stall a previous life
        # already reported, so how often a parent hears about one piece depends on how often the app
        # was reopened. The seed is still built from the parent's own ledger in registration, but
        # `toldAboutStall` is a `Set<string>` again (D-016c dropped the per-cause Map), so the plant
        # seeds an empty Set. Killed by `never-close-what-you-did-not-see-finish.test.ts`.
        [
            (HOST, '      toldAboutStall: new Set(alreadyTold),\n', '      toldAboutStall: new Set<string>(),\n'),
        ],
    ),
    (
        "M8 · 🔴 a conversation ending ABANDONS its open work · `379`'s closing restored, and it is the "
        "single thing HO-018 §2.3 struck out: *nothing about a quit tells us the work failed* — a quit "
        "ends every conversation, so this is every task that was running when somebody closed the app",
                # ⚠️ **Anchor corrected at `648`, not retired.** ⛔ That dispatch split this line in
                # two — the open-state guard became a `continue` and the displaced stall is
                # snapshotted above the call — so the one-line anchor stopped applying while the
                # SUBJECT stayed exactly where it was: *a conversation ending stalls its open work*.
                # ⚑ **The replacement is unchanged**, because the defect this row measures is the
                # same one `379` shipped and HO-018 §2.3 struck out — the guard above it decides
                # WHICH tasks, and this call decides what happens to them.
                # `correct-a-stale-mutation-anchor-dont-retire-it`, and the table is `unrun`, so no
                # verdict is inherited; re-verified RED by hand against `400`'s own killer.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a conversation ending must not abandon its open work (HO-018 §2.3: nothing about
        # a quit tells us the work failed). In the fold, the ended/errored `status` arm calls
        # `stall(piece, 'conversation_ended', ...)`, and the plant settles the piece as `withdrawn`
        # instead. Every piece held by a conversation that ends is then closed. Killed by
        # `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`,
        # `a-reply-and-its-absence.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule survives: a conversation ending must not close its open work (HO-018 §2.3,
        # nothing about a quit says the work failed). D-016c removed the `stall(piece,
        # 'conversation_ended', ...)` call, so the ended/errored `status` arm now ends the drive
        # with `if (driving || aTurnIsOpen) endOfDrive(true, entry.at)`. The plant replaces that
        # with a settle of every open piece as `withdrawn`, which is the closing `379` shipped.
        # Killed by `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`.
        [
            (TASKS, '      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)\n', "      for (const [piece] of [...open]) settle(piece, 'withdrawn', entry.at)\n"),
        ],
    ),
    (
        "M9 · ⛔ the notice asks for the WORK slot · a parent already holding a queued work message "
        "refuses it under criterion 13's singleton, so the one moment a parent most needs telling is "
        "the one moment it is not told — a shared gate loosened for one caller pointed the other way",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected at `406`, not retired.** That dispatch added a sixth argument
                # to this call — the facts a parent's row is drawn from — so the old anchor stopped
                # applying. ⛔ **And the replacement had to change with it**: the row used to OMIT
                # the argument and let the default supply `'work'`, which with a sixth positional
                # argument present would shift the report into the `kind` slot and measure two
                # defects at once (found reviewing `406`'s own diff). ⚑ Naming `'work'` outright
                # is the same defect with nothing else moving. `correct-a-stale-mutation-anchor-
                # dont-retire-it`, and the table was `unrun`, so no verdict is inherited.
                "        [],\n        'notice',\n        // ⚑ **The same facts",
                "        [],\n        'work',\n        // ⚑ **The same facts",
            )
        ],
    ),
    # ── §3 · criterion 14 · the restart ────────────────────────────────────────────────────────
    (
        "M10 · 🔴 the LAUNCH sweep writes into a ledger the host is running · `HostedSession.ordinal` "
        "is the host's own counter, so the append collides on `unique(session_id, generation, "
        "ordinal)`, `record()` marks the conversation as no longer recorded, and every later durable "
        "event of a conversation somebody is having is dropped — silently",
        [(STORE, "        if (running.has(worker.id)) continue\n", "")],
    ),
    (
        "M11 · ⛔ the sweep writes for work it has already spoken about · a task already `stalled` gets "
        "a second row at every launch for the rest of its life, so the ledger fills with the app "
        "saying *it started again* — and the guard that is missing is also the whole of the sweep's "
        "idempotence · killed by `never-close-what-you-did-not-see-finish.test.ts` (named by W4.78)",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The idempotence guard
        # (only 'waiting'/'working' tasks count as undriven) still stands in settleRestartedWorkTx;
        # D-017 only added the unread?.in(worker.id) argument to tasksOfSession and reindented the
        # block inside its new try/catch, so the old literal no longer matches. Re-anchored with the
        # same replacement shape (drop the state filter, use length > 0) against the current call
        # signature.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the restart sweep writes only for pieces still `waiting` or `working`, which is
        # its whole idempotence. The guard in `settleRestartedWorkTx` filters on `piece.state ===
        # 'waiting' || piece.state === 'working'`, and the plant lets every piece through. A stalled
        # piece then gets a second `work_restarted` row at every launch. Killed by
        # `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`,
        # `a-reply-and-its-absence.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — the sweep's filter predicate moved onto its own line; same guard (never `stalled`).
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the sweep also judges a piece parked on purpose by the state under its mark, and the filter is three lines now; the same mutation on it. NOT VERIFIED
            (STORE, "            (piece) =>\n              piece.state === 'waiting' ||\n              piece.state === 'working' ||\n              piece.parkedOver === 'working',\n", "            () => true,\n"),
        ],
    ),
    (
        "M12 · ⛔ the restart sweep runs BEFORE the message repair · `settleStrandedMessages` stalls a "
        "held task on its own row, so running first means one restart is written down twice — two "
        "rows and two causes for one fact, and the second one arrives to say nothing new · killed by `never-close-what-you-did-not-see-finish.test.ts` (named by W4.78)",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The five launch repairs
        # kept their relative order under D-017 (only skip-counting was threaded in); the comment
        # and never-close-what-you-did-not-see-finish.test.ts §5 still assert settleRestartedWork
        # runs strictly after settleOrphanRuns/settleStrandedMessages/settleStrandedRequests. Moving
        # the (now sayTheSweep-wrapped) settleRestartedWork block to run before clearOrphanBuilds
        # still plants the same ordering defect: the restart sweep runs first and a restart gets
        # written down twice.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the restart sweep must run after the message and request repairs, because a
        # stranded message already stalls the piece it names. In the host's launch repairs,
        # `settleRestartedWork` (with its `sayTheSweep` block, now worded `pieces: ...`) sits after
        # `settleStrandedMessages`, `settleStrandedRequests` and `settleOrphanRuns`. The plant
        # removes that block and re-inserts it before `clearOrphanBuilds`, which is earlier than all
        # three. `elsewhere`, `rowsUnreadOnce` and `sayTheSweep` are all defined before that point,
        # so nothing throws. Killed by `never-close-what-you-did-not-see-finish.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 8d277ff5 split the call over lines and added the wokenForAJob/diedInTheBackground arguments and their setup inside the block; edit 0 removes the undrivenSkipped declaration, the call and its sayTheSweep but keeps listening/wokenForAJob/diedInTheBackground (used below), so edit 1's unchanged insert (3-arg call before clearOrphanBuilds; the two extra params are optional) declares undrivenSkipped once and the run order is inverted again. Side effect: the early call no longer passes wokenForAJob/diedInTheBackground. Killer: §5 'the restart sweep runs LAST' (source-order census).
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 47b2f891 added the once-per-launch schedule read between the listening check and the wake-up question; edit 0 still lifts the restart sweep out of its place after the message repair (edit 1, unchanged, puts it back before the orphan-build clear).
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The launch comments changed in f3c90bc59 and continuations added an exemption. Move the same work sweep before the message repair, with every current exemption preserved. Its pre-orphan crash snapshot moves with it so no uninitialized local is read.
            ("apps/desktop/src/main/runtime/runtime-host.ts", "    const undrivenSkipped = rowsUnreadOnce()\n    // 🔴 **Work its owner's scheduled job will drive is not stalled by the restart**: the wake-up\n    // armed below starts the owner for that job, so the work reads `working`, as before the restart.\n    // ⚑ Asked before the sweep, by the same rule the wake-up is armed by ({@link planItsWake}).\n    // ⚑ **Whether anybody listens** — the one read the launch makes, for its wake-ups below too.\n    const listening = this.deps.statesMoved !== undefined\n    // Each conversation's newest schedule, read once for the launch — it scans every ledger — and\n    // used twice: for who a wake-up will start, then to arm the wake-ups. Nothing in between writes\n    // a schedule or a compaction.\n    const levels = listening ? this.theScheduleLevelsAtTheLaunch() : null\n    const wokenForAJob = this.whoAWakeUpWillStartForAJob(elsewhere, levels)\n    for (const one of wokenForAJob) this.notStalledAtTheLaunch.add(one)\n    // ⚑ …and the owners whose work it does stall while that work waited on background work a crash\n    // killed — a crash leaves no ending in the ledger, so the sweep is where they are found.\n    const diedInTheBackground = new Set<string>()\n    // 🔴 **…and none of the work a continuation of its cut turn will drive** ({@link theCutsToContinue}).\n    // ⛔ Nobody listening, nothing continued, so nothing is spared.\n    const continuing = listening\n      ? this.theCutsToContinue(leftRunning, launchedAt)\n      : new Set<string>()\n    const undriven = this.deps.store.settleRestartedWork(\n      this.now(),\n      elsewhere,\n      undrivenSkipped,\n      wokenForAJob,\n      diedInTheBackground,\n      continuing,\n    )\n    sayTheSweep(\n      undriven,\n      undrivenSkipped,\n      `pieces: ${undriven} conversation(s) held work a previous run did not finish`,\n    )\n", ""),
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The launch comments changed in f3c90bc59 and continuations added an exemption. Move the same work sweep before the message repair, with every current exemption preserved. Its pre-orphan crash snapshot moves with it so no uninitialized local is read.
            ("apps/desktop/src/main/runtime/runtime-host.ts", "    const orphans = this.deps.store.clearOrphanBuilds(elsewhere)\n", "    const leftRunning = this.whatACrashLeftRunning(elsewhere)\n    const undrivenSkipped = rowsUnreadOnce()\n    // 🔴 **Work its owner's scheduled job will drive is not stalled by the restart**: the wake-up\n    // armed below starts the owner for that job, so the work reads `working`, as before the restart.\n    // ⚑ Asked before the sweep, by the same rule the wake-up is armed by ({@link planItsWake}).\n    // ⚑ **Whether anybody listens** — the one read the launch makes, for its wake-ups below too.\n    const listening = this.deps.statesMoved !== undefined\n    // Each conversation's newest schedule, read once for the launch — it scans every ledger — and\n    // used twice: for who a wake-up will start, then to arm the wake-ups. Nothing in between writes\n    // a schedule or a compaction.\n    const levels = listening ? this.theScheduleLevelsAtTheLaunch() : null\n    const wokenForAJob = this.whoAWakeUpWillStartForAJob(elsewhere, levels)\n    for (const one of wokenForAJob) this.notStalledAtTheLaunch.add(one)\n    // ⚑ …and the owners whose work it does stall while that work waited on background work a crash\n    // killed — a crash leaves no ending in the ledger, so the sweep is where they are found.\n    const diedInTheBackground = new Set<string>()\n    // 🔴 **…and none of the work a continuation of its cut turn will drive** ({@link theCutsToContinue}).\n    // ⛔ Nobody listening, nothing continued, so nothing is spared.\n    const continuing = listening\n      ? this.theCutsToContinue(leftRunning, launchedAt)\n      : new Set<string>()\n    const undriven = this.deps.store.settleRestartedWork(\n      this.now(),\n      elsewhere,\n      undrivenSkipped,\n      wokenForAJob,\n      diedInTheBackground,\n      continuing,\n    )\n    sayTheSweep(\n      undriven,\n      undrivenSkipped,\n      `pieces: ${undriven} conversation(s) held work a previous run did not finish`,\n    )\n    const orphans = this.deps.store.clearOrphanBuilds(elsewhere)\n"),
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The launch comments changed in f3c90bc59 and continuations added an exemption. Move the same work sweep before the message repair, with every current exemption preserved. Its pre-orphan crash snapshot moves with it so no uninitialized local is read.
            ("apps/desktop/src/main/runtime/runtime-host.ts", "    const leftRunning = this.whatACrashLeftRunning(elsewhere)\n    const stranded = this.deps.store.settleOrphanRuns(this.now(), elsewhere)\n", "    const stranded = this.deps.store.settleOrphanRuns(this.now(), elsewhere)\n"),
        ],
    ),
    (
        "M13 · ⛔ a held message that never went ENDS its task · `379`'s terminal closing restored on "
        "the sibling half of the same restart, and the work was never even handed over — so the "
        "parent is told the work is over about a message the child never saw",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a held message that never went stalls its piece (`message_never_sent`) and does
        # not end it, since the work was never even handed over. In the fold, the `message_unqueued`
        # arm calls `stall(piece, 'message_never_sent', ...)`, and the plant settles the piece as
        # `withdrawn` instead. The parent is then told the work is over about a message the child
        # never saw. Killed by `never-close-what-you-did-not-see-finish.test.ts`,
        # `a-task-you-can-see.test.ts`, `a-reply-and-its-absence.test.ts`.
        [
            (TASKS, "      stall(piece, 'message_never_sent', entry.at)\n", "      settle(piece, 'withdrawn', entry.at)\n"),
        ],
    ),
    (
        "M14 · ⚠️ the notice does not name the work · a parent with three children is told that "
        "something stopped being driven and cannot tell which, so the message it is pushed is not "
        "actionable and `list_tasks` is the only real answer — which is the poll HO-018 §2.1 says is "
        "not enough",
                # ⚑ **RE-POINTED at 624, not retired** — the line lost both ids and gained the
                # agent's NAME (`HO-095` §5.3: *"That is Ada. Say Ada."*), and it now fits on one
                # line. ⛔ The row's subject is unchanged and its defect is the same: the notice
                # stops naming WHICH work, so a parent with three children cannot act on it.
                # `correct-a-stale-mutation-anchor-dont-retire-it`. ⚑ **705 · and again**: the
                # number is asked of `taskCalled` now (R38), the same words.
                # ⚑ **707 · re-anchored in place, not retired** — R40 spells the task for its reader (`taskCalledFrom`); the row still drops the task from the notice.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: the
        # undriven notice must name which work it is about. The header line is now
        # `${taskCalled(task.number)} with ${holder} ...`, because the readers' project argument is
        # gone. The trailing `list_tasks` line is unchanged. The plant keeps both halves, dropping
        # the task number and the quoted task id.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the notice that work is not being driven must name the piece, so a parent with
        # several children can tell which one (HO-018 §2.1). In reply-rails.ts the undriven notice
        # names the piece with `pieceLine(piece.label, piece.title)` and points the reader to
        # `list_tasks` naming `${piece.label}`. The plant removes both, so the notice reads as `Work
        # with <holder> is not being worked on` and `Read its record with list_tasks.`. Killed by
        # `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`,
        # `a-reply-and-its-absence.test.ts`.
        # ⚑ Landing D-016b part 2 (5e931be8) · killer corrected — The rule IS pinned:
        # a-message-says-who-wrote-it.test.ts asserts the not-answered preview names the piece by
        # label and title ('no `sess_` and no `task_` in the description…') and that the preview
        # comes before the app's own lines and names the label in the list_tasks line. The listed
        # killers (never-close-what-you-did-not-see-finish, a-task-you-can-see,
        # a-reply-and-its-absence) never read these two sentences, which is why the plant survived
        # them. Keep the two edits (drop the piece line to `Work with …` and drop the label from the
        # list_tasks line) and name the right killer. Killed by
        # `a-message-says-who-wrote-it.test.ts`.
        [
            # ⚑ **F074 · re-anchored in place, not retired** — F074 put a usage limit's own head line beside it; the row still drops the piece from the notice.
            # ⚑ **F074 · re-anchored in place, not retired** — F074 · the head line says *not being worked on* only when the work is not waiting on its provider's usage limit; the row still drops the piece from the notice.
            (RAILS, "  const lines = [`${pieceLine(piece.label, piece.title)} with ${holder}${notWorkedOn}: ${said}`]", "  const lines = [`Work with ${holder}${notWorkedOn}: ${said}`]"),
            (RAILS, '  lines.push(`It has not been answered. Read its record with list_tasks, naming ${piece.label}.`)\n', "  lines.push('It has not been answered. Read its record with list_tasks.')\n"),
        ],
    ),
    # ── §4 · the pending question, and the censuses ────────────────────────────────────────────
    (
        "M15 · 🔴 any stranded request sets the flag · a child parked on a permission card has one "
        "open at every crash, so *a question was pending and unanswered at restart* becomes true of "
        "nearly every task — and a permission was never the parent's to answer, which is the half "
        "HO-005 §2 Q2 makes load-bearing",
        [(TASKS, "    if (!travelled.has(requestId)) return\n", "")],
    ),
    (
        "M16 · ⛔ the question that was lost is never recorded · the request closes `stranded` and the "
        "work that was in flight says nothing about it, so HO-018 §2.4's property — *the question is "
        "not silently lost* — is exactly as unmet as the mechanism it replaced",
        [
            (
                TASKS,
                "      noteTheLostQuestion(event.requestId)\n",
                "",
            )
        ],
    ),
    (
        "M17 · ⚠️ the lost question is forgotten when the work closes · the latch is cleared by the "
        "reply, so a parent reviewing a finished task cannot see that its child had been waiting on "
        "an answer — the one population worth counting, erased by the ending it survived",
        # ⚠️ **The FIRST `M17` was a NO-OP and recorded as a survivor.** It toggled the field, and
        # {@link noteTheLostQuestion} returns early when the flag is already set — so the toggle only
        # ever ran on `false` and wrote exactly what the original wrote
        # (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⛔ The latch is enforced by
        # `settle` NOT touching the field, so this is that omission put back.
                # ⚑ **484 · anchor corrected, not retired.** `settle` gained two more fields to clear when
                # the fold started recording WHEN a stall was observed and WHO asked for it. ⛔ The ROW is
                # unchanged and was re-verified RED individually.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `questionLostAtRestart` is a latch, so a parent reviewing a finished piece can
        # still see that its child had been waiting on an answer. `settle` in derivePieces
        # deliberately does not touch it. The plant makes `settle` reset the latch to `false`, so
        # the ending the piece survived erases the fact. Killed by
        # `never-close-what-you-did-not-see-finish.test.ts`, `a-task-you-can-see.test.ts`,
        # `a-reply-and-its-absence.test.ts`.
        [
            (TASKS, '      stalledBy: null,\n    }\n    noteChange(held.row, next)\n    rows[held.index] = next\n    if (TASK_IS_OPEN[state]) open.set', '      stalledBy: null,\n      questionLostAtRestart: false,\n    }\n    noteChange(held.row, next)\n    rows[held.index] = next\n    if (TASK_IS_OPEN[state]) open.set'),
        ],
    ),
    (
        "M18 · 🔴 the routing is not selected · `request_routed` is folded and never fetched, so the "
        "`travelled` set is empty on the REPLAYED path — which is every path a restart takes, and the "
        "only path the flag exists on — and the fact is permanently FALSE while the live path is "
        "right. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
                # ⚑ **Re-anchored by `429`**, which added `task_withdrawn`. ⛔ The ROW is unchanged:
                # it still drops `request_routed`, so `travelled` is empty on the replayed path.
                # Re-verified RED individually.
                # ⚑ Re-anchored by `491`, which added `user_turn`; the row still removes only
                # `request_routed`.
                # ⚑ Re-anchored by `724` (R84), which added `reply_undelivered` on its own line after `reopened`; the row is unchanged.
                # ⚑ **T-002 · re-anchored in place, not retired** — D-005a added `message_queued` to the list on a line of its own; the row still drops the same type. Re-verified RED alone.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same shared IN-list
        # again, same reason the anchor went dark. Dropping `'request_routed'` (with `'status'`
        # relocated, matching the row's own rearrangement) still permanently zeroes the
        # `travelled`/routing flag on the replayed path, which is every path a restart takes.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the piece narrow read must select `request_routed`, or the `travelled` set is
        # empty on the replayed path (every path after a restart) while the live path is right. The
        # plant drops `'request_routed'` from the `selectPieceEvents` list, leaving `work_restarted`
        # intact. The anchor is the same line as 398 M12, so the two rows share a region and must
        # not be applied together. Killed by `a-task-you-can-see.test.ts`,
        # `never-close-what-you-did-not-see-finish.test.ts`.
        [
            (STORE, "                     'replaced_by', 'work_restarted', 'request_routed', 'request_stranded',\n", "                     'replaced_by', 'work_restarted', 'request_stranded',\n"),
        ],
    ),
]
