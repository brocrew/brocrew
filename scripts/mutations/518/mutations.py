"""518 · two bounds: one that measures the machine, one that does not exist — each row is THE DEFECT, put back (131).

⛔ **This dispatch was sent for two repairs and found that the first one's subject was misnamed.**

## 🔴 Part one · what `514` F9 said, and what this tree measured

**F9, verbatim:** *"`apps/desktop/test/the-word-the-poll-cannot-say.test.ts:201` configures the host
with `closeDrainTimeoutMs: 40` **and asserts the drain completes inside it**; at load 253-269 it
printed *"runtime session sess_2 did not drain within 40ms"* and `REAL_EXIT=1`."*

⛔ **There is no such assertion.** No `Date.now`, no fake timer, no duration expectation anywhere in
the file. ⚠️ **The line F9 quotes as evidence is emitted on every run of it, green or red** — FIVE
times, one per `open('quiet', …)` site; the file was green at load 44, at load 301 and at load 486 —
because that provider's stream parks on `await new Promise(() => {})` and its pump can never settle. 🔴 **That warning is
what line 201 exists to BUY**: 40 ms instead of `DEFAULT_CLOSE_DRAIN_TIMEOUT_MS`'s 5 s, twice per
wedged teardown. ⚑ **It is the designed steady state, not the failure.**

🔴 **And how it came to be read as one, measured.** vitest's default reporter shows a passing test's
console output nowhere and a failing test's in full. On a green gate the line is invisible; the
moment §1's liveness assertion goes red it is printed immediately above the `AssertionError`, naming
`sess_2` — which is the id F9 quotes. ⛔ **The warning is collateral of the failure, and it was
mistaken for its cause.**

⚠️ **And the drain has no outcome to assert instead**, which was checked rather than argued:
`tearDown` ends `finalize(session, drained ? 'closed' : 'close-timeout')` and `terminalFor`
collapses the pair — `ending === 'stream-failed' ? 'errored' : 'ended'` — so nothing durable and no
reader anywhere can tell a drained close from a timed-out one.

⛔ **The bound that CAN decide an assertion is a different 40**: `SILENCE_WINDOW_MS` (line 60),
raced against the `busy` provider's 10 ms cadence. ⚑ **Proved by violating it** (rule 20's closure):
slow the producer past the window and exactly two rows go red —
`AssertionError: expected 'silent' to be 'live'` and
`expected [ 'live', 'silent', 'silent', null ] to deeply equal [ 'live', 'live', 'silent', null ]`.
🔴 **The margin was 30 ms and nobody had written it down.** It is now `BUSY_CADENCE_MS *
YIELDS_PER_WINDOW`, so a cadence changed without the window moving with it is impossible.

## ⚑ Part two · a bound named in the code before it was found

`runtime-ipc.ts`, on `relayedFrom`: *"`boundStoredEvent` has no arm for this key, exactly as it has
none for `work.taskId` (406) … it is named here so that whoever bounds one of them bounds all of
them."* ⛔ **That paragraph classified the four together as ids printed in the DEBUG STREAM, and
`510` made it false for one of them**: `documentId` and `assignedTo` are now read off a replayed row
and sent back over the command wire when a person presses.

## ⛔ The five properties these rows guard

 1. **The margin is a RATIO, not a number** — `M1`, `M2`. A window and a cadence written
    independently are a suite reporting the machine, and neither number's own comment says so.
 2. **BOTH halves of the composition run, and the bound reaches all three types** — `M3`, `M4`,
    `M5`. ⚑ **The ORDERING hazard is gone rather than guarded**: `boundStoredEvent` is now
    `boundStoredPayloads(boundWorkReport(boundRelayedIdentity(event)))` since `545`, so no half
    can return past another and
    swapping them would not be a defect. ⚠️ What is left to protect is that both are called.
 6. **A report that cannot say which task it is, is not a report** — `M14`. `isAWorkReport` admits
    `NaN`, and `work-report.ts` prints `Task #${String(report.number)}`.
 3. **A string that could not be one of this app's own is ABSENT, never shortened** — `M6`, `M7`,
    `M8`, `M9`. A cut id looks like a real one; a cut `documentId` draws a live control over a
    press the wire refuses.
 4. **A `work` that is not a report is DROPPED, and `null` is not the same value as *nothing to
    do*** — `M10`, `M11`. `describe-event.ts` reads `event.work.taskId` behind a presence check
    only, and it runs for every row of the Raw Events tab.
 5. **CONSTRUCTED, never spread, and a ninth field is somebody's problem** — `M12`, `M13`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1` | ⚑ **`the-word-the-poll-cannot-say.test.ts` §1's MARGIN row** — the derivation, not the value |
| `M2` | ⚑ **§1's two liveness rows** |
| `M3`, `M6`, `M7`, `M8`, `M9`, `M14` | ⚑ **`apps/desktop/test/two-bounds.test.ts` §1 and §3** |
| `M4` | ⚑ **§2's ON-DISK row** — see below for why no replay assertion can reach it |
| `M5` | ⚑ **§2** — the held message and the abandoned one |
| `M10`, `M11` | ⚑ **§3** — the forged loop, and the non-number `number` row |
| `M12` | ⛔ **§1's undeclared-key row and §4's SPREAD row.** ⚠️ **Not §4's ordered field list**, and that was measured: the key regex matches `name:` and a spread has no colon, so `...report,` leaves the list byte-identical. §4 gained a second assertion for exactly this. |
| `M13` | ⚑ **§4** — the declaration read against the construction |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from held bytes with a SHA-256 re-check — `verify-each-mutation-row`,
which is not the same claim as a table run.

## 🔴 Three rows SURVIVED the first pass, and each one was a hole in the tests rather than a bad row

⚑ **This is the whole return on writing the table before claiming the work was done**, and all
three holes are of a kind no amount of re-reading the diff would have found.

 * **`M1` survived** because nothing asserted the MARGIN — the suite exercised it and never named
   it, so `509`'s literal `= 40` could be written straight back and every row stayed green at
   ordinary load. ⛔ It is a LOAD-dependent defect and `mutate.sh` runs no load. ⚠️ **The repair is
   not a bigger machine; it is an assertion on the DERIVATION**: `SILENCE_WINDOW_MS` must equal
   `BUSY_CADENCE_MS * YIELDS_PER_WINDOW`, plus a floor under the ratio. 🔴 That is standing rule
   22's *"say what makes the number reachable"* written where a test can hold it, and it is what
   turned a guaranteed survivor into a row.
 * **`M4` survived** because `boundStoredEvent` runs on BOTH sides of the store — `appendTx` on the
   way in, `toPersistedEvents` on the way out — so a bound that skipped one half had it applied by
   the other pass. ⛔ **Every `store.events` assertion in the file was blind to it by
   construction.** ⚑ The repair reads the `payload` column directly: **one application**, which is
   the only place a missing half is a proposition at all. ⚠️ And it closed a real gap —
   `session-store.ts` claims *"the database can neither accept nor hand back"*, and nothing had
   been testing the ACCEPT half for this field.
 * **`M11` survived as a TRUE mutation** — `a-true-mutation-measures-nothing`. Swapping
   `isAWorkReport` for a bare `!== null` changed no outcome for any value the file planted, because
   `boundedWorkReport`'s two required-id checks already reject every one of them. ⛔ **The gate does
   carry something the id checks cannot**: `typeof number === 'number'`, and `number` is the one
   painted field with no length rule of its own (`Task #${String(report.number)}`). ⚑ So the row
   became killable by planting the payload only the gate refuses, and the app gained an assertion
   stopping half a megabyte from reaching a heading.

⚑ **`M10` is a defect this dispatch actually shipped and its own test caught.** The first version
folded the shape question into the identity comparison — `const kept = isAWorkReport(w) ?
boundedWorkReport(w) : null; if (kept === event.work) return event` — and a stored `work: null`
compared equal to the drop sentinel and was returned untouched. 🔴 **The one payload the bound was
written to stop, handed back by the bound.** §3's loop went red on the first run.

## ⚠️ What is deliberately NOT here

 * **A row on `closeDrainTimeoutMs: 40`.** ⛔ Nothing asserts it, so nothing can kill a change to
   it — which is the finding rather than an omission. A row there would be a guaranteed survivor.
 * **`YIELDS_PER_WINDOW = 1`.** ⛔ With the window equal to the cadence the race is a coin flip, and
   a row whose verdict is a coin flip is worse than no row. ⚑ `M1` covers the same property from
   the other side — the derivation — and its verdict is deterministic.
 * **`producedAnotherWindow` waiting for zero more events.** ⚠️ Nothing goes red: the claim it
   carries — *a FURTHER window's worth* — has no reader but the docblock. ⛔ Named here rather than
   written as a phantom survivor (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
 * **Anything that weakens an assertion in `two-bounds.test.ts` §4.** ⛔ A mutation on a census is
   invisible to that census.
 * **A row on the re-entry that used to be here.** ⚑ The first version composed the two halves with
   `if (carried !== event) return boundStoredEvent(carried)` and argued the recursion was one level.
   ⛔ **It was one level for every value but `NaN`** — `isAWorkReport` admits it, the identity check
   compared values with `===`, and `NaN === NaN` is false — so one stored row took `store.append` to
   `RangeError: Maximum call stack size exceeded`. 🔴 **The repair removed the re-entry rather than
   guarding it**, so there is no line left to mutate; `M14` is the row for the value that found it.
 * **A row that keeps the gate and only weakens it.** ⛔ `isAWorkReport` is SUBSUMED by
   `boundedWorkReport`'s required-field checks for every value a ledger can hold: a string, a
   number, an array or `{}` all reach `isAStoredId(undefined)` and drop, and a non-numeric `number`
   now fails `Number.isFinite`. ⚠️ **Measured, twice**: swapping it for `event.work !== null ?…`
   survived both verification passes. ⚑ **What the gate does carry is the null/undefined shape**,
   which is why `M11` removes it outright rather than loosening it — and it is why the gate stays:
   it is the same reading the three fold sites make (`169` §1), not a second behaviour.
 * **A vocabulary check on `state`, `outcome` or `stalledBecause`.** ⚑ Each already has a reader
   that answers for a value this app has never heard of; a fourth reading here could disagree with
   the three, which `isAWorkReport`'s own docblock refuses. The bound holds LENGTHS.
"""

POLL = "apps/desktop/test/the-word-the-poll-cannot-say.test.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ── part one: the margin is a ratio ─────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** the-word-the-poll-cannot-say.test.ts
        # was rewritten by D-016: `BUSY_CADENCE_MS`, `YIELDS_PER_WINDOW`, the `busy` provider and
        # the liveness margin assertion are gone, and `SILENCE_WINDOW_MS` is now a plain 400 that no
        # assertion reads. The file header says 'D-016 · the word went with the room ... §1 and §2,
        # whose every assertion read that row' went. Its anchor is left stale, so the census records
        # it retired.
        "M1 · 🔴 the window goes back to a number of its own · `40`, written beside a 10 ms cadence "
        "exactly as `509` wrote it, so the margin §1 rests on is 30 ms again and nothing in the "
        "file says so — the state `514`'s gate went red in",
        [
            (
                POLL,
                "const SILENCE_WINDOW_MS = BUSY_CADENCE_MS * YIELDS_PER_WINDOW",
                "const SILENCE_WINDOW_MS = 40",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `busy` producer that raced the
        # silence window is deleted along with the two liveness rows it fed, because
        # `livenessStateOf` went with the project room (D-016). No test now decides on the window's
        # margin, so the plant has nothing to break. Its anchor is left stale, so the census records
        # it retired.
        "M2 · ⛔ the producer misses a whole window · the `busy` provider yields slower than the "
        "window it is racing, which is what a loaded worker does to it — and it is the plant that "
        "proved the bound decides §1's assertions rather than the drain's",
        [
            (
                POLL,
                "await new Promise((resolve) => setTimeout(resolve, BUSY_CADENCE_MS))",
                "await new Promise((resolve) => setTimeout(resolve, SILENCE_WINDOW_MS + 50))",
            )
        ],
    ),
    # ── part two: the bound runs, and runs first ────────────────────────────────────────────────
    (
        "M3 · 🔴 the work bound is never called · `boundStoredEvent` hands every stored report "
        "straight back, which is the tree this dispatch was sent to repair",
                # ⚑ **545 re-anchored**: a third bound joined the composition — the relayer's
                # identity, which had a transcript reader from the day it was added. ⛔ The
                # replacement keeps it, so this row still measures the WORK bound alone.
                # ⚑ **671 · anchor corrected in place** — `boundTurnTask` joined the composition
                # (`UserTurnEvent.taskId`'s bound). Subject unchanged; re-verified RED alone.
                # ⚑ **687 · anchor corrected in place** — `boundTaskNumber` joined the composition
                # (the card's `taskNumber`), and it now spans three lines. Subject unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # composition in `boundStoredEvent` must call the work bound) survives. The composition is
        # now one line and `boundTurnTask(boundTaskNumber(...))` became `boundPieceNamed(...)`
        # (`task_id`/task number became piece and label). Plant the same omission of
        # `boundWorkReport` on today's line, keeping `boundRelayedIdentity` and
        # `boundStoredPayloads`. Killed by `two-bounds.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The stored-event bound still composes the same bounds; D-016c commit
        # 6 added boundTheDrive to the chain, and D-022 wrapped it in boundStoredPayloads, so the
        # old one-line anchor moved. The plant drops boundWorkReport from the composition, so a work
        # report is stored unbounded, which is the label's defect. Killed by `two-bounds.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 added card-fact bounding around the composition; still remove only the work-report bound.
            (STORE, "    boundCardFacts(boundWorkReport(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event))))),\n", "    boundCardFacts(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event)))),\n"),
        ],
    ),
    (
        "M4 · ⛔ the composition drops its OTHER half · the report is bounded and every payload "
        "beside it stops being — attachments, memory notes, citations and the `unknown` raw. ⚠️ Its "
        "killer is the row that reads the stored bytes, because both halves run twice on a replay "
        "and only ONE application can see a half that is missing",
                # ⚑ **545 re-anchored**, as `M3` above and for its reason.
                # ⚑ **671 · anchor corrected in place**, as M3 above.
                # ⚑ **687 · anchor corrected in place**, as M3 above.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # composition must keep `boundStoredPayloads`, the attachments, memory, citations and
        # `unknown` bounds, beside the work bound) survives. Only the anchor's names changed, as in
        # M3. Plant dropping `boundStoredPayloads`; the on-disk row reads the stored payload column,
        # so it goes red. Killed by `two-bounds.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — boundStoredEvent now returns
        # boundStoredPayloads(boundWorkReport(...)) over three lines, so the old anchor is gone; the
        # rule that ONE application bounds both the report and the attachments on disk still holds.
        # The plant returns the report bound without boundStoredPayloads, so attachments are left
        # unbounded on the stored row. Killed by `two-bounds.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 2f0806018 moved the composition to boundOneRow; 32981d722 added card facts. Keep other bounds and remove only boundStoredPayloads.
            (STORE, "  return boundStoredPayloads(\n    boundCardFacts(boundWorkReport(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event))))),\n  )\n", "  return boundCardFacts(boundWorkReport(boundRelayedIdentity(boundTheDrive(boundPieceNamed(event)))))\n"),
        ],
    ),
    (
        "M5 · ⚠️ the bound reaches only the turn · `message_queued` and `message_unqueued` carry the "
        "same report and lose it, which is the gap `216`'s attachments arm was widened to close "
        "and this one would reopen one field over",
        [
            (
                STORE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The type guard also occurs in another bound. Scope this edit to boundWorkReport so queued and unqueued reports alone bypass it.
                "function boundWorkReport(event: TranscriptEvent): TranscriptEvent {\n  if (\n    event.type !== 'user_turn' &&\n    event.type !== 'message_queued' &&\n    event.type !== 'message_unqueued'\n",
                "function boundWorkReport(event: TranscriptEvent): TranscriptEvent {\n  if (\n    event.type !== 'user_turn'\n",
            )
        ],
    ),
    # ── part two: absent, never shortened ───────────────────────────────────────────────────────
    (
        "M6 · 🔴 the ceiling stops being a ceiling · `isAStoredId` answers on type alone, so a "
        "million-character `documentId` replays into a `data-*` attribute and onto a press the "
        "command wire then refuses with a zod sentence",
        [
            (
                STORE,
                "  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STORED_ID_CHARS",
                "  return typeof value === 'string'",
            )
        ],
    ),
    (
        "M7 · ⛔ an EMPTY id counts as one · `''` survives the bound, so a report reaches the fold "
        "claiming a document whose id is nothing — the state `boundHandedPaths`' own "
        "`each.path.length > 0` exists to refuse",
        [
            (
                STORE,
                "  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STORED_ID_CHARS",
                "  return typeof value === 'string' && value.length <= MAX_STORED_ID_CHARS",
            )
        ],
    ),
    (
        "M8 · ⚠️ the ceiling is a second opinion rather than the wire's own · 20,000 characters, so "
        "the store hands back ids its own `readCanonicalDocument` refuses — `169` §1's two "
        "spellings of one rule, with the disagreement landing on a person's press",
        [(STORE, "const MAX_STORED_ID_CHARS = 200", "const MAX_STORED_ID_CHARS = 20_000")],
    ),
    (
        "M9 · ⛔ a required field that cannot survive is kept anyway · only `taskId` is guarded, so "
        "an unbounded `state` rides into `:data-state` on every report row while the visible pill "
        "goes on saying *in a state this app has not been taught*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # required `state` too long to be one takes the whole report; state is painted verbatim as
        # `:data-state`) survives. `boundedWorkReport` still guards `!isAStoredId(report.state)`
        # beside the required id, which is now `report.piece` instead of `report.taskId`. Plant
        # removing the state guard. Killed by `two-bounds.test.ts`.
        [
            (STORE, '    !isAStoredId(report.state) ||\n', ''),
        ],
    ),
    # ── part two: a `work` that is not a report ─────────────────────────────────────────────────
    (
        "M10 · 🔴 `null` is folded in with *nothing to do* · a stored `work: null` returns by "
        "identity and rides into the renderer — and it is the one payload `describe-event.ts` "
        "throws on, because that reader is a PRESENCE check (`work === undefined ? '' : "
        "work.taskId`) run for every row of the Raw Events tab",
        [
            (
                STORE,
                "  if (event.work === undefined) return event",
                "  if (event.work === undefined || event.work === null) return event",
            )
        ],
    ),
    (
        "M11 · ⛔ the shape gate goes and the bound reads the value directly · exactly the reading "
        "`describe-event.ts` already makes — `work === undefined ? '' : work.taskId`, a PRESENCE "
        "check — so a stored `work: null` reaches `null.taskId` and throws a TypeError out of "
        "`appendTx`, taking the whole write transaction with it",
        [
            (
                STORE,
                "  const kept = isAWorkReport(event.work) ? boundedWorkReport(event.work) : null",
                "  const kept = boundedWorkReport(event.work as WorkReport)",
            )
        ],
    ),
    # ── part two: constructed, and a ninth field ────────────────────────────────────────────────
    (
        "M12 · ⚠️ SPREAD instead of constructed · the bound holds the string lengths and nothing "
        "else, so a `.brobot` ledger — whose events are validated as `{ type }.passthrough()` — "
        "rides a ninth key of any size on the report into the renderer",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # report bound is CONSTRUCTED field by field, never spread) survives in `boundedWorkReport`,
        # which now returns `{ piece: report.piece, label, ... }`; 5e931be8 only renamed the first
        # key from `taskId` to `piece`. Killers are two-bounds.test.ts §1 'lets no undeclared key
        # ride the report' and §4 'the bound SPREADS nothing', which kept the M12 comment and still
        # match `...report`. Killed by `two-bounds.test.ts`.
        [
            (STORE, '  return {\n    piece: report.piece,', '  return {\n    ...report,\n    piece: report.piece,'),
        ],
    ),
    (
        "M14 · 🔴 a task number that is not a number reaches a heading · `isAWorkReport` admits "
        "`NaN` on purpose and `work-report.ts` builds `Task #${String(report.number)}`, so a stored "
        "`NaN` draws **Task #NaN** — `memory_loaded`'s *`NaN memories`* one arm over, and the value "
        "that took this bound's first version to a stack overflow",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # heading this app could never have written is dropped, not drawn) survives, but the guard
        # moved from `Number.isFinite(report.number)` to `pieceNumbersOf(report.label) === null`
        # because a task's `number` became a piece `label` (`Task #N` became `W1.4`). Plant a gate
        # that admits any string label, so `WNaN`, `W1.Infinity`, `W0` and a 500k-char label reach a
        # heading. Killed by `two-bounds.test.ts`.
        [
            (STORE, 'pieceNumbersOf(report.label) === null', "typeof report.label !== 'string'"),
        ],
    ),
    (
        "M13 · ⛔ a declared field is left out of the construction · `documentId` is silently "
        "dropped from every replayed report, which is a bound that deletes the fact rather than "
        "bounding it — and it is the exact edit an OPTIONAL field added to `WorkReport` makes by "
        "omission, which the type cannot catch",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # declared optional field left out of the construction is silently dropped) survives.
        # `documentId` was replaced by `resources` ("one document per task until D-016, any number
        # of resources since"), and `resources` is the optional field now built by
        # `...(resources.length > 0 ? { resources } : {})`. Plant that omission; the label's
        # `documentId` reads as `resources` today. Killed by `two-bounds.test.ts`.
        [
            (STORE, '    ...(resources.length > 0 ? { resources } : {}),\n', ''),
        ],
    ),
]
