"""557 · Work that stalls with nobody left to tell.

⛔ **HO-018 §2.1 amended criterion 4 to a PROPERTY** — *nobody waits forever in silence* — and
`555` §3.1 measured that the mechanism serving it has a condition the property does not:
`tellIfNobodyHasYet` returns unless the giver is LIVE in this host, HO-018 §2.2 removed the
timeout, and `persons-queue.ts` had no lane for a stall. ⚑ **So a giver never relaunched was told
by nothing, ever, and no person was told at all.**

## 🔴 A · the admission, which has exactly one clause on purpose

⛔ **Every row here attacks the discriminator.** `M1` drops the receipt clause, so a person is told
about work an agent was already told about — `452` §5.1's queue of things already handled, which is
the brief's §3.4 answered backwards. `M2` widens the stall predicate to every open task, so a
worker that is *working* is reported as stopped. `M3` looks the receipt up in the HOLDER's ledger
rather than the giver's, which is `404`'s own measured error — *"`tasksOf` and `tasksAssignedBy`
answer opposite questions"* — at a second door. `M4` asks the receipt question of the SESSION the
walk is folding instead of the row's own `assignedBy`, which is the same mistake one field over and
is the one a ledger holding work from two givers makes visible.

## ⛔ B · the order, and what it is NOT measured on

⚑ `M5` reverses it, so the band draws newest-first and *oldest-blocked-first* — criterion 17's own
promise, carried here rather than re-decided — stops being true.

⚠️ **No row attacks the null-last branch, and that is stated rather than hidden.**
{@link TaskRow.stalledAt} is written by the one helper that can produce `stalled`, so no row this
app writes today can carry `null` there; the branch exists because `484` added the stamp after rows
could already have been written without it, and because `byBlockedSince` ruled where an unknown age
sorts. ⛔ A mutation on a line nothing can reach reports as a survivor and teaches nothing —
`a-line-no-mutation-can-kill-is-not-carrying-its-rule`.

## ⚠️ C · the row a person reads

⛔ `M6` swaps the two conversation ids, so the band sends a person to the conversation that is NOT
stuck and names the stuck one as the thing that was never told. `M7` hands back the session id
instead of the name, which is the renderer-side join this app deliberately does main-side. `M8`
drops the giver from the consequence sentence, leaving *this work stopped* with no account of why
it is a person's. `M9` gives the observation its own words instead of `UNDRIVEN_SENTENCES`, which
is two spellings of one event — the thing `400` wrote *one table and two callers, never two
tables* to prevent. `M10` keys the band on the holder rather than the task, so two stalls in one
conversation collide into one row.

## 🔴 D · the band, and the all-clear it must never draw

⛔ `M11` turns a refused look into *nothing has stopped*, which is `086`'s rule on the read where
the wrong default is a false all-clear — and here the all-clear is the sharpest this app makes.
`M12` hard-codes `unread`, so the disclosure can never fire. `M13` ignores whether this window
holds the conversation, so the button promises the wrong act (`336`). `M14` puts the whole
assignment on the band instead of its first line, which is the shortening the clamp census pairs a
title with.

## ⛔ E · the wiring, because a reader nobody asks for is a list nothing draws

⚑ `M15` takes the verb out of `lookForWhatIsYours`, which is `441`'s defect exactly: the reader
exists, the seam does not. `M16` drops the band from the one `supply`, so the rows and the band
would come from two looks — and here it means the band is permanently *nobody has looked*.
`M17` lets the quit door answer it, which is the one thing that door exists to keep out of a quit.

## ⚠️ F · HO-018 §2.2, which is the ruling this repair had to not step around

⛔ `M18` arms a timer inside the reader. ⚑ It is a source row rather than a behavioural one because
the PO's withdrawal is about what the app MAY do, not only about what it did on one run: *"an idle
timeout on a working child is the guess, and the measurement says we cannot pick the number
honestly"*.

## ⛔ What this table does NOT cover

 1. **The push itself.** `tellIfNobodyHasYet`, its de-duplicator and its receipt are `400` and
    `404`'s tables. This dispatch changed one line in that method — the stall guard became the
    shared {@link stalledWithACause} — and `M2` is the row that measures it.
 2. **`takesWorkFrom`'s one-slot rule.** HO-060 §4 declined changing it and no row here touches it;
    the fixture sends work one piece at a time BECAUSE of it.
 3. **The queue's three populations.** `403`, `446` and `533` own them. `M11` to `M14` are about
    the second BAND only, and the assertion that it is not a fourth population is a census rather
    than a mutation subject.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
SHARED = "apps/desktop/src/shared/stalled-work.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

# ⚑ **Anchor CORRECTED by `661`, not retired** — the receipt clause became `aNoticeIsOwed`, the ONE
# predicate the push reads too (`661`'s re-arm, and the complement it keeps), and prettier broke the
# line in three. ⛔ Every row's rule is untouched — drop the clause, ask the holder's ledger, ask the
# session the walk folds — and each was re-verified RED against this table's own file at the commit
# that moved it (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
# ⚠️ **RE-ANCHORED at 702, not retired.** 702 gives `aNoticeIsOwed` a third argument — the quit's
# stamp, read beside the walk as `theQuitHoldsIt` — so the line gains it; M1, M3 and M4 still drop the
# receipt clause or ask it of the wrong ledger. The DEFECTS these rows plant are unchanged.
ADMITS = (
    "            (task) =>\n"
    "              stalledWithACause(task) &&\n"
    "              aNoticeIsOwed(toldAbout(task.assignedBy).get(task.taskId), task, theQuitHoldsIt),\n"
)

MUTATIONS = [
    # ---- A · the admission ---------------------------------------------------------------------
    (
        "M1 · 🔴 **the receipt clause is dropped** · every stalled task is a person's, including "
        "the ones an agent was successfully told about — the brief's §3.4 answered backwards, and "
        "`452` §5.1's queue of things already handled",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The predicate's shape is
        # unchanged; only the third argument was renamed from the boolean flag `theQuitHoldsIt` to
        # the function `itCanStillBeStarted` (D-017's startable rework), so the literal no longer
        # matches. Dropping the `aNoticeIsOwed(...)` receipt clause entirely still plants '557's own
        # headline defect, and `work-that-stalls-with-nobody-to-tell.test.ts` (table 557's own
        # suite) still separates told/untold this same way.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The receipt
        # clause still stands in `stalledWorkNobodyWasToldAbout` as
        # `aNoticeIsOwed(toldAbout(piece.giver).get(piece.piece), piece, itCanStillBeStarted)`: a
        # person is owed only the stalled pieces no giver was told about. The task vocabulary became
        # pieces, but the discriminator and its meaning are unchanged. Killed by
        # `work-that-stalls-with-nobody-to-tell.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule holds: the person's band lists only stalled pieces no giver was told about, and
        # the receipt is the discriminator. `aNoticeIsOwed` and `itCanStillBeStarted` are gone with
        # the kept-open receipt, and the clause is now `stalledWithACause(piece) &&
        # !toldAbout(piece.giver).has(piece.piece)`. The plant drops the receipt clause, so every
        # stalled piece is a person's. Killed by `work-that-stalls-with-nobody-to-tell.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The person's-band filter still asks whether a stalled piece's giver
        # can be told, and skips one it was already told about; D-016c replaced stalledWithACause
        # with aStallItsGiverCanBeToldOf. The plant drops the already-told-about half, so a stall
        # whose giver was told about it is counted as work nobody was told about. Killed by
        # `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (STORE, '            (piece) => aStallItsGiverCanBeToldOf(piece) && !toldAbout(piece.giver).has(piece.piece),\n', '            (piece) => aStallItsGiverCanBeToldOf(piece),\n'),
        ],
    ),
    (
        "M2 · ⛔ **the stall predicate widens to every OPEN task** · a worker that is working is "
        "reported to a person as stopped, which is the claim this band may never make — "
        "`TASK_IS_OPEN` holds `waiting`, `working` and `stalled`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `stalledWithACause` in tasks.ts is still the one predicate both recipients read, and its
        # body is `piece.state === 'stalled' && piece.stalledBecause !== null` over `PieceRow`.
        # `TASK_IS_OPEN` still holds waiting, working, the three waiting-on states and stalled, so
        # widening to it makes the band report a working piece as stopped. Killed by
        # `waiting-on-an-answer-is-not-stalled.test.ts`,
        # `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (TASKS, "  return piece.state === 'stalled' && piece.stalledBecause !== null\n", '  return TASK_IS_OPEN[piece.state]\n'),
        ],
    ),
    (
        "M3 · ⛔ **the receipt is looked up in the HOLDER's ledger** · `404`'s own measured error at "
        "a second door — the receipt lives in the conversation that was TOLD, and the holder never "
        "is",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same rename as M1
        # (theQuitHoldsIt -> itCanStillBeStarted); the receipt-ledger-swap defect (assignedBy ->
        # assignedTo, i.e. the holder's ledger instead of the giver's) is unaffected by that rename
        # and still plants a real bug, since a holder's own ledger never carries a receipt for work
        # it was given.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The receipt is
        # written into the GIVER's ledger (`stallsToldToSession(giver, …)`, memoised by
        # `toldAbout(giver)`), and the walk still asks it as `toldAbout(piece.giver)`. Reading the
        # holder's ledger (`piece.owner`) is 404's measured error at the person's door: the holder
        # never holds the receipt. Killed by `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (STORE, 'toldAbout(piece.giver)', 'toldAbout(piece.owner)'),
        ],
    ),
    (
        "M4 · ⚠️ **the receipt question is asked of the ledger being folded** · one field over from "
        "`M3` and invisible until a conversation holds work from TWO givers, which is the shape "
        "`tasksAssignedBy`'s own rule exists for",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same rename as M1/M3.
        # `tasksOfSession(sessionId)` derives exactly the holder's own tasks, so `task.assignedTo
        # === sessionId` for every row this walk ever sees today — meaning M3 and M4 are
        # behaviourally identical in this codebase's single-giver-per-holder test shape, matching
        # the row's own label ('invisible until a conversation holds work from TWO givers'). Kept as
        # a distinct row since it documents a different code-level mistake (the closed-over loop
        # variable vs. the row's own field).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The walk's
        # callback still receives the ledger being folded as `sessionId` (the holder), and the
        # receipt lookup still takes the giver from the row, so asking `toldAbout(sessionId)` is the
        # same defect one spelling over. `piecesOfSession(owner)` folds only the pieces that
        # conversation owns, so today this plant behaves exactly like M3, and it is still red.
        # Killed by `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (STORE, 'toldAbout(piece.giver)', 'toldAbout(sessionId)'),
        ],
    ),
    # ---- B · the order -------------------------------------------------------------------------
    (
        "M5 · ⛔ **newest first** · criterion 17's *oldest-blocked-first* is carried here rather "
        "than re-decided, and a band that puts the newest stall at the top tells a person the "
        "opposite of which one has been waiting longest",
        [(STORE, "            return left.stalledAt - right.stalledAt\n", "            return right.stalledAt - left.stalledAt\n")],
    ),
    # ---- C · the row a person reads ------------------------------------------------------------
    (
        "M6 · 🔴 **the two conversation ids are swapped** · the button sends a person to the "
        "conversation that is not stuck, and the sentence names the stuck one as the thing nobody "
        "told",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # `assignedTo` and `assignedBy` fields became `owner` (the conversation holding the piece,
        # where a person goes) and `giver`, copied in `RuntimeHost.stalledWorkForAPerson`. Swapping
        # them sends the button to the giver, which is not stuck, and the sentence names the wrong
        # side, and the test pins both. Killed by `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (HOST, '            owner: piece.owner,\n', '            owner: piece.giver,\n'),
            (HOST, '            giver: piece.giver,\n', '            giver: piece.owner,\n'),
        ],
    ),
    (
        "M7 · ⛔ **the id is handed back instead of the name** · `agentIdentities()` is re-read at "
        "mount and after a launch only, so a renderer cannot join it — which is why this naming is "
        "main-side at all",
            # ⚠️ **732 · RE-ANCHORED, the subject unchanged**: the holder is named by its IDENTITY now
            # (`729` F-1, R41 — `whatToCall`, the memo beside the asker's), not by `name`'s folder.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The name is
        # still composed main-side and handed on the row as `ownerName: whatToCall(piece.owner)`,
        # for the same reason the label gives (a renderer cannot turn a `sess_` id into a word).
        # Handing back the id is the same defect on the renamed field. Killed by
        # `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (HOST, '            ownerName: whatToCall(piece.owner),\n', '            ownerName: piece.owner,\n'),
        ],
    ),
    (
        "M8 · ⚠️ **the consequence stops naming the giver** · what is left is *this work stopped*, "
        "with no account of why it is a person's rather than an agent's",
                # ⚠️ **697 · CORRECTED IN PLACE — the subject MOVED, it did not die.** `672` moved the
                # consequence line to the renderer as `persons-queue.ts`' `stalledWorkLead` (the
                # card's spelling, *Task #3 in brobot2*), and `697` (`672` H2) deleted the callerless
                # shared copy this row pointed at. The giver clause is the same clause, in its one
                # remaining home.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # stalled-work lead's fallback arm must still say who gave the work out and that they were
        # not told. D-016 only dropped the project half of the sentence (`taskCalledIn(number,
        # projectSlug)` became `taskCalled(number)`), so the anchor moved but the giver clause is
        # still there and can be dropped.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `stalledWorkLead` in persons-queue.ts still has its plain arm: `<label> with <owner> is
        # not being worked on, and <giver> — which gave it out — has not been told.` Dropping the
        # giver clause leaves a consequence with no account of why the work is a person's rather
        # than an agent's, and the tests pin both clauses. Killed by
        # `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (QUEUE, '  return `${work.label} with ${work.ownerName} is not being worked on, and ${work.giverName} — which gave it out — has not been told.`\n', '  return `${work.label} with ${work.ownerName} is not being worked on.`\n'),
        ],
    ),
    (
        "M9 · ⛔ **the observation gets its own words** · two spellings of one event, which is what "
        "`400` wrote *one table and two callers, never two tables* to prevent — a person reading "
        "this band and a parent reading its notice would be given two accounts",
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692's band reads the kept-open fact first; the anchor is the arm that still takes the shared table's words. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule holds: the band's observation is worded from the app's one table
        # (`undrivenSentence`), never a second spelling. The `? kept-open : undrivenSentence(...)`
        # ternary is gone with the kept-open words, so `stalledWorkSaid` is now `const said =
        # undrivenSentence(work.because)`, and the plant gives the observation its own words. Killed
        # by `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (SHARED, '  const said = undrivenSentence(work.because)\n', '  const said = `it stopped (${work.because})`\n'),
        ],
    ),
    (
        "M10 · ⚠️ **the band is keyed on the conversation** · two stalled pieces of work in one "
        "conversation collide into one row, and `402`'s measured shape is three of them on one "
        "worker",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `stalledWorkKey` is still the band's one row key, now the piece id (`work.piece`). Keying
        # on the conversation (`work.owner`) collapses two stalled pieces on one holder into one
        # row, the 402 shape, and the test asserts the key equals the piece id. Killed by
        # `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (SHARED, 'export const stalledWorkKey = (work: StalledWork): string => work.piece\n', 'export const stalledWorkKey = (work: StalledWork): string => work.owner\n'),
        ],
    ),
    # ---- D · the band --------------------------------------------------------------------------
    (
        "M11 · 🔴 **a refused look draws the all-clear** · `086`'s rule on the read where the wrong "
        "default is a false all-clear, and here the all-clear is *every piece of work that stopped "
        "has reached somebody* — the claim `555` §3.1 measured this app making silently",
        [
            (
                QUEUE,
                "  if (stalledWorkForAPerson === null) return lastLookAnswered ? null : { rows: [], unread: true }\n",
                "  if (stalledWorkForAPerson === null) return null\n",
            )
        ],
    ),
    (
        "M12 · ⛔ **the disclosure can never fire** · a band that has stopped being read looks "
        "identical to one that is up to date, which is the shape `533` gave the walls their own "
        "`unread` for",
                # ⚑ **The preceding line is IN the anchor on purpose** — `providerLimitsView` ends in
                # the identical three lines, so a bare `unread: !lastLookAnswered` matches twice and
                # this row would report as ambiguous. `a-second-function-in-the-same-shape-disarms-a-
                # file-scoped-census`, caught by the table contract rather than by a survivor.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 701 — the line above the disclosure now also reads the
                # band's live `holderKeptOpen` (a kept-open holder is opened, not taken over); the
                # defect planted is unchanged: the disclosure can never fire.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # `stalledWorkView` must disclose that the last look stopped answering, so `unread` may not
        # be hard-coded. D-017b replaced the `openingAction(held.has(...) || work.holderKeptOpen)`
        # line with `action: OPEN_THE_CONVERSATION,`. That line is the new anchor, and with the two
        # lines after it the anchor is still unique (`providerLimitsView` ends `unread:
        # !lastLookAnswered }` on one line).
        [
            (QUEUE, '      action: OPEN_THE_CONVERSATION,\n    })),\n    unread: !lastLookAnswered,\n', '      action: OPEN_THE_CONVERSATION,\n    })),\n    unread: false,\n'),
        ],
    ),
    (
        "M13 · ⚠️ **the button stops asking whether this window holds the conversation** · it then "
        "promises the wrong act — `336`'s door is a WIDENING and a person is told about it before "
        "they press, never after",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `stalledWorkView` still takes the set of conversations this window holds and sets `held:
        # held.has(work.owner)` per row, which decides the button's promise. The rename from
        # `assignedTo` to `owner` is the only change, and forcing `held: true` is the same defect.
        # Killed by `work-that-stalls-with-nobody-to-tell.test.ts`, `persons-queue.test.ts`.
        [
            (QUEUE, '      held: held.has(work.owner),\n', '      held: true,\n'),
        ],
    ),
    (
        "M14 · ⛔ **the whole assignment goes on the band** · `undrivenWorkText` shortens the same "
        "text the same way for the parent's notice, and two shortenings of one assignment is how a "
        "person and the agent beside them come to read two different pieces of work",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The band still
        # draws one line about the piece, `what: work.title` (the piece's title, one line by
        # construction, the same line `undrivenWorkText` names it by), and the test says the band
        # must never draw the whole brief. `StalledWork` carries no brief, so the whole assignment
        # can only reach the band through the host row map, and that is where the plant goes. Killed
        # by `work-that-stalls-with-nobody-to-tell.test.ts`.
        [
            (HOST, '            title: piece.title,\n', '            title: piece.brief,\n'),
        ],
    ),
    # ---- E · the wiring ------------------------------------------------------------------------
    (
        "M15 · 🔴 **the verb is never asked for** · `441`'s defect exactly — the reader exists, the "
        "seam does not, and every surface built to say something was waiting says *Nothing is "
        "waiting*",
        [(SCREEN, "    store.stalledWorkForAPerson(),\n", "")],
    ),
    (
        "M16 · ⛔ **the band is dropped from the one supply** · it is then permanently *nobody has "
        "looked*, which draws nothing and claims nothing — the silent failure this whole dispatch "
        "is about, one layer up",
        [
            (
                SCREEN,
                "    { walked: stalledWork.value, lastLookAnswered: lastStallLookAnswered.value },\n",
                "",
            )
        ],
    ),
    (
        "M17 · ⚠️ **the quit door answers it** · one indexed candidate query plus a task fold per "
        "ledger, run while the app is going away, which is the one thing that door exists to keep "
        "out of a quit",
        [(IPC, "  stalledWorkForAPerson: 'refused',\n", "  stalledWorkForAPerson: 'answered',\n")],
    ),
    # ---- F · HO-018 §2.2 -----------------------------------------------------------------------
    (
        "M18 · ⛔ **a timer is armed inside the reader** · HO-018 §2.2 withdrew criterion 5 because "
        "*an idle timeout on a working child is the guess*, and a threshold reintroduced under "
        "another name is the thing the PO said not to reach for",
        [
            # ⚠️ **732 · RE-ANCHORED, the subject unchanged**: the folder naming's first line is gone
            # (`729` F-1), so the timer goes in right under the signature.
            (
                HOST,
                "  stalledWorkForAPerson(): LedgerWalk<StalledWork> {\n",
                "  stalledWorkForAPerson(): LedgerWalk<StalledWork> {\n    setTimeout(() => this.stalledWorkForAPerson(), 30_000)\n",
            )
        ],
    ),
]
