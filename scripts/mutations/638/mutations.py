"""638 · work moved and nothing announced it.

⛔ **`631` §6.2, in the frontend seat's own words:** ⚑ ***"`534`'s `runtime:changed` fires on the
session-row write that creates a child; no equivalent fires when work moves between conversations.
Until one does, the only way the band can know is the 30-second poll."***

## 🔴 The property every row here is pointed at

⛔ **A change to a conversation's WORK reaches a window because the act announced it, and it does
so from ONE signal every surface reads.** ⚑ `RuntimeScreen.vue` said twice why there were only two
subjects — *"the WORK half announces nothing and keeps the tick, which is why no third subject was
added (`534`'s own rule: do not add a subject nothing reads)"* — and `631`'s two task lists are the
reader that rule was waiting for.

## ⚑ Four claims

 1. **The subject exists and is one of three** (M1). ⛔ A vocabulary member nothing produces passes
    every exhaustive check while measuring nothing; §2 of the suite is what produces it.
 2. **Every verb that moves a task's COMPOSED state announces** (M2–M6, M10). ⚠️ A row is created,
    closed or moved at thirteen places, and a silent one is a surface that goes stale for 30 s with
    no way to tell. 🔴 **It was FIVE until this dispatch's own adversarial pass**: `aWorker` is one
    of THREE halves of `WhatAConversationIsWaitingOn`, and the question/permission/proposal verbs
    move the other two.
 3. **AFTER the durable write, never before** (M7). 🔴 A window told to re-read a row that has not
    committed reads the OLD answer and believes it — standing rule 18's shape on a push.
 4. **And it is not a firehose** (M8). ⛔ `638` §3.2 names this directly.

## 🔴 The one a reader should look at first

⛔ **M7 moves the announcement ABOVE the append.** ⚑ Nothing throws, every arrival test still
passes, the subject still fires — 🔴 **and every window that obeys it reads the state from before
the act it is being told about.** ⚠️ It is the failure a person cannot detect, because the row they
see is a real row that was true a millisecond ago.

## ⛔ What this table does NOT cover, said out loud

 1. **The provider stream's stall transitions.** ⚑ A turn ending moves rows to `stalled` and is
    DELIBERATELY not announced — `deliver` appends one row per provider event, so announcing there
    costs more reads than the 30 s poll it would replace. ⚠️ **M8 is the row that guards that
    decision**, and §4 of the suite is its behavioural half.
 2. **The `needsYou` half.** ⛔ `567` §5's gap is untouched; this dispatch surveyed the work
    population and not the person's queue, and a subject claiming a population nobody measured is
    the defect `534`'s own rule names.
 3. **The renderer's task lists.** ⚑ `631` owns them on `mla/fe-1`; the one line added here is the
    arm the exhaustive `Record` makes mandatory.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1 | `apps/desktop/test/work-moved-and-nothing-announced-it.test.ts` §1 |
| M2–M6 | `…work-moved-and-nothing-announced-it.test.ts` §5 (the count of five) · M2/M3 also §2 |
| M7 | `…work-moved-and-nothing-announced-it.test.ts` §3 · announced after the write |
| M8 | `…work-moved-and-nothing-announced-it.test.ts` §4 and §5 · the firehose |
| M10 | `…work-moved-and-nothing-announced-it.test.ts` §2 · a question about the work |
| M9 | `…work-moved-and-nothing-announced-it.test.ts` §5 · one reader, no second cadence |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun`. ⚑ Each red was checked for the RIGHT reason: the
output was searched for `SyntaxError`, `Transform failed` and `error TS`.
"""

WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

GIVEN = (
    "    // 🔴 **638 · work was GIVEN** — a row is created here and nowhere else, and it opens the\n"
    "    // GIVER's `aWorker` half as well as the holder's own list. ⛔ After the append, never before.\n"
    "    this.theWorldMoved('work')\n"
)

MUTATIONS = [
    (
        "M1 · 🔴 **THE SUBJECT IS GONE FROM THE VOCABULARY** · every announcement still fires and "
        "every window drops the message, because `whenTheWorldMoves` drops a subject it does not "
        "know — ⛔ **silently, by design**. ⚑ The app is back to the 30-second poll with five "
        "announcements shouting into a reader that refuses them, which is the worst of both",
        [(WIRE, "export const RUNTIME_CHANGE_SUBJECTS = ['conversations', 'agents', 'work'] as const", "export const RUNTIME_CHANGE_SUBJECTS = ['conversations', 'agents'] as const")],
    ),
    (
        "M2 · ⛔ **WORK GIVEN announces nothing** · the one transition that CREATES a task row, and "
        "the one that opens the giver's `aWorker` half. ⚑ `631`'s two task lists stay 30 s stale "
        "on the act a person most expects to see land",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: work being GIVEN must announce 'work' so the giver's waiting-on-a-worker list
        # re-reads. In the piece model the announce lives at the tail of recordTheGive, after
        # emitOurs. Removing it must redden the arrival test and the announce-site count. Killed by
        # `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, "    // 🔴 **638 · work was GIVEN** — it opens the giver's *waiting on a worker* as well as the\n    // owner's own list. ⛔ After the write, never before.\n    this.theWorldMoved('work')\n", ''),
        ],
    ),
    (
        "M3 · ⛔ **WORK ANSWERED announces nothing** · a row closes, the giver's `aWorker` half "
        "closes with it, and neither surface is told. ⚠️ SEPARATE from M2 because a repair that "
        "announced only on creation would leave every list showing work that finished",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: an ANSWERED piece leaves the open set and must announce 'work' before the
        # delivery is awaited. The announce still sits right after the replied-with emitOurs in the
        # reply path. Removing it must redden the answered-arrival test and the count. Killed by
        # `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, "    // 🔴 **638 · work was ANSWERED** — one of the transitions that take a row out of\n    // {@link TASK_IS_OPEN}, so it closes the giver's *waiting on a worker* too. ⚑ Announced before\n    // the delivery is awaited, because what moved is the LEDGER and the delivery is a separate fact.\n    this.theWorldMoved('work')\n", ''),
        ],
    ),
    (
        "M4 · ⚠️ **WORK TAKEN BACK announces nothing** · the third closing transition, and the one "
        "a PERSON performs. ⛔ A parent withdraws work and the panel goes on drawing it as open",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: taking a piece back is a closing transition and must announce 'work'.
        # takeBackPiece still calls theWorldMoved('work') right after
        # takeBackWhatALaterFactMadeFalse. No dedicated arrival test exists for take-back, so the
        # count census is the killer. Killed by `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, "    // 🔴 **638 · work was TAKEN BACK** — a closing transition.\n    this.theWorldMoved('work')\n", ''),
        ],
    ),
    (
        "M5 · ⛔ **A CANCELLED HELD MESSAGE announces nothing** · the task it was carrying closes and "
        "nothing says so. ⚑ It is the shared helper, so this row also proves the two callers "
        "(`cancelQueuedMessage` and `withdrawTask`) cannot come to announce differently",
                # ⚑ **RE-ANCHORED at 690, not retired**: the comment above the call names a third
                # caller now (the app's own retraction, R32); the row still deletes the announcement.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: cancelling a held message closes the piece a brief was carrying, and the
        # announce sits in the shared cancel helper so no caller can differ. The helper's final
        # statement is still theWorldMoved('work'). Removing it drops the site count. Killed by
        # `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, "    // 🔴 **638 · a held message was CANCELLED**, which closes the piece a brief was carrying. ⛔\n    // Placed in the shared helper rather than at its callers, so `cancelQueuedMessage`,\n    // `takeBackPiece` and — since `690` — the app's own retraction cannot come to announce\n    // differently. ⚠️ A retracted notice closes no piece; announcing it anyway costs one re-read.\n    this.theWorldMoved('work')\n", ''),
        ],
    ),
    (
        "M6 · ⚠️ **HELD WORK SENT announces nothing** · `waiting` → `working` is a word a person "
        "reads on the row, and it is the one transition that neither opens nor closes a task — ⛔ so "
        "a reader keyed only to the open/closed boundary would miss it and look correct",
        [
            (
                HOST,
                "    // 🔴 **638 · held work was SENT** — `waiting` → `working`, a state a person reads on the row.\n    // ⚑ It opens no task and closes none, so it moves only the holder's own list.\n    this.theWorldMoved('work')\n",
                "",
            )
        ],
    ),
    (
        "M7 · 🔴 **THE ANNOUNCEMENT MOVES ABOVE THE APPEND** · nothing throws, the subject still "
        "fires, every arrival assertion still passes — ⛔ **and every window that obeys it reads "
        "the state from BEFORE the act it is being told about.** ⚠️ Standing rule 18's shape on a "
        "push instead of on a press, and the failure a person cannot detect: the row they see is a "
        "real row that was true a millisecond ago",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the announce for a given piece must come AFTER the write, so a window that
        # re-reads on being told sees the new answer. The plant moves the give's announce above the
        # store write, and removes the original, so the count stays 23 and only the ordering
        # assertion can catch it. The test's announce hook counts open pieces synchronously, so it
        # reads 0. Killed by `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, '    this.record(session, () =>\n      this.deps.store.recordGive(\n', "    this.theWorldMoved('work')\n    this.record(session, () =>\n      this.deps.store.recordGive(\n"),
            (HOST, "    // 🔴 **638 · work was GIVEN** — it opens the giver's *waiting on a worker* as well as the\n    // owner's own list. ⛔ After the write, never before.\n    this.theWorldMoved('work')\n", ''),
        ],
    ),
    (
        "M8 · 🔴 **THE FIREHOSE** · the announcement moves into `publishOurs`, so EVERY ledger "
        "append announces — including one per provider event through `deliver`. ⛔ It looks like "
        "more coverage and it is the storm `what-is-being-done.ts` names: *\"one re-read per "
        "provider event is not a channel, it is a storm\"* — ⚑ measured against the 30 s tick it "
        "costs more reads than the poll it replaces",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: 'work' is announced at each transition and never from the firehose that every
        # appended event passes through (publishOurs / recordOurs / emitOurs). The plant announces
        # from publishOurs and removes the give's own announce so the site count stays 23. The
        # plumbing slice census, which reads the first 2600 characters after publishOurs, then finds
        # the announce. Killed by `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, "    // 🔴 **638 · work was GIVEN** — it opens the giver's *waiting on a worker* as well as the\n    // owner's own list. ⛔ After the write, never before.\n    this.theWorldMoved('work')\n", ''),
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Current-turn fencing changed this boundary; the original defect and killer are preserved. No plant or table run. Held: running it needs W4 written lift.
            (HOST, "    this.emitOurs(session, written)\n", "    this.emitOurs(session, written)\n    this.theWorldMoved('work')\n"),
        ],
    ),
    (
        "M9 · ⚠️ **the renderer's arm reads a DIFFERENT population** · `work` re-reads the rail's "
        "resumable list instead of the band, so the task lists stay stale while a message arrives "
        "and something else refreshes. ⛔ Two cadences on one screen is two answers (`631` §2.1), "
        "and this is that defect arriving through the arm built to prevent it",
        # ⚑ **Anchor CORRECTED inside this dispatch** — the arm became multi-line when the Work tab
        # joined it (the adversarial pass's second finding). ⛔ The SUBJECT did not move.
        [
            (
                SCREEN,
                # Keep the library stale signal while breaking the original population refresh.
                "    work: () => {\n      filesLibrary.markStale()\n      void readTheCast()\n",
                "    work: () => {\n      filesLibrary.markStale()\n      void rail.value?.refreshResumable()\n",
            )
        ],
    ),
    (
        "M10 · 🔴 **A QUESTION ABOUT THE WORK announces nothing** · the half this dispatch nearly "
        "shipped silent. ⛔ `raiseAQuestion` moves the row to `waiting-on-an-answer` on the "
        "holder's list AND the giver's — a state 603/609 built a whole family for — and a reader "
        "keyed only to the task's own events cannot see it move. ⚑ **The count in §5 would not "
        "have caught this**: it counts call sites, and a site that was never written is not a "
        "site that went missing",
        # ⛔ **The first draft of this row mutated only a COMMENT** and reported as a survivor —
        # `a-mutation-that-changes-nothing-reports-as-a-survivor`, caught by verifying it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a QUESTION about a piece opens the answers half of the piece's state, so
        # raiseAQuestion must announce 'work' for both the holder and the giver. The announce is
        # still the last statement before the ok return. Removing it must redden the
        # question-arrival test and the count. Killed by
        # `work-moved-and-nothing-announced-it.test.ts`.
        [
            (HOST, "    // 🔴 **638 · the work moved** — `raiseAQuestion` opens the `answers` half: `question_asked` names\n    // a piece, so that piece reads `waiting-on-an-answer` on the holder's list AND the giver's.\n    // ⛔ **The children half is not the only one that composes a piece's state**: `answers` and\n    // `aPerson` do too, and a surface reading a row cannot tell which half moved it.\n    this.theWorldMoved('work')\n", ''),
        ],
    ),
]
