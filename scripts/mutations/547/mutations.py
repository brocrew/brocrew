"""547 · The first picture of who called whom.

⛔ **`543` built `RuntimeHost.whoCalledWhom` and nothing drew it** — *a read with no reader is a
read whose shape nobody has tested against a person*. ⚑ This is its first consumer, and every row
below breaks a rule the SURFACE carries rather than one the read does.

## 🔴 A · the sentences a person must never be shown

⚠️ **`452` §5.1's forbidden sentence, on this axis, is *no spawned conversations* drawn out of a
read that could not look.** ⛔ `M1` draws it from `rows.length`, `M2` draws it over a list that went
short, and `M3` says *nothing spawned this conversation* about an id this app has never seen. ⚑
Each one is TRUE-looking and each one is a claim the read did not make.

## ⛔ B · the two edges, and the two presses

⚠️ **A spawn and a handoff are independent** (`540` §5) — `M4` collapses them, which makes every
work recipient look like a child. ⛔ **`118`'s rule is that a control is ABSENT where nothing would
make it work**: `M5` offers a press this app has no verb for (`106`), and `M6` offers one for a
recording whose gesture `543`'s read cannot decide (`547` F2). ⚠️ `M7` drops the window's own
`held`, which is the only thing that separates the third navigation state from the fourth.

## ⚠️ C · the folds that are lossy on purpose, made lossy by accident

⛔ **`TASK_IS_OPEN` has FIVE states and TWO of them are closed** — `M8` folds on `answered` alone
and prints *answered* over work a parent took back. ⚑ `M9` gives every card the same plate, and
`M10` reverses the order in which a list's doubts are asked, which reports the older problem.

## ⛔ What this table does NOT cover

 1. **The read itself.** `543`'s table owns `whoCalledWhom`; nothing here touches main.
 2. **`ConversationPane.vue`.** Out of bounds for this dispatch (§1.1) and untouched.
 3. **The ink.** A cut is a measurement `drawn.ts` takes in a real engine — no mutation on a
    stylesheet is worth a row a node runner cannot see.
"""

FOLD = "apps/desktop/src/renderer/src/lib/working-together.ts"

MUTATIONS = [
    # ---- A · the sentences a person must never be shown ---------------------------------------
    (
        "M1 · 🔴 **`452` §5.1's forbidden sentence** · the empty is drawn from `rows.length` rather "
        "than from {@link ListCoverage.count}. ⛔ A read that could not look answers zero rows, so "
        "*No spawned conversations* is then printed about an id this app has never seen",
        [
            (
                FOLD,
                "    childrenEmpty: childList.count === 0 ? NO_SPAWNED_CONVERSATIONS : null,",
                "    childrenEmpty: children.length === 0 ? NO_SPAWNED_CONVERSATIONS : null,",
            )
        ],
    ),
    (
        "M2 · ⛔ **a count over a list that went short** · the four conditions become three, so a "
        "walk that refused rows still reports a total. ⚠️ v2.8 §05: *counts appear only when the "
        "list AND its completeness flag are supplied*",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — v2.8 §05's rule ('counts
        # appear only when the list AND its completeness are known') survives; the compound just
        # grew a fifth D-017 conjunct. Dropping the original `walk.rowsUnread === 0` conjunct
        # (keeping the new ledgersSkipped one) reproduces the same 'count over a list that went
        # short' defect.
        [
            (FOLD, '    count:\n      answered && doubt === null && walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0\n        ? walk.rows.length\n        : null,\n', '    count:\n      answered && doubt === null && (walk.ledgersSkipped ?? 0) === 0\n        ? walk.rows.length\n        : null,\n'),
        ],
    ),
    (
        "M3 · ⛔ **the parent's absence, claimed over a read that could not look** · "
        "`spawnProvenance` answers `null` for an id no `provider_session` row holds, so this prints "
        "*nothing in this app spawned this conversation* about a conversation this app cannot find",
        [
            (
                FOLD,
                "      read.parent === null && reading.answered && childList.doubt === null\n"
                "        ? NOBODY_IN_THIS_APP_SPAWNED_IT\n"
                "        : null,",
                "      read.parent === null ? NOBODY_IN_THIS_APP_SPAWNED_IT : null,",
            )
        ],
    ),
    # ---- B · the two edges, and the two presses ------------------------------------------------
    (
        "M4 · 🔴 **the two edges collapsed** · every work recipient becomes a child. ⛔ `540` §5 "
        "measured the population: work is admitted by `can_message` and not by descent, so a "
        "conversation can be given work without ever having been spawned here",
        [
            (
                FOLD,
                "  const spawned = new Set(read.children.rows.map((row) => row.conversation))",
                "  const spawned = new Set(read.workGivenOut.rows.map((row) => row.to))",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants a press for the
        # `open-in-another-window` navigation state, but the HereIs states, CAST_PRESS and that null
        # entry were deleted by D-017b. The press is now one press for every conversation:
        # `CastPress = 'open'`, and commit 3af91dcb says "one press, 'Open the conversation'". The
        # strip DOM test states the new ruling: "an ancestor this app had no verb for… It has one
        # now: every conversation opens in its one full view". Its anchor is left stale, so the
        # census records it retired.
        "M5 · ⛔ **a press this app has no verb for** · `open-in-another-window` gains one. ⚑ "
        "`taking-over.ts`: *switching windows is not something this app can do for you — "
        "`RuntimeHost` has no verb for it and inventing one would be a control that cannot act*",
        [
            (
                FOLD,
                "  'open-in-another-window': null,",
                "  'open-in-another-window': 'open',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `not-running-in-this-app: null`
        # entry and the Reopen / Read the recording presses it withheld are gone: commit 3af91dcb:
        # "no Reopen / Take it over / Read the recording presses". A recording now opens in the full
        # view (the host's new `look` door reads it from the ledger), so a press on it is the
        # decision, not a defect. What still holds is the `card.elsewhere !== null` guard for
        # given-work recipients, which is not this row's defect. Its anchor is left stale, so the
        # census records it retired.
        "M6 · ⛔ **a press for a recording this read cannot decide** · `547` F2: `SpawnEdge` carries "
        "neither `reopenRefusal` nor `hasTranscript`, so *Reopen the conversation* and *Read the "
        "recording* cannot be told apart — and `118`'s rule is that the control is then ABSENT",
        [
            (
                FOLD,
                "  'not-running-in-this-app': null,",
                "  'not-running-in-this-app': 'open',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):**
        # b8782af0: "Out: CastCard's `elsewhere`, `says`, ... and the `held` channel that existed
        # only to compute `elsewhere` (the input, the cast's ref, the panel and drawer props and the
        # screen's copy)"; the band's card no longer says open in another window. The rule that this
        # window's own `held` beats the read's `in-a-window` is still planted where `openElsewhere`
        # lives (472 M2 in taking-over.ts) and in the forest (472 M3). Its anchor is left stale, so
        # the census records it retired.
        "M7 · 🔴 **the fourth navigation state collapsed** · the window's own `held` is dropped, so "
        "a conversation open in THIS window reads *open in another window* — and loses its press. "
        "⛔ `RUNNING_STATES`: the host cannot answer this and no poll ever will",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in a
        # smaller form: `cardOf` must still be handed this window's own `held`, so a conversation
        # open in THIS window is told apart from one open in ANOTHER window (both have `running:
        # 'in-a-window'`). The `hereIsOf` line is now `const elsewhere = openElsewhere(edge.running,
        # input.held.has(edge.conversation))`, and dropping `held` makes a held conversation say
        # *open in another window*. The DOM test comment says the point is that "`held` is proved to
        # still change an answer".
        [
            (FOLD, '  const elsewhere = openElsewhere(edge.running, input.held.has(edge.conversation))', '  const elsewhere = openElsewhere(edge.running, false)'),
        ],
    ),
    # ---- C · the lossy folds ------------------------------------------------------------------
    (
        "M8 · 🔴 **v2.8's two-valued fold, taken literally** · `open` becomes *not answered*, so "
        "work a parent TOOK BACK reads as open. ⛔ {@link TASK_IS_OPEN} has two closed states and "
        "`540` §3.3's ruling is that the lossy half must not be lossy silently",
        [
            (
                FOLD,
                "    open: Object.hasOwn(TASK_IS_OPEN, row.state) && TASK_IS_OPEN[row.state],",
                "    open: row.state !== 'answered',",
            )
        ],
    ),
    (
        "M9 · ⚠️ **every card drawn as though this app were running it** · the plate stops reading "
        "`running`, so a recording is drawn with no ending and the one honest face on this band "
        "goes away. ⛔ It is the roster's derivation — *`ended` is the HOST's answer, never "
        "`status`* — and a second answer here would be `169` §1",
            # ⚑ **Re-anchored in place by `632`, not retired** (142's rule,
            # `correct-a-stale-mutation-anchor-dont-retire-it`). ⛔ `632` gave `plateOf` the `575`
            # reading and two more arguments, so the call moved onto its own lines and out of the
            # object literal. ⚠️ **The DEFECT is unchanged**: the plate stops reading `running`, a
            # recording is drawn with no ending, and the one honest face on this band goes away.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # plate must read the host's `running`, so a conversation nothing runs is drawn `idle`. Its
        # `plateOf` docblock now says a conversation this app is not running "is doing nothing here
        # — `idle`". The call moved inline as `plateOf(edge.running === 'not-running', atWork…,
        # at)`, so the plant swaps that first argument for `false`, which leaves the plate faceless
        # (`unknown`) for a stopped child.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives: the card's plate must read the host's `running` so a
        # conversation nothing runs is drawn `idle`, not the faceless ring. b8782af0 dropped the
        # third `plateOf` argument, so the call in `cardOf` is now `plateOf(edge.running ===
        # 'not-running', atWork?.get(edge.conversation) ?? null)`. a-childs-state.test.ts section 2
        # stops the child with `host.close` and asserts `card.facets.doing` is `idle`; with the
        # first argument false the status stays null and the plate reads `unknown`. Killed by
        # `a-childs-state.test.ts`.
        [
            (FOLD, "    facets: plateOf(edge.running === 'not-running', atWork?.get(edge.conversation) ?? null),", '    facets: plateOf(false, atWork?.get(edge.conversation) ?? null),'),
        ],
    ),
    (
        "M10 · 🔴 **the refusal goes unsaid** · a read that did not answer keeps its cards and says "
        "nothing about it, so a stale band reads as a current one. ⛔ `434`'s finding: keeping the "
        "last good answer is right and it HIDES the failure, which is why the sentence exists",
        [
            (
                FOLD,
                "    refusal: reading.answered ? null : THE_READ_DID_NOT_ANSWER,",
                "    refusal: null,",
            )
        ],
    ),
    (
        "M13 · 🔴 **the forbidden sentence, reached through a refusal** · {@link ListCoverage.count} "
        "stops waiting for an answer, so a read that did not answer and held no cards draws *No "
        "spawned conversations*. ⛔ `452` §5.1, and the arm `M2` proved was uncovered",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — 452 §5.1's forbidden
        # sentence ('No spawned conversations' reached through a refusal) is still reachable the
        # same way; the guard only grew a ledgersSkipped conjunct. Dropping `answered &&` reproduces
        # the exact original defect: a read that did not answer and held no cards still gets a
        # `count`.
        [
            (FOLD, '    count:\n      answered && doubt === null && walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0\n        ? walk.rows.length\n        : null,\n', '    count:\n      doubt === null && walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0\n        ? walk.rows.length\n        : null,\n'),
        ],
    ),
    (
        "M11 · ⚠️ **the age drawn however fresh it is** · the derived threshold goes, so a band that "
        "re-read a second ago says *0s ago* on every paint. ⛔ A list that re-reads every "
        "{@link CAST_EVERY_MS} cannot be fresher than that, and `ProjectRosterView.asOf` refuses to "
        "choose a number for exactly this reason",
        [
            (
                FOLD,
                # ⚑ W4.74 · re-anchored in place: the age is said only for a reading kept after a
                # refused read (D-033 pushes every move); the plant draws it over an answered band.
                "    asOf: reading.answered ? null : agoWords(read.readAt, input.now),",
                "    asOf: agoWords(read.readAt, input.now),",
            )
        ],
    ),
    (
        "M12 · ⛔ **the guard that keeps one conversation's band off another's drawer** · a late "
        "answer for A is drawn under B. ⚑ `WorkGivenOutReading`'s rule, one question over: *the "
        "strongest false claim this band could make*",
        [
            (
                # 631 · ⚠️ **the same line now appears TWICE** — `parentCardOf` was extracted so
                # `SessionPanel` and the band share ONE derivation, and it carries its own copy of
                # this guard. ⛔ **The EDIT is unchanged**; what it needed was the line above it, so
                # the anchor names the VIEW's copy and not the card's
                # ([[a-file-level-contains-cannot-tell-sibling-declarations-apart]]).
                # ⚑ Row re-verified RED against `an answer about a different conversation draws
                # nothing`.
                FOLD,
                "  const reading = input.reading ?? null\n"
                "  if (reading === null || reading.conversation !== input.forConversation) return null",
                "  const reading = input.reading ?? null\n  if (reading === null) return null",
            )
        ],
    ),
]
