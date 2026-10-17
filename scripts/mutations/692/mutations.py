"""692 · a restart keeps what was open — PM ruling R34.

⛔ **Ordered by the person, after the PM's 03:51 update restart: *"yo did someone cleanup my brobot
sessions?"*** Four idle conversations — his BroBot and three agents it was working with — were ended
by a graceful quit, and the next launch drew every one under *Closed conversations*. R34: a
conversation the app closed ONLY because the app quit comes back OPEN; nothing runs until something
is sent to it; a quit that could not record falls back to closed.

## ⚑ What a row here measures

 * ⚑ **M1–M4 are R34a's RECORD** — that the quit writes at all, that it writes only AFTER its
   teardown (R34c: a crash mid-quit records nothing), and two kinds of slot it leaves out: one whose
   provider failed in place, and one whose provider ended on its own before the finalizer ran.
 * ⚑ **M5–M7 are R34a's READ** — the stamp, the slot map, and the list field the rail folds.
 * ⚑ **M8–M12 are what a parent READS meanwhile (R34b)** — the reach (its commander, and only its
   commander), the listing, the card and the work wall, each asked of a conversation with no slot.
 * ⚑ **M13–M21 are the START a parent's message makes** — that it happens, the two walls and the
   one-piece-of-work rail before it, the parent-only door, the launch rails inside the reservation,
   the waker's mark and its clearing, and the start's refusal carried in the wake's words.
 * ⚑ **M22–M28 are the other doors** — `end_agent` (entitlement, floor, and the stamp it clears),
   `interrupt_agent` (entitlement, and the `asked: false` answer), `list_projects`' *Running*.
 * ⚑ **M29–M30 are `withdraw_task`** — it sees the conversation, and it writes the withdrawal.
 * ⚑ **M31–M34 are what the parent is TOLD** — the pushed notice, the `list_tasks` line, the
   correction's clause, and `message_agent`'s own answer after a start.
 * ⚑ **M35–M37 are the other ways it stops being open** — a person's Close, a start the provider can
   never serve, and R34c's reopen that clears the stamp.
 * ⚑ **M38–M44 are the person's side** — the fold, the plate, the note, the unfinished ending, the
   rail's two sections and count, and the palette's band.
 * ⚑ **M45–M48 are review round two's** — only a `ResumeError` its adapter marks `noSuchSession` closes
   it (a cause-less one, until `706`); a person's Close
   and a parent's end while a start is in flight each clear the stamp; and the push calls a holder
   open only to a giver that may reach it.
 * ⚑ **M49–M50 are the person's band of work nobody was told about** — found by the rule 8.1 sweep
   on the settle half: the host carries the fact, and the sentence reads it.

## ⛔ What this table cannot reach

 * ⚠️ **The `me === null` return at the top of `startWhatTheQuitClosed`** is the compiler's narrowing:
   `queueMessage` asks the same question before it calls, so no mutation of the inner line is
   observable. It is not a row, for `433`'s *"a line no mutation can kill is not carrying its rule"*.
 * ⚠️ **`whatTheQuitCloses`' `session === null` return** is a narrowing too: the set holds SESSIONS,
   and a reservation still starting has none to hold. A reopen in flight at the quit staying closed
   is still measured (§3), as behaviour rather than as a row.
 * ⚠️ **`whatTheQuitCloses`' `onItsWayOut` return** — a slot a person's Close is already tearing down
   — is shadowed on `FakeRuntime` by the status clause below it: the double's `close()` flips its
   status to `ended` synchronously, before the host's teardown yields. ⚑ It stays in the code because
   a real adapter's close does not promise that (Claude's awaits its SDK); the behaviour — a Close in
   flight at the quit stays closed — is measured in §3, and the row that would remove the line
   SURVIVED for exactly this reason, measured, not assumed.
 * ⚠️ **The snapshot's place after the sign-ins' bounded cancel, and the record's `finally`** — no
   test holds a sign-in in flight across a quit, or makes one conversation's close reject; both are
   reasoned from `closeAll`'s own shape and stated there.
 * ⚠️ **`recordWhatTheQuitClosed`' failure branch** — a store that throws while the quit stamps — is
   a warning and a fallback to R34c's closed; no test here breaks the store mid-quit.
 * ⚠️ **`stalledWorkSaid`'s `because === 'conversation_ended'` conjunct** — a kept-open holder's work
   carries the quit's own ending as its latest cause, so no reachable row pairs the flag with another
   cause; the conjunct keeps the sentence from overriding a cause R34 does not undo.
 * ⚠️ **`keptOpen`'s `find() === null` path** — a Claude conversation the quit found before its first
   turn named it — is not reachable on `FakeRuntime`, which issues a ref at start.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
FOLD = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
PALETTE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
BAND = "apps/desktop/src/shared/stalled-work.ts"

KILLER = "a-restart-keeps-what-was-open.test.ts"
WAKE_KILLER = "what-a-wake-still-says-wrong.test.ts"
FOLD_KILLER = "closed-threads.test.ts"
RAIL_KILLER = "closed-rail.dom.test.ts"
PALETTE_KILLER = "command-palette.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 THE DEFECT, restored · the quit records nothing, so every conversation it closed comes "
        f"back under Closed conversations · killed by `{KILLER}`",
        [(HOST, "      this.recordWhatTheQuitClosed(theQuitCloses)\n", "      void theQuitCloses\n")],
    ),
    (
        "M2 · the quit records BEFORE its teardown, so a crash mid-quit brings back open what it was "
        f"still closing — R34c undone · killed by `{KILLER}`",
        [(HOST, "    const theQuitCloses = this.whatTheQuitCloses()\n",
          "    const theQuitCloses = this.whatTheQuitCloses()\n"
          "    this.recordWhatTheQuitClosed(theQuitCloses)\n")],
    ),
    (
        "M3 · a conversation whose provider failed in place is recorded, so a failure comes back open · "
        f"killed by `{KILLER}`",
        [(HOST, "      if (status === 'errored') return []\n", "")],
    ),
    (
        "M4 · a conversation whose provider ended on its own is recorded, so an ending of its own comes "
        f"back open · killed by `{KILLER}`",
        [(HOST, "      if (status === 'ended') return []\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone:
        # `aQuitLeftItOpen()` and the stamp gate that made a recording read as open no longer exist,
        # and no list row carries an open-or-closed fact. D-017b: "One Conversations list in the
        # rail and the palette, each row with the shared state: no open / closed / kept-open split."
        # Its anchor is left stale, so the census records it retired.
        "M5 · the stamp is not asked, so every recording with a ref reads as open — a person's own "
        f"Close undone · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Old `keptOpen()`'s
        # `theQuitClosed` gate now lives in `aQuitLeftItOpen()`, the window-only fact every
        # `keptOpenAcrossAQuit` field reads. Dropping that gate there still makes any non-running
        # conversation with a ref read as open, undoing a person's own Close, exactly as before.
        [
            (HOST, '  private aQuitLeftItOpen(sessionId: string): boolean {\n    return (\n      !this.slots.has(sessionId) &&\n      this.deps.store.theQuitClosed(sessionId) &&\n', '  private aQuitLeftItOpen(sessionId: string): boolean {\n    return (\n      !this.slots.has(sessionId) &&\n      true &&\n'),
        ],
    ),
    (
        "M6 · a conversation the app is RUNNING still reads as waiting while its start is in flight · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `keptOpen()`'s
        # not-currently-running guard survives verbatim as `startable()`'s first line. Removing it
        # there still lets a running conversation be counted `startable`, so `agentsVisibleTo`
        # (which unions live slots with `everythingStartable()`) would list a running child twice.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds: a
        # conversation the app is running must not also be described as a stopped one that a message
        # could start. The `slots.has` guard now lives in `aStoppedConversation()`, whose first two
        # lines are also copied into `aSettingForItsNextStart`, so the old anchor matched twice. The
        # signature line makes it unique. Without the guard, `list_agents` lists the in-flight child
        # twice, once from its slot and once from `everythingStartable()`.
        [
            (HOST, '  private aStoppedConversation(sessionId: string): Startable | null {\n    if (this.slots.has(sessionId)) return null\n', '  private aStoppedConversation(sessionId: string): Startable | null {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `keptOpenAcrossAQuit` field and
        # the renderer contract that filed rows under Closed conversations were deleted with
        # `KeptOpenPane.vue`, `kept-open.ts` and `closed-threads.ts`. Every list row now carries
        # `state` from `oneStatePerListing` instead. D-017b: "no open / closed / kept-open split."
        # Its anchor is left stale, so the census records it retired.
        "M7 · the list rows never carry the fact, so the rail files them under Closed conversations · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `resumableSessions()`'s
        # `keptOpenAcrossAQuit` field now reads `this.aQuitLeftItOpen(session.sessionId)` in place
        # of `this.keptOpen(...) !== null` — same field, same renderer contract (the
        # Sessions/kept-open pane reads it). Forcing it `false` still files every kept-open row
        # under Closed.
        [
            (HOST, '      keptOpenAcrossAQuit: this.aQuitLeftItOpen(session.sessionId),\n', '      keptOpenAcrossAQuit: false,\n'),
        ],
    ),
    (
        "M8 · the reach sees no conversation the quit closed, so its own parent is told `no-such-agent` "
        f"about an open child · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `withinMessagingReach`'s
        # target lookup is unchanged in shape — `this.slots.get(sessionId) ??
        # this.startable(sessionId)`, just renamed from `keptOpen`. Dropping the
        # stopped-conversation fallback still makes a stopped conversation unreachable to everyone,
        # including its own parent, which now answers `no-such-agent`.
        [
            (HOST, '    const target = this.slots.get(sessionId) ?? this.startable(sessionId)\n    if (target === undefined || target === null) return false\n', '    const target = this.slots.get(sessionId) ?? null\n    if (target === undefined || target === null) return false\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** This row's subject is precisely the
        # commander-only gate on the wide-grant clause (`if (slot === undefined) return false` right
        # before the grant check in `withinMessagingReach`), and that gate no longer exists anywhere
        # in the function (confirmed: the exact old text is absent from today's file). The commit
        # says so directly — "startable replaces the quit-only keptOpen; the commander-only clause
        # is gone" — and the new §5 test explicitly asserts the opposite of what this row measured:
        # a non-parent with a wide reach IS now shown and CAN start a stopped conversation ("the
        # grant decides, as for the running one"), replacing the old test titled "a caller that is
        # NOT its parent is not shown it and cannot start it". Its anchor is left stale, so the
        # census records it retired.
        "M9 · a caller a person granted a wide reach is SHOWN a conversation the quit closed that its "
        f"message could never start — PM Ruling 1 broken · killed by `{KILLER}`",
        [(HOST, "    if (slot === undefined) return false\n    const speaking = sessionSpeakingAs(by)\n",
          "    const speaking = sessionSpeakingAs(by)\n")],
    ),
    (
        "M10 · `list_agents` leaves out the conversations the quit closed · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `agentsVisibleTo`'s
        # stopped-conversations arm is now `...this.everythingStartable().filter((stopped) =>
        # this.withinMessagingReach(stopped.id, by, me))` — the same shape as the old
        # `everythingKeptOpen().filter(...)`. Forcing the filter to reject everything still hides
        # every conversation a quit or a stop left reachable from `list_agents`.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — list_agents' reach walk
        # still unions live slots with the stopped-conversation arm —
        # `agentsVisibleTo`/`conversationsVisibleTo`'s `...this.everythingStartable().filter(...)`
        # line, now destructuring `{ startable }` instead of the old `stopped` name. Forcing that
        # filter to reject everything still hides every conversation a quit or a stop left reachable
        # from list_agents, exactly the row's original defect.
        [
            (HOST, '      ...this.everythingStartable()\n        .filter(({ startable }) => this.withinMessagingReach(startable.id, by, me))\n', '      ...this.everythingStartable()\n        .filter(() => false)\n'),
        ],
    ),
    (
        "M11 · `get_agent_status` has no card for a conversation the quit closed · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `agentCard`'s no-slot
        # branch now calls `this.stoppedCardFor(sessionId, by, me)` in place of the old
        # `keptOpenCardFor`. Forcing it to return `null` still means `get_agent_status` has no card
        # for any conversation this app is not running.
        [
            (HOST, '    if (slot === undefined) return this.stoppedCardFor(sessionId, by, me)\n', '    if (slot === undefined) return null\n'),
        ],
    ),
    (
        "M12 · the work wall forgets the parent started it, so a parent reaching only its own project "
        f"is refused work to its own child · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `assertMayAssign`'s slot
        # lookup is still `this.slots.get(sessionId) ?? this.startable(sessionId) ?? undefined`, the
        # same shape as with `keptOpen`. Dropping the stopped-conversation fallback still makes the
        # work wall blind to the fact that the caller is the stopped child's own parent, refusing it
        # work.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `assertMayAssign` and the work wall's slot lookup went with `message_agent kind=work` (the
        # host comment says 'assertMayAssign's went with spawn_agent and the work message: a give
        # goes to the giver's own conversation with an agent, found rather than asked'). The rule
        # the row protected, that a parent must still reach its own stopped child by the parent link
        # on the child's row, is now `helperAs`'s `newestChildAs(parents, profileSlug)` lookup, and
        # the test 'a parent still gives work to its OWN child' says so in as many words ('a start
        # that forgot its parent would reach a NEW conversation'). Dropping the row lookup makes the
        # give miss the stopped child and start or refuse a new one, so `giveTo`'s `given.agent ===
        # child` check fails. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '    const found = reserved?.id ?? this.deps.store.newestChildAs(parents, profileSlug)\n', '    const found = reserved?.id ?? null\n'),
        ],
    ),
    (
        "M13 · a parent's message never starts a conversation the quit closed, so an open child can "
        f"never be reached · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The old per-message
        # `starts` boolean is gone, but its job — "does this delivery start a stopped conversation"
        # — is now `deliverWhenItRuns`'s `if (!this.runsNow(sessionId))` branch, the single door
        # every delivery (not just an agent's) now passes through. Forcing that condition to `false`
        # still means no message ever starts a stopped conversation, so an open child can never be
        # reached — now for every caller, not only a parent's.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The 'does this delivery
        # start a stopped conversation' job now lives in `deliverWhenItRuns`'s `if
        # (this.runsNow(to))` branch, the single door every delivery (not just an agent's) passes
        # through before `ensureRunning`. Forcing that condition permanently true makes every
        # delivery take the already-running arm and skip `ensureRunning` entirely, so a message
        # never starts a conversation the quit closed.
        [
            (HOST, '      if (this.runsNow(to)) {\n', '      if (true) {\n'),
        ],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-parent-narrowed-off-messaging-spends-no-launch-on-its-stopped-child.test.ts` (the
        # landing added it; no existing test observed this plant).
        "M14 · the start skips the boundary wall, so a provider is spent on a message the wall then "
        f"refuses · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The reach wall
        # `this.assertMayReach('message', sessionId, by)` before a start relocated into
        # `refuseBeforeAStart`, which every delivery now calls before `ensureRunning`. Removing just
        # that call still spends a provider start on a message the wall would have refused, killed
        # by the §5 test that asks the door directly for a caller its grant does not admit.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The boundary wall is
        # still asked before a start: `refuseBeforeAStart` calls `assertMayReach('message', ...)`
        # ahead of `assertMayAssign`, and the `breadth` line the old anchor named is gone. The
        # anchor has to include the following `OPENS_A_TASK` line to be unique, because `queueAs`'s
        # gate carries the same two-line pair. Caveat: this plant probably survives every existing
        # test today, since `withinMessagingReach` (D-017) refuses an out-of-reach caller earlier
        # with 'unknown session'; only a commander with `canMessage: 'none'` messaging a stopped
        # child, with launches counted, would see a launch spent before `queueAs` refuses.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The reach wall
        # before a start survives in `refuseBeforeAStart` as `if (says !== null)
        # this.assertMayReach('message', sessionId, by)`, since `assertMayAssign` and `OPENS_A_TASK`
        # no longer follow it, so the old two-line anchor is gone. The shorter line also occurs in
        # `queueAs`'s gate, so the anchor includes the following bare `return`. The row's own notes
        # (bd70d693) name its real killer, the D-016a test where a commander with `canMessage:
        # 'none'` messages its stopped child and the launch count is asserted; the restart test
        # cannot see it because `withinMessagingReach` throws first for a caller that does not
        # command the child. Killed by
        # `a-parent-narrowed-off-messaging-spends-no-launch-on-its-stopped-child.test.ts`.
        [
            (HOST, "      if (says !== null) this.assertMayReach('message', sessionId, by)\n      return\n", '      return\n'),
        ],
    ),
    (
        "M15 · the start skips the work wall, so a provider is spent on work the wall then refuses · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-014 · re-anchored in place, not retired — startWhatTheQuitClosed still asks
        # the work wall (`may-not-assign-work`, and now the did-not-start rail) before it spends a
        # start. D-014 only removed the `breadth` argument from that line. Re-verified RED alone.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same relocation as M14:
        # `this.assertMayAssign(sessionId, by, says)` is still asked in `refuseBeforeAStart`, right
        # after the breadth read, before any start. Dropping only that call still lets work through
        # to a start the wall would refuse, killed by the §5 test where the parent is narrowed to
        # `canAssignWork: 'none'`.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The work wall is still
        # asked before the start, and `assertMayAssign(sessionId, by, says)` is followed directly by
        # `if (OPENS_A_TASK[says])` now that the `breadth` line is gone. The plant drops that call
        # from `refuseBeforeAStart`; `queueAs`'s gate still refuses afterwards, so a provider is
        # spent on work the wall then refuses.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'start
        # skips the work wall' defect is now 'the give skips `may-not-assign-work`':
        # `assertMayAssign` is gone, and the give asks the wall once, as step 3 of its admission,
        # before the lookup and any start (`giveFacts.mayGiveWork` = `mayReachAtAll('assign', by)`;
        # the refusal comment says the give 'asked may-not-assign-work' before anything was sent).
        # Forcing that thunk to null lets a parent narrowed to `canAssignWork: 'none'` give work, so
        # a start is spent on work the wall refuses; the restart test's section 5 arm asserts both
        # the refusal and a launch count of 0. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, "      mayGiveWork: () => this.mayReachAtAll('assign', by),\n", '      mayGiveWork: () => null,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `if (kept.parent?.parentSessionId !==
        # me) return` was the parent-only gate on who may START a stopped conversation, and it has
        # no surviving analogue anywhere in `refuseBeforeAStart`/`ensureRunning`. The commit says
        # "the commander-only clause is gone", and the new §5 test asserts the opposite of this
        # row's defect on purpose: a non-parent caller with reach now starts the child, with the
        # grant deciding "as for the running one". Its anchor is left stale, so the census records
        # it retired.
        "M16 · anyone the door is called for starts it, not only its parent · "
        f"killed by `{KILLER}`",
        [(HOST, "    if (kept.parent?.parentSessionId !== me) return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The
        # one-open-piece-per-conversation rail was removed on purpose: `workAlreadyOpenIn` and
        # `WorkAlreadyOpen` no longer exist in the host, and shared/refusals.ts says 'D-016 retired
        # `agent-already-has-work-open`: a busy conversation takes a piece of work'. The restart
        # test replaced its arm with a comment saying the same ('gone with its subject (D-016):
        # agent-already-has-work-open ... left the product, and a give to a child the quit stopped
        # is admitted and starts it'). The only rail left near it, the stall rule
        # `its-work-has-stalled`, refuses a give for a different reason and is asked inside the
        # give's admission, not before a start. Its anchor is left stale, so the census records it
        # retired.
        "M17 · the one-piece-of-work rail is asked only after the start, so a re-send spends a provider "
        f"to be refused · killed by `{KILLER}`",
          # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` F-1) gave the error the held task's project; the row still asks the one-piece rail only after the start.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The one-piece-of-work
        # rail is still asked in the same `if (OPENS_A_TASK[says]) { const open = …; if (open !==
        # null) throw … }` shape, inside `refuseBeforeAStart`, before any start. Voiding the throw
        # still lets a parent's re-send of work its child already holds spend a start to be refused,
        # killed by the §5 test asserting `launched.length` does not move.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The one-open-task rail
        # is still asked before the start, but D-016 dropped its caller-breadth argument and the
        # project field, so it is now `workAlreadyOpenIn(sessionId)` and `new
        # WorkAlreadyOpen(open.taskId, open.number)`. The plant keeps the read and discards the
        # refusal, so a re-send spends a provider and is then refused by `queueAs`'s own rail.
        [
            (HOST, '        const open = this.workAlreadyOpenIn(sessionId)\n        if (open !== null) throw new WorkAlreadyOpen(open.taskId, open.number)\n', '        const open = this.workAlreadyOpenIn(sessionId)\n        void open\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `admitTheStartAMessageMakes`'s
        # launch-rail check on a message-caused start is gone entirely — `ensureRunning`'s own
        # docblock now says "it asks no rail: every rail a message meets is asked before this is
        # called". The new §5 test makes this row's old defect the ruling on purpose: with spawning
        # switched off, the parent's message still starts its child, because "a message is not a
        # spawn". Its anchor is left stale, so the census records it retired.
        "M18 · the start asks no launch rail, so a message starts a conversation with spawning "
        f"switched off · killed by `{KILLER}`",
        [(HOST,
          "    const woken = this.slots.has(sessionId) ? null : this.theConversationAWakeResumes(sessionId)\n"
          "    if (woken === null) return\n"
          "    const refusal = admitWake(me, woken, this.spawnFacts(by))\n",
          "    const woken = this.slots.has(sessionId) ? null : this.theConversationAWakeResumes(sessionId)\n"
          "    if (woken === null) return\n"
          "    const refusal = null as SpawnRefusal | null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `wokenBy`, `markTheWaker`, the `unmarked` local and the waker mark are gone (0 occurrences
        # in src). They existed only so the parent that woke a child was not corrected about its own
        # start, and the commit removed the correction: "every set-right, correction and wake
        # take-back". The `§2 · F8` section of `what-a-wake-still-says-wrong.test.ts` was deleted
        # with its subject. Its anchor is left stale, so the census records it retired.
        "M19 · the start does not mark the parent as its waker, so the parent is corrected about its "
        f"own start — F8's *still not being worked on* · killed by `{WAKE_KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `startForADelivery`'s
        # `unmarked` computation still guards the same waker-mark write, now folded with a `waker
        # !== null` check because one door serves both wakes and messages. Forcing it `false` still
        # means the parent is never marked as this start's waker, reproducing F8's "still not being
        # worked on" correction, killed by `what-a-wake-still-says-wrong.test.ts` §2.1b ("the parent
        # whose MESSAGE started it is told nothing").
        [
            (HOST, '    const unmarked = waker !== null && !this.wokenBy.has(sessionId)\n', '    const unmarked = false\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The waker's mark and its `finally` cleanup were deleted with `wokenBy`, so a mark cannot
        # outlive the start. The consequence the label names, a later Reopen never being set right,
        # is the removed feature: "A stop, a reopen and a start tell nobody anything". Its anchor is
        # left stale, so the census records it retired.
        "M20 · the waker's mark outlives the start, so a PERSON's later Reopen is read as the parent's "
        f"and the parent is never set right · killed by `{WAKE_KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The same function's
        # `finally` block still deletes the `wokenBy` mark it set, guarded by `unmarked`. Voiding
        # that delete still leaves a stale mark that misreads a later person's Reopen as the
        # parent's own wake, killed by `what-a-wake-still-says-wrong.test.ts` §2.4b ("a person's
        # Reopen after the parent's own message-start still sets the parent right").
        [
            (HOST, '    } finally {\n      if (unmarked) this.wokenBy.delete(sessionId)\n      if (headless) this.startingForADeliveryWithNoWindow.delete(sessionId)\n    }\n', '    } finally {\n      void unmarked\n      if (headless) this.startingForADeliveryWithNoWindow.delete(sessionId)\n    }\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** `AStartThatDidNotHappen` no longer
        # carries a `.refusal` field at all — its constructor takes only `cause: unknown` (confirmed
        # in session-unavailable.ts) — and agent-tools.ts's catch block for it has no `if
        # (error.refusal !== null) { carryRailRefusal(...) }` branch left to break. This follows
        # directly from M18's retirement: once a message-triggered start asks no launch rail, there
        # is no launch-rail refusal of a message start left to carry. Its anchor is left stale, so
        # the census records it retired.
        "M21 · a launch-rail refusal of the start is not carried, so the parent's tool breaks instead "
        f"of naming the switch · killed by `{KILLER}`",
        [(TOOLS, "              if (error.refusal !== null) {\n                const carried = carryRailRefusal(error.refusal)\n",
          "              if (error.refusal !== null && false) {\n                const carried = carryRailRefusal(error.refusal)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** end_agent is entirely gone. The commit
        # message states it directly: "end_agent and resume_agent are gone (21 tools)... Nothing
        # ends a conversation." `endAgent`, `endWhatTheQuitClosed` and the target lookup this row
        # targeted no longer exist anywhere in runtime-host.ts — confirmed by grep. Its anchor is
        # left stale, so the census records it retired.
        "M22 · `end_agent` does not see a conversation the quit closed · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-014 · re-anchored in place, not retired — endAgent still resolves a
        # conversation the quit closed through `keptOpen` before the entitlement check, and D-014
        # left that line unchanged. Re-verified RED alone.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `endAgent`'s target
        # lookup is unchanged in shape — `slot ?? this.startable(sessionId)`, renamed from
        # `keptOpen`. Dropping the fallback still hides a stopped conversation from its own
        # `end_agent`, killed by the file's own "end_agent closes a child that came back open" test.
        [
            (HOST, "    const target = slot ?? this.startable(sessionId)\n    if (target === undefined || target === null) return 'no-such-agent'\n", "    const target = slot\n    if (target === undefined || target === null) return 'no-such-agent'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same removal as M22: `end_agent`'s
        # entitlement-before-`endWhatTheQuitClosed` ordering this row targeted has no surviving code
        # — the whole verb is gone per the commit message ("end_agent and resume_agent are gone").
        # There is nothing left to reorder. Its anchor is left stale, so the census records it
        # retired.
        "M23 · `end_agent` asks no entitlement of a conversation the quit closed, so anyone may end it · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The entitlement survives in a new
        # shape: the caller must command the target or sit above it in the chain (`mayCommand ||
        # mayInterruptDownTheChain`), and it is asked before `endWhatTheQuitClosed`, which asks
        # nothing itself. Re-verified RED alone.
        [
            (HOST, "    if (\n      !mayCommand(target, by) &&\n      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    ) {\n      return 'no-such-agent'\n    }\n    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)\n", "    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)\n    if (\n      !mayCommand(target, by) &&\n      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    ) {\n      return 'no-such-agent'\n    }\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The project floor on end is deleted:
        # `assertMayReach('end', …)` is gone and 'end' is no longer in MESSAGING_ACTS. Its anchor is
        # left stale, so the census records it retired.
        "M24 · `end_agent` skips the floor for a conversation the quit closed, so a parent reaching only "
        f"its own project ends a child in another · killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 hands the caller to the no-slot branch, so the ask it ends with names it. The DEFECT this row plants is unchanged.
        [(HOST, "    this.assertMayReach('end', sessionId, by)\n    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)\n",
          "    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)\n    this.assertMayReach('end', sessionId, by)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `end_agent`'s stamp-clearing
        # (`takeBackWhatItsOwnEndMadeFalse` / `forgetTheQuitOf` / the `'ended'` return) belonged
        # entirely to the now-deleted `endAgent` method. The commit deliberately removes end_agent
        # ("nothing ends a conversation"), so this row's subject is gone by design, not merely
        # moved. Its anchor is left stale, so the census records it retired.
        "M25 · `end_agent` answers `ended` and leaves the stamp, so the child comes back open again · "
        f"killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 records the ask before the stamp goes; the row still removes only the stamp's clearing. The DEFECT this row plants is unchanged.
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 marks the parent's own end before the stamp goes, so the clearing is the line before `return`. The DEFECT this row plants is unchanged.
        [(HOST, "    this.takeBackWhatItsOwnEndMadeFalse(sessionId, by)\n    this.forgetTheQuitOf(sessionId)\n    return 'ended'\n",
          "    this.takeBackWhatItsOwnEndMadeFalse(sessionId, by)\n    return 'ended'\n")],
    ),
    (
        # ⚠️ Landing D-017 (5206d835) · a KNOWN SURVIVOR: `interruptAgent` is only called by an
        # agent, and for an agent the removed `startable` fallback grants nothing
        # `mayInterruptDownTheChain` does not (the direct parent is always in its ancestors). Kept
        # so a caller for whom they differ is measured.
        "M26 · `interrupt_agent` does not see a conversation the quit closed · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `interruptAgent`'s target
        # lookup is the same `slot ?? this.startable(sessionId)` shape. Dropping the fallback still
        # hides a stopped conversation from `interrupt_agent`, killed by the file's "interrupt_agent
        # on a child that came back open" test.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — interrupt_agent survives
        # D-017 ("interrupt_agent stops a turn") and its target lookup is still `slot ??
        # this.startable(sessionId)`, feeding the `mayCommand(...) || mayInterruptDownTheChain(...)`
        # entitlement. Removing the stopped-conversation fallback makes `target` undefined for a
        # quit-closed conversation, so a caller with no agent-chain standing (a person's window) is
        # refused `not-below-you` instead of getting the normal `asked:false` outcome.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — interrupt_agent's target lookup is now in the private mayInterrupt
        # (extracted by D-016c commit 7) as this.slots.get(sessionId) ?? this.startable(sessionId);
        # the same line also exists in withinMessagingReach, so the anchor is extended over the
        # return line to match once. The plant drops the startable fallback, which is the label's
        # defect. It remains the KNOWN SURVIVOR that D-017 recorded: the direct parent is always in
        # the ancestor chain, so no agent caller in the tests differs. Killed by
        # `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '    const target = this.slots.get(sessionId) ?? this.startable(sessionId)\n    return (\n      (target !== undefined', '    const target = this.slots.get(sessionId)\n    return (\n      (target !== undefined'),
        ],
    ),
    (
        "M27 · `interrupt_agent` tells the parent it ASKED a conversation that has nothing running · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — agent-tools.ts no longer
        # has `outcome.state === 'open-nothing-running'` at all — that reading moved into
        # `InterruptOutcome.asked`, set `false` only by `nothingToInterrupt`, whose own docblock
        # says 'no turn runs in it, so nothing was asked' and warns `asked: true` would be exactly
        # the false claim this row plants. Flipping that single field reproduces the row's defect
        # one door down in the same call.
        [
            (HOST, '      asked: false,\n', '      asked: true,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** list_projects' `agents` field is now
        # exactly `agentsVisibleTo`'s reach-walk with no running-state filter — the code's own
        # comment says so: "Never whether one runs (05 rule 5). `running` stood here and listed the
        # conversations this app was running — a process fact...". This is D-017's deliberate
        # removal of list_projects' process fields (card: "list_projects drops its process fields");
        # there is no running-vs-not distinction left to corrupt. Its anchor is left stale, so the
        # census records it retired.
        "M28 · `list_projects` counts a conversation the quit closed as RUNNING · "
        f"killed by `{KILLER}`",
        [(HOST, "        (card) => card.project === slug && card.state !== 'open-nothing-running',\n",
          "        (card) => card.project === slug,\n")],
    ),
    (
        "M29 · `withdraw_task` does not see a conversation the quit closed, and tells its parent the "
        f"task was not its own · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `withdrawTask`'s target
        # lookup is the same `slot ?? this.startable(input.agent)` shape. Dropping the fallback
        # still tells a parent its own stopped child's task was never its own, killed by the file's
        # "withdraw_task takes work back from a child that came back open" test.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — withdraw_task keeps the
        # same shape, renamed: `const target = slot ?? this.aStoppedConversation(input.agent)`.
        # Dropping the fallback still hides a quit-closed conversation from its own withdraw_task,
        # so the caller is told `no-task-you-gave-that-agent` about work it really did give out.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `withdraw_task` still sees a conversation the quit closed: `takeBackPiece` asks `const
        # target = slot ?? this.aStoppedConversation(piece.owner)` and answers 'not yours' when it
        # is missing (the commit keeps 'withdraw_task (take back, telling the owner)'). Dropping the
        # stopped-conversation fallback makes a giver's take-back of work held by a quit-closed
        # child refuse, which the restart test's withdraw arm asserts as outcome ok, told true.
        # Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '    const target = slot ?? this.aStoppedConversation(piece.owner)\n', '    const target = slot\n'),
        ],
    ),
    (
        "M30 · `withdraw_task` answers `ok` and writes nothing, so the work is still open · "
        f"killed by `{KILLER}`",
         # ⚑ **Second anchor corrected in place by `703`**, which takes back the notices this
         # closing made false between the write and the announcement. ⛔ The DEFECT is unchanged.
         # Re-verified RED individually against `a-restart-keeps-what-was-open.test.ts`.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The direct `store.append`
        # this row targeted now runs through the shared `writeIntoItsLedger`/`appendIntoItsLedger`
        # helpers, but `withdrawFromAStoppedConversation` still makes exactly one call to write the
        # `task_withdrawn` row. Skipping that one call still answers `ok` while the task stays open,
        # killed by the file's test asserting the task's state becomes `'withdrawn'`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The take-back
        # of work held by a stopped owner is still a write into that owner's ledger: `else
        # this.writeIntoItsLedger(piece.owner, takenBack)` with a `work_taken_back` event, where the
        # old code wrote `task_withdrawn`. Skipping the write makes `withdraw_task` answer ok while
        # the piece stays open, which the restart test's withdraw arm catches by reading the piece's
        # state back as 'withdrawn'. Killed by `a-restart-keeps-what-was-open.test.ts`.
        # ⚑ Re-anchored in place, not retired — a stopped owner's take-back row is now written by
        # `endThePiece`'s branch for an owner nothing runs, in one transaction with the endings of the
        # questions passed up about the piece. Skipping that write still answers ok while the piece
        # stays open, which the restart test's withdraw arm catches. Killed by
        # `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, "    if (session === null) {\n      try {\n        write()\n", "    if (session === null) {\n      try {\n        if (false) write()\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The defect is a push saying "has ended" about a child the quit left open. Its subject is
        # gone: "There is no conversation_ended stall cause", and "the kept-open receipt and
        # notices" were removed, so no sentence in `UNDRIVEN_SENTENCES` says a conversation ended.
        # The killer test now asserts the turn's cause instead (`toContain(ITS_TURN_WAS_STOPPED)`),
        # and nothing in today's code can be planted into an "ended" claim. Its anchor is left
        # stale, so the census records it retired.
        "M31 · the parent is pushed *has ended* about a child the quit left open · "
        f"killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 reads the fact once, above the notice, for its words and its report. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `tellOneParent`'s
        # `keptOpen` boolean now reads `this.aMessageStartsIt(task.assignedTo) &&
        # this.withinMessagingReach(...)` in place of `this.keptOpen(...) !== null && …` — same
        # two-clause shape, now covering a holder mid-stop too. Forcing the first clause `false`
        # still pushes "has ended" about a child that is in fact still reachable, killed by the
        # file's "its parent is told its child is OPEN, not that its conversation has ended" test.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — tellOneParent's
        # `keptOpen` is still the two-clause `this.aMessageStartsIt(task.assignedTo) &&
        # this.withinMessagingReach(...)` (now on one line for the reach call rather than split
        # across several). Forcing the first clause `false` still pushes the 'has ended' wording
        # about a child the quit left reachable, instead of the KEPT_OPEN_UNDRIVEN sentence.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'told it
        # is still open' rule is unchanged in `tellOneParent`: `keptOpen` is still
        # `aMessageStartsIt(holder) && withinMessagingReach(holder, giver)`, with only
        # `task.assignedTo` renamed `piece.owner`. Forcing the first arm false pushes the parent
        # 'the conversation it was given to has ended' about a child the quit left open, which the
        # parent-told, notice-report and section 8 kept-open arms assert against. Killed by
        # `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '      const keptOpen =\n        this.aMessageStartsIt(piece.owner) &&\n        this.withinMessagingReach(piece.owner, { ownerId: agentCallerId(parent.id) }, parent.id)\n', '      const keptOpen =\n        false &&\n        this.withinMessagingReach(piece.owner, { ownerId: agentCallerId(parent.id) }, parent.id)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The `givenToIs ===
        # 'open-nothing-running'` gate this row weakened is gone from agent-tools.ts. `taskText`'s
        # own docblock states the replacement design directly: a `conversation_ended` stall always
        # says the conversation stopped, and `given_to_is` (the one state) is printed beside it —
        # "never a second, process-shaped reading of it here" (D-017 R11). There is no conditional
        # left to defeat. Its anchor is left stale, so the census records it retired.
        "M32 · `list_tasks` says *has ended* about a holder the quit left open · "
        f"killed by `{KILLER}`",
        [(TOOLS, "          task.stalledBecause === 'conversation_ended' && givenToIs === 'open-nothing-running'\n",
          "          task.stalledBecause === 'conversation_ended' && givenToIs === 'open-nothing-running' && false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The correction "that conversation was started again after you were told it had stopped" is
        # deleted from `reply-rails.ts` (0 occurrences of "was started again"). The commit removes
        # "every set-right, correction", and `the-wakes-last-stale-sentences.test.ts` records "No
        # correction is sent now". Its anchor is left stale, so the census records it retired.
        "M33 · the correction misquotes the notice it corrects — *after you were told it had ended* · "
        f"killed by `{WAKE_KILLER}`",
        # ⚑ **RE-ANCHORED at `698`, not retired**: the opener answers what both notices said
        # (`692` F-e), so the clause now reads *"that conversation was started again after you were
        # told it had stopped"*. The row still makes it misquote the kept-open notice as *"had ended"*.
        [(REPLY, "that conversation was started again after you were told it had stopped.",
          "that conversation was started again after you were told it had ended.")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The `itStarts` ternary this row
        # targeted is gone — agent-tools.ts's sent-branch is now one unconditional sentence ("has
        # been sent it straight away as …") for every recipient state, and the surrounding docblock
        # states the reason directly: "a conversation that is not running is started for it … so the
        # receipt says what reached it and never whether it ran." Its anchor is left stale, so the
        # census records it retired.
        "M34 · `message_agent` says *was idle* about a conversation its own message started · "
        f"killed by `{KILLER}`",
        [(TOOLS, "            const itStarts = host.agentCard(agent, by, me)?.state === 'open-nothing-running'\n",
          "            const itStarts = false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The no-slot branch of `close()` that
        # ran `forgetTheQuitOf` is gone: `close()` is now a tolerant no-op with no slot, and no
        # conversation is open only because a quit left it that way. D-017b: "No End conversation
        # button, no kept-open pane, no reading-only pane, no Reopen / Take it over / Read the
        # recording presses: one press, 'Open the conversation'." Its anchor is left stale, so the
        # census records it retired.
        "M35 · a person's Close of a conversation the quit closed does nothing, so it stays open for "
        f"ever · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `close()`'s no-slot
        # branch still gates `forgetTheQuitOf` on `sessionSpeakingAs(by) === null &&
        # this.aQuitLeftItOpen(sessionId)`, the same shape as the old `keptOpen(...) !== null`
        # check. Appending `&& false` still makes a person's Close of a quit-kept-open conversation
        # do nothing, leaving it open forever.
        [
            (HOST, '      if (sessionSpeakingAs(by) === null && this.aQuitLeftItOpen(sessionId)) {\n', '      if (sessionSpeakingAs(by) === null && this.aQuitLeftItOpen(sessionId) && false) {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone: `forgetTheQuitOf`
        # no longer exists, and a provider-refused start no longer 'leaves it offered open' because
        # nothing is offered open. The surviving rule, that a start the provider can never serve
        # replaces the conversation (R10, `itCanNeverBeReopened`), is already planted by table 1017
        # M110, whose edit is `seen.noSuchSession) return false`. Re-anchoring here would duplicate
        # it. Its anchor is left stale, so the census records it retired.
        "M36 · a start the provider can never serve leaves it open, so it is offered open for ever · "
        f"killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 706, not retired.** `706` reads the adapter's `noSuchSession` where this read *"no `cause`"* (`705` F-3). The DEFECT this row plants is unchanged: the whole let-go is removed.
        [(HOST, "        if (error instanceof ResumeError && error.noSuchSession) {\n          this.forgetTheQuitOf(sessionId)\n        }\n", "")],
    ),
    (
        # ⚑ Landing D-017b (3af91dcb) · killer:
        # `a-message-held-by-a-conversation-started-again-is-a-crashs-not-the-quits.test.ts` (the
        # landing added it: quit, reopen, hold a message, crash, relaunch).
        "M37 · R34c, undone · a reopen leaves the stamp, so a conversation started and then crashed "
        f"comes back open · killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 clears its own mark on the next line, so the anchor ends at that line's comment; the row still removes only the stamp's clearing. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The plant deletes the one clearer of closed_by_the_quit_at, in reopenTx
        # (session-store.ts ~9238). That is the stamp's only eraser, and runtime-host.ts:5105
        # (stillOpen) and reopenTheQuestionsAQuitLeftOpenTx still read it. So a conversation
        # reopened after a quit and then crashed keeps its stamp, and the next launch treats what it
        # held as a quit's and leaves it waiting instead of settling it as a crash's. I read every
        # test touching the stamp or the quit/reopen/crash shape and none of them goes red on this
        # plant, including all of a-restart-keeps-what-was-open.test.ts as it stands. Its R34c arms
        # (~
        [
            (STORE, '    clearClosedByTheQuit.run(sessionId)\n    const row = selectStatus.get(sessionId)', '    const row = selectStatus.get(sessionId)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `closed-threads.ts` and its `keptOpen`
        # fold field were deleted, and `closed-threads.test.ts` was re-aimed at
        # `conversation-list.ts`, which has no such field. D-017b: "One Conversations list in the
        # rail and the palette, each row with the shared state: no open / closed / kept-open split."
        # Its anchor is left stale, so the census records it retired.
        "M38 · the fold drops the fact, so the row is a closed one · "
        f"killed by `{FOLD_KILLER}`",
        [(FOLD, "      keptOpen: session.keptOpenAcrossAQuit,\n", "      keptOpen: false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The plate's `started: !row.keptOpen`
        # line went with `closed-threads.ts`. `ListedConversation` carries the shared `state`, and
        # no plate draws an open conversation as ended. D-017b removed the open / closed split this
        # row guarded. Its anchor is left stale, so the census records it retired.
        "M39 · the plate draws an open conversation ENDED — the status the quit wrote · "
        f"killed by `{FOLD_KILLER}`",
        [(FOLD, "        started: !row.keptOpen,\n", "        started: true,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The R34c hover and the 'open, nothing
        # running' words belonged to the `gesture === 'reopen'` branch of the deleted fold. D-017b:
        # "No sentence says whether a process runs." Its anchor is left stale, so the census records
        # it retired.
        "M40 · the row loses its words — open, nothing running — and R34c's hover · "
        f"killed by `{FOLD_KILLER}`",
        [(FOLD, "  if (row.keptOpen && row.gesture === 'reopen') {\n",
          "  if (row.keptOpen && row.gesture === 'reopen' && false) {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `endedUnfinished` word under
        # 'open' was a sentence in the deleted fold. D-017b: "No sentence says whether a process
        # runs" and the split it sat under is gone. Its anchor is left stale, so the census records
        # it retired.
        "M41 · a last turn the quit stopped loses its word under *open* · "
        f"killed by `{FOLD_KILLER}`",
        [(FOLD, "    if (endedUnfinished(row.lastEnding)) {\n      const ago = agoWords(row.updatedAt, row.now)\n",
          "    if (endedUnfinished(row.lastEnding) && false) {\n      const ago = agoWords(row.updatedAt, row.now)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The rail's `not-running && !keptOpen`
        # Closed conversations filter no longer exists: `SideRail.vue` draws one list of `rows`.
        # D-017b: "One Conversations list in the rail and the palette … no open / closed / kept-open
        # split." Its anchor is left stale, so the census records it retired.
        "M42 · the rail files an open conversation under Closed conversations · "
        f"killed by `{RAIL_KILLER}`",
        [(RAIL, "  foldedRows.value.filter((row) => row.running === 'not-running' && !row.keptOpen),\n",
          "  foldedRows.value.filter((row) => row.running === 'not-running'),\n")],
    ),
    (
        "M43 · the Conversations count leaves out the open rows it draws · "
        f"killed by `{RAIL_KILLER}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The count rule survives
        # in the one list: the Conversations count must equal the rows drawn. `openCount` is now
        # `rows.value.length`, where the old sum was `props.open.length +
        # keptOpenRows.value.length`. Counting only `props.open`, the records this window holds,
        # leaves out every row the list draws from the host, which is the label's defect.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — 4c1718d7 split the one Conversations list into BroBot's and Other agents'
        # sections and deleted `openCount`; each section's header now draws `section.rows.length`
        # and the DOM tests read `rail-count-brobot` and `rail-count-agents`. The rule survives per
        # section: a section's count must equal the rows it draws. The plant counts only the rows
        # this window holds open (`props.open`), leaving out every host-listed row the section
        # draws, which is the label's defect; the template already reads `props.` so no
        # ReferenceError. Killed by `closed-rail.dom.test.ts`,
        # `brobot-and-the-other-agents-fold-apart.dom.test.ts`.
        [
            (RAIL, '              section.rows.length\n', '              section.rows.filter((row) => props.open.some((each) => each.sessionId === row.sessionId)).length\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The palette has one band:
        # `PALETTE_GROUPS` is this, conversations, go, agent, and the `takeOver ? 'running' :
        # keptOpen ? 'conversations' : 'closed'` line is gone, so there is no Closed band to file a
        # conversation in. D-017b: "One Conversations list in the rail and the palette, each row
        # with the shared state: no open / closed / kept-open split." Its anchor is left stale, so
        # the census records it retired.
        "M44 · the palette files an open conversation in the Closed band · "
        f"killed by `{PALETTE_KILLER}`",
        [(PALETTE, "      group: takeOver ? 'running' : row.keptOpen ? 'conversations' : 'closed',\n",
          "      group: takeOver ? 'running' : 'closed',\n")],
    ),
    (
        "M45 · every start that fails closes it, so a failure of ONE attempt — an app-server that died "
        f"in the handshake — closes a conversation that could have been started again · killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 706, not retired.** `706` reads the adapter's `noSuchSession` where this read *"no `cause`"* (`705` F-3). The DEFECT this row plants is unchanged: every refused start closes it.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds: a
        # failure of one attempt must not let go of a conversation that could be started again. Only
        # a `ResumeError` marked `noSuchSession` or an unavailable of `never-started` may replace it
        # (R10). The 'closes it' of the label is now 'replaces it with a new conversation', so the
        # plant widens `itCanNeverBeReopened` to any `ResumeError`.
        [
            (HOST, '    if (seen instanceof ResumeError && seen.noSuchSession) return true\n', '    if (seen instanceof ResumeError) return true\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** A person's Close no longer leaves a
        # stamp that 'comes back open' as a listed state, because there is no open or closed
        # listing. The pre-stamp write it guarded is now only an input to the R3 and D-009 sweeps.
        # D-017b: "no open / closed / kept-open split." Its anchor is left stale, so the census
        # records it retired.
        "M46 · a person's Close of a conversation still STARTING leaves its stamp, so it comes back "
        f"open · killed by `{KILLER}`",
        [(HOST, "    if (by !== THE_APP_ITSELF && sessionSpeakingAs(by) === null) this.forgetTheQuitOf(sessionId)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `endedByItsParent` no longer exists
        # anywhere in runtime-host.ts (grep confirms), and `endAgent` itself — the only caller that
        # set and later returned on this stamp — is gone with `end_agent` per the commit message.
        # The whole mechanism this row targeted was deleted on purpose, not reshaped. Its anchor is
        # left stale, so the census records it retired.
        "M47 · a parent's end of a child whose start is in flight leaves its stamp, so it comes back "
        f"open · killed by `{KILLER}`",
        [(HOST, "    if (slot.session !== null) slot.session.endedByItsParent = sessionSpeakingAs(by)\n",
          "    if (slot.session !== null) slot.session.endedByItsParent = sessionSpeakingAs(by)\n    return this.close(sessionId, THE_APP_ITSELF).then(() => 'ended' as const)\n")],
    ),
    (
        # ⚠️ Landing D-017 (45a11477) · a KNOWN SURVIVOR: on a live task `aMessageStartsIt(holder)`
        # and the reach check can never disagree, so flipping `&&` to `||` changes nothing a test
        # can see. The rule holds structurally; the row is kept so a later change that lets them
        # disagree is measured.
        # ⚠️ **EQUIVALENT MUTANT on the tree, recorded rather than removed (landing D-016b part
        # 2):** The plant swaps `&&` for `||` in the keptOpen decision of tellOneParent. It is an
        # equivalent mutant: the holder of a piece is always a helper its giver started, so
        # withinMessagingReach is true whenever a target exists, and aMessageStartsIt agrees with
        # it. For a replaced holder the slot is abandoned and nothing is startable, so both sides
        # are false. The other disagreeing cases (adopted, bundle and user-home holders) cannot hold
        # a piece. The row's own comment already marks it a KNOWN SURVIVOR. No test can kill it, so
        # it stays unrun.
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `keptOpen` computation (`aMessageStartsIt && withinMessagingReach`) is deleted from
        # `tellOneParent`. The push no longer says a holder is open or ended: "Gone with it: the
        # kept-open receipt and notices". The push and `list_tasks` therefore cannot disagree about
        # whether a giver can reach a holder. Its anchor is left stale, so the census records it
        # retired.
        "M48 · the push calls a holder open to a giver that may not reach it, and contradicts the "
        f"`list_tasks` line that giver reads · killed by `{KILLER}`",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 reads the fact once, above the notice, for its words and its report. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same `tellOneParent`
        # expression as M31 (`this.aMessageStartsIt(task.assignedTo) &&
        # this.withinMessagingReach(...)`). Weakening `&&` to `||` still would call a holder open to
        # a giver `withinMessagingReach` refuses, killed the same way this row was killed before the
        # rewrite — see other_notes for a caveat on how reachable that scenario actually is.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same `tellOneParent` site
        # as M31, reformatted the same way. A prior landing pass (D-017 commit 2, 45a11477) already
        # flagged this exact `&&`-to-`||` plant as a structural KNOWN SURVIVOR — on any live task
        # `aMessageStartsIt(holder)` and `withinMessagingReach(...)` cannot currently be made to
        # disagree by a reachable test, so no assertion sees the difference — but kept it
        # re-anchored rather than retired because the invariant is real and nothing in this commit
        # removed it on purpose. I re-anchor it in place on the same precedent.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The expression
        # this row weakens is intact: `keptOpen` still requires both that a message starts the
        # holder and that the giver may reach it, so the push cannot contradict the `list_tasks`
        # line that giver reads. Only `task.assignedTo` became `piece.owner`. Prior landings
        # recorded it as a structural KNOWN SURVIVOR (for a piece its giver commands,
        # `aMessageStartsIt` and the reach check cannot disagree in a reachable test), and D-016
        # removed nothing that would change that, so it stays anchored and no test is expected to go
        # red. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '      const keptOpen =\n        this.aMessageStartsIt(piece.owner) &&\n        this.withinMessagingReach(piece.owner, { ownerId: agentCallerId(parent.id) }, parent.id)\n', '      const keptOpen =\n        this.aMessageStartsIt(piece.owner) ||\n        this.withinMessagingReach(piece.owner, { ownerId: agentCallerId(parent.id) }, parent.id)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `holderKeptOpen` is removed from the wire types, from `WorkGivenOut` and from
        # `StalledWork`, and `workGivenOutBy(sessionId)` no longer takes the predicate. The commit
        # removes "the window's left-open and idle words", so no band draws "has ended" or "open"
        # from a process fact. Its anchor is left stale, so the census records it retired.
        "M49 · the host never tells the band its holder came back open, so a person reads *has ended* "
        f"beside a rail drawing it open · killed by `{KILLER}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The `StalledWork` row's
        # `holderKeptOpen` field now reads `this.startable(task.assignedTo) !== null` in place of
        # `this.keptOpen(...) !== null` — identical role. Forcing it `false` still contradicts the
        # rail's own card, killed by the file's repeated `holderKeptOpen: true` assertions (e.g.
        # after `end_agent` on a sibling, and in the stalled-work band listing).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # stalled-work band row still carries `holderKeptOpen: this.startable(piece.owner) !== null`
        # (was `task.assignedTo`), so a person's first screen agrees with the rail that draws the
        # child open. Forcing it false makes the band read 'has ended' beside an open rail, which
        # the band arm ('the PERSON is told the same') and the Work tab arms assert with
        # `holderKeptOpen: true`. Killed by `a-restart-keeps-what-was-open.test.ts`.
        [
            (HOST, '            holderKeptOpen: this.startable(piece.owner) !== null,\n', '            holderKeptOpen: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `holderKeptOpen && because === 'conversation_ended'` conjunct is deleted;
        # `stalledWorkSaid` now reads only `undrivenSentence(work.because)`. The row protected the
        # kept-open branch and the "two R54 leads" the commit removes. The person and the parent
        # still read the same table, so no fact remains for this plant to ignore. Its anchor is left
        # stale, so the census records it retired.
        "M50 · the band's sentence ignores the fact, so the person and the parent are given two accounts "
        f"of one event · killed by `{KILLER}`",
        [(BAND, "    work.holderKeptOpen && work.because === 'conversation_ended'\n",
          "    false && work.because === 'conversation_ended'\n")],
    ),
]
