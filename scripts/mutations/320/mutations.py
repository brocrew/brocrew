"""320 · A row that overtakes the turn — each row is THE DEFECT, put back verbatim (131).

⛔ **What 320 fixed, in one sentence.** `publishMemoryNotes` took the next ordinal and SENT it from
inside `deliver`'s own publish window, so the `memory_note` row 318 added reached the renderer before
the `status` that produced it — `182` then `181` — and the conversation grew two red *"event stream
gap"* notices around the card. The ledger was contiguous throughout, which is what makes this purely
a delivery-order defect and what made it invisible to every test in the repository.

⚑ **The shape of the fix, because every row below is a way of undoing part of it.** Observing and
recording stay exactly where `318` put them — ABOVE the sink gate, because that row's hole would be
permanent; only the DELIVERY moves below, after the event whose window it is inside. `recordOurs`
takes the ordinal and writes the row and hands the message back; `emitOurs` sends it; `emit` is the
one door every ordinal-bearing message now leaves by.

| rows | what they are |
|---|---|
| `M1`-`M2` | ⛔ **the defect** — the row sent from inside the window, and the same disorder by swapping the two sends |
| `M3`-`M5` | 🔴 **the second disorder, which no screenshot showed** — the recording-failure notice published between an event and its own delivery |
| `M6` | ⚠️ **the row recorded and never delivered** — durable, and the conversation still says nothing |
| `M7`-`M8` | 🔴 **the counter that walked backwards** — one reorder reported three times |
| `M9`-`M11` | ⚑ **the two sentences** — the direction collapsed, inverted, and stripped of what it is for |

⚑ **`M5` exists because it was a phantom survivor for an hour.** Written, it survived the whole
desktop suite: the only always-throwing append double in the repository never reaches a `publishOurs`
path, and the one test that does reach it filters its sink by event type, so a reversed wire order
was invisible. ⛔ The repair was a test — `memory-notes-host.test.ts` now breaks the ledger on the
`user_decision` row `respondPermission` publishes — and not a paragraph excusing the gap. Measured
after: the row dies.

## ⛔ What this table cannot reach, said out loud

⚠️ **No row covers `RuntimeHost.emit`'s order check.** It is a tripwire for a defect that no longer
has a reachable path: every caller that could publish from inside another event's window has been
closed, so a row that broke the compare would record as a **survivor** and would mean nothing about
the guard. It is deliberately uncovered, and `emit`'s own docblock says so rather than leaving a
reader to discover it from a green column. ⚑ This is the same reason `318 M3`/`M4` are recorded as
measured equivalents instead of being contorted into kills.

⚠️ **No row proves the WORDING is right.** `M11` catches the out-of-order sentence losing the clause
that says what became of the event, because that exact string is asserted whole — but a third
wording, subtly worse than both, would pass everything here. Whether *"this event is not lost, only
late"* is the right sentence for a person is a judgement, and `M11` marks its boundary rather than
pretending to cover past it. `318 M5` and `319 M18` say the same thing about the two sentences either
side of this one.

⛔ **And the FIRST draft of that sentence said something the app cannot know.** It read *"nothing is
missing"*, which `nextOrdinal` — the highest ordinal seen, plus one — has no way to establish: feed it
`100, 104, 101, 102, 103` and it prints the reassurance three times while 102 and 103 have genuinely
not arrived. ⚑ Found by an adversarial pass over this dispatch's own diff, and narrowed to the one
fact the branch does know. No row covers the difference, because both wordings are strings and a row
can only catch the one that is asserted; `out-of-order-arrival.test.ts` asserts the multi-gap run
directly instead.

⚠️ **No row mutates `packages/runtime/**` or the ledger.** 320 changed no adapter, no normaliser and
no schema; the ledger was correct before this dispatch and is byte-identical after it. A row there
would be measuring somebody else's work.

⚠️ **No row mutates another dispatch's table, and none mutates the harness.** Like 240, 243, 247,
248, 250, 251, 254, 258, 262, 292, 300, 301, 306, 308, 317, 318 and 319. ⚑ `318 M1`, `M15` and `M17`
were reddened by this dispatch's edit and are corrected IN PLACE in `318/mutations.py` (142) —
same labels, same defects, re-anchored to the split.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"

MUTATIONS = [
    # ── the defect ────────────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the note is SENT from inside the window of the event that "
        "produced it, so the renderer receives `182` before `181` and reports a gap it does not "
        "have — friction log F6 exactly, and the state `main` was in before this dispatch",
        [
            (
                HOST,
                "    const note =\n"
                "      event.type === 'status' && TURN_ENDINGS.has(event.state)\n"
                "        ? this.recordMemoryNotes(session)\n"
                "        : null\n",
                "    const note = null\n"
                "    if (event.type === 'status' && TURN_ENDINGS.has(event.state)) {\n"
                "      const now = this.recordMemoryNotes(session)\n"
                "      if (now !== null) this.emitOurs(session, now)\n"
                "    }\n",
            )
        ],
    ),
    (
        "M2 · 🔴 the same disorder by the other door · the note is delivered BEFORE the status it "
        "belongs to. ⚠️ Both sends are below the gate and both ordinals are already taken, so "
        "nothing about durability changes — which is precisely why only a test that watches ARRIVAL "
        "at a sink can see it",
        [
            # ⚑ **Re-anchored in place by `396`, not retired** (142's rule). ⛔ `396` turned
            # `deliver`'s `if (!session.sink.alive) return` into a BLOCK — so that the flush, which
            # hands work to a provider, stopped being conditional on whether anybody is looking —
            # and every line these two hunks name moved two columns right. ⚠️ **The DEFECT is
            # unchanged**: the note is delivered before the status it belongs to.
            #
            # ⚠️ **The indentation is written out in full rather than left to a partial match.** The
            # old one-line anchors kept matching by accident, because a 4-space prefix is a substring
            # of a 6-space line; only the two-line spans went dark. An anchor that matches for a
            # reason nobody chose is one that stops matching for a reason nobody predicts.
            (
                HOST,
                "      this.emit(session, { sessionId: session.id, ordinal, at, event: wire })",
                "      if (note !== null) this.emit(session, note)",
            ),
            (
                HOST,
                "      if (note !== null) this.emit(session, note)\n      this.reportRecordingFailure(session)",
                "      this.emit(session, { sessionId: session.id, ordinal, at, event: wire })\n"
                "      this.reportRecordingFailure(session)",
            ),
        ],
    ),
    # ── the second disorder, found by the enumeration §4.1 asked for ──────────────────────────
    (
        "M3 · 🔴 THE SECOND DEFECT, verbatim · `recordOurs` reports the broken ledger itself, so on "
        "a turn-ending status where the database has just failed the notice takes `183` and goes "
        "out while `deliver` still holds `181` — the wire reads `182, 183, 181`. ⛔ A three-event "
        "disorder on the one path where the app is already telling you it has stopped recording",
        [
            (
                HOST,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 inserted schedule evidence and launch-row tracking before the same return; preserve both while reporting the recording failure inside recordOurs again.
                "    return { sessionId: session.id, ordinal, at, event }\n  }\n\n  /**\n   * Send a row this app authored",
                "    this.reportRecordingFailure(session)\n    return { sessionId: session.id, ordinal, at, event }\n  }\n\n  /**\n   * Send a row this app authored",
            )
        ],
    ),
    (
        "M4 · ⛔ the failure notice is published between the status and the row it caused, rather "
        "than after both. ⚑ Its ordinal is taken at SEND time, so moving the call up by one line "
        "moves the ordinal too — this is the narrowest possible form of `M3`",
        [
            (
                HOST,
                # ⚑ **Re-anchored in place by `396`** — see `M2`: `deliver`'s attention gate became
                # a block and these lines moved two columns right. The defect is unchanged.
                "      if (note !== null) this.emit(session, note)\n      this.reportRecordingFailure(session)",
                "      this.reportRecordingFailure(session)\n      if (note !== null) this.emit(session, note)",
            )
        ],
    ),
    (
        "M5 · ⚠️ `emitOurs` reports the broken ledger BEFORE it sends what it just recorded, so "
        "every app-authored row in the app — a turn, a decision, a queued message — goes out one "
        "ordinal behind the notice about it. ⛔ The defect generalised past memory notes entirely",
        [
            (
                HOST,
                "    this.emit(session, message)\n    this.reportRecordingFailure(session)",
                "    this.reportRecordingFailure(session)\n    this.emit(session, message)",
            )
        ],
    ),
    # ── the delivery that never happens ───────────────────────────────────────────────────────
    (
        "M6 · ⚠️ the row is recorded and never delivered, so the note is in the ledger and the live "
        "conversation says nothing until it is reopened. ⛔ `318`'s whole deliverable, undone by "
        "deleting one line, and the ledger stays perfect while it happens",
        [
            (HOST, "    if (note !== null) this.emit(session, note)\n", "")],
    ),
    # ── the counter that walked backwards ─────────────────────────────────────────────────────
    (
        "M7 · 🔴 the ordinal counter goes BACKWARDS on a late arrival, so one reorder is reported "
        "three times — the third against an event that arrived in perfect sequence, dated to "
        "whatever the user did next. ⚑ An instrument that manufactures a false positive out of a "
        "true one is one you stop believing",
        [
            (
                RECORD,
                "  record.nextOrdinal = Math.max(record.nextOrdinal, message.ordinal + 1)",
                "  record.nextOrdinal = message.ordinal + 1",
            )
        ],
    ),
    (
        "M8 · ⛔ the counter never advances at all, so every event after the first reads as a gap. "
        "⚠️ **Recorded honestly: this row dies in a test HELPER's precondition** — `waitingFor181` "
        "asserts `nextOrdinal === 181` before any of the wording assertions is reached — so its "
        "verdict is evidence that a frozen counter is noticed, and NOT evidence about the "
        "conditional stall this line's own comment is also written against. `M7` is the row that "
        "measures the retreat; this one measures the floor beneath it",
        [
            (
                RECORD,
                "  record.nextOrdinal = Math.max(record.nextOrdinal, message.ordinal + 1)",
                "  record.nextOrdinal = Math.max(record.nextOrdinal, record.nextOrdinal)",
            )
        ],
    ),
    # ── the two sentences ─────────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 the two directions collapse back into one sentence, so an event that arrived out "
        "of order is reported as a HOLE in the conversation. ⛔ `009`/`074`: the app claims "
        "something is missing when it is holding every event — not a harsh sentence, a false one",
        [
            # ⚑ **Re-anchored in place by `623`, not retired** (142's rule). ⛔ `623` replaced the
            # two-arm ternary with a three-arm fold and reworded both sentences for a person
            # (`HO-095` §2); ⚠️ **the DEFECT is unchanged** — the low direction is given the high
            # direction's sentence, so an event the window is holding is reported as a hole.
            (
                RECORD,
                "  say(record, message, lateSentence(filledAHole, short))",
                "  say(record, message, missingSentence(short))",
            )
        ],
    ),
    (
        "M10 · ⛔ the direction test is inverted, so each case is given the OTHER's sentence: a real "
        "hole reads as a harmless reorder, and a harmless reorder reads as a hole. ⚑ The one "
        "mutation that leaves both sentences present and every word of them true somewhere else",
        [
            # ⚑ **Re-anchored in place by `623`, not retired** (142's rule). ⛔ The test moved from
            # a ternary condition to the `if` that opens `theHoleMoved`; ⚠️ **the DEFECT is
            # unchanged**, and `623` deliberately wrote no row of its own for it.
            (
                RECORD,
                "  if (message.ordinal > record.nextOrdinal) {",
                "  if (message.ordinal < record.nextOrdinal) {",
            )
        ],
    ),
    (
        "M11 · ⚠️ the out-of-order sentence loses the clause that says what became of the event, and "
        "becomes a bare label. ⛔ It still names both ordinals and still shows up amber, so the "
        "reader is left to assume the worst about an event that was not lost — `320 §5`'s whole "
        "ruling, deleted",
        [
            # ⚑ **Re-anchored in place by `623`, not retired** (142's rule). ⛔ The clause that says
            # what became of the event is now the tail of `lateSentence`'s last arm; ⚠️ **the DEFECT
            # is unchanged** — the reader is left to assume the worst about an event that is here.
            (
                RECORD,
                "  return (\n"
                "    'An earlier part of this conversation arrived after a later one, so it is at "
                "the end of this ' +\n"
                "    'list rather than in its place.'\n"
                "  )",
                "  return 'An earlier part of this conversation arrived after a later one.'",
            )
        ],
    ),
]
