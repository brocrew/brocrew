"""656 · A card that says idle, and a docblock quieter than its button.

⚑ **Two small, true defects from `643`, which found both and — being read-only — fixed neither.**

## 🔴 A · what the dispatch CHANGED

 1. **F4 · `AgentCard.state` asks *on its way out* the way the door asks it.** `close()` marks
    `slot.phase` first and the card only ever read that; a provider stream that FAILS under the host
    reaches `finalize()` from the pump's `finally` without `close()`, so `session.finalizing` was set
    while `slot.phase` was still `live` — the door said *"still closing"* and the card, reading the
    provider's own status, said `idle`. Measured red on `981d3b16`, held open deterministically.
 2. **F5 · one list of what a reopen costs.** `REOPEN_COSTS` beside the sentence a person reads;
    both docblocks point at it; the sentence gained the one cost it had never named — work still
    running in the background, which the provider child takes with it.

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on the card's `session.closing !== null` clause.** 🔴 **Nothing can kill it**: its only
writer is `close()`, which sets `slot.phase = 'closing'` on the line before, so `session.closing` is
never set while the phase is not. ⚑ It stays because it makes the card's question the DOOR's
question — `assertAcceptsMessages` asks `closing || finalizing` — and the card exists to predict that
door. Recognised before it was written (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).

⚠️ **No row on the two docblocks.** ⛔ A docblock is prose, and no test reads either one: the host's
now points at `REOPEN_COSTS` and names no cost, which is what keeps it from drifting — there is no
list left in it to go stale.

## 🔴 C · the anchor this dispatch corrected rather than retired

⛔ **`470` M20 quoted the three-line `free` literal byte for byte**, so adding a clause made it
stale. ⚑ Corrected in place — the replacement is unchanged and now strips four costs rather than
three — and re-verified RED by hand. `470` is `unrun`, so no verdict was inherited.

## ⚑ D · the killers

`apps/desktop/test/a-card-that-says-idle.test.ts` §1 for F4;
`apps/desktop/test/what-a-reopen-costs.test.ts` §1 and §2 for F5. Every row verified RED by hand,
anchor count `== 1`, restored from saved bytes.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
REOPENING = "apps/desktop/src/renderer/src/lib/reopening.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"

# ⚠️ **Anchor corrected in place at `659`**: the card's three facts are `onItsWayOut(slot)` now,
# asked before the session (`650` F3). ⛔ The SUBJECT is unchanged — the card forgetting
# `finalizing` — so the replacement spells the card's own question without that clause.
# Re-verified RED by hand against `a-card-that-says-idle.test.ts` §1.
THE_CARD_ASKS_THE_DOOR = (
    "      state: onItsWayOut(slot) ? 'ending' : session === null ? 'starting' : session.handle.status(),\n"
)

# ⚑ **678 · corrected in place, the SUBJECT unchanged** — R26 added *"or attached"* and the sentence
# re-wrapped, so the background clause now sits across the line break; the row still drops it.
# ⚑ **741 · re-anchored, not retired**: R99 (corrected) added *"leaves plan mode"* to the sentence and
# it re-wrapped; M2 still drops the background clause (and, with the wrap, the plan one beside it).
THE_BACKGROUND_CLAUSE = (
    "    'session’s “allow for this session” approvals, leaves plan mode and stops anything still ' +\n"
    "    'running in the background, and a message waiting to be sent comes back as text for you to ' +\n"
    "    'send again.',\n"
)

THE_ROW_THAT_OWNS_THE_SWEEP = "    sweeps: ['stopDetachedWork'],\n"

THE_SWEEP_ON_A_REOPEN = (
    "  stopDetachedWork(state) // …and so did what it had deliberately left running (248)\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── F4 · the card ──────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** AgentCard.state is no longer a raw
        # 'ending'/'starting'/'idle' string derived inline from onItsWayOut+session; it now comes
        # from `this.stateOf()`'s shared AgentState derivation (D-017 R11), which categorically
        # excludes process facts (rule 5) — 'ending' is not a producible value any more.
        # `a-card-that-says-idle.test.ts` itself now asserts `state: { is: 'idle' } }` for exactly
        # the finalizing-without-close scenario this row was about, confirming the word is gone on
        # purpose. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 **the card stops asking about `finalizing`** · back to the phase and `closing` "
        "alone, which is `643` F4 exactly: a stream that fails under the host reaches `finalize()` "
        "without `close()`, the door refuses *still closing*, and the card — falling through to "
        "the provider's own status — says `idle`. ⚠️ **What a parent does with it**: sends into a "
        "conversation that is being torn down, and is told a sentence about closing by the very "
        "door the card said was open",
        [(HOST, THE_CARD_ASKS_THE_DOOR,
          "      state: slot.phase === 'closing' || (session !== null && session.closing !== null) ? 'ending' : session === null ? 'starting' : session.handle.status(),\n")],
    ),
    # ── F5 · the one list ──────────────────────────────────────────────────────────────────────
    (
        "M2 · ⛔ **the sentence stops telling a person the background work goes** · the clause "
        "`656` added is dropped and the `free` sentence is back to naming three costs. ⚑ "
        "**Detached work outlives its turn by design**, so the button is offered while it runs, "
        "and pressing it closes the child that holds it — every row still running is then marked "
        "*did not finish* and the running list is emptied. 🔴 A person was told what a reopen "
        "forgets and not what it stops",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — REOPENING_SAYS.free still
        # names the background-work cost ('leaves plan mode and stops anything still running in the
        # background'); only the trailing clause about a queued message changed, from 'comes back as
        # text for you to send again' (retired: D-017 makes a stop no longer an ending, so a held
        # message now survives and is sent once reopened) to 'is sent once it has reopened'. The
        # clause the row targets is untouched.
        [
            # ⚑ **always allow that recurs · re-anchored in place, not retired** — the conversation grant is named by its button's words; the plant still drops the background clause (and the plan one beside it)
            (REOPENING, "    '“Allow for this conversation” approvals, leaves plan mode and stops anything still ' +\n    'running in the background, and a message waiting to be sent is sent once it has reopened.',", "    '“Allow for this conversation” approvals, and a message waiting to be sent is sent once it has reopened.',"),
        ],
    ),
    (
        "M3 · ⚠️ **the table stops answering for a sweep the renderer performs** · the background "
        "row names no sweep, so `markReopened` performs one no row claims. ⛔ **That is the drift the "
        "table exists to catch** — a cost the code charges and nobody decided whether a person "
        "should be told about — and the census is what makes it a red rather than a paragraph",
        [(REOPENING, THE_ROW_THAT_OWNS_THE_SWEEP, "    sweeps: [],\n")],
    ),
    (
        "M4 · 🔴 **the renderer stops performing a sweep the table still claims** · `markReopened` "
        "no longer marks detached work *did not finish*. ⛔ **The other direction of the same "
        "census**: a row naming a cost the code no longer charges is a claim with nothing behind "
        "it, and the table would go on telling the next reader the work is swept",
        [(TRANSCRIPT, THE_SWEEP_ON_A_REOPEN, "")],
    ),
]
