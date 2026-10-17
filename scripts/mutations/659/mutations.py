"""659 · One question, six places — is this conversation on its way out.

⚑ **From `656` F1 and `650` F3.** Two doors lead into teardown and only one touches the phase:
`close()` marks `slot.phase = 'closing'`; a provider stream that FAILS under the host reaches
`finalize()` from the pump's `finally`, which sets `session.finalizing` and leaves the phase alone.

## 🔴 A · what the dispatch CHANGED

⛔ **One named predicate, `onItsWayOut`, and every phase comparison in `runtime-host.ts` goes
through it.** Four readers were blind or backwards: `endAgent` and `interruptAgent` judged a
finalizing conversation by its provider's own status; the spawn door's `liveParent` returned a
finalizing parent as live — **measured: on `d1f15941` such a parent spawned a child**; and `cardFor`
asked about the session before the phase, so a reservation being closed read `'starting'`. The five
readers that already asked all three facts now call the predicate instead of spelling them.

⚑ **The rails' word is named**: `WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT` — one decision behind the card's
`'ending'` and the rails' `'ended'`, which answer different questions in different vocabularies.

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on the four pure-refactor sites** (`runningStateOf`, `attachHeldSession`,
`whyNotClaimed`, `releaseSession`) **nor on `reserve`**: they asked the three facts before `659` and
ask the same predicate now. ⛔ Their behaviour is the predicate's, and the predicate has its own rows
below — a row per caller would measure the same clause five times.

⚠️ **No row on the reservation readers** (`whyNotOurs`, `cancelLaunch`, `settleTeardown`,
`sessionFor`): their slot has no session, so the predicate reduces to its phase clause — which `M6`
already mutates. ⚑ **`666` routed a fifth, `withdrawTask`'s launch-in-flight arm (`657`), through
the predicate**; it keeps its own row, `657 M11`, anchor corrected in place.

## ⚑ C · the killers

`apps/desktop/test/the-question-every-teardown-asks.test.ts` — §1 interrupt, §2 end, §3 spawn, §4
the card's order, each taken IN the finalize window with the stream failed and the provider's
`close()` held, and each paired with a control one fact over. Every row verified RED by hand,
anchor count `== 1`, restored from saved bytes.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

THE_SESSION_HALF = (
    "  return session !== null && (session.closing !== null || session.finalizing !== null)\n"
)
THE_PHASE_HALF = "  if (slot.phase === 'closing') return true\n"
THE_LIVE_PARENT = "        if (onItsWayOut(slot)) return null\n"
THE_END_RAIL = (
    "    const status = onItsWayOut(slot)\n"
    "      ? WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT\n"
    "      : slot.session === null\n"
)
THE_INTERRUPT_RAIL = (
    "    const status = onItsWayOut(slot)\n"
    "      ? WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT\n"
    "      : session === null\n"
)
THE_CARD = (
    "      state: onItsWayOut(slot) ? 'ending' : session === null ? 'starting' : session.handle.status(),\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **the predicate forgets `finalizing`** · it answers for `close()`'s door and not "
        "for a stream that failed under the host, which is the blind spot `656` F1 named — and, "
        "because every reader now asks this one function, the SAME blind spot at every reader at "
        "once. ⛔ That is the price of one question in one place, stated: a defect here is a defect "
        "everywhere, which is why this row has four killers",
        [(HOST, THE_SESSION_HALF, "  return session !== null && session.closing !== null\n")],
    ),
    (
        "M2 · ⚠️ **the predicate forgets the phase** · it answers only once a session exists, so a "
        "reservation being closed while its provider is still starting is not on its way out. "
        "⛔ `650` F3's case, through the other clause: the card reads `'starting'` about a "
        "conversation somebody has just closed",
        [(HOST, THE_PHASE_HALF, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # This row asserted that a give from a parent whose stream failed (on its way out) is
        # refused, planting the phase-alone check on the live-parent read. Ruling (b) of 8d54d6dc
        # reverses it: 'A conversation whose process is stopping is still the caller: runningAs
        # includes it', and `runningAs` no longer has `onItsWayOut`. The killer's section 3 now
        # expects the failed-stream parent to give ('a parent whose stream failed gives - a
        # conversation is started and the piece is written'), so the old defect is the required
        # behaviour. Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 **the spawn door goes back to the phase alone** · a parent whose stream failed "
        "under the host is returned as live. ⛔ **Measured before the repair: it spawned a child** "
        "— *parented to something that is about to be gone*, in the words of the comment two lines "
        "above that always said this line did the opposite",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a parent whose stream failed under the host is on its way out and must not be
        # able to give. spawn_agent's liveParent is gone with the tool, and its replacement is
        # runningAs, which is now the give_work door's live-parent check and still reads
        # onItsWayOut(slot). The plant puts the phase-alone test back on that line, and section 3 of
        # the killer was re-aimed at give_work in 5e931be8. Killed by
        # `the-question-every-teardown-asks.test.ts`.
        [
            (HOST, '    if (onItsWayOut(slot)) return null\n', "    if (slot.phase === 'closing') return null\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This row's subject is the END rail —
        # end_agent's own admission logic in end-rails.ts (236 lines) — which the commit deleted
        # outright as part of removing end_agent/resume_agent entirely. Nothing 'ends' a
        # conversation any more, so there is no END-rail status computation left to plant a
        # phase-alone defect into. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ **the END rail goes back to the phase alone** · a finalizing conversation parked on "
        "a card is refused `a-person-is-being-asked` — about a card the teardown already running is "
        "about to settle, and to a parent that asked to end a conversation which is ending anyway",
        [(HOST, THE_END_RAIL,
          "    const status = slot.phase === 'closing'\n"
          "      ? WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT\n"
          "      : slot.session === null\n")],
    ),
    (
        "M5 · 🔴 **the INTERRUPT rail goes back to the phase alone** · a conversation whose stream "
        "failed under the host is interrupted, because its provider still says `idle` — and the "
        "act lands on a child that is being stopped already",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — interruptAgent still
        # needs onItsWayOut's full phase-or-finalizing check before deciding whether to reach into a
        # session; the old three-way status ternary is gone, but the same guard now lives as `if
        # (slot === undefined || onItsWayOut(slot)) return this.nothingToInterrupt(sessionId)`.
        # Narrowing that call to `slot.phase === 'closing'` reproduces exactly 'the interrupt rail
        # goes back to the phase alone', letting a finalizing-but-not-closing conversation be
        # interrupted while its provider still reports 'working'.
        [
            (HOST, '    if (slot === undefined || onItsWayOut(slot)) return this.nothingToInterrupt(sessionId)', "    if (slot === undefined || slot.phase === 'closing') return this.nothingToInterrupt(sessionId)"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same subject as 656 M1: the card's
        # literal `state: onItsWayOut(slot) ? 'ending' : session === null ? 'starting' :
        # session.handle.status()` ternary is gone, replaced by `this.stateOf()`'s shared AgentState
        # derivation which never reports 'ending'/'starting' (process facts, rule 5).
        # `the-question-every-teardown-asks.test.ts` §4 itself was rewritten to assert `state: { is:
        # 'idle' }` for the reservation-closed-while-starting scenario, confirming the word this row
        # protects no longer exists to lose. Its anchor is left stale, so the census records it
        # retired.
        "M6 · ⚠️ **the card asks about the session first again** · `650` F3 exactly: a reservation "
        "closed while its provider is still starting reads `'starting'`, a conversation on its way "
        "out described as on its way in",
        [(HOST, THE_CARD,
          "      state: session === null ? 'starting' : onItsWayOut(slot) ? 'ending' : session.handle.status(),\n")],
    ),
]
