"""719 · a giver that asked was told — R69 and R70.

⛔ **Ordered by the PM** from `711` F-1 and F-2: a notice the giver's own QUESTION took back was no
telling to the ledger (`702`) and still one to the slot's cache, so the two came apart — and in one
arm the holder's next ending reached nobody (R69); and R48's *"look at it with list_tasks"* pointed at
a door that showed `answered` and the outcome but not the answer's words (R70).

## ⚠️ What a row here measures

 * ⚑ **M1–M4 are R69's receipt** — the row, the slot following it, its scope (the giver's question
   and no other fact), and the fold — killed by `a-giver-that-asked-was-told.test.ts` §1.1, §1.2,
   §1.6 and §1.3; ⚑ **M11** the same scope against the withdrawal, the giver's other act (§1.12).
 * ⚑ **M5–M6 are R69 on `703`'s F-C path** — its own wake written beside the WAIT correction, and
   only there — killed by §1.4 (and `what-a-waker-reads-after-its-own-act.test.ts` §3.3) and §1.9.
   ⚠️ M6 SURVIVED its first run against `what-a-waker-reads-after-its-own-act.test.ts` alone: no test
   pinned a READ ending's wake receipts, so §1.9 was written for it.
 * ⚑ **M7 is the raw stream's word** — killed by §1.8.
 * ⚑ **M12–M13 are `404`'s rule, which R69 first broke** (`719`'s review): an ending the giver
   asked for itself re-arms no `'set-right'` — the pump's push, and the teardown's own receipt —
   killed by §1.10 and §1.11; ⚑ **M14–M15 its bound** (round two): not while a notice about the
   work is still held — killed by §1.13.
 * ⚑ **M8–M9 are R70** — the words carried from the reply, onto `list_tasks`' row — killed by §2.1.
   ⚠️ **`724` removed M10** (R84): it planted the work's text as an OPEN row's words in the fold,
   and R84 gates the door on an answer that reached nobody, so those words reach no reader and the
   row planted an equivalent. Its coverage is `724` M1, with that table's §1.2.

## ⛔ What has NO row here, and who holds it instead

 * ⚠️ **The F-C row's `!tookItBack` clause**: it stops a SECOND `its-own-wake` when the waker's own
   ending was followed by a held notice the wake took back (which writes one already). No rig holds
   an own ending and then a held notice about the same work at a wake, and a duplicate row folds the
   same — so a row planted there would survive as an equivalent. Stated, not dressed as a row.
 * ⚠️ **`publishStateIfChanged` after the taking back** — the harnesses' sinks drop `sendLiveness`,
   as `690`'s, `699`'s, `703`'s and `711`'s tables say of theirs.
 * ⚠️ **The prose rows** — docblocks, which no test reads (standing rule 19).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"
KILLER = "a-giver-that-asked-was-told.test.ts"
WAKER = "what-a-waker-reads-after-its-own-act.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · R69 — the giver's own question is a telling ──────────────────────────────────────────
    (
        "M1 · 🔴 R69 undone · `main`'s code exactly: the giver's question takes its push back and "
        "writes nothing, and the slot keeps its word · the ledger has no word, and the person's band "
        f"lists the work beside a live giver · killed by `{KILLER}` §1.1",
        # ⚑ The whole block (`719`'s review): removing only the receipt would leave the read-back,
        # which in the correction shape writes the OLD ledger word into the slot — `711`'s withdrawn fix.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R69 survives
        # in takeBackWhatALaterFactMadeFalse: `if (fact === 'asked-about-it')` still writes the
        # giver's own question as a telling and reads the ledger's word back into the slot. The
        # event is now work_stall_told with piece: piece.piece, and the read-back uses
        # workReportedTo(parent.id).get(piece.piece). Killed by
        # `a-giver-that-asked-was-told.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — R69
        # stands, but the block that writes `work_stall_told` and reads the slot back now serves
        # both `'asked-about-it'` (its-own-question) and D-016c's `'rebriefed'` (its-own-brief),
        # with a rewrapped comment above it, so the old text matches nothing. A whole-block deletion
        # would also undo the new rebrief write, so the plant keeps the rebrief arm and drops only
        # the question: the giver's question takes its push back and writes nothing. Killed by
        # `a-giver-that-asked-was-told.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule (a giver's own question counts as a telling even when the message is retracted)
        # still holds, but it is now carried by the fold in toldIn (session-store.ts), which voids
        # only receipts whose message was 'abandoned'. The plant restores the old behaviour (a
        # 'retracted' message also voids the receipt), so workReportedTo(pm).has(piece) turns false
        # and the stalled-work band lists the work beside a live giver. The old anchor was the
        # pre-D-016c fold line; the new one is the single-condition `continue` line inside toldIn
        # (count 1). Killed by `a-giver-that-asked-was-told.test.ts`.
        [
            (STORE, "      if (event.type !== 'message_unqueued' || event.reason !== 'abandoned') continue\n", "      if (event.type !== 'message_unqueued') continue\n      if (event.reason !== 'abandoned' && event.reason !== 'retracted') continue\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The R69 slot read-back (`if (nowTold !== undefined) parent.toldAboutStall.set(piece.piece,
        # nowTold)`) is deleted: toldAboutStall is now a Set<string> that nothing leaves, and there
        # is no `nowTold` to follow. Commit 8d54d6dc says "its giver is told once, when it stalls. A
        # stop, a reopen and a start tell nobody anything and announce no work." The told-once
        # dedupe is `parent.toldAboutStall.has(piece.piece)` in tellIfNobodyHasYet, which is a
        # different subject and has no row today (see other_notes). Its anchor is left stale, so the
        # census records it retired.
        "M2 · ⛔ the slot does not follow the ledger · it keeps the push's cause, so the holder's "
        f"later ending is never told to the live giver · killed by `{KILLER}` §1.2",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # slot-follows-the-ledger read-back survives as `if (nowTold !== undefined)
        # parent.toldAboutStall.set(piece.piece, nowTold)` in the same R69 block (task.taskId became
        # piece.piece). Killed by `a-giver-that-asked-was-told.test.ts`.
        [
            (HOST, '          if (nowTold !== undefined) parent.toldAboutStall.set(piece.piece, nowTold)\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The R69 write block (`if (fact === 'asked-about-it' || fact === 'rebriefed') {
        # this.publishOurs(parent, {...its-own-question...}) }`) no longer exists:
        # takeBackWhatALaterFactMadeFalse writes no receipt at all. Commit 8d54d6dc: "Gone with it:
        # ... every set-right, correction and wake take-back. The only receipt written is pushed". A
        # plant that makes every later fact write a receipt has no anchor left;
        # WorkStallSetRightEvent survives only as a type for old ledgers. Its anchor is left stale,
        # so the census records it retired.
        "M3 · ⛔ every later fact writes `its-own-question` · an answer that lands, which the giver did "
        f"not cause, is recorded as its own question · killed by `{KILLER}` §1.6",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # guard on the R69 write is now `fact === 'asked-about-it' || fact === 'rebriefed'` and its
        # comment was rewrapped, so the old two-line anchor matches nothing. The new anchor is the
        # `if` line plus the following `this.publishOurs(parent, {` (count 1), and the plant makes
        # every later fact write a receipt, which stamps `its-own-question` on an answer or
        # withdrawal the giver did not cause. Killed by `a-giver-that-asked-was-told.test.ts`.
        [
            (HOST, "        if (fact === 'asked-about-it' || fact === 'rebriefed') {\n          this.publishOurs(parent, {\n", '        if (fact === fact) {\n          this.publishOurs(parent, {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The fold that read a non-'pushed' work_stall_told (its-own-question / set-right) has been
        # deleted from session-store.ts: there is no lastToldIn, no 'set-right' value and no
        # `event.how` reading in the ledger. Commit 8d54d6dc: "a receipt stands unless its message
        # was abandoned. Old ledgers read inertly ... old receipts count as told, and
        # WorkStallSetRightEvent stays a type nothing writes". The row's subject (the ledger's cause
        # after the giver's own question) is gone. Its anchor is left stale, so the census records
        # it retired.
        "M4 · ⛔ the fold reads `its-own-question` as told nothing · the ledger falls back to *null*, "
        f"so the holder's next ending reaches nobody once the giver is gone · killed by `{KILLER}` §1.3",
        # ⚑ The anchor `661 M21` and `673 M10` share: each nulls its own member, this one R69's.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The fold in
        # session-store.ts lastToldIn still reads a non-'pushed' work_stall_told (its-own-wake and,
        # since 719, its-own-question) as 'set-right', but the comment block moved two spaces left
        # and the value list lost null (LastToldAboutWork is now TaskStallCause | 'kept-open' |
        # 'set-right'). The plant uses a still-valid word, 'turn_ended', so the ledger reads the
        # giver's own question as the push's cause and no ending is owed. Killed by
        # `a-giver-that-asked-was-told.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired —
        # lastToldIn still folds `its-own-question` into 'set-right'; D-016c added `its-own-brief`
        # to the same else-branch and rewrapped the comment, so the old comment line matches
        # nothing. The new anchor is the last comment line plus `'set-right',` (count 1), shared
        # with 673 M10; the plant reads `its-own-question` as `turn_ended`. Killed by
        # `a-giver-that-asked-was-told.test.ts`.
        [
            (STORE, "            // exactly as from a correction that was sent.\n            'set-right',\n", "            // exactly as from a correction that was sent.\n            event.how === 'its-own-question' ? 'turn_ended' : 'set-right',\n"),
        ],
    ),
    # ── §B · R69 on `703`'s F-C path ─────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** R69's F-C half is gone with
        # its premise. The test file says: '§1.4 retired with end_agent (D-017, commit 3). It
        # measured 703's F-C path, which began with the parent ENDING its child itself (told
        # nothing, its-own-ending); nothing ends a conversation now, so that path has no first
        # step.' The anchor `if (toldItNothing && itWokeIt && !tookItBack)
        # this.publishItsOwnWake(...)` and the `null` word of LastToldAboutWork left runtime-host.ts
        # and runtime-ipc.ts in 5e931be8, and the WAKER file's §3.3 is retired too. Its anchor is
        # left stale, so the census records it retired.
        "M5 · 🔴 R69's F-C half undone · the waker's own wake is not written beside its WAIT "
        "correction, so when the question's ending takes that correction back the ledger falls back "
        f"to its own ending · killed by `{KILLER}` §1.4 and `{WAKER}` §3.3",
        [(HOST, "    if (toldItNothing && itWokeIt && !tookItBack) this.publishItsOwnWake(parent, task)\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Its killer §1.9 is gone. The
        # test says: 'D-017 R4 - §1.9 went with its premise ... a waker that READ the ending writes
        # no its-own-wake beside its WAIT correction ... 719's M6 named it as its killer.' The
        # `toldItNothing` line M6 plants on was removed by 5e931be8, and setRightAWait no longer has
        # an its-own-wake write of its own. The other its-own-wake write is
        # retractWhatItsWakeMadeFalse, which is R32 and another table's. Its anchor is left stale,
        # so the census records it retired.
        "M6 · ⛔ every waker's WAIT correction writes `its-own-wake` · a waker that READ the ending is "
        f"recorded as if its wake were its only telling · killed by `{KILLER}` §1.9",
        [(HOST, "    if (toldItNothing && itWokeIt && !tookItBack) this.publishItsOwnWake(parent, task)\n", "    if (itWokeIt && !tookItBack) this.publishItsOwnWake(parent, task)\n")],
    ),
    (
        "M7 · ⛔ the raw stream reads `its-own-question` as a correction · a person reading the Events "
        f"tab is told *\"that conversation was started again\"* about the giver's own question · killed by `{KILLER}` §1.8",
        [(DESCRIBE, "          : event.how === 'its-own-question'\n", "          : event.how === 'its-own-question' && false\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The withdrawal-writes-its-own-question plant sat on the R69 `if (fact === 'asked-about-it'
        # || fact === 'rebriefed')` write guard, which was deleted with the rest of the take-back
        # receipts. Commit 8d54d6dc: "Gone with it: ... every set-right, correction and wake
        # take-back. The only receipt written is pushed." The design now is that no take-back writes
        # any receipt, so a withdrawal cannot be recorded as anything; the existing 'a stop /
        # take-back writes no receipt' assertion in a-giver-that-asked-was-told.test.ts covers the
        # outcome but has no anchor for this plant. Its anchor is left stale, so the census records
        # it retired.
        "M11 · ⛔ a withdrawal writes `its-own-question` · the giver's own act that CLOSES the work is "
        f"recorded as its question, which R69 does not name · killed by `{KILLER}` §1.12",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # `if` that guards the R69 write is now `fact === 'asked-about-it' || fact === 'rebriefed'`,
        # so the old single-condition line matches nothing. The new eight-space `if` line is unique
        # (count 1); the plant adds `|| fact === 'withdrawn'`, so the giver's own act that closes
        # the work is recorded as its question. Killed by `a-giver-that-asked-was-told.test.ts`.
        [
            (HOST, "        if (fact === 'asked-about-it' || fact === 'rebriefed') {\n", "        if (fact === 'asked-about-it' || fact === 'rebriefed' || fact === 'withdrawn') {\n"),
        ],
    ),
    # ── §B2 · `404`'s rule, which R69 first broke (`719`'s review) ────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The test file's own docblock says it
        # outright: "§1.10, §1.11 and §1.13 retired with `end_agent` (D-017, commit 3)... Nothing
        # ends a conversation now, and an agent cannot stop one it gave work to, so no stop is the
        # giver's own act." `session?.endedByItsParent` and the whole re-arm-on-own-ending branch
        # this row plants no longer exist in runtime-host.ts. Its anchor is left stale, so the
        # census records it retired.
        "M12 · 🔴 an ending the giver asked for re-arms its `'set-right'` · the pump pushes *\"has "
        "ended\"* about the giver's own end_agent, after its question or a correction · killed by "
        f"`{KILLER}` §1.10 and §1.11",
        [(HOST, "    if (\n      lastTold === 'set-right' &&\n      this.slots.get(task.assignedTo)?.session?.endedByItsParent === parent.id &&\n      !this.tasksWithANoticeHeldFor(parent.id).has(task.taskId)\n    )\n      return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same retirement as M12 — the pump's
        # `'set-right'`-over-its-own-ending guard existed only for `end_agent`'s
        # giver-ends-its-own-worker case, which D-017 removed (`end_agent`/`resume_agent` are gone,
        # 21 tools). `a-giver-that-asked-was-told.test.ts` §1.10/§1.11, the row's named killer, no
        # longer exercise this path either. Its anchor is left stale, so the census records it
        # retired.
        "M13 · ⛔ its own ending is not written over `'set-right'` · the ledger stays owed the ending, so "
        "with the giver gone the band lists what it ended itself, and its next registration pushes it "
        f"· killed by `{KILLER}` §1.10 and §1.11",
        [(HOST, "          this.deps.store.workReportedTo(parent.id).get(task.taskId) === 'set-right' &&\n", "          false &&\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** §1.13, this row's killer, is explicitly
        # retired in the test file for the same reason: an agent can no longer end a conversation it
        # gave work to, so there is no 'giver's own ending, held correction' case left for the
        # pump-skip logic this row deletes to matter. Its anchor is left stale, so the census
        # records it retired.
        "M14 · 🔴 the pump skips the ending with a correction still HELD · the giver's last word about "
        "a conversation it has ended is *\"…that conversation was started again…\"* — false (`719`'s "
        f"review, round two) · killed by `{KILLER}` §1.13",
        [(HOST, "      this.slots.get(task.assignedTo)?.session?.endedByItsParent === parent.id &&\n      !this.tasksWithANoticeHeldFor(parent.id).has(task.taskId)\n", "      this.slots.get(task.assignedTo)?.session?.endedByItsParent === parent.id\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same as M14: the teardown's
        # 'its-own-ending' write this row un-guards existed to record a giver's own `end_agent` act,
        # which is gone. The card confirms this is deliberate: 'Words the change made false are
        # rewritten' and the giver-ended mechanism is nowhere in the new runtime-host.ts. Its anchor
        # is left stale, so the census records it retired.
        "M15 · ⛔ the teardown writes its own ending over a push it did not make · with a correction "
        "held, the pump pushed the ending, and the record says `its-own-ending` beside it · killed by "
        f"`{KILLER}` §1.13",
        [(HOST, "          this.deps.store.workReportedTo(parent.id).get(task.taskId) === 'set-right' &&\n          !this.tasksWithANoticeHeldFor(parent.id).has(task.taskId)\n", "          this.deps.store.workReportedTo(parent.id).get(task.taskId) === 'set-right'\n")],
    ),
    # ── §C · R70 — the pointer leads to the words ────────────────────────────────────────────────
    (
        "M8 · 🔴 R70 undone at the fold · the reply's words are not carried onto the row, so "
        f"`list_tasks` shows `answered` and no words · killed by `{KILLER}` §2.1",
        [(TASKS, "        summary: event.summary,\n", "        summary: null,\n")],
    ),
    (
        "M9 · 🔴 R70 undone at the door · the row carries the words and `list_tasks` does not hand "
        f"them on · killed by `{KILLER}` §2.1",
        # ⚑ Re-anchored by `724` (R84): the words ride only on a row that reached nobody; the row
        # still drops them there.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R70 at the
        # door survives in agent-tools.ts: `...(piece.answerReachedNobody ? { summary: piece.summary
        # } : {}),` on list_tasks' row (task became piece; 724/R84 gating unchanged). Killed by
        # `a-giver-that-asked-was-told.test.ts`.
        [
            (TOOLS, '  ...(piece.answerReachedNobody ? { summary: piece.summary } : {}),\n', ''),
        ],
    ),
]
