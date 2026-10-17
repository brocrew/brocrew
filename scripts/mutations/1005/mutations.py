"""1005 · D-005 · a turn starting on an owner puts its stalled work back to working (`8cdfd39a`).

⚑ **Why `1005`** (T-002): a table id must be a positive integer (`runner_contract.TABLE_ID`), and
the work model's cards have none, so card D-00N's table is `100N`.

D-005 · F019 → table 1005 (commit 8cdfd39a). The task fold (`deriveTasks` in
apps/desktop/src/shared/tasks.ts) now moves an open `stalled` task back to `working` when its owner
runs again. That happens at `user_turn` (Codex order) and at the `status: working` that comes before
it (Claude order; this is the row the stall notice is decided on), through the new helper
`drivenAgain`. It applies only to causes the closed record `ITS_OWNER_RUNNING_AGAIN_DRIVES_IT` marks
true (turn_ended, turn_interrupted, app_restarted). The two "never"s are `message_never_sent` and
`conversation_ended`, which stay stalled. The working-status call sits AFTER 648's unwind. The fold
clears all three stall fields together. Every anchor below was counted once in the worktree
(456c0224) and once in main's tip 04463ecf. D-006 added 44 lines to tasks.ts but touched none of
these anchors. Rows: M1 is the defect; M2 and M3 are the two independent halves; M4 widens the
trigger; M5 and M6 are the two "never"s; M7 and M8 cover the three-field rule; M9 is the ordering
the developer drew.

## ⚠️ What has no row here, and why

- `turn_ended: false` in the record is not rowed. It is F019's own cause, and its killers are M1's
  minus 494 §2, so it is subsumed by M1.
- `turn_interrupted: false` is not rowed. It narrows the fix rather than crossing a "never". It is
  killed by the closed-record test and by 494 §2 (the first stall is turn_interrupted with a
  person's cancel, and `carry on` would not drive it).
- `app_restarted: false` is not rowed, but it is a thin-coverage note. Only the closed-record test
  in a-turn-on-its-owner-drives-its-work.test.ts would kill it. No fold or host test folds
  `work_restarted` followed by the owner's next `status: working`/`user_turn`, so that the restart
  is a cause the owner's turn drives is asserted only as a record value.
- Dropping `held.row.state !== 'stalled'` in `drivenAgain` is not rowed: it is an equivalent mutant.
  `stalledBecause` is non-null iff `stalled` (400's invariant, enforced by `settle`/`stall`), so the
  `cause === null` half already skips every non-stalled task.
- Driving at `reopened` is not rowed. D-005 wrote no code there. The fold test's second expect in
  the ended-conversation case (`[...ended, reopened]` → stalled/turn_ended) kills it, and M4 already
  covers widening the trigger.
- The ordering inside the `user_turn` branch (`asked = null` before `drivenAgain()`) is not rowed.
  `drivenAgain` does not read `asked`, so the order decides nothing.
- "The giver is still told once per task" is not rowed. That is `toldAboutStall` in runtime-host,
  which D-005 did not change; 400 §2's `noticesTo(pm, task)).toHaveLength(1)` and the 661 tables
  keep it.
- F019's 4th suggestion (taking back a stall notice still unread in a giver's mailbox when the owner
  starts again) is not rowed because it was not built.
- The four re-aimed tests are test code; they appear as killers, not rows.
- Stale prose, not rowable (comments only). D-005 made four sentences false:
  - tasks.ts `unwindTheEnding` docblock: "`TASK_STATES`' own reason for `stalled` having no way back
    to `working` except a message that actually went out".
  - runtime-host.ts around line 8940: "A task that has stopped being driven has no way back in the
    fold… so *told once per task* and *told once per episode* are the same sentence" and "A task
    stalled by a turn's own ending and then interrupted keeps the first observation on the row". 400
    §2 now pins the opposite (turn_interrupted).
  - runtime-host.ts, `toldAboutStall`'s docblock (~2275): "`deriveTasks` leaves `stalled` only for
    `answered` or `withdrawn`… so *told once per task* and *told once per episode* are the same
    sentence".
  - state-a-supervisor-can-trust.test.ts line 1063 still quotes "There is no way back to `working`".

## Verification

T-002 designed these rows read-only and verified each one alone with `verify_row.py`: applied,
its own killer files run, restored from bytes. The table has not been run.
- RED alone: M1–M7 on `a-turn-on-its-owner-drives-its-work.test.ts` and the neighbours each label
  names.
- ⚠️ **M8 and M9 SURVIVED D-005's own tests.** T-002 added a driven task whose previous turn a
  person asked to stop (M8) and an old ledger with no `reopened` row (M9) to
  `a-turn-on-its-owner-drives-its-work.test.ts`; both are RED now. It also gave `drivenAgain` its
  own cut in `never-close-what-you-did-not-see-finish.test.ts`'s one-producer census.
"""

TASKS = 'apps/desktop/src/shared/tasks.ts'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        'M1 · 🔴 **THE DEFECT, restored: nothing puts a stalled task back when its owner runs again** (`main` before D-005, F019). A helper\'s reply wakes the owner, its work reads `stalled` for the whole wake turn, and its giver is pushed *"not being worked on"*. killed by `a-turn-on-its-owner-drives-its-work.test.ts`, `three-waits-one-family.test.ts` (D-005) and the four re-aimed pins (400 §2, 484 §7, 494 §2, 703 §1.1).',
        [
            (TASKS, "      if (held.row.state !== 'stalled' || cause === null) continue\n", "      if (true || held.row.state !== 'stalled' || cause === null) continue\n"),
        ],
    ),
    (
        "M2 · 🔴 **the Codex half: a turn's `user_turn` drives nothing**. A turn that opens with no `status: working` before it leaves the owner's work `stalled`, with the previous turn's ask still on it. killed by `a-turn-on-its-owner-drives-its-work.test.ts` (Codex order) and `the-act-this-app-knows-the-author-of.test.ts` (494 §2).",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The Codex half is unchanged in kind: a turn's `user_turn` drives the
        # work its owner already holds, but the call is now `drivenAgain(theDriveOf(event))` (D-016
        # commit 6 R4), so the old `drivenAgain()` anchor is gone. The plant drops the call and
        # keeps the `aDriveWaitsForItsTurn = false` line, so a `user_turn` with no earlier `status:
        # working` leaves the previous turn's stall and ask on the work. Both named killers assert
        # the Codex order. Killed by `a-turn-on-its-owner-drives-its-work.test.ts`,
        # `the-act-this-app-knows-the-author-of.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 turned the user_turn drive into `parts.length === 0 ? drivenAgain(null) : for each
        # part drivenAgain(theDriveOf(one))`, where a one-message turn's parts are [event]. The rule
        # survives (the Codex half: a turn's user_turn drives the work its owner already holds); the
        # plant drops the per-part drive and keeps the rest. Killed by
        # `a-turn-on-its-owner-drives-its-work.test.ts`,
        # `the-act-this-app-knows-the-author-of.test.ts`.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · a4421c68 passes whether a part is a note that expects no reply as a second argument to the per-part drive; the plant still drops the drive, so a turn's user_turn drives nothing on the Codex order.
            (TASKS, "      for (const one of parts) drivenAgain(theDriveOf(one), aNoteExpectsNoReply(one))\n      continue\n", "      continue\n"),
        ],
    ),
    (
        'M3 · 🔴 **the Claude half: the turn\'s `status: working` drives nothing**. On Claude that row lands BEFORE the turn\'s `user_turn` and is the one the stall notice is decided on, so the giver is still pushed *"not being worked on"* as the turn starts (the developer\'s own reason for this half). killed by `a-turn-on-its-owner-drives-its-work.test.ts` (Claude order, reopen).',
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The Claude half still stands, but `status: working` no longer calls
        # `drivenAgain` itself: with no turn open it marks the drive pending (`aDriveWaitsForItsTurn
        # = true`) and the turn's row, or the end of the read, resolves it. The plant removes that
        # marking, so the working status drives nothing and the giver is still pushed 'not being
        # worked on' at the row the notice is decided on. The Claude-order, reopen and
        # no-reopened-row tests read the work at the status row and see it stalled. Killed by
        # `a-turn-on-its-owner-drives-its-work.test.ts`.
        [
            (TASKS, '        if (!aTurnIsOpen) {\n          aDriveWaitsForItsTurn = true\n          pendingDriveAt = entry.at\n          pendingDriveOrder = changeOrder\n        }\n        driving = true\n', '        driving = true\n'),
        ],
    ),
    (
        'M4 · ⛔ **any live status drives it, not only `working`**. The `status: idle` that follows every turn ending puts back to `working` the stall that ending had just written, so work that nothing drives reads `working` and no giver is ever told. killed by `a-turn-on-its-owner-drives-its-work.test.ts` (the premise) and the host stall tests.',
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The old plant widened the `status` drive to every live status, but
        # that line is now the pending-drive marker inside the `working` block. The plant moves `if
        # (!aTurnIsOpen) aDriveWaitsForItsTurn = true` out of the `working` test, so the `status:
        # idle` after every turn ending marks a drive nothing named and the read's end puts the
        # ending's stall back to `working`. The premise test (a turn that ended with the work open
        # reads `stalled`) catches it. Killed by `a-turn-on-its-owner-drives-its-work.test.ts`.
        [
            (TASKS, "      if (event.state === 'working') {\n        if (!aTurnIsOpen) {\n          aDriveWaitsForItsTurn = true\n          pendingDriveAt = entry.at\n          pendingDriveOrder = changeOrder\n        }\n        driving = true\n      }\n", "      if (!aTurnIsOpen) {\n        aDriveWaitsForItsTurn = true\n        pendingDriveAt = entry.at\n        pendingDriveOrder = changeOrder\n      }\n      if (event.state === 'working') {\n        driving = true\n      }\n"),
        ],
    ),
    (
        "M5 · ⛔ **a message that never went out is driven by the owner's next turn**. The owner never got the work, yet its unrelated turn marks it `working`, and the giver's *nothing is driving it* is taken away. killed by `a-turn-on-its-owner-drives-its-work.test.ts` (the never-sent case and the closed record).",
        [
            (TASKS, '  app_restarted: true,\n  message_never_sent: false,\n', '  app_restarted: true,\n  message_never_sent: true,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row planted the `conversation_ended` key in the TASK_STALL_CAUSES /
        # ITS_OWNER_RUNNING_AGAIN_DRIVES_IT map, and that cause no longer exists. Commit 8d54d6dc:
        # "There is no conversation_ended stall cause: a piece its owner was driving stalls on its
        # turn's own cause." The analogous plant on the surviving map already exists as 1017 M115,
        # and a-turn-on-its-owner-drives-its-work.test.ts now records only
        # ['could_not_be_reopened','message_never_sent']. Its anchor is left stale, so the census
        # records it retired.
        "M6 · ⛔ **an ended conversation is driven by its owner's turn**. The record stops deciding that the reopen, not a turn, sets an ended conversation's stall right. killed by `a-turn-on-its-owner-drives-its-work.test.ts` (the closed record only).",
        [
            (TASKS, '  app_restarted: true,\n  message_never_sent: false,\n  conversation_ended: false,\n', '  app_restarted: true,\n  message_never_sent: false,\n  conversation_ended: true,\n'),
        ],
    ),
    (
        "M7 · ⛔ **a driven row keeps the stall's moment**. `stalledAt` stands on a `working` row, and `list_tasks` says `stalled_at` beside `stalled_because: null`, breaking 484's rule that the three fields are one fact. killed by `a-turn-on-its-owner-drives-its-work.test.ts` (Claude order).",
        [
            (TASKS, "        state: 'working',\n        stalledBecause: null,\n        stalledAt: null,\n", "        state: 'working',\n        stalledBecause: null,\n"),
        ],
    ),
    (
        "M8 · ⛔ **a driven row keeps WHO asked the previous turn to stop**. `stalledBy` stands on a `working` row, so `list_tasks` says `asked_to_stop_by: a-person` beside `state: working` / `stalled_because: null` for the whole of the next turn. This is 648's defect, one writer over · killed by `a-turn-on-its-owner-drives-its-work.test.ts` (the test T-002 added)",
        [
            (TASKS, '        stalledAt: null,\n        stalledBy: null,\n      }\n      noteChange(held.row, next)\n      rows[held.index] = next\n', '        stalledAt: null,\n      }\n      noteChange(held.row, next)\n      rows[held.index] = next\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c commits 6–7 and D-022):** The row's subject, the
        # order of the working-status drive against 648's unwind of an ending (a
        # `conversation_ended` stall put back), was removed on purpose by D-016c (8d54d6dc,
        # 'fix(D-016): a stop changes nothing about a piece'): "There is no conversation_ended stall
        # cause" and "Gone with it: ... the unwind of an ending". Both of its anchors are gone and
        # there is no unwind left to order, since the ended row now ends the drive and `continue`s.
        # 1005's own retired M6 comment already records the same ruling. Its anchor is left stale,
        # so the census records it retired.
        "M9 · ⚠️ **the turn's working status drives BEFORE 648's unwind**. On a ledger written before 673 (no `reopened` row), a reopen whose first row is a working status reads `conversation_ended` (not driven), gets the ending's cause put back, and stays `stalled` at the very row the notice is decided on. This is the order the developer drew ('⚠️ After') · killed by `a-turn-on-its-owner-drives-its-work.test.ts` (the test T-002 added)",
        # ⚑ T-003 · re-anchored in place, not retired — D-013 put its background-hold loop before
        # `return rows`, so the first edit is the working-status line alone; the row still drives
        # BEFORE the unwind. Re-verified RED alone.
        [
            (TASKS, "    if (event.type === 'status' && event.state === 'working') drivenAgain()\n", ''),
            (TASKS, "    if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {\n", "    if (event.type === 'status' && event.state === 'working') { drivenAgain() }\n    if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {\n"),
        ],
    ),
]
