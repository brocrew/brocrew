"""3004 · the restart notice, F062 and an answered card counting as activity — 8d277ff5, 387c11d9, cadf9a5a.

⛔ **The defects.** (1) A restart quit every conversation, and work an agent held while it waited on a
background command stalled as *"its turn ended with this work still open"* — the agent giving up —
with nobody waking it and nobody saying what had stopped (8d277ff5). (2) A window that took a running
conversation back folded a page that can begin after the `status` that opened the running turn, and
read Idle / *"No activity reported"* while the turn ran (387c11d9, F062). (3) The host's tracker
cleared what a conversation was doing at every change of status, so a card opening or being answered
(`working ↔ waiting_permission`) blanked the Team page, the forest and the plates (cadf9a5a).

## ⚑ What a row here measures

 * ⚑ **M1–M5 · what the restart stopped, read off the ledger** (`backgroundTheRestartStopped`): only
   the NEWEST quit, only one younger than the bound, never an earlier life's level, the `ended` edge
   honoured, and a crash's conversations read beside the quit's.
 * ⚑ **M6–M7 · the words** — the stall line (`whatStoppedWithIt`) blames the restart only when it did,
   and the woken conversation's notice (`backgroundTheRestartStoppedText`) gives the moment it stopped.
 * ⚑ **M8–M10 · the wake** (`wakeWhatTheRestartStopped` / `wakeForStoppedWork`): the notice held, the
   starts one at a time on the one line, and a failed start taking its words back.
 * ⚑ **M11–M15 · F062** — the host hands `asHandedOver: { status, told }` on an attach; the renderer's
   adoption takes the status always, the activity only where the host holds one and then over the
   page's, and only on an `attached` hand-over.
 * ⚑ **M16–M18 · a card is not a turn boundary** (`aCardOpensOrSettles`): neither the card opening nor
   its settling clears the phase, and settling restarts the stamp.

## ⛔ What this table cannot reach

 * ⚠️ **The `background_stopped` stall itself** (`derivePieces`' stop arm in `tasks.ts`, the
   `TASK_STALL_CAUSES` entry) — not asserted by any of the preferred killers; `1016`/`1017` already
   re-anchored rows across that code, so it is left to them.
 * ⚠️ **`tellIfNobodyHasYet`'s silence while a start is coming** (`startComingAfterTheRestart`) and
   **`stallWhatItsJobWouldHaveDriven` / `whoAWakeUpWillStartForAJob`** (scheduled waits kept
   `working`) — nothing in the preferred killers drives a giver or a scheduled job across a restart.
 * ⚠️ **The `if (listening)` gate around the wake** — the control test kills it, but planting it means
   moving the call out of a block that also arms the job wake-ups; not a one-line row.
 * ⚠️ **`RESTART_WAKE_GAP_MS` itself, and `theStoppedWork`'s counting and cut** — killable, left out
   for count: M9 already measures the line the spacing belongs to, and the words' counting is a
   formatter rather than the fix.
 * ⚠️ **The early return's `!aCardSettled &&`** — `575 M10` already deletes that whole line; M16 plants
   the same outcome one line earlier, where the flag is set.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
WINDOW_STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
TRACKER = "apps/desktop/src/main/runtime/being-done.ts"

SAYS = "a-restart-says-what-it-stopped-in-the-background.test.ts"
WAKES = "a-restart-wakes-what-it-stopped-in-the-background.test.ts"
HANDED = "a-window-that-takes-a-running-conversation-is-told-what-the-host-knew.test.ts"
WINDOW = "session-store.test.ts"
CARD = "a-card-is-not-a-turn-boundary.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ---- A · what the restart stopped, read off the ledger (8d277ff5) ---------------------------
    # SAYS · '⛔ only the NEWEST quit, and only one newer than the bound: an older quit’s stamp wakes
    # nobody' — sess_old (stamped at 01:00) is named beside sess_new.
    (
        "M1 · every quit's stamp is read, not the newest quit's — a conversation an older quit stopped "
        f"long ago is woken again · killed by `{SAYS}`",
        [(STORE,
          "      WHERE closed_by_the_quit_at = (SELECT max(closed_by_the_quit_at) FROM provider_session)\n",
          "      WHERE closed_by_the_quit_at IS NOT NULL\n")],
    ),
    # SAYS · same test, its second half: `found([], LAUNCH, at(1, 59))` must be [] — a newest quit
    # older than the bound wakes nobody. (WAKES' '⛔ a quit older than a day wakes nobody' also kills.)
    (
        "M2 · the age bound is dropped — a quit days old still wakes its conversations · "
        f"killed by `{SAYS}`",
        [(STORE,
          "      const quit = stamped.filter((row) => row.at >= notBefore).map((row) => row.id)\n",
          "      const quit = stamped.map((row) => row.id)\n")],
    ),
    # SAYS · '⛔ a level stated before the newest `launched` row is an earlier life’s, which a stop
    # already took' — expects [] and gets the earlier life's work.
    (
        "M3 · the read walks past the newest `launched` row — an earlier life's background level, "
        f"which a stop already took, is named as stopped by this restart · killed by `{SAYS}`",
        [(STORE,
          "            if (row.type === 'launched') break\n",
          "            if (row.type === 'launched') continue\n")],
    ),
    # SAYS · '🔴 the newest level REPLACES, and an ended edge after it takes one item away' — expects
    # ['second'] and gets ['second', 'third'].
    (
        "M4 · an `ended` edge after the level is ignored — work that finished before the quit is "
        f"named as stopped · killed by `{SAYS}`",
        [(STORE,
          "                .filter((one) => !ended.has(one.id))\n",
          "")],
    ),
    # SAYS · '🔴 a crash’s conversations are read too, quit or no quit' — found(['sess_crashed'])
    # names nobody.
    (
        "M5 · a crash's conversations (the sweep's `died`) are dropped — only a clean quit's background "
        f"work is ever woken · killed by `{SAYS}`",
        [(STORE,
          "      for (const conversation of new Set([...quit, ...alsoTheseDied])) {\n",
          "      for (const conversation of new Set(quit)) {\n")],
    ),
    # ---- B · the words ---------------------------------------------------------------------------
    # SAYS · '🔴 what a giver reads under a stall: what it waited on and who stopped it — never that
    # the agent gave up' — both the restart and the closed-conversation sentences come out swapped.
    (
        "M6 · the stall line blames the restart exactly when it did not — a person's Close reads as "
        f"the app's restart, and the restart as a plain ending · killed by `{SAYS}`",
        [(RAILS,
          "    if (endedByTheRestart) {\n",
          "    if (!endedByTheRestart) {\n")],
    ),
    # SAYS · '🔴 what a conversation is told on being started again: when, what, and that it is its
    # call' — the text carries 02:05 (the launch) where 01:57 (the stop) is expected.
    (
        "M7 · the woken conversation is told the launch's time as the moment the restart stopped its "
        f"work · killed by `{SAYS}`",
        [(HOST,
          "    `The app restarted at ${clockTimeFrom(endedAt, now)} and stopped your background work: ` +\n",
          "    `The app restarted at ${clockTimeFrom(now, now)} and stopped your background work: ` +\n")],
    ),
    # ---- C · the wake ----------------------------------------------------------------------------
    # WAKES · '🔴 a conversation whose background work the quit stopped is held a notice at once and
    # started five seconds on, and the notice goes in as its turn' — noticesIn(a) is empty.
    (
        "M8 · the conversation is started but never told what stopped — no notice is held for its "
        f"start · killed by `{WAKES}`",
        [(HOST,
          "        this.holdUntilItStarts(\n"
          "          conversation,\n"
          "          backgroundTheRestartStoppedText(stopped, endedAt, now),\n"
          "          { appNotice: 'background-work-a-restart-stopped' },\n"
          "        )\n",
          "")],
    ),
    # WAKES · '🔴 the starts are one at a time: the second waits for the first to end, and then for
    # its own five seconds' — two spacings are armed at once.
    (
        "M9 · the starts leave the line — every stopped conversation is started at once, five seconds "
        f"after the launch · killed by `{WAKES}`",
        [(HOST,
          "        this.restartWakes = this.restartWakes.then(() => this.wakeForStoppedWork(conversation))\n",
          "        void this.wakeForStoppedWork(conversation)\n")],
    ),
    # WAKES · '⛔ a start that fails ends the words it waited with — they are not sent later by
    # chance — and says so in the log' — no `message_unqueued` ever lands.
    (
        "M10 · a failed start keeps the notice it waited with — a later start, or a conversation in its "
        f"place, reads about work it never ran · killed by `{WAKES}`",
        [(HOST,
          "      this.letGoOfItsMissedJobs(\n"
          "        conversation,\n"
          "        ITS_START_AFTER_THE_RESTART_FAILED,\n"
          "        'background-work-a-restart-stopped',\n"
          "      )\n",
          "")],
    ),
    # ---- D · F062 — what the host knew, handed over beside the page (387c11d9) -------------------
    # HANDED · '🔴 a reload is handed the status and the activity the host was told, beside the page'
    # — asHandedOver is absent.
    (
        "M11 · the host hands over nothing beside the page — the defect, verbatim: a reload reads Idle "
        f"while the turn runs · killed by `{HANDED}`",
        [(HOST,
          "      asHandedOver: { status, told },\n",
          "      asHandedOver: null,\n")],
    ),
    # WINDOW · F062 · '🔴 the status the host held, and the activity it was told, replace a page that
    # begins too late to hold them' — control.status stays 'idle'.
    (
        "M12 · the window takes the host's activity but not its status — a running conversation's "
        f"header still reads Idle · killed by `{WINDOW}`",
        [(WINDOW_STORE,
          "      record.control.status = handed.asHandedOver.status\n",
          "")],
    ),
    # WINDOW · F062 · '⛔ the page’s own activity stays where the host holds none, and the status is
    # still the host’s' — the page's `thinking` is overwritten with null.
    (
        "M13 · a host that holds no activity wipes the page's — the window says *No activity reported* "
        f"over a phase its own page had · killed by `{WINDOW}`",
        [(WINDOW_STORE,
          "      if (activity !== null) record.control.activity = activity\n",
          "      record.control.activity = activity\n")],
    ),
    # WINDOW · F062 · '⚑ the host’s activity wins over a sub-agent’s call the page mistook for the
    # conversation’s own' — the page's `Read` stays where `Task` is expected.
    (
        "M14 · the page's activity wins over the host's — a sub-agent's call the page mistook for the "
        f"conversation's own is drawn as what it is doing · killed by `{WINDOW}`",
        [(WINDOW_STORE,
          "      if (activity !== null) record.control.activity = activity\n",
          "      if (activity !== null && record.control.activity === null) record.control.activity = activity\n")],
    ),
    # WINDOW · F062 · '⛔ the same hand-over is taken on a reload (attachOpen) and ignored on a resume,
    # whose page ends where the new life begins' — the resumed record reads 'working'.
    (
        "M15 · the hand-over is taken on a resume too — a reopened recording reads as the life before "
        f"it, still working · killed by `{WINDOW}`",
        [(WINDOW_STORE,
          "    if (handed.handover === 'attached' && handed.asHandedOver !== undefined) {\n",
          "    if (handed.asHandedOver !== undefined) {\n")],
    ),
    # ---- E · a card is not a turn boundary, and its answer is activity (cadf9a5a) ----------------
    # CARD · '🔴 the card opening keeps what it was doing and moves nothing; its answer keeps it and
    # restarts the clock' — since stays 3 where 5 is expected ('an answer counts as activity').
    (
        "M16 · a settled card is not activity — an approval, a denial or an answer leaves the stamp "
        f"where the card found it · killed by `{CARD}`",
        [(TRACKER,
          "          aCardSettled = event.state === 'working'\n",
          "          aCardSettled = false\n")],
    ),
    # CARD · same test — 'an answered card cleared what it was doing': waiting_permission → working
    # falls through to the turn-boundary branch.
    (
        "M17 · only a card's opening is kept; its answer is a turn boundary again — the defect, half: "
        f"after an approval every surface says nothing is going on · killed by `{CARD}`",
        [(TRACKER,
          "    (from === 'working' && to === 'waiting_permission') ||\n"
          "    (from === 'waiting_permission' && to === 'working')\n",
          "    from === 'working' && to === 'waiting_permission'\n")],
    ),
    # CARD · same test — 'a card cleared what it was doing': working → waiting_permission clears.
    (
        "M18 · only a card's settling is kept; its opening is a turn boundary again — the defect, the "
        f"other half: a card raised mid-call blanks what it asks about · killed by `{CARD}`",
        [(TRACKER,
          "    (from === 'working' && to === 'waiting_permission') ||\n"
          "    (from === 'waiting_permission' && to === 'working')\n",
          "    from === 'waiting_permission' && to === 'working'\n")],
    ),
]
