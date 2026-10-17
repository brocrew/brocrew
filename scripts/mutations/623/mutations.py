"""623 · The event that did not arrive — each row is THE DEFECT, put back verbatim (131).

⛔ **What 623 fixed, in one sentence.** The renderer's gap notice was a claim about ONE INSTANT that
nothing ever revisited — *"expected ordinal 486, got 487"* means *486 had not been folded when 487
landed* and says nothing about whether 486 landed a moment later — so `HO-095` §2 asked the screen
*was an event lost, or did the numbering skip* and the screen could not answer either. ⚑ The window
now keeps the SET of ordinals it is short by, so a late arrival strikes its own hole off and the
sentence that raised the alarm is taken back in words a person reads.

| rows | what they are |
|---|---|
| `M1`-`M3` | 🔴 **the set** — when it is read, the ordinals it lists, and the count it keeps when it stops listing |
| `M4`-`M5` | ⛔ **the bound** — the cap removed, and the overflow silently uncounted |
| `M6`-`M8` | ⚑ **the retraction** — the hole never struck off, the discriminant dropped, and *nothing is missing* said over a hole that is still open |
| `M9`-`M10` | ⚠️ **the re-anchorings** — a hole carried across a page that replaced the events it was a hole in |
| `M11`-`M13` | 🔴 **the words** — the clause four instruments aim at, the plural, and the *what you can do* half |
| `M14`-`M15` | ⛔ **the notice itself** — its severity and the projection it lands on |

## ⛔ What this table cannot reach, said out loud

⚠️ **No row proves the WORDING is right.** `M11`-`M13` catch the sentence losing the clause the
negatives are aimed at, losing its number, and losing the remedy — but a fourth wording, subtly worse
than all of them, would pass every row here. ⚑ Whether *"reopening it loads them from the record"* is
the right sentence for a person is a judgement; `HO-095` §2 made the ruling and these rows mark its
boundary rather than pretending to cover past it. `320 M11` says the same thing one dispatch back.

⚠️ **No row covers the `console.warn` pair.** They are the ordinals `HO-095` §3.3 asks to be kept,
and a row that deleted one would record as a survivor: no assertion in this repository reads the
renderer's console, and adding one would be a test that proves only itself. ⛔ Said here rather than
left for a reader to infer from a green column — `320`'s rule about `RuntimeHost.emit`, one file over.

⚠️ **No row mutates the HOST.** `623` established by measurement that the allocator is contiguous
across a refused call and its retry and changed nothing there; `the-event-that-did-not-arrive.test.ts`
§1 and §2 are that measurement, and a row in `runtime-host.ts` would be measuring `320`'s work.

⚠️ **No row mutates another dispatch's table, and none mutates the harness.** ⚑ `320 M9`, `M10` and
`M11` were re-anchored IN PLACE in `320/mutations.py` (142) — same labels, same defects, aimed at the
three-arm fold that replaced the two-arm ternary.

⛔ **And `623` has no *direction inverted* row of its own, deliberately: that row is `320 M10`.** ⚠️ The
fold is new and the defect is not, so a second row with the same edit would be a duplicate wearing a
newer number — `boundRelayedIdentity`'s rule in `session-store.ts`, read from the other side: *a
mutation table's anchor is a fact about the source, and a new method that collides with one is the new
method's to avoid.*
"""

RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"

MUTATIONS = [
    # ── the set ───────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the window counts what it is short by BEFORE striking the arrival off, so the last "
        "hole closing is read as one hole still open and the retraction never fires. ⛔ An off-by-one "
        "in TIME rather than in arithmetic, and the only symptom is a sentence that is never said",
        [
            (
                RECORD,
                "  const filledAHole = record.missing.delete(message.ordinal)\n"
                "  const short = howShort(record)",
                "  const short = howShort(record)\n"
                "  const filledAHole = record.missing.delete(message.ordinal)",
            )
        ],
    ),
    (
        "M2 · ⛔ the ordinals are never listed, so the set stays empty and every late arrival is "
        "told it filled nothing. ⚑ The count still moves, so the alarm still fires — what dies is "
        "the retraction, which is the whole of what `320` could not write",
        [
            (
                RECORD,
                "    for (let step = 0; step < listed; step += 1) "
                "record.missing.add(record.nextOrdinal + step)",
                "    for (let step = 0; step < listed; step += 1) record.missing.add(-1)",
            )
        ],
    ),
    (
        "M3 · ⚠️ the overflow is dropped, so a window short by more than the list can hold reports "
        "only what it listed. ⛔ The bound moves from the LIST to the FACT — which is the one thing "
        "`SessionRecord.missingBeyondTheList` exists to keep it off",
        [
            (
                RECORD,
                "    record.missingBeyondTheList += shortBy - listed",
                "    record.missingBeyondTheList += 0",
            )
        ],
    ),
    # ── the bound ─────────────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 THE UNBOUNDED WALK · the cap is removed, so a window handed ordinal 40,000 as its "
        "first arrival lists forty thousand integers to say a sentence that names none of them. "
        "⛔ The hazard the bound is for, put back",
        [
            (
                RECORD,
                "    const listed = Math.min(\n"
                "      shortBy,\n"
                "      Math.max(0, MOST_MISSING_ORDINALS_TRACKED - record.missing.size),\n"
                "    )",
                "    const listed = shortBy",
            )
        ],
    ),
    (
        "M5 · ⛔ the cap forgets what the list is ALREADY holding, so a second hole may list another "
        "whole cap's worth. ⚠️ The bound becomes per-gap instead of per-window, which is the "
        "difference between a bound and a rate limit",
        [
            (
                RECORD,
                "      Math.max(0, MOST_MISSING_ORDINALS_TRACKED - record.missing.size),",
                "      MOST_MISSING_ORDINALS_TRACKED,",
            )
        ],
    ),
    # ── the retraction ────────────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 THE DEFECT `HO-095` §2 READ · the hole is never struck off, so the window goes on "
        "being short by an event it is holding and the alarming sentence is never taken back. ⛔ "
        "Exactly the state `320` left: two notices, and the first one standing over the second",
        [
            (
                RECORD,
                "  const filledAHole = record.missing.delete(message.ordinal)",
                "  const filledAHole = record.missing.has(message.ordinal)",
            )
        ],
    ),
    (
        "M7 · ⛔ the discriminant is dropped, so an ordinal this window was NEVER short by is "
        "reported as having closed a hole. ⚠️ A page anchors `nextOrdinal` part-way through a "
        "ledger, so every arrival below it would claim a repair that never happened",
        [
            (
                RECORD,
                "  if (filledAHole && short === 0) {",
                "  if (short === 0) {",
            )
        ],
    ),
    (
        "M8 · 🔴 the *still missing* arm goes, so a late arrival that closed ONE of three holes is "
        "answered with the sentence for none. ⛔ 074's rule inverted: the stronger claim the record "
        "would like, over the weaker one it knows",
        [
            (
                RECORD,
                "  if (short > 0) {\n"
                "    return (\n"
                "      'An earlier part of this conversation arrived after a later one; ' +\n"
                "      `${short} ${short === 1 ? 'event is' : 'events are'} still missing.`\n"
                "    )\n"
                "  }\n",
                "",
            )
        ],
    ),
    # ── the re-anchorings ─────────────────────────────────────────────────────────────────────
    (
        "M9 · ⚠️ `openWindow` carries the old holes across, so a window handed a fresh page reports "
        "a hole in the life that page replaced. ⛔ 064's defect one field over — the entries were "
        "cleared and the thing that counts them was not",
        [
            (
                RECORD,
                "  if (first) record.nextOrdinal = first.ordinal\n"
                "  // 🔴 **623 · and what this record was SHORT BY goes with the entries it was "
                "short from.**",
                "  if (first) record.nextOrdinal = first.ordinal\n"
                "  // 🔴 **623 · and what this record was SHORT BY goes with the entries it was "
                "short from.** (removed)",
            ),
            (
                RECORD,
                "  // field over, and the reason that clearing is the first thing this function does.\n"
                "  forgetWhatWasMissing(record)\n"
                "}",
                "  // field over, and the reason that clearing is the first thing this function does.\n"
                "}",
            ),
        ],
    ),
    (
        "M10 · ⛔ `reopenAtLatest` keeps them instead, so *jump to latest* lands on the newest page "
        "still claiming the events it skipped past are missing. ⚑ The same correction as `M9`, at "
        "the second of the two doors that write `nextOrdinal` directly",
        [
            (
                RECORD,
                "  // this record was short by is either in it or is below it, and neither is missing "
                "any more.\n"
                "  forgetWhatWasMissing(record)\n"
                "}",
                "  // this record was short by is either in it or is below it, and neither is missing "
                "any more.\n"
                "}",
            )
        ],
    ),
    # ── the words ─────────────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 the exported clause is reworded, so the two DEMO NEGATIVES aimed at it stop "
        "measuring a hand-over that loses an event. ⛔ Those two assertions are the closest thing "
        "this repository has to `HO-095` §2's own hypothesis, and this is how they go quiet",
        [
            (
                RECORD,
                "export const NOT_REACHED_THIS_WINDOW = 'not reached this window'",
                "export const NOT_REACHED_THIS_WINDOW = 'not yet reached this window'",
            )
        ],
    ),
    (
        "M12 · ⚠️ the count is dropped from the sentence, so a person is told part of the "
        "conversation is missing and never how much. ⛔ *What is affected* is `HO-095` §2's first "
        "requirement, and `expected 486, got 487` failed it by leaving the subtraction to the reader",
        [
            (
                RECORD,
                "    `${short} ${short === 1 ? 'event' : 'events'} of this conversation "
                "${short === 1 ? 'has' : 'have'} ` +",
                "    `Part of this conversation ` +",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The remedy clause `— reopening it
        # loads it/them from the record` is deleted on purpose: D-017b says 'no Reopen / Take it
        # over / Read the recording presses: one press, "Open the conversation"'. `missingSentence`
        # in `session-record.ts` now reads `${NOT_REACHED_THIS_WINDOW}, so what you are reading is
        # missing it/them.`, which states what it means for the reader and has no reopen remedy to
        # remove. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ the remedy goes, so the sentence says what is wrong and nothing a person can do "
        "about it. ⚠️ `HO-095` §2: *if it matters, say what it means for them* — a sentence that "
        "stops at the diagnosis is the old one in better words",
        [
            (
                RECORD,
                "    `${NOT_REACHED_THIS_WINDOW} — reopening it loads "
                "${short === 1 ? 'it' : 'them'} from the record.`",
                "    `${NOT_REACHED_THIS_WINDOW}.`",
            )
        ],
    ),
    # ── the notice ────────────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 the notice becomes FATAL, so a reorder the app recovered from inside one event "
        "is drawn in the app's red. ⛔ `320` §5 and `HO-095` §3.1 both rule that the loudness does "
        "not move — this moves it the other way, which is the same rule broken",
        [
            (
                RECORD,
                "  applyEvent(record.control, { type: 'error', message: text, fatal: false }, "
                "message.at)",
                "  applyEvent(record.control, { type: 'error', message: text, fatal: true }, "
                "message.at)",
            )
        ],
    ),
    (
        "M15 · ⛔ the notice goes on the READING projection, so a reader scrolled back into old "
        "history gets it dated to now, at the bottom of a page it did not happen on, where the next "
        "re-fold deletes it. ⚑ 064's finding, put back",
        [
            (
                RECORD,
                "  applyEvent(record.control, { type: 'error', message: text, fatal: false }, "
                "message.at)",
                "  applyEvent(record.transcript, { type: 'error', message: text, fatal: false }, "
                "message.at)",
            )
        ],
    ),
]
