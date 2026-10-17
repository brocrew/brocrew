"""621 · the conversation that is waiting, with no task to say so.

⛔ **`EXT-014` §5 and `HO-095` §5.1, and they are ONE defect.** ⚑ ***"BroBot's header, avatar and
rail row read* Idle *while Task #1 was being worked on by Ada"*** — ⚠️ ***"and the right pane
already knew: This conversation has given out work."***

## 🔴 The property every row here is pointed at

⛔ **A conversation is waiting on something, the app SAYS which, and it can say it about a
conversation that holds no task row at all.** ⚑ Every fact was already folded — `aPerson` and
`aWorker` have been conversation-wide booleans since `609` — and the only PLACE the app could put
the word was a task ROW. ⚠️ A conversation a person started holds none.

## ⚑ Four claims

 1. **The ANSWER arm is load-bearing** (M1). ⛔ `whichWait` is the single ladder both projections
    go through. ⚠️ **Its PERSON arm, its WORKER arm and its ORDER are `609 M1`–`M3`**, whose anchors
    `621` corrected into this function when it lifted the ladder here — ⚑ **so those three rules are
    measured once and by their own table**, and writing them again here would be one rule with two
    rows.
 2. **The conversation's question is not the row's question** (M2–M4). 🔴 `621` §4.4 forbids
    conflating them, and M4 is that conflation written as a byte change.
 3. **The door says what it is about** (M5–M9). ⚠️ The population, the subject, the identity and
    the moment — each can be wrong on its own and each reads perfectly.
 4. **It is on the window wire and nowhere else** (M10–M11).

## 🔴 The one a reader should look at first

⛔ **M7 computes the wait and throws it away.** ⚑ The population is right, every row exists, the
shape type-checks and every reader is handed `null` for ever — 🔴 **so the app goes back to reading
*Idle* at a conversation whose work is being done by somebody else**, which is `HO-095` §5.1
verbatim. ⚠️ **It is the failure a person cannot detect**, because *idle* is exactly what they
would see if it were true.

## ⛔ What this table does NOT cover, said out loud

 1. **What each wait is CALLED on screen.** ⚠️ `waiting-on-a-worker` asks nobody for anything, so it
    is not a `Needing` and must not become the `waiting` standing; the word is the renderer's and
    `621`'s response names the three surfaces left for it.
 2. **The fold onto task rows.** ⛔ `609` owns `three-waits-one-family.test.ts` and its own rows;
    every row here takes `composeWhatEachTaskIsWaitingOn` as given, and M7 is the one that proves
    it was not quietly widened.
 3. 🔴 **THE COST ASSERTION HAS NO ROW, and that is stated rather than hidden.** ⛔ §6 counts four
    narrow reads per conversation, and **no byte change in this walk can make it fail**: the walk
    visits each conversation once, so a memo built per row costs exactly what a memo built per
    answer costs. ⚠️ `a-line-no-mutation-can-kill-is-not-carrying-its-rule` — it is kept because it
    pins the four reads BY NAME, so a fifth is a red, and it is reported as uncovered rather than
    given an invented row.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1 | `apps/desktop/test/the-conversation-that-is-waiting.test.ts` §1, §2 · the answer arm |
| M2–M3 | `…the-conversation-that-is-waiting.test.ts` §2, §3 · the conversation's own question |
| M4 | `…the-conversation-that-is-waiting.test.ts` §1, §4 · the two questions stay two |
| M5–M9 | `…the-conversation-that-is-waiting.test.ts` §3, §5 · the door |
| M10–M11 | `…the-conversation-that-is-waiting.test.ts` §5 · the wire · and `shutdown-door.test.ts` |

⚑ **And three rows this table does NOT hold, named so a reader does not look for them here**:
`609 M1` (the person arm), `609 M2` (the worker arm) and `609 M3` (the order) all live in
`whichWait` now, because `621` moved the ladder under them. ⛔ **Their anchors were CORRECTED in
place and re-verified RED by hand**, never retired — `correct-a-stale-mutation-anchor-dont-retire-it`
— and the same was done for `603 M1`, `575 M14` and `575 M15`.

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ Each red was
checked for the RIGHT reason: the output was searched for `SyntaxError`, `Transform failed` and
`error TS`, because a row red on a parse error measured nothing (`452 M8`).
"""

TASKS = "apps/desktop/src/shared/tasks.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

MUTATIONS = [
    # ── §1 · one precedence, four arms ─────────────────────────────────────────────────────────
    (
        "M1 · ⛔ the ANSWER arm never fires · a conversation that asked about work it holds and got "
        "no reply reads as whatever is true BELOW it — `waiting-on-a-person`, `waiting-on-a-worker` "
        "or nothing. ⚑ The most SPECIFIC true statement is the one that disappears, and the word "
        "that replaces it is still true, which is why nothing on screen looks wrong",
        [(TASKS, "  return anAnswerIsOutstanding\n    ? 'waiting-on-an-answer'", "  return false\n    ? 'waiting-on-an-answer'")],
    ),
    # ── §2 · the conversation's question is not the row's ──────────────────────────────────────
    (
        "M2 · ⛔ a conversation can never be waiting on an ANSWER · the projection asks the ladder "
        "a question whose answer is always no, so the arm exists for task rows and for nothing "
        "else. ⚑ It is the half of `609`'s family that only a CONVERSATION-level read can carry, "
        "silenced at the one line that carries it",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-009 appended `|| outstanding.anAnswerAboutNoWork`; the row still answers no for the conversation's task questions. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (an
        # owed answer is what makes a conversation wait on a worker) survives in
        # `theWaitAConversationIsIn`, which now calls `whichWait(anAnswerIsOutstanding,
        # aPersonOwesSomething, aChildIsOpen)`. The old one-line call is gone, so the plant is the
        # first argument: `outstanding.answers.size > 0` becomes `false`, and no answer can ever
        # make a wait. Killed by `the-conversation-that-is-waiting.test.ts`.
        [
            (TASKS, '    outstanding.answers.size > 0,', '    false,'),
        ],
    ),
    (
        "M3 · ⚠️ EVERY conversation is waiting on an answer · `>= 0` is true of an empty Set, so the "
        "first arm swallows the other two and a quiet conversation claims somebody owes it a reply. "
        "⛔ `a-fail-closed-question-where-nothing-turns-on-it` in the loud direction: the word is "
        "always the most urgent one and therefore means nothing",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-009 appended `|| outstanding.anAnswerAboutNoWork`; the row still makes every conversation wait on an answer. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Same call and
        # same rule as M2: the answers argument of `whichWait` must be true only when an answer is
        # actually outstanding. The plant weakens `> 0` to `>= 0`, which is always true, so every
        # conversation reads as waiting on a worker. Killed by
        # `the-conversation-that-is-waiting.test.ts`.
        [
            (TASKS, '    outstanding.answers.size > 0,', '    outstanding.answers.size >= 0,'),
        ],
    ),
    (
        "M4 · 🔴 **THE CONFLATION `621` §4.4 FORBIDS** · the ROW's question becomes the "
        "CONVERSATION's, so every open task a conversation holds reads `waiting-on-an-answer` the "
        "moment ANY of them is owed one. ⛔ `widening-a-predicate-widens-every-question-its-field-"
        "answers`, written as one byte change — and the surface a person reads it on is the Work tab",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-009 split the call over lines and added the no-work term; the row still conflates the row's question with the conversation's. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The per-piece
        # rule survives in `composeWhatEachPieceIsWaitingOn`: a piece is waiting on a worker only
        # when an answer about THAT piece is outstanding (`answers.has(piece.piece)`), where the old
        # row asked about a task id. The plant asks whether any answer at all is outstanding in the
        # conversation, so an unanswered piece borrows its sibling's wait. Killed by
        # `the-conversation-that-is-waiting.test.ts`.
        [
            (TASKS, '      outstanding.answers.has(piece.piece),', '      outstanding.answers.size > 0,'),
        ],
    ),
    # ── §3 · the door ──────────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ the POPULATION gate goes · a conversation this app is not running gets a wait, so a "
        "surface can draw *waiting on a worker* beside a band that says *this app is not running "
        "it*. ⚑ It is `304`'s two-surfaces-disagree with the pair decided TWICE, and "
        "`runningStateOf` is asked here precisely so it cannot be",
        [
            (
                HOST,
                "      ([conversation, slot]): ConversationWaiting[] => {\n        // ⛔ **The same ONE decision `whatIsBeingDone` takes**, asked and never re-derived.\n        if (this.runningStateOf(conversation) === 'not-running') return []\n",
                "      ([conversation, slot]): ConversationWaiting[] => {\n        // ⛔ **The same ONE decision `whatIsBeingDone` takes**, asked and never re-derived.\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ the wait is asked about the IDENTITY instead of the CONVERSATION · every row reads "
        "the ledger of a session id that does not exist, so every wait is `null` and nothing throws. "
        "⛔ `two-questions-about-one-address`: an identity is not a conversation, and a read keyed "
        "to the wrong one of the two is the shape `593` §1.3 already paid for",
        [(HOST, "waiting: theWaitAConversationIsIn(waiting(conversation)),", "waiting: theWaitAConversationIsIn(waiting(session.profileId)),")],
    ),
    (
        "M7 · ⛔ the fact is COMPUTED AND THROWN AWAY · the row still exists, the population is "
        "still right, and every reader gets `null` for ever. ⚑ It is the wiring row and it fails "
        "LOUDLY rather than quietly, which is the direction this shape was chosen for — `617 M9`'s "
        "own note, one read over",
        [(HOST, "waiting: theWaitAConversationIsIn(waiting(conversation)),", "waiting: null,")],
    ),
    (
        "M8 · ⚠️ the identity column carries the CONVERSATION id · a surface that groups by identity "
        "— the Team page, which is the reason this field exists — draws one card per conversation "
        "instead of one per agent. ⛔ `a-column-name-is-a-claim`: the field goes on saying "
        "`identity` while holding the other id on the row",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired —
        # ConversationWaiting.identity (whose own docblock says it exists so 'a surface keyed by
        # IDENTITY rather than by conversation can ask its own question') is unchanged and still
        # assigned `session.profileId`; D-017 only inserted a new `...this.whatItIsOwed(...)` spread
        # (R19's 'who owes it') between `conversation,` and `identity: session.profileId,` in the
        # same return object, breaking the old two-line anchor without touching the field itself.
        [
            (HOST, "            identity: session.profileId,\n            // 🔴 **The composition's own precedence, about the CONVERSATION** — see", "            identity: conversation,\n            // 🔴 **The composition's own precedence, about the CONVERSATION** — see"),
        ],
    ),
    (
        "M9 · ⛔ the moment is zero · every age a surface draws from this reading is `now - 0`, so "
        "*read 56 years ago* sits under a list that is perfectly current. ⚑ `agoWords` floors at "
        "`0s ago` in the other direction, which is exactly the class of value that is wrong for a "
        "year without throwing (`a-measured-fact-has-a-time-it-becomes-available`)",
                # ⚑ 676 · anchor CORRECTED, not retired: the answer carries its unread count beside
                # the stamp now, and the comment above it gained a sentence; the stamp is the subject.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — This return grew a
        # `...ledgersSkippedOf(unread.ledgersSkipped)` field and moved onto multiple lines, but
        # `readAt: Date.now()` is still the one stamp the whole answer is timed by, read last per
        # WorkspaceReading's own rule. Zeroing it still makes every age a surface derives from this
        # reading read as `now - 0`, the epoch-old-but-current defect the row names.
        [
            (HOST, '    return {\n      conversations,\n      readAt: Date.now(),\n      rowsUnread: unread.count,\n      ...ledgersSkippedOf(unread.ledgersSkipped),\n    }\n', '    return {\n      conversations,\n      readAt: 0,\n      rowsUnread: unread.count,\n      ...ledgersSkippedOf(unread.ledgersSkipped),\n    }\n'),
        ],
    ),
    # ── §4 · the wire ──────────────────────────────────────────────────────────────────────────
    (
        "M10 · ⛔ the door answers DURING A QUIT · it walks the slot map `closeAll` is emptying AND "
        "opens four ledgers per conversation, so a window on its way out is handed a picture of a "
        "teardown bought with reads the app is shutting down around. ⚑ `whatIsBeingDone` is "
        "`refused` for the first half alone; this one has both",
        [(IPC, "  whatEachConversationIsWaitingOn: 'refused',", "  whatEachConversationIsWaitingOn: 'allowed',")],
    ),
    (
        "M11 · ⚠️ the verb answers with its NEIGHBOUR's reading · the shapes differ in one field, so "
        "every caller gets `told`/`streaming` where it asked for `waiting` and no wait ever reaches "
        "a surface. ⛔ Two reads over one population is exactly the pairing that makes this "
        "substitution look harmless in a diff",
        # Source-only re-anchor, NOT VERIFIED: retain the worker snapshot wrapper while substituting the neighbouring reading.
        [(IPC, "        return host.whatEachConversationIsWaitingOn()", "        return host.whatIsBeingDone()")],
    ),
]
